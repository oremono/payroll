# Epic 11 Context: CAP-10 — Overdue for Review

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the HR manager a way to find employees whose pay has gone stale: given a period (e.g. "no change in 2 years"), list every employee whose most recent salary record predates that window, each shown with the date of that record. The whole answer is measured back from the supplied as-of date, never from the wall clock, so winding the as-of date back reproduces a prior day's overdue list exactly. This is the capability that surfaces the person who was hired long ago and never adjusted — the finding that would otherwise stay invisible. It appears on a dedicated Overdue surface (holding the period control) and as a compact count on Home that links there; both placements must compute from the same as-of-derived rule.

## Stories

- Story 11.1: Overdue backend (domain + application, period cutoff logic, boundary payload)
- Story 11.2: Overdue UI (surface, period control, list, Home summary count)

## Requirements & Constraints

- Given a period and an as-of date, return the employees whose most-recent salary record predates the period window, each with that record's effective date. Result is a pure function of the data, the as-of date, and the period — the same inputs always yield the same list.
- No domain or application code reads the wall clock. The as-of date and the period are required explicit arguments passed inward from the delivery boundary; "today" only exists at the boundary as a default.
- Determinism is the load-bearing property here: this is the last capability where "measure from now vs. measure from the as-of date" could silently diverge. Both the Overdue surface use-case and the Home summary-count use-case must derive the cutoff from the passed as-of date and actually use it — accepting `asOf` but computing from "today" is a defect even though it would pass a clock-blind lint.
- Domain logic must be covered by fast, deterministic, DB-free, clock-free unit tests written test-first (red before green); a coverage floor and domain mutation testing gate merges. Where the story touches persistence, at least one adapter integration test runs against a real disposable Postgres, never a mock.
- CSV export of the Overdue list: exports the visible list computed at the current as-of date, columns carrying currency and as-of/provenance fields. Exact column layout is unspecified in sources and may be settled here, provided currency and as-of columns are present.
- Backend is a gate for the frontend story: domain + application suites green, integration test green, and the boundary payload finalized before the UI story starts.

## Technical Decisions

- **Overdue cutoff (the core rule):** `cutoff = asOf − period`. An employee in the as-of population is overdue iff the `effective_from` of their as-of *current* record is **strictly earlier** than the cutoff — a record dated exactly on the cutoff is NOT overdue. Period arithmetic is calendar-based; a day absent in the target month clamps to that month's last day (e.g. 29 Feb minus one year → 28 Feb). Preset period chips and the custom date field resolve to the same cutoff by the same rule — a chip is a period value, not a separate code path.
- **A hire record is a salary record.** Someone hired long ago and never adjusted is overdue — that is precisely the finding this capability exists to surface. Do not special-case hire-only employees out.
- **As-of population membership:** an employee is in the population at date `D` iff `hire_date ≤ D` and at least one salary record has `effective_from ≤ D`. Employees outside the population appear in no overdue list and in no count a user sees. Membership is computed identically to every other capability.
- **Current-salary resolver (single canonical implementation):** the "most recent record" is the record with the greatest `(effective_from, seq)` where `effective_from ≤ asOf`. `seq` (a monotonic BIGSERIAL) is the same-date tie-break; `created_at` must not be used. Consume the one existing resolver in `src/domain/`; do not write a new `ORDER BY`.
- **Boundary payload:** the computed answer crosses the application boundary as a single object carrying its value plus provenance (as-of date, period/cutoff, and per-employee the record date and its currency). No salary or amount is ever presented without its currency (integer minor units + ISO-4217 code).
- **Layering:** logic lives in the pure functional core (`src/domain`) with the use-case in `src/application`; adapters (Prisma, clock) live in the shell. Domain must not import Prisma, Next, `Date`, `Math.random`, or `fs` — enforced by the import-boundary lint gate.
- **Delivery boundary:** the Overdue read is served by an RSC calling the use-case in-process (no self-fetch). The CSV export download is one of the two permitted Route Handlers.
- **No conversion, no cross-currency comparison** occurs in this capability; each employee's record date and currency stand on their own. There is no aggregate that would require FX.

## UX & Interaction Patterns

- **Period control:** preset chips **1y / 18mo / 2y / 3y** plus a custom date field; all resolve to the same cutoff. Lives on the Overdue surface.
- **List:** each row shows the employee and the date of their most recent salary record. The Home placement is a compact count ("N people overdue as of {date}") linking to the surface — Home names the as-of date rather than saying "currently."
- **Zero state:** "No one is overdue for review within the selected period." — a calm statement, not a celebration, in the same register as zero findings.
- **Recompute:** changing the as-of date (or period) swaps values in place and announces via a polite live region; cold load shows skeleton hairline rows, never spinners.
- **CSV export:** a secondary ghost button in the list header, exporting the visible list at the current as-of date.
- **Vocabulary/behavior floor:** use "overdue for review" verbatim; no notification/alert affordances, no red/green semantics, no celebration animations; the list paginates rather than infinite-scrolls; WCAG 2.2 AA, color never the sole carrier of meaning.

## Cross-Story Dependencies

- **11.2 depends on 11.1:** the UI story consumes the finalized boundary payload; it does not start until the backend gate is met (domain/application suites green, integration test green, payload finalized).
- **Consumes foundational work from Epic 1:** the data model (`employee`, `salary_record`), the canonical current-salary resolver, the money/currency primitives, design tokens, the app shell + sidebar (the "Overdue for Review" nav item), and the global as-of date control.
- **Reuses the as-of population definition** shared with the peer-comparison, outlier, and gender capabilities — the same membership rule and same current-record resolution, so this list is consistent with every other surface for the same as-of date.
