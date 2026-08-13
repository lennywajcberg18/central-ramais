import { MessageDirection, SenderType } from '@prisma/client';
import { prisma } from '../prisma';

// wa_message_id é UNIQUE global — é o dedupe de reentrega do Twilio.
export async function existsByWaMessageId(waMessageId: string): Promise<boolean> {
  const found = await prisma.message.findUnique({
    where: { waMessageId },
    select: { id: true },
  });
  return found !== null;
}

export interface CreateMessageInput {
  conversationId: string;
  direction: MessageDirection;
  senderType: SenderType;
  body: string;
  waMessageId?: string;
}

// A mensagem herda o tenant da conversation; quem chama já validou o tenant dela.
export function create(input: CreateMessageInput) {
  return prisma.message.create({ data: input });
}

export function listByConversation(tenantId: string, conversationId: string) {
  return prisma.message.findMany({
    where: { conversationId, conversation: { tenantId } },
    orderBy: { createdAt: 'asc' },
  });
}
