import { randomBytes } from 'crypto';

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
// sem 0/O/1/I para evitar confusão de leitura
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomFrom(alphabet: string, length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export const generateSlug = (): string => randomFrom(SLUG_ALPHABET, 8);

export const generateEntryCode = (): string => randomFrom(CODE_ALPHABET, 4);

export const buildPrefillText = (entryCode: string): string => `Olá! [${entryCode}]`;
