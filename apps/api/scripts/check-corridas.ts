// Reprodução das corridas que a caça de 17/08/2026 encontrou.
//
// Cada teste faz duas coisas acontecerem ao mesmo tempo — como o Twilio, o job de
// inatividade e dois atendentes fazem em produção — e confere o estado que ficou.
// Todos falhavam antes das guardas de estado; rode depois de mexer em qualquer
// transição de conversa, plantão ou posse de link:
//
//   npm run check:corridas -w api
//
// Cuidado: cria contatos e links de teste no banco local. Os cenários 7 a 10
// mexem na escala, na disponibilidade e nos plantões dos atendentes, e devolvem
// tudo ao estado anterior no fim — inclusive quando o script estoura no meio.
// O cenário 10 roda a varredura de plantão de verdade, que é por tenant nenhum:
// ela encerra as sessões vencidas de TODOS os hospitais do banco — exatamente o
// que o job do servidor já faz a cada 60 s.
// Não rode contra o banco de produção.
import '../src/config';
import { prisma } from '../src/prisma';
import { closeWithCsat } from '../src/services/lifecycle.service';
import { transferConversation } from '../src/services/transfer.service';
import { handleInbound } from '../src/services/webhook.service';
import {
  endShift,
  expireDueShifts,
  openShiftForUser,
  replaceSchedule,
} from '../src/services/shift.service';
import { tryAssign } from '../src/services/routing.service';
import { closeConversation } from '../src/services/conversation.service';
import * as externalContacts from '../src/repositories/externalContacts';
import { recusarSeEnvioForReal } from './guarda';

recusarSeEnvioForReal('check-corridas');

const RODADAS = 6;

interface Cenario {
  nome: string;
  falhas: number;
  total: number;
}

const resultados: Cenario[] = [];

function registrar(nome: string, falhas: number, total: number) {
  resultados.push({ nome, falhas, total });
  const marca = falhas === 0 ? 'PASSOU' : 'FALHOU';
  console.log(`  => ${marca}: ${falhas} de ${total} rodadas com problema\n`);
}

// escala integral, para o atendente poder entrar de plantão a qualquer hora
async function escalaIntegral(tenantId: string, userId: string) {
  await prisma.shift.deleteMany({ where: { tenantId, userId } });
  await prisma.shift.createMany({
    data: Array.from({ length: 7 }, (_, weekday) => ({
      tenantId,
      userId,
      weekday,
      startMinute: 0,
      endMinute: 1440,
    })),
  });
}

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { name: 'Hospital Vida' } });
  const tenantId = tenant.id;
  const numero = await prisma.whatsappNumber.findFirstOrThrow({ where: { tenantId } });
  const medx = await prisma.entryLink.findFirstOrThrow({ where: { tenantId, entryCode: 'MEDX' } });
  const cardiologia = await prisma.department.findFirstOrThrow({
    where: { tenantId, name: 'Cardiologia' },
  });
  const enfermagem = await prisma.department.findFirstOrThrow({
    where: { tenantId, name: 'Enfermagem' },
  });
  const carlos = await prisma.user.findFirstOrThrow({
    where: { tenantId, email: 'agente1@hospitalvida.test' },
  });
  const beatriz = await prisma.user.findFirstOrThrow({
    where: { tenantId, email: 'agente2@hospitalvida.test' },
  });

  // Uma execução que estoura no meio deixa o contato da rodada para trás, e a
  // execução seguinte morre no UNIQUE (tenant_id, wa_number) antes de testar
  // qualquer coisa. Limpar por PREFIXO levaria junto os contatos que o dono
  // criou brincando no simulador — então apaga-se o número exato, e só ele.
  async function garantirNumeroLivre(waNumber: string): Promise<void> {
    const antigo = await prisma.externalContact.findFirst({
      where: { tenantId, waNumber },
      select: { id: true },
    });
    if (!antigo) return;
    const convs = await prisma.conversation.findMany({
      where: { tenantId, externalContactId: antigo.id },
      select: { id: true },
    });
    for (const c of convs) await limpar(c.id, antigo.id);
    await prisma.externalContact.deleteMany({ where: { tenantId, id: antigo.id } });
  }

  // cria contato + conversa já no estado pedido, sem passar pelo webhook.
  //
  // `assigned` nasce com `firstReplyAt` preenchido porque, desde a correção do
  // CSAT, encerrar só pergunta a nota quando alguém do hospital de fato
  // respondeu. Sem esta marca os cenários de encerramento duplo não teriam nota
  // nenhuma para duplicar — passariam sem exercitar a corrida que existem para
  // pegar.
  async function conversaEm(status: 'assigned' | 'awaiting_department' | 'open', sufixo: string) {
    const waNumber = `+5521${sufixo}`;
    await garantirNumeroLivre(waNumber);
    const contato = await prisma.externalContact.create({
      data: { tenantId, waNumber, entryLinkId: medx.id },
    });
    const conversa = await prisma.conversation.create({
      data: {
        tenantId,
        whatsappNumberId: numero.id,
        externalContactId: contato.id,
        entryLinkId: medx.id,
        entryLinkLabelSnapshot: medx.label,
        departmentId: status === 'awaiting_department' ? null : cardiologia.id,
        assignedUserId: status === 'assigned' ? carlos.id : null,
        assignedAt: status === 'assigned' ? new Date() : null,
        firstAssignedAt: status === 'assigned' ? new Date() : null,
        firstReplyAt: status === 'assigned' ? new Date() : null,
        status,
      },
    });
    return { contato, conversa };
  }

  // Limpa pelo CONTATO, não pela conversa: vários cenários acabam com o externo
  // tendo mais de uma conversa (a mensagem que chega depois de um encerramento
  // abre conversa nova, por desenho). Apagar só a conversa conhecida deixava a
  // segunda presa na FK e derrubava a suíte no meio.
  //
  // messages e feedback não têm tenant_id próprio; o filtro vem pela conversa,
  // como em repositories/messages.ts
  async function limpar(_conversaId: string, contatoId: string) {
    const doContato = { tenantId, externalContactId: contatoId };
    await prisma.message.deleteMany({ where: { conversation: doContato } });
    await prisma.feedback.deleteMany({ where: { conversation: doContato } });
    await prisma.conversation.deleteMany({ where: doContato });
    await prisma.externalContact.deleteMany({ where: { tenantId, id: contatoId } });
  }

  // O job de inatividade não encerra qualquer conversa: ele varre só
  // `assigned | awaiting_department | awaiting_menu_confirm` paradas há mais de 30
  // min (listStaleForTimeout). Chamar `closeWithCsat` direto pularia os dois
  // filtros e cobraria do produto uma garantia que a produção não precisa dar —
  // depois de um encaminhamento a conversa fica `open` e com `lastMessageAt`
  // recém-tocado pelo aviso ao externo, fora do alcance do job por meia hora.
  // A corrida continua exercitada: o encaminhamento pode entrar entre a leitura
  // aqui e a escrita lá dentro.
  const STATUS_DO_JOB = ['assigned', 'awaiting_department', 'awaiting_menu_confirm'];
  async function varreduraDoJob(conversaId: string): Promise<void> {
    const atual = await prisma.conversation.findFirst({
      where: { tenantId, id: conversaId },
      select: { status: true },
    });
    if (!atual || !STATUS_DO_JOB.includes(atual.status)) return;
    await closeWithCsat(tenantId, conversaId, 'timeout');
  }

  // ---------------------------------------------------------------- 1
  console.log('1) encerramento duplo: botão do atendente x job de inatividade');
  console.log('   (o externo recebia a pergunta de nota duas vezes)');
  let falhas = 0;
  for (let r = 1; r <= RODADAS; r++) {
    const { conversa, contato } = await conversaEm('assigned', `9001${r}00`);
    await Promise.all([
      closeWithCsat(tenantId, conversa.id, 'agent_closed'),
      closeWithCsat(tenantId, conversa.id, 'timeout'),
    ]);
    const perguntas = await prisma.message.count({
      where: {
        conversationId: conversa.id,
        conversation: { tenantId },
        senderType: 'system',
        direction: 'outbound',
      },
    });
    // exatamente uma: zero significaria que a guarda barrou os DOIS caminhos
    if (perguntas !== 1) falhas++;
    console.log(
      `  rodada ${r}: perguntas de nota enviadas = ${perguntas}` +
        `${perguntas > 1 ? '  <-- DUPLICADA' : perguntas === 0 ? '  <-- NENHUMA' : ''}`
    );
    await limpar(conversa.id, contato.id);
  }
  registrar('encerramento duplo (CSAT em dobro)', falhas, RODADAS);

  // ---------------------------------------------------------------- 2
  console.log('2) encaminhar x job de inatividade');
  console.log('   (a conversa ia para a Enfermagem já morta — ninguém a via)');
  falhas = 0;
  for (let r = 1; r <= RODADAS; r++) {
    const { conversa, contato } = await conversaEm('assigned', `9002${r}00`);
    // o job entra com um respiro crescente: sem isso ele vence sempre e o teste
    // nunca exercita a ordem em que o encaminhamento chega primeiro
    const [encaminhou] = await Promise.all([
      transferConversation(tenantId, conversa.id, enfermagem.id, carlos.id).then(
        () => true,
        () => false
      ),
      new Promise<void>((ok) => setTimeout(ok, r)).then(() =>
        varreduraDoJob(conversa.id)
      ),
    ]);
    const depois = await prisma.conversation.findFirstOrThrow({
      where: { tenantId, id: conversa.id },
    });
    // zumbi = o encaminhamento foi aceito E a conversa acabou encerrada
    const zumbi =
      encaminhou && (depois.status === 'awaiting_feedback' || depois.status === 'closed');
    if (zumbi) falhas++;
    console.log(
      `  rodada ${r}: encaminhou=${encaminhou ? 'sim' : 'não'} status=${depois.status}` +
        ` setor=${depois.departmentId === enfermagem.id ? 'Enfermagem' : 'Cardiologia'}` +
        `${zumbi ? '  <-- ZUMBI' : ''}`
    );
    await limpar(conversa.id, contato.id);
  }
  registrar('encaminhar x encerrar (conversa zumbi)', falhas, RODADAS);

  // ---------------------------------------------------------------- 3
  console.log('3) dois atendentes encaminhando a mesma conversa ao mesmo tempo');
  console.log('   (o externo recebia dois avisos de setor contraditórios)');
  falhas = 0;
  for (let r = 1; r <= RODADAS; r++) {
    const { conversa, contato } = await conversaEm('assigned', `9003${r}00`);
    const recepcao = await prisma.department.findFirstOrThrow({
      where: { tenantId, name: 'Recepção' },
    });
    const aceitos = (
      await Promise.all([
        transferConversation(tenantId, conversa.id, enfermagem.id, carlos.id).then(
          () => 1,
          () => 0
        ),
        transferConversation(tenantId, conversa.id, recepcao.id, beatriz.id).then(
          () => 1,
          () => 0
        ),
      ])
    ).reduce((a, b) => a + b, 0);
    const avisos = await prisma.message.count({
      where: {
        conversationId: conversa.id,
        conversation: { tenantId },
        senderType: 'system',
        body: { contains: 'encaminhado' },
      },
    });
    // exatamente um: zero significaria que ninguém conseguiu encaminhar
    if (avisos !== 1) falhas++;
    console.log(
      `  rodada ${r}: encaminhamentos aceitos=${aceitos} avisos ao externo=${avisos}` +
        `${avisos > 1 ? '  <-- DOIS AVISOS' : avisos === 0 ? '  <-- NENHUM' : ''}`
    );
    await limpar(conversa.id, contato.id);
  }
  registrar('encaminhamento duplo (dois avisos)', falhas, RODADAS);

  // ---------------------------------------------------------------- 4
  console.log('4) escolha do setor no menu x job de inatividade');
  console.log('   (a conversa ressuscitava com closed_at e close_reason gravados)');
  falhas = 0;
  for (let r = 1; r <= RODADAS; r++) {
    await garantirNumeroLivre(`+55219004${r}00`);
    const contato = await prisma.externalContact.create({
      data: { tenantId, waNumber: `+55219004${r}00`, entryLinkId: medx.id },
    });
    const conversa = await prisma.conversation.create({
      data: {
        tenantId,
        whatsappNumberId: numero.id,
        externalContactId: contato.id,
        entryLinkId: medx.id,
        entryLinkLabelSnapshot: medx.label,
        status: 'awaiting_department',
      },
    });
    await Promise.all([
      handleInbound({
        from: `whatsapp:${contato.waNumber}`,
        to: `whatsapp:${numero.phoneNumber}`,
        body: '1',
        messageSid: `SMcorrida4${r}`,
      }),
      // o mesmo que jobs/timeout.ts chama, com um respiro para varrer a janela
      new Promise<void>((ok) => setTimeout(ok, r * 5)).then(() =>
        closeWithCsat(tenantId, conversa.id, 'timeout')
      ),
    ]);
    const depois = await prisma.conversation.findFirstOrThrow({
      where: { tenantId, id: conversa.id },
    });
    const viva = depois.status === 'open' || depois.status === 'assigned';
    const zumbi = viva && depois.closedAt !== null;
    if (zumbi) falhas++;
    console.log(
      `  rodada ${r}: status=${depois.status} closed_at=${depois.closedAt ? 'sim' : 'não'}` +
        ` close_reason=${depois.closeReason ?? '—'}${zumbi ? '  <-- ZUMBI' : ''}`
    );
    await limpar(conversa.id, contato.id);
  }
  registrar('escolha no menu x encerrar (ressuscita)', falhas, RODADAS);

  // ---------------------------------------------------------------- 5
  console.log('5) dois números novos reivindicando o MESMO link nominal');
  console.log('   (os dois entravam e o alerta de vazamento não era gravado)');
  falhas = 0;
  for (let r = 1; r <= RODADAS; r++) {
    const link = await prisma.entryLink.create({
      data: {
        tenantId,
        kind: 'nominal',
        label: `Teste corrida ${r}`,
        entryCode: `TST${r}`,
        slug: `tst-corrida-${r}`,
        prefillText: `Olá! [TST${r}]`,
        departments: { create: { departmentId: cardiologia.id } },
      },
    });
    const numeros = [`+5521900500${r}1`, `+5521900500${r}2`];
    for (const n of numeros) await garantirNumeroLivre(n);
    await Promise.all(
      numeros.map((n) =>
        handleInbound({
          from: `whatsapp:${n}`,
          to: `whatsapp:${numero.phoneNumber}`,
          body: `Olá! [TST${r}]`,
          messageSid: `SMcorrida5${r}${n.slice(-1)}`,
        })
      )
    );
    const donos = await prisma.externalContact.findMany({ where: { tenantId, entryLinkId: link.id } });
    const alertas = await prisma.accessAttempt.count({
      where: { tenantId, entryCodeTried: `TST${r}`, reason: 'nominal_taken' },
    });
    // um dono e um alerta: dois donos é o vazamento silencioso, zero donos
    // significaria que a guarda barrou os dois e ninguém entrou
    if (donos.length !== 1 || alertas !== 1) falhas++;
    console.log(
      `  rodada ${r}: donos do link nominal=${donos.length} alertas nominal_taken=${alertas}` +
        `${donos.length > 1 ? '  <-- DOIS DONOS' : donos.length === 0 ? '  <-- NINGUÉM ENTROU' : ''}`
    );
    const ids = donos.map((d) => d.id);
    const convs = await prisma.conversation.findMany({
      where: { tenantId, externalContactId: { in: ids } },
    });
    for (const c of convs) {
      await prisma.message.deleteMany({
        where: { conversationId: c.id, conversation: { tenantId } },
      });
    }
    await prisma.conversation.deleteMany({ where: { tenantId, externalContactId: { in: ids } } });
    await prisma.externalContact.deleteMany({ where: { tenantId, id: { in: ids } } });
    await prisma.accessAttempt.deleteMany({ where: { tenantId, entryCodeTried: `TST${r}` } });
    await prisma.entryLinkDepartment.deleteMany({
      where: { entryLinkId: link.id, entryLink: { tenantId } },
    });
    await prisma.entryLink.deleteMany({ where: { tenantId, id: link.id } });
  }
  registrar('link nominal com dois donos', falhas, RODADAS);

  // ---------------------------------------------------------------- 6
  console.log('6) bloquear o contato com a mensagem dele em voo');
  console.log('   (sobrava conversa ativa de contato bloqueado, presa na fila)');
  falhas = 0;
  for (let r = 1; r <= RODADAS; r++) {
    await garantirNumeroLivre(`+55219006${r}00`);
    const contato = await prisma.externalContact.create({
      data: { tenantId, waNumber: `+55219006${r}00`, entryLinkId: medx.id },
    });
    await Promise.all([
      handleInbound({
        from: `whatsapp:${contato.waNumber}`,
        to: `whatsapp:${numero.phoneNumber}`,
        body: 'preciso falar com a cardio',
        messageSid: `SMcorrida6${r}`,
      }),
      // o mesmo que a rota do painel faz: marca bloqueado e encerra o que achar
      new Promise<void>((ok) => setTimeout(ok, r)).then(async () => {
        await externalContacts.setBlocked(tenantId, contato.id, true);
        const ativa = await prisma.conversation.findFirst({
          where: {
            tenantId,
            externalContactId: contato.id,
            status: { in: ['awaiting_department', 'open', 'assigned', 'awaiting_menu_confirm'] },
          },
        });
        if (ativa) await closeConversation(tenantId, ativa.id, 'access_revoked');
      }),
    ]);
    const presas = await prisma.conversation.count({
      where: {
        tenantId,
        externalContactId: contato.id,
        status: { in: ['awaiting_department', 'open', 'assigned', 'awaiting_menu_confirm'] },
      },
    });
    if (presas > 0) falhas++;
    console.log(
      `  rodada ${r}: conversas ativas de contato bloqueado=${presas}${presas > 0 ? '  <-- PRESA' : ''}`
    );
    const convs = await prisma.conversation.findMany({
      where: { tenantId, externalContactId: contato.id },
    });
    for (const c of convs) await limpar(c.id, contato.id);
    await prisma.externalContact.deleteMany({ where: { tenantId, id: contato.id } });
  }
  registrar('bloqueio x mensagem em voo', falhas, RODADAS);

  // ------------------------------------------------ estado de plantão (7 a 9)
  // Os cenários abaixo apagam escala, disponibilidade e sessões de plantão do
  // Carlos e da Beatriz para conseguir forçar as corridas. Sem devolver isso no
  // fim, o check imprime PASSOU tendo deixado o atendente sem nenhuma faixa de
  // escala, e o próximo login dele leva 403 "Você ainda não tem escala de
  // plantão cadastrada" — a mesma falha que a migration de escala inicial
  // existe para evitar. Quem roda o check não tem como saber que foi ele.
  const plantonistas = [carlos.id, beatriz.id];
  const escalaOriginal = await prisma.shift.findMany({
    where: { tenantId, userId: { in: plantonistas } },
  });
  const sessoesOriginais = await prisma.shiftSession.findMany({
    where: { tenantId, userId: { in: plantonistas } },
  });
  const disponibilidadeOriginal = await prisma.user.findMany({
    where: { tenantId, role: 'agent' },
    select: { id: true, availability: true },
  });

  async function restaurarPlantoes() {
    await prisma.shift.deleteMany({ where: { tenantId, userId: { in: plantonistas } } });
    if (escalaOriginal.length > 0) {
      await prisma.shift.createMany({ data: escalaOriginal });
    }
    await prisma.shiftSession.deleteMany({ where: { tenantId, userId: { in: plantonistas } } });
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

  try {
    // -------------------------------------------------------------- 7
    console.log('7) login pelo celular e pelo computador ao mesmo tempo');
    console.log('   (abria duas sessões de plantão e o job deixava de devolver as conversas)');
    await escalaIntegral(tenantId, beatriz.id);
    falhas = 0;
    for (let r = 1; r <= RODADAS; r++) {
      await prisma.shiftSession.deleteMany({ where: { tenantId, userId: beatriz.id } });
      await Promise.all([
        openShiftForUser(tenantId, beatriz.id),
        openShiftForUser(tenantId, beatriz.id),
      ]);
      const abertas = await prisma.shiftSession.count({
        where: { tenantId, userId: beatriz.id, endedAt: null },
      });
      if (abertas > 1) falhas++;
      console.log(
        `  rodada ${r}: sessões de plantão abertas=${abertas}${abertas > 1 ? '  <-- DUAS' : ''}`
      );
    }
    registrar('login duplo (duas sessões de plantão)', falhas, RODADAS);

    // -------------------------------------------------------------- 8
    console.log('8) admin salvando a escala no mesmo instante do login');
    console.log('   (a pessoa entrava de plantão com a escala que acabara de sumir)');
    falhas = 0;
    // Controle: sem o admin no meio, o login TEM que abrir plantão. Sem esta
    // rodada, um login que recusasse sempre passaria no teste sem provar nada.
    await escalaIntegral(tenantId, beatriz.id);
    await prisma.shiftSession.deleteMany({ where: { tenantId, userId: beatriz.id } });
    const controle8 = await openShiftForUser(tenantId, beatriz.id);
    console.log(`  controle (sem corrida): login ${controle8.ok ? 'aceito' : 'RECUSADO'}`);
    if (!controle8.ok) falhas++;

    for (let r = 1; r <= RODADAS; r++) {
      await escalaIntegral(tenantId, beatriz.id);
      await prisma.shiftSession.deleteMany({ where: { tenantId, userId: beatriz.id } });
      await Promise.all([
        openShiftForUser(tenantId, beatriz.id),
        // o admin tira a pessoa da escala pelo painel
        replaceSchedule(tenantId, beatriz.id, []),
      ]);
      const faixas = await prisma.shift.count({ where: { tenantId, userId: beatriz.id } });
      const abertas = await prisma.shiftSession.count({
        where: { tenantId, userId: beatriz.id, endedAt: null },
      });
      const orfa = faixas === 0 && abertas > 0;
      if (orfa) falhas++;
      console.log(
        `  rodada ${r}: faixas de escala=${faixas} plantões abertos=${abertas}` +
          `${orfa ? '  <-- DE PLANTÃO SEM ESCALA' : ''}`
      );
    }
    registrar('escala x login (plantão órfão)', falhas, RODADAS);

    // -------------------------------------------------------------- 9
    console.log('9) rodízio entregando a conversa a quem encerra o plantão no mesmo instante');
    console.log('   (a conversa ficava com quem já saiu — fora da fila e fora da tela de todos)');
    await escalaIntegral(tenantId, carlos.id);
    falhas = 0;

    // Controle: com ele de plantão e ninguém saindo, o rodízio TEM que entregar a
    // conversa. Sem isto, um `assignToIfOnShift` que nunca atribuísse — SQL cru com
    // tipo errado, por exemplo — passaria neste teste sem ter fechado nada.
    await prisma.shiftSession.deleteMany({ where: { tenantId, userId: carlos.id } });
    await openShiftForUser(tenantId, carlos.id);
    await prisma.user.updateMany({
      where: { tenantId, id: { not: carlos.id }, role: 'agent' },
      data: { availability: 'offline' },
    });
    const ctrl = await conversaEm('open', '9009000');
    await tryAssign(tenantId, ctrl.conversa.id);
    const ctrlDepois = await prisma.conversation.findFirstOrThrow({
      where: { tenantId, id: ctrl.conversa.id },
    });
    const atribuiu = ctrlDepois.assignedUserId === carlos.id;
    console.log(`  controle (sem corrida): rodízio ${atribuiu ? 'atribuiu' : 'NÃO ATRIBUIU'}`);
    if (!atribuiu) falhas++;
    await limpar(ctrl.conversa.id, ctrl.contato.id);

    for (let r = 1; r <= RODADAS; r++) {
      await prisma.shiftSession.deleteMany({ where: { tenantId, userId: carlos.id } });
      await prisma.user.updateMany({
        where: { tenantId, id: carlos.id },
        data: { availability: 'available' },
      });
      await openShiftForUser(tenantId, carlos.id);
      // só o Carlos elegível: os outros da Cardiologia ficam fora do rodízio
      await prisma.user.updateMany({
        where: { tenantId, id: { not: carlos.id }, role: 'agent' },
        data: { availability: 'offline' },
      });
      const { conversa, contato } = await conversaEm('open', `9009${r}00`);

      await Promise.all([
        tryAssign(tenantId, conversa.id),
        // ele clica em "encerrar plantão" no meio do caminho — pelo caminho real,
        // que é quem devolve as conversas dele para a fila
        new Promise<void>((ok) => setTimeout(ok, r * 4)).then(() =>
          endShift(tenantId, carlos.id, 'manual')
        ),
      ]);

      const depois = await prisma.conversation.findFirstOrThrow({
        where: { tenantId, id: conversa.id },
      });
      const sessaoViva = await prisma.shiftSession.count({
        where: { tenantId, userId: carlos.id, endedAt: null },
      });
      // presa = atribuída a alguém que já não tem plantão aberto
      const presa = depois.assignedUserId !== null && sessaoViva === 0;
      if (presa) falhas++;
      console.log(
        `  rodada ${r}: status=${depois.status} dono=${depois.assignedUserId ? 'Carlos' : '(fila)'}` +
          ` plantão dele=${sessaoViva > 0 ? 'aberto' : 'encerrado'}${presa ? '  <-- ENTREGUE A QUEM SAIU' : ''}`
      );
      await limpar(conversa.id, contato.id);
    }
    registrar('rodízio x fim de plantão (conversa presa)', falhas, RODADAS);

    // -------------------------------------------------------------- 10
    console.log('10) job de plantão varrendo a sessão vencida no mesmo instante do "encerrar plantão"');
    console.log('   (as duas transações trancavam users e shift_sessions em ordens opostas: deadlock 40P01)');
    falhas = 0;

    // O deadlock não estoura nos dois lados igual: o `expireDueShifts` engole o
    // erro por sessão e só loga, enquanto o `endShift` propaga (é o 500 que o
    // atendente vê). Sem espionar o log, metade das vítimas passaria batido.
    const errOriginal = console.error;
    const ehDeadlock = (v: unknown) =>
      `${(v as { code?: string })?.code ?? ''} ${String(v)}`.match(/40P01|deadlock/i) !== null;
    let deadlocksNoJob = 0;
    console.error = (...args: unknown[]) => {
      if (args.some(ehDeadlock)) deadlocksNoJob++;
      else errOriginal(...args);
    };

    try {
      for (let r = 1; r <= RODADAS; r++) {
        const antesDoJob = deadlocksNoJob;
        await prisma.shiftSession.deleteMany({ where: { tenantId, userId: carlos.id } });
        await prisma.user.updateMany({
          where: { tenantId, id: carlos.id },
          data: { availability: 'available' },
        });
        // sessão já vencida: é o que o job varre, e é o que o login também fecha
        await prisma.shiftSession.create({
          data: { tenantId, userId: carlos.id, endsAt: new Date(Date.now() - 60_000) },
        });
        const { conversa, contato } = await conversaEm('assigned', `9010${r}00`);

        // O job entra primeiro porque ele lê bastante antes de abrir a transação;
        // o respiro crescente do outro lado é o que faz as duas transações se
        // cruzarem de verdade (a janela medida ficou entre 4 ms e 10 ms).
        const [, fim] = await Promise.all([
          expireDueShifts(new Date()),
          new Promise<void>((ok) => setTimeout(ok, 4 + r))
            .then(() => endShift(tenantId, carlos.id, 'manual'))
            .then(
              () => null as unknown,
              (e: unknown) => e
            ),
        ]);

        const deadlockNoAtendente = fim !== null && ehDeadlock(fim);
        const deadlockNoJob = deadlocksNoJob > antesDoJob;
        const abertas = await prisma.shiftSession.count({
          where: { tenantId, userId: carlos.id, endedAt: null },
        });
        const depois = await prisma.conversation.findFirstOrThrow({
          where: { tenantId, id: conversa.id },
        });
        // presa = seguiu com dono sem plantão aberto, que é o estrago que o
        // deadlock deixa quando ele derruba justamente o lado que solta.
        const presa = depois.assignedUserId !== null && abertas === 0;
        if (deadlockNoAtendente || deadlockNoJob || abertas > 0 || presa) falhas++;
        console.log(
          `  rodada ${r}: deadlock atendente=${deadlockNoAtendente ? 'SIM' : 'não'}` +
            ` deadlock job=${deadlockNoJob ? 'SIM' : 'não'} plantões abertos=${abertas}` +
            ` dono=${depois.assignedUserId ? 'Carlos' : '(fila)'}` +
            `${deadlockNoAtendente || deadlockNoJob ? '  <-- 40P01' : presa ? '  <-- PRESA' : ''}`
        );
        await limpar(conversa.id, contato.id);
      }
    } finally {
      console.error = errOriginal;
    }
    registrar('fim de plantão x varredura do job (deadlock 40P01)', falhas, RODADAS);
  } finally {
    // No finally e não no fim do bloco: um cenário que estoure no meio deixa a
    // escala apagada do mesmo jeito, e aí ninguém desconfia do script.
    await restaurarPlantoes();
    console.log('  (escala, disponibilidade e plantões devolvidos ao estado anterior)\n');
  }

  // ---------------------------------------------------------------- fim
  console.log('='.repeat(72));
  const quebrados = resultados.filter((r) => r.falhas > 0);
  for (const r of resultados) {
    console.log(`  ${r.falhas === 0 ? 'PASSOU' : 'FALHOU'}  ${r.nome} (${r.falhas}/${r.total})`);
  }
  console.log('');
  console.log(
    quebrados.length === 0
      ? 'RESULTADO: PASSOU — nenhuma corrida reproduzida'
      : `RESULTADO: FALHOU — ${quebrados.length} corrida(s) ainda abertas`
  );

  await prisma.$disconnect();
  process.exit(quebrados.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
