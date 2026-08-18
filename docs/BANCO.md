# O banco

O Postgres da aplicação é um projeto Supabase chamado `central-ramais`, região
São Paulo (`sa-east-1`). O Postgres do `render.yaml` não é mais usado.

## Por que duas connection strings

O `schema.prisma` declara `url` e `directUrl`. As duas apontam para o **mesmo
banco**; o que muda é o caminho.

| variável | porta | modo | quem usa |
|---|---|---|---|
| `DATABASE_URL` | 6543 | transação | a API em execução |
| `DIRECT_URL` | 5432 | sessão | `prisma migrate deploy` |

O **modo transação** devolve a conexão ao pool a cada commit. É o que permite
centenas de clientes sobre poucas conexões reais, e é obrigatório em serverless,
onde cada requisição pode ser um processo novo. O preço é não haver estado entre
um comando e o seguinte — daí o `?pgbouncer=true`, que desliga os prepared
statements do Prisma. Sem ele a API prepara um statement numa conexão e tenta
reusá-lo em outra, e o erro (`prepared statement "s0" already exists`) aparece
de forma intermitente e só sob carga, que é o pior formato possível de bug.

O **modo sessão** segura a mesma conexão do início ao fim. Migration precisa
disso: `CREATE INDEX` e `ALTER TABLE` não sobrevivem a trocar de conexão no meio.

A terceira opção seria a **conexão direta** (`db.<ref>.supabase.co:5432`), que
seria a escolha natural para as migrations. Ela não serve aqui por um motivo que
não tem contorno no código:

```
$ nslookup db.<ref>.supabase.co
Address: 2600:1f1e:c3:2701:...        <- só IPv6, nenhum registro A
```

(O `<ref>` do projeto sai do painel do Supabase. Ele não é credencial, mas este
repositório é público e a porta do banco está aberta na internet — não há motivo
para publicar o endereço exato.)

Sem o add-on de IPv4, o host direto só existe em IPv6. Render e Vercel rodam em
rede IPv4. De lá, esse endereço simplesmente não resolve. Por isso as duas
variáveis ficam no pooler, em modos diferentes.

## O que o boot recusa, e por quê

`apps/api/src/config.ts` barra três configurações no arranque. Todas as três são
erros que **não dariam erro** — o motivo de estarem lá.

1. **`DIRECT_URL` ausente.** O runtime não usa essa variável; quem a lê é o
   `prisma migrate`. Ela é exigida mesmo assim por causa do item 3.
2. **Porta 6543 sem `?pgbouncer=true`.** A string que o painel do Supabase
   entrega para copiar não traz o parâmetro, então esquecê-lo é o caminho
   provável, não o descuidado. O sintoma seria
   `prepared statement "s0" already exists`, só sob carga.
3. **`DATABASE_URL` e `DIRECT_URL` em servidores diferentes.** Este é o guarda
   que importa. No Render, trocar `fromDatabase` por `sync: false` **não apaga**
   o valor que o serviço já guardava: quem preenche só `DIRECT_URL` fica com as
   migrations no banco novo e a aplicação no antigo, as duas coisas funcionando,
   os dados se dividindo em dois. Sem esse guarda, a descoberta vem meses depois.
   O escape é `ALLOW_SPLIT_DB_HOSTS=true`, para o caso legítimo de usar a
   conexão direta por IPv6 só nas migrations.

## Quanto custa a distância

Medido daqui (Brasil) contra o projeto em São Paulo:

```
SELECT 1                     ~112ms
tryAssign, 1 conversa         143ms
tryAssign, 10 concorrentes    894ms   (~85ms por conversa enfileirada)
```

As conversas do mesmo setor esperam em fila na trava do rodízio, então o pior
caso cresce linear. Nesse ritmo, o timeout padrão do Prisma (5s) estouraria por
volta de **55 conversas simultâneas no mesmo setor**; de uma região distante,
metade disso. `LIMITES_DE_TRANSACAO` em `src/prisma.ts` deixa os limites
explícitos em vez de herdar um padrão escolhido para banco co-localizado.

**A distância é um problema em aberto.** O `render.yaml` não declara região, e o
padrão do Render é Oregon — cada query da API atravessaria o continente para
chegar a São Paulo. O Render free não oferece região no Brasil. A saída é a
Vercel com função em `gru1`, que é o passo seguinte do plano; até lá, a
demonstração funciona mas paga esse pedágio em toda requisição.

## As travas do rodízio sobrevivem ao pooler

A documentação do Supabase diz que o modo transação "não suporta advisory
locks". Isso vale para os de **sessão** (`pg_advisory_lock`), que continuam
valendo depois do commit numa conexão que já voltou ao pool. Os nossos são
`pg_advisory_xact_lock` (`src/repositories/locks.ts`), liberados no commit — o
pooler mantém a conexão presa durante toda a transação, então a trava vale.

Isso não foi assumido, foi medido. `scripts/check-rodizio-multiprocesso.ts`
sobe dois processos Node de verdade atribuindo conversas no mesmo setor:

| | Postgres local | Supabase (pooler) |
|---|---|---|
| com a trava | 0 de 6 rodadas com problema | **0 de 6** |
| sem a trava | 3 de 6 | **6 de 6** |

O controle é a parte que importa. Pela rede o bug **piora**: a latência alarga a
janela entre ler "quem foi atendido por último" e gravar a atribuição, e as duas
conversas caem na mesma pessoa em todas as rodadas, não em metade. Quem for
mexer no `tryAssign` roda os dois lados disto antes de acreditar em si mesmo.

## Rodar migration contra o Supabase

As credenciais ficam em `apps/api/.env.supabase`, que **não é versionado**
(`.env.*` está no `.gitignore`, e o repositório é público).

```bash
cd apps/api
set -a && . ./.env.supabase && set +a
npx prisma migrate deploy
```

O `apps/api/.env` continua apontando para o Postgres do `docker-compose`, e isso
é de propósito: com desenvolvimento e demonstração no mesmo banco, um
`prisma migrate reset` local apaga o que está no ar.

Para rodar as suítes de concorrência contra o Supabase, mesmo preâmbulo:

```bash
npx tsx scripts/check-rodizio-multiprocesso.ts
npx tsx scripts/check-corridas.ts
npx tsx scripts/check-distribuicao-concorrente.ts
```

## Duas armadilhas do plano free

1. **O projeto pausa após 7 dias sem atividade.** Um projeto pausado não aceita
   conexão, e a API responde 503 no `/health`. Para uma demonstração que alguém
   pode abrir semanas depois, isto é o mesmo problema do banco do Render que
   expirava — só com outro relógio. Despausar é um clique no painel, mas alguém
   precisa saber que é isso.
2. **O free permite 2 projetos ativos por organização.** Hoje são
   `central-ramais` e `ner-conquistas`; `alfred-db` está pausado e por isso não
   conta. Despausar o Alfred exige pausar outro ou assinar o Pro.

## A senha do banco

Gerada na criação do projeto, 32 caracteres alfanuméricos (sem símbolos, que
quebrariam a connection string sem escape). Vive em `apps/api/.env.supabase` e
no painel do Render — em lugar nenhum versionado.

Para rodar: *Project Settings → Database → Reset database password* no painel do
Supabase, e atualizar as duas variáveis nos dois lugares. Rotacione se ela
aparecer em log, print ou mensagem.
