import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// WCAG 2.2 AA is the floor on every surface (NFR9; spine § Accessibility). Any axe violation fails
// the gate. Today this guards the placeholder home page; every surface added from Story 1-6 onward
// inherits the same automated pass.
test('home page ("/") has no WCAG 2.2 AA axe violations', async ({ page }) => {
  await page.goto('/');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});
