'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AgentHeader from '@/components/AgentHeader';
import { api } from '@/lib/api';

interface ConversationRow {
  id: string;
  status: string;
  departmentName: string | null;
  entryLinkLabelSnapshot: string;
  contactNumber: string;
  assignedUserId: string | null;
  lastMessageAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  awaiting_department: 'Escolhendo setor',
  open: 'Na fila',
  assigned: 'Em atendimento',
  awaiting_menu_confirm: 'Confirmando menu',
};

export default function ConversasPage() {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<ConversationRow[]>('/agent/conversations');
        if (!cancelled) {
          setRows(data);
          setLoaded(true);
        }
      } catch {
        // erro transitório de rede — a próxima rodada do polling tenta de novo
      }
    }
    load();
    const interval = setInterval(load, 5000); // polling 5s
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <AgentHeader />
      <main className="space-y-2 p-4">
        {loaded && rows.length === 0 && (
          <p className="pt-8 text-center text-slate-500">Nenhuma conversa no momento.</p>
        )}
        {rows.map((c) => (
          <Link
            key={c.id}
            href={`/conversas/${c.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-400"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{c.entryLinkLabelSnapshot}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  c.status === 'open'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-blue-100 text-blue-700'
                }`}
              >
                {STATUS_LABEL[c.status] ?? c.status}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm text-slate-500">
              <span>
                {c.departmentName ?? 'Sem setor'} · {c.contactNumber}
              </span>
              <span>{new Date(c.lastMessageAt).toLocaleTimeString('pt-BR')}</span>
            </div>
          </Link>
        ))}
      </main>
    </div>
  );
}
