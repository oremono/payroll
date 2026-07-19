import { expect, test, type Page } from '@playwright/test';

// The browser-level gate for the app shell (story 1-6).
//
// Everything asserted here is behaviour a unit test structurally cannot reach: landmarks in a real
// accessibility tree, Tab order from a fresh load, `aria-current` after a client-side navigation,
// focus returning to a button after a popover closes, and — the subtlest one — that the live region
// is the SAME DOM NODE before and after an as-of change. That last one is the whole reason AD-20
// says the region must not be remounted, and it is unobservable anywhere but here.
//
// No jsdom and no @testing-library anywhere in this repo (story constraint): pure logic is unit
// tested in the node suite (tests/domain, tests/application, tests/adapters, tests/ui), rendered
// behaviour is tested here, and the two never overlap.
//
// Runs against the production build Playwright serves on port 3100 — the artifact under test is
// what ships.

/** The seven ratified destinations, in sidebar order. Mirrors src/ui/nav-items.ts deliberately: a
 *  gate that imported the thing it gates would pass on any renaming of both at once. */
const ROUTES = [
  { path: '/', label: 'Home' },
  { path: '/employees', label: 'Employees' },
  { path: '/gender-insights', label: 'Gender Insights' },
  { path: '/payroll-totals', label: 'Payroll Totals' },
  { path: '/overdue', label: 'Overdue for Review' },
  { path: '/import', label: 'Import' },
  { path: '/settings', label: 'Settings' },
] as const;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * The UTC calendar date `daysAgo` days before now, in both the machine form the URL carries and the
 * display form DESIGN specifies.
 *
 * Computed rather than hard-coded because "today" is genuinely today: a fixed date would clamp to
 * today (a future as-of date is meaningless and is clamped by policy) the moment the calendar
 * passed it, and the suite would start asserting the wrong thing without failing.
 */
function utcDate(daysAgo: number): { iso: string; label: string } {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + 1;
  const day = at.getUTCDate();

  const pad = (value: number, width: number) => String(value).padStart(width, '0');

  return {
    iso: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
    label: `${pad(day, 2)} ${MONTHS[at.getUTCMonth()]} ${year}`,
  };
}

const TODAY = () => utcDate(0);
const PAST = () => utcDate(65);

/** The as-of trigger, found the way a screen-reader user finds it: by role and accessible name. */
function asOfButton(page: Page) {
  return page.getByRole('button', { name: /change as-of date$/ });
}

/**
 * The native date input inside the popover. Located by ROLE plus name rather than by label text:
 * three elements in the open popover have an accessible name containing "as-of date" — the trigger
 * button, the dialog, and the input — so a bare label lookup is ambiguous. Anchoring on the role is
 * also the honest assertion: this control must expose itself as a form field, not merely carry
 * matching text.
 */
function asOfInput(page: Page) {
  return page.getByRole('textbox', { name: 'As-of date' });
}

test.describe('landmarks and bypass', () => {
  for (const route of ROUTES) {
    test(`${route.path} exposes exactly one nav and one main landmark`, async ({ page }) => {
      await page.goto(route.path);

      await expect(page.locator('nav')).toHaveCount(1);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('nav')).toHaveAttribute('aria-label', 'Primary');
    });
  }

  test('the skip link is the FIRST Tab stop from a fresh load', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');

    const focused = page.locator(':focus');
    await expect(focused).toHaveText('Skip to content');
    await expect(focused).toHaveAttribute('href', '#main-content');
  });

  test('the skip link moves FOCUS into main, not merely the scroll position', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    // `main` carries tabIndex={-1} precisely so this is true. Without it the fragment scrolls and
    // the next Tab starts from the top of the document again — the bypass would be cosmetic.
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('the sidebar brand is not a heading, so the page title is the first h1', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Home');
  });
});

test.describe('aria-current follows the current path', () => {
  for (const route of ROUTES) {
    test(`${route.path} marks exactly one item current, and it is ${route.label}`, async ({
      page,
    }) => {
      await page.goto(route.path);

      const current = page.locator('nav [aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(route.label);
    });
  }

  test('aria-current MOVES on a client-side navigation, it is not baked into the first render', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('nav [aria-current="page"]')).toHaveText('Home');

    await page.getByRole('link', { name: 'Employees' }).click();
    await expect(page).toHaveURL(/\/employees$/);

    const current = page.locator('nav [aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('Employees');
  });
});

// The as-of date is PERSISTENT ambient provenance, not a per-page filter (DESIGN § Components →
// As-of date control: "always visible on every screen"). A sidebar link that dropped the param
// silently returned the whole application to today on every navigation, with no signal — which
// defeats both halves of the story's central promise: the date persists, and a bookmarked URL
// reproduces the view.
test.describe('the as-of date survives navigation', () => {
  test('a sidebar link carries the current asOf param onto the destination', async ({ page }) => {
    const past = PAST();
    await page.goto(`/?asOf=${past.iso}`);
    await expect(asOfButton(page).locator('time')).toHaveText(past.label);

    await page.getByRole('link', { name: 'Employees' }).click();

    // Both the address bar and the header still carry it. The URL matters because it is the state;
    // the header matters because it is what the person actually reads.
    await expect(page).toHaveURL(new RegExp(`/employees\\?asOf=${past.iso}$`));
    await expect(asOfButton(page).locator('time')).toHaveText(past.label);
  });

  test('every sidebar link carries it, not merely the first one', async ({ page }) => {
    const past = PAST();
    await page.goto(`/?asOf=${past.iso}`);

    for (const route of ROUTES) {
      await expect(page.getByRole('link', { name: route.label })).toHaveAttribute(
        'href',
        `${route.path}?asOf=${past.iso}`,
      );
    }
  });

  test('leaves hrefs bare when no asOf param is set — today needs no spelling out', async ({
    page,
  }) => {
    await page.goto('/');

    for (const route of ROUTES) {
      await expect(page.getByRole('link', { name: route.label })).toHaveAttribute(
        'href',
        route.path,
      );
    }
  });
});

test.describe('the as-of control', () => {
  test('is a single named button carrying both the date and the action', async ({ page }) => {
    await page.goto('/');

    const button = asOfButton(page);
    await expect(button).toHaveCount(1);
    // The accessible name BEGINS with the visible text, so SC 2.5.3 Label in Name holds.
    await expect(button).toHaveAccessibleName(`As of ${TODAY().label} — change as-of date`);
  });

  test('hides its calendar glyph from the accessibility tree', async ({ page }) => {
    await page.goto('/');

    await expect(asOfButton(page).locator('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('defaults to today when the URL carries no asOf param', async ({ page }) => {
    await page.goto('/');

    await expect(asOfButton(page).locator('time')).toHaveText(TODAY().label);
    await expect(page.getByTestId('as-of-echo')).toHaveText(TODAY().label);
  });

  test('reproduces a bookmarked view exactly — the URL is the state', async ({ page }) => {
    const past = PAST();
    await page.goto(`/?asOf=${past.iso}`);

    await expect(asOfButton(page).locator('time')).toHaveText(past.label);
    // The echo is SERVER-rendered from searchParams, so this asserts the server agreed, not merely
    // that a client component read the address bar.
    await expect(page.getByTestId('as-of-echo')).toHaveText(past.label);
  });

  test('opens a named dialog and closes it again on a second click', async ({ page }) => {
    await page.goto('/');
    const button = asOfButton(page);

    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();

    await expect(page.getByRole('dialog', { name: 'Change as-of date' })).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');

    await button.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('rounds trip: pick a date, and the URL, the control, and the SERVER echo all follow', async ({
    page,
  }) => {
    const past = PAST();
    await page.goto('/');

    await asOfButton(page).click();
    await asOfInput(page).fill(past.iso);
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page).toHaveURL(new RegExp(`\\?asOf=${past.iso}$`));
    await expect(asOfButton(page).locator('time')).toHaveText(past.label);
    await expect(page.getByTestId('as-of-echo')).toHaveText(past.label);
  });

  test('announces the recompute through the polite live region', async ({ page }) => {
    const past = PAST();
    await page.goto('/');

    const region = page.locator('#app-announcer');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveAttribute('aria-atomic', 'true');
    await expect(region).toHaveText('');

    await asOfButton(page).click();
    await asOfInput(page).fill(past.iso);
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(region).toHaveText(`Findings updated as of ${past.label}`);
  });

  test('leaves the live region as the SAME DOM node across the change', async ({ page }) => {
    const past = PAST();
    await page.goto('/');

    // Tag the live node with a property React does not manage. A remount produces a fresh element
    // with no tag; only the very same node still carries it. This is the assertion AD-20's "not
    // remounted by an as-of or threshold change" reduces to, and the reason it matters is that a
    // live region announces its CHANGES — a replaced region has no previous content to differ
    // from and most screen readers say nothing at all.
    await page.locator('#app-announcer').evaluate((node) => {
      node.setAttribute('data-node-probe', 'original');
    });

    await asOfButton(page).click();
    await asOfInput(page).fill(past.iso);
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByTestId('as-of-echo')).toHaveText(past.label);
    await expect(page.locator('#app-announcer')).toHaveAttribute('data-node-probe', 'original');
  });

  test('Esc closes the popover and returns focus to the button', async ({ page }) => {
    await page.goto('/');
    const button = asOfButton(page);

    await button.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Focus must come back to the trigger — leaving it on a removed element strands a keyboard
    // user at the top of the document.
    await expect(button).toBeFocused();
  });

  test('is reachable and operable by keyboard alone', async ({ page }) => {
    const past = PAST();
    await page.goto('/');

    await asOfButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    await asOfInput(page).fill(past.iso);
    // Enter submits the topmost form (EXPERIENCE § Interaction Primitives).
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('as-of-echo')).toHaveText(past.label);
  });

  test('appears on every route, because it is ambient provenance and not a filter', async ({
    page,
  }) => {
    for (const route of ROUTES) {
      await page.goto(route.path);
      await expect(asOfButton(page)).toHaveCount(1);
    }
  });
});

test.describe('hostile and stale URLs fall back to today', () => {
  const HOSTILE = [
    ['an impossible calendar date', 'asOf=2026-02-30'],
    ['a word', 'asOf=tomorrow'],
    ['an empty value', 'asOf='],
    ['a repeated param', 'asOf=2026-05-12&asOf=2026-01-01'],
    ['a timestamp', 'asOf=2026-05-12T00%3A00%3A00Z'],
    ['a far-future date', 'asOf=2099-01-01'],
  ] as const;

  for (const [name, query] of HOSTILE) {
    test(`renders normally and logs no error for ${name}`, async ({ page }) => {
      const problems: string[] = [];
      page.on('pageerror', (error) => problems.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error') {
          problems.push(message.text());
        }
      });

      await page.goto(`/?${query}`);

      // Falls back to today — and says so, visibly, in both places. The fallback is never silent.
      await expect(page.getByTestId('as-of-echo')).toHaveText(TODAY().label);
      await expect(asOfButton(page).locator('time')).toHaveText(TODAY().label);
      expect(problems).toEqual([]);
    });
  }
});
