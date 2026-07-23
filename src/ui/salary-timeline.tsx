import type { TimelineRowVM, TimelineVM } from '@/ui/salary-timeline-vm';

/**
 * The DR9 salary-timeline surface — MARKUP ONLY.
 *
 * Every judgement is already made in `salary-timeline.ts` and proven in `tests/ui/salary-timeline.test.ts`:
 * the order, the formatted amounts and dates, the row-over-row percent, the `(Hire)` marker, and the
 * fail-closed `withheld`. This component renders the `TimelineVM` and decides nothing — which is why
 * it sits outside the coverage gate and needs no logic test of its own.
 *
 * A SERVER COMPONENT: the surface is read-only ink (Law 5 / AD-18). There is no edit or delete
 * control on any row, no Server Action prop, and the percent chip is a non-interactive `<span>` —
 * display-only, never focusable or selectable (DR9). Nothing here is a control.
 *
 * ## The three visible states
 *
 *   - `withheld` — a statement, no numbers. The section keeps its heading (a region with a heading,
 *     never `role="alert"`; project-context § Conventions), and says only that the amounts cannot be
 *     shown. Distinct from an empty history: one is "we cannot read this", the other "there is
 *     nothing yet".
 *   - `timeline` with no rows — a present employee whose history is empty. DR9 specifies no empty
 *     state (Epic 3 always writes a hire record), so this is a defensive, dignified single line
 *     rather than an empty card or a crash.
 *   - `timeline` with rows — the list, newest-first. Each row shows its effective date (left, in a
 *     `<time>`), its amount-with-currency (right, mono), and either the derived percent chip or the
 *     `(Hire)` label. A hairline divides the rows; there is none after the oldest.
 *
 * ## Color carries nothing (WCAG 2.2 AA)
 *
 * Direction is the signed number in the chip text (`+9%` / `-4%` / `0%`), never a hue — the token
 * system has no red/green, and there are no shadows. Semantic tokens only; no hex literal.
 */

/** The dignified empty line for a present employee with no salary records (see the module header). */
const TIMELINE_EMPTY_STATEMENT = 'No salary records yet.';

export function SalaryTimeline({ vm }: { readonly vm: TimelineVM }) {
  return (
    <section
      aria-labelledby="salary-timeline-heading"
      className="mt-4 rounded border border-border-hairline bg-surface-card p-4"
    >
      {/* Caps `<h2>`: flat under the page's one `<h1>`, a sibling of the identity section's `<h2>`. */}
      <h2 id="salary-timeline-heading" className="text-label-caps text-ink-muted uppercase">
        Salary timeline
      </h2>

      {vm.kind === 'withheld' ? (
        <p className="mt-3 text-body-sm text-ink-muted">{vm.statement}</p>
      ) : vm.rows.length === 0 ? (
        <p className="mt-3 text-body-sm text-ink-muted">{TIMELINE_EMPTY_STATEMENT}</p>
      ) : (
        <ul className="mt-3">
          {vm.rows.map((row) => (
            <TimelineRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One salary record. A 40px row (DR9 `timeline-list`), hairline-divided, no divider after the last. */
function TimelineRow({ row }: { readonly row: TimelineRowVM }) {
  return (
    <li className="flex h-10 items-center justify-between gap-gutter border-b border-border-hairline last:border-b-0">
      <time dateTime={row.date.iso} className="font-mono text-number-sm text-ink-muted">
        {row.date.label}
      </time>

      <div className="flex items-center gap-3">
        {/* Amount right-aligned in the mono face (DR9 `numeric-typography` = `number-md`). */}
        <span className="font-mono text-number-md text-ink">{row.amountText}</span>
        <Marker marker={row.marker} />
      </div>
    </li>
  );
}

/**
 * The derived adornment: the percent chip on a change, the `(Hire)` label on the oldest row.
 *
 * The chip is the DR9 preset-chip, DISPLAY-ONLY: a plain `<span>` with no `tabIndex`, no handler,
 * and no selected state. `surface-tint` fill, a `border-strong` hairline, `ink-muted` text, `sm`
 * corners — the exact `preset-chip` tokens, never a pill and never a color-coded up/down.
 */
function Marker({ marker }: { readonly marker: TimelineRowVM['marker'] }) {
  if (marker.kind === 'hire') {
    // A TEXT label, not a chip — the first record has no prior amount to compare against.
    return <span className="text-body-sm text-ink-muted">(Hire)</span>;
  }

  return (
    <span className="rounded-sm border border-border-strong bg-surface-tint px-2 py-0.5 font-mono text-number-sm text-ink-muted">
      {marker.percentText}
    </span>
  );
}
