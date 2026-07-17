---
title: 'Architecture Trade-offs — Salary Management for ACME HR'
status: final
created: '2026-07-17'
updated: '2026-07-17'
companion_to: ./ARCHITECTURE-SPINE.md
---

# Architecture Trade-offs

The [spine](./ARCHITECTURE-SPINE.md) records decisions. This document records *why*, and what was rejected to get there. It is the argument; the spine is the contract.

Every decision here was made against a contract that had already settled the product questions. [SPEC-payroll](../../../specs/spec-payroll/SPEC.md) fixed peer identity, append-only salary history, symmetric outliers, currency isolation, and the as-of determinism promise before architecture began. That is unusual and it is load-bearing: most of what follows is not "what should this product do" but "what could two engineers build from this contract that would disagree."

---

## 1. The paradigm: functional core, imperative shell

**Decision.** All fairness math lives in a pure `src/domain/` module with no I/O, no clock, and no randomness. Postgres, HTTP, React, the filesystem, the clock, and the PRNG are adapters in the shell. Dependencies point inward, enforced by an import-boundary lint rule in CI (AD-1).

**Why this, and not something else.** The SPEC demands two things that a paradigm can supply for free or fight forever:

> Every answer is a function of the data and an as-of date, never of the moment it was asked.
>
> Core logic … is covered by unit tests that are fast and deterministic: fixed seed, no dependence on the wall clock.

That is a description of a pure function. Choosing anything else means spending the whole project re-establishing purity by discipline.

**Rejected: layered CRUD with service classes.** The default shape of a Node/TypeScript app, and the reason it loses is specific rather than aesthetic. A service that can reach the repository will reach it mid-calculation, and a service that can read the clock will default the as-of date "just this once." Both are invisible in review and both are fatal to the determinism promise. The layered shape doesn't forbid them; this one does, and CI enforces it.

**Rejected: DDD aggregates with event sourcing.** Tempting, because an append-only effective-dated salary series *is* an event log. But it is the only event log this product needs, and it already exists as a table. Full event sourcing would add projections, replay, and eventual consistency to a single-user tool answering questions about 10,000 rows. Ceremony without a payer.

**What this costs.** Every read loads a set into memory rather than pushing work to the database. At 10,000 employees that is nothing. At 10,000,000 it would be the first thing to revisit — and because the domain never touches SQL, revisiting it is a change behind a port rather than a rewrite.

---

## 2. The decision that shaped everything else: SQL computes nothing

**Decision.** The database stores rows and selects sets. It computes no median, spread, distance, gap, count, or total that reaches a user (AD-2).

**Why.** This is the sharpest divergence available in this product, and it is invisible until it bites. Postgres `percentile_cont` interpolates continuously. A hand-written TypeScript median picks or averages discretely. Both are correct implementations of "the median." Given the peer group `[100, 200, 300, 400]`, they agree — but they diverge the moment a definition question arises, and *nothing in either codebase announces the disagreement*. Two engineers, one building the peer-comparison card (CAP-5) and one building the outlier sweep (CAP-6), would ship different answers to the same question and both would pass review.

The follow-through matters as much as the ban: **one canonical median, defined exactly once** (AD-3) — sort by integer minor units, odd `n` takes the middle, even `n` averages the two middle values rounded half-up. Three capabilities consume that number. There is one implementation and no other median may be written.

**What this costs.** We give up the database's optimized statistical functions and we load full sets to compute over them. Accepted without much agonizing: correctness that can be unit-tested in milliseconds beats a query plan for a population this size.

---

## 3. Money: integer minor units, never a float

**Decision.** Every monetary value is `{ amountMinor: bigint, currency: string }`. Minor-unit exponents come from the currency reference table. Salaries are strictly positive by database `CHECK`. At any JSON or Server Action boundary, `amountMinor` serializes as a decimal string (AD-4).

**Why.** Two reasons, one obvious and one not.

The obvious one is float drift. CAP-6 requires an exact boundary — "19.9% does not flag, 20.1% does" — and floats do not do exact.

The non-obvious one is the exponent. A codebase that hard-codes 100 works perfectly until a JPY salary renders as ¥5,000,000.00 instead of ¥5,000,000. The reference table carries the exponent; nothing else may.

The `> 0` check earns its place for a third reason discovered during review: it is what makes AD-5's division by the median total. Without it, a peer group could produce a zero median, and a domain declared unable to throw would render `Infinity% above median`.

---

## 4. Symmetry: the bug that survived the first draft

This one is worth reading carefully, because it is the clearest illustration of why the spine's review gate exists.

The first draft of AD-5 read: distance is `(salary − median) / median`, and the outlier flag tests that value with a strict `>` against the threshold.

That is wrong, and it is wrong quietly. `−25.2 > 20` is false. **A literal implementation never flags an underpaid employee.** Half of CAP-6 disappears; half of the seed's planted outliers become undetectable; and the product's most important promise — "being underpaid and being overpaid are the same finding" — inverts into its opposite. The demo would still look fine, because the above-median outliers would still show.

Three independent reviewers found it. The corrected rule (AD-5):

- distance in percentage points, `d = (salary − median) / median × 100`
- exact decimal or rational arithmetic, never IEEE double — in a double, `20.05` is `20.049999…` and never rounds up to flag
- round the **magnitude** half-up to one decimal, then reapply the sign, so `+20.05` and `−20.05` round symmetrically
- the flag tests `|d| > threshold`, strictly

Two smaller calls ride along. **The number shown is the number judged**: the flag tests the rounded value, so a badge can never read `20.0% above median` on a row that flagged at an unrounded 20.04. And **exactly 20.0 does not flag** — the SPEC fixes 19.9 and 20.1 and is silent between; strict `>` settles it.

---

## 5. The five questions UX handed to architecture

[EXPERIENCE.md](../../ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md) § Notes for Architecture flagged five items rather than inventing answers. Each is now an AD.

| # | Question | Decision | The reasoning that decided it |
|---|---|---|---|
| 1 | Is spread min–max, IQR, or other? | **min–max** (AD-9) | The SPEC already rejected quartiles and standard deviations because they are unreliable at `n = 5–10`. The same reasoning kills IQR. min–max is stable at any `n` and matches what the UI displays, so the stored measure cannot fork from the shown one. |
| 2 | Currency per record, or resolved from country? | **On the record** (AD-6) | An append-only series must carry its own currency. Resolving from `employee.country` at read time means a country change silently rewrites the currency of records written years earlier — history that the SPEC says is immutable. |
| 3 | What identifies an employee? | **UUIDv7** (AD-10) | Names collide across 10,000 people and change when corrected. v7 over v4 for index locality; over `BIGSERIAL` because the id appears in URLs and a sequential id leaks headcount. |
| 4 | Is country validated on import like role and level? | **Yes** (AD-7) | The SPEC mandates rejection only for role and level, so this extends it — with a reason. Country is part of peer identity *and* determines currency. An unknown country creates a peer group of one with no resolvable currency, breaking the `n ≥ 5` refusal and currency isolation in the same row. |
| 5 | What breaks a same-`effective_from` tie? | **Insertion sequence** (AD-8) | A `BIGSERIAL` `seq`; greatest `(effective_from, seq)` wins. `created_at` was rejected outright: it reads the wall clock, which AD-11 forbids. |

Note what #2 costs. EXPERIENCE.md mandates a three-field record-change form including currency. Storing currency on the record does not make that field a free choice — it is pre-filled from the country and validated on submit. A confirmation, not a decision.

---

## 6. The holes only an adversary found

An adversarial review was tasked with constructing pairs of units that obey every AD and still build incompatibly. It produced eighteen. Four mattered enough to become new invariants.

**The as-of population was undefined (AD-16).** The worst one, and it collapsed six separate findings. Nothing said who is *in* a peer group at a given date. One obedient unit counts everyone matching `(role, level, country)` — `n = 6`, so it answers. Another counts only those with a salary as of that date — `n = 4`, so it refuses. The same group, the same date, simultaneously answered and refused; and the card prints "Based on 6 peers" above a median computed from 4. That is precisely the failure the `n ≥ 5` refusal exists to prevent, reintroduced by an unstated definition.

AD-16 now defines the population once (`hire_date ≤ D` **and** at least one salary record with `effective_from ≤ D`), makes `n` the cardinality of that exact set, and binds every user-visible count — including Home's headcount — to it. The `n ≥ 5` refusal moved here too, because it is a property of the population rather than of any one view.

**The gender gap had no formula (AD-17).** CAP-7 was governed only by "there is one median" and "refusals are return values." Five defensible readings — `(m−f)/m`, `(m−f)/f`, `(f−m)/f`, an absolute money difference, an unsigned magnitude — produce "8%", "−8.7%", or "₹2,00,000" from identical data. In the sentence Alice pastes into Slack and stands behind. The male median is now always the denominator; positive means men are paid more.

**Append-only was a promise, not a gate (AD-18).** The SPEC's loudest constraint — *no salary is ever overwritten* — had no enforcement. `salaryRecord.update()` would compile and pass every test. Meanwhile purity had a lint rule, determinism had a clock ban, and randomness had a `Math.random` ban. The inconsistency was the tell. `UPDATE` and `DELETE` are now revoked on `salary_record` at the database role, by migration, and the repository exposes only `append`.

**Overdue was measured from the wrong date (AD-22).** CAP-10 was the last unguarded edge of the determinism promise. Nothing bound its cutoff to the as-of date, so winding the date back would not reproduce yesterday's overdue list. It also settles the hire-only employee explicitly: a hire record *is* a salary record, so someone hired long ago and never adjusted **is** overdue — which is exactly the finding CAP-10 exists to surface.

---

## 7. Stack

Versions were verified on the web at authoring (2026-07-17), not recalled.

| Choice | Alternative weighed | Why this one |
|---|---|---|
| **Next.js 16.2.10**, one full-stack deployable | Separate Fastify/Express API + React SPA | Two deployables, CORS, duplicated types, and a network hop — for a single-user tool over 10,000 rows. Next.js satisfies the JD's Node/TS *and* React requirement in one surface. RSC calls use-cases in-process (AD-21); there is no self-fetch. |
| **PostgreSQL 18 on Neon** | SQLite on a Fly.io/Railway volume | The THA explicitly permits SQLite, and locally it would be simpler. But "deployed and demonstrable" plus Vercel means an ephemeral filesystem, where SQLite does not survive. Neon gives branch-per-PR for free. The cost is one more service; the mitigation is AD-2 — no domain code touches SQL, so the database is swappable behind a port. |
| **Prisma 7.8.0** | Drizzle | Genuinely close. Drizzle is ~7.4kb, SQL-first, better at the edge. Prisma won on the declarative schema file that doubles as a readable artifact, mature migrate/seed tooling, and `createMany` for the 10k seed. Prisma 7 dropped the Rust engine (14MB → 1.6MB), which erased the main historical reason to avoid it. Reversible behind the same port. |
| **TypeScript 5.9.x** | TypeScript 7.0.2 | 7.0.2 went stable on 2026-07-08 — nine days before authoring — with a native Go compiler and ~10× builds. Boring technology won: Next.js 16 does not document a 7.x baseline, and TS 7.1 (~Oct 2026) is what closes the remaining programmatic-API gaps. Logged with a revisit condition rather than dismissed. |
| **Node 24 LTS** | Node 26 | 24 is Active LTS through April 2028. 26 is Current and does not promote until 2026-10-20. |
| **shadcn/ui + Tailwind 4.3.2** | An opinionated component library (MUI, Mantine) | The Equilibrium Finance identity is a flat broadsheet — no shadows, hairline borders, monospaced numerals. That needs unstyled primitives, not a skin to fight. shadcn is copy-in, so there is no runtime dependency imposing its own opinions. Tokens are *generated* from DESIGN.md rather than hand-copied (AD-15), so the visual contract and the stylesheet cannot drift. |
| **Vitest 4.1.10** | Jest | Vitest over the pure domain: no database, no clock, no network. 5.0 is in beta; 4.1 is the stable line. |

One correction worth recording: the first draft pinned Postgres 17. Neon's default for new projects has been **18** since 2026-06-05. It was the one version flagged as unverified, and it was the one that was stale — which is a reasonable argument for verifying rather than flagging.

---

## 8. What was deliberately not decided

The spine's Deferred section is half the contract. The entries that matter:

**Authentication.** A SPEC non-goal, and the only deferral here that must flip before this touches a real salary record. Deferred, not dismissed. The trigger is explicit: the moment the HR *team* rather than the manager alone is a user.

**Employee country change.** A recorded *deviation*, not a clean deferral — the SPEC names country among an edited employee's fields, and this spine makes it immutable after create. That prohibition is binding in AD-6 rather than filed under Deferred, because it is the only thing preventing a mixed-currency peer group, and the SPEC promises currency isolation holds "structurally rather than by discipline." A guarantee resting on a paragraph is resting on discipline.

**Caching and read models.** AD-12 says compute fresh, every request, no materialized outlier table. A cache going stale against a changed salary would reintroduce the exact untrustworthiness this product exists to kill. Revisit only when a sweep is measurably slow well past 10,000 headcount.

**Observability, rate limiting, backup/restore.** No operational stakes at one user with a population regenerable from a single command. Revisit the moment this holds data that is not reproducible.

---

## 9. How the review changed this document's own claims

Worth stating plainly, since the assessment asks how AI was used and whether correctness held.

The spine was drafted fast, then put through a deterministic lint and five parallel review lenses — reconciliation against the SPEC, against the two UX spines, a rubric walk, an independent web re-verification of every version, and an adversarial hunt for AD-obedient-but-incompatible unit pairs. Three further rounds followed.

The gate found, in the author's own draft: an inverted outlier test that would have silently deleted every underpaid finding; an undefined population that let two capabilities answer and refuse the same group; an unowned gender-gap formula; an unenforced append-only guarantee; a stale Postgres pin; and a regression introduced *during* the fixes, where the clock ban was narrowed from `domain + application` to `domain` alone, quietly re-permitting `new Date()` inside use-cases.

None of those were found by rereading. All were found by an independent reader with a specific adversarial brief. That is the reusable lesson, and it is why the gate is part of the workflow rather than a formality at the end.
