import { CloseReason, Conversation, Feedback } from '@prisma/client';
import * as adminConversations from '../repositories/adminConversations';
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
import { tryAssign } from './routing.service';
import {
  buildMenuConfirmText,
  buildQueueText,
  MSG_CSAT_QUESTION,
  MSG_SINGLE_DEPARTMENT_MENU,
} from './texts';

const COMMENT_WINDOW_MS = 10 * 60 * 1000;
const MSG_KEEP_GOING = 'Ok, seguimos com o atendimento.';
const MSG_SCORE_UPDATED = 'Sua nota foi atualizada. Obrigado!';

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

  // Pergunta-se a nota quando a conversa CHEGOU a alguém do hospital
  // (`firstAssignedAt`) ou quando foi gente que a encerrou — o atendente pelo
  // botão, o externo pelo MENU+SIM. `firstReplyAt` media outra coisa, "alguém
  // DIGITOU", e por isso engolia o atendimento resolvido fora do WhatsApp: o
  // atendente assume da fila, resolve por telefone e clica em encerrar sem
  // escrever nada — a tela dele promete a pesquisa em dois lugares que não
  // aconteciam.
  // Fica de fora só o caso que motivou a regra: a conversa que morreu no menu,
  // sem nunca chegar a ninguém, e que o job de inatividade encerrou. Pesquisa aí
  // é mensagem paga por um atendimento que não existiu e uma nota de conversa
  // abandonada pesando igual na média do hospital.
  const chegouAAlguem = conversation.firstAssignedAt !== null;
  const encerradaPorGente = reason === 'agent_closed' || reason === 'user_switched';
  const askCsat = tenant?.csatEnabled === true && (chegouAAlguem || encerradaPorGente);

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

// Devolve o mesmo booleano do `closeWithCsat`, e a rota precisa dele: descartado,
// encerrar uma conversa que outro caminho acabou de encaminhar (ou que já estava
// em `awaiting_feedback`) respondia 200 {ok:true} e o atendente fechava a tela
// achando que tinha encerrado — enquanto a conversa seguia viva no setor novo.
export async function closeFromAgent(tenantId: string, conversationId: string): Promise<boolean> {
  return closeWithCsat(tenantId, conversationId, 'agent_closed');
}

// Teto da varredura de conversas vivas. Vivas são poucas por natureza — uma por
// contato, e o job de inatividade fecha as paradas há 30 min —, mas a fila
// (`open`) não é varrida pelo job, então o teto existe para a consulta não virar
// tabela inteira num hospital com fila represada.
const MAX_CONVERSAS_VIVAS = 1000;

// O segundo nível de autorização do CLAUDE.md — "toda vez que o sistema mostra ou
// aceita um setor para um externo, a lista vem do link dele" — vale também para a
// conversa que JÁ está rodando, não só para o menu e para o encaminhamento.
//
// Sem isto, reatribuir o contato a outro link pelo painel deixava o externo
// conversando dentro de um setor que o link vigente dele não permite, o atendente
// daquele setor continuava respondendo, e a cada fim de plantão o rodízio
// devolvia a conversa para a fila do mesmo setor proibido.
//
// Encerra sem CSAT, pelo mesmo critério da revogação de link e do bloqueio de
// contato: o acesso àquele setor foi cortado. A próxima mensagem da pessoa abre
// conversa nova já pelo menu do link vigente, que é a única lista que autoriza.
export async function closeActiveOutsideLinkScope(
  tenantId: string,
  externalContactId: string,
  entryLinkId: string
): Promise<boolean> {
  const ativa = await conversations.findActiveByContact(tenantId, externalContactId);
  // Sem setor definido a conversa ainda está no menu, e a escolha seguinte já é
  // validada contra a lista do link.
  if (!ativa || ativa.departmentId === null) return false;

  const permitidos = await entryLinks.listDepartmentsForLink(tenantId, entryLinkId);
  if (permitidos.some((d) => d.id === ativa.departmentId)) return false;

  await closeConversation(tenantId, ativa.id, 'access_revoked');
  return true;
}

// Mesma invariante, pela outra porta: setor desativado sai do menu de TODOS os
// links (`listDepartmentsForLink` filtra `department.active`), então toda conversa
// viva nele passou a rodar fora do link de quem está do outro lado. O PROJETO.md
// promete que o setor desativado "some do menu automaticamente" — some do menu e
// do atendimento em curso também, senão a promessa vale só para quem ainda não
// tinha escrito.
export async function closeActiveInDepartment(
  tenantId: string,
  departmentId: string
): Promise<number> {
  const vivas = await adminConversations.list(tenantId, {
    status: conversations.ACTIVE_STATUSES,
    limit: MAX_CONVERSAS_VIVAS,
  });

  let encerradas = 0;
  for (const viva of vivas) {
    if (viva.departmentId !== departmentId) continue;
    await closeConversation(tenantId, viva.id, 'access_revoked');
    encerradas++;
  }
  return encerradas;
}

// MENU em `assigned`: confirma antes de encerrar. Sem isso, conversa esquecida
// pelo agente prende o externo.
export async function handleMenuKeyword(
  ctx: InboundContext,
  conversation: Conversation
): Promise<void> {
  const linkDepartments = await entryLinks.listDepartmentsForLink(ctx.tenantId, ctx.link.id);

  // O TAMANHO da lista sozinho não diz que a pessoa está no lugar certo. Com a
  // conversa parada num setor que o link vigente já não permite — reatribuição em
  // corrida com uma mensagem em voo —, "você já está falando com ele" é mentira e
  // fecha a única saída que o externo tem: sobrariam os 30 min do job de
  // inatividade. Setor atual fora do link → o MENU oferece a troca mesmo havendo
  // um setor só na lista.
  const atualPermitido = linkDepartments.some((d) => d.id === conversation.departmentId);

  if (linkDepartments.length <= 1 && atualPermitido) {
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

  // Link de um setor só pula o menu, igual à primeira mensagem ("Lista com 1
  // setor → pula o menu, entra direto"). Esse caminho passou a ser alcançável
  // quando o setor atual está fora do link: mandar um menu de uma opção só
  // obrigaria a pessoa a digitar "1" para voltar ao único lugar onde ela pode
  // estar — fricção que a entrada normal não tem.
  const unico = linkDepartments.length === 1 ? linkDepartments[0] : null;

  const { conversation, criada } = await conversations.createOrGetActive(ctx.tenantId, {
    whatsappNumberId: ctx.whatsappNumber.id,
    externalContactId: ctx.contact.id,
    entryLinkId: ctx.link.id,
    entryLinkLabelSnapshot: ctx.link.label,
    status: unico ? 'open' : 'awaiting_department',
    departmentId: unico?.id,
  });
  // Perdemos a corrida da abertura: a conversa que voltou é a que outro processo
  // criou, e ele já mandou o menu (ou o "você será atendido por X") e já chamou o
  // rodízio. Repetir daqui manda tudo duas vezes.
  if (!criada) return;

  if (unico) {
    await sendConversationMessage(
      ctx.tenantId,
      conversation.id,
      ctx.whatsappNumber.phoneNumber,
      ctx.waNumber,
      buildQueueText(unico.name)
    );
    await tryAssign(ctx.tenantId, conversation.id);
    return;
  }

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
    // A nota nova substitui a anterior e a janela segue aberta para um comentário
    // de verdade. A confirmação não é enfeite: sem ela a mensagem caía num buraco
    // — ficava no histórico, não corrigia a nota, não fechava o ciclo e não
    // recebia resposta nenhuma, porque o `return true` diz ao webhook que ela foi
    // consumida pelo ciclo de feedback.
    const novaNota = parseScore(trimmed);
    if (novaNota !== null) {
      await feedbackRepo.updateScore(conversation.id, novaNota);
      await sendConversationMessage(
        ctx.tenantId,
        conversation.id,
        ctx.whatsappNumber.phoneNumber,
        ctx.waNumber,
        MSG_SCORE_UPDATED
      );
      return true;
    }

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
