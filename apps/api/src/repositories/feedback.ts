import { prisma } from '../prisma';

// O chamador já validou que a conversation pertence ao tenant.
export function createScore(conversationId: string, score: number) {
  return prisma.feedback.create({ data: { conversationId, score } });
}

// Correção da nota dentro da janela de comentário: quem manda "2" logo depois de
// "9" está se corrigindo, e a nota nova é a que vale.
export function updateScore(conversationId: string, score: number) {
  return prisma.feedback.update({
    where: { conversationId },
    data: { score },
  });
}

export function setComment(conversationId: string, comment: string) {
  return prisma.feedback.update({
    where: { conversationId },
    data: { comment },
  });
}
