---
title: 'Employee CRUD backend (CAP-2)'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'b65364aa314b8a392708c24978d684be37688bfb'
final_revision: '2f10dace93e5e51277e6e7ec4c30ace484db9c73'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/implementation-artifacts/spec-2-1-bulk-import-backend.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The only way a person enters the system is a 10,000-row CSV. There is no single-employee create, no edit, and no read path at all — `EmployeeRepository` has exactly two methods (`loadReferenceData`, `createEmployeesWithSalaries`), neither of which reads, and `src/app/employees/page.tsx` is still the 1-6 placeholder. Story 3-2 has no payload to consume, and the typed repository port that Epic 1 deliberately deferred to "its first consumer" has no owner until this story writes it.

**Approach:** Extend the existing port and adapter (never fork them) with employee create, edit, get-by-id, and a paginated name-searchable list; add a pure `src/domain/employee.ts` that validates the CAP-2 field set by delegating to the per-field validators already living inside `validateImportRow` (extracted, not duplicated); expose create/edit as Server Actions returning finalized discriminated-union payloads in the shape `ImportResult` established.

## Boundaries & Constraints

**Always:**
- TDD, red before green. Domain and application suites stay DB-free, clock-free, network-free. `src/domain/**` holds at 100% coverage and must survive `stryker`.
- An employee is created **without a salary record**. UX-DR13's field set is name, role, level, country, gender, hire date — there is no salary field. Such an employee is legitimately outside the as-of population (AD-16) until CAP-3 gives them a salary record.
- Role, level, and country resolve **only** against `is_active` reference rows; codes are case-sensitive, matching `validateImportRow`.
- `countryCode` is absent from the update input type entirely — a call attempting to change it must fail to typecheck, and the DB backs this up (`payroll_app` holds column-level UPDATE on `name`, `role_code`, `level_code`, `gender`, `hire_date`, `updated_at` only).
- Rejections are **data, never exceptions**, all the way out to the Server Action. Every domain and application function is total.
- Ids come from the `IdGenerator` port (AD-10). **No clock is involved anywhere in this story** — once future hire dates are accepted, no CAP-2 rule is date-relative. Do not thread a `today` parameter through for symmetry with import; an unused clock dependency is a Law 6 hazard, not compliance.
- Every ordering is deterministic and total — list order must not depend on insertion order or on ties.
- No `schema.prisma` edit and therefore no migration: every column and grant this story needs already exists. CI's `prisma migrate diff --exit-code` drift gate fails on an uncommitted schema change.

**Block If:**
- The CAP-2 field set turns out to require a salary at create (would contradict UX-DR13 and AD-16 and pull CAP-3 forward).
- Delivering the list requires a schema change (a new column, index, or migration).
- The `validateImportRow` first-fault ordering cannot be preserved while extracting its per-field validators — 2-1's contractual rejection order is not renegotiable here.

**Never:**
- A second unknown-role / unknown-level / unknown-country / gender / date-parse check. Extract and share, or do not write it.
- A second write funnel. Employee create/edit are sibling methods on the same port and same adapter as `createEmployeesWithSalaries`; they never gain a salary parameter.
- Any update or delete path over `salary_record`; any delete path over `employee`.
- **Current salary in the list or detail payload.** The current-salary resolver (AD-8) does not exist yet and belongs to CAP-3/CAP-4. This story's payloads carry identity fields only.
- Any UI. `src/app/employees/page.tsx` stays the placeholder; 3-2 owns the surface.
- A Route Handler (AD-21 caps them at two — import and CSV export; neither is this). Mutations are Server Actions.
- Infinite scroll semantics — the list is offset-paginated.
- Rejecting a **future** hire date. Nothing forbids one; `validateImportRow` does not reject it either. A future-hired employee is simply out of population.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Create, valid | All six fields valid against active reference rows | `{ kind: 'created', employeeId }`; one `employee` row, zero `salary_record` rows | No error expected |
| Create, blank name | `name` is `''` or whitespace | `{ kind: 'rejected', reasons: [{ field: 'name', … }] }`; nothing written | Rejection is a return value |
| Create, unknown/inactive role | `roleCode` absent from active roles | `{ kind: 'rejected' }` naming `role` and the offending value | Rejection is a return value |
| Create, unparseable hire date | `hireDate` = `'31-12-2020'` | `{ kind: 'rejected' }` naming `hire_date` and the offending value | Rejection is a return value |
| Create, several bad fields | Blank name AND unknown level | **All** failing fields reported, one entry each — a form shows every problem at once | Rejection is a return value |
| Create, future hire date | `hireDate` after today | `{ kind: 'created' }` — accepted, out of population | No error expected |
| Update, valid | Existing id, new name/role/level/gender/hire date | `{ kind: 'updated', employeeId }`; `country_code` unchanged | No error expected |
| Update, unknown id | Id matches no row | `{ kind: 'not-found', employeeId }` | Not an exception |
| Update, hire date after an existing salary record | Imported employee, new `hireDate` later than their earliest `effective_from` | `{ kind: 'rejected' }` naming `hire_date` | Adapter maps SQLSTATE `AP004` to this outcome; all other DB errors still throw |
| Get by id, present / absent | Existing id / unknown id | `EmployeeDetail` / `null` | No error expected |
| List, no search | 10,000 rows, page 1 | First page in deterministic order, plus total count | No error expected |
| List, search by name | Substring, mixed case, e.g. `'ana'` | Case-insensitive substring match on name only | No error expected |
| List, page past the end | Offset beyond total | Empty page, correct total | No error expected |
| List, duplicate names | Two employees share a name | Both present, stable distinct order | No error expected |
| Form options, inactive rows | One role and one country are `is_active = false` | Neither appears in `EmployeeFormOptions`; levels come back ordered by `rank`; each country carries its currency code | No error expected |
| Server Action, adapter throws | Repository raises a non-`AP004` error | A rejection payload, never an unhandled throw | Boundary catches, mirroring `handleImportRequest` |

</intent-contract>

## Code Map

- `src/domain/import-row.ts` -- holds the per-field validators (blank-name, unknown-role/level/country/gender, date parse) inside `validateImportRow`; `RejectionReason` union and its contractual first-fault ordering. **Source of the extraction.**
- `src/domain/import-rejection.ts` -- `composeRejectionSentence`, `rejectionOffendingValue`. Reused verbatim for field messages.
- `src/domain/plain-date.ts` -- `parsePlainDate`, `comparePlainDate`, `plainDateToIso`.
- `src/application/ports/employee-repository.ts` -- `EmployeeRepository` (2 methods today), `NewEmployeeWithSalary`, `ReferenceData`. **Extended here.**
- `src/adapters/db/employee-repository.ts` -- `createEmployeeRepository`, the write funnel, `toDbDate`, chunking. **Extended here.**
- `src/application/use-cases/import-employees.ts` -- `ImportResult`; the AD-20 payload precedent to mirror.
- `src/app/api/import/handle-import-request.ts` -- precedent for a boundary catching adapter throws and returning a payload.
- `src/application/ports/id.ts` -- `next()`, the only port this story consumes beyond the repository. (`clock.ts` exists but is deliberately NOT used here — see Always.)
- `prisma/schema.prisma` -- `Employee`, `Role`, `Level` (`rank` UNIQUE), `Country` (`currencyCode`), `Currency`. **Read only — do not edit.**
- `prisma/migrations/20260718171500_review_hardening/migration.sql` -- the employee column-level UPDATE grant.
- `prisma/migrations/20260719050000_review_hardening_1_4/`, `20260719060000_hire_date_lock/` -- the `AP004` hire-date triggers.
- `tests/integration/import-employees.test.ts` -- template for the integration file (per-run suffixed taxonomy, `level.rank` band discipline).
- `tests/application/import-employees.test.ts` -- `fakeRepository`, `fakeIds` patterns to mirror for the new methods.

## Tasks & Acceptance

**Execution:**
- [x] `src/domain/employee.ts` -- add the pure CAP-2 validator: `EmployeeField` (`'name' | 'role' | 'level' | 'country' | 'gender' | 'hire_date'`), `EmployeeInput` (six raw strings), `ValidatedEmployee`, `FieldRejection { field, offendingValue, sentence }`, `EmployeeValidation`, and `validateEmployeeInput(raw, refs)` — no `today` argument. Collects **all** failing fields rather than first-fault, because a form reports every problem at once. A **blank** date reports `offendingValue: null`, not the column name — import's `rejectionOffendingValue` returns `'hire_date'` there, which is a sensible cell identifier in a CSV report table and nonsense next to a form field already labelled "Hire date". Map it in this module; do not change import's behaviour to suit CAP-2. -- The domain half of CAP-2, and the only place employee field rules live.
- [x] `src/domain/import-row.ts` -- extract its per-field checks so `validateImportRow` delegates to the same validators `employee.ts` uses. Its externally-observable first-fault ordering and every existing `RejectionReason` kind must be byte-identical afterwards. -- Kills the second-implementation risk without renegotiating 2-1's contract.
- [x] `tests/domain/employee.test.ts` -- test-first, covering every Matrix row that is domain-level (blank name, unknown role/level/country/gender, unparseable dates, a future hire date being **accepted**, multi-field collection, trimming, case-sensitivity of codes). -- Domain floor is 100% and mutation-tested.
- [x] `tests/domain/import-row.test.ts` -- confirm the existing suite still passes untouched after the extraction; add a case pinning first-fault order if none exists. -- Proves the refactor is behaviour-preserving.
- [x] `src/application/ports/employee-repository.ts` -- add `createEmployee`, `updateEmployee`, `findEmployeeById`, `listEmployees`, `loadFormOptions`, and their types (`NewEmployee`, `EmployeeUpdate` — **no `countryCode`**, `EmployeeDetail`, `EmployeeSummary`, `EmployeeListPage`, `EmployeeFormOptions`). Document why create takes no salary. -- The typed port Epic 1 deferred to this consumer.
- [x] `src/adapters/db/employee-repository.ts` -- implement the five methods on the existing `createEmployeeRepository`. `updateEmployee` catches SQLSTATE `AP004` and returns the hire-date outcome; every other error throws. `createEmployee` and `updateEmployee` each run in a `$transaction` that re-resolves reference activity (see Design Notes — this is tighter than the batch path, deliberately). List clamps `limit` to `1..200` and `offset` to `>= 0`, escapes LIKE metacharacters in the search term, and reads rows + `count` in ONE `$transaction`, ordered by `(name, id)`. A non-UUID `employeeId` answers `not-found` / `null` without throwing. -- Persistence behind the one port; see Design Notes → hostile-input rules.
- [x] `tests/adapters/employee-repository.test.ts` -- unit-test the pure adapter helpers that integration cannot economically cover: the `hasErrorCode` error walk (nested `cause`, nested `meta`, depth bound, cycle safety, and a **non**-`AP004` SQLSTATE still throwing rather than being misreported as `hire-date-after-salary`), the limit/offset clamp, the LIKE escape, and `fromDbDate` under a **non-UTC** `TZ` so a `getUTC*`→local regression cannot pass on a UTC CI box. -- These are the subtlest functions in the story and were previously unexercised.
- [x] `src/application/use-cases/employees.ts` -- `createEmployee`, `updateEmployee`, `getEmployee`, `listEmployees`, `loadEmployeeFormOptions` composing validation + repository, returning the boundary payloads. **Every one of the five is total** — the reads guard their repository call and answer `{ kind: 'unavailable' }`, they do not pass adapter throws through. Deps injected (repository, idGenerator) — no `today`, no clock. -- Application orchestration; no clock, no Prisma. A read that throws is the defect this pass exists to fix.
- [x] `tests/application/employees.test.ts` -- test-first against a fake repository, covering create/update/get/list including `not-found`, the `AP004` outcome, and a throwing repository. -- Application floor is 90%.
- [x] `src/app/employees/actions.ts` -- `'use server'` create and update actions: defensively coerce the incoming shape (see Design Notes → the boundary does not trust its own types), generate the id, call the use-case, catch adapter throws into a rejection payload, then `revalidatePath('/employees')` on a successful write so 3-2 does not have to retrofit cache invalidation onto a "finalized" contract. No clock. Keep the testable body in a separate non-`'use server'` module so it can be unit-tested without Next. -- The AD-20 boundary this story finalizes for 3-2.
- [x] `tests/app/employees-actions.test.ts` -- cover the happy path and the throwing-repository guard. -- An unguarded call site is a designed-in 500.
- [x] `tests/integration/employees.test.ts` -- against real Postgres 18 as `payroll_app`: create writes one employee and zero salary records; update changes the granted columns; a `country_code` update is refused by the database; hire-date-after-salary surfaces `AP004`; list paginates and searches; `loadFormOptions` excludes inactive rows and orders levels by `rank`. Claim `level.rank` band **2_141_000_000..2_147_000_000** (corrected during implementation — the originally assigned 2_150_000_000..2_190_000_000 sits entirely above PostgreSQL's `int` ceiling of 2_147_483_647; see Spec Change Log entry 4). -- Definition of done for a persistence story.

**Acceptance Criteria:**
- Given the domain and application suites, when `npm run test:coverage` runs, then `src/domain/**` is at 100% and `src/application/**` at or above 90%, with no DB, clock, or network touched.
- Given an `EmployeeUpdate` value, when a developer tries to set `countryCode` on it, then `npm run typecheck` fails — the field does not exist on the type.
- Given `src/domain/`, when searched for role/level/country/gender validation, then exactly one implementation of each exists and both `validateImportRow` and `validateEmployeeInput` reach it.
- Given the repository port, when read, then it exposes no update or delete method over `salary_record` and no delete over `employee`.
- Given `prisma/schema.prisma` is unchanged, when CI's drift gate runs, then it reports no drift.
- Given story 3-2 has not started, when `src/app/employees/page.tsx` is read, then it is still the 1-6 placeholder.
- Given `npm run lint`, when it runs, then the import-boundary rule reports no violation — no Prisma outside `src/adapters/db/`, no clock or randomness in domain or application.
- Given the integration suite is run twice in a row against the same database, when it completes, then it passes both times (fixtures are per-run suffixed and the rank band is not shared).
- Given any read use-case and a repository whose method rejects, when the use-case is called, then it resolves to `{ kind: 'unavailable' }` — no test in the suite may observe a read use-case throwing.
- Given a Server Action create call whose input fields are not strings (`42`, `null`, `undefined`), when it runs, then it answers a `rejected` payload naming the offending fields, never a generic write failure and never an unhandled `TypeError`.
- Given a list query with `limit: 1_000_000` and one with `offset: -5`, when each runs, then the effective values are clamped into range, the `page` arm echoes the **clamped** values, and neither throws.
- Given a search term of `'%'` and one of `'_'`, when each runs against employees whose names contain neither character, then no employee matches.
- Given `updateEmployee` and `findEmployeeById` called with `'not-a-uuid'`, when each runs, then they answer `not-found` / `null` respectively without throwing.
- Given a role deactivated after reference data was loaded but before the write, when `createEmployee` runs, then the employee is not written against the inactive role.
- Given an error carrying a SQLSTATE that is not `AP004`, when `updateEmployee` encounters it, then it throws rather than reporting `hire-date-after-salary`.
- Given every comment in the integration suite that names a `level.rank` band, when read, then the number matches the constant the file actually uses.

## Spec Change Log

- **2026-07-19 — implementation deviations, recorded.** Three, all outside `<intent-contract>`:

  1. **The extracted validators live in a new `src/domain/employee-fields.ts`,** not inside
     `employee.ts`. Putting them in `employee.ts` would have closed a cycle —
     `import-row → employee → import-rejection → import-row` — because `employee.ts` needs
     `composeRejectionSentence`. A third pure module breaks it with no duplication:
     `employee-fields.ts` owns the six checks and the field-level reason variants; `import-row.ts`
     re-exports `DateColumn`/`Gender`/`ReferenceData` so no existing import path moved, and
     `RejectionReason` is now `FieldRejectionReason | (the row-level reasons)`.

  2. **`validateEmployeeUpdate` is a second exported entry point** alongside
     `validateEmployeeInput`. The contract requires `countryCode` to be ABSENT from the update input
     type, so create and edit genuinely have different input shapes; both are assembled from the
     same per-field validators, so no rule has a second implementation. The alternative — reading
     the employee's stored country and validating it on every edit — would refuse a name change for
     anyone whose country was later deactivated.

  3. **`FieldRejection.field` is `EmployeeField | null`,** widened from the Design Notes sketch.
     The Matrix's last row requires the Server Action to answer an adapter throw with a rejection
     payload, and no single field caused it; `null` says so, exactly as the existing
     `offendingValue: string | null` says "no one cell is to blame". The union variants are
     otherwise as sketched.

  4. **The `level.rank` band is 2_141_000_000..2_147_000_000, not the assigned
     2_150_000_000..2_190_000_000.** `level.rank` is a PostgreSQL `int`, which caps at
     2_147_483_647 — the assigned band is entirely above the ceiling and PostgreSQL refuses every
     value in it. This is the same fault `tests/integration/import-employees.test.ts` already
     records against its own first draw. The band actually used sits above `reference-data`
     (~2_003_000_000) and above `import` (2_100_000_000..2_140_000_000), overlapping neither.

- **2026-07-19 — review pass 1, `bad_spec` loopback.** Code reverted to `b65364a` and re-derived.

  **Triggering findings.** Four, one root cause: the spec finalized the *write* payloads and never
  defined the *read* boundary contract, so the implementation left `getEmployee`, `listEmployees`,
  and `loadEmployeeFormOptions` as bare pass-throughs that propagate adapter throws — while both the
  spec's Always block and the module's own header declared every application function total. The
  same silence left the query surface undefended: unbounded `limit`, negative `offset`, unescaped
  LIKE metacharacters in search, non-UUID ids reaching an `@db.Uuid` column, and a `'use server'`
  endpoint trusting `string` types that do not exist at runtime.

  **What was amended.** Design Notes gained the read-result unions (`ListEmployeesResult`,
  `GetEmployeeResult`, `FormOptionsResult`, each with an `unavailable` arm), the hostile-input rules
  for the query surface, the "boundary does not trust its own types" rule, and the requirement that
  `createEmployee` re-resolve `is_active` inside its transaction as the batch funnel already does.
  `FieldRejection.field` is nullable in the sketch now, matching what pass 1 correctly discovered.
  Tasks gained a `tests/adapters/employee-repository.test.ts` entry for the previously untested
  `hasErrorCode` walk, the clamp, the LIKE escape, and a non-UTC `TZ` pin on `fromDbDate`; the
  Server Action task gained defensive coercion and `revalidatePath`; the domain task gained the
  blank-date `offendingValue: null` mapping. Nine acceptance criteria were added.

  **Known-bad state avoided.** Story 3-2 inheriting a contract where reads throw — forcing it to
  invent error handling the payload never defined, which is the "frontend adds nothing to the
  contract" that Law 7 forbids — plus a live unauthenticated RPC that answers hand-edited URLs and
  ordinary punctuation with a framework error page.

  **KEEP — these worked and must survive re-derivation:**
  1. The three-module split `employee-fields.ts` / `employee.ts` / `import-row.ts`, and the reason
     for it: putting the shared validators in `employee.ts` closes an import cycle through
     `import-rejection.ts`. `import-row.ts` re-exports `DateColumn`/`Gender`/`ReferenceData` so no
     existing import path moves. This resolved change-log entry 1 and is not up for renegotiation.
  2. `validateEmployeeInput` + `validateEmployeeUpdate` as two entry points over one set of shared
     per-field checks (change-log entry 2), for the reason recorded there.
  3. The `level.rank` band **2_141_000_000..2_147_000_000** (change-log entry 4) — the originally
     assigned band exceeds PostgreSQL's `int` ceiling. Every comment naming a band must state this
     one; pass 1 left a stale comment claiming the impossible band.
  4. Mapping SQLSTATE `AP004` onto a typed outcome rather than matching English message text, and
     the `hasErrorCode` walk over `cause`/`meta` with a depth bound.
  5. The strict red→green commit rhythm, one concern per commit, suffixed `(story 3-1)`.
  6. 100% domain coverage with zero surviving mutants — pass 1 achieved this and it is the floor,
     not the target.

- **2026-07-19 — review pass 2, documentation correction (no loopback).** Pass 2 was a `patch` pass;
  the 15 fixes are recorded in the triage log below. One of them invalidated spec text written in
  the pass-1 amendment, so the text is corrected here rather than left to contradict the code.

  **Triggering finding.** The pass-1 amendment justified transactional `is_active` re-resolution by
  asserting `createEmployeesWithSalaries` "already documents why" and that the single-employee path
  should "close the same window the batch path closes". Both claims are false: the batch funnel
  re-resolves **country only** — to protect the AD-6 currency on the salary record — and never
  re-checks role or level activity.

  **What was amended.** The Design Notes paragraph now states what the batch path actually does and
  says explicitly that this story holds the tighter line rather than restoring a pre-existing
  symmetry; the adapter task drops "matching `createEmployeesWithSalaries`". The batch path's gap is
  story 2-1's and is recorded in `deferred-work.md`.

  **Known-bad state avoided.** A future story reading the old text would "restore symmetry" by
  removing the role/level re-check from the single-employee path — loosening a real guard to match a
  claim that was never true.

  **KEEP (additional, from pass 2):**
  7. `listEmployees` uses the **interactive** `$transaction` form. Prisma 7.8 + `@prisma/adapter-pg`
     accepts `isolationLevel` on the ARRAY form and silently discards it — verified against the live
     database, which still reports `read committed`. An integration test asserts the database really
     reports `repeatable read`. Do not "simplify" this back to the array form.
  8. The revalidation call sits OUTSIDE the write guard and swallows its own failure. A revalidation
     throw must never convert a committed write into "nothing was changed" — that reads as a failure
     to the user, who then resubmits and creates a duplicate.
  9. `withTimeZone` asserts the timezone shift actually took effect before running its body. A TZ
     test that cannot tell whether the runtime honoured the change protects nothing.

- **2026-07-19 — review pass 3, documentation correction (no loopback).** Pass 3 was a `patch` pass;
  the 7 fixes are recorded in the triage log below. One invalidated spec text written in the pass-1
  amendment, so the text is corrected here rather than left to contradict the code.

  **Triggering finding.** Both reviewers independently found that the write transactions do not
  close the reference-deactivation window they are documented to close. A plain `SELECT` takes no
  row lock and the transactions run at READ COMMITTED, so a deactivation committing inside the
  transaction's own span is still admitted. The spec's Design Notes asserted "Both `createEmployee`
  and `updateEmployee` close that window" — a stronger claim than the code delivers.

  **What was amended.** The Design Notes paragraph now says **narrow**, states why a lock-free
  `SELECT` cannot close it, and names `FOR SHARE` as the remedy with the migration precedent that
  already uses it. The adapter comments on both write paths were corrected to match. The lock itself
  is deferred, not silently dropped.

  **Known-bad state avoided.** A future story reading the old text would treat the race as solved
  and build on a guarantee that was never given — the same class of defect as pass 2's
  `isolationLevel` finding, where a comment asserted an isolation the array form silently discarded.

  **KEEP (additional, from pass 3):**
  10. Comments state the guarantee the code actually delivers, never the one intended. Where the two
      differ the gap is deferred in writing. This applies specifically to the two write
      transactions and to the port's `salary_record`-vs-`employee` privilege note, both of which
      overclaimed and were corrected here.

## Review Triage Log

### 2026-07-19 — Review pass 1
- intent_gap: 0
- bad_spec: 4: (high 1, medium 3, low 0)
- patch: 10: (high 0, medium 4, low 6)
- defer: 2: (high 0, medium 1, low 1)
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[high]` `[bad_spec]` Read use-cases (`getEmployee`, `listEmployees`, `loadEmployeeFormOptions`) propagate adapter throws, contradicting the spec's totality invariant and leaving 3-2 no read-failure payload — spec amended with three read-result unions carrying an `unavailable` arm; code reverted for re-derivation.
  - `[medium]` `[bad_spec]` A `'use server'` endpoint trusts compile-time-only `string` types, so a malformed payload becomes a swallowed `TypeError` reported as a generic write failure — spec amended with defensive coercion at the boundary.
  - `[medium]` `[bad_spec]` `limit`/`offset` unvalidated and unbounded on an unguarded read path — spec amended with clamping rules and clamped-value echo.
  - `[medium]` `[bad_spec]` Non-UUID `employeeId` raises a Prisma cast error instead of answering not-found/null — spec amended to treat a hand-editable URL segment as ordinary input.
  - Ten `patch`-class findings (LIKE-metacharacter escaping, non-transactional `findMany`+`count`, blank-date `offendingValue`, `is_active` read-then-write race in the single-employee path, untested `hasErrorCode` walk, `fromDbDate` untested off-UTC, stale rank-band comment, missing `revalidatePath`, an over-claiming test name, an inaccurate Route-Handler count comment) were folded into the spec amendment rather than hand-patched, since the code is re-derived this pass.

## Design Notes

**Why create takes no salary, and why that is not a second funnel.** The funnel's invariants — currency-from-country and no-future-dating — are properties of a *salary record*. An employee created here writes none, so there is nothing for those rules to govern; CAP-3 owns the first salary. `createEmployee` is therefore a sibling method on the same port and the same adapter, sharing its transaction and date-conversion helpers, and it must never grow a salary parameter — that would be the fork this story exists to avoid.

**Why all-fields rejection here but first-fault in import.** Import reports per *row* in a batch, where one reason per row is the useful unit and the ordering is contractual. A form reports per *field*, where surfacing one problem at a time forces a round-trip per mistake. Same validators, different collection strategy — which is exactly why the validators must be extracted rather than the whole `validateImportRow` reused.

**Payload shape**, mirroring `ImportResult`. `FieldRejection.field` is nullable because an adapter
failure blames no single field:

```ts
export type FieldRejection = { field: EmployeeField | null; offendingValue: string | null; sentence: string };
export type CreateEmployeeResult =
  | { kind: 'created'; employeeId: string }
  | { kind: 'rejected'; reasons: readonly FieldRejection[] };
export type UpdateEmployeeResult =
  | { kind: 'updated'; employeeId: string }
  | { kind: 'rejected'; reasons: readonly FieldRejection[] }
  | { kind: 'not-found'; employeeId: string };
```

**Reads carry a failure arm too — this is the contract 3-2 consumes.** Writes are total and reads
are not is an incoherent boundary: story 3-2 renders the directory from these reads, so a read that
throws forces 3-2 to invent error handling the contract never gave it, which is precisely the
"frontend adds nothing to the contract" that Law 7 forbids. Every read use-case returns a union, and
the `unavailable` arm exists so a database outage is an answer rather than an exception:

```ts
export type ListEmployeesResult =
  | { kind: 'page'; employees: readonly EmployeeSummary[]; totalCount: number; limit: number; offset: number }
  | { kind: 'unavailable' };
export type GetEmployeeResult =
  | { kind: 'employee'; employee: EmployeeDetail }
  | { kind: 'not-found' }
  | { kind: 'unavailable' };
export type FormOptionsResult =
  | { kind: 'options'; options: EmployeeFormOptions }
  | { kind: 'unavailable' };
```

The `limit`/`offset` echoed back in the `page` arm are the **effective** (clamped) values, not what
was asked for — a pager that renders the requested value after the adapter clamped it lies.

**The boundary does not trust its own types.** A `'use server'` export is a live RPC endpoint;
`EmployeeInput`'s `string` fields are erased at runtime, so a hostile or buggy caller can send
numbers, `null`, or nothing at all. The Server Action layer coerces every field to a string
defensively (a non-string becomes a rejection naming that field, never a `TypeError` swallowed into
a generic write failure). No new dependency is needed for this — hand-rolled shape checking at the
one boundary is smaller than a schema library and keeps the domain free of it.

**Hostile-input rules for the query surface**, all belonging to the adapter:
- `limit` is clamped to `1..200` and `offset` to `>= 0`, both truncated to integers. An unbounded
  `take` is a denial-of-service on a 10,000-row table, and a negative `skip` is a raw Prisma throw.
- The search term is escaped for LIKE metacharacters before it reaches `contains` — otherwise a
  search for `%` matches every employee and `_` matches any character.
- A malformed (non-UUID) `employeeId` answers `not-found` / `null` rather than throwing, because
  `employee.id` is `@db.Uuid` and Prisma raises a cast error before any row is examined. An id
  arrives from a URL segment a user can hand-edit; that is ordinary input, not an invariant breach.
- The page and its `totalCount` are read in **one** `$transaction` so a pager cannot show a total
  that disagrees with the rows beside it.

**`is_active` is re-resolved inside the write transaction, on both write paths.** The reference read
happens outside the transaction, so a role or level can be deactivated between judgement and write,
and the FKs target `code` — they check existence, not activity. Both `createEmployee` and
`updateEmployee` **narrow** that window to the width of their own transaction.

They do not close it, and the distinction is load-bearing rather than pedantic. A plain `SELECT`
takes no row lock, and these transactions run at PostgreSQL's default READ COMMITTED, so a
concurrent `UPDATE role SET is_active = false` can still commit between the re-read and the write.
Closing it outright requires a `FOR SHARE` lock on the reference rows — the technique
`20260719060000_hire_date_lock` already uses on the parent row, and argues for there at length.
That hardening is deferred (see `deferred-work.md`); what is NOT deferred is that the code and its
comments claim only the guarantee they deliver.

Note what the batch path actually does, because it is easy to misread: `createEmployeesWithSalaries`
re-resolves **country only**, to protect the AD-6 currency written onto the salary record, and never
re-checks role or level activity. So this story is not restoring a symmetry that already existed —
it is holding the tighter line, and the batch path's gap is story 2-1's to close (recorded in
`deferred-work.md`). Do not "fix" the single-employee path down to the batch path's level.

**Why `AP004` is a rejection, not a throw.** The adapter's existing rule is that invariant violations throw because the input was already judged. A hire date landing after an existing salary record is different: it is user input this story cannot judge without reading the employee's salary history, so the database is the judge and its verdict must reach the user as data. Only `AP004` is mapped; everything else keeps throwing.

**List ordering.** `(name, id)` — name alone ties on duplicates, and offset pagination over a non-total order silently drops and repeats rows between pages.

## Verification

**Commands:**
- `npm run lint` -- expected: clean, including `import/no-restricted-paths`.
- `npm run typecheck` -- expected: clean.
- `npm run test` -- expected: all suites green, new domain/application/app tests included.
- `npm run test:coverage` -- expected: passes the 100% `src/domain/**` and 90% `src/application/**` floors.
- `npm run test:mutation` -- expected: no surviving mutant in `src/domain`.
- `npm run test:integration` -- expected: green against a disposable Postgres 18 with `DATABASE_URL` and `DATABASE_URL_APP` set; run twice to prove re-runnability.
- `npm run build` -- expected: succeeds; the Server Action file compiles.
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` -- expected: no drift.

**Manual checks (if no CLI):**
- `src/app/employees/page.tsx` is unchanged from its 1-6 placeholder state.

### 2026-07-19 — Review pass 2
- intent_gap: 0
- bad_spec: 0
- patch: 15: (high 1, medium 7, low 7)
- defer: 3: (high 0, medium 2, low 1)
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[high]` `[patch]` `deps.revalidate()` sat inside the write guard, so a `revalidatePath` throw after a COMMITTED write answered "The employee could not be saved, so nothing was changed" — a false statement whose natural user response is to resubmit and create a duplicate. Revalidation moved outside the guard and made self-swallowing, on both create and update.
  - `[medium]` `[patch]` `listEmployees`' `$transaction` carried no isolation level, so the page and its `totalCount` still straddled concurrent writes at READ COMMITTED — the exact bug the comment claimed was closed. Probing the live database revealed Prisma 7.8 silently discards `isolationLevel` on the ARRAY form; rewritten to the interactive form, with an integration test asserting the database reports `repeatable read`.
  - `[medium]` `[patch]` `updateEmployee` left open the reference-activity race `createEmployee` builds a transaction to close; now re-resolves role and level activity in a transaction, with integration tests exercising the race.
  - `[medium]` `[patch]` The `createEmployee` comment asserted a symmetry with the batch funnel that does not exist — corrected in code and in the spec (see Spec Change Log).
  - `[medium]` `[patch]` `clampListLimit(NaN)` returned the CEILING, making `?limit=abc` the cheapest route to the most expensive page the system serves; now returns a new `DEFAULT_LIST_LIMIT` of 25.
  - `[medium]` `[patch]` Added `MAX_LIST_OFFSET` — an unbounded deep offset is the same denial-of-service class the limit clamp closes.
  - `[medium]` `[patch]` A non-string `employeeId` answered "could not be saved" while `'not-a-uuid'` answered `not-found`; same wire, same cause, contradictory answers. Both now answer `not-found`.
  - `[medium]` `[patch]` The adapter's `updateEmployee` catch-block wiring was untested — only the `hasErrorCode` predicate was. Five stub-client tests now drive it, including a non-`AP004` SQLSTATE rejecting with the original error rather than being misreported as `hire-date-after-salary` (the spec AC).
  - `[low]` `[patch]` `updateEmployee`'s outcome switch had no exhaustiveness guard, so a widened union would resolve to `undefined` in a module promising totality; `never`-typed default added.
  - `[low]` `[patch]` `search: ''` behaved identically to `search: null` despite the port documenting them as different; blank and whitespace-only terms now explicitly mean no filter, and both doc comments say so.
  - `[low]` `[patch]` The `fromDbDate` timezone test could pass vacuously if the runtime ignored a late `TZ` mutation — precisely the regression it exists to catch. `withTimeZone` now asserts the shift took effect first; verified to go red when the shift is neutered. (Incidental: this machine's ambient TZ made the east-of-Greenwich case near-vacuous.)
  - `[low]` `[patch]` `nonTextFieldRejection` rendered the internal token `hire_date` in user-facing copy, reintroducing exactly what the blank-date path goes to trouble to strip; field labels added.
  - `[low]` `[patch]` An unsuffixed `'Renamed'` fixture accumulated in a shared database with no cleanup path, contradicting the suite's run-scoping claim; now suffixed.
  - `[low]` `[patch]` No test searched for a literal backslash — the one case where `escapeLikePattern`'s doubling is load-bearing. Integration test added with a decoy that fails loudly rather than merely returning empty.
  - `[low]` `[patch]` Edits revalidated only `/employees`, leaving the detail route stale; the employee id is now threaded through so both paths revalidate.

### 2026-07-19 — Review pass 3
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 4: (high 0, medium 2, low 2)
- reject: 15: (high 0, medium 3, low 12)
- addressed_findings:
  - `[medium]` `[patch]` Both write transactions were documented as CLOSING the reference-deactivation window; a plain `SELECT` takes no row lock and they run at READ COMMITTED, so they only NARROW it to the transaction's own span. Adapter comments and the spec's Design Notes corrected to the guarantee actually delivered; the `FOR SHARE` hardening that would close it is deferred with the migration precedent named.
  - `[medium]` `[patch]` The port asserted "the database revokes both" of `salary_record` update/delete and `employee` delete. `payroll_app` still HOLDS `DELETE` on `employee` — the file's own integration test says so in as many words, so the port and the test directly contradicted each other. Comment now separates the two enforcement mechanisms and states that only the absent method stands between the product and a deleted employee.
  - `[medium]` `[patch]` `normalizeSearchTerm` trusted its `string | null` type on the one field the port names hostile input and never defended. `searchParams` yields `undefined` for an absent parameter and an ARRAY for a repeated one (`?q=a&q=b`), either of which reached `.trim()` as a `TypeError` that the read use-case reports as `{ kind: 'unavailable' }` — an outage screen for a duplicated query parameter. Non-strings now answer no-filter, and the term is bounded by a new `MAX_SEARCH_LENGTH`, closing the same denial-of-service class the limit clamp closes on the one free-text field.
  - `[low]` `[patch]` Nothing proved either write path opens a transaction at all: every write stub was `$transaction: (body) => body(delegates)`, which runs the body inline, so deleting the transaction entirely left all nine adapter tests and both integration race tests green. Two probes added that record whether the write landed while a transaction was open — verified to go red when the transaction is removed.
  - `[low]` `[patch]` The integration suite's rank-band comment claimed a maximum draw of `+2` (2_147_000_001) while the file inserts `+3` and `+4`; the true maximum is 2_147_000_003. An explicit acceptance criterion forbids exactly this drift.
  - `[low]` `[patch]` The "still permits an UPDATE of the granted columns" test asserted `resolves.toBeDefined()`, which passes on ZERO matched rows — the counterpart assertion did not discharge the "passing for the wrong reason" concern that motivates it. Now asserts `rowCount` and reads the name back.
  - `[low]` `[patch]` The deactivated-LEVEL race test omitted the "was pickable" precondition its role twin asserts, so it would pass even if the fixture level had never been active — proving refusal-because-unknown rather than refusal-because-retired.

## Auto Run Result

Status: `done` — two implementation passes (one `bad_spec` loopback), three review passes.

### Implemented change

CAP-2's backend. The typed repository port Epic 1 deferred to "its first consumer" now exists: five
new methods (`createEmployee`, `updateEmployee`, `findEmployeeById`, `listEmployees`,
`loadFormOptions`) on the same port and adapter as the import funnel, never a fork. Employees are
created without a salary record (UX-DR13's field set has no salary; AD-16 leaves them out of
population until CAP-3 gives them one), `countryCode` is absent from the update type so a country
edit does not typecheck, and the six per-field validation rules have exactly one implementation
shared by both the CSV importer and the CAP-2 form. Create/edit are Server Actions returning
discriminated-union payloads; the reads return unions too, each with an `unavailable` arm, so story
3-2 inherits a contract that covers failure instead of having to invent one.

### Files changed

| File | Purpose |
|---|---|
| `src/domain/employee-fields.ts` | The six shared per-field validators — the single implementation both callers reach |
| `src/domain/employee.ts` | CAP-2 create/update validation, collecting ALL failing fields (a form shows every problem at once) |
| `src/domain/import-row.ts` | Now delegates to the shared validators; first-fault ordering and every reason kind preserved |
| `src/application/ports/employee-repository.ts` | +5 methods, +8 types; still no update/delete over `salary_record` |
| `src/adapters/db/employee-repository.ts` | The five implementations, query clamping, LIKE escaping, UUID guard, `AP004` mapping |
| `src/application/use-cases/employees.ts` | Five use-cases, all total, and the finalized boundary payloads |
| `src/app/employees/handle-employee-write.ts` | Testable Server Action body: defensive coercion, write guard, revalidation |
| `src/app/employees/actions.ts` | `'use server'` composition root |
| `tests/domain/employee.test.ts`, `tests/domain/import-row.test.ts` | Domain suites incl. a whole-cascade ordering pin |
| `tests/adapters/employee-repository.test.ts` | The helpers integration cannot economically reach |
| `tests/application/employees.test.ts`, `tests/app/employees-actions.test.ts` | Use-case and boundary suites |
| `tests/integration/employees.test.ts` | Real Postgres 18, incl. reference-activity races and privilege behaviour |

### Review findings

- **Pass 1 — `bad_spec` loopback.** The spec finalized the write payloads but never defined the read
  boundary contract, so the reads shipped as bare pass-throughs that propagated adapter throws while
  the spec and the code both claimed totality. The same silence left the query surface undefended.
  Code was reverted to `b65364a`, the spec amended with read-result unions, hostile-input rules,
  defensive coercion, and transactional activity re-resolution, then re-derived.
- **Pass 2 — 15 patches, 3 deferred, 6 rejected.** Highest-consequence: `revalidate()` sat inside
  the write guard, so a revalidation throw reported a COMMITTED write as "nothing was changed" —
  a user acting on that creates a duplicate. Also: the list transaction ran at READ COMMITTED
  despite a comment claiming otherwise (Prisma 7.8 silently discards `isolationLevel` on the array
  form — established by probing the live database, not by assumption); `updateEmployee` left open
  the reference-activity race `createEmployee` closes; `clampListLimit(NaN)` returned the ceiling.
- **Deferred (3):** the batch funnel re-resolves country only, never role/level activity (story
  2-1's); `payroll_app` holds an un-revoked `DELETE` on `employee`; `hasErrorCode`'s depth bound is
  unvalidated against real driver nesting.
- **Pass 3 — 7 patches, 4 deferred, 15 rejected.** An independent follow-up review (recommended by
  pass 2) of the patched result. Its theme was **comments that promise more than the code delivers**
  — the same class as pass 2's `isolationLevel` finding, found twice more. Both write transactions
  were documented as CLOSING the reference-deactivation race when a lock-free `SELECT` at READ
  COMMITTED only narrows it; the port asserted the database revokes `DELETE` on `employee` when it
  does not, contradicting the story's own integration test one file away. Both claims were corrected
  in code and in the spec, with the `FOR SHARE` remedy deferred rather than dropped. Also closed:
  `search` was the one field the port names hostile and never defended (a repeated `?q=` query
  parameter arrives as an ARRAY and became an outage screen), and neither write path had any test
  proving it opened a transaction at all — every stub ran the body inline, so deleting the
  transaction left the whole suite green.
- **Deferred (4 more, pass 3):** the `FOR SHARE` lock that would actually close the race; eight bare
  `catch` blocks that discard the error object, leaving no way to tell an outage from a bug
  (pre-existing in shape — the import path swallows identically — so it needs a logging port decided
  once); no optimistic concurrency on `updateEmployee`, so two editors silently lose one set of
  edits; and CAP-2 form rejections reusing the CSV importer's spreadsheet vocabulary verbatim
  ("The hire_date cell is blank").

### Verification

All run in this session against the final tree, not taken on report:

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run test` | 813 passed (23 files) — pass 3 added 5 |
| `npm run test:coverage` | 100% statements/branches/functions/lines; domain and application floors met |
| `npm run test:mutation` | 100.00, 601 killed, **0 survived** |
| `npm run test:integration` | 94 passed against real Postgres 18, re-run clean |
| `npm run build` | compiled successfully |
| `prisma migrate diff --exit-code` | "No difference detected" |

`prisma/schema.prisma` untouched, no migration added, `src/app/employees/page.tsx` still the 1-6
placeholder (3-2 owns the surface).

### Residual risks

- **`src/app/**` and `src/adapters/**` are outside the coverage gate** (`vitest.config.ts` includes
  only domain and application). `actions.ts` — the composition root and the `revalidatePath` strings
  — has no test; a typo there ships silently. Consistent with story 2-1's precedent, but the surface
  is larger now.
- **No authentication or authorization** on either Server Action — a product-level gap recorded in
  `deferred-work.md`. The attack surface widened from one file-upload endpoint to structured
  create/edit RPCs over the whole directory.
- **`{ kind: 'not-found', employeeId: '' }`** is what a non-string id yields; if 3-2 renders that
  field it needs a display rule. Widening the type to `string | null` is a contract change this
  story declined to make unilaterally.
- **The integration suite has no cleanup path** and now leaves rows on retired reference codes from
  the race tests. Consistent with the suite's documented posture; the standing "fresh database per
  run" item would dissolve it.
- **The reference-deactivation race is narrowed, not closed** — see the pass-3 deferral. Behaviour
  is unchanged from pass 2; what changed is that the code no longer claims otherwise.
- **`followup_review_recommended: false`** — pass 2's recommendation was discharged by pass 3, which
  found no new behavioural defect in the patched result. Pass 3's own changes are one behavioural
  fix in a narrow spot (`normalizeSearchTerm` guards non-strings and bounds length), four comment
  and spec corrections that change no execution path, and two test hardenings — one of which was
  verified to go red when the code it covers is removed. All gates re-run green, including mutation
  at 100.00 with 0 survivors and the integration suite twice. That is not the profile that benefits
  from another independent pass; the four deferred items are the real remaining work and each names
  its own remedy.
