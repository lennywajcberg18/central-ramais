import { prisma } from '../src/prisma';

// Força o cenário do teste de timeout: conversa parada há 31 minutos
async function main() {
  const result = await prisma.conversation.updateMany({
    where: { status: { in: ['awaiting_department', 'assigned', 'awaiting_menu_confirm'] } },
    data: { lastMessageAt: new Date(Date.now() - 31 * 60 * 1000) },
  });
  console.log(`conversas envelhecidas: ${result.count}`);
}

main().finally(() => prisma.$disconnect());
