-- Default privileges for the runtime application role (Story 1-3, code-review follow-up).
--
-- THE PROBLEM THIS SOLVES
-- -----------------------
-- The previous migration grants privileges to payroll_app by ENUMERATING the eight tables. That is
-- deliberate — it keeps Prisma's internal _prisma_migrations ungranted — but nothing keeps the list
-- in sync. A later story that adds a table and forgets a GRANT produces a runtime role that can see
-- the table (it has schema USAGE) but not read it: `permission denied for table ...`, surfacing
-- only in an environment that actually connects as payroll_app.
--
-- ALTER DEFAULT PRIVILEGES closes that gap for every table created FROM NOW ON by the role that
-- runs migrations. It is not retroactive, which is exactly why it is safe here: _prisma_migrations
-- already exists (Prisma creates it before applying any migration), so it is not covered.
--
-- WHY ONLY SELECT AND INSERT
-- --------------------------
-- SELECT + INSERT is the safe baseline every table needs. UPDATE and DELETE are deliberately NOT
-- granted by default, so a future append-only table does not silently inherit the mutation rights
-- that Law 5 exists to withhold. A table that genuinely needs them must say so explicitly in its
-- own migration — the same shape as the previous migration's enumerated grant. Mutation is opt-in;
-- readability is the default.
--
-- No FOR ROLE clause: default privileges attach to the current role, which is the migration owner —
-- the same role that will create every future table. Naming a literal owner would break on Neon,
-- where the owner is neondb_owner rather than postgres.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO "payroll_app";

-- BIGSERIAL and IDENTITY columns call nextval() on INSERT, which requires USAGE on the sequence.
-- Without this, a future table with a serial column would fail on its first append with
-- "permission denied for sequence ..." even though the table grant above succeeded.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO "payroll_app";
