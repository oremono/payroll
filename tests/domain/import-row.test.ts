import { describe, expect, it } from 'vitest';

import {
  MAX_AMOUNT_MINOR,
  validateImportRow,
  type ImportRowInput,
  type ReferenceData,
} from '@/domain/import-row';

// Test-first (Law 1 / AD-23): this spec lands, red, before `src/domain/import-row.ts` exists.
//
// It mirrors the story's row-level I/O & Edge-Case Matrix row for row, and then adds the boundary
// cases the matrix implies but does not enumerate — the today/hire-date boundaries (which are
// INCLUSIVE on both ends), the amount boundaries at 0, 1, and the PostgreSQL `bigint` maximum, and
// the whitespace forms of every cell. Those extras are not padding: the domain gate is 100%
// MUTATION score, not 100% coverage, so each one is the only test that can kill a specific mutant.
//
// The reference data arrives as an ARGUMENT, never a lookup (Law 2 / AD-1), and so does `today`
// (Law 6 / AD-11) — that is what keeps this suite DB-free and clock-free.

const REFS: ReferenceData = {
  roleCodes: new Set(['software_engineer', 'data_scientist']),
  levelCodes: new Set(['L1', 'L3']),
  // Country -> the currency AD-6 derives from it. INR and JPY both appear so that no test can
  // pass by accident against a single-currency world.
  countryCurrencies: new Map([
    ['IN', 'INR'],
    ['JP', 'JPY'],
  ]),
};

const TODAY = { year: 2026, month: 7, day: 19 };

/** A row every cell of which is valid. Each test below spoils exactly one cell. */
function validRow(overrides: Partial<ImportRowInput> = {}): ImportRowInput {
  return {
    name: 'Ada Lovelace',
    roleCode: 'software_engineer',
    levelCode: 'L3',
    countryCode: 'IN',
    gender: 'FEMALE',
    hireDate: '2021-06-01',
    amountMinor: '234000000',
    currency: 'INR',
    effectiveFrom: '2025-04-01',
    ...overrides,
  };
}

describe('validateImportRow — the valid row', () => {
  it('accepts a well-formed row and returns every cell as a parsed value', () => {
    const result = validateImportRow(validRow(), REFS, TODAY);

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Ada Lovelace',
        roleCode: 'software_engineer',
        levelCode: 'L3',
        countryCode: 'IN',
        gender: 'FEMALE',
        hireDate: { year: 2021, month: 6, day: 1 },
        // AD-4: money is never bare. The currency is the one AD-6 DERIVED from the country, not
        // the one the file supplied — the file's cell was only ever validated against it.
        salary: { amountMinor: 234000000n, currency: 'INR' },
        effectiveFrom: { year: 2025, month: 4, day: 1 },
      },
    });
  });

  it('accepts MALE as well as FEMALE — the vocabulary is exactly those two (Law 3)', () => {
    const result = validateImportRow(validRow({ gender: 'MALE' }), REFS, TODAY);

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(result.ok && result.value.gender).toBe('MALE');
  });

  it('trims surrounding whitespace from every cell before judging it', () => {
    // Kills every `trim()` removal mutant at once, and does it with whitespace on BOTH sides so a
    // `trimStart`/`trimEnd` substitution cannot survive either.
    const result = validateImportRow(
      validRow({
        name: '  Ada Lovelace  ',
        roleCode: ' software_engineer ',
        levelCode: '\tL3\t',
        countryCode: ' IN ',
        gender: ' FEMALE ',
        hireDate: ' 2021-06-01 ',
        amountMinor: ' 234000000 ',
        currency: ' INR ',
        effectiveFrom: ' 2025-04-01 ',
      }),
      REFS,
      TODAY,
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
        salary: { amountMinor: 234000000n, currency: 'INR' },
        effectiveFrom: { year: 2025, month: 4, day: 1 },
      },
    });
  });

  it('derives the currency from the country, not from the file, for a second country', () => {
    const result = validateImportRow(
      validRow({ countryCode: 'JP', currency: 'JPY' }),
      REFS,
      TODAY,
    );

    expect(result.ok && result.value.salary.currency).toBe('JPY');
  });
});

describe('validateImportRow — the name cell', () => {
  it('rejects an empty name', () => {
    expect(validateImportRow(validRow({ name: '' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'blank-name' },
    });
  });

  it('rejects a whitespace-only name — the DB CHECK must never be the first to notice', () => {
    expect(validateImportRow(validRow({ name: '   ' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'blank-name' },
    });
  });
});

describe('validateImportRow — the reference-table cells (AD-7: no guessing)', () => {
  it('rejects an unknown role, naming the value', () => {
    expect(validateImportRow(validRow({ roleCode: 'wizard' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-role', value: 'wizard' },
    });
  });

  it('rejects an unknown level, naming the value', () => {
    expect(validateImportRow(validRow({ levelCode: 'L9' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-level', value: 'L9' },
    });
  });

  it('rejects an unknown country, naming the value', () => {
    expect(validateImportRow(validRow({ countryCode: 'XX' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-country', value: 'XX' },
    });
  });

  it('rejects a role that differs only in case — a near-match is still not a match', () => {
    expect(validateImportRow(validRow({ roleCode: 'Software_Engineer' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-role', value: 'Software_Engineer' },
    });
  });

  it('rejects a blank role as unknown, naming the empty value', () => {
    expect(validateImportRow(validRow({ roleCode: '  ' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-role', value: '' },
    });
  });

  it('rejects a blank level as unknown', () => {
    expect(validateImportRow(validRow({ levelCode: '' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-level', value: '' },
    });
  });

  it('rejects a blank country as unknown', () => {
    expect(validateImportRow(validRow({ countryCode: '' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-country', value: '' },
    });
  });
});

describe('validateImportRow — the gender cell', () => {
  it('rejects a gender outside the exact vocabulary, naming the value', () => {
    expect(validateImportRow(validRow({ gender: 'F' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-gender', value: 'F' },
    });
  });

  it('rejects a lowercase gender — the values are exactly MALE and FEMALE (Law 3)', () => {
    expect(validateImportRow(validRow({ gender: 'female' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-gender', value: 'female' },
    });
  });

  it('rejects a blank gender', () => {
    expect(validateImportRow(validRow({ gender: '' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-gender', value: '' },
    });
  });
});

describe('validateImportRow — the hire_date cell', () => {
  it('rejects a blank hire date as missing, not as malformed', () => {
    expect(validateImportRow(validRow({ hireDate: '   ' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'missing-date', column: 'hire_date' },
    });
  });

  it('rejects a hire date that is not YYYY-MM-DD, naming the cell and the value', () => {
    expect(validateImportRow(validRow({ hireDate: '01/06/2021' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'malformed-date', column: 'hire_date', value: '01/06/2021' },
    });
  });

  it('rejects a hire date that is shaped right but is not a real day', () => {
    expect(validateImportRow(validRow({ hireDate: '2021-02-30' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'malformed-date', column: 'hire_date', value: '2021-02-30' },
    });
  });
});

describe('validateImportRow — the effective_from cell', () => {
  it('rejects a blank effective date — never defaulted to today or to the hire date (AD-7)', () => {
    expect(validateImportRow(validRow({ effectiveFrom: '' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'missing-date', column: 'effective_from' },
    });
  });

  it('rejects an effective date that is not YYYY-MM-DD', () => {
    expect(validateImportRow(validRow({ effectiveFrom: '2025-4-1' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'malformed-date', column: 'effective_from', value: '2025-4-1' },
    });
  });

  it('rejects a future effective date, naming the date and today (Law 5 / AD-18)', () => {
    expect(validateImportRow(validRow({ effectiveFrom: '2026-07-20' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: {
        kind: 'future-effective-from',
        effectiveFrom: '2026-07-20',
        today: '2026-07-19',
      },
    });
  });

  it('accepts an effective date of exactly today — the bound is inclusive', () => {
    // The boundary that separates `> today` from `>= today`. Without it a mutant that rejects
    // today's own record survives, and appending a record dated today is the ONLY correction
    // mechanism the append-only design offers (Law 5).
    const result = validateImportRow(validRow({ effectiveFrom: '2026-07-19' }), REFS, TODAY);

    expect(result.ok).toBe(true);
  });

  it('rejects an effective date before the hire date, naming both', () => {
    expect(
      validateImportRow(
        validRow({ hireDate: '2021-06-01', effectiveFrom: '2021-05-31' }),
        REFS,
        TODAY,
      ),
    ).toEqual({
      ok: false,
      reason: {
        kind: 'effective-before-hire',
        effectiveFrom: '2021-05-31',
        hireDate: '2021-06-01',
      },
    });
  });

  it('accepts an effective date of exactly the hire date — the bound is inclusive', () => {
    // The DB trigger already treats this boundary as inclusive (see the reference-data integration
    // test); the domain must agree, or a legitimate day-one salary would be rejected in-app.
    const result = validateImportRow(
      validRow({ hireDate: '2021-06-01', effectiveFrom: '2021-06-01' }),
      REFS,
      TODAY,
    );

    expect(result.ok).toBe(true);
  });

  it('reports the future date before the before-hire date when a row is both', () => {
    // Pins the ORDER of the two date judgements, so the reported reason is stable.
    expect(
      validateImportRow(
        validRow({ hireDate: '2027-01-01', effectiveFrom: '2026-12-31' }),
        REFS,
        TODAY,
      ),
    ).toEqual({
      ok: false,
      reason: {
        kind: 'future-effective-from',
        effectiveFrom: '2026-12-31',
        today: '2026-07-19',
      },
    });
  });
});

describe('validateImportRow — the amount_minor cell', () => {
  it('rejects a non-numeric amount, naming the value', () => {
    expect(validateImportRow(validRow({ amountMinor: '23,40,000' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'malformed-amount', value: '23,40,000' },
    });
  });

  it('rejects a symbol-bearing amount — no locale-aware parsing exists (AD-7)', () => {
    expect(validateImportRow(validRow({ amountMinor: '₹2340000' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'malformed-amount', value: '₹2340000' },
    });
  });

  it('rejects a fractional amount — minor units are whole', () => {
    expect(validateImportRow(validRow({ amountMinor: '2340000.5' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'malformed-amount', value: '2340000.5' },
    });
  });

  it('rejects a blank amount', () => {
    expect(validateImportRow(validRow({ amountMinor: '' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'malformed-amount', value: '' },
    });
  });

  it('rejects a hexadecimal amount, which BigInt would otherwise accept', () => {
    expect(validateImportRow(validRow({ amountMinor: '0x10' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'malformed-amount', value: '0x10' },
    });
  });

  it('rejects a zero amount', () => {
    expect(validateImportRow(validRow({ amountMinor: '0' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'amount-not-positive', value: '0' },
    });
  });

  it('rejects a negative amount', () => {
    expect(validateImportRow(validRow({ amountMinor: '-1' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'amount-not-positive', value: '-1' },
    });
  });

  it('accepts an amount of exactly one minor unit — the positive bound is strict', () => {
    const result = validateImportRow(validRow({ amountMinor: '1' }), REFS, TODAY);

    expect(result.ok && result.value.salary.amountMinor).toBe(1n);
  });

  it('accepts an amount of exactly the maximum this system stores', () => {
    // The upper boundary, from BELOW. Story 2-1 review pass 1: an unbounded amount overflowed the
    // PostgreSQL `bigint` column on INSERT, aborted the batch transaction, and destroyed an entire
    // import for one bad row. The domain owns the judgement; the database must never be the first
    // thing to notice.
    const result = validateImportRow(
      validRow({ amountMinor: '9223372036854775807' }),
      REFS,
      TODAY,
    );

    expect(result.ok && result.value.salary.amountMinor).toBe(9223372036854775807n);
  });

  it('rejects an amount one unit past the maximum, naming the value', () => {
    // The same boundary from ABOVE — the row that used to take fifty good rows down with it.
    expect(validateImportRow(validRow({ amountMinor: '9223372036854775808' }), REFS, TODAY)).toEqual(
      {
        ok: false,
        reason: { kind: 'amount-out-of-range', value: '9223372036854775808' },
      },
    );
  });

  it('rejects an absurdly long amount without throwing', () => {
    const value = '9'.repeat(400);

    expect(validateImportRow(validRow({ amountMinor: value }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'amount-out-of-range', value },
    });
  });

  it('states the maximum as the PostgreSQL bigint maximum', () => {
    expect(MAX_AMOUNT_MINOR).toBe(9223372036854775807n);
  });
});

describe('validateImportRow — the currency cell (AD-6)', () => {
  it('rejects a currency that disagrees with the country, naming both codes', () => {
    expect(validateImportRow(validRow({ currency: 'USD' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: {
        kind: 'currency-mismatch',
        value: 'USD',
        expected: 'INR',
        countryCode: 'IN',
      },
    });
  });

  it('rejects a blank currency — there must be something to validate against', () => {
    expect(validateImportRow(validRow({ currency: '' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: {
        kind: 'currency-mismatch',
        value: '',
        expected: 'INR',
        countryCode: 'IN',
      },
    });
  });

  it('rejects a currency that differs from the country currency only in case', () => {
    expect(validateImportRow(validRow({ currency: 'inr' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: {
        kind: 'currency-mismatch',
        value: 'inr',
        expected: 'INR',
        countryCode: 'IN',
      },
    });
  });
});

describe('validateImportRow — totality', () => {
  it('never throws, whatever the cells hold', () => {
    // Law: domain functions are TOTAL. Rejections are data, never exceptions — an import of
    // 10,000 rows must not be able to die on one hostile cell.
    const hostile: ImportRowInput = {
      name: ' ',
      roleCode: ' ',
      levelCode: ' ',
      countryCode: ' ',
      gender: ' ',
      hireDate: ' ',
      amountMinor: ' ',
      currency: ' ',
      effectiveFrom: ' ',
    };

    expect(() => validateImportRow(hostile, REFS, TODAY)).not.toThrow();
    expect(validateImportRow(hostile, REFS, TODAY).ok).toBe(false);
  });

  it('rejects against empty reference data rather than accepting anything', () => {
    const empty: ReferenceData = {
      roleCodes: new Set(),
      levelCodes: new Set(),
      countryCurrencies: new Map(),
    };

    expect(validateImportRow(validRow(), empty, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-role', value: 'software_engineer' },
    });
  });
});

describe('validateImportRow — the order of judgements', () => {
  // The reported reason must be the FIRST thing wrong with the row, deterministically. Each case
  // below spoils two cells and pins which one is named.
  it('names the blank name before the unknown role', () => {
    expect(validateImportRow(validRow({ name: '', roleCode: 'wizard' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'blank-name' },
    });
  });

  it('names the unknown role before the unknown level', () => {
    expect(
      validateImportRow(validRow({ roleCode: 'wizard', levelCode: 'L9' }), REFS, TODAY),
    ).toEqual({ ok: false, reason: { kind: 'unknown-role', value: 'wizard' } });
  });

  it('names the unknown level before the unknown country', () => {
    expect(
      validateImportRow(validRow({ levelCode: 'L9', countryCode: 'XX' }), REFS, TODAY),
    ).toEqual({ ok: false, reason: { kind: 'unknown-level', value: 'L9' } });
  });

  it('names the unknown country before the bad gender', () => {
    expect(validateImportRow(validRow({ countryCode: 'XX', gender: 'X' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-country', value: 'XX' },
    });
  });

  it('names the bad gender before the bad hire date', () => {
    expect(validateImportRow(validRow({ gender: 'X', hireDate: 'nope' }), REFS, TODAY)).toEqual({
      ok: false,
      reason: { kind: 'unknown-gender', value: 'X' },
    });
  });

  it('names the bad hire date before the bad effective date', () => {
    expect(
      validateImportRow(validRow({ hireDate: 'nope', effectiveFrom: 'also-nope' }), REFS, TODAY),
    ).toEqual({
      ok: false,
      reason: { kind: 'malformed-date', column: 'hire_date', value: 'nope' },
    });
  });

  it('names the bad effective date before the bad amount', () => {
    expect(
      validateImportRow(validRow({ effectiveFrom: 'nope', amountMinor: 'x' }), REFS, TODAY),
    ).toEqual({
      ok: false,
      reason: { kind: 'malformed-date', column: 'effective_from', value: 'nope' },
    });
  });

  it('names the bad amount before the currency mismatch', () => {
    expect(validateImportRow(validRow({ amountMinor: 'x', currency: 'USD' }), REFS, TODAY)).toEqual(
      { ok: false, reason: { kind: 'malformed-amount', value: 'x' } },
    );
  });

  it('names the out-of-range amount before the currency mismatch', () => {
    expect(
      validateImportRow(
        validRow({ amountMinor: '9223372036854775808', currency: 'USD' }),
        REFS,
        TODAY,
      ),
    ).toEqual({ ok: false, reason: { kind: 'amount-out-of-range', value: '9223372036854775808' } });
  });
});
