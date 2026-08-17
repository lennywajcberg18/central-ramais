import * as conversations from '../repositories/conversations';
import * as users from '../repositories/users';
import { runSerialized } from '../utils/keyedQueue';

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

  return runSerialized(`assign:${tenantId}:${departmentId}`, async () => {
    // relê dentro da fila: enquanto esperávamos a vez, a conversa pode ter sido
    // assumida, encerrada ou encaminhada para outro setor
    const atual = await conversations.findById(tenantId, conversationId);
    if (!atual || atual.status !== 'open' || atual.departmentId !== departmentId) {
      return false;
    }

    const todos = await users.availableAgentsForDepartment(tenantId, departmentId);
    const agents = options.exceptUserId
      ? todos.filter((a) => a.id !== options.exceptUserId)
      : todos;
    if (agents.length === 0) return false;

    const lastAssignments = await conversations.lastAssignedAtByUsers(
      tenantId,
      agents.map((a) => a.id)
    );
    const lastByUser = new Map(
      lastAssignments.map((r) => [r.assignedUserId, r._max.assignedAt?.getTime() ?? 0])
    );

    agents.sort((a, b) => (lastByUser.get(a.id) ?? 0) - (lastByUser.get(b.id) ?? 0));
    const chosen = agents[0];

    const agora = new Date();
    // A guarda no WHERE segura o que a fila não cobre: outra instância do
    // processo, o próprio atendente assumindo pela tela no mesmo instante, e o
    // escolhido encerrando o plantão entre a leitura dos elegíveis e o UPDATE.
    const result = await conversations.assignToIfOnShift(
      tenantId,
      conversationId,
      chosen.id,
      agora
    );
    if (result.count === 0) return false;

    await conversations.markFirstAssignedOnce(tenantId, conversationId, agora);
    return true;
  });
}

// Disparado quando um agente fica disponível: pega a fila dos setores dele.
export async function assignPendingForUser(tenantId: string, userId: string): Promise<void> {
  const departmentIds = await users.departmentIdsOf(tenantId, userId);
  if (departmentIds.length === 0) return;

  const pending = await conversations.listOpenForDepartments(tenantId, departmentIds);
  for (const conversation of pending) {
    await tryAssign(tenantId, conversation.id);
  }
}
