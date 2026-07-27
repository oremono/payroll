# Architecture Trade-offs

Scannable version. Full argument unchanged in [`TRADE-OFFS.md`](TRADE-OFFS.md).

[`ARCHITECTURE-SPINE.md`](ARCHITECTURE-SPINE.md) records decisions. This records *why*, and what was
rejected.

The product questions were already settled before architecture began — peer identity, append-only
history, symmetric outliers, currency isolation, as-of determinism. So most of what follows is not
"what should this do" but **"what could two engineers build from this contract that would disagree?"**

## 1. Functional core, imperative shell

**Decision.** All fairness math in a pure `src/domain/`. No I/O, no clock, no randomness. Postgres,
HTTP, React, the filesystem, the PRNG are adapters. Dependencies point inward, enforced by a CI lint
rule.

**Why.** The SPEC demands "every answer is a function of the data and an as-of date" and "fast,
deterministic tests, no wall clock." That is a description of a pure function. Anything else means
re-establishing purity by discipline for the whole project.

| Rejected | Because |
| --- | --- |
| Layered CRUD with service classes | A service that *can* reach the repository will reach it mid-calculation. One that *can* read the clock will default the as-of date "just this once." Both are invisible in review and fatal to determinism. |
| DDD aggregates with event sourcing | An append-only salary series *is* an event log — but it is the only one this product needs, and it already exists as a table. Projections and replay for a single-user tool over 10,000 rows is ceremony without a payer. |

**Cost.** Every read loads a set into memory. Nothing at 10,000 employees. At 10,000,000 it is the
first thing to revisit — and because the domain never touches SQL, that is a change behind a port,
not a rewrite.

## 2. SQL computes nothing

**Decision.** The database stores rows and selects sets. No median, spread, distance, gap, count, or
total that reaches a user.

**Why.** Postgres `percentile_cont` interpolates continuously. A hand-written TypeScript median picks
or averages discretely. **Both are correct implementations of "the median."** On `[100, 200, 300,
400]` they agree — and they diverge the moment a definition question arises, with nothing in either
codebase announcing the disagreement. Two engineers, one building the peer card and one building the
outlier sweep, ship different answers to the same question and both pass review.

The follow-through matters as much as the ban: **one canonical median, defined exactly once.** Sort by
integer minor units, odd `n` takes the middle, even `n` averages the two middle values rounded
half-up. Three capabilities consume it. No other median may be written.

**Cost.** We give up optimized statistical functions and load full sets. Accepted quickly: correctness
unit-testable in milliseconds beats a query plan at this size.

## 3. Money is integer minor units, never a float

**Decision.** Every value is `{ amountMinor: bigint, currency: string }`. Exponents come from the
currency reference table. Salaries positive by database `CHECK`. Serializes as a decimal string at any
boundary.

Three reasons, in increasing obscurity:

1. **Float drift.** CAP-6 needs an exact boundary — 19.9% no, 20.1% yes. Floats do not do exact.
2. **The exponent.** Hard-coding 100 works perfectly until a JPY salary renders as ¥5,000,000.00.
3. **The `> 0` check** is what makes division by the median total. Without it a peer group could
   produce a zero median, and a domain declared unable to throw would render `Infinity% above median`.

## 4. Symmetry — the bug that survived the first draft

The clearest illustration of why the review gate exists.

**First draft:** distance is `(salary − median) / median`, flag tests that value with a strict `>`.

**That is wrong, and wrong quietly.** `−25.2 > 20` is false. A literal implementation **never flags an
underpaid employee.** Half of CAP-6 disappears. Half the seed's planted outliers become undetectable.
The product's loudest promise — "underpaid and overpaid are the same finding" — inverts. And the demo
still looks fine, because the above-median outliers still show.

Three independent reviewers found it. The corrected rule:

- `d = (salary − median) / median × 100`, in percentage points
- exact decimal arithmetic, never IEEE double — in a double, `20.05` is `20.049999…` and never rounds
  up to flag
- round the **magnitude** half-up to one decimal, then reapply the sign, so `+20.05` and `−20.05`
  round symmetrically
- flag tests `|d| > threshold`, strictly

Two smaller calls ride along. **The number shown is the number judged** — so a badge can never read
`20.0% above median` on a row that flagged at 20.04. And **exactly 20.0 does not flag**: the SPEC
fixes 19.9 and 20.1 and is silent between; strict `>` settles it.

## 5. The five questions UX handed to architecture

| Question | Decision | Reasoning |
| --- | --- | --- |
| Is spread min–max, IQR, or other? | **min–max** | The SPEC already rejected quartiles and standard deviations as unreliable at n = 5–10. Same reasoning kills IQR. min–max is stable at any n and matches what the UI shows, so the stored measure cannot fork from the displayed one. |
| Currency per record, or resolved from country? | **On the record** | An append-only series must carry its own currency. Resolving from `employee.country` at read time means a country change silently rewrites the currency of records written years earlier. |
| What identifies an employee? | **UUIDv7** | Names collide across 10,000 people and change when corrected. v7 over v4 for index locality; over `BIGSERIAL` because the id appears in URLs and a sequential id leaks headcount. |
| Is country validated on import? | **Yes** | Extends the SPEC, with a reason. Country is part of peer identity *and* sets currency. An unknown country creates a peer group of one with no resolvable currency — breaking the n ≥ 5 refusal and currency isolation in the same row. |
| What breaks a same-date tie? | **Insertion sequence** | A `BIGSERIAL` `seq`; greatest `(effective_from, seq)` wins. `created_at` was rejected outright — it reads the wall clock. |

## 6. The holes only an adversary found

An adversarial review was tasked with constructing pairs of units that obey every rule and still build
incompatibly. It produced eighteen. Four became new invariants.

**The as-of population was undefined.** The worst one; it collapsed six separate findings. Nothing
said who is *in* a peer group at a given date. One obedient unit counts everyone matching (role,
level, country) — n = 6, so it answers. Another counts only those with a salary as of that date —
n = 4, so it refuses. **Same group, same date, simultaneously answered and refused** — and the card
prints "Based on 6 peers" above a median computed from 4. Exactly the failure the n ≥ 5 refusal exists
to prevent, reintroduced by an unstated definition.

**The gender gap had no formula.** Five defensible readings — `(m−f)/m`, `(m−f)/f`, `(f−m)/f`, an
absolute money difference, an unsigned magnitude — produce "8%", "−8.7%", or "₹2,00,000" from
identical data. In the sentence she pastes into Slack and stands behind. The male median is now always
the denominator; positive means men are paid more.

**Append-only was a promise, not a gate.** The SPEC's loudest constraint had no enforcement.
`salaryRecord.update()` would compile and pass every test. Meanwhile purity had a lint rule and
randomness had a `Math.random` ban — **the inconsistency was the tell.** `UPDATE` and `DELETE` are now
revoked at the database role.

**Overdue was measured from the wrong date.** Nothing bound its cutoff to the as-of date, so winding
the date back would not reproduce yesterday's list.

## 7. Stack

Versions verified on the web at authoring, not recalled.

| Choice | Weighed against | Why |
| --- | --- | --- |
| **Next.js 16.2.10**, one deployable | Fastify/Express API + React SPA | Two deployables, CORS, duplicated types, and a network hop — for a single-user tool over 10,000 rows. Satisfies the Node/TS *and* React requirement in one surface. |
| **PostgreSQL 18 on Neon** | SQLite on a volume | SQLite is permitted and simpler locally, but Vercel's filesystem is ephemeral and SQLite does not survive it. Neon gives branch-per-PR free. Swappable behind a port, since no domain code touches SQL. |
| **Prisma 7.8.0** | Drizzle | Genuinely close. Prisma won on the declarative schema that doubles as a readable artifact, mature migrate/seed tooling, and `createMany` for the 10k seed. Prisma 7 dropped the Rust engine (14MB → 1.6MB), erasing the main reason to avoid it. |
| **TypeScript 5.9.x** | TypeScript 7.0.2 | 7.0.2 went stable nine days before authoring. Boring technology won. Logged with a revisit condition, not dismissed. |
| **Vitest 4.1.10** | Jest | Vitest over the pure domain: no database, no clock, no network. |

One correction worth recording: the first draft pinned Postgres 17. Neon's default has been **18**
since 2026-06-05. It was the one version flagged as unverified, and it was the one that was stale — a
reasonable argument for verifying rather than flagging.

## 8. Deliberately not decided

- **Authentication.** The only deferral that must flip before real salary data. Trigger is explicit:
  the moment the HR *team* rather than the manager alone is a user.
- **Employee country change.** A recorded *deviation*, not a clean deferral. It is the only thing
  preventing a mixed-currency peer group, and the SPEC promises currency isolation holds
  "structurally rather than by discipline." A guarantee resting on a paragraph rests on discipline.
- **Caching and read models.** Compute fresh, every request. A cache going stale against a changed
  salary reintroduces the exact untrustworthiness this product exists to kill.
- **Observability, rate limiting, backups.** No operational stakes at one user with a population
  regenerable from one command.

## 9. Test-first, backend before frontend

**Test-first is the standard.** Every domain and application unit is written red-before-green. Tests
written after the fact describe the code that exists rather than the behavior that was wanted — they
ratify bugs instead of catching them.

The honest part is enforcement. **CI cannot prove a test was written first** — it only sees the final
tree. So the rule splits:

- Red-before-green ordering → enforced in *review*; the commit sequence has to show it.
- Coverage floor + **mutation testing** → enforced by CI. Mutation testing is the real teeth: a
  surviving mutant is by definition a line no test pins down.

Claiming CI verifies TDD would have been a comfortable overclaim.

**Delivery is vertical slices, backend first.** The alternative — every schema, then every use-case,
then every screen — demonstrates nothing until the end and invites the boundary payload to be designed
twice: once by the backend producing it, once differently by the component consuming it.

"Backend done" is a gate, not a mood: domain and application suites green, **plus** at least one
integration test against a real disposable Postgres 18 — never a mock, because the thing most worth
testing at that seam is whether Prisma and the schema actually agree — **plus** the payload finalized.

**Cost.** A capability briefly has working logic and passing tests but nothing on screen. Mitigated by
keeping slices small.

## 10. How the review changed this document's own claims

The spine was drafted fast, then put through a deterministic lint and five parallel review lenses,
then three further rounds.

The gate found, in the author's own draft:

- an inverted outlier test that would have silently deleted every underpaid finding
- an undefined population that let two capabilities answer and refuse the same group
- an unowned gender-gap formula
- an unenforced append-only guarantee
- a regression introduced *during* the fixes, where the clock ban narrowed from `domain + application`
  to `domain` alone, quietly re-permitting `new Date()` inside use-cases

**None were found by rereading.** All were found by an independent reader with a specific adversarial
brief. That is the reusable lesson, and why the gate is part of the workflow rather than a formality.
