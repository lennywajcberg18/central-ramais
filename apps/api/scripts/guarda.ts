import { config } from '../src/config';

// Os checks de concorrência criam contatos com números brasileiros INVENTADOS e
// conduzem conversas até o fim — inclusive o encerramento, que dispara a pergunta
// de satisfação. Com o provider `mock` isso não sai da máquina.
//
// Com a Twilio ligada, sairia: alguém que nunca ouviu falar deste projeto
// receberia mensagem de um hospital, e o número inventado pode muito bem existir.
// Some a isso que estes scripts apagam e recriam dados para montar cada cenário —
// não é coisa que se roda contra um sistema com gente usando.
//
// A recusa é no arranque de propósito. Descobrir isso pelo relatório da Twilio,
// depois, é tarde.
export function recusarSeEnvioForReal(nomeDoScript: string): void {
  if (config.WHATSAPP_PROVIDER !== 'mock') {
    console.error(
      `\n[${nomeDoScript}] recusado: WHATSAPP_PROVIDER=${config.WHATSAPP_PROVIDER}.\n` +
        `  Este script inventa números e encerra conversas — com o provider real,\n` +
        `  isso vira WhatsApp de verdade para desconhecidos.\n` +
        `  Rode contra um banco de desenvolvimento, com WHATSAPP_PROVIDER=mock.\n`
    );
    process.exit(1);
  }
}
