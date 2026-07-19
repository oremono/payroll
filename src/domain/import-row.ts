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

import { fromBoundaryMoney, type Money } from './money';
import {
  comparePlainDate,
  parsePlainDate,
  plainDateToIso,
  type PlainDate,
} from './plain-date';
import { blankToNull } from './text';

/**
 * The largest value the `salary_record.amount_minor` column can hold — PostgreSQL `bigint` is a
 * signed 64-bit integer.
 *
 * THE DOMAIN OWNS THIS BOUND, and that placement is the whole point (story 2-1, review pass 1).
 * Left unbounded, a cell like `99999999999999999999` parsed as a perfectly good positive integer,
 * reached the INSERT, overflowed there, and aborted the entire batch transaction — so ONE bad row
 * destroyed a 10,000-row payroll import and the request answered with a 500 carrying no report at
 * all. The database must never be the first thing to notice a value the product could have judged.
 */
export const MAX_AMOUNT_MINOR = 9223372036854775807n;

/** The two date columns, spelled as they appear in the file's header. */
export type DateColumn = 'hire_date' | 'effective_from';

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

/**
 * The reference tables, reduced to exactly what a judgement needs. Passed IN — the domain cannot
 * read a database, and would not want to: an argument is what makes every branch here testable
 * from a literal.
 *
 * `countryCurrencies` is a map rather than a set because AD-6 needs the country's currency, not
 * merely the country's existence: `salary_record.currency_code` is DERIVED from it and the file's
 * cell is only ever validated against it.
 */
export type ReferenceData = {
  readonly roleCodes: ReadonlySet<string>;
  readonly levelCodes: ReadonlySet<string>;
  readonly countryCurrencies: ReadonlyMap<string, string>;
};

/** Gender is exactly these two values, verbatim (Law 3). */
export type Gender = 'MALE' | 'FEMALE';

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
  | { readonly kind: 'blank-name' }
  | { readonly kind: 'unknown-role'; readonly value: string }
  | { readonly kind: 'unknown-level'; readonly value: string }
  | { readonly kind: 'unknown-country'; readonly value: string }
  | { readonly kind: 'unknown-gender'; readonly value: string }
  | { readonly kind: 'missing-date'; readonly column: DateColumn }
  | { readonly kind: 'malformed-date'; readonly column: DateColumn; readonly value: string }
  | {
      readonly kind: 'future-effective-from';
      readonly effectiveFrom: string;
      readonly today: string;
    }
  | {
      readonly kind: 'effective-before-hire';
      readonly effectiveFrom: string;
      readonly hireDate: string;
    }
  | { readonly kind: 'malformed-amount'; readonly value: string }
  | { readonly kind: 'amount-not-positive'; readonly value: string }
  | { readonly kind: 'amount-out-of-range'; readonly value: string }
  | {
      readonly kind: 'currency-mismatch';
      readonly value: string;
      readonly expected: string;
      readonly countryCode: string;
    }
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
  const name = blankToNull(raw.name);
  if (name === null) {
    return { ok: false, reason: { kind: 'blank-name' } };
  }

  const roleCode = raw.roleCode.trim();
  if (!refs.roleCodes.has(roleCode)) {
    return { ok: false, reason: { kind: 'unknown-role', value: roleCode } };
  }

  const levelCode = raw.levelCode.trim();
  if (!refs.levelCodes.has(levelCode)) {
    return { ok: false, reason: { kind: 'unknown-level', value: levelCode } };
  }

  // AD-6, the load-bearing line: the currency is RESOLVED from the country here, and the file's
  // own currency cell is validated against it below. This is also why an unknown country must be a
  // rejection rather than a guess — it would produce a salary record with no resolvable currency.
  const countryCode = raw.countryCode.trim();
  const expectedCurrency = refs.countryCurrencies.get(countryCode);
  if (expectedCurrency === undefined) {
    return { ok: false, reason: { kind: 'unknown-country', value: countryCode } };
  }

  const gender = raw.gender.trim();
  if (gender !== 'MALE' && gender !== 'FEMALE') {
    return { ok: false, reason: { kind: 'unknown-gender', value: gender } };
  }

  const hireDate = parseDateCell(raw.hireDate, 'hire_date');
  if (!hireDate.ok) {
    return { ok: false, reason: hireDate.reason };
  }

  const effectiveFrom = parseDateCell(raw.effectiveFrom, 'effective_from');
  if (!effectiveFrom.ok) {
    return { ok: false, reason: effectiveFrom.reason };
  }

  // Law 5 / AD-18: no future-dating, on EVERY write path. Inclusive of today — appending a record
  // dated today is the only correction mechanism the append-only design offers.
  if (comparePlainDate(effectiveFrom.value, today) > 0) {
    return {
      ok: false,
      reason: {
        kind: 'future-effective-from',
        effectiveFrom: plainDateToIso(effectiveFrom.value),
        today: plainDateToIso(today),
      },
    };
  }

  // Rejected in-app before the DB's BEFORE INSERT trigger (SQLSTATE AP004) can fire, so the row
  // carries a reason a reader can act on rather than aborting a batch. Inclusive: a day-one salary
  // dated exactly on the hire date is legitimate, and the trigger agrees.
  if (comparePlainDate(effectiveFrom.value, hireDate.value) < 0) {
    return {
      ok: false,
      reason: {
        kind: 'effective-before-hire',
        effectiveFrom: plainDateToIso(effectiveFrom.value),
        hireDate: plainDateToIso(hireDate.value),
      },
    };
  }

  const amountCell = raw.amountMinor.trim();
  // `fromBoundaryMoney` is REUSED rather than re-derived (Law 4): it already refuses everything
  // `BigInt` is dangerously permissive about — the empty string, ' 1 ', '0x10', a leading '+',
  // leading zeros, a fraction, exponent notation — by demanding the canonical decimal form.
  const parsedAmount = fromBoundaryMoney({ amountMinor: amountCell, currency: expectedCurrency });
  if (parsedAmount === null) {
    return { ok: false, reason: { kind: 'malformed-amount', value: amountCell } };
  }
  if (parsedAmount.amountMinor <= 0n) {
    return { ok: false, reason: { kind: 'amount-not-positive', value: amountCell } };
  }
  // The bound the database must never be the first to notice — see MAX_AMOUNT_MINOR.
  if (parsedAmount.amountMinor > MAX_AMOUNT_MINOR) {
    return { ok: false, reason: { kind: 'amount-out-of-range', value: amountCell } };
  }

  const currency = raw.currency.trim();
  if (currency !== expectedCurrency) {
    return {
      ok: false,
      reason: {
        kind: 'currency-mismatch',
        value: currency,
        expected: expectedCurrency,
        countryCode,
      },
    };
  }

  return {
    ok: true,
    value: {
      name,
      roleCode,
      levelCode,
      countryCode,
      gender,
      hireDate: hireDate.value,
      salary: parsedAmount,
      effectiveFrom: effectiveFrom.value,
    },
  };
}

/**
 * One date cell, judged. A BLANK cell and a MALFORMED cell are deliberately different reasons: a
 * blank `effective_from` is the AD-7 case the epic calls out by name ("never defaulted to today or
 * to the hire date"), and telling a reader "the cell is blank" is a different instruction from
 * telling them "the cell reads 01/06/2021".
 */
function parseDateCell(
  cell: string,
  column: DateColumn,
):
  | { readonly ok: true; readonly value: PlainDate }
  | { readonly ok: false; readonly reason: RejectionReason } {
  const trimmed = blankToNull(cell);
  if (trimmed === null) {
    return { ok: false, reason: { kind: 'missing-date', column } };
  }

  const parsed = parsePlainDate(trimmed);
  if (parsed === null) {
    return { ok: false, reason: { kind: 'malformed-date', column, value: trimmed } };
  }

  return { ok: true, value: parsed };
}
