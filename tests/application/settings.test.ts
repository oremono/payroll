import { describe, expect, it } from 'vitest';

import type {
  SettingsRepository,
  SettingsView,
} from '@/application/ports/settings-repository';
import {
  getSettings,
  updateOutlierThreshold,
  type SettingsDeps,
  type SettingsWriteDeps,
} from '@/application/use-cases/settings';

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
    // The write half exists on the port from story 7-2; `getSettings` never calls it, so a read fake
    // supplies an unused no-op to satisfy the full port shape.
    updateOutlierThresholdPct: async () => undefined,
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

// The ONE mutation CAP-6 introduces (story 7-2): the Settings threshold Apply. It validates the
// integer percent in [1, 100] BEFORE any write (Law 8 / AD-20) — a rejected value never reaches the
// database — wraps the write in try/catch → unavailable, and never lets an exception cross the
// boundary. Tested test-first against an in-memory FAKE port that records every write it receives.

function fakeWriteDeps(
  config: { readonly throws?: boolean } = {},
): SettingsWriteDeps & { readonly writes: readonly number[] } {
  const writes: number[] = [];
  const repository = {
    updateOutlierThresholdPct: async (pct: number) => {
      writes.push(pct);
      if (config.throws === true) {
        throw new Error('the database is not answering');
      }
    },
  };

  return {
    repository,
    get writes() {
      return writes;
    },
  };
}

describe('updateOutlierThreshold — the one CAP-6 mutation, validated before the write (AD-20)', () => {
  it('applies an in-range integer, writing it to the port exactly once', async () => {
    const deps = fakeWriteDeps();

    const result = await updateOutlierThreshold(deps, 25);

    expect(result).toEqual({ kind: 'applied', value: 25 });
    expect(deps.writes).toEqual([25]);
  });

  it('applies the lower bound 1 and the upper bound 100 (the [1, 100] edges)', async () => {
    const low = fakeWriteDeps();
    const high = fakeWriteDeps();

    await expect(updateOutlierThreshold(low, 1)).resolves.toEqual({ kind: 'applied', value: 1 });
    await expect(updateOutlierThreshold(high, 100)).resolves.toEqual({
      kind: 'applied',
      value: 100,
    });
    expect(low.writes).toEqual([1]);
    expect(high.writes).toEqual([100]);
  });

  it('rejects 0 as out-of-range WITHOUT touching the database', async () => {
    const deps = fakeWriteDeps();

    const result = await updateOutlierThreshold(deps, 0);

    expect(result).toEqual({ kind: 'rejected', reason: 'out-of-range' });
    expect(deps.writes).toEqual([]);
  });

  it('rejects 101 as out-of-range WITHOUT touching the database', async () => {
    const deps = fakeWriteDeps();

    const result = await updateOutlierThreshold(deps, 101);

    expect(result).toEqual({ kind: 'rejected', reason: 'out-of-range' });
    expect(deps.writes).toEqual([]);
  });

  it('rejects a fractional 20.5 as not-an-integer WITHOUT touching the database', async () => {
    const deps = fakeWriteDeps();

    const result = await updateOutlierThreshold(deps, 20.5);

    expect(result).toEqual({ kind: 'rejected', reason: 'not-an-integer' });
    expect(deps.writes).toEqual([]);
  });

  it('rejects NaN as not-an-integer WITHOUT touching the database', async () => {
    const deps = fakeWriteDeps();

    const result = await updateOutlierThreshold(deps, Number.NaN);

    expect(result).toEqual({ kind: 'rejected', reason: 'not-an-integer' });
    expect(deps.writes).toEqual([]);
  });

  it('answers unavailable when the write throws — the throw does NOT propagate', async () => {
    const deps = fakeWriteDeps({ throws: true });

    await expect(updateOutlierThreshold(deps, 25)).resolves.toEqual({ kind: 'unavailable' });
    // The write was ATTEMPTED (validation passed) before the port threw.
    expect(deps.writes).toEqual([25]);
  });
});
