// Entrada da Vercel. O `apps/api/vercel.json` reescreve TODA rota para cá, então
// esta única função recebe o webhook do Twilio, o painel e as varreduras do cron —
// e o roteamento continua sendo do Express, como em qualquer outro ambiente.
//
// Nada de `listen()`: quem escuta a porta é a plataforma. O `src/index.ts`
// continua existindo para `npm run dev` e é lá que ficam os `setInterval`, que
// aqui não teriam onde viver — função serverless não sobrevive entre requisições.
import { createApp } from '../src/app';

export default createApp();
