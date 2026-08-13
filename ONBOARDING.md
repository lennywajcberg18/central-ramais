# ONBOARDING — Central de Ramais com Acesso Controlado

Bem-vindo. Este documento existe para você abrir um PR útil no **primeiro
dia**, sem precisar perguntar nada básico.

Leia inteiro antes da primeira linha de código. São ~15 minutos e economizam
uma semana de retrabalho.

**Ordem de leitura:**
1. Este arquivo — contexto, decisões, como trabalhamos
2. `PROJETO.md` — especificação técnica
3. `TASKS.md` — backlog executável
4. `CLAUDE.md` — regras do repo, valem para você também

---

## 1. Pense na telefonista do hospital

Antes dos ramais diretos, existia uma pessoa no meio: você ligava, dizia com
quem queria falar, e ela passava — **ou não**. A telefonista sabia quem tinha
direito de falar com quem. Fornecedor não caía na UTI. Vendedor não caía na
diretoria.

Depois vieram os ramais diretos e essa camada de julgamento sumiu.

**É ela que estamos reconstruindo, no WhatsApp.** Não só o encaminhamento — o
controle de quem pode falar com quem.

## 2. O produto, em concreto

O administrador do hospital cadastra os setores: Recepção, Cardiologia,
Fisioterapia, Enfermagem, Faturamento. Depois emite **links de acesso**, e em
cada um escolhe quais setores aquele link enxerga.

Um médico externo que encaminha pacientes recebe um link. Ao usar, vê:

> Olá! Com quem deseja falar?
> 1 — Cardiologia
> 2 — Enfermagem
> 3 — Recepção

Digita `1`, cai na fila da Cardiologia, um médico do setor responde pelo app.

O mesmo hospital emite outro link para um fornecedor, que vê apenas Recepção e
Suprimentos. E um terceiro para a filha de um paciente internado, que vê só
Enfermagem — e nesse caso **pula o menu**, porque a lista tem um item só.

Ninguém vê o número pessoal de ninguém. Não há login nem cadastro para o
externo: **o link é a credencial**.

## 3. Isto NÃO é um helpdesk

Guarde isso — é a fonte de metade dos erros de design possíveis aqui.

Sem ticket, sem SLA em dias, sem histórico de relacionamento, sem cadastro. As
conversas são:

- **Curtas** — duas a cinco mensagens
- **Transacionais** — "o resultado do exame saiu?", "preciso remarcar"
- **Sem fricção** — nada de formulário, nome, e-mail ou confirmação

**Toda fricção que você adicionar mata o produto.** Se você se pegar
implementando um cadastro ou uma confirmação para o externo, pare e pergunte.

## 4. Vocabulário — use estes termos, sempre

| Termo | Significa | Não confunda com |
|---|---|---|
| **Tenant** | A organização cliente (hospital, clínica) | O paciente |
| **Department** | Setor / ramal. Item do menu | Uma pessoa |
| **Agent** | Profissional interno que loga e atende | O contato externo |
| **Entry link** | A credencial. Define quais setores o externo vê | Um link qualquer |
| **External contact** | Número de fora, vinculado a um link | Um `user` do sistema |
| **Conversation** | Um atendimento. Unidade de métrica | Uma mensagem |

**Armadilha número um:** eu, falando informalmente, uso "ramal" às vezes como
setor e às vezes como pessoa. **No MVP, ramal = setor**, com fila de vários
agentes. Ramal-pessoa ("falar com o Dr. Silva") é o primeiro item da V2. Se eu
falar algo ambíguo, me pergunte.

## 5. Decisões já tomadas — e por quê

Não reabra sem falar comigo. Cada uma custou discussão e tem motivo não óbvio:

| Decisão | Motivo |
|---|---|
| **Twilio**, não Meta Cloud API | Onboarding em horas, não dias. Migração fica atrás da interface `WhatsAppProvider` |
| **Express**, não Fastify | `twilio.webhook()` — validação de assinatura — é middleware Express nativo. Com Fastify escreveríamos HMAC na mão no ponto mais crítico |
| **Menu por texto**, não botões | Menos superfície de bug. Botões entram depois, atrás da mesma abstração |
| **Sem login para o externo** | Fricção zero é requisito de produto, não preguiça |
| **Redirect próprio** antes do `wa.me` | Permite trocar o número e revogar acesso **sem reemitir o link para quem já recebeu** |
| **Uma conversa por vez** | Elimina uma classe de ambiguidade. Em troca, exige timeout e a saída via MENU |
| **Sem validade automática de link** | Só revogação manual. Validade automática confunde mais do que ajuda no MVP |
| **Polling 5s**, não WebSocket | Volume baixo não paga a complexidade |
| **Ramal-pessoa, contexto de quarto/leito, caso hotel** | Tudo V2 |

## 6. Os dois níveis de autorização

Este é o conceito que você **precisa** entender antes de escrever qualquer
linha. Não são um; são dois, e servem a coisas diferentes:

**Nível 1 — Tenant.** Isolamento entre hospitais. Vale para o app interno,
para toda query, sempre. Hospital A nunca vê nada do Hospital B.

**Nível 2 — Entry link.** Quais setores um externo específico pode acessar
dentro do próprio hospital.

```ts
// ERRADO — monta o menu com todos os setores do hospital
const depts = await listDepartments(tenantId);

// CERTO — monta com os setores que o link permite
const depts = await listDepartmentsForLink(tenantId, entryLinkId);
```

**Toda vez que o sistema mostra ou aceita um setor para um externo**, a lista
vem do link dele. São três pontos: menu inicial, resposta ao MENU, e validação
da escolha numérica.

Um externo digitar "3" e cair num setor que o link não permite é **falha de
autorização**, não bug de UX. Trate com o mesmo rigor de um vazamento entre
tenants.

## 7. O vínculo número ↔️ link (leia com atenção)

Aqui está a parte mais sutil do sistema. Se você não entender isso, vai
implementar uma revogação que não revoga nada.

**O problema:** depois da primeira mensagem, o número do hospital fica no
histórico do WhatsApp da pessoa. Ela pode escrever amanhã sem tocar no link.
Se o sistema só validasse o código do link, revogar seria botão decorativo.

**A solução:** no primeiro uso com código válido, nasce um `external_contact`
amarrando `wa_number → entry_link`. Dali em diante o código nem precisa mais
aparecer nas mensagens — o vínculo é a fonte de verdade.

Consequências práticas:

- **Revogar o link** derruba todos os contatos vinculados a ele.
- **Link nominal aceita um número só.** Segundo número tentando é recusado e
  vira alerta no painel — é assim que o admin descobre que o link vazou.
- **Link de perfil** aceita quantos vierem.
- **Toda recusa vira `access_attempt`.** Silenciar é perder o sinal.

A tabela de decisão completa do webhook está em `PROJETO.md`. Implemente-a
**literalmente**, linha por linha. É a T1.4, e é a task mais importante do
projeto.

## 8. A regra que não se negocia

> **Nenhuma query chega ao banco sem `tenant_id` no filtro.**

Sem exceção. Nem em debug, nem em seed, nem em migração, nem "só neste caso
porque o ID é UUID".

Um hospital ver a conversa de outro é incidente de LGPD e mata o produto. Bug
de layout se corrige na segunda-feira; isso não tem recuperação.

```ts
// ERRADO — IDOR clássico
await prisma.conversation.findUnique({ where: { id } });

// CERTO
await prisma.conversation.findFirst({ where: { id, tenantId } });
```

O `tenantId` vem **sempre** de `req.auth.tenantId` (JWT assinado). Nunca de
body, query, params ou header.

Instale a skill `multi-tenant-guard` no seu Claude Code — tem o checklist, os
padrões prontos e os greps de revisão. Vou cobrar em PR.

## 9. Como trabalhamos — Git

- **Nunca commite em `main`.** Nem um typo.
- Uma branch por task: T1.4 → `feat/access-control`
- **Uma task por PR.** PR que faz duas coisas volta sem review
- Worktrees para trabalho paralelo:
  ```bash
  git worktree add ../wc-access-control -b feat/access-control
  cd ../wc-access-control
  ```
  Cada worktree é uma pasta com checkout próprio, compartilhando o mesmo
  `.git`. Dois `npm run dev` em portas diferentes, sem conflito.
- Merge só após build passando + teste manual + review meu
- Marque o checkbox no `TASKS.md` no mesmo PR

### Template de PR

```markdown
## Task
T1.4 — Controle de acesso

## O que faz
Uma frase.

## Como testar
```bash
curl -X POST localhost:3001/webhooks/twilio/whatsapp \
  -d 'From=whatsapp:+5521900000004' -d 'To=whatsapp:+14155238886' \
  -d 'Body=Olá! [ANAR]' -d 'MessageSid=SM999'
```
Esperado: recusa, e a tentativa aparece em /admin/acessos.

## Autorização
- [ ] Queries filtram por tenantId
- [ ] Listas de setor vêm do entry_link, não do tenant
- [ ] Testado cross-tenant → 404

## Notas
Qualquer coisa que eu precise saber.
```

## 10. Setup local — 5 minutos

Pré-requisitos: Node 20+, Docker, Git.

```bash
git clone <url> central-ramais && cd central-ramais
cp .env.example apps/api/.env
docker compose up -d          # só o Postgres
npm install
npm run migrate -w api
npm run seed -w api
npm run dev                   # api:3001  web:3000
```

O seed imprime as credenciais e os códigos dos links. Valide:

```bash
curl -X POST http://localhost:3001/webhooks/twilio/whatsapp \
  -d 'From=whatsapp:+5521900000002' \
  -d 'To=whatsapp:+14155238886' \
  -d 'Body=Olá! [MEDX]' \
  -d 'MessageSid=SM'$RANDOM
```

Deve criar o contato vinculado e logar no console o menu com **três** setores
— não com os cinco do hospital. Se aparecerem cinco, o escopo do link não está
sendo respeitado.

O provider padrão em dev é o `MockProvider`; nada sai de verdade.

**Você não precisa de conta na Twilio para desenvolver.** Só quando formos
testar com celular real — aí eu passo as credenciais.

### O seed cria dois tenants de propósito

Hospital Vida e Clínica Reabilitar. Não reduza para um. Teste com um tenant só
passa mesmo com o isolamento completamente quebrado — é o erro de setup mais
caro que existe neste tipo de sistema.

## 11. Arquitetura em 30 segundos

```
apps/api/
  src/
    routes/         parse → service → resposta. Não fala com Prisma
    services/       regra de negócio. Não conhece HTTP
    repositories/   banco. tenantId é SEMPRE o 1º parâmetro
    providers/      WhatsAppProvider (Mock | Twilio)
    jobs/           timeout de inatividade
    middleware/     auth, error handler
    config.ts       env validado no boot

apps/web/
  app/
    login/
    conversas/      app do agente
    admin/          setores, agentes, links, contatos, acessos, dashboard

packages/shared/    tipos (status, roles, DTOs)
```

O SDK da Twilio **não é importado em lugar nenhum** fora de
`providers/twilio.ts`. É o que vai permitir migrar para a Meta Cloud API sem
reescrever nada.

## 12. Os pontos onde as coisas quebram

Aprenda agora, não depois.

**O webhook sempre responde 200.** Mesmo em erro interno. Logue e devolva 200.
Se devolver 500, o Twilio reentrega em loop e você vira o problema.

**O Twilio reentrega mensagens.** `wa_message_id` é UNIQUE, duplicata é
ignorada em silêncio com 200. Não é opcional.

**O código do link some depois do primeiro uso.** A pessoa manda "Olá! [MEDX]"
uma vez e depois só "1", "obrigado", "tchau". O vínculo é que sustenta o
acesso — não fique procurando código em toda mensagem.

**Contato bloqueado é silêncio total.** Sem resposta, sem mensagem de erro.
Responder confirma que o número está cadastrado.

**`first_reply_at` é write-once.** Só na primeira mensagem do **agente** — não
na do sistema, não na segunda. As métricas dependem desse campo.

**`last_message_at` a cada mensagem, inbound e outbound.** É o que o job de
timeout consulta 1.440 vezes por dia. Sem ele, vira join caro.

**O número vem com prefixo.** O Twilio manda `whatsapp:+5521999999999`. No
banco guardamos E.164 puro. Normalize na entrada, sempre.

**Webhook não tem sessão.** O tenant é resolvido pelo campo `To` contra
`whatsapp_numbers`. Não resolveu? 200 e nada mais.

**Conversa aberta bloqueia o externo.** Como só existe uma por vez, se o
agente esquecer de encerrar, a pessoa não fala com outro setor. É por isso que
o timeout de 30 min e a palavra-chave MENU existem — não são enfeite.

**Job itera por tenant.** Nunca varra a tabela inteira num cron multi-tenant.

## 13. Fora de escopo

Não implemente, mesmo parecendo fácil e você estando "já ali":

**Ramal-pessoa** (falar direto com o Dr. Silva) — é o próximo grande item, mas
é V2 · **Contexto de origem** (quarto, leito, andar) — V2 · **Caso de uso
hotel** — V2 · Horário de funcionamento por setor · Validade automática de
link · Transferência entre setores pelo agente · Botões interativos ·
Templates e janela de 24h · Anexos e mídia · Conversas paralelas · WebSocket ·
Bot com IA · Integração com HIS · Billing · Múltiplos números por tenant ·
Refresh token · Testes além do smoke e dos cross-tenant.

Achou que uma delas bloqueia sua task? **Pare e pergunte** — provavelmente há
um caminho mais simples que eu já pensei.

## 14. Definition of done

- [ ] `npm run build` passa nos dois apps
- [ ] Testado manualmente, comando no PR
- [ ] Toda query nova filtra por `tenantId`
- [ ] Se a task toca em menu ou escolha de setor: a lista vem do link
- [ ] Teste cross-tenant se a task adicionou endpoint com ID
- [ ] `TASKS.md` atualizado no mesmo PR
- [ ] PR com o template preenchido

## 15. Como me perguntar as coisas

Pergunte cedo e pergunte junto. Prefiro três perguntas no começo do que
descobrir na review que você passou meio dia numa suposição errada.

Formato que funciona:

> **T2.2** — quando nenhum agente do setor está disponível, a conversa fica na
> fila até alguém ficar, ou atribuo ao menos ocupado mesmo assim?
> Minha suposição: fica na fila. Sigo com isso se você não responder até 14h.

Suposição explícita + prazo. Assim eu não viro bloqueio.

**Não precisa perguntar:** nome de variável, organização interna de pasta,
como você estrutura o componente. Confio no seu julgamento.

**Sempre pergunte:** mudança no modelo de dados, endpoint novo fora do
`PROJETO.md`, dependência nova, e qualquer coisa que toque nos **dois níveis
de autorização** — tenant ou escopo de link.

## 16. Sua primeira semana

**Dia 1, manhã** — Leia os 4 documentos. Suba o ambiente. Rode os nove curls
de teste do `TASKS.md` — eles são o melhor mapa do comportamento do sistema
que existe. Logue no app. Abra o Prisma Studio e olhe os dois tenants.
Me mande três perguntas sobre o que não fechou.

**Dia 1, tarde** — Pegue uma task pequena para calibrar o fluxo: branch →
implementa → testa → PR com template. O objetivo é validar o processo, não a
complexidade. **Não pegue a T1.4 de cara** — é a mais delicada do projeto.

**Dia 2 em diante** — Vamos dividir por camada: eu no backend/webhook/acesso,
você no app do agente e no admin. Ou o inverso, se preferir. Me diga onde você
rende mais.

---

Algo aqui errado, desatualizado ou confuso? **Abra um PR corrigindo.**
Onboarding ruim é bug.
