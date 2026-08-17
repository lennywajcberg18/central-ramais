// Diagnóstico: duas pessoas de fora escrevem ao mesmo tempo, para o mesmo setor.
// A distribuição tem que dar uma conversa para cada atendente de plantão.
//
// Sem serializar a escolha por setor, as duas atribuições liam a mesma "última
// atribuição" e escolhiam o mesmo atendente — um ficava com as duas conversas.
// Rode depois de mexer em routing.service.ts:
//
//   npx tsx scripts/check-distribuicao-concorrente.ts
//
// Cuidado: mexe na escala do agente3 e cria contatos de teste no banco local.
import '../src/config';
import { prisma } from '../src/prisma';
import { tryAssign } from '../src/services/routing.service';
import { openShiftForUser } from '../src/services/shift.service';

const RODADAS = 6;

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { name: 'Hospital Vida' } });
  const tenantId = tenant.id;
  const cardiologia = await prisma.department.findFirstOrThrow({
    where: { tenantId, name: 'Cardiologia' },
  });
  const numero = await prisma.whatsappNumber.findFirstOrThrow({ where: { tenantId } });
  const link = await prisma.entryLink.findFirstOrThrow({ where: { tenantId, entryCode: 'MEDX' } });

  // os dois atendentes da Cardiologia, ambos de plantão e disponíveis
  const carlos = await prisma.user.findFirstOrThrow({
    where: { email: 'agente1@hospitalvida.test' },
  });
  const diego = await prisma.user.findFirstOrThrow({
    where: { email: 'agente3@hospitalvida.test' },
  });
  await prisma.shift.deleteMany({ where: { userId: diego.id } });
  await prisma.shift.createMany({
    data: Array.from({ length: 7 }, (_, weekday) => ({
      tenantId,
      userId: diego.id,
      weekday,
      startMinute: 0,
      endMinute: 1440,
    })),
  });
  await prisma.shiftSession.deleteMany({ where: { userId: { in: [carlos.id, diego.id] } } });
  await openShiftForUser(tenantId, carlos.id);
  await openShiftForUser(tenantId, diego.id);

  let rodadasComEmpate = 0;

  for (let rodada = 1; rodada <= RODADAS; rodada++) {
    // duas conversas novas esperando na fila da Cardiologia
    const criadas = [];
    for (const sufixo of ['a', 'b']) {
      const contato = await prisma.externalContact.create({
        data: { tenantId, waNumber: `+55119999${rodada}${sufixo === 'a' ? 1 : 2}00`, entryLinkId: link.id },
      });
      criadas.push(
        await prisma.conversation.create({
          data: {
            tenantId,
            whatsappNumberId: numero.id,
            externalContactId: contato.id,
            entryLinkId: link.id,
            entryLinkLabelSnapshot: link.label,
            departmentId: cardiologia.id,
            status: 'open',
          },
        })
      );
    }

    // as duas chegam ao mesmo tempo — é o que o webhook faz com contatos diferentes
    await Promise.all(criadas.map((c) => tryAssign(tenantId, c.id)));

    const depois = await prisma.conversation.findMany({
      where: { id: { in: criadas.map((c) => c.id) } },
      include: { assignedUser: { select: { name: true } } },
    });
    const donos = depois.map((c) => c.assignedUser?.name ?? '(ninguém)');
    const empatou = donos[0] === donos[1];
    if (empatou) rodadasComEmpate++;
    console.log(
      `  rodada ${rodada}: ${donos[0]} / ${donos[1]} ${empatou ? '  <-- as duas na mesma pessoa' : ''}`
    );

    await prisma.conversation.deleteMany({ where: { id: { in: criadas.map((c) => c.id) } } });
    await prisma.externalContact.deleteMany({
      where: { id: { in: criadas.map((c) => c.externalContactId) } },
    });
  }

  console.log('');
  console.log(`rodadas em que as duas caíram na mesma pessoa: ${rodadasComEmpate} de ${RODADAS}`);
  console.log(rodadasComEmpate === 0 ? 'RESULTADO: PASSOU' : 'RESULTADO: FALHOU');

  await prisma.$disconnect();
  process.exit(rodadasComEmpate === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
