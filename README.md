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

> **Deployed environments** run `prisma migrate deploy` **at build**. Wiring that into Vercel/Neon
> is a later deployment story — the command and the intent are recorded here, the plumbing is not
> built yet.

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
| Accessibility (axe) | `npm run test:a11y` | WCAG 2.2 AA floor over the built app; any violation fails (NFR9) |
| Integration (Postgres 18) | `npm run test:integration` | The schema's DB-enforced invariants — append-only `salary_record`, the positive-amount CHECK, single-row `settings` — against a real disposable Postgres 18, never a mock (AD-24) |

**Branch protection:** require these status checks on `master` — **`Lint · Typecheck · Build ·
Unit + Coverage`**, **`Mutation testing (domain)`**, **`Accessibility (axe)`**, and
**`Integration (Postgres 18)`** (the job names in `ci.yml`). Configuring branch protection is a
repository-admin action in GitHub settings, not part of the code.

The `test:mutation` and `test:a11y` gates need extra local setup on first run: Stryker downloads
nothing, but the axe gate needs a browser — run `npx playwright install chromium` once.

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
