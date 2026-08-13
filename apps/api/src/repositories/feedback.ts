import { prisma } from '../prisma';

// O chamador já validou que a conversation pertence ao tenant.
export function createScore(conversationId: string, score: number) {
  return prisma.feedback.create({ data: { conversationId, score } });
}

export function setComment(conversationId: string, comment: string) {
  return prisma.feedback.update({
    where: { conversationId },
    data: { comment },
  });
}
