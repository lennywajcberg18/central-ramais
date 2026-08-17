'use client';

import NextLink from 'next/link';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
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
import { API_URL, api, getToken } from '@/lib/api';
import { LINK_KIND, formatPhone } from '@/lib/labels';

interface Department {
  id: string;
  name: string;
  active: boolean;
}

type LinkKind = 'profile' | 'nominal';

interface LinkRow {
  id: string;
  url: string;
  entryCode: string;
  kind: LinkKind;
  label: string;
  holderNote: string | null;
  active: boolean;
  revokedAt: string | null;
  createdAt: string;
  useCount: number;
  departments: { id: string; name: string }[];
}

interface ContactRow {
  id: string;
  waNumber: string;
  blocked: boolean;
  firstSeenAt: string;
}

interface ContactsPanel {
  link: LinkRow;
  rows: ContactRow[] | null;
  error: string | null;
}

interface Notice {
  tone: 'success' | 'error';
  text: string;
}

const KINDS: LinkKind[] = ['profile', 'nominal'];

// Fica no title: explicar isso embaixo de cada card viraria parede de texto.
const USE_COUNT_HINT =
  'Quantas vezes o endereço foi aberto no navegador. Não é o número de atendimentos.';

// A mensagem crua da API é curta e em português, mas "erro 500" não diz nada a
// quem está na recepção do hospital.
function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message.trim() : '';
  if (!raw || /^erro \d+$/i.test(raw)) return 'Não foi possível concluir agora. Tente de novo em instantes.';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function IconPeople() {
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
      <path d="M15 19v-1.4a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 17.6V19" />
      <circle cx="9" cy="8" r="3.2" />
      <path d="M21 19v-1.4a3.6 3.6 0 0 0-2.7-3.5M15.6 5.2a3.2 3.2 0 0 1 0 5.6" />
    </svg>
  );
}

function IconPerson() {
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
      <path d="M19 20v-1.6a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20" />
      <circle cx="12" cy="7.5" r="3.5" />
    </svg>
  );
}

function IconLinkCard() {
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
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2" />
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
      className="h-4 w-4"
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
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 9v4.5M12 17h.01" />
      <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function KindIcon({ kind }: { kind: LinkKind }) {
  return kind === 'nominal' ? <IconPerson /> : <IconPeople />;
}

function Legend({ children }: { children: ReactNode }) {
  return (
    <legend className="text-xs font-medium uppercase tracking-wide text-ink-500">{children}</legend>
  );
}

function Modal({
  title,
  labelledBy,
  onClose,
  children,
  footer,
}: {
  title: string;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 p-4 backdrop-blur-[1px] sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ink-200 bg-white p-6 shadow-[var(--shadow-lift)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 id={labelledBy} className="text-lg font-semibold text-ink-900">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-700"
          >
            <IconClose />
          </button>
        </div>
        {children}
        <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

function MenuPreview({ names }: { names: string[] }) {
  if (names.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-ink-300 bg-ink-50 px-4 py-6 text-center text-sm text-ink-500">
        Marque os setores acima.
      </p>
    );
  }

  const single = names.length === 1;
  const text = single
    ? `Você será atendido por ${names[0]}. Aguarde um momento.`
    : `Olá! Com quem deseja falar?\n${names
        .map((name, i) => `${i + 1} — ${name}`)
        .join('\n')}\n\nDigite o número da opção.`;

  return (
    <div
      className="chat-canvas rounded-xl p-4"
      title={
        single
          ? 'Com um setor só, a pessoa entra direto nele e o menu não aparece.'
          : 'Nenhum outro setor do hospital aparece para ela.'
      }
    >
      <p className="max-w-sm whitespace-pre-line rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink-800 shadow-[var(--shadow-card)]">
        {text}
      </p>
    </div>
  );
}

export default function LinksPage() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState({ label: '', holderNote: '', kind: 'profile' as LinkKind });
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrBusyId, setQrBusyId] = useState<string | null>(null);
  const [contactsOf, setContactsOf] = useState<ContactsPanel | null>(null);
  const [toRevoke, setToRevoke] = useState<LinkRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.tone === 'success' ? 3000 : 7000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!copiedId) return;
    const t = setTimeout(() => setCopiedId(null), 2000);
    return () => clearTimeout(t);
  }, [copiedId]);

  async function load() {
    setLoadError(null);
    try {
      const [l, d] = await Promise.all([
        api<LinkRow[]>('/admin/entry-links'),
        api<Department[]>('/admin/departments'),
      ]);
      setLinks(l);
      setDepartments(d.filter((x) => x.active));
    } catch (err) {
      setLoadError(readableError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.label.trim()) {
      setError('Dê um nome ao link.');
      return;
    }
    if (selectedDepts.length === 0) {
      setError('Escolha ao menos um setor.');
      return;
    }
    setCreating(true);
    try {
      await api('/admin/entry-links', {
        method: 'POST',
        body: JSON.stringify({
          label: form.label.trim(),
          holderNote: form.holderNote.trim() || undefined,
          kind: form.kind,
          departmentIds: selectedDepts,
        }),
      });
      setForm({ label: '', holderNote: '', kind: 'profile' });
      setSelectedDepts([]);
      setNotice({ tone: 'success', text: 'Link criado. Já pode ser enviado.' });
      await load();
    } catch (err) {
      setError(readableError(err));
    } finally {
      setCreating(false);
    }
  }

  async function confirmRevoke() {
    if (!toRevoke) return;
    setRevoking(true);
    try {
      await api(`/admin/entry-links/${toRevoke.id}/revoke`, { method: 'POST' });
      setToRevoke(null);
      setNotice({ tone: 'success', text: 'Acesso revogado.' });
      await load();
    } catch (err) {
      setNotice({ tone: 'error', text: readableError(err) });
    } finally {
      setRevoking(false);
    }
  }

  async function showContacts(link: LinkRow) {
    setContactsOf({ link, rows: null, error: null });
    try {
      const rows = await api<ContactRow[]>(`/admin/entry-links/${link.id}/contacts`);
      setContactsOf((cur) => (cur && cur.link.id === link.id ? { ...cur, rows } : cur));
    } catch (err) {
      setContactsOf((cur) =>
        cur && cur.link.id === link.id ? { ...cur, error: readableError(err) } : cur
      );
    }
  }

  async function copyUrl(link: LinkRow) {
    try {
      if (!navigator.clipboard) throw new Error('a área de transferência não está disponível');
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.id);
    } catch {
      setNotice({ tone: 'error', text: 'Não deu para copiar. Copie o endereço do card.' });
    }
  }

  async function downloadQr(link: LinkRow) {
    setQrBusyId(link.id);
    try {
      const res = await fetch(`${API_URL}/admin/entry-links/${link.id}/qrcode`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      // Em erro o servidor responde JSON; sem esta checagem o navegador salvaria
      // a mensagem de erro dentro de um arquivo com extensão .png.
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `erro ${res.status}`);
      }
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('o servidor não devolveu uma imagem');

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qr-${link.label.toLowerCase().replace(/\s+/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ tone: 'success', text: 'Código QR baixado.' });
    } catch (err) {
      setNotice({ tone: 'error', text: `Não foi possível gerar o QR. ${readableError(err)}` });
    } finally {
      setQrBusyId(null);
    }
  }

  const selectedInMenuOrder = departments.filter((d) => selectedDepts.includes(d.id));
  const activeCount = links.filter((l) => l.active).length;

  return (
    <div className="mx-auto max-w-5xl pb-16">
      <PageHeader
        title="Links de acesso"
        description="Cada link define quais setores a pessoa de fora enxerga no WhatsApp."
        action={
          !loading && !loadError && links.length > 0 ? (
            <div className="rounded-xl border border-ink-200 bg-white px-5 py-3 text-right shadow-[var(--shadow-card)]">
              <p className="tabular text-2xl font-semibold text-ink-900">{activeCount}</p>
              <p className="text-xs text-ink-500">
                {activeCount === 1 ? 'link em uso' : 'links em uso'}
              </p>
            </div>
          ) : undefined
        }
      />

      <div className="mb-8">
        <ExplainCard>
          <ul className="list-disc space-y-1.5 pl-4">
            <li>O link define quais setores a pessoa enxerga. Nenhum outro aparece para ela.</li>
            <li>
              <strong className="font-medium text-ink-800">Perfil</strong> vale para várias pessoas;{' '}
              <strong className="font-medium text-ink-800">Pessoal</strong> vale para um número só.
            </li>
            <li>Revogar corta o acesso — inclusive de quem já conversou antes.</li>
          </ul>
        </ExplainCard>
      </div>

      <Panel title="Criar link de acesso" className="mb-8">
        <form onSubmit={createLink} className="space-y-6 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome">
              <input
                aria-required="true"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Médico externo"
                title="Como você vai reconhecer este link na lista."
                className={inputClass}
              />
            </Field>
            <Field label="Observação">
              <input
                value={form.holderNote}
                onChange={(e) => setForm({ ...form, holderNote: e.target.value })}
                placeholder="CRM 00000 — cardiologia (opcional)"
                title="Opcional. CRM, leito, convênio — o que ajudar a identificar depois."
                className={inputClass}
              />
            </Field>
          </div>

          <fieldset>
            <Legend>Para quem vale</Legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {KINDS.map((kind) => {
                const active = form.kind === kind;
                // O rádio está em sr-only, então o contorno de foco global cai num
                // elemento invisível: o cartão precisa vestir o foco por ele, e com
                // contorno sólido — anel a 20% não chega aos 3:1 da WCAG 1.4.11.
                return (
                  <label
                    key={kind}
                    className={`flex cursor-pointer gap-3 rounded-xl border p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600 ${
                      active
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={kind}
                      checked={active}
                      onChange={() => setForm({ ...form, kind })}
                      className="sr-only"
                    />
                    <span
                      className={`mt-0.5 shrink-0 ${active ? 'text-brand-600' : 'text-ink-400'}`}
                    >
                      <KindIcon kind={kind} />
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block text-sm font-medium ${active ? 'text-brand-800' : 'text-ink-800'}`}
                      >
                        {LINK_KIND[kind].label}
                      </span>
                      <span className="mt-1 block truncate text-xs text-ink-500">
                        {kind === 'nominal' ? 'Vale para um número só.' : 'Vale para várias pessoas.'}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <Legend>Setores</Legend>
            {loading ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-40" />
                <Skeleton className="h-10 w-28" />
              </div>
            ) : departments.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-ink-300 bg-ink-50 px-4 py-5 text-sm text-ink-500">
                Nenhum setor ativo.{' '}
                <NextLink href="/admin/setores" className="font-medium text-brand-700 underline">
                  Cadastre um setor
                </NextLink>{' '}
                primeiro.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {departments.map((d) => {
                  const checked = selectedDepts.includes(d.id);
                  // Mesmo motivo do cartão acima: o checkbox real está em sr-only,
                  // e escolher setor às cegas é justamente o erro que custa caro.
                  return (
                    <label
                      key={d.id}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600 ${
                        checked
                          ? 'border-brand-500 bg-brand-50 text-brand-800'
                          : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelectedDepts((prev) =>
                            e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id)
                          )
                        }
                        className="sr-only"
                      />
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300'
                        }`}
                        aria-hidden="true"
                      >
                        {checked && (
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={3}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3 w-3"
                          >
                            <path d="m5 12.5 4.5 4.5L19 7" />
                          </svg>
                        )}
                      </span>
                      {d.name}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">
              O que ela vai ver:
            </p>
            <MenuPreview names={selectedInMenuOrder.map((d) => d.name)} />
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
            >
              <span className="shrink-0">
                <IconAlert />
              </span>
              {error}
            </p>
          )}

          <Button type="submit" disabled={creating || departments.length === 0}>
            {creating ? 'Criando…' : 'Criar link'}
          </Button>
        </form>
      </Panel>

      <section aria-labelledby="titulo-lista">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h3 id="titulo-lista" className="font-semibold text-ink-900">
            Links criados
          </h3>
          {!loading && !loadError && links.length > 0 && (
            <p className="tabular text-sm text-ink-500">
              {links.length === 1 ? '1 link' : `${links.length} links`}
            </p>
          )}
        </div>

        {loading && (
          <div className="space-y-4">
            <p role="status" className="sr-only">
              Carregando os links.
            </p>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-ink-200/70 bg-white p-5 shadow-[var(--shadow-card)]"
              >
                <Skeleton className="h-5 w-48" />
                <Skeleton className="mt-3 h-4 w-72" />
                <Skeleton className="mt-3 h-9 w-full" />
              </div>
            ))}
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm text-rose-800" title={loadError}>
                <span className="shrink-0">
                  <IconAlert />
                </span>
                Não foi possível carregar os links.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setLoading(true);
                  void load();
                }}
              >
                Tentar de novo
              </Button>
            </div>
          </div>
        )}

        {!loading && !loadError && links.length === 0 && (
          <div className="rounded-2xl border border-ink-200/70 bg-white shadow-[var(--shadow-card)]">
            <EmptyState
              icon={<IconLinkCard />}
              title="Nenhum link ainda"
              description="Crie o primeiro no formulário acima."
            />
          </div>
        )}

        {!loading && !loadError && links.length > 0 && (
          <ul className="space-y-4">
            {links.map((l) => (
              <li key={l.id}>
                <article
                  className={`rounded-2xl border p-5 ${
                    l.active
                      ? 'border-ink-200/70 bg-white shadow-[var(--shadow-card)]'
                      : 'border-ink-200 bg-ink-50'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4
                          title={l.label}
                          className={`max-w-full truncate text-base font-semibold ${l.active ? 'text-ink-900' : 'text-ink-500'}`}
                        >
                          {l.label}
                        </h4>
                        <span title={LINK_KIND[l.kind].explain} className="cursor-help">
                          <Badge tone={l.active ? 'neutral' : 'muted'}>
                            <KindIcon kind={l.kind} />
                            {LINK_KIND[l.kind].label}
                          </Badge>
                        </span>
                        {!l.active && (
                          <Badge tone="muted">
                            Revogado{l.revokedAt ? ` em ${formatDate(l.revokedAt)}` : ''}
                          </Badge>
                        )}
                      </div>

                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
                        <span className="tabular font-mono text-ink-700">[{l.entryCode}]</span>
                        <span title={USE_COUNT_HINT} className="tabular cursor-help">
                          {l.useCount === 1 ? '1 abertura' : `${l.useCount} aberturas`}
                        </span>
                        <span>criado em {formatDate(l.createdAt)}</span>
                        {l.holderNote && <span className="text-ink-600">{l.holderNote}</span>}
                      </p>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wide text-ink-400">
                          Setores
                        </span>
                        {l.departments.map((d) => (
                          <Badge key={d.id} tone={l.active ? 'success' : 'muted'}>
                            {d.name}
                          </Badge>
                        ))}
                      </div>

                      <p
                        className={`break-all rounded-lg px-3 py-2 font-mono text-xs ${
                          l.active ? 'bg-ink-50 text-ink-600' : 'bg-white text-ink-400'
                        }`}
                      >
                        {l.url}
                      </p>
                    </div>

                    <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-col sm:items-stretch">
                      {l.active && (
                        <>
                          <Button
                            variant="secondary"
                            className="min-w-40"
                            onClick={() => void copyUrl(l)}
                            title="Copia o endereço para colar no WhatsApp ou no e-mail"
                          >
                            {copiedId === l.id ? (
                              <>
                                <span className="text-brand-600">
                                  <IconCheck />
                                </span>
                                Copiado
                              </>
                            ) : (
                              'Copiar URL'
                            )}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={qrBusyId === l.id}
                            onClick={() => void downloadQr(l)}
                            title="Baixa uma imagem do código para imprimir ou colar em um aviso"
                          >
                            {qrBusyId === l.id ? 'Gerando…' : 'QR (PNG)'}
                          </Button>
                        </>
                      )}
                      <Button
                        variant="secondary"
                        onClick={() => void showContacts(l)}
                        title="Mostra os números de WhatsApp já vinculados a este link"
                      >
                        Ver números
                      </Button>
                      {l.active && (
                        <Button variant="danger" onClick={() => setToRevoke(l)}>
                          Revogar
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      {contactsOf && (
        <Modal
          title={`Números de “${contactsOf.link.label}”`}
          labelledBy="titulo-contatos"
          onClose={() => setContactsOf(null)}
          footer={
            <Button variant="secondary" onClick={() => setContactsOf(null)}>
              Fechar
            </Button>
          }
        >
          {!contactsOf.rows && !contactsOf.error && (
            <div className="space-y-2" aria-hidden="true">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-6 w-3/5" />
            </div>
          )}

          {contactsOf.error && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
            >
              {contactsOf.error}
            </p>
          )}

          {contactsOf.rows && contactsOf.rows.length === 0 && (
            <p className="rounded-xl border border-dashed border-ink-300 bg-ink-50 px-4 py-6 text-center text-sm text-ink-500">
              Nenhum número vinculado ainda.
            </p>
          )}

          {contactsOf.rows && contactsOf.rows.length > 0 && (
            <table className="w-full text-sm">
              <caption
                className="mb-3 text-left text-xs text-ink-500"
                title="Depois do vínculo, a pessoa não precisa mais digitar o código."
              >
                Números que já usaram este link.
              </caption>
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="pb-2 font-medium">
                    Número
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Vinculado em
                  </th>
                </tr>
              </thead>
              <tbody>
                {contactsOf.rows.map((c) => (
                  <tr key={c.id} className="border-b border-ink-100 last:border-0">
                    <td className="py-2">
                      <span className="tabular font-mono text-ink-800">
                        {formatPhone(c.waNumber)}
                      </span>
                      {c.blocked && (
                        <span className="ml-2 align-middle">
                          <Badge tone="danger">Bloqueado</Badge>
                        </span>
                      )}
                    </td>
                    <td className="tabular py-2 text-right text-ink-500">
                      {formatDate(c.firstSeenAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {toRevoke && (
        <Modal
          title="Revogar este link"
          labelledBy="titulo-revogar"
          onClose={() => {
            if (!revoking) setToRevoke(null);
          }}
          footer={
            <>
              <Button variant="secondary" disabled={revoking} onClick={() => setToRevoke(null)}>
                Manter o acesso
              </Button>
              <Button variant="danger" disabled={revoking} onClick={() => void confirmRevoke()}>
                {revoking ? 'Revogando…' : 'Revogar mesmo assim'}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-600">
            Quem usa <strong className="font-medium text-ink-900">“{toRevoke.label}”</strong> perde o
            acesso na próxima mensagem, e o link não pode ser reativado.
          </p>
        </Modal>
      )}

      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-[var(--shadow-lift)] ${
            notice.tone === 'error'
              ? 'border-rose-200 bg-white text-rose-800'
              : 'border-brand-200 bg-white text-brand-800'
          }`}
        >
          <span className="mt-0.5 shrink-0">
            {notice.tone === 'error' ? <IconAlert /> : <IconCheck />}
          </span>
          <span className="leading-relaxed">{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Fechar aviso"
            className="ml-1 shrink-0 rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
          >
            <IconClose />
          </button>
        </div>
      )}
    </div>
  );
}
