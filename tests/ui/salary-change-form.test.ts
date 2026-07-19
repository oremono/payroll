import { describe, expect, it } from 'vitest';

import type { EmployeeFormOptions } from '@/application/ports/employee-repository';
import type {
  RecordSalaryChangeResult,
  SalaryFieldRejection,
} from '@/application/use-cases/record-salary-change';
import type { CurrencyFormat } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import {
  CURRENCY_UNREADABLE_STATEMENT,
  composeSalaryAnnouncement,
  firstRejectedSalaryField,
  futureHireStatement,
  initialSalaryFormValues,
  SALARY_CHANGE_FORM_FIELD_ORDER,
  SALARY_CHANGE_FORM_FIELDS,
  SALARY_EMPLOYEE_VANISHED_STATEMENT,
  SALARY_SUBMISSION_FAILED_STATEMENT,
  salaryAmountPlaceholder,
  salaryChangeAvailability,
  salaryCurrencyNote,
  salaryFieldDescribedById,
  salaryFieldInputId,
  salaryFormLevelRejections,
  salaryRejectionsFor,
  salaryRejectionText,
  toSalaryChangeInput,
} from '@/ui/salary-change-form';

// Test-first (Law 1 / AD-23): red before `src/ui/salary-change-form.ts` exists.
//
// Same split, and the same reason, as `employee-form.ts`: no jsdom, no @testing-library, and
// `src/ui/*.tsx` sits outside the coverage gate. Every judgement the record-change panel makes lives
// here, so the component is left with markup and focus and nothing to get wrong.
//
// ## What this module is, and is not
//
// It CONSUMES story 4-1's fixed payload and adds nothing to the contract (Law 7 / AD-24).
// `recordSalaryChangeAction` and `SalaryChangeInput` are untouched by this story. Nothing here
// re-validates: the amount is CONVERTED from major units by `parseMajorAmount` in the domain — the
// one place both the coverage and the mutation gate can see it — and everything else the server
// judges is judged by the server.
//
// ## The copy projection, closing deferred #5
//
// `composeRejectionSentence` serves the CSV rejection table too, where "the effective_from cell" is
// the correct identification of a cell. Beside a form field already labelled "Effective date" the
// same string is spreadsheet vocabulary and a raw column token. So this module projects the shapes
// that composer produces into form vocabulary and falls through VERBATIM for everything else — the
// fall-through being the half that keeps a reason kind added later correct by default.

const INR: CurrencyFormat = {
  code: 'INR',
  symbol: '₹',
  minorUnitExponent: 2,
  groupingStyle: 'INDIAN',
};

// The anti-hard-coded-100 currency (Law 4 / AD-4): JPY has no minor unit at all.
const JPY: CurrencyFormat = {
  code: 'JPY',
  symbol: '¥',
  minorUnitExponent: 0,
  groupingStyle: 'WESTERN',
};

const TODAY: PlainDate = { year: 2026, month: 7, day: 20 };
const HIRE_DATE: PlainDate = { year: 2021, month: 6, day: 1 };

const OPTIONS: EmployeeFormOptions = {
  roles: [{ code: 'ENG', name: 'Engineering' }],
  levels: [{ code: 'L1', name: 'Junior', rank: 1 }],
  countries: [
    { code: 'IN', name: 'India', currencyCode: 'INR' },
    { code: 'JP', name: 'Japan', currencyCode: 'JPY' },
    // A country whose currency row is MISSING from the list — a currency deactivated after the
    // employee was created, or one whose grouping style the adapter could not read.
    { code: 'XX', name: 'Nowhere', currencyCode: 'XXX' },
  ],
  currencies: [INR, JPY],
};

function rejection(over: Partial<SalaryFieldRejection> = {}): SalaryFieldRejection {
  return {
    field: 'effective_from',
    offendingValue: null,
    sentence: 'The effective_from cell is blank.',
    ...over,
  };
}

describe('SALARY_CHANGE_FORM_FIELDS', () => {
  it('names the three CAP-3 fields in form order, and no fourth', () => {
    expect(SALARY_CHANGE_FORM_FIELD_ORDER).toEqual([
      'effective_from',
      'amount_minor',
      'currency',
    ]);
  });

  // `effective_from` and `amount_minor` are payload identifiers — column tokens. The LABELS are
  // copy, and neither of them prints a schema detail in front of a reader.
  it('labels each field in words rather than in column tokens', () => {
    expect(SALARY_CHANGE_FORM_FIELDS.effective_from.label).toBe('Effective date');
    expect(SALARY_CHANGE_FORM_FIELDS.amount_minor.label).toBe('Amount');
    expect(SALARY_CHANGE_FORM_FIELDS.currency.label).toBe('Currency');
  });

  it('keeps each spec pointing at its own field key', () => {
    for (const field of SALARY_CHANGE_FORM_FIELD_ORDER) {
      expect(SALARY_CHANGE_FORM_FIELDS[field].field).toBe(field);
    }
  });
});

describe('the DOM ids', () => {
  it('gives a field one control id and one message id, and they differ', () => {
    expect(salaryFieldInputId('amount_minor')).toBe('salary-field-amount_minor');
    expect(salaryFieldDescribedById('amount_minor')).toBe('salary-reason-amount_minor');
  });

  // The CAP-2 panel can be open on the same document only in a different route state, but the ids
  // must not collide by construction either way.
  it('never collides with the employee form’s ids', () => {
    for (const field of SALARY_CHANGE_FORM_FIELD_ORDER) {
      expect(salaryFieldInputId(field)).not.toBe(`employee-field-${field}`);
    }
  });
});

describe('salaryRejectionText — the CAP-3 copy projection (closes deferred #5)', () => {
  it('says a blank date is required, without the word "cell" or the column token', () => {
    expect(salaryRejectionText(rejection())).toBe('Effective date is required.');
  });

  it('projects a malformed date, quoting what was typed', () => {
    expect(
      salaryRejectionText(
        rejection({
          offendingValue: '19-07-2026',
          sentence:
            'The effective_from cell reads "19-07-2026", which is not a date in YYYY-MM-DD form.',
        }),
      ),
    ).toBe('Effective date reads “19-07-2026”, which is not a date in YYYY-MM-DD form.');
  });

  it('projects a malformed date that carries no offending value', () => {
    expect(
      salaryRejectionText(
        rejection({
          sentence: 'The effective_from cell reads "", which is not a date in YYYY-MM-DD form.',
        }),
      ),
    ).toBe('Effective date is not a date in YYYY-MM-DD form.');
  });

  it('projects the no-future-dating rejection, naming both dates (Law 5 / AD-18)', () => {
    expect(
      salaryRejectionText(
        rejection({
          offendingValue: '2026-07-21',
          sentence: 'effective_from 2026-07-21 is later than today, 2026-07-20.',
        }),
      ),
    ).toBe('Effective date 2026-07-21 is later than today, 2026-07-20.');
  });

  it('projects the database’s AP004 hire-date verdict, naming both dates', () => {
    expect(
      salaryRejectionText(
        rejection({
          offendingValue: '2020-01-01',
          sentence: 'effective_from 2020-01-01 is earlier than the hire date, 2021-06-01.',
        }),
      ),
    ).toBe('Effective date 2020-01-01 is earlier than the hire date, 2021-06-01.');
  });

  it('projects the server’s not-greater-than-zero answer as a requirement about the amount', () => {
    expect(
      salaryRejectionText(
        rejection({
          field: 'amount_minor',
          offendingValue: '0',
          sentence: 'amount_minor "0" is not greater than zero.',
        }),
      ),
    ).toBe('Amount must be greater than zero.');
  });

  it('projects the out-of-range answer without naming a minor-unit ceiling', () => {
    expect(
      salaryRejectionText(
        rejection({
          field: 'amount_minor',
          offendingValue: '9223372036854775808',
          sentence:
            'amount_minor "9223372036854775808" is larger than 9223372036854775807, the largest amount this system stores.',
        }),
      ),
    ).toBe('Amount is larger than the largest amount this system stores.');
  });

  it('projects the malformed-amount answer without the column token', () => {
    expect(
      salaryRejectionText(
        rejection({
          field: 'amount_minor',
          offendingValue: '1.5',
          sentence: 'amount_minor "1.5" is not a whole number of minor units.',
        }),
      ),
    ).toBe('Amount “1.5” could not be read as an amount.');
  });

  // The load-bearing half. An unrecognized sentence is rendered AS THE BACKEND WORDED IT, never
  // guessed at — which is what keeps a reason kind a later story adds correct by default.
  it('falls through verbatim for a currency mismatch, which is already form vocabulary', () => {
    const sentence = 'Currency "USD" is not "INR", the currency of country "IN".';

    expect(salaryRejectionText(rejection({ field: 'currency', offendingValue: 'USD', sentence }))).toBe(
      sentence,
    );
  });

  it('falls through verbatim for a sentence no shape recognizes', () => {
    const sentence = 'Some reason kind invented in a later story.';

    expect(salaryRejectionText(rejection({ sentence }))).toBe(sentence);
  });

  it('renders a rejection blaming NO field as its own statement', () => {
    const sentence = 'The salary change could not be saved, so nothing was recorded.';

    expect(salaryRejectionText({ field: null, offendingValue: null, sentence })).toBe(sentence);
  });

  // Anchored on both ends: a sentence that merely CONTAINS a recognized phrasing is not one.
  it('does not mistake a sentence that merely contains a recognized phrasing', () => {
    const sentence = 'Note: The effective_from cell is blank. And something else happened.';

    expect(salaryRejectionText(rejection({ sentence }))).toBe(sentence);
  });
});

describe('grouping reasons', () => {
  const reasons: readonly SalaryFieldRejection[] = [
    rejection({ field: 'effective_from', sentence: 'The effective_from cell is blank.' }),
    rejection({ field: 'amount_minor', sentence: 'amount_minor "0" is not greater than zero.' }),
    { field: null, offendingValue: null, sentence: 'Nothing was recorded.' },
  ];

  it('collects every reason blaming one field, in payload order', () => {
    expect(salaryRejectionsFor(reasons, 'amount_minor')).toEqual([reasons[1]]);
  });

  it('answers an empty list for a field nothing blames', () => {
    expect(salaryRejectionsFor(reasons, 'currency')).toEqual([]);
  });

  it('holds the reasons blaming no field apart, for the form-level region', () => {
    expect(salaryFormLevelRejections(reasons)).toEqual([reasons[2]]);
  });

  // WCAG 2.2 AA SC 3.3.1: the person is taken TO the problem, not merely told there is one. The
  // payload's order is the form's order, so the first entry blaming a field is the topmost on screen.
  it('names the first field to blame, for the focus move', () => {
    expect(firstRejectedSalaryField(reasons)).toBe('effective_from');
  });

  it('names no field when nothing blames one', () => {
    expect(firstRejectedSalaryField([reasons[2] as SalaryFieldRejection])).toBeNull();
  });

  it('names no field for no reasons at all', () => {
    expect(firstRejectedSalaryField([])).toBeNull();
  });

  // ── A currency rejection has no control to sit under ───────────────────────────────────────
  //
  // The form renders a control for `effective_from` and for `amount_minor`. Currency is a
  // STATEMENT, never a control (AD-6) — so a reason blaming `currency` had nowhere to render and
  // nowhere to send focus: the region grouping it excluded it (its field is not `null`), no field
  // block rendered it, and `salaryFieldInputId('currency')` names an element that does not exist.
  //
  // The server CAN answer it: `checkSalaryCurrency` re-resolves the currency from the employee's
  // country inside its own transaction, so reference data changing between the page render and the
  // submit produces exactly this. What the person saw was "1 reason" announced and no reason
  // anywhere, with focus left where it was.
  //
  // So a field with no control is grouped with the form-level reasons — a region with a heading —
  // and the focus move skips it, landing on that region instead.
  const currencyReason = rejection({
    field: 'currency',
    offendingValue: 'USD',
    sentence: 'Currency "USD" is not "INR", the currency of country "IN".',
  });

  it('groups a currency rejection with the form-level reasons, because it has no control', () => {
    expect(salaryFormLevelRejections([currencyReason])).toEqual([currencyReason]);
  });

  it('keeps a field that DOES have a control out of the form-level region', () => {
    expect(salaryFormLevelRejections([reasons[0] as SalaryFieldRejection])).toEqual([]);
    expect(salaryFormLevelRejections([reasons[1] as SalaryFieldRejection])).toEqual([]);
  });

  it('preserves payload order when a currency reason joins a reason blaming no field', () => {
    const both = [currencyReason, reasons[2] as SalaryFieldRejection];

    expect(salaryFormLevelRejections(both)).toEqual(both);
  });

  it('moves focus to no field for a currency rejection — the region takes it instead', () => {
    expect(firstRejectedSalaryField([currencyReason])).toBeNull();
  });

  it('skips past a currency rejection to the first field that has a control', () => {
    expect(firstRejectedSalaryField([currencyReason, reasons[1] as SalaryFieldRejection])).toBe(
      'amount_minor',
    );
  });
});

describe('initialSalaryFormValues', () => {
  // Today comes from the clock port at the delivery boundary and is passed inward (Law 6 / AD-11).
  // Nothing in this module asks what day it is.
  it('opens on today, in the canonical form <input type="date"> reads and writes', () => {
    expect(initialSalaryFormValues(TODAY)).toEqual({ effectiveFrom: '2026-07-20', amount: '' });
  });
});

describe('toSalaryChangeInput — major units in, the fixed 4-1 payload out', () => {
  it('converts a grouped major amount and derives the currency from the format', () => {
    expect(toSalaryChangeInput({ effectiveFrom: '2026-07-20', amount: '21,50,000' }, INR)).toEqual({
      ok: true,
      input: { amountMinor: '215000000', currency: 'INR', effectiveFrom: '2026-07-20' },
    });
  });

  // Closes deferred #7. `checkSalaryAmount` and `checkSalaryCurrency` judge exactly the text they
  // are handed and reject `'  12'` — so the form, which is where a person's stray space comes from,
  // trims before it submits rather than sending something the boundary is specified to refuse.
  it('trims every field before submitting', () => {
    expect(
      toSalaryChangeInput({ effectiveFrom: ' 2026-07-20 ', amount: ' 21,50,000 ' }, INR),
    ).toEqual({
      ok: true,
      input: { amountMinor: '215000000', currency: 'INR', effectiveFrom: '2026-07-20' },
    });
  });

  it('scales a fraction within the currency’s precision', () => {
    expect(toSalaryChangeInput({ effectiveFrom: '2026-07-20', amount: '25000.5' }, INR)).toEqual({
      ok: true,
      input: { amountMinor: '2500050', currency: 'INR', effectiveFrom: '2026-07-20' },
    });
  });

  // The matrix row the server owns: `0` PARSES and is submitted, because positivity is
  // `checkSalaryAmount`'s rule and a second copy of it here would be a second amount validator.
  it('submits zero, leaving positivity to the server', () => {
    expect(toSalaryChangeInput({ effectiveFrom: '2026-07-20', amount: '0' }, INR)).toEqual({
      ok: true,
      input: { amountMinor: '0', currency: 'INR', effectiveFrom: '2026-07-20' },
    });
  });

  it('records a JPY amount with no scaling at all — never a hard-coded 100', () => {
    expect(toSalaryChangeInput({ effectiveFrom: '2026-07-20', amount: '2,500' }, JPY)).toEqual({
      ok: true,
      input: { amountMinor: '2500', currency: 'JPY', effectiveFrom: '2026-07-20' },
    });
  });

  it('refuses an over-precise amount on the amount field, naming the precision allowed', () => {
    const result = toSalaryChangeInput({ effectiveFrom: '2026-07-20', amount: '25000.005' }, INR);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toEqual([
      {
        field: 'amount_minor',
        offendingValue: '25000.005',
        sentence: 'Amount “25000.005” is more precise than INR records, which is 2 decimal places.',
      },
    ]);
  });

  it('refuses any fraction for a zero-exponent currency, saying it has no decimal places', () => {
    const result = toSalaryChangeInput({ effectiveFrom: '2026-07-20', amount: '2500.50' }, JPY);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toEqual([
      {
        field: 'amount_minor',
        offendingValue: '2500.50',
        sentence: 'Amount “2500.50” has decimal places, and JPY is recorded in whole units.',
      },
    ]);
  });

  it('asks for an amount that was left blank rather than quoting nothing back', () => {
    const result = toSalaryChangeInput({ effectiveFrom: '2026-07-20', amount: '   ' }, INR);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toEqual([
      { field: 'amount_minor', offendingValue: null, sentence: 'Amount is required.' },
    ]);
  });

  it.each(['abc', '-1', '1e5', '1.2.3', '.5', '1,,0'])(
    'refuses the malformed amount %s on the amount field, without submitting',
    (amount) => {
      const result = toSalaryChangeInput({ effectiveFrom: '2026-07-20', amount }, INR);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reasons).toEqual([
        {
          field: 'amount_minor',
          offendingValue: amount,
          sentence: `Amount “${amount}” could not be read as an amount.`,
        },
      ]);
    },
  );

  // Unreachable from the page, which withholds the form when the currency is unreadable — and
  // total anyway, because a function that threw here would be an unhandled rejection in a submit
  // handler. It blames NO field: nobody's typing caused a currency row the formatter cannot use.
  it('blames no field when the currency’s own exponent is unusable', () => {
    const result = toSalaryChangeInput(
      { effectiveFrom: '2026-07-20', amount: '2150000' },
      { ...INR, minorUnitExponent: 9 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toEqual([
      {
        field: null,
        offendingValue: null,
        sentence: 'The currency INR could not be read, so nothing was recorded.',
      },
    ]);
  });
});

describe('salaryCurrencyNote — currency is confirmed, never chosen (AD-6)', () => {
  it('states the currency and where it comes from', () => {
    expect(salaryCurrencyNote(INR)).toBe(
      'Currency INR (₹) — it follows from the employee’s country and is never chosen separately.',
    );
  });
});

describe('salaryChangeAvailability — whether the form can be offered at all', () => {
  it('offers the form with the employee’s own currency format', () => {
    expect(salaryChangeAvailability(OPTIONS, 'IN', HIRE_DATE, TODAY)).toEqual({
      kind: 'available',
      currency: INR,
    });
  });

  it('resolves a zero-exponent currency just as readily', () => {
    expect(salaryChangeAvailability(OPTIONS, 'JP', HIRE_DATE, TODAY)).toEqual({
      kind: 'available',
      currency: JPY,
    });
  });

  it('withholds the form when the reference tables could not be read at all', () => {
    expect(salaryChangeAvailability(null, 'IN', HIRE_DATE, TODAY)).toEqual({
      kind: 'withheld',
      statement: CURRENCY_UNREADABLE_STATEMENT,
    });
  });

  // An employee sitting on a DEACTIVATED country has no entry among the active options — the same
  // situation `currencyLineFor` answers `null` for.
  it('withholds the form when the employee’s country is not among the active options', () => {
    expect(salaryChangeAvailability(OPTIONS, 'ZZ', HIRE_DATE, TODAY)).toEqual({
      kind: 'withheld',
      statement: CURRENCY_UNREADABLE_STATEMENT,
    });
  });

  it('withholds the form when the country’s currency has no readable format', () => {
    expect(salaryChangeAvailability(OPTIONS, 'XX', HIRE_DATE, TODAY)).toEqual({
      kind: 'withheld',
      statement: CURRENCY_UNREADABLE_STATEMENT,
    });
  });

  // Closes deferred #3. Every effective date this form could submit is refused for an employee not
  // yet hired — today is future-dated, and anything before the hire date is refused as well — so the
  // form is not offered rather than offered and guaranteed to fail.
  it('withholds the form for an employee whose hire date is later than today', () => {
    expect(
      salaryChangeAvailability(OPTIONS, 'IN', { year: 2026, month: 7, day: 21 }, TODAY),
    ).toEqual({
      kind: 'withheld',
      statement: futureHireStatement({ year: 2026, month: 7, day: 21 }),
    });
  });

  it('offers the form on the hire date itself — a day-one salary is legitimate', () => {
    expect(salaryChangeAvailability(OPTIONS, 'IN', TODAY, TODAY)).toEqual({
      kind: 'available',
      currency: INR,
    });
  });

  // The chain resolved country → currency code → format by PRESENCE alone and never asked whether
  // the exponent was one the formatter and parser can use. A currency row with an unusable exponent
  // therefore produced an OFFERED form whose every submission `parseMajorAmount` answers
  // `'unsupported-exponent'` to — a form that cannot be satisfied, and the exact state
  // `amountParseRejection`'s comment claims "the page withholds the whole form in this state
  // anyway". This makes that comment true.
  it('withholds the form when the currency’s exponent is one the formatter cannot use', () => {
    const options: EmployeeFormOptions = {
      ...OPTIONS,
      currencies: [{ ...INR, minorUnitExponent: 9 }],
    };

    expect(salaryChangeAvailability(options, 'IN', HIRE_DATE, TODAY)).toEqual({
      kind: 'withheld',
      statement: CURRENCY_UNREADABLE_STATEMENT,
    });
  });

  it.each([-1, 5, 2.5, Number.NaN])(
    'withholds the form for the unusable exponent %s',
    (minorUnitExponent) => {
      const options: EmployeeFormOptions = {
        ...OPTIONS,
        currencies: [{ ...INR, minorUnitExponent }],
      };

      expect(salaryChangeAvailability(options, 'IN', HIRE_DATE, TODAY)).toEqual({
        kind: 'withheld',
        statement: CURRENCY_UNREADABLE_STATEMENT,
      });
    },
  );

  // Both ends of the supported range still offer the form — the guard refuses what is unusable, not
  // what is merely unusual.
  it.each([0, 4])('offers the form for the usable exponent %i', (minorUnitExponent) => {
    const currency = { ...INR, minorUnitExponent };
    const options: EmployeeFormOptions = { ...OPTIONS, currencies: [currency] };

    expect(salaryChangeAvailability(options, 'IN', HIRE_DATE, TODAY)).toEqual({
      kind: 'available',
      currency,
    });
  });

  it('names the date pay can be recorded from', () => {
    expect(futureHireStatement({ year: 2026, month: 7, day: 21 })).toBe(
      'This employee’s hire date is 21 Jul 2026, so pay can be recorded from that date onwards.',
    );
  });
});

describe('composeSalaryAnnouncement — one voice, the app-level polite region (AD-20)', () => {
  // Spelled out, NOT the raw ISO string. This sentence is the entire receipt for the save — nothing
  // on the page changes visibly — and it is read aloud by the same live region that speaks every
  // other date on the surface. `2026-07-20` is machine form: a screen reader renders it as digits
  // and separators, and it disagrees with the `formatPlainDate` spelling the detail page and the
  // withheld statements in THIS MODULE already use. One date vocabulary, everywhere.
  it('states a recorded change and the date it takes effect, spelled the way every other date is', () => {
    const result: RecordSalaryChangeResult = { kind: 'recorded', salaryRecordId: 'rec-1' };

    expect(composeSalaryAnnouncement(result, '2026-07-20')).toBe(
      'Salary change recorded, effective 20 Jul 2026.',
    );
  });

  // `formatPlainDate` is total but `parsePlainDate` is not: the argument arrives as a string from a
  // date input. An unparseable one falls back to what was given rather than announcing `null` — the
  // same total-fallback shape `futureHireStatement` uses.
  it('falls back to the string it was given when that string is not a date', () => {
    const result: RecordSalaryChangeResult = { kind: 'recorded', salaryRecordId: 'rec-1' };

    expect(composeSalaryAnnouncement(result, '')).toBe('Salary change recorded, effective .');
    expect(composeSalaryAnnouncement(result, 'not-a-date')).toBe(
      'Salary change recorded, effective not-a-date.',
    );
  });

  // A COUNT rather than the reasons themselves: each one is rendered under its own field and
  // reachable by the focus move. Calm register — no alarm, no celebration.
  it('counts the reasons a rejection carries, with an exact singular', () => {
    const result: RecordSalaryChangeResult = {
      kind: 'rejected',
      reasons: [rejection()],
    };

    expect(composeSalaryAnnouncement(result, '2026-07-20')).toBe(
      'The salary change was not recorded. 1 reason.',
    );
  });

  it('pluralizes two reasons', () => {
    const result: RecordSalaryChangeResult = {
      kind: 'rejected',
      reasons: [rejection(), rejection({ field: 'amount_minor' })],
    };

    expect(composeSalaryAnnouncement(result, '2026-07-20')).toBe(
      'The salary change was not recorded. 2 reasons.',
    );
  });

  // Carries NO id: a non-string id yields `{ kind: 'not-found', employeeId: '' }`, and an empty
  // string where an identifier should be reads as a rendering bug.
  it('states the employee is gone, naming no id', () => {
    const result: RecordSalaryChangeResult = { kind: 'not-found', employeeId: '' };

    expect(composeSalaryAnnouncement(result, '2026-07-20')).toBe(
      SALARY_EMPLOYEE_VANISHED_STATEMENT,
    );
    expect(SALARY_EMPLOYEE_VANISHED_STATEMENT).toBe(
      'This employee no longer exists, so nothing was recorded.',
    );
  });
});

describe('the two statements the UI authors, because no backend reason can exist for them', () => {
  // Pinned VERBATIM by this story's intent contract — the I/O matrix's "Transport failed" row
  // quotes "nothing was recorded" — which is why it still says so despite claiming more than the
  // client can know. A thrown transport error cannot tell "never arrived" from "arrived, COMMITTED,
  // response lost", and `salary_record` is append-only with no idempotency key (Law 5 / AD-18), so
  // a reader who believes this and retries appends a second permanent row. Changing it is a
  // product-copy decision against a frozen contract, not a patch; recorded in `deferred-work.md`.
  it('says nothing was recorded when the submission never reached the server', () => {
    expect(SALARY_SUBMISSION_FAILED_STATEMENT).toBe(
      'The submission did not reach the server, so nothing was recorded. Try again when the connection is back.',
    );
  });

  // It must be TRUE for both causes and claim NEITHER. The seed has an employee (Beatriz Gomez, on
  // country `ZZ`) for whom the reference tables were read perfectly — `options.kind === 'options'`,
  // and the `Edit employee` button renders right beside this paragraph — and the old wording, "The
  // currency reference tables could not be read", contradicted the control next to it. Telling the
  // two causes apart is deferred #6 and deliberately out of scope, so this says only what is
  // common to them.
  it('mirrors the detail page’s existing "cannot be edited right now" arm', () => {
    expect(CURRENCY_UNREADABLE_STATEMENT).toBe(
      'The currency this employee is paid in could not be determined, so a salary change cannot be recorded right now.',
    );
  });

  it('claims neither cause — not an unreadable table, not a deactivated country', () => {
    expect(CURRENCY_UNREADABLE_STATEMENT).not.toContain('reference table');
    expect(CURRENCY_UNREADABLE_STATEMENT).not.toContain('deactivated');
  });
});

// The example amount is DERIVED from the resolved grouping style, not hard-coded. `21,50,000` was
// rendered for every currency, so a USD employee was shown an example reading as 2,150,000 under
// the western convention they actually group by. It goes through the one money formatter rather
// than restating its grouping rules.
describe('salaryAmountPlaceholder', () => {
  it('groups the example the Indian way for an Indian-grouped currency', () => {
    expect(salaryAmountPlaceholder(INR)).toBe('21,50,000');
  });

  it('groups the same example the western way for a western-grouped currency', () => {
    expect(salaryAmountPlaceholder(JPY)).toBe('2,150,000');
  });

  it('shows no symbol and no ISO code — the symbol is an adornment beside the control', () => {
    expect(salaryAmountPlaceholder(INR)).not.toContain('₹');
    expect(salaryAmountPlaceholder(INR)).not.toContain('INR');
  });

  // The example is a MAJOR-unit amount, which is what the control takes. The exponent must not
  // scale it: `21,50,000` at exponent 2 is the same example, not `2,15,00,000`.
  it('states the example in major units whatever the exponent is', () => {
    expect(salaryAmountPlaceholder({ ...INR, minorUnitExponent: 0 })).toBe('21,50,000');
    expect(salaryAmountPlaceholder({ ...INR, minorUnitExponent: 4 })).toBe('21,50,000');
  });
});
