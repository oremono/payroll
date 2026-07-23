---
title: 'CAP-7 Gender Gap or Refusal — Backend'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: '09bc53d9afd393b36c28e286c852699a4b5583f4'
final_revision: '35b9429a2b85af2796203cade88f8ede19bb4023'
review_loop_iteration: 0
followup_review_recommended: false # single localized, well-tested verdict-phrasing patch; no independent follow-up warranted
context: ['{project-root}/docs/project-context.md', '{project-root}/docs/implementation-artifacts/epic-8-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The peer-group surface cannot yet answer whether men and women are paid differently for the same work. CAP-7 must, within one `(role, level, country)` peer group, compute the male salary median and the female salary median, report the gap between them (AD-17: `gap = (M − F) / M × 100`, male median always the denominator, positive means men paid more), and report it ONLY when the group holds ≥ 5 employees of EACH gender in the as-of population — otherwise refuse, naming both gender counts and which gender is short. Every figure carries its receipts as a discriminated union with a single composed verdict sentence.

**Approach:** Deliver the backend slice test-first, reusing the CAP-5/CAP-6 primitives unchanged — the ONE `median` (AD-3), the ONE `resolveCurrentSalary` (AD-8), `MIN_PEER_GROUP_SIZE = 5`, `divideRoundHalfUp`/`formatDistancePct` (AD-5 arithmetic), and Money/PlainDate. Add a pure domain `computeGenderGap` (`src/domain/gender-gap.ts`); a new gender-gap answer/refusal arm on the ONE `composeVerdict` (`src/domain/verdict.ts`); a new gender-carrying population read (`findGenderGapPopulation`, port + Prisma adapter, mirroring `findPeerPopulation` + `gender`); one use-case (`getGenderGap`) returning the finalized AD-20 payload; deps wiring; and an integration test against real Postgres 18. Whole-group median/spread (AD-9) is NOT re-computed here — CAP-5's shipped `getPeerComparison` provides it on the shared surface. No page/RSC/Server Action/CSV — that is story 8-2.

## Boundaries & Constraints

**Always:**
- Obey every Law in `project-context.md`. The DB SELECTs rows only; every median, gap, and per-gender count is computed in-process (AD-2) — no `percentile_cont`/`AVG`/window/`COUNT` for any user-facing value.
- Reuse the ONE median (`src/domain/statistics.ts`, AD-3) and the ONE current-salary resolver (`resolveCurrentSalary`, AD-8). Reuse `MIN_PEER_GROUP_SIZE = 5`, the ONE `divideRoundHalfUp` exact half-up division, and `formatDistancePct`. Write NO second median, resolver, or division primitive.
- The gap is AD-17, exactly: over each gender's as-of current salaries, `maleMedian` M and `femaleMedian` F per the canonical median; `gapPctTenths = divideRoundHalfUp((M − F) × 1000, M) ?? 0n` — male median ALWAYS the denominator, magnitude rounded half-up to one decimal and the sign reapplied by the divider (so `+` means men paid more), all in `bigint`, never IEEE float (`20.05` → `201` tenths → `"20.1"`). Rendered via `formatDistancePct` as a signed one-decimal string.
- The as-of population defines the group (AD-16): a candidate is in-population at `asOf` iff `resolveCurrentSalary(history, asOf)` is non-null; `maleN`/`femaleN` are the cardinalities of that exact in-memory set split by gender (`MALE`/`FEMALE`), never a `COUNT` query, never the table.
- Threshold is `≥ 5 of EACH gender` (AD-17, layered on AD-16's group `n ≥ 5`). Report the gap only when `maleN ≥ 5 AND femaleN ≥ 5`; otherwise a `refusal` naming both counts and which gender is short (`MALE` / `FEMALE` / `BOTH`). Never widen the group to reach the threshold. Gender is verbatim `MALE`/`FEMALE`; gender is never part of peer identity — it only slices WITHIN one group.
- `asOf` is a required explicit `PlainDate` argument to every domain/application function; no `Date`/clock/random/env/settings read in `src/domain/**` or the use-case math. Same data + same `asOf` ⇒ byte-identical payload.
- Money never bare (AD-4): the group is single-currency by construction (country→currency, AD-6); both medians and the gap live in that one currency; every monetary field crosses the boundary as `BoundaryMoney` (decimal string) via `toBoundaryMoney`; the gap crosses as a signed one-decimal string. No comparison crosses currencies; no FX.
- Answers carry receipts (Law 8 / AD-20): the result is a discriminated union `answer | refusal | not-found | unavailable`; `answer` carries `peerGroup` (codes + labels), `maleN`, `femaleN`, `currency`, `maleMedian`, `femaleMedian`, `gapPct`, `asOf`, and the ONE composed `verdict`; `refusal` carries `peerGroup`, `counts: { male, female }`, `shortGender`, `asOf`, and its verdict. A refusal is a return value carrying its counts, never an exception. Domain functions are TOTAL; the use-case wraps repository access in `try/catch` → `{ kind: 'unavailable' }`.
- The verdict sentence is composed by the ONE `composeVerdict` (`src/domain/verdict.ts`), consumed unmodified by card and copy-answer; it is `null` (→ `unavailable`) when a component cannot render, never a sentence with a hole. Neutral phrasing; naming male/female medians and counts is the content, not a subject pronoun.
- Reference labels (role/level/country names, `CurrencyFormat`) resolved WITHOUT an `is_active` filter — `is_active` gates pickability for new writes, never an existing group's statistics.
- Computed fresh per request (AD-12): no materialized gap table, no cache.
- TDD (Law 1): every domain/application function has a failing test written first; the fast suite touches no DB/clock/network. At least one adapter integration test runs against real disposable Postgres 18 (never a mock). Domain mutation testing stays at 100%.

**Block If:**
- `findGenderGapPopulation` cannot be implemented without a schema/migration change (the triple index, the `employee.gender` column, and reference tables all already exist — a needed change signals an unexpected data-model gap).
- The UX source is found to mandate that the CAP-7 payload ITSELF carry the whole-group median/spread (AD-9), rather than reading CAP-5's on the shared peer-group surface — a boundary-contract addition whose shape is not derivable here.

**Never:**
- Never widen a group to reach 5-of-each; never compute a median over an empty gender set; never report a gap when either gender has `n < 5`.
- Never a second median/resolver/division/distance function; never let the DB compute a displayed statistic; never convert currencies or re-resolve currency from `employee.country` at read time.
- Never make gender part of peer identity; never read the clock/random/settings inside the domain or use-case math. No Server Action, Route Handler, CSV, page/RSC, or UI — those are story 8-2. This is read-only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gap, men higher | Group with 5+ men, 5+ women; male median > female median | `kind:'answer'`; `gapPct` positive one-decimal (e.g. `"8.0"`), both medians as `BoundaryMoney`, `maleN`/`femaleN`, single currency | No error |
| Gap, women higher | Female median > male median | `answer`; `gapPct` negative (e.g. `"-8.7"`) — sign = women paid more | No error |
| Gap exactly zero | Male median == female median | `answer`; `gapPct` `"0.0"`; verdict states parity | No error |
| Rounding exactness | Gap magnitude 20.05% (`200.5` tenths) | Half-up in `bigint` → `201` → `"20.1"`; never float `20.0499…` | No error |
| Both genders exactly 5 | `maleN == 5 && femaleN == 5` | `answer` (5 is sufficient — boundary inclusive) | No error |
| One gender short | `femaleN == 4`, `maleN == 8` | `refusal`, `counts:{male:8,female:4}`, `shortGender:'FEMALE'`; no median computed | No error (refusal is data) |
| Both genders short | `maleN == 3`, `femaleN == 2` (group total < 5 too) | `refusal`, `counts:{male:3,female:2}`, `shortGender:'BOTH'` | No error |
| Empty as-of group | No candidate in-population at `asOf` | `refusal`, `counts:{male:0,female:0}`, `shortGender:'BOTH'` (no `n=0` median arithmetic) | No error |
| As-of rewind drops a peer | A member future/no-salary at `asOf` | Excluded from population; per-gender counts and medians recomputed; may cross below 5 → refusal | No error |
| Same-day correction | A member with two records sharing `effectiveFrom` | `resolveCurrentSalary` picks greatest `(effectiveFrom, seq)`; that amount enters the gender median | No error |
| Even-n gender median | A gender with an even count | Mean of the two middle minor-unit values, half-up (the ONE `median`) | No error |
| Subject not found | `findEmployeeById` → `null` | `kind:'not-found'` | No error |
| Population unresolvable | `findGenderGapPopulation` → `null` (unresolvable label/currency) | `kind:'unavailable'` | No error |
| Repository throws | `findEmployeeById`/`findGenderGapPopulation` rejects | `getGenderGap` → `{ kind:'unavailable' }` | Caught; total |
| Verdict cannot render | A currency/format the money formatter cannot render | `composeVerdict` → `null` → `{ kind:'unavailable' }` | No exception crosses the boundary |

</intent-contract>

## Code Map

- `src/domain/statistics.ts` -- REUSE `median` (AD-3, `null` on empty).
- `src/domain/peer-comparison.ts` -- REUSE `MIN_PEER_GROUP_SIZE`, `formatDistancePct`, `PeerCandidate` (`{ employeeId; salaryHistory }`).
- `src/domain/salary-timeline.ts` -- REUSE `resolveCurrentSalary` (AD-8), `SalaryRecordView`.
- `src/domain/money.ts` -- REUSE `Money`, `BoundaryMoney`, `toBoundaryMoney`, `divideRoundHalfUp`, `CurrencyFormat`.
- `src/domain/employee-fields.ts` -- REUSE `Gender` (`'MALE' | 'FEMALE'`, canonical; re-exported via `import-row.ts`).
- `src/domain/plain-date.ts` -- REUSE `PlainDate`.
- `src/domain/gender-gap.ts` -- NEW. Pure `computeGenderGap(candidates, asOf)`: as-of filter → split by gender → `maleN/femaleN < 5` gate → per-gender `median` → AD-17 `gapPctTenths`. Types `GenderGapCandidate = PeerCandidate & { gender: Gender }`, `GenderGapResult`.
- `src/domain/verdict.ts` -- EXTEND `VerdictInput` + `composeVerdict` with `gender-gap-answer` (three-way on gap sign) and `gender-gap-refusal` (names both counts + short gender) arms. No second composer.
- `src/application/ports/employee-repository.ts` -- ADD `findGenderGapPopulation(group: PeerGroupKey): Promise<GenderGapPopulation | null>` + `GenderGapPopulation` (mirror `PeerPopulation`, candidates carry `gender`).
- `src/adapters/db/employee-repository.ts` -- IMPLEMENT `findGenderGapPopulation`: mirror `findPeerPopulation` exactly, adding `gender: true` to the employee select and threading `gender` onto each candidate (same triple `where`, same `is_active`-inclusive labels, same `toCurrencyFormats` validation and `null` arms).
- `src/application/use-cases/gender-gap.ts` -- NEW. `getGenderGap(deps, employeeId, asOf)` → the finalized `{ kind:'answer'|'refusal'|'not-found'|'unavailable' }` payload (see Design Notes).
- `src/app/employees/employee-deps.ts` -- forward `findGenderGapPopulation` on `lazyEmployeeRepository`; export `genderGapDeps()` (`{ repository }`).
- `tests/domain/gender-gap.test.ts`, `tests/domain/verdict.test.ts` (extend), `tests/application/gender-gap.test.ts`, `tests/integration/gender-gap.test.ts` -- NEW/extended (test-first). Six port-fake test files widen for `findGenderGapPopulation`.

## Tasks & Acceptance

**Execution:**
- [x] `tests/domain/gender-gap.test.ts` + `src/domain/gender-gap.ts` -- test-first, then implement `computeGenderGap(candidates: readonly GenderGapCandidate[], asOf: PlainDate): GenderGapResult`. In-population via `resolveCurrentSalary`; split by `gender`; if `maleN < MIN_PEER_GROUP_SIZE || femaleN < MIN_PEER_GROUP_SIZE` → `{ kind:'insufficient-gender', maleN, femaleN, shortGender }` where `shortGender` is `'BOTH'` if both `< 5`, else `'MALE'`/`'FEMALE'` for the short one; else per-gender `median` (single group currency) → `gapPctTenths = divideRoundHalfUp((maleMedianMinor − femaleMedianMinor) * 1000n, maleMedianMinor) ?? 0n` → `{ kind:'answer', maleN, femaleN, maleMedian: Money, femaleMedian: Money, gapPctTenths }`. Pure, total, deterministic; cover every domain I/O-matrix row incl. the `20.05→20.1` boundary, both-higher/women-higher/zero signs, 5-of-each boundary, one/both short, empty group, even-n median, as-of rewind, same-day tie-break.
- [x] `tests/domain/verdict.test.ts` (extend) + `src/domain/verdict.ts` -- test-first for two new `VerdictInput` arms, then implement. `gender-gap-answer` carries `maleMedian`/`femaleMedian` (Money), `currencyFormat`, `gapPctTenths`, `maleN`, `femaleN`, `group`, `asOf`; three-way on gap sign (men higher / women higher / parity), formatting money via `formatMoney` (→ `null` on mismatch) and date via `formatPlainDate` (→ `null`). `gender-gap-refusal` carries `maleN`, `femaleN`, `shortGender`, `group`, `asOf`; states both counts and the "≥ 5 of each" standard, agreeing person/people nouns. Keep the switch exhaustive (no unreachable default).
- [x] `src/application/ports/employee-repository.ts` -- add `findGenderGapPopulation` + `GenderGapPopulation` (`{ candidates: readonly GenderGapCandidate[]; roleName; levelLabel; countryName; currencyFormat }`, `GenderGapCandidate = PeerCandidate & { readonly gender: Gender }`). Document it as a read-only sibling of `findPeerPopulation` (gender-carrying); grouping/counts stay out of SQL (AD-2/AD-16).
- [x] `tests/application/gender-gap.test.ts` + `src/application/use-cases/gender-gap.ts` -- test-first against fake ports, then implement `getGenderGap(deps, employeeId, asOf)`: `findEmployeeById` (`null` → `not-found`) → `findGenderGapPopulation` by the subject's OWN triple (`null` → `unavailable`) → `computeGenderGap` → map to `VerdictInput`, `composeVerdict` (`null` → `unavailable`) → assemble the union, `Money`→`BoundaryMoney`, `gapPctTenths`→`formatDistancePct`; `try/catch` → `unavailable`.
- [x] `src/adapters/db/employee-repository.ts` + `src/app/employees/employee-deps.ts` -- implement `findGenderGapPopulation` (mirror `findPeerPopulation` + `gender`); forward it on `lazyEmployeeRepository`; add `genderGapDeps()`.
- [x] `tests/integration/gender-gap.test.ts` -- against real Postgres 18: prove `findGenderGapPopulation` groups by the exact triple, carries each employee's `gender`, includes an inactive reference label, and that an as-of rewind excluding a member changes a per-gender count; prove `getGenderGap` yields an `answer` for a 5-men/5-women group and a `refusal` naming both counts when a gender is short — median/gap computed in TS. Claim an unused `level.rank` band (document it), distinct from CAP-6's `2_040_000_000–2_045_999_999`.

**Acceptance Criteria:**
- Given a `(role, level, country)` group with ≥ 5 in-population men AND ≥ 5 in-population women as of `asOf`, when `getGenderGap` runs, then `kind:'answer'` carries `maleMedian` and `femaleMedian` as `BoundaryMoney` in the group's single currency, `maleN`/`femaleN`, a signed one-decimal `gapPct` = `(M−F)/M×100` (male median the denominator; positive ⇒ men paid more), the `peerGroup` codes+labels, `asOf`, and the ONE `verdict`.
- Given either gender has `n < 5` in-population (including an empty group, 0/0), when the sweep runs, then `kind:'refusal'` names `counts:{male,female}` and `shortGender` (`MALE`/`FEMALE`/`BOTH`), computes no median, and never widens the group.
- Given a gap magnitude of exactly 20.05%, then the reported `gapPct` is `"20.1"` — exact `bigint` half-up, never float.
- Given identical data and `asOf`, when run twice, the payload is byte-identical; no clock/random/settings read appears in `src/domain/**` or the use-case math.
- Given `findEmployeeById` → `null`, the result is `not-found`; given `findGenderGapPopulation` → `null`, a repository throw, or a `null` verdict, the result is `unavailable` — no exception crosses the boundary.
- Given the full gate: lint, typecheck, import-boundary, coverage-floor (domain 100%, application 90%), and domain mutation testing (0 survivors) all pass, and the integration test is green against real Postgres 18.

## Spec Change Log

_No bad_spec loopback occurred — empty._

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 1: (high 0, medium 0, low 1)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` Both reviewers (Blind Hunter + Edge Case Hunter) converged on the same real defect: the gender-gap answer's parity phrase ("Men and women are paid the same at the median") was keyed on the ROUNDED `gapPctTenths === 0n`, not on median equality — so a group with medians ₹20,000 vs ₹19,999.99 (gap `0.0005%` → `0n` tenths) rendered "paid the same" beside two DIFFERENT median figures the same sentence prints, contradicting itself in a user-quotable (copy-answer) verdict. The spec's own I/O matrix already pins the parity input as "Male median == female median", so this was a code deviation from a clear spec. Fixed in `src/domain/verdict.ts`: `gapDirectionPhrase` now drives DIRECTION off the exact `maleMedianMinor` vs `femaleMedianMinor` comparison (parity only on true equality; a gap rounding to 0.0% beside unequal medians reads "Men are paid 0.0% more than women"), with the magnitude formatted inside each direction arm (no standalone `abs`, avoiding an equivalent `< 0n` mutant at `0n` since `-0n === 0n` for `bigint`). Added a killing unit test (`tests/domain/verdict.test.ts`) for the "rounds-to-0.0% but medians differ" case. Re-verified: domain mutation back to 100% (0 survivors), full suite 1342 green, integration 3/3 green.
- notes: One item deferred (low) — no defensive single-currency guard in `computeGenderGap`: construction-safe under the country→currency write invariant + append-only history, identical to the CAP-5/CAP-6 deferred single-currency-guard item, logged to `deferred-work.md`. Rejected (9, all low): non-exhaustive `else` gender bucket (`Gender` is a closed `MALE`/`FEMALE` union at TS + Prisma enum — type-exhaustive, mutation-covered); `try/catch → unavailable` "swallows defects / no logging" and the null-vs-throw `unavailable` conflation (the established repo-wide AD-20 totality pattern, shared by every sibling use-case); `genderGapPctTenths ?? 0n` false-parity for a zero male median (unreachable — `salary_record.amount_minor > 0` DB CHECK + write validation; mirrors the shipped `distancePctTenths` precedent); the verdict-null→`unavailable` path "untested" (it IS covered, via the malformed-`asOf` application test); integration `level.rank` birthday-collision (the established reserved-band convention shared with CAP-6; theoretical over thousands of historical runs); unbounded whole-group population load (inherent to AD-2/AD-12 fresh-per-request, rejected identically in 7-1); `gapPct` + `verdict` "double-render" risk (a story 8-2 UI concern, sign convention documented); subject-inclusion untested (the population is a plain triple query with no subject-exclusion logic — hypothetical).

## Design Notes

**Finalized boundary contract (story 8-2 consumes unmodified):**

```ts
export type GetGenderGapResult =
  | { readonly kind: 'answer'; readonly gap: GenderGap }
  | { readonly kind: 'refusal'; readonly refusal: GenderGapRefusal }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

type PeerGroupProvenance = {                 // codes (provenance) + display labels
  readonly roleCode: string; readonly levelCode: string; readonly countryCode: string;
  readonly roleName: string; readonly levelLabel: string; readonly countryName: string;
};

type GenderGap = {
  readonly employeeId: string;               // the entry-point employee (group selector only)
  readonly asOf: PlainDate;
  readonly peerGroup: PeerGroupProvenance;
  readonly maleN: number; readonly femaleN: number;   // ≥ 5 each by construction (AD-16 counts)
  readonly currency: string;                 // the group's single ISO-4217 code
  readonly maleMedian: BoundaryMoney; readonly femaleMedian: BoundaryMoney;
  readonly gapPct: string;                   // signed one decimal: "8.0", "-8.7", "0.0"
  readonly verdict: string;
};

type GenderGapRefusal = {
  readonly reason: 'insufficient-gender';
  readonly peerGroup: PeerGroupProvenance;
  readonly counts: { readonly male: number; readonly female: number };
  readonly shortGender: 'MALE' | 'FEMALE' | 'BOTH';
  readonly asOf: PlainDate;
  readonly verdict: string;
};
```

**Why one refusal reason.** `≥ 5 of EACH gender` strictly subsumes AD-16's `group n ≥ 5` (5 men + 5 women ⇒ total ≥ 10), so a distinct `thin-peer-group` arm would be unreachable for CAP-7 — a group of 2M+2F is simply `shortGender:'BOTH'`. CAP-5's own `getPeerComparison`, on the same shared surface, still emits its `thin-peer-group` refusal for the whole-group view; CAP-7 speaks only to the gender split.

**Why a direct gap formula, not `distancePctTenths`.** AD-17 is a distinct formula from AD-5's subject-distance; expressing it as `-distancePctTenths(F, M)` would be a sign-flipped reuse that reads wrong. Instead the gap shares the ACTUAL arithmetic primitives — the ONE `divideRoundHalfUp` (exact half-up, sign via the signed numerator) and the ONE `formatDistancePct` renderer — so "rounded like AD-5" is literal, and no second median/resolver/division is written. `M > 0` past the 5-of-each gate (salaries are `> 0`, median of a non-empty positive set is positive), so the `?? 0n` arm is unreachable-but-total, mirroring `distancePctTenths`.

**Why gender is on a new candidate type + read.** Following the CAP-6 `OutlierCandidate = PeerCandidate & { name }` precedent rather than widening the shared `PeerCandidate` (which `comparePeers` and the outlier sweep would then carry needlessly). `findGenderGapPopulation` is a gender-carrying sibling of `findPeerPopulation`; the two may share a private adapter helper.

**Whole-group median/spread is out of scope (AD-9).** The peer-group surface renders the group median and min–max spread from CAP-5's shipped `getPeerComparison`; CAP-7 adds only the gender split. Duplicating them here would fork the ONE `median`/`spread`. If review finds the UX mandates them inside the CAP-7 payload, that is a `Block If`, not a silent addition.

**Golden domain example:**

```ts
// maleMedian ₹20,00,000 (2_000_000n), femaleMedian ₹18,40,000 (1_840_000n), 5 men, 5 women
// gap = (2_000_000 − 1_840_000) / 2_000_000 × 1000  →  divideRoundHalfUp(160_000_000n, 2_000_000n) = 80n
// → formatDistancePct(80n) === "8.0"  (positive: men paid more)
```

## Verification

**Commands:**
- `npm run test -- tests/domain/gender-gap.test.ts tests/domain/verdict.test.ts tests/application/gender-gap.test.ts` -- expected: all green (written test-first).
- `npm run test` -- expected: full unit/application suite green; coverage floor on `src/domain` (100%) + `src/application` (90%) holds.
- `npm run test:mutation` -- expected: no surviving mutant over `src/domain` (gender-gap formula, 5-of-each gate, shortGender, verdict arms).
- `npm run typecheck` && `npm run lint` -- expected: clean, including the import-boundary rule (domain imports nothing outward; app imports only domain).
- `npm run test:integration -- tests/integration/gender-gap.test.ts` -- expected: green against Postgres 18 (`DATABASE_URL` + `DATABASE_URL_APP` set).

## Auto Run Result

Status: **done**

### Summary
Implemented CAP-7 (gender gap or refusal), backend slice, fully test-first. Within one `(role, level, country)` peer group, `getGenderGap` computes the male and female salary medians over the as-of population, splits by gender, and reports the AD-17 gap `= (M − F) / M × 100` (male median always the denominator; positive ⇒ men paid more) as an exact `bigint` signed one-decimal string — but ONLY when both genders have ≥ 5 in-population employees. Otherwise it returns a `refusal` naming both counts and which gender is short (`MALE`/`FEMALE`/`BOTH`), never widening the group. Every figure crosses the boundary carrying its receipts as a discriminated union (`answer | refusal | not-found | unavailable`) with the ONE composed verdict sentence; a repository outage or unrenderable label/currency/date returns `unavailable`, never an exception. The CAP-5/CAP-6 primitives (`median`, `resolveCurrentSalary`, `MIN_PEER_GROUP_SIZE`, `divideRoundHalfUp`, `formatDistancePct`, Money/PlainDate/Gender) are reused unchanged — no second median, resolver, or division. Whole-group median/spread (AD-9) stays with CAP-5 on the shared surface. The finalized boundary payload is ready for story 8-2, which consumes it unmodified.

### Files changed
- `src/domain/gender-gap.ts` (new) — pure, total `computeGenderGap(candidates, asOf)`; as-of split by gender, 5-of-each gate, AD-17 gap over the ONE `divideRoundHalfUp`; plus `genderGapPctTenths` wrapper and `GenderGapCandidate`/`GenderGapResult` types.
- `src/domain/verdict.ts` — extended the ONE `composeVerdict` with `gender-gap-answer` (direction driven by the exact median comparison; magnitude from the rounded tenths) and `gender-gap-refusal` (both counts + short gender) arms.
- `src/application/ports/employee-repository.ts` — added `findGenderGapPopulation` + `GenderGapPopulation` (gender-carrying read-only sibling of `findPeerPopulation`).
- `src/application/use-cases/gender-gap.ts` (new) — `getGenderGap`, the finalized `answer | refusal | not-found | unavailable` payload (Money→`BoundaryMoney`, tenths→signed one-decimal string, `try/catch` → `unavailable`).
- `src/adapters/db/employee-repository.ts` — implemented `findGenderGapPopulation` (mirrors `findPeerPopulation` + `gender: true`, `is_active`-inclusive labels, `toCurrencyFormats` validation).
- `src/app/employees/employee-deps.ts` — forwarded `findGenderGapPopulation`; added `genderGapDeps()`.
- Tests (new/extended): `tests/domain/gender-gap.test.ts`, `tests/domain/verdict.test.ts`, `tests/application/gender-gap.test.ts`, `tests/integration/gender-gap.test.ts` (real Postgres 18; reserved `level.rank` band `2_050_000_000–2_055_999_999`). Eight existing port-fake test files widened for `findGenderGapPopulation`.

### Review findings breakdown
- **Patches applied (1, medium):** the gender-gap answer's parity phrase was keyed on the rounded gap (`gapPctTenths === 0n`) rather than median equality, so medians differing by < 0.05% rendered "paid the same" beside two different figures — fixed to drive direction off the exact median comparison, with a killing test added; domain mutation restored to 100%.
- **Deferred (1, low):** no defensive single-currency guard in `computeGenderGap` — construction-safe, identical to the CAP-5/CAP-6 deferred item, logged to `deferred-work.md`.
- **Rejected (9, all low):** non-exhaustive gender `else` (type-exhaustive union); `try/catch → unavailable` and null-vs-throw conflation (repo-wide AD-20 pattern); `?? 0n` zero-male-median (unreachable via the `amount_minor > 0` CHECK); verdict-null path (already covered); integration `level.rank` collision (established convention); unbounded population load (AD-2/AD-12 inherent); `gapPct`+verdict double-render (8-2 UI concern); subject-inclusion untested (plain triple query).

### Verification performed
- `npm run test` (full unit/application) — **1342 passed / 45 files**; coverage floor holds (domain **100%**, application 97.56% branch > 90%).
- `npm run test:mutation` — **100.00%, 0 survivors** over `src/domain` (`gender-gap.ts` 53 killed, `verdict.ts` 94 killed) after the patch.
- `npm run typecheck` — clean. `npm run lint` — clean (import-boundary held: `src/domain` imports nothing outward).
- `npm run test:integration -- tests/integration/gender-gap.test.ts` — **3 passed** against real PostgreSQL 18.4 (exact-triple grouping, gender carried, inactive-label resolution, an as-of rewind dropping a woman to a `female:4` refusal naming both counts, and an 8.0% answer with median/gap computed in TS).

### Residual risks
The one deferred item (single-currency guard) — low, construction-safe under current write-path invariants and shared with CAP-5/CAP-6. The finalized boundary contract is ready for story 8-2, which renders the answer card, the gender-short refusal panel, and the copy-answer verdict, adding nothing to the contract.
