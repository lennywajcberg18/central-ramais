'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AgentHeader from '@/components/AgentHeader';
import AgentNav from '@/components/AgentNav';
import { Badge, Button, Dot, EmptyState, Panel, Skeleton } from '@/components/ui';
import { api, ApiError, getSessionUser } from '@/lib/api';
import { CONVERSATION_STATUS, formatPhone, relativeTime } from '@/lib/labels';

interface ConversationRow {
  id: string;
  status: string;
  departmentName: string | null;
  entryLinkLabelSnapshot: string;
  contactNumber: string;
  assignedUserId: string | null;
  lastMessageAt: string;
}

const AVATAR_TONES = [
  'bg-brand-100 text-brand-800',
  'bg-brand-50 text-brand-700',
  'bg-ink-100 text-ink-700',
  'bg-ink-200 text-ink-800',
  'bg-brand-200 text-brand-900',
];

// A cor sai do próprio rótulo: o mesmo perfil aparece sempre com a mesma cor, e
// o atendente reconhece a linha antes de ler.
function avatarTone(label: string): string {
  let soma = 0;
  for (let i = 0; i < label.length; i++) soma += label.charCodeAt(i);
  return AVATAR_TONES[soma % AVATAR_TONES.length];
}

function initials(label: string): string {
  const partes = label.trim().split(/\s+/).filter(Boolean);
  // "Dra. Ana Ribeiro" deve virar AR, não DR
  const palavras = partes.filter((p) => !p.endsWith('.'));
  const base = palavras.length > 0 ? palavras : partes;
  if (base.length === 0) return '?';
  const primeira = base[0].charAt(0);
  const ultima = base.length > 1 ? base[base.length - 1].charAt(0) : '';
  return (primeira + ultima).toUpperCase();
}

// A mensagem crua da API pode ser só um código HTTP, que não diz nada a quem
// trabalha no hospital.
function readableError(e: unknown): string {
  if (e instanceof ApiError && !/^erro \d+$/.test(e.message)) return e.message;
  return 'a conexão falhou';
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-500"
      aria-hidden="true"
    >
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </svg>
  );
}

function ChatIcon() {
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
      <rect x="3.5" y="4.5" width="17" height="12" rx="3" />
      <path d="M8.5 16.5 7 20l4.5-3.5" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.5M12 16h.01" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.5-5.8M20 3.5V8h-4.5" />
    </svg>
  );
}

function ConversationLine({ row }: { row: ConversationRow }) {
  const status = CONVERSATION_STATUS[row.status] ?? {
    label: 'Em andamento',
    tone: 'neutral' as const,
  };
  const setor = row.departmentName ?? 'Sem setor';

  return (
    <li>
      <Link
        href={`/conversas/${row.id}`}
        className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-ink-50 sm:gap-4 sm:px-5"
      >
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${avatarTone(
            row.entryLinkLabelSnapshot
          )}`}
          aria-hidden="true"
        >
          {initials(row.entryLinkLabelSnapshot)}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900" title="Link de acesso usado">
              {row.entryLinkLabelSnapshot}
            </p>
            <p className="mt-0.5 truncate text-sm text-ink-500">
              <span title={row.departmentName ? 'Setor' : 'A pessoa ainda não escolheu o setor'}>
                {setor}
              </span>
              <span aria-hidden="true" className="mx-1.5 text-ink-300">
                ·
              </span>
              <span className="tabular" title="Número de fora">
                {formatPhone(row.contactNumber)}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
            <Badge tone={status.tone}>
              <Dot tone={status.tone} />
              {status.label}
            </Badge>
            <time
              dateTime={row.lastMessageAt}
              title={`Última mensagem: ${new Date(row.lastMessageAt).toLocaleString('pt-BR')}`}
              className="tabular text-xs text-ink-500"
            >
              {relativeTime(row.lastMessageAt)}
            </time>
          </div>
        </div>

        <ChevronIcon />
      </Link>
    </li>
  );
}

function SkeletonLine() {
  return (
    <li className="flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5">
      <Skeleton className="h-11 w-11 shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40 max-w-full" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <Skeleton className="h-5 w-24 shrink-0" />
    </li>
  );
}

function Group({
  title,
  explain,
  count,
  countClass,
  rows,
}: {
  title: string;
  // Explicação no hover: o grupo continua sendo só título e número.
  explain: string;
  count: number;
  countClass: string;
  rows: ConversationRow[];
}) {
  const id = `grupo-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h2 id={id} className="text-sm font-semibold text-ink-800" title={explain}>
          {title}
        </h2>
        <span className={`tabular rounded-md px-1.5 py-0.5 text-xs font-medium ${countClass}`}>
          {count}
        </span>
      </div>
      <Panel>
        <ul className="divide-y divide-ink-100">
          {rows.map((row) => (
            <ConversationLine key={row.id} row={row} />
          ))}
        </ul>
      </Panel>
    </section>
  );
}

export default function ConversasPage() {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [ehAdmin, setEhAdmin] = useState(false);

  useEffect(() => {
    setEhAdmin(getSessionUser()?.role === 'admin');
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<ConversationRow[]>('/agent/conversations');
        if (cancelled) return;
        setRows(data);
        setLoaded(true);
        setError(null);
        setSyncedAt(new Date().toISOString());
      } catch (e) {
        if (cancelled) return;
        setError(readableError(e));
      } finally {
        if (!cancelled) setRetrying(false);
      }
    }
    load();
    const interval = setInterval(load, 5000); // polling 5s
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [retryTick]);

  const esperando = rows.filter((c) => c.status === 'open');
  const meus = rows.filter((c) => c.status !== 'open');

  return (
    <div className="mx-auto max-w-3xl">
      <AgentHeader />
      <AgentNav />

      <main className="space-y-5 px-4 pb-28 pt-5 sm:px-6 sm:pb-8">
        <div className="px-1">
          <h1 className="text-xl font-semibold text-ink-900">Atendimento</h1>
          <p className="mt-1 text-sm text-ink-500">
            Quem escreve de fora do hospital pelo WhatsApp aparece aqui.
          </p>
        </div>

        {error && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <AlertIcon />
            <p className="min-w-0 flex-1 font-medium">Lista não atualizada: {error}.</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRetrying(true);
                setRetryTick((t) => t + 1);
              }}
              disabled={retrying}
            >
              {retrying ? 'Tentando…' : 'Tentar agora'}
            </Button>
          </div>
        )}

        {!loaded && !error && (
          <Panel>
            <p className="sr-only">Carregando as conversas</p>
            <ul className="divide-y divide-ink-100" aria-hidden="true">
              <SkeletonLine />
              <SkeletonLine />
              <SkeletonLine />
            </ul>
          </Panel>
        )}

        {loaded && rows.length === 0 && (
          <Panel>
            {/* Administrador não pertence a setor nenhum, então esta lista é sempre
                vazia para ele — sem esta explicação, parece que o sistema falhou. */}
            {ehAdmin ? (
              <EmptyState
                icon={<ChatIcon />}
                title="Esta tela é de quem atende"
                description="Você entrou como administrador, e administrador não fica em nenhum setor — por isso nenhuma conversa cai aqui. Para acompanhar como atendente, entre com agente1@hospitalvida.test (senha 123456). Para ver todas as conversas do hospital, use Conversas no painel."
              />
            ) : (
              <EmptyState
                icon={<ChatIcon />}
                title="Nenhuma conversa agora"
                description="A primeira aparece assim que alguém escrever pelo link de acesso."
              />
            )}
          </Panel>
        )}

        {esperando.length > 0 && (
          <Group
            title="Esperando atendente"
            explain="Ninguém do setor estava disponível quando a mensagem chegou."
            count={esperando.length}
            countClass="bg-amber-100 text-amber-800"
            rows={esperando}
          />
        )}

        {meus.length > 0 && (
          <Group
            title="Meus atendimentos"
            explain="Conversas que já estão com você."
            count={meus.length}
            countClass="bg-ink-100 text-ink-600"
            rows={meus}
          />
        )}

        {loaded && syncedAt && (
          <footer className="flex items-center gap-1.5 px-1 text-xs text-ink-400">
            <RefreshIcon />
            <time
              dateTime={syncedAt}
              className="tabular"
              title="A lista se atualiza sozinha a cada 5 segundos"
            >
              atualizada {relativeTime(syncedAt)}
            </time>
          </footer>
        )}
      </main>
    </div>
  );
}
