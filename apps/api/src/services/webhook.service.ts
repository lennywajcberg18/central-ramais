import { Conversation } from '@prisma/client';
import * as conversationsRepo from '../repositories/conversations';
import * as entryLinks from '../repositories/entryLinks';
import * as externalContacts from '../repositories/externalContacts';
import * as messages from '../repositories/messages';
import * as whatsappNumbers from '../repositories/whatsappNumbers';
import { mascararNumero, normalizeWaNumber } from '../utils/phone';
import { resolveAccess } from './access.service';
import {
  closeConversation,
  handleDepartmentChoice,
  InboundContext,
  persistInbound,
  startConversation,
} from './conversation.service';
import {
  handleFeedbackMessage,
  handleMenuConfirm,
  handleMenuKeyword,
  finalizeFeedback,
} from './lifecycle.service';
import { sendConversationMessage, sendLooseText } from './messaging.service';
import { normalizeKeyword } from '../utils/text';
import { runSerialized } from '../utils/keyedQueue';
import { markSeen, wasSeen } from '../utils/seenMessageIds';
import {
  MSG_ACCESS_REVOKED,
  MSG_ATTACHMENT_BODY,
  MSG_NOT_IDENTIFIED,
  MSG_ONLY_TEXT,
} from './texts';

export interface InboundMessage {
  from: string;
  to: string;
  body: string;
  messageSid: string;
  // NumMedia do Twilio: >0 quando veio foto, áudio ou documento junto
  numMedia?: number;
}

export async function handleInbound(msg: InboundMessage): Promise<void> {
  const waNumber = normalizeWaNumber(msg.from);
  const toNumber = normalizeWaNumber(msg.to);

  // Fora do E.164 não é número: descartar antes de tocar o banco evita poluir
  // `access_attempts` com string arbitrária e criar contato de número '+'.
  if (!waNumber || !toNumber) {
    console.warn(
      `[webhook] número fora do padrão E.164, mensagem descartada: ` +
        `from=${mascararNumero(msg.from)} to=${mascararNumero(msg.to)}`
    );
    return;
  }

  // Uma fila por contato (par destino+origem). O Twilio entrega em paralelo e
  // o fluxo abaixo lê o estado antes de escrever: sem serializar, duas
  // mensagens do mesmo contato abrem duas conversas.
  return runSerialized(`${toNumber}|${waNumber}`, () =>
    processInbound(msg, toNumber, waNumber)
  );
}

async function processInbound(
  msg: InboundMessage,
  toNumber: string,
  waNumber: string
): Promise<void> {
  // Dedupe em memória: cobre os caminhos que não gravam em `messages` (recusa,
  // bloqueio, revogação), onde a reentrega do Twilio infla `access_attempts`.
  if (msg.messageSid && wasSeen(msg.messageSid)) return;

  await dispatchInbound(msg, toNumber, waNumber);

  // Só marca depois de processar sem erro: falha no meio deixa a reentrega do
  // Twilio ser a segunda chance, que é para isso que ela existe.
  if (msg.messageSid) markSeen(msg.messageSid);
}

async function dispatchInbound(
  msg: InboundMessage,
  toNumber: string,
  waNumber: string
): Promise<void> {
  // Webhook não tem sessão: o tenant é resolvido pelo To. Não resolveu → nada.
  const whatsappNumber = await whatsappNumbers.findActiveByPhoneNumber(toNumber);
  if (!whatsappNumber) {
    console.warn(`[webhook] número destino desconhecido: ${mascararNumero(toNumber)}`);
    return;
  }
  const tenantId = whatsappNumber.tenantId;

  // Dedupe no banco: sobrevive a restart e é a fonte de verdade para tudo que
  // virou mensagem. Duplicata é ignorada em silêncio.
  if (msg.messageSid && (await messages.existsByWaMessageId(msg.messageSid))) {
    return;
  }

  const access = await resolveAccess(tenantId, waNumber, msg.body);

  if (access.outcome === 'blocked') {
    // Silêncio total: responder confirmaria que o número está cadastrado.
    return;
  }

  if (access.outcome === 'denied') {
    await sendLooseText(whatsappNumber.phoneNumber, waNumber, MSG_NOT_IDENTIFIED);
    return;
  }

  if (access.outcome === 'revoked') {
    const active = await conversationsRepo.findActiveByContact(tenantId, access.contact.id);
    if (active) {
      await closeConversation(tenantId, active.id, 'access_revoked');
    }
    await sendLooseText(whatsappNumber.phoneNumber, waNumber, MSG_ACCESS_REVOKED);
    return;
  }

  const { contact, link } = access;
  await externalContacts.touchLastSeen(tenantId, contact.id);

  const ctx: InboundContext = { tenantId, whatsappNumber, contact, link, waNumber };

  // Anexo sem legenda chega com Body vazio: sem um corpo legível o atendente vê
  // bolha em branco e acha que não veio nada.
  const temMidia = (msg.numMedia ?? 0) > 0;
  const semLegenda = temMidia && msg.body.trim() === '';
  const corpo = semLegenda ? MSG_ATTACHMENT_BODY : msg.body;

  const active = await conversationsRepo.findActiveByContact(tenantId, contact.id);
  if (active) {
    await persistInbound(active.id, tenantId, corpo, msg.messageSid);
    if (temMidia) await avisarSomenteTexto(ctx, active.id);
    // Anexo sem legenda não é resposta: passá-lo pelo fluxo contaria como escolha
    // inválida do menu e, na quarta, jogaria a pessoa no primeiro setor do link.
    if (!semLegenda) await handleActiveConversation(ctx, active, corpo);
    return;
  }

  // conversa encerrada aguardando nota: nota/comentário são consumidos aqui;
  // qualquer outra mensagem fecha sem nota e abre conversa nova
  const awaitingFeedback = await conversationsRepo.findLatestAwaitingFeedback(
    tenantId,
    contact.id
  );
  if (awaitingFeedback) {
    const consumed = await handleFeedbackMessage(ctx, awaitingFeedback, corpo, msg.messageSid);
    if (consumed) return;
    await finalizeFeedback(tenantId, awaitingFeedback.id);
  }

  const nova = await startConversation(ctx, corpo, msg.messageSid);

  // O admin pode bloquear o contato entre o `resolveAccess` e a criação da
  // conversa: o PATCH já procurou conversa ativa, não achou nenhuma, e ninguém
  // mais encerraria esta — ela ficaria na fila do setor para sempre, porque o
  // job de inatividade não varre `open` e nenhuma mensagem futura desse número é
  // processada. A releitura fecha a janela: se o bloqueio venceu a corrida, ele
  // necessariamente aconteceu antes desta consulta.
  if (nova) {
    const atual = await externalContacts.findById(tenantId, contact.id);
    if (atual?.blocked) {
      await closeConversation(tenantId, nova.id, 'access_revoked');
      return;
    }
    // depois da recontagem do bloqueio: contato bloqueado é silêncio total
    if (temMidia) await avisarSomenteTexto(ctx, nova.id);
  }
}

// O anexo em si fica no Twilio: baixar, guardar e exibir é outra versão (imagem
// de exame é dado de saúde). Aqui o produto ao menos diz que não leu.
async function avisarSomenteTexto(ctx: InboundContext, conversationId: string): Promise<void> {
  await sendConversationMessage(
    ctx.tenantId,
    conversationId,
    ctx.whatsappNumber.phoneNumber,
    ctx.waNumber,
    MSG_ONLY_TEXT
  );
}

async function handleActiveConversation(
  ctx: InboundContext,
  conversation: Conversation,
  body: string
): Promise<void> {
  switch (conversation.status) {
    case 'awaiting_department': {
      const departments = await entryLinks.listDepartmentsForLink(ctx.tenantId, ctx.link.id);
      await handleDepartmentChoice(ctx, conversation, body, departments);
      return;
    }
    case 'assigned':
      if (normalizeKeyword(body) === 'MENU') {
        await handleMenuKeyword(ctx, conversation);
      }
      // mensagem normal dentro do atendimento — o agente vê pelo app
      return;
    case 'awaiting_menu_confirm':
      await handleMenuConfirm(ctx, conversation, body);
      return;
    case 'open':
      // na fila, sem agente — mensagem fica registrada para quando assumirem
      return;
    default:
      return;
  }
}
