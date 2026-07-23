# Epic 5 Context: CAP-4 — Salary Timeline

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic lets an HR manager open an employee's detail view and see that employee's full salary history — every salary record, each with its effective date and its own currency, ordered in time (newest first). It reads the append-only salary series that Epics 3–4 write and surfaces it as a read-only timeline; alongside it, the employee's "current" salary resolves deterministically against the supplied as-of date. It matters because it is the trust surface for the append-only, effective-dated data model: it proves prior records remain readable and unmodified, and it establishes the one canonical current-salary resolver that every later comparison capability (peer comparison, outliers, gender gap, overdue) consumes.

## Stories

- Story 5-1: Salary timeline backend
- Story 5-2: Salary timeline UI

## Requirements & Constraints

- Every salary record for a given employee must be listed with its effective date and its currency, ordered in time. No record is omitted, none is mutated on read.
- "Current salary" is a pure function of the data and a supplied as-of date: it resolves to the latest record with `effective_from` on or before the as-of date. No domain code reads the wall clock; the as-of date is always an explicit argument.
- Money never appears without its currency. Amounts are integer minor units plus an ISO-4217 currency code — never a bare number or a float. Each row carries the record's own currency; the timeline never converts or crosses currencies.
- History is read-only. The series is append-only and effective-dated; the timeline must expose no edit or delete affordance on any past row.
- The derived percent-change between consecutive records and the `(Hire)` marker on the first (oldest) record are computed for display, not stored.
- Core logic must be covered by fast, deterministic unit tests written test-first (red → green → refactor): fixed inputs, no wall-clock dependence, no database. CI enforces a coverage floor on `src/domain` + `src/application` and mutation testing over `src/domain`.
- Backend-before-frontend is a hard gate: story 5-1 is "done" only when domain + application suites are green, at least one adapter integration test runs against a real disposable Postgres 18 (never a mock), and the answer payload the UI consumes is finalized. Story 5-2 consumes that fixed payload and adds nothing to the contract.

## Technical Decisions

- **Functional core / imperative shell.** Timeline read logic and the current-salary resolver live in `src/domain` (pure) and `src/application` (use-cases, ports). `src/domain` may not import Prisma, Next, `Date`, `Math.random`, or `fs` — enforced by the import-boundary lint gate.
- **One canonical current-salary resolver.** Current salary = the record with the greatest `(effective_from, seq)` where `effective_from ≤ as-of date`. Same-date ties break on `seq` (a monotonic `BIGSERIAL`), never on `created_at`. There is exactly one such resolver in `src/domain`; this epic establishes it and every later capability consumes it rather than writing its own `ORDER BY`. A timeline ordered `effective_from DESC` and a resolver ordering `(effective_from, seq)` must agree for the same employee.
- **Data model.** `salary_record` has `seq BIGSERIAL`, `amount_minor` (CHECK `> 0`), `currency_code`, and `effective_from DATE`. `effective_from`, `hire_date` are calendar dates (`DATE`) — no timezone, no instant. The as-of date is a plain-date value object, not a JS `Date`; "today" means the current UTC date, supplied only at the delivery boundary via the clock port.
- **Append-only, enforced not promised.** `salary_record` has no update/delete path; UPDATE/DELETE are revoked on the app DB role by migration and the repository port exposes only `append` + read. The timeline is purely a read consumer of this contract.
- **Delivery boundary.** The timeline is a read: a React Server Component calls the use-case directly in-process — no `fetch` to our own origin, no new Route Handler. Reads do not go through Server Actions.
- **Answer payload shape.** The timeline crosses the application boundary as a single object carrying each record (effective date, amount in minor units, currency) plus the resolved current-salary record and the as-of date it was resolved against; derived fields (percent-change, `(Hire)`) are computed at the edge, not stored. Finalizing this payload is part of the 5-1 done-gate.
- **Domain vocabulary (use verbatim).** `salaryTimeline`, `effectiveFrom`, `asOf`. Banned in code as in copy: `snapshot`, `compaRatio`, `payBand`. DB tables `snake_case` singular; TS files `kebab-case`; types `PascalCase`.

## UX & Interaction Patterns

- **Salary timeline list** (employee detail surface): chronological rows, newest first. Each row shows the effective date and the amount-with-currency (monospace numerals, right-aligned), a derived percent-change chip (display-only, never selectable), and a `(Hire)` label on the first/oldest record. Hairline 1px dividers; no shadows.
- Read-only history — no edit affordances on any past row.
- Percent-change and `(Hire)` are derived at render time, not stored.
- Desktop web surface (1280px+ primary; 768–1279px stacks/prioritizes columns). WCAG 2.2 AA: color is never the sole carrier of meaning; numerals in monospace, right-aligned.

## Cross-Story Dependencies

- Consumes the append-only `salary_record` series written by Epic 3 (employee CRUD, which creates the first/hire record) and Epic 4 (record-a-salary-change). The employee detail view this timeline lives on comes from Epic 3.
- Story 5-2 (UI) must not start until story 5-1 (backend) clears the "backend done" gate; 5-2 consumes 5-1's finalized payload without extending the contract.
- The current-salary resolver established here is a foundational dependency for every downstream comparison capability — Epic 6 (peer comparison), Epic 7 (outliers), Epic 8 (gender gap), Epic 10 (payroll totals), and Epic 11 (overdue) all resolve current salary against the as-of date using this one resolver.
