import { BadRequestError, NotFoundError } from '../errors';
import * as conversations from '../repositories/conversations';
import * as entryLinks from '../repositories/entryLinks';
import { sendConversationMessage } from './messaging.service';
import { tryAssign } from './routing.service';
import { buildTransferText } from './texts';

export interface TransferTarget {
  id: string;
  name: string;
  current: boolean;
}

// Os destinos possíveis são os setores DO LINK da pessoa, nunca os do hospital.
// Transferir para fora do link colocaria o externo num setor que o menu dele não
// mostra — e o MENU seguinte o mandaria de volta, sem explicação nenhuma.
export async function listTransferTargets(
  tenantId: string,
  conversationId: string
): Promise<TransferTarget[]> {
  const conversation = await conversations.findById(tenantId, conversationId);
  if (!conversation) throw new NotFoundError();

  const departments = await entryLinks.listDepartmentsForLink(tenantId, conversation.entryLinkId);
  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    current: d.id === conversation.departmentId,
  }));
}

export interface TransferResult {
  departmentName: string;
  assigned: boolean;
}

export async function transferConversation(
  tenantId: string,
  conversationId: string,
  targetDepartmentId: string,
  byUserId: string
): Promise<TransferResult> {
  const conversation = await conversations.findByIdWithRelations(tenantId, conversationId);
  if (!conversation) throw new NotFoundError();

  if (conversation.status === 'closed' || conversation.status === 'awaiting_feedback') {
    throw new BadRequestError('esta conversa já foi encerrada');
  }
  if (conversation.externalContact.blocked) {
    throw new BadRequestError('este contato está bloqueado');
  }
  // Há uma pergunta em aberto do lado do externo. Transferir agora jogaria a
  // conversa para a fila, onde a resposta dele ("SIM" / o número do setor) é
  // gravada e ignorada: o pedido morre sem ser atendido nem cancelado.
  if (conversation.status === 'awaiting_menu_confirm') {
    throw new BadRequestError(
      'esta pessoa está respondendo se quer voltar ao menu — espere a resposta dela'
    );
  }
  if (conversation.status === 'awaiting_department') {
    throw new BadRequestError('esta pessoa ainda está escolhendo o setor pelo menu');
  }

  const permitidos = await entryLinks.listDepartmentsForLink(tenantId, conversation.entryLinkId);
  const destino = permitidos.find((d) => d.id === targetDepartmentId);
  // 404 e não 403: quem pede um setor fora do link não recebe confirmação de que
  // ele existe, pela mesma razão que vale entre hospitais.
  if (!destino) throw new NotFoundError('setor não disponível para este contato');

  if (destino.id === conversation.departmentId) {
    throw new BadRequestError('a conversa já está neste setor');
  }

  // Volta para a fila do setor novo: quem estava atendendo não vai junto.
  // `firstAssignedAt` fica intacto — o externo esperou uma vez só, e é isso que
  // a métrica de espera mede.
  //
  // O setor de origem vai no WHERE junto com o status: dois atendentes clicando
  // "encaminhar" quase juntos liam o mesmo estado, os dois passavam nas
  // validações e o externo recebia dois avisos contraditórios. Quem perde a
  // corrida não escreve, não avisa e não reatribui — e vê na tela que o
  // encaminhamento dele não valeu, em vez de achar que resolveu.
  const movida = await conversations.transferDepartment(
    tenantId,
    conversation.id,
    destino.id,
    conversation.departmentId
  );
  if (movida.count === 0) {
    throw new BadRequestError(
      'esta conversa mudou de setor ou foi encerrada enquanto você encaminhava'
    );
  }

  // O externo precisa saber que mudou de setor: do lado dele, alguém some da
  // conversa e outra pessoa aparece.
  await sendConversationMessage(
    tenantId,
    conversation.id,
    conversation.whatsappNumber.phoneNumber,
    conversation.externalContact.waNumber,
    buildTransferText(destino.name)
  );

  const assigned = await tryAssign(tenantId, conversation.id, { exceptUserId: byUserId });
  return { departmentName: destino.name, assigned };
}
