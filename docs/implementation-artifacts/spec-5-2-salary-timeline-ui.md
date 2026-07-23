---
title: 'Salary Timeline — UI (CAP-4, story 5-2)'
type: 'feature'
created: '2026-07-23'
status: 'done'
baseline_revision: '1a513c738ca70d59d2086ea6ff4f47d39c24a4ab'
final_revision: '6eece99de590e15baa4ab6bad579d42ee3559762'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-5-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 5-1 finalized the CAP-4 read (`getSalaryTimeline` → `SalaryTimelineView`), but nothing renders it: the employee detail page (`src/app/employees/[id]/page.tsx`) shows identity fields only and its own docstring reserves the salary timeline for "Epic 5". An HR manager cannot yet see an employee's salary history — the trust surface that proves prior records stay readable and unmodified.

**Approach:** Add the DR9 salary-timeline surface on the employee detail page, consuming 5-1's finalized payload **unmodified**. A pure `src/ui/salary-timeline.ts` view-model builder derives per-row display (formatted date, amount-with-currency, the row-over-row percent-change, and the `(Hire)` marker on the oldest record); a presentational `src/ui/salary-timeline.tsx` renders the list; the page calls `getSalaryTimeline(deps, id, today)` and renders the three result arms. No backend change — the contract is fixed (Law 7).

## Boundaries & Constraints

**Always:**
- Consume `SalaryTimelineView` unmodified; add no field to the payload and no method to any port (Law 7). Records arrive newest-first; the head (`records[0]`) is the current salary by the 5-1 contract (`currentSalaryRecordId === records[0]?.id`) — do not re-resolve current here (AD-8).
- Percent-change and `(Hire)` are **derived at render**, never stored (DR9). Percent-change of a row = change versus the next-older row's amount; the oldest row bears `(Hire)` and has no percent chip.
- Every amount renders through the ONE money formatter (`formatMoney` after `fromBoundaryMoney`) with the currency looked up **by the row's own `salary.currency`** from the reference `currencies` list; never a bare number, never a hard-coded exponent, never a cross-currency conversion (Law 4, AD-4, AD-6). Numerals are `font-mono`, amounts right-aligned.
- The surface is **read-only ink**: no edit or delete affordance on any row; the percent chip is display-only, never selectable/focusable (AD-18, DR9).
- Direction is carried by the signed number in text (`+9%` / `-4%` / `0%`), not by color — the token system has no red/green; color is never the sole carrier of meaning (WCAG 2.2 AA).
- Total rendering: the page maps `getSalaryTimeline`'s three arms — `timeline` renders the list (empty `records` → a dignified empty statement), `unavailable`/`not-found` render an "unreadable" region (never conflated with a normal empty history). No hex literals — semantic tokens only.
- Pure UI logic (formatting, percent derivation, marker/withheld decisions) lives in `src/ui/salary-timeline.ts` and is unit-tested in `tests/ui/salary-timeline.test.ts`, Vitest node env — no jsdom, no React Testing Library (project constraint).
- `asOf` passed to the read is the page's existing `today` (the clock port read once at the boundary), matching the sibling `EmployeeDetail`/`salaryChangeAvailability` reads on the same page (Law 6).

**Block If:**
- Rendering the timeline requires a field the finalized `SalaryTimelineView` does not carry (it should not: effective date, amount-with-currency per row, newest-first order, and the current-record marker are all present).
- The design demands a color-only up/down signal the token system cannot express (it does not — the signed number is the carrier).

**Never:**
- No change to `getSalaryTimeline`, `orderSalaryTimeline`, `resolveCurrentSalary`, any port, adapter, Server Action, or Route Handler; no second current-salary determination; no percent computed in the domain/DB.
- No `Date.now()`/`new Date()`/timezone read in `src/ui` (or anywhere inward); no float arithmetic for the percent (use integer minor-unit / bigint math, rounded half-up at the final step); no raw `bigint` or bare amount crossing into a prop.
- No edit/delete control, no selectable percent chip, no as-of URL-param control on this page (out of scope; the page renders at `today`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Multi-record history | `timeline` with 3 rows newest-first, one currency | 3 rows, newest-first; amount-with-currency each; percent chip on rows 1–2 (vs next-older), `(Hire)` on the oldest; head row = current | none |
| Increase / decrease / no-change | consecutive amounts higher / lower / equal | `+N%` / `-N%` / `0%`, half-up to integer, sign carries direction | none |
| Single record | 1 row | one row, `(Hire)` marker, no percent chip | none |
| Empty history, employee exists | `timeline`, `records: []`, `currentSalaryRecordId: null` | timeline section with a dignified "no records" statement (no rows) | none |
| Currency unresolvable | reference tables unreadable, or row currency absent / unsupported exponent | timeline **withheld** with a statement (no raw numbers shown) | none |
| Repository/DB unreadable | `getSalaryTimeline` → `unavailable` | "unreadable" region, distinct from an empty history | return value, not a throw |
| Defensive not-found | `getSalaryTimeline` → `not-found` (race after `getEmployee` resolved) | same "unreadable" region (total; never a crash) | return value, not a throw |
| Same-day correction | two rows share `effectiveFrom` | both rows shown; percent computed between them normally | none |

</intent-contract>

## Code Map

- `src/app/employees/[id]/page.tsx` -- the RSC to extend: reads `today` via `systemClock.todayUtc()`, `deps = employeeReadDeps()`, calls `getEmployee`, loads `options = loadEmployeeFormOptions(deps)`, renders one identity `<section>`. Add the second read + timeline section here. `deps` already satisfies `SalaryTimelineDeps`.
- `src/application/use-cases/salary-timeline.ts` -- `getSalaryTimeline(deps, employeeId, asOf)`; the finalized `SalaryTimelineView`/`SalaryTimelineRow`/`GetSalaryTimelineResult` consumed unmodified.
- `src/domain/money.ts` -- `formatMoney(money, format): string | null`, `fromBoundaryMoney(value): Money | null`, `isSupportedExponent`, `CurrencyFormat`, `BoundaryMoney`. The one money formatter.
- `src/domain/plain-date.ts` -- `formatPlainDate(date): string | null`, `plainDateToIso(date): string`. Date display idiom used on the page.
- `src/ui/salary-change-form.ts` -- `salaryChangeAvailability`: the country → currencyCode → `CurrencyFormat` resolution + `isSupportedExponent` guard pattern to mirror; the pure-UI-module + `tests/ui/*` convention.
- `src/ui/employee-form.ts` -- `currencyLineFor`; `EmployeeFormOptions` shape (`countries[].currencyCode`, `currencies: CurrencyFormat[]`).
- `src/ui/employee-unavailable.tsx` -- `EmployeeUnavailable` (`{ id, heading, statement }`), the reusable "could not read" region (region, not `role="alert"`); reuse for the timeline's `unavailable`/`not-found` arms with a distinct `id`.
- `docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md` (§ Components, timeline-list) and `imports/stitch/screen-03-employee-detail.html` -- DR9 row spec and token names.

**Added by this story:**
- `src/ui/salary-timeline-vm.ts` -- pure `buildSalaryTimeline(view, currencies)` → view-model (per-row formatted date/amount + `hire`/`change` marker, or a `withheld` result). (Named `-vm` after a review patch: sharing the `salary-timeline` basename with the `.tsx` forced the repo's only explicit-extension imports.)
- `src/ui/salary-timeline.tsx` -- presentational `SalaryTimeline` component rendering the section/list from the view-model.
- `tests/ui/salary-timeline.test.ts` -- unit tests for the builder.

**Extended by this story:**
- `src/app/employees/[id]/page.tsx` -- second read + timeline rendering (wrap the return in a fragment; timeline as a sibling `<section>`).

## Tasks & Acceptance

**Execution:**
- [x] `tests/ui/salary-timeline.test.ts` -- assert `buildSalaryTimeline` across the I/O matrix: newest-first rows preserved; per-row amount via `formatMoney`(`fromBoundaryMoney(row.salary)`, format looked up by `row.salary.currency`); date as `{ iso: plainDateToIso, label: formatPlainDate ?? iso }`; percent = row-over-row vs next-older amount, bigint math, half-up to integer, signed (`+`/`-`/`0%`); oldest row → `hire` marker & no percent; single row → `hire` only; empty `records` → `{ kind:'timeline', rows:[] }`; unresolvable/absent currency or unsupported exponent → `{ kind:'withheld', statement }`; determinism (same input → same output) -- red first.
- [x] `src/ui/salary-timeline.ts` -- implement `buildSalaryTimeline(view: SalaryTimelineView, currencies: readonly CurrencyFormat[])`: map rows to a view-model, resolving each row's `CurrencyFormat` by `row.salary.currency`; return `{ kind:'withheld', statement }` (currency-unreadable copy) if any amount cannot be formatted; else `{ kind:'timeline', rows }` where each row carries `id`, `date`, `amountText`, and `marker` (`{kind:'hire'}` for the oldest / `{kind:'change', percentText}` otherwise) -- pure, total, no `Date`/`Math.random`/I/O.
- [x] `src/ui/salary-timeline.tsx` -- `SalaryTimeline` component: a `<section aria-labelledby="salary-timeline-heading">` with a caps `<h2>` "Salary timeline"; on `withheld` render the statement (muted body-sm); on empty `rows` render a dignified "no records" statement; else a `<ul>` of rows — date left (`font-mono text-number-sm text-ink-muted`, wrapped in `<time dateTime>`), amount right-aligned (`font-mono text-number-md text-ink`), then the percent chip (display-only, non-interactive: `surface-tint` fill, `border-strong`, `ink-muted` text, `rounded`) or the `(Hire)` text label; 1px `border-border-hairline` divider between rows (none after the oldest); no shadows; semantic tokens only, light + dark -- presentational, read-only, no Server Action prop.
- [x] `src/app/employees/[id]/page.tsx` -- after `options`, call `const timeline = await getSalaryTimeline(deps, id, today)`; wrap the return in a fragment and add the timeline section after the identity `</section>`: `unavailable`/`not-found` → `<EmployeeUnavailable id="salary-timeline-unavailable-heading" …>`; `timeline` → `<SalaryTimeline>` built from `buildSalaryTimeline(timeline.timeline, options.kind === 'options' ? options.options.currencies : [])` -- reuses the in-scope `deps`/`today`; adds nothing to the contract.

**Acceptance Criteria:**
- Given an employee with N same-currency records effective on or before today, when the detail page renders, then N rows appear newest-first, each showing its effective date and amount-with-currency (mono, right-aligned), rows above the oldest show a signed percent chip versus the next-older amount, and the oldest shows `(Hire)` with no chip.
- Given the record above the oldest is +9.1% / +11.9% higher, when rendered, then the chips read `+9%` / `+12%` (half-up to integer); a lower amount reads `-N%` and an equal amount `0%`; direction is legible without color.
- Given `getSalaryTimeline` returns `unavailable` (or, defensively, `not-found`), when the page renders, then an "unreadable" region appears — visibly distinct from an employee whose history is simply empty — and nothing throws.
- Given the reference currencies cannot be read or a row's currency has no supported format, when the timeline renders, then it is withheld with a statement and no bare/raw amount is shown.
- Given `src/ui` is searched after this story, then it contains no `Date.now()`/`new Date()`/timezone read and no float arithmetic for the percent; `getSalaryTimeline` and all ports/adapters are unchanged (`git diff` touches no `src/application`, `src/adapters`, `prisma`).
- Given the gates run, then lint, typecheck, import-boundary, unit tests (incl. the new `tests/ui/salary-timeline.test.ts`), the axe a11y pass, coverage floor, and `next build` are all green; each failing test appears in a commit before the code that satisfies it.

## Design Notes

**Percent-change math (display-only, deterministic).** Both amounts are minor units in the same currency (same exponent), so the ratio is exponent-independent — compute in `bigint`: `pct = roundHalfUp((newMinor - oldMinor) * 100 / oldMinor)`. Implement half-up on the magnitude then reapply the sign (mirrors AD-5's rounding discipline, but to 0 decimals to match the DR9 mock's `+9%`/`+12%`). Never IEEE float. Format: `+` (U+002B) for positive, `-` (U+002D) for negative, `0%` for zero. This is a DR9 display concern, not a reusable domain answer, so it lives in `src/ui` (which may import `@/domain` for the money/date helpers) — not a second domain statistic.

**Currency lookup is per row, by the row's own code.** Each row carries its own `salary.currency`; resolve its `CurrencyFormat` from the reference `currencies` list (never re-resolve from `employee.country`, never convert — AD-6). In practice one employee's rows share one currency (immutable country); resolving per row also makes a defensive mixed/unknown-currency history fail closed to `withheld` rather than rendering a wrong or bare figure.

**Empty-state copy is a chosen default for an unspecified state.** DR9 specifies no timeline empty state, and Epic 3 always writes a hire record, so zero rows is defensive. Render a single muted line (e.g. "No salary records yet.") rather than an empty card or a crash — consistent with the app's dignified empty voice. Flagged here as a decision, not a payload/contract change.

```ts
// view-model shape (src/ui/salary-timeline.ts) — the component consumes this
type TimelineRowVM = {
  id: string;
  date: { iso: string; label: string };            // plainDateToIso ; formatPlainDate ?? iso
  amountText: string;                               // formatMoney(fromBoundaryMoney(salary), format)
  marker: { kind: 'hire' } | { kind: 'change'; percentText: string };
};
type TimelineVM =
  | { kind: 'timeline'; rows: readonly TimelineRowVM[] }   // newest-first; [] → empty state
  | { kind: 'withheld'; statement: string };
```

**Heading hierarchy.** App header owns the one `<h1>`; the employee name is an `<h2>`; the timeline section is a sibling `<section>` with its own caps `<h2>` "Salary timeline" (flat, both under the page `<h1>`). The percent chip is a non-interactive `<span>` — display-only, never a control (DR9).

## Verification

**Commands:**
- `npm run lint` -- expected: clean, incl. import-boundary and `no-hex` token zones.
- `npm run typecheck` -- expected: no errors (payload consumed unmodified).
- `npm run test` -- expected: all green, incl. the new `tests/ui/salary-timeline.test.ts` and the untouched suites.
- `npm run test:a11y` -- expected: axe green on the employee detail surface.
- `npm run test:coverage` -- expected: domain 100% / application ≥ 90% floors still pass (this story adds no domain/application code).
- `npm run build` -- expected: succeeds.

**Manual checks:**
- The percent chip cannot receive focus and carries no click/selection handler; direction is legible in grayscale (sign only).
- `git diff --name-only` touches only `src/ui/salary-timeline-vm.ts`, `src/ui/salary-timeline.tsx`, `src/app/employees/[id]/page.tsx`, and `tests/ui/salary-timeline.test.ts` — no `src/application`, `src/adapters`, or `prisma`.

## Review Triage Log

### 2026-07-23 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 6
- addressed_findings:
  - `[low]` `[patch]` Cross-currency percent (Edge Case Hunter): two adjacent rows in DIFFERENT but both-resolvable currencies computed a meaningless cross-currency ratio, even though the module advertised mixed-currency as fail-closed (only *unknown* currency was). `ResolvedRow` now carries its currency and the percent step withholds the whole timeline when two adjacent rows disagree — honouring AD-6's "never convert at read" and the documented no-half-answers stance. Unreachable under the immutable-country invariant; hardens the defensive breach path. +1 test.
  - `[medium]` `[patch]` Basename collision (Blind Hunter): the builder `.ts` and component `.tsx` shared the `salary-timeline` basename, forcing the repo's only explicit-extension imports (tsc resolves `.ts` first, Turbopack `.tsx`). Renamed the builder to `salary-timeline-vm.ts`; every import is now a bare specifier resolving identically under typecheck and build. +2 tests (zero-exponent percent, rise-then-fall multi-row) for the completeness nit.
  - Rejected (6): (1) percent chip lacks screen-reader relational copy ("vs previous") — the AA floor and the spec's color-not-sole-carrier AC are met and the signed value is already in the accessible name; inventing relational UX copy unattended is scope creep. (2) fixed 40px row has no overflow handling at ~320px — matches the DR9 `timeline-list.row-height` spec; 320px is not a named supported breakpoint (desktop-web surface, 768px+). (3) one reference-table outage yields three statements on the page — each is contextually correct; a rare-outage cosmetic. (4) one bad row withholds the whole history — the documented, intentional no-half-answers posture. (5) a sub-0.5% real change renders `0%` — the spec/mock's integer rounding, by design. (6) withheld vs empty distinguished by copy alone — the spec's "visibly distinct" bar targets the `unavailable` region (`bg-refusal-fill`); both benign no-numbers states sharing a muted line is acceptable.

## Auto Run Result

Status: done

### Implemented change

The DR9 salary-timeline surface on the employee detail page — the CAP-4 trust surface that proves prior salary records stay readable and unmodified. Story 5-1 finalized the read (`getSalaryTimeline` → `SalaryTimelineView`); this story renders it and adds nothing to the contract (Law 7).

A pure `src/ui/salary-timeline-vm.ts` (`buildSalaryTimeline`) turns the fixed payload into a view-model: it resolves each row's `CurrencyFormat` by the row's own `salary.currency` from the reference list, formats the amount through the one `formatMoney` and the date via `formatPlainDate`, derives the row-over-row percent-change in `bigint` (half-away-from-zero to an integer, signed `+N%`/`-N%`/`0%` — direction carried by the sign, not colour), and marks the oldest record `(Hire)`. It fails **closed** to `withheld` the instant any amount cannot be shown or two adjacent rows disagree on currency — no bare or cross-currency figure is ever printed. `src/ui/salary-timeline.tsx` renders the section (newest-first `<ul>`, hairline dividers, a non-interactive display-only chip, `(Hire)` label, dignified empty line) using semantic tokens only. `src/app/employees/[id]/page.tsx` calls the read at the same boundary `today`, and renders the three arms: `timeline` → the list; `unavailable`/`not-found` → a shared "unreadable" region kept visibly distinct from an empty history.

### Files changed

**Added**
- `src/ui/salary-timeline-vm.ts` -- pure `buildSalaryTimeline` + the `TimelineVM`/`TimelineRowVM` types the component consumes.
- `src/ui/salary-timeline.tsx` -- the presentational `SalaryTimeline` Server Component (read-only, no Server Action).
- `tests/ui/salary-timeline.test.ts` -- 18 unit cases over the builder's whole I/O matrix.

**Extended**
- `src/app/employees/[id]/page.tsx` -- the second CAP-4 read + the timeline section (return wrapped in a fragment; timeline a sibling `<section>`). No backend, port, adapter, or prisma change.

### Review findings

One review pass (Blind Hunter + Edge Case Hunter, in parallel, at session capability). Both confirmed the core airtight: percent math correct (magnitude half-up, sign reapplied, all-`bigint`, no float), order preserved, fail-closed withholding total, laws honoured (pure `src/ui`, no `Date`/float, money only via `formatMoney`, no `@/app/*` import, no hex, non-interactive chip, payload unmodified). **2 patched** (1 medium basename-collision rename, 1 low cross-currency guard). **0 intent gaps, 0 bad-spec, 0 deferred. 6 rejected** (a11y relational copy above the met AA floor, by-design DR9/rounding/fail-closed behaviours, cosmetics). `review_loop_iteration` stayed at 0.

### Verification performed

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean (import-boundary + no-hex) |
| `npm run test` | 1155 passed, 33 files (incl. the 18-case `tests/ui/salary-timeline.test.ts`) |
| `npm run build` (`next build`) | succeeds; `/employees/[id]` builds and static-analyses clean |
| `npm run test:a11y` | 20/20 axe green (light + dark) — run during implementation; the review patches change no rendered a11y semantics |

`npm run build` requires temporarily repointing `turbopack.root` off the worktree (which has no local `next`); done, confirmed, reverted — no committed config change. Verified by inspection: `git diff --name-only` since baseline touches only the four target files (+ this spec); `src/ui` contains no `Date.now()`/`new Date()`/float; `getSalaryTimeline` and all ports/adapters/prisma are unchanged. Commit history pairs the failing test with the code that satisfies it, red first.

### Residual risks

- **`.tsx` render paths are not unit-tested** (project constraint: no jsdom / RTL). The component is markup-only over a fully unit-tested view-model; its populated render is exercised only by the DB-backed Playwright job (`test:browser:db`), which needs a real Postgres 18 + seed and was not runnable in this environment. The no-DB a11y job exercises the `unavailable` arm.
- **Mixed-currency histories now fail closed at the UI**, but the underlying AD-6 invariant (currency = immutable country) is still trusted by the backend read (5-1's recorded residual). A defensive breach yields a withheld timeline rather than a wrong figure — a signal, not silent corruption.
- **`test:coverage` / `test:mutation` were not re-run** — this story adds no `src/domain`/`src/application` code, so the floors and mutation scope are unchanged; `src/ui` is outside both gates by configuration.
