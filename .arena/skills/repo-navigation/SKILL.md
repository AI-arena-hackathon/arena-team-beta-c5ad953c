---
name: repo-navigation
description: Where things live in the auto-expense-capture-assistant repo and how to add a layer (route, service, adapter) without breaking its conventions. Use when starting a turn that touches src/ or when unsure which file to edit; not for pure docs or config edits.
---

# Repo navigation

The module layout is deliberate — the two rules below are what keep it
navigable. Full rationale lives in `docs/ARCHITECTURE.md`; this is the
fast path.

## When to Use

- Starting any turn that adds or changes behaviour under `src/`.
- Before adding a file: the layer you need may already have a home.
- Deciding what belongs in a service vs a route vs an adapter.

## Steps

1. Read `docs/ARCHITECTURE.md` §2 (module map) and `BACKLOG.md` (top of Todo).
2. Pick the layer:
   - HTTP shape (status codes, query parsing, identity) → `src/routes/api.ts`
   - Business rule, quota, orchestration → `src/services/<domain>.ts`
   - Persistence or external I/O detail → an adapter (`-store.ts`, `uploads.ts`)
   - Domain shape/validation → `src/types/receipt.ts`
   - Wiring to the environment → `src/index.ts` **only**
   - Console view logic (labels, filters, pre-flight rules) → `public/format.js`
   - Console capture sequencing and failure recovery → `public/capture-flow.js`
   - DOM/`fetch`/`sessionStorage` glue only → `public/app.js`
3. Add behaviour TDD-style: write the failing test first, run it, then code.
   - Service: `src/services/<name>.test.ts` with a fake port (in-memory store
     or `createFakeSigner`-style object).
   - Route: `supertest` against `createApp({...fakes})` in `src/app.test.ts` —
     never against `src/index.ts` (that reads the environment).
4. Run the full ladder before committing:
   ```bash
   npx tsc --noEmit && npm run lint && npm test
   ```
   `npm test` already runs jest with coverage; `npm run build` compiles to `dist/`.

## Rules

- `src/app.ts` and anything it imports must not read `process.env` — inject
  dependencies. Only `src/index.ts` composes config into adapters.
- Async route handlers must be wrapped in `asyncHandler` (`src/middleware/async.ts`).
  Express 4 does not catch rejections and the request hangs until timeout.
- Throw coded `CaptureError`s; `src/middleware/errors.ts` renders them. Never
  put an AWS/SDK error message in a response — log it, return a generic message.
- Never take a user id from a body or query string; use
  `identityResolver(req)`. Cross-user reads must answer 404, not 403.
- Tests live beside their module as `<name>.test.ts` and are excluded from
  `tsconfig`/eslint — keep new tests in that shape so lint stays green.
- Browser modules are classic scripts with no build step: wrap them in the UMD
  tail used by `public/format.js` (classic scripts share one global scope, so a
  bare `const api` in two files breaks the page) and require them straight from
  a test under `src/ui/`. `npm run lint` also runs `node --check` on them.
- The console's CSP forbids inline handlers and `innerHTML`; write text with
  `textContent` and build nodes with DOM APIs.
- Anything that offers a recovery affordance must be reachable: a failure path
  that records a receipt in `sessionStorage` and shows a button has to keep
  showing it after the error box is dismissed and after a reload. Test the
  failure paths in the browser, not just the happy one.
- The default configuration must keep working with zero external services
  (`STORAGE_BACKEND=memory`, `UPLOAD_SIGNER=memory`). After touching config or
  the composition root, boot the app and run the capture flow once.

## Local smoke test (no AWS, no curl in this sandbox)

```bash
(NODE_ENV=development PORT=3112 npm run dev > .dev-server.log 2>&1 &) ; sleep 9 ; tail -3 .dev-server.log
node -e "const h=require('http');h.get({host:'localhost',port:3112,path:'/health'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(r.statusCode,d))})"
```
Then open `http://localhost:3112/` in Playwright and capture → upload →
confirm. Kill the server before finishing the turn
(`kill $(ps -eo pid,args | grep '[t]s-node src/index.ts' | awk '{print $1}')`).
`/tmp/playwright-artifacts` is the only writable screenshot directory outside
the repo.
