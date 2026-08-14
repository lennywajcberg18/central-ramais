# Central de Ramais com Acesso Controlado

Central de ramais via WhatsApp onde o hospital controla quem de fora pode
falar com quais setores. Ver `PROJETO.md` para a especificação completa.

## Como rodar em 5 comandos

```bash
cp .env.example apps/api/.env   # 1. configura o ambiente
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

Migrations rodam no start (`prisma migrate deploy`) e o seed só é executado se
o banco estiver vazio (`scripts/seed-if-empty.ts`) — restart não apaga dados.

Limites do plano free: os serviços hibernam após 15 minutos sem acesso (a
primeira visita depois disso leva ~50s) e o Postgres gratuito expira em 30
dias. É ambiente de demonstração, não de produção.

## Estrutura

```
apps/api        Express + TypeScript + Prisma (porta 3001)
apps/web        Next.js App Router + Tailwind (porta 3000)
packages/shared Tipos compartilhados (status, roles, DTOs)
```
