'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Dot,
  EmptyState,
  ExplainCard,
  Field,
  PageHeader,
  Panel,
  Skeleton,
  inputClass,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { ATTEMPT_REASON, formatPhone, relativeTime, type Tone } from '@/lib/labels';

interface AttemptRow {
  id: string;
  waNumber: string;
  entryCodeTried: string | null;
  reason: string;
  createdAt: string;
}

interface ReasonMeta {
  label: string;
  explain: string;
  tone: Tone;
}

// Da recusa mais grave para a mais banal: esta tela existe por causa da primeira.
const REASON_ORDER = ['nominal_taken', 'blocked', 'revoked_link', 'invalid_code', 'no_code'];

function reasonMeta(reason: string): ReasonMeta {
  const known: ReasonMeta | undefined = ATTEMPT_REASON[reason];
  // O código cru do banco ("nominal_taken") não pode chegar à tela do hospital.
  return (
    known ?? {
      label: 'Outro motivo',
      explain: 'Uma recusa registrada pelo sistema que ainda não tem descrição.',
      tone: 'neutral',
    }
  );
}

function reasonKeys(rows: AttemptRow[]): string[] {
  const known = Object.keys(ATTEMPT_REASON);
  const ordered = [
    ...REASON_ORDER.filter((r) => known.includes(r)),
    ...known.filter((r) => !REASON_ORDER.includes(r)),
  ];
  const extras = rows.map((r) => r.reason).filter((r) => !ordered.includes(r));
  return [...ordered, ...Array.from(new Set(extras))];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  return isoDay(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function IconRefresh({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`}
      aria-hidden="true"
    >
      <path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" />
      <path d="M20.5 4.5V10H15" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M12 4.2 2.9 19.6a1 1 0 0 0 .87 1.5h16.46a1 1 0 0 0 .87-1.5L12 4.2Z" />
      <path d="M12 10v4.4" />
      <path d="M12 17.6h.01" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-10 w-10"
      aria-hidden="true"
    >
      <path d="M12 3.2 5 6v5.4c0 4.3 2.9 8.3 7 9.4 4.1-1.1 7-5.1 7-9.4V6l-7-2.8Z" />
      <path d="m9.2 12.2 2 2 3.6-3.9" />
    </svg>
  );
}

// Mesmo atalho de período do dashboard: ativo em cheio, os outros em contorno.
function RangeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'primary' : 'secondary'}
      aria-pressed={active}
      onClick={onClick}
      className="px-3 py-1.5 text-xs"
    >
      {children}
    </Button>
  );
}

export default function AcessosPage() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(isoDay(new Date()));
  const [preset, setPreset] = useState<number | null>(30);
  const [reason, setReason] = useState('all');

  const [rows, setRows] = useState<AttemptRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState('');

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2500);
  }, []);

  const rangeInvalid = from > to;

  const load = useCallback(
    async (manual = false) => {
      if (from > to) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (manual) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await api<AttemptRow[]>(
          `/admin/access-attempts?from=${from}T00:00:00&to=${to}T23:59:59`
        );
        setRows(data);
        if (manual) showFlash('Lista atualizada.');
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Não foi possível carregar as tentativas agora. Tente de novo.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [from, to, showFlash]
  );

  useEffect(() => {
    void load();
  }, [load]);

  function applyPreset(days: number) {
    setPreset(days);
    setFrom(daysAgo(days - 1));
    setTo(isoDay(new Date()));
  }

  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const row of rows ?? []) acc[row.reason] = (acc[row.reason] ?? 0) + 1;
    return acc;
  }, [rows]);

  const keys = useMemo(() => reasonKeys(rows ?? []), [rows]);
  const visible = useMemo(
    () => (rows ?? []).filter((row) => reason === 'all' || row.reason === reason),
    [rows, reason]
  );

  const total = rows?.length ?? 0;
  const leaks = counts.nominal_taken ?? 0;
  const ready = rows !== null && !loading;
  // Datas invertidas antes de qualquer carga: não há o que resumir nem o que listar.
  const blocked = rangeInvalid && rows === null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Acessos negados"
        description="Quem escreveu para o hospital e o sistema recusou."
        action={
          <div className="flex items-center gap-3">
            <span aria-live="polite" className="text-xs text-brand-700">
              {flash}
            </span>
            <Button
              variant="secondary"
              onClick={() => void load(true)}
              disabled={loading || refreshing || rangeInvalid}
            >
              <IconRefresh spinning={refreshing} />
              {refreshing ? 'Atualizando' : 'Atualizar'}
            </Button>
          </div>
        }
      />

      <ExplainCard>
        <ul className="list-disc space-y-1.5 pl-4">
          <li>
            Cada linha é uma mensagem recusada: sem link de acesso, com código errado ou com link já
            encerrado.
          </li>
          <li>
            &ldquo;Link pessoal repassado&rdquo; é o motivo grave: esse link vale para um número só,
            e outro número tentou usar.
          </li>
          <li>Quando isso aparecer, encerre o link e emita um novo para a pessoa certa.</li>
        </ul>
      </ExplainCard>

      {blocked ? null : !ready ? (
        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <>
          {leaks > 0 && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3"
            >
              <span className="shrink-0 text-rose-600">
                <IconAlert />
              </span>
              <p className="text-sm font-medium text-rose-900">
                Um link de acesso pessoal foi usado por outro número.
              </p>
              <Link
                href="/admin/links"
                className="ml-auto inline-flex items-center justify-center rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
              >
                Ver links de acesso
              </Link>
            </div>
          )}

          <div
            role="group"
            aria-label="Resumo por motivo"
            className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5"
          >
            {keys.map((key) => {
              const meta = reasonMeta(key);
              const count = counts[key] ?? 0;
              const active = reason === key;
              const alarming = key === 'nominal_taken' && count > 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReason(active ? 'all' : key)}
                  aria-pressed={active}
                  disabled={count === 0 && !active}
                  // A explicação de cada motivo mora aqui: ensina quem passa o mouse,
                  // sem virar parágrafo permanente embaixo do número.
                  title={meta.explain}
                  className={`rounded-xl border bg-white p-3 text-left shadow-[var(--shadow-card)] disabled:cursor-default disabled:hover:border-ink-200/70 ${
                    active
                      ? 'border-brand-300 bg-brand-50'
                      : alarming
                        ? 'border-rose-200 bg-rose-50 hover:border-rose-300'
                        : 'border-ink-200/70 hover:border-ink-300'
                  }`}
                >
                  <span
                    className={`tabular block text-2xl font-semibold ${
                      count === 0 ? 'text-ink-300' : alarming ? 'text-rose-700' : 'text-ink-900'
                    }`}
                  >
                    {count}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-600">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <Panel>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="De">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset(null);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset(null);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Motivo">
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inputClass}
            >
              <option value="all">Todos os motivos ({total})</option>
              {keys.map((key) => (
                <option key={key} value={key}>
                  {reasonMeta(key).label} ({counts[key] ?? 0})
                </option>
              ))}
            </select>
          </Field>
          <div
            className="flex flex-wrap items-end gap-2"
            role="group"
            aria-label="atalhos de período"
          >
            <RangeChip active={preset === 7} onClick={() => applyPreset(7)}>
              7 dias
            </RangeChip>
            <RangeChip active={preset === 30} onClick={() => applyPreset(30)}>
              30 dias
            </RangeChip>
            <RangeChip active={preset === 90} onClick={() => applyPreset(90)}>
              90 dias
            </RangeChip>
          </div>
        </div>
        {rangeInvalid && (
          <p className="border-t border-ink-100 px-5 py-3 text-sm text-rose-700">
            A data inicial precisa vir antes da data final.
          </p>
        )}
      </Panel>

      <Panel
        title="Tentativas recusadas"
        hint={
          ready && !error && visible.length > 0
            ? `${plural(visible.length, 'registro', 'registros')}, do mais recente ao mais antigo.`
            : undefined
        }
      >
        {error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="font-medium text-ink-700">Não foi possível carregar a lista</p>
            <p className="max-w-sm text-sm leading-relaxed text-ink-500">{error}</p>
            <Button variant="secondary" onClick={() => void load(true)} disabled={refreshing}>
              <IconRefresh spinning={refreshing} />
              Tentar de novo
            </Button>
          </div>
        ) : blocked ? (
          <p className="px-5 py-10 text-center text-sm text-ink-500">
            Ajuste as datas para ver os registros.
          </p>
        ) : !ready ? (
          <div className="divide-y divide-ink-100">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="hidden h-4 w-20 sm:block" />
                <Skeleton className="ml-auto h-4 w-32" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div>
            <EmptyState
              icon={<IconShield />}
              title={
                total === 0 ? 'Nenhuma recusa no período' : 'Nenhuma recusa por esse motivo'
              }
              description={
                total === 0
                  ? 'Todo mundo que escreveu chegou com um link de acesso válido.'
                  : 'Escolha outro motivo ou amplie o período.'
              }
            />
            {total > 0 && (
              <div className="-mt-8 flex justify-center pb-12">
                <Button variant="secondary" onClick={() => setReason('all')}>
                  Mostrar todos os motivos
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Tentativas de acesso recusadas entre {from} e {to}, da mais recente para a mais
                  antiga.
                </caption>
                <thead>
                  <tr className="border-b border-ink-100 text-left text-xs font-medium tracking-wide text-ink-500 uppercase">
                    <th scope="col" className="px-5 py-3">Quando</th>
                    <th scope="col" className="px-5 py-3">Número</th>
                    <th scope="col" className="px-5 py-3">Código tentado</th>
                    <th scope="col" className="px-5 py-3">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {visible.map((row) => {
                    const meta = reasonMeta(row.reason);
                    const leak = row.reason === 'nominal_taken';
                    return (
                      <tr key={row.id} className={leak ? 'bg-rose-50' : 'hover:bg-ink-50/70'}>
                        <td className="px-5 py-3 align-top whitespace-nowrap">
                          <span
                            className="tabular font-medium text-ink-800"
                            title={fullDate(row.createdAt)}
                          >
                            {relativeTime(row.createdAt)}
                          </span>
                          <span className="tabular mt-0.5 block text-xs text-ink-500">
                            {shortDate(row.createdAt)}
                          </span>
                        </td>
                        <td className="tabular px-5 py-3 align-top font-medium whitespace-nowrap text-ink-800">
                          {formatPhone(row.waNumber)}
                        </td>
                        <td className="px-5 py-3 align-top">
                          {row.entryCodeTried ? (
                            <code className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-ink-700">
                              {row.entryCodeTried}
                            </code>
                          ) : (
                            <span className="text-ink-400">
                              —<span className="sr-only">nenhum código informado</span>
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 align-top">
                          <span title={meta.explain}>
                            <Badge tone={meta.tone}>
                              <Dot tone={meta.tone} />
                              {meta.label}
                            </Badge>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-ink-100 md:hidden">
              {visible.map((row) => {
                const meta = reasonMeta(row.reason);
                const leak = row.reason === 'nominal_taken';
                return (
                  <li key={row.id} className={`px-4 py-4 ${leak ? 'bg-rose-50' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <span title={meta.explain}>
                        <Badge tone={meta.tone}>
                          <Dot tone={meta.tone} />
                          {meta.label}
                        </Badge>
                      </span>
                      <span
                        className="tabular shrink-0 text-xs text-ink-500"
                        title={fullDate(row.createdAt)}
                      >
                        {relativeTime(row.createdAt)}
                      </span>
                    </div>
                    <p className="tabular mt-2 font-medium text-ink-800">
                      {formatPhone(row.waNumber)}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      {row.entryCodeTried ? (
                        <>
                          Código tentado:{' '}
                          <code className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-ink-700">
                            {row.entryCodeTried}
                          </code>
                        </>
                      ) : (
                        'Sem código na mensagem'
                      )}
                    </p>
                    <p className="tabular mt-1 text-xs text-ink-400">{shortDate(row.createdAt)}</p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}
