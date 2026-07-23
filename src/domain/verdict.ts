/**
 * THE verdict sentence (Law 8 / AD-20). There is exactly ONE composer in the whole product, it
 * lives here, and it produces the answer sentence AND both refusal sentences. The card and the
 * copy-answer affordance consume its output UNMODIFIED — a second verdict is how the thing shown on
 * screen and the thing copied to the clipboard begin to disagree about the same figure.
 *
 * No I/O, no clock, no randomness, no imports outside this layer — labels and numbers in, one
 * sentence out. (Law 2 / AD-1) TOTAL: when a piece cannot be rendered (a currency that does not
 * match its format, a malformed date) the answer is `null`, never a sentence with a hole in it and
 * never an exception — the same discipline `formatMoney` and `formatPlainDate` hold to, propagated.
 *
 * Phrasing is NEUTRAL: "the peer median", never "her/his peer median". The `MALE`/`FEMALE` gender
 * value carries no pronoun rule (spec Block-If), so the neutral form is the one the copy uses.
 * Vocabulary is verbatim (Law 3): `peer median`, `as of`, `refusal` — never `snapshot`.
 */

import { formatMoney, type CurrencyFormat, type Money } from './money';
import { formatDistancePct, MIN_PEER_GROUP_SIZE } from './peer-comparison';
import { formatPlainDate, type PlainDate } from './plain-date';

/** The peer group's DISPLAY labels — resolved without an `is_active` filter (AD-16). */
export type PeerGroupLabels = {
  readonly roleName: string;
  readonly levelLabel: string;
  readonly countryName: string;
};

/**
 * Everything the ONE composer needs, discriminated by the same three kinds `comparePeers` returns.
 * The use-case maps its domain result plus the resolved labels and `CurrencyFormat` into this shape;
 * the composer does the formatting (money through `formatMoney`, date through `formatPlainDate`) so
 * the sentence is assembled in exactly one place.
 */
export type VerdictInput =
  | {
      readonly kind: 'answer';
      readonly subjectName: string;
      readonly distancePctTenths: bigint;
      readonly peerMedian: Money;
      readonly currencyFormat: CurrencyFormat;
      readonly n: number;
      readonly group: PeerGroupLabels;
      readonly asOf: PlainDate;
    }
  | {
      readonly kind: 'thin-peer-group';
      readonly n: number;
      readonly group: PeerGroupLabels;
      readonly asOf: PlainDate;
    }
  | {
      readonly kind: 'no-salary-as-of';
      readonly subjectName: string;
      readonly asOf: PlainDate;
    };

/** `"Software Engineer · L4 · India"` — the group's identity in one phrase (DESIGN middle dots). */
function groupLabel(group: PeerGroupLabels): string {
  return `${group.roleName} · ${group.levelLabel} · ${group.countryName}`;
}

/**
 * Where the subject sits, in words: `"8.0% under the peer median"`, `"20.5% over the peer median"`,
 * or `"at the peer median"` when the distance is exactly zero (AD-5). The magnitude is the SIGN-LESS
 * one-decimal form — `formatDistancePct` of the absolute tenths — with the direction carried by the
 * word, so `-80n` reads "8.0% under" rather than "-8.0% under".
 *
 * A THREE-WAY return on sign rather than an early zero-guard plus a shared sign test: with `< 0n`
 * and `> 0n` each guarding their own return, the zero case is the fall-through, and a `<= 0n` /
 * `>= 0n` slip on either comparison renders "0.0% under/over the peer median" for a zero distance —
 * which the zero case pins. A shared sign test after an `=== 0n` early return would leave that slip
 * invisible (it can never see zero).
 */
function positionPhrase(distancePctTenths: bigint): string {
  if (distancePctTenths < 0n) {
    return `${formatDistancePct(-distancePctTenths)}% under the peer median`;
  }
  if (distancePctTenths > 0n) {
    return `${formatDistancePct(distancePctTenths)}% over the peer median`;
  }
  return 'at the peer median';
}

/**
 * The one sentence for a comparison — answer or refusal — or `null` when a component cannot render.
 *
 * The date is formatted first because every arm needs it; a malformed `asOf` propagates as `null`
 * from all three. The answer arm additionally formats the median money and `null`s on a mismatch.
 * The switch is exhaustive over `VerdictInput['kind']`, so there is no unreachable default arm to
 * leave uncovered.
 */
export function composeVerdict(input: VerdictInput): string | null {
  const asOfText = formatPlainDate(input.asOf);
  if (asOfText === null) {
    return null;
  }

  switch (input.kind) {
    case 'answer': {
      const medianText = formatMoney(input.peerMedian, input.currencyFormat);
      if (medianText === null) {
        return null;
      }
      return `${input.subjectName} is ${positionPhrase(input.distancePctTenths)} (${medianText}), based on ${input.n} peers — ${groupLabel(input.group)} — as of ${asOfText}.`;
    }
    case 'thin-peer-group': {
      // The noun agrees with the count: `n === 1` is reachable (the subject alone in-population),
      // and "1 people" is a hole in a sentence that is otherwise exact. The count is unchanged.
      const people = input.n === 1 ? '1 person' : `${input.n} people`;
      return `No comparison — ${groupLabel(input.group)} has only ${people} as of ${asOfText}. A fair comparison needs at least ${MIN_PEER_GROUP_SIZE}.`;
    }
    case 'no-salary-as-of':
      return `No comparison — ${input.subjectName} has no salary on record as of ${asOfText}.`;
  }
}
