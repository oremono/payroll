/**
 * The as-of date as a VALUE OBJECT: a calendar date with no time, no timezone, and no JS `Date`.
 * (Law 6 / AD-11, AD-19; Conventions — "the as-of date is a plain-date value object, not a JS
 * `Date`".)
 *
 * No I/O, no clock, no randomness, no imports outside this layer — string in, value out. (Law 2 /
 * AD-1) Every function here is TOTAL: a failure is a `null` return, never an exception, because the
 * only thing that ever feeds `parsePlainDate` is a URL search param, i.e. hostile input by default.
 *
 * Why not `Date`: `new Date('2026-07-16')` parses as UTC midnight and then renders in the local
 * zone, so the same stored value is a different calendar day for two readers — which would break
 * the determinism promise outright (same data + same as-of ⇒ same answer). A `{year, month, day}`
 * triple has no such second reading. It is also why the calendar arithmetic below is written out
 * rather than delegated: delegating it would mean constructing a `Date`, and Law 6 bans that here.
 */

/** A calendar date. `month` is 1-based (January is 1), `day` is 1-based. */
export type PlainDate = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

/**
 * Anchored on both ends and fixed-width on every field. The anchors are the whole defence: without
 * them `2026-07-16T00:00:00Z` and ` 2026-07-16` both match a prefix, and `Number('2026-07-16')`
 * is `NaN`, which compares `false` against every bound below and would sail through as a date whose
 * every field is `NaN`.
 */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The twelve month abbreviations, concatenated. A single string rather than an array because array
 * indexing under `noUncheckedIndexedAccess` yields `string | undefined` and would force an
 * unreachable fallback branch into a module held to 100% coverage — `slice` is total for any input
 * and needs no such branch.
 */
const MONTH_ABBREVIATIONS = 'JanFebMarAprMayJunJulAugSepOctNovDec';
const MONTH_ABBREVIATION_LENGTH = 3;

/** January and December — the bounds every function here holds `month` to. */
const FIRST_MONTH = 1;
const LAST_MONTH = 12;

/**
 * The first year that exists. There is no year zero in the proleptic Gregorian calendar this module
 * implements, and — the concrete harm, not the pedantic one — `<input type="date">` cannot hold
 * one, so a `?asOf=0000-01-01` URL rendered a date the picker then showed as blank.
 */
const FIRST_YEAR = 1;

/** The proleptic Gregorian rule, in full: every 4th year, except centuries, except every 400th. */
function isLeapYear(year: number): boolean {
  if (year % 400 === 0) {
    return true;
  }
  if (year % 100 === 0) {
    return false;
  }
  return year % 4 === 0;
}

/** Length of `month` in `year`. Total for any input; only ever called with a 1..12 month. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Parse a canonical `YYYY-MM-DD` string into a `PlainDate`, or `null`.
 *
 * Total. Rejects, in order: any string that is not exactly the ISO shape; a month outside 1..12;
 * and a day outside 1..(length of that month in that year) — so `2026-02-30` and `2026-02-29` are
 * both `null` while `2024-02-29` is a date. `null` is the ONLY failure signal; a caller that needs
 * a value on failure supplies its own (see `resolveAsOf`, which supplies today).
 */
export function parsePlainDate(iso: string): PlainDate | null {
  if (!ISO_DATE_PATTERN.test(iso)) {
    return null;
  }

  // Safe only because the pattern above is anchored and fixed-width: each slice is guaranteed to be
  // exactly the digits of one field.
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));

  if (year < FIRST_YEAR) {
    return null;
  }
  if (month < FIRST_MONTH || month > LAST_MONTH) {
    return null;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return { year, month, day };
}

/**
 * The one display form for a date, per DESIGN: `16 Jul 2026` — zero-padded day, three-letter month,
 * FOUR-DIGIT year. Spelled "as of {this}" everywhere it appears; never "snapshot" (Law 3).
 *
 * `Intl.DateTimeFormat` is deliberately absent for the same reason `Intl.NumberFormat` is absent
 * from `money.ts`: its output depends on the Node ICU build, which makes it non-deterministic
 * across environments (Law 6).
 *
 * TOTAL, and now HONEST about it: returns `null` when `month` is not a whole number in 1..12. This
 * follows `money.ts`'s `formatMoney` exactly (Law 4 / AD-4) — a value that arrives from outside is
 * guarded before use, and a failure is a `null` return, never an exception. `PlainDate` is a
 * structural type, so nothing stops a bad cast, a JSON round-trip, or a hand-built literal from
 * presenting `{month: 13}`, and the consequence was silent: the index ran off the abbreviation
 * table, `slice` (total for any input, which is why it was chosen) returned the empty string, and
 * the function emitted `"15  2026"` — a double space where the month should be, on a date surface,
 * reading exactly like an answer. Unreachable through `parsePlainDate` or `resolveAsOf`, which is
 * the same thing `formatMoney`'s exponent guard is, and it is guarded for the same reason.
 * (Code review 2026-07-19.)
 */
export function formatPlainDate(date: PlainDate): string | null {
  if (
    !Number.isInteger(date.month) ||
    date.month < FIRST_MONTH ||
    date.month > LAST_MONTH
  ) {
    return null;
  }

  const start = (date.month - 1) * MONTH_ABBREVIATION_LENGTH;
  const monthName = MONTH_ABBREVIATIONS.slice(start, start + MONTH_ABBREVIATION_LENGTH);
  return `${padNumber(date.day, 2)} ${monthName} ${padNumber(date.year, 4)}`;
}

/**
 * The canonical machine form, `YYYY-MM-DD` — what the `asOf` URL search param carries and what
 * `parsePlainDate` reads back. `plainDateToIso(parsePlainDate(s))` is the identity on any string
 * `parsePlainDate` accepts, which is what makes a bookmarked URL reproduce a view exactly.
 */
export function plainDateToIso(date: PlainDate): string {
  return `${padNumber(date.year, 4)}-${padNumber(date.month, 2)}-${padNumber(date.day, 2)}`;
}

/**
 * Chronological ordering: negative when `a` is earlier than `b`, positive when later, zero when the
 * same day. The sign is the contract, not the magnitude.
 */
export function comparePlainDate(a: PlainDate, b: PlainDate): number {
  if (a.year !== b.year) {
    return a.year - b.year;
  }
  if (a.month !== b.month) {
    return a.month - b.month;
  }
  return a.day - b.day;
}
