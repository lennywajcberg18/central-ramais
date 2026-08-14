import { prisma } from '../src/prisma';
import { seed } from '../prisma/seed';

// Roda no start do serviço em produção: o plano free do Render não tem
// pre-deploy hook, então o seed precisa ser idempotente — banco já populado
// segue direto, sem apagar nada.
async function main(): Promise<void> {
  const tenants = await prisma.tenant.count();
  if (tenants > 0) {
    console.log(`[seed-if-empty] ${tenants} tenants no banco — nada a fazer`);
    return;
  }
  console.log('[seed-if-empty] banco vazio, populando…');
  await seed();
}

main()
  .catch((err) => {
    // Falhar aqui não pode impedir a API de subir: sem os dados de demonstração
    // o app funciona, só fica sem conteúdo.
    console.error('[seed-if-empty] falhou:', err);
  })
  .finally(() => prisma.$disconnect());
