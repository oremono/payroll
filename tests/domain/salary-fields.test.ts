import { describe, expect, it } from 'vitest';

import type { PlainDate } from '@/domain/plain-date';
import {
  checkSalaryAmount,
  checkSalaryCurrency,
  checkSalaryEffectiveFrom,
  MAX_AMOUNT_MINOR,
} from '@/domain/salary-fields';

// Test-first (Law 1 / AD-23): red before `src/domain/salary-fields.ts` exists.
//
// These three checks were PRIVATE to `validateImportRow` (story 2-1). CAP-3 needs the identical
// judgements for a single-record form, and a second implementation of any of them is how two write
// paths start disagreeing about what a valid salary is — so they are extracted here and BOTH callers
// reach them, exactly as story 3-1 did for the per-field checks in `employee-fields.ts`.
//
// The reason vocabulary is UNCHANGED, verbatim: `RejectionReason` in `import-row.ts` is now this
// union plus the row-level reasons no one field owns. Not one reason literal moved and not one
// sentence changed — CAP-1's import contract is observably identical after the extraction, and its
// suite runs unmodified to prove it.
//
// ## What these functions deliberately do NOT do: trim
//
// `validateImportRow` trims EVERY cell before judging it, because surrounding whitespace in a
// spreadsheet export is noise. That is a property of reading a CSV CELL, not of judging an amount —
// so it stays at the import call site, and these checks judge exactly the text they are handed. A
// Server Action payload is not a spreadsheet export: `'  12'` arriving there is a caller sending
// something other than the canonical decimal string the boundary is specified in, and it is
// rejected rather than quietly repaired.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const HIRE_DATE = date(2021, 6, 1);
const TODAY = date(2026, 7, 19);

describe('checkSalaryEffectiveFrom — the two date rules every salary write path obeys', () => {
  it('accepts a date between the hire date and today', () => {
    expect(checkSalaryEffectiveFrom(date(2023, 4, 1), HIRE_DATE, TODAY)).toEqual({
      ok: true,
      value: date(2023, 4, 1),
    });
  });

  it('accepts a date of exactly TODAY — appending a record dated today is the correction mechanism', () => {
    // Law 5 / AD-18: `salary_record` admits no UPDATE, so a record dated today is how a typo is
    // fixed. An exclusive bound here would take that mechanism away.
    expect(checkSalaryEffectiveFrom(TODAY, HIRE_DATE, TODAY)).toEqual({ ok: true, value: TODAY });
  });

  it('accepts a date of exactly the HIRE DATE — a day-one salary is legitimate', () => {
    expect(checkSalaryEffectiveFrom(HIRE_DATE, HIRE_DATE, TODAY)).toEqual({
      ok: true,
      value: HIRE_DATE,
    });
  });

  it('rejects today + 1 as future-dated, naming both dates', () => {
    // The boundary that matters: one day past today is the smallest future-dating there is.
    expect(checkSalaryEffectiveFrom(date(2026, 7, 20), HIRE_DATE, TODAY)).toEqual({
      ok: false,
      reason: {
        kind: 'future-effective-from',
        effectiveFrom: '2026-07-20',
        today: '2026-07-19',
      },
    });
  });

  it('rejects the day BEFORE the hire date, naming both dates', () => {
    expect(checkSalaryEffectiveFrom(date(2021, 5, 31), HIRE_DATE, TODAY)).toEqual({
      ok: false,
      reason: {
        kind: 'effective-before-hire',
        effectiveFrom: '2021-05-31',
        hireDate: '2021-06-01',
      },
    });
  });

  it('reports FUTURE first when a date is both future-dated and before the hire date', () => {
    // Reachable for an employee with a future hire date (CAP-2 accepts one). The order is
    // contractual, not incidental: the same input must always produce the same reason (Law 6).
    const futureHire = date(2099, 1, 1);

    expect(checkSalaryEffectiveFrom(date(2030, 1, 1), futureHire, TODAY)).toEqual({
      ok: false,
      reason: {
        kind: 'future-effective-from',
        effectiveFrom: '2030-01-01',
        today: '2026-07-19',
      },
    });
  });
});

describe('checkSalaryAmount — integer minor units, strictly positive, inside the column', () => {
  it('parses a canonical decimal string into Money carrying the currency it was given', () => {
    expect(checkSalaryAmount('2500000', 'INR')).toEqual({
      ok: true,
      value: { amountMinor: 2_500_000n, currency: 'INR' },
    });
  });

  it('accepts exactly MAX_AMOUNT_MINOR — the bound is inclusive', () => {
    expect(checkSalaryAmount(MAX_AMOUNT_MINOR.toString(), 'INR')).toEqual({
      ok: true,
      value: { amountMinor: MAX_AMOUNT_MINOR, currency: 'INR' },
    });
  });

  it('rejects one minor unit ABOVE the bound, rather than letting the database notice', () => {
    // The defect this bound exists to close: an oversized amount reached the INSERT, overflowed
    // `bigint`, and aborted a 10,000-row batch with a 500 carrying no report at all.
    const tooBig = (MAX_AMOUNT_MINOR + 1n).toString();

    expect(checkSalaryAmount(tooBig, 'INR')).toEqual({
      ok: false,
      reason: { kind: 'amount-out-of-range', value: tooBig },
    });
  });

  it('rejects zero and negative amounts as not-positive', () => {
    expect(checkSalaryAmount('0', 'INR')).toEqual({
      ok: false,
      reason: { kind: 'amount-not-positive', value: '0' },
    });
    expect(checkSalaryAmount('-1', 'INR')).toEqual({
      ok: false,
      reason: { kind: 'amount-not-positive', value: '-1' },
    });
  });

  it('rejects everything that is not the canonical decimal form of an integer', () => {
    // `BigInt` is dangerously permissive at exactly the inputs a hostile caller produces:
    // `BigInt('')` is 0n, `BigInt(' 1 ')` is 1n, `BigInt('0x10')` is 16n. Accepting any of them
    // turns malformed input into a plausible salary.
    for (const cell of ['1.5', 'abc', '', '  12', '012', '0x10', '1e3', '+1', ' ']) {
      expect(checkSalaryAmount(cell, 'INR')).toEqual({
        ok: false,
        reason: { kind: 'malformed-amount', value: cell },
      });
    }
  });
});

describe('checkSalaryCurrency — the country\'s currency, confirmed rather than chosen (AD-6)', () => {
  it('accepts the currency the country resolves to', () => {
    expect(checkSalaryCurrency('INR', 'INR', 'IN')).toEqual({ ok: true, value: 'INR' });
  });

  it('rejects any other currency, naming what was submitted, what was expected, and the country', () => {
    expect(checkSalaryCurrency('USD', 'INR', 'IN')).toEqual({
      ok: false,
      reason: {
        kind: 'currency-mismatch',
        value: 'USD',
        expected: 'INR',
        countryCode: 'IN',
      },
    });
  });

  it('is exact — a currency differing only in whitespace or case is a DIFFERENT currency', () => {
    // Nothing is normalized and nothing is guessed (AD-7). The import path trims its cell before it
    // gets here; a Server Action payload is not a spreadsheet export and gets no such courtesy.
    expect(checkSalaryCurrency(' INR', 'INR', 'IN').ok).toBe(false);
    expect(checkSalaryCurrency('inr', 'INR', 'IN').ok).toBe(false);
  });
});
