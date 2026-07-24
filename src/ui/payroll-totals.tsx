import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import type {
  PayrollCountryRow,
  PayrollOrgWideVM,
  PayrollPulseRow,
  PayrollRateRow,
  PayrollTotalsVM,
} from '@/ui/payroll-totals-vm';

/**
 * The CAP-9 payroll-totals surface — MARKUP ONLY, feeding BOTH surfaces (the screen and the Home
 * tile+pulse).
 *
 * Every judgement is already made in `payroll-totals-vm.ts` and proven in
 * `tests/ui/payroll-totals.test.ts`: the arm selection, each per-country total formatted (fail
 * closed), the org-wide headline + provenance caption + `ratesUsed` disclosure OR the refusal
 * heading/statement, and the top-5 pulse rows. These components render the `PayrollTotalsVM` and
 * decide nothing — which is why they sit outside the coverage gate and need no logic test of their own.
 *
 * SERVER COMPONENTS: the surface is read-only ink, computed fresh per request (AD-12). Nothing here
 * is interactive — the pulse bars are decorative (`aria-hidden`) and static, "View Base Rates" is a
 * native `<details>`/`<summary>` (no client island), and the only affordance is a plain `Export CSV`
 * `<a>` to the export Route Handler. The as-of control in the shell is the page's only interaction.
 *
 * ## Never convert or compare across currencies (Law 3 / AD-13)
 *
 * Per-country totals render in their OWN currency with their ISO code, never bar-compared. The pulse
 * bars are sized by the currency-neutral headcount `n` (`flexGrow`), and the per-country LOCAL totals
 * ride the accessible counts table beside them, never a bar. The one converted figure is the org-wide
 * headline, and it never appears without its provenance caption one line beneath it (DR6).
 *
 * ## Refusal is data, not error (Law 8 / AD-20)
 *
 * The org-wide refusal is a flat `bg-refusal-fill` region WITH A HEADING — never `role="alert"`,
 * never error/red — while the per-country table stays fully present. Semantic tokens only, light +
 * dark; no hex, no shadow, no tooltip/`title`, no transition, no click target on the bars.
 */

const SCREEN_HEADING_ID = 'payroll-totals-heading';
const SCREEN_HEADING = 'Payroll totals by country';

/** The calm statement when there are no countries in the as-of population — a statement, not an empty table. */
const NO_COUNTRIES_STATEMENT = 'No countries to report.';

const HEAD_CELL = 'py-cell-padding-v pr-cell-padding-h text-label-caps uppercase text-ink-muted';
const HEAD_CELL_NUM =
  'py-cell-padding-v pl-cell-padding-h text-right text-label-caps uppercase text-ink-muted';
const TEXT_CELL = 'py-cell-padding-v pr-cell-padding-h text-body-sm text-ink';
const NUM_CELL = 'py-cell-padding-v pl-cell-padding-h text-right font-mono text-number-sm text-ink';

/** A withheld money figure (fail closed) reads as an em dash, never a bare or raw amount. */
const WITHHELD = '—';

/**
 * The Payroll Totals screen: the per-country table (local currency, mono right-aligned, delivered
 * order) with the `Export CSV` ghost link, then the org-wide block (answer headline + caption +
 * "View Base Rates", or the calm refusal region). `unavailable` renders the shared region.
 */
export function PayrollTotalsView({
  vm,
  exportHref,
}: {
  readonly vm: PayrollTotalsVM;
  readonly exportHref: string;
}) {
  if (vm.kind === 'unavailable') {
    return (
      <EmployeeUnavailable
        id="payroll-totals-unavailable-heading"
        heading={vm.heading}
        statement={vm.statement}
      />
    );
  }

  return (
    <div className="flex flex-col gap-gutter">
      <section
        aria-labelledby={SCREEN_HEADING_ID}
        className="rounded border border-border-hairline bg-surface-card p-4"
      >
        <div className="flex items-center justify-between gap-gutter">
          <h2 id={SCREEN_HEADING_ID} className="text-label-caps uppercase text-ink-muted">
            {SCREEN_HEADING}
          </h2>
          {/* The CSV export (DR16): a secondary hairline ghost link, carrying the current as-of so
              the file matches the screen. A plain `<a>` to the export Route Handler — the handler's
              `Content-Disposition: attachment` makes it a download. */}
          <a
            href={exportHref}
            className="rounded border border-border-hairline px-3 py-2 text-body-sm text-ink-muted hover:text-ink"
          >
            Export CSV
          </a>
        </div>

        {vm.perCountry.length === 0 ? (
          <p className="mt-3 text-body-md text-ink">{NO_COUNTRIES_STATEMENT}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <PerCountryTable rows={vm.perCountry} />
          </div>
        )}
      </section>

      <OrgWideBlock orgWide={vm.orgWide} />
    </div>
  );
}

/**
 * The per-country table — the accessible carrier of every per-country figure. Real `<thead>`/`<th
 * scope="col">`, a `sr-only` caption, mono right-aligned numerals, one row per country in the
 * delivered order. Each total carries its own ISO currency code; a withheld total shows an em dash.
 */
function PerCountryTable({ rows }: { readonly rows: readonly PayrollCountryRow[] }) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">
        Payroll total per country in each country&rsquo;s own local currency: country, currency,
        headcount, and the local total. Totals are never converted across currencies.
      </caption>
      <thead>
        <tr className="border-b border-border-hairline bg-surface-card">
          <th scope="col" className={HEAD_CELL}>
            Country
          </th>
          <th scope="col" className={HEAD_CELL}>
            Currency
          </th>
          <th scope="col" className={HEAD_CELL_NUM}>
            Headcount
          </th>
          <th scope="col" className={HEAD_CELL_NUM}>
            Annual payroll total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.countryCode} className="border-b border-border-hairline">
            <td className={TEXT_CELL}>{row.countryName}</td>
            <td className="py-cell-padding-v pr-cell-padding-h font-mono text-number-sm text-ink-muted">
              {row.currency}
            </td>
            <td className={NUM_CELL}>{row.n}</td>
            <td className={NUM_CELL}>{row.total ?? WITHHELD}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The org-wide block: an answer (the headline figure in the reporting currency, the one-line
 * provenance caption directly beneath it, and a native "View Base Rates" disclosure of the applied
 * receipts) OR the calm refusal region. A refusal is styled with the dignity of an answer — a region
 * with a heading, `bg-refusal-fill`, never `role="alert"`, never error-colored.
 */
function OrgWideBlock({ orgWide }: { readonly orgWide: PayrollOrgWideVM }) {
  if (orgWide.kind === 'refusal') {
    return (
      <EmployeeUnavailable
        id="payroll-org-wide-refusal-heading"
        heading={orgWide.heading}
        statement={orgWide.statement}
      />
    );
  }

  return (
    <section
      aria-labelledby="payroll-org-wide-heading"
      className="rounded border border-border-hairline bg-surface-card p-4"
    >
      <h2 id="payroll-org-wide-heading" className="text-label-caps uppercase text-ink-muted">
        Total payroll
      </h2>
      {/* The headline in the reporting currency — the ONE converted figure, the full grouped amount
          (no abbreviation, Law 4). Withheld to a calm statement when the money cannot format. */}
      <p className="mt-3 font-mono text-number-lg text-ink">{orgWide.headline ?? WITHHELD}</p>
      {/* Provenance rides one line beneath its figure (DR6) — never orphaned from its number. */}
      <p className="mt-1 text-body-sm text-ink-muted">{orgWide.caption}</p>
      {orgWide.rates.length === 0 ? null : <BaseRates rates={orgWide.rates} />}
    </section>
  );
}

/**
 * The "View Base Rates" disclosure — a native `<details>`/`<summary>` (no client island) listing
 * every applied `ratesUsed` receipt: the pair, its display rate, and its pinned date. Rendered only
 * when a conversion happened (`rates` non-empty).
 */
function BaseRates({ rates }: { readonly rates: readonly PayrollRateRow[] }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-body-sm text-ink-muted hover:text-ink">
        View base rates
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            The FX rates applied to convert each source currency to the reporting currency, with the
            date each rate set was pinned to.
          </caption>
          <thead>
            <tr className="border-b border-border-hairline">
              <th scope="col" className={HEAD_CELL}>
                From
              </th>
              <th scope="col" className={HEAD_CELL}>
                To
              </th>
              <th scope="col" className={HEAD_CELL_NUM}>
                Rate
              </th>
              <th scope="col" className={HEAD_CELL_NUM}>
                Pinned on
              </th>
            </tr>
          </thead>
          <tbody>
            {rates.map((rate) => (
              <tr key={`${rate.fromCurrency}-${rate.toCurrency}`} className="border-b border-border-hairline">
                <td className="py-cell-padding-v pr-cell-padding-h font-mono text-number-sm text-ink">
                  {rate.fromCurrency}
                </td>
                <td className="py-cell-padding-v pr-cell-padding-h font-mono text-number-sm text-ink">
                  {rate.toCurrency}
                </td>
                <td className={NUM_CELL}>{rate.rate}</td>
                <td className={NUM_CELL}>{rate.pinnedOn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const TILE_HEADING_ID = 'payroll-headline-tile-heading';

/**
 * The Home TOTAL PAYROLL tile: the org-wide headline figure + its provenance caption (an answer), or
 * the calm refusal region — the SAME `vm.orgWide` the screen renders, so the two cannot disagree. An
 * `unavailable` VM renders the shared region.
 */
export function PayrollHeadlineTile({ vm }: { readonly vm: PayrollTotalsVM }) {
  if (vm.kind === 'unavailable') {
    return (
      <EmployeeUnavailable
        id="home-payroll-unavailable-heading"
        heading={vm.heading}
        statement={vm.statement}
      />
    );
  }

  if (vm.orgWide.kind === 'refusal') {
    return (
      <EmployeeUnavailable
        id="home-payroll-org-wide-refusal-heading"
        heading={vm.orgWide.heading}
        statement={vm.orgWide.statement}
      />
    );
  }

  return (
    <section
      aria-labelledby={TILE_HEADING_ID}
      className="rounded border border-border-hairline bg-surface-card p-4"
    >
      <h2 id={TILE_HEADING_ID} className="text-label-caps uppercase text-ink-muted">
        Total payroll
      </h2>
      <p className="mt-3 font-mono text-number-lg text-ink">{vm.orgWide.headline ?? WITHHELD}</p>
      <p className="mt-1 text-body-sm text-ink-muted">{vm.orgWide.caption}</p>
    </section>
  );
}

const PULSE_HEADING_ID = 'payroll-by-country-heading';
const PULSE_HEADING = 'Payroll by country';

/**
 * The Home by-country pulse: a decorative `aria-hidden` bar per country sized by headcount `n`
 * (`flexGrow`, squared ends, static — no hover/tooltip/click target), paired with an accessible
 * counts + local-totals table. The bars encode HEADCOUNT, never payroll magnitude (Law 3 / AD-13) —
 * the local totals live only in the table, each in its own currency, never bar-compared. A drill link
 * opens the Payroll Totals screen on the same as-of.
 *
 * An `unavailable` VM renders the shared region; an empty population renders a calm statement.
 */
export function PayrollByCountryChart({
  vm,
  visuallyHiddenTable = false,
  drillHref,
}: {
  readonly vm: PayrollTotalsVM;
  readonly visuallyHiddenTable?: boolean;
  readonly drillHref?: string;
}) {
  if (vm.kind === 'unavailable') {
    return (
      <EmployeeUnavailable
        id="home-payroll-pulse-unavailable-heading"
        heading={vm.heading}
        statement={vm.statement}
      />
    );
  }

  return (
    <section
      aria-labelledby={PULSE_HEADING_ID}
      className="rounded border border-border-hairline bg-surface-card p-4"
    >
      <h2 id={PULSE_HEADING_ID} className="text-label-caps uppercase text-ink-muted">
        {PULSE_HEADING}
      </h2>

      {vm.pulse.length === 0 ? (
        <p className="mt-3 text-body-md text-ink">{NO_COUNTRIES_STATEMENT}</p>
      ) : (
        <>
          {/* The decorative bar strip — `aria-hidden`, static, sized by headcount only. */}
          <ol aria-hidden className="mt-4 flex flex-col gap-cell-padding-v">
            {vm.pulse.map((row) => (
              <li key={row.countryCode}>
                <CountryBar row={row} />
              </li>
            ))}
          </ol>

          {/* The data — a real table, visible on the screen-less Home pulse or `sr-only`. */}
          <div className={visuallyHiddenTable ? 'sr-only' : 'mt-4 overflow-x-auto'}>
            <PulseTable rows={vm.pulse} />
          </div>
        </>
      )}

      {drillHref === undefined ? null : (
        <p className="mt-4 text-body-sm">
          <a href={drillHref} className="text-ink underline underline-offset-2 hover:text-primary">
            View payroll totals
          </a>
        </p>
      )}
    </section>
  );
}

/**
 * One country's headcount bar: a single `bg-primary` segment sized by `flexGrow` from the INTEGER
 * headcount so the browser computes the split (no percentage in TS). Squared ends, no gridlines,
 * static. A zero-headcount country would show an empty track, though the pulse only carries in-
 * population countries.
 */
function CountryBar({ row }: { readonly row: PayrollPulseRow }) {
  if (row.n <= 0) {
    return <div className="h-3 w-full bg-surface-tint" />;
  }
  return (
    <div className="flex h-3 w-full">
      <div className="h-full bg-primary" style={{ flexGrow: row.n, flexBasis: 0 }} />
    </div>
  );
}

/**
 * The pulse counts table — the accessible carrier of the headcounts AND the local totals. Real
 * `<th scope="col">`, a `sr-only` caption, mono right-aligned numerals. Each total is in its own
 * currency (carried on the row), never bar-compared.
 */
function PulseTable({ rows }: { readonly rows: readonly PayrollPulseRow[] }) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">
        Headcount and local-currency payroll total for the busiest countries by headcount. Bars encode
        headcount only; local totals are never compared across currencies.
      </caption>
      <thead>
        <tr className="border-b border-border-hairline bg-surface-card">
          <th scope="col" className={HEAD_CELL}>
            Country
          </th>
          <th scope="col" className={HEAD_CELL_NUM}>
            Headcount
          </th>
          <th scope="col" className={HEAD_CELL_NUM}>
            Local total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.countryCode} className="border-b border-border-hairline">
            <td className={TEXT_CELL}>{row.countryName}</td>
            <td className={NUM_CELL}>{row.n}</td>
            <td className={NUM_CELL}>{row.total ?? WITHHELD}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
