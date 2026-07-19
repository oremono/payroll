import { expect, test } from '@playwright/test';

// The end-to-end half of the token gate (AD-15). The unit suites prove the STRING is right; this
// proves the pipeline is — that `@theme static` survives Tailwind's compile inside `next build`,
// reaches the browser as real custom properties on the document element, and that the
// `prefers-color-scheme: dark` override re-points the same names rather than adding new ones.
//
// It runs against the production build Playwright serves on port 3100 (playwright.config.ts), not
// against `next dev`: the artifact under test is what ships.
//
// Values are compared against what the MINIFIER emits, not against the source spelling: the
// production build runs Lightning CSS, which shortens `0.25rem` to `.25rem`. Colors are asserted
// only for values it cannot shorten (`#ffffff` would come back as `#fff`), so those assertions stay
// about the token rather than about the minifier.

/** Resolve a custom property off `:root`, as any component consuming it would. */
async function tokenValue(page: import('@playwright/test').Page, name: string): Promise<string> {
  return page.evaluate(
    (property) =>
      getComputedStyle(document.documentElement).getPropertyValue(property).trim().toLowerCase(),
    name,
  );
}

test.describe('generated design tokens reach the browser', () => {
  test('resolves representative color, type, radius, and spacing tokens on :root', async ({
    page,
  }) => {
    await page.goto('/');

    expect(await tokenValue(page, '--color-surface-base')).toBe('#f8fafc');
    expect(await tokenValue(page, '--color-ink')).toBe('#191c1e');
    expect(await tokenValue(page, '--font-mono')).toContain('jetbrains mono');
    expect(await tokenValue(page, '--text-body-md')).toBe('14px');
    expect(await tokenValue(page, '--text-body-md--line-height')).toBe('20px');
    // `0?` absorbs Lightning CSS's leading-zero elision.
    expect(await tokenValue(page, '--radius')).toMatch(/^0?\.25rem$/);
    expect(await tokenValue(page, '--spacing')).toBe('4px');
  });

  test('re-points the SAME token names under an emulated dark color scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    expect(await tokenValue(page, '--color-surface-base')).toBe('#0f172a');
    expect(await tokenValue(page, '--color-ink')).toBe('#e2e8f0');
  });

  test('keeps mode-invariant tokens invariant across the two color schemes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    // The dark block overrides colors only. A radius or a type scale that moved with the color
    // scheme would mean the generator leaked non-color tokens into the override.
    expect(await tokenValue(page, '--radius')).toMatch(/^0?\.25rem$/);
    expect(await tokenValue(page, '--text-body-md')).toBe('14px');
  });

  test('exposes NO `-dark` suffixed token — one name, two values (F-5)', async ({ page }) => {
    await page.goto('/');

    // POSITIVE CONTROL FIRST. The assertions below are pure negatives, and an empty string is also
    // what you get when the stylesheet never loaded at all — drop the `@import` from globals.css
    // and this test would still pass while claiming to prove F-5. Proving the light names DO
    // resolve is what makes the absence of the `-dark` names mean anything.
    expect(await tokenValue(page, '--color-surface-base')).toBe('#f8fafc');
    expect(await tokenValue(page, '--color-ink')).toBe('#191c1e');

    // If the generator had emitted the flat frontmatter literally, this would resolve to a value
    // and every component would face the two-token choice AD-15 exists to prevent.
    expect(await tokenValue(page, '--color-surface-base-dark')).toBe('');
    expect(await tokenValue(page, '--color-ink-dark')).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------
// Utilities, not just variables (code review 2026-07-19, P7).
//
// Everything above reads a custom property off `:root`. That proves the variables EXIST; it does
// not prove a single Tailwind utility reads them, which is the actual claim the token contract
// makes. Two keys are spelled specially for exactly that reason — `rounded.DEFAULT` becomes the
// bare `--radius` "because that is what the `rounded` utility reads", and `spacing.unit` becomes
// the bare `--spacing` "because v4 computes the numeric scale from it". Both claims are asserted
// in three places (to-css.ts, the README, the spec) and were tested in none.
//
// So these tests render real elements and read COMPUTED styles. The browser resolves those to
// absolute, canonical forms — `#f8fafc` comes back as `rgb(248, 250, 252)` and `0.25rem` as `4px`
// — which is the same kind of normalization the suite above already had to reconcile to for
// Lightning CSS, one layer further down.

/** The computed value of one CSS property on the first element matching `selector`. */
async function computed(
  page: import('@playwright/test').Page,
  selector: string,
  property: string,
): Promise<string> {
  return page.locator(selector).first().evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name).trim(),
    property,
  );
}

test.describe('Tailwind utilities resolve to the generated tokens', () => {
  test('`bg-surface-base` paints the color token, not a hard-coded value', async ({ page }) => {
    await page.goto('/');

    // #f8fafc, as the browser canonicalises it.
    expect(await computed(page, 'main', 'background-color')).toBe('rgb(248, 250, 252)');
  });

  test('`bg-surface-card` re-points under an emulated dark color scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    // #1e293b — the SAME utility on the SAME element, repointed by the media query alone. No
    // `dark:` variant appears anywhere in the app.
    expect(await computed(page, 'main p', 'background-color')).toBe('rgb(30, 41, 59)');
  });

  test('`rounded` reads the bare `--radius`, which is why DEFAULT is spelled specially', async ({
    page,
  }) => {
    await page.goto('/');

    // --radius: 0.25rem, against the 16px root font size.
    expect(await computed(page, 'main p', 'border-radius')).toBe('4px');
  });

  test('a numeric spacing utility computes off the bare `--spacing`', async ({ page }) => {
    await page.goto('/');

    // p-3 == 3 x --spacing (4px). If `spacing.unit` had not become the bare `--spacing`, the whole
    // numeric scale would resolve to nothing.
    expect(await computed(page, 'main', 'padding-top')).toBe('12px');
    expect(await computed(page, 'main', 'padding-left')).toBe('12px');
  });

  test('`text-body-md` carries the type scale AND its paired line height', async ({ page }) => {
    await page.goto('/');

    expect(await computed(page, 'main p', 'font-size')).toBe('14px');
    // The `--text-<name>--line-height` sub-property, applied by the same one utility.
    expect(await computed(page, 'main p', 'line-height')).toBe('20px');
  });

  test('`text-headline-lg` picks a different step of the same scale', async ({ page }) => {
    await page.goto('/');

    expect(await computed(page, 'h1', 'font-size')).toBe('24px');
    expect(await computed(page, 'h1', 'line-height')).toBe('32px');
  });

  test('`font-mono` resolves to the lifted mono family, `--font-sans` to the other', async ({
    page,
  }) => {
    await page.goto('/');

    // Eight typography styles collapse to two families; both halves of that lift are asserted, so
    // a renamed or dropped face fails here and not only in the unit suite.
    expect((await computed(page, 'main data', 'font-family')).toLowerCase()).toContain(
      'jetbrains mono',
    );
    expect((await computed(page, 'main p', 'font-family')).toLowerCase()).toContain(
      'hanken grotesk',
    );
  });
});
