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
 *
 * Story 7-2 adds the ONE mutation CAP-6 introduces: `updateOutlierThreshold` (the Settings Apply),
 * which validates the integer percent in `[1, 100]` before the write and is likewise total.
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
 * The threshold Apply's payload (Law 8 / AD-20). `applied` echoes the persisted value as its
 * receipt; `rejected` names why the value was refused BEFORE any write (an integer in `[1, 100]` is
 * the contract, matching the DB `settings_outlier_threshold_pct_range` CHECK); `unavailable` is a
 * repository outage. Every arm is a return value — nothing throws across the boundary.
 */
export type UpdateThresholdResult =
  | { readonly kind: 'applied'; readonly value: number }
  | { readonly kind: 'rejected'; readonly reason: 'out-of-range' | 'not-an-integer' }
  | { readonly kind: 'unavailable' };

/**
 * Injected, never imported: the write half of the settings port. A `Pick` rather than the whole
 * port, because the mutation needs only `updateOutlierThresholdPct` — a surface that can write the
 * threshold need not also be able to read the config.
 */
export type SettingsWriteDeps = {
  readonly repository: Pick<SettingsRepository, 'updateOutlierThresholdPct'>;
};

/** The lower and upper bounds of a valid threshold percent — the DB CHECK is `> 0 AND <= 100`. */
const MIN_THRESHOLD_PCT = 1;
const MAX_THRESHOLD_PCT = 100;

/**
 * Apply a new outlier threshold — the ONE mutation CAP-6 introduces (story 7-2's Settings Apply).
 *
 * Validation happens BEFORE the write (Law 8 / AD-20): `pct` must be an integer in `[1, 100]`. A
 * fractional or non-finite value (`20.5`, `NaN`) is `not-an-integer`; an integer outside the range
 * (`0`, `101`) is `out-of-range`. A rejected value NEVER reaches the database — the DB CHECK is only
 * the belt to this suspenders. A valid value is written through the port; any repository throw is
 * caught and mapped to `unavailable`, so no exception crosses the boundary and a database-free
 * surface answers a calm state rather than a framework error.
 */
export async function updateOutlierThreshold(
  deps: SettingsWriteDeps,
  pct: number,
): Promise<UpdateThresholdResult> {
  if (!Number.isInteger(pct)) {
    return { kind: 'rejected', reason: 'not-an-integer' };
  }
  if (pct < MIN_THRESHOLD_PCT || pct > MAX_THRESHOLD_PCT) {
    return { kind: 'rejected', reason: 'out-of-range' };
  }

  try {
    await deps.repository.updateOutlierThresholdPct(pct);
    return { kind: 'applied', value: pct };
  } catch {
    return { kind: 'unavailable' };
  }
}

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
