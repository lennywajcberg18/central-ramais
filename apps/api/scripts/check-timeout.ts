import { prisma } from '../src/prisma';

async function main() {
  const rows = await prisma.conversation.findMany({
    where: { closeReason: 'timeout' },
    select: { status: true, closeReason: true },
  });
  console.log('timeouts:', rows.length, rows.map((r) => r.status).join(','));
}

main().finally(() => prisma.$disconnect());
