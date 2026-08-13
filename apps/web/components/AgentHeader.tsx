'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, clearSession, getSessionUser, SessionUser } from '@/lib/api';

const AVAILABILITY_LABEL: Record<SessionUser['availability'], string> = {
  available: 'Disponível',
  away: 'Ausente',
  offline: 'Offline',
};

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

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
      <div>
        <h1 className="font-semibold">Conversas</h1>
        <p className="text-xs text-slate-500">{user.name}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={toggleAvailability}
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            user.availability === 'available'
              ? 'bg-green-100 text-green-700'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {AVAILABILITY_LABEL[user.availability]}
        </button>
        {user.role === 'admin' && (
          <button
            onClick={() => router.push('/admin/dashboard')}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
          >
            Admin
          </button>
        )}
        <button onClick={logout} className="rounded-lg border border-slate-300 px-3 py-1 text-sm">
          Sair
        </button>
      </div>
    </header>
  );
}
