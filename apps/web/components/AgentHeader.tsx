'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button, Dot } from '@/components/ui';
import { api, clearSession, getSessionUser, SessionUser } from '@/lib/api';
import { AVAILABILITY } from '@/lib/labels';

interface Shift {
  startedAt: string;
  endsAt: string;
}

function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function minutosAte(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

export default function AgentHeader() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // recalcula o quanto falta sem precisar buscar de novo no servidor
  const [, setTick] = useState(0);

  useEffect(() => {
    const u = getSessionUser();
    if (!u) {
      router.push('/login');
      return;
    }
    setUser(u);
  }, [router]);

  const carregarPlantao = useCallback(async () => {
    try {
      setShift(await api<Shift | null>('/agent/shift'));
    } catch {
      // o interceptador do api já derruba a sessão quando o plantão acabou
    }
  }, []);

  useEffect(() => {
    if (user?.role !== 'agent') return;
    carregarPlantao();
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [user?.role, carregarPlantao]);

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

  async function encerrarPlantao() {
    setEncerrando(true);
    setErro(null);
    try {
      await api('/agent/shift/end', { method: 'POST' });
      clearSession();
      router.push('/login?motivo=plantao-encerrado');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'tente de novo');
      setEncerrando(false);
    }
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

  const restam = shift ? minutosAte(shift.endsAt) : null;
  const acabando = restam !== null && restam <= 60;

  return (
    <header className="flex items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-ink-900">Conversas</h1>
        <p className="truncate text-xs text-ink-500">{user.name}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {shift && (
          <span
            title={`Seu acesso vale até ${horaLocal(shift.endsAt)}. Depois disso o sistema encerra o plantão sozinho.`}
            className={`hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium sm:inline-flex ${
              acabando ? 'bg-amber-100 text-amber-800' : 'bg-ink-100 text-ink-600'
            }`}
          >
            <Dot tone={acabando ? 'warning' : 'success'} />
            {restam !== null && restam <= 60
              ? `Plantão acaba em ${Math.max(restam, 1)} min`
              : `Plantão até ${horaLocal(shift.endsAt)}`}
          </span>
        )}

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

        {shift && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirmando(true)}
            title="Encerrar o plantão: seu acesso termina e suas conversas voltam para a fila do setor"
          >
            Encerrar plantão
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          onClick={logout}
          title={
            shift
              ? 'Fechar o app sem encerrar o plantão — você continua recebendo conversas'
              : 'Sair da conta'
          }
        >
          Sair
        </Button>
      </div>

      {confirmando && (
        <ConfirmDialog
          title="Encerrar seu plantão"
          description="Seu acesso termina agora e as conversas que estão com você voltam para a fila do setor, para quem continua de plantão."
          confirmLabel="Encerrar plantão"
          cancelLabel="Continuar no plantão"
          pendingLabel="Encerrando…"
          errorPrefix="Não foi possível encerrar"
          pending={encerrando}
          error={erro}
          onCancel={() => setConfirmando(false)}
          onConfirm={encerrarPlantao}
        />
      )}
    </header>
  );
}
