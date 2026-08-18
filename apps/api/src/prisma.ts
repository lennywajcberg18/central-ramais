import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Limites das transações interativas, explícitos porque os padrões do Prisma
// (maxWait 2s, timeout 5s) foram escolhidos supondo um banco ao lado, e o nosso
// está atrás de um pooler em outra região.
//
// Medido contra o Supabase em São Paulo: um `SELECT 1` leva ~112ms, e cada
// conversa enfileirada atrás da trava do setor soma ~85ms ao pior caso
// (N=10 → 894ms). Nesse ritmo o padrão de 5s estoura por volta de 55 conversas
// simultâneas no MESMO setor; de uma região distante como Oregon, metade disso.
// Improvável neste produto, mas o modo de falha é P2028 no meio da atribuição —
// justamente sob a contenção que a trava existe para resolver.
export const LIMITES_DE_TRANSACAO = { maxWait: 5_000, timeout: 15_000 };
