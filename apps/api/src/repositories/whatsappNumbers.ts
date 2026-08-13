import { prisma } from '../prisma';

// Exceção consciente à regra do tenantId-primeiro: o webhook não tem sessão —
// o tenant é RESOLVIDO por esta consulta, pelo campo To (phone_number é único global).
export function findActiveByPhoneNumber(phoneNumber: string) {
  return prisma.whatsappNumber.findFirst({
    where: { phoneNumber, status: 'active' },
  });
}

export function findActiveForTenant(tenantId: string) {
  return prisma.whatsappNumber.findFirst({
    where: { tenantId, status: 'active' },
  });
}
