import type {
  GetPayrollTotalsResult,
  PayrollCountryTotal,
  PayrollOrgWideTotal,
  PayrollTotals,
} from '@/application/use-cases/payroll-totals';
import { formatMoney, fromBoundaryMoney, type CurrencyFormat } from '@/domain/money';
import { formatPlainDate, plainDateToIso, type PlainDate } from '@/domain/plain-date';

/**
 * Everything the CAP-9 payroll-totals surface DECIDES, with no React in it.
 *
 * The same split, and the same reason, as `peer-comparison-vm.ts`: no jsdom, no @testing-library,
 * and `src/ui/*.tsx` sits outside the coverage gate. Every judgement — selecting the arm, formatting
 * each per-country total through the ONE money formatter (failing CLOSED to `null`), composing the
 * org-wide answer headline + provenance caption + `ratesUsed` disclosure OR the org-wide refusal
 * heading/statement, and selecting the top-5 pulse rows — lives here and is unit-tested, so
 * `payroll-totals.tsx` is left with markup and nothing to get wrong. ONE builder feeds BOTH surfaces
 * (the screen and the Home tile+pulse), so they cannot drift.
 *
 * ## It consumes story 10-1's finalized payload UNMODIFIED (Law 7 / AD-24)
 *
 * `GetPayrollTotalsResult` is used exactly as 10-1 finalized it. The builder RE-DERIVES no statistic
 * (Law 2 / Law 8): `n`, per-country `total`, the org-wide `total`, `ratesUsed`, and `pinnedOn` all
 * arrive computed. The builder only SELECTS the arm, FORMATS money and dates, and PICKS the pulse
 * rows. No field is added to the payload and no port is touched.
 *
 * ## Never convert or compare across currencies (Law 3 / AD-13)
 *
 * Per-country totals are single-currency and never converted; the ONE cross-currency figure is the
 * org-wide `total`, already converted by the domain and carried with its receipts. The pulse sizes
 * nothing here — its bars are drawn by the browser from the currency-neutral headcount `n` in the
 * `.tsx`; the per-country LOCAL totals ride the pulse rows for the data table only, never bar-
 * compared. The builder therefore does no arithmetic on money at all — it formats what arrived.
 *
 * ## Fail CLOSED on money (Law 4 / AD-4, AD-6)
 *
 * Each money figure is `formatMoney(fromBoundaryMoney(field), format)`, with `format` resolved from
 * the reference `currencies` list by the amount's OWN `currency` code — never re-resolved from a
 * country, never converted. If the code is absent from the list, the exponent is unsupported, or the
 * `amountMinor` is not a canonical minor-unit string, the figure is withheld (`null`) — a blank cell
 * or an omitted headline — never a bare number, a raw `amountMinor` string, or an abbreviation.
 *
 * The imports are `import type` except `formatMoney`, `fromBoundaryMoney`, `formatPlainDate` and
 * `plainDateToIso` — pure, total, clock-free domain functions, the calling rule `src/ui/README.md`
 * ratified at story 1-6. There is no `Date`, no `Math.random`, no I/O here (Law 2 / Law 6).
 */

/**
 * The heading and statement for the payroll-totals "unavailable" region.
 *
 * The read itself did not resolve (`getPayrollTotals` → `unavailable`). The register is the shared
 * `EmployeeUnavailable` one (a region with a heading, never `role="alert"`; project-context
 * § Conventions). The statement names the OUTCOME and no cause — the read layer swallows the reason.
 */
export const PAYROLL_TOTALS_UNAVAILABLE_HEADING = 'The payroll totals could not be read';
export const PAYROLL_TOTALS_UNAVAILABLE_STATEMENT =
  'The payroll totals are not readable right now. Nothing has changed.';

/** The heading for the calm org-wide refusal region — a region with a heading, never an alert. */
const ORG_WIDE_REFUSAL_HEADING = 'Org-wide total unavailable';

/** The number of countries the Home pulse shows — the busiest few by headcount. */
const PULSE_TOP_N = 5;

/** The arrow that joins a currency pair — `INR → USD`, a direction, not a subtraction. */
const PAIR_ARROW = ' → ';

/**
 * One per-country row as the component consumes it: the country's codes, its SINGLE currency, the
 * in-population headcount, and its LOCAL total formatted (or `null` — withheld, fail closed). The
 * `countryCode` is the React key (a country's schema code, unique — the display `countryName` is not
 * guaranteed unique and would collide as a key).
 */
export type PayrollCountryRow = {
  readonly countryCode: string;
  readonly countryName: string;
  readonly currency: string;
  readonly n: number;
  readonly total: string | null;
};

/**
 * One pulse row: the currency-neutral headcount `n` (which sizes the decorative bar in the `.tsx`)
 * plus the LOCAL total for the accompanying data table (never bar-compared). Keyed on `countryCode`.
 */
export type PayrollPulseRow = {
  readonly countryCode: string;
  readonly countryName: string;
  readonly n: number;
  readonly total: string | null;
};

/** One "View Base Rates" receipt: the applied pair, its display `rate` string, and the pinned date. */
export type PayrollRateRow = {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly rate: string;
  readonly pinnedOn: string;
};

/**
 * The org-wide figure as the component consumes it.
 *
 *   - `answer` — the headline (formatted `total`, or `null` when it cannot format), the reporting
 *     currency, the one-line provenance caption, and the `ratesUsed` disclosure rows (`[]` when
 *     nothing converted, so no "View Base Rates" is shown).
 *   - `refusal` — a calm region carrying its heading + statement (never `role="alert"`).
 */
export type PayrollOrgWideVM =
  | {
      readonly kind: 'answer';
      readonly headline: string | null;
      readonly reportingCurrency: string;
      readonly caption: string;
      readonly rates: readonly PayrollRateRow[];
    }
  | { readonly kind: 'refusal'; readonly heading: string; readonly statement: string };

/**
 * The payroll totals as both surfaces consume them.
 *
 *   - `answer` — the per-country rows (delivered order), the org-wide answer-or-refusal, and the
 *     top-5-by-headcount pulse rows.
 *   - `unavailable` — the shared calm region's heading + statement.
 */
export type PayrollTotalsVM =
  | { readonly kind: 'unavailable'; readonly heading: string; readonly statement: string }
  | {
      readonly kind: 'answer';
      readonly perCountry: readonly PayrollCountryRow[];
      readonly orgWide: PayrollOrgWideVM;
      readonly pulse: readonly PayrollPulseRow[];
    };

/** A date shown in data: the DESIGN display form, falling back to the canonical ISO (never empty). */
function formatDate(date: PlainDate): string {
  return formatPlainDate(date) ?? plainDateToIso(date);
}

/**
 * One boundary money to display text, or `null` when it cannot be read (fail closed). The
 * `CurrencyFormat` is resolved by the money's OWN `currency` code (AD-6) — never a country, never
 * converted. A missing format, an unsupported exponent, or a non-canonical `amountMinor` all withhold
 * the figure rather than print a partial, bare, or raw amount.
 */
function formatBoundary(
  value: { readonly amountMinor: string; readonly currency: string },
  currencies: readonly CurrencyFormat[],
): string | null {
  const format = currencies.find((candidate) => candidate.code === value.currency);
  if (format === undefined) {
    return null;
  }
  const money = fromBoundaryMoney(value);
  if (money === null) {
    return null;
  }
  return formatMoney(money, format);
}

/**
 * Build the CAP-9 view-model from story 10-1's `GetPayrollTotalsResult`.
 *
 * PURE and TOTAL: every input answers with a value, never an exception. It selects the arm; for
 * `answer` it maps the per-country rows (formatting each LOCAL total, fail closed), builds the
 * org-wide answer-or-refusal, and selects the pulse; for `unavailable` it returns the module-level
 * heading/statement.
 */
export function buildPayrollTotals(
  result: GetPayrollTotalsResult,
  currencies: readonly CurrencyFormat[],
): PayrollTotalsVM {
  if (result.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      heading: PAYROLL_TOTALS_UNAVAILABLE_HEADING,
      statement: PAYROLL_TOTALS_UNAVAILABLE_STATEMENT,
    };
  }

  const { totals } = result;
  return {
    kind: 'answer',
    // Delivered order preserved (the payload is already `countryCode` ascending, AD-13); only the
    // LOCAL total is formatted, and only through the one formatter.
    perCountry: totals.perCountry.map((country) => toCountryRow(country, currencies)),
    orgWide: buildOrgWide(totals, currencies),
    pulse: buildPulse(totals.perCountry, currencies),
  };
}

/** One per-country row: codes/currency/`n` carried verbatim, the LOCAL total formatted (fail closed). */
function toCountryRow(
  country: PayrollCountryTotal,
  currencies: readonly CurrencyFormat[],
): PayrollCountryRow {
  return {
    countryCode: country.countryCode,
    countryName: country.countryName,
    currency: country.currency,
    n: country.n,
    total: formatBoundary(country.total, currencies),
  };
}

/** The org-wide answer (headline + provenance caption + rate receipts) or the calm refusal region. */
function buildOrgWide(totals: PayrollTotals, currencies: readonly CurrencyFormat[]): PayrollOrgWideVM {
  const { orgWide } = totals;
  if (orgWide.kind === 'refusal') {
    return {
      kind: 'refusal',
      heading: ORG_WIDE_REFUSAL_HEADING,
      statement: refusalStatement(orgWide),
    };
  }

  const asOfText = formatDate(totals.asOf);
  // A conversion happened iff a set date was pinned; then the caption cites it and the receipts are
  // disclosed. Otherwise the total is a plain sum in the reporting currency (as-of only, no rates).
  const caption =
    orgWide.pinnedOn !== null
      ? `Converted to ${orgWide.reportingCurrency} at rates pinned ${formatDate(orgWide.pinnedOn)}, as of ${asOfText}`
      : `Summed directly in ${orgWide.reportingCurrency} — no conversion, as of ${asOfText}`;
  return {
    kind: 'answer',
    headline: formatBoundary(orgWide.total, currencies),
    reportingCurrency: orgWide.reportingCurrency,
    caption,
    rates: orgWide.ratesUsed.map((receipt) => ({
      fromCurrency: receipt.fromCurrency,
      toCurrency: receipt.toCurrency,
      rate: receipt.rate,
      pinnedOn: formatDate(receipt.pinnedOn),
    })),
  };
}

/** The refusal statement — names the reason, and for `missing-rate` the absent pair(s) + set date. */
function refusalStatement(
  refusal: Extract<PayrollOrgWideTotal, { kind: 'refusal' }>,
): string {
  const { reportingCurrency } = refusal;
  // `missing-rate` always carries the winning set's date (10-1's contract); the `no-rate-set` arm
  // never does. Guard on `pinnedOn` rather than cast, so the naming is honest either way.
  if (refusal.reason === 'missing-rate' && refusal.pinnedOn !== null) {
    const pairs = refusal.missingPairs
      .map((pair) => `${pair.fromCurrency}${PAIR_ARROW}${pair.toCurrency}`)
      .join(', ');
    return `The rate set pinned ${formatDate(refusal.pinnedOn)} is missing ${pairs}, so the org-wide total in ${reportingCurrency} can't be shown. Per-country totals are unaffected.`;
  }
  return `No FX rate set is pinned on or before ${formatDate(refusal.asOf)}, so the org-wide total in ${reportingCurrency} can't be shown. Per-country totals are unaffected.`;
}

/**
 * The Home pulse rows: the busiest `PULSE_TOP_N` countries by headcount `n` DESCENDING, tie-broken by
 * `countryCode` ASCENDING. A stable, currency-neutral selection (AD-13) — the bars encode `n`, never
 * payroll magnitude. `perCountry` is copied before sorting so the delivered order is not mutated.
 */
function buildPulse(
  perCountry: readonly PayrollCountryTotal[],
  currencies: readonly CurrencyFormat[],
): readonly PayrollPulseRow[] {
  return [...perCountry]
    .sort((a, b) => (b.n - a.n) || (a.countryCode < b.countryCode ? -1 : a.countryCode > b.countryCode ? 1 : 0))
    .slice(0, PULSE_TOP_N)
    .map((country) => ({
      countryCode: country.countryCode,
      countryName: country.countryName,
      n: country.n,
      total: formatBoundary(country.total, currencies),
    }));
}
