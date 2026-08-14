import { ConversationStatus } from '@prisma/client';
import { prisma } from '../prisma';

// Visão do gestor: todas as conversas do hospital, inclusive as encerradas.
// A visão do atendente (conversations.ts) mostra só a fila dos setores dele e as
// atribuídas a ele — sem isto aqui, ninguém no hospital consegue reler um
// atendimento depois que ele termina.

export interface ListFilter {
  status?: ConversationStatus[];
  limit: number;
}

export function list(tenantId: string, filter: ListFilter) {
  return prisma.conversation.findMany({
    where: {
      tenantId,
      ...(filter.status ? { status: { in: filter.status } } : {}),
    },
    orderBy: { lastMessageAt: 'desc' },
    take: filter.limit,
    include: {
      department: { select: { name: true } },
      assignedUser: { select: { name: true } },
      externalContact: { select: { waNumber: true } },
      feedback: { select: { score: true } },
      _count: { select: { messages: true } },
    },
  });
}

export function findById(tenantId: string, id: string) {
  return prisma.conversation.findFirst({
    where: { id, tenantId },
    include: {
      department: { select: { name: true } },
      assignedUser: { select: { name: true } },
      externalContact: { select: { waNumber: true } },
      feedback: { select: { score: true, comment: true } },
    },
  });
}

export function listMessages(tenantId: string, conversationId: string) {
  return prisma.message.findMany({
    where: { conversationId, conversation: { tenantId } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, direction: true, senderType: true, body: true, createdAt: true },
  });
}
