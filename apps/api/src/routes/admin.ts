import { Router } from 'express';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config';
import { BadRequestError, NotFoundError } from '../errors';
import { requireAuth, requireRole } from '../middleware/auth';
import * as accessAttempts from '../repositories/accessAttempts';
import * as departments from '../repositories/departments';
import * as entryLinks from '../repositories/entryLinks';
import * as externalContacts from '../repositories/externalContacts';
import * as users from '../repositories/users';
import { computeMetrics } from '../services/metrics.service';
import { buildPrefillText, generateEntryCode, generateSlug } from '../utils/ids';

const router = Router();

router.use(requireAuth, requireRole('admin'));

// ---------- setores ----------

router.get('/admin/departments', async (req, res, next) => {
  try {
    res.json(await departments.list(req.auth!.tenantId));
  } catch (err) {
    next(err);
  }
});

const departmentSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.coerce.number().int().optional(),
  active: z.boolean().optional(),
});

router.post('/admin/departments', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = departmentSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('dados do setor inválidos');
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
    if (!parsed.success) throw new BadRequestError('dados do setor inválidos');
    const result = await departments.update(tenantId, req.params.id, parsed.data);
    if (result.count === 0) throw new NotFoundError();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE desativa (histórico de conversas referencia o setor)
router.delete('/admin/departments/:id', async (req, res, next) => {
  try {
    const result = await departments.update(req.auth!.tenantId, req.params.id, { active: false });
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

const userCreateSchema = z.object({
  role: z.enum(['admin', 'agent']),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  departmentIds: z.array(z.string()).optional(),
});

router.post('/admin/users', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = userCreateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('dados do usuário inválidos');

    const validDepts = await departments.findManyByIds(
      tenantId,
      parsed.data.departmentIds ?? []
    );
    const created = await users.create(tenantId, {
      role: parsed.data.role,
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: bcrypt.hashSync(parsed.data.password, 10),
      departmentIds: validDepts.map((d) => d.id),
    });
    res.status(201).json({ id: created.id });
  } catch (err) {
    next(err);
  }
});

const userUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  departmentIds: z.array(z.string()).optional(),
});

router.patch('/admin/users/:id', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = userUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('dados do usuário inválidos');

    let departmentIds: string[] | undefined;
    if (parsed.data.departmentIds) {
      const valid = await departments.findManyByIds(tenantId, parsed.data.departmentIds);
      departmentIds = valid.map((d) => d.id);
    }
    const result = await users.update(tenantId, req.params.id, {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      departmentIds,
    } as never);
    if (result.count === 0) throw new NotFoundError();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/users/:id', async (req, res, next) => {
  try {
    const result = await users.deactivate(req.auth!.tenantId, req.params.id);
    if (result.count === 0) throw new NotFoundError();
    res.json({ ok: true });
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
  label: z.string().min(1),
  holderNote: z.string().optional(),
  departmentIds: z.array(z.string()).min(1, 'selecione ao menos um setor'),
});

router.post('/admin/entry-links', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const parsed = linkCreateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('lista de setores é obrigatória');

    const validDepts = await departments.findManyByIds(tenantId, parsed.data.departmentIds);
    if (validDepts.length === 0) throw new BadRequestError('selecione ao menos um setor válido');

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
      departmentIds: validDepts.map((d) => d.id),
    });
    res.status(201).json(linkToJson(created));
  } catch (err) {
    next(err);
  }
});

router.post('/admin/entry-links/:id/revoke', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.auth!;
    const result = await entryLinks.revoke(tenantId, req.params.id, userId);
    if (result.count === 0) throw new NotFoundError();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/entry-links/:id/qrcode', async (req, res, next) => {
  try {
    const link = await entryLinks.findById(req.auth!.tenantId, req.params.id);
    if (!link) throw new NotFoundError();
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
    if (!parsed.success) throw new BadRequestError('dados inválidos');

    if (parsed.data.blocked !== undefined) {
      const result = await externalContacts.setBlocked(tenantId, req.params.id, parsed.data.blocked);
      if (result.count === 0) throw new NotFoundError();
    }
    if (parsed.data.entryLinkId) {
      // o link de destino tem que ser do MESMO tenant
      const link = await entryLinks.findById(tenantId, parsed.data.entryLinkId);
      if (!link) throw new NotFoundError('link não encontrado');
      const result = await externalContacts.reassignLink(tenantId, req.params.id, link.id);
      if (result.count === 0) throw new NotFoundError();
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
