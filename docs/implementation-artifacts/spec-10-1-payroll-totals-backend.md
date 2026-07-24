---
title: 'CAP-9 Payroll Totals — Backend'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: '2ec0c69099fd085a43f192f247ff2cd8c26c2b26'
final_revision: '02ccebc7eabeae39bc91915ba064a899c78739d3'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/docs/project-context.md', '{project-root}/docs/implementation-artifacts/epic-10-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The org has no view of what it spends on salary. CAP-9 must report, over the exact as-of population (AD-16), a per-country total in each country's own local currency (never converted) and a single org-wide total in the reporting currency — which necessarily spans currencies and so must carry its receipts (the FX rate(s) used and the date they were pinned to), or refuse out loud when the rates needed are missing rather than invent a number. SQL computes no total or count a user sees (AD-2/Law 2).

**Approach:** Deliver the backend slice test-first, reusing primitives unchanged — the ONE `resolveCurrentSalary` (AD-8) for population membership and current salary, `Money`/`BoundaryMoney`/`toBoundaryMoney`, `divideRoundHalfUp` (the ONE rounding primitive), `CurrencyFormat`, and `PlainDate`. Add: a pure `src/domain/fx.ts` (rate-set resolution by greatest `pinnedOn ≤ asOf`, and exact integer minor-unit conversion built on `divideRoundHalfUp`); a pure `src/domain/payroll-totals.ts` orchestrator that sums each country in its own currency, then converts each country total **once** to the reporting currency and sums (AD-13's fixed order), or returns an org-wide **refusal**; an org-wide read (`findPayrollTotalsPopulation`) plus a new FX read (`findAllFxRates`) and a reporting-currency read (existing `settingsRepository.readSettings`); one use-case (`getPayrollTotals`) returning the finalized AD-20 payload; deps wiring; and an integration test against real Postgres 18. **No page/RSC/Server Action/CSV/UI/Home metric — that is story 10-2. No verdict sentence or copy-answer** (CAP-9 provenance is structured receipts the UI renders as an ambient caption; see Design Notes).

## Boundaries & Constraints

**Always:**
- Obey every Law in `project-context.md`. The DB SELECTs rows/sets only; every per-country total, org-wide total, and headcount is summed/counted in TypeScript (AD-2, Law 2) — no `SUM`/`AVG`/`COUNT`/`GROUP BY`/window/`percentile_cont` for any user-facing figure.
- The as-of population defines every figure (AD-16): an employee is in-population at `asOf` iff `resolveCurrentSalary(salaryRecords, asOf) !== null`, and its resolved current record supplies the salary that enters that country's sum. Reuse the ONE `resolveCurrentSalary` (AD-8); write NO second resolver and NO second membership test. (Provably equal to AD-16's `hireDate ≤ asOf AND ∃ effective_from ≤ asOf` because every write path enforces `effective_from ≥ hire_date`.)
- **Sum people's current salaries, not records.** A person with several records contributes exactly one amount (their as-of current salary) to exactly one country. Per-country `n` is the count of distinct in-population employees in that country.
- **Per-country totals NEVER convert** (AD-13). Each country's total is the sum of its in-population employees' as-of current-salary `amountMinor`, in that country's single currency (currency taken from the resolved salary `Money`; AD-6 guarantees one currency per country). No cross-currency arithmetic in a per-country figure.
- **Money is exact.** Amounts are integer minor units + ISO-4217 code; the minor-unit exponent comes from the currency reference (`minorUnitExponent`, JPY 0 / USD 2 / INR 2) — never a hard-coded 100. Rate arithmetic is exact integer/rational via `divideRoundHalfUp`, never float; round half-up to the **target** currency's minor unit at the **final** conversion step only. At the boundary, every amount serializes via `toBoundaryMoney` (`amountMinor` → decimal string), never a number or raw bigint.
- **FX direction is fixed:** `fx_rate(from_currency = C, to_currency = R, rate)` means 1 unit of C = `rate` units of R. To convert a country total (currency C) to reporting currency R, look up the pair `(C → R)` and multiply. A country already in R contributes directly, needs no rate, and is absent from `ratesUsed`.
- **Org-wide total order is fixed (AD-13):** sum each country in its own currency → convert each country total **once** to R → sum the converted totals. Never per-employee conversion. Integer sums are order-independent; per-country ordering is display-only.
- **Rate-set resolution (AD-13):** a rate set is all `fx_rate` rows sharing one `pinnedOn` (written whole). A conversion uses the set with the greatest `pinnedOn ≤ asOf`. Resolve over rows for the **needed pairs only** (distinct `C → R` where C ≠ R), pick the single greatest `pinnedOn ≤ asOf`, then require every needed pair present at that date. If none such set exists → org-wide **refusal** `no-rate-set`; if the set lacks a needed pair → refusal `missing-rate` naming the absent pair(s). The reporting currency is `settings.reporting_currency` — exactly one, never inferred from data.
- Answers carry receipts (Law 8 / AD-20). The use-case returns `{ kind: 'answer'; totals } | { kind: 'unavailable' }`. `totals` = `{ asOf, perCountry[], orgWide }`. Each `perCountry` entry carries `{ countryCode, countryName, currency, n, total: BoundaryMoney }`, ordered by `countryCode` ascending. `orgWide` is itself a discriminated union `{ kind:'answer'; reportingCurrency; total: BoundaryMoney; ratesUsed: RateReceipt[]; pinnedOn: PlainDate|null } | { kind:'refusal'; reason:'no-rate-set'|'missing-rate'; reportingCurrency; asOf; pinnedOn: PlainDate|null; missingPairs: CurrencyPair[] }`. `pinnedOn`/`ratesUsed` are `null`/`[]` when no conversion was needed (all countries already in R, or empty population). Domain functions are TOTAL; the use-case wraps every repository access in `try/catch` → `{ kind:'unavailable' }`. (Finalized shape in Design Notes — story 10-2 consumes it unmodified.)
- `asOf` is a required explicit `PlainDate` argument to every domain/application function; no `Date`/clock/random/env read in `src/domain/**` or the use-case. Same data + same `asOf` ⇒ byte-identical payload. Computed fresh per request (AD-12) — no totals table, no cache.
- TDD (Law 1): every domain/application function has a failing test written first; the fast suite touches no DB/clock/network. At least one adapter integration test runs against real disposable Postgres 18 (never a mock). Domain mutation testing stays at 100% (0 survivors) over `src/domain` — including `fx.ts` and `payroll-totals.ts`.

**Block If:**
- `findPayrollTotalsPopulation`, `findAllFxRates`, or reading `reporting_currency` cannot be implemented without a schema/migration change (the `fx_rate` table with `from_currency`/`to_currency`/`rate`/`pinned_on`, `settings.reporting_currency`, `currency.minor_unit_exponent`, and `salary_record`/`employee` fields all already exist — a needed change signals an unexpected data-model gap).
- A planning source is found to mandate that the CAP-9 org-wide total or refusal carry a **composed natural-language verdict sentence from `src/domain/verdict.ts`** (rather than structured receipts the UI formats), or that per-country rows carry a verdict/copy-answer — none is derivable here and the closest sibling (CAP-8) deliberately composes none. (EXPERIENCE frames CAP-9 provenance as an ambient `provenance-caption` component over structured receipts, not a verdict card.)
- A source mandates a **specific canonical ordering** for per-country rows other than a deterministic key order (e.g. a ratified "largest payroll first" ranking) — no cross-currency ranking rule is ratified, so `countryCode` ascending is the deterministic default, not an invented ranking.

**Never:**
- Never convert a per-country total, convert per-employee, or let a converted number reach the payload without its `ratesUsed` + `pinnedOn`. Never round anywhere but the final per-country-total conversion step. Never read FX or reporting currency inside `src/domain/**`'s pure functions except as passed-in arguments.
- Never let the DB compute a displayed total/count (no `SUM`/`COUNT`/`GROUP BY`/window/`AVG`); never sum salary records instead of people's current salaries; never re-resolve currency from `employee.country` at read time (use the salary record's currency); never hard-code a minor-unit exponent.
- Never throw across the boundary — a missing rate set or pair is a **refusal return value**, not an exception; a repository failure maps to `unavailable`. Never widen or guess a rate; never partially convert (if any needed pair is missing, the whole org-wide total refuses).
- Never add a `verdict`/copy-answer string, a `not-found` arm (org-wide, no subject employee), a Server Action, Route Handler, CSV export, page/RSC, Home metric, or any UI — those are story 10-2. This story is read-only. Never seed `fx_rate` rows in a migration (production seeding is out of scope; the integration test creates its own).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy, multi-currency | Countries in USD/INR/JPY with in-population employees; rate set present with all needed `→ USD` pairs at `pinnedOn ≤ asOf` | `answer`; `perCountry` each in local currency ordered by `countryCode`, each with `n`; `orgWide.answer` `total` in USD, `ratesUsed` = distinct non-USD source rates applied, `pinnedOn` = set date | No error |
| No conversion needed | Every in-population country's currency == reporting currency | `orgWide.answer`; `total` = plain sum in R; `ratesUsed: []`; `pinnedOn: null` — NOT a refusal | No error |
| Empty population | No employee in-population at `asOf` | `answer`; `perCountry: []`; `orgWide.answer` `total` = 0 in R, `ratesUsed: []`, `pinnedOn: null` | No error |
| No rate set as of date | Some country needs conversion; no `fx_rate` set has `pinnedOn ≤ asOf` for the needed pairs | `orgWide.refusal` `reason:'no-rate-set'`, `pinnedOn:null`, `missingPairs:[]`; `perCountry` still fully present | No error |
| Missing pair in set | A set resolves at `pinnedOn ≤ asOf` but lacks e.g. `EUR → USD` | `orgWide.refusal` `reason:'missing-rate'`, `pinnedOn` = set date, `missingPairs:[{EUR,USD}]`; `perCountry` present | No error |
| Set resolution by date | Sets pinned 01 Jun and 01 Jul; `asOf` 16 Jul | Uses 01 Jul set; `asOf` 20 Jun uses 01 Jun; `asOf` before earliest → `no-rate-set` | No error |
| Exponent-aware convert | Convert JPY (exp 0) total to USD (exp 2) via `JPY→USD` | `divideRoundHalfUp(A × num × 10^expR, den × 10^expC)`; correct minor-unit scaling both directions | No error |
| Rounding boundary | Conversion lands exactly on a half minor unit | Magnitude rounds half-up, then sign (positive here) — same rule as AD-5 | No error |
| Person, multiple records | In-population employee with two same-day records | One amount enters the sum (their as-of current salary via `resolveCurrentSalary`); `n` counts the person once | No error |
| As-of rewind drops member | A member future-hired / whose only salary not yet effective at a past `asOf` | Excluded (`resolveCurrentSalary === null`); that country's `total` and `n` recomputed lower, or country omitted if it drops to 0 | No error |
| Reporting country mixed in | Some countries in R, others not; rates present | R-countries contribute directly (absent from `ratesUsed`); others converted; org total sums all | No error |
| Shared currency, two countries | Two countries both in EUR; `EUR→USD` present | Each country total converts once with the same rate; both summed; `ratesUsed` has one deduped `EUR→USD` | No error |
| Repository throws | Any of the three reads rejects | `getPayrollTotals` → `{ kind:'unavailable' }` | Caught; no exception crosses the boundary |

</intent-contract>

## Code Map

- `src/domain/salary-timeline.ts` -- REUSE `resolveCurrentSalary` (AD-8) and `SalaryRecordOrder`/`SalaryRecordView` (the view carries `salary: Money`) for membership + current salary.
- `src/domain/money.ts` -- REUSE `Money`, `BoundaryMoney`, `toBoundaryMoney`, `CurrencyFormat`, `divideRoundHalfUp` (the ONE rounding primitive; use `?? 0n` exactly as `peer-comparison.ts`/`gender-gap.ts` do where the denominator is provably positive). money.ts hosts NO FX (its README forbids it) — FX is a new module.
- `src/domain/plain-date.ts` -- REUSE `PlainDate` and its comparison helpers (rate-set date resolution).
- `src/domain/fx.ts` -- NEW, pure. `resolveRateSet(rows: readonly FxRateRow[], asOf: PlainDate): ResolvedRateSet | null` (rows AT the single greatest `pinnedOn ≤ asOf`, else `null`) and `convertMinorUnits(amountMinor: bigint, rate: FxRateRow, fromExponent: number, toExponent: number): bigint` (= `divideRoundHalfUp(amountMinor * rate.rateNumerator * 10^toExp, rate.rateDenominator * 10^fromExp) ?? 0n`). Types `FxRateRow = { fromCurrency; toCurrency; rate: string; rateNumerator: bigint; rateDenominator: bigint; pinnedOn: PlainDate }`, `ResolvedRateSet = { pinnedOn: PlainDate; rows: readonly FxRateRow[] }`, `CurrencyPair = { fromCurrency; toCurrency }`.
- `src/domain/payroll-totals.ts` -- NEW, pure. `computePayrollTotals(input): PayrollTotalsResult`. Folds candidates → per-country sums (Money-typed) + `n`; computes needed pairs; converts each country total once via `fx.ts`; returns per-country list (always) + org-wide `answer|refusal`. Types `PayrollCandidate`, `CountryRef`, `CurrencyRef`, `CountryTotal` (Money), `PayrollTotalsResult` (see Design Notes).
- `src/application/ports/fx-rate-repository.ts` -- NEW. `FxRateRepository = { findAllFxRates(): Promise<readonly FxRateRow[]> }` (imports `FxRateRow` from `src/domain/fx.ts`). Read-only; loads rows, domain resolves the set (mirrors "adapter loads, domain resolves" of `findAllPeerGroups` + `resolveCurrentSalary`).
- `src/application/ports/employee-repository.ts` -- ADD `findPayrollTotalsPopulation(): Promise<PayrollTotalsPopulation>` + `PayrollTotalsPopulation = { candidates: readonly PayrollCandidate[]; countries: readonly CountryRef[]; currencies: readonly CurrencyRef[] }`. Org-wide read-only sibling of `findAllPeerGroups`; grouping/counting/as-of stay in the domain (AD-2/AD-16).
- `src/application/ports/settings-repository.ts` -- REUSE `readSettings()` → `{ reportingCurrency }` (throws if the single row is absent → use-case maps to `unavailable`).
- `src/adapters/db/fx-rate-repository.ts` -- NEW. `createFxRateRepository(client = getDbClient())`; `findAllFxRates`: `fxRate.findMany({ select:{ fromCurrency, toCurrency, rate, pinnedOn } })`; decompose each `Prisma.Decimal rate` to `{ rate: string, rateNumerator: bigint, rateDenominator: bigint }` exactly via its fixed-scale string (no float — `Decimal(18,8)`); `pinned_on` → `PlainDate`.
- `src/adapters/db/employee-repository.ts` -- IMPLEMENT `findPayrollTotalsPopulation`: parallel `Promise.all` of `employee.findMany({ select:{ countryCode, salaryRecords:{ select:{ seq, effectiveFrom, amountMinor, currencyCode } } } })` (NO where/orderBy/count/groupBy), `country.findMany` (→ `CountryRef{ countryCode, countryName }`), `currency.findMany` (→ `CurrencyRef` = `CurrencyFormat` + `code`, guarded by `isSupportedExponent`). Map `DateTime`→`PlainDate`, build each record's `salary: Money`.
- `src/app/employees/employee-deps.ts` -- forward `findPayrollTotalsPopulation` on `lazyEmployeeRepository`; export `payrollTotalsDeps()` (repository + `createFxRateRepository()` + settings repository), mirroring `genderDistributionDeps()`/`outlierFindingsDeps()`.
- `src/application/use-cases/payroll-totals.ts` -- NEW. `getPayrollTotals(deps, asOf)` → the finalized `answer|unavailable` payload; `toBoundaryMoney` on every total; `try/catch` → `unavailable`.
- `tests/domain/fx.test.ts`, `tests/domain/payroll-totals.test.ts`, `tests/application/payroll-totals.test.ts`, `tests/integration/payroll-totals.test.ts` -- NEW (test-first). Existing fake-repository helpers widen for the new port method(s).

## Tasks & Acceptance

**Execution:**
- [x] `tests/domain/fx.test.ts` + `src/domain/fx.ts` -- test-first, then implement `resolveRateSet` (greatest `pinnedOn ≤ asOf`; `null` when none; a "set" is every row at that one date; ignores later sets and rows above `asOf`) and `convertMinorUnits` (exponent combinations incl. JPY exp 0 both as source and target; half-up rounding boundary; identity is NOT this function's job — the orchestrator skips conversion when C == R). Cover the matrix's FX rows. Pure, total, deterministic.
- [x] `tests/domain/payroll-totals.test.ts` + `src/domain/payroll-totals.ts` -- test-first, then implement `computePayrollTotals`. For each candidate: `resolveCurrentSalary(salaryRecords, asOf)`; if non-null, add its `salary.amountMinor` to that `countryCode`'s running total and increment `n`; currency = the salary's currency. Build `perCountry` (one entry per country with `n > 0`) as `{ countryCode, countryName (from countries), currency, n, total: Money }`, ordered by `countryCode` asc. Compute `neededPairs` = distinct `{ from: countryCurrency, to: reportingCurrency }` where currency ≠ reporting. If `neededPairs` empty → `orgWide` answer summing per-country totals directly (all already in R), `ratesUsed:[]`, `pinnedOn:null`. Else filter `fxRates` to needed pairs, `resolveRateSet(filtered, asOf)`: `null` → refusal `no-rate-set`; else for each needed pair require a row in the set (else refusal `missing-rate` with all absent pairs, `pinnedOn` = set date); else `convertMinorUnits` each country total once (exponents from `currencies`), sum → `orgWide` answer `total` in R, `ratesUsed` = deduped applied rows, `pinnedOn` = set date. Cover EVERY domain I/O-matrix row.
- [x] `src/application/ports/fx-rate-repository.ts` + `src/application/ports/employee-repository.ts` -- add the FX port and `findPayrollTotalsPopulation` + its population/candidate/country/currency types (import `FxRateRow` from domain `fx.ts`, `Money`/`CurrencyFormat`, `SalaryRecordOrder`). Document both as read-only org-wide reads whose grouping/counting/resolution belong to the domain.
- [x] `tests/application/payroll-totals.test.ts` + `src/application/use-cases/payroll-totals.ts` -- test-first against fake ports, then implement `getPayrollTotals(deps, asOf)`: `try` → `Promise.all([findPayrollTotalsPopulation(), findAllFxRates(), readSettings()])` → `computePayrollTotals({ ...population, reportingCurrency, fxRates, asOf })` → serialize every `Money` via `toBoundaryMoney` into the boundary payload → `{ kind:'answer', totals }`; `catch` → `{ kind:'unavailable' }`. Assert: the answer shape (per-country ordered, `n`, boundary money), org-wide answer with `ratesUsed`/`pinnedOn`, both refusal reasons, no-conversion-needed, empty population, and each repository throwing → `unavailable`.
- [x] `src/adapters/db/fx-rate-repository.ts` + `src/adapters/db/employee-repository.ts` + `src/app/employees/employee-deps.ts` -- implement `findAllFxRates` (exact `Prisma.Decimal` → `rate` string + `rateNumerator`/`rateDenominator`, no float) and `findPayrollTotalsPopulation` (org-wide selects, no SQL grouping/count/as-of; `isSupportedExponent`-guarded `CurrencyRef`); forward the method on `lazyEmployeeRepository`; add `payrollTotalsDeps()`.
- [x] `tests/integration/payroll-totals.test.ts` -- against real Postgres 18: prove totals are summed in TypeScript (no SQL `SUM`/`GROUP BY`), per-country totals stay in local currency, the org-wide total converts each country once and carries `ratesUsed` + `pinnedOn`, a missing rate yields a `missing-rate` refusal while per-country totals still resolve, and an as-of rewind lowers a country's total/`n`. **Isolation:** create only suffix-scoped fixtures — unique `currency` codes (e.g. `X<suffix>…` with chosen `minor_unit_exponent`), unique `country`/`role`/`level` codes, employees + salary records, and `fx_rate` rows for the fixture currencies `→ reporting` at a fixture `pinnedOn`; read the existing global `settings.reporting_currency` (do NOT mutate the shared single-row `settings`), and ensure at least one fixture currency ≠ reporting so conversion is exercised. Because fixture currencies are unique, `neededPairs` filtering excludes every other suite's `fx_rate` rows — assert ONLY on this run's own countries/currencies; NEVER truncate/delete (`salary_record` is append-only).

**Acceptance Criteria:**
- Given an org-wide as-of population spread across countries/currencies with a complete rate set at `pinnedOn ≤ asOf`, when `getPayrollTotals` runs, then `kind:'answer'` carries `perCountry` (ordered by `countryCode`, each `{ countryCode, countryName, currency, n, total }` in local currency, `total` as boundary money) and `orgWide.answer` with the reporting-currency `total`, the deduped `ratesUsed`, and the set's `pinnedOn` — every total summed/converted in TypeScript.
- Given every in-population country is already in the reporting currency (or the population is empty), then `orgWide` is an answer with `ratesUsed:[]` and `pinnedOn:null` (a plain sum, or 0) — never a refusal.
- Given a country needs conversion but no rate set has `pinnedOn ≤ asOf`, then `orgWide` is `refusal reason:'no-rate-set'`; given a resolved set missing a needed pair, then `refusal reason:'missing-rate'` naming the absent pair(s) with the set's `pinnedOn` — and in both cases `perCountry` is still fully present and in local currency.
- Given a person with multiple records, they contribute exactly one as-of current salary and count once in `n`; given a person not in the as-of population, they contribute to no total and no `n`.
- Given a JPY (exp 0) country total converted to a USD (exp 2) reporting currency, then the converted minor units scale by the exponent difference and round half-up at the final step only; identical data + `asOf` produce a byte-identical payload with no clock/random/env read in `src/domain/**` or the use-case.
- Given any repository throws, the result is `{ kind:'unavailable' }` — no exception crosses the boundary.
- Given the full gate: lint, typecheck, import-boundary, coverage-floor (domain 100%, application ≥ 90%), and domain mutation testing (0 survivors over `src/domain`, incl. `fx.ts` + `payroll-totals.ts`) all pass, and the integration test is green against real Postgres 18.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 1: (high 0, medium 0, low 1)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - none
- notes: Both hunters converged on one theme — paths where degenerate reference/FX data could yield a silently-wrong total instead of a refusal. Every such path defends a **DB-forbidden state** and was **rejected** (all low, consumer = HR manager): (1) mixed-currency country fold — AD-6 makes it unreachable (immutable `employee.country`, write-time currency validation equal to the country, no country-edit path) AND it is already tracked as a pre-existing cross-cutting deferred item (CAP-5/6/7); (2)/(3) the `?? 0` exponent fallback for a currency/reporting currency absent from the reference — `grouping_style` is a Postgres ENUM(`WESTERN`,`INDIAN`), `minor_unit_exponent` has CHECK 0..4, and both salary and reporting currency are FKs to `currency.code`, so `toCurrencyFormats` never drops a needed currency; the fallback is dead total-function code and the ZZZ domain test explicitly documents it as unreachable (a reachable-looking refusal branch would be an unkillable mutant, breaking the required 100% gate); (4) zero/negative FX rate — `fx_rate_rate_positive` CHECK(`rate > 0`) forbids it; (7) duplicate `(from,to,pinnedOn)` rate rows — `@@unique` forbids it; (8) blanket `catch → unavailable` — the established repo-wide AD-20 totality pattern (CAP-8 rejected the same); (9) `toFixed(8)` hard-coded scale — correct for the actual `Decimal(18,8)` column; a scale change is a separate migration story's concern; (10) `missing-rate` when a needed pair's only rows predate the winning set — intended AD-13 "a rate set is written whole; never mix dates" behavior (the reviewer agreed it is not a defect); (11) fallback-doc grouping — cosmetic, tied to the unreachable (2)/(3). The one non-DB-forbidden finding — (5) the org-wide converted ANSWER is not proven through `getPayrollTotals` end-to-end — was **rejected** as a structural limitation of the shared, append-only, global fold (other suites' in-population employees in currencies lacking a rate to the reporting currency force `getPayrollTotals` to always refuse; the answer arm is covered by the application unit test on a fake port + the domain tests, and the integration test drives real `Decimal` decomposition through the domain; the DoD "≥1 adapter integration test" is met by the per-country + refusal end-to-end paths). **Deferred (1, low):** (6) the integration `level.rank` band-mod allocation can collide across accumulated runs on the shared never-cleaned DB — real (birthday-bound) but low-probability and a **pre-existing shared pattern** (identical in `tests/integration/gender-distribution.test.ts`), so a cross-cutting test-infra hardening, not this story's defect.

## Design Notes

**Finalized boundary contract (story 10-2 consumes unmodified):**

```ts
export type GetPayrollTotalsResult =
  | { readonly kind: 'answer'; readonly totals: PayrollTotals }
  | { readonly kind: 'unavailable' };

type PayrollTotals = {
  readonly asOf: PlainDate;
  readonly perCountry: readonly CountryTotal[];   // countryCode asc; [] if no in-population employees
  readonly orgWide: OrgWideTotal;
};

type CountryTotal = {
  readonly countryCode: string;
  readonly countryName: string;
  readonly currency: string;         // ISO-4217; the country's single currency
  readonly n: number;                // in-population headcount in that country
  readonly total: BoundaryMoney;     // local currency; amountMinor as decimal string
};

type OrgWideTotal =
  | { readonly kind: 'answer';
      readonly reportingCurrency: string;
      readonly total: BoundaryMoney;                 // in reportingCurrency
      readonly ratesUsed: readonly RateReceipt[];    // distinct source→reporting rates applied; [] if no conversion
      readonly pinnedOn: PlainDate | null; }         // the rate set's date; null if no conversion
  | { readonly kind: 'refusal';
      readonly reason: 'no-rate-set' | 'missing-rate';
      readonly reportingCurrency: string;
      readonly asOf: PlainDate;
      readonly pinnedOn: PlainDate | null;           // set's date (missing-rate); null (no-rate-set)
      readonly missingPairs: readonly CurrencyPair[]; };  // absent from→to pairs (missing-rate); [] (no-rate-set)

type RateReceipt = { readonly fromCurrency: string; readonly toCurrency: string; readonly rate: string; readonly pinnedOn: PlainDate };
type CurrencyPair = { readonly fromCurrency: string; readonly toCurrency: string };
```

**Conversion arithmetic (exact, no float).** `1 C = rate R`, `rate = rateNumerator / rateDenominator` (adapter decomposes `Decimal(18,8)` exactly, `rateDenominator = 10^8`). For a country total `A` (minor units of C) to R:
`minorR = divideRoundHalfUp(A × rateNumerator × 10^toExp, rateDenominator × 10^fromExp) ?? 0n`
where `toExp`/`fromExp` are the reporting/source `minorUnitExponent`. The denominator is provably positive (`rateDenominator = 10^8`, `10^fromExp ≥ 1`), so the `?? 0n` fallback is unreachable — the established `peer-comparison.ts`/`gender-gap.ts` idiom; do NOT add a reachable-looking guard branch (it would survive mutation).

**Why no verdict/copy-answer (matches CAP-8).** EXPERIENCE frames CAP-9 provenance as the ambient `provenance-caption` component ("converted at rates pinned 01 Jul 2026") and a "View Base Rates" list — both are deterministic formatting of the structured receipts (`pinnedOn`, `ratesUsed[].rate`) this payload already carries, formatted by story 10-2. There is no single judgement sentence and no card/copy-answer pairing (that belongs to CAP-5/CAP-7), so no `src/domain/verdict.ts` arm and no drift risk (AD-20): the caption is a pure function of the same payload.

**Why per-country never refuses.** Per-country totals are single-currency and never convert (AD-13), so they are always computable; only the org-wide converted figure can lack rates. Hence `orgWide` is the sole refusal site, nested inside an overall `answer`; the outer `unavailable` is reserved for repository failure.

**Why load-all-then-resolve.** The FX read loads rows and the domain resolves the set (greatest `pinnedOn ≤ asOf`) — the same "adapter loads, domain resolves" split as `findAllPeerGroups` + `resolveCurrentSalary`. Filtering to needed pairs before resolution both honors "convert only what's needed" and isolates the shared integration DB (unique fixture currencies exclude other suites' rate rows).

**Golden domain example:**
```ts
// reporting = USD (exp 2). In-population: US → {$100.00} ; India → {₹8300.00 INR} ; set pinned 01 Jul: INR→USD = 0.012
// perCountry: [ {IN, INR, n:1, ₹8300.00}, {US, USD, n:1, $100.00} ]           // countryCode asc
// neededPairs: [{INR,USD}]  → convert ₹8300.00 (830000 minor), rateNumerator=1200000, rateDenominator=10^8, fromExp=toExp=2:
//   divideRoundHalfUp(830000 × 1200000 × 10^2, 10^8 × 10^2) = 99_600_000_000_000 / 10_000_000_000 = 9960 = $99.60
// orgWide.answer: total $199.60 USD, ratesUsed:[{INR,USD,"0.012",01 Jul}], pinnedOn: 01 Jul
```

## Verification

**Commands:**
- `npm run test -- tests/domain/fx.test.ts tests/domain/payroll-totals.test.ts tests/application/payroll-totals.test.ts` -- expected: all green (written test-first).
- `npm run test` -- expected: full unit/application suite green; coverage floor holds (domain 100%, application ≥ 90%).
- `npm run test:mutation` -- expected: no surviving mutant over `src/domain` (rate-set resolution, exponent-aware conversion, per-country fold, needed-pair/refusal logic, dedupe).
- `npm run typecheck` && `npm run lint` -- expected: clean, including the import-boundary rule (`src/domain` imports nothing outward; the use-case imports only domain + ports).
- `npm run test:integration -- tests/integration/payroll-totals.test.ts` -- expected: green against Postgres 18 (`DATABASE_URL` + `DATABASE_URL_APP` set).

## Auto Run Result

Status: **done**

### Summary
Implemented CAP-9 (payroll totals), backend slice, fully test-first. `getPayrollTotals(deps, asOf)` reports, over the exact as-of population (AD-16, membership via the ONE `resolveCurrentSalary`), a per-country total in each country's own currency (never converted) and a single org-wide total in `settings.reporting_currency` — computed in AD-13's fixed order (sum each country in its own currency → convert each country total **once** → sum) with exact integer/rational math (no float; half-up at the final step only). A converted figure crosses the boundary carrying its receipts (`ratesUsed` + `pinnedOn`); when the rates needed are missing it **refuses out loud** (`no-rate-set` / `missing-rate`, naming the absent pairs) rather than inventing a number — while per-country totals, which never convert, remain fully present. Every total is summed in TypeScript (AD-2) — no SQL `SUM`/`COUNT`/`GROUP BY`. Rate-set resolution (greatest `pinnedOn ≤ asOf`, needed-pairs filtered) lives in the pure domain, mirroring the "adapter loads, domain resolves" split of `findAllPeerGroups` + `resolveCurrentSalary`. No verdict/copy-answer (CAP-9 provenance is structured receipts the UI renders as an ambient caption; matches the CAP-8 decision). The finalized payload is ready for story 10-2, which consumes it unmodified.

### Files changed
- `src/domain/fx.ts` (new) — pure `resolveRateSet` (rows at the single greatest `pinnedOn ≤ asOf`) + `convertMinorUnits` (exponent-aware, exact, half-up via the ONE `divideRoundHalfUp`); types `FxRateRow`/`ResolvedRateSet`/`CurrencyPair`.
- `src/domain/payroll-totals.ts` (new) — pure `computePayrollTotals`: per-country fold + `n`, needed-pairs, per-country-once conversion, org-wide `answer|refusal`; the finalized result types.
- `src/application/ports/fx-rate-repository.ts` (new) — `FxRateRepository.findAllFxRates` (read-only; domain resolves the set).
- `src/application/ports/employee-repository.ts` — added `findPayrollTotalsPopulation` + `PayrollTotalsPopulation` (org-wide read-only sibling of `findAllPeerGroups`).
- `src/application/use-cases/payroll-totals.ts` (new) — `getPayrollTotals`: `Promise.all` the three reads → domain → `toBoundaryMoney` every total → `answer`; `try/catch` → `unavailable`.
- `src/adapters/db/fx-rate-repository.ts` (new) — `createFxRateRepository`; exact `Decimal(18,8)` → `{ rate, rateNumerator, rateDenominator }` decomposition (no float).
- `src/adapters/db/employee-repository.ts` — implemented `findPayrollTotalsPopulation` (org-wide selects, no SQL grouping/count/as-of; `isSupportedExponent`-guarded currency refs; `DateTime`→`PlainDate`; each record's `salary: Money`).
- `src/app/employees/employee-deps.ts` — forwarded the method on `lazyEmployeeRepository`; added `payrollTotalsDeps()`.
- Tests (new): `tests/domain/fx.test.ts`, `tests/domain/payroll-totals.test.ts`, `tests/application/payroll-totals.test.ts`, `tests/integration/payroll-totals.test.ts` (real Postgres 18, suffix-scoped fixtures incl. unique currencies + `fx_rate` rows, reads-but-never-mutates the shared `settings`). Nine existing fake-repository helpers widened for the new port method.

### Review findings breakdown
- **Patches applied (0).** No code changes were needed in review.
- **Deferred (1, low):** the integration `level.rank` band-mod allocation can collide across accumulated runs on the shared never-cleaned DB — real but low-probability and a pre-existing shared pattern (identical in the gender-distribution integration test), recorded as cross-cutting test-infra hardening.
- **Rejected (10, all low):** every "silently-wrong-instead-of-refusal" path defends a DB-forbidden state (AD-6 currency immutability; `grouping_style` ENUM; `minor_unit_exponent` CHECK 0..4; currency FKs; `fx_rate_rate_positive` CHECK; `@@unique(from,to,pinnedOn)`) — a reachable-looking guard would be an unkillable mutant breaking the 100% gate; plus the established `catch → unavailable` totality pattern, the intended AD-13 "never mix rate-set dates" refusal, the `toFixed(8)` scale (correct for the real column), and the org-wide-answer integration gap (structural to the shared global fold; answer arm covered by unit + domain tests). Full reasoning in the Review Triage Log.

### Verification performed (independently re-run)
- `npm run test` (full unit/application) — **52 files, 1431 passed**.
- `npm run test:coverage` — All files 100% statements/functions/lines; domain 100%, application ≥ 90% (floor held).
- `npm run test:mutation` — **100.00, 0 survivors** over `src/domain` (`fx.ts` 25/25, `payroll-totals.ts` 102/102; every other domain file still 100%).
- `npm run typecheck` — clean (0 errors). `npm run lint` — clean (import-boundary held: `src/domain` imports nothing outward).
- `npm run test:integration -- tests/integration/payroll-totals.test.ts` — **6 passed** against real PostgreSQL 18 (per-country totals in local currency with no SQL SUM/GROUP BY; org-wide `missing-rate` refusal with per-country still present; real `Decimal` decomposition through the domain; as-of rewind lowering a country total/`n`); re-runnable (second run green, never truncates, never mutates shared `settings`).

### Residual risks
None material. The finalized boundary contract is ready for story 10-2 (Payroll Totals surface + Home payroll metric), which consumes it unmodified. The deferred `level.rank` collision is low-probability and shared across integration suites — a test-infra improvement, not a product defect. All "refuse-vs-invent" edge paths the review surfaced are unreachable given the DB's enum/CHECK/FK guarantees; should a future story relax any of those constraints or feed the domain from a non-DB source, the corresponding fallbacks (`?? 0` exponent, rate positivity, single-currency-per-country) would need to become explicit refusals.
