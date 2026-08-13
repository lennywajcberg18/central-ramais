import { CloseReason, Conversation, Feedback } from '@prisma/client';
import * as conversations from '../repositories/conversations';
import * as departments from '../repositories/departments';
import * as entryLinks from '../repositories/entryLinks';
import * as feedbackRepo from '../repositories/feedback';
import * as tenants from '../repositories/tenants';
import { normalizeKeyword } from '../utils/text';
import {
  closeConversation,
  InboundContext,
  persistInbound,
  sendMenu,
} from './conversation.service';
import { sendConversationMessage } from './messaging.service';
import {
  buildMenuConfirmText,
  MSG_CSAT_QUESTION,
  MSG_SINGLE_DEPARTMENT_MENU,
} from './texts';

const COMMENT_WINDOW_MS = 10 * 60 * 1000;
const MSG_KEEP_GOING = 'Ok, seguimos com o atendimento.';

// Encerra e, se o tenant tiver CSAT habilitado, pergunta a nota (responder é opcional).
export async function closeWithCsat(
  tenantId: string,
  conversationId: string,
  reason: CloseReason
): Promise<void> {
  const conversation = await conversations.findByIdWithRelations(tenantId, conversationId);
  if (!conversation) return;
  if (conversation.status === 'closed' || conversation.status === 'awaiting_feedback') return;

  const tenant = await tenants.findById(tenantId);
  const askCsat = tenant?.csatEnabled === true;

  await conversations.update(tenantId, conversationId, {
    status: askCsat ? 'awaiting_feedback' : 'closed',
    closeReason: reason,
    closedAt: new Date(),
  });

  if (askCsat) {
    await sendConversationMessage(
      tenantId,
      conversationId,
      conversation.whatsappNumber.phoneNumber,
      conversation.externalContact.waNumber,
      MSG_CSAT_QUESTION
    );
  }
}

export async function closeFromAgent(tenantId: string, conversationId: string): Promise<void> {
  await closeWithCsat(tenantId, conversationId, 'agent_closed');
}

// MENU em `assigned`: confirma antes de encerrar. Sem isso, conversa esquecida
// pelo agente prende o externo.
export async function handleMenuKeyword(
  ctx: InboundContext,
  conversation: Conversation
): Promise<void> {
  const linkDepartments = await entryLinks.listDepartmentsForLink(ctx.tenantId, ctx.link.id);

  if (linkDepartments.length <= 1) {
    await sendConversationMessage(
      ctx.tenantId,
      conversation.id,
      ctx.whatsappNumber.phoneNumber,
      ctx.waNumber,
      MSG_SINGLE_DEPARTMENT_MENU
    );
    return;
  }

  const department = conversation.departmentId
    ? await departments.findById(ctx.tenantId, conversation.departmentId)
    : null;

  await conversations.update(ctx.tenantId, conversation.id, {
    status: 'awaiting_menu_confirm',
    menuRetries: 0,
  });
  await sendConversationMessage(
    ctx.tenantId,
    conversation.id,
    ctx.whatsappNumber.phoneNumber,
    ctx.waNumber,
    buildMenuConfirmText(department?.name ?? 'o setor atual')
  );
}

export async function handleMenuConfirm(
  ctx: InboundContext,
  conversation: Conversation,
  body: string
): Promise<void> {
  const keyword = normalizeKeyword(body);

  if (keyword === 'SIM') {
    await closeWithCsat(ctx.tenantId, conversation.id, 'user_switched');
    // nova conversa já no menu — sempre com os setores DO LINK
    await reopenMenu(ctx);
    return;
  }

  if (keyword === 'NAO') {
    await resumeAssigned(ctx, conversation);
    return;
  }

  // resposta inválida: repete uma vez; na segunda, assume NÃO
  if (conversation.menuRetries === 0) {
    await conversations.update(ctx.tenantId, conversation.id, { menuRetries: 1 });
    const department = conversation.departmentId
      ? await departments.findById(ctx.tenantId, conversation.departmentId)
      : null;
    await sendConversationMessage(
      ctx.tenantId,
      conversation.id,
      ctx.whatsappNumber.phoneNumber,
      ctx.waNumber,
      buildMenuConfirmText(department?.name ?? 'o setor atual')
    );
    return;
  }

  await resumeAssigned(ctx, conversation);
}

async function resumeAssigned(ctx: InboundContext, conversation: Conversation): Promise<void> {
  await conversations.update(ctx.tenantId, conversation.id, {
    status: 'assigned',
    menuRetries: 0,
  });
  // a resposta também fica visível para o agente no app
  await sendConversationMessage(
    ctx.tenantId,
    conversation.id,
    ctx.whatsappNumber.phoneNumber,
    ctx.waNumber,
    MSG_KEEP_GOING
  );
}

// Abre uma nova conversa direto no menu (pós-"SIM" do MENU).
async function reopenMenu(ctx: InboundContext): Promise<void> {
  const linkDepartments = await entryLinks.listDepartmentsForLink(ctx.tenantId, ctx.link.id);
  if (linkDepartments.length === 0) return;

  const conversation = await conversations.create(ctx.tenantId, {
    whatsappNumberId: ctx.whatsappNumber.id,
    externalContactId: ctx.contact.id,
    entryLinkId: ctx.link.id,
    entryLinkLabelSnapshot: ctx.link.label,
    status: 'awaiting_department',
  });
  await sendMenu(ctx, conversation.id, linkDepartments);
}

// Mensagem de contato com conversa em awaiting_feedback.
// true → consumida pelo ciclo de feedback; false → o chamador fecha e abre nova.
export async function handleFeedbackMessage(
  ctx: InboundContext,
  conversation: Conversation & { feedback: Feedback | null },
  body: string,
  messageSid: string
): Promise<boolean> {
  const trimmed = body.trim();

  if (!conversation.feedback) {
    if (/^(10|[0-9])$/.test(trimmed)) {
      await persistInbound(conversation.id, ctx.tenantId, body, messageSid);
      await feedbackRepo.createScore(conversation.id, parseInt(trimmed, 10));
      // mantém awaiting_feedback: comentário livre é aceito por até 10 min
      return true;
    }
    return false;
  }

  const withinWindow =
    Date.now() - conversation.feedback.createdAt.getTime() <= COMMENT_WINDOW_MS;

  if (!conversation.feedback.comment && withinWindow) {
    await persistInbound(conversation.id, ctx.tenantId, body, messageSid);
    await feedbackRepo.setComment(conversation.id, body);
    await conversations.update(ctx.tenantId, conversation.id, { status: 'closed' });
    return true;
  }

  return false;
}

// O chamador decidiu que a mensagem não era feedback: fecha o ciclo sem nota.
export async function finalizeFeedback(tenantId: string, conversationId: string): Promise<void> {
  await conversations.update(tenantId, conversationId, { status: 'closed' });
}

export { closeConversation };
