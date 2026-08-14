import { Availability, Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { ACTIVE_STATUSES } from './conversations';

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

export function availableAgentsForDepartment(tenantId: string, departmentId: string) {
  return prisma.user.findMany({
    where: {
      tenantId,
      role: 'agent',
      active: true,
      availability: 'available',
      departments: { some: { departmentId } },
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

// Conversa presa num usuário inativo some das duas listas do app (a fila do
// setor e "as minhas"): o externo espera para sempre. Desativar tem que soltar.
function releaseConversations(tx: Prisma.TransactionClient, tenantId: string, userId: string) {
  return tx.conversation.updateMany({
    where: { tenantId, assignedUserId: userId, status: { in: ACTIVE_STATUSES } },
    // assignedAt volta a nulo porque o tempo de atribuição que vale é o de quem
    // assumir de fato depois — a conversa está de novo na fila, sem responsável.
    data: { status: 'open', assignedUserId: null, assignedAt: null },
  });
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateUserInput
): Promise<WriteUserResult> {
  const { departmentIds, ...data } = input;
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

    const released =
      data.active === false ? (await releaseConversations(tx, tenantId, id)).count : 0;
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

    const released = await releaseConversations(tx, tenantId, id);
    return { count: updated.count, releasedConversations: released.count };
  });
}
