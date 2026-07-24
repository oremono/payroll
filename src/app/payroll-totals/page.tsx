import type { Metadata } from 'next';
import { connection } from 'next/server';

import { systemClock } from '@/adapters/clock';
import { resolveAsOf } from '@/application/as-of';
import { loadEmployeeFormOptions } from '@/application/use-cases/employees';
import { getPayrollTotals } from '@/application/use-cases/payroll-totals';
import { pageTitleFor } from '@/ui/nav-items';

// The browser-tab title, drawn from the same IA declaration the shell reads (`nav-items`).
export const metadata: Metadata = { title: pageTitleFor('/payroll-totals') };
import type { CurrencyFormat } from '@/domain/money';
import { formatPlainDate, plainDateToIso } from '@/domain/plain-date';
import { PayrollTotalsView } from '@/ui/payroll-totals';
import { buildPayrollTotals } from '@/ui/payroll-totals-vm';

import { employeeReadDeps, payrollTotalsDeps } from '../employees/employee-deps';

/**
 * Payroll Totals — the CAP-9 surface (story 10-2). Until now this route was story 1-6's placeholder
 * ("No employees yet…").
 *
 * A React Server Component reading IN-PROCESS (AD-21) — no `fetch` to our own origin (the CSV
 * export's Route Handler is the export link's target, reached by the browser, not by this page). This
 * file is the delivery boundary and the composition root: the clock is read ONCE here and the
 * resolved `asOf` travels inward as an argument (Law 6 / AD-11). The nav href already carries the
 * ambient as-of, so there is no per-page as-of picker; the page just echoes the date the same way
 * Home does, keeping recompute observable.
 *
 * ## The currencies list is read at the boundary, for money formatting only (Law 4 / AD-4)
 *
 * The one money formatter needs each currency's minor-unit exponent, symbol, and grouping style —
 * resolved from the `currency` reference list here and handed to the pure VM. It is read separately
 * from the totals payload (which carries only `BoundaryMoney`), exactly as the CSV export route does.
 * A list that cannot be read leaves every figure withheld (fail closed) rather than throwing.
 *
 * The totals consume story 10-1's finalized payload unmodified: `unavailable` renders the calm shared
 * `EmployeeUnavailable` region (never `role="alert"`, HTTP 200), and `answer` renders
 * `<PayrollTotalsView>` — per-country totals in local currency, the org-wide converted total with its
 * provenance, or a calm org-wide refusal region. An empty population is an answer, not a refusal.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The currencies list for money formatting, or `[]` (fail closed) when it cannot be read. */
async function readCurrencies(): Promise<readonly CurrencyFormat[]> {
  const options = await loadEmployeeFormOptions(employeeReadDeps());
  return options.kind === 'options' ? options.options.currencies : [];
}

export default async function PayrollTotalsPage({ searchParams }: { searchParams: SearchParams }) {
  // Per REQUEST, never at build time — the clock read must not be hoisted into the build (AD-11).
  await connection();

  const params = await searchParams;

  // Hostile by default — anything a person or a stale bookmark can type. `resolveAsOf` is total: a
  // malformed, impossible, future, or repeated param resolves to today.
  const asOf = resolveAsOf(params['asOf'], systemClock.todayUtc());

  const [result, currencies] = await Promise.all([
    getPayrollTotals(payrollTotalsDeps(), asOf),
    readCurrencies(),
  ]);

  return (
    <>
      <p className="rounded bg-surface-card p-3 text-body-md">
        Showing payroll totals as of{' '}
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

      <div className="mt-3">
        <PayrollTotalsView
          vm={buildPayrollTotals(result, currencies)}
          exportHref={`/api/payroll-totals/export?asOf=${plainDateToIso(asOf)}`}
        />
      </div>
    </>
  );
}
