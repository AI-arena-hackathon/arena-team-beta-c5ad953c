# Auto‑Expense Capture Assistant

Team beta — spec §3.2 hackathon build.

**One-liner:** Instantly turns a cluttered receipt pile into a clean, searchable expense record without manual entry.

**Problem:** Small‑business owners and freelancers spend an average of 45 minutes daily scanning and typing receipts into spreadsheet software, often making errors that lead to audit issues and missed deductions.

**Solution:** A lightweight mobile app that uses AI OCR to extract data from photos of receipts, auto‑categorizes expenses, links them to bank transactions, and exports clean CSV files ready for tax software.

**Build scope:** **Auto‑Expense Capture Assistant – Day 4‑5 Architecture (≈ 190 words)**  

**Tech Stack**  
- **Frontend (mobile):** React Native (Expo) – single code‑base for iOS & Android, fast OTA updates, native camera access.  
- **Backend API:** Node .js + Express running on AWS Lambda (serverless) – auto‑scales, low ops overhead.  
- **Data Store:** DynamoDB (key‑value) for user receipts + metadata; S3 for raw images (encrypted).  
- **AI/OCR Service:** Amazon Textract (pay‑as‑you‑go) wrapped in a Lambda layer; fallback to an open‑source Tesseract container if Textract throttles.  
- **Auth:** Cognito (OAuth2) – email/password + social login, JWT for API calls.  

**Three Core Components**  
1. **Capture & Upload Service** – React Native UI → device camera → compresses JPEG → signs request with JWT → uploads to S3 (presigned URL).  
2. **Receipt‑Processing Pipeline** – S3 trigger → Lambda calls Textract → extracts line‑items, totals, dates → passes to a categorization Lambda (simple rule‑engine + small fine‑tuned BERT model). Results stored in DynamoDB.  
3. **Export & Sync Module** – API endpoint `/export` returns user‑filtered CSV (streamed from DynamoDB) → share via email, iCloud, or direct download; optional Webhook to QuickBooks/Zero.  

**Top 2 Risks**  
- **OCR Accuracy on Low‑Quality Photos** – mitigated by client‑side image preprocessing (auto‑enhance, perspective correction) and a fallback to Tesseract with manual correction UI.  
- **Cost‑Explosion on High Volume** – limit free tier to 50 receipts/month, enforce per‑user rate limits, and monitor Textract usage alerts.  

**Fallback Scope (if timeline slips)**  
- Replace Textract with Tesseract‑only pipeline (no ML categorization).  
- Drop bank‑transaction linking; export only raw receipt data.  
- Ship as a web‑only PWA (camera via browser) to remove native build steps.  

Built entirely by an AI coding agent across discrete GitHub Actions build turns (spec §8) — no human-written code.

## What works today

The **capture & upload** leg of the architecture is implemented and runnable
end to end — no AWS account required:

1. `POST /api/receipts` reserves a receipt record (monthly free-tier cap enforced)
   and returns a signed upload URL for the image.
2. The client `PUT`s the photo bytes to that URL (S3 presigned URL in production,
   `/api/uploads/:token` locally).
3. `POST /api/receipts/:id/complete` flips the receipt to `processing`.
4. `GET /api/receipts` lists the caller's records; `GET /api/usage` shows quota.

`/` serves a browser **capture console** that drives exactly this flow.

Still to build: OCR processing pipeline, CSV export/sync, Cognito auth,
React Native client. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the
module map and where each piece lands.

## Running the Project

### Prerequisites
- Node.js 18+
- npm 9+

### Setup
```bash
# Clone the repository
git clone <repo-url>
cd auto-expense-capture-assistant

# Install dependencies
npm install
```

Nothing else is required to run it: the default configuration
(`STORAGE_BACKEND=memory`, `UPLOAD_SIGNER=memory`) keeps receipts and image
bytes in process, so the app boots and the full capture flow works with no AWS
account. Data does not survive a restart.

To use real AWS services, copy the template and fill it in:
```bash
cp .env.example .env
# then set STORAGE_BACKEND=dynamodb, UPLOAD_SIGNER=s3, bucket/table names,
# and AWS credentials (or rely on the instance/task role and omit the keys)
```

### Development
```bash
# Run in development mode (default port 3000)
npm run dev

# Then open http://localhost:3000/ for the capture console
# or smoke-test the API:
curl -s localhost:3000/health
curl -s -H 'x-user-id: user_demo' localhost:3000/api/usage
```

### Project layout
```
src/index.ts            composition root: config -> adapters -> app -> listener
src/app.ts              Express app factory (no env reads, fully injectable)
src/routes/api.ts       /health and /api/** endpoints
src/middleware/         identity, JSON error envelope, async error forwarding
src/services/           domain logic + ports (store, object-store, uploads) and adapters
src/types/receipt.ts    receipt domain types and validators
public/                 browser capture console (static, no build step)
docs/ARCHITECTURE.md    layering rules, module map, capture flow
```

### Production Build
```bash
# Compile TypeScript
npm run build

# Run compiled server
npm start
```

### Testing
```bash
# Run tests with coverage
npm test

# Run tests in watch mode
npm run test:watch
```

### Linting
```bash
# Run ESLint
npm run lint
```

### Environment Variables
Everything is optional in the default (in-memory) mode — see
`.env.example` for the full template.

**Server**
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (default: development)

**Adapter selection**
- `STORAGE_BACKEND` - `memory` (default) or `dynamodb`. `dynamodb` requires AWS
  credentials and a receipts table.
- `UPLOAD_SIGNER` - `memory` (default when storage is `memory`) or `s3`. Controls
  where signed upload URLs point.

**AWS** (optional; the SDK falls back to the instance/task role when omitted)
- `AWS_REGION` - AWS region (default: us-east-1)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` - static credentials

**DynamoDB**
- `DYNAMODB_TABLE_RECEIPTS` - Receipts table name (default: receipts)
- `DYNAMODB_TABLE_USERS` - Users table name (default: users)
- `DYNAMODB_ENDPOINT` - Optional local DynamoDB endpoint (e.g., http://localhost:8000)

**S3**
- `S3_BUCKET_RECEIPTS` - S3 bucket for receipt images (required for `UPLOAD_SIGNER=s3`)
- `S3_PRESIGNED_URL_EXPIRY` - Presigned URL expiry in seconds (default: 3600)

**Cognito (Auth)**
- `COGNITO_USER_POOL_ID` - Cognito user pool ID
- `COGNITO_CLIENT_ID` - Cognito app client ID
- `COGNITO_REGION` - Cognito region (default: us-east-1)

**Textract (OCR)**
- `TEXTRACT_ENABLED` - Enable Textract OCR (default: true)
- `TEXTRACT_REGION` - Textract region (default: us-east-1)

**Feature Flags**
- `ENABLE_OCR_FALLBACK` - Enable Tesseract fallback (default: true)
- `MAX_RECEIPTS_PER_MONTH` - Free tier limit, enforced per user per UTC month (default: 50)
- `DEV_AUTH_HEADER_ENABLED` - Accept the placeholder `x-user-id` identity.
  Defaults to on outside production and is **always off when `NODE_ENV=production`**.

### API Endpoints

All `/api/**` routes require an identity (`x-user-id` header while
`DEV_AUTH_HEADER_ENABLED` is on; Cognito JWT once auth lands) and are scoped to
that user. Errors share one envelope: `{"error":{"code":"...","message":"..."}}`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check → `{"status":"ok"}` (no identity needed) |
| GET | `/api/config` | Public flags: free-tier limit, max image bytes |
| POST | `/api/receipts` | Reserve a receipt + signed upload URL (`201`) |
| PUT | `/api/uploads/:token` | Local upload target when `UPLOAD_SIGNER=memory` |
| GET | `/api/uploads/:token` | Upload metadata for the owning user |
| POST | `/api/receipts/:id/complete` | Confirm bytes landed → status `processing` |
| GET | `/api/receipts` | List own receipts (`?status=`, `?limit=` ≤ 200) |
| GET | `/api/receipts/:id` | Fetch one own receipt (`404` for anyone else's) |
| GET | `/api/usage` | Monthly quota usage and remaining allowance |

Capture example:
```bash
curl -s -X POST localhost:3000/api/receipts \
  -H 'content-type: application/json' -H 'x-user-id: user_demo' \
  -d '{"image":{"fileName":"lunch.jpg","contentType":"image/jpeg","size":20481}}'
```
