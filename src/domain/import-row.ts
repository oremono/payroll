/**
 * The pure row-validation core of CAP-1 bulk import, and the ONE rejection-reason vocabulary the
 * whole product speaks. (Law 2 / AD-1, AD-7)
 *
 * No I/O, no clock, no randomness, no imports outside this layer — cells in, judgement out. Every
 * function here is TOTAL: a rejection is a RETURN VALUE, never an exception. That is not a style
 * preference. A 10,000-row import that throws on one hostile cell loses the other 9,999, which is
 * the precise outcome "one bad row never blocks a good one" exists to prevent.
 *
 * The reference codes and `today` arrive as ARGUMENTS rather than lookups. That is what keeps this
 * module inside the pure core (it may import nothing), keeps the fast suite DB-free and clock-free,
 * and makes the 100% mutation-score target reachable at all — every branch is drivable from plain
 * inputs.
 *
 * ## The money cell, and why it is two columns
 *
 * AD-4 forbids a bare amount, so `2340000` alone is illegal. AD-6 makes any currency in the file
 * non-authoritative — currency is resolved from the employee's COUNTRY and merely *validated to
 * equal* the file's, which presupposes something to validate. A symbol-bearing cell (`₹23,40,000`)
 * would need locale- and grouping-aware parsing, which collides with "nothing is guessed" (AD-7).
 * Exactly one encoding survives all three: `amount_minor` (integer minor units) + `currency`
 * (ISO-4217), with a mismatch against the country's currency rejecting the row. The convention is
 * cross-cutting and is recorded in the deferred-work ledger for promotion to the spine before the
 * CSV *export* stories pick their own spelling.
 */

import {
  checkCountryCode,
  checkDateCell,
  checkGender,
  checkLevelCode,
  checkName,
  checkRoleCode,
  type FieldRejectionReason,
  type Gender,
  type ReferenceData,
} from './employee-fields';
import type { Money } from './money';
import type { PlainDate } from './plain-date';
import {
  checkSalaryAmount,
  checkSalaryCurrency,
  checkSalaryEffectiveFrom,
  type SalaryFieldRejectionReason,
} from './salary-fields';

/**
 * The per-field vocabulary and validators now live in `employee-fields.ts`, shared with CAP-2's
 * `validateEmployeeInput` so there is exactly one implementation of each field rule (story 3-1).
 * The SALARY-record rules — the amount, the two effective-date bounds, and the currency match —
 * live in `salary-fields.ts` for the same reason, shared with CAP-3's `validateSalaryChange`
 * (story 4-1). Both are RE-EXPORTED here because this module is the name every existing consumer
 * imports them by, and moving an import path is not what an extraction is for.
 */
export type { DateColumn, Gender, ReferenceData } from './employee-fields';
export { MAX_AMOUNT_MINOR } from './salary-fields';

/** One CSV data row, every cell still a raw string exactly as the file spelled it. */
export type ImportRowInput = {
  readonly name: string;
  readonly roleCode: string;
  readonly levelCode: string;
  readonly countryCode: string;
  readonly gender: string;
  readonly hireDate: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly effectiveFrom: string;
};

/** A row that survived every judgement — parsed values, ready for the write funnel. */
export type ValidatedRow = {
  readonly name: string;
  readonly roleCode: string;
  readonly levelCode: string;
  readonly countryCode: string;
  readonly gender: Gender;
  readonly hireDate: PlainDate;
  /** AD-4: never bare. The currency here is the COUNTRY's, never the file's. */
  readonly salary: Money;
  readonly effectiveFrom: PlainDate;
};

/**
 * Every way a single row can fail, as a discriminated union that CARRIES the offending value.
 *
 * One vocabulary, used by the row validator, by the CSV parse adapter (for records it cannot even
 * shape into cells), by the import use-case, and by story 2-2's table. A second vocabulary
 * anywhere would mean a second sentence composer, and then two ways to say the same thing.
 */
export type RejectionReason =
  // The per-field half, shared verbatim with CAP-2's employee validator: blank-name,
  // unknown-role/level/country/gender, missing-date, malformed-date.
  | FieldRejectionReason
  // The salary-record half, shared verbatim with CAP-3's salary-change validator:
  // future-effective-from, effective-before-hire, the three amount faults, currency-mismatch.
  | SalaryFieldRejectionReason
  // What is left is what belongs to a CSV ROW rather than to a person or a salary record: a record
  // that never became the right number of cells, or never became cells at all.
  | { readonly kind: 'wrong-cell-count'; readonly expected: number; readonly actual: number }
  | { readonly kind: 'unterminated-quote' };

/**
 * Every way a WHOLE FILE can be refused — nothing is written and there is no per-row report to
 * give, because the file could not be read as rows at all. (Law 8: a refusal is a return value.)
 */
export type FileRefusalReason =
  | { readonly kind: 'not-csv' }
  | { readonly kind: 'empty-file' }
  | { readonly kind: 'no-data-rows' }
  | { readonly kind: 'missing-columns'; readonly columns: readonly string[] }
  | { readonly kind: 'duplicate-columns'; readonly columns: readonly string[] }
  | { readonly kind: 'no-file-part' }
  | { readonly kind: 'multiple-file-parts'; readonly count: number }
  | { readonly kind: 'too-large'; readonly limitMegabytes: number }
  | { readonly kind: 'unreadable-upload' }
  | { readonly kind: 'write-failed' };

/** The judgement on one row. `ok: false` carries the reason; nothing throws. */
export type RowValidation =
  | { readonly ok: true; readonly value: ValidatedRow }
  | { readonly ok: false; readonly reason: RejectionReason };

/**
 * Judge one raw row against the reference tables and today's date.
 *
 * The order of judgements is part of the contract, not an accident of writing: the reported reason
 * is always the FIRST thing wrong with the row, so the same file always produces the same report
 * (Law 6). Every cell is trimmed before it is judged — surrounding whitespace in a spreadsheet
 * export is noise, not a value — but nothing else is normalized. A code that differs in case is a
 * DIFFERENT code, and matching it would be the fuzzy-matching AD-7 forbids.
 */
export function validateImportRow(
  raw: ImportRowInput,
  refs: ReferenceData,
  today: PlainDate,
): RowValidation {
  // Each judgement below is the SHARED validator from `employee-fields.ts` — the same code CAP-2's
  // form runs. Only the COLLECTION differs: this function returns on the FIRST fault, because a
  // batch report names one reason per row and that order is contractual.
  const name = checkName(raw.name);
  if (!name.ok) {
    return { ok: false, reason: name.reason };
  }

  const role = checkRoleCode(raw.roleCode, refs);
  if (!role.ok) {
    return { ok: false, reason: role.reason };
  }

  const level = checkLevelCode(raw.levelCode, refs);
  if (!level.ok) {
    return { ok: false, reason: level.reason };
  }

  // AD-6, the load-bearing line: the currency is RESOLVED from the country here, and the file's
  // own currency cell is validated against it below. This is also why an unknown country must be a
  // rejection rather than a guess — it would produce a salary record with no resolvable currency.
  const country = checkCountryCode(raw.countryCode, refs);
  if (!country.ok) {
    return { ok: false, reason: country.reason };
  }
  const { countryCode, currency: expectedCurrency } = country.value;

  const gender = checkGender(raw.gender);
  if (!gender.ok) {
    return { ok: false, reason: gender.reason };
  }

  const hireDate = checkDateCell(raw.hireDate, 'hire_date');
  if (!hireDate.ok) {
    return { ok: false, reason: hireDate.reason };
  }

  const effectiveFrom = checkDateCell(raw.effectiveFrom, 'effective_from');
  if (!effectiveFrom.ok) {
    return { ok: false, reason: effectiveFrom.reason };
  }

  // Law 5 / AD-18 and the hire-date bound, from the ONE implementation both write paths share
  // (`salary-fields.ts`). The reasons and their ORDER — future first, then before-hire — are
  // exactly what this function returned when it judged the two dates itself; the extraction moved
  // the code and changed neither.
  const salaryDate = checkSalaryEffectiveFrom(effectiveFrom.value, hireDate.value, today);
  if (!salaryDate.ok) {
    return { ok: false, reason: salaryDate.reason };
  }

  // The TRIM stays here and does not move into the shared check. Trimming is a property of reading
  // a spreadsheet-exported CSV CELL, not of judging an amount — the Server Action path judges the
  // exact text it is handed. Both the parsed value and the reported offending value are the trimmed
  // cell, exactly as before.
  const amountCell = raw.amountMinor.trim();
  const amount = checkSalaryAmount(amountCell, expectedCurrency);
  if (!amount.ok) {
    return { ok: false, reason: amount.reason };
  }

  const currency = checkSalaryCurrency(raw.currency.trim(), expectedCurrency, countryCode);
  if (!currency.ok) {
    return { ok: false, reason: currency.reason };
  }

  return {
    ok: true,
    value: {
      name: name.value,
      roleCode: role.value,
      levelCode: level.value,
      countryCode,
      gender: gender.value,
      hireDate: hireDate.value,
      salary: amount.value,
      effectiveFrom: salaryDate.value,
    },
  };
}
