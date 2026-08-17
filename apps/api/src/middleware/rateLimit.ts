import { NextFunction, Request, Response } from 'express';

// O login é a única porta pública com senha. Sem limite, quem souber um e-mail do
// hospital tem tentativas infinitas contra a conta de administrador — que enxerga
// a conversa de todos os pacientes — e o custo de cada tentativa (bcrypt) ainda
// rouba tempo do processo que entrega o webhook do Twilio.
// Contagem em memória, sem dependência nova: vale por instância, o que basta
// enquanto o serviço roda numa só.
const JANELA_MS = 15 * 60_000;
const MAX_TENTATIVAS = 10;

// Chave IP+e-mail: atrás do proxy do Render um IP é compartilhado por muita
// gente, e limitar só por IP derrubaria o login de quem não tentou nada.
const tentativas = new Map<string, number[]>();

// Cada tentativa cria uma chave; sem a varredura, um flood com e-mails aleatórios
// faz o Map crescer para sempre.
let proximaLimpeza = 0;

function limparVencidas(agora: number): void {
  if (agora < proximaLimpeza) return;
  proximaLimpeza = agora + JANELA_MS;
  for (const [chave, marcas] of tentativas) {
    if (marcas.every((t) => agora - t >= JANELA_MS)) tentativas.delete(chave);
  }
}

// Mesma normalização do schema de login, senão trocar a caixa do e-mail zera a
// contagem e o limite deixa de existir.
function emailDoCorpo(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const { email } = body as { email?: unknown };
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const agora = Date.now();
  const chave = `${req.ip ?? 'sem-ip'}|${emailDoCorpo(req.body)}`;
  const recentes = (tentativas.get(chave) ?? []).filter((t) => agora - t < JANELA_MS);

  if (recentes.length >= MAX_TENTATIVAS) {
    tentativas.set(chave, recentes);
    res.setHeader('Retry-After', String(Math.ceil((JANELA_MS - (agora - recentes[0])) / 1000)));
    res.status(429).json({ error: 'muitas tentativas de login; tente de novo em alguns minutos' });
    return;
  }

  recentes.push(agora);
  tentativas.set(chave, recentes);
  limparVencidas(agora);
  next();
}
