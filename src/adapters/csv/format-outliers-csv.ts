import type { OutlierFindingGroup, OutlierReport } from '@/application/use-cases/outliers';
import {
  formatMoney,
  fromBoundaryMoney,
  type BoundaryMoney,
  type CurrencyFormat,
} from '@/domain/money';
import { plainDateToIso } from '@/domain/plain-date';

/**
 * The CAP-6 findings CSV serializer — PURE (no `Date`, no random, no I/O), consuming story 7-1's
 * finalized `OutlierReport` UNMODIFIED (Law 7 / AD-24).
 *
 * It RE-DERIVES no statistic (Law 2 / Law 8): `distancePct`, `n`, `peerMedian`, salary, the labels,
 * `asOf`, and `thresholdPct` all arrive computed. The serializer only SELECTS columns, formats money
 * through the ONE formatter, and quotes fields — deterministic, so the same report yields byte-
 * identical CSV every time (Law 6).
 *
 * ## Money crosses through the one formatter, failing CLOSED (Law 4 / AD-4)
 *
 * Each money cell is `formatMoney(fromBoundaryMoney(field), format)`, with `format` resolved from the
 * reference `currencies` list by the row's OWN `currency` code — never re-resolved from a country,
 * never converted. If the code is absent from the list, the exponent is unsupported, or the
 * `amountMinor` is not a canonical minor-unit string, the cell is BLANK rather than a raw minor
 * string or a bare number. `BoundaryMoney.amountMinor` is a decimal-MINOR string, so the exponent
 * from `CurrencyFormat` is required to place the decimal point — which is why the CSV needs the
 * currencies list and the money-free Home VM does not.
 *
 * ## Quoting is an explicit decision (RFC 4180)
 *
 * A field is wrapped in double quotes iff it contains a comma, a double quote, or a newline
 * (CR or LF); an embedded double quote is doubled. Rows are terminated with CRLF (`\r\n`), the RFC
 * line ending — the widest-compatible choice for the spreadsheet tools this export feeds.
 *
 * ## Formula-injection is neutralized on the free-text cells (defense in depth)
 *
 * `employeeName` originates from the CAP-1 import — arbitrary user text — and the reference labels are
 * org-authored; any could begin with a spreadsheet formula lead (`= + - @`, or a TAB/CR that shifts
 * the lead). Excel/Sheets execute such a cell on open. `guardText` prefixes an apostrophe so the cell
 * opens as literal text, applied ONLY to the free-text columns (employee, role, level, country) —
 * never to the numeric/system cells (`distancePct` like `-25.2`, money, `n`, dates), where a `-` is a
 * legitimate value and Excel already treats a valid number as a number, not a formula.
 */

/** The columns, in order — currency, salary, peer median, distance, `n`, as-of, threshold provenance. */
const HEADER = [
  'Status',
  'Employee',
  'Role',
  'Level',
  'Country',
  'Peers',
  'Currency',
  'Salary',
  'Peer median',
  'Distance %',
  'As of',
  'Threshold %',
  'Reason',
] as const;

const ROW_TERMINATOR = '\r\n';

/** Lead characters a spreadsheet may interpret as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Neutralize a free-text cell against CSV formula injection: an apostrophe prefix makes a
 * formula-lead cell open as literal text. Applied to user/reference text only — never to numeric or
 * system cells, where a leading `-` is a real value.
 */
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

/** Every data row for one group — one per flagged member, or a single refusal row for a thin group. */
function groupRows(
  group: OutlierFindingGroup,
  asOfIso: string,
  thresholdPct: string,
  currencies: readonly CurrencyFormat[],
): readonly string[] {
  const { peerGroup } = group;

  if (group.kind === 'refusal') {
    // A thin group: the group is named, its count carried, the money columns blank (no median was
    // computed), the reason stated. A refusal is data, not an error. The Reason cell carries the
    // SAME human clause the on-screen refusal row shows — never the raw `thin-peer-group` enum, so
    // the export reads like the product rather than leaking an internal token.
    return [
      toLine([
        'refusal',
        '',
        guardText(peerGroup.roleName),
        guardText(peerGroup.levelLabel),
        guardText(peerGroup.countryName),
        String(group.counts.n),
        '',
        '',
        '',
        '',
        asOfIso,
        thresholdPct,
        `Only ${group.counts.n} peers — too few to compare fairly`,
      ]),
    ];
  }

  const peerMedianCell = moneyCell(group.peerMedian, currencies);
  return group.findings.map((finding) =>
    toLine([
      'outlier',
      guardText(finding.employeeName),
      guardText(peerGroup.roleName),
      guardText(peerGroup.levelLabel),
      guardText(peerGroup.countryName),
      String(group.n),
      group.currency,
      moneyCell(finding.salary, currencies),
      peerMedianCell,
      finding.distancePct,
      asOfIso,
      thresholdPct,
      '',
    ]),
  );
}

/**
 * Serialize the outlier report as CSV: the header row, then one row per outlier finding and one row
 * per thin group, in the report's (already-ordered) group order. Header-only when there are no
 * groups. The as-of and threshold provenance ride every data row.
 */
export function formatOutliersCsv(
  report: OutlierReport,
  currencies: readonly CurrencyFormat[],
): string {
  const asOfIso = plainDateToIso(report.asOf);
  const thresholdPct = String(report.thresholdPct);

  const rows = [
    toLine(HEADER),
    ...report.groups.flatMap((group) => groupRows(group, asOfIso, thresholdPct, currencies)),
  ];

  return rows.join(ROW_TERMINATOR);
}
