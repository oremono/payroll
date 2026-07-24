import type { Prng } from '@/application/ports/prng';

/**
 * The seeded-PRNG adapter (AD-14) — the ONLY sanctioned source of randomness in the codebase, and
 * the sole implementation of the `Prng` port.
 *
 * `Math.random` is banned repo-wide by lint (this file is its one exemption — and it needs none: a
 * seeded generator is the whole point). The seed's 10,000-employee population (CAP-11) draws every
 * uniform and every id byte from here, so the same seed yields byte-identical output on every run
 * (NFR8 / NFR1). No wall clock, no `crypto` — nothing enters but the integer seed.
 *
 * ## The algorithm: sfc32, seeded via splitmix32
 *
 * `sfc32` (Chris Doty-Humphrey's Small Fast Counting generator, 32-bit) is a named, well-studied
 * non-cryptographic PRNG with a 128-bit state and excellent statistical quality for simulation use.
 * Its four state words are initialised by running `splitmix32` — a tiny, full-period mixing function
 * — over the seed, which avoids the poor early output sfc32 gives when seeded with correlated or
 * mostly-zero state. A handful of warm-up rounds discards that startup transient.
 *
 * These are NOT cryptographic and must never guard anything secret — reproducibility is the
 * requirement here, which is the exact opposite of unpredictability. Identifiers that must stay
 * opaque use `src/adapters/id.ts` (crypto) in production; only the seed feeds this PRNG's bytes into
 * the id generator, and a reproducible id is precisely what the seed wants.
 */

/** `2^32`, the divisor that maps a uint32 into `[0, 1)`. */
const UINT32_RANGE = 0x1_0000_0000;

/** How many draws to discard after seeding, so the startup transient does not reach the caller. */
const WARMUP_ROUNDS = 15;

const SPLITMIX_INCREMENT = 0x9e37_79b9;
const SPLITMIX_MULT_1 = 0x21f0_aaad;
const SPLITMIX_MULT_2 = 0x735a_2d97;

/**
 * splitmix32 — advance and mix a single 32-bit state word into a well-distributed uint32.
 *
 * Used only to expand one integer seed into sfc32's four state words. `Math.imul` is 32-bit integer
 * multiplication with wraparound (a plain `*` would overflow into a float and lose the low bits);
 * `>>> 0` coerces each intermediate back to an unsigned 32-bit value.
 */
function makeSplitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + SPLITMIX_INCREMENT) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), SPLITMIX_MULT_1);
    z = Math.imul(z ^ (z >>> 15), SPLITMIX_MULT_2);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/**
 * Build a deterministic `Prng` from an integer `seed`. Same seed ⇒ identical `nextUnit`/`nextBytes`
 * sequences forever; different seeds diverge immediately.
 */
export function createSeededPrng(seed: number): Prng {
  const mix = makeSplitmix32(seed);
  // Four 32-bit state words for sfc32, each mixed out of the seed so no two start correlated.
  let a = mix();
  let b = mix();
  let c = mix();
  let d = mix();

  // sfc32: one round advances the 128-bit state and returns a uint32. The shifts/rotations are the
  // generator's defining constants (9, 3, 21/11) — not tunable knobs.
  const nextUint32 = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };

  // Discard the startup transient before any caller-visible draw.
  for (let round = 0; round < WARMUP_ROUNDS; round += 1) {
    nextUint32();
  }

  return {
    nextUnit: () => nextUint32() / UINT32_RANGE,
    nextBytes: (count: number): Uint8Array => {
      const bytes = new Uint8Array(count);
      // One uint32 yields four bytes; pull a fresh word whenever the four are spent. Little-endian
      // extraction, consistent across runs — the exact byte order is immaterial, its DETERMINISM is
      // the whole contract.
      let word = 0;
      let bytesLeftInWord = 0;
      for (let index = 0; index < count; index += 1) {
        if (bytesLeftInWord === 0) {
          word = nextUint32();
          bytesLeftInWord = 4;
        }
        bytes[index] = word & 0xff;
        word >>>= 8;
        bytesLeftInWord -= 1;
      }
      return bytes;
    },
  };
}
