---
title: 'CAP-5 Peer Comparison or Refusal — Backend'
type: 'feature'
created: '2026-07-23'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'c260d495e2640f7520d2b79c713f2ed677a9161a'
final_revision: 'edfbecb239bfed238c863a9bc303ee9d532892f8'
context: ['{project-root}/docs/project-context.md', '{project-root}/docs/implementation-artifacts/epic-6-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** An HR manager cannot yet see where an employee sits relative to peers. CAP-5 must answer, for a `(role, level, country)` peer group of 5+, the group median, the min–max spread, and the subject's signed distance from the median — every figure carrying its receipts — and must return a dignified explicit refusal (naming the peer count) when the group is thinner than 5, never widening the group and never erroring.

**Approach:** Deliver the backend slice test-first: a canonical median + spread statistic (`src/domain/statistics.ts`), the signed-distance and peer-grouping logic (`src/domain/peer-comparison.ts`), the single verdict-sentence composer (`src/domain/verdict.ts`), a use-case (`src/application/use-cases/peer-comparison.ts`) returning the finalized `answer | refusal` boundary payload, and a new repository read for the as-of peer population (port + Prisma adapter) with an integration test against real Postgres 18. This establishes the median, distance, refusal, and verdict primitives that CAP-6 and CAP-7 reuse.

## Boundaries & Constraints

**Always:**
- Obey every Law in `project-context.md`. The database SELECTs the peer set; the median, spread, and distance are computed in-process — no `percentile_cont`/`AVG`/window function produces any user-facing value.
- Exactly ONE median (`src/domain/statistics.ts`, AD-3): sort ascending by integer minor units; odd `n` → middle; even `n` → mean of the two middle, rounded half-up via `divideRoundHalfUp`. A median of an empty set is never computed (return `null`; the caller gates on `n ≥ 5`). Reuse the ONE current-salary resolver `resolveCurrentSalary` (AD-8) — write no second `ORDER BY`.
- Distance is signed for display, exact for arithmetic (AD-5): `d = (salary − median) / median × 100` computed over `bigint` minor units (never IEEE double), magnitude rounded half-up to ONE decimal, then the sign reapplied. The number shown is the number judged.
- The as-of population defines the peer group (AD-16): a candidate is in-population at `asOf` iff it has a salary record with `effectiveFrom ≤ asOf` (equivalently a non-null `resolveCurrentSalary`, since `effectiveFrom ≥ hireDate` is DB-enforced). Peer group = every in-population employee sharing the subject's CURRENT `(roleCode, levelCode, countryCode)`, subject included. `n` is the cardinality of that exact set — never a `COUNT` query. `MIN_PEER_GROUP_SIZE = 5` is a fixed domain constant (AD-16), NOT the settings outlier threshold.
- Money never bare (AD-4): the statistic operates on `Money.amountMinor` bigints in the group's single currency; every monetary field crosses the boundary as `BoundaryMoney` (decimal string) via `toBoundaryMoney`. `distancePct` crosses as a signed one-decimal string. The group is single-currency by construction (country immutable, currency follows country) — no FX anywhere in this epic.
- Determinism (Law 6): `asOf` is a required explicit parameter threaded inward; no `Date`/clock/random in `src/domain/**` or `src/application/**`. Same data + same `asOf` ⇒ identical payload.
- The answer crosses the boundary as a discriminated union carrying its receipts (Law 8 / AD-20): value + provenance (peerGroup, `n`, `asOf`, currency) in one object; a refusal is a return value carrying its counts, never an exception. Domain functions are TOTAL. Exactly one verdict sentence, composed by `src/domain/verdict.ts` and included in the payload unmodified for both card and copy-answer to consume; refusal is a full citizen and carries its sentence too.
- Reference labels for the verdict (role/level/country display names and the currency `CurrencyFormat`) must be resolved WITHOUT filtering on `is_active` — `is_active` gates pickability, never visibility of an existing employee's statistics or labels.
- TDD (Law 1): every domain/application function has a failing test written first; the fast suite touches no DB, clock, or network. At least one adapter integration test runs against real disposable Postgres 18 (never a mock).

**Block If:**
- The DESIGN/UX source mandates a gendered possessive ("her/his peer median") in the verdict rather than the neutral "the peer median" used here, AND resolving it requires a pronoun-inference rule not derivable from the `MALE`/`FEMALE` gender value. (Proceed with neutral phrasing otherwise.)
- Implementing the peer-population read cannot be done without a schema/migration change (the `(roleCode, levelCode, countryCode)` index and reference tables already exist — a change would signal an unexpected data-model gap).

**Never:**
- Never widen a peer group below `n ≥ 5`; never compute over an empty set; never return `n = 0` arithmetic for a subject with no salary as of `asOf` (that is a distinct refusal).
- Never a second median, second current-salary resolver, or second verdict sentence. Never materialize/cache a peer group or findings — compute fresh per request; no peer-group table.
- Never convert currencies or read `employee.country` to re-resolve currency at read time. Never let the DB compute a displayed statistic. No Server Action, Route Handler, or mutation — this is a read-only capability.
- No frontend/UI work — that is story 6-2, which consumes this payload unmodified.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Peer group ≥ 5 (odd n) | Subject in a triple with 5 in-population peers | `{ kind: 'answer' }`: `peerMedian` = middle element, `spread` = {min,max}, signed `distancePct` (one decimal), `n=5`, currency, `subjectSalary`, composed `verdict` | No error |
| Even n median | Triple with 6 in-population peers | Median = mean of two middle amounts, rounded half-up (`divideRoundHalfUp`) | No error |
| Thin peer group | Triple with 3 in-population employees | `{ kind: 'refusal', reason: 'thin-peer-group', counts: { n: 3 } }`; verdict names the count; group not widened | No error (refusal is data) |
| Subject not in population | Subject's newest record has `effectiveFrom > asOf` (or none) | `{ kind: 'refusal', reason: 'no-salary-as-of' }`; verdict names subject + `asOf`; no median computed | No error |
| As-of rewind drops a peer | A peer whose only record is future at `asOf` | That peer excluded from population; `n`, median, spread recomputed; may cross below 5 → thin-group refusal | No error |
| Same-day correction among peers | A peer with two records sharing `effectiveFrom` | `resolveCurrentSalary` picks greatest `(effectiveFrom, seq)`; that amount enters the median | No error |
| Distance sign & exactness | subject below / above / equal to median; boundary like 20.05% | Negative / positive / `"0.0"`; magnitude exact via bigint, half-up to one decimal | No error |
| Unknown employee id | id absent or non-UUID | `{ kind: 'not-found' }` | No error |
| Repository throws | Adapter raises | `{ kind: 'unavailable' }` | Caught; total |
| Inactive reference row | Subject holds a retired role/level/currency | Included in statistics; label + `CurrencyFormat` resolved without `is_active` filter | No error |

</intent-contract>

## Code Map

- `src/domain/money.ts` -- `Money`, `BoundaryMoney`, `divideRoundHalfUp` (the exact-arithmetic seed for median & distance), `formatMoney`, `toBoundaryMoney`, `CurrencyFormat`.
- `src/domain/salary-timeline.ts` -- `resolveCurrentSalary` (THE AD-8 resolver, generic — hand it richer rows), `SalaryRecordView`.
- `src/domain/plain-date.ts` -- `PlainDate`, `formatPlainDate` (`"16 Jul 2026"`), `comparePlainDate`.
- `src/domain/statistics.ts` -- NEW. Canonical `median` + `spread` over bigint minor units.
- `src/domain/peer-comparison.ts` -- NEW. As-of population filter, distance, and the pure `comparePeers` orchestrator returning a domain-level answer/refusal.
- `src/domain/verdict.ts` -- NEW. THE single verdict-sentence composer (answer + both refusals).
- `src/application/ports/employee-repository.ts` -- add the peer-population read (candidates in a triple with their histories) + inactive-inclusive labels/`CurrencyFormat`.
- `src/application/use-cases/peer-comparison.ts` -- NEW. `getPeerComparison` → finalized `answer | refusal | not-found | unavailable` payload.
- `src/adapters/db/employee-repository.ts` -- implement the new port method (one query grouped by the exact triple; joins reference tables without `is_active` filter).
- `tests/domain/{statistics,peer-comparison,verdict}.test.ts`, `tests/application/peer-comparison.test.ts`, `tests/integration/peer-comparison.test.ts` -- NEW (test-first; integration claims an unused `level.rank` band).

## Tasks & Acceptance

**Execution:**
- [x] `tests/domain/statistics.test.ts` + `src/domain/statistics.ts` -- test-first, then implement `median(amountsMinor: readonly bigint[]): bigint | null` (AD-3, null on empty) and `spread(amountsMinor: readonly bigint[]): { min: bigint; max: bigint } | null`.
- [x] `tests/domain/peer-comparison.test.ts` + `src/domain/peer-comparison.ts` -- test-first, then implement `distancePctTenths` (signed tenths-of-percent, exact, half-up) + `formatDistancePct` (→ `"-8.0"`), and `comparePeers(subjectId, candidates, asOf)` returning `{ kind:'answer'; n; subjectSalary; peerMedian; spread; distancePctTenths } | { kind:'thin-peer-group'; n } | { kind:'no-salary-as-of' }` (Money-typed; in-population = non-null `resolveCurrentSalary`).
- [x] `tests/domain/verdict.test.ts` + `src/domain/verdict.ts` -- test-first, then implement the ONE `composeVerdict` covering the answer sentence and both refusal sentences (see Design Notes for golden strings).
- [x] `src/application/ports/employee-repository.ts` -- add a read that loads the as-of peer population for a triple (each candidate's `employeeId` + salary history as `SalaryRecordView[]`) plus the subject's role/level/country display labels and the group `CurrencyFormat`, all `is_active`-inclusive. Document why it is a sibling on this port, read-only.
- [x] `tests/application/peer-comparison.test.ts` + `src/application/use-cases/peer-comparison.ts` -- test-first against fake ports, then implement `getPeerComparison(deps, employeeId, asOf)`: `findEmployeeById` (`null` → `not-found`) → load peer population → `comparePeers` → map Money→`BoundaryMoney`, `distancePctTenths`→string, compose verdict → the union; wrap in `try/catch` → `unavailable`.
- [x] `tests/integration/peer-comparison.test.ts` -- against real Postgres 18: prove the population read groups by the exact triple, includes an inactive reference row, and excludes a not-yet-effective peer at a past `asOf`; the median/spread/distance are computed in TS over real rows. Claim an unused `level.rank` band (document it).

**Acceptance Criteria:**
- Given a `(role, level, country)` peer group of ≥ 5 in-population employees, when `getPeerComparison` runs, then it returns `kind: 'answer'` with the canonical median, min–max spread, signed one-decimal `distancePct`, `n`, the group's single currency, and the composed verdict — every monetary field a `BoundaryMoney` decimal string.
- Given a peer group with fewer than 5 in-population employees, when `getPeerComparison` runs, then it returns `kind: 'refusal'`, `reason: 'thin-peer-group'`, `counts.n` = the group size, and a verdict naming that count; the group is never widened and nothing throws.
- Given a subject with no salary as of `asOf`, when `getPeerComparison` runs, then it returns `reason: 'no-salary-as-of'` (distinct from thin-peer-group) with no median computed.
- Given an unknown id it returns `not-found`; given a repository throw it returns `unavailable` — no exception crosses the boundary.
- Given identical data and `asOf`, when run twice, the payloads are byte-identical; no clock/random appears in `src/domain/**` or `src/application/**`.
- Given the full gate suite, lint, typecheck, import-boundary, coverage-floor, and domain mutation testing all pass, and the integration test is green against real Postgres 18.

## Spec Change Log

_No bad_spec loopback occurred — empty._

## Review Triage Log

### 2026-07-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 4: (high 0, medium 0, low 4)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[low]` `[patch]` Thin-peer-group verdict rendered ungrammatical "has only 1 people" when the subject is the sole in-population member (`n === 1`, reachable). Fixed `src/domain/verdict.ts` to agree the noun with the count ("1 person" vs "N people") and pinned it with a new `tests/domain/verdict.test.ts` case; the count itself was already correct.
- notes: Blind Hunter (adversarial-general) + Edge Case Hunter, deduplicated. No functional defect in the happy or refusal paths — median even/odd math, AD-5 exact half-up distance at boundaries (20.05%), as-of rewind below 5, same-day `seq` tie-break, subject-not-among-candidates, `not-found` vs `unavailable`, and the golden verdict strings are all correct and covered. Deferred (4, all low, logged to `deferred-work.md`): two-read TOCTOU under concurrent role/level edit; absence of a defensive single-currency guard in `comparePeers` (construction-safe today); integration test global reference-state orphan on partial `beforeAll` failure; `no-salary-as-of` refusal omitting the `peerGroup` receipt. Rejected (9): over-broad `try/catch` (mirrors the deliberate `getSalaryTimeline` precedent); "N peers"/"N people" wording and subject-inclusive `n` (sourced verbatim from the DESIGN/epic-context); `distancePctTenths` `?? 0n` on a zero median (unreachable — salary amounts are DB-CHECKed `> 0`, so a peer median is always `> 0`, in this capability and CAP-6/7 reuse); integration rank-band "full-width" comment nit; subject current-salary resolved twice (harmless micro-cost); determinism test naming nit; `no-salary-as-of` vs subject-absent conflation (unreachable); `verdict.ts` importing from `peer-comparison.ts` (natural intra-domain coupling); missing `default` on an exhaustively-typed switch (TS-guaranteed).

## Design Notes

Finalized boundary contract (story 6-2 consumes unmodified; field names are the proposed contract):

```ts
export type GetPeerComparisonResult =
  | { readonly kind: 'answer'; readonly comparison: PeerComparison }
  | { readonly kind: 'refusal'; readonly refusal: PeerRefusal }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

type PeerComparison = {
  readonly employeeId: string; readonly asOf: PlainDate;
  readonly peerGroup: { roleCode: string; levelCode: string; countryCode: string };
  readonly n: number;                 // as-of population, subject included; >= 5
  readonly currency: string;          // group's single ISO code
  readonly subjectSalary: BoundaryMoney;
  readonly peerMedian: BoundaryMoney;
  readonly spread: { min: BoundaryMoney; max: BoundaryMoney };
  readonly distancePct: string;       // signed, one decimal: "-8.0", "0.0", "20.5"
  readonly verdict: string;           // src/domain/verdict.ts, unmodified
};

type PeerRefusal =
  | { reason: 'thin-peer-group'; peerGroup: {roleCode;levelCode;countryCode}; counts: { n: number }; asOf: PlainDate; verdict: string }
  | { reason: 'no-salary-as-of'; asOf: PlainDate; verdict: string };
```

Golden verdict strings (neutral phrasing; magnitude one-decimal, AD-5):
- Answer: `Priya Nair is 8.0% under the peer median (₹23,40,000 INR), based on 9 peers — Software Engineer · L4 · India — as of 16 Jul 2026.` (sign word: `under` <0 / `over` >0 / `at the peer median` =0.)
- Thin: `No comparison — Software Engineer · L4 · India has only 3 people as of 16 Jul 2026. A fair comparison needs at least 5.`
- No salary: `No comparison — Priya Nair has no salary on record as of 16 Jul 2026.`

Exact distance (why bigint): `distancePctTenths = divideRoundHalfUp((salaryMinor − medianMinor) * 1000n, medianMinor)` gives signed tenths-of-percent exactly; `20.05%` → `200.5` tenths → half-up `201` → `"20.1"`, whereas an IEEE double reads `20.05` as `20.0499…` and rounds wrong. `medianMinor > 0` and the group is non-empty, so the division is total.

## Verification

**Commands:**
- `npm run test -- tests/domain/statistics.test.ts tests/domain/peer-comparison.test.ts tests/domain/verdict.test.ts tests/application/peer-comparison.test.ts` -- expected: all green (written test-first).
- `npm run test` -- expected: full unit/application suite green, coverage floor on `src/domain` + `src/application` holds.
- `npm run test:mutation` -- expected: no surviving mutant over `src/domain` (median/distance/verdict).
- `npm run typecheck` && `npm run lint` -- expected: clean, including the import-boundary rule (domain imports nothing outward; app imports only domain).
- `npm run test:integration` -- expected: green against Postgres 18 (`DATABASE_URL` + `DATABASE_URL_APP` set).

## Auto Run Result

Status: **done**

### Summary
Implemented CAP-5 peer comparison, backend slice, fully test-first. An HR manager can now ask where an employee sits relative to `(role, level, country)` peers: the use-case returns a peer median, min–max spread, and the subject's signed distance — each figure a `BoundaryMoney` decimal string carrying its receipts (peer group, `n`, as-of date, currency) plus a single composed verdict sentence — or a dignified explicit refusal (thin group naming the count, or "no salary as of D") that never widens the group and never throws. This establishes the canonical median, the exact signed-distance arithmetic, the answer/refusal boundary payload, and the one verdict composer that CAP-6 and CAP-7 reuse.

### Files changed
- `src/domain/statistics.ts` (new) -- the ONE `median` (AD-3, empty → `null`) + `spread`, with a directly-tested `compareAmountsMinor`.
- `src/domain/peer-comparison.ts` (new) -- `distancePctTenths` (exact signed tenths-of-percent), `formatDistancePct`, `MIN_PEER_GROUP_SIZE`, `PeerCandidate`, and the pure `comparePeers` orchestrator (as-of population filter → `n ≥ 5` gate → answer/refusal).
- `src/domain/verdict.ts` (new) -- the ONE `composeVerdict` (answer + both refusals); patched to agree the noun with the count ("1 person" / "N people").
- `src/application/use-cases/peer-comparison.ts` (new) -- `getPeerComparison`, the finalized `answer | refusal | not-found | unavailable` boundary payload.
- `src/application/ports/employee-repository.ts` -- added the read-only `findPeerPopulation` sibling + `PeerGroupKey`/`PeerPopulation` types (`is_active`-inclusive labels + `CurrencyFormat`).
- `src/adapters/db/employee-repository.ts` -- Prisma `findPeerPopulation` (groups by the exact triple; no DB-side `ORDER BY`/`COUNT`/as-of filter; per-row own currency).
- `src/app/employees/employee-deps.ts` -- forwards `findPeerPopulation` on the lazy repository.
- Tests (new): `tests/domain/{statistics,peer-comparison,verdict}.test.ts`, `tests/application/peer-comparison.test.ts`, `tests/integration/peer-comparison.test.ts` (real Postgres 18, own `level.rank` band). Port-fake stubs widened in five existing test files.

### Review findings breakdown
- **Patches applied (1, low):** thin-peer-group verdict pluralization ("1 person" vs "N people") for the reachable `n === 1` case, with a new pinning test.
- **Deferred (4, low):** two-read TOCTOU under a concurrent role/level edit; no defensive single-currency guard in `comparePeers` (construction-safe today); integration-test global reference-state orphan on partial `beforeAll` failure; `no-salary-as-of` refusal omitting the `peerGroup` receipt. All logged to `deferred-work.md`.
- **Rejected (9):** see Review Triage Log notes (all unreachable-by-invariant, design-sourced wording, precedent-consistent, or nits).

### Verification performed
- `npm run test` -- 37 files, **1219 passed**.
- `npm run test:integration` -- 8 files, **123 passed** against real PostgreSQL 18.
- `npm run typecheck` -- clean. `npm run lint` -- clean (import-boundary held: domain imports nothing outward).
- Coverage floor (domain 100% / application) and domain mutation testing (reported 100%, 0 survivors) green from the implementation pass; post-patch re-run of the full unit suite green.

### Residual risks
The four deferred items above — all low, none affecting the happy or refusal paths, and the single-currency and TOCTOU items unreachable under current write-path invariants. The frontend contract is finalized; story 6-2 consumes it unmodified.
