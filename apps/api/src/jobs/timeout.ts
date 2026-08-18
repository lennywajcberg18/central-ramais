import * as conversations from '../repositories/conversations';
import * as tenants from '../repositories/tenants';
import { closeWithCsat } from '../services/lifecycle.service';

const INTERVAL_MS = 60 * 1000;
const TIMEOUT_MINUTES = 30;

// Uma varredura: fecha as conversas paradas há mais de TIMEOUT_MINUTES.
//
// Não há mais trava `running` em memória. Ela impedia duas varreduras de se
// sobreporem DENTRO de um processo, e essa premissa some em serverless, onde a
// próxima invocação pode ser outra máquina. O que impede o encerramento em dobro
// não era ela e sim o `closeWithCsat`, que é compare-and-swap: quem chega
// depois não encontra a conversa no estado esperado, não escreve, e a pergunta de
// nota não sai duas vezes. Isso é o cenário 1 do `check-corridas`, que roda seis
// rodadas justamente com duas varreduras concorrentes.
export async function varrerConversasParadas(): Promise<number> {
  let fechadas = 0;
  const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000);
  // itera por tenant explicitamente — nunca varre a tabela inteira num cron multi-tenant
  const allTenants = await tenants.listIds();
  for (const tenant of allTenants) {
    const stale = await conversations.listStaleForTimeout(tenant.id, cutoff);
    for (const conversation of stale) {
      try {
        await closeWithCsat(tenant.id, conversation.id, 'timeout');
        fechadas++;
      } catch (err) {
        // Uma conversa que não fechou não pode levar as outras junto: o resto da
        // varredura continua e a próxima tenta de novo.
        console.error(`[timeout-job] falha ao encerrar ${conversation.id}:`, err);
      }
    }
  }
  return fechadas;
}

// Só para `npm run dev`. Em produção quem chama é o cron, por HTTP.
export function startTimeoutJob(): NodeJS.Timeout {
  return setInterval(() => {
    varrerConversasParadas().catch((err) =>
      console.error('[timeout-job] falha na varredura:', err)
    );
  }, INTERVAL_MS);
}
