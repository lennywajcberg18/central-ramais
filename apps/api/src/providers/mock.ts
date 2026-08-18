import { randomUUID } from 'crypto';
import { mascararNumero } from '../utils/phone';
import { SendResult, WhatsAppProvider } from './types';

export class MockProvider implements WhatsAppProvider {
  constructor(private readonly from: string) {}

  async sendText(to: string, body: string): Promise<SendResult> {
    // O provider existe para provar que o envio aconteceu, não para reproduzir a
    // mensagem: em hospital o corpo carrega contexto clínico e `mock` é o default
    // do config.ts, então esse log sai em qualquer deploy que esqueça a variável.
    console.log(
      `[mock-wa] ${mascararNumero(this.from)} → ${mascararNumero(to)} (${body.length} chars)`
    );
    return { providerMessageId: `mock-${randomUUID()}` };
  }
}
