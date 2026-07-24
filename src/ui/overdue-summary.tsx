import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import type { OverdueSummaryVM } from '@/ui/overdue-vm';

/**
 * Home's compact overdue count tile — MARKUP ONLY, mirroring `PayrollHeadlineTile`.
 *
 * Every judgement is already made in `overdue-vm.ts` (`buildOverdueSummary`) and proven in
 * `tests/ui/overdue-vm.test.ts`: the count is `report.rows.length` from the SAME `getOverdue` read
 * the surface uses (never a second, clock-reading use-case — AD-22), and the statement names the
 * as-of date, never "currently". This component renders the `OverdueSummaryVM` and decides nothing.
 *
 * A SERVER COMPONENT: read-only ink. The only affordance is a plain drill `<a>` to the Overdue
 * surface, carrying the current as-of. An `unavailable` read renders the shared calm region (a region
 * with a heading, never `role="alert"`, HTTP 200) — the same register as the surface.
 */

const HEADING_ID = 'overdue-summary-heading';
const HEADING = 'Overdue for review';

export function OverdueSummary({
  vm,
  drillHref,
}: {
  readonly vm: OverdueSummaryVM;
  readonly drillHref: string;
}) {
  if (vm.kind === 'unavailable') {
    return (
      <EmployeeUnavailable
        id="home-overdue-unavailable-heading"
        heading={vm.heading}
        statement={vm.statement}
      />
    );
  }

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="rounded border border-border-hairline bg-surface-card p-4"
    >
      <h2 id={HEADING_ID} className="text-label-caps uppercase text-ink-muted">
        {HEADING}
      </h2>
      {/* "N people overdue as of {date}" — the count and its as-of provenance in one statement. */}
      <p className="mt-3 text-body-md text-ink">{vm.statement}</p>
      <p className="mt-3 text-body-sm">
        <a href={drillHref} className="text-ink underline underline-offset-2 hover:text-primary">
          View overdue for review
        </a>
      </p>
    </section>
  );
}
