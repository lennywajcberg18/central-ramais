'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { LINK_KIND, formatPhone, relativeTime } from '@/lib/labels';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  PageHeader,
  Panel,
  Skeleton,
  inputClass,
} from '@/components/ui';

interface ContactRow {
  id: string;
  waNumber: string;
  blocked: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  entryLink: { id: string; label: string; kind: string; active: boolean };
}

interface LinkRow {
  id: string;
  label: string;
  kind: string;
  active: boolean;
  departments: { id: string; name: string }[];
}

type Situacao = 'todos' | 'bloqueados';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'não foi possível falar com o servidor';
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function kindLabel(kind: string): string {
  const info: { label: string; explain: string } | undefined = LINK_KIND[kind];
  // "profile" / "nominal" são vocabulário do banco; na tela isso não aparece.
  return info?.label ?? 'Tipo desconhecido';
}

function kindExplain(kind: string): string | undefined {
  const info: { label: string; explain: string } | undefined = LINK_KIND[kind];
  return info?.explain;
}

// ---------- ícones ----------

function IconSearch({ className = 'h-4 w-4' }: { className?: string }) {
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
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function IconContacts({ className = 'h-8 w-8' }: { className?: string }) {
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
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 8h3M4 12h3M4 16h3" />
      <circle cx="13.5" cy="10" r="2" />
      <path d="M10.5 16c.4-1.5 1.6-2.3 3-2.3s2.6.8 3 2.3" />
    </svg>
  );
}

function IconAlert({ className = 'h-4 w-4' }: { className?: string }) {
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
      <path d="M10.7 4.2 3.3 17a1.5 1.5 0 0 0 1.3 2.2h14.8a1.5 1.5 0 0 0 1.3-2.2L13.3 4.2a1.5 1.5 0 0 0-2.6 0Z" />
      <path d="M12 9.5v4M12 16.8h.01" />
    </svg>
  );
}

function IconCheck({ className = 'h-4 w-4' }: { className?: string }) {
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
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
    </svg>
  );
}

function IconRefresh({ className = 'h-4 w-4' }: { className?: string }) {
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
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  );
}

// ---------- diálogo ----------

function DialogShell({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // sem isso o foco fica no botão que abriu, atrás da máscara
  useEffect(() => {
    box.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/30 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-ink-200/70 bg-white p-5 shadow-[var(--shadow-lift)] outline-none sm:p-6"
      >
        <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function DialogError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800"
    >
      <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

function BlockDialog({
  contact,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  contact: ContactRow;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogShell title="Bloquear este número" onCancel={onCancel}>
      <p className="mt-1 tabular text-sm text-ink-500">{formatPhone(contact.waNumber)}</p>
      <p className="mt-3 text-sm text-ink-600">
        O sistema para de responder a esse número até você desbloquear.
      </p>
      {error && <DialogError message={error} />}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="button" variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Bloqueando…' : 'Bloquear número'}
        </Button>
      </div>
    </DialogShell>
  );
}

function ReassignDialog({
  contact,
  links,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  contact: ContactRow;
  links: LinkRow[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (linkId: string) => void;
}) {
  const [choice, setChoice] = useState('');
  const options = links.filter((link) => link.id !== contact.entryLink.id);
  const target = options.find((link) => link.id === choice);

  return (
    <DialogShell title="Mover para outro link" onCancel={onCancel}>
      <p className="mt-1 tabular text-sm text-ink-500">{formatPhone(contact.waNumber)}</p>
      <p className="mt-3 text-sm text-ink-600">
        Trocar o link muda quais setores essa pessoa vê, a partir da próxima mensagem.
      </p>

      {options.length === 0 ? (
        <p className="mt-4 rounded-xl border border-ink-200 bg-ink-50 px-3 py-3 text-sm text-ink-600">
          Nenhum outro link ativo. Crie um em Links de acesso.
        </p>
      ) : (
        <div className="mt-4">
          <Field label="Novo link de acesso">
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              disabled={busy}
              className={inputClass}
            >
              <option value="">Escolha um link</option>
              {options.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.label} — {kindLabel(link.kind)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {target && (
        <div className="mt-4 rounded-xl border border-ink-200 bg-ink-50 px-3 py-3 text-sm">
          {target.departments.length > 0 ? (
            <>
              <p className="text-ink-500">Passa a ver:</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {target.departments.map((dept) => (
                  <li key={dept.id}>
                    <Badge tone="success">{dept.name}</Badge>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-amber-800">Esse link não tem setor liberado — ela fica sem opção.</p>
          )}
        </div>
      )}

      {error && <DialogError message={error} />}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="button" onClick={() => onConfirm(choice)} disabled={busy || !target}>
          {busy ? 'Movendo…' : 'Mover link'}
        </Button>
      </div>
    </DialogShell>
  );
}

// ---------- pedaços da lista ----------

function LinkCell({ contact }: { contact: ContactRow }) {
  const explain = kindExplain(contact.entryLink.kind);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-ink-800">{contact.entryLink.label}</span>
      <span title={explain}>
        <Badge>{kindLabel(contact.entryLink.kind)}</Badge>
      </span>
      {!contact.entryLink.active && (
        <span title="Link revogado: esse número não consegue mais ser atendido por ele.">
          <Badge tone="warning">Revogado</Badge>
        </span>
      )}
    </div>
  );
}

// A data da primeira mensagem sai da tabela e vira dica no hover: interessa raramente.
function LastSeen({ contact }: { contact: ContactRow }) {
  return (
    <time
      dateTime={contact.lastSeenAt}
      title={`Última mensagem em ${fullDate(contact.lastSeenAt)} · primeira em ${fullDate(contact.firstSeenAt)}`}
      className="text-ink-500"
    >
      {relativeTime(contact.lastSeenAt)}
    </time>
  );
}

function RowActions({
  contact,
  busy,
  onReassign,
  onBlock,
  onUnblock,
}: {
  contact: ContactRow;
  busy: boolean;
  onReassign: () => void;
  onBlock: () => void;
  onUnblock: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
      <Button
        type="button"
        variant="secondary"
        onClick={onReassign}
        disabled={busy}
        title="Trocar o link de acesso deste número"
      >
        Mover link
      </Button>
      {contact.blocked ? (
        <Button type="button" variant="secondary" onClick={onUnblock} disabled={busy}>
          {busy ? 'Desbloqueando…' : 'Desbloquear'}
        </Button>
      ) : (
        <Button
          type="button"
          variant="danger"
          onClick={onBlock}
          disabled={busy}
          title="O sistema deixa de responder a este número"
        >
          Bloquear
        </Button>
      )}
    </div>
  );
}

// ---------- página ----------

export default function ContatosPage() {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [situacao, setSituacao] = useState<Situacao>('todos');
  const [blocking, setBlocking] = useState<ContactRow | null>(null);
  const [moving, setMoving] = useState<ContactRow | null>(null);

  const load = useCallback(async (mode: 'inicial' | 'atualizar') => {
    if (mode === 'inicial') setLoading(true);
    else setRefreshing(true);
    try {
      const [contacts, entryLinks] = await Promise.all([
        api<ContactRow[]>('/admin/contacts'),
        api<LinkRow[]>('/admin/entry-links'),
      ]);
      setRows(contacts);
      setLinks(entryLinks.filter((link) => link.active));
      setLoadError(null);
      if (mode === 'atualizar') setActionError(null);
    } catch (err) {
      const text = `Não foi possível carregar a lista: ${messageOf(err)}.`;
      if (mode === 'inicial') setLoadError(text);
      else setActionError(text);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('inicial');
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function notify(text: string) {
    setToast({ id: Date.now(), text });
  }

  const blockedCount = rows.filter((row) => row.blocked).length;

  const visible = useMemo(() => {
    const digits = onlyDigits(query);
    const searching = query.trim() !== '';
    return rows.filter((row) => {
      if (situacao === 'bloqueados' && !row.blocked) return false;
      if (!searching) return true;
      return digits !== '' && onlyDigits(row.waNumber).includes(digits);
    });
  }, [rows, query, situacao]);

  async function patchContact(contact: ContactRow, body: Record<string, unknown>) {
    await api(`/admin/contacts/${contact.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    await load('atualizar');
  }

  async function confirmBlock(contact: ContactRow) {
    setBusyId(contact.id);
    setDialogError(null);
    try {
      await patchContact(contact, { blocked: true });
      setBlocking(null);
      notify('Número bloqueado.');
    } catch (err) {
      setDialogError(`Não foi possível bloquear: ${messageOf(err)}.`);
    } finally {
      setBusyId(null);
    }
  }

  async function unblock(contact: ContactRow) {
    setBusyId(contact.id);
    setActionError(null);
    try {
      await patchContact(contact, { blocked: false });
      notify('Número desbloqueado.');
    } catch (err) {
      setActionError(`Não foi possível desbloquear: ${messageOf(err)}.`);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReassign(contact: ContactRow, entryLinkId: string) {
    setBusyId(contact.id);
    setDialogError(null);
    try {
      await patchContact(contact, { entryLinkId });
      setMoving(null);
      notify('Link trocado. Vale da próxima mensagem em diante.');
    } catch (err) {
      setDialogError(`Não foi possível trocar o link: ${messageOf(err)}.`);
    } finally {
      setBusyId(null);
    }
  }

  const filtrando = query.trim() !== '' || situacao !== 'todos';

  function clearFilters() {
    setQuery('');
    setSituacao('todos');
  }

  const filtros: { value: Situacao; label: string; count: number }[] = [
    { value: 'todos', label: 'Todos', count: rows.length },
    { value: 'bloqueados', label: 'Bloqueados', count: blockedCount },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Números de fora"
        description="Quem já escreveu para o hospital e por qual link de acesso entrou."
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={() => void load('atualizar')}
            disabled={loading || refreshing}
          >
            <IconRefresh className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      <Panel>
        <div className="flex flex-col gap-3 border-b border-ink-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="relative w-full sm:max-w-xs">
            <label htmlFor="busca-numero" className="sr-only">
              Buscar por número
            </label>
            {/* inputClass já traz mt-1: o ícone desce meio desse espaço para ficar no centro do campo */}
            <span className="pointer-events-none absolute left-3 top-[calc(50%+0.125rem)] -translate-y-1/2 text-ink-400">
              <IconSearch />
            </span>
            <input
              id="busca-numero"
              type="search"
              inputMode="tel"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por número"
              title="Compara só os dígitos, com ou sem código do país"
              className={`${inputClass} tabular pl-9`}
            />
          </div>

          <div
            role="group"
            aria-label="Filtrar por situação"
            className="inline-flex self-start rounded-xl border border-ink-200 bg-ink-50 p-1"
          >
            {filtros.map((filtro) => {
              const ativo = situacao === filtro.value;
              return (
                <button
                  key={filtro.value}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setSituacao(filtro.value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    ativo
                      ? 'bg-white text-brand-700 shadow-[var(--shadow-card)]'
                      : 'text-ink-500 hover:text-ink-800'
                  }`}
                >
                  {filtro.label}{' '}
                  <span className={`tabular text-xs ${ativo ? 'text-brand-500' : 'text-ink-400'}`}>
                    {filtro.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {actionError && (
          <div
            role="alert"
            className="flex items-center gap-2 border-b border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:px-5"
          >
            <IconAlert className="h-4 w-4 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="rounded-md px-2 py-0.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
            >
              Fechar
            </button>
          </div>
        )}

        {loading ? (
          <ul className="divide-y divide-ink-100">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="ml-auto h-9 w-40" />
              </li>
            ))}
          </ul>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <IconAlert className="h-8 w-8 text-ink-300" />
            <p className="font-medium text-ink-700">A lista não carregou</p>
            <p className="max-w-sm text-sm text-ink-500">{loadError}</p>
            <Button type="button" variant="secondary" onClick={() => void load('inicial')}>
              Tentar de novo
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div>
            {rows.length === 0 ? (
              <EmptyState
                icon={<IconContacts />}
                title="Nenhum número ainda"
                description="Os números aparecem sozinhos na primeira mensagem enviada por um link de acesso."
              />
            ) : situacao === 'bloqueados' && query.trim() === '' ? (
              <EmptyState
                icon={<IconContacts />}
                title="Nenhum número bloqueado"
                description="Números bloqueados aparecem aqui até você desbloquear."
              />
            ) : (
              <EmptyState
                icon={<IconSearch className="h-8 w-8" />}
                title="Nenhum número encontrado"
                description="A busca compara só os dígitos do telefone."
              />
            )}
            {filtrando && (
              <div className="-mt-6 flex justify-center pb-12">
                <Button type="button" variant="secondary" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="hidden lg:block">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Números de fora, o link de acesso de cada um e a última mensagem
                </caption>
                <thead>
                  <tr className="border-b border-ink-100 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                    <th scope="col" className="px-5 py-3">
                      Número
                    </th>
                    <th scope="col" className="px-5 py-3">
                      Link de acesso
                    </th>
                    <th scope="col" className="px-5 py-3">
                      Última mensagem
                    </th>
                    <th scope="col" className="px-5 py-3 text-right">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((contact) => (
                    <tr
                      key={contact.id}
                      className={`border-b border-ink-100 last:border-0 ${
                        contact.blocked ? 'bg-rose-50' : 'hover:bg-ink-50'
                      }`}
                    >
                      <th scope="row" className="px-5 py-3.5 text-left font-normal">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular font-medium text-ink-900">
                            {formatPhone(contact.waNumber)}
                          </span>
                          {contact.blocked && (
                            <span title="O sistema não responde a este número.">
                              <Badge tone="danger">Bloqueado</Badge>
                            </span>
                          )}
                        </div>
                      </th>
                      <td className="px-5 py-3.5">
                        <LinkCell contact={contact} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <LastSeen contact={contact} />
                      </td>
                      <td className="px-5 py-3.5">
                        <RowActions
                          contact={contact}
                          busy={busyId === contact.id}
                          onReassign={() => {
                            setDialogError(null);
                            setMoving(contact);
                          }}
                          onBlock={() => {
                            setDialogError(null);
                            setBlocking(contact);
                          }}
                          onUnblock={() => void unblock(contact)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-ink-100 lg:hidden">
              {visible.map((contact) => (
                <li key={contact.id} className={`px-4 py-4 ${contact.blocked ? 'bg-rose-50' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular font-medium text-ink-900">
                      {formatPhone(contact.waNumber)}
                    </span>
                    {contact.blocked && (
                      <span title="O sistema não responde a este número.">
                        <Badge tone="danger">Bloqueado</Badge>
                      </span>
                    )}
                  </div>
                  <div className="mt-2">
                    <LinkCell contact={contact} />
                  </div>
                  <p className="mt-2 text-sm">
                    <span className="text-xs text-ink-400">Última mensagem</span>{' '}
                    <LastSeen contact={contact} />
                  </p>
                  <div className="mt-4">
                    <RowActions
                      contact={contact}
                      busy={busyId === contact.id}
                      onReassign={() => {
                        setDialogError(null);
                        setMoving(contact);
                      }}
                      onBlock={() => {
                        setDialogError(null);
                        setBlocking(contact);
                      }}
                      onUnblock={() => void unblock(contact)}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <p className="border-t border-ink-100 px-4 py-3 text-xs text-ink-400 sm:px-5">
              <span className="tabular">{visible.length}</span>{' '}
              {visible.length === 1 ? 'número' : 'números'}
              {filtrando && (
                <>
                  {' '}
                  de <span className="tabular">{rows.length}</span>
                </>
              )}
            </p>
          </>
        )}
      </Panel>

      {blocking && (
        <BlockDialog
          contact={blocking}
          busy={busyId === blocking.id}
          error={dialogError}
          onCancel={() => {
            if (busyId) return;
            setBlocking(null);
            setDialogError(null);
          }}
          onConfirm={() => void confirmBlock(blocking)}
        />
      )}

      {moving && (
        <ReassignDialog
          contact={moving}
          links={links}
          busy={busyId === moving.id}
          error={dialogError}
          onCancel={() => {
            if (busyId) return;
            setMoving(null);
            setDialogError(null);
          }}
          onConfirm={(linkId) => void confirmReassign(moving, linkId)}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex max-w-xs items-start gap-2 rounded-xl border border-brand-200 bg-white px-4 py-3 text-sm text-ink-700 shadow-[var(--shadow-lift)]"
        >
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
