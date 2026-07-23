import { describe, expect, it } from 'vitest';

import type { GenderGap, GetGenderGapResult } from '@/application/use-cases/gender-gap';
import type { CurrencyFormat } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import {
  buildGenderGap,
  GENDER_GAP_UNREADABLE_HEADING,
  GENDER_GAP_UNREADABLE_STATEMENT,
} from '@/ui/gender-gap-vm';

// Test-first (Law 1 / AD-23): red before `src/ui/gender-gap-vm.ts` exists.
//
// 8-2 is the CAP-7 twin of 6-2. Same split, and the same reason, as `peer-comparison-vm.ts`: no
// jsdom, no @testing-library, and `src/ui/*.tsx` sits outside the coverage gate. Every judgement the
// gender-gap surface makes — selecting the arm, resolving the group `CurrencyFormat`, formatting the
// male/female medians and the as-of date, assembling the provenance caption, carrying the `verdict`
// byte-for-byte, and failing CLOSED to `figures: null` — lives in the PURE builder tested here, so
// `gender-gap.tsx` is left with markup and nothing to get wrong.
//
// ## It consumes story 8-1's finalized payload UNMODIFIED (Law 7 / AD-24)
//
// `GetGenderGapResult` is used exactly as 8-1 finalized it. The builder RE-DERIVES no statistic
// (Law 2 / Law 8): `verdict`, `gapPct`, `maleN`, `femaleN`, `currency`, `maleMedian`, `femaleMedian`,
// `asOf` all arrive computed. The builder only formats money/dates and selects the arm.

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

const PEER_GROUP = {
  roleCode: 'SWE',
  levelCode: 'L4',
  countryCode: 'IN',
  roleName: 'Software Engineer',
  levelLabel: 'L4',
  countryName: 'India',
};

const VERDICT =
  'Men earn 8.0% more than women — Software Engineer · L4 · India — based on 7 men and 6 women as of 16 Jul 2026.';

function gap(overrides: Partial<GenderGap> = {}): GenderGap {
  return {
    employeeId: 'emp-1',
    asOf: date(2026, 7, 16),
    peerGroup: PEER_GROUP,
    maleN: 7,
    femaleN: 6,
    currency: 'INR',
    maleMedian: { amountMinor: '234000000', currency: 'INR' },
    femaleMedian: { amountMinor: '215000000', currency: 'INR' },
    gapPct: '8.0',
    verdict: VERDICT,
    ...overrides,
  };
}

function answer(overrides: Partial<GenderGap> = {}): GetGenderGapResult {
  return { kind: 'answer', gap: gap(overrides) };
}

describe('buildGenderGap', () => {
  it('builds the answer view-model with formatted figures, provenance, and the verbatim verdict', () => {
    const vm = buildGenderGap(answer(), [INR]);

    expect(vm).toEqual({
      kind: 'answer',
      verdict: VERDICT,
      provenanceText: 'Based on 7 men and 6 women as of 16 Jul 2026',
      figures: {
        maleMedianText: '₹23,40,000 INR',
        femaleMedianText: '₹21,50,000 INR',
        gapText: '8.0%',
      },
    });
  });

  it('carries the verdict byte-for-byte, never recomposed', () => {
    const weird = 'Any\tstring — even one\nwith odd  spacing — is passed through unchanged.';
    const vm = buildGenderGap(answer({ verdict: weird }), [INR]);

    expect(vm.kind === 'answer' && vm.verdict).toBe(weird);
  });

  it('renders a positive gap verbatim with a percent sign (men higher)', () => {
    const vm = buildGenderGap(answer({ gapPct: '8.0' }), [INR]);

    expect(vm.kind === 'answer' && vm.figures?.gapText).toBe('8.0%');
  });

  it('renders a negative gap verbatim with a percent sign (women higher)', () => {
    const vm = buildGenderGap(answer({ gapPct: '-8.7' }), [INR]);

    expect(vm.kind === 'answer' && vm.figures?.gapText).toBe('-8.7%');
  });

  it('renders a zero gap verbatim with a percent sign (parity)', () => {
    const vm = buildGenderGap(answer({ gapPct: '0.0' }), [INR]);

    expect(vm.kind === 'answer' && vm.figures?.gapText).toBe('0.0%');
  });

  it('formats a zero-exponent currency without a hard-coded 100 (Law 4)', () => {
    const vm = buildGenderGap(
      answer({
        currency: 'JPY',
        maleMedian: { amountMinor: '5500000', currency: 'JPY' },
        femaleMedian: { amountMinor: '5000000', currency: 'JPY' },
      }),
      [JPY],
    );

    expect(vm.kind === 'answer' && vm.figures).toEqual({
      maleMedianText: '¥5,500,000 JPY',
      femaleMedianText: '¥5,000,000 JPY',
      gapText: '8.0%',
    });
  });

  it('fails closed to figures: null when the reference currencies are empty (no bare amount)', () => {
    const vm = buildGenderGap(answer(), []);

    expect(vm).toEqual({
      kind: 'answer',
      verdict: VERDICT,
      provenanceText: 'Based on 7 men and 6 women as of 16 Jul 2026',
      figures: null,
    });
  });

  it('fails closed when the group currency is absent from the reference list', () => {
    const vm = buildGenderGap(answer(), [JPY]);

    expect(vm.kind === 'answer' && vm.figures).toBeNull();
    // The verdict and provenance still render — the verdict is a complete server-composed string.
    expect(vm.kind === 'answer' && vm.verdict).toBe(VERDICT);
    expect(vm.kind === 'answer' && vm.provenanceText).toBe(
      'Based on 7 men and 6 women as of 16 Jul 2026',
    );
  });

  it('fails closed when the group currency has an unsupported exponent', () => {
    const unusable: CurrencyFormat = { ...INR, minorUnitExponent: 5 };
    const vm = buildGenderGap(answer(), [unusable]);

    expect(vm.kind === 'answer' && vm.figures).toBeNull();
  });

  it('fails closed when a median is not a canonical minor-unit string', () => {
    const vm = buildGenderGap(
      answer({ femaleMedian: { amountMinor: '01', currency: 'INR' } }),
      [INR],
    );

    expect(vm.kind === 'answer' && vm.figures).toBeNull();
  });

  it('fails closed when the male median cannot format', () => {
    const vm = buildGenderGap(
      answer({ maleMedian: { amountMinor: ' 3 ', currency: 'INR' } }),
      [INR],
    );

    expect(vm.kind === 'answer' && vm.figures).toBeNull();
  });

  it('falls back to the ISO date when the as-of month is out of range (still honest, never null)', () => {
    const vm = buildGenderGap(answer({ asOf: { year: 2026, month: 13, day: 1 } }), [INR]);

    expect(vm.kind === 'answer' && vm.provenanceText).toBe(
      'Based on 7 men and 6 women as of 2026-13-01',
    );
  });

  it('maps an insufficient-gender refusal (male short) to a refusal carrying its verdict unmodified', () => {
    const refusalVerdict =
      'No gender comparison — Software Engineer · L4 · India has only 3 men and 8 women as of 16 Jul 2026. A fair comparison needs at least 5 of each.';
    const vm = buildGenderGap(
      {
        kind: 'refusal',
        refusal: {
          reason: 'insufficient-gender',
          peerGroup: PEER_GROUP,
          counts: { male: 3, female: 8 },
          shortGender: 'MALE',
          asOf: date(2026, 7, 16),
          verdict: refusalVerdict,
        },
      },
      [INR],
    );

    expect(vm).toEqual({ kind: 'refusal', verdict: refusalVerdict });
  });

  it('maps an insufficient-gender refusal (female short) to a refusal carrying its verdict unmodified', () => {
    const refusalVerdict =
      'No gender comparison — Software Engineer · L4 · India has only 9 men and 2 women as of 16 Jul 2026. A fair comparison needs at least 5 of each.';
    const vm = buildGenderGap(
      {
        kind: 'refusal',
        refusal: {
          reason: 'insufficient-gender',
          peerGroup: PEER_GROUP,
          counts: { male: 9, female: 2 },
          shortGender: 'FEMALE',
          asOf: date(2026, 7, 16),
          verdict: refusalVerdict,
        },
      },
      [INR],
    );

    expect(vm).toEqual({ kind: 'refusal', verdict: refusalVerdict });
  });

  it('maps an insufficient-gender refusal (both short) to a refusal carrying its verdict unmodified', () => {
    const refusalVerdict =
      'No gender comparison — Software Engineer · L4 · India has only 2 men and 3 women as of 16 Jul 2026. A fair comparison needs at least 5 of each.';
    const vm = buildGenderGap(
      {
        kind: 'refusal',
        refusal: {
          reason: 'insufficient-gender',
          peerGroup: PEER_GROUP,
          counts: { male: 2, female: 3 },
          shortGender: 'BOTH',
          asOf: date(2026, 7, 16),
          verdict: refusalVerdict,
        },
      },
      [INR],
    );

    expect(vm).toEqual({ kind: 'refusal', verdict: refusalVerdict });
  });

  it('maps not-found to the unreadable region with the module-level copy', () => {
    const vm = buildGenderGap({ kind: 'not-found' }, [INR]);

    expect(vm).toEqual({
      kind: 'unreadable',
      heading: GENDER_GAP_UNREADABLE_HEADING,
      statement: GENDER_GAP_UNREADABLE_STATEMENT,
    });
  });

  it('maps unavailable to the unreadable region with the module-level copy', () => {
    const vm = buildGenderGap({ kind: 'unavailable' }, [INR]);

    expect(vm).toEqual({
      kind: 'unreadable',
      heading: GENDER_GAP_UNREADABLE_HEADING,
      statement: GENDER_GAP_UNREADABLE_STATEMENT,
    });
  });

  it('is deterministic — same input yields the same output', () => {
    expect(buildGenderGap(answer(), [INR])).toEqual(buildGenderGap(answer(), [INR]));
  });
});
