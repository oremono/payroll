import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

// Test-first (Law 1 / AD-23): this suite lands red, before `src/app/tokens.generated.css` is
// generated and before `globals.css` imports it.
//
// AD-15 says "no color literal appears in application code". ESLint closes the JS/TS half of that
// (see `colorLiteralBanConfig` in eslint.config.mjs), but ESLint DOES NOT LINT CSS — so without
// this suite the ban has a hole exactly the width of a stylesheet, which is where color literals
// actually want to live. The one sanctioned exception is the generated token file itself, and
// "exception" is asserted here rather than assumed: the file must exist, must carry hex, and must
// be the ONLY stylesheet under src/ that carries a color literal.
//
// The SCANNER is itself tested, against fixture trees (below). It is the whole gate — if it walks
// the wrong directories or matches the wrong extensions, the assertions over the real tree pass
// vacuously and prove nothing.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const GENERATED_TOKENS = path.join(SRC, 'app/tokens.generated.css');
const GLOBALS = path.join(SRC, 'app/globals.css');

/**
 * The ONE directory under src/ that is skipped: the Prisma v7 generator emits TypeScript source
 * into it, and it is excluded from every other gate too (.gitignore, ESLint ignores, coverage,
 * Stryker, tsconfig). Named as an exact path — skipping *any* directory called `generated` would
 * mean a hand-authored `src/ui/generated/theme.css` walks straight through the ban.
 */
const PRISMA_GENERATED_DIR = path.join(SRC, 'adapters/db/generated');

/**
 * Every stylesheet dialect a bundler in this repo could pick up. `.css` alone would leave the ban
 * blind to a `.scss` / `.sass` / `.less` file, which is not a smaller hole for being a less likely
 * one.
 */
const STYLESHEET_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.pcss', '.styl'];

/**
 * Any CSS color literal: hex (8/6/4/3 digit) or a color FUNCTION. Mirrors the ESLint-side patterns
 * in eslint.config.mjs — the two halves of AD-15 must ban the same thing, or a color simply moves
 * across the boundary that one of them cannot see. `color-mix()` is not a color literal (it
 * composes tokens), and `\b` keeps it and `--color-…` out.
 */
const COLOR_LITERAL =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(/i;

/**
 * A Tailwind `dark` variant, in a stylesheet (code review 2026-07-19).
 *
 * The F-5 ban was mechanized in eslint.config.mjs — and ESLint does not lint CSS, so it was scoped
 * to JS/TS files only and a variant written into a `.css` file under src/ shipped ungated. That is
 * the same stylesheet-shaped hole the color half of AD-15 has this suite for, left open on the
 * other half of the same contract; a hole is not smaller for being on the less likely side.
 *
 * The trailing colon is the whole discrimination, and it is what keeps real CSS out: `color-scheme:
 * light dark` and `@media (prefers-color-scheme: dark)` both put `dark` BEFORE a delimiter, never
 * before a colon. Mirrors the ESLint-side `DARK_VARIANT_PATTERN` — the two halves must ban the same
 * thing, or the variant simply moves across the boundary one of them cannot see.
 *
 * The colon may be BACKSLASH-ESCAPED, which the JS/TS side never has to consider: `dark:bg-x` is
 * how a person writes it in an `@apply`, and `.dark\:bg-x` is how it appears once it is a
 * selector. Matching only the first would let the ban be defeated by pasting compiled output.
 */
const DARK_VARIANT = /dark\\?:/i;

/** Every stylesheet under `root`, absolute paths, skipping `excludedDir` and anything below it. */
function stylesheetsUnder(root: string, excludedDir: string = PRISMA_GENERATED_DIR): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return full === excludedDir ? [] : stylesheetsUnder(full, excludedDir);
    }
    return STYLESHEET_EXTENSIONS.includes(path.extname(entry.name)) ? [full] : [];
  });
}

/**
 * Build a throwaway tree of `relative path -> contents` and return its root.
 *
 * Registered for removal with the test that created it. Left behind, roughly a dozen `no-hex-*`
 * trees accumulated in the system temp directory per `npm test` run — harmless on a laptop, and an
 * eventual ENOSPC on a long-lived runner or a small tmpfs, surfacing far from its cause.
 */
function fixtureTree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'no-hex-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return root;
}

describe('the scanner the CSS-side ban rests on', () => {
  it('descends into a directory merely NAMED `generated` — only the Prisma path is exempt', () => {
    const root = fixtureTree({ 'ui/generated/theme.css': ':root { color: #ff0000; }' });

    expect(stylesheetsUnder(root)).toEqual([path.join(root, 'ui/generated/theme.css')]);
  });

  it('skips the Prisma generated tree, and only it', () => {
    const root = fixtureTree({
      'adapters/db/generated/leak.css': ':root { color: #ff0000; }',
      'app/globals.css': '@import "tailwindcss";',
    });

    expect(stylesheetsUnder(root, path.join(root, 'adapters/db/generated'))).toEqual([
      path.join(root, 'app/globals.css'),
    ]);
  });

  it.each(STYLESHEET_EXTENSIONS)('sees a %s stylesheet', (extension) => {
    const root = fixtureTree({ [`ui/theme${extension}`]: '.a { color: #ff0000; }' });

    expect(stylesheetsUnder(root)).toEqual([path.join(root, `ui/theme${extension}`)]);
  });

  it('ignores files that are not stylesheets', () => {
    const root = fixtureTree({ 'ui/Badge.tsx': 'export const x = 1;', 'ui/notes.md': '#ff0000' });

    expect(stylesheetsUnder(root)).toEqual([]);
  });
});

describe('the color-literal pattern the CSS-side ban matches', () => {
  it.each([
    ['6-digit hex', '#f8fafc'],
    ['3-digit hex', '#fff'],
    ['8-digit hex', '#f8fafcff'],
    ['embedded hex', '1px solid #e2e8f0'],
    ['oklch', 'oklch(0.7 0.1 20)'],
    ['oklab', 'oklab(0.7 0.1 0.2)'],
    ['rgb', 'rgb(15 23 42)'],
    ['rgba', 'rgba(15, 23, 42, 0.5)'],
    ['hsl', 'hsl(210 40% 98%)'],
    ['hwb', 'hwb(210 20% 30%)'],
    ['lab', 'lab(52% 40 60)'],
    ['lch', 'lch(52% 70 40)'],
    ['color()', 'color(display-p3 1 0 0)'],
  ])('rejects %s', (_name, value) => {
    expect(COLOR_LITERAL.test(`.a { color: ${value}; }`)).toBe(true);
  });

  it.each([
    ['a token reference', 'var(--color-ink)'],
    ['a color-mix over tokens', 'color-mix(in srgb, var(--color-ink), transparent)'],
    ['a plain length', '0.25rem'],
  ])('accepts %s', (_name, value) => {
    expect(COLOR_LITERAL.test(`.a { color: ${value}; }`)).toBe(false);
  });
});

describe('the variant pattern the CSS-side F-5 ban matches', () => {
  it.each([
    ['a bare variant', 'dark:bg-surface-card'],
    ['a stacked variant', 'md:dark:bg-surface-card'],
    ['a hyphen-prefixed variant', 'group-hover-dark:bg-surface-card'],
    ['an escaped class selector, as Tailwind emits it', '.dark\\:bg-x { color: red; }'],
  ])('rejects %s', (_name, value) => {
    expect(DARK_VARIANT.test(value)).toBe(true);
  });

  // The cases that must NOT trip it, because they are how dark mode is legitimately spelled in this
  // repo's one generated stylesheet. `dark` sits before a delimiter in both, never before a colon.
  it.each([
    ['the color-scheme declaration', 'color-scheme: light dark;'],
    ['the media query the generated tokens use', '@media (prefers-color-scheme: dark) {'],
  ])('accepts %s', (_name, value) => {
    expect(DARK_VARIANT.test(value)).toBe(false);
  });

  // Not a false positive — the thing F-5 is actually about. A `--…-dark` custom property IS the
  // second token name the contract says does not exist ("one token name, two values"), and the
  // generated file deliberately emits none: `e2e/tokens.spec.ts` asserts
  // `--color-surface-base-dark` resolves to the empty string in the browser. Catching the
  // declaration that would create one is the ban working, not overreaching.
  it('rejects a `-dark` suffixed custom property — the second token F-5 says does not exist', () => {
    expect(DARK_VARIANT.test('--color-surface-base-dark: #0f172a;')).toBe(true);
  });
});

describe('the CSS half of the AD-15 color-literal ban', () => {
  it('finds the generated token file where the build is contracted to put it', () => {
    expect(stylesheetsUnder(SRC)).toContain(GENERATED_TOKENS);
  });

  it('finds color literals in the generated file — it is the one file that carries the palette', () => {
    expect(readFileSync(GENERATED_TOKENS, 'utf8')).toMatch(COLOR_LITERAL);
  });

  it('finds no color literal in any OTHER stylesheet under src/', () => {
    const offenders = stylesheetsUnder(SRC)
      .filter((file) => file !== GENERATED_TOKENS)
      .filter((file) => COLOR_LITERAL.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));

    expect(
      offenders,
      'AD-15: colors come from generated tokens (var(--color-…)), never a color literal. ' +
        'Change the value in DESIGN.md and run `npm run tokens:build`.',
    ).toEqual([]);
  });

  it('wires the generated file into the stylesheet Next actually loads', () => {
    expect(readFileSync(GLOBALS, 'utf8')).toContain('tokens.generated.css');
  });
});

// The CSS half of the F-5 `dark` variant ban (code review 2026-07-19). eslint.config.mjs closes the
// JS/TS half; ESLint does not lint CSS, so without this the ban had a hole exactly the width of a
// stylesheet — the same hole, on the same contract, that the color half above exists to close.
describe('the CSS half of the F-5 variant ban', () => {
  it('finds no Tailwind `dark` variant in any hand-authored stylesheet under src/', () => {
    const offenders = stylesheetsUnder(SRC)
      .filter((file) => file !== GENERATED_TOKENS)
      .filter((file) => DARK_VARIANT.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));

    expect(
      offenders,
      'F-5: one token name, two values. tokens.generated.css re-points every --color-* under ' +
        'prefers-color-scheme, so `bg-surface-card` already repaints itself and there is no ' +
        '`-dark` token to reach for. Write the single token utility.',
    ).toEqual([]);
  });

  // The generated file is exempt for the same reason it is exempt from the color ban: it is emitted
  // from DESIGN.md, drift-gated by `npm run tokens:check`, and never hand-edited — and its own
  // header comment discusses the variant it forbids. Exempting it is stated and tested rather than
  // assumed, so the exemption cannot quietly widen: this asserts it is the ONLY file relying on it.
  it('exempts only the generated token file, and only because it is generated', () => {
    const carrying = stylesheetsUnder(SRC)
      .filter((file) => DARK_VARIANT.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));

    expect(carrying).toEqual([path.relative(SRC, GENERATED_TOKENS)]);
  });
});
