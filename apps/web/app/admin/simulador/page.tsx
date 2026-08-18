'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  ExplainCard,
  Panel,
  PageHeader,
  Skeleton,
  comportamentoDeRolagem,
  inputClass,
} from '@/components/ui';
import { LINK_KIND, formatPhone } from '@/lib/labels';
import { api } from '@/lib/api';

interface SetupLink {
  id: string;
  entryCode: string;
  label: string;
  kind: string;
  prefillText: string;
  departments: string[];
}

interface Setup {
  whatsappNumber: string | null;
  links: SetupLink[];
}

interface Entry {
  id: string;
  at: string;
  side: 'sent' | 'received';
  kind: 'text' | 'automatic' | 'refused';
  body: string;
}

// Cada pessoa simulada tem um número fixo: repetir o mesmo número é o que faz o
// sistema reconhecer o vínculo criado no primeiro acesso.
const SEM_LINK = { id: 'sem-link', numero: '+5511900000900' };

const TEXTO_SEM_LINK = 'Oi, preciso falar com a Cardiologia';

function numeroDoLink(index: number): string {
  return `+55119000009${String(index + 1).padStart(2, '0')}`;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// O WhatsApp exibe *assim* em negrito; sem isto o asterisco aparece cru e a
// simulação deixa de parecer o que a pessoa veria no celular.
function comNegrito(texto: string) {
  return texto.split(/(\*[^*\n]+\*)/g).map((parte, i) =>
    parte.startsWith('*') && parte.endsWith('*') && parte.length > 2 ? (
      <strong key={i} className="font-semibold">
        {parte.slice(1, -1)}
      </strong>
    ) : (
      <span key={i}>{parte}</span>
    )
  );
}

function IconSend() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="m4 4 16 8-16 8 3-8z" />
    </svg>
  );
}

function IconExternal() {
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
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </svg>
  );
}

// Rótulo curto + atalhos. O que cada tecla faz vive no title, não em parágrafo.
function Atalho({
  label,
  explica,
  teclas,
  onEnviar,
  disabled,
}: {
  label: string;
  explica: string;
  teclas: string[];
  onEnviar: (texto: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3" title={explica}>
      <span className="w-32 shrink-0 text-xs text-ink-500">{label}</span>
      <div className="flex flex-wrap gap-2">
        {teclas.map((t) => (
          <Button
            key={t}
            variant="secondary"
            title={explica}
            onClick={() => onEnviar(t)}
            disabled={disabled}
          >
            {t}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Bolha({ entry }: { entry: Entry }) {
  if (entry.kind === 'automatic' || entry.kind === 'refused') {
    const recusa = entry.kind === 'refused';
    return (
      <div className="flex justify-start">
        <div
          className={`max-w-[85%] rounded-2xl rounded-tl-md px-3 py-2 text-sm leading-relaxed shadow-sm ${
            recusa ? 'bg-rose-50 text-rose-800' : 'bg-white text-ink-800'
          }`}
        >
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-400">
            {recusa ? 'acesso recusado' : 'resposta automática do hospital'}
          </p>
          <p className="whitespace-pre-wrap">{comNegrito(entry.body)}</p>
          <p className="mt-1 text-right text-[10px] text-ink-400">{hora(entry.at)}</p>
        </div>
      </div>
    );
  }

  const meu = entry.side === 'sent';
  return (
    <div className={`flex ${meu ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-3 py-2 text-sm leading-relaxed shadow-sm ${
          meu
            ? 'rounded-2xl rounded-tr-md bg-[var(--color-wa-bubble)] text-ink-900'
            : 'rounded-2xl rounded-tl-md bg-white text-ink-800'
        }`}
      >
        {!meu && (
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-brand-600">
            atendente do hospital
          </p>
        )}
        <p className="whitespace-pre-wrap">{comNegrito(entry.body)}</p>
        <p className="mt-1 text-right text-[10px] text-ink-400">{hora(entry.at)}</p>
      </div>
    </div>
  );
}

export default function SimuladorPage() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [pessoaId, setPessoaId] = useState<string>(SEM_LINK.id);
  const [numero, setNumero] = useState<string>(SEM_LINK.numero);
  const [trocandoNumero, setTrocandoNumero] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Setup>('/admin/simulator/setup')
      .then(setSetup)
      .catch(() => setErro('Não foi possível carregar os links deste hospital.'));
  }, []);

  const carregar = useCallback(async () => {
    try {
      const data = await api<Entry[]>(
        `/admin/simulator/thread?waNumber=${encodeURIComponent(numero)}`
      );
      setEntries(data);
    } catch {
      // erro transitório: a próxima rodada tenta de novo
    }
  }, [numero]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 2500);
    return () => clearInterval(t);
  }, [carregar]);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: comportamentoDeRolagem() });
  }, [entries.length]);

  async function enviar(texto: string) {
    const corpo = texto.trim();
    if (!corpo || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await api('/admin/simulator/inbound', {
        method: 'POST',
        body: JSON.stringify({ waNumber: numero, body: corpo }),
      });
      setDraft('');
      setTimeout(carregar, 400);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'não foi possível enviar');
    } finally {
      setEnviando(false);
    }
  }

  function escolherPessoa(id: string, numeroDela: string) {
    setPessoaId(id);
    setNumero(numeroDela);
    setTrocandoNumero(false);
    setEntries([]);
  }

  const linkAtual = setup?.links.find((l) => l.id === pessoaId) ?? null;
  const primeiraMensagem = linkAtual ? linkAtual.prefillText : TEXTO_SEM_LINK;

  const linhaSelecionada = 'border-brand-500 bg-brand-50 ring-4 ring-brand-500/10';
  const linhaNormal = 'border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulador de WhatsApp"
        description="Escreva como quem está de fora e veja o que o hospital responde."
        action={
          <div className="text-right">
            <div className="flex flex-wrap justify-end gap-2">
              <a
                href="/admin/conversas"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-card)] hover:bg-brand-700"
              >
                <IconExternal />
                Ver a conversa no painel
              </a>
              <a
                href="/conversas"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:border-ink-400 hover:bg-ink-50"
              >
                <IconExternal />
                Tela de quem atende
              </a>
            </div>
            {/* Administrador não fica em setor nenhum: a fila do atendente sempre
                aparece vazia para ele, e isso já confundiu na prática. */}
            <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-ink-500">
              A tela de quem atende só mostra conversa para quem está em algum setor. Entre nela com{' '}
              <span className="font-medium text-ink-700">agente1@hospitalvida.test</span> · 123456
            </p>
          </div>
        }
      />

      <ExplainCard>
        <ul className="list-disc space-y-1 pl-4">
          <li>A mensagem percorre o mesmo caminho de uma mensagem real — nada sai para a operadora.</li>
          <li>O link de acesso decide quais setores a pessoa vê no menu.</li>
          <li>O código entre colchetes só vale na primeira mensagem; depois o telefone já fica vinculado ao link.</li>
          <li>Quem escreve sem link é recusado, e a tentativa aparece em Acessos negados.</li>
        </ul>
      </ExplainCard>

      {erro && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {erro}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="order-2 space-y-4 lg:order-1">
          <Panel
            title="1. Escolha quem escreve"
            hint="Cada pessoa tem um telefone diferente — é assim que o hospital sabe quem é quem."
          >
            <div className="space-y-2 p-5">
              {!setup && (
                <>
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </>
              )}

              {setup?.links.map((l, i) => {
                const numeroDela = numeroDoLink(i);
                const ativo = pessoaId === l.id;
                const tipo = LINK_KIND[l.kind] ?? null;
                return (
                  <button
                    key={l.id}
                    onClick={() => escolherPessoa(l.id, numeroDela)}
                    className={`flex w-full items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left ${
                      ativo ? linhaSelecionada : linhaNormal
                    }`}
                  >
                    {/* nome de link é texto livre: sem truncar, um rótulo longo estica a página inteira */}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink-900" title={l.label}>
                          {l.label}
                        </span>
                        {tipo && (
                          <span title={tipo.explain}>
                            <Badge tone="neutral">{tipo.label}</Badge>
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">
                        Setores: {l.departments.join(', ')}
                      </span>
                    </span>
                    {ativo && <Badge tone="success">selecionada</Badge>}
                  </button>
                );
              })}

              <button
                onClick={() => escolherPessoa(SEM_LINK.id, SEM_LINK.numero)}
                title="Descobriu o número do hospital por outro caminho."
                className={`flex w-full items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left ${
                  pessoaId === SEM_LINK.id ? linhaSelecionada : linhaNormal
                }`}
              >
                <span className="min-w-0">
                  <span className="text-sm font-medium text-ink-900">Alguém sem link de acesso</span>
                  <span className="mt-0.5 block text-xs text-ink-500">Setores: nenhum</span>
                </span>
                {pessoaId === SEM_LINK.id && <Badge tone="success">selecionada</Badge>}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-5 py-3 text-xs text-ink-500">
              <span>Telefone</span>
              {trocandoNumero ? (
                <input
                  autoFocus
                  value={numero}
                  onChange={(e) => setNumero(e.target.value.trim())}
                  onBlur={() => setTrocandoNumero(false)}
                  className={`${inputClass} mt-0 w-48`}
                  aria-label="Telefone de quem escreve"
                />
              ) : (
                <>
                  <span className="tabular font-medium text-ink-700">{formatPhone(numero)}</span>
                  <button
                    onClick={() => {
                      setTrocandoNumero(true);
                      setEntries([]);
                    }}
                    className="font-medium text-brand-700 underline hover:text-brand-800"
                  >
                    trocar
                  </button>
                </>
              )}
              <span className="w-full text-ink-400">
                Troque o telefone para simular outra pessoa usando o mesmo link.
              </span>
            </div>
          </Panel>

          <Panel title="2. Comece a conversa">
            <div className="p-5">
              <Button
                onClick={() => enviar(primeiraMensagem)}
                disabled={enviando}
                className="w-full px-5 py-4 text-base"
                title="É isto que a pessoa envia ao tocar no link que recebeu."
              >
                <IconSend />
                {primeiraMensagem}
              </Button>
            </div>
          </Panel>

          <Panel title="3. Continue">
            <div className="space-y-3 p-5">
              <Atalho
                label="Escolher setor"
                explica="O número do menu escolhe o setor. Só vale para os setores que o link libera."
                teclas={['1', '2', '3']}
                onEnviar={enviar}
                disabled={enviando}
              />
              <Atalho
                label="Trocar de setor"
                explica="MENU mostra de novo a lista de setores do link."
                teclas={['MENU']}
                onEnviar={enviar}
                disabled={enviando}
              />
              <Atalho
                label="Confirmar a troca"
                explica="SIM confirma a troca de setor. NÃO mantém a conversa onde está."
                teclas={['SIM', 'NÃO']}
                onEnviar={enviar}
                disabled={enviando}
              />
              <Atalho
                label="Dar nota"
                explica="No fim do atendimento, um número de 0 a 10 vira a nota de satisfação."
                teclas={['9']}
                onEnviar={enviar}
                disabled={enviando}
              />
            </div>
          </Panel>
        </div>

        {/* o "celular" */}
        <section className="order-1 lg:sticky lg:top-6 lg:order-2 lg:self-start">
          <div className="rounded-[28px] border border-ink-300 bg-ink-900 p-2 shadow-[var(--shadow-lift)]">
            <div className="overflow-hidden rounded-[22px] bg-white">
              <div className="flex items-center gap-3 bg-brand-700 px-4 py-3 text-white">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-sm font-semibold">
                  H
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">Hospital</p>
                  <p className="truncate text-xs text-white/70">
                    {setup?.whatsappNumber ? formatPhone(setup.whatsappNumber) : '…'}
                  </p>
                </div>
              </div>

              <div className="chat-canvas h-[460px] space-y-2 overflow-y-auto p-3">
                {entries.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="max-w-[80%] rounded-xl bg-white/80 px-3 py-2 text-center text-xs leading-relaxed text-ink-500">
                      A conversa aparece aqui. Comece pelo passo 1.
                    </p>
                  </div>
                ) : (
                  entries.map((e) => <Bolha key={e.id} entry={e} />)
                )}
                <div ref={fim} />
              </div>

              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  enviar(draft);
                }}
                className="flex items-center gap-2 border-t border-ink-100 p-2"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escrever como esta pessoa"
                  className="flex-1 rounded-full border border-ink-200 bg-ink-50 px-3 py-2 text-sm outline-none focus:border-brand-500"
                />
                <button
                  type="submit"
                  disabled={enviando || !draft.trim()}
                  aria-label="Enviar"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  <IconSend />
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
