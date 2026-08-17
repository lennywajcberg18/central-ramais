import { Prisma, ShiftEndReason } from '@prisma/client';
import { prisma } from '../prisma';

export interface ShiftInput {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export function listForUser(tenantId: string, userId: string) {
  return prisma.shift.findMany({
    where: { tenantId, userId, active: true },
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
  });
}

export function listForTenant(tenantId: string) {
  return prisma.shift.findMany({
    where: { tenantId, active: true },
    orderBy: [{ userId: 'asc' }, { weekday: 'asc' }, { startMinute: 'asc' }],
  });
}

// A escala é substituída inteira: editar faixa a faixa não vale a complexidade
// enquanto o painel manda a semana toda de uma vez.
export async function replaceForUser(
  tenantId: string,
  userId: string,
  entries: ShiftInput[]
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.shift.deleteMany({ where: { tenantId, userId } });
    if (entries.length > 0) {
      await tx.shift.createMany({
        data: entries.map((e) => ({ tenantId, userId, ...e })),
      });
    }
  });
}

export function updateSessionEnd(tenantId: string, id: string, endsAt: Date) {
  return prisma.shiftSession.updateMany({
    where: { id, tenantId, endedAt: null },
    data: { endsAt },
  });
}

// O userId entra no filtro junto com o id: a sessão é a credencial do plantão, e
// credencial se confere pelo dono, não só pela existência.
export function findOpenSessionById(tenantId: string, id: string, userId: string) {
  return prisma.shiftSession.findFirst({ where: { id, tenantId, userId, endedAt: null } });
}

export function findOpenSessionForUser(tenantId: string, userId: string) {
  return prisma.shiftSession.findFirst({
    where: { tenantId, userId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
}

// TODAS as sessões abertas da pessoa. Só a mais recente não basta quando a escala
// muda: uma sessão órfã de antes ficaria com a hora de saída antiga, e o job, ao
// fechar a certa, encontraria a órfã aberta e concluiria "o turno seguinte já
// começou" — deixando de devolver as conversas dela para a fila.
export function listOpenSessionsForUser(tenantId: string, userId: string) {
  return prisma.shiftSession.findMany({
    where: { tenantId, userId, endedAt: null },
    orderBy: { startedAt: 'asc' },
  });
}

export function createSession(tenantId: string, userId: string, endsAt: Date) {
  return prisma.shiftSession.create({ data: { tenantId, userId, endsAt } });
}

// Fecha UMA sessão, e só se ela continuar vencida. O `endsAt <= at` é a trava
// que impede o job de encerrar um plantão novo que nasceu depois da varredura.
export function closeExpiredSession(
  tenantId: string,
  id: string,
  at: Date,
  reason: ShiftEndReason,
  client: Prisma.TransactionClient = prisma
) {
  return client.shiftSession.updateMany({
    where: { id, tenantId, endedAt: null, endsAt: { lte: at } },
    data: { endedAt: new Date(), endReason: reason },
  });
}

export function closeSessionsOfUser(
  tenantId: string,
  userId: string,
  reason: ShiftEndReason,
  client: Prisma.TransactionClient = prisma
) {
  return client.shiftSession.updateMany({
    where: { tenantId, userId, endedAt: null },
    data: { endedAt: new Date(), endReason: reason },
  });
}

// Varrida do job: plantões abertos cujo horário já passou.
export function listExpiredSessions(tenantId: string, at: Date) {
  return prisma.shiftSession.findMany({
    where: { tenantId, endedAt: null, endsAt: { lte: at } },
  });
}

export function listOpenSessionsWithUser(tenantId: string) {
  return prisma.shiftSession.findMany({
    where: { tenantId, endedAt: null, endsAt: { gt: new Date() } },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          availability: true,
          departments: { select: { department: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { endsAt: 'asc' },
  });
}
