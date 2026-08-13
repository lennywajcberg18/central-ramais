import { EntryLinkKind } from '@prisma/client';
import { prisma } from '../prisma';

// slug é único global por design — a rota pública /c/:slug não tem tenant.
export function findBySlug(slug: string) {
  return prisma.entryLink.findUnique({ where: { slug } });
}

export function findByCode(tenantId: string, entryCode: string) {
  return prisma.entryLink.findUnique({
    where: { tenantId_entryCode: { tenantId, entryCode } },
  });
}

export function findById(tenantId: string, id: string) {
  return prisma.entryLink.findFirst({ where: { id, tenantId } });
}

export function incrementUseCount(tenantId: string, id: string) {
  return prisma.entryLink.updateMany({
    where: { id, tenantId },
    data: { useCount: { increment: 1 } },
  });
}

// A lista de setores de um externo SEMPRE vem daqui — nunca de listDepartments(tenantId).
export async function listDepartmentsForLink(tenantId: string, entryLinkId: string) {
  const rows = await prisma.entryLinkDepartment.findMany({
    where: {
      entryLinkId,
      entryLink: { tenantId },
      department: { active: true, tenantId },
    },
    include: { department: true },
  });
  return rows
    .map((r) => r.department)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function list(tenantId: string) {
  return prisma.entryLink.findMany({
    where: { tenantId },
    include: { departments: { include: { department: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export interface CreateEntryLinkInput {
  slug: string;
  entryCode: string;
  kind: EntryLinkKind;
  label: string;
  holderNote?: string;
  prefillText: string;
  createdByUserId: string;
  departmentIds: string[];
}

export function create(tenantId: string, input: CreateEntryLinkInput) {
  const { departmentIds, ...data } = input;
  return prisma.entryLink.create({
    data: {
      ...data,
      tenantId,
      departments: {
        create: departmentIds.map((departmentId) => ({ departmentId })),
      },
    },
    include: { departments: { include: { department: true } } },
  });
}

export function revoke(tenantId: string, id: string, revokedByUserId: string) {
  return prisma.entryLink.updateMany({
    where: { id, tenantId, active: true },
    data: { active: false, revokedAt: new Date(), revokedByUserId },
  });
}
