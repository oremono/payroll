---
title: 'CAP-10 Overdue for Review — UI'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: '123668e5d66e0f25258d5d755c614d25b4a374c8'
final_revision: 'ada6e6f597bfb8d51b531afeee57c4ef9677a342'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/docs/project-context.md', '{project-root}/docs/implementation-artifacts/epic-11-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The Overdue-for-Review backend (story 11-1, `done`) computes, for a given as-of date and period, the employees whose current salary record predates the cutoff — but there is no surface for it. The `/overdue` route is still story 1-6's placeholder and Home has no overdue count, so the finding this capability exists to surface (the person hired long ago and never adjusted) stays invisible.

**Approach:** Build the frontend slice consuming `getOverdue`'s finalized `GetOverdueResult` payload **unmodified** (AD-24): a dedicated `/overdue` surface holding a period control (preset chips 1y/18mo/2y/3y + a custom cutoff date field, all resolving to one `OverduePeriod`), a paginated list, a CSV export, and skeleton cold-load; plus a compact "N people overdue as of {date}" count on Home linking to the surface. Home's count is `report.rows.length` from the **same** `getOverdue` read at a default period — no second use-case, no clock read outside the boundary. The period URL param is validated at the delivery boundary (the residual risk 11-1 flagged) by one total resolver, mirroring `resolveAsOf`.

## Boundaries & Constraints

**Always:**
- Consume `getOverdue(overdueDeps(), asOf, period)` unmodified; add **nothing** to the boundary contract (AD-24). Re-derive no statistic — the count is `report.rows.length`; each row's fields arrive computed.
- Boundary is the composition root: `await connection()` first, read the clock ONCE via `systemClock.todayUtc()`, resolve `asOf` via `resolveAsOf` and `period` via the new total resolver, pass both inward. No `Date`/`Date.now()` in `src/ui/**` or the resolvers (Law 6). `src/ui/**` imports only `domain` + `application` (never `@/adapters/*` or `@/app/*`).
- The period URL param is HOSTILE: the resolver is TOTAL and never throws — negative, fractional, non-integer, unparseable, or repeated (`param` is an array) all fall back to the default preset (2y). A custom cutoff parses via `parsePlainDate` (rejects impossible dates → default). The page and the export route resolve `period` **identically** (same `getAll`/total discipline as `asOf`).
- Money renders only through the ONE formatter: `formatMoney(fromBoundaryMoney(row.salary), format)` with `format` resolved from the boundary-read `currencies` list by the row's own `currency` code; withheld figures fail CLOSED to an em dash (`—`) / blank CSV cell, never a bare number or raw `amountMinor` (Law 4).
- Vocabulary verbatim: "overdue for review", "overdue". Each list row shows the employee and the effective date of their current record. Home names the as-of date ("as of {date}"), never "currently".
- Pagination (not infinite scroll): slice `report.rows` in-memory by a surface-owned `?page=` param and a UI-owned page size; render from the EFFECTIVE (clamped) page, never the requested one; every pager and export href preserves both `asOf` and `period`.
- WCAG 2.2 AA (axe-gated): `unavailable` and zero-state render as a region with a heading, **never** `role="alert"`, HTTP 200. Period-chip selection is conveyed by `aria-pressed` (color never the sole carrier). Recompute announces through the ONE app-level `<Announcer>` via `useAnnounce()` — no new live region. Cold load = hairline skeleton rows, never a spinner.

**Block If:**
- `getOverdue`, `overdueDeps`, or the `GetOverdueResult`/`OverduePeriod`/`OverdueRow` types are absent or shaped differently than story 11-1 finalized them (the contract this story consumes has changed) → HALT `blocked`.

**Never:**
- No second use-case, no `home-overdue-summary` read, no clock read for the cutoff (the AD-22 hole 11-1 closed): Home derives its count from the same `getOverdue`.
- No change to the backend contract, no new port method, no re-computation of membership/cutoff/ordering in the UI.
- No red/green semantics, no notification/alert affordances, no celebration animation, no `role="alert"`, no `percentile_cont`/`AVG`, no FX/currency conversion, no country-edit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Preset period | `?period=24m` | Resolver → `{kind:'months', months:24}`; list measured against that cutoff | No error |
| No period param | `asOf` only | Resolver → default `{kind:'months', months:24}` (2y); chip 2y shown selected | No error |
| Custom cutoff | `?period=2024-07-16` | Resolver → `{kind:'date', cutoff: 2024-07-16}` | No error |
| Hostile period | `?period=-3m` / `0m` / `1.5m` / `banana` / repeated `?period=a&period=b` | Resolver → default preset (2y); never throws | Fallback, no error |
| Some overdue | `answer` with N rows | Table of N rows (name + record date + salary), oldest record first; count "N people overdue as of {asOf}" | No error |
| Zero overdue | `answer` with `rows: []` | Calm zero-state: "No one is overdue for review within the selected period." — a statement, not a celebration | No error |
| Pagination | 30 rows, `?page=2`, page size 25 | Rows 26–30 shown; status "Overdue 26–30 of 30 · Page 2 of 2"; prev/next preserve `asOf`+`period` | No error |
| Page past end | `?page=99` | Clamp to last page; render effective page, not the requested number | No error |
| Withheld money | Row `currency` absent from list / bad exponent | Salary cell renders `—` (list) / blank (CSV); row still listed | Fail closed |
| Unavailable | `getOverdue` → `{kind:'unavailable'}` | `EmployeeUnavailable` region (heading, HTTP 200); Home count card shows the same calm region | No exception crosses |
| CSV export | export href hit | `text/csv; charset=utf-8`, UTF-8 BOM, `Content-Disposition: attachment`, `Cache-Control: no-store`; header-only on `unavailable`; columns carry currency + `asOf`/`cutoff`/`period` provenance | HTTP 200 always |

</intent-contract>

## Code Map

- `src/application/overdue-period.ts` -- NEW, pure/total. `DEFAULT_OVERDUE_PERIOD = {kind:'months', months:24}`; `resolveOverduePeriod(param, ...): OverduePeriod` (total, mirrors `resolveAsOf` at `src/application/as-of.ts`); `overduePeriodToParam(period): string` (canonical URL form: `Nm` for months, `YYYY-MM-DD` for a custom cutoff). Imports `OverduePeriod`, `parsePlainDate`, `plainDateToIso` only.
- `src/ui/overdue-vm.ts` -- NEW, pure, unit-tested. `OVERDUE_PAGE_SIZE`; exported `OVERDUE_UNAVAILABLE_HEADING`/`_STATEMENT`, `OVERDUE_ZERO_STATE`; `PERIOD_PRESETS` (12/18/24/36 → labels 1 year / 18 months / 2 years / 3 years); `formatOverduePeriodLabel(period)`; `buildOverdue(result, currencies, page): OverdueVM` (arm select, per-row salary via the fail-closed `formatBoundary` helper copied from `payroll-totals-vm.ts`, in-memory pagination slice + status line + clamped page, formatted `asOf`/`cutoff`/period-label receipts); `buildOverdueSummary(result): OverdueSummaryVM` (Home compact count = `rows.length`, or the unavailable arm). No React, no `Date`.
- `src/adapters/csv/format-overdue-csv.ts` -- NEW, pure, unit-tested. `formatOverdueCsv(report: OverdueReport | null, currencies): string` mirroring `format-payroll-totals-csv.ts`/`format-outliers-csv.ts` (RFC-4180 quoting, formula-injection `guardText` on the name cell, CRLF, header-only when `report` is null/empty). Columns: employee name, effective date, salary, as-of, cutoff, period.
- `src/ui/overdue-list.tsx` -- NEW, markup only. Section-with-heading card; header row with the Export CSV ghost `<a>` (mirror `outlier-findings.tsx`); sticky-header table of rows keyed on `employeeId`; in-page pager (mirror `employee-pager.tsx`, degrade to text at ends, preserve `asOf`+`period`); zero-state and `EmployeeUnavailable` arms; `—` for withheld salary.
- `src/ui/overdue-period-control.tsx` -- NEW, `'use client'`. Preset chips (1y/18mo/2y/3y) + a labeled custom-date field with an Apply button; writes `?period=` into the URL by merging `new URLSearchParams` (preserve `asOf`+`page` reset), `startTransition` + `router.push`, `useAnnounce()` on commit; selection via `aria-pressed`. Mirror `src/ui/as-of-control.tsx`.
- `src/ui/overdue-summary.tsx` -- NEW, markup only. Home compact tile: "N people overdue as of {date}" with `drillHref` to `/overdue`; unavailable arm renders the calm region. Mirror `PayrollHeadlineTile`.
- `src/app/overdue/page.tsx` -- REPLACE story 1-6 placeholder. Boundary/composition root: `connection()`, resolve `asOf`+`period`+`page`, `getOverdue(overdueDeps(), asOf, period)` + `readCurrencies()`, as-of echo `<time data-testid="as-of-echo">`, render period control + `<OverdueList>` + export href `/api/overdue/export?asOf=…&period=…`.
- `src/app/overdue/loading.tsx` -- NEW. Skeleton hairline rows (mirror `src/app/employees/loading.tsx`), `aria-hidden`, no spinner.
- `src/app/api/overdue/export/route.ts` -- NEW Route Handler (one of the two permitted). `GET`: clock once, `resolveAsOf(getAll('asOf'))` + `resolveOverduePeriod(getAll('period'))`, `getOverdue` + currencies, `formatOverdueCsv`, BOM + `text/csv` + attachment + `no-store`; header-only on `unavailable`.
- `src/app/page.tsx` -- EDIT. Add `async function OverdueSummary({ asOf })` calling `getOverdue(overdueDeps(), asOf, DEFAULT_OVERDUE_PERIOD)` → `buildOverdueSummary` → `<OverdueSummary drillHref={/overdue?asOf=…} />`; stack it with the other Home cards.
- REUSE unchanged: `getOverdue`/types (`@/application/use-cases/overdue`), `overdueDeps` (`../employees/employee-deps`), `resolveAsOf` (`@/application/as-of`), `formatMoney`/`fromBoundaryMoney`/`CurrencyFormat` (`@/domain/money`), `formatPlainDate`/`plainDateToIso`/`parsePlainDate`/`subtractMonths` (`@/domain/plain-date`), `EmployeeUnavailable`, `Announcer`/`useAnnounce`, `PRIMARY_NAV_ITEMS` (the `/overdue` nav item already exists — no nav change).

## Tasks & Acceptance

**Execution (test-first where a pure module exists — red before green, Law 1):**
- [x] `tests/application/overdue-period.test.ts` + `src/application/overdue-period.ts` -- prove totality: each preset, a custom cutoff, and every hostile input (negative/zero/fractional/non-integer/unparseable/repeated-array) → default; `overduePeriodToParam` round-trips with the resolver. Then implement.
- [x] `tests/ui/overdue-vm.test.ts` + `src/ui/overdue-vm.ts` -- cover the matrix's UI arms: `answer` rows formatted + ordered as received, zero-state statement, `unavailable` heading/statement, pagination slice + clamp + status line, money fail-closed to `—`, period-label + receipts, and `buildOverdueSummary` count/unavailable. Then implement.
- [x] `tests/adapters/format-overdue-csv.test.ts` + `src/adapters/csv/format-overdue-csv.ts` -- byte-exact CSV: header, CRLF, quoting/escaping, formula-injection guard on name, money cell + blank fail-closed, provenance columns (`asOf`/`cutoff`/`period`), header-only on null/empty report. Then implement.
- [x] `src/ui/overdue-list.tsx`, `src/ui/overdue-period-control.tsx`, `src/ui/overdue-summary.tsx` -- markup/client components consuming the VM; no judgement in them.
- [x] `src/app/overdue/page.tsx` + `src/app/overdue/loading.tsx` + `src/app/api/overdue/export/route.ts` -- wire the boundary, skeleton, and export route; page and route resolve `asOf`+`period` identically.
- [x] `src/app/page.tsx` -- add the Home overdue count card at the default period, drilling to `/overdue` (the async sub-component is named `OverdueCard` to avoid a name collision with the imported `<OverdueSummary>` tile — mirrors the `PayrollSummary`→`PayrollHeadlineTile` sibling pattern; behavior as specified).

**Acceptance Criteria:**
- Given a valid `asOf` and any `period` selection, when `/overdue` renders, then it lists exactly `report.rows` (unmodified, in the received order), each showing the employee, the current record's effective date, and the salary formatted with its currency; and the visible count equals `report.rows.length`.
- Given no `period` param, when `/overdue` or the Home count renders, then the default period is 2y (24 months) and the 2y chip shows selected via `aria-pressed`.
- Given a hostile `period` param (negative/fractional/unparseable/repeated), when either the page or the export route resolves it, then both fall back to the identical default period and neither throws.
- Given `getOverdue` returns `unavailable`, when the surface or Home card renders, then a calm region-with-heading (never `role="alert"`) is shown at HTTP 200.
- Given more rows than the page size, when a page is requested (including past the end), then the effective/clamped page is rendered and prev/next + export links preserve both `asOf` and `period`.
- Given the CSV export href, when hit, then the response is `text/csv; charset=utf-8` with a UTF-8 BOM, an `attachment` disposition, `Cache-Control: no-store`, currency-carrying columns and `asOf`/`cutoff`/`period` provenance, and a header-only body on `unavailable`.
- Given the full gate: lint, typecheck, import-boundary (`src/ui` imports no adapter/app), coverage-floor, and axe all pass; the new pure modules (`overdue-period`, `overdue-vm`, `format-overdue-csv`) are unit-tested test-first.

## Spec Change Log

_Empty until the first bad_spec loopback._

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 0
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` The custom-cutoff `<input type="date">` was seeded to `''` and never synced from the URL, so a shared `?period=YYYY-MM-DD` link showed no chip selected and a blank field — the active custom period was invisible in the control (only in the list receipts). Seeded `draft` from the resolved period on load.
  - `[medium]` `[patch]` A custom cutoff LATER than the as-of was accepted unclamped, flagging the entire population as "overdue" — an asymmetry with `resolveAsOf` (which clamps future). Bounded the date picker with `max={asOf}` (threaded from the boundary as a prop); the resolver stays clock-free (Law 6). A hand-typed future-cutoff URL still yields the domain's consistent (if broad) answer by design.
  - `[low]` `[patch]` The export route read `getOverdue` then `readCurrencies` sequentially; parallelized with `Promise.all`, mirroring the page composition root.
  - `[low]` `[patch]` The export filename carried only the as-of, so two exports at the same as-of but different periods overwrote each other; added the resolved period to the filename.
  - `[low]` `[patch]` Pressing Apply with an empty custom-date field silently committed and announced the default period the user never chose; made Apply a no-op on an empty field.
  - `[low]` `[patch]` The page header comment claimed both the page and route resolve via `getAll('asOf')`, but the page uses bracket access on the RSC `searchParams`; reworded to describe the two call sites accurately (same total resolvers, identical results).
  - `[low]` `[patch]` Removed a dead `OverdueReport` type import in `overdue-vm.ts`.
- notes: Four findings rejected. CSV Period cell renders "24 months" while the screen shows "2 years" — rejected: a canonical month-count is valid, more-precise provenance for a data export, and unifying the labeler would force an `adapters → ui` import that the import-boundary lint forbids. Sticky-header `top-0` scroll-context concern — rejected: it faithfully copies the accepted sibling pattern (`outlier-findings.tsx`), not a divergence introduced here. `parsePage` name "over-promising" — rejected as a naming preference (the VM owns clamping and is tested for it). Negative-`amountMinor` CSV formula-guard gap — rejected: unreachable (the import/edit path has no negative-salary grammar) and a documented, sibling-consistent exclusion. No `intent_gap` or `bad_spec`, so no re-derivation loopback.

## Design Notes

**Why in-memory pagination.** `getOverdue` returns the whole `report.rows` list (no limit/offset echo — AD-12 computes fresh per request); adding limit/offset would change the contract (forbidden by AD-24). So the surface slices the already-loaded array by a surface-owned `?page=` param and a UI page size, rendering from the clamped page — the "effective vs requested" rule the employees directory established (`employee-directory.ts`). The pager preserves `asOf` **and** `period`; the sidebar's `navHrefWithAsOf` deliberately propagates only `asOf`, so `period` is surface-owned.

**Why one period resolver, shared by page and route.** Story 11-1's residual risk: the boundary must validate the period before constructing `OverduePeriod`; the pure core trusts an already-validated non-negative integer `months`. `resolveOverduePeriod` is the single total guard (the `resolveAsOf` discipline) and both the page and the export route call it with `getAll('period')`, so the exported file always matches the screen.

**Why Home reuses `getOverdue`.** The AD-22 hole 11-1 closed is "measure from now vs. from the as-of date". Home's count is `report.rows.length` from the same `getOverdue` at the same `asOf` and a default period — not a separate clock-reading unit — so Home and the surface cannot disagree.

**Period URL encoding** (canonical, resolver-owned): `?period=12m|18m|24m|36m` for month presets (any positive integer `Nm` accepted, chips offer four); `?period=YYYY-MM-DD` for a custom absolute cutoff. Absent/hostile → `24m`.

**Golden UI example** (`asOf` = 16 Jul 2026, `period=24m` ⇒ cutoff 16 Jul 2024, 3 overdue of 30, page 1, size 25):
```
count tile:  "3 people overdue as of 16 Jul 2026"  → drill /overdue?asOf=2026-07-16
list order:  oldest record first (as received), e.g. [hire 2019-…, 2024-07-10, 2024-07-12]
status line: "Overdue 1–3 of 3 · Page 1 of 1"
period chips: [1 year] [18 months] [2 years ✓aria-pressed] [3 years]  + custom date field
```

## Verification

**Commands:**
- `npm run test -- tests/application/overdue-period.test.ts tests/ui/overdue-vm.test.ts tests/adapters/format-overdue-csv.test.ts` -- expected: green (written test-first).
- `npm run test` -- expected: full unit/application suite green; coverage floor holds.
- `npm run typecheck && npm run lint` -- expected: clean, including the import-boundary rule (`src/ui/**` imports no `@/adapters/*` or `@/app/*`; resolvers are clock-free).
- `npm run build` -- expected: the new `/overdue` page, `loading.tsx`, and `/api/overdue/export` route compile.
- Manual/e2e (axe): `/overdue` and the Home overdue card pass the axe gate; period chips expose `aria-pressed`; recompute announces via the existing polite region; zero-state and unavailable are regions with headings, never `role="alert"`.

## Auto Run Result

Status: **done**

### Summary

Implemented CAP-10 Overdue-for-Review, frontend slice (story 11-2), consuming story 11-1's finalized `GetOverdueResult` boundary contract UNMODIFIED (AD-24). A dedicated `/overdue` surface holds a period control (preset chips 1y/18mo/2y/3y + a custom cutoff date field, all resolving to one `OverduePeriod`), a paginated list (oldest record first, salary in its own currency), a CSV export, and a hairline skeleton cold-load; Home gains a compact "N people overdue as of {date}" count linking to the surface, derived as `report.rows.length` from the SAME `getOverdue` read (never a second, clock-reading use-case — closing the AD-22 hole 11-1 guarded). The hostile `?period=` URL param is validated at the delivery boundary by one total resolver (`resolveOverduePeriod`, the `resolveAsOf` discipline), and the page and export route resolve `asOf`+`period` identically so the file always matches the screen. All judgement lives in pure, unit-tested modules (`overdue-period.ts`, `overdue-vm.ts`, `format-overdue-csv.ts`, built test-first); the `.tsx` components are markup-only.

### Files changed

- `src/application/overdue-period.ts` — NEW, pure/total: `resolveOverduePeriod` (hostile `?period=` → validated `OverduePeriod` or the 2-year default), `overduePeriodToParam` (canonical URL form), `DEFAULT_OVERDUE_PERIOD`.
- `src/ui/overdue-vm.ts` — NEW, pure: `buildOverdue` (arm select, fail-closed salary, in-memory pagination slice/clamp/status-line, receipts), `buildOverdueSummary` (Home count), constants, `PERIOD_PRESETS`, `formatOverduePeriodLabel`.
- `src/adapters/csv/format-overdue-csv.ts` — NEW, pure: RFC-4180 CSV, formula-injection guard, fail-closed money cells, `asOf`/`cutoff`/`period` provenance columns, header-only on null/empty.
- `src/ui/overdue-list.tsx`, `src/ui/overdue-period-control.tsx` (`'use client'`), `src/ui/overdue-summary.tsx` — NEW, markup/client components consuming the VMs.
- `src/app/overdue/page.tsx` — REPLACED the story 1-6 placeholder with the boundary/composition root.
- `src/app/overdue/loading.tsx` — NEW skeleton (no spinner, `aria-hidden`).
- `src/app/api/overdue/export/route.ts` — NEW CSV export Route Handler (BOM, `text/csv`, attachment, `no-store`, header-only on `unavailable`).
- `src/app/page.tsx` — added the Home overdue count card (async `OverdueCard` → `<OverdueSummary>`).
- Tests: NEW `tests/application/overdue-period.test.ts`, `tests/ui/overdue-vm.test.ts`, `tests/adapters/format-overdue-csv.test.ts` (all test-first).

### Review findings breakdown

- **Patches applied (7; medium 2, low 5):** seed the custom-cutoff field from the URL (medium); bound the date picker with `max={asOf}` against a future cutoff flagging the whole population (medium); parallelize the export route's two reads; add the period to the export filename to avoid same-as-of collisions; make Apply a no-op on an empty field; correct an inaccurate page comment about `getAll` vs bracket access; remove a dead `OverdueReport` import.
- **Deferred:** none.
- **Rejected (4):** CSV "24 months" vs screen "2 years" (canonical export provenance; unifying would force a forbidden `adapters → ui` import); sticky-header scroll-context (faithful copy of the accepted sibling pattern); `parsePage` naming (VM owns clamping, tested); negative-money CSV formula-guard (unreachable + documented sibling-consistent exclusion).

### Verification performed

- `npm run test` → 59 files / 1563 tests green (before and after the review patches; the patches touched client/route/doc code, not the tested pure-module behavior).
- Targeted new suites → 63 tests green (test-first, red before green).
- `npm run typecheck && npm run lint` → clean, including the import-boundary rule (`src/ui/**` imports no `@/adapters/*`/`@/app/*`; resolvers clock-free).
- `npm run build` → the `/overdue` page, `loading.tsx`, and `/api/overdue/export` route compile (verified during implementation).

### Residual risks

- A hand-typed `?period=<future-date>` URL still lists the entire as-of population as overdue — the domain (story 11-1, done) accepts any cutoff and returns a consistent answer; the UI guardrail (`max` on the picker) covers the common mis-pick but not a crafted URL. Clamping fully would require a change in the done backend or re-deriving policy in the boundary; left as-is by design.
- UI rendering (period chips, live-region recompute, skeleton, axe pass) is covered by Playwright/axe e2e outside the vitest suite (the repo's deliberate no-jsdom convention); the `.tsx` components carry no unit-tested logic.
