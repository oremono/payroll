import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// WCAG 2.2 AA is the floor on every surface (NFR9; spine § Accessibility). Any axe violation fails
// the gate.
//
// Story 1-6 widens it from one placeholder page to all SEVEN routes, in BOTH color schemes. Both
// axes matter and for different reasons:
//
//   Every route — the shell is shared, but the surfaces are not, and a gate that judged only Home
//   would have nothing to say about the six pages a person can actually navigate to.
//
//   Both schemes — the dark token set is flagged PROVISIONAL in DESIGN.md § Dark mode: seventeen
//   values derived by inversion, never mocked, and until this story never rendered. Every contrast
//   claim made about them so far was made by COMPUTATION over the frontmatter. This is the first
//   time a browser resolves them on real elements and axe measures what it actually sees.

const ROUTES = [
  '/',
  '/employees',
  '/gender-insights',
  '/payroll-totals',
  '/overdue',
  '/import',
  '/settings',
  // An unknown path is a surface a person genuinely reaches — a stale bookmark, a mistyped URL, a
  // link that outlived its route — and until `src/app/not-found.tsx` existed it was the one page
  // Next rendered itself, unstyled, inside the shell, with a second `h1` and no axe coverage at
  // all. It is judged here exactly like the seven ratified destinations.
  '/no-such-page',
  // A DETAIL route (story 3-2). The id is deliberately one that cannot exist, so this page renders
  // the not-found branch of `src/app/employees/[id]/page.tsx` — which is the variant this job can
  // reach, since the `a11y` job builds and serves with NO database and the employee branch has no
  // rows to render. The populated employee detail is judged by the `browser-db` job instead, which
  // has both a browser and real rows.
  '/employees/00000000-0000-0000-0000-000000000000',
] as const;

const SCHEMES = ['light', 'dark'] as const;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const scheme of SCHEMES) {
  for (const route of ROUTES) {
    test(`${route} has no WCAG 2.2 AA axe violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(route);

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

      expect(results.violations).toEqual([]);
    });
  }
}

// The as-of popover is markup that does not exist until it is opened, so a page-load scan never
// sees it — including its native date input, the first form control in the product.
for (const scheme of SCHEMES) {
  test(`the opened as-of popover has no axe violations in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.getByRole('button', { name: /change as-of date$/ }).click();
    await expect(page.getByRole('dialog', { name: 'Change as-of date' })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });
}
