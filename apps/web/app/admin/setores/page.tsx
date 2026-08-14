'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  Badge,
  Button,
  Dot,
  EmptyState,
  ExplainCard,
  Field,
  PageHeader,
  Panel,
  Skeleton,
  inputClass,
} from '@/components/ui';

interface Department {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

type EstadoDaLista = 'carregando' | 'pronta' | 'erro';
type CampoComErro = 'nome' | 'ordem' | 'formulario';

const ORDEM_MAXIMA = 999;

// A API responde em minúsculas e sem ponto ("dados do setor inválidos").
// Na tela isso vira frase.
function comoFrase(texto: string): string {
  const limpo = texto.trim();
  if (!limpo) return limpo;
  const capitalizado = limpo[0].toUpperCase() + limpo.slice(1);
  return /[.?]$/.test(capitalizado) ? capitalizado : `${capitalizado}.`;
}

function mensagemDoErro(erro: unknown, alternativa: string): string {
  return erro instanceof Error && erro.message ? erro.message : alternativa;
}

function ordenarComoNoMenu(lista: Department[]): Department[] {
  // Mesmo critério do menu do WhatsApp: ordem primeiro, alfabético no empate.
  return [...lista].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR')
  );
}

type IconeProps = { className?: string };

function IconeCheck({ className = 'h-4 w-4' }: IconeProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m5 13 4 4 10-10" />
    </svg>
  );
}

function IconeAlerta({ className = 'h-4 w-4' }: IconeProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10.3 4.3 2.6 17.6a1.9 1.9 0 0 0 1.7 2.9h15.4a1.9 1.9 0 0 0 1.7-2.9L13.7 4.3a1.9 1.9 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function IconeMais({ className = 'h-4 w-4' }: IconeProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function IconeLista({ className = 'h-8 w-8' }: IconeProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3.5 6h.01" />
      <path d="M3.5 12h.01" />
      <path d="M3.5 18h.01" />
      <path d="M8 6h12.5" />
      <path d="M8 12h12.5" />
      <path d="M8 18h12.5" />
    </svg>
  );
}

function Girando({ className = 'h-4 w-4' }: IconeProps) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.5} className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function NotaDeErro({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
    >
      <IconeAlerta className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function NotaDeSucesso({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-brand-700">
      <IconeCheck className="h-4 w-4 shrink-0" />
      {children}
    </p>
  );
}

// Aviso discreto que some sozinho — usado no formulário e na tabela.
function useAviso(): [string | null, (texto: string) => void] {
  const [aviso, setAviso] = useState<string | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (relogio.current) clearTimeout(relogio.current);
    },
    []
  );

  const mostrar = useCallback((texto: string) => {
    if (relogio.current) clearTimeout(relogio.current);
    setAviso(texto);
    relogio.current = setTimeout(() => setAviso(null), 5000);
  }, []);

  return [aviso, mostrar];
}

function DialogoDeConfirmacao({
  titulo,
  consequencia,
  rotuloConfirmar,
  carregando,
  erro,
  onConfirmar,
  onCancelar,
}: {
  titulo: string;
  consequencia: string;
  rotuloConfirmar: string;
  carregando: boolean;
  erro: string | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onCancelar();
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onCancelar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center"
      onClick={onCancelar}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmacao-titulo"
        aria-describedby="confirmacao-texto"
        className="w-full max-w-md rounded-2xl border border-ink-200/70 bg-white p-6 shadow-[var(--shadow-lift)]"
        onClick={(evento) => evento.stopPropagation()}
      >
        <h3 id="confirmacao-titulo" className="text-lg font-semibold text-ink-900">
          {titulo}
        </h3>
        <p id="confirmacao-texto" className="mt-2 text-sm text-ink-600">
          {consequencia}
        </p>

        {erro && (
          <div className="mt-4">
            <NotaDeErro>{comoFrase(erro)}</NotaDeErro>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            autoFocus
            onClick={onCancelar}
            disabled={carregando}
          >
            Manter
          </Button>
          <Button type="button" variant="danger" onClick={onConfirmar} disabled={carregando}>
            {carregando && <Girando />}
            {carregando ? 'Desativando' : rotuloConfirmar}
          </Button>
        </div>
      </div>
    </div>
  );
}

async function buscarSetores(): Promise<Department[]> {
  return ordenarComoNoMenu(await api<Department[]>('/admin/departments'));
}

export default function SetoresPage() {
  const [rows, setRows] = useState<Department[]>([]);
  const [estado, setEstado] = useState<EstadoDaLista>('carregando');
  const [erroDaLista, setErroDaLista] = useState<string | null>(null);

  const campoNome = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState('');
  const [ordem, setOrdem] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroDoForm, setErroDoForm] = useState<{ campo: CampoComErro; texto: string } | null>(null);
  const [avisoDoForm, mostrarAvisoDoForm] = useAviso();

  const [pendente, setPendente] = useState<Department | null>(null);
  const [setorEmMudanca, setSetorEmMudanca] = useState<string | null>(null);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);
  const [avisoDaTabela, mostrarAvisoDaTabela] = useAviso();

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      setRows(await buscarSetores());
      setErroDaLista(null);
      setEstado('pronta');
    } catch (erro) {
      setErroDaLista(mensagemDoErro(erro, 'não foi possível carregar os setores'));
      setEstado('erro');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criarSetor(evento: FormEvent) {
    evento.preventDefault();

    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      setErroDoForm({ campo: 'nome', texto: 'escreva o nome do setor' });
      campoNome.current?.focus();
      return;
    }

    let sortOrder: number | undefined;
    const ordemLimpa = ordem.trim();
    if (ordemLimpa) {
      const numero = Number(ordemLimpa);
      if (!Number.isInteger(numero) || numero < 1 || numero > ORDEM_MAXIMA) {
        setErroDoForm({
          campo: 'ordem',
          texto: `use um número de 1 a ${ORDEM_MAXIMA}, ou deixe em branco`,
        });
        return;
      }
      sortOrder = numero;
    }

    setErroDoForm(null);
    setSalvando(true);

    try {
      await api('/admin/departments', {
        method: 'POST',
        body: JSON.stringify({
          name: nomeLimpo,
          ...(sortOrder !== undefined ? { sortOrder } : {}),
        }),
      });
    } catch (erro) {
      setErroDoForm({
        campo: 'formulario',
        texto: mensagemDoErro(erro, 'não foi possível cadastrar o setor'),
      });
      setSalvando(false);
      return;
    }

    setNome('');
    setOrdem('');
    campoNome.current?.focus();

    // O setor já existe: uma falha daqui em diante é da releitura da lista, e
    // dizer "não foi possível cadastrar" faria o admin cadastrar duas vezes.
    try {
      setRows(await buscarSetores());
      setErroDaLista(null);
      setEstado('pronta');
      mostrarAvisoDoForm(`${nomeLimpo} foi cadastrado`);
    } catch {
      setErroDoForm({
        campo: 'formulario',
        texto: `${nomeLimpo} foi cadastrado, mas a lista não atualizou — recarregue a página`,
      });
    } finally {
      setSalvando(false);
    }
  }

  async function alternarSituacao(setor: Department) {
    setErroDaAcao(null);
    setSetorEmMudanca(setor.id);

    try {
      await api(`/admin/departments/${setor.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !setor.active }),
      });
    } catch (erro) {
      setErroDaAcao(
        mensagemDoErro(
          erro,
          setor.active ? 'não foi possível desativar o setor' : 'não foi possível reativar o setor'
        )
      );
      setSetorEmMudanca(null);
      return;
    }

    setPendente(null);

    try {
      setRows(await buscarSetores());
      setErroDaLista(null);
      mostrarAvisoDaTabela(
        setor.active ? `${setor.name} saiu do menu` : `${setor.name} voltou para o menu`
      );
    } catch {
      setErroDaAcao('a mudança foi salva, mas a lista não atualizou — recarregue a página');
    } finally {
      setSetorEmMudanca(null);
    }
  }

  const fecharDialogo = useCallback(() => {
    // Fechar no meio do PATCH deixaria a tela mentindo sobre o resultado.
    if (setorEmMudanca) return;
    setPendente(null);
    setErroDaAcao(null);
  }, [setorEmMudanca]);

  function situacao(setor: Department) {
    return setor.active ? (
      <Badge tone="success">
        <Dot tone="success" />
        Ativo
      </Badge>
    ) : (
      <Badge tone="muted">
        <Dot tone="neutral" />
        Desativado
      </Badge>
    );
  }

  function acao(setor: Department) {
    const ocupado = setorEmMudanca === setor.id;

    if (setor.active) {
      return (
        <Button
          type="button"
          variant="danger"
          className="px-3 py-1.5 text-xs"
          disabled={ocupado}
          title="Tira o setor do menu de todos os links de acesso."
          onClick={() => {
            setErroDaAcao(null);
            setPendente(setor);
          }}
        >
          Desativar
        </Button>
      );
    }

    return (
      <Button
        type="button"
        variant="secondary"
        className="px-3 py-1.5 text-xs"
        disabled={ocupado}
        title="Devolve o setor ao menu dos links que o incluem."
        onClick={() => void alternarSituacao(setor)}
      >
        {ocupado && <Girando className="h-3.5 w-3.5" />}
        {ocupado ? 'Reativando' : 'Reativar'}
      </Button>
    );
  }

  const ativos = rows.filter((setor) => setor.active).length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="Setores"
        description="Os destinos que aparecem no menu de quem escreve de fora."
        action={
          estado === 'pronta' && rows.length > 0 ? (
            <p className="text-sm text-ink-500" title="Só os setores ativos entram no menu.">
              <span className="tabular font-semibold text-ink-900">{ativos}</span> no menu
              <span className="px-1.5 text-ink-300">·</span>
              <span className="tabular">{rows.length - ativos}</span> desativados
            </p>
          ) : undefined
        }
      />

      <ExplainCard>
        <ul className="list-disc space-y-1.5 pl-4">
          <li>Setor é o destino da conversa: Recepção, Internação, Faturamento.</li>
          <li>
            O número que a pessoa digita vem do link de acesso dela, não desta lista. Cada link
            mostra só os setores que libera, numerados de <span className="tabular">1</span> em
            diante — o mesmo setor pode ser <span className="tabular">2</span> em um link e{' '}
            <span className="tabular">3</span> em outro.
          </li>
          <li>
            A ordem aqui define a sequência do menu; empate desempata pelo alfabeto. Setor
            desativado não entra no menu de nenhum link.
          </li>
        </ul>
      </ExplainCard>

      <Panel title="Novo setor">
        <form onSubmit={criarSetor} noValidate className="space-y-5 px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="Nome">
              <input
                ref={campoNome}
                className={inputClass}
                value={nome}
                onChange={(evento) => setNome(evento.target.value)}
                placeholder="Recepção"
                maxLength={60}
                autoComplete="off"
                title="É esse texto que a pessoa lê no menu."
                aria-required="true"
                aria-invalid={erroDoForm?.campo === 'nome'}
                aria-describedby={erroDoForm ? 'erro-novo-setor' : undefined}
              />
            </Field>

            <Field label="Ordem (opcional)">
              <input
                className={`${inputClass} tabular`}
                value={ordem}
                onChange={(evento) => setOrdem(evento.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="1"
                inputMode="numeric"
                autoComplete="off"
                title={`Posição na sequência do menu, de 1 a ${ORDEM_MAXIMA}. Em branco, o sistema escolhe.`}
                aria-invalid={erroDoForm?.campo === 'ordem'}
                aria-describedby={erroDoForm ? 'erro-novo-setor' : undefined}
              />
            </Field>
          </div>

          {erroDoForm && <NotaDeErro id="erro-novo-setor">{comoFrase(erroDoForm.texto)}</NotaDeErro>}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {avisoDoForm && <NotaDeSucesso>{avisoDoForm}</NotaDeSucesso>}
            <Button type="submit" disabled={salvando} className="w-full sm:w-auto">
              {salvando ? <Girando /> : <IconeMais />}
              {salvando ? 'Cadastrando' : 'Cadastrar setor'}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Setores do hospital" hint="Na ordem do menu.">
        {erroDaAcao && !pendente && (
          <div className="px-5 pt-4">
            <NotaDeErro>{comoFrase(erroDaAcao)}</NotaDeErro>
          </div>
        )}

        {avisoDaTabela && (
          <div className="px-5 pt-4">
            <NotaDeSucesso>{avisoDaTabela}</NotaDeSucesso>
          </div>
        )}

        {estado === 'carregando' && (
          <div>
            <p role="status" className="sr-only">
              Carregando os setores.
            </p>
            <div className="divide-y divide-ink-100" aria-hidden="true">
              {[0, 1, 2, 3].map((linha) => (
                <div key={linha} className="flex items-center gap-4 px-5 py-4">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="ml-auto h-5 w-16" />
                  <Skeleton className="h-7 w-20" />
                </div>
              ))}
            </div>
          </div>
        )}

        {estado === 'erro' && (
          <div className="px-5 py-14 text-center">
            <p className="font-medium text-ink-700">A lista não carregou</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
              {comoFrase(erroDaLista ?? 'o sistema não respondeu')}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-5"
              onClick={() => void carregar()}
            >
              Tentar de novo
            </Button>
          </div>
        )}

        {estado === 'pronta' && rows.length === 0 && (
          <EmptyState
            icon={<IconeLista />}
            title="Nenhum setor cadastrado"
            description="Sem setor ativo, quem escreve de fora não recebe menu."
          />
        )}

        {estado === 'pronta' && rows.length > 0 && (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Setores do hospital, na ordem em que aparecem no menu
                </caption>
                <thead>
                  <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th scope="col" className="px-5 py-3 font-medium">
                      Setor
                    </th>
                    <th
                      scope="col"
                      className="w-32 px-5 py-3 font-medium"
                      title="Sequência do menu. Não é o número que a pessoa digita — esse depende do link dela."
                    >
                      Ordem
                    </th>
                    <th scope="col" className="w-36 px-5 py-3 font-medium">
                      Situação
                    </th>
                    <th scope="col" className="w-36 px-5 py-3 text-right font-medium">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((setor) => (
                    <tr key={setor.id} className="transition-colors hover:bg-ink-50/70">
                      <th scope="row" className="px-5 py-3.5 text-left font-medium text-ink-900">
                        {setor.name}
                      </th>
                      <td className="tabular px-5 py-3.5 text-ink-600">{setor.sortOrder}</td>
                      <td className="px-5 py-3.5">{situacao(setor)}</td>
                      <td className="px-5 py-3.5 text-right">{acao(setor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-ink-100 md:hidden">
              {rows.map((setor) => (
                <li key={setor.id} className="flex items-start justify-between gap-3 px-4 py-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{setor.name}</p>
                    <p className="mt-1 text-xs text-ink-500" title="Sequência do menu.">
                      Ordem <span className="tabular">{setor.sortOrder}</span>
                    </p>
                    <div className="mt-2">{situacao(setor)}</div>
                  </div>
                  <div className="shrink-0">{acao(setor)}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {pendente && (
        <DialogoDeConfirmacao
          titulo={`Desativar ${pendente.name}?`}
          consequencia="O setor sai do menu de todos os links na hora — dá para reativar depois."
          rotuloConfirmar="Desativar"
          carregando={setorEmMudanca === pendente.id}
          erro={erroDaAcao}
          onConfirmar={() => void alternarSituacao(pendente)}
          onCancelar={fecharDialogo}
        />
      )}
    </div>
  );
}
