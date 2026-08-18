import { SenderType } from '@prisma/client';
import { getProviderFor } from '../providers';
import * as conversations from '../repositories/conversations';
import * as externalContacts from '../repositories/externalContacts';
import * as messages from '../repositories/messages';

// A decisão de enviar de verdade ou não fica AQUI, e não em quem chama.
//
// São dezoito pontos de envio espalhados por seis services e uma rota. Uma trava
// que dependesse de cada um deles lembrar de passar um parâmetro estaria quebrada
// no primeiro esquecimento — e o sintoma seria um estranho recebendo mensagem de
// um hospital, que não é o tipo de bug que se descobre por log.
//
// O `to` já chega em todos eles, então o contato é o que se consulta. O `tenantId`
// entra junto porque o mesmo número pode existir em dois hospitais: um simulado,
// outro real.
async function ehContatoSimulado(tenantId: string, to: string): Promise<boolean> {
  return externalContacts.ehSimulado(tenantId, to);
}

// Mensagem fora de conversa (recusas de acesso): envia sem persistir em messages,
// porque messages exige conversation_id. A recusa fica registrada em access_attempts.
export async function sendLooseText(
  tenantId: string,
  fromNumber: string,
  to: string,
  body: string
): Promise<void> {
  const simulado = await ehContatoSimulado(tenantId, to);
  await getProviderFor(fromNumber, simulado).sendText(to, body);
}

// Mensagem dentro de conversa: envia, persiste e atualiza last_message_at.
//
// Persiste mesmo quando é simulada, de propósito: a regra do produto é que toda
// mensagem vá para `messages`, e é isso que faz a linha do tempo do simulador e a
// tela do atendente mostrarem a conversa inteira. O que muda é só a entrega.
export async function sendConversationMessage(
  tenantId: string,
  conversationId: string,
  fromNumber: string,
  to: string,
  body: string,
  senderType: SenderType = 'system'
): Promise<void> {
  const simulado = await ehContatoSimulado(tenantId, to);
  const { providerMessageId } = await getProviderFor(fromNumber, simulado).sendText(to, body);
  await messages.create({
    conversationId,
    direction: 'outbound',
    senderType,
    body,
    waMessageId: providerMessageId,
  });
  await conversations.touchLastMessage(tenantId, conversationId);
}
