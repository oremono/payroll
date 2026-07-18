-- Currency display columns + the five value constraints deferred from Story 1-3 (Story 1-4).
--
-- Sections 1-2 are declared in schema.prisma and would be emitted by `prisma migrate dev`; the
-- rest are hand-authored because Prisma 7.8.0 cannot model CHECK constraints, expression indexes,
-- or trigger functions. Created with `prisma migrate dev --create-only` and then written by hand,
-- per prisma/README.md.
--
-- The five constraints below are the block recorded in docs/implementation-artifacts/
-- deferred-work.md ("Five value constraints deferred to Story 1-4"). They land here rather than
-- in 1-3 because this story owns the reference VALUES they constrain, so this is the first point
-- at which each one can be proven against real data.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. GroupingStyle enum
-- ─────────────────────────────────────────────────────────────────────────────
-- Grouping is the formatter's job, driven by the currency reference table — `Intl` is banned from
-- src/domain/** because its output depends on the Node ICU build (Law 6). WESTERN groups in
-- threes; INDIAN holds the last three digits apart and groups the remainder in twos.
CREATE TYPE "grouping_style" AS ENUM ('WESTERN', 'INDIAN');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. currency.symbol + currency.grouping_style
-- ─────────────────────────────────────────────────────────────────────────────
-- Both are NOT NULL with NO default in the schema: a currency without a symbol or a grouping rule
-- cannot be rendered, and a default would let one exist silently.
--
-- They are nevertheless added WITH a temporary default which is then dropped. Prisma's generated
-- form (`ADD COLUMN ... NOT NULL` bare) is correct only against an EMPTY table, and `currency` is
-- empty only on a fresh database — the long-lived environments this migration must also cross
-- (the local container, the Neon production branch) already hold uniquely-suffixed fixture rows
-- planted by the integration suite, which cannot delete them (see tests/integration/schema.test.ts).
-- A bare NOT NULL add would fail there with "column contains null values", marking the migration
-- FAILED (P3018) and blocking every subsequent deploy until a human ran `prisma migrate resolve`.
--
-- Adding-then-dropping the default backfills those rows and leaves the FINAL column definition
-- identical to what schema.prisma declares, so `prisma migrate diff --exit-code` still reports no
-- drift. `¤` is the generic currency sign (U+00A4) — a legible placeholder that is obviously not
-- a real symbol, so a backfilled fixture row cannot be mistaken for reference data.
ALTER TABLE "currency" ADD COLUMN "symbol" TEXT NOT NULL DEFAULT '¤';
ALTER TABLE "currency" ALTER COLUMN "symbol" DROP DEFAULT;

ALTER TABLE "currency" ADD COLUMN "grouping_style" "grouping_style" NOT NULL DEFAULT 'WESTERN';
ALTER TABLE "currency" ALTER COLUMN "grouping_style" DROP DEFAULT;

-- New COLUMNS on an existing table inherit that table's privileges, and `currency` already holds
-- SELECT, INSERT, UPDATE, DELETE for payroll_app from 20260718163326 (it is reference data, not
-- append-only history). Re-granted explicitly anyway, because prisma/README.md's durable rule is
-- that every migration states its grants rather than relying on a reader to go and check.
GRANT SELECT, INSERT, UPDATE, DELETE ON "currency" TO "payroll_app";

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Deferred constraint 1/5 — currency.minor_unit_exponent range (AD-4)
-- ─────────────────────────────────────────────────────────────────────────────
-- A negative exponent renders every salary in that currency 100x wrong through the ONE money
-- formatter every capability epic consumes — src/domain/money.ts returns null rather than
-- rendering it, but nothing should be able to store it in the first place.
--
-- Zero is VALID and load-bearing: JPY has no minor unit, and it is the case that proves the
-- formatter never hard-codes 100 (Law 4 / AD-4). The upper bound is 4, the largest exponent
-- ISO-4217 defines (CLF); anything beyond it is a data-entry error, not a currency.
ALTER TABLE "currency"
  ADD CONSTRAINT "currency_minor_unit_exponent_range"
  CHECK ("minor_unit_exponent" >= 0 AND "minor_unit_exponent" <= 4);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Deferred constraint 2/5 — settings.outlier_threshold_pct range (AD-19)
-- ─────────────────────────────────────────────────────────────────────────────
-- The outlier flag tests |distance| > threshold STRICTLY (AD-5). A zero or negative threshold
-- therefore flags every employee whose salary differs from their peer median at all, which is
-- outlier detection made meaningless rather than merely wrong. Above 100 it can never flag
-- anything below the median (distance bottoms out at -100%), so the control would be half dead.
ALTER TABLE "settings"
  ADD CONSTRAINT "settings_outlier_threshold_pct_range"
  CHECK ("outlier_threshold_pct" > 0 AND "outlier_threshold_pct" <= 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Deferred constraint 3/5 — non-blank employee.name and reference `code`s
-- ─────────────────────────────────────────────────────────────────────────────
-- NOT NULL does not stop '' or '   '. A blank reference code is worse than a null one: it is a
-- valid FK target, so an employee can be created pointing at it and every peer comparison then
-- groups by an invisible value. `btrim` rather than a length test, so whitespace-only is caught.
--
-- The codes are not additionally forced to a case or a character set here — that is a write-layer
-- validation (CAP-2/AD-7), and a DB constraint guessing at a code grammar would refuse legitimate
-- values a later taxonomy adds. Blankness is the part that is unambiguously never valid.
ALTER TABLE "employee"
  ADD CONSTRAINT "employee_name_not_blank" CHECK (btrim("name") <> '');

ALTER TABLE "role"
  ADD CONSTRAINT "role_code_not_blank" CHECK (btrim("code") <> '');

ALTER TABLE "level"
  ADD CONSTRAINT "level_code_not_blank" CHECK (btrim("code") <> '');

ALTER TABLE "country"
  ADD CONSTRAINT "country_code_not_blank" CHECK (btrim("code") <> '');

ALTER TABLE "currency"
  ADD CONSTRAINT "currency_code_not_blank" CHECK (btrim("code") <> '');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Deferred constraint 4/5 — case-insensitive uniqueness on reference codes
-- ─────────────────────────────────────────────────────────────────────────────
-- The existing plain UNIQUE on each `code` lets 'usd' and 'USD' coexist as two distinct
-- currencies. Both would then be valid FK targets, so two employees in the same country could
-- carry different currency codes for the same money — and AD-13's per-country totals, which sum
-- each country in its own currency, would silently split into two buckets. The same argument
-- holds for role/level/country: a peer group is the (role, level, country) triple, so a duplicate
-- differing only in case halves a peer group and can push it under the n >= 5 refusal floor.
--
-- An expression index on lower(code), NOT a citext column: citext is an extension (unavailable on
-- some managed Postgres tiers), changes the column's comparison semantics everywhere including
-- ORDER BY, and would show as drift against schema.prisma's `String @db.Text`. The index is
-- invisible to Prisma's schema diffing and costs nothing at read time.
--
-- The plain UNIQUE constraints from ..._init are deliberately KEPT: they are what Prisma's FK
-- targets reference, and dropping them would require rewriting the FKs.
CREATE UNIQUE INDEX "role_code_lower_key" ON "role" (lower("code"));
CREATE UNIQUE INDEX "level_code_lower_key" ON "level" (lower("code"));
CREATE UNIQUE INDEX "country_code_lower_key" ON "country" (lower("code"));
CREATE UNIQUE INDEX "currency_code_lower_key" ON "currency" (lower("code"));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Deferred constraint 5/5 — effective_from is never before hire_date
-- ─────────────────────────────────────────────────────────────────────────────
-- This is the one that CANNOT be a CHECK: a CHECK sees only the row being written, and hire_date
-- lives on a different table. PostgreSQL's other cross-row mechanism, an EXCLUDE constraint, does
-- not apply either — this is a comparison against a parent row, not an overlap test. So it is a
-- trigger, and being a trigger it holds for EVERY role including the table owner, exactly like the
-- append-only trigger (Law 5 / AD-18, layer B). Story 1-3's migrations are immutable, so it lands
-- here as a new object rather than as an edit to them.
--
-- BEFORE INSERT only. salary_record admits no UPDATE at all (the append-only trigger raises on
-- it), so a BEFORE UPDATE arm could never fire and would only suggest an update path exists.
--
-- Why it matters: AD-16 defines the as-of population as hire_date <= D AND some salary record
-- with effective_from <= D. A record predating the hire date puts an employee's salary history in
-- a window where the person was not employed, so the two halves of that predicate disagree and
-- every peer group the employee belongs to gets a different `n` depending on which half is read.
--
-- The IS NOT NULL guard is not defensive padding: FK constraints are checked AFTER row-level
-- triggers, so on a bogus employee_id this function runs first and finds nothing. Falling through
-- lets the FK raise its own, accurate error instead of this one blaming the date.
--
-- AP004 is a custom SQLSTATE in a class PostgreSQL does not reserve, matching the AP001/AP002/
-- AP003 convention already established — so a future repository port can map this onto a typed
-- domain refusal without string-matching English message text.
CREATE OR REPLACE FUNCTION "salary_record_effective_from_not_before_hire"()
RETURNS TRIGGER AS $$
DECLARE
  employee_hire_date DATE;
BEGIN
  SELECT "hire_date" INTO employee_hire_date FROM "employee" WHERE "id" = NEW."employee_id";

  IF employee_hire_date IS NOT NULL AND NEW."effective_from" < employee_hire_date THEN
    RAISE EXCEPTION
      'salary_record.effective_from (%) precedes the employee hire_date (%). A salary cannot take effect before the person was hired (AD-16).',
      NEW."effective_from", employee_hire_date
      USING ERRCODE = 'AP004';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "salary_record_effective_from_not_before_hire"
  BEFORE INSERT ON "salary_record"
  FOR EACH ROW
  EXECUTE FUNCTION "salary_record_effective_from_not_before_hire"();
