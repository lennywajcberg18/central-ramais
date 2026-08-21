-- A escala passa a apontar para um SETOR.
--
-- Até aqui `shifts` dizia "a Beatriz trabalha segunda das 7h às 19h" e não dizia
-- onde. Na prática ela entrava de plantão e passava a receber chamado de todos
-- os setores dela ao mesmo tempo, porque `availableAgentsForDepartment` casa
-- QUALQUER sessão aberta com QUALQUER setor da pessoa. Plantão não funciona
-- assim: segunda ela está no CT, quarta na Recepção — e quando cobre dois
-- setores no mesmo turno, isso também é escala, não consequência de onde ela já
-- trabalhou algum dia.
--
-- Sem o setor aqui não há como responder "quantos estão de plantão no CT
-- agora", que é a pergunta que o limite de plantonistas por setor e o aviso de
-- setor descoberto fazem.

-- 1) Coluna nasce nula: preencher antes de exigir é o padrão da casa
--    (ver 20260817163014_lado_da_mensagem_interna).
ALTER TABLE "shifts" ADD COLUMN "department_id" TEXT;

-- 2) Backfill. Não é UPDATE: uma linha de escala vira N, uma por setor da
--    pessoa, porque hoje aquela faixa vale para todos eles. Preservar o
--    comportamento atual é exatamente isso — quem recebia de dois setores
--    continua recebendo de dois.
--
--    Primeiro as cópias (todos os setores MENOS o primeiro), depois o UPDATE do
--    original para o primeiro. Nesta ordem o INSERT ainda enxerga as linhas
--    originais com department_id nulo e não copia o que acabou de criar.
INSERT INTO "shifts" ("id", "tenant_id", "user_id", "department_id", "weekday", "start_minute", "end_minute", "active", "created_at")
SELECT
  gen_random_uuid()::text,
  s."tenant_id",
  s."user_id",
  ud."department_id",
  s."weekday",
  s."start_minute",
  s."end_minute",
  s."active",
  s."created_at"
FROM "shifts" s
JOIN "user_departments" ud ON ud."user_id" = s."user_id"
WHERE s."department_id" IS NULL
  AND ud."department_id" <> (
    SELECT p."department_id"
      FROM "user_departments" p
     WHERE p."user_id" = s."user_id"
     ORDER BY p."department_id"
     LIMIT 1
  );

UPDATE "shifts" s
   SET "department_id" = (
     SELECT p."department_id"
       FROM "user_departments" p
      WHERE p."user_id" = s."user_id"
      ORDER BY p."department_id"
      LIMIT 1
   )
 WHERE s."department_id" IS NULL;

-- 3) Atendente sem NENHUM setor não tem para onde apontar: o produto cartesiano
--    acima produz zero linhas para ele e o department_id continua nulo. Essa
--    pessoa já não recebia conversa nenhuma (o rodízio exige pertencer ao setor)
--    e o painel dela já avisa "Sem setor — nenhuma conversa chega até você".
--    A escala órfã some junto; quem vincular a pessoa a um setor cadastra a
--    escala no mesmo lugar em que faz o vínculo.
DELETE FROM "shifts" WHERE "department_id" IS NULL;

-- 4) Agora sim obrigatória.
ALTER TABLE "shifts" ALTER COLUMN "department_id" SET NOT NULL;

ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- "quem está escalado neste setor neste dia" — a consulta do limite por setor e
-- do aviso de setor descoberto.
CREATE INDEX "shifts_tenant_id_department_id_weekday_idx"
  ON "shifts" ("tenant_id", "department_id", "weekday");
