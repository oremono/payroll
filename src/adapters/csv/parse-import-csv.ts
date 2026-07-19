/**
 * The hand-rolled CSV parse adapter for CAP-1 bulk import — text in, header-checked records out.
 *
 * No spreadsheet library and no new runtime dependency: the grammar this reads is a small,
 * well-understood subset of RFC 4180, and the failure modes that matter here are CONTAINMENT
 * failures rather than exotic-dialect failures.
 *
 * ## The CSV quoting contract
 *
 * This is where the first implementation of this story lost fifty employees, so the rules are
 * stated rather than implied:
 *
 *  1. A `"` opens quoted mode **only at the start of a cell**. A `"` that appears after content in
 *     an unquoted cell is an ORDINARY CHARACTER and is preserved — `Ada "Countess" Lovelace` is a
 *     valid name, not a parse event. This single rule is what keeps one stray quote from consuming
 *     the rest of the file.
 *  2. Inside quoted mode, `""` is a literal `"`, and a quoted cell may contain commas. Content
 *     following the closing quote joins the same cell, so `"Ada" Lovelace` is one name. A quoted
 *     cell may NOT contain a newline — see `splitRecords` for why that clause of the contract is
 *     deliberately not implemented, and what it buys.
 *  3. If a cell opens quoted mode and the quote is never closed, **only that record** is malformed.
 *     It rejects as one row and can never absorb the records that follow, because a record is one
 *     physical line by construction.
 *  4. Every data record is accounted for (the reconciliation rule on `CsvParseOutcome`). The only
 *     record that may vanish is a completely empty FINAL line, a trailing-newline artifact.
 *
 * ## Where the gates are not
 *
 * The coverage floor and the Stryker mutation gate cover `src/domain/**` and `src/application/**`.
 * They do NOT reach this file. `tests/adapters/parse-import-csv.test.ts` is therefore written
 * adversarially rather than representatively, and is the only gate this module has.
 */

import type { CsvParseOutcome, ParsedRecord } from '@/application/ports/import-csv-parser';
import type {
  FileRefusalReason,
  ImportRowInput,
  RejectionReason,
} from '@/domain/import-row';

/** The nine columns a payroll file must carry, in the order a refusal names them. */
const REQUIRED_COLUMNS = [
  'name',
  'role_code',
  'level_code',
  'country_code',
  'gender',
  'hire_date',
  'amount_minor',
  'currency',
  'effective_from',
] as const;

type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

/** U+FEFF. Excel writes one on every CSV export; it is not part of the first column's name. */
const BYTE_ORDER_MARK = '﻿';

/** A NUL cannot appear in text CSV, and a decoded binary upload is thick with them. */
const NUL = '\u0000';

/** The ZIP local-file-header signature. An `.xlsx` IS a ZIP archive, so it begins with these. */
const ZIP_SIGNATURE = 'PK\u0003\u0004';

const QUOTE = '"';
const COMMA = ',';
const LF = '\n';
const CR = '\r';

/**
 * Parse an uploaded CSV file into header-checked records, or refuse it whole.
 *
 * TOTAL: every string yields an outcome, and nothing throws. An exception here would cross the
 * Route Handler as a 500 carrying no report at all, which is the second defect this story closes.
 */
export function parseImportCsv(text: string): CsvParseOutcome {
  const body = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;

  // The `.xlsx` case the epic names by name: someone attached the workbook rather than saving it
  // as CSV first. The signature test is on the full four bytes, so a payroll whose first cell
  // merely begins `PK` (a name like `PKumar`) is not mistaken for a workbook.
  if (body.includes(NUL) || body.startsWith(ZIP_SIGNATURE)) {
    return { kind: 'refusal', reason: { kind: 'not-csv' } };
  }

  if (body.trim().length === 0) {
    return { kind: 'refusal', reason: { kind: 'empty-file' } };
  }

  const records = splitRecords(body);
  const header = records[0];
  if (header === undefined) {
    // Unreachable — a non-blank body always yields at least one record — but returning a value
    // rather than asserting is what keeps this function total by construction.
    return { kind: 'refusal', reason: { kind: 'empty-file' } };
  }

  const columns = resolveHeader(header.cells);
  if (!columns.ok) {
    return { kind: 'refusal', reason: columns.reason };
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    return { kind: 'refusal', reason: { kind: 'no-data-rows' } };
  }

  // The header defines the row width, not the nine required columns: a file with a tenth
  // `department` column has ten-cell rows, and a nine-cell row in it IS ragged.
  const expectedCellCount = header.cells.length;
  return {
    kind: 'records',
    records: dataRecords.map((record) =>
      toParsedRecord(record, columns.indexByColumn, expectedCellCount),
    ),
  };
}

/** One physical record, with the line it started on and whether its quoting was ever closed. */
type RawRecord = {
  readonly cells: readonly string[];
  readonly lineNumber: number;
  readonly unterminated: boolean;
};

/**
 * Split the whole file into records — ONE RECORD PER PHYSICAL LINE.
 *
 * ## Why a record is a line, and where this knowingly departs from RFC 4180
 *
 * RFC 4180 lets a quoted cell contain newlines, and the spec's quoting contract repeats that. But
 * the SAME contract states an absolute one clause later: an unclosed quote "must never absorb the
 * records that follow", and the parser "must never return fewer records than the file contains
 * without accounting for each one". In the ambiguous case those two clauses contradict each other,
 * and the ambiguity is not resolvable — it is inherent to the grammar:
 *
 *     "Ada,software_engineer,…      <- a stray opening quote
 *     Ada Lovelace,software_engineer,…
 *     "Grace Hopper",software_engineer,…
 *
 * Scanning with newlines allowed, the stray quote on line 1 closes against the quote on line 3 and
 * the three lines become ONE record — which happens to be exactly nine cells wide, so no cell-count
 * check catches it. Two rows are silently merged away. And a LEGITIMATE embedded newline is
 * character-for-character indistinguishable from that: `"Ada\nLovelace",…` produces the same shape.
 * No heuristic separates them, because there is nothing to separate.
 *
 * So the tie is broken on which clause is load-bearing. Containment is the reason this story was
 * re-derived; embedded newlines are inherited RFC boilerplate that THIS file format cannot use —
 * none of the nine columns can hold a newline (a name, four reference codes, two ISO dates, an
 * integer, and an ISO-4217 code). Confining a record to its line makes containment STRUCTURAL
 * rather than heuristic: one row can never affect another, under any input, with no cleverness
 * required. A quote left open at end of line is that row's own rejection and nobody else's.
 *
 * (Surfaced as a deliberate deviation from the spec's Design Note, not a silent one.)
 *
 * The trailing-newline artifact is handled here and only here: a final record that is a single
 * empty cell is dropped, because a file ending in `\n` did not have an extra row typed into it. A
 * blank line ANYWHERE ELSE is a real record and survives into the report as a ragged row — the
 * reconciliation rule is what stops a reader being told about 9,998 of their 10,000 rows.
 */
function splitRecords(text: string): readonly RawRecord[] {
  const records: RawRecord[] = [];
  let index = 0;
  let lineNumber = 1;

  while (index < text.length) {
    const lineEnd = findLineEnd(text, index);
    const scan = scanUntil(text, index, lineEnd);
    records.push({ cells: scan.cells, lineNumber, unterminated: scan.unterminated });
    lineNumber += 1;
    index = skipLineTerminator(text, lineEnd);
  }

  const last = records[records.length - 1];
  if (records.length > 1 && last !== undefined && isEmptyRecord(last)) {
    return records.slice(0, -1);
  }
  return records;
}

function isEmptyRecord(record: RawRecord): boolean {
  return !record.unterminated && record.cells.length === 1 && record.cells[0] === '';
}

type RecordScan = {
  readonly cells: readonly string[];
  readonly unterminated: boolean;
};

/**
 * The quote-aware scanner proper, reading from `start` and never past `limit`.
 *
 * `atCellStart` is the whole quoting contract in one variable: quoted mode opens ONLY while it is
 * true. Once any character has landed in the current cell, a `"` is just a character.
 *
 * Cells accumulate into a `parts` array joined once, rather than by repeated `cell += c`. At
 * 10,000 rows the difference is the difference between linear and quadratic.
 */
function scanUntil(text: string, start: number, limit: number): RecordScan {
  const cells: string[] = [];
  let parts: string[] = [];
  let inQuotes = false;
  let atCellStart = true;
  let index = start;

  while (index < limit) {
    const character = text.charAt(index);

    if (inQuotes) {
      if (character === QUOTE) {
        // A doubled quote is one literal quote; a lone quote closes the quoted cell.
        if (index + 1 < limit && text.charAt(index + 1) === QUOTE) {
          parts.push(QUOTE);
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      parts.push(character);
      index += 1;
      continue;
    }

    if (character === QUOTE && atCellStart) {
      inQuotes = true;
      atCellStart = false;
      index += 1;
      continue;
    }

    if (character === COMMA) {
      cells.push(parts.join(''));
      parts = [];
      atCellStart = true;
      index += 1;
      continue;
    }

    parts.push(character);
    atCellStart = false;
    index += 1;
  }

  cells.push(parts.join(''));
  return { cells, unterminated: inQuotes };
}

/** The index of the first line terminator at or after `start`, or the end of the text. */
function findLineEnd(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character === CR || character === LF) {
      return index;
    }
  }
  return text.length;
}

/** Step past one line terminator — `\r\n`, `\n`, or a lone `\r` — at `index`. */
function skipLineTerminator(text: string, index: number): number {
  if (index >= text.length) {
    return text.length;
  }
  if (text.charAt(index) === CR && text.charAt(index + 1) === LF) {
    return index + 2;
  }
  return index + 1;
}

type HeaderRefusal = Extract<
  FileRefusalReason,
  { kind: 'missing-columns' } | { kind: 'duplicate-columns' }
>;

type HeaderResolution =
  | { readonly ok: true; readonly indexByColumn: ReadonlyMap<RequiredColumn, number> }
  | { readonly ok: false; readonly reason: HeaderRefusal };

/**
 * Locate each required column BY NAME.
 *
 * Case-insensitive, whitespace-trimmed, order-free, and tolerant of extra columns. Refusing a whole
 * payroll because the export carried a `department` column, or because `Name` was capitalised,
 * would be absurd — the file is somebody's real spreadsheet, not a wire format.
 *
 * A column named TWICE is a refusal rather than a first-wins pick: two candidate values for one
 * field, and choosing between them would be the guessing AD-7 forbids.
 */
function resolveHeader(cells: readonly string[]): HeaderResolution {
  const indexByColumn = new Map<RequiredColumn, number>();
  const duplicates: RequiredColumn[] = [];

  cells.forEach((cell, index) => {
    const normalized = cell.trim().toLowerCase();
    const column = REQUIRED_COLUMNS.find((candidate) => candidate === normalized);
    if (column === undefined) {
      return;
    }
    if (indexByColumn.has(column)) {
      if (!duplicates.includes(column)) {
        duplicates.push(column);
      }
      return;
    }
    indexByColumn.set(column, index);
  });

  if (duplicates.length > 0) {
    return { ok: false, reason: { kind: 'duplicate-columns', columns: duplicates } };
  }

  const missing = REQUIRED_COLUMNS.filter((column) => !indexByColumn.has(column));
  if (missing.length > 0) {
    return { ok: false, reason: { kind: 'missing-columns', columns: missing } };
  }

  return { ok: true, indexByColumn };
}

/**
 * Reconcile one raw record against the header.
 *
 * The name cell is carried whether or not the record survives: "which person is this?" is the
 * first question a reader asks of a rejection row, and a report that answers it only for
 * well-formed rows is least useful exactly where it is needed most.
 */
function toParsedRecord(
  record: RawRecord,
  indexByColumn: ReadonlyMap<RequiredColumn, number>,
  expectedCellCount: number,
): ParsedRecord {
  const nameIndex = indexByColumn.get('name');
  const nameCell = nameIndex === undefined ? undefined : record.cells[nameIndex];
  const name = nameCell === undefined ? null : nameCell.trim();

  if (record.unterminated) {
    // An unterminated record never became the cells anybody typed, so there is no honest name to
    // report for it.
    return {
      rowNumber: record.lineNumber,
      name: null,
      ok: false,
      reason: { kind: 'unterminated-quote' },
    };
  }

  if (record.cells.length !== expectedCellCount) {
    const reason: RejectionReason = {
      kind: 'wrong-cell-count',
      expected: expectedCellCount,
      actual: record.cells.length,
    };
    return { rowNumber: record.lineNumber, name, ok: false, reason };
  }

  // Every required index is < expectedCellCount and the widths now match, so each lookup lands.
  // `?? ''` is the `noUncheckedIndexedAccess` tax, not a real fallback.
  const cellFor = (column: RequiredColumn): string =>
    record.cells[indexByColumn.get(column) ?? -1] ?? '';

  const row: ImportRowInput = {
    name: cellFor('name'),
    roleCode: cellFor('role_code'),
    levelCode: cellFor('level_code'),
    countryCode: cellFor('country_code'),
    gender: cellFor('gender'),
    hireDate: cellFor('hire_date'),
    amountMinor: cellFor('amount_minor'),
    currency: cellFor('currency'),
    effectiveFrom: cellFor('effective_from'),
  };

  return { rowNumber: record.lineNumber, name, ok: true, row };
}
