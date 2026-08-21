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
import * as tenants from '../repositories/tenants';
import * as users from '../repositories/users';
import {
  closeActiveInDepartment,
  closeActiveOutsideLinkScope,
  closeConversation,
} from '../services/lifecycle.service';
import { computeMetrics } from '../services/metrics.service';
import { reevaluateShift, reofferConversations, replaceSchedule } from '../services/shift.service';
import { buildPrefillText, generateEntryCode, generateSlug } from '../utils/ids';
import { dayRangeInZone } from '../utils/shiftClock';
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
    const desativando = current.active && parsed.data.active === false;
    if (desativando) {
      await assertDepartmentDeactivatable(tenantId, current.id);
    }

    const result = await departments.update(tenantId, current.id, parsed.data);
    if (result.count === 0) throw new NotFoundError();

    // Depois do UPDATE, nunca antes: enquanto o setor estava ativo ele ainda
    // aparecia em `listDepartmentsForLink` e nenhuma conversa estaria fora do
    // escopo do link.
    const closedConversations = desativando
      ? await closeActiveInDepartment(tenantId, current.id)
      : 0;
    res.json({ ok: true, closedConversations });
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

    // mesma porta do PATCH: setor que sai do ar leva junto o atendimento em curso
    const closedConversations = current.active
      ? await closeActiveInDepartment(tenantId, current.id)
      : 0;
    res.json({ ok: true, closedConversations });
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

    // Tirar alguém de um setor apaga a escala dela naquele setor, e a escala é
    // o que sustenta o plantão em curso. Sem reavaliar, quem perdeu a última
    // faixa continuaria com a sessão aberta e com acesso por até 16 horas,
    // regido por uma escala que não existe mais. É o mesmo passo que
    // `replaceSchedule` dá depois de salvar a escala — pelo mesmo motivo.
    //
    // O `endShift` de dentro solta MAIS conversas que as do `users.update` (que
    // só soltou as que ficaram fora do novo escopo de setores) e devolve quantas
    // foram. Descartar esse número faria a tela dizer "0 conversas devolvidas"
    // enquanto duas voltaram para a fila e a pessoa foi deslogada.
    let encerrouPlantao = false;
    let devolvidas = result.releasedConversations;
    if (departmentIds) {
      const fim = await reevaluateShift(tenantId, target.id);
      encerrouPlantao = fim !== null;
      devolvidas += fim?.releasedConversations ?? 0;
    }

    // As conversas soltas pelo `users.update` — as que ficaram fora do novo
    // escopo — nunca eram reoferecidas: ficavam em `open`, que é o único estado
    // que o job de inatividade não varre, mesmo com um colega de plantão no
    // setor. É o contrato que o comentário de `reofferConversations` descreve e
    // que esta rota nunca cumpriu; com o `endShift` agora reoferecendo as dele,
    // deixar metade sem reoferta seria pior que os dois lados iguais.
    await reofferConversations(tenantId, result.releasedConversationIds);

    res.json({
      ok: true,
      releasedConversations: devolvidas,
      shiftEnded: encerrouPlantao,
    });
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
    departmentId: z.string().uuid('setor inválido na escala'),
    weekday: z.number().int().min(0).max(6),
    // minutos desde 00:00; 1440 é meia-noite do dia seguinte, o que permite
    // cadastrar tanto "07:00 às 19:00" quanto "19:00 às 07:00" (vira o dia)
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((s) => s.startMinute !== s.endMinute, 'a faixa de plantão não pode ter duração zero');

const MAX_FAIXAS_POR_DIA = 3;

// Teto só do payload, para uma requisição absurda não virar milhares de linhas.
// Não é regra de negócio: quem estiver em mais setores que isto tem um problema
// de cadastro, não de escala.
const MAX_SETORES_NA_ESCALA = 10;

const shiftsPutSchema = z.object({
  // O teto de 21 sozinho prometia "três por dia" e não entregava: 21 faixas no
  // mesmo dia passavam, e faixas idênticas também. O editor do painel só mostra a
  // primeira faixa de cada dia, então o excedente virava estado invisível que o
  // admin não conseguia ver nem remover — e o plantão passava a ser regido por uma
  // escala que ninguém enxerga.
  //
  // Com escala por setor a contagem passou a ser por (dia, SETOR), e o teto do
  // array acompanha: três faixas na segunda no CT e três na segunda na Recepção
  // são seis faixas legítimas no mesmo dia. Contar só por dia transformaria o
  // caso normal de quem cobre dois setores em erro de validação.
  shifts: z
    .array(shiftEntrySchema)
    .max(MAX_FAIXAS_POR_DIA * 7 * MAX_SETORES_NA_ESCALA, 'escala longa demais')
    .superRefine((faixas, ctx) => {
      const porDiaESetor = new Map<string, number>();
      const vistas = new Set<string>();
      for (const f of faixas) {
        const chave = `${f.weekday}:${f.departmentId}`;
        const quantas = (porDiaESetor.get(chave) ?? 0) + 1;
        porDiaESetor.set(chave, quantas);
        if (quantas > MAX_FAIXAS_POR_DIA) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'no máximo três faixas de plantão por dia em cada setor',
          });
          return;
        }
        const assinatura = `${chave}:${f.startMinute}:${f.endMinute}`;
        if (vistas.has(assinatura)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'há duas faixas de plantão idênticas no mesmo dia e setor',
          });
          return;
        }
        vistas.add(assinatura);
      }
    }),
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

    // Escalar alguém para um setor de que ele não faz parte cria uma escala que
    // nunca vale nada: o rodízio exige o vínculo em `user_departments`, então a
    // pessoa entraria de plantão e não receberia chamado nenhum — sem erro, sem
    // aviso, e com a tela do admin mostrando que ela está escalada. Conferir
    // aqui é o que impede a escala de mentir.
    //
    // Cobre o cross-tenant de tabela: `departmentIdsOf` filtra o usuário por
    // tenant, e o vínculo em si já nasce validado por `resolveDepartmentIds`.
    // Um setor de outro hospital não está entre os do atendente e cai aqui como
    // "não é deste atendente" — 400, sem revelar que o setor existe.
    const setoresDoAtendente = new Set(await users.departmentIdsOf(tenantId, user.id));
    for (const faixa of parsed.data.shifts) {
      if (!setoresDoAtendente.has(faixa.departmentId)) {
        throw new BadRequestError('a escala tem um setor que não é deste atendente');
      }
    }

    // Substituir a escala e reavaliar o plantão em curso vão juntas: separadas,
    // um login que começasse no meio criava a sessão já depois da reavaliação e
    // com a escala antiga na mão.
    await replaceSchedule(tenantId, user.id, parsed.data.shifts);
    res.json(await shifts.listForUser(tenantId, user.id));
  } catch (err) {
    next(err);
  }
});

// Quem está de plantão agora, SETOR A SETOR — o admin precisa ver o hospital
// coberto, e "coberto" é uma pergunta por setor: cinco pessoas de plantão não
// dizem nada se as cinco estão na Recepção e o CT está vazio.
//
// Substituiu `/admin/shift-sessions`, que listava as pessoas com os setores
// DELAS. Isso passou a mentir quando o plantão virou por setor: quem cobre CT e
// Recepção mas está escalada só no CT hoje aparecia cobrindo os dois.
router.get('/admin/coverage', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    res.json(await shifts.coberturaPorSetor(tenantId));
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

    // Revogar sem encerrar revoga só no papel: a conversa viva continua na tela do
    // atendente e cada resposta sai de verdade pelo WhatsApp para quem acabou de
    // perder o acesso. O corte só chegaria quando a pessoa escrevesse de novo, ou
    // depois de 30 minutos parada. Sem CSAT, pelo mesmo critério do bloqueio de
    // contato: não se pede nota a quem teve o acesso cortado.
    const contatos = await externalContacts.listByLink(tenantId, link.id);
    for (const contato of contatos) {
      const ativa = await conversations.findActiveByContact(tenantId, contato.id);
      if (ativa) await closeConversation(tenantId, ativa.id, 'access_revoked');
    }

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

    // Reatribuir troca o escopo do contato AGORA; se a conversa em andamento
    // ficou num setor que o link novo não permite, ela é encerrada.
    let closedConversation = false;

    if (parsed.data.entryLinkId) {
      // o link de destino tem que ser do MESMO tenant
      const link = await entryLinks.findById(tenantId, parsed.data.entryLinkId);
      if (!link) throw new NotFoundError('link não encontrado');
      if (!link.active) {
        throw new BadRequestError('este link foi revogado: reatribuir cortaria o acesso do contato');
      }
      // A regra do link nominal (um número só) vale também pelo painel — dois
      // contatos no mesmo link nominal desligam o alerta de vazamento. Conferir e
      // gravar acontecem com a linha do link travada, a mesma trava do webhook:
      // são os dois caminhos que disputam a posse, e separados os dois passavam
      // pela conferência.
      if (link.kind === 'nominal') {
        await entryLinks.withLinkClaim(tenantId, link.id, async (tx) => {
          const holder = await externalContacts.findHolderOfLink(tenantId, link.id, tx);
          if (holder && holder.id !== contact.id) {
            throw new BadRequestError('este link nominal já está vinculado a outro número');
          }
          const result = await externalContacts.reassignLink(tenantId, contact.id, link.id, tx);
          if (result.count === 0) throw new NotFoundError();
        });
      } else {
        const result = await externalContacts.reassignLink(tenantId, contact.id, link.id);
        if (result.count === 0) throw new NotFoundError();
      }

      // A troca de link tem que alcançar a conversa VIVA, como o bloqueio e a
      // revogação já alcançam. Sem isto, o externo continuava conversando dentro
      // do setor antigo — que o link novo não autoriza —, o atendente daquele
      // setor seguia respondendo pelo WhatsApp do hospital, e a cada fim de
      // plantão o rodízio devolvia a conversa para a fila do mesmo setor.
      closedConversation = await closeActiveOutsideLinkScope(tenantId, contact.id, link.id);
    }

    if (parsed.data.blocked !== undefined) {
      const result = await externalContacts.setBlocked(tenantId, contact.id, parsed.data.blocked);
      if (result.count === 0) throw new NotFoundError();

      if (parsed.data.blocked) {
        // Bloquear sem encerrar deixa a conversa na fila para sempre e o agente
        // continua conseguindo responder um número que não pode mais escrever.
        // Sem CSAT: não faz sentido pedir nota a quem acabou de ser bloqueado.
        const active = await conversations.findActiveByContact(tenantId, contact.id);
        if (active) {
          await closeConversation(tenantId, active.id, 'access_revoked');
          closedConversation = true;
        }
      }
    }

    res.json({ ok: true, closedConversation });
  } catch (err) {
    next(err);
  }
});

// ---------- acessos negados e métricas ----------

// Data pura, no calendário do hospital. O sufixo de hora que o painel mandava
// (`T00:00:00`) é aceito e descartado: `z.coerce.date()` lia essa data-hora sem
// offset como hora local do PROCESSO, então com o Node em UTC "hoje" para um
// tenant em São Paulo começava às 21h de ontem — três horas de todo dia caíam no
// relatório do dia seguinte.
const localDateSchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(T.*)?$/,
    'use uma data no formato AAAA-MM-DD'
  )
  .transform((v) => v.slice(0, 10));

const rangeSchema = z.object({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  department_id: z.string().optional(),
});

// O fuso é o do tenant, não o do processo — é o mesmo `timezone` que já rege o
// plantão. Dois hospitais em fusos diferentes precisam de janelas diferentes para
// a mesma data.
async function janelaDoTenant(
  tenantId: string,
  from?: string,
  to?: string
): Promise<{ from?: Date; to?: Date }> {
  if (!from && !to) return {};
  const tenant = await tenants.findById(tenantId);
  return dayRangeInZone(tenant?.timezone ?? 'UTC', from, to);
}

router.get('/admin/access-attempts', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) throw new BadRequestError(firstIssue(parsed.error, 'período inválido'));
    const janela = await janelaDoTenant(tenantId, parsed.data.from, parsed.data.to);
    res.json(await accessAttempts.list(tenantId, janela.from, janela.to));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/metrics', async (req, res, next) => {
  try {
    const { tenantId } = req.auth!;
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) throw new BadRequestError(firstIssue(parsed.error, 'período inválido'));
    const janela = await janelaDoTenant(tenantId, parsed.data.from, parsed.data.to);
    const to = janela.to ?? new Date();
    const from = janela.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    res.json(await computeMetrics(tenantId, from, to, parsed.data.department_id));
  } catch (err) {
    next(err);
  }
});

export default router;
