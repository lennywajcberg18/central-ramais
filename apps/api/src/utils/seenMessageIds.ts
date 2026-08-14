// Lembrança curta dos MessageSid já processados.
//
// Por que memória basta: o dedupe oficial é o UNIQUE de `wa_message_id` em
// `messages`, mas recusa, bloqueio e revogação não gravam mensagem nenhuma —
// nesses caminhos o banco não tem o que consultar e a reentrega do Twilio
// duplica `access_attempts`, que é justamente a métrica de segurança do
// produto. A reentrega do Twilio acontece em minutos, muito dentro da janela
// abaixo, então guardar o SID em memória cobre a janela inteira sem tabela
// nova nem escrita a mais no caminho quente.
//
// Limitação aceita: reinício do processo esquece tudo. Uma reentrega que
// atravesse um restart volta a passar — o pior caso é um `access_attempt`
// repetido, nunca uma conversa duplicada (essa o UNIQUE do banco barra).
// Também não vale entre instâncias: com mais de um processo, cada um tem a
// sua memória.

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 20_000;

// sid -> instante em que expira. A ordem de inserção do Map é a ordem de
// expiração (TTL fixo), o que torna o descarte por idade trivial.
const seen = new Map<string, number>();

export function wasSeen(sid: string): boolean {
  const expiresAt = seen.get(sid);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    seen.delete(sid);
    return false;
  }
  return true;
}

export function markSeen(sid: string): void {
  // delete antes do set para o SID reentrar no fim da ordem de inserção
  seen.delete(sid);
  seen.set(sid, Date.now() + TTL_MS);
  if (seen.size > MAX_ENTRIES) evict();
}

// Limpeza preguiçosa: não há timer rodando, o corte acontece quando o Map
// passa do teto.
function evict(): void {
  const now = Date.now();
  for (const [sid, expiresAt] of seen) {
    if (expiresAt > now) break; // o resto ainda é válido (ordem de expiração)
    seen.delete(sid);
  }
  // Ainda cheio depois de tirar os vencidos: descarta os mais antigos.
  for (const sid of seen.keys()) {
    if (seen.size <= MAX_ENTRIES) break;
    seen.delete(sid);
  }
}

// Exposto para teste/diagnóstico.
export function seenCount(): number {
  return seen.size;
}
