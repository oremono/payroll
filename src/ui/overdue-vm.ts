import type { GetOverdueResult, OverdueRow } from '@/application/use-cases/overdue';
import { formatMoney, fromBoundaryMoney, type CurrencyFormat } from '@/domain/money';
import type { OverduePeriod } from '@/domain/overdue';
import { formatPlainDate, plainDateToIso, type PlainDate } from '@/domain/plain-date';

/**
 * Everything the CAP-10 overdue surface (and Home's compact count) DECIDES, with no React in it.
 *
 * The same split, and the same reason, as `payroll-totals-vm.ts`: no jsdom, no @testing-library, and
 * `src/ui/*.tsx` sits outside the coverage gate. Every judgement — selecting the arm, formatting each
 * row's salary through the ONE money formatter (failing CLOSED to `null`), slicing `report.rows`
 * in-memory into a page + clamping the requested page + composing the status line, and building the
 * `asOf`/`cutoff`/period-label receipts — lives here and is unit-tested, so `overdue-list.tsx` and
 * `overdue-summary.tsx` are left with markup and nothing to get wrong. ONE builder pattern feeds BOTH
 * placements (the surface and the Home tile) so they cannot drift.
 *
 * ## It consumes story 11-1's finalized payload UNMODIFIED (Law 7 / AD-24)
 *
 * `GetOverdueResult` is used exactly as 11-1 finalized it. The builder RE-DERIVES no statistic (Law 2
 * / Law 8): the count is `report.rows.length`, each row's `effectiveFrom` and `salary` arrive
 * computed, and the rows are rendered in the RECEIVED order (oldest record first, then `employeeId`
 * ascending — the domain's ordering). No field is added to the payload and no port is touched.
 *
 * ## In-memory pagination (AD-24 / AD-12)
 *
 * `getOverdue` returns the WHOLE `report.rows` list — no limit/offset echo (adding one would change
 * the contract, forbidden by AD-24). So the surface slices the already-loaded array by a
 * surface-owned `?page=` param and the UI page size, rendering from the CLAMPED page — the "effective
 * vs requested" rule the employees directory established. A page past the end renders the last page,
 * never the requested number.
 *
 * ## Fail CLOSED on money (Law 4 / AD-4, AD-6)
 *
 * Each salary is `formatMoney(fromBoundaryMoney(row.salary), format)`, with `format` resolved from
 * the reference `currencies` list by the row's OWN `currency` code — never re-resolved, never
 * converted. A missing format, an unsupported exponent, or a non-canonical `amountMinor` withholds
 * the figure (`null` → an em dash in the list), never a bare number or a raw `amountMinor` string.
 *
 * The imports are `import type` except `formatMoney`, `fromBoundaryMoney`, `formatPlainDate`, and
 * `plainDateToIso` — pure, total, clock-free domain functions. There is no `Date`, no `Math.random`,
 * no I/O here (Law 2 / Law 6).
 */

/** The heading and statement for the overdue "unavailable" region (the shared `EmployeeUnavailable`
 * register — a region with a heading, never `role="alert"`; project-context § Conventions). The
 * statement names the OUTCOME and no cause — the read layer swallows the reason. */
export const OVERDUE_UNAVAILABLE_HEADING = 'The overdue list could not be read';
export const OVERDUE_UNAVAILABLE_STATEMENT =
  'The overdue list is not readable right now. Nothing has changed.';

/** The calm zero-state statement — a statement, never a celebration (epic-11-context § UX). */
export const OVERDUE_ZERO_STATE = 'No one is overdue for review within the selected period.';

/** How many rows one page of the overdue list shows — a UI-owned constant (the backend returns all). */
export const OVERDUE_PAGE_SIZE = 25;

/**
 * The four preset period chips, in order (epic-11-context § UX: 1y / 18mo / 2y / 3y). A chip is a
 * `months` VALUE, not a separate code path — the resolver and the domain treat 12/18/24/36 like any
 * positive integer; this list is only the chips the control offers and their display labels.
 */
export const PERIOD_PRESETS = [
  { months: 12, label: '1 year' },
  { months: 18, label: '18 months' },
  { months: 24, label: '2 years' },
  { months: 36, label: '3 years' },
] as const;

/**
 * The locale every count on this surface is grouped in, PINNED — the same constant and reasoning as
 * `employee-directory.ts`. Under the ambient locale the same payload reads `9,947` in one place and
 * `9.947` in another; a count is data and does not change meaning with the machine.
 */
const NUMBER_LOCALE = 'en-US';

/** One overdue row as the list component consumes it: the person, the record date (display + machine
 * form), and the salary formatted (or `null` — withheld, fail closed). Keyed on `employeeId`. */
export type OverdueListRow = {
  readonly employeeId: string;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveFromIso: string;
  readonly salary: string | null;
};

/** The provenance receipts every non-unavailable arm carries: the as-of and cutoff dates and the
 * selected period, all formatted for display. */
type OverdueReceipts = {
  readonly asOf: string;
  readonly cutoff: string;
  readonly periodLabel: string;
};

/**
 * The overdue surface as the list component consumes it.
 *
 *   - `unavailable` — the shared calm region's heading + statement.
 *   - `empty` — the calm zero-state statement plus the receipts (an `answer` with no rows is this).
 *   - `answer` — the current page's rows, the total count + its statement, the pager's status line
 *     and effective page/flags, and the receipts.
 */
export type OverdueVM =
  | { readonly kind: 'unavailable'; readonly heading: string; readonly statement: string }
  | ({ readonly kind: 'empty'; readonly statement: string } & OverdueReceipts)
  | ({
      readonly kind: 'answer';
      readonly rows: readonly OverdueListRow[];
      readonly count: number;
      readonly countStatement: string;
      readonly statusLine: string;
      readonly pageNumber: number;
      readonly pageCount: number;
      readonly hasPrevious: boolean;
      readonly hasNext: boolean;
    } & OverdueReceipts);

/** Home's compact count tile as it consumes the SAME read: the count + its statement, or the calm
 * region on unavailable. The count is `report.rows.length` — never a second use-case (AD-22). */
export type OverdueSummaryVM =
  | { readonly kind: 'unavailable'; readonly heading: string; readonly statement: string }
  | { readonly kind: 'count'; readonly count: number; readonly statement: string };

/** A date shown in data: the DESIGN display form, falling back to the canonical ISO (never empty). */
function formatDate(date: PlainDate): string {
  return formatPlainDate(date) ?? plainDateToIso(date);
}

/** A count grouped in the pinned locale. */
function grouped(count: number): string {
  return count.toLocaleString(NUMBER_LOCALE);
}

/**
 * One boundary money to display text, or `null` when it cannot be read (fail closed). The
 * `CurrencyFormat` is resolved by the money's OWN `currency` code (AD-6) — never converted. A missing
 * format, an unsupported exponent, or a non-canonical `amountMinor` all withhold the figure rather
 * than print a partial, bare, or raw amount.
 */
function formatBoundary(
  value: { readonly amountMinor: string; readonly currency: string },
  currencies: readonly CurrencyFormat[],
): string | null {
  const format = currencies.find((candidate) => candidate.code === value.currency);
  if (format === undefined) {
    return null;
  }
  const money = fromBoundaryMoney(value);
  if (money === null) {
    return null;
  }
  return formatMoney(money, format);
}

/** The display label for a selected period: the preset chip's label, a bare month count for a
 * non-preset months value, or the display date for a custom cutoff. */
export function formatOverduePeriodLabel(period: OverduePeriod): string {
  if (period.kind === 'date') {
    return formatDate(period.cutoff);
  }
  const preset = PERIOD_PRESETS.find((candidate) => candidate.months === period.months);
  return preset === undefined ? `${period.months} months` : preset.label;
}

/** `1 person overdue` / `N people overdue` — the vocabulary floor ("overdue"), pluralized. */
function overdueCountLabel(count: number): string {
  return count === 1 ? '1 person overdue' : `${grouped(count)} people overdue`;
}

/** `N people overdue as of {date}` — Home names the as-of date, never "currently" (epic-11-context). */
function overdueCountStatement(count: number, asOfLabel: string): string {
  return `${overdueCountLabel(count)} as of ${asOfLabel}`;
}

/** The EFFECTIVE (clamped) page number: the requested page floored into `1..pageCount`, so a page
 * past the end (or a non-positive/non-integer request) renders a real page, never a lie. */
function effectivePage(requested: number, pageCount: number): number {
  const floored = Number.isFinite(requested) ? Math.trunc(requested) : 1;
  return Math.min(Math.max(floored, 1), pageCount);
}

/** One overdue row formatted for the list — salary fails closed to `null`. */
function toListRow(row: OverdueRow, currencies: readonly CurrencyFormat[]): OverdueListRow {
  return {
    employeeId: row.employeeId,
    name: row.name,
    effectiveFrom: formatDate(row.effectiveFrom),
    effectiveFromIso: plainDateToIso(row.effectiveFrom),
    salary: formatBoundary(row.salary, currencies),
  };
}

/**
 * Build the CAP-10 view-model from story 11-1's `GetOverdueResult`, for the requested `page`.
 *
 * PURE and TOTAL: every input answers with a value, never an exception. `unavailable` returns the
 * module-level heading/statement; an empty population returns the calm zero-state; otherwise the rows
 * are sliced in-memory into the clamped page and formatted (salary fail closed), with the count, the
 * status line, the pager flags, and the receipts.
 */
export function buildOverdue(
  result: GetOverdueResult,
  currencies: readonly CurrencyFormat[],
  page: number,
): OverdueVM {
  if (result.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      heading: OVERDUE_UNAVAILABLE_HEADING,
      statement: OVERDUE_UNAVAILABLE_STATEMENT,
    };
  }

  const { report } = result;
  const receipts: OverdueReceipts = {
    asOf: formatDate(report.asOf),
    cutoff: formatDate(report.cutoff),
    periodLabel: formatOverduePeriodLabel(report.period),
  };

  const count = report.rows.length;
  if (count === 0) {
    return { kind: 'empty', statement: OVERDUE_ZERO_STATE, ...receipts };
  }

  const pageCount = Math.max(1, Math.ceil(count / OVERDUE_PAGE_SIZE));
  const pageNumber = effectivePage(page, pageCount);
  const offset = (pageNumber - 1) * OVERDUE_PAGE_SIZE;
  const pageRows = report.rows.slice(offset, offset + OVERDUE_PAGE_SIZE);

  const firstIndex = offset + 1;
  const lastIndex = offset + pageRows.length;

  return {
    kind: 'answer',
    rows: pageRows.map((row) => toListRow(row, currencies)),
    count,
    countStatement: overdueCountStatement(count, receipts.asOf),
    statusLine:
      `Overdue ${grouped(firstIndex)}–${grouped(lastIndex)} of ${grouped(count)} · ` +
      `Page ${grouped(pageNumber)} of ${grouped(pageCount)}`,
    pageNumber,
    pageCount,
    hasPrevious: pageNumber > 1,
    hasNext: pageNumber < pageCount,
    ...receipts,
  };
}

/**
 * Build Home's compact count from the SAME `getOverdue` read (AD-22): the count is
 * `report.rows.length` — never a second, clock-reading use-case, so Home and the surface cannot
 * disagree. `unavailable` returns the shared calm region.
 */
export function buildOverdueSummary(result: GetOverdueResult): OverdueSummaryVM {
  if (result.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      heading: OVERDUE_UNAVAILABLE_HEADING,
      statement: OVERDUE_UNAVAILABLE_STATEMENT,
    };
  }

  const count = result.report.rows.length;
  return {
    kind: 'count',
    count,
    statement: overdueCountStatement(count, formatDate(result.report.asOf)),
  };
}
