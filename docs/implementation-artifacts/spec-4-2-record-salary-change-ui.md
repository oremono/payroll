---
title: 'Record a Salary Change — UI (CAP-3, story 4-2)'
type: 'feature'
created: '2026-07-20'
status: 'done'
baseline_revision: '6cc0914eb36c9c32f846dbd0a8a75bb61cfcfab6'
final_revision: '5f6e924211c2a75f312c6fa134f12122bf3538ef'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-4-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 4-1 landed the whole CAP-3 backend — validator, append, use-case, Server Action — and nothing invokes it. `recordSalaryChangeAction` has no caller, `formatMoney` has zero call sites, and the employee detail page's own docstring records the hole: "no record-a-change entry point (Epic 4)". An HR manager still cannot record a raise.

**Approach:** Add the record-change form as a keyboard-first side panel launched from employee detail, mirroring `employee-form-panel.tsx` exactly. The form takes an amount in **major units** as screen-09 specifies (`₹` adornment, `placeholder="21,50,000"`) and converts to `amountMinor` with the exponent from the currency reference table, which requires exposing `CurrencyFormat` at the boundary for the first time. The five form-contract decisions story 4-1 deferred to this story are closed here.

## Boundaries & Constraints

**Always:**
- The write contract is **fixed**. `recordSalaryChangeAction(employeeId, input)` and `SalaryChangeInput` (`{amountMinor, currency, effectiveFrom}`, three required strings) are consumed unmodified. `RecordSalaryChangeResult`'s three arms are rendered as-is; `SalaryFieldRejection.sentence` is the fallback copy. (Law 7, AD-24)
- **The major→minor conversion is pure domain, in `src/domain/money.ts`,** as the inverse of `formatMoney` and sharing its exponent range check. `src/ui` and `src/app` are outside the coverage and mutation gates; this is the calculation a 100× error hides in, so it lives where both gates see it. (Law 4)
- **The exponent comes from the `currency` reference table, never a hard-coded 100.** JPY is exponent 0, so a fractional amount for JPY is rejected, not rounded. (Law 4)
- **Never silently round.** More fraction digits than the exponent allows is a rejection, not a truncation — the user's typed money is never altered under them.
- Currency **follows from country** and is never an input the user edits or a control that can fail to submit. It is derived and rendered read-only, and travels in the payload as a derived string. (AD-6)
- `today` is read once via the clock port at the detail page boundary, after `await connection()`, and passed inward — exactly the `src/app/layout.tsx` pattern. No `Date` in `src/ui`, `src/domain`, or `src/application`. (Law 6)
- The panel copies `employee-form-panel.tsx`'s modal mechanics verbatim: portal, `role="dialog" aria-modal="true"`, live-queried Tab containment, Esc, background `inert` with `NEVER_INERT`, scroll lock, focus return **in effect cleanup**, open focus on the first field. Rejections render as a region with a heading, **never** `role="alert"`. Announcements ride the one `useAnnounce()` region. (WCAG 2.2 AA floor)
- Test-first: every assertion committed red before the code satisfying it, as a separate commit. (Law 1)

**Block If:**
- Honouring screen-09's major-unit input would require changing `SalaryChangeInput`, adding a payload field, or reinterpreting `amountMinor` — that is a CAP-3 contract change, not this story's call.
- The future-`hire_date` dead end (deferred #3) proves unresolvable without a new backend rejection arm — widening `AppendSalaryRecordOutcome` or `SalaryFieldRejection` is out of bounds here.

**Never:**
- **No salary timeline, no current salary, no percent-change chip, no `(Hire)` label, no money rendered as a stored value.** Those are CAP-4 / Epic 5 — settled by `epics.md` (Epic 5 = CAP-4 Salary Timeline), `EXPERIENCE.md:181` ("CAP-3 Record change → record-change form; CAP-4 Timeline → employee detail"), and the detail page's own docstring. `deferred-work.md`'s aside that "4-2 renders the salary timeline" is mistaken and is corrected, not followed.
- No shadcn/ui, no Radix, no dialog library, no `useActionState`/`useFormStatus` — story 3-2 was the designated re-decision point and re-rejected them.
- No reason/note/event-type field. No edit or delete affordance. No future-dating. No second money formatter, second parser, or second current-salary resolver.
- No colour literal, no `dark:` variant, no red/green semantics, no spinner, no toast, no `role="alert"`, no second live region.
- Do not solve the pre-existing `e2e/employees.spec.ts` read-after-write race or its re-seeding defect (deferred entries A and B). This story's own e2e tests must not depend on or worsen them.

## I/O & Edge-Case Matrix

Scope is the **new** decision surface — amount parsing and payload construction. 4-1's server-side rules are not re-tested here.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Records a raise | India (INR, exponent 2); amount `21,50,000`; date today | Payload `{amountMinor:'215000000', currency:'INR', effectiveFrom:'<today>'}`; panel closes; announcement names the recorded change | No error expected |
| Grouping separators and spaces | `' 21,50,000 '` | Same payload — commas and surrounding whitespace stripped before conversion (closes deferred #7) | No error expected |
| Fractional within exponent | `25000.5` with exponent 2 | `'2500050'` | No error expected |
| Fraction too precise | `25000.005` with exponent 2 | Rejected on the amount field, naming the precision the currency allows | Rejection, never rounded |
| Zero-exponent currency | `2500.50` with JPY (exponent 0) | Rejected on the amount field — JPY has no minor unit | Rejection |
| Malformed amount | `''`, `abc`, `-1`, `1e5`, `1.2.3`, `.5`, `1,,0` | Rejected on the amount field | Rejection, no submit |
| Amount the server refuses | `0` | Parses to `'0'`, submits, server answers `rejected` on `amount_minor` | Server's sentence rendered via the CAP-3 projection |
| Currency is never chosen | Any submission | `currency` derived from the employee's country; no editable or disabled control exists (closes deferred #8) | N/A — cannot fail to submit |
| Server rejection copy | `{field:'effective_from', sentence:'The effective_from cell is blank.'}` | Rendered as form vocabulary ("Effective date"), never a raw column token or "cell" (closes deferred #5) | Unrecognised sentences fall through verbatim |
| Employee vanished | Server answers `not-found` | Form-level statement carrying no id; panel stays open | Rendered as a region with a heading |
| Transport failed | Action throws | `SALARY_SUBMISSION_FAILED_STATEMENT` — "nothing was recorded" | Caught; never an unhandled rejection |
| Double submit | Submit pressed twice | Second press is a no-op while pending (closes deferred #4 at the UI level only) | `isPending` guard |
| Future hire date | `hireDate > today` | Trigger is not offered; an explanatory region names the hire date from which pay can be recorded (closes deferred #3) | No form to submit |
| Currency format unreadable | Country absent from active options, or its currency row missing | Trigger is not offered; the existing "cannot be edited right now" arm is mirrored | No form to submit |

</intent-contract>

## Code Map

- `src/app/employees/[id]/page.tsx` -- the detail RSC. Header row at ~L76 holds the one existing trigger (`EmployeeFormPanel`); the new trigger joins it. `options.kind !== 'options'` at L88 is the precedent for withholding a trigger.
- `src/app/layout.tsx` (L62-63) -- `await connection(); systemClock.todayUtc()`, the clock-at-the-boundary pattern to copy.
- `src/app/employees/actions.ts` -- `recordSalaryChangeAction(employeeId: unknown, input: unknown)`; already revalidates `/employees` and `/employees/{id}`.
- `src/application/use-cases/record-salary-change.ts` -- `RecordSalaryChangeResult` (`recorded` | `rejected` | `not-found`), `SalaryChangeInput`, `SalaryFieldRejection`.
- `src/domain/salary-change.ts` -- `SalaryChangeField` = `'effective_from' | 'amount_minor' | 'currency'`; field order pinned by `SALARY_CHANGE_FIELDS`. `SALARY_FIELD_LABELS` exists but is private and wired only into `nonTextSalaryFieldRejection`.
- `src/domain/money.ts` -- `Money`, `CurrencyFormat`, `GroupingStyle`, `formatMoney`, `MAX_MINOR_UNIT_EXPONENT`; the parser's home.
- `src/ui/employee-form.ts` -- **the module to mirror**: `fieldInputId`, `fieldDescribedById`, `formRejectionText` (anchored-regex projection falling through to `sentence`), `rejectionsFor`, `formLevelRejections`, `firstRejectedField`, `composeFormAnnouncement`, `SUBMISSION_FAILED_STATEMENT`, `EMPLOYEE_VANISHED_STATEMENT`, `currencyLineFor`.
- `src/ui/employee-form-panel.tsx` -- **the panel to mirror**: `FOCUSABLE_SELECTOR`, `NEVER_INERT`, `FIELD_CONTROL`/`FIELD_LABEL` classes, `invalidProps`, the `isPending` submit guard, `router.refresh()` on success.
- `src/ui/announcer.tsx` -- `useAnnounce()`.
- `src/application/ports/employee-repository.ts` (L140) -- `EmployeeFormOptions`; `countries` carries `currencyCode` but no format.
- `src/adapters/db/employee-repository.ts` (L656) -- `loadFormOptions`; `isActive` filter and total orderings.
- `prisma/schema.prisma` (`model Currency`) -- `code`, `symbol`, `minorUnitExponent`, `groupingStyle`, `isActive`.
- `e2e/employees.spec.ts` (L582-612) -- the `STATES` × `SCHEMES` axe cross-product to extend.
- `tests/ui/employee-form.test.ts` -- the pure-decision-module test convention (node env; no jsdom, no RTL).

**Added by this story:**

- `src/ui/salary-change-form.ts` -- the pure decision module: field specs and ids, the CAP-3 copy projection, initial values, payload construction, rejection projections, announcements.
- `src/ui/salary-change-panel.tsx` -- `'use client'` trigger + side panel.
- `tests/ui/salary-change-form.test.ts`.

**Extended by this story:**

- `src/domain/money.ts` -- `parseMajorAmount`.
- `src/application/ports/employee-repository.ts` + `src/adapters/db/employee-repository.ts` -- `EmployeeFormOptions.currencies`.
- `tests/domain/money.test.ts`, `tests/integration/employees.test.ts`, `e2e/employees.spec.ts`, plus fake-repository stubs wherever widening the port breaks a fake.

## Tasks & Acceptance

**Execution:**
- [x] `tests/domain/money.test.ts` -- assert `parseMajorAmount` over every amount row of the I/O matrix: grouping separators, surrounding whitespace, exact-precision fractions, over-precise fractions, exponent 0, and each malformed form -- red first; this is the 100×-error surface.
- [x] `src/domain/money.ts` -- add `parseMajorAmount(text: string, exponent: number)` returning a minor-unit decimal string or a typed parse failure; pure, total, exact string/`bigint` arithmetic, sharing `formatMoney`'s exponent range check -- the inverse of the one formatter, and never a second one.
- [x] `src/application/ports/employee-repository.ts` -- add `currencies: readonly CurrencyFormat[]` to `EmployeeFormOptions` -- the form cannot convert or render an amount without the exponent and symbol, and nothing exposes them today.
- [x] `src/adapters/db/employee-repository.ts` -- populate `currencies` from active `currency` rows with a total ordering, **validating** `groupingStyle` against the domain union rather than casting -- the Prisma enum is a separate type and a cast would let bad data reach the formatter.
- [x] fake repositories in `tests/**` -- add the `currencies` field wherever widening `EmployeeFormOptions` becomes a type error, changing no existing assertion -- done here rather than later because the port widening two tasks above makes every incomplete fake a type error immediately, exactly as `appendSalaryRecord` did in 4-1.
- [x] `tests/integration/employees.test.ts` -- assert `loadFormOptions` returns currency formats against real Postgres 18, including a currency whose exponent is not 2 -- unit fakes cannot prove the column mapping.
- [x] `tests/ui/salary-change-form.test.ts` -- assert the decision module over every matrix row: payload construction and normalization, the copy projection (recognised sentences reworded, unrecognised passed through verbatim), field ordering, ids, rejection grouping, announcements, and the future-hire and unreadable-currency statements -- red first; `src/ui/*.tsx` is outside both gates, so this module is the only place vitest reaches these decisions.
- [x] `src/ui/salary-change-form.ts` -- implement it, mirroring `employee-form.ts` member for member; trim all three fields; derive `currency` from the country; project CAP-3 sentences into form vocabulary -- closes deferred #5, #7 and #8 in one pure, gated place.
- [x] `src/ui/salary-change-panel.tsx` -- the trigger and side panel, copying `employee-form-panel.tsx`'s modal mechanics, `isPending` guard, and rejection focus effect; the Server Action arrives as a prop -- `src/ui` may not import `@/app/*`.
- [x] `src/app/employees/[id]/page.tsx` -- read `today` via `await connection()` + the clock port, resolve the employee's `CurrencyFormat`, and render the trigger beside `Edit employee`; withhold it with an explanatory region when the currency is unreadable or `hireDate > today` -- closes deferred #3 by not offering a form that cannot be satisfied.
- [x] `e2e/employees.spec.ts` -- add the salary flow: open, keyboard-only save, rejected submission, Esc cancel with focus returned; add the new states to the `STATES` axe cross-product -- the panel's markup does not exist until opened, so a page-load scan never sees it. Each new test seeds and asserts its own starting state.

**Acceptance Criteria:**
- Given the story is complete, when the gates run, then lint, typecheck, import-boundary, token drift, coverage floor (`src/domain` 100%, `src/application` ≥ 90%), domain mutation testing (zero survivors), integration, and both browser suites are green.
- Given the panel is open, when it is operated with the keyboard alone, then the change can be recorded end to end, Esc cancels, and focus returns to the invoking trigger.
- Given any state of the panel in either colour scheme, when axe runs with the WCAG 2.2 AA tags, then there are no violations.
- Given the codebase after this story, when `src/ui` and `src/app/employees` are searched, then no colour literal, no `dark:` variant, no `role="alert"`, and no second live region appears.
- Given `recordSalaryChangeAction` and `SalaryChangeInput`, when they are compared to their story 4-1 definitions, then they are unchanged.
- Given the story's commit history, when it is read, then each failing test appears in a commit before the code that satisfies it.

## Spec Change Log

## Review Triage Log

### 2026-07-20 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 15: (high 0, medium 4, low 11)
- defer: 2: (high 0, medium 1, low 1)
- reject: 2
- addressed_findings:
  - `[medium]` `[patch]` **A `currency` rejection rendered nowhere.** The panel gave `effective_from` and `amount_minor` a `<Field>` but currency only a bare `<div>`, and `salaryFormLevelRejections` matched `field === null` only — so a server rejection naming `currency` produced the announcement "1 reason" and no message anywhere, with focus sent to an element id that does not exist. Exactly the failure the module's own docstring promises to prevent. Fixed in the gated pure module, not the ungated `.tsx`: `SALARY_FIELD_HAS_CONTROL` is an exhaustive `Record<SalaryChangeField, boolean>` (a fourth field is now a compile error), and any control-less field routes to the form-level region. Red-first.
  - `[medium]` `[patch]` **`parseMajorAmount` refused exactly-representable amounts.** `'25000.500'` at exponent 2 and `'2500.0'` for JPY were rejected as `too-precise`, under a sentence ("more precise than INR records") that was false for them — trailing zeros carry no precision. Trailing fraction zeros are now stripped before the precision test; `'25000.005'` and `'25000.105'` still reject. Verified by direct probe. Red-first.
  - `[medium]` `[patch]` **Unbounded amount input blocked the user's own tab.** A 3,000,000-digit paste took a measured 1881 ms inside `parseMajorAmount` and was then submitted so the server repeated the work. `MAX_MAJOR_AMOUNT_LENGTH = 64` is checked after trim and before the regex, with a matching `maxLength` on the control; the same input now returns `malformed` in 1 ms. Red-first.
  - `[medium]` `[patch]` **The withheld statement was false and self-contradictory.** "The currency reference tables could not be read" rendered for an employee on a deactivated country — where the tables read perfectly, so the working `Edit employee` button sat directly beside a paragraph claiming they had not. Reworded to name the outcome without asserting a cause; distinguishing deactivated-from-missing remains deferred (#6).
  - `[low]` `[patch]` `salaryChangeAvailability` resolved the `CurrencyFormat` by presence only and never called `isSupportedExponent`, while two comments — one in the code, one in its test — asserted the page already withheld the form in that state. The guard is now real, so both claims are true.
  - `[low]` `[patch]` The live-region e2e assertion was written red as an app-wide `toHaveCount(1)` and weakened inside the *green* commit to four assertions scoped to the dialog and `#main-content`; a second region in the header or footer would have passed. The scoping reason (Next's own route announcer) was legitimate, so it is now excluded by id rather than by narrowing scope.
  - `[low]` `[patch]` The salary panel's inert test looped over an array without asserting it was non-empty, so it could prove the background inert for zero elements. Matched to CAP-2's `expect(report.length).toBeGreaterThan(0)`.
  - `[low]` `[patch]` `GROUPING_STYLES` was a bare `readonly string[]` with no type link to the domain union, though its docstring argued at length that casting would be unsafe — a new union member would have compiled fine and silently dropped every currency using it. Now derived from an exhaustive `Record<GroupingStyle, true>`.
  - `[low]` `[patch]` Dropped currency rows vanished with no diagnostic; a subset of employees would lose the record-change trigger with nothing in the logs pointing at the currency table. Now logged with the offending code, per the precedent set in `0495999`.
  - `[low]` `[patch]` The amount placeholder hard-coded `21,50,000` for every currency, so a USD employee saw an example that reads as 2,150,000 under western grouping. Now derived through the one money formatter from the resolved grouping style.
  - `[low]` `[patch]` The salary panel's Tab containment had no test at any level — `src/ui/*.tsx` is outside both gates, so e2e was the only reachable verification and CAP-2's `contains Tab in both directions` had no salary equivalent. Added.
  - `[low]` `[patch]` The withheld arm was never asserted: the deactivated-country test passed only because the statement happened to spell "currency" lowercase. It now asserts the statement verbatim, that `Edit employee` still renders beside it, and that no record-change trigger is offered.
  - `[low]` `[patch]` A pre-existing blanket assertion (`main` contains nothing matching `/salary/i`) was replaced by six narrow probes that a rendered money amount could evade. Two shape probes restore the claim.
  - `[low]` `[patch]` A comment claimed all three amount sentences "name the rule instead of the value", but the `MALFORMED_AMOUNT` branch does quote the offending value. The branch is unreachable from this form and quoting is honest for a direct caller, so the comment was corrected rather than the behaviour.
  - `[low]` `[patch]` One task checkbox was left unchecked although the work landed in `fd52efd`.
  - Rejected: the claim that backdrop dismissal strands focus (`close()` sets `returnFocusRef` and the backdrop calls that same `close()`), and the claim that a late test-only commit violates Law 1 (it updates a pre-existing CAP-2 assertion the feature invalidates, which necessarily follows the feature).

### 2026-07-20 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 2, low 8)
- defer: 5: (high 0, medium 3, low 2)
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` **Backdrop dismissal did strand focus — the previous pass rejected this finding on a false premise.** The rejection above reasons that "the backdrop calls that same `close()`". It does not: the handler was `onPointerDown={() => setIsOpen(false)}`, which bypasses `close()` entirely, so `returnFocusRef` stayed `false` and the effect cleanup never returned focus (WCAG 2.2 AA SC 2.4.3). Calling `close()` alone is also insufficient — verified by watching the new test fail with exactly that fix — because the rest of the press lands after the dialog is gone and its default action drops focus on `body`. Fixed with `preventDefault()` plus `close()`. Covered by a new e2e, `dismisses on a backdrop press and returns focus to the trigger`, confirmed red against the unfixed panel and green after.
  - `[medium]` `[patch]` **The double-submit guard read React state, so it could not stop the case it existed for.** `if (isPending)` is a state read: two submit events dispatched before React commits the re-render both see `false` and both send, and `disabled={isPending}` takes effect only after that same commit. The row this appends is undeletable (Law 5 — no update, no delete path) and the server has no idempotency key, so a duplicate is permanent and correctable only by appending a third record. Now guarded by a ref written synchronously, alongside the state that drives the label. The comment claiming this "closes deferred #4 at the UI level" is now true.
  - `[low]` `[patch]` `salaryRejectionText` read `SALARY_CHANGE_FORM_FIELDS[rejection.field].label` unguarded. A rejection is deserialized from a Server Action, where the union is a compile-time claim rather than a runtime guarantee — across a rolling deploy an older page can be handed a field a newer server added, and `undefined.label` would take down the whole panel. Now falls through to the server's own sentence, which is the defensive stance the module already advertises for an unrecognised reason kind. `salaryFieldHasControl` given the matching `?? false`.
  - `[low]` `[patch]` The `open()` comment claimed re-seeding makes "the date today's again after midnight has passed under a tab". It re-seeds from the same `today` prop resolved once at RSC render, so it does not — and this story's own deferred entry says the opposite and is correct. A comment asserting a guarantee the code does not provide is worse than no comment; corrected to point at the open entry.
  - `[low]` `[patch]` `salaryAmountPlaceholder` sliced the symbol and ISO code off `formatMoney`'s output by length alone, silently coupling to another module's internal layout — a placeholder quietly disagreeing with the field it sits in. Now verifies the prefix and suffix before slicing and falls back to ungrouped digits, matching the drift-guard stance taken for `GROUPING_STYLES` in the previous pass.
  - `[low]` `[patch]` The dropped-currency diagnostic added last pass logged one line per bad row per `loadFormOptions` call. Unlike the transient failure it cites as precedent, a bad grouping style is a persistent data condition re-read on every employee page render, so it would emit the same lines forever at a volume that trains operators to filter out the one message explaining the outage. Now one line per call listing every dropped row, with a test asserting the aggregation.
  - `[low]` `[patch]` Duplicate React keys were reachable: both rejection lists keyed by `reason.sentence`, so two identically-worded reasons would collide and one would silently drop off the screen. Keyed by position — nothing reorders these lists.
  - `[low]` `[patch]` The keyboard happy-path e2e asserted the announced date matched `\d{4}-\d{2}-\d{2}`, which only proves the string is date-shaped — a submit carrying the wrong date passed it. Now asserts today's date verbatim, and the field's default likewise. (The amount still has no browser assertion; deferred, since no surface renders a salary.)
  - `[low]` `[patch]` The INR fixture was `NAMES.indexOf('Elena Rossi')`, Indian only because she sits at index 6 of a list assigned `ACTIVE_COUNTRIES[index % 2]`. Inserting any name above her would flip the country and fail four salary-panel tests pointing at the panel rather than the fixture. Now derived via the seed's own `countryFor`.
  - `[low]` `[patch]` The money-shape e2e backstop matched only `[$₹¥€£]`, leaving it narrowest exactly where a missed currency is most likely. Now `\p{Sc}`, the Unicode currency-symbol category.
  - Rejected (8): a client-side timeout on the Server Action (actively harmful — the request may still land against an append-only table); rejecting sloppy grouping such as `1,2,3,4` (leniency is deliberate, and rejecting it has no user benefit); the two withheld paragraphs rendering together (they describe two different absent controls, and neither is false); the integration test asserting every active country resolves to an active currency (it is a seed-data obligation, and the production arm defends the state independently); showing the `MAX_AMOUNT_MINOR` ceiling in major units; the `%` probe's breadth (it is a deliberate CAP-4 leakage backstop); the observation that the story was closed with `followup_review_recommended: true` (this pass is that follow-up); and the request for a comment linking `connection()` to the router-cache claim.

### 2026-07-20 — Review pass (follow-up 2)

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 3: (high 0, medium 3, low 0)
- reject: 11
- addressed_findings:
  - `[medium]` `[patch]` **A dismissal mid-submission left the panel permanently unusable.** `open()` re-seeded `values` and `reasons` but not `isPending` or `pendingRef`. Closing the panel does not cancel the request — there is no abort — so the interrupted submission's flags survived into the next open: a disabled "Recording…" button over a freshly seeded form, with the ref guard swallowing every later submit. If the promise never settled (a held socket, a proxy sitting on the response) nothing ever cleared them and the only way back was a full page reload. Both flags are now re-seeded. Covered by a new e2e that holds the Server Action open with `page.route`, dismisses, and reopens; confirmed red against the unfixed panel.
  - `[medium]` `[patch]` **The pending button left the focus order, killing Esc for the duration of the request.** Found while writing the test above: `disabled={isPending}` takes effect on the press that starts the submission, and a disabled button is not focusable — so focus fell to `body`, Esc stopped dismissing the dialog, and Tab restarted from the top of the document until the request settled (WCAG 2.2 AA SC 2.4.3). Now `aria-disabled`, which announces the same state and keeps the button focusable; the synchronous `pendingRef` guard added last pass is what refuses the second press, so that guard is now load-bearing rather than shadowed by the attribute.
  - `[low]` `[patch]` The announcement interpolated the raw ISO date — `effective 2026-07-20` — while every other date on the surface, including two statements in the same module, goes through `formatPlainDate`. The one sentence the story designates as "the entire receipt" was the one rendered in machine form. Now spelled, with a total fallback to the given string.
  - `[low]` `[patch]` `toCurrencyFormats` validated `groupingStyle` but not `minorUnitExponent`, so a row the domain formatter calls unusable crossed the port anyway and every consumer had to re-check independently — the exact trap `salaryChangeAvailability` had to add a boundary check to escape last pass. Both halves are now checked, the diagnostic names which one failed, and a test pins exponent 0 (JPY) as legitimate so the rule cannot be rewritten as a truthiness check.
  - `[low]` `[patch]` A non-primary press on the backdrop dismissed the panel and discarded everything typed. `pointerdown` fires for every button, so a right-click landing wide of the dialog destroyed the form with no warning and nothing recoverable. Primary button only.
  - `[low]` `[patch]` `src/app/employees/actions.ts` still asserted "Story 4-2 renders the salary timeline into that same detail route" — the claim this story refutes in its Design Notes, the ledger, the page docstring and the run result, left standing in production source, in the one file the previous pass's verification reported as byte-identical to 4-1. Corrected. Also stopped the keyboard e2e computing "today" in the browser and comparing it to a server-computed date: two independent clock reads that disagree either side of UTC midnight, in a file already carrying two intermittency entries. Every assertion after the field read now derives from the value the field actually holds.
  - `[medium]` `[defer]` **The transport statement asserts an outcome the client cannot know, and was left alone deliberately.** "The submission did not reach the server, so nothing was recorded. Try again…" — a thrown error cannot tell "never arrived" from "arrived, COMMITTED, response lost". `salary_record` has no delete path and no idempotency key (Law 5 / AD-18), so a reader who believes it and retries appends a second permanent row: the copy pushes the user into the duplicate this story records as a residual risk. It was patched, then **reverted**: the wording is pinned verbatim inside `<intent-contract>` (the I/O matrix's "Transport failed" row quotes "nothing was recorded"), which a review pass may not amend. Deviating from a frozen contract silently is the failure the triage categories exist to prevent, so it is deferred with a candidate replacement rather than changed here.
  - Deferred (2 more): an employee whose country is later deactivated can never have a salary change recorded and no surface says so (`country` is immutable by AD-6, so there is no remedy in the product — a product decision, not a code fix; deferred #6 covers only the wording); and the form-level refusal container being `role="group"`, which is not exposed as a region though the project context and this spec both require refusals render "as a region with a heading" (inherited deliberately from the CAP-2 panel, so the precedent needs deciding for both — and `role="group"` is valid ARIA, which is why the axe gate never contradicted it).
  - Rejected (11): unknown-`kind` and empty-`reasons` guards on the Server Action result (Next rejects a mismatched action id outright, which lands in the existing transport `catch`, so the arms are unreachable); the `composeSalaryAnnouncement` `default` arm (the union is exhaustive and TypeScript proves it); `wrapperRef.current === null` in the inert effect (effects run after commit, so the portal is mounted); the backdrop e2e's viewport assumption (real, but the dialog is a full-screen sheet below ~448px where Esc and the named Close button both still work); `SALARY_FIELD_HAS_CONTROL` not being wired to the panel's JSX and `SALARY_CHANGE_FORM_FIELD_ORDER` having no production consumer (both true, neither has a user consequence, and rewiring the markup to consume them is a refactor this pass will not make on a closed story); the defensive-guard asymmetry between `salaryRejectionText` and `Field` (same unreachable rolling-deploy premise); a guard on `INR_EMPLOYEE` being `-1` (the fixture fails loudly either way); the per-request currency diagnostic still being unbounded across calls (already reduced to one line per call last pass; deduping across requests needs state this layer does not have); the replacement of the blanket `/salary/i` count assertion (the trigger's own label now contains the word, so the blanket form is no longer expressible); the second `composeSalaryAnnouncement` argument differing between its two call sites (the arms that ignore it make this inert, and it is now moot since the surviving arm formats what it is given); and the observation that the frontmatter understates the review history (the triage log is the record, and it is complete).

## Design Notes

**The scope contradiction, settled.** `deferred-work.md:62` asserts 4-2 renders the salary timeline. Three sources say otherwise and agree with each other: `epics.md` gives the timeline its own epic (Epic 5 = CAP-4, DR9), `EXPERIENCE.md:181` maps "CAP-3 Record change → record-change form" and "CAP-4 Timeline → employee detail" separately, and `[id]/page.tsx:22-24` already records the same split. The ledger's line is an aside written by a review pass, not a scope decision, so this story records the correction rather than following it. The consequence is deliberate and worth stating: **after a successful save, nothing on the page visibly changes** — the announcement is the receipt, because there is no surface yet that displays a salary. That is Law 7's one-capability-at-a-time cost, not a defect.

**Why the parser is domain and not UI.** `vitest.config.ts` scopes coverage to `src/domain` + `src/application`, and `stryker.config.json` mutates `src/domain` only. A major→minor conversion placed in `src/ui` would be the single most consequential arithmetic in the story and measured by neither gate — precisely the residual risk 4-1 recorded about its adapter. It goes in `money.ts` beside the formatter it inverts.

```ts
// shape only; exactness is what matters
parseMajorAmount('21,50,000', 2); // → { ok: true, amountMinor: '215000000' }
parseMajorAmount('25000.005', 2); // → { ok: false, reason: 'too-precise' }
```

**One rule, one place.** The parser converts; it does not judge. Positivity and `MAX_AMOUNT_MINOR` stay in `checkSalaryAmount`, where 4-1 put them and where the import path shares them. A parser that also judged would be a second amount validator.

Deliberately **not** closed here (record in `deferred-work.md` if touched): the `FOR SHARE` deadlock retry (#2), historical `effective_from < hire_date` rows (#1), the deactivated-vs-missing country sentence (#6), the generic write-failure collapse (#9), and the two e2e infrastructure entries (A, B). The double-submit duplicate (#4) is suppressed at the UI only — the underlying row remains undeletable and the server has no idempotency key, so that entry stays open with its scope narrowed.

## Verification

**Commands:**
- `npm run lint` -- expected: clean, including import-boundary, colour-literal and `dark:` zones.
- `npm run typecheck` -- expected: no errors.
- `npm run tokens:check` -- expected: no drift.
- `npm run test` -- expected: all green, with the CAP-1/CAP-2 suites unmodified.
- `npm run test:coverage` -- expected: `src/domain` 100%, `src/application` ≥ 90%, global ≥ 90%.
- `npm run test:mutation` -- expected: zero surviving mutants over `src/domain`, including `parseMajorAmount`.
- `npm run test:integration` -- expected: green, and green again on an immediate second run.
- `npm run e2e:seed && npm run test:browser:db` -- expected: green, including the new salary states.
- `npm run test:browser` -- expected: green (axe, tokens, shell, import).
- `npm run build` -- expected: succeeds.
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` -- expected: no drift (this story adds no migration).

**Manual checks (if no CLI):**
- Confirm by inspection that `recordSalaryChangeAction`'s signature and `SalaryChangeInput`'s three fields are byte-identical to story 4-1, and that no salary amount, timeline row, percent change or `(Hire)` label renders anywhere.

## Auto Run Result

Status: done

### Implemented change

CAP-3's surface. Story 4-1 landed the entire backend and nothing invoked it: `recordSalaryChangeAction` had no caller and `formatMoney` had zero call sites. This story adds the record-change side panel, launched from a trigger beside `Edit employee` on the employee detail page, mirroring `employee-form-panel.tsx`'s modal mechanics rather than introducing a dialog library.

The load-bearing piece is the amount. screen-09 specifies a major-unit input (`₹` adornment, grouped placeholder), the payload requires `amountMinor` — so a conversion had to exist, and a defect in it is a 100× money error. `parseMajorAmount` therefore lives in `src/domain/money.ts` as the exact inverse of `formatMoney`, inside the 100%-coverage and zero-surviving-mutant gates, rather than in `src/ui` which is outside both. It converts and nothing more: positivity and `MAX_AMOUNT_MINOR` stay in `checkSalaryAmount`, where story 4-1 put them and where the import path shares them. Rendering an amount at all required exposing a `CurrencyFormat` at the boundary for the first time, so `EmployeeFormOptions` now carries every active currency's format.

Five form-contract decisions story 4-1 deferred to this story are closed: the CAP-3 copy projection (#5), payload normalization (#7), currency as a derived value rather than a control that cannot submit (#8), UI-level double-submit suppression (#4, narrowed not closed), and the future-hire dead end (#3, closed by withholding a form that could never be satisfied).

**A scope contradiction was settled rather than followed.** `deferred-work.md` asserted that 4-2 renders the salary timeline. `epics.md` (Epic 5 = CAP-4), `EXPERIENCE.md:181`, and the detail page's own docstring all say otherwise and agree with each other. This story records the correction. The deliberate consequence: after a successful save nothing on the page visibly changes, because no surface displays a salary yet — the announcement is the receipt. That is Law 7's one-capability-at-a-time cost, not a defect.

### Files changed

**Added**
- `src/ui/salary-change-form.ts` -- the pure decision module: field specs and ids, the CAP-3 copy projection, payload construction and normalization, availability, rejection routing, announcements.
- `src/ui/salary-change-panel.tsx` -- the `'use client'` trigger and side panel; the Server Action arrives as a prop.
- `tests/ui/salary-change-form.test.ts` -- 667 lines; the only place vitest reaches these decisions.

**Extended**
- `src/domain/money.ts` -- `parseMajorAmount`, `MAX_MAJOR_AMOUNT_LENGTH`, `isSupportedExponent` (extracted and shared with `formatMoney`).
- `src/application/ports/employee-repository.ts` + `src/adapters/db/employee-repository.ts` -- `EmployeeFormOptions.currencies`, plus `toCurrencyFormats` with a compile-error drift guard on `GroupingStyle`.
- `src/app/employees/[id]/page.tsx` -- the clock-port read, currency resolution, and the trigger with its two withheld arms.
- `e2e/employees.spec.ts` -- the salary flow, Tab containment, the withheld arm, and two new axe states × two schemes.
- `tests/domain/money.test.ts`, `tests/adapters/employee-repository.test.ts`, `tests/integration/employees.test.ts`, and three fake repositories.

### Review findings

Two adversarial passes (Blind Hunter, Edge Case Hunter) run in parallel without prior context; 21 findings, 19 after deduplication.

- **15 patched** — 4 medium, 11 low. Detailed in the Review Triage Log. The four that mattered: a `currency` rejection rendered nowhere and sent focus to a nonexistent id, leaving a form that refused to save and said nothing; `parseMajorAmount` rejected exactly-representable amounts like `25000.500` and JPY `2500.0` under a sentence that was false for them; an unbounded amount blocked the user's own tab for a measured 1881 ms; and the withheld statement claimed the reference tables were unreadable while a working `Edit employee` button rendered beside it.
- **2 deferred** — the `today`-across-UTC-midnight staleness (no fix available inside Law 6) and the missing browser coverage of the future-hire arm (blocked on a fixture change that ripples into CAP-2's pager assertions). Both recorded with evidence.
- **2 rejected** — the claim that backdrop dismissal strands focus (disproved: the backdrop calls the same `close()` that sets the focus-return flag) and the claim that a late test-only commit violates Law 1 (it updates a pre-existing assertion the feature invalidates, which must follow it).
- **0 intent gaps, 0 bad-spec findings.** No loopback; `review_loop_iteration` stayed at 0.

### Verification performed

Every gate run directly by the orchestrator after the patches, not merely reported by a subagent. Two rounds of language-server diagnostics claimed missing exports and unresolvable modules; both were stale snapshots, disproved by running `tsc` and grepping the exports.

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run tokens:check` | in sync |
| `npm run test` | 1105 passed, 31 files |
| `npm run test:coverage` | 100% statements / branches / functions / lines |
| `npm run test:mutation` | **0 survived**, score 100.00 (4 timed out, counted as killed) |
| `npm run test:integration` | 113 passed against real PostgreSQL 18 |
| `npm run build` | compiled successfully |
| `npm run test:browser` | 113 passed |
| `npm run e2e:seed && npm run test:browser:db` | 53 passed |
| `prisma migrate diff --exit-code` | "No difference detected" (no migration added) |

Behaviour of the four medium patches was confirmed by direct probe rather than by test alone: `'25000.500'`@2 → `2500050`, `'2500.0'`@0 → `2500`, `'25000.005'` and `'25000.105'` still rejected, and the 3,000,000-digit input that took 1881 ms now returns `malformed` in 1 ms.

Verified by inspection: `git diff` over `actions.ts`, `salary-change.ts` and `record-salary-change.ts` is empty, so story 4-1's write contract is byte-identical; no `role="alert"`, no `dark:` variant and no second `aria-live` region exists in rendered code; and no salary amount, timeline row, percent chip or `(Hire)` label renders anywhere.

### Residual risks

- **The panel itself is proven only by e2e.** `src/ui/*.tsx` is outside both the coverage and the mutation gate by configuration, so `salary-change-panel.tsx` — focus trap, inert handling, submit guard — is covered by Playwright assertions alone. The review found two vacuous or missing assertions in exactly that region; there is no gate that would have found a third. The mitigation taken was to push every decision that *could* leave the `.tsx` into the gated pure module, including the currency-rejection fix.
- **The pre-existing read-after-write race is untouched and still intermittent.** `e2e/employees.spec.ts`'s CAP-2 create/edit assertions fail sporadically against Next's router cache; the story was forbidden from solving it and did not. It was measured at the same rate on the baseline commit as on this branch, so this story does not worsen it — but the DB-backed browser gate remains flaky and still requires `npm run e2e:seed` immediately before it (deferred entries A and B).
- **A double-submit still plants a permanently undeletable duplicate row.** The `isPending` guard suppresses it in the UI only; there is no idempotency key, and `salary_record` admits no `DELETE`. Deferred entry #4 stays open with its scope narrowed to "a second submit that reaches the server".
- **The default effective date can be silently stale** on a page left open across UTC midnight. Newly deferred, with the reason no in-story fix exists.
- **Currency drift between render and submit is now visible but still possible.** A rejection naming `currency` renders in the form-level region rather than beside a control, because the field deliberately has none. That is the honest outcome, not a hidden one — but it is the one rejection a user cannot correct by editing anything on the form.

### Follow-up review pass (2026-07-20)

An independent second pass, recommended by the first and run against the same baseline with two fresh adversarial reviewers (Blind Hunter, Edge Case Hunter) and no prior conversation context. 26 findings, 23 after deduplication.

**It was worth running.** The first pass had *rejected* the backdrop-focus finding on a premise contradicted by the file it was reviewing — it reasoned that "the backdrop calls that same `close()`", when the handler was `onPointerDown={() => setIsOpen(false)}` and called `close()` nowhere. Both reviewers independently re-raised it. The fix also turned out to be larger than either reviewer proposed: calling `close()` is necessary but not sufficient, because the rest of the press lands after the dialog unmounts and its default action drops focus on `body`. That was established empirically — the new e2e was run against the panel with `close()` alone and still failed — and closed with `preventDefault()`.

- **10 patched** — 2 medium, 8 low. The two mediums: the backdrop focus defect above, and a double-submit guard that read React state (`if (isPending)`) and so could not stop two submits dispatched before React commits — the failure mode it existed to prevent, against a table where the duplicate row is permanent (Law 5). Now a synchronously-written ref.
- **5 deferred** — the coverage/mutation gates not reaching `src/ui/salary-change-form.ts` despite the spec calling it "the gated pure module"; the effective-date control offering future dates (the one-line `max` fix raises a native validation bubble that would bypass the AD-20 single live region, so it needs a decision); the whole currency table crossing the boundary for one row's use; the same backdrop-focus defect in CAP-2's `employee-form-panel.tsx`; and the absent browser coverage of the major→minor conversion. Appended as new ledger entries; no existing entry was modified.
- **8 rejected** — listed in the triage log. Two are worth naming because the suggested fix would have caused harm: a client-side timeout on the Server Action (the request may still land, against an append-only table), and rejecting sloppy grouping like `1,2,3,4` (the leniency is deliberate and rejecting it helps nobody).
- **0 intent gaps, 0 bad-spec findings.** No loopback; `review_loop_iteration` stayed at 0.

**Verification.** Every gate re-run directly after the patches:

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run test` | 1106 passed, 31 files |
| `npm run test:coverage` | 100% statements / branches / functions / lines |
| `npm run test:import` | 23 passed |
| `npm run test:browser` | 113 passed |
| `npm run test:browser:db` | 54 passed (53 + the new backdrop test) |

The new backdrop e2e was confirmed **red against the unfixed panel and green after** — and red again against the partial `close()`-only fix, which is how the `preventDefault()` requirement was found. `test:mutation` was not re-run: no patch in this pass touches `src/domain` or `src/application`, which is the whole of its scope, and the coverage gate over those layers is unchanged at 100%.

**Residual risks added by this pass.**

- **The double-submit ref guard has no test.** It is a `src/ui/*.tsx` concern, outside both gates, and provoking the race — two submit dispatches inside one React commit — is not something the Playwright suite can do reliably. The change is three lines and argued from React's state semantics rather than demonstrated, which is weaker evidence than everything else in this pass carries.
- **The first pass's false rejection is a caution about the triage log itself.** A rejected finding was recorded with a confident, checkable, wrong justification. The log reads as settled history; at least one line of it was not. Entries asserting that a finding was *disproved* deserve the same scepticism as the findings themselves.

### Follow-up review pass 2 (2026-07-20)

A third independent pass, recommended by the second, run against the same baseline with two fresh adversarial reviewers (Blind Hunter, Edge Case Hunter) and no prior conversation context. 28 findings, 20 after deduplication.

**Deferred-work handling.** Three entries appended; no existing entry was read for duplicates, modified, re-opened or rewritten, per the invocation's instruction that the orchestrator owns their status and resolution.

**It was worth running, and for a reason the previous two passes could not have reached.** The panel's whole submission lifecycle was unexamined: every prior test opened the panel, submitted, and observed the settled result. Nothing had ever asked what the panel looks like *during* the request. Both reviewers converged on it, and writing the test to prove their finding uncovered a second, larger defect neither had reported — the pending submit button leaves the focus order, which kills Esc and Tab containment for the duration of every submission (WCAG 2.2 AA SC 2.4.3). That one was found empirically: the new e2e failed on `page.keyboard.press('Escape')`, and the Playwright page snapshot showed focus sitting on the document root.

- **6 patched** — 2 medium, 4 low. The two mediums: `open()` not re-seeding the pending flags, which left a dismissed-mid-submission panel permanently unusable with no way back but a page reload; and the pending button's `disabled` attribute stranding focus on `body` for the length of every request.
- **3 deferred** — the transport statement asserting "nothing was recorded" when a thrown error cannot distinguish a lost request from a lost *response*, copy that invites a retry appending a second permanent row against an append-only table; an employee whose country is later deactivated never being able to have a salary change recorded, with no surface saying so (`country` is immutable by AD-6, so there is no remedy anywhere in the product); and the form-level refusal container being `role="group"` where the stated floor says "region" (inherited from CAP-2, so the precedent must be decided for both panels together). Appended as new ledger entries; no existing entry was modified.

**One patch was made, then deliberately reverted.** The transport-copy fix above was written, tested and green before it became clear the wording is pinned *verbatim inside `<intent-contract>`* — the I/O matrix's "Transport failed" row quotes "nothing was recorded". A review pass may not amend the intent contract, and the finding is not an intent *gap* (the intent is explicit, not incomplete), so neither the patch nor a loopback was available. It is deferred instead, with the candidate replacement recorded, and the constant now carries a comment explaining why it says something the client cannot know. Silently deviating from a frozen contract is precisely what the triage categories exist to prevent, and this is the one finding this pass had to leave visibly unfixed.
- **11 rejected** — listed in the triage log. The largest group is rolling-deploy defensiveness against unknown Server Action result shapes: Next rejects a mismatched action id outright, which lands in the transport `catch` that already exists, so those arms are unreachable. Two more are true observations with no user consequence (`SALARY_FIELD_HAS_CONTROL` and `SALARY_CHANGE_FORM_FIELD_ORDER` are not wired to the panel's JSX) and were declined as refactors this pass will not make on a closed story.
- **0 intent gaps, 0 bad-spec findings.** No loopback; `review_loop_iteration` stayed at 0.

**Verification.** Every gate re-run directly after the patches, not reported by a subagent:

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run test` | 1109 passed, 31 files |
| `npm run test:coverage` | 100% statements / branches / functions / lines |
| `npm run test:integration` | 113 passed against real PostgreSQL 18 |
| `npm run test:browser` | 113 passed |
| `npm run test:browser:db` | 56 passed (54 + two new tests) |

The three new tests were confirmed **red before the fixes and green after**; the unit tests were committed red in a separate commit (`6368058`) ahead of the code satisfying them, per Law 1. `test:mutation` was not re-run: no patch in this pass touches `src/domain` or `src/application` — `money.ts` is byte-identical — which is the whole of its scope, and the coverage gate over those layers is unchanged at 100%.

**One gate failure was investigated and attributed, not waved past.** The first full `test:browser:db` run failed on CAP-2's `a successful create`. It passes in isolation, passed on a re-run of the full file (56/56), and is the exact test, failing the exact way, that deferred entry A documents from two `master` runs after story 4-1. It runs before every test this pass touched, so it cannot be downstream of them. Untouched deliberately — the spec forbids solving it here.

**Residual risks added by this pass.**

- **The pending button's semantics changed, and that is the thing to look at first.** Moving from the `disabled` attribute to `aria-disabled` fixes the focus defect but means the form can now be submitted natively while a request is in flight — the browser no longer refuses the press, `pendingRef` does. That guard was added in the previous pass and, as that pass recorded, has no direct test. It is now load-bearing in a way it was not before: the attribute is no longer shadowing it. The new e2e exercises the path (it presses the button, then asserts the panel reopens usable), but it does not prove the synchronous double-dispatch race the ref exists for.
- **The mid-flight tests hold a request open with `page.route`, which is a new dependency in this suite.** No other test in `e2e/employees.spec.ts` intercepts a Server Action POST. It releases the request before the test ends and the full file is green, but this is the first use of the technique here and it interacts with a suite that already carries two intermittency entries.
- **Everything earlier passes recorded still stands** — the panel proven only by e2e, the untouched read-after-write race, the permanently undeletable duplicate row, the stale default date across UTC midnight, and the caution that a triage log's *rejections* deserve the same scepticism as its findings. This pass adds a third instance of that last one: the previous pass rejected an integration test as unnecessary while that very test was being added in the same diff.
