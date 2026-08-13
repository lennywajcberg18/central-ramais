'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, API_URL, getToken } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  active: boolean;
}

interface LinkRow {
  id: string;
  url: string;
  entryCode: string;
  kind: 'profile' | 'nominal';
  label: string;
  holderNote: string | null;
  active: boolean;
  useCount: number;
  departments: { id: string; name: string }[];
}

interface ContactRow {
  id: string;
  waNumber: string;
  blocked: boolean;
  firstSeenAt: string;
}

export default function LinksPage() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({ label: '', holderNote: '', kind: 'profile' as 'profile' | 'nominal' });
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [contactsOf, setContactsOf] = useState<{ link: LinkRow; rows: ContactRow[] } | null>(null);

  async function load() {
    const [l, d] = await Promise.all([
      api<LinkRow[]>('/admin/entry-links'),
      api<Department[]>('/admin/departments'),
    ]);
    setLinks(l);
    setDepartments(d.filter((x) => x.active));
  }

  useEffect(() => {
    load();
  }, []);

  async function createLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (selectedDepts.length === 0) {
      setError('Selecione ao menos um setor.');
      return;
    }
    try {
      await api('/admin/entry-links', {
        method: 'POST',
        body: JSON.stringify({
          label: form.label,
          holderNote: form.holderNote || undefined,
          kind: form.kind,
          departmentIds: selectedDepts,
        }),
      });
      setForm({ label: '', holderNote: '', kind: 'profile' });
      setSelectedDepts([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro ao criar link');
    }
  }

  async function revoke(link: LinkRow) {
    if (!confirm(`Revogar o link "${link.label}"? Todos os contatos vinculados perdem o acesso.`)) return;
    await api(`/admin/entry-links/${link.id}/revoke`, { method: 'POST' });
    await load();
  }

  async function showContacts(link: LinkRow) {
    const rows = await api<ContactRow[]>(`/admin/entry-links/${link.id}/contacts`);
    setContactsOf({ link, rows });
  }

  async function downloadQr(link: LinkRow) {
    const res = await fetch(`${API_URL}/admin/entry-links/${link.id}/qrcode`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-${link.label.toLowerCase().replace(/\s+/g, '-')}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-lg font-semibold">Links de acesso</h2>

      <form onSubmit={createLink} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-3 gap-2">
          <input
            required
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder='Rótulo (ex: "Médico Externo")'
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
          <input
            value={form.holderNote}
            onChange={(e) => setForm({ ...form, holderNote: e.target.value })}
            placeholder="Observação (CRM, leito…)"
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as 'profile' | 'nominal' })}
            className="rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="profile">Perfil (vários números)</option>
            <option value="nominal">Nominal (um número só)</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {departments.map((d) => (
            <label key={d.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selectedDepts.includes(d.id)}
                onChange={(e) =>
                  setSelectedDepts((prev) =>
                    e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id)
                  )
                }
              />
              {d.name}
            </label>
          ))}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
          Criar link
        </button>
      </form>

      <div className="space-y-3">
        {links.map((l) => (
          <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{l.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      l.kind === 'nominal'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {l.kind === 'nominal' ? 'Nominal' : 'Perfil'}
                  </span>
                  {!l.active && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      Revogado
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Código <b>[{l.entryCode}]</b> · Setores: {l.departments.map((d) => d.name).join(', ')}
                  {l.holderNote ? ` · ${l.holderNote}` : ''} · {l.useCount} usos
                </p>
                <p className="mt-1 break-all font-mono text-xs text-slate-400">{l.url}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(l.url)}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
                >
                  Copiar URL
                </button>
                <button
                  onClick={() => downloadQr(l)}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
                >
                  QR (PNG)
                </button>
                <button
                  onClick={() => showContacts(l)}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
                >
                  Contatos
                </button>
                {l.active && (
                  <button
                    onClick={() => revoke(l)}
                    className="rounded-lg bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Revogar
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {contactsOf && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setContactsOf(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 font-semibold">Contatos de “{contactsOf.link.label}”</h3>
            {contactsOf.rows.length === 0 && (
              <p className="text-sm text-slate-500">Nenhum número vinculado ainda.</p>
            )}
            <ul className="space-y-1 text-sm">
              {contactsOf.rows.map((c) => (
                <li key={c.id} className="flex justify-between">
                  <span className="font-mono">{c.waNumber}</span>
                  <span className="text-slate-400">
                    desde {new Date(c.firstSeenAt).toLocaleDateString('pt-BR')}
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setContactsOf(null)}
              className="mt-4 w-full rounded-lg border border-slate-300 py-2 text-sm"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
