'use client';

import Link from 'next/link';
import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Dot,
  EmptyState,
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

interface ShiftRow {
  id: string;
  userId: string;
  departmentId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}

interface OpenShift {
  id: string;
  endsAt: string;
  user: { id: string; name: string };
}

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

interface DiaEscala {
  ativo: boolean;
  inicio: string;
  fim: string;
}

// O fim 1440 (meia-noite do dia seguinte) volta daqui como "00:00" porque é o
// único jeito de dizer meia-noite para um <input type="time">: "24:00" é valor
// inválido e o navegador limpa o campo. Quem devolve o sentido de "vai até o fim
// do dia" é a marca ao lado do campo — sem ela, a escala que a migração deu a
// todo atendente antigo (0 a 1440) aparecia como "00:00 até 00:00", que se lê
// como plantão de duração zero.
function minutoParaHora(minute: number): string {
  const m = minute % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// "00:00" no fim significa meia-noite do dia seguinte: sem isto, um plantão que
// termina à meia-noite viraria uma faixa de duração zero.
function horaParaMinuto(valor: string, ehFim: boolean): number {
  const [h, m] = valor.split(':').map((n) => parseInt(n, 10));
  const total = (h || 0) * 60 + (m || 0);
  return ehFim && total === 0 ? 1440 : total;
}

function escalaVazia(): DiaEscala[] {
  return DIAS.map(() => ({ ativo: false, inicio: '07:00', fim: '19:00' }));
}

// A escala é por setor: a mesma pessoa pode estar no CT na segunda e na Recepção
// na quarta. O editor guarda TODOS os setores dela ao mesmo tempo e mostra um por
// vez — salvar manda o conjunto inteiro, para que trocar de aba nunca apague o
// que estava na aba anterior.
type EscalaPorSetor = Record<string, DiaEscala[]>;

function escalaVaziaPorSetor(departmentIds: string[]): EscalaPorSetor {
  return Object.fromEntries(departmentIds.map((id) => [id, escalaVazia()]));
}

// O editor mostra uma faixa por dia em cada setor. Se a escala tiver duas no
// mesmo dia e setor, salvar aqui apagaria a outra em silêncio — por isso o dia
// extra é sinalizado, setor a setor.
function escalaDeShifts(
  shifts: ShiftRow[],
  departmentIds: string[]
): { porSetor: EscalaPorSetor; extrasPorSetor: Record<string, number[]> } {
  const porSetor = escalaVaziaPorSetor(departmentIds);
  const extrasPorSetor: Record<string, number[]> = {};
  const vistos = new Set<string>();

  for (const shift of shifts) {
    if (shift.weekday < 0 || shift.weekday > 6) continue;
    // Faixa de um setor que a pessoa não tem mais não cabe em aba nenhuma. Não
    // deveria existir — sair de um setor apaga a escala dele —, mas exibir só o
    // que tem aba é melhor que quebrar o editor com uma chave inexistente.
    if (!porSetor[shift.departmentId]) continue;

    const chave = `${shift.departmentId}:${shift.weekday}`;
    if (vistos.has(chave)) {
      const extras = extrasPorSetor[shift.departmentId] ?? [];
      if (!extras.includes(shift.weekday)) extras.push(shift.weekday);
      extrasPorSetor[shift.departmentId] = extras;
      continue;
    }
    vistos.add(chave);
    porSetor[shift.departmentId][shift.weekday] = {
      ativo: true,
      inicio: minutoParaHora(shift.startMinute),
      fim: minutoParaHora(shift.endMinute),
    };
  }
  return { porSetor, extrasPorSetor };
}

function ShiftEditor({
  user,
  setores,
  setorAtivo,
  onSetorChange,
  porSetor,
  extrasPorSetor,
  onChange,
  onSave,
  onCancel,
  saving,
  loading,
  carregou,
  error,
}: {
  user: UserRow;
  setores: { id: string; name: string }[];
  setorAtivo: string;
  onSetorChange: (departmentId: string) => void;
  porSetor: EscalaPorSetor;
  extrasPorSetor: Record<string, number[]>;
  onChange: (departmentId: string, weekday: number, dia: DiaEscala) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  loading: boolean;
  carregou: boolean;
  error: string | null;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  const dias = porSetor[setorAtivo] ?? escalaVazia();
  const diasComVariasFaixas = extrasPorSetor[setorAtivo] ?? [];

  // Quantos dias marcados em cada setor: é o que deixa visível, sem trocar de
  // aba, que a Recepção ficou sem nenhum dia.
  function diasMarcados(departmentId: string): number {
    return (porSetor[departmentId] ?? []).filter((d) => d.ativo).length;
  }

  function aplicarEmTodos() {
    const base = dias.find((d) => d.ativo) ?? dias[0];
    for (let i = 0; i < DIAS.length; i++) {
      onChange(setorAtivo, i, { ativo: true, inicio: base.inicio, fim: base.fim });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-escala"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ink-200/70 bg-white p-6 shadow-[var(--shadow-lift)]"
      >
        <h2 id="titulo-escala" className="text-lg font-semibold text-ink-900">
          Escala de plantão · {user.name}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          A escala é por setor: marque em cada um os dias e horários em que esta pessoa atende ali.
          Fora do horário marcado ela não entra no sistema, e quando o plantão acaba as conversas
          dela voltam para a fila do setor.
        </p>

        {loading ? (
          <div className="mt-5 space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : setores.length === 0 ? (
          // Escala é por setor: sem setor não há o que escalar, e um editor com
          // sete dias vazios que não salva nada seria pior que dizer isto.
          <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-relaxed text-amber-800">
            Esta pessoa não está em nenhum setor, então não há escala a montar. Use o botão
            &ldquo;Setores&rdquo; na linha dela primeiro.
          </p>
        ) : (
          <>
            {/* Um setor por vez na tela, todos na memória: salvar manda o
                conjunto inteiro, então trocar de aba não perde nada. */}
            <div
              role="tablist"
              aria-label="Setores desta pessoa"
              className="mt-5 flex flex-wrap gap-1.5"
            >
              {setores.map((setor) => {
                const marcados = diasMarcados(setor.id);
                const ativo = setor.id === setorAtivo;
                return (
                  <button
                    key={setor.id}
                    type="button"
                    role="tab"
                    aria-selected={ativo}
                    onClick={() => onSetorChange(setor.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      ativo
                        ? 'border-brand-600 bg-brand-50 font-medium text-brand-800'
                        : 'border-ink-200 text-ink-600 hover:border-ink-300 hover:text-ink-800'
                    }`}
                  >
                    {setor.name}
                    <span className={marcados === 0 ? 'ml-1.5 text-amber-700' : 'ml-1.5 text-ink-400'}>
                      {marcados === 0 ? 'sem dias' : `${marcados}d`}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-1.5">
              {dias.map((dia, weekday) => (
                <div
                  key={DIAS[weekday]}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-ink-100 px-3 py-2"
                >
                  <label className="flex min-w-32 items-center gap-2 text-sm text-ink-800">
                    <input
                      type="checkbox"
                      checked={dia.ativo}
                      onChange={(e) => onChange(setorAtivo, weekday, { ...dia, ativo: e.target.checked })}
                      className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                    />
                    {DIAS[weekday]}
                  </label>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
                    <input
                      type="time"
                      value={dia.inicio}
                      disabled={!dia.ativo}
                      onChange={(e) => onChange(setorAtivo, weekday, { ...dia, inicio: e.target.value })}
                      aria-label={`Início do plantão de ${DIAS[weekday]}`}
                      className={`${inputClass} mt-0 w-28 disabled:opacity-40`}
                    />
                    <span>até</span>
                    <input
                      type="time"
                      value={dia.fim}
                      disabled={!dia.ativo}
                      onChange={(e) => onChange(setorAtivo, weekday, { ...dia, fim: e.target.value })}
                      aria-label={`Fim do plantão de ${DIAS[weekday]}`}
                      className={`${inputClass} mt-0 w-28 disabled:opacity-40`}
                    />
                    {dia.fim === '00:00' && (
                      <span className={`text-xs ${dia.ativo ? '' : 'opacity-40'}`}>
                        (24:00 — fim do dia)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-3 text-xs leading-relaxed text-ink-500">
              Fim menor que o início é plantão que vira o dia — 19:00 às 07:00 cobre a noite inteira.
              Fim 00:00 é a meia-noite seguinte, ou seja 24:00: de 00:00 às 00:00 a pessoa fica de
              plantão o dia inteiro, não zero minuto.
            </p>

            {diasComVariasFaixas.length > 0 && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800"
              >
                Neste setor esta pessoa tem mais de um plantão no mesmo dia (
                {diasComVariasFaixas.map((d) => DIAS[d]).join(', ')}). Esta tela mostra um por dia —
                salvar aqui mantém só o horário que está aparecendo.
              </p>
            )}

            <button
              type="button"
              onClick={aplicarEmTodos}
              className="mt-2 text-sm font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800"
            >
              Repetir o mesmo horário nos sete dias
            </button>
          </>
        )}

        {error && <div className="mt-4">{<ErrorNote>{error}</ErrorNote>}</div>}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || loading || !carregou}
            title={
              carregou
                ? undefined
                : 'A escala atual não carregou. Feche e abra de novo — salvar agora apagaria o que está cadastrado.'
            }
          >
            {saving ? 'Salvando…' : 'Salvar escala'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AgentesPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [todosSetores, setTodosSetores] = useState<Department[]>([]);
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

  const [shiftUser, setShiftUser] = useState<UserRow | null>(null);
  const [shiftPorSetor, setShiftPorSetor] = useState<EscalaPorSetor>({});
  const [shiftExtras, setShiftExtras] = useState<Record<string, number[]>>({});
  const [shiftSetorAtivo, setShiftSetorAtivo] = useState('');
  const [shiftCarregou, setShiftCarregou] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [savingShift, setSavingShift] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [emPlantao, setEmPlantao] = useState<OpenShift[]>([]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [u, d, plantoes] = await Promise.all([
        api<UserRow[]>('/admin/users'),
        api<Department[]>('/admin/departments'),
        api<OpenShift[]>('/admin/shift-sessions'),
      ]);
      setUsers(u);
      // Os ativos são para ESCOLHER setor (cadastro e edição de vínculo); a lista
      // inteira é para NOMEAR setor. Desativar um setor não desfaz o vínculo de
      // quem já estava nele, então sem os inativos aqui a aba da escala dessa
      // pessoa apareceria sem nome — e com dois setores desativados seriam duas
      // abas idênticas e indistinguíveis.
      setDepartments(d.filter((x) => x.active));
      setTodosSetores(d);
      setEmPlantao(plantoes);
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
    const alvo = users.find((u) => u.id === editing.id);
    const nome = alvo?.name ?? 'a pessoa';
    const saiuDeAlgum = (alvo?.departmentIds ?? []).some((id) => !editing.deptIds.includes(id));
    setSavingDepts(true);
    try {
      const r = await api<{ releasedConversations: number; shiftEnded: boolean }>(
        `/admin/users/${editing.id}`,
        { method: 'PATCH', body: JSON.stringify({ departmentIds: editing.deptIds }) }
      );

      // Tirar alguém de um setor apaga a escala dela naquele setor e pode
      // encerrar o plantão em curso. As duas coisas são invisíveis na tela — sem
      // dizer aqui, o admin que desmarcou por engano e remarcou em seguida acha
      // que não aconteceu nada e só descobre quando a pessoa não consegue entrar.
      const partes = [`Setores de ${nome} atualizados.`];
      if (saiuDeAlgum) partes.push('A escala nos setores removidos foi apagada.');
      if (r.shiftEnded) partes.push('O plantão em curso foi encerrado.');
      if (r.releasedConversations > 0) {
        partes.push(
          r.releasedConversations === 1
            ? '1 conversa voltou para a fila.'
            : `${r.releasedConversations} conversas voltaram para a fila.`
        );
      }

      setEditing(null);
      setNotice(partes.join(' '));
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

  async function startEditingShift(u: UserRow) {
    setShiftError(null);
    setShiftUser(u);
    setShiftPorSetor(escalaVaziaPorSetor(u.departmentIds));
    setShiftExtras({});
    setShiftSetorAtivo(u.departmentIds[0] ?? '');
    setShiftCarregou(false);
    setShiftLoading(true);
    try {
      const { porSetor, extrasPorSetor } = escalaDeShifts(
        await api<ShiftRow[]>(`/admin/users/${u.id}/shifts`),
        u.departmentIds
      );
      setShiftPorSetor(porSetor);
      setShiftExtras(extrasPorSetor);
      // só depois de carregar de verdade é que salvar é seguro: um editor vazio
      // por causa de erro de rede substituiria a escala inteira por nada
      setShiftCarregou(true);
    } catch (err) {
      setShiftError(errorText(err, 'Não foi possível carregar a escala agora.'));
    } finally {
      setShiftLoading(false);
    }
  }

  function changeShiftDia(departmentId: string, weekday: number, dia: DiaEscala) {
    setShiftPorSetor((prev) => ({
      ...prev,
      [departmentId]: (prev[departmentId] ?? escalaVazia()).map((d, i) =>
        i === weekday ? dia : d
      ),
    }));
  }

  async function saveShift() {
    if (!shiftUser || !shiftCarregou) return;
    setShiftError(null);

    const entradas = Object.entries(shiftPorSetor);

    if (entradas.some(([, dias]) => dias.some((d) => d.ativo && (!d.inicio || !d.fim)))) {
      setShiftError('Preencha o horário de início e de fim dos dias marcados.');
      return;
    }

    // Vai o conjunto de TODOS os setores, não só o da aba aberta: a API
    // substitui a escala inteira da pessoa, então mandar um setor por vez
    // apagaria os outros.
    const shifts = entradas.flatMap(([departmentId, dias]) =>
      dias
        .map((dia, weekday) => ({ dia, weekday }))
        .filter(({ dia }) => dia.ativo)
        .map(({ dia, weekday }) => ({
          departmentId,
          weekday,
          startMinute: horaParaMinuto(dia.inicio, false),
          endMinute: horaParaMinuto(dia.fim, true),
        }))
    );

    if (shifts.some((s) => s.startMinute === s.endMinute)) {
      setShiftError('Um plantão não pode começar e terminar no mesmo horário.');
      return;
    }

    setSavingShift(true);
    try {
      await api(`/admin/users/${shiftUser.id}/shifts`, {
        method: 'PUT',
        body: JSON.stringify({ shifts }),
      });
      setNotice(
        shifts.length === 0
          ? `${shiftUser.name} ficou sem escala e não vai conseguir entrar.`
          : `Escala de ${shiftUser.name} atualizada.`
      );
      setShiftUser(null);
      await load();
    } catch (err) {
      setShiftError(errorText(err, 'Não foi possível salvar a escala agora.'));
    } finally {
      setSavingShift(false);
    }
  }

  const semSetores = departments.length === 0;
  const contagem = users.length === 1 ? '1 pessoa' : `${users.length} pessoas`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-4">
      <PageHeader
        title="Atendentes"
        description="Quem responde as conversas do hospital pelo WhatsApp."
      />

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
        {!loading && !loadError && (
          <div className="border-b border-ink-100 bg-ink-50/50 px-5 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              De plantão agora
            </p>
            {emPlantao.length === 0 ? (
              <p className="mt-1 text-sm text-ink-600">
                Ninguém. Conversas novas ficam esperando na fila do setor até alguém entrar.
              </p>
            ) : (
              <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                {emPlantao.map((p) => (
                  <li key={p.id} className="flex items-center gap-1.5 text-sm text-ink-700">
                    <Dot tone="success" />
                    {p.user.name}
                    <span className="text-ink-400">
                      até{' '}
                      {new Date(p.endsAt).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
                                <>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className={ACAO_DE_LINHA}
                                    onClick={() => startEditing(u)}
                                  >
                                    Setores
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className={ACAO_DE_LINHA}
                                    onClick={() => startEditingShift(u)}
                                  >
                                    Plantão
                                  </Button>
                                </>
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
                            <>
                              <Button
                                type="button"
                                variant="secondary"
                                className={ACAO_DE_LINHA}
                                onClick={() => startEditing(u)}
                              >
                                Setores
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                className={ACAO_DE_LINHA}
                                onClick={() => startEditingShift(u)}
                              >
                                Plantão
                              </Button>
                            </>
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

      {shiftUser && (
        <ShiftEditor
          user={shiftUser}
          setores={shiftUser.departmentIds.map((id) => {
            const setor = todosSetores.find((d) => d.id === id);
            return {
              id,
              // Setor desativado continua aparecendo, e marcado. Bloquear a
              // edição dele faria o salvamento inteiro falhar (o payload leva
              // todos os setores da pessoa); escondê-lo apagaria a escala dele
              // no primeiro "Salvar". A escala fica dormente e volta a valer se
              // o setor for reativado.
              name: setor ? (setor.active ? setor.name : `${setor.name} (fora do ar)`) : 'Setor',
            };
          })}
          setorAtivo={shiftSetorAtivo}
          onSetorChange={setShiftSetorAtivo}
          porSetor={shiftPorSetor}
          extrasPorSetor={shiftExtras}
          onChange={changeShiftDia}
          onSave={saveShift}
          onCancel={() => {
            if (savingShift) return;
            setShiftUser(null);
            setShiftError(null);
          }}
          saving={savingShift}
          loading={shiftLoading}
          carregou={shiftCarregou}
          error={shiftError}
        />
      )}

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
