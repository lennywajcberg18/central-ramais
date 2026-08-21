// Prova que o rodízio sobrevive a MAIS DE UM PROCESSO.
//
// A suíte de corridas roda tudo num processo só, então ela passava mesmo quando a
// única proteção era a fila em memória. Este check é o que separa as duas coisas:
// dois processos Node de verdade, cada um atribuindo a sua conversa no mesmo
// setor, no mesmo instante. Com trava em memória as duas caem na mesma pessoa —
// é o bug que o dono do projeto reportou, agora em escala de instância.
//
//   npx tsx scripts/check-rodizio-multiprocesso.ts
//
// Cuidado: mexe na escala dos dois atendentes da Cardiologia e restaura no fim.
import '../src/config';
import { fork } from 'node:child_process';
import path from 'node:path';
import { prisma } from '../src/prisma';
import { openShiftForUser } from '../src/services/shift.service';
import { recusarSeEnvioForReal } from './guarda';

recusarSeEnvioForReal('check-rodizio-multiprocesso');

const RODADAS = 6;

// modo filho: recebe o id da conversa, atribui e devolve o dono
if (process.env.FILHO_CONVERSA) {
  (async () => {
    const { tryAssign } = await import('../src/services/routing.service');
    const id = process.env.FILHO_CONVERSA!;
    const tenantId = process.env.FILHO_TENANT!;
    try {
      await tryAssign(tenantId, id);
    } catch (err) {
      console.error('[filho] falhou:', err);
    }
    await prisma.$disconnect();
    process.exit(0);
  })();
} else {
  main();
}

function rodarFilho(tenantId: string, conversaId: string): Promise<void> {
  return new Promise((resolve) => {
    const f = fork(path.join(__dirname, 'check-rodizio-multiprocesso.ts'), [], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, FILHO_CONVERSA: conversaId, FILHO_TENANT: tenantId },
      stdio: 'ignore',
    });
    f.on('exit', () => resolve());
  });
}

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { name: 'Hospital Vida' } });
  const tenantId = tenant.id;
  const numero = await prisma.whatsappNumber.findFirstOrThrow({ where: { tenantId } });
  const link = await prisma.entryLink.findFirstOrThrow({ where: { tenantId, entryCode: 'MEDX' } });
  const cardio = await prisma.department.findFirstOrThrow({ where: { tenantId, name: 'Cardiologia' } });
  const carlos = await prisma.user.findFirstOrThrow({ where: { tenantId, email: 'agente1@hospitalvida.test' } });
  const diego = await prisma.user.findFirstOrThrow({ where: { tenantId, email: 'agente3@hospitalvida.test' } });
  const envolvidos = [carlos.id, diego.id];

  const escalaOriginal = await prisma.shift.findMany({ where: { tenantId, userId: { in: envolvidos } } });
  const dispOriginal = await prisma.user.findMany({
    where: { tenantId, id: { in: envolvidos } },
    select: { id: true, availability: true },
  });

  let empates = 0;
  try {
    // Escala integral em TODOS os setores de cada um: a escala é por setor, e
    // cobrir só um tiraria o rodízio dos demais do ar durante o check.
    const setores = await prisma.userDepartment.findMany({
      where: { userId: { in: envolvidos }, department: { tenantId } },
      select: { userId: true, departmentId: true },
    });
    await prisma.shift.deleteMany({ where: { tenantId, userId: { in: envolvidos } } });
    await prisma.shift.createMany({
      data: setores.flatMap(({ userId, departmentId }) =>
        Array.from({ length: 7 }, (_, weekday) => ({
          tenantId,
          userId,
          departmentId,
          weekday,
          startMinute: 0,
          endMinute: 1440,
        }))
      ),
    });
    await prisma.shiftSession.deleteMany({ where: { tenantId, userId: { in: envolvidos } } });
    await openShiftForUser(tenantId, carlos.id);
    await openShiftForUser(tenantId, diego.id);
    // só os dois da Cardiologia no rodízio
    await prisma.user.updateMany({
      where: { tenantId, role: 'agent', id: { notIn: envolvidos } },
      data: { availability: 'offline' },
    });

    for (let r = 1; r <= RODADAS; r++) {
      const criadas = [];
      for (const sufixo of ['a', 'b']) {
        const waNumber = `+5521888${r}${sufixo === 'a' ? 1 : 2}00`;
        await prisma.conversation.deleteMany({ where: { tenantId, externalContact: { waNumber } } });
        await prisma.externalContact.deleteMany({ where: { tenantId, waNumber } });
        const contato = await prisma.externalContact.create({
          data: { tenantId, waNumber, entryLinkId: link.id },
        });
        criadas.push(
          await prisma.conversation.create({
            data: {
              tenantId,
              whatsappNumberId: numero.id,
              externalContactId: contato.id,
              entryLinkId: link.id,
              entryLinkLabelSnapshot: link.label,
              departmentId: cardio.id,
              status: 'open',
            },
          })
        );
      }

      // DOIS PROCESSOS separados, ao mesmo tempo
      await Promise.all(criadas.map((c) => rodarFilho(tenantId, c.id)));

      const depois = await prisma.conversation.findMany({
        where: { tenantId, id: { in: criadas.map((c) => c.id) } },
        include: { assignedUser: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const donos = depois.map((c) => c.assignedUser?.name ?? '(ninguém)');
      const ruim = donos[0] === donos[1] || donos.includes('(ninguém)');
      if (ruim) empates++;
      console.log(`  rodada ${r}: ${donos[0]} / ${donos[1]}${ruim ? '  <-- PROBLEMA' : ''}`);

      for (const c of criadas) {
        await prisma.message.deleteMany({ where: { conversationId: c.id } });
      }
      await prisma.conversation.deleteMany({ where: { tenantId, id: { in: criadas.map((c) => c.id) } } });
      await prisma.externalContact.deleteMany({
        where: { tenantId, id: { in: criadas.map((c) => c.externalContactId) } },
      });
    }
  } finally {
    await prisma.shift.deleteMany({ where: { tenantId, userId: { in: envolvidos } } });
    if (escalaOriginal.length > 0) await prisma.shift.createMany({ data: escalaOriginal });
    await prisma.shiftSession.deleteMany({ where: { tenantId, userId: { in: envolvidos } } });
    for (const u of dispOriginal) {
      await prisma.user.updateMany({ where: { tenantId, id: u.id }, data: { availability: u.availability } });
    }
  }

  console.log('');
  console.log(`rodadas com problema: ${empates} de ${RODADAS}`);
  console.log(empates === 0 ? 'RESULTADO: PASSOU' : 'RESULTADO: FALHOU');
  await prisma.$disconnect();
  process.exit(empates === 0 ? 0 : 1);
}
