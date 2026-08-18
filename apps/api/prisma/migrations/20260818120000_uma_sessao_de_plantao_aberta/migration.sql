-- "Uma sessão de plantão aberta por atendente" era garantida por uma fila em
-- memória: valia dentro de um processo e sumia com o segundo. Duas sessões
-- abertas fazem o job de expiração concluir que o turno seguinte já começou e
-- deixar de devolver as conversas de quem saiu.
--
-- Fecha primeiro o que já estiver duplicado, mantendo a sessão que começou por
-- último (é a que o `findOpenSessionForUser` devolveria, ordenado por
-- started_at desc — então nada muda de comportamento para quem está logado).
UPDATE "shift_sessions" s
   SET "ended_at" = now(), "end_reason" = 'admin'
 WHERE s."ended_at" IS NULL
   AND EXISTS (
         SELECT 1 FROM "shift_sessions" mais_nova
          WHERE mais_nova."tenant_id" = s."tenant_id"
            AND mais_nova."user_id"   = s."user_id"
            AND mais_nova."ended_at" IS NULL
            AND (mais_nova."started_at" > s."started_at"
                 OR (mais_nova."started_at" = s."started_at" AND mais_nova."id" > s."id"))
       );

-- Índice parcial: o Prisma não representa `WHERE` em @@unique, então ele vive
-- só aqui. Mesma escolha já feita em `conversations_uma_ativa_por_contato`.
CREATE UNIQUE INDEX "shift_sessions_uma_aberta_por_usuario"
    ON "shift_sessions" ("tenant_id", "user_id")
 WHERE "ended_at" IS NULL;
