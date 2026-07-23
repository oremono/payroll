# Epic 7 Context: CAP-6 — Outliers & Threshold

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic delivers the unprompted outlier sweep: when Alice opens Home, she sees — without searching — every employee whose salary sits more than the threshold away from their peer-group median, each finding naming its peer group, the group's size, and the signed distance. She can adjust "how far is far" in Settings, defaulting to 20%, applied deliberately. This is the product's reason to exist — the drift check Excel cannot serve — and the whole sweep must be a pure, reproducible function of `(data, threshold, as-of date)` with an exact boundary. It reuses the refusal panel, provenance caption, and copy-answer affordance established in Epic 6, and its "planted outlier surfaced without being searched for" is half of the final end-to-end acceptance check (NFR11b).

## Stories

- Story 7-1: Outliers & threshold backend
- Story 7-2: Outliers & threshold UI

## Requirements & Constraints

- **Unprompted sweep.** Every employee whose distance from their peer median exceeds the threshold is surfaced on Home, one finding per outlier regardless of direction (over or under), each carrying its peer group, the group's size (`n`), and the signed distance.
- **Adjustable threshold.** Default 20%, symmetric (applies both directions as one test). Persisted in the single-row `settings` table (`outlier_threshold_pct`). Changing it requires an explicit **Apply** confirmation — not a live slider.
- **Boundary exactness (NFR6).** The flag tests `|distance| > threshold` strictly: 19.9% does not flag, exactly 20.0% does not flag, 20.1% does. Distance arithmetic is exact decimal/rational over integer minor units, never IEEE float — in a double, 20.05 is 20.049… and would never round up.
- **Reproducibility / determinism (NFR1).** Given fixed data, threshold, and as-of date, the findings list is byte-identical every time. No domain code reads the wall clock, settings, or `Date`.
- **Refusal-worthy groups appear inline.** A peer group with `n < 5` is never silently omitted; it renders as an inline refusal row naming its count, never widened.
- **Findings are never stored.** No materialized outlier table, no cache, no seen/unseen/dismissal/acknowledgement state — the list is recomputed per request and shrinks only when the underlying data changes.
- **Test-first (NFR12 / AD-23).** Domain + application logic written red-before-green; boundary cases (19.9/20.0/20.1, over and under median, thin-group refusal) are the core of the unit suite, which stays fast, clock-free, and DB-free. Backend story is "done" only when domain+application suites are green, at least one adapter integration test runs against a real disposable Postgres 18 (never a mock), and the boundary payload is finalized.

## Technical Decisions

- **Distance is signed for display, absolute for judgement (AD-5).** `d = (salary − median) / median × 100`, in percentage points. Round the **magnitude** half-up to exactly one decimal place, then reapply the sign (so +20.05 → +20.1 and −20.05 → −20.1 symmetrically). The number shown is the number judged. Underpaid employees flag exactly as overpaid ones do — testing a signed `d > threshold` would silently drop every below-median outlier.
- **Threshold is an explicit parameter (AD-19).** It is a required argument to every outlier function. The `settings` row is read **once at the delivery boundary** and passed inward; no domain or application code reads settings. Same discipline as the as-of date (AD-11).
- **One canonical median (AD-3).** Sort ascending by integer minor units; odd `n` → middle element; even `n` → mean of the two middle elements, rounded half-up to the minor unit. The single implementation lives in `src/domain/statistics.ts` — the sweep consumes it, never writes its own.
- **The as-of population defines every peer group (AD-16).** An employee is in the population at date `D` iff `hire_date ≤ D` and at least one salary record has `effective_from ≤ D`. The peer group is every population member sharing `(role, level, country)`, including the employee. `n` is that exact set's cardinality — the same set the median was computed over, never a separate `COUNT`. The sweep must select the identical set CAP-5's card would, or the two would answer and refuse the same group.
- **`n ≥ 5` refusal (AD-16).** A group under 5 refuses its finding row, naming `n`; never widened.
- **Current salary resolution (AD-8).** Current salary = record with greatest `(effective_from, seq)` where `effective_from ≤ as-of`; `seq` is the `BIGSERIAL` tie-break, never `created_at`. Consume the one shared current-salary resolver.
- **SQL computes no statistic (AD-2).** The database selects rows; every median, distance, and count reaching the user is computed in-process in `src/domain/`. No `percentile_cont`, `AVG`, or domain-value window functions.
- **Currency isolation & money type (AD-4).** No comparison crosses a currency; all distances are within a group's single currency. Money is `{ amountMinor: bigint, currency }`, serialized as a decimal string at any boundary. Median is non-zero (salary `> 0`) and the group is non-empty, so the distance division is total.
- **Answers carry receipts (AD-20).** Each finding leaves the application layer as a discriminated union `{ kind: 'answer' | 'refusal', … }` carrying value **and** provenance (group definition, `n`, as-of date, currency, and the threshold it was judged against) in one object. The verdict sentence is composed by the single `src/domain/verdict.ts` function and consumed unmodified by both the findings row and copy-answer. A refusal is a return value with its counts, never an exception.
- **Delivery boundary (AD-21).** Home findings are read by an RSC calling the use-case in-process (no self-fetch); the Settings threshold Apply is a Server Action; CSV export of the findings list is one of the two permitted Route Handlers. Vocabulary is the SPEC's verbatim: `outlier`, `threshold`, `distancePct`, `peerMedian`, `refusal` — banned: `snapshot`, `compaRatio`, `payBand`.

## UX & Interaction Patterns

- **Findings list (Home, DR8).** Fresh every visit — pure function of data + threshold + as-of. No seen/unseen/dismissal state. Each finding row: employee name, role · location, right-aligned peer count, right-aligned outlier badge. Sticky caps header; 2px rules divide peer-group sections. Refusal-worthy groups render inline as refusal rows.
- **Outlier badge (DR4).** Small rectangular amber stamp (near-sharp corners), text always carrying signed distance + direction word: `+28.4% above median` / `−25.2% below median`. One badge per finding, either direction. Amber means "beyond the threshold," never error — it appears iff distance exceeds the configured threshold. The indigo `in range` counterpart marks non-outliers. No red/green semantics; direction lives in words, never color alone.
- **Threshold control (Settings, DR10).** Labeled `OUTLIER THRESHOLD`, default 20%, symmetric; explicit **Apply** confirmation (deliberate act, kept off the sweep), not a live slider. Boundary exact.
- **Zero-findings state.** "No outliers beyond 20% as of {date}. Nothing is drifting." Calm body text — the sweep's payoff, no celebration graphics, no emoji, no notification affordances (banned everywhere).
- **Recompute behavior.** Changing threshold or as-of date swaps values in place (never back to skeleton) and announces via a single app-level `aria-live=polite` region ("Findings updated as of {date}") that is not remounted by the change. Refusal rows render as a region with a heading, never `role="alert"`, never error styling.
- **CSV export (DR16).** Secondary ghost button on the Findings list header; exports the visible list at the current as-of date and threshold; columns carry currency and as-of/provenance fields.
- **Copy-answer (DR7, from Epic 6).** Copies the single verdict sentence with receipts as plain text, announced through the polite live region with a non-color-only confirmation.

## Cross-Story Dependencies

- **Backend before frontend (AD-24).** Story 7-2 (UI) must not start until 7-1 (backend) is done: domain+application suites green, one real-Postgres adapter integration test green, and the AD-20 finding payload finalized. The frontend consumes that fixed payload and adds nothing to the contract.
- **Depends on Epic 6 (CAP-5).** Reuses the shared median, current-salary resolver, verdict composer, `n ≥ 5` refusal semantics, and the refusal-panel / provenance-caption / copy-answer components introduced there. The outlier distance is the same signed-distance math CAP-5's card renders.
- **Depends on Epic 1 foundation.** The `settings` table + row, generated design tokens (amber/indigo), app shell, global as-of control, and CI gates (import-boundary lint, coverage floor, domain mutation testing) must be in place.
- **Feeds NFR11b (final acceptance).** Verified after Epics 6, 7, and 12 together: a planted outlier (needs this sweep + the Epic 12 seed) is surfaced without being searched for, and a thin peer group is refused out loud.
