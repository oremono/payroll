# Project Context — the standing laws

Scannable version. Full text unchanged in [`project-context.md`](project-context.md).

The law every coding session inherits, attended or unattended. A per-story file briefs you on one
story; **this is the law you inherit regardless.** If a story instruction contradicts a Law, stop and
surface it. Do not silently follow the story.

## The 8 Laws

| # | Law |
| --- | --- |
| **1** | **TDD — no production code without a failing test first.** Red → green → refactor, always in that order. Domain and application tests are fast and deterministic: no DB, no clock, no network. CI enforces a coverage floor and **mutation testing** over the domain. CI cannot prove ordering — honor it in your commit sequence. |
| **2** | **Functional core, imperative shell.** `src/domain/**` is PURE: no Prisma, no Next, no `Date`, no `Math.random`, no `fs`, no env. Dependencies point inward. **The database computes no statistic a user sees** — every median, spread, distance, gap, count, and total is computed in TypeScript. |
| **3** | **Exact vocabulary, verbatim.** Use the SPEC's words in code, types, and copy: `peerGroup`, `peerMedian`, `distancePct`, `outlier`, `threshold`, `refusal`, `salaryTimeline`, `effectiveFrom`, `asOf`, `overdue`. **Banned:** `snapshot`, `compaRatio`, `payBand`. Gender is exactly `MALE` / `FEMALE`. |
| **4** | **No salary without a currency.** Every value is `{ amountMinor: bigint, currency: string }` — never a number, never a float, never a bare amount at any boundary. The exponent comes from the currency table, never a hard-coded `100` (JPY is 0). One formatter; a call without a currency must not typecheck. |
| **5** | **Salary history is append-only, mechanically.** No update path, no delete path. `UPDATE`/`DELETE` revoked at the DB role by migration; the port exposes only `append` + reads. A record dated in the future is rejected on **every** write path. Appending a record dated today is the only correction. |
| **6** | **Determinism: as-of and threshold are always parameters.** No code in `domain` or `application` calls `Date.now()`, `new Date()`, or reads a timezone. The clock port is the only source of "now", implemented only in an adapter. Same data + same as-of + same threshold ⇒ identical answer. |
| **7** | **Backend before frontend, one capability at a time.** Domain, application logic, tests, and the finalized boundary payload ship green before any frontend consumes them. The frontend consumes a fixed payload and adds nothing. |
| **8** | **Answers carry their receipts.** Every answer leaves as `{ kind: 'answer', … }` or `{ kind: 'refusal', reason, counts }`, carrying value **and** provenance in one object: group, `n`, as-of, currency, threshold, FX rate with `pinned_on`. **A refusal is a return value, never an exception.** One function composes the verdict sentence. |

## Source tree and boundaries

```
src/
  domain/        PURE. no I/O, no clock, no random, no Date, no fs
  application/
    ports/       repository, clock, prng, id interfaces
    use-cases/   one per capability
  adapters/
    db/          prisma client + repositories
    csv/         import parse, export render
    clock.ts     the ONLY Date.now() in the codebase
    prng.ts      the ONLY randomness source
  app/           Next.js App Router surfaces
  ui/            components; tokens generated from DESIGN.md
```

| Layer | May import |
| --- | --- |
| `src/domain/` | nothing outside itself |
| `src/application/` | `domain` |
| `src/adapters/` | `application`, `domain` |
| `src/app/`, `src/ui/` | `application`, `domain` (types only) |

An import-boundary lint rule enforces this in CI.

## Domain rules agents get wrong

- **One canonical median.** Sort ascending by integer minor units. Odd `n` → middle element. Even `n`
  → mean of the two middle, rounded half-up. Exactly one implementation, in
  `src/domain/statistics.ts`. **Never write a second median.**
- **Distance is signed for display, absolute for judgment.** `d = (salary − median) / median × 100`,
  in **exact decimal arithmetic** — never IEEE double, where `20.05` is `20.049999…` and would never
  flag. Round the magnitude half-up to one decimal, then reapply the sign. The flag tests
  `|d| > threshold` **strictly**: `|d| = 20.0` does NOT flag. **The number shown is the number
  judged.**
- **Peer group = `(role, level, country)`, derived at read time. Never a table.**
- **The as-of population defines every peer group.** In-population at date `D` iff `hire_date ≤ D`
  AND at least one salary record has `effective_from ≤ D`. `n` is the cardinality of that exact set.
  **Every user-visible count — including Home's headcount — counts the population, not the table.**
- **One current-salary resolver.** The record with the greatest `(effective_from, seq)` where
  `effective_from ≤ asOf`. `created_at` may not be a tie-break. No capability writes its own
  `ORDER BY`.
- **One gender-gap formula.** `gap = (M − F) / M × 100` — the male median is always the denominator,
  positive means men paid more. Reported only when both genders have `n ≥ 5`.
- **Currency lives on the salary record**, written from the country at write time and validated to
  equal it. **Never re-resolve from `employee.country` at read time.** Country is immutable after
  create — offer no country-edit path.
- **Domain functions are total — they never throw.** Adapters throw. Refusals and import rejections
  are data, never exceptions.

## Delivery boundary

- **Reads:** React Server Components call use-cases directly, in-process. **Never `fetch` to our own
  origin.**
- **Mutations:** Server Actions.
- **Route Handlers:** the CAP-1 multipart upload and CSV export downloads. Nothing else gets one.

## Testing

- **Vitest.** The domain/application suite touches no DB, clock, or network.
- **Integration tests are separate**, against a **real disposable Postgres 18** — never a mock. The
  one place DB access is allowed, kept outside the domain suite so that suite stays clock-free.
- **The seed draws from an injected seeded PRNG.** `Math.random` is banned repo-wide by lint. The
  population's structural obligations are **asserted by tests**, not left to the draw.

## Anti-patterns — the don't-miss list

- ❌ `new Date()` / `Date.now()` in `domain` or `application` → use the clock port at the boundary.
- ❌ `percentile_cont` / `AVG` / window functions for a user-facing statistic → compute in the domain.
- ❌ A second median, current-salary resolver, or verdict sentence → there is exactly one of each.
- ❌ Float for money or FX → integer minor units; round half-up at the final step only.
- ❌ Import as upsert → import is **create-only**. The file carries no identity, so re-importing a row
  creates a second person. CSV only; `.xlsx` is refused as a whole file. Every row needs an explicit
  `effective_from` — a row without one is rejected, never defaulted.
- ❌ Materializing or caching findings → the sweep computes fresh per request. No outlier table, no
  seen/dismissed state.
- ❌ A country-edit affordance, or resolving currency at read time.
- ❌ Widening a peer group below `n ≥ 5` → refuse, out loud, naming the count.
- ❌ Per-employee FX conversion → sum each country in its own currency, convert each country total
  once, then sum. Per-country totals never convert.

## Conventions

- DB tables `snake_case` singular. TS files `kebab-case`. Types `PascalCase`.
- `effective_from`, `pinned_on`, `hire_date` are calendar dates — never timestamps, no timezone. The
  as-of date is a plain-date value object, not a JS `Date`.
- **No hex literal in application code.** The Tailwind theme is generated from `DESIGN.md`
  frontmatter, which is the single source of visual truth.
- WCAG 2.2 AA on every surface, gated by axe in CI. Refusals render as a region with a heading,
  **never** `role="alert"`.
- Threshold is persisted data, read once at the delivery boundary and passed inward — **never read
  inside the math.**

## Done means

**Backend story:** tests written test-first and green · lint, typecheck, import-boundary, axe,
coverage-floor and domain mutation gates all pass · the boundary payload finalized · at least one
integration test against real Postgres 18 where the story touches persistence.

**Frontend story:** consumes the fixed backend payload unmodified · adds nothing to the contract ·
meets the WCAG 2.2 AA floor.
