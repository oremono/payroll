import { describe, expect, it } from 'vitest';

import {
  EMPLOYEE_CREATE_FIELDS,
  EMPLOYEE_UPDATE_FIELDS,
  employeeWriteFailureRejection,
  hireDateAfterSalaryRejection,
  nonTextFieldRejection,
  validateEmployeeInput,
  validateEmployeeUpdate,
  type EmployeeInput,
  type EmployeeUpdateInput,
} from '@/domain/employee';
import type { ReferenceData } from '@/domain/employee-fields';

// Test-first (Law 1 / AD-23): this spec lands, red, before `src/domain/employee.ts` exists.
//
// It mirrors the story's I/O & Edge-Case Matrix for every row that is DOMAIN-level, and then adds
// the cases the matrix implies but does not enumerate — the case-sensitivity of every code, the
// whitespace forms, a FUTURE hire date being accepted, and the multi-field collection that is the
// entire reason this validator exists separately from `validateImportRow`. Those extras are not
// padding: the domain gate is 100% MUTATION score, not merely 100% coverage, so each one is the
// only test that can kill a specific mutant.
//
// Reference data arrives as an ARGUMENT, never a lookup (Law 2 / AD-1). There is no `today`
// argument anywhere in this file, and that absence is the point: a future hire date is accepted, so
// no CAP-2 rule is date-relative and no clock is involved anywhere in this story (Law 6).

const REFS: ReferenceData = {
  roleCodes: new Set(['software_engineer', 'data_scientist']),
  levelCodes: new Set(['L1', 'L3']),
  // Country -> the currency AD-6 derives from it. CAP-2 writes no salary record, so it uses only
  // the map's keys — but the shape is the one shared `ReferenceData`, not a second one.
  countryCurrencies: new Map([
    ['IN', 'INR'],
    ['JP', 'JPY'],
  ]),
};

/** An input every field of which is valid. Each test below spoils exactly one field. */
function validInput(overrides: Partial<EmployeeInput> = {}): EmployeeInput {
  return {
    name: 'Ada Lovelace',
    roleCode: 'software_engineer',
    levelCode: 'L3',
    countryCode: 'IN',
    gender: 'FEMALE',
    hireDate: '2021-06-01',
    ...overrides,
  };
}

/** The same, minus the field an edit may not touch (AD-6). */
function validUpdate(overrides: Partial<EmployeeUpdateInput> = {}): EmployeeUpdateInput {
  return {
    name: 'Ada Lovelace',
    roleCode: 'software_engineer',
    levelCode: 'L3',
    gender: 'FEMALE',
    hireDate: '2021-06-01',
    ...overrides,
  };
}

/** The fields named by a rejection, in the order the validator reported them. */
function rejectedFields(result: { ok: boolean; reasons?: readonly { field: string | null }[] }) {
  return (result.reasons ?? []).map((reason) => reason.field);
}

describe('validateEmployeeInput — the valid employee', () => {
  it('accepts a well-formed input and returns every field as a parsed value', () => {
    const result = validateEmployeeInput(validInput(), REFS);

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Ada Lovelace',
        roleCode: 'software_engineer',
        levelCode: 'L3',
        countryCode: 'IN',
        gender: 'FEMALE',
        hireDate: { year: 2021, month: 6, day: 1 },
      },
    });
  });

  it('carries NO salary field — an employee is created without a salary record (UX-DR13/AD-16)', () => {
    const result = validateEmployeeInput(validInput(), REFS);

    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.value).sort()).toEqual([
      'countryCode',
      'gender',
      'hireDate',
      'levelCode',
      'name',
      'roleCode',
    ]);
  });

  it('accepts MALE as well as FEMALE — the vocabulary is exactly those two (Law 3)', () => {
    const result = validateEmployeeInput(validInput({ gender: 'MALE' }), REFS);

    expect(result.ok && result.value.gender).toBe('MALE');
  });

  it('trims surrounding whitespace from every field before judging it', () => {
    // Whitespace on BOTH sides, so a `trimStart`/`trimEnd` substitution cannot survive either.
    const result = validateEmployeeInput(
      {
        name: '  Ada Lovelace  ',
        roleCode: '  software_engineer  ',
        levelCode: '  L3  ',
        countryCode: '  IN  ',
        gender: '  FEMALE  ',
        hireDate: '  2021-06-01  ',
      },
      REFS,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Ada Lovelace',
        roleCode: 'software_engineer',
        levelCode: 'L3',
        countryCode: 'IN',
        gender: 'FEMALE',
        hireDate: { year: 2021, month: 6, day: 1 },
      },
    });
  });

  it('ACCEPTS a future hire date — nothing forbids one; they are simply out of population', () => {
    // The Matrix says so explicitly, and `validateImportRow` does not reject one either. This is
    // also the test that would fail first if anyone reintroduced a `today` parameter here.
    const result = validateEmployeeInput(validInput({ hireDate: '2099-12-31' }), REFS);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ hireDate: { year: 2099, month: 12, day: 31 } }),
      }),
    );
  });
});

describe('validateEmployeeInput — one bad field at a time', () => {
  it('rejects a blank name, naming `name` and offering no offending value', () => {
    const result = validateEmployeeInput(validInput({ name: '' }), REFS);

    expect(result).toEqual({
      ok: false,
      reasons: [{ field: 'name', offendingValue: null, sentence: 'The name cell is blank.' }],
    });
  });

  it('rejects a whitespace-only name — blankness survives trimming', () => {
    const result = validateEmployeeInput(validInput({ name: '   ' }), REFS);

    expect(rejectedFields(result)).toEqual(['name']);
  });

  it('rejects an unknown role, naming the field and the offending value', () => {
    const result = validateEmployeeInput(validInput({ roleCode: 'wizard' }), REFS);

    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          field: 'role',
          offendingValue: 'wizard',
          sentence: 'Role code "wizard" is not in the role reference table.',
        },
      ],
    });
  });

  it('rejects an unknown level, naming the field and the offending value', () => {
    const result = validateEmployeeInput(validInput({ levelCode: 'L9' }), REFS);

    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          field: 'level',
          offendingValue: 'L9',
          sentence: 'Level code "L9" is not in the level reference table.',
        },
      ],
    });
  });

  it('rejects an unknown country, naming the field and the offending value', () => {
    const result = validateEmployeeInput(validInput({ countryCode: 'ZZ' }), REFS);

    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          field: 'country',
          offendingValue: 'ZZ',
          sentence: 'Country code "ZZ" is not in the country reference table.',
        },
      ],
    });
  });

  it('rejects a gender that is not exactly MALE or FEMALE', () => {
    const result = validateEmployeeInput(validInput({ gender: 'Female' }), REFS);

    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          field: 'gender',
          offendingValue: 'Female',
          sentence: 'Gender "Female" is neither MALE nor FEMALE.',
        },
      ],
    });
  });

  it('rejects an unparseable hire date, naming the offending value', () => {
    const result = validateEmployeeInput(validInput({ hireDate: '31-12-2020' }), REFS);

    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          field: 'hire_date',
          offendingValue: '31-12-2020',
          sentence:
            'The hire_date cell reads "31-12-2020", which is not a date in YYYY-MM-DD form.',
        },
      ],
    });
  });

  it('rejects a date that is well-shaped but not a real calendar day', () => {
    const result = validateEmployeeInput(validInput({ hireDate: '2026-02-30' }), REFS);

    expect(rejectedFields(result)).toEqual(['hire_date']);
  });

  it('reports a BLANK hire date with offendingValue null, not the column name', () => {
    // Import's `rejectionOffendingValue` answers `'hire_date'` here, which is a sensible cell
    // identifier in a CSV report table and nonsense beside a form field already labelled "Hire
    // date". CAP-2 maps it; import's behaviour is deliberately left alone.
    const result = validateEmployeeInput(validInput({ hireDate: '' }), REFS);

    expect(result).toEqual({
      ok: false,
      reasons: [
        { field: 'hire_date', offendingValue: null, sentence: 'The hire_date cell is blank.' },
      ],
    });
  });

  it('still reports a MALFORMED date WITH its offending value — only blankness is mapped', () => {
    const result = validateEmployeeInput(validInput({ hireDate: 'yesterday' }), REFS);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasons[0]?.offendingValue).toBe('yesterday');
  });
});

describe('validateEmployeeInput — codes are case-sensitive (AD-7: nothing is guessed)', () => {
  it.each([
    ['role', { roleCode: 'SOFTWARE_ENGINEER' }],
    ['level', { levelCode: 'l3' }],
    ['country', { countryCode: 'in' }],
    ['gender', { gender: 'male' }],
  ] as const)('rejects %s when only its case differs', (field, overrides) => {
    const result = validateEmployeeInput(validInput(overrides), REFS);

    expect(rejectedFields(result)).toEqual([field]);
  });
});

describe('validateEmployeeInput — ALL failing fields, because a form shows every problem at once', () => {
  it('reports a blank name AND an unknown level together, one entry each', () => {
    const result = validateEmployeeInput(validInput({ name: ' ', levelCode: 'L9' }), REFS);

    expect(rejectedFields(result)).toEqual(['name', 'level']);
  });

  it('reports all six fields when all six are bad, in form-field order', () => {
    // The order is the FORM's order, deterministic and total — never an accident of which check
    // happened to run first (Law 6).
    const result = validateEmployeeInput(
      {
        name: '',
        roleCode: 'wizard',
        levelCode: 'L9',
        countryCode: 'ZZ',
        gender: 'x',
        hireDate: 'nope',
      },
      REFS,
    );

    expect(rejectedFields(result)).toEqual([
      'name',
      'role',
      'level',
      'country',
      'gender',
      'hire_date',
    ]);
  });

  it.each([
    ['name', { name: '' }],
    ['role', { roleCode: 'wizard' }],
    ['level', { levelCode: 'L9' }],
    ['country', { countryCode: 'ZZ' }],
    ['gender', { gender: 'x' }],
    ['hire_date', { hireDate: 'nope' }],
  ] as const)('fails the whole input when only %s is bad', (field, overrides) => {
    // One case per disjunct of the "did anything fail" test, so no single term can be dropped
    // without a red test.
    const result = validateEmployeeInput(validInput(overrides), REFS);

    expect(result.ok).toBe(false);
    expect(rejectedFields(result)).toEqual([field]);
  });
});

describe('validateEmployeeUpdate — the same rules, and no country at all (AD-6)', () => {
  it('accepts a well-formed update and returns no countryCode', () => {
    const result = validateEmployeeUpdate(validUpdate(), REFS);

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Ada Lovelace',
        roleCode: 'software_engineer',
        levelCode: 'L3',
        gender: 'FEMALE',
        hireDate: { year: 2021, month: 6, day: 1 },
      },
    });
  });

  it('accepts MALE, so the gender check is genuinely reached on this path too', () => {
    const result = validateEmployeeUpdate(validUpdate({ gender: 'MALE' }), REFS);

    expect(result.ok && result.value.gender).toBe('MALE');
  });

  it('accepts a future hire date on edit as well', () => {
    const result = validateEmployeeUpdate(validUpdate({ hireDate: '2099-12-31' }), REFS);

    expect(result.ok && result.value.hireDate).toEqual({ year: 2099, month: 12, day: 31 });
  });

  it('never judges a country — an edit that names one is not even expressible', () => {
    // An employee whose country was deactivated after they were created must still be renameable;
    // validating a stored country on every edit would refuse that.
    const result = validateEmployeeUpdate(validUpdate(), {
      ...REFS,
      countryCurrencies: new Map(),
    });

    expect(result.ok).toBe(true);
  });

  it.each([
    ['name', { name: '' }],
    ['role', { roleCode: 'wizard' }],
    ['level', { levelCode: 'L9' }],
    ['gender', { gender: 'x' }],
    ['hire_date', { hireDate: 'nope' }],
  ] as const)('fails the whole update when only %s is bad', (field, overrides) => {
    const result = validateEmployeeUpdate(validUpdate(overrides), REFS);

    expect(result.ok).toBe(false);
    expect(rejectedFields(result)).toEqual([field]);
  });

  it('reports every failing field at once, in form-field order and with no country slot', () => {
    const result = validateEmployeeUpdate(
      { name: '', roleCode: 'wizard', levelCode: 'L9', gender: 'x', hireDate: 'nope' },
      REFS,
    );

    expect(rejectedFields(result)).toEqual(['name', 'role', 'level', 'gender', 'hire_date']);
  });

  it('maps a blank hire date to offendingValue null on the edit path too', () => {
    const result = validateEmployeeUpdate(validUpdate({ hireDate: '  ' }), REFS);

    expect(result).toEqual({
      ok: false,
      reasons: [
        { field: 'hire_date', offendingValue: null, sentence: 'The hire_date cell is blank.' },
      ],
    });
  });
});

describe('the rejections no field validator produces', () => {
  it('names hire_date and its value when the DATABASE is the judge (SQLSTATE AP004)', () => {
    const rejection = hireDateAfterSalaryRejection({ year: 2024, month: 3, day: 9 });

    expect(rejection).toEqual({
      field: 'hire_date',
      offendingValue: '2024-03-09',
      sentence:
        'The hire date 2024-03-09 is later than an existing salary record for this employee. ' +
        'A salary cannot take effect before the person was hired.',
    });
  });

  it('blames NO field when the write itself failed — nobody typed a deadlock', () => {
    expect(employeeWriteFailureRejection()).toEqual({
      field: null,
      offendingValue: null,
      sentence: 'The employee could not be saved, so nothing was changed.',
    });
  });

  it('names the field that arrived as something other than text', () => {
    // A `'use server'` export is a live RPC endpoint and `EmployeeInput`'s `string` types are
    // erased at runtime, so this rejection is reachable from an ordinary hostile call.
    expect(nonTextFieldRejection('role')).toEqual({
      field: 'role',
      offendingValue: null,
      sentence: 'The role field was not submitted as text.',
    });
  });

  it('spells the field name into the sentence rather than a fixed word', () => {
    expect(nonTextFieldRejection('level').sentence).toBe(
      'The level field was not submitted as text.',
    );
  });

  it('uses the HUMAN label, never the internal column token, in the sentence', () => {
    // `hire_date` is a database column name. The same module goes to deliberate trouble to keep
    // that token OUT of the blank-date case (`employeeOffendingValue` maps it to null, because
    // beside a form field labelled "Hire date" it reads as though the user typed those words) —
    // and then printing it here would put it back in a user-facing sentence anyway.
    expect(nonTextFieldRejection('hire_date').sentence).toBe(
      'The hire date field was not submitted as text.',
    );
    // The field itself is unchanged: it is the payload's key for the form input, not copy.
    expect(nonTextFieldRejection('hire_date').field).toBe('hire_date');
  });

  it('has a human label for EVERY field, none of them carrying an underscore', () => {
    for (const field of ['name', 'role', 'level', 'country', 'gender', 'hire_date'] as const) {
      expect(nonTextFieldRejection(field).sentence).not.toContain('_');
    }
  });
});

describe('the field tables the boundary coerces against', () => {
  it('pairs every create input key with the field it reports under', () => {
    expect(EMPLOYEE_CREATE_FIELDS).toEqual([
      ['name', 'name'],
      ['roleCode', 'role'],
      ['levelCode', 'level'],
      ['countryCode', 'country'],
      ['gender', 'gender'],
      ['hireDate', 'hire_date'],
    ]);
  });

  it('omits countryCode from the update table — an edit may not touch it (AD-6)', () => {
    expect(EMPLOYEE_UPDATE_FIELDS).toEqual([
      ['name', 'name'],
      ['roleCode', 'role'],
      ['levelCode', 'level'],
      ['gender', 'gender'],
      ['hireDate', 'hire_date'],
    ]);
  });
});
