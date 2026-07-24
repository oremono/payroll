/**
 * The seeded-PRNG port (AD-14) — the one randomness seam the pure and application layers may hold.
 *
 * `Math.random` is banned repo-wide by lint and `crypto` randomness is banned in the pure layers;
 * anything that needs randomness — chiefly the seed's population generator (CAP-11) — draws from a
 * `Prng` injected as this port, so its output is byte-reproducible from a fixed seed. The port is
 * declared here and implemented ONLY in `src/adapters/prng.ts` (the single `Math.random`-exempt
 * file, though a seeded PRNG needs none).
 *
 * Two streams off one deterministic source: `nextUnit` for the distribution draws (uniforms feeding
 * Box–Muller), `nextBytes` for the UUIDv7 id seam (fed into `createUuidV7Generator`'s `randomBytes`
 * so ids are reproducible too). Both advance the SAME underlying state, so the whole sequence — id
 * bytes and salary uniforms interleaved — is fixed by the seed alone.
 */
export type Prng = {
  /** Next uniform double in `[0, 1)`. Deterministic given the seed. */
  readonly nextUnit: () => number;
  /** Next `count` deterministic bytes (feeds UUIDv7 `randomBytes`). */
  readonly nextBytes: (count: number) => Uint8Array;
};
