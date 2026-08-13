import { AccessAttemptReason } from '@prisma/client';
import { prisma } from '../prisma';

// Toda recusa vira access_attempt — é o sinal de que um link nominal vazou.
export function create(
  tenantId: string,
  input: { waNumber: string; entryCodeTried?: string | null; reason: AccessAttemptReason }
) {
  return prisma.accessAttempt.create({
    data: {
      tenantId,
      waNumber: input.waNumber,
      entryCodeTried: input.entryCodeTried ?? null,
      reason: input.reason,
    },
  });
}

export function list(tenantId: string, from?: Date, to?: Date) {
  return prisma.accessAttempt.findMany({
    where: {
      tenantId,
      createdAt: { gte: from, lte: to },
    },
    orderBy: { createdAt: 'desc' },
  });
}
