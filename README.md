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

## Deploy

Dois projetos na [Vercel](https://vercel.com) e um banco no
[Supabase](https://supabase.com), os três em São Paulo.

| | |
|---|---|
| API | https://central-ramais-api.vercel.app |
| Painel | https://central-ramais-web.vercel.app |
| Banco | projeto Supabase `central-ramais`, região São Paulo |

Push em `main` publica os dois. O passo a passo — variáveis, ordem de deploy e o
agendamento das varreduras — está em `docs/DEPLOY.md`; o banco, em
`docs/BANCO.md`.

As varreduras de inatividade e de fim de plantão **não** rodam no cron da Vercel:
no plano Hobby ele executa uma vez por dia, e uma expressão mais frequente faz o
deploy falhar. Quem marca a hora é o `pg_cron` do próprio Supabase, chamando a
API de minuto em minuto (`npm run cron:agendar -w api`).

Limites do plano gratuito, que valem como alarme e não como rodapé: o projeto do
Supabase **pausa após 7 dias sem atividade** — pausado, ele recusa conexão e o
`/health` responde 503. Uma demonstração que alguém abre duas semanas depois
encontra isso. É ambiente de demonstração, não de produção.

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
