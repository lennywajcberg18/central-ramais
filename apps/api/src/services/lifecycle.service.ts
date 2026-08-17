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
// true → o encerramento foi gravado por esta chamada; false → a conversa já estava
// encerrada ou mudou de estado embaixo (o count do closeIfUnchanged voltou zero).
export async function closeWithCsat(
  tenantId: string,
  conversationId: string,
  reason: CloseReason
): Promise<boolean> {
  const conversation = await conversations.findByIdWithRelations(tenantId, conversationId);
  if (!conversation) return false;
  if (conversation.status === 'closed' || conversation.status === 'awaiting_feedback') return false;

  const tenant = await tenants.findById(tenantId);

  // Sem `firstReplyAt` ninguém do hospital respondeu: a conversa morreu no menu e
  // foi o job de inatividade que encerrou. Perguntar "como foi o atendimento?" aí
  // é gastar mensagem paga por um atendimento que não existiu e, pior, deixar a
  // nota de uma conversa abandonada pesar igual na média do hospital.
  const houveAtendimento = conversation.firstReplyAt !== null;
  const askCsat = tenant?.csatEnabled === true && houveAtendimento;

  // O `if` de status lá em cima é atalho barato, não garantia: quem garante é o
  // count. Três caminhos encerram a mesma conversa (job de inatividade, botão do
  // atendente, "SIM" no MENU) e nenhum passa pela fila dos outros. Sem o estado lido no
  // WHERE, os dois passavam pelo mesmo `if` e os dois gravavam — o externo
  // recebia a pergunta de nota duas vezes e o `closeReason` virava sorteio.
  // O setor e o dono também entram: se a conversa foi encaminhada nesse meio
  // tempo, encerrá-la a mataria dentro do setor que acabou de recebê-la.
  const encerrada = await conversations.closeIfUnchanged(
    tenantId,
    conversationId,
    {
      status: conversation.status,
      departmentId: conversation.departmentId,
      assignedUserId: conversation.assignedUserId,
    },
    askCsat ? 'awaiting_feedback' : 'closed',
    reason
  );
  if (encerrada.count === 0) return false;

  if (askCsat) {
    await sendConversationMessage(
      tenantId,
      conversationId,
      conversation.whatsappNumber.phoneNumber,
      conversation.externalContact.waNumber,
      MSG_CSAT_QUESTION
    );
  }

  return true;
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

  // Guarda de estado em toda transição do fluxo do externo: o job de inatividade
  // não passa pela fila do contato e pode ter encerrado a conversa entre a
  // leitura e esta linha. Sem a guarda, a pergunta seria feita numa conversa
  // morta — e o "SIM" da pessoa cairia no vazio.
  const perguntou = await conversations.moveStatus(ctx.tenantId, conversation.id, 'assigned', {
    status: 'awaiting_menu_confirm',
    menuRetries: 0,
  });
  if (perguntou.count === 0) return;

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
    const encerrou = await closeWithCsat(ctx.tenantId, conversation.id, 'user_switched');
    // Abrir a nova sem conferir o encerramento deixa DUAS conversas ativas para o
    // mesmo contato: se o dono encerrou o plantão neste instante, a antiga voltou
    // para `open` e o closeIfUnchanged não pegou nada — ela ficaria na fila do
    // ramal para sempre (o job de inatividade não varre `open`) enquanto o externo
    // conversa na nova. Não valeu o encerramento → não abre nada; a próxima
    // mensagem dela entra pelo fluxo normal.
    if (!encerrou) return;
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
    const repetiu = await conversations.moveStatus(
      ctx.tenantId,
      conversation.id,
      'awaiting_menu_confirm',
      { menuRetries: 1 }
    );
    if (repetiu.count === 0) return;

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
  const voltou = await conversations.moveStatus(
    ctx.tenantId,
    conversation.id,
    'awaiting_menu_confirm',
    { status: 'assigned', menuRetries: 0 }
  );
  // encerrada pelo job enquanto a pessoa respondia: não ressuscita
  if (voltou.count === 0) return;

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
    const score = parseScore(trimmed);
    if (score !== null) {
      await persistInbound(conversation.id, ctx.tenantId, body, messageSid);
      await feedbackRepo.createScore(conversation.id, score);
      // mantém awaiting_feedback: comentário livre é aceito por até 10 min
      return true;
    }
    return false;
  }

  const withinWindow =
    Date.now() - conversation.feedback.createdAt.getTime() <= COMMENT_WINDOW_MS;

  if (!conversation.feedback.comment && withinWindow) {
    await persistInbound(conversation.id, ctx.tenantId, body, messageSid);

    // Um número solto logo depois da nota é alguém se corrigindo, não um
    // comentário: gravar "2" como texto faz o gestor ler "nota 9, comentário 2".
    // A correção do score em si depende de um `updateScore` no repositório de
    // feedback, que ainda não existe — até lá a mensagem fica só no histórico e a
    // janela segue aberta para um comentário de verdade.
    if (parseScore(trimmed) !== null) return true;

    await feedbackRepo.setComment(conversation.id, body);
    await conversations.moveStatus(ctx.tenantId, conversation.id, 'awaiting_feedback', {
      status: 'closed',
    });
    return true;
  }

  return false;
}

// Faixa numérica em vez de regex de um dígito: quem responde "07" quis dar 7, e
// recusar não é neutro — o chamador fecha sem nota e abre conversa NOVA, jogando
// a pessoa na fila de um ramal. Só dígitos (nada de "0x0a", "1e1" ou vazio, que o
// Number() aceitaria) e no máximo dois, então "11", "-1" e "5.5" seguem fora.
function parseScore(trimmed: string): number | null {
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const score = parseInt(trimmed, 10);
  return score <= 10 ? score : null;
}

// O chamador decidiu que a mensagem não era feedback: fecha o ciclo sem nota.
export async function finalizeFeedback(tenantId: string, conversationId: string): Promise<void> {
  await conversations.moveStatus(tenantId, conversationId, 'awaiting_feedback', {
    status: 'closed',
  });
}

export { closeConversation };
