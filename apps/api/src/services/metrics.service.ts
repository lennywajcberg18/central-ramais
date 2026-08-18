import * as accessAttempts from '../repositories/accessAttempts';
import * as conversations from '../repositories/conversations';
import * as externalContacts from '../repositories/externalContacts';
import * as tenants from '../repositories/tenants';

const SLA_TARGET_MS = 5 * 60 * 1000; // fixo no MVP: FRT < 5 min

function avgMinutes(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round((avg / 60000) * 10) / 10;
}

export async function computeMetrics(
  tenantId: string,
  from: Date,
  to: Date,
  departmentId?: string
) {
  const rows = await conversations.listForMetrics(tenantId, from, to, departmentId);

  const frts = rows
    .filter((c) => c.firstReplyAt)
    .map((c) => c.firstReplyAt!.getTime() - c.createdAt.getTime());
  const assigns = rows
    .filter((c) => c.firstAssignedAt)
    .map((c) => c.firstAssignedAt!.getTime() - c.createdAt.getTime());
  const resolutions = rows
    .filter((c) => c.closedAt)
    .map((c) => c.closedAt!.getTime() - c.createdAt.getTime());

  const closed = rows.filter((c) => c.closedAt);
  const scored = rows.filter((c) => c.feedback?.score != null);
  const timeouts = closed.filter((c) => c.closeReason === 'timeout');

  // SLA é "% das conversas do período com FRT < 5 min". Conversa que encerrou sem
  // NENHUMA resposta é violação, não ausência de dado: contando só quem foi
  // respondido, a madrugada em que 90 de 100 pessoas foram ignoradas exibia 100%
  // ao lado de "Encerradas sozinhas: 90%". Quem ainda está em curso e sem resposta
  // fica de fora — o prazo dessa conversa não terminou.
  const comPrazoVencido = rows.filter((c) => c.firstReplyAt || c.closedAt);
  const dentroDoPrazo = comPrazoVencido.filter(
    (c) => c.firstReplyAt && c.firstReplyAt.getTime() - c.createdAt.getTime() < SLA_TARGET_MS
  );

  // Só entra na conta de "quantos avaliaram" quem chegou a ser perguntado. O CSAT
  // depende do tenant e só é pedido quando houve atendimento de verdade
  // (`firstReplyAt`); encerramento por corte de acesso ou por falta de atendente
  // nunca pergunta. Sem isso a taxa punia o hospital por silêncios que o próprio
  // sistema decidiu não pedir.
  const tenant = await tenants.findById(tenantId);
  const perguntados = tenant?.csatEnabled
    ? closed.filter(
        (c) =>
          c.firstReplyAt !== null &&
          c.closeReason !== 'access_revoked' &&
          c.closeReason !== 'no_agent_available'
      )
    : [];

  const byDepartment = new Map<string, { name: string; volume: number }>();
  for (const c of rows) {
    if (!c.department) continue;
    const entry = byDepartment.get(c.department.id) ?? { name: c.department.name, volume: 0 };
    entry.volume++;
    byDepartment.set(c.department.id, entry);
  }

  const byLink = new Map<string, { label: string; volume: number }>();
  for (const c of rows) {
    const entry = byLink.get(c.entryLinkId) ?? { label: c.entryLinkLabelSnapshot, volume: 0 };
    entry.volume++;
    byLink.set(c.entryLinkId, entry);
  }

  // contatos vinculados por link (independe do período de conversas)
  const contactCounts = await externalContacts.countByLink(tenantId);
  const contactsByLink = new Map(contactCounts.map((r) => [r.entryLinkId, r._count.id]));

  const byKind = { profile: 0, nominal: 0 };
  for (const c of rows) {
    byKind[c.entryLink.kind]++;
  }

  // A recusa de acesso acontece ANTES de existir escolha de setor: access_attempts
  // não tem department_id e não há como derivar um. Com filtro de setor na tela,
  // devolver o total do hospital misturaria escopos (o número não cai junto com
  // os outros cards), então o bloco vem vazio e `attemptsScope` explica por quê.
  const attemptsByReason: Record<string, number> = {};
  if (!departmentId) {
    const attempts = await accessAttempts.list(tenantId, from, to);
    for (const a of attempts) {
      attemptsByReason[a.reason] = (attemptsByReason[a.reason] ?? 0) + 1;
    }
  }

  return {
    volume: rows.length,
    frtAvgMinutes: avgMinutes(frts),
    assignAvgMinutes: avgMinutes(assigns),
    resolutionAvgMinutes: avgMinutes(resolutions),
    slaPct:
      comPrazoVencido.length > 0
        ? Math.round((dentroDoPrazo.length / comPrazoVencido.length) * 100)
        : null,
    // A outra leitura, para quem quer separar "atendemos devagar" de "não
    // atendemos": entre as que RECEBERAM resposta, quantas vieram em 5 min.
    slaPctEntreRespondidas:
      frts.length > 0
        ? Math.round((frts.filter((ms) => ms < SLA_TARGET_MS).length / frts.length) * 100)
        : null,
    csatAvg:
      scored.length > 0
        ? Math.round(
            (scored.reduce((sum, c) => sum + (c.feedback!.score ?? 0), 0) / scored.length) * 10
          ) / 10
        : null,
    csatResponseRate:
      perguntados.length > 0 ? Math.round((scored.length / perguntados.length) * 100) : null,
    abandonmentPct:
      closed.length > 0 ? Math.round((timeouts.length / closed.length) * 100) : null,
    byDepartment: [...byDepartment.entries()].map(([id, v]) => ({ departmentId: id, ...v })),
    byLink: [...byLink.entries()].map(([id, v]) => ({
      entryLinkId: id,
      ...v,
      contacts: contactsByLink.get(id) ?? 0,
    })),
    byKind,
    attemptsByReason,
    attemptsScope: departmentId ? 'nao_se_aplica_por_setor' : 'hospital',
  };
}
