// O Twilio manda "whatsapp:+5521999999999"; no banco guardamos E.164 puro.
// Em form-urlencoded o "+" pode chegar decodificado como espaço — tolera e repõe.
const E164 = /^\+[1-9]\d{7,14}$/;

// null quando o que sobrou não é E.164. Sem essa recusa, um `From` arbitrário
// vira linha em `access_attempts` — a tela onde o admin descobre que um link
// nominal vazou — e esconde o vazamento real no meio do ruído; um `From` vazio
// viraria o contato de número '+', que o @@unique([tenantId, waNumber]) aceita.
export function normalizeWaNumber(raw: string): string | null {
  const cleaned = raw
    .replace(/^whatsapp:/i, '')
    .replace(/[\s-]/g, '')
    .trim();
  const comMais = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  return E164.test(comMais) ? comMais : null;
}

// Número em log: só os 4 últimos dígitos. O log vai para o painel da plataforma,
// que tem outra política de acesso e outra retenção que o atendimento — quem lê
// log de infraestrutura não é quem está autorizado a ver paciente.
export function mascararNumero(numero: string): string {
  return numero.length <= 4 ? '****' : `${'*'.repeat(numero.length - 4)}${numero.slice(-4)}`;
}
