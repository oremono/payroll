import type {
  SalaryTimelineRow,
  SalaryTimelineView,
} from '@/application/use-cases/salary-timeline';
import {
  divideRoundHalfUp,
  formatMoney,
  fromBoundaryMoney,
  type CurrencyFormat,
} from '@/domain/money';
import { formatPlainDate, plainDateToIso, type PlainDate } from '@/domain/plain-date';

/**
 * Everything the DR9 salary-timeline surface DECIDES, with no React in it.
 *
 * The same split, and the same reason, as `salary-change-form.ts`: no jsdom, no @testing-library,
 * and `src/ui/*.tsx` sits outside the coverage gate. Every judgement — resolving each row's money
 * format, formatting the amount and the date, deriving the row-over-row percent, choosing the
 * `(Hire)` marker, and failing CLOSED to `withheld` — lives here and is unit-tested, so
 * `salary-timeline.tsx` is left with markup and nothing to get wrong.
 *
 * ## It consumes story 5-1's fixed payload and adds nothing to the contract (Law 7 / AD-24)
 *
 * `SalaryTimelineView` is used exactly as 5-1 finalized it. `records` arrive NEWEST-FIRST and the
 * builder preserves that order; the head is the current record by that contract, so this file makes
 * no second current-salary determination (AD-8). No field is added to the payload and no port is
 * touched.
 *
 * ## Percent-change is DERIVED here, never stored (DR9)
 *
 * The percent of a row is its change versus the NEXT-OLDER row's amount — both are minor units in
 * the same currency (same exponent), so the ratio is exponent-independent and computed entirely in
 * `bigint` through the domain's one half-up divider (`divideRoundHalfUp`, the AD-5/AD-3 rounding
 * discipline), to zero decimals to match the mock's `+9%`/`+12%`. NO IEEE float touches money here.
 * The oldest row bears `(Hire)` and has no percent. This is a display concern, not a reusable domain
 * statistic, which is why it lives in `src/ui` rather than becoming a second domain number.
 *
 * ## Currency lookup is PER ROW, by the row's own code (AD-6)
 *
 * Each row carries its own `salary.currency`; its `CurrencyFormat` is resolved from the reference
 * `currencies` list, never re-resolved from the employee's country and never converted. In practice
 * one employee's rows share one currency (immutable country), but resolving per row makes a
 * defensive mixed/unknown-currency history fail CLOSED to `withheld` rather than render a bare or
 * wrong figure. An UNKNOWN currency withholds at `resolveRow`; two ADJACENT rows in DIFFERENT
 * (both-resolvable) currencies withhold at the percent step, because a change across two currencies
 * with no FX conversion is not a real figure — the whole timeline withholds rather than print one.
 *
 * The imports are `import type` except `fromBoundaryMoney`, `formatMoney`, `divideRoundHalfUp`,
 * `formatPlainDate` and `plainDateToIso` — pure, total, clock-free domain functions, the calling
 * rule `src/ui/README.md` ratified at story 1-6. There is no `Date`, no `Math.random`, no I/O here
 * (Law 2 / Law 6).
 */

/** How the date is presented: the machine form for `<time dateTime>` and the spelled label beside it. */
export type TimelineDate = {
  /** `plainDateToIso` — `YYYY-MM-DD`. */
  readonly iso: string;
  /** `formatPlainDate` (`16 Jul 2026`), or the ISO form when that is `null` — the same honest fallback the detail page uses. */
  readonly label: string;
};

/**
 * One salary record as the surface renders it. `marker` is the derived DR9 adornment: the oldest row
 * is the `hire`, every newer row carries its signed `change` versus the next-older amount.
 */
export type TimelineRowVM = {
  readonly id: string;
  readonly date: TimelineDate;
  /** `formatMoney(fromBoundaryMoney(salary), format)` — never a bare number (Law 4 / AD-4). */
  readonly amountText: string;
  readonly marker: { readonly kind: 'hire' } | { readonly kind: 'change'; readonly percentText: string };
};

/**
 * The timeline as the component consumes it. `timeline` with `rows: []` is a present employee with
 * an empty history (a dignified empty line, NOT a withholding); `withheld` is a currency the surface
 * cannot read, so no raw amount is shown at all.
 */
export type TimelineVM =
  | { readonly kind: 'timeline'; readonly rows: readonly TimelineRowVM[] }
  | { readonly kind: 'withheld'; readonly statement: string };

/**
 * The statement shown when the timeline is withheld.
 *
 * Mirrors `salary-change-form.ts`'s `CURRENCY_UNREADABLE_STATEMENT` in register — a calm statement
 * that names the OUTCOME and no cause, because several situations reach it (the reference tables
 * could not be read, a row sits on a currency no longer among the active rows, or a currency row
 * carries an exponent the formatter cannot use) and a sentence naming one would be false about the
 * others. It is worded for the READ surface: the amounts cannot be shown, rather than a change
 * cannot be recorded.
 */
export const TIMELINE_CURRENCY_UNREADABLE_STATEMENT =
  'The currency this salary history is recorded in could not be read, so the amounts are not shown.';

/** One row resolved to display strings, keeping the `bigint` amount and its currency for the percent below. */
type ResolvedRow = {
  readonly id: string;
  readonly date: TimelineDate;
  readonly amountText: string;
  readonly amountMinor: bigint;
  /** The row's own currency — the percent step below withholds when two adjacent rows disagree. */
  readonly currency: string;
};

/**
 * Build the DR9 view-model from story 5-1's `SalaryTimelineView`.
 *
 * PURE and TOTAL: every input answers with a value, never an exception. It resolves each row's money
 * (format by the row's own currency → `fromBoundaryMoney` → `formatMoney`) and fails CLOSED to
 * `withheld` the instant any of those three cannot produce a figure — so a bare or wrong amount is
 * never rendered. Otherwise it preserves the newest-first order, derives the row-over-row percent
 * for every row above the oldest, and marks the oldest `(Hire)`.
 */
export function buildSalaryTimeline(
  view: SalaryTimelineView,
  currencies: readonly CurrencyFormat[],
): TimelineVM {
  const withheld: TimelineVM = {
    kind: 'withheld',
    statement: TIMELINE_CURRENCY_UNREADABLE_STATEMENT,
  };

  const resolved: ResolvedRow[] = [];
  for (const record of view.records) {
    const row = resolveRow(record, currencies);
    // A single unreadable row withholds the WHOLE timeline: showing some amounts and hiding one is
    // exactly the half-answer the withholding arm exists to avoid.
    if (row === null) {
      return withheld;
    }
    resolved.push(row);
  }

  const rows: TimelineRowVM[] = [];
  for (let index = 0; index < resolved.length; index += 1) {
    const current = resolved[index];
    // Unreachable — `index` is always in range — but `noUncheckedIndexedAccess` types the access as
    // possibly `undefined`, and `src/ui/*.ts` is under neither the coverage nor the mutation gate,
    // so a defensive guard costs nothing.
    if (current === undefined) {
      continue;
    }

    // The NEXT-OLDER row. Its absence identifies the oldest row (the last element has no `index + 1`)
    // — which also makes a single-record and an empty history fall out for free.
    const older = resolved[index + 1];
    if (older === undefined) {
      rows.push({
        id: current.id,
        date: current.date,
        amountText: current.amountText,
        marker: { kind: 'hire' },
      });
      continue;
    }

    // A percent across two DIFFERENT currencies is meaningless — there is no FX conversion at read
    // time (AD-6). Under the immutable-country invariant this never happens; a defensive breach of it
    // fails CLOSED (the whole timeline withholds) rather than printing a cross-currency ratio.
    if (current.currency !== older.currency) {
      return withheld;
    }

    const percentText = percentChangeText(current.amountMinor, older.amountMinor);
    // `null` only when the older amount is zero — impossible for a stored salary (the domain refuses
    // a non-positive amount), so this fails closed rather than dividing by zero or showing a figure.
    if (percentText === null) {
      return withheld;
    }

    rows.push({
      id: current.id,
      date: current.date,
      amountText: current.amountText,
      marker: { kind: 'change', percentText },
    });
  }

  return { kind: 'timeline', rows };
}

/**
 * One row resolved to its display strings, or `null` when its money cannot be shown.
 *
 * The three ways money can fail to render are each a `null` from a total domain function: the row's
 * currency is not among the reference formats, `amountMinor` is not a canonical integer string, or
 * the format's exponent is one `formatMoney` cannot use. All three withhold — none renders a number.
 */
function resolveRow(row: SalaryTimelineRow, currencies: readonly CurrencyFormat[]): ResolvedRow | null {
  const format = currencies.find((candidate) => candidate.code === row.salary.currency);
  if (format === undefined) {
    return null;
  }

  const money = fromBoundaryMoney(row.salary);
  if (money === null) {
    return null;
  }

  const amountText = formatMoney(money, format);
  if (amountText === null) {
    return null;
  }

  return {
    id: row.id,
    date: timelineDate(row.effectiveFrom),
    amountText,
    amountMinor: money.amountMinor,
    currency: money.currency,
  };
}

/**
 * The signed integer percent of `newMinor` versus `olderMinor`, or `null` when `olderMinor` is zero.
 *
 * All `bigint`: `(newMinor − olderMinor) * 100` divided by `olderMinor`, the magnitude rounded
 * half-up and the sign reapplied by the domain's one divider. `+` for positive, `-` for negative
 * (carried by `bigint.toString()`), `0%` for zero — direction legible without color (WCAG 2.2 AA).
 */
function percentChangeText(newMinor: bigint, olderMinor: bigint): string | null {
  const percent = divideRoundHalfUp((newMinor - olderMinor) * 100n, olderMinor);
  if (percent === null) {
    return null;
  }
  if (percent > 0n) {
    return `+${percent.toString()}%`;
  }
  if (percent < 0n) {
    // `toString()` carries the leading `-` (U+002D); no second sign is prepended.
    return `${percent.toString()}%`;
  }
  return '0%';
}

/** The date as the surface shows it — machine form for `<time>`, spelled label beside it. */
function timelineDate(date: PlainDate): TimelineDate {
  const iso = plainDateToIso(date);
  // `formatPlainDate` is total and answers `null` for a month outside 1..12; the ISO form is the
  // honest fallback, exactly as the detail page's `<time>` does.
  return { iso, label: formatPlainDate(date) ?? iso };
}
