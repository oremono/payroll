import type { GenderGap, GetGenderGapResult } from '@/application/use-cases/gender-gap';
import { formatMoney, fromBoundaryMoney, type CurrencyFormat } from '@/domain/money';
import { formatPlainDate, plainDateToIso } from '@/domain/plain-date';

/**
 * Everything the CAP-7 gender-gap surface DECIDES, with no React in it.
 *
 * 8-2 is the CAP-7 twin of 6-2: this file is the structural mirror of `peer-comparison-vm.ts`. The
 * same split, and the same reason: no jsdom, no @testing-library, and `src/ui/*.tsx` sits outside
 * the coverage gate. Every judgement — selecting the arm, resolving the group's `CurrencyFormat`,
 * formatting the male/female medians and the as-of date, assembling the provenance caption, carrying
 * the `verdict` byte-for-byte, and failing CLOSED to `figures: null` — lives here and is unit-tested,
 * so `gender-gap.tsx` is left with markup and nothing to get wrong.
 *
 * ## It consumes story 8-1's finalized payload UNMODIFIED (Law 7 / AD-24)
 *
 * `GetGenderGapResult` is used exactly as 8-1 finalized it. The builder RE-DERIVES no statistic
 * (Law 2 / Law 8): `verdict`, `gapPct`, `maleN`, `femaleN`, `currency`, `maleMedian`, `femaleMedian`,
 * and `asOf` all arrive computed. The builder only FORMATS money and dates and SELECTS the arm — the
 * same move `peer-comparison-vm` makes. No field is added to the payload and no port is touched.
 *
 * ## The verdict is the spine; figures are honest formatting, not re-derivation
 *
 * `verdict` is the ONE server-composed sentence (`src/domain/verdict.ts`), carried through
 * byte-for-byte on the answer AND the refusal — never reworded, re-cased, or recomposed. It already
 * carries the peer-group DISPLAY labels, the direction word, both counts, and the as-of, so the card
 * renders no separate structured group-label line (the payload's `peerGroup` carries CODES, not
 * labels, AD-9) and the provenance caption uses only the two gender counts + `asOf`. `gapPct` arrives
 * pre-formatted (signed, one decimal); the builder appends `%` and never touches the number.
 *
 * ## Fail CLOSED on money (Law 4 / AD-4, AD-6)
 *
 * Each money figure is `formatMoney(fromBoundaryMoney(field), format)`, with `format` resolved from
 * the reference `currencies` list by the payload's own `currency` code — never re-resolved from a
 * country, never converted (no FX in this epic). If the reference list is empty/unreadable, the code
 * is absent, the exponent is unsupported, or either median is not a canonical minor-unit string,
 * `figures` is `null` and the card degrades to verdict + provenance + copy — never a bare or raw
 * amount. The verdict is a complete server-side string (the use-case returns `unavailable`, not a
 * broken sentence, if the domain could not compose it), so it is always safe to show.
 *
 * The imports are `import type` except `formatMoney`, `fromBoundaryMoney`, `formatPlainDate` and
 * `plainDateToIso` — pure, total, clock-free domain functions, the calling rule `src/ui/README.md`
 * ratified at story 1-6. There is no `Date`, no `Math.random`, no I/O here (Law 2 / Law 6).
 */

/**
 * The heading and statement for the gender-gap slot's "unreadable" region.
 *
 * Distinct from a refusal: a refusal is a first-class answer a gender-thin group earns, styled with
 * the dignity of an answer; "unreadable" means the read itself did not resolve (`not-found` — a race
 * after the identity read resolved — or `unavailable`). The register is the shared
 * `EmployeeUnavailable` one (a region with a heading, never `role="alert"`; project-context
 * § Conventions). The statement names the OUTCOME and no cause — the read layer swallows the reason,
 * so inventing one would be the surface making something up.
 */
export const GENDER_GAP_UNREADABLE_HEADING = 'This gender pay gap could not be read';
export const GENDER_GAP_UNREADABLE_STATEMENT =
  "This employee's gender pay gap is not readable right now. Nothing has changed.";

/** The formatted money + gap figures of an answer, or withheld entirely (`figures: null`) — never partial. */
export type GenderGapFigures = {
  /** `formatMoney(fromBoundaryMoney(maleMedian), format)` — never a bare number (Law 4 / AD-4). */
  readonly maleMedianText: string;
  /** `formatMoney(fromBoundaryMoney(femaleMedian), format)` — never a bare number (Law 4 / AD-4). */
  readonly femaleMedianText: string;
  /** The pre-formatted signed one-decimal `gapPct` with a `%`: `"8.0%"` / `"-8.7%"` / `"0.0%"`. */
  readonly gapText: string;
};

/**
 * The gender gap as the component consumes it.
 *
 *   - `answer` — the card. `verdict` verbatim, `provenanceText` beneath the figures, and `figures`
 *     (the formatted medians + gap) or `null` when the money could not be read (fail closed).
 *   - `refusal` — the refusal panel, same layout slot, carrying its `verdict` verbatim.
 *   - `unreadable` — the shared "unreadable" region, distinct from a refusal.
 */
export type GenderGapVM =
  | { readonly kind: 'answer'; readonly verdict: string; readonly provenanceText: string; readonly figures: GenderGapFigures | null }
  | { readonly kind: 'refusal'; readonly verdict: string }
  | { readonly kind: 'unreadable'; readonly heading: string; readonly statement: string };

/**
 * Build the CAP-7 view-model from story 8-1's `GetGenderGapResult`.
 *
 * PURE and TOTAL: every input answers with a value, never an exception. It selects the arm, formats
 * an answer's figures (failing CLOSED to `figures: null` when either money cannot be read), carries
 * the `verdict` unmodified on the answer and the refusal, and maps `not-found`/`unavailable` to the
 * "unreadable" region.
 */
export function buildGenderGap(
  result: GetGenderGapResult,
  currencies: readonly CurrencyFormat[],
): GenderGapVM {
  switch (result.kind) {
    case 'answer':
      return buildAnswer(result.gap, currencies);
    case 'refusal':
      // A refusal is a full citizen carrying its verdict verbatim (Law 8 / AD-20). The one reason
      // (`insufficient-gender`) names both counts and which gender is short; copy-answer quotes it
      // exactly.
      return { kind: 'refusal', verdict: result.refusal.verdict };
    case 'not-found':
    case 'unavailable':
      return {
        kind: 'unreadable',
        heading: GENDER_GAP_UNREADABLE_HEADING,
        statement: GENDER_GAP_UNREADABLE_STATEMENT,
      };
  }
}

/** The answer arm: verdict + provenance always, figures when both medians read (else `null`). */
function buildAnswer(gap: GenderGap, currencies: readonly CurrencyFormat[]): GenderGapVM {
  return {
    kind: 'answer',
    verdict: gap.verdict,
    // `maleN`, `femaleN` and `asOf` all arrive on the payload; the caption re-derives none. The ISO
    // form is the honest fallback when the month is out of range (the `as-of-control` idiom), never
    // `null`.
    provenanceText: `Based on ${gap.maleN} men and ${gap.femaleN} women as of ${formatPlainDate(gap.asOf) ?? plainDateToIso(gap.asOf)}`,
    figures: buildFigures(gap, currencies),
  };
}

/**
 * The formatted medians + gap figures, or `null` when either money cannot be read (fail closed).
 *
 * The `CurrencyFormat` is resolved by the payload's OWN `currency` code (AD-6) — never a country,
 * never converted. A missing format, an unsupported exponent (caught inside `formatMoney`), or a
 * non-canonical `amountMinor` (caught inside `fromBoundaryMoney`/`formatMoney`) all withhold the
 * WHOLE `figures` object rather than print a partial or bare amount.
 */
function buildFigures(gap: GenderGap, currencies: readonly CurrencyFormat[]): GenderGapFigures | null {
  const format = currencies.find((candidate) => candidate.code === gap.currency);
  if (format === undefined) {
    return null;
  }

  const maleMedianText = formatBoundary(gap.maleMedian, format);
  const femaleMedianText = formatBoundary(gap.femaleMedian, format);
  if (maleMedianText === null || femaleMedianText === null) {
    return null;
  }

  return {
    maleMedianText,
    femaleMedianText,
    // `gapPct` is already a signed one-decimal string (AD-17) — the builder appends `%` only.
    gapText: `${gap.gapPct}%`,
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
