import { expect, test } from '@playwright/test';

// Story 1-7 (NFR11a): proves a DEPLOYED instance actually serves. The preview pipeline runs this
// against the Vercel deployment it just created, via PLAYWRIGHT_BASE_URL.
//
// This is the ONLY reachability probe in the system, and it is deliberately outside the app: AD-21
// fixes the route-handler count at exactly two (the CAP-1 multipart upload and CSV export), so no
// /api/health endpoint may be added. Database connectivity is proven separately, and better, by
// the preview pipeline running the real integration suite against the Neon branch.
//
// Kept THIN on purpose. It asserts reachability, not content — the deployed page is still Story
// 1-1's placeholder, and its content becomes Story 1-6's. Asserting anything about the markup here
// would make this spec fail the moment 1-6 lands, for no benefit.
test('the deployed app serves the home page ("/")', async ({ page }) => {
  const response = await page.goto('/');

  // page.goto returns the response for the top-level navigation. Asserting on it (rather than only
  // that the page loaded) is what distinguishes "served" from "rendered Vercel's error page with a
  // 200-looking shell".
  expect(response?.status()).toBe(200);

  // A rendered document, not merely a status line: a body element that exists in the DOM.
  await expect(page.locator('body')).toBeAttached();
});
