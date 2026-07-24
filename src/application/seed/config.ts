import type { PlainDate } from '@/domain/plain-date';

/**
 * The fixed, COMMITTED constants that make the seed byte-reproducible (NFR8 / NFR1). They live here —
 * not inline in `prisma/seed.ts` — so the composition root and every test assert against the SAME
 * values: changing a constant can never leave a test silently passing against a stale literal.
 *
 * They are data, not config: no wall clock, no `Date.now()`, no environment. Two runs of the seed
 * with these values produce byte-identical ids, amounts, and dates.
 */

/** The committed PRNG seed. Changing it re-rolls the entire population. */
export const SEED = 0x5eed_1234;

/**
 * The fixed UUIDv7 epoch in milliseconds — 2025-01-01T00:00:00Z. Deliberately not `Date.now()`: the
 * ids encode this instant in their leading 48 bits, so a wall-clock value would make two runs
 * produce different ids and break byte-reproducibility (NFR8).
 */
export const SEED_EPOCH_MS = 1_735_689_600_000;

/**
 * The fixed as-of date every generated hire/effective date sits on or before (AD-18). A committed
 * constant, never "today": the population must be identical on every run regardless of when it runs.
 */
export const SEED_AS_OF: PlainDate = { year: 2026, month: 7, day: 24 };
