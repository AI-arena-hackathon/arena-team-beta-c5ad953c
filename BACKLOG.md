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

## In Progress

- (empty — the next build turn picks the top open task in Todo)

## Todo

- [ ] Keep `.github/workflows/ci.yml` green on every push (it runs tests)
- [ ] Wire product deploy: on CI green, build a preview (wrangler pages / docker image) and link it in README.md so judges can curl live product, not just repo
- [ ] Implement receipt capture & upload service (React Native + camera + S3 presigned URLs)
- [ ] Implement receipt processing pipeline (S3 trigger → Lambda → Textract → categorization → DynamoDB)
- [ ] Implement export & sync module (CSV export, webhook to QuickBooks/Zero)
- [ ] Add authentication with Cognito (OAuth2, JWT)
- [ ] Add image preprocessing for OCR accuracy (auto-enhance, perspective correction)
- [ ] Add rate limiting and cost controls (50 receipts/month free tier)
- [ ] Add S3 client wrapper for presigned URL generation
- [ ] Add DynamoDB client wrapper for receipt CRUD operations
