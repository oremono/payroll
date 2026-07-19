/**
 * The salary-record field rules, extracted so there is EXACTLY ONE of each. (Law 2 / AD-1, AD-6,
 * AD-18)
 *
 * Story 2-1 wrote the amount, effective-date and currency-match checks inside `validateImportRow`,
 * where they were private to the CSV path. Story 4-1 needs the identical judgements for a
 * single-record salary change, and a second implementation of any of them is how two WRITE PATHS
 * start disagreeing about what a valid salary is — the precise divergence AD-6's single funnel
 * exists to prevent. So they live here, and both callers reach them:
 *
 *   - `validateImportRow` (src/domain/import-row.ts) collects FIRST-FAULT: one reason per row, in a
 *     contractual order 2-1 pinned and this extraction must not disturb.
 *   - `validateSalaryChange` (src/domain/salary-change.ts) collects ALL failing fields, because a
 *     form reports every problem at once rather than forcing a round-trip per mistake.
 *
 * Same rules, different collection strategy — the same shape story 3-1 arrived at for the per-field
 * checks in `employee-fields.ts`, and this module follows that one deliberately.
 *
 * The reason vocabulary is UNCHANGED, verbatim. `RejectionReason` in `import-row.ts` is now this
 * union plus the reasons no single field owns (cell counts, an unterminated quote) plus the
 * per-field union from `employee-fields.ts`. Not one reason literal moved, and
 * `composeRejectionSentence` still spells every sentence exactly as it did — CAP-1's import contract
 * is observably identical after the extraction, and its suite runs unmodified to prove it.
 *
 * ## Why this is its own module rather than part of `employee-fields.ts`
 *
 * `employee-fields.ts` holds the checks CAP-2's employee form and the CSV importer share; an
 * employee has no salary (CAP-2 creates none). These are the checks a SALARY RECORD's writers
 * share. Folding them together would hand CAP-2's validator six reasons it can never produce and
 * hand this module a `ReferenceData` dependency it does not need. The cycle-breaking split
 * (`employee-fields` / `employee` / `import-row` / `import-rejection`) is preserved: this module
 * imports only `money` and `plain-date`, so nothing points back at it.
 *
 * ## No trimming in THESE functions, on purpose
 *
 * `validateImportRow` trims EVERY cell before judging it — surrounding whitespace in a spreadsheet
 * export is noise, not a value. That is a property of reading a CSV CELL, not of judging an amount,
 * so it stays at the import call site and `checkSalaryAmount` and `checkSalaryCurrency` judge
 * exactly the text they are handed. A Server Action payload is not a spreadsheet export: `'  12'`
 * arriving there is a caller sending something other than the canonical decimal string the boundary
 * is specified in (AD-4), and it is rejected rather than quietly repaired.
 *
 * This is NOT true of the effective date, and the difference is not a decision this module made.
 * `checkSalaryEffectiveFrom` takes an already-parsed `PlainDate`; the CAP-3 caller reaches it
 * through `checkDateCell` (`employee-fields`), which blanks-and-trims because CAP-1 requires it and
 * both paths share that one parser. So on the CAP-3 payload `' 2026-07-19 '` is ACCEPTED while
 * `' 2500000'` and `' INR'` are rejected. One payload, two whitespace policies — the honest
 * statement of what is implemented. Whether the boundary should trim all three before judging any
 * of them is a CAP-3 form question that story 4-2 owns; it is recorded in `deferred-work.md`.
 *
 * No I/O, no clock, no randomness, no imports outside this layer. `today` and `hireDate` arrive as
 * ARGUMENTS rather than lookups (Law 6 / AD-11). Every function is TOTAL: a failure is a RETURN
 * VALUE, never an exception.
 */

import { fromBoundaryMoney, type Money } from './money';
import { comparePlainDate, plainDateToIso, type PlainDate } from './plain-date';

/**
 * The largest value the `salary_record.amount_minor` column can hold — PostgreSQL `bigint` is a
 * signed 64-bit integer.
 *
 * THE DOMAIN OWNS THIS BOUND, and that placement is the whole point (story 2-1, review pass 1).
 * Left unbounded, a cell like `99999999999999999999` parsed as a perfectly good positive integer,
 * reached the INSERT, overflowed there, and aborted the entire batch transaction — so ONE bad row
 * destroyed a 10,000-row payroll import and the request answered with a 500 carrying no report at
 * all. The database must never be the first thing to notice a value the product could have judged.
 *
 * It moved here from `import-row.ts` with the checks that enforce it, and `import-row.ts`
 * re-exports it under its original name so no existing import path had to move.
 */
export const MAX_AMOUNT_MINOR = 9223372036854775807n;

/**
 * Every way a SALARY RECORD's own fields can fail, as a discriminated union that CARRIES the
 * offending value. Extracted verbatim from `RejectionReason`, which is now this union plus the
 * reasons that belong to a CSV row rather than to a salary record.
 */
export type SalaryFieldRejectionReason =
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
    };

/** The judgement on one salary field. `ok: false` carries the reason; nothing throws. */
export type SalaryFieldCheck<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: SalaryFieldRejectionReason };

/**
 * The two date rules every salary write path obeys, in their contractual order.
 *
 * FUTURE FIRST, then before-hire — the order story 2-1 pinned, kept here so the same input always
 * produces the same reason (Law 6). Both are reachable at once for an employee with a future hire
 * date, which CAP-2 accepts.
 *
 * Both bounds are INCLUSIVE:
 *   - a record dated exactly TODAY is legal, and is the only correction mechanism the append-only
 *     design offers (Law 5 / AD-18);
 *   - a record dated exactly on the HIRE DATE is a legitimate day-one salary, and the database's
 *     `AP004` trigger agrees.
 *
 * The hire-date rule is judged here so the row carries a reason a reader can act on, rather than
 * reaching the `BEFORE INSERT` trigger and aborting a batch. The trigger remains the backstop.
 */
export function checkSalaryEffectiveFrom(
  effectiveFrom: PlainDate,
  hireDate: PlainDate,
  today: PlainDate,
): SalaryFieldCheck<PlainDate> {
  if (comparePlainDate(effectiveFrom, today) > 0) {
    return {
      ok: false,
      reason: {
        kind: 'future-effective-from',
        effectiveFrom: plainDateToIso(effectiveFrom),
        today: plainDateToIso(today),
      },
    };
  }

  if (comparePlainDate(effectiveFrom, hireDate) < 0) {
    return {
      ok: false,
      reason: {
        kind: 'effective-before-hire',
        effectiveFrom: plainDateToIso(effectiveFrom),
        hireDate: plainDateToIso(hireDate),
      },
    };
  }

  return { ok: true, value: effectiveFrom };
}

/**
 * One amount, judged and parsed into `Money` denominated in the currency the CALLER resolved.
 *
 * The currency is an argument rather than a field of the input because AD-6 makes the submitted
 * currency non-authoritative: the money is denominated in the COUNTRY's currency, and the submitted
 * one is separately validated to equal it by `checkSalaryCurrency`.
 *
 * `fromBoundaryMoney` is REUSED rather than re-derived (Law 4): it already refuses everything
 * `BigInt` is dangerously permissive about — the empty string, `' 1 '`, `'0x10'`, a leading `'+'`,
 * leading zeros, a fraction, exponent notation — by demanding the canonical decimal form.
 */
export function checkSalaryAmount(cell: string, currency: string): SalaryFieldCheck<Money> {
  const parsed = fromBoundaryMoney({ amountMinor: cell, currency });
  if (parsed === null) {
    return { ok: false, reason: { kind: 'malformed-amount', value: cell } };
  }
  if (parsed.amountMinor <= 0n) {
    return { ok: false, reason: { kind: 'amount-not-positive', value: cell } };
  }
  // The bound the database must never be the first to notice — see MAX_AMOUNT_MINOR.
  if (parsed.amountMinor > MAX_AMOUNT_MINOR) {
    return { ok: false, reason: { kind: 'amount-out-of-range', value: cell } };
  }
  return { ok: true, value: parsed };
}

/**
 * The submitted currency, validated to equal the one the employee's country resolves to (AD-6).
 *
 * Currency is CONFIRMED, never chosen. Nothing is normalized: a code differing in case or carrying
 * whitespace is a DIFFERENT code, and matching it would be the fuzzy matching AD-7 forbids.
 */
export function checkSalaryCurrency(
  cell: string,
  expected: string,
  countryCode: string,
): SalaryFieldCheck<string> {
  if (cell !== expected) {
    return {
      ok: false,
      reason: { kind: 'currency-mismatch', value: cell, expected, countryCode },
    };
  }
  return { ok: true, value: cell };
}
