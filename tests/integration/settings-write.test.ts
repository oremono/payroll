// CAP-6 settings WRITE against a REAL disposable PostgreSQL 18 (AD-24) — never a mock.
//
// What is proven here is what a fake repository CANNOT prove:
//
//   1. `updateOutlierThresholdPct` writes the SINGLE guarded row (`id = 1`) through the runtime
//      role: a write of 25 followed by a read-back returns 25. The `settings` table already holds
//      table-level UPDATE for `payroll_app`, so this needs no migration.
//   2. The single-row guard holds: after the write there is still exactly ONE settings row — the
//      adapter updates `id = 1`, never inserts a second.
//   3. The DB `settings_outlier_threshold_pct_range` CHECK (`> 0 AND <= 100`) is the belt to the
//      use-case's suspenders: a DIRECT out-of-range write that bypasses application validation is
//      rejected by the database itself (0 and 101), even for the runtime role.
//
// The `settings` row is a SINGLETON, so this suite restores it to the seeded default (20) in
// afterAll; no write path can create a second row for a later run to trip over.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSettingsRepository } from '@/adapters/db/settings-repository';
import { getSettings, type SettingsDeps } from '@/application/use-cases/settings';

const OWNER_URL = process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL_APP;

if (!OWNER_URL || !APP_URL) {
  throw new Error(
    'DATABASE_URL and DATABASE_URL_APP must be set — point them at a disposable PostgreSQL 18.',
  );
}

const owner = new Pool({ connectionString: OWNER_URL });
const app = new Pool({ connectionString: APP_URL });

const DEFAULT_THRESHOLD_PCT = 20;

function settingsDeps(): SettingsDeps {
  return { repository: createSettingsRepository() };
}

beforeAll(async () => {
  // Start from a known value so an earlier aborted run cannot skew the read-back assertion.
  await owner.query('UPDATE settings SET outlier_threshold_pct = $1 WHERE id = 1', [
    DEFAULT_THRESHOLD_PCT,
  ]);
});

afterAll(async () => {
  // Restore the singleton to the seeded default — the row outlives this run.
  await owner.query('UPDATE settings SET outlier_threshold_pct = $1 WHERE id = 1', [
    DEFAULT_THRESHOLD_PCT,
  ]);
  await Promise.all([owner.end(), app.end()]);
});

describe('updateOutlierThresholdPct writes the single guarded row (AD-19)', () => {
  it('persists a new threshold that a read-back through the use-case then returns', async () => {
    await createSettingsRepository().updateOutlierThresholdPct(25);

    const result = await getSettings(settingsDeps());
    expect(result).toEqual({ kind: 'settings', outlierThresholdPct: 25, reportingCurrency: 'USD' });
  });

  it('updates id = 1 in place — there is still exactly one settings row (single-row guard)', async () => {
    await createSettingsRepository().updateOutlierThresholdPct(30);

    const count = await owner.query<{ count: string }>('SELECT count(*)::text AS count FROM settings');
    expect(count.rows[0]?.count).toBe('1');

    const row = await owner.query<{ outlier_threshold_pct: number }>(
      'SELECT outlier_threshold_pct FROM settings WHERE id = 1',
    );
    expect(row.rows[0]?.outlier_threshold_pct).toBe(30);
  });
});

describe('the DB range CHECK rejects an out-of-range write that bypasses validation (belt to the suspenders)', () => {
  it('rejects a direct write of 0 (the > 0 half), even for the runtime role', async () => {
    await expect(
      app.query('UPDATE settings SET outlier_threshold_pct = 0 WHERE id = 1'),
    ).rejects.toThrow();
  });

  it('rejects a direct write of 101 (the <= 100 half)', async () => {
    await expect(
      app.query('UPDATE settings SET outlier_threshold_pct = 101 WHERE id = 1'),
    ).rejects.toThrow();
  });
});
