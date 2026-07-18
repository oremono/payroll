/**
 * The one canonical money type, the one money formatter, its boundary (de)serializer, and the
 * exact half-up integer division every later statistic is built from. (Law 4 / AD-4, AD-5)
 *
 * No I/O, no clock, no randomness, no imports outside this layer — input in, value out. (Law 2 /
 * AD-1) Every function here is TOTAL: a failure is a `null` return, never an exception.
 *
 * Money is integer minor units and an ISO-4217 code, end to end. No MONETARY value is ever a
 * `number` here: a JS double cannot hold ₹1,23,45,678.90 exactly, and the moment one appears the
 * guarantee that "the number shown is the number judged" (AD-5) is gone. `number` appears only for
 * counts of digits — the minor-unit exponent and a group size — and even there it is guarded:
 * `minorUnitExponent` is range-checked before use, because it arrives from outside and `BigInt` of
 * a fractional number THROWS.
 *
 * The minor-unit exponent, symbol, and grouping style are ARGUMENTS, never literals and never
 * looked up: the domain may import nothing, so they are resolved from the `currency` reference row
 * at the delivery boundary and handed in. That is also why `Intl.NumberFormat` is absent — its
 * output depends on the Node ICU build, which makes it non-deterministic across environments
 * (Law 6), and it hard-codes locale conventions this product does not want.
 */

/**
 * The largest minor-unit exponent ISO-4217 defines (4, e.g. CLF). The `currency` reference table
 * CHECKs the same range; this constant is the domain's own guard, because the domain is specified
 * to hold independently of the database.
 */
const MAX_MINOR_UNIT_EXPONENT = 4;

/** A monetary value: integer minor units plus the ISO-4217 code they are denominated in. */
export type Money = {
  readonly amountMinor: bigint;
  readonly currency: string;
};

/**
 * How the major part is separated. `WESTERN` groups uniformly in threes (`2,150,000`); `INDIAN`
 * holds the last three digits apart and groups the remainder in twos (`21,50,000`).
 */
export type GroupingStyle = 'WESTERN' | 'INDIAN';

/**
 * Everything the formatter needs about a currency, resolved from its `currency` row at the
 * boundary. `minorUnitExponent` is 2 for USD/INR and 0 for JPY — never a hard-coded 100.
 */
export type CurrencyFormat = {
  readonly code: string;
  readonly symbol: string;
  readonly minorUnitExponent: number;
  readonly groupingStyle: GroupingStyle;
};

/**
 * Money as it crosses a JSON / Server-Action boundary: `amountMinor` is a DECIMAL STRING, never a
 * JS number (which loses precision past 2^53) and never a raw `bigint` (which `JSON.stringify`
 * refuses outright). (Law 4 / AD-4)
 */
export type BoundaryMoney = {
  readonly amountMinor: string;
  readonly currency: string;
};

/** The one money formatter. Renders `[-]symbol + grouped-major[.fraction] + ' ' + ISO code`.
 *
 * The fraction is omitted when the minor remainder is zero and otherwise zero-padded to the
 * exponent: every DESIGN and mock example renders salaries without decimals, yet suppressing a
 * non-zero minor part would hide money.
 *
 * Total: returns `null` when `money.currency` does not match `format.code`, or when the exponent
 * is not a whole number in `[0, 4]`. All are unreachable in correct code — the boundary resolves
 * the format by the money's own code, and the database CHECKs the exponent — but returning a value
 * rather than throwing means a mismatch can never render silently wrong.
 */
export function formatMoney(money: Money, format: CurrencyFormat): string | null {
  if (money.currency !== format.code) {
    return null;
  }
  // `minorUnitExponent` is typed `number`, so a fractional, NaN, or Infinite value is reachable
  // from a bad cast or a JSON round-trip — and `BigInt(2.5)` THROWS, which would break this
  // module's central promise that a failure is a `null` return. The upper bound is not decoration
  // either: `10n ** BigInt(1e6)` computes a million-digit number and would hang the request.
  if (
    !Number.isInteger(format.minorUnitExponent) ||
    format.minorUnitExponent < 0 ||
    format.minorUnitExponent > MAX_MINOR_UNIT_EXPONENT
  ) {
    return null;
  }

  const negative = money.amountMinor < 0n;
  const magnitude = negative ? -money.amountMinor : money.amountMinor;
  const minorUnitsPerMajor = 10n ** BigInt(format.minorUnitExponent);

  const major = magnitude / minorUnitsPerMajor;
  const minor = magnitude % minorUnitsPerMajor;

  const fraction =
    minor === 0n ? '' : `.${minor.toString().padStart(format.minorUnitExponent, '0')}`;
  const sign = negative ? '-' : '';

  return `${sign}${format.symbol}${groupMajor(major.toString(), format.groupingStyle)}${fraction} ${format.code}`;
}

/** Serialize money for a JSON / Server-Action boundary (AD-4). Total — every value serializes. */
export function toBoundaryMoney(money: Money): BoundaryMoney {
  return { amountMinor: money.amountMinor.toString(), currency: money.currency };
}

/**
 * Parse money back from a boundary payload. Total: returns `null` when `amountMinor` is not the
 * canonical decimal-string form of an integer.
 *
 * The canonical-form check is not pedantry. `BigInt` is dangerously permissive at exactly the
 * inputs a hostile or buggy caller produces: `BigInt('')` is `0n`, `BigInt(' 1 ')` is `1n`, and
 * `BigInt('0x10')` is `16n`. Accepting any of them would turn malformed input into a plausible
 * salary rather than a rejection.
 */
export function fromBoundaryMoney(value: BoundaryMoney): Money | null {
  const amountMinor = parseCanonicalInteger(value.amountMinor);
  if (amountMinor === null) {
    return null;
  }
  return { amountMinor, currency: value.currency };
}

/**
 * Exact integer division, rounding the MAGNITUDE half-up and reapplying the sign — the rule AD-5
 * states for distance and AD-3 for an even-`n` median. `divideRoundHalfUp(5n, 2n)` is `3n` and
 * `divideRoundHalfUp(-5n, 2n)` is `-3n` (away from zero, never banker's rounding).
 *
 * Total: a zero denominator has no answer, so it returns `null`. No decimal library is involved —
 * `bigint` is exact and adds nothing to the supply chain.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint | null {
  // Normalize to a positive divisor first, so `%` below yields a remainder whose sign follows the
  // numerator and the two rounding tests are symmetric. Negating BOTH operands is exact and
  // leaves the quotient unchanged.
  if (denominator < 0n) {
    return divideRoundHalfUp(-numerator, -denominator);
  }
  if (denominator === 0n) {
    return null;
  }

  // BigInt `/` truncates toward zero, so `quotient` is already the magnitude rounded DOWN with the
  // correct sign; the two tests below decide whether to step one further away from zero.
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twiceRemainder = remainder * 2n;

  if (twiceRemainder >= denominator) {
    return quotient + 1n;
  }
  if (-twiceRemainder >= denominator) {
    return quotient - 1n;
  }
  return quotient;
}

/** Separate the major part according to the currency's grouping style. */
function groupMajor(digits: string, style: GroupingStyle): string {
  if (style === 'WESTERN') {
    return groupRightToLeft(digits, 3);
  }
  // INDIAN: the last three digits stand alone, then the remainder groups in twos — ₹21,50,000.
  if (digits.length <= 3) {
    return digits;
  }
  return `${groupRightToLeft(digits.slice(0, digits.length - 3), 2)},${digits.slice(-3)}`;
}

/**
 * Insert `,` separators right to left, `size` digits per group. The leading group is whatever is
 * left over.
 *
 * ITERATIVE ON PURPOSE. Recursing once per group reads more neatly, but stack depth would then be
 * proportional to the digit count — and the digit count is caller-controlled, because
 * `fromBoundaryMoney` accepts an `amountMinor` string of any length. A long enough amount would
 * overflow the stack, and a `RangeError` escaping this module would break the one guarantee every
 * function here makes: a failure is a `null` return, never an exception. A loop cannot overflow.
 *
 * APPEND-THEN-REVERSE, not `unshift`. The groups are discovered right to left but `unshift` is O(n)
 * per call, which made the loop QUADRATIC in the digit count — 245ms at 90,000 digits and 28.7s at
 * 1,000,000, all of it blocking the event loop. That is the same caller-controlled hang the
 * exponent guard in `formatMoney` exists to prevent, reintroduced on the other input. `push` +
 * a single `reverse()` is linear and byte-identical in output.
 */
function groupRightToLeft(digits: string, size: number): string {
  const groups: string[] = [];
  let end = digits.length;

  while (end > size) {
    groups.push(digits.slice(end - size, end));
    end -= size;
  }
  groups.push(digits.slice(0, end));

  return groups.reverse().join(',');
}

/**
 * `text` as a `bigint`, but only if `text` is already the exact string `BigInt.prototype.toString`
 * would produce for it. Anything else — whitespace, a sign it would not emit, a leading zero, a
 * radix prefix, a fraction, exponent notation, the empty string — is `null`.
 *
 * The `try` is what keeps the caller total: `BigInt` throws a `SyntaxError` on genuinely
 * unparseable input, and that exception stops here rather than crossing the domain boundary.
 */
function parseCanonicalInteger(text: string): bigint | null {
  try {
    const parsed = BigInt(text);
    return parsed.toString() === text ? parsed : null;
  } catch {
    return null;
  }
}
