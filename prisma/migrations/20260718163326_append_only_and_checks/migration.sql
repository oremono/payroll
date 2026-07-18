-- Database-enforced invariants (Story 1-3). Hand-authored: Prisma 7.8.0 has no declarative CHECK
-- (`@@check` does not exist) and cannot model GRANT/REVOKE or triggers at all, so this migration
-- was created with `prisma migrate dev --create-only` and written by hand.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Preflight: the runtime role must exist before anything below can reference it
-- ─────────────────────────────────────────────────────────────────────────────
-- Without this guard the first GRANT fails with the bare `role "payroll_app" does not exist`,
-- Prisma records the migration as FAILED (P3018), and every subsequent deploy refuses to run until
-- a human executes `prisma migrate resolve` — a build-blocking manual intervention on the exact
-- code path story 1-7 will wire into the Vercel build against a fresh Neon branch.
--
-- This cannot create the role itself: roles are cluster-wide and outlive `migrate dev`'s shadow
-- database, so a CREATE ROLE here dies on replay with P3006 (prisma/prisma#6581). It can only fail
-- EARLY and LEGIBLY, naming the fix. (Code review 2026-07-18.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payroll_app') THEN
    RAISE EXCEPTION
      'Runtime role "payroll_app" does not exist. Run prisma/sql/bootstrap-roles.sql against this database BEFORE applying migrations — see README section Database.'
      USING ERRCODE = 'AP002';
  END IF;
END
$$;
--
-- Everything below is an invariant the DATABASE holds, not a promise application code makes. That
-- is the point: Law 5 and AD-4 are enforced mechanically, not by developer discipline.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A salary is strictly positive (AD-4)
-- ─────────────────────────────────────────────────────────────────────────────
-- AD-4: "salary_record.amount_minor > 0 is a database CHECK and a write-time validation." This is
-- the CHECK half; the write-time validation is the write layer's (a later story).
ALTER TABLE "salary_record"
  ADD CONSTRAINT "salary_record_amount_minor_positive" CHECK ("amount_minor" > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. settings holds at most one row (AD-19)
-- ─────────────────────────────────────────────────────────────────────────────
-- The single-row guard: the PK is a fixed integer and this CHECK pins it to 1, so a second row is
-- impossible regardless of what any caller attempts. The table ships EMPTY — the default row
-- (threshold 20 and a reporting_currency) is Story 1-4's, because reporting_currency is an FK and
-- needs currencies to exist first (Decision 1).
ALTER TABLE "settings"
  ADD CONSTRAINT "settings_single_row" CHECK ("id" = 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Append-only, layer B — the trigger (Law 5 / AD-18, Decision 2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Layer A (the privilege REVOKE below) is the literal AD-18 mechanism, but it has a SILENT FAILURE
-- MODE: PostgreSQL lets a table OWNER bypass privilege checks entirely. If the application ever
-- connects as the owner — easy to do accidentally on Neon, where the default role owns everything
-- — the REVOKE becomes a no-op and the invariant is unenforced while every test still passes
-- green. This trigger holds regardless of role, ownership, or connection string.
--
-- BEFORE UPDATE OR DELETE only: it must NEVER fire on INSERT, or appends would pay for it.
-- Triggers and functions are schema-scoped, so they replay safely into `migrate dev`'s shadow
-- database and die with it — unlike roles, which are cluster-wide (see bootstrap-roles.sql).
CREATE OR REPLACE FUNCTION "salary_record_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'salary_record is append-only (Law 5 / AD-18): % is not permitted. Append a new record dated today instead.',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "salary_record_append_only"
  BEFORE UPDATE OR DELETE ON "salary_record"
  FOR EACH ROW
  EXECUTE FUNCTION "salary_record_append_only"();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Append-only, layer A — the privilege revoke (Law 5 / AD-18, Decision 2)
-- ─────────────────────────────────────────────────────────────────────────────
-- The runtime application role must already EXIST — `REVOKE ... FROM payroll_app` on a nonexistent
-- role errors outright. It is provisioned by prisma/sql/bootstrap-roles.sql, run once per cluster
-- BEFORE migrations. Role creation is deliberately NOT in a migration: roles are cluster-wide and
-- survive `migrate dev`'s shadow database, so a bare CREATE ROLE dies on replay with
-- `P3006 role already exists` (prisma/prisma#6581, open since 2021).
--
-- GRANT/REVOKE themselves are idempotent and replay safely once the role exists.
--
-- USAGE on the schema is a prerequisite for every table grant below — without it the runtime role
-- cannot even NAME a table, and every query fails with `relation "..." does not exist` rather than
-- a permission error, while `prisma migrate status` still reports a healthy database.
--
-- It is granted HERE, not in bootstrap-roles.sql, precisely because it is schema-scoped: dropping
-- and recreating the schema (a reset, a rebuild, a fresh deploy) silently revokes it, and only a
-- grant that replays with the migrations is re-applied.
GRANT USAGE ON SCHEMA public TO "payroll_app";

-- Tables are enumerated rather than using ALL TABLES IN SCHEMA public, so Prisma's internal
-- _prisma_migrations table is never granted to the runtime role.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "employee", "role", "level", "country", "currency", "fx_rate", "settings"
  TO "payroll_app";

-- salary_record is granted SELECT and INSERT only. The REVOKE that follows is what AD-18 names
-- literally, and it is load-bearing rather than decorative: it also strips any UPDATE/DELETE a
-- previous grant may have left in place on an existing database.
GRANT SELECT, INSERT ON "salary_record" TO "payroll_app";
REVOKE UPDATE, DELETE ON "salary_record" FROM "payroll_app";

-- salary_record.seq is BIGSERIAL — an INSERT calls nextval() on its sequence, which requires
-- USAGE. Without this, appends fail with "permission denied for sequence".
GRANT USAGE, SELECT ON SEQUENCE "salary_record_seq_seq" TO "payroll_app";
