// Prova que o plantão vale POR SETOR, e não para todos os setores da pessoa.
//
// Antes desta mudança, `availableAgentsForDepartment` casava qualquer sessão
// aberta com qualquer setor da pessoa: quem estava escalada só no CT recebia
// chamado da Recepção também. Os dois cenários abaixo falhavam.
//
//   npx tsx scripts/check-plantao-por-setor.ts
//
// Cuidado: mexe na escala e no plantão do agente1 e devolve tudo no fim.
import '../src/config';
import { prisma } from '../src/prisma';
import * as users from '../src/repositories/users';
import * as conversations from '../src/repositories/conversations';
import {
  endShift,
  expireDueShifts,
  openShiftForUser,
  replaceSchedule,
} from '../src/services/shift.service';
import { localNow } from '../src/utils/shiftClock';
import { recusarSeEnvioForReal } from './guarda';

recusarSeEnvioForReal('check-plantao-por-setor');

// O relógio do hospital, não o do processo: a escala é cadastrada em minutos do
// fuso do tenant, e montar as faixas do teste em UTC faria o check passar de
// manhã e falhar à noite.
function localAgora(timezone: string): { weekday: number; minuto: number } {
  const n = localNow(timezone);
  return { weekday: n.weekday, minuto: n.minuteOfDay };
}

const falhas: string[] = [];
function checar(nome: string, ok: boolean, detalhe = '') {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'}  ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(nome);
}

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { name: 'Hospital Vida' } });
  const tenantId = tenant.id;
  const cardio = await prisma.department.findFirstOrThrow({ where: { tenantId, name: 'Cardiologia' } });
  const recepcao = await prisma.department.findFirstOrThrow({ where: { tenantId, name: 'Recepção' } });
  const numero = await prisma.whatsappNumber.findFirstOrThrow({ where: { tenantId } });
  const link = await prisma.entryLink.findFirstOrThrow({ where: { tenantId, entryCode: 'MEDX' } });
  // O carlos está nos DOIS setores: é o caso que só se distingue com cobertura.
  const carlos = await prisma.user.findFirstOrThrow({
    where: { tenantId, email: 'agente1@hospitalvida.test' },
  });

  const escalaOriginal = await prisma.shift.findMany({ where: { tenantId, userId: carlos.id } });
  // A disponibilidade de TODO MUNDO, não só a do carlos: o preparo derruba os
  // colegas para a resposta não depender deles, e deixar o time offline no fim
  // envenena os outros checks e a demonstração seguinte sem ninguém perceber.
  const dispOriginal = await prisma.user.findMany({
    where: { tenantId, role: 'agent' },
    select: { id: true, availability: true },
  });

  try {
    // Deixa só o carlos disponível, para a resposta não depender dos colegas.
    await prisma.user.updateMany({
      where: { tenantId, role: 'agent', id: { not: carlos.id } },
      data: { availability: 'offline' },
    });
    await endShift(tenantId, carlos.id, 'admin');

    // ---- Cenário 1: escalado SÓ na Cardiologia, membro dos dois ----
    console.log('\n1) escalado só na Cardiologia, mas membro de Cardiologia e Recepção');
    await replaceSchedule(
      tenantId,
      carlos.id,
      Array.from({ length: 7 }, (_, weekday) => ({
        departmentId: cardio.id,
        weekday,
        startMinute: 0,
        endMinute: 1440,
      }))
    );
    const entrou = await openShiftForUser(tenantId, carlos.id);
    checar('entra de plantão', entrou.ok);

    const naCardio = await users.availableAgentsForDepartment(tenantId, cardio.id);
    const naRecepcao = await users.availableAgentsForDepartment(tenantId, recepcao.id);
    checar('recebe da Cardiologia', naCardio.some((u) => u.id === carlos.id));
    checar(
      'NÃO recebe da Recepção',
      !naRecepcao.some((u) => u.id === carlos.id),
      naRecepcao.length > 0 ? 'apareceu na lista da Recepção' : ''
    );

    // ---- Cenário 2: perder um setor solta só as conversas dele ----
    console.log('\n2) sair de um setor devolve só as conversas daquele setor');
    await replaceSchedule(
      tenantId,
      carlos.id,
      [cardio.id, recepcao.id].flatMap((departmentId) =>
        Array.from({ length: 7 }, (_, weekday) => ({
          departmentId,
          weekday,
          startMinute: 0,
          endMinute: 1440,
        }))
      )
    );
    await endShift(tenantId, carlos.id, 'admin');
    await prisma.user.updateMany({ where: { tenantId, id: carlos.id }, data: { availability: 'available' } });
    await openShiftForUser(tenantId, carlos.id);

    const criadas: Record<string, string> = {};
    for (const [rotulo, dept] of [['cardio', cardio], ['recepcao', recepcao]] as const) {
      const waNumber = `+5521555${rotulo === 'cardio' ? '0001' : '0002'}`;
      await prisma.conversation.deleteMany({ where: { tenantId, externalContact: { waNumber } } });
      await prisma.externalContact.deleteMany({ where: { tenantId, waNumber } });
      const contato = await prisma.externalContact.create({
        data: { tenantId, waNumber, entryLinkId: link.id, simulated: true },
      });
      const c = await prisma.conversation.create({
        data: {
          tenantId,
          whatsappNumberId: numero.id,
          externalContactId: contato.id,
          entryLinkId: link.id,
          entryLinkLabelSnapshot: link.label,
          departmentId: dept.id,
          status: 'assigned',
          assignedUserId: carlos.id,
          assignedAt: new Date(),
          firstAssignedAt: new Date(),
        },
      });
      criadas[rotulo] = c.id;
    }

    // admin tira a Cardiologia da escala dele; a Recepção continua
    await replaceSchedule(
      tenantId,
      carlos.id,
      Array.from({ length: 7 }, (_, weekday) => ({
        departmentId: recepcao.id,
        weekday,
        startMinute: 0,
        endMinute: 1440,
      }))
    );

    const depois = await prisma.conversation.findMany({
      where: { tenantId, id: { in: Object.values(criadas) } },
      select: { id: true, status: true, assignedUserId: true, departmentId: true },
    });
    const daCardio = depois.find((c) => c.id === criadas.cardio)!;
    const daRecepcao = depois.find((c) => c.id === criadas.recepcao)!;
    checar('conversa da Cardiologia voltou para a fila', daCardio.assignedUserId === null, daCardio.status);
    checar(
      'conversa da Recepção CONTINUA com ele',
      daRecepcao.assignedUserId === carlos.id,
      daRecepcao.status
    );

    const aindaCardio = await users.availableAgentsForDepartment(tenantId, cardio.id);
    const aindaRecepcao = await users.availableAgentsForDepartment(tenantId, recepcao.id);
    checar('parou de receber da Cardiologia', !aindaCardio.some((u) => u.id === carlos.id));
    checar('continua recebendo da Recepção', aindaRecepcao.some((u) => u.id === carlos.id));

    // ---- Cenário 3: passagem de um setor para o outro no mesmo turno ----
    // Cardiologia agora, Recepção começando quando a Cardiologia acaba. O
    // plantão tem que ir até o fim da RECEPÇÃO, não até o fim da Cardiologia:
    // encerrar na emenda derrubaria a pessoa no meio do turno e devolveria as
    // conversas dela para a fila.
    console.log('\n3) passagem de setor no mesmo turno não encerra o plantão na emenda');
    const agora = localAgora(tenant.timezone);
    const inicioCardio = (agora.minuto - 60 + 1440) % 1440;
    const trocaAs = (agora.minuto + 60) % 1440;
    const fimRecepcao = (agora.minuto + 180) % 1440;

    await endShift(tenantId, carlos.id, 'admin');
    await replaceSchedule(tenantId, carlos.id, [
      // a faixa pode virar o dia; o relógio do projeto trata end < start assim
      { departmentId: cardio.id, weekday: agora.weekday, startMinute: inicioCardio, endMinute: trocaAs },
      { departmentId: recepcao.id, weekday: agora.weekday, startMinute: trocaAs, endMinute: fimRecepcao },
      // a faixa da Recepção pode cair no dia seguinte se a troca passar da
      // meia-noite; cadastrar nos dois dias evita o falso negativo
      {
        departmentId: recepcao.id,
        weekday: (agora.weekday + 1) % 7,
        startMinute: trocaAs,
        endMinute: fimRecepcao,
      },
    ]);
    await prisma.user.updateMany({
      where: { tenantId, id: carlos.id },
      data: { availability: 'available' },
    });
    const naEmenda = await openShiftForUser(tenantId, carlos.id);
    checar('entra de plantão na emenda', naEmenda.ok);
    if (naEmenda.ok) {
      const faltam = Math.round((naEmenda.session.endsAt.getTime() - Date.now()) / 60000);
      // ~180 min (fim da Recepção), e não ~60 (fim da Cardiologia)
      checar(
        'plantão vai até o fim do SEGUNDO setor',
        faltam > 150 && faltam < 200,
        `faltam ${faltam} min`
      );
      const cob = await prisma.shiftSessionDepartment.findMany({
        where: { tenantId, shiftSessionId: naEmenda.session.id, endedAt: null },
        select: { departmentId: true },
      });
      checar(
        'mas a cobertura AGORA é só da Cardiologia',
        cob.length === 1 && cob[0].departmentId === cardio.id,
        `${cob.length} setor(es)`
      );
    }

    // ---- Cenário 4: escala partida volta a valer sozinha ----
    // O job fecha a cobertura na primeira janela; quando a segunda começa,
    // alguém tem que reabrir. Sem isso a pessoa fica de plantão sem receber
    // nada daquele setor pelo resto do dia.
    console.log('\n4) segunda faixa do dia no mesmo setor volta a valer sozinha');
    if (naEmenda.ok) {
      // simula o que o job faz ao fim da primeira janela
      await prisma.shiftSessionDepartment.updateMany({
        where: { tenantId, shiftSessionId: naEmenda.session.id, departmentId: cardio.id, endedAt: null },
        data: { endedAt: new Date() },
      });
      const semCobertura = await users.availableAgentsForDepartment(tenantId, cardio.id);
      checar(
        'com a cobertura fechada, para de receber',
        !semCobertura.some((u) => u.id === carlos.id)
      );

      await expireDueShifts(new Date());

      const voltou = await users.availableAgentsForDepartment(tenantId, cardio.id);
      checar('a varredura reabre a cobertura e ele volta a receber', voltou.some((u) => u.id === carlos.id));
    }

    for (const id of Object.values(criadas)) {
      const c = await prisma.conversation.findUnique({ where: { id }, select: { externalContactId: true } });
      await prisma.message.deleteMany({ where: { conversationId: id } });
      await prisma.conversation.deleteMany({ where: { tenantId, id } });
      if (c) await prisma.externalContact.deleteMany({ where: { tenantId, id: c.externalContactId } });
    }
  } finally {
    await endShift(tenantId, carlos.id, 'admin');
    await prisma.shift.deleteMany({ where: { tenantId, userId: carlos.id } });
    if (escalaOriginal.length > 0) await prisma.shift.createMany({ data: escalaOriginal });
    for (const u of dispOriginal) {
      await prisma.user.updateMany({
        where: { tenantId, id: u.id },
        data: { availability: u.availability },
      });
    }
  }

  console.log('');
  console.log(falhas.length === 0 ? 'RESULTADO: PASSOU' : `RESULTADO: FALHOU (${falhas.join(', ')})`);
  await prisma.$disconnect();
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
