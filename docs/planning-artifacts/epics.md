---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics]
inputDocuments:
  - ../specs/spec-payroll/SPEC.md
  - architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md
  - ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md
  - ux-designs/ux-payroll-2026-07-16/DESIGN.md
  - briefs/brief-payroll-2026-07-16/addendum.md
---

# Salary Management for ACME HR - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Salary Management for ACME HR, decomposing the requirements from the SPEC (the requirements source — this project used the spec-kernel path, not a PRD), the UX design contract (EXPERIENCE.md + DESIGN.md), and the Architecture spine into implementable stories.

**Requirement identifiers are the SPEC's own `CAP-N`.** They are stable across the whole spec ecosystem, and the architecture spine's Capability → Architecture map already binds each one to its governing ADs. Using them as the functional-requirement IDs keeps traceability from story → capability → architecture unbroken.

## Requirements Inventory

### Functional Requirements

Functional requirements are the SPEC's eleven capabilities, verbatim in intent. Each carries its success criterion (the testable bar) and its governing ADs from the spine's Capability → Architecture map.

- **CAP-1 — Bulk import** · HR manager bulk-imports employees and their current salaries from a spreadsheet. *Success:* valid rows land in full; a row whose role, level, or country is absent from the reference tables is rejected and reported per-row with its reason, and the remaining valid rows still import; no row is ever mapped or guessed into a taxonomy value. *Governed by:* AD-4, AD-6, AD-7, AD-18, AD-21.
- **CAP-2 — Employee CRUD** · HR manager creates and edits an employee record individually. *Success:* an employee persists with role, level, country, gender, and hire date; role and level are selectable only from the reference tables; country is set at create and is immutable thereafter (AD-6 deviation). *Governed by:* AD-6, AD-10, AD-16, AD-18, AD-21.
- **CAP-3 — Record a salary change** · HR manager records a salary change for an employee. *Success:* the change appends a new effective-dated record; prior records remain readable and unmodified; current salary resolves to the latest record with `effective_from` on or before the as-of date. *Governed by:* AD-4, AD-6, AD-8, AD-11, AD-18.
- **CAP-4 — Salary timeline** · HR manager sees an employee's full salary timeline. *Success:* every salary record for that employee is listed with its effective date and its currency, ordered in time. *Governed by:* AD-8, AD-11, AD-18.
- **CAP-5 — Peer comparison / refusal** · HR manager sees where an employee sits relative to their peers. *Success:* for a peer group of 5 or more, the view reports the group median, spread (min–max), and this employee's signed distance from the median, all in the group's single currency; below 5 it returns an explicit refusal naming the peer count. *Governed by:* AD-2, AD-3, AD-5, AD-8, AD-9, AD-16, AD-20.
- **CAP-6 — Outliers + threshold** · HR manager is shown, unprompted, employees sitting far from their peer group median, and can adjust how far "far" is. *Success:* employees whose salary differs from their peer median by more than the threshold (either direction, one finding) are surfaced unprompted, each with its group, the group's size, and its distance; threshold defaults to 20% and is adjustable; given a fixed threshold the result is reproducible and the boundary is exact (19.9% no, 20.1% yes). *Governed by:* AD-2, AD-3, AD-5, AD-8, AD-12, AD-16, AD-19, AD-20.
- **CAP-7 — Gender gap / refusal** · HR manager sees whether men and women are paid differently for the same work. *Success:* for a peer group holding 5 or more of each gender, the gap between male and female medians is reported; when either gender is under 5 the view refuses and says which. *Governed by:* AD-2, AD-3, AD-8, AD-9, AD-16, AD-17, AD-20.
- **CAP-8 — Gender by level** · HR manager sees how gender is distributed across levels org-wide. *Success:* gender counts per level are reported across the organization, revealing clustering CAP-7 is structurally blind to. *Governed by:* AD-2, AD-16.
- **CAP-9 — Payroll totals** · HR manager sees what the organization spends on salary. *Success:* per-country totals report in local currency with no conversion; any org-wide total spanning currencies displays the conversion rate used and the date it was pinned to. *Governed by:* AD-4, AD-8, AD-13, AD-16, AD-20.
- **CAP-10 — Overdue for review** · HR manager finds employees who have not had a salary change in a given period. *Success:* given a period, the employees whose most recent salary record predates it are listed with the date of that record, measured from the as-of date. *Governed by:* AD-8, AD-11, AD-16, AD-22.
- **CAP-11 — Seed 10,000** · the system can be populated with 10,000 employees whose data exercises every capability above. *Success:* a single command produces 10,000 employees from a fixed seed, reproducibly, containing comparable peer groups, thin groups (CAP-5 refusal), planted outliers (CAP-6), within-group gender gaps with ≥5 of each gender (CAP-7), and gender clustering across levels (CAP-8). Distribution parameters per companion `addendum.md`. *Governed by:* AD-4, AD-6, AD-7, AD-10, AD-14, AD-18, addendum parameters.

### NonFunctional Requirements

Cross-cutting quality attributes and business rules — from SPEC constraints and the spine's system-wide ADs. These bind every capability, not one.

- **NFR1 — Determinism** · every answer is a pure function of the data and a *supplied* as-of date (and, for CAP-6, the threshold); the same question asked twice returns the same answer; no domain code reads the wall clock. (SPEC; AD-11, AD-19)
- **NFR2 — Currency always visible** · no salary is ever displayed without its currency, anywhere; money is integer minor units + ISO-4217 code, never a bare number or float. (SPEC; AD-4)
- **NFR3 — Currency isolation** · no comparison crosses a currency; FX appears only in aggregate totals spanning countries, at a rate pinned to a date and displayed with the figure. (SPEC; AD-2, AD-13)
- **NFR4 — Append-only history** · no salary is ever overwritten; the salary series is append-only and effective-dated; no future-dating, no scheduled changes, no retroactive correction — enforced by revoked UPDATE/DELETE, not by discipline. (SPEC; AD-18)
- **NFR5 — Fast deterministic tests** · core logic (peer grouping, medians, outliers, gap, thresholds, currency isolation) is covered by unit tests that are fast and deterministic: fixed seed, no dependence on the wall clock, no database. (SPEC; AD-1, AD-2)
- **NFR6 — Boundary exactness** · outlier detection is exact and symmetric: distance in percentage points, magnitude rounded half-up to one decimal then signed, flag tests `|d| > threshold` strictly (19.9% no, 20.0% no, 20.1% yes), in exact decimal arithmetic. (SPEC; AD-5)
- **NFR7 — Refusal over widening** · below the n≥5 threshold the product refuses out loud and never widens the peer group; a refusal is a first-class designed state, styled with the dignity of an answer, never an error. (SPEC; AD-16, AD-20)
- **NFR8 — Reproducible seed** · the 10,000-employee population is byte-reproducible from a fixed seed; `Math.random` is banned repo-wide; the five structural obligations are asserted by tests, not left to the draw. (SPEC; AD-14)
- **NFR9 — Accessibility floor** · WCAG 2.2 AA across the desktop web surface, gated in CI by an automated axe pass; color is never the sole carrier; refusals are announced as content, not `role="alert"`. (EXPERIENCE § Accessibility Floor; DESIGN § Contrast floor)
- **NFR10 — Desktop web surface** · 1280px+ is the primary surface; 768–1279px prioritizes columns and stacks card grids; no mobile layout is specified. (DESIGN § Layout & Spacing; EXPERIENCE Foundation)
- **NFR11a — Deployed** · the product is deployed on the target stack and reachable: Vercel + Neon (Postgres 18), `prisma migrate deploy` at build, Neon branch per PR. *Owned by Epic 1 (story `1-7-deployment-and-environments`).* (SPEC; AD deployment table)
- **NFR11b — Demonstrable end-to-end** · on the deployed instance, a planted outlier is surfaced without being searched for and a thin peer group is refused out loud. *Verified after Epics 6, 7, and 12 — it depends on CAP-5, CAP-6, and the seeded population, so it is a final acceptance check rather than a build task.* (SPEC; AD deployment table)

  > Split from a single NFR11 by correct-course on 2026-07-18 (`sprint-change-proposal-2026-07-18.md`). The original wording bound the full demonstration script to **Epic 1**, which structurally cannot satisfy it: the planted outlier needs CAP-6 (Epic 7) and the seed (Epic 12), and the out-loud refusal needs CAP-5 (Epic 6). Splitting lets each half sit with an epic that can actually meet it. `SPEC.md` line 81 — "The product is deployed and demonstrable" — is unchanged and satisfied by 11a + 11b together.
- **NFR12 — Test-first development** · TDD is the standard — red → green → refactor, tests written before the code they cover; ordering enforced in review, and mechanically backed in CI by a coverage floor on `src/domain` + `src/application` and mutation testing over `src/domain`. (AD-23)

### Additional Requirements

Technical requirements from the Architecture spine that shape stories, especially the foundational epic.

- **Greenfield, no starter kit.** The spine chooses **Next.js 16 App Router as a single full-stack deployable** rather than a named starter template. Epic 1 Story 1 is a hand-scaffolded Next.js project, not a `create-*` clone. (Stack; AD-21)
- **Paradigm scaffold — functional core, imperative shell.** Source tree `src/domain` (pure) ← `src/application` (use-cases, ports) ← `src/adapters` (prisma, csv, clock, prng) ← `src/app`/`src/ui`. Dependencies point inward. (AD-1, Structural Seed)
- **Import-boundary lint gate.** A CI lint rule forbids `src/domain/**` from importing Prisma, Next, `Date`, `Math.random`, or `fs` — must exist before the second feature merges. (AD-1)
- **CI pipeline.** Every push runs lint, typecheck, unit tests, the import-boundary rule, axe, **a coverage floor on `src/domain` + `src/application`, and mutation testing over `src/domain`** (a surviving mutant fails the gate); a failing gate blocks merge. (AD-1, AD-23; NFR9, NFR12)
- **Test-first discipline (TDD).** Every domain and application unit is written red-before-green: a failing test precedes the code that satisfies it. Ordering is enforced in review (the commit sequence must show it — CI cannot prove test-first); the coverage floor and mutation-testing gate above are what CI enforces mechanically. Integration tests (the one place DB access is allowed) run under Vitest, outside the domain suite, which stays clock-free and DB-free. (AD-23)
- **Data model.** `employee` (UUIDv7 id, immutable country), `salary_record` (BIGSERIAL `seq`, `amount_minor > 0` CHECK, `currency_code`, `effective_from` DATE), reference tables (`role`, `level`, `country`, `currency` with minor-unit exponent), `fx_rate (from, to, rate NUMERIC, pinned_on)`, single-row `settings` (`outlier_threshold_pct`, `reporting_currency`). (Structural Seed; AD-4, AD-8, AD-10, AD-13)
- **Repository contract.** `salary_record` exposes only `append` + read; UPDATE/DELETE revoked on that table at the DB role by migration; one write funnel enforces currency-from-country and no-future-dating on form, import, and seed alike. (AD-18, AD-6, AD-7) — *Ruled 2026-07-18: the **typed port** lands with its first consumer (CAP-2/CAP-3), not in Epic 1. Epic 1's obligation here is satisfied by the schema itself: story 1-3 revoked UPDATE/DELETE at the DB role and added an unbypassable trigger, which is the half that could not wait. The write funnel (currency-from-country, no-future-dating) belongs to the same first consumer.*
- **One canonical resolver each.** One median (`src/domain/statistics.ts`), one current-salary resolver (greatest `(effective_from, seq) ≤ asOf`), one verdict-sentence composer (`src/domain/verdict.ts`), one money formatter — no capability writes its own. (AD-3, AD-8, AD-20)
- **Delivery boundary.** RSC reads call use-cases in-process (no self-fetch); mutations are Server Actions; exactly two Route Handlers exist — the CAP-1 multipart upload and CSV export downloads. (AD-21)
- **Answer payloads carry receipts.** Every computed answer crosses the boundary as a discriminated union `{ kind:'answer' | 'refusal', … }` carrying value + provenance (group, n, as-of, currency, threshold, rate+pinned_on) in one object. (AD-20)
- **Deployment.** Vercel + Neon (Postgres 18, pinned across all environments; region `aws-ap-southeast-1` Singapore — Neon has no India region; branch-per-PR); `prisma migrate deploy` at build; seed is an explicit command, never a deploy side effect; no auth (SPEC non-goal, the one deferral that must flip before real data). (Deployment & environments; Deferred)
- **Stack pins (verified 2026-07-17).** Node 24 LTS · TypeScript 5.9 · Next.js 16.2.10 · React 19.2.7 · PostgreSQL 18 (Neon · ap-southeast-1 Singapore) · Prisma 7.8.0 · Tailwind 4.3.2 · shadcn/ui (copy-in) · Vitest 4.1.10 · Playwright. (Stack)

### UX Design Requirements

Actionable UI work items from the UX design contract. DESIGN.md owns look; EXPERIENCE.md owns behavior. Each is specific enough to carry testable acceptance criteria.

- **UX-DR1 — Generated design tokens.** A build step emits the Tailwind theme from DESIGN.md frontmatter — light + `*-dark` paired sets, Hanken Grotesk (UI) / JetBrains Mono (all numerals), the 4px spacing scale, radii. No hex literal in application code; shadcn/ui primitives re-pointed at generated tokens on copy-in. (AD-15; DESIGN Colors/Typography)
- **UX-DR2 — App shell & IA.** Fixed 256px sidebar (Home · Employees · Gender Insights · Payroll Totals · Overdue for Review · Import · Settings, Settings pinned bottom) + fixed 64px header; fluid workspace; landmarks (`nav`/`main`), skip-to-content link, `aria-current="page"` on the active item. (EXPERIENCE IA; Accessibility Floor)
- **UX-DR3 — Global as-of date control.** Persistent header element on every screen, right-aligned, defaulting to today; a single named button opening a date picker; changing it recomputes every view and announces via `aria-live=polite`. Ambient provenance and control at once. (EXPERIENCE IA; `components.as-of-control`)
- **UX-DR4 — Outlier badge.** Amber rectangular stamp; text always carries signed distance + direction word (`+28.4% above median` / `−25.2% below median`); one badge per finding either direction; the indigo `in range` counterpart. Amber appears iff distance exceeds the configured threshold. (DESIGN Components; EXPERIENCE Component Patterns)
- **UX-DR5 — Refusal panel.** Flat neutral tint + hairline, `{rounded.DEFAULT}`; headline + explanation; full-panel and inline-row forms; announced as a region with a heading, never `role="alert"`, never error styling. (DESIGN Components; EXPERIENCE State Patterns; Accessibility Floor)
- **UX-DR6 — Provenance caption.** `body-sm` in ink-muted directly beneath any computed figure (group size, as-of date, currency, pinned rate+date), never separated by more than one line. (DESIGN Components; Trust & Provenance)
- **UX-DR7 — Copy-answer affordance.** Ghost icon button on the peer-comparison card (answer *and* refusal states); copies the single verdict sentence with receipts as plain text; announces "Answer copied" via the polite live region with a non-color-only confirmation. (EXPERIENCE Component Patterns; AD-20)
- **UX-DR8 — Findings list.** Home; fresh every visit (pure function of data + threshold + as-of); no seen/unseen/dismissal state; each finding names its peer group, size, and signed distance; refusal-worthy groups appear inline as refusal rows; sticky caps header, 2px rules dividing peer-group sections. (EXPERIENCE Component Patterns; DESIGN findings-row)
- **UX-DR9 — Salary timeline list.** Employee detail; newest first; effective date + amount-with-currency, derived percent-change chip, `(Hire)` label on the first record; read-only history, no edit affordances on past rows. (DESIGN timeline-list; EXPERIENCE)
- **UX-DR10 — Threshold control.** Settings; labeled `OUTLIER THRESHOLD`, default 20%, symmetric; changing it requires an explicit **Apply** confirmation (not a live slider); exact boundary. (EXPERIENCE Component Patterns; AD-19)
- **UX-DR11 — Overdue period control.** Overdue surface; preset chips 1y / 18mo / 2y / 3y + a custom date field, resolving to the same cutoff; list shows each employee with their most-recent record date. (EXPERIENCE Component Patterns; AD-22)
- **UX-DR12 — Pulse charts.** Compact bar strips (gender-by-level, payroll-by-country); primary/secondary fills, squared ends, no gridlines/legends; static and non-interactive; underlying counts always exposed as a data table. (DESIGN Components; EXPERIENCE Accessibility Floor)
- **UX-DR13 — Employee form & Add-employee panel.** Reference-table selects only (no free text) for role/level; currency follows country; keyboard-first side panel (L2, `role="dialog"`, focus trap + return); fields name, role, level, country, gender, hire date. (EXPERIENCE Component Patterns; Interaction Primitives)
- **UX-DR14 — Record-change form.** Three fields only — effective date (defaulted today), amount, currency (pre-filled from country, validated); Enter saves, Esc cancels; ~30-second task; timeline % change and `(Hire)` derived, not stored. (EXPERIENCE Component Patterns; AD-6, AD-18)
- **UX-DR15 — Import flow & partial-import report.** Upload CSV → per-row report ("9,942 imported · 58 rejected") with per-row reasons; valid rows never blocked by bad rows; report reviewable after completion; whole-file refusal for a malformed/`.xlsx` file. (EXPERIENCE Component/State Patterns; AD-7)
- **UX-DR16 — CSV export.** Secondary ghost button on Findings, Overdue, and Payroll Totals list headers; exports the visible list at the current as-of date and threshold; columns carry currency and as-of/provenance fields. (DESIGN Components; EXPERIENCE)
- **UX-DR17 — State patterns.** Skeleton hairline rows on cold load (no spinners); recompute swaps values in place (never back to skeleton) with an `aria-live` announcement; zero-findings "Nothing is drifting"; zero-overdue and empty/first-run states pointing at Import; wound-back as-of indicator. (EXPERIENCE State Patterns; Accessibility Floor)
- **UX-DR18 — Interaction primitives.** `/` focuses search (focus-scoped); Tab follows reading order; Enter submits / Esc cancels the topmost form; modals one level deep; dialogs trap and return focus. **Banned everywhere:** notification affordances of any kind, red/green semantics, celebration animations, infinite scroll on data tables (paginate), free-text for reference-table fields. (EXPERIENCE Interaction Primitives)
- **UX-DR19 — Visual system foundations.** No shadows (flat broadsheet); hierarchy from tonal layering + hairlines; all numerals in JetBrains Mono right-aligned; badges as near-sharp stamps; light + dark modes both meeting the AA contrast floor. (DESIGN Brand/Elevation/Shapes/Typography)

### FR Coverage Map

Functional requirements are `CAP-N`; each maps to exactly one epic. Epic number = CAP number + 1 (the Foundation epic is Epic 1).

- **CAP-1** → Epic 2 — Bulk import of employees + current salaries, per-row rejection.
- **CAP-2** → Epic 3 — Individual employee create/edit.
- **CAP-3** → Epic 4 — Record a salary change (append-only).
- **CAP-4** → Epic 5 — View an employee's salary timeline.
- **CAP-5** → Epic 6 — Peer comparison (median, spread, distance) or refusal.
- **CAP-6** → Epic 7 — Outlier sweep + adjustable threshold.
- **CAP-7** → Epic 8 — Within-group gender gap or refusal.
- **CAP-8** → Epic 9 — Org-wide gender distribution across levels.
- **CAP-9** → Epic 10 — Payroll totals per country + org-wide converted.
- **CAP-10** → Epic 11 — Overdue-for-review by period.
- **CAP-11** → Epic 12 — Seed 10,000 employees, reproducibly.

**Cross-cutting NFRs** are standing gates established in Epic 1 and enforced in every epic thereafter: NFR1 determinism, NFR2 currency-always-visible, NFR3 currency isolation, NFR4 append-only, NFR5 fast deterministic tests, NFR6 boundary exactness (owned by Epic 7, exercised by Epic 6), NFR7 refusal-over-widening (Epics 6, 8), NFR8 reproducible seed (Epic 12), NFR9 accessibility floor, NFR10 desktop surface, NFR11a deployed (Epic 1) and NFR11b demonstrable-end-to-end (after Epics 6, 7, 12), NFR12 test-first development (TDD — enforced in review, gated in CI by coverage floor + domain mutation testing).

**UX-DR distribution:** DR1 (tokens), DR2 (shell/IA), DR3 (as-of control), DR19 (visual foundations) → Epic 1. DR15 → Epic 2. DR13 → Epic 3. DR14 → Epic 4. DR9 → Epic 5. DR5/DR6/DR7 (refusal, provenance, copy-answer) → introduced Epic 6, reused after. DR4/DR8/DR10/DR16 → Epic 7. DR12 → Epics 9, 10. DR11 → Epic 11. DR17 (state patterns) and DR18 (interaction primitives) are cross-cutting, applied on every surface from Epic 1 onward.

## Epic List

12 epics: one Foundation epic, then one per capability in CAP order. Each capability epic holds a **backend story** (schema/use-case/domain logic, written **test-first** per AD-23 with fast deterministic unit tests, a finalized AD-20 boundary payload, and — where the epic touches persistence — at least one adapter integration test against a real disposable Postgres 18, never a mock) followed by a **frontend story** (its surface, consuming the fixed payload); no frontend story starts before its capability's backend story is done. "Backend done" is a gate: domain + application suites green under AD-23, the integration test green, and the AD-20 payload finalized. (AD-23, AD-24)

### Epic 1: Foundation & Deployable Skeleton

Stand up a deployed, empty-but-real application on the target stack: the functional-core/imperative-shell source tree, CI gates (lint, typecheck, import-boundary rule, axe, coverage floor, and domain mutation testing — the AD-23 gate), the full data model with reference tables and migrations, **the deployment pipeline itself (Vercel + Neon, `prisma migrate deploy` at build, Neon branch per PR)**, the money/currency domain primitives written test-first, the generated design-token system, and the app shell with sidebar IA and the global as-of date control. After this epic Alice can open the deployed app and see the shell; every later epic has a paradigm, a schema, tokens, and a CI pipeline — including the test-first gate — to build into.
**FRs covered:** none directly (foundational). **Enables:** all of CAP-1…CAP-11. **NFRs:** NFR1–5, 9, 10, **11a**, **12** (NFR11b is verified after Epics 6, 7, 12). **UX-DR:** DR1, DR2, DR3, DR19.

> **Story ordering note (correct-course, 2026-07-18).** This description is the source the story rows in `sprint-status.yaml` were derived from, and deployment was originally implicit in the opening clause alone — so the derivation produced no story for it. It is now named as a workstream above. Deployment is sequenced **immediately after the data model (1-3)** rather than at epic end, to de-risk Vercel/Neon provisioning early while the migration work is fresh. Its key remains `1-7-…` because two dozen cross-references already bind `1-4` to the money/currency story; **row order in `sprint-status.yaml`, not the key number, is what determines execution order.**

### Epic 2: CAP-1 — Bulk Import

Alice imports 10,000 employees and their current salaries from a spreadsheet and gets a per-row report: valid rows land in full, unknown role/level/country rows are rejected with their reason, nothing is guessed into a taxonomy value.
**FRs covered:** CAP-1. **UX-DR:** DR15. **Governed by:** AD-4, AD-6, AD-7, AD-18, AD-21.

### Epic 3: CAP-2 — Employee CRUD

Alice creates and edits an employee record individually, choosing role and level only from the reference tables, with country fixed at create.
**FRs covered:** CAP-2. **UX-DR:** DR13. **Governed by:** AD-6, AD-10, AD-16, AD-18, AD-21.

### Epic 4: CAP-3 — Record a Salary Change

Alice records a raise as a new effective-dated record in ~30 seconds; prior records stay untouched; no future-dating.
**FRs covered:** CAP-3. **UX-DR:** DR14. **Governed by:** AD-4, AD-6, AD-8, AD-11, AD-18.

### Epic 5: CAP-4 — Salary Timeline

Alice sees an employee's full salary history, newest first, each record with its effective date and currency; current salary resolves against the as-of date.
**FRs covered:** CAP-4. **UX-DR:** DR9. **Governed by:** AD-8, AD-11, AD-18.

### Epic 6: CAP-5 — Peer Comparison or Refusal

Alice sees where an employee sits against their peers — median, spread, signed distance, all with receipts — or a dignified refusal naming the count when the group is under five. Establishes the reusable refusal panel, provenance caption, and copy-answer affordance.
**FRs covered:** CAP-5. **UX-DR:** DR5, DR6, DR7. **Governed by:** AD-2, AD-3, AD-5, AD-8, AD-9, AD-16, AD-20.

### Epic 7: CAP-6 — Outliers & Threshold

Alice opens Home and sees, unprompted, everyone sitting more than the threshold from their peer median (either direction, one finding each), and can adjust the threshold in Settings with an explicit Apply. The sweep is a pure function of data + threshold + as-of date; the boundary is exact.
**FRs covered:** CAP-6. **UX-DR:** DR4, DR8, DR10, DR16. **Governed by:** AD-2, AD-3, AD-5, AD-8, AD-12, AD-16, AD-19, AD-20.

### Epic 8: CAP-7 — Gender Gap or Refusal

Alice sees whether men and women are paid differently for the same work — the gap between male and female medians within a peer group, or a refusal saying which gender is short.
**FRs covered:** CAP-7. **UX-DR:** DR5 (reused). **Governed by:** AD-2, AD-3, AD-8, AD-9, AD-16, AD-17, AD-20.

### Epic 9: CAP-8 — Gender Distribution by Level

Alice sees how gender is distributed across levels org-wide — the clustering the peer view is structurally blind to.
**FRs covered:** CAP-8. **UX-DR:** DR12. **Governed by:** AD-2, AD-16.

### Epic 10: CAP-9 — Payroll Totals

Alice sees per-country totals in local currency and an org-wide total that shows the conversion rate used and the date it was pinned to.
**FRs covered:** CAP-9. **UX-DR:** DR12, DR16. **Governed by:** AD-4, AD-8, AD-13, AD-16, AD-20.

### Epic 11: CAP-10 — Overdue for Review

Alice finds employees whose most recent salary record predates a chosen period, measured from the as-of date, each listed with that record's date.
**FRs covered:** CAP-10. **UX-DR:** DR11, DR16. **Governed by:** AD-8, AD-11, AD-16, AD-22.

### Epic 12: CAP-11 — Seed 10,000

A single command produces 10,000 employees from a fixed seed, reproducibly, planting the structure that makes every other capability demoable: comparable groups, thin groups, outliers, within-group gender gaps, and gender clustering. Backend-only — no frontend surface.
**FRs covered:** CAP-11. **UX-DR:** none. **Governed by:** AD-4, AD-6, AD-7, AD-10, AD-14, AD-18, addendum parameters.
