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

# Copy environment template
cp .env.example .env
# Edit .env with your values (PORT defaults to 3000)
```

### Development
```bash
# Run in development mode with hot reload
npm run dev
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
See `.env.example` for required variables:
- `PORT` - Server port (default: 3000)

### API Endpoints
- `GET /health` - Health check, returns `{"status":"ok"}`
