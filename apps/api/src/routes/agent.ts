import { Router } from 'express';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../errors';
import { requireAuth } from '../middleware/auth';
import * as conversations from '../repositories/conversations';
import * as messagesRepo from '../repositories/messages';
import * as users from '../repositories/users';
import { closeFromAgent } from '../services/lifecycle.service';
import { sendConversationMessage } from '../services/messaging.service';
import { assignPendingForUser } from '../services/routing.service';

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
    const { tenantId } = req.auth!;
    const conversation = await conversations.findById(tenantId, req.params.id);
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

    const conversation = await conversations.findByIdWithRelations(tenantId, req.params.id);
    if (!conversation) throw new NotFoundError();
    if (conversation.status === 'closed' || conversation.status === 'awaiting_feedback') {
      throw new BadRequestError('conversa encerrada');
    }
    // Número bloqueado não pode receber resposta do hospital — o bloqueio
    // encerra a conversa, mas uma anterior ao bloqueio ainda pode estar aberta.
    if (conversation.externalContact.blocked) {
      throw new BadRequestError('este contato está bloqueado; desbloqueie antes de responder');
    }

    // agente respondendo conversa da fila assume o atendimento
    if (conversation.status === 'open') {
      await conversations.update(tenantId, conversation.id, {
        status: 'assigned',
        assignedUserId: userId,
        assignedAt: new Date(),
      });
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
    const { tenantId } = req.auth!;
    const conversation = await conversations.findByIdWithRelations(tenantId, req.params.id);
    if (!conversation) throw new NotFoundError();
    if (conversation.status === 'closed') throw new BadRequestError('conversa já encerrada');

    await closeFromAgent(tenantId, conversation.id);
    res.json({ ok: true });
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
