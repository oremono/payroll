import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import { OutlierFindingsTable } from '@/ui/outlier-findings-table';
import type { OutlierFindingsVM } from '@/ui/outlier-findings-vm';

/**
 * The CAP-6 findings surface — MARKUP ONLY.
 *
 * Every judgement is already made in `outlier-findings-vm.ts` and proven in
 * `tests/ui/outlier-findings.test.ts`: the arm selection, the amber badge string derived from the
 * signed `distancePct`, the role · level · country label, the peer count, the inline refusal clause,
 * and the zero-state statement. This component renders the `OutlierFindingsVM` and decides nothing —
 * which is why it sits outside the coverage gate and needs no logic test of its own.
 *
 * A SERVER COMPONENT: the findings surface is read-only ink, computed fresh per request (AD-12). The
 * only interactive thing on the page is the global as-of control in the shell; the `Export CSV`
 * affordance here is a plain `<a>` to the export Route Handler, not an island.
 *
 * ## The three visible states
 *
 *   - `findings` — a `<section>` with a heading and the `Export CSV` ghost link at the header's right
 *     end, and a table: a sticky `label-caps` header; each peer-group section (a `<tbody>`) divided
 *     by a 2px rule; outlier rows carry name, the group label, the right-aligned peer count, and the
 *     right-aligned amber badge stating the signed distance and direction IN WORDS (never color
 *     alone, a11y floor); a thin group is a full-width inline refusal row in the same table
 *     (`bg-refusal-fill`, hairline, rounded, an italic clause) — content in a region with a heading,
 *     never `role="alert"`, never error-colored, never widened.
 *   - `empty` — the calm zero-state statement. No graphics, no emoji, no notification affordance.
 *   - `unreadable` — the shared `EmployeeUnavailable` region, visibly distinct from a refusal.
 *
 * Rows carry NO money (DESIGN § findings row): only the distance badge + peer count. Semantic tokens
 * only, light + dark; no hex, no shadow, no `role="alert"`.
 */

const HEADING_ID = 'outlier-findings-heading';
const HEADING = 'Outlier findings';

export function OutlierFindings({
  vm,
  exportHref,
}: {
  readonly vm: OutlierFindingsVM;
  readonly exportHref: string;
}) {
  if (vm.kind === 'unreadable') {
    return (
      <EmployeeUnavailable
        id="outlier-findings-unavailable-heading"
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
        {/* A statement, never a celebration — the sweep's payoff, calm (EXPERIENCE § state patterns). */}
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
        {/* The CSV export (DR16): a secondary hairline ghost link at the header's right end, carrying
            the current as-of so the file matches the screen. A plain `<a>` to the export Route
            Handler — the handler's `Content-Disposition: attachment` makes it a download. */}
        <a
          href={exportHref}
          className="rounded border border-border-hairline px-3 py-2 text-body-sm text-ink-muted hover:text-ink"
        >
          Export CSV
        </a>
      </div>

      {/* The table itself is a client island so its peer-group SECTIONS paginate (DR-scale: the
          sweep can flag hundreds of groups). It renders data already in this payload — no fetch. */}
      <OutlierFindingsTable sections={vm.sections} />
    </section>
  );
}
