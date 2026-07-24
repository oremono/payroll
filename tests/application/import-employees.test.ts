import { describe, expect, it } from 'vitest';

import type {
  EmployeeRepository,
  NewEmployeeWithSalary,
} from '@/application/ports/employee-repository';
import type { CsvParseOutcome } from '@/application/ports/import-csv-parser';
import type { IdGenerator } from '@/application/ports/id';
import { importEmployees } from '@/application/use-cases/import-employees';
import type { ReferenceData } from '@/domain/import-row';
import type { PlainDate } from '@/domain/plain-date';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/import-employees.ts` exists.
//
// Fakes, never mocks of a real database — this suite is DB-free and clock-free by law, and `today`
// arrives as an argument. What is asserted here is the ORCHESTRATION: the counts, the ordering, the
// reconciliation rule, that nothing is written when nothing is valid, and that a whole-file refusal
// passes through untouched.

const TODAY: PlainDate = { year: 2026, month: 7, day: 19 };

const REFS: ReferenceData = {
  roleCodes: new Set(['software_engineer']),
  levelCodes: new Set(['L3']),
  countryCurrencies: new Map([['IN', 'INR']]),
};

const HEADER =
  'name,role_code,level_code,country_code,gender,hire_date,amount_minor,currency,effective_from';

const VALID_ROW = 'Ada Lovelace,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01';

/**
 * The CAP-2 half of the port (story 3-1), which import never touches.
 *
 * They THROW rather than returning a benign value on purpose: if a future edit to the import
 * use-case ever reaches one of these, the test that did so should fail loudly rather than quietly
 * pass against a stub. Import creates employees only through `createEmployeesWithSalaries`.
 */
const NOT_USED_BY_IMPORT = {
  createEmployee: () => Promise.reject(new Error('import does not create single employees')),
  updateEmployee: () => Promise.reject(new Error('import never updates')),
  findEmployeeById: () => Promise.reject(new Error('import never reads by id')),
  listEmployees: () => Promise.reject(new Error('import never lists')),
  loadFormOptions: () => Promise.reject(new Error('import never loads form options')),
  // CAP-3's single-record append (story 4-1). Import writes its opening salary records through the
  // BATCH funnel and never through this one — a rejecting stub is how that stays true rather than
  // being merely asserted in prose.
  appendSalaryRecord: () => Promise.reject(new Error('import never appends one salary record')),
  // CAP-4's salary read (story 5-1). Import never reads a timeline — a rejecting stub keeps that
  // true rather than asserting it in prose.
  findSalaryHistory: () => Promise.reject(new Error('import never reads a salary history')),
  // CAP-5's peer-population read (story 6-1). Import never compares peers — a rejecting stub keeps
  // that true rather than asserting it in prose.
  findPeerPopulation: () => Promise.reject(new Error('import never reads a peer population')),
  // CAP-6's whole-population read (story 7-1). Import never sweeps outliers — a rejecting stub keeps
  // that true rather than asserting it in prose.
  findAllPeerGroups: () => Promise.reject(new Error('import never reads the whole peer population')),
  // CAP-7's gender-gap population read (story 8-1). Import never computes a gender gap — a rejecting
  // stub keeps that true rather than asserting it in prose.
  findGenderGapPopulation: () =>
    Promise.reject(new Error('import never reads a gender-gap population')),
  // CAP-8's org-wide gender-distribution read (story 9-1). Import never computes a distribution — a
  // rejecting stub keeps that true rather than asserting it in prose.
  findGenderDistributionPopulation: () =>
    Promise.reject(new Error('import never reads a gender-distribution population')),
  // CAP-9's org-wide payroll-totals read (story 10-1). Import never computes totals — a rejecting
  // stub keeps that true rather than asserting it in prose.
  findPayrollTotalsPopulation: () =>
    Promise.reject(new Error('import never reads a payroll-totals population')),
  // CAP-10's org-wide overdue read (story 11-1). Import never computes the overdue list — a
  // rejecting stub keeps that true rather than asserting it in prose.
  findOverduePopulation: () =>
    Promise.reject(new Error('import never reads an overdue population')),
} satisfies Pick<
  EmployeeRepository,
  | 'createEmployee'
  | 'updateEmployee'
  | 'findEmployeeById'
  | 'listEmployees'
  | 'loadFormOptions'
  | 'appendSalaryRecord'
  | 'findSalaryHistory'
  | 'findPeerPopulation'
  | 'findAllPeerGroups'
  | 'findGenderGapPopulation'
  | 'findGenderDistributionPopulation'
  | 'findPayrollTotalsPopulation'
  | 'findOverduePopulation'
>;

/** A repository that records what it was asked to write, and can be told to fail. */
function fakeRepository(options: { readonly refs?: ReferenceData } = {}): EmployeeRepository & {
  readonly written: NewEmployeeWithSalary[][];
} {
  const written: NewEmployeeWithSalary[][] = [];
  return {
    ...NOT_USED_BY_IMPORT,
    written,
    loadReferenceData: () => Promise.resolve(options.refs ?? REFS),
    createEmployeesWithSalaries: (batch) => {
      written.push([...batch]);
      return Promise.resolve();
    },
  };
}

/** Deterministic ids, so assertions can name them. No randomness in this suite. */
function fakeIds(): IdGenerator {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `id-${String(n)}`;
    },
  };
}

/** The real parse adapter is an adapter; the use-case takes the parse function as a dependency. */
function parserFor(outcome: CsvParseOutcome): (text: string) => CsvParseOutcome {
  return () => outcome;
}

/** The genuine parse pipeline, imported through the port shape rather than reimplemented here. */
async function importText(
  text: string,
  repository: EmployeeRepository,
  parseCsv?: (input: string) => CsvParseOutcome,
) {
  const { parseImportCsv } = await import('@/adapters/csv/parse-import-csv');
  return importEmployees(
    { repository, idGenerator: fakeIds(), parseCsv: parseCsv ?? parseImportCsv },
    text,
    TODAY,
  );
}

describe('importEmployees — the report', () => {
  it('imports every valid row and reports zero rejections', async () => {
    const repository = fakeRepository();
    const result = await importText(`${HEADER}\n${VALID_ROW}\n${VALID_ROW}`, repository);

    expect(result).toEqual({
      kind: 'imported',
      importedCount: 2,
      rejectedCount: 0,
      rejections: [],
    });
    expect(repository.written).toHaveLength(1);
    expect(repository.written[0]).toHaveLength(2);
  });

  it('imports the valid rows and reports each invalid one with its row number and reason', async () => {
    const unknownRole = 'Grace Hopper,wizard,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01';
    const repository = fakeRepository();

    const result = await importText(`${HEADER}\n${VALID_ROW}\n${unknownRole}`, repository);

    expect(result).toEqual({
      kind: 'imported',
      importedCount: 1,
      rejectedCount: 1,
      rejections: [
        {
          rowNumber: 3,
          name: 'Grace Hopper',
          offendingValue: 'wizard',
          sentence: 'Role code "wizard" is not in the role reference table.',
        },
      ],
    });
  });

  it('orders rejections by row number', async () => {
    const bad = (name: string) =>
      `${name},wizard,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const repository = fakeRepository();

    const result = await importText(
      [HEADER, bad('A'), VALID_ROW, bad('B'), VALID_ROW, bad('C')].join('\n'),
      repository,
    );

    expect(result.kind === 'imported' && result.rejections.map((r) => r.rowNumber)).toEqual([
      2, 4, 6,
    ]);
    expect(result.kind === 'imported' && result.rejections.map((r) => r.name)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('reports an all-invalid file as a REPORT, not a refusal, and writes nothing', async () => {
    // Stated acceptance criterion: an all-rejected file is `kind: 'imported'` with a zero count.
    // A refusal would tell the reader nothing about WHICH rows failed or why.
    const bad = 'X,wizard,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01';
    const repository = fakeRepository();

    const result = await importText(`${HEADER}\n${bad}\n${bad}`, repository);

    expect(result).toEqual(
      expect.objectContaining({ kind: 'imported', importedCount: 0, rejectedCount: 2 }),
    );
    // Not "wrote an empty batch" — did not call the repository at all.
    expect(repository.written).toEqual([]);
  });

  it('passes a whole-file refusal through untouched, and never reaches the repository', async () => {
    const repository = fakeRepository();

    const result = await importText('', repository);

    expect(result).toEqual({
      kind: 'refusal',
      reason: { kind: 'empty-file' },
      statement: 'The uploaded file is empty.',
    });
    expect(repository.written).toEqual([]);
  });

  it('does not even load reference data when the file is refused', async () => {
    // A refused file must not cost a database round-trip.
    let loads = 0;
    const repository: EmployeeRepository = {
      ...NOT_USED_BY_IMPORT,
      loadReferenceData: () => {
        loads += 1;
        return Promise.resolve(REFS);
      },
      createEmployeesWithSalaries: () => Promise.resolve(),
    };

    await importText('', repository);

    expect(loads).toBe(0);
  });
});

describe('importEmployees — the record-count reconciliation rule', () => {
  it('accounts for every data record in the file', async () => {
    // importedCount + rejectedCount MUST equal the number of data records. A report that
    // under-counts is worse than a refusal, because the epic sells the report as the thing that
    // tells the whole truth.
    const broken = `"Ada,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const short = 'Ada Lovelace,software_engineer';
    const badRole = 'Grace Hopper,wizard,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01';
    const repository = fakeRepository();

    const result = await importText(
      [HEADER, VALID_ROW, broken, '', short, badRole, VALID_ROW].join('\n'),
      repository,
    );

    expect(result.kind).toBe('imported');
    if (result.kind !== 'imported') {
      return;
    }
    expect(result.importedCount).toBe(2);
    expect(result.rejectedCount).toBe(4);
    expect(result.importedCount + result.rejectedCount).toBe(6);
    expect(result.rejections).toHaveLength(4);
  });

  it('carries a parse-level rejection into the report with its own sentence', async () => {
    const broken = `"Ada,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const repository = fakeRepository();

    const result = await importText(`${HEADER}\n${broken}`, repository);

    expect(result.kind === 'imported' && result.rejections[0]).toEqual({
      rowNumber: 2,
      name: null,
      offendingValue: null,
      sentence: 'The row opens a quoted cell that is never closed.',
    });
  });

  it('ONE malformed row among fifty valid ones still imports fifty', async () => {
    // The stated acceptance criterion, end to end through the use-case rather than only the
    // parser — this is the regression that reverted the story.
    const broken = `"Ada Lovelace,software_engineer,L3,IN,FEMALE,2021-06-01,234000000,INR,2025-04-01`;
    const rows = Array.from({ length: 50 }, () => VALID_ROW);
    const repository = fakeRepository();

    const result = await importText([HEADER, broken, ...rows].join('\n'), repository);

    expect(result).toEqual(
      expect.objectContaining({ kind: 'imported', importedCount: 50, rejectedCount: 1 }),
    );
    expect(repository.written[0]).toHaveLength(50);
  });

  it('rejects an out-of-range amount and still lands every other row', async () => {
    // The second reverted defect: an amount past the PostgreSQL bigint maximum used to reach the
    // INSERT, overflow, and abort the batch — destroying the whole import for one bad row.
    const oversized =
      'Grace Hopper,software_engineer,L3,IN,FEMALE,2021-06-01,99999999999999999999,INR,2025-04-01';
    const repository = fakeRepository();

    const result = await importText(
      [HEADER, VALID_ROW, oversized, VALID_ROW].join('\n'),
      repository,
    );

    expect(result).toEqual({
      kind: 'imported',
      importedCount: 2,
      rejectedCount: 1,
      rejections: [
        {
          rowNumber: 3,
          name: 'Grace Hopper',
          offendingValue: '99999999999999999999',
          sentence:
            'amount_minor "99999999999999999999" is larger than 9223372036854775807, the ' +
            'largest amount this system stores.',
        },
      ],
    });
    expect(repository.written[0]).toHaveLength(2);
  });
});

describe('importEmployees — what reaches the write funnel', () => {
  it('hands each row a fresh employee id and salary record id from the id port', async () => {
    const repository = fakeRepository();

    await importText(`${HEADER}\n${VALID_ROW}\n${VALID_ROW}`, repository);

    const batch = repository.written[0] ?? [];
    const ids = batch.flatMap((row) => [row.employeeId, row.salaryRecordId]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('hands the funnel parsed values, with the currency derived from the country', async () => {
    const repository = fakeRepository();

    await importText(`${HEADER}\n${VALID_ROW}`, repository);

    expect(repository.written[0]?.[0]).toEqual({
      employeeId: 'id-1',
      salaryRecordId: 'id-2',
      name: 'Ada Lovelace',
      roleCode: 'software_engineer',
      levelCode: 'L3',
      countryCode: 'IN',
      gender: 'FEMALE',
      hireDate: { year: 2021, month: 6, day: 1 },
      salary: { amountMinor: 234000000n, currency: 'INR' },
      effectiveFrom: { year: 2025, month: 4, day: 1 },
    });
  });

  it('passes today through to the funnel, never a clock reading', async () => {
    let seen: PlainDate | undefined;
    const repository: EmployeeRepository = {
      ...NOT_USED_BY_IMPORT,
      loadReferenceData: () => Promise.resolve(REFS),
      createEmployeesWithSalaries: (_batch, today) => {
        seen = today;
        return Promise.resolve();
      },
    };

    await importText(`${HEADER}\n${VALID_ROW}`, repository);

    expect(seen).toEqual(TODAY);
  });

  it('writes the whole batch in ONE call, not one call per row', async () => {
    // The 10,000-row acceptance criterion: bounded round-trips, never one per row.
    const rows = Array.from({ length: 500 }, () => VALID_ROW);
    const repository = fakeRepository();

    await importText([HEADER, ...rows].join('\n'), repository);

    expect(repository.written).toHaveLength(1);
    expect(repository.written[0]).toHaveLength(500);
  });

  it('judges rows against the reference data the repository actually returned', async () => {
    // Not against a hard-coded taxonomy: an inactive or absent role must reject even if the
    // literal string looks plausible.
    const repository = fakeRepository({
      refs: {
        roleCodes: new Set(['data_scientist']),
        levelCodes: new Set(['L3']),
        countryCurrencies: new Map([['IN', 'INR']]),
      },
    });

    const result = await importText(`${HEADER}\n${VALID_ROW}`, repository);

    expect(result).toEqual(
      expect.objectContaining({ kind: 'imported', importedCount: 0, rejectedCount: 1 }),
    );
  });
});

describe('importEmployees — refusal passthrough', () => {
  it('composes the statement for whatever refusal the parser returns', async () => {
    const repository = fakeRepository();

    const result = await importText(
      'ignored',
      repository,
      parserFor({ kind: 'refusal', reason: { kind: 'not-csv' } }),
    );

    expect(result).toEqual({
      kind: 'refusal',
      reason: { kind: 'not-csv' },
      statement:
        'The upload could not be read as CSV text. Import reads a CSV file; a spreadsheet ' +
        'workbook has to be saved as CSV first.',
    });
  });

  it('reports a header-only file as a refusal, not as a zero-row import', async () => {
    const repository = fakeRepository();

    const result = await importText(HEADER, repository);

    expect(result).toEqual(
      expect.objectContaining({ kind: 'refusal', reason: { kind: 'no-data-rows' } }),
    );
  });
});
