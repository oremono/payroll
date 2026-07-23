# Epic 6 Context: CAP-5 — Peer Comparison or Refusal

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic lets an HR manager see where an employee sits relative to their peers: the peer-group median, the spread as a min–max range, and the employee's signed distance from the median — every figure carrying its receipts (group definition, count, as-of date, currency). When the peer group holds fewer than five people, the view returns a dignified, explicit refusal that names the count rather than widening the group or erroring. It is the first epic to compute a fairness statistic over a peer group, so it establishes the canonical median, the current-salary resolver against an as-of date, the answer/refusal boundary payload, and the reusable refusal panel, provenance caption, and copy-answer UI affordances that later epics reuse. Delivered as two stories — a test-first backend slice that ships a finalized boundary payload, then a frontend surface consuming that fixed payload.

## Stories

- Story 6.1: Peer comparison — backend (domain statistics, peer group, use-case, boundary payload)
- Story 6.2: Peer comparison — frontend (employee-detail card, refusal state, provenance, copy-answer)

## Requirements & Constraints

- A peer group of 5 or more must report the group median, spread (min–max), and this employee's signed distance from the median, all in the group's single currency.
- A peer group below 5 must return an explicit refusal naming the peer count — never widen the group, never error. The refusal is a first-class designed state and a return value, not an exception.
- Every answer must be deterministic: a pure function of the data and a supplied as-of date. The same question asked twice returns the same answer; no domain or application code reads the wall clock — the as-of date is a required explicit argument passed inward from the delivery boundary.
- No salary is ever displayed without its currency. Money is integer minor units plus an ISO-4217 code; it serializes across any boundary as a decimal string, never a JS number, float, or raw bigint.
- No comparison may cross a currency; peer groups are single-currency by construction, so no FX appears anywhere in this epic.
- Core logic (peer grouping, median, spread, distance) must be covered by fast, deterministic unit tests: fixed inputs, no wall clock, no database. Tests are written test-first (red before green); a domain coverage floor and mutation testing gate the merge.
- Backend-done is a gate before the frontend story starts: domain + application suites green, at least one adapter integration test against a real disposable Postgres 18 (never a mock), and the boundary payload finalized.
- Accessibility floor (WCAG 2.2 AA) applies to the surface: color is never the sole carrier; the refusal renders as a region with a heading, never `role="alert"`; recompute on an as-of change announces via a polite live region.

## Technical Decisions

- **Layering (functional core / imperative shell).** The statistic lives in `src/domain/` (pure); the use-case orchestrating the peer-group load and payload assembly lives in `src/application/`; Prisma access is an adapter behind a repository port. `src/domain/**` may import nothing outside itself — no Prisma, Next, `Date`, `Math.random`, or `fs` (enforced by the import-boundary lint gate).
- **SQL never computes a domain statistic.** The database selects the peer set; the median, spread, and distance are all computed in-process in the domain. No `percentile_cont`, `AVG`, or window functions produce a user-facing value. `n` is the cardinality of the exact in-memory set the statistic was computed over — never a separate `COUNT` query.
- **One canonical median** (`src/domain/statistics.ts`, reused by CAP-6 and CAP-7): sort ascending by integer minor units; odd n → middle element; even n → arithmetic mean of the two middle elements, rounded half-up to the nearest minor unit. Exactly one implementation exists. A median of an empty set is never computed.
- **Spread is min–max** (not IQR, not standard deviation): the minimum and maximum of the peer group's as-of current salaries, in the group's single currency.
- **Distance** is expressed in percentage points: `d = (salary − median) / median × 100`, computed in exact rational/decimal arithmetic over integer minor units (never IEEE double). The magnitude is rounded half-up to exactly one decimal place, then the sign reapplied. The sign is carried into display and the direction word. The median is never zero (salaries are `> 0`) and the group is never empty, so the division is total.
- **The as-of population defines the peer group.** An employee is in the as-of population at date D iff `hire_date ≤ D` AND at least one salary record has `effective_from ≤ D`. The peer group of employee E is every employee in the as-of population sharing E's `(role, level, country)`, including E. A peer group is not a table — it is derived at read time. An employee not in the population yields a distinct refusal (`no salary as of D`), never `n = 0` arithmetic.
- **Current-salary resolver** (one canonical implementation in the domain, shared across capabilities): current salary = the record with the greatest `(effective_from, seq)` where `effective_from ≤ as-of date`; `seq` is the `BIGSERIAL` tie-break, never `created_at`.
- **Answer payloads carry receipts.** The answer crosses the application boundary as a discriminated union `{ kind: 'answer', … } | { kind: 'refusal', reason, counts }` carrying value plus provenance — group definition, `n`, as-of date, currency — in one object. The verdict sentence is composed by exactly one function in `src/domain/verdict.ts` and consumed unmodified by both the card and copy-answer. This payload is finalized in the backend story and the frontend adds nothing to the contract.
- **Delivery boundary.** The employee-detail read is a React Server Component calling the use-case in-process (no self-fetch); there are no mutations and no route handlers in this epic.
- **Vocabulary (verbatim in code and copy):** `peerGroup`, `peerMedian`, `spread`, `distancePct`, `refusal`, `asOf`, `effectiveFrom`. Banned: `snapshot`, `compaRatio`, `payBand`. Domain functions are total — they do not throw; refusals are data.

## UX & Interaction Patterns

- **Peer-comparison card** (employee detail): answers at a glance — peer median with currency, signed distance (e.g. "8% under peer median"), min–max range, group size, as-of date. Both answer and refusal states occupy the same layout slot.
- **Refusal panel** (introduced here, reused later): flat neutral tint plus hairline, default radius; headline plus explanation naming the count ("No comparison — only 3 peers. This peer group has 3 people…"). Announced as a region with a heading, never error styling, never `role="alert"`. Confident statement of a standard, never an apology.
- **Provenance caption** (introduced here): `body-sm` in muted ink directly beneath the computed figure, within one line — group size ("Based on 9 peers"), as-of date, currency.
- **Copy-answer affordance** (introduced here): ghost icon button on the card header, present on both answer and refusal states; copies the single verdict sentence with receipts as plain text; announces "Answer copied" via the polite live region with a non-color-only confirmation. A copied refusal is a full citizen — a quotable answer too.
- Verdicts are hedge-free single sentences ("Priya Nair is 8% under her peer median (₹23,40,000 INR), based on 9 peers — Software Engineer · L4 · India — as of 16 Jul 2026"); no softeners. All numerals render in monospace, right-aligned.

## Cross-Story Dependencies

- The frontend story (6.2) must not start until the backend story (6.1) is done per the gate above, and it consumes the finalized boundary payload without extending it.
- Depends on Epic 1 foundations: the data model (`employee`, `salary_record`, reference tables), design tokens, app shell with sidebar IA, the global as-of date control, and the CI/TDD gates.
- Peer comparison is reached only through an employee (or, later, a finding) — there is no peer-group index or browse surface.
- Downstream reuse: the canonical median and current-salary resolver are consumed by Epic 7 (outliers) and Epic 8 (gender gap); the refusal panel, provenance caption, and copy-answer affordance introduced here are reused across later epics. NFR11b (demonstrable end-to-end — a thin peer group refused out loud) is a final acceptance check verified after Epics 6, 7, and 12.
