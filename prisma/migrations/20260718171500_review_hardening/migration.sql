-- Code-review hardening (Story 1-3, adversarial review 2026-07-18).
--
-- Five changes, each closing a hole an independent reviewer found in the original migrations.
-- The first two are declared in schema.prisma and would be emitted by `prisma migrate dev`; the
-- rest are hand-authored because Prisma cannot model CHECK constraints, column-level privileges,
-- or trigger functions.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FK ON UPDATE CASCADE -> RESTRICT on salary_record (confirmed defect)
-- ─────────────────────────────────────────────────────────────────────────────
-- Prisma defaults required relations to ON UPDATE CASCADE. A cascaded update rewrites the
-- referencing salary_record rows, which fires the BEFORE UPDATE append-only trigger and aborts the
-- entire transaction with "salary_record is append-only (Law 5 / AD-18)" — an error naming a table
-- the caller never touched, raised by a statement that only renamed a currency code.
--
-- Reproduced before this fix: `UPDATE currency SET code='ZZY' WHERE code='ZZZ'` failed with the
-- append-only error via `UPDATE ONLY "public"."salary_record" SET "currency_code" = $1`.
--
-- RESTRICT fails immediately and legibly at the row actually being renamed. Reference codes are
-- natural keys and are retired via is_active rather than renamed (Decision 3), so nothing
-- legitimate depends on the cascade.
ALTER TABLE "salary_record" DROP CONSTRAINT "salary_record_employee_id_fkey";
ALTER TABLE "salary_record" ADD CONSTRAINT "salary_record_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "salary_record" DROP CONSTRAINT "salary_record_currency_code_fkey";
ALTER TABLE "salary_record" ADD CONSTRAINT "salary_record_currency_code_fkey"
  FOREIGN KEY ("currency_code") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. level.rank UNIQUE (Law 6 / NFR1 determinism)
-- ─────────────────────────────────────────────────────────────────────────────
-- `rank` orders the gender-distribution-by-level chart. With duplicate ranks, `ORDER BY rank`
-- leaves the tie to the query plan, so the chart can reorder itself between page loads — a
-- determinism violation no test would catch, because duplicate ranks are valid data.
CREATE UNIQUE INDEX "level_rank_key" ON "level"("rank");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. fx_rate.rate must be strictly positive (AD-13)
-- ─────────────────────────────────────────────────────────────────────────────
-- A zero rate converts every salary in that currency to zero, so every foreign-currency employee
-- reads as a maximally negative outlier against their peer median — a wrong answer delivered
-- confidently, with provenance receipts attached. A negative rate is arithmetically meaningless.
-- This mirrors AD-4's amount_minor > 0 CHECK: money-shaped values are positive at the database.
ALTER TABLE "fx_rate"
  ADD CONSTRAINT "fx_rate_rate_positive" CHECK ("rate" > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. employee.country_code is immutable, enforced by column-level privilege (AD-6)
-- ─────────────────────────────────────────────────────────────────────────────
-- AD-6: "employee.country is set at create and is immutable — no form, use-case, or repository
-- method offers a country update." Until now that was enforced only by nobody writing such a path,
-- while payroll_app held full UPDATE on employee — the same developer-discipline argument this
-- story rejects everywhere else.
--
-- PostgreSQL supports COLUMN-LEVEL privileges, so the invariant costs one line and mirrors AD-18
-- layer A exactly: the runtime role keeps UPDATE on every other employee column and simply cannot
-- write this one. Attempting it fails with "permission denied for column country_code".
--
-- Note the ordering requirement: a bare `GRANT UPDATE ON employee` (table-level, granted in
-- 20260718163326) must be re-granted per-column, because revoking one column from a table-level
-- grant is not possible — the table-level grant is replaced by an explicit column list.
REVOKE UPDATE ON "employee" FROM "payroll_app";
GRANT UPDATE ("name", "role_code", "level_code", "gender", "hire_date", "updated_at")
  ON "employee" TO "payroll_app";

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Append-only trigger raises a machine-identifiable SQLSTATE
-- ─────────────────────────────────────────────────────────────────────────────
-- The original RAISE EXCEPTION produced the default P0001 (raise_exception), indistinguishable
-- from any other plpgsql failure — so the CAP-2/CAP-3 repository port would have had to
-- string-match English message text to map an append-only violation onto a typed domain refusal,
-- breaking the moment the wording or the server locale changes.
--
-- AP001 is a custom SQLSTATE in a class PostgreSQL does not reserve; verified catchable via
-- `EXCEPTION WHEN SQLSTATE 'AP001'`. The message is unchanged, so existing assertions still match.
CREATE OR REPLACE FUNCTION "salary_record_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'salary_record is append-only (Law 5 / AD-18): % is not permitted. Append a new record dated today instead.',
    TG_OP
    USING ERRCODE = 'AP001';
END;
$$ LANGUAGE plpgsql;
