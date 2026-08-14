import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { UnauthorizedError } from '../errors';
import * as users from '../repositories/users';

export interface AuthPayload {
  userId: string;
  tenantId: string;
  role: 'admin' | 'agent';
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthPayload;
  }
}

// O tenantId vem SEMPRE daqui (JWT assinado). Nunca de body, query, params ou header.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('token ausente'));
    return;
  }
  let payload: AuthPayload;
  try {
    payload = jwt.verify(header.slice('Bearer '.length), config.JWT_SECRET) as AuthPayload;
  } catch {
    next(new UnauthorizedError('token inválido'));
    return;
  }

  try {
    // Sem refresh token, o JWT vale 12h — desativar um usuário precisa ter efeito
    // agora, não quando o token dele expirar.
    const active = await users.isActive(payload.tenantId, payload.userId);
    if (!active) {
      next(new UnauthorizedError('acesso encerrado'));
      return;
    }
    req.auth = { userId: payload.userId, tenantId: payload.tenantId, role: payload.role };
    next();
  } catch (err) {
    // Express 4 não captura rejeição de middleware async.
    next(err);
  }
}

export function requireRole(role: 'admin' | 'agent') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.role !== role) {
      res.status(403).json({ error: 'sem permissão' });
      return;
    }
    next();
  };
}
