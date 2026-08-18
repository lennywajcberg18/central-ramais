import { z } from 'zod';

// Carrega apps/api/.env quando rodando via tsx (o Prisma CLI carrega sozinho)
try {
  process.loadEnvFile('.env');
} catch {
  // sem .env local — as variáveis precisam vir do ambiente
}

// Esquema faltando ou barra final passam por z.string() sem reclamar: a API sobe,
// /health responde 200, e todo navegador recebe um Access-Control-Allow-Origin que
// não bate com o Origin dele. O sintoma é "clico em Entrar e não acontece nada",
// sem uma linha de log no servidor. Barrar no boot é o único lugar barato.
const urlNormalizada = z
  .string()
  .url()
  .transform((v) => v.replace(/\/$/, ''));

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Quem lê a DIRECT_URL é o `prisma migrate`, não o processo que está subindo.
  // Ela é exigida no boot mesmo assim, para que um painel preenchido pela metade
  // falhe alto. Sem isso o resultado é o pior possível: as migrations vão para o
  // banco novo, a aplicação continua lendo e escrevendo no antigo, e não há erro
  // nenhum para denunciar isso até alguém reparar, meses depois, que os dados se
  // dividiram em dois. Aconteceu de verdade na saída do Render, onde trocar a
  // origem da variável no blueprint não apagou o valor que o serviço já guardava.
  DIRECT_URL: z.string().min(1),
  // Escape para quem tem IPv6 de verdade: aí a DIRECT_URL pode ser a conexão
  // direta (db.<ref>.supabase.co) enquanto a aplicação fica no pooler, e os dois
  // hosts divergem legitimamente. Fora desse caso, hosts diferentes são o
  // acidente descrito acima.
  ALLOW_SPLIT_DB_HOSTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PORT: z.coerce.number().default(3001),
  // Segredo do agendador. Sem processo vivo entre requisições, as varreduras
  // viram endpoints HTTP — e endpoint que varre o banco inteiro, aberto, é
  // convite a esgotar o banco de graça. Obrigatório porque o padrão seguro aqui
  // não existe: um valor de fábrica num repositório público não é segredo.
  CRON_SECRET: z.string().min(24),
  JWT_SECRET: z.string().min(16),
  WHATSAPP_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VALIDATE_WEBHOOK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Portão do seed de demonstração (scripts/seed-if-empty.ts). Ausente é o padrão
  // seguro: um clone deste blueprint para um hospital de verdade não terá a
  // variável e o banco novo não nasce com os administradores de senha fraca.
  ALLOW_DEMO_SEED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // A plataforma já sabe a URL pública do serviço; repeti-la à mão numa variável
  // é como o QR code de um deploy de preview acaba apontando para o de produção.
  // A Vercel injeta VERCEL_URL sem esquema (só o host), daí o https:// na frente.
  PUBLIC_BASE_URL: urlNormalizada.default(
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001'
  ),
  WEB_ORIGIN: urlNormalizada.default('http://localhost:3000'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[config] variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

if (config.WHATSAPP_PROVIDER === 'twilio' && !config.TWILIO_AUTH_TOKEN) {
  console.error('[config] WHATSAPP_PROVIDER=twilio exige TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN');
  process.exit(1);
}

// Um controle de segurança que vem desligado de fábrica só protege quem lembrou de
// ligar. Sem assinatura, o webhook aceita POST anônimo da internet inteira — e o
// único campo que resolve o tenant é o `To`, que é público por desenho (sai no 302
// de /c/<slug> e no QR code). Daria para forjar mensagem dentro da conversa viva de
// um paciente e para chutar entry_code até entrar num setor sem nunca ter link.
if (config.WHATSAPP_PROVIDER === 'twilio' && !config.TWILIO_VALIDATE_WEBHOOK) {
  console.error(
    '[config] WHATSAPP_PROVIDER=twilio exige TWILIO_VALIDATE_WEBHOOK=true — sem assinatura o webhook aceita mensagem forjada de qualquer origem'
  );
  process.exit(1);
}

// O .env.example é versionado num repositório público. Quem seguir o README ao pé
// da letra assina JWT com uma chave que qualquer pessoa lê no GitHub — e um token
// {role:'admin'} forjado devolve, em GET /admin/entry-links, os códigos que
// sustentam o segundo nível de autorização do produto.
const JWT_SECRET_DE_EXEMPLO = 'dev-secret-troque-em-producao';
if (config.JWT_SECRET === JWT_SECRET_DE_EXEMPLO) {
  console.error(
    '[config] JWT_SECRET é o valor de exemplo, público no repositório. Gere o seu: openssl rand -base64 32'
  );
  process.exit(1);
}

function urlDoBanco(valor: string, nome: string): URL {
  try {
    return new URL(valor);
  } catch {
    console.error(`[config] ${nome} não é uma URL de conexão válida`);
    process.exit(1);
  }
}

const urlDaAplicacao = urlDoBanco(config.DATABASE_URL, 'DATABASE_URL');
const urlDasMigrations = urlDoBanco(config.DIRECT_URL, 'DIRECT_URL');

// Pooler em modo transação sem `pgbouncer=true`: o Prisma prepara um statement
// numa conexão e tenta reusá-lo em outra, que não o conhece. O erro
// ("prepared statement \"s0\" already exists") só aparece sob carga e some quando
// alguém vai olhar — o formato que não se depura em produção. E a string que o
// painel do Supabase entrega para copiar NÃO traz o parâmetro, então esquecê-lo
// é o caminho provável, não o descuidado.
if (urlDaAplicacao.port === '6543' && urlDaAplicacao.searchParams.get('pgbouncer') !== 'true') {
  console.error(
    '[config] DATABASE_URL usa a porta 6543 (pooler em modo transação) sem ?pgbouncer=true — ' +
      'sem ele a API falha de forma intermitente sob carga, com "prepared statement already exists"'
  );
  process.exit(1);
}

// As duas URLs têm de ser o MESMO banco. Este é o guarda contra a divisão
// silenciosa: migration num servidor, aplicação em outro, ambos funcionando.
if (
  !config.ALLOW_SPLIT_DB_HOSTS &&
  urlDaAplicacao.hostname !== urlDasMigrations.hostname
) {
  console.error(
    `[config] DATABASE_URL e DIRECT_URL apontam para servidores diferentes ` +
      `(${urlDaAplicacao.hostname} e ${urlDasMigrations.hostname}). As migrations iriam para ` +
      `um banco e a aplicação para outro. Se isso é intencional (conexão direta por IPv6 ` +
      `para migrations), ligue ALLOW_SPLIT_DB_HOSTS=true.`
  );
  process.exit(1);
}
