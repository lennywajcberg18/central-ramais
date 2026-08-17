-- Conversas anteriores à coluna ficariam com `first_assigned_at` nulo, e o
-- dashboard passou a medir o tempo até a atribuição por esse campo. Sem este
-- backfill o histórico sairia da média em silêncio — o card de volume contando
-- todas as conversas e o de atribuição só as criadas depois do deploy.
--
-- `assigned_at` é a melhor aproximação disponível: nas linhas antigas ele é a
-- atribuição vigente. Onde a conversa foi reatribuída (ou solta por desativação
-- de usuário) o valor é a última, não a primeira — aproximação para trás, mas
-- muito melhor do que descartar o período inteiro.
UPDATE "conversations"
SET "first_assigned_at" = "assigned_at"
WHERE "assigned_at" IS NOT NULL AND "first_assigned_at" IS NULL;
