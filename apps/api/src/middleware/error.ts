import { Prisma } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import { HttpError } from '../errors';

// O body-parser marca o motivo da recusa em `type` ('entity.parse.failed',
// 'entity.too.large'…). É a única forma de distinguir erro do corpo de falha nossa.
function bodyParserType(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err)) return undefined;
  const { type } = err as { type?: unknown };
  return typeof type === 'string' ? type : undefined;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...err.details });
    return;
  }
  // JSON malformado no corpo: o express.json lança SyntaxError com `body`.
  // Sem este ramo, um corpo quebrado vira "erro interno" (500) em qualquer rota.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'corpo da requisição não é um JSON válido' });
    return;
  }
  // Corpo acima do limite do parser: recusa do pedido, não falha do servidor.
  if (bodyParserType(err) === 'entity.too.large') {
    res.status(413).json({ error: 'corpo da requisição é grande demais' });
    return;
  }
  // Violação de índice único é erro do pedido, não falha do servidor: devolver
  // 500 aqui esconderia "e-mail já cadastrado" atrás de "erro interno".
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: 'já existe um registro com esse valor' });
    return;
  }
  console.error('[api] erro não tratado:', err);
  res.status(500).json({ error: 'erro interno' });
}
