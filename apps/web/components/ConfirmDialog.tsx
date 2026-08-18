'use client';

import { RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui';

const FOCAVEIS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// `aria-modal` é promessa, não implementação. Sem prender o Tab, o teclado sai
// da caixa e alcança os botões que estão atrás da máscara escura — inclusive o
// Encerrar da conversa, que a pessoa não está vendo. E sem devolver o foco ao
// fechar, ele cai no body e quem navega por teclado tabula a página inteira de
// novo. Mora aqui, junto do diálogo canônico, porque os outros dois usos —
// encaminhar, na tela de conversa, e a gaveta de histórico do gestor — são
// overlays feitos à mão que precisam exatamente destas três garantias.
//
// `origem` é o elemento para onde o foco volta ao fechar, capturado por QUEM
// ABRE. Sem ele a captura erra em dois casos reais: o diálogo que já nasce com
// `autoFocus` (o React aplica o foco na fase de layout, de baixo para cima, e
// aqui em cima só sobra o botão de dentro da caixa, que ao fechar já saiu do
// DOM) e o item de menu que some no mesmo commit em que o diálogo monta
// (activeElement já é o <body>). Nos dois, o foco caía no body e o próximo Tab
// recomeçava a página inteira.
export function useDialogoModal(
  ativo: boolean,
  caixa: RefObject<HTMLElement | null>,
  onCancel: () => void,
  origem?: RefObject<HTMLElement | null>
): void {
  const anterior = useRef<HTMLElement | null>(null);

  // separado do teclado de propósito: se dependesse de `onCancel`, uma troca de
  // identidade do callback devolveria o foco com o diálogo ainda aberto
  useLayoutEffect(() => {
    if (!ativo) return;
    const focado = document.activeElement;
    const dentroDaCaixa = focado instanceof Node && caixa.current?.contains(focado) === true;
    anterior.current =
      origem?.current ??
      // nó de dentro da caixa e o <body> não servem de volta: o primeiro é
      // destacado do DOM ao fechar e o segundo joga o teclado para o começo
      (!dentroDaCaixa && focado instanceof HTMLElement && focado !== document.body
        ? focado
        : null);
    return () => {
      anterior.current?.focus();
      anterior.current = null;
    };
  }, [ativo, caixa, origem]);

  useEffect(() => {
    if (!ativo) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const atual = caixa.current;
      if (!atual) return;
      const focaveis = Array.from(atual.querySelectorAll<HTMLElement>(FOCAVEIS));
      // durante o envio tudo fica desabilitado; deixar o Tab passar aí
      // entregaria o fundo ao teclado justamente no pior momento
      if (focaveis.length === 0) {
        e.preventDefault();
        return;
      }
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const focado = document.activeElement;
      const dentro = focado instanceof Node && atual.contains(focado);
      const borda = e.shiftKey ? focado === primeiro : focado === ultimo;
      if (borda || !dentro) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primeiro).focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ativo, caixa, onCancel]);
}

export default function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  errorPrefix,
  pending,
  error,
  onCancel,
  onConfirm,
  origemDoFoco,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  errorPrefix: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  origemDoFoco?: RefObject<HTMLElement | null>;
}) {
  // O diálogo é desenhado direto no body. Dentro de um cabeçalho `sticky` ele
  // ficaria preso no stacking context daquele cabeçalho, e a barra de navegação
  // do celular passaria por cima dos botões — inclusive capturando o toque.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  // Durante o envio o Escape não fecha. Os dois botões já ficam desabilitados;
  // o teclado era a última porta aberta, e sair por ela leva junto a única
  // superfície onde o erro apareceria — a pessoa vai embora achando que
  // encerrou o que não encerrou. Guardar aqui vale para os quatro chamadores,
  // em vez de depender de cada um lembrar.
  const cancelar = useCallback(() => {
    if (pending) return;
    onCancel();
  }, [pending, onCancel]);

  const caixa = useRef<HTMLDivElement>(null);
  // o diálogo só existe montado, então está sempre ativo enquanto vive
  useDialogoModal(true, caixa, cancelar, origemDoFoco);

  if (!montado) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center">
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-2xl border border-ink-200/70 bg-white p-6 shadow-[var(--shadow-lift)]"
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-ink-900">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">{description}</p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-relaxed text-rose-800"
          >
            {errorPrefix}: {error}.
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={cancelar} disabled={pending} autoFocus>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
