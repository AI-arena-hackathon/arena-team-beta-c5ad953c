export interface ErrorCode {
  readonly code: string;
  readonly statusCode: number;
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function wrapError(
  error: unknown,
  fallbackCode: string,
  fallbackStatusCode: number = 500,
  knownErrors: ReadonlyArray<{ instanceOf: new (...args: never[]) => AppError; code?: string; statusCode?: number }> = []
): never {
  for (const known of knownErrors) {
    if (error instanceof known.instanceOf) {
      const code = known.code ?? error.code;
      const statusCode = known.statusCode ?? error.statusCode;
      throw new AppError(error.message, code, statusCode);
    }
  }
  throw new AppError(
    error instanceof Error ? error.message : 'Unknown error',
    fallbackCode,
    fallbackStatusCode
  );
}

export function createErrorWrapper<T extends AppError>(
  errorClass: new (message: string, code?: string, statusCode?: number) => T,
  fallbackCode: string,
  fallbackStatusCode: number = 500
) {
  return (error: unknown, codeOverride?: string): never => {
    if (error instanceof errorClass) {
      throw new AppError(error.message, codeOverride ?? error.code, error.statusCode);
    }
    throw new AppError(
      error instanceof Error ? error.message : 'Unknown error',
      codeOverride ?? fallbackCode,
      fallbackStatusCode
    );
  };
}

export function assertNever(x: never, message: string): never {
  throw new AppError(message, 'INVALID_STATE', 500);
}

export function invariant(condition: unknown, message: string, code = 'INTERNAL_ERROR', statusCode = 500): asserts condition {
  if (!condition) {
    throw new AppError(message, code, statusCode);
  }
}

export function requireDefined<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) {
    throw new AppError(`${name} is required`, 'VALIDATION_ERROR', 400);
  }
  return value;
}