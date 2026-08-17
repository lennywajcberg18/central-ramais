import { EntryLinkKind, Prisma } from '@prisma/client';
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

// Trava a linha do link até o fim da transação e roda `fn` com a posse dela.
//
// Por quê: a exclusividade do link nominal era garantida só por uma fila em
// memória, que vale por PROCESSO. Com duas instâncias — ou na janela de deploy em
// que a antiga ainda drena e a nova já atende — os dois lados liam "link livre" e
// os dois criavam vínculo. Depois disso o vínculo é a fonte de verdade: o número
// que entrou de carona fica autorizado para sempre e nenhum `nominal_taken` chega
// ao painel, que é justamente o alarme de link vazado. O `tenant_id` entra no
// WHERE como em toda query; link de outro hospital não trava nada aqui.
export function withLinkClaim<T>(
  tenantId: string,
  id: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM entry_links
       WHERE id = ${id} AND tenant_id = ${tenantId}
         FOR UPDATE`;
    return fn(tx);
  });
}

export function incrementUseCount(tenantId: string, id: string) {
  return prisma.entryLink.updateMany({
    where: { id, tenantId },
    data: { useCount: { increment: 1 } },
  });
}

// A lista de setores de um externo SEMPRE vem daqui — nunca de listDepartments(tenantId).
// `entryLink.active` no filtro porque link revogado não oferece setor nenhum: sem
// isso o encaminhamento de uma conversa aberta antes da revogação continuava
// listando destinos de um link que já não autoriza ninguém.
export async function listDepartmentsForLink(tenantId: string, entryLinkId: string) {
  const rows = await prisma.entryLinkDepartment.findMany({
    where: {
      entryLinkId,
      entryLink: { tenantId, active: true },
      department: { active: true, tenantId },
    },
    include: { department: true },
  });
  return rows
    .map((r) => r.department)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

// Links ativos que ficariam SEM NENHUM setor ativo se `departmentId` for
// desativado. Um link assim continua "ativo" na tela do admin, mas quem usa
// recebe "Nenhum setor disponível" — a desativação precisa ser recusada antes.
export function listActiveOrphanedByDepartment(tenantId: string, departmentId: string) {
  return prisma.entryLink.findMany({
    where: {
      tenantId,
      active: true,
      departments: { some: { departmentId } },
      NOT: {
        departments: {
          some: {
            departmentId: { not: departmentId },
            department: { tenantId, active: true },
          },
        },
      },
    },
    select: { id: true, label: true },
    orderBy: { createdAt: 'desc' },
  });
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
