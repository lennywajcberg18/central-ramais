# Central de Ramais com Acesso Controlado — MVP (3 dias)

## Objetivo

Uma central de ramais via WhatsApp onde o hospital **controla quem de fora
pode falar com quais setores**.

O administrador cadastra os setores (Cardiologia, Fisioterapia, Enfermagem,
Recepção, Faturamento…) e emite **links de acesso**. Cada link carrega a
lista de setores que ele enxerga. A pessoa externa recebe o link, escaneia ou
clica, e o WhatsApp abre já direcionado.

Ninguém vê o número pessoal de ninguém. O gestor vê volume, tempo de resposta,
satisfação e quem acessou o quê.

## O caso de uso, em concreto

Um médico externo que encaminha pacientes recebe um link. Ao usá-lo, vê:

> Olá! Com quem deseja falar?
> 1 — Cardiologia
> 2 — Enfermagem
> 3 — Recepção

Digita `1`. Cai na fila da Cardiologia, um médico do setor responde pelo app.

O mesmo hospital emite outro link para um fornecedor, que ao usá-lo vê apenas:

> 1 — Recepção
> 2 — Suprimentos

E um terceiro link para a filha de um paciente internado, que vê só
Enfermagem — e nesse caso pula o menu, porque a lista tem um item só.

**O link é a credencial.** Não há login, senha ou cadastro para o externo.

## Isto NÃO é um helpdesk

Guarde isso — é a fonte de metade dos erros de design possíveis aqui.

Sem ticket, sem SLA em dias, sem histórico de relacionamento, sem cadastro do
externo. As conversas são:

- **Curtas** — duas a cinco mensagens
- **Transacionais** — "o resultado do exame saiu?", "preciso remarcar"
- **Sem fricção** — nada de formulário, nome, e-mail ou confirmação

Toda fricção adicionada mata o produto.

---

## Decisões travadas

| Item | Escolha | Por quê |
|---|---|---|
| Provedor | **Twilio WhatsApp** | Onboarding em horas. Migração para Meta fica atrás da interface `WhatsAppProvider` |
| Backend | **Node + Express + TypeScript** | `twilio.webhook()` é middleware Express nativo |
| ORM / DB | **Prisma + PostgreSQL 16** | |
| Frontend | **Next.js App Router + TS + Tailwind** | |
| Auth interna | **JWT** simples, sem refresh | |
| Auth externa | **Nenhuma** — o link é a credencial | Fricção zero é requisito de produto |
| Real-time | **Polling 5s** | Volume baixo não paga WebSocket |
| Entrada | Link próprio → **302 → `wa.me`** | Permite trocar número e medir uso sem reemitir link |
| Menu | **Texto** ("digite 1") | Sem botões interativos no MVP |
| Ramal | = **Setor** com fila de agentes | Ramal-pessoa fica para V2 |
| Conversa | **Uma aberta por contato por tenant** | |
| Vínculo | Número fica **amarrado ao link** no primeiro uso | Sem isso, revogar não revoga nada |

---

## Glossário

| Termo | Significa |
|---|---|
| **Tenant** | A organização cliente (hospital, clínica) |
| **Department** | Setor / ramal. Item do menu |
| **Agent** | Profissional interno que loga no app e atende |
| **Entry link** | Credencial de acesso. Define quais setores o externo enxerga |
| **External contact** | Número de fora, vinculado a um entry link |
| **Conversation** | Um atendimento. Unidade de métrica |

**Cuidado:** informalmente o dono do projeto usa "ramal" às vezes como setor,
às vezes como pessoa. **No MVP, ramal = setor**, com fila de vários agentes.
Ramal-pessoa ("falar com o Dr. Silva") está no roadmap da V2.

---

## Entry links — o coração do produto

### Anatomia

```
central.app/c/<slug>
      ↓  302, incrementa use_count
wa.me/<numero>?text=Olá! [A7K2]
      ↓  abre o WhatsApp do usuário com o texto pronto
usuário envia → nosso webhook
```

O redirect no **nosso** domínio permite trocar o número do WhatsApp, revogar o
acesso ou medir uso **sem reemitir nada para quem já recebeu o link**.

### Dois tipos

| Tipo | Quantos números aceita | Uso típico |
|---|---|---|
| **Perfil** (`profile`) | Ilimitado | "Médico Externo", "Fornecedor", "Convênio" — vários usam o mesmo |
| **Nominal** (`nominal`) | **Um só** | Uma pessoa específica. Segundo número é recusado e vira alerta |

Ambos revogáveis a qualquer momento. **Sem data de validade automática.**

### Setores habilitados — relação N:N

Cada link aponta para uma **lista** de setores (`entry_link_departments`).
O menu é montado a partir dessa lista, nunca da lista completa do tenant.

- Lista com 1 setor → **pula o menu**, entra direto
- Lista com 2+ → mostra o menu com apenas esses setores
- Lista vazia → configuração inválida, bloquear na criação

Um setor desativado depois some do menu automaticamente, sem editar link.

### Snapshot

A `conversation` grava `entry_link_id` **e uma cópia do rótulo do link** em
`entry_link_label_snapshot`.

Motivo: link revogado ou renomeado não pode transformar o histórico em
mentira. O relatório do mês passado precisa continuar dizendo de onde veio.

---

## Vínculo número ↔️ link

Esta é a parte que faz a revogação funcionar de verdade.

### O problema

Uma vez que a pessoa mandou a primeira mensagem, o número do hospital está no
histórico do WhatsApp dela. Ela pode escrever amanhã sem usar o link. Revogar
o link, por si só, não impediria nada.

### A solução

No primeiro uso com código válido, nasce um `external_contact` amarrando
`wa_number → entry_link`. A partir daí o código nem precisa mais aparecer.

### Tabela de decisão do webhook

| Situação | Ação |
|---|---|
| Contato conhecido, link ativo | Segue normal, menu com os setores do link |
| Contato conhecido, link **revogado** | *"Seu acesso foi encerrado. Procure o hospital."* Encerra conversa aberta, se houver |
| Contato conhecido, **bloqueado** | Silêncio total. Sem resposta |
| Novo número, código válido, link `profile` | Cria o contato, vincula, segue |
| Novo número, código válido, link `nominal` **livre** | Cria o contato, vincula, segue |
| Novo número, código válido, link `nominal` **já usado** | Recusa. Registra `access_attempt`, alerta o admin |
| Novo número, sem código ou código inválido | *"Não identificamos seu acesso. Solicite um link ao hospital."* Registra `access_attempt` |

Toda tentativa negada vira linha em `access_attempts` — o admin precisa ver
isso. É o sinal de que um link nominal vazou.

**Um contato tem um link.** Se a pessoa precisa de acesso diferente, o admin
revoga e emite outro, ou reatribui o contato a outro link pelo painel.

---

## Máquina de estados da conversa

```
                mensagem de contato autorizado
                            │
                ┌───────────┴───────────┐
        link com 1 setor          link com 2+ setores
                │                       │
                ▼                       ▼
              open            awaiting_department
                │                       │
                │           digita 1/2/3 ──┘
                ▼
           [roteamento]
                │
                ▼
            assigned ◄─────────┐
                │              │ agente responde
                ├─ MENU ───► awaiting_menu_confirm
                │              │ SIM → encerra e volta ao menu
                │              │ NÃO → volta para assigned
                │
                ├─ agente encerra ──┐
                ├─ 30min inativo ───┤
                ├─ link revogado ───┤
                │                   ▼
                │           awaiting_feedback
                │                   │ nota 0-10 (ou ignora)
                ▼                   ▼
                                 closed
```

### Estados

| Status | Significa |
|---|---|
| `awaiting_department` | Aguardando escolha no menu |
| `open` | Setor definido, na fila, sem agente |
| `assigned` | Agente atribuído, em atendimento |
| `awaiting_menu_confirm` | Digitou MENU, aguardando SIM/NÃO |
| `awaiting_feedback` | Encerrada, aguardando nota. **Não bloqueia nova conversa** |
| `closed` | Fim |

### close_reason

`agent_closed` · `timeout` · `user_switched` · `access_revoked` ·
`no_agent_available`

Segmentar as métricas por isso é o que separa CSAT real de CSAT de conversa
abandonada.

---

## Comportamentos obrigatórios

### 1. Palavra-chave MENU

Em `assigned`, mensagem exatamente `MENU` (case-insensitive, sem acento,
trim):

> Você está falando com **Cardiologia**. Deseja encerrar e voltar ao menu?
> Responda **SIM** ou **NÃO**.

- `SIM` → encerra (`user_switched`), CSAT, mostra o menu **do link dele**
- `NÃO` → volta para `assigned`, avisa o agente no app
- Outra coisa → repete uma vez; na segunda, assume `NÃO`

Se o link tem um setor só, MENU responde que não há outro setor disponível e
mantém a conversa.

Sem isso, conversa esquecida pelo agente prende o externo.

### 2. Timeout de inatividade — 30 minutos

Job a cada minuto:

```sql
WHERE status IN ('assigned','awaiting_department','awaiting_menu_confirm')
  AND last_message_at < now() - interval '30 minutes'
```

Encerra com `close_reason=timeout` e envia CSAT.

Por isso existe `conversations.last_message_at` denormalizado, atualizado a
cada mensagem inbound e outbound. Sem ele o job vira join caro rodando 1.440
vezes por dia.

**O job itera por tenant explicitamente.** Nunca varre a tabela inteira.

### 3. Satisfação — enviada sempre, responder é opcional

- Ao encerrar, se `tenant.csat_enabled`: *"De 0 a 10, como foi o atendimento?
  (opcional)"*
- Número 0–10 → `feedback.score`
- Texto livre após a nota, em até 10 min → `feedback.comment`
- **Ignorar é aceitável.** Sem insistência, sem lembrete
- Mensagem nova em vez de nota → fecha sem nota e **abre conversa nova**

### 4. Uma conversa por vez

Máximo uma conversa em `awaiting_department`, `open`, `assigned` ou
`awaiting_menu_confirm` por `(tenant_id, external_contact_id)`.

`awaiting_feedback` não bloqueia.

---

## Modelo de dados

```
tenants(id, name, timezone, csat_enabled, created_at)

whatsapp_numbers(id, tenant_id, provider, phone_number, status, created_at)
  -- phone_number em E.164 puro, SEM o prefixo "whatsapp:"

departments(id, tenant_id, name, menu_key, active, sort_order, created_at)
  -- menu_key: "1", "2"...  @@unique([tenant_id, menu_key])

users(id, tenant_id, role, name, email, password_hash, active,
      availability, last_seen_at, created_at)
  -- role: admin | agent
  -- availability: available | away | offline

user_departments(user_id, department_id)

entry_links(id, tenant_id, slug, entry_code, kind, label, holder_note,
            prefill_text, active, revoked_at, revoked_by_user_id,
            use_count, created_at, created_by_user_id)
  -- slug: nanoid(8), único global, usado em /c/<slug>
  -- entry_code: 4 chars A-Z2-9 (sem 0/O/1/I), @@unique([tenant_id, entry_code])
  -- kind: profile | nominal
  -- label: "Médico Externo" ou "Dra. Ana Ribeiro"
  -- holder_note: campo livre — "CRM 12345", "filha do paciente 4B"

entry_link_departments(entry_link_id, department_id)
  -- @@id([entry_link_id, department_id])

external_contacts(id, tenant_id, wa_number, entry_link_id, blocked,
                  first_seen_at, last_seen_at)
  -- @@unique([tenant_id, wa_number])

access_attempts(id, tenant_id, wa_number, entry_code_tried, reason,
                created_at)
  -- reason: no_code | invalid_code | revoked_link | nominal_taken | blocked

conversations(id, tenant_id, whatsapp_number_id, external_contact_id,
              department_id, entry_link_id, entry_link_label_snapshot,
              status, assigned_user_id, close_reason,
              created_at, assigned_at, first_reply_at, closed_at,
              last_message_at, menu_retries)

messages(id, conversation_id, direction, sender_type, body,
         wa_message_id, created_at)
  -- direction: inbound | outbound
  -- sender_type: customer | agent | system
  -- wa_message_id UNIQUE  → dedupe de reentrega do Twilio

feedback(id, conversation_id, score, comment, created_at)
```

### Índices obrigatórios

```prisma
@@unique([tenantId, waNumber])              // external_contacts
@@index([tenantId, externalContactId, status])   // achar conversa aberta
@@index([tenantId, departmentId, status])        // fila do setor
@@index([tenantId, status, lastMessageAt])       // job de timeout
@@index([conversationId, createdAt])             // histórico
@@index([tenantId, createdAt])                   // access_attempts
@@unique([waMessageId])                          // dedupe
@@unique([tenantId, entryCode])
@@unique([tenantId, menuKey])
@@unique([slug])                                 // global por design
```

Todo índice de domínio **começa por `tenantId`**. Não é só performance: query
que esqueceu o filtro faz full scan e aparece no slow log.

---

## Métricas

| Métrica | Cálculo |
|---|---|
| Volume | conversas por setor / dia |
| FRT | `first_reply_at - created_at` |
| Tempo de atribuição | `assigned_at - created_at` |
| Tempo de resolução | `closed_at - created_at` |
| SLA | % com FRT < 5 min (fixo no MVP) |
| CSAT | média de `feedback.score` |
| Taxa de resposta CSAT | conversas com nota / encerradas |
| Abandono | % com `close_reason=timeout` |
| **Por link** | conversas por `entry_link` + contatos vinculados |
| **Por tipo de link** | perfil vs nominal |
| **Tentativas negadas** | `access_attempts` por motivo — sinal de link vazado |

Todas filtradas por `tenant_id` + intervalo `from`/`to`.

A última é a que mais importa para segurança. Pico de `nominal_taken` significa
que alguém repassou um link nominal.

---

## Endpoints

```
GET  /c/:slug                        público · 302 → wa.me · conta uso · 404 se revogado
POST /webhooks/twilio/whatsapp       público · valida assinatura

POST /auth/login                     → { token, user }

GET   /agent/conversations           minhas + fila dos meus setores
GET   /agent/conversations/:id/messages
POST  /agent/conversations/:id/messages    { body }
POST  /agent/conversations/:id/close
PATCH /agent/availability                  { availability }

GET/POST/PATCH/DELETE /admin/departments
GET/POST/PATCH/DELETE /admin/users
GET/POST/PATCH        /admin/entry-links
POST /admin/entry-links/:id/revoke
GET  /admin/entry-links/:id/qrcode         PNG
GET  /admin/entry-links/:id/contacts       números vinculados
GET  /admin/contacts                       lista + ação bloquear / reatribuir link
GET  /admin/access-attempts?from&to
GET  /admin/metrics?from&to&department_id
```

---

## Camada de provider

```ts
interface WhatsAppProvider {
  sendText(to: string, body: string): Promise<{ providerMessageId: string }>;
}
```

- `MockProvider` — loga no console, retorna id fake. **Default em dev.**
- `TwilioProvider` — SDK oficial.

O SDK da Twilio **não é importado em nenhum lugar** fora de
`providers/twilio.ts`.

---

## Fora de escopo no MVP

**Ramal-pessoa** ("falar com o Dr. Silva" direto) — V2, é o próximo grande
item · **Contexto de origem** (quarto, leito, andar) — V2 · **Caso de uso
hotel** — V2, depende do contexto · Horário de funcionamento por setor ·
Validade automática de link · Transferência entre setores pelo agente ·
Botões interativos · Templates e janela de 24h · Anexos e mídia · Conversas
paralelas · WebSocket · Bot com IA · Integração com HIS/PMS · Billing ·
Múltiplos números por tenant · Refresh token · Testes além do smoke e dos
cross-tenant.
