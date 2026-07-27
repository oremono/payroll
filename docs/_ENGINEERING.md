# Engineering Manual — get it running

Scannable version. Full operational detail unchanged in [`ENGINEERING.md`](ENGINEERING.md) — read that
one when something breaks, because it records *why* each of these steps exists.

## Run it locally

**Prerequisites:** Node 24 (`nvm use` reads `.nvmrc`), npm, Docker.

```bash
# 1. Install
npm install

# 2. A disposable Postgres 18
docker run -d --name payroll-pg18 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=payroll \
  -p 55432:5432 postgres:18

# 3. Create the restricted runtime role (once per cluster)
PGPASSWORD=postgres psql -h localhost -p 55432 -U postgres -d payroll \
  -v ON_ERROR_STOP=1 -v payroll_app_password=payroll_app \
  -f prisma/sql/bootstrap-roles.sql

# 4. Copy .env.example to .env, fill in both URLs, then migrate
npm run db:deploy

# 5. Seed 10,000 employees (~4 seconds)
npm run seed

# 6. Run it
npm run dev          # http://localhost:3000
```

**Step 3 is not optional and must come before step 4.** Migrations grant privileges to `payroll_app`
and fail fast, naming the file, if the role does not exist.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` · `build` · `start` | Dev server · production build · serve the build |
| `npm run test` | 1,630 unit tests, ~5 seconds |
| `npm run test:coverage` | Unit tests plus the coverage floors |
| `npm run test:mutation` | Mutation testing over the domain |
| `npm run test:integration` | Against a real Postgres 18 |
| `npm run test:a11y` | axe pass (run `npx playwright install chromium` once first) |
| `npm run lint` · `typecheck` | Layer boundaries, purity rules, types |
| `npm run seed` | 10,000 employees |
| `npm run db:deploy` | Apply pending migrations |

## Two URLs, two roles — and why

| Variable | Role | Endpoint | Used by |
| --- | --- | --- | --- |
| `DATABASE_URL` | owner | **direct**, unpooled | Migrations, at build |
| `DATABASE_URL_APP` | `payroll_app`, restricted | **pooled** | The app at runtime |

Three constraints, none of them preference:

1. **Migrations need the direct endpoint.** The pooler runs in transaction mode and hands a connection
   to another client between statements. That discards session state — including the advisory lock a
   migration runner uses to serialize itself.
2. **Runtime needs the restricted role.** PostgreSQL lets a table owner bypass privilege checks, so
   connecting as the owner silently reduces the append-only `REVOKE` to a no-op. `client.ts`
   **requires** `DATABASE_URL_APP` with no fallback — a fallback would restore that silent failure the
   moment the variable went missing.
3. **Runtime wants the pooled endpoint**, because every serverless instance otherwise opens its own
   pool.

> **`DATABASE_URL` must be a NON-sensitive Vercel variable.** Sensitive variables are exposed at
> runtime only, not to the build — and `migrate deploy` runs in `buildCommand`. A sensitive
> `DATABASE_URL` fails the production build with `Error: Connection url is empty`, which names neither
> the variable nor the reason. `DATABASE_URL_APP` is read only at runtime, so it should stay
> sensitive. **The asymmetry is the point.**

## Append-only, in two layers

`salary_record` cannot be updated or deleted:

1. `UPDATE`/`DELETE` **revoked** from `payroll_app` at the DB role.
2. A `BEFORE UPDATE OR DELETE` **trigger** that raises for **every** role, including the owner.

Appending a new record is the only correction mechanism. Two more invariants live in hand-written SQL
because Prisma cannot express them: `CHECK (amount_minor > 0)`, and `CHECK (id = 1)` on the
single-row `settings` table.

**Consequence for tests:** the integration suite cannot clean up after itself. It leaves its rows
behind by design, uses uniquely suffixed fixtures, and expects a disposable database.

## Seeding

```bash
npm run seed   # 10,000 employees, ~4 seconds
```

An explicit command, **never a deploy or build side effect.** It writes through the same funnel as
every other write path, so it passes the same validation.

**The population is engineered, not random.** Random draws from one distribution produce a database
where every peer group looks alike and no question has an interesting answer. This one is built so
each capability has something to show:

- **Dense peer groups** that compare cleanly.
- **Deliberately thin cells** of 1–3 people, so the refusal path is reachable.
- **Planted outliers** above and below their peer median.
- **Within-group gender gaps**, only in cells holding 5+ of each gender — below that the view refuses
  and the gap would be invisible.
- **Gender clustering across levels**, in *different* cells from the gaps. Clustering skews gender by
  level, and that skew is exactly what starves the five-per-gender threshold. **Seeding both into one
  cell would cancel them out.**

Salaries are drawn log-normally, because real distributions are right-skewed. Country differentials
are cost-of-labour multipliers; levels progress ~15–20% apart so no level out-earns the one above.

Byte-reproducible from a fixed seed, epoch, and as-of date — all committed constants. No wall clock,
no `Math.random`. The five properties above are **asserted by tests**, not left to the draw.

## CI gates

| Gate | Enforces |
| --- | --- |
| **Lint** | Layer import direction; the pure-core ban on clock, randomness, env, `fs` and Prisma; the repo-wide `Math.random` ban |
| **Typecheck / Build** | `tsc --noEmit`; the production build compiles as a named gate |
| **Unit + coverage** | Fast deterministic suite + floors: 100% domain, 90% application |
| **Mutation** | A surviving mutant over the domain fails the build |
| **Accessibility** | WCAG 2.2 AA via axe over the built app; any violation fails |
| **Integration** | DB-enforced invariants against a real disposable Postgres 18, never a mock |
| **Browser + DB** | The directory, detail route and create form against **real rows** |

The preview pipeline is a **separate workflow on purpose.** Merge eligibility must never depend on
Vercel or Neon being up.

## Deployment

Vercel + Neon Postgres 18, region `aws-ap-southeast-1`. Production: <https://acmesalary.vercel.app>

- **Production** — push to `master`.
- **Preview** — a Neon branch `pr-<number>` per PR, deleted on close.
- Migrations run **at build**, via `vercel.json` rather than the dashboard, so the deploy contract is
  reviewable in the diff instead of living as invisible project state.

**Bootstrap runs once per Neon project, not per branch.** A Neon branch is a copy-on-write clone that
inherits its parent's roles *and their passwords*, so `payroll_app` already exists everywhere. That is
what lets the two-role split survive a branch-per-PR model.

**Preview runs are serialized, not cancelled.** A SIGTERM during `prisma migrate deploy` leaves a
failed row in `_prisma_migrations`, and since the branch is reused across pushes, every later run on
that PR then aborts with `P3009`. That wedge is not generically repairable — a cancelled migration
leaves either DDL-not-applied or DDL-applied-but-unrecorded, and the history cannot tell you which.

**The native Neon/Vercel integration is deliberately not installed.** It injects a **pooled owner**
URL, which is wrong on both axes at once: pooled breaks `migrate deploy`, and owner-at-runtime voids
the append-only revoke. It also silently overrides preview environment variables with no failure
signal, and cannot express a second role at all.

## Source tree

```
src/
  domain/        PURE core — no I/O, no clock, no randomness, no Date, no fs
  application/
    ports/       repository, clock, prng, id interfaces
    use-cases/   one per capability
  adapters/
    db/          Prisma client + repositories
    csv/         import parse / export render
    clock.ts     the ONLY Date.now() home
    prng.ts      the ONLY randomness home
  app/           Next.js App Router surfaces
  ui/            components; tokens generated from DESIGN.md
prisma/          schema + migrations + seed
tests/           domain/application unit tests
```

Each `src/*` layer carries its own `README.md` stating exactly what it may import. Dependencies point
inward: `domain ← application ← adapters/ui`. **Mechanically enforced in CI** — a violating import or
a stray `Date.now()` in the core fails `npm run lint`.
