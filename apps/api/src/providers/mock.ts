import { randomUUID } from 'crypto';
import { SendResult, WhatsAppProvider } from './types';

export class MockProvider implements WhatsAppProvider {
  constructor(private readonly from: string) {}

  async sendText(to: string, body: string): Promise<SendResult> {
    console.log(`[mock-wa] ${this.from} → ${to}\n${body}\n`);
    return { providerMessageId: `mock-${randomUUID()}` };
  }
}
