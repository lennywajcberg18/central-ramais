'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui';

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  if (!montado) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center">
      <div
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
