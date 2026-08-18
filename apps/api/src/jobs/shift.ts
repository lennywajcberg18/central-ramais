import { expireDueShifts } from '../services/shift.service';

const INTERVAL_MS = 60 * 1000;

// Fim de plantão não pode depender de a pessoa lembrar de clicar em sair.
//
// Como no job de inatividade, a trava `running` em memória saiu: o que impede
// duas varreduras de encerrarem o mesmo plantão é o `endsAt <= at` no WHERE do
// `closeExpiredSession`, checado pelo `count`. É o cenário 10 do `check-corridas`.
export async function varrerPlantoesVencidos(): Promise<number> {
  const encerrados = await expireDueShifts();
  if (encerrados > 0) {
    console.log(`[shift-job] ${encerrados} plantão(ões) encerrado(s) por horário`);
  }
  return encerrados;
}

// Só para `npm run dev`. Em produção quem chama é o cron, por HTTP.
export function startShiftJob(): NodeJS.Timeout {
  return setInterval(() => {
    varrerPlantoesVencidos().catch((err) =>
      console.error('[shift-job] falha na varredura:', err)
    );
  }, INTERVAL_MS);
}
