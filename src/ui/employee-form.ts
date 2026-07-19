import type { EmployeeDetail, EmployeeFormOptions } from '@/application/ports/employee-repository';
import type {
  CreateEmployeeResult,
  EmployeeInput,
  EmployeeUpdateInput,
  FieldRejection,
  UpdateEmployeeResult,
} from '@/application/use-cases/employees';
import type { EmployeeField } from '@/domain/employee';
import { plainDateToIso } from '@/domain/plain-date';

/**
 * Everything the employee create/edit form DECIDES, with no React in it.
 *
 * Same split as `import-report.ts` and `employee-directory.ts`, same reason: no jsdom, no
 * @testing-library, and `src/ui/*.tsx` sits outside the coverage gate. The dialog component is left
 * with no judgement to get wrong; its rendered behaviour is proven in `e2e/employees.spec.ts`.
 *
 * ## The copy projection — a spec-level decision, taken here
 *
 * `deferred-work.md` records that CAP-2 form rejections reuse the CSV importer's sentence composer
 * verbatim, so a form user reads `The hire_date cell is blank.` — spreadsheet vocabulary and a raw
 * column token, in a side panel whose field is already labelled *Hire date*. It also rules that a
 * form projection is "a spec-level decision for 3-2's copy pass, not a unilateral contract change".
 * Story 3-2's spec takes that decision, and `formRejectionText` is it.
 *
 * What it is:
 *   - a PURE projection over the payload's own structured fields (`field`, `offendingValue`);
 *   - recognizing exactly the shapes `composeRejectionSentence` produces for a CAP-2 field;
 *   - falling through to `sentence` VERBATIM for everything else.
 *
 * What it is NOT, and must never become:
 *   - a re-validation. Nothing here judges an input; the domain already did.
 *   - an edit to `composeRejectionSentence`. That composer serves the CSV rejection table too,
 *     where "the hire_date cell" is the correct and necessary identification of a cell.
 *
 * The fall-through is the load-bearing half. It is what keeps the `AP004` hire-date sentence, the
 * write-failure sentence, and any reason kind a later story adds correct BY DEFAULT rather than
 * silently mistranslated by a projection written before it existed. Law 7 holds throughout: this
 * consumes the fixed 3-1 payload and adds nothing to the contract.
 *
 * The imports are `import type` except `plainDateToIso`, which is a pure, total, clock-free domain
 * function — the calling rule `src/ui/README.md` ratified at story 1-6.
 */

/** One field, as the form presents it. */
export type EmployeeFormFieldSpec = {
  readonly field: EmployeeField;
  /**
   * What the field is CALLED on screen. `hire_date` is the one label that differs from its own key,
   * and that difference is the whole point: the key is a payload identifier, the label is copy.
   */
  readonly label: string;
};

/**
 * The six CAP-2 fields, DECLARED IN FORM ORDER. There is no seventh — no salary field, no currency
 * chooser, nothing CAP-3/CAP-4/CAP-5 owns.
 */
export const EMPLOYEE_FORM_FIELDS: Readonly<Record<EmployeeField, EmployeeFormFieldSpec>> = {
  name: { field: 'name', label: 'Name' },
  role: { field: 'role', label: 'Role' },
  level: { field: 'level', label: 'Level' },
  country: { field: 'country', label: 'Country' },
  gender: { field: 'gender', label: 'Gender' },
  hire_date: { field: 'hire_date', label: 'Hire date' },
};

/**
 * The same six as a list, in the same order — DERIVED, so the order has exactly one declaration.
 *
 * `Object.keys` preserves declaration order for non-numeric string keys (ECMA-262
 * OrdinaryOwnPropertyKeys), so the record above is the single source of both the membership and the
 * order. The cast is the one this derivation costs; a hand-written second list would cost a drift
 * gate instead.
 */
export const EMPLOYEE_FORM_FIELD_ORDER = Object.keys(
  EMPLOYEE_FORM_FIELDS,
) as readonly EmployeeField[];

/** The DOM id of a field's control, so its `<label htmlFor>` can reach it. */
export function fieldInputId(field: EmployeeField): string {
  return `employee-field-${field}`;
}

/** The DOM id of a field's rejection message, for `aria-describedby` (WCAG 2.2 AA SC 3.3.1). */
export function fieldDescribedById(field: EmployeeField): string {
  return `employee-reason-${field}`;
}

/**
 * The shapes `composeRejectionSentence` produces for a CAP-2 field, matched STRUCTURALLY.
 *
 * Anchored on both ends, so a sentence that merely contains one of these phrasings is not
 * mistaken for one — an unrecognized shape must fall through, and a loose match is how it would
 * stop doing so.
 */
const BLANK_CELL = /^The \S+ cell is blank\.$/;
const MALFORMED_DATE = /^The \S+ cell reads "[\s\S]*", which is not a date in YYYY-MM-DD form\.$/;
const UNKNOWN_CODE =
  /^(?:Role|Level|Country) code "[\s\S]*" is not in the (?:role|level|country) reference table\.$/;
const UNKNOWN_GENDER = /^Gender "[\s\S]*" is neither MALE nor FEMALE\.$/;

/** Typographic quotes, used by every sentence this module authors. The composer uses straight ones. */
function quoted(value: string): string {
  return `“${value}”`;
}

/**
 * One rejection, as the form says it.
 *
 * Total, and deterministic: same rejection in, same string out. Every branch is a RECOGNIZED shape;
 * the last line is the contract with the future.
 */
export function formRejectionText(rejection: FieldRejection): string {
  // No field is to blame, so no label applies. This is `employeeWriteFailureRejection`, and the
  // form renders it as a statement rather than pinning it on an innocent input.
  if (rejection.field === null) {
    return rejection.sentence;
  }

  const label = EMPLOYEE_FORM_FIELDS[rejection.field].label;
  const value = rejection.offendingValue;

  if (BLANK_CELL.test(rejection.sentence)) {
    return `${label} is required.`;
  }

  if (UNKNOWN_CODE.test(rejection.sentence)) {
    return value === null
      ? `${label} is not in the reference tables.`
      : `${label} ${quoted(value)} is not in the reference tables.`;
  }

  // Deliberately its own branch. "not in the reference tables" would be false for gender — it is a
  // closed vocabulary, not a table — and Law 3 requires MALE / FEMALE verbatim in copy as in code.
  if (UNKNOWN_GENDER.test(rejection.sentence)) {
    return value === null
      ? `${label} is neither MALE nor FEMALE.`
      : `${label} ${quoted(value)} is neither MALE nor FEMALE.`;
  }

  if (MALFORMED_DATE.test(rejection.sentence)) {
    return value === null
      ? `${label} is not a date in YYYY-MM-DD form.`
      : `${label} reads ${quoted(value)}, which is not a date in YYYY-MM-DD form.`;
  }

  // Unrecognized — rendered as the backend worded it, never guessed at. This is the arm that keeps
  // the AP004 sentence, the write-failure sentence, and every future reason kind correct.
  return rejection.sentence;
}

/** Every reason blaming one field, in payload order. */
export function rejectionsFor(
  reasons: readonly FieldRejection[],
  field: EmployeeField,
): readonly FieldRejection[] {
  return reasons.filter((reason) => reason.field === field);
}

/**
 * Every reason blaming NO field — rendered in a form-level region.
 *
 * Held apart deliberately: pinning an adapter failure on whichever input happened to be first would
 * be a false statement about the person's typing, and DROPPING it (the other obvious mistake) would
 * leave a form that refused to save and said nothing about why.
 */
export function formLevelRejections(
  reasons: readonly FieldRejection[],
): readonly FieldRejection[] {
  return reasons.filter((reason) => reason.field === null);
}

/**
 * The field focus moves to after a rejection (WCAG 2.2 AA SC 3.3.1 — the person must be taken to
 * the problem, not merely told there is one). `null` when nothing blames a field.
 *
 * The payload's order is the FORM's order — `validateEmployeeInput` collects in field order
 * deliberately, "never an accident of which check happened to run first" — so the first entry
 * blaming a field is also the topmost one on screen.
 */
export function firstRejectedField(reasons: readonly FieldRejection[]): EmployeeField | null {
  return reasons.find((reason) => reason.field !== null)?.field ?? null;
}

/** The six controls' values, as strings — which is what a form has and what `EmployeeInput` wants. */
export type EmployeeFormValues = {
  readonly name: string;
  readonly roleCode: string;
  readonly levelCode: string;
  readonly countryCode: string;
  readonly gender: string;
  readonly hireDate: string;
};

/**
 * The form's opening values: an employee's own for an edit, empty for a create.
 *
 * The date goes through `plainDateToIso` because `<input type="date">` reads and writes exactly that
 * canonical machine form. Round-tripping through it is what makes an edit that changes nothing
 * submit the same date it was handed.
 */
export function initialFormValues(employee: EmployeeDetail | null): EmployeeFormValues {
  if (employee === null) {
    return { name: '', roleCode: '', levelCode: '', countryCode: '', gender: '', hireDate: '' };
  }
  return {
    name: employee.name,
    roleCode: employee.roleCode,
    levelCode: employee.levelCode,
    countryCode: employee.countryCode,
    gender: employee.gender,
    hireDate: plainDateToIso(employee.hireDate),
  };
}

/** The create payload — all six fields. */
export function toCreateInput(values: EmployeeFormValues): EmployeeInput {
  return {
    name: values.name,
    roleCode: values.roleCode,
    levelCode: values.levelCode,
    countryCode: values.countryCode,
    gender: values.gender,
    hireDate: values.hireDate,
  };
}

/**
 * The edit payload — five fields, and `countryCode` ABSENT (AD-6).
 *
 * Not omitted-if-empty, not set-to-the-old-value: absent. `EmployeeUpdateInput` does not have the
 * key, so adding it would not typecheck, and `payroll_app` holds no UPDATE privilege on the column
 * either. This function is where the form's six values become the five an edit may carry.
 */
export function toUpdateInput(values: EmployeeFormValues): EmployeeUpdateInput {
  return {
    name: values.name,
    roleCode: values.roleCode,
    levelCode: values.levelCode,
    gender: values.gender,
    hireDate: values.hireDate,
  };
}

/**
 * The currency the chosen country resolves to, or `null`.
 *
 * `null` for two genuinely different situations that want the same treatment — no country chosen
 * yet, and a country that is not among the ACTIVE options. `EmployeeFormOptions` excludes inactive
 * rows, so an employee sitting on a deactivated country has no entry here; answering `null` is what
 * keeps the panel from rendering "Currency undefined" at exactly the moment something is already
 * wrong.
 */
export function currencyLineFor(
  options: EmployeeFormOptions,
  countryCode: string,
): string | null {
  const country = options.countries.find((candidate) => candidate.code === countryCode);
  if (country === undefined) {
    return null;
  }
  return `Currency ${country.currencyCode} — it follows from the country and is never chosen separately.`;
}

/**
 * What the form says when the employee it was editing is gone.
 *
 * Story 3-1's residual risks name the shape: a non-string id yields
 * `{ kind: 'not-found', employeeId: '' }`. This statement carries no id at all, so there is no
 * empty string to render where an identifier should be.
 */
export const EMPLOYEE_VANISHED_STATEMENT =
  'This employee no longer exists, so nothing was changed.';

/** `1 reason` / `2 reasons` — the singular is exact. */
function reasonsPhrase(count: number): string {
  return `${String(count)} ${count === 1 ? 'reason' : 'reasons'}`;
}

/**
 * The one statement that rides the app-level polite live region when a submission settles (AD-20).
 *
 * A COUNT rather than the reasons themselves: each reason is already rendered under its own field
 * and reachable by the focus move, and reading all of them into a polite region would repeat on
 * screen text at a moment the person is being sent to the first field anyway. Calm register,
 * statements only — no celebration on success, no alarm on a rejection.
 */
export function composeFormAnnouncement(
  result: CreateEmployeeResult | UpdateEmployeeResult,
): string {
  switch (result.kind) {
    case 'created':
      return 'Employee created.';
    case 'updated':
      return 'Employee updated.';
    case 'not-found':
      return EMPLOYEE_VANISHED_STATEMENT;
    case 'rejected':
      return `The employee was not saved. ${reasonsPhrase(result.reasons.length)}.`;
  }
}
