-- Close the hire-date invariant under CONCURRENCY (Story 1-4, follow-up review 2026-07-19).
--
-- The two triggers shipped by 20260719050000 guard both directions of `effective_from >= hire_date`
-- and are correct in isolation — but each one READS THE OTHER TABLE, and at READ COMMITTED (the
-- default) neither can see the other transaction's uncommitted row:
--
--   T1: INSERT salary_record (employee E, effective_from = E.hire_date)
--       -- reads hire_date, passes, does not commit
--   T2: UPDATE employee SET hire_date = <later> WHERE id = E
--       -- MIN(effective_from) cannot see T1's row, returns NULL, passes
--   both COMMIT  -->  effective_from < hire_date
--
-- Both guards fired correctly and the database still landed in the state AD-16 cannot tolerate.
-- That is write skew: two transactions each reading what the other is about to invalidate. No
-- CHECK, and no amount of trigger logic that only READS, can prevent it.
--
-- THE FIX IS A LOCK, NOT MORE LOGIC. The insert-side trigger takes `FOR SHARE` on the employee row
-- it validates against. A concurrent `UPDATE` of that row must then wait for the inserting
-- transaction to commit or roll back, and re-evaluates its own trigger afterwards against a row it
-- can finally see. The employee-side trigger needs no change: blocking the UPDATE is precisely what
-- closes the window, and it already re-runs on the post-wait state.
--
-- `FOR SHARE` rather than `FOR UPDATE`: concurrent inserts for the SAME employee are ordinary (an
-- import writes a whole salary history) and must not serialize against each other. Share locks are
-- mutually compatible and conflict only with the row-level exclusive lock an `UPDATE` takes, which
-- is exactly the one pairing that can break the invariant.
--
-- The body is otherwise byte-identical to 20260719050000's; only the FOR SHARE clause is new.
-- Migrations are immutable, so this lands as a CREATE OR REPLACE rather than an edit to that file.
--
-- GRANTS: no new table and no new column, so nothing to grant. Replacing a trigger function does
-- not alter the privileges on the tables it touches.

CREATE OR REPLACE FUNCTION "salary_record_effective_from_not_before_hire"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  employee_hire_date DATE;
BEGIN
  -- FOR SHARE: hold the parent row still for the rest of this transaction, so a concurrent
  -- hire_date UPDATE cannot commit alongside this insert on a value it never saw.
  SELECT "hire_date" INTO employee_hire_date
    FROM public."employee" WHERE "id" = NEW."employee_id" FOR SHARE;

  IF employee_hire_date IS NOT NULL AND NEW."effective_from" < employee_hire_date THEN
    RAISE EXCEPTION
      'salary_record.effective_from (%) precedes the employee hire_date (%). A salary cannot take effect before the person was hired (AD-16).',
      NEW."effective_from", employee_hire_date
      USING ERRCODE = 'AP004';
  END IF;

  RETURN NEW;
END;
$$;
