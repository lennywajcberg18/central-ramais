'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
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

function IconMais() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function AgentHeader() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [trocandoEstado, setTrocandoEstado] = useState(false);
  const [erroEstado, setErroEstado] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
    void carregarPlantao();
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [user?.role, carregarPlantao]);

  // o menu fecha ao tocar fora ou no Escape, como qualquer menu de app
  useEffect(() => {
    if (!menuAberto) return;
    function onClique(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAberto(false);
    }
    function onTecla(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuAberto(false);
    }
    document.addEventListener('mousedown', onClique);
    document.addEventListener('keydown', onTecla);
    return () => {
      document.removeEventListener('mousedown', onClique);
      document.removeEventListener('keydown', onTecla);
    };
  }, [menuAberto]);

  async function alternarDisponibilidade() {
    if (!user || trocandoEstado) return;
    const proximo = user.availability === 'available' ? 'away' : 'available';
    setTrocandoEstado(true);
    setErroEstado(null);
    try {
      await api('/agent/availability', {
        method: 'PATCH',
        body: JSON.stringify({ availability: proximo }),
      });
      const atualizado = { ...user, availability: proximo } as SessionUser;
      setUser(atualizado);
      localStorage.setItem('user', JSON.stringify(atualizado));
    } catch {
      // Falhar calado aqui é grave: quem achou que ficou ausente continua elegível
      // para atribuição automática, a conversa fica 30 min sem resposta e é fechada
      // por inatividade. O aviso diz o ESTADO em que a pessoa ficou, não que "a rede
      // falhou" — é o estado que decide se o roteamento continua mandando conversa.
      setErroEstado(
        proximo === 'away'
          ? 'Não deu para mudar. Você continua recebendo conversas.'
          : 'Não deu para mudar. Você continua sem receber conversas.'
      );
    } finally {
      setTrocandoEstado(false);
    }
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

  function sair() {
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
  const plantaoLabel =
    restam !== null && restam <= 60
      ? `Plantão acaba em ${Math.max(restam, 1)} min`
      : shift
        ? `Plantão até ${horaLocal(shift.endsAt)}`
        : null;

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-ink-900 sm:text-lg">{user.name}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-ink-500">
            <Dot tone={estado.tone} />
            {estado.label}
            {plantaoLabel && (
              <>
                <span aria-hidden="true" className="text-ink-300">
                  ·
                </span>
                <span className={acabando ? 'font-medium text-amber-700' : undefined}>
                  {plantaoLabel}
                </span>
              </>
            )}
          </p>
        </div>

        {/* tela grande: as ações ficam à vista */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <Button
            type="button"
            variant="secondary"
            disabled={trocandoEstado}
            onClick={() => void alternarDisponibilidade()}
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
            <Button type="button" variant="secondary" onClick={() => router.push('/admin/dashboard')}>
              Painel
            </Button>
          )}
          {shift && (
            <Button type="button" variant="secondary" onClick={() => setConfirmando(true)}>
              Encerrar plantão
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={sair}>
            Sair
          </Button>
        </div>

        {/* celular: um botão só, que abre o resto — o título precisa do espaço */}
        <div ref={menuRef} className="relative shrink-0 sm:hidden">
          <button
            type="button"
            onClick={() => setMenuAberto((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuAberto}
            aria-label="Mais ações"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-600 hover:bg-ink-50"
          >
            <IconMais />
          </button>

          {menuAberto && (
            <div
              role="menu"
              className="absolute right-0 top-12 w-60 overflow-hidden rounded-2xl border border-ink-200 bg-white py-1 shadow-[var(--shadow-lift)]"
            >
              <button
                type="button"
                role="menuitem"
                disabled={trocandoEstado}
                onClick={() => {
                  setMenuAberto(false);
                  void alternarDisponibilidade();
                }}
                className="flex min-h-12 w-full items-center gap-2 px-4 text-left text-sm text-ink-800 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Dot tone={estado.tone} />
                {user.availability === 'available' ? 'Ficar ausente' : 'Ficar disponível'}
              </button>

              {user.role === 'admin' && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => router.push('/admin/dashboard')}
                  className="flex min-h-12 w-full items-center px-4 text-left text-sm text-ink-800 hover:bg-ink-50"
                >
                  Painel do hospital
                </button>
              )}

              {shift && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuAberto(false);
                    setConfirmando(true);
                  }}
                  className="flex min-h-12 w-full items-center px-4 text-left text-sm text-ink-800 hover:bg-ink-50"
                >
                  Encerrar plantão
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={sair}
                className="flex min-h-12 w-full items-center border-t border-ink-100 px-4 text-left text-sm text-ink-600 hover:bg-ink-50"
              >
                Sair
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Fora do menu do celular de propósito: o menu fecha ao tocar, e o aviso
          precisa continuar na tela depois disso. */}
      {erroEstado && (
        <p
          role="alert"
          className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 sm:px-6"
        >
          {erroEstado}
        </p>
      )}

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
