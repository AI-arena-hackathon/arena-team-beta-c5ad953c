import type { NextFunction, Request, Response } from 'express';
import { CaptureError } from '../services/capture';
import { StoreError } from '../services/store';

export class NotFoundError extends CaptureError {
  constructor(message = 'Not found') {
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class InternalError extends CaptureError {
  constructor(message = 'Internal server error') {
    super(message, 'INTERNAL_ERROR', 500);
    this.name = 'InternalError';
  }
}

/** Unknown paths get a JSON envelope, never Express' default HTML page. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`No route for ${req.method} ${req.path}`));
}

/**
 * Single place where errors become HTTP responses. Client-safe `CaptureError` /
 * `StoreError` messages are echoed; anything else is logged server-side and
 * answered with a generic 500 so internals never reach the client.
 */
export function errorHandler(
  error: Error,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof CaptureError || error instanceof StoreError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  console.error('Unhandled error:', error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
