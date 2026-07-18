import { describe, expect, it } from 'vitest';

import {
  divideRoundHalfUp,
  formatMoney,
  fromBoundaryMoney,
  toBoundaryMoney,
  type CurrencyFormat,
} from '@/domain/money';

// Test-first (Law 1 / AD-23): this spec lands, red, before `src/domain/money.ts` exists.
//
// It mirrors the story's I/O & Edge-Case Matrix row for row, and then adds the boundary cases the
// matrix implies but does not enumerate — the group-size boundaries (a major part whose length is
// an exact multiple of the group size), the zero amount, and the canonical-form rejections. Those
// extras are not padding: each one is the only test that can kill a specific mutant, and the
// domain gate is 100% mutation score, not 100% coverage.
//
// Every format below is a value the delivery boundary would resolve from a `currency` row — the
// domain may import nothing (Law 2), so the exponent, symbol, and grouping style are ARGUMENTS.

const USD: CurrencyFormat = {
  code: 'USD',
  symbol: '$',
  minorUnitExponent: 2,
  groupingStyle: 'WESTERN',
};

const INR: CurrencyFormat = {
  code: 'INR',
  symbol: '₹',
  minorUnitExponent: 2,
  groupingStyle: 'INDIAN',
};

// The anti-hard-coded-100 case (Law 4 / AD-4): JPY has no minor unit at all.
const JPY: CurrencyFormat = {
  code: 'JPY',
  symbol: '¥',
  minorUnitExponent: 0,
  groupingStyle: 'WESTERN',
};

describe('formatMoney', () => {
  it('groups a whole western amount in threes and omits the fraction', () => {
    expect(formatMoney({ amountMinor: 215000000n, currency: 'USD' }, USD)).toBe('$2,150,000 USD');
  });

  it('groups an indian amount as last-three-then-twos', () => {
    expect(formatMoney({ amountMinor: 215000000n, currency: 'INR' }, INR)).toBe('₹21,50,000 INR');
  });

  it('renders a zero-exponent currency with no fraction at all — never a hard-coded 100', () => {
    expect(formatMoney({ amountMinor: 5000000n, currency: 'JPY' }, JPY)).toBe('¥5,000,000 JPY');
  });

  it('renders a non-zero minor part, zero-padded to the exponent', () => {
    expect(formatMoney({ amountMinor: 215000050n, currency: 'USD' }, USD)).toBe(
      '$2,150,000.50 USD',
    );
  });

  it('leads a negative amount with the sign, before the symbol', () => {
    expect(formatMoney({ amountMinor: -100000n, currency: 'USD' }, USD)).toBe('-$1,000 USD');
  });

  it('renders an amount below one major unit with a zero major part', () => {
    expect(formatMoney({ amountMinor: 5n, currency: 'USD' }, USD)).toBe('$0.05 USD');
  });

  it('renders a zero amount without a sign', () => {
    // Kills the `< 0n` -> `<= 0n` boundary mutant on the sign test: at exactly zero the two
    // differ only in whether a `-` is emitted, and `-0n` is indistinguishable from `0n`.
    expect(formatMoney({ amountMinor: 0n, currency: 'USD' }, USD)).toBe('$0 USD');
  });

  it('does not prefix a separator when the western major part is exactly one group long', () => {
    expect(formatMoney({ amountMinor: 50000n, currency: 'USD' }, USD)).toBe('$500 USD');
  });

  it('does not prefix a separator when the indian major part is exactly three digits', () => {
    expect(formatMoney({ amountMinor: 50000n, currency: 'INR' }, INR)).toBe('₹500 INR');
  });

  it('renders an indian major part shorter than one group', () => {
    expect(formatMoney({ amountMinor: 5n, currency: 'INR' }, INR)).toBe('₹0.05 INR');
  });

  it('groups a four-digit indian major part with a single leading pair', () => {
    expect(formatMoney({ amountMinor: 1500000n, currency: 'INR' }, INR)).toBe('₹15,000 INR');
  });

  it('groups a long western major part into repeated threes', () => {
    expect(formatMoney({ amountMinor: 1234567890n, currency: 'USD' }, USD)).toBe(
      '$12,345,678.90 USD',
    );
  });

  it('groups a long indian major part into repeated twos after the last three', () => {
    expect(formatMoney({ amountMinor: 1234567890n, currency: 'INR' }, INR)).toBe(
      '₹1,23,45,678.90 INR',
    );
  });

  it('returns null when the money currency does not match the format code', () => {
    // Total, never a throw (Law 2): a mismatch is a value, so it can never render silently wrong.
    expect(formatMoney({ amountMinor: 100n, currency: 'USD' }, INR)).toBeNull();
  });

  it('returns null for a negative minor-unit exponent', () => {
    expect(
      formatMoney({ amountMinor: 100n, currency: 'USD' }, { ...USD, minorUnitExponent: -1 }),
    ).toBeNull();
  });

  it('formats at exponent 0, the lower bound of the valid range', () => {
    expect(
      formatMoney({ amountMinor: 1500n, currency: 'USD' }, { ...USD, minorUnitExponent: 0 }),
    ).toBe('$1,500 USD');
  });

  it('formats at exponent 4, the largest exponent ISO-4217 defines', () => {
    expect(
      formatMoney({ amountMinor: 15000n, currency: 'USD' }, { ...USD, minorUnitExponent: 4 }),
    ).toBe('$1.5000 USD');
  });

  it('returns null for an exponent above the ISO-4217 maximum', () => {
    // Not cosmetic: `10n ** BigInt(1e6)` would compute a million-digit number and hang the caller.
    expect(
      formatMoney({ amountMinor: 100n, currency: 'USD' }, { ...USD, minorUnitExponent: 5 }),
    ).toBeNull();
  });

  it('returns null for a fractional exponent rather than throwing', () => {
    // `BigInt(2.5)` raises a RangeError. The guard is what keeps this function total (Law 2).
    expect(
      formatMoney({ amountMinor: 100n, currency: 'USD' }, { ...USD, minorUnitExponent: 2.5 }),
    ).toBeNull();
  });

  it('returns null for a NaN exponent rather than throwing', () => {
    expect(
      formatMoney({ amountMinor: 100n, currency: 'USD' }, { ...USD, minorUnitExponent: Number.NaN }),
    ).toBeNull();
  });

  it('returns null for an infinite exponent rather than throwing', () => {
    expect(
      formatMoney(
        { amountMinor: 100n, currency: 'USD' },
        { ...USD, minorUnitExponent: Number.POSITIVE_INFINITY },
      ),
    ).toBeNull();
  });

  it('rejects a call made without a CurrencyFormat at compile time', () => {
    // Law 4 / AD-4: "there is exactly one money formatter; it requires both fields — a call
    // without a currency must not typecheck." The assertion here is the COMPILER, not the
    // runtime: an unused `@ts-expect-error` is itself a type error, so this line only survives
    // `npm run typecheck` if the call below is genuinely rejected. The closure is deliberately
    // never invoked — calling it would be undefined behaviour, not a specified one.
    const currencyLessCall = (): unknown =>
      // @ts-expect-error - formatMoney requires its CurrencyFormat argument.
      formatMoney({ amountMinor: 1n, currency: 'USD' });

    expect(currencyLessCall).toBeTypeOf('function');
  });

  // Totality is this module's central promise, and `fromBoundaryMoney` will hand back a Money of
  // ANY magnitude — a boundary payload carries `amountMinor` as an unbounded decimal string, so
  // the digit count is caller-controlled. Grouping the major part by recursing once per group
  // makes stack depth proportional to that count, and a stack overflow is a `RangeError` that
  // escapes the domain: the one failure mode this file is built to make impossible.
  //
  // 90,000 digits is ~30,000 groups, comfortably past Node's default frame budget. WESTERN and
  // INDIAN both, because they recurse through different call sites.
  //
  // These two assert only that no `RangeError` escapes — they are NOT a performance guard. Grouping
  // was quadratic once (`unshift` per group: 245ms here, 28.7s at a million digits) and these tests
  // passed the whole time. A timing assertion would be flaky in CI, so the linearity of
  // `groupRightToLeft` rests on its implementation comment, not on this suite.
  it('formats an absurdly long amount without exhausting the stack (WESTERN)', () => {
    const money = { amountMinor: BigInt('1'.repeat(90_000)), currency: 'USD' };

    const formatted = formatMoney(money, USD);

    expect(formatted).toMatch(/^\$1(,111)*\.11 USD$/);
  });

  it('formats an absurdly long amount without exhausting the stack (INDIAN)', () => {
    const money = { amountMinor: BigInt('1'.repeat(90_000)), currency: 'INR' };

    const formatted = formatMoney(money, INR);

    expect(formatted).toMatch(/^₹1(,11)*,111\.11 INR$/);
  });
});

describe('toBoundaryMoney', () => {
  it('serializes amountMinor as a decimal string, never a number or a bigint', () => {
    expect(toBoundaryMoney({ amountMinor: 215000000n, currency: 'INR' })).toEqual({
      amountMinor: '215000000',
      currency: 'INR',
    });
  });

  it('keeps the sign on a negative amount', () => {
    expect(toBoundaryMoney({ amountMinor: -1n, currency: 'USD' })).toEqual({
      amountMinor: '-1',
      currency: 'USD',
    });
  });
});

describe('fromBoundaryMoney', () => {
  it('parses a valid decimal string back into a bigint', () => {
    expect(fromBoundaryMoney({ amountMinor: '215000000', currency: 'INR' })).toEqual({
      amountMinor: 215000000n,
      currency: 'INR',
    });
  });

  it('parses a negative decimal string', () => {
    expect(fromBoundaryMoney({ amountMinor: '-1', currency: 'USD' })).toEqual({
      amountMinor: -1n,
      currency: 'USD',
    });
  });

  it('parses zero', () => {
    expect(fromBoundaryMoney({ amountMinor: '0', currency: 'USD' })).toEqual({
      amountMinor: 0n,
      currency: 'USD',
    });
  });

  it('returns null for a fractional string', () => {
    expect(fromBoundaryMoney({ amountMinor: '12.5', currency: 'USD' })).toBeNull();
  });

  it('returns null for exponent notation', () => {
    expect(fromBoundaryMoney({ amountMinor: '1e3', currency: 'USD' })).toBeNull();
  });

  it('returns null for an empty string — BigInt("") is 0n, which would be a silent zero salary', () => {
    expect(fromBoundaryMoney({ amountMinor: '', currency: 'USD' })).toBeNull();
  });

  it('returns null for a non-numeric string', () => {
    expect(fromBoundaryMoney({ amountMinor: 'abc', currency: 'USD' })).toBeNull();
  });

  it('returns null for a padded string — BigInt(" 1 ") is 1n, which would be a silent accept', () => {
    expect(fromBoundaryMoney({ amountMinor: ' 1 ', currency: 'USD' })).toBeNull();
  });

  it('returns null for a leading-zero string, which is not the canonical form', () => {
    expect(fromBoundaryMoney({ amountMinor: '007', currency: 'USD' })).toBeNull();
  });

  it('returns null for a hexadecimal string — BigInt("0x10") is 16n', () => {
    expect(fromBoundaryMoney({ amountMinor: '0x10', currency: 'USD' })).toBeNull();
  });
});

describe('divideRoundHalfUp', () => {
  it('rounds an exact half up rather than to even', () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
  });

  it('returns an exact quotient unchanged', () => {
    expect(divideRoundHalfUp(4n, 2n)).toBe(2n);
  });

  it('rounds a remainder above half up', () => {
    expect(divideRoundHalfUp(5n, 3n)).toBe(2n);
  });

  it('rounds a remainder below half down', () => {
    expect(divideRoundHalfUp(4n, 3n)).toBe(1n);
  });

  it('rounds a negative exact half away from zero — magnitude half-up, sign reapplied (AD-5)', () => {
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
  });

  it('rounds a negative remainder below half toward zero', () => {
    expect(divideRoundHalfUp(-4n, 3n)).toBe(-1n);
  });

  it('normalizes a negative denominator', () => {
    expect(divideRoundHalfUp(5n, -2n)).toBe(-3n);
  });

  it('yields a positive result when both operands are negative', () => {
    expect(divideRoundHalfUp(-5n, -2n)).toBe(3n);
  });

  it('divides zero to zero', () => {
    expect(divideRoundHalfUp(0n, 5n)).toBe(0n);
  });

  it('returns null for a zero denominator rather than throwing', () => {
    expect(divideRoundHalfUp(1n, 0n)).toBeNull();
  });

  it('returns null for a zero numerator over a zero denominator', () => {
    expect(divideRoundHalfUp(0n, 0n)).toBeNull();
  });
});
