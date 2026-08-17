// Diagnóstico: duas pessoas de fora escrevem ao mesmo tempo, para o mesmo setor.
// A distribuição tem que dar uma conversa para cada atendente de plantão.
//
// Sem serializar a escolha por setor, as duas atribuições liam a mesma "última
// atribuição" e escolhiam o mesmo atendente — um ficava com as duas conversas.
// Rode depois de mexer em routing.service.ts:
//
//   npx tsx scripts/check-distribuicao-concorrente.ts
//
// Cuidado: cria contatos de teste no banco local e mexe na escala, na
// disponibilidade e nos plantões do agente1 e do agente3 — tudo devolvido ao
// estado anterior no fim, inclusive quando o script estoura no meio.
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
    where: { tenantId, email: 'agente1@hospitalvida.test' },
  });
  const diego = await prisma.user.findFirstOrThrow({
    where: { tenantId, email: 'agente3@hospitalvida.test' },
  });

  // O check precisa dos dois de plantão agora, então sobrescreve a escala do
  // diego por 24/7 e derruba as sessões dos dois. Sem devolver isso no fim, o
  // plantão noturno dele nunca mais volta e ele fica de plantão o tempo todo na
  // demonstração seguinte — sem ninguém ter mexido no painel.
  const envolvidos = [carlos.id, diego.id];
  const escalaOriginal = await prisma.shift.findMany({
    where: { tenantId, userId: { in: envolvidos } },
  });
  const sessoesOriginais = await prisma.shiftSession.findMany({
    where: { tenantId, userId: { in: envolvidos } },
  });
  const disponibilidadeOriginal = await prisma.user.findMany({
    where: { tenantId, id: { in: envolvidos } },
    select: { id: true, availability: true },
  });

  async function restaurarPlantoes() {
    await prisma.shift.deleteMany({ where: { tenantId, userId: { in: envolvidos } } });
    if (escalaOriginal.length > 0) {
      await prisma.shift.createMany({ data: escalaOriginal });
    }
    await prisma.shiftSession.deleteMany({ where: { tenantId, userId: { in: envolvidos } } });
    if (sessoesOriginais.length > 0) {
      await prisma.shiftSession.createMany({ data: sessoesOriginais });
    }
    for (const u of disponibilidadeOriginal) {
      await prisma.user.updateMany({
        where: { tenantId, id: u.id },
        data: { availability: u.availability },
      });
    }
  }

  let rodadasComProblema = 0;

  // O preparo já é destrutivo, então entra no try junto com as rodadas: falhar
  // ao abrir o plantão depois de reescrever a escala não pode deixar o estrago.
  try {
    await prisma.shift.deleteMany({ where: { tenantId, userId: diego.id } });
    await prisma.shift.createMany({
      data: Array.from({ length: 7 }, (_, weekday) => ({
        tenantId,
        userId: diego.id,
        weekday,
        startMinute: 0,
        endMinute: 1440,
      })),
    });
    await prisma.shiftSession.deleteMany({ where: { tenantId, userId: { in: envolvidos } } });
    await openShiftForUser(tenantId, carlos.id);
    await openShiftForUser(tenantId, diego.id);

    for (let rodada = 1; rodada <= RODADAS; rodada++) {
      // duas conversas novas esperando na fila da Cardiologia
      const criadas = [];
      for (const sufixo of ['a', 'b']) {
        const contato = await prisma.externalContact.create({
          data: {
            tenantId,
            waNumber: `+55119999${rodada}${sufixo === 'a' ? 1 : 2}00`,
            entryLinkId: link.id,
          },
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

      // ordem fixa: sem orderBy, donos[0] e donos[1] saem na ordem que o banco
      // quiser e a linha impressa não corresponde às conversas 'a' e 'b'
      const depois = await prisma.conversation.findMany({
        where: { tenantId, id: { in: criadas.map((c) => c.id) } },
        include: { assignedUser: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const donos = depois.map((c) => c.assignedUser?.name ?? '(ninguém)');
      const semDono = donos.filter((d) => d === '(ninguém)').length;
      const distintos = new Set(donos).size;
      // "não repetiu" não prova que distribuiu: se o rodízio descartar uma das
      // atribuições, a segunda conversa fica órfã em `open` e os donos também
      // ficam diferentes. Conversa sem dono é pior que empate — é o externo
      // esperando na fila sem ninguém saber que ele existe.
      const ok = donos.length === criadas.length && semDono === 0 && distintos === criadas.length;
      if (!ok) rodadasComProblema++;
      console.log(
        `  rodada ${rodada}: ${donos.join(' / ')}` +
          (ok ? '' : semDono > 0 ? '  <-- conversa sem dono' : '  <-- as duas na mesma pessoa')
      );

      await prisma.conversation.deleteMany({
        where: { tenantId, id: { in: criadas.map((c) => c.id) } },
      });
      await prisma.externalContact.deleteMany({
        where: { tenantId, id: { in: criadas.map((c) => c.externalContactId) } },
      });
    }
  } finally {
    // No finally: uma rodada que estoure deixa o diego 24/7 do mesmo jeito.
    await restaurarPlantoes();
  }

  console.log('');
  console.log(
    `rodadas com problema (empate ou conversa sem dono): ${rodadasComProblema} de ${RODADAS}`
  );
  console.log(rodadasComProblema === 0 ? 'RESULTADO: PASSOU' : 'RESULTADO: FALHOU');

  await prisma.$disconnect();
  process.exit(rodadasComProblema === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
