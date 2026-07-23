import { systemClock } from '@/adapters/clock';
import { formatOutliersCsv } from '@/adapters/csv/format-outliers-csv';
import { resolveAsOf } from '@/application/as-of';
import { loadEmployeeFormOptions } from '@/application/use-cases/employees';
import { getOutlierFindings } from '@/application/use-cases/outliers';
import { getSettings } from '@/application/use-cases/settings';
import type { CurrencyFormat } from '@/domain/money';
import { plainDateToIso, type PlainDate } from '@/domain/plain-date';

import { employeeReadDeps, outlierFindingsDeps } from '@/app/employees/employee-deps';
import { settingsReadDeps } from '@/app/settings/settings-deps';

/**
 * The CAP-6 findings CSV export — the SECOND and LAST Route Handler this system will ever have
 * (AD-21; the other is the CAP-1 multipart upload). A file download is the one thing neither a
 * Server Component read nor a Server Action does well, which is the sanctioned exception.
 *
 * This module is the COMPOSITION ROOT for the export: the only place these adapters are constructed
 * and injected. `systemClock.todayUtc()` is read exactly ONCE per request and the resolved `asOf`
 * travels inward as an argument (Law 6 / AD-11); the persisted threshold is read once via
 * `getSettings` and passed to `getOutlierFindings` (Law 6 / AD-19). No `fetch` to our own origin.
 *
 * ## Exports the VISIBLE list — same as-of, same threshold as the screen
 *
 * The `asOf` search param is resolved by the SAME `resolveAsOf` policy Home uses, so the file matches
 * the screen it was launched from. The threshold is the persisted one, echoed on every data row
 * alongside the as-of — the receipts (Law 8 / AD-20).
 *
 * ## Always HTTP 200, never a framework error page
 *
 * When settings or findings cannot be read, the response is a HEADER-ONLY CSV (zero data rows) — a
 * calm, well-formed file, never a 500. Money crosses through the one formatter; a currencies list
 * that could not be read leaves the money cells blank (fail closed) rather than emitting a raw minor
 * string.
 *
 * ## The file boundary's two encoding/privacy concerns
 *
 * A UTF-8 BOM (U+FEFF) is prepended so Excel-on-Windows reads the file as UTF-8 rather than the
 * system codepage — without it the currency symbols this export exists to render (`₹`, `€`) and any
 * non-ASCII name mojibake. `Cache-Control: no-store` keeps this salary/peer-median payload out of the
 * browser disk cache and any intermediary — compensation data must not linger in a shared cache.
 */

/** Byte-order mark so spreadsheet tools read the file as UTF-8 (currency symbols, non-ASCII names). */
const UTF8_BOM = '\uFEFF';

/** A header-only CSV — the zero-data-rows file the unreadable arms answer with. */
function headerOnlyCsv(asOf: PlainDate): string {
  return formatOutliersCsv({ asOf, thresholdPct: 0, groups: [] }, []);
}

/** The currencies list for money formatting, or `[]` (fail closed) when it cannot be read. */
async function readCurrencies(): Promise<readonly CurrencyFormat[]> {
  const options = await loadEmployeeFormOptions(employeeReadDeps());
  return options.kind === 'options' ? options.options.currencies : [];
}

async function buildCsv(asOf: PlainDate): Promise<string> {
  const settings = await getSettings(settingsReadDeps());
  if (settings.kind !== 'settings') {
    return headerOnlyCsv(asOf);
  }

  const findings = await getOutlierFindings(
    outlierFindingsDeps(),
    asOf,
    settings.outlierThresholdPct,
  );
  if (findings.kind !== 'findings') {
    return headerOnlyCsv(asOf);
  }

  const currencies = await readCurrencies();
  return formatOutliersCsv(findings.report, currencies);
}

export async function GET(request: Request): Promise<Response> {
  const today = systemClock.todayUtc();
  // `getAll`, not `get`: a repeated param is ambiguous, and `resolveAsOf` is the one place that
  // decides so — the same policy Home reads the as-of with, so the file matches the screen.
  const asOf = resolveAsOf(new URL(request.url).searchParams.getAll('asOf'), today);

  const csv = await buildCsv(asOf);

  return new Response(`${UTF8_BOM}${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="outliers-${plainDateToIso(asOf)}.csv"`,
      // Compensation data — keep it out of the browser disk cache and any shared intermediary.
      'Cache-Control': 'no-store',
    },
  });
}
