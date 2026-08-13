import { config } from '../config';
import { MockProvider } from './mock';
import { TwilioProvider } from './twilio';
import { WhatsAppProvider } from './types';

// Um provider por número de origem (MVP: um número por tenant)
const cache = new Map<string, WhatsAppProvider>();

export function getProviderFor(fromNumber: string): WhatsAppProvider {
  let provider = cache.get(fromNumber);
  if (!provider) {
    provider =
      config.WHATSAPP_PROVIDER === 'twilio'
        ? new TwilioProvider(fromNumber)
        : new MockProvider(fromNumber);
    cache.set(fromNumber, provider);
  }
  return provider;
}

export type { WhatsAppProvider, SendResult } from './types';
