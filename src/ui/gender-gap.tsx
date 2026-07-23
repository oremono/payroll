import { CopyAnswer } from '@/ui/copy-answer';
import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import type { GenderGapFigures, GenderGapVM } from '@/ui/gender-gap-vm';

/**
 * The CAP-7 gender-gap surface — MARKUP ONLY.
 *
 * Every judgement is already made in `gender-gap-vm.ts` and proven in `tests/ui/gender-gap.test.ts`:
 * the arm selection, the formatted medians and date, the provenance caption, the byte-for-byte
 * `verdict`, and the fail-closed `figures: null`. This component renders the `GenderGapVM` and decides
 * nothing — which is why it sits outside the coverage gate and needs no logic test of its own.
 *
 * A SERVER COMPONENT: the surface is read-only ink (Law 5 / AD-18). The only interactive thing is
 * `CopyAnswer`, its own `"use client"` island.
 *
 * Named `GenderGapCard`, not `GenderGap`, to avoid colliding with the use-case's `GenderGap` type.
 *
 * ## The three visible states, one layout slot
 *
 *   - `answer` — the card. A header row (caps heading + copy button), the verdict sentence, the
 *     male-median / female-median / gap figures (mono, right-aligned) when `figures` is present, and
 *     the provenance caption directly beneath. When `figures` is `null` (the group's currency could
 *     not be read) the card degrades to verdict + provenance + copy — never a bare or raw amount.
 *   - `refusal` — a first-class designed state in the SAME slot: the refusal-panel register
 *     (`bg-refusal-fill`, hairline, a region with a heading, never `role="alert"`, never an error
 *     color) rendering the `verdict` verbatim, with the copy button present. A copied refusal is a
 *     full citizen. The verdict names both counts and which gender is short.
 *   - `unreadable` — the shared `EmployeeUnavailable` region, visibly distinct from a refusal. The
 *     detail page short-circuits `unavailable`/`not-found` to `EmployeeUnavailable` directly; this
 *     arm keeps the component TOTAL over the view-model union either way.
 *
 * ## No whole-group median/spread, no badge, and color carries nothing (AD-9; WCAG 2.2 AA)
 *
 * The CAP-5 peer-comparison card already on the page renders the group median and min–max spread;
 * CAP-7 adds only the gender split (duplicating them would fork the ONE median). There is no
 * outlier/status badge (CAP-6/7 threshold concern) and no amber. The signed `gapPct` is a neutral
 * figure; direction (men paid more / women paid more / parity) rides the unmodified verdict, never a
 * hue — the token system has no red/green, and there are no shadows. Semantic tokens only; no hex.
 */

/** The one heading id — only one arm mounts at a time, so the answer and refusal may share it. */
const HEADING_ID = 'gender-gap-heading';
const HEADING = 'Gender pay gap';

export function GenderGapCard({ vm }: { readonly vm: GenderGapVM }) {
  if (vm.kind === 'unreadable') {
    return (
      <div className="mt-4">
        <EmployeeUnavailable
          id="gender-gap-unavailable-heading"
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
        {/* The refusal's verdict names both counts and which gender is short. */}
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
          both counts, and the as-of, all composed once server-side and rendered unmodified. */}
      <p className="mt-3 text-body-md text-ink">{vm.verdict}</p>

      {/* Figures when the money reads; withheld entirely otherwise (never a partial or bare amount). */}
      {vm.figures === null ? null : <Figures figures={vm.figures} />}

      {/* Provenance directly beneath the figures (or the verdict when figures are withheld): both
          gender counts + as-of, all from the payload, within one line of the number it describes. */}
      <p className="mt-3 text-body-sm text-ink-muted">{vm.provenanceText}</p>
    </section>
  );
}

/** The caps heading + the copy button, on both the answer and the refusal. */
function Header({ verdict }: { readonly verdict: string }) {
  return (
    <div className="flex items-center justify-between">
      {/* Caps `<h2>`: flat under the page's one `<h1>`, a sibling of the identity, timeline, and
          peer-comparison sections' `<h2>`. */}
      <h2 id={HEADING_ID} className="text-label-caps text-ink-muted uppercase">
        {HEADING}
      </h2>
      <CopyAnswer verdict={verdict} />
    </div>
  );
}

/**
 * The male-median, female-median, and gap figures — labels muted caps, numerals mono and
 * RIGHT-ALIGNED (DESIGN § numeric-typography). A description list: each figure is programmatically
 * associated with its own label. No badge, no color-coded up/down — the sign in the gap carries
 * direction.
 */
function Figures({ figures }: { readonly figures: GenderGapFigures }) {
  return (
    <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-gutter gap-y-cell-padding-v">
      <Row label="Male median" value={figures.maleMedianText} />
      <Row label="Female median" value={figures.femaleMedianText} />
      <Row label="Gap" value={figures.gapText} />
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
