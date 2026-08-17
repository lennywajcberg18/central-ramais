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
import webhookRouter from './routes/webhook';

export function createApp() {
  const app = express();

  // Atrás do proxy do Render a requisição chega como http; sem isto a validação
  // de assinatura do Twilio remonta a URL errada e rejeita webhook legítimo.
  app.set('trust proxy', true);

  app.use(cors({ origin: config.WEB_ORIGIN }));

  // É o healthCheckPath do render.yaml: é com ele que o Render decide promover um
  // deploy e se o serviço ainda está de pé. Um 200 que não toca dependência nenhuma
  // deixa o painel verde com o Postgres fora do ar — nada reinicia, nada faz
  // rollback, e toda requisição de atendente devolve 500 até alguém ligar
  // reclamando. O SELECT 1 é o que transforma "processo vivo" em "serviço útil".
  // Fica no app e não numa camada nova: é uma linha de SQL, não regra de negócio.
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: 'up' });
    } catch (err) {
      console.error('[health] banco inalcançável:', err);
      res.status(503).json({ ok: false, db: 'down' }); // 503 é o que faz o Render agir
    }
  });

  // webhook usa urlencoded próprio (form do Twilio), antes do json global
  app.use('/webhooks', webhookRouter);

  app.use(publicRouter);

  app.use(express.json());

  app.use(authRouter);
  app.use(agentRouter);
  app.use(adminRouter);
  app.use(adminConversationsRouter);
  app.use(simulatorRouter);

  app.use(errorHandler);

  return app;
}
