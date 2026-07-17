---
project_name: 'payroll'
user_name: 'rk'
date: '2026-07-17'
sections_completed: ['technology_stack', 'the_laws', 'source_tree', 'domain_rules', 'testing', 'delivery_boundary', 'conventions', 'dont_miss', 'workflow']
existing_patterns_found: 0
source_of_truth: '../docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md'
status: 'complete'
rule_count: 8
optimized_for_llm: true
---

# Project Context for AI Agents

_The standing laws for every coding session on this project — attended or unattended. A per-story file briefs you on one story; **this file is the law you inherit regardless**. If a story instruction ever contradicts a Law below, stop and surface it; do not silently follow the story. Rules trace to architecture decisions (`AD-n`) in the [spine](planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md) and constraints in the [SPEC](specs/spec-payroll/SPEC.md); each Law is self-executing — you should not need to open the spine to obey it._

---

## The Laws (non-negotiable)

1. **TDD — no production code without a failing test first.** Red → green → refactor, always in that order. Write the failing test, watch it fail for the right reason, then write the minimum code to pass. This holds from the very first story (the scaffold): the CI pipeline and its gates are themselves built test-first where testable. Domain/application tests are fast and deterministic — no DB, no clock, no network. CI enforces a coverage floor on `src/domain` + `src/application` and **mutation testing** over `src/domain` (a surviving mutant fails the build). CI cannot prove ordering, so honor it in your commit sequence. (AD-23)

2. **Functional core, imperative shell.** `src/domain/**` is PURE: it imports nothing outside `src/domain/**` — no Prisma, no Next, no `Date`, no `Math.random`, no `fs`, no env. Dependencies point strictly inward: `domain` ← `application` ← `adapters`/`ui`. Adapters reach the domain only through ports declared in `src/application/ports/`. **The database stores rows and selects sets; it computes no statistic a user sees** — no `percentile_cont`, no `AVG`, no domain-value window functions. Every median, spread, distance, gap, count, and total is computed in-process in TypeScript. (AD-1, AD-2)

3. **Exact vocabulary, verbatim.** Use the SPEC's words in code, types, and UI copy: `peerGroup`, `peerMedian`, `distancePct`, `outlier`, `threshold`, `refusal`, `salaryTimeline`, `effectiveFrom`, `asOf`, `overdue`. **Banned everywhere (code and copy):** `snapshot`, `compaRatio` / "compa-ratio", `payBand`. Gender values are exactly `MALE` / `FEMALE`.

4. **No salary without a currency.** Every monetary value is `{ amountMinor: bigint, currency: string }` — never a `number`, never a float, never a bare amount at ANY boundary (CSV cell, React prop, JSON, Server Action). The minor-unit exponent comes from the currency reference table, never a hard-coded `100` (JPY has exponent 0). At a JSON/Server-Action boundary, `amountMinor` serializes as a **decimal string**, never a JS number and never a raw `bigint`. There is exactly one money formatter; it requires both fields — a call without a currency must not typecheck. (AD-4)

5. **Salary history is append-only, mechanically.** `salary_record` has no update and no delete path — `UPDATE`/`DELETE` are revoked on the table at the DB role by migration, and the repository port exposes only `append` + read methods. A record with `effective_from > today` is rejected on **every** write path (form, import, seed). Appending a new record dated today is the only correction mechanism. (AD-18)

6. **Determinism: as-of date and threshold are always parameters.** Every domain and application function takes the as-of date (and, for outliers, the threshold) as a required explicit argument. **No code in `src/domain/**` or `src/application/**` calls `Date.now()`, `new Date()`, or reads a timezone** — the clock port is the only source of "now", implemented only in an adapter. "Today" is the current date in **UTC**. Same data + same as-of + same threshold ⇒ identical answer, every time. (AD-11, AD-19)

7. **Deliver backend-before-frontend, one capability at a time.** Within a capability the backend story lands first: domain + application logic, its tests, and its finalized boundary payload (Law: receipts) ship green before any frontend consumes them. The frontend then consumes a fixed payload and adds nothing to the contract. (AD-24)

8. **Answers cross the boundary carrying their receipts.** Every computed answer leaves the application layer as a discriminated union — `{ kind: 'answer', … } | { kind: 'refusal', reason, counts }` — carrying its value AND its provenance in one object: group definition, `n`, as-of date, currency, threshold where one applies, and every FX rate with its `pinned_on` where converted. **A refusal is a return value, never an exception, and carries its counts.** The verdict sentence is composed by exactly one function (`src/domain/verdict.ts`) and consumed unmodified by both the card and copy-answer. (AD-20)

---

## Technology Stack & Versions

Greenfield — no scaffold exists yet (story `1-1` builds it, hand-scaffolded, **not** a `create-*` clone). Pins are fixed; do not upgrade without a decision.

| Tool | Version |
| --- | --- |
| Node.js | 24 LTS |
| TypeScript | 5.9.x (not 7.x — pinned; see spine Deferred) |
| Next.js (App Router) | 16.2.10 |
| React | 19.2.7 |
| PostgreSQL (Neon) | 18 (pinned across all environments); region `aws-ap-southeast-1` (Singapore) — Neon has no India region |
| Prisma ORM | 7.8.0 |
| Tailwind CSS | 4.3.2 |
| shadcn/ui | copy-in; pinned in `components.json` |
| Vitest | 4.1.10 |
| Playwright | 1.5x |

## Source Tree & Boundaries

```
src/
  domain/        # PURE. no I/O, no clock, no random, no Date, no fs (Law 2)
  application/
    ports/       #   repository, clock, prng, id interfaces
    use-cases/   #   one per capability
  adapters/
    db/          #   prisma client + repositories
    csv/         #   import parse, export render
    clock.ts     #   the ONLY Date.now() in the codebase
    prng.ts      #   the ONLY randomness source
  app/           # Next.js App Router surfaces
  ui/            # components; tokens generated from DESIGN.md (never hand-copied)
prisma/
  schema.prisma
  migrations/
  seed.ts        # CAP-11
tests/           # domain unit tests + seed-obligation tests
```

| Layer | May import |
| --- | --- |
| `src/domain/` | nothing outside itself |
| `src/application/` | `domain` |
| `src/adapters/` | `application`, `domain` |
| `src/app/`, `src/ui/` | `application`, `domain` (types only) |

An import-boundary lint rule enforces this in CI and must exist before the second feature merges.

## Domain Rules Agents Get Wrong

- **One canonical median (AD-3):** sort ascending by integer minor units; odd `n` → middle element; even `n` → arithmetic mean of the two middle elements, rounded half-up to the nearest minor unit. Exactly one implementation, in `src/domain/statistics.ts`. Never write a second median. A median of an empty set is never computed.
- **Distance is signed for display, absolute for judgement (AD-5):** `d = (salary − median) / median × 100`, in **exact decimal/rational** arithmetic (never IEEE double — `20.05` is `20.049999…` in a double and would never flag). Round the **magnitude** half-up to one decimal, then reapply the sign. The outlier flag tests `|d| > threshold` **strictly** — `|d| = 20.0` does NOT flag. The number shown is the number judged.
- **Peer group = `(role, level, country)`, derived at read time. Never a table.**
- **The as-of population defines every peer group (AD-16):** an employee is in-population at date `D` iff `hire_date ≤ D` AND at least one salary record has `effective_from ≤ D`. `n` is the cardinality of that exact set (the subject included). **Every user-visible count — including Home's headcount and gender counts — is a count of the population, not of the table.** `n < 5` refuses every comparison, naming `n`; never widen the group.
- **One current-salary resolver (AD-8):** current salary = the record with the greatest `(effective_from, seq)` where `effective_from ≤ asOf`. `seq` is a `BIGSERIAL`; `created_at` may not be a tie-break. One resolver in `src/domain/`; no capability writes its own `ORDER BY`.
- **Gender gap has one formula (AD-17):** `gap = (M − F) / M × 100` (male median is always the denominator; positive means men paid more), rounded like AD-5. Reported only when both genders have `n ≥ 5`; otherwise refuse, naming both counts and which gender is short.
- **Currency lives on the salary record (AD-6):** written from the employee's country at write time and validated to equal it. Never re-resolve currency from `employee.country` at read time. `employee.country` is set at create and is **immutable** — offer no country-edit path.
- **Domain functions are total — they never throw.** Adapters throw; the shell maps to HTTP. Import rejections and refusals are data, never exceptions.

## Testing

- **Vitest.** The domain/application suite touches no DB, clock, or network.
- **Integration tests are separate** and run against a **real disposable Postgres 18** (a Neon branch or local instance) — **never a mock**; this is the one place DB access is allowed, and it lives outside the domain suite so that suite stays clock-free and DB-free.
- **Seed (`prisma/seed.ts`) draws from an injected seeded PRNG** passed as a port; `Math.random` is banned repo-wide by lint. The generated population's structural obligations (comparable groups, thin groups, planted outliers, within-group gender gaps with ≥5 of each gender, cross-level clustering) are **asserted by tests**, not left to the draw. Byte-reproducible from a fixed seed. (AD-14)

## Delivery Boundary (AD-21)

- **Reads:** React Server Components call use-cases directly in-process. Never `fetch` to our own origin.
- **Mutations:** Server Actions.
- **Route Handlers:** exactly two exist — the CAP-1 multipart upload and CSV export downloads. Nothing else gets one.

## Conventions

- DB tables `snake_case` singular; TS files `kebab-case`; types `PascalCase`.
- `effective_from`, `pinned_on`, `hire_date` are calendar dates (`DATE`) — never timestamps, no timezone. The as-of date is a plain-date value object, not a JS `Date`.
- No hex literal in application code — the Tailwind theme is generated from `DESIGN.md` frontmatter (light + `*-dark`); shadcn/ui primitives are re-pointed at generated tokens on copy-in. `DESIGN.md` is the single source of visual truth. (AD-15)
- WCAG 2.2 AA is the floor on every surface, gated by an automated axe pass in CI. Refusal payloads render as a region with a heading, **never** `role="alert"`. Recompute announcements ride one app-level `aria-live="polite"` region that is not remounted by an as-of/threshold change.
- Threshold is persisted data (single-row `settings`), read once at the delivery boundary and passed inward — never read inside the math. Env holds only connection strings and the deploy target.

## Critical Don't-Miss (anti-patterns)

- ❌ `new Date()` / `Date.now()` anywhere in `src/domain` or `src/application` → use the clock port at the boundary.
- ❌ `percentile_cont` / `AVG` / window functions for any user-facing statistic → compute in the domain.
- ❌ A second median, second current-salary resolver, or second verdict sentence → there is exactly one of each.
- ❌ Float for money or FX → integer minor units and decimal/rational rate arithmetic; round half-up at the final step only.
- ❌ Import as upsert → import is **create-only**; the file carries no identity, so re-importing a row creates a second person. CSV only; an `.xlsx` upload is refused as a whole file. Every row needs an explicit `effective_from`; a row without one is rejected, never defaulted. (AD-7)
- ❌ Materializing or caching findings → the sweep computes fresh per request; no outlier table, no dismissal/seen state. (AD-12)
- ❌ A country-edit affordance, or resolving currency at read time → see AD-6.
- ❌ Widening a peer group below `n ≥ 5` → refuse, out loud, naming the count.
- ❌ Per-employee FX conversion, or per-country totals that convert → sum each country in its own currency, convert each country total once, then sum; per-country totals never convert. (AD-13)

## Workflow

- Branch off `master` before committing; keep commits small and incremental — the Incubyte assessment reads commit history and test quality.
- **Definition of done (backend story):** tests written test-first and green; lint, typecheck, import-boundary, axe, coverage-floor, and domain mutation-testing gates all pass; the AD-20 boundary payload is finalized; at least one adapter integration test against real Postgres 18 where the story touches persistence.
- **Definition of done (frontend story):** consumes the fixed backend payload unmodified; adds nothing to the contract; meets the WCAG 2.2 AA floor (axe green + the manual keyboard/screen-reader checks the floor names).

---

## Usage Guidelines

**For AI agents:** Read this file before implementing any code, every session. Follow all Laws exactly; when a story instruction and a Law conflict, stop and surface it rather than comply. When in doubt, prefer the more restrictive option. These Laws are the substrate — the per-story file adds specifics, never exceptions.

**For humans:** Keep this lean and agent-focused. Update when the stack changes or a new invariant is ratified in the [architecture spine](planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md) — the spine's `AD-n` remain the source of truth; this file is their operational projection. Remove rules that become obvious once code exists.

Last Updated: 2026-07-17
