import type { Metadata } from 'next';
import { connection } from 'next/server';

import { systemClock } from '@/adapters/clock';
import { resolveAsOf } from '@/application/as-of';
import { overduePeriodToParam, resolveOverduePeriod } from '@/application/overdue-period';
import { pageTitleFor } from '@/ui/nav-items';

// The browser-tab title, drawn from the same IA declaration the shell reads (`nav-items`).
export const metadata: Metadata = { title: pageTitleFor('/overdue') };
import { loadEmployeeFormOptions } from '@/application/use-cases/employees';
import { getOverdue } from '@/application/use-cases/overdue';
import type { CurrencyFormat } from '@/domain/money';
import { formatPlainDate, plainDateToIso } from '@/domain/plain-date';
import { OverdueList } from '@/ui/overdue-list';
import { OverduePeriodControl } from '@/ui/overdue-period-control';
import { buildOverdue } from '@/ui/overdue-vm';

import { employeeReadDeps, overdueDeps } from '../employees/employee-deps';

/**
 * Overdue for Review — the CAP-10 surface (story 11-2). Until now this route was story 1-6's
 * placeholder ("No employees yet…").
 *
 * A React Server Component reading IN-PROCESS (AD-21) — no `fetch` to our own origin (the CSV export
 * Route Handler is the export link's target, reached by the browser, not by this page). This file is
 * the delivery boundary and the composition root: the clock is read ONCE here and the resolved `asOf`
 * travels inward, alongside the `period` resolved by the total `resolveOverduePeriod` (the residual
 * risk story 11-1 flagged — the hostile `?period=` param is validated HERE, never in the pure core).
 *
 * ## The page and the export route resolve `asOf` + `period` IDENTICALLY
 *
 * Both feed the SAME total resolvers — `resolveAsOf` and `resolveOverduePeriod` — which treat a lone
 * string and a single-element array identically, so it does not matter that this RSC reads them by
 * bracket access on the awaited `searchParams` (`params['asOf']`) while the export route reads them
 * with `URLSearchParams.getAll('asOf')`; the resolved values are identical. The pager and the export
 * href both carry the RESOLVED `asOf` + `period`, so a shared or bookmarked link reproduces the view.
 *
 * ## In-memory pagination (AD-24 / AD-12)
 *
 * `getOverdue` returns the WHOLE list; adding limit/offset would change the contract (AD-24). The VM
 * slices the loaded array by the surface-owned `?page=` param and the UI page size, rendering the
 * CLAMPED page. The currencies list is read at the boundary for money formatting (Law 4), failing
 * closed to `[]`. `unavailable` renders the calm shared region (never `role="alert"`, HTTP 200).
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The currencies list for money formatting, or `[]` (fail closed) when it cannot be read. */
async function readCurrencies(): Promise<readonly CurrencyFormat[]> {
  const options = await loadEmployeeFormOptions(employeeReadDeps());
  return options.kind === 'options' ? options.options.currencies : [];
}

/** The requested page from the URL, as a number. Total: an absent, repeated, or unparseable param
 * yields `1`; the VM does the clamping into `1..pageCount` from the effective row count. */
function parsePage(raw: string | readonly string[] | undefined): number {
  const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : 1;
}

/** A `/overdue` href for a page number, preserving the RESOLVED `asOf` + `period`; `page` dropped at 1. */
function overdueHref(asOfIso: string, periodParam: string, page: number): string {
  const query = new URLSearchParams();
  query.set('asOf', asOfIso);
  query.set('period', periodParam);
  if (page > 1) {
    query.set('page', String(page));
  }
  return `/overdue?${query.toString()}`;
}

export default async function OverduePage({ searchParams }: { searchParams: SearchParams }) {
  // Per REQUEST, never at build time — the clock read must not be hoisted into the build (AD-11).
  await connection();

  const params = await searchParams;

  // Hostile by default — anything a person or a stale bookmark can type. Both resolvers are total:
  // a malformed, impossible, future, or repeated param resolves to a safe value (today / the default
  // preset), never a throw.
  const asOf = resolveAsOf(params['asOf'], systemClock.todayUtc());
  const period = resolveOverduePeriod(params['period']);
  const page = parsePage(params['page']);

  const asOfIso = plainDateToIso(asOf);
  const periodParam = overduePeriodToParam(period);

  const [result, currencies] = await Promise.all([
    getOverdue(overdueDeps(), asOf, period),
    readCurrencies(),
  ]);

  const exportHref = `/api/overdue/export?asOf=${encodeURIComponent(asOfIso)}&period=${encodeURIComponent(periodParam)}`;

  return (
    <>
      <p className="rounded bg-surface-card p-3 text-body-md">
        Showing employees overdue for review as of{' '}
        {/* All numerals are JetBrains Mono, dates in data positions included (DESIGN § Typography). */}
        <time
          data-testid="as-of-echo"
          dateTime={asOfIso}
          className="font-mono text-number-sm"
        >
          {/* `formatPlainDate` returns `null` for an out-of-range month; unreachable through
              `resolveAsOf`, but the canonical machine form is the fallback (never an empty `<time>`). */}
          {formatPlainDate(asOf) ?? asOfIso}
        </time>
        .
      </p>

      <div className="mt-3">
        {/* The picker is bounded to the as-of date: a cutoff after it would flag the whole population. */}
        <OverduePeriodControl maxCutoff={asOfIso} />
      </div>

      <div className="mt-3">
        <OverdueList
          vm={buildOverdue(result, currencies, page)}
          exportHref={exportHref}
          hrefForPage={(targetPage) => overdueHref(asOfIso, periodParam, targetPage)}
          asOfParam={asOfIso}
        />
      </div>
    </>
  );
}
