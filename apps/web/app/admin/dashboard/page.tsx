'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ATTEMPT_REASON, type Tone } from '@/lib/labels';
import {
  Badge,
  Button,
  EmptyState,
  ExplainCard,
  Field,
  PageHeader,
  Panel,
  Skeleton,
  inputClass,
} from '@/components/ui';

interface Metrics {
  volume: number;
  frtAvgMinutes: number | null;
  assignAvgMinutes: number | null;
  resolutionAvgMinutes: number | null;
  slaPct: number | null;
  // A outra leitura do SLA: entre as conversas que RECEBERAM resposta. O número
  // grande da tela é o total (quem encerrou sem resposta conta contra a meta) —
  // este fica na explicação, para separar "atendemos devagar" de "não atendemos".
  slaPctEntreRespondidas: number | null;
  csatAvg: number | null;
  csatResponseRate: number | null;
  abandonmentPct: number | null;
  byDepartment: { departmentId: string; name: string; volume: number }[];
  byLink: { entryLinkId: string; label: string; volume: number; contacts: number }[];
  byKind: { profile: number; nominal: number };
  attemptsByReason: Record<string, number>;
  // A recusa de acesso acontece antes de existir setor, então com filtro de
  // setor a API devolve o bloco vazio. Sem este campo a tela leria o vazio como
  // "nenhuma recusa" e o alerta de link vazado sumiria sem ninguém notar.
  attemptsScope?: 'hospital' | 'nao_se_aplica_por_setor';
}

type Leitura = { tone: Tone; texto: string };

// toISOString devolve UTC: à noite no Brasil isso adianta a data em um dia.
function isoLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function diasAtras(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return isoLocal(d);
}

function porExtenso(iso: string): string {
  const [ano, mes, dia] = iso.split('-').map(Number);
  if (!ano || !mes || !dia) return iso;
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' }).format(
    new Date(ano, mes - 1, dia)
  );
}

function num(v: number): string {
  return v.toLocaleString('pt-BR');
}

const ATALHOS = [
  { rotulo: 'Hoje', dias: 0 },
  { rotulo: '7 dias', dias: 6 },
  { rotulo: '30 dias', dias: 29 },
];

// A explicação de cada indicador vive aqui: vira o title do cartão e a lista do
// ExplainCard. Um texto só, dois lugares — nunca um parágrafo fixo na tela.
const AJUDA = {
  volume: 'Conversas iniciadas entre as duas datas escolhidas.',
  frt: 'Quanto a pessoa de fora esperou até alguém do hospital responder.',
  duracao: 'Do primeiro contato até o encerramento da conversa.',
  sla: 'De cada 100 conversas já respondidas ou encerradas, quantas ouviram o hospital em até 5 minutos. Quem encerrou sem nunca receber resposta conta contra a meta.',
  csat: 'Nota média de quem quis avaliar o atendimento.',
  respostaCsat: 'Quantos avaliaram depois de encerrar. Entre 20% e 40% é o normal.',
  inatividade: 'Conversas que morreram sozinhas depois de 30 minutos paradas.',
  tipoDeLink:
    'Quanto do movimento vem de link de perfil (vários usam) e quanto de link pessoal (um número só).',
} as const;

function leituraTempoResposta(v: number | null): Leitura | undefined {
  if (v == null) return undefined;
  if (v < 5) return { tone: 'success', texto: 'dentro da meta de 5 minutos' };
  if (v <= 10) return { tone: 'warning', texto: 'acima da meta de 5 minutos' };
  return { tone: 'danger', texto: 'bem acima do aceitável' };
}

// As duas leituras do SLA na mesma frase: o card mostra o total, e quem quiser
// saber se o problema foi lentidão ou ausência lê o segundo número aqui.
function ajudaSla(entreRespondidas: number | null): string {
  if (entreRespondidas == null) return AJUDA.sla;
  return `${AJUDA.sla} Contando só quem foi respondido, o número é ${num(entreRespondidas)}%.`;
}

function leituraSla(v: number | null): Leitura | undefined {
  if (v == null) return undefined;
  if (v >= 85) return { tone: 'success', texto: 'dentro da meta de 85%' };
  if (v >= 70) return { tone: 'warning', texto: 'um pouco abaixo da meta' };
  return { tone: 'danger', texto: 'abaixo do aceitável' };
}

function leituraSatisfacao(v: number | null): Leitura | undefined {
  if (v == null) return undefined;
  if (v >= 8) return { tone: 'success', texto: 'boa avaliação' };
  if (v >= 6) return { tone: 'warning', texto: 'pode melhorar' };
  return { tone: 'danger', texto: 'avaliação baixa' };
}

function leituraResposta(v: number | null): Leitura | undefined {
  if (v == null) return undefined;
  if (v < 20) return { tone: 'warning', texto: 'poucas respostas' };
  if (v <= 40) return { tone: 'success', texto: 'dentro do normal' };
  return { tone: 'success', texto: 'acima do normal' };
}

function leituraInatividade(v: number | null): Leitura | undefined {
  if (v == null) return undefined;
  if (v > 25) return { tone: 'danger', texto: 'acima do aceitável' };
  if (v >= 15) return { tone: 'warning', texto: 'perto do limite' };
  return { tone: 'success', texto: 'dentro do esperado' };
}

const CARTAO =
  'flex h-full flex-col rounded-2xl border border-ink-200/70 bg-white p-5 shadow-[var(--shadow-card)]';

function IconeCalendario() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className="h-9 w-9"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function IconeEscudo() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-9 w-9"
      aria-hidden="true"
    >
      <path d="M12 3 4.5 6v5.5c0 4.3 3.1 8 7.5 9.5 4.4-1.5 7.5-5.2 7.5-9.5V6L12 3Z" />
      <path d="m9.5 12 1.8 1.8 3.3-3.6" />
    </svg>
  );
}

function IconeAlerta({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10.3 4.3 2.9 17.2A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </svg>
  );
}

function IconeConfirmado() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

function Cartao({
  nome,
  valor,
  unidade,
  ajuda,
  leitura,
}: {
  nome: string;
  valor: number | null;
  unidade?: string;
  ajuda: string;
  leitura?: Leitura;
}) {
  const semDado = valor == null;
  return (
    <div className={CARTAO} title={ajuda}>
      <h4 className="text-sm font-medium text-ink-600">{nome}</h4>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="tabular text-3xl font-semibold text-ink-900">
          {semDado ? '—' : num(valor)}
        </span>
        {!semDado && unidade && <span className="text-sm font-medium text-ink-500">{unidade}</span>}
      </p>
      {(semDado || leitura) && (
        <div className="mt-auto pt-4">
          {semDado ? (
            <Badge tone="muted">sem dados no período</Badge>
          ) : (
            leitura && <Badge tone={leitura.tone}>{leitura.texto}</Badge>
          )}
        </div>
      )}
    </div>
  );
}

function CartaoTipoDeLink({ profile, nominal }: { profile: number; nominal: number }) {
  const total = profile + nominal;
  const pctColetivo = total > 0 ? (profile / total) * 100 : 0;
  return (
    <div className={CARTAO} title={AJUDA.tipoDeLink}>
      <h4 className="text-sm font-medium text-ink-600">Perfil × Pessoal</h4>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="tabular text-3xl font-semibold text-ink-900">{num(profile)}</span>
        <span className="text-base text-ink-400">×</span>
        <span className="tabular text-3xl font-semibold text-ink-900">{num(nominal)}</span>
      </p>
      <div className="mt-auto pt-4">
        <div className="flex h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
          <div className="bg-brand-500" style={{ width: `${pctColetivo}%` }} />
          <div className="bg-brand-200" style={{ width: `${100 - pctColetivo}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-ink-500">
          <span>perfil</span>
          <span>pessoal</span>
        </div>
      </div>
    </div>
  );
}

function Barras({
  itens,
}: {
  itens: { id: string; rotulo: string; valor: number; detalhe?: string; dica?: string }[];
}) {
  const maior = Math.max(...itens.map((i) => i.valor), 1);
  return (
    <ul className="space-y-4 px-5 py-5">
      {itens.map((i) => (
        <li key={i.id} title={i.dica}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="truncate text-sm font-medium text-ink-800">{i.rotulo}</span>
            <span className="tabular shrink-0 text-sm font-semibold text-ink-900">
              {num(i.valor)}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: i.valor === 0 ? '0%' : `${Math.max(4, (i.valor / maior) * 100)}%` }}
            />
          </div>
          {i.detalhe && <p className="mt-1 text-xs text-ink-400">{i.detalhe}</p>}
        </li>
      ))}
    </ul>
  );
}

function EsqueletoCartao() {
  return (
    <div className={CARTAO}>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-8 w-20" />
      <div className="mt-auto pt-6">
        <Skeleton className="h-5 w-28" />
      </div>
    </div>
  );
}

function EsqueletoBarras() {
  return (
    <ul className="space-y-5 px-5 py-5">
      {[0, 1, 2, 3].map((i) => (
        <li key={i}>
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 w-8" />
          </div>
          <Skeleton className="mt-2 h-2 w-full" />
        </li>
      ))}
    </ul>
  );
}

function pessoasVinculadas(n: number): string {
  if (n === 0) return 'nenhuma pessoa ainda';
  if (n === 1) return '1 pessoa';
  return `${num(n)} pessoas`;
}

export default function DashboardPage() {
  const [from, setFrom] = useState(diasAtras(29));
  const [to, setTo] = useState(diasAtras(0));
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [avisoDeSucesso, setAvisoDeSucesso] = useState(false);
  const primeiraCarga = useRef(true);

  const hoje = diasAtras(0);
  const periodoInvalido = !from || !to || from > to;

  useEffect(() => {
    if (periodoInvalido) {
      setCarregando(false);
      setMetrics(null);
      return;
    }

    // Um período novo não pode conviver com o número do período anterior na tela.
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    setMetrics(null);

    // Só a data: quem converte a janela para instantes é a API, no fuso do
    // hospital. Mandar `T00:00:00` daqui fazia o servidor resolver a hora no fuso
    // DELE e jogar o começo e o fim do dia no lugar errado.
    api<Metrics>(`/admin/metrics?from=${from}&to=${to}`)
      .then((data) => {
        if (cancelado) return;
        setMetrics(data);
        setAtualizadoEm(new Date());
        if (primeiraCarga.current) primeiraCarga.current = false;
        else setAvisoDeSucesso(true);
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        setErro(
          err instanceof ApiError ? err.message : 'não foi possível falar com o sistema agora'
        );
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [from, to, tentativa, periodoInvalido]);

  useEffect(() => {
    if (!avisoDeSucesso) return;
    const t = setTimeout(() => setAvisoDeSucesso(false), 2500);
    return () => clearTimeout(t);
  }, [avisoDeSucesso]);

  const aplicarAtalho = (dias: number) => {
    setFrom(diasAtras(dias));
    setTo(hoje);
  };

  const setores = metrics ? [...metrics.byDepartment].sort((a, b) => b.volume - a.volume) : [];
  const links = metrics ? [...metrics.byLink].sort((a, b) => b.volume - a.volume) : [];
  const tentativasNegadas = metrics
    ? Object.entries(metrics.attemptsByReason).sort((a, b) => b[1] - a[1])
    : [];
  const totalNegado = tentativasNegadas.reduce((soma, [, qtd]) => soma + qtd, 0);
  const houveVazamento = (metrics?.attemptsByReason.nominal_taken ?? 0) > 0;
  const recusasForaDoEscopo =
    metrics != null && metrics.attemptsScope === 'nao_se_aplica_por_setor';
  const semMovimento = metrics != null && metrics.volume === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-4">
      <PageHeader
        title="Visão geral"
        description="Como o hospital atendeu quem escreveu de fora no período escolhido."
      />

      <ExplainCard title="O que cada número quer dizer">
        <ul className="space-y-1.5">
          <li>
            <strong className="font-medium text-ink-800">Conversas</strong> — {AJUDA.volume}
          </li>
          <li>
            <strong className="font-medium text-ink-800">Tempo até responder</strong> — {AJUDA.frt}
          </li>
          <li>
            <strong className="font-medium text-ink-800">Duração média</strong> — {AJUDA.duracao}
          </li>
          <li>
            <strong className="font-medium text-ink-800">Respondidos em 5 min</strong> — {AJUDA.sla}
          </li>
          <li>
            <strong className="font-medium text-ink-800">Satisfação</strong> — {AJUDA.csat}
          </li>
          <li>
            <strong className="font-medium text-ink-800">Quantos avaliaram</strong> —{' '}
            {AJUDA.respostaCsat}
          </li>
          <li>
            <strong className="font-medium text-ink-800">Encerradas sozinhas</strong> —{' '}
            {AJUDA.inatividade}
          </li>
          <li>
            <strong className="font-medium text-ink-800">Perfil × Pessoal</strong> —{' '}
            {AJUDA.tipoDeLink}
          </li>
          <li>
            <strong className="font-medium text-ink-800">Acessos negados</strong> — quem escreveu
            para o hospital sem um link de acesso válido.
          </li>
        </ul>

        <p className="pt-2 font-medium text-ink-800">Como a conta é feita</p>
        <ul className="space-y-1.5">
          <li>O tempo até responder só conta conversas que foram respondidas.</li>
          <li>
            Conversa que encerrou sem nenhuma resposta conta como fora da meta de 5 minutos —
            ninguém some da conta por não ter sido atendido.
          </li>
          <li>Conversa que ficou na fila sem atendente não entra em encerradas sozinhas.</li>
          <li>
            Quantos avaliaram conta só quem chegou a receber a pergunta da nota: conversa sem
            atendimento e acesso cortado no meio ficam de fora.
          </li>
        </ul>
      </ExplainCard>

      <Panel className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="w-full max-w-md">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="de">
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="até">
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
            {!periodoInvalido && (
              <p className="mt-2 text-xs text-ink-500">
                De {porExtenso(from)} a {porExtenso(to)}.
              </p>
            )}
          </div>

          <div className="flex flex-col items-start gap-2 lg:items-end">
            <div className="flex flex-wrap gap-2" role="group" aria-label="atalhos de período">
              {ATALHOS.map((a) => {
                const ativo = from === diasAtras(a.dias) && to === hoje;
                return (
                  <Button
                    key={a.rotulo}
                    type="button"
                    variant={ativo ? 'primary' : 'secondary'}
                    aria-pressed={ativo}
                    onClick={() => aplicarAtalho(a.dias)}
                  >
                    {a.rotulo}
                  </Button>
                );
              })}
            </div>
            <p className="min-h-4 text-xs" aria-live="polite">
              {avisoDeSucesso ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-brand-700">
                  <IconeConfirmado />
                  números atualizados
                </span>
              ) : atualizadoEm ? (
                <span className="tabular text-ink-400">
                  atualizado às{' '}
                  {atualizadoEm.toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </Panel>

      {periodoInvalido && (
        <Panel className="p-5">
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-amber-600">
              <IconeAlerta />
            </span>
            <p className="text-sm text-ink-700">A data de início tem que vir antes da data de fim.</p>
          </div>
        </Panel>
      )}

      {!periodoInvalido && erro && (
        <Panel className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="shrink-0 text-rose-600">
              <IconeAlerta />
            </span>
            <p className="text-sm text-ink-700">Não foi possível carregar os números: {erro}.</p>
            <Button
              type="button"
              variant="secondary"
              className="ml-auto"
              onClick={() => setTentativa((n) => n + 1)}
            >
              Tentar de novo
            </Button>
          </div>
        </Panel>
      )}

      {!periodoInvalido && !erro && carregando && (
        <>
          <p className="sr-only" role="status">
            Carregando os números do período.
          </p>
          <Skeleton className="h-6 w-full max-w-2xl" />
          <section aria-busy="true">
            <h3 className="sr-only">Indicadores do período</h3>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <EsqueletoCartao key={i} />
              ))}
            </div>
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Movimento por setor">
              <EsqueletoBarras />
            </Panel>
            <Panel title="Movimento por link de acesso">
              <EsqueletoBarras />
            </Panel>
          </div>
        </>
      )}

      {!periodoInvalido && !erro && !carregando && metrics && (
        <>
          {semMovimento ? (
            <Panel>
              <EmptyState
                icon={<IconeCalendario />}
                title="Nenhuma conversa nesse período"
                description="Escolha um intervalo maior ou confira se os links de acesso já foram enviados."
              />
            </Panel>
          ) : (
            <>
              <p className="max-w-3xl text-base leading-relaxed text-ink-700 sm:text-lg">
                No período escolhido,{' '}
                <strong className="tabular font-semibold text-ink-900">{num(metrics.volume)}</strong>{' '}
                {metrics.volume === 1 ? 'pessoa de fora falou' : 'pessoas de fora falaram'} com o
                hospital.{' '}
                {metrics.slaPct == null ? (
                  'Ainda não há respostas suficientes para medir o tempo de espera.'
                ) : (
                  <>
                    <strong className="tabular font-semibold text-ink-900">
                      {num(metrics.slaPct)}%
                    </strong>{' '}
                    receberam resposta em menos de 5 minutos.
                  </>
                )}
              </p>

              <section>
                <h3 className="sr-only">Indicadores do período</h3>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Cartao nome="Conversas" valor={metrics.volume} ajuda={AJUDA.volume} />
                  <Cartao
                    nome="Tempo até responder"
                    valor={metrics.frtAvgMinutes}
                    unidade="min"
                    ajuda={AJUDA.frt}
                    leitura={leituraTempoResposta(metrics.frtAvgMinutes)}
                  />
                  <Cartao
                    nome="Duração média"
                    valor={metrics.resolutionAvgMinutes}
                    unidade="min"
                    ajuda={AJUDA.duracao}
                  />
                  <Cartao
                    nome="Respondidos em 5 min"
                    valor={metrics.slaPct}
                    unidade="%"
                    ajuda={ajudaSla(metrics.slaPctEntreRespondidas)}
                    leitura={leituraSla(metrics.slaPct)}
                  />
                  <Cartao
                    nome="Satisfação (0 a 10)"
                    valor={metrics.csatAvg}
                    ajuda={AJUDA.csat}
                    leitura={leituraSatisfacao(metrics.csatAvg)}
                  />
                  <Cartao
                    nome="Quantos avaliaram"
                    valor={metrics.csatResponseRate}
                    unidade="%"
                    ajuda={AJUDA.respostaCsat}
                    leitura={leituraResposta(metrics.csatResponseRate)}
                  />
                  <Cartao
                    nome="Encerradas sozinhas"
                    valor={metrics.abandonmentPct}
                    unidade="%"
                    ajuda={AJUDA.inatividade}
                    leitura={leituraInatividade(metrics.abandonmentPct)}
                  />
                  <CartaoTipoDeLink
                    profile={metrics.byKind.profile}
                    nominal={metrics.byKind.nominal}
                  />
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Movimento por setor" hint="Conversas que cada setor recebeu.">
                  {setores.length > 0 ? (
                    <Barras
                      itens={setores.map((d) => ({
                        id: d.departmentId,
                        rotulo: d.name,
                        valor: d.volume,
                        dica: `${d.name} recebeu ${num(d.volume)} conversas no período.`,
                      }))}
                    />
                  ) : (
                    <EmptyState
                      title="Nenhum setor recebeu conversa"
                      description="Aparece aqui quando alguém de fora escolhe um setor no menu."
                    />
                  )}
                </Panel>

                <Panel
                  title="Movimento por link de acesso"
                  hint="Conversas que vieram de cada link."
                >
                  {links.length > 0 ? (
                    <Barras
                      itens={links.map((l) => ({
                        id: l.entryLinkId,
                        rotulo: l.label,
                        valor: l.volume,
                        detalhe: pessoasVinculadas(l.contacts),
                        dica: `${num(l.volume)} conversas por este link, de ${pessoasVinculadas(
                          l.contacts
                        )}.`,
                      }))}
                    />
                  ) : (
                    <EmptyState
                      title="Nenhum link foi usado"
                      description="Aparece aqui quando alguém escreve usando um link de acesso."
                    />
                  )}
                </Panel>
              </div>
            </>
          )}

          <section
            className={`rounded-2xl border shadow-[var(--shadow-card)] ${
              houveVazamento ? 'border-rose-200 bg-rose-50' : 'border-ink-200/70 bg-white'
            }`}
            aria-labelledby="recusas-titulo"
          >
            <div
              className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 ${
                houveVazamento ? 'border-rose-100' : 'border-ink-100'
              }`}
            >
              <h3 id="recusas-titulo" className="font-semibold text-ink-900">
                Acessos negados
              </h3>
              {totalNegado > 0 && (
                <Badge tone={houveVazamento ? 'danger' : 'neutral'}>
                  <span className="tabular">{num(totalNegado)}</span>
                  {totalNegado === 1 ? 'recusa' : 'recusas'}
                </Badge>
              )}
            </div>

            {houveVazamento && (
              <div className="flex flex-wrap items-center gap-3 border-b border-rose-100 px-5 py-4 text-rose-800">
                <span className="shrink-0">
                  <IconeAlerta />
                </span>
                <p className="text-sm">Um link pessoal foi repassado a outra pessoa.</p>
                <Link
                  href="/admin/acessos"
                  className="ml-auto inline-flex items-center justify-center rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
                >
                  Ver acessos negados
                </Link>
              </div>
            )}

            {tentativasNegadas.length > 0 ? (
              <ul
                className={houveVazamento ? 'divide-y divide-rose-100' : 'divide-y divide-ink-100'}
              >
                {tentativasNegadas.map(([motivo, qtd]) => {
                  const info = ATTEMPT_REASON[motivo] ?? {
                    label: 'Outro motivo',
                    explain: 'Uma recusa registrada pelo sistema que ainda não tem descrição.',
                    tone: 'neutral' as Tone,
                  };
                  return (
                    <li
                      key={motivo}
                      title={info.explain}
                      className="flex items-center justify-between gap-4 px-5 py-4"
                    >
                      <Badge tone={info.tone}>{info.label}</Badge>
                      <span className="tabular shrink-0 text-2xl font-semibold text-ink-900">
                        {num(qtd)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : recusasForaDoEscopo ? (
              // Dizer "nenhuma recusa" aqui seria mentira: o número existe, só
              // não se divide por setor. Mandar para a tela que tem o dado.
              <EmptyState
                icon={<IconeEscudo />}
                title="Não se aplica ao filtro por setor"
                description="A recusa acontece antes de a pessoa escolher um setor, então ela não entra na conta de um setor específico. Tire o filtro de setor aqui, ou abra Acessos negados, para ver as recusas do hospital."
              />
            ) : (
              <EmptyState
                icon={<IconeEscudo />}
                title="Nenhuma recusa no período"
                description="Ninguém tentou escrever para o hospital sem um link válido no período."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
