# `prisma/`

The data model and its migration history. Authored in Story **1-3**.

- `schema.prisma` — the eight-table data model. Note the Prisma 7 shape: the `datasource` block
  carries **no `url`** (it lives in `/prisma.config.ts`), and the generator is `prisma-client`
  with a required `output` pointing into `src/adapters/db/generated/`.
- `migrations/` — the committed history:
  - `..._init` — the tables, keys, FKs, and indexes Prisma can express declaratively.
  - `..._append_only_and_checks` — everything it cannot: the `UPDATE`/`DELETE` revoke **and** the
    `BEFORE UPDATE OR DELETE` trigger that make `salary_record` append-only (Law 5 / AD-18), the
    `CHECK (amount_minor > 0)` (AD-4), and the single-row `settings` guard (AD-19).
  - `..._runtime_role_default_privileges` — `ALTER DEFAULT PRIVILEGES` so tables created by future
    migrations are readable by the runtime role without anyone remembering to grant them.
  - `..._currency_display_and_value_constraints` (Story **1-4**) — the `grouping_style` enum and
    `currency.symbol` / `currency.grouping_style`, plus the five value constraints deferred from
    1-3: the `minor_unit_exponent` and `outlier_threshold_pct` range CHECKs, non-blank CHECKs on
    `employee.name` and every reference `code`, case-insensitive unique indexes on `lower(code)`,
    and a `BEFORE INSERT` trigger (SQLSTATE `AP004`) refusing a `salary_record` whose
    `effective_from` precedes its employee's `hire_date`. That last one is a **trigger and not a
    CHECK** because a CHECK sees only its own row and `hire_date` lives on another table.
  - `..._reference_data` (Story **1-4**) — the reference **values**. See below.

> **Adding a table in a later migration?** It inherits `SELECT, INSERT` for `payroll_app`
> automatically (and sequence `USAGE`). `UPDATE`/`DELETE` are deliberately **not** inherited —
> mutation is opt-in, so a new append-only table cannot silently acquire the rights Law 5 withholds.
> If the table genuinely needs them, grant them explicitly in that table's own migration.
>
> **`SELECT, INSERT` only is the DEFAULT, not a blanket rule.** The append-only withholding that
> Law 5 / AD-18 demands is specific to `salary_record`, where `UPDATE`/`DELETE` are additionally
> **revoked**. The reference tables (`currency`, `country`, `role`, `level`, `settings`) hold full
> `SELECT, INSERT, UPDATE, DELETE` — granted by `..._append_only_and_checks` (1-3) and restated for
> `currency` by `..._currency_display_and_value_constraints` (1-4), because the Settings surface
> edits them. Do not "correct" those grants to match the default; read the table's own migration.
- `sql/bootstrap-roles.sql` — provisions the restricted runtime role (`payroll_app`). Run **once
  per cluster, before migrations**. Deliberately not a migration: roles are cluster-wide and
  outlive `migrate dev`'s shadow database (prisma/prisma#6581).
- `seed.ts` — the 10,000-row population drawn from a seeded PRNG (AD-14). **Not yet written** —
  Epic **12** (CAP-11). It is a command, never a deploy side effect.

## Reference values ship as a data migration, not a seed command

Story **1-4** lands 8 currencies, 8 countries, 6 levels, 25 roles, and the single `settings` row
(threshold 20, reporting currency `USD`) in `..._reference_data/migration.sql`. **Do not
re-litigate this.** The reasoning:

- They are **FK targets**. `employee.role_code`, `employee.level_code`, `employee.country_code`,
  `salary_record.currency_code`, and `settings.reporting_currency` all point at them, and free text
  is accepted nowhere. Until they exist, no employee, no import, and no seed can be written at all.
- They must therefore be present in **local, CI, preview, and production** alike, and
  `prisma migrate deploy` — which already runs at the Vercel build — is the only mechanism that
  reaches all four. An operator command reaches none of them reliably.
- This does **not** contradict Epic 12's "seeding is a command, never a deploy side effect". That
  governs the 10,000-row **population** (`seed.ts`, drawn from a seeded PRNG per AD-14), which is
  sample data a deploy must never invent. Reference values are configuration the application cannot
  function without. Different things, different vehicles.

Every statement is `ON CONFLICT DO NOTHING` **without a conflict target**, so it covers every unique
constraint on the table including the `lower(code)` indexes, and a re-applied migration is a no-op
rather than a broken redeploy. `tests/integration/reference-data.test.ts` executes that exact file a
second time and asserts the row counts do not change.

> **Adding a NOT NULL column to an existing table?** Add it **with** a temporary `DEFAULT` and then
> `DROP DEFAULT`, as `..._currency_display_and_value_constraints` does. Prisma's generated bare
> `ADD COLUMN ... NOT NULL` is only correct against an empty table, and the long-lived environments
> a migration must cross (the local container, the Neon `production` branch) hold integration
> fixture rows that **cannot be deleted** — the append-only trigger and `ON DELETE RESTRICT` FKs are
> the invariant working. A bare add fails there with "column contains null values", records the
> migration `FAILED` (P3018), and blocks every subsequent deploy until a human runs
> `prisma migrate resolve`. Dropping the default afterwards leaves the final column definition
> identical to `schema.prisma`, so the `migrate diff --exit-code` drift gate still passes.

See the root `README.md` § Database for local setup and the migration commands.
