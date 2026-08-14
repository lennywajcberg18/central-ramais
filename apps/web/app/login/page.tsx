'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, saveSession, SessionUser } from '@/lib/api';
import { Button, ExplainCard, Field, inputClass } from '@/components/ui';

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function CrossMark({ className = '' }: { className?: string }) {
  return (
    <svg {...ICON_PROPS} className={className} aria-hidden="true">
      <path d="M9.75 3.75h4.5v5.5h5.5v4.5h-5.5v5.5h-4.5v-5.5h-5.5v-4.5h5.5z" />
    </svg>
  );
}

function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg {...ICON_PROPS} className={className} aria-hidden="true">
      <path d="M12 3.5 5.25 6v5.4c0 3.9 2.8 7.2 6.75 8.35 3.95-1.15 6.75-4.45 6.75-8.35V6z" />
      <path d="m9.4 12.1 1.9 1.9 3.4-3.7" />
    </svg>
  );
}

function LinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg {...ICON_PROPS} className={className} aria-hidden="true">
      <path d="M10.6 13.4a3.4 3.4 0 0 0 4.9 0l2.7-2.7a3.4 3.4 0 0 0-4.9-4.9l-1.4 1.4" />
      <path d="M13.4 10.6a3.4 3.4 0 0 0-4.9 0l-2.7 2.7a3.4 3.4 0 0 0 4.9 4.9l1.4-1.4" />
    </svg>
  );
}

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg {...ICON_PROPS} className={className} aria-hidden="true">
      <rect x="4.75" y="10.5" width="14.5" height="8.75" rx="2.25" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

function AlertIcon({ className = '' }: { className?: string }) {
  return (
    <svg {...ICON_PROPS} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 8v4.5M12 15.6v.4" />
    </svg>
  );
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg {...ICON_PROPS} className={`animate-spin ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" className="opacity-30" />
      <path d="M20.25 12a8.25 8.25 0 0 0-8.25-8.25" />
    </svg>
  );
}

const VALUE_POINTS = [
  {
    Icon: ShieldIcon,
    title: 'Cada um vê só o seu',
    text: 'O link de acesso define os setores que a pessoa enxerga.',
  },
  {
    Icon: LinkIcon,
    title: 'Sem cadastro para quem é de fora',
    text: 'Recebe o link, manda a mensagem, já está atendido.',
  },
  {
    Icon: LockIcon,
    title: 'Nenhum número pessoal exposto',
    text: 'A conversa passa pelo número do hospital.',
  },
];

const DEMO_ACCOUNTS = [
  { label: 'Administrador', email: 'admin@hospitalvida.test', hint: 'Hospital Vida' },
  { label: 'Atendente', email: 'agente1@hospitalvida.test', hint: 'Hospital Vida' },
  { label: 'Segundo hospital', email: 'admin@reabilitar.test', hint: 'Clínica Reabilitar' },
];

const DEMO_PASSWORD = '123456';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api<{ token: string; user: SessionUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      saveSession(data.token, data.user);
      router.push(data.user.role === 'admin' ? '/admin/dashboard' : '/conversas');
    } catch {
      setError('E-mail ou senha inválidos.');
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] lg:grid-cols-[1.05fr_1fr] lg:grid-rows-1">
      <section
        className="relative flex flex-col justify-between overflow-hidden bg-brand-800 px-6 py-10 text-brand-50 sm:px-10 lg:px-14 lg:py-14"
        style={{
          backgroundImage: [
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 1.6px)',
            'radial-gradient(115% 85% at 8% 0%, rgba(88,168,148,0.38), transparent 58%)',
            'radial-gradient(95% 80% at 100% 100%, rgba(23,58,51,0.9), transparent 62%)',
          ].join(', '),
          backgroundSize: '22px 22px, auto, auto',
        }}
      >
        <div className="max-w-md">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
            <CrossMark className="h-6 w-6 text-white" />
          </span>
          <h1 className="mt-6 text-3xl font-semibold text-white sm:text-4xl">Central de Ramais</h1>
          <p className="mt-3 text-base leading-relaxed text-brand-100">
            Quem é de fora fala com o setor certo pelo WhatsApp, sem ver o número de ninguém.
          </p>
        </div>

        <ul className="mt-10 hidden max-w-md gap-6 sm:grid">
          {VALUE_POINTS.map(({ Icon, title, text }) => (
            <li key={title} className="flex gap-3.5">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-300" />
              <div>
                <p className="text-sm font-medium text-white">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-brand-200">{text}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-10 hidden text-xs text-brand-300 lg:block">Acesso da equipe do hospital.</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12 sm:px-8 lg:px-14">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-ink-900">Entrar</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
            Use o e-mail que o hospital cadastrou para você.
          </p>

          <div className="mt-5">
            <ExplainCard>
              <ul className="list-disc space-y-1.5 pl-4">
                <li>Esta tela é da equipe. Quem é de fora entra pelo link de acesso, no WhatsApp.</li>
                <li>Administrador cuida de setores e links. Atendente responde as conversas.</li>
                <li>Cada hospital é separado: um nunca vê os dados do outro.</li>
              </ul>
            </ExplainCard>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <Field label="E-mail">
              <input
                type="email"
                required
                autoComplete="email"
                autoFocus
                placeholder="voce@hospital.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Senha">
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>

            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm leading-relaxed text-rose-700"
              >
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Spinner className="h-4 w-4" />}
              {loading ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>

          <div className="mt-9 border-t border-ink-200 pt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Ambiente de demonstração
            </h3>
            <p className="mt-2 text-xs text-ink-500">Clique para preencher com um acesso de teste.</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  disabled={loading}
                  onClick={() => fillDemo(account.email)}
                  title={`${account.email} · ${account.hint}`}
                  className="rounded-md text-sm font-medium text-brand-700 underline decoration-brand-300 underline-offset-4 hover:text-brand-800 hover:decoration-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {account.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-400">
              Senha de todos: <span className="tabular text-ink-500">123456</span>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
