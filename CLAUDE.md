# Regras do repositório

Valem para todo mundo que escreve código aqui — humano ou IA.

Entregue o MVP descrito em `PROJETO.md`, executando `TASKS.md` **em ordem**.

---

## Git — obrigatório

- **Nunca commite em `main`.** Nem um typo. Nem README.
- Uma branch por task: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`.
  O slug sai do nome da task: T1.4 → `feat/access-control`.
- **Uma task por PR.** PR que faz duas coisas volta sem review.
- Trabalho paralelo com worktrees:
  ```bash
  git worktree add ../wc-access-control -b feat/access-control
  ```
- Merge em `main` só após: build passando + teste manual documentado + review.
- Commits pequenos, imperativo, em português:
  `feat: vincula número ao entry link no primeiro uso`
- Marque o checkbox da task no `TASKS.md` **no mesmo PR**.

---

## A regra que não se negocia

> **Nenhuma query chega ao banco sem `tenant_id` no filtro.**

Sem exceção. Nem em debug, nem em seed, nem em migração, nem "só neste caso
porque o ID é UUID".

```ts
// ERRADO — IDOR
await prisma.conversation.findUnique({ where: { id } });

// CERTO
await prisma.conversation.findFirst({ where: { id, tenantId } });
```

Update e delete: `updateMany` / `deleteMany` com `tenantId`, checando o
`count`. Zero → retorne **404**, nunca 403 (que já confirma a existência).

O `tenantId` vem **sempre** de `req.auth.tenantId` (JWT assinado). Nunca de
body, query, params ou header.

Instale a skill `multi-tenant-guard` no Claude Code. Vou cobrar em PR.

---

## A terceira regra: nada do `public` sai pela API do Supabase

O Supabase publica o schema `public` numa API REST que aceita a chave anônima —
pública por desenho. E ele concede acesso a `anon` em **toda tabela nova criada
pelo `postgres`**, que é o papel que roda as migrations.

Migration que cria tabela em `public` liga RLS nela, na mesma migration:

```sql
ALTER TABLE "minha_tabela" ENABLE ROW LEVEL SECURITY;
```

Sem policy é o certo: esta aplicação não usa a API REST do Supabase, e RLS sem
policy nega tudo para quem não tem `rolbypassrls`. O Prisma entra como
`postgres`, que tem, e não sente nada. Nunca use `FORCE ROW LEVEL SECURITY`.

Antes de dar deploy num banco Supabase novo, confira que fechou:

```bash
curl -s -o /dev/null -w "%{http_code}
"   "https://<ref>.supabase.co/rest/v1/users?select=*" -H "apikey: <anon>"
# 401 = fechado. 200 = o banco inteiro está na internet.
```

Ver `docs/BANCO.md` para o que já vazava antes de isto existir.

## A segunda regra: o link é a credencial

Este produto tem **dois níveis de autorização**, não um. Não confunda:

1. **Tenant** — isolamento entre hospitais. Vale para o app interno.
2. **Entry link** — quais setores um externo específico pode acessar.

```ts
// ERRADO — monta o menu com todos os setores do hospital
const depts = await listDepartments(tenantId);

// CERTO — monta com os setores que o link permite
const depts = await listDepartmentsForLink(tenantId, entryLinkId);
```

**Toda vez que o sistema mostra ou aceita um setor para um externo**, a lista
tem que vir do link dele. Menu inicial, resposta ao MENU, validação da escolha
numérica — nos três.

Um externo escolher "3" e cair num setor que o link dele não permite é uma
falha de autorização, não um bug de UX.

---

## Regras de produto

1. **Simplicidade acima de tudo.** Nenhuma abstração sem dois usos hoje.
2. **Nunca invente API de provedor.** Tudo passa por `WhatsAppProvider`.
   O SDK da Twilio só existe em `providers/twilio.ts`.
3. **Persista tudo.** Toda mensagem inbound e outbound vai para `messages`,
   inclusive as automáticas (`sender_type=system`).
4. **Timestamps são o produto.** `assigned_at`, `first_reply_at`, `closed_at`
   e `last_message_at` corretos — as métricas dependem só disso.
   `first_reply_at` é **write-once**, só na primeira mensagem
   `sender_type=agent`.
5. **Idempotência no webhook.** O Twilio reentrega. `wa_message_id` é UNIQUE;
   duplicata é ignorada em silêncio, com 200.
6. **O webhook sempre responde 200.** Mesmo em erro interno. 500 faz o Twilio
   reentregar em loop.
7. **Zero fricção para o externo.** Sem cadastro, nome, e-mail ou confirmação.
   O link é a credencial e basta.
8. **Nunca dependa só do código do link.** Depois do primeiro uso, o vínculo
   `external_contact → entry_link` é a fonte de verdade. O código serve para
   criar o vínculo, não para sustentá-lo.
9. **Toda recusa de acesso vira `access_attempt`.** Silenciar é perder o sinal
   de que um link nominal vazou.

---

## Camadas

```
routes/         parse, chama service, responde. Não fala com Prisma.
services/       regra de negócio. Não conhece HTTP.
repositories/   banco. tenantId é SEMPRE o 1º parâmetro.
providers/      WhatsAppProvider
jobs/           timeout de inatividade
middleware/     auth, error handler
config.ts       env validado no boot
```

Precisa quebrar isso? Fale antes. Provavelmente o problema é outro.

---

## Estilo

- TypeScript `strict: true`. Sem `any` sem comentário justificando.
- Erros de negócio como exceções tipadas, handler único.
- Env só em `config.ts`, validado no boot (falha rápido).
- Comente o "por quê", nunca o "o quê".

---

## Como trabalhar

- Antes de começar, **liste os arquivos** que vai criar/alterar. Mais de 10 →
  espere ok.
- Depois de cada task, diga **como testar** e qual é a próxima.
- Ambiguidade em `PROJETO.md` → pergunte. **Máximo 3 perguntas por vez**, só
  as que bloqueiam, com sua suposição junto.
- Não pule tasks. Não implemente coisas de sprints futuros.

---

## Definition of done

- [ ] `npm run build` passa nos dois apps
- [ ] Testado manualmente, comando documentado no PR
- [ ] Toda query nova filtra por `tenantId`
- [ ] Se a task toca em menu ou escolha de setor: a lista vem do link
- [ ] Teste cross-tenant se a task adicionou endpoint com ID
- [ ] `TASKS.md` atualizado
- [ ] Branch mergeada em `main`.
