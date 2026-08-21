import { CloseReason, Conversation, ConversationStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma';

// Estados que bloqueiam abrir outra conversa (awaiting_feedback NÃO bloqueia)
export const ACTIVE_STATUSES: ConversationStatus[] = [
  'awaiting_department',
  'open',
  'assigned',
  'awaiting_menu_confirm',
];

export function findActiveByContact(tenantId: string, externalContactId: string) {
  return prisma.conversation.findFirst({
    where: { tenantId, externalContactId, status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: 'desc' },
  });
}

export function findLatestAwaitingFeedback(tenantId: string, externalContactId: string) {
  return prisma.conversation.findFirst({
    where: { tenantId, externalContactId, status: 'awaiting_feedback' },
    orderBy: { closedAt: 'desc' },
    include: { feedback: true },
  });
}

export interface CreateConversationInput {
  whatsappNumberId: string;
  externalContactId: string;
  entryLinkId: string;
  entryLinkLabelSnapshot: string;
  status: ConversationStatus;
  departmentId?: string;
}

export interface CreateConversationResult {
  conversation: Conversation;
  // false = perdemos a corrida e esta é a conversa que o outro processo criou.
  // Quem chamou PRECISA olhar: o índice único impede a segunda LINHA, não a
  // segunda MENSAGEM. Seguir o fluxo de abertura em cima da conversa alheia
  // manda o menu (ou o "você será atendido por X") pela segunda vez e chama o
  // rodízio de novo — que é exatamente o que o índice existe para evitar.
  criada: boolean;
}

// "Uma conversa aberta por contato" agora é do banco, não da memória: o índice
// único parcial `conversations_uma_ativa_por_contato` cobre os ACTIVE_STATUSES.
// O keyedQueue serializa dentro de um processo só — com dois (janela de deploy,
// instância velha drenando), as duas mensagens seguidas do mesmo número leem
// "não há conversa ativa" e as duas criam.
// Perder essa corrida não é erro: quem chegou depois recebe a conversa que o
// primeiro criou, sem linha órfã, e trata a mensagem como o que ela é — uma
// inbound numa conversa viva, não uma abertura.
export async function createOrGetActive(
  tenantId: string,
  input: CreateConversationInput
): Promise<CreateConversationResult> {
  try {
    const conversation = await prisma.conversation.create({
      data: { tenantId, ...input },
    });
    return { conversation, criada: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const jaAberta = await findActiveByContact(tenantId, input.externalContactId);
      // Sem conversa ativa o P2002 veio de outra constraint — não é esta corrida.
      if (jaAberta) return { conversation: jaAberta, criada: false };
    }
    throw err;
  }
}

// Forma antiga, que joga fora o `criada`. Só o `reopenMenu` do lifecycle ainda
// usa — e por isso ele continua mandando um segundo menu quando perde a corrida.
// Migrar aquele caminho para `createOrGetActive` apaga esta função.
export async function create(tenantId: string, input: CreateConversationInput) {
  return (await createOrGetActive(tenantId, input)).conversation;
}

export function findById(
  tenantId: string,
  id: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.conversation.findFirst({ where: { id, tenantId } });
}

// updateMany com tenantId + checagem de count no chamador: zero → 404
export function update(tenantId: string, id: string, data: Prisma.ConversationUncheckedUpdateManyInput) {
  return prisma.conversation.updateMany({ where: { id, tenantId }, data });
}

export function touchLastMessage(tenantId: string, id: string) {
  return update(tenantId, id, { lastMessageAt: new Date() });
}

export function closeFields(reason: CloseReason, status: ConversationStatus) {
  return { status, closeReason: reason, closedAt: new Date() };
}

// Conversa presa num atendente que saiu (desativado ou fim de plantão) some das
// duas listas do app — a fila do setor e "as minhas" — e o externo espera para
// sempre. Quem sai devolve o que estava com ele para a fila do ramal.
// `assignedAt` volta a nulo porque ele diz quem está com a conversa AGORA — o
// tempo de espera do externo fica guardado em `firstAssignedAt`, que é write-once.
export function releaseFromUser(
  tenantId: string,
  userId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.conversation.updateMany({
    where: { tenantId, assignedUserId: userId, status: { in: ACTIVE_STATUSES } },
    data: { status: 'open', assignedUserId: null, assignedAt: null },
  });
}

// Troca de setor com guarda: entre ler a conversa e escrever, ela pode ter sido
// encerrada por inatividade OU encaminhada por outro atendente. Status e setor de
// ORIGEM entram no WHERE e o chamador confere o count. Sem a origem, dois
// encaminhamentos simultâneos passam os dois e o externo recebe dois avisos
// contraditórios ("encaminhado para Enfermagem" / "…para Recepção").
export function transferDepartment(
  tenantId: string,
  id: string,
  departmentId: string,
  fromDepartmentId: string | null
) {
  return prisma.conversation.updateMany({
    where: { tenantId, id, status: { in: ['open', 'assigned'] }, departmentId: fromDepartmentId },
    data: {
      departmentId,
      status: 'open',
      assignedUserId: null,
      assignedAt: null,
      menuRetries: 0,
    },
  });
}

// Atribuição com guarda: a conversa continua na fila e sem dono no instante do
// UPDATE. Dois caminhos podem atribuir a mesma conversa ao mesmo tempo — o
// rodízio e o atendente que responde direto da fila pela tela.
export function assignTo(tenantId: string, id: string, userId: string, at: Date) {
  return prisma.conversation.updateMany({
    where: { tenantId, id, status: 'open', assignedUserId: null },
    data: { status: 'assigned', assignedUserId: userId, assignedAt: at },
  });
}

// A mesma guarda, mais a outra ponta da corrida: quem o rodízio escolheu ainda
// está de plantão, disponível E neste setor NO INSTANTE do UPDATE.
//
// Ler os elegíveis e gravar em consultas separadas entrega a conversa a quem
// encerrou o plantão no meio do caminho — e aí ela some das duas listas, porque
// quem saiu não a enxerga mais e a fila do setor só mostra `open`. O EXISTS
// repete condição por condição o WHERE de `users.availableAgentsForDepartment`,
// inclusive `role` e a pertinência ao setor: quem sai do ramal enquanto o rodízio
// escolhe não pode receber a conversa dele, e isso é falha de autorização, não
// detalhe — o admin salvando só os setores de alguém não escreve na linha de
// `users` e por isso nem o `FOR UPDATE` abaixo o segura. SQL cru porque
// `updateMany` do Prisma não filtra por relação de forma atômica.
//
// `user_departments` não tem coluna de tenant: ela entra pelo `u.tenant_id` do
// JOIN, que é o que amarra o vínculo ao hospital certo.
export async function assignToIfOnShift(
  tenantId: string,
  id: string,
  userId: string,
  departmentId: string,
  at: Date
): Promise<{ count: number }> {
  // A transação existe para disputar a LINHA DO ATENDENTE com quem está saindo de
  // plantão. Sem ela, o `EXISTS` abaixo lia a sessão ainda aberta enquanto o
  // `endShift` do próprio atendente já rodava — os dois passavam, e a conversa
  // ficava com alguém sem plantão: fora da fila do setor (que só mostra `open`) e
  // fora da tela dele (que perdeu o acesso). Trinta minutos até o job de
  // inatividade encerrar, com a pessoa do lado de fora falando sozinha.
  //
  // O `FOR UPDATE` casa com o `UPDATE users` que o `endShift` faz na mesma
  // transação dele. Quem chega primeiro ganha: se for a atribuição, o release do
  // `endShift` varre a conversa de volta para a fila logo em seguida; se for a
  // saída, este SELECT espera, relê a linha já `offline` e o `EXISTS` reprova.
  return prisma.$transaction((tx) => assignToIfOnShiftEm(tx, tenantId, id, userId, departmentId, at));
}

// O mesmo, dentro de uma transação que já existe. O rodízio precisa disto porque
// a escolha do atendente e a gravação têm que viver na MESMA transação da trava
// por setor — se a gravação abrisse a sua própria, a trava já teria sido solta
// quando ela acontecesse, e duas conversas voltariam a cair na mesma pessoa.
export async function assignToIfOnShiftEm(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
  userId: string,
  departmentId: string,
  at: Date
): Promise<{ count: number }> {
  {
    await tx.$queryRaw`
      SELECT 1 FROM users WHERE id = ${userId} AND tenant_id = ${tenantId} FOR UPDATE`;

    const count = await tx.$executeRaw`
      UPDATE conversations
         SET status = 'assigned', assigned_user_id = ${userId}, assigned_at = ${at}
       WHERE id = ${id}
         AND tenant_id = ${tenantId}
         AND status = 'open'
         AND assigned_user_id IS NULL
         AND EXISTS (
               SELECT 1
                 FROM users u
                 JOIN user_departments ud
                   ON ud.user_id = u.id
                  AND ud.department_id = ${departmentId}
                 JOIN shift_sessions s
                   ON s.user_id = u.id
                  AND s.tenant_id = u.tenant_id
                  AND s.ended_at IS NULL
                  AND s.ends_at > ${at}
                 -- de pé NESTE setor, não só de plantão. É a gêmea do filtro em
                 -- users.availableAgentsForDepartment: as duas descrevem a mesma
                 -- regra, uma no Prisma e outra aqui, e mudar só uma faz este
                 -- UPDATE voltar com count 0 sem erro nenhum.
                 JOIN shift_session_departments ssd
                   ON ssd.shift_session_id = s.id
                  AND ssd.tenant_id = s.tenant_id
                  AND ssd.department_id = ${departmentId}
                  AND ssd.ended_at IS NULL
                  AND ssd.ends_at > ${at}
                WHERE u.id = ${userId}
                  AND u.tenant_id = ${tenantId}
                  AND u.active
                  AND u.role = 'agent'
                  AND u.availability = 'available'
             )`;
    return { count };
  }
}

// Encerrar é uma corrida com tudo o mais: entre ler a conversa e gravar o
// fechamento ela pode ter sido encaminhada para outro setor, assumida por alguém
// ou encerrada por outro caminho. O estado LIDO entra no WHERE e o chamador
// confere o count — sem isso o job de inatividade mata a conversa que o atendente
// acabou de encaminhar, e o externo recebe a pergunta de nota duas vezes.
export interface ConversationSnapshot {
  status: ConversationStatus;
  departmentId: string | null;
  assignedUserId: string | null;
}

export function closeIfUnchanged(
  tenantId: string,
  id: string,
  visto: ConversationSnapshot,
  status: ConversationStatus,
  reason: CloseReason
) {
  return prisma.conversation.updateMany({
    where: {
      tenantId,
      id,
      status: visto.status,
      departmentId: visto.departmentId,
      assignedUserId: visto.assignedUserId,
    },
    data: { status, closeReason: reason, closedAt: new Date() },
  });
}

// Transição de estado do fluxo do externo com o estado esperado no WHERE. O job
// de inatividade não passa pela fila do contato, então toda escrita do menu pode
// cruzar com um encerramento: sem a guarda a escolha do setor RESSUSCITA a
// conversa e deixa `closed_at` e `close_reason=timeout` gravados numa conversa
// viva — e "timestamps são o produto".
export function moveStatus(
  tenantId: string,
  id: string,
  de: ConversationStatus,
  data: Prisma.ConversationUncheckedUpdateManyInput
) {
  return prisma.conversation.updateMany({
    where: { tenantId, id, status: de },
    data,
  });
}

// Encerramento cru, só do que ainda está vivo — evita reescrever `close_reason` e
// `closed_at` de uma conversa que outro caminho já fechou.
export function closeIfActive(tenantId: string, id: string, reason: CloseReason) {
  return prisma.conversation.updateMany({
    where: { tenantId, id, status: { in: ACTIVE_STATUSES } },
    data: { status: 'closed', closeReason: reason, closedAt: new Date() },
  });
}

// Mesma ideia, do lado de quem responde: confirma que a conversa continua viva no
// instante do envio. A marca no `lastMessageAt` é o que torna a checagem atômica —
// um SELECT antes de enviar não impediria o job de encerrar no meio.
export function touchIfActive(tenantId: string, id: string) {
  return prisma.conversation.updateMany({
    where: { tenantId, id, status: { in: ACTIVE_STATUSES } },
    data: { lastMessageAt: new Date() },
  });
}

export function listOpenAssignedTo(
  tenantId: string,
  userId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.conversation.findMany({
    where: { tenantId, assignedUserId: userId, status: { in: ACTIVE_STATUSES } },
    select: { id: true },
  });
}

// As duas irmãs por setor. Sair do plantão de UM setor não pode devolver para a
// fila as conversas dos outros setores em que a pessoa continua de plantão — o
// externo receberia aviso de troca de atendente sem nada ter mudado para ele.
export function listOpenAssignedToInDepartment(
  tenantId: string,
  userId: string,
  departmentId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.conversation.findMany({
    where: {
      tenantId,
      assignedUserId: userId,
      departmentId,
      status: { in: ACTIVE_STATUSES },
    },
    select: { id: true },
  });
}

export function releaseFromUserInDepartment(
  tenantId: string,
  userId: string,
  departmentId: string,
  client: Prisma.TransactionClient = prisma
) {
  return client.conversation.updateMany({
    where: {
      tenantId,
      assignedUserId: userId,
      departmentId,
      status: { in: ACTIVE_STATUSES },
    },
    data: { status: 'open', assignedUserId: null, assignedAt: null },
  });
}

export function listOpenForDepartments(tenantId: string, departmentIds: string[]) {
  return prisma.conversation.findMany({
    where: { tenantId, status: 'open', departmentId: { in: departmentIds } },
    orderBy: { createdAt: 'asc' },
  });
}

// Visão do agente: minhas conversas + fila dos meus setores
export function listForAgentView(tenantId: string, userId: string, departmentIds: string[]) {
  return prisma.conversation.findMany({
    where: {
      tenantId,
      OR: [
        { assignedUserId: userId, status: { in: ACTIVE_STATUSES } },
        { status: 'open', departmentId: { in: departmentIds } },
      ],
    },
    include: {
      department: { select: { id: true, name: true } },
      externalContact: { select: { id: true, waNumber: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
  });
}

export function findByIdWithRelations(tenantId: string, id: string) {
  return prisma.conversation.findFirst({
    where: { id, tenantId },
    include: {
      department: { select: { id: true, name: true } },
      externalContact: true,
      whatsappNumber: true,
    },
  });
}

// A porta do atendente para UMA conversa: a mesma regra da lista dele
// (`listForAgentView`) — a minha ou a do meu setor. Só o tenant não basta: com um
// id vazado (print, URL colada no grupo da equipe) qualquer atendente abria o
// histórico de um paciente de setor alheio, respondia pelo WhatsApp do hospital
// em nome daquele setor e ainda tirava a conversa da fila de quem devia atender.
// 404 e nunca 403, pela mesma razão que vale entre hospitais: quem não pode ver
// não recebe confirmação de que a conversa existe. O gestor continua enxergando
// tudo por /admin/conversations, que é a porta certa para isso.
export function findByIdForAgent(tenantId: string, userId: string, id: string) {
  return prisma.conversation.findFirst({
    where: {
      id,
      tenantId,
      OR: [
        { assignedUserId: userId },
        { department: { users: { some: { userId } } } },
      ],
    },
    include: {
      department: { select: { id: true, name: true } },
      externalContact: true,
      whatsappNumber: true,
    },
  });
}

// Write-once: quem esperou na fila esperou uma vez só. Sem isto, cada troca de
// plantão reescreveria o relógio e a conversa que atravessa a virada de turno
// entraria na média como se tivesse esperado o turno inteiro.
export function markFirstAssignedOnce(
  tenantId: string,
  id: string,
  at: Date,
  client: Prisma.TransactionClient = prisma
) {
  return client.conversation.updateMany({
    where: { id, tenantId, firstAssignedAt: null },
    data: { firstAssignedAt: at },
  });
}

// first_reply_at é write-once: só grava se ainda estiver nulo
export function markFirstReplyOnce(tenantId: string, id: string) {
  return prisma.conversation.updateMany({
    where: { id, tenantId, firstReplyAt: null },
    data: { firstReplyAt: new Date() },
  });
}

// Job de timeout: estados ativos parados há mais de 30 min.
// Espelha o WHERE do PROJETO.md — awaiting_feedback e open (fila) ficam de fora.
export function listStaleForTimeout(tenantId: string, cutoff: Date) {
  return prisma.conversation.findMany({
    where: {
      tenantId,
      status: { in: ['assigned', 'awaiting_department', 'awaiting_menu_confirm'] },
      lastMessageAt: { lt: cutoff },
    },
  });
}

export function listForMetrics(tenantId: string, from: Date, to: Date, departmentId?: string) {
  return prisma.conversation.findMany({
    where: {
      tenantId,
      createdAt: { gte: from, lte: to },
      ...(departmentId ? { departmentId } : {}),
    },
    include: {
      feedback: true,
      entryLink: { select: { id: true, kind: true } },
      department: { select: { id: true, name: true } },
    },
  });
}

// Round-robin: quando cada agente recebeu sua última conversa
export function lastAssignedAtByUsers(
  tenantId: string,
  userIds: string[],
  client: Prisma.TransactionClient = prisma
) {
  return client.conversation.groupBy({
    by: ['assignedUserId'],
    where: { tenantId, assignedUserId: { in: userIds } },
    _max: { assignedAt: true },
  });
}
