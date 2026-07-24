---
title: 'CAP-8 Gender Distribution by Level — Backend'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: 'fa431c9b2efb9f3fa513d4055f7d26b5f3f9b5d2'
final_revision: '9b88c73b70b81bdd7bad53ac5f14c3d4c8c56adb'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/docs/project-context.md', '{project-root}/docs/implementation-artifacts/epic-9-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The org has no view of how gender is distributed across levels. CAP-7 (gender gap) holds level constant and so is structurally blind to cross-level clustering — a level can look fair inside each peer group yet be heavily gender-skewed org-wide. CAP-8 must report the count of `MALE` and `FEMALE` employees at each level, across the whole organization, computed over the exact as-of population (AD-16), with SQL computing no count a user sees (AD-2).

**Approach:** Deliver the backend slice test-first, reusing primitives unchanged — the ONE `resolveCurrentSalary` (AD-8) for population membership, `Gender`, `PlainDate`, `SalaryRecordOrder`, and the `level` reference taxonomy. Add a pure domain `computeGenderDistribution` (`src/domain/gender-distribution.ts`) that folds the org-wide candidate set into per-level gender counts; a new org-wide read (`findGenderDistributionPopulation`, port + Prisma adapter, mirroring the whole-population load of `findAllPeerGroups` but carrying `gender`/`levelCode` and the canonical level axis); one use-case (`getGenderDistribution`) returning the finalized AD-20-style payload; deps wiring; and an integration test against real Postgres 18. This is a **people-counting** capability: NO median, gap, distance, currency, verdict, copy-answer, or refusal state. No page/RSC/Server Action/CSV — that is story 9-2.

## Boundaries & Constraints

**Always:**
- Obey every Law in `project-context.md`. The DB SELECTs rows only; every per-level and org-wide gender count is the cardinality of an in-memory set computed in TypeScript (AD-2, Law 2) — no `COUNT`/`GROUP BY`/`percentile_cont`/`AVG`/window function for any user-facing count.
- The as-of population defines every count (AD-16): an employee is in-population at `asOf` iff `resolveCurrentSalary(salaryRecords, asOf) !== null`. This is provably equivalent to AD-16's `hireDate ≤ asOf AND ∃ salary_record.effective_from ≤ asOf` because every write path rejects `effective_from < hire_date` (`checkSalaryEffectiveFrom`), so any record effective at/before `asOf` implies `hireDate ≤ asOf`. Reuse the ONE `resolveCurrentSalary` (AD-8); write NO second resolver and NO second membership test.
- **Count people, not records.** A person with two salary records (e.g. a same-day correction) is ONE increment in exactly one gender bucket. Membership is by person; `resolveCurrentSalary`'s AD-8 tie-break selects the current record but the count is over distinct in-population employees.
- The level axis reflects the **reference taxonomy**, not just levels that happen to have employees: enumerate every `level` row ordered by `rank` (the `level.rank` column exists to order this chart), resolved **is_active-inclusive** (is_active gates pickability for new writes, never existing statistics — an inactive level that still holds in-population employees MUST appear). A level appears in the output iff it is active OR its total in-population count `> 0`; an inactive, empty level is omitted as retired noise. Because enumeration is is_active-inclusive, every employee's `levelCode` bucket exists — no in-population person is ever silently dropped, and org-wide totals reconcile with the sum of per-level counts.
- Gender is verbatim `MALE` / `FEMALE` (closed union, DB enum). Gender is never part of any group identity here — it is the slice dimension; the group axis is `level` alone (role and country are deliberately ignored, per the SPEC).
- `asOf` is a required explicit `PlainDate` argument to every domain/application function; no `Date`/clock/random/env/settings read in `src/domain/**` or the use-case. Same data + same `asOf` ⇒ byte-identical payload.
- Answers carry receipts (Law 8 / AD-20): the result is a discriminated union `{ kind: 'answer'; distribution } | { kind: 'unavailable' }`; `distribution` carries `asOf`, `levels` (each `{ levelCode, levelLabel, maleN, femaleN, total }`, rank-ordered), and org-wide `totals { male, female, total }`. Domain functions are TOTAL; the use-case wraps repository access in `try/catch` → `{ kind: 'unavailable' }`.
- Computed fresh per request (AD-12): no materialized distribution table, no cache.
- TDD (Law 1): every domain/application function has a failing test written first; the fast suite touches no DB/clock/network. At least one adapter integration test runs against real disposable Postgres 18 (never a mock). Domain mutation testing stays at 100% (0 survivors) on `src/domain`.

**Block If:**
- `findGenderDistributionPopulation` cannot be implemented without a schema/migration change (the `level` table with `rank`/`isActive`, `employee.gender`, `employee.level_code`, and `salary_record.effective_from`/`seq` all already exist — a needed change signals an unexpected data-model gap).
- The UX/planning source is found to mandate that the CAP-8 payload ITSELF carry a **percent-female** figure, a per-level **clustering flag/warning** (with a threshold), or a composed **verdict sentence** — none is derivable here (no ratified rounding rule for a ratio, no ratified clustering threshold, no verdict phrasing), so it is a human decision, not a silent invention. (These appear only in the non-authoritative early stitch mockup, not in SPEC or the reconciled EXPERIENCE.)

**Never:**
- Never compute or emit percent-female, a "stark clustering" warning/threshold, a verdict sentence, a copy-answer string, a refusal (`n ≥ 5`) state, or a `not-found` arm (this is org-wide — there is no subject employee). None is in the ratified scope.
- Never let the DB compute a displayed count (no `COUNT`/`GROUP BY`/window/`AVG`); never count salary records instead of people; never drop an in-population employee because their level is inactive.
- Never touch money/currency/FX or compute a median/gap/distance — this capability has no monetary or ratio math.
- Never read the clock/random/settings/env inside `src/domain/**` or the use-case. No Server Action, Route Handler, CSV, page/RSC, or UI — those are story 9-2. This is read-only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Several active levels, each with in-population men and women at `asOf` | `kind:'answer'`; `levels` rank-ordered, each `{ levelCode, levelLabel, maleN, femaleN, total=maleN+femaleN }`; `totals` = org-wide sums | No error |
| Empty population | No employee in-population at `asOf` (or no data) | `answer`; active levels present at `0/0` (total 0), inactive-empty levels omitted; `totals {male:0,female:0,total:0}` — NOT a refusal | No error |
| Person with multiple records | An in-population employee with two records sharing `effectiveFrom` | Counted as ONE person in one bucket; `resolveCurrentSalary` picks greatest `(effectiveFrom, seq)` but the count is per person, not per record | No error |
| As-of rewind drops a member | A member future-hired / whose only salary is not yet effective at a past `asOf` | Excluded via `resolveCurrentSalary === null`; that level's count and `totals` recomputed lower | No error |
| Not-yet-hired / no salary | Employee with `hireDate > asOf`, or no salary record `≤ asOf` | Excluded from every count (membership is `resolveCurrentSalary !== null`) | No error |
| Level ordering | Levels with ranks out of insertion order | Output `levels` strictly ascending by `rank` | No error |
| Active empty level | An active level with zero in-population employees | Present in `levels` at `0/0` (taxonomy completeness) | No error |
| Inactive level with people | An inactive level holding ≥1 in-population employee | Present in `levels` with its real counts (is_active never hides existing statistics) | No error |
| Inactive empty level | An inactive level with zero in-population employees | Omitted from `levels` (retired, no people) | No error |
| Gender exhaustiveness | Population of only `MALE`, or only `FEMALE` | The absent gender is `0` at each level and in `totals`; both fields always present | No error |
| Repository throws | `findGenderDistributionPopulation` rejects | `getGenderDistribution` → `{ kind:'unavailable' }` | Caught; total, no exception crosses the boundary |

</intent-contract>

## Code Map

- `src/domain/salary-timeline.ts` -- REUSE `resolveCurrentSalary` (AD-8) and `SalaryRecordOrder` (`{ effectiveFrom: PlainDate; seq: bigint }`) for population membership.
- `src/domain/employee-fields.ts` -- REUSE `Gender` (`'MALE' | 'FEMALE'`, canonical).
- `src/domain/plain-date.ts` -- REUSE `PlainDate`.
- `src/domain/gender-distribution.ts` -- NEW. Pure `computeGenderDistribution(levels, candidates, asOf)`. Types `GenderDistributionCandidate = { readonly gender: Gender; readonly levelCode: string; readonly salaryRecords: readonly SalaryRecordOrder[] }`, `LevelAxisEntry = { readonly levelCode: string; readonly levelLabel: string; readonly rank: number; readonly isActive: boolean }`, `GenderLevelCount`, `GenderDistributionResult`.
- `src/application/ports/employee-repository.ts` -- ADD `findGenderDistributionPopulation(): Promise<GenderDistributionPopulation>` + `GenderDistributionPopulation = { readonly levels: readonly LevelAxisEntry[]; readonly candidates: readonly GenderDistributionCandidate[] }`. Org-wide, read-only sibling of `findAllPeerGroups`; grouping/counts stay out of SQL (AD-2/AD-16).
- `src/adapters/db/employee-repository.ts` -- IMPLEMENT `findGenderDistributionPopulation`: `level.findMany({ orderBy:{ rank:'asc' }, select:{ code,name,rank,isActive } })` (is_active-inclusive) → `levels`; `employee.findMany({ select:{ gender, levelCode, salaryRecords:{ select:{ seq, effectiveFrom } } } })` (NO where/orderBy/count/groupBy) → `candidates`; map `DateTime`→`PlainDate`.
- `src/application/use-cases/gender-distribution.ts` -- NEW. `getGenderDistribution(deps, asOf)` → the finalized `{ kind:'answer'|'unavailable' }` payload (see Design Notes). `GenderDistributionDeps = { repository: Pick<EmployeeRepository, 'findGenderDistributionPopulation'> }`.
- `src/app/employees/employee-deps.ts` -- forward `findGenderDistributionPopulation` on `lazyEmployeeRepository`; export `genderDistributionDeps()` (mirrors `outlierFindingsDeps`/`genderGapDeps`).
- `tests/domain/gender-distribution.test.ts`, `tests/application/gender-distribution.test.ts`, `tests/integration/gender-distribution.test.ts` -- NEW (test-first). Existing fake-repository test helpers widen for `findGenderDistributionPopulation`.

## Tasks & Acceptance

**Execution:**
- [x] `tests/domain/gender-distribution.test.ts` + `src/domain/gender-distribution.ts` -- test-first, then implement `computeGenderDistribution(levels: readonly LevelAxisEntry[], candidates: readonly GenderDistributionCandidate[], asOf: PlainDate): GenderDistributionResult`. For each candidate: in-population iff `resolveCurrentSalary(salaryRecords, asOf) !== null`; if so, increment `maleN`/`femaleN` for its `levelCode` (one increment per person). Build one row per `level` (rank order preserved from input), `total = maleN + femaleN`; include a level iff `isActive || total > 0`. Compute `totals { male, female, total }` over all in-population people. Pure, total, deterministic. Cover EVERY domain I/O-matrix row: multi-level happy path, empty population, multiple-records-one-person, as-of rewind, not-yet-hired/no-salary exclusion, rank ordering, active-empty, inactive-with-people, inactive-empty omission, single-gender population.
- [x] `src/application/ports/employee-repository.ts` -- add `findGenderDistributionPopulation` + `GenderDistributionPopulation`, `LevelAxisEntry`, `GenderDistributionCandidate` (import `Gender`, `SalaryRecordOrder`). Document it as a read-only org-wide sibling of `findAllPeerGroups` (gender/level-carrying); grouping and counting are the domain's, not SQL's.
- [x] `tests/application/gender-distribution.test.ts` + `src/application/use-cases/gender-distribution.ts` -- test-first against a fake port, then implement `getGenderDistribution(deps, asOf)`: `try` → `findGenderDistributionPopulation()` → `computeGenderDistribution(levels, candidates, asOf)` → `{ kind:'answer', distribution: { asOf, levels, totals } }`; `catch` → `{ kind:'unavailable' }`. No money/PlainDate serialization needed here (counts are plain numbers; `asOf` crosses as `PlainDate`, consistent with the gender-gap payload). Assert the answer shape and the throw→`unavailable` path.
- [x] `src/adapters/db/employee-repository.ts` + `src/app/employees/employee-deps.ts` -- implement `findGenderDistributionPopulation` (is_active-inclusive rank-ordered level axis; org-wide employee+salary select with no SQL grouping/count); forward it on `lazyEmployeeRepository`; add `genderDistributionDeps()`.
- [x] `tests/integration/gender-distribution.test.ts` -- against real Postgres 18: prove the sweep GROUPS BY LEVEL in TypeScript (no `GROUP BY`/`COUNT` in SQL), carries each employee's `gender`, counts PEOPLE not records (a same-day second record does not double-count), and that an as-of rewind excluding a member lowers that level's count. Prove `getGenderDistribution` yields an `answer` whose fixture levels carry the expected `maleN`/`femaleN`. **Isolation:** create only suffix-scoped fixtures (unique `role`/`level`/`country`/`currency` codes) in a RESERVED `level.rank` band `2_060_000_000–2_065_999_999` (distinct from CAP-6 `2_040M` and CAP-7 `2_050M`); assert ONLY on this run's own `levelCode`s found within the org-wide result — NEVER on global `totals` (the DB is shared and `salary_record` is undeletable). Prove an inactive level holding a fixture employee still appears with its count.

**Acceptance Criteria:**
- Given an org-wide population with in-population men and women spread across levels as of `asOf`, when `getGenderDistribution` runs, then `kind:'answer'` carries `levels` rank-ordered — each `{ levelCode, levelLabel, maleN, femaleN, total }` — plus org-wide `totals { male, female, total }` and `asOf`, every count computed in TypeScript over the exact as-of population.
- Given an employee not in the as-of population (`hireDate > asOf` or no salary record `≤ asOf`), when the sweep runs, then that person is in no count; given a person with multiple records, they are counted exactly once.
- Given the level reference taxonomy, then the level axis is enumerated is_active-inclusive and rank-ordered: an active level with no employees appears at `0/0`, an inactive level with in-population employees appears with its real counts, and an inactive empty level is omitted.
- Given an empty as-of population, the result is an `answer` (active levels at `0/0`, `totals` zero), never a refusal — CAP-8 has no `n ≥ 5` refusal state.
- Given identical data and `asOf`, when run twice, the payload is byte-identical; no clock/random/settings read appears in `src/domain/**` or the use-case.
- Given `findGenderDistributionPopulation` throws, the result is `{ kind:'unavailable' }` — no exception crosses the boundary.
- Given the full gate: lint, typecheck, import-boundary, coverage-floor (domain 100%, application ≥ 90%), and domain mutation testing (0 survivors) all pass, and the integration test is green against real Postgres 18.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[low]` `[patch]` Blind Hunter flagged an inaccurate comment in `tests/integration/gender-distribution.test.ts` — "Four distinct PEOPLE ... = 5 people" beside a `toHaveLength(5)` assertion. Corrected "Four" → "Five" (comment-only; no behavior change, gates unaffected).
- notes: Both hunters CONVERGED on one top finding — the pure `computeGenderDistribution` does not defend against an "orphan" in-population candidate whose `levelCode` is absent from the passed axis (dropped from both per-level rows and `totals`), with a narrow non-transactional `Promise.all` race (Edge #2) as the one concrete path. **Rejected** (severity low for the consumer): unreachable through the shipped wiring — `employee.level_code` is a FK to `level` and the adapter enumerates EVERY level is_active-inclusive, so the axis is always complete; the race window is microseconds under concurrent writes and self-corrects on the next fresh request (AD-12); the domain is total-by-design and its output is internally consistent (totals reconcile with the displayed rows). Structurally identical to latent items 8-1 rejected. Other 8 rejected (all low): binary-gender `total = maleN+femaleN` (Gender is a closed union at TS AND the Postgres enum — the type-exhaustive concern 8-1 also rejected); tautological determinism tests (real determinism enforced by the no-`Date`/no-random lint + import-boundary + mutation suite); O(levels×population) fold (~120k comparisons at 10k employees, sub-ms; inherent to AD-12 fresh-compute, same shape as sibling reads); boundary type re-declared in the use-case (deliberate house style — the sibling `gender-gap.ts` defines its boundary contract in the application layer too); `try` wrapping the domain compute (matches the sibling; the repo-wide AD-20 totality pattern 8-1 rejected); missing orphan-`levelCode` test (couples to the rejected orphan finding); redundant domain re-sort masking an adapter-ordering regression (the re-sort makes output correct regardless — harmless); duplicate-rank non-determinism (`level.rank` is `@unique` — defensive code for a DB-forbidden state would add an untestable branch that breaks the 100% mutation gate).

## Design Notes

**Finalized boundary contract (story 9-2 consumes unmodified):**

```ts
export type GetGenderDistributionResult =
  | { readonly kind: 'answer'; readonly distribution: GenderDistribution }
  | { readonly kind: 'unavailable' };

type GenderDistribution = {
  readonly asOf: PlainDate;
  readonly levels: readonly GenderLevelCount[];   // rank-ordered; a level appears iff active OR total > 0
  readonly totals: { readonly male: number; readonly female: number; readonly total: number };
};

type GenderLevelCount = {
  readonly levelCode: string;
  readonly levelLabel: string;    // level.name, is_active-inclusive
  readonly maleN: number;
  readonly femaleN: number;
  readonly total: number;         // maleN + femaleN
};
```

**Why no refusal / verdict / copy-answer.** The ratified SPEC and reconciled EXPERIENCE define CAP-8 as "gender counts per level" exposed as a data table — a knowing-tool surface, not a single judgement. The verdict sentence and copy-answer are properties of the peer-comparison card (CAP-5/CAP-7), not this org-wide distribution. There is no `n ≥ 5` gate — an empty distribution is a valid answer of zeros. So the union is `answer | unavailable` only (no `refusal`, no `not-found` — there is no subject employee).

**Why membership is `resolveCurrentSalary !== null`.** AD-16 membership is `hireDate ≤ asOf AND ∃ salary_record.effective_from ≤ asOf`. The write-path invariant `effective_from ≥ hire_date` (`checkSalaryEffectiveFrom`, enforced on form/import/record-change) makes the salary clause imply the hire clause, so `resolveCurrentSalary(records, asOf) !== null` is exactly AD-16 — the identical test the sibling CAP-7 uses. Reusing it avoids a second membership predicate.

**Why the level axis is is_active-inclusive.** Enumerating every level guarantees each in-population employee's `levelCode` has a bucket (no orphan can be silently dropped) and honors "is_active never hides existing statistics." The `active OR total > 0` output filter then drops only retired, empty levels. `level.rank` (UNIQUE int, doc-commented "orders the gender-distribution-by-level chart") is the axis order.

**Golden domain example:**

```ts
// levels: [L1(rank 1,active), L2(rank 2,active), LX(rank 9,inactive)]
// in-population: L1 → 3 MALE, 2 FEMALE · L2 → 1 FEMALE · LX → 0
// → levels: [ {L1, m:3, f:2, total:5}, {L2, m:0, f:1, total:1} ]   // LX omitted (inactive+empty)
// → totals: { male: 3, female: 3, total: 6 }
```

## Verification

**Commands:**
- `npm run test -- tests/domain/gender-distribution.test.ts tests/application/gender-distribution.test.ts` -- expected: all green (written test-first).
- `npm run test` -- expected: full unit/application suite green; coverage floor holds (domain 100%, application ≥ 90%).
- `npm run test:mutation` -- expected: no surviving mutant over `src/domain` (membership filter, per-level bucketing, `active OR total>0` filter, totals).
- `npm run typecheck` && `npm run lint` -- expected: clean, including the import-boundary rule (domain imports nothing outward; app imports only domain).
- `npm run test:integration -- tests/integration/gender-distribution.test.ts` -- expected: green against Postgres 18 (`DATABASE_URL` + `DATABASE_URL_APP` set).

## Auto Run Result

Status: **done**

### Summary
Implemented CAP-8 (gender distribution by level), backend slice, fully test-first. `getGenderDistribution(deps, asOf)` folds the ORG-WIDE candidate set into per-level gender counts over the exact as-of population (AD-16): an employee is in-population iff `resolveCurrentSalary(salaryRecords, asOf) !== null` — the ONE resolver (AD-8), the identical membership test the sibling CAP-7 uses, provably equivalent to AD-16 given the enforced `effective_from ≥ hire_date` invariant. It counts distinct PEOPLE (a person with two same-day records is one increment), splits by `MALE`/`FEMALE`, and enumerates the level axis from the reference taxonomy is_active-inclusive, rank-ordered — emitting a level iff it is active OR holds an in-population person (an inactive level with people still appears; a retired empty level is omitted). Every count is computed in TypeScript (AD-2) — no SQL `COUNT`/`GROUP BY`. The answer crosses the boundary carrying its receipts as `{ kind:'answer', distribution: { asOf, levels, totals } } | { kind:'unavailable' }` — no refusal/not-found/verdict/copy-answer/percent-female/clustering, none of which is in the ratified CAP-8 scope. The finalized payload is ready for story 9-2, which consumes it unmodified.

### Files changed
- `src/domain/gender-distribution.ts` (new) — pure, total `computeGenderDistribution(levels, candidates, asOf)`; membership via the ONE `resolveCurrentSalary`, per-level people counts, `isActive || total>0` filter, org-wide totals. Types `GenderDistributionCandidate`/`LevelAxisEntry`/`GenderLevelCount`/`GenderDistributionResult`.
- `src/application/use-cases/gender-distribution.ts` (new) — `getGenderDistribution`, the finalized `answer | unavailable` payload; `try/catch` → `unavailable`.
- `src/application/ports/employee-repository.ts` — added `findGenderDistributionPopulation` + `GenderDistributionPopulation` (read-only org-wide sibling of `findAllPeerGroups`).
- `src/adapters/db/employee-repository.ts` — implemented `findGenderDistributionPopulation` (is_active-inclusive rank-ordered `level.findMany`; org-wide `employee.findMany` selecting gender/levelCode/salaryRecords{seq,effectiveFrom} with no where/orderBy/COUNT/GROUP BY; DateTime→PlainDate).
- `src/app/employees/employee-deps.ts` — forwarded the method on `lazyEmployeeRepository`; added `genderDistributionDeps()`.
- Tests (new): `tests/domain/gender-distribution.test.ts` (14), `tests/application/gender-distribution.test.ts` (6), `tests/integration/gender-distribution.test.ts` (3; real Postgres 18, reserved `level.rank` band `2_060_000_000–2_065_999_999`, asserts only on its own suffix-scoped levels). Eight existing fake-repository test helpers widened for the new port method.

### Review findings breakdown
- **Patches applied (1, low):** corrected an inaccurate comment in the integration test ("Four" → "Five" distinct people) flagged by Blind Hunter — comment-only, no behavior change.
- **Deferred (0).**
- **Rejected (9, all low):** the two hunters' convergent top finding — the pure domain not defending an orphan `levelCode` (dropped from rows + totals), with a non-transactional `Promise.all` race as its one concrete path — rejected as unreachable through the shipped wiring (FK + is_active-inclusive complete axis; the race is a self-correcting microsecond window under AD-12 fresh-compute; domain is total-by-design with internally-consistent output). Plus: binary-gender `total` (type-closed union + DB enum), tautological determinism tests (determinism enforced by lint + import-boundary + mutation), O(levels×population) fold (sub-ms at 10k, AD-12-inherent), boundary type re-declared in the use-case (house style, matches sibling), `try` wrapping the domain compute (repo-wide AD-20 pattern), missing orphan test (couples to the rejected finding), redundant re-sort (output correct regardless), duplicate-rank non-determinism (`level.rank` `@unique` — a DB-forbidden state).

### Verification performed
- `npm run test` (full unit/application) — **48 files, 1380 passed**.
- `npm run test:coverage` — domain 100%, application ≥ 90% (floor holds).
- `npm run test:mutation` — **100.00%, 0 survivors** over `src/domain` (`gender-distribution.ts` 47 killed / 0 survived).
- `npm run typecheck` — clean. `npm run lint` — clean (import-boundary held: `src/domain` imports nothing outward).
- `npm run test:integration -- tests/integration/gender-distribution.test.ts` — **3 passed** against real PostgreSQL 18 (TS-side grouping with no SQL GROUP BY/COUNT, gender carried, people-not-records counting, as-of rewind lowering a count, inactive-level-with-people still appearing). Full integration suite — **12 files, 137 passed** (no regressions).

### Residual risks
None material. The convergent orphan-`levelCode` finding is unreachable through the shipped adapter and self-correcting under AD-12; if story 9-2 or any future caller ever passes a partial level axis to `computeGenderDistribution`, it should pass the complete taxonomy the adapter provides. The finalized boundary contract is ready for story 9-2, which renders the per-level bar chart, the Home pulse, and the counts data table, adding nothing to the contract.
