# Architecture

How the Auto-Expense Capture Assistant is put together, and where to add the
next piece. Read this before adding code — most questions ("which file do I
touch?") are answered here.

## 1. Layering

```
HTTP            src/app.ts            src/routes/api.ts        src/middleware/*
   |                   \                    |                       /
   +--------------------+-------------------+----------------------+
                                     domain services
                     src/services/capture.ts   src/types/receipt.ts
                                     ports            adapters
        src/services/store.ts   src/services/object-store.ts   src/services/uploads.ts
                ^                        ^                           ^
     dynamo-store.ts               (memory impl)              (s3 impl / memory impl)
        dynamodb.ts  s3.ts
```

Rules of thumb:

- `src/app.ts` composes the HTTP layer from **injected** ports. It reads no
  environment and starts no listener, so it is fully testable with fakes.
- `src/index.ts` is the **composition root**: it reads config, picks adapters,
  builds the app and listens. This is the only file that knows about both.
- Routes parse and authorise HTTP; they never contain business rules.
- Business rules live in `src/services/*.ts` and take their dependencies as an
  argument (`CaptureDeps`), never by importing a singleton.
- AWS wrappers (`dynamodb.ts`, `s3.ts`) are infrastructure detail. Anything above
  them talks to the ports in `store.ts`, `object-store.ts` and `uploads.ts`.

## 2. Module map

| File | Responsibility | Ports/adapters |
|---|---|---|
| `src/index.ts` | composition root, listener | chooses adapters from config |
| `src/app.ts` | Express app factory, middleware order | — |
| `src/config.ts` | env → typed config, validation | `loadConfig`, `awsCredentials` |
| `src/routes/api.ts` | `/health`, `/api/**` routes | uses `CaptureDeps` |
| `src/middleware/identity.ts` | placeholder identity (`x-user-id`) | swap for Cognito JWT here |
| `src/middleware/errors.ts` | JSON error envelope, 404 | `AppError` family |
| `src/middleware/async.ts` | forwards async rejections (Express 4) | — |
| `src/services/capture.ts` | reserve-then-upload flow, quota | `CaptureDeps` |
| `src/services/store.ts` | `ReceiptStore` port + in-memory impl | port |
| `src/services/dynamo-store.ts` | `ReceiptStore` over DynamoDB | adapter |
| `src/services/dynamodb.ts` | typed DynamoDB CRUD (pre-existing) | AWS |
| `src/services/object-store.ts` | `ImageStore` port + in-memory impl | port |
| `src/services/uploads.ts` | `UploadSigner` adapters (S3, memory) | adapter |
| `src/services/s3.ts` | presigned URLs, object ops (pre-existing) | AWS |
| `src/types/receipt.ts` | receipt domain types + validators | — |
| `public/` | browser capture console (static) | — |
| `public/format.js`, `public/capture-flow.js` | console view model + capture state machine, UMD-wrapped so jest can require them | tested from `src/ui/` |

## 3. The capture flow (implemented)

```
client                        API                            storage
  │ POST /api/receipts ──────▶ captureReceipt
  │   { image: {...} }          1. validate (type, size ≤ 10 MB)
  │                            2. count receipts this UTC month
  │                            3. sign upload URL (UploadSigner)
  │                            4. store receipt (status: pending)
  │ ◀───── 201 { receipt, upload } ────────────────────────────────
  │ PUT upload.url (S3 presigned, or /api/uploads/:token locally)
  │ POST /api/receipts/:id/complete ──▶ status: processing ─────────
  │ GET /api/receipts ────────────────▶ newest-first list ─────────
  │ DELETE /api/receipts/:id ─────────▶ drop a `pending` row ───────
```

Why reserve-then-upload: the receipt row exists before the bytes do, so a
half-finished upload leaves a `pending` record rather than a dangling object,
and the OCR pipeline has something to pick up the moment `complete` lands.

The cost of that design is that a `pending` row holds one of the month's 50
slots, so it must be reclaimable: `discardPendingUpload` (`src/services/capture.ts`)
is the only destructive operation in the product, scoped to the caller's own
receipt, refused once the receipt is confirmed (`409`), and audit-logged on
success. `public/capture-flow.js` tags each failure with what is recoverable
(`discardable` before the bytes land, `confirmable` after), and
`recoveryFor()` turns that tag into the single action the console offers.

The console keeps its decisions out of the DOM: `public/format.js` (view model)
and `public/capture-flow.js` (capture state machine) are UMD-wrapped plain JS
required directly by `src/ui/console.test.ts`; `public/app.js` only wires
elements, `fetch` and `sessionStorage`.

## 4. Configuration → adapter selection

| Variable | Default | Effect |
|---|---|---|
| `STORAGE_BACKEND` | `memory` | `memory` → in-process store; `dynamodb` → DynamoDB (requires AWS keys) |
| `UPLOAD_SIGNER` | `memory` when storage is `memory`, else `s3` | where signed upload URLs point |
| `DEV_AUTH_HEADER_ENABLED` | `true` outside production, **always `false` in production** | enables the `x-user-id` placeholder identity |
| `MAX_RECEIPTS_PER_MONTH` | `50` | free-tier cap enforced in `captureReceipt` |
| `CORS_ALLOWED_ORIGINS` | unset (same-origin only) | comma-separated browser-origin allowlist; no CORS headers when unset |

Default configuration = zero external dependencies: `npm run dev` boots, and a
receipt can be captured, uploaded and listed without an AWS account. Nothing is
persisted across restarts in that mode.

## 5. Error model

`CaptureError`, `StoreError`, `S3Error`, `DynamoDBError` all carry
`code` + `statusCode` and extend `CaptureError`'s base. `middleware/errors.ts`
is the only place errors become HTTP responses:

- client-safe coded errors → their own status and message;
- anything else → `500 INTERNAL_ERROR`, detail logged server-side only.

Never echo a raw upstream (AWS/SDK) message into a response — it leaks internal
paths. `capture.ts` logs and returns a generic message instead.

## 5b. Request hardening (`middleware/security.ts`)

Every response carries `Content-Security-Policy` (same-origin only, no inline
script/style), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, a `Permissions-Policy` that leaves the camera to
this origin only, and `Cross-Origin-Opener-Policy`. `x-powered-by` is off.

CORS is opt-in: with `CORS_ALLOWED_ORIGINS` unset the middleware is a no-op and
no origin can read a response. When set, only allowlisted origins get
`Access-Control-Allow-Origin` and preflight is answered for them alone.

Body sizes are capped at the parser (`256kb` JSON, `10mb` raw for
`/api/uploads`) and list pagination at `MAX_PAGE_SIZE = 200`.

## 6. Not built yet (next turns)

- OCR pipeline (S3 trigger → Textract → categorization → DynamoDB)
- CSV export / webhook sync (`GET /export`)
- Cognito JWT verification (replace `devHeaderIdentityResolver`)
- React Native capture client (`public/` is the web stand-in)
- Rate limiting beyond the monthly receipt cap

## 7. Adding a route (the recurring task)

1. Add the handler in `src/routes/api.ts`; wrap async work in `asyncHandler`.
2. Resolve the caller with `identityResolver(req)` — never read a user id from
   the body or query.
3. Put business rules in `src/services/`, taking deps as an argument.
4. Throw a coded `CaptureError`; let `middleware/errors.ts` render it.
5. Add supertest cases to `src/app.test.ts` — including "another user sees 404".
