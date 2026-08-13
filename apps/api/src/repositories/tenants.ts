import { prisma } from '../prisma';

export function findById(id: string) {
  return prisma.tenant.findUnique({ where: { id } });
}

export function listIds() {
  return prisma.tenant.findMany({ select: { id: true } });
}
