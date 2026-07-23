import type {
  SettingsRepository,
  SettingsView,
} from '@/application/ports/settings-repository';

import { getDbClient } from './client';
import type { PrismaClient } from './generated/client';

/**
 * The Prisma implementation of the settings port (AD-19) — the ONE reader of the persisted
 * single-row org configuration.
 *
 * READ-ONLY: it selects the single `settings` row and hands its threshold and reporting currency
 * inward. There is no write here; a settings edit surface, if ever built, would be a separate
 * mutation with its own single-row guard.
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
  };
}
