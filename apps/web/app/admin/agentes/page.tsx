'use client';

import Link from 'next/link';
import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
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
import { api } from '@/lib/api';
import { AVAILABILITY } from '@/lib/labels';

interface Department {
  id: string;
  name: string;
  active: boolean;
}

interface UserRow {
  id: string;
  role: 'admin' | 'agent';
  name: string;
  email: string;
  active: boolean;
  availability: string;
  departmentIds: string[];
  departmentNames: string[];
}

// As mensagens do servidor chegam em caixa baixa; na tela elas viram frase.
function asSentence(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1);
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? asSentence(err.message) : fallback;
}

function IconTeam() {
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
      <path d="M15 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 4 17.5V19" />
      <circle cx="9.5" cy="8" r="3" />
      <path d="M20 19v-1.5a3.5 3.5 0 0 0-2.7-3.4" />
      <path d="M15 5.2a3 3 0 0 1 0 5.6" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7" />
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
      className="mt-0.5 h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16.2h.01" />
    </svg>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800"
    >
      <IconCheck />
      {children}
    </p>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
    >
      <IconAlert />
      <span>{children}</span>
    </p>
  );
}

// Mesma medida compacta que a tabela de setores usa para ações de linha.
const ACAO_DE_LINHA = 'px-3 py-1.5 text-xs';

function DeptChips({
  departments,
  selected,
  onToggle,
  disabled,
  name,
}: {
  departments: Department[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  disabled?: boolean;
  name: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {departments.map((d) => {
        const checked = selected.includes(d.id);
        return (
          <label
            key={d.id}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors ${
              checked
                ? 'border-brand-500 bg-brand-50 text-brand-800'
                : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <input
              type="checkbox"
              name={name}
              value={d.id}
              checked={checked}
              disabled={disabled}
              onChange={(e) => onToggle(d.id, e.target.checked)}
              className="h-4 w-4 rounded accent-brand-600"
            />
            {d.name}
          </label>
        );
      })}
    </div>
  );
}

// Alerta enxuto: uma frase e o caminho para resolver.
function NoDepartmentsNote() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-ink-300 bg-ink-50 px-3 py-3">
      <p className="text-sm text-ink-600">Nenhum setor ativo no hospital.</p>
      <Link
        href="/admin/setores"
        className="inline-flex items-center justify-center rounded-xl border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-ink-400 hover:bg-ink-50"
      >
        Criar setor
      </Link>
    </div>
  );
}

function DeptEditor({
  departments,
  selected,
  onToggle,
  onSave,
  onCancel,
  saving,
  error,
}: {
  departments: Department[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-3">
      <DeptChips
        departments={departments}
        selected={selected}
        onToggle={onToggle}
        disabled={saving}
        name="setores-edicao"
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" className={ACAO_DE_LINHA} onClick={onSave} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar setores'}
        </Button>
        <Button type="button" variant="secondary" className={ACAO_DE_LINHA} onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function AvailabilityCell({ user }: { user: UserRow }) {
  if (!user.active) return <Badge tone="muted">Sem acesso</Badge>;
  const state = AVAILABILITY[user.availability];
  if (!state) return <Badge tone="muted">Desconhecida</Badge>;
  return (
    <Badge tone={state.tone}>
      <Dot tone={state.tone} />
      {state.label}
    </Badge>
  );
}

function DeptBadges({ user }: { user: UserRow }) {
  if (user.departmentNames.length > 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {user.departmentNames.map((n) => (
          <Badge key={n}>{n}</Badge>
        ))}
      </div>
    );
  }
  if (user.role === 'agent') {
    return (
      <span title="Sem setor, nenhuma conversa chega para essa pessoa.">
        <Badge tone="warning">Sem setor</Badge>
      </span>
    );
  }
  return <span className="text-sm text-ink-400">—</span>;
}

function ConfirmDeactivate({
  user,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  user: UserRow;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-desativar"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-5 shadow-[var(--shadow-lift)]"
      >
        <h3 id="titulo-desativar" className="text-lg font-semibold text-ink-900">
          Desativar {user.name}?
        </h3>
        <p className="mt-2 text-sm text-ink-600">Perde o acesso; o histórico fica.</p>
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Desativando…' : 'Desativar acesso'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AgentesPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent' as const });
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ id: string; deptIds: string[] } | null>(null);
  const [savingDepts, setSavingDepts] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState<UserRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [u, d] = await Promise.all([
        api<UserRow[]>('/admin/users'),
        api<Department[]>('/admin/departments'),
      ]);
      setUsers(u);
      setDepartments(d.filter((x) => x.active));
    } catch (err) {
      setLoadError(errorText(err, 'Não foi possível carregar a equipe agora.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (selectedDepts.length === 0) {
      setFormError('Escolha ao menos um setor.');
      return;
    }
    setCreating(true);
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, departmentIds: selectedDepts }),
      });
      setForm({ name: '', email: '', password: '', role: 'agent' });
      setSelectedDepts([]);
      setNotice('Atendente cadastrado.');
      await load();
    } catch (err) {
      setFormError(errorText(err, 'Não foi possível criar o cadastro agora.'));
    } finally {
      setCreating(false);
    }
  }

  async function setActive(u: UserRow, active: boolean) {
    setToggleError(null);
    setTogglingId(u.id);
    try {
      await api(`/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
      setConfirming(null);
      setNotice(active ? `${u.name} voltou a ter acesso.` : `Acesso de ${u.name} desativado.`);
      await load();
    } catch (err) {
      setToggleError(errorText(err, 'Não foi possível alterar o acesso agora.'));
    } finally {
      setTogglingId(null);
    }
  }

  async function saveDepartments() {
    if (!editing) return;
    setEditError(null);
    if (editing.deptIds.length === 0) {
      setEditError('Escolha ao menos um setor.');
      return;
    }
    setSavingDepts(true);
    try {
      await api(`/admin/users/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ departmentIds: editing.deptIds }),
      });
      setEditing(null);
      setNotice('Setores atualizados.');
      await load();
    } catch (err) {
      setEditError(errorText(err, 'Não foi possível salvar os setores agora.'));
    } finally {
      setSavingDepts(false);
    }
  }

  function toggleEditDept(id: string, checked: boolean) {
    setEditing((prev) =>
      prev
        ? {
            id: prev.id,
            deptIds: checked ? [...prev.deptIds, id] : prev.deptIds.filter((x) => x !== id),
          }
        : prev
    );
  }

  function startEditing(u: UserRow) {
    setEditError(null);
    setEditing({ id: u.id, deptIds: u.departmentIds });
  }

  const semSetores = departments.length === 0;
  const contagem = users.length === 1 ? '1 pessoa' : `${users.length} pessoas`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-4">
      <PageHeader
        title="Atendentes"
        description="Quem responde as conversas do hospital pelo WhatsApp."
      />

      <ExplainCard>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>O setor da pessoa define quais conversas chegam para ela. Sem setor, nada chega.</li>
          <li>Disponível ou Ausente quem muda é o próprio atendente, pelo app. Aqui você só vê.</li>
          <li>Desativar tira o acesso ao sistema. O histórico continua nos relatórios.</li>
        </ul>
      </ExplainCard>

      {notice && <Notice>{notice}</Notice>}

      <Panel title="Novo atendente">
        <form onSubmit={createUser} className="space-y-5 px-5 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Nome">
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Maria Souza"
                autoComplete="off"
                className={inputClass}
              />
            </Field>
            <Field label="E-mail">
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="maria@hospital.com.br"
                autoComplete="off"
                title="É com este e-mail e a senha que a pessoa entra no sistema."
                className={inputClass}
              />
            </Field>
            <Field label="Senha">
              <input
                required
                type="password"
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
                title="Mínimo de 6 caracteres."
                className={inputClass}
              />
            </Field>
          </div>

          <fieldset className="space-y-2">
            <legend
              className="text-xs font-medium uppercase tracking-wide text-ink-500"
              title="As conversas do setor entram na fila de quem o atende."
            >
              Setores
            </legend>
            {loading ? (
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-9 w-28" />
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-24" />
              </div>
            ) : semSetores ? (
              <NoDepartmentsNote />
            ) : (
              <DeptChips
                departments={departments}
                selected={selectedDepts}
                onToggle={(id, checked) =>
                  setSelectedDepts((prev) =>
                    checked ? [...prev, id] : prev.filter((x) => x !== id)
                  )
                }
                disabled={creating}
                name="setores-novo"
              />
            )}
          </fieldset>

          {formError && <ErrorNote>{formError}</ErrorNote>}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={creating || semSetores}>
              {creating ? 'Cadastrando…' : 'Cadastrar atendente'}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Pessoas com acesso" hint={loading ? undefined : contagem}>
        {toggleError && !confirming && (
          <div className="px-5 pt-4">
            <ErrorNote>{toggleError}</ErrorNote>
          </div>
        )}

        {loading ? (
          <div className="space-y-3 px-5 py-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="font-medium text-ink-700">A lista não carregou</p>
            <p className="max-w-sm text-sm text-ink-500">{loadError}</p>
            <Button
              variant="secondary"
              onClick={() => {
                setLoading(true);
                load();
              }}
            >
              Tentar de novo
            </Button>
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            icon={<IconTeam />}
            title="Ninguém cadastrado ainda"
            description="Cadastre a primeira pessoa no formulário acima."
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Pessoas com acesso, com os setores que atendem e a situação atual
                </caption>
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50/70 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                    <th scope="col" className="px-5 py-3">
                      Pessoa
                    </th>
                    <th scope="col" className="px-5 py-3">
                      E-mail
                    </th>
                    <th
                      scope="col"
                      className="px-5 py-3"
                      title="O setor define quais conversas chegam para a pessoa."
                    >
                      Setores
                    </th>
                    <th
                      scope="col"
                      className="px-5 py-3"
                      title="Disponível ou Ausente quem muda é o próprio atendente, pelo app."
                    >
                      Situação
                    </th>
                    <th scope="col" className="px-5 py-3 text-right">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    // narrowing: dentro dos handlers o `editing` do closure já é o desta linha
                    const editRow = editing && editing.id === u.id ? editing : null;
                    return (
                      <tr
                        key={u.id}
                        className="border-b border-ink-100 align-top last:border-0 hover:bg-ink-50/50"
                      >
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink-900">{u.name}</span>
                            {u.role === 'admin' && <Badge>Administrador</Badge>}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-ink-600">{u.email}</td>
                        <td className="px-5 py-4">
                          {editRow ? (
                            <DeptEditor
                              departments={departments}
                              selected={editRow.deptIds}
                              onToggle={toggleEditDept}
                              onSave={saveDepartments}
                              onCancel={() => setEditing(null)}
                              saving={savingDepts}
                              error={editError}
                            />
                          ) : (
                            <DeptBadges user={u} />
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <AvailabilityCell user={u} />
                        </td>
                        <td className="px-5 py-4">
                          {!editRow && (
                            <div className="flex justify-end gap-2">
                              {u.role === 'agent' && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className={ACAO_DE_LINHA}
                                  onClick={() => startEditing(u)}
                                >
                                  Setores
                                </Button>
                              )}
                              {u.active ? (
                                <Button
                                  type="button"
                                  variant="danger"
                                  className={ACAO_DE_LINHA}
                                  onClick={() => {
                                    setToggleError(null);
                                    setConfirming(u);
                                  }}
                                >
                                  Desativar
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className={ACAO_DE_LINHA}
                                  onClick={() => setActive(u, true)}
                                  disabled={togglingId === u.id}
                                >
                                  {togglingId === u.id ? 'Reativando…' : 'Reativar'}
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-ink-100 md:hidden">
              {users.map((u) => {
                const editRow = editing && editing.id === u.id ? editing : null;
                return (
                  <li key={u.id} className="space-y-3 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink-900">{u.name}</span>
                      {u.role === 'admin' && <Badge>Administrador</Badge>}
                      <span className="ml-auto">
                        <AvailabilityCell user={u} />
                      </span>
                    </div>
                    <p className="break-all text-sm text-ink-600">{u.email}</p>
                    {editRow ? (
                      <DeptEditor
                        departments={departments}
                        selected={editRow.deptIds}
                        onToggle={toggleEditDept}
                        onSave={saveDepartments}
                        onCancel={() => setEditing(null)}
                        saving={savingDepts}
                        error={editError}
                      />
                    ) : (
                      <>
                        <DeptBadges user={u} />
                        <div className="flex flex-wrap gap-2">
                          {u.role === 'agent' && (
                            <Button
                              type="button"
                              variant="secondary"
                              className={ACAO_DE_LINHA}
                              onClick={() => startEditing(u)}
                            >
                              Setores
                            </Button>
                          )}
                          {u.active ? (
                            <Button
                              type="button"
                              variant="danger"
                              className={ACAO_DE_LINHA}
                              onClick={() => {
                                setToggleError(null);
                                setConfirming(u);
                              }}
                            >
                              Desativar
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              className={ACAO_DE_LINHA}
                              onClick={() => setActive(u, true)}
                              disabled={togglingId === u.id}
                            >
                              {togglingId === u.id ? 'Reativando…' : 'Reativar'}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>

      {confirming && (
        <ConfirmDeactivate
          user={confirming}
          busy={togglingId === confirming.id}
          error={toggleError}
          onConfirm={() => setActive(confirming, false)}
          onCancel={() => {
            if (togglingId) return;
            setToggleError(null);
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
