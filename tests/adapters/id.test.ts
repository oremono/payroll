import { afterEach, describe, expect, it, vi } from 'vitest';

import { epochMillisUtc } from '@/adapters/clock';
import { createUuidV7Generator, uuidV7Generator } from '@/adapters/id';

// Test-first (Law 1 / AD-23): red before `src/adapters/id.ts` exists.
//
// The id port (AD-10) is implemented ONLY here — the adapters layer is the one place randomness
// and the clock are allowed. `src/domain/**` and `src/application/**` are lint-banned from both.

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.useRealTimers();
});

describe('epochMillisUtc', () => {
  it('reports the current instant in milliseconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 19, 12, 0, 0)));

    expect(epochMillisUtc()).toBe(Date.UTC(2026, 6, 19, 12, 0, 0));
  });

  it('is deliberately NOT part of the Clock port', async () => {
    // The Clock port yields a PlainDate and discards the instant on purpose, so no time-of-day can
    // leak into a calendar comparison. UUIDv7 genuinely needs milliseconds, so it gets its own
    // export in the one file allowed to read `Date` — rather than a second `Date.now()` elsewhere,
    // or a widened port that would hand every caller a clock it must not have.
    const clockModule = await import('@/application/ports/clock');

    expect(Object.keys(clockModule)).not.toContain('epochMillisUtc');
  });
});

describe('uuidV7Generator', () => {
  it('produces a syntactically valid UUIDv7 — version 7, RFC 4122 variant', () => {
    expect(uuidV7Generator.next()).toMatch(UUID_V7_PATTERN);
  });

  it('never repeats an id across a large batch', () => {
    // A collision here would silently merge two employees into one primary key.
    const ids = Array.from({ length: 10_000 }, () => uuidV7Generator.next());

    expect(new Set(ids).size).toBe(10_000);
  });

  it('encodes the generation time in the leading 48 bits', () => {
    vi.useFakeTimers();
    const instant = Date.UTC(2026, 6, 19, 12, 0, 0);
    vi.setSystemTime(new Date(instant));

    const id = uuidV7Generator.next();
    const timestampHex = id.slice(0, 8) + id.slice(9, 13);

    expect(Number.parseInt(timestampHex, 16)).toBe(instant);
  });

  it('sorts lexicographically in generation order, which is the point of v7 over v4', () => {
    const first = createUuidV7Generator(
      () => 1_000_000_000_000,
      () => new Uint8Array(10),
    ).next();
    const later = createUuidV7Generator(
      () => 2_000_000_000_000,
      () => new Uint8Array(10),
    ).next();

    expect(first < later).toBe(true);
  });

  it('is deterministic when its clock and randomness are both injected', () => {
    // Not a production property — the point is that the impurity is confined to two injected
    // functions, which is what makes the two above assertable at all.
    const build = () =>
      createUuidV7Generator(
        () => 1_700_000_000_000,
        () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      ).next();

    expect(build()).toBe(build());
    expect(build()).toMatch(UUID_V7_PATTERN);
  });

  it('does not collide when two ids are drawn within the same millisecond', () => {
    // The timestamp alone is identical here, so uniqueness rests entirely on the random tail.
    const generator = createUuidV7Generator(() => 1_700_000_000_000, undefined);
    const ids = Array.from({ length: 1_000 }, () => generator.next());

    expect(new Set(ids).size).toBe(1_000);
  });
});
