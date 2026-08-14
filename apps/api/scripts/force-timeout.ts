import { prisma } from '../src/prisma';

// Força o cenário do teste de timeout: conversa parada há 31 minutos.
// A regra do tenantId vale aqui também — script que varre a tabela inteira é
// exatamente o hábito que vaza dado entre hospitais quando vira código de verdade.
async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
    console.error('informe o tenant: npx tsx scripts/force-timeout.ts <tenantId>');
    console.error(tenants.map((t) => `  ${t.id}  ${t.name}`).join('\n'));
    process.exitCode = 1;
    return;
  }

  const result = await prisma.conversation.updateMany({
    where: {
      tenantId,
      status: { in: ['awaiting_department', 'assigned', 'awaiting_menu_confirm'] },
    },
    data: { lastMessageAt: new Date(Date.now() - 31 * 60 * 1000) },
  });
  console.log(`conversas envelhecidas: ${result.count}`);
}

main().finally(() => prisma.$disconnect());
