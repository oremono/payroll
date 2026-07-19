import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { countryFor, fixtureId, NAMES, seedEmployees } from './fixtures/seed-employees';

// The browser-level gate for the CAP-2 Employees surface (story 3-2).
//
// ## Why this spec needs a database, and why it is not in `test:browser`
//
// `e2e/import.spec.ts` stubs its one endpoint with `page.route` and stays database-free. That is not
// available here: the directory and the detail page are React Server Components calling use-cases
// IN-PROCESS (AD-21), so there is no request to intercept — the rows either exist or they do not.
//
// `src/adapters/db/client.ts` documents that the `check` and `a11y` CI jobs build and serve the app
// with NO database, which is why the Prisma client is constructed lazily. That property is worth
// keeping, and the existing DB-free axe scan of `/employees` is now a real test of the `unavailable`
// arm. So this file gets its own script (`test:browser:db`) and its own CI job, and the DB-free one
// is left exactly as it was.
//
// ## Serial, and re-seeded before every test
//
// Two tests here WRITE (a create and an edit). Under `fullyParallel: true` they would race every
// count assertion in the file. Serial mode puts the whole file in one worker in declaration order,
// and `beforeEach` re-seeds — thirty rows, one TRUNCATE and one INSERT — so each test starts from
// the same population and `npm run test:browser:db` twice in a row is green both times.

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  await seedEmployees();
});

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SCHEMES = ['light', 'dark'] as const;

/** The page size is `DEFAULT_LIST_LIMIT`; thirty rows is one full page and a short second one. */
const PAGE_SIZE = 25;
const TOTAL = NAMES.length;

/** The four fixture names containing `ana`, case-insensitively. */
const ANA_MATCHES = ['Ana Silva', 'Dana Whitmore', 'Diana Rossi', 'Hana Watanabe'];

/** Body children that are allowed NOT to be inert while the modal is open. */
const dialogInertReport = (page: Page) =>
  page.evaluate(() => {
    const spared = ['app-announcer', '__next-route-announcer__'];
    const wrapper = document.querySelector('[role="dialog"]');
    return Array.from(document.body.children)
      .filter((child) => !spared.includes(child.id))
      .filter((child) => !(wrapper !== null && child.contains(wrapper)))
      .map((child) => ({ tag: child.tagName, inert: child.hasAttribute('inert') }));
  });

/**
 * Wait until the `/` shortcut's listener is installed, using the shortcut itself as the probe.
 *
 * Needed because of a real hydration behaviour rather than as a blanket sleep: React RESETS an
 * uncontrolled input to its `defaultValue` when it hydrates, so a character typed into the search
 * field before hydration is silently discarded — a test that typed into it immediately after
 * `goto` would flake on exactly the assertion it exists to make. React replays a pre-hydration
 * CLICK, which is why the dialog tests need no such probe, but it does not replay text entry.
 *
 * `type`, not `press`: Playwright's `press('/')` fires the key events but inserts no text, so a
 * suppression assertion would pass without `preventDefault` ever running.
 */
async function waitForShortcut(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      await page.getByRole('link', { name: 'Employees', exact: true }).focus();
      await page.keyboard.type('/');
      return page.evaluate(() => document.activeElement?.id ?? '');
    })
    .toBe('employee-search');
}

/**
 * A control inside the open dialog.
 *
 * Scoped AND exact, both deliberately: `getByLabel('Name')` matches by substring and would also
 * resolve the toolbar's "Search employees by name" field, which is on the same page and outside the
 * modal.
 */
function dialogField(page: Page, label: string) {
  return page.getByRole('dialog').getByLabel(label, { exact: true });
}

async function openCreateDialog(page: Page): Promise<void> {
  await page.goto('/employees');
  await page.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('dialog', { name: 'Add employee' })).toBeVisible();
}

test.describe('the directory', () => {
  test('names its six columns and pages the thirty employees by name', async ({ page }) => {
    await page.goto('/employees');

    for (const header of ['Name', 'Role', 'Level', 'Country', 'Gender', 'Hire date']) {
      await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    }

    // Header row plus one page of data rows — the page size, not the whole table.
    await expect(page.getByRole('row')).toHaveCount(PAGE_SIZE + 1);

    // Ordered by `(name, id)`. The first row is the alphabetically first fixture name.
    await expect(page.getByRole('row').nth(1)).toContainText('Aaron Fields');

    // Every number comes from the payload's ECHOED effective limit and offset.
    await expect(
      page.getByText(`Employees 1–${String(PAGE_SIZE)} of ${String(TOTAL)} · Page 1 of 2`),
    ).toBeVisible();
  });

  test('renders codes verbatim, including a code the form can never offer', async ({ page }) => {
    // `Zoltan Kovacs` holds a RETIRED role. `is_active` gates PICKABILITY, never visibility: the
    // code must still render here, which is exactly why the table shows codes rather than names —
    // display names live only on `EmployeeFormOptions`, which excludes inactive rows, so a join
    // would leave this cell blank at the moment something is already wrong.
    await page.goto('/employees?page=2');

    const row = page.getByRole('row').filter({ hasText: 'Zoltan Kovacs' });
    await expect(row).toContainText('retired_role');
  });

  test('spells gender as MALE / FEMALE, never abbreviated or title-cased', async ({ page }) => {
    await page.goto('/employees');

    const row = page.getByRole('row').filter({ hasText: 'Aaron Fields' });
    await expect(row).toContainText('FEMALE');
    await expect(page.getByRole('cell', { name: 'Female', exact: true })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'F', exact: true })).toHaveCount(0);
  });

  test('has no `<h1>` — the header owns the document’s one top-level heading', async ({ page }) => {
    await page.goto('/employees');

    await expect(page.locator('main h1')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveCount(1);
  });
});

test.describe('the pager', () => {
  test('reaches the short last page by keyboard and stops at both ends', async ({ page }) => {
    await page.goto('/employees');

    // On page 1 there is no previous page, so there is no URL to point at — the control stops
    // being a link rather than becoming a link to nowhere.
    await expect(page.getByRole('link', { name: 'Previous page' })).toHaveCount(0);
    await expect(page.getByText('Previous page')).toBeVisible();

    await page.getByRole('link', { name: 'Next page' }).focus();
    await page.keyboard.press('Enter');

    await expect(
      page.getByText(`Employees 26–${String(TOTAL)} of ${String(TOTAL)} · Page 2 of 2`),
    ).toBeVisible();
    // Five data rows plus the header — the short LAST page, not a padded one.
    await expect(page.getByRole('row')).toHaveCount(TOTAL - PAGE_SIZE + 1);
    await expect(page.getByRole('link', { name: 'Next page' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Previous page' }).click();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(PAGE_SIZE + 1);
    // `page` is DROPPED when it returns to 1 — the first page is the default, and spelling it out
    // would make two URLs for one view.
    expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  });

  test('renders the last page for a page number past the end, with everything agreeing', async ({
    page,
  }) => {
    await page.goto('/employees?page=99');

    // The rows, the status line, and the pager all describe the SAME page — the read is retried at
    // the last page's offset rather than showing a pager beside an empty table.
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(TOTAL - PAGE_SIZE + 1);
    await expect(page.getByRole('row').nth(1)).toContainText('Wanda Kaminski');
  });

  test('survives hostile page numbers without a 500', async ({ page }) => {
    for (const hostile of ['-5', 'abc', '1e9', '0']) {
      const response = await page.goto(`/employees?page=${hostile}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByText(/Page \d+ of 2/)).toBeVisible();
    }
  });

  test('carries `asOf` and `q` across a page change, and changes only `page`', async ({ page }) => {
    await page.goto('/employees?asOf=2026-01-01');

    await page.getByRole('link', { name: 'Next page' }).click();
    // `<Link>` navigates on the client, so the address bar settles after the render — wait for the
    // page to actually be page 2 before reading it.
    await expect(page.getByText('Page 2 of 2')).toBeVisible();

    const url = new URL(page.url());
    expect(url.searchParams.get('asOf')).toBe('2026-01-01');
    expect(url.searchParams.get('page')).toBe('2');
  });
});

test.describe('search', () => {
  test('matches a case-insensitive substring of the name only', async ({ page }) => {
    await page.goto('/employees');

    // UPPERCASE deliberately: a search that matched only the spelling it was given would prove
    // nothing about the `mode: 'insensitive'` the adapter asks for.
    await page.getByLabel('Search employees by name').fill('ANA');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByRole('row')).toHaveCount(ANA_MATCHES.length + 1);
    for (const name of ANA_MATCHES) {
      await expect(page.getByRole('cell', { name })).toBeVisible();
    }
    await expect(page.getByText(`Employees 1–4 of 4 · Page 1 of 1`)).toBeVisible();
  });

  test('drops the page position on a new search while keeping `asOf`', async ({ page }) => {
    await page.goto('/employees?asOf=2026-01-01&page=2');

    await page.getByLabel('Search employees by name').fill('ana');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('Employees 1–4 of 4')).toBeVisible();

    const url = new URL(page.url());
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.get('asOf')).toBe('2026-01-01');
    expect(url.searchParams.get('q')).toBe('ana');
  });

  test('states a no-match honestly, keeps the term, and never offers the first-run copy', async ({
    page,
  }) => {
    await page.goto('/employees?q=zzz');

    await expect(page.getByText('No employee’s name contains “zzz”.')).toBeVisible();
    // Telling someone with thirty employees to import a spreadsheet because they mistyped a name
    // is a false statement about their data.
    await expect(page.getByText('Import a spreadsheet to begin')).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByLabel('Search employees by name')).toHaveValue('zzz');
  });

  test('answers a repeated `q` with no filter rather than an outage', async ({ page }) => {
    const response = await page.goto('/employees?q=a&q=b');

    expect(response?.status()).toBe(200);
    await expect(page.getByText(`Employees 1–${String(PAGE_SIZE)} of ${String(TOTAL)}`)).toBeVisible();
  });
});

test.describe('the `/` shortcut', () => {
  test('focuses the search field from a link, and suppresses the character', async ({ page }) => {
    await page.goto('/employees');

    await waitForShortcut(page);

    await expect(page.getByLabel('Search employees by name')).toBeFocused();
    // The default `/` insertion is suppressed BEFORE focus moves — otherwise the character lands
    // in the field the shortcut just focused.
    await expect(page.getByLabel('Search employees by name')).toHaveValue('');
  });

  test('is inert while focus is in an editable field — the character types normally', async ({
    page,
  }) => {
    await page.goto('/employees');

    await waitForShortcut(page);

    const search = page.getByLabel('Search employees by name');
    await search.focus();
    await page.keyboard.type('/');

    // The guard let the character through: focus is in an editable field, so the shortcut is inert
    // and `/` types the way it would in any other text box.
    await expect(search).toHaveValue('/');
  });

  test('is inert while the header date input holds focus inside an open dialog', async ({
    page,
  }) => {
    // The concrete reason the guard exists, named in `deferred-work.md`: the shell put a native
    // date input in the header, and a naive global handler would swallow `/` while someone typed
    // into it. Both guards cover this — the target is editable AND a dialog is open.
    await page.goto('/employees');
    await page.getByRole('button', { name: /change as-of date$/ }).click();
    await expect(page.getByRole('dialog', { name: 'Change as-of date' })).toBeVisible();

    await page.locator('#as-of-date').focus();
    await page.keyboard.type('/');

    await expect(page.getByLabel('Search employees by name')).not.toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Change as-of date' })).toBeVisible();
  });
});

test.describe('the detail route', () => {
  test('is reached from a row and states the identity fields only', async ({ page }) => {
    await page.goto('/employees?asOf=2026-01-01');
    await page.getByRole('link', { name: 'Ana Silva' }).click();
    await expect(page.getByRole('heading', { name: 'Ana Silva' })).toBeVisible();

    await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}/);
    // The as-of date is ambient provenance and survives the hop.
    expect(new URL(page.url()).searchParams.get('asOf')).toBe('2026-01-01');

    await expect(page.getByRole('heading', { name: 'Ana Silva' })).toBeVisible();
    for (const term of ['Role', 'Level', 'Country', 'Gender', 'Hire date']) {
      await expect(page.getByText(term, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('product_manager')).toBeVisible();
    await expect(page.getByText('MALE', { exact: true })).toBeVisible();

    // Currency FOLLOWS from country and is never chosen (AD-6).
    await expect(page.getByText(/Currency USD/)).toBeVisible();

    // CAP-3's entry point, and ONLY its entry point (story 4-2). This assertion used to read
    // `getByText(/salary/i)).toHaveCount(0)` — it encoded the hole this page's own docstring
    // recorded ("no record-a-change entry point (Epic 4)"), and Epic 4 is what fills it. What
    // replaces it is the same claim minus the part story 4-2 delivers.
    await expect(page.getByRole('button', { name: 'Record a salary change' })).toBeVisible();

    // NOTHING CAP-4/CAP-5 owns, and no salary AMOUNT anywhere. The timeline is Epic 5 and the
    // percent change and `(Hire)` label are rendered there, not stored and not here. Scoped to
    // `main` because the shell's `<h1>` falls back to the product name — "Salary Management for
    // ACME HR" — on a route no nav item claims, which this one is.
    await expect(page.locator('main').getByText(/current salary/i)).toHaveCount(0);
    await expect(page.locator('main').getByText(/salary timeline/i)).toHaveCount(0);
    await expect(page.locator('main').getByText('(Hire)')).toHaveCount(0);
    await expect(page.locator('main').getByText(/%/)).toHaveCount(0);
    await expect(page.locator('main').getByText(/peer/i)).toHaveCount(0);
    // A rendered MONEY AMOUNT, whatever currency it is in. The six probes that replaced the old
    // blanket `getByText(/salary/i)).toHaveCount(0)` are all vocabulary probes, and a formatted
    // amount matches none of them: `formatMoney` renders `symbol + grouped digits + ISO code` and
    // says the word "salary" nowhere. This is the shape-level backstop for the claim that no salary
    // is displayed on the detail page until Epic 5 renders the timeline.
    // `\p{Sc}` — the Unicode CURRENCY SYMBOL category, not a hand-listed five. A salary rendered in
    // any currency outside `$₹¥€£` evaded the enumerated set entirely, which made the backstop
    // narrowest exactly where a missed case is most likely.
    await expect(page.locator('main').getByText(/\p{Sc}\s*\d/u)).toHaveCount(0);
    await expect(page.locator('main').getByText(/\d\s*(?:INR|USD|JPY|EUR|GBP)\b/)).toHaveCount(0);
  });

  test('says no employee has an id nobody holds', async ({ page }) => {
    const response = await page.goto('/employees/00000000-0000-4000-8000-000000009999');

    // The STATUS is 200, not 404, and that is measured rather than wished for. `notFound()` can
    // only set a status while the response headers are still unsent, and this app's root layout
    // awaits `connection()` — every route under it is dynamic and has begun streaming by the time
    // the page component runs. An unmatched ROUTE (`/no-such-page`) still answers 404, because that
    // is decided by the router before any render. The rendered answer is correct either way; the
    // status code is not, and it is recorded in `deferred-work.md` rather than asserted away.
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'No employee has that id' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the employee directory' })).toBeVisible();
  });

  test('treats a hand-edited, non-UUID id as ordinary input, not a crash', async ({ page }) => {
    // `employee.id` is `@db.Uuid`, so Prisma raises a cast error before any row is examined — the
    // adapter answers `null` instead, because an id arrives from a URL segment a person can edit.
    const response = await page.goto('/employees/not-a-uuid');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'No employee has that id' })).toBeVisible();
  });

  test('omits the currency line when the country is no longer among the active options', async ({
    page,
  }) => {
    // `Beatriz Gomez` sits on a RETIRED country. `EmployeeFormOptions` excludes inactive rows, so
    // there is nothing to state — and "Currency undefined" would be a rendering bug appearing
    // exactly when something is already wrong.
    await page.goto(`/employees/${fixtureId(NAMES.indexOf('Beatriz Gomez'))}`);

    await expect(page.getByRole('heading', { name: 'Beatriz Gomez' })).toBeVisible();
    await expect(page.getByText('ZZ', { exact: true })).toBeVisible();
    await expect(page.getByText(/Currency/)).toHaveCount(0);

    // The WITHHELD arm of `salaryChangeAvailability`, asserted rather than inferred. The line above
    // passes only because the withheld statement happens to spell "currency" in lower case — it
    // says nothing about whether the statement is present, or correct.
    //
    // The tables were read PERFECTLY for this employee: `options.kind === 'options'`, which is why
    // `Edit employee` renders right beside this paragraph. A statement claiming the reference
    // tables could not be read would contradict the control next to it, so the copy names the
    // outcome and no cause (deferred #6 owns telling the causes apart).
    await expect(
      page.getByText(
        'The currency this employee is paid in could not be determined, so a salary change cannot be recorded right now.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit employee' })).toBeVisible();
    // And no form is offered — the whole point of withholding it.
    await expect(page.getByRole('button', { name: 'Record a salary change' })).toHaveCount(0);
  });
});

test.describe('the create dialog', () => {
  test('is a real modal: named, focused, backdropped, inert behind, and scroll-locked', async ({
    page,
  }) => {
    await openCreateDialog(page);

    const dialog = page.getByRole('dialog', { name: 'Add employee' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus lands on the FIRST FIELD, not on the dialog and not on the close button.
    await expect(dialogField(page, 'Name')).toBeFocused();

    // Everything behind it is inert. Checked structurally rather than by probing one element, so a
    // future sibling added to the layout cannot quietly escape.
    const report = await dialogInertReport(page);
    expect(report.length).toBeGreaterThan(0);
    expect(report.every((child) => child.inert)).toBe(true);

    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');

    // A NAMED close button, not an icon-only glyph.
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
  });

  test('contains Tab in both directions', async ({ page }) => {
    await openCreateDialog(page);

    // Focusable order inside the dialog: Close, Name, Role, Level, Country, Gender, Hire date,
    // submit. Focus starts on Name.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();

    // Backwards off the FIRST focusable wraps to the LAST — it does not escape into the page.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Create employee' })).toBeFocused();

    // And forwards off the last wraps back to the first.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
  });

  test('closes on Esc and returns focus to the control that opened it', async ({ page }) => {
    await openCreateDialog(page);

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Add employee' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add employee' })).toBeFocused();
    // The background is released again.
    expect(await page.evaluate(() => document.documentElement.style.overflow)).not.toBe('hidden');
  });

  test('offers no inactive role and no currency chooser', async ({ page }) => {
    await openCreateDialog(page);

    // `is_active` gates PICKABILITY: the retired role renders in the table and must not be
    // choosable for a NEW write.
    await expect(dialogField(page, 'Role').getByRole('option', { name: 'Retired Role' })).toHaveCount(
      0,
    );
    await expect(dialogField(page, 'Country').getByRole('option', { name: 'Nowhere' })).toHaveCount(0);
    // Currency FOLLOWS from country (AD-6) — there is no control that could choose one.
    await expect(dialogField(page, 'Currency')).toHaveCount(0);
    // No salary field: CAP-3 owns the first salary.
    await expect(page.getByRole('dialog').getByLabel(/salary/i)).toHaveCount(0);
  });
});

test.describe('a rejected submission', () => {
  test('reports every field at once, under its own control, and takes focus there', async ({
    page,
  }) => {
    await openCreateDialog(page);
    await page.getByRole('button', { name: 'Create employee' }).click();

    // A form reports per FIELD — surfacing one problem at a time forces a round-trip per mistake.
    for (const label of ['Name', 'Role', 'Level', 'Country', 'Gender', 'Hire date']) {
      const control = dialogField(page, label);
      await expect(control).toHaveAttribute('aria-invalid', 'true');

      const describedBy = await control.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      await expect(page.locator(`#${String(describedBy)}`)).toContainText(`${label} is required.`);
    }

    // Focus moves to the PROBLEM, not merely to a message about it (WCAG 2.2 AA SC 3.3.1).
    await expect(dialogField(page, 'Name')).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Add employee' })).toBeVisible();
  });

  test('renders no spreadsheet vocabulary and no column token', async ({ page }) => {
    await openCreateDialog(page);
    await page.getByRole('button', { name: 'Create employee' }).click();
    await expect(dialogField(page, 'Name')).toHaveAttribute('aria-invalid', 'true');

    const text = (await page.getByRole('dialog', { name: 'Add employee' }).textContent()) ?? '';
    for (const banned of ['cell', 'hire_date', 'role_code', 'level_code', 'country_code']) {
      expect(text).not.toContain(banned);
    }
  });

  test('uses no alert role, and keeps every value the person entered', async ({ page }) => {
    await openCreateDialog(page);
    await dialogField(page, 'Name').fill('Kept Through Rejection');
    await page.getByRole('button', { name: 'Create employee' }).click();

    await expect(dialogField(page, 'Role')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialogField(page, 'Name')).toHaveValue('Kept Through Rejection');
    // Excludes Next's injected route announcer, which is not ours (see `import.spec.ts`).
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
  });

  test('announces the outcome once, in the app-level live region', async ({ page }) => {
    await openCreateDialog(page);
    await page.getByRole('button', { name: 'Create employee' }).click();

    await expect(page.locator('#app-announcer')).toHaveText(
      'The employee was not saved. 6 reasons.',
    );
    await expect(page.locator('#app-announcer')).toHaveCount(1);
  });
});

test.describe('a successful create', () => {
  test('is completable from the keyboard alone and lands in the directory', async ({ page }) => {
    await page.goto('/employees');

    // Keyboard only, from here down — no pointer input at any step.
    await page.getByRole('button', { name: 'Add employee' }).focus();
    await page.keyboard.press('Enter');
    await expect(dialogField(page, 'Name')).toBeFocused();

    await page.keyboard.type('Aaliyah Keyboard');

    // ArrowDown on a closed `<select>` advances the selection — the empty "Choose …" option is
    // first, so one press picks the first real value.
    for (let field = 0; field < 4; field += 1) {
      await page.keyboard.press('Tab');
      await page.keyboard.press('ArrowDown');
    }

    await page.keyboard.press('Tab');
    // A native date input takes SEGMENT keystrokes. The value is asserted rather than assumed, so a
    // locale whose segment order differs fails loudly here instead of silently seeding a wrong day.
    await page.keyboard.type('01012020');
    await expect(dialogField(page, 'Hire date')).toHaveValue('2020-01-01');

    // Enter, from inside the field — implicit form submission, which is exactly the "Enter submits"
    // half of the dialog contract. Tab is deliberately NOT used to reach the submit button: Tab
    // inside a date input walks its month/day/year segments rather than leaving the control, so a
    // single Tab here would land back on the same input.
    await page.keyboard.press('Enter');

    // The dialog closes and focus returns to the control that opened it.
    await expect(page.getByRole('dialog', { name: 'Add employee' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add employee' })).toBeFocused();
    await expect(page.locator('#app-announcer')).toHaveText('Employee created.');

    // The directory refreshed itself — the Server Action's own `revalidatePath` did that; this
    // surface adds no cache invalidation of its own (Law 7).
    // Generous timeout, deliberately. Everything above proves the WRITE committed — the dialog
    // closed, focus returned, and the app-level live region carries its sentence. What is still in
    // flight is Next's client-side router refresh re-rendering the directory's RSC payload after
    // the Server Action's `revalidatePath`, and on a loaded CI runner that regeneration can outrun
    // Playwright's 5s default. Raising the ceiling cannot mask a broken revalidation: if the
    // invalidation never happened the row never appears and this still fails, just later.
    await expect(page.getByRole('cell', { name: 'Aaliyah Keyboard' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(`Employees 1–${String(PAGE_SIZE)} of ${String(TOTAL + 1)}`),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('the edit dialog', () => {
  test('presents country as read-only text with the reason, and offers no control for it', async ({
    page,
  }) => {
    await page.goto(`/employees/${fixtureId(NAMES.indexOf('Elena Rossi'))}`);
    await page.getByRole('button', { name: 'Edit employee' }).click();

    const dialog = page.getByRole('dialog', { name: 'Edit employee' });
    await expect(dialog).toBeVisible();

    // Not a disabled select: a disabled control still says "this is a control", and offering one
    // that can never be used is the country-edit affordance AD-6 forbids.
    await expect(dialog.getByRole('combobox', { name: 'Country' })).toHaveCount(0);
    await expect(dialog.getByText('Country', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/cannot be changed/)).toBeVisible();
  });

  test('opens holding the employee’s own values and saves a change', async ({ page }) => {
    await page.goto(`/employees/${fixtureId(NAMES.indexOf('Elena Rossi'))}`);
    await page.getByRole('button', { name: 'Edit employee' }).click();

    await expect(dialogField(page, 'Name')).toHaveValue('Elena Rossi');
    await dialogField(page, 'Name').fill('Elena Rossi-Bianchi');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByRole('dialog', { name: 'Edit employee' })).toHaveCount(0);
    await expect(page.locator('#app-announcer')).toHaveText('Employee updated.');
    // The DETAIL page revalidated too, not only the list — an edit that invalidated one would leave
    // a page contradicting the list it was reached from.
    // Same reasoning as the create case above: the write is already proven committed by the
    // announcer assertion; only the detail route's re-render is still in flight.
    await expect(page.getByRole('heading', { name: 'Elena Rossi-Bianchi' })).toBeVisible({
      timeout: 15_000,
    });
  });
});

/**
 * The detail page of an employee whose country is INDIA — so the currency is INR (AD-6).
 *
 * DERIVED from the seed's own country assignment rather than named. `countryFor` hands most
 * employees `ACTIVE_COUNTRIES[index % 2]`, so any given name is Indian only by virtue of its
 * POSITION in `NAMES`: inserting one name above it silently flips the country, and the four tests
 * below that assert `Currency INR` and INR's two-digit precision would fail pointing at the salary
 * panel rather than at the fixture that actually moved.
 */
const INR_EMPLOYEE = NAMES.findIndex((name, index) => countryFor(name, index) === 'IN');

/**
 * Press Tab until focus reaches `id`, or give up.
 *
 * A COUNT of Tab presses would be wrong here: Chrome's `<input type="date">` is three internal
 * segments and Tab walks them one at a time, so "one Tab moves to the next field" is false for the
 * first control on this form and would have this test typing an amount into a year segment. What
 * the flow actually promises is that the next field is REACHABLE from the keyboard, which is what
 * this asserts.
 */
async function tabTo(page: Page, id: string): Promise<void> {
  for (let press = 0; press < 8; press += 1) {
    if ((await page.evaluate(() => document.activeElement?.id ?? '')) === id) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached #${id}`);
}

/**
 * `YYYY-MM-DD` spelled the way `formatPlainDate` spells it — `20 Jul 2026`.
 *
 * Reimplemented here rather than imported: this file is the BROWSER-LEVEL gate, and asserting the
 * rendered sentence with the very function that produced it would assert nothing about it. The
 * spelling is fixed by `tests/domain/plain-date.test.ts`; this only has to agree with it.
 */
function spellDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${day ?? ''} ${months[Number(month) - 1] ?? ''} ${year ?? ''}`;
}

/** `iso` and the calendar day either side of it, as `YYYY-MM-DD`. */
function adjacentDates(iso: string): readonly string[] {
  const midday = Date.parse(`${iso}T12:00:00Z`);
  const DAY_MS = 86_400_000;
  return [midday - DAY_MS, midday, midday + DAY_MS].map((at) =>
    new Date(at).toISOString().slice(0, 10),
  );
}

async function openSalaryPanel(page: Page): Promise<void> {
  await page.goto(`/employees/${fixtureId(INR_EMPLOYEE)}`);
  await page.getByRole('button', { name: 'Record a salary change' }).click();
  await expect(page.getByRole('dialog', { name: 'Record a salary change' })).toBeVisible();
}

// -------------------------------------------------------------------------------------------
// CAP-3's one interactive surface (story 4-2).
//
// The panel's markup does not exist until it is opened, so a page-load scan never sees any of this.
// Each test below starts from the `beforeEach` re-seed — thirty employees and ZERO salary records —
// and asserts only its own starting state.
//
// Nothing here reads a recorded salary back. There is no surface that displays one: the salary
// timeline is CAP-4 (Epic 5). The announcement is the receipt, which is Law 7's
// one-capability-at-a-time cost rather than a defect.

test.describe('recording a salary change', () => {
  test('records a change with the keyboard alone, and announces it', async ({ page }) => {
    await page.goto(`/employees/${fixtureId(INR_EMPLOYEE)}`);

    // Opened from the keyboard, not the mouse: the whole flow must be completable without one.
    const trigger = page.getByRole('button', { name: 'Record a salary change' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Record a salary change' })).toBeVisible();

    // Focus lands on the FIRST FIELD on open — not on the dialog, not on the close button.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe('salary-field-effective_from');

    // The date defaults to today, read once through the clock port at the page boundary (AD-11).
    // Asserted as TODAY'S DATE, not merely non-empty: "today" in UTC is the whole content of the
    // claim, and a field seeded with any other date would satisfy a non-empty check.
    //
    // "Today" is computed HERE, in the test process, and compared to a date the SERVER computed —
    // two independent clock reads. They disagree for the one second per day either side of UTC
    // midnight, which is a real intermittent failure and the third such source this file carries.
    // So the boundary is tolerated in the ONE place it can be: the field must hold today or the day
    // either side of it, and every assertion after this one is derived from the value the field
    // actually holds rather than from a second reading of the clock.
    const nowIso = new Date().toISOString().slice(0, 10);
    const effectiveFrom = await dialogField(page, 'Effective date').inputValue();
    expect(adjacentDates(nowIso)).toContain(effectiveFrom);

    await tabTo(page, 'salary-field-amount_minor');
    // Typed the way screen-09 specifies it: MAJOR units, with grouping separators.
    await page.keyboard.type('21,50,000');
    // Enter saves — a real submit button in a real form, no click required.
    await page.keyboard.press('Enter');

    await expect(page.getByRole('dialog', { name: 'Record a salary change' })).toHaveCount(0);
    // The announced date is the one the FIELD carried, spelled the way every other date on the
    // surface is spelled. `\d{4}-\d{2}-\d{2}` asserted only that the string was date-shaped, which
    // was never in doubt — a submit carrying the wrong date passed it. Derived from `effectiveFrom`
    // rather than from a second clock read, so the midnight boundary cannot make this line flake.
    await expect(page.locator('#app-announcer')).toHaveText(
      `Salary change recorded, effective ${spellDate(effectiveFrom)}.`,
    );
  });

  test('offers no currency control — currency follows from the country (AD-6)', async ({
    page,
  }) => {
    await openSalaryPanel(page);

    const dialog = page.getByRole('dialog', { name: 'Record a salary change' });
    // Not a disabled control: offering one that can never be used is still offering a choice.
    await expect(dialog.getByRole('combobox', { name: 'Currency' })).toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: 'Currency' })).toHaveCount(0);
    await expect(dialog.getByText(/Currency INR/)).toBeVisible();
  });

  test('renders the server’s refusal under the amount field, as data', async ({ page }) => {
    await openSalaryPanel(page);

    // Zero PARSES — positivity is the server's rule, judged by the same code a CSV import is judged
    // by — so this is a real round-trip through the Server Action, not a client-side guess.
    await dialogField(page, 'Amount').fill('0');
    await page.getByRole('button', { name: 'Record change' }).click();

    await expect(dialogField(page, 'Amount')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Amount must be greater than zero.')).toBeVisible();
    // The panel stays open, holding everything that was typed.
    await expect(page.getByRole('dialog', { name: 'Record a salary change' })).toBeVisible();
    // No alarm: a rejection is data. No `role="alert"` and no second live region anywhere the app
    // renders.
    //
    // APP-WIDE, not scoped to the dialog and `#main-content`. Next mounts its route announcer on
    // `document.body` with `role="alert"` and `aria-live`, and that one is not ours to judge or to
    // touch — so it is EXCLUDED BY ID rather than dodged by narrowing the search, which is what
    // scoping did. Under the scoped form a second live region added to the header or the footer
    // passed, and the acceptance criterion is that no second one appears anywhere.
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
    await expect(page.locator('[aria-live]:not(#__next-route-announcer__)')).toHaveCount(1);
    await expect(page.locator('[aria-live]:not(#__next-route-announcer__)')).toHaveAttribute(
      'id',
      'app-announcer',
    );
    await expect(page.locator('#app-announcer')).toHaveText(
      'The salary change was not recorded. 1 reason.',
    );
  });

  test('refuses an over-precise amount without submitting it', async ({ page }) => {
    await openSalaryPanel(page);

    // INR has two decimal places. A third is a REJECTION, never a rounding — the money someone
    // typed is not altered under them.
    await dialogField(page, 'Amount').fill('25000.005');
    await page.getByRole('button', { name: 'Record change' }).click();

    await expect(
      page.getByText('is more precise than INR records, which is 2 decimal places'),
    ).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Record a salary change' })).toBeVisible();
  });

  test('Esc cancels and returns focus to the trigger', async ({ page }) => {
    await openSalaryPanel(page);

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Record a salary change' })).toHaveCount(0);
    // Focus must never be stranded on a removed element, and never left on `body`.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent ?? ''))
      .toBe('Record a salary change');
  });

  // The backdrop is the THIRD way out of this dialog, and it was the one no test covered. It is a
  // pointer gesture, but where it leaves focus is a keyboard concern: focus stranded on `body` means
  // the next Tab restarts from the top of the document instead of resuming beside the trigger
  // (WCAG 2.2 AA SC 2.4.3). It dismissed by calling `setIsOpen` directly, which skips the ref that
  // asks the effect cleanup to return focus — so it closed the panel and dropped focus on the floor.
  test('dismisses on a backdrop press and returns focus to the trigger', async ({ page }) => {
    await openSalaryPanel(page);

    // The top-left corner of the viewport: the backdrop covers the whole of it and the dialog is
    // centred, so this lands on the backdrop rather than on any control.
    await page.mouse.click(5, 5);

    await expect(page.getByRole('dialog', { name: 'Record a salary change' })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent ?? ''))
      .toBe('Record a salary change');
  });

  // A NON-PRIMARY press is not a dismissal. The handler runs on `pointerdown`, which fires for every
  // button — right, middle, stylus barrel — so a right-click aimed at the backdrop (to reach the
  // context menu, or simply landing wide of the dialog) tore the panel down and discarded everything
  // typed into it. Nothing warns and nothing is recoverable: the amount and the date are gone.
  test('ignores a non-primary press on the backdrop, keeping what was typed', async ({ page }) => {
    await openSalaryPanel(page);
    await dialogField(page, 'Amount').fill('21,50,000');

    await page.mouse.move(5, 5);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });

    await expect(page.getByRole('dialog', { name: 'Record a salary change' })).toBeVisible();
    await expect(dialogField(page, 'Amount')).toHaveValue('21,50,000');
  });

  // Closing the panel does NOT cancel the submission already in flight — there is no abort, and the
  // row it appends is undeletable (Law 5 / AD-18). What must not survive the dismissal is the
  // PENDING FLAG: `open()` re-seeded the values and the reasons but left `isPending` and the
  // `pendingRef` double-submit guard exactly as the interrupted submission left them. The reopened
  // panel therefore showed a disabled "Recording…" button over a freshly seeded form, and the ref
  // guard swallowed every subsequent submit — with no way back but a full page reload.
  test('reopens usable after being dismissed mid-submission', async ({ page }) => {
    await openSalaryPanel(page);

    // Hold the Server Action open so the dismissal lands while the submission is genuinely in
    // flight. Released before the test ends, so nothing here leaves a request stuck.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/employees/**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await held;
      await route.fallback();
    });

    await dialogField(page, 'Amount').fill('21,50,000');
    await page.getByRole('button', { name: 'Record change' }).click();

    // `aria-disabled`, NOT the `disabled` attribute. A disabled button leaves the focus order, so
    // the press that started the submission stranded focus on `body` — Esc stopped dismissing the
    // dialog and Tab restarted from the top of the document, for as long as the request was in
    // flight (WCAG 2.2 AA SC 2.4.3). The state is still announced, the label still says the action
    // is under way, and the press is still a no-op — but `pendingRef` is what refuses it now, which
    // is the guard doing the job it was written for rather than the attribute doing it silently.
    const pending = page.getByRole('button', { name: 'Recording…' });
    await expect(pending).toHaveAttribute('aria-disabled', 'true');
    await expect(pending).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Record a salary change' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Record a salary change' }).click();

    // The reopened panel is a NEW submission: the button says so and accepts a press.
    await expect(page.getByRole('button', { name: 'Record change' })).toBeEnabled();

    release();
  });

  test('contains Tab in both directions', async ({ page }) => {
    await openSalaryPanel(page);

    // Focusable order inside the dialog: Close, Effective date, Amount, submit. Focus is moved to
    // the FIRST focusable explicitly rather than Shift+Tabbed off the date input, because Chrome's
    // `<input type="date">` is three internal segments and Shift+Tab walks them one at a time —
    // this test is about the dialog's wrap, not about the date control's internals.
    await page.getByRole('button', { name: 'Close' }).focus();

    // Backwards off the FIRST focusable wraps to the LAST — it does not escape into the page.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Record change' })).toBeFocused();

    // And forwards off the last wraps back to the first.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
  });

  test('inerts the background while it is open, sparing the live region', async ({ page }) => {
    await openSalaryPanel(page);
    const report = await dialogInertReport(page);

    // Asserted NON-EMPTY first. `for (const child of [])` asserts nothing at all, so this test
    // passed vacuously if the report ever came back empty — including if the dialog never opened.
    // The CAP-2 equivalent has always checked this; the salary panel's copy had lost it.
    expect(report.length).toBeGreaterThan(0);
    expect(report.every((child) => child.inert)).toBe(true);
  });
});

// -------------------------------------------------------------------------------------------
// The axe gate over every state, in both color schemes.
//
// `e2e/accessibility.spec.ts` scans `/employees` and a detail route WITHOUT a database, so what it
// judges is the `unavailable` arm. Everything below — table semantics, the pager, the modal, a
// rejected form, the empty state — exists only once rows do, so without these the floor has a hole
// exactly the width of this story's deliverable.

const STATES = [
  { name: 'the populated directory', open: async (page: Page) => page.goto('/employees') },
  { name: 'the second page', open: async (page: Page) => page.goto('/employees?page=2') },
  { name: 'a search with no matches', open: async (page: Page) => page.goto('/employees?q=zzz') },
  {
    name: 'an employee detail page',
    open: async (page: Page) => page.goto(`/employees/${fixtureId(0)}`),
  },
  { name: 'the open create dialog', open: openCreateDialog },
  {
    name: 'a rejected submission',
    open: async (page: Page) => {
      await openCreateDialog(page);
      await page.getByRole('button', { name: 'Create employee' }).click();
      await expect(dialogField(page, 'Name')).toHaveAttribute('aria-invalid', 'true');
    },
  },
  // The CAP-3 panel's markup does not exist until it is opened, so without these two the floor has
  // a hole exactly the width of this story's deliverable (story 4-2).
  { name: 'the open record-change panel', open: openSalaryPanel },
  {
    name: 'a rejected salary submission',
    open: async (page: Page) => {
      await openSalaryPanel(page);
      await dialogField(page, 'Amount').fill('0');
      await page.getByRole('button', { name: 'Record change' }).click();
      await expect(dialogField(page, 'Amount')).toHaveAttribute('aria-invalid', 'true');
    },
  },
] as const;

for (const scheme of SCHEMES) {
  for (const state of STATES) {
    test(`${state.name} has no WCAG 2.2 AA axe violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await state.open(page);

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

      expect(results.violations).toEqual([]);
    });
  }
}
