import { systemClock } from '@/adapters/clock';
import { formatPayrollTotalsCsv } from '@/adapters/csv/format-payroll-totals-csv';
import { resolveAsOf } from '@/application/as-of';
import { loadEmployeeFormOptions } from '@/application/use-cases/employees';
import { getPayrollTotals, type PayrollTotals } from '@/application/use-cases/payroll-totals';
import type { CurrencyFormat } from '@/domain/money';
import { plainDateToIso, type PlainDate } from '@/domain/plain-date';

import { employeeReadDeps, payrollTotalsDeps } from '@/app/employees/employee-deps';

/**
 * The CAP-9 payroll-totals CSV export — a Route Handler for a file download (AD-21). AD-21 names two
 * route-handler JOBS — the CAP-1 multipart upload and CSV export DOWNLOADS — and epics.md assigns
 * DR16 (CSV export) to Epics 7, 10, and 11; this is the same download job for CAP-9, not a new kind
 * of handler. A file download is the one thing neither a Server Component read nor a Server Action
 * does well, which is the sanctioned exception.
 *
 * This module is the COMPOSITION ROOT for the export: the only place these adapters are constructed
 * and injected. `systemClock.todayUtc()` is read exactly ONCE per request and the resolved `asOf`
 * travels inward as an argument (Law 6 / AD-11). No `fetch` to our own origin.
 *
 * ## Exports the VISIBLE list — same as-of as the screen
 *
 * The `asOf` search param is resolved by the SAME `resolveAsOf` policy the page uses, so the file
 * matches the screen it was launched from. The per-country currency, local total, headcount, the FX
 * rate applied, and the as-of ride every row; the org-wide summary row carries the converted total or
 * the refusal — the receipts (Law 8 / AD-20).
 *
 * ## Always HTTP 200, never a framework error page
 *
 * When the totals cannot be read (`unavailable`), the response is a HEADER-ONLY CSV (`null` payload)
 * — a calm, well-formed file, never a 500. Money crosses through the one formatter; a currencies list
 * that could not be read leaves the money cells blank (fail closed) rather than a raw minor string.
 *
 * ## The file boundary's two encoding/privacy concerns
 *
 * A UTF-8 BOM (U+FEFF) is prepended so Excel-on-Windows reads the file as UTF-8 rather than the
 * system codepage — without it the currency symbols this export exists to render (`₹`, `€`) mojibake.
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

async function buildCsv(asOf: PlainDate): Promise<string> {
  const result = await getPayrollTotals(payrollTotalsDeps(), asOf);
  // `unavailable` → header-only (a `null` payload). Otherwise serialize the totals with the
  // currencies list for money formatting.
  const totals: PayrollTotals | null = result.kind === 'answer' ? result.totals : null;
  const currencies = await readCurrencies();
  return formatPayrollTotalsCsv(totals, currencies);
}

export async function GET(request: Request): Promise<Response> {
  const today = systemClock.todayUtc();
  // `getAll`, not `get`: a repeated param is ambiguous, and `resolveAsOf` is the one place that
  // decides so — the same policy the page reads the as-of with, so the file matches the screen.
  const asOf = resolveAsOf(new URL(request.url).searchParams.getAll('asOf'), today);

  const csv = await buildCsv(asOf);

  return new Response(`${UTF8_BOM}${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payroll-totals-${plainDateToIso(asOf)}.csv"`,
      // Compensation data — keep it out of the browser disk cache and any shared intermediary.
      'Cache-Control': 'no-store',
    },
  });
}
