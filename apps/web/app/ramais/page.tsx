'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import AgentHeader from '@/components/AgentHeader';
import AgentNav from '@/components/AgentNav';
import { Button, EmptyState, Panel, Skeleton, inputClass } from '@/components/ui';
import { api, getSessionUser } from '@/lib/api';

interface DepartmentRow {
  id: string;
  name: string;
  mine: boolean;
}

interface ThreadRow {
  id: string;
  status: 'open' | 'closed';
  from: { id: string; name: string };
  to: { id: string; name: string };
  mine: boolean;
  lastMessage: { body: string; at: string; author: string } | null;
  lastMessageAt: string;
}

function quando(iso: string): string {
  const data = new Date(iso);
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  return mesmoDia
    ? data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function IconRamais() {
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
      <rect x="3" y="4.5" width="8" height="7" rx="1.6" />
      <rect x="13" y="12.5" width="8" height="7" rx="1.6" />
      <path d="M11 8h3.5a2 2 0 0 1 2 2v2.5" />
      <path d="M13 16H9.5a2 2 0 0 1-2-2v-2.5" />
    </svg>
  );
}

export default function RamaisPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const [compondo, setCompondo] = useState(false);
  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  // localStorage não existe no servidor: lido durante a renderização, getSessionUser()
  // devolve null lá e o usuário aqui, o que rende hydration mismatch assim que o valor
  // mudar a saída da primeira renderização. Depois da montagem os dois lados já
  // concordam — é o mesmo padrão de /conversas.
  const [ehAdmin, setEhAdmin] = useState(false);

  useEffect(() => {
    setEhAdmin(getSessionUser()?.role === 'admin');
  }, []);

  const carregar = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([
        api<ThreadRow[]>('/agent/internal'),
        api<DepartmentRow[]>('/agent/departments'),
      ]);
      setThreads(t);
      setDepartments(d);
      setErro(null);
      // quem atende um setor só não precisa escolher a origem
      const meus = d.filter((x) => x.mine);
      if (meus.length > 0) setOrigem((atual) => atual || meus[0].id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'não foi possível carregar');
      setThreads((atual) => atual ?? []);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 5000);
    return () => clearInterval(t);
  }, [carregar]);

  async function abrirConversa(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim() || !destino || !origem || enviando) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      const { id } = await api<{ id: string }>('/agent/internal', {
        method: 'POST',
        body: JSON.stringify({ fromDepartmentId: origem, toDepartmentId: destino, body: texto }),
      });
      router.push(`/ramais/${id}`);
    } catch (err) {
      setErroEnvio(err instanceof Error ? err.message : 'não foi possível enviar agora');
      setEnviando(false);
    }
  }

  const meusSetores = departments.filter((d) => d.mine);
  const podeAbrir = meusSetores.length > 0;

  return (
    <div className="mx-auto max-w-3xl">
      <AgentHeader />
      <AgentNav />

      <main className="space-y-5 px-4 pb-28 pt-5 sm:px-6 sm:pb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 px-1">
            <h1 className="text-xl font-semibold text-ink-900">Ramais</h1>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">
              Um setor falando com outro, por dentro do hospital. Ninguém de fora vê isto.
            </p>
          </div>
          {podeAbrir && !compondo && (
            <Button className="w-full sm:w-auto" onClick={() => setCompondo(true)}>
              Chamar outro setor
            </Button>
          )}
        </div>

        {compondo && (
          <Panel title="Chamar outro setor">
            <form onSubmit={abrirConversa} className="space-y-4 p-5">
              {meusSetores.length > 1 && (
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                    Falando como
                  </span>
                  <select
                    value={origem}
                    onChange={(e) => setOrigem(e.target.value)}
                    className={`${inputClass} mt-1`}
                  >
                    {meusSetores.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Chamar
                </span>
                <select
                  required
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                  className={`${inputClass} mt-1`}
                >
                  <option value="">Escolha o setor</option>
                  {departments
                    .filter((d) => d.id !== origem)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Mensagem
                </span>
                <textarea
                  required
                  rows={3}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="A guia do leito 4B já foi autorizada?"
                  className={`${inputClass} mt-1 resize-y`}
                />
              </label>

              {erroEnvio && (
                <p
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                >
                  {erroEnvio}.
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={enviando}
                  onClick={() => {
                    setCompondo(false);
                    setErroEnvio(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={enviando}>
                  {enviando ? 'Enviando…' : 'Enviar'}
                </Button>
              </div>
            </form>
          </Panel>
        )}

        {erro && (
          <p
            role="status"
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            Lista não atualizada: {erro}.
          </p>
        )}

        {threads === null ? (
          <Panel>
            <div className="space-y-3 p-5">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          </Panel>
        ) : threads.length === 0 ? (
          <Panel>
            {ehAdmin ? (
              <EmptyState
                icon={<IconRamais />}
                title="Esta tela é de quem atende"
                description="Administrador não fica em nenhum setor, então não participa das conversas entre ramais. Entre com uma conta de atendente para usar."
              />
            ) : (
              <EmptyState
                icon={<IconRamais />}
                title="Nenhuma conversa entre setores"
                description="Quando você chamar outro setor — ou for chamado —, a conversa aparece aqui."
              />
            )}
          </Panel>
        ) : (
          <Panel>
            <ul className="divide-y divide-ink-100">
              {threads.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/ramais/${t.id}`}
                    className="flex min-h-16 items-center gap-3 px-4 py-4 hover:bg-ink-50 sm:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink-900">
                        {t.mine ? (
                          <>
                            <span className="text-ink-500">para</span> {t.to.name}
                          </>
                        ) : (
                          <>
                            <span className="text-ink-500">de</span> {t.from.name}
                          </>
                        )}
                        {t.status === 'closed' && (
                          <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-xs font-normal text-ink-500">
                            encerrada
                          </span>
                        )}
                      </span>
                      {t.lastMessage && (
                        <span className="mt-0.5 block truncate text-sm text-ink-500">
                          {t.lastMessage.author}: {t.lastMessage.body}
                        </span>
                      )}
                    </span>
                    <time
                      dateTime={t.lastMessageAt}
                      className="tabular shrink-0 text-xs text-ink-400"
                    >
                      {quando(t.lastMessageAt)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </main>
    </div>
  );
}
