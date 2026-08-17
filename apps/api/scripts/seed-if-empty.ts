import { config } from '../src/config';
import { prisma } from '../src/prisma';
import { seed } from '../prisma/seed';

// Roda no start do serviço em produção: o plano free do Render não tem
// pre-deploy hook, então o seed precisa ser idempotente — banco já populado
// segue direto, sem apagar nada.
async function main(): Promise<void> {
  // O seed cria dois administradores de senha fraca, um deles de um segundo
  // tenant. "Banco vazio" não distingue a demonstração de um hospital de verdade
  // no primeiro deploy: só um portão explícito faz isso, e ele é opt-in porque
  // quem clonar o blueprint não vai ter a variável.
  if (!config.ALLOW_DEMO_SEED) {
    console.log('[seed-if-empty] ALLOW_DEMO_SEED != true — nada a fazer');
    return;
  }

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
    console.error('[seed-if-empty] falhou:', err);
    // Falhar aqui só acontece com o banco VAZIO — o caso "já populado" sai pelo
    // early return. Sair com 0 faria o `&&` do startCommand subir a API e o Render
    // marcar como sucesso um deploy sem tenant, sem admin e sem link, com /health
    // verde e ninguém conseguindo logar. Melhor derrubar o deploy.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
