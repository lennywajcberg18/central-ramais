import { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Tone } from '@/lib/labels';

const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-brand-100 text-brand-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-rose-100 text-rose-800',
  neutral: 'bg-ink-100 text-ink-700',
  muted: 'bg-ink-100 text-ink-500',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

// Explicação longa não pode competir com o conteúdo: fica recolhida, e quem
// precisa aprender abre. Uma tela didática ensina sob demanda, não empurra texto.
export function ExplainCard({
  title = 'Entenda esta tela',
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-ink-200/70 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink-700 hover:text-ink-900">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        {title}
      </summary>
      <div className="space-y-2 border-t border-ink-100 px-4 py-3 text-sm leading-relaxed text-ink-600">
        {children}
      </div>
    </details>
  );
}

export function Dot({ tone = 'neutral' }: { tone?: Tone }) {
  const color: Record<Tone, string> = {
    success: 'bg-brand-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    neutral: 'bg-ink-400',
    muted: 'bg-ink-300',
  };
  return <span className={`h-1.5 w-1.5 rounded-full ${color[tone]}`} />;
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl">
        <h2 className="text-2xl font-semibold text-ink-900">{title}</h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-ink-500">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function Panel({
  title,
  hint,
  children,
  className = '',
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-ink-200/70 bg-white shadow-[var(--shadow-card)] ${className}`}
    >
      {title && (
        <div className="border-b border-ink-100 px-5 py-4">
          <h3 className="font-semibold text-ink-900">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};

const VARIANT: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-[var(--shadow-card)]',
  secondary: 'border border-ink-300 bg-white text-ink-700 hover:border-ink-400 hover:bg-ink-50',
  ghost: 'text-ink-600 hover:bg-ink-100',
  danger: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${className}`}
    />
  );
}

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-ink-300">{icon}</div>}
      <p className="font-medium text-ink-700">{title}</p>
      <p className="max-w-sm text-sm leading-relaxed text-ink-500">{description}</p>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'mt-1 w-full rounded-xl border border-ink-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-ink-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-ink-100 ${className}`} />;
}
