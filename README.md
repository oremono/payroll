# Salary Management for ACME HR

Salary software for one person: the HR manager of a 10,000-employee company spread across eight
countries. It replaces her spreadsheets, and it answers what they cannot — **how does this
organization actually pay people?** The hardest question in that set, *are we paying them fairly?*,
is the one it was built around.

| | |
| --- | --- |
| **Live app** | <https://acmesalary.vercel.app/> |
| **Video demo** | _To be added._ |
| **Scale** | 10,000 seeded employees · 8 countries · 8 currencies · 25 roles · 6 levels |
| **Tests** | 1,630 unit tests in 5.0 seconds, plus integration, browser, and accessibility suites |
| **History** | 193 incremental commits |
| **Built with** | TypeScript on Node 24 · Next.js 16 (App Router) · React 19 · PostgreSQL 18 via Prisma · Tailwind 4 · Vitest and Playwright · deployed on Vercel and Neon |

There is no third-party component library. The components are hand-built against design tokens
generated from [`DESIGN.md`](docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/DESIGN.md), so
no color is ever hard-coded and the design document cannot drift from the code. See
[§4](#4-the-decisions-that-shaped-it).

To run it locally, see [docs/ENGINEERING.md](docs/ENGINEERING.md) — setup, the database, and
`npm run seed` for the 10,000-employee population. Or just open the live link, which is already
populated.

---

## Where to find what

Everything the assessment asks for has one home. This table is the map.

| What you are looking for | Where |
| --- | --- |
| The problem being solved | [§1](#1-the-problem) |
| What the software does | [§2](#2-what-it-does) |
| Requirements: goal, scope, what I left out and why | [§3](#3-what-i-deliberately-left-out-and-why) |
| Architecture and design decisions | [§4](#4-the-decisions-that-shaped-it) |
| Architecture diagrams | [C4-MODEL.md](docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/C4-MODEL.md) |
| Trade-off explanations | [§4](#4-the-decisions-that-shaped-it), in full at [TRADE-OFFS.md](docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/TRADE-OFFS.md) |
| Performance considerations | [§4](#4-the-decisions-that-shaped-it) (what each decision costs) and [§8](#8-known-gaps-and-what-comes-next) (where it stops scaling) |
| Code structure | [§5](#5-how-the-code-is-organized) |
| Tests, and how I know they mean something | [§6](#6-how-i-know-it-works) |
| How I used AI | [§7](#7-how-the-work-was-done) |
| Design work done before building | [§7](#designing-before-building) |
| How the commit history reads | [§7](#reading-the-commits) |
| What is missing, and what I would do next | [§8](#8-known-gaps-and-what-comes-next) |
| Every planning and design artifact | [§9](#9-artifact-index) |
| Running it locally, the 10,000-employee seed, CI and deployment | [docs/ENGINEERING.md](docs/ENGINEERING.md) |

---

## 1. The problem

ACME's HR team keeps salary data for 10,000 people in spreadsheets. The people are spread across
many countries, so the data spans many currencies.

The tedium is not the real cost. The real cost is that some questions cannot be answered at all.
*Is anyone badly out of line with their peers? Are men and women paid differently for the same job?
Who has not had a raise in two years?* Each of those takes a competent analyst a week of manual
work. By the time the answer arrives it is out of date, and nobody can reproduce how it was
reached.

So the HR manager stops asking. That is the actual failure — not slow answers, but unasked
questions.

This product exists to make those questions cheap enough to ask on a Tuesday morning.

---

## 2. What it does

Below is what the HR manager can do, written as the questions she can now ask — because that is how
she thinks about them. Together these are the eleven capabilities specified in
[SPEC.md](docs/specs/spec-payroll/SPEC.md); the eleventh is the 10,000-employee seed, documented in
[docs/ENGINEERING.md](docs/ENGINEERING.md#seeding).

### Get the data in

| She can | How |
| --- | --- |
| Load the whole org from a spreadsheet | Upload a CSV. Valid rows import. Bad rows are rejected one by one, each with its reason, and never block the good ones. |
| Add or edit one employee | A form. Role and level come from fixed lists — never free text. |
| Record a raise | Two fields and about thirty seconds. It appends to history; it never overwrites. |

### Ask questions about pay

| She can ask | And gets |
| --- | --- |
| *Is anyone paid far from their peers?* | A list, unprompted, on the home page. Each finding names the person, their peer group, the group's size, and how far from the median they sit. |
| *How far is "far"?* | A threshold she controls. It defaults to 20%. The boundary is exact: 19.9% does not flag, 20.1% does. |
| *Where does this person sit?* | Their peer group's median, its spread, and their signed distance from it — in one sentence she can paste into Slack. |
| *Are men and women paid differently for the same job?* | The gap between male and female medians inside a peer group. |
| *Where are the women in this org?* | Gender counts at every level, org-wide. This catches clustering that the peer view is structurally blind to, because the peer view controls level away. |
| *What do we spend on salary?* | Totals per country in local currency. Any total that spans currencies shows the exchange rate used and the date it was pinned to. |
| *Who is overdue for a review?* | Everyone whose last salary change predates a period she picks, with the date of that change. |

### See the history

| She can | How |
| --- | --- |
| Read anyone's full salary history | Every record, in order, each with its amount, currency, and effective date. Nothing has ever been edited, so the history is the truth. |
| Take the answer with her | Copy the verdict sentence, or export the list as CSV. |

---

## 3. What I deliberately left out, and why

I wrote a one-page requirements document before writing any code:
**[brief.md](docs/planning-artifacts/briefs/brief-payroll-2026-07-16/brief.md)**. It fixes the goal,
the scope, and the exclusions. [SPEC.md](docs/specs/spec-payroll/SPEC.md) is the machine-readable
version that everything downstream was built from.

**In scope:** employee records with role, level, country, currency, gender and hire date · role and
level as fixed reference tables · salary as append-only effective-dated history · create and edit
employees · record salary changes · bulk import · peer comparison · outlier surfacing · gender gap
within peer groups · gender distribution across levels · payroll totals by country and org-wide ·
the minimum-peer-group refusal · a seed script for 10,000 employees.

**Out, and why:**

| Excluded | Reason |
| --- | --- |
| **Employee and manager self-service** | There is one user. Anything else is a different product. |
| **Authentication and permissions** | Deferred, not dismissed — and the one exclusion that must be reversed before this touches a real salary record. The assessment names a single user, so there is no second role to model yet. See [§8](#8-known-gaps-and-what-comes-next). |
| **Equity, bonus, and benefits** | Compensation components are not interchangeable and vary sharply by country. Base salary is one honest, comparable unit. A mixed bundle compared across countries is an invisible error. |
| **Payroll execution** | This manages salaries. Money never moves. |
| **Future-dated and scheduled changes** | A salary change is recorded when it takes effect. Scheduling implies an approval workflow, which is also out. |
| **Mobile layout** | The user does this work at a desk. Below 1280px the layout degrades gracefully, but no phone design was specified. |
| **Changing an employee's country** | A deliberate narrowing of the brief, not an oversight. Country is part of peer identity and determines currency, so changing it would silently move someone between peer groups and break the currency stored on records already written. It needs a mobility feature to do properly. |

---

## 4. The decisions that shaped it

Three decisions did most of the work. Each cost something, and naming the cost is the point — a
decision with no downside is usually an opinion.

Full reasoning in
[TRADE-OFFS.md](docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/TRADE-OFFS.md).
The structure these decisions produced is drawn in
[C4-MODEL.md](docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/C4-MODEL.md) —
context, container, and component diagrams.

| Decision | Why | What it cost |
| --- | --- | --- |
| **The database computes nothing the user sees.** No `percentile_cont`, no `AVG`. Every median, distance, gap and total is calculated in TypeScript. | Two implementations of "median" drift apart, and the SQL one cannot be unit-tested or mutation-tested. One canonical function means one definition of fairness. | The app loads rows Postgres could have aggregated. At 10,000 employees this is comfortably fast; well beyond it, this is the first thing to revisit. |
| **Salary history is append-only, enforced by the database.** `UPDATE` and `DELETE` are revoked from the app's role, and a trigger blocks them for *every* role including the owner. | An audit trail maintained by discipline is not an audit trail. Correcting a salary means appending a new record — there is no other path, even by accident. | Test data cannot be cleaned up. The integration suite leaves its rows behind by design, so it uses a disposable database and uniquely suffixed fixtures. |
| **Next.js 16 as a single full-stack deployable, on Postgres 18.** Server components read through use-cases in-process; mutations are server actions; only four HTTP route handlers exist — one CSV upload and three CSV exports. | One deployable, one language, one type system from database row to rendered cell. No API layer to keep in sync with itself. | Ties the product to one framework's conventions. Reads happen in-process, so there is no HTTP API another client could use. |

---

## 5. How the code is organized

Four layers. Dependencies point inward, and nothing points back out.

```
src/
  domain/        pure logic — medians, distances, gaps, money, dates
    ↑
  application/   use-cases and the port interfaces they depend on
    ↑
  adapters/      everything with side effects — Prisma, CSV, the clock, randomness
  app/ + ui/     Next.js routes and React components
```

---

## 6. How I know it works

Five layers of checking, each buying something different.

| Layer | What it covers | What it buys |
| --- | --- | --- |
| **Unit** (`npm run test`) | The pure core and the use-cases. 62 files, **1,630 tests, 5.0 seconds.** No database, no clock, no network. | Fast enough to run on every save, so it actually gets run. Deterministic, so a failure always means something. |
| **Coverage floors** (`npm run test:coverage`) | 100% on `src/domain`, 90% on `src/application`. | An untested branch cannot land in the core. New untested files fail the floor rather than vanishing from the report. |
| **Mutation testing** (`npm run test:mutation`) | Stryker mutates `src/domain`. A surviving mutant fails the build. | This is the real test of the tests. Coverage proves a line ran; mutation proves an assertion would have caught it if the line were wrong. |
| **Integration** (`npm run test:integration`) | The database's own guarantees, against a real disposable Postgres 18 — never a mock. | Proves the append-only revoke and trigger actually hold, that positive-amount checks fire, and that migrations apply cleanly. |
| **Browser + accessibility** (`npm run test:browser:db`, `npm run test:a11y`) | Real pages against real rows, plus an axe pass for WCAG 2.2 AA. | Proves the surfaces work end to end, and that the product is usable by keyboard and screen reader. Any accessibility violation fails the build. |

All of it runs in CI as five separate gates: `Lint · Typecheck · Build · Unit + Coverage`,
`Mutation testing (domain)`, `Integration (Postgres 18)`, `Accessibility (axe)`, and
`Browser + DB (Postgres 18)`. A failing gate blocks the merge.

The tests are deliberately readable. They use the same vocabulary as the product — `peerGroup`,
`peerMedian`, `distancePct`, `refusal` — so a test name states a rule about fairness, not a fact
about a function.

---

## 7. How the work was done

I used AI throughout. The interesting part is not that I did, but where I drew the line.

### The order of work

Nothing was coded before it was specified. Each stage produced a committed artifact, which is why
[§9](#9-artifact-index) reads like a timeline.

```
requirements → UX contract → architecture → adversarial review of that architecture
   → epics → a written spec per story → test-first implementation → code review
```

### Who decided what

I made the decisions. AI executed against them.

The decisions are the rows in [§4](#4-the-decisions-that-shaped-it), the eleven capabilities in
[§2](#2-what-it-does), and the exclusions in [§3](#3-what-i-deliberately-left-out-and-why) —
all written down and committed before any code existed. Where a judgment call was genuinely mine to
make (a peer group is five people; an outlier is 20% away; gender is two values), the reasoning is
recorded next to the decision, including what it costs.

### What stopped quality from drifting

Two mechanisms, because intent alone does not survive a hundred sessions.

**A standing set of rules.** [`docs/project-context.md`](docs/project-context.md) states eight laws
that every coding session inherits: test-first, the pure core, exact vocabulary, no salary without a
currency, append-only history, determinism, backend before frontend, and answers that carry their
provenance. They did not have to be re-argued each time, and a session that contradicted one was
required to stop and say so rather than quietly comply.

**Gates that do not negotiate.** Generated code proposes; CI disposes. The import-boundary rule, the
coverage floors, mutation testing, the accessibility pass, and the real-database integration suite
all had to be green. None of them care how the code was written. That is the point — it is the same
bar whether a line was typed or generated.

### Designing before building

Before writing code I mocked all eleven screens in **Google Stitch**
([project](https://stitch.withgoogle.com/projects/17248335032802531831)) — to see the product before
committing to it. Nothing was built one-to-one from it.

The [prompt](docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/stitch-handoff-prompt.md) fixed
everything already decided and marked eight questions `[OPEN]` for the tool to propose. The mocks
were then reconciled against the decision log in
[`reconcile-stitch.md`](docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/reconcile-stitch.md),
which classifies every idea the tool invented as adopt, drop, or neutral, with a reason. The mock
could contribute ideas; it could not smuggle in decisions.

### Reading the commits

193 commits, with conventional prefixes (`feat`, `fix`, `test`, `docs`, `ci`, `chore`), one
capability at a time, backend before frontend.

The test harness came before any feature: story 1-2 added the gates one at a time — import-boundary
lint (`8a6cf70`), the coverage floor (`a5e6503`), mutation testing (`f89e0d2`), accessibility
(`efba311`) — so the bar existed before there was anything to hold to it.

**A worked example — CAP-1, bulk import.** There is no separate phase for writing tests; each test
is committed red and the next commit greens it. The backend story finishes entirely before the
frontend story starts. Key commits from the 25 in the run:

```
── story 2-1 · backend ────────────────────────────────────────────────
a8fad0b  test: pin the import row-validation contract, red
3d66096  feat: validate an import row purely, totally, and in a fixed order
824e380  test: attack the CSV parser adversarially, red
f3c1f52  feat: parse import CSV with containment as a structural property
7d4fb7e  test: prove the write funnel against real Postgres 18, red
d3348cd  feat: land the Prisma write funnel
f8d4f79  feat: land the sanctioned import Route Handler, which never answers 500
── story 2-2 · frontend ───────────────────────────────────────────────
0a463ec  test: pin the import report's pure logic, red
b40f3e3  feat: land the import report's framework-free decisions
cd3a838  test: pin the import surface and the refusal-fill floor, red
b65364a  docs: close story 2-2 and complete Epic 2 (CAP-1 bulk import)
```

Abridged — `git log --oneline --reverse bff1948~1..b65364a` shows all 25.

---

## 8. Known gaps and what comes next

Stated plainly, because a submission that claims to be finished is not credible.

| Gap | Status |
| --- | --- |
| **No authentication.** Anyone with the URL sees every salary. | The one exclusion that must be reversed before this touches real data. Out of scope because the assessment names a single user — not because the problem is absent. This is what I would build next. |
| **Exchange rates are pinned, not live.** | Deliberate. A rate that moves makes yesterday's total irreproducible. The pinned rate and its date are shown wherever a converted figure appears, so the number is always honest about what it is. A live feed would need to store the rate per calculation anyway. |
| **No mobile layout.** | Below 1280px the layout degrades gracefully. No phone design was specified. |
| **Everything is computed fresh, nothing is cached.** | Correct at 10,000 employees, where a full sweep is fast. Well beyond that, caching is the first optimization — and the port boundary makes it a local change. |
| **Country cannot be changed on an existing employee.** | A recorded deviation from the brief, not an oversight — see [§3](#3-what-i-deliberately-left-out-and-why). It needs a mobility feature that decides what happens to historical currency. |
| **No observability, rate limiting, or backups.** | One user, and a population regenerable from one command. Revisit when this holds data that is not reproducible. |

---

## 9. Artifact index

Everything below is committed, in the order it was produced. Read top to bottom and you can follow
the thinking from problem to deployed product.

**Requirements**
- [`brief.md`](docs/planning-artifacts/briefs/brief-payroll-2026-07-16/brief.md) — the one-page
  requirements document. Goal, scope, exclusions with reasoning.
- [`SPEC.md`](docs/specs/spec-payroll/SPEC.md) — the brief distilled into eleven capabilities,
  constraints, and non-goals. Everything downstream was built from this.

**Design**
- [`EXPERIENCE.md`](docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/EXPERIENCE.md) — how it
  behaves: information architecture, flows, state patterns, the accessibility floor.
- [`stitch-handoff-prompt.md`](docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/stitch-handoff-prompt.md)
  — the prompt used to generate the visual mocks.
- [`imports/stitch/`](docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/imports/stitch/) — the
  eleven generated screens, with a manifest.

**Architecture**
- [`C4-MODEL.md`](docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/C4-MODEL.md) —
  context, container, and component diagrams.
- [`TRADE-OFFS.md`](docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/TRADE-OFFS.md)
  — the reasoning in prose, including what each decision cost and what was deliberately left open.

**Planning**
- [`epics.md`](docs/planning-artifacts/epics.md) — every requirement inventoried and mapped to an
  epic. Twelve epics: one foundation, then one per capability.

**Implementation**
- [`ENGINEERING.md`](docs/ENGINEERING.md) — setup, database, CI, and deployment.
