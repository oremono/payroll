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
