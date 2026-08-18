import { Request, Response, Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { varrerPlantoesVencidos } from '../jobs/shift';
import { varrerConversasParadas } from '../jobs/timeout';

const router = Router();

// Comparação em tempo constante. Um `===` vaza, pelo tempo de resposta, quantos
// caracteres do segredo o atacante já acertou — e este segredo é a única coisa
// entre a internet e um endpoint que varre o banco inteiro.
function segredoConfere(recebido: string | undefined): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(config.CRON_SECRET);
  // timingSafeEqual exige o mesmo tamanho; comparar antes revela só o tamanho,
  // que não ajuda quem não sabe o conteúdo.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Aceita as duas formas: `Authorization: Bearer` é o que o cron da Vercel manda,
// `x-cron-secret` é o que o pg_cron do Supabase manda pelo pg_net.
function autorizado(req: Request): boolean {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    if (segredoConfere(auth.slice(7))) return true;
  }
  const header = req.headers['x-cron-secret'];
  return typeof header === 'string' && segredoConfere(header);
}

// As varreduras que o `setInterval` fazia sozinho. Em serverless não existe
// processo vivo entre requisições, então quem marca a hora é um cron de fora.
//
// Responde 200 mesmo com erro na varredura, e o motivo é o mesmo do webhook: um
// agendador que recebe 500 costuma repetir, e repetir uma varredura que falhou
// por indisponibilidade do banco só multiplica a carga em cima de um banco que
// já está mal. O erro vai para o log e a execução seguinte tenta de novo — daqui
// a um minuto, que é cedo o suficiente.
function varredura(nome: string, executar: () => Promise<number>) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!autorizado(req)) {
      // 404, não 401: 401 confirma que o endpoint existe e convida a insistir.
      res.status(404).json({ error: 'not_found' });
      return;
    }
    try {
      const afetados = await executar();
      res.status(200).json({ ok: true, afetados });
    } catch (err) {
      console.error(`[cron] varredura ${nome} falhou:`, err);
      res.status(200).json({ ok: false });
    }
  };
}

router.post('/jobs/timeout', varredura('timeout', varrerConversasParadas));
router.post('/jobs/shift', varredura('shift', varrerPlantoesVencidos));

export default router;
