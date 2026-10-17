export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, `${what} no encontrado`);
export const badRequest = (message: string, details?: unknown) => new AppError(400, message, details);
export const conflict = (message: string) => new AppError(409, message);
