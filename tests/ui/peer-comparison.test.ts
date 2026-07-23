import { describe, expect, it } from 'vitest';

import type {
  GetPeerComparisonResult,
  PeerComparison,
} from '@/application/use-cases/peer-comparison';
import type { CurrencyFormat } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import {
  buildPeerComparison,
  PEER_COMPARISON_UNREADABLE_HEADING,
  PEER_COMPARISON_UNREADABLE_STATEMENT,
} from '@/ui/peer-comparison-vm';

// Test-first (Law 1 / AD-23): red before `src/ui/peer-comparison-vm.ts` exists.
//
// Same split, and the same reason, as `salary-timeline-vm.ts`: no jsdom, no @testing-library, and
// `src/ui/*.tsx` sits outside the coverage gate. Every judgement the peer-comparison surface makes
// — selecting the arm, resolving the group `CurrencyFormat`, formatting the money figures and the
// as-of date, assembling the provenance caption, carrying the `verdict` byte-for-byte, and failing
// CLOSED to `figures: null` — lives in the PURE builder tested here, so `peer-comparison.tsx` is
// left with markup and nothing to get wrong.
//
// ## It consumes story 6-1's finalized payload UNMODIFIED (Law 7 / AD-24)
//
// `GetPeerComparisonResult` is used exactly as 6-1 finalized it. The builder RE-DERIVES no statistic
// (Law 2 / Law 8): `verdict`, `distancePct`, `n`, `currency`, `peerMedian`, `spread`, `asOf` all
// arrive computed. The builder only formats money/dates and selects the arm.

const INR: CurrencyFormat = {
  code: 'INR',
  symbol: '₹',
  minorUnitExponent: 2,
  groupingStyle: 'INDIAN',
};

// The anti-hard-coded-100 currency (Law 4 / AD-4): JPY has no minor unit at all.
const JPY: CurrencyFormat = {
  code: 'JPY',
  symbol: '¥',
  minorUnitExponent: 0,
  groupingStyle: 'WESTERN',
};

function date(year: number, month: number, day: number): PlainDate {
  return { year, month, day };
}

const VERDICT =
  'Priya Nair is 8.0% under the peer median (₹23,40,000 INR), based on 9 peers — Software Engineer · L4 · India — as of 16 Jul 2026.';

function comparison(overrides: Partial<PeerComparison> = {}): PeerComparison {
  return {
    employeeId: 'emp-1',
    asOf: date(2026, 7, 16),
    peerGroup: { roleCode: 'SWE', levelCode: 'L4', countryCode: 'IN' },
    n: 9,
    currency: 'INR',
    subjectSalary: { amountMinor: '215000000', currency: 'INR' },
    peerMedian: { amountMinor: '234000000', currency: 'INR' },
    spread: {
      min: { amountMinor: '180000000', currency: 'INR' },
      max: { amountMinor: '300000000', currency: 'INR' },
    },
    distancePct: '-8.0',
    verdict: VERDICT,
    ...overrides,
  };
}

function answer(overrides: Partial<PeerComparison> = {}): GetPeerComparisonResult {
  return { kind: 'answer', comparison: comparison(overrides) };
}

describe('buildPeerComparison', () => {
  it('builds the answer view-model with formatted figures, provenance, and the verbatim verdict', () => {
    const vm = buildPeerComparison(answer(), [INR]);

    expect(vm).toEqual({
      kind: 'answer',
      verdict: VERDICT,
      provenanceText: 'Based on 9 peers as of 16 Jul 2026',
      figures: {
        peerMedianText: '₹23,40,000 INR',
        rangeText: '₹18,00,000 INR – ₹30,00,000 INR',
        distanceText: '-8.0%',
      },
    });
  });

  it('carries the verdict byte-for-byte, never recomposed', () => {
    const weird = 'Any\tstring — even one\nwith odd  spacing — is passed through unchanged.';
    const vm = buildPeerComparison(answer({ verdict: weird }), [INR]);

    expect(vm.kind === 'answer' && vm.verdict).toBe(weird);
  });

  it('renders a positive distance verbatim with a percent sign', () => {
    const vm = buildPeerComparison(answer({ distancePct: '20.5' }), [INR]);

    expect(vm.kind === 'answer' && vm.figures?.distanceText).toBe('20.5%');
  });

  it('renders a zero distance verbatim with a percent sign', () => {
    const vm = buildPeerComparison(answer({ distancePct: '0.0' }), [INR]);

    expect(vm.kind === 'answer' && vm.figures?.distanceText).toBe('0.0%');
  });

  it('renders a negative distance verbatim with a percent sign', () => {
    const vm = buildPeerComparison(answer({ distancePct: '-8.0' }), [INR]);

    expect(vm.kind === 'answer' && vm.figures?.distanceText).toBe('-8.0%');
  });

  it('formats a zero-exponent currency without a hard-coded 100 (Law 4)', () => {
    const vm = buildPeerComparison(
      answer({
        currency: 'JPY',
        subjectSalary: { amountMinor: '5000000', currency: 'JPY' },
        peerMedian: { amountMinor: '5500000', currency: 'JPY' },
        spread: {
          min: { amountMinor: '4000000', currency: 'JPY' },
          max: { amountMinor: '7000000', currency: 'JPY' },
        },
      }),
      [JPY],
    );

    expect(vm.kind === 'answer' && vm.figures).toEqual({
      peerMedianText: '¥5,500,000 JPY',
      rangeText: '¥4,000,000 JPY – ¥7,000,000 JPY',
      distanceText: '-8.0%',
    });
  });

  it('fails closed to figures: null when the reference currencies are empty (no bare amount)', () => {
    const vm = buildPeerComparison(answer(), []);

    expect(vm).toEqual({
      kind: 'answer',
      verdict: VERDICT,
      provenanceText: 'Based on 9 peers as of 16 Jul 2026',
      figures: null,
    });
  });

  it('fails closed when the group currency is absent from the reference list', () => {
    const vm = buildPeerComparison(answer(), [JPY]);

    expect(vm.kind === 'answer' && vm.figures).toBeNull();
    // The verdict and provenance still render — the verdict is a complete server-composed string.
    expect(vm.kind === 'answer' && vm.verdict).toBe(VERDICT);
    expect(vm.kind === 'answer' && vm.provenanceText).toBe('Based on 9 peers as of 16 Jul 2026');
  });

  it('fails closed when the group currency has an unsupported exponent', () => {
    const unusable: CurrencyFormat = { ...INR, minorUnitExponent: 5 };
    const vm = buildPeerComparison(answer(), [unusable]);

    expect(vm.kind === 'answer' && vm.figures).toBeNull();
  });

  it('fails closed when a money figure is not a canonical minor-unit string', () => {
    const vm = buildPeerComparison(
      answer({ peerMedian: { amountMinor: '01', currency: 'INR' } }),
      [INR],
    );

    expect(vm.kind === 'answer' && vm.figures).toBeNull();
  });

  it('fails closed when the spread max cannot format', () => {
    const vm = buildPeerComparison(
      answer({
        spread: {
          min: { amountMinor: '180000000', currency: 'INR' },
          max: { amountMinor: ' 3 ', currency: 'INR' },
        },
      }),
      [INR],
    );

    expect(vm.kind === 'answer' && vm.figures).toBeNull();
  });

  it('falls back to the ISO date when the as-of month is out of range (still honest, never null)', () => {
    const vm = buildPeerComparison(answer({ asOf: { year: 2026, month: 13, day: 1 } }), [INR]);

    expect(vm.kind === 'answer' && vm.provenanceText).toBe('Based on 9 peers as of 2026-13-01');
  });

  it('maps a thin-peer-group refusal to a refusal carrying its verdict unmodified', () => {
    const thinVerdict =
      'No comparison — Software Engineer · L4 · India has only 3 people as of 16 Jul 2026. A fair comparison needs at least 5.';
    const vm = buildPeerComparison(
      {
        kind: 'refusal',
        refusal: {
          reason: 'thin-peer-group',
          peerGroup: { roleCode: 'SWE', levelCode: 'L4', countryCode: 'IN' },
          counts: { n: 3 },
          asOf: date(2026, 7, 16),
          verdict: thinVerdict,
        },
      },
      [INR],
    );

    expect(vm).toEqual({ kind: 'refusal', verdict: thinVerdict });
  });

  it('maps a no-salary-as-of refusal to a refusal carrying its verdict unmodified', () => {
    const noSalaryVerdict = 'No comparison — Priya Nair has no salary on record as of 16 Jul 2026.';
    const vm = buildPeerComparison(
      {
        kind: 'refusal',
        refusal: { reason: 'no-salary-as-of', asOf: date(2026, 7, 16), verdict: noSalaryVerdict },
      },
      [INR],
    );

    expect(vm).toEqual({ kind: 'refusal', verdict: noSalaryVerdict });
  });

  it('maps not-found to the unreadable region with the module-level copy', () => {
    const vm = buildPeerComparison({ kind: 'not-found' }, [INR]);

    expect(vm).toEqual({
      kind: 'unreadable',
      heading: PEER_COMPARISON_UNREADABLE_HEADING,
      statement: PEER_COMPARISON_UNREADABLE_STATEMENT,
    });
  });

  it('maps unavailable to the unreadable region with the module-level copy', () => {
    const vm = buildPeerComparison({ kind: 'unavailable' }, [INR]);

    expect(vm).toEqual({
      kind: 'unreadable',
      heading: PEER_COMPARISON_UNREADABLE_HEADING,
      statement: PEER_COMPARISON_UNREADABLE_STATEMENT,
    });
  });

  it('is deterministic — same input yields the same output', () => {
    expect(buildPeerComparison(answer(), [INR])).toEqual(buildPeerComparison(answer(), [INR]));
  });
});
