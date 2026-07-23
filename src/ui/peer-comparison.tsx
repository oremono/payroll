import { CopyAnswer } from '@/ui/copy-answer';
import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import type { PeerComparisonVM, PeerFigures } from '@/ui/peer-comparison-vm';

/**
 * The CAP-5 peer-comparison surface — MARKUP ONLY.
 *
 * Every judgement is already made in `peer-comparison-vm.ts` and proven in
 * `tests/ui/peer-comparison.test.ts`: the arm selection, the formatted figures and date, the
 * provenance caption, the byte-for-byte `verdict`, and the fail-closed `figures: null`. This
 * component renders the `PeerComparisonVM` and decides nothing — which is why it sits outside the
 * coverage gate and needs no logic test of its own.
 *
 * A SERVER COMPONENT: the surface is read-only ink (Law 5 / AD-18). The only interactive thing is
 * `CopyAnswer`, its own `"use client"` island.
 *
 * ## The three visible states, one layout slot
 *
 *   - `answer` — the card. A header row (caps heading + copy button), the verdict sentence, the
 *     peer-median / range / distance figures (mono, right-aligned) when `figures` is present, and
 *     the provenance caption directly beneath. When `figures` is `null` (the group's currency could
 *     not be read) the card degrades to verdict + provenance + copy — never a bare or raw amount.
 *   - `refusal` — a first-class designed state in the SAME slot: the refusal-panel register
 *     (`bg-refusal-fill`, hairline, a region with a heading, never `role="alert"`, never an error
 *     color) rendering the `verdict` verbatim, with the copy button present. A copied refusal is a
 *     full citizen.
 *   - `unreadable` — the shared `EmployeeUnavailable` region, visibly distinct from a refusal. The
 *     detail page short-circuits `unavailable`/`not-found` to `EmployeeUnavailable` directly; this
 *     arm keeps the component TOTAL over the view-model union either way.
 *
 * ## No outlier / status badge, and color carries nothing (CAP-6 concern; WCAG 2.2 AA)
 *
 * DESIGN's mock shows an outlier/status badge, but that is CAP-6/7 (threshold-driven) — CAP-5 never
 * reads the threshold and never renders a pass/fail. The signed `distancePct` is a neutral figure;
 * the direction ("under"/"over"/"at the peer median") rides the unmodified verdict, never a hue —
 * the token system has no red/green, and there are no shadows. Semantic tokens only; no hex literal.
 */

/** The one heading id — only one arm mounts at a time, so the answer and refusal may share it. */
const HEADING_ID = 'peer-comparison-heading';
const HEADING = 'Peer comparison';

export function PeerComparison({ vm }: { readonly vm: PeerComparisonVM }) {
  if (vm.kind === 'unreadable') {
    return (
      <div className="mt-4">
        <EmployeeUnavailable
          id="peer-comparison-unavailable-heading"
          heading={vm.heading}
          statement={vm.statement}
        />
      </div>
    );
  }

  if (vm.kind === 'refusal') {
    return (
      <section
        aria-labelledby={HEADING_ID}
        className="mt-4 rounded border border-border-hairline bg-refusal-fill p-4"
      >
        <Header verdict={vm.verdict} />
        {/* The refusal's verdict names the count (thin group) or the subject + as-of (no salary). */}
        <p className="mt-3 text-body-md text-ink">{vm.verdict}</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="mt-4 rounded border border-border-hairline bg-surface-card p-4"
    >
      <Header verdict={vm.verdict} />

      {/* The verdict sentence — the spine of the card, carrying the group labels, direction word,
          median, and as-of, all composed once server-side and rendered unmodified. */}
      <p className="mt-3 text-body-md text-ink">{vm.verdict}</p>

      {/* Figures when the money reads; withheld entirely otherwise (never a partial or bare amount). */}
      {vm.figures === null ? null : <Figures figures={vm.figures} />}

      {/* Provenance directly beneath the figure (or the verdict when figures are withheld): group
          size + as-of, both from the payload, within one line of the number it describes. */}
      <p className="mt-3 text-body-sm text-ink-muted">{vm.provenanceText}</p>
    </section>
  );
}

/** The caps heading + the copy button, on both the answer and the refusal. */
function Header({ verdict }: { readonly verdict: string }) {
  return (
    <div className="flex items-center justify-between">
      {/* Caps `<h2>`: flat under the page's one `<h1>`, a sibling of the identity and timeline
          sections' `<h2>`. */}
      <h2 id={HEADING_ID} className="text-label-caps text-ink-muted uppercase">
        {HEADING}
      </h2>
      <CopyAnswer verdict={verdict} />
    </div>
  );
}

/**
 * The peer-median, range, and distance figures — labels muted caps, numerals mono and RIGHT-ALIGNED
 * (DESIGN § numeric-typography). A description list: each figure is programmatically associated with
 * its own label. No badge, no color-coded up/down — the sign in the distance carries direction.
 */
function Figures({ figures }: { readonly figures: PeerFigures }) {
  return (
    <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-gutter gap-y-cell-padding-v">
      <Row label="Peer median" value={figures.peerMedianText} />
      <Row label="Range" value={figures.rangeText} />
      <Row label="Distance" value={figures.distanceText} />
    </dl>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <>
      <dt className="text-label-caps text-ink-muted uppercase">{label}</dt>
      <dd className="text-right font-mono text-number-md text-ink">{value}</dd>
    </>
  );
}
