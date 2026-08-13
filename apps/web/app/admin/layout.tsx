'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearSession, getSessionUser } from '@/lib/api';

const NAV = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/setores', label: 'Setores' },
  { href: '/admin/agentes', label: 'Agentes' },
  { href: '/admin/links', label: 'Links de acesso' },
  { href: '/admin/contatos', label: 'Contatos' },
  { href: '/admin/acessos', label: 'Acessos negados' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const user = getSessionUser();
    if (!user) {
      router.push('/login');
      return;
    }
    if (user.role !== 'admin') {
      router.push('/conversas');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <h1 className="mb-6 font-semibold">Central de Ramais</h1>
        <nav className="space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm ${
                pathname.startsWith(item.href)
                  ? 'bg-blue-50 font-medium text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => {
            clearSession();
            router.push('/login');
          }}
          className="mt-8 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          Sair
        </button>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
