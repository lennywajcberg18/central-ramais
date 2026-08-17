import { ShiftEndReason, ShiftSession } from '@prisma/client';
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
// e as reoferece na hora a quem continua de plantão no mesmo setor.
// É o "um sai e o outro entra".
async function releaseUserWork(tenantId: string, userId: string): Promise<number> {
  const emAndamento = await conversations.listOpenAssignedTo(tenantId, userId);
  const soltas = await conversations.releaseFromUser(tenantId, userId);
  await users.setAvailability(tenantId, userId, 'offline');

  for (const conversation of emAndamento) {
    await tryAssign(tenantId, conversation.id);
  }
  return soltas.count;
}

// Encerra o plantão da pessoa inteiro — usado quando é ela quem sai (botão) ou
// quando o login encontra uma sessão vencida. Aqui fechar todas as sessões
// abertas do usuário é o que se quer: sair no celular sai no computador também.
export async function endShift(
  tenantId: string,
  userId: string,
  reason: ShiftEndReason
): Promise<EndShiftResult> {
  const fechadas = await shifts.closeSessionsOfUser(tenantId, userId, reason);
  const soltas = await releaseUserWork(tenantId, userId);
  return { closed: fechadas.count, releasedConversations: soltas };
}

// Varredura do job: fecha o que passou da hora, hospital por hospital.
export async function expireDueShifts(at: Date = new Date()): Promise<number> {
  let encerrados = 0;
  const todos = await tenants.listIds();

  for (const tenant of todos) {
    const vencidas = await shifts.listExpiredSessions(tenant.id, at);
    for (const session of vencidas) {
      try {
        // Fecha a sessão vencida, não "as sessões daquela pessoa": entre a
        // varredura e esta linha o turno seguinte pode ter começado, e derrubar
        // quem acabou de entrar é o pior momento possível — a troca de turno.
        const fechada = await shifts.closeExpiredSession(tenant.id, session.id, at, 'schedule');
        if (fechada.count === 0) continue;

        // Já abriu o plantão seguinte? Então não há nada a largar: quem entrou
        // puxou a fila e continua com as conversas dele.
        const atual = await shifts.findOpenSessionForUser(tenant.id, session.userId);
        if (atual && atual.endsAt > at) {
          encerrados++;
          continue;
        }

        await releaseUserWork(tenant.id, session.userId);
        encerrados++;
      } catch (err) {
        console.error(`[shift-job] falha ao encerrar plantão ${session.id}:`, err);
      }
    }
  }
  return encerrados;
}
