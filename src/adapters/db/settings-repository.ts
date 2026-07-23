import type {
  SettingsRepository,
  SettingsView,
} from '@/application/ports/settings-repository';

import { getDbClient } from './client';
import type { PrismaClient } from './generated/client';

/**
 * The Prisma implementation of the settings port (AD-19) — the reader AND, from story 7-2, the ONE
 * writer of the persisted single-row org configuration.
 *
 * `readSettings` selects the single `settings` row and hands its threshold and reporting currency
 * inward. `updateOutlierThresholdPct` is CAP-6's one mutation: it updates the SAME single row
 * (`id = 1`), never inserting and never touching a second row, so the `settings_single_row` guard
 * holds. `settings` already carries table-level `UPDATE` for `payroll_app` and a range CHECK, so
 * this needs no migration.
 */

/**
 * The single settings row's primary key. Always 1 — the schema's `CHECK (id = 1)` is the single-row
 * guard (AD-19), so this is the only id there is, and the seeded default (threshold 20, USD) is it.
 */
const SETTINGS_ROW_ID = 1;

export function createSettingsRepository(
  client: PrismaClient = getDbClient(),
): SettingsRepository {
  return {
    readSettings: async (): Promise<SettingsView> => {
      const row = await client.settings.findUnique({
        where: { id: SETTINGS_ROW_ID },
        // Only the two fields the boundary needs. `outlier_threshold_pct` is an integer percent the
        // use-case converts to tenths at the domain edge (AD-5); `reporting_currency` is the
        // org-wide conversion target (AD-13).
        select: { outlierThresholdPct: true, reportingCurrency: true },
      });

      // THROWS when the single row is absent — an invariant violation (the row is seeded and
      // guarded), not user input. The use-case catches it and answers `unavailable` (AD-20);
      // adapters may throw, the pure layers may not.
      if (row === null) {
        throw new Error(
          'settings row (id = 1) is absent — the single-row org configuration must be seeded (AD-19).',
        );
      }

      return {
        outlierThresholdPct: row.outlierThresholdPct,
        reportingCurrency: row.reportingCurrency,
      };
    },

    updateOutlierThresholdPct: async (pct: number): Promise<void> => {
      // Updates the SINGLE guarded row (`id = 1`) only — never an insert, never a second row — so
      // the `settings_single_row` CHECK is honoured. `pct` has already been validated by the
      // use-case to be an integer in `[1, 100]`; the `settings_outlier_threshold_pct_range` CHECK
      // (`> 0 AND <= 100`) is the DB-side belt. A value that ever bypassed validation trips that
      // CHECK, and Prisma surfaces it as a rejected promise — the use-case's `try/catch` turns it
      // into `unavailable` (adapters may throw; the pure layers may not).
      await client.settings.update({
        where: { id: SETTINGS_ROW_ID },
        data: { outlierThresholdPct: pct },
      });
    },
  };
}
