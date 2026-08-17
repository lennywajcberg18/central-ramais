export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface SessionUser {
  id: string;
  tenantId: string;
  role: 'admin' | 'agent';
  name: string;
  email: string;
  availability: 'available' | 'away' | 'offline';
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export function getSessionUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export function saveSession(token: string, user: SessionUser): void {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Recusa acionável traz contexto no corpo (ex.: quando é o próximo plantão).
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  // Na tela de login o 401 é a resposta esperada de credencial errada, não uma
  // sessão expirada. Redirecionar recarregaria a página e apagaria a mensagem
  // de erro do formulário antes de o usuário conseguir lê-la.
  const naTelaDeLogin = typeof window !== 'undefined' && window.location.pathname === '/login';

  if (res.status === 401 && typeof window !== 'undefined' && !naTelaDeLogin) {
    // Fim de plantão derruba a sessão no meio do uso. Sem dizer o motivo na tela
    // de login, a pessoa acha que o sistema quebrou e tenta entrar de novo.
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const plantaoEncerrado = body?.error === 'plantão encerrado';
    clearSession();
    window.location.href = plantaoEncerrado ? '/login?motivo=plantao' : '/login';
    throw new ApiError(401, body?.error ?? 'sessão expirada');
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | ({ error?: string } & Record<string, unknown>)
      | null;
    throw new ApiError(res.status, body?.error ?? `erro ${res.status}`, body ?? undefined);
  }

  return (await res.json()) as T;
}
