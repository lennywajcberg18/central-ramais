import { EntryLinkKind, Role, Availability } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma';
import { generateSlug, buildPrefillText } from '../src/utils/ids';

const PASSWORD = '123456';
const BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001';

interface SeedLink {
  label: string;
  kind: EntryLinkKind;
  entryCode: string;
  holderNote?: string;
  departmentNames: string[];
}

interface SeedTenant {
  name: string;
  phoneNumber: string;
  departments: string[];
  links: SeedLink[];
  admin: { name: string; email: string };
  agents: { name: string; email: string; departmentNames: string[] }[];
}

const TENANTS: SeedTenant[] = [
  {
    name: 'Hospital Vida',
    phoneNumber: '+14155238886',
    departments: ['Recepção', 'Cardiologia', 'Fisioterapia', 'Enfermagem', 'Faturamento'],
    links: [
      {
        label: 'Médico Externo',
        kind: 'profile',
        entryCode: 'MEDX',
        departmentNames: ['Cardiologia', 'Enfermagem', 'Recepção'],
      },
      {
        label: 'Convênio',
        kind: 'profile',
        entryCode: 'CONV',
        departmentNames: ['Faturamento', 'Recepção'],
      },
      {
        label: 'Dra. Ana Ribeiro',
        kind: 'nominal',
        entryCode: 'ANAR',
        holderNote: 'CRM 12345',
        departmentNames: ['Cardiologia', 'Recepção'],
      },
      {
        // um setor só — testa o pulo de menu
        label: 'Familiar leito 4B',
        kind: 'nominal',
        entryCode: 'F4BX',
        departmentNames: ['Enfermagem'],
      },
    ],
    admin: { name: 'Admin Vida', email: 'admin@hospitalvida.test' },
    agents: [
      { name: 'Carlos Andrade', email: 'agente1@hospitalvida.test', departmentNames: ['Cardiologia', 'Recepção'] },
      { name: 'Beatriz Lima', email: 'agente2@hospitalvida.test', departmentNames: ['Enfermagem', 'Recepção'] },
      { name: 'Diego Souza', email: 'agente3@hospitalvida.test', departmentNames: ['Fisioterapia', 'Faturamento', 'Cardiologia'] },
    ],
  },
  {
    name: 'Clínica Reabilitar',
    phoneNumber: '+14155238887',
    departments: ['Recepção', 'Fisioterapia', 'Fonoaudiologia'],
    links: [
      {
        label: 'Paciente Encaminhado',
        kind: 'profile',
        entryCode: 'PACE',
        departmentNames: ['Recepção', 'Fisioterapia', 'Fonoaudiologia'],
      },
    ],
    admin: { name: 'Admin Reabilitar', email: 'admin@reabilitar.test' },
    agents: [
      { name: 'Elisa Prado', email: 'agente1@reabilitar.test', departmentNames: ['Fisioterapia', 'Recepção'] },
      { name: 'Fábio Nunes', email: 'agente2@reabilitar.test', departmentNames: ['Fonoaudiologia', 'Recepção'] },
    ],
  },
];

export async function seed() {
  // limpa tudo em ordem de dependência para o seed ser re-executável
  await prisma.feedback.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.accessAttempt.deleteMany();
  await prisma.externalContact.deleteMany();
  await prisma.entryLinkDepartment.deleteMany();
  await prisma.entryLink.deleteMany();
  await prisma.userDepartment.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
  await prisma.whatsappNumber.deleteMany();
  await prisma.tenant.deleteMany();

  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const lines: string[] = [];

  for (const seed of TENANTS) {
    const tenant = await prisma.tenant.create({
      data: { name: seed.name, csatEnabled: true },
    });

    await prisma.whatsappNumber.create({
      data: {
        tenantId: tenant.id,
        provider: 'twilio',
        phoneNumber: seed.phoneNumber,
        status: 'active',
      },
    });

    const departments = new Map<string, string>();
    for (let i = 0; i < seed.departments.length; i++) {
      const dept = await prisma.department.create({
        data: {
          tenantId: tenant.id,
          name: seed.departments[i],
          menuKey: String(i + 1),
          sortOrder: i + 1,
          active: true,
        },
      });
      departments.set(dept.name, dept.id);
    }

    const admin = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        role: Role.admin,
        name: seed.admin.name,
        email: seed.admin.email,
        passwordHash,
        availability: Availability.available,
      },
    });

    for (const agentSeed of seed.agents) {
      const agent = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          role: Role.agent,
          name: agentSeed.name,
          email: agentSeed.email,
          passwordHash,
          availability: Availability.available,
        },
      });
      for (const deptName of agentSeed.departmentNames) {
        const departmentId = departments.get(deptName);
        if (!departmentId) throw new Error(`setor não encontrado no seed: ${deptName}`);
        await prisma.userDepartment.create({ data: { userId: agent.id, departmentId } });
      }
    }

    lines.push('', `=== ${seed.name} ===`);
    lines.push(`WhatsApp: ${seed.phoneNumber}`);
    lines.push(`Admin:  ${seed.admin.email} / ${PASSWORD}`);
    for (const a of seed.agents) {
      lines.push(`Agente: ${a.email} / ${PASSWORD} (${a.departmentNames.join(', ')})`);
    }

    for (const linkSeed of seed.links) {
      const slug = generateSlug();
      const link = await prisma.entryLink.create({
        data: {
          tenantId: tenant.id,
          slug,
          entryCode: linkSeed.entryCode,
          kind: linkSeed.kind,
          label: linkSeed.label,
          holderNote: linkSeed.holderNote,
          prefillText: buildPrefillText(linkSeed.entryCode),
          createdByUserId: admin.id,
        },
      });
      for (const deptName of linkSeed.departmentNames) {
        const departmentId = departments.get(deptName);
        if (!departmentId) throw new Error(`setor não encontrado no seed: ${deptName}`);
        await prisma.entryLinkDepartment.create({
          data: { entryLinkId: link.id, departmentId },
        });
      }
      lines.push(
        `Link ${linkSeed.kind.padEnd(7)} [${linkSeed.entryCode}] "${linkSeed.label}" → ` +
          `${BASE_URL}/c/${slug} (${linkSeed.departmentNames.join(', ')})`
      );
    }
  }

  console.log(lines.join('\n'));
  console.log('\nSeed concluído.');
}

// `npm run seed` executa este arquivo direto; em produção quem chama é o
// seed-if-empty.ts, que precisa da função exportada e do controle do disconnect.
if (require.main === module) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
