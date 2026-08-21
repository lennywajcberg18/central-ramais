-- O plantão passa a saber EM QUAIS SETORES está de pé.
--
-- A escala já diz onde a pessoa atende (20260821120000), mas o plantão em curso
-- não: `availableAgentsForDepartment` casa QUALQUER sessão aberta com QUALQUER
-- setor da pessoa. Quem cobre CT e Recepção entra de plantão e recebe dos dois
-- ao mesmo tempo, mesmo que a escala só a coloque num deles hoje. E não há como
-- responder "quantos estão de plantão no CT agora" — a pergunta de que dependem
-- o limite de plantonistas por setor e o aviso de setor descoberto.
--
-- O plantão continua sendo UM por pessoa: é o que o token carrega, o que o botão
-- "meu plantão acabou" encerra e o que o índice de login duplo protege. O que
-- nasce aqui é a lista de setores desse plantão, cada um com a sua hora de sair.
--
-- Por que a hora é por setor e não uma só: `minutesLeftInShift` funde faixas que
-- se encostam, de propósito — sem isso a escala 00:00–24:00 desloga a pessoa
-- toda meia-noite. Entre setores diferentes essa fusão é errada: quem faz CT das
-- 7h às 13h e Recepção das 13h às 19h apareceria de plantão no CT até as 19h.

CREATE TABLE "shift_session_departments" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "shift_session_id" TEXT NOT NULL,
  "department_id"    TEXT NOT NULL,
  "ends_at"          TIMESTAMP(3) NOT NULL,
  "ended_at"         TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shift_session_departments_pkey" PRIMARY KEY ("id")
);

-- Tabela nova em `public` nasce publicada na API REST do Supabase, porque o
-- `postgres` que roda as migrations concede acesso a `anon` por padrão. Sem esta
-- linha, quem está de plantão em qual setor fica legível com a chave anônima.
-- Sem policy é o certo: esta aplicação não usa a API REST do Supabase, e RLS sem
-- policy nega tudo a quem não tem `rolbypassrls` — o Prisma entra como
-- `postgres`, que tem, e não sente nada. Nunca FORCE. Ver docs/BANCO.md.
ALTER TABLE "shift_session_departments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "shift_session_departments"
  ADD CONSTRAINT "shift_session_departments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE aqui e RESTRICT nos outros dois de propósito: a cobertura não existe
-- sem o plantão dela, mas apagar um setor ou um hospital que ainda tem gente de
-- plantão tem que doer.
ALTER TABLE "shift_session_departments"
  ADD CONSTRAINT "shift_session_departments_shift_session_id_fkey"
  FOREIGN KEY ("shift_session_id") REFERENCES "shift_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_session_departments"
  ADD CONSTRAINT "shift_session_departments_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- "quem está de plantão neste setor agora": rodízio, contagem por setor e aviso
-- de setor descoberto passam todos por aqui.
CREATE INDEX "shift_session_departments_tenant_id_department_id_ended_at_idx"
  ON "shift_session_departments" ("tenant_id", "department_id", "ended_at");

CREATE INDEX "shift_session_departments_shift_session_id_ended_at_idx"
  ON "shift_session_departments" ("shift_session_id", "ended_at");

-- Uma cobertura ABERTA por (plantão, setor). Sem isto, dois logins simultâneos
-- da mesma pessoa criariam duas linhas do mesmo setor e ela contaria duas vezes
-- no limite de plantonistas — barrando um colega legítimo. Índice PARCIAL:
-- coberturas encerradas se acumulam e precisam poder repetir.
--
-- Vive só aqui, como `conversas_uma_ativa_por_contato` e
-- `shift_sessions_uma_aberta_por_usuario`: o Prisma não modela índice com WHERE
-- e vai acusar isto como drift em `migrate dev`. Não apague.
CREATE UNIQUE INDEX "cobertura_aberta_unica"
  ON "shift_session_departments" ("shift_session_id", "department_id")
  WHERE "ended_at" IS NULL;

-- BACKFILL. Quem está de plantão AGORA precisa de cobertura, senão o rodízio
-- para de encontrar essas pessoas no instante do deploy e as conversas ficam na
-- fila com todo mundo logado — sem erro, sem log, sem ninguém entender.
--
-- Os setores são os da escala da pessoa (distintos), e a hora é a do próprio
-- plantão: é exatamente o que valia até esta migration, quando a sessão cobria
-- todos os setores dela até o fim. A hora por setor só passa a valer nos
-- plantões abertos daqui para frente.
INSERT INTO "shift_session_departments" ("id", "tenant_id", "shift_session_id", "department_id", "ends_at", "created_at")
SELECT
  gen_random_uuid()::text,
  ss."tenant_id",
  ss."id",
  s."department_id",
  ss."ends_at",
  NOW()
FROM "shift_sessions" ss
JOIN (SELECT DISTINCT "user_id", "tenant_id", "department_id" FROM "shifts" WHERE "active") s
  ON s."user_id" = ss."user_id" AND s."tenant_id" = ss."tenant_id"
WHERE ss."ended_at" IS NULL;
