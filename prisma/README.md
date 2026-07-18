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

> **Adding a table in a later migration?** It inherits `SELECT, INSERT` for `payroll_app`
> automatically (and sequence `USAGE`). `UPDATE`/`DELETE` are deliberately **not** inherited —
> mutation is opt-in, so a new append-only table cannot silently acquire the rights Law 5 withholds.
> If the table genuinely needs them, grant them explicitly in that table's own migration.
- `sql/bootstrap-roles.sql` — provisions the restricted runtime role (`payroll_app`). Run **once
  per cluster, before migrations**. Deliberately not a migration: roles are cluster-wide and
  outlive `migrate dev`'s shadow database (prisma/prisma#6581).
- `seed.ts` — the 10,000-row population drawn from a seeded PRNG (AD-14). **Not yet written** —
  Epic **12** (CAP-11). It is a command, never a deploy side effect.

The reference tables and `settings` ship **empty**; their values are Story **1-4**'s.

See the root `README.md` § Database for local setup and the migration commands.
