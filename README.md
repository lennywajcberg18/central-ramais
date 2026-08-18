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

`render.yaml` é um blueprint do [Render](https://render.com): sobe Postgres,
API e web em três serviços do plano free, a partir deste repositório. No painel
do Render, *New → Blueprint* apontando para o repo faz o resto.

Migrations rodam no start (`prisma migrate deploy`) e o seed só é executado com
`ALLOW_DEMO_SEED=true` **e** o banco vazio (`scripts/seed-if-empty.ts`) — restart
não apaga dados. Quem clonar este blueprint para uso real deve deixar a variável
de fora: ela é o que impede o banco novo de nascer com os usuários de
demonstração e suas senhas fracas.

Limites do plano free: os serviços hibernam após 15 minutos sem acesso (a
primeira visita depois disso leva ~50s) e o Postgres gratuito expira em 30
dias. É ambiente de demonstração, não de produção.

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
