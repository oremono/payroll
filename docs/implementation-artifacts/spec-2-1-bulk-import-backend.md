---
title: 'Bulk import backend (CAP-1)'
type: 'feature'
created: '2026-07-19'
status: 'in-progress'
baseline_revision: 'a04be66a367c8185e565bcb27974c3b5324704c0'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** There is no way to get employees into the system — every capability epic assumes a populated directory and none exists. CAP-1 is the first and only bulk population path, and the seed (CAP-11) is specified as a client of this same use-case, so whatever is built here becomes the single write funnel for the whole product.

**Approach:** Build the server side of CSV import end to end: a pure row-validation domain module, a CSV parse adapter, the first repository ports and their Prisma implementations (carrying the AD-6/AD-18 write funnel), an import use-case returning a finalized per-row report payload, and the multipart Route Handler that AD-21 sanctions. No UI — story 2-2 consumes this payload unmodified.

## Boundaries & Constraints

**Always:**
- Test-first (AD-23): every production file lands after a test that failed for the right reason. `src/domain/**` must reach 100% coverage AND survive Stryker at 100%; `src/application/**` ≥90%.
- Per-row rejection. One bad row never blocks a good one. Rejections are **data, never exceptions** — domain functions are total and return `null`/a reason, they do not throw.
- Create-only (AD-7). No upsert, no merge, no existence check. Re-importing a row creates a second person; that is correct behavior, not a bug.
- No guessing (AD-7). An unknown `role_code`, `level_code`, or `country_code` is a rejection naming the offending value and the reference table it failed against. Never fuzzy-match, never create a taxonomy value.
- Currency is derived, never trusted (AD-6). `salary_record.currency_code` is resolved from the employee's country via the `country` reference table at write time; a `currency` cell in the file is *validated against* that resolution and a mismatch rejects the row. Country is immutable.
- Money is never bare (AD-4). `{ amountMinor: bigint, currency: string }` inside; `BoundaryMoney` (decimal string) at the Route Handler boundary. Never a JS `number`, never a raw `bigint` in JSON.
- No future-dating (AD-18). `effective_from > today (UTC, from the clock port)` rejects the row. Writes go only through the repository's `append`.
- Determinism (AD-11/AD-19). The as-of/today date is an explicit parameter into domain and application code. No `Date` in `src/domain/**` or `src/application/**`.
- Exactly one of each thing. One rejection-reason vocabulary, one sentence composer, one write funnel — 2-2 and CAP-11 reuse them, they do not write their own.

**Block If:**
- The import Route Handler cannot be built without adding a **third** Route Handler (AD-21 permits exactly two: this multipart upload and CSV export downloads). A rejection-report CSV *download* is out of scope here precisely because it would be a third — do not add it.
- The `salary_record` append is found to require `UPDATE`/`DELETE` (revoked at the DB role) to satisfy any requirement.

**Never:**
- No UI, no React component, no page work — that is story 2-2. `src/app/import/page.tsx` stays the existing placeholder.
- No rejection-report CSV download (see Block If).
- No `.xlsx` parsing. No spreadsheet library. No symbol/locale-aware amount parsing (`₹23,40,000` is not an accepted cell).
- No streaming/chunked-upload machinery, no background job queue. One request, one response.
- No `prisma/seed.ts` — CAP-11 is Epic 12.

## I/O & Edge-Case Matrix

Row-level (each rejects only its own row; all other rows still import):

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Valid row | All cells well-formed, codes known, `effective_from` ≤ today and ≥ `hire_date` | Employee + one salary record created; counted in `importedCount` | No error expected |
| Unknown role | `role_code` absent from `role` | Row rejected, reason names the value and `role` | Data, not exception |
| Unknown level | `level_code` absent from `level` | Row rejected, reason names the value and `level` | Data, not exception |
| Unknown country | `country_code` absent from `country` | Row rejected, reason names the value and `country` | Data, not exception |
| Missing effective date | `effective_from` cell blank/absent | Row rejected — never defaulted to today or `hire_date` | Data, not exception |
| Future effective date | `effective_from` > today (UTC) | Row rejected naming the date and today | Data, not exception |
| Effective before hire | `effective_from` < `hire_date` | Row rejected naming both dates | Rejected in-app before the DB trigger fires |
| Bad date format | `hire_date` or `effective_from` not `YYYY-MM-DD` | Row rejected naming the offending cell | Data, not exception |
| Non-positive amount | `amount_minor` is `0`, negative, non-integer, or non-numeric | Row rejected naming the value | Rejected in-app before the `amount_minor > 0` CHECK |
| Currency mismatch | `currency` cell ≠ the country's currency | Row rejected naming both codes | Data, not exception |
| Bad gender | `gender` not exactly `MALE`/`FEMALE` | Row rejected naming the value | Data, not exception |
| Blank name | `name` empty or whitespace | Row rejected | Rejected in-app before the non-blank CHECK |
| Wrong cell count | Row has more/fewer cells than the header | Row rejected naming the row number | Data, not exception |

Whole-file (nothing is written; `kind: 'refusal'`):

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| `.xlsx` upload | Binary/ZIP content or `.xlsx` filename | Whole-file refusal, one statement of what could not be read | Refusal is a return value |
| Unrecognized header | Header row missing a required column or unparseable | Whole-file refusal naming the missing columns | Refusal is a return value |
| Empty file | Zero bytes, or header with no data rows | Whole-file refusal | Refusal is a return value |
| No file part | Multipart body carries no file | Whole-file refusal | Refusal is a return value |

</intent-contract>

## Code Map

Existing, load-bearing:
- `prisma/schema.prisma` -- `Employee`, `SalaryRecord` (`seq` BIGSERIAL, AD-8 ordering), `Role`/`Level`/`Country`/`Currency` reference tables. Country carries `currencyCode`; Currency carries `minorUnitExponent`.
- `src/domain/money.ts` -- `Money`, `BoundaryMoney`, `toBoundaryMoney`; reuse, do not re-derive.
- `src/domain/plain-date.ts` -- `PlainDate`, `parsePlainDate`, `comparePlainDate`, `plainDateToIso`. The date vocabulary for both date cells.
- `src/domain/text.ts` -- `blankToNull`, for the non-blank cell checks.
- `src/application/ports/clock.ts` -- `Clock.todayUtc()`; the only source of "today".
- `src/adapters/db/client.ts` -- `getDbClient()`, restricted `payroll_app` role via `DATABASE_URL_APP`.
- `src/adapters/csv/` -- exists, README only; the parse adapter lands here.
- `eslint.config.mjs` -- `purityConfig` bans `Date`/`process.env`/Prisma imports in domain+application; `layerBoundaryConfig` enforces the import zones.
- `vitest.config.ts` (fast suite, coverage floors) / `vitest.integration.config.ts` (real Postgres 18).
- Migration `20260718163326_append_only_and_checks` -- `UPDATE`/`DELETE` revoked on `salary_record`; the append-only guarantee this story must live within.

To create — all new:
- `src/domain/import-row.ts` -- pure row validation + rejection-reason vocabulary.
- `src/domain/import-rejection.ts` -- the single rejection-sentence composer.
- `src/adapters/csv/parse-import-csv.ts` -- text → header-checked rows.
- `src/application/ports/employee-repository.ts`, `src/application/ports/id.ts`.
- `src/application/use-cases/import-employees.ts` -- orchestration + the boundary payload.
- `src/adapters/db/employee-repository.ts`, `src/adapters/id.ts`.
- `src/app/api/import/route.ts` -- the AD-21 multipart handler.

## Tasks & Acceptance

**Execution** (in dependency order; each production task is preceded by its failing test):

- [ ] `tests/domain/import-row.test.ts` -- red: cover every row-level matrix scenario -- the matrix is the contract, and domain needs 100% mutation score.
- [ ] `src/domain/import-row.ts` -- define `ImportRowInput` (all cells as raw strings), `RejectionReason` as a discriminated union carrying its offending value, and `validateImportRow(raw, refs, today)` returning `{ ok: true, value: ValidatedRow } | { ok: false, reason: RejectionReason }` -- pure, total, takes `today` and the resolved reference codes as arguments so it never touches a clock or DB.
- [ ] `tests/domain/import-rejection.test.ts` -- red: one expected sentence per `RejectionReason` variant, plus exhaustiveness.
- [ ] `src/domain/import-rejection.ts` -- `composeRejectionSentence(reason): string` -- exactly one place composes rejection copy, so 2-2 renders it unmodified (mirrors the AD-20 verdict rule).
- [ ] `tests/adapters/parse-import-csv.test.ts` -- red: header validation, quoted cells, CRLF, BOM, cell-count mismatch, `.xlsx`/binary detection, empty file, AND every case in the **CSV quoting contract** below -- the coverage and mutation gates do NOT reach `src/adapters/**`, so this file is the only thing standing between a parser bug and silent payroll data loss. Test it adversarially, not representatively.
- [ ] `src/adapters/csv/parse-import-csv.ts` -- `parseImportCsv(text)` returning `{ kind: 'rows', rows } | { kind: 'refusal', reason }` -- hand-rolled RFC4180-subset parse implementing the **CSV quoting contract** and the **record-count reconciliation rule** below; the whole-file refusal cases live here, not in the use-case.
- [ ] `src/application/ports/employee-repository.ts` -- declare `EmployeeRepository` with `loadReferenceData()` and `createEmployeesWithSalaries(batch)`; `src/application/ports/id.ts` -- `IdGenerator.next(): string` -- ports first, so the use-case is testable with fakes and the DB stays out of the fast suite.
- [ ] `tests/application/import-employees.test.ts` -- red: use-case against in-memory fakes -- counts, ordering of rejections by row number, partial import, whole-file refusal passthrough, and that nothing is written when every row rejects.
- [ ] `src/application/use-cases/import-employees.ts` -- orchestrate parse → validate → append; return the `ImportResult` payload -- the finalized boundary contract 2-2 and CAP-11 both consume.
- [ ] `src/adapters/id.ts` -- UUIDv7 generator (AD-10) using node `crypto` -- adapters may use randomness; domain and application may not.
- [ ] `src/adapters/db/employee-repository.ts` -- Prisma implementation; **the write funnel**: resolve currency from country, re-validate it, reject `effective_from > today`, and insert employee + salary record inside one transaction for the whole valid batch.
- [ ] `tests/integration/import-employees.test.ts` -- against real Postgres 18: a mixed valid/invalid file lands exactly the valid rows, currency matches the country's, `seq` is assigned, and an attempted `UPDATE` on `salary_record` still fails under `payroll_app`.
- [ ] `tests/app/handle-import-request.test.ts` -- red: no file part, multiple file parts, oversized upload, a `formData()` that throws, and a use-case that throws -- every one of these must produce an `ImportResult`, never a 500.
- [ ] `src/app/api/import/route.ts` (+ an injectable handler body so it is testable without Next/DB/clock) -- multipart `POST` implementing the **handler error contract** below -- the one sanctioned Route Handler for this capability. Note: the finalized `ImportResult` carries no monetary value, so `toBoundaryMoney` has no call site here; if a future payload adds a total, it is the required encoder.
- [ ] `docs/implementation-artifacts/deferred-work.md` -- record the F8 money-cell decision below and flag it for promotion to the spine's Consistency Conventions -- three export stories must inherit the same encoding.

**Acceptance Criteria:**
- Given a CSV whose header is `name,role_code,level_code,country_code,gender,hire_date,amount_minor,currency,effective_from`, when it is posted with a mix of valid and invalid rows, then every valid row persists as one employee plus one salary record and every invalid row appears in `rejections` with its row number, name-as-it-appeared, offending value, and reason sentence.
- Given a file where every row is invalid, when it is imported, then `importedCount` is 0, no row is written, and the response is still `kind: 'imported'` — an all-rejected file is a report, not a refusal.
- Given an `.xlsx` or otherwise unreadable upload, when it is posted, then the response is `kind: 'refusal'` with one statement of what could not be read, and nothing is written.
- Given a row whose `currency` cell disagrees with the country's currency, when it is validated, then it rejects — the file never overrides AD-6's country-derived currency.
- Given the same file imported twice, when both complete, then two distinct sets of employees exist — import is create-only and performs no identity matching.
- Given a ~10,000-row file, when it is imported, then it completes in one request without unbounded memory growth (batch the inserts; do not issue one round-trip per row).
- Given the full gate set (`lint`, `typecheck`, `test:coverage`, `test:mutation`, `test:integration`), when CI runs, then all pass — including 100% coverage and 100% mutation score over `src/domain/**`.
- Given a file whose first data row contains an unbalanced `"` and whose next 50 rows are valid, when it is imported, then **50 rows import** and at most one rejects — a quoting fault is contained to its own record.
- Given a row whose `amount_minor` exceeds the PostgreSQL `bigint` maximum, when it is imported, then that row rejects and every other valid row still lands — no transaction abort, no 500.
- Given any upload the handler can receive — absent file part, several file parts, an oversized body, a truncated stream, or a repository that throws mid-transaction — when it is posted, then the response is a well-formed `ImportResult` and never an unhandled 500.
- Given the integration suite run with `--shuffle`, when it executes, then it passes — each test creates and asserts only its own fixtures.

## Spec Change Log

- **2026-07-19 — review pass 1, bad_spec loopback. Code reverted to `a04be66`; the discarded
  implementation is recoverable at `e7c5119`.**

  **Triggering findings.** Two independent paths by which ONE bad row destroys an entire import —
  the exact outcome the intent contract's "one bad row never blocks a good one" exists to prevent,
  and both confirmed by execution, not inspection:
  (a) The CSV parser entered quoted mode on a `"` at any position, so a single unbalanced quote
  swallowed every subsequent record. Verified: a header + 1 malformed row + 50 valid rows parsed to
  **1 record**; fifty employees vanished with no rejection, no count, and no signal.
  (b) `amount_minor` had no upper bound, so a value beyond PostgreSQL `bigint` overflowed on INSERT,
  aborted the batch transaction, and — with no error handling at the Route Handler — returned a 500
  carrying no report at all.

  **What was amended** (all outside `<intent-contract>`): a **CSV quoting contract** pinning when a
  quote opens a quoted cell and how an unterminated quote is contained; a **record-count
  reconciliation rule** making `importedCount + rejectedCount` account for every data record; an
  **`amount_minor` range bound** owned by the domain; a **handler error contract** requiring an
  `ImportResult` for every reachable input; plus four acceptance criteria and two test tasks that
  pin them. The Tasks section now also states that the coverage and mutation gates do not reach
  `src/adapters/**`, so the parser must be tested adversarially rather than representatively.

  **Known-bad state avoided.** Shipping a payroll importer that silently discards valid employees on
  a stray quote character, and that answers a 10,000-row upload with an HTTP 500 instead of the
  report the epic is built around.

  **KEEP — these worked and must survive re-derivation:**
  - The domain layer's shape: `validateImportRow` taking the reference codes and `today` as
    parameters (never looking them up), reusing `fromBoundaryMoney` instead of writing a second
    amount parser, exhaustive `switch` with no `default`, and one composer for every rejection and
    refusal sentence. It reached 100% coverage AND 100% mutation score — rebuild to that bar.
  - The strict red-then-green commit rhythm: a `test:` commit proving the failure, then the
    `feat:`/`fix:` commit that passes it, each suffixed `(story 2-1)`.
  - Header matching **by name** — case- and whitespace-insensitive, order-free, extra columns
    ignored, UTF-8 BOM stripped. Refusing a payroll over a stray `department` column is wrong.
  - The write funnel re-resolving currency **inside** the transaction (AD-6), and the integration
    test asserting that `UPDATE` on `salary_record` still fails under `payroll_app`.
  - An all-rejected file returns `kind: 'imported'` with `importedCount: 0` — a report, not a refusal.
  - `epochMillisUtc()` exported from `src/adapters/clock.ts` rather than a second `Date.now()`
    elsewhere, and deliberately NOT placed on the `Clock` port.
  - Rejecting inactive reference rows, and excluding them in `loadReferenceData` — but apply the
    same `isActive` filter in the funnel's intra-transaction re-resolution, which previously diverged.

## Review Triage Log

### 2026-07-19 — Review pass 1
- intent_gap: 0
- bad_spec: 4: (high 2, medium 2, low 0)
- patch: 0
- defer: 3: (high 0, medium 1, low 2)
- reject: 1: (high 0, medium 1, low 0)
- addressed_findings:
  - `[high]` `[bad_spec]` CSV parser entered quoted mode on a quote at any cell position; one unbalanced quote consumed all following records (verified: 51 records → 1). Spec amended with the CSV quoting contract; code reverted for re-derivation.
  - `[high]` `[bad_spec]` `amount_minor` unbounded above PostgreSQL `bigint`, so one oversized row aborted the whole transaction; combined with an unguarded Route Handler this returned a 500 with no report. Spec amended with the range bound and the handler error contract.
  - `[medium]` `[bad_spec]` Records that were a single blank cell were dropped silently, so `importedCount + rejectedCount` did not account for every data record. Spec amended with the reconciliation rule.
  - `[medium]` `[bad_spec]` Handler had no upload size cap, no multiple-file-part handling, and no distinction between a truncated upload and an absent file part. Folded into the handler error contract.


## Design Notes

**The CSV money-cell encoding (closes rubric F8 for import).** AD-4 forbids a bare amount in a CSV column, so `2340000` alone is illegal. AD-6 makes any currency in the file non-authoritative — currency is resolved from the employee's country and *validated to equal* the file's, which presupposes something to validate. Symbol-bearing cells (`₹23,40,000`) would require locale/grouping-aware parsing, which collides with "nothing is guessed." That leaves exactly one encoding consistent with all three: **two columns, `amount_minor` (integer minor units) + `currency` (ISO-4217), with a mismatch against the country's currency rejecting the row.** This is a derivation from ratified ADs, not a free choice — but the architecture review flagged the money-cell encoding as a cross-cutting convention that belongs in the spine, so it is recorded in the deferred-work ledger for ratification before the three CSV *export* stories pick their own.

**Why validation is pure and reference data is an argument.** `validateImportRow` takes the reference code sets and `today` as parameters rather than looking them up. That keeps it in `src/domain/**` (which may import nothing), keeps the fast suite DB-free and clock-free, and makes the 100% mutation-score target reachable — every branch is drivable from plain inputs.

**Transaction shape.** Rejected rows are filtered out *before* any write, then the surviving batch inserts inside a single transaction. This satisfies both stated outcomes at once — "valid rows land in full" and "valid rows are never blocked by bad rows" — without per-row commits, and it keeps the 10,000-row case to a bounded number of round-trips.

**The CSV quoting contract (added by review pass 1 — this is where the first implementation lost fifty employees).** A hand-rolled parser's quoting rules are the whole ballgame, and "RFC4180-subset" did not pin them down. Implement exactly this:

- A `"` opens quoted mode **only at the start of a cell**. A `"` that appears after content in an unquoted cell is an ordinary character and is preserved (`Ada "Countess" Lovelace` is a valid name, not a parse event). This single rule is what keeps one stray quote from consuming the rest of the file.
- Inside quoted mode, `""` is a literal `"`. Quoted cells may contain commas and newlines.
- If a cell opens quoted mode and the file ends before the closing quote, **only that record** is malformed. It rejects as one row; it must never absorb the records that follow.
- The parser must never return fewer records than the file contains without accounting for each one — see the reconciliation rule.

**Record-count reconciliation rule.** `importedCount + rejectedCount` MUST equal the number of data records in the file. A record may be skipped silently in exactly one case: a completely empty final line (the trailing-newline artifact). Every other record — blank, ragged, malformed, or unparseable — produces a rejection the reader can see. A report that under-counts is worse than a refusal, because the epic sells the report as the thing that tells the whole truth.

**The `amount_minor` range bound.** The column lands in a PostgreSQL `bigint`. A value that parses as a positive integer but exceeds `9223372036854775807` overflows on INSERT and aborts the transaction, destroying the whole import for one bad row. Bound it **in the domain**, as a rejection reason alongside the other amount failures. The domain owns the range because the domain owns the judgement; the database must never be the first thing to notice.

**The handler error contract.** The Route Handler must return an `ImportResult` for every input it can receive — it never propagates an exception and never emits a 500 for bad data. Specifically: cap the upload size *before* materializing the body with `file.text()`; treat multiple file parts as a refusal rather than silently importing the first; distinguish a `formData()` that throws (truncated/aborted upload) from a genuinely absent file part; and wrap the use-case call so that any repository throw — FK race, transaction timeout, overflow that slipped through — becomes a whole-file refusal carrying a statement. The write funnel is *documented* to throw on invariant violations, so an unguarded call site is a designed-in 500.

**Payload sketch** (the contract 2-2 consumes unmodified):

```ts
type ImportResult =
  | { kind: 'imported'; importedCount: number; rejectedCount: number; rejections: RowRejection[] }
  | { kind: 'refusal'; reason: FileRefusalReason; statement: string }

type RowRejection = { rowNumber: number; name: string | null; offendingValue: string | null; sentence: string }
```

## Verification

**Commands:**
- `npm run lint` -- expected: clean; proves no `Date`/Prisma leak into domain or application and no layer-boundary violation.
- `npm run typecheck` -- expected: clean.
- `npm run test:coverage` -- expected: green with `src/domain/**` at 100% on all four metrics and `src/application/**` ≥90%.
- `npm run test:mutation` -- expected: no surviving mutant in `src/domain/**` (Stryker break threshold is 100).
- `npm run test:integration` -- expected: green against real Postgres 18, including the append-only assertion.
- `npm run build` -- expected: clean; proves the Route Handler compiles under Next 16.
