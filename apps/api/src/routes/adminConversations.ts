import { ConversationStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../errors';
import { requireAuth, requireRole } from '../middleware/auth';
import * as repo from '../repositories/adminConversations';

const router = Router();

router.use(requireAuth, requireRole('admin'));

const ABERTAS: ConversationStatus[] = [
  'awaiting_department',
  'open',
  'assigned',
  'awaiting_menu_confirm',
];

const listQuerySchema = z.object({
  // "abertas" cobre os quatro estados em andamento; "fila" é o subconjunto que
  // ninguém assumiu — é a pergunta que o gestor faz primeiro.
  situacao: z.enum(['todas', 'abertas', 'fila', 'encerradas']).default('todas'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

function statusFilter(situacao: string): ConversationStatus[] | undefined {
  if (situacao === 'abertas') return ABERTAS;
  if (situacao === 'fila') return ['open'];
  if (situacao === 'encerradas') return ['awaiting_feedback', 'closed'];
  return undefined;
}

router.get('/admin/conversations', async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new BadRequestError('filtro inválido');

    const rows = await repo.list(req.auth!.tenantId, {
      status: statusFilter(parsed.data.situacao),
      limit: parsed.data.limit,
    });

    res.json(
      rows.map((c) => ({
        id: c.id,
        status: c.status,
        closeReason: c.closeReason,
        departmentName: c.department?.name ?? null,
        assignedUserName: c.assignedUser?.name ?? null,
        entryLinkLabelSnapshot: c.entryLinkLabelSnapshot,
        contactNumber: c.externalContact.waNumber,
        messageCount: c._count.messages,
        score: c.feedback?.score ?? null,
        createdAt: c.createdAt,
        firstReplyAt: c.firstReplyAt,
        closedAt: c.closedAt,
        lastMessageAt: c.lastMessageAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get('/admin/conversations/:id/messages', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const conversation = await repo.findById(tenantId, req.params.id);
    if (!conversation) throw new NotFoundError();

    res.json({
      conversation: {
        id: conversation.id,
        status: conversation.status,
        closeReason: conversation.closeReason,
        departmentName: conversation.department?.name ?? null,
        assignedUserName: conversation.assignedUser?.name ?? null,
        entryLinkLabelSnapshot: conversation.entryLinkLabelSnapshot,
        contactNumber: conversation.externalContact.waNumber,
        score: conversation.feedback?.score ?? null,
        comment: conversation.feedback?.comment ?? null,
        createdAt: conversation.createdAt,
        closedAt: conversation.closedAt,
      },
      messages: await repo.listMessages(tenantId, conversation.id),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
