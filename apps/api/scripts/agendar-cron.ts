// Agenda as varreduras no pg_cron do Supabase.
//
// Em serverless não existe processo vivo entre requisições, então o `setInterval`
// dos jobs não tem onde morar. O cron da Vercel também não serve: no plano Hobby
// ele roda UMA VEZ POR DIA, e uma expressão mais frequente faz o deploy falhar.
// Quem marca a hora é o banco, chamando os endpoints de volta pelo pg_net.
//
//   PUBLIC_BASE_URL=https://sua-api.vercel.app \
//   npx tsx scripts/agendar-cron.ts
//
// É idempotente: desagenda antes de agendar, então rodar de novo depois de trocar
// a URL ou o segredo é o jeito certo de atualizar.
import { config } from '../src/config';
import { prisma } from '../src/prisma';

const VARREDURAS = [
  { nome: 'varredura-inatividade', caminho: '/jobs/timeout' },
  { nome: 'varredura-plantao', caminho: '/jobs/shift' },
];

async function main(): Promise<void> {
  const base = config.PUBLIC_BASE_URL;

  if (base.startsWith('http://localhost')) {
    console.error(
      `[cron] PUBLIC_BASE_URL é ${base} — o banco não alcança a sua máquina.\n` +
        `       Rode com a URL pública da API:\n` +
        `       PUBLIC_BASE_URL=https://sua-api.vercel.app npx tsx scripts/agendar-cron.ts`
    );
    process.exit(1);
  }

  // O pg_net vive no Supabase. Num Postgres comum ele não existe, e agendar aqui
  // não faria sentido nenhum — o processo local já roda os setInterval.
  const temPgNet = await prisma.$queryRaw<{ existe: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') AS existe
  `;
  if (!temPgNet[0]?.existe) {
    console.error('[cron] este banco não tem pg_net nem pg_cron — nada a agendar aqui.');
    process.exit(1);
  }

  for (const { nome, caminho } of VARREDURAS) {
    // Desagendar primeiro deixa o script idempotente. Ele grita se o job não
    // existir, e é por isso que o erro é engolido: na primeira execução não existe
    // mesmo.
    try {
      await prisma.$executeRawUnsafe(`SELECT cron.unschedule('${nome}')`);
    } catch {
      // ainda não existia
    }

    const url = `${base}${caminho}`;
    // O segredo entra na definição do job e passa a viver na tabela `cron.job`,
    // legível só pelo dono do banco. Nunca no repositório.
    const cabecalhos = JSON.stringify({
      'Content-Type': 'application/json',
      'x-cron-secret': config.CRON_SECRET,
    });

    await prisma.$executeRawUnsafe(`
      SELECT cron.schedule('${nome}', '* * * * *', $job$
        SELECT net.http_post(
          url := '${url}',
          headers := '${cabecalhos}'::jsonb
        );
      $job$)
    `);
    console.log(`agendado  ${nome.padEnd(22)} a cada minuto  ->  ${url}`);
  }

  const jobs = await prisma.$queryRaw<{ jobname: string; schedule: string; active: boolean }[]>`
    SELECT jobname, schedule, active FROM cron.job ORDER BY jobname
  `;
  console.log('\ncron.job:');
  for (const j of jobs) {
    console.log(`  ${j.jobname.padEnd(24)} ${j.schedule.padEnd(12)} ativo=${j.active}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[cron] falhou:', err);
  await prisma.$disconnect();
  process.exit(1);
});
