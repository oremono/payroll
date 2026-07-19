import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// The summary strip appears on the page TWICE, deliberately: once in the report's <p>, and once in
// `#app-announcer`, because `composeImportAnnouncement()` returns `composeSummaryStrip()` verbatim
// for an imported result — the announcement IS the strip. Playwright matches sr-only text, so an
// unscoped getByText() on the strip resolves two nodes and dies on strict mode. Assert against the
// visible report, which is what these tests are about.
const reportRegion = (page: Page) => page.locator('section[aria-labelledby="import-report-heading"]');

// The browser-level gate for the bulk-import surface (story 2-2).
//
// Everything asserted here is markup a page-load scan structurally cannot reach: the summary strip,
// the rejection table, the pagination controls, and the refusal panel do not exist until a file has
// been uploaded and a report has come back. `e2e/accessibility.spec.ts` judges `/import`'s EMPTY
// state; this file judges the four states that follow it, in both color schemes.
//
// ## Why the endpoint is stubbed
//
// `page.route` intercepts `POST /api/import` and answers with a canned `ImportResult`. That is not
// a convenience — it is what makes this suite deterministic and database-free. The Route Handler,
// the use-case, the parser, and the write funnel are already proven by story 2-1 (unit,
// application, and real-Postgres integration suites). What is unproven, and what this file exists
// for, is that the UI renders the FIXED payload faithfully and adds nothing to the contract.
//
// The canned payloads below are therefore the contract under test: every sentence the page shows
// must be byte-identical to a `sentence` or `statement` string in one of them.

const CSV_FIXTURE = {
  name: 'payroll.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(
    'name,role_code,level_code,country_code,gender,hire_date,amount_minor,currency,effective_from\n' +
      'Elena Rossi,ENG,L3,IT,FEMALE,2020-01-06,4500000,EUR,2020-01-06\n',
  ),
};

/** One rejection, shaped exactly as `RowRejection` — sentences composed by the BACKEND. */
type CannedRejection = {
  rowNumber: number;
  name: string | null;
  offendingValue: string | null;
  sentence: string;
};

function cannedRejection(rowNumber: number): CannedRejection {
  return {
    rowNumber,
    name: `Person ${String(rowNumber)}`,
    offendingValue: 'Ninja',
    sentence: 'Role code "Ninja" is not in the role reference table.',
  };
}

/** 53 rejections — deliberately more than one page of 50, so paging is exercised for real. */
const PARTIAL = {
  kind: 'imported',
  importedCount: 9947,
  rejectedCount: 53,
  rejections: [
    {
      rowNumber: 2,
      name: 'Elena Rossi',
      offendingValue: 'Sr. Developer',
      sentence: 'Role code "Sr. Developer" is not in the role reference table.',
    },
    // A blank name cell: the reason the table needs an em-dash rule at all.
    {
      rowNumber: 3,
      name: null,
      offendingValue: null,
      sentence: 'The name cell is blank.',
    },
    ...Array.from({ length: 51 }, (_unused, index) => cannedRejection(index + 4)),
  ],
} as const;

const CLEAN = {
  kind: 'imported',
  importedCount: 9947,
  rejectedCount: 0,
  rejections: [],
} as const;

const ALL_REJECTED = {
  kind: 'imported',
  importedCount: 0,
  rejectedCount: 4,
  rejections: [2, 3, 4, 5].map(cannedRejection),
} as const;

/** The statement is the DOMAIN's, verbatim — `composeRefusalStatement({ kind: 'not-csv' })`. */
const REFUSAL = {
  kind: 'refusal',
  reason: { kind: 'not-csv' },
  statement:
    'The upload could not be read as CSV text. Import reads a CSV file; a spreadsheet workbook ' +
    'has to be saved as CSV first.',
} as const;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const SCHEMES = ['light', 'dark'] as const;

/** Answer every `POST /api/import` with `payload`, and count the calls. */
async function stubImport(page: Page, payload: unknown): Promise<{ calls: () => number }> {
  let calls = 0;

  await page.route('**/api/import', async (route: Route) => {
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  return { calls: () => calls };
}

/** Load `/import`, choose the fixture file, and submit. */
async function upload(page: Page): Promise<void> {
  await page.goto('/import');
  await page.getByLabel('Spreadsheet file').setInputFiles(CSV_FIXTURE);
  await page.getByRole('button', { name: 'Import file' }).click();
}

test.describe('the upload form before anything is chosen', () => {
  test('disables submit until a file is chosen, and issues no request', async ({ page }) => {
    const stub = await stubImport(page, CLEAN);
    await page.goto('/import');

    await expect(page.getByRole('button', { name: 'Import file' })).toBeDisabled();
    expect(stub.calls()).toBe(0);

    // Choosing a file is the whole guard — no other precondition, no validation gate in front of it.
    await page.getByLabel('Spreadsheet file').setInputFiles(CSV_FIXTURE);
    await expect(page.getByRole('button', { name: 'Import file' })).toBeEnabled();
    expect(stub.calls()).toBe(0);
  });

  test('gives the file input a real label and links its format helper text', async ({ page }) => {
    await page.goto('/import');

    const input = page.getByLabel('Spreadsheet file');
    await expect(input).toHaveAttribute('type', 'file');
    // CSV only. `.xlsx` is a whole-file refusal (AD-7), so it never appears in the accept list.
    await expect(input).toHaveAttribute('accept', '.csv,text/csv');

    const describedBy = await input.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();

    const help = page.locator(`#${String(describedBy)}`);
    // The nine required columns, named where the person choosing a file can read them.
    for (const column of [
      'name',
      'role_code',
      'level_code',
      'country_code',
      'gender',
      'hire_date',
      'amount_minor',
      'currency',
      'effective_from',
    ]) {
      await expect(help).toContainText(column);
    }
  });

  test('has no `<h1>` — the header owns the document’s one top-level heading', async ({
    page,
  }) => {
    await page.goto('/import');

    await expect(page.locator('main h1')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveCount(1);
  });
});

test.describe('a partial import', () => {
  test('POSTs the file ONCE, as a multipart part, and asks for nothing else', async ({ page }) => {
    const stub = await stubImport(page, PARTIAL);

    const apiRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) {
        apiRequests.push(`${request.method()} ${url.pathname}`);
      }
    });

    let contentType: string | null = null;
    let body = '';
    page.on('request', (request) => {
      if (request.url().includes('/api/import')) {
        contentType = request.headers()['content-type'] ?? null;
        body = request.postData() ?? '';
      }
    });

    await upload(page);
    await expect(page.getByRole('heading', { name: 'Import report' })).toBeVisible();

    expect(stub.calls()).toBe(1);
    // Exactly one call to our own origin's API surface. Reads on this app are Server Components
    // calling inward in-process (AD-21) — a second fetch here would mean the UI grew a read path
    // that does not exist.
    expect(apiRequests).toEqual(['POST /api/import']);
    expect(contentType).toContain('multipart/form-data');
    expect(body).toContain('payroll.csv');
  });

  test('states the strip and tables the first 50 rejections in file order', async ({ page }) => {
    await stubImport(page, PARTIAL);
    await upload(page);

    await expect(reportRegion(page).getByText('9,947 rows imported · 53 rows rejected · nothing guessed')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rejection Report (53 rows)' })).toBeVisible();

    // Header row plus fifty data rows — the page size, not the whole report.
    await expect(page.getByRole('row')).toHaveCount(51);

    // Real column headers, not styled divs.
    for (const header of ['Row #', 'Employee Name (File)', 'Offending Value', 'Reason']) {
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
    }

    // File order, not sorted: row 2 first, and the last row of page one is row 53.
    const firstRow = page.getByRole('row').nth(1);
    await expect(firstRow).toContainText('Elena Rossi');
    await expect(firstRow).toContainText('Sr. Developer');
    // Byte-identical to the payload's `sentence`.
    await expect(firstRow).toContainText(
      'Role code "Sr. Developer" is not in the role reference table.',
    );
  });

  test('renders an em dash for a blank name, with the MEANING in the reason column', async ({
    page,
  }) => {
    await stubImport(page, PARTIAL);
    await upload(page);

    const blankNameRow = page.getByRole('row').nth(2);
    await expect(blankNameRow).toContainText('—');
    // The dash marks the absence; this sentence is what carries the meaning, so no typographic
    // mark is ever the sole carrier.
    await expect(blankNameRow).toContainText('The name cell is blank.');
  });

  test('reaches every rejection by keyboard alone, in file order, with no infinite scroll', async ({
    page,
  }) => {
    await stubImport(page, PARTIAL);
    await upload(page);

    await expect(page.getByText('Rows 1–50 of 53')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();

    // Keyboard alone: focus the control and press Enter, never a mouse click.
    await page.getByRole('button', { name: 'Next page' }).focus();
    await page.keyboard.press('Enter');

    await expect(page.getByText('Rows 51–53 of 53')).toBeVisible();
    // Three data rows plus the header — the short LAST page, not a padded one.
    await expect(page.getByRole('row')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();

    await page.getByRole('button', { name: 'Previous page' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Rows 1–50 of 53')).toBeVisible();
  });

  test('announces the outcome once, in the app-level live region', async ({ page }) => {
    await stubImport(page, PARTIAL);
    await upload(page);

    const region = page.locator('#app-announcer');
    await expect(region).toHaveText('9,947 rows imported · 53 rows rejected · nothing guessed');

    // One voice: the report is a REGION WITH A HEADING, and the APP adds no second live region and
    // no alert of its own (NFR9; AD-20).
    //
    // Scoped to the app's own nodes rather than counted document-wide. Next injects
    // `#__next-route-announcer__` into every page — `aria-live="assertive"` AND `role="alert"`,
    // with no opt-out — so the document-wide counts asserted something the application cannot
    // satisfy, no matter how correct its own markup is. The convention being enforced is unchanged;
    // only its scope is. `e2e/shell.spec.ts` already counts `#app-announcer` for this reason.
    await expect(page.locator('#app-announcer')).toHaveCount(1);
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
  });

  test('replaces the prior report wholesale on a second upload, back at page 1', async ({
    page,
  }) => {
    await stubImport(page, PARTIAL);
    await upload(page);

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Rows 51–53 of 53')).toBeVisible();

    // A different report from the same endpoint — the second answer must not be merged into the
    // first, and the page position must not survive it.
    await page.unroute('**/api/import');
    await stubImport(page, ALL_REJECTED);
    await page.getByLabel('Spreadsheet file').setInputFiles(CSV_FIXTURE);
    await page.getByRole('button', { name: 'Import file' }).click();

    await expect(reportRegion(page).getByText('0 rows imported · 4 rows rejected · nothing guessed')).toBeVisible();
    await expect(reportRegion(page).getByText('9,947 rows imported · 53 rows rejected · nothing guessed')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Rejection Report (4 rows)' })).toBeVisible();
  });
});

test.describe('a clean import', () => {
  test('states the strip with no rejection table at all', async ({ page }) => {
    await stubImport(page, CLEAN);
    await upload(page);

    await expect(reportRegion(page).getByText('9,947 rows imported · 0 rows rejected · nothing guessed')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    // No celebration, no success styling, no notification affordance.
    await expect(page.getByRole('heading', { name: 'Import report' })).toBeVisible();
  });
});

test.describe('an all-rejected file', () => {
  // The single sharpest rule in the story: zero imported rows is a REPORT, not a refusal. A refusal
  // would tell the reader neither which rows failed nor why.
  test('is a report with a table, never a refusal panel', async ({ page }) => {
    await stubImport(page, ALL_REJECTED);
    await upload(page);

    await expect(reportRegion(page).getByText('0 rows imported · 4 rows rejected · nothing guessed')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rejection Report (4 rows)' })).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(5);
    await expect(page.getByRole('heading', { name: 'The file was not imported' })).toHaveCount(0);
  });
});

test.describe('a whole-file refusal', () => {
  test('renders the payload statement verbatim, in a headed region and never an alert', async ({
    page,
  }) => {
    await stubImport(page, REFUSAL);
    await upload(page);

    const refusal = page.getByRole('region', { name: 'The file was not imported' });
    await expect(refusal).toBeVisible();
    // Byte-identical to `ImportResult.statement`. The UI never authors a sentence for a reason the
    // backend has already worded (Law 7).
    await expect(refusal).toContainText(REFUSAL.statement);

    // Excludes Next's injected route announcer (see the note above); this asserts that OUR refusal
    // is a headed region and never an alert, which is the actual convention.
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
    // No counts, no table — the file was never read as rows, so there is nothing to count.
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText('nothing guessed')).toHaveCount(0);
  });

  test('announces the refusal statement, byte for byte', async ({ page }) => {
    await stubImport(page, REFUSAL);
    await upload(page);

    await expect(page.locator('#app-announcer')).toHaveText(REFUSAL.statement);
  });
});

test.describe('a transport failure', () => {
  // `fetch` rejecting is the one outcome the backend never worded, because the request never
  // reached it. It must not throw inside the render and must not surface as an unhandled rejection.
  test('renders a refusal-shaped panel rather than throwing', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.route('**/api/import', (route) => route.abort('failed'));
    await upload(page);

    const refusal = page.getByRole('region', { name: 'The file was not imported' });
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText('did not complete');
    await expect(refusal).toContainText('Nothing was imported');

    expect(pageErrors).toEqual([]);
    // The form is usable again — a failed upload leaves no dead surface behind.
    await expect(page.getByRole('button', { name: 'Import file' })).toBeEnabled();
  });

  test('renders a refusal-shaped panel when the body is not an ImportResult', async ({ page }) => {
    await page.route('**/api/import', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>502</p>' }),
    );
    await upload(page);

    await expect(page.getByRole('region', { name: 'The file was not imported' })).toBeVisible();
  });
});

// -------------------------------------------------------------------------------------------
// The axe gate over every post-upload state, in both color schemes.
//
// `e2e/accessibility.spec.ts` scans `/import` on load and therefore judges an empty form. Every
// element that carries the actual report — table semantics, the refusal region, the paging
// controls, the `refusal-fill` surface under real text — exists only after an upload, so without
// these the gate has a hole exactly the width of this story's whole deliverable.

const POST_UPLOAD_STATES = [
  { name: 'a partial import with its rejection table', payload: PARTIAL },
  { name: 'a clean import', payload: CLEAN },
  { name: 'an all-rejected file', payload: ALL_REJECTED },
  { name: 'a whole-file refusal', payload: REFUSAL },
] as const;

for (const scheme of SCHEMES) {
  for (const state of POST_UPLOAD_STATES) {
    test(`${state.name} has no WCAG 2.2 AA axe violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubImport(page, state.payload);
      await upload(page);
      // Wait for the report to land, or axe would scan the form it was already scanning.
      await expect(
        page
          .getByRole('heading', { name: 'Import report' })
          .or(page.getByRole('heading', { name: 'The file was not imported' })),
      ).toBeVisible();

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

      expect(results.violations).toEqual([]);
    });
  }
}
