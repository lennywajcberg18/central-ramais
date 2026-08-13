// O Twilio manda "whatsapp:+5521999999999"; no banco guardamos E.164 puro.
// Em form-urlencoded o "+" pode chegar decodificado como espaço — tolera e repõe.
export function normalizeWaNumber(raw: string): string {
  const cleaned = raw
    .replace(/^whatsapp:/i, '')
    .replace(/\s+/g, '')
    .trim();
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}
