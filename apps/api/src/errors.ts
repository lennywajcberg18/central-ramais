export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'requisição inválida') {
    super(400, message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'não autorizado') {
    super(401, message);
  }
}

// 404 também para recursos de outro tenant — 403 confirmaria a existência
export class NotFoundError extends HttpError {
  constructor(message = 'não encontrado') {
    super(404, message);
  }
}
