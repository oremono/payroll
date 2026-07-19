# Epic 4 Context: CAP-3 — Record a Salary Change

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the HR manager a way to record a raise — or a correction — as a new effective-dated salary record, in about thirty seconds, without ever touching what came before. This is the epic where append-only stops being a schema property and becomes a user-facing mechanic: a typo is fixed by appending a corrected record dated the same day, not by editing the wrong one, and there is no future-dating and no scheduled change. It is also where the system's single canonical answer to "what does this person earn?" is written — the current-salary resolver that every later statistical epic reads through.

## Stories

- Story 4.1: Record salary change backend
- Story 4.2: Record salary change UI

## Requirements & Constraints

- **A salary change appends; it never updates.** Prior records stay readable and unmodified. Appending a new record — including one dated today — is the only correction mechanism. Nothing in this epic may expose an update or delete path over salary records.
- **No future-dating.** A record whose effective date is later than today is rejected at write time. "Today" is the UTC date supplied by the clock port at the delivery boundary and passed inward explicitly; no scheduled or pending change exists.
- **Current salary is the latest record on or before the as-of date.** The as-of date is an explicit required argument everywhere, never read from the clock inside domain or application code.
- **Currency is confirmed, not chosen.** The record's currency is resolved from the employee's country via the country reference table at write time and validated to equal it; a mismatch is rejected rather than saved.
- **Amount is strictly positive** and is money in the system's sense — integer minor units plus a currency code, with the minor-unit exponent coming from the currency reference table.
- **Test-first with real persistence proof.** Domain and application logic ships red-before-green under fast, DB-free, clock-free unit tests. Backend is not done until those suites are green, at least one adapter integration test has exercised the real repository against a disposable Postgres 18 (never a mock), and the boundary payload is finalized.
- **Accessibility floor.** WCAG 2.2 AA, gated by the automated axe pass; the whole record-change flow must be completable from the keyboard.

## Technical Decisions

- **The current-salary resolver lands here, once.** Current salary is the record with the greatest `(effective_from, seq)` where `effective_from ≤ as-of`. `seq` is the monotonically increasing insertion sequence; creation timestamps may never be used as a tie-break. Same-date ties are the *designed* path, not an edge case, because same-day appending is how corrections work. Exactly one implementation exists, in the domain layer — every later capability (timeline, peer comparison, outliers, gender gap, totals, overdue) consumes it rather than writing its own ordering.
- **Extend the existing write funnel; do not fork one.** Currency-from-country and the no-future-dating check belong to the single append path already shared by the import and the employee use-case. The single-record append is a sibling method on that same port and adapter, sharing its transaction and date helpers.
- **The port exposes only append and read** for salary records. The database role already has UPDATE and DELETE revoked with a trigger backing it, so a port method offering either would fail at runtime, not merely violate convention.
- **Code placement.** Timeline/current-salary logic is pure domain; orchestration (resolve employee, resolve currency, validate, append) is a record-change use-case in the application layer; persistence sits behind the port in adapters. Domain and application code touch no database, clock, filesystem, or randomness.
- **Delivery boundary.** Reads are React Server Components calling use-cases in-process — never a fetch to our own origin. The mutation is a Server Action. This epic adds no Route Handler.
- **Serialization.** Money crossing a Server Action or JSON boundary carries its amount as a decimal string plus a currency code — never a JS number, never a raw bigint, never a bare amount.
- **Backend before frontend.** The UI story does not start until the backend story is green and its boundary payload is fixed; the frontend consumes that payload and adds nothing to the contract.

## UX & Interaction Patterns

- **Three fields only:** effective date (defaulted to today), amount, and currency (pre-filled from the employee's country and validated on submit). No reason field, no event type, no approval workflow — the form absorbs the fact and gets out of the way.
- **Entered from employee detail** via a "Record a salary change" action, opening as a keyboard-first panel: Tab through the fields, Enter saves, Esc cancels; the dialog takes focus on open, traps Tab, and returns focus to the invoking control on close. Modal stacking stays at most one level deep.
- **The appended record appears at the top of the timeline**, newest first, with its percent change derived at render time and a `(Hire)` label on the first record — neither is stored. Past rows carry no edit affordances.
- **Standing patterns apply.** Flat surfaces with hairlines and no shadows; mono numerals right-aligned; skeleton hairline rows instead of spinners; no red/green semantics, no error styling, no celebration, no notification affordances; announcements ride the single app-level polite live region. Currency is always visible next to an amount.

## Cross-Story Dependencies

- Depends on Epic 1: the layered source tree and import-boundary rule, the schema with the salary-record sequence and append-only enforcement, the money/currency primitives and formatter, generated tokens, the app shell with the global as-of control, and the CI gate set.
- Depends on Epic 2 and Epic 3 for the salary-record write funnel and typed repository port already in place — extend them; a second append path is a defect.
- Depends on Epic 3 for the employee record and the employee detail surface this form is launched from.
- Epic 5 renders the timeline this epic writes into and reuses the same current-salary resolver; Epics 6, 7, 8, 9, 10, and 11 all read current salary through that one resolver, so its tie-break semantics are load-bearing well beyond this epic.
- Epic 12's seed writes through the same funnel and inherits the currency-from-country and no-future-dating rules.
