import { z } from 'zod';

// Carrega apps/api/.env quando rodando via tsx (o Prisma CLI carrega sozinho)
try {
  process.loadEnvFile('.env');
} catch {
  // sem .env local — as variáveis precisam vir do ambiente
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3001),
  JWT_SECRET: z.string().min(16),
  WHATSAPP_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VALIDATE_WEBHOOK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // O Render injeta RENDER_EXTERNAL_URL com a URL pública do serviço — usar como
  // padrão evita repetir o domínio na configuração do deploy.
  PUBLIC_BASE_URL: z.string().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:3001'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
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
