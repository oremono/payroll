# Salary Management for ACME HR

Replaces the spreadsheets one HR manager uses to run pay for 10,000 employees across eight countries.
Answers what a spreadsheet cannot: **how does this organization actually pay people?** The hardest
question in that set — _are we paying them fairly?_ — is the one it was built around.

|                |                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live app**   | <https://acmesalary.vercel.app/>                                                                                                             |
| **Video demo** | <https://drive.google.com/file/d/1wkTKj10-Cefhx3v3F22EcspRg4wHAN12/view>                                                                      |
| **Scale**      | 10,000 seeded employees · 8 countries · 8 currencies · 25 roles · 6 levels                                                                   |
| **Tests**      | 1,630 unit tests in 5.0 seconds, plus integration, browser, and accessibility suites                                                         |
| **History**    | 193 incremental commits                                                                                                                      |
| **Built with** | TypeScript on Node 24 · Next.js 16 (App Router) · React 19 · PostgreSQL 18 via Prisma · Tailwind 4 · Vitest and Playwright · Vercel and Neon |

No third-party component library.

---

## Where to find what

| Looking for                                             | Where                                         |
| ------------------------------------------------------- | --------------------------------------------- |
| The problem being solved                                | [§1](#1-the-problem)                          |
| What the software does                                  | [§2](#2-what-it-does)                         |
| Requirements: goal, scope, what I left out and why      | [§3](#3-what-i-deliberately-left-out-and-why) |
| Architecture decisions, trade-offs, what each one cost  | [§4](#4-the-decisions-that-shaped-it)         |
| Code structure                                          | [§5](#5-how-the-code-is-organized)            |
| Tests, and how I know they mean something               | [§6](#6-how-i-know-it-works)                  |
| How I used AI, and how to read the commits              | [§7](#7-how-the-work-was-done), in full at [METHOD.md](docs/METHOD.md)                |
| What is missing, and what I would do next               | [§8](#8-known-gaps-and-what-comes-next)       |
| The planning and design artifacts                       | [§9](#9-artifact-index)                       |
| Running it locally, the seed, CI, deployment            | [docs/ENGINEERING.md](docs/_ENGINEERING.md)   |

---

## 1. The problem

10,000 salaries. Many countries, many currencies. All of it in spreadsheets.

The tedium is not the cost. Three questions cannot be answered at all:

- Is anyone badly out of line with their peers?
- Are men and women paid differently for the same job?
- Who has not had a raise in two years?

Each takes an analyst about a week. The answer is stale by the time it arrives, and nobody can
reproduce how it was reached.

So she stops asking. That is the real failure — not slow answers, but unasked questions.

---

## 2. What it does

Eleven capabilities, in-depth specified in [SPEC.md](docs/specs/spec-payroll/SPEC.md).

### Get the data in

| She can                               | How                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Load the whole org from a spreadsheet | Upload a CSV. Valid rows import. Bad rows are rejected one at a time, each with its reason, and never block the good ones. |
| Add or edit one employee              | A form. Role and level come from fixed lists. No free text.                                                                |
| Record a raise                        | Two fields, about thirty seconds. Appends to history. Never overwrites.                                                    |

### Ask questions about pay

| She asks                                               | She gets                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| _Is anyone paid far from their peers?_                 | A list, unprompted, on the home page. Each finding names the person, their peer group, its size, and their distance from its median. |
| _How far is "far"?_                                    | A threshold she controls, default 20%. The boundary is exact: 19.9% does not flag, 20.1% does.                                       |
| _Where does this person sit?_                          | Their peer group's median, its spread, and their signed distance from it — in one sentence she can paste into Slack.                 |
| _Are men and women paid differently for the same job?_ | The gap between male and female medians inside a peer group.                                                                         |
| _Where are the women in this org?_                     | Gender counts at every level, org-wide. Catches clustering the peer view cannot see, because the peer view controls level away.      |
| _What do we spend on salary?_                          | Totals per country in local currency. Any total spanning currencies shows the rate used and the date it was pinned to.               |
| _Who is overdue for a review?_                         | Everyone whose last salary change predates a period she picks, with the date of that change.                                         |

### See the history

| She can                           | How                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Read anyone's full salary history | Every record in order, each with amount, currency, and effective date. Nothing was ever edited, so the history is the truth. |
| Take the answer with her          | Copy the verdict sentence, or export the list as CSV.                                                                        |

---

## 3. What I deliberately left out, and why

The one-page requirements document, written before any code:
[**brief.md**](docs/planning-artifacts/briefs/brief-payroll-2026-07-16/_brief.md). It fixes the goal,
the scope, and the exclusions. [SPEC.md](docs/specs/spec-payroll/SPEC.md) is the machine-readable
version everything downstream was built from.

**In scope:** everything in [§2](#2-what-it-does), plus the seed script for 10,000 employees.

**Out, and why:**

| Excluded                               | Reason                                                                                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication and permissions**     | Deferred, not dismissed. The assessment names one user, so there is no second role to model yet. This is the one exclusion that must be reversed before the product touches a real salary record.                                                                |
| **Employee and manager self-service**  | One user. Anything else is a different product.                                                                                                                                                                                                                  |
| **Equity, bonus, and benefits**        | Compensation components are not interchangeable and vary sharply by country. Base salary is one honest, comparable unit. A mixed bundle compared across countries is an invisible error.                                                                         |
| **Payroll execution**                  | This manages salaries. Money never moves.                                                                                                                                                                                                                        |
| **Future-dated and scheduled changes** | A salary change is recorded when it takes effect. Scheduling implies an approval workflow, also out.                                                                                                                                                             |
| **Mobile layout**                      | She does this work at a desk. Below 1280px the layout degrades gracefully. No phone design was specified.                                                                                                                                                        |
| **Changing an employee's country**     | A recorded narrowing of the brief, not an oversight. Country is part of peer identity and sets currency. Changing it would silently move someone between peer groups and break the currency on records already written. Needs a mobility feature to do properly. |

---

## 4. The decisions that shaped it

Three shaped everything else. Each cost something, and naming the cost is the point — a decision with
no downside is usually an opinion.

Full reasoning in
[TRADE-OFFS.md](docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/_TRADE-OFFS.md);
the structure they produced is drawn in
[C4-MODEL.md](docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/_C4-MODEL.md).

| Decision                                                                                                                                                                                                                 | Why                                                                                                                                                             | What it cost                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The database computes nothing the user sees.** No `percentile_cont`, no `AVG`. Every median, distance, gap and total is computed in TypeScript.                                                                        | Two implementations of "median" drift apart, and the SQL one cannot be unit-tested or mutation-tested. One canonical function means one definition of fairness. | The app loads rows Postgres could have aggregated. Comfortably fast at 10,000 employees. Well beyond that, this is the first thing to revisit.                    |
| **Salary history is append-only, enforced by the database.** `UPDATE` and `DELETE` are revoked from the app's role, and a trigger blocks them for _every_ role including the owner.                                      | An audit trail maintained by discipline is not an audit trail. Correcting a salary means appending a record. There is no other path, even by accident.          | Test data cannot be cleaned up. The integration suite leaves its rows behind by design, so it runs against a disposable database with uniquely suffixed fixtures. |
| **Next.js 16 as one full-stack deployable, on Postgres 18.** Server components read through use-cases in-process. Mutations are server actions. Only four HTTP route handlers exist — one CSV upload, three CSV exports. | One deployable, one language, one type system from database row to rendered cell. No API layer to keep in sync with itself.                                     | Ties the product to one framework's conventions. Reads happen in-process, so there is no HTTP API another client could use.                                       |

---

## 5. How the code is organized

Four layers. Dependencies point inward. Nothing points back out.

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

Five layers, each buying something different.

| Layer                                                                        | Covers                                                                                                      | Buys                                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Unit** — `npm run test`                                                    | The pure core and the use-cases. 62 files, **1,630 tests, 5.0 seconds.** No database, no clock, no network. | Fast enough to run on every save, so it gets run. Deterministic, so a failure always means something.                       |
| **Coverage floors** — `npm run test:coverage`                                | 100% on `src/domain`, 90% on `src/application`.                                                             | An untested branch cannot land in the core. A new untested file fails the floor instead of vanishing from the report.       |
| **Mutation testing** — `npm run test:mutation`                               | Stryker mutates `src/domain`. A surviving mutant fails the build.                                           | The real test of the tests. Coverage proves a line ran. Mutation proves an assertion would have caught it being wrong.      |
| **Integration** — `npm run test:integration`                                 | The database's own guarantees, against a real disposable Postgres 18. Never a mock.                         | Proves the append-only revoke and trigger hold, the positive-amount checks fire, and migrations apply cleanly.              |
| **Browser + accessibility** — `npm run test:browser:db`, `npm run test:a11y` | Real pages against real rows, plus an axe pass for WCAG 2.2 AA.                                             | Proves the surfaces work end to end and the product is usable by keyboard and screen reader. Any violation fails the build. |

CI runs all of it as five gates: `Lint · Typecheck · Build · Unit + Coverage`,
`Mutation testing (domain)`, `Integration (Postgres 18)`, `Accessibility (axe)`,
`Browser + DB (Postgres 18)`. A failing gate blocks the merge.

The tests use the product's vocabulary — `peerGroup`, `peerMedian`, `distancePct`, `refusal` — so a
test name states a rule about fairness, not a fact about a function.

---

## 7. How the work was done

AI did most of the typing. I made the decisions, and nothing was coded before it was specified.

**→ [docs/METHOD.md](docs/METHOD.md)** is the full account: every stage, the tools, the actual
prompts, and how TDD was enforced rather than requested.

### Reading the commits

193 commits. Conventional prefixes (`feat`, `fix`, `test`, `docs`, `ci`, `chore`), one capability at
a time, backend before frontend.

The test harness came first. Story 1-2 added the gates one at a time — import-boundary lint
(`8a6cf70`), the coverage floor (`a5e6503`), mutation testing (`f89e0d2`), accessibility (`efba311`)
— so the bar existed before there was anything to hold to it.

**Worked example — CAP-1, bulk import.** No separate phase for writing tests: each test is committed
red, and the next commit greens it. The backend story finishes before the frontend story starts.

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

Ranked. The first one is what I would build next.

| Gap                                                           | Status                                                                                                                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No authentication.** Anyone with the URL sees every salary. | Must be reversed before this touches real data. Out of scope because the assessment names one user, not because the problem is absent.                                                                    |
| **Everything is computed fresh, nothing is cached.**          | Correct at 10,000 employees, where a full sweep is fast. Beyond that, caching is the first optimization, and the port boundary makes it a local change.                                                   |
| **Exchange rates are pinned, not live.**                      | Deliberate. A moving rate makes yesterday's total irreproducible. The pinned rate and its date show wherever a converted figure appears. A live feed would have to store the rate per calculation anyway. |
| **Country cannot be changed on an existing employee.**        | A recorded deviation — see [§3](#3-what-i-deliberately-left-out-and-why). Needs a mobility feature that decides what happens to historical currency.                                                      |
| **Interaction cost was never tuned.**                         | No pass was made over clicks-per-task. Changing the as-of date on Home takes two clicks — open the control, then pick a date — where one would do. That control sits on every screen and she uses it constantly, so it is the first place to look.                                                                               |
| **Numbers are tables, not charts.**                           | Salary history and peer comparison are read as rows. A timeline chart would make a flat stretch obvious at a glance, and a distribution plot would place someone against their peers without arithmetic. The pulse bars on Gender Insights and Payroll Totals are currently the only charts in the product.                      |
| **No mobile layout.**                                         | Below 1280px the layout degrades gracefully. No phone design was specified.                                                                                                                               |
| **No observability, rate limiting, or backups.**              | One user, and a population regenerable from one command. Revisit when this holds data that is not reproducible.                                                                                           |

---

## 9. Artifact index

In the order they were produced. Read top to bottom and you can follow the thinking from problem to
deployed product.

**Requirements**

- [`brief.md`](docs/planning-artifacts/briefs/brief-payroll-2026-07-16/_brief.md) — the one-page
  requirements document. Goal, scope, exclusions with reasoning.
- [`SPEC.md`](docs/specs/spec-payroll/SPEC.md) — the brief distilled into eleven capabilities,
  constraints, and non-goals.

**Design**

- [`EXPERIENCE.md`](docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/_EXPERIENCE.md) — how it
  behaves: information architecture, flows, state patterns, the accessibility floor.
- [`stitch-handoff-prompt.md`](docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/_stitch-handoff-prompt.md)
  — the prompt used to generate the visual mocks.
- [`imports/stitch/`](docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/imports/stitch/) — the
  eleven generated screens, with a manifest.

**Architecture**

- [`MODEL.md`](docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/_C4-MODEL.md) —
  context, container, and component diagrams.
- [`TRADE-OFFS.md`](docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/_TRADE-OFFS.md)
  — the reasoning in prose, including what each decision cost and what was left open.

**Planning**

- [`epics.md`](docs/planning-artifacts/_epics.md) — every requirement inventoried and mapped to an
  epic. Twelve epics: one foundation, then one per capability.

**Implementation**

- [`METHOD.md`](docs/METHOD.md) — how the work was done: every stage, the BMAD skill that ran it, and
  the prompts that specified TDD and code quality.
- [`project-context.md`](docs/_project-context.md) — the eight standing laws every coding session
  inherits.
- [`ENGINEERING.md`](docs/_ENGINEERING.md) — setup, database, CI, and deployment.
