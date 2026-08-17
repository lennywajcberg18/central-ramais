export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Campos extras do corpo da resposta: há recusa que só é acionável se a
    // tela souber QUAIS registros travaram (ex.: links sem setor ativo).
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'requisição inválida', details?: Record<string, unknown>) {
    super(400, message, details);
  }
}

// Estado atual do recurso impede a operação — diferente de "não existe" (404)
// e de "pedido malformado" (400).
export class ConflictError extends HttpError {
  constructor(message = 'conflito com o estado atual do recurso', details?: Record<string, unknown>) {
    super(409, message, details);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'não autorizado') {
    super(401, message);
  }
}

// Credencial válida, acesso negado por regra (fora do horário de plantão).
// Aqui 403 não vaza nada: quem recebe já provou ser o dono da conta. A regra de
// responder 404 vale para recurso de outro tenant, que é outro caso.
export class ForbiddenError extends HttpError {
  constructor(message = 'acesso negado', details?: Record<string, unknown>) {
    super(403, message, details);
  }
}

// 404 também para recursos de outro tenant — 403 confirmaria a existência
export class NotFoundError extends HttpError {
  constructor(message = 'não encontrado') {
    super(404, message);
  }
}
