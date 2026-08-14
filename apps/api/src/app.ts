import cors from 'cors';
import express from 'express';
import { config } from './config';
import { errorHandler } from './middleware/error';
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

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
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
