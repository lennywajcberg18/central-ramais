import * as conversations from '../repositories/conversations';
import * as users from '../repositories/users';

// Round-robin: agente disponível do setor que foi atribuído há mais tempo.
// Sem agente disponível → a conversa fica em `open`, sem erro.
export async function tryAssign(tenantId: string, conversationId: string): Promise<boolean> {
  const conversation = await conversations.findById(tenantId, conversationId);
  if (!conversation || conversation.status !== 'open' || !conversation.departmentId) {
    return false;
  }

  const agents = await users.availableAgentsForDepartment(tenantId, conversation.departmentId);
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
  await conversations.update(tenantId, conversationId, {
    status: 'assigned',
    assignedUserId: chosen.id,
    assignedAt: agora,
  });
  await conversations.markFirstAssignedOnce(tenantId, conversationId, agora);
  return true;
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
