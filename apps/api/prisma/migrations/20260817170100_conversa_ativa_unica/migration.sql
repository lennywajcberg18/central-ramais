-- "Uma conversa aberta por contato por tenant" é decisão de produto e até aqui
-- era sustentada só pelo Map do keyedQueue, que serializa dentro de UM processo.
-- Com dois processos (ou um restart no meio), duas mensagens seguidas do mesmo
-- número leem "não há conversa ativa" e as duas criam: o contato recebe dois
-- menus, responde num só, e a outra conversa fica viva até o job de inatividade
-- fechá-la meia hora depois — mandando pergunta de nota de um atendimento que
-- nunca existiu e subindo card de abandono no painel do gestor.
--
-- awaiting_feedback fica DE FORA da lista, como em ACTIVE_STATUSES: é o estado
-- em que o contato pode abrir uma conversa nova enquanto ainda responde a nota
-- da anterior.

-- Duplicatas já gravadas impediriam o índice de nascer. A conversa que o fluxo
-- considera viva é a mais recente (`findActiveByContact` ordena por created_at
-- desc); as anteriores são órfãs da corrida — ninguém está lendo nem
-- respondendo. Fecham com o mesmo motivo de quando o contato larga uma conversa
-- e passa a falar em outra.
WITH ativas AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY "tenant_id", "external_contact_id"
           ORDER BY "created_at" DESC, "id" DESC
         ) AS posicao
    FROM "conversations"
   WHERE "status" IN ('awaiting_department', 'open', 'assigned', 'awaiting_menu_confirm')
)
UPDATE "conversations" c
   SET "status" = 'closed',
       "close_reason" = 'user_switched',
       "closed_at" = now()
  FROM ativas
 WHERE ativas.id = c.id
   AND ativas.posicao > 1;

-- O Prisma não modela índice único parcial: este índice existe só aqui e vira
-- drift no `prisma migrate dev`. Está anotado no schema.prisma para não ser
-- apagado por engano.
CREATE UNIQUE INDEX "conversations_uma_ativa_por_contato"
    ON "conversations" ("tenant_id", "external_contact_id")
 WHERE "status" IN ('awaiting_department', 'open', 'assigned', 'awaiting_menu_confirm');
