-- CreateEnum
CREATE TYPE "InternalSide" AS ENUM ('origin', 'destination');

-- A coluna entra nula para o histórico existente poder ser preenchido antes de
-- virar obrigatória.
ALTER TABLE "internal_messages" ADD COLUMN "sender_side" "InternalSide";

-- Backfill: o lado sai do setor de quem escreveu. Quem está no setor de origem
-- da conversa falou de lá; qualquer outro falou do lado de destino.
UPDATE "internal_messages" m
SET "sender_side" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "user_departments" ud
    JOIN "internal_threads" t ON t."id" = m."thread_id"
    WHERE ud."user_id" = m."user_id"
      AND ud."department_id" = t."from_department_id"
  ) THEN 'origin'::"InternalSide"
  ELSE 'destination'::"InternalSide"
END
WHERE "sender_side" IS NULL;

ALTER TABLE "internal_messages" ALTER COLUMN "sender_side" SET NOT NULL;
