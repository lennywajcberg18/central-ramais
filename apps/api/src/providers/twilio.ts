// Único arquivo do projeto que importa o SDK da Twilio.
import twilio from 'twilio';
import { config } from '../config';
import { SendResult, WhatsAppProvider } from './types';

export class TwilioProvider implements WhatsAppProvider {
  private readonly client: ReturnType<typeof twilio>;

  constructor(private readonly from: string) {
    this.client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    const message = await this.client.messages.create({
      from: `whatsapp:${this.from}`,
      to: `whatsapp:${to}`,
      body,
    });
    return { providerMessageId: message.sid };
  }
}

// Validação de assinatura do webhook. Vive aqui para o SDK da Twilio não vazar
// para fora de providers/twilio.ts. Com validate=false o SDK pula a verificação
// inteira, por isso o config.ts recusa o boot quando WHATSAPP_PROVIDER=twilio e a
// flag está desligada: desativar só faz sentido com o provider mock, em dev.
export function twilioWebhookMiddleware() {
  return twilio.webhook({
    validate: config.TWILIO_VALIDATE_WEBHOOK,
    authToken: config.TWILIO_AUTH_TOKEN,
  });
}
