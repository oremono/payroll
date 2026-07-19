---
title: 'Bulk import UI (CAP-1)'
type: 'feature'
created: '2026-07-19'
status: 'in-progress'
baseline_revision: '24c609be26737d81b208163199da6e80745fae6d'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-2-context.md'
  - '{project-root}/docs/implementation-artifacts/spec-2-1-bulk-import-backend.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 2-1 shipped the whole import backend — `POST /api/import`, the row-validation domain, the write funnel, and a finalized `ImportResult` payload — but `src/app/import/page.tsx` is still the 1-6 placeholder reading "Bulk import is not available yet." There is no way for a person to put a file into the system, so the directory every later capability assumes stays empty.

**Approach:** Replace the placeholder with the upload surface and the per-row report: a file picker, a submit that POSTs multipart to the existing Route Handler, and a rendering of the returned `ImportResult` — summary strip, rejection table, or whole-file refusal — using the sentences the backend already composed, verbatim. Consume the fixed payload; add nothing to the contract.

## Boundaries & Constraints

**Always:**
- **Consume the payload unmodified (Law 7, epic-2-context).** `RowRejection.sentence`, `RowRejection.offendingValue`, and `ImportResult.statement` are rendered as-received. The UI never calls `composeRejectionSentence`, `rejectionOffendingValue`, or `composeRefusalStatement`, and never authors a second sentence for a reason the backend already worded.
- **Branch on `kind`, never on HTTP status.** The handler answers `200` for every reachable input, including refusals. Status-based error handling would be dead code.
- **An all-rejected file is a report, not an error.** `kind: 'imported'` with `importedCount: 0` renders the normal summary + table. Only `kind: 'refusal'` renders the refusal panel.
- **Types only across the boundary.** `import type { ImportResult, RowRejection }` from `@/application/use-cases/import-employees`; `import type { FileRefusalReason }` from `@/domain/import-row` if needed. No value import from `application/use-cases/**` or `adapters/**` into `src/ui/**`.
- **Accessibility floor (NFR9, EXPERIENCE § Accessibility Floor).** The refusal renders as a region with a heading — **never** `role="alert"`. The file input has a programmatically associated `<label>` and its format helper text is linked by `aria-describedby`. The rejection table uses real `<th scope="col">`. Colour is never the sole carrier of meaning. Page headings start at `<h2>` — the header owns the document's one `<h1>`.
- **One voice.** Outcome announcements go through `useAnnounce()` from `@/ui/announcer`. Never mount a second live region.
- **Determinism in formatting.** Thousands separators come from an explicitly pinned locale (`'en-US'`), never the ambient locale.
- **Test-first (Law 1).** Every production file lands after a test that failed for the right reason.
- **Tokens only (AD-15).** No colour literal in any notation, no `dark:` variant. Form controls sit on `bg-surface-card` (the established idiom — `input-border` measures 3.09:1 on card, 2.96:1 on `surface-base`).

**Block If:**
- The `refusal-fill` contrast assertion added by this story fails. Retuning a DESIGN.md brand token is a human decision — HALT, do not adjust the palette to make a gate pass.
- Any requirement here cannot be met without a **third** Route Handler (AD-21 permits exactly two) or without converting the upload to a Server Action.
- Rendering the report cannot be done without copying in shadcn/ui or adding React Testing Library / jsdom. Both are live deferred decisions with wider blast radius than this story; escalate rather than absorb.

**Never:**
- **No rejection-report CSV download.** The mock shows one; 2-1 forbids it explicitly (it would be a third Route Handler). The affordance is dropped, and pagination is what makes every rejection reachable instead.
- **No spinner, progress bar, percentage, or progress theater** (EXPERIENCE § Cold load). The pending state is a disabled submit and a plain statement.
- **No red/green semantics, no celebration, no notification affordance.** There is no error colour in the token system; refusals use `refusal-fill` + `border-hairline`.
- **No `.xlsx` in the accept copy.** The mock's "— .csv or .xlsx" contradicts AD-7. CSV only; a workbook is a whole-file refusal.
- **No infinite scroll** on the rejection table.
- **No re-import/upsert affordance, no employee-identity UI, no first-run copy changes to Home or Employees** — out of scope.
- **No shadcn/ui copy-in, no RTL, no jsdom.** Follow the established pattern: pure logic in a framework-free `.ts` module unit-tested under node; rendered behaviour proven in Playwright.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Clean import | `{ kind: 'imported', importedCount: 9947, rejectedCount: 0, rejections: [] }` | Strip `9,947 rows imported · 0 rows rejected · nothing guessed`; no rejection table; report region announced | No error expected |
| Partial import | `importedCount: 9947, rejectedCount: 53` | Same strip; `Rejection Report (53 rows)` heading + table of first 50, page controls, rows in file order | No error expected |
| All rejected | `importedCount: 0, rejectedCount: 4` | Strip `0 rows imported · 4 rows rejected · nothing guessed` + table. **Not** a refusal panel | No error expected |
| Singular counts | `importedCount: 1, rejectedCount: 1` | `1 row imported · 1 row rejected · nothing guessed` | No error expected |
| Blank name cell | `RowRejection.name === null` | Name cell renders `—`; meaning carried by the Reason column's sentence, not by the dash alone | No error expected |
| Whole-file refusal | `{ kind: 'refusal', reason: { kind: 'not-csv' }, statement: '…' }` | Region with `<h2>` heading + `statement` verbatim on `refusal-fill`. No table, no counts | Region, never `role="alert"` |
| Submit with no file chosen | Native file input empty | Submit is disabled; no request is issued | Client-side guard only |
| Request in flight | POST pending | Submit disabled, label states the action is under way; no spinner | Input stays enabled-but-inert until settled |
| Network/transport failure | `fetch` rejects or body is not JSON | Refusal-shaped panel with a plain statement that the upload did not complete | Caught locally; never an unhandled rejection, never a thrown render |
| Second upload | A report is on screen, user picks another file and submits | Prior report is replaced wholesale; page resets to page 1 of the new report | No error expected |

</intent-contract>

## Code Map

- `src/app/import/page.tsx` -- the placeholder to replace; stays a **server** component, renders the client panel
- `src/ui/import-panel.tsx` -- NEW. `'use client'` — file input, submit, `fetch` to `/api/import`, result rendering
- `src/ui/import-report.ts` -- NEW. Framework-free pure logic: summary strip, pagination slice, name cell, announcement sentence
- `src/ui/announcer.tsx` -- `useAnnounce()`; the one live region. Import it, never duplicate it
- `src/ui/as-of-control.tsx` -- the only existing form in the repo; the input/button/focus idiom to match
- `src/app/api/import/route.ts` -- the existing `POST` endpoint. **Do not modify**
- `src/application/use-cases/import-employees.ts` -- `ImportResult`, `RowRejection` (all `readonly`). Type source of truth
- `src/domain/import-row.ts` -- `RejectionReason`, `FileRefusalReason` vocabularies
- `src/adapters/csv/parse-import-csv.ts` -- `REQUIRED_COLUMNS`, the nine header names for the format helper text
- `tests/ui/nav-items.test.ts` -- the established node-environment UI-logic test pattern
- `e2e/accessibility.spec.ts` -- the axe gate; `/import` is already in `ROUTES` (empty state only)
- `docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md` -- component anatomy, token names
- `docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md` -- import flow, partial-import state, accessibility floor
- `docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/reconcile-stitch.md` -- ADOPT rulings: strip phrasing, button grammar

## Tasks & Acceptance

**Execution:**
- [ ] `tests/ui/import-report.test.ts` -- write the failing unit suite first: strip composition (plural/singular/zero, pinned-locale separators), pagination slicing (exact page, last partial page, single page, empty), name cell for `null`, announcement sentence for both `kind`s -- red before green (Law 1); covers every I/O Matrix row that is pure logic
- [ ] `src/ui/import-report.ts` -- implement `composeSummaryStrip`, `rejectionPage`, `nameCell`, `composeImportAnnouncement`; framework-free, no React, no `Date`, page size 50 -- keeps the testable logic in the node suite where the repo has no jsdom
- [ ] `src/ui/import-panel.tsx` -- `'use client'` panel: labelled file input with `accept=".csv,text/csv"` and `aria-describedby` helper naming the nine required columns, disabled-until-chosen submit, `FormData` POST to `/api/import`, `kind` switch rendering strip / table / refusal region, `useAnnounce()` on settle, local catch for transport failure -- the story's whole surface, matching the `as-of-control` idiom
- [ ] `src/app/import/page.tsx` -- replace the placeholder statement with `<ImportPanel />`; keep it a server component with no `<h1>` -- the route becomes the capability
- [ ] `e2e/import.spec.ts` -- Playwright: stub `/api/import` with `page.route` + canned `ImportResult` payloads (partial, clean, all-rejected, refusal), drive the real file picker with `setInputFiles`, assert rendered text/table/heading semantics, keyboard operability, and run `AxeBuilder` on each post-upload state in **both** colour schemes -- these states are markup a page-load scan never reaches
- [ ] `e2e/tokens.spec.ts` -- add the `refusal-fill` contrast assertion (ink on `refusal-fill`, and its hairline border) now that a refusal is rendered for the first time -- discharges the deferred gate gap; **Block If** it fails
- [ ] `package.json` -- add `test:import` running `playwright test e2e/import.spec.ts` and include it in `test:browser` -- matches the one-script-per-suite convention

**Acceptance Criteria:**
- Given the import page with no file chosen, when it loads, then the submit control is disabled and no request has been issued.
- Given a chosen CSV, when the user submits, then exactly one `POST` to `/api/import` carries the file as a multipart part, and the UI issues no other request to its own origin.
- Given any `ImportResult`, when it is rendered, then every sentence displayed is byte-identical to a `sentence` or `statement` string in the payload.
- Given a report is on screen, when a screen reader queries the live region, then it holds one statement of the outcome and the report itself is reachable as a headed region, not an alert.
- Given a rejection report of more than 50 rows, when the user pages through it, then every rejection in the payload is reachable by keyboard alone, in file order, with no infinite scroll.
- Given the completed story, when `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:a11y`, and `npm run test:import` run, then all pass and no colour literal or `dark:` variant was introduced.

## Spec Change Log

## Review Triage Log

## Design Notes

**Planner rulings on the gaps the UX left open** (recorded so review does not relitigate them):

1. *Pending state.* EXPERIENCE bans spinners and progress theater, and its skeleton prescription is a **read** pattern with no equivalent for a multipart POST. Ruling: no spinner, no bar, no percentage — the submit disables and states the action is under way, in the calm register the rest of the product uses.
2. *Download rejection report.* Dropped. 2-1 forbids the route; a client-side blob would invent an export path the design system has not sanctioned. Pagination replaces it, so nothing becomes unreachable.
3. *Truncation vs pagination.* The mock truncates at 50 with "… and 50 more rows". With no download, truncation would hide data permanently. Ruling: paginate at 50 (infinite scroll is banned outright).
4. *Strip format.* The reconcile ADOPT wins over EXPERIENCE's earlier phrasing — `N rows imported · N rows rejected · nothing guessed`, with singular `row` at a count of 1.
5. *`.xlsx`.* Mock copy contradicts AD-7 and loses; DESIGN/EXPERIENCE win on conflict.
6. *No ghost button in this story.* Dropping the download leaves only a solid primary action, which sidesteps the open `button-secondary` border-contrast defect (measured 1.18:1) rather than shipping it.

Payload shape, verbatim from `src/application/use-cases/import-employees.ts` — `readonly` throughout, typecheck against the source, not against 2-1's prose sketch:

```ts
type ImportResult =
  | { readonly kind: 'imported'; readonly importedCount: number;
      readonly rejectedCount: number; readonly rejections: readonly RowRejection[] }
  | { readonly kind: 'refusal'; readonly reason: FileRefusalReason; readonly statement: string };
```

`rowNumber` is the 1-based physical line in the file (header is line 1), so it matches what the reader sees in their spreadsheet. Rejections arrive in file order — do not sort. Table columns follow the adopted mock: `Row #` · `Employee Name (File)` · `Offending Value` · `Reason`, numerals mono and right-aligned per DESIGN.

No money crosses this boundary: `ImportResult` carries no monetary value, and `offendingValue` is the raw trimmed cell string as the file spelled it. There is nothing for the money formatter to do here.

## Verification

**Commands:**
- `npm test` -- expected: green, including the new `tests/ui/import-report.test.ts`
- `npm run lint` -- expected: clean; import-boundary zones and the colour-literal ban both live in this run
- `npm run typecheck` -- expected: clean against the `readonly` payload types
- `npm run test:import` -- expected: green, including axe on every post-upload state in both schemes
- `npm run test:a11y` -- expected: green; `/import`'s empty state still passes
- `npm run test:tokens` -- expected: green, including the new `refusal-fill` contrast assertion
- `npm run build` -- expected: clean production build

**Manual checks (if no CLI):**
- Confirm the rendered sentences are byte-identical to payload strings by diffing against the canned E2E fixtures rather than by eye.
