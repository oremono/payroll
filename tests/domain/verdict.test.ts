import { describe, expect, it } from 'vitest';

import type { CurrencyFormat, Money } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import { composeVerdict, type PeerGroupLabels } from '@/domain/verdict';

// Test-first (Law 1 / AD-23): red before `src/domain/verdict.ts` exists.
//
// THE single verdict sentence (Law 8 / AD-20): exactly one function composes the answer sentence
// AND both refusal sentences, and the card and copy-answer consume its output UNMODIFIED. A second
// verdict anywhere is how the card and the clipboard start disagreeing about the same figure.
//
// The golden strings below are the finalized contract (spec Design Notes). Neutral phrasing — "the
// peer median", never a gendered possessive. The magnitude is one decimal (AD-5); the median money
// runs through the ONE `formatMoney` and the date through the ONE `formatPlainDate`.

const INR_FORMAT: CurrencyFormat = {
  code: 'INR',
  symbol: '₹',
  minorUnitExponent: 2,
  groupingStyle: 'INDIAN',
};

const GROUP: PeerGroupLabels = {
  roleName: 'Software Engineer',
  levelLabel: 'L4',
  countryName: 'India',
};

const AS_OF: PlainDate = { year: 2026, month: 7, day: 16 };
const MEDIAN: Money = { amountMinor: 234_000_000n, currency: 'INR' };

describe('composeVerdict — the answer sentence (AD-20)', () => {
  it('matches the golden UNDER sentence exactly', () => {
    const verdict = composeVerdict({
      kind: 'answer',
      subjectName: 'Priya Nair',
      distancePctTenths: -80n,
      peerMedian: MEDIAN,
      currencyFormat: INR_FORMAT,
      n: 9,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'Priya Nair is 8.0% under the peer median (₹23,40,000 INR), based on 9 peers — Software Engineer · L4 · India — as of 16 Jul 2026.',
    );
  });

  it('says OVER with a positive distance', () => {
    const verdict = composeVerdict({
      kind: 'answer',
      subjectName: 'Priya Nair',
      distancePctTenths: 205n,
      peerMedian: MEDIAN,
      currencyFormat: INR_FORMAT,
      n: 9,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'Priya Nair is 20.5% over the peer median (₹23,40,000 INR), based on 9 peers — Software Engineer · L4 · India — as of 16 Jul 2026.',
    );
  });

  it('says "at the peer median" — no percent — when the distance is exactly zero', () => {
    const verdict = composeVerdict({
      kind: 'answer',
      subjectName: 'Priya Nair',
      distancePctTenths: 0n,
      peerMedian: MEDIAN,
      currencyFormat: INR_FORMAT,
      n: 9,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'Priya Nair is at the peer median (₹23,40,000 INR), based on 9 peers — Software Engineer · L4 · India — as of 16 Jul 2026.',
    );
  });

  it('returns null — never a broken sentence — when the median money cannot be formatted', () => {
    // Totality (Law 8): a currency that does not match the format is `formatMoney`'s `null`, and the
    // verdict propagates it rather than emitting a sentence with a hole in it. Unreachable in correct
    // wiring (the boundary resolves the format by the money's own code), guarded all the same.
    const verdict = composeVerdict({
      kind: 'answer',
      subjectName: 'Priya Nair',
      distancePctTenths: -80n,
      peerMedian: { amountMinor: 234_000_000n, currency: 'USD' },
      currencyFormat: INR_FORMAT,
      n: 9,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBeNull();
  });
});

describe('composeVerdict — the thin-peer-group refusal (a full citizen, carrying its count)', () => {
  it('matches the golden thin sentence exactly, naming the count and the minimum', () => {
    const verdict = composeVerdict({
      kind: 'thin-peer-group',
      n: 3,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'No comparison — Software Engineer · L4 · India has only 3 people as of 16 Jul 2026. A fair comparison needs at least 5.',
    );
  });

  it('says "1 person", not "1 people", when the subject is the sole in-population member', () => {
    // n === 1 is reachable: the subject is in-population (else this arm is unreachable), but every
    // other candidate's only salary is future/absent at asOf. The count is still correct — only the
    // noun must agree with it.
    const verdict = composeVerdict({
      kind: 'thin-peer-group',
      n: 1,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'No comparison — Software Engineer · L4 · India has only 1 person as of 16 Jul 2026. A fair comparison needs at least 5.',
    );
  });
});

describe('composeVerdict — the no-salary-as-of refusal', () => {
  it('matches the golden no-salary sentence exactly, naming the subject and the date', () => {
    const verdict = composeVerdict({
      kind: 'no-salary-as-of',
      subjectName: 'Priya Nair',
      asOf: AS_OF,
    });

    expect(verdict).toBe('No comparison — Priya Nair has no salary on record as of 16 Jul 2026.');
  });

  it('returns null when the as-of date itself cannot be formatted', () => {
    // A malformed `asOf` (month out of range) is `formatPlainDate`'s `null`; every arm propagates it.
    const verdict = composeVerdict({
      kind: 'no-salary-as-of',
      subjectName: 'Priya Nair',
      asOf: { year: 2026, month: 13, day: 1 },
    });

    expect(verdict).toBeNull();
  });
});

// ── CAP-7 gender gap (AD-17) ─────────────────────────────────────────────────────────────────────
//
// Still the ONE composer (Law 8 / AD-20): the same function that answers a peer comparison answers
// the gender gap and its refusal, and the card and copy-answer consume its output UNMODIFIED. Neutral
// and quotable — naming the male/female medians and counts is the CONTENT; there is no gendered
// possessive pronoun. Three-way on the EXACT median comparison (not the rounded gap), mirroring
// `positionPhrase`'s discipline: men higher (M > F), women higher (M < F), parity (M === F, the
// fall-through a `<=`/`>=` slip would corrupt). "Paid the same" means the medians are actually equal
// — a gap that merely ROUNDS to 0.0% beside two different medians still names its direction.

// ₹20,000 INR (2_000_000n minor at exponent 2) and ₹18,400 INR (1_840_000n) — an 8.0% / 8.7% gap.
const MALE_MEDIAN_HIGH: Money = { amountMinor: 2_000_000n, currency: 'INR' };
const FEMALE_MEDIAN_LOW: Money = { amountMinor: 1_840_000n, currency: 'INR' };

describe('composeVerdict — the gender-gap answer (three-way on the gap sign)', () => {
  it('says MEN are paid more, naming both medians and counts, for a positive gap', () => {
    const verdict = composeVerdict({
      kind: 'gender-gap-answer',
      maleMedian: MALE_MEDIAN_HIGH,
      femaleMedian: FEMALE_MEDIAN_LOW,
      currencyFormat: INR_FORMAT,
      gapPctTenths: 80n,
      maleN: 5,
      femaleN: 5,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'Men are paid 8.0% more than women at the median — ₹20,000 INR across 5 men vs ₹18,400 INR across 5 women — Software Engineer · L4 · India, as of 16 Jul 2026.',
    );
  });

  it('says WOMEN are paid more — the direction is the word, the magnitude sign-less — for a negative gap', () => {
    const verdict = composeVerdict({
      kind: 'gender-gap-answer',
      maleMedian: FEMALE_MEDIAN_LOW,
      femaleMedian: MALE_MEDIAN_HIGH,
      currencyFormat: INR_FORMAT,
      gapPctTenths: -87n,
      maleN: 6,
      femaleN: 7,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'Women are paid 8.7% more than men at the median — ₹18,400 INR across 6 men vs ₹20,000 INR across 7 women — Software Engineer · L4 · India, as of 16 Jul 2026.',
    );
  });

  it('states PARITY — no percent, no direction — when the gap is exactly zero', () => {
    const verdict = composeVerdict({
      kind: 'gender-gap-answer',
      maleMedian: MALE_MEDIAN_HIGH,
      femaleMedian: MALE_MEDIAN_HIGH,
      currencyFormat: INR_FORMAT,
      gapPctTenths: 0n,
      maleN: 5,
      femaleN: 8,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'Men and women are paid the same at the median — ₹20,000 INR across 5 men vs ₹20,000 INR across 8 women — Software Engineer · L4 · India, as of 16 Jul 2026.',
    );
  });

  it('names the direction — NOT parity — when the gap rounds to 0.0% but the medians differ', () => {
    // ₹20,000.00 vs ₹19,999.99: gap = 0.0005% → 0n tenths, but the medians are NOT equal. "Paid the
    // same" here would contradict the two different figures the same sentence prints; the direction
    // is driven by the exact medians, the magnitude ("0.0%") by the rounded gap.
    const verdict = composeVerdict({
      kind: 'gender-gap-answer',
      maleMedian: { amountMinor: 2_000_000n, currency: 'INR' },
      femaleMedian: { amountMinor: 1_999_999n, currency: 'INR' },
      currencyFormat: INR_FORMAT,
      gapPctTenths: 0n,
      maleN: 5,
      femaleN: 5,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'Men are paid 0.0% more than women at the median — ₹20,000 INR across 5 men vs ₹19,999.99 INR across 5 women — Software Engineer · L4 · India, as of 16 Jul 2026.',
    );
  });

  it('returns null when the MALE median money cannot be formatted', () => {
    const verdict = composeVerdict({
      kind: 'gender-gap-answer',
      maleMedian: { amountMinor: 2_000_000n, currency: 'USD' },
      femaleMedian: FEMALE_MEDIAN_LOW,
      currencyFormat: INR_FORMAT,
      gapPctTenths: 80n,
      maleN: 5,
      femaleN: 5,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBeNull();
  });

  it('returns null when the FEMALE median money cannot be formatted', () => {
    const verdict = composeVerdict({
      kind: 'gender-gap-answer',
      maleMedian: MALE_MEDIAN_HIGH,
      femaleMedian: { amountMinor: 1_840_000n, currency: 'USD' },
      currencyFormat: INR_FORMAT,
      gapPctTenths: 80n,
      maleN: 5,
      femaleN: 5,
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBeNull();
  });

  it('returns null when the as-of date cannot be formatted', () => {
    const verdict = composeVerdict({
      kind: 'gender-gap-answer',
      maleMedian: MALE_MEDIAN_HIGH,
      femaleMedian: FEMALE_MEDIAN_LOW,
      currencyFormat: INR_FORMAT,
      gapPctTenths: 80n,
      maleN: 5,
      femaleN: 5,
      group: GROUP,
      asOf: { year: 2026, month: 13, day: 1 },
    });

    expect(verdict).toBeNull();
  });
});

describe('composeVerdict — the gender-gap refusal (states both counts and the standard)', () => {
  it('names both counts and which gender is short — FEMALE', () => {
    const verdict = composeVerdict({
      kind: 'gender-gap-refusal',
      maleN: 8,
      femaleN: 4,
      shortGender: 'FEMALE',
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'No gender gap — Software Engineer · L4 · India has 8 men and 4 women as of 16 Jul 2026, and a gap needs at least 5 of each. Too few women.',
    );
  });

  it('names which gender is short — MALE', () => {
    const verdict = composeVerdict({
      kind: 'gender-gap-refusal',
      maleN: 3,
      femaleN: 7,
      shortGender: 'MALE',
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'No gender gap — Software Engineer · L4 · India has 3 men and 7 women as of 16 Jul 2026, and a gap needs at least 5 of each. Too few men.',
    );
  });

  it('says BOTH are short, agreeing the noun with a count of 1 and a count of 0', () => {
    // `1 man` singular and `0 women` plural — the same person/people agreement the thin arm makes.
    const verdict = composeVerdict({
      kind: 'gender-gap-refusal',
      maleN: 1,
      femaleN: 0,
      shortGender: 'BOTH',
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'No gender gap — Software Engineer · L4 · India has 1 man and 0 women as of 16 Jul 2026, and a gap needs at least 5 of each. Too few of both.',
    );
  });

  it('agrees the noun with a count of 1 on the female side too', () => {
    const verdict = composeVerdict({
      kind: 'gender-gap-refusal',
      maleN: 0,
      femaleN: 1,
      shortGender: 'BOTH',
      group: GROUP,
      asOf: AS_OF,
    });

    expect(verdict).toBe(
      'No gender gap — Software Engineer · L4 · India has 0 men and 1 woman as of 16 Jul 2026, and a gap needs at least 5 of each. Too few of both.',
    );
  });

  it('returns null when the as-of date cannot be formatted', () => {
    const verdict = composeVerdict({
      kind: 'gender-gap-refusal',
      maleN: 8,
      femaleN: 4,
      shortGender: 'FEMALE',
      group: GROUP,
      asOf: { year: 2026, month: 13, day: 1 },
    });

    expect(verdict).toBeNull();
  });
});
