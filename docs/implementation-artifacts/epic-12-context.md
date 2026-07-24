# Epic 12 Context: CAP-11 — Seed 10,000

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A single command populates the system with 10,000 employees from a fixed seed, reproducibly, planting the data structure that makes every other capability demonstrable. Random draws from one distribution would produce a demo where every peer group looks alike and no question has an interesting answer; this epic instead engineers a population that exercises comparable peer groups, thin groups (the CAP-5 refusal path), planted outliers (CAP-6), within-group gender gaps with at least five of each gender (CAP-7), and gender clustering across levels (CAP-8). It is backend-only — there is no frontend surface. The population must be byte-reproducible from the seed, and the structural obligations must be proven by tests rather than left to the draw, so the seed itself is a verifiable design artifact.

## Stories

- Story 12.1: Seed population backend

## Requirements & Constraints

- **Reproducible seed (NFR8).** The 10,000-employee population must be byte-reproducible from a fixed seed. `Math.random` is banned repo-wide (lint-enforced). The five structural obligations below are asserted by tests — a seed run that fails to plant any of them fails CI.
- **Determinism (NFR1).** No wall-clock reads anywhere in the seed path; every date and id derives from the seed and fixed constants, not from "now". The same seed produces the same bytes on every run.
- **Single explicit command.** The seed is invoked deliberately (`npm run seed` / `prisma/seed.ts`), never as a deploy side effect. It runs one-time and explicitly in production.
- **Five structural obligations the population must contain and tests must assert:**
  1. Comparable peer groups with enough density that the n ≥ 5 threshold does not starve the demo.
  2. Deliberately thin cells (role × country combinations holding 1–3 people) so the below-threshold refusal path is demonstrable.
  3. Planted outliers — individuals well above and below their peer median, with plausible backstories (e.g. a retention counter-offer; a long-tenured person never adjusted).
  4. Within-group gender gaps — cells where women are paid less at the same role/level/country, each carrying ≥5 men AND ≥5 women (≥10 people, balanced) so the gap is reported, not refused.
  5. Gender clustering across levels — women disproportionately at lower levels (org-wide workforce shape the peer view is structurally blind to).
- **Keep the two gender effects in different cells.** Clustering skews gender by level, and skew is exactly what starves the sub-threshold that within-group gaps need. Seeding both into the same cell cancels them out (a 7:1 cell produces a refusal, not a finding). Plant them in separate cells.
- **Success bar (CAP-11).** One command → 10,000 employees, from a fixed seed, reproducibly, containing all five structures above.

## Technical Decisions

- **Location.** Seed lives in `prisma/seed.ts`, drawing through the application use-cases — it is a *client* of the same write path as import/CRUD, never a privileged one.
- **No privileged write path (AD-7).** The seed passes the same validation every other write passes: role/level/country must exist in the reference tables; nothing is guessed into a taxonomy value; every salary carries an explicit `effective_from`. It creates only (no upsert/merge).
- **Single write funnel enforces currency (AD-6).** `salary_record.currency_code` is written from the employee's country via the country reference table and validated to equal it, in the repository's `append` — the one funnel form, import, and seed all pass through. Country is set at create and is immutable.
- **Append-only, no future-dating (AD-18).** The seed only appends salary records; UPDATE/DELETE are revoked at the DB role. Write-time validation rejects `effective_from > today`, where `today` is the UTC date from the clock port, passed explicitly. This binds the seed as much as the form.
- **Money is integer minor units + currency (AD-4).** Every monetary value is `{ amountMinor: bigint, currency }`; no float, no bare number. `salary_record.amount_minor > 0` is a CHECK and a write-time validation. The minor-unit exponent comes from the currency reference table (never hard-coded 100).
- **Seeded PRNG injected as a port (AD-14).** The generator draws from a seeded PRNG passed in as a port — never `Math.random`. Log-normal draws use Box–Muller over the seeded stream (real salary distributions are right-skewed: a floor below, a long tail above; normal draws erase the mean-vs-median distinction the product should show).
- **Deterministic ids (AD-10).** `employee.id` is a UUIDv7 generated via an id port. In the seed, every UUIDv7 derives from the seeded PRNG and a **fixed epoch** (not the wall clock) — this is what makes a seed run byte-identical across runs.
- **Distribution shape (addendum parameters):**
  - Log-normal *within* each peer group, not normal.
  - Country differentials as **cost-of-labour** multipliers (not cost-of-living) applied to a role/level base — makes the multi-currency story visible.
  - Level progression ~15–20% per level, so the ladder stays coherent and no lower level systematically out-earns a higher one (avoid level inversions).
  - Grid sizing reference: ~25 roles × 6 levels × 8 countries ≈ 1,200 cells for 10,000 employees (~8/cell average). The average lies — real distribution is lumpy; unplanned cells of one occur unless density is deliberately engineered.
- **Tests, not luck (AD-14, AD-23, NFR8).** The five structural obligations are asserted by dedicated seed-obligation tests (in `tests/`). TDD is the standard: red before green. Domain/application logic stays clock-free and DB-free; where the seed touches persistence, at least one adapter integration test runs against a real disposable Postgres 18 (never a mock).
- **Conventions.** Domain functions are total (no throws); use the SPEC's naming vocabulary; dates are calendar `DATE` values, never timestamps.

## Cross-Story Dependencies

- **Depends on Epic 1 foundation:** the data model (`employee`, `salary_record`, reference tables), the append-only migration (revoked UPDATE/DELETE), the money/currency primitives, the PRNG/id/clock ports, and the import-boundary lint gate must exist first.
- **Depends on the shared write funnel:** the seed reuses the same `append` path (and its currency-from-country / no-future-dating validation) established with the first CAP-2/CAP-3 consumer.
- **Enables the demo for downstream capabilities:** the planted structures are what make CAP-5 (refusal), CAP-6 (outliers), CAP-7 (gender gap), and CAP-8 (gender clustering) show something rather than nothing.
- **Gates NFR11b (demonstrable end-to-end):** the final acceptance check — a planted outlier surfaced unprompted and a thin group refused out loud — depends on this seed together with CAP-5 (Epic 6) and CAP-6 (Epic 7).
