import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// The two headline lint gates of story 1-5 — the AD-15 color-literal ban and the AD-14 randomness
// ban — were until now the only artifacts in this story with NO test of their own. They are
// CONFIGURATION, which makes them feel untestable; they are not. `ESLint.lintText` runs the real
// `eslint.config.mjs` (same resolution `npm run lint` uses) against a string with a pretend path,
// so every branch of the file-pattern matrix is assertable from a unit test.
//
// This matters more than a usual config test because flat-config rule entries REPLACE rather than
// merge. Four blocks in eslint.config.mjs now set `no-restricted-syntax`; a later, narrower block
// that forgets to re-declare an earlier selector silently REVOKES it for the files it matches, with
// no error and no diff signal. That is exactly how the AD-14 PRNG exemption was lost and how the
// hex ban could be lost tomorrow. The matrix below pins every intersection that has ever been
// load-bearing.

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The rule every ban in this suite is spelled through. */
const RULE = 'no-restricted-syntax';

let eslint: ESLint;

beforeAll(() => {
  // No `overrideConfigFile`: resolving the config the same way the CLI does is part of what is
  // under test. `cwd` is the repo root so `src/**` / `scripts/**` patterns match as they do in CI.
  eslint = new ESLint({ cwd: REPO_ROOT });
});

/** Every `no-restricted-syntax` message the real config produces for `code` at `filePath`. */
async function banMessages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === RULE).map((m) => m.message);
}

/** True when the config rejects `code` at `filePath` with any restricted-syntax ban. */
async function isRejected(code: string, filePath: string): Promise<boolean> {
  return (await banMessages(code, filePath)).length > 0;
}

describe('the AD-15 color-literal ban', () => {
  it('rejects a hex literal in a component', async () => {
    expect(await isRejected(`export const c = '#f8fafc';`, 'src/ui/Badge.tsx')).toBe(true);
  });

  it('rejects a hex literal EMBEDDED in a larger string', async () => {
    expect(await isRejected(`export const b = '1px solid #e2e8f0';`, 'src/ui/Badge.tsx')).toBe(true);
  });

  it('rejects a hex literal inside a template literal', async () => {
    expect(await isRejected('export const c = `#f8fafc`;', 'src/ui/Badge.tsx')).toBe(true);
  });

  it('rejects a hex literal in the pure core, where purityConfig re-declares the selectors', async () => {
    expect(await isRejected(`export const c = '#f8fafc';`, 'src/domain/money.ts')).toBe(true);
    expect(await isRejected(`export const c = '#f8fafc';`, 'src/application/x.ts')).toBe(true);
  });

  // The generator, its tests, and the contrast gate all handle hex as DATA. If the ban reached them
  // the token build could not be written at all.
  it('accepts hex under scripts/ and tests/, where hex is the subject matter', async () => {
    expect(await isRejected(`export const c = '#f8fafc';`, 'scripts/design-tokens/x.ts')).toBe(
      false,
    );
    expect(await isRejected(`export const c = '#f8fafc';`, 'tests/tokens/x.ts')).toBe(false);
  });

  // AD-15's risk is a color that escaped the token contract, not a color spelled in base 16.
  // shadcn/ui's Tailwind v4 templates — the copy-in that deferred-work.md names as the most likely
  // AD-15 violation — ship OKLCH, so a hex-only ban would wave the whole threat through.
  it.each([
    ['oklch', `export const c = 'oklch(0.7 0.1 20)';`],
    ['oklab', `export const c = 'oklab(0.7 0.1 0.2)';`],
    ['rgb', `export const c = 'rgb(15 23 42)';`],
    ['rgba', `export const c = 'rgba(15, 23, 42, 0.5)';`],
    ['hsl', `export const c = 'hsl(210 40% 98%)';`],
    ['hsla', `export const c = 'hsla(210, 40%, 98%, 0.5)';`],
    ['hwb', `export const c = 'hwb(210 20% 30%)';`],
    ['lab', `export const c = 'lab(52% 40 60)';`],
    ['lch', `export const c = 'lch(52% 70 40)';`],
    ['color()', `export const c = 'color(display-p3 1 0 0)';`],
  ])('rejects a %s color function in a component', async (_name, code) => {
    expect(await isRejected(code, 'src/ui/Badge.tsx')).toBe(true);
  });

  it('rejects a color function inside a template literal too', async () => {
    expect(await isRejected('export const c = `oklch(0.7 0.1 20)`;', 'src/ui/Badge.tsx')).toBe(true);
  });

  it('accepts the sanctioned way to spell a color — the token variable', async () => {
    expect(await isRejected(`export const c = 'var(--color-ink)';`, 'src/ui/Badge.tsx')).toBe(false);
  });

  it('accepts `color-mix()`, which composes tokens rather than naming a color', async () => {
    expect(
      await isRejected(
        `export const c = 'color-mix(in srgb, var(--color-ink), transparent)';`,
        'src/ui/Badge.tsx',
      ),
    ).toBe(false);
  });

  it('accepts an identifier that merely ENDS in a banned word', async () => {
    expect(await isRejected('export const c = getColor(1);', 'src/ui/Badge.tsx')).toBe(false);
  });

  // A KNOWN, DELIBERATE false positive, pinned so it stays known. `#feed`, `#face`, `#dad`, and
  // `#beef` are all valid hex spellings AND valid fragment identifiers; the two are not separable
  // syntactically, and contorting the selector to guess intent would cost the ban its teeth. The
  // escape hatch is a one-line `eslint-disable-next-line no-restricted-syntax` with a reason.
  it('also rejects a fragment identifier that happens to spell hex — the accepted edge', async () => {
    expect(await isRejected(`export const href = '#feed';`, 'src/ui/Nav.tsx')).toBe(true);
    expect(await isRejected(`export const q = '#beef';`, 'src/ui/Nav.tsx')).toBe(true);
  });

  it('lets the escape hatch through, so the edge is workable rather than blocking', async () => {
    const code = [
      '// eslint-disable-next-line no-restricted-syntax -- fragment identifier, not a color.',
      `export const href = '#feed';`,
    ].join('\n');

    expect(await isRejected(code, 'src/ui/Nav.tsx')).toBe(false);
  });

  it('accepts a fragment identifier that is not a valid hex spelling', async () => {
    expect(await isRejected(`export const href = '#payslips';`, 'src/ui/Nav.tsx')).toBe(false);
  });
});

// The token contract's other half (story 1-6). "No component ever writes `dark:`" was stated in
// five places — src/ui/README.md, src/app/globals.css, scripts/design-tokens/README.md, to-css.ts's
// header, and the 1-5 spec — and enforced in NONE, which is the exact unenforced-prohibition shape
// the color ban above exists to fix. There is one token name and two values, so a `dark:` variant
// can only ever reach for a `-dark` token that does not exist.
//
// Its layering is the interesting part, and the reason it is pinned here rather than trusted: the
// selectors are shared by the three `src/**`-scoped blocks, so the ban must hold in an ordinary
// component, in the pure core, AND in the PRNG port — the file whose narrower block silently
// revoked the randomness exemption in 1-5. It must NOT hold under scripts/ or tests/, which handle
// the string as data (this very file does).
describe('the F-5 `dark:` variant ban', () => {
  it('rejects a `dark:` utility in a component', async () => {
    expect(await isRejected(`export const c = 'dark:bg-surface-card';`, 'src/ui/Badge.tsx')).toBe(
      true,
    );
  });

  it('rejects a `dark:` utility EMBEDDED in a longer class string', async () => {
    expect(
      await isRejected(
        `export const c = 'rounded bg-surface-card dark:bg-surface-card p-3';`,
        'src/ui/Badge.tsx',
      ),
    ).toBe(true);
  });

  it('rejects a `dark:` utility inside a template literal', async () => {
    expect(await isRejected('export const c = `dark:text-ink`;', 'src/ui/Badge.tsx')).toBe(true);
  });

  it('rejects a `dark:` variant stacked after another variant', async () => {
    expect(await isRejected(`export const c = 'md:dark:bg-surface-tint';`, 'src/ui/Badge.tsx')).toBe(
      true,
    );
  });

  it('rejects it in the pure core, where purityConfig re-declares the selectors', async () => {
    expect(await isRejected(`export const c = 'dark:text-ink';`, 'src/domain/x.ts')).toBe(true);
    expect(await isRejected(`export const c = 'dark:text-ink';`, 'src/application/x.ts')).toBe(true);
  });

  // The layering trap, pinned. prngExemptionConfig is the LAST block matching prng.ts; if it ever
  // stops carrying the shared selector list, this file becomes the one corner of src/ where a
  // `dark:` variant lints clean — exactly how the AD-14 exemption was lost in 1-5.
  it('rejects it in the PRNG port too — the exemption is randomness-only', async () => {
    expect(await isRejected(`export const c = 'dark:text-ink';`, 'src/adapters/prng.ts')).toBe(true);
  });

  it('accepts it under scripts/ and tests/, where the string is the subject matter', async () => {
    expect(await isRejected(`export const c = 'dark:bg-surface-card';`, 'scripts/x.ts')).toBe(false);
    expect(await isRejected(`export const c = 'dark:bg-surface-card';`, 'tests/tokens/x.ts')).toBe(
      false,
    );
  });

  it('accepts the sanctioned spelling — one token name, no variant', async () => {
    expect(await isRejected(`export const c = 'bg-surface-card';`, 'src/ui/Badge.tsx')).toBe(false);
  });

  it('accepts a word that merely ENDS in "dark"', async () => {
    expect(await isRejected(`export const c = 'is-dark';`, 'src/ui/Badge.tsx')).toBe(false);
  });

  it('accepts the bare word "dark" with no variant colon', async () => {
    expect(await isRejected(`export const c = 'dark';`, 'src/ui/Badge.tsx')).toBe(false);
  });

  // The pattern itself, pinned in BOTH directions (code review 2026-07-19).
  //
  // The pattern used to carry a `\b` anchor justified as excluding `is-dark` / `text-darkroom`.
  // That justification was false — neither contains a colon, so neither could ever match either way
  // — and the two tests above passed identically with the anchor and without it, which made the
  // anchor a SURVIVING MUTANT in the file whose header claims to pin every intersection. The two
  // cases below are the ones that actually separate the two spellings, so the anchor can be neither
  // silently dropped nor silently restored.
  it('rejects a HYPHEN-prefixed variant — the case `\b` never excluded, because `-` is a boundary', async () => {
    expect(
      await isRejected(`export const c = 'group-hover-dark:bg-surface-tint';`, 'src/ui/Badge.tsx'),
    ).toBe(true);
  });

  it('rejects `dark:` preceded by a WORD character — the accepted over-approximation', async () => {
    // This is the ONLY thing the `\b` anchor ever excluded. It is now rejected, deliberately: the
    // same trade the hex ban makes for `#feed`, with the same one-line escape hatch. Re-adding the
    // anchor turns this red, which is the point.
    expect(await isRejected(`export const c = 'themedark:bg-surface-card';`, 'src/ui/Badge.tsx')).toBe(
      true,
    );
  });

  it('lets the escape hatch through for a genuine false positive', async () => {
    const code = [
      '// eslint-disable-next-line no-restricted-syntax -- prose, not a Tailwind variant.',
      `export const c = 'themedark: the legacy theme key';`,
    ].join('\n');

    expect(await isRejected(code, 'src/ui/Badge.tsx')).toBe(false);
  });
});

describe('the AD-14 randomness ban', () => {
  it('rejects Math.random in ordinary application code', async () => {
    expect(await isRejected('export const r = () => Math.random();', 'src/ui/Badge.tsx')).toBe(true);
  });

  it('rejects Math.random in the pure core', async () => {
    expect(await isRejected('export const r = () => Math.random();', 'src/domain/x.ts')).toBe(true);
  });

  it('rejects Math.random outside src/ too — the ban is repo-wide', async () => {
    expect(await isRejected('export const r = () => Math.random();', 'scripts/x.ts')).toBe(true);
  });

  // AD-14's single exemption: prng.ts IS the seeded randomness port, so it is the one file that
  // must be able to reach a randomness source. Today it is a throwing stub, which is the only
  // reason the revoked exemption did not already break the build; story 1-12 fills it in.
  it('ACCEPTS Math.random in the seeded PRNG port — the one AD-14 exemption', async () => {
    expect(await isRejected('export const r = () => Math.random();', 'src/adapters/prng.ts')).toBe(
      false,
    );
  });

  // The other half of the exemption, and the trap: granting prng.ts an exemption by adding it to
  // the color block's `ignores` would trade the randomness hole for a color hole.
  it('still rejects a color literal in the PRNG port — the exemption is randomness-only', async () => {
    expect(await isRejected(`export const c = '#f8fafc';`, 'src/adapters/prng.ts')).toBe(true);
    expect(await isRejected(`export const c = 'oklch(0.7 0.1 20)';`, 'src/adapters/prng.ts')).toBe(
      true,
    );
  });
});

describe('the Law-6 purity ban still applies where it did', () => {
  it('rejects `new Date()` in the pure core', async () => {
    expect(await isRejected('export const n = () => new Date();', 'src/domain/x.ts')).toBe(true);
  });

  it('does not reject `new Date()` in an adapter — the shell owns the clock', async () => {
    expect(await isRejected('export const n = () => new Date();', 'src/adapters/clock.ts')).toBe(
      false,
    );
  });
});
