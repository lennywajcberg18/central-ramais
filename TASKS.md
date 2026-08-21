# TASKS — MVP Central de Ramais com Acesso Controlado

Execute em ordem. Uma branch por task. Marque o checkbox ao concluir.

---

## DIA 0 — Fundação

### T0.1 — Scaffold · `feat/scaffold`
- [x] `apps/api` (Express + TS + tsx em dev), `apps/web` (Next.js App Router +
      Tailwind), `packages/shared` (tipos)
- [x] `.gitignore`, `README.md` com "como rodar em 5 comandos"
- **Testar:** `npm run dev` sobe api:3001 e web:3000

### T0.2 — Banco, env e seed · `feat/db-setup`
- [x] `docker-compose.yml` com Postgres 16
- [x] `.env.example` completo e comentado
- [x] `config.ts` validando env no boot
- [x] Prisma schema com **todas** as tabelas e índices de `PROJETO.md`
- [x] Migration inicial
- [x] Seed com **dois tenants**:

  **Hospital Vida**
  - Setores: Recepção, Cardiologia, Fisioterapia, Enfermagem, Faturamento
  - Links:
    - `profile` "Médico Externo" → Cardiologia, Enfermagem, Recepção
    - `profile` "Convênio" → Faturamento, Recepção
    - `nominal` "Dra. Ana Ribeiro" (holder_note: "CRM 12345") → Cardiologia,
      Recepção
    - `nominal` "Familiar leito 4B" → Enfermagem *(um setor só — testa o
      pulo de menu)*
  - 1 admin + 3 agentes distribuídos nos setores

  **Clínica Reabilitar**
  - Setores: Recepção, Fisioterapia, Fonoaudiologia
  - 1 `profile` "Paciente Encaminhado" → todos
  - 1 admin + 2 agentes

  - Imprime todas as credenciais e URLs de link no fim do seed
- **Testar:** `npx prisma studio` mostra os dois tenants populados

> Dois tenants não é capricho. Teste com um só passa mesmo com o isolamento
> completamente quebrado.

---

## DIA 1 — Acesso e menu funcionando ponta a ponta

### T1.1 — Provider · `feat/provider`
- [x] Interface `WhatsAppProvider`
- [x] `MockProvider` (loga, retorna id fake)
- [x] `TwilioProvider` com o SDK oficial
- [x] Factory por `WHATSAPP_PROVIDER`
- **Testar:** `npx tsx scripts/test-provider.ts` chama `sendText` no mock

### T1.2 — Webhook inbound · `feat/webhook-inbound`
- [x] `POST /webhooks/twilio/whatsapp`, form-urlencoded
      (`From`, `To`, `Body`, `MessageSid`)
- [x] Validação de assinatura via `twilio.webhook()`, desativável por env em dev
- [x] Normalizar número: tirar `whatsapp:`, guardar E.164 puro
- [x] Resolver tenant pelo `To` contra `whatsapp_numbers`. Não achou → 200,
      loga, nada mais
- [x] Dedupe por `wa_message_id`
- [x] Persistir inbound + atualizar `last_message_at`
- [x] **Sempre 200**, inclusive em erro interno
- **Testar:** curl 1 da seção final ✓

### T1.3 — Entry links e redirect · `feat/entry-links`
- [x] `GET /c/:slug` → 302 para `wa.me/<numero>?text=<prefill>`,
      incrementa `use_count`
- [x] Link inativo ou revogado → 404 com página simples de aviso
- [x] Geradores: slug (8 chars) e `entry_code` (4 chars A-Z2-9, sem 0/O/1/I)
- [x] `prefill_text` montado na criação: `"Olá! [CODE]"`
- [x] Relação N:N `entry_link_departments`. Bloquear criação com lista vazia
- **Testar:** `curl -i localhost:3001/c/<slug>` → 302 com `Location` correto;
  revogado → 404 ✓

### T1.4 — Controle de acesso · `feat/access-control`
Esta é a task mais importante do projeto. Implemente exatamente a tabela de
decisão de `PROJETO.md`.

- [x] Detectar `[XXXX]` na mensagem
- [x] Resolver `external_contact` por `(tenant_id, wa_number)`
- [x] Contato conhecido + link ativo → segue
- [x] Contato conhecido + link revogado → mensagem de acesso encerrado,
      encerra conversa aberta com `close_reason=access_revoked`
- [x] Contato bloqueado → **silêncio total**, sem resposta
- [x] Número novo + código válido + link `profile` → cria vínculo
- [x] Número novo + código válido + link `nominal` livre → cria vínculo
- [x] Número novo + código válido + link `nominal` **já usado** → recusa +
      `access_attempt(reason=nominal_taken)`
- [x] Número novo sem código ou código inválido → mensagem de acesso não
      identificado + `access_attempt`
- [x] Código de link de **outro tenant** → tratado como inválido
- **Testar:** curls 2 a 6 da seção final ✓

### T1.5 — Menu escopado pelo link · `feat/scoped-menu`
- [x] Menu montado **a partir de `entry_link_departments`**, por `sort_order`,
      só setores ativos
- [x] Lista com 1 setor → pula o menu, vai direto para `open`
- [x] Lista com 2+ → `awaiting_department` e mostra o menu
- [x] Escolha numérica validada **contra a lista do link**. Fora da lista =
      inválida, mesmo que o setor exista no tenant
- [x] Inválida → `menu_retries++`, reenvia; na 4ª, atribui ao primeiro da lista
- [x] Regra de conversa única: `awaiting_department|open|assigned|
      awaiting_menu_confirm` bloqueia nova; `awaiting_feedback` não bloqueia
- **Testar:** curl 7 — link "Médico Externo" não aceita Fisioterapia/Faturamento
  mesmo o setor existindo no hospital ✓

---

## DIA 2 — Roteamento e app do agente

### T2.1 — Auth interna · `feat/auth`
- [x] `POST /auth/login`, bcrypt + JWT (`userId`, `tenantId`, `role`)
- [x] Middleware `requireAuth` injetando `req.auth`
- [x] Middleware `requireRole('admin')`
- **Testar:** login do seed retorna token; rota protegida sem token → 401 ✓

### T2.2 — Roteamento round-robin · `feat/routing`
- [x] `tryAssign()`: agente do setor com `availability=available`,
      ordenado por quem foi atribuído há mais tempo
- [x] Sem agente → fica em `open`, sem erro
- [x] Grava `assigned_user_id` e `assigned_at`
- [x] Disparado ao definir o setor **e** quando um agente fica disponível
- **Testar:** duas conversas novas caem em agentes diferentes ✓

### T2.3 — API do agente · `feat/agent-api`
- [x] `GET /agent/conversations` — minhas + fila dos meus setores.
      Retorna `entry_link_label_snapshot` no payload
- [x] `GET /agent/conversations/:id/messages`
- [x] `POST /agent/conversations/:id/messages` → envia pelo provider,
      persiste outbound, atualiza `last_message_at`, grava `first_reply_at`
      se for a primeira do agente
- [x] `POST /agent/conversations/:id/close` → `closed_at`,
      `close_reason=agent_closed`, dispara CSAT
- [x] `PATCH /agent/availability`
- [x] **Todas** validam que a conversa é do `tenantId` do token
- [x] Teste cross-tenant: tenant A acessando conversa do B → 404 ✓
- **Testar:** ciclo completo via curl ✓

### T2.4 — UI do agente · `feat/agent-ui`
- [x] `/login`
- [x] `/conversas` — lista, status, polling 5s
- [x] `/conversas/[id]` — histórico, envio, botão Encerrar
- [x] **Rótulo do link em destaque no topo do chat** ("Médico Externo",
      "Dra. Ana Ribeiro")
- [x] Toggle Disponível/Ausente no header
- **Testar:** logar, ver a conversa do curl, responder, encerrar ✓

---

## DIA 3 — Ciclo de vida, admin e métricas

### T3.1 — MENU e timeout · `feat/lifecycle`
- [x] `MENU` em `assigned` (case-insensitive, sem acento, trim) →
      `awaiting_menu_confirm` + confirmação
- [x] `SIM` → encerra (`user_switched`), CSAT, mostra o menu **do link dele**
- [x] `NÃO` → volta para `assigned`, resposta visível ao agente
- [x] Inválida → repete uma vez; na segunda, assume `NÃO`
- [x] Link com 1 setor só → MENU responde que não há outro setor e mantém
- [x] Job a cada minuto: `last_message_at < now() - 30min` nos estados ativos
      → encerra (`timeout`) + CSAT
- [x] **O job itera por tenant explicitamente**
- **Testar:** "MENU" → "SIM" ✓; timeout forçado com
  `scripts/force-timeout.ts` (31 min atrás) → fechou com `timeout` ✓

### T3.2 — CSAT · `feat/csat`
- [x] Ao encerrar (qualquer `close_reason`, exceto `access_revoked` — contato
      revogado não consegue responder), se `tenant.csat_enabled`,
      envia a pergunta e seta `awaiting_feedback`
- [x] Número 0–10 → `feedback.score`
- [x] Texto livre após a nota, em até 10 min → `feedback.comment`
- [x] Qualquer outra mensagem → fecha sem nota e **abre conversa nova**
- [x] Sem insistência, sem lembrete
- **Testar:** encerrar via API, mandar "9" por curl, conferir na tabela ✓
  (score 9 + comentário gravados)

### T3.3 — Admin API · `feat/admin-api`
- [x] CRUD `departments` (com `sort_order`; DELETE desativa)
- [x] CRUD `users` + vínculo a departments
- [x] CRUD `entry_links` com seleção múltipla de setores; gera slug e código
- [x] `POST /admin/entry-links/:id/revoke` → `active=false`, `revoked_at`,
      `revoked_by_user_id`
- [x] `GET /admin/entry-links/:id/qrcode` → PNG (lib `qrcode`)
- [x] `GET /admin/entry-links/:id/contacts` → números vinculados
- [x] `GET /admin/contacts` + ações bloquear e reatribuir link
- [x] `GET /admin/access-attempts?from&to`
- [x] `GET /admin/metrics?from&to&department_id`: volume, FRT médio,
      resolução média, %SLA, CSAT médio, taxa de resposta CSAT, % abandono,
      **por link**, **por tipo de link**, **tentativas negadas por motivo**
- **Testar:** curl com token de admin retorna os números do seed ✓

### T3.4 — Admin UI · `feat/admin-ui`
- [x] `/admin/setores`
- [x] `/admin/agentes`
- [x] `/admin/links` — criar com checkboxes de setores, escolher perfil ou
      nominal, copiar URL, **baixar QR em PNG**, ver contatos vinculados,
      **revogar** com confirmação
- [x] `/admin/contatos` — lista, bloquear, reatribuir link
- [x] `/admin/acessos` — tentativas negadas, com destaque para `nominal_taken`
- [x] `/admin/dashboard` — filtro de período, cards, tabela por setor,
      tabela por link
- **Testar:** navegar e conferir contra a API ✓

---

## Aceite do MVP

- [x] Link "Médico Externo" → menu com Cardiologia, Enfermagem e Recepção —
      **e não** Fisioterapia
- [x] Link "Familiar leito 4B" (um setor) → **pula o menu**, cai na Enfermagem
- [x] Segundo número tentando usar link nominal já vinculado → recusado e
      visível em `/admin/acessos`
- [x] Número sem link nenhum → mensagem de acesso não identificado
- [x] Admin revoga um link → o contato vinculado recebe aviso na próxima
      mensagem e não consegue mais atendimento
- [x] Usuário digita MENU, confirma SIM, e troca de setor **dentro dos setores
      do link dele**
- [x] Conversa parada 30 min encerra sozinha
- [x] Admin cria setor, agente e link, baixa o QR, e vê as métricas
- [x] Nenhuma query no código sem `tenantId`
- [x] `main` só com merges de branch

---

## SPRINT 2 — Pedidos da reunião de 14/08

O ramal móvel do hospital some e o WhatsApp da pessoa toma o lugar dele. Isso
levanta o problema que dominou a reunião: **o médico não pode continuar
recebendo chamado do hospital depois que o plantão acaba.**

### T4.1 — Sessão que acaba com o plantão · `feat/plantao`
- [x] `shifts` (escala semanal em minutos, no fuso do tenant) e `shift_sessions`
      (o plantão acontecendo)
- [x] Login do atendente abre — ou reaproveita — a sessão de plantão; o JWT
      carrega `shiftSessionId` e expira junto com o turno
- [x] `requireAuth` recusa atendente sem plantão aberto: fim de plantão derruba
      o acesso **agora**, não quando o token vencer
- [x] Botão "Encerrar plantão" no app de quem atende
- [x] Quem sai devolve as conversas para a fila do ramal, que são reoferecidas a
      quem continua de plantão — o "um sai e o outro entra"
- [x] Job de 60s encerra plantão vencido sem depender de ninguém clicar
- [x] Roteamento só distribui para quem está de plantão
- [x] Admin edita a escala em `/admin/agentes` e vê quem está de plantão agora
- [x] Fora da escala, o login explica o motivo e diz quando é o próximo plantão
- **Testar:** `agente3@hospitalvida.test` (plantão 19:00–07:00) tentando entrar
      de dia → recusado com o horário do próximo plantão. Com `agente1` dentro
      do plantão, mandar uma mensagem pelo MEDX escolhendo Cardiologia, encerrar
      o plantão dele e conferir que a conversa volta para a fila:
  ```bash
  curl -X POST http://localhost:3001/agent/shift/end -H "Authorization: Bearer <TOKEN>"
  ```

### T4.2 — Transferir atendimento entre ramais · `feat/transferencia`
- [x] A Recepção passa a conversa do externo para a Cardiologia com o histórico
      junto; a transferência vira mensagem `sender_type=system` e o externo é
      avisado do setor novo
- [x] A conversa continua sendo **uma só** — separar quebraria as métricas
- [x] Os destinos oferecidos são **os setores do link da pessoa**, nunca os do
      hospital: encaminhar para fora disso deixaria o MENU dela mostrando outra
      coisa. Setor fora do link responde 404, como acontece entre tenants
- [x] Sai da mão de quem transferiu e volta para a fila do setor novo, onde é
      oferecida a quem está de plantão lá
- **Testar:** abrir uma conversa em `/conversas/<id>` e usar **Encaminhar**. Pela
      API:
  ```bash
  curl localhost:3001/agent/conversations/<ID>/transfer-targets -H "Authorization: Bearer <TOKEN>"
  curl -X POST localhost:3001/agent/conversations/<ID>/transfer     -H "Authorization: Bearer <TOKEN>" -H 'Content-Type: application/json'     -d '{"departmentId":"<ID_DO_SETOR>"}'
  ```

### T4.3 — Contato entre ramais · `feat/ramal-interno`
- [x] Conversa interna entre dois setores, sem externo envolvido, com `internal_threads`
      e `internal_messages`
- [x] Quem enxerga é quem está no setor de **origem ou destino** — o assunto é do
      ramal, não da pessoa: quem entra no plantão continua de onde pararam
- [x] A mensagem guarda de que **lado** veio, e não quem escreveu: a colega do
      mesmo setor lê a conversa do mesmo jeito
- [x] Telas `/ramais` e `/ramais/[id]` no app de quem atende
- [x] Navegação inferior no celular (Atendimento · Ramais), abas no desktop —
      base do que vira a tab bar do aplicativo
- **Testar:** entrar como `agente2@hospitalvida.test`, abrir **Ramais** →
      **Chamar outro setor** → Faturamento. Entrar como quem atende o Faturamento
      e conferir que a conversa aparece do outro lado.

## Sprint 3 — decisões da reunião de 21/08

Tudo aqui saiu de decisão do cliente, registrada. Ordem por dependência: a
escala por setor é fundação da contagem por setor, que é fundação do
supervisor, que é fundação do escalonamento.

- [x] **T5.1 escala por setor** — `shifts` ganha `department_id`; a escala passa
      a dizer ONDE a pessoa atende naquele turno, não só quando. Editor do
      painel com uma aba por setor.
- [ ] **T5.2 plantão por setor, limite de 3 e cobertura** — quem está de plantão
      passa a estar de plantão EM setores; máximo 3 atendentes por setor;
      consulta de setor descoberto.
- [ ] **T5.3 papéis de supervisor** — `supervisor_setor` e `supervisor_hospital`.
      O supervisor de setor é a 4ª pessoa: não conta no limite de 3.
- [ ] **T5.4 oferta ao setor e escalonamento** — 0 min atendente da vez, 3 min
      oferta aos 3 do setor (quem responder primeiro fica), 6 min supervisor do
      setor, 9 min supervisor do hospital.
- [ ] **T5.5 áudio e imagem** — recebe os dois; áudio entregue com transcrição
      (OpenAI); mídia NÃO é copiada para servidor nosso e é apagada no
      encerramento, com o histórico registrando que existiu.
- [ ] **T5.6 nome no primeiro acesso** — nome completo pedido antes do menu;
      contato identificado por nome + telefone. Link nominal não pergunta.
- [ ] **T5.7 log de agilidade** — quem chamou, quem atendeu e quem NÃO atendeu.
      Só passa a existir depois da T5.4: hoje não há registro de oferta.
- [ ] **T5.8 telas de supervisor** — aviso "setor X sem atendente" nas telas dos
      supervisores do setor e do hospital.
- [ ] **T5.9 um número de WhatsApp por hospital** — trava no banco.
- [ ] **T5.10 realtime no lugar do polling** — pendência antiga, 6 telas.

### Decidido na reunião, para não reabrir
- Um número de WhatsApp por hospital.
- Nunca fica setor vazio: mínimo 1 atendente logado por setor. Ninguém é
  impedido de sair — o vazio vira aviso na tela dos supervisores.
- Limite de 3 por setor; o supervisor do setor é uma 4ª pessoa.
- Escalonamento 0/3/6/9 minutos, nesta ordem: atendente → os 3 do setor →
  supervisor do setor → supervisor do hospital.
- Imagem: recebe mas não guarda (opção 2). O atendente vê durante o
  atendimento; apagada no encerramento; o histórico registra que houve.
- Nome completo pedido no primeiro acesso. **Isto revoga a regra 7 do
  CLAUDE.md** (zero fricção) — atualizar a regra junto com a T5.6.

### Ainda sem decisão
- Ligação (voz ao vivo) — o Marcelo pediu "depois".
- Provedor: Twilio ou Evolution. A escolha decide onde a transcrição roda.

---

## Comandos de teste

Substitua os códigos pelos que o seed imprimir.

**1 · Inbound de número desconhecido, sem código — acesso não identificado**
```bash
curl -X POST http://localhost:3001/webhooks/twilio/whatsapp \
  -d 'From=whatsapp:+5521900000001' -d 'To=whatsapp:+14155238886' \
  -d 'Body=Oi' -d 'MessageSid=SM'$RANDOM
```

**2 · Link de perfil, primeiro uso — cria vínculo e mostra menu de 3 setores**
```bash
curl -X POST http://localhost:3001/webhooks/twilio/whatsapp \
  -d 'From=whatsapp:+5521900000002' -d 'To=whatsapp:+14155238886' \
  --data-urlencode 'Body=Olá! [MEDX]' -d 'MessageSid=SM'$RANDOM
```

**3 · Mesmo número, mensagem seguinte SEM código — deve reconhecer o vínculo**
```bash
curl -X POST http://localhost:3001/webhooks/twilio/whatsapp \
  -d 'From=whatsapp:+5521900000002' -d 'To=whatsapp:+14155238886' \
  -d 'Body=1' -d 'MessageSid=SM'$RANDOM
```

**4 · Link nominal, primeiro uso — vincula**
```bash
curl -X POST http://localhost:3001/webhooks/twilio/whatsapp \
  -d 'From=whatsapp:+5521900000003' -d 'To=whatsapp:+14155238886' \
  --data-urlencode 'Body=Olá! [ANAR]' -d 'MessageSid=SM'$RANDOM
```

**5 · Link nominal, SEGUNDO número — deve recusar e registrar tentativa**
```bash
curl -X POST http://localhost:3001/webhooks/twilio/whatsapp \
  -d 'From=whatsapp:+5521900000004' -d 'To=whatsapp:+14155238886' \
  --data-urlencode 'Body=Olá! [ANAR]' -d 'MessageSid=SM'$RANDOM
```

**6 · Link de um setor só — deve pular o menu**
```bash
curl -X POST http://localhost:3001/webhooks/twilio/whatsapp \
  -d 'From=whatsapp:+5521900000005' -d 'To=whatsapp:+14155238886' \
  --data-urlencode 'Body=Olá! [F4BX]' -d 'MessageSid=SM'$RANDOM
```

**7 · Escolha de setor fora do escopo do link — deve recusar**

Com o número do teste 2 (link de 3 setores), enviar o número de uma opção que
não está no menu dele. Esperado: tratado como inválido, menu reenviado.

**8 · Login**
```bash
curl -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"agente1@hospitalvida.test","password":"123456"}'
```

**9 · Responder como agente**
```bash
curl -X POST http://localhost:3001/agent/conversations/<ID>/messages \
  -H "Authorization: Bearer <TOKEN>" -H 'Content-Type: application/json' \
  -d '{"body":"Bom dia, doutora. Em que posso ajudar?"}'
```

> Nota: nos curls com `Olá! [CODE]` use `--data-urlencode` (o `+` de um `-d`
> comum vira espaço no form-urlencoded — o webhook tolera isso no número,
> repondo o `+` na normalização).
