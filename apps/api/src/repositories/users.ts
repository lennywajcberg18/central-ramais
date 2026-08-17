import { Availability, Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { releaseFromUser } from './conversations';

// Login não tem tenant ainda — email é único global e o tenant sai do usuário.
export function findActiveByEmail(email: string) {
  return prisma.user.findFirst({ where: { email, active: true } });
}

// Mesma razão: a unicidade do email é global, inclusive para desativados.
export async function emailTaken(email: string): Promise<boolean> {
  const found = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return found !== null;
}

// Checado a cada requisição autenticada: consulta enxuta, sem relações.
export async function isActive(tenantId: string, id: string): Promise<boolean> {
  const found = await prisma.user.findFirst({
    where: { id, tenantId, active: true },
    select: { id: true },
  });
  return found !== null;
}

export function findById(tenantId: string, id: string) {
  return prisma.user.findFirst({
    where: { id, tenantId },
    include: { departments: true },
  });
}

// O painel só existe enquanto sobrar um admin ativo para entrar nele.
export function countActiveAdmins(tenantId: string): Promise<number> {
  return prisma.user.count({ where: { tenantId, role: 'admin', active: true } });
}

export function list(tenantId: string) {
  return prisma.user.findMany({
    where: { tenantId },
    include: { departments: { include: { department: true } } },
    orderBy: { name: 'asc' },
  });
}

export function setAvailability(tenantId: string, id: string, availability: Availability) {
  return prisma.user.updateMany({
    where: { id, tenantId },
    data: { availability, lastSeenAt: new Date() },
  });
}

export async function departmentIdsOf(tenantId: string, userId: string): Promise<string[]> {
  const rows = await prisma.userDepartment.findMany({
    where: { userId, user: { tenantId } },
    select: { departmentId: true },
  });
  return rows.map((r) => r.departmentId);
}

// Quem recebe conversa do ramal: além de disponível, tem que estar de plantão.
// Sem esta condição, o chamado continuaria caindo para quem já foi para casa.
export function availableAgentsForDepartment(tenantId: string, departmentId: string) {
  return prisma.user.findMany({
    where: {
      tenantId,
      role: 'agent',
      active: true,
      availability: 'available',
      departments: { some: { departmentId } },
      shiftSessions: { some: { endedAt: null, endsAt: { gt: new Date() } } },
    },
  });
}

export interface CreateUserInput {
  role: Role;
  name: string;
  email: string;
  passwordHash: string;
  departmentIds?: string[];
}

export interface UpdateUserInput {
  name?: string;
  active?: boolean;
  departmentIds?: string[];
}

export interface WriteUserResult {
  count: number;
  releasedConversations: number;
}

export async function create(tenantId: string, input: CreateUserInput) {
  const { departmentIds = [], ...data } = input;
  return prisma.user.create({
    data: {
      tenantId,
      ...data,
      departments: { create: departmentIds.map((departmentId) => ({ departmentId })) },
    },
  });
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateUserInput
): Promise<WriteUserResult> {
  const { departmentIds, ...input_ } = input;
  // Desativar por aqui deixa a pessoa exatamente como o DELETE deixa: sem
  // acesso e fora do ar. Duas portas para a mesma coisa não podem divergir.
  const data =
    input_.active === false ? { ...input_, availability: Availability.offline } : input_;

  return prisma.$transaction(async (tx) => {
    // updateMany com data vazio devolve count 0, e a rota traduziria isso em 404.
    // Quando só os setores mudam, a existência é confirmada por um count próprio.
    const count =
      Object.keys(data).length > 0
        ? (await tx.user.updateMany({ where: { id, tenantId }, data })).count
        : await tx.user.count({ where: { id, tenantId } });
    if (count === 0) return { count: 0, releasedConversations: 0 };

    if (departmentIds) {
      await tx.userDepartment.deleteMany({ where: { userId: id, user: { tenantId } } });
      await tx.userDepartment.createMany({
        data: departmentIds.map((departmentId) => ({ userId: id, departmentId })),
      });
    }

    if (data.active === false) {
      // Mesma trava do DELETE: desativar por aqui também tem que encerrar o
      // plantão, senão o painel segue mostrando como "de plantão agora" alguém
      // que perdeu o acesso — e a reativação devolveria a sessão antiga.
      await tx.shiftSession.updateMany({
        where: { tenantId, userId: id, endedAt: null },
        data: { endedAt: new Date(), endReason: 'admin' },
      });
    }
    const released = data.active === false ? (await releaseFromUser(tenantId, id, tx)).count : 0;
    return { count, releasedConversations: released };
  });
}

export function deactivate(tenantId: string, id: string): Promise<WriteUserResult> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id, tenantId },
      data: { active: false, availability: 'offline' },
    });
    if (updated.count === 0) return { count: 0, releasedConversations: 0 };

    // Desativar encerra o plantão junto: sessão aberta de quem não existe mais
    // continuaria contando como gente dentro do hospital.
    await tx.shiftSession.updateMany({
      where: { tenantId, userId: id, endedAt: null },
      data: { endedAt: new Date(), endReason: 'admin' },
    });

    const released = await releaseFromUser(tenantId, id, tx);
    return { count: updated.count, releasedConversations: released.count };
  });
}
