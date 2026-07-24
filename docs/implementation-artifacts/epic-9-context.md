# Epic 9 Context: CAP-8 — Gender Distribution by Level

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give Alice (ACME's HR manager) an org-wide view of how gender is distributed across levels: gender counts per level, computed over the entire organization. This exposes the structural clustering that the within-group gender-gap capability (CAP-7) is blind to — a level can look fair inside each peer group yet be heavily skewed by gender across the org. It is a "knowing tool" surface: a static read that reveals a pattern, not a workflow. The epic ships a backend story (domain counting logic, use-case, and a finalized boundary payload) followed by a frontend story (the Gender Insights surface plus the Home pulse), the frontend consuming the fixed payload without adding to the contract.

## Stories

- Story 9.1: Gender distribution backend
- Story 9.2: Gender distribution UI

## Requirements & Constraints

- Report gender counts per level across the whole organization. The success bar is simply that per-level counts reveal cross-level clustering; there is no median, gap, distance, or currency math in this capability.
- Every count is a count of the **as-of population**, never of the raw table. An employee is in the as-of population at date `D` iff `hire_date ≤ D` and at least one salary record has `effective_from ≤ D`. Employees with no salary record yet, or hired after `D`, appear in no count. The gender counts must use exactly this population — the same definition every other capability counts by.
- Determinism: the result is a pure function of the data and a supplied as-of date. No domain or application code reads the wall clock; the as-of date is always an explicit argument. The same question asked twice returns the same answer.
- Gender values are the `MALE` / `FEMALE` enum only. Gender is never part of peer-group identity — here it is a slice dimension across levels, org-wide (this capability deliberately ignores role and country grouping; it slices by level alone).
- Levels come from the reference table; the level axis should reflect the reference taxonomy, not just whichever levels happen to have employees.
- This capability computes **no currency-denominated value** — it counts people, so the currency-always-visible and currency-isolation rules do not apply to its outputs.
- Test-first (TDD): domain and application units are written red-before-green. CI enforces a coverage floor on `src/domain` + `src/application` and mutation testing over `src/domain`; a surviving mutant fails the gate. Domain tests are fast, deterministic, clock-free, and DB-free.
- Backend-before-frontend gate: story 9.1 is "done" only when (1) domain + application suites are green, (2) at least one adapter integration test exercises the real repository against a disposable Postgres 18 (never a mock), and (3) the boundary payload is finalized. Story 9.2 starts only after that gate passes.

## Technical Decisions

- **Governing decisions:** SQL never computes a domain statistic (AD-2) and the as-of population defines every count (AD-16). These are the only two architecture decisions binding this capability.
- **Counting happens in-process, not in SQL.** The database selects the as-of population's rows; the per-level gender tally is computed in `src/domain/`. Postgres computes no `COUNT` that reaches the user as a domain value. Plain `COUNT`/`ORDER BY`/`LIMIT` are permitted only for directory listing and pagination — any headcount a user sees must be the cardinality of the exact in-memory as-of set, never a separate `COUNT` query.
- **Layering (functional core, imperative shell).** Dependencies point inward: `src/domain` (pure, no I/O, no clock, no `Date`, no `Math.random`) ← `src/application` (use-case + ports) ← `src/adapters` (Prisma repository) ← `src/app`/`src/ui`. An import-boundary lint gate enforces this. This capability lives in the domain gender area alongside the CAP-7 gap logic.
- **Current-salary resolution.** Whether an employee is in the as-of population depends on effective-dated salary records; use the one canonical current-salary resolver (greatest `(effective_from, seq) ≤ as-of`), never a hand-written `ORDER BY`. Same-date ties break on `seq` (a `BIGSERIAL`), never `created_at`.
- **Boundary payload carries its receipts.** The answer crosses the application boundary as one object carrying the counts plus provenance (as-of date, the population it was counted over). The frontend consumes this fixed payload and composes nothing itself. Note that AD-20's discriminated answer/refusal union is not listed as governing this capability — CAP-8 is an org-wide distribution with no `n ≥ 5` refusal state — but the "one object with provenance" discipline still applies.
- **Data model touchpoints.** `employee` (with `gender`, `level`, `hire_date`), `salary_record` (`effective_from`), and the `level` reference table. Dates are calendar `DATE` values, no timezone; the as-of date is a plain-date value object, not a JS `Date`.
- **Vocabulary.** Use the SPEC's terms verbatim in code; DB tables are `snake_case` singular, TS files `kebab-case`, types `PascalCase`.

## UX & Interaction Patterns

- **Two surfaces:** the **Gender Insights** sidebar page (the drill-down: gender counts per level org-wide) and a **gender-by-level pulse** embedded in the Home overview. Gender Insights is the drill-down target for the Home pulse.
- **Pulse charts** are compact horizontal bar strips using the primary/secondary fill pair (both ≥ 3:1 contrast against the card), squared ends, no gridlines, no legends beyond a caps label. They are **static and non-interactive** — no hover tooltips, no click targets.
- **Counts always available as text.** Every pulse chart's underlying counts are exposed as a proper data table — fully visible on Gender Insights, and visually-hidden or adjacent text on Home. Color is never the sole carrier of meaning (WCAG 2.2 AA floor, gated by an automated axe pass in CI).
- No shadows (flat, document-like); numerals in JetBrains Mono, right-aligned. Desktop web is the primary surface (1280px+; 768–1279px stacks). No hex literals in application code — styling reads generated design tokens.

## Cross-Story Dependencies

- **9.2 depends on 9.1.** The frontend (Gender Insights page + Home pulse) cannot start until the backend story's domain/application logic, integration test, and boundary payload are green and finalized (AD-24 vertical-slice gate).
- **Depends on the as-of population definition (AD-16)** established for the peer-comparison capabilities (Epics 6–8) and on the canonical current-salary resolver — reuse them, do not re-derive.
- **Depends on Epic 1 foundations:** the source-tree paradigm, CI gates (import-boundary, coverage floor, domain mutation testing, axe), the data model and reference tables, the generated design-token system, and the app-shell IA (the Gender Insights sidebar entry and global as-of date control).
- **Relationship to CAP-7 (Epic 8):** this capability deliberately surfaces the org-wide clustering CAP-7's within-group gap is structurally blind to; the two are complementary views of gender, not dependent on each other's runtime output. A fully seeded population (Epic 12) plants the cross-level gender clustering that makes this view demonstrable.
