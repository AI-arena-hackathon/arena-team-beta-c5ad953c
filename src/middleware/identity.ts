import type { Request } from 'express';
import { CaptureError } from '../services/capture';

export const USER_ID_HEADER = 'x-user-id';
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class UnauthenticatedError extends CaptureError {
  constructor(message = 'Missing or invalid identity') {
    super(message, 'UNAUTHENTICATED', 401);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Placeholder identity resolution for the pre-Cognito phase of the build.
 *
 * It trusts an `x-user-id` request header, so it must only be enabled where
 * there is no real authentication. `createApp` defaults to it for local
 * development; `index.ts` disables it (fail closed, 401) whenever
 * DEV_AUTH_HEADER_ENABLED is false. Swap in a Cognito JWT verifier by passing
 * `identityResolver` — nothing else in the app reads the header.
 */
export function devHeaderIdentityResolver(req: Request): string {
  const raw: unknown = req.headers[USER_ID_HEADER];
  const candidate: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  const userId = typeof candidate === 'string' ? candidate : '';
  if (!userId || !USER_ID_PATTERN.test(userId)) {
    throw new UnauthenticatedError(`Provide a valid ${USER_ID_HEADER} header`);
  }
  return userId;
}

export function disabledIdentityResolver(): string {
  throw new UnauthenticatedError('Authentication is not configured for this deployment');
}

export type IdentityResolver = (req: Request) => string;
