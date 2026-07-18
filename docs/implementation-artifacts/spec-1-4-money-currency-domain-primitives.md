---
title: 'Story 1-4: Money & Currency Domain Primitives'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'a63c3a382ce3658b995c00feddf9740cd3085703'
final_revision: '3d5d390' # the review-pass commit; the stamp commit that records it follows
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/implementation-artifacts/deferred-work.md'
warnings: ['multiple-goals', 'oversized']
---

<intent-contract>

## Intent

**Problem:** The one canonical `Money` type and the one money formatter mandated by AD-4 do not exist, so every capability epic from CAP-1 onward has nothing to render or carry salary values with. Separately, story 1-3 shipped the reference tables and `settings` structurally **empty** and handed 1-4 all their values plus five deferred value constraints — until those land, no employee, import, or seed can be written at all.

**Approach:** Add a pure `src/domain/money.ts` holding the `Money` type, the single formatter, the boundary (de)serializer, and an exact half-up integer division primitive — written test-first, with the minor-unit exponent, symbol, and grouping style supplied as arguments so the domain stays import-free. Then land the reference-data values (8 currencies, 8 countries, 6 levels, 25 roles, the `settings` default row) and the five deferred constraints as SQL migrations, so every environment gets them from `prisma migrate deploy`.

## Boundaries & Constraints

**Always:**
- TDD, red before green, and the failing test and the code that satisfies it go in **separate commits** (standing practice, `deferred-work.md`). Branch off `master` first.
- `src/domain/money.ts` obeys Law 2: imports nothing outside `src/domain/**`, no `Date`, no `Math.random`, no `process.env`, no dynamic `import()`. It must clear **100% coverage and 100% Stryker mutation score** — every branch needs a killing test.
- Domain functions are **total — never throw**. Failure is a `null` return, never an exception.
- Money is `{ amountMinor: bigint, currency: string }` verbatim (AD-4). No `number`, no float, anywhere in this file.
- The minor-unit exponent is **always a parameter**, never a literal `100`, never derived from `Intl`. `Intl.NumberFormat` must not appear in `src/domain/**` — its output is ICU-data dependent and therefore non-deterministic (Law 6).
- Reference-data migrations are **idempotent** (`ON CONFLICT DO NOTHING`) — `migrate deploy` runs at Vercel build, and a re-applied migration must not break a deployed build.
- Every new table/column added by a migration states its grants explicitly (`prisma/README.md` durable rule); `payroll_app` gets `SELECT, INSERT` only, never `UPDATE`/`DELETE`.
- Banned vocabulary, verbatim, in code and in every drafted taxonomy value: `snapshot`, `compaRatio`/"compa-ratio", `payBand`/"pay band", "range penetration", "midpoint", "market index", "merit matrix", "red-circled"/"green-circled". Gender values are exactly `MALE`/`FEMALE`.

**Block If:**
- A drafted taxonomy would need a cardinality other than the ratified **6 levels / 8 countries / ~25 roles** (`1-3-data-model-and-migrations.md:219`, `:677-686`).
- The `effective_from >= hire_date` constraint cannot be expressed without changing an existing 1-3 migration (existing migrations are immutable — add a new one or block).
- Any new CHECK or unique index fails to apply against the current schema for a reason other than a fixable authoring error.

**Never:**
- No FX conversion, no `fx_rate` seed rows — AD-13 belongs to Epic 10.
- No repository port, no write funnel, no currency-from-country validation — ruled out of Epic 1, deferred to CAP-2/CAP-3.
- No `prisma/seed.ts` and no seed wiring — the 10,000-row population is Epic 12, and seeding is never a deploy side effect. Reference **values** are not the population seed.
- No UI, no React component, no formatter call site — 1-4 ships the primitive only.
- No abbreviated large-number rendering ("₹982 Cr", "$1.21B") — mock-only, unratified, and Epic 10's surface.
- No decimal/bignumber npm dependency — `bigint` is exact and adds no supply chain.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Western grouping, whole amount | `{215000000n,'USD'}`, USD fmt (exp 2, `$`, WESTERN) | `$2,150,000 USD` — fraction omitted when the minor remainder is zero | No error expected |
| Indian grouping | `{215000000n,'INR'}`, INR fmt (exp 2, `₹`, INDIAN) | `₹21,50,000 INR` — last 3 digits, then groups of 2 | No error expected |
| Zero-exponent currency (JPY) | `{5000000n,'JPY'}`, JPY fmt (exp 0, `¥`, WESTERN) | `¥5,000,000 JPY` — proves no hard-coded 100 | No error expected |
| Non-zero minor part | `{215000050n,'USD'}`, USD fmt | `$2,150,000.50 USD` — fraction rendered, zero-padded to the exponent | No error expected |
| Negative amount | `{-100000n,'USD'}`, USD fmt | `-$1,000 USD` — sign leads, before the symbol | No error expected |
| Amount below one major unit | `{5n,'USD'}`, USD fmt | `$0.05 USD` — major part is `0`, not empty | No error expected |
| Currency mismatch | `{100n,'USD'}`, INR fmt | `null` | Total: returns `null`, never throws |
| Negative exponent | `{100n,'USD'}`, fmt with exp `-1` | `null` | Total: returns `null`; DB CHECK also forbids it |
| Boundary serialize | `{215000000n,'INR'}` | `{ amountMinor: '215000000', currency: 'INR' }` — decimal **string** (AD-4) | No error expected |
| Boundary parse, valid | `{ amountMinor: '215000000', currency: 'INR' }` | `{215000000n,'INR'}` | No error expected |
| Boundary parse, malformed | `'12.5'`, `'1e3'`, `''`, `'abc'`, `' 1 '` | `null` for each | Total: returns `null` |
| Half-up division, .5 up | `divideRoundHalfUp(5n, 2n)` | `3n` — half-up, not banker's | No error expected |
| Half-up division, negative | `divideRoundHalfUp(-5n, 2n)` | `-3n` — magnitude rounds half-up, sign reapplied (AD-5) | No error expected |
| Division by zero | `divideRoundHalfUp(1n, 0n)` | `null` | Total: returns `null` |

</intent-contract>

## Code Map

- `src/domain/money.ts` -- **new.** The whole domain surface of this story. Pure, total, named exports only.
- `tests/domain/money.test.ts` -- **new.** Mirrors the I/O matrix; imports via the `@/domain/*` alias.
- `src/domain/text.ts` + `tests/domain/text.test.ts` -- the only existing domain module; copy its JSDoc/law-citation and one-behaviour-per-`it` style exactly.
- `prisma/schema.prisma` -- `Currency` model gains `symbol` + `groupingStyle`; a `GroupingStyle` enum joins the existing `Gender` enum.
- `prisma/migrations/20260718163326_append_only_and_checks/migration.sql` -- **read only.** The pattern for hand-authored CHECKs, the `AP001` trigger, and explicit grants. Do not edit it.
- `prisma/migrations/20260718171500_review_hardening/migration.sql` -- **read only.** The most recent hand-authored migration; match its header-comment style.
- `prisma/README.md` -- documents the `migrate dev --create-only` → hand-edit-SQL workflow and the explicit-grants rule.
- `tests/integration/schema.test.ts` -- the harness pattern (raw `pg` `Pool`s for owner + `payroll_app`, no row cleanup, unique per-run fixture suffixes).
- `docs/implementation-artifacts/deferred-work.md` -- the five deferred constraints this story closes; append-only, strike-through-on-resolve conventions.

## Tasks & Acceptance

**Execution:**
- [x] `tests/domain/money.test.ts` -- write the failing suite covering every I/O matrix row -- Law 1: red lands, and is committed, before any of `money.ts` exists.
- [x] `src/domain/money.ts` -- implement `Money`, `GroupingStyle`, `CurrencyFormat`, `formatMoney`, `toBoundaryMoney`, `fromBoundaryMoney`, `divideRoundHalfUp` -- the AD-4 primitives every later epic consumes; green in a separate commit.
- [x] `prisma/schema.prisma` -- add `GroupingStyle` enum and `Currency.symbol` (`String @db.Text`) + `Currency.groupingStyle` (`GroupingStyle @map("grouping_style")`) -- the spine makes grouping "the formatter's job, driven by the currency reference table", and DESIGN requires a symbol; neither column exists.
- [x] `prisma/migrations/<ts>_currency_display_and_value_constraints/migration.sql` -- add the two currency columns + the enum type, and the five deferred constraints: `settings.outlier_threshold_pct` range, `currency.minor_unit_exponent` range, non-empty CHECKs on `employee.name` and every `code` column, case-insensitive unique indexes on `role`/`level`/`country`/`currency` `code`, and a `BEFORE INSERT` trigger enforcing `effective_from >= hire_date` -- closes the `deferred-work.md` block; cross-table date rule needs a trigger, not a CHECK.
- [x] `prisma/migrations/<ts>_reference_data/migration.sql` -- idempotent `INSERT … ON CONFLICT DO NOTHING` for 8 currencies, 8 countries, 6 levels, 25 roles, and the single `settings` row -- reference values are FK targets the app cannot function without, so they must reach every environment via `migrate deploy`, not an operator command.
- [x] `tests/integration/reference-data.test.ts` -- assert the seeded rows exist with correct values, that re-running the data migration is a no-op, and that each new constraint rejects its violating input -- AD-24 requires an adapter integration test where a story touches persistence.
- [x] `src/domain/README.md`, `prisma/README.md` -- document the money primitive and the reference-data-via-migration decision -- the next agent must not re-litigate the seeding vehicle.
- [x] `docs/implementation-artifacts/deferred-work.md` -- strike through the five closed constraints; append the new open items named in Design Notes -- append-only ledger, resolved entries survive as struck-through.
- [x] `docs/implementation-artifacts/sprint-status.yaml` -- set `1-4-money-currency-domain-primitives` to its new status -- sprint tracking.

**Acceptance Criteria:**
- Given `tests/domain/money.test.ts` contains a `// @ts-expect-error` assertion on a `formatMoney` call made without its `CurrencyFormat` argument, when `npm run typecheck` runs, then it passes — proving the call is genuinely rejected by the compiler, since an unused `@ts-expect-error` is itself an error. A currency-less format call must not typecheck (AD-4 / Consistency Conventions).
- Given the domain suite, when `npm run test:coverage` runs, then `src/domain/**` reports 100% branches, functions, lines, and statements.
- Given the domain suite, when `npm run test:mutation` runs, then the Stryker score is 100% — no surviving mutant in `money.ts`.
- Given a fresh Postgres 18 with all migrations applied, when the reference tables are queried, then exactly 8 currencies (including `JPY` with `minor_unit_exponent = 0`), 8 countries each with a valid `currency_code` FK, 6 levels with distinct sequential `rank`s, 25 roles, and exactly one `settings` row (`outlier_threshold_pct = 20`, `reporting_currency = 'USD'`) are present.
- Given the reference-data migration has already been applied, when its SQL is executed a second time, then it completes without error and creates no duplicate rows.
- Given an attempt to insert a `currency` with `minor_unit_exponent = -1`, a `settings` row with `outlier_threshold_pct = 0`, a `role` whose `code` is `'   '`, a second `currency` with code `'usd'` when `'USD'` exists, or a `salary_record` whose `effective_from` precedes its employee's `hire_date`, when each statement runs, then the database rejects it.
- Given the full repo, when `npm run lint` runs, then it passes with no `Intl` reference and no restricted import inside `src/domain/**`.
- Given `git log` for this story, when the commit sequence is read, then each failing test appears in a commit that precedes the commit making it pass.

## Spec Change Log

## Review Triage Log

### 2026-07-19 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 6: (high 0, medium 3, low 3)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` `formatMoney` threw `RangeError` on a fractional, NaN, or Infinite
    `minorUnitExponent` (`BigInt(2.5)` throws), and a huge-but-integral exponent made
    `10n ** BigInt(1e6)` compute a million-digit number — both breaking the module's central
    "every function is TOTAL, a failure is a `null` return" contract. Added a
    `Number.isInteger` + `[0, MAX_MINOR_UNIT_EXPONENT]` guard and six tests covering both
    bounds and all three non-integer forms; coverage and mutation score held at 100%.
  - `[medium]` `[patch]` The `effective_from >= hire_date` invariant was enforced only on
    `salary_record` INSERT, while `payroll_app` holds a column-level `GRANT UPDATE` on
    `employee.hire_date` — so moving a hire date forward under existing records broke AD-16
    with nothing firing, and the ledger recorded the constraint as CLOSED while it held in
    one direction only. Added an `employee_hire_date_not_after_salary` BEFORE UPDATE OF
    hire_date trigger (same `AP004` SQLSTATE) plus three tests.
  - `[medium]` `[patch]` `currency.symbol` was created NOT NULL but without the non-blank CHECK
    its five sibling columns received; `''` was accepted and would render a salary with no
    symbol, which DESIGN forbids. Added `currency_symbol_not_blank` and two tests.
  - `[low]` `[patch]` The hire-date trigger function referenced `employee` unqualified and was
    not `search_path`-pinned, so a role able to shadow `public` could make the lookup return
    NULL and fall through the guard — a silent bypass. Pinned with
    `SET search_path = pg_catalog, public` and schema-qualified the table.
  - `[low]` `[patch]` The trigger's only test asserted `/effective_from/` against the English
    message — the exact string-matching the `AP004` SQLSTATE exists to avoid, and loose enough
    to also match an unrelated NOT NULL or FK error. Now asserts `{ code: 'AP004' }`.
  - `[low]` `[patch]` The `settings` range tests issued three bare `UPDATE`s against real org
    configuration, relying on the CHECK to roll them back; a regressed CHECK would have left
    the environment at a zero threshold. Wrapped in transactions that always ROLLBACK, plus an
    assertion that the configured threshold is still 20 afterwards.
  - `[low]` `[patch]` Removed a dead `Math.abs` around `parseInt(suffix, 16)`, which is never
    negative.

### 2026-07-19 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 5: (high 0, medium 4, low 1)
- reject: 16: (high 0, medium 0, low 16)
- addressed_findings:
  - `[medium]` `[patch]` The `effective_from >= hire_date` invariant was still open under
    CONCURRENCY: each trigger reads the *other* table, and at READ COMMITTED neither sees the
    other transaction's uncommitted row, so an insert and a `hire_date` UPDATE could both pass
    and both commit into the state AD-16 forbids — textbook write skew, with the ledger
    recording the constraint as CLOSED. Added migration `20260719060000_hire_date_lock`, taking
    `FOR SHARE` on the employee row inside the insert-side trigger (share, not exclusive, so
    concurrent inserts for one employee still parallelize), plus a deterministic `lock_timeout`
    test proving the concurrent UPDATE now blocks. Verified red first: the UPDATE previously
    succeeded outright.
  - `[medium]` `[patch]` `groupRightToLeft` recursed once per digit group, so a long enough
    `amountMinor` — caller-controlled, since `fromBoundaryMoney` accepts any canonical integer
    string — overflowed the stack and threw `RangeError` out of a module contracted never to
    throw. Rewrote iteratively and added two 90,000-digit tests (WESTERN and INDIAN). This
    finding was already in the deferred ledger; this pass resolved it rather than re-deferring.
  - `[medium]` `[patch]` The constraint-rejection tests inserted hard-coded, unsuffixed keys
    (`'XSA'`, `'XSB'`, `'usd'`, `'in'`, `'Software_Engineer'`, `'l1'`) that are safe only while
    the constraints hold. On a regression they would COMMIT permanently — `'usd'` becoming a
    valid FK target beside `'USD'` is the exact split-peer-group harm the index prevents — and
    the next run would fail on a unique violation, masking the real regression. Routed every
    rejection case through an `expectRejected` helper that always ROLLBACKs, generalizing the
    discipline the `settings` tests already used.
  - `[low]` `[patch]` The JPY-zero-exponent acceptance test committed a new `currency` row on
    every run, permanently growing the very table whose exact count the suite wants to assert.
    Now runs through `expectAcceptedThenRolledBack`; it proves the same property and leaves no
    residue.
  - `[low]` `[patch]` The fixture `rank` was folded into a 1,000,000-wide window, so on a
    long-lived database birthday collisions against the UNIQUE column become likely after a few
    thousand runs — failing in `beforeAll`, erroring every test at once, pointing at nothing.
    Widened to the full 32 bits of the suffix.
  - `[low]` `[patch]` "leaves the configured threshold untouched" asserted nothing when run in
    isolation — it was meaningful only because the three rejection cases happened to precede it
    in file order. Folded the re-read into `expectThresholdRejected`, so every attempt carries
    its own proof.
  - `[low]` `[patch]` The module header claimed "There is no `number` in this file" while
    `minorUnitExponent` and the group size are both `number`. Corrected to state the real
    invariant (no *monetary* value is a `number`) and why the exponent is guarded — the
    preceding pass's totality bug existed precisely because a `number` is in this file.

### 2026-07-19 — Review pass (second follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 6: (high 0, medium 4, low 2)
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[medium]` `[patch]` `groupRightToLeft` traded the stack overflow it was rewritten to avoid for
    a QUADRATIC hang: `groups.unshift(...)` is O(n) per call, making the loop O(n²) in the digit
    count — which `fromBoundaryMoney` accepts at any length, so it is caller-controlled. Measured
    here: 245ms at 90,000 digits, 2.8s at 300,000, 28.7s at 1,000,000, all blocking the event loop.
    This is the same reachable hang the `formatMoney` exponent guard exists to prevent, reintroduced
    on the other input. Switched to `push` + a single `reverse()` — linear, and verified
    byte-identical in output at all three sizes. The unit suite's test time fell from 252ms to 68ms,
    which is how much of it this one function had been absorbing.
  - `[medium]` `[patch]` Every acceptance assertion in `reference-data.test.ts` was vacuous:
    `.resolves.toBeDefined()` on a `pg` result object is always true, so `allows moving hire_date
    earlier` would have passed identically had its `WHERE id = ...` matched zero rows — the exact
    outcome a broken fixture id or a rolled-back `beforeAll` produces. Replaced with `rowCount`
    assertions in `expectAcceptedThenRolledBack`, both hire-date boundary inserts, and both
    permitted-UPDATE cases.
  - `[low]` `[patch]` All seven rollback helpers ran `await client.query('ROLLBACK'); client.release()`
    in a bare `finally`, so a rejecting ROLLBACK (dead connection, aborted client) skipped
    `release()`, leaked the pooled client, replaced the real assertion error with a connection error,
    and left `owner.end()` hanging to the 30s hook timeout. Nested each release in its own `finally`;
    the two-client lock probe, which leaked both on a first-rollback failure, is now nested twice.
  - `[low]` `[patch]` The 90,000-digit tests carried a comment asserting that size is "still instant
    to format" — false at the time it was written (245ms), and the tests assert only that no
    `RangeError` escapes, so they passed throughout the quadratic regression. Corrected the comment
    to state plainly that these are not a performance guard and that linearity rests on the
    implementation comment, since a timing assertion would be flaky in CI.

## Design Notes

**Why the formatter takes a `CurrencyFormat` argument.** `src/domain/**` may import nothing, so the exponent, symbol, and grouping style cannot be looked up — they must be handed in, resolved at the delivery boundary from the `currency` row. This is the shape a still-open architecture review (F-12, "the formatter is homeless") proposed and no AD ever ratified; adopting it here is a decision this story records, not one it inherits.

```ts
export type Money = { readonly amountMinor: bigint; readonly currency: string };
export type GroupingStyle = 'WESTERN' | 'INDIAN';
export type CurrencyFormat = {
  readonly code: string;
  readonly symbol: string;
  readonly minorUnitExponent: number;
  readonly groupingStyle: GroupingStyle;
};
/** Total: `null` when `money.currency !== format.code` or the exponent is invalid. */
export function formatMoney(money: Money, format: CurrencyFormat): string | null;
```

`string | null` rather than a throw keeps the function total (Law 2); the `null` branch is unreachable in correct code because the boundary resolves the format by the same code, but it makes a mismatch impossible to render silently wrong.

**Render shape.** `[-]symbol + grouped-major[.fraction] + ' ' + ISO code` — e.g. `₹21,50,000 INR`, `¥5,000,000 JPY`. DESIGN mandates symbol **and** code on every salary. The fraction is **omitted when the minor remainder is zero** and otherwise zero-padded to the exponent: every DESIGN and mock example renders salaries without decimals, yet suppressing a non-zero minor part would hide money. This reconciliation is a decision — DESIGN never ruled on decimals explicitly.

**Grouping is implemented by hand**, not by `Intl`: WESTERN groups the major part in 3s; INDIAN takes the last 3 digits then groups the rest in 2s. Hand-rolled arithmetic is deterministic across environments and fully mutation-testable; `Intl` output depends on the Node ICU build.

**`divideRoundHalfUp(numerator, denominator): bigint | null`** is the exact-arithmetic seed AD-3 (even-`n` median), AD-5 (distance), and AD-13 (FX) all require. Pure `bigint`: it rounds the **magnitude** half-up and reapplies the sign, matching AD-5's stated rule, and returns `null` on a zero denominator. No decimal library is introduced.

**Reference values ship as a data migration**, not a seed command. They are FK targets — an employee cannot be written without them — so they must exist in local, CI, preview, and production alike, and `migrate deploy` is the only mechanism that already reaches all four. Epic 12's "seeding is a command, never a deploy side effect" governs the 10,000-row **population**, which is a different thing. `ON CONFLICT DO NOTHING` keeps re-application safe.

**Taxonomy draft, for rk's review** (1-3 Decision 1 authorizes the dev agent to draft; cardinalities are ratified):
- **Currencies (8):** INR 2 `₹` INDIAN · USD 2 `$` WESTERN · GBP 2 `£` · EUR 2 `€` · JPY **0** `¥` · BRL 2 `R$` · NOK 2 `kr` · CAD 2 `$` — every code attested in UX mock copy; JPY is the deliberate anti-hard-coded-100 case.
- **Countries (8, one currency each):** India→INR, United States→USD, United Kingdom→GBP, Germany→EUR, Japan→JPY, Brazil→BRL, Norway→NOK, Canada→CAD.
- **Levels (6, `rank` 1–6):** the mocks' L1–L8 + M1–M3 ladder reconciled down per the ruling — `L1` Associate, `L2` Mid, `L3` Senior, `L4` Staff, `M1` Manager, `M2` Director. A level name must never repeat a role name.
- **Roles (25):** ~25 job families spanning engineering, product, design, data, sales, marketing, finance, people, operations, legal, and support, seeded with the five the Settings mock enumerates (`software_engineer`, `product_manager`, `data_scientist`, `designer`, `sales_executive`). No level or seniority word may appear in a role name — the ladder is `level`, not `role`.

**New deferred items to record** (do not resolve here): the 8-vs-14 country-cardinality conflict between the addendum's grid sizing and the mocks' "14 countries"; whether `src/ui` may import a pure domain **function** and not only types (AD-1 says types-only, which the formatter's existence now pressures); and whether the taxonomy draft above is ratified by rk.

## Verification

**Commands:**
- `npm run lint` -- expected: exit 0, no restricted-import or purity violation in `src/domain/money.ts`
- `npm run typecheck` -- expected: exit 0
- `npm run test:coverage` -- expected: all tests pass; `src/domain/**` at 100/100/100/100
- `npm run test:mutation` -- expected: Stryker score 100%, zero survivors
- `npx prisma migrate deploy` against a disposable Postgres 18 -- expected: all migrations apply cleanly from empty
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` -- expected: exit 0, no drift between schema and migrations
- `npm run test:integration` -- expected: all tests pass, including the new reference-data and constraint-rejection assertions
- `git log --oneline` -- expected: each red-test commit precedes its green-code commit

**Manual checks (if no CLI):**
- If no local Postgres 18 is reachable, the integration and migration commands cannot run locally — push the branch and confirm the CI `Integration (Postgres 18)` job is green before treating persistence work as verified. Do not report it verified on the strength of the unit suite alone.

## Auto Run Result

Status: `done`

### Implemented change

The AD-4 money primitives and the reference-data values, delivered together. `src/domain/money.ts`
is a pure, total module holding the `Money` type, the one money formatter, the boundary
(de)serializer, and `divideRoundHalfUp` — the exact half-up integer division AD-3, AD-5, and AD-13
all build on. The exponent, symbol, and grouping style are arguments rather than lookups, which is
what lets the formatter live in a layer that may import nothing; adopting that shape resolves (for
this story, and recorded as a decision) the "the formatter is homeless" contradiction an earlier
architecture review raised and never closed.

Alongside it, the reference tables and `settings` — shipped structurally empty by story 1-3 — are
populated by migration: 8 currencies, 8 countries, 6 levels, 25 roles, and the single settings row
(threshold 20, reporting currency USD). Reference values are FK targets the application cannot
function without, so they travel with `prisma migrate deploy` to every environment rather than
behind an operator command; Epic 12's "seeding is never a deploy side effect" governs the
10,000-row population, which is a different artifact. The five value constraints story 1-3 deferred
here are closed in the same pass.

### Files changed

- `src/domain/money.ts` — new. The Money type, formatter, boundary codec, and half-up division.
- `tests/domain/money.test.ts` — new. 50 unit tests; 100% coverage and 100% mutation score.
- `prisma/schema.prisma` — `GroupingStyle` enum; `Currency.symbol` and `Currency.groupingStyle`.
- `prisma/migrations/20260718224918_currency_display_and_value_constraints/` — the two currency
  display columns and the five deferred value constraints.
- `prisma/migrations/20260718225000_reference_data/` — idempotent reference-data inserts.
- `prisma/migrations/20260719050000_review_hardening_1_4/` — new. The three review patches:
  `currency_symbol_not_blank`, the `search_path` pin, and the employee-side hire-date trigger.
- `tests/integration/reference-data.test.ts` — new. 46-test suite across the reference data,
  every new constraint, and both directions of the hire-date invariant.
- `tests/integration/{schema,client}.test.ts` — fixtures updated for the new NOT NULL columns.
- `src/domain/README.md`, `prisma/README.md` — the money primitive and the seeding-vehicle ruling.
- `docs/implementation-artifacts/{deferred-work.md,sprint-status.yaml}` — ledger and status.

### Review findings

7 patches applied, 6 deferred, 5 rejected; no intent gaps and no spec defects. Full breakdown in
the Review Triage Log above. The three medium patches were a totality breach in the formatter
(`BigInt(2.5)` throws), a half-enforced hire-date invariant that the ledger already claimed was
closed, and a missing non-blank CHECK on the one column the story created for rendering.

Follow-up review recommended: **true.** Not because of patch volume, but because two patches
changed behaviour rather than tidying it — a new `BEFORE UPDATE` trigger on `employee` is a
data-integrity change on a table other stories will write to, and the formatter's guard added a
rejection path every future call site inherits.

### Verification performed

Every gate was run by the orchestrator after the patches, not merely reported by the implementer.

| Command | Exit | Result |
| --- | --- | --- |
| `npm run lint` | 0 | clean |
| `npm run typecheck` | 0 | clean; the `@ts-expect-error` on the currency-less call is *used*, so that call genuinely does not compile |
| `npm run test:coverage` | 0 | 50 tests; statements 44/44, branches 33/33, functions 8/8, lines 44/44 — all 100% |
| `npm run test:mutation` | 0 | score 100.00; 102 killed, 6 timeout, **0 survived** |
| `npx prisma migrate deploy` | 0 | all 7 migrations apply from empty on a fresh `postgres:18` container |
| `npx prisma migrate diff --exit-code` | 0 | "No difference detected" |
| `npm run test:integration` | 0 | 46 tests / 3 files |

Independently confirmed on a fresh container beyond the suite: seeded counts are exactly
`currencies=8 countries=8 levels=6 roles=25 settings=1`, JPY carries exponent 0, level ranks are
1–6, no orphan country FKs; re-applying the data migration is a true no-op (counts unchanged,
exit 0); each of the five constraints rejects its violating input; and the hire-date trigger
rejects an early record, accepts the inclusive boundary, and defers to the FK on a bogus
`employee_id` rather than blaming the date.

### Residual risks

- **The taxonomy draft is unratified.** The 25 role names, 6 level labels, and 8 country/currency
  pairs are one agent's proposal, authorized by 1-3's Decision 1 but not yet reviewed by rk. They
  are now in a migration, and migrations are immutable — a correction is a new migration, and
  retirement is `is_active = false`, never a rename.
- **8 countries contradicts the mocks' "14 countries."** 8 shipped because it is the ratified
  number; the conflict is real and unresolved. Settle it before CAP-9.
- **The six deferred findings above are open**, most notably that `ON CONFLICT DO NOTHING` never
  repairs a divergent pre-existing row, and that the new constraints are added VALIDATING — safe
  today because the tables shipped empty, less safe once real data exists.
- **`src/ui` importing a pure domain *function*** is still formally unresolved (AD-1 says
  types-only). Nothing forces the answer until a call site exists, but `formatMoney` is exactly
  what a table cell wants to call.
- Two Postgres containers (`payroll-pg18`, `pg-boot`) were left running by the implementation
  subagent. They are disposable test databases, not cleaned up here because they were not created
  by this step.

---

## Auto Run Result — follow-up review pass (2026-07-19)

Status: `done`

A second, independent adversarial + edge-case review of the same baseline diff. No intent gaps and
no spec defects: the specification held, and every finding was implementation-level. Seven patches
applied, five new findings deferred, sixteen rejected. Full breakdown in the Review Triage Log.

### What changed

- `prisma/migrations/20260719060000_hire_date_lock/` — new. The previous pass closed the second
  *direction* of the hire-date invariant but not the second *failure mode*: both triggers read the
  other table, so under READ COMMITTED an insert and a concurrent `hire_date` UPDATE each validate
  against state the other is about to invalidate, and both commit. The insert-side trigger now
  takes `FOR SHARE` on the employee row. This is the one patch that changes runtime behaviour.
- `src/domain/money.ts` — `groupRightToLeft` rewritten iteratively (it recursed once per digit
  group over a caller-controlled digit count, so a long enough amount threw `RangeError` out of a
  total module), and the header's false "no `number` in this file" claim corrected.
- `tests/domain/money.test.ts` — two 90,000-digit formatting tests, red before the fix.
- `tests/integration/reference-data.test.ts` — every constraint-rejection case now runs inside a
  transaction that always rolls back, so a regressed constraint can no longer plant permanent
  reference rows in tables this suite cannot delete from; the zero-exponent acceptance row is
  rolled back; the fixture `rank` draw widened; the threshold re-read folded into its helper.
- `docs/implementation-artifacts/deferred-work.md` — five new entries, appended only.

One previously-deferred entry (the `groupRightToLeft` recursion) was resolved by this pass rather
than re-deferred. Its ledger entry was left untouched — the orchestrator owns entry status.

### Verification performed

| Command | Exit | Result |
| --- | --- | --- |
| `npm run lint` | 0 | clean |
| `npm run typecheck` | 0 | clean |
| `npm run test:coverage` | 0 | 52 tests; statements 48/48, branches 31/31, functions 8/8, lines 48/48 — all 100% |
| `npm run test:mutation` | 0 | score 100.00; 104 killed, 4 timeout, **0 survived** |
| `npx prisma migrate deploy` | 0 | all 8 migrations applied |
| `npm run test:integration` | 0 | 46 tests / 3 files |

Both behavioural patches were confirmed **red first**: the concurrency test previously saw the
competing `UPDATE` succeed outright (`rowCount: 1`) rather than block, and the long-amount tests
failed with `RangeError: Maximum call stack size exceeded` inside `groupRightToLeft`.

### Verification note worth surfacing

The three story-1-4 migrations were **not applied** to the configured dev database when this pass
began — `prisma migrate status` reported all three pending. The integration suite therefore could
not have been green against that database during the original run, whatever was reported. They
were applied here, and the suite passes.

Separately, twelve integration tests (`client.test.ts` and the role-scoped `schema.test.ts` cases)
initially failed with `Invalid URL`, identically on unmodified `HEAD`. Cause: the provisioned
`payroll_app` password contains an unencoded `/`, so the connection string fails to parse before
any query runs. This is a local credential-encoding issue, not a repo defect and not in this diff;
it is deferred with a note that `.env.example` should call for percent-encoding. The suite was run
green by percent-encoding the password in the environment for the run only — `.env` was not
modified.

### Residual risks

- **The write-skew fix is not proven under real concurrency**, only under a deterministic lock
  probe. The probe asserts the competing UPDATE blocks, which is the mechanism that closes the
  window, but no test races two committing transactions.
- **The five newly deferred findings are open**, two of which are cheap now and expensive later:
  the `btrim()` whitespace gap affects six CHECK constraints written across two stories, and the
  mutable `currency.minor_unit_exponent` can silently re-render every stored salary.
- All residual risks from the first pass remain open and unchanged.
- The `<= 100` threshold bound and the taxonomy values still await rk's ratification, and both now
  live in immutable migrations.

## Auto Run Result — second follow-up review pass (2026-07-19)

Status: `done`. A fresh adversarial + edge-case review of the full 1-4 diff against
`a63c3a3`. No intent gaps and no spec defects requiring re-derivation: the shipped behavior matches
the intent contract everywhere it was checked. Four patches applied, six findings newly deferred,
eight rejected.

### Summary of change

The consequential find is a **performance regression hiding inside the previous pass's own bug
fix**. Pass one rewrote `groupRightToLeft` from recursion to a loop, correctly reasoning that the
digit count is caller-controlled (`fromBoundaryMoney` accepts an `amountMinor` string of any length)
and that a stack overflow would break the module's totality contract. But the loop used
`groups.unshift(...)`, which is O(n) per call — trading a stack overflow for a quadratic hang on the
same caller-controlled input. Replaced with `push` + one `reverse()`.

The remaining three patches harden `reference-data.test.ts`, whose negative cases were rigorous
(SQLSTATE-matched) while its positive cases asserted almost nothing.

### Files changed

- `src/domain/money.ts` — `groupRightToLeft` now appends and reverses instead of unshifting; comment
  records the measured cost of the form it replaces.
- `tests/domain/money.test.ts` — corrected the false "instant to format" claim; states explicitly
  that these tests are not a performance guard and why no timing assertion was added.
- `tests/integration/reference-data.test.ts` — `rowCount` assertions replace six vacuous
  `.resolves.toBeDefined()` checks; every rollback helper nests `client.release()` in its own
  `finally` so a rejecting ROLLBACK cannot leak a pooled client.
- `prisma/README.md` — states that `SELECT, INSERT` is the DEFAULT for new tables, not a blanket
  rule, and that the reference tables deliberately hold full DML. Defuses a trap that would
  otherwise lead a later agent to revoke a needed privilege.
- `docs/implementation-artifacts/deferred-work.md` — six new entries, appended only.

### Verification performed

- `npm test` — 52 passed. Suite time fell from 252ms to 68ms; the quadratic grouping had been the
  dominant cost of the unit run.
- `npm run typecheck`, `npm run lint` — both clean.
- `npm run test:integration` — **46 passed, 3 files**, with the modified test file exercised against
  a real PostgreSQL 18. As in the previous pass, the run required percent-encoding the `payroll_app`
  password in the process environment (the known `Invalid URL` deferral); `.env` was not modified.
  The 12 pre-existing failures were confirmed environmental by reproducing them identically on a
  stashed working tree before any patch was applied.
- The grouping fix was benchmarked directly rather than assumed: at 90,000 / 300,000 / 1,000,000
  digits the old form took 245ms / 2.8s / 28.7s and the new form 4.4ms / 13.7ms / 45.8ms, with
  output asserted byte-identical at all three sizes.

### Note on one reviewer claim

The adversarial reviewer reported the quadratic cost as 1055ms / 10.3s / 47.4s. The defect is real
and was fixed, but those figures are roughly 4x the measured values on this machine; the numbers
recorded above are the ones observed here.

### Residual risks

- **The six newly deferred findings are open.** Four are medium: two reference-data CHECK gaps
  (`name` columns, `level.rank` positivity) where the suite asserts a property the schema does not
  enforce; a `FOR SHARE` lock-upgrade deadlock path with no retry anywhere in the codebase; and the
  over-broad grant constraint frozen inside `<intent-contract>`, which this workflow may not amend.
- **`GroupingStyle` remains structurally unlinked** to the Prisma `grouping_style` enum. Left
  deliberately: the honest fix is an exhaustiveness guard that is unreachable under the current
  closed union and would break the 100% coverage and mutation-score gates this story is held to.
- **Linearity of `groupRightToLeft` is not test-enforced.** The 90,000-digit tests passed throughout
  the quadratic regression and would pass through another; a timing assertion would be flaky in CI.
- All residual risks from the first two passes remain open and unchanged.
