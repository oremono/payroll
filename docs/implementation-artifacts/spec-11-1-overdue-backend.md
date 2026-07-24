---
title: 'CAP-10 Overdue for Review — Backend'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: 'c53686a2054d0520266e8893409d278532a8a4cd'
final_revision: 'c34ed140b18843ee8e39bc97c14a5d13896f6871'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/docs/project-context.md', '{project-root}/docs/implementation-artifacts/epic-11-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The org has no way to find employees whose pay has gone stale — those whose most-recent salary record predates a chosen period (e.g. "no change in 2 years"), measured back from the as-of date. This is CAP-10, and it is the **last unguarded edge of the determinism promise** (AD-22): unless the cutoff derives from the passed as-of date rather than the wall clock, winding the as-of date back will not reproduce a prior day's overdue list, and Home's count becomes clock-dependent.

**Approach:** Deliver the backend slice test-first, reusing primitives unchanged — the ONE `resolveCurrentSalary` (AD-8) for population membership and the current record, `Money`/`BoundaryMoney`/`toBoundaryMoney`, `CurrencyFormat`, and `PlainDate`. Add: a pure `subtractMonths(date, months)` calendar helper in `src/domain/plain-date.ts` (day-clamps into short months, e.g. 29 Feb − 1y → 28 Feb); a pure `src/domain/overdue.ts` orchestrator that resolves the cutoff from `asOf` and the selected period, keeps only the as-of population, and lists those whose current record is **strictly earlier** than the cutoff; a dedicated read `findOverduePopulation`; one use-case `getOverdue` returning the finalized AD-20 payload; and deps wiring plus an integration test against real Postgres 18. **No page/RSC/Server Action/CSV export/Home metric/UI — that is story 11-2.** No verdict sentence, no copy-answer, no FX/conversion.

## Boundaries & Constraints

**Always:**
- Obey every Law in `project-context.md`. `src/domain/**` and the use-case read no `Date`/clock/random/env/Prisma/`fs`; same data + same `asOf` + same period ⇒ byte-identical payload (Law 6 / AD-1 / AD-11).
- The cutoff is `asOf − period`, **derived from the passed `asOf`, never the wall clock** (AD-22). The derivation lives inside the pure layer (`src/domain/overdue.ts`), so the shell cannot substitute a today-derived cutoff.
- An employee **in the as-of population** (AD-16) is overdue **iff** the `effectiveFrom` of their as-of current record is **strictly earlier** than the cutoff; a record dated **exactly on** the cutoff is **not** overdue (AD-22).
- "Most recent salary record" = the record with the greatest `(effectiveFrom, seq)` where `effectiveFrom ≤ asOf`, via the ONE existing `resolveCurrentSalary` (AD-8). No new ordering, no new `ORDER BY`.
- Membership = the as-of population: an employee with no record in force at `asOf` (`resolveCurrentSalary === null`) appears in **no** row and **no** count — no refusal row on this list surface (AD-16 refusal semantics are for the single-subject CAP-5 card).
- **A hire record IS a salary record** (AD-22): a hire-only employee whose hire predates the cutoff **is** overdue — the finding CAP-10 exists to surface. Never special-case hire-only employees out.
- Period arithmetic is calendar-based; a day absent in the target month **clamps to that month's last day** (29 Feb − 1y = 28 Feb) (AD-22, M-5).
- Every salary crosses the boundary as `BoundaryMoney` (integer minor units + ISO-4217 code); no amount without its currency (Law 4 / AD-4). The DB SELECTs rows only — no `WHERE` for membership, no `COUNT`/`ORDER BY`/`SUM` for any user-facing figure (Law 2 / AD-2 / AD-8 / AD-16).
- TDD (Law 1): a failing test precedes each domain/application function; the fast suite touches no DB/clock/network. At least one adapter integration test runs against real disposable Postgres 18, never a mock (AD-23 / AD-24).
- The finalized `GetOverdueResult` payload is the contract story 11-2 consumes **unmodified** (AD-24).

**Block If:**
- `findOverduePopulation` cannot be implemented without a schema/migration change (`employee`, `salary_record`, and every column it reads — `id`, `name`, `seq`, `effective_from`, `amount_minor`, `currency_code` — already exist; a needed change signals an unexpected data-model gap).
- A planning source is found to mandate a **refusal row per salary-less employee** on the Overdue **list** surface, contradicting the silent-exclusion reading (the Overdue surface's only non-list state is the zero-state "No one is overdue for review within the selected period").

**Never:**
- No page/RSC, Server Action, CSV route/formatter, Home-metric wiring, or any UI — those are story 11-2. This story is read-only backend.
- No clock/`Date`/random/env read in `src/domain/**` or the use-case; no wall-clock-derived cutoff (the AD-22 hole).
- No second current-salary resolver, no new `(effectiveFrom, seq)` `ORDER BY`, no SQL `SUM`/`COUNT`/`GROUP BY`/window for any user-facing figure or for membership.
- No FX/conversion/cross-currency comparison — each row's salary stands in its own currency. No aggregate that would require a rate.
- No write path, no mutation, no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Some overdue | Population with mixed record dates; `asOf`, period 2y | `answer` with `rows` = employees whose current record `effectiveFrom < cutoff`, oldest record first; each carries `{employeeId, name, effectiveFrom, salary(+currency)}` | No error |
| On-cutoff exactness | Current record `effectiveFrom` == cutoff | **Excluded** (strictly-earlier only) | No error |
| Just before cutoff | Current record one day before cutoff | Included (overdue) | No error |
| Hire-only overdue | Employee with a single hire record long before the cutoff, no later change | Overdue — a hire record is a salary record | No error |
| Out of population | Employee hired after `asOf`, or no record with `effectiveFrom ≤ asOf` | Excluded from rows **and** count; no refusal row | No error |
| Multiple records | Employee with several records | Overdue judged on the **current** record (greatest `(effectiveFrom, seq) ≤ asOf`), not the oldest/newest-ever | No error |
| As-of rewind | Same data, earlier `asOf` | Cutoff and membership recomputed from that `asOf`; identical inputs ⇒ identical payload | No error |
| Custom cutoff date | period = `{kind:'date', cutoff}` | Rows measured against that cutoff by the same strictly-earlier rule; `asOf` still governs membership | No error |
| Leap-day period | `asOf` = 29 Feb (leap), period 1y | Cutoff clamps to 28 Feb of the prior year | No error |
| Empty / none overdue | No candidates in population, or all current records `≥` cutoff | `answer` with `rows: []` (zero-state), never `unavailable` | No error |
| Repository throws | `findOverduePopulation` rejects | `{ kind: 'unavailable' }` | Caught; no exception crosses the boundary |

</intent-contract>

## Code Map

- `src/domain/plain-date.ts` -- ADD, pure. `subtractMonths(date: PlainDate, months: number): PlainDate` reusing the existing private `daysInMonth`/`isLeapYear` for day-clamping. `PlainDate`, `comparePlainDate`, `parsePlainDate`, `plainDateToIso` REUSED unchanged.
- `src/domain/salary-timeline.ts` -- REUSE `resolveCurrentSalary<T>(records, asOf)` (AD-8) and `SalaryRecordView`/`SalaryRecordOrder`. No changes.
- `src/domain/money.ts` -- REUSE `Money`, `BoundaryMoney`, `toBoundaryMoney`.
- `src/domain/overdue.ts` -- NEW, pure. `OverduePeriod` (`{kind:'months'; months} | {kind:'date'; cutoff}`), `OverdueCandidate = {employeeId, name, salaryHistory: SalaryRecordView[]}`, domain `OverdueRow` (Money-typed), and `computeOverdue({candidates, asOf, period}): {cutoff: PlainDate; rows: readonly OverdueRow[]}` — resolve cutoff, filter to population via `resolveCurrentSalary`, keep strictly-earlier, order oldest-first then `employeeId` byte-wise.
- `src/application/ports/employee-repository.ts` -- ADD `findOverduePopulation(): Promise<OverduePopulation>` to the port; import `OverdueCandidate` from `@/domain/overdue` and define `OverduePopulation = { candidates: readonly OverdueCandidate[] }` (candidates carry `name` + whole UNORDERED `salaryHistory`) — the same "domain owns the candidate type, port re-exports it" split as `PayrollCandidate`/`GenderDistributionCandidate`.
- `src/adapters/db/employee-repository.ts` -- IMPLEMENT `findOverduePopulation`: `client.employee.findMany({ select:{ id, name, salaryRecords:{ select:{ id, seq, effectiveFrom, amountMinor, currencyCode }}}})` — NO `where`/`orderBy`/`count`; map rows to `SalaryRecordView` via the existing `fromDbDate`, exactly as `findPayrollTotalsPopulation` does (plus `id` + `name`).
- `src/application/use-cases/overdue.ts` -- NEW. `getOverdue(deps, asOf, period)`: one read → `computeOverdue` → encode each `Money` to `BoundaryMoney` → attach `asOf`/`cutoff`/`period` receipts; `try/catch` → `{kind:'unavailable'}`. Declares the finalized `GetOverdueResult`/`OverdueReport`/boundary `OverdueRow`/`OverdueDeps`.
- `src/app/employees/employee-deps.ts` -- ADD `overdueDeps()` factory (lazy repository, mirroring `payrollTotalsDeps()`); story 11-2 consumes it unmodified.
- `tests/domain/plain-date.test.ts` -- ADD `subtractMonths` cases (12/18/24/36-month presets, Feb-29 clamp both leap directions). Test-first.
- `tests/domain/overdue.test.ts` -- NEW (test-first). Cover EVERY domain I/O-matrix row.
- `tests/application/overdue.test.ts` -- NEW (test-first). Orchestration, `unavailable` on throw, Money→BoundaryMoney, receipts.
- `tests/integration/overdue.test.ts` -- NEW. Real Postgres 18.

## Tasks & Acceptance

**Execution:**
- [x] `tests/domain/plain-date.test.ts` + `src/domain/plain-date.ts` -- test-first, then implement `subtractMonths` (calendar month subtraction with day-clamp into short months; total, pure, deterministic). Cover the leap-day and preset rows of the matrix.
- [x] `tests/domain/overdue.test.ts` + `src/domain/overdue.ts` -- test-first, then implement `computeOverdue` and `OverduePeriod`/`OverdueCandidate`/`OverdueRow`. Cutoff via `subtractMonths` (or the custom date), membership via `resolveCurrentSalary !== null`, overdue via `comparePlainDate(current.effectiveFrom, cutoff) < 0`, oldest-first ordering with a byte-wise `employeeId` tie-break. Cover EVERY domain matrix row: some-overdue, on-cutoff, just-before, hire-only, out-of-population, multiple-records, custom-cutoff, leap-day, none/empty. Pure, total, deterministic.
- [x] `src/application/ports/employee-repository.ts` + `src/adapters/db/employee-repository.ts` -- add `findOverduePopulation` to the port and implement it (SELECT rows only, no membership `WHERE`/`ORDER BY`/`COUNT`; map to domain shapes).
- [x] `tests/application/overdue.test.ts` + `src/application/use-cases/overdue.ts` -- test-first, then implement `getOverdue` returning the finalized `GetOverdueResult`. Prove: `asOf`/`cutoff`/`period` receipts attached, every `Money` encoded to `BoundaryMoney`, and ANY repository throw → `{kind:'unavailable'}` (no exception crosses the boundary).
- [x] `src/app/employees/employee-deps.ts` -- add `overdueDeps()` (lazy repository), mirroring `payrollTotalsDeps()`.
- [x] `tests/integration/overdue.test.ts` -- against real Postgres 18: seed (via the real `createEmployee`/`recordSalaryChange` use-cases) a hire-only employee dated before the cutoff, a recently-changed employee, and one on the cutoff exactly; assert membership/overdue/ordering are computed in TypeScript (no SQL `COUNT`/`ORDER BY`) and the hire-only employee surfaces as overdue. **Isolation:** create only suffix-scoped fixtures (`randomUUID().slice(0,8)`); never truncate the append-only `salary_record`/`employee` tables; never mutate `settings`.

**Acceptance Criteria:**
- Given a population at `asOf` with a chosen period, when `getOverdue` runs, then `kind:'answer'` carries `report = { asOf, cutoff, period, rows }` where each row is `{ employeeId, name, effectiveFrom, salary: BoundaryMoney }`, ordered oldest record first then `employeeId` ascending, and every listed employee's current record `effectiveFrom` is strictly earlier than `cutoff`.
- Given an employee whose current record `effectiveFrom` equals the cutoff, then they are **absent** from `rows` and from any count derived from `rows`.
- Given a hire-only employee whose hire predates the cutoff, then they are present in `rows` (a hire record is a salary record); given an employee with no record in force at `asOf`, then they are absent with no refusal row.
- Given the same data and the same `asOf` and period, when `getOverdue` runs twice, then the two payloads are byte-identical (cutoff derived from `asOf`, never the clock); winding `asOf` back recomputes membership and cutoff for that date.
- Given `asOf` = 29 Feb of a leap year and a 1-year period, then `cutoff` = 28 Feb of the prior year.
- Given any repository throws, then the result is `{ kind:'unavailable' }` — no exception crosses the boundary.
- Given the full gate: lint, typecheck, import-boundary, coverage-floor (domain 100%, application ≥ 90%), and domain mutation testing (0 survivors over `src/domain`) all pass, and the integration test is green against real Postgres 18.

## Spec Change Log

_Empty until the first bad_spec loopback._

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 6
- addressed_findings:
  - `[low]` `[patch]` `subtractMonths` could emit `year < FIRST_YEAR` (e.g. an `?asOf=0001-…` URL minus a preset period → year 0), breaching the module's own proleptic-calendar invariant — added a clamp to `0001-01-01` plus an exclusive-`<`-boundary test; the `months` non-negative-integer precondition is documented as the delivery boundary's responsibility (same discipline as `resolveAsOf`). Domain mutation floor held at 100%.
  - `[low]` `[patch]` `OverduePopulation` port JSDoc named the wrong field (`rows: []` vs the type's `candidates`) — corrected to distinguish the population input from the domain's `rows` output.
  - `[low]` `[patch]` fast-suite determinism tests reused the same input reference and never rewound `asOf` — strengthened to distinct value-equal inputs and added a domain-level as-of-rewind test proving the cutoff **and** membership recompute from `asOf` (the AD-22 promise), no longer only behind the DB-gated integration suite.
- notes: Six findings rejected as by-design or out-of-scope: the bare `months: number` contract type and the missing negative/fractional guard (boundary validates hostile period input before it reaches the pure core, exactly as `resolveAsOf` does — noted under Residual Risks for story 11-2); the unbounded whole-table `findOverduePopulation` read (AD-12 accepts the full-set load per sweep, mirrors `findPayrollTotalsPopulation`); `getOverdue`'s whole-body `try/catch` (matches the sibling `getPayrollTotals`; the domain is total); `compareOverdueRows`'s unreachable-through-sort `0` arm (pinned directly, the house mutation-gate convention); and the integration fixtures' suffix-scoped codes (the shared, accepted test-infra pattern; collision probability negligible). No `intent_gap` or `bad_spec`, so no re-derivation loopback.

## Design Notes

**Finalized boundary contract (story 11-2 consumes unmodified):**

```ts
// src/domain/overdue.ts
export type OverduePeriod =
  | { readonly kind: 'months'; readonly months: number } // presets 12 | 18 | 24 | 36 (any positive int)
  | { readonly kind: 'date'; readonly cutoff: PlainDate }; // custom absolute cutoff

// src/application/use-cases/overdue.ts
export type OverdueRow = {
  readonly employeeId: string;
  readonly name: string;
  readonly effectiveFrom: PlainDate;      // the record that makes them overdue
  readonly salary: BoundaryMoney;         // AD-4: currency always present
};
export type OverdueReport = {
  readonly asOf: PlainDate;
  readonly cutoff: PlainDate;             // resolved; rows are strictly earlier than this
  readonly period: OverduePeriod;         // echoed for display/provenance
  readonly rows: readonly OverdueRow[];   // oldest record first, then employeeId ascending
};
export type GetOverdueResult =
  | { readonly kind: 'answer'; readonly report: OverdueReport }
  | { readonly kind: 'unavailable' };
```

**Why the cutoff is resolved inside the pure layer.** The AD-22 determinism hole (review F-8 / round-2 N-2) is that the shell could pass a today-derived cutoff and nothing would object. `computeOverdue` takes the `period` selection and derives the cutoff from the passed `asOf` itself, so a wall-clock cutoff is structurally impossible — the shell only supplies `asOf` (already a resolved `PlainDate`) and the selection. The preset chip and the custom date "resolve to the same cutoff by the same rule" (AD-22): both produce one `cutoff`, and the strictly-earlier comparison is the only overdue code path.

**Why Home's count is not a separate use-case.** Round-2 flagged a `home-overdue-summary` unit that could compute `cutoff = today − 1y`. This spec ships exactly ONE read; Home (story 11-2) derives its count as `report.rows.length` from `getOverdue` at the same `asOf`, so the two placements cannot disagree. The default period a surface picks is a boundary concern (story 11-2), like `asOf` defaulting to today at the boundary.

**Why salary-less employees are silently excluded (no refusal row).** AD-16's `no salary as of D` refusal is written for CAP-5's single-subject card. On a list surface the equivalent is simple absence: an out-of-population employee is in no row and no count. The Overdue surface's only non-list state is the zero-state.

**Golden domain example** (`asOf` = 16 Jul 2026, period `{kind:'months', months:24}` ⇒ `cutoff` = 16 Jul 2024):

```
A: current record 10 Jul 2024  → 10 Jul 2024 < 16 Jul 2024 → OVERDUE
B: current record 16 Jul 2024  → equal to cutoff          → not overdue
C: hire 2019, no later change   → 2019 < cutoff            → OVERDUE (hire is a salary record)
D: hired 2026-08 (after asOf)   → resolveCurrentSalary null → excluded (not in population)
rows (oldest first): [C (2019-..), A (2024-07-10)]
```

`subtractMonths({2028,2,29}, 24) → {2026,2,28}` (28 Feb 2026); `subtractMonths({2026,7,16}, 18) → {2025,1,16}`.

## Verification

**Commands:**
- `npm run test -- tests/domain/plain-date.test.ts tests/domain/overdue.test.ts tests/application/overdue.test.ts` -- expected: all green (written test-first).
- `npm run test` -- expected: full unit/application suite green; coverage floor holds (domain 100%, application ≥ 90%).
- `npm run test:mutation` -- expected: no surviving mutant over `src/domain` (`overdue.ts`, `subtractMonths`).
- `npm run typecheck && npm run lint` -- expected: clean, including the import-boundary rule (`src/domain` imports nothing outward; the use-case imports only domain + ports).
- `npm run test:integration -- tests/integration/overdue.test.ts` -- expected: green against Postgres 18 (`DATABASE_URL` + `DATABASE_URL_APP` set).

## Auto Run Result

Status: **done**

### Summary

Implemented CAP-10 Overdue-for-Review, backend slice, fully test-first. `getOverdue(deps, asOf, period)` reports, over the exact as-of population (AD-16, membership via the ONE `resolveCurrentSalary`, AD-8), every employee whose current salary record is **strictly earlier** than the cutoff, ordered oldest record first then `employeeId` ascending. The cutoff is `asOf − period` derived inside the pure core (`subtractMonths` for month presets, or a custom absolute cutoff) — never the wall clock — closing AD-22's last-unguarded-edge determinism hole by construction: the shell supplies only the already-resolved `asOf` and the selection, so a today-derived cutoff is structurally impossible. A hire record counts as a salary record (hire-only employees surface as overdue); out-of-population employees are silently excluded (no refusal row on this list surface). Each row crosses the boundary as `BoundaryMoney` (AD-4). The finalized `GetOverdueResult` payload is ready for story 11-2, which consumes it unmodified; Home derives its count as `report.rows.length` from the same read (no separate clock-reading use-case).

### Files changed

- `src/domain/plain-date.ts` — added pure `subtractMonths` (calendar month subtraction, day-clamp into short months via the existing `daysInMonth`/`isLeapYear`, and a `FIRST_YEAR` floor clamp).
- `src/domain/overdue.ts` — NEW pure core: `OverduePeriod`, `OverdueCandidate`, domain `OverdueRow`, `computeOverdue`, exported `compareOverdueRows`.
- `src/application/use-cases/overdue.ts` — NEW: `getOverdue` + finalized boundary types (`GetOverdueResult`/`OverdueReport`/boundary `OverdueRow`/`OverdueDeps`).
- `src/application/ports/employee-repository.ts` — added `findOverduePopulation` + `OverduePopulation`, re-exporting `OverdueCandidate`.
- `src/adapters/db/employee-repository.ts` — implemented `findOverduePopulation` (SELECT rows only; no `where`/`orderBy`/`COUNT`).
- `src/app/employees/employee-deps.ts` — added `overdueDeps()` (lazy repository).
- Tests: NEW `tests/domain/overdue.test.ts`, `tests/application/overdue.test.ts`, `tests/integration/overdue.test.ts`; extended `tests/domain/plain-date.test.ts`. Nine pre-existing full-repository test fakes gained a `findOverduePopulation` stub (the widened port required it).

### Review findings breakdown

- **Patches applied (3, all low):** `subtractMonths` year-underflow clamp to `0001-01-01` (+ exclusive-boundary test); corrected `OverduePopulation` port JSDoc field name; strengthened fast-suite determinism tests (distinct value-equal inputs + a domain-level as-of-rewind test).
- **Deferred:** none.
- **Rejected (6):** bare `months: number` contract type + missing negative/fractional guard (boundary validates hostile input, per AD-11/`resolveAsOf`); unbounded whole-table read (AD-12 by-design); whole-body `try/catch` (matches `getPayrollTotals`); `compareOverdueRows` `0` arm (pinned house convention); integration fixture suffix-scoped codes (accepted shared test-infra pattern).

### Verification performed

- `npm run test` → 56 files / 1499 tests green.
- `npm run test:coverage` → exit 0; floors hold (domain 100%, application ≥ 90%; branch 99.51% global).
- `npm run test:mutation` (scoped to the two changed domain files) → **100%, 0 survivors** (`overdue.ts` 37 killed, `plain-date.ts` 133 killed).
- `npm run typecheck && npm run lint` → clean (import-boundary rule included).
- `npm run test:integration -- tests/integration/overdue.test.ts` → 2 tests green against real Postgres (DB URLs present in `.env`).

### Residual risks

- **Story 11-2 must validate the period URL param at the boundary** before constructing `OverduePeriod` — map only the presets (12/18/24/36 months) or a parsed custom cutoff date, rejecting negative/fractional/non-integer months. The pure core trusts an already-validated non-negative-integer `months` (the `resolveAsOf` discipline); it emits a valid `PlainDate` for any finite input but does not itself reject an out-of-contract period. The `FIRST_YEAR` clamp bounds the underflow direction regardless.
- The `findOverduePopulation` full-set read is O(all salary records) per request by design (AD-12); it inherits the same scale posture as the other capability reads.
