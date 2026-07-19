import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from '../../scripts/design-tokens/contrast.ts';
import { readDesignFrontmatter } from '../../scripts/design-tokens/design-source.ts';

// Test-first (Law 1 / AD-23): this spec lands, red, before `scripts/design-tokens/contrast.ts`
// exists.
//
// DESIGN.md § Contrast floor states the matrix was "verified by computation 2026-07-17" and commits
// that "any future token change must re-verify the matrix before shipping". THIS SUITE IS THAT
// GATE — it re-derives the ratios from the frontmatter on every run, so a token edit that breaks
// the floor fails the build instead of a promise in prose.
//
// The gated pairs are the ones the story ratifies, not every combination the palette admits:
//
//   >= 4.5:1 (body/numeric text, 12-14px)
//       {ink, ink-muted, ink-faint, primary, accent-indigo} x {surface-base, surface-card,
//       surface-tint}, plus primary-foreground on primary and amber-badge-text on amber-badge-bg.
//   >= 3:1 (non-text UI)
//       secondary (chart fill, "never a text color") x the three surfaces, plus input-border on
//       surface-card — the surface forms actually sit on.
//
// Deliberately EXCLUDED: border-hairline and border-strong, which DESIGN scopes to decorative rules
// and table dividers rather than to UI components requiring identification.
//
// Also deliberately excluded, and recorded in deferred-work.md rather than silently dropped:
// input-border on surface-base (2.96:1) and on surface-tint (2.82:1) fall BELOW DESIGN's own
// stated 3:1 floor. No ratified surface places an input on either, and DESIGN.md is read-only to
// this story, so gating them would block on a token this story may not change.

const TEXT_FLOOR = 4.5;
const NON_TEXT_FLOOR = 3;

const colors = readDesignFrontmatter().colors;

type Mode = 'light' | 'dark';

/** The value a token takes in a given mode. `-dark` is a MODE SELECTOR, never part of a name. */
function valueOf(token: string, mode: Mode): string {
  const value = colors[mode === 'light' ? token : `${token}-dark`];
  if (value === undefined) {
    throw new Error(`DESIGN.md declares no ${mode} value for '${token}'`);
  }
  return value;
}

/**
 * The contrast ratio of two TOKENS in one mode, rounded the way DESIGN.md REPORTS it.
 *
 * Use this to reproduce DESIGN's published figures. Never use it to judge a floor — see
 * `measuredRatio`.
 */
function ratio(foreground: string, background: string, mode: Mode): number {
  return round2(measuredRatio(foreground, background, mode));
}

/**
 * The UNROUNDED ratio, which is what the floors below compare against.
 *
 * Rounding before comparing makes the gate 0.005 more permissive than WCAG: a true 4.4951:1 rounds
 * to 4.5 and clears a `>= 4.5` assertion it should fail (code review 2026-07-19). Rounding belongs
 * in the reported MESSAGE, not in the compared value.
 */
function measuredRatio(foreground: string, background: string, mode: Mode): number {
  return contrastRatio(valueOf(foreground, mode), valueOf(background, mode));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const SURFACES = ['surface-base', 'surface-card', 'surface-tint'] as const;
const TEXT_INKS = ['ink', 'ink-muted', 'ink-faint', 'primary', 'accent-indigo'] as const;

/** Every gated pair at the 4.5 floor, as `[foreground, background]`. */
const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ...TEXT_INKS.flatMap((ink) => SURFACES.map((surface) => [ink, surface] as const)),
  ['primary-foreground', 'primary'],
  ['amber-badge-text', 'amber-badge-bg'],
];

/** Every gated pair at the 3:1 non-text floor. */
const NON_TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ...SURFACES.map((surface) => ['secondary', surface] as const),
  ['input-border', 'surface-card'],
];

describe('relativeLuminance', () => {
  it('is 0 for black — the bottom of the sRGB range', () => {
    expect(relativeLuminance('#000000')).toBe(0);
  });

  it('is 1 for white — the top of the sRGB range', () => {
    expect(relativeLuminance('#ffffff')).toBe(1);
  });

  it('accepts an uppercase hex identically to a lowercase one', () => {
    expect(relativeLuminance('#F8FAFC')).toBe(relativeLuminance('#f8fafc'));
  });

  it('applies the sRGB transfer curve, not the raw channel value', () => {
    // A mid gray (#808080, channel 128/255 = 0.502) is NOT 0.502 luminance — the ^2.4 curve puts
    // it near 0.216. A linear implementation would pass every ratio test above by accident.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4);
  });

  it('weights the channels per WCAG — green dominates, blue barely registers', () => {
    expect(relativeLuminance('#00ff00')).toBeGreaterThan(relativeLuminance('#ff0000'));
    expect(relativeLuminance('#ff0000')).toBeGreaterThan(relativeLuminance('#0000ff'));
  });

  it('uses the linear branch below the 0.03928 knee, not the power branch', () => {
    // #050505 (channel 5/255 = 0.0196) sits below the knee, so each channel is c/12.92.
    expect(relativeLuminance('#050505')).toBeCloseTo(0.0196 / 12.92, 5);
  });

  it('throws on a value that is not a six-digit hex color', () => {
    expect(() => relativeLuminance('rebeccapurple')).toThrowError(/hex/i);
  });

  it('throws on three-digit shorthand — DESIGN.md writes six, and guessing is not this tool s job', () => {
    expect(() => relativeLuminance('#fff')).toThrowError(/hex/i);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white — the maximum the formula admits', () => {
    expect(round2(contrastRatio('#000000', '#ffffff'))).toBe(21);
  });

  it('is 1 for a color on itself — the minimum', () => {
    expect(contrastRatio('#4f46e5', '#4f46e5')).toBe(1);
  });

  it('is symmetric: the order of the two colors does not change the ratio', () => {
    expect(contrastRatio('#191c1e', '#f1f5f9')).toBe(contrastRatio('#f1f5f9', '#191c1e'));
  });
});

// The reference table below was computed independently of this implementation. It is asserted
// value by value rather than only as "passes the floor", because a subtly wrong transfer function
// still clears 4.5 on most of a palette — it is the exact numbers that prove the math.
describe('the DESIGN.md contrast matrix — light', () => {
  it.each([
    ['ink', 'surface-tint', 15.63],
    ['ink-muted', 'surface-tint', 8.49],
    ['ink-faint', 'surface-tint', 5.28],
    ['primary', 'surface-tint', 13.35],
    ['accent-indigo', 'surface-tint', 5.74],
    ['secondary', 'surface-tint', 4.34],
    ['input-border', 'surface-card', 3.09],
    ['amber-badge-text', 'amber-badge-bg', 4.84],
    ['primary-foreground', 'primary', 14.63],
  ])('%s on %s is %f:1', (foreground, background, expected) => {
    expect(ratio(foreground as string, background as string, 'light')).toBe(expected);
  });
});

describe('the DESIGN.md contrast matrix — dark', () => {
  it.each([
    ['ink', 'surface-tint', 8.4],
    ['ink-muted', 'surface-tint', 5.62],
    ['ink-faint', 'surface-tint', 4.72],
    ['primary', 'surface-tint', 8.4],
    ['accent-indigo', 'surface-tint', 5.19],
    ['secondary', 'surface-tint', 3.36],
    ['input-border', 'surface-card', 4.74],
    ['amber-badge-text', 'amber-badge-bg', 10.11],
    ['primary-foreground', 'primary', 14.48],
  ])('%s on %s is %f:1', (foreground, background, expected) => {
    expect(ratio(foreground as string, background as string, 'dark')).toBe(expected);
  });
});

describe.each(['light', 'dark'] as const)('the gated floor — %s mode', (mode) => {
  it.each(TEXT_PAIRS)('%s on %s clears the 4.5:1 text floor', (foreground, background) => {
    const measured = measuredRatio(foreground, background, mode);

    // The message is the point of the assertion: a failure must name both tokens, the computed
    // ratio, and the floor, so whoever changed DESIGN.md knows exactly which pair they broke. The
    // message rounds for legibility; the ASSERTION reads the unrounded value.
    expect(
      measured,
      `${foreground} on ${background} (${mode}) is ${round2(measured)}:1, below the ${TEXT_FLOOR}:1 floor`,
    ).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  it.each(NON_TEXT_PAIRS)('%s on %s clears the 3:1 non-text floor', (foreground, background) => {
    const measured = measuredRatio(foreground, background, mode);

    expect(
      measured,
      `${foreground} on ${background} (${mode}) is ${round2(measured)}:1, below the ${NON_TEXT_FLOOR}:1 floor`,
    ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
  });
});

// DESIGN.md § Contrast floor names its own worst pairs. Reproducing them exactly is what proves
// this gate re-derives DESIGN's verification rather than a weaker one: a gate that merely cleared
// 4.5 everywhere would also pass with a broken luminance curve that happened to inflate ratios.
//
// Scoped to the INK x SURFACE matrix, which is the set DESIGN's sentence is about ("verified by
// computation … over the full ink x surface matrix"). The two same-hue pairs gated at 4.5 above —
// amber-badge-text on amber-badge-bg (4.84 light) and primary-foreground on primary — are not
// ink-on-surface and are not part of the figure DESIGN records; amber is in fact the lower of the
// two in light mode, so folding it in here would contradict DESIGN rather than reproduce it.
const INK_ON_SURFACE_PAIRS = TEXT_INKS.flatMap((ink) =>
  SURFACES.map((surface) => [ink, surface] as const),
);

describe('the worst ink-on-surface pair reproduces the figure DESIGN.md records', () => {
  it.each([
    ['light', 5.28],
    ['dark', 4.72],
  ] as const)('%s mode bottoms out at %f:1, on ink-faint over surface-tint', (mode, expected) => {
    const measured = INK_ON_SURFACE_PAIRS.map(([foreground, background]) => ({
      pair: `${foreground} on ${background}`,
      value: ratio(foreground, background, mode),
    })).reduce((worst, candidate) => (candidate.value < worst.value ? candidate : worst));

    expect(measured.value).toBe(expected);
    expect(measured.pair).toBe('ink-faint on surface-tint');
  });
});
