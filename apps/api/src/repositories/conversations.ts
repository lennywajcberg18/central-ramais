import { CloseReason, ConversationStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma';

// Estados que bloqueiam abrir outra conversa (awaiting_feedback NÃO bloqueia)
export const ACTIVE_STATUSES: ConversationStatus[] = [
  'awaiting_department',
  'open',
  'assigned',
  'awaiting_menu_confirm',
];

export function findActiveByContact(tenantId: string, externalContactId: string) {
  return prisma.conversation.findFirst({
    where: { tenantId, externalContactId, status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: 'desc' },
  });
}

export function findLatestAwaitingFeedback(tenantId: string, externalContactId: string) {
  return prisma.conversation.findFirst({
    where: { tenantId, externalContactId, status: 'awaiting_feedback' },
    orderBy: { closedAt: 'desc' },
    include: { feedback: true },
  });
}

export interface CreateConversationInput {
  whatsappNumberId: string;
  externalContactId: string;
  entryLinkId: string;
  entryLinkLabelSnapshot: string;
  status: ConversationStatus;
  departmentId?: string;
}

export function create(tenantId: string, input: CreateConversationInput) {
  return prisma.conversation.create({
    data: { tenantId, ...input },
  });
}

export function findById(tenantId: string, id: string) {
  return prisma.conversation.findFirst({ where: { id, tenantId } });
}

// updateMany com tenantId + checagem de count no chamador: zero → 404
export function update(tenantId: string, id: string, data: Prisma.ConversationUncheckedUpdateManyInput) {
  return prisma.conversation.updateMany({ where: { id, tenantId }, data });
}

export function touchLastMessage(tenantId: string, id: string) {
  return update(tenantId, id, { lastMessageAt: new Date() });
}

export function closeFields(reason: CloseReason, status: ConversationStatus) {
  return { status, closeReason: reason, closedAt: new Date() };
}

export function listOpenForDepartments(tenantId: string, departmentIds: string[]) {
  return prisma.conversation.findMany({
    where: { tenantId, status: 'open', departmentId: { in: departmentIds } },
    orderBy: { createdAt: 'asc' },
  });
}

// Visão do agente: minhas conversas + fila dos meus setores
export function listForAgentView(tenantId: string, userId: string, departmentIds: string[]) {
  return prisma.conversation.findMany({
    where: {
      tenantId,
      OR: [
        { assignedUserId: userId, status: { in: ACTIVE_STATUSES } },
        { status: 'open', departmentId: { in: departmentIds } },
      ],
    },
    include: {
      department: { select: { id: true, name: true } },
      externalContact: { select: { id: true, waNumber: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
  });
}

export function findByIdWithRelations(tenantId: string, id: string) {
  return prisma.conversation.findFirst({
    where: { id, tenantId },
    include: {
      department: { select: { id: true, name: true } },
      externalContact: true,
      whatsappNumber: true,
    },
  });
}

// first_reply_at é write-once: só grava se ainda estiver nulo
export function markFirstReplyOnce(tenantId: string, id: string) {
  return prisma.conversation.updateMany({
    where: { id, tenantId, firstReplyAt: null },
    data: { firstReplyAt: new Date() },
  });
}

// Job de timeout: estados ativos parados há mais de 30 min.
// Espelha o WHERE do PROJETO.md — awaiting_feedback e open (fila) ficam de fora.
export function listStaleForTimeout(tenantId: string, cutoff: Date) {
  return prisma.conversation.findMany({
    where: {
      tenantId,
      status: { in: ['assigned', 'awaiting_department', 'awaiting_menu_confirm'] },
      lastMessageAt: { lt: cutoff },
    },
  });
}

export function listForMetrics(tenantId: string, from: Date, to: Date, departmentId?: string) {
  return prisma.conversation.findMany({
    where: {
      tenantId,
      createdAt: { gte: from, lte: to },
      ...(departmentId ? { departmentId } : {}),
    },
    include: {
      feedback: true,
      entryLink: { select: { id: true, kind: true } },
      department: { select: { id: true, name: true } },
    },
  });
}
