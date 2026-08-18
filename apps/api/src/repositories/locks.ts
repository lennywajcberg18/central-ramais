import { Prisma } from '@prisma/client';

// Travas do Postgres, no lugar de fila em memória.
//
// O `keyedQueue` serializava por chave DENTRO de um processo. Isso protege
// enquanto existir um processo só — e é justamente essa premissa que impede o
// projeto de subir uma segunda instância ou de virar serverless, porque lá cada
// requisição é um isolate novo e a fila some sem avisar.
//
// `pg_advisory_xact_lock` faz o mesmo, no banco: quem chega depois espera, e a
// trava é liberada no commit ou no rollback da transação — não há como esquecer
// de soltar, nem como um processo que morreu deixar a chave presa. Atravessa
// instâncias e sobrevive a restart.
//
// A variante `_xact_` é obrigatória aqui: a de sessão exigiria a MESMA conexão
// para travar e destravar, o que não vale com pooler em modo transação (é o
// modo do Supabase, e é para onde este projeto vai).
export function advisoryLock(tx: Prisma.TransactionClient, chave: string) {
  // hashtext devolve int4; pg_advisory_xact_lock(int8) aceita sem cast. Colisão
  // de hash entre chaves diferentes só custaria espera desnecessária, nunca
  // correção — duas chaves no mesmo balde serializam entre si e nada mais.
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`;
}

// Uma conversa por vez, por setor: é o rodízio que precisa disto. Sem a trava,
// duas conversas chegando juntas leem a mesma "última atribuição", escolhem o
// mesmo atendente, e cada UPDATE acerta a sua própria conversa — as duas passam,
// uma pessoa fica com as duas e a outra com nenhuma.
export function chaveDoRodizio(tenantId: string, departmentId: string): string {
  return `assign:${tenantId}:${departmentId}`;
}
