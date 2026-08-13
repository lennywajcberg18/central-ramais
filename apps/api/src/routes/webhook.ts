import express, { Router } from 'express';
import { twilioWebhookMiddleware } from '../providers/twilio';
import { handleInbound } from '../services/webhook.service';

const router = Router();

router.post(
  '/twilio/whatsapp',
  express.urlencoded({ extended: false }),
  twilioWebhookMiddleware(),
  async (req, res) => {
    try {
      const { From, To, Body, MessageSid } = req.body as Record<string, string | undefined>;
      if (From && To) {
        await handleInbound({
          from: From,
          to: To,
          body: Body ?? '',
          messageSid: MessageSid ?? '',
        });
      }
    } catch (err) {
      // O webhook SEMPRE responde 200 — 500 faz o Twilio reentregar em loop.
      console.error('[webhook] erro interno processando inbound:', err);
    }
    res.status(200).type('text/xml').send('<Response></Response>');
  }
);

export default router;
