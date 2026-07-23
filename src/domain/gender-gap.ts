/**
 * The gender-gap core (CAP-7, AD-17): split the as-of peer population (AD-16) by gender, require
 * >= 5 of EACH, and compute the gap between the two per-gender medians. No I/O, no clock, no
 * randomness, no imports outside this layer. (Law 2 / AD-1)
 *
 * This forks NOTHING: in-population membership is the ONE `resolveCurrentSalary` (AD-8), each
 * gender's middle is the ONE `median` (AD-3), the gap magnitude is rounded through the ONE
 * `divideRoundHalfUp` (AD-5 arithmetic), and the 5-of-each threshold layers the ONE
 * `MIN_PEER_GROUP_SIZE` onto each gender. Gender is verbatim `MALE`/`FEMALE` (Law 3) and only ever
 * slices WITHIN one group — it is never part of peer identity.
 *
 * Every function here is TOTAL (Law 8 / AD-20): a too-thin gender split is a RETURN VALUE carrying
 * its counts, never an exception, and a median of an empty gender set is never computed. `maleN` and
 * `femaleN` are the cardinalities of the exact in-memory split set, never a COUNT (AD-16).
 */

import type { Gender } from './employee-fields';
import { divideRoundHalfUp, type Money } from './money';
import { MIN_PEER_GROUP_SIZE, type PeerCandidate } from './peer-comparison';
import type { PlainDate } from './plain-date';
import { resolveCurrentSalary } from './salary-timeline';
import { median } from './statistics';

/**
 * One candidate for the gender split: a `PeerCandidate` — the id and their whole UNORDERED
 * append-only salary history — PLUS the employee's `gender`. Follows the CAP-6
 * `OutlierCandidate = PeerCandidate & { name }` precedent rather than widening the shared
 * `PeerCandidate`, which `comparePeers` and the outlier sweep would then carry needlessly.
 */
export type GenderGapCandidate = PeerCandidate & { readonly gender: Gender };

/**
 * The domain-level outcome of a gender gap — Money-typed and tenths, pre-boundary. The use-case
 * encodes the medians to `BoundaryMoney` and the tenths to a signed one-decimal string.
 *
 * `insufficient-gender` is the ONE refusal: `>= 5 of EACH` strictly subsumes AD-16's group
 * `n >= 5` (5 men + 5 women ⇒ total >= 10), so a distinct thin-group arm would be unreachable here —
 * a group of 2M+2F is simply `shortGender: 'BOTH'`. It carries BOTH counts and which gender is
 * short; no median is computed.
 */
export type GenderGapResult =
  | {
      readonly kind: 'answer';
      readonly maleN: number;
      readonly femaleN: number;
      readonly maleMedian: Money;
      readonly femaleMedian: Money;
      readonly gapPctTenths: bigint;
    }
  | {
      readonly kind: 'insufficient-gender';
      readonly maleN: number;
      readonly femaleN: number;
      readonly shortGender: 'MALE' | 'FEMALE' | 'BOTH';
    };

/**
 * The gender gap, in TENTHS OF A PERCENT (AD-17): `gap = (M − F) / M × 100`, and the tenths form is
 * that × 10, all in ONE exact integer division through the ONE `divideRoundHalfUp`. The male median
 * `M` is ALWAYS the denominator, the magnitude is rounded half-up and the sign reapplied by the
 * divider, so `+` means men paid more. This is `bigint` and never IEEE double for the AD-5 reason:
 * `20.05%` is `200.5` tenths → half-up `201` → `"20.1"`, whereas a double reads it the wrong way.
 *
 * A DISTINCT formula from AD-5's subject-distance — expressing it as `-distancePctTenths(F, M)`
 * would be a sign-flipped reuse that reads wrong — so it shares the ACTUAL arithmetic primitive
 * rather than the distance function, and writes no second division.
 *
 * TOTAL and returns a plain `bigint`: past the 5-of-each gate `M > 0` (salaries are `> 0`, and the
 * median of a non-empty positive set is positive), so the divider's zero-denominator `null` arm is
 * never reached through `computeGenderGap`. The `?? 0n` keeps a DIRECT caller total for a degenerate
 * zero male median rather than leaking that `null`, mirroring `distancePctTenths` exactly.
 */
export function genderGapPctTenths(maleMedianMinor: bigint, femaleMedianMinor: bigint): bigint {
  return divideRoundHalfUp((maleMedianMinor - femaleMedianMinor) * 1000n, maleMedianMinor) ?? 0n;
}

/**
 * Which gender is short of `MIN_PEER_GROUP_SIZE`. Only called once at least one gender is short (the
 * gate below), so the final `'FEMALE'` fall-through is reachable exactly when the female side is the
 * short one and the male side is not.
 *
 * Two explicit `< MIN_PEER_GROUP_SIZE` tests, `&&`ed for `BOTH`: a `<= ` slip on either is caught by
 * the 5-of-each answer boundary (5 is sufficient), and a `&& → ||` slip on `BOTH` is caught by the
 * one-short tests (only one gender short must NOT read as `BOTH`).
 */
function shortGenderOf(maleN: number, femaleN: number): 'MALE' | 'FEMALE' | 'BOTH' {
  const maleShort = maleN < MIN_PEER_GROUP_SIZE;
  const femaleShort = femaleN < MIN_PEER_GROUP_SIZE;
  if (maleShort && femaleShort) {
    return 'BOTH';
  }
  if (maleShort) {
    return 'MALE';
  }
  return 'FEMALE';
}

/**
 * Split `candidates` by gender over the as-of population and report the gap or refuse.
 *
 * The order is the whole rule (AD-16 / AD-17):
 *   1. In-population = every candidate with a salary in force at `asOf` (the ONE resolver, AD-8),
 *      split by `gender` into two sets of current salaries. `maleN`/`femaleN` are their exact
 *      cardinalities, computed here — never a COUNT, never the table.
 *   2. `maleN < 5 || femaleN < 5` → `insufficient-gender`, naming both counts and `shortGender`. The
 *      group is never widened, and no median is computed over a too-thin (or empty) gender set.
 *   3. Otherwise the ONE `median` over each gender's current-salary minor units in the group's single
 *      currency, then the AD-17 gap.
 *
 * Past the gate each gender set holds at least 5 members, so both are non-empty and `median` is
 * non-null — asserted rather than re-checked, because a re-check would be an unreachable, uncoverable
 * branch (the same discipline `comparePeers` holds past its own gate).
 */
export function computeGenderGap(
  candidates: readonly GenderGapCandidate[],
  asOf: PlainDate,
): GenderGapResult {
  const maleSalaries: Money[] = [];
  const femaleSalaries: Money[] = [];

  for (const candidate of candidates) {
    const current = resolveCurrentSalary(candidate.salaryHistory, asOf);
    if (current === null) {
      continue;
    }
    if (candidate.gender === 'MALE') {
      maleSalaries.push(current.salary);
    } else {
      femaleSalaries.push(current.salary);
    }
  }

  const maleN = maleSalaries.length;
  const femaleN = femaleSalaries.length;

  if (maleN < MIN_PEER_GROUP_SIZE || femaleN < MIN_PEER_GROUP_SIZE) {
    return { kind: 'insufficient-gender', maleN, femaleN, shortGender: shortGenderOf(maleN, femaleN) };
  }

  // Non-null past the gate: each set holds at least 5 salaries, so the median has an answer. The
  // currency is the group's single currency (AD-6) — read off a member of each set, itself non-empty
  // past the gate. The `as` casts assert what the gate guarantees, mirroring `comparePeers`.
  const maleMedianMinor = median(maleSalaries.map((salary) => salary.amountMinor)) as bigint;
  const femaleMedianMinor = median(femaleSalaries.map((salary) => salary.amountMinor)) as bigint;
  const maleCurrency = (maleSalaries[0] as Money).currency;
  const femaleCurrency = (femaleSalaries[0] as Money).currency;

  return {
    kind: 'answer',
    maleN,
    femaleN,
    maleMedian: { amountMinor: maleMedianMinor, currency: maleCurrency },
    femaleMedian: { amountMinor: femaleMedianMinor, currency: femaleCurrency },
    gapPctTenths: genderGapPctTenths(maleMedianMinor, femaleMedianMinor),
  };
}
