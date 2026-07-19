/**
 * The pure CAP-3 salary-change validator — the ONE place a single salary change is judged.
 * (Law 2 / AD-1, AD-6, AD-18)
 *
 * No I/O, no clock, no randomness, no imports outside this layer. Every function here is TOTAL: a
 * rejection is a RETURN VALUE, never an exception, all the way out to the Server Action.
 *
 * ## Three fields, and the ones that are deliberately absent
 *
 * Effective date, amount, currency. There is no reason field, no note, no event type, and no
 * approval workflow — the form absorbs the fact and gets out of the way. There is no scheduled or
 * pending change either: a record dated later than today is REJECTED, not queued (Law 5 / AD-18).
 *
 * ## Where the rules actually live
 *
 * Nowhere here. Every judgement is borrowed: `checkDateCell` from `employee-fields.ts`, and the
 * amount, effective-date and currency rules from `salary-fields.ts` — the same three functions
 * `validateImportRow` calls. A salary recorded through this form and one imported from a CSV are
 * judged by identical code, which is what makes "currency is the country's" and "no future-dating"
 * enforceable claims rather than things each path remembers to do.
 *
 * ## Why ALL failing fields, when import reports the first
 *
 * Import reports per ROW in a batch, where one reason per row is the useful unit and the ordering is
 * contractual. A form reports per FIELD, where surfacing one problem at a time forces a round-trip
 * per mistake. Same validators, different collection strategy — exactly the split `employee.ts`
 * makes against the same shared checks.
 *
 * ## Why `today` and `hireDate` are arguments
 *
 * Law 6 / AD-11. The clock port is read once, at the delivery boundary, and the date is passed
 * inward; the hire date is read from the employee by the use-case. Nothing here asks what day it is.
 */

import { checkDateCell } from './employee-fields';
import { composeRejectionSentence, rejectionOffendingValue } from './import-rejection';
import type { RejectionReason } from './import-row';
import type { BoundaryMoney, Money } from './money';
import { plainDateToIso, type PlainDate } from './plain-date';
import {
  checkSalaryAmount,
  checkSalaryCurrency,
  checkSalaryEffectiveFrom,
} from './salary-fields';

/**
 * The CAP-3 field set, named as the form and the payload name them. `effective_from` and
 * `amount_minor` keep the column spellings the import vocabulary already uses, so one sentence
 * composer serves both surfaces.
 */
export type SalaryChangeField = 'effective_from' | 'amount_minor' | 'currency';

/**
 * The change input: three raw strings, exactly as a form submitted them.
 *
 * It IS a `BoundaryMoney` plus a date, and it is spelled that way rather than restating the two
 * money fields — money crosses a Server Action boundary as a decimal string plus an ISO-4217 code,
 * never a JS number and never a raw `bigint` (Law 4 / AD-4). Writing the pair out by hand here is
 * how a boundary quietly acquires a second money encoding.
 */
export type SalaryChangeInput = BoundaryMoney & {
  readonly effectiveFrom: string;
};

/** One row of the field table: an input key, and the field name its problems report under. */
type SalaryChangeFieldEntry = readonly [keyof SalaryChangeInput, SalaryChangeField];

/**
 * Accept a field table ONLY if it names every key of `SalaryChangeInput`.
 *
 * `satisfies readonly SalaryChangeFieldEntry[]` — what this replaced — checks the entries that are
 * PRESENT and says nothing about the ones that are missing. A fourth field added to
 * `SalaryChangeInput` and forgotten here would compile, the boundary would never coerce it, and the
 * assertion at the end of `coerceSalaryFields` would hand the validator a `string` that is actually
 * `undefined`. The table's docstring claims the mapping cannot drift from the validator's; this
 * closes the way that drift is SILENT.
 *
 * It does not close every way. The gate demands that every key APPEAR; it does not demand that the
 * pairing be injective, so `[['amountMinor', 'currency'], ['currency', 'currency']]` typechecks and
 * would report two problems under one field name, leaving the amount input with none. The literal
 * equality assertion in `tests/domain/salary-change.test.ts` is what catches that one — deliberately
 * a test rather than more type machinery, since the table is a fixed literal a reader can verify.
 *
 * The constraint rides an INTERSECTION rather than the return type because `T` has to stay
 * inferable: a conditional type in an inferable position is opaque to inference, but `T & …` still
 * infers `T` from the argument. When a key is missing the right-hand side collapses to `never`, the
 * parameter type collapses with it, and the call fails to typecheck at the literal itself.
 *
 * Returns its argument unchanged — this is a type-level gate with no runtime opinion.
 */
function orderedSalaryChangeFields<const T extends readonly SalaryChangeFieldEntry[]>(
  table: T & (keyof SalaryChangeInput extends T[number][0] ? unknown : never),
): T {
  return table;
}

/**
 * Which input key reports under which field name — the table the Server Action boundary coerces
 * against, so the mapping lives in the domain rather than being re-typed at a boundary that could
 * drift from it. The ORDER is the form's, and it is the order rejections are reported in.
 *
 * EXHAUSTIVE over `keyof SalaryChangeInput`, enforced by the compiler — see above.
 */
export const SALARY_CHANGE_FIELDS = orderedSalaryChangeFields([
  ['effectiveFrom', 'effective_from'],
  ['amountMinor', 'amount_minor'],
  ['currency', 'currency'],
]);

/**
 * What the change is judged AGAINST: the employee's country and its currency (AD-6), their hire
 * date, and today. Every one of them is read by the caller and handed in — the domain reads no
 * database and no clock.
 */
export type SalaryChangeContext = {
  readonly countryCode: string;
  /** Resolved from `countryCode` via the country reference table. Never chosen by the user. */
  readonly expectedCurrency: string;
  readonly hireDate: PlainDate;
  /** UTC today, from the clock port at the delivery boundary (Law 6 / AD-11). */
  readonly today: PlainDate;
};

/** A change that survived every judgement — parsed values, ready for the append. */
export type ValidatedSalaryChange = {
  /** AD-4: never bare. The currency is the COUNTRY's, never the submitted one. */
  readonly salary: Money;
  readonly effectiveFrom: PlainDate;
};

/**
 * One problem with one field, as the form shows it. Mirrors `FieldRejection` in `employee.ts`
 * exactly — same three keys, same nullability, same reasons for it.
 *
 * It is a SEPARATE type rather than a widening of that one because `EmployeeField` is the set of
 * keys CAP-2's form matches its inputs against, and a salary field is not one of them: widening it
 * would hand every employee-form surface three field names it can never render. The SENTENCES are
 * shared, which is the part that must not fork; the field vocabulary is per-form by design.
 *
 * `field` is nullable for the same reason `offendingValue` is: some rejections have no single thing
 * to blame. A write that failed at the database has no offending FIELD (nobody's input caused it); a
 * blank date has no offending VALUE (the blankness is the value).
 */
export type SalaryFieldRejection = {
  readonly field: SalaryChangeField | null;
  readonly offendingValue: string | null;
  readonly sentence: string;
};

/** The judgement on a change input. `ok: false` carries EVERY failing field; nothing throws. */
export type SalaryChangeValidation =
  | { readonly ok: true; readonly value: ValidatedSalaryChange }
  | { readonly ok: false; readonly reasons: readonly SalaryFieldRejection[] };

/**
 * A check whose failure may be a per-field reason OR a salary-record reason — the union of what the
 * effective-date column can produce once parsing and the two date bounds are composed.
 */
type Check<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: RejectionReason };

/**
 * The offending value a FORM shows, which is not always the one a CSV REPORT shows.
 *
 * They differ in exactly one case, and `employee.ts` documents it at length for the same reason:
 * import answers the COLUMN NAME for a blank date, because in a rejection table whose columns are
 * "value" and "reason" that name is the only thing identifying which cell was empty. Beside a form
 * field already labelled "Effective date" the same string reads as though the user typed the words.
 */
function salaryOffendingValue(reason: RejectionReason): string | null {
  if (reason.kind === 'missing-date') {
    return null;
  }
  return rejectionOffendingValue(reason);
}

/** Compose one rejection from one reason. The sentence comes from the one composer, always. */
function toRejection(
  field: SalaryChangeField | null,
  reason: RejectionReason,
): SalaryFieldRejection {
  return {
    field,
    offendingValue: salaryOffendingValue(reason),
    sentence: composeRejectionSentence(reason),
  };
}

/** Record a failed check against the field it belongs to. */
function collect(
  reasons: SalaryFieldRejection[],
  field: SalaryChangeField,
  check: Check<unknown>,
): void {
  if (!check.ok) {
    reasons.push(toRejection(field, check.reason));
  }
}

/**
 * The effective-date column end to end: parse the cell, then apply the two date bounds.
 *
 * Composed into one function so the caller has a SINGLE result to collect and narrow on — the
 * alternative is a nested shape whose "parsed but unbounded" arm is unreachable and would sit
 * uncovered in a module held to 100%.
 */
function checkEffectiveFromCell(
  cell: string,
  hireDate: PlainDate,
  today: PlainDate,
): Check<PlainDate> {
  const parsed = checkDateCell(cell, 'effective_from');
  if (!parsed.ok) {
    return parsed;
  }
  return checkSalaryEffectiveFrom(parsed.value, hireDate, today);
}

/**
 * Judge a salary change against the employee's country currency, hire date, and today — collecting
 * EVERY failing field.
 *
 * The order of the reasons is the order of the form's fields: deterministic and total, never an
 * accident of which check happened to run first (Law 6).
 *
 * The amount is parsed against the COUNTRY's currency, not the submitted one (AD-6). That is why a
 * wrong currency cell rejects the currency field alone and never makes a perfectly good amount look
 * malformed.
 */
export function validateSalaryChange(
  raw: SalaryChangeInput,
  context: SalaryChangeContext,
): SalaryChangeValidation {
  const reasons: SalaryFieldRejection[] = [];

  const effectiveFrom = checkEffectiveFromCell(raw.effectiveFrom, context.hireDate, context.today);
  collect(reasons, 'effective_from', effectiveFrom);

  const amount = checkSalaryAmount(raw.amountMinor, context.expectedCurrency);
  collect(reasons, 'amount_minor', amount);

  const currency = checkSalaryCurrency(raw.currency, context.expectedCurrency, context.countryCode);
  collect(reasons, 'currency', currency);

  if (!effectiveFrom.ok || !amount.ok || !currency.ok) {
    return { ok: false, reasons };
  }

  return {
    ok: true,
    value: {
      // The country's currency, carried by the parsed amount. The submitted cell was only ever
      // validated to equal it (AD-6).
      salary: amount.value,
      effectiveFrom: effectiveFrom.value,
    },
  };
}

/**
 * The rejection the DATABASE is the judge of (SQLSTATE `AP004`).
 *
 * The hire date is read before the write and can move underneath it, so the `BEFORE INSERT` trigger
 * is the backstop. Its verdict must reach the user as DATA, in the same sentence the domain would
 * have used had it caught the case itself — composed here rather than in the adapter so the
 * sentence has one home, like every other rejection sentence in the product.
 */
export function effectiveBeforeHireRejection(
  effectiveFrom: PlainDate,
  hireDate: PlainDate,
): SalaryFieldRejection {
  return toRejection('effective_from', {
    kind: 'effective-before-hire',
    effectiveFrom: plainDateToIso(effectiveFrom),
    hireDate: plainDateToIso(hireDate),
  });
}

/**
 * The rejection for an employee whose country no longer resolves to a currency.
 *
 * `employee.country` is set at create and immutable (AD-6), and the reference row it points at can
 * be deactivated afterwards. No input of this form caused that, so no field is to blame and the form
 * states it rather than pinning it on an innocent input.
 */
export function unknownSalaryCountryRejection(countryCode: string): SalaryFieldRejection {
  return toRejection(null, { kind: 'unknown-country', value: countryCode });
}

/**
 * The rejection a boundary returns when the repository throws for a reason nobody's input caused — a
 * deadlock, a timeout, a reference row deactivated between the read and the write.
 *
 * Mirrors `employeeWriteFailureRejection` exactly: an adapter may throw, and an unguarded call site
 * is a designed-in 500. It says nothing was RECORDED rather than nothing was saved, because
 * `salary_record` is append-only — there is no prior state that could have been disturbed.
 */
export function salaryWriteFailureRejection(): SalaryFieldRejection {
  return {
    field: null,
    offendingValue: null,
    sentence: 'The salary change could not be saved, so nothing was recorded.',
  };
}

/**
 * What each field is CALLED in a sentence a person reads.
 *
 * `effective_from` and `amount_minor` are database column tokens, and a sentence that prints one
 * puts a schema detail in front of a reader. The FIELD KEYS stay as they are — those are payload
 * identifiers a form matches its inputs against, not copy. `employee.ts` draws the same distinction
 * for `hire_date`.
 */
const SALARY_FIELD_LABELS: Readonly<Record<SalaryChangeField, string>> = {
  effective_from: 'effective date',
  amount_minor: 'amount',
  currency: 'currency',
};

/**
 * The rejection for a field that did not arrive as text at all.
 *
 * A `'use server'` export is a live RPC endpoint, and `SalaryChangeInput`'s `string` types are
 * erased at runtime — a hostile or buggy caller can send `5`, `null`, or nothing. That is ordinary
 * input, so it answers with an ordinary field rejection naming the field, never a `TypeError`
 * swallowed into a generic write failure. There is no offending VALUE because there is no text to
 * quote: printing `[object Object]` back at a reader tells them less than the field name already
 * does.
 */
export function nonTextSalaryFieldRejection(field: SalaryChangeField): SalaryFieldRejection {
  return {
    field,
    offendingValue: null,
    sentence: `The ${SALARY_FIELD_LABELS[field]} field was not submitted as text.`,
  };
}
