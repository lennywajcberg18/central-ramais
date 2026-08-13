export interface SendResult {
  providerMessageId: string;
}

export interface WhatsAppProvider {
  sendText(to: string, body: string): Promise<SendResult>;
}
