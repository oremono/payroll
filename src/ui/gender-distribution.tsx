import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import type { GenderDistributionRow, GenderDistributionVM } from '@/ui/gender-distribution-vm';

/**
 * The CAP-8 gender-distribution surface — MARKUP ONLY, shared by BOTH surfaces.
 *
 * Every judgement is already made in `gender-distribution-vm.ts` and proven in
 * `tests/ui/gender-distribution.test.ts`: the arm selection, the row mapping, the `hasPeople` flag,
 * and the verbatim `totals`. This component renders the `GenderDistributionVM` and decides nothing —
 * which is why it sits outside the coverage gate and needs no logic test of its own.
 *
 * A SERVER COMPONENT: the surface is read-only ink, computed fresh per request (AD-12). Nothing here
 * is interactive — the bars are decorative (`aria-hidden`) and static, and the only affordance is an
 * optional trailing TEXT drill link. The as-of control in the shell is the page's only interaction.
 *
 * ## One component, two surfaces
 *
 * Gender Insights and the Home pulse render THIS component over the SAME view-model; they differ only
 * in the counts table's visibility (`visuallyHiddenTable`) and the presence of a drill link
 * (`drillHref`). The accessible content is structurally identical on both.
 *
 * ## Color is never the sole carrier (WCAG 2.2 AA)
 *
 * The per-level bar is a horizontal stacked strip — MALE `bg-primary`, FEMALE `bg-secondary`, squared
 * ends, no gridlines, ONE caps `MALE`/`FEMALE` legend — but it is DECORATIVE (`aria-hidden`). Every
 * count is carried by a real `<table>` (`<caption class="sr-only">`, `<th scope="col">` caps headers,
 * mono right-aligned numerals, one row per level in delivered order plus a totals row), fully visible
 * on Gender Insights and `sr-only` on the Home pulse. Each segment's proportion is set from the
 * integer count via `flex-grow`, so the BROWSER computes the split — no percentage is computed in TS
 * or shown (9-1 deliberately omits a percent-female figure). An active-but-empty level (`!hasPeople`)
 * shows an empty `bg-surface-tint` track; the table shows 0/0/0.
 *
 * `rows.length === 0` (`levels: []`) → a calm statement, not an empty table/bar list. Semantic tokens
 * only, light + dark; no hex, no shadow, no tooltip/`title`, no transition, no click target on the
 * bars.
 */

const HEADING_ID = 'gender-distribution-heading';
const HEADING = 'Gender by level';

/** The calm statement when the level axis is empty — a statement, never a celebration. */
const NO_LEVELS_STATEMENT = 'No levels to report.';

export function GenderDistributionChart({
  vm,
  visuallyHiddenTable = false,
  drillHref,
}: {
  readonly vm: GenderDistributionVM;
  readonly visuallyHiddenTable?: boolean;
  readonly drillHref?: string;
}) {
  if (vm.kind === 'unavailable') {
    return (
      <EmployeeUnavailable
        id="gender-distribution-unavailable-heading"
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
      {vm.rows.length === 0 ? (
        // `levels: []` — a calm statement, never an empty table or bar list. No legend either: a
        // MALE/FEMALE key with nothing to key is visual noise.
        <>
          <h2 id={HEADING_ID} className="text-label-caps uppercase text-ink-muted">
            {HEADING}
          </h2>
          <p className="mt-3 text-body-md text-ink">{NO_LEVELS_STATEMENT}</p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-gutter">
            <h2 id={HEADING_ID} className="text-label-caps uppercase text-ink-muted">
              {HEADING}
            </h2>
            {/* The ONE caps legend — no gridlines, no per-segment labels beyond this. Decorative
                alongside the bars; the table is the accessible carrier. Rendered only when there ARE
                bars to legend. */}
            <Legend />
          </div>

          {/* The decorative bar stack — `aria-hidden`, static, no hover/tooltip/click target. */}
          <ol aria-hidden className="mt-4 flex flex-col gap-cell-padding-v">
            {vm.rows.map((row) => (
              <li key={row.levelCode}>
                <LevelBar row={row} />
              </li>
            ))}
          </ol>

          {/* The data — a real table, visible on Gender Insights or `sr-only` on the Home pulse. */}
          <div className={visuallyHiddenTable ? 'sr-only' : 'mt-4 overflow-x-auto'}>
            <CountsTable rows={vm.rows} totals={vm.totals} />
          </div>
        </>
      )}

      {/* The pulse's single drill link — TEXT, not a click target on the bars. */}
      {drillHref === undefined ? null : (
        <p className="mt-4 text-body-sm">
          <a
            href={drillHref}
            className="text-ink underline underline-offset-2 hover:text-primary"
          >
            View gender insights
          </a>
        </p>
      )}
    </section>
  );
}

/** The ONE caps MALE/FEMALE legend — a swatch + its verbatim label (Law 3), never color alone. */
function Legend() {
  return (
    <ul className="flex items-center gap-gutter">
      <li className="flex items-center gap-cell-padding-v">
        <span aria-hidden className="inline-block h-3 w-3 bg-primary" />
        <span className="text-label-caps uppercase text-ink-muted">MALE</span>
      </li>
      <li className="flex items-center gap-cell-padding-v">
        <span aria-hidden className="inline-block h-3 w-3 bg-secondary" />
        <span className="text-label-caps uppercase text-ink-muted">FEMALE</span>
      </li>
    </ul>
  );
}

/**
 * One level's horizontal stacked strip: a MALE `bg-primary` segment and a FEMALE `bg-secondary`
 * segment, each sized by `flexGrow` from the INTEGER count so the browser computes the split (no
 * percentage in TS). Squared ends (no `rounded`), no gridlines, static. An absent gender contributes
 * `flexGrow: 0` and is omitted. A populated-but-zero level (`!hasPeople`) shows an empty
 * `bg-surface-tint` track.
 */
function LevelBar({ row }: { readonly row: GenderDistributionRow }) {
  if (!row.hasPeople) {
    return <div className="h-3 w-full bg-surface-tint" />;
  }

  return (
    <div className="flex h-3 w-full">
      {row.maleN > 0 ? (
        <div className="h-full bg-primary" style={{ flexGrow: row.maleN, flexBasis: 0 }} />
      ) : null}
      {row.femaleN > 0 ? (
        <div className="h-full bg-secondary" style={{ flexGrow: row.femaleN, flexBasis: 0 }} />
      ) : null}
    </div>
  );
}

const HEAD_CELL = 'py-cell-padding-v pr-cell-padding-h text-label-caps uppercase text-ink-muted';
const HEAD_CELL_NUM = 'py-cell-padding-v pl-cell-padding-h text-right text-label-caps uppercase text-ink-muted';
const NUM_CELL = 'py-cell-padding-v pl-cell-padding-h text-right font-mono text-number-sm text-ink';

/**
 * The counts table — the accessible carrier of every number. Real `<thead>`/`<th scope="col">`, a
 * `sr-only` caption, mono right-aligned numerals, one row per level in the delivered order, and a
 * totals row. No count is recomputed here — the payload's `total` and `totals` are rendered verbatim.
 */
function CountsTable({
  rows,
  totals,
}: {
  readonly rows: readonly GenderDistributionRow[];
  readonly totals: { readonly male: number; readonly female: number; readonly total: number };
}) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">
        Gender counts per level across the organization: level, MALE count, FEMALE count, and the
        total, with an organization-wide totals row.
      </caption>
      <thead>
        <tr className="border-b border-border-hairline bg-surface-card">
          <th scope="col" className={HEAD_CELL}>
            Level
          </th>
          <th scope="col" className={HEAD_CELL_NUM}>
            MALE
          </th>
          <th scope="col" className={HEAD_CELL_NUM}>
            FEMALE
          </th>
          <th scope="col" className={HEAD_CELL_NUM}>
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.levelCode} className="border-b border-border-hairline">
            <td className="py-cell-padding-v pr-cell-padding-h text-body-sm text-ink">
              {row.levelLabel}
            </td>
            <td className={NUM_CELL}>{row.maleN}</td>
            <td className={NUM_CELL}>{row.femaleN}</td>
            <td className={NUM_CELL}>{row.total}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-border-strong">
          <th scope="row" className="py-cell-padding-v pr-cell-padding-h text-label-caps uppercase text-ink-muted">
            Total
          </th>
          <td className={NUM_CELL}>{totals.male}</td>
          <td className={NUM_CELL}>{totals.female}</td>
          <td className={NUM_CELL}>{totals.total}</td>
        </tr>
      </tfoot>
    </table>
  );
}
