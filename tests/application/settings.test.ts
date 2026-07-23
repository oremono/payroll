import { describe, expect, it } from 'vitest';

import type {
  SettingsRepository,
  SettingsView,
} from '@/application/ports/settings-repository';
import { getSettings, type SettingsDeps } from '@/application/use-cases/settings';

// Test-first (Law 1 / AD-23): red before `src/application/use-cases/settings.ts` exists.
//
// Against an in-memory FAKE, never a database (Law: Testing). `getSettings` reads the persisted
// single-row org config so the delivery boundary can hand the threshold inward as a parameter
// (Law 6 / AD-19) — no domain code ever reads settings. It is TOTAL (Law 8 / AD-20): a repository
// throw is `unavailable`, never an exception across the boundary.

function fakeDeps(
  config: { readonly settings?: SettingsView; readonly throws?: boolean } = {},
): SettingsDeps & { readonly reads: number } {
  const state = { reads: 0 };
  const repository = {
    readSettings: async () => {
      state.reads += 1;
      if (config.throws === true) {
        throw new Error('the database is not answering');
      }
      return config.settings ?? { outlierThresholdPct: 20, reportingCurrency: 'USD' };
    },
  } satisfies SettingsRepository;

  return {
    repository,
    get reads() {
      return state.reads;
    },
  };
}

describe('getSettings — the persisted org config, carried across the boundary (AD-19 / AD-20)', () => {
  it('returns the seeded default: threshold 20 and USD as the reporting currency', async () => {
    const result = await getSettings(fakeDeps());

    expect(result).toEqual({
      kind: 'settings',
      outlierThresholdPct: 20,
      reportingCurrency: 'USD',
    });
  });

  it('passes through whatever the repository persists, not a hard-coded default', async () => {
    const result = await getSettings(
      fakeDeps({ settings: { outlierThresholdPct: 35, reportingCurrency: 'INR' } }),
    );

    expect(result).toEqual({
      kind: 'settings',
      outlierThresholdPct: 35,
      reportingCurrency: 'INR',
    });
  });

  it('reads the repository exactly once', async () => {
    const deps = fakeDeps();

    await getSettings(deps);

    expect(deps.reads).toBe(1);
  });
});

describe('getSettings — totality (AD-20)', () => {
  it('answers unavailable when readSettings throws — the throw does NOT propagate', async () => {
    await expect(getSettings(fakeDeps({ throws: true }))).resolves.toEqual({
      kind: 'unavailable',
    });
  });
});
