'use client';

import { RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui';

const FOCAVEIS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// `aria-modal` é promessa, não implementação. Sem prender o Tab, o teclado sai
// da caixa e alcança os botões que estão atrás da máscara escura — inclusive o
// Encerrar da conversa, que a pessoa não está vendo. E sem devolver o foco ao
// fechar, ele cai no body e quem navega por teclado tabula a página inteira de
// novo. Mora aqui, junto do diálogo canônico, porque os dois usos de hoje são
// este arquivo e o diálogo de encaminhar da tela de conversa.
export function useDialogoModal(
  ativo: boolean,
  caixa: RefObject<HTMLElement | null>,
  onCancel: () => void
): void {
  const anterior = useRef<HTMLElement | null>(null);

  // separado do teclado de propósito: se dependesse de `onCancel`, uma troca de
  // identidade do callback devolveria o foco com o diálogo ainda aberto
  useEffect(() => {
    if (!ativo) return;
    anterior.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      anterior.current?.focus();
      anterior.current = null;
    };
  }, [ativo]);

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
}) {
  // O diálogo é desenhado direto no body. Dentro de um cabeçalho `sticky` ele
  // ficaria preso no stacking context daquele cabeçalho, e a barra de navegação
  // do celular passaria por cima dos botões — inclusive capturando o toque.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const caixa = useRef<HTMLDivElement>(null);
  // o diálogo só existe montado, então está sempre ativo enquanto vive
  useDialogoModal(true, caixa, onCancel);

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
          <Button variant="secondary" onClick={onCancel} disabled={pending} autoFocus>
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
