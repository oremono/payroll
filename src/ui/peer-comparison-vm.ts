import type {
  GetPeerComparisonResult,
  PeerComparison,
} from '@/application/use-cases/peer-comparison';
import { formatMoney, fromBoundaryMoney, type CurrencyFormat } from '@/domain/money';
import { formatPlainDate, plainDateToIso } from '@/domain/plain-date';

/**
 * Everything the CAP-5 peer-comparison surface DECIDES, with no React in it.
 *
 * The same split, and the same reason, as `salary-timeline-vm.ts`: no jsdom, no @testing-library,
 * and `src/ui/*.tsx` sits outside the coverage gate. Every judgement — selecting the arm, resolving
 * the group's `CurrencyFormat`, formatting the money figures and the as-of date, assembling the
 * provenance caption, carrying the `verdict` byte-for-byte, and failing CLOSED to `figures: null` —
 * lives here and is unit-tested, so `peer-comparison.tsx` is left with markup and nothing to get
 * wrong.
 *
 * ## It consumes story 6-1's finalized payload UNMODIFIED (Law 7 / AD-24)
 *
 * `GetPeerComparisonResult` is used exactly as 6-1 finalized it. The builder RE-DERIVES no statistic
 * (Law 2 / Law 8): `verdict`, `distancePct`, `n`, `currency`, `peerMedian`, `spread`, and `asOf` all
 * arrive computed. The builder only FORMATS money and dates and SELECTS the arm — the same move
 * `salary-timeline-vm` makes. No field is added to the payload and no port is touched.
 *
 * ## The verdict is the spine; figures are honest formatting, not re-derivation
 *
 * `verdict` is the ONE server-composed sentence (`src/domain/verdict.ts`), carried through
 * byte-for-byte on the answer AND on both refusals — never reworded, re-cased, or recomposed. It
 * already carries the peer-group DISPLAY labels (`Software Engineer · L4 · India`), the direction
 * word, the median, and the as-of, so the card renders no separate structured peer-group label line
 * (the payload's `peerGroup` carries CODES, not labels) and the provenance caption uses only `n` +
 * `asOf`. `distancePct` arrives pre-formatted (signed, one decimal); the builder appends `%` and
 * never touches the number.
 *
 * ## Fail CLOSED on money (Law 4 / AD-4, AD-6)
 *
 * Each money figure is `formatMoney(fromBoundaryMoney(field), format)`, with `format` resolved from
 * the reference `currencies` list by the payload's own `currency` code — never re-resolved from a
 * country, never converted. If the reference list is empty/unreadable, the code is absent, the
 * exponent is unsupported, or any of median/min/max is not a canonical minor-unit string, `figures`
 * is `null` and the card degrades to verdict + provenance + copy — never a bare or raw amount. The
 * verdict is a complete server-side string (the use-case returns `unavailable`, not a broken
 * sentence, if the domain could not compose it), so it is always safe to show.
 *
 * The imports are `import type` except `formatMoney`, `fromBoundaryMoney`, `formatPlainDate` and
 * `plainDateToIso` — pure, total, clock-free domain functions, the calling rule `src/ui/README.md`
 * ratified at story 1-6. There is no `Date`, no `Math.random`, no I/O here (Law 2 / Law 6).
 */

/** The en dash (U+2013) that joins the spread's min and max — a range, not a subtraction. */
const RANGE_SEPARATOR = ' – ';

/**
 * The heading and statement for the peer slot's "unreadable" region.
 *
 * Distinct from a refusal: a refusal is a first-class answer a thin group earns, styled with the
 * dignity of an answer; "unreadable" means the read itself did not resolve (`not-found` — a race
 * after the identity read resolved — or `unavailable`). The register is the shared
 * `EmployeeUnavailable` one (a region with a heading, never `role="alert"`; project-context
 * § Conventions). The statement names the OUTCOME and no cause — the read layer swallows the reason,
 * so inventing one would be the surface making something up.
 */
export const PEER_COMPARISON_UNREADABLE_HEADING = 'This peer comparison could not be read';
export const PEER_COMPARISON_UNREADABLE_STATEMENT =
  "This employee's peer comparison is not readable right now. Nothing has changed.";

/** The formatted money figures of an answer, or withheld entirely (`figures: null`) — never partial. */
export type PeerFigures = {
  /** `formatMoney(fromBoundaryMoney(peerMedian), format)` — never a bare number (Law 4 / AD-4). */
  readonly peerMedianText: string;
  /** `${minText} – ${maxText}` — the spread as a min–max range (en dash U+2013). */
  readonly rangeText: string;
  /** The pre-formatted signed one-decimal `distancePct` with a `%`: `"-8.0%"` / `"0.0%"` / `"20.5%"`. */
  readonly distanceText: string;
};

/**
 * The peer comparison as the component consumes it.
 *
 *   - `answer` — the card. `verdict` verbatim, `provenanceText` beneath the figure, and `figures`
 *     (the formatted money + distance) or `null` when the money could not be read (fail closed).
 *   - `refusal` — the refusal panel, same layout slot, carrying its `verdict` verbatim.
 *   - `unreadable` — the shared "unreadable" region, distinct from a refusal.
 */
export type PeerComparisonVM =
  | { readonly kind: 'answer'; readonly verdict: string; readonly provenanceText: string; readonly figures: PeerFigures | null }
  | { readonly kind: 'refusal'; readonly verdict: string }
  | { readonly kind: 'unreadable'; readonly heading: string; readonly statement: string };

/**
 * Build the CAP-5 view-model from story 6-1's `GetPeerComparisonResult`.
 *
 * PURE and TOTAL: every input answers with a value, never an exception. It selects the arm, formats
 * an answer's figures (failing CLOSED to `figures: null` when any money cannot be read), carries the
 * `verdict` unmodified on the answer and both refusals, and maps `not-found`/`unavailable` to the
 * "unreadable" region.
 */
export function buildPeerComparison(
  result: GetPeerComparisonResult,
  currencies: readonly CurrencyFormat[],
): PeerComparisonVM {
  switch (result.kind) {
    case 'answer':
      return buildAnswer(result.comparison, currencies);
    case 'refusal':
      // A refusal is a full citizen carrying its verdict verbatim (Law 8 / AD-20). Both reasons
      // (`thin-peer-group`, `no-salary-as-of`) render the same panel; the verdict is where the
      // difference reads, and copy-answer quotes it exactly.
      return { kind: 'refusal', verdict: result.refusal.verdict };
    case 'not-found':
    case 'unavailable':
      return {
        kind: 'unreadable',
        heading: PEER_COMPARISON_UNREADABLE_HEADING,
        statement: PEER_COMPARISON_UNREADABLE_STATEMENT,
      };
  }
}

/** The answer arm: verdict + provenance always, figures when every money reads (else `null`). */
function buildAnswer(
  comparison: PeerComparison,
  currencies: readonly CurrencyFormat[],
): PeerComparisonVM {
  return {
    kind: 'answer',
    verdict: comparison.verdict,
    // `n` and `asOf` both arrive on the payload; the caption re-derives neither. The ISO form is the
    // honest fallback when the month is out of range (the `as-of-control` idiom), never `null`.
    provenanceText: `Based on ${comparison.n} peers as of ${formatPlainDate(comparison.asOf) ?? plainDateToIso(comparison.asOf)}`,
    figures: buildFigures(comparison, currencies),
  };
}

/**
 * The formatted money + distance figures, or `null` when any money cannot be read (fail closed).
 *
 * The `CurrencyFormat` is resolved by the payload's OWN `currency` code (AD-6) — never a country,
 * never converted. A missing format, an unsupported exponent (caught inside `formatMoney`), or a
 * non-canonical `amountMinor` (caught inside `fromBoundaryMoney`/`formatMoney`) all withhold the
 * WHOLE `figures` object rather than print a partial or bare amount.
 */
function buildFigures(
  comparison: PeerComparison,
  currencies: readonly CurrencyFormat[],
): PeerFigures | null {
  const format = currencies.find((candidate) => candidate.code === comparison.currency);
  if (format === undefined) {
    return null;
  }

  const peerMedianText = formatBoundary(comparison.peerMedian, format);
  const minText = formatBoundary(comparison.spread.min, format);
  const maxText = formatBoundary(comparison.spread.max, format);
  if (peerMedianText === null || minText === null || maxText === null) {
    return null;
  }

  return {
    peerMedianText,
    rangeText: `${minText}${RANGE_SEPARATOR}${maxText}`,
    // `distancePct` is already a signed one-decimal string (AD-5) — the builder appends `%` only.
    distanceText: `${comparison.distancePct}%`,
  };
}

/** One boundary money to display text, or `null` when it cannot be read — never a bare number. */
function formatBoundary(
  value: { readonly amountMinor: string; readonly currency: string },
  format: CurrencyFormat,
): string | null {
  const money = fromBoundaryMoney(value);
  if (money === null) {
    return null;
  }
  return formatMoney(money, format);
}
