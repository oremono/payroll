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

-- The runtime role connects and reads the schema, but owns nothing: it must NOT be the migration
-- role. `prisma migrate dev` requires CREATEDB for its shadow database, which this role
-- deliberately lacks — a second reason the two roles can never be the same one.
GRANT CONNECT ON DATABASE payroll TO payroll_app;
GRANT USAGE ON SCHEMA public TO payroll_app;
