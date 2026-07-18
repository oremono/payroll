-- Runtime application role provisioning (Story 1-3, Law 5 / AD-18).
--
-- Run this ONCE per database cluster, as a superuser/owner, BEFORE `prisma migrate deploy`.
-- It is idempotent — re-running it is safe.
--
--   docker exec -i payroll-pg18 psql -U postgres -d payroll < prisma/sql/bootstrap-roles.sql
--
-- WHY THIS IS NOT A MIGRATION
-- ---------------------------
-- Roles are CLUSTER-WIDE, not database-scoped. `prisma migrate dev` creates a throwaway shadow
-- database on the SAME cluster and replays the entire migration history into it — so a bare
-- `CREATE ROLE` in a migration succeeds the first time and then dies with
-- `P3006: role "payroll_app" already exists` on the second run, because the role outlived the
-- shadow database that "created" it. That is prisma/prisma#6581, open since 2021; there is no
-- Prisma-side fix coming. Provisioning is an infrastructure concern, so it lives here as an
-- explicit step (a CI job step; a documented one-liner locally; the Neon console in deployed
-- environments) and only the GRANT/REVOKE — which are idempotent and replay safely once the role
-- exists — live in the migration.
--
-- Note also: PostgreSQL has NO `CREATE ROLE IF NOT EXISTS`. That syntax does not exist and fails
-- with a syntax error despite being widely repeated. The `DO` block below is the correct guard.
--
-- SECURITY NOTE: the password here is a LOCAL DEVELOPMENT credential only. Deployed environments
-- provision this role through their own console/secret manager and never run this file verbatim.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payroll_app') THEN
    CREATE ROLE payroll_app LOGIN PASSWORD 'payroll_app';
  END IF;
END
$$;

-- The runtime role connects but owns nothing: it must NOT be the migration role. `prisma migrate
-- dev` requires CREATEDB for its shadow database, which this role deliberately lacks — a second
-- reason the two roles can never be the same one.
--
-- CONNECT is database-scoped, so it survives a schema drop and belongs here. USAGE ON SCHEMA
-- public deliberately does NOT live here: it is schema-scoped, so recreating the schema silently
-- revokes it and the runtime role goes blind — `relation "salary_record" does not exist` — even
-- though `prisma migrate status` reports a healthy database. It lives in the migration instead,
-- alongside the table grants, so it is re-applied every time the schema is rebuilt.
--
-- The database NAME is resolved at runtime rather than hardcoded: it is `payroll` locally and in
-- CI, but Neon's default is `neondb`, and a literal would fail there with `database "payroll" does
-- not exist` — leaving the role created but unable to connect. `format`/`%I` quotes the identifier
-- correctly, and EXECUTE is required because GRANT does not accept an expression for the database.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO payroll_app', current_database());
END
$$;
