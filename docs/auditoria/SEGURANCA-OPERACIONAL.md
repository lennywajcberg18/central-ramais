# Guia operacional de segurança — Central de Ramais

Este documento é para quem **opera** o sistema: sobe, configura, monitora e
responde quando algo dá errado. Não é sobre como o código foi escrito, é sobre
quais botões existem, o que cada um faz e o que fazer às três da manhã.

Tudo aqui foi conferido lendo o código do repositório na branch
`fix/concorrencia-na-distribuicao`. Cada afirmação traz o arquivo e a linha de
onde ela sai, para que você possa reconferir sem acreditar em mim. Onde a
análise não alcançou — o painel do Render, o console da Twilio, o banco de
produção — está escrito que não alcançou.

**O que este documento não afirma:** que o sistema está seguro. Ele descreve o
que foi verificado, como, e o que ficou de fora. A seção
[O que não está protegido hoje](#10-o-que-não-está-protegido-hoje) é a parte
mais importante para quem decide colocar isso na frente de pacientes.

---

## Índice

1. [Variáveis de ambiente](#1-variáveis-de-ambiente)
2. [O segredo do JWT: gerar e rotacionar](#2-o-segredo-do-jwt-gerar-e-rotacionar)
3. [Ligar a Twilio com segurança](#3-ligar-a-twilio-com-segurança)
4. [Quando um link nominal vaza](#4-quando-um-link-nominal-vaza)
5. [Bloquear um contato abusivo](#5-bloquear-um-contato-abusivo)
6. [O que monitorar](#6-o-que-monitorar)
7. [Resposta a incidente](#7-resposta-a-incidente)
8. [Checklist de deploy](#8-checklist-de-deploy)
9. [Checklist: clonar isto para um hospital de verdade](#9-checklist-clonar-isto-para-um-hospital-de-verdade)
10. [O que não está protegido hoje](#10-o-que-não-está-protegido-hoje)
11. [Limites desta análise](#11-limites-desta-análise)

---

## 1. Variáveis de ambiente

Todas as variáveis são lidas e validadas em `apps/api/src/config.ts`, no
carregamento do módulo. Esse arquivo é importado por todos os pontos de entrada
da API (`index.ts`, `app.ts` e o script de seed), então **não existe caminho que
suba a aplicação sem passar por essa validação**.

Quando a validação falha, o processo imprime o campo recusado e sai com código 1
(`config.ts:47-51`). No Render, sair com 1 no boot é o que impede a promoção do
deploy.

### Tabela de referência

| Variável | O que faz | Valor seguro | Se estiver errada |
|---|---|---|---|
| `DATABASE_URL` | Conexão com o Postgres | String de conexão do provedor, nunca versionada | Vazia: boot recusa. Inválida: boot passa e `/health` responde 503 |
| `PORT` | Porta HTTP da API | `3001` local; no Render vem da plataforma | Padrão 3001 se ausente |
| `JWT_SECRET` | Chave que assina e verifica o token de login | Aleatório, ≥ 16 caracteres, gerado por você | Menos de 16 caracteres ou ausente: boot recusa. Fraca: token de admin forjável |
| `WHATSAPP_PROVIDER` | `mock` ou `twilio` | `mock` em dev, `twilio` em produção real | `mock` em produção: nenhuma mensagem sai de verdade e o hospital não percebe |
| `TWILIO_ACCOUNT_SID` | Identificador da conta Twilio | Só no painel do provedor | Ausente com provider `twilio`: **o boot passa** (ver ressalva abaixo) e a falha aparece no primeiro envio |
| `TWILIO_AUTH_TOKEN` | Token da Twilio; também é o que valida a assinatura do webhook | Só no painel do provedor | Ausente com provider `twilio`: boot recusa (`config.ts:55-58`) |
| `TWILIO_VALIDATE_WEBHOOK` | Liga a verificação de assinatura do webhook | `true` sempre que o provider for `twilio` | `false` com provider `twilio`: boot recusa (`config.ts:65-70`). `true` sem token: webhook para de funcionar |
| `ALLOW_DEMO_SEED` | Libera o seed de demonstração no start | **Ausente** ou `false` em qualquer instância real | `true` com o banco sem usuários: cria os administradores de demonstração, de senha fraca |
| `PUBLIC_BASE_URL` | Base pública da API; entra no QR code e na URL do link | URL exata do serviço, sem barra final | URL errada: os QR codes impressos apontam para o lugar errado |
| `WEB_ORIGIN` | Origem do painel, usada no CORS | URL exata do front | Errada: o navegador bloqueia tudo e o sintoma é "clico em Entrar e não acontece nada", sem log no servidor |

`PUBLIC_BASE_URL` e `WEB_ORIGIN` passam por uma validação de URL que **remove a
barra final** (`config.ts:14-17`). Isso existe porque `https://x.com/` e
`https://x.com` são origens diferentes para o CORS, e a diferença é invisível na
tela.

`PUBLIC_BASE_URL` usa `RENDER_EXTERNAL_URL` como padrão quando a variável não é
declarada (`config.ts:39-41`) — no Render, isso costuma resolver sozinho.

### Os quatro portões de boot, conferidos um a um

| Portão | Linha | Condição que derruba o processo |
|---|---|---|
| Schema de ambiente | `config.ts:45-51` | Qualquer variável obrigatória ausente ou fora do formato |
| Twilio sem token | `config.ts:55-58` | `WHATSAPP_PROVIDER=twilio` e `TWILIO_AUTH_TOKEN` vazio |
| Twilio sem assinatura | `config.ts:65-70` | `WHATSAPP_PROVIDER=twilio` e `TWILIO_VALIDATE_WEBHOOK` diferente de `true` |
| Segredo de exemplo | `config.ts:76-82` | `JWT_SECRET` igual ao valor de exemplo antigo do repositório |

**Duas ressalvas honestas sobre esses portões:**

1. A mensagem do segundo portão diz que "exige `TWILIO_ACCOUNT_SID` e
   `TWILIO_AUTH_TOKEN`", mas a condição testa **apenas** o token
   (`config.ts:55`). Subir com token e sem SID passa pelo boot. O cliente da
   Twilio só é construído no primeiro envio (`providers/index.ts:9-19`), então o
   sintoma seria "as mensagens não saem", não "o serviço não sobe". Se você
   configurar a Twilio, confira o SID com os próprios olhos.
2. O quarto portão compara o segredo com uma string específica que já **não
   existe mais** no `.env.example` — hoje o arquivo traz `JWT_SECRET=` vazio, e
   vazio já é barrado pelo mínimo de 16 caracteres. O portão continua útil só
   para quem tem um `.env` antigo na máquina. Não confie nele como se fosse uma
   verificação de força de senha: ele barra **um** valor conhecido, não segredos
   fracos em geral.

---

## 2. O segredo do JWT: gerar e rotacionar

O `JWT_SECRET` é a chave que assina o token de login. Quem tiver essa chave
consegue fabricar um token dizendo "sou administrador do hospital X" e ler as
conversas de todos os pacientes daquele hospital. É o segredo mais sensível do
sistema.

### Gerar

```bash
openssl rand -base64 32
```

Cole o resultado na variável `JWT_SECRET` **no painel do provedor de hospedagem**
— nunca em arquivo versionado, nunca em mensagem de chat, nunca em ticket. O
`.env.example` do repositório vem com o campo vazio de propósito: o repositório é
público.

No Render, o `render.yaml` pede `generateValue: true` para essa chave, ou seja, a
plataforma gera um valor aleatório no primeiro deploy e você nunca chega a vê-lo.
Isso é bom para o segredo e ruim para a rotação: você vai precisar substituir o
valor gerado por um seu quando for rotacionar.

### Rotacionar — passo a passo

1. Gere o novo valor (comando acima).
2. Avise a equipe: **todo mundo vai cair**. Escolha uma janela de baixo
   movimento; se possível, quando não houver atendimento em curso.
3. Substitua `JWT_SECRET` no painel do provedor.
4. Reinicie o serviço da API.
5. Confirme que `/health` responde `{"ok":true,"db":"up"}`.
6. Peça para uma pessoa fazer login e abrir uma conversa.

### O que acontece com quem está logado

Assim que a API sobe com a chave nova, **todos os tokens emitidos com a chave
antiga passam a ser inválidos**. Na prática:

- A verificação em `middleware/auth.ts:32` falha, a API responde 401 e o painel
  manda a pessoa para a tela de login.
- Quem estava digitando uma resposta na tela de conversa **não perde o texto**: o
  rascunho é guardado no navegador e volta depois do novo login
  (`apps/web/app/conversas/[id]/page.tsx:159-174`). O mesmo não vale para a tela
  de ramal interno — lá o texto se perde (item A41 da auditoria, adiado).
- Atendentes precisam logar de novo, e o login de atendente **reabre o plantão**
  (`routes/auth.ts:58-73`). Se a rotação cair fora do horário de escala da
  pessoa, ela recebe "Você está fora do horário de plantão" e **não consegue
  entrar**. Esse é o motivo mais forte para rotacionar em horário administrativo,
  com um admin de plantão junto.
- Não existe lista de revogação nem refresh token. A rotação da chave é o único
  botão de "derrubar todo mundo".

### Derrubar UMA sessão, sem rotacionar

O token não é revogável individualmente, mas `requireAuth` confere duas coisas no
banco **a cada requisição** (`middleware/auth.ts:38-63`):

| Ação | Efeito | Onde |
|---|---|---|
| Desativar o usuário | Acesso cortado na requisição seguinte | `PATCH /admin/users/:id` com `active:false`, ou tela de agentes |
| Encerrar o plantão do atendente | Acesso cortado na requisição seguinte | `POST /agent/shift/end`, ou o fim do horário de escala |

Duas travas propositais: você **não pode** desativar a própria conta, e **não
pode** desativar o último administrador ativo do hospital
(`routes/admin.ts:93-107`).

Duração dos tokens, para calibrar expectativa: 12 horas para administrador, até
16 horas para atendente (`routes/auth.ts:82`, `services/shift.service.ts:12`). O
token de atendente não sobrevive ao fim do plantão mesmo que ainda não tenha
expirado, porque a sessão é conferida no banco.

**Não existe endpoint de troca de senha.** Confirmei percorrendo todas as rotas:
senha só é definida na criação do usuário (`POST /admin/users`). Para "trocar a
senha" de alguém hoje, o caminho é criar um usuário novo e desativar o antigo —
ou alterar o hash direto no banco.

---

## 3. Ligar a Twilio com segurança

O webhook é o único endpoint do sistema sem autenticação por token — por
natureza, já que quem chama é a Twilio. O que separa "mensagem legítima de um
médico" de "mensagem forjada por qualquer pessoa da internet" é a **assinatura**
que a Twilio coloca em cada requisição.

Sem assinatura, quem descobrir a URL do webhook pode:

- Escrever **dentro da conversa viva** de um paciente, fingindo ser o número
  dele. O único campo que resolve o hospital é o `To`, que é público por desenho
  (aparece no redirect de `/c/<slug>` e no QR code).
- Tentar códigos de entrada até acertar um e cair num setor sem nunca ter
  recebido link. O código tem 4 caracteres de um alfabeto de 32
  (`utils/ids.ts:5,18`), cerca de 1,05 milhão de combinações — muito para
  adivinhar por WhatsApp, pouco para um script batendo direto no endpoint.
- Fazer o hospital pagar mensagens de resposta para números escolhidos pelo
  atacante.

Por isso `config.ts:65-70` **recusa o boot** quando o provider é `twilio` e a
validação está desligada. É um portão, não um aviso.

### Passo a passo

1. No painel do provedor de hospedagem, defina as três variáveis **juntas**:
   `WHATSAPP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e
   `TWILIO_VALIDATE_WEBHOOK=true`.
2. Confirme que `PUBLIC_BASE_URL` é exatamente a URL pública da API, sem barra
   final.
3. No console da Twilio, aponte o webhook de mensagens recebidas para
   `<PUBLIC_BASE_URL>/webhooks/twilio/whatsapp`, método POST.
4. Reinicie a API e confirme que ela subiu (se as variáveis estiverem
   incompletas, ela não sobe — é o comportamento esperado).
5. Mande uma mensagem de teste de um número autorizado e confirme que ela aparece
   na tela do atendente.

### A regra que evita o pior erro de configuração

**Ligue as três juntas, ou nenhuma.** Ligar `TWILIO_VALIDATE_WEBHOOK=true`
mantendo o provider `mock` (sem token) faz o middleware do SDK responder sozinho,
antes do nosso código: 400 quando a requisição chega sem o cabeçalho de
assinatura, 500 quando chega com ele. E **500 é exatamente o que faz a Twilio
reentregar a mesma mensagem em loop** — o comentário em
`routes/webhook.ts:58-67` documenta esse caminho. O resultado é um webhook morto
que ainda gera tráfego.

### Se a assinatura começar a falhar (403 na Twilio)

A validação confere a assinatura contra a URL que o Express reconstrói. A API roda
com `trust proxy` em `1` (`app.ts:25`) justamente para que, atrás do proxy da
hospedagem, o protocolo remontado seja `https` e não `http`. Se você mudar de
domínio, adicionar barra final na URL configurada na Twilio, ou colocar outro
proxy na frente, a URL reconstruída deixa de bater e mensagens legítimas passam a
ser recusadas. Confira primeiro a URL cadastrada no console da Twilio, caractere a
caractere.

Não testei esse caminho contra a Twilio de verdade — não há integração ativa para
testar. O que verifiquei é o código que monta o middleware
(`providers/twilio.ts:27-32`) e a configuração de proxy.

### O webhook sempre responde 200

Mesmo quando o processamento falha, a resposta é 200 com um TwiML vazio
(`routes/webhook.ts:34-49`), e há um handler de erro só para a rota, cobrindo até
falhas anteriores ao handler (`routes/webhook.ts:68-75`). Isso é intencional:
qualquer 500 vira loop de reentrega. **Consequência operacional:** a Twilio nunca
vai te avisar que uma mensagem foi perdida. O único rastro é a linha de log
`webhook_inbound_falhou`, com o identificador da mensagem — guarde esse
identificador se precisar reprocessar à mão.

---

## 4. Quando um link nominal vaza

Um link **nominal** é de uma pessoa só. O vínculo entre o número de WhatsApp e o
link nasce no primeiro uso, e a partir daí é o vínculo — não o código — que
sustenta o acesso. Se a pessoa repassa o link, o segundo número é recusado e a
recusa é registrada.

### Como detectar

Tela: **Admin → Acessos** (`/admin/acessos`), que consome
`GET /admin/access-attempts?from&to`.

Os motivos possíveis são cinco (`prisma/schema.prisma:43-49`):

| Motivo no banco | Como aparece na tela | O que significa |
|---|---|---|
| `nominal_taken` | "Link pessoal repassado" | **Um segundo número tentou usar um link de uma pessoa só.** É o sinal de vazamento |
| `blocked` | "Número bloqueado" | Um contato bloqueado tentou escrever; o sistema não respondeu |
| `revoked_link` | — | Link revogado sendo usado |
| `invalid_code` | — | Código que não existe neste hospital. Vários seguidos = alguém tentando adivinhar |
| `no_code` | — | Mensagem sem código de número desconhecido |

Uma linha de `nominal_taken` já é um evento a investigar. Um punhado no mesmo dia
significa que o link circulou em grupo.

Os registros são gravados **fora da transação** que reivindica o link
(`services/access.service.ts:88-92`), de propósito: um rollback não pode apagar o
registro da recusa.

### Como revogar

Tela: **Admin → Links** → botão de revogar. Endpoint:
`POST /admin/entry-links/:id/revoke`.

O que acontece, na ordem (`routes/admin.ts:510-536`):

1. O link é marcado como inativo. Revogar duas vezes devolve erro de conflito, não
   um 404 mentiroso.
2. `GET /c/<slug>` passa a responder a página "Link indisponível"
   (`routes/public.ts:13-24`).
3. **Todas as conversas vivas de todos os contatos daquele link são encerradas**
   com motivo `access_revoked`. Sem CSAT: não se pede nota de satisfação a quem
   acabou de ter o acesso cortado.
4. A próxima mensagem de qualquer um desses números recebe "Seu acesso foi
   encerrado. Procure o hospital." (`services/webhook.service.ts:111-118`).

O QR code de um link revogado deixa de ser gerado — o endpoint responde conflito,
para não imprimir papel que leva a uma página morta (`routes/admin.ts:538-552`).

### Alternativa: reatribuir em vez de revogar

Se a pessoa certa continua precisando de acesso e só o link vazou, o caminho é
emitir um link novo e **reatribuir o contato dela** para o novo link
(`PATCH /admin/contacts/:id` com `entryLinkId`, tela Admin → Contatos).

A reatribuição vale na hora: se a conversa em andamento estiver num setor que o
link novo não autoriza, ela é encerrada (`routes/admin.ts:594-626`). A regra do
link nominal também vale por essa porta — dois contatos no mesmo link nominal são
recusados, com a mesma trava de banco que o webhook usa.

### Cuidado de escala

Revogar um link de **perfil** (usado por muitas pessoas) percorre todos os
contatos vinculados, com duas consultas para cada um, dentro da requisição
(item A30 da auditoria, adiado). Com poucas centenas de contatos isso é
imperceptível; com milhares, a requisição pode estourar o tempo limite **depois**
de o link já ter sido marcado como revogado, deixando parte das conversas vivas.
Se isso acontecer, o conserto é encerrar as conversas restantes pela tela de
conversas do gestor.

---

## 5. Bloquear um contato abusivo

Tela: **Admin → Contatos**. Endpoint: `PATCH /admin/contacts/:id` com
`{ "blocked": true }`.

O que o sistema faz em seguida (`routes/admin.ts:628-642` e
`services/webhook.service.ts:101-104`):

1. Marca o contato como bloqueado.
2. **Encerra a conversa ativa dele**, se houver, com motivo `access_revoked` e sem
   pedir nota. Sem isso, a conversa ficaria na fila para sempre e o atendente
   continuaria conseguindo responder alguém que não pode mais escrever.
3. A resposta da API traz `closedConversation: true|false` — é assim que você
   sabe se havia atendimento em curso.
4. Toda mensagem seguinte daquele número é recebida e **descartada em silêncio**.
   Nenhuma resposta é enviada: responder confirmaria para a pessoa que o número
   dela está cadastrado no hospital.
5. Cada tentativa vira uma linha `blocked` em Acessos. Bloqueado não é invisível:
   você continua vendo que ele tentou.

Existe uma corrida tratada: se o bloqueio acontecer no exato instante em que uma
conversa nova está sendo criada, o sistema relê o estado do contato e encerra a
conversa recém-nascida (`services/webhook.service.ts:154-169`).

**Desbloquear** é o mesmo endpoint com `blocked: false`. O vínculo com o link
continua o que era; nada é reaberto automaticamente — a pessoa precisa escrever
de novo.

---

## 6. O que monitorar

### `/health`

`GET /health` executa um `SELECT 1` no banco (`app.ts:35-43`):

| Resposta | Significa |
|---|---|
| `200 {"ok":true,"db":"up"}` | Processo de pé e banco alcançável |
| `503 {"ok":false,"db":"down"}` | Processo de pé, banco fora |

É o `healthCheckPath` do `render.yaml`. O 503 é o que faz a plataforma reiniciar
o serviço e barrar a promoção de um deploy que não conecta no banco. Um health
check que respondesse 200 sem tocar o banco deixaria o painel verde com o sistema
inteiro quebrado.

O endpoint é público e não tem limite de chamadas. Não vaza nada além desses dois
campos — o red team olhou especificamente para isso e não achou dado de hospital
na resposta.

### Os logs que existem

Todo log vai para a saída padrão do processo (não há arquivo, nem serviço de log
estruturado). Inventário completo do que a API escreve:

| Evento | Linha | O que dá para fazer com ele |
|---|---|---|
| `webhook_inbound_falhou` (JSON) | `routes/webhook.ts:38-47` | Contar mensagens perdidas e reprocessar pelo identificador |
| Número fora do padrão E.164 | `services/webhook.service.ts:49-53` | Ver tráfego malformado |
| Número de destino desconhecido | `services/webhook.service.ts:88` | Descobrir webhook apontando para o hospital errado |
| Banco inalcançável no `/health` | `app.ts:40` | Confirmar queda de banco |
| Falhas de distribuição e de plantão | `services/routing.service.ts:90`, `services/shift.service.ts:154,196,312` | Investigar conversa que não chega a ninguém |
| Falhas do job de inatividade | `jobs/timeout.ts:23,28` | Investigar conversa que não encerra |
| Erro não tratado | `middleware/error.ts:35` | Rastro de 500 |
| Boot: origem e base pública | `index.ts:16` | Diagnosticar CORS em trinta segundos |
| Desligamento e drenagem | `index.ts:33,47` | Ver se o deploy encerrou limpo |

**Números de telefone em log são mascarados** — só os quatro últimos dígitos
(`utils/phone.ts:21-23`). O provider de demonstração imprime apenas o tamanho da
mensagem, nunca o corpo (`providers/mock.ts:12-14`), porque em hospital o corpo
carrega contexto clínico.

### O que os logs de hoje NÃO respondem

Seja honesto com o gestor sobre isto:

- **Quem fez o quê no painel.** Não existe log de auditoria de ação
  administrativa. Revogar link, bloquear contato, desativar usuário e reatribuir
  contato não deixam registro de quem fez nem quando. As únicas exceções são
  campos no próprio link: `revoked_at` e `revoked_by_user_id`
  (`prisma/schema.prisma:270-271`). Quem bloqueou um contato ontem é uma pergunta
  sem resposta.
- **Quem leu o quê.** Não há registro de acesso a conversa. Se um atendente abrir
  o histórico de um paciente que não era dele, não fica rastro.
- **Quantas requisições, de onde, com que latência.** Não há log de requisição
  HTTP. Não dá para responder "a API ficou lenta às 14h?" nem "quantos 401
  tivemos?".
- **Tentativas de login falhas.** O limitador conta em memória, mas não escreve
  linha nenhuma. Uma força bruta contra a conta do administrador não aparece em
  lugar nenhum — nem no log, nem na tela de Acessos (que é só sobre o público
  externo).
- **Alertas.** Nada avisa ninguém. `nominal_taken` só existe se alguém abrir a
  tela de Acessos e olhar. Estabeleça uma rotina humana: alguém olha essa tela
  toda manhã.

### Rotina mínima sugerida

| Frequência | O quê |
|---|---|
| Diária | Abrir Admin → Acessos, filtrar o dia, procurar `nominal_taken` e sequências de `invalid_code` |
| Diária | Conferir `/health` (ou deixar o monitor da plataforma fazendo) |
| Semanal | Admin → Contatos: números vinculados que não deveriam mais existir |
| Semanal | Admin → Agentes: usuários ativos que já saíram do hospital |
| A cada deploy | O checklist da seção 8 |

---

## 7. Resposta a incidente

Três cenários, na ordem de gravidade.

### 7.1 Suspeita de vazamento do `JWT_SECRET`

Sinais: o segredo apareceu em um commit, em um print, em um canal de chat, ou
alguém com acesso ao painel de hospedagem saiu da equipe.

Trate como **comprometimento total do acesso interno**: com essa chave, qualquer
pessoa fabrica um token de administrador de qualquer hospital.

1. **Rotacione agora** (seção 2). Não espere janela de manutenção; um segredo
   vazado não tem horário comercial.
2. Reinicie a API e confirme `/health`.
3. Peça a todos que loguem de novo. Avise os atendentes que o plantão será
   reaberto no login.
4. Como não há log de requisição, **você não vai conseguir provar** se a chave foi
   usada. Assuma que pode ter sido: revise a tela de Contatos e a de Links
   procurando alterações que ninguém reconheça (link criado, contato reatribuído,
   usuário novo).
5. Registre o incidente por escrito, com hora da rotação — é o que existirá de
   linha do tempo.

### 7.2 Suspeita de comprometimento do banco

O banco guarda número de telefone em texto puro, corpo de todas as mensagens,
notas de satisfação e observações livres sobre as pessoas (`holder_note`, campo
onde se escreve coisas como "filha do paciente do quarto tal"). É dado de saúde.

1. Corte o acesso: troque a senha do banco no provedor e reinicie a API com a nova
   `DATABASE_URL`.
2. Rotacione o `JWT_SECRET` junto — quem lê o banco lê `password_hash`, e hash de
   senha fraca cai rápido.
3. Force a troca de senha de todos os usuários internos. **Não existe endpoint
   para isso**: na prática, crie usuários novos e desative os antigos, ou atualize
   os hashes direto no banco.
4. Avalie a obrigação de comunicar titulares e autoridade. Isto não é decisão de
   engenharia; envolva quem responde por proteção de dados no hospital.
5. O que **não** dá para fazer hoje: dizer quais registros foram lidos. Não há log
   de acesso a dado.

### 7.3 Suspeita de link vazado

Siga a seção 4. Em resumo: confirme na tela de Acessos, revogue o link, emita um
novo para a pessoa certa e entregue por canal direto. Se o link era de perfil e é
usado por muita gente, avalie revogar e reemitir para todos — o custo é reenviar
o link, não recadastrar ninguém, porque o externo não tem cadastro.

Guarde o número de `use_count` do link antes de revogar (visível na tela de
Links): ele é a única medida de quantas vezes aquele link foi aberto.

---

## 8. Checklist de deploy

Antes de subir qualquer alteração:

- [ ] `npm run build` passa nos dois aplicativos (`apps/api` e `apps/web`)
- [ ] Parar o servidor de desenvolvimento antes do build do front — `next dev` e
      `next build` disputam a mesma pasta `.next`
- [ ] Variáveis conferidas no painel do provedor, uma a uma, contra a tabela da
      seção 1
- [ ] `WEB_ORIGIN` sem barra final e igual à URL real do painel
- [ ] `PUBLIC_BASE_URL` sem barra final e igual à URL real da API
- [ ] `ALLOW_DEMO_SEED` ausente ou `false` (ver o alerta abaixo)
- [ ] Se o provider for `twilio`: SID, token e `TWILIO_VALIDATE_WEBHOOK=true`,
      os três juntos
- [ ] Migrações aplicadas (`prisma migrate deploy`) — no Render isso está no
      comando de start
- [ ] Depois de subir: `/health` responde 200
- [ ] Depois de subir: um login real, uma conversa aberta, uma mensagem enviada

### Alerta sobre o seed

`npm run seed -w api` executa `apps/api/prisma/seed.ts`, que **apaga tudo antes de
recriar** — feedbacks, mensagens, conversas, tentativas de acesso, contatos,
links, usuários, setores, números e hospitais (`prisma/seed.ts:138-156`). Esse
comando **não tem portão nenhum**: `ALLOW_DEMO_SEED` só protege o caminho
automático do start (`scripts/seed-if-empty.ts:14-17`), não a execução manual.

Rodar `npm run seed` apontando para o banco errado destrói o banco. Antes de
rodar, confira duas vezes qual `DATABASE_URL` está no ambiente.

O caminho automático (`seed-if-empty.ts`) é mais cuidadoso: só semeia com
`ALLOW_DEMO_SEED=true` **e** nenhum usuário no banco. Ele conta usuários, e não
hospitais, porque um seed interrompido no meio deixa hospital criado sem ninguém
para logar.

---

## 9. Checklist: clonar isto para um hospital de verdade

Esta é a seção que mais importa se o projeto sair da demonstração. O repositório é
um blueprint de demonstração; algumas coisas precisam ser **desligadas**, e outras
simplesmente não existem ainda.

### 9.1 Desligar a demonstração

- [ ] **`ALLOW_DEMO_SEED` fora do ambiente.** Não declare a variável. Com ela em
      `true` e o banco sem usuários, o primeiro start cria dois hospitais de
      exemplo com administradores de senha fraca — uma senha curta, idêntica para
      todos, escrita em texto no arquivo de seed, que é público. O `render.yaml`
      mantém a variável comentada de propósito.
- [ ] **Se o seed já rodou alguma vez neste banco**, os usuários de demonstração
      existem. Não basta desligar a variável depois. Faça: crie um administrador
      novo com senha forte, entre com ele, desative todos os usuários de
      demonstração (endereços terminados em `.test`) e confirme que nenhum deles
      aparece como ativo. Lembre das travas: você não desativa a própria conta nem
      o último administrador ativo.
- [ ] **Números de WhatsApp de demonstração removidos.** O seed cadastra números
      de sandbox; um hospital real precisa do número real, e o webhook resolve o
      hospital exatamente por esse campo.
- [ ] **`JWT_SECRET` novo**, gerado por você, nunca o valor de nenhum exemplo.
- [ ] **`WHATSAPP_PROVIDER=twilio`.** Com `mock` (o padrão!) nenhuma mensagem sai
      de verdade — o painel funciona, o atendente digita, e o paciente nunca
      recebe nada.

### 9.2 O que não existe e você vai precisar fazer à mão

Verifiquei rota por rota: **não há endpoint para criar hospital nem para cadastrar
número de WhatsApp**. Os repositórios só têm consulta
(`repositories/tenants.ts`, `repositories/whatsappNumbers.ts`), e o único código
que cria essas linhas é o seed — que apaga o banco antes.

Provisionar um hospital de verdade hoje significa, portanto, inserir à mão no
banco:

1. A linha do hospital (`tenants`), com nome e fuso horário correto — o fuso rege
   o plantão e o recorte de "hoje" nos relatórios.
2. A linha do número de WhatsApp (`whatsapp_numbers`), em formato internacional
   puro, sem o prefixo `whatsapp:`, com status ativo.
3. O primeiro administrador (`users`), com o hash de senha gerado por bcrypt.

Do primeiro administrador em diante, tudo é feito pelo painel: setores, agentes,
escalas, links.

Documente esse procedimento antes de repetir — hoje ele existe só no seed, e o
seed não serve para produção.

### 9.3 Decisões que não são de engenharia

Leve estas para o responsável pelo hospital, por escrito, **antes** do primeiro
paciente:

- [ ] **Retenção.** Hoje nada é apagado, nunca. Quanto tempo o hospital quer
      guardar conversa de paciente?
- [ ] **Exclusão a pedido do titular.** Não existe rota de exclusão nem de
      exportação. Se alguém pedir seus dados de volta, ou pedir para apagá-los, o
      atendimento é manual, no banco.
- [ ] **Quem pode ser admin.** O administrador vê a conversa de todos os
      pacientes de todos os setores. Isso é uma decisão clínica e de governança,
      não de perfil de software.
- [ ] **Anexos.** O sistema recebe foto e áudio, avisa que só lê texto e **não
      guarda a mídia** (`services/webhook.service.ts:172-182`). O arquivo fica na
      Twilio. Se a mídia passar a ser guardada, imagem de exame é dado de saúde e
      a decisão muda de tamanho.
- [ ] **Backup e restauração.** O plano gratuito do Render é descartável — o
      `README.md` registra que o Postgres gratuito expira e que os serviços
      hibernam. Produção precisa de plano pago, backup testado e um teste de
      restauração que alguém já tenha feito ao menos uma vez.

---

## 10. O que NÃO está protegido hoje

Lista explícita, sem eufemismo. Nada aqui é hipótese: cada item foi conferido no
código.

### 10.1 Sem limite de tráfego no webhook

`loginRateLimit` é aplicado **apenas** em `POST /auth/login`
(`routes/auth.ts:27`). Confirmei por busca: não existe limitador em nenhuma outra
rota, nem no webhook, nem no redirect público `/c/:slug`, nem no `/health`.

Consequência prática: um número desconhecido que mande cem mensagens gera cem
linhas em `access_attempts` e faz o hospital pagar cem respostas de "Não
identificamos seu acesso" (`services/webhook.service.ts:106-109`). Não há teto,
nem por número, nem por hospital.

Com a assinatura da Twilio ligada, quem faz isso precisa ser um número de WhatsApp
real, o que limita muito o volume. Com a assinatura desligada, qualquer um faz de
qualquer lugar — mais um motivo para o portão de boot da seção 3.

O limitador de login, esse existe e foi endurecido: dez tentativas por
origem+conta e vinte por conta em quinze minutos (`middleware/rateLimit.ts:22-23`).
Mas ele conta **em memória**, ou seja, vale por instância.

### 10.2 Sem retenção e sem exclusão de dado pessoal

Nada é apagado, nunca. Não há rota de exclusão, nem de exportação, nem prazo de
expurgo. Conversa de 2026 continuará no banco em 2030.

### 10.3 Número de telefone em texto puro

O número fica em texto puro em `external_contacts.wa_number` e em
`access_attempts.wa_number` (`prisma/schema.prisma:300,318`), e aparece inteiro
nas telas do painel. Quem tiver acesso de leitura ao banco tem a lista de números
de todos os pacientes, familiares e médicos externos que já escreveram para o
hospital.

Nos **logs** o número é mascarado (seção 6). No banco e na tela, não.

### 10.4 Uma instância só

Três mecanismos importantes vivem na memória do processo:

| Mecanismo | Arquivo | O que quebra com duas instâncias |
|---|---|---|
| Fila serial por contato | `utils/keyedQueue.ts` | Duas mensagens do mesmo contato em processos diferentes podem abrir duas conversas |
| Memória de mensagens já vistas | `utils/seenMessageIds.ts` | Reentrega da Twilio pode duplicar registros de tentativa de acesso |
| Contagem de tentativas de login | `middleware/rateLimit.ts` | O teto vira "dez por instância" |

Existem defesas de banco por baixo (índice único de mensagem, trava de linha na
reivindicação de link nominal, índice parcial de conversa ativa), então o pior
caso não é catastrófico. Mas **o sistema foi pensado para rodar em uma instância**
e escalar horizontalmente exige revisar esses três pontos primeiro. Os jobs de
inatividade e de plantão também rodam dentro de cada processo
(`index.ts:17-18`) — com duas instâncias, os dois varrem o mesmo banco.

### 10.5 Sem cabeçalhos de segurança e sem log de auditoria

- Nenhum cabeçalho de proteção (nenhum `helmet` no projeto, confirmado por busca
  no código e no `package.json`), e o `X-Powered-By: Express` não é desligado.
- A verificação do token não fixa o algoritmo de assinatura
  (`middleware/auth.ts:32`) nem confere emissor. Classificado pela auditoria como
  endurecimento informativo, não como falha explorável hoje.
- O token de login fica no `localStorage` do navegador
  (`apps/web/lib/api.ts:41`). Qualquer execução de script malicioso na página o
  leva embora, e não há como revogar um token individual — só rotacionar a chave.
- Sem log de auditoria administrativa (seção 6).

### 10.6 Itens conhecidos e adiados

A auditoria deixou 21 achados para depois, com justificativa registrada. Os que
mais afetam quem opera:

| Id | O que é | Impacto operacional |
|---|---|---|
| A22 | Setor desativado continua recebendo conversa que já estava nele | Setor sumiu da tela e continua atendendo |
| A25 | A migração do índice de conversa única tem janela de falha se rodar com a versão antiga ainda ativa | Deploy pode falhar; o conserto é reaplicar |
| A30 | Revogar link de perfil com muitos contatos pode estourar o tempo da requisição | Link revogado com conversas ainda vivas |
| A31 | A criação de usuário distingue "e-mail já existe na plataforma" de "não existe" | Um admin descobre e-mails de outros hospitais, um por vez |
| A41 | Rascunho de mensagem se perde na tela de ramal interno quando o plantão acaba | Texto digitado perdido |

---

## 11. Limites desta análise

Para que ninguém tome decisão maior do que a evidência sustenta:

- **Só li o repositório.** Não tenho acesso ao painel do Render, ao console da
  Twilio nem ao banco de produção. Onde este guia diz "no painel", é instrução —
  não é verificação de que o painel está assim hoje. **Confira as variáveis de
  produção com os próprios olhos.**
- **Não executei o sistema.** Não subi a API, não rodei migração, não disparei
  seed, não testei os portões de boot na prática. O que afirmo sobre eles vem de
  leitura do código; o time de red team da auditoria relatou tê-los exercitado e
  não ter achado desvio, mas esse é o relato deles, não uma medição minha.
- **Não testei nada contra a Twilio de verdade.** A seção 3 descreve o
  comportamento documentado no código e no SDK. A primeira integração real vai
  precisar de um teste de ponta a ponta com uma mensagem de verdade.
- **Não avaliei conformidade jurídica.** As menções a dado pessoal e dado de saúde
  são para levantar a pergunta, não para respondê-la. Quem responde por proteção
  de dados no hospital precisa olhar isto.
- **Este guia envelhece.** Ele descreve a branch `fix/concorrencia-na-distribuicao`
  no momento da auditoria. Toda vez que uma variável de ambiente for adicionada ou
  um portão de boot mudar, a seção 1 fica errada — e um guia operacional errado é
  pior do que nenhum, porque alguém decide em cima dele.
