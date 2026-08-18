# Deploy

Dois projetos na Vercel, um banco no Supabase, os dois em São Paulo. O banco está
documentado em `docs/BANCO.md`; aqui está o resto.

## Por que dois projetos e não um

`apps/web` é Next.js e vai para a Vercel sem adaptação. `apps/api` é Express e
vira **uma única função**: o `apps/api/vercel.json` reescreve toda rota para
`api/index.ts`, que exporta o app do Express. O roteamento continua sendo do
Express, igual em qualquer outro ambiente.

Fundir a API dentro do Next como route handlers removeria um hop de rede e um
deploy. Não vale hoje: seriam quinze arquivos de rota reescritos, com o
middleware de assinatura do Twilio, o handler único de erro e o CORS refeitos em
outra plumbing — e tudo o que a auditoria e as suítes de concorrência já cobrem
teria de ser revalidado por cima de código novo. O ganho é latência interna; o
custo é revalidar o que já está provado.

## Região: `gru1`, nos dois

```json
{ "regions": ["gru1"] }
```

Não é detalhe de performance, é o que torna o arranjo viável. O padrão da Vercel
é `iad1` (Washington), e com o banco em São Paulo cada query atravessaria o
continente — a medição em `docs/BANCO.md` mostra o rodízio custando ~85ms por
conversa enfileirada já com latência baixa. O plano Hobby permite **uma** região,
que é exatamente quanto é preciso.

## Variáveis

No projeto da **API**:

| variável | de onde vem |
|---|---|
| `DATABASE_URL` | pooler do Supabase, porta 6543, com `?pgbouncer=true` |
| `DIRECT_URL` | pooler do Supabase, porta 5432 |
| `JWT_SECRET` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -base64 36` |
| `PUBLIC_BASE_URL` | a URL do próprio projeto da API |
| `WEB_ORIGIN` | a URL do projeto web (CORS) |

Em serverless, troque `connection_limit=5` por **`connection_limit=1`** na
`DATABASE_URL`: cada instância da função tem o seu próprio pool, e 5 por
instância multiplica pelo número de instâncias vivas até estourar o limite do
projeto.

No projeto **web**: `NEXT_PUBLIC_API_URL` com a URL da API.

O boot recusa combinações incoerentes de propósito — ver "O que o boot recusa" em
`docs/BANCO.md`.

## O agendador: `pg_cron`, não o cron da Vercel

As varreduras de inatividade e de fim de plantão precisam rodar **de minuto em
minuto**. O cron da Vercel no plano Hobby roda **uma vez por dia**, e não
degrada: uma expressão mais frequente faz o deploy **falhar**.

O agendamento fica no Supabase, com `pg_cron` chamando os endpoints por `pg_net`.
Sai de graça, tem granularidade de minuto, e põe o relógio ao lado dos dados.

As extensões já estão habilitadas neste projeto. Com a URL da API em mãos, rode
isto uma vez no SQL Editor, trocando os dois valores:

```sql
select cron.schedule('varredura-inatividade', '* * * * *', $$
  select net.http_post(
    url := 'https://SUA-API.vercel.app/jobs/timeout',
    headers := '{"Content-Type":"application/json","x-cron-secret":"O-CRON_SECRET"}'::jsonb
  );
$$);

select cron.schedule('varredura-plantao', '* * * * *', $$
  select net.http_post(
    url := 'https://SUA-API.vercel.app/jobs/shift',
    headers := '{"Content-Type":"application/json","x-cron-secret":"O-CRON_SECRET"}'::jsonb
  );
$$);
```

Conferir depois:

```sql
select jobid, jobname, schedule, active from cron.job;
select jobid, status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 10;
```

O segredo fica na tabela `cron.job`, legível só pelo `postgres` — nunca no
repositório. Para trocá-lo, `cron.unschedule('varredura-inatividade')` e agende
de novo.

### O endpoint responde 200 mesmo quando falha

De propósito, pelo mesmo motivo do webhook do Twilio: agendador que recebe 500
costuma repetir, e repetir uma varredura que falhou porque o banco está
indisponível só empilha carga sobre um banco que já está mal. O erro vai para o
log e a execução do minuto seguinte tenta de novo.

Sem o segredo correto, o endpoint responde **404**, não 401 — 401 confirmaria que
ele existe e convidaria a insistir.

## O que sumiu ao sair do processo persistente

Os dois jobs tinham uma trava `running` em memória impedindo varreduras de se
sobreporem. Ela vale dentro de um processo, e em serverless a invocação seguinte
pode ser outra máquina. A trava saiu.

Isso não afrouxa nada, porque não era ela que garantia a correção:

- **encerramento em dobro** — impedido pelo compare-and-swap do `closeWithCsat`.
  É o cenário 1 do `check-corridas`, seis rodadas com duas varreduras concorrentes.
- **plantão encerrado duas vezes** — impedido pelo `endsAt <= at` no WHERE do
  `closeExpiredSession`, checado pelo `count`. É o cenário 10.

Mesmo raciocínio da fila de mensagens removida no passo anterior: garantia que
depende de haver um processo só não é garantia, é sorte com prazo.

## Ordem de deploy

1. Projeto da **API**: Root Directory `apps/api`, framework *Other*, e ligue
   *Include files outside of the Root Directory* (é um monorepo npm workspaces).
2. Variáveis da tabela acima. Deploy.
3. Confira que o boot passou: `GET /health` deve responder `{"ok":true,"db":"up"}`.
4. Projeto **web**: Root Directory `apps/web`, framework Next.js,
   `NEXT_PUBLIC_API_URL` apontando para a API. Deploy.
5. Volte na API e ajuste `WEB_ORIGIN` para a URL do web. Redeploy — sem isso o
   CORS barra o front inteiro e o sintoma é "clico em Entrar e não acontece nada".
6. Agende os dois `cron.schedule` acima.
7. Confira que a API **não** está publicada onde não deve:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://SUA-API.vercel.app/jobs/timeout
   # 404 = protegido
   ```
