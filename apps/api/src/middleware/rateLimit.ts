import { NextFunction, Request, Response } from 'express';

// O login é a única porta pública com senha. Sem limite, quem souber um e-mail do
// hospital tem tentativas infinitas contra a conta de administrador — que enxerga
// a conversa de todos os pacientes — e o custo de cada tentativa (bcrypt) ainda
// rouba tempo do processo que entrega o webhook do Twilio.
// Contagem em memória, sem dependência nova: vale por instância, o que basta
// enquanto o serviço roda numa só.
const JANELA_MS = 15 * 60_000;

// Dois baldes, porque um só não fecha a porta:
//
// - por origem (IP + e-mail): atrás do proxy do Render um IP é compartilhado por
//   muita gente, e limitar só por IP derrubaria o login de quem não tentou nada.
// - por conta (só o e-mail): o mesmo proxy que obriga a olhar o IP é o que torna
//   o IP forjável — o `req.ip` sai do X-Forwarded-For, um header do cliente. Com
//   `trust proxy` mal configurado (era `true`, ver app.ts) bastava incrementar um
//   número no header a cada tentativa para o balde de origem nunca encher. Este
//   segundo balde é o teto absoluto por conta alvo: não depende de nada que o
//   atacante escreva. O preço é que dá para trancar o login de UMA conta por 15
//   minutos de fora; força bruta ilimitada contra o admin é pior.
const MAX_POR_ORIGEM = 10;
const MAX_POR_CONTA = 20;

const porOrigem = new Map<string, number[]>();
const porConta = new Map<string, number[]>();

// Cada tentativa cria uma chave; sem a varredura, um flood com e-mails aleatórios
// faz o Map crescer para sempre.
let proximaLimpeza = 0;

function limparVencidas(agora: number): void {
  if (agora < proximaLimpeza) return;
  proximaLimpeza = agora + JANELA_MS;
  for (const mapa of [porOrigem, porConta]) {
    for (const [chave, marcas] of mapa) {
      if (marcas.every((t) => agora - t >= JANELA_MS)) mapa.delete(chave);
    }
  }
}

// Mesma normalização do schema de login, senão trocar a caixa do e-mail zera a
// contagem e o limite deixa de existir.
function emailDoCorpo(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const { email } = body as { email?: unknown };
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function chavesDaTentativa(req: Request): { origem: string; conta: string } {
  const conta = emailDoCorpo(req.body);
  return { origem: `${req.ip ?? 'sem-ip'}|${conta}`, conta };
}

function marcasVivas(mapa: Map<string, number[]>, chave: string, agora: number): number[] {
  return (mapa.get(chave) ?? []).filter((t) => agora - t < JANELA_MS);
}

export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const agora = Date.now();
  const { origem, conta } = chavesDaTentativa(req);
  const daOrigem = marcasVivas(porOrigem, origem, agora);
  const daConta = marcasVivas(porConta, conta, agora);

  // Marca mais antiga de cada balde estourado: é a que precisa vencer para abrir
  // uma vaga. Com os dois cheios, manda o que demora mais.
  const estourados = [
    daOrigem.length >= MAX_POR_ORIGEM ? daOrigem[0] : null,
    daConta.length >= MAX_POR_CONTA ? daConta[0] : null,
  ].filter((t): t is number => t !== null);

  if (estourados.length > 0) {
    porOrigem.set(origem, daOrigem);
    porConta.set(conta, daConta);
    const maisRecente = Math.max(...estourados);
    res.setHeader('Retry-After', String(Math.ceil((JANELA_MS - (agora - maisRecente)) / 1000)));
    res.status(429).json({ error: 'muitas tentativas de login; tente de novo em alguns minutos' });
    return;
  }

  daOrigem.push(agora);
  daConta.push(agora);
  porOrigem.set(origem, daOrigem);
  porConta.set(conta, daConta);
  limparVencidas(agora);
  next();
}

// O balde conta tentativa de CREDENCIAL. Quem acertou e-mail e senha e mesmo
// assim leva recusa — atendente fora do horário de plantão — não pode gastá-lo:
// a mensagem convida a insistir ("próxima janela: hoje, 19:00"), dez tentativas
// enquanto espera o turno davam 429, e quando a escala abria ele continuava
// trancado até a janela drenar. Chamar depois de conferir a senha, antes da
// recusa por escala. Limpar também o balde de origem é seguro: o teto por conta
// alvo continua de pé para todos os outros e-mails vindos daquele IP.
export function perdoarLogin(req: Request): void {
  const { origem, conta } = chavesDaTentativa(req);
  porOrigem.delete(origem);
  porConta.delete(conta);
}
