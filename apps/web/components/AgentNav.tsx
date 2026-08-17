'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Navegação de quem atende. No celular ela vive embaixo, ao alcance do polegar,
 * porque é assim que este app vai ser usado no plantão — e é a forma que sobrevive
 * quando ele virar aplicativo. Em tela grande vira uma fileira de abas no topo.
 *
 * As telas de conversa (`/conversas/[id]`, `/ramais/[id]`) não mostram esta barra:
 * lá o dedo precisa do teclado e da lista de mensagens, não de navegação.
 */

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
}

const ITENS: Item[] = [
  {
    href: '/conversas',
    label: 'Atendimento',
    icon: (
      <>
        <path d="M20.5 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-4.6A8 8 0 1 1 20.5 11.5z" />
        <path d="M9 10.5h6" />
        <path d="M9 13.5h3.5" />
      </>
    ),
  },
  {
    href: '/ramais',
    label: 'Ramais',
    icon: (
      <>
        <rect x="3" y="4.5" width="8" height="7" rx="1.6" />
        <rect x="13" y="12.5" width="8" height="7" rx="1.6" />
        <path d="M11 8h3.5a2 2 0 0 1 2 2v2.5" />
        <path d="M13 16H9.5a2 2 0 0 1-2-2v-2.5" />
      </>
    ),
  },
];

function Icone({ children, ativo }: { children: ReactNode; ativo: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ativo ? 2 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6 sm:h-5 sm:w-5"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export default function AgentNav() {
  const pathname = usePathname();

  function estaAtivo(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      {/* tela grande: abas logo abaixo do cabeçalho */}
      <nav
        aria-label="Seções"
        className="hidden border-b border-ink-200 bg-white px-4 sm:block sm:px-6"
      >
        <ul className="flex gap-1">
          {ITENS.map((item) => {
            const ativo = estaAtivo(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={ativo ? 'page' : undefined}
                  className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${
                    ativo
                      ? 'border-brand-600 text-brand-800'
                      : 'border-transparent text-ink-500 hover:text-ink-800'
                  }`}
                >
                  <Icone ativo={ativo}>{item.icon}</Icone>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* celular: barra fixa embaixo, com área de toque grande e respeito à
          faixa de gestos do aparelho */}
      <nav
        aria-label="Seções"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="flex">
          {ITENS.map((item) => {
            const ativo = estaAtivo(item.href);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={ativo ? 'page' : undefined}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium ${
                    ativo ? 'text-brand-700' : 'text-ink-500'
                  }`}
                >
                  <Icone ativo={ativo}>{item.icon}</Icone>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
