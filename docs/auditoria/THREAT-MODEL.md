# Modelo de ameaças — Central de Ramais

Este documento descreve **quem pode atacar este sistema, por onde, o que hoje
segura cada ataque e o que continua aberto**. Não é um checklist genérico de
segurança web: é o desenho deste produto — um hospital que dá links de WhatsApp
para gente de fora e controla, link a link, com quais setores cada um pode falar.

**Escopo.** Branch `fix/concorrencia-na-distribuicao`, três commits à frente de
`main`: `ff92f62` (correção de concorrência), `d2bd846` (onda 2 da auditoria) e
`8ea8e0f` (onda 4). Todas as referências `arquivo:linha` foram abertas e
conferidas no código enquanto este texto era escrito.

**O que sustenta as afirmações.** Uma auditoria em cinco ondas, 48 agentes:

| Onda | O que foi feito | Resultado |
|---|---|---|
| 1 | 10 auditores independentes, só leitura | 128 achados brutos |
| 1b | 5 verificadores reabriram cada achado no código | 91 sobreviveram, 37 descartados |
| 2 | 11 lotes de implementação, um dono por arquivo | commit `d2bd846` — 58 arquivos, +2001/−504 |
| 3 | 7 red teams adversariais + 1 juiz | 62 achados brutos, 42 procedem, 5 descartados |
| 4 | 6 lotes de implementação | commit `8ea8e0f` — 23 arquivos, +767/−157 |

Vinte e um achados ficaram registrados para depois, com justificativa. Eles
aparecem na seção 8.

**O que este documento não é.** Não houve teste de invasão contra a instância
publicada, não houve revisão da configuração do painel do Render, e nada foi
verificado do lado da Twilio. A seção 9 lista os limites com nome e sobrenome.
Em nenhum ponto aqui está escrito que o sistema é seguro — está escrito o que
foi verificado, como, e o que sobrou.

---

## 1. Os atores

Modelo de ameaças começa por gente, não por tecnologia. São seis os atores
reais deste produto.

| Ator | O que tem na mão | O que quer (legítimo) | O que poderia querer (abuso) |
|---|---|---|---|
| **Externo com link** — médico que encaminha, convênio, fornecedor, filha de paciente internado | Um link `/c/<slug>`, um código de 4 caracteres no texto pronto, e o WhatsApp dele | Falar com o setor certo, rápido, sem cadastro | Falar com um setor que o link dele não autoriza; entrar com o link de outra pessoa; ler conversa alheia |
| **Atendente de plantão** | Login, senha e uma escala. Vê a fila dos setores dele | Atender quem está na fila do seu setor | Ler o histórico de um paciente de setor alheio; responder pelo WhatsApp do hospital em nome de outro setor |
| **Administrador do hospital** | Login de admin. Cria setores, emite links, vê todas as conversas e todas as métricas | Operar o hospital | É o ator mais poderoso do sistema. O risco aqui não é ele furar uma trava, é a conta dele ser tomada — ou ele agir sem deixar rastro |
| **Hospital vizinho** (outro *tenant* na mesma instalação) | Login válido, no hospital dele | Operar o hospital dele | Ver paciente, link ou métrica do hospital ao lado |
| **Twilio** | O canal inteiro. Entrega toda mensagem que entra e toda que sai | Entregar mensagem | Não é adversário, é **dependência confiada**. Se a Twilio for comprometida ou mal configurada, o produto inteiro cai junto |
| **Anônimo** | Só a URL pública. Nenhuma credencial | — | Entrar; derrubar; descobrir quem é paciente do hospital |

Um detalhe de vocabulário, porque ele muda o desenho: **o externo não tem
conta**. Não há login, senha, cadastro ou confirmação — é requisito de produto
(`PROJETO.md`, "Zero fricção para o externo"). Então a única credencial dele é o
link, e todo o modelo de ameaças do lado de fora gira em torno disso.

---

## 2. As fronteiras de confiança

Quatro superfícies. Duas são públicas por desenho e não podem deixar de ser.

```
  INTERNET (ninguém autenticado)
      │
      ├─── F1 ──►  GET /c/:slug                       público, sem credencial
      │            302 → wa.me/<numero do hospital>
      │
      ├─── F2 ──►  POST /webhooks/twilio/whatsapp     público, autenticado por
      │            (toda mensagem de todo externo)     assinatura HMAC da Twilio
      │
      └─── F3 ──►  API autenticada                    JWT assinado (12h admin,
                   /auth/login · /agent/* · /admin/*   até o fim do plantão p/ agente)
                        │
                        └─ F4 ──►  /admin/*           requireRole('admin')
```

### F1 — `/c/:slug`, o link público

Rota sem autenticação nenhuma (`apps/api/src/routes/public.ts:13`). Recebe um
slug de 8 caracteres, e devolve um 302 para `wa.me` com o texto de entrada
pronto (`apps/api/src/services/entryLink.service.ts:9-22`). Slug inexistente ou
link revogado devolve 404 com uma página estática — não distingue os dois casos
(`public.ts:16-19`).

**O que atravessa:** nada sensível na ida. Na volta, o 302 revela o número de
WhatsApp do hospital e o código de entrada — os dois são públicos por desenho,
porque estão no QR code impresso e no texto que abre no celular da pessoa.

**Se cair:** um atacante que enumerasse slugs conseguiria a lista de códigos de
entrada do hospital. Ver a ameaça T2.

### F2 — o webhook, a fronteira mais perigosa

É por aqui que entra **toda** mensagem de **todo** externo. Não há sessão: o
hospital é resolvido pelo campo `To` da requisição — o número que recebeu a
mensagem (`apps/api/src/services/webhook.service.ts:86`). E o `To` é público.

Isso significa uma coisa dura de encarar: **a única coisa que separa um POST
forjado de uma mensagem de paciente de verdade é a assinatura da Twilio.**
Sem ela, qualquer pessoa da internet escreve dentro da conversa viva de um
paciente, e o atendente lê como se fosse ele.

O middleware que valida a assinatura vive em
`apps/api/src/providers/twilio.ts:27-32` — único arquivo do projeto que importa
o SDK da Twilio, como manda o `CLAUDE.md`.

### F3 — a API autenticada

`requireAuth` (`apps/api/src/middleware/auth.ts:24`) exige `Bearer <jwt>`,
verifica a assinatura (`auth.ts:32`) e **relê o banco a cada requisição**: se o
usuário foi desativado, o acesso cai agora, não quando o token vencer
(`auth.ts:41`). Para atendente, confere ainda se a sessão de plantão continua
aberta (`auth.ts:54-62`) — fim de plantão derruba o acesso na hora.

O `tenantId` vem **sempre** do JWT (`auth.ts:23` documenta a regra;
`auth.ts:65-70` a implementa). Nunca de body, query, params ou header.

### F4 — o painel de administração

`apps/api/src/routes/admin.ts:30` — `router.use(requireAuth, requireRole('admin'))`.
O mesmo em `adminConversations.ts:10` e em `simulator.ts:16`.

### Uma não-fronteira: o front

O app Next **não tem `middleware.ts`** e o token fica em `localStorage`
(`apps/web/lib/api.ts:14` e `:41`). As telas de `/admin` não são protegidas por
nada no servidor do front: quem digitar a URL vê o esqueleto da tela. Isso é
aceitável **porque toda autorização é feita na API** — a tela sem dados é uma
tela vazia. Mas quer dizer que o painel do Next não conta como camada de
segurança, e não deve ser tratado como se contasse.

### As cinco queries que atravessam o tenant de propósito

A regra do `CLAUDE.md` é que nenhuma query chega ao banco sem `tenant_id`. Há
cinco exceções, todas por desenho e todas comentadas no código:

| Query | Arquivo | Por que é global |
|---|---|---|
| `findBySlug` | `repositories/entryLinks.ts:5` | `/c/:slug` é público, não há tenant ainda |
| `findActiveByPhoneNumber` | `repositories/whatsappNumbers.ts:5` | é ela que **descobre** o tenant no webhook |
| `findActiveByEmail` | `repositories/users.ts:6` | login não tem tenant ainda |
| `emailTaken` | `repositories/users.ts:11` | e-mail é único globalmente |
| `existsByWaMessageId` | `repositories/messages.ts:5` | dedupe da Twilio, o id é global |

**Essas cinco são o mapa dos lugares onde um bug vira problema entre
hospitais.** Um red team revisou os repositórios inteiros e não achou uma sexta;
eu confirmei que as cinco existem com esses nomes e essas assinaturas, mas não
repeti a varredura completa.

---

## 3. Os ativos

| Ativo | Onde vive | Quem pode ver legitimamente | Dano se vazar |
|---|---|---|---|
| **Conversa de paciente** | `messages` + `conversations` | O atendente do setor dela; o admin do hospital | Alto. É dado de saúde: "o resultado da biópsia saiu?" identifica pessoa e condição |
| **Número de telefone do externo** | `external_contacts.wa_number` | Atendente do setor, admin | Alto. Junto com o setor, revela que aquela pessoa é paciente de oncologia, psiquiatria, etc. |
| **Código do entry link** (4 caracteres) | `entry_links.entry_code` | Admin; e quem recebeu o link | Alto. É a credencial de entrada de números novos |
| **Slug do link** (8 caracteres) | `entry_links.slug`, na URL | Público por desenho | Médio. Leva ao código |
| **Token JWT** | `localStorage` do navegador | O dono | Alto. Vale 12h para o admin e não há como revogar (ver T11) |
| **Escala de plantão** | `shift_sessions`, `user_shifts` | Admin, o próprio atendente | Baixo/médio. Diz quando o hospital está desguarnecido |
| **Métricas e acessos negados** | `access_attempts`, agregados | Admin | Médio. `access_attempts` é o alarme de link vazado — quem apagasse desligaria o alarme |
| **Credenciais de atendente/admin** | `users.password_hash` (bcrypt) | Ninguém | Crítico |

---

## 4. Os dois níveis de autorização — e por que o segundo é o produto

Esta é a parte que distingue este sistema de um chat de suporte qualquer.

**Nível 1 — tenant.** Isolamento entre hospitais. É higiene básica de SaaS: toda
query filtra por `tenant_id`, o `tenant_id` sai do JWT, e ID de outro hospital
devolve **404, nunca 403** — porque 403 já confirmaria que o registro existe.

**Nível 2 — entry link.** Quais setores **aquele externo específico** pode
acessar. Não é um refinamento do nível 1: é o que o hospital está comprando.
Um médico externo com o link "Médico Externo" vê Cardiologia, Enfermagem e
Recepção. Um fornecedor com o link "Fornecedor" vê Recepção e Suprimentos. Os
dois falam com o mesmo hospital, pelo mesmo número, e não podem ver a mesma
coisa.

A regra prática: **toda vez que o sistema mostra ou aceita um setor para um
externo, a lista vem do link dele** — nunca de `listDepartments(tenantId)`.

São **cinco** os lugares onde isso vale, não três. Os três primeiros estavam no
`CLAUDE.md`; a auditoria mostrou que faltavam dois:

| # | Momento | Onde está no código | Situação |
|---|---|---|---|
| 1 | Menu inicial | `services/conversation.service.ts:39` | já estava certo |
| 2 | Resposta ao MENU | `services/lifecycle.service.ts:163` | já estava certo |
| 3 | Validação da escolha numérica | `services/conversation.service.ts:106-124` | já estava certo |
| 4 | **Encaminhamento pelo atendente** | `services/transfer.service.ts:29-32` e `:74-81` | corrigido na onda 2 |
| 5 | **A conversa que já está rodando** | `services/lifecycle.service.ts:116-131` e `:139-155` | corrigido nas ondas 2 e 4 |

O item 4 é ilustrativo do tipo de falha que este produto tem: o encaminhamento
montava a lista de setores a partir do `entry_link_id` **gravado na conversa** —
o *snapshot*. Só que o snapshot existe para o relatório do mês passado não virar
mentira, **não para autorizar**. Depois que o admin reatribuía o contato a outro
link, o atendente continuava recebendo os setores do link antigo e podia
encaminhar a pessoa para um setor que o menu dela já nem mostrava. Hoje
`listTransferTargets` e `transferConversation` leem
`conversation.externalContact.entryLinkId` — o vínculo **vigente**.

O item 5 fecha a mesma ideia pelo outro lado: quando o admin reatribui o contato
(`routes/admin.ts:625`) ou desativa um setor (`routes/admin.ts:182` e `:203`), a
conversa que estava viva dentro de um setor agora não autorizado é encerrada com
`close_reason=access_revoked`. Sem isso, reatribuir mudava o menu de amanhã e
deixava o atendimento de agora acontecendo dentro de um setor sem autorização —
e, a cada fim de plantão, o rodízio devolvia a conversa para a fila do mesmo
setor proibido.

---

## 5. Ameaças pela fronteira F1 e F2 (o lado de fora)

### T1 — Forjar mensagem no webhook e falar como se fosse o paciente

**Vetor.** `POST /webhooks/twilio/whatsapp` com `From` = número de um paciente e
`To` = número do hospital. O `To` é público (sai no 302 de `/c/<slug>` e no QR
code). Sem assinatura validada, isso não exige credencial nenhuma: o atacante
escreve dentro da conversa viva de um paciente ("pode liberar meu resultado para
o portador"), e também pode chutar códigos de entrada sem custo.

**O que protege hoje.** A validação de assinatura HMAC da Twilio, em
`providers/twilio.ts:27-32`. E, mais importante, um **portão de boot**: se
`WHATSAPP_PROVIDER=twilio` e `TWILIO_VALIDATE_WEBHOOK` não estiver ligado, o
processo sai com código 1 (`config.ts:65-70`). O mesmo vale para o token
(`config.ts:55-58`). Não existe caminho documentado para subir em modo Twilio
com o webhook aberto.

**O que esta auditoria mudou.** O achado original era **crítico**: a validação
vinha **desligada de fábrica** e nada no boot ou no deploy exigia ligá-la. Um
hospital que trocasse `WHATSAPP_PROVIDER` para `twilio` no painel e esquecesse a
terceira variável ficaria com o webhook aberto para a internet, sem um aviso
sequer. A onda 2 criou o portão de boot; a onda 4 (achado A09) corrigiu o
`render.yaml`, que tinha passado a declarar `TWILIO_VALIDATE_WEBHOOK=true` junto
com `provider=mock` — combinação em que o SDK responde 400/500 e o Twilio
reentrega em loop. Hoje as três variáveis estão no mesmo bloco comentado do
`render.yaml`, com a instrução de ligar as três juntas ou nenhuma.

**Um red team tentou furar e não conseguiu:** os três portões rodam no
carregamento de `src/config.ts`, importado por **todos** os entrypoints
(`index.ts`, `app.ts` e o próprio `scripts/seed-if-empty.ts`, que faz
`import '../src/config'` na primeira linha). Não achou caminho de bypass.

**Risco residual.**
- Em desenvolvimento o padrão continua sendo `false` (`config.ts:26-29`), o que
  é intencional — o provider mock não tem token com que validar.
- A instância de demonstração roda com o provider mock. Nela o webhook é, na
  prática, aberto; não há dado real ali, mas **não confunda a demonstração com
  um piloto**.
- O produto confia integralmente na assinatura. Um vazamento do
  `TWILIO_AUTH_TOKEN` derruba esta fronteira inteira, e não há segunda linha.

### T2 — Chutar o código de entrada de 4 caracteres

**Vetor.** Um número novo entra mandando uma mensagem com o código entre
colchetes. O código tem 4 caracteres de um alfabeto de 32
(`utils/ids.ts:5` e `:18`) — cerca de **1,05 milhão** de combinações, e ele é
único **por hospital** (`@@unique([tenantId, entryCode])`), não globalmente.
Quem sabe o número de WhatsApp do hospital (que é público) pode mandar mensagem
atrás de mensagem trocando o código.

**O que protege hoje.**
- A assinatura da Twilio impede o chute barato por HTTP. Sobra o chute caro: por
  WhatsApp de verdade, uma mensagem por tentativa, com custo e com um número
  real do outro lado.
- Toda recusa vira linha em `access_attempts`
  (`services/access.service.ts:55`, `:62`, `:67`, `:91`) — é o sinal que o admin
  vê na tela de acessos negados.
- Um número que **já tem contato** nunca é reavaliado por código
  (`access.service.ts:46-50`): depois do primeiro uso, o vínculo é a fonte de
  verdade (regra 8 do `CLAUDE.md`).

**Risco residual — aberto.** **Não há nenhum freio por número no webhook.** O
limitador de tentativas existe só em `POST /auth/login`
(`routes/auth.ts:27`) — um red team confirmou que o webhook não é tocado por
ele, e concluiu, corretamente, que isso é o comportamento certo para não travar
mensagem de paciente. Mas quer dizer que **nada bloqueia automaticamente um
número que erra o código cem vezes seguidas**. E o alarme é passivo: só aparece
se alguém abrir o navegador (achado `link-nominal-vazado-nao-alerta-ninguem`,
severidade baixa, aberto).

O que fecharia: um freio por número no caminho de recusa (n tentativas sem
código válido em x minutos → silêncio, como no contato bloqueado) e um aviso
ativo ao admin quando `access_attempts` dispara.

### T3 — Repassar um link nominal para outra pessoa

**Vetor.** O link nominal ("Dra. Ana Ribeiro") aceita **um número só**. Se ela
repassa o link, o segundo número tenta entrar com o mesmo código.

**O que protege hoje.** A reivindicação do link nominal acontece com **a linha
do link travada no banco** (`repositories/entryLinks.ts:28-40`, `SELECT ... FOR
UPDATE` dentro de transação), e o dono é relido **dentro** da transação
(`services/access.service.ts:79-85`). O segundo número é recusado e gera
`access_attempt` com `reason=nominal_taken`, gravado **fora** da transação de
propósito, para que um rollback não apague o registro da recusa
(`access.service.ts:91`). O mesmo caminho vale pelo painel: reatribuir um
contato a um link nominal já ocupado passa pela mesma trava
(`routes/admin.ts:606-612`).

**O que esta auditoria mudou.** Antes, a exclusividade era garantida por um
`Map` em memória — o `keyedQueue`. Isso vale por **processo**. Com duas
instâncias, ou na janela de deploy em que a antiga ainda drena e a nova já
atende, os dois números liam "link livre" e os dois criavam vínculo. E aí o
estrago era permanente: depois do vínculo, o carona ficava autorizado para
sempre e **nenhum `nominal_taken` chegava ao painel** — o alarme de link vazado
simplesmente não tocava. A onda 2 trocou a fila em memória pela trava de banco.

**Um red team tentou e não conseguiu:** "Link nominal com segundo número: só um
dono, e o segundo gera `access_attempt reason=nominal_taken`." O cenário 5 da
suíte `check-corridas` reproduz a disputa e mede 1 dono e 1 alerta em 6 de 6
rodadas.

**Risco residual.** A detecção continua sendo humana e passiva (mesma pendência
do T2). E o repasse do link **antes** do primeiro uso — a Dra. Ana manda o link
para o colega e ele usa primeiro — cria o vínculo com o número errado sem gerar
alerta nenhum. Isso é limitação do desenho "link é a credencial", não bug.

### T4 — Escalar acesso reenviando o código de outro link

**Vetor.** Um externo já vinculado ao link "só Enfermagem" descobre o código do
link "Médico Externo" e o reenvia, esperando que o sistema troque o escopo dele.

**O que protege hoje.** `resolveAccess` só olha o código quando **não existe
contato** para aquele número (`access.service.ts:46-50`). Contato conhecido cai
em `resolveContatoConhecido`, que resolve o link pelo vínculo gravado
(`access.service.ts:22-39`). E há um detalhe fino no caminho do link de perfil:
se duas mensagens correm juntas e a que perdeu a corrida trazia **outro** código,
o resultado é recalculado a partir do vínculo que ficou gravado, não do código
daquela mensagem (`access.service.ts:101-106`).

**Um red team tentou e não conseguiu.** Palavras dele: *"contato preso ao link
'só Gama' mandou o código do link Alfa+Beta → continuou no link só-Gama e caiu
em Gama. A regra 8 (vínculo é a fonte de verdade) segura."*

**Risco residual.** Nenhum identificado neste caminho. A troca de escopo é
exclusiva do admin, pelo painel.

### T5 — Escolher um setor fora do menu

**Vetor.** A pessoa recebeu o menu com três opções, o admin reatribuiu o link
dela no meio do caminho, e ela responde "3" — o número que valia no menu antigo.

**O que protege hoje.** `parseMenuChoice` (`conversation.service.ts:108-124`)
valida o número contra a lista **passada como parâmetro**, e essa lista é sempre
a de `listDepartmentsForLink` do link vigente
(`webhook.service.ts:191`, `conversation.service.ts:39`). Índice fora da faixa é
recusado e o menu é reapresentado, já com a lista nova.

**Um red team tentou e não conseguiu:** *"menu enviado com [Alfa, Beta, Gama],
admin reatribuiu para link só-Gama, pessoa respondeu '3' → recusado e
reapresentado o menu novo '1 — Gama'; '1' → Gama."*

**Risco residual — aberto, baixo.** O achado `menu-desloca-quando-setor-sai-do-ar`
(severidade média, aberto) descreve o caso vizinho: se um setor é **desativado
ou reordenado** entre o envio do menu e a resposta, a numeração desloca e a
pessoa cai num setor diferente do que ela leu. Continua sendo um setor que o
link dela autoriza — não é falha de autorização —, mas é a pessoa indo parar no
lugar errado. Fecharia guardando na conversa a lista exata que foi enviada, ou
usando o `menu_key` do setor em vez da posição na lista (hoje `menu_key` é
coluna morta, achado `menu-key-e-dado-morto`).

### T6 — Continuar sendo atendido depois de perder o acesso

**Vetor.** O admin revoga o link, bloqueia o contato, reatribui o contato para
outro link ou desativa o setor — e a conversa que já estava rodando continua.
Do lado de dentro, o atendente segue respondendo pelo WhatsApp do hospital
alguém que acabou de perder a autorização.

**O que protege hoje.** Os quatro caminhos alcançam a conversa viva:

| Ação do admin | Onde | O que faz com a conversa viva |
|---|---|---|
| Revogar link | `routes/admin.ts:510-535` | encerra a conversa viva de cada contato do link, com `access_revoked` |
| Bloquear contato | `routes/admin.ts:628-640` | encerra com `access_revoked`, sem CSAT |
| Reatribuir contato | `routes/admin.ts:625` → `lifecycle.service.ts:116-131` | encerra **se** o setor atual não estiver no link novo |
| Desativar setor | `routes/admin.ts:182` e `:203` → `lifecycle.service.ts:139-155` | encerra todas as vivas naquele setor |

E do lado do externo, o webhook trata contato com link revogado antes de
qualquer outra coisa (`webhook.service.ts:111-118`), e contato bloqueado com
**silêncio total** — responder confirmaria que o número está cadastrado
(`webhook.service.ts:101-104`).

**O que esta auditoria mudou.** Revogar não encerrava conversa (achado
`revogar-link-nao-encerra-conversa`, alta, onda 2). Reatribuir e desativar setor
também não (achado A03, alta, onda 4). Os três eram a mesma falha vista de três
ângulos: o nível 2 de autorização valia para o menu de amanhã e não para o
atendimento de agora.

**Um red team tentou e não conseguiu:** *"Revogar link no meio da conversa:
conversa vira closed/access_revoked na hora e o atendente passa a levar 400
'conversa encerrada'."* E: *"Bloquear contato: encerra a conversa e o atendente
leva 400."*

**Risco residual — aberto (A22, severidade média).** As consultas do rodízio —
`availableAgentsForDepartment` (`repositories/users.ts:67`) e
`listOpenForDepartments` (`repositories/conversations.ts:288`) — **não filtram
`department.active`**. Depois da correção A03 não deveria sobrar conversa viva
num setor desativado, mas a garantia hoje é "o caminho que desativa também
encerra", não "a fila do setor morto não existe". Fecharia com um filtro de
`department.active` nas duas consultas.

### T7 — Enumerar links pela URL pública

**Vetor.** Bater em `/c/<slug>` chutando slugs, para colher códigos de entrada.

**O que protege hoje.** O slug tem 8 caracteres de um alfabeto de 36
(`utils/ids.ts:3` e `:16`) — cerca de 2,8 trilhões de combinações, gerados com
`crypto.randomBytes` (`utils/ids.ts:7-14`). Chute cego não é caminho viável.

**Risco residual.** Não há limitador na rota. Duas consequências pequenas:
`use_count` é incrementado a cada acerto (`entryLink.service.ts:16`), então quem
tem um slug legítimo pode inflar a métrica "uso por link" à vontade; e a rota
faz uma escrita no banco por requisição, sem freio. Nenhum dos dois foi tratado
como achado pela auditoria; registro aqui por completude.

---

## 6. Ameaças pela fronteira F3 e F4 (o lado de dentro)

### T8 — Atendente lê a conversa de um paciente de setor alheio

**Vetor.** Um id de conversa vaza — print no grupo da equipe, URL colada no
chat. Um atendente de outro setor abre `/agent/conversations/<id>/messages`.

**O que protege hoje.** `findByIdForAgent`
(`repositories/conversations.ts:332-348`) exige, além do tenant, que a conversa
seja **minha** (`assignedUserId = eu`) **ou do meu setor**
(`department.users.some({ userId })`). Quem não passa recebe **404**, nunca 403.
A mesma guarda cobre os cinco endpoints de conversa do atendente e os quatro do
ramal interno.

**O que esta auditoria mudou.** O achado `agente-atende-setor-alheio` (alta,
onda 2): antes, os endpoints filtravam **só por tenant**. Qualquer atendente do
hospital lia o histórico de qualquer paciente, respondia pelo WhatsApp do
hospital em nome daquele setor e ainda tirava a conversa da fila de quem devia
atender.

**Um red team tentou e não conseguiu.** Nas palavras dele: *"agB (setor Beta)
contra conversa do Alfa/Gama → 404 nos CINCO endpoints (GET messages, POST
messages, close, transfer-targets, transfer). Ramal interno idem: 404 nos
quatro. Agente removido do setor perde o acesso à thread na hora. Não achei
endpoint de conversa que tenha ficado de fora da guarda."* Ele também procurou
**vítima legítima** da nova guarda — alguém que passasse a ser barrado sem
motivo — e não achou: agente de dois setores continua vendo os dois, e o dono
continua lendo a conversa depois de encerrá-la.

**Risco residual — aberto (A32, baixa).** O comentário acima de
`findByIdForAgent` diz "a mesma regra da lista dele", e não é bem isso: a lista
(`listForAgentView`) mostra a fila do setor só em status `open`, enquanto
`findByIdForAgent` não filtra status. Divergência de documentação, não de
autorização — mas é o tipo de comentário que induz o próximo desenvolvedor ao
erro.

### T9 — O hospital vizinho (isolamento entre tenants)

**Vetor.** Admin do Hospital A usa um id do Hospital B em qualquer rota.

**O que protege hoje.** `tenantId` do JWT, em toda query, em toda camada. 404 e
nunca 403.

**Um red team tentou e não conseguiu, e essa é a medição mais forte desta
auditoria.** Ele criou um tenant próprio e disparou **27 requisições cruzadas**
contra ids de outro hospital, autenticado como admin e como atendente:
`PATCH/DELETE /admin/departments/:id`, `PATCH/DELETE /admin/users/:id`,
`GET/PUT /admin/users/:id/shifts`, `POST /admin/entry-links/:id/revoke`,
`GET /admin/entry-links/:id/qrcode`, `GET /admin/entry-links/:id/contacts`,
`PATCH /admin/contacts/:id`, `GET /admin/conversations/:id/messages`,
`GET/POST /agent/conversations/:id/messages`, `POST /agent/conversations/:id/close`,
`GET /agent/conversations/:id/transfer-targets`, `POST /agent/conversations/:id/transfer`,
e os quatro do ramal interno. **404 em todas. Nunca 403.**

Ids de outro tenant **no corpo** também foram barrados: `POST /admin/users` e
`POST /admin/entry-links` com `departmentIds` alheios → 400; `PATCH
/admin/contacts/:id` com `entryLinkId` de outro hospital → 404.
`GET /admin/metrics?department_id=<setor alheio>` devolve 200, mas com volume 0
e agregados nulos — não vaza nada.

**Risco residual.** As cinco queries globais da seção 2 são o ponto de atenção
permanente. Uma sexta acrescentada sem cuidado é uma falha entre hospitais. Não
há teste automatizado que impeça isso (achado `sem-testes-nem-ci`, média,
aberto): a regra é sustentada por leitura e por revisão de PR.

### T10 — Força bruta contra o login

**Vetor.** `POST /auth/login` é a única porta pública com senha. Quem souber um
e-mail do hospital martela a conta de administrador — a que enxerga a conversa
de todos os pacientes.

**O que protege hoje.** Quatro coisas, todas acrescentadas por esta auditoria:

1. **Dois baldes de contagem** (`middleware/rateLimit.ts:22-23`): 10 tentativas
   por (IP + e-mail) e **20 por conta alvo**, em janela de 15 minutos. O segundo
   é o teto que não depende de nada que o atacante escreva.
2. **`trust proxy` = 1** (`app.ts:25`). Este é o ponto crítico. Estava `true`, e
   com isso o Express resolvia `req.ip` a partir do `X-Forwarded-For` — um
   header do **cliente**. Bastava incrementar um número a cada tentativa e o
   contador nunca enchia. Quatro times mediram o mesmo, de forma independente:
   XFF fixo → 429 a partir da 11ª tentativa; XFF rotativo → 401 em 14/14, 15/15
   e 40/40, **zero 429**. O limitador tinha nascido contornável (achado A01,
   alta, corrigido na onda 4).
3. **bcrypt assíncrono e serializado** (`routes/auth.ts:40`). O `bcryptjs` é
   JavaScript puro: a versão síncrona segurava o event loop inteiro por dezenas
   de milissegundos por tentativa — e o webhook da Twilio roda **no mesmo
   processo**. Trinta requisições anônimas deixavam a central inacessível.
4. **Hash-isca** (`routes/auth.ts:18`): com e-mail inexistente a comparação roda
   mesmo assim, para o tempo de resposta não entregar quais e-mails existem.

**Risco residual — dois, e o primeiro eu verifiquei diretamente no código.**

- O balde "por origem" usa a chave `${req.ip}|${email}`
  (`rateLimit.ts:52`). Trocar o e-mail cria um balde novo. Ou seja: **contra uma
  conta específica o teto de 20/15min vale e segura** (é a defesa que importa
  contra roubo de credencial), mas o **volume total** de trabalho de bcrypt que
  um único IP pode gerar não tem teto — basta variar o e-mail. Isso é
  disponibilidade, não confidencialidade, e o gargalo é a fila serial
  `runSerialized('login:senha', ...)`. O juiz da onda 3 avaliou este item como
  consequência do A01 e o fechou junto; eu confirmo que a parte de
  confidencialidade está fechada e registro que a de disponibilidade não está.
- **O login diz quando a senha acertou** (achado `login-revela-plantao`, baixa,
  aberto). Senha correta fora do plantão devolve **403** com a janela do próximo
  turno; senha errada devolve **401** (`routes/auth.ts:60-66`). Quem faz força
  bruta distingue exatamente o acerto — e ainda descobre a escala do
  funcionário. O limitador reduz muito a sondagem em massa, mas o oráculo
  continua lá. Fecharia devolvendo 401 genérico e mostrando o motivo só depois
  de uma etapa autenticada.

E há um risco de **produto**, não de código: a senha mínima é de 6 caracteres.

### T11 — Token roubado, e a sessão que não morre

**Vetor.** Alguém pega o JWT — máquina compartilhada no posto de enfermagem,
extensão de navegador, XSS.

**O que protege hoje.** `requireAuth` relê o banco a cada requisição:
desativar o usuário derruba o acesso na hora (`middleware/auth.ts:41`), e para
atendente o token vale só enquanto a sessão de plantão estiver aberta
(`auth.ts:54-62`). Do lado do front, não há nenhum `dangerouslySetInnerHTML` no
app inteiro (verificado), e o React escapa texto por padrão — o corpo da
mensagem do paciente, que é a entrada não confiável mais óbvia, não vira HTML.

**Risco residual — aberto, e é o mais desconfortável desta lista.**

- **Não existe logout no servidor** (verificado: nenhuma rota de logout na API).
  O token do **admin** vale 12 horas e **não há como revogá-lo**: sem refresh
  token, sem lista de revogação, sem troca de senha que invalide sessão. Desativar
  o usuário funciona (`auth.ts:41`) — mas é a única alavanca, e ela é grosseira.
  Achado `sem-revogacao-de-sessao-do-admin`, média, aberto.
- Token em `localStorage` (`apps/web/lib/api.ts:41`) é legível por qualquer
  script na página. Não há CSP nem `X-Frame-Options` na API nem no painel, e o
  `X-Powered-By: Express` continua ligado (achado `sem-headers-de-seguranca`,
  baixa, aberto — fecharia com `helmet`).
- O `jwt.verify` não fixa o algoritmo nem o `issuer`
  (`middleware/auth.ts:32`). Com um segredo em string, a biblioteca aceita só
  HMAC, então **não identifiquei ataque prático aqui** — a auditoria classificou
  como endurecimento (informativa), e é assim que registro: dívida de
  robustez, não vulnerabilidade demonstrada.

### T12 — O administrador como ameaça

Não porque ele seja mal-intencionado, mas porque é o ator mais poderoso e a
conta dele é o alvo mais valioso do sistema.

**O que ele pode fazer, por desenho:** ler a conversa de qualquer paciente do
hospital, ver todos os números, todos os códigos de entrada
(`routes/admin.ts:350` devolve `entryCode` na listagem de links), reatribuir
contatos e revogar acessos.

**E uma coisa que ele pode fazer que merece nome próprio:** o simulador
(`routes/simulator.ts:31-53`) aceita **qualquer número** do tenant e injeta a
mensagem pelo **mesmo caminho do webhook** — o que é correto para uma
demonstração honesta, e é exatamente o problema. A mensagem é gravada como
`direction=inbound`, `sender_type=customer`, dentro da conversa real daquele
número. O único vestígio é o prefixo `SIM` no `wa_message_id`
(`simulator.ts:50`), que **nenhuma tela mostra**. Achado
`simulador-forja-mensagem-de-numero-real` (média, **aberto**): na tela do
atendente e no histórico do gestor, uma mensagem forjada pelo admin é
indistinguível de uma mensagem do paciente.

**Risco residual.** Não há trilha de auditoria das ações do admin: quem revogou
qual link, quem reatribuiu qual contato, quem leu qual conversa. Num sistema que
guarda dado de saúde, isso é uma lacuna real. Fecharia com uma tabela de
`admin_actions` e com o simulador marcando visivelmente a mensagem injetada (ou
recusando números que já são contatos reais).

### T13 — A Twilio

Ator confiado, não adversário — mas modelar dependência confiada faz parte do
trabalho.

**O que depende dela.** Tudo o que entra e tudo o que sai. A autenticidade do
`From` de toda mensagem de paciente. O `MessageSid`, que é a chave de dedupe
(`wa_message_id` UNIQUE, `messages.ts:5`). E a mídia: anexos ficam **na Twilio**
— o sistema avisa que não leu e não baixa nada (`webhook.service.ts:172-182`),
o que é uma decisão deliberada e boa, porque imagem de exame é dado de saúde.

**O que protege hoje.** A assinatura (T1) e o portão de boot. O webhook sempre
responde 200 mesmo em erro interno (`routes/webhook.ts:49` e o handler de
`:68-75`), porque 500 faz a Twilio reentregar em loop — e o erro vai para um log
estruturado com o número **mascarado** (`utils/phone.ts:22`, só os 4 últimos
dígitos), porque quem lê log de infraestrutura não é quem está autorizado a ver
paciente.

**Risco residual.** Se o `TWILIO_AUTH_TOKEN` vazar, T1 cai por inteiro e não há
segunda linha de defesa. Não há timeout configurado no cliente Twilio, no
servidor HTTP nem no pool do Prisma (achado `sem-timeouts-em-twilio-http-e-pool`,
média, aberto) — uma Twilio lenta vira uma API lenta.

### T14 — Derrubar o serviço

**Vetor.** Qualquer coisa que consuma o processo único do Node — que atende
webhook, painel e login ao mesmo tempo.

**O que protege hoje.** O limitador de login (T10), o bcrypt assíncrono e
serializado, o `/health` que faz `SELECT 1` de verdade e devolve 503 para o
Render agir (`app.ts:35-43`), e o job de inatividade que itera **por tenant
explicitamente**, nunca varrendo a tabela inteira (`jobs/timeout.ts:16-17`).

**Um red team tentou e não conseguiu:** disparou 60 transações concorrentes
contra o pool do Prisma — zero rejeições, 637 ms; auditou os 8
`prisma.$transaction` do código e confirmou que **nenhum** faz envio de WhatsApp
dentro de transação; e mediu que o `Map` do limitador se autolimpa a cada janela
de 15 minutos, então não cresce sem fim.

**Risco residual — aberto.**
- `/health` não tem autenticação nem limite e toca o banco a cada chamada. O red
  team classificou como observação, não achado, por não ter provado DoS real.
- `GET /admin/metrics` e `GET /admin/access-attempts` carregam o período inteiro
  para a memória do Node, sem teto, e `access-attempts` sem `from`/`to` traz o
  histórico inteiro do hospital (achados
  `metricas-e-acessos-carregam-tudo-na-memoria` e
  `access-attempts-sem-periodo-nem-paginacao`, ambos abertos). São rotas
  autenticadas de admin, então o vetor é insider ou conta tomada.
- No plano gratuito do Render a API hiberna, e a primeira mensagem depois do
  silêncio pode estourar o timeout da Twilio (achado
  `api-hiberna-e-perde-mensagem-do-webhook`, alta, aberto). É disponibilidade de
  infraestrutura, não código.

### T15 — Dado que fica para sempre

**Vetor.** Não é ataque; é exposição acumulada.

**Situação.** Nada nunca é apagado. Não há rota de exclusão nem de exportação, e
o telefone do externo aparece cru em toda tela do painel (achado
`sem-retencao-nem-exclusao-de-dado-pessoal`, baixa, **aberto**). Do lado dos
logs a auditoria corrigiu o que dava: o `MockProvider` imprimia o número
completo e o corpo inteiro de toda mensagem no stdout — hoje mascara
(`utils/phone.ts:22`).

Para um piloto com paciente real, isto é o item que exige decisão do hospital
antes de qualquer linha de código: retenção, base legal e quem responde por um
pedido de exclusão.

---

## 7. O que o red team tentou e não conseguiu

Sete times adversariais atacaram o código depois da onda 2. Estes são os ataques
que **falharam** — e eles valem tanto quanto os achados, porque são a evidência
de que a proteção funciona.

| Ataque tentado | Resultado |
|---|---|
| Furar o isolamento entre hospitais (27 requisições cruzadas) | 404 em todas, nunca 403 |
| Escalar de setor reenviando o código de outro link | Vínculo prevaleceu; caiu no setor de sempre |
| Responder o menu com o número de um menu obsoleto | Recusado, menu novo reapresentado |
| Encaminhar a conversa para fora do link do contato | 404 "setor não disponível para este contato" |
| Encaminhar com o link revogado | Lista vazia, transfer 404 |
| Ler/responder/encerrar conversa de setor alheio (5 endpoints + 4 do ramal) | 404 em todos |
| Deixar um link sem nenhum setor ativo (desativar o último) | 409 com a lista dos links afetados |
| Segundo número num link nominal | Recusado, `access_attempt reason=nominal_taken` |
| Subir em modo Twilio sem token ou sem validação de assinatura | Boot recusa (`exit 1`) em todos os caminhos testados |
| Rodar o seed de demonstração sem o portão | Exige `ALLOW_DEMO_SEED=true` **e** banco vazio |
| Refletir um `Origin` estrangeiro no CORS | Cabeçalho fixo, sem reflexão; API usa Bearer, não cookie |
| Achar envio de WhatsApp dentro de transação de banco | Nenhum, nos 8 `$transaction` do código |
| Provocar deadlock entre o rodízio (`assignToIfOnShift`) e os caminhos de saída | Não conseguiu: todas essas transações começam pela tabela `users` |
| Exaurir o pool do Prisma com 60 transações simultâneas | Zero rejeições |
| Violar o índice único de "uma conversa ativa por contato" por UPDATE | Nenhum caminho de escrita consegue |
| Aplicar as migrations num banco sujo de propósito | Aplicaram; backfill fechou as sobras |
| Provocar taxa de resposta de CSAT acima de 100% | Impossível por construção |
| Escapar da trava de foco (Tab/Shift+Tab) nos diálogos do painel | Trava segurou nos dois sentidos |
| Fazer o rascunho de um atendente reaparecer para outro no tablet compartilhado | Limpo na troca de pessoa, preservado no mesmo usuário |

**E o que eles conseguiram, para a tabela acima não parecer boa demais.** O time
de concorrência encontrou um deadlock de verdade — não no rodízio, mas entre o
job que expira plantões e o caminho que encerra plantão: as duas transações
travavam `users` e `shift_sessions` em ordem invertida, um ciclo que **não
existia antes** de `ff92f62` envolvê-las em transação. Medição: 15 a 17
deadlocks em 30 rodadas, e a vítima típica era o login do atendente na troca de
turno (achado A02, alta). Corrigido na onda 4, com um cenário 10 acrescentado à
suíte `check-corridas` justamente para reproduzi-lo.

Duas notas de honestidade sobre esta tabela. Primeira: "não consegui" é
resultado de um esforço limitado no tempo, não prova de impossibilidade.
Segunda: um dos times foi um **refutador**, encarregado de contestar as
conclusões dos outros — e ele derrubou uma hipótese própria com medição, o que é
um bom sinal sobre o processo.

---

## 8. Ameaças que continuam abertas

Ordenadas pelo que eu fecharia primeiro. As referências `A##` são do julgamento
da onda 3; as outras são identificadores dos achados da onda 1.

| # | Ameaça aberta | Impacto | O que fecharia |
|---|---|---|---|
| 1 | **Nenhum freio no webhook para quem erra o código** (T2) | Chute de código de 4 caracteres sem custo além do envio; nada bloqueia automaticamente | Freio por número no caminho de recusa; silêncio após n tentativas |
| 2 | **`access_attempts` é alarme passivo** (`link-nominal-vazado-nao-alerta-ninguem`) | O sinal de link vazado só existe se alguém abrir a tela | Aviso ativo ao admin no pico de `nominal_taken`; ação de bloquear direto da tela |
| 3 | **Sessão de admin não é revogável** (`sem-revogacao-de-sessao-do-admin`) | Token roubado vale 12h; a única alavanca é desativar o usuário | Rota de logout com lista de revogação, ou versão de sessão no usuário conferida em `requireAuth` |
| 4 | **Simulador injeta mensagem indistinguível** (`simulador-forja-mensagem-de-numero-real`) | Admin (ou conta tomada) escreve na conversa real de um paciente sem deixar marca visível | Marcar visivelmente a mensagem injetada; recusar números que já são contatos reais |
| 5 | **Sem trilha de auditoria das ações do admin** (T12) | Não se sabe quem revogou, reatribuiu ou leu o quê | Tabela `admin_actions` gravada nas rotas de escrita do painel |
| 6 | **Login é oráculo de senha correta** (`login-revela-plantao`) | 403 vs 401 confirma o acerto e revela a escala | 401 genérico; motivo só depois de etapa autenticada |
| 7 | **Rodízio não filtra setor desativado** (A22) | Fila de setor morto continua existindo no banco | `department.active` no WHERE de `availableAgentsForDepartment` e `listOpenForDepartments` |
| 8 | **Volume de bcrypt sem teto por IP** (T10) | Disponibilidade do login degrada com e-mails variados de um mesmo IP | Terceiro balde só por IP, com teto alto |
| 9 | **Sem cabeçalhos de segurança** (`sem-headers-de-seguranca`) | Sem CSP, sem `X-Frame-Options`, `X-Powered-By` exposto | `helmet` na API; cabeçalhos no `next.config.ts` |
| 10 | **Métricas e acessos negados carregam tudo na memória** | Rota autenticada que degrada o processo inteiro | Agregação no banco; paginação obrigatória em `access-attempts` |
| 11 | **Numeração do menu desloca** (`menu-desloca-quando-setor-sai-do-ar`) | Pessoa cai em setor diferente do que leu (dentro do link dela) | Usar `menu_key` em vez da posição, ou congelar a lista enviada |
| 12 | **Sem timeouts** (`sem-timeouts-em-twilio-http-e-pool`) | Dependência lenta vira API lenta | Timeout no cliente Twilio, no servidor HTTP e no pool do Prisma |
| 13 | **Sem retenção nem exclusão de dado pessoal** | Nada é apagado; telefone cru em toda tela | Política de retenção e rota de exclusão — decisão do hospital antes do código |
| 14 | **Sem testes nem CI** (`sem-testes-nem-ci`) | As duas regras inegociáveis do `CLAUDE.md` não têm rede | Suíte de cross-tenant e de escopo de link no CI; a especificação já existe |
| 15 | **`npm audit`: 6 vulnerabilidades altas transitivas** | Nenhuma explorável neste app hoje, segundo a auditoria | Atualizar `next` e `prisma` |

Uma décima sexta, que não é código: **a instância publicada de demonstração
distribui as contas de teste e a senha compartilhada na própria tela de login**
(`apps/web/app/login/page.tsx:89-94`). É proposital — é uma demonstração. Mas
significa que **quem tiver a URL entra como administrador do hospital fictício**.
O `render.yaml` documenta o portão (`ALLOW_DEMO_SEED`) e o mantém comentado, de
modo que um clone do blueprint não nasce assim. Não verifiquei o que está
efetivamente configurado no painel do Render.

---

## 9. Limites desta análise

Onde a análise não alcançou, com nome:

1. **Não houve teste de invasão contra a instância publicada.** Tudo foi medido
   contra instâncias locais subidas pelos próprios auditores.
2. **Não foi revisada a configuração do painel do Render** — só o `render.yaml`
   versionado. Se alguém ligou `WHATSAPP_PROVIDER=twilio` ou `ALLOW_DEMO_SEED`
   pelo painel, este documento não sabe.
3. **Nada foi verificado do lado da Twilio.** A rotação do token, o
   registro do número e a política da conta estão fora do alcance.
4. **A premissa do índice único não é exercitada por teste.** A migration
   `conversa_ativa_unica` existe justamente para o caso de **duas instâncias** da
   API, e nenhum dos 10 cenários da suíte `check-corridas` roda com dois
   processos. Um red team registrou isso explicitamente.
5. **Não há testes automatizados nem CI.** As duas regras inegociáveis —
   `tenant_id` em toda query e escopo de setor vindo do link — são sustentadas
   por leitura e por revisão de PR. A verificação de 27 requisições cruzadas foi
   feita **uma vez, à mão**; ela não impede a 28ª rota.
6. **Este documento não roda.** É a descrição de um código num commit. Cada
   commit novo pode invalidar qualquer linha dele.
7. **Nada aqui afirma que o sistema é seguro.** As correções desta auditoria
   fecham falhas específicas, medidas e reproduzidas. Quinze ameaças continuam
   abertas, listadas acima, e a lista de ameaças conhecidas nunca é a lista de
   ameaças existentes.

---

## Apêndice — mapa rápido arquivo → fronteira

| Arquivo | Papel na segurança |
|---|---|
| `apps/api/src/config.ts` | Portões de boot: Twilio sem token, Twilio sem assinatura, `JWT_SECRET` de exemplo |
| `apps/api/src/app.ts` | `trust proxy = 1`, CORS de origem fixa, `/health` com `SELECT 1` |
| `apps/api/src/middleware/auth.ts` | `requireAuth` (tenant do JWT, usuário ativo, plantão vivo) e `requireRole` |
| `apps/api/src/middleware/rateLimit.ts` | Dois baldes de tentativa de login |
| `apps/api/src/providers/twilio.ts` | Único lugar que importa o SDK; validação de assinatura |
| `apps/api/src/routes/webhook.ts` | Sempre 200; log estruturado com número mascarado |
| `apps/api/src/services/access.service.ts` | Tabela de decisão do webhook; posse do link nominal |
| `apps/api/src/repositories/entryLinks.ts` | `withLinkClaim` (trava de banco) e `listDepartmentsForLink` (nível 2) |
| `apps/api/src/services/lifecycle.service.ts` | Encerramento por perda de acesso; MENU conferindo o setor atual |
| `apps/api/src/services/transfer.service.ts` | Encaminhamento pelo link **vigente** |
| `apps/api/src/repositories/conversations.ts` | `findByIdForAgent` (tenant + setor) |
| `apps/api/src/utils/phone.ts` | E.164 na entrada; mascaramento no log |

---

*Documento produzido pela auditoria em cinco ondas descrita no topo. Os números
de achados, as medições citadas e as tentativas de ataque vêm dos relatórios dos
48 agentes; as referências `arquivo:linha` foram reabertas e conferidas no
código do commit `8ea8e0f`.*
