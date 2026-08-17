'use client';

import { useParams, useRouter } from 'next/navigation';
import { Fragment, FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Badge, Button, Dot, EmptyState, ExplainCard, Skeleton } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { CONVERSATION_STATUS, formatPhone } from '@/lib/labels';

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

function readError(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function sameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return date.toLocaleDateString(
    'pt-BR',
    date.getFullYear() === today.getFullYear()
      ? { day: '2-digit', month: 'long' }
      : { day: '2-digit', month: 'long', year: 'numeric' }
  );
}

function clockLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function ConversaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentFlash, setSentFlash] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const countRef = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // cada montagem do polling ganha um número; resposta de rodada antiga é descartada
  const runRef = useRef(0);

  const load = useCallback(async () => {
    const run = runRef.current;
    try {
      const [rows, msgs] = await Promise.all([
        api<ConversationRow[]>('/agent/conversations'),
        api<MessageRow[]>(`/agent/conversations/${id}/messages`),
      ]);
      if (runRef.current !== run) return;
      setConversation((previous) => rows.find((c) => c.id === id) ?? previous);
      setMessages(msgs);
      setLoadError(null);
      setLoaded(true);
      if (msgs.length !== countRef.current) {
        countRef.current = msgs.length;
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    } catch (err) {
      if (runRef.current !== run) return;
      setLoadError(readError(err, 'não foi possível falar com o servidor'));
    }
  }, [id]);

  useEffect(() => {
    runRef.current += 1;
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => {
      runRef.current += 1;
      clearInterval(interval);
    };
  }, [load]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await api(`/agent/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      });
      setDraft('');
      const msgs = await api<MessageRow[]>(`/agent/conversations/${id}/messages`);
      setMessages(msgs);
      countRef.current = msgs.length;
      setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
      setSentFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSentFlash(false), 2500);
    } catch (err) {
      // a conversa pode ter sido encerrada por inatividade enquanto o atendente
      // digitava; o texto fica no campo para ele copiar ou tentar de novo
      setSendError(readError(err, 'não foi possível enviar agora'));
    } finally {
      setSending(false);
    }
  }

  async function close() {
    setClosing(true);
    setCloseError(null);
    try {
      await api(`/agent/conversations/${id}/close`, { method: 'POST' });
      router.push('/conversas');
    } catch (err) {
      setCloseError(readError(err, 'não foi possível encerrar agora'));
      setClosing(false);
    }
  }

  const status = conversation ? CONVERSATION_STATUS[conversation.status] : undefined;

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col bg-white">
      <header className="border-b border-ink-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            {loaded && conversation ? (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h1
                    className="truncate text-lg font-semibold text-brand-800"
                    title="Link de acesso que esta pessoa usou para escrever ao hospital"
                  >
                    {conversation.entryLinkLabelSnapshot}
                  </h1>
                  {status && (
                    <Badge tone={status.tone}>
                      <Dot tone={status.tone} />
                      {status.label}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-600">
                  <span>{conversation.departmentName ?? 'Setor ainda não escolhido'}</span>
                  <span aria-hidden="true" className="text-ink-300">
                    ·
                  </span>
                  <span className="tabular">{formatPhone(conversation.contactNumber)}</span>
                </p>
              </>
            ) : loaded ? (
              <>
                <h1 className="text-lg font-semibold text-brand-800">Conversa</h1>
                <p className="mt-1 text-sm text-ink-600">Não está mais na sua lista.</p>
              </>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-4 w-64" />
              </div>
            )}
          </div>

          <nav aria-label="Ações da conversa" className="flex shrink-0 gap-2">
            <Button variant="secondary" onClick={() => router.push('/conversas')}>
              <ArrowLeftIcon />
              Voltar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setCloseError(null);
                setConfirmingClose(true);
              }}
            >
              Encerrar
            </Button>
          </nav>
        </div>

        <div className="px-4 pb-4 sm:px-6">
          <ExplainCard>
            <ul className="list-disc space-y-1.5 pl-4">
              <li>
                <strong>Resposta automática</strong>: o sistema mandou sozinho, sem atendente.
              </li>
              <li>
                Se a pessoa escrever <strong>MENU</strong>, ela volta à lista de setores que o link
                dela permite.
              </li>
              <li>Sem mensagem nova por 30 minutos, a conversa encerra sozinha.</li>
              <li>Ao encerrar, a pessoa recebe a pesquisa de satisfação.</li>
            </ul>
          </ExplainCard>
        </div>
      </header>

      <main className="chat-canvas flex-1 overflow-y-auto px-3 py-5 sm:px-6">
        {loaded && loadError && (
          <p className="sticky top-0 z-10 mx-auto mb-4 w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 shadow-[var(--shadow-card)]">
            Sem atualizar agora. Tentando de novo…
          </p>
        )}

        {!loaded && !loadError && (
          <div className="mx-auto flex max-w-2xl flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-14 w-3/5 rounded-2xl" />
            <Skeleton className="h-10 w-2/5 self-end rounded-2xl" />
            <Skeleton className="h-20 w-2/3 rounded-2xl" />
            <Skeleton className="h-12 w-1/2 self-end rounded-2xl" />
          </div>
        )}

        {!loaded && loadError && (
          <div className="mx-auto mt-8 max-w-md rounded-2xl border border-ink-200/70 bg-white p-6 text-center shadow-[var(--shadow-card)]">
            <p className="font-medium text-ink-700">Não foi possível abrir a conversa</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">{loadError}</p>
            <Button variant="secondary" className="mt-4" onClick={() => void load()}>
              Tentar de novo
            </Button>
          </div>
        )}

        {loaded && messages.length === 0 && (
          <div className="mx-auto mt-8 max-w-md rounded-2xl border border-ink-200/70 bg-white shadow-[var(--shadow-card)]">
            <EmptyState
              icon={<ChatIcon />}
              title="Nenhuma mensagem ainda"
              description="Escreva abaixo e a mensagem chega no WhatsApp dela."
            />
          </div>
        )}

        {loaded && messages.length > 0 && (
          <ol aria-live="polite" className="mx-auto flex max-w-2xl flex-col gap-1.5">
            {messages.map((m, i) => {
              const previous = i > 0 ? messages[i - 1] : undefined;
              const newDay = !previous || !sameDay(previous.createdAt, m.createdAt);
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <li className="my-3 flex justify-center">
                      <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-ink-600 shadow-[var(--shadow-card)]">
                        {dayLabel(m.createdAt)}
                      </span>
                    </li>
                  )}
                  <MessageBubble message={m} />
                </Fragment>
              );
            })}
          </ol>
        )}

        <div ref={bottomRef} className="h-px" />
      </main>

      <form onSubmit={send} className="border-t border-ink-200 bg-white px-3 py-3 sm:px-6">
        {sendError && (
          <div
            role="alert"
            className="mb-3 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800"
          >
            <span className="mt-0.5 shrink-0 text-rose-500">
              <AlertIcon />
            </span>
            <p className="flex-1 leading-relaxed">Não enviou: {sendError}.</p>
            <button
              type="button"
              onClick={() => setSendError(null)}
              aria-label="Fechar aviso"
              className="-mr-1 shrink-0 rounded-lg p-1 text-rose-500 hover:bg-rose-100"
            >
              <CloseIcon />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor="resposta" className="sr-only">
            Sua resposta
          </label>
          <input
            id="resposta"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Escreva sua resposta"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-2xl border border-ink-300 bg-white px-4 py-3 text-sm outline-none placeholder:text-ink-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            aria-label="Enviar mensagem"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-[var(--shadow-card)] hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-300 disabled:text-ink-500"
          >
            {sending ? <SpinnerIcon /> : <SendIcon />}
          </button>
        </div>

        <p aria-live="polite" className="mt-1.5 h-4 px-1 text-xs text-ink-500">
          {sending ? 'Enviando…' : sentFlash ? 'Mensagem enviada' : ''}
        </p>
      </form>

      {confirmingClose && (
        <ConfirmDialog
          title="Encerrar esta conversa"
          description="A pessoa recebe a pesquisa de satisfação e a conversa sai da sua lista."
          confirmLabel="Encerrar conversa"
          cancelLabel="Manter aberta"
          errorPrefix="Não foi possível encerrar"
          pendingLabel="Encerrando…"
          pending={closing}
          error={closeError}
          onCancel={() => setConfirmingClose(false)}
          onConfirm={close}
        />
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: MessageRow }) {
  const time = (
    <time dateTime={message.createdAt} className="tabular">
      {clockLabel(message.createdAt)}
    </time>
  );

  if (message.senderType === 'system') {
    return (
      <li className="my-2 flex justify-center">
        <div className="max-w-[85%] rounded-xl bg-white/75 px-3 py-2 text-center shadow-[var(--shadow-card)]">
          <span
            className="block text-[10px] uppercase tracking-wide text-ink-400"
            title="Mensagem que o sistema enviou sozinho, sem atendente"
          >
            resposta automática
          </span>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-600">
            {message.body}
          </p>
          <span className="mt-1 block text-[10px] text-ink-400">{time}</span>
        </div>
      </li>
    );
  }

  const fromAgent = message.senderType === 'agent';

  return (
    <li className={`flex ${fromAgent ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-[var(--shadow-card)] sm:max-w-[72%] ${
          fromAgent
            ? 'rounded-tr-none bg-[var(--color-wa-bubble)] text-ink-900'
            : 'rounded-tl-none bg-white text-ink-900'
        }`}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
        <span className="mt-1 block text-right text-[11px] text-ink-500">{time}</span>
      </div>
    </li>
  );
}


function iconProps(): {
  width: number;
  height: number;
  viewBox: string;
  fill: 'none';
  stroke: 'currentColor';
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  'aria-hidden': 'true';
} {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  };
}

function SendIcon(): ReactNode {
  return (
    <svg {...iconProps()} width={20} height={20}>
      <path d="M4.5 12 20 4.5 14.5 20l-3-6.5-7-1.5Z" />
      <path d="m11.5 13.5 4-4" />
    </svg>
  );
}

function SpinnerIcon(): ReactNode {
  return (
    <svg {...iconProps()} width={20} height={20} className="animate-spin">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function ArrowLeftIcon(): ReactNode {
  return (
    <svg {...iconProps()} width={16} height={16}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </svg>
  );
}

function CloseIcon(): ReactNode {
  return (
    <svg {...iconProps()} width={16} height={16}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function AlertIcon(): ReactNode {
  return (
    <svg {...iconProps()} width={18} height={18}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function ChatIcon(): ReactNode {
  return (
    <svg {...iconProps()} width={40} height={40}>
      <path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-5.5A8 8 0 0 1 8 4h5a8 8 0 0 1 8 8Z" />
      <path d="M9 11h7" />
      <path d="M9 14.5h4" />
    </svg>
  );
}
