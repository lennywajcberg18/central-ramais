import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export function findByWaNumber(tenantId: string, waNumber: string) {
  return prisma.externalContact.findUnique({
    where: { tenantId_waNumber: { tenantId, waNumber } },
  });
}

export function findById(tenantId: string, id: string) {
  return prisma.externalContact.findFirst({ where: { id, tenantId } });
}

// Link nominal aceita um número só — este é o contato que já ocupa o link.
// `client` existe para a leitura acontecer DENTRO da transação que travou a linha
// do link: fora dela, conferir e gravar voltam a ser dois passos separados.
export function findHolderOfLink(
  tenantId: string,
  entryLinkId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.externalContact.findFirst({
    where: { tenantId, entryLinkId },
    select: { id: true, waNumber: true },
  });
}

export function create(
  tenantId: string,
  input: { waNumber: string; entryLinkId: string },
  client: Prisma.TransactionClient = prisma
) {
  return client.externalContact.create({
    data: { tenantId, ...input },
  });
}

export function touchLastSeen(tenantId: string, id: string) {
  return prisma.externalContact.updateMany({
    where: { id, tenantId },
    data: { lastSeenAt: new Date() },
  });
}

export function list(tenantId: string) {
  return prisma.externalContact.findMany({
    where: { tenantId },
    include: { entryLink: { select: { id: true, label: true, kind: true, active: true } } },
    orderBy: { lastSeenAt: 'desc' },
  });
}

export function listByLink(tenantId: string, entryLinkId: string) {
  return prisma.externalContact.findMany({
    where: { tenantId, entryLinkId },
    orderBy: { firstSeenAt: 'asc' },
  });
}

export function setBlocked(tenantId: string, id: string, blocked: boolean) {
  return prisma.externalContact.updateMany({
    where: { id, tenantId },
    data: { blocked },
  });
}

export function reassignLink(
  tenantId: string,
  id: string,
  entryLinkId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.externalContact.updateMany({
    where: { id, tenantId },
    data: { entryLinkId },
  });
}

export function countByLink(tenantId: string) {
  return prisma.externalContact.groupBy({
    by: ['entryLinkId'],
    where: { tenantId },
    _count: { id: true },
  });
}
