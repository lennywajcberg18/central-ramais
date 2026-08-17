import { Prisma, ShiftEndReason, ShiftSession } from '@prisma/client';
import { prisma } from '../prisma';
import * as conversations from '../repositories/conversations';
import * as shifts from '../repositories/shifts';
import * as tenants from '../repositories/tenants';
import * as users from '../repositories/users';
import { runSerialized } from '../utils/keyedQueue';
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

interface Cobertura {
  // até quando a escala cobre o instante pedido; null = não cobre
  fim: Date | null;
  temEscala: boolean;
  proxima: string | null;
}

async function coberturaAtual(tenantId: string, userId: string, at: Date): Promise<Cobertura> {
  const escala = await shifts.listForUser(tenantId, userId);
  const tenant = await tenants.findById(tenantId);
  const timezone = tenant?.timezone || DEFAULT_TIMEZONE;

  return {
    fim: shiftEndsAt(escala, timezone, at),
    temEscala: escala.length > 0,
    proxima: describeNextWindow(escala, localNow(timezone, at)),
  };
}

// Escala e sessão de plantão da mesma pessoa são um par: quem lê um para
// escrever o outro entra nesta fila. Sem ela, o login lia a escala velha e criava
// a sessão DEPOIS que o `reevaluateShift` do admin já tinha desistido por não
// achar sessão aberta — a pessoa entrava de plantão com uma escala que acabara de
// deixar de existir, e nada reavaliava aquela sessão nunca mais.
function shiftKey(tenantId: string, userId: string): string {
  return `shift:${tenantId}:${userId}`;
}

// Substitui a escala e ajusta o plantão em curso numa operação só — as duas
// coisas separadas é que abriam a janela.
export function replaceSchedule(
  tenantId: string,
  userId: string,
  entries: shifts.ShiftInput[]
): Promise<void> {
  return runSerialized(shiftKey(tenantId, userId), async () => {
    await shifts.replaceForUser(tenantId, userId, entries);
    await reevaluateShiftSemFila(tenantId, userId);
  });
}

// Chamada depois que o admin troca a escala. Escala nova pode ter tirado a
// pessoa do plantão (encerra) ou mudado a hora de saída (reajusta o fim).
export function reevaluateShift(tenantId: string, userId: string): Promise<void> {
  return runSerialized(shiftKey(tenantId, userId), () =>
    reevaluateShiftSemFila(tenantId, userId)
  );
}

// O corpo, já dentro da fila. Chamar direto de fora reabre a corrida.
async function reevaluateShiftSemFila(tenantId: string, userId: string): Promise<void> {
  // TODAS as sessões abertas, não a mais recente: uma órfã deixada por um login
  // duplo de antes desta correção sobreviveria ao encurtamento de escala com a
  // hora de saída antiga.
  const abertas = await shifts.listOpenSessionsForUser(tenantId, userId);
  if (abertas.length === 0) return;

  const { fim } = await coberturaAtual(tenantId, userId, new Date());
  if (!fim) {
    await endShift(tenantId, userId, 'admin');
    return;
  }
  for (const aberta of abertas) {
    // O teto conta do início do plantão, não do momento em que a escala foi
    // salva: ancorar em "agora" faria cada edição renovar as 16 horas, e o limite
    // de duração deixaria de existir para quem tem escala contínua.
    const novoFim = capShiftEnd(fim, aberta.startedAt);
    if (novoFim.getTime() !== aberta.endsAt.getTime()) {
      await shifts.updateSessionEnd(tenantId, aberta.id, novoFim);
    }
  }
}

// Abre (ou reaproveita) o plantão do atendente. Reaproveitar importa: entrar
// pelo celular e pelo computador é a mesma pessoa no mesmo plantão, e encerrar
// num lugar tem que encerrar no outro.
export function openShiftForUser(tenantId: string, userId: string): Promise<OpenShiftResult> {
  // Entrar pelo celular e pelo computador no mesmo instante — ou dar dois
  // cliques no botão — eram dois logins lendo "não tem plantão aberto" e criando
  // um cada. Duas sessões abertas fazem o job achar que o turno seguinte já
  // começou e não devolver as conversas de quem saiu.
  return runSerialized(shiftKey(tenantId, userId), () => openShiftSemFila(tenantId, userId));
}

async function openShiftSemFila(tenantId: string, userId: string): Promise<OpenShiftResult> {
  const agora = new Date();

  const aberta = await shifts.findOpenSessionForUser(tenantId, userId);
  if (aberta && aberta.endsAt > agora) {
    // A sessão viva só vale enquanto a escala ainda cobrir agora: sem esta
    // conferência, apagar a escala de alguém não tiraria essa pessoa de lugar
    // nenhum enquanto o plantão dela estivesse aberto.
    const aindaCoberto = await coberturaAtual(tenantId, userId, agora);
    if (aindaCoberto.fim) {
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

  const { fim, temEscala, proxima } = await coberturaAtual(tenantId, userId, agora);
  if (!fim) {
    return { ok: false, hasSchedule: temEscala, nextWindow: proxima };
  }

  const session = await shifts.createSession(tenantId, userId, capShiftEnd(fim, agora));

  // Entrar de plantão é ficar disponível e puxar o que estiver esperando no
  // ramal. Só no plantão novo: quem recarregou a página estando "ausente"
  // continua ausente.
  await users.setAvailability(tenantId, userId, 'available');
  await assignPendingForUser(tenantId, userId);

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
async function reofferConversations(tenantId: string, ids: string[]): Promise<void> {
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
    await users.setAvailability(tenantId, userId, 'offline', tx);
    const f = await shifts.closeSessionsOfUser(tenantId, userId, reason, tx);
    const s = await releaseUserWork(tenantId, userId, tx);
    return { fechadas: f, soltas: s };
  });

  // Fora da transação, de propósito: reoferecer manda mensagem de WhatsApp, e
  // efeito externo dentro de transação não tem como ser desfeito. Falhar aqui só
  // atrasa — a conversa já está `open` na fila do setor, à vista de todos.
  await reofferConversations(tenantId, soltas.ids);
  return { closed: fechadas.count, releasedConversations: soltas.count };
}

// Varredura do job: fecha o que passou da hora, hospital por hospital.
export async function expireDueShifts(at: Date = new Date()): Promise<number> {
  let encerrados = 0;
  const todos = await tenants.listIds();

  for (const tenant of todos) {
    const vencidas = await shifts.listExpiredSessions(tenant.id, at);
    for (const session of vencidas) {
      try {
        // Já abriu o plantão seguinte — ou o admin esticou este? Então há sessão
        // viva e não há nada a largar: quem entrou puxou a fila e continua com as
        // conversas dele, e derrubar quem acabou de entrar é o pior momento
        // possível — a troca de turno.
        const atual = await shifts.findOpenSessionForUser(tenant.id, session.userId);
        const temPlantaoVivo = atual !== null && atual.endsAt > at;

        // Soltar ANTES de gravar `endedAt`, pela mesma razão do `endShift` — só
        // que aqui o estrago era permanente: com o fim já gravado, a sessão sai do
        // `listExpiredSessions` (que filtra `endedAt: null`), a varredura NUNCA
        // retenta e as conversas ficam órfãs para sempre, com uma linha de log
        // como único sinal. Falhando antes, a mesma sessão volta na varredura do
        // minuto seguinte, e o release é idempotente.
        // Mesma transação do `endShift`, e pela mesma razão. Fecha primeiro para
        // ter o `count`: a trava `endsAt <= at` do repositório é o que impede o job
        // de encerrar um plantão que o admin esticou no meio do caminho, e nesse
        // caso nada pode ser solto. Se o release falhar, a transação inteira volta
        // atrás e a sessão continua vencida e aberta — a varredura do minuto
        // seguinte tenta de novo, em vez de deixar as conversas órfãs para sempre.
        const { fechada, soltas } = await prisma.$transaction(async (tx) => {
          const f = await shifts.closeExpiredSession(tenant.id, session.id, at, 'schedule', tx);
          if (f.count === 0 || temPlantaoVivo) {
            return { fechada: f, soltas: { count: 0, ids: [] as string[] } };
          }
          await users.setAvailability(tenant.id, session.userId, 'offline', tx);
          const s = await releaseUserWork(tenant.id, session.userId, tx);
          return { fechada: f, soltas: s };
        });
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
