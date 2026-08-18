import { config } from './config';
import { createApp } from './app';
import { startShiftJob } from './jobs/shift';
import { startTimeoutJob } from './jobs/timeout';
import { prisma } from './prisma';

const app = createApp();

let timeoutJob: NodeJS.Timeout | undefined;
let shiftJob: NodeJS.Timeout | undefined;

const server = app.listen(config.PORT, () => {
  console.log(`[api] ouvindo em http://localhost:${config.PORT}`);
  // As duas URLs efetivas no log: quando o CORS bloqueia o front inteiro, esta
  // linha é a diferença entre uma investigação de horas e uma de trinta segundos.
  console.log(`[api] webOrigin=${config.WEB_ORIGIN} publicBaseUrl=${config.PUBLIC_BASE_URL}`);
  timeoutJob = startTimeoutJob();
  shiftJob = startShiftJob();
});

let desligando = false;

// Todo deploy no Render manda SIGTERM. Sem drenar, o processo morre no meio da
// requisição em voo — e closeWithCsat grava o encerramento ANTES de enviar a
// pergunta de nota, então morrer entre as duas linhas deixa a conversa em
// awaiting_feedback com closed_at gravado e ninguém pergunta nada: o job de
// inatividade exclui awaiting_feedback de propósito, nada reprocessa. Some junto
// o que estava na fila e ainda não rodou — o webhook já respondeu 200 ao Twilio,
// não há reentrega.
function desligar(sinal: string): void {
  if (desligando) return; // SIGINT duas vezes não pode atropelar o drain em curso
  desligando = true;
  console.log(`[api] ${sinal} recebido, drenando conexões…`);

  if (timeoutJob) clearInterval(timeoutJob);
  if (shiftJob) clearInterval(shiftJob);

  server.close(() => {
    // Devolver as conexões do pool importa: no Postgres free do Render, segurá-las
    // até o timeout do servidor pode impedir a instância nova de conectar.
    void prisma.$disconnect().finally(() => process.exit(0));
  });

  // Teto próprio, abaixo dos ~30 s que o Render espera antes do SIGKILL: uma
  // conexão pendurada não pode transformar drain em processo zumbi.
  setTimeout(() => {
    console.error('[api] drain não terminou em 20s, saindo à força');
    process.exit(1);
  }, 20_000).unref();
}

process.on('SIGTERM', () => desligar('SIGTERM'));
process.on('SIGINT', () => desligar('SIGINT'));

// O Express 4 não captura rejeição de handler async, e no Node 22 isso derruba o
// processo sem dizer de onde veio. Logar aqui é o que dá um rastro para o próximo
// plantão em vez de um reinício silencioso.
process.on('unhandledRejection', (err) => {
  console.error('[api] promise rejeitada sem catch:', err);
});
