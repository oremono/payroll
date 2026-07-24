---
title: 'Seed population backend (CAP-11)'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: '84d1bca82dcb975e773020c656c121f430f5f793'
final_revision: '85749ef17aaf3baead938372d541759acc917fdd'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-12-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** CAP-11 requires one command to populate 10,000 employees, byte-reproducibly from a fixed seed, with a population *engineered* to make every other capability demonstrable — comparable dense peer groups, deliberately thin cells (CAP-5 refusal), planted outliers (CAP-6), within-group gender gaps with ≥5 of each gender (CAP-7), and gender clustering across levels (CAP-8). Today there is no seed, no `Prng` port (the adapter is a throwing stub), no log-normal helper, and no deterministic UUIDv7 source; NFR8 (reproducible seed) and NFR1 (determinism) are unmet.

**Approach:** Test-first. Build the net-new randomness spine — a `Prng` port, a seeded PRNG adapter, and a pure log-normal helper — then a DB-free, clock-free population generator (application layer) that draws only from injected `Prng` + `IdGenerator` ports and emits the batch. `prisma/seed.ts` is a thin composition root that wires a fixed seed + fixed epoch + fixed as-of date, loads reference data, and writes through the **existing** `createEmployeesWithSalaries` funnel unchanged. **Reused unchanged:** the write funnel and its per-record guard (currency-from-country, no-future-dating, amount>0), reference-data loader, money primitives, `createUuidV7Generator` (via its injectable `now`/`randomBytes` seams). **Added:** `Prng` port, seeded PRNG adapter, log-normal domain helper, population generator, `prisma/seed.ts`, `npm run seed`. **Out of scope:** no schema/migration change, no UI (epic is backend-only), no change to the write funnel or reference data.

## Boundaries & Constraints

**Always:**
- Byte-reproducible: two runs of the generator with the same fixed seed produce an identical batch (same ids, amounts, dates, order). The seed constant, the UUIDv7 epoch, and the as-of date are hardcoded committed constants.
- Determinism (NFR1): no wall-clock, no `Math.random`, no `crypto` randomness, no `Date.now()`/`new Date()` anywhere in the seed path. Every id, amount, and date derives from the seed and fixed constants. Randomness enters only through the injected `Prng` port.
- The seed is a non-privileged client (AD-7): it writes exclusively through `createEmployeesWithSalaries`, passing the same validation every other write passes. Currency is resolved from country by the funnel (AD-6); the seed never sets `currency_code` itself. No future-dating: every `effectiveFrom`/`hireDate` ≤ the fixed as-of date (AD-18).
- Money is integer minor units + currency (AD-4); the minor-unit exponent comes from the currency reference row (JPY exponent 0 handled correctly — no hardcoded 100).
- TDD with real Postgres 18: domain/application logic stays pure, total, DB-free and clock-free; at least one integration test exercises persistence through the funnel against a real disposable Postgres 18, never a mock.
- The five structural obligations are asserted by tests over the full 10,000-row generated batch — engineered by construction, not left to the draw.

**Block If:**
- The 10,000 population cannot satisfy all five obligations without a schema or reference-data change (would signal a data-model gap, not a seed gap).
- The write funnel or reference-data loader turns out to require modification to admit the seed (the seed must be a pure client; needing to change the funnel is a contradiction to resolve, not to patch around).

**Never:**
- Never introduce a privileged/second write path, bypass the funnel, or write `currency_code` directly.
- Never read the wall clock or use `Math.random`/`crypto` for any seed value.
- Never seed both gender effects (within-group gap and cross-level clustering) into the same cell — clustering starves the sub-threshold the gap needs; keep them in separate cells.
- Never run the seed as a deploy/build side effect; it is an explicit `npm run seed` invocation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reproducible run | Fixed seed, fixed epoch, fixed as-of | Identical batch of 10,000 employees + opening salary records across runs (byte-identical serialization) | No error expected |
| Log-normal draw | Two unit uniforms u1,u2 ∈ [0,1), median m, sigma σ | Positive right-skewed value; deterministic in (u1,u2) | Clamp domain: u1=0 handled (no `log(0)`/`-Infinity`); returns finite positive |
| Currency from country | Generated employee in country X | Salary persisted with country X's reference currency and its exponent | Funnel throws if generator ever emits a mismatched currency (guards the invariant) |
| Thin cell | Role×country cell engineered to 1–3 people | Cell exists with 1–3 employees (CAP-5 refusal path demonstrable) | No error expected |
| Dense cell | Peer cell engineered to n ≥ 5 | Enough density that the n≥5 threshold does not starve the demo | No error expected |
| Planted outlier | Individual set far from cell median | Salary ≥ 2× (or ≤ 0.5×) the cell median, deviating well beyond the outlier threshold | No error expected |
| Gender gap cell | Cell with ≥5 of each of two genders | Median(one gender) < median(other) within the same role/level/country | No error expected |
| Gender clustering | Workforce-level allocation | Women's share at the two lowest levels exceeds their share at the two highest by a clear margin, in cells distinct from the gap cells | No error expected |

</intent-contract>

## Code Map

- `src/application/ports/prng.ts` -- NEW: `Prng` port (uniform + bytes stream).
- `src/adapters/prng.ts` -- IMPLEMENT: replace throwing stub with `createSeededPrng(seed)` returning a `Prng` (sole `Math.random`-exempt file, but a seeded PRNG needs none).
- `src/domain/salary-distribution.ts` -- NEW: pure log-normal from uniforms + level-progression / multiplier math; total, no throws.
- `src/application/seed/population.ts` -- NEW: `generatePopulation(deps)` → `readonly NewEmployeeWithSalary[]`; engineered cell layout + fixed distribution constants; draws only from injected `Prng`/`IdGenerator`.
- `src/adapters/id.ts` -- REUSE unchanged: `createUuidV7Generator(now, randomBytes)` composed with a fixed epoch + PRNG-backed bytes for deterministic ids.
- `src/application/ports/employee-repository.ts` -- REUSE: `NewEmployeeWithSalary` type + `createEmployeesWithSalaries` funnel signature.
- `src/adapters/db/employee-repository.ts` -- REUSE unchanged: the write funnel + `assertSalaryRecordWritable` guard.
- `src/domain/employee-fields.ts` / reference loader -- REUSE: `loadReferenceData()` → `{ roleCodes, levelCodes, countryCurrencies }`; currency exponents via `toCurrencyFormats`.
- `prisma/seed.ts` -- NEW: composition root wiring seed + epoch + as-of + reference data → generator → funnel.
- `prisma/seed.register.mjs` + `prisma/seed.hooks.mjs` -- NEW: standalone-Node ESM resolver for the `@/` alias + extensionless imports (composition-root runtime only; unused by app/tests).
- `package.json` -- ADD: `"seed"` script (`--max-old-space-size=4096` for Prisma-client type-stripping).
- `tests/domain/salary-distribution.test.ts`, `tests/adapters/prng.test.ts`, `tests/adapters/id.test.ts` (extend), `tests/application/population.test.ts`, `tests/integration/seed.test.ts` -- NEW/extend test pairs.

## Tasks & Acceptance

**Execution:** (each item is test-first — write the failing test, then the code)
- [x] `tests/domain/salary-distribution.test.ts` + `src/domain/salary-distribution.ts` -- pure Box–Muller standard-normal from two uniforms and `logNormal(median, sigma, standardNormal)`; level-progression and country-multiplier helpers. Total, finite, no throws; handle u1=0 boundary. *(domain 100% cov, mutation 18 killed / 0 survived)*
- [x] `src/application/ports/prng.ts` -- define the `Prng` port (type only).
- [x] `tests/adapters/prng.test.ts` + `src/adapters/prng.ts` -- `createSeededPrng(seed)` (sfc32 seeded via splitmix32, no `Math.random`): deterministic `nextUnit()` (∈ [0,1)) and `nextBytes(count)`; same seed → identical sequence; different seeds diverge; uniform-ish spread sanity.
- [x] `tests/adapters/id.test.ts` -- proves `createUuidV7Generator(fixedEpoch, prngBytes)` yields byte-identical, valid-v7, collision-free ids across two same-seed runs (no `src/adapters/id.ts` change).
- [x] `tests/application/population.test.ts` + `src/application/seed/population.ts` -- `generatePopulation({ prng, idGenerator, references, asOf })` → 10,000 `NewEmployeeWithSalary`. Test asserts: total = 10,000; byte-reproducibility; and all five obligations.
- [x] `prisma/seed.ts` + `package.json` -- composition root wiring fixed seed + fixed UUIDv7 epoch + fixed as-of `PlainDate` + reference load → `generatePopulation` → `createEmployeesWithSalaries(batch, asOf)`; added `"seed"` npm script (with `--max-old-space-size=4096` so the generated Prisma client type-strips under Node's native TS support). Composition-root ESM resolver helpers `prisma/seed.register.mjs` + `prisma/seed.hooks.mjs` teach standalone Node the `@/` alias + extensionless imports. Verified end-to-end against a throwaway Postgres 18 DB: `npm run seed` → exit 0, "Seeded 10000 employees" in ~3.4s.
- [x] `tests/integration/seed.test.ts` -- against real Postgres 18: persists a deterministic sub-batch through the funnel; asserts rows land, `currency_code` equals the country's reference currency, and a re-run with the same seed produces identical ids/amounts. Suffix-scoped / non-overlapping level-rank band; never truncates append-only tables.

**Acceptance Criteria:**
- Given the fixed seed, when the generator runs twice, then the two serialized batches are byte-identical (NFR8).
- Given a completed seed run, when employees are counted, then exactly 10,000 exist, each with an opening salary record whose `currency_code` matches its country's reference currency and whose amount > 0 (AD-4, AD-6).
- Given the generated population, when peer cells are inspected, then both dense cells (n ≥ 5) and thin cells (1–3 people) exist (CAP-5).
- Given the generated population, when outliers are inspected, then at least one individual sits ≥ 2× and at least one ≤ 0.5× their cell median (CAP-6).
- Given the generated population, when a designated gap cell is inspected, then it holds ≥ 5 of each of two genders and the median of one gender is below the other at the same role/level/country (CAP-7).
- Given the generated population, when the workforce is aggregated by level, then women's share at the two lowest levels clearly exceeds their share at the two highest levels, and this effect lives in cells distinct from the gap cells (CAP-8).
- Given no wall-clock or `Math.random` in the seed path, when lint/import-boundary/typecheck run, then they pass; the full gate is green: domain coverage 100% / application ≥ 90%, domain mutation 0 survivors, integration green on real Postgres 18.

## Spec Change Log

_No `bad_spec` loopback occurred; the spec was not amended during review. Review-pass patches were surgical code/test fixes, logged below._

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 3, low 6)
- defer: 0
- reject: 5: (high 0, medium 2, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Generator output depended on reference-input row order (tests hardcoded a different order than `loadFormOptions`' `ORDER BY name`, so obligations were asserted on a non-production layout) — `generatePopulation` now canonically sorts roles/countries by code and levels by rank for fill enumeration, making the batch byte-reproducible regardless of loader order. Re-verified all five obligations end-to-end on a throwaway Postgres 18.
  - `[medium]` `[patch]` `exponentOf`'s `?? DEFAULT_EXPONENT` silently applied exponent 2 to a currency missing from the map, which would persist a JPY-like (exponent-0) salary 100× inflated (violating AD-4) — now throws; `DEFAULT_EXPONENT` removed; unit test added for the throw.
  - `[medium]` `[patch]` The JPY exponent-0 currency (the marquee AD-4 case) never round-tripped through the real funnel (integration test persisted only the USD/GBP gap cells) — integration test now persists JP rows and asserts stored `currency_code='JPY'` with byte-equal `amount_minor` (no 100× scaling).
  - `[low]` `[patch]` Division by `fillCells.length` had no zero guard (would silently return ~91 rows) — added a fail-loud guard (defensively unreachable via the public API; kept as a tripwire).
  - `[low]` `[patch]` Planted-cell roles were not existence-checked (only level/country) — added `roleSet` checks to gap/outlier/thin cells so a missing role fails with a clean message instead of an opaque FK violation; test added.
  - `[low]` `[patch]` Fixed seed constants (`SEED`/`SEED_EPOCH_MS`/`SEED_AS_OF`) were duplicated as literals across three test files — extracted to `src/application/seed/config.ts`, imported by the seed and all tests, eliminating drift.
  - `[low]` `[patch]` `drawDate` clamped all current-year overshoot to exactly `asOf`, piling ~286 employees on one hire/effective date (a CAP-10 demo artifact) — now spreads overshoot to the prior year (verified: boundary count dropped from ~286 to 1).
  - `[low]` `[patch]` `seed.hooks.mjs` reported only the last resolution attempt on failure — now names the original specifier for debuggability.
  - `[low]` `[patch]` Design Notes composition sketch cited `loadReferenceData()` where the code correctly uses `loadFormOptions()` (carries level ranks + currency exponents) — sketch corrected.
  - Rejected (not acted on): asserting all 10,000 rows through the funnel in the integration suite (incompatible with the append-only / suffix-scoped, no-truncation isolation rule — covered instead by the in-memory 10k assertion, the sub-batch funnel test, and manual throwaway-DB verification); no automated test of the thin `prisma/seed.ts` composition root (idiomatic thin root matching the repo's deps-factory pattern, verified end-to-end, and its highest drift risk removed by sharing constants); UUIDv7 fixed-epoch forfeits v7 insert-ordering (accepted consequence of the determinism requirement; uniqueness tested); `toMinor`'s `Math.max(1,…)` floor (defensible positivity floor; the real silent-scaling vector is closed by the fail-loud exponent); `process.exit(0)` without `$disconnect` (harmless for a one-shot script that awaits all writes first).

### 2026-07-24 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 14: (high 0, medium 1, low 13)
- addressed_findings:
  - `[low]` `[patch]` `tests/adapters/prng.test.ts` still declared `const SEED = 0x5eed_1234` locally instead of importing it — the exact stale-literal trap `config.ts` was extracted to prevent (the invariant `id`/`population` tests already honour). Now imports `SEED` from `@/application/seed/config`; the divergence case reads `SEED + 1`. Pure test change; no seed output affected.
  - `[low]` `[patch]` CAP-7 obligation (c) asserted the ≥5-of-each-gender / women-median-below-men property on only the US gap cell, so the second planted gap cell (`data_scientist|L3|GB`, which also feeds the demo) could regress silently — the test now loops over both `GAP_CELLS` keys and asserts the property on each (with per-cell messages).
  - `[low]` `[patch]` CAP-5/density obligation (a) asserted only `sizes.some(n ≥ 5)`, trivially satisfied by the planted outlier/gap cells even if every fill peer cell starved to 1–4 — the "comparable dense peer groups" the demo rests on were effectively unverified against a future taxonomy that grows the grid faster than the population. Added `expect(sizes.filter(n ≥ 5).length).toBeGreaterThan(1000)` so broad density starvation fails loudly (current batch: ~1,195 dense cells).
  - Rejected (not acted on): cross-runtime float reproducibility of `Math.exp`/`log`/`cos` in the salary path (V8 ships a deterministic fdlibm implementation across platforms and the seed runs in a controlled Node runtime — the byte-reproducible claim holds in practice; not a defect); the funnel's no-future-date guard comparing `effectiveFrom` against the supplied `SEED_AS_OF` rather than a wall clock (by design — a deterministic seed cannot read the clock, so its fixed as-of *is* its "today"; AD-18 is met); `standardNormal(u1=0)` yielding a large-magnitude (~38σ) value (spec requires only *finiteness* at that boundary, which holds; the extreme needs `nextUint32()===0`, ~1/2³², which does not occur for the committed seed — verified clean population — and clamping would perturb a mutation-gated domain function beyond spec); rerunning `npm run seed` failing on a primary-key collision (the seed is one-shot by design, not idempotent); the whole load aborting if an active country's currency is dropped by the money-formatter filter or lacks an exponent (fail-loud on a real reference-data problem is the intended behavior); `applyCountryMultiplier(points, countryBase)` arg naming reading as base·multiplier when `countryBase` is an absolute figure (numerically correct — commutative; a truthful rename is a distribution redesign, not a patch); planted-cell exact-occupancy under-asserted beyond the existing ratio/thin-count checks (the `reserved` set already guarantees planted cells receive only planted people); `process.exit(0)` leaving the pool unclosed (re-flagged; harmless one-shot, rejected in the prior pass); redundant `spec === '@/'` disjunct and `.ts`-only fallback in `seed.hooks.mjs` (cosmetic; composition-root-only resolver coupled by design to the all-`.ts` `src/` graph); exponent-overflow / non-finite → cryptic `BigInt` error, `u1 >= 1`, equal-rank levels, planted > target size, and `nextBytes` negative/non-integer count (all unreachable via the committed config / the port's `[0,1)` contract / the id path's fixed `nextBytes(10)`; the size-mismatch case is caught immediately by the `toHaveLength(10000)` assertion in dev — future-refactor hardening, not defects in this change).

## Design Notes

Frozen `Prng` port contract (the downstream seam):

```ts
// src/application/ports/prng.ts
export type Prng = {
  /** Next uniform double in [0, 1). Deterministic given the seed. */
  readonly nextUnit: () => number;
  /** Next `count` deterministic bytes (feeds UUIDv7 randomBytes). */
  readonly nextBytes: (count: number) => Uint8Array;
};
```

Composition sketch (`prisma/seed.ts`, the composition root — the only place allowed to touch adapters + the wall-clock-free fixed constants):

```ts
const prng = createSeededPrng(SEED);                     // fixed committed constant
const idGenerator = createUuidV7Generator(() => SEED_EPOCH_MS, (n) => prng.nextBytes(n));
const references = await loadFormOptions();               // real reference codes (carries level ranks + currency exponents)
const batch = generatePopulation({ prng, idGenerator, references, asOf: SEED_AS_OF });
await createEmployeesWithSalaries(batch, SEED_AS_OF);     // existing funnel, unchanged
```

Rationale: **why log-normal, not normal** — real salaries are right-skewed (floor below, long tail above); normal draws erase the mean-vs-median distinction the product should surface. **Why engineered cells** — a single distribution makes every peer group look alike and no question interesting; the five obligations are allocated deliberately per cell (grid ≈ 25 roles × 6 levels × 8 countries ≈ 1,200 cells, ~8/cell average, but density is placed, not averaged). **Why country multipliers are cost-of-labour** (not cost-of-living) applied to a role/level base — makes the multi-currency story visible. **Why level progression ~15–20%/level** — the ladder stays coherent with no level inversions. **Why the id seam** — injecting a fixed epoch + PRNG-backed bytes into the existing `createUuidV7Generator` yields byte-reproducible valid UUIDv7 ids without a new adapter. **Why obligations are tested over the full batch in the fast suite** — they are DB-free structural properties; the integration test only proves the write path + currency/date validation + determinism against real Postgres.

## Verification

**Commands:**
- `npm run lint` -- expected: pass (no `Math.random`/`crypto`/wall-clock in seed path; import-boundary clean).
- `npm run typecheck` -- expected: pass.
- `npm test` -- expected: domain + application suites green; coverage floor met (domain 100%, application ≥ 90%); domain mutation 0 survivors.
- `npm run test:integration` -- expected: `tests/integration/seed.test.ts` green against real Postgres 18.
- `npm run seed` -- expected: exits 0; running twice against a fresh DB yields identical ids/amounts (spot-check reproducibility).

## Auto Run Result

Status: **done**

### Summary
Implemented CAP-11's deterministic seed. Built the net-new randomness spine (a `Prng` port, a seeded sfc32/splitmix32 PRNG adapter replacing the throwing stub, and a pure Box–Muller/log-normal domain helper), a DB-free/clock-free population generator that draws only from injected `Prng`/`IdGenerator` ports, and `prisma/seed.ts` — a thin composition root that wires a fixed seed + fixed UUIDv7 epoch + fixed as-of date and writes 10,000 employees (each with an opening salary record) through the **existing** `createEmployeesWithSalaries` funnel, unchanged. The population is byte-reproducible and engineered to plant all five structural obligations (dense + thin peer cells, high/low outliers, a ≥5-each gender-gap cell, and cross-level gender clustering in separate cells).

### Files changed
- `src/application/ports/prng.ts` (new) — the `Prng` port (`nextUnit` + `nextBytes`).
- `src/adapters/prng.ts` (impl) — `createSeededPrng(seed)`; replaced the throwing stub with a deterministic sfc32 PRNG (no `Math.random`).
- `src/domain/salary-distribution.ts` (new) — pure, total Box–Muller standard-normal, `logNormal`, level-progression + country-multiplier math.
- `src/application/seed/population.ts` (new) — `generatePopulation(deps)` → exactly 10,000 `NewEmployeeWithSalary`; engineered cell layout, canonical enumeration, fail-loud reference checks.
- `src/application/seed/config.ts` (new) — shared fixed constants `SEED` / `SEED_EPOCH_MS` / `SEED_AS_OF`.
- `prisma/seed.ts` (new) — composition root: seeded PRNG + fixed-epoch id generator + `loadFormOptions` → generator → funnel.
- `prisma/seed.register.mjs` + `prisma/seed.hooks.mjs` (new) — standalone-Node ESM resolver for the `@/` alias + extensionless imports (seed runtime only).
- `package.json` — added `"seed"` script (`--max-old-space-size=4096` so the generated Prisma client type-strips under Node's native TS support).
- Tests (new): `tests/domain/salary-distribution.test.ts`, `tests/adapters/prng.test.ts`, `tests/application/population.test.ts`, `tests/integration/seed.test.ts`; extended `tests/adapters/id.test.ts`.

### Review findings breakdown
9 patches applied (3 medium, 6 low) — canonical-sort determinism fidelity, fail-loud currency-exponent guard, JPY-through-funnel test coverage, empty-grid guard, planted-role validation, shared seed constants, hire-date spread, resolver error message, and a stale-spec doc fix. 0 intent gaps, 0 bad-spec loopbacks, 0 deferrals. 5 findings rejected (see Review Triage Log for rationale). Full detail in the Review Triage Log above.

### Verification performed
- `npm run lint` — pass (clean; no `Math.random`/`crypto`/wall-clock in the seed path; import-boundary clean).
- `npm run typecheck` — pass.
- `npm test` (fast + coverage) — pass: 1597 tests / 62 files; statements/lines/functions 100%, branches 98.95%; domain 100%; `application/seed/population.ts` branches 92.85% (≥90 floor); domain mutation gate 0 survivors on the new domain file.
- `npm run test:integration` — pass: 148 tests / 15 files incl. `seed.test.ts` (JPY exponent-0 round-trip through the real funnel) against Postgres 18.
- **End-to-end `npm run seed`** (independently, against a throwaway Postgres 18 DB, then dropped): exit 0, "Seeded 10000 employees" in ~3.4s. DB checks: 10,000 employees / 10,000 salary records; 0 currency mismatches; 0 future-dated; 0 non-positive amounts; thin cells 5 / dense cells 1,195; gender clustering female 66.0% (low levels) vs 24.6% (high); gap cell software_engineer|L3|US 8F (median < ) 8M; outliers ≥2× and ≤0.5× cell median; JPY stored correctly as exponent-0 minor units; post-PATCH-7 as-of-boundary hire-date pile-up reduced to 1. The shared test DB was never polluted.

### Residual risks
- The `prisma/seed.ts` composition root is exercised end-to-end (verified) but has no dedicated automated test — an idiomatic thin root; its highest drift risk (duplicated constants) is now eliminated by `config.ts`. Deliberately not converted to a testable form to avoid restructuring working, verified code.
- Byte-reproducibility is guaranteed for a fixed enumeration; changing the reference taxonomy or the seed constants intentionally changes the population (as designed).

### Follow-up review pass (2026-07-24)
A fresh independent review pass ran Blind Hunter + Edge Case Hunter over the full diff. No intent gaps, no spec defects, and no `high`/`medium` behavioral defects survived triage. Three `low`, **test-only** hardenings were applied (no production/seed code touched, so the population output is byte-identical to the prior pass): (1) `prng.test.ts` now imports `SEED` from `config.ts` instead of a stale local literal; (2) the CAP-7 gender-gap obligation is now asserted on **both** planted gap cells; (3) the CAP-5 density obligation now asserts broad peer-group density (~1,195 cells at n ≥ 5) rather than a single `.some(n ≥ 5)` that planted cells satisfied trivially. Fourteen further findings were rejected with rationale (see Review Triage Log) — the notable ones (cross-runtime float determinism, the deterministic-clock as-of guard, the `u1=0` magnitude boundary) are either spec-compliant by design or unreachable with the committed seed.

**Verification this pass:** `npm run lint` — pass; `npm run typecheck` — pass; `npm test` — 1597 tests / 62 files, all green; `npm run test:coverage` — all files 100% stmts / 98.95% branch / 100% funcs / 100% lines, `population.ts` branch 92.85% (≥ 90 floor). Domain source and the seed/integration path are unchanged from the prior pass (which verified integration on Postgres 18 and the end-to-end `npm run seed` run), so those results carry forward; the domain mutation gate (0 survivors) is unaffected.
