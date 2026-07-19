import { randomFillSync } from 'node:crypto';

import type { IdGenerator } from '@/application/ports/id';

import { epochMillisUtc } from './clock';

/**
 * The id adapter (AD-10) — the only implementation of the `IdGenerator` port, and one of the two
 * files in the codebase permitted to reach for randomness.
 *
 * UUIDv7, not v4 and not a database default. The schema declares no `@default` on `employee.id` or
 * `salary_record.id`, and both omissions are deliberate: the id is opaque and appears in URLs, so a
 * sequential id would leak headcount, while a random v4 would scatter inserts across the B-tree and
 * make a 10,000-row import progressively slower as the index fragments. A v7 is random enough to be
 * opaque and time-ordered enough to insert like a sequence.
 *
 * `node:crypto` is used rather than `Math.random`, which lint bans repo-wide (AD-14). The seeded
 * PRNG port is for the SEED's reproducible population, not for identifiers — an id must be
 * unpredictable, and a reproducible id would defeat that.
 *
 * ## Layout (RFC 9562 §5.7)
 *
 *     0                   1                   2                   3
 *     |             unix_ts_ms (48 bits)              | ver |  rand_a |
 *     | var |                  rand_b (62 bits)                       |
 */

/** Bytes after the 48-bit timestamp: 2 carrying the version + rand_a, then 8 of variant + rand_b. */
const RANDOM_BYTE_COUNT = 10;
const TIMESTAMP_BYTE_COUNT = 6;
const UUID_BYTE_COUNT = TIMESTAMP_BYTE_COUNT + RANDOM_BYTE_COUNT;

/** A source of `count` cryptographically random bytes. Injectable so the layout is assertable. */
type RandomBytes = (count: number) => Uint8Array;

function cryptoRandomBytes(count: number): Uint8Array {
  return randomFillSync(new Uint8Array(count));
}

/**
 * Build a UUIDv7 generator over an injected clock and randomness source.
 *
 * Exported so the bit layout can be tested against fixed inputs rather than against whatever the
 * suite happens to draw — the same separation `toUtcPlainDate` uses in the clock adapter. The
 * production generator below is this function applied to the real two.
 */
export function createUuidV7Generator(
  now: () => number = epochMillisUtc,
  randomBytes: RandomBytes = cryptoRandomBytes,
): IdGenerator {
  return {
    next: () => {
      const bytes = new Uint8Array(UUID_BYTE_COUNT);

      // The 48-bit big-endian millisecond timestamp. `BigInt` rather than `>>>`, which is a 32-bit
      // operator and would silently truncate an epoch that has needed 41 bits since 1970.
      let remaining = BigInt(Math.trunc(now()));
      for (let index = TIMESTAMP_BYTE_COUNT - 1; index >= 0; index -= 1) {
        bytes[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
      }

      const random = randomBytes(RANDOM_BYTE_COUNT);
      bytes.set(random.subarray(0, RANDOM_BYTE_COUNT), TIMESTAMP_BYTE_COUNT);

      // Version 7 in the high nibble of byte 6, and the RFC 4122 variant (0b10) in the high two
      // bits of byte 8. Without both, the value is a random 128-bit number that merely looks like
      // a UUID — and the test regex would say so.
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
      ].join('-');
    },
  };
}

/** The generator the composition root injects. */
export const uuidV7Generator: IdGenerator = createUuidV7Generator();
