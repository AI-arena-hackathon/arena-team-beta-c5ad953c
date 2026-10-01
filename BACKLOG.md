# Backlog

<!-- IDEA: Auto‑Expense Capture Assistant — Instantly turns a cluttered receipt pile into a clean, searchable expense record without manual entry -->

Tasks are worked top-down by the build agent, one per turn where possible.
Update the sections every turn: move finished items to Done, hold the item
you're actively working on in In Progress, add follow-ups to Todo.

## Done

- [x] Initial scaffold seeded by the arena (AGENTS.md, BACKLOG.md, .gitignore, .env.example, .github/workflows/ci.yml)
- [x] Replace the `<!-- IDEA: ... -->` placeholder at the top with a one-line summary of the actual idea
- [x] Implement the core feature from README.md — the smallest real version that works (Express server with health endpoint)
- [x] Add a health endpoint (e.g. `GET /health` returning `{"status":"ok"}`) that proves the app runs
- [x] Add tests covering the core feature and the health endpoint
- [x] Update .env.example to match architecture (AWS, DynamoDB, S3, Cognito, Textract)
- [x] Create configuration module with validation (src/config.ts)
- [x] Update Express app to use configuration module
- [x] Update README.md with accurate environment variables
- [x] Add tests for configuration module (17 new tests)
- [x] Create receipt schema/types with validation (src/types/receipt.ts) - 49 tests
- [x] Create DynamoDB client wrapper for receipt CRUD operations (src/services/dynamodb.ts) - 40 tests
- [x] Add S3 client wrapper for presigned URL generation (src/services/s3.ts) - safe path segments, sanitized extensions
- [x] Receipt capture & upload service on the server (src/services/capture.ts, store/object-store ports, DynamoDB + S3 + memory adapters) - 15 tests
- [x] HTTP layer: injectable app factory (src/app.ts) + /api routes for reserve, complete, list, get, usage, local uploads - 37 tests
- [x] Browser capture console (public/index.html, app.js, styles.css) verified in headless Chromium end to end
- [x] Request hardening: security headers + opt-in CORS allowlist (src/middleware/security.ts) - 6 tests
- [x] Zero-config local run: npm run dev works with no AWS account (memory store + memory upload signer)
- [x] Docs: docs/ARCHITECTURE.md, README setup/layout/API tables, .env.example, and .arena/skills/repo-navigation
- [x] Extract shared error handling utilities (src/utils/errors.ts) — AppError base class, wrapError, createErrorWrapper
- [x] Extract shared validation utilities (src/utils/validation.ts) — userId, path segments, tokens, file names, content types, numbers
- [x] Extract shared test helpers (src/utils/test-helpers.ts) — fake signer, test deps, valid image data, JPEG buffer
- [x] Refactor dynamo-store.ts to use shared error utilities
- [x] Refactor s3.ts to use shared validation and error utilities
- [x] Refactor capture.ts to use shared validation utilities
- [x] Refactor object-store.ts to use shared validation and error utilities
- [x] Update app.test.ts and capture.test.ts to use shared test helpers
- [x] One-action capture: pre-flight validation, quota-safe pending recovery, receipt table + detail panel, and `DELETE /api/receipts/:id` to reclaim a stranded slot — 60 tests (41 new), verified in headless Chromium
- [x] Code + security review pass: honest test interfaces, per-failure retry actions, no unreachable recovery affordance, audit log on discard, exact CORS method list

## In Progress

- (empty — the next build turn picks the top open task in Todo)

## Follow-ups discovered

- [ ] Upgrade the lint toolchain to eslint 9 + flat config to clear 6 dev-only `minimatch` ReDoS advisories (`npm audit` is clean for runtime deps)
- [ ] Add per-IP rate limiting on capture endpoints; the monthly free-tier quota exists but there is no request-rate control yet
- [ ] Validate image magic bytes on upload (content-type allowlist is enforced, bytes are not sniffed yet)
- [ ] Decide the amount unit: `metadata.total` is unitless in the domain model, so the console prints plain decimals and the currency separately — the OCR pipeline must define whether amounts are major or minor units
- [ ] Delete the S3 object when a pending upload is discarded (today the reclaim drops the receipt row; a reserved-then-abandoned capture leaves the object behind when bytes had already landed)
- [ ] Anchor receipt ids to `^rcpt_` in `validateReceiptId` — it is a path segment, and the receipt id is attacker-adjacent
- [ ] Validate `GET /api/receipts/:id` with the same rule as the other receipt-id paths (it reads the store directly)
- [ ] Add jsdom coverage for `public/app.js` wiring (`jest-environment-jsdom` is not installed); `recoveryFor` is extracted and unit-tested, the DOM glue is not
- [ ] Paginate the console table (the API caps a page at 200 and the list summary now admits truncation)

## Todo

- [ ] Keep `.github/workflows/ci.yml` green on every push (it runs tests)
- [ ] Wire product deploy: on CI green, build a preview (wrangler pages / docker image) and link it in README.md so judges can curl live product, not just repo
- [ ] Implement the React Native client (camera capture + presigned upload) — server side is done
- [ ] Implement receipt processing pipeline (S3 trigger → Lambda → Textract → categorization → DynamoDB)
- [ ] Implement export & sync module (CSV export, webhook to QuickBooks/Zero)
- [ ] Add authentication with Cognito (OAuth2, JWT)
- [ ] Add image preprocessing for OCR accuracy (auto-enhance, perspective correction)
- [ ] Add cost controls beyond the implemented 50 receipts/month free-tier cap
- [ ] Add S3 client wrapper for presigned URL generation