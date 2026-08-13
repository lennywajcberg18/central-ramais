import * as conversations from '../repositories/conversations';
import * as tenants from '../repositories/tenants';
import { closeWithCsat } from '../services/lifecycle.service';

const INTERVAL_MS = 60 * 1000;
const TIMEOUT_MINUTES = 30;

let running = false;

async function run(): Promise<void> {
  if (running) return; // não sobrepõe execuções
  running = true;
  try {
    const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000);
    // itera por tenant explicitamente — nunca varre a tabela inteira num cron multi-tenant
    const allTenants = await tenants.listIds();
    for (const tenant of allTenants) {
      const stale = await conversations.listStaleForTimeout(tenant.id, cutoff);
      for (const conversation of stale) {
        try {
          await closeWithCsat(tenant.id, conversation.id, 'timeout');
        } catch (err) {
          console.error(`[timeout-job] falha ao encerrar ${conversation.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[timeout-job] falha na varredura:', err);
  } finally {
    running = false;
  }
}

export function startTimeoutJob(): NodeJS.Timeout {
  return setInterval(run, INTERVAL_MS);
}
