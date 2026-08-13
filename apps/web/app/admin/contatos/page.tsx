'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

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
  active: boolean;
}

export default function ContatosPage() {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);

  async function load() {
    const [c, l] = await Promise.all([
      api<ContactRow[]>('/admin/contacts'),
      api<LinkRow[]>('/admin/entry-links'),
    ]);
    setRows(c);
    setLinks(l.filter((x) => x.active));
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleBlocked(c: ContactRow) {
    await api(`/admin/contacts/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ blocked: !c.blocked }),
    });
    await load();
  }

  async function reassign(c: ContactRow, entryLinkId: string) {
    if (!entryLinkId || entryLinkId === c.entryLink.id) return;
    await api(`/admin/contacts/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ entryLinkId }),
    });
    await load();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-lg font-semibold">Contatos externos</h2>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Número</th>
              <th className="px-4 py-2">Link</th>
              <th className="px-4 py-2">Último contato</th>
              <th className="px-4 py-2">Reatribuir</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={`border-t border-slate-100 ${c.blocked ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2 font-mono">{c.waNumber}</td>
                <td className="px-4 py-2">
                  {c.entryLink.label}
                  {!c.entryLink.active && (
                    <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      revogado
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {new Date(c.lastSeenAt).toLocaleString('pt-BR')}
                </td>
                <td className="px-4 py-2">
                  <select
                    defaultValue=""
                    onChange={(e) => reassign(c, e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="">outro link…</option>
                    {links
                      .filter((l) => l.id !== c.entryLink.id)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.label}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => toggleBlocked(c)}
                    className={`text-sm ${c.blocked ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {c.blocked ? 'Desbloquear' : 'Bloquear'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Nenhum contato ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
