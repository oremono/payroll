# Epic 8 Context: CAP-7 — Gender Gap or Refusal

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic lets the HR manager see whether men and women are paid differently for the same work. Within a single peer group — employees sharing the same (role, level, country) — it computes the male salary median and the female salary median and reports the gap between them. Because a gap computed over too few people is noise dressed as an answer, the view reports a gap only when the group holds at least 5 employees of each gender; otherwise it refuses out loud, naming both gender counts and which gender is short. The gap surface renders contextually on the peer-group view (reached only through a finding or an employee, never a browse index), reusing the refusal panel established earlier. It is the third consumer of the shared median and completes the fairness-math trio alongside peer comparison and outlier detection.

## Stories

- Story 8.1: Gender gap backend (domain + application, test-first, finalized boundary payload)
- Story 8.2: Gender gap frontend (peer-group surface consuming the fixed payload)

## Requirements & Constraints

- Report the gap only when the peer group holds 5 or more of each gender within the as-of population; when either gender is under 5, refuse and state both counts and which gender is short. Never widen the peer group to reach the threshold.
- The gap is a single canonical formula: within one peer group, `gap = (maleMedian − femaleMedian) / maleMedian × 100`, expressed in percentage points. The denominator is always the male median; a positive gap means men are paid more.
- Arithmetic is exact decimal over integer minor units — never IEEE float. Round the magnitude half-up to exactly one decimal place, then reapply the sign (same rounding rule the outlier distance uses).
- Both medians must be computed with the one shared median implementation — no view writes its own median. A median of an empty set is never computed.
- Currency isolation: the gap is meaningful only within one peer group, which is single-currency by construction; no comparison or median crosses a currency, and no figure is ever shown without its currency.
- Determinism: every answer is a pure function of the data and the supplied as-of date; the same question asked twice returns the same answer; no domain or application code reads the wall clock.
- The refusal is a first-class designed state, not an error — styled with the dignity of an answer and announced as content, not as an alert.
- Core logic (medians, gap, gender-count threshold, refusal) is covered by fast, deterministic, DB-free, clock-free unit tests written test-first (red before green). CI enforces a coverage floor and mutation testing over the domain.
- "Backend done" gate for story 8.1: domain + application suites green, at least one adapter integration test against a real disposable Postgres 18 (never a mock), and the boundary payload finalized before the frontend story starts.

## Technical Decisions

- **Peer group and as-of population.** A peer group is derived at read time as every employee in the as-of population sharing the target's (role, level, country), including the target. An employee is in the as-of population at date D iff hire_date ≤ D and at least one salary record has effective_from ≤ D. Every count a user sees (including each gender's n) is the cardinality of that exact in-memory set — never a separate COUNT query against the table.
- **Current salary resolution.** Each employee's salary is the record with the greatest (effective_from, seq) where effective_from ≤ as-of date; seq (BIGSERIAL) is the same-date tie-break, never created_at. Exactly one current-salary resolver exists and is consumed here.
- **Canonical median.** Sort ascending by integer minor units; odd n → middle element; even n → arithmetic mean of the two middle elements, rounded half-up to the nearest minor unit. One implementation only, shared with peer comparison and outliers.
- **The gap formula (single source).** Compute male median M and female median F over the group's as-of population, each per the canonical median rule. `gap = (M − F) / M × 100`. Denominator is always M. Magnitude rounded half-up to one decimal, sign reapplied. Reported only when both genders have n ≥ 5 in the group; otherwise refuse, naming both counts and which gender is short.
- **Refusal threshold has two levels here.** The base peer-group n ≥ 5 rule still applies (a group under 5 total refuses every comparison, this one included); the gender gap adds the stronger requirement of ≥ 5 of each gender. A refusal names the count(s).
- **Money representation.** Every monetary value is `{ amountMinor: bigint, currency }`; minor-unit exponent comes from the currency reference table (never hard-coded 100). At any Server Action / JSON boundary, amountMinor serializes as a decimal string, never a JS number or raw bigint. Salaries are strictly positive (DB CHECK + write validation), which keeps a non-empty group's median non-zero and the gap division total.
- **No statistic in SQL.** The database stores rows and selects sets; it computes no median, count, or gap that reaches the user as a domain value. Spread, where it renders on this surface, is min–max of the group's as-of salaries (not IQR, not stddev).
- **Boundary payload (receipts).** The answer leaves the application layer as a discriminated union — `{ kind: 'answer', … } | { kind: 'refusal', reason, counts }` — carrying its value plus provenance (group definition, per-gender n, as-of date, currency) in one object. The verdict sentence is composed by the single verdict composer and consumed unmodified by both the card and copy-answer. A refusal is a return value, never a thrown exception, and carries its counts.
- **Gender.** MALE / FEMALE enum only; gender is never part of peer identity — it only slices within one peer group.
- **Layering.** Domain (pure: no I/O, clock, or randomness) ← application (use-cases, ports) ← adapters ← UI. The as-of date is a required explicit argument to every domain/application function; only adapters may read a clock. Domain functions are total — they do not throw; refusals are data.

## UX & Interaction Patterns

- The gender-gap result renders on the contextual peer-group surface (no sidebar entry, no browse index — reached only via a finding or an employee).
- Answer state: report the gap between male and female medians for the group, in the group's single currency; the group's median and spread may render alongside.
- Refusal state reuses the shared refusal panel: it says which gender is short and shows both counts (e.g. "3 FEMALE, 8 MALE — a gap needs 5 of each"); the whole-group median and spread may still show above it. Same layout slot as an answer, never error styling.
- Refusals are announced as content — a region with a heading, never role="alert". Color is never the sole carrier; direction and counts are always in words.
- Refusal grammar is a confident statement of a standard, not an apology, and is itself quotable via copy-answer where that affordance is present.

## Cross-Story Dependencies

- **Strong reuse from Epic 6 (CAP-5 Peer comparison) and Epic 7 (CAP-6 Outliers).** The as-of population / peer-group definition, the single canonical median, the current-salary resolver, the n ≥ 5 refusal semantics, the money primitives, the boundary discriminated-union payload, and the refusal panel are all established by those epics and consumed here — this epic must not fork any of them.
- Within this epic, the frontend story (8.2) must not start until the backend story (8.1) is done per the gate above, and it consumes the finalized payload without adding to the contract.
- Structurally blind spot handed to Epic 9 (CAP-8): the within-group gender gap cannot reveal gender clustering across levels org-wide; that is Gender Insights' job, a separate surface.
- The seed epic (CAP-11) is responsible for planting within-group gender gaps with ≥ 5 of each gender so this capability is demonstrable; asserted by seed obligation tests.
