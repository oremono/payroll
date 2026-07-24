import { systemClock } from '@/adapters/clock';
import { formatOverdueCsv } from '@/adapters/csv/format-overdue-csv';
import { resolveAsOf } from '@/application/as-of';
import { overduePeriodToParam, resolveOverduePeriod } from '@/application/overdue-period';
import { loadEmployeeFormOptions } from '@/application/use-cases/employees';
import { getOverdue, type OverdueReport } from '@/application/use-cases/overdue';
import type { CurrencyFormat } from '@/domain/money';
import { plainDateToIso, type PlainDate } from '@/domain/plain-date';
import type { OverduePeriod } from '@/domain/overdue';

import { employeeReadDeps, overdueDeps } from '@/app/employees/employee-deps';

/**
 * The CAP-10 overdue-for-review CSV export — a Route Handler for a file download (AD-21). AD-21 names
 * two route-handler JOBS — the CAP-1 multipart upload and CSV export DOWNLOADS; this is the same
 * download job for CAP-10, not a new kind of handler. A file download is the one thing neither a
 * Server Component read nor a Server Action does well, which is the sanctioned exception.
 *
 * This module is the COMPOSITION ROOT for the export: the only place these adapters are constructed
 * and injected. `systemClock.todayUtc()` is read exactly ONCE per request and the resolved `asOf`
 * travels inward as an argument (Law 6 / AD-11). No `fetch` to our own origin.
 *
 * ## Exports the VISIBLE list — same as-of AND period as the screen
 *
 * The `asOf` and `period` search params are resolved by the SAME `resolveAsOf` / `resolveOverduePeriod`
 * policies the page uses (identical `getAll`/total discipline), so the file matches the screen it was
 * launched from. Each row carries the employee, the current record's effective date, its salary with
 * currency, and the `asOf`/`cutoff`/`period` provenance — the receipts (Law 8 / AD-20).
 *
 * ## Always HTTP 200, never a framework error page
 *
 * When the list cannot be read (`unavailable`), the response is a HEADER-ONLY CSV (`null` report) — a
 * calm, well-formed file, never a 500. Money crosses through the one formatter; a currencies list
 * that could not be read leaves the money cells blank (fail closed) rather than a raw minor string.
 *
 * ## The file boundary's two encoding/privacy concerns
 *
 * A UTF-8 BOM (U+FEFF) is prepended so Excel-on-Windows reads the file as UTF-8 rather than the
 * system codepage — without it the currency symbols this export renders (`₹`, `€`) mojibake.
 * `Cache-Control: no-store` keeps this salary payload out of the browser disk cache and any
 * intermediary — compensation data must not linger in a shared cache.
 */

/** Byte-order mark so spreadsheet tools read the file as UTF-8 (currency symbols, non-ASCII names). */
const UTF8_BOM = '﻿';

/** The currencies list for money formatting, or `[]` (fail closed) when it cannot be read. */
async function readCurrencies(): Promise<readonly CurrencyFormat[]> {
  const options = await loadEmployeeFormOptions(employeeReadDeps());
  return options.kind === 'options' ? options.options.currencies : [];
}

async function buildCsv(asOf: PlainDate, period: OverduePeriod): Promise<string> {
  // The two reads run CONCURRENTLY, mirroring the page's `Promise.all` — the download path must not
  // pay two sequential round-trips.
  const [result, currencies] = await Promise.all([
    getOverdue(overdueDeps(), asOf, period),
    readCurrencies(),
  ]);
  // `unavailable` → header-only (a `null` report). Otherwise serialize the report with the
  // currencies list for money formatting.
  const report: OverdueReport | null = result.kind === 'answer' ? result.report : null;
  return formatOverdueCsv(report, currencies);
}

export async function GET(request: Request): Promise<Response> {
  const today = systemClock.todayUtc();
  const searchParams = new URL(request.url).searchParams;
  // `getAll`, not `get`: a repeated param is ambiguous, and the resolvers are the one place that
  // decide so — the same policy the page reads `asOf` + `period` with, so the file matches the screen.
  const asOf = resolveAsOf(searchParams.getAll('asOf'), today);
  const period = resolveOverduePeriod(searchParams.getAll('period'));

  const csv = await buildCsv(asOf, period);

  // The filename carries BOTH the as-of and the period, so two exports at the same as-of but
  // different periods (e.g. 1y vs 3y) are distinct files rather than one overwriting the other.
  const filename = `overdue-${plainDateToIso(asOf)}-${overduePeriodToParam(period)}.csv`;

  return new Response(`${UTF8_BOM}${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Compensation data — keep it out of the browser disk cache and any shared intermediary.
      'Cache-Control': 'no-store',
    },
  });
}
