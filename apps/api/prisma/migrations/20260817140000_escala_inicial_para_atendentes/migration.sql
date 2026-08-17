-- Quem já usava o sistema entrava sem escala nenhuma, porque escala não existia.
-- Sem esta linha, o primeiro deploy tranca TODOS os atendentes do lado de fora:
-- o seed só roda em banco vazio, então em ambiente com dados ninguém ganharia
-- escala e o login passaria a recusar todo mundo com "fora do horário".
--
-- Todo atendente sem escala recebe cobertura integral nos sete dias — que é
-- exatamente o acesso que ele já tinha. O hospital restringe depois, pelo
-- painel, que é o ponto da funcionalidade.
INSERT INTO "shifts" ("id", "tenant_id", "user_id", "weekday", "start_minute", "end_minute", "active", "created_at")
SELECT
  gen_random_uuid()::text,
  u."tenant_id",
  u."id",
  dia.weekday,
  0,
  1440,
  true,
  NOW()
FROM "users" u
CROSS JOIN generate_series(0, 6) AS dia(weekday)
WHERE u."role" = 'agent'
  AND NOT EXISTS (SELECT 1 FROM "shifts" s WHERE s."user_id" = u."id");
