import { Availability, Role } from '@prisma/client';
import { prisma } from '../prisma';

// Login não tem tenant ainda — email é único global e o tenant sai do usuário.
export function findActiveByEmail(email: string) {
  return prisma.user.findFirst({ where: { email, active: true } });
}

export function findById(tenantId: string, id: string) {
  return prisma.user.findFirst({
    where: { id, tenantId },
    include: { departments: true },
  });
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

export interface UpsertUserInput {
  role: Role;
  name: string;
  email: string;
  passwordHash?: string;
  active?: boolean;
  departmentIds?: string[];
}

export async function create(tenantId: string, input: UpsertUserInput & { passwordHash: string }) {
  const { departmentIds = [], ...data } = input;
  return prisma.user.create({
    data: {
      tenantId,
      ...data,
      departments: { create: departmentIds.map((departmentId) => ({ departmentId })) },
    },
  });
}

export async function update(tenantId: string, id: string, input: UpsertUserInput) {
  const { departmentIds, ...data } = input;
  const result = await prisma.user.updateMany({ where: { id, tenantId }, data });
  if (result.count > 0 && departmentIds) {
    await prisma.userDepartment.deleteMany({ where: { userId: id } });
    await prisma.userDepartment.createMany({
      data: departmentIds.map((departmentId) => ({ userId: id, departmentId })),
    });
  }
  return result;
}

export function deactivate(tenantId: string, id: string) {
  return prisma.user.updateMany({
    where: { id, tenantId },
    data: { active: false, availability: 'offline' },
  });
}
