import { Role } from '@prisma/client';
import { Router } from 'express';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config';
import { BadRequestError, ConflictError, NotFoundError } from '../errors';
import { requireAuth, requireRole } from '../middleware/auth';
import * as accessAttempts from '../repositories/accessAttempts';
import * as conversations from '../repositories/conversations';
import * as departments from '../repositories/departments';
import * as entryLinks from '../repositories/entryLinks';
import * as externalContacts from '../repositories/externalContacts';
import * as shifts from '../repositories/shifts';
import * as users from '../repositories/users';
import { closeConversation } from '../services/lifecycle.service';
import { computeMetrics } from '../services/metrics.service';
import { claimKey } from '../services/access.service';
import { replaceSchedule } from '../services/shift.service';
import { runSerialized } from '../utils/keyedQueue';
import { buildPrefillText, generateEntryCode, generateSlug } from '../utils/ids';
import { normalizeKeyword } from '../utils/text';

const router = Router();

router.use(requireAuth, requireRole('admin'));

// Um 400 genérico não diz qual campo recusou — quem preenche o formulário
// precisa da mensagem do campo, não de "dados inválidos".
function firstIssue(error: z.ZodError, fallback: string): string {
  const issue = error.issues[0];
  if (!issue) return fallback;
  const field = issue.path.join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}

// Ids de setor inválidos ou de outro hospital eram descartados em silêncio, e o
// recurso nascia com um escopo de autorização menor do que o pedido.
async function resolveDepartmentIds(
  tenantId: string,
  ids: string[],
  opts: { mustBeActive?: boolean } = {}
): Promise<string[]> {
  const requested = [...new Set(ids)];
  const found = await departments.findManyByIds(tenantId, requested);
  if (found.length !== requested.length) {
    throw new BadRequestError('a lista tem setor inexistente ou de outro hospital');
  }
  // Link só aponta para setor ativo. Um link cujos setores estão todos inativos
  // nasce órfão: quem usa recebe "Nenhum setor disponível", o contato fica
  // vinculado a ele para sempre e não sobra nem access_attempt para o admin
  // perceber. É o mesmo estado que a trava de desativação de setor recusa —
  // sem esta checagem ele entra pela porta da criação.
  if (opts.mustBeActive) {
    const inactive = found.filter((d) => !d.active);
    if (inactive.length > 0) {
      throw new BadRequestError('a lista tem setor desativado', {
        departments: inactive.map((d) => ({ id: d.id, name: d.name })),
      });
    }
  }
  return found.map((d) => d.id);
}

// Dois setores ativos com o mesmo nome viram duas linhas idênticas no menu do
// externo. normalizeKeyword ignora caixa e acento, que é o que o menu mostra.
async function assertDepartmentNameFree(
  tenantId: string,
  name: string,
  exceptId?: string
): Promise<void> {
  const target = normalizeKeyword(name);
  const actives = await departments.listActive(tenantId);
  if (actives.some((d) => d.id !== exceptId && normalizeKeyword(d.name) === target)) {
    throw new ConflictError('já existe um setor ativo com esse nome');
  }
}

async function assertDepartmentDeactivatable(tenantId: string, id: string): Promise<void> {
  const orphaned = await entryLinks.listActiveOrphanedByDepartment(tenantId, id);
  if (orphaned.length > 0) {
    throw new ConflictError(
      'este é o último setor ativo de link(s) de acesso ativos; revogue esses links antes de desativá-lo',
      { links: orphaned.map((l) => ({ id: l.id, label: l.label })) }
    );
  }
}

async function assertUserDeactivatable(
  tenantId: string,
  actingUserId: string,
  target: { id: string; role: Role }
): Promise<void> {
  // Sem admin ativo não existe quem entre no painel para desfazer.
  if (target.role === 'admin' && (await users.countActiveAdmins(tenantId)) <= 1) {
    throw new BadRequestError(
      'este é o último administrador ativo do hospital; ative outro administrador antes de desativá-lo'
    );
  }
  if (target.id === actingUserId) {
    throw new BadRequestError('você não pode desativar a própria conta');
  }
}

// ---------- setores ----------

router.get('/admin/departments', async (req, res, next) => {
  try {
    res.json(await departments.list(req.auth!.tenantId));
  } catch (err) {
    next(err);
  }
});

const departmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'informe o nome do setor')
    .max(60, 'o nome do setor pode ter no máximo 60 caracteres'),
  // sort_order é int4 no Postgres: sem teto, um número grande estoura no insert
  sortOrder: z.coerce
    .number({ invalid_type_error: 'ordem deve ser um número' })
    .int('ordem deve ser um número inteiro')
    .min(-9999, 'ordem deve estar entre -9999 e 9999')
    .max(9999, 'ordem deve estar entre -9999 e 9999')
    .optional(),
  active: z.boolean().optional(),
});

router.post('/admin/departments', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = departmentSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(firstIssue(parsed.error, 'dados do setor inválidos'));
    if (parsed.data.active !== false) {
      await assertDepartmentNameFree(tenantId, parsed.data.name);
    }
    const menuKey = await departments.nextMenuKey(tenantId);
    const created = await departments.create(tenantId, {
      name: parsed.data.name,
      menuKey,
      sortOrder: parsed.data.sortOrder ?? Number(menuKey),
      active: parsed.data.active ?? true,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch('/admin/departments/:id', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = departmentSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(firstIssue(parsed.error, 'dados do setor inválidos'));

    const current = await departments.findById(tenantId, req.params.id);
    if (!current) throw new NotFoundError();

    const willBeActive = parsed.data.active ?? current.active;
    // reativar também pode recriar a duplicata, não só renomear
    if (willBeActive && (parsed.data.name !== undefined || parsed.data.active === true)) {
      await assertDepartmentNameFree(tenantId, parsed.data.name ?? current.name, current.id);
    }
    if (current.active && parsed.data.active === false) {
      await assertDepartmentDeactivatable(tenantId, current.id);
    }

    const result = await departments.update(tenantId, current.id, parsed.data);
    if (result.count === 0) throw new NotFoundError();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE desativa (histórico de conversas referencia o setor)
router.delete('/admin/departments/:id', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const current = await departments.findById(tenantId, req.params.id);
    if (!current) throw new NotFoundError();
    if (current.active) await assertDepartmentDeactivatable(tenantId, current.id);

    const result = await departments.update(tenantId, current.id, { active: false });
    if (result.count === 0) throw new NotFoundError();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- usuários ----------

router.get('/admin/users', async (req, res, next) => {
  try {
    const rows = await users.list(req.auth!.tenantId);
    res.json(
      rows.map((u) => ({
        id: u.id,
        role: u.role,
        name: u.name,
        email: u.email,
        active: u.active,
        availability: u.availability,
        departmentIds: u.departments.map((d) => d.departmentId),
        departmentNames: u.departments.map((d) => d.department.name),
      }))
    );
  } catch (err) {
    next(err);
  }
});

const userNameSchema = z
  .string()
  .trim()
  .min(1, 'informe o nome do usuário')
  .max(80, 'o nome pode ter no máximo 80 caracteres');

const userCreateSchema = z.object({
  role: z.enum(['admin', 'agent']),
  name: userNameSchema,
  // e-mail é a identidade do login: normalizado para minúsculas na entrada,
  // senão ADMIN@ e admin@ viram duas contas diferentes
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('e-mail inválido')
    .max(160, 'o e-mail pode ter no máximo 160 caracteres'),
  password: z
    .string()
    .min(6, 'a senha precisa de ao menos 6 caracteres')
    .max(72, 'a senha pode ter no máximo 72 caracteres') // limite do bcrypt
    .refine((v) => v.trim().length >= 6, 'a senha não pode ser só espaços'),
  departmentIds: z.array(z.string()).optional(),
});

router.post('/admin/users', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = userCreateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(firstIssue(parsed.error, 'dados do usuário inválidos'));

    const departmentIds = await resolveDepartmentIds(tenantId, parsed.data.departmentIds ?? []);
    // Agente sem setor nunca recebe conversa — barrar na criação evita o
    // cadastro órfão que só aparece quando a fila não anda.
    if (parsed.data.role === 'agent' && departmentIds.length === 0) {
      throw new BadRequestError('selecione ao menos um setor para o agente');
    }
    if (await users.emailTaken(parsed.data.email)) {
      throw new BadRequestError('este e-mail já está em uso');
    }

    const created = await users.create(tenantId, {
      role: parsed.data.role,
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: bcrypt.hashSync(parsed.data.password, 10),
      departmentIds,
    });
    res.status(201).json({ id: created.id });
  } catch (err) {
    next(err);
  }
});

const userUpdateSchema = z.object({
  name: userNameSchema.optional(),
  active: z.boolean().optional(),
  departmentIds: z.array(z.string()).optional(),
});

router.patch('/admin/users/:id', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const parsed = userUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(firstIssue(parsed.error, 'dados do usuário inválidos'));

    const target = await users.findById(tenantId, req.params.id);
    if (!target) throw new NotFoundError();

    let departmentIds: string[] | undefined;
    if (parsed.data.departmentIds) {
      departmentIds = await resolveDepartmentIds(tenantId, parsed.data.departmentIds);
      // mesma regra da criação: agente sem setor não recebe conversa nenhuma
      if (target.role === 'agent' && departmentIds.length === 0) {
        throw new BadRequestError('o agente precisa de ao menos um setor');
      }
    }
    // desativar por PATCH é a mesma porta do DELETE, com as mesmas travas
    if (parsed.data.active === false && target.active) {
      await assertUserDeactivatable(tenantId, userId, target);
    }

    const result = await users.update(tenantId, target.id, {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      departmentIds,
    });
    if (result.count === 0) throw new NotFoundError();
    res.json({ ok: true, releasedConversations: result.releasedConversations });
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/users/:id', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const target = await users.findById(tenantId, req.params.id);
    if (!target) throw new NotFoundError();
    if (target.active) await assertUserDeactivatable(tenantId, userId, target);

    const result = await users.deactivate(tenantId, target.id);
    if (result.count === 0) throw new NotFoundError();
    // quantas voltaram para a fila: sem isso o admin não sabe o que precisa ser reatendido
    res.json({ ok: true, releasedConversations: result.releasedConversations });
  } catch (err) {
    next(err);
  }
});

// ---------- entry links ----------

function linkToJson(link: Awaited<ReturnType<typeof entryLinks.list>>[number]) {
  return {
    id: link.id,
    slug: link.slug,
    url: `${config.PUBLIC_BASE_URL}/c/${link.slug}`,
    entryCode: link.entryCode,
    kind: link.kind,
    label: link.label,
    holderNote: link.holderNote,
    active: link.active,
    revokedAt: link.revokedAt,
    useCount: link.useCount,
    createdAt: link.createdAt,
    departments: link.departments.map((d) => ({
      id: d.department.id,
      name: d.department.name,
    })),
  };
}

const shiftEntrySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    // minutos desde 00:00; 1440 é meia-noite do dia seguinte, o que permite
    // cadastrar tanto "07:00 às 19:00" quanto "19:00 às 07:00" (vira o dia)
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((s) => s.startMinute !== s.endMinute, 'a faixa de plantão não pode ter duração zero');

const shiftsPutSchema = z.object({
  shifts: z.array(shiftEntrySchema).max(21, 'no máximo três faixas por dia'),
});

router.get('/admin/users/:id/shifts', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const user = await users.findById(tenantId, req.params.id);
    if (!user) throw new NotFoundError();
    res.json(await shifts.listForUser(tenantId, user.id));
  } catch (err) {
    next(err);
  }
});

// A escala vai inteira de uma vez: o painel edita a semana toda numa tela só.
router.put('/admin/users/:id/shifts', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = shiftsPutSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(firstIssue(parsed.error, 'escala inválida'));

    const user = await users.findById(tenantId, req.params.id);
    if (!user) throw new NotFoundError();
    if (user.role !== 'agent') throw new BadRequestError('só atendentes têm escala de plantão');

    // Substituir a escala e reavaliar o plantão em curso vão juntas: separadas,
    // um login que começasse no meio criava a sessão já depois da reavaliação e
    // com a escala antiga na mão.
    await replaceSchedule(tenantId, user.id, parsed.data.shifts);
    res.json(await shifts.listForUser(tenantId, user.id));
  } catch (err) {
    next(err);
  }
});

// Quem está de plantão agora — o admin precisa ver o hospital coberto.
router.get('/admin/shift-sessions', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    res.json(await shifts.listOpenSessionsWithUser(tenantId));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/entry-links', async (req, res, next) => {
  try {
    const rows = await entryLinks.list(req.auth!.tenantId);
    res.json(rows.map(linkToJson));
  } catch (err) {
    next(err);
  }
});

const linkCreateSchema = z.object({
  kind: z.enum(['profile', 'nominal']),
  label: z
    .string()
    .trim()
    .min(1, 'informe o rótulo do link')
    .max(120, 'o rótulo pode ter no máximo 120 caracteres'),
  holderNote: z
    .string()
    .trim()
    .max(500, 'a observação pode ter no máximo 500 caracteres')
    .optional(),
  departmentIds: z.array(z.string()).min(1, 'selecione ao menos um setor'),
});

router.post('/admin/entry-links', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const parsed = linkCreateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(firstIssue(parsed.error, 'dados do link inválidos'));

    const departmentIds = await resolveDepartmentIds(tenantId, parsed.data.departmentIds, {
      mustBeActive: true,
    });

    // entry_code é único por tenant — em colisão, tenta outro
    let entryCode = generateEntryCode();
    for (let i = 0; i < 5 && (await entryLinks.findByCode(tenantId, entryCode)); i++) {
      entryCode = generateEntryCode();
    }

    const created = await entryLinks.create(tenantId, {
      slug: generateSlug(),
      entryCode,
      kind: parsed.data.kind,
      label: parsed.data.label,
      holderNote: parsed.data.holderNote,
      prefillText: buildPrefillText(entryCode),
      createdByUserId: userId,
      departmentIds,
    });
    res.status(201).json(linkToJson(created));
  } catch (err) {
    next(err);
  }
});

router.post('/admin/entry-links/:id/revoke', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const link = await entryLinks.findById(tenantId, req.params.id);
    if (!link) throw new NotFoundError();
    // 404 aqui seria mentira: o link está na tela, só já foi revogado antes
    if (!link.active) throw new ConflictError('este link já foi revogado');

    const result = await entryLinks.revoke(tenantId, link.id, userId);
    if (result.count === 0) throw new ConflictError('este link já foi revogado');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/entry-links/:id/qrcode', async (req, res, next) => {
  try {
    const link = await entryLinks.findById(req.auth!.tenantId, req.params.id);
    if (!link) throw new NotFoundError();
    // QR de link revogado é papel impresso que leva a "Link indisponível"
    if (!link.active) throw new ConflictError('link revogado: o QR levaria a uma página indisponível');
    const png = await QRCode.toBuffer(`${config.PUBLIC_BASE_URL}/c/${link.slug}`, {
      type: 'png',
      width: 512,
    });
    res.type('png').send(png);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/entry-links/:id/contacts', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const link = await entryLinks.findById(tenantId, req.params.id);
    if (!link) throw new NotFoundError();
    res.json(await externalContacts.listByLink(tenantId, link.id));
  } catch (err) {
    next(err);
  }
});

// ---------- contatos ----------

router.get('/admin/contacts', async (req, res, next) => {
  try {
    res.json(await externalContacts.list(req.auth!.tenantId));
  } catch (err) {
    next(err);
  }
});

const contactPatchSchema = z.object({
  blocked: z.boolean().optional(),
  entryLinkId: z.string().optional(),
});

router.patch('/admin/contacts/:id', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = contactPatchSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(firstIssue(parsed.error, 'dados inválidos'));

    // corpo vazio não pode responder ok para contato que não existe
    const contact = await externalContacts.findById(tenantId, req.params.id);
    if (!contact) throw new NotFoundError();

    if (parsed.data.entryLinkId) {
      // o link de destino tem que ser do MESMO tenant
      const link = await entryLinks.findById(tenantId, parsed.data.entryLinkId);
      if (!link) throw new NotFoundError('link não encontrado');
      if (!link.active) {
        throw new BadRequestError('este link foi revogado: reatribuir cortaria o acesso do contato');
      }
      // A regra do link nominal (um número só) vale também pelo painel — dois
      // contatos no mesmo link nominal desligam o alerta de vazamento. Conferir e
      // gravar entram na mesma fila do webhook: são os dois caminhos que disputam
      // a posse do link, e separados os dois passavam pela conferência.
      if (link.kind === 'nominal') {
        await runSerialized(claimKey(tenantId, link.id), async () => {
          const holder = await externalContacts.findHolderOfLink(tenantId, link.id);
          if (holder && holder.id !== contact.id) {
            throw new BadRequestError('este link nominal já está vinculado a outro número');
          }
          const result = await externalContacts.reassignLink(tenantId, contact.id, link.id);
          if (result.count === 0) throw new NotFoundError();
        });
      } else {
        const result = await externalContacts.reassignLink(tenantId, contact.id, link.id);
        if (result.count === 0) throw new NotFoundError();
      }
    }

    if (parsed.data.blocked !== undefined) {
      const result = await externalContacts.setBlocked(tenantId, contact.id, parsed.data.blocked);
      if (result.count === 0) throw new NotFoundError();

      if (parsed.data.blocked) {
        // Bloquear sem encerrar deixa a conversa na fila para sempre e o agente
        // continua conseguindo responder um número que não pode mais escrever.
        // Sem CSAT: não faz sentido pedir nota a quem acabou de ser bloqueado.
        const active = await conversations.findActiveByContact(tenantId, contact.id);
        if (active) await closeConversation(tenantId, active.id, 'access_revoked');
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- acessos negados e métricas ----------

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  department_id: z.string().optional(),
});

router.get('/admin/access-attempts', async (req, res, next) => {
  try {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) throw new BadRequestError('período inválido');
    res.json(await accessAttempts.list(req.auth!.tenantId, parsed.data.from, parsed.data.to));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/metrics', async (req, res, next) => {
  try {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) throw new BadRequestError('período inválido');
    const to = parsed.data.to ?? new Date();
    const from = parsed.data.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    res.json(await computeMetrics(req.auth!.tenantId, from, to, parsed.data.department_id));
  } catch (err) {
    next(err);
  }
});

export default router;
