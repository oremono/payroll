import type { OverdueReport, OverdueRow } from '@/application/use-cases/overdue';
import {
  formatMoney,
  fromBoundaryMoney,
  type BoundaryMoney,
  type CurrencyFormat,
} from '@/domain/money';
import type { OverduePeriod } from '@/domain/overdue';
import { plainDateToIso } from '@/domain/plain-date';

/**
 * The CAP-10 overdue-for-review CSV serializer — PURE (no `Date`, no random, no I/O), consuming story
 * 11-1's finalized `OverdueReport` UNMODIFIED (Law 7 / AD-24).
 *
 * It RE-DERIVES no statistic (Law 2 / Law 8): each row's `effectiveFrom` and `salary`, and the
 * `asOf`/`cutoff`/`period` receipts, all arrive computed. The serializer only SELECTS columns,
 * formats money through the ONE formatter, and quotes fields — deterministic, so the same report
 * yields byte-identical CSV every time (Law 6).
 *
 * ## Money crosses through the one formatter, failing CLOSED (Law 4 / AD-4)
 *
 * The salary cell is `formatMoney(fromBoundaryMoney(row.salary), format)`, with `format` resolved
 * from the reference `currencies` list by the row's OWN `currency` code — never converted. If the
 * code is absent, the exponent is unsupported, or the `amountMinor` is not a canonical minor-unit
 * string, the cell is BLANK rather than a raw minor string or a bare number.
 *
 * ## Header-only when the report is absent or empty
 *
 * An `unavailable` read has no report (the route passes `null`); the zero-state has an empty `rows`.
 * Either way the file is the header row alone — a calm, well-formed file, never a framework error
 * (the route returns HTTP 200).
 *
 * ## Quoting (RFC 4180) and formula-injection defense
 *
 * A field is quoted iff it contains a comma, a double quote, or a newline; an embedded quote is
 * doubled; rows terminate with CRLF. `guardText` prefixes an apostrophe to a formula-lead cell
 * (`= + - @`, or a TAB/CR) so a spreadsheet opens it as literal text — applied to the free-text
 * `name` (which originates from the CAP-1 import, arbitrary user text), never to the system cells
 * (dates, money, the period label) where a leading `-` is a legitimate value.
 */

/** The columns, in order — the person, the record that makes them overdue, its salary, provenance. */
const HEADER = ['Employee', 'Effective Date', 'Salary', 'As Of', 'Cutoff', 'Period'] as const;

const ROW_TERMINATOR = '\r\n';

/** Lead characters a spreadsheet may interpret as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Neutralize a free-text cell against CSV formula injection — text cells only, never system ones. */
function guardText(field: string): string {
  return FORMULA_LEAD.test(field) ? `'${field}` : field;
}

/** Wrap a field in quotes only when RFC 4180 requires it; double any embedded quote. */
function quoteField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return `"${field.replaceAll('"', '""')}"`;
  }
  return field;
}

/** One record as a CSV line. */
function toLine(fields: readonly string[]): string {
  return fields.map(quoteField).join(',');
}

/**
 * One money value formatted for a cell, or BLANK (fail closed). The `CurrencyFormat` is resolved by
 * the money's own `currency` code; a missing format, an unsupported exponent, or a non-canonical
 * `amountMinor` all yield an empty cell rather than a raw minor string or a bare amount.
 */
function moneyCell(value: BoundaryMoney, currencies: readonly CurrencyFormat[]): string {
  const format = currencies.find((candidate) => candidate.code === value.currency);
  if (format === undefined) {
    return '';
  }
  const money = fromBoundaryMoney(value);
  if (money === null) {
    return '';
  }
  return formatMoney(money, format) ?? '';
}

/**
 * The Period provenance cell: a bare month count for a preset/months period, or `custom cutoff` for
 * an absolute date (the actual date already rides the Cutoff column). A system cell — no `guardText`,
 * because it never begins with a formula lead.
 */
function periodCell(period: OverduePeriod): string {
  return period.kind === 'date' ? 'custom cutoff' : `${period.months} months`;
}

/** One overdue data row: name (guarded), effective date, salary (fail closed), as-of, cutoff, period. */
function overdueRow(
  row: OverdueRow,
  asOfIso: string,
  cutoffIso: string,
  period: string,
  currencies: readonly CurrencyFormat[],
): string {
  return toLine([
    guardText(row.name),
    plainDateToIso(row.effectiveFrom),
    moneyCell(row.salary, currencies),
    asOfIso,
    cutoffIso,
    period,
  ]);
}

/**
 * Serialize the overdue report as CSV: the header row, then one row per overdue employee in the
 * report's (already-ordered) order. An absent (`null`) or empty report is header-only.
 */
export function formatOverdueCsv(
  report: OverdueReport | null,
  currencies: readonly CurrencyFormat[],
): string {
  if (report === null || report.rows.length === 0) {
    return toLine(HEADER);
  }

  const asOfIso = plainDateToIso(report.asOf);
  const cutoffIso = plainDateToIso(report.cutoff);
  const period = periodCell(report.period);

  const rows = [
    toLine(HEADER),
    ...report.rows.map((row) => overdueRow(row, asOfIso, cutoffIso, period, currencies)),
  ];

  return rows.join(ROW_TERMINATOR);
}
