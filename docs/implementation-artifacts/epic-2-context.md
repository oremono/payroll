# Epic 2 Context: CAP-1 — Bulk Import

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the HR manager a way to load an entire payroll — roughly 10,000 employees and their current salaries — from a spreadsheet in one pass, and to learn exactly what did not land and why. Valid rows import in full; a row whose role, level, or country is absent from the reference tables is rejected individually with its reason, and the remaining valid rows still import. Nothing is ever mapped or guessed into a taxonomy value. This is the first capability epic and the first population path into the system: every later surface assumes a directory that this epic fills, and the first-run states across the app point here.

## Stories

- Story 2.1: Bulk import backend
- Story 2.2: Bulk import UI

## Requirements & Constraints

- **Per-row rejection, never per-file.** One bad row must not block the good ones. Each rejected row is reported with its row number, the offending value, and a plain reason naming which reference table it failed against.
- **No guessing.** An unrecognized role, level, or country is a rejection, not a fuzzy match, not a mapping, not a new taxonomy value created on the fly. Unknown country is rejected on the same footing as role and level.
- **Create-only.** Import never upserts and never merges. The file carries no identity, so every valid row creates a new employee — re-importing an already-imported row creates a second person. The correction path is to fix the source and re-import *only* the corrected rows, which the per-row report makes obvious.
- **Explicit effective date required.** Every row must carry an `effective_from` for the salary it lands. A row without one is rejected, never defaulted to today or to the hire date.
- **CSV only.** An `.xlsx` (or otherwise unreadable) upload is refused as a whole file with one statement of what could not be read — the one case where whole-file refusal is correct.
- **Currency is never bare.** Salary amounts are integer minor units plus an ISO-4217 code end to end, including CSV parsing and React props. The minor-unit exponent comes from the currency reference table, never a hard-coded 100. Amounts serialize as decimal strings across any JSON or Server Action boundary.
- **Append-only and no future-dating.** Imported salary records are appended; the write path rejects an effective date later than today (UTC, supplied by the clock port).
- **Test-first with real persistence proof.** Domain and application logic ships red-before-green with fast, DB-free, clock-free unit tests; at least one adapter integration test exercises the real repository against a disposable Postgres 18 — never a mock.
- **Scale.** The importer must handle a ~10,000-row file in one operation without loading behavior that degrades the rest of the app.
- **Accessibility floor.** WCAG 2.2 AA, gated by the automated axe pass; color is never the sole carrier of meaning.

## Technical Decisions

- **One write funnel.** The repository's `append` is the single path all writes pass through — the record-change form, this import, and the seed alike. It enforces currency-from-country and the no-future-dating check. Import does not get a privileged write path; neither does the seed, which is a client of this same use-case.
- **Currency resolved at write time.** `salary_record.currency_code` is derived from the employee's country via the country reference table when the record is written, and validated to equal it. Reads never re-resolve currency. This is why unknown country must be a rejection: it would produce a record with no resolvable currency and a peer group of one.
- **Country is immutable.** It is set at create — here, from the imported row — and no use-case or repository method offers a country update.
- **Delivery boundary.** The multipart spreadsheet upload is one of exactly two Route Handlers that will ever exist in the system (the other is CSV export downloads); this exception wins over the general "mutations are Server Actions" rule. Read surfaces around the import page are Server Components calling use-cases in-process — never a fetch to our own origin.
- **Code placement.** CSV parsing lives in the adapters layer (`adapters/csv`); validation, rejection, and orchestration live in an import use-case in the application layer. The domain layer stays pure — no file, clock, or database access.
- **Backend before frontend.** The UI story does not start until the backend story is green: domain and application suites passing, the integration test passing, and the boundary payload for the import result finalized. The frontend consumes that fixed payload and adds nothing to the contract.
- **Report payload shape.** The import result crosses the boundary as one object carrying the imported count, the rejected count, and the per-row rejections with their reasons — assembled in the application layer, not composed in a React component.

## UX & Interaction Patterns

- **Import surface.** Reached from the sidebar's Import entry. Upload a CSV, then read a report — a two-beat flow, not a wizard.
- **The report is the product.** Headline counts stated plainly ("9,947 rows imported · 53 rows rejected"), with rejected rows in a table carrying row number, the name as it appeared in the file, the offending value, and the reason. The report stays visible and reviewable after completion; it is not a transient toast.
- **Register.** Statements, never celebrations and never alarm. A partial import that tells the whole truth is the designed outcome, not a failure — so no error styling, no warning icons, no red/green semantics. There is no error color in the token system.
- **Whole-file refusal** uses the refusal treatment (flat neutral tint, hairline, heading + explanation, announced as a region with a heading rather than `role="alert"`), not an error banner.
- **First-run states elsewhere point here.** Empty Employees and Home states read as a calm instruction to import a spreadsheet.
- **Standing patterns apply.** Skeleton hairline rows rather than spinners or progress theater; all numerals in the mono numeral styles, right-aligned in columns; flat surfaces with hairlines and no shadows; near-sharp stamps for badges; full keyboard operability of the whole flow; announcements ride the single app-level polite live region.
- **Vocabulary.** Use the spec's words — rejected, reason, reference tables, as-of date. "Snapshot" and "compa-ratio" are banned.

## Cross-Story Dependencies

- Depends on Epic 1 in full: the source tree and layering, the schema with its reference tables and append-only enforcement, the money/currency primitives and formatter, the generated tokens, the app shell and sidebar Import entry, and the CI gate set.
- The typed salary-record repository port and the write funnel (currency-from-country, no-future-dating) were deferred out of Epic 1 to land with their first consumer. If Epic 3 (Employee CRUD) has not landed them, this epic builds them — and every later write path inherits what is built here.
- The frontend story is blocked on the backend story's finalized boundary payload.
- Epic 12's seed population is a client of this epic's import use-case and its validation, not a separate write path.
- Every capability epic that reads a populated directory is exercised in practice by data this epic loads.
