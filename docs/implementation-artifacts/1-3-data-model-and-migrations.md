---
baseline_commit: 83fd9ab087535722e87c34aaed3b9d4d680ce8f6
---

# Story 1.3: Data Model and Migrations

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the ACME HR engineering team,
I want the full PostgreSQL 18 data model authored in Prisma 7 — `employee`, `salary_record`, the reference tables (`role`, `level`, `country`, `currency`), `fx_rate`, and single-row `settings` — with append-only mechanically enforced on `salary_record` (UPDATE/DELETE revoked, `amount_minor > 0` CHECK) and a real-Postgres integration-test harness,
so that every capability epic thereafter reads and writes against one canonical schema whose invariants (Laws 4, 5, 6) are enforced by the database and proven by tests, not by developer discipline.

## Context & Scope

This is the **third story of Epic 1 (Foundation & Deployable Skeleton)**. Story 1-1 stood up the source tree and left `prisma/` an empty seam; Story 1-2 turned the standing rails into mechanical CI gates and **explicitly handed "the adapter integration-test harness against real Postgres 18" to this story** (1-2 out-of-scope table; AD-24). This story is where **persistence first appears** — so it both authors the schema and establishes the integration-test pattern (real disposable Postgres 18, never a mock) that every later backend story's "Definition of Done" depends on.

**After this story:** `prisma migrate deploy` produces the complete schema; `salary_record` physically rejects `UPDATE`/`DELETE` and non-positive amounts; a Prisma client singleton lives in `src/adapters/db/`; the unit suite stays DB-free while a **separate** integration suite exercises the real schema in CI against a Postgres 18 service. Story 1-4 (money/currency primitives) and every capability epic land on this schema.

### In scope (this story)

- **Prisma 7.8.0 install** — `prisma` (CLI, devDep) + `@prisma/client` + **`@prisma/adapter-pg`** (all three, **exact** pins). Prisma 7 requires a driver adapter; `new PrismaClient()` without one does not connect. See Dev Notes → *Prisma 7 mechanics* — **this story's single largest trap is that Prisma 7 moved the connection URL out of `schema.prisma` entirely.**
- **`prisma.config.ts` at the repo root** — Prisma 7's `datasource` block no longer accepts `url`. Connection URLs (`url`, and `shadowDatabaseUrl` if needed) live in `prisma.config.ts`, which must also `import "dotenv/config"` because Prisma 7 **does not auto-load `.env`**.
- **The complete schema** — all eight tables with the exact columns, types, keys, and FK relations in Dev Notes → *Schema*: `employee`, `salary_record`, `role`, `level`, `country`, `currency`, `fx_rate`, `settings`. `snake_case` singular table names (via `@@map`), the `MALE`/`FEMALE` gender enum, `DATE` columns for `hire_date`/`effective_from`/`pinned_on`, `BIGSERIAL` `seq`, app-generated UUID `employee.id` (no DB default — the id port owns generation).
- **Append-only enforced at the DB, in two layers (Law 5 / AD-18)** — a migration that **revokes `UPDATE`/`DELETE` on `salary_record` from the runtime application role** *and* installs a **`BEFORE UPDATE OR DELETE` trigger that raises** (an owner connection bypasses privileges, so the trigger is what makes the invariant unconditional). Both are ratified — see Dev Notes → *Decision 2*.
- **`CHECK (amount_minor > 0)` (Law 4 / AD-4)** — a database CHECK on `salary_record.amount_minor`, authored via the `--create-only` raw-SQL migration path (Prisma has no stable declarative CHECK).
- **`settings` single-row guard** — the table plus a mechanism that permits at most one row (e.g. a `CHECK (id = 1)` on a fixed-PK column). **Structure only — the default row is 1-4's** (Decision 1); it needs a `reporting_currency` FK that 1-4 populates.
- **The first migration(s)** committed under `prisma/migrations/` (generated with `prisma migrate dev --name init`, then hand-edited for the CHECK/REVOKE that Prisma can't model).
- **Prisma client singleton** in `src/adapters/db/` (guarded against dev hot-reload multiplication), importable only by the adapters layer.
- **`DATABASE_URL` wiring** — `.env.example` (**create — none exists**; `.gitignore` already carries the `!.env.example` negation) documenting the Neon/local Postgres 18 connection string, consumed via `prisma.config.ts`. Env holds **only** connection strings + deploy target (Conventions → Config, **AD-19**).
- **A restricted runtime DB role** — AC 4 requires the app to connect as a role *without* `UPDATE`/`DELETE`, distinct from the migration owner. Provisioning it is part of this story and is **not** trivial: see Dev Notes → *Decision 2* and *Role provisioning*.
- **Integration-test harness (the AD-24 gate this story owns)** — a **separate** Vitest project/config that runs against a real disposable Postgres 18 (Neon branch or local instance, never a mock), applies migrations, and proves: (a) an employee + appended salary records round-trip; (b) `UPDATE`/`DELETE` on `salary_record` are **rejected** by the DB; (c) `amount_minor <= 0` is **rejected** by the CHECK. The unit suite stays DB/clock/network-free — note its actual glob is `include: ['tests/**/*.{test,spec}.ts']`, so a file at `tests/integration/x.test.ts` **would** be swept into `npm run test` and into coverage; narrowing the unit `include` is required work, not a given.
- **CI integration job** — extend `.github/workflows/ci.yml` with a job that provisions Postgres 18 (a `services:` container), runs `prisma migrate deploy`, and runs the integration suite. Mirror the existing jobs exactly: `node-version-file: .nvmrc` (**not** a literal `node-version:`), `cache: npm`, `npm ci`, `timeout-minutes`, an explicit `name:` on every step, and a `#` comment citing the AD. Wire `prisma generate` before `typecheck`/`build` so the generated client exists.
- **Generated-client hygiene — five gates, not four** — the generated client is ignored by git, ESLint, coverage, Stryker, **and `tsconfig.json`'s `exclude`**. The Prisma 7 `prisma-client` generator emits **TypeScript source**, not compiled JS, so `tsc --noEmit` will compile it under `strict` + `noUncheckedIndexedAccess` unless excluded (mirroring the convention 1-1's review established: the typecheck exclude tracks the ESLint ignores).
- **Close the boundary-lint hole the generated client opens** — the 1-2 purity lint bans the literal specifier `@prisma/client` in `src/domain/**` + `src/application/**`. Under Prisma 7 the real import is the generated path (e.g. `@/adapters/db/generated/client`), which **lints clean today**. Add the generated path (and `@prisma/adapter-pg`) to the purity zone's `no-restricted-imports` patterns, or AC 7's boundary is asserted but unenforced.
- Update `README.md`: the schema/migration commands, how to point `DATABASE_URL` at a disposable Postgres 18, and how to run the integration suite locally.

### Explicitly OUT of scope (owned by sibling stories — do NOT build here)

| Concern | Owner |
| --- | --- |
| The `Money` type, the one money formatter, **and ALL reference-data values** — `currency` values + minor-unit exponents (JPY=0, etc.), the `role`/`level`/`country` taxonomy, and the `settings` default row | **1-4** money-currency-domain-primitives (**ratified** — Decision 1). 1-4 drafts the ~25 roles × 6 levels × 8 countries for rk's review |
| The 10,000-employee population (`prisma/seed.ts`, log-normal draws, planted outliers) | **Epic 12** (CAP-11) — a command, never a deploy side effect |
| The repository **port** (`append` + read interfaces), the currency-from-country write funnel, the write-time future-dating (`effective_from > today`) validation | Application/adapter layer — lands with its **first consumer** (CAP-2/CAP-3). 1-3 proves append-only at the **DB**; the typed port arrives when a use-case needs it. **⚠️ Sprint-plan gap, surfaced not resolved:** epics.md line 64 binds the Repository contract to **Epic 1**, but no story in 1-1…1-6 owns it — this deferral leaves it ownerless. Same for line 68 Deployment / **NFR11** ("the product is deployed and demonstrable end-to-end"). Flag to rk; do **not** absorb either into 1-3 |
| The current-salary resolver, median, verdict composer | `src/domain/` — later capability stories |
| Vercel/Neon deploy wiring, preview branch-per-PR provisioning | Deployment (later; not an Epic-1 story yet — document the `migrate deploy`-at-build **intent**, do not wire Vercel) |
| Design tokens; app shell / as-of control | **1-5**, **1-6** |

> Do **not** materialize a `peer_group` table (AD-2: it is `(role, level, country)` derived at read time), an outlier/findings table, or any dismissal/seen state (AD-12: computed fresh, never stored). Do **not** add auth/user tables (SPEC non-goal). If you feel pulled to seed business taxonomy or write a use-case here — stop; that is another story's Definition of Done. The one write path this story proves is a **direct-Prisma integration test**, not a typed repository.

## Acceptance Criteria

1. **Prisma installed and pinned.** `prisma@7.8.0` (CLI, devDependency), `@prisma/client@7.8.0` (dependency), and **`@prisma/adapter-pg@7.8.0` (dependency — Prisma 7 requires a driver adapter)** are added with **exact** versions (no `^`/`~`; the house style is exact pins throughout). `package-lock.json` is committed. No Story-1-1/1-2 pin is upgraded without a recorded decision. A `postinstall` (currently absent — create it) runs `prisma generate` so the client is present for `typecheck`/`build`; Prisma 7 **never** auto-generates, so any schema change without an explicit `generate` leaves a stale client.

1a. **`prisma.config.ts` exists and is the single source of the connection URL.** A root `prisma.config.ts` supplies `url` (from `process.env.DATABASE_URL`) and begins with `import "dotenv/config"` — Prisma 7 does **not** auto-load `.env`, and the `PRISMA_*` escape-hatch env vars (`PRISMA_SKIP_POSTINSTALL_GENERATE`, etc.) were all removed in 7.0.0. Every CLI invocation (`migrate dev`, `migrate deploy`, `generate`, `validate`) and CI job resolves its URL through this file. Note `prisma migrate deploy` has **no `--url` flag** in v7 — CI cannot pass the URL on the command line.

2. **`schema.prisma` models the full data model, in Prisma 7 syntax.** `prisma/schema.prisma` defines:
   - a **`datasource db { provider = "postgresql" }`** — and **nothing else**. Prisma 7 removed `url` from the datasource block; `env("DATABASE_URL")` there is a v6 idiom that will not validate. The URL lives in `prisma.config.ts` (AC 1a above).
   - a **`generator client { provider = "prisma-client", output = "..." }`** — provider is `prisma-client` (not the deprecated `prisma-client-js`) and `output` is **required** in Prisma 7.
   - the eight tables exactly per Dev Notes → *Schema*.

   **Every table has an `id` uuid PK and a `created_at`**; `updated_at`/`is_active` are scoped per *Decision 3*:
   - `employee` — `id` app-generated UUID **PK with no DB default** (generation is the id port's job, AD-10); `name` (**no UNIQUE**); FK `role_code`, `level_code`, `country_code`; `gender` enum (`MALE`/`FEMALE` only); `hire_date` `DATE`; `created_at`, `updated_at`. `country` has **no update path exposed** (immutable, AD-6) — enforced at the write layer later; the column itself is a normal FK here. **No `is_active`** (AD-16 owns population membership).
   - `salary_record` — `id` uuid PK; `seq` `BIGSERIAL` **UNIQUE NOT NULL** (the monotonic AD-8 tie-break — ordering key, not the PK); FK `employee_id`; `amount_minor` `BIGINT`; `currency_code` FK → `currency.code`; `effective_from` `DATE`; `created_at` `TIMESTAMPTZ` default `now()` (**audit only — never an ordering/tie-break key**, AD-8). **No `updated_at`, no `is_active`** — the table admits INSERT and SELECT only (AD-18).
   - `role`, `level`, `country`, `currency` reference tables — each with `id` uuid PK, `code` **UNIQUE NOT NULL** (the FK target), `is_active` `BOOLEAN` default `true`, `created_at`, `updated_at`. `level` carries an orderable `rank`; `country` carries `currency_code` FK → `currency.code`; `currency` carries a `minor_unit_exponent` integer column (its **values** are 1-4's, the **column** is here).
   - `fx_rate` — `id` uuid PK; `from_currency`, `to_currency`, `rate` `NUMERIC`, `pinned_on` `DATE`; **UNIQUE `(from_currency, to_currency, pinned_on)`** preserving AD-13's rate-set identity; `created_at`, `updated_at`.
   - `settings` — single-row; `id` fixed PK with `CHECK (id = 1)`; `outlier_threshold_pct` `INT`; `reporting_currency` FK → `currency.code`; `created_at`, `updated_at`.

   **Child FKs reference the natural `code`, never the surrogate `id`** (AD-4's Money carries the ISO-4217 code; peer identity `(role, level, country)` is read on every comparison — neither may require a join). All table names are `snake_case` singular via `@@map`; TS model names are `PascalCase`; the `employee → salary_record` relation is **zero-or-more** (an employee may have no salary record). `npx prisma validate` passes.

3. **Migration exists and applies cleanly.** `prisma/migrations/` contains the committed initial migration. `prisma migrate deploy` against an empty Postgres 18 produces the full schema with no drift (`prisma migrate status` clean). Table/column names in the emitted SQL are `snake_case` singular.

4. **Append-only is enforced by the database, in two layers (Law 5 / AD-18; Decision 2).** A migration commits **both**:
   - **(A)** `REVOKE UPDATE, DELETE ON salary_record FROM <app_runtime_role>` — the literal AD-18 privilege revoke;
   - **(B)** a `BEFORE UPDATE OR DELETE ON salary_record FOR EACH ROW` trigger that `RAISE EXCEPTION`s — the layer an owner connection cannot bypass.

   The runtime role must **exist** before (A) can reference it — in a bare `postgres:18` container the only role is `postgres`. Provision it per Dev Notes → *Role provisioning*: a `DO $$ … pg_roles … $$` guard, **never** `CREATE ROLE IF NOT EXISTS` (no such syntax in PostgreSQL) and never a bare `CREATE ROLE` in a migration (prisma/prisma#6581 — roles are cluster-wide, survive the shadow-DB drop, and break `migrate dev` replay).

   After migration, a connection **as the runtime application role** cannot `UPDATE` or `DELETE` any `salary_record` row, and neither can a connection **as the owner** (proving layer B independently). `INSERT` (append) and `SELECT` still succeed, and the trigger does not fire on `INSERT`. AC 8 proves all of this.

5. **Positive-salary CHECK enforced (Law 4 / AD-4).** `salary_record` has a database `CHECK (amount_minor > 0)`. An attempt to insert `amount_minor = 0` or a negative value is rejected by the database. The CHECK is in a committed migration.

6. **`settings` is single-row.** The schema guarantees at most one `settings` row (e.g. a fixed primary key `id` with `CHECK (id = 1)`, or an equivalent single-row guard). A second-row insert is rejected. The table ships **empty** — the default row is Story 1-4's (Decision 1).

7. **Prisma client singleton in the adapters layer, and the boundary lint actually catches it.** `src/adapters/db/` exports a single Prisma client instance built with the `@prisma/adapter-pg` driver adapter, guarded against multiple instantiation under dev hot-reload (the documented `globalThis` singleton pattern) — with the adapter/pool constructed **inside** the guard, or HMR leaks `pg` pools.

   The lint must be **extended, not merely re-run**: today the purity zone bans the specifier `@prisma/client`, but under Prisma 7 a leak imports the *generated path*, which passes. Add the generated output path and `@prisma/adapter-pg` to the purity zone's restricted imports, then prove the gate bites (a temporary fixture importing the generated client from `src/domain/**` must fail lint, mirroring how 1-2 verified every gate). ⚠️ When editing `eslint.config.mjs`, heed the note already in that file: flat-config rule entries **replace rather than merge**, so a new block carrying `no-restricted-imports`/`no-restricted-syntax` that matches `src/domain/**`/`src/application/**` will silently erase all nine purity selectors. Extend the existing purity block; do not append a competing one. The ignores-only object must stay last.

   The generated client output directory is excluded from **five** places: `.gitignore`, ESLint `ignores`, coverage, Stryker `ignorePatterns`, **and `tsconfig.json`'s `exclude`** — the Prisma 7 generator emits `.ts` source that `tsc --noEmit` would otherwise compile under `strict` + `noUncheckedIndexedAccess`.

8. **Integration test against real Postgres 18 (the AD-24 harness).** A **separate** Vitest integration project (not `tests/**`, not swept into `npm run test`) runs against a real disposable Postgres 18 and asserts, in order:
   - a `currency` + `country` + `role` + `level` + `employee` fixture inserts (the suite creates its **own** reference rows — nothing is seeded by this story, per Decision 1), and **two `salary_record` appends** for that employee round-trip and read back ordered by `(effective_from, seq)`;
   - an `UPDATE` and a `DELETE` targeting a `salary_record` row each **fail as the runtime application role** (layer A + B, AC 4);
   - an `UPDATE` and a `DELETE` each **also fail as the owner role** — proving the trigger (layer B) independently rather than letting the privilege revoke mask it (AC 4);
   - an `INSERT` (append) still **succeeds** as the runtime role, confirming the trigger does not fire on insert;
   - an `INSERT` with `amount_minor = 0` **fails** the CHECK (AC 5).

   Fixtures that insert via **raw SQL** (which the role-switching assertions require, since they connect outside the Prisma client) must supply `updated_at` explicitly: `@updatedAt` is set by the Prisma **client**, not the database — there is no DB default and no trigger, so a raw `INSERT` omitting a `NOT NULL updated_at` fails outright. Either give `updated_at` a DB default in the migration or always name it in raw inserts; record which.

   A `test:integration` npm script runs it locally against a `DATABASE_URL` the developer points at a disposable instance. The unit suite (`vitest run`) remains green and touches no DB — which requires **narrowing** `vitest.config.ts`'s `include` (currently `['tests/**/*.{test,spec}.ts']`, which *would* sweep in `tests/integration/**`), or siting the integration suite outside `tests/` entirely.

9. **CI runs the integration gate — and the three existing jobs survive it.** `.github/workflows/ci.yml` gains a job that (a) starts Postgres 18 (a `services:` container with the standard `pg_isready` health check), (b) exports `DATABASE_URL` in the job `env:` so `prisma.config.ts` resolves it (there is no `--url` flag on `migrate deploy`), (c) provisions the runtime role, (d) runs `prisma migrate deploy`, (e) runs `test:integration`; a failure blocks merge. There is **no `services:` and no `env:` block anywhere in `ci.yml` today** — both are new.

   ⚠️ **Blast radius on the existing jobs.** `postinstall: prisma generate` now runs in all three (each does `npm ci`), and the `a11y` job's Playwright `webServer` runs `npm run build && npm run start` with **no database**. If the Prisma client is instantiated at module scope anywhere reachable from the build, `check` **and** `a11y` break. Keep client construction lazy/module-local to `src/adapters/db/`, and confirm all three legacy jobs stay green.

   The existing gates (lint incl. boundary+purity, typecheck, unit+coverage, mutation, a11y) still pass — `prisma generate` runs before `typecheck`/`build` so the client resolves. Each gate remains individually legible (AC-7 of 1-2). Update the README's required-check list: branch protection names the job **display names** (`Lint · Typecheck · Build · Unit + Coverage`, `Mutation testing (domain)`, `Accessibility (axe)`), currently exactly three.

10. **TDD honored where testable, and hygiene.** The DB-enforced invariants are proven **red-before-green**: the integration assertions for the REVOKE (AC 4) and the CHECK (AC 5) are written and observed to fail against a schema *without* them, then pass once the migration adds them — recorded in the Dev Agent Record (CI can't prove ordering; the commit sequence shows it). `.env.example` is committed (never a real secret); `.gitignore` covers the generated client dir and any Prisma temp output; `README.md` documents the schema/migration/integration commands and the `DATABASE_URL` setup.

## Tasks / Subtasks

- [ ] **Task 1 — Install & pin Prisma 7.8.0, and stand up `prisma.config.ts`** (AC: 1, 1a)
  - [ ] Add `prisma@7.8.0` (devDep), `@prisma/client@7.8.0` + `@prisma/adapter-pg@7.8.0` (deps), exact pins; `npm install`; commit `package-lock.json`.
  - [ ] Create `prisma.config.ts` with `import "dotenv/config"` and the URL from `process.env.DATABASE_URL`. Create `.env` locally (git-ignored) and commit `.env.example`.
  - [ ] Add `prisma generate` to `postinstall` (and/or a `db:generate` script); confirm `typecheck`/`build` see the client.
  - [ ] Decide + record the generator `output` path; add it to **all five**: `.gitignore`, ESLint `ignores`, coverage `exclude`, Stryker `ignorePatterns`, **and `tsconfig.json` `exclude`**.
- [ ] **Task 2 — Author `schema.prisma`** (AC: 2)
  - [ ] `datasource db { provider = "postgresql" }` — **no `url`** (Prisma 7) — plus `generator client { provider = "prisma-client", output = … }`.
  - [ ] All eight models with exact types/keys/relations and `@@map` snake_case names; `Gender` enum; `DATE`/`TIMESTAMPTZ`/`BIGSERIAL`/UUID mappings per *Schema*.
  - [ ] Decide the index question (Dev Notes → *Indexes*) and record the answer either way.
  - [ ] `npx prisma validate` clean.
- [ ] **Task 3 — Generate the base migration** (AC: 3)
  - [ ] `prisma migrate dev --name init` against a disposable Postgres 18; inspect the emitted `snake_case` SQL.
  - [ ] Confirm `migrate deploy` on a fresh DB yields no drift (`migrate status` clean).
- [ ] **Task 4 — Runtime role, append-only (REVOKE + trigger), positive CHECK (raw SQL)** (AC: 4, 5, 10)
  - [ ] Provision the runtime application role per *Role provisioning* — `DO $$ … pg_roles … $$`, never `CREATE ROLE IF NOT EXISTS`. **Run `prisma migrate dev` twice on the same cluster** to prove shadow-DB replay is idempotent (prisma#6581).
  - [ ] Implement **both** Decision-2 layers as SQL in a migration (`--create-only` edit or a dedicated migration): the `REVOKE UPDATE, DELETE` against the runtime role, **and** the `BEFORE UPDATE OR DELETE` trigger that raises. Confirm the trigger does not fire on `INSERT`.
  - [ ] Add `CHECK (amount_minor > 0)` and the `settings` single-row guard (AC 6) as SQL.
  - [ ] **Prove red first:** integration assertions for REVOKE + CHECK fail on the pre-constraint schema; watch them fail for the right reason; then add the SQL and go green. Record it.
- [ ] **Task 5 — Prisma client singleton** (AC: 7)
  - [ ] `src/adapters/db/client.ts` — `globalThis`-guarded singleton wrapping `new PrismaClient({ adapter })`, with the `PrismaPg` adapter constructed **inside** the guard. Import from the generated path, not `@prisma/client`.
  - [ ] Keep construction lazy / module-local so a build without `DATABASE_URL` (the `check` and `a11y` jobs) does not crash.
  - [ ] **Extend** the purity zone's restricted imports to the generated path + `@prisma/adapter-pg`, then prove it bites with a temporary domain fixture (delete after). Mind the flat-config replace-not-merge trap.
- [ ] **Task 6 — Integration harness (separate Vitest project)** (AC: 8, 10)
  - [ ] Add `vitest.integration.config.ts` (or a project) with `include` pointing at the integration dir (e.g. `tests/integration/**`), and **narrow the unit config's `include`** so it no longer matches it — verify, don't assume.
  - [ ] Write the round-trip + REVOKE + CHECK test (AC 8); add `test:integration` script requiring `DATABASE_URL`. Handle `updated_at` in raw inserts (see AC 8).
  - [ ] Confirm `npm run test` (unit) does **not** pick it up and stays DB-free, and that coverage is unchanged.
- [ ] **Task 7 — CI integration job** (AC: 9)
  - [ ] Add a `services: postgres:18` job (with `pg_isready` health check) to `ci.yml` that sets `DATABASE_URL` in `env:`, provisions the runtime role, runs `prisma migrate deploy`, then `test:integration`.
  - [ ] Mirror the house job conventions: `node-version-file: .nvmrc`, `cache: npm`, `npm ci`, `timeout-minutes`, named steps, an AD citation comment.
  - [ ] Ensure `prisma generate` runs before `typecheck`/`build`; **re-verify `check` and `a11y` still pass** now that `postinstall` runs in them and `a11y` builds the app with no database.
- [ ] **Task 8 — Env, docs, hygiene** (AC: 1, 1a, 10)
  - [ ] `.env.example` with a documented `DATABASE_URL` (no real secret).
  - [ ] `README.md`: schema/migration/integration commands (both tables), the new required check name, disposable-Postgres-18 + role setup, the `migrate deploy`-at-build intent (deploy wiring itself is later).
- [ ] **Task 9 — Final verification** (AC: 3, 4, 5, 8, 9)
  - [ ] Run every gate locally green: `lint`, `typecheck`, `test` (unit+coverage), `test:mutation`, `test:a11y`, `test:integration`, `build`. Record outcomes in the Dev Agent Record.

## Dev Notes

### Standing law (read `docs/project-context.md` first)

`docs/project-context.md` is the law inherited every session. The Laws most load-bearing for **this** story:

- **Law 1 (TDD):** "no production code without a failing test first." AC 10 and Task 4 are entirely red-before-green work — the DB invariants are the testable pieces and the commit sequence is the evidence. Law 1 also mandates the coverage floor on `src/domain` + `src/application` and mutation testing over `src/domain`; do not weaken either to accommodate persistence.
- **Law 5 (Append-only, mechanically):** "`salary_record` has no update and no delete path — `UPDATE`/`DELETE` are revoked on the table at the DB role by migration, and the repository port exposes only `append` + read methods." This story is where that migration is written. Revocation at the DB is non-negotiable — the port-only-exposes-append part is a *later* layer; the DB gate is *here*. (Law 5's next sentence — future-dating rejected on **every** write path — is the write layer's, deferred by the out-of-scope table.)
- **Law 4 (No salary without a currency)** — Law 4 governs *currency presence only*. The **positive-amount rule is AD-4**, not Law 4: "A salary is strictly positive: `salary_record.amount_minor > 0` is a database `CHECK` **and** a write-time validation." This story owns the **CHECK**; the write-time validation is the write layer's (later).
- **Law 2 (Functional core, imperative shell):** Prisma lives **only** in `src/adapters/db/`. The generated client and singleton must never be importable from `domain`/`application` — the 1-2 boundary lint enforces this; don't defeat it. "The database stores rows and selects sets; it computes no statistic a user sees" — so no `percentile_cont`/`AVG`/window functions belong in any query built on this schema (relevant to how the schema is *used*, not the DDL).
- **Law 6 (Determinism / UTC):** as-of date and threshold are always parameters; no `Date.now()`/`new Date()` in domain or application; "today" is the current date in **UTC**. The calendar-`DATE` rule the schema needs is **Conventions, not Law 6**: "`effective_from`, `pinned_on`, `hire_date` are calendar dates (`DATE`) — never timestamps, no timezone. The as-of date is a plain-date value object, not a JS `Date`." `created_at` is the *only* timestamp and is audit-only (AD-8: not a tie-break).
- **Law 3 (Exact vocabulary):** table/column names use the SPEC's words. **Banned everywhere (code and copy), verbatim:** `snapshot`, `compaRatio`/"compa-ratio", `payBand`. (The phrase "pay bands" is separately banned in copy by DESIGN.md and listed as a SPEC non-goal — so do not model a pay band, midpoint, or compa-ratio column; the addendum's research vocabulary is *not* our schema's.) Law 3 also fixes gender values as exactly `MALE`/`FEMALE`.
- **Conventions:** DB tables `snake_case` singular; TS files `kebab-case`; types `PascalCase`. **Config (AD-19, not AD-20):** "Threshold is persisted data (single-row `settings`), not env. Env holds only connection strings and the deploy target." AD-20 is the receipts/discriminated-union law — do not cite it for config.

If any instruction here conflicts with a Law, **stop and surface it** — do not silently comply.

### Decision 1 — Reference-data & settings-row *values* (RESOLVED by rk 2026-07-18 → Story 1-4)

**1-3 is structure-only. Seed no reference values and no `settings` row in this story.** All reference-data *values* are folded into **Story 1-4**, which already owns the currency reference:

- **`currency` values + minor-unit exponents** (JPY=0, USD=2, INR=2, …) — 1-4's from the start (Story 1-1's out-of-scope table assigns "currency reference" to 1-4; the money formatter is driven by the exponent table).
- **`role` / `level` / `country` taxonomy values** — **now also 1-4's** (ratified). Import (Epic 2, AD-7) rejects rows whose role/level/country is absent from the reference table and the CAP-11 seed (Epic 12) passes the same validation, so both presuppose populated reference tables — 1-4 lands well ahead of either.
- **`settings` default row** (threshold `20`, a `reporting_currency`) — **1-4's**, because `reporting_currency` is an FK and needs currencies to exist first.

**Taxonomy sourcing (ratified):** no artifact enumerates the values, so **the dev agent drafts them for rk's review** — approximately 25 roles, 6 levels, and 8 countries per the addendum's grid sizing (line 26: "~25 roles × 6 levels × 8 countries = 1,200 cells for 10,000 employees"), with real ISO-4217 codes and exponents for currencies. Note the addendum's comp vocabulary (`pay band`, `compa-ratio`, midpoint) is **banned** (Law 3) — it sizes the grid, it does not name the values. **This drafting happens in 1-4, not here.**

**Two unresolved conflicts 1-4 inherits — name them in Completion Notes, do not silently resolve them here:**

- **Level cardinality.** `reconcile-stitch.md` line 97 flags that the mocks use two incompatible level vocabularies (Settings/Gender Insights: L1–L8 + M1–M3 = **11**; Employees/Overdue chips: IC2–IC6 + M2/M4/M7), while the addendum sizes the grid at **6** levels. "One reference-table vocabulary must win at distillation." Structure-only 1-3 is unaffected — `level` is just a table — but 1-4 cannot draft values without this decision.
- **Is `country` a reference table?** SPEC line 77 names **only role and level** as seeded reference tables ("Free text is not accepted anywhere, including import"). epics.md line 63 and AD-6 both require a `country` reference table (currency is derived from it), so modeling it here is right — but `reconcile-stitch.md` §4 item 6 and EXPERIENCE.md Note 4 both leave *import rejection on country* open, and SPEC CAP-1 mandates role/level rejection only. 1-3 builds the FK; the **rejection semantics** are Epic 2's open question.

**Consequence for this story:** the integration test (AC 8) creates its **own** fixtures — a currency, country, role, level, employee, and salary records — so 1-3 is fully testable with empty reference tables. Do not seed anything.

### Decision 2 — The append-only mechanism (RESOLVED by rk 2026-07-18 → implement BOTH)

AD-18 says `UPDATE`/`DELETE` are "revoked … at the DB role by migration." The reconcile review (`reviews/review-reconcile-spec.md` F-3) accepted "revoked grants **or a rule/trigger**" as equivalent. **Ratified: implement both layers.**

**Status caveat — read before citing F-3.** F-3 was written against a draft that predates AD-18, and `review-verify-round2.md` records it **CLOSED by AD-18**. AD-18 adopted revoked grants and did **not** take up the trigger alternative; on any conflict the spine wins. So the trigger here is a deliberate **addition** ratified by rk for the silent-failure reason below — not a spine requirement, and never a substitute for the revoke. Record it as an addition in Completion Notes.

- **(A) Privilege revoke — the literal AD-18 wording.** Migrations run as the **owner** role; the app connects at runtime as a **restricted** role holding `SELECT, INSERT` on `salary_record` but not `UPDATE, DELETE`:
  `REVOKE UPDATE, DELETE ON salary_record FROM <app_runtime_role>;`
  Note AD-18 names only "the application database role" as a category — no literal role name appears anywhere in the spine, so the name is yours to choose and record. Provisioning that role is non-trivial: see *Role provisioning* below.
- **(B) Trigger — the layer that cannot be bypassed.** A `BEFORE UPDATE OR DELETE ON salary_record FOR EACH ROW` trigger whose function `RAISE EXCEPTION`s. This exists because **(A) alone has a silent failure mode**: Postgres lets a table **owner** bypass privilege checks entirely, so if the app ever connects as the owner — easy to do accidentally on Neon, where the default role owns everything — the REVOKE is a no-op and the invariant is unenforced while every test still passes green. The trigger holds regardless of role, ownership, or connection string. It **never fires on `INSERT`**, so appends pay nothing.

**Both go in the migration.** The AC-4 integration test connects **as the role the application uses at runtime** and proves rejection — testing as a role that isn't the runtime one would give a false green. Additionally assert the trigger independently (e.g. as the owner) so layer (B) is proven on its own rather than masked by layer (A) firing first.

### Role provisioning — the likeliest wall in this story

Layer (A) references a runtime role that **does not exist** in a fresh `postgres:18` container (the only role is `postgres`) or in a fresh local instance. `REVOKE … FROM app_role` on a nonexistent role errors outright. Three facts govern the fix:

1. **PostgreSQL has no `CREATE ROLE IF NOT EXISTS`.** That syntax does not exist; it is widely repeated in blog posts and will fail with a syntax error. The correct guard is a `DO` block:
   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payroll_app') THEN
       CREATE ROLE payroll_app LOGIN PASSWORD '...';
     END IF;
   END $$;
   ```
2. **Roles are cluster-wide and survive the shadow database.** `prisma migrate dev` creates a throwaway shadow DB **on the same cluster** and replays the entire migration history into it. A bare `CREATE ROLE` therefore fails on the second run with `role "..." already exists` → `Error: P3006`. This is **prisma/prisma#6581, open since 2021** — do not expect a Prisma-side fix. The `DO`-block guard is what makes replay idempotent. `GRANT`/`REVOKE` themselves are idempotent and replay safely *once the role exists*.
3. **Preferred: keep role creation out of migrations entirely.** Provisioning is an infrastructure concern. Recommended shape — a committed `prisma/sql/bootstrap-roles.sql` run as an explicit step (CI job step; a documented one-liner locally; the Neon console in deployed environments), with only the `REVOKE`/`GRANT` living in the migration. If you instead put the guarded `DO` block in the migration, verify `migrate dev` twice in a row on the same cluster before calling it done.

If a second role genuinely cannot be provisioned in some environment, still write the `REVOKE` against whatever role the app connects as, and record the limitation in Completion Notes — layer (B) is what keeps the invariant true meanwhile. Note also that `migrate dev` requires `CREATEDB` (or superuser) for the shadow database: the container's `postgres` role qualifies, a least-privilege app role does not, which is a second reason the runtime role must never be the migration role.

### Decision 3 — Standard columns: `id`, `created_at`, `updated_at`, `is_active` (RATIFIED by rk 2026-07-18)

House convention is a surrogate `id`, `created_at`, `updated_at`, and `is_active` on every table. Three tables cannot take the full set without breaking a ratified Law; the scoping below is **decided, not open** — implement it exactly and do not "restore consistency" by adding the omitted columns.

| Column | Scope | Why it is scoped this way |
| --- | --- | --- |
| `id` (uuid PK) | **Every table** | Ratified. `salary_record.seq` and `fx_rate`'s triple move from PK to **UNIQUE**, which preserves their invariants intact (see below). |
| `created_at` | **Every table** | No conflict. On `salary_record` it is audit-only and **never** an ordering key (AD-8). |
| `updated_at` | **Every table EXCEPT `salary_record`** | AD-18 revokes `UPDATE` on `salary_record` at the DB role — the column could never change value. A never-changing `updated_at` advertises a mutability the architecture spent an entire AD eliminating, and would be the first thing a future reader mistakes for an update path. |
| `is_active` | **Reference tables ONLY** (`role`, `level`, `country`, `currency`) | On `employee` it collides with **AD-16**, which defines the as-of population as *exactly* `hire_date ≤ D AND ≥1 salary record with effective_from ≤ D` and requires `n` be "counted identically by every capability" — a second orthogonal filter is precisely the answer/refusal divergence AD-16 exists to close. It is also temporally wrong: every question here is asked *as-of a date*, and a boolean cannot answer "was this person active on 2025-03-01?". On `salary_record`, `is_active = false` **is** a soft delete (AD-18 violation) and is unsettable anyway. |

**Why `seq` survives as UNIQUE rather than PK.** AD-8 requires `salary_record.seq` be "a monotonically increasing `BIGSERIAL`" used as the same-date tie-break — it does **not** require `seq` be the primary key. In fact **no architecture document specifies a primary key for any table**: the ER diagram declares columns only for `SETTINGS`, and the strings "PRIMARY KEY"/"PK" appear nowhere in the spine. So the uuid PK is an addition that contradicts nothing, and TRADE-OFFS.md line 90 argues *for* it independently — UUIDv7 was chosen over `BIGSERIAL` as the id "because the id appears in URLs and a sequential id leaks headcount." `BIGSERIAL UNIQUE NOT NULL` preserves monotonicity, uniqueness, and the `(effective_from, seq)` ordering contract in full. EXPERIENCE.md (Notes for Architecture, item 5) independently requires that *some* deterministic tie-break exist; `seq` remains it. **Never order by `id`** — a uuid has no meaningful sort.

One caveat to record: Prisma emits `BIGSERIAL` (a sequence + `nextval` default), **not** an `IDENTITY` column, so `seq` has normal SERIAL semantics — monotonic but **gap-prone** under rolled-back transactions. That satisfies AD-8, which needs ordering, not gaplessness. Do not build anything that assumes contiguity.

**Why `fx_rate` keeps a UNIQUE on the triple.** AD-13 makes `pinned_on` the rate-set identity and requires "a set is written whole or not at all." The spine specifies no key for `fx_rate` either — the natural key is implied by "a rate set is all rows sharing one `pinned_on`" but never stated as a constraint, so this UNIQUE is likewise an addition. It is not optional: with `id` as PK, only a `UNIQUE (from_currency, to_currency, pinned_on)` still prevents two contradictory rates for the same pair in the same set.

**Reference-table `is_active` semantics (decide and document in Completion Notes).** The intended use is retiring a taxonomy value without breaking historical FKs. The rule that must hold: an **inactive** row is rejected for *new* writes (import per AD-7, and the create/edit form's select options) but **still resolves for existing employees** — peer identity `(role, level, country)` is historical, so an employee on a retired role keeps their peer group and keeps appearing in every count. Filtering an inactive role *out of statistics* would reintroduce the exact AD-16 population divergence this story is avoiding. Read: `is_active` gates **pickability**, never **visibility**.

**`image_url` is deliberately absent.** The design ruled on this: `reconcile-stitch.md` line 57 **DROPs** the employee headshots the Stitch mocks invented — *"The data model holds no photo; invented data the product cannot have."* Employees are rendered as name + a text identity strip; no avatar, no initials monogram exists on any surface. Do not add an image column.

### Architecture patterns & constraints

- **Structural Seed — the schema is foundational, pre-capability.** [Source: ARCHITECTURE-SPINE.md#Structural-Seed] Postgres 18 (Neon) holds `employee · salary_record · reference tables · fx_rate · settings`. The ER diagram (spine "Core entities") is the source of the relations; two notes are binding: **`EMPLOYEE ||--o{ SALARY_RECORD` is zero-or-more** (CAP-2 makes an employee with no salary, invisible to stats until a record exists — AD-16), and **a peer group is NOT a table** (`(role, level, country)` derived at read time — AD-2). [Source: ARCHITECTURE-SPINE.md lines 258, 260]
- **AD-4 — money & the positive CHECK.** "`salary_record.amount_minor > 0` is a database `CHECK` and a write-time validation." `amount_minor` is integer minor units (`BIGINT` ↔ `bigint` in code). The minor-unit exponent lives on the `currency` table, "never a hard-coded 100." One clause that shapes how this column is *consumed* later: at any JSON or Server Action boundary `amountMinor` serializes as a **decimal string**, never a JS number and never a raw `bigint` — relevant when the port lands, not to the DDL. [Source: ARCHITECTURE-SPINE.md#AD-4]
- **AD-6 — currency on the record, immutable country.** `salary_record.currency_code` is written from the employee's country at write time (the *validation* is the write layer's, later). **`employee.country` is set at create and is immutable** — "no form, use-case, or repository method offers a country update." For the schema: `country` is a normal FK column; the immutability is enforced by *offering no update path*, not by a DB trigger. [Source: ARCHITECTURE-SPINE.md#AD-6]
- **AD-8 — `seq` `BIGSERIAL`, `created_at` never a tie-break.** "`salary_record.seq` is a monotonically increasing `BIGSERIAL`. Current salary = the record with the greatest `(effective_from, seq)` where `effective_from ≤ as-of date`. `created_at` may not be used as a tie-break." The resolver is `src/domain/`'s (later); the schema just provides `seq` + `created_at` (audit). [Source: ARCHITECTURE-SPINE.md#AD-8]
- **AD-10 — opaque UUIDv7 id, generated in the shell.** "`employee.id` is a UUIDv7, generated in the shell via an id port, never derived from name." → the column is a `uuid` PK **with no DB default** (`gen_random_uuid()` would put generation in the DB; keep it in the shell/id port). [Source: ARCHITECTURE-SPINE.md#AD-10]
- **AD-13 — `fx_rate` shape.** Verbatim: `fx_rate (from_currency, to_currency, rate NUMERIC, pinned_on DATE)`. A "rate set" is all rows sharing one `pinned_on`. `settings.reporting_currency` is the org-wide target (exactly one, never inferred). Per-country totals never convert. [Source: ARCHITECTURE-SPINE.md#AD-13]
- **AD-18 — append-only enforced.** Full quote in *Decision 2*. The **DB revoke is this story**; the port's `append`-only surface and the future-dating write check are later layers. [Source: ARCHITECTURE-SPINE.md#AD-18]
- **AD-19 — `settings` single-row holds the threshold default.** "The `settings` table holds the current default; it is read once at the delivery boundary and passed inward. No domain code reads settings." → the table is here; the read-at-boundary wiring is later. [Source: ARCHITECTURE-SPINE.md#AD-19]
- **AD-24 — this is where persistence + the integration harness appear.** "Backend done" requires "at least one **adapter integration test** exercising the real repository against a **disposable Postgres 18** (a Neon branch or local instance, **never a mock**) … Integration tests run under Vitest and sit outside the AD-23 domain suite." 1-2 explicitly deferred this harness to 1-3. [Source: ARCHITECTURE-SPINE.md#AD-24; 1-2 out-of-scope table]
- **AD-2 / AD-12 — do not model derived state.** No `percentile_cont`/`AVG`/window functions on this schema (compute in the domain); no materialized outlier/findings table, no dismissal/seen columns, no peer_group table. The ban is **not blanket**, and the carve-out matters when queries land: "`COUNT`, `ORDER BY`, and `LIMIT` used purely for directory listing and pagination are not domain values and are permitted; any `n` a user sees is the cardinality of the exact in-memory set the statistic was computed over (AD-16), never a separate `COUNT` query." [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-12]
- **Indexes — the spine mandates none; decide deliberately.** No architecture document requires any index. But AD-16 loads the full as-of population per request and AD-12 forbids caching, over 10,000 employees. At minimum evaluate `salary_record (employee_id, effective_from)` and an index supporting the peer-identity triple `employee (role_code, level_code, country_code)`. Whatever you choose — including "none for now" — **record it in Completion Notes** rather than leaving it unconsidered.

### Schema (author `prisma/schema.prisma` to this; exact types)

[Source: ARCHITECTURE-SPINE.md#Structural-Seed (ER diagram) + AD-4/6/8/10/13/19; Consistency Conventions]

**Every table carries `id` (uuid PK) and `created_at`.** `updated_at` and `is_active` are scoped per *Decision 3* — they are **not** universal, because two tables cannot legally have them.

| Table (`@@map`) | Column | Type | Notes |
| --- | --- | --- | --- |
| `employee` | `id` | `uuid` PK | **No DB default** — id port generates UUIDv7 (AD-10) |
| | `name` | `text` | searchable, non-identifying. **No UNIQUE** — 10k names collide (design uses names as visual identity only) |
| | `role_code` | FK → `role.code` | selectable only from reference (SPEC) |
| | `level_code` | FK → `level.code` | |
| | `country_code` | FK → `country.code` | immutable (no update path offered, AD-6) |
| | `gender` | enum `MALE`\|`FEMALE` | never part of peer identity |
| | `hire_date` | `DATE` | calendar date, no tz (AD-16, Law 6) |
| | `created_at`, `updated_at` | `TIMESTAMPTZ` | audit pair; **no `is_active`** (Decision 3) |
| `salary_record` | `id` | `uuid` PK | surrogate identity |
| | `seq` | `BIGSERIAL` **UNIQUE NOT NULL** | **AD-8 tie-break — the ordering key, not the PK.** Monotonic; `(effective_from, seq)` resolves current salary |
| | `employee_id` | FK → `employee.id` | zero-or-more per employee |
| | `amount_minor` | `BIGINT` | `CHECK (amount_minor > 0)` (AD-4) |
| | `currency_code` | FK → `currency.code` | written from country (AD-6) |
| | `effective_from` | `DATE` | `> today` rejected at write layer (AD-18) |
| | `created_at` | `TIMESTAMPTZ` default `now()` | **audit only — never ordering** (AD-8) |
| | — | — | **NO `updated_at`, NO `is_active`** — UPDATE/DELETE revoked (Law 5 / AD-18). See Decision 3 |
| `role` | `id` PK, `code` UNIQUE, `name`, `is_active`, `created_at`, `updated_at` | | taxonomy **values are 1-4's** (Decision 1); ships empty |
| `level` | `id` PK, `code` UNIQUE, `name`, `rank` `INT`, `is_active`, `created_at`, `updated_at` | | `rank` orders the gender-by-level chart + prevents level inversion |
| `country` | `id` PK, `code` UNIQUE, `name`, `currency_code` FK → `currency.code`, `is_active`, `created_at`, `updated_at` | | country → one currency (AD-6) |
| `currency` | `id` PK, `code` UNIQUE (ISO-4217), `minor_unit_exponent` `INT`, `is_active`, `created_at`, `updated_at` | | **values are 1-4's**; columns here |
| `fx_rate` | `id` PK, `from_currency` FK, `to_currency` FK, `rate` `NUMERIC`, `pinned_on` `DATE`, `created_at`, `updated_at` | **UNIQUE `(from_currency, to_currency, pinned_on)`** | the UNIQUE preserves AD-13's rate-set identity now that `id` is the PK |
| `settings` | `id` fixed PK (`CHECK (id = 1)`), `outlier_threshold_pct` `INT`, `reporting_currency` FK → `currency.code`, `created_at`, `updated_at` | single row (AD-19) | ships **empty** — default row is 1-4's (Decision 1). `reporting_currency` has **no UI control** — it is config, not a user-facing setting |

**Foreign keys target the natural `code`, not the surrogate `id`.** The reference tables carry both: `id` (uuid PK, for uniformity) and `code` (UNIQUE NOT NULL, the FK target). This is deliberate — AD-4's Money type is `{ amountMinor: bigint, currency: string }` where `currency` **is the ISO-4217 code**, so `salary_record.currency_code` must be readable without a join to the currency table. Same reasoning for `role_code`/`level_code`/`country_code` on `employee`: peer identity is `(role, level, country)` and is read on every comparison.

**Prisma mapping notes** (all verified against the Prisma 7.8.0 schema reference):

- `BIGSERIAL` → `BigInt @default(autoincrement()) @unique`. Valid on a **non-PK** field for PostgreSQL specifically — the Postgres connector declares `AutoIncrementAllowedOnNonId` and `AutoIncrementNonIndexedAllowed` (this would be a validation error on MySQL/SQLite). Emits real `BIGSERIAL` in a `CREATE TABLE`.
- `uuid` PK → `String @id @db.Uuid` with **no `@default` on `employee.id`** (the id port owns UUIDv7 generation, AD-10). ⚠️ `@default(uuid(7))` is *not* the compliant shortcut: it is **client-side generation by Prisma**, invisible in the DB schema, so it wouldn't violate "no DB default" — but it *would* violate "the id port generates the id," which is the actual rule. The genuine DB-default route (also forbidden here) would be `@default(dbgenerated("gen_random_uuid()"))`. Other tables may take a DB default since AD-10 binds only `employee.id` — record the choice.
- `DATE` → `DateTime @db.Date`; `TIMESTAMPTZ` → `DateTime @db.Timestamptz(6)` (specify it — the default without a native type is `timestamp(3)`); `created_at` → `@default(now())`; `is_active` → `Boolean @default(true)`.
- `updated_at` → `@updatedAt`, which is **implemented at the Prisma ORM level** — the client sets it; there is no DB default and no trigger. Consequence for AC 8: a raw SQL `INSERT` that omits a `NOT NULL updated_at` **fails**. Either add a DB-level `DEFAULT now()` in the migration or always name the column in raw inserts. Decide and record.
- `NUMERIC` → `Decimal @db.Decimal(p, s)` — **choose a precision** (recommend `@db.Decimal(18, 8)` for FX; the default is `decimal(65,30)`). Values come back as `Prisma.Decimal` objects, not JS numbers — assert accordingly in tests.
- Prisma has **no declarative `CHECK`** in 7.8.0 (no `@@check`). Add `amount_minor > 0`, the `settings` single-row guard, and any others via the `prisma migrate dev --create-only` → hand-edit-SQL flow. Table/enum names via `@@map`/`@map` to `snake_case` singular.
- `DateTime` inputs must be passed as `Date` objects, not strings (prisma/prisma#9516).

### Prisma 7 / migrations mechanics

[Source: ARCHITECTURE-SPINE.md#Stack (Prisma 7.8.0), #Deployment; C4-MODEL.md]

> ⚠️ **Prisma 7 is not Prisma 6.** Four things that worked for years were removed in 7.0.0. Every one of them is load-bearing for this story, and any Prisma tutorial older than v7 will lead you into them. Read this block before writing a line of schema.

**The four breaking changes:**

1. **`url` is gone from the `datasource` block.** The v7 datasource accepts only `provider`, `relationMode`, `schemas`, `extensions`. `url = env("DATABASE_URL")` will not validate. Connection URLs (`url`, `directUrl`, `shadowDatabaseUrl`) move to **`prisma.config.ts`** at the repo root — new required infrastructure, not an optional convenience.
2. **Env vars are not auto-loaded.** `prisma.config.ts` must `import "dotenv/config"` explicitly. The whole `PRISMA_*` escape-hatch family (`PRISMA_SKIP_POSTINSTALL_GENERATE`, `PRISMA_GENERATE_IN_POSTINSTALL`, …) was removed and now silently no-ops.
3. **A driver adapter is mandatory for every database.** `new PrismaClient()` with a connection string no longer connects; the `datasources`/`datasourceUrl` constructor options are gone. Install `@prisma/adapter-pg@7.8.0` (bundles `pg ^8.16.3`, which speaks Postgres 18's default SCRAM-SHA-256) and construct `new PrismaClient({ adapter })`.
4. **The generator changed name, output, and import path.** Provider is **`prisma-client`** (`prisma-client-js` is deprecated and slated for removal); **`output` is required**; and the generator emits **TypeScript source files**, not a compiled package in `node_modules`. So the import is `from "<output>/client"` — the `/client` suffix is load-bearing — and **`import { PrismaClient } from "@prisma/client"` does not work.**

**Consequences that follow from #4:**

- **Generated client location.** Recommend `src/adapters/db/generated/` (keeps Prisma inside the adapters layer, satisfying Law 2). Because it is now thousands of lines of `.ts` **inside `src/`**, it must be excluded from **five** gates: `.gitignore`, ESLint `ignores`, coverage, Stryker `ignorePatterns`, and **`tsconfig.json` `exclude`** (its `include` is `["**/*.ts", …]`, so `tsc --noEmit` compiles it under `strict` + `noUncheckedIndexedAccess`). Record the chosen `output` and all five ignore edits.
- **Boundary lint must learn the new specifier.** The purity zone bans `@prisma/client`; the leak-shaped import is now the generated path. Extend the ban (see AC 7) or the gate is decorative.
- **Ordering is stricter than before.** Nothing auto-generates anymore — `migrate dev` and `db push` no longer trigger `generate` (that's why `--skip-generate` was removed). `prisma generate` **must** run before `typecheck`/`build`/`test` or they fail on a missing directory. `postinstall` covers this wherever `npm ci` runs.
- **ESM/tsconfig.** Prisma 7 ships as an ES module and requires `"type": "module"` — already set. `moduleResolution: "bundler"` is the documented recommendation and is already configured. If the integration runner resolves `.ts` through `tsx`, the generated client's `.js`-suffixed internal imports fail to resolve; the fix is `importFileExtension = "ts"` in the generator block. Try the default first; reach for this only on `Cannot find module './internal/class.js'`.

**Other mechanics:**

- **Version:** Prisma **7.8.0** (CLI + `@prisma/client` + `@prisma/adapter-pg`), exact pins. 7.8.0 is the current `latest`. Engine requirement `node ^20.19 || ^22.12 || >=24.0` — Node 24 satisfies it. [Source: spine Stack]
- **Migration commands by environment:** local `prisma migrate dev`; preview + production `prisma migrate deploy` (**at build**). [Source: spine Deployment table; C4 deployment diagram]. This story wires the **commands and intent**; the Vercel/Neon deploy plumbing is a later deployment story — document, don't build. Note `migrate deploy` has **no `--url` flag** in v7 (unlike `migrate dev`, which kept it), so CI supplies the URL only via `prisma.config.ts` + the job `env:` block.
- **Singleton shape.** The `globalThis` guard is still Prisma's official Next.js pattern. Construct the **adapter inside the guard** — the official snippet builds it outside, which leaks a `pg` pool on every HMR reload.
- **Raw SQL for privilege/role changes:** Prisma's declarative schema cannot model `GRANT`/`REVOKE` — the append-only revoke (AD-18) is hand-authored SQL in a migration. Same `--create-only` path for CHECK constraints. Triggers and `CREATE FUNCTION` replay safely into the shadow database (they're schema-scoped and die with it); **roles do not** — see *Role provisioning*.
- **`percentile_cont`/`AVG`/window functions are banned for user-facing stats** (AD-2) — not a DDL concern, but note it: this schema is designed so the domain computes every statistic; don't add DB-side computed columns/views for medians etc.

### Neon / Postgres 18 & the integration harness

[Source: ARCHITECTURE-SPINE.md#Deployment (lines 289-297), #AD-24; 1-2 story]

- **Postgres 18**, pinned across all environments (a Neon branch inherits its parent major; local must match). Region `aws-ap-southeast-1` (Singapore) — Neon has no India region; irrelevant to schema code (the repository port isolates the provider; only `DATABASE_URL` changes if the host swaps). [Source: spine line 297]
- **Disposable DB for integration tests:** a Neon branch **or** a local Postgres 18. **Never a mock.** [Source: AD-24]
- **Keep the unit suite pure:** `vitest.config.ts` includes `tests/**/*.{test,spec}.ts` and must stay DB/clock/network-free (AD-23). That glob **does** match `tests/integration/foo.test.ts`, so putting integration tests there without narrowing `include` silently folds them into `npm run test` *and* the coverage gate. Either narrow the unit `include` or use a distinct top-level dir (as `e2e/` does for a11y). Give the integration run its **own** config (`vitest.integration.config.ts`) and script (`test:integration`) so `npm run test` never touches the DB. [Source: 1-2 Testing standards; AD-23/AD-24]
- **CI:** GitHub Actions `services:` can run `postgres:18` (the image exists; `18`, `18-alpine`, `18.4` tags are live). Standard shape — `POSTGRES_PASSWORD` in the service `env`, `--health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5`, `ports: 5432:5432`, then `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres?schema=public` in the **job** `env:` (not on the CLI — `migrate deploy` has no `--url`). The container's `postgres` role is superuser, which satisfies `migrate dev`'s `CREATEDB` requirement; the runtime app role must be a *second*, non-owning role. Coverage/mutation stay on the pure suite — do **not** fold DB tests into them.
- **Prisma 7 + Postgres 18 compatibility is confirmed:** Prisma lists PostgreSQL 9.6–18 as supported, and `@prisma/adapter-pg@7.8.0` bundles `pg ^8.16.3`, which speaks Postgres 18's default SCRAM-SHA-256 auth.

### Files being modified / created (read the current state first)

- `package.json` — scripts `dev/build/start/lint/typecheck/test/test:watch/test:coverage/test:mutation/test:a11y`; **no `postinstall` exists yet**; every pin is exact and deps are alphabetical. **Add:** `test:integration`, a `db:generate`/`db:migrate` convenience (optional), and `postinstall: prisma generate`. **Add deps:** `@prisma/client@7.8.0` + `@prisma/adapter-pg@7.8.0` (dependencies), `prisma@7.8.0` (devDependencies), exact pins. Do not upgrade any existing pin.
- `prisma.config.ts` — **create** at the repo root. Holds the connection URL and `import "dotenv/config"`. Prisma 7 requires it (see *Prisma 7 mechanics*).
- `prisma/schema.prisma` — **create** (currently only `prisma/README.md`, an empty seam explicitly reserving this file for 1-3 and `seed.ts` for Epic 12). `prisma/migrations/` — **create** with the initial migration. Consider `prisma/sql/bootstrap-roles.sql` per *Role provisioning*.
- `src/adapters/db/` — currently only `README.md` (seam; import rule `application, domain`). **Add** `client.ts` (singleton) and the generated client under `generated/`.
- `.github/workflows/ci.yml` — has jobs `check` (lint → typecheck → **build** → coverage; display name `Lint · Typecheck · Build · Unit + Coverage`), `mutation` (`Mutation testing (domain)`), `a11y` (`Accessibility (axe)`). Node comes from **`node-version-file: .nvmrc`**, not a literal `node-version:`. There is **no `services:` and no `env:` block anywhere today**. **Add** the `integration` job with a Postgres 18 service, mirroring the existing preamble/timeout/step-naming conventions.
- `eslint.config.mjs` — has import-boundary zones (`import/no-restricted-paths`) + a purity block + a repo-wide `Math.random` ban + a trailing ignores-only object. **Add** the generated-client dir to `ignores`; **extend** the purity block's `no-restricted-imports` to cover the generated path and `@prisma/adapter-pg`. ⚠️ Flat-config rule entries **replace, not merge** — a new block matching the pure layers wipes the nine purity selectors. Confirm adapters may still import Prisma freely (nothing blocks them today).
- `tsconfig.json` — `include: ["**/*.ts", …]`, `exclude` currently lists only tooling dirs. **Add** the generated-client dir to `exclude`, mirroring the ESLint ignores (the convention 1-1's review established).
- `vitest.config.ts` — resolves `@/*`, `include: ['tests/**/*.{test,spec}.ts']`, coverage over `src/domain` (100) + `src/application` (90) with a global floor of 90. **Do not** add DB tests here; keep it pure. **Narrow `include`** if you put integration tests under `tests/integration/**` — the current glob *would* sweep them in.
- `.gitignore` — has `.env`, `.env.*`, `!.env.example`, root-anchored build/test outputs. **Add** the Prisma generated-client dir. **`.env.example` does not exist yet — create it.**
- `README.md` — headings are `Prerequisites`, `Install`, `Commands` (table), `Continuous Integration` (gate table + a bolded **Branch protection:** list of the three required check names), `Source tree`, `Testing`. There is **no `## Setup`**. **Add** rows to both tables, the new job to the required-checks list, and a database/`DATABASE_URL` section. Note the source-tree block already promises `prisma/` and `adapters/db/` "from Story 1-3".
- `stryker.config.json` — mutates `src/domain/**` only; `ignorePatterns` lists tooling/output dirs but **no `prisma` or `generated` entry**. **Add** the generated client (Stryker copies the repo into a sandbox).

### Testing standards

[Source: ARCHITECTURE-SPINE.md#AD-23, #AD-24; project-context.md#Testing; 1-2 Testing standards]

- **Two suites, kept apart.** The **unit** suite (Vitest, `tests/**`) is fast, deterministic, DB/clock/network-free — coverage + mutation run over it. The **integration** suite is the *one place DB access is allowed*, runs under Vitest with its own config against real Postgres 18, and sits outside the unit glob. Never a mock (AD-24).
- **TDD for the DB invariants:** the REVOKE and CHECK are the testable pieces — assert them failing on a schema without the constraint, then add the migration to go green (AC 10). CI can't prove ordering; the commit sequence must show it.
- The integration test exercises **both** Decision-2 layers: as the **runtime application role** (proving the REVOKE) *and* as the **owner** (proving the trigger, which the REVOKE would otherwise mask). Testing only as the runtime role cannot tell you whether the trigger exists at all.
- Do not pull DB tests into coverage/mutation/`vitest run`. Note the coverage floor already carries a **90% per-path threshold on `src/application/**`** that is vacuous today (the layer has no source files) — it starts biting the moment a file lands there, so do not add an untested port/use-case stub as a convenience.
- **CI has never been observed green remotely.** 1-2's Task 7 records that the GitHub Actions run "has not yet been observed from this session," so 1-3 is the first story likely to surface CI-only breakage. Budget for it; don't assume a local green means a remote green.

### Project structure notes

- **Alignment:** the `prisma/` and `src/adapters/db/` seams from 1-1 are exactly where this lands; no tree changes beyond filling them. `prisma.config.ts` at the repo root is the one addition outside them, and the generated client is the one new (ignored) artifact — keep it inside `src/adapters/db/` so Law 2 holds structurally. `prisma/seed.ts` stays unwritten: the seam README assigns it to **Epic 12**.
- **Package manager:** npm; CI uses `npm ci` against the committed lockfile. Commit the updated `package-lock.json`. Deps are alphabetical and exactly pinned; `@prisma/client` and `@prisma/adapter-pg` are runtime `dependencies`, `prisma` is a `devDependency`.
- **Node/DB in CI:** Node 24, pinned via **`node-version-file: .nvmrc`** in every job (there is no literal `node-version:` to copy); Postgres 18 (pinned) via a service container. Local dev may run Node 22 (per 1-1/1-2 notes, which expect the `EBADENGINE` warning) — CI is the source of truth.
- **Recording decisions:** there is no separate decision log. Implementation decisions go in this story's **Completion Notes**, deviations from a recommended version get a rationale line (as 1-2 did for `eslint-import-resolver-typescript@3.10.1`), and anything punted goes to `docs/implementation-artifacts/deferred-work.md` under a `## Deferred from: …` heading naming the file and the re-entry condition.
- **Commits:** `type(scope): subject (story 1-3)`, and each commit must be self-consistent — 1-2's review made this a formal resolution, so a commit that adds a CI job may not reference a script that lands in a later commit.
- **No deploy wiring:** `migrate deploy`-at-build is documented intent; actual Vercel/Neon provisioning is a later story (1-2 marked it out of Epic 1's current stories).

### Anti-patterns to avoid (this story's traps)

**Prisma 7 traps (every one of these is a v6 habit that fails in 7.8.0):**

- ❌ `datasource db { url = env("DATABASE_URL") }` → `url` was removed from the datasource block; it lives in `prisma.config.ts`.
- ❌ `import { PrismaClient } from "@prisma/client"` → the generator emits to your `output` dir; import `from "<output>/client"` (the `/client` suffix is required).
- ❌ `new PrismaClient()` with no driver adapter, or reaching for `datasources`/`datasourceUrl` → adapters are mandatory in v7 and those constructor options are gone.
- ❌ `provider = "prisma-client-js"` → deprecated; use `prisma-client`. And `output` is required, not optional.
- ❌ Assuming `.env` loads itself, or reaching for `PRISMA_SKIP_POSTINSTALL_GENERATE` → v7 loads nothing automatically and removed the whole `PRISMA_*` family.
- ❌ Assuming `migrate dev` regenerates the client → nothing auto-generates in v7; run `prisma generate` explicitly.
- ❌ `prisma migrate deploy --url …` → no `--url` flag in v7 (`migrate dev` kept it; `deploy` did not).
- ❌ `CREATE ROLE IF NOT EXISTS` → **not valid PostgreSQL syntax at all.** Use a `DO $$ … pg_roles … $$` guard.
- ❌ A bare `CREATE ROLE` in a migration → roles are cluster-wide and survive the shadow DB, so `migrate dev` replay dies with `P3006 role already exists` (prisma#6581, still open).
- ❌ `@default(uuid(7))` on `employee.id` as a "compliant" shortcut → that is Prisma generating the id, not the id port. AD-10 wants the caller to supply it.
- ❌ Forgetting `updated_at` in a raw SQL insert → `@updatedAt` is client-side only; a `NOT NULL` column with no DB default rejects the insert.
- ❌ Excluding the generated client from four gates but not `tsconfig.json` → it is `.ts` source under `src/`, and `tsc --noEmit` will compile it.
- ❌ Appending a new ESLint block that carries `no-restricted-syntax`/`no-restricted-imports` for the pure layers → flat-config **replaces** rule entries; you will silently delete all nine purity selectors. Extend the existing block.
- ❌ Trusting the `@prisma/client` import ban to catch a domain leak → under v7 a leak imports the generated path, which lints clean until you extend the rule.
- ❌ Instantiating the Prisma client at module scope somewhere the Next build reaches → `check` and `a11y` build the app with no database and will break.

**Data-model traps:**

- ❌ Enforcing append-only **only** in application code → Law 5/AD-18 demands it at the **DB**. Prove it there.
- ❌ Shipping the REVOKE without the trigger (or vice versa) → Decision 2 ratified **both**. The REVOKE alone is silently void if the app connects as the table owner; the trigger alone doesn't match AD-18's wording.
- ❌ Proving append-only **only** as the runtime role → layer A fires first and masks whether the trigger works at all. Assert as the owner too, so layer B is proven independently.
- ❌ A trigger that also fires on `INSERT` → it must be `BEFORE UPDATE OR DELETE` only; appends must stay free.
- ❌ Seeding reference values or a `settings` row here → Decision 1 ratified those to **1-4**. The integration suite builds its own fixtures.
- ❌ `gen_random_uuid()` / a DB default on `employee.id` → generation is the id port's (AD-10); the column has **no** DB default.
- ❌ Using `created_at` (or any timestamp) as an ordering/tie-break key → `(effective_from, seq)` only (AD-8); `created_at` is audit-only.
- ❌ Ordering by `id` anywhere → a uuid has no meaningful sort; `seq` is the monotonic key (AD-8).
- ❌ Adding `updated_at` to `salary_record` "for consistency" → UPDATE is revoked; the column could never change (Decision 3).
- ❌ Adding `is_active` to `employee` or `salary_record` → AD-16 owns population membership; a soft-delete flag is an AD-18 violation (Decision 3).
- ❌ Letting reference-table `is_active` filter **statistics** → it gates pickability for *new* writes only; existing employees on a retired role keep their peer group and their place in every count (Decision 3).
- ❌ Dropping the `UNIQUE (from_currency, to_currency, pinned_on)` on `fx_rate` because `id` is now the PK → that UNIQUE is what enforces AD-13's rate-set integrity.
- ❌ Pointing child FKs at a reference table's surrogate `id` instead of its `code` → AD-4's Money carries the ISO-4217 **code**; peer identity must be readable without a join.
- ❌ Adding `image_url`/avatar/photo to `employee` → explicitly struck by `reconcile-stitch.md` line 57 as "invented data the product cannot have".
- ❌ A UNIQUE constraint on `employee.name` → 10,000 people collide; the UUID is the identity, the name is display only.
- ❌ `TIMESTAMP`/`TIMESTAMPTZ` for `hire_date`/`effective_from`/`pinned_on` → calendar `DATE` only (Law 6).
- ❌ Float/`double precision` for `amount_minor` or `rate` → `BIGINT` minor units; `NUMERIC` for FX (AD-4, AD-13).
- ❌ Modeling a `pay_band`/`midpoint`/`compa_ratio`/`snapshot` column → Law 3 bans the vocabulary; the addendum's comp metrics are research context, not our schema.
- ❌ A `peer_group` table, an outlier/findings table, or seen/dismissal columns → derived/computed fresh, never stored (AD-2, AD-12).
- ❌ Seeding the 10,000-employee population, or inventing role/level/country values, here → Epic 12 owns the population; all reference values are **1-4's** (Decision 1).
- ❌ Letting the Prisma client leak into `domain`/`application`, or letting DB tests into the unit/coverage/mutation run → boundary lint + suite separation must hold.
- ❌ Adding `@prisma/client` to `devDependencies` (it's a runtime `dependency`) or caret/tilde pins → exact pins; correct dependency section (AC 1).
- ❌ Wiring Vercel/Neon deploy here → out of scope; document the `migrate deploy` intent only.

### References

- [Source: docs/project-context.md#The-Laws] — Laws 1 (TDD + coverage floor + mutation testing), 2 (functional core), 3 (vocabulary; bans `snapshot`, `compaRatio`, `payBand`; gender exactly `MALE`/`FEMALE`), 4 (**currency presence only** — the positive-amount CHECK is AD-4, not Law 4), 5 (append-only), 6 (determinism/UTC — the calendar-`DATE` rule is **Conventions**, not Law 6). Conventions also carry naming, the Config rule (**AD-19**), and "Domain functions are total — they never throw."
- [Source: docs/project-context.md#Testing, #Workflow] — "Integration tests are separate and run against a real disposable Postgres 18 … never a mock; this is the one place DB access is allowed"; the backend-story DoD requires "at least one adapter integration test against real Postgres 18 where the story touches persistence."
- [Source: docs/planning-artifacts/architecture/architecture-payroll-2026-07-17/ARCHITECTURE-SPINE.md#Structural-Seed] — ER diagram, table list, zero-or-more salary, peer-group-is-not-a-table, source tree, deployment table.
- [Source: ...ARCHITECTURE-SPINE.md#AD-4] — `amount_minor > 0` CHECK; minor units; exponent on currency table.
- [Source: ...ARCHITECTURE-SPINE.md#AD-6] — currency on record; immutable country.
- [Source: ...ARCHITECTURE-SPINE.md#AD-8] — `seq` BIGSERIAL; `created_at` not a tie-break.
- [Source: ...ARCHITECTURE-SPINE.md#AD-10] — UUIDv7 id generated in shell (no DB default).
- [Source: ...ARCHITECTURE-SPINE.md#AD-13] — `fx_rate (from_currency, to_currency, rate NUMERIC, pinned_on DATE)`; settings.reporting_currency.
- [Source: ...ARCHITECTURE-SPINE.md#AD-18] — UPDATE/DELETE revoked by migration; append-only.
- [Source: ...ARCHITECTURE-SPINE.md#AD-19] — single-row settings holds threshold default.
- [Source: ...ARCHITECTURE-SPINE.md#AD-24] — integration test vs real disposable Postgres 18, never a mock; backend-done gate; standing rails.
- [Source: ...ARCHITECTURE-SPINE.md#Consistency-Conventions] — snake_case singular tables; DATE vs timestamp; money always {amountMinor, currency}; config in settings not env.
- [Source: ...reviews/review-reconcile-spec.md] — F-3 (append-only via revoked grants **or** rule/trigger), F-4 (future-dating write check) — both predate AD-18 and are recorded CLOSED / PARTIALLY CLOSED by it in `review-verify-round3.md`. **AD-18 adopted the revoke, not the trigger alternative**; the trigger here is rk's ratified addition (Decision 2), and on any conflict the spine wins.
- [Source: docs/planning-artifacts/epics.md#Epic-1] — Foundation epic: "the full data model with reference tables and migrations"; Additional Requirements → Data model (line 63 — every element of it is covered by this story's schema), Repository contract (line 64) and Deployment/NFR11 (line 68) — **the latter two are bound to Epic 1 but owned by no story in 1-1…1-6; surfaced as a sprint-plan gap in the out-of-scope table, not absorbed here.** The backend-then-frontend rule for capability epics is line **117** (not 115, as sprint-status.yaml's derivation note has it).
- [Source: docs/implementation-artifacts/1-1-project-scaffold-and-source-tree.md] — `prisma/` + `src/adapters/db/` seams; currency reference → 1-4.
- [Source: docs/implementation-artifacts/1-2-ci-pipeline-and-gates.md] — CI gate structure; the integration-test harness explicitly handed to 1-3; boundary/purity/coverage/mutation scoping to mirror.
- [Source: docs/planning-artifacts/briefs/brief-payroll-2026-07-16/addendum.md] — grid sizing (~25 roles × 6 levels × 8 countries); comp vocabulary is **research context, banned in schema** (Law 3).
- [Source: docs/specs/spec-payroll/SPEC.md#Assumptions] — "Employee attributes are role, level, country, currency, gender, hire date, and an identifying name. The source brief does not enumerate an exhaustive field list." Relevant non-goals, verbatim: "Authentication and permissions" (so no `created_by`/`modified_by`) and "Employee and manager self-service. One user." **The SPEC says nothing about departure or termination** — the absence of a termination/`is_active` concept on `employee` rests on **AD-16** (population membership is `hire_date` + salary-record based) and Decision 3, not on a SPEC non-goal. SPEC line 77 names only role and level as reference tables (see Decision 1).
- [Source: docs/planning-artifacts/ux-designs/ux-payroll-2026-07-16/reconcile-stitch.md] — line 57 **DROPs** employee headshots ("the data model holds no photo; invented data the product cannot have"); committed employee form field list (name, role, level, country, gender, hire date).
- [Source: ...ux-payroll-2026-07-16/EXPERIENCE.md] — Notes for Architecture item 5 (a deterministic same-date tie-break must exist → `seq`); findings are "**Fresh every visit — a pure function of data + threshold + as-of date.** No seen/unseen state, no dismissal, no acknowledgement"; timeline "% change and `(Hire)` label are **derived, not stored**"; the committed employee form field list (name, role, level, country, gender, hire date). Note: **no UX document states "no archive/deactivate/delete affordance"** — no such affordance appears on any surface, but that is an observation, not a citation; the binding reason not to add `is_active` to `employee` is AD-16 (Decision 3).
- [Source: ...ux-payroll-2026-07-16/reconcile-stitch.md] — line 57 **DROPs** employee headshots ("the data model holds no photo; invented data the product cannot have"); the same row keeps a user-account avatar in headers as harmless chrome, which is app shell, not employee data. Line 97 flags the unresolved level-vocabulary conflict; §4 item 6 flags country-based import rejection as unresolved.
- [Source: ...ux-payroll-2026-07-16/imports/stitch/screen-02-employees.html lines 287–293] — Employees list columns (Name · Role · Level · Country · Gender · Hire Date · Current Salary). **Sourced from a mock, which is non-normative** — EXPERIENCE.md line 12: "On any conflict, this spine and DESIGN.md win over the mocks." DESIGN.md itself specifies no column list. Likewise `level.rank`: **no UX document mentions ordering or a rank**; the column is justified by the gender-by-level chart's L1→M3 row order in `screen-05-gender-insights.html` and by preventing level inversion, not by a DESIGN.md rule.
- [Source: docs/implementation-artifacts/sprint-status.yaml] — sequence 1-1 (done) → 1-2 (done) → 1-3 (this) → 1-4.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
