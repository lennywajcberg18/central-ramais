import { config } from '../config';
import { MockProvider } from './mock';
import { TwilioProvider } from './twilio';
import { WhatsAppProvider } from './types';

// Um provider por número de origem (MVP: um número por tenant)
const cache = new Map<string, WhatsAppProvider>();

// `simulado` força o MockProvider mesmo com a Twilio configurada. É o que impede
// o simulador de demonstração de mandar WhatsApp de verdade para um número
// inventado — que pode ser de alguém.
export function getProviderFor(fromNumber: string, simulado = false): WhatsAppProvider {
  const chave = simulado ? `sim:${fromNumber}` : fromNumber;
  let provider = cache.get(chave);
  if (!provider) {
    provider =
      config.WHATSAPP_PROVIDER === 'twilio' && !simulado
        ? new TwilioProvider(fromNumber)
        : new MockProvider(fromNumber);
    cache.set(chave, provider);
  }
  return provider;
}

export type { WhatsAppProvider, SendResult } from './types';
