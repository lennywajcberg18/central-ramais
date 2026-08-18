-- Rodízio: `lastAssignedAtByUsers` agrupa por assigned_user_id a cada conversa
-- roteada, dentro da fila serializada do setor. Sem índice é Seq Scan na tabela
-- inteira e o setor inteiro fica esperando a varredura.
CREATE INDEX "conversations_tenant_id_assigned_user_id_assigned_at_idx" ON "conversations"("tenant_id", "assigned_user_id", "assigned_at");

-- Lista do gestor com `situacao=todas`: sem filtro de status, o índice
-- (tenant_id, status, last_message_at) não serve para o ORDER BY e o Postgres
-- ordena a tabela toda para devolver as 100 primeiras.
CREATE INDEX "conversations_tenant_id_last_message_at_idx" ON "conversations"("tenant_id", "last_message_at");
