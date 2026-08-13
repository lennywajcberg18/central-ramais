'use client';

import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

interface MessageRow {
  id: string;
  direction: 'inbound' | 'outbound';
  senderType: 'customer' | 'agent' | 'system';
  body: string;
  createdAt: string;
}

interface ConversationRow {
  id: string;
  status: string;
  departmentName: string | null;
  entryLinkLabelSnapshot: string;
  contactNumber: string;
}

export default function ConversaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const countRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [conversations, msgs] = await Promise.all([
          api<ConversationRow[]>('/agent/conversations'),
          api<MessageRow[]>(`/agent/conversations/${id}/messages`),
        ]);
        if (cancelled) return;
        setConversation(conversations.find((c) => c.id === id) ?? conversation);
        setMessages(msgs);
        if (msgs.length !== countRef.current) {
          countRef.current = msgs.length;
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        }
      } catch {
        // erro transitório — o polling tenta de novo
      }
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    try {
      await api(`/agent/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: draft.trim() }),
      });
      setDraft('');
      const msgs = await api<MessageRow[]>(`/agent/conversations/${id}/messages`);
      setMessages(msgs);
      countRef.current = msgs.length;
      setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
    } finally {
      setSending(false);
    }
  }

  async function close() {
    if (!confirm('Encerrar esta conversa?')) return;
    await api(`/agent/conversations/${id}/close`, { method: 'POST' });
    router.push('/conversas');
  }

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          {/* o rótulo do link diz ao agente com QUEM ele está falando */}
          <h1 className="font-semibold text-blue-700">
            {conversation?.entryLinkLabelSnapshot ?? '…'}
          </h1>
          <p className="text-xs text-slate-500">
            {conversation?.departmentName ?? ''} · {conversation?.contactNumber ?? ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/conversas')}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
          >
            Voltar
          </button>
          <button
            onClick={close}
            className="rounded-lg bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
          >
            Encerrar
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-2 overflow-y-auto bg-slate-100 p-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm shadow-sm ${
                m.senderType === 'customer'
                  ? 'bg-white'
                  : m.senderType === 'agent'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-200 text-slate-600'
              }`}
            >
              {m.body}
              <div
                className={`mt-1 text-right text-[10px] ${
                  m.senderType === 'agent' ? 'text-blue-200' : 'text-slate-400'
                }`}
              >
                {new Date(m.createdAt).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <form onSubmit={send} className="flex gap-2 border-t border-slate-200 bg-white p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escreva sua resposta…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
