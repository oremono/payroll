---
title: 'CAP-6 Outliers & Threshold — Backend'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: '2541960070f91f3d96b23799caae41992f865fc3'
final_revision: '1b44fbba79c7721a3808f14d788b2e883d3f4dd0'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/docs/project-context.md', '{project-root}/docs/implementation-artifacts/epic-7-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Home cannot yet surface, unprompted, everyone drifting from their peer-group median. CAP-6 must sweep the entire as-of population, group it into `(role, level, country)` peer groups, and — for a group of 5+ — flag every member whose signed distance from the group median exceeds an adjustable threshold (either direction, one finding each, boundary exact: 19.9% no, 20.0% no, 20.1% yes), each finding carrying its group, the group's size `n`, and its distance. Groups thinner than 5 appear inline as refusal rows naming `n`, never silently omitted and never widened. The threshold is persisted org config (default 20%), read once at the boundary and passed inward. Every figure carries its receipts.

**Approach:** Deliver the backend slice test-first, reusing the CAP-5 primitives (`median`, `distancePctTenths`, `resolveCurrentSalary`, `MIN_PEER_GROUP_SIZE`, Money/PlainDate). Add a pure domain sweep (`src/domain/outliers.ts`) that takes the threshold as a required explicit argument; a whole-population repository read (`findAllPeerGroups`, port + Prisma adapter); a settings read (`SettingsRepository` port + adapter) so the persisted threshold is readable at the boundary; two use-cases (`getOutlierFindings` returning the finalized findings payload, and `getSettings` returning the threshold); deps wiring; and an integration test against real Postgres 18. No verdict sentence and no page/CSV/mutation — those are story 7-2.

## Boundaries & Constraints

**Always:**
- Obey every Law in `project-context.md`. The DB SELECTs rows only; every median, distance, count, and flag is computed in-process (AD-2) — no `percentile_cont`/`AVG`/window/`COUNT` for any user-facing value.
- Reuse the ONE median (`src/domain/statistics.ts`, AD-3) and the ONE current-salary resolver (`resolveCurrentSalary`, AD-8). Reuse `distancePctTenths` (exact signed tenths-of-percent over `bigint`, AD-5) and `formatDistancePct`. Reuse `MIN_PEER_GROUP_SIZE = 5`. Write NO second median, resolver, or distance function.
- Boundary exactness (NFR6/AD-5): flag `abs(distancePctTenths) > thresholdPctTenths` **strictly**, all in `bigint`. Convert the persisted integer-percent threshold to tenths at the domain edge (`thresholdPctTenths = BigInt(pct) * 10n`); 20% → `200n`, so 20.0% (`200n`) does NOT flag and 20.1% (`201n`) does. The magnitude is rounded half-up to one decimal first — the number shown is the number judged.
- The as-of population defines every peer group (AD-16): a candidate is in-population at `asOf` iff `resolveCurrentSalary(history, asOf)` is non-null. Peer group = every in-population employee sharing the CURRENT `(roleCode, levelCode, countryCode)`. `n` is that exact set's cardinality (subject included), never a `COUNT` query. `n < 5` → refusal row naming `n`, never widened.
- Threshold is a required explicit parameter, not read in the math (AD-19/Law 6): `getOutlierFindings` and the domain sweep receive it as an argument; the delivery boundary reads `settings.outlier_threshold_pct` once (via `getSettings`) and passes it in. `asOf` is likewise an explicit `PlainDate` param. No `Date`/clock/random/settings read in `src/domain/**` or inside the sweep math. Same data + same `asOf` + same threshold ⇒ byte-identical payload, in a deterministic order.
- Money never bare (AD-4): the sweep operates on `Money.amountMinor` bigints in each group's single currency; every monetary field crosses the boundary as `BoundaryMoney` (decimal string) via `toBoundaryMoney`; `distancePct` crosses as a signed one-decimal string. Currency isolation (AD-3-currency): no comparison crosses currencies; each group is single-currency by construction — no FX anywhere.
- Answers carry receipts (Law 8/AD-20): the result is a discriminated union; each outlier group carries `peerGroup` (codes + display labels), `n`, `currency`, `peerMedian`, and its findings; each refusal carries `peerGroup`, `n`, `reason`; the report carries `asOf` and the `thresholdPct` judged against. A refusal is a return value carrying its counts, never an exception. Domain functions are TOTAL; the use-case wraps repository access in `try/catch` → `{ kind: 'unavailable' }`.
- Reference labels (role/level/country names and `CurrencyFormat`) are resolved WITHOUT an `is_active` filter — `is_active` gates pickability for new writes, never the visibility of an existing employee's statistics or a retired label.
- Findings are computed fresh per request (AD-12): no materialized outlier table, no cache, no seen/unseen/dismissal/acknowledgement state anywhere in the payload or storage.
- TDD (Law 1): every domain/application function has a failing test written first; the fast suite touches no DB, clock, or network. At least one adapter integration test runs against real disposable Postgres 18 (never a mock).

**Block If:**
- The whole-population read or the settings read cannot be implemented without a schema/migration change (the `(roleCode, levelCode, countryCode)` index, reference tables, and the single-row seeded `settings` all already exist — a needed change would signal an unexpected data-model gap).
- The DESIGN/UX source is found to mandate a per-finding verdict SENTENCE in the findings-row payload (rather than the badge-derivable signed distance assumed here), requiring a new `verdict.ts` case whose exact wording is not derivable from CAP-5's composer.

**Never:**
- Never widen a peer group below `n ≥ 5`; never compute a median over `< 5`; never emit an outlier finding for a member of a thin group.
- Never list an employee more than once (each belongs to exactly one current triple — one finding, direction is the sign, never two rows).
- Never a second median/resolver/distance function; never materialize or cache groups/findings; never let the DB compute a displayed statistic; never convert currencies or re-resolve currency from `employee.country` at read time.
- Never read settings or the clock inside the sweep; never hard-code the threshold. No Server Action, Route Handler, CSV render, page/RSC, or verdict sentence — those are story 7-2. This is read-only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Outlier above (threshold 20%) | Group n=5, one member +25.0% from median | `kind:'outliers'` group; that member a finding, `distancePct:"25.0"`; group carries `n`, `peerMedian`, `currency` | No error |
| Outlier below | Member −30.0% from median | Finding `distancePct:"-30.0"` (sign = below); one row | No error |
| Boundary exactness | Members at 19.9% / exactly 20.0% / 20.1% from median | 19.9 and 20.0 do NOT flag; 20.1 does — exact `bigint` tenths vs `200n` | No error |
| Group ≥5, no outliers | All members within threshold | Group OMITTED from `groups` entirely (no section) | No error |
| Thin group | Group with 1 ≤ n < 5 in-population | `kind:'refusal'`, `reason:'thin-peer-group'`, `counts.n`; no median; not widened | No error (refusal is data) |
| Empty as-of group | Group whose members are all future/no-salary at `asOf` (n=0) | Group omitted (nobody to compare; `n=0` is not a refusal row) | No error |
| Zero findings overall | No outliers and no thin groups as of `asOf` | `kind:'findings'` with `groups: []` | No error |
| Multiple outliers, one group | Two members beyond threshold | Both listed, one row each, sorted by descending `abs` distance, tie-break `employeeId` asc | No error |
| As-of rewind drops a peer | A member future at `asOf` | Excluded from population; `n`/median/distances recomputed; may cross below 5 → refusal | No error |
| Same-day correction | A member with two records sharing `effectiveFrom` | `resolveCurrentSalary` picks greatest `(effectiveFrom, seq)`; that amount enters median & distance | No error |
| Threshold varies | Same data, threshold 10 vs 30 | Different findings sets; each a pure function of its threshold (determinism per threshold) | No error |
| Two groups, different currencies | Group A (INR), group B (USD) | Each judged within its own currency; no cross-currency comparison | No error |
| Repository throws | `findAllPeerGroups` rejects | `getOutlierFindings` → `{ kind:'unavailable' }` | Caught; total |
| Settings default | Seeded single row | `getSettings` → `outlierThresholdPct: 20`, `reportingCurrency:'USD'` | No error |
| Settings read throws | Adapter rejects | `getSettings` → `{ kind:'unavailable' }` | Caught; total |

</intent-contract>

## Code Map

- `src/domain/statistics.ts` -- REUSE `median` (AD-3, `null` on empty), `spread`, `compareAmountsMinor`.
- `src/domain/peer-comparison.ts` -- REUSE `distancePctTenths`, `formatDistancePct`, `MIN_PEER_GROUP_SIZE`, `PeerCandidate` (`{ employeeId; salaryHistory }`).
- `src/domain/salary-timeline.ts` -- REUSE `resolveCurrentSalary` (AD-8), `SalaryRecordView`.
- `src/domain/money.ts` -- REUSE `Money`, `BoundaryMoney`, `toBoundaryMoney`, `CurrencyFormat`.
- `src/domain/plain-date.ts` -- REUSE `PlainDate`.
- `src/domain/outliers.ts` -- NEW. The pure sweep: `sweepOutliers(groups, asOf, thresholdPctTenths)`; per-group in-population filter → `n ≥ 5` gate → median → per-member `distancePctTenths` → `abs > thresholdPctTenths` flag; returns only findings-bearing groups (outliers or thin).
- `src/application/ports/employee-repository.ts` -- ADD `findAllPeerGroups(): Promise<readonly PeerGroupPopulation[]>` (sibling read) + `PeerGroupPopulation`/`OutlierCandidate` types (mirror `PeerPopulation`, add employee `name`, keyed by `PeerGroupKey`).
- `src/adapters/db/employee-repository.ts` -- IMPLEMENT `findAllPeerGroups`: load all employees (`id`, `name`, `roleCode`, `levelCode`, `countryCode`, unordered `salaryRecords`), group by triple in-process, resolve reference labels + `CurrencyFormat` per distinct triple from reference maps loaded once (no `is_active` filter, no `ORDER BY`, no as-of/`COUNT`).
- `src/application/ports/settings-repository.ts` -- NEW. `SettingsRepository.readSettings(): Promise<SettingsView>`; `SettingsView = { outlierThresholdPct: number; reportingCurrency: string }`.
- `src/adapters/db/settings-repository.ts` -- NEW. `createSettingsRepository(client?)` → `settings.findUnique({ where: { id: 1 } })` → `SettingsView` (throws if the single row is absent).
- `src/application/use-cases/outliers.ts` -- NEW. `getOutlierFindings(deps, asOf, thresholdPct)` → the finalized `{ kind:'findings'; report } | { kind:'unavailable' }` payload (see Design Notes for the contract).
- `src/application/use-cases/settings.ts` -- NEW. `getSettings(deps)` → `{ kind:'settings'; outlierThresholdPct; reportingCurrency } | { kind:'unavailable' }`.
- `src/app/employees/employee-deps.ts` -- forward `findAllPeerGroups` on `lazyEmployeeRepository`; export `outlierFindingsDeps()` (`{ repository }`).
- `src/app/settings/settings-deps.ts` -- NEW. `lazySettingsRepository()` (deferred construction, mirroring the employee lazy pattern) + `settingsReadDeps()`.
- `tests/domain/outliers.test.ts`, `tests/application/{outliers,settings}.test.ts`, `tests/integration/outliers.test.ts` -- NEW (test-first).

## Tasks & Acceptance

**Execution:**
- [x] `tests/domain/outliers.test.ts` + `src/domain/outliers.ts` -- test-first, then implement `sweepOutliers(groups: readonly OutlierGroupInput[], asOf: PlainDate, thresholdPctTenths: bigint): readonly OutlierGroupResult[]`. `OutlierGroupInput = { key: string; candidates: readonly PeerCandidate[] }`. Per group: in-population via `resolveCurrentSalary`; `n=0` omitted; `1≤n<5` → `{ key, kind:'thin-peer-group', n }`; `n≥5` → `median` then flag members with `abs(distancePctTenths(salaryMinor, medianMinor)) > thresholdPctTenths` — if none omit the group, else `{ key, kind:'outliers', n, medianMinor, currency, outliers: [{ employeeId, salaryMinor, distancePctTenths }] }`. Pure, total, deterministic; cover every I/O-matrix domain row incl. exact 20.0/20.1/19.9 boundary and above/below.
- [x] `src/application/ports/settings-repository.ts` + `tests/application/settings.test.ts` + `src/application/use-cases/settings.ts` -- test-first against a fake port, then implement the port and `getSettings(deps: SettingsDeps)`: `try { readSettings() → { kind:'settings', … } } catch { { kind:'unavailable' } }`.
- [x] `src/application/ports/employee-repository.ts` -- add `findAllPeerGroups` + `PeerGroupPopulation` (`{ key: PeerGroupKey; roleName; levelLabel; countryName; currencyFormat; candidates: readonly OutlierCandidate[] }`) and `OutlierCandidate = PeerCandidate & { readonly name: string }`. Document why it is a read-only sibling and that grouping/`n` stay out of SQL (AD-2/AD-16).
- [x] `tests/application/outliers.test.ts` + `src/application/use-cases/outliers.ts` -- test-first against fake ports, then implement `getOutlierFindings(deps, asOf, thresholdPct)`: `findAllPeerGroups` → build `OutlierGroupInput` per population (opaque `key` = `roleCode|levelCode|countryCode`) → `sweepOutliers(inputs, asOf, BigInt(thresholdPct)*10n)` → join labels/currency/employee names, map `Money`→`BoundaryMoney`, `distancePctTenths`→`formatDistancePct`, medianMinor→`BoundaryMoney` → sort groups by `(roleCode, levelCode, countryCode)` asc and findings by `abs(distancePctTenths)` desc then `employeeId` asc → `{ kind:'findings'; report }`; wrap in `try/catch` → `unavailable`.
- [x] `src/adapters/db/employee-repository.ts` + `src/adapters/db/settings-repository.ts` -- implement `findAllPeerGroups` (whole-population load, in-process grouping, `is_active`-inclusive labels) and `readSettings` (`id:1`).
- [x] `src/app/employees/employee-deps.ts` + `src/app/settings/settings-deps.ts` -- forward `findAllPeerGroups`; add `outlierFindingsDeps()` and the lazy settings repository + `settingsReadDeps()` (deferred construction so a DB-free surface yields `unavailable`, not a build throw).
- [x] `tests/integration/outliers.test.ts` -- against real Postgres 18: prove `findAllPeerGroups` groups by the exact triple, includes an inactive reference row's label, excludes a not-yet-effective member at a past `asOf` (changing `n`), and that median/distance/flag are computed in TS; prove `readSettings` returns the seeded default (`20`, `USD`). Claim an unused `level.rank` band (document it).

**Acceptance Criteria:**
- Given a `(role, level, country)` group of ≥ 5 in-population employees with at least one member beyond the threshold, when `getOutlierFindings` runs, then that group appears as `kind:'outliers'` with its `peerMedian`, `n`, single currency, and one finding per beyond-threshold member (signed one-decimal `distancePct`, `employeeName`, `salary` as `BoundaryMoney`); a group with no beyond-threshold member does not appear.
- Given a group with `1 ≤ n < 5`, when the sweep runs, then it appears as `kind:'refusal'`, `reason:'thin-peer-group'`, `counts.n` = the size, no median computed, never widened.
- Given the threshold is 20%, then a member exactly 20.0% from the median does not flag and one at 20.1% does — exact `bigint` arithmetic, never float.
- Given no outliers and no thin groups as of `asOf`, then the result is `kind:'findings'` with `groups: []`.
- Given identical data, `asOf`, and threshold, when run twice, the payload is byte-identical and its group/finding order is stable; no clock/random/settings read appears in `src/domain/**` or inside the sweep.
- Given `getSettings`, then it returns the persisted `outlierThresholdPct` (default 20) and `reportingCurrency`; a repository throw on either read returns `unavailable` — no exception crosses the boundary.
- Given the full gate suite: lint, typecheck, import-boundary, coverage-floor, and domain mutation testing all pass, and the integration test is green against real Postgres 18.

## Spec Change Log

_No bad_spec loopback occurred — empty._

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 1: (high 0, medium 0, low 1)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[low]` `[patch]` Refusal payload emitted a flat `n`, but the intent-contract I/O matrix + AC specify `counts.n` and the sibling CAP-5 `PeerRefusal` uses `counts: { n }`. Aligned the refusal arm to `counts: { n }` in `src/application/use-cases/outliers.ts` (type + construction), updated `tests/application/outliers.test.ts` and `tests/integration/outliers.test.ts`, and corrected the Design Notes contract snippet. A shared 7-2 consumer now reads `counts.n` for both capabilities.
  - `[low]` `[patch]` The peer-group key `` `${roleCode}|${levelCode}|${countryCode}` `` could collapse two distinct triples into one group (wrong `n`/median) if any reference code ever contained the `|` delimiter. Hardened both the adapter grouping key (`src/adapters/db/employee-repository.ts`) and the use-case `keyOf` (`src/application/use-cases/outliers.ts`) to a delimiter-safe `JSON.stringify([...])`; both remain byte-identical for valid codes so all existing tests pass unchanged.
- notes: Blind Hunter (adversarial-general) + Edge Case Hunter, deduplicated. The core boundary/flag math is correct and well-pinned — strict `bigint` `|d| > threshold` giving 19.9/20.0-no and 20.1-yes symmetrically, half-up-before-compare (20.05 → 201), single reused `median`/`resolveCurrentSalary`/`distancePctTenths`, domain imports nothing outward, `asOf`/threshold honest parameters, deterministic payload via explicit group/finding sorts. Deferred (1, low): the sweep computes the median across all in-population amounts and labels the group with the first member's currency — safe only under country→currency immutability, which the app enforces (no country-edit path, currency validated at write, append-only) but the schema does not pin on `country.currency_code`; identical to CAP-5's deferred single-currency-guard item, logged to `deferred-work.md`. Rejected (9, all low/unreachable-by-invariant or design-sourced): payload carries no `CurrencyFormat` (mirrors the shipped CAP-5 contract; 7-2 uses the established `is_active`-inclusive format source); `sweepOutliers` internal order (shipped payload is deterministic via the use-case sorts; no other consumer); non-integer threshold masked as `unavailable` (`settings.outlier_threshold_pct` is an `Int` with CHECK 1–100 — always integer at the source); unbounded full-population load (inherent to AD-12 fresh-per-request, no materialization); integration settings assertion on the singleton row (correctly asserts the seeded default; no write path exists to make it flaky); adapter group-drop arms untested (unreachable via FK constraints; defensive depth); `reportingCurrency` unused in the outlier path (by design — no FX in CAP-6; it is a CAP-9 concern); the three-pass re-key join (clarity, no defect; delimiter footgun already hardened); even-`n` median not exercised through the sweep (the even-`n` half-up median is fully covered in the statistics suite; the sweep only delegates).

## Design Notes

**Why the sweep does not reuse `comparePeers`:** `comparePeers` computes the distance for ONE subject against the group median. The sweep must flag EVERY member, so it iterates the in-population set and calls the standalone `distancePctTenths(memberSalaryMinor, medianMinor)` directly. Same median, same exact arithmetic — just applied per member. This keeps "exactly one distance function" intact.

**Finalized boundary contract (story 7-2 consumes unmodified):**

```ts
export type GetOutlierFindingsResult =
  | { readonly kind: 'findings'; readonly report: OutlierReport }
  | { readonly kind: 'unavailable' };

type OutlierReport = {
  readonly asOf: PlainDate;
  readonly thresholdPct: number;          // the integer percent judged against (receipt)
  readonly groups: readonly OutlierFindingGroup[];   // outlier sections + inline refusals, ordered
};

type OutlierPeerGroup = {                 // codes (provenance) + display labels (row: "role · location")
  readonly roleCode: string; readonly levelCode: string; readonly countryCode: string;
  readonly roleName: string; readonly levelLabel: string; readonly countryName: string;
};

type OutlierFindingGroup =
  | { readonly kind: 'outliers'; readonly peerGroup: OutlierPeerGroup; readonly n: number;
      readonly currency: string; readonly peerMedian: BoundaryMoney;
      readonly findings: readonly OutlierFinding[] }
  | { readonly kind: 'refusal'; readonly peerGroup: OutlierPeerGroup;
      readonly counts: { readonly n: number };   // matches CAP-5 PeerRefusal.counts.n
      readonly reason: 'thin-peer-group' };

type OutlierFinding = {
  readonly employeeId: string; readonly employeeName: string;
  readonly salary: BoundaryMoney;
  readonly distancePct: string;           // signed one decimal: "25.0", "-30.0" (never "0.0" — always > threshold)
};
```

**No verdict sentence (scope boundary):** DESIGN's findings-row is `name · role·location · peer count · badge`, where the badge text (`+28.4% above median` / `-25.2% below median`) is DERIVED by the UI from the signed `distancePct` (sign = direction word). The CAP-5 verdict SENTENCE lives on the employee-detail card, not the findings row — so `verdict.ts` is untouched. If review finds the design mandates a per-finding sentence, that is a `Block If` / bad_spec loopback, not a silent addition.

**Threshold units:** `settings.outlier_threshold_pct` is an integer percent (DB CHECK `>0 AND <=100`). The boundary passes it as `thresholdPct: number`; the use-case converts to `thresholdPctTenths = BigInt(thresholdPct) * 10n` at the domain edge so the flag comparison is pure `bigint` (matching `distancePctTenths`). The report echoes the integer `thresholdPct` as the receipt.

**Inline thin-group refusals (design-sourced decision):** AD-16 and UX-DR8 require every `n < 5` group to appear as a refusal row, "never silently omitted." The sweep therefore emits a refusal entry for each thin group (`1 ≤ n < 5`); `n = 0` groups (nobody effective as of `asOf`) are omitted as degenerate.

## Verification

**Commands:**
- `npm run test -- tests/domain/outliers.test.ts tests/application/outliers.test.ts tests/application/settings.test.ts` -- expected: all green (written test-first).
- `npm run test` -- expected: full unit/application suite green; coverage floor on `src/domain` + `src/application` holds.
- `npm run test:mutation` -- expected: no surviving mutant over `src/domain` (sweep flag/boundary/median reuse).
- `npm run typecheck` && `npm run lint` -- expected: clean, including the import-boundary rule (domain imports nothing outward; app imports only domain).
- `npm run test:integration` -- expected: green against Postgres 18 (`DATABASE_URL` + `DATABASE_URL_APP` set).

## Auto Run Result

Status: **done**

### Summary
Implemented CAP-6 (outlier sweep + adjustable threshold), backend slice, fully test-first. Home can now be answered by a single read that sweeps the entire as-of population, groups it into `(role, level, country)` peer groups, and — for each group of 5+ — flags every member whose signed distance from the group median exceeds the threshold (either direction, one finding each, boundary exact: 19.9% no, 20.0% no, 20.1% yes, all in exact `bigint` arithmetic). Thin groups (`1 ≤ n < 5`) appear inline as `refusal` rows naming `counts.n`, never widened; groups with no outlier are omitted; an empty population yields `groups: []`. The threshold is persisted org config (default 20%, seeded), read once at the boundary via a new settings read and passed inward as a required explicit parameter — same discipline as `asOf` — so the payload is a deterministic, byte-identical function of `(data, asOf, threshold)`. Every figure crosses the boundary carrying its receipts (peer group, `n`, currency, `peerMedian`, `asOf`, `thresholdPct`) as a discriminated union; a repository outage returns `unavailable`, never an exception. The CAP-5 primitives (`median`, `distancePctTenths`, `resolveCurrentSalary`, `MIN_PEER_GROUP_SIZE`) are reused unchanged — no second median/resolver/distance, and `verdict.ts` is untouched.

### Files changed
- `src/domain/outliers.ts` (new) -- pure, total `sweepOutliers(groups, asOf, thresholdPctTenths)`; per group: in-population filter → `n<5` thin refusal (no median) → else `median` + per-member `distancePctTenths` → strict `bigint` `|d| > threshold` flag; returns only findings-bearing groups.
- `src/application/use-cases/outliers.ts` (new) -- `getOutlierFindings`, the finalized `{ kind:'findings'; report } | { kind:'unavailable' }` payload (deterministic group + finding sort; threshold→tenths at the app edge; Money→`BoundaryMoney`; `try/catch` → `unavailable`).
- `src/application/ports/settings-repository.ts` + `src/adapters/db/settings-repository.ts` + `src/application/use-cases/settings.ts` (new) -- read the single-row `settings` (`id:1`) → `getSettings` → `{ kind:'settings'; outlierThresholdPct; reportingCurrency } | { kind:'unavailable' }`.
- `src/application/ports/employee-repository.ts` -- added `findAllPeerGroups()` + `PeerGroupPopulation`/`OutlierCandidate` types (whole-population, `is_active`-inclusive labels).
- `src/adapters/db/employee-repository.ts` -- implemented `findAllPeerGroups` (load all employees + name + triple + unordered history; group in-process by a delimiter-safe JSON key; no as-of/`ORDER BY`/`COUNT`/stats in SQL).
- `src/app/employees/employee-deps.ts` -- forwarded `findAllPeerGroups`; added `outlierFindingsDeps()`. `src/app/settings/settings-deps.ts` (new) -- lazy settings repository + `settingsReadDeps()` (deferred construction so a DB-free surface yields `unavailable`).
- Tests (new): `tests/domain/outliers.test.ts`, `tests/application/{outliers,settings}.test.ts`, `tests/integration/outliers.test.ts` (real Postgres 18; `level.rank` band 2_040_000_000–2_045_999_999). Six existing port-fake test files widened for `findAllPeerGroups`.

### Review findings breakdown
- **Patches applied (2, low):** (1) refusal payload aligned to `counts: { n }` to match the intent-contract matrix/AC and the sibling CAP-5 `PeerRefusal`; (2) peer-group key hardened from a `|`-join to a delimiter-safe `JSON.stringify([...])` in both the adapter and the use-case (behavior-identical for valid codes).
- **Deferred (1, low):** no defensive single-currency guard in the sweep — construction-safe today, identical to CAP-5's deferred item; logged to `deferred-work.md`.
- **Rejected (9, all low):** see Review Triage Log — all unreachable-by-invariant, design-sourced, or precedent-consistent (payload `CurrencyFormat` mirrors CAP-5; sweep-internal order is re-sorted deterministically; `Int`-typed threshold; AD-12 fresh-per-request load; seeded-default assertion; FK-unreachable drop arms; CAP-9 `reportingCurrency`; re-key clarity; even-`n` median covered in the statistics suite).

### Verification performed
- `npm run test` -- 41 files, **1275 passed** (post-patch).
- `npm run test:integration -- tests/integration/outliers.test.ts` -- **4 passed** against real PostgreSQL 18 (proves in-process triple grouping, `is_active`-inclusive labels over a retired currency, AD-8 same-day tie-break, TS-computed median/distance/flag, an as-of rewind dropping a peer 5→4 into a thin refusal, and the seeded settings default 20/USD).
- `npm run typecheck` -- clean. `npm run lint` -- clean (import-boundary held: `src/domain` imports nothing outward).
- `npm run test:mutation` -- 100% mutation score, 0 survivors over `src/domain` (new `outliers.ts` 43/43 killed) from the implementation pass; the two patches touched only application + adapter + tests, leaving `src/domain/**` unchanged, so the domain mutation result stands.

### Residual risks
The one deferred item (single-currency guard) — low, construction-safe under current write-path invariants. The finalized boundary contract is ready for story 7-2, which consumes it unmodified (rendering the findings list, the badge from the signed `distancePct`, the inline refusal rows, the zero-findings state, CSV export, and the Settings threshold Apply mutation).
