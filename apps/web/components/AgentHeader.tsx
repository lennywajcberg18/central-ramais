'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, clearSession, getSessionUser, SessionUser } from '@/lib/api';
import { AVAILABILITY } from '@/lib/labels';
import { Button, Dot } from '@/components/ui';

export default function AgentHeader() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    const u = getSessionUser();
    if (!u) {
      router.push('/login');
      return;
    }
    setUser(u);
  }, [router]);

  async function toggleAvailability() {
    if (!user) return;
    const next = user.availability === 'available' ? 'away' : 'available';
    await api('/agent/availability', {
      method: 'PATCH',
      body: JSON.stringify({ availability: next }),
    });
    const updated = { ...user, availability: next } as SessionUser;
    setUser(updated);
    localStorage.setItem('user', JSON.stringify(updated));
  }

  function logout() {
    clearSession();
    router.push('/login');
  }

  if (!user) return null;

  const estado = AVAILABILITY[user.availability] ?? {
    label: 'Situação desconhecida',
    tone: 'muted' as const,
  };

  return (
    <header className="flex items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-ink-900">Conversas</h1>
        <p className="truncate text-xs text-ink-500">{user.name}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={toggleAvailability}
          title={
            user.availability === 'available'
              ? 'Marcar como ausente — novas conversas param de chegar para você'
              : 'Marcar como disponível — voltar a receber conversas'
          }
        >
          <Dot tone={estado.tone} />
          {estado.label}
        </Button>
        {user.role === 'admin' && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/admin/dashboard')}
            title="Ir para o painel do hospital"
          >
            Painel
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={logout}>
          Sair
        </Button>
      </div>
    </header>
  );
}
