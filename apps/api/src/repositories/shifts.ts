import { Prisma, ShiftEndReason } from '@prisma/client';
import { prisma } from '../prisma';

export interface ShiftInput {
  departmentId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export function listForUser(tenantId: string, userId: string) {
  return prisma.shift.findMany({
    where: { tenantId, userId, active: true },
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }, { departmentId: 'asc' }],
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
//
// "Inteira" continua sendo a pessoa TODA, todos os setores dela — e não um setor
// por vez. Apagar só o setor que veio no payload parece mais cirúrgico e é a
// armadilha: o editor mostraria a escala de um setor, o admin salvaria, e a
// escala da mesma pessoa nos outros setores sumiria em silêncio; ela só
// descobriria no próximo login, recusada com "fora do horário de plantão". Com
// o payload carregando todos os setores, o que está na tela é exatamente o que
// fica no banco.
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

// Cria a sessão de plantão, ou devolve a que já estava aberta. Entrar pelo
// celular e pelo computador no mesmo instante são dois logins lendo "não tem
// plantão aberto"; o índice parcial `shift_sessions_uma_aberta_por_usuario`
// derruba o segundo com P2002, e reaproveitar é exatamente o comportamento
// pedido — é a mesma pessoa no mesmo plantão, e encerrar num lugar encerra no
// outro.
export async function createSession(tenantId: string, userId: string, endsAt: Date) {
  try {
    return await prisma.shiftSession.create({ data: { tenantId, userId, endsAt } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const aberta = await findOpenSessionForUser(tenantId, userId);
      if (aberta) return aberta;
    }
    throw err;
  }
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


// ---------- cobertura: em quais setores o plantão está de pé ----------

// Põe o plantão de pé nos setores pedidos, cada um com a sua hora de sair.
//
// `skipDuplicates` porque o índice parcial `cobertura_aberta_unica` derruba a
// segunda linha aberta do mesmo (plantão, setor): dois logins simultâneos da
// mesma pessoa chegam aqui juntos, e a intenção dos dois é a mesma. Ignorar o
// repetido é o comportamento certo — errado seria contar a pessoa duas vezes no
// limite do setor e barrar um colega legítimo.
export function abrirCoberturas(
  tenantId: string,
  shiftSessionId: string,
  setores: Array<{ departmentId: string; endsAt: Date }>,
  client: Prisma.TransactionClient = prisma
) {
  return client.shiftSessionDepartment.createMany({
    data: setores.map((s) => ({ tenantId, shiftSessionId, ...s })),
    skipDuplicates: true,
  });
}

export function listCoberturasAbertas(
  tenantId: string,
  shiftSessionId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.shiftSessionDepartment.findMany({
    where: { tenantId, shiftSessionId, endedAt: null },
    orderBy: { endsAt: 'asc' },
  });
}


export function fecharCoberturasDaSessao(
  tenantId: string,
  shiftSessionId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.shiftSessionDepartment.updateMany({
    where: { tenantId, shiftSessionId, endedAt: null },
    data: { endedAt: new Date() },
  });
}

export function ajustarFimDaCobertura(
  tenantId: string,
  id: string,
  endsAt: Date,
  client: Prisma.TransactionClient = prisma
) {
  return client.shiftSessionDepartment.updateMany({
    where: { id, tenantId, endedAt: null },
    data: { endsAt },
  });
}

// Varredura do job: coberturas de pé cujo horário já passou, com o dono junto —
// é o `user_id` que diz de quem são as conversas a devolver naquele setor.
export function listCoberturasVencidas(tenantId: string, at: Date) {
  return prisma.shiftSessionDepartment.findMany({
    where: { tenantId, endedAt: null, endsAt: { lte: at } },
    include: { session: { select: { id: true, userId: true, endedAt: true } } },
  });
}

export interface CoberturaDeSetor {
  departmentId: string;
  name: string;
  pessoas: Array<{ userId: string; name: string; endsAt: Date }>;
}

// Quem está de plantão em cada setor agora.
//
// Devolve TODOS os setores ativos, inclusive os vazios — é o vazio que interessa
// ao aviso de setor descoberto, e uma consulta que parte das coberturas não traz
// linha nenhuma para o setor onde não há ninguém, que é justamente o que a tela
// precisa gritar.
export async function coberturaPorSetor(
  tenantId: string,
  at: Date = new Date()
): Promise<CoberturaDeSetor[]> {
  const setores = await prisma.department.findMany({
    where: { tenantId, active: true },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const coberturas = await prisma.shiftSessionDepartment.findMany({
    where: {
      tenantId,
      endedAt: null,
      endsAt: { gt: at },
      // Plantão encerrado com cobertura ainda aberta é resto de corrida (o
      // encerramento fecha as duas coisas na mesma transação). Contar essa
      // pessoa mostraria como coberto um setor onde já não há ninguém.
      session: { endedAt: null },
    },
    select: {
      departmentId: true,
      endsAt: true,
      session: { select: { userId: true, user: { select: { name: true } } } },
    },
    orderBy: { endsAt: 'asc' },
  });

  const porSetor = new Map<string, CoberturaDeSetor['pessoas']>();
  for (const c of coberturas) {
    const lista = porSetor.get(c.departmentId) ?? [];
    lista.push({ userId: c.session.userId, name: c.session.user.name, endsAt: c.endsAt });
    porSetor.set(c.departmentId, lista);
  }

  return setores.map((s) => ({
    departmentId: s.id,
    name: s.name,
    pessoas: porSetor.get(s.id) ?? [],
  }));
}
