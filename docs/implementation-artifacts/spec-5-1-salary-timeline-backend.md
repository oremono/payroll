---
title: 'Salary Timeline — backend (CAP-4, story 5-1)'
type: 'feature'
created: '2026-07-23'
status: 'done'
baseline_revision: '21f7ac94ead96a495af31cb52e64a3d169fde6f0'
final_revision: '42cc427e34722047087390db5afb318909ea432b'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-5-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 4-1 landed the append-only `salary_record` write path and the one AD-8 current-salary resolver (`resolveCurrentSalary`), but nothing can READ an employee's salary history: the repository port exposes only `appendSalaryRecord` (no read), the resolver has no production consumer, and no finalized boundary payload exists for a surface to render the timeline. CAP-4 is the trust surface that proves prior records stay readable and unmodified.

**Approach:** Land the CAP-4 backend read: a pure domain timeline-ordering function (`orderSalaryTimeline`) that filters to `effectiveFrom <= asOf` and sorts newest-first using the SAME `(effectiveFrom, seq)` comparison the resolver uses; a read method on the existing `EmployeeRepository` port + adapter; a `getSalaryTimeline` use-case returning the finalized AD-20 payload (money as `BoundaryMoney`, current record marked by id); and the lazy-forwarder plumbing. No UI — story 5-2 consumes this payload and derives percent-change and `(Hire)` at render.

## Boundaries & Constraints

**Always:**
- Current salary is resolved by the ONE existing resolver `resolveCurrentSalary(records, asOf)` (AD-8) — never a second determination. The timeline's newest row and the resolver's pick MUST agree; a domain test asserts `orderSalaryTimeline(records, asOf)[0]?.id === resolveCurrentSalary(records, asOf)?.id`. (AD-8)
- Timeline ordering lives in `src/domain/` as a pure, total function reusing one `(effectiveFrom, seq)` comparison shared with the resolver — no `ORDER BY` over `salary_record` in the adapter, no second comparator. (Law 2, AD-8)
- The timeline is as-of-filtered: it shows only records with `effectiveFrom <= asOf`, newest-first. `asOf` is a required explicit `PlainDate` argument through domain and application; the clock port is read only at the delivery boundary (which is 5-2's page). (AD-11, AD-16, Law 6)
- Money leaves the application layer as `BoundaryMoney` (`amountMinor` decimal string + `currency`), never a number, never a raw `bigint` — this is the first OUTBOUND `toBoundaryMoney` call site, and `bigint` cannot cross a React-prop/JSON boundary. (AD-4, Law 4)
- The read is total and self-contained: adapter throw → `{ kind: 'unavailable' }`, unknown/malformed employee id → `{ kind: 'not-found' }`, otherwise `{ kind: 'timeline', … }`. Rejections/refusals are return values, never exceptions in domain/application. (Law 8)
- Read-only: extend the port with a read method only; expose no update or delete over `salary_record`; add no Route Handler, no Server Action (reads are RSC-in-process). (AD-18, AD-21, Law 5)
- `seq` never crosses the boundary — the current record is marked by `id`. Dates cross as `PlainDate`, matching the existing `EmployeeDetail` read on the same page.
- Test-first: every assertion committed red before the code that satisfies it, as a separate commit. New domain code is 100% covered and survives mutation; new application code ≥ 90%.

**Block If:**
- Distinguishing "unknown employee" from "employee with empty history" would require a schema change (it does not — a single nested `findUnique` distinguishes them).
- The finalized payload proves insufficient for the 5-2 timeline (effective date, amount-with-currency per row, current-record marker, as-of date) without adding a field.

**Never:**
- No UI, no change to `src/app/employees/[id]/page.tsx` or any render surface, no client component, no percent-change derivation, no `(Hire)` label — those are story 5-2.
- No second resolver, second current-salary determination, second median, or second `ORDER BY` over `salary_record`.
- No `Date.now()` / `new Date()` / timezone read under `src/domain` or `src/application`. No raw SQL where Prisma is used. No currency re-resolution at read time (the record carries its own currency — AD-6).
- Do not show records with `effectiveFrom > asOf`; do not convert or cross currencies; do not persist derived fields.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Full history at today | Employee with hire + 2 later changes; `asOf` = today | `{kind:'timeline'}`; 3 rows newest-first; `currentSalaryRecordId` = newest row's id; each `salary.amountMinor` a decimal string with `currency` | No error expected |
| Past as-of filters later records | `asOf` after hire but before the first change | Only records with `effectiveFrom <= asOf` returned; `currentSalaryRecordId` = newest remaining | No error expected |
| As-of before hire | Every record has `effectiveFrom > asOf` | `records: []`; `currentSalaryRecordId: null`; still `kind:'timeline'` | No error expected |
| Same-day correction | Two records share `effectiveFrom`; `asOf` on/after that date | Both rows present; the greater-`seq` record is the head and the current one | No error expected |
| Empty history, employee exists | Employee row present, zero salary records (defensive) | `records: []`; `currentSalaryRecordId: null`; `kind:'timeline'` | No error expected |
| Unknown employee | Random UUID with no employee row | `{kind:'not-found'}` | No throw |
| Malformed / non-string id | `'not-a-uuid'`, or a non-string from a hostile caller | `{kind:'not-found'}` via the `isUuid` guard | No throw |
| Repository throws | Adapter/DB throws | `{kind:'unavailable'}` | Return value, not a throw |
| Money encoding | Any returned row | `salary.amountMinor` is a decimal string (never number/bigint); `currency` present; `seq` absent from payload | n/a |

</intent-contract>

## Code Map

- `src/domain/salary-timeline.ts` -- `resolveCurrentSalary`, `SalaryRecordView` (`{id, seq: bigint, effectiveFrom: PlainDate, salary: Money}`), `SalaryRecordOrder`; the private `(effectiveFrom, seq)` comparison to share. THE place the new `orderSalaryTimeline` lives.
- `src/domain/money.ts` -- `Money`, `BoundaryMoney`, `toBoundaryMoney` (first outbound use here).
- `src/domain/plain-date.ts` -- `PlainDate`, `comparePlainDate`; dates stay structural across the boundary.
- `src/application/ports/employee-repository.ts` -- full `EmployeeRepository`; `findEmployeeById` returns `EmployeeDetail | null` (the read-null idiom to mirror); `NewSalaryRecord`, `AppendSalaryRecordOutcome` (append side, unchanged).
- `src/application/use-cases/employees.ts` -- `EmployeeUseCaseDeps`, `getEmployee` (the total-read pattern: `try { … } catch { return {kind:'unavailable'} }`, three-arm union) to mirror exactly.
- `src/application/use-cases/record-salary-change.ts` -- sibling capability use-case in its own file; deps-as-first-object idiom.
- `src/adapters/db/employee-repository.ts` -- `createEmployeeRepository` factory; `findEmployeeById` read pattern; `isUuid`, `fromDbDate` (UTC getters), `EMPLOYEE_IDENTITY_SELECT`; `SalaryRecord` maps `amountMinor`/`seq` as native `bigint`, `currencyCode` as the record's currency.
- `src/app/employees/employee-deps.ts` -- `lazyEmployeeRepository()` forwards every port method (exhaustive over `EmployeeRepository`); `employeeReadDeps()`.
- `prisma/schema.prisma` (`SalaryRecord`) -- `seq BIGSERIAL @unique`, `amountMinor`, `currencyCode`, `effectiveFrom DATE`, `@@index([employeeId, effectiveFrom])`. No schema change this story.
- `tests/integration/salary-records.test.ts` -- integration conventions: real PG (owner + `payroll_app`), unique fixture suffix, per-file rank band, re-runnable (undeletable rows), `sqlstateOf`.

**Added by this story:**

- `src/application/use-cases/salary-timeline.ts` -- `getSalaryTimeline`, and the finalized payload types `SalaryTimelineView`, `SalaryTimelineRow`, `GetSalaryTimelineResult` that story 5-2 consumes unmodified.
- `tests/application/salary-timeline.test.ts`, `tests/integration/salary-timeline.test.ts`.

**Extended by this story:**

- `src/domain/salary-timeline.ts` -- `orderSalaryTimeline`; extract the shared `(effectiveFrom, seq)` comparison (`compareSalaryOrder`) used by both it and the resolver (refactor; resolver behavior unchanged).
- `src/application/ports/employee-repository.ts` -- `findSalaryHistory(employeeId): Promise<readonly SalaryRecordView[] | null>` (null = no such employee).
- `src/adapters/db/employee-repository.ts` -- `findSalaryHistory` (nested `findUnique`, `isUuid` guard, `fromDbDate`, no `ORDER BY`); added to the factory.
- `src/app/employees/employee-deps.ts` -- `findSalaryHistory` forwarding in `lazyEmployeeRepository()`.
- `tests/domain/salary-timeline.test.ts` -- `orderSalaryTimeline` assertions.
- `tests/application/employees.test.ts`, `tests/app/employees-actions.test.ts`, `tests/application/import-employees.test.ts`, `tests/application/record-salary-change.test.ts` -- a `findSalaryHistory` stub on each fake repository (type propagation; no assertion changed).

## Tasks & Acceptance

**Execution:**
- [x] `tests/domain/salary-timeline.test.ts` -- assert `orderSalaryTimeline`: filters out `effectiveFrom > asOf`; newest-first by `(effectiveFrom, seq)`; same-date tie broken by greater `seq` first; order-independent input; empty and all-after-asOf → `[]`; and the agreement invariant `ordered[0]?.id === resolveCurrentSalary(records, asOf)?.id` -- red first; this is the AD-8-consistency contract.
- [x] `src/domain/salary-timeline.ts` -- add `orderSalaryTimeline<T extends SalaryRecordOrder>(records, asOf): readonly T[]`; extract `compareSalaryOrder` and route both the resolver and the new function through it -- one comparison, pure and total.
- [x] `src/application/ports/employee-repository.ts` -- add `findSalaryHistory` returning `readonly SalaryRecordView[] | null` -- read-only; no update/delete arm (AD-18).
- [x] `tests/application/salary-timeline.test.ts` -- assert `getSalaryTimeline` over a fake repository across the I/O matrix: timeline / not-found (null) / unavailable (throw); as-of filtering; `currentSalaryRecordId` marks the resolver's pick; money crosses as a `BoundaryMoney` decimal string; dates as `PlainDate`; `seq` absent -- red first.
- [x] `src/application/use-cases/salary-timeline.ts` -- orchestrate: `findSalaryHistory` → if `null` `not-found` → resolve current via `resolveCurrentSalary` → order via `orderSalaryTimeline` → encode each row's money with `toBoundaryMoney`, drop `seq`, mark `currentSalaryRecordId` -- deps as a first object argument; total, throw→`unavailable`.
- [x] `src/adapters/db/employee-repository.ts` -- implement `findSalaryHistory`: `isUuid` guard → `employee.findUnique({ where:{id}, select:{ id:true, salaryRecords:{ select:{ id, seq, amountMinor, currencyCode, effectiveFrom } } } })`; `null` employee → `null`; else map rows to `SalaryRecordView` (`fromDbDate`, `amountMinor`/`seq` native `bigint`, `currency: currencyCode`); no `ORDER BY`; add to `createEmployeeRepository` -- one query distinguishes not-found from empty.
- [x] `src/app/employees/employee-deps.ts` -- forward `findSalaryHistory` in `lazyEmployeeRepository()` -- the forwarder is exhaustive over the widened port.
- [x] `tests/application/employees.test.ts`, `tests/app/employees-actions.test.ts`, `tests/application/import-employees.test.ts`, `tests/application/record-salary-change.test.ts` -- add a `findSalaryHistory` stub to each fake repository so the widened port still typechecks -- no existing assertion, expectation, or reason literal touched.
- [x] `tests/integration/salary-timeline.test.ts` -- against real Postgres 18: seed one employee with a hire record plus a later change plus a same-day correction (greater `seq`); read back via the real adapter + use-case; assert newest-first order, `currentSalaryRecordId` at `asOf` = today and at a past `asOf` that hides later records, and an unknown UUID → `not-found` -- unique fixture suffix, per-file rank band, re-runnable (rows undeletable).

**Acceptance Criteria:**
- Given an employee with N salary records all effective on or before today, when `getSalaryTimeline` is called with `asOf` = today, then all N rows are returned newest-first, `currentSalaryRecordId` is the newest row's id, and every `salary.amountMinor` is a decimal string carrying its `currency`.
- Given an `asOf` earlier than some records, when `getSalaryTimeline` is called, then rows with `effectiveFrom > asOf` are absent and `currentSalaryRecordId` is the newest remaining row's id, or `null` when none remain.
- Given the same records and `asOf`, when `orderSalaryTimeline` and `resolveCurrentSalary` are evaluated, then `orderSalaryTimeline(records, asOf)[0]?.id` equals `resolveCurrentSalary(records, asOf)?.id`.
- Given a random or malformed employee id, when `getSalaryTimeline` is called, then it returns `{kind:'not-found'}` without throwing; given the repository throws, then it returns `{kind:'unavailable'}`.
- Given the repository port after this story, when its type is inspected, then it exposes no method that updates or deletes a salary record and `findSalaryHistory` is read-only.
- Given `src/domain` and `src/application` are searched after this story, then they contain no `Date.now()`, `new Date()`, or timezone read.
- Given the story is complete, when the gates run, then lint, typecheck, import-boundary, coverage floor (`src/domain` 100%, `src/application` ≥ 90%), and domain mutation testing are green with zero surviving mutants, and `prisma migrate diff` reports no drift (no migration added).
- Given the story's commit history, when it is read, then each failing test appears in a commit before the code that satisfies it.

## Design Notes

`orderSalaryTimeline` is a DISPLAY ordering, not a second answer to "what is current." The current record is still and only `resolveCurrentSalary` (AD-8); the timeline's head merely agrees with it, and a domain test makes that agreement mechanical rather than aspirational. Both route through one extracted `compareSalaryOrder` so the tie-break can never fork.

The timeline is as-of-filtered (`effectiveFrom <= asOf`). This is what makes the head equal the resolver's pick (the epic's "must agree" requirement) and keeps the surface as-of-consistent with every other capability. Because future-dating is rejected on write, at the default `asOf` = today every record is visible — so "full salary history" holds at the default, and rewinding the as-of control only hides not-yet-effective records.

```ts
// shape only — the finalized payload 5-2 consumes
type SalaryTimelineRow = { id: string; effectiveFrom: PlainDate; salary: BoundaryMoney };
type SalaryTimelineView = {
  employeeId: string; asOf: PlainDate;
  records: readonly SalaryTimelineRow[];      // newest-first
  currentSalaryRecordId: string | null;       // === records[0]?.id
};
```

Money crosses as `BoundaryMoney` (decimal string) because Law 4 names a React prop a boundary and a `bigint` cannot survive RSC→client serialization; this is the first outbound `toBoundaryMoney` call site. Dates cross as `PlainDate` to match the sibling `EmployeeDetail` read on the same page. `seq` never leaves the domain — the current row is marked by `id`.

not-found vs empty is one nested `findUnique`: a `null` employee row is `not-found`; a present row yields its `salaryRecords` (possibly empty). No second query, and no `ORDER BY` in the adapter — the domain orders.

## Verification

**Commands:**
- `npm run lint` -- expected: clean, including the import-boundary zones.
- `npm run typecheck` -- expected: no errors (the widened port propagates to every fake repository).
- `npm run test` -- expected: all green, including the untouched CAP-1/CAP-2/CAP-3 suites.
- `npm run test:coverage` -- expected: `src/domain` 100%, `src/application` ≥ 90%.
- `npm run test:mutation` -- expected: zero surviving mutants over `src/domain` (the new ordering function included).
- `npm run test:integration` -- expected: green, and green again on an immediate second run (fixtures are undeletable).
- `npm run build` -- expected: succeeds.
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` -- expected: no drift (this story adds no migration).

## Spec Change Log

No `bad_spec` or `intent_gap` loopback occurred. The implementation followed the spec as written; the one review patch (below) was a code-level dead-select removal that required no spec amendment.

## Review Triage Log

### 2026-07-23 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 8
- addressed_findings:
  - `[low]` `[patch]` `findSalaryHistory`'s nested `findUnique` selected `id: true` on the employee row but never read it — dead weight that signalled an intent (return the canonical stored id) the code did not fulfil. Removed; `select: { salaryRecords: {…} }` alone still distinguishes not-found (`row === null`) from empty history (present row, `[]`). Typecheck, lint, unit (1137) and the salary-timeline integration suite (6) stayed green.
  - Rejected (noise or spec-contradicting): (1) "derive `currentSalaryRecordId` from `ordered[0]` instead of `resolveCurrentSalary`" — would remove the explicit use of the ONE AD-8 resolver, contradicting the intent-contract; the head-equals-resolver agreement is instead pinned by a domain test. (2) narrow the `try/catch` to the repository call — deviates from the established `getEmployee`/`listEmployees` house pattern and guards an unreachable case (domain/application functions are total, 100% mutation-tested). (3) `employeeId` echoed from the argument — only mismatches for an uppercase-hex UUID the app's own links never generate. (4) add a read-time mixed-currency guard — leans against AD-6 (currency = immutable country) and the spine's "never re-resolve/convert at read." (5) integration-test the `unavailable` arm — impractical against a live DB; unit-covered. (6) strengthen the single use-case head===current assertion — the domain agreement matrix already pins it across dates and ties. (7) soften the "by construction" prose — accurate enough (both share `compareSalaryOrder` and the same filter, and a test pins agreement). (8) validate `asOf` — not a defect; `comparePlainDate` stays monotonic and 5-2 clamps via `resolveAsOf`.

## Auto Run Result

Status: done

### Implemented change

The CAP-4 backend read. Story 4-1 had landed the append-only `salary_record` write path and the one AD-8 resolver (`resolveCurrentSalary`), but nothing could READ an employee's salary history — the port exposed only `appendSalaryRecord`, the resolver had no production consumer, and no finalized boundary payload existed. This story delivers the read end-to-end.

A pure domain function `orderSalaryTimeline(records, asOf)` filters to `effectiveFrom <= asOf` and sorts newest-first through the SAME `(effectiveFrom, seq)` comparison the resolver uses — extracted as one shared `compareSalaryOrder` so the tie-break can never fork. A read-only `findSalaryHistory` on the `EmployeeRepository` port + adapter reads the series via one nested `findUnique` (distinguishing "no such employee" from "empty history" with no second query and no `ORDER BY`). The `getSalaryTimeline` use-case orchestrates read → resolve current (the ONE resolver) → order → encode, returning the finalized AD-20 payload (`SalaryTimelineView`): money as `BoundaryMoney` decimal strings, dates as `PlainDate`, `seq` dropped, the current record marked by `id`. No UI — story 5-2 consumes this payload and derives percent-change and `(Hire)` at render.

### Files changed

**Added**
- `src/application/use-cases/salary-timeline.ts` -- `getSalaryTimeline` and the finalized payload types (`SalaryTimelineRow`, `SalaryTimelineView`, `GetSalaryTimelineResult`, `SalaryTimelineDeps`) story 5-2 consumes.
- `tests/application/salary-timeline.test.ts`, `tests/integration/salary-timeline.test.ts`.

**Extended**
- `src/domain/salary-timeline.ts` -- `orderSalaryTimeline`; extracted the shared `compareSalaryOrder` (both the resolver and the ordering route through it; resolver behaviour unchanged).
- `src/application/ports/employee-repository.ts` -- read-only `findSalaryHistory(employeeId): Promise<readonly SalaryRecordView[] | null>`.
- `src/adapters/db/employee-repository.ts` -- `findSalaryHistory` (nested `findUnique`, `isUuid` guard, `fromDbDate`, no `ORDER BY`); added to the factory.
- `src/app/employees/employee-deps.ts` -- forwarded `findSalaryHistory` in `lazyEmployeeRepository()`.
- `tests/domain/salary-timeline.test.ts` -- `orderSalaryTimeline` assertions incl. the head===resolver agreement invariant.
- `tests/application/employees.test.ts`, `tests/app/employees-actions.test.ts`, `tests/app/handle-salary-change.test.ts`, `tests/application/import-employees.test.ts`, `tests/application/record-salary-change.test.ts` -- a `findSalaryHistory` stub on each fake repository (type propagation; no existing assertion changed).
- `tests/integration/employees.test.ts`, `tests/integration/salary-records.test.ts` -- port-shape assertions updated to include the new read method (still assert no update/delete).

### Review findings

One review pass (Blind Hunter + Edge Case Hunter, in parallel). Both judged the diff essentially airtight — laws honoured (pure domain, one comparator, one resolver, no second `ORDER BY`, money as `BoundaryMoney`, `seq` dropped, all functions total), no happy-path correctness bug. **1 patched** (low — a dead `id: true` select). **0 deferred, 0 intent gaps, 0 bad-spec.** **8 rejected** — chiefly one whose suggested fix would have violated AD-8 (deriving "current" from the list head instead of the canonical resolver) and one house-pattern deviation. `review_loop_iteration` stayed at 0.

### Verification performed

Every gate run directly after the patch:

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run test` | 1137 passed, 32 files |
| `npm run test:coverage` | threshold gate passed (`src/domain` 100%, `src/application` ≥ 90%, global ≥ 90%) |
| `npm run test:mutation` | 0 survived (100.00) over `src/domain`; `salary-timeline.ts` 41 killed / 0 survived |
| `npm run test:integration` | salary-timeline 6 passed, green on an immediate second run; full suite 119 passed twice |
| `npm run build` | succeeds |
| `prisma migrate diff --exit-code` | no difference (no migration added) |

Verified by inspection: `src/domain` and `src/application` contain no `Date.now()`/`new Date()`/timezone read; the port exposes no update or delete over `salary_record`; no `bigint` crosses the boundary (money is a decimal string, `seq` is dropped). The commit history pairs each failing test with the code that satisfies it, red first.

Note: `test:mutation`, the coverage floor, and the mutation report cited above are the subagent's directly-run outputs; the code most likely to be wrong (`src/adapters/db/employee-repository.ts`) is outside both gates' scope by configuration and is proven by the integration suite, which was re-run here after the patch. `npm run build` requires temporarily repointing `turbopack.root` off the worktree (which has no local `node_modules`); it was confirmed to pass and the change reverted — no committed change, and this story touches no Next render surface.

### Residual risks

- **The adapter is outside the quality gates.** Mutation testing and the coverage floor stop at `src/domain`/`src/application`; `findSalaryHistory` is proven by the integration suite alone.
- **Mixed-currency histories are carried without a read-time guard** (a reviewer note, rejected here): the read trusts the AD-6 write invariant (currency = immutable country). A future write path or bad backfill that broke that invariant would render a mixed-currency timeline with no signal. Recorded here, not fixed, because a read-time guard contradicts the spine's "never re-resolve/convert at read."
- **The finalized payload is untried by a real consumer** until story 5-2 renders it; the contract (`SalaryTimelineView`) is fixed and should not be extended by the frontend (Law 7).
