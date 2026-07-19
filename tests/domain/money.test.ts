import { describe, expect, it } from 'vitest';

import {
  divideRoundHalfUp,
  formatMoney,
  fromBoundaryMoney,
  isSupportedExponent,
  MAX_MAJOR_AMOUNT_LENGTH,
  parseMajorAmount,
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

// ── parseMajorAmount (story 4-2) ───────────────────────────────────────────────────────────────
//
// Test-first (Law 1 / AD-23): red before `parseMajorAmount` exists.
//
// This is the 100x-error surface of the whole story. Screen-09 asks for an amount typed in MAJOR
// units (`₹`, `21,50,000`), and `SalaryChangeInput.amountMinor` is a decimal string of MINOR units —
// so something has to multiply, and a conversion that used a hard-coded 100 would be wrong for JPY
// in one direction and for a 4-exponent currency in the other. It lives here, beside the formatter
// it inverts, because `src/ui/**` is outside both the coverage and the mutation gate and this
// arithmetic must be inside both.
//
// The rows below are the story's I/O & Edge-Case Matrix, plus the boundaries the matrix implies:
// a fraction exactly as long as the exponent (the `>` vs `>=` mutant), exponent 0 and exponent 4
// (the range guard's two ends), and every malformed shape separately, because each one kills a
// different regex mutant.
//
// What it deliberately does NOT do: judge. Positivity and MAX_AMOUNT_MINOR belong to
// `checkSalaryAmount`, where story 4-1 put them; a parser that also judged would be a second amount
// validator. `'0'` therefore PARSES — and is refused by the server, which is the matrix row.

describe('parseMajorAmount', () => {
  it('converts a grouped indian amount at exponent 2', () => {
    expect(parseMajorAmount('21,50,000', 2)).toEqual({ ok: true, amountMinor: '215000000' });
  });

  it('converts a grouped western amount at exponent 2', () => {
    expect(parseMajorAmount('2,150,000', 2)).toEqual({ ok: true, amountMinor: '215000000' });
  });

  it('ignores surrounding whitespace (closes deferred #7)', () => {
    expect(parseMajorAmount(' 21,50,000 ', 2)).toEqual({ ok: true, amountMinor: '215000000' });
  });

  it('converts an ungrouped amount', () => {
    expect(parseMajorAmount('2150000', 2)).toEqual({ ok: true, amountMinor: '215000000' });
  });

  it('scales a fraction shorter than the exponent', () => {
    expect(parseMajorAmount('25000.5', 2)).toEqual({ ok: true, amountMinor: '2500050' });
  });

  // The `>` vs `>=` boundary: a fraction EXACTLY as long as the exponent is exact, not over-precise.
  it('accepts a fraction exactly as long as the exponent', () => {
    expect(parseMajorAmount('25000.50', 2)).toEqual({ ok: true, amountMinor: '2500050' });
  });

  it('rejects a fraction longer than the exponent rather than rounding it', () => {
    expect(parseMajorAmount('25000.005', 2)).toEqual({ ok: false, reason: 'too-precise' });
  });

  // Law 4 / AD-4: the exponent comes from the currency reference table, never a hard-coded 100.
  it('converts a whole amount at exponent 0 without scaling it', () => {
    expect(parseMajorAmount('2500', 0)).toEqual({ ok: true, amountMinor: '2500' });
  });

  it('rejects any fraction at exponent 0 — JPY has no minor unit', () => {
    expect(parseMajorAmount('2500.50', 0)).toEqual({ ok: false, reason: 'too-precise' });
  });

  it('scales by four zeros at exponent 4', () => {
    expect(parseMajorAmount('12', 4)).toEqual({ ok: true, amountMinor: '120000' });
  });

  it('parses zero, which the SERVER then refuses — this function converts, it does not judge', () => {
    expect(parseMajorAmount('0', 2)).toEqual({ ok: true, amountMinor: '0' });
  });

  it('normalizes leading zeros to the canonical decimal string', () => {
    expect(parseMajorAmount('007', 2)).toEqual({ ok: true, amountMinor: '700' });
  });

  it('converts an amount far beyond what a double holds exactly', () => {
    expect(parseMajorAmount('90,071,992,547,409.91', 2)).toEqual({
      ok: true,
      amountMinor: '9007199254740991',
    });
  });

  it.each([
    ['the empty string', ''],
    ['whitespace alone', '   '],
    ['letters', 'abc'],
    ['a negative sign, which the grammar has no place for', '-1'],
    ['a plus sign', '+1'],
    ['exponent notation', '1e5'],
    ['two decimal points', '1.2.3'],
    ['a doubled separator', '1,,0'],
    ['a leading separator', ',100'],
    ['a trailing separator', '100,'],
    ['a leading point', '.5'],
    ['a trailing point', '5.'],
    ['an internal space', '21 50 000'],
    ['a currency symbol', '₹2150000'],
  ])('rejects %s as malformed', (_label, text) => {
    expect(parseMajorAmount(text, 2)).toEqual({ ok: false, reason: 'malformed' });
  });

  // The same guard `formatMoney` applies, shared rather than restated: `BigInt(2.5)` THROWS, and
  // `10n ** BigInt(1e6)` computes a million-digit number and would hang the request.
  it.each([
    ['a fractional exponent', 2.5],
    ['a negative exponent', -1],
    ['an exponent past the ISO-4217 maximum', 5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('answers unsupported-exponent for %s', (_label, exponent) => {
    expect(parseMajorAmount('1', exponent)).toEqual({ ok: false, reason: 'unsupported-exponent' });
  });

  // The exponent is checked BEFORE the text, so a caller holding an unreadable currency format is
  // told which of the two is actually wrong.
  it('answers unsupported-exponent for a bad exponent even when the text is also malformed', () => {
    expect(parseMajorAmount('abc', -1)).toEqual({ ok: false, reason: 'unsupported-exponent' });
  });

  // ── Trailing zeros carry no precision ──────────────────────────────────────────────────────
  //
  // `25000.500` at exponent 2 is EXACTLY 2500050 minor units. Refusing it as `'too-precise'` told
  // someone their perfectly representable amount was "more precise than INR records", which is a
  // false sentence about a true amount. Only SIGNIFICANT fraction digits are precision.
  //
  // Each row below kills a different mutant of the trailing-zero strip: one zero versus many, a
  // strip that is not anchored at the end (`25000.105` has an internal zero and must still be
  // refused), and the exponent-0 case where the whole fraction is zeros.

  it('accepts one trailing zero past the exponent as the exact amount it is', () => {
    expect(parseMajorAmount('25000.500', 2)).toEqual({ ok: true, amountMinor: '2500050' });
  });

  it('accepts several trailing zeros past the exponent', () => {
    expect(parseMajorAmount('25000.50000', 2)).toEqual({ ok: true, amountMinor: '2500050' });
  });

  it('accepts a fraction of nothing but zeros past the exponent', () => {
    expect(parseMajorAmount('25000.000', 2)).toEqual({ ok: true, amountMinor: '2500000' });
  });

  it('accepts a zero fraction at exponent 0 — no minor unit is needed to hold it', () => {
    expect(parseMajorAmount('2500.0', 0)).toEqual({ ok: true, amountMinor: '2500' });
  });

  it('still refuses a significant digit past the exponent, trailing zeros or not', () => {
    expect(parseMajorAmount('25000.005', 2)).toEqual({ ok: false, reason: 'too-precise' });
    expect(parseMajorAmount('25000.0050', 2)).toEqual({ ok: false, reason: 'too-precise' });
  });

  // Anchored at the END: an internal zero is a significant digit and does not vanish with the
  // trailing ones.
  it('refuses a fraction whose zeros are internal rather than trailing', () => {
    expect(parseMajorAmount('25000.105', 2)).toEqual({ ok: false, reason: 'too-precise' });
  });

  it('keeps an internal zero when the trailing ones are stripped', () => {
    expect(parseMajorAmount('25000.1000', 2)).toEqual({ ok: true, amountMinor: '2500010' });
  });

  // ── The length ceiling ─────────────────────────────────────────────────────────────────────
  //
  // A caller-controlled input length is a caller-controlled hang, exactly as the exponent guard
  // and the iterative grouping loop already record. A 3,000,000-digit amount spent 1881ms inside
  // this function, blocking the tab that typed it and then the server that was handed it.

  it('accepts an amount exactly at the length ceiling', () => {
    const text = '1'.repeat(MAX_MAJOR_AMOUNT_LENGTH);

    expect(parseMajorAmount(text, 2)).toEqual({ ok: true, amountMinor: `${text}00` });
  });

  it('refuses an amount one character past the ceiling as malformed', () => {
    expect(parseMajorAmount('1'.repeat(MAX_MAJOR_AMOUNT_LENGTH + 1), 2)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  // The ceiling applies to the amount, not to the whitespace around it: trimming happens first, so
  // a padded amount at exactly the ceiling is still accepted.
  it('measures the trimmed amount, not the whitespace around it', () => {
    const text = '1'.repeat(MAX_MAJOR_AMOUNT_LENGTH);

    expect(parseMajorAmount(`   ${text}   `, 2)).toEqual({ ok: true, amountMinor: `${text}00` });
  });

  it('refuses an absurdly long amount without attempting to parse it', () => {
    expect(parseMajorAmount('9'.repeat(100_000), 2)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('sets the ceiling generously above the largest amount the system stores', () => {
    // MAX_AMOUNT_MINOR is 9223372036854775807 — 19 digits — so at exponent 0 the longest storable
    // amount is 19 digits, and grouping separators and a fraction cannot push a real one past this.
    expect(MAX_MAJOR_AMOUNT_LENGTH).toBeGreaterThan(34);
  });
});

// `isSupportedExponent` is exported so the delivery boundary can ask the SAME question the
// formatter and the parser ask, rather than resolving a currency format by presence alone and
// discovering the exponent is unusable only once someone has typed an amount.
describe('isSupportedExponent', () => {
  it.each([0, 1, 2, 4])('accepts the whole exponent %i', (exponent) => {
    expect(isSupportedExponent(exponent)).toBe(true);
  });

  it.each([
    ['a negative exponent', -1],
    ['an exponent past the ISO-4217 maximum', 5],
    ['a fractional exponent', 2.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('refuses %s', (_label, exponent) => {
    expect(isSupportedExponent(exponent)).toBe(false);
  });
});
