import { expireDueShifts } from '../services/shift.service';

const INTERVAL_MS = 60 * 1000;

let running = false;

// Fim de plantão não pode depender de a pessoa lembrar de clicar em sair.
async function run(): Promise<void> {
  if (running) return; // não sobrepõe execuções
  running = true;
  try {
    const encerrados = await expireDueShifts();
    if (encerrados > 0) {
      console.log(`[shift-job] ${encerrados} plantão(ões) encerrado(s) por horário`);
    }
  } catch (err) {
    console.error('[shift-job] falha na varredura:', err);
  } finally {
    running = false;
  }
}

export function startShiftJob(): NodeJS.Timeout {
  return setInterval(run, INTERVAL_MS);
}
