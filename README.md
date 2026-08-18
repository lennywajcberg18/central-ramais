# Central de Ramais com Acesso Controlado

Central de ramais via WhatsApp onde o hospital controla quem de fora pode
falar com quais setores. Ver `PROJETO.md` para a especificação completa.

## Como rodar em 5 comandos

```bash
# 1. configura o ambiente e gera o segredo do JWT (o .env.example vem sem ele
#    de propósito: este repositório é público)
cp .env.example apps/api/.env && echo "JWT_SECRET=$(openssl rand -base64 32)" >> apps/api/.env
docker compose up -d            # 2. sobe o Postgres
npm install                     # 3. instala dependências
npm run migrate -w api && npm run seed -w api   # 4. migra e popula o banco
npm run dev                     # 5. api:3001  web:3000
```

O seed imprime as credenciais dos usuários e os códigos dos entry links.
O provider padrão em dev é o `MockProvider` — nada sai de verdade.

## Deploy de demonstração

`render.yaml` é um blueprint do [Render](https://render.com): sobe API e web em
dois serviços do plano free, a partir deste repositório. No painel do Render,
*New → Blueprint* apontando para o repo faz o resto.

O banco não vem junto: é um projeto [Supabase](https://supabase.com) em São
Paulo, e as duas variáveis que apontam para ele (`DATABASE_URL` e `DIRECT_URL`)
entram na mão no painel, porque carregam a senha e este repositório é público.
Por que são duas, e por que nenhuma delas é a conexão direta, está em
`docs/BANCO.md`.

Duas armadilhas para quem clonar o blueprint. O bloco `databases:` do
`render.yaml` ainda provisiona um Postgres que **ninguém consome** — ele existe
só como rede desta migração e pode ser removido; a API não sobe sem um projeto
Supabase à parte. E, num serviço que já existia, trocar `fromDatabase` por
`sync: false` não apaga o valor que o Render já guardava: se você preencher só
uma das duas variáveis, as migrations vão para um banco e a aplicação para outro.
O boot recusa essa combinação de propósito (`apps/api/src/config.ts`), porque ela
não dá erro em lugar nenhum.

Migrations rodam no start (`prisma migrate deploy`) e o seed só é executado com
`ALLOW_DEMO_SEED=true` **e** o banco vazio (`scripts/seed-if-empty.ts`) — restart
não apaga dados. Quem clonar este blueprint para uso real deve deixar a variável
de fora: ela é o que impede o banco novo de nascer com os usuários de
demonstração e suas senhas fracas.

Limites do plano free, que valem como alarme e não como nota de rodapé: os
serviços do Render hibernam após 15 minutos sem acesso (a primeira visita depois
disso leva ~50s) e o projeto do Supabase **pausa após 7 dias sem atividade** —
pausado, ele recusa conexão e o `/health` responde 503. Uma demonstração que
alguém abre duas semanas depois encontra isso. É ambiente de demonstração, não
de produção.

## Estrutura

```
apps/api        Express + TypeScript + Prisma (porta 3001)
apps/web        Next.js App Router + Tailwind (porta 3000)
packages/shared Tipos compartilhados (status, roles, DTOs)
```

## Documentação

- `PROJETO.md` — a especificação: o que o produto faz e as regras de negócio.
- `CLAUDE.md` — as regras do repositório, válidas para humano ou IA.
- `TASKS.md` — as tasks do MVP, com o comando de teste manual de cada uma.
- `docs/BANCO.md` — o banco: as duas connection strings, por que a conexão
  direta não serve, e a medição que prova que as travas do rodízio atravessam
  o pooler.
- `docs/auditoria/` — a auditoria de 17/08/2026:

| arquivo | para quê |
|---|---|
| `RELATORIO.md` | o que foi auditado, o que se achou, o que se corrigiu e o que sobrou |
| `THREAT-MODEL.md` | as ameaças modeladas para este produto, e o que protege cada uma |
| `MATRIZ-DE-CENARIOS.md` | os cenários por jornada e a suíte de testes que falta |
| `ROADMAP.md` | o produto priorizado, com os próximos 30 dias |
| `SEGURANCA-OPERACIONAL.md` | o guia de quem opera: variáveis, rotação de segredo, incidentes |
| `MUDANCAS.md` | o que mudou no código e quais invariantes não podem ser desfeitos |
| `PENDENCIAS.md` | o que ficou para depois, separado por quem decide |

Antes de levar isto para um hospital de verdade, leia `PENDENCIAS.md` — o bloco
"fazer antes de um hospital real usar" existe para essa pergunta.
