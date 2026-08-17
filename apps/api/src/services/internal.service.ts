import { InternalSide } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../errors';
import * as departments from '../repositories/departments';
import * as threads from '../repositories/internalThreads';
import * as users from '../repositories/users';

// Quem pode ver a conversa interna: quem está no setor que perguntou ou no que
// foi perguntado. Não é "quem criou" — o assunto é do ramal, não da pessoa.
async function assertPodeVer(tenantId: string, userId: string, threadId: string) {
  const thread = await threads.findById(tenantId, threadId);
  if (!thread) throw new NotFoundError();

  const meus = await users.departmentIdsOf(tenantId, userId);
  const participa =
    meus.includes(thread.fromDepartmentId) || meus.includes(thread.toDepartmentId);
  // 404 e não 403: quem não participa não recebe confirmação de que a conversa
  // existe, pela mesma razão que vale entre hospitais.
  if (!participa) throw new NotFoundError();

  return thread;
}

// De que lado da conversa esta pessoa está. Quem atende os DOIS setores conta
// como sendo do lado de origem — é de lá que ela abriu ou respondeu primeiro.
function ladoDe(meusDepartamentos: string[], fromDepartmentId: string): InternalSide {
  return meusDepartamentos.includes(fromDepartmentId) ? 'origin' : 'destination';
}

export async function listThreads(tenantId: string, userId: string) {
  const meus = await users.departmentIdsOf(tenantId, userId);
  if (meus.length === 0) return [];

  const rows = await threads.listForDepartments(tenantId, meus);
  return rows.map((t) => ({
    id: t.id,
    status: t.status,
    from: t.fromDepartment,
    to: t.toDepartment,
    // de quem é a vez de responder, do ponto de vista de quem está olhando
    mine: meus.includes(t.fromDepartmentId),
    lastMessage: t.messages[0]
      ? {
          body: t.messages[0].body,
          at: t.messages[0].createdAt,
          author: t.messages[0].user.name,
        }
      : null,
    lastMessageAt: t.lastMessageAt,
    createdAt: t.createdAt,
  }));
}

export interface StartThreadInput {
  fromDepartmentId: string;
  toDepartmentId: string;
  body: string;
}

export async function startThread(tenantId: string, userId: string, input: StartThreadInput) {
  if (input.fromDepartmentId === input.toDepartmentId) {
    throw new BadRequestError('escolha um setor diferente do seu');
  }

  // O remetente é um setor DE QUEM ESTÁ FALANDO: ninguém abre conversa em nome
  // de um ramal que não atende.
  const meus = await users.departmentIdsOf(tenantId, userId);
  if (!meus.includes(input.fromDepartmentId)) {
    throw new BadRequestError('você não atende este setor');
  }

  const destino = await departments.findById(tenantId, input.toDepartmentId);
  if (!destino || !destino.active) throw new NotFoundError('setor não encontrado');

  const thread = await threads.create(tenantId, {
    fromDepartmentId: input.fromDepartmentId,
    toDepartmentId: destino.id,
    createdByUserId: userId,
  });
  await threads.createMessage(tenantId, {
    threadId: thread.id,
    userId,
    senderSide: 'origin',
    body: input.body,
  });

  return thread;
}

export async function getThread(tenantId: string, userId: string, threadId: string) {
  const thread = await assertPodeVer(tenantId, userId, threadId);
  const meus = await users.departmentIdsOf(tenantId, userId);
  return {
    id: thread.id,
    status: thread.status,
    from: thread.fromDepartment,
    to: thread.toDepartment,
    // de qual lado está quem abriu a tela — o cabeçalho diz "para X" ou "de Y"
    mine: meus.includes(thread.fromDepartmentId),
  };
}

export async function listMessages(tenantId: string, userId: string, threadId: string) {
  const thread = await assertPodeVer(tenantId, userId, threadId);
  const meus = await users.departmentIdsOf(tenantId, userId);
  const meuLado = ladoDe(meus, thread.fromDepartmentId);

  const rows = await threads.listMessages(tenantId, threadId);
  return rows.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt,
    author: { id: m.user.id, name: m.user.name },
    // do lado do SETOR, não da pessoa: quem entra no plantão seguinte lê a
    // conversa do mesmo jeito que a colega que estava antes dele
    mine: m.senderSide === meuLado,
  }));
}

export async function reply(tenantId: string, userId: string, threadId: string, body: string) {
  const thread = await assertPodeVer(tenantId, userId, threadId);
  if (thread.status === 'closed') {
    throw new BadRequestError('esta conversa já foi encerrada');
  }

  const meus = await users.departmentIdsOf(tenantId, userId);
  const message = await threads.createMessage(tenantId, {
    threadId,
    userId,
    senderSide: ladoDe(meus, thread.fromDepartmentId),
    body,
  });
  await threads.touchLastMessage(tenantId, threadId);
  return message;
}

export async function closeThread(tenantId: string, userId: string, threadId: string) {
  const thread = await assertPodeVer(tenantId, userId, threadId);
  if (thread.status === 'closed') throw new BadRequestError('esta conversa já foi encerrada');

  const result = await threads.setStatus(tenantId, threadId, 'closed');
  if (result.count === 0) throw new NotFoundError();
}
