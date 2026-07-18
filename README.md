# Payroll — Salary Management for ACME HR

A Next.js 16 application built on a **functional core / imperative shell** architecture: a pure
`domain`, an `application` layer of use-cases and ports, `adapters` for all I/O, and `app`/`ui`
delivery — with dependencies pointing strictly inward.

This repository is **hand-scaffolded** — not generated from `create-next-app` or any `create-*`
template. See `docs/project-context.md` for the standing engineering Laws and
`docs/planning-artifacts/architecture/` for the architecture spine.

## Prerequisites

- **Node.js 24 LTS** — the pinned runtime. With [nvm](https://github.com/nvm-sh/nvm): `nvm use`
  (reads `.nvmrc`). `package.json` declares `engines.node >=24 <25`.
- **npm** (bundled with Node) — the project uses npm; `package-lock.json` is committed. Do not swap
  in another package manager.

## Install

```bash
npm install
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server at http://localhost:3000 |
| `npm run build` | Production build (`next build`) |
| `npm run start` | Serve the production build (`next start`) |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm run lint` | Lint with the ESLint CLI (`eslint .`) |
| `npm run test` | Run the Vitest unit suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:coverage` | Vitest with the coverage floor on `src/domain` + `src/application` |
| `npm run test:mutation` | Stryker mutation testing over `src/domain` (a survivor fails) |
| `npm run test:a11y` | Playwright + axe accessibility pass over the built app |
| `npm run test:smoke` | Playwright reachability check; set `PLAYWRIGHT_BASE_URL` to probe a deployed URL |
| `npm run test:integration` | Integration suite against a **real** Postgres 18 (see § Database) |
| `npm run db:generate` | Regenerate the Prisma client (also wired to `postinstall`) |
| `npm run db:migrate` | Create + apply a migration locally (`prisma migrate dev`) |
| `npm run db:deploy` | Apply pending migrations (`prisma migrate deploy`) — CI and deploys |

## Database

PostgreSQL **18**, pinned across every environment (Neon in deployed environments, a local
container for development). Prisma **7.8.0** is the ORM.

### Connection strings

Copy `.env.example` to `.env` and fill it in. Two URLs, and the distinction matters:

| Variable | Role | Used by |
| --- | --- | --- |
| `DATABASE_URL` | The **owner** — owns the schema and can create databases | Migrations, `prisma generate`, integration-test fixtures |
| `DATABASE_URL_APP` | `payroll_app`, the **restricted runtime role** — `SELECT`/`INSERT` on `salary_record` but **not** `UPDATE`/`DELETE` | The application at runtime |

They are deliberately different roles. `prisma migrate dev` needs `CREATEDB` for its shadow
database, which the least-privilege runtime role must not have — and the append-only revoke
(Law 5 / AD-18) is meaningless if the app connects as the owner, since PostgreSQL lets a table
owner bypass privilege checks entirely.

> Prisma 7 removed `url` from the `datasource` block. Connection URLs live **only** in
> `prisma.config.ts`, which loads `.env` explicitly (Prisma 7 auto-loads nothing). `prisma migrate
> deploy` has no `--url` flag — CI supplies the URL through the job `env:` block.

### Local setup

```bash
# 1. A disposable Postgres 18
docker run -d --name payroll-pg18 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=payroll \
  -p 55432:5432 postgres:18

# 2. Provision the restricted runtime role (once per cluster; idempotent).
#    The password is required — the script refuses to create a role with a default one, and a
#    re-run with a different password corrects the existing role rather than silently no-opping.
PGPASSWORD=postgres psql -h localhost -p 55432 -U postgres -d payroll \
  -v ON_ERROR_STOP=1 -v payroll_app_password=payroll_app \
  -f prisma/sql/bootstrap-roles.sql

# 3. Apply migrations — this MUST come after step 2. Migrations grant privileges to payroll_app
#    and fail fast with a message naming this file if the role does not exist yet.
npm run db:deploy

# 4. Run the integration suite
npm run test:integration
```

Role creation lives in `prisma/sql/bootstrap-roles.sql` rather than in a migration on purpose:
roles are **cluster-wide** and survive `migrate dev`'s shadow database, so a bare `CREATE ROLE` in
a migration fails on replay with `P3006 role already exists` (prisma/prisma#6581). Only the
`GRANT`/`REVOKE` — idempotent once the role exists — are in the migration.

### Schema and migrations

`prisma/schema.prisma` is the data model; `prisma/migrations/` holds the committed history. Some
invariants cannot be expressed declaratively (Prisma 7.8.0 has no `@@check`, and cannot model
`GRANT`/`REVOKE` or triggers), so they are hand-authored SQL in
`20260718163326_append_only_and_checks`:

- **`salary_record` is append-only** in two layers — the `UPDATE`/`DELETE` revoke from
  `payroll_app`, *and* a `BEFORE UPDATE OR DELETE` trigger that raises for **every** role,
  including the owner. Appending a new record is the only correction mechanism (Law 5 / AD-18).
- **`CHECK (amount_minor > 0)`** — a salary is strictly positive (AD-4).
- **`CHECK (id = 1)` on `settings`** — the single-row guard (AD-19).

The reference tables (`role`, `level`, `country`, `currency`) and `settings` ship **empty**; their
values arrive in Story 1-4.

Deployed environments run `prisma migrate deploy` **at build** — see [§ Deployment &
environments](#deployment--environments).

The generated Prisma client is written to `src/adapters/db/generated/` (git-ignored, and excluded
from ESLint, coverage, Stryker, and `tsc`). The Prisma 7 generator emits TypeScript **source**, so
`prisma generate` must run before `typecheck`/`build` — `postinstall` handles that wherever
`npm ci` runs.

## Continuous Integration

`.github/workflows/ci.yml` runs on every push (any branch) and every pull request to `master`
(Node 24, `npm ci`). A failing gate blocks merge once the checks are marked **required** in branch
protection.

| Gate | Local command | Enforces |
| --- | --- | --- |
| Lint (import-boundary + purity) | `npm run lint` | Layer import direction; the pure-core ban on the clock (`Date`/`performance`), randomness (`Math.random`/`crypto`), `process.env`, dynamic `import()`, and `fs`/Prisma/Next imports (Law 2, Law 6 / AD-1); the repo-wide `Math.random` ban (AD-14, `src/adapters/prng.ts` exempt) |
| Typecheck | `npm run typecheck` | `tsc --noEmit` |
| Build | `npm run build` | The production build compiles — a named gate, not a side effect of another job |
| Unit + coverage floor | `npm run test:coverage` | Fast deterministic unit suite + per-path coverage floors on `domain` (100) and `application` (90) (AD-23) |
| Mutation testing | `npm run test:mutation` | A surviving mutant over `src/domain` fails the build (AD-23) |
| Accessibility (axe) | `npm run test:a11y` | WCAG 2.2 AA floor over the built app; any violation fails (NFR9). Scoped to `e2e/accessibility.spec.ts` — it must **not** widen to other specs |
| Integration (Postgres 18) | `npm run test:integration` | The schema's DB-enforced invariants — append-only `salary_record`, the positive-amount CHECK, single-row `settings` — against a real disposable Postgres 18, never a mock (AD-24) |

**Branch protection:** require these status checks on `master` — **`Lint · Typecheck · Build ·
Unit + Coverage`**, **`Mutation testing (domain)`**, **`Accessibility (axe)`**, and
**`Integration (Postgres 18)`** (the job names in `ci.yml`). Configuring branch protection is a
repository-admin action in GitHub settings, not part of the code.

The `test:mutation` and `test:a11y` gates need extra local setup on first run: Stryker downloads
nothing, but the axe gate needs a browser — run `npx playwright install chromium` once.

`.github/workflows/preview.yml` is a **second, separate** workflow (see [§ Deployment &
environments](#the-preview-pipeline)). It is not part of the required-check set above and must not
be merged into `ci.yml`: the four gates decide merge eligibility, and coupling them to Vercel or
Neon availability would change what they assert. If a deploy check is ever added to branch
protection, update the required-check list above.

## Deployment & environments

Vercel (Next.js preset, Node 24) on top of Neon PostgreSQL **18**, region `aws-ap-southeast-1`.

**Production:** <https://payroll-iota-coral.vercel.app>

| Environment | Trigger | Database |
| --- | --- | --- |
| **Production** | Push to `master` (Vercel's Git integration) | The Neon project's default branch, `production` |
| **Preview** | `.github/workflows/preview.yml` on every PR to `master` | A Neon branch named `pr-<number>`, created per PR and deleted on close |
| **Local** | `npm run dev` | The Docker Postgres 18 on port 55432 (§ Database) |

### Migrations run at build

`vercel.json` sets:

```json
{ "buildCommand": "prisma generate && prisma migrate deploy && next build" }
```

In `vercel.json` rather than the dashboard Build Command, so the deploy contract is reviewable in
the diff instead of living as invisible project state. `prisma generate` appears here **as well as**
in `postinstall`, and both must stay: Vercel restores `node_modules` from cache *before* install, so
an unchanged lockfile means `postinstall` never fires while `schema.prisma` has changed — the
documented "outdated Prisma Client" failure. `postinstall` remains because CI, local installs, and
`npm ci --omit=dev` all depend on it.

`installCommand` is deliberately **not** set: overriding it makes Vercel select the oldest available
package-manager version, and the default `npm install` is what fires `postinstall`.

> **Story 1-5 seam.** The AD-15 design-token build step will need its own stage in `buildCommand`,
> ahead of `next build`. Nothing is built for it here. JSON has no comments, which is why this note
> lives in the README.

### Two URLs, two roles, two endpoints

| Variable | Role | Neon endpoint | Consumed by |
| --- | --- | --- | --- |
| `DATABASE_URL` | `neondb_owner` | **direct** (unpooled) | `prisma.config.ts` → `migrate deploy` at build |
| `DATABASE_URL_APP` | `payroll_app` | **pooled** (`-pooler` in the host) | `src/adapters/db/client.ts` at runtime |

Both differences are correctness constraints, not preferences:

- **Migrations need the direct endpoint.** Neon's pooler runs PgBouncer in *transaction* mode,
  handing a connection to another client between statements. That discards session state —
  including session-level advisory locks, the exact mechanism a migration runner uses to serialize
  itself against a concurrent migrator.
- **Runtime needs the restricted role.** PostgreSQL lets a table owner bypass privilege checks, so
  connecting as the owner would silently reduce the append-only `REVOKE UPDATE, DELETE` to a
  no-op (Law 5 / AD-18). `client.ts` therefore **requires** `DATABASE_URL_APP` with no fallback to
  `DATABASE_URL` — a fallback would restore that silent failure the moment the variable went
  missing.
- **Runtime wants the pooled endpoint**, because every serverless instance otherwise opens its own
  pool. PgBouncer is the real pool; `APP_POOL_MAX` (5) in `client.ts` only bounds the sockets one
  instance opens toward it.

Both carry `sslmode=require` — Neon rejects non-TLS connections outright.

> **`DATABASE_URL` must be a NON-sensitive Vercel variable.** Vercel's *sensitive* environment
> variables are exposed at **runtime only, not to the build step** — and `migrate deploy` runs in
> `buildCommand`. A sensitive `DATABASE_URL` fails the production build with
> `Error: Connection url is empty`, which names neither the variable nor the reason. `vercel env add`
> defaults to sensitive, so pass `--no-sensitive` explicitly:
>
> ```bash
> vercel env add DATABASE_URL production --no-sensitive
> ```
>
> `DATABASE_URL_APP` is read only at runtime, so it should stay **sensitive**. The asymmetry is the
> point: the variable that must be readable at build cannot be sensitive, and the one that must not
> leak should be. (Hit and fixed during Story 1-7.)

### Bootstrap runs once per Neon project, not per branch

`prisma/sql/bootstrap-roles.sql` was run **once** against the `production` branch. It is deliberately
**not** re-run per preview branch: a Neon branch is a copy-on-write clone that inherits its parent's
Postgres roles *and their passwords*, so `payroll_app` already exists, with the same credential, on
every branch.

This is exactly what lets the two-role split survive a branch-per-PR model. Role creation is
cluster-scoped and inherited; the schema-scoped `USAGE`/`GRANT`/`REVOKE` live in the migration and
are re-applied by every `migrate deploy`.

The ordering is unforgiving on a **fresh** project: the `AP002` guard in
`20260718163326_append_only_and_checks` fails `migrate deploy` with `P3018` if `payroll_app` does
not exist yet, leaving the migration history poisoned. Bootstrap first, always.

### The preview pipeline

`.github/workflows/preview.yml`, deliberately separate from `ci.yml` so the four required checks
keep their meaning and merge eligibility never depends on Vercel or Neon being up.

Per PR it creates (or reuses) Neon branch `pr-<number>`, then reproduces `ci.yml`'s integration
sequence **in full and in order** against it — `migrate deploy` → `migrate diff --exit-code` →
`npm run test:integration` — before deploying. Running only the tests would prove nothing about
migrations: the branch is a clone that already carries the parent's schema, so on a PR that *adds* a
migration the suite would exercise a stale schema and the first real `migrate deploy` on Neon would
be the Vercel build, after the gate.

Preview deploys are **CI-driven, not Git-driven.** `vercel.json`'s `ignoreCommand` blocks Vercel's
automatic build for every ref except `master`, so a preview can never start before its Neon branch
and environment variables exist. (Per-branch `git.deploymentEnabled` entries do *not* work for this:
they are an opt-**out** map — unspecified branches default to `true` — so they cannot express
deny-by-default.) Preview values are passed per-deployment via `vercel deploy --build-env` / `--env`
rather than persisted with `vercel env add`, so no per-branch state accumulates in the Vercel
project.

**Branch quota.** Neon caps branches per project (commonly 10 on free plans). Cleanup on PR close is
the primary mechanism; branches also carry a 7-day `expires_at` as a backstop, because the `closed`
event never fires for a git branch deleted outside a PR. To clean up orphans by hand:

```bash
npx neonctl branches list  --project-id "$NEON_PROJECT_ID"
npx neonctl branches delete pr-<number> --project-id "$NEON_PROJECT_ID"
```

### Why the native Neon/Vercel integration is NOT installed

Neither the Neon-managed nor the Vercel-managed native integration is used. It injects its own
`DATABASE_URL` as a **pooled owner** URL, which is wrong on both axes at once — pooled breaks
`migrate deploy`, and owner-at-runtime voids AD-18 layer A. It also **silently overrides** a
deployment's preview environment variables with no failure signal, **fails setup outright** if
`DATABASE_URL` already exists on the project, and cannot express a second role at all. The
Vercel-managed variant additionally ties branch lifetime to Vercel's deployment retention (6 months
by default) rather than to the PR.

### No health-check endpoint

There is none, and none may be added: AD-21 fixes the route-handler count at exactly two (the CAP-1
multipart upload and CSV export), and neither exists yet. Reachability is proven by
`e2e/smoke.spec.ts` against the deployed URL; deployed *database* connectivity is proven by the
preview pipeline running the real integration suite against the Neon branch — a stronger claim than
any health route could make.

## Source tree

```
src/
  domain/        # PURE core — no I/O, no clock, no randomness, no Date, no fs
  application/
    ports/       #   repository, clock, prng, id interfaces
    use-cases/   #   one per capability
  adapters/
    db/          #   Prisma client + repositories (from Story 1-3)
    csv/          #   import parse / export render (Epic 2)
    clock.ts     #   the ONLY Date.now() home (seam)
    prng.ts      #   the ONLY randomness home (seam)
  app/           # Next.js App Router surfaces
  ui/            # components; tokens generated from DESIGN.md (Story 1-5)
prisma/          # schema + migrations + seed (Stories 1-3, 12)
tests/           # domain/application unit tests
```

Each `src/*` layer carries a `README.md` stating exactly what it may import. Dependencies point
inward: `domain ← application ← adapters/ui`. This is mechanically enforced in CI by the
`import/no-restricted-paths` zones and the pure-core purity rules in `eslint.config.mjs` (Story
1-2) — a violating import or a stray `Date.now()` in the core fails `npm run lint`.

## Testing

Vitest is the runner, and there are **two suites, kept deliberately apart**:

- **Unit** (`npm run test`, `vitest.config.ts`, `tests/**`) — the domain/application suite. Touches
  **no database, no clock, and no network**, and follows TDD (red → green → refactor). The coverage
  floor and mutation gate run over this suite only.
- **Integration** (`npm run test:integration`, `vitest.integration.config.ts`,
  `tests/integration/**`) — the one place database access is allowed (AD-24). Runs against a real
  disposable Postgres 18, **never a mock**. Excluded from the unit config's `include`, so
  `npm run test` never touches a database.

The integration suite deliberately does **not** clean up the `salary_record` rows it appends: the
append-only trigger blocks `DELETE` for every role including the owner, which is the invariant
working as designed. Fixture codes are uniquely suffixed per run, and AD-24 specifies a disposable
database.
