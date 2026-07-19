import { describe, expect, it } from 'vitest';

import type { PlainDate } from '@/domain/plain-date';
import { MAX_AMOUNT_MINOR } from '@/domain/salary-fields';
import {
  effectiveBeforeHireRejection,
  nonTextSalaryFieldRejection,
  salaryWriteFailureRejection,
  unknownSalaryCountryRejection,
  validateSalaryChange,
  SALARY_CHANGE_FIELDS,
  type SalaryChangeContext,
  type SalaryChangeInput,
} from '@/domain/salary-change';

// Test-first (Law 1 / AD-23): red before `src/domain/salary-change.ts` exists.
//
// The CAP-3 input validator: three fields — effective date, amount, currency — judged against the
// employee's country currency, their hire date, and today. Nothing else. There is no reason field,
// no event type, and no approval workflow, and there never will be one in this capability.
//
// Two properties this file exists to pin:
//
//   1. ALL failing fields are reported, in FIELD ORDER — the form's order, deterministic and total,
//      never an accident of which check happened to run first (Law 6). Import reports the first
//      fault per row because a batch report names one reason per row; a form reports every problem
//      at once rather than forcing a round-trip per mistake.
//   2. Every sentence comes from the ONE composer (`import-rejection.ts`), so this form and the
//      import report say the same thing the same way (Law 8 / AD-20). Not one of these strings is
//      spelled here.

const date = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

const CONTEXT: SalaryChangeContext = {
  countryCode: 'IN',
  expectedCurrency: 'INR',
  hireDate: date(2021, 6, 1),
  today: date(2026, 7, 19),
};

const VALID: SalaryChangeInput = {
  effectiveFrom: '2026-07-19',
  amountMinor: '2500000',
  currency: 'INR',
};

const input = (overrides: Partial<SalaryChangeInput> = {}): SalaryChangeInput => ({
  ...VALID,
  ...overrides,
});

describe('validateSalaryChange — the three fields, and nothing else', () => {
  it('accepts a raise effective today, yielding Money in the country\'s currency', () => {
    expect(validateSalaryChange(VALID, CONTEXT)).toEqual({
      ok: true,
      value: {
        salary: { amountMinor: 2_500_000n, currency: 'INR' },
        effectiveFrom: date(2026, 7, 19),
      },
    });
  });

  it('accepts a BACKDATED change — after the hire date, before the latest existing record', () => {
    // Backdating within history is legitimate and is not this validator's business to prevent: the
    // resolver orders by (effectiveFrom, seq), so the timeline stays correct either way.
    expect(validateSalaryChange(input({ effectiveFrom: '2023-04-01' }), CONTEXT)).toEqual({
      ok: true,
      value: {
        salary: { amountMinor: 2_500_000n, currency: 'INR' },
        effectiveFrom: date(2023, 4, 1),
      },
    });
  });

  it('names the three fields the boundary coerces against, in the form\'s order', () => {
    // The mapping lives in the domain rather than being re-typed at a boundary that could drift
    // from it — the same arrangement `EMPLOYEE_CREATE_FIELDS` has.
    expect(SALARY_CHANGE_FIELDS).toEqual([
      ['effectiveFrom', 'effective_from'],
      ['amountMinor', 'amount_minor'],
      ['currency', 'currency'],
    ]);
  });
});

describe('the effective date', () => {
  it('rejects a FUTURE date, naming the effective-date field', () => {
    // Law 5 / AD-18: no future-dating on any write path. There is no scheduled or pending change.
    expect(validateSalaryChange(input({ effectiveFrom: '2026-07-20' }), CONTEXT)).toEqual({
      ok: false,
      reasons: [
        {
          field: 'effective_from',
          offendingValue: '2026-07-20',
          sentence: 'effective_from 2026-07-20 is later than today, 2026-07-19.',
        },
      ],
    });
  });

  it('rejects a date BEFORE the hire date', () => {
    expect(validateSalaryChange(input({ effectiveFrom: '2021-05-31' }), CONTEXT)).toEqual({
      ok: false,
      reasons: [
        {
          field: 'effective_from',
          offendingValue: '2021-05-31',
          sentence: 'effective_from 2021-05-31 is earlier than the hire date, 2021-06-01.',
        },
      ],
    });
  });

  it('rejects a BLANK date with no offending value — the blankness IS the value', () => {
    // Import answers `'effective_from'` here, because in a rejection table whose columns are
    // "value" and "reason" the column name is the only thing identifying which cell was empty.
    // Beside a form field already labelled "Effective date" the same string reads as though the
    // user typed the words — so a form answers null, exactly as CAP-2 does for a blank hire date.
    expect(validateSalaryChange(input({ effectiveFrom: '   ' }), CONTEXT)).toEqual({
      ok: false,
      reasons: [
        {
          field: 'effective_from',
          offendingValue: null,
          sentence: 'The effective_from cell is blank.',
        },
      ],
    });
  });

  it('rejects a MALFORMED date, quoting what was submitted', () => {
    expect(validateSalaryChange(input({ effectiveFrom: '01/06/2021' }), CONTEXT)).toEqual({
      ok: false,
      reasons: [
        {
          field: 'effective_from',
          offendingValue: '01/06/2021',
          sentence:
            'The effective_from cell reads "01/06/2021", which is not a date in YYYY-MM-DD form.',
        },
      ],
    });
  });

  it('accepts exactly today and exactly the hire date — both bounds are inclusive', () => {
    expect(validateSalaryChange(input({ effectiveFrom: '2026-07-19' }), CONTEXT).ok).toBe(true);
    expect(validateSalaryChange(input({ effectiveFrom: '2021-06-01' }), CONTEXT).ok).toBe(true);
  });
});

describe('the amount — one reason per case, from the shared checks', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['0', 'amount_minor "0" is not greater than zero.'],
    ['-1', 'amount_minor "-1" is not greater than zero.'],
    ['1.5', 'amount_minor "1.5" is not a whole number of minor units.'],
    ['abc', 'amount_minor "abc" is not a whole number of minor units.'],
    ['  12', 'amount_minor "  12" is not a whole number of minor units.'],
    ['', 'amount_minor "" is not a whole number of minor units.'],
    [
      (MAX_AMOUNT_MINOR + 1n).toString(),
      `amount_minor "${(MAX_AMOUNT_MINOR + 1n).toString()}" is larger than ` +
        `${MAX_AMOUNT_MINOR.toString()}, the largest amount this system stores.`,
    ],
  ];

  for (const [amountMinor, sentence] of cases) {
    it(`rejects ${JSON.stringify(amountMinor)}, naming the amount field`, () => {
      expect(validateSalaryChange(input({ amountMinor }), CONTEXT)).toEqual({
        ok: false,
        reasons: [{ field: 'amount_minor', offendingValue: amountMinor, sentence }],
      });
    });
  }

  it('accepts exactly MAX_AMOUNT_MINOR', () => {
    const result = validateSalaryChange(
      input({ amountMinor: MAX_AMOUNT_MINOR.toString() }),
      CONTEXT,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        salary: { amountMinor: MAX_AMOUNT_MINOR, currency: 'INR' },
        effectiveFrom: date(2026, 7, 19),
      },
    });
  });
});

describe('the currency — confirmed from the country, never chosen (AD-6)', () => {
  it('rejects a currency that is not the country\'s', () => {
    expect(validateSalaryChange(input({ currency: 'USD' }), CONTEXT)).toEqual({
      ok: false,
      reasons: [
        {
          field: 'currency',
          offendingValue: 'USD',
          sentence: 'Currency "USD" is not "INR", the currency of country "IN".',
        },
      ],
    });
  });
});

describe('collection — EVERY failing field, in the form\'s order', () => {
  it('reports all three when all three are wrong, effective date first', () => {
    const result = validateSalaryChange(
      { effectiveFrom: '2026-07-20', amountMinor: '0', currency: 'USD' },
      CONTEXT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The ORDER is the contract, not the set: a form that reordered its problems between
    // submissions would be non-deterministic in exactly the way Law 6 forbids.
    expect(result.reasons.map((reason) => reason.field)).toEqual([
      'effective_from',
      'amount_minor',
      'currency',
    ]);
  });

  it('reports the amount and the currency together, leaving a good date alone', () => {
    const result = validateSalaryChange(input({ amountMinor: 'abc', currency: 'USD' }), CONTEXT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.map((reason) => reason.field)).toEqual(['amount_minor', 'currency']);
  });

  it('does not judge the amount against the SUBMITTED currency', () => {
    // AD-6: the money is denominated in the COUNTRY's currency. A wrong currency cell rejects the
    // currency field and nothing else — it must not make a perfectly good amount look malformed.
    const result = validateSalaryChange(input({ currency: 'USD' }), CONTEXT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toHaveLength(1);
  });
});

describe('the rejections composed for outcomes this validator cannot judge', () => {
  it('effectiveBeforeHireRejection carries the DATABASE\'s AP004 verdict as data', () => {
    // The `BEFORE INSERT` trigger is the backstop for a hire date this layer read before the write
    // and that changed underneath it. Its verdict must reach the user as a payload, in the same
    // sentence the domain would have used had it caught the case itself.
    expect(effectiveBeforeHireRejection(date(2021, 5, 31), date(2021, 6, 1))).toEqual({
      field: 'effective_from',
      offendingValue: '2021-05-31',
      sentence: 'effective_from 2021-05-31 is earlier than the hire date, 2021-06-01.',
    });
  });

  it('unknownSalaryCountryRejection blames no field — the user did not choose the country', () => {
    // Country is set at create and immutable (AD-6). If it no longer resolves to a currency, no
    // input of this form caused it, so the form states it rather than pinning it on an innocent
    // field.
    expect(unknownSalaryCountryRejection('ZZ')).toEqual({
      field: null,
      offendingValue: 'ZZ',
      sentence: 'Country code "ZZ" is not in the country reference table.',
    });
  });

  it('salaryWriteFailureRejection blames no field either, and says nothing was changed', () => {
    expect(salaryWriteFailureRejection()).toEqual({
      field: null,
      offendingValue: null,
      sentence: 'The salary change could not be saved, so nothing was recorded.',
    });
  });

  it('nonTextSalaryFieldRejection names the field in words a reader recognises', () => {
    // A `'use server'` export is a live RPC endpoint and these `string` types are ERASED at
    // runtime. A caller sending `5` for the amount gets an ordinary field rejection, never a
    // TypeError swallowed into a generic write failure. There is no offending VALUE, because
    // printing `[object Object]` back at a reader tells them less than the field name already does.
    expect(nonTextSalaryFieldRejection('effective_from')).toEqual({
      field: 'effective_from',
      offendingValue: null,
      sentence: 'The effective date field was not submitted as text.',
    });
    expect(nonTextSalaryFieldRejection('amount_minor')).toEqual({
      field: 'amount_minor',
      offendingValue: null,
      sentence: 'The amount field was not submitted as text.',
    });
    expect(nonTextSalaryFieldRejection('currency')).toEqual({
      field: 'currency',
      offendingValue: null,
      sentence: 'The currency field was not submitted as text.',
    });
  });
});
