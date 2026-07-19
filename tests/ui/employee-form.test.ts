import { describe, expect, it } from 'vitest';

import type { EmployeeFormOptions } from '@/application/ports/employee-repository';
import type {
  CreateEmployeeResult,
  FieldRejection,
  UpdateEmployeeResult,
} from '@/application/use-cases/employees';
import type { EmployeeField } from '@/domain/employee';
import {
  composeFormAnnouncement,
  currencyLineFor,
  EMPLOYEE_FORM_FIELD_ORDER,
  EMPLOYEE_FORM_FIELDS,
  EMPLOYEE_VANISHED_STATEMENT,
  fieldDescribedById,
  fieldInputId,
  firstRejectedField,
  formLevelRejections,
  formRejectionText,
  initialFormValues,
  rejectionsFor,
  toCreateInput,
  toUpdateInput,
} from '@/ui/employee-form';

// Test-first (Law 1 / AD-23): red before `src/ui/employee-form.ts` exists.
//
// The copy projection below is a SPEC-LEVEL decision, taken by story 3-2 and recorded in its Design
// Notes. `deferred-work.md` records that CAP-2 form rejections reuse the CSV importer's sentence
// composer verbatim, so a form user reads `The hire_date cell is blank.` — spreadsheet vocabulary
// and a raw column token, beside a form field already labelled "Hire date". The ledger rules that a
// form projection is "a spec-level decision for 3-2's copy pass, not a unilateral contract change".
//
// This is that decision, and these tests are what make it a contract rather than a preference.
//
// What it is NOT: a re-validation, and not an edit to `composeRejectionSentence`. It is a pure
// projection over the payload's own structured fields (`field`, `offendingValue`) that recognizes
// exactly the shapes the composer produces and falls through to `sentence` VERBATIM for everything
// else — which is what keeps the `AP004` hire-date sentence, the write-failure sentence, and any
// future reason kind correct by default rather than silently mistranslated. Law 7 holds: this
// consumes the fixed payload and adds nothing to the contract.

function rejection(over: Partial<FieldRejection> = {}): FieldRejection {
  return { field: 'name', offendingValue: null, sentence: 'The name cell is blank.', ...over };
}

/** Two active roles, three levels by rank, two countries — the shape `loadFormOptions` answers. */
const OPTIONS: EmployeeFormOptions = {
  roles: [
    { code: 'ENG', name: 'Engineering' },
    { code: 'SAL', name: 'Sales' },
  ],
  levels: [
    { code: 'L1', name: 'Junior', rank: 1 },
    { code: 'L2', name: 'Mid', rank: 2 },
    { code: 'L3', name: 'Senior', rank: 3 },
  ],
  countries: [
    { code: 'IN', name: 'India', currencyCode: 'INR' },
    { code: 'IT', name: 'Italy', currencyCode: 'EUR' },
  ],
};

describe('EMPLOYEE_FORM_FIELDS', () => {
  it('names the six CAP-2 fields in form order, and no seventh', () => {
    expect(EMPLOYEE_FORM_FIELD_ORDER).toEqual([
      'name',
      'role',
      'level',
      'country',
      'gender',
      'hire_date',
    ]);
  });

  // `hire_date` is the payload's field key — a column token, and the ONE label that differs from
  // its own key. `src/domain/employee.ts` already goes to deliberate trouble to keep that token out
  // of user-facing copy; a form that printed it as a label would put it straight back.
  it('labels each field as a person reads it, never as the payload keys it', () => {
    expect(EMPLOYEE_FORM_FIELDS.name.label).toBe('Name');
    expect(EMPLOYEE_FORM_FIELDS.role.label).toBe('Role');
    expect(EMPLOYEE_FORM_FIELDS.level.label).toBe('Level');
    expect(EMPLOYEE_FORM_FIELDS.country.label).toBe('Country');
    expect(EMPLOYEE_FORM_FIELDS.gender.label).toBe('Gender');
    expect(EMPLOYEE_FORM_FIELDS.hire_date.label).toBe('Hire date');
  });

  it('carries no column token in any label', () => {
    for (const field of EMPLOYEE_FORM_FIELD_ORDER) {
      expect(EMPLOYEE_FORM_FIELDS[field].label).not.toContain('_');
    }
  });

  it('gives every field a distinct input id and a distinct message id', () => {
    const inputIds = EMPLOYEE_FORM_FIELD_ORDER.map(fieldInputId);
    const messageIds = EMPLOYEE_FORM_FIELD_ORDER.map(fieldDescribedById);
    expect(new Set([...inputIds, ...messageIds]).size).toBe(inputIds.length + messageIds.length);
  });
});

describe('formRejectionText — a blank field', () => {
  it('asks for the field by its label rather than reporting an empty spreadsheet cell', () => {
    expect(formRejectionText(rejection({ field: 'name' }))).toBe('Name is required.');
  });

  // The sentence the ledger names by name. `The hire_date cell is blank.` carries BOTH a
  // spreadsheet noun and a raw column token, next to a control already labelled "Hire date".
  it('strips `cell` and the raw column token out of the blank-date sentence', () => {
    const text = formRejectionText(
      rejection({ field: 'hire_date', sentence: 'The hire_date cell is blank.' }),
    );
    expect(text).toBe('Hire date is required.');
    expect(text).not.toContain('cell');
    expect(text).not.toContain('hire_date');
  });
});

describe('formRejectionText — a value that is not in the reference tables', () => {
  it('leads with the field label and quotes the offending value back', () => {
    expect(
      formRejectionText({
        field: 'role',
        offendingValue: 'Ninja',
        sentence: 'Role code "Ninja" is not in the role reference table.',
      }),
    ).toBe('Role “Ninja” is not in the reference tables.');
  });

  it('projects level and country the same way', () => {
    expect(
      formRejectionText({
        field: 'level',
        offendingValue: 'L9',
        sentence: 'Level code "L9" is not in the level reference table.',
      }),
    ).toBe('Level “L9” is not in the reference tables.');
    expect(
      formRejectionText({
        field: 'country',
        offendingValue: 'XX',
        sentence: 'Country code "XX" is not in the country reference table.',
      }),
    ).toBe('Country “XX” is not in the reference tables.');
  });

  // `role_code` / `level_code` / `country_code` are the CSV's column names, not this form's. The
  // composer does not emit them here, and the projection must not reintroduce them either.
  it('names no column token', () => {
    const text = formRejectionText({
      field: 'role',
      offendingValue: 'Ninja',
      sentence: 'Role code "Ninja" is not in the role reference table.',
    });
    expect(text).not.toContain('role_code');
    expect(text).not.toContain('code "');
  });

  it('stays a sentence when a recognized shape carries no value to quote', () => {
    const text = formRejectionText({
      field: 'role',
      offendingValue: null,
      sentence: 'Role code "" is not in the role reference table.',
    });
    expect(text).toBe('Role is not in the reference tables.');
    expect(text).not.toContain('“”');
  });
});

describe('formRejectionText — gender', () => {
  // Law 3: the two values are `MALE` and `FEMALE`, verbatim, in copy as well as in code. The
  // projection changes the quote characters to match the rest of the form's copy and nothing else —
  // "reference tables" would be a lie here, because gender is not one.
  it('keeps the exact vocabulary and never claims gender is a reference table', () => {
    const text = formRejectionText({
      field: 'gender',
      offendingValue: 'Female',
      sentence: 'Gender "Female" is neither MALE nor FEMALE.',
    });
    expect(text).toBe('Gender “Female” is neither MALE nor FEMALE.');
    expect(text).not.toContain('reference table');
  });
});

describe('formRejectionText — an unparseable date', () => {
  it('leads with the label and keeps the format instruction', () => {
    const text = formRejectionText({
      field: 'hire_date',
      offendingValue: '31-12-2020',
      sentence:
        'The hire_date cell reads "31-12-2020", which is not a date in YYYY-MM-DD form.',
    });
    expect(text).toBe('Hire date reads “31-12-2020”, which is not a date in YYYY-MM-DD form.');
    expect(text).not.toContain('cell');
    expect(text).not.toContain('hire_date');
  });

  it('drops the quotation rather than quoting nothing when no value came through', () => {
    const text = formRejectionText({
      field: 'hire_date',
      offendingValue: null,
      sentence: 'The hire_date cell reads "", which is not a date in YYYY-MM-DD form.',
    });
    expect(text).toBe('Hire date is not a date in YYYY-MM-DD form.');
    expect(text).not.toContain('hire_date');
  });
});

describe('formRejectionText — the shapes that pass through VERBATIM', () => {
  // The database's own AP004 verdict (`hireDateAfterSalaryRejection`). It already reads correctly
  // beside a form field, and re-wording it would mean this module authoring a sentence for a fact
  // the domain has already worded — exactly what Law 7 forbids.
  it('renders the AP004 hire-date sentence unmodified', () => {
    const sentence =
      'The hire date 2021-06-01 is later than an existing salary record for this employee. ' +
      'A salary cannot take effect before the person was hired.';
    expect(formRejectionText({ field: 'hire_date', offendingValue: '2021-06-01', sentence })).toBe(
      sentence,
    );
  });

  // `employeeWriteFailureRejection` — `field: null`, because nobody's input caused it.
  it('renders a form-level rejection unmodified', () => {
    const sentence = 'The employee could not be saved, so nothing was changed.';
    expect(formRejectionText({ field: null, offendingValue: null, sentence })).toBe(sentence);
  });

  // `nonTextFieldRejection` — a live RPC endpoint answering a non-string field.
  it('renders the non-text-field sentence unmodified', () => {
    const sentence = 'The hire date field was not submitted as text.';
    expect(formRejectionText({ field: 'hire_date', offendingValue: null, sentence })).toBe(sentence);
  });

  // The property that makes the projection SAFE to ship: a reason kind nobody has written yet is
  // rendered as the backend worded it, never guessed at.
  it('renders an unrecognized shape unmodified rather than guessing', () => {
    const sentence = 'Some future reason nobody has written yet.';
    expect(formRejectionText({ field: 'name', offendingValue: 'x', sentence })).toBe(sentence);
  });
});

describe('rejectionsFor / formLevelRejections / firstRejectedField', () => {
  const reasons: readonly FieldRejection[] = [
    rejection({ field: 'name' }),
    rejection({
      field: 'level',
      offendingValue: 'L9',
      sentence: 'Level code "L9" is not in the level reference table.',
    }),
    rejection({
      field: null,
      sentence: 'The employee could not be saved, so nothing was changed.',
    }),
  ];

  it('partitions the reasons by the field each one blames', () => {
    expect(rejectionsFor(reasons, 'name')).toHaveLength(1);
    expect(rejectionsFor(reasons, 'level')).toHaveLength(1);
    expect(rejectionsFor(reasons, 'role')).toHaveLength(0);
  });

  // A rejection blaming no field must not be pinned on an innocent input — and must not be dropped
  // either, which is the failure mode the Matrix calls out.
  it('holds the `field: null` reasons apart for the form-level region', () => {
    expect(formLevelRejections(reasons)).toHaveLength(1);
    expect(rejectionsFor(reasons, 'name')).not.toContain(reasons[2]);
  });

  it('names the first rejected field, so focus can move there', () => {
    expect(firstRejectedField(reasons)).toBe('name');
  });

  it('names no field when every reason is form-level', () => {
    expect(firstRejectedField([reasons[2] as FieldRejection])).toBeNull();
  });

  it('names no field when there is nothing to report', () => {
    expect(firstRejectedField([])).toBeNull();
  });
});

describe('initialFormValues', () => {
  it('is empty for a create', () => {
    expect(initialFormValues(null)).toEqual({
      name: '',
      roleCode: '',
      levelCode: '',
      countryCode: '',
      gender: '',
      hireDate: '',
    });
  });

  // `<input type="date">` reads and writes the canonical `YYYY-MM-DD` machine form, which is
  // exactly `plainDateToIso`. Round-tripping through it is what makes an edit that changes nothing
  // submit the same date it was handed.
  it('round-trips a PlainDate into the form’s date control', () => {
    expect(
      initialFormValues({
        id: 'e-1',
        name: 'Elena Rossi',
        roleCode: 'ENG',
        levelCode: 'L3',
        countryCode: 'IT',
        gender: 'FEMALE',
        hireDate: { year: 2020, month: 1, day: 6 },
      }),
    ).toEqual({
      name: 'Elena Rossi',
      roleCode: 'ENG',
      levelCode: 'L3',
      countryCode: 'IT',
      gender: 'FEMALE',
      hireDate: '2020-01-06',
    });
  });

  it('zero-pads a single-digit month and day', () => {
    const values = initialFormValues({
      id: 'e-2',
      name: 'A',
      roleCode: 'ENG',
      levelCode: 'L1',
      countryCode: 'IN',
      gender: 'MALE',
      hireDate: { year: 2020, month: 9, day: 5 },
    });
    expect(values.hireDate).toBe('2020-09-05');
  });
});

describe('toCreateInput / toUpdateInput', () => {
  const values = {
    name: 'Elena Rossi',
    roleCode: 'ENG',
    levelCode: 'L3',
    countryCode: 'IT',
    gender: 'FEMALE',
    hireDate: '2020-01-06',
  };

  it('sends all six fields on create', () => {
    expect(toCreateInput(values)).toEqual(values);
  });

  // AD-6, at the wire. Country is immutable, so the edit payload must not merely IGNORE it — the
  // key must not be there at all, which is what the acceptance criterion inspects.
  it('sends no `countryCode` key at all on update', () => {
    const update = toUpdateInput(values);
    expect(Object.keys(update).sort()).toEqual([
      'gender',
      'hireDate',
      'levelCode',
      'name',
      'roleCode',
    ]);
    expect('countryCode' in update).toBe(false);
  });
});

describe('currencyLineFor', () => {
  it('states the currency the chosen country resolves to', () => {
    const line = currencyLineFor(OPTIONS, 'IN');
    expect(line).toContain('INR');
    // Currency FOLLOWS from country and is never chosen (AD-6) — the line says so.
    expect(line).toContain('country');
  });

  it('answers null when no country is chosen yet', () => {
    expect(currencyLineFor(OPTIONS, '')).toBeNull();
  });

  // `EmployeeFormOptions` EXCLUDES inactive rows, so an employee sitting on a deactivated country
  // has no entry here. Answering `null` is what keeps the panel from rendering "Currency undefined".
  it('answers null for a country that is not among the active options', () => {
    expect(currencyLineFor(OPTIONS, 'JP')).toBeNull();
  });
});

describe('composeFormAnnouncement', () => {
  it('states a create and an edit that landed', () => {
    expect(composeFormAnnouncement({ kind: 'created', employeeId: 'e-1' })).toBe(
      'Employee created.',
    );
    expect(composeFormAnnouncement({ kind: 'updated', employeeId: 'e-1' })).toBe(
      'Employee updated.',
    );
  });

  it('counts the reasons rather than reading them all out', () => {
    const one: CreateEmployeeResult = { kind: 'rejected', reasons: [rejection()] };
    const two: CreateEmployeeResult = {
      kind: 'rejected',
      reasons: [rejection(), rejection({ field: 'role' })],
    };
    expect(composeFormAnnouncement(one)).toBe('The employee was not saved. 1 reason.');
    expect(composeFormAnnouncement(two)).toBe('The employee was not saved. 2 reasons.');
  });

  // Story 3-1's residual risks name this shape explicitly: a non-string id yields
  // `{ kind: 'not-found', employeeId: '' }`, and a surface that rendered that field would show an
  // empty string where an identifier should be. One statement, no id in it.
  it('states that the employee is gone without ever rendering the id', () => {
    const gone: UpdateEmployeeResult = { kind: 'not-found', employeeId: '' };
    expect(composeFormAnnouncement(gone)).toBe(EMPLOYEE_VANISHED_STATEMENT);
    expect(EMPLOYEE_VANISHED_STATEMENT).not.toContain('""');
  });
});

describe('the projected copy as a whole', () => {
  // The acceptance criterion, applied to every sentence this module can author: no rendered text
  // contains `cell`, `hire_date`, `role_code`, `level_code`, or `country_code`.
  const BANNED = ['cell', 'hire_date', 'role_code', 'level_code', 'country_code'];

  const COMPOSER_SENTENCES: readonly { field: EmployeeField; value: string | null; sentence: string }[] =
    [
      { field: 'name', value: null, sentence: 'The name cell is blank.' },
      { field: 'hire_date', value: null, sentence: 'The hire_date cell is blank.' },
      {
        field: 'role',
        value: 'Ninja',
        sentence: 'Role code "Ninja" is not in the role reference table.',
      },
      {
        field: 'level',
        value: 'L9',
        sentence: 'Level code "L9" is not in the level reference table.',
      },
      {
        field: 'country',
        value: 'XX',
        sentence: 'Country code "XX" is not in the country reference table.',
      },
      { field: 'gender', value: 'Female', sentence: 'Gender "Female" is neither MALE nor FEMALE.' },
      {
        field: 'hire_date',
        value: '31-12-2020',
        sentence:
          'The hire_date cell reads "31-12-2020", which is not a date in YYYY-MM-DD form.',
      },
    ];

  it('carries no spreadsheet vocabulary and no column token, for every reason CAP-2 can produce', () => {
    for (const { field, value, sentence } of COMPOSER_SENTENCES) {
      const text = formRejectionText({ field, offendingValue: value, sentence });
      for (const banned of BANNED) {
        expect(text).not.toContain(banned);
      }
    }
  });

  it('leaves every projected sentence a real sentence', () => {
    for (const { field, value, sentence } of COMPOSER_SENTENCES) {
      const text = formRejectionText({ field, offendingValue: value, sentence });
      expect(text.endsWith('.')).toBe(true);
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
