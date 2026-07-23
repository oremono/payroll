import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import type { OutlierFindingsVM, OutlierRow, OutlierSection } from '@/ui/outlier-findings-vm';

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

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="sticky top-0 bg-surface-card">
              <th scope="col" className="py-2 pr-3 text-label-caps uppercase text-ink-muted">
                Employee
              </th>
              <th scope="col" className="py-2 pr-3 text-label-caps uppercase text-ink-muted">
                Peer group
              </th>
              <th scope="col" className="py-2 pl-3 text-right text-label-caps uppercase text-ink-muted">
                Peers
              </th>
              <th scope="col" className="py-2 pl-3 text-right text-label-caps uppercase text-ink-muted">
                Distance
              </th>
            </tr>
          </thead>
          {vm.sections.map((section, index) => (
            <SectionBody key={sectionKey(section, index)} section={section} />
          ))}
        </table>
      </div>
    </section>
  );
}

/** A stable key for a section — the label is unique per peer-group triple; index disambiguates. */
function sectionKey(section: OutlierSection, index: number): string {
  return `${index}-${section.label}`;
}

/**
 * One peer-group section as a `<tbody>` — the 2px `border-strong` top rule is the divider DR8 asks
 * for between peer-group sections. An outlier section is one row per flagged member; a thin group is
 * a single full-width inline refusal row.
 */
function SectionBody({ section }: { readonly section: OutlierSection }) {
  if (section.kind === 'refusal') {
    return (
      <tbody className="border-t-2 border-border-strong">
        <tr>
          {/* The inline thin-group refusal (DR8 / AD-16): full-width, flat `refusal-fill`, hairline,
              rounded — a calm statement, never widened, never `role="alert"`, never error-colored. */}
          <td colSpan={4} className="py-2">
            <div className="rounded border border-border-hairline bg-refusal-fill p-3">
              <span className="text-body-md font-medium text-ink-muted">{section.label}</span>{' '}
              <span className="text-body-sm text-ink-muted italic">{section.refusalText}</span>
            </div>
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody className="border-t-2 border-border-strong">
      {section.rows.map((row) => (
        <FindingRow key={row.employeeId} row={row} label={section.label} n={section.n} />
      ))}
    </tbody>
  );
}

/**
 * One 40px finding row: the employee name, the peer-group label, the right-aligned peer count, and
 * the right-aligned amber badge. Numerals are `font-mono`; hover tints the row.
 */
function FindingRow({
  row,
  label,
  n,
}: {
  readonly row: OutlierRow;
  readonly label: string;
  readonly n: number;
}) {
  return (
    <tr className="h-10 hover:bg-surface-tint">
      <td className="py-2 pr-3 text-body-md font-medium text-primary">{row.name}</td>
      <td className="py-2 pr-3 text-body-sm text-ink-muted">{label}</td>
      <td className="py-2 pl-3 text-right font-mono text-number-sm text-ink">{n} peers</td>
      <td className="py-2 pl-3 text-right">
        <OutlierBadge badgeText={row.badgeText} />
      </td>
    </tr>
  );
}

/**
 * The outlier badge (DR4): a small rectangular amber stamp — near-sharp `rounded-sm` (2px), a 1px
 * amber border, mono numerals. The text carries the signed distance AND the direction WORD, so the
 * meaning never rides color alone (WCAG 2.2 AA). Amber means "beyond the threshold", never error.
 */
function OutlierBadge({ badgeText }: { readonly badgeText: string }) {
  return (
    <span className="inline-block rounded-sm border border-amber-badge-border bg-amber-badge-bg px-2 py-0.5 font-mono text-number-sm text-amber-badge-text">
      {badgeText}
    </span>
  );
}
