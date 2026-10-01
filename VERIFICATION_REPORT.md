# VERIFICATION_REPORT

Turn: Auto-Expense Capture Assistant — one-action capture console, quota-safe
pending recovery, `DELETE /api/receipts/:id`, plus a code/security review pass.
Date: 2026-10-01

## Verdict

READY

## Ladder (fresh output, this turn)

| Phase | Command | Result | Exit |
|---|---|---|---|
| Build | `npm run build` | PASS — `tsc` emitted `dist/` | 0 |
| Typecheck | `npx tsc --noEmit` | PASS — no diagnostics | 0 |
| Lint | `npm run lint` | PASS — 0 errors, 6 pre-existing "file ignored" warnings (test files are eslint-ignored by config) | 0 |
| Test | `npm test` | PASS — 9 suites, 323 tests, all passing; 85.47% statement coverage | 0 |
| Security | `npm audit --omit=dev` | PASS — 0 vulnerabilities in runtime deps | 0 |
| UI | Playwright against `http://localhost:3000` | PASS — happy path + 4 failure/recovery paths, 0 application console errors | n/a |
| Diff review | `code-review-and-quality` + `security-and-hardening` subagents | PASS — every Required finding fixed; residual items recorded in BACKLOG.md | n/a |

`npm run lint` now also runs `node --check` over `public/format.js`,
`public/capture-flow.js` and `public/app.js`: the browser bundle is the one part
of the product TypeScript cannot see.

## Test totals

- Before this turn: 4 suites / 262 tests.
- After: 9 suites / 323 tests. New work: `src/ui/console.test.ts` (33 tests over
  the browser view model and capture state machine), 8 new
  `discardPendingUpload` service tests, 4 new `DELETE` route tests, 1 CORS
  preflight test.

## What was verified in the browser (not just in unit tests)

- One click on **Capture receipt** with a valid JPEG → reserve → upload →
  confirm; progress text names the receipt and its status; detail panel opens on
  the new record; list summary and quota pill update (1 of 50 used).
- Pre-flight refusal: choosing `statement.txt` shows
  "statement.txt is not a supported image. Use JPEG, PNG, WebP or HEIC." and
  keeps the button disabled, so no slot is spent on a bad file.
- Failed upload (request aborted): the error box offers **Discard pending
  receipt**, the resume banner independently offers the reclaim, and both the
  error box's **Try again** and the banner's **Discard it** reclaim the slot
  (quota 2 → 1) instead of starting a fresh capture.
- Failed confirm (request aborted): banner reads "was uploaded but never
  confirmed", **Try again** repeats only the confirm — no second receipt, quota
  unchanged.
- Stale reminder (receipt no longer on the server): confirming it clears the
  banner with "RECEIPT_NOT_FOUND … the reminder has been cleared" instead of
  dead-ending; **Ignore** clears it with no request at all.
- Discard from a `pending` row in the table: row disappears, quota returns.
- Search with no match → "No receipts match — clear the search."; 390 px viewport
  has no horizontal overflow and the table scrolls inside its card.
- Screenshots: `/tmp/playwright-artifacts/console-primary-flow.png`,
  `console-mobile-390.png`, `console-review-fixes.png`,
  `console-mobile-review-fixes.png`, `console-final-1440.png`.

## Review findings addressed

Required (would have shipped a broken or misleading flow):

1. A failed upload's only reclaim lived in the error box, so dismissing the box
   (or capturing again) destroyed it. The reservation is now remembered in
   `sessionStorage` and the resume banner is the durable affordance.
2. A `pending` row and the detail panel said "discard it from the list" with no
   way to do it; both now carry a **Discard** control.
3. The pre-flight reason was computed and thrown away; it is now the file
   summary text.
4. Only the form submit was guarded by `state.busy`; the resume, discard, retry
   and refresh handlers are guarded too.
5. **Try again** after a failed confirm started a brand-new capture. The button
   now runs a per-failure action (`flow.recoveryFor`), so it repeats the confirm
   or repeats the discard.
6. The list summary used the loaded page length as the total; it now uses the
   server's `count` and admits truncation ("Showing 50 of 120 receipts
   (page limit 50)").
7. A stale resume banner dead-ended on 404/409; it is now cleared with an
   explanation and an **Ignore** button.

Security/robustness: `store.get` is wrapped so a read fault is a coded 500
rather than a phantom 404; the route echoes the id from the stored receipt, not
the raw path parameter; discards are audit-logged; `validateReceiptId` delegates
to `validatePathSegment` instead of duplicating a weaker rule; the CORS method
list is asserted exactly and proven empty when no origins are configured; the
DELETE route is proven 401 under a disabled identity resolver and 400 for an
unsafe id.

## Known limitations (deliberate, recorded in BACKLOG.md)

- Amounts are unitless in the domain model; the console prints plain decimals
  and the currency separately until the OCR pipeline fixes the convention.
- Discarding a pending receipt deletes the row, not any S3 object.
- Receipt ids are validated as safe path segments but not anchored to `^rcpt_`.
- `public/app.js` DOM glue has no automated coverage; the decisions it makes
  were extracted into `public/format.js` and `public/capture-flow.js`, which are
  unit-tested (33 tests).
