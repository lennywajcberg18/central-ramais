import { prisma } from '../prisma';

export function list(tenantId: string) {
  return prisma.department.findMany({
    where: { tenantId },
    orderBy: { sortOrder: 'asc' },
  });
}

export function findById(tenantId: string, id: string) {
  return prisma.department.findFirst({ where: { id, tenantId } });
}

// valida que os ids pertencem ao tenant — nunca confie em ids vindos do body
export function findManyByIds(tenantId: string, ids: string[]) {
  return prisma.department.findMany({ where: { tenantId, id: { in: ids } } });
}

export function create(
  tenantId: string,
  input: { name: string; menuKey: string; sortOrder: number; active?: boolean }
) {
  return prisma.department.create({ data: { tenantId, ...input } });
}

export function update(
  tenantId: string,
  id: string,
  data: { name?: string; menuKey?: string; sortOrder?: number; active?: boolean }
) {
  return prisma.department.updateMany({ where: { id, tenantId }, data });
}

export async function nextMenuKey(tenantId: string): Promise<string> {
  const rows = await prisma.department.findMany({
    where: { tenantId },
    select: { menuKey: true },
  });
  const used = new Set(rows.map((r) => r.menuKey));
  let key = 1;
  while (used.has(String(key))) key++;
  return String(key);
}
