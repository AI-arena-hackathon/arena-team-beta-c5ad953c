# VERIFICATION_REPORT — capture flow hardening & docs

Date: 2026-10-01
Scope: capture primary flow (reserve → upload → confirm → list), security-header
and CORS hardening, repo-navigation docs. Supersedes the previous report.

## 1. Build

| Command | Exit | Result |
|---|---|---|
| `npm run build` (`tsc`) | 0 | PASS — `dist/` emitted, no diagnostics |

## 2. Typecheck

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | 0 | PASS — no type errors |

## 3. Lint

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | PASS — 0 errors, 5 warnings |

All 5 warnings are `File ignored because of a matching ignore pattern` for
`*.test.ts` (ESLint's default ignore plus the repo's own pattern). No code
findings.

## 4. Test

| Command | Exit | Result |
|---|---|---|
| `npm test` (`jest --coverage`) | 0 | PASS — 8 suites, 271 tests, all passing |

Coverage: 86.99% statements, 80.4% branches, 89.76% functions, 88.87% lines.

**Flake observation (honest record):** one early run after the security-header
change reported `1 failed | 270 passed`, but the failing test name was not
captured. It has not reproduced in **12 consecutive full runs** since (3 of them
after the complete `build → tsc → lint → test` chain, 6 with coverage, 3
without). To remove the one shared-state hazard in the suite,
`src/index.test.ts` now restores `process.env` in `afterEach` instead of only in
`afterAll`. Treated as a residual risk, not a confirmed defect.

## 5. Security

| Check | Command | Result |
|---|---|---|
| Runtime dependency audit | `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| Full audit (incl. dev) | `npm audit` | 6 high, all in `@typescript-eslint/*` → `minimatch` 9.0.3 (ReDoS on attacker-controlled glob patterns) |
| Remediation attempt | `npm audit fix` | No change — fix requires an eslint 9 / flat-config major bump |
| Secret scan of changed files | regex sweep for keys/PK/tokens | PASS — only placeholders (`your-secret-access-key` in `.env.example`, `test-secret-key` in tests) |
| Tracked env files | `git ls-files` | PASS — only `.env.example`; `.env` gitignored and absent |

The 6 advisories are **dev-toolchain only** (lint-time `minimatch`); no runtime
package is affected. Tracked in BACKLOG as a toolchain-upgrade follow-up.

Hardening added this turn (`src/middleware/security.ts`, applied to every response
including the UI): `Content-Security-Policy` (same-origin script/style, no
inline, `object-src 'none'`, `frame-ancestors 'none'`), `X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Permissions-Policy: camera=(self), geolocation=(), microphone=()`,
`Cross-Origin-Opener-Policy: same-origin`, and `x-powered-by` off. CORS is now
opt-in: with `CORS_ALLOWED_ORIGINS` unset the middleware is a no-op, so no foreign
origin can read API responses.

Verified live against the running server:

```
CSP: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
     connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none';
     form-action 'self'; frame-ancestors 'none'
nosniff: nosniff | frame: DENY | referrer: no-referrer
permissions: camera=(self), geolocation=(), microphone=() | COOP: same-origin
powered-by: undefined
ACAO for evil origin: undefined
UI status: 200 | UI has CSP: true
```

## 6. Browser verification (Playwright, real app on :3113)

| Step | Evidence |
|---|---|
| Load console at `http://localhost:3113/` | title "Auto-Expense Capture Assistant", `health: ok`, `free tier: 0/50 used · 50 left` |
| Console messages | **0 errors, 0 warnings** — the new CSP breaks nothing (no inline script/style in `public/`) |
| Reserve + upload | `Reserved rcpt_muovrk19_xfa7gbp1 (status pending) and uploaded 14 bytes to memory://4df878a5…` |
| Confirm | `rcpt_muovrk19_xfa7gbp1 is now processing — OCR pipeline queued.` |
| Table + usage after confirm | row `rcpt_muovrk19_xfa7gbp1 · processing · 1 · 2026-10-01T01:53:42.189Z`; `free tier: 1/50 used · 49 left` |
| Network trace | `/api/usage` 200, `/api/receipts` 200, `POST /api/receipts` 201, `PUT /api/uploads/4df878a5…` 201, `…/complete` 200 |
| Screenshot | `.verify/capture-console-secure-headers.png` (93 KB) |

Server stopped and `.dev-server.log` removed afterwards.

## 7. Diff review

`git diff --stat`: 14 files changed, 169 insertions(+), 95 deletions(-), plus new
`src/middleware/security.ts` and `.verify/`.

Code-review pass over the diff (correctness / design / readability / testing /
altitude) and security pass (STRIDE) produced these fixes, all applied:

1. Wide-open `cors()` replaced with an allowlist that is empty by default.
2. Missing response hardening headers → `middleware/security.ts`.
3. `if (options.imageStore)` conditional that bolted the upload routes onto the
   router → the store is now always injected (memory default), routes always
   mounted, contract stable.
4. Dead export `MAX_PAGE_SIZE` re-exported from `app.ts`; unused
   `DynamoStoreDeps` interface; duplicate `./s3` import in `uploads.ts` — all
   removed.
5. Meaningless test ("does not start a listener when the app is built", which
   built a throwaway `express()` app) replaced with a real one (health from an
   app built with zero injected deps).
6. `process.env` leakage hazard in `src/index.test.ts` fixed (`afterEach`).
7. Unused runtime dependency `cors`/`@types/cors` uninstalled.

## Verdict

READY — build, typecheck, lint, test, security (runtime-clean; dev-only
advisories accepted and tracked) and browser verification all pass.

**Verdict: READY**
