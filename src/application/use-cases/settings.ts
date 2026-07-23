/**
 * The settings read use-case: the persisted org config, carried across the boundary (AD-19 / AD-20).
 *
 * Orchestration only — read the single settings row through the port and hand back the threshold
 * and reporting currency. Its whole reason to exist is Law 6 / AD-19: the delivery boundary
 * (story 7-2) calls this ONCE, then passes `outlierThresholdPct` inward to `getOutlierFindings` as
 * a parameter. No `src/domain/**` code reads settings, and this use-case reads no clock or
 * environment to get them.
 *
 * TOTAL (Law 8 / AD-20): a repository throw is `unavailable`, never an exception across the
 * boundary — the same discipline every read here holds to.
 */

import type { SettingsRepository } from '@/application/ports/settings-repository';

/**
 * The settings payload. `settings` carries the persisted values; `unavailable` means "we could not
 * find out" (a repository outage), deliberately distinct from any value the row might hold.
 */
export type GetSettingsResult =
  | {
      readonly kind: 'settings';
      readonly outlierThresholdPct: number;
      readonly reportingCurrency: string;
    }
  | { readonly kind: 'unavailable' };

/** Injected, never imported: no clock, no Prisma, no env — a read needs only the settings port. */
export type SettingsDeps = {
  readonly repository: SettingsRepository;
};

/**
 * Read the persisted org configuration. Any repository throw is caught and mapped to `unavailable`,
 * so no exception crosses the boundary and the database-free surface answers a calm state rather
 * than a framework error (mirroring the CAP-2 reads).
 */
export async function getSettings(deps: SettingsDeps): Promise<GetSettingsResult> {
  try {
    const settings = await deps.repository.readSettings();
    return {
      kind: 'settings',
      outlierThresholdPct: settings.outlierThresholdPct,
      reportingCurrency: settings.reportingCurrency,
    };
  } catch {
    return { kind: 'unavailable' };
  }
}
