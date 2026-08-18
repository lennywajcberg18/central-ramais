import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export function findByWaNumber(tenantId: string, waNumber: string) {
  return prisma.externalContact.findUnique({
    where: { tenantId_waNumber: { tenantId, waNumber } },
  });
}

export function findById(tenantId: string, id: string) {
  return prisma.externalContact.findFirst({ where: { id, tenantId } });
}

// Link nominal aceita um número só — este é o contato que já ocupa o link.
// `client` existe para a leitura acontecer DENTRO da transação que travou a linha
// do link: fora dela, conferir e gravar voltam a ser dois passos separados.
export function findHolderOfLink(
  tenantId: string,
  entryLinkId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.externalContact.findFirst({
    where: { tenantId, entryLinkId },
    select: { id: true, waNumber: true },
  });
}

// `client` existe para o caminho nominal criar o vínculo DENTRO da transação que
// travou a linha do link — ali a corrida já não existe e o create pode ser nu.
export function create(
  tenantId: string,
  input: { waNumber: string; entryLinkId: string },
  client: Prisma.TransactionClient = prisma
) {
  return client.externalContact.create({
    data: { tenantId, ...input },
  });
}

// Cria o contato do número ou devolve o que outra instância acabou de criar.
//
// A fila do webhook é por contato e vale por PROCESSO: duas mensagens do mesmo
// número novo, em instâncias diferentes, leem as duas "número desconhecido" e as
// duas inserem. Perder essa corrida não é erro — o índice único
// (tenant_id, wa_number) garante que existe UM contato e a perdedora segue nele.
// Sem esta guarda o create estoura, o webhook engole o erro e responde 200 ao
// Twilio (regra 6) e a mensagem some: sem conversa, sem access_attempt e sem
// reentrega.
//
// Sem `client` de propósito: no Postgres o P2002 aborta a transação em que
// acontece, e a releitura precisa de uma conexão viva.
export async function createOrGet(
  tenantId: string,
  input: { waNumber: string; entryLinkId: string }
) {
  try {
    return await prisma.externalContact.create({ data: { tenantId, ...input } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existente = await findByWaNumber(tenantId, input.waNumber);
      // Sem contato com este número o P2002 veio de outra constraint — não é esta corrida.
      if (existente) return existente;
    }
    throw err;
  }
}

export function touchLastSeen(tenantId: string, id: string) {
  return prisma.externalContact.updateMany({
    where: { id, tenantId },
    data: { lastSeenAt: new Date() },
  });
}

export function list(tenantId: string) {
  return prisma.externalContact.findMany({
    where: { tenantId },
    include: { entryLink: { select: { id: true, label: true, kind: true, active: true } } },
    orderBy: { lastSeenAt: 'desc' },
  });
}

export function listByLink(tenantId: string, entryLinkId: string) {
  return prisma.externalContact.findMany({
    where: { tenantId, entryLinkId },
    orderBy: { firstSeenAt: 'asc' },
  });
}

export function setBlocked(tenantId: string, id: string, blocked: boolean) {
  return prisma.externalContact.updateMany({
    where: { id, tenantId },
    data: { blocked },
  });
}

export function reassignLink(
  tenantId: string,
  id: string,
  entryLinkId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.externalContact.updateMany({
    where: { id, tenantId },
    data: { entryLinkId },
  });
}

export function countByLink(tenantId: string) {
  return prisma.externalContact.groupBy({
    by: ['entryLinkId'],
    where: { tenantId },
    _count: { id: true },
  });
}

// Consultado a cada envio. É uma ida ao banco por mensagem que sai, e vale: o
// alternativo era passar a informação por dezoito pontos de chamada, e uma trava
// que depende de dezoito lembretes já nasce quebrada.
export async function ehSimulado(tenantId: string, waNumber: string): Promise<boolean> {
  const c = await prisma.externalContact.findFirst({
    where: { tenantId, waNumber },
    select: { simulated: true },
  });
  return c?.simulated ?? false;
}

export function marcarComoSimulado(tenantId: string, id: string) {
  return prisma.externalContact.updateMany({
    where: { tenantId, id, simulated: false },
    data: { simulated: true },
  });
}
