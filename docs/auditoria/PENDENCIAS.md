# Pendências — o que a auditoria encontrou e não corrigiu

Este é o backlog do que ficou para depois.

A auditoria rodou em cinco ondas. Duas delas escreveram código: a onda 2
(commit `d2bd846`, 58 arquivos, +2001/-504) e a onda 4 (commit `8ea8e0f`,
23 arquivos, +767/-157). O que não coube nelas está aqui.

**De onde vem cada item.** São duas listas juntas:

- **41 achados da onda 1** que sobreviveram à verificação (91 de 128 sobreviveram)
  mas ficaram fora da onda 2, cada um com o motivo registrado na hora.
- **21 achados da onda 3** (red team) que o juiz julgou procedentes e adiou.

Somados dão 62 entradas brutas. Tirando as três que as ondas 2 e 4 acabaram
resolvendo por tabela e juntando as que são o mesmo problema visto de dois
ângulos, sobraram **53 itens**: 10 no bloco 1, 12 no bloco 2 e 31 no bloco 3.
Uma pergunta de produto que apareceu no risco residual de vários achados, e nunca
teve entrada própria, virou o item 1.4.

**O que eu confirmei.** Reabri no código, nesta branch, cada afirmação que este
documento faz sobre o estado atual: arquivo, linha e comportamento. Onde não
consegui confirmar — porque depende de rodar contra o Render, contra a Twilio de
verdade ou contra duas instâncias ao mesmo tempo — está escrito que não consegui.
Nada aqui foi medido em produção.

**O que este documento não diz.** Ele não diz que o sistema está seguro. Diz o
que foi olhado, o que foi consertado e o que sobrou. Uma pendência de severidade
baixa continua sendo uma pendência.

---

## Como ler

**Esforço** (a escala da auditoria, traduzida):

| Rótulo | Ordem de grandeza |
|---|---|
| trivial | menos de uma hora, uma ou duas linhas |
| pequeno | algumas horas, um arquivo ou dois |
| médio | um dia, com teste manual documentado |
| grande | vários dias, PR próprio, provavelmente mais de um |

**Os três blocos:**

1. **Decisão do dono** — não é problema técnico, é escolha de produto.
   Cada item traz as opções e uma recomendação. Enquanto não houver decisão,
   qualquer código escrito ali é chute.
2. **Fazer antes de um hospital de verdade usar** — aceitável numa demonstração,
   não aceitável com paciente real.
3. **Dívida técnica** — o resto, ordenado por custo/benefício.

Dentro de cada bloco, os itens estão em ordem de impacto.

**Já resolvido, não procure aqui:** três pendências da lista original caíram
sozinhas e não estão nos blocos abaixo, para não fazer ninguém trabalhar duas
vezes.

| Pendência | O que a resolveu |
|---|---|
| `scripts-e-seed-fora-do-typecheck` | A onda 2 criou `apps/api/tsconfig.scripts.json` (inclui `src`, `scripts`, `prisma`) e o script `typecheck` na raiz. Confirmado. |
| `serializacao-so-em-memoria` (posse do link nominal) | A onda 2 tirou a posse do `Map` em memória e a pôs numa trava de linha no banco (`entryLinks.withLinkClaim`, `SELECT ... FOR UPDATE`), e a onda 4 fez `externalContacts.createOrGet` tratar o `P2002`. Confirmado. O que sobrou de estado em memória virou o item 2.6. |
| `reopen-e-codigo-duplicado-fora-da-spec`, parte (a) | A onda 4 (A04) fez o `reopenMenu` pular o menu quando o link tem um setor só, como o `PROJETO.md` manda. Confirmado em `lifecycle.service.ts:284-314`. A parte (b), dos dois códigos na mesma mensagem, continua aberta — item 3.13. |

---

# Bloco 1 — Decisão do dono

Dez perguntas que o código não pode responder sozinho.

## 1.1 Critério do CSAT: quem recebe a pergunta de nota

`A07` + `A34` · impacto alto · esforço trivial para reverter

**O que é.** A onda 4 mudou a regra de quem recebe "De 0 a 10, como foi o
atendimento?". Antes: só quem tinha recebido resposta de um atendente
(`first_reply_at` preenchido). Agora
(`lifecycle.service.ts:53-55`): quem chegou a ser atribuído a alguém
(`first_assigned_at`) **ou** cujo encerramento foi feito por gente — o atendente
pelo botão (`agent_closed`) ou a própria pessoa pelo MENU+SIM (`user_switched`).

**Por que foi adiada.** Não foi adiada: foi feita. Mas foi feita sob uma
suposição — a de que "o atendente resolveu por telefone e encerrou sem digitar
nada" conta como atendimento. O `PROJETO.md` foi atualizado no mesmo commit para
descrever a regra nova. Se a suposição estiver errada, reverter custa uma linha.

**O risco de deixar como está.** Duas coisas.

Primeira: o atendente que encerra uma conversa que **ninguém nunca assumiu**
(status `open`) dispara a pesquisa, porque `agent_closed` sempre pergunta. Isso
infla a taxa de resposta com conversas sem atendimento real. Está registrado como
risco residual da própria correção.

Segunda, e essa é um defeito real: **o painel do gestor não acompanhou a
mudança.** Em `metrics.service.ts:52-58`, o denominador de "quantos avaliaram"
ainda é `firstReplyAt !== null` mais a exclusão de dois motivos de encerramento.
O sistema agora pergunta a mais gente do que o painel conta. O número exibido está
errado para baixo — conversas que receberam a pergunta e não responderam não
entram no denominador.

**O que fazer.**

| Opção | Consequência |
|---|---|
| (a) Manter a regra nova | Corrigir `metrics.service.ts:52-58` para usar o mesmo critério de `closeWithCsat`. É a correção obrigatória em qualquer cenário. |
| (b) Voltar para "só quem foi respondido" | Uma linha em `lifecycle.service.ts:53-55`, e o `PROJETO.md` volta ao texto anterior. |
| (c) Manter a regra nova, menos quando a conversa nunca foi atribuída | Fecha o caso do `open` encerrado pelo atendente. Custa uma condição a mais. |

Recomendação: **(a) + (c)**. Quem esperou na fila e foi atendido por telefone
merece ser perguntado; quem nunca chegou a ninguém, não. E o painel tem que contar
a mesma coisa que o sistema pergunta — hoje ele não conta.

Junto disso vale escrever de uma vez o que hoje está em três lugares diferentes:
`lifecycle.service.ts` (quem é perguntado), `metrics.service.ts` (quem entra no
denominador) e o `PROJETO.md` (o que está prometido).

## 1.2 A nota depois de MENU+SIM não tem para onde ir

`csat-do-sim-nao-tem-onde-cair` · impacto alto · esforço médio

**O que é.** A pessoa digita MENU, confirma SIM. O sistema encerra a conversa,
manda a pergunta de nota e, no mesmo instante, abre uma conversa nova e manda o
menu. Chegam duas mensagens coladas. Ela responde "9" achando que está dando a
nota — mas o webhook procura primeiro a conversa **ativa**
(`webhook.service.ts:131` vem antes de `:143`), trata o "9" como escolha de setor
inválida e reenvia o menu. A nota nunca é gravada.

Pior: a conversa antiga fica em `awaiting_feedback` para sempre. O job de
inatividade não varre esse estado (`listStaleForTimeout`, `conversations.ts:370-378`,
cobre `assigned`, `awaiting_department` e `awaiting_menu_confirm`). Confirmei os
três pontos no código; a onda 4 mexeu nesse caminho por outro motivo (A04) e não
mudou nada disso.

**Por que foi adiada.** Porque as duas mensagens não cabem no mesmo canal e a
escolha entre elas é de produto, não de engenharia.

**O risco de deixar como está.** `user_switched` nunca produz nota. Como agora
ele **sempre** pergunta (item 1.1), ele entra no denominador e nunca no numerador:
puxa a taxa de satisfação para baixo por construção. E as conversas em
`awaiting_feedback` se acumulam sem nada varrer.

**O que fazer.**

| Opção | O que muda |
|---|---|
| (a) Não pedir nota no `user_switched` | Trocar `closeWithCsat` por `closeConversation` em `lifecycle.service.ts:215`. A pessoa não está saindo, está trocando de setor. Contraria o `PROJETO.md`, que diz "SIM → encerra (`user_switched`), CSAT, mostra o menu". |
| (b) Adiar o menu | Mantém `awaiting_feedback` e deixa a próxima mensagem (nota ou não) abrir a conversa nova. O caminho já existe: `finalizeFeedback` + `startConversation`. Custa uma ida e volta a mais para quem só queria trocar de setor. |

Recomendação: **(a)**, e ajustar o `PROJETO.md`. Numa conversa de duas a cinco
mensagens, pedir nota de um atendimento que a pessoa acabou de abandonar para
falar com outro setor mede pouco e atrapalha.

Em qualquer das duas: varrer `awaiting_feedback` depois da janela de 10 minutos do
comentário. Essa parte é correta nos dois cenários e pode ir junto.

## 1.3 Definição do SLA: o que conta como violação

`A23` · impacto alto · esforço trivial

**O que é.** A onda 2 mudou o denominador do SLA. Antes: só as conversas que
receberam resposta. Agora (`metrics.service.ts:41`): toda conversa que já foi
respondida **ou** já foi encerrada.

A intenção era certa — a madrugada em que 90 de 100 pessoas foram ignoradas
exibia SLA de 100%. O alcance é que passou do ponto: entram no denominador as
conversas que **nunca escolheram setor** (sem setor não há fila, não há rodízio,
não há atendente possível), as encerradas porque o hospital cortou o acesso
(`access_revoked`) e as que a própria pessoa encerrou digitando MENU antes de
qualquer resposta (`user_switched`).

**Por que foi adiada.** Porque é escolha de produto, e porque os dois números já
estão expostos: `slaPct` (o novo) e `slaPctEntreRespondidas` (o antigo), lado a
lado no payload.

**O risco de deixar como está.** O cartão principal do gestor pode exibir 0% com
selo vermelho sem que uma única conversa tenha chegado a um setor. Na medição da
auditoria, num dia do banco local: 39 conversas, 20 com prazo vencido, SLA novo =
0%, dos quais 17 encerradas pelo atendente sem nunca ter escolhido setor e 1 por
inatividade na mesma situação. Não refiz essa medição. Além disso o abandono já
tem cartão próprio, então a mesma conversa pesa duas vezes contra o hospital.

**O que fazer.** Decidir o que "o hospital tinha como atender" significa, e usar a
mesma definição no arquivo inteiro — hoje `metrics.service.ts` tem duas, uma no
SLA e outra no CSAT, poucas linhas abaixo.

| Opção | Efeito |
|---|---|
| (a) Manter como está | Simples de explicar ("toda conversa que terminou sem resposta é violação"), mas mistura o que o hospital deixou de atender com o que ele não tinha como atender. |
| (b) Exigir que a conversa tenha chegado a um setor (`departmentId != null`) e excluir `access_revoked`, `no_agent_available` e `user_switched` | Mede o que o hospital controla. É a mesma lista de exceções que o próprio arquivo já aplica ao CSAT. |

Recomendação: **(b)**. E manter os dois números na tela, com uma frase explicando
a diferença — o gestor precisa distinguir "atendemos devagar" de "não atendemos".

## 1.4 A conversa presa em `open` quando o setor não tem ninguém

sem número — é a pergunta que sobrou de vários achados · impacto alto · esforço pequeno a médio

**O que é.** A pessoa escolhe "2 — Cardiologia", recebe "Você será atendido por
*Cardiologia*. Aguarde um momento." e, se não houver nenhum atendente de plantão
e disponível naquele setor, a conversa fica em `open` **para sempre**.

Confirmei os três pedaços: `tryAssign` devolve `false` em silêncio quando não há
candidato (`routing.service.ts:41`); o job de inatividade não varre `open`
(`conversations.ts:370-378`); e o motivo de encerramento `no_agent_available`
existe no enum mas só é usado num caso completamente diferente — quando **todos**
os setores do link foram desativados (`conversation.service.ts:174`).

Não é um defeito contra a especificação: o `PROJETO.md` escreve o filtro do job
exatamente assim. É uma lacuna de produto que apareceu no risco residual de vários
achados (A06, A21, A03) e nunca virou entrada própria.

**Por que foi adiada.** Ninguém tinha autoridade para decidir o que a pessoa de
fora deve ouvir.

**O risco de deixar como está.** Alguém escreve para o hospital às 3h, recebe
"aguarde um momento" e nunca mais é respondido. Ninguém no hospital é avisado.
A conversa não aparece em nenhum relatório de abandono, porque abandono é medido
por `close_reason = timeout` e ela nunca é encerrada. É o pior tipo de falha:
silenciosa dos dois lados.

**O que fazer.**

| Opção | O que a pessoa de fora vive |
|---|---|
| (a) Nada (hoje) | "Aguarde um momento" e silêncio indefinido. |
| (b) Avisar na hora, mantendo a conversa aberta | "No momento não há ninguém na Cardiologia. Assim que alguém entrar, você será atendido." A conversa continua na fila e é distribuída quando alguém abre plantão — o `assignPendingForUser` já faz isso. |
| (c) Encerrar após N minutos com `no_agent_available` | Fecha o buraco de medição (vira número no painel) mas encerra a conversa de quem podia ser atendido 5 minutos depois. |
| (d) Encaminhar para um setor de retaguarda (Recepção) | Precisa de configuração nova por tenant e pode furar o escopo do link. |

Recomendação: **(b)** agora, **(c)** depois, com N alto (30 ou 60 minutos) e o
mesmo texto de aviso. A (b) é barata: uma checagem no `setDepartment` quando
`tryAssign` devolve `false`, mais uma constante em `services/texts.ts`.

## 1.5 O administrador atende ou não atende?

`admin-usa-endpoints-de-atendente` · impacto alto · esforço pequeno

**O que é.** O router do atendente aplica só `requireAuth`
(`routes/agent.ts:26`, confirmado — não há `requireRole` no arquivo). O token de
administrador vale 12 horas e não depende de plantão. Resultado: o admin entra em
todos os endpoints do atendente, responde pelo WhatsApp do hospital, assume
conversa da fila, grava `first_reply_at` e muda a própria disponibilidade.

A conversa então fica com um usuário que o rodízio nunca considera
(`availableAgentsForDepartment` filtra `role: 'agent'`, confirmado em
`users.ts:67-78`), some da fila do setor porque o status virou `assigned`, e só
volta a se mexer quando o job de inatividade a encerra.

**Por que foi adiada.** Porque o produto não decidiu. A tela diz uma coisa
("administrador não fica em nenhum setor — por isso nenhuma conversa cai aqui") e
o botão "Painel" dentro do cabeçalho do atendente sugere outra.

**O risco de deixar como está.** O Sprint 2 inteiro é "o acesso acaba com o
plantão", e existe um papel que atende sem plantão nenhum. Não é vazamento entre
hospitais — o admin é do próprio tenant — mas é o meio-termo que dá o poder sem
nenhuma das travas.

**O que fazer.**

| Opção | O que muda |
|---|---|
| (a) O gestor não atende | `router.use(requireAuth, requireRole('agent'))` em `routes/agent.ts:26`, remover as duas checagens manuais de papel que sobram, e fazer `/conversas` redirecionar o admin para o painel em vez de chamar a API e tomar 403. |
| (b) O gestor atende como qualquer um | Ele precisa de setor e de plantão, e `availableAgentsForDepartment` precisa parar de filtrar por papel. Contraria o comentário de `middleware/auth.ts:12` ("o admin entra sempre, senão ninguém conserta a escala às três da manhã"). |

Recomendação: **(a)**. Num hospital pequeno onde a mesma pessoa faz as duas
coisas, ela tem duas contas — o que é honesto, porque as métricas de atendimento
passam a ter dono.

## 1.6 O que o painel do gestor precisa responder

`painel-nao-aponta-setor-nem-mostra-espera` + `comentarios-do-csat-so-um-a-um` · impacto médio · esforço médio

**O que é.** O painel responde "quanto" e nunca "onde dói". Confirmei:
`byDepartment` acumula só `{ name, volume }` (`metrics.service.ts:61-67`), então
tempo de resposta, SLA, duração e satisfação existem apenas como número único do
hospital inteiro. Não há recorte por motivo de encerramento, que o `PROJETO.md`
pede.

Duas coisas já estão prontas e não aparecem:

- `assignAvgMinutes` — quanto a pessoa esperou até cair com alguém — é calculado
  na API, vem no payload e não é renderizado em cartão nenhum.
- Os comentários do CSAT, o único dado qualitativo do produto, só podem ser lidos
  abrindo conversa por conversa em `/admin/conversas`. Uma nota 2 com "liguei três
  vezes e ninguém atendeu" morre no banco.

**Por que foi adiada.** É escopo de produto (o que entra no painel e como se
apresenta) e divide arquivo com a correção do SLA, que precisa vir antes.

**O risco de deixar como está.** O gestor vê que a Cardiologia recebeu 80
conversas e a Recepção 40, e não tem como saber qual está demorando. A decisão
que o produto existe para embasar — onde reforçar a escala — não é tomável com o
que a tela mostra.

**O que fazer.** Tudo sai da consulta que já roda (`listForMetrics` já traz
`feedback` e `department` por linha), sem query nova:

1. Enriquecer `byDepartment` com tempo médio de resposta, SLA, satisfação e
   abandonos — mostrando o `n` ao lado de cada média, porque com volume baixo
   média por setor engana.
2. Devolver `byCloseReason`.
3. Renderizar o cartão "Tempo até alguém assumir" com o número que já vem.
4. Painel "O que as pessoas escreveram": os últimos 10 comentários do período, com
   nota, setor e link, notas baixas primeiro.
5. Linha "não chegaram a escolher setor", para o total bater.

Decisão do dono: quais desses cinco entram e em que ordem na tela.

## 1.7 Nada avisa quem está de plantão que chegou mensagem

`nada-avisa-que-chegou-mensagem` · impacto médio · esforço médio

**O que é.** A meta de 5 minutos depende de alguém encarando a aba. A busca é de
5 em 5 segundos, mas nada muda no título da página, nada toca, nada vibra.
Confirmado pela auditoria por varredura: nenhuma ocorrência de `document.title`,
`Notification`, `new Audio` ou `navigator.vibrate` em `apps/web`.

**Por que foi adiada.** Não é defeito contra a especificação — o `PROJETO.md`
trava "polling 5s" e não pede notificação. E a parte sonora tem implicação clínica
(barulho em enfermaria) que não cabe a quem escreve o código decidir.

**O risco de deixar como está.** A enfermeira está com um paciente, o navegador
atrás de outra janela. Ela só descobre quando volta ao computador. O painel
registra 40 minutos de tempo de resposta, ou a conversa vira abandono.

**O que fazer.** Do menu possível, só o primeiro é seguro sem decisão:

| Opção | Custo |
|---|---|
| Contador no título da aba: `(2) Central de Ramais` | Trivial. Não faz barulho, não pede permissão. |
| Bipe curto (WebAudio) atrás de opção do usuário | Pequeno. Precisa da decisão sobre barulho em enfermaria. |
| Notificação do navegador (`Notification.requestPermission`) | Pequeno. Pede permissão ao usuário, funciona com a aba em segundo plano mas não fechada. |
| Push de verdade (service worker) | Grande. Outra versão do produto. |

Recomendação: fazer o contador no título já, e perguntar ao Dr. Marcelo sobre som
antes de qualquer outra coisa. Nenhuma das opções cobre a aba fechada.

## 1.8 Link nominal vazado não alerta ninguém

`link-nominal-vazado-nao-alerta-ninguem` · impacto médio · esforço médio

**O que é.** A tabela de decisão do `PROJETO.md` diz, para o link nominal usado
por um segundo número: "Recusa. Registra `access_attempt`, **alerta o admin**".
O que existe é um cartão vermelho num painel que só aparece se alguém abrir a tela
e escolher o período certo. Não há e-mail, não há push: as dependências da API são
Prisma, bcrypt, cors, express, jsonwebtoken, qrcode, twilio e zod — o único canal
de saída é o WhatsApp.

E quando o admin abre e vê o mesmo número tentando doze vezes, não consegue agir
dali: não há ação nenhuma na linha, e o número nem aparece em `/admin/contatos`,
porque quem foi recusado nunca virou contato.

**Por que foi adiada.** O degrau mais útil (avisar por WhatsApp) faz mensagem sair
sem conversa — custo por mensagem, risco de laço — e exige uma coluna nova para o
número do administrador. Nada disso se decide sem o dono.

**O risco de deixar como está.** O `PROJETO.md` diz que a lista de tentativas
negadas "é a que mais importa para segurança". Hoje ela é passiva. Um link nominal
vazado fica invisível até alguém procurar.

**O que fazer.** Três degraus, escolher pelo apetite:

1. Contador de recusas não vistas no menu do `/admin`, com destaque para
   `nominal_taken`. Barato, sem decisão de produto.
2. Ações na linha de `/admin/acessos`: "emitir link para este número", "bloquear".
3. Alerta pelo próprio WhatsApp para um número de administrador por tenant,
   agrupado (no máximo um alerta por link por hora).

Recomendação: 1 agora, 2 quando houver o primeiro cliente real, 3 só se ele pedir.

## 1.9 O `holder_note` não chega a quem atende

`holder-note-nao-chega-a-quem-atende` · impacto médio · esforço pequeno

**O que é.** O admin emite o link nominal e escreve no `holder_note` exatamente o
que faltaria depois: "CRM 12345", "filha do paciente do leito 4B". Esse campo
aparece só em `/admin/links`. Às 3h da manhã a enfermeira vê apenas o rótulo do
link ("Médico Externo") e gasta as duas primeiras mensagens perguntando quem é.

**Por que foi adiada.** Porque expande a audiência de um campo que hoje só o
administrador vê, e o conteúdo pode ligar uma pessoa a uma internação.

**O risco de deixar como está.** O `TASKS.md` registra "nome e celular de quem é
de fora no primeiro acesso" como bloqueado por contrariar a regra de fricção zero.
Mas metade do dado já existe, foi digitado pelo hospital, e não custa uma pergunta
a ninguém — o impasse é maior do que precisa ser.

**O que fazer.** Decidir se quem atende aquele setor pode ver o `holder_note`.
Se sim (recomendado), são três mudanças pequenas: incluir a relação nos dois
`include` de `repositories/conversations.ts`, devolver o campo nos dois endpoints
de `routes/agent.ts` e mostrar como segunda linha do cabeçalho da conversa. Usar o
valor **atual** do link, não um instantâneo: diferente do rótulo, é anotação
operacional viva.

## 1.10 Guardar o que foi dito a quem teve o acesso negado

`recusa-nao-vira-mensagem-registrada` · impacto baixo · esforço médio

**O que é.** Quem é recusado por falta de código, quem teve o link revogado e
quem está bloqueado: nada do que essa pessoa escreveu é guardado, e as respostas
automáticas saem por um caminho que não grava mensagem. Quando ela liga dizendo
"mandei três mensagens e ninguém respondeu", o hospital tem o motivo e a hora em
`access_attempts`, mas não tem o que ela escreveu nem o que o sistema respondeu.

Efeito colateral: o simulador mantém uma segunda cópia dos textos de recusa
(`simulator.service.ts`), que vai divergir na primeira vez que alguém reescrever a
mensagem original.

**Por que foi adiada.** Porque implementar significa passar a guardar o corpo de
mensagens de gente não identificada. Num produto de saúde isso pede política de
retenção — que também não existe (item 2.3).

**O risco de deixar como está.** Baixo hoje. O registro do motivo e da hora já
existe. O que se perde é a capacidade de responder a uma reclamação.

**O que fazer.** Decidir primeiro a política de retenção (2.3). Se a resposta for
sim, o caminho é guardar duas colunas na própria `access_attempts` — o corpo
recebido e o texto enviado — sem tabela nova, e fazer o simulador ler dali,
matando a cópia dos textos.

---

# Bloco 2 — Fazer antes de um hospital de verdade usar

Doze itens. Nenhum atrapalha uma demonstração; todos atrapalham com paciente
real.

## 2.1 A API hiberna e a mensagem se perde

`api-hiberna-e-perde-mensagem-do-webhook` · severidade alta · esforço pequeno (mas custa dinheiro)

**O que é.** Os três serviços do `render.yaml` estão em `plan: free` — confirmado,
linhas 9, 15 e 78. O comentário no topo do próprio arquivo diz: "os serviços
hibernam após 15 min sem acesso... Serve para demonstração, não para uso real".

Domingo de madrugada, quinze minutos sem ninguém no sistema. Alguém escreve pelo
link. O contêiner está hibernando; a Twilio espera, desiste e registra erro. A
mensagem não chega ao banco, não aparece na fila de ninguém e não há reentrega —
do lado de fora, o hospital simplesmente não respondeu.

**Por que foi adiada.** Não é conserto de código: é decisão de gasto.

**O que não consegui confirmar.** Não medi o comportamento real do serviço no
Render — tocar em produção estava proibido nesta auditoria. A hibernação do plano
gratuito e o tempo limite do webhook da Twilio são comportamento documentado dos
dois fornecedores, não medição minha.

**O que fazer.** O serviço da API sai do plano gratuito. O webhook de um hospital
não pode hibernar. Enquanto isso não acontece, um ping externo a cada 10 minutos
mantém o serviço acordado — e isso é gambiarra, que merece estar escrita como tal
no README junto do aviso que já existe no `render.yaml`. Ganho colateral barato e
independente: tirar o `seed-if-empty` do comando de start devolve alguns segundos
a cada despertar.

Para medir depois de decidir: 20 minutos sem tráfego, um POST no webhook, cronometrar
até o 200. Acima de 15 segundos, a Twilio já teria desistido.

## 2.2 Mensagem que não foi entregue some do histórico

`envio-falho-some-do-historico` · severidade alta · esforço grande

**O que é.** Dois estragos com a mesma raiz.

Primeiro contato: a conversa é criada, a mensagem recebida é gravada e **só então**
o menu é enviado. Se a Twilio der erro, fica conversa em `awaiting_department`,
mensagem gravada e nenhum menu. A reentrega do Twilio — que existe exatamente para
isso — bate na verificação de duplicata e volta em silêncio. A pessoa fica sem
resposta até o job de 30 minutos encerrar.

Atendente responde "o exame está pronto", o envio falha depois de a mensagem
talvez ter chegado, e nada entra em `messages`: o histórico do app mente. Isso
contraria a regra 3 do `CLAUDE.md` ("persista tudo").

**Por que foi adiada.** Tamanho. Mexe em esquema de banco, no job de 60 segundos e
no caminho quente do webhook ao mesmo tempo — três frentes que outras correções da
onda 2 já estavam disputando.

**O que fazer.** O critério de duplicata precisa virar "já **completei** este
identificador", não "já vi". Em fases:

1. Gravar a mensagem de saída num `catch`, com marcador de falha (coluna nova
   `delivery_failed_at`), e relançar. O histórico deixa de mentir e a tela pode
   rotular "não entregue".
2. O job de 60 segundos que já roda reenvia as pendentes recentes.
3. O log do erro do webhook já leva identificador da mensagem e números mascarados
   (a onda 2 fez essa parte, confirmado em `routes/webhook.ts:38-47`).

Risco a medir: reenviar na reentrega pode duplicar o menu quando a falha foi só na
resposta HTTP. Menu duplicado é melhor que menu nenhum, mas precisa de medição.

## 2.3 Retenção e exclusão de dado pessoal

`sem-retencao-nem-exclusao-de-dado-pessoal` · severidade baixa na demonstração, bloqueante com paciente real · esforço grande

**O que é.** Nada nunca é apagado. Confirmei: `apps/api/src/jobs/` tem só
`timeout.ts` e `shift.ts`; as únicas rotas DELETE do admin desativam em vez de
apagar; e o telefone aparece inteiro em toda tela (`formatPhone` em
`apps/web/lib/labels.ts:81-84` só insere espaços e hífen, não esconde dígito).

**Por que foi adiada.** O prazo de retenção não é decisão de quem escreve o
código: apagar mensagem antiga conflita com o valor probatório do histórico num
hospital. O que não é opcional é **existir** uma política.

**O que este documento não afirma.** Isto é avaliação técnica contra minimização
de dados, não parecer jurídico sobre conformidade. Quem cuida de LGPD no hospital
precisa entrar nessa conversa.

**O que fazer.**

1. Mascarar o número por padrão na tela do atendente, deixando-o inteiro só onde
   há motivo (painel do administrador, tela de contatos). Uma função em
   `apps/web/lib/labels.ts`.
2. Escrever o prazo no `PROJETO.md` (decisão do cliente) e implementá-lo como job
   por tenant, no mesmo formato do job de inatividade, que já itera hospital a
   hospital: apagar corpo de mensagens e comentários de conversas encerradas há
   mais de N meses, preservando a linha da conversa — as métricas dependem dos
   carimbos de tempo, não do texto.
3. Uma rota de exportação e uma de exclusão por contato, para quando alguém pedir.

## 2.4 Nenhum teste automatizado, nenhum CI

`sem-testes-nem-ci` + `banco-de-teste-inexistente` + `especificacao-da-suite-de-testes` · severidade média · esforço grande

**O que é.** Confirmei nesta branch: não existe `.github/`, nem configuração de
linter, nem um único arquivo `*.test.ts`. Os scripts declarados na raiz são `dev`,
`build`, `typecheck`, `db:up`, `db:migrate` e `db:seed` — nenhum `test`. O aparato
de verificação são dois scripts de concorrência, cinco de diagnóstico e nove
comandos `curl` no `TASKS.md`, todos exigindo um humano para rodar e julgar a
saída.

**Por que foi adiada.** Tamanho, e porque disputava `apps/api/package.json` com
uma correção de severidade maior na onda 2.

**O risco de deixar como está.** As duas regras que o `CLAUDE.md` chama de
inegociáveis — filtro por hospital em toda query, e lista de setores vinda do link
— são exatamente as que **não** produzem erro quando quebram: produzem a resposta
errada. Um `findFirst` trocado por `findUnique` passa no build, passa no
`typecheck`, passa no review, e aparece quando o hospital A vê a conversa do
hospital B.

**O que fazer.** Nesta ordem, e não pule a primeira:

1. **Banco de teste isolado.** Hoje `config.ts:5` é `process.loadEnvFile('.env')`
   com o caminho fixo (confirmado), e todo script de checagem escreve no banco de
   demonstração. Três peças: um banco `_test` no mesmo contêiner, trocar a linha
   por `process.loadEnvFile(process.env.ENV_FILE ?? '.env')`, e um guard em
   `test/setup.ts` que **recusa rodar** se o nome do banco não terminar em `_test`.
   Um auditor relatou ter perdido dados de outro auditor durante a própria
   auditoria, com um script apontado para o banco errado; o verificador não
   reproduziu o episódio (a onda dele era só de leitura), mas o mecanismo é
   exatamente o que o código permite. Esse guard é a peça que evita a repetição.
2. **Runner sem dependência nova.** `node:test` com `tsx`, que já está instalado:
   `"test": "node --import tsx --test --test-concurrency=1 test/**/*.test.ts"`.
3. **Ordem dos casos, por valor:** relógio de plantão (puro, feedback instantâneo);
   cruzamento entre hospitais em todo endpoint com `:id`; escopo do link no menu e
   na validação da escolha; carimbos de tempo; idempotência do webhook; plantão.
4. **CI**: um `.github/workflows/ci.yml` com Postgres 16, `npm ci`, migrations num
   banco de teste, typecheck, build, test e `npm audit --audit-level=high`.
5. Migrar os dois scripts `check-*` para `test/`.

A auditoria deixou uma especificação com mais de 50 casos em 6 grupos. Ela **não
foi validada contra o código** — vários casos pressupõem comportamento que o
auditor não exercitou. Se um caso falhar na primeira execução, confira contra o
`PROJETO.md` antes de "consertar" o teste: pode ser achado novo.

## 2.5 Sem freio no webhook

`sem-freio-nas-respostas-de-recusa` · severidade média · esforço médio

**O que é.** O limite de tentativas existe, mas só no login
(`middleware/rateLimit.ts`, aplicado em `routes/auth.ts:27`). O webhook não tem
nenhum: confirmei que `app.ts` monta `webhookRouter` sem middleware de limite e
que `routes/webhook.ts` não tem nenhum.

Um número automatizado mandando mensagens em rajada sem código gera, por mensagem,
uma linha em `access_attempts` e uma resposta "Não identificamos seu acesso" —
mensagem paga na conta da Twilio.

**Por que foi adiada.** Depende de a validação de assinatura estar ligada (sem
ela, o flood nem precisa passar pelo WhatsApp), e um limite mal calibrado silencia
a resposta legítima de quem tentou de novo por engano.

**O risco de deixar como está.** Além do custo, a tela que existe para o
administrador enxergar link nominal vazado fica soterrada de recusas do mesmo
número — e o pico de `nominal_taken` que o `PROJETO.md` chama de sinal de
segurança se perde no meio.

**O que fazer.** Separar **registrar** de **responder**: continuar gravando todo
`access_attempt` (regra 9 do `CLAUDE.md`), mas responder ao mesmo número no máximo
uma vez a cada N minutos. A janela precisa ser consultada no banco (o último
registro daquele número), não em memória — mesmo motivo do item 2.6. Em paralelo,
agrupar por número na tela de acessos.

Teste: 60 mensagens sem código do mesmo número em sequência devem produzir 60
registros e no máximo 1 mensagem de saída na janela.

## 2.6 O sistema depende de rodar numa instância só

resíduo de `serializacao-so-em-memoria`, `dedupe-de-recusa-so-em-memoria` e do limite de login · severidade média · esforço médio

**O que é.** A parte mais séria disso foi corrigida: a posse do link nominal saiu
do `Map` em memória e virou trava de linha no banco. Mas três estados continuam no
heap do processo, e confirmei os três:

| Estado | Onde | O que quebra com duas instâncias |
|---|---|---|
| Fila de serialização por chave | `utils/keyedQueue.ts` | Rodízio e webhook perdem a serialização; sobram as travas de banco, que hoje cobrem os casos principais. |
| Identificadores de mensagem já vistos | `utils/seenMessageIds.ts` | Reentrega do Twilio numa instância diferente duplica recusas em `access_attempts`. |
| Contagem de tentativas de login | `middleware/rateLimit.ts` | O teto por conta vira o teto vezes o número de instâncias. |

**Por que foi adiada.** Porque hoje roda uma instância só, e o custo de mover cada
um desses para o banco é maior que o risco atual.

**O que não consegui confirmar.** Não subi dois processos contra o mesmo banco.
E o `render.yaml` não declara número de instâncias — a suposição de que o plano
gratuito roda uma só não foi verificada por mim.

**O que fazer.** Enquanto for uma instância: escrever isso no `render.yaml`, que
hoje deixa implícito. Antes de escalar: mover a duplicata de recusa para o banco
(guardar o identificador da mensagem na própria `access_attempts`, com índice
único — é a mesma solução que `messages` já usa) e o limite de login para uma
tabela ou para um Redis.

## 2.7 Não existe forma de revogar a sessão de um administrador

`sem-revogacao-de-sessao-do-admin` · severidade média · esforço médio

**O que é.** Confirmei: `routes/auth.ts` tem uma única rota, `POST /auth/login`.
Não existe `/auth/logout` nem troca de senha. O token do administrador vale 12
horas, não tem versão nem lista de revogados, e o middleware confere apenas se o
usuário está ativo (`middleware/auth.ts:41`).

O contraste é grande: a sessão do **atendente** está bem resolvida — morre no fim
do plantão e na desativação, e o middleware confere as duas coisas a cada
requisição.

**Por que foi adiada.** Exige migração de banco, e a onda 2 já tinha outras três
disputando o `schema.prisma`.

**O risco de deixar como está.** Notebook roubado, aba esquecida no computador da
recepção, extensão que lê o `localStorage`: a resposta ao incidente é esperar 12
horas. A única alavanca é desativar o usuário — e a rota recusa desativar a
própria conta e recusa desativar o último administrador ativo, que num hospital
com um administrador só é exatamente o caso.

**O que fazer.** Reaproveitar a consulta que o middleware já faz a cada
requisição: coluna `tokenVersion` no usuário, incluída no token e conferida junto
com o `active`. Com isso `POST /auth/logout` e uma futura troca de senha viram um
incremento e derrubam todas as sessões daquele usuário na hora. Reduzir a validade
de 12h para 8h é complementar, não substituto.

Fica um risco de fundo: enquanto o token viver no `localStorage`, qualquer falha
de XSS no painel rouba a sessão. Cookie `httpOnly` é a correção de verdade e é uma
mudança bem maior.

## 2.8 Migrations no caminho do start, e uma receita de recuperação que não existe

`migrations-no-startcommand` + `A25` · severidade média · esforço médio

**O que é.** Confirmei o `startCommand` do `render.yaml` (linhas 25-28):
`prisma migrate deploy && seed-if-empty && node dist/index.js`. As migrations
rodam a cada start, não a cada deploy. Das nove migrations, quatro mexem em dado e
não só em esquema (contei os `INSERT`/`UPDATE`): uma reescreve a tabela de
conversas inteira, outra faz um `SET NOT NULL` que pega trava exclusiva e varre a
tabela. Nenhuma das nove tem arquivo de reversão — confirmei que só existe
`migration.sql` em todas.

Somado a isso, a migration do índice único (`20260817170100`) tem uma janela real:
entre o fechamento das duplicatas e a criação do índice, qualquer outra conexão
que grave uma segunda conversa ativa para o mesmo contato faz o índice nascer
duplicado e a migration morrer. O red team reproduziu isso com duas conexões
contra um banco de teste.

**Por que foi adiada.** A migration **já foi aplicada**. Editá-la agora muda a
soma de verificação e faz o próprio `migrate deploy` recusar. Não dá para
consertar o passado; dá para não repetir.

**O risco de deixar como está.** Se a migration falhar uma vez, o Prisma grava a
linha como não terminada e **todo restart seguinte** sai com erro P3009. O `&&`
nunca chega no `node`, o `/health` nunca responde, e no plano gratuito não há
shell para rodar o comando de recuperação.

**O que fazer.**

1. Documentar no README a receita de recuperação:
   `npx prisma migrate resolve --rolled-back <nome>` — hoje o README não menciona
   isso (confirmei).
2. Tirar `migrate deploy` do `startCommand` e pô-lo no `buildCommand` ou num
   passo de pré-deploy: roda uma vez por deploy em vez de a cada despertar, e a
   falha derruba o deploy antes de o serviço antigo sair do ar. Conferir antes se
   a `DATABASE_URL` está disponível na fase de build do Render — não verifiquei.
3. Em migrations **futuras** que mexam em dado: primeira linha
   `LOCK TABLE "conversations" IN SHARE ROW EXCLUSIVE MODE;` quando houver backfill
   antes de um índice único, backfill em lotes por script separado, e o `.sql` de
   reversão escrito junto, mesmo que aplicado à mão.

## 2.9 O simulador escreve na conversa de um número real

`simulador-forja-mensagem-de-numero-real` · severidade média · esforço médio · **precisa de decisão**

**O que é.** O simulador passa pelo mesmo caminho do webhook — decisão consciente
e boa, porque a demonstração não mente. O efeito colateral é que o administrador
pode digitar o número de um paciente **real** e escrever uma mensagem que entra na
conversa real dele, gravada como se tivesse vindo da pessoa.

Confirmei: o esquema aceita qualquer texto de 8 a 20 caracteres como número
(`routes/simulator.ts:26-29`), o router é montado incondicionalmente
(`app.ts:56`), e não há coluna de origem em `messages` nem em `conversations`. O
único vestígio é um prefixo no identificador da mensagem, que nenhuma tela mostra.
A rota exige token de administrador, o que limita o alcance ao próprio hospital.

Efeito secundário: tudo que a demonstração produz entra nas mesmas tabelas que o
painel soma. A demonstração de sexta vira volume, satisfação e tentativas negadas
no relatório do mês.

**Por que foi adiada.** As duas saídas mexem na demonstração comercial, que é o
uso principal do sistema hoje.

**O que fazer.**

| Opção | Custo |
|---|---|
| (a) Faixa reservada: recusar qualquer número fora de um prefixo de demonstração | Pequeno. O simulador deixa de conseguir se passar por alguém real. |
| (b) Marca de origem em `messages`, devolvida pela API, mostrada na bolha e excluída das métricas | Médio, exige migração. Resolve também a contaminação do relatório. |
| (c) Desligar o simulador por variável de ambiente em produção | Trivial, mas só serve se o dono não usar o simulador em produção — e hoje parece ser recurso de demonstração deliberado. |

Recomendação: **(a)** agora, **(b)** antes do primeiro paciente real. Fica de pé
um limite: sem registro de qual administrador injetou o quê, mesmo com a marca não
dá para responsabilizar ninguém.

## 2.10 Nenhum tempo limite configurado

`sem-timeouts-em-twilio-http-e-pool` · severidade média · esforço pequeno

**O que é.** Nem no cliente da Twilio, nem no servidor HTTP, nem no pool de
conexões do Prisma. Confirmado pela auditoria em `providers/twilio.ts:10`,
`prisma.ts` (três linhas, `new PrismaClient()`) e `index.ts`.

**Por que foi adiada.** A confiança do achado era "provável" — o provedor real da
Twilio não foi exercitado, e o efeito no pool depende do host do Render, que não
foi medido. E disputava arquivos com correções de prioridade maior.

**O risco de deixar como está.** Uma lentidão da Twilio faz o **nosso** webhook
estourar o prazo **dela**, e a próxima mensagem da mesma pessoa fica presa atrás
na fila serializada. Exaustão de pool se manifesta como "não consegue conectar",
aleatório, sem log.

**O que fazer.** Três linhas e um parâmetro de URL: tempo limite de 8 segundos no
cliente da Twilio (abaixo dos 15 do webhook, para que a nossa falha seja nossa);
`requestTimeout` e `headersTimeout` no servidor; e limites de pool na
`DATABASE_URL` do `render.yaml`, mais um `$connect()` antes do `listen` para o
`/health` refletir a verdade já no primeiro segundo. Os números são chute
informado — vale medir contra a instância real antes de fixar.

## 2.11 Endurecimento barato de JWT e cabeçalhos

`jwt-sem-algoritmo-fixo-e-sem-helmet` + `sem-headers-de-seguranca` · severidade informativa/baixa · esforço trivial

**O que é.** Nada disso é explorável hoje — os três ataques clássicos ao JWT
foram testados pela auditoria e recusados. Mas:

- `middleware/auth.ts:32` é `jwt.verify(token, config.JWT_SECRET)` sem fixar o
  algoritmo (confirmei). Funciona porque a biblioteca, com segredo em texto, só
  aceita HS256/384/512 — é proteção que vem da versão da dependência, não do
  código. No dia em que alguém trocar o segredo por um arquivo de chave, a mesma
  linha passa a aceitar token assinado com a chave pública.
- A API não usa `helmet` e não desabilita `x-powered-by` (confirmei: nenhuma
  ocorrência das duas coisas em `apps/api`), e o `next.config.ts` não define
  cabeçalhos.
- O mínimo do `JWT_SECRET` no esquema é 16 caracteres, abaixo dos 32 bytes
  usualmente recomendados.

**Por que foi adiada.** Severidade informativa, e disputava `app.ts` e
`package.json` com correções maiores.

**O que fazer.** Três mudanças de uma linha, sem dependência nova: fixar
`algorithms: ['HS256']` no verify, `app.disable('x-powered-by')`, e subir o mínimo
do segredo para 32. Conferir o valor configurado no Render **antes** de mergear a
terceira — se o segredo de lá for menor, a API recusa subir. Depois:
`helmet()` na API e um bloco de cabeçalhos no `next.config.ts`, começando a
política de conteúdo em modo somente-relatório.

## 2.12 Não dá para explicar por que a fila parou

`sem-log-para-explicar-fila-parada` · severidade média · esforço médio

**O que é.** Segunda de manhã, o gestor pergunta por que a conversa de um médico
externo ficou parada com dois atendentes de plantão. Não existe resposta possível:
`tryAssign` devolve `false` em cinco situações diferentes e **nenhuma escreve uma
linha**. Confirmei as saídas mudas em `routing.service.ts:25`, `:34`, `:41` e
`:68`. Não há middleware de requisição, não há identificador por requisição, e um
erro 500 aparece sem rota, sem usuário e sem hospital.

A onda 2 melhorou uma parte: o erro do webhook agora sai como JSON estruturado com
identificador da mensagem e números mascarados (`routes/webhook.ts:38-47`). O
resto continua como estava.

**Por que foi adiada.** Tocava arquivos que várias outras correções já estavam
mexendo.

**O que fazer.** Sem biblioteca nova:

1. `apps/api/src/log.ts` emitindo JSON de uma linha, no mesmo formato que o
   webhook já usa.
2. Middleware de ~10 linhas no `app.ts` com identificador por requisição, exposto
   no cabeçalho de resposta e usado no tratador de erro.
3. Um motivo por saída do rodízio: `conversa_mudou`, `sem_agente`,
   `apenas_quem_encaminhou`, `perdeu_corrida`.
4. Um log por transição de conversa: criada, setor definido, atribuída, encerrada
   com o motivo.

Cuidado que precisa virar comentário no código: **corpo de mensagem de paciente
não entra no log.** O mascaramento de número já existe em `utils/phone.ts` e deve
ser reusado.

---

# Bloco 3 — Dívida técnica

Ordenada por custo/benefício: o começo da lista é onde se ganha mais por hora
gasta.

## Rápido e vale a pena

### 3.1 `npm install` no deploy, em vez de `npm ci`

`deploy-usa-npm-install` · trivial

Os dois `buildCommand` do `render.yaml` (linhas 17 e 80) começam com
`npm install` — confirmado. Alguém sobe uma dependência e esquece de commitar o
`package-lock.json`: o deploy passa liso resolvendo versões novas na hora,
enquanto a máquina do desenvolvedor roda outra coisa. `npm ci` aborta quando o
lock está fora de sincronia. É uma palavra em dois lugares. Só se valida com um
deploy, por isso ficou de fora das ondas anteriores.

### 3.2 As oito telas do gestor têm todas o mesmo título

`A39` · trivial

O Next anuncia a troca de rota pelo título do documento. Confirmei: só quatro
arquivos exportam `metadata` (`app/layout.tsx`, `conversas`, `login`, `ramais`), e
`app/admin/layout.tsx` começa com `'use client'` — componente cliente não pode
exportar metadata. As 8 rotas de `/admin` devolvem todas "Central de Ramais".
Correção: um `layout.tsx` de servidor por segmento, exportando só o título e
devolvendo `children`. São 8 arquivos de 8 linhas, exatamente o padrão que as
outras três telas já usam.

### 3.3 O diálogo de Encaminhar corta a 200% de zoom

`A40` · trivial

`apps/web/app/conversas/[id]/page.tsx:505-510`: a caixa é
`w-full max-w-md rounded-2xl ... p-6`, sem `max-h` e sem `overflow-y` (confirmei).
Num notebook 1280×720 a 200% de zoom, a caixa fica mais alta que a tela e não há
barra de rolagem em lugar nenhum — com 4 ou mais setores no link, os próprios
botões de destino ficam inalcançáveis pelo mouse. Correção:
`max-h-[calc(100dvh-2rem)] overflow-y-auto` na caixa. Vale conferir o mesmo no
`ConfirmDialog`, que hoje cabe só porque tem pouco conteúdo.

### 3.4 Comentários que descrevem código que não existe

`A32` + `A33` + `A36` + `A37` · trivial cada um

Quatro comentários que um revisor futuro vai ler como especificação. Nenhum é
defeito de execução; todos são armadilha de leitura. Confirmei os quatro.

| Onde | O que o comentário diz | O que o código faz |
|---|---|---|
| `conversations.ts:289` | "a mesma regra da lista dele (`listForAgentView`)" | A lista mostra só `open` do setor; a busca por id não filtra status nenhum — o atendente lê o histórico de qualquer conversa encerrada do setor dele. Provavelmente é o comportamento desejado; o que falta é escrevê-lo. |
| `config.ts:76` | "quem seguir o README ao pé da letra assina JWT com uma chave pública" | O valor saiu do `.env.example` no mesmo commit e o README passa a gerar a chave. O guard ainda serve para quem clonou antes — só não faz o que o comentário diz. |
| `shift.service.ts:216` e `users.ts:97` | "reoferecer manda mensagem de WhatsApp" | `tryAssign` não envia nada. A razão real de não chamá-lo dentro de transação é melhor: ele abre transação própria e disputa as mesmas linhas. |
| `migration 20260817170100:5` | a conversa órfã recebe "pergunta de nota de um atendimento que nunca existiu" | A órfã nasce sem atribuição, então o job a fecha em silêncio. Não editar a migration aplicada; se incomodar, o lugar de corrigir é o comentário do `schema.prisma`, que fala do mesmo índice. |

### 3.5 `menu_key` é dado morto que parece importante

`menu-key-e-dado-morto` · trivial

O campo nunca é lido para montar o menu nem para validar a escolha — a numeração
do externo é 1..N sobre a lista do **link**. Hoje ele só serve como valor inicial
de ordenação. O risco é o próximo desenvolvedor ler "menu_key", usar como a
numeração do menu e quebrar a segunda regra do `CLAUDE.md` sem perceber. Correção:
trocar o comentário do `schema.prisma` para dizer o que o campo realmente é. Mais
barato que apagar, e resolve o risco real, que é de leitura.

### 3.6 Chaves estrangeiras com `ON DELETE SET NULL`

`fks-on-delete-set-null` · trivial (mas exige migration)

`conversations.department_id` e `assigned_user_id` apagam a referência em silêncio
se alguém der um DELETE direto no banco — o histórico é reescrito sem erro.
Nenhum caminho do app faz isso hoje; é preventivo. Correção: `onDelete: Restrict`
nos dois lados, para o banco recusar. Candidato natural a entrar junto com a
próxima migration que já for mexer no `schema.prisma`.

### 3.7 O rascunho só é salvo na conversa externa

`A41` · pequeno

O fim do plantão derruba a sessão e recarrega a página em até 5 segundos, sem
ninguém clicar em nada. A tela de conversa externa salva o rascunho; a de ramal
interno não — confirmei que `PREFIXO_RASCUNHO` só aparece em `conversas/[id]` e em
`lib/api.ts`, e que `ramais/[id]/page.tsx:70` tem o mesmo estado sem persistência.
Correção: extrair os dois efeitos para um `useRascunho(chave)` em `lib/` (são dois
usos hoje, que é o critério do `CLAUDE.md` para permitir a abstração) e aplicar na
outra tela. A limpeza por prefixo no login já cobre a regra do tablet
compartilhado.

### 3.8 Achados pequenos de front, confirmados

`A42` · pequeno no conjunto

Quatro itens que não justificam entrada própria e ficam registrados para não serem
redescobertos:

1. **Alvo de toque do botão** (também `alvos-de-toque-abaixo-de-44px`): o `Button`
   é `px-4 py-2 text-sm` sem altura mínima (confirmei em `components/ui.tsx:122-128`),
   o que dá ~37px. Passa no critério de 24px da WCAG 2.5.8 e reprova no de 44px da
   2.5.5 — e o menu do celular do mesmo commit foi para 48px, então a
   inconsistência é interna. `min-h-11 sm:min-h-0` alinha o produto inteiro de uma
   vez, **mas** muda a altura de toda tela: precisa de PR próprio com verificação
   visual rota a rota, e depois (ou junto) do ajuste do cabeçalho da conversa.
   As ações compactas de tabela (28px) precisam do mesmo tratamento só no celular.
2. `/admin/simulador` rola de lado a 320px: falta `minmax(0,1fr)` na grade de uma
   coluna.
3. O separador `·` com `aria-hidden` deixa o nome acessível do link como
   "Recepção+55 ..." sem espaço; a tela de setores tem o separador idêntico e nem
   recebeu o `aria-hidden`.
4. O cartão explicativo da tela de conversa vive dentro da área rolável: numa
   conversa longa com rolagem automática, ele sai da tela. Verdadeiro para conversa
   longa, falso para a curta — fica como observação.

## Médio, e o benefício é claro

### 3.9 Não existe PATCH em `/admin/entry-links`

`patch-de-entry-links-ausente` · médio

O `PROJETO.md` lista `GET/POST/PATCH /admin/entry-links`. Confirmei as rotas que
existem: `GET`, `POST`, `POST /:id/revoke`, `GET /:id/qrcode`, `GET /:id/contacts`.
Não há PATCH, e a tela não oferece edição.

O hospital emitiu "Médico Externo" com três setores, imprimiu o QR e distribuiu
para dezenas de médicos. Agora quer acrescentar a Fisioterapia, ou tirar a
Recepção, ou o rótulo saiu com erro de digitação. A única saída é revogar e criar
outro: todo QR impresso morre e cada contato já vinculado perde o acesso. Isso
quebra justamente a promessa que o `PROJETO.md` faz sobre o redirect no domínio
próprio.

O que fazer: `PATCH /admin/entry-links/:id` no mesmo formato do PATCH de setores,
reusando a resolução de setores que já existe e a regra de lista não vazia, com
`updateMany` + checagem de contagem (zero → 404). Dois cuidados que merecem
comentário no código: código de entrada, slug e tipo **não** são editáveis (o
código já está impresso); e tirar um setor da lista tem efeito imediato no menu de
quem já está vinculado — que é o comportamento certo, mas o formulário deveria
avisar quantos contatos são afetados, usando a rota de contatos que já existe.

### 3.10 O menu desloca quando um setor sai do ar no meio

`menu-desloca-quando-setor-sai-do-ar` · médio

O médico recebe "1 — Recepção / 2 — Cardiologia / 3 — Enfermagem" e larga o
celular. O admin desativa a Recepção. Ele volta, digita "2" achando que pede
Cardiologia, e cai na Enfermagem. Recebe "Você será atendido por *Enfermagem*" e o
sistema trata como escolha dele.

Não é falha de autorização — o destino continua dentro do link — mas num hospital
é encaminhamento errado sem ninguém perceber. A causa é que o menu é numerado por
posição e a lista é remontada na hora da resposta, filtrando setor ativo e
ordenando por `sortOrder`: os dois campos que o admin mexe pelo painel.

O que fazer: congelar o menu enviado. Coluna com os identificadores na ordem
mostrada, preenchida no envio, e a validação da escolha resolvendo contra esse
instantâneo. Se o setor escolhido tiver saído do ar, responder que a opção mudou e
reenviar o menu novo — nunca deslocar em silêncio. Só entra no instantâneo o que
veio da lista do link, então a segunda regra do `CLAUDE.md` continua valendo.

### 3.11 `/admin/access-attempts` devolve o histórico inteiro

`access-attempts-sem-periodo-nem-paginacao` · pequeno

A rota agora converte o período no fuso do hospital (a onda 2 fez isso), mas
quando `from` e `to` não vêm ela devolve `{}` e o repositório busca **tudo**, sem
teto (confirmei em `routes/admin.ts:684-694` e `repositories/accessAttempts.ts:19-27`).
A tela sempre manda período, então o caminho sem filtro só é alcançável chamando a
API direto — mas ele é o padrão da rota, e a rota vizinha de métricas faz o certo.

`access_attempts` é a tabela que mais cresce quando algo dá errado. A tela que
existe para diagnosticar um ataque é a que trava durante o ataque.

O que fazer: período padrão de 30 dias na rota, copiando o que `/admin/metrics` já
faz, e teto de 500 linhas no repositório **com uma contagem separada** — sem o
total, a tela passa a mentir por omissão durante um ataque de verdade.

### 3.12 Revogar link de perfil percorre todos os contatos, um a um

`A30` · pequeno

Confirmei o laço em `routes/admin.ts:527-531`: para cada contato do link, uma
consulta e um encerramento. Um link de perfil aceita número ilimitado de pessoas
**por desenho**. Com milhares de contatos são milhares de idas ao banco numa
requisição só; e a revogação já foi gravada antes do laço, então um tempo limite
deixa o link revogado com metade das conversas ainda vivas, e nada reprocessa.

O que fazer: trocar o laço por um único `updateMany` com
`where: { tenantId, status: { in: ACTIVE_STATUSES }, externalContact: { entryLinkId } }`.
Uma escrita, atômica, independente do número de contatos.

### 3.13 Mensagem com dois códigos vincula pelo primeiro

`reopen-e-codigo-duplicado-fora-da-spec`, parte (b) · pequeno

Quem recebeu dois links do hospital e cola os dois textos é vinculado ao primeiro
código da mensagem, em silêncio, sem nenhum registro de tentativa. Confirmei:
`extractEntryCode` (`utils/text.ts`) devolve a primeira ocorrência. E o vínculo é
definitivo — a regra 8 do `CLAUDE.md` diz que depois do primeiro uso o vínculo é a
fonte de verdade.

O que fazer: devolver todos os códigos encontrados; mais de um significa recusar,
registrar `access_attempt` com motivo de código inválido e pedir que a pessoa mande
um link só. Vínculo definitivo não pode nascer de empate resolvido por posição.

### 3.14 Duplicata de recusa só em memória

`dedupe-de-recusa-so-em-memoria` · pequeno

Os caminhos que não gravam mensagem (recusa, bloqueio, revogação) dependem do
`Map` de `utils/seenMessageIds.ts`, marcado **depois** do processamento sem erro.
Se o envio da resposta de recusa falhar — o caso mais provável de o Twilio
reentregar — a reentrega grava um segundo `access_attempt`. Um pico duplicado de
`nominal_taken` faz o administrador acreditar num vazamento maior do que foi.

O que fazer: guardar o identificador da mensagem na própria linha de
`access_attempts`, com índice único. O critério de duplicata passa a viver no
banco, sobrevive a restart e vale entre instâncias — exatamente como já acontece
com `messages`. Resolve também metade do item 2.6.

### 3.15 Quatro queries chegam ao banco sem `tenant_id`

`queries-sem-tenant-id-em-messages-e-feedback` · médio

Confirmei: `messages.existsByWaMessageId` e `messages.create` não recebem tenant, e
`feedback.createScore`/`updateScore`/`setComment` também não — as tabelas
`messages` e `feedback` **não têm a coluna** (`schema.prisma:381` e `:398`). Os
comentários no código explicam a exceção e a explicação está tecnicamente correta:
a mensagem herda o hospital da conversa.

Não há impacto explorável hoje. O problema é de regra: o `CLAUDE.md` diz "sem
exceção, nem em debug, nem em seed, nem em migração", e o precedente já está no
repositório com comentário justificando. No dia em que alguém acrescentar uma busca
por conteúdo de mensagem, a primeira query vai nascer sem filtro porque não há
filtro para pôr.

O que fazer: seguir o que `internal_messages` já faz — acrescentar `tenant_id` às
duas tabelas, preencher na escrita e filtrar na leitura. A unicidade global do
identificador do Twilio continua valendo como critério de duplicata. Exige migração
com backfill.

### 3.16 Quatro definições independentes de "status ativo"

`A38` · pequeno

Confirmei quatro cópias da mesma lista: `repositories/conversations.ts:5` (a que
roda), `packages/shared/src/index.ts:34` (exportada e não usada por ninguém),
`routes/adminConversations.ts:12` (escrita de novo com outro nome) e o predicado
SQL do índice único parcial na migration.

Se alguém acrescentar um estado ao enum e atualizar só as constantes TypeScript, o
índice deixa de cobrir esse estado e a garantia "uma conversa ativa por contato"
abre um buraco sem nenhum sinal — nem erro, nem teste, nem aviso do Prisma (ver
3.18).

O que fazer: a API importar a constante de `@central/shared` e apagar as cópias, e
um teste barato comparando a lista TypeScript com o predicado real lido do banco.
Depende do item 3.19 (decidir o destino do pacote compartilhado).

### 3.17 O plantão erra uma hora em fuso com horário de verão

`plantao-erra-no-horario-de-verao` · médio

`shiftEndsAt` (`utils/shiftClock.ts:117-124`, confirmado) soma minutos de relógio a
um instante absoluto: `new Date(at.getTime() + restante * 60_000)`. A conta é feita
em minutos de parede e o resultado é somado como se fossem minutos absolutos.

Na noite em que o relógio recua, o plantão de 00:00–06:00 termina às 05:00 locais.
Como o token expira junto com o turno, o atendente é deslogado uma hora antes do
fim, as conversas dele voltam para a fila e o hospital fica descoberto no meio da
madrugada. Na virada oposta, alguém continua recebendo chamado depois de ir
embora — que é o problema que o Sprint 2 inteiro existe para resolver.

Dois auditores mediram o mesmo defeito em execuções independentes, em um fuso com
horário de verão. Baixo enquanto todos os hospitais estiverem em fuso sem DST;
vira alto em silêncio no primeiro cliente fora do Brasil.

O que fazer: montar a data-hora local do fim e resolver o deslocamento daquele
instante no fuso, em vez de somar minutos. O arquivo já usa `Intl` para outra
coisa, então não precisa de dependência nova. **Não fazer sem teste** — matemática
de fuso é fácil de piorar, e os testes ainda não existem (item 2.4).

### 3.18 O índice que sustenta "uma conversa por contato" é invisível às ferramentas

`A26` · pequeno

O índice único parcial é a única coisa que garante uma conversa aberta por contato
entre processos. Se ele sumir (restore de dump antigo, DBA, `db push` em outro
ambiente), **nenhuma ferramenta acusa**: o red team mediu num banco com o índice
apagado e tanto `prisma migrate status` quanto `prisma migrate diff` disseram que
está tudo em ordem. O motor de diff do Prisma é cego a índice parcial.

Dois comentários no repositório afirmam que ele "vira drift" (confirmei os dois: no
`schema.prisma` e na migration). Não vira: ele é invisível.

O que fazer: corrigir os dois comentários e acrescentar uma verificação barata no
boot — uma consulta em `pg_indexes` pelo nome do índice, falhando alto se não
existir. É o único sinal possível.

### 3.19 `packages/shared` não é importado por ninguém

`shared-e-codigo-morto` · médio · **precisa de decisão**

Confirmei: nenhum arquivo de `apps/api/src`, `apps/web/app`, `apps/web/lib` ou
`apps/web/components` importa `@central/shared`. As únicas referências são as duas
dependências declaradas nos `package.json`, a configuração de transpilação do Next
e o nome do próprio pacote. Os DTOs já divergiram da API que deveriam descrever.

Como o pacote não é importado, o compilador nunca lê o contrato. O efeito aparece
na próxima mudança: alguém tira um campo da rota, cada página do front continua
compilando contra a interface que redeclarou à mão, e a tela quebra em produção. É
armadilha — o arquivo parece a fonte de verdade e não é.

Escolher um dos dois e parar de pagar pelo meio-termo:

- **Fica**: importar de verdade nas duas pontas. Na API, tipando o retorno das
  rotas (o compilador acusa a divergência na hora de escrever); no front, apagando
  as interfaces duplicadas. Começar por conversas, detalhe da conversa e painel já
  paga a conta.
- **Não fica**: apagá-lo, tirar das dependências dos dois apps e dos dois
  `buildCommand` do `render.yaml` — hoje ele acrescenta um passo de build em toda
  publicação sem entregar nada.

### 3.20 Consolidar os oito diálogos

`oito-dialogos-reescritos-a-mao` · grande

Oito sobreposições modais, seis escritas à mão, com comportamentos divergentes: em
umas o clique fora fecha, em outras não; uma não trata Escape; os níveis de
cabeçalho variam entre `h2` e `h3`. O administrador aprende em Setores que clicar
fora cancela, repete o gesto em outra tela e fica achando que travou.

Correção: consolidar num componente único — já com a prisão e devolução de foco
que a onda 4 fez no `ConfirmDialog` — e migrar os seis. Padronizar `h2` como
título, `alertdialog` só nas confirmações destrutivas, e fechar na máscara em todos
exceto onde há dado digitado.

PR próprio, e **depois** das correções pequenas de front: toca sete telas e colide
com quase tudo. Critério de pronto: uma varredura por `fixed inset-0` deve devolver
uma ocorrência só.

## Escala e rodízio — cantos que sobraram

Todos verificados, todos de janela estreita. Estão aqui porque cada um deles é
exatamente o tipo de coisa que ninguém consegue reproduzir depois.

### 3.21 O atendente que assume da fila não passa pela mesma trava do rodízio

`A24` · médio

A rota que faz o atendente assumir uma conversa da fila usa `conversations.assignTo`
(`routes/agent.ts:98`), que é um `updateMany` solto com `WHERE status='open' AND
assigned_user_id IS NULL` e nada mais (`conversations.ts:139`). O caminho do
rodízio ganhou transação e `FOR UPDATE` na onda 4; este não.

Se o plantão da pessoa terminar entre a leitura e o UPDATE, a conversa é gravada
como `assigned` para quem já saiu — e some das duas listas até o job de inatividade
a encerrar, 30 minutos depois. A janela é de poucos milissegundos e não foi
observada acontecendo sozinha; o red team a montou com as funções reais.

**Cuidado com o conserto óbvio.** Trocar por `assignToIfOnShift` puro **regride**
um fluxo legítimo: o EXISTS dele exige disponibilidade `available`, e hoje um
atendente "ausente" mas de plantão pode assumir uma conversa da fila respondendo
pela tela. O certo é uma variante que confira só plantão vivo e usuário ativo, sem
disponibilidade, tratando contagem zero como "outro já assumiu ou seu plantão
acabou". Se depois disso `assignTo` ficar sem chamador, apagar.

### 3.22 Encurtar a escala tira o acesso mas não devolve as conversas

`A29` · pequeno

Quando a escala nova ainda cobre o momento mas termina antes, o código só ajusta a
hora de saída da sessão (`shift.service.ts:90-98`, confirmado: o laço chama apenas
`updateSessionEnd`). Se o novo fim já está no passado, o atendente perde o acesso
na hora — o middleware confere a data de fim a cada requisição — e as conversas
dele continuam `assigned`: invisíveis na fila do setor e na tela de qualquer
colega, até o job do minuto seguinte.

O que fazer: quando o novo fim for menor ou igual a agora, tratar como fim de
plantão de verdade e chamar `endShift`, em vez de só ajustar a hora.

### 3.23 Setor desativado continua no rodízio

`A22` · médio

Nem `availableAgentsForDepartment` nem `listOpenForDepartments` olham
`department.active` — confirmei em `users.ts:67-78`. Conversas **novas** já ignoram
o setor desativado, porque o menu vem do link.

Boa notícia: a onda 4 (A03) fez a desativação encerrar as conversas vivas naquele
setor, o que fecha o caso principal deste achado. O que sobra é o resto: uma
conversa que escape do teto de 1000 daquela varredura, ou que volte para `open` por
outro caminho, seria entregue de novo a um atendente de um setor que já sumiu do
painel e do menu.

O que fazer: só filtrar `active: true` no rodízio **seria pior** — a conversa
pararia de vez na fila de um setor invisível. O conserto certo é dar à
`closeActiveInDepartment` a consulta dedicada que ela pediu (um `findMany` por
setor e status ativo, sem teto), fechando a porta na desativação.

### 3.24 Devolver a conversa para a fila apaga a memória do rodízio

`A28` · pequeno

O rodízio ordena por "quem foi atribuído há mais tempo", agrupando por dono. Ao
soltar uma conversa, o código zera dono e data de atribuição — e conversas soltas
somem desse agrupamento. Um atendente que encerra o plantão e volta pode aparecer
como "nunca atribuído" e furar a fila dos colegas.

O red team corrigiu a severidade para baixo: conversas **encerradas** mantêm dono e
data, então a memória sobrevive pelo histórico do dia. O efeito real fica restrito
a um atendente sem nenhuma conversa fechada.

O que fazer, se incomodar: guardar um `lastAssignedAt` no próprio usuário, que
sobrevive à devolução. Manter a data preenchida depois de soltar seria pior — ela
significa "quem está com a conversa agora".

### 3.25 O backfill da migration pode ter fechado a conversa errada

`A27` · trivial (a parte que ainda dá para fazer)

O backfill escolheu a conversa sobrevivente por data de criação e, no empate, por
identificador. O aplicativo desempata só por data. Num empate exato, os dois podem
discordar: no teste do red team, sobreviveu a conversa parada no menu e foi fechada
a que estava em atendimento.

O dano do backfill foi de uma vez só e já passou; a migration está aplicada e não
deve ser editada. O que dá para fazer é dar o mesmo desempate ao aplicativo
(`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]` em `findActiveByContact`), para
que os dois concordem daqui em diante.

## Qualidade do ferramental

### 3.26 A suíte de corridas afirma mais do que garante

`A35` · médio

"RESULTADO: PASSOU — nenhuma corrida reproduzida" é uma afirmação maior que a
garantia da suíte. Confirmei os dois pontos que continuam abertos:

- Cenário 7: a asserção é `if (abertas > 1) falhas++` (linha 464). Um
  `openShiftForUser` que passasse a recusar **sempre** daria zero plantões abertos
  em todas as rodadas, e o cenário diria PASSOU sem ter aberto um plantão sequer.
- Cenário 9: os atrasos são fixos (`r * 4`, linha 547). O red team reimplementou a
  função sem transação e sem `FOR UPDATE` e, com esses mesmos atrasos, 3 de 6
  execuções teriam impresso PASSOU. Com atrasos aleatórios entre 0 e 30 ms, 14 de
  80 rodadas travaram — o defeito é real, o cenário é que virou cara ou coroa.

Os cenários 8, 9 e 10 já ganharam controle explícito (o 10 veio na onda 4 e tem
dente comprovado: com a guarda desligada, falha). Falta o mesmo nos outros.

O que fazer: cada cenário assertar também o limite inferior (no 7,
`abertas === 1`), sortear os atrasos, aumentar o número de rodadas e registrar se a
atribuição aconteceu, exigindo o release correspondente quando aconteceu.

### 3.27 Nenhum linter

`sem-linter` · pequeno · **precisa de decisão**

Confirmei: não existe configuração de ESLint, Biome ou Prettier em lugar nenhum do
repositório, e nem o `next lint` padrão sobreviveu nos scripts do front. O
`CLAUDE.md` exige "sem `any` sem comentário justificando" — hoje isso é verificado
por leitura humana em review.

Numa base desse tamanho com IA escrevendo parte do código, é questão de tempo até
entrar um `as any` silenciando exatamente o tipo que protegeria uma query de
esquecer o filtro do hospital.

O que fazer: um `eslint.config.js` na raiz com apenas as regras que pagam por si —
proibir `any` explícito, promise solta (exige apontar o projeto TypeScript),
variável não usada com prefixo `_` liberado, e comparação estrita. Mais um script
`lint` e o passo no CI. Alternativa de manutenção menor: Biome, abrindo mão da
regra de promise solta.

Ligar o linter numa base sem lint nenhum vai acusar dezenas de violações de uma
vez: **PR próprio**, nunca junto com correção de bug.

### 3.28 Seis vulnerabilidades altas em dependências transitivas

`npm-audit-seis-high` · pequeno

O `npm audit` da auditoria apontou 6 altas, 0 críticas, todas transitivas de `next`
e `prisma`. A análise de exploração naquele momento: a que vem pelo processamento
de CSS só processa CSS gerado no build; a que vem pelo otimizador de imagem não é
alcançável porque `next/image` não é usado; a terceira está no caminho de start mas
processa a configuração do próprio repositório, não entrada de usuário.

Não refiz o `npm audit` — o número pode ter mudado.

O que fazer: `npm audit fix` sem `--force` resolve a cadeia do Prisma sem quebrar
nada. O `--force` puxa a próxima major do Next e quebra o build: precisa de task
própria. O valor maior está no passo de CI (item 2.4), que faz o número aparecer
sozinho.

### 3.29 O login diz quando a senha acertou

`login-revela-plantao` · trivial · **precisa de decisão**

Senha correta fora do plantão responde 403 com o horário da próxima janela; senha
errada responde 401. Quem faz força bruta distingue exatamente quando acertou a
senha, mesmo sem conseguir entrar — e ainda descobre a escala do funcionário, que é
dado operacional do hospital.

Vale só para o papel de atendente; o administrador não tem plantão. O limite de
tentativas que a onda 4 colocou já inviabiliza sondagem em massa, e é a defesa que
realmente importa aqui.

O trade-off: uniformizar custa a mensagem clara de "fora do plantão" na tela de
login, que hoje é boa experiência para o atendente legítimo. No mínimo, não
devolver o horário da próxima janela para quem ainda não se autenticou.

### 3.30 `POST /admin/users` diz se um e-mail existe em outro hospital

`A31` · trivial

Confirmei: `users.emailTaken` consulta o índice único **global**, sem hospital
(o que é correto — o login não tem hospital), e a rota devolve
"este e-mail já está em uso" (`routes/admin.ts:270-272`). O administrador de um
hospital descobre, uma tentativa por vez, quais e-mails têm conta na plataforma
inteira — inclusive os administradores do outro hospital, que é a lista de alvos
que falta para um ataque de senha.

Exige estar autenticado como administrador, o que limita bastante o alcance.

O que fazer: restringir a checagem ao próprio hospital e deixar o índice único
global devolver o erro do banco, que o tratador de erro já traduz em 409 genérico.
Ou manter a checagem global e responder sempre a mesma coisa.

### 3.31 Desvios pequenos do `CLAUDE.md`

`desvios-menores-do-claude-md` · trivial · **um deles precisa de decisão**

Três itens, nenhum urgente:

1. O seed lê variável de ambiente direto, fora do `config.ts` — e o arquivo já
   importa outro módulo de `src/`, então usar o config não custa nada.
2. Os erros de negócio carregam status HTTP dentro da classe, o que a seção
   "Camadas" do `CLAUDE.md` desaconselha. Mas isso é coerente com a **outra** regra
   do mesmo arquivo ("erros de negócio como exceções tipadas, handler único"). O
   problema é que as duas regras se contradizem no papel, não que o código esteja
   errado. Ajustar o `CLAUDE.md` é decisão do dono do repositório.
3. O oráculo de e-mail entre hospitais — é o item 3.30, listado lá.

---

## Se eu tivesse uma semana

Na ordem, e só para deixar registrado o julgamento de quem escreveu isto:

1. As três decisões do bloco 1 que já têm código escrito e podem estar medindo a
   coisa errada: CSAT (1.1), SLA (1.3) e a nota depois do SIM (1.2). São horas de
   trabalho e destravam o painel.
2. A conversa presa em `open` (1.4) — é a única falha silenciosa dos dois lados.
3. Banco de teste isolado e os primeiros testes de cruzamento entre hospitais e de
   escopo do link (2.4, passos 1 a 3). Sem isso, tudo que vier depois é feito no
   escuro.
4. O papel do administrador (1.5) e a revogação de sessão (2.7).
5. `npm ci`, títulos das telas do gestor, o diálogo a 200% e os quatro comentários
   errados (3.1 a 3.4) — meia hora cada, e tiram armadilha do caminho de quem vier
   depois.
