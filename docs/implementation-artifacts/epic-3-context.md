# Epic 3 Context: CAP-2 — Employee CRUD

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the HR manager a way to add and maintain a single employee record by hand, alongside the bulk path — the everyday maintenance surface for a directory that would otherwise only be loadable in ten-thousand-row batches. An employee persists with name, role, level, country, gender, and hire date; role and level are chosen only from the reference tables, never typed free-hand; country is chosen at create and is immutable thereafter. This is also the first surface where a person is written one at a time, so it is where the typed repository port and the shared write funnel take their real shape — every later write path inherits what is built here.

## Stories

- Story 3.1: Employee CRUD backend
- Story 3.2: Employee CRUD UI

## Requirements & Constraints

- **Reference tables are the only source of taxonomy values.** Role and level come from the reference tables; nothing is created, guessed, or mapped into a taxonomy on the fly, and no free-text entry exists for a reference-table field.
- **Country is set at create and never edited.** No form, use-case, or repository method offers a country update. Changing it would invalidate the currency already written onto that employee's historical salary records and would silently move them between peer groups.
- **Identity is opaque.** An employee is identified by a generated surrogate id, never by name. Names are searchable but never identifying; correcting a name must not break a URL, and two people may legitimately share one.
- **An employee may exist with no salary.** Creation does not require a salary record. Such an employee is outside the as-of population and must therefore be invisible to every statistic, every peer group, every count, and every headcount a user sees, until a salary record exists.
- **Editing an employee is not editing history.** Salary records remain append-only; nothing in this epic exposes an update or delete path over them.
- **Test-first with real persistence proof.** Domain and application logic ships red-before-green with fast, DB-free, clock-free unit tests. The backend story is not done until those suites are green, at least one adapter integration test has exercised the real repository against a disposable Postgres 18 (never a mock), and the boundary payload is finalized.
- **Determinism.** No domain or application code reads the clock; "today" arrives only via the clock port at the delivery boundary, in UTC.
- **Accessibility floor.** WCAG 2.2 AA, gated by the automated axe pass; the whole create/edit flow must be completable from the keyboard.

## Technical Decisions

- **The typed repository port lands here.** It was deliberately deferred out of the foundation epic to its first consumer. The database already revokes UPDATE and DELETE on salary records and enforces that with a trigger, so a port exposing those operations would fail at runtime, not merely violate convention — shape the port to what is actually permitted.
- **One write funnel, built here or inherited.** Currency-from-country and the no-future-dating check belong to a single append path shared by the employee form, the bulk import, and the seed. If the import epic already built it, extend it rather than forking a second path.
- **Currency is resolved at write time from the employee's country** via the country reference table and validated to equal it. Reads never re-resolve currency. This is the structural reason country is immutable.
- **Delivery boundary.** Reads are React Server Components calling use-cases in-process — never a fetch to our own origin. Mutations are Server Actions. This epic adds no Route Handler; exactly two exist in the whole system and neither is this.
- **Code placement.** Create/edit orchestration and reference-table validation live in an employee use-case in the application layer; persistence lives behind the port in adapters. The domain layer stays pure — no database, clock, filesystem, or randomness.
- **Backend before frontend.** The UI story does not start until the backend story is green and its boundary payload is fixed; the frontend consumes that payload and adds nothing to the contract.
- **Data model touchpoints.** Employee carries a generated id, name, role, level, country, gender (`MALE`/`FEMALE`), and hire date. Reference tables supply role, level, country, and currency (with its minor-unit exponent). Money anywhere in this epic is integer minor units plus an ISO-4217 code, never a bare number.

## UX & Interaction Patterns

- **Employees is the directory surface.** A list of up to ten thousand people with search and row-to-detail navigation, plus an "Add employee" entry point. Data tables paginate — infinite scroll is banned.
- **The employee form is a keyboard-first side panel**, not a full page: a dialog with an accessible name that takes focus on open, traps Tab while open, and returns focus to the invoking control on close, Esc included. Modal stacking is at most one level deep. Enter submits, Esc cancels.
- **Role, level, country, and gender render as selects over reference-table values.** Country is editable only on create; on edit it is present but not changeable. Currency is shown as following from country, never chosen independently.
- **This is the first surface with a search field**, so it is where the `/`-focuses-search shortcut is implemented — including the guard that it is inactive while focus sits in an editable field.
- **It is also likely the first form to need input primitives the app shell does not already build.** Any copied-in primitive must be re-pointed at the generated design tokens rather than shipping its own color variables or dark-mode block; hard-coded color values fail the token lint and the no-hex test. Watch the input border contrast when an input sits on a base or tinted surface rather than a card.
- **Standing patterns apply.** Flat surfaces with hairlines and no shadows; skeleton hairline rows instead of spinners; mono numerals right-aligned in columns; no red/green semantics, no error styling, no notification affordances, no celebration; announcements ride the single app-level polite live region.
- **Vocabulary.** Use the spec's words — reference tables, as-of date, rejected, reason.

## Cross-Story Dependencies

- Depends on Epic 1 in full: the layered source tree and import-boundary rule, the schema with reference tables and append-only enforcement, the money/currency primitives and formatter, the generated tokens, the app shell with sidebar and global as-of control, and the CI gate set.
- Overlaps with Epic 2 on the write funnel and the typed salary-record port. Whichever epic lands first builds them; the other extends rather than duplicates.
- The frontend story is blocked on the backend story's finalized boundary payload.
- Epic 4 (record a salary change) and Epic 12 (seed) write through the same funnel and inherit the currency-from-country and no-future-dating rules established here.
- Every statistical epic depends on this epic honoring the as-of population rule — a salary-less employee created here must not appear in any count.
