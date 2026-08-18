# O que mudou no código — auditoria de 17/08/2026

Este documento é para quem for **mexer no código depois**. Ele não conta a
história da auditoria (isso está nos outros arquivos desta pasta); ele responde
a uma pergunta só: *o que foi alterado, por quê, e o que quebra se alguém
desfizer sem perceber*.

Está organizado por área do sistema, não por commit — porque quem vai mexer
abre um arquivo, não um `git log`.

Se você só tem cinco minutos, leia duas seções: **Os invariantes novos** e
**Como validar que nada quebrou**. São as duas que evitam estrago.

---

## De onde vieram as mudanças

| Etapa | O que foi | Resultado |
|---|---|---|
| Onda 1 | 10 auditores independentes, só leitura | 128 achados brutos |
| Onda 1b | 5 verificadores reabriram cada achado no código | 91 sobreviveram, 37 descartados |
| Onda 2 | 11 lotes de implementação, um dono por arquivo | commit `d2bd846` — 58 arquivos, +2001/−504 |
| Onda 3 | 7 red teams adversariais + 1 juiz | 62 achados brutos, 42 procedem, 5 descartados (o resto se fundiu com duplicatas) |
| Onda 4 | 6 lotes de implementação | commit `8ea8e0f` — 23 arquivos, +767/−157 |
| — | Adiados com justificativa escrita | 21 |

48 agentes no total. A base dos dois commits é `ff92f62` ("9 corridas"), que
não faz parte da auditoria mas aparece bastante aqui: várias correções da onda 4
consertam efeitos colaterais que `ff92f62` introduziu.

**O que este documento não afirma.** Ele não diz que o sistema está seguro. Diz
o que foi verificado, como, e o que sobrou. A seção final lista as pontas soltas
que eu mesmo encontrei ao escrever isto.

---

## 1. Borda e boot

O tema desta área é: **falhar no boot é mais barato que falhar às três da manhã.**

### O boot recusa configuração perigosa

`apps/api/src/config.ts`

| Guarda | Antes | Agora |
|---|---|---|
| `JWT_SECRET` de exemplo | `dev-secret-troque-em-producao` estava no `.env.example` e funcionava | o processo sai com código 1 se o segredo for esse valor; o `.env.example` vem sem ele e o README gera com `openssl rand -base64 32` |
| Twilio sem token | já barrava | continua barrando |
| Twilio sem validação de assinatura | subia com `TWILIO_VALIDATE_WEBHOOK=false` | sai com código 1 |
| `PUBLIC_BASE_URL` / `WEB_ORIGIN` | `z.string()` — aceitava qualquer coisa | `z.string().url()` e barra final removida |
| `ALLOW_DEMO_SEED` | não existia | portão do seed de demonstração, padrão `false` |

**Por quê.** O repositório é público. Um `JWT_SECRET` que qualquer pessoa lê no
GitHub permite forjar um token `{role:'admin'}` — e `GET /admin/entry-links`
devolve os códigos de entrada, que são o segundo nível de autorização inteiro.
O guard da assinatura fecha o outro lado: sem assinatura, o webhook aceita POST
anônimo, e o único campo que resolve o hospital (`To`) é público por desenho —
sai no 302 de `/c/<slug>` e no QR code.

**Se desfizer.** Volta a ser possível subir a API em produção com chave pública,
ou com o webhook aceitando mensagem forjada, sem nenhum sinal — a API sobe,
`/health` responde 200, e nada nos logs indica o problema.

### `/health` passou a tocar o banco

`apps/api/src/app.ts` — handler de `GET /health`

- **Antes:** respondia `200 {ok:true}` sem consultar nada.
- **Agora:** faz `SELECT 1`; responde `{ok:true, db:'up'}` ou **503**
  `{ok:false, db:'down'}`.
- **Por quê:** é o `healthCheckPath` do `render.yaml`. Um 200 que não toca
  dependência nenhuma deixa o painel verde com o Postgres fora do ar: nada
  reinicia, nada faz rollback, e todo atendente recebe 500 até alguém ligar
  reclamando.
- **Se desfizer:** o Render volta a promover deploy que não conecta no banco.

### Desligamento com drenagem

`apps/api/src/index.ts` — `desligar()`

- **Antes:** o processo morria no `SIGTERM` do deploy, no meio da requisição em voo.
- **Agora:** `desligar()` é idempotente, limpa os dois `setInterval` dos jobs,
  chama `server.close()`, desconecta o Prisma e sai; teto de 20 s, abaixo do
  SIGKILL do Render. `SIGTERM`, `SIGINT` e `unhandledRejection` registrados.
- **Por quê:** `closeWithCsat` grava o encerramento **antes** de enviar a
  pergunta de nota. Morrer entre as duas linhas deixa a conversa em
  `awaiting_feedback` com `closed_at` gravado e ninguém pergunta nada — o job de
  inatividade exclui `awaiting_feedback` de propósito, então nada reprocessa.
- **Se desfizer:** volta o buraco acima, e o pool do Postgres free do Render
  pode segurar conexões que a instância nova precisa.

### Outros

| Mudança | Arquivo | Por quê |
|---|---|---|
| `.gitignore` por categoria (`.env*`, `*.pem`, `*.key`, `*.log`, `*.pdf`) em vez de nomes exatos | `.gitignore` | `.env.local` e `.env.production` passavam pelo filtro antigo |
| `seed-if-empty.ts` importa `../src/config` e marca `process.exitCode = 1` quando o seed em si falha | `apps/api/scripts/seed-if-empty.ts` | seed que falha em banco vazio tem que derrubar o deploy, senão o Render promove uma API sem tenant e sem admin |
| "banco populado" passou a contar **usuários**, não só tenants | idem | `prisma/seed.ts` não é transacional: uma queda no meio dele deixava tenant sem admin, e o start seguinte saía pelo atalho e subia verde com ninguém conseguindo logar |
| Log do boot mostra `webOrigin` e `publicBaseUrl` efetivos | `apps/api/src/index.ts` | quando o CORS bloqueia o front inteiro, essa linha é a diferença entre investigar horas e investigar trinta segundos |

---

## 2. Autorização

São **dois níveis**, e a auditoria mexeu nos dois. O primeiro (tenant) já
estava sólido: os red teams fizeram 27 requisições cruzadas entre hospitais em
todos os endpoints com `:id` e receberam 404 em todas — nunca 403. O segundo
(o link como credencial) tinha buracos reais.

### O atendente só abre conversa do setor dele

`apps/api/src/repositories/conversations.ts` — `findByIdForAgent()`
`apps/api/src/routes/agent.ts` — cinco handlers de `/agent/conversations/:id`

- **Antes:** os handlers usavam `findById` / `findByIdWithRelations`, que filtram
  só por `tenantId`.
- **Agora:** `findByIdForAgent(tenantId, userId, id)` aplica a mesma regra da
  lista do atendente: *a conversa é minha OU do meu setor*. Usado em
  `GET messages`, `POST messages`, `POST close`, `GET transfer-targets` e
  `POST transfer`.
- **Por quê:** com um id vazado — print, URL colada no grupo da equipe —
  qualquer atendente abria o histórico de um paciente de setor alheio,
  respondia pelo WhatsApp do hospital em nome daquele setor e ainda tirava a
  conversa da fila de quem devia atender.
- **Se desfizer:** volta o IDOR entre setores dentro do mesmo hospital.
- **404, nunca 403** — pela mesma razão que vale entre hospitais: quem não pode
  ver não recebe confirmação de que a conversa existe.

### A lista de setores vem do link **vivo** do contato

Três pontos mudaram para a mesma regra:

| Ponto | Arquivo / função | Antes | Agora |
|---|---|---|---|
| Encaminhamento | `services/transfer.service.ts` — `listTransferTargets`, `transferConversation` | usava o `entryLinkId` gravado **na conversa** (o snapshot) | usa `conversation.externalContact.entryLinkId` — o link vigente do contato |
| Link revogado | `repositories/entryLinks.ts` — `listDepartmentsForLink` | filtrava só `department.active` | exige também `entryLink: { tenantId, active: true }` |
| MENU | `services/lifecycle.service.ts` — `handleMenuKeyword` | decidia pelo **tamanho** da lista | compara o setor **atual** com a lista (`atualPermitido`) |

**Por quê o snapshot não serve para autorizar.** `entry_link_label_snapshot`
existe para o relatório do mês passado não virar mentira quando o link é
renomeado. Ele é histórico. Usá-lo para decidir o que a pessoa pode acessar
significa que reatribuir o contato pelo painel não muda nada no atendimento em
curso.

**Por quê o MENU não pode olhar só o tamanho.** Se a conversa está parada num
setor que o link vigente já não permite e a lista tem um item só, "você já está
falando com ele" é mentira — e fecha a única saída que o externo tem. Sobrariam
os 30 minutos do job de inatividade.

### A conversa **viva** também tem que estar dentro do link

`apps/api/src/services/lifecycle.service.ts` — `closeActiveOutsideLinkScope()` e `closeActiveInDepartment()`
`apps/api/src/routes/admin.ts` — `PATCH /admin/contacts/:id`, `PATCH` e `DELETE /admin/departments/:id`

- **Antes:** o segundo nível de autorização valia para o menu, para a escolha
  numérica e para a lista de encaminhamento. Não valia para a conversa que já
  estava rodando.
- **Agora:** reatribuir um contato a outro link, ou desativar um setor, encerra
  a conversa viva que ficou fora do escopo, com `close_reason=access_revoked` e
  **sem CSAT**.
- **Por quê:** sem isso, o externo continuava conversando dentro de um setor que
  o link dele não autoriza, o atendente daquele setor seguia respondendo pelo
  WhatsApp do hospital, e a cada fim de plantão o rodízio devolvia a conversa
  para a fila do **mesmo setor proibido**. O PROJETO.md promete que o setor
  desativado "some do menu automaticamente" — some do menu e do atendimento em
  curso também, senão a promessa vale só para quem ainda não tinha escrito.
- **Decisão de produto embutida:** encerra, não move. É exatamente o que a
  revogação de link e o bloqueio de contato já fazem três linhas abaixo, com o
  mesmo `close_reason`. Mover exigiria escolher um setor pela pessoa.
- **Detalhe que parece bug e não é:** conversa em `awaiting_department` (ainda
  sem setor) é ignorada de propósito — a escolha seguinte já é validada contra a
  lista do link novo.
- **Se desfizer:** volta o pior furo de produto encontrado na auditoria.

### Revogar link encerra as conversas dele

`apps/api/src/routes/admin.ts` — `POST /admin/entry-links/:id/revoke`

- **Antes:** marcava o link como inativo e pronto.
- **Agora:** varre `externalContacts.listByLink` e encerra a conversa ativa de
  cada contato com `access_revoked`.
- **Por quê:** revogar sem encerrar revoga só no papel — a conversa viva
  continuava na tela do atendente e cada resposta saía de verdade pelo WhatsApp
  para quem acabou de perder o acesso.
- **Pendência conhecida:** com link de perfil e milhares de contatos, isso são
  milhares de round-trips dentro de uma requisição (adiado, item A30).

### A posse de link nominal é serializada pelo banco

`apps/api/src/repositories/entryLinks.ts` — `withLinkClaim()`
`apps/api/src/services/access.service.ts` — `resolveAccess()`
`apps/api/src/routes/admin.ts` — `PATCH /admin/contacts/:id`

- **Antes:** a exclusividade do link nominal era garantida por uma fila em
  memória, que vale por **processo**.
- **Agora:** `withLinkClaim(tenantId, id, fn)` abre uma transação, faz
  `SELECT … FOR UPDATE` na linha de `entry_links` (com `tenant_id` no WHERE) e
  roda a leitura do dono + a criação do contato dentro dela. Os **dois** caminhos
  que disputam a posse usam essa trava: o webhook e o painel.
- **Por quê:** a fila do webhook é por **contato**, e dois números novos são
  contatos diferentes — os dois liam "link livre" e os dois criavam vínculo.
  Depois disso o vínculo é a fonte de verdade (regra 8) e o número que entrou de
  carona fica autorizado para sempre, **sem nenhum `nominal_taken` no painel** —
  que é justamente o alarme de link vazado (regra 9).
- **Se desfizer:** o alarme de vazamento de link nominal volta a ter um furo que
  não deixa rastro.

### Link de perfil: corrida de criação resolvida no repositório

`apps/api/src/repositories/externalContacts.ts` — `createOrGet()`
`apps/api/src/services/access.service.ts` — `resolveContatoConhecido()`

- **Antes:** `create` nu. Duas mensagens do mesmo número novo estouravam com
  P2002 e a mensagem sumia.
- **Agora:** `createOrGet` faz `create` com `catch` de P2002 e relê o contato —
  mesmo padrão de `conversations.createOrGetActive`. Se o contato que voltou tem
  **outro** `entryLinkId`, o fluxo desvia para `resolveContatoConhecido`, para o
  setor oferecido sair do vínculo gravado e não do código desta mensagem.
- **Se desfizer:** mensagem legítima descartada em corrida, e — pior — o menu
  montado pelo código da mensagem em vez do vínculo do banco.

---

## 3. Ciclo de vida da conversa

Esta é a área com mais invariantes novos. Leia a seção 8 junto.

### "Uma conversa ativa por contato" saiu da memória e virou índice do banco

`apps/api/prisma/migrations/20260817170100_conversa_ativa_unica/migration.sql`
`apps/api/src/repositories/conversations.ts` — `createOrGetActive()`

- **Antes:** garantido só pelo `keyedQueue`, que serializa dentro de **um**
  processo.
- **Agora:** índice único **parcial** `conversations_uma_ativa_por_contato` em
  `(tenant_id, external_contact_id)`, restrito aos quatro `ACTIVE_STATUSES`
  (`awaiting_feedback` fica de fora de propósito — é o estado em que a pessoa
  pode abrir conversa nova enquanto ainda responde a nota). A migration fecha as
  duplicatas já gravadas antes de criar o índice.
- **Por quê:** com dois processos — janela de deploy, instância velha drenando —
  duas mensagens seguidas do mesmo número leem "não há conversa ativa" e as duas
  criam. O contato recebe dois menus, responde num só, e a outra conversa fica
  viva até o job de inatividade fechá-la meia hora depois.
- **Cuidado de manutenção:** o Prisma não modela índice parcial. Ele existe só
  no SQL da migration, e está **anotado em comentário** no `schema.prisma`
  (linhas 372-374). Nem `migrate status` nem `migrate diff` o enxergam. Se ele
  sumir — restore de dump antigo, `db push` em outro ambiente — nada acusa.

### `criada`: o índice fecha a linha duplicada, não a mensagem duplicada

`apps/api/src/repositories/conversations.ts` — `CreateConversationResult`
`apps/api/src/services/conversation.service.ts` — `startConversation()`
`apps/api/src/services/lifecycle.service.ts` — `reopenMenu()`

- **Antes:** `create()` devolvia a conversa e pronto. Quem perdia a corrida
  seguia o fluxo de abertura em cima da conversa alheia: mandava o menu de novo,
  mandava "você será atendido por X" de novo, e chamava o rodízio de novo.
- **Agora:** `createOrGetActive` devolve `{ conversation, criada }`. Com
  `criada === false`, `startConversation` persiste a mensagem inbound e **para**
  — e, se a conversa estiver em `awaiting_department`, encaminha a mensagem para
  `handleDepartmentChoice`, que é o que o fluxo normal faria. `reopenMenu`
  simplesmente retorna.
- **Se desfizer (ignorar o `criada`):** volta o menu duplicado — exatamente o
  que o índice único existe para evitar.
- **Ponta solta:** a função antiga `conversations.create()` continua no arquivo
  e o comentário dela diz que `reopenMenu` ainda a usa. **Não usa mais** — a
  migração aconteceu na onda 4. Confirmei por grep: hoje ela é código morto e o
  comentário está desatualizado.

### O critério do CSAT mudou (mudança de contrato — ver seção 7)

`apps/api/src/services/lifecycle.service.ts` — `closeWithCsat()`

### Nota do CSAT: aceita "07" e aceita correção

`apps/api/src/services/lifecycle.service.ts` — `parseScore()`, `handleFeedbackMessage()`
`apps/api/src/repositories/feedback.ts` — `updateScore()`

- **Antes:** regex `/^(10|[0-9])$/` — "07" e " 7 " eram recusados. E recusar não
  é neutro: o chamador fecha sem nota e **abre conversa nova**, jogando a pessoa
  na fila de um ramal. Um número mandado logo depois da nota virava o texto do
  comentário: o gestor lia "nota 9, comentário 2".
- **Agora:** `parseScore` aceita `^\d{1,2}$` com valor ≤ 10 — pega "07", " 7 ",
  "10", "0"; recusa "11", "-1", "5.5", vazio. Dentro da janela de 10 min, um
  número solto **substitui** a nota via `feedback.updateScore`, o externo recebe
  "Sua nota foi atualizada. Obrigado!" e a janela segue aberta para um comentário
  de verdade.
- **Se desfizer:** volta o "nota 9, comentário 2" no painel do gestor, ou a
  pessoa que digita "07" cai numa conversa nova.

### Toda transição de estado passa a ter precondição no WHERE

Ver seção 8, invariante 1. É a mudança mais transversal da auditoria.

---

## 4. Plantão e rodízio

Aqui mora o bug mais caro que a auditoria encontrou — e ele tinha sido
**introduzido** pela correção anterior.

### A ordem de travas (o deadlock ABBA)

`apps/api/src/services/shift.service.ts` — `endShift()`, `expireDueShifts()`
`apps/api/src/repositories/conversations.ts` — `assignToIfOnShift()`
`apps/api/src/repositories/users.ts` — `update({active:false})`, `deactivate()`

- **Antes de `ff92f62`:** os caminhos que encerram plantão eram statements em
  autocommit. Sem transação, sem deadlock — e com a corrida do cenário 9 aberta.
- **`ff92f62`:** envolveu `endShift` e `expireDueShifts` em transações para
  fechar a corrida. Mas com as ordens de lock invertidas: um trancava `users`
  antes de `shift_sessions`, o outro o contrário. **Ciclo ABBA.** O juiz mediu
  17 deadlocks (`40P01`) em 30 rodadas, e a vítima era quase sempre o login do
  atendente na virada de turno — o pior momento possível.
- **Agora:** todos os caminhos travam na mesma ordem: **`users` → `shift_sessions`
  → `conversations`**. Em `expireDueShifts` isso é comprado por um
  `SELECT 1 FROM users … FOR UPDATE` que é o **primeiro statement da transação**
  e não escreve nada.
- **Por que não simplesmente adiantar o `setAvailability`:** é o `count` do
  `closeExpiredSession` que decide se há algo a soltar. Gravar `offline` antes
  marcaria fora do ar justamente quem o admin acabou de esticar. O `FOR UPDATE`
  compra a ordem de travas sem comprar a semântica.
- **Se desfizer:** volta o `40P01` derrubando fim de plantão e login na troca de
  turno.

### O rodízio confere tudo dentro do próprio UPDATE

`apps/api/src/repositories/conversations.ts` — `assignToIfOnShift()`

- **Antes:** o `EXISTS` do SQL cru conferia plantão aberto, `active` e
  `availability`. O comentário afirmava espelhar
  `users.availableAgentsForDepartment` — e não conferia **setor** nem **role**.
- **Agora:** o `EXISTS` recebe o `departmentId` da conversa, faz JOIN em
  `user_departments` e exige `u.role = 'agent'`. Condição por condição igual ao
  WHERE de `availableAgentsForDepartment`.
- **Por quê:** o admin que salva **só os setores** de alguém cai no ramo `count`
  de `users.update` e **não escreve na linha de `users`** — então o `FOR UPDATE`
  não o segura. A conversa caindo num atendente de outro setor a tira da fila do
  setor (que só mostra `open`) e a joga em "minhas conversas" de quem não atende
  mais aquele ramal. É falha de autorização, não detalhe de UX.
- **Nota técnica:** `user_departments` não tem coluna de tenant — o tenant entra
  pelo `u.tenant_id` do JOIN.
- **Se desfizer:** a conversa volta a poder ser entregue a quem não atende
  aquele ramal, e some das duas listas.

### O login não espera a distribuição da fila

`apps/api/src/services/shift.service.ts` — `openShiftSemFila()`
`apps/api/src/services/routing.service.ts` — `assignPendingForUser()`

- **Antes:** `await assignPendingForUser(...)` dentro do login. Com 100 conversas
  paradas, `POST /auth/login` levava ~6,6 s — e uma atribuição que falhasse
  rejeitava o login **depois** de a sessão de plantão já existir.
- **Agora:** `void assignPendingForUser(...).catch(logar)` depois do
  `setAvailability`; e cada `tryAssign` dentro de `assignPendingForUser` tem
  `try/catch` próprio.
- **Por quê:** nada no resultado do login depende da distribuição. O que não for
  distribuído continua `open`, à vista de todo mundo na fila do setor.
- **Se desfizer:** a lentidão volta exatamente no pior momento — a virada de
  turno, quando a fila está grande.

### Outras mudanças de plantão

| Mudança | Arquivo / função | Por quê |
|---|---|---|
| `endShift` solta as conversas e fecha a sessão na **mesma transação** | `shift.service.ts` — `endShift` | fechar antes e soltar depois prende conversa em quem perdeu o acesso; soltar antes e fechar depois faz o rodízio devolver a conversa para quem está saindo |
| `reofferConversations` extraída e exportada | `shift.service.ts` | a reoferta manda efeito externo e não pode ficar dentro da transação; e sair do plantão não é a única porta que larga conversas |
| `expireDueShifts` confere "turno seguinte já começou" **antes** de soltar | `shift.service.ts` | derrubar quem acabou de entrar é o pior momento possível |
| `exp` do token = `MAX_SHIFT_HOURS` (16 h), não o `endsAt` lido no login | `routes/auth.ts` | o admin pode **estender** a escala depois do login; o token assinado não acompanhava e o atendente caía no meio do plantão. O fim de verdade continua conferido a cada requisição em `requireAuth` |
| Tirar alguém de um setor devolve as conversas fora do novo escopo para a fila | `repositories/users.ts` — `update()` | a conversa ficava com `assignedUserId` de quem saiu: sumia da fila e seguia em "minhas conversas" de quem não atende mais o ramal |
| `PUT` de escala valida de verdade "máx. 3 faixas por dia" e recusa faixas idênticas | `routes/admin.ts` — `shiftsPutSchema` | o `.max(21)` prometia três por dia e não entregava |

---

## 5. Webhook e entrada da mensagem

### A regra do 200 vale para a rota inteira

`apps/api/src/routes/webhook.ts`

- **Agora:** o `try/catch` do handler loga uma linha JSON (`evento`,
  `messageSid`, `from`/`to` **mascarados**, mensagem do erro) e responde 200; e
  um error handler **do router** garante 200 também para o que estoura antes do
  handler — o `PayloadTooLargeError` do `express.urlencoded`, por exemplo.
- **Por quê:** 500 faz o Twilio reentregar em loop.
- **Exceção documentada e medida:** a recusa de assinatura **não** passa por
  aqui. O middleware do SDK da Twilio escreve a resposta ele mesmo e não chama
  `next(err)`. Com token configurado é 403 (intencional). Com validação ligada e
  **sem** token é 400 (sem o header) ou **500** (com ele) — e o 500 é o que faz
  o loop. Por isso `TWILIO_VALIDATE_WEBHOOK` só entra junto com
  `WHATSAPP_PROVIDER=twilio`: o `config.ts` recusa o boot no sentido inverso e o
  `render.yaml` mantém as três chaves no mesmo bloco comentado.

### Número fora do E.164 é descartado antes de tocar o banco

`apps/api/src/utils/phone.ts` — `normalizeWaNumber()`, `mascararNumero()`
`apps/api/src/services/webhook.service.ts` — `handleInbound()`

- **Antes:** `normalizeWaNumber` devolvia `string` sempre.
- **Agora:** devolve `string | null`, validando `^\+[1-9]\d{7,14}$`.
- **Por quê:** um `From` arbitrário vira linha em `access_attempts` — a tela onde
  o admin descobre que um link nominal vazou — e esconde o vazamento real no meio
  do ruído. Um `From` vazio viraria contato de número `'+'`, que o
  `@@unique([tenantId, waNumber])` aceita numa boa.
- **Junto veio `mascararNumero`:** todo log de número mostra só os 4 últimos
  dígitos. O log vai para o painel da plataforma, que tem outra política de
  acesso e outra retenção que o atendimento.

### Anexo não vira bolha vazia nem escolha de menu

`apps/api/src/services/webhook.service.ts` — `dispatchInbound()`
`apps/api/src/services/texts.ts` — `MSG_ATTACHMENT_BODY`, `MSG_ONLY_TEXT`

- **Agora:** `numMedia` entrou no `InboundMessage`. Anexo **sem legenda**
  persiste com `[a pessoa enviou um anexo — este canal só lê texto]` e **não
  passa pela máquina de estados**: não conta como escolha inválida de menu, não
  incrementa `menu_retries`, não é lido como MENU/SIM/NÃO nem como nota.
  Qualquer mensagem com mídia recebe `MSG_ONLY_TEXT`, persistida na conversa
  (regra 3: persista tudo).
- **Se desfizer:** quatro fotos seguidas jogam a pessoa no primeiro setor do
  link — o sistema escolhendo por ela.

### Menu aceita emoji e dígito de largura larga

`apps/api/src/services/conversation.service.ts` — `parseMenuChoice()`

- **Agora:** normaliza NFKC (resolve `１`), remove `U+FE0F`/`U+20E3` (resolve o
  keycap `1️⃣`), faz trim e remove pontuação **só no fim** (`1.`, `2)`).
- **Por que só no fim:** varrer todo não-dígito faria "falar com o 2º andar"
  virar a opção 2.

### Dedupe em duas camadas

- **Banco (fonte de verdade):** `wa_message_id` UNIQUE em `messages`.
- **Memória (`utils/seenMessageIds.ts`):** cobre os caminhos que **não gravam
  mensagem** — recusa, bloqueio, revogação —, onde a reentrega do Twilio infla
  `access_attempts`. TTL de 6 h, teto de 20 mil entradas. Limitação assumida por
  escrito: não sobrevive a restart e não vale entre instâncias; o pior caso é um
  `access_attempt` repetido, nunca uma conversa duplicada.

---

## 6. Login e limite de tentativas

`apps/api/src/middleware/rateLimit.ts` (arquivo novo)
`apps/api/src/routes/auth.ts`
`apps/api/src/app.ts`

| Peça | Antes | Agora |
|---|---|---|
| Comparação de senha | `bcrypt.compareSync` | `bcrypt.compare` serializado por `runSerialized('login:senha')` |
| E-mail inexistente | retornava rápido | compara contra um **hash-isca** gerado no boot |
| Limite | não existia | dois baldes de 15 min: **10 por origem** (IP+e-mail) e **20 por conta** (só o e-mail) |
| `trust proxy` | `true` | **`1`** |
| Login com senha certa recusado por escala | gastava o balde | `perdoarLogin(req)` limpa as marcas |

**Por que dois baldes.** Atrás do proxy do Render um IP é compartilhado — limitar
só por IP derruba quem não tentou nada. Mas o mesmo proxy é o que torna o IP
forjável: `req.ip` sai do `X-Forwarded-For`, um header do cliente. Com
`trust proxy: true` o Express acredita no header inteiro e resolve `req.ip` como
a entrada mais à **esquerda** — bastava incrementar um número a cada tentativa
para o balde nunca encher. Com `1` (o Render é um salto só), `req.ip` é o
endereço que o proxy anexou.

**Por que `perdoarLogin` fica antes da recusa por escala.** O atendente que tenta
entrar antes do turno vê "próxima janela: hoje, 19:00" — uma mensagem que
convida a insistir. Dez tentativas enquanto esperava davam 429, e quando a
escala abria ele continuava trancado. A chamada fica logo depois de
`if (!user || !senhaConfere) throw`: é o ponto em que a credencial já está
provada certa.

**Verificado antes de mexer no `trust proxy`:** a validação de assinatura da
Twilio consome `request.protocol` + `host` + `originalUrl`. Com 1 salto,
`req.protocol` continua lendo `X-Forwarded-Proto` e a URL remontada não muda.

**Se desfizer:** volta a força bruta ilimitada contra a conta de administrador —
que enxerga a conversa de todos os pacientes — e o `compareSync` segurando o
event loop que entrega o webhook do Twilio.

---

## 7. Métricas e fuso horário

### A janela do relatório é o calendário do hospital

`apps/api/src/utils/shiftClock.ts` — `dayRangeInZone()`
`apps/api/src/routes/admin.ts` — `localDateSchema`, `janelaDoTenant()`
`apps/web/app/admin/dashboard/page.tsx`

- **Antes:** `z.coerce.date()` lia `2026-08-17T00:00:00` (sem offset) como hora
  local **do processo**. Com o Node em UTC, "hoje" para um hospital em São Paulo
  começava às 21h de ontem — três horas de todo dia caíam no relatório do dia
  seguinte.
- **Agora:** a rota aceita data pura `AAAA-MM-DD` e `dayRangeInZone` calcula a
  meia-noite local e o último milissegundo do dia local pelo `timezone` do
  tenant, com duas passadas para a virada do horário de verão. Vale para
  `/admin/metrics` e `/admin/access-attempts`.

### SLA e taxa de resposta do CSAT ganharam denominador honesto

`apps/api/src/services/metrics.service.ts` — `computeMetrics()`

- **`slaPct`:** o denominador passou a ser "conversas do período cujo prazo já
  venceu" (`firstReplyAt || closedAt`). **Antes** dividia só entre as
  respondidas, e a madrugada em que 90 de 100 pessoas foram ignoradas exibia
  **100%** ao lado de "Encerradas sozinhas: 90%". A leitura antiga virou o campo
  `slaPctEntreRespondidas`, mostrada no tooltip do card.
- **`csatResponseRate`:** deixou de dividir por todas as encerradas e passou a
  dividir pelas que receberam a pergunta.
- **Adiado (item A23):** o novo denominador do SLA inclui conversa que ninguém
  do hospital **podia** responder (encerrada sem nunca escolher setor).

---

## 8. Os invariantes novos

Esta é a seção que importa num refactor. São regras que o código cumpre hoje e
que **um refactor bem-intencionado quebra sem perceber**, porque nenhuma delas é
verificada pelo compilador.

### 1. Toda transição de estado da conversa passa por `updateMany` com a precondição no WHERE — e alguém confere o `count`

**Onde mora:** `apps/api/src/repositories/conversations.ts` —
`moveStatus`, `closeIfUnchanged`, `closeIfActive`, `touchIfActive`,
`transferDepartment`, `assignTo`, `assignToIfOnShift`,
`markFirstReplyOnce`, `markFirstAssignedOnce`.

**A regra em uma frase:** nunca ler a conversa, decidir, e escrever. O estado
lido entra no `WHERE`; se o `count` voltar zero, **não faça mais nada**.

| Função | O que vai no WHERE além de `tenantId` e `id` |
|---|---|
| `moveStatus` | o status **de origem** |
| `closeIfUnchanged` | status + `departmentId` + `assignedUserId` lidos |
| `closeIfActive` | status em `ACTIVE_STATUSES` |
| `touchIfActive` | status em `ACTIVE_STATUSES` |
| `transferDepartment` | status em (`open`,`assigned`) + setor **de origem** |
| `assignTo` | `status='open'` e `assignedUserId IS NULL` |
| `assignToIfOnShift` | o acima + `EXISTS` de plantão/role/setor/disponibilidade |
| `markFirstReplyOnce` | `firstReplyAt IS NULL` (write-once) |
| `markFirstAssignedOnce` | `firstAssignedAt IS NULL` (write-once) |

**Por quê:** três caminhos encerram a mesma conversa — o job de inatividade, o
botão do atendente e o "SIM" do MENU — e **nenhum passa pela fila dos outros**.
O job não passa pela fila por contato do webhook.

**O que quebra se desfizer:** a escolha do setor **ressuscita** a conversa que o
job acabou de matar, deixando `closed_at` e `close_reason=timeout` gravados numa
conversa viva. O externo recebe a pergunta de nota duas vezes. `close_reason`
vira sorteio. E "timestamps são o produto" — as métricas dependem só deles.

**Como reconhecer que alguém quebrou:** um `findFirst` seguido de `update`, ou
um `updateMany` cujo `count` ninguém lê.

### 2. A ordem de travas é sempre `users` → `shift_sessions` → `conversations`

**Onde mora:** `services/shift.service.ts` (`endShift`, `expireDueShifts`),
`repositories/users.ts` (`update({active:false})`, `deactivate`),
`repositories/conversations.ts` (`assignToIfOnShift`).

**A regra:** toda transação que encosta em mais de uma dessas tabelas trava a
linha do usuário primeiro. Em `endShift` isso sai de graça, porque o
`setAvailability` é a primeira escrita. Em `expireDueShifts` custa um
`SELECT 1 … FOR UPDATE` explícito, que não escreve nada e existe **só** para
comprar a ordem.

**O que quebra se desfizer:** deadlock ABBA (`40P01`), medido em 17 de 30
rodadas, derrubando login e fim de plantão na virada de turno.

**Exceção que você precisa conhecer:** o ramo "só setores" de `users.update`
(quando o admin salva apenas os setores de alguém) **não escreve na linha de
`users`** — usa `tx.user.count`. Por isso o `FOR UPDATE` não o segura, e por isso
o invariante 3 existe.

### 3. O rodízio confere setor, role, plantão e disponibilidade **dentro do próprio UPDATE**

**Onde mora:** `repositories/conversations.ts` — `assignToIfOnShift()`, o `EXISTS`
do SQL cru.

**A regra:** ler os elegíveis e gravar em consultas separadas não vale. Quem
recebe a conversa tem que satisfazer as quatro condições **no instante do
UPDATE**, não no instante em que foi escolhido.

**O que quebra se desfizer:** a conversa vai para quem encerrou o plantão no meio
do caminho, ou para quem o admin acabou de tirar do setor. E aí ela **some das
duas listas** — a fila do setor só mostra `open`, e quem saiu não a enxerga mais.
Trinta minutos até o job de inatividade encerrar, com a pessoa do lado de fora
falando sozinha.

**Cuidado extra:** o SQL é cru porque `updateMany` do Prisma não filtra por
relação de forma atômica. Trocar por `updateMany` "para ficar mais limpo"
reabre o buraco.

### 4. A lista de setores mostrada ou aceita para um externo vem sempre do link **vivo** do contato

**Onde mora:** `repositories/entryLinks.ts` — `listDepartmentsForLink()`, e os
cinco pontos que a chamam: menu inicial (`startConversation`), validação da
escolha (`handleDepartmentChoice`), MENU (`handleMenuKeyword`), lista e validação
de encaminhamento (`transfer.service.ts`), e a conferência da conversa viva
(`closeActiveOutsideLinkScope`).

**Três palavras carregam a regra:**
- **do link** — nunca `listDepartments(tenantId)`;
- **vivo** — `entryLink.active: true` e `department.active: true` no filtro;
- **do contato** — `externalContact.entryLinkId`, **nunca** o `entryLinkId`
  gravado na conversa (esse é snapshot de histórico).

**O que quebra se desfizer:** o externo escolhe "3" e cai num setor que o link
dele não permite. Isso é falha de autorização, não bug de UX — está escrito no
CLAUDE.md.

### 5. A posse de link nominal é serializada **por link**

**Onde mora:** `repositories/entryLinks.ts` — `withLinkClaim()`. Chamada pelo
webhook (`access.service.ts`) e pelo painel (`PATCH /admin/contacts/:id`).

**Por que não dá para serializar por contato:** a fila do webhook é por contato,
e dois números novos **são contatos diferentes**. Eles nunca se cruzam nessa
fila.

**O que quebra se desfizer:** dois números ficam vinculados ao mesmo link
nominal, o segundo fica autorizado para sempre (regra 8: o vínculo é a fonte de
verdade), e **nenhum `nominal_taken` chega ao painel** — que é o alarme de link
vazado (regra 9). O sintoma é a ausência de um alarme, o que é o pior tipo de
sintoma.

### 6. `awaiting_feedback` não é estado ativo — em quatro lugares

O conjunto "estados que bloqueiam abrir outra conversa" está escrito **quatro
vezes**: em `ACTIVE_STATUSES` (TS), no `WHERE` do índice único parcial (SQL da
migration), no `listStaleForTimeout` (que exclui `open` também) e nas guardas de
`transfer.service.ts`. Nenhum teste amarra os quatro.

**Se você acrescentar um estado ao enum `ConversationStatus`:** atualize o índice
parcial junto, com migration nova. Só atualizar as constantes TypeScript abre um
buraco silencioso na garantia "uma conversa ativa por contato" (item A38, adiado).

---

## 9. As duas mudanças de contrato

Estas duas mudam o que o código **devolve** e o que a API **responde**. Quem
depende delas tem que saber.

### 9.1 `closeWithCsat` devolve `boolean`, e o endpoint de encerrar pode responder erro

`apps/api/src/services/lifecycle.service.ts` — `closeWithCsat()`, `closeFromAgent()`
`apps/api/src/routes/agent.ts` — `POST /agent/conversations/:id/close`

| | Antes | Agora |
|---|---|---|
| `closeWithCsat` | `Promise<void>` | `Promise<boolean>` |
| `closeFromAgent` | `Promise<void>` (descartava) | `Promise<boolean>` |
| `POST …/close` | sempre `200 {ok:true}` | `200 {ok:true}` ou **409** `esta conversa mudou de setor ou já havia sido encerrada` |

**O que `false` significa:** a conversa já estava em `closed`/`awaiting_feedback`,
**ou** o `count` do `closeIfUnchanged` voltou zero — alguém encaminhou,
assumiu ou encerrou entre a leitura e a escrita.

**Por que 409 e não 400:** o pedido está bem formado; é o estado do recurso que
impede. É a definição que o próprio `errors.ts` do projeto usa.

**Quem já consome o retorno:**
- `handleMenuConfirm` — só chama `reopenMenu` se o encerramento **valeu**. Sem
  isso, o "SIM" numa corrida com o fim de plantão deixava **duas** conversas
  ativas para o mesmo contato: a antiga voltava para `open` e ficava na fila para
  sempre (o job de inatividade não varre `open`) enquanto o externo conversava na
  nova.
- `POST …/close` — sem conferir, o atendente fechava a tela achando que tinha
  encerrado, com a conversa viva no setor novo.

**Front:** não precisou mudar. `apps/web/lib/api.ts` já trata qualquer não-2xx
pelo `ApiError` com a mensagem do corpo, então o atendente vê a frase.

**Se desfizer (voltar a descartar o boolean):** volta a conversa fantasma e o
falso "encerrado" na tela.

### 9.2 O critério do CSAT mudou

`apps/api/src/services/lifecycle.service.ts` — `closeWithCsat()`, variáveis
`chegouAAlguem` e `encerradaPorGente`.
Texto correspondente: `PROJETO.md` §3 (e a qualificação no §2).

**A história em três passos:**

1. **Antes da auditoria:** o PROJETO.md dizia "Satisfação — enviada **sempre**",
   e o código perguntava em 100% dos encerramentos — inclusive na conversa que
   morreu no menu sem nunca chegar a ninguém.
2. **Onda 2:** o critério virou `firstReplyAt !== null`. Fechou o caso "morreu no
   menu" e **abriu outro**: o atendimento resolvido por telefone deixou de
   perguntar. O atendente assume da fila, resolve por telefone e clica em
   encerrar sem escrever nada — e a tela dele promete a pesquisa em dois lugares
   que não aconteciam.
3. **Onda 4 (o que vale hoje):**

```ts
const chegouAAlguem   = conversation.firstAssignedAt !== null;
const encerradaPorGente = reason === 'agent_closed' || reason === 'user_switched';
const askCsat = tenant?.csatEnabled === true && (chegouAAlguem || encerradaPorGente);
```

**Em português:** pergunta-se a nota quando o atendimento **chegou a alguém do
hospital** (`first_assigned_at` preenchido) **ou** quando foi **gente** que
encerrou — o atendente pelo botão (`agent_closed`) ou o externo pelo MENU+SIM
(`user_switched`).

**A única exceção:** a conversa que nunca chegou a ninguém
(`first_assigned_at` nulo) **e** que o job de inatividade encerrou (`timeout`).
Não houve atendimento — pesquisa aí é mensagem paga por algo que não aconteceu, e
a nota de uma conversa abandonada pesaria igual na média do hospital.

**Encerramentos por corte de acesso** (`access_revoked`, via revogação de link,
bloqueio de contato, reatribuição ou setor desativado) **e** `no_agent_available`
passam por `closeConversation`, que é o encerramento cru — não passam por
`closeWithCsat` e portanto nunca perguntam.

**Por que `firstAssignedAt` e não `firstReplyAt`:** `firstReplyAt` mede "alguém
**digitou**". Quem esperou na fila e foi atendido por telefone esperou do mesmo
jeito.

**O PROJETO.md foi reescrito junto** — o §3 agora se chama "Satisfação — enviada
em todo atendimento, responder é opcional", com os dois bullets que descrevem a
exceção e o encerramento por gente; o §2 (timeout) ficou qualificado com "se a
conversa tiver chegado a alguém do hospital (ver §3)".

**Se desfizer:** ou volta a pesquisa em conversa abandonada inflando o abandono
no painel, ou volta o atendimento resolvido por telefone sem pesquisa nenhuma.

---

## 10. Front

Nenhuma mudança de fluxo. Tudo aqui é foco de teclado, contraste, estado de
erro e coisas que o atendente encontra num plantão ruim.

| Mudança | Arquivo | Por quê |
|---|---|---|
| Hook `useDialogoModal(ativo, caixa, onCancel, origem?)`: prende o Tab, fecha no Escape, devolve o foco | `components/ConfirmDialog.tsx` | `aria-modal` é promessa, não implementação: sem prender o Tab o teclado alcança o botão **Encerrar** que está atrás da máscara |
| A origem do foco é capturada por **quem abre** (`e.currentTarget` no `onClick`), com `useLayoutEffect` | idem + `conversas/[id]`, `AgentHeader` | o `autoFocus` do React roda na fase de layout, de baixo para cima — a captura no nível da página só via o botão de dentro da caixa, que ao fechar já saiu do DOM. E o item de menu do celular desmonta no mesmo commit |
| `ConfirmDialog` guarda o `pending` no próprio `cancelar` | `components/ConfirmDialog.tsx` | os botões já ficavam desabilitados durante o envio; o Escape era a última porta aberta |
| Conversa 404 deixa de fazer polling e mostra card explicativo com `role="alert"` | `conversas/[id]/page.tsx` | a tela ficava batendo 404 para sempre; agora o cabeçalho, o campo de resposta e os botões saem juntos |
| Rascunho salvo em `sessionStorage['rascunho:<id>']`, limpo na troca de pessoa | `conversas/[id]/page.tsx`, `lib/api.ts` (`PREFIXO_RASCUNHO`) | o 401 do fim de plantão recarrega a página sem ninguém clicar em nada; mas o tablet do posto é compartilhado, e o texto de um atendente não pode reaparecer para o próximo |
| `--color-ink-400` de `#98a1ab` → `#7d8791` → **`#646d77`** | `app/globals.css` | 2,62:1 → 3,65:1 → **4,74:1** medidos no fundo mais escuro em que a cor encosta (a bolha `#d9fdd3`). WCAG AA pede 4,5:1 |
| `@media (prefers-reduced-motion: reduce)` + `comportamentoDeRolagem()` | `globals.css`, `components/ui.tsx` | CSS não alcança `scrollIntoView({behavior:'smooth'})` |
| `aria-live` saiu da `<ol>` de mensagens e virou um `<p class="sr-only">` com o resumo da última | `conversas/[id]`, `ramais/[id]` | região viva na lista inteira reanuncia tudo a cada render |
| Inputs `text-base sm:text-sm` | `components/ui.tsx`, `conversas/[id]` | fonte de 14px faz o iPhone dar zoom ao focar o campo |
| Gaveta do gestor com `role="dialog"`, Escape, foco devolvido e contador de requisição | `admin/conversas/page.tsx` | resposta de requisição vencida sobrescrevia a nova |
| Lista do gestor atualiza sozinha a cada 10 s, com carimbo de sequência | `admin/conversas/page.tsx` | mesma dinâmica da tela do atendente |
| `h1` em cada tela + `layout.tsx` de servidor só com `metadata` para `/conversas`, `/ramais`, `/login` | vários | o Next anuncia a troca de rota pelo título do documento |
| Encerrar no ramal interno pede confirmação | `ramais/[id]/page.tsx` | era ação destrutiva de um clique |
| Disponibilidade falhando em silêncio ganhou estado de erro e `disabled` | `components/AgentHeader.tsx` | o atendente achava que tinha ficado disponível |

**Pendência de front conhecida (A39):** as 8 telas de `/admin` continuam sem
título por rota — `app/admin/layout.tsx` é um client component e não exporta
`metadata`. Confirmei no arquivo.

---

## 11. Deploy e ferramental

| Mudança | Arquivo | Por quê |
|---|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_VALIDATE_WEBHOOK` no **mesmo bloco comentado** | `render.yaml` | as três se ligam juntas ou nenhuma: com o provider `mock` não há token com que validar, e o middleware responde 400/500 sem passar pelo nosso handler |
| `ALLOW_DEMO_SEED` comentada, com o texto dizendo o que ela faz | `render.yaml` | ligada + banco sem usuários, o primeiro start cria `admin@hospitalvida.test` e `admin@reabilitar.test` com senha `123456`, expostos na internet. Chave comentada, e não `sync: false`, porque campo em branco no painel do Render chega como string vazia e o `z.enum(['true','false'])` derrubaria o boot inteiro por uma variável opcional |
| `healthCheckPath` comentado explicando por que o 503 importa | `render.yaml` | ver seção 1 |
| Script `typecheck` na raiz | `package.json` | `npm run build` não cobria `scripts/` nem `prisma/` |
| `apps/api/tsconfig.scripts.json` | novo | estende o tsconfig da API com `noEmit` e `include: ["src","scripts","prisma"]`; o `tsconfig.json` original ficou intacto |
| `check-corridas.ts` e `check-distribuicao-concorrente.ts`: snapshot + `try/finally` que restaura escala, sessões e disponibilidade | `apps/api/scripts/` | os scripts apagavam a escala dos atendentes e deixavam o banco local inutilizável |
| Todas as queries desses dois scripts filtram por `tenantId` | idem | a regra do CLAUDE.md não tem exceção para script |
| Asserção do `check-distribuicao` endurecida | idem | era `donos[0] === donos[1]`; agora exige as duas conversas devolvidas, nenhuma sem dono e donos distintos |

---

## 12. Pontas soltas que encontrei ao escrever isto

Registro honesto. Estes três itens eu verifiquei no código enquanto escrevia e
**não** estão na lista dos 21 adiados. Não são urgentes, mas quem for mexer nas
áreas correspondentes vai tropeçar neles.

**1. O denominador do CSAT no painel não acompanhou a mudança de critério.**
`services/metrics.service.ts` monta `perguntados` com
`c.firstReplyAt !== null && closeReason ∉ {access_revoked, no_agent_available}`.
Isso era o critério da onda 2. O critério de hoje (seção 9.2) é
`firstAssignedAt !== null || reason ∈ {agent_closed, user_switched}`. Os dois
conjuntos deixaram de coincidir: uma conversa atribuída, nunca respondida por
escrito e encerrada por timeout **recebe** a pergunta e **não** entra no
denominador — enquanto a nota dela entra no numerador (`scored` varre todas as
linhas do período). Consequência aritmética: `csatResponseRate` pode passar de
100%. **Não reproduzi contra banco** — a conclusão vem da leitura dos dois
arquivos. Correção provável: extrair o critério de `closeWithCsat` para uma
função só e usá-la nos dois lugares.

**2. `conversations.create()` é código morto com comentário desatualizado.**
O comentário nas linhas 73-75 de `repositories/conversations.ts` diz que
`reopenMenu` ainda a usa e que "por isso ele continua mandando um segundo menu
quando perde a corrida". `reopenMenu` migrou para `createOrGetActive` na onda 4.
Grep em `apps/api/src` não encontra nenhum chamador. Como o comentário mistura
"quem usa" com "qual é o comportamento", um leitor futuro pode concluir que o
segundo menu ainda existe. Dá para apagar a função.

**3. `reofferConversations` está exportada e ninguém chama.**
`services/shift.service.ts` exporta a função e `repositories/users.ts` devolve
`releasedConversationIds` com cinco linhas de comentário definindo o contrato —
mas `routes/admin.ts` só usa `releasedConversations` (o número). Desativar um
atendente ou tirá-lo de um setor solta as conversas e **não reoferece nenhuma**:
elas ficam em `open` mesmo com um colega de plantão no mesmo setor, e o job de
inatividade não varre `open`. Este é o item **A06**, marcado como "parcial" na
onda 4 — a metade que falta é a fiação nas rotas do admin, depois do commit e
fora de qualquer transação.

---

## 13. Como validar que nada quebrou

Na ordem. Da esquerda para a direita, do mais barato para o mais caro.

### Passo 0 — pare o `next dev`

`next dev` e `next build` disputam a mesma pasta `.next`. Com o servidor de
desenvolvimento de pé, o build quebra por motivo que não tem nada a ver com o seu
código.

### Passo 1 — tipos (30 s, não precisa de banco)

```bash
cd "C:/Users/lenny/Desktop/Marcelo Kalichsztein"
npm install
npm run typecheck
```

Cobre `@central/shared`, a API **inclusive `scripts/` e `prisma/`** (via
`apps/api/tsconfig.scripts.json`) e o web, sem gerar a `.next`.
Rodei este comando ao escrever o documento: **sai 0**.

### Passo 2 — banco e migrations

```bash
docker compose up -d
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Em banco de desenvolvimento vazio, `npm run migrate -w api && npm run seed -w api`
faz o mesmo e ainda popula.

**Nunca edite uma migration já aplicada.** Muda o checksum e o `migrate deploy`
recusa com `P3006` — quebra o deploy em vez de consertá-lo. Foi por isso que os
dois achados de migration ficaram adiados (A25, A27).

### Passo 3 — confirme que o índice parcial existe

É a única coisa que sustenta "uma conversa aberta por contato" entre processos, e
**nenhuma ferramenta do Prisma o enxerga**.

```bash
docker compose exec db psql -U central -d central_ramais \
  -c "SELECT indexname FROM pg_indexes WHERE tablename = 'conversations' ORDER BY 1;"
```

`conversations_uma_ativa_por_contato` tem que aparecer na lista. Se não
aparecer, o índice sumiu (restore de dump antigo, `db push` em outro ambiente) e
a garantia caiu sem nenhum aviso.

### Passo 4 — as corridas

Precisam do **banco local semeado** (os scripts procuram "Hospital Vida",
"Cardiologia" e o link de código `MEDX`). **Não rode contra produção.**

```bash
npm run check:corridas -w api
npm run check:distribuicao -w api
```

`check:corridas` roda 10 cenários × 6 rodadas: cada um faz duas coisas
acontecerem ao mesmo tempo e confere o estado que ficou. Os cenários 7 a 10
mexem em escala, disponibilidade e plantões, e devolvem tudo ao estado anterior
num `try/finally` — inclusive quando o script estoura no meio. O cenário 10 roda
a varredura de plantão de verdade, que encerra sessões vencidas de **todos** os
hospitais do banco.

**O que o "PASSOU" desses scripts não prova:** 7 dos 9 cenários não têm grupo de
controle, então um cenário que deixasse de exercitar a corrida passaria do mesmo
jeito (item A35, adiado). Trate como rede de segurança contra regressão, não
como prova de correção.

### Passo 5 — build de produção dos dois apps

```bash
npm run build
```

É o item 1 do "definition of done" do CLAUDE.md.

### Passo 6 — o que só o olho pega

O simulador (`/admin/simulador`) chama `handleInbound` direto, sem passar pelo
webhook — dá para exercitar o fluxo inteiro sem Twilio. Vale a pena percorrer:

1. Link com 2+ setores: primeira mensagem com código → menu → digita `1` → cai
   na fila → atendente responde.
2. Link com **1** setor: pula o menu e entra direto.
3. `MENU` durante o atendimento → `SIM` → encerra, pergunta a nota, e o menu do
   link aparece de novo (com link de 1 setor, entra direto, sem menu de uma
   opção).
4. Nota `07` → aceita. Depois `2` dentro de 10 min → **corrige** a nota e
   responde "Sua nota foi atualizada".
5. Reatribuir o contato para um link que **não** tem o setor atual (painel →
   Contatos) → a conversa viva é encerrada com `access_revoked`.
6. Desativar o setor de uma conversa viva → mesma coisa.
7. Dois atendentes clicando "Encerrar" na mesma conversa → o segundo recebe
   **409** com mensagem, não um `ok` falso.
8. Segundo número num link **nominal** → recusa + linha em `access_attempts`.
9. Login errado 11 vezes seguidas → **429** com `Retry-After`.

---

## 14. Limites deste documento

- **O que eu li:** os arquivos citados, no estado da branch
  `fix/concorrencia-na-distribuicao`. Cada afirmação sobre código foi conferida
  no arquivo, não copiada dos relatórios dos agentes.
- **O que eu não fiz:** não rodei migrations, não subi banco, não executei os
  scripts de corrida, não abri o navegador. O único comando que rodei foi
  `npx tsc --noEmit -p apps/api/tsconfig.scripts.json` (saiu 0).
- **Números de desempenho** citados (os ~6,6 s do login, os 17 deadlocks em 30
  rodadas, os valores de contraste) vêm dos relatos dos agentes que os mediram.
  Não os reproduzi.
- **21 achados continuam abertos**, com justificativa escrita. Este documento
  cita os que tocam as áreas descritas (A06, A23, A25, A27, A30, A35, A38, A39);
  a lista completa está no arquivo de pendências desta pasta.
- **Nada aqui autoriza a conclusão de que o sistema está seguro.** O que dá para
  dizer é mais estreito e mais útil: 48 agentes olharam este código de dez
  ângulos diferentes, 91 + 42 achados foram confirmados no próprio código, a
  maior parte foi corrigida, e o que sobrou está escrito.
