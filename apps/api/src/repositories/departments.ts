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

// Só os ativos aparecem no menu do externo — é entre eles que o nome não pode repetir.
export function listActive(tenantId: string) {
  return prisma.department.findMany({
    where: { tenantId, active: true },
    select: { id: true, name: true },
  });
}

export async function update(
  tenantId: string,
  id: string,
  data: { name?: string; menuKey?: string; sortOrder?: number; active?: boolean }
): Promise<{ count: number }> {
  // updateMany com data vazio devolve count 0, e a rota traduziria isso em 404
  // para um setor que existe — mesmo contorno usado em users.update.
  if (Object.keys(data).length === 0) {
    return { count: await prisma.department.count({ where: { id, tenantId } }) };
  }
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
