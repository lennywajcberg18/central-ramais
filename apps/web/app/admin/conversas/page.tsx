'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Dot,
  EmptyState,
  ExplainCard,
  PageHeader,
  Panel,
  Skeleton,
} from '@/components/ui';
import { api } from '@/lib/api';
import { CLOSE_REASON, CONVERSATION_STATUS, formatPhone, relativeTime } from '@/lib/labels';

interface Row {
  id: string;
  status: string;
  closeReason: string | null;
  departmentName: string | null;
  assignedUserName: string | null;
  entryLinkLabelSnapshot: string;
  contactNumber: string;
  messageCount: number;
  score: number | null;
  createdAt: string;
  lastMessageAt: string;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  senderType: 'customer' | 'agent' | 'system';
  body: string;
  createdAt: string;
}

interface Detail {
  conversation: Row & { comment: string | null; closedAt: string | null };
  messages: Message[];
}

const FILTROS = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'fila', rotulo: 'Esperando atendente' },
  { valor: 'abertas', rotulo: 'Em andamento' },
  { valor: 'encerradas', rotulo: 'Encerradas' },
] as const;

function Situacao({ row }: { row: Row }) {
  const estado = CONVERSATION_STATUS[row.status];
  // Nunca mostrar o código cru do banco ("assigned") para quem trabalha no hospital.
  if (!estado) return <Badge tone="muted">Situação desconhecida</Badge>;
  return (
    <Badge tone={estado.tone}>
      <Dot tone={estado.tone} />
      {estado.label}
    </Badge>
  );
}

function Autor({ message }: { message: Message }) {
  if (message.senderType === 'customer') return <>Pessoa de fora</>;
  if (message.senderType === 'agent') return <>Atendente</>;
  return <>Mensagem automática</>;
}

export default function AdminConversasPage() {
  const [situacao, setSituacao] = useState<string>('todas');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<Detail | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [lidoEm, setLidoEm] = useState<string | null>(null);

  // Com leitura automática há sempre mais de uma requisição em voo: se o gestor
  // troca de filtro no meio de uma, a resposta antiga chega depois e repinta a
  // lista com o filtro errado.
  const requisicao = useRef(0);
  const gaveta = useRef<HTMLElement>(null);
  const origemDoFoco = useRef<HTMLElement | null>(null);

  const carregar = useCallback(async () => {
    const daVez = ++requisicao.current;
    setErro(null);
    try {
      const dados = await api<Row[]>(`/admin/conversations?situacao=${situacao}`);
      if (daVez !== requisicao.current) return;
      setRows(dados);
      setLidoEm(new Date().toISOString());
    } catch (err) {
      if (daVez !== requisicao.current) return;
      setErro(err instanceof Error ? err.message : 'não foi possível carregar');
    }
  }, [situacao]);

  useEffect(() => {
    setRows(null);
    setLidoEm(null);
    carregar();
    // A tela de quem gerencia fica aberta o dia inteiro. Sem releitura, o gestor
    // olha uma fila lida de manhã, vê vazio e diz que está tudo certo.
    const intervalo = setInterval(carregar, 10000);
    return () => clearInterval(intervalo);
  }, [carregar]);

  const gavetaAberta = aberta !== null || carregandoDetalhe;

  useEffect(() => {
    if (!gavetaAberta) return;
    gaveta.current?.focus();
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setAberta(null);
    }
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      // Sem devolver o foco à linha que abriu a gaveta, quem navega por teclado
      // volta para o topo da página e perde o lugar na lista.
      origemDoFoco.current?.focus();
    };
  }, [gavetaAberta]);

  async function abrir(id: string, origem: HTMLElement) {
    origemDoFoco.current = origem;
    setCarregandoDetalhe(true);
    try {
      setAberta(await api<Detail>(`/admin/conversations/${id}/messages`));
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'não foi possível abrir a conversa');
    } finally {
      setCarregandoDetalhe(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Conversas"
        description="Tudo que já passou pelo WhatsApp do hospital, em andamento ou encerrado."
        action={
          <Button variant="secondary" onClick={carregar}>
            Atualizar
          </Button>
        }
      />

      <ExplainCard>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Quem atende só enxerga a fila dos setores dele. Esta tela é a visão do hospital
            inteiro, inclusive dos atendimentos já encerrados.
          </li>
          <li>
            <span className="font-medium">Esperando atendente</span> é a fila: a pessoa já escolheu
            o setor e ninguém assumiu ainda.
          </li>
          <li>
            Cada conversa guarda o nome do link de acesso usado, mesmo que o link seja renomeado ou
            revogado depois.
          </li>
        </ul>
      </ExplainCard>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
        {FILTROS.map((f) => (
          <Button
            key={f.valor}
            variant={situacao === f.valor ? 'primary' : 'secondary'}
            onClick={() => setSituacao(f.valor)}
          >
            {f.rotulo}
          </Button>
        ))}
      </div>

      {erro && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {erro}
        </p>
      )}

      <Panel>
        {rows === null ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nenhuma conversa nesta situação"
            description="As conversas aparecem aqui assim que alguém de fora escreve para o hospital."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {rows.map((c) => (
              <li key={c.id}>
                <button
                  onClick={(e) => abrir(c.id, e.currentTarget)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-left hover:bg-ink-50"
                >
                  <span className="min-w-[12rem] flex-1">
                    <span className="block text-sm font-medium text-ink-900">
                      {c.entryLinkLabelSnapshot}
                    </span>
                    <span className="tabular block text-xs text-ink-500">
                      {formatPhone(c.contactNumber)}
                    </span>
                  </span>
                  <span className="min-w-[7rem] text-sm text-ink-600">
                    {c.departmentName ?? 'Sem setor ainda'}
                  </span>
                  <span className="min-w-[9rem] text-sm text-ink-600">
                    {c.assignedUserName ?? '—'}
                  </span>
                  <Situacao row={c} />
                  <span className="tabular min-w-[5rem] text-right text-xs text-ink-400">
                    {relativeTime(c.lastMessageAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {lidoEm && (
        <footer className="px-1 text-xs text-ink-400">
          <time
            dateTime={lidoEm}
            className="tabular"
            title="A lista se atualiza sozinha a cada 10 segundos"
          >
            atualizada {relativeTime(lidoEm)}
          </time>
        </footer>
      )}

      {gavetaAberta && (
        <div
          className="fixed inset-0 z-30 flex justify-end bg-ink-900/30"
          onClick={() => setAberta(null)}
        >
          <aside
            ref={gaveta}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Histórico da conversa"
            className="flex h-full w-full max-w-lg flex-col bg-white shadow-[var(--shadow-lift)] outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            {carregandoDetalhe || !aberta ? (
              <div className="space-y-3 p-6">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-24" />
              </div>
            ) : (
              <>
                <header className="border-b border-ink-100 px-6 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold text-ink-900">
                        {aberta.conversation.entryLinkLabelSnapshot}
                      </h3>
                      <p className="tabular mt-0.5 text-sm text-ink-500">
                        {formatPhone(aberta.conversation.contactNumber)} ·{' '}
                        {aberta.conversation.departmentName ?? 'sem setor'}
                      </p>
                    </div>
                    <Button variant="ghost" onClick={() => setAberta(null)}>
                      Fechar
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Situacao row={aberta.conversation} />
                    {aberta.conversation.closeReason && (
                      <Badge tone="muted">
                        {CLOSE_REASON[aberta.conversation.closeReason] ?? 'Encerrada pelo sistema'}
                      </Badge>
                    )}
                    {aberta.conversation.score !== null && (
                      <Badge tone="success">Nota {aberta.conversation.score} de 10</Badge>
                    )}
                  </div>
                  {aberta.conversation.comment && (
                    <p className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-sm italic text-ink-600">
                      “{aberta.conversation.comment}”
                    </p>
                  )}
                </header>

                <div className="chat-canvas flex-1 space-y-2 overflow-y-auto p-4">
                  {aberta.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                          m.senderType === 'agent'
                            ? 'bg-[var(--color-wa-bubble)] text-ink-900'
                            : m.senderType === 'system'
                              ? 'bg-white text-ink-600'
                              : 'bg-white text-ink-800'
                        }`}
                      >
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-400">
                          <Autor message={m} />
                        </p>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        <p className="mt-1 text-right text-[10px] text-ink-400">
                          {new Date(m.createdAt).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
