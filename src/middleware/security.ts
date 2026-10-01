import type { RequestHandler } from 'express';

/**
 * The browser console is served from the same origin as the API and loads no
 * third-party or inline script/style, so a strict same-origin policy is enough
 * and costs nothing. `data:` is allowed for images because the favicon is an
 * inline data URI.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), geolocation=(), microphone=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Baseline hardening headers applied to every response, including the UI. */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(header, value);
  }
  next();
};

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, X-User-Id, Authorization';

/**
 * Same-origin only by default: an empty allowlist emits no CORS headers at all,
 * so a browser on another origin cannot read API responses. Set
 * `CORS_ALLOWED_ORIGINS` to opt specific origins in (the mobile client is not
 * subject to CORS).
 */
export function createCorsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  if (allowedOrigins.length === 0) {
    return (_req, _res, next) => next();
  }
  const allowlist = new Set(allowedOrigins);

  return (req, res, next) => {
    const origin = req.header('origin');
    if (origin && allowlist.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Vary', 'Origin');

    if (req.method !== 'OPTIONS') {
      next();
      return;
    }

    if (origin && allowlist.has(origin)) {
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
    }
    res.status(204).end();
  };
}
