import { describe, expect, it } from 'vitest';

import { createSeededPrng } from '@/adapters/prng';
import { SEED } from '@/application/seed/config';

// Test-first (Law 1 / AD-23). The PRNG's entire reason to exist is DETERMINISM: the seed's
// population must be byte-reproducible (NFR8), so these tests pin "same seed ⇒ identical sequence",
// "different seeds diverge", and enough distribution sanity that the stream is usable — without
// asserting any particular magic byte, which would pin the algorithm's internals rather than its
// contract. The seed value is imported from `config.ts` (not re-declared) so this suite can never
// drift onto a stale literal the production seed no longer uses.

describe('createSeededPrng — determinism', () => {
  it('produces an identical nextUnit sequence for the same seed', () => {
    const a = createSeededPrng(SEED);
    const b = createSeededPrng(SEED);

    const first = Array.from({ length: 1_000 }, () => a.nextUnit());
    const second = Array.from({ length: 1_000 }, () => b.nextUnit());

    expect(second).toEqual(first);
  });

  it('produces an identical nextBytes sequence for the same seed', () => {
    const a = createSeededPrng(SEED);
    const b = createSeededPrng(SEED);

    expect(Array.from(b.nextBytes(64))).toEqual(Array.from(a.nextBytes(64)));
  });

  it('diverges for different seeds', () => {
    const a = createSeededPrng(SEED);
    const b = createSeededPrng(SEED + 1);

    const first = Array.from({ length: 32 }, () => a.nextUnit());
    const second = Array.from({ length: 32 }, () => b.nextUnit());

    expect(second).not.toEqual(first);
  });

  it('interleaves nextUnit and nextBytes off one shared stream, reproducibly', () => {
    // The id seam (nextBytes) and the salary draws (nextUnit) advance the SAME state, so a fixed
    // interleaving must reproduce exactly — this is the property the whole seed path rests on.
    const draw = (prng: ReturnType<typeof createSeededPrng>) => [
      prng.nextUnit(),
      ...Array.from(prng.nextBytes(10)),
      prng.nextUnit(),
      ...Array.from(prng.nextBytes(3)),
    ];

    expect(draw(createSeededPrng(SEED))).toEqual(draw(createSeededPrng(SEED)));
  });
});

describe('createSeededPrng — nextUnit range and spread', () => {
  it('stays within [0, 1)', () => {
    const prng = createSeededPrng(SEED);
    for (let i = 0; i < 10_000; i += 1) {
      const u = prng.nextUnit();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('has a mean near 0.5 and fills every decile over many draws', () => {
    const prng = createSeededPrng(SEED);
    const N = 50_000;
    const deciles = new Array<number>(10).fill(0);
    let sum = 0;
    for (let i = 0; i < N; i += 1) {
      const u = prng.nextUnit();
      sum += u;
      const bucket = Math.min(9, Math.floor(u * 10));
      deciles[bucket] = (deciles[bucket] ?? 0) + 1;
    }

    expect(sum / N).toBeCloseTo(0.5, 1);
    // A uniform stream lands in every tenth of the range; a stuck or narrow generator would leave
    // one empty. Each decile should hold roughly N/10; assert only that none is starved.
    for (const count of deciles) {
      expect(count).toBeGreaterThan(N / 20);
    }
  });
});

describe('createSeededPrng — nextBytes', () => {
  it('returns exactly the requested number of bytes, each in 0..255', () => {
    const prng = createSeededPrng(SEED);
    for (const count of [0, 1, 3, 4, 10, 17]) {
      const bytes = prng.nextBytes(count);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes).toHaveLength(count);
      for (const byte of bytes) {
        expect(byte).toBeGreaterThanOrEqual(0);
        expect(byte).toBeLessThanOrEqual(255);
      }
    }
  });

  it('fills the whole byte range over a large draw (not stuck on a few values)', () => {
    const prng = createSeededPrng(SEED);
    const seen = new Set(prng.nextBytes(20_000));
    // 256 possible values; a healthy stream sees nearly all of them.
    expect(seen.size).toBeGreaterThan(200);
  });
});
