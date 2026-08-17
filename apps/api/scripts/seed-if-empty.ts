import { config } from '../src/config';
import { prisma } from '../src/prisma';
import { seed } from '../prisma/seed';

// Roda no start do serviço em produção: o plano free do Render não tem
// pre-deploy hook, então o seed precisa ser idempotente — banco já populado
// segue direto, sem apagar nada.
async function main(): Promise<void> {
  // O seed cria dois administradores de senha fraca (123456), um deles de um
  // segundo tenant. "Banco vazio" não distingue a demonstração de um hospital de
  // verdade no primeiro deploy: só um portão explícito faz isso. Ele é opt-in e o
  // render.yaml não publica a variável — quem sobe o blueprint só semeia se
  // adicionar ALLOW_DEMO_SEED=true à mão, no painel do Render.
  if (!config.ALLOW_DEMO_SEED) {
    console.log('[seed-if-empty] ALLOW_DEMO_SEED != true — nada a fazer');
    return;
  }

  let tenants: number;
  let usuarios: number;
  try {
    // Contar usuários também, e não só tenants: prisma/seed.ts não roda em
    // transação, então uma queda no meio dele deixa o tenant criado sem nenhum
    // usuário. Decidir por tenants faria o start seguinte sair pelo early return e
    // subir verde com ninguém conseguindo logar. Repetir o seed nesse estado é
    // seguro — ele apaga tudo antes de recriar.
    tenants = await prisma.tenant.count();
    usuarios = await prisma.user.count();
  } catch (err) {
    // Este script roda dentro do `&&` do startCommand: sair com 1 aqui impede a API
    // de subir. Erro de leitura no start é quase sempre passageiro (cold start do
    // Postgres free, pool ainda preso pela instância anterior, queda de conexão) e
    // não justifica derrubar o deploy — sem semear, a API sobe e serve o banco que
    // já existe, e o /health cuida do caso em que o banco está mesmo fora.
    console.error('[seed-if-empty] não deu para consultar o banco, seguindo sem semear:', err);
    return;
  }

  if (usuarios > 0) {
    console.log(
      `[seed-if-empty] banco populado (${tenants} tenants, ${usuarios} usuários) — nada a fazer`
    );
    return;
  }
  console.log(
    tenants > 0
      ? `[seed-if-empty] ${tenants} tenants e nenhum usuário — seed anterior caiu no meio, repopulando…`
      : '[seed-if-empty] banco vazio, populando…'
  );
  await seed();
}

main()
  .catch((err) => {
    console.error('[seed-if-empty] falhou:', err);
    // Só chega aqui se o SEED em si falhou: a leitura que decide o early return tem
    // catch próprio e não passa por aqui. Sair com 0 faria o `&&` do startCommand
    // subir a API e o Render marcar como sucesso um deploy sem tenant, sem admin e
    // sem link, com /health verde e ninguém conseguindo logar. Melhor derrubar o
    // deploy — o start seguinte vê o banco meio-populado e repopula.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
