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
  if (!isSupportedExponent(format.minorUnitExponent)) {
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

/**
 * Whether a minor-unit exponent can be USED at all — shared by the formatter, the parser, and the
 * delivery boundary that resolves a currency format, so none of the three can disagree about which
 * currencies they are able to handle.
 *
 * EXPORTED for that third caller. A boundary that resolved a `CurrencyFormat` by PRESENCE alone
 * would offer a form whose every submission the parser then answers `'unsupported-exponent'` to —
 * a form that cannot be satisfied, which is exactly what the withholding arm exists to avoid.
 *
 * `minorUnitExponent` is typed `number`, so a fractional, NaN, or Infinite value is reachable from
 * a bad cast or a JSON round-trip — and `BigInt(2.5)` THROWS, which would break this module's
 * central promise that a failure is a returned value rather than an exception. The upper bound is
 * not decoration either: `10n ** BigInt(1e6)` computes a million-digit number and would hang the
 * request.
 */
export function isSupportedExponent(exponent: number): boolean {
  return (
    Number.isInteger(exponent) && exponent >= 0 && exponent <= MAX_MINOR_UNIT_EXPONENT
  );
}

/**
 * Why a major-unit amount could not be converted.
 *
 * `'too-precise'` is held apart from `'malformed'` because the two are different facts about the
 * person's typing and want different copy: `25000.005` is a perfectly well-formed amount that this
 * currency cannot hold, and rounding it away would alter someone's money under them.
 */
export type MajorAmountParseFailure = 'malformed' | 'too-precise' | 'unsupported-exponent';

/** The result of converting typed major units into the boundary's minor-unit decimal string. */
export type MajorAmountParse =
  | { readonly ok: true; readonly amountMinor: string }
  | { readonly ok: false; readonly reason: MajorAmountParseFailure };

/**
 * Digits, optional `,` separators BETWEEN digit groups, and an optional fraction — anchored.
 *
 * Anchored on both ends, and that is doing real work in both directions: without `^`, `-1` matches
 * at index 1 and a negative amount converts to a positive one; without `$`, `1.2.3` matches its
 * `1.2` prefix and a typo becomes a plausible salary.
 *
 * Separators are permitted between groups but their SIZE is not enforced. `21,50,000` and
 * `2,150,000` are the same number under two grouping styles, and a parser that also judged the
 * style would refuse an Indian amount typed the western way — a judgement about presentation, in a
 * function whose whole job is conversion. `1,,0`, `,100` and `100,` are still rejected, because
 * those are not groupings of anything.
 *
 * No sign, and that is not a positivity judgement: the sign is simply not part of the grammar a
 * salary form accepts. `0` parses (and `checkSalaryAmount` refuses it) — the one rule this function
 * would be a second copy of if it decided that itself.
 */
const MAJOR_AMOUNT_PATTERN = /^\d+(?:,\d+)*(?:\.\d+)?$/;

/**
 * Zeros at the END of a fraction, which carry no precision at all.
 *
 * `25000.500` at exponent 2 is EXACTLY 2500050 minor units, and refusing it as `'too-precise'`
 * told someone their perfectly representable amount was "more precise than INR records" — a false
 * sentence about a true amount, on the one input this form is entirely about.
 *
 * ANCHORED AT THE END, and only there: `25000.105` is genuinely over-precise and its internal zero
 * is a significant digit, so it must still be refused.
 */
const TRAILING_ZEROS = /0+$/;

/**
 * The longest amount this parser will look at, in characters, measured after trimming.
 *
 * Bounded for the same reason `normalizeSearchTerm` bounds its term and the grouping loop was made
 * iterative: the length is CALLER-CONTROLLED, and an unbounded one is an unbounded amount of work.
 * A 3,000,000-digit string measured 1881ms inside this function — blocking the tab that typed it,
 * and then the server that was handed the same string.
 *
 * 64 is generous by a wide margin rather than tuned. `MAX_AMOUNT_MINOR` is 9223372036854775807 —
 * nineteen digits — so the largest amount this system can store is nineteen major digits at
 * exponent 0, and even written with Indian grouping separators and a four-digit fraction that is
 * about thirty-four characters. Anything past 64 is not a salary anybody typed.
 *
 * Refused as `'malformed'` rather than as its own reason: it is not a statement about precision or
 * about the currency, and the form already words a malformed amount honestly.
 */
export const MAX_MAJOR_AMOUNT_LENGTH = 64;

/**
 * Convert an amount typed in MAJOR units into the minor-unit decimal string the boundary carries —
 * the inverse of `formatMoney`, and never a second money parser. (Law 4 / AD-4)
 *
 * `exponent` is the currency's own `minorUnitExponent`, resolved from the reference table at the
 * delivery boundary and handed in. It is NEVER a hard-coded 100: JPY is exponent 0, so `2500.50`
 * yen has no representation and is refused rather than rounded to `2500`.
 *
 * Exact throughout — string slicing and `BigInt`, no IEEE double anywhere. `21,50,000` at exponent
 * 2 becomes `'215000000'` by appending two zeros to the digits, not by multiplying a float by 100.
 *
 * Total: every input answers with a value.
 */
export function parseMajorAmount(text: string, exponent: number): MajorAmountParse {
  // Checked FIRST, so a caller holding an unreadable currency format is told which of the two
  // things is actually wrong rather than being told their perfectly good typing is malformed.
  if (!isSupportedExponent(exponent)) {
    return { ok: false, reason: 'unsupported-exponent' };
  }

  const trimmed = text.trim();
  // Length BEFORE the pattern, because the pattern is the expensive half: a hostile or accidental
  // paste is refused in constant time rather than being scanned first.
  if (trimmed.length > MAX_MAJOR_AMOUNT_LENGTH) {
    return { ok: false, reason: 'malformed' };
  }
  if (!MAJOR_AMOUNT_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'malformed' };
  }

  // Split at the point rather than reading capture groups: an optional group is `string |
  // undefined` under `noUncheckedIndexedAccess`, and the `?? ''` that would appease it is a branch
  // no input can reach — uncoverable in a module held to 100%, and a guaranteed surviving mutant.
  // The pattern has already established there is at most one point and digits on both sides of it.
  const pointIndex = trimmed.indexOf('.');
  const hasFraction = pointIndex !== -1;
  const majorDigits = (hasFraction ? trimmed.slice(0, pointIndex) : trimmed).replaceAll(',', '');
  const fractionDigits = hasFraction ? trimmed.slice(pointIndex + 1) : '';

  // Trailing zeros are dropped BEFORE precision is judged, and the significant remainder is what is
  // scaled below. They carry no precision — `25000.500` at exponent 2 is exactly 2500050 minor
  // units — so measuring them would refuse an amount this currency holds perfectly, with a sentence
  // claiming it was too precise. `25000.005` is untouched by this and is still refused.
  const significantFraction = fractionDigits.replace(TRAILING_ZEROS, '');

  if (significantFraction.length > exponent) {
    // More precision than the currency has. Never truncated: the money someone typed is not
    // altered under them (the matrix calls this out for `25000.005` and for JPY alike).
    return { ok: false, reason: 'too-precise' };
  }

  // Append the fraction, zero-PADDED ON THE RIGHT to the exponent — `.5` at exponent 2 is 50 minor
  // units, not 5. This concatenation IS the multiplication, done in base 10 on digits.
  const minorDigits = majorDigits + significantFraction.padEnd(exponent, '0');

  // Through `BigInt` so the answer is the canonical decimal string `fromBoundaryMoney` demands:
  // `007` typed at exponent 2 is `'700'`, never `'00700'`, which that parser would refuse.
  return { ok: true, amountMinor: BigInt(minorDigits).toString() };
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
