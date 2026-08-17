'use client';

import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';

interface ThreadDetail {
  id: string;
  status: 'open' | 'closed';
  from: { id: string; name: string };
  to: { id: string; name: string };
  mine: boolean;
}

interface InternalMessage {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
  mine: boolean;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function IconVoltar() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function IconEnviar() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M4.5 12h13" />
      <path d="M12.5 6.5 18.5 12l-6 5.5" />
    </svg>
  );
}

export default function RamalThreadPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [mensagens, setMensagens] = useState<InternalMessage[] | null>(null);
  const [rascunho, setRascunho] = useState('');
  const [enviando, setEnviando] = useState(false);
  // dois estados: o polling limpa o erro de CARGA a cada rodada, e apagaria o
  // aviso de envio junto — a pessoa acharia que a mensagem foi
  const [erro, setErro] = useState<string | null>(null);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement | null>(null);
  const contagem = useRef(0);

  const carregar = useCallback(async () => {
    try {
      const [detalhe, rows] = await Promise.all([
        api<ThreadDetail>(`/agent/internal/${id}`),
        api<InternalMessage[]>(`/agent/internal/${id}/messages`),
      ]);
      setThread(detalhe);
      setMensagens(rows);
      setErro(null);
      // só rola quando chega mensagem nova, senão o polling rouba a rolagem de
      // quem está lendo o começo da conversa
      if (rows.length !== contagem.current) {
        contagem.current = rows.length;
        setTimeout(() => fim.current?.scrollIntoView({ behavior: 'smooth' }), 40);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'não foi possível carregar');
      setMensagens((atual) => atual ?? []);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 5000);
    return () => clearInterval(t);
  }, [carregar]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const texto = rascunho.trim();
    if (!texto || enviando) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      await api(`/agent/internal/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: texto }),
      });
      setRascunho('');
      await carregar();
    } catch (err) {
      setErroEnvio(err instanceof Error ? err.message : 'não foi possível enviar agora');
    } finally {
      setEnviando(false);
    }
  }

  async function encerrar() {
    setErroEnvio(null);
    try {
      await api(`/agent/internal/${id}/close`, { method: 'POST' });
      router.push('/ramais');
    } catch (err) {
      setErroEnvio(err instanceof Error ? err.message : 'não foi possível encerrar agora');
    }
  }

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col bg-white">
      <header className="flex items-center gap-2 border-b border-ink-200 px-2 py-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push('/ramais')}
          aria-label="Voltar para a lista de ramais"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-600 hover:bg-ink-50"
        >
          <IconVoltar />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-brand-800">
            {thread ? (thread.mine ? thread.to.name : thread.from.name) : 'Conversa entre setores'}
          </h1>
          <p className="truncate text-xs text-ink-500">
            {thread ? (
              <>
                você responde como {thread.mine ? thread.from.name : thread.to.name}
                {thread.status === 'closed' && ' · encerrada'}
              </>
            ) : (
              'Só quem é do hospital vê esta conversa'
            )}
          </p>
        </div>
        {thread?.status !== 'closed' && (
          <Button variant="secondary" onClick={encerrar}>
            Encerrar
          </Button>
        )}
      </header>

      <div className="chat-canvas flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-4">
        {mensagens === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-2/3" />
          </div>
        ) : (
          mensagens.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                  m.mine ? 'bg-brand-600 text-white' : 'border border-ink-200 bg-white text-ink-900'
                }`}
              >
                {!m.mine && (
                  <p className="mb-0.5 text-xs font-medium text-brand-700">{m.author.name}</p>
                )}
                <p className="whitespace-pre-line text-sm leading-relaxed">{m.body}</p>
              </div>
              <time
                dateTime={m.createdAt}
                className={`tabular mt-0.5 px-1 text-[11px] ${m.mine ? 'text-ink-400' : 'text-ink-400'}`}
              >
                {hora(m.createdAt)}
              </time>
            </div>
          ))
        )}
        <div ref={fim} />
      </div>

      {(erroEnvio || erro) && (
        <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {erroEnvio ?? erro}.
        </p>
      )}

      {thread?.status === 'closed' ? (
        <p className="border-t border-ink-200 px-4 py-4 text-center text-sm text-ink-500">
          Esta conversa foi encerrada. Chame o setor de novo pela lista de ramais.
        </p>
      ) : (
      <form
        onSubmit={enviar}
        className="flex items-end gap-2 border-t border-ink-200 px-3 py-3 sm:px-4"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <textarea
          rows={1}
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia, Shift+Enter quebra linha — como todo app de mensagem
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void enviar(e as unknown as FormEvent);
            }
          }}
          placeholder="Escreva para o setor"
          aria-label="Mensagem para o outro setor"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-ink-300 px-4 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
        />
        <button
          type="submit"
          disabled={enviando || !rascunho.trim()}
          aria-label="Enviar"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white disabled:opacity-40"
        >
          <IconEnviar />
        </button>
      </form>
      )}
    </div>
  );
}
