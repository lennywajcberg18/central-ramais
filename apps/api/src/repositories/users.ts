import { Availability, Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { ACTIVE_STATUSES, releaseFromUser } from './conversations';

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

export function setAvailability(
  tenantId: string,
  id: string,
  availability: Availability,
  client: Prisma.TransactionClient = prisma
) {
  return client.user.updateMany({
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
export function availableAgentsForDepartment(
  tenantId: string,
  departmentId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.user.findMany({
    where: {
      tenantId,
      role: 'agent',
      active: true,
      availability: 'available',
      departments: { some: { departmentId } },
      // Plantão aberto E de pé NESTE setor. Só "sessão aberta" era o que ligava
      // a pessoa em todos os setores dela de uma vez; a cobertura é o que diz
      // onde ela está agora.
      //
      // A gêmea deste filtro está no SQL cru de `conversations.assignToIfOnShiftEm`,
      // que é a trava atômica da atribuição. Mudar um sem o outro não dá erro:
      // o UPDATE volta com count 0, `tryAssign` devolve false e a conversa fica
      // parada em `open` — o único estado que nenhum job varre.
      shiftSessions: {
        some: {
          endedAt: null,
          endsAt: { gt: new Date() },
          coberturas: { some: { departmentId, endedAt: null, endsAt: { gt: new Date() } } },
        },
      },
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
  // Quais conversas voltaram para a fila. Quem chamou reoferece cada uma com
  // `tryAssign` DEPOIS que a transação fecha: repositório não chama service, e a
  // atribuição faz efeito externo (abre conexão própria, avisa o externo) — o que
  // não pode acontecer dentro da transação. Sem a reoferta, o atendimento fica
  // parado em `open` mesmo com um colega de plantão no mesmo setor.
  releasedConversationIds: string[];
}

// Conversas ainda vivas na mão da pessoa. Lida dentro da transação, logo antes de
// soltá-las, porque depois do UPDATE não há mais como saber quais eram.
function idsEmAndamento(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  where: Prisma.ConversationWhereInput = {}
): Promise<{ id: string }[]> {
  return tx.conversation.findMany({
    where: { tenantId, assignedUserId: userId, status: { in: ACTIVE_STATUSES }, ...where },
    select: { id: true },
  });
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

// Fecha a cobertura por setor de TODOS os plantões abertos da pessoa.
//
// Mora aqui, e não no shift.service, porque quem desativa alguém está no meio de
// uma transação deste repositório e não pode chamar o serviço de volta — mas a
// regra é a mesma do `endShift`: cobertura não sobrevive ao plantão dela.
async function fecharCoberturasDoUsuario(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string
): Promise<void> {
  await tx.shiftSessionDepartment.updateMany({
    where: { tenantId, endedAt: null, session: { userId, endedAt: null } },
    data: { endedAt: new Date() },
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
    if (count === 0) return { count: 0, releasedConversations: 0, releasedConversationIds: [] };

    const liberadas: string[] = [];
    let released = 0;

    if (departmentIds) {
      await tx.userDepartment.deleteMany({ where: { userId: id, user: { tenantId } } });
      await tx.userDepartment.createMany({
        data: departmentIds.map((departmentId) => ({ userId: id, departmentId })),
      });

      // A escala do setor que ele deixou vai junto. Escala em setor de que a
      // pessoa não faz mais parte é escala que mente: ela apareceria escalada
      // para o CT no painel, entraria de plantão por causa dessa faixa e não
      // receberia chamado nenhum de lá, porque o rodízio exige o vínculo. Quem
      // devolver a pessoa ao setor cadastra a escala de novo — no mesmo lugar
      // em que refaz o vínculo.
      await tx.shift.deleteMany({
        where: { tenantId, userId: id, departmentId: { notIn: departmentIds } },
      });

      // Sair de um setor devolve para a fila o que ficou fora do novo escopo.
      // Sem isto a conversa continua com `assignedUserId` de quem saiu: some da
      // fila de quem ficou no setor, segue em "minhas conversas" de quem não
      // atende mais aquele ramal, e a resposta ainda diz que nada ficou pendurado.
      const foraDoNovoEscopo = { departmentId: { notIn: departmentIds } };
      const foraDoEscopo = await idsEmAndamento(tx, tenantId, id, foraDoNovoEscopo);
      const orfas = await tx.conversation.updateMany({
        where: {
          tenantId,
          assignedUserId: id,
          status: { in: ACTIVE_STATUSES },
          ...foraDoNovoEscopo,
        },
        data: { status: 'open', assignedUserId: null, assignedAt: null },
      });
      liberadas.push(...foraDoEscopo.map((c) => c.id));
      released += orfas.count;
    }

    if (data.active === false) {
      // Mesma trava do DELETE: desativar por aqui também tem que encerrar o
      // plantão, senão o painel segue mostrando como "de plantão agora" alguém
      // que perdeu o acesso — e a reativação devolveria a sessão antiga.
      //
      // A cobertura por setor cai junto. Fechar só a sessão deixa linhas abertas
      // apontando para um plantão morto: elas não servem a ninguém (toda
      // consulta exige a sessão aberta), mas a varredura do job as relê a cada
      // minuto para sempre, num conjunto que só cresce.
      await fecharCoberturasDoUsuario(tx, tenantId, id);
      await tx.shiftSession.updateMany({
        where: { tenantId, userId: id, endedAt: null },
        data: { endedAt: new Date(), endReason: 'admin' },
      });

      const emAndamento = await idsEmAndamento(tx, tenantId, id);
      released += (await releaseFromUser(tenantId, id, tx)).count;
      liberadas.push(...emAndamento.map((c) => c.id));
    }

    return { count, releasedConversations: released, releasedConversationIds: liberadas };
  });
}

export function deactivate(tenantId: string, id: string): Promise<WriteUserResult> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id, tenantId },
      data: { active: false, availability: 'offline' },
    });
    if (updated.count === 0) {
      return { count: 0, releasedConversations: 0, releasedConversationIds: [] };
    }

    // Desativar encerra o plantão junto: sessão aberta de quem não existe mais
    // continuaria contando como gente dentro do hospital. A cobertura por setor
    // fecha antes, pelo mesmo motivo do PATCH.
    await fecharCoberturasDoUsuario(tx, tenantId, id);
    await tx.shiftSession.updateMany({
      where: { tenantId, userId: id, endedAt: null },
      data: { endedAt: new Date(), endReason: 'admin' },
    });

    const emAndamento = await idsEmAndamento(tx, tenantId, id);
    const released = await releaseFromUser(tenantId, id, tx);
    return {
      count: updated.count,
      releasedConversations: released.count,
      releasedConversationIds: emAndamento.map((c) => c.id),
    };
  });
}
