import * as conversations from '../repositories/conversations';
import * as users from '../repositories/users';
import { prisma } from '../prisma';
import { advisoryLock, chaveDoRodizio } from '../repositories/locks';

// Round-robin: agente disponível do setor que foi atribuído há mais tempo.
// Sem agente disponível → a conversa fica em `open`, sem erro.
//
// A escolha é serializada POR SETOR. Duas pessoas de fora escrevendo ao mesmo
// tempo para o mesmo ramal são contatos diferentes, então o webhook as processa
// em paralelo — e as duas liam a mesma "última atribuição" e escolhiam o mesmo
// atendente. Um ficava com as duas conversas, o outro com nenhuma.
export interface AssignOptions {
  // Quem acabou de encaminhar não pode receber a conversa de volta: para quem
  // está de fora, o atendimento voltaria para a mesma pessoa que o passou adiante.
  exceptUserId?: string;
}

export async function tryAssign(
  tenantId: string,
  conversationId: string,
  options: AssignOptions = {}
): Promise<boolean> {
  const conversation = await conversations.findById(tenantId, conversationId);
  if (!conversation || conversation.status !== 'open' || !conversation.departmentId) {
    return false;
  }
  const departmentId = conversation.departmentId;

  // Ler os candidatos, escolher e gravar acontecem na MESMA transação, com a
  // trava do setor tomada antes de tudo. Só a guarda do UPDATE não resolve: ela
  // protege a CONVERSA, e duas conversas diferentes chegando juntas escrevem em
  // linhas diferentes — as duas passam, as duas escolheram o mesmo atendente
  // porque leram a mesma "última atribuição", e o rodízio deixa de rodar.
  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, chaveDoRodizio(tenantId, departmentId));

    // relê DENTRO da trava: enquanto esperávamos a vez, a conversa pode ter sido
    // assumida, encerrada ou encaminhada para outro setor
    const atual = await conversations.findById(tenantId, conversationId, tx);
    if (!atual || atual.status !== 'open' || atual.departmentId !== departmentId) {
      return false;
    }

    const todos = await users.availableAgentsForDepartment(tenantId, departmentId, tx);
    const agents = options.exceptUserId
      ? todos.filter((a) => a.id !== options.exceptUserId)
      : todos;
    if (agents.length === 0) return false;

    const lastAssignments = await conversations.lastAssignedAtByUsers(
      tenantId,
      agents.map((a) => a.id),
      tx
    );
    const lastByUser = new Map(
      lastAssignments.map((r) => [r.assignedUserId, r._max.assignedAt?.getTime() ?? 0])
    );

    agents.sort((a, b) => (lastByUser.get(a.id) ?? 0) - (lastByUser.get(b.id) ?? 0));
    const chosen = agents[0];

    const agora = new Date();
    // A guarda no WHERE continua necessária mesmo com a trava: ela cobre o que o
    // rodízio não controla — o próprio atendente assumindo pela tela no mesmo
    // instante, e o escolhido saindo de plantão ou do setor entre a leitura e a
    // gravação.
    const result = await conversations.assignToIfOnShiftEm(
      tx,
      tenantId,
      conversationId,
      chosen.id,
      departmentId,
      agora
    );
    if (result.count === 0) return false;

    await conversations.markFirstAssignedOnce(tenantId, conversationId, agora, tx);
    return true;
  });
}

// Disparado quando um agente fica disponível: pega a fila dos setores dele.
export async function assignPendingForUser(tenantId: string, userId: string): Promise<void> {
  const departmentIds = await users.departmentIdsOf(tenantId, userId);
  if (departmentIds.length === 0) return;

  const pending = await conversations.listOpenForDepartments(tenantId, departmentIds);
  for (const conversation of pending) {
    try {
      await tryAssign(tenantId, conversation.id);
    } catch (err) {
      // Uma conversa que não pôde ser distribuída não pode levar as outras junto —
      // nem o login de quem acabou de entrar de plantão, que é o chamador
      // principal e já criou a sessão e virou `available` antes de chegar aqui.
      // A conversa continua `open` na fila do setor, à vista de todo mundo, e o
      // próximo evento de rodízio tenta de novo.
      console.error(`[routing] falha ao distribuir a conversa ${conversation.id}:`, err);
    }
  }
}
