import { randomUUID } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { BadRequestError } from '../errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { getSetup, getTimeline } from '../services/simulator.service';
import { handleInbound } from '../services/webhook.service';
import { normalizeWaNumber } from '../utils/phone';

// Simulador de demonstração: encena o lado de fora (o celular de quem escreve
// para o hospital) sem depender de um número de WhatsApp de verdade. Passa pelo
// MESMO caminho do webhook — não existe atalho aqui, senão a demonstração
// mentiria sobre o comportamento do sistema.
const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/admin/simulator/setup', async (req, res, next) => {
  try {
    res.json(await getSetup(req.auth!.tenantId));
  } catch (err) {
    next(err);
  }
});

const inboundSchema = z.object({
  waNumber: z.string().trim().min(8).max(20),
  body: z.string().max(4096),
});

router.post('/admin/simulator/inbound', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = inboundSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('número ou mensagem inválidos');

    const setup = await getSetup(tenantId);
    if (!setup.whatsappNumber) {
      throw new BadRequestError('este hospital não tem número de WhatsApp configurado');
    }

    // O webhook descarta em silêncio o que não é E.164; aqui tem quem avisar.
    const from = normalizeWaNumber(parsed.data.waNumber);
    if (!from) throw new BadRequestError('número inválido');

    await handleInbound({
      from,
      to: setup.whatsappNumber,
      body: parsed.data.body,
      messageSid: `SIM${randomUUID()}`,
      // O que impede a demonstração de mandar WhatsApp para o número que o admin
      // digitou — que é inventado, e pode ser de alguém.
      simulado: true,
    });

    res.status(202).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/simulator/thread', async (req, res, next) => {
  try {
    const waNumber = z.string().trim().min(8).max(20).safeParse(req.query.waNumber);
    if (!waNumber.success) throw new BadRequestError('número inválido');
    const numero = normalizeWaNumber(waNumber.data);
    if (!numero) throw new BadRequestError('número inválido');
    res.json(await getTimeline(req.auth!.tenantId, numero));
  } catch (err) {
    next(err);
  }
});

export default router;
