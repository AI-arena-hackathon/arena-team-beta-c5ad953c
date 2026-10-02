# Verification report — accessibility & reach pass (turn 15)

| Phase | Command | Result | Exit |
|---|---|---|---|
| Build | `npm run build` (`tsc` → `dist/`, run after `rm -rf dist`) | PASS — compiled with no diagnostics | 0 |
| Typecheck | `npx tsc --noEmit` | PASS — no diagnostics | 0 |
| Lint | `npm run lint` (`eslint src/**/*.ts` + `node --check` on the three browser modules) | PASS — 0 errors, 9 pre-existing "file ignored because of a matching ignore pattern" warnings (eslint ignores `src/**/*.test.ts` by config) | 0 |
| Test | `npm test` (jest --coverage, full suite) | PASS — 12 suites, 506 tests, 505→506 passing after the last edit; 87.91% statement coverage. One flake recorded below | 0 |
| Security | `npm audit --omit=dev` + `npm audit` + secret scan of the diff | PASS for runtime deps — 0 vulnerabilities. 6 high-severity `minimatch` ReDoS advisories remain, all dev-only via eslint/jest (already in the backlog, unchanged this turn) | 0 |
| Diff | `git status --porcelain && git diff --stat` | 5 files changed, 368 insertions, 60 deletions (+1 new test file) | — |

## Test evidence
- command: `npm test`
- result: 506 passed, 0 failed, 0 skipped (run 2 and run 3, both exit 0, back to back after the last edit)
- failing test names (if any): run 1 of the three had `composition root (src/index.ts) › GET /health should return 200 with status ok` exceed jest's 5000 ms default timeout (thrown, not an assertion failure). The suite passes in isolation (283 ms) and in two consecutive full runs, so this is load-related flake in the pre-existing composition-root suite, not a regression from this turn — `public/*.js` is not reachable from `src/index.test.ts`. Tracked as a follow-up rather than papered over with a retry loop.
- tests added this turn: `src/ui/accessibility.test.ts`, 22 tests (6 pure-descriptor suites + a markup/script invariant suite)

## Browser evidence (headless Chromium, `npm run dev` on port 3112)
- Primary flow exercised after the last edit: load → pick photo → blocked capture moves focus to the outstanding consent → accept the three required consents (the capture button clears itself) → capture succeeds → view a row → discard a stranded slot.
- Focus behaviour, measured from `document.activeElement`:
  - blocked capture, no file → focus `drop-zone`, file summary reads "Choose a receipt photo first."
  - blocked capture, consents outstanding → focus `consent_terms_of_service`, consent summary names all three
  - row control after a table re-render → focus stays on "View receipt rcpt_…" (was `document.body` before this change)
  - discard, whose row disappears → focus parks on `#list-result` (was `document.body` before this change)
  - error box (server killed mid-flow) → focus moves to `#capture-error`; Dismiss returns focus to `#capture-button`
  - skip link → focus moves to `<main>`, 3 px outline visible
- Announcements: `#detail-announcement` = "Receipt rcpt_… — Awaiting extraction"; `#consent-summary`; `.status-row` carries `role="status"` for health + usage.
- Console: 0 errors, 0 warnings on a fresh load (so no CSP violation — the added markup adds no inline script or style).
- Screenshots: `/tmp/playwright-artifacts/page-2026-10-02T01-24-50-454Z.png` (full page, final state) and `page-2026-10-02T01-21-38-491Z.png`.

## Security notes
- dependency audit: runtime deps clean (0). The 6 dev-only `minimatch` ReDoS advisories are unchanged and already tracked; no dependency was added this turn.
- secrets: none introduced. `git diff` scanned for `password|secret|api_key|token` — no matches.
- XSS: no `innerHTML`, `eval`, `document.write` or inline handler was introduced; all text is written with `textContent` and nodes built with DOM APIs, which is what the console's CSP (`script-src 'self'`) enforces.
- Selector injection: focus restoration originally built a CSS selector by interpolating a receipt id; it now matches `getAttribute` values over a static selector, so an id containing `"` or `]` cannot throw a `SyntaxError` out of `renderRows`.
- Accessibility changes are not an authorization boundary: the capture button is `aria-disabled` (still submit-blocking client-side) and the server remains the authority for consent and quota.

## Verdict
READY
The console is now keyboard- and screen-reader-operable end to end; next turn should pick up the biggest open product gap (the React Native client or the OCR pipeline) and may want to fix the `src/index.test.ts` boot-timeout flake first, since it can fail a full-suite run under load.
