-- Code-review hardening (Story 1-4, adversarial + edge-case review 2026-07-19).
--
-- Three changes, each closing a hole an independent reviewer found in this story's own migrations.
-- All are hand-authored: Prisma models none of CHECK constraints, trigger functions, or search_path
-- pinning. Story 1-4's earlier migrations are already applied, so these land as new objects rather
-- than as edits to them.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. currency.symbol must not be blank (confirmed gap)
-- ─────────────────────────────────────────────────────────────────────────────
-- The same migration that created `symbol` NOT NULL added non-blank CHECKs to employee.name and to
-- all four reference `code` columns — and skipped the column it had just created for exactly this
-- purpose. NOT NULL does not exclude ''. A blank symbol is accepted, and formatMoney then renders
-- `2,150,000 CHF`: a salary with no currency symbol, which DESIGN forbids on every surface
-- ("show every salary with its currency, every time").
--
-- btrim rather than a length test, so a whitespace-only symbol is caught too — the same reasoning
-- the sibling CHECKs already use.
ALTER TABLE "currency"
  ADD CONSTRAINT "currency_symbol_not_blank" CHECK (btrim("symbol") <> '');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Pin the hire-date trigger function's search_path (confirmed exposure)
-- ─────────────────────────────────────────────────────────────────────────────
-- Unlike the append-only trigger function, this one REFERENCES A TABLE by unqualified name, so it
-- resolves `employee` through the CALLER's search_path. Any role able to create a relation in a
-- schema it can place ahead of `public` gets that SELECT to read a table of its own choosing, which
-- returns NULL and falls straight through the IS NOT NULL guard — a silent bypass, not an error.
--
-- SET search_path pins resolution at definition time. The body is otherwise byte-identical to the
-- original; only the SET clause and the schema qualification are new.
CREATE OR REPLACE FUNCTION "salary_record_effective_from_not_before_hire"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  employee_hire_date DATE;
BEGIN
  SELECT "hire_date" INTO employee_hire_date FROM public."employee" WHERE "id" = NEW."employee_id";

  IF employee_hire_date IS NOT NULL AND NEW."effective_from" < employee_hire_date THEN
    RAISE EXCEPTION
      'salary_record.effective_from (%) precedes the employee hire_date (%). A salary cannot take effect before the person was hired (AD-16).',
      NEW."effective_from", employee_hire_date
      USING ERRCODE = 'AP004';
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Enforce the hire-date invariant from the employee side too (confirmed hole)
-- ─────────────────────────────────────────────────────────────────────────────
-- The invariant `effective_from >= hire_date` was enforced only when a salary_record is INSERTed.
-- But `payroll_app` holds a column-level GRANT UPDATE on employee.hire_date (story 1-3), and
-- salary_record rows cannot be corrected at all (append-only). So moving a hire_date LATER after
-- records exist walked the database straight into the state AD-16 cannot tolerate, with nothing
-- firing — the deferred-work ledger recorded this constraint as CLOSED while it held in only one
-- of the two directions that can break it.
--
-- WHEN (NEW.hire_date IS DISTINCT FROM OLD.hire_date) keeps every other employee update free: the
-- subquery runs only when the value actually moves.
--
-- Shares SQLSTATE AP004 — it is the same invariant, and a consumer mapping it onto a typed refusal
-- should not have to care which side tripped it.
CREATE OR REPLACE FUNCTION "employee_hire_date_not_after_salary"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  earliest_effective_from DATE;
BEGIN
  SELECT MIN("effective_from") INTO earliest_effective_from
    FROM public."salary_record" WHERE "employee_id" = NEW."id";

  IF earliest_effective_from IS NOT NULL AND NEW."hire_date" > earliest_effective_from THEN
    RAISE EXCEPTION
      'employee.hire_date (%) is after an existing salary_record.effective_from (%). A salary cannot take effect before the person was hired (AD-16).',
      NEW."hire_date", earliest_effective_from
      USING ERRCODE = 'AP004';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "employee_hire_date_not_after_salary"
  BEFORE UPDATE OF "hire_date" ON "employee"
  FOR EACH ROW
  WHEN (NEW."hire_date" IS DISTINCT FROM OLD."hire_date")
  EXECUTE FUNCTION "employee_hire_date_not_after_salary"();
