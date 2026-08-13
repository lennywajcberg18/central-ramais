// Comparação de palavras-chave (MENU, SIM, NÃO): case-insensitive, sem acento, trim
export function normalizeKeyword(raw: string): string {
  return raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

// Código de entry link no corpo da mensagem: "Olá! [MEDX]"
export function extractEntryCode(body: string): string | null {
  const match = body.match(/\[([A-Za-z0-9]{4})\]/);
  return match ? match[1].toUpperCase() : null;
}
