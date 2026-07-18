-- Runtime application role provisioning (Story 1-3, Law 5 / AD-18).
--
-- Run this ONCE per database cluster, as a superuser/owner, BEFORE `prisma migrate deploy`.
-- It is idempotent — re-running it is safe, and a re-run with a different password CORRECTS the
-- existing role rather than silently doing nothing.
--
--   PGPASSWORD=postgres psql -h localhost -p 55432 -U postgres -d payroll \
--     -v ON_ERROR_STOP=1 -v payroll_app_password="$PAYROLL_APP_PASSWORD" \
--     -f prisma/sql/bootstrap-roles.sql
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
-- THE PASSWORD COMES FROM THE ENVIRONMENT, and this file fails loudly without it.
--
-- It previously hardcoded the literal 'payroll_app' — a password equal to the role name, protected
-- only by a comment saying deployed environments "never run this file verbatim", while README,
-- CI, and deferred-work.md all hand this exact file forward as THE provisioning artifact,
-- including for story 1-7's Neon branches. A guessable production credential was one copy-paste
-- away. (Code review 2026-07-18.)
--
--   psql -v ON_ERROR_STOP=1 -v payroll_app_password="$PAYROLL_APP_PASSWORD" \
--        -h host -U postgres -d payroll -f prisma/sql/bootstrap-roles.sql
--
-- Passed as a psql variable rather than read with \getenv, because \getenv needs psql 16+ and this
-- file must run on whatever client the operator has (Ubuntu 22.04 ships psql 14). The default
-- below only fires when the caller omitted the variable, and the DO block then refuses — an unset
-- variable would otherwise be a raw syntax error, which is a confusing way to learn you forgot it.
\if :{?payroll_app_password}
\else
  \set payroll_app_password ''
\endif

-- The ELSE branch matters as much as the IF. With only the existence guard, a corrective re-run
-- against a cluster where the role already exists with a wrong or default password was a SILENT
-- NO-OP: the script reported success while the credential stayed wrong. Now an existing role is
-- brought into line with the supplied password on every run, which is what makes this idempotent
-- in the useful sense rather than merely non-erroring.
--
-- ALTER ROLE also repairs a role that exists WITHOUT LOGIN (e.g. created by another project), which
-- would otherwise authenticate-fail at runtime with the bootstrap reporting success.
-- Handed to the DO block through a session setting, NOT interpolated into it: psql does not
-- substitute :'variables' inside dollar-quoted strings, so `pw text := :'payroll_app_password'`
-- reaches the server as a literal colon and fails with a bare "syntax error at or near :".
SELECT set_config('payroll.app_password', :'payroll_app_password', false) \g /dev/null

DO $$
DECLARE
  pw text := current_setting('payroll.app_password', true);
BEGIN
  IF pw IS NULL OR length(pw) = 0 THEN
    RAISE EXCEPTION
      'PAYROLL_APP_PASSWORD was not supplied. Re-run with: psql -v ON_ERROR_STOP=1 -v payroll_app_password="$PAYROLL_APP_PASSWORD" -f prisma/sql/bootstrap-roles.sql'
      USING ERRCODE = 'AP003';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payroll_app') THEN
    EXECUTE format('CREATE ROLE payroll_app LOGIN PASSWORD %L', pw);
  ELSE
    EXECUTE format('ALTER ROLE payroll_app LOGIN PASSWORD %L', pw);
  END IF;
END
$$;

-- Clear the credential from the session so it does not linger in this connection's settings.
SELECT set_config('payroll.app_password', '', false) \g /dev/null

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
