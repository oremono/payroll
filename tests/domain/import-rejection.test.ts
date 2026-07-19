import { describe, expect, it } from 'vitest';

import {
  composeRefusalStatement,
  composeRejectionSentence,
  rejectionOffendingValue,
} from '@/domain/import-rejection';
import type { FileRefusalReason, RejectionReason } from '@/domain/import-row';

// Test-first (Law 1 / AD-23): red before `src/domain/import-rejection.ts` exists.
//
// Exactly ONE function composes rejection copy and exactly one composes refusal copy — the same
// rule AD-20 states for the verdict sentence, applied here. Story 2-2 renders these strings
// UNMODIFIED, and Epic 12's seed reads the same vocabulary, so the sentences are a contract and
// every one of them is asserted verbatim below.
//
// Register (per DESIGN and the epic context): statements, never celebrations and never alarm. A
// partial import that tells the whole truth is the designed outcome, not a failure — so no
// exclamation, no "error", no "failed to".
//
// The two exhaustiveness tests at the bottom are the real gate: they enumerate every variant of
// both unions, so adding a variant without a sentence turns this file red rather than shipping a
// row whose reason column is blank.

const ALL_REJECTION_REASONS: readonly RejectionReason[] = [
  { kind: 'blank-name' },
  { kind: 'unknown-role', value: 'wizard' },
  { kind: 'unknown-level', value: 'L9' },
  { kind: 'unknown-country', value: 'XX' },
  { kind: 'unknown-gender', value: 'F' },
  { kind: 'missing-date', column: 'hire_date' },
  { kind: 'malformed-date', column: 'effective_from', value: '01/06/2021' },
  { kind: 'future-effective-from', effectiveFrom: '2026-07-20', today: '2026-07-19' },
  { kind: 'effective-before-hire', effectiveFrom: '2021-05-31', hireDate: '2021-06-01' },
  { kind: 'malformed-amount', value: '23,40,000' },
  { kind: 'amount-not-positive', value: '0' },
  { kind: 'amount-out-of-range', value: '9223372036854775808' },
  { kind: 'currency-mismatch', value: 'USD', expected: 'INR', countryCode: 'IN' },
  { kind: 'wrong-cell-count', expected: 9, actual: 8 },
  { kind: 'unterminated-quote' },
];

const ALL_REFUSAL_REASONS: readonly FileRefusalReason[] = [
  { kind: 'not-csv' },
  { kind: 'empty-file' },
  { kind: 'no-data-rows' },
  { kind: 'missing-columns', columns: ['gender', 'name'] },
  { kind: 'duplicate-columns', columns: ['name'] },
  { kind: 'no-file-part' },
  { kind: 'multiple-file-parts', count: 3 },
  { kind: 'too-large', limitMegabytes: 16 },
  { kind: 'unreadable-upload' },
  { kind: 'write-failed' },
];

describe('composeRejectionSentence', () => {
  it('states a blank name', () => {
    expect(composeRejectionSentence({ kind: 'blank-name' })).toBe('The name cell is blank.');
  });

  it('names the offending role and the table it failed against', () => {
    expect(composeRejectionSentence({ kind: 'unknown-role', value: 'wizard' })).toBe(
      'Role code "wizard" is not in the role reference table.',
    );
  });

  it('names the offending level and the table it failed against', () => {
    expect(composeRejectionSentence({ kind: 'unknown-level', value: 'L9' })).toBe(
      'Level code "L9" is not in the level reference table.',
    );
  });

  it('names the offending country and the table it failed against', () => {
    expect(composeRejectionSentence({ kind: 'unknown-country', value: 'XX' })).toBe(
      'Country code "XX" is not in the country reference table.',
    );
  });

  it('names the offending gender and the exact two values allowed', () => {
    expect(composeRejectionSentence({ kind: 'unknown-gender', value: 'F' })).toBe(
      'Gender "F" is neither MALE nor FEMALE.',
    );
  });

  it('names the blank date cell by its column, for hire_date', () => {
    expect(composeRejectionSentence({ kind: 'missing-date', column: 'hire_date' })).toBe(
      'The hire_date cell is blank.',
    );
  });

  it('names the blank date cell by its column, for effective_from', () => {
    // Both columns are asserted so that a mutant hard-coding one column name cannot survive.
    expect(composeRejectionSentence({ kind: 'missing-date', column: 'effective_from' })).toBe(
      'The effective_from cell is blank.',
    );
  });

  it('names the malformed date cell, its column, and the required form', () => {
    expect(
      composeRejectionSentence({
        kind: 'malformed-date',
        column: 'effective_from',
        value: '01/06/2021',
      }),
    ).toBe('The effective_from cell reads "01/06/2021", which is not a date in YYYY-MM-DD form.');
  });

  it('names both the future date and today', () => {
    expect(
      composeRejectionSentence({
        kind: 'future-effective-from',
        effectiveFrom: '2026-07-20',
        today: '2026-07-19',
      }),
    ).toBe('effective_from 2026-07-20 is later than today, 2026-07-19.');
  });

  it('names both the effective date and the hire date', () => {
    expect(
      composeRejectionSentence({
        kind: 'effective-before-hire',
        effectiveFrom: '2021-05-31',
        hireDate: '2021-06-01',
      }),
    ).toBe('effective_from 2021-05-31 is earlier than the hire date, 2021-06-01.');
  });

  it('names a malformed amount', () => {
    expect(composeRejectionSentence({ kind: 'malformed-amount', value: '23,40,000' })).toBe(
      'amount_minor "23,40,000" is not a whole number of minor units.',
    );
  });

  it('names a non-positive amount', () => {
    expect(composeRejectionSentence({ kind: 'amount-not-positive', value: '0' })).toBe(
      'amount_minor "0" is not greater than zero.',
    );
  });

  it('names an out-of-range amount alongside the maximum this system stores', () => {
    expect(
      composeRejectionSentence({ kind: 'amount-out-of-range', value: '9223372036854775808' }),
    ).toBe(
      'amount_minor "9223372036854775808" is larger than 9223372036854775807, the largest amount ' +
        'this system stores.',
    );
  });

  it('names both currencies and the country the expected one came from', () => {
    expect(
      composeRejectionSentence({
        kind: 'currency-mismatch',
        value: 'USD',
        expected: 'INR',
        countryCode: 'IN',
      }),
    ).toBe('Currency "USD" is not "INR", the currency of country "IN".');
  });

  it('names both cell counts when a row is ragged', () => {
    expect(composeRejectionSentence({ kind: 'wrong-cell-count', expected: 9, actual: 8 })).toBe(
      'The row has 8 cells; the header has 9.',
    );
  });

  it('states an unclosed quoted cell without blaming the rest of the file', () => {
    // The sentence a reader sees for the record that used to swallow every record after it.
    expect(composeRejectionSentence({ kind: 'unterminated-quote' })).toBe(
      'The row opens a quoted cell that is never closed.',
    );
  });

  it('composes a sentence for every rejection reason, with no blanks and no duplicates', () => {
    const sentences = ALL_REJECTION_REASONS.map(composeRejectionSentence);

    expect(sentences).toHaveLength(15);
    for (const sentence of sentences) {
      expect(sentence.trim().length).toBeGreaterThan(0);
      expect(sentence.endsWith('.')).toBe(true);
    }
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('never celebrates and never alarms — the register is a statement', () => {
    for (const sentence of ALL_REJECTION_REASONS.map(composeRejectionSentence)) {
      expect(sentence).not.toMatch(/!/);
      expect(sentence.toLowerCase()).not.toMatch(/\b(error|failed|invalid|sorry|oops)\b/);
    }
  });
});

describe('rejectionOffendingValue', () => {
  it('returns the offending cell for a value-bearing reason', () => {
    expect(rejectionOffendingValue({ kind: 'unknown-role', value: 'wizard' })).toBe('wizard');
  });

  it('returns the offending date for a future effective date', () => {
    expect(
      rejectionOffendingValue({
        kind: 'future-effective-from',
        effectiveFrom: '2026-07-20',
        today: '2026-07-19',
      }),
    ).toBe('2026-07-20');
  });

  it('returns the offending date for an effective date before the hire date', () => {
    expect(
      rejectionOffendingValue({
        kind: 'effective-before-hire',
        effectiveFrom: '2021-05-31',
        hireDate: '2021-06-01',
      }),
    ).toBe('2021-05-31');
  });

  it('returns the offending currency, not the expected one', () => {
    expect(
      rejectionOffendingValue({
        kind: 'currency-mismatch',
        value: 'USD',
        expected: 'INR',
        countryCode: 'IN',
      }),
    ).toBe('USD');
  });

  it('returns the actual cell count when a row is ragged', () => {
    expect(rejectionOffendingValue({ kind: 'wrong-cell-count', expected: 9, actual: 8 })).toBe('8');
  });

  it('returns the column name for a blank date cell', () => {
    expect(rejectionOffendingValue({ kind: 'missing-date', column: 'hire_date' })).toBe(
      'hire_date',
    );
  });

  it('returns the malformed date cell value, not its column', () => {
    expect(
      rejectionOffendingValue({
        kind: 'malformed-date',
        column: 'effective_from',
        value: '01/06/2021',
      }),
    ).toBe('01/06/2021');
  });

  it('returns null when there is no single offending cell to point at', () => {
    expect(rejectionOffendingValue({ kind: 'blank-name' })).toBeNull();
    expect(rejectionOffendingValue({ kind: 'unterminated-quote' })).toBeNull();
  });

  it('answers for every rejection reason without throwing', () => {
    const values = ALL_REJECTION_REASONS.map(rejectionOffendingValue);

    expect(values).toHaveLength(15);
    // Only the two reasons that genuinely have no single offending cell may answer null.
    expect(values.filter((value) => value === null)).toHaveLength(2);
  });

  it('returns each remaining reason value verbatim', () => {
    expect(rejectionOffendingValue({ kind: 'unknown-level', value: 'L9' })).toBe('L9');
    expect(rejectionOffendingValue({ kind: 'unknown-country', value: 'XX' })).toBe('XX');
    expect(rejectionOffendingValue({ kind: 'unknown-gender', value: 'F' })).toBe('F');
    expect(rejectionOffendingValue({ kind: 'malformed-amount', value: 'x' })).toBe('x');
    expect(rejectionOffendingValue({ kind: 'amount-not-positive', value: '0' })).toBe('0');
    expect(rejectionOffendingValue({ kind: 'amount-out-of-range', value: '99' })).toBe('99');
  });
});

describe('composeRefusalStatement', () => {
  it('states that the upload could not be read as CSV, and what to do instead', () => {
    expect(composeRefusalStatement({ kind: 'not-csv' })).toBe(
      'The upload could not be read as CSV text. Import reads a CSV file; a spreadsheet workbook ' +
        'has to be saved as CSV first.',
    );
  });

  it('states an empty file', () => {
    expect(composeRefusalStatement({ kind: 'empty-file' })).toBe('The uploaded file is empty.');
  });

  it('states a header with no data rows', () => {
    expect(composeRefusalStatement({ kind: 'no-data-rows' })).toBe(
      'The uploaded file has a header row and no data rows.',
    );
  });

  it('names every missing column', () => {
    expect(
      composeRefusalStatement({ kind: 'missing-columns', columns: ['gender', 'name'] }),
    ).toBe('The header row is missing these columns: gender, name.');
  });

  it('names a single missing column', () => {
    expect(composeRefusalStatement({ kind: 'missing-columns', columns: ['name'] })).toBe(
      'The header row is missing these columns: name.',
    );
  });

  it('names every duplicated column', () => {
    expect(composeRefusalStatement({ kind: 'duplicate-columns', columns: ['name'] })).toBe(
      'The header row names these columns more than once: name.',
    );
  });

  it('states an upload that carried no file', () => {
    expect(composeRefusalStatement({ kind: 'no-file-part' })).toBe(
      'The upload carried no file.',
    );
  });

  it('states how many files arrived when more than one did', () => {
    expect(composeRefusalStatement({ kind: 'multiple-file-parts', count: 3 })).toBe(
      'The upload carried 3 files. Import reads one file at a time.',
    );
  });

  it('names the size limit', () => {
    expect(composeRefusalStatement({ kind: 'too-large', limitMegabytes: 16 })).toBe(
      'The upload is larger than the 16 MB this import reads.',
    );
  });

  it('states a truncated upload distinctly from an absent one', () => {
    expect(composeRefusalStatement({ kind: 'unreadable-upload' })).toBe(
      'The upload did not arrive complete, so it could not be read.',
    );
  });

  it('states that nothing was written when the write itself did not complete', () => {
    expect(composeRefusalStatement({ kind: 'write-failed' })).toBe(
      'The rows could not be written, so nothing was imported.',
    );
  });

  it('composes a statement for every refusal reason, with no blanks and no duplicates', () => {
    const statements = ALL_REFUSAL_REASONS.map(composeRefusalStatement);

    expect(statements).toHaveLength(10);
    for (const statement of statements) {
      expect(statement.trim().length).toBeGreaterThan(0);
      expect(statement.endsWith('.')).toBe(true);
    }
    expect(new Set(statements).size).toBe(statements.length);
  });

  it('never celebrates and never alarms', () => {
    for (const statement of ALL_REFUSAL_REASONS.map(composeRefusalStatement)) {
      expect(statement).not.toMatch(/!/);
      expect(statement.toLowerCase()).not.toMatch(/\b(error|failed|invalid|sorry|oops)\b/);
    }
  });
});

describe('the vocabulary as a whole', () => {
  it('never uses a banned word (Law 3)', () => {
    const all = [
      ...ALL_REJECTION_REASONS.map(composeRejectionSentence),
      ...ALL_REFUSAL_REASONS.map(composeRefusalStatement),
    ].join(' ');

    expect(all.toLowerCase()).not.toMatch(/snapshot|compa-?ratio|payband|pay band/);
  });
});
