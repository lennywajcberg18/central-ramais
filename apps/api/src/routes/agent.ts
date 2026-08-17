import { Router } from 'express';
import { z } from 'zod';
import { BadRequestError, ConflictError, NotFoundError } from '../errors';
import { requireAuth } from '../middleware/auth';
import * as conversations from '../repositories/conversations';
import * as departments from '../repositories/departments';
import * as messagesRepo from '../repositories/messages';
import * as users from '../repositories/users';
import * as shifts from '../repositories/shifts';
import { closeFromAgent } from '../services/lifecycle.service';
import { sendConversationMessage } from '../services/messaging.service';
import { assignPendingForUser } from '../services/routing.service';
import { endShift } from '../services/shift.service';
import { listTransferTargets, transferConversation } from '../services/transfer.service';
import {
  closeThread,
  getThread,
  listMessages as listInternalMessages,
  listThreads,
  reply as replyInternal,
  startThread,
} from '../services/internal.service';

const router = Router();

router.use(requireAuth);

router.get('/agent/conversations', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const departmentIds = await users.departmentIdsOf(tenantId, userId);
    const rows = await conversations.listForAgentView(tenantId, userId, departmentIds);
    res.json(
      rows.map((c) => ({
        id: c.id,
        status: c.status,
        departmentId: c.department?.id ?? null,
        departmentName: c.department?.name ?? null,
        entryLinkLabelSnapshot: c.entryLinkLabelSnapshot,
        contactNumber: c.externalContact.waNumber,
        assignedUserId: c.assignedUserId,
        createdAt: c.createdAt,
        lastMessageAt: c.lastMessageAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get('/agent/conversations/:id/messages', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    // Setor entra na conta junto com o tenant: a conversa tem que ser minha ou
    // do meu setor, senão é histórico de paciente de quem não me diz respeito.
    const conversation = await conversations.findByIdForAgent(tenantId, userId, req.params.id);
    if (!conversation) throw new NotFoundError();
    const rows = await messagesRepo.listByConversation(tenantId, conversation.id);
    res.json(
      rows.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        direction: m.direction,
        senderType: m.senderType,
        body: m.body,
        createdAt: m.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

const sendSchema = z.object({ body: z.string().min(1).max(4096) });

router.post('/agent/conversations/:id/messages', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('body obrigatório');

    const conversation = await conversations.findByIdForAgent(tenantId, userId, req.params.id);
    if (!conversation) throw new NotFoundError();
    if (conversation.status === 'closed' || conversation.status === 'awaiting_feedback') {
      throw new BadRequestError('conversa encerrada');
    }
    // Número bloqueado não pode receber resposta do hospital — o bloqueio
    // encerra a conversa, mas uma anterior ao bloqueio ainda pode estar aberta.
    if (conversation.externalContact.blocked) {
      throw new BadRequestError('este contato está bloqueado; desbloqueie antes de responder');
    }

    // Agente respondendo conversa da fila assume o atendimento. Se dois abrirem
    // a mesma conversa e responderem juntos, quem chega primeiro fica com ela —
    // a mensagem do segundo vai embora do mesmo jeito, porque ele já digitou.
    if (conversation.status === 'open') {
      const agora = new Date();
      const assumida = await conversations.assignTo(tenantId, conversation.id, userId, agora);
      if (assumida.count > 0) {
        await conversations.markFirstAssignedOnce(tenantId, conversation.id, agora);
      }
    }

    // O job de inatividade pode ter encerrado a conversa entre a leitura lá em
    // cima e este ponto: sem a trava, a resposta sairia para o WhatsApp DEPOIS do
    // encerramento e o `first_reply_at` seria gravado depois do `closed_at` —
    // atendimento fantasma nas métricas e uma mensagem do hospital sem ninguém
    // do outro lado.
    const viva = await conversations.touchIfActive(tenantId, conversation.id);
    if (viva.count === 0) {
      throw new BadRequestError('esta conversa foi encerrada enquanto você escrevia');
    }

    await sendConversationMessage(
      tenantId,
      conversation.id,
      conversation.whatsappNumber.phoneNumber,
      conversation.externalContact.waNumber,
      parsed.data.body,
      'agent'
    );
    await conversations.markFirstReplyOnce(tenantId, conversation.id);

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/agent/conversations/:id/close', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const conversation = await conversations.findByIdForAgent(tenantId, userId, req.params.id);
    if (!conversation) throw new NotFoundError();
    if (conversation.status === 'closed') throw new BadRequestError('conversa já encerrada');

    // O `if` acima é atalho: entre a leitura e o encerramento a conversa pode ter
    // sido encaminhada para outro setor ou já ter ido para `awaiting_feedback`
    // por outro caminho. Sem conferir o booleano, a resposta era 200 {ok:true} e o
    // atendente fechava a tela achando que encerrou — com a conversa viva no setor
    // novo. Mesmo tratamento que o encaminhamento já dá a quem perde a corrida.
    const encerrou = await closeFromAgent(tenantId, conversation.id);
    if (!encerrou) {
      throw new ConflictError('esta conversa mudou de setor ou já havia sido encerrada');
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Para onde esta conversa pode ir: os setores do link da pessoa, não os do hospital.
router.get('/agent/conversations/:id/transfer-targets', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    // Mesma guarda de setor das outras rotas de conversa: sem ela, o id vazado
    // já entregava os setores do link daquele contato para quem não atende.
    const conversation = await conversations.findByIdForAgent(tenantId, userId, req.params.id);
    if (!conversation) throw new NotFoundError();

    res.json(await listTransferTargets(tenantId, conversation.id));
  } catch (err) {
    next(err);
  }
});

const transferSchema = z.object({ departmentId: z.string().min(1) });

router.post('/agent/conversations/:id/transfer', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('escolha o setor de destino');

    // Encaminhar tira a conversa do setor onde ela está. Quem não atende nem o
    // setor nem a conversa não move o atendimento de ninguém.
    const conversation = await conversations.findByIdForAgent(tenantId, userId, req.params.id);
    if (!conversation) throw new NotFoundError();

    const resultado = await transferConversation(
      tenantId,
      conversation.id,
      parsed.data.departmentId,
      userId
    );
    res.json({ ok: true, ...resultado });
  } catch (err) {
    next(err);
  }
});

// ---- Ramal interno: um setor falando com outro, sem externo envolvido ----

router.get('/agent/internal', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    res.json(await listThreads(tenantId, userId));
  } catch (err) {
    next(err);
  }
});

const startThreadSchema = z.object({
  fromDepartmentId: z.string().min(1),
  toDepartmentId: z.string().min(1),
  body: z.string().trim().min(1).max(4096),
});

router.post('/agent/internal', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const parsed = startThreadSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('escreva a mensagem e escolha o setor');

    const thread = await startThread(tenantId, userId, parsed.data);
    res.status(201).json({ id: thread.id });
  } catch (err) {
    next(err);
  }
});

router.get('/agent/internal/:id', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    res.json(await getThread(tenantId, userId, req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get('/agent/internal/:id/messages', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    res.json(await listInternalMessages(tenantId, userId, req.params.id));
  } catch (err) {
    next(err);
  }
});

const internalReplySchema = z.object({ body: z.string().trim().min(1).max(4096) });

router.post('/agent/internal/:id/messages', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const parsed = internalReplySchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('escreva a mensagem');

    await replyInternal(tenantId, userId, req.params.id, parsed.data.body);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/agent/internal/:id/close', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    await closeThread(tenantId, userId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Setores do hospital para quem atende — usado para escolher o destino do ramal
// interno. Aqui é a lista do TENANT porque quem pergunta é de dentro; a regra do
// link vale para o externo.
router.get('/agent/departments', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const [todos, meus] = await Promise.all([
      departments.listActive(tenantId),
      users.departmentIdsOf(tenantId, userId),
    ]);
    res.json(todos.map((d) => ({ id: d.id, name: d.name, mine: meus.includes(d.id) })));
  } catch (err) {
    next(err);
  }
});

// O cabeçalho do app mostra até quando vale o plantão de quem está logado.
router.get('/agent/shift', async (req, res, next) => {
  try {
    const { tenantId, userId, role } = req.auth!;
    if (role !== 'agent') {
      res.json(null);
      return;
    }
    const session = await shifts.findOpenSessionForUser(tenantId, userId);
    res.json(session ? { startedAt: session.startedAt, endsAt: session.endsAt } : null);
  } catch (err) {
    next(err);
  }
});

// "Meu plantão acabou": encerra a sessão e devolve as conversas para a fila.
router.post('/agent/shift/end', async (req, res, next) => {
  try {
    const { tenantId, userId, role } = req.auth!;
    if (role !== 'agent') throw new BadRequestError('somente atendentes têm plantão');

    const resultado = await endShift(tenantId, userId, 'manual');
    res.json({ ok: true, releasedConversations: resultado.releasedConversations });
  } catch (err) {
    next(err);
  }
});

const availabilitySchema = z.object({
  availability: z.enum(['available', 'away', 'offline']),
});

router.patch('/agent/availability', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('availability inválida');

    const result = await users.setAvailability(tenantId, userId, parsed.data.availability);
    if (result.count === 0) throw new NotFoundError();

    // agente que ficou disponível puxa a fila dos setores dele
    if (parsed.data.availability === 'available') {
      await assignPendingForUser(tenantId, userId);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
