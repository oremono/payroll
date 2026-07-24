import type {
  PayrollCountryTotal,
  PayrollOrgWideTotal,
  PayrollTotals,
} from '@/application/use-cases/payroll-totals';
import {
  formatMoney,
  fromBoundaryMoney,
  type BoundaryMoney,
  type CurrencyFormat,
} from '@/domain/money';
import { plainDateToIso } from '@/domain/plain-date';

/**
 * The CAP-9 payroll-totals CSV serializer — PURE (no `Date`, no random, no I/O), consuming story
 * 10-1's finalized payload UNMODIFIED (Law 7 / AD-24).
 *
 * It RE-DERIVES no statistic (Law 2 / Law 8): `n`, per-country `total`, the org-wide `total`,
 * `ratesUsed`, and `pinnedOn` all arrive computed. The serializer only SELECTS columns, formats money
 * through the ONE formatter, resolves the FX rate that was applied to each country, and quotes fields
 * — deterministic, so the same payload yields byte-identical CSV every time (Law 6).
 *
 * ## Never convert or compare across currencies (Law 3 / AD-13)
 *
 * Per-country totals cross in their OWN currency, never converted. The only converted figure is the
 * org-wide summary total, already converted by the domain. The per-country `FX Rate` column shows the
 * rate the DOMAIN applied to that country (from `ratesUsed`), never a rate this serializer computes;
 * it is blank when the country is already in the reporting currency or when the org-wide total refused.
 *
 * ## Money crosses through the one formatter, failing CLOSED (Law 4 / AD-4)
 *
 * Each money cell is `formatMoney(fromBoundaryMoney(field), format)`, `format` resolved from the
 * reference `currencies` list by the cell's OWN `currency` code — never re-resolved from a country. A
 * missing format, an unsupported exponent, or a non-canonical `amountMinor` leaves the cell BLANK
 * rather than a raw minor string or a bare number.
 *
 * ## Header-only when the payload is absent
 *
 * An `unavailable` read has no totals; the route passes `null` and the file is the header row alone —
 * a calm, well-formed file, never a framework error (the route returns HTTP 200).
 *
 * ## Quoting (RFC 4180) and formula-injection defense
 *
 * A field is quoted iff it contains a comma, a double quote, or a newline; an embedded quote is
 * doubled; rows terminate with CRLF. `guardText` prefixes an apostrophe to a formula-lead free-text
 * cell (`= + - @`, or a TAB/CR) so a spreadsheet opens it as literal text — applied only to the
 * org-authored `countryName` and the composed refusal summary, never to numeric/system cells (`n`,
 * the rate string, dates, money) where a leading `-` is a legitimate value.
 */

/** The columns, in order — country, its currency, headcount, local total, the applied FX provenance. */
const HEADER = [
  'Country',
  'Currency',
  'Headcount',
  'Annual Payroll Total',
  'FX Rate',
  'Rate Pinned On',
  'As Of',
] as const;

/** The label the org-wide summary row carries in the Country column. */
const ORG_WIDE_LABEL = 'Org-wide';

const ROW_TERMINATOR = '\r\n';

/** Lead characters a spreadsheet may interpret as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Neutralize a free-text cell against CSV formula injection — text cells only, never numeric ones. */
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
 * The FX rate the domain applied to a country's currency, plus its pinned date — or two blank cells.
 * Resolved from the org-wide `ratesUsed` by the country's OWN currency; a country already in the
 * reporting currency (or any country on a refusal, which carries no `ratesUsed`) has no applied rate.
 */
function fxCells(
  country: PayrollCountryTotal,
  orgWide: PayrollOrgWideTotal,
): readonly [rate: string, pinnedOn: string] {
  if (orgWide.kind !== 'answer') {
    return ['', ''];
  }
  const receipt = orgWide.ratesUsed.find((candidate) => candidate.fromCurrency === country.currency);
  if (receipt === undefined) {
    return ['', ''];
  }
  return [receipt.rate, plainDateToIso(receipt.pinnedOn)];
}

/** One per-country data row: name, currency, headcount, local total, the applied FX rate + date, as-of. */
function countryRow(
  country: PayrollCountryTotal,
  orgWide: PayrollOrgWideTotal,
  asOfIso: string,
  currencies: readonly CurrencyFormat[],
): string {
  const [rate, ratePinnedOn] = fxCells(country, orgWide);
  return toLine([
    guardText(country.countryName),
    country.currency,
    String(country.n),
    moneyCell(country.total, currencies),
    rate,
    ratePinnedOn,
    asOfIso,
  ]);
}

/**
 * The org-wide summary row: the converted `total` in the reporting currency (with the set's pinned
 * date), or an `Unavailable — …` statement naming the refusal reason (and, for `missing-rate`, the
 * absent pairs, with the set date in the pinned column). Headcount is blank — the org-wide count is
 * not in the payload and is never re-derived (Law 2).
 */
function orgWideRow(
  orgWide: PayrollOrgWideTotal,
  asOfIso: string,
  currencies: readonly CurrencyFormat[],
): string {
  if (orgWide.kind === 'refusal') {
    const pinnedOn = orgWide.pinnedOn === null ? '' : plainDateToIso(orgWide.pinnedOn);
    return toLine([
      ORG_WIDE_LABEL,
      orgWide.reportingCurrency,
      '',
      guardText(refusalSummary(orgWide, asOfIso)),
      '',
      pinnedOn,
      asOfIso,
    ]);
  }

  const pinnedOn = orgWide.pinnedOn === null ? '' : plainDateToIso(orgWide.pinnedOn);
  return toLine([
    ORG_WIDE_LABEL,
    orgWide.reportingCurrency,
    '',
    moneyCell(orgWide.total, currencies),
    '',
    pinnedOn,
    asOfIso,
  ]);
}

/** The Annual-Payroll-Total cell for a refused org-wide total — a readable reason, never the raw enum. */
function refusalSummary(
  refusal: Extract<PayrollOrgWideTotal, { kind: 'refusal' }>,
  asOfIso: string,
): string {
  if (refusal.reason === 'missing-rate') {
    const pairs = refusal.missingPairs
      .map((pair) => `${pair.fromCurrency}→${pair.toCurrency}`)
      .join(', ');
    return `Unavailable — missing rate ${pairs}`;
  }
  return `Unavailable — no rate set as of ${asOfIso}`;
}

/**
 * Serialize the payroll totals as CSV: the header row, then one row per country (in delivered order),
 * then the org-wide summary row. An absent payload (`null` — the `unavailable` arm) is header-only.
 */
export function formatPayrollTotalsCsv(
  totals: PayrollTotals | null,
  currencies: readonly CurrencyFormat[],
): string {
  if (totals === null) {
    return toLine(HEADER);
  }

  const asOfIso = plainDateToIso(totals.asOf);
  const rows = [
    toLine(HEADER),
    ...totals.perCountry.map((country) => countryRow(country, totals.orgWide, asOfIso, currencies)),
    orgWideRow(totals.orgWide, asOfIso, currencies),
  ];

  return rows.join(ROW_TERMINATOR);
}
