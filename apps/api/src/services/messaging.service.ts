import { SenderType } from '@prisma/client';
import { getProviderFor } from '../providers';
import * as conversations from '../repositories/conversations';
import * as messages from '../repositories/messages';

// Mensagem fora de conversa (recusas de acesso): envia sem persistir em messages,
// porque messages exige conversation_id. A recusa fica registrada em access_attempts.
export async function sendLooseText(fromNumber: string, to: string, body: string): Promise<void> {
  await getProviderFor(fromNumber).sendText(to, body);
}

// Mensagem dentro de conversa: envia, persiste e atualiza last_message_at.
export async function sendConversationMessage(
  tenantId: string,
  conversationId: string,
  fromNumber: string,
  to: string,
  body: string,
  senderType: SenderType = 'system'
): Promise<void> {
  const { providerMessageId } = await getProviderFor(fromNumber).sendText(to, body);
  await messages.create({
    conversationId,
    direction: 'outbound',
    senderType,
    body,
    waMessageId: providerMessageId,
  });
  await conversations.touchLastMessage(tenantId, conversationId);
}
