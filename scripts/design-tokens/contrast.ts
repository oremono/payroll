/**
 * WCAG 2.x relative luminance and contrast ratio over sRGB hex colors.
 *
 * Pure — no I/O, no state, no dependencies. It exists so the accessibility claim in DESIGN.md
 * § Contrast floor ("verified by computation 2026-07-17 … any future token change must re-verify
 * the matrix before shipping") is a COMPUTATION on every run rather than a sentence in a document.
 * `tests/tokens/contrast.test.ts` is the gate; this module is the arithmetic under it.
 *
 * Build tooling, not product logic: it lives outside `src/` and it THROWS on a malformed color,
 * which `src/domain` may never do. A color that cannot be parsed is a defect in DESIGN.md, and the
 * only safe outcome is a stopped build — silently scoring an unparseable token would turn the
 * accessibility gate into decoration.
 *
 * Formula (WCAG 2.2, § Relative luminance and § Contrast ratio), reproduced exactly:
 *
 *     c' = c/12.92                    when c <= 0.03928
 *     c' = ((c + 0.055)/1.055)^2.4    otherwise
 *     L  = 0.2126 R' + 0.7152 G' + 0.0722 B'
 *     ratio = (L_lighter + 0.05) / (L_darker + 0.05)
 *
 * The 0.03928 knee is WCAG's published figure. sRGB's own piecewise definition uses 0.04045, and
 * the two differ in the third decimal — but the gate's job is to reproduce WCAG's numbers, and
 * DESIGN.md's ratified matrix was computed with WCAG's constant.
 */

/** Where the transfer function switches from the linear branch to the power branch. */
const TRANSFER_KNEE = 0.03928;

/** Per-channel luminance weights. Green carries most of perceived brightness; blue almost none. */
const CHANNEL_WEIGHTS = { red: 0.2126, green: 0.7152, blue: 0.0722 } as const;

/** WCAG's flare term, added to both luminances so the ratio is bounded at 21 rather than infinite. */
const FLARE = 0.05;

/** Exactly `#rrggbb`. No shorthand, no alpha, no named colors — DESIGN.md writes one form. */
const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * WCAG relative luminance of an sRGB hex color: 0 for black, 1 for white.
 *
 * Throws on anything that is not a six-digit hex color. Shorthand (`#fff`) is rejected rather than
 * expanded: DESIGN.md declares every color in full, so shorthand means something upstream went
 * wrong, and expanding it would hide that.
 */
export function relativeLuminance(hex: string): number {
  const match = HEX_COLOR.exec(hex);
  if (match === null) {
    throw new Error(
      `'${hex}' is not a six-digit hex color (#rrggbb). Every color in DESIGN.md is declared in ` +
        'that form; anything else is a source defect, not something to guess at.',
    );
  }

  const [red, green, blue] = [match[1], match[2], match[3]].map((channel) =>
    linearize(Number.parseInt(channel as string, 16) / 255),
  ) as [number, number, number];

  return (
    CHANNEL_WEIGHTS.red * red + CHANNEL_WEIGHTS.green * green + CHANNEL_WEIGHTS.blue * blue
  );
}

/**
 * Contrast ratio between two colors, from 1 (identical) to 21 (black on white).
 *
 * Symmetric by construction — the lighter color always takes the numerator — so callers need not
 * know which argument is the foreground. Naming them foreground/background is documentation of
 * intent, nothing more.
 */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);

  return (lighter + FLARE) / (darker + FLARE);
}

/** One 0..1 channel through the sRGB transfer function. */
function linearize(channel: number): number {
  return channel <= TRANSFER_KNEE ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
