import { connection } from 'next/server';

import { systemClock } from '@/adapters/clock';
import { resolveAsOf } from '@/application/as-of';
import { loadEmployeeFormOptions } from '@/application/use-cases/employees';
import { DEFAULT_OVERDUE_PERIOD } from '@/application/overdue-period';
import { getGenderDistribution } from '@/application/use-cases/gender-distribution';
import { getOutlierFindings } from '@/application/use-cases/outliers';
import { getOverdue } from '@/application/use-cases/overdue';
import { getPayrollTotals } from '@/application/use-cases/payroll-totals';
import { getSettings } from '@/application/use-cases/settings';
import type { CurrencyFormat } from '@/domain/money';
import { formatPlainDate, plainDateToIso, type PlainDate } from '@/domain/plain-date';
import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import { GenderDistributionChart } from '@/ui/gender-distribution';
import {
  buildGenderDistribution,
  GENDER_DISTRIBUTION_UNAVAILABLE_HEADING,
  GENDER_DISTRIBUTION_UNAVAILABLE_STATEMENT,
} from '@/ui/gender-distribution-vm';
import { OutlierFindings } from '@/ui/outlier-findings';
import { buildOutlierFindings } from '@/ui/outlier-findings-vm';
import { OverdueSummary } from '@/ui/overdue-summary';
import { buildOverdueSummary } from '@/ui/overdue-vm';
import { PayrollByCountryChart, PayrollHeadlineTile } from '@/ui/payroll-totals';
import { buildPayrollTotals } from '@/ui/payroll-totals-vm';

import {
  employeeReadDeps,
  genderDistributionDeps,
  outlierFindingsDeps,
  overdueDeps,
  payrollTotalsDeps,
} from './employees/employee-deps';
import { settingsReadDeps } from './settings/settings-deps';

/**
 * Home — the CAP-6 outlier sweep (story 7-2). Until now this route was story 1-6's placeholder
 * ("No employees yet…").
 *
 * A React Server Component reading IN-PROCESS (AD-21) — no `fetch` to our own origin, no Route
 * Handler (the CSV export's handler is the export link's target, reached by the browser, not by this
 * page). This file is the delivery boundary and the composition root: the clock is read ONCE here
 * and the resolved `asOf` and the persisted threshold travel inward as arguments (Law 6 / AD-19).
 *
 * ## The threshold is read ONCE at the boundary and passed inward (Law 6 / AD-19)
 *
 * `getSettings` reads the persisted `outlierThresholdPct`; that integer is handed to
 * `getOutlierFindings` as its `thresholdPct` argument. No `src/ui`/`src/domain` code reads settings
 * inside the sweep, and the threshold judged is the threshold echoed on the report and in the
 * zero-state copy. When settings cannot be read, the page renders the calm "unreadable" region
 * rather than the sweep — the sweep has no threshold to judge against.
 *
 * ## The as-of echo keeps recompute observable
 *
 * The first card echoes the SERVER-resolved as-of date (`data-testid="as-of-echo"`), rendered from
 * `searchParams` through the same `resolveAsOf` policy — so when it changes, a real server render
 * happened. `e2e/shell.spec.ts` asserts on THIS element, and `e2e/tokens.spec.ts` reads computed
 * styles off `main p`, so that card keeps `rounded bg-surface-card p-3 text-body-md`. An as-of change
 * swaps the findings in place (the `<Announcer>` region, mounted in the layout, is never remounted).
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UNAVAILABLE_HEADING = 'The outlier findings could not be read';

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  // Per REQUEST, never at build time — the clock read must not be hoisted into the build (AD-11).
  await connection();

  const params = await searchParams;
  const today = systemClock.todayUtc();

  // Hostile by default — anything a person or a stale bookmark can type arrives here. `resolveAsOf`
  // is total: a malformed, impossible, future, or repeated param resolves to today.
  const asOf = resolveAsOf(params['asOf'], today);

  const settings = await getSettings(settingsReadDeps());

  return (
    <>
      <p className="rounded bg-surface-card p-3 text-body-md">
        Showing findings as of{' '}
        {/* All numerals are JetBrains Mono, dates in data positions included (DESIGN § Typography). */}
        <time
          data-testid="as-of-echo"
          dateTime={plainDateToIso(asOf)}
          className="font-mono text-number-sm"
        >
          {/* `formatPlainDate` returns `null` for an out-of-range month; unreachable through
              `resolveAsOf`, but the canonical machine form is the fallback (never an empty `<time>`). */}
          {formatPlainDate(asOf) ?? plainDateToIso(asOf)}
        </time>
        .
      </p>

      {settings.kind !== 'settings' ? (
        // Settings could not be read, so the sweep has no threshold to judge against — the calm
        // "unreadable" region, distinct from a refusal (project-context § Conventions). HTTP 200.
        <div className="mt-3">
          <EmployeeUnavailable
            id="home-settings-unavailable-heading"
            heading={UNAVAILABLE_HEADING}
            statement="The outlier findings are not readable right now. Nothing has changed."
          />
        </div>
      ) : (
        <div className="mt-3">
          <Findings asOf={asOf} thresholdPct={settings.outlierThresholdPct} />
        </div>
      )}

      {/* The CAP-8 gender-by-level pulse (story 9-2), under the outlier sweep. It needs no threshold,
          so it renders regardless of the settings read, over the SAME resolved as-of. */}
      <div className="mt-3">
        <GenderPulse asOf={asOf} />
      </div>

      {/* The CAP-9 payroll summary (story 10-2): the TOTAL PAYROLL tile + the by-country pulse, under
          the gender pulse, over the SAME resolved as-of. It needs no threshold either. */}
      <div className="mt-3">
        <PayrollSummary asOf={asOf} />
      </div>

      {/* The CAP-10 overdue count (story 11-2): a compact "N people overdue as of {date}" tile
          linking to the Overdue surface, over the SAME resolved as-of at the default period. */}
      <div className="mt-3">
        <OverdueCard asOf={asOf} />
      </div>
    </>
  );
}

/**
 * The findings surface, given a resolved as-of and the persisted threshold. Kept a small async
 * component so the page body stays a single boundary read; the threshold arrives as an argument
 * (never read inside the sweep). The export link carries the current as-of so the CSV matches the
 * screen.
 */
async function Findings({ asOf, thresholdPct }: { asOf: PlainDate; thresholdPct: number }) {
  const findings = await getOutlierFindings(outlierFindingsDeps(), asOf, thresholdPct);
  return (
    <OutlierFindings
      vm={buildOutlierFindings(findings, asOf)}
      exportHref={`/api/outliers/export?asOf=${plainDateToIso(asOf)}`}
      asOfParam={plainDateToIso(asOf)}
    />
  );
}

/**
 * The CAP-8 gender-by-level pulse, given the resolved as-of. Kept a small async component so the page
 * body stays a single boundary read; the `asOf` arrives as an argument (never read inside, Law 6). The
 * counts ride a VISUALLY-HIDDEN table (`visuallyHiddenTable`) beside the decorative bars, and the drill
 * link carries the current as-of so Gender Insights opens on the same date. An `unavailable` read
 * renders the calm shared region with a distinct heading id.
 */
async function GenderPulse({ asOf }: { asOf: PlainDate }) {
  const dist = await getGenderDistribution(genderDistributionDeps(), asOf);
  if (dist.kind === 'unavailable') {
    return (
      <EmployeeUnavailable
        id="home-gender-unavailable-heading"
        heading={GENDER_DISTRIBUTION_UNAVAILABLE_HEADING}
        statement={GENDER_DISTRIBUTION_UNAVAILABLE_STATEMENT}
      />
    );
  }
  return (
    <GenderDistributionChart
      vm={buildGenderDistribution(dist)}
      visuallyHiddenTable
      drillHref={`/gender-insights?asOf=${plainDateToIso(asOf)}`}
    />
  );
}

/** The currencies list for money formatting, or `[]` (fail closed) when it cannot be read. */
async function readCurrencies(): Promise<readonly CurrencyFormat[]> {
  const options = await loadEmployeeFormOptions(employeeReadDeps());
  return options.kind === 'options' ? options.options.currencies : [];
}

/**
 * The CAP-9 payroll summary, given the resolved as-of. Kept a small async component so the page body
 * stays a single boundary read; the `asOf` arrives as an argument (never read inside, Law 6). ONE
 * `getPayrollTotals` read builds ONE VM feeding both the TOTAL PAYROLL tile and the by-country pulse,
 * so they cannot disagree. The currencies list is read at the boundary for money formatting (Law 4),
 * failing closed to `[]`. The pulse's counts ride a VISUALLY-HIDDEN table beside the decorative bars
 * (sized by headcount only, AD-13), and the drill link carries the current as-of so the Payroll
 * Totals screen opens on the same date. An `unavailable`/refusal read renders the calm shared region.
 */
async function PayrollSummary({ asOf }: { asOf: PlainDate }) {
  const [result, currencies] = await Promise.all([
    getPayrollTotals(payrollTotalsDeps(), asOf),
    readCurrencies(),
  ]);
  const vm = buildPayrollTotals(result, currencies);
  // Branch ONCE: an unreadable payload replaces the whole summary (tile + pulse) with a single calm
  // region — never two stacked "could not be read" blocks. The tile and pulse keep their own defensive
  // `unavailable` arms for any other caller, but Home gates here so it says it once.
  if (vm.kind === 'unavailable') {
    return (
      <EmployeeUnavailable
        id="home-payroll-unavailable-heading"
        heading={vm.heading}
        statement={vm.statement}
      />
    );
  }
  return (
    <div className="flex flex-col gap-gutter">
      <PayrollHeadlineTile vm={vm} />
      <PayrollByCountryChart
        vm={vm}
        visuallyHiddenTable
        drillHref={`/payroll-totals?asOf=${plainDateToIso(asOf)}`}
      />
    </div>
  );
}

/**
 * The CAP-10 overdue count, given the resolved as-of. Kept a small async component so the page body
 * stays a single boundary read; the `asOf` arrives as an argument (never read inside, Law 6). It uses
 * the SAME `getOverdue` read the surface uses (never a second, clock-reading use-case — AD-22) at the
 * DEFAULT period, so Home's count is `report.rows.length` and cannot disagree with the surface at that
 * period. The drill link carries the current as-of so the Overdue surface opens on the same date. An
 * `unavailable` read renders the calm shared region.
 */
async function OverdueCard({ asOf }: { asOf: PlainDate }) {
  const result = await getOverdue(overdueDeps(), asOf, DEFAULT_OVERDUE_PERIOD);
  return (
    <OverdueSummary
      vm={buildOverdueSummary(result)}
      drillHref={`/overdue?asOf=${plainDateToIso(asOf)}`}
    />
  );
}
