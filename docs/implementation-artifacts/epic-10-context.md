# Epic 10 Context: CAP-9 — Payroll Totals

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give Alice a trustworthy view of what the organization spends on salary. Per-country totals report in each country's own local currency with no conversion at all. A single org-wide total that necessarily spans currencies is also shown, but only alongside its receipts: the conversion rate(s) used and the date those rates were pinned to. When the rates needed to convert are missing, the org-wide total refuses out loud rather than inventing a number. This epic delivers the totals domain logic and its boundary payload (backend), then the Payroll Totals surface plus the Home payroll metric that consume it (frontend).

## Stories

- Story 10.1: Payroll totals backend (domain totals, use-case, AD-20 payload, adapter integration test)
- Story 10.2: Payroll totals UI (Payroll Totals surface + Home payroll-by-country pulse/metric)

## Requirements & Constraints

- **Per-country totals never convert.** Each country's total is the sum of its employees' as-of current salaries in that country's single currency, displayed with that currency. No cross-currency arithmetic happens here.
- **Org-wide total spans currencies and must show its receipts.** Any converted figure is displayed with the conversion rate used and the `pinned_on` date it was pinned to; a converted number must never reach the screen without that provenance.
- **Refuse rather than convert on missing rates.** If no rate set is resolvable for the as-of date, or the resolvable set lacks a currency pair the total needs, the org-wide total returns a refusal — not a partial or guessed sum.
- **Determinism.** The totals are a pure function of the data and the supplied as-of date; the same question returns the same answer, and no domain/application code reads the wall clock.
- **Currency always visible; money is exact.** Every amount is integer minor units plus an ISO-4217 code — never a bare number or float. Minor-unit exponent comes from the currency reference table (JPY has 0, not 2).
- **As-of population defines every figure.** Totals, headcounts, and per-country membership count only the as-of population (employee hired on/before the date with at least one salary record effective on/before it) — never the raw table.
- **Test-first, fast and DB-free domain.** Totals logic is covered by unit tests with a fixed as-of date, no clock, no database. Backend is "done" only when domain + application suites are green, at least one adapter integration test runs against a real disposable Postgres 18 (never a mock), and the AD-20 payload is finalized.
- **CSV export** of the visible Payroll Totals list at the current as-of date, with currency and as-of/provenance columns present.

## Technical Decisions

- **Totals live in `src/domain` (functional core).** The database stores rows and selects sets; it computes no total that reaches a user. No `SUM`/`AVG` producing a domain value — totals are summed in-process. Domain code may not import Prisma, Next, `Date`, `Math.random`, or `fs`.
- **FX model (`fx_rate` table).** Columns `from_currency, to_currency, rate NUMERIC, pinned_on DATE`. A **rate set** is all rows sharing one `pinned_on`; that column is the set's identity and a set is written whole or not at all. A conversion resolves the set with the greatest `pinned_on ≤ as-of date`. Rate arithmetic is decimal, never float.
- **Org-wide total computation order is fixed.** Sum each country's salaries in its own currency → convert each country total once → sum the converted totals. Never per-employee conversion. Rounding is half-up to the target currency's minor unit at the final step only. This fixed order guarantees two implementations can't sum to different answers.
- **Reporting currency is explicit.** The org-wide target is `settings.reporting_currency` (single-row settings table); there is exactly one and it is never inferred from the data.
- **Current-salary resolution.** Use the one canonical resolver: current salary = the record with the greatest `(effective_from, seq)` where `effective_from ≤ as-of date`; `seq` (BIGSERIAL) breaks same-date ties; `created_at` is never a tie-break. No capability writes its own `ORDER BY`.
- **Money primitive & serialization.** `{ amountMinor: bigint, currency: string }`; at any JSON/Server Action boundary `amountMinor` serializes as a decimal string, never a JS number or raw bigint. Rendered only through the single money formatter that requires both fields.
- **Answer payload carries its receipts (AD-20).** The result crosses the application boundary as a discriminated union `{ kind: 'answer' | 'refusal', ... }` in one object, carrying the value plus provenance: as-of date, currency, and — for the org-wide total — every rate used with its `pinned_on`. The resolved rate and `pinned_on` travel in the domain payload, not merely in a UI caption. A refusal is a return value, never an exception, and names why (e.g. `no rate set as of D`).
- **Delivery boundary.** RSC reads call the totals use-case in-process (no self-fetch). CSV export is served by one of the two allowed Route Handlers.

## UX & Interaction Patterns

- **Payroll Totals surface + Home metric.** A sidebar "Payroll Totals" screen shows per-country totals in local currency and the org-wide total with its pinned-rate-and-date caption; Home shows headline total payroll with the same pinned-rate caption plus a payroll-by-country pulse.
- **Provenance caption.** Directly beneath any computed figure, in muted small body text, within one line: currency on every amount, the as-of date, and for the converted total the pinned rate and its date (e.g. `converted at rates pinned 01 Jul 2026`). Never separated from its number by more than one line.
- **Pulse charts (payroll-by-country).** Compact bar strips, primary/secondary fills, squared ends, no gridlines or legends beyond a caps label; static and non-interactive; the underlying per-country counts/totals must always be exposed as a real data table (accessibility floor — color is never the sole carrier).
- **Refusal state.** When the org-wide total can't be converted, render the refusal as a flat neutral panel/region with a heading — never `role="alert"`, never error styling; a refusal is styled with the dignity of an answer.
- **CSV export affordance.** Secondary hairline ghost "Export CSV" button at the right end of the Payroll Totals list header.
- **Numerals.** All amounts/counts/dates-in-data set in the monospace numeric face, right-aligned in columns; locale grouping (including Indian lakh/crore) is the formatter's job, driven by the currency table.
- **Accessibility.** WCAG 2.2 AA; recompute on as-of change swaps values in place and announces via the app-level `aria-live=polite` region (no re-suspend to skeleton).

## Cross-Story Dependencies

- **Frontend (10.2) depends on backend (10.1).** No frontend work starts until "backend done" gate is met and the AD-20 payload is finalized; the UI consumes the fixed payload and adds nothing to the contract.
- **Depends on Epic 1 foundation:** the data model (`salary_record`, `fx_rate`, `settings.reporting_currency`, currency reference table with minor-unit exponents), the canonical current-salary resolver and money formatter, design tokens, app shell/IA, and the global as-of date control.
- **Reuses the provenance caption and refusal panel** introduced in Epic 6, and the pulse-chart pattern shared with Epic 9 (Gender Distribution).
- **Requires FX rate data and a populated multi-country payroll** — meaningfully exercised against the Epic 12 seeded 10,000-employee population.
