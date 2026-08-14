'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { clearSession, getSessionUser, type SessionUser } from '@/lib/api';
import { Button } from '@/components/ui';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Atendimento',
    items: [
      {
        href: '/admin/dashboard',
        label: 'Visão geral',
        icon: (
          <>
            <path d="M4 20V4" />
            <path d="M4 20h16" />
            <path d="M8.5 20v-5.5" />
            <path d="M13 20V9" />
            <path d="M17.5 20v-8" />
          </>
        ),
      },
      {
        href: '/admin/conversas',
        label: 'Conversas',
        icon: (
          <>
            <path d="M20.5 12a8.5 8.5 0 1 1-4.3-7.4" />
            <path d="M20.5 4.5v4h-4" />
            <path d="M8.5 11h7" />
            <path d="M8.5 14.5h4" />
          </>
        ),
      },
      {
        href: '/admin/setores',
        label: 'Setores',
        icon: (
          <>
            <path d="M3 21h18" />
            <path d="M5 21V6.5L12 3l7 3.5V21" />
            <path d="M10 21v-4.5h4V21" />
            <path d="M12 8v4" />
            <path d="M10 10h4" />
          </>
        ),
      },
      {
        href: '/admin/agentes',
        label: 'Atendentes',
        icon: (
          <>
            <circle cx="9.5" cy="8" r="3.5" />
            <path d="M3 19.5a6.5 6.5 0 0 1 13 0" />
            <path d="M16.5 5.2a3.5 3.5 0 0 1 0 5.6" />
            <path d="M18.5 14.2a5 5 0 0 1 2.5 4.3" />
          </>
        ),
      },
    ],
  },
  {
    label: 'Acesso externo',
    items: [
      {
        href: '/admin/links',
        label: 'Links de acesso',
        icon: (
          <>
            <path d="M10.5 13.5a4 4 0 0 0 5.66 0l2.5-2.5a4 4 0 0 0-5.66-5.66l-1.2 1.2" />
            <path d="M13.5 10.5a4 4 0 0 0-5.66 0l-2.5 2.5a4 4 0 0 0 5.66 5.66l1.2-1.2" />
          </>
        ),
      },
      {
        href: '/admin/contatos',
        label: 'Números de fora',
        icon: (
          <>
            <rect x="4" y="3" width="16" height="18" rx="2.5" />
            <circle cx="12" cy="10" r="2.5" />
            <path d="M8.5 17a3.5 3.5 0 0 1 7 0" />
          </>
        ),
      },
      {
        href: '/admin/acessos',
        label: 'Acessos negados',
        icon: (
          <>
            <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9.2-4.1-1.6-7-5-7-9.2V6z" />
            <path d="M12 8.5v4" />
            <path d="M12 15.8h.01" />
          </>
        ),
      },
    ],
  },
  {
    label: 'Demonstração',
    items: [
      {
        href: '/admin/simulador',
        label: 'Simulador de WhatsApp',
        icon: (
          <>
            <rect x="6" y="2.5" width="12" height="19" rx="3" />
            <path d="M10.5 5.5h3" />
            <path d="M9 11.5h6" />
            <path d="M9 15h3.5" />
          </>
        ),
      },
    ],
  },
];

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-[var(--shadow-card)]">
        <svg viewBox="0 0 32 32" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" />
        </svg>
      </span>
      <span className="min-w-0">
        <h1 className="truncate text-sm font-semibold text-ink-900">Central de Ramais</h1>
        <span className="block truncate text-xs text-ink-500">Painel do hospital</span>
      </span>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function Avatar({ user, className = '' }: { user: SessionUser; className?: string }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 ${className}`}
      title={`${user.name} — ${user.email}`}
    >
      {initials(user.name)}
    </span>
  );
}

const EXIT_ICON = (
  <>
    <path d="M12 19.5H6.5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2H12" />
    <path d="M16 8.5 19.5 12 16 15.5" />
    <path d="M19.5 12h-10" />
  </>
);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    const sessionUser = getSessionUser();
    if (!sessionUser) {
      router.push('/login');
      return;
    }
    if (sessionUser.role !== 'admin') {
      router.push('/conversas');
      return;
    }
    setUser(sessionUser);
    setReady(true);
  }, [router]);

  if (!ready) return null;

  function sair() {
    setSaindo(true);
    clearSession();
    router.push('/login');
  }

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <div className="flex min-h-dvh flex-col bg-ink-50 md:flex-row">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30 focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink-800 focus:shadow-[var(--shadow-lift)]"
      >
        Ir para o conteúdo
      </a>

      {/* No celular a barra lateral não cabe: vira barra superior com a mesma navegação, rolável na horizontal. */}
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white md:hidden">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          <Brand />
          <div className="flex shrink-0 items-center gap-2">
            {user && <Avatar user={user} className="hidden sm:flex" />}
            <Button variant="ghost" onClick={sair} disabled={saindo}>
              <NavIcon>{EXIT_ICON}</NavIcon>
              <span>{saindo ? 'Saindo' : 'Sair'}</span>
            </Button>
          </div>
        </div>
        <nav
          aria-label="Seções do painel"
          className="overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex w-max items-center gap-1 px-4">
            {NAV_GROUPS.map((group, index) => (
              <Fragment key={group.label}>
                {index > 0 && (
                  <li aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-ink-200" />
                )}
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(item.href) ? 'page' : undefined}
                      className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm ${
                        isActive(item.href)
                          ? 'bg-brand-50 font-medium text-brand-800'
                          : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
                      }`}
                    >
                      <NavIcon>{item.icon}</NavIcon>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </Fragment>
            ))}
          </ul>
        </nav>
      </header>

      <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-ink-200 bg-white md:flex md:w-64">
        <div className="px-5 py-5">
          <Brand />
        </div>

        <nav aria-label="Seções do painel" className="flex-1 space-y-7 overflow-y-auto px-3 pb-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.href} className="relative">
                    {isActive(item.href) && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-brand-600"
                      />
                    )}
                    <Link
                      href={item.href}
                      aria-current={isActive(item.href) ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-xl py-2.5 pl-4 pr-3 text-sm ${
                        isActive(item.href)
                          ? 'bg-brand-50 font-medium text-brand-800'
                          : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
                      }`}
                    >
                      <NavIcon>{item.icon}</NavIcon>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-ink-100 p-3">
          {user && (
            <div className="flex items-center gap-3 px-2 py-1.5">
              <Avatar user={user} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink-800">{user.name}</span>
                <span className="block truncate text-xs text-ink-500">{user.email}</span>
              </span>
            </div>
          )}
          <Button variant="ghost" className="mt-1 w-full" onClick={sair} disabled={saindo}>
            <NavIcon>{EXIT_ICON}</NavIcon>
            <span className="flex-1 text-left">{saindo ? 'Saindo da conta' : 'Sair'}</span>
          </Button>
        </div>
      </aside>

      <main id="conteudo" className="min-w-0 flex-1 bg-ink-50">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
