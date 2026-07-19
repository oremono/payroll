---
title: 'Record a Salary Change — backend (CAP-3, story 4-1)'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: '4444fbec7b0c54672e9a07683da6cf58d73fb4ce'
final_revision: '9f37a54072d4142fe29e48aa812738a80abbe56b'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-4-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** An employee's pay can only be set once, at import — nothing in the system can record a raise. `salary_record` is append-only at the database, but no application path appends a single record, and the one canonical answer to "what does this person earn as of date D" (AD-8) does not exist anywhere, so every later statistical capability has nothing to read through.

**Approach:** Land the CAP-3 backend: the single current-salary resolver as pure domain, a shared salary-field validator that both the CSV importer and the new path delegate to, a sibling `append` method on the existing `EmployeeRepository` port and adapter (never a second write funnel), a `record-salary-change` use-case returning a finalized AD-20 payload, and the Server Action that supplies `today` from the clock port.

## Boundaries & Constraints

**Always:**
- The current-salary resolver is **exactly one** pure function in `src/domain/`: current salary = the record with the greatest `(effectiveFrom, seq)` where `effectiveFrom <= asOf`. `createdAt` is never an ordering key. Ties on `effectiveFrom` are the designed path (same-day correction), not an edge case. (AD-8)
- `asOf` and `today` are required explicit `PlainDate` arguments through domain and application. The clock port is read **only** at the delivery boundary. (AD-11, Law 6)
- Append only. Extend `EmployeeRepository` / `createEmployeeRepository` with a salary-append method plus reads; expose no update or delete over `salary_record`. (AD-18, Law 5)
- `effectiveFrom > today` is rejected at write time on this path, as it already is on the import path. (AD-18)
- Currency is re-resolved from the employee's country via the country reference table inside the write transaction and validated to equal the submitted currency; a mismatch rejects rather than saves. Never re-resolve currency at read time. (AD-6)
- Money crosses the Server Action boundary as `BoundaryMoney` (`amountMinor` decimal string + `currency`), never a number, never a raw `bigint`. (AD-4, Law 4)
- Exactly one implementation per validation rule: extract the amount and effective-date checks currently private to `src/domain/import-row.ts` into a shared module both paths delegate to. Preserve the existing cycle-breaking module split (`employee-fields` / `employee` / `import-row` / `import-rejection`).
- Domain and application functions are total — rejections and refusals are return values, never exceptions. Adapters may throw; the boundary catches. (Law 8)
- Test-first: every assertion committed red before the code that satisfies it, as a separate commit.

**Block If:**
- Closing the shared-validation extraction would require changing an existing import rejection sentence or reason literal (that is a CAP-1 contract change, not this story's call).
- The three fields (effective date, amount, currency) prove insufficient without adding a field to the payload.

**Never:**
- No timeline read surface, no percent-change derivation, no `(Hire)` label, no UI — those are stories 4-2 and Epic 5.
- No reason/note/event-type/approval field. No scheduled or pending change. No edit or delete affordance over past records.
- No second write funnel, second median, second resolver, or second `ORDER BY` over `salary_record`.
- No `Date.now()` / `new Date()` under `src/domain` or `src/application`. No raw SQL where the existing adapter uses Prisma. No new Route Handler (AD-21 caps them at two).
- Do not add current salary to `EmployeeDetail`, `EmployeeSummary`, or any 3-1 payload.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Records a raise | Known employee in India; `effectiveFrom` = today; `amountMinor` `'2500000'`; `currency` `'INR'` | `{kind:'recorded', salaryRecordId}`; a new row appended; prior rows byte-identical | No error expected |
| Same-day correction | A record already exists for the same employee at the same `effectiveFrom` | Second row appended with a strictly greater `seq`; resolver returns the later row as current | No error expected |
| Backdated within history | `effectiveFrom` after `hireDate` but before the latest existing record | Appended; resolver at `asOf` = today still returns the greatest `(effectiveFrom, seq)` | No error expected |
| Future-dated | `effectiveFrom` = today + 1 day | `{kind:'rejected'}` naming the effective-date field; nothing written | Rejection payload, not a throw |
| Before hire date | `effectiveFrom` < employee's `hireDate` | `{kind:'rejected'}` naming the effective-date field | Domain rejects; adapter's `AP004` trigger is the backstop, mapped to the same rejection |
| Currency not the country's | Employee in India; `currency` `'USD'` | `{kind:'rejected'}` naming the currency field; nothing written | Rejection payload |
| Non-positive or malformed amount | `'0'`, `'-1'`, `'1.5'`, `'abc'`, `'  12'`, above `MAX_AMOUNT_MINOR` | `{kind:'rejected'}` naming the amount field, one reason per case | Rejection payload |
| Unknown / malformed employee id | Random UUID, or `'not-a-uuid'`, or a non-string | `{kind:'not-found', employeeId}`; nothing written | No throw |
| Non-string field from a hostile caller | `amountMinor: 5` (a number) crossing `'use server'` | `{kind:'rejected'}` naming the field | Coerced defensively at the action, per 3-1 |
| Resolver with no eligible record | Every record has `effectiveFrom > asOf`, or the list is empty | `null` | Total function; never throws |

</intent-contract>

## Code Map

- `src/domain/plain-date.ts` -- `PlainDate`, `parsePlainDate`, `comparePlainDate`, `plainDateToIso`; the as-of/today type.
- `src/domain/money.ts` -- `Money`, `BoundaryMoney`, `fromBoundaryMoney`, `toBoundaryMoney`.
- `src/domain/import-row.ts` -- today holds the amount/effective-from checks and `MAX_AMOUNT_MINOR` privately; source of the extraction. `RejectionReason` extends `FieldRejectionReason`.
- `src/domain/employee-fields.ts` -- shared per-field checks (`checkDateCell`, `FieldCheck<T>`, `FieldRejectionReason`); the pattern the new shared module must follow.
- `src/domain/import-rejection.ts` -- `composeRejectionSentence`, `rejectionOffendingValue`; sentence vocabulary reused unchanged.
- `src/domain/employee.ts` -- `FieldRejection`, `nonTextFieldRejection`, `employeeWriteFailureRejection`; rejection payload shape to mirror.
- `src/application/ports/employee-repository.ts` -- `EmployeeRepository`; `NewEmployeeWithSalary` shows the salary tuple; `UpdateEmployeeOutcome` shows the typed-outcome idiom.
- `src/application/ports/clock.ts` -- `Clock.todayUtc()`; unused until now.
- `src/adapters/db/employee-repository.ts` -- `createEmployeesWithSalaries` (lines ~290–336) is the funnel to extend: in-transaction currency re-resolution, `isActive` guard, future-date check, `toDbDate`; `hasErrorCode`, `HIRE_DATE_SQLSTATE = 'AP004'`, `isUuid`.
- `src/adapters/clock.ts` -- `systemClock`, the only `Date.now()`.
- `src/application/use-cases/employees.ts` -- deps-as-first-object-argument idiom and the AD-20 result unions to mirror.
- `src/app/employees/actions.ts` / `handle-employee-write.ts` -- `'use server'` composition root + testable handler split, `coerceFields`, `revalidateCommitted`.
- `prisma/schema.prisma` (`SalaryRecord`) -- `seq BigInt @unique @default(autoincrement())` is the AD-8 tie-break; `AP001` forbids UPDATE/DELETE, `AP004` enforces `effectiveFrom >= hireDate`.
- `tests/integration/employees.test.ts` -- integration conventions: real PG, unique fixture suffixes, re-runnable (`salary_record` rows cannot be deleted).

**Added by this story:**

- `src/domain/salary-timeline.ts` -- `resolveCurrentSalary`, `SalaryRecordView`, `SalaryRecordOrder`. THE current-salary resolver (AD-8); every later capability reads through it.
- `src/domain/salary-fields.ts` -- `checkSalaryEffectiveFrom`, `checkSalaryAmount`, `checkSalaryCurrency`, `SalaryFieldRejectionReason`, and `MAX_AMOUNT_MINOR` (moved here from `import-row.ts`, which re-exports it). The one implementation of each salary rule, shared by the import path and the CAP-3 path.
- `src/domain/salary-change.ts` -- `validateSalaryChange`, `SalaryChangeInput` (= `BoundaryMoney` + `effectiveFrom`), `SALARY_CHANGE_FIELDS`, `SalaryFieldRejection`, and the four composed rejections (`effectiveBeforeHireRejection`, `unknownSalaryCountryRejection`, `salaryWriteFailureRejection`, `nonTextSalaryFieldRejection`).
- `src/application/use-cases/record-salary-change.ts` -- `recordSalaryChange` and the AD-20 `RecordSalaryChangeResult` union story 4-2 consumes unmodified.
- `src/app/employees/handle-salary-change.ts` -- `handleRecordSalaryChange`, the testable Server Action body; `SalaryChangeWriteDeps` carries the clock and the revalidator.
- `tests/domain/salary-timeline.test.ts`, `tests/domain/salary-fields.test.ts`, `tests/domain/salary-change.test.ts`, `tests/application/record-salary-change.test.ts`, `tests/app/handle-salary-change.test.ts`, `tests/integration/salary-records.test.ts`.

**Extended by this story:**

- `src/application/ports/employee-repository.ts` -- `appendSalaryRecord`, `NewSalaryRecord`, `AppendSalaryRecordOutcome`.
- `src/adapters/db/employee-repository.ts` -- `appendSalaryRecord`, plus `assertSalaryRecordWritable`, the per-record guard lifted out of `createEmployeesWithSalaries` and now called by both paths.
- `src/app/employees/actions.ts` -- `recordSalaryChangeAction` and `salaryDeps()` (the only new clock-port read).
- `src/domain/import-row.ts` -- delegates to `salary-fields.ts`; no reason literal or sentence changed.

## Tasks & Acceptance

**Execution:**
- [x] `tests/domain/salary-timeline.test.ts` -- assert the resolver: greatest `(effectiveFrom, seq)` at or before `asOf`; same-date tie broken by `seq` not `createdAt`; unordered input; all-future input and empty input → `null`; single record -- red first, and it is the AD-8 contract every later epic reads through.
- [x] `src/domain/salary-timeline.ts` -- add the one current-salary resolver, pure and total, taking records + `asOf` -- AD-8 mandates exactly one, in the domain.
- [x] `tests/domain/salary-fields.test.ts` -- assert the extracted amount and effective-date checks over the full I/O matrix rows, including `MAX_AMOUNT_MINOR` and the future-date boundary (today passes, today+1 rejects) -- red first.
- [x] `src/domain/salary-fields.ts` -- extract the amount/effective-from/currency-match checks out of `import-row.ts` into a shared module, its reason union extended by `RejectionReason` -- one implementation per rule (3-1's binding decision).
- [x] `src/domain/import-row.ts` -- delegate to the extracted checks; change no reason literal and no sentence -- CAP-1's contract must be observably unchanged.
- [x] `tests/domain/salary-change.test.ts` -- assert the CAP-3 input validator's field ordering and every rejection in the matrix -- red first.
- [x] `src/domain/salary-change.ts` -- validate a salary-change input against the employee's country currency, `hireDate`, and `today`; return `{ok:true,…} | {ok:false, reasons: FieldRejection[]}` -- total, no exceptions.
- [x] `src/application/ports/employee-repository.ts` -- add the salary-append method (input carrying `salaryRecordId`, `employeeId`, `salary: Money`, `effectiveFrom`) plus its typed outcome union -- append and reads only (AD-18).
- [x] `tests/application/record-salary-change.test.ts` -- assert the use-case against a fake repository: recorded, rejected, not-found, and adapter-throw → rejection -- red first.
- [x] `src/application/use-cases/record-salary-change.ts` -- orchestrate: find employee → resolve expected currency from country → validate → append; return the AD-20 union -- deps as a first object argument, per `employees.ts`.
- [x] `src/adapters/db/employee-repository.ts` -- implement the append as a sibling of `createEmployeesWithSalaries`, sharing its in-transaction currency re-resolution, `isActive` guard and future-date check; map `AP004` to a typed outcome -- a second funnel is a defect.
- [x] `src/app/employees/handle-salary-change.ts` + `src/app/employees/actions.ts` -- add the testable handler and its `'use server'` entry, coercing every field defensively, reading `today` from the clock port, revalidating outside the write guard -- `'use server'` is a live RPC and types are erased at runtime.
- [x] `tests/app/handle-salary-change.test.ts` -- assert boundary coercion of non-string/number inputs and that money crosses as a decimal string -- red first.
- [x] `tests/integration/salary-records.test.ts` -- against real Postgres 18: append succeeds and is readable; a second same-day append receives a strictly greater `seq`; a future-dated append is refused; `UPDATE`/`DELETE` still raise `AP001` -- uses unique fixture suffixes and is re-runnable, since these rows cannot be deleted.

**Acceptance Criteria:**
- Given an employee with an existing salary record, when a change is recorded, then the prior row's every column is unchanged and the new row is an additional row.
- Given the repository port after this story, when its type is inspected, then it exposes no method that updates or deletes a salary record.
- Given the codebase after this story, when `src/domain` and `src/application` are searched, then they contain no `Date.now()`, `new Date()`, or timezone read.
- Given two records with the same `effectiveFrom`, when current salary is resolved at any `asOf` on or after that date, then the record with the greater `seq` is returned regardless of insertion order in the input list.
- Given the CAP-1 import path, when its suite runs after the validation extraction, then every existing import test passes unmodified.
- Given the story is complete, when the gates run, then lint, typecheck, import-boundary, coverage floor (`src/domain` 100%, `src/application` >= 90%) and domain mutation testing are green with zero surviving mutants.
- Given the story's commit history, when it is read, then each failing test appears in a commit before the code that satisfies it.

## Spec Change Log

Decisions the spec did not pin down, taken conservatively inside its boundaries.

- **The salary rejection payload is a SEPARATE type mirroring `FieldRejection`, not a widening of it.** The task list says "return `{ok:true,…} | {ok:false, reasons: FieldRejection[]}`" and the Code Map names `employee.ts`'s `FieldRejection` as the "shape to mirror". `FieldRejection.field` is `EmployeeField | null`, and `EmployeeField` is the set of keys CAP-2's form matches its inputs against — widening it would hand every employee-form surface three field names it can never render. So `SalaryFieldRejection` in `salary-change.ts` has the same three keys, same nullability, same semantics, over `SalaryChangeField`. The SENTENCES are shared (one composer, unchanged), which is the part that must not fork.
- **The trim stays at the import call site rather than moving into the shared amount check.** `validateImportRow` trims every cell before judging it. The I/O matrix requires CAP-3 to REJECT `'  12'`, so a shared check that trimmed would contradict the matrix, and a shared check that did not trim would change CAP-1's behaviour. Trimming is a property of reading a spreadsheet-exported CSV cell, not of judging an amount — so it stayed with the CSV path, and both contracts hold unchanged.
- **The two effective-date bounds are ONE shared function, not two.** `checkSalaryEffectiveFrom(effectiveFrom, hireDate, today)` applies future-first-then-before-hire in the order story 2-1 pinned. Both paths need both checks in that order; splitting them would have let a caller apply one and not the other.
- **`appendSalaryRecord` adds no READ method to the port.** The task line reads "the salary-append method … plus reads"; the "Never" list forbids a timeline read surface, and story 4-2 owns it. Read "append and reads only" as the AD-18 CONSTRAINT (no update, no delete), not as a mandate to add a read this story has no consumer for. The integration test reads the rows back with SQL.
- **`NewSalaryRecord` carries no country.** The country is the employee's, immutable since create (AD-6), and the adapter reads it inside its own transaction. A country travelling on the input would be a second answer to a question the employee row already answers.
- **An employee whose country no longer resolves to an active currency is a rejection blaming NO field** (`unknownSalaryCountryRejection`), not a write failure. No input of the form caused it, and the sentence comes from the one composer.
- **The batch funnel's per-record guard was LIFTED, not copied** (Design Notes' explicit instruction). `assertSalaryRecordWritable` holds the country-resolution, currency-match and future-date checks; `createEmployeesWithSalaries` and `appendSalaryRecord` both call it. The batch path's checks and their order are unchanged. Its message text is byte-unchanged in two of the three arms; the inactive-country message was later reworded path-neutrally (see the Review Triage Log) because the guard is now shared with a Server Action path where no file and no import exist.
- **`isLaterThan` tests both signs of the date comparison explicitly** rather than "nonzero, then positive". The two are equivalent, which is exactly the problem — the mutation gate found a surviving `>` → `>=` mutant on a value already known to be nonzero, i.e. a comparison no test could constrain. Three independently reachable arms instead. (Commits `c8e46b6` red-hardening, `347f855` refactor.)
- **Three existing test files gained an `appendSalaryRecord` stub on their fake repositories**, because widening the port makes an incomplete fake a type error: `tests/application/employees.test.ts`, `tests/app/employees-actions.test.ts`, and `tests/application/import-employees.test.ts` (one line, on the central `NOT_USED_BY_IMPORT` object, where it REJECTS — import never appends one record). No assertion, expectation, reason literal or sentence in any CAP-1 test was touched, and the whole import suite passes. `tests/integration/employees.test.ts`'s port-surface assertion was updated from one salary method to two, both of which append.
- **Money is not re-encoded at the boundary.** `SalaryChangeInput` is declared as `BoundaryMoney & { effectiveFrom: string }` rather than restating `amountMinor`/`currency`, so the Server Action payload IS the AD-4 boundary encoding by construction.

## Review Triage Log

### 2026-07-19 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 4: (high 0, medium 3, low 1)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` The `effective-before-hire` arm composed its sentence from the hire date read BEFORE the write, but that arm fires only when the `AP004` trigger caught what the domain validator had already passed — i.e. only when the DB's hire date differs from the one read. The sentence therefore quoted a date the effective date was provably not earlier than, and was wrong in 100% of the cases it fired. `AppendSalaryRecordOutcome`'s arm now carries `hireDate`, the adapter reads it back on a fresh query after the rollback, and the use-case quotes the database's verdict. Red-first (`dd578eb`), unit and integration.
  - `[medium]` `[patch]` The append-only integration test asserted only `.rejects.toThrow()`. Because `payroll_app` holds `REVOKE UPDATE, DELETE`, both statements died at the privilege check (`42501`) and never reached the `AP001` trigger — the enforcement the test claimed to prove was the one thing it could not detect. Now asserts SQLSTATEs for both layers: `42501` as the restricted role, `AP001` as the owner, who bypasses privileges.
  - `[low]` `[patch]` `assertSalaryRecordWritable`'s inactive-country message ended "…the reference data changed mid-import", but the guard is now shared with a Server Action path where no file and no import exist. Reworded path-neutrally; the currency-mismatch and future-date messages are untouched.
  - `[low]` `[patch]` `SALARY_CHANGE_FIELDS` used `satisfies`, which validates the entries present but enforces no exhaustiveness over `keyof SalaryChangeInput` — so a future field added to the input and forgotten here would compile, reach the domain as `undefined` typed `string`, and falsify the module docstring's "cannot drift" claim. The table is now exhaustive by type and the boundary's double cast narrowed to one partial→total assertion. No runtime change.
  - `[low]` `[patch]` The batch funnel discarded `assertSalaryRecordWritable`'s returned currency and re-read `currencyByCountry` at insert time behind a `?? row.salary.currency` fallback — dead today (the guard throws first), and therefore a latent divergence between the two callers of the one guard. The guard's verdict now rides the row; the fallback has nowhere to live. (`daf13a1`)
  - `[low]` `[patch]` `baseline_revision` was an abbreviated 7-character SHA; every other baseline in the repo is full-length. Restored to 40 characters.
  - `[low]` `[patch]` Integration fixtures: `RETIRED_COUNTRY` and its "Retired Salaryland" row were inserted but never deactivated or used (the deactivation test plants its own), and the rank-band comment's headroom arithmetic was wrong by two orders of magnitude. Dead fixture removed, arithmetic corrected.

### 2026-07-19 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 2, low 6)
- defer: 3: (high 0, medium 2, low 1)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` Three integration tests asserted a bare `.rejects.toThrow()` — the exact defect the previous pass patched on the append-only test, surviving one screen below it. Replacing `assertSalaryRecordWritable`'s entire body with an unconditional throw left all three green, and none could tell which of its three arms fired: the deactivated-country test, whose whole claim is that the INTRA-TRANSACTION re-resolution is what notices, was equally satisfied by a currency-mismatch throw. All three now assert the specific message (`/is later than today/`, `/Currency mismatch/`, `/is not an active country/`), and pass against real Postgres, which is what proves the fragments match the guard.
  - `[medium]` `[patch]` The Server Action's own `catch` — documented as "the SECOND net, and it is deliberate" — was unreachable by every test in the suite, and by every gate. `recordSalaryChange` wraps its whole body, so the throwing-funnel test that claimed to prove the net passes on the use-case's identical payload; deleting the arm outright kept the suite green. Worse, `coerceSalaryFields` sat OUTSIDE the net, so a payload property that throws on access (a getter, a Proxy trap) escaped a function whose contract is that it never throws. Coercion moved inside the guard, and the two inputs that actually discriminate the nets — a throwing clock, a throwing getter — are now asserted.
  - `[low]` `[patch]` `salary-fields.ts` documented a "no trimming" rule the CAP-3 payload does not implement: the date reaches `checkDateCell`, which trims, so `' 2026-07-19 '` is accepted while `' 2500000'` and `' INR'` are rejected. The Spec Change Log's "the trim stays at the import call site" was likewise false of half the payload. Both now state the per-field policy that is actually implemented; the question of whether the CAP-3 boundary should normalize is deferred to 4-2, which owns the form.
  - `[low]` `[patch]` `orderedSalaryChangeFields`'s docstring claimed the gate makes "cannot drift" true rather than aspirational. It demands every key APPEAR but not that the pairing be injective, so a rename to a duplicate field name typechecks and would report two problems under one field, leaving the amount input with none. The claim is narrowed to what the type actually closes, and names the literal-equality test as what catches the rest.
  - `[low]` `[patch]` `AppendSalaryRecordOutcome`'s docstring claimed "the truth has to travel back from the transaction that lost the race, so it does" — but the previous pass's fix recovers the hire date by re-reading AFTER the rollback, so a second edit in that window is quoted instead of the judged one. The claim is downgraded to what the re-read delivers: the current stored hire date, which is the one the user must act on.
  - `[low]` `[patch]` `salaryDeps()` restated `deps()`'s revalidation closure line for line. Both are extracted to one `revalidateEmployee`, whose docstring records why the two paths must invalidate the SAME set — story 4-2 renders the timeline into the very detail route CAP-2 already invalidates, so a route added to one list and not the other is a stale page.
  - `[low]` `[patch]` The Verification table reported `test:mutation` "0 survived, score 100.00" and coverage "global 99.2%" without noting that Stryker mutates `src/domain/**` only and coverage includes `src/domain` + `src/application` only. The adapter's append transaction and the whole Server Action boundary — the code most likely to be wrong — are instrumented by neither. Scoped in the table and named as a residual risk.
  - `[low]` `[patch]` The deferred-work block header said "Both are pre-existing" above six entries, and the spec's Design Notes said "Both are recorded". Only the block's introductory prose was corrected (no existing entry's text, status or resolution was touched, per the orchestrator's constraint); the spec's own sentence was corrected alongside. The `source_spec` path-form split within the block was left alone: both forms pre-date this story and the entries are the orchestrator's.
  - Also corrected: the Spec Change Log's "message text are byte-unchanged" claim, contradicted by the previous pass's own reword of the inactive-country message two sections below it.

## Design Notes

The tie-break is the whole point of AD-8 and the reason CAP-3 cannot be built without the resolver: a same-day correction is CAP-3's *only* correction mechanism, so two records sharing an `effectiveFrom` is the normal case. `seq` is a `BIGSERIAL` and gap-prone — order by it, never arithmetic on it.

```ts
// shape only; ordering is what matters
const current = resolveCurrentSalary(records, asOf); // SalaryRecordView | null
```

`createEmployeesWithSalaries` already performs the in-transaction currency re-resolution, the `isActive` guard and the future-date check for the batch path. Lift that per-record guard into one helper both call, rather than restating it — a divergence between the two paths is exactly the defect AD-6 says the single funnel exists to prevent.

Deliberately **not** closed here (record in `deferred-work.md` if touched): historical `effective_from < hire_date` rows are still never detected; the `FOR SHARE` lock the hire-date trigger takes has an unretried 40P01 deadlock path, and this story adds a second concurrent inserter to that lock.

Both are recorded as the first two entries under _Deferred from: 4-1-record-salary-change-backend_ in [deferred-work.md](deferred-work.md); the review passes appended further entries to that same block. Neither of these two was closed. The second is recorded because this story materially raises its probability: `appendSalaryRecord` fires the insert-side trigger and therefore takes that `FOR SHARE` lock, and CAP-3 is a per-employee form — until now the only inserters were the effectively-serial batch import and the seed.

## Verification

**Commands:**
- `npm run lint` -- expected: clean, including the import-boundary zones.
- `npm run typecheck` -- expected: no errors.
- `npm run test` -- expected: all green, including the untouched CAP-1 import suite.
- `npm run test:coverage` -- expected: `src/domain` 100%, `src/application` >= 90%, global >= 90%.
- `npm run test:mutation` -- expected: zero surviving mutants over `src/domain`.
- `npm run test:integration` -- expected: green, and green again on an immediate second run (fixtures are undeletable).
- `npm run build` -- expected: succeeds.
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` -- expected: no drift (this story adds no migration).

## Auto Run Result

Status: done

### Implemented change

The CAP-3 backend. `salary_record` was append-only at the database but no application path appended a single row, and AD-8's canonical answer to "what does this person earn as of date D" existed nowhere — so every later statistical capability had nothing to read through. This story lands both.

The one current-salary resolver (`src/domain/salary-timeline.ts`) returns the record with the greatest `(effectiveFrom, seq)` at or before `asOf`, with `seq` — never `createdAt` — as the tie-break. Same-date ties are the designed path, because same-day appending is CAP-3's only correction mechanism. The amount and effective-date rules were extracted out of `import-row.ts` into `salary-fields.ts` so the CSV importer and the new form path share exactly one implementation of each; CAP-1's rejection sentences and reason literals are observably unchanged, and its suite passes unmodified. `appendSalaryRecord` is a sibling of `createEmployeesWithSalaries` on the same port and adapter — not a second write funnel — and both now call one lifted per-record guard for currency-from-country, the active-country check and the no-future-dating rule.

### Files changed

**Added**
- `src/domain/salary-timeline.ts` -- THE current-salary resolver (AD-8); pure, total, order-independent.
- `src/domain/salary-fields.ts` -- the one implementation of each salary field rule, shared by both write paths; owns `MAX_AMOUNT_MINOR`.
- `src/domain/salary-change.ts` -- the CAP-3 input validator and its composed rejections; total, no exceptions.
- `src/application/use-cases/record-salary-change.ts` -- find employee → resolve expected currency → validate → append; returns the AD-20 union story 4-2 consumes.
- `src/app/employees/handle-salary-change.ts` -- the testable Server Action body; coerces every field defensively.
- Six test files across domain, application, app boundary and integration.

**Extended**
- `src/application/ports/employee-repository.ts` -- `appendSalaryRecord`, `NewSalaryRecord`, `AppendSalaryRecordOutcome`. No update, no delete over `salary_record`.
- `src/adapters/db/employee-repository.ts` -- the append, plus `assertSalaryRecordWritable` lifted out of the batch funnel and now called by both paths.
- `src/app/employees/actions.ts` -- `recordSalaryChangeAction` and the only new clock-port read.
- `src/domain/import-row.ts` -- delegates to the shared checks; no reason literal or sentence changed.

### Review findings

**First review pass** — two adversarial passes (Blind Hunter, Edge Case Hunter), 20 findings after deduplication.

- **7 patched** — 2 medium, 5 low. Detailed in the Review Triage Log above. The two that mattered: the `AP004` backstop was composing its user-facing sentence from a stale hire date and so was wrong in every case it fired; and the append-only integration test was passing on a privilege error (`42501`) without ever reaching the `AP001` trigger it claimed to prove.
- **4 deferred** — the future-hire-date dead end, double-submit duplicates on an undeletable table, CAP-3 copy quoting raw column tokens, and the `unknown-country` sentence blaming a missing row for a deactivated one. Each is recorded in `deferred-work.md` with evidence; each needs a spec-level decision this story is not entitled to make, and two are blocked by this spec's own "Block If".
- **6 rejected** — chiefly the untrimmed-amount and boundary-cast complaints, which the I/O matrix mandates or which pre-date this story.
- **0 intent gaps, 0 bad-spec findings.** No loopback was triggered; `review_loop_iteration` stayed at 0.

**Follow-up review pass** — the same two hunters, re-run against the full diff. 8 patched (2 medium, 6 low), 3 deferred, 6 rejected, again 0 intent gaps and 0 bad-spec findings. The two that mattered were both *verification* defects rather than behaviour defects: three integration tests asserted a bare `.rejects.toThrow()` and so could not tell which guard fired (the same weakness the first pass patched one screen above them), and the Server Action's own `catch` arm was unreachable by every test and every gate, with the coercion that most needs its protection sitting outside it. The rest were over-claiming docstrings — prose asserting invariants the code does not actually hold — plus one duplicated revalidation closure. Detail in the Review Triage Log.

### Verification performed

Every gate run directly, after the patches of both passes, not merely reported by a subagent:

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run test` | 974 passed, 30 files |
| `npm run test:coverage` | `src/domain` 100%, `src/application` 96.38%, global 99.2% |
| `npm run test:mutation` | **0 survived**, score 100.00 |
| `npm run test:integration` | 109 passed against real PostgreSQL 18; green on an immediate second run |
| `npm run build` | succeeds |
| `prisma migrate diff --exit-code` | "No difference detected" (no migration added) |

**What those two gates do and do not cover.** `stryker.config.json` mutates `src/domain/**` only, and `vitest.config.ts` scopes coverage to `src/domain/**` + `src/application/**`. So "0 survived" and "99.2%" say nothing about `src/adapters/db/employee-repository.ts` or `src/app/employees/handle-salary-change.ts` — the append transaction, the `AP004` re-read, the lifted guard, and the whole boundary coercion are exercised by the unit and integration suites but measured by neither gate. Those two files are covered by assertion, not by instrumentation.

Verified by inspection rather than by gate: `src/domain` and `src/application` contain no `Date.now()`, `new Date()` or timezone read (only prose in comments); the port exposes no method that updates or deletes a salary record.

The commit history pairs each failing test with the code that satisfies it, red first, across the implementation commits; the review-pass commits are fix-with-test.

### Residual risks

- **The port contract moved during review.** `AppendSalaryRecordOutcome`'s `effective-before-hire` arm gained a `hireDate` field after the implementation was complete. Story 4-2 consumes this union, and it is the reason a follow-up review is recommended.
- **Concurrency is the soft edge.** The hire-date trigger's `FOR SHARE` lock now has a second, non-serial inserter, and no retry path exists for `40P01`; a double-submit plants a permanent duplicate. Both are recorded as deferred, and both first become user-visible in 4-2, which is where the decisions belong.
- **The deferred copy defect is now on two surfaces.** CAP-2's rejection sentences already quoted schema tokens; CAP-3 reproduces it. The vocabulary to fix it (`SALARY_FIELD_LABELS`) exists but is wired only into the rejection a real user will not reach.
- **The adapter and the Server Action are outside both quality gates.** Mutation testing and the coverage floor stop at `src/domain` / `src/application` by configuration, so the two files this story is most likely to have got wrong are proven by hand-written assertions alone. The follow-up pass found two real verification holes in exactly that region; there is no gate that would have found a third.
- **The CAP-3 payload's whitespace handling is inconsistent by field**, and its `currency` field is required byte-exact on a path where the server already knows the answer. Both are recorded as deferred: each is a form-contract decision story 4-2 owns, and each is the kind of thing that first becomes visible as "I cannot save anything".
