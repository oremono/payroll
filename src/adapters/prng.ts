/**
 * PRNG adapter — the ONLY source of randomness in the entire codebase.
 *
 * `Math.random` is banned repo-wide (enforced by lint from Story 1-2). Anything that needs
 * randomness — chiefly the seed generator (AD-14) — draws from a seeded PRNG injected as a port, so
 * the output is byte-reproducible from a fixed seed.
 *
 * Story 1-1 sets this seam only. The real implementation (and its `Prng` port in
 * `src/application/ports/`) is wired up in the story that needs it; until then this stub throws.
 */
export function nextRandom(): never {
  throw new Error('prng adapter not implemented in Story 1-1 — wired up in a later story (AD-14)');
}
