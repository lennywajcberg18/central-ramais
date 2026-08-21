import { Prisma, ShiftEndReason, ShiftSession } from '@prisma/client';
import { prisma, LIMITES_DE_TRANSACAO } from '../prisma';
import * as conversations from '../repositories/conversations';
import * as shifts from '../repositories/shifts';
import * as tenants from '../repositories/tenants';
import * as users from '../repositories/users';
import { describeNextWindow, localNow, shiftEndsAt } from '../utils/shiftClock';
import { assignPendingForUser, tryAssign } from './routing.service';

// Teto de segurança: mesmo num plantão de 24h o token não vive mais que isto.
export const MAX_SHIFT_HOURS = 16;

export type OpenShiftResult =
  // `becameAvailable` diz se este login mudou a disponibilidade para "available":
  // sem isso a tela mostraria "fora do ar" para quem acabou de entrar de plantão.
  | { ok: true; session: ShiftSession; becameAvailable: boolean }
  | { ok: false; nextWindow: string | null; hasSchedule: boolean };

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

// Nem plantão de 24h mantém um token vivo o dia inteiro.
function capShiftEnd(fim: Date, at: Date): Date {
  const teto = new Date(at.getTime() + MAX_SHIFT_HOURS * 60 * 60_000);
  return fim < teto ? fim : teto;
}

// Põe o plantão de pé nos setores que a escala cobre agora.
//
// O teto de 16h vale por setor também, e ancorado no INÍCIO do plantão, igual ao
// da sessão: sem isso a cobertura de um setor sobreviveria ao token que a
// sustenta, e o rodízio entregaria conversa para quem já não consegue abrir a
// tela.
async function abrirCoberturasDaEscala(
  tenantId: string,
  shiftSessionId: string,
  porSetor: Map<string, Date>,
  inicioDoPlantao: Date
): Promise<void> {
  const setores = [...porSetor].map(([departmentId, fimDoSetor]) => ({
    departmentId,
    endsAt: capShiftEnd(fimDoSetor, inicioDoPlantao),
  }));
  if (setores.length > 0) {
    await shifts.abrirCoberturas(tenantId, shiftSessionId, setores);
  }
}

interface Cobertura {
  // até quando a escala cobre o instante pedido, POR SETOR; setor ausente do
  // mapa é setor que a escala não cobre agora
  porSetor: Map<string, Date>;
  // o mais tarde entre os setores — é o fim do plantão como um todo
  fim: Date | null;
  temEscala: boolean;
  proxima: string | null;
}

async function coberturaAtual(tenantId: string, userId: string, at: Date): Promise<Cobertura> {
  const escala = await shifts.listForUser(tenantId, userId);
  const tenant = await tenants.findById(tenantId);
  const timezone = tenant?.timezone || DEFAULT_TIMEZONE;

  // Setor a setor, e nunca a escala toda de uma vez. `minutesLeftInShift` funde
  // faixas que se encostam — é o que impede a escala 00:00–24:00 de deslogar a
  // pessoa toda meia-noite —, e entre setores diferentes essa fusão mente: CT
  // das 7h às 13h somado a Recepção das 13h às 19h daria "de plantão no CT até
  // as 19h". Agrupar antes de calcular é o que mantém a fusão onde ela ajuda e
  // a tira de onde ela atrapalha.
  const porEscala = new Map<string, typeof escala>();
  for (const faixa of escala) {
    const lista = porEscala.get(faixa.departmentId) ?? [];
    lista.push(faixa);
    porEscala.set(faixa.departmentId, lista);
  }

  const porSetor = new Map<string, Date>();
  for (const [departmentId, faixas] of porEscala) {
    const fimDoSetor = shiftEndsAt(faixas, timezone, at);
    if (fimDoSetor) porSetor.set(departmentId, fimDoSetor);
  }

  // O fim do PLANTÃO continua saindo da escala inteira, e não do maior fim por
  // setor. A diferença derruba gente no meio do turno: quem faz Cardiologia das
  // 7h às 13h e Recepção das 13h às 19h, entrando às 8h, tem só a Cardiologia
  // "acontecendo agora" — a faixa da Recepção ainda não começou e não aparece em
  // `porSetor`. O maior fim por setor daria 13h, o job encerraria o plantão no
  // meio do dia e devolveria para a fila até as conversas da Recepção.
  //
  // `minutesLeftInShift` sobre a escala toda enxerga a emenda: acha a faixa que
  // contém agora e estende enquanto houver outra começando até esse fim. É a
  // mesma extensão que impede a escala 00:00–24:00 de deslogar a pessoa toda
  // meia-noite — aqui ela sustenta a passagem de um setor para o outro.
  const fim = shiftEndsAt(escala, timezone, at);

  return {
    porSetor,
    fim,
    temEscala: escala.length > 0,
    // A próxima janela continua sendo da pessoa, não de um setor: quem foi
    // recusado quer saber quando volta a poder entrar, em qualquer setor.
    proxima: describeNextWindow(escala, localNow(timezone, at)),
  };
}

// Substitui a escala e ajusta o plantão em curso numa operação só — as duas
// coisas separadas é que abriam a janela.
export async function replaceSchedule(
  tenantId: string,
  userId: string,
  entries: shifts.ShiftInput[]
): Promise<void> {
  await shifts.replaceForUser(tenantId, userId, entries);
  await reevaluateShift(tenantId, userId);
}

// Chamada depois que o admin troca a escala. Escala nova pode ter tirado a
// pessoa do plantão (encerra) ou mudado a hora de saída (reajusta o fim).
//
// Devolve o resultado do encerramento quando encerrou, e null quando só
// reajustou ou não havia nada aberto. Quem chama precisa desse número: encerrar
// solta conversas, e a rota que só reportasse as que ela mesma soltou diria
// "nenhuma conversa devolvida" com duas de volta na fila.
export async function reevaluateShift(
  tenantId: string,
  userId: string
): Promise<EndShiftResult | null> {
  // TODAS as sessões abertas, não a mais recente: uma órfã deixada por um login
  // duplo de antes desta correção sobreviveria ao encurtamento de escala com a
  // hora de saída antiga.
  const abertas = await shifts.listOpenSessionsForUser(tenantId, userId);
  if (abertas.length === 0) return null;

  const { fim, porSetor } = await coberturaAtual(tenantId, userId, new Date());
  if (!fim) {
    return await endShift(tenantId, userId, 'admin');
  }
  for (const aberta of abertas) {
    // O teto conta do início do plantão, não do momento em que a escala foi
    // salva: ancorar em "agora" faria cada edição renovar as 16 horas, e o limite
    // de duração deixaria de existir para quem tem escala contínua.
    const novoFim = capShiftEnd(fim, aberta.startedAt);
    if (novoFim.getTime() !== aberta.endsAt.getTime()) {
      await shifts.updateSessionEnd(tenantId, aberta.id, novoFim);
    }

    // A cobertura acompanha a escala nova, setor a setor. Sem isto, salvar a
    // escala reajustaria só o fim do plantão inteiro e a pessoa continuaria
    // recebendo do setor de onde o admin acabou de tirá-la — até o turno acabar.
    const coberturas = await shifts.listCoberturasAbertas(tenantId, aberta.id);
    for (const cobertura of coberturas) {
      const fimDoSetor = porSetor.get(cobertura.departmentId);
      if (!fimDoSetor) {
        // Setor que a escala não cobre mais: fecha a cobertura e devolve para a
        // fila só as conversas DAQUELE setor — as dos outros setores dela
        // continuam em andamento.
        await encerrarCoberturaDeUmSetor(tenantId, aberta.id, cobertura.id, userId, cobertura.departmentId);
        continue;
      }
      const novoFimDoSetor = capShiftEnd(fimDoSetor, aberta.startedAt);
      if (novoFimDoSetor.getTime() !== cobertura.endsAt.getTime()) {
        await shifts.ajustarFimDaCobertura(tenantId, cobertura.id, novoFimDoSetor);
      }
    }

    // Escala nova pode ter ACRESCENTADO um setor.
    await abrirCoberturasDaEscala(tenantId, aberta.id, porSetor, aberta.startedAt);
  }
  return null;
}

// Tira o plantão de um setor só, deixando os outros de pé.
//
// As conversas devolvidas são as daquele setor — `releaseFromUser` solta todas
// as da pessoa, sem filtro, e usá-lo aqui devolveria para a fila conversas de um
// setor em que ela continua de plantão, com o externo recebendo aviso à toa.
async function encerrarCoberturaDeUmSetor(
  tenantId: string,
  shiftSessionId: string,
  coberturaId: string,
  userId: string,
  departmentId: string,
  // Só o job passa isto: é a trava que impede a varredura de encerrar uma
  // cobertura que o admin esticou entre a leitura e a escrita. Quem chega por
  // mudança de escala NÃO passa — ali o setor deixou de existir na escala, e a
  // cobertura tem que cair mesmo com hora futura.
  vencidaEm?: Date
): Promise<void> {
  const soltas = await prisma.$transaction(async (tx) => {
    // Mesma ordem de travas de todo caminho que encerra plantão: a linha do
    // usuário primeiro, sem escrever nela — é o que impede o ciclo ABBA com o
    // rodízio e com `endShift`. Ver o comentário longo em `expireDueShifts`.
    await tx.$queryRaw`
      SELECT 1 FROM users WHERE id = ${userId} AND tenant_id = ${tenantId} FOR UPDATE`;

    const fechada = await tx.shiftSessionDepartment.updateMany({
      where: {
        id: coberturaId,
        tenantId,
        shiftSessionId,
        endedAt: null,
        ...(vencidaEm ? { endsAt: { lte: vencidaEm } } : {}),
      },
      data: { endedAt: new Date() },
    });
    // Perdeu a corrida para o job ou para o botão, ou o admin esticou a escala
    // entre a varredura e esta escrita: quem fechou já soltou, e no caso do
    // esticão não há nada a soltar.
    if (fechada.count === 0) return [] as string[];

    const emAndamento = await conversations.listOpenAssignedToInDepartment(
      tenantId,
      userId,
      departmentId,
      tx
    );
    await conversations.releaseFromUserInDepartment(tenantId, userId, departmentId, tx);
    return emAndamento.map((c) => c.id);
  }, LIMITES_DE_TRANSACAO);

  // Fora da transação: reoferecer manda WhatsApp, e efeito externo não se desfaz.
  await reofferConversations(tenantId, soltas);
}

// Abre (ou reaproveita) o plantão do atendente. Reaproveitar importa: entrar
// pelo celular e pelo computador é a mesma pessoa no mesmo plantão, e encerrar
// num lugar tem que encerrar no outro.
// A garantia de "uma sessão aberta por atendente" mora no índice parcial
// `shift_sessions_uma_aberta_por_usuario`, e o `createSession` reaproveita a que
// já existe quando perde a corrida. Não há mais fila em memória aqui: ela valia
// dentro de um processo e sumia com o segundo.
export async function openShiftForUser(
  tenantId: string,
  userId: string
): Promise<OpenShiftResult> {
  const agora = new Date();

  const aberta = await shifts.findOpenSessionForUser(tenantId, userId);
  if (aberta && aberta.endsAt > agora) {
    // A sessão viva só vale enquanto a escala ainda cobrir agora: sem esta
    // conferência, apagar a escala de alguém não tiraria essa pessoa de lugar
    // nenhum enquanto o plantão dela estivesse aberto.
    const aindaCoberto = await coberturaAtual(tenantId, userId, agora);
    if (aindaCoberto.fim) {
      // Reconciliar a cobertura no relogin, e não só na criação: a escala pode
      // ter ganhado um setor desde que o plantão começou, e sem isto a pessoa
      // ficaria de plantão sem receber nada do setor novo até o turno seguinte.
      // `abrirCoberturas` ignora repetido pelo índice parcial, então reabrir o
      // que já está aberto não custa nada.
      await abrirCoberturasDaEscala(
        tenantId,
        aberta.id,
        aindaCoberto.porSetor,
        aberta.startedAt
      );
      return { ok: true, session: aberta, becameAvailable: false };
    }
    await endShift(tenantId, userId, 'admin');
    return { ok: false, hasSchedule: aindaCoberto.temEscala, nextWindow: aindaCoberto.proxima };
  }
  // Sessão aberta mas vencida: fecha aqui em vez de esperar o job, senão o
  // login recusaria por causa de um plantão que já devia ter terminado.
  if (aberta) {
    await endShift(tenantId, userId, 'schedule');
  }

  const { fim, porSetor, temEscala, proxima } = await coberturaAtual(tenantId, userId, agora);
  if (!fim) {
    return { ok: false, hasSchedule: temEscala, nextWindow: proxima };
  }

  const session = await shifts.createSession(tenantId, userId, capShiftEnd(fim, agora));
  await abrirCoberturasDaEscala(tenantId, session.id, porSetor, session.startedAt);

  // Reconferência DEPOIS de criar, e é ela que substitui a antiga fila em
  // memória. A escala foi lida antes desta linha; se o admin salvou uma escala
  // nova no meio, o `reevaluateShift` dele não encontrou sessão aberta para
  // ajustar (ela ainda não existia) e desistiu — a pessoa entrava de plantão com
  // uma escala que acabara de deixar de existir, e nada reavaliava aquela sessão
  // nunca mais. Aqui a ordem trabalha a favor: se o replaceForUser commitou antes
  // deste SELECT, ele aparece; se commitou depois, o reevaluateShift dele já
  // enxerga esta sessão e a ajusta. Um dos dois sempre pega.
  const aindaCoberto = await coberturaAtual(tenantId, userId, agora);
  if (!aindaCoberto.fim) {
    await endShift(tenantId, userId, 'admin');
    return { ok: false, hasSchedule: aindaCoberto.temEscala, nextWindow: aindaCoberto.proxima };
  }

  // Entrar de plantão é ficar disponível e puxar o que estiver esperando no
  // ramal. Só no plantão novo: quem recarregou a página estando "ausente"
  // continua ausente.
  await users.setAvailability(tenantId, userId, 'available');

  // A distribuição NÃO segura a resposta do login. Ela percorre a fila inteira
  // do setor uma conversa por vez, e na virada de turno (ou na volta de uma
  // queda) a fila é justamente o que está grande: com 100 conversas paradas o
  // POST /auth/login levava ~6,6 s. Nada no resultado do login depende dela — o
  // que não for distribuído continua `open`, à vista de todo mundo na fila do
  // setor, e o próximo evento de rodízio pega. Solto e com `catch` próprio,
  // também, para uma atribuição que falhe não rejeitar o login DEPOIS de a
  // sessão de plantão já existir e a disponibilidade já ser `available`.
  void assignPendingForUser(tenantId, userId).catch((err) => {
    console.error(`[shift] falha ao distribuir a fila para o usuário ${userId}:`, err);
  });

  return { ok: true, session, becameAvailable: true };
}

export interface EndShiftResult {
  closed: number;
  releasedConversations: number;
}

// Larga o que estava na mão da pessoa: devolve as conversas para a fila do ramal
// e diz quais eram. Só a escrita — reoferecer é a etapa seguinte, e depende de o
// plantão já estar fechado.
async function releaseUserWork(
  tenantId: string,
  userId: string,
  tx: Prisma.TransactionClient
): Promise<{ count: number; ids: string[] }> {
  // Lido ANTES do UPDATE: depois dele não há mais como saber quais conversas eram.
  const emAndamento = await conversations.listOpenAssignedTo(tenantId, userId, tx);
  const soltas = await conversations.releaseFromUser(tenantId, userId, tx);
  return { count: soltas.count, ids: emAndamento.map((c) => c.id) };
}

// O "um sai e o outro entra": reoferece a quem continua de plantão no mesmo setor.
// Fica fora da fase de escrita por duas razões. A sessão de quem saiu já tem que
// estar fechada, senão o rodízio devolve a conversa para a própria pessoa que está
// saindo. E uma falha aqui não pode derrubar o encerramento: a conversa já está
// `open` na fila do setor, à vista de todo mundo, e o próximo colega disponível a
// puxa — perder a reoferta atrasa, perder o encerramento deixa órfã.
//
// Exportada porque sair do plantão não é a única porta que larga conversas: o
// admin desativando um atendente e o admin tirando ele de um setor soltam as
// mesmas conversas e hoje não reoferecem nenhuma — elas ficam paradas em `open`
// (o job de inatividade não varre `open`) mesmo com um colega de plantão no
// mesmo setor. As rotas de admin passam a chamar isto, depois do commit.
export async function reofferConversations(tenantId: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await tryAssign(tenantId, id);
    } catch (err) {
      console.error(`[shift] falha ao reoferecer a conversa ${id}:`, err);
    }
  }
}

// Encerra o plantão da pessoa inteiro — usado quando é ela quem sai (botão) ou
// quando o login encontra uma sessão vencida. Aqui fechar todas as sessões
// abertas do usuário é o que se quer: sair no celular sai no computador também.
//
// A ordem é a garantia: soltar as conversas ANTES de gravar o fim. Na ordem
// inversa, um erro no release devolvia 500 com a sessão já encerrada — o
// middleware desloga o atendente e as conversas dele ficam `assigned` a um dono
// sem acesso, invisíveis na fila do setor E na tela de todo mundo. Falhar antes do
// `endedAt` só adia o fim do plantão, que o botão (ou o job) refaz.
export async function endShift(
  tenantId: string,
  userId: string,
  reason: ShiftEndReason
): Promise<EndShiftResult> {
  // Fechar a sessão e soltar as conversas na MESMA transação, porque as duas
  // ordens possíveis quebram uma coisa cada. Fechar antes e soltar depois: se o
  // release falha, a pessoa perde o acesso com as conversas presas nela, fora da
  // fila e fora da tela de todo mundo. Soltar antes e fechar depois: entre as duas
  // escritas ela ainda consta de plantão e disponível, e o rodízio devolve para ela
  // a conversa que acabou de ser solta — que é a corrida do cenário 9 do
  // check-corridas. Juntas, nenhuma das duas janelas existe: ou as duas valem, ou
  // nenhuma vale e o encerramento é tentado de novo.
  const { fechadas, soltas } = await prisma.$transaction(async (tx) => {
    // A disponibilidade vai PRIMEIRO: é o UPDATE nesta linha que o rodízio espera
    // no `FOR UPDATE` do `assignToIfOnShift`. Soltar antes de travar a linha
    // deixaria a atribuição concorrente entrar depois da varredura.
    //
    // E é também a regra de ordem de travas de todo caminho que encerra plantão:
    // a linha do usuário é travada ANTES de qualquer escrita em `shift_sessions`
    // ou `conversations`. `expireDueShifts` (com um `FOR UPDATE` explícito, porque
    // ele não pode escrever antes de saber o `count`), `users.deactivate` e
    // `users.update({active:false})` fazem o mesmo. Inverter em qualquer um deles
    // recria o deadlock 40P01 que derrubava o fim de plantão e o login na virada
    // de turno.
    await users.setAvailability(tenantId, userId, 'offline', tx);

    // As coberturas fecham ANTES das sessões: fechar a sessão primeiro deixaria,
    // entre as duas escritas, uma cobertura de pé apontando para um plantão que
    // já acabou — e é a cobertura, não a sessão, que o rodízio consulta. Dentro
    // da mesma transação a janela não existe, mas a ordem é a que faz sentido se
    // um dia alguém separar as duas.
    const abertas = await tx.shiftSession.findMany({
      where: { tenantId, userId, endedAt: null },
      select: { id: true },
    });
    for (const s of abertas) {
      await shifts.fecharCoberturasDaSessao(tenantId, s.id, tx);
    }

    const f = await shifts.closeSessionsOfUser(tenantId, userId, reason, tx);
    const s = await releaseUserWork(tenantId, userId, tx);
    return { fechadas: f, soltas: s };
  }, LIMITES_DE_TRANSACAO);

  // Fora da transação, de propósito: reoferecer manda mensagem de WhatsApp, e
  // efeito externo dentro de transação não tem como ser desfeito. Falhar aqui só
  // atrasa — a conversa já está `open` na fila do setor, à vista de todos.
  await reofferConversations(tenantId, soltas.ids);
  return { closed: fechadas.count, releasedConversations: soltas.count };
}

// Reabre a cobertura dos setores que a escala voltou a cobrir, para quem já está
// de plantão. É a contrapartida da varredura de coberturas vencidas: sem ela, a
// segunda faixa do dia no mesmo setor nunca acontece.
//
// Percorre as sessões ABERTAS, que são poucas por definição — é a gente que está
// de plantão neste minuto. `abrirCoberturas` ignora o que já está aberto (índice
// parcial `cobertura_aberta_unica`), então na imensa maioria dos minutos isto é
// uma leitura por pessoa e nenhuma escrita.
async function reabrirCoberturasRetomadas(tenantId: string, at: Date): Promise<void> {
  const abertas = await prisma.shiftSession.findMany({
    where: { tenantId, endedAt: null, endsAt: { gt: at } },
    select: { id: true, userId: true, startedAt: true },
  });

  for (const sessao of abertas) {
    const { porSetor } = await coberturaAtual(tenantId, sessao.userId, at);
    if (porSetor.size === 0) continue;
    await abrirCoberturasDaEscala(tenantId, sessao.id, porSetor, sessao.startedAt);
  }
}

// Varredura do job: fecha o que passou da hora, hospital por hospital.
//
// Duas camadas, nesta ordem. Primeiro as COBERTURAS vencidas — quem sai do CT ao
// meio-dia e meia mas continua na Recepção até as 19h perde só o CT, e só as
// conversas do CT voltam para a fila. Depois as SESSÕES vencidas, que é o fim do
// plantão inteiro. A ordem importa: encerrar a sessão primeiro fecharia todas as
// coberturas junto e a varredura de setor não teria mais o que devolver por
// setor — soltaria tudo de uma vez, com o externo do outro setor recebendo aviso
// de troca sem nada ter mudado para ele.
export async function expireDueShifts(at: Date = new Date()): Promise<number> {
  let encerrados = 0;
  const todos = await tenants.listIds();

  for (const tenant of todos) {
    const vencidasPorSetor = await shifts.listCoberturasVencidas(tenant.id, at);
    for (const cobertura of vencidasPorSetor) {
      // Sessão já encerrada leva as coberturas dela junto, na mesma transação —
      // se ainda houver linha aberta aqui, é resto de corrida e o `endShift`
      // seguinte limpa. Devolver conversa por causa dela seria devolver duas
      // vezes.
      if (cobertura.session.endedAt !== null) continue;
      try {
        await encerrarCoberturaDeUmSetor(
          tenant.id,
          cobertura.shiftSessionId,
          cobertura.id,
          cobertura.session.userId,
          cobertura.departmentId,
          at
        );
      } catch (err) {
        console.error(`[shift-job] falha ao encerrar a cobertura ${cobertura.id}:`, err);
      }
    }

    // E o outro lado: cobertura que a escala VOLTOU a cobrir.
    //
    // Escala partida é o caso normal — `MAX_FAIXAS_POR_DIA = 3` existe para
    // isso. Quem faz Cardiologia das 7h às 12h e de novo das 14h às 19h tem a
    // cobertura fechada ao meio-dia pela varredura acima, e sem esta parte nada
    // a reabre às 14h: a pessoa fica de plantão sem receber nada da Cardiologia
    // pelo resto do dia, com o painel mostrando o setor como "sem ninguém" e
    // ninguém entendendo por quê.
    //
    // Só ABRE. Fechar é da varredura anterior, que tem a trava do `endsAt` —
    // misturar as duas faria esta reabrir no mesmo minuto o que aquela fechou.
    try {
      await reabrirCoberturasRetomadas(tenant.id, at);
    } catch (err) {
      console.error(`[shift-job] falha ao reabrir coberturas do tenant ${tenant.id}:`, err);
    }

    const vencidas = await shifts.listExpiredSessions(tenant.id, at);
    for (const session of vencidas) {
      try {
        // Já abriu o plantão seguinte — ou o admin esticou este? Então há sessão
        // viva e não há nada a largar: quem entrou puxou a fila e continua com as
        // conversas dele, e derrubar quem acabou de entrar é o pior momento
        // possível — a troca de turno.
        const atual = await shifts.findOpenSessionForUser(tenant.id, session.userId);
        const temPlantaoVivo = atual !== null && atual.endsAt > at;

        // Fechar e soltar na MESMA transação, como o `endShift`. Aqui o fechamento
        // vem primeiro porque é dele que sai o `count`: a trava `endsAt <= at` do
        // repositório é o que impede o job de encerrar um plantão que o admin
        // esticou no meio do caminho, e nesse caso nada pode ser solto. Fora de
        // transação essa ordem seria o pior dos mundos — com o `endedAt` já
        // gravado, a sessão sai do `listExpiredSessions` (que filtra
        // `endedAt: null`), a varredura NUNCA retenta e as conversas ficam órfãs
        // para sempre, com uma linha de log como único sinal. Dentro dela, um erro
        // no release desfaz o fechamento junto: a sessão continua vencida e aberta
        // e a varredura do minuto seguinte tenta de novo.
        const { fechada, soltas } = await prisma.$transaction(async (tx) => {
          // A LINHA DO ATENDENTE PRIMEIRO, e sem escrever nela. Este `FOR UPDATE`
          // não guarda nenhuma regra de negócio: ele só põe esta transação na
          // mesma ordem de travas do `endShift` (users → shift_sessions →
          // conversations), que é a ordem que `users.deactivate` e
          // `users.update({active:false})` também seguem. Sem ele, esta varredura
          // trancava shift_sessions antes de users e o outro lado o contrário —
          // ciclo ABBA: o job varrendo a sessão vencida no mesmo instante em que a
          // pessoa clica em "meu plantão acabou", faz login com sessão vencida ou
          // o admin a desativa derrubava uma das duas com 40P01. A vítima era
          // quase sempre o atendente (500 no fim de plantão ou no login) e o
          // instante era o pior possível: a troca de turno.
          //
          // Travar sem escrever, e não adiantar o `setAvailability` para cá,
          // porque quem decide se há algo a soltar é o `count` do
          // `closeExpiredSession` logo abaixo: gravar `offline` antes marcaria
          // fora do ar justamente quem o admin acabou de esticar.
          await tx.$queryRaw`
            SELECT 1 FROM users
             WHERE id = ${session.userId} AND tenant_id = ${tenant.id}
               FOR UPDATE`;

          const f = await shifts.closeExpiredSession(tenant.id, session.id, at, 'schedule', tx);
          if (f.count === 0 || temPlantaoVivo) {
            return { fechada: f, soltas: { count: 0, ids: [] as string[] } };
          }
          await users.setAvailability(tenant.id, session.userId, 'offline', tx);
          const s = await releaseUserWork(tenant.id, session.userId, tx);
          return { fechada: f, soltas: s };
        }, LIMITES_DE_TRANSACAO);
        if (fechada.count > 0) encerrados++;

        // Depois do fim gravado, nunca antes. `count` zero significa que a escala
        // foi esticada na janela entre a conferência e o fechamento: a pessoa
        // segue de plantão e disponível, e é o próprio rodízio que devolve as
        // conversas para ela.
        await reofferConversations(tenant.id, soltas.ids);
      } catch (err) {
        console.error(`[shift-job] falha ao encerrar plantão ${session.id}:`, err);
      }
    }
  }
  return encerrados;
}
