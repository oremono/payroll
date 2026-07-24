import Link from 'next/link';

import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import type { OverdueListRow, OverdueVM } from '@/ui/overdue-vm';

/**
 * The CAP-10 overdue-for-review surface — MARKUP ONLY.
 *
 * Every judgement is already made in `overdue-vm.ts` and proven in `tests/ui/overdue-vm.test.ts`:
 * the arm selection, each row's salary formatted (fail closed to `—`), the in-memory pagination slice
 * + clamp + status line, and the `asOf`/`cutoff`/period-label receipts. This component renders the
 * `OverdueVM` and decides nothing — which is why it sits outside the coverage gate and needs no logic
 * test of its own.
 *
 * A SERVER COMPONENT: the list is read-only ink, computed fresh per request (AD-12). The only
 * interactive thing on the page is the period control and the shell's as-of control; the `Export CSV`
 * affordance here is a plain `<a>` to the export Route Handler, and the pager is real `<Link>`s.
 *
 * ## The three visible states
 *
 *   - `answer` — a `<section>` with a heading and the `Export CSV` ghost link, the count statement,
 *     a sticky-header table (one row per overdue employee keyed on `employeeId`: name, the current
 *     record's effective date, its salary), and the in-page pager.
 *   - `empty` — the calm zero-state statement. No graphics, no emoji, no notification affordance.
 *   - `unavailable` — the shared `EmployeeUnavailable` region, a region with a heading, never
 *     `role="alert"`.
 *
 * A withheld salary reads as an em dash (`—`), never a bare or raw amount. Semantic tokens only,
 * light + dark; no hex, no shadow, no `role="alert"`.
 */

const HEADING_ID = 'overdue-heading';
const HEADING = 'Overdue for review';

/** A withheld money figure (fail closed) reads as an em dash, never a bare or raw amount. */
const WITHHELD = '—';

const HEAD_TEXT = 'py-2 pr-3 text-label-caps uppercase text-ink-muted';
const HEAD_NUM = 'py-2 pl-3 text-right text-label-caps uppercase text-ink-muted';

export function OverdueList({
  vm,
  exportHref,
  hrefForPage,
}: {
  readonly vm: OverdueVM;
  readonly exportHref: string;
  /** Build the URL for a page number, preserving `asOf` + `period` — supplied by the composition root. */
  readonly hrefForPage: (page: number) => string;
}) {
  if (vm.kind === 'unavailable') {
    return (
      <EmployeeUnavailable
        id="overdue-unavailable-heading"
        heading={vm.heading}
        statement={vm.statement}
      />
    );
  }

  if (vm.kind === 'empty') {
    return (
      <section
        aria-labelledby={HEADING_ID}
        className="rounded border border-border-hairline bg-surface-card p-4"
      >
        <h2 id={HEADING_ID} className="text-label-caps uppercase text-ink-muted">
          {HEADING}
        </h2>
        {/* A statement, never a celebration (epic-11-context § UX). */}
        <p className="mt-3 text-body-md text-ink">{vm.statement}</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="rounded border border-border-hairline bg-surface-card p-4"
    >
      <div className="flex items-center justify-between gap-gutter">
        <h2 id={HEADING_ID} className="text-label-caps uppercase text-ink-muted">
          {HEADING}
        </h2>
        {/* The CSV export (DR16): a secondary hairline ghost link carrying the current as-of + period
            so the file matches the screen. A plain `<a>` to the export Route Handler — the handler's
            `Content-Disposition: attachment` makes it a download. */}
        <a
          href={exportHref}
          className="rounded border border-border-hairline px-3 py-2 text-body-sm text-ink-muted hover:text-ink"
        >
          Export CSV
        </a>
      </div>

      {/* "N people overdue as of {date}" — Home names the as-of date, and so does the surface. */}
      <p className="mt-2 text-body-md text-ink">{vm.countStatement}</p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Employees overdue for review, oldest record first: the employee, the effective date of
            their current salary record, and that salary in its own currency.
          </caption>
          <thead>
            <tr className="sticky top-0 bg-surface-card">
              <th scope="col" className={HEAD_TEXT}>
                Employee
              </th>
              <th scope="col" className={HEAD_TEXT}>
                Effective date
              </th>
              <th scope="col" className={HEAD_NUM}>
                Salary
              </th>
            </tr>
          </thead>
          <tbody>
            {vm.rows.map((row) => (
              <OverdueRowView key={row.employeeId} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <OverduePager
        pageNumber={vm.pageNumber}
        hasPrevious={vm.hasPrevious}
        hasNext={vm.hasNext}
        statusLine={vm.statusLine}
        hrefForPage={hrefForPage}
      />
    </section>
  );
}

/**
 * One overdue row: the employee name, the current record's effective date (mono, with a
 * machine-readable `<time>`), and the salary (mono, right-aligned; an em dash when withheld).
 */
function OverdueRowView({ row }: { readonly row: OverdueListRow }) {
  return (
    <tr className="h-10 border-b border-border-hairline hover:bg-surface-tint">
      <td className="py-2 pr-3 text-body-md font-medium text-primary">{row.name}</td>
      <td className="py-2 pr-3 font-mono text-number-sm text-ink">
        <time dateTime={row.effectiveFromIso}>{row.effectiveFrom}</time>
      </td>
      <td className="py-2 pl-3 text-right font-mono text-number-sm text-ink">
        {row.salary ?? WITHHELD}
      </td>
    </tr>
  );
}

/**
 * The in-page pager — URL-driven, mirroring `employee-pager.tsx`. Each end is a real `<Link>` to a
 * real URL (`hrefForPage` preserves both `asOf` and `period`), so a page position is shareable and
 * correct under the back button; at an end the control degrades to plain text rather than a link to
 * nowhere. Every number in the status line comes from the VM's EFFECTIVE (clamped) page.
 */
function OverduePager({
  pageNumber,
  hasPrevious,
  hasNext,
  statusLine,
  hrefForPage,
}: {
  readonly pageNumber: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly statusLine: string;
  readonly hrefForPage: (page: number) => string;
}) {
  const END_TEXT = 'rounded border border-border-hairline px-3 py-2 text-body-sm text-ink-faint';
  const LINK = 'rounded border border-input-border bg-surface-card px-3 py-2 text-body-sm text-ink';

  return (
    <nav aria-label="Overdue list pages" className="mt-3 flex items-center gap-3">
      {hasPrevious ? (
        <Link href={hrefForPage(pageNumber - 1)} className={LINK}>
          Previous page
        </Link>
      ) : (
        <span className={END_TEXT}>Previous page</span>
      )}

      <p className="font-mono text-number-sm text-ink-muted">{statusLine}</p>

      {hasNext ? (
        <Link href={hrefForPage(pageNumber + 1)} className={LINK}>
          Next page
        </Link>
      ) : (
        <span className={END_TEXT}>Next page</span>
      )}
    </nav>
  );
}
