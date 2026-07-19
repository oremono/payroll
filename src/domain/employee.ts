/**
 * The pure CAP-2 employee validator — the ONE place employee field rules are applied to a form.
 * (Law 2 / AD-1, AD-7)
 *
 * No I/O, no clock, no randomness, no imports outside this layer. Every function here is TOTAL: a
 * rejection is a RETURN VALUE, never an exception, all the way out to the Server Action.
 *
 * ## The field set, and the salary that is not in it
 *
 * Name, role, level, country, gender, hire date. There is NO salary field: an employee is created
 * without a salary record, and is legitimately outside the as-of population (AD-16) until CAP-3
 * gives them one. The write funnel's invariants — currency-from-country, no future-dating — are
 * properties of a SALARY RECORD, so an employee create writes none and there is nothing for them to
 * govern.
 *
 * ## Why there is no `today` argument
 *
 * A FUTURE hire date is accepted. Nothing forbids one — `validateImportRow` does not reject one
 * either — and a future-hired employee is simply out of population until their date arrives. Once
 * that is settled, no CAP-2 rule is date-relative, so no clock is involved anywhere in this story.
 * Threading a `today` parameter through for symmetry with import would be an UNUSED dependency,
 * which is a Law 6 hazard rather than compliance.
 *
 * ## Why ALL failing fields, when import reports the first
 *
 * Import reports per ROW in a batch, where one reason per row is the useful unit and the ordering
 * is contractual. A form reports per FIELD, where surfacing one problem at a time forces a
 * round-trip per mistake. Same validators (`employee-fields.ts`), different collection strategy —
 * which is exactly why the validators were extracted rather than the whole of `validateImportRow`
 * reused.
 */

import {
  checkCountryCode,
  checkDateCell,
  checkGender,
  checkLevelCode,
  checkName,
  checkRoleCode,
  type FieldCheck,
  type FieldRejectionReason,
  type Gender,
  type ReferenceData,
} from './employee-fields';
import { composeRejectionSentence, rejectionOffendingValue } from './import-rejection';
import { plainDateToIso, type PlainDate } from './plain-date';

/**
 * The CAP-2 field set, named as the form and the payload name them. `hire_date` keeps the column
 * spelling the import vocabulary already uses, so one sentence composer serves both surfaces.
 */
export type EmployeeField = 'name' | 'role' | 'level' | 'country' | 'gender' | 'hire_date';

/** The create input: six raw strings, exactly as a form submitted them. */
export type EmployeeInput = {
  readonly name: string;
  readonly roleCode: string;
  readonly levelCode: string;
  readonly countryCode: string;
  readonly gender: string;
  readonly hireDate: string;
};

/**
 * The edit input. `countryCode` is ABSENT — not optional, not ignored, absent (AD-6). Country is set
 * at create and immutable thereafter, because changing it would invalidate the currency already
 * written onto that employee's historical salary records and would silently move them between peer
 * groups. A call attempting to change it must fail to TYPECHECK, and the database backs the same
 * invariant up with a column-level grant that omits `country_code`.
 */
export type EmployeeUpdateInput = Omit<EmployeeInput, 'countryCode'>;

/**
 * Which input key reports under which field name — the table the Server Action boundary coerces
 * against, so the mapping lives in the domain rather than being re-typed at a boundary that could
 * drift from it.
 */
export const EMPLOYEE_CREATE_FIELDS = [
  ['name', 'name'],
  ['roleCode', 'role'],
  ['levelCode', 'level'],
  ['countryCode', 'country'],
  ['gender', 'gender'],
  ['hireDate', 'hire_date'],
] as const satisfies readonly (readonly [keyof EmployeeInput, EmployeeField])[];

/** The same, minus the field an edit may not touch (AD-6). */
export const EMPLOYEE_UPDATE_FIELDS = [
  ['name', 'name'],
  ['roleCode', 'role'],
  ['levelCode', 'level'],
  ['gender', 'gender'],
  ['hireDate', 'hire_date'],
] as const satisfies readonly (readonly [keyof EmployeeUpdateInput, EmployeeField])[];

/** An employee that survived every judgement — parsed values, ready for the repository. */
export type ValidatedEmployee = {
  readonly name: string;
  readonly roleCode: string;
  readonly levelCode: string;
  readonly countryCode: string;
  readonly gender: Gender;
  readonly hireDate: PlainDate;
};

/** The same, minus the field an edit may not touch. */
export type ValidatedEmployeeUpdate = Omit<ValidatedEmployee, 'countryCode'>;

/**
 * One problem with one field, as the form shows it.
 *
 * `field` is nullable for the same reason `offendingValue` is: some rejections have no single thing
 * to blame. A blank name has no offending VALUE (the blankness is the value); a write that failed at
 * the database has no offending FIELD (nobody's input caused it). A form renders a null field as a
 * form-level statement rather than pinning the blame on an innocent input.
 *
 * The `sentence` is composed by the ONE composer (`import-rejection.ts`) for every reason a field
 * validator can produce, so the employee form and the import report say the same thing the same way
 * (Law 8 / AD-20).
 */
export type FieldRejection = {
  readonly field: EmployeeField | null;
  readonly offendingValue: string | null;
  readonly sentence: string;
};

/** The judgement on a create input. `ok: false` carries EVERY failing field; nothing throws. */
export type EmployeeValidation =
  | { readonly ok: true; readonly value: ValidatedEmployee }
  | { readonly ok: false; readonly reasons: readonly FieldRejection[] };

/** The judgement on an edit input. */
export type EmployeeUpdateValidation =
  | { readonly ok: true; readonly value: ValidatedEmployeeUpdate }
  | { readonly ok: false; readonly reasons: readonly FieldRejection[] };

/**
 * The offending value a FORM shows, which is not always the one a CSV REPORT shows.
 *
 * They differ in exactly one case. Import's `rejectionOffendingValue` answers `'hire_date'` for a
 * blank date, because in a rejection table whose columns are "value" and "reason" the column name
 * is the only thing identifying which cell was empty. Beside a form field already labelled "Hire
 * date" the same string is nonsense — it reads as though the user typed the words "hire date". So
 * CAP-2 maps it to `null`, the same `null` a blank name already answers, and import's behaviour is
 * deliberately left alone.
 */
function employeeOffendingValue(reason: FieldRejectionReason): string | null {
  if (reason.kind === 'missing-date') {
    return null;
  }
  return rejectionOffendingValue(reason);
}

/**
 * Record a failed check against the field it belongs to. The sentence comes from the one composer —
 * this function chooses it no more than it chooses the rule.
 */
function collect(
  reasons: FieldRejection[],
  field: EmployeeField,
  check: FieldCheck<unknown>,
): void {
  if (!check.ok) {
    reasons.push({
      field,
      offendingValue: employeeOffendingValue(check.reason),
      sentence: composeRejectionSentence(check.reason),
    });
  }
}

/**
 * Judge a create input against the reference tables, collecting EVERY failing field.
 *
 * The order of the reasons is the order of the form's fields — deterministic and total, never an
 * accident of which check happened to run first (Law 6).
 */
export function validateEmployeeInput(
  raw: EmployeeInput,
  refs: ReferenceData,
): EmployeeValidation {
  const reasons: FieldRejection[] = [];

  const name = checkName(raw.name);
  collect(reasons, 'name', name);

  const role = checkRoleCode(raw.roleCode, refs);
  collect(reasons, 'role', role);

  const level = checkLevelCode(raw.levelCode, refs);
  collect(reasons, 'level', level);

  const country = checkCountryCode(raw.countryCode, refs);
  collect(reasons, 'country', country);

  const gender = checkGender(raw.gender);
  collect(reasons, 'gender', gender);

  const hireDate = checkDateCell(raw.hireDate, 'hire_date');
  collect(reasons, 'hire_date', hireDate);

  if (!name.ok || !role.ok || !level.ok || !country.ok || !gender.ok || !hireDate.ok) {
    return { ok: false, reasons };
  }

  return {
    ok: true,
    value: {
      name: name.value,
      roleCode: role.value,
      levelCode: level.value,
      // Only the code is kept. The currency the country resolves to is AD-6's business and belongs
      // to a salary record, and this story writes none.
      countryCode: country.value.countryCode,
      gender: gender.value,
      hireDate: hireDate.value,
    },
  };
}

/**
 * Judge an edit input. Same rules, same order, same sentences — and no country at all.
 *
 * Country is not merely skipped, it is UNEXPRESSIBLE: the input type omits it. The alternative —
 * reading the employee's stored country and validating it on every edit — would refuse a name
 * change for anyone whose country was later deactivated, which is a bug wearing the costume of
 * thoroughness.
 */
export function validateEmployeeUpdate(
  raw: EmployeeUpdateInput,
  refs: ReferenceData,
): EmployeeUpdateValidation {
  const reasons: FieldRejection[] = [];

  const name = checkName(raw.name);
  collect(reasons, 'name', name);

  const role = checkRoleCode(raw.roleCode, refs);
  collect(reasons, 'role', role);

  const level = checkLevelCode(raw.levelCode, refs);
  collect(reasons, 'level', level);

  const gender = checkGender(raw.gender);
  collect(reasons, 'gender', gender);

  const hireDate = checkDateCell(raw.hireDate, 'hire_date');
  collect(reasons, 'hire_date', hireDate);

  if (!name.ok || !role.ok || !level.ok || !gender.ok || !hireDate.ok) {
    return { ok: false, reasons };
  }

  return {
    ok: true,
    value: {
      name: name.value,
      roleCode: role.value,
      levelCode: level.value,
      gender: gender.value,
      hireDate: hireDate.value,
    },
  };
}

/**
 * The rejection the DATABASE is the judge of (AD-16, SQLSTATE `AP004`).
 *
 * Moving a hire date LATER than an employee's earliest existing salary record walks the data into a
 * state where a salary took effect before the person was hired. This story cannot judge that without
 * reading the salary history, so the database judges it — and its verdict must reach the user as
 * DATA, not as an exception. Composed here rather than in the adapter so the sentence has one home,
 * like every other rejection sentence in the product.
 */
export function hireDateAfterSalaryRejection(hireDate: PlainDate): FieldRejection {
  const iso = plainDateToIso(hireDate);
  return {
    field: 'hire_date',
    offendingValue: iso,
    sentence:
      `The hire date ${iso} is later than an existing salary record for this employee. ` +
      'A salary cannot take effect before the person was hired.',
  };
}

/**
 * The rejection a boundary returns when the repository throws for a reason nobody's input caused — a
 * deadlock, a timeout, a reference row deactivated between the read and the write.
 *
 * Mirrors `handleImportRequest`'s whole-file `write-failed` refusal exactly: an adapter may throw,
 * and an unguarded call site is a designed-in 500. No single field is to blame, so `field` is `null`
 * and the form shows this as a statement rather than pinning it on an input.
 */
export function employeeWriteFailureRejection(): FieldRejection {
  return {
    field: null,
    offendingValue: null,
    sentence: 'The employee could not be saved, so nothing was changed.',
  };
}

/**
 * What each field is CALLED in a sentence a person reads.
 *
 * Only `hire_date` differs from its own name, and that difference is the whole point: `hire_date` is
 * a database column token, and this module already goes to deliberate trouble to keep that token out
 * of user-facing copy (see `employeeOffendingValue`, which maps import's blank-date offending value
 * away from exactly this string). A sentence that prints it puts it straight back. The FIELD keys
 * stay as they are — those are payload identifiers a form matches its inputs against, not copy.
 */
const EMPLOYEE_FIELD_LABELS: Readonly<Record<EmployeeField, string>> = {
  name: 'name',
  role: 'role',
  level: 'level',
  country: 'country',
  gender: 'gender',
  hire_date: 'hire date',
};

/**
 * The rejection for a field that did not arrive as text at all.
 *
 * A `'use server'` export is a live RPC endpoint, and `EmployeeInput`'s `string` types are erased at
 * runtime — a hostile or buggy caller can send `42`, `null`, or nothing. That is ordinary input, so
 * it answers with an ordinary field rejection naming the field, never a `TypeError` swallowed into a
 * generic write failure. There is no offending VALUE because there is no text to quote: printing
 * `[object Object]` back at a reader tells them less than the field name already does.
 */
export function nonTextFieldRejection(field: EmployeeField): FieldRejection {
  return {
    field,
    offendingValue: null,
    sentence: `The ${EMPLOYEE_FIELD_LABELS[field]} field was not submitted as text.`,
  };
}
