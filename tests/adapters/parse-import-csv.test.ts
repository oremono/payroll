import { describe, expect, it } from 'vitest';

import { parseImportCsv } from '@/adapters/csv/parse-import-csv';
import type { ParsedRecord } from '@/application/ports/import-csv-parser';

// Test-first (Law 1 / AD-23): red before `src/adapters/csv/parse-import-csv.ts` exists.
//
// ## Why this file is HOSTILE rather than representative
//
// The coverage floor and the Stryker mutation gate both stop at `src/domain/**` +
// `src/application/**`. They do not reach `src/adapters/**` at all — so this suite is the ONLY
// thing standing between a parser bug and silent payroll data loss, and story 2-1's review proved
// that is not a theoretical worry. The first implementation entered quoted mode on a `"` at ANY
// position, so a single unbalanced quote swallowed every record that followed: a header, one
// malformed row, and fifty valid rows parsed to ONE record. Fifty employees vanished with no
// rejection, no count, and no signal, and every CI gate stayed green.
//
// So: unbalanced quotes, quotes mid-cell, quote-then-content, embedded newlines and commas,
// CRLF, lone CR, BOM, ragged rows, blank lines, header-only, trailing newlines, NUL bytes, and
// the containment case that is a stated acceptance criterion — one malformed row among fifty
// valid ones still imports fifty.

const HEADER =
  'name,role_code,level_code,country_code,gender,hire_date,amount_minor,currency,effective_from';

const VALID_ROW = 'Ada Lovelace,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01';

/** The nine cells of `VALID_ROW`, as the parser should hand them to the domain validator. */
const VALID_ROW_CELLS = {
  name: 'Ada Lovelace',
  roleCode: 'software_engineer',
  levelCode: 'L3',
  countryCode: 'IN',
  gender: 'FEMALE',
  hireDate: '2021-06-01',
  amountMinor: '234000000',
  currency: 'INR',
  effectiveFrom: '2025-04-01',
};

/** The records of a file that must parse, or an explicit failure naming the refusal. */
function recordsOf(text: string): readonly ParsedRecord[] {
  const outcome = parseImportCsv(text);
  if (outcome.kind !== 'records') {
    throw new Error(`expected records, got refusal: ${JSON.stringify(outcome.reason)}`);
  }
  return outcome.records;
}

describe('parseImportCsv — the happy shape', () => {
  it('maps a well-formed row onto the nine named cells', () => {
    const records = recordsOf(`${HEADER}\n${VALID_ROW}`);

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      rowNumber: 2,
      name: 'Ada Lovelace',
      ok: true,
      row: VALID_ROW_CELLS,
    });
  });

  it('numbers rows by their line in the file, so the header is line 1', () => {
    // The number a reader sees in their spreadsheet, not an index into an array they cannot see.
    const records = recordsOf(`${HEADER}\n${VALID_ROW}\n${VALID_ROW}\n${VALID_ROW}`);

    expect(records.map((record) => record.rowNumber)).toEqual([2, 3, 4]);
  });

  it('matches header columns BY NAME, in any order', () => {
    // Column order is not a contract. A spreadsheet whose columns were rearranged is still the
    // same payroll.
    const shuffled =
      'effective_from,currency,amount_minor,hire_date,gender,country_code,level_code,role_code,name';
    const row = '2025-04-01,INR,234000000,2021-06-01,FEMALE,IN,L3,software_engineer,Ada Lovelace';

    expect(recordsOf(`${shuffled}\n${row}`)[0]).toEqual({
      rowNumber: 2,
      name: 'Ada Lovelace',
      ok: true,
      row: VALID_ROW_CELLS,
    });
  });

  it('matches header columns case-insensitively and ignores surrounding whitespace', () => {
    const header =
      ' Name , ROLE_CODE ,level_code,Country_Code,GENDER,hire_date,Amount_Minor,currency,EFFECTIVE_FROM';

    expect(recordsOf(`${header}\n${VALID_ROW}`)[0]).toEqual(
      expect.objectContaining({ ok: true, row: VALID_ROW_CELLS }),
    );
  });

  it('ignores an extra column rather than refusing the payroll over it', () => {
    // Refusing a whole payroll because the export carried a `department` column would be absurd.
    const header = `department,${HEADER},notes`;
    const row = `Engineering,${VALID_ROW},hired via referral`;

    expect(recordsOf(`${header}\n${row}`)[0]).toEqual(
      expect.objectContaining({ ok: true, row: VALID_ROW_CELLS }),
    );
  });

  it('strips a UTF-8 BOM, which Excel writes on every CSV export', () => {
    expect(recordsOf(`﻿${HEADER}\n${VALID_ROW}`)[0]).toEqual(
      expect.objectContaining({ ok: true, row: VALID_ROW_CELLS }),
    );
  });

  it('reads CRLF line endings', () => {
    const records = recordsOf(`${HEADER}\r\n${VALID_ROW}\r\n${VALID_ROW}\r\n`);

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(expect.objectContaining({ ok: true, row: VALID_ROW_CELLS }));
  });

  it('reads a lone CR line ending', () => {
    const records = recordsOf(`${HEADER}\r${VALID_ROW}\r${VALID_ROW}`);

    expect(records).toHaveLength(2);
    expect(records[1]).toEqual(expect.objectContaining({ ok: true, row: VALID_ROW_CELLS }));
  });

  it('does not invent a record from a trailing newline', () => {
    expect(recordsOf(`${HEADER}\n${VALID_ROW}\n`)).toHaveLength(1);
  });

  it('does not invent a record from a completely empty final line', () => {
    // The one record the reconciliation rule permits to be skipped, and only this one.
    expect(recordsOf(`${HEADER}\n${VALID_ROW}\n\n`)).toHaveLength(1);
  });
});

describe('parseImportCsv — the CSV quoting contract', () => {
  it('reads a comma inside a quoted cell as data, not as a separator', () => {
    const row = `"Lovelace, Ada",software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const record = recordsOf(`${HEADER}\n${row}`)[0];

    expect(record).toEqual(
      expect.objectContaining({
        ok: true,
        row: { ...VALID_ROW_CELLS, name: 'Lovelace, Ada' },
      }),
    );
  });

  it('treats a newline as a record break even inside a quoted cell', () => {
    // The one clause of the spec's quoting contract this parser deliberately does not implement,
    // because it CONTRADICTS the clause the story was re-derived for. Allowing a quoted cell to
    // span lines makes a stray opening quote indistinguishable from a legitimate embedded newline
    // — the stray quote below would close against the quote two rows later and silently merge
    // three rows into one nine-cell record that no cell-count check can catch. Since no column in
    // this file format can hold a newline (a name, four reference codes, two ISO dates, an
    // integer, an ISO-4217 code), the newline is given up and containment becomes STRUCTURAL.
    const row = `"Ada\nLovelace",software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const records = recordsOf(`${HEADER}\n${row}\n${VALID_ROW}`);

    expect(records).toHaveLength(3);
    expect(records[0]).toEqual(
      expect.objectContaining({ ok: false, reason: { kind: 'unterminated-quote' } }),
    );
    // And the damage stops there: the remainder of the split cell is its own ragged row, and the
    // untouched row after it still imports.
    expect(records[2]).toEqual(expect.objectContaining({ ok: true, row: VALID_ROW_CELLS }));
  });

  it('reads a doubled quote inside a quoted cell as one literal quote', () => {
    const row = `"Ada ""Countess"" Lovelace",software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;

    expect(recordsOf(`${HEADER}\n${row}`)[0]).toEqual(
      expect.objectContaining({
        ok: true,
        row: { ...VALID_ROW_CELLS, name: 'Ada "Countess" Lovelace' },
      }),
    );
  });

  it('treats a quote AFTER content in an unquoted cell as an ordinary character', () => {
    // THE RULE THAT CONTAINS THE DAMAGE. A `"` opens quoted mode only at the START of a cell.
    // `Ada "Countess" Lovelace` is a valid name, not a parse event — and because it is not a
    // parse event, it cannot swallow the rest of the file.
    const row = `Ada "Countess" Lovelace,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;

    expect(recordsOf(`${HEADER}\n${row}`)[0]).toEqual(
      expect.objectContaining({
        ok: true,
        row: { ...VALID_ROW_CELLS, name: 'Ada "Countess" Lovelace' },
      }),
    );
  });

  it('keeps a single stray quote mid-cell as data, without opening quoted mode', () => {
    const row = `Ada" Lovelace,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const records = recordsOf(`${HEADER}\n${row}\n${VALID_ROW}`);

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(
      expect.objectContaining({ ok: true, row: { ...VALID_ROW_CELLS, name: 'Ada" Lovelace' } }),
    );
    expect(records[1]).toEqual(expect.objectContaining({ ok: true }));
  });

  it('appends content that follows a closing quote to the same cell', () => {
    const row = `"Ada" Lovelace,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;

    expect(recordsOf(`${HEADER}\n${row}`)[0]).toEqual(
      expect.objectContaining({ ok: true, row: { ...VALID_ROW_CELLS, name: 'Ada Lovelace' } }),
    );
  });

  it('reads an empty quoted cell as an empty cell', () => {
    const row = `"",software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;

    expect(recordsOf(`${HEADER}\n${row}`)[0]).toEqual(
      expect.objectContaining({ ok: true, row: { ...VALID_ROW_CELLS, name: '' } }),
    );
  });

  it('rejects a record whose quoted cell is never closed, and only that record', () => {
    const broken = `"Ada Lovelace,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const records = recordsOf(`${HEADER}\n${broken}\n${VALID_ROW}\n${VALID_ROW}`);

    expect(records).toHaveLength(3);
    expect(records[0]).toEqual({
      rowNumber: 2,
      name: null,
      ok: false,
      reason: { kind: 'unterminated-quote' },
    });
    expect(records[1]).toEqual(expect.objectContaining({ rowNumber: 3, ok: true }));
    expect(records[2]).toEqual(expect.objectContaining({ rowNumber: 4, ok: true }));
  });

  it('contains an unbalanced quote even when a LATER record contains a quote of its own', () => {
    // The subtle half of containment. Scanning naively, the stray quote on the first row finds its
    // "closing" partner three rows later and absorbs everything in between. It must not.
    const broken = `"Ada,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const quoted = `"Grace Hopper",software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const records = recordsOf(`${HEADER}\n${broken}\n${VALID_ROW}\n${quoted}\n${VALID_ROW}`);

    expect(records).toHaveLength(4);
    expect(records[0]).toEqual(expect.objectContaining({ ok: false }));
    expect(records.slice(1).every((record) => record.ok)).toBe(true);
    expect(records[2]).toEqual(
      expect.objectContaining({ ok: true, row: { ...VALID_ROW_CELLS, name: 'Grace Hopper' } }),
    );
  });

  it('ONE malformed row among fifty valid ones still yields fifty valid records', () => {
    // The stated acceptance criterion, and the exact regression that reverted this story.
    const broken = `"Ada Lovelace,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const valid = Array.from({ length: 50 }, () => VALID_ROW);
    const records = recordsOf([HEADER, broken, ...valid].join('\n'));

    expect(records).toHaveLength(51);
    expect(records.filter((record) => record.ok)).toHaveLength(50);
    expect(records.filter((record) => !record.ok)).toHaveLength(1);
  });
});

describe('parseImportCsv — ragged and blank records', () => {
  it('rejects a record with too few cells, naming both counts', () => {
    const short = 'Ada Lovelace,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR';
    const records = recordsOf(`${HEADER}\n${short}\n${VALID_ROW}`);

    expect(records[0]).toEqual({
      rowNumber: 2,
      name: 'Ada Lovelace',
      ok: false,
      reason: { kind: 'wrong-cell-count', expected: 9, actual: 8 },
    });
    expect(records[1]).toEqual(expect.objectContaining({ ok: true }));
  });

  it('rejects a record with too many cells, naming both counts', () => {
    const long = `${VALID_ROW},extra`;

    expect(recordsOf(`${HEADER}\n${long}`)[0]).toEqual({
      rowNumber: 2,
      name: 'Ada Lovelace',
      ok: false,
      reason: { kind: 'wrong-cell-count', expected: 9, actual: 10 },
    });
  });

  it('counts the header width by the header, not by the nine required columns', () => {
    // With an extra column the header is ten wide, so a nine-cell data row is now RAGGED.
    const header = `${HEADER},department`;

    expect(recordsOf(`${header}\n${VALID_ROW}`)[0]).toEqual(
      expect.objectContaining({ reason: { kind: 'wrong-cell-count', expected: 10, actual: 9 } }),
    );
  });

  it('rejects a blank record in the middle of the file rather than dropping it', () => {
    // The reconciliation rule: every record other than a completely empty FINAL line is visible
    // in the report. A record silently skipped is a row the reader is never told about.
    const records = recordsOf(`${HEADER}\n${VALID_ROW}\n\n${VALID_ROW}`);

    expect(records).toHaveLength(3);
    expect(records[1]).toEqual({
      rowNumber: 3,
      name: '',
      ok: false,
      reason: { kind: 'wrong-cell-count', expected: 9, actual: 1 },
    });
    expect(records[2]).toEqual(expect.objectContaining({ rowNumber: 4, ok: true }));
  });

  it('rejects a whitespace-only record rather than dropping it', () => {
    const records = recordsOf(`${HEADER}\n   \n${VALID_ROW}`);

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(expect.objectContaining({ ok: false }));
  });

  it('carries the name as it appeared even on a rejected record', () => {
    const short = 'Grace Hopper,software_engineer,L3';

    expect(recordsOf(`${HEADER}\n${short}`)[0]?.name).toBe('Grace Hopper');
  });

  it('carries a null name when the record is too short to reach the name cell', () => {
    // `name` is required, so it is always SOMEWHERE in the header — but a truncated row may stop
    // before it, and the report must not invent a name it never saw.
    const nameLast =
      'role_code,level_code,country_code,gender,hire_date,amount_minor,currency,effective_from,name';

    expect(recordsOf(`${nameLast}\nsoftware_engineer`)[0]).toEqual({
      rowNumber: 2,
      name: null,
      ok: false,
      reason: { kind: 'wrong-cell-count', expected: 9, actual: 1 },
    });
  });

  it('carries a null name when the record never became cells at all', () => {
    const broken = `"Ada Lovelace,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;

    expect(recordsOf(`${HEADER}\n${broken}`)[0]?.name).toBeNull();
  });

  it('accounts for every data record, so counts can reconcile', () => {
    const broken = `"Ada,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const short = 'Ada Lovelace,software_engineer';
    const lines = [HEADER, VALID_ROW, broken, '', short, VALID_ROW, ''];

    // Six data records: valid, unterminated, blank, short, valid — and one trailing empty line
    // that is the newline artifact and is the ONLY thing allowed to vanish.
    expect(recordsOf(lines.join('\n'))).toHaveLength(5);
  });
});

describe('parseImportCsv — whole-file refusals', () => {
  it('refuses an empty file', () => {
    expect(parseImportCsv('')).toEqual({ kind: 'refusal', reason: { kind: 'empty-file' } });
  });

  it('refuses a whitespace-only file', () => {
    expect(parseImportCsv('   \n\n  ')).toEqual({
      kind: 'refusal',
      reason: { kind: 'empty-file' },
    });
  });

  it('refuses a file that is nothing but a BOM', () => {
    expect(parseImportCsv('﻿')).toEqual({
      kind: 'refusal',
      reason: { kind: 'empty-file' },
    });
  });

  it('refuses a header with no data rows', () => {
    expect(parseImportCsv(HEADER)).toEqual({
      kind: 'refusal',
      reason: { kind: 'no-data-rows' },
    });
  });

  it('refuses a header followed only by a trailing newline', () => {
    expect(parseImportCsv(`${HEADER}\n`)).toEqual({
      kind: 'refusal',
      reason: { kind: 'no-data-rows' },
    });
  });

  it('refuses a header missing required columns, naming them in the canonical order', () => {
    const header = 'name,role_code,level_code,country_code,hire_date,amount_minor,currency';

    expect(parseImportCsv(`${header}\n${VALID_ROW}`)).toEqual({
      kind: 'refusal',
      reason: { kind: 'missing-columns', columns: ['gender', 'effective_from'] },
    });
  });

  it('refuses a header that names a required column twice', () => {
    // Two `name` columns means two candidate values for one field, and choosing one would be a
    // guess (AD-7).
    const header = `${HEADER},name`;

    expect(parseImportCsv(`${header}\n${VALID_ROW},x`)).toEqual({
      kind: 'refusal',
      reason: { kind: 'duplicate-columns', columns: ['name'] },
    });
  });

  it('refuses a header that names a required column twice under different casing', () => {
    const header = `${HEADER},NAME`;

    expect(parseImportCsv(`${header}\n${VALID_ROW},x`)).toEqual({
      kind: 'refusal',
      reason: { kind: 'duplicate-columns', columns: ['name'] },
    });
  });

  it('refuses an unrecognizable header outright, naming every missing column', () => {
    expect(parseImportCsv('this is not a payroll export\nnor is this')).toEqual({
      kind: 'refusal',
      reason: {
        kind: 'missing-columns',
        columns: [
          'name',
          'role_code',
          'level_code',
          'country_code',
          'gender',
          'hire_date',
          'amount_minor',
          'currency',
          'effective_from',
        ],
      },
    });
  });

  it('refuses content carrying a NUL byte as not-CSV', () => {
    expect(parseImportCsv(`${HEADER}\n${VALID_ROW}\u0000`)).toEqual({
      kind: 'refusal',
      reason: { kind: 'not-csv' },
    });
  });

  it('refuses a ZIP/xlsx workbook by its local file header signature', () => {
    // An `.xlsx` IS a ZIP archive; decoded as text it still starts `PK` followed by two control bytes.
    expect(parseImportCsv('PK\u0003\u0004\u0014\u0000\u0006\u0000garbage')).toEqual({
      kind: 'refusal',
      reason: { kind: 'not-csv' },
    });
  });

  it('does not mistake a payroll whose first cell merely begins with PK for a workbook', () => {
    const row = `PKumar,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;

    expect(recordsOf(`${HEADER}\n${row}`)[0]).toEqual(expect.objectContaining({ ok: true }));
  });
});

describe('parseImportCsv — totality and scale', () => {
  it('never throws, on any input it can be handed', () => {
    const hostile = [
      '',
      '"',
      '""',
      '"""',
      ',',
      '\n',
      '\r\n',
      '﻿"',
      HEADER,
      `${HEADER}\n"`,
      `${HEADER}\n",,,,,,,,`,
      `${HEADER}\n${'"'.repeat(1000)}`,
      `${HEADER}\n${','.repeat(1000)}`,
    ];

    for (const text of hostile) {
      expect(() => parseImportCsv(text)).not.toThrow();
    }
  });

  it('parses a ten-thousand-row file without loading behaviour that degrades', () => {
    const text = [HEADER, ...Array.from({ length: 10_000 }, () => VALID_ROW)].join('\n');

    const started = performance.now();
    const records = recordsOf(text);
    const elapsedMs = performance.now() - started;

    expect(records).toHaveLength(10_000);
    expect(records.every((record) => record.ok)).toBe(true);
    // Generous by design — this asserts the parse is not QUADRATIC, not a wall-clock budget.
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
