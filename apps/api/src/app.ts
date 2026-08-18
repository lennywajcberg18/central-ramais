import cors from 'cors';
import express from 'express';
import { config } from './config';
import { errorHandler } from './middleware/error';
import { prisma } from './prisma';
import adminRouter from './routes/admin';
import adminConversationsRouter from './routes/adminConversations';
import agentRouter from './routes/agent';
import authRouter from './routes/auth';
import publicRouter from './routes/public';
import simulatorRouter from './routes/simulator';
import jobsRouter from './routes/jobs';
import webhookRouter from './routes/webhook';

export function createApp() {
  const app = express();

  // Atrás do proxy da plataforma a requisição chega como http; sem isto a
  // validação de assinatura do Twilio remonta a URL errada e rejeita webhook
  // legítimo. É `1` e não `true` porque é um salto só: com `true` o Express
  // acredita no X-Forwarded-For inteiro e resolve `req.ip` como a entrada mais à
  // ESQUERDA, que é dado do cliente — o limite de tentativas de login virava
  // decorativo, bastava incrementar um número no header. Com 1 salto, `req.ip` é
  // o endereço que o proxy anexou. O X-Forwarded-Proto continua sendo lido (o
  // salto direto segue confiável), então a URL que a Twilio assina não muda.
  app.set('trust proxy', 1);

  app.use(cors({ origin: config.WEB_ORIGIN }));

  // A pergunta que este endpoint responde é "o serviço está útil?", não "o
  // processo subiu?". Um 200 que não toca dependência nenhuma fica verde com o
  // Postgres fora do ar, e toda requisição de atendente devolve 500 até alguém
  // ligar reclamando. O SELECT 1 é o que separa as duas perguntas.
  //
  // É também o primeiro lugar onde o projeto free do Supabase pausado aparece:
  // pausado, ele recusa conexão e aqui sai 503.
  // Fica no app e não numa camada nova: é uma linha de SQL, não regra de negócio.
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: 'up' });
    } catch (err) {
      console.error('[health] banco inalcançável:', err);
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  // webhook usa urlencoded próprio (form do Twilio), antes do json global
  app.use('/webhooks', webhookRouter);

  app.use(publicRouter);

  app.use(express.json());

  app.use(jobsRouter);
  app.use(authRouter);
  app.use(agentRouter);
  app.use(adminRouter);
  app.use(adminConversationsRouter);
  app.use(simulatorRouter);

  app.use(errorHandler);

  return app;
}
