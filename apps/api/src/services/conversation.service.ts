import { CloseReason, Conversation, Department, EntryLink, ExternalContact, WhatsappNumber } from '@prisma/client';
import * as conversations from '../repositories/conversations';
import * as entryLinks from '../repositories/entryLinks';
import * as messages from '../repositories/messages';
import { sendConversationMessage, sendLooseText } from './messaging.service';
import { tryAssign } from './routing.service';
import { buildMenuText, buildQueueText, MSG_NO_DEPARTMENTS } from './texts';

export interface InboundContext {
  tenantId: string;
  whatsappNumber: WhatsappNumber;
  contact: ExternalContact;
  link: EntryLink;
  waNumber: string;
}

export async function persistInbound(
  conversationId: string,
  tenantId: string,
  body: string,
  messageSid: string
): Promise<void> {
  await messages.create({
    conversationId,
    direction: 'inbound',
    senderType: 'customer',
    body,
    waMessageId: messageSid || undefined,
  });
  await conversations.touchLastMessage(tenantId, conversationId);
}

// Início de conversa: lista de setores vem SEMPRE do link (nível 2 de autorização).
export async function startConversation(
  ctx: InboundContext,
  body: string,
  messageSid: string
): Promise<Conversation | null> {
  const departments = await entryLinks.listDepartmentsForLink(ctx.tenantId, ctx.link.id);

  if (departments.length === 0) {
    await sendLooseText(ctx.whatsappNumber.phoneNumber, ctx.waNumber, MSG_NO_DEPARTMENTS);
    return null;
  }

  const single = departments.length === 1;
  const conversation = await conversations.create(ctx.tenantId, {
    whatsappNumberId: ctx.whatsappNumber.id,
    externalContactId: ctx.contact.id,
    entryLinkId: ctx.link.id,
    // snapshot: link revogado/renomeado depois não reescreve o histórico
    entryLinkLabelSnapshot: ctx.link.label,
    status: single ? 'open' : 'awaiting_department',
    departmentId: single ? departments[0].id : undefined,
  });

  await persistInbound(conversation.id, ctx.tenantId, body, messageSid);

  if (single) {
    // lista com 1 setor pula o menu
    await sendConversationMessage(
      ctx.tenantId,
      conversation.id,
      ctx.whatsappNumber.phoneNumber,
      ctx.waNumber,
      buildQueueText(departments[0].name)
    );
    await tryAssign(ctx.tenantId, conversation.id);
  } else {
    await sendMenu(ctx, conversation.id, departments);
  }

  return conversation;
}

export async function sendMenu(
  ctx: InboundContext,
  conversationId: string,
  departments: Department[]
): Promise<void> {
  await sendConversationMessage(
    ctx.tenantId,
    conversationId,
    ctx.whatsappNumber.phoneNumber,
    ctx.waNumber,
    buildMenuText(departments)
  );
}

// Escolha numérica validada contra a lista DO LINK — setor fora do escopo do
// link é inválido mesmo existindo no tenant (falha de autorização, não de UX).
export function parseMenuChoice(body: string, departments: Department[]): Department | null {
  const trimmed = body.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const index = parseInt(trimmed, 10);
  if (index < 1 || index > departments.length) return null;
  return departments[index - 1];
}

export async function setDepartment(
  ctx: InboundContext,
  conversation: Conversation,
  department: Department
): Promise<void> {
  await conversations.update(ctx.tenantId, conversation.id, {
    departmentId: department.id,
    status: 'open',
  });
  await sendConversationMessage(
    ctx.tenantId,
    conversation.id,
    ctx.whatsappNumber.phoneNumber,
    ctx.waNumber,
    buildQueueText(department.name)
  );
  await tryAssign(ctx.tenantId, conversation.id);
}

// na 4ª escolha inválida, atribui ao primeiro setor da lista do link
const MAX_MENU_RETRIES = 3;

export async function handleDepartmentChoice(
  ctx: InboundContext,
  conversation: Conversation,
  body: string,
  departments: Department[]
): Promise<void> {
  if (departments.length === 0) {
    // todos os setores do link foram desativados no meio do caminho
    await sendConversationMessage(
      ctx.tenantId,
      conversation.id,
      ctx.whatsappNumber.phoneNumber,
      ctx.waNumber,
      MSG_NO_DEPARTMENTS
    );
    await closeConversation(ctx.tenantId, conversation.id, 'no_agent_available');
    return;
  }

  const choice = parseMenuChoice(body, departments);
  if (choice) {
    await setDepartment(ctx, conversation, choice);
    return;
  }

  const retries = conversation.menuRetries + 1;
  if (retries > MAX_MENU_RETRIES) {
    await setDepartment(ctx, conversation, departments[0]);
    return;
  }
  await conversations.update(ctx.tenantId, conversation.id, { menuRetries: retries });
  await sendMenu(ctx, conversation.id, departments);
}

// Encerramento cru (sem CSAT — o ciclo de vida com CSAT entra por cima disso).
export async function closeConversation(
  tenantId: string,
  conversationId: string,
  reason: CloseReason
): Promise<void> {
  await conversations.update(tenantId, conversationId, {
    status: 'closed',
    closeReason: reason,
    closedAt: new Date(),
  });
}

