import { InternalSide, InternalThreadStatus } from '@prisma/client';
import { prisma } from '../prisma';

const COM_SETORES = {
  fromDepartment: { select: { id: true, name: true } },
  toDepartment: { select: { id: true, name: true } },
} as const;

export interface CreateThreadInput {
  fromDepartmentId: string;
  toDepartmentId: string;
  createdByUserId: string;
}

export function create(tenantId: string, input: CreateThreadInput) {
  return prisma.internalThread.create({
    data: { tenantId, ...input },
    include: COM_SETORES,
  });
}

// A conversa interna é do RAMAL, não da pessoa: quem está no setor de origem ou
// no de destino enxerga. Um atendente que sai de plantão não leva o assunto com
// ele, e quem entra encontra a conversa em andamento.
export function listForDepartments(tenantId: string, departmentIds: string[]) {
  return prisma.internalThread.findMany({
    where: {
      tenantId,
      OR: [
        { fromDepartmentId: { in: departmentIds } },
        { toDepartmentId: { in: departmentIds } },
      ],
    },
    include: {
      ...COM_SETORES,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, createdAt: true, user: { select: { name: true } } },
      },
    },
    orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
    take: 100,
  });
}

export function findById(tenantId: string, id: string) {
  return prisma.internalThread.findFirst({
    where: { id, tenantId },
    include: COM_SETORES,
  });
}

export function touchLastMessage(tenantId: string, id: string) {
  return prisma.internalThread.updateMany({
    where: { id, tenantId },
    data: { lastMessageAt: new Date() },
  });
}

export function setStatus(tenantId: string, id: string, status: InternalThreadStatus) {
  return prisma.internalThread.updateMany({
    where: { id, tenantId },
    data: { status, closedAt: status === 'closed' ? new Date() : null },
  });
}

// As ÚLTIMAS mensagens, não as primeiras: numa conversa longa o limite pelo
// começo congelaria a tela no passado e a mensagem nova nunca apareceria.
export async function listMessages(tenantId: string, threadId: string) {
  const recentes = await prisma.internalMessage.findMany({
    where: { tenantId, threadId, thread: { tenantId } },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return recentes.reverse();
}

export interface CreateMessageInput {
  threadId: string;
  userId: string;
  senderSide: InternalSide;
  body: string;
}

export function createMessage(tenantId: string, input: CreateMessageInput) {
  return prisma.internalMessage.create({
    data: { tenantId, ...input },
    include: { user: { select: { id: true, name: true } } },
  });
}
