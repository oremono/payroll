/**
 * The CAP-7 gender-gap read use-case, and the FINALIZED boundary payload story 8-2 consumes
 * unmodified (Law 7 / AD-24).
 *
 * Orchestration only: resolve the subject, load the as-of gender-gap population by the subject's own
 * triple, hand it to the ONE pure domain (`computeGenderGap`), compose the ONE verdict, and encode
 * money for the boundary. Every judgement is borrowed from `src/domain/**` and every effect goes
 * through the port, so the fast suite covering this touches no database and no clock.
 *
 * ## `asOf` is a parameter, and that is the whole of Law 6 here
 *
 * The clock is read ONCE, at the delivery boundary (story 8-2's page), and the date is passed
 * inward. Nothing here asks what day it is. Same data + same `asOf` ⇒ byte-identical payload (Law 6 /
 * AD-11), which is what makes the as-of control testable at all.
 *
 * ## Every function here is TOTAL (Law 8 / AD-20)
 *
 * A `null` subject is `not-found`; a null population (an unresolvable currency/label), a repository
 * throw, and a verdict that cannot render are all `unavailable`. An insufficient-gender split is a
 * REFUSAL carrying both counts — a return value, never an exception. `not-found` (no such person) and
 * `unavailable` (we could not find out) are deliberately different answers.
 *
 * ## Read-only, fresh per request (Law 5 / AD-18 / AD-2 / AD-12)
 *
 * No write path, no mutation, no route handler. The group is derived fresh here per request and never
 * materialized or cached; the database selects the candidate set and the domain computes every
 * median, gap, and per-gender count a user sees (Law 2).
 */

import type {
  EmployeeRepository,
  GenderGapPopulation,
} from '@/application/ports/employee-repository';
import { computeGenderGap } from '@/domain/gender-gap';
import { toBoundaryMoney, type BoundaryMoney } from '@/domain/money';
import { formatDistancePct } from '@/domain/peer-comparison';
import type { PlainDate } from '@/domain/plain-date';
import { composeVerdict, type PeerGroupLabels, type VerdictInput } from '@/domain/verdict';

/**
 * The `(role, level, country)` codes (provenance) PLUS their display labels — the group's definition
 * (AD-16) and its human-readable naming, resolved without an `is_active` filter so a retired label
 * still names its group.
 */
export type PeerGroupProvenance = {
  readonly roleCode: string;
  readonly levelCode: string;
  readonly countryCode: string;
  readonly roleName: string;
  readonly levelLabel: string;
  readonly countryName: string;
};

/**
 * The answer, carrying its receipts (Law 8 / AD-20): the value AND its provenance in one object — the
 * group definition, both per-gender counts (`>= 5` each by construction, AD-16), the as-of date, and
 * the single currency. Both medians are `BoundaryMoney` decimal strings (Law 4 / AD-4); `gapPct` is a
 * signed one-decimal string (male median the denominator; positive ⇒ men paid more, AD-17); and
 * `verdict` is the ONE composed sentence, included unmodified for the card and copy-answer alike.
 */
export type GenderGap = {
  readonly employeeId: string;
  readonly asOf: PlainDate;
  readonly peerGroup: PeerGroupProvenance;
  readonly maleN: number;
  readonly femaleN: number;
  /** The group's single ISO-4217 code — single-currency by construction, no FX in this epic. */
  readonly currency: string;
  readonly maleMedian: BoundaryMoney;
  readonly femaleMedian: BoundaryMoney;
  /** Signed, one decimal: `"8.0"`, `"-8.7"`, `"0.0"` (AD-17). */
  readonly gapPct: string;
  readonly verdict: string;
};

/**
 * A refusal, a full citizen carrying its counts (Law 8 / AD-20). There is ONE reason —
 * `insufficient-gender` — because `>= 5 of EACH` strictly subsumes the group `n >= 5` rule, so a
 * distinct thin-group arm would be unreachable here. It names BOTH counts and which gender is short;
 * no median was computed. The ONE verdict sentence is quotable exactly as the answer is.
 */
export type GenderGapRefusal = {
  readonly reason: 'insufficient-gender';
  readonly peerGroup: PeerGroupProvenance;
  readonly counts: { readonly male: number; readonly female: number };
  readonly shortGender: 'MALE' | 'FEMALE' | 'BOTH';
  readonly asOf: PlainDate;
  readonly verdict: string;
};

/**
 * The read payload (Law 8 / AD-20). `answer` and `refusal` carry their receipts; `not-found` and
 * `unavailable` are distinct outcomes — one means "no such person", the other "we could not find
 * out". Story 8-2 renders all four and adds nothing to this contract.
 */
export type GetGenderGapResult =
  | { readonly kind: 'answer'; readonly gap: GenderGap }
  | { readonly kind: 'refusal'; readonly refusal: GenderGapRefusal }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/**
 * Injected, never imported: no clock, no Prisma, no id generator. A read needs only the repository —
 * `asOf` arrives per call, as an argument.
 */
export type GenderGapDeps = {
  readonly repository: EmployeeRepository;
};

/** The group's DISPLAY labels for the ONE verdict — resolved `is_active`-inclusively by the read. */
function labelsOf(population: GenderGapPopulation): PeerGroupLabels {
  return {
    roleName: population.roleName,
    levelLabel: population.levelLabel,
    countryName: population.countryName,
  };
}

/**
 * The gender gap for one employee's peer group as of `asOf`.
 *
 * The order is the rule (AD-16 / AD-17): resolve the subject (`null` ⇒ `not-found`); load the
 * population by the subject's OWN triple (`null` ⇒ `unavailable`); run the ONE `computeGenderGap`
 * (as-of split, the 5-of-each gate, the medians and the gap); compose the ONE verdict (`null` ⇒
 * `unavailable`, never a sentence with a hole); then assemble the union, encoding each Money to
 * `BoundaryMoney` and the tenths to a signed one-decimal string.
 *
 * TOTAL: any repository throw is `unavailable`, never an exception across the boundary.
 */
export async function getGenderGap(
  deps: GenderGapDeps,
  employeeId: string,
  asOf: PlainDate,
): Promise<GetGenderGapResult> {
  try {
    const subject = await deps.repository.findEmployeeById(employeeId);
    if (subject === null) {
      return { kind: 'not-found' };
    }

    // The population is loaded by the subject's OWN triple (AD-16) — the group is never chosen or
    // widened. `null` is an unresolvable currency/label, a data condition mapped to `unavailable`.
    const population = await deps.repository.findGenderGapPopulation({
      roleCode: subject.roleCode,
      levelCode: subject.levelCode,
      countryCode: subject.countryCode,
    });
    if (population === null) {
      return { kind: 'unavailable' };
    }

    // The ONE domain (AD-16 / AD-17): as-of split by gender, the 5-of-each gate, the medians and gap.
    const result = computeGenderGap(population.candidates, asOf);

    // The codes-plus-labels provenance, and the group labels for the verdict. The verdict is composed
    // exactly once, from the same numeric result the payload carries, so sentence and fields cannot
    // disagree.
    const peerGroup: PeerGroupProvenance = {
      roleCode: subject.roleCode,
      levelCode: subject.levelCode,
      countryCode: subject.countryCode,
      roleName: population.roleName,
      levelLabel: population.levelLabel,
      countryName: population.countryName,
    };
    const group = labelsOf(population);

    const verdictInput: VerdictInput =
      result.kind === 'answer'
        ? {
            kind: 'gender-gap-answer',
            maleMedian: result.maleMedian,
            femaleMedian: result.femaleMedian,
            currencyFormat: population.currencyFormat,
            gapPctTenths: result.gapPctTenths,
            maleN: result.maleN,
            femaleN: result.femaleN,
            group,
            asOf,
          }
        : {
            kind: 'gender-gap-refusal',
            maleN: result.maleN,
            femaleN: result.femaleN,
            shortGender: result.shortGender,
            group,
            asOf,
          };

    const verdict = composeVerdict(verdictInput);
    if (verdict === null) {
      // Unrenderable labels/currency/date — a data condition, answered as `unavailable` rather than
      // a payload carrying a broken sentence.
      return { kind: 'unavailable' };
    }

    if (result.kind === 'answer') {
      return {
        kind: 'answer',
        gap: {
          employeeId,
          asOf,
          peerGroup,
          maleN: result.maleN,
          femaleN: result.femaleN,
          // The group's single currency IS each median's currency (AD-6) — single-currency group.
          currency: result.maleMedian.currency,
          maleMedian: toBoundaryMoney(result.maleMedian),
          femaleMedian: toBoundaryMoney(result.femaleMedian),
          gapPct: formatDistancePct(result.gapPctTenths),
          verdict,
        },
      };
    }

    return {
      kind: 'refusal',
      refusal: {
        reason: 'insufficient-gender',
        peerGroup,
        counts: { male: result.maleN, female: result.femaleN },
        shortGender: result.shortGender,
        asOf,
        verdict,
      },
    };
  } catch {
    return { kind: 'unavailable' };
  }
}
