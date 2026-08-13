import cors from 'cors';
import express from 'express';
import { config } from './config';
import { errorHandler } from './middleware/error';
import adminRouter from './routes/admin';
import agentRouter from './routes/agent';
import authRouter from './routes/auth';
import publicRouter from './routes/public';
import webhookRouter from './routes/webhook';

export function createApp() {
  const app = express();

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

  app.use(errorHandler);

  return app;
}
