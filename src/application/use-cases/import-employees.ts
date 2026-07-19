/**
 * The CAP-1 import use-case, and the FINALIZED boundary payload story 2-2 consumes unmodified.
 *
 * Orchestration only: parse, judge each row, append the survivors. Every judgement it makes it
 * borrows from `src/domain/**`, and every effect it has it reaches through a port — so this file
 * is testable against fakes, and the fast suite that covers it touches no database and no clock.
 * `today` arrives as an argument (Law 6 / AD-11); nothing here asks what day it is.
 *
 * ## Transaction shape
 *
 * Rejected rows are filtered out BEFORE any write, then the surviving batch is appended inside one
 * transaction. That satisfies both stated outcomes at once — valid rows land in full, and valid
 * rows are never blocked by bad rows — without per-row commits, and it keeps the 10,000-row case
 * to a bounded number of round-trips rather than 10,000 of them.
 *
 * ## Reconciliation
 *
 * `importedCount + rejectedCount` equals the number of data records in the file. The parser
 * guarantees one record per data record (see `CsvParseOutcome`), and every record here lands in
 * exactly one of the two buckets. A report that under-counts is worse than a refusal, because the
 * epic sells the report as the thing that tells the whole truth.
 */

import type {
  EmployeeRepository,
  NewEmployeeWithSalary,
} from '@/application/ports/employee-repository';
import type { CsvParseOutcome, ParsedRecord } from '@/application/ports/import-csv-parser';
import type { IdGenerator } from '@/application/ports/id';
import {
  composeRefusalStatement,
  composeRejectionSentence,
  rejectionOffendingValue,
} from '@/domain/import-rejection';
import { validateImportRow, type FileRefusalReason } from '@/domain/import-row';
import type { PlainDate } from '@/domain/plain-date';

/**
 * One rejected row, as the report shows it: the row number the reader sees in their spreadsheet,
 * the name as it appeared in the FILE (not as it would have been stored), the single offending
 * cell where there is one, and the reason sentence composed by the one composer.
 */
export type RowRejection = {
  readonly rowNumber: number;
  readonly name: string | null;
  readonly offendingValue: string | null;
  readonly sentence: string;
};

/**
 * The boundary payload (Law 8 / AD-20). Story 2-2 renders this and adds nothing to the contract;
 * Epic 12's seed reads the same shape.
 *
 * An all-rejected file is `kind: 'imported'` with `importedCount: 0` — a REPORT, not a refusal.
 * The reader needs to know which rows failed and why, and a refusal would tell them neither.
 *
 * Note there is no monetary total here, so `toBoundaryMoney` has no call site: nothing in this
 * payload is money. If a future payload adds a total, that encoder is required — an `amountMinor`
 * crosses a JSON boundary as a decimal string, never a number and never a raw `bigint` (AD-4).
 */
export type ImportResult =
  | {
      readonly kind: 'imported';
      readonly importedCount: number;
      readonly rejectedCount: number;
      readonly rejections: readonly RowRejection[];
    }
  | {
      readonly kind: 'refusal';
      readonly reason: FileRefusalReason;
      readonly statement: string;
    };

export type ImportEmployeesDeps = {
  readonly repository: EmployeeRepository;
  readonly idGenerator: IdGenerator;
  /**
   * The parse function, injected. `src/application/**` may import only `src/domain/**` (Law 2), so
   * the CSV adapter cannot be named here — it is handed in by the composition root.
   */
  readonly parseCsv: (text: string) => CsvParseOutcome;
};

/** Build the whole-file refusal payload, statement included. */
export function refuseImport(reason: FileRefusalReason): ImportResult {
  return { kind: 'refusal', reason, statement: composeRefusalStatement(reason) };
}

/** Import the contents of one uploaded CSV, and report exactly what happened to every record. */
export async function importEmployees(
  deps: ImportEmployeesDeps,
  text: string,
  today: PlainDate,
): Promise<ImportResult> {
  const parsed = deps.parseCsv(text);
  if (parsed.kind === 'refusal') {
    // Deliberately before `loadReferenceData`: a file that cannot be read must not cost a
    // database round-trip.
    return refuseImport(parsed.reason);
  }

  const references = await deps.repository.loadReferenceData();

  const batch: NewEmployeeWithSalary[] = [];
  const rejections: RowRejection[] = [];

  // In file order, so rejections come out ordered by row number without a sort.
  for (const record of parsed.records) {
    const outcome = judge(record, references, today, deps.idGenerator);
    if (outcome.ok) {
      batch.push(outcome.value);
    } else {
      rejections.push(outcome.rejection);
    }
  }

  if (batch.length > 0) {
    // Not called at all when nothing is valid — an empty transaction is a round-trip that buys
    // nothing, and "no row is written" should be visibly true rather than incidentally true.
    await deps.repository.createEmployeesWithSalaries(batch, today);
  }

  return {
    kind: 'imported',
    importedCount: batch.length,
    rejectedCount: rejections.length,
    rejections,
  };
}

/**
 * Judge one parsed record. A record the PARSER already rejected (ragged, blank, unclosed quote)
 * and a record the DOMAIN rejects both come out here as the same `RowRejection` shape, spoken in
 * the same vocabulary and composed by the same function — which is what keeps the report reading
 * as one report rather than two stapled together.
 */
function judge(
  record: ParsedRecord,
  references: Parameters<typeof validateImportRow>[1],
  today: PlainDate,
  idGenerator: IdGenerator,
):
  | { readonly ok: true; readonly value: NewEmployeeWithSalary }
  | { readonly ok: false; readonly rejection: RowRejection } {
  if (!record.ok) {
    return {
      ok: false,
      rejection: {
        rowNumber: record.rowNumber,
        name: record.name,
        offendingValue: rejectionOffendingValue(record.reason),
        sentence: composeRejectionSentence(record.reason),
      },
    };
  }

  const validation = validateImportRow(record.row, references, today);
  if (!validation.ok) {
    return {
      ok: false,
      rejection: {
        rowNumber: record.rowNumber,
        name: record.name,
        offendingValue: rejectionOffendingValue(validation.reason),
        sentence: composeRejectionSentence(validation.reason),
      },
    };
  }

  const row = validation.value;
  return {
    ok: true,
    value: {
      // AD-10: ids come from the port, generated in the shell. Two per row — the employee and
      // their opening salary record.
      employeeId: idGenerator.next(),
      salaryRecordId: idGenerator.next(),
      name: row.name,
      roleCode: row.roleCode,
      levelCode: row.levelCode,
      countryCode: row.countryCode,
      gender: row.gender,
      hireDate: row.hireDate,
      salary: row.salary,
      effectiveFrom: row.effectiveFrom,
    },
  };
}
