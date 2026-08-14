import { prisma } from '../prisma';

// Consultas exclusivas do simulador de demonstração: montam a visão do lado de
// FORA (o "celular" de quem escreve para o hospital), que nenhuma outra tela tem.

export function listMessagesForContact(tenantId: string, externalContactId: string) {
  return prisma.message.findMany({
    where: { conversation: { tenantId, externalContactId } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      direction: true,
      senderType: true,
      body: true,
      createdAt: true,
      conversationId: true,
    },
  });
}

// As recusas de acesso não geram conversa e por isso não estão em `messages`.
// Para o celular simulado ficar fiel, elas entram na linha do tempo daqui.
export function listAttemptsForNumber(tenantId: string, waNumber: string) {
  return prisma.accessAttempt.findMany({
    where: { tenantId, waNumber },
    orderBy: { createdAt: 'asc' },
    select: { id: true, reason: true, entryCodeTried: true, createdAt: true },
  });
}
