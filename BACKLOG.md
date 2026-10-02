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
- [x] Implement compliance & data handling: user consent tracking (POST/GET/DELETE /api/compliance/consent), data retention policies (GET /api/compliance/retention), GDPR-style data subject rights — access/deletion/portability/rectification/restriction (POST/GET /api/compliance/data-request), and legal disclaimer endpoints (GET /api/compliance/disclaimers, /api/compliance/legal) — 140 new tests, coverage >95%
- [x] Render the consent checkboxes in the capture console (carried over uncommitted from the compliance turn and committed on its own)
- [x] Accessibility pass on the capture console: skip link, named/described drop zone, table caption, `aria-current` row, live regions for status/detail/consent, focus moved to the error box and returned on dismiss, focus preserved across table re-renders and parked on the list summary when a row disappears, `aria-disabled` capture button that focuses the blocking control instead of being unreachable, `prefers-reduced-motion` + `forced-colors` CSS, 1.9:1→5.2:1 focus ring and 2.6:1→4.8:1 disabled button — 22 tests in `src/ui/accessibility.test.ts`, verified in headless Chromium
- [x] Fix the consent gate never re-evaluating: ticking a required consent left the capture button unavailable until something else changed, so the form looked broken

## In Progress

- (empty — the next build turn picks the top open task in Todo)

## Follow-ups discovered

- [ ] Fix the `src/index.test.ts` boot-timeout flake: the composition-root suite occasionally exceeds jest's 5 s default under a full parallel run with coverage (passed 3 of 4 full runs, and always in isolation) — raise the timeout for that suite or load the root once per describe
- [ ] `public/app.js` is now ~1040 lines, past the ~1000-line inspection signal; extract the records rendering (`receiptRow` / `renderDetail` / `lineItemTable`) into their own classic script before piling more on it
- [ ] Add a `lang`-aware number/date format (the console formats with a fixed `en-GB` formatter regardless of the user's locale) and a units test for the amount unit decision below
- [ ] Re-check contrast after any restyle: `--muted` on `#f8fafc` and the `.notice` copy sit close to the 4.5:1 line and are untested by tooling
- [ ] Upgrade the lint toolchain to eslint 9 + flat config to clear 6 dev-only `minimatch` ReDoS advisories (`npm audit` is clean for runtime deps)
- [ ] Add per-IP rate limiting on capture endpoints; the monthly free-tier quota exists but there is no request-rate control yet
- [ ] Validate image magic bytes on upload (content-type allowlist is enforced, bytes are not sniffed yet)
- [ ] Decide the amount unit: `metadata.total` is unitless in the domain model, so the console prints plain decimals and the currency separately — the OCR pipeline must define whether amounts are major or minor units
- [ ] Delete the S3 object when a pending upload is discarded (today the reclaim drops the receipt row; a reserved-then-abandoned capture leaves the object behind when bytes had already landed)
- [ ] Anchor receipt ids to `^rcpt_` in `validateReceiptId` — it is a path segment, and the receipt id is attacker-adjacent
- [ ] Validate `GET /api/receipts/:id` with the same rule as the other receipt-id paths (it reads the store directly)
- [ ] Paginate the console table (the API caps a page at 200 and the list summary now admits truncation)
- [ ] Add automated data retention cleanup job (cron/lambda to purge expired receipts, images, audit logs, consent records per policy)
- [ ] Implement `/api/compliance/export/:requestId` endpoint to serve the actual data export file for completed access/portability requests
- [ ] Add cookie consent banner and tracking consent to the browser console
- [ ] Persist consent records to DynamoDB (currently only memory store; add DynamoDB adapter for ConsentStore and DataSubjectRequestStore)
- [ ] Add jsdom coverage for the remaining `public/app.js` DOM glue (focus movement, live-region writes, the delegated consent `change` listener); `jest-environment-jsdom` is still not installed, so those paths are covered by the browser pass and by the markup invariants in `src/ui/accessibility.test.ts` only

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