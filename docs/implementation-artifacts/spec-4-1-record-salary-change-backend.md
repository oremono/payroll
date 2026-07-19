---
title: 'Record a Salary Change — backend (CAP-3, story 4-1)'
type: 'feature'
created: '2026-07-19'
status: 'in-progress'
baseline_revision: '8b7a79c9a1823a0539649a295a8c95d11e3b0d0f'
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

## Tasks & Acceptance

**Execution:**
- [ ] `tests/domain/salary-timeline.test.ts` -- assert the resolver: greatest `(effectiveFrom, seq)` at or before `asOf`; same-date tie broken by `seq` not `createdAt`; unordered input; all-future input and empty input → `null`; single record -- red first, and it is the AD-8 contract every later epic reads through.
- [ ] `src/domain/salary-timeline.ts` -- add the one current-salary resolver, pure and total, taking records + `asOf` -- AD-8 mandates exactly one, in the domain.
- [ ] `tests/domain/salary-fields.test.ts` -- assert the extracted amount and effective-date checks over the full I/O matrix rows, including `MAX_AMOUNT_MINOR` and the future-date boundary (today passes, today+1 rejects) -- red first.
- [ ] `src/domain/salary-fields.ts` -- extract the amount/effective-from/currency-match checks out of `import-row.ts` into a shared module, its reason union extended by `RejectionReason` -- one implementation per rule (3-1's binding decision).
- [ ] `src/domain/import-row.ts` -- delegate to the extracted checks; change no reason literal and no sentence -- CAP-1's contract must be observably unchanged.
- [ ] `tests/domain/salary-change.test.ts` -- assert the CAP-3 input validator's field ordering and every rejection in the matrix -- red first.
- [ ] `src/domain/salary-change.ts` -- validate a salary-change input against the employee's country currency, `hireDate`, and `today`; return `{ok:true,…} | {ok:false, reasons: FieldRejection[]}` -- total, no exceptions.
- [ ] `src/application/ports/employee-repository.ts` -- add the salary-append method (input carrying `salaryRecordId`, `employeeId`, `salary: Money`, `effectiveFrom`) plus its typed outcome union -- append and reads only (AD-18).
- [ ] `tests/application/record-salary-change.test.ts` -- assert the use-case against a fake repository: recorded, rejected, not-found, and adapter-throw → rejection -- red first.
- [ ] `src/application/use-cases/record-salary-change.ts` -- orchestrate: find employee → resolve expected currency from country → validate → append; return the AD-20 union -- deps as a first object argument, per `employees.ts`.
- [ ] `src/adapters/db/employee-repository.ts` -- implement the append as a sibling of `createEmployeesWithSalaries`, sharing its in-transaction currency re-resolution, `isActive` guard and future-date check; map `AP004` to a typed outcome -- a second funnel is a defect.
- [ ] `src/app/employees/handle-salary-change.ts` + `src/app/employees/actions.ts` -- add the testable handler and its `'use server'` entry, coercing every field defensively, reading `today` from the clock port, revalidating outside the write guard -- `'use server'` is a live RPC and types are erased at runtime.
- [ ] `tests/app/handle-salary-change.test.ts` -- assert boundary coercion of non-string/number inputs and that money crosses as a decimal string -- red first.
- [ ] `tests/integration/salary-records.test.ts` -- against real Postgres 18: append succeeds and is readable; a second same-day append receives a strictly greater `seq`; a future-dated append is refused; `UPDATE`/`DELETE` still raise `AP001` -- uses unique fixture suffixes and is re-runnable, since these rows cannot be deleted.

**Acceptance Criteria:**
- Given an employee with an existing salary record, when a change is recorded, then the prior row's every column is unchanged and the new row is an additional row.
- Given the repository port after this story, when its type is inspected, then it exposes no method that updates or deletes a salary record.
- Given the codebase after this story, when `src/domain` and `src/application` are searched, then they contain no `Date.now()`, `new Date()`, or timezone read.
- Given two records with the same `effectiveFrom`, when current salary is resolved at any `asOf` on or after that date, then the record with the greater `seq` is returned regardless of insertion order in the input list.
- Given the CAP-1 import path, when its suite runs after the validation extraction, then every existing import test passes unmodified.
- Given the story is complete, when the gates run, then lint, typecheck, import-boundary, coverage floor (`src/domain` 100%, `src/application` >= 90%) and domain mutation testing are green with zero surviving mutants.
- Given the story's commit history, when it is read, then each failing test appears in a commit before the code that satisfies it.

## Spec Change Log

## Review Triage Log

## Design Notes

The tie-break is the whole point of AD-8 and the reason CAP-3 cannot be built without the resolver: a same-day correction is CAP-3's *only* correction mechanism, so two records sharing an `effectiveFrom` is the normal case. `seq` is a `BIGSERIAL` and gap-prone — order by it, never arithmetic on it.

```ts
// shape only; ordering is what matters
const current = resolveCurrentSalary(records, asOf); // SalaryRecordView | null
```

`createEmployeesWithSalaries` already performs the in-transaction currency re-resolution, the `isActive` guard and the future-date check for the batch path. Lift that per-record guard into one helper both call, rather than restating it — a divergence between the two paths is exactly the defect AD-6 says the single funnel exists to prevent.

Deliberately **not** closed here (record in `deferred-work.md` if touched): historical `effective_from < hire_date` rows are still never detected; the `FOR SHARE` lock the hire-date trigger takes has an unretried 40P01 deadlock path, and this story adds a second concurrent inserter to that lock.

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
