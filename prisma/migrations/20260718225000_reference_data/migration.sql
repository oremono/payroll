-- Reference-data values (Story 1-4). Hand-authored: there is no schema change here, so
-- `prisma migrate dev` would emit nothing — this directory was created by hand, which is the
-- normal shape of a DATA migration.
--
-- WHY THESE VALUES SHIP AS A MIGRATION, NOT AS A SEED COMMAND
-- -----------------------------------------------------------
-- They are FK TARGETS. `employee.role_code`, `employee.level_code`, `employee.country_code`,
-- `salary_record.currency_code`, and `settings.reporting_currency` all point at rows below, and
-- free text is accepted nowhere — so until these exist, no employee, no import, and no seed can
-- be written at all. They must therefore be present in local, CI, preview, and production alike,
-- and `prisma migrate deploy` is the only mechanism that already reaches all four (it runs at the
-- Vercel build; see story 1-7).
--
-- This does NOT contradict Epic 12's "seeding is a command, never a deploy side effect". That
-- governs the 10,000-row POPULATION (prisma/seed.ts, drawn from a seeded PRNG per AD-14), which
-- is sample data a deploy must never invent. Reference values are schema-shaped configuration the
-- application cannot function without. Different things, different vehicles.
--
-- EVERY STATEMENT IS `ON CONFLICT DO NOTHING`, deliberately without a conflict TARGET so it covers
-- every unique constraint on the table, including the case-insensitive lower(code) indexes added
-- in the preceding migration. `migrate deploy` re-running this must be a no-op, or a redeploy
-- breaks the build. tests/integration/reference-data.test.ts executes this exact file a second
-- time and asserts the row counts are unchanged.
--
-- GRANTS: no new table and no new column, so nothing to grant. `payroll_app` already holds
-- SELECT, INSERT, UPDATE, DELETE on all five tables from 20260718163326 (reference tables are
-- editable; only salary_record is append-only).
--
-- The taxonomy itself is a DRAFT the dev agent was authorized to author (1-3 Decision 1); the
-- cardinalities (6 levels / 8 countries / 25 roles) are ratified. Ratification of the specific
-- values is an open item in docs/implementation-artifacts/deferred-work.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Currencies (8)
-- ─────────────────────────────────────────────────────────────────────────────
-- Every code is attested in the UX mock copy. JPY carries minor_unit_exponent 0 on purpose: it is
-- the case that proves the one money formatter never hard-codes 100 (Law 4 / AD-4), and it is
-- asserted as such in both the domain suite and the integration suite.
--
-- INR is the only INDIAN grouping — ₹21,50,000, not ₹2,150,000. USD and CAD deliberately SHARE
-- the `$` symbol, which is why the symbol is data on the row rather than derived from the code.
-- No fx_rate rows are seeded here: FX is AD-13 and belongs to Epic 10.
INSERT INTO "currency" ("code", "name", "minor_unit_exponent", "symbol", "grouping_style") VALUES
  ('INR', 'Indian Rupee',        2, '₹',  'INDIAN'),
  ('USD', 'US Dollar',           2, '$',  'WESTERN'),
  ('GBP', 'Pound Sterling',      2, '£',  'WESTERN'),
  ('EUR', 'Euro',                2, '€',  'WESTERN'),
  ('JPY', 'Japanese Yen',        0, '¥',  'WESTERN'),
  ('BRL', 'Brazilian Real',      2, 'R$', 'WESTERN'),
  ('NOK', 'Norwegian Krone',     2, 'kr', 'WESTERN'),
  ('CAD', 'Canadian Dollar',     2, '$',  'WESTERN')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Countries (8)
-- ─────────────────────────────────────────────────────────────────────────────
-- One currency each (AD-6): salary_record.currency_code is written from the employee's country at
-- write time and never re-resolved at read time. ISO-3166-1 alpha-2 codes.
INSERT INTO "country" ("code", "name", "currency_code") VALUES
  ('IN', 'India',          'INR'),
  ('US', 'United States',  'USD'),
  ('GB', 'United Kingdom', 'GBP'),
  ('DE', 'Germany',        'EUR'),
  ('JP', 'Japan',          'JPY'),
  ('BR', 'Brazil',         'BRL'),
  ('NO', 'Norway',         'NOK'),
  ('CA', 'Canada',         'CAD')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Levels (6, rank 1-6)
-- ─────────────────────────────────────────────────────────────────────────────
-- The mocks' L1-L8 + M1-M3 ladder reconciled down to the ratified cardinality of six. `rank`
-- orders the gender-distribution-by-level chart and is UNIQUE (a determinism guard from 1-3's
-- review), so the seeded ladder owns ranks 1-6 outright and every test fixture rank in the repo
-- sits far above them.
--
-- No level name repeats a role name: the ladder is `level`, and seniority never appears in `role`.
INSERT INTO "level" ("code", "name", "rank") VALUES
  ('L1', 'Associate', 1),
  ('L2', 'Mid',       2),
  ('L3', 'Senior',    3),
  ('L4', 'Staff',     4),
  ('M1', 'Manager',   5),
  ('M2', 'Director',  6)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Roles (25)
-- ─────────────────────────────────────────────────────────────────────────────
-- Job FAMILIES spanning engineering, product, design, data, sales, marketing, finance, people,
-- operations, legal, and support. The first five are the ones the Settings mock enumerates
-- verbatim.
--
-- No level or seniority word appears in any name — no "Senior", no "Junior", no "Lead", no
-- roman-numeral suffix. A peer group is (role, level, country); encoding seniority in the role
-- would split each group in two and quietly push both halves under the n >= 5 refusal floor.
INSERT INTO "role" ("code", "name") VALUES
  ('software_engineer',           'Software Engineer'),
  ('product_manager',             'Product Manager'),
  ('data_scientist',              'Data Scientist'),
  ('designer',                    'Designer'),
  ('sales_executive',             'Sales Executive'),
  ('quality_engineer',            'Quality Engineer'),
  ('site_reliability_engineer',   'Site Reliability Engineer'),
  ('security_engineer',           'Security Engineer'),
  ('data_engineer',               'Data Engineer'),
  ('data_analyst',                'Data Analyst'),
  ('ux_researcher',               'UX Researcher'),
  ('technical_writer',            'Technical Writer'),
  ('solutions_architect',         'Solutions Architect'),
  ('program_manager',             'Program Manager'),
  ('business_analyst',            'Business Analyst'),
  ('marketing_specialist',        'Marketing Specialist'),
  ('content_strategist',          'Content Strategist'),
  ('account_manager',             'Account Manager'),
  ('sales_engineer',              'Sales Engineer'),
  ('customer_support_specialist', 'Customer Support Specialist'),
  ('financial_analyst',           'Financial Analyst'),
  ('recruiter',                   'Recruiter'),
  ('people_partner',              'People Partner'),
  ('operations_specialist',       'Operations Specialist'),
  ('legal_counsel',               'Legal Counsel')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The single settings row (AD-19)
-- ─────────────────────────────────────────────────────────────────────────────
-- Threshold 20 is the SPEC's stated default; it is PERSISTED DATA read once at the delivery
-- boundary and passed inward as a parameter, never env and never read inside the math.
-- reporting_currency is the AD-13 conversion target — exactly one, never inferred — and it is an
-- FK, which is why this row could not ship with 1-3: the currencies above had to exist first.
--
-- id is pinned to 1 by the settings_single_row CHECK, so the ON CONFLICT below is a PK conflict
-- and this statement can never create a second row.
INSERT INTO "settings" ("id", "outlier_threshold_pct", "reporting_currency") VALUES
  (1, 20, 'USD')
ON CONFLICT DO NOTHING;
