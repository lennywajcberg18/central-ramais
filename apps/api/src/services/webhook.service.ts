import { Conversation } from '@prisma/client';
import * as conversationsRepo from '../repositories/conversations';
import * as entryLinks from '../repositories/entryLinks';
import * as externalContacts from '../repositories/externalContacts';
import * as messages from '../repositories/messages';
import * as whatsappNumbers from '../repositories/whatsappNumbers';
import { normalizeWaNumber } from '../utils/phone';
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
import { sendLooseText } from './messaging.service';
import { normalizeKeyword } from '../utils/text';
import { runSerialized } from '../utils/keyedQueue';
import { markSeen, wasSeen } from '../utils/seenMessageIds';
import { MSG_ACCESS_REVOKED, MSG_NOT_IDENTIFIED } from './texts';

export interface InboundMessage {
  from: string;
  to: string;
  body: string;
  messageSid: string;
}

export async function handleInbound(msg: InboundMessage): Promise<void> {
  const waNumber = normalizeWaNumber(msg.from);
  const toNumber = normalizeWaNumber(msg.to);

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
    console.warn(`[webhook] número destino desconhecido: ${toNumber}`);
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

  const active = await conversationsRepo.findActiveByContact(tenantId, contact.id);
  if (active) {
    await persistInbound(active.id, tenantId, msg.body, msg.messageSid);
    await handleActiveConversation(ctx, active, msg.body);
    return;
  }

  // conversa encerrada aguardando nota: nota/comentário são consumidos aqui;
  // qualquer outra mensagem fecha sem nota e abre conversa nova
  const awaitingFeedback = await conversationsRepo.findLatestAwaitingFeedback(
    tenantId,
    contact.id
  );
  if (awaitingFeedback) {
    const consumed = await handleFeedbackMessage(ctx, awaitingFeedback, msg.body, msg.messageSid);
    if (consumed) return;
    await finalizeFeedback(tenantId, awaitingFeedback.id);
  }

  await startConversation(ctx, msg.body, msg.messageSid);
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
