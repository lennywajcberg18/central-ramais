import express, { NextFunction, Request, Response, Router } from 'express';
import { twilioWebhookMiddleware } from '../providers/twilio';
import { handleInbound } from '../services/webhook.service';
import { mascararNumero } from '../utils/phone';

const router = Router();

function replyEmptyTwiml(res: Response): void {
  res.status(200).type('text/xml').send('<Response></Response>');
}

router.post(
  '/twilio/whatsapp',
  express.urlencoded({ extended: false }),
  twilioWebhookMiddleware(),
  async (req, res) => {
    // Fora do try porque o catch precisa destes campos: sem eles no log, uma
    // queda do banco engole a mensagem sem deixar nem como contar quantas
    // sumiram — o Twilio já marcou como entregue e não reentrega.
    const { From, To, Body, MessageSid, NumMedia } = req.body as Record<
      string,
      string | undefined
    >;
    try {
      if (From && To) {
        await handleInbound({
          from: From,
          to: To,
          body: Body ?? '',
          messageSid: MessageSid ?? '',
          numMedia: Number(NumMedia ?? 0),
        });
      }
    } catch (err) {
      // O webhook SEMPRE responde 200 — 500 faz o Twilio reentregar em loop.
      // O log estruturado não recupera a mensagem, só deixa de escondê-la: com o
      // MessageSid dá para reprocessar à mão pelo simulador ou por curl.
      console.error(
        JSON.stringify({
          nivel: 'error',
          evento: 'webhook_inbound_falhou',
          messageSid: MessageSid ?? null,
          to: To ? mascararNumero(To) : null,
          from: From ? mascararNumero(From) : null,
          erro: err instanceof Error ? err.message : String(err),
        })
      );
    }
    replyEmptyTwiml(res);
  }
);

// O try/catch acima só pega o que acontece DENTRO do handler. Erro levantado
// antes dele — o PayloadTooLargeError do express.urlencoded num corpo gigante —
// subiria até o error handler global e viraria 500, que é exatamente o que faz
// o Twilio reentregar em loop. Este handler é do router e roda primeiro, então
// a regra do 200 vale para a rota inteira, não só para o miolo.
//
// Assinatura inválida não passa por aqui: o middleware da Twilio responde 403
// sozinho, sem levantar erro. É intencional — recusar quem não é o Twilio não é
// falha nossa e não deve virar 200.
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  console.error('[webhook] erro antes do handler:', err);
  if (res.headersSent) {
    next(err);
    return;
  }
  replyEmptyTwiml(res);
});

export default router;
