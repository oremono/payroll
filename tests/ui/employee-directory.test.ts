import { describe, expect, it } from 'vitest';

import {
  DIRECTORY_PAGE_PARAM,
  DIRECTORY_SEARCH_PARAM,
  directoryEmptyState,
  directoryHref,
  directoryOffsetCorrection,
  directoryOffsetFor,
  directorySlice,
  directoryStatusLine,
  EMPLOYEES_HREF,
  parseDirectoryParams,
} from '@/ui/employee-directory';

// Test-first (Law 1 / AD-23): red before `src/ui/employee-directory.ts` exists.
//
// Every decision the Employees directory makes is arithmetic or string work, and every one of them
// is a trap: a page number a person hand-edited, a `q` that arrived twice, a limit the adapter
// clamped below what was asked for, an `asOf` that must survive a page change. The repo carries no
// jsdom and no @testing-library and none is being added, and `src/app/**` and `src/ui/*.tsx` are
// outside the coverage gate — so this module is the ONLY place vitest can reach those decisions.
// Rendered behaviour is Playwright's job (`e2e/employees.spec.ts`); the two never overlap.
//
// The "effective vs requested" distinction is the sharpest rule here. `ListEmployeesResult`'s `page`
// arm echoes the limit and offset the ADAPTER used after clamping (story 3-1's Design Notes: "a
// pager that renders the requested value after the adapter clamped it lies"), so everything below
// is computed from the echo and never from what the URL asked for.

/** The adapter's bound, passed IN — `src/ui` may not import `@/adapters/*`. */
const MAX_SEARCH_LENGTH = 200;

describe('parseDirectoryParams', () => {
  it('reads a plain search term and page number', () => {
    expect(parseDirectoryParams({ q: 'ana', page: '3' }, MAX_SEARCH_LENGTH)).toEqual({
      q: 'ana',
      page: 3,
    });
  });

  it('answers no filter and page 1 when neither param is present', () => {
    expect(parseDirectoryParams({}, MAX_SEARCH_LENGTH)).toEqual({ q: null, page: 1 });
  });

  // `?q=a&q=b` arrives as an ARRAY. Story 3-1's pass-3 review found this exact shape reaching
  // `.trim()` as a TypeError that the read use-case reported as `{ kind: 'unavailable' }` — an
  // outage screen for a duplicated query parameter. It is answered here as "no filter", the same
  // thing the port's `search: null` means, so the ambiguity never becomes a filter nobody asked for.
  it('treats a repeated `q` as no filter rather than picking one', () => {
    expect(parseDirectoryParams({ q: ['a', 'b'] }, MAX_SEARCH_LENGTH).q).toBeNull();
  });

  it('treats an absent-but-declared `q` as no filter', () => {
    expect(parseDirectoryParams({ q: undefined }, MAX_SEARCH_LENGTH).q).toBeNull();
  });

  // A cleared search box sends `''`; a brushed space bar sends `'   '`. Both mean "I am not
  // searching" — the port documents them as taking the same path as `null` rather than becoming a
  // filter that matches everything by accident or almost nothing.
  it('treats a blank or whitespace-only term as no filter', () => {
    expect(parseDirectoryParams({ q: '' }, MAX_SEARCH_LENGTH).q).toBeNull();
    expect(parseDirectoryParams({ q: '   ' }, MAX_SEARCH_LENGTH).q).toBeNull();
  });

  it('trims surrounding whitespace off a term that does survive', () => {
    expect(parseDirectoryParams({ q: '  ana  ' }, MAX_SEARCH_LENGTH).q).toBe('ana');
  });

  // The bound is the adapter's `MAX_SEARCH_LENGTH`, passed in as an ARGUMENT. `src/ui` may not
  // import `@/adapters/*`, and inventing a second constant here would let the two disagree.
  it('truncates an over-long term to the bound it is given', () => {
    const long = 'x'.repeat(MAX_SEARCH_LENGTH + 50);
    expect(parseDirectoryParams({ q: long }, MAX_SEARCH_LENGTH).q).toBe(
      'x'.repeat(MAX_SEARCH_LENGTH),
    );
  });

  it('trims BEFORE truncating, so padding never eats the term', () => {
    const padded = `   ${'x'.repeat(10)}   `;
    expect(parseDirectoryParams({ q: padded }, 10).q).toBe('x'.repeat(10));
  });

  it('falls back to page 1 for a repeated, absent, or non-numeric page', () => {
    expect(parseDirectoryParams({ page: ['1', '2'] }, MAX_SEARCH_LENGTH).page).toBe(1);
    expect(parseDirectoryParams({ page: 'abc' }, MAX_SEARCH_LENGTH).page).toBe(1);
    expect(parseDirectoryParams({ page: '' }, MAX_SEARCH_LENGTH).page).toBe(1);
  });

  it('clamps a zero or negative page up to 1', () => {
    expect(parseDirectoryParams({ page: '-5' }, MAX_SEARCH_LENGTH).page).toBe(1);
    expect(parseDirectoryParams({ page: '0' }, MAX_SEARCH_LENGTH).page).toBe(1);
  });

  it('truncates a fractional page rather than rejecting it', () => {
    expect(parseDirectoryParams({ page: '2.9' }, MAX_SEARCH_LENGTH).page).toBe(2);
  });

  // `1e9` is a NUMBER, so it parses — and it must not throw. Bounding it here (rather than trusting
  // the adapter's offset clamp alone) keeps the requested offset inside `Number.MAX_SAFE_INTEGER`
  // arithmetic; the page it actually lands on is settled by `directoryOffsetCorrection`.
  it('accepts an absurd page without throwing', () => {
    const parsed = parseDirectoryParams({ page: '1e9' }, MAX_SEARCH_LENGTH);
    expect(Number.isSafeInteger(parsed.page)).toBe(true);
    expect(parsed.page).toBeGreaterThanOrEqual(1);
  });

  it('ignores every other param it does not own', () => {
    expect(
      parseDirectoryParams({ asOf: '2026-01-01', threshold: '20' }, MAX_SEARCH_LENGTH),
    ).toEqual({ q: null, page: 1 });
  });
});

describe('directoryOffsetFor', () => {
  it('is zero on page 1 and one limit per page thereafter', () => {
    expect(directoryOffsetFor(1, 25)).toBe(0);
    expect(directoryOffsetFor(2, 25)).toBe(25);
    expect(directoryOffsetFor(4, 25)).toBe(75);
  });
});

describe('directorySlice', () => {
  it('describes the first page of thirty employees at a limit of twenty-five', () => {
    expect(directorySlice({ totalCount: 30, limit: 25, offset: 0 })).toEqual({
      pageNumber: 1,
      pageCount: 2,
      firstIndex: 1,
      lastIndex: 25,
      totalCount: 30,
      limit: 25,
      offset: 0,
    });
  });

  it('describes a short last page honestly', () => {
    const slice = directorySlice({ totalCount: 30, limit: 25, offset: 25 });
    expect(slice.pageNumber).toBe(2);
    expect(slice.firstIndex).toBe(26);
    expect(slice.lastIndex).toBe(30);
  });

  it('never renders `page 1 of 0` — an empty directory is one empty page', () => {
    expect(directorySlice({ totalCount: 0, limit: 25, offset: 0 })).toEqual({
      pageNumber: 1,
      pageCount: 1,
      firstIndex: 0,
      lastIndex: 0,
      totalCount: 0,
      limit: 25,
      offset: 0,
    });
  });

  it('clamps a page past the end onto the last page', () => {
    const slice = directorySlice({ totalCount: 30, limit: 25, offset: 2450 });
    expect(slice.pageNumber).toBe(2);
    expect(slice.pageCount).toBe(2);
  });

  // The whole point of the echo. If the adapter clamped a requested limit of 1,000,000 down to 200,
  // every number the pager shows must be computed from 200.
  it('is computed from the EFFECTIVE limit, not from anything requested', () => {
    const slice = directorySlice({ totalCount: 500, limit: 200, offset: 200 });
    expect(slice.pageNumber).toBe(2);
    expect(slice.pageCount).toBe(3);
    expect(slice.firstIndex).toBe(201);
    expect(slice.lastIndex).toBe(400);
  });

  // Total even for a limit no adapter should ever echo: a zero limit would otherwise divide by zero
  // and yield `Infinity` pages.
  it('survives a nonsensical limit rather than dividing by zero', () => {
    const slice = directorySlice({ totalCount: 5, limit: 0, offset: 0 });
    expect(Number.isSafeInteger(slice.pageCount)).toBe(true);
    expect(slice.pageCount).toBeGreaterThanOrEqual(1);
  });
});

describe('directoryOffsetCorrection', () => {
  it('answers null when the echoed offset already lands on the page it reports', () => {
    expect(directoryOffsetCorrection({ totalCount: 30, limit: 25, offset: 0 })).toBeNull();
    expect(directoryOffsetCorrection({ totalCount: 30, limit: 25, offset: 25 })).toBeNull();
  });

  // `?page=99` with 30 employees: the read comes back empty at an offset past the end, and the
  // status line and the pager would otherwise describe a page that has no rows on it. The correction
  // is the offset the LAST page starts at, which the surface re-reads at so rows, status line, and
  // pager all agree.
  it('answers the last page’s offset when the echoed one is past the end', () => {
    expect(directoryOffsetCorrection({ totalCount: 30, limit: 25, offset: 2450 })).toBe(25);
  });

  it('answers null for an empty directory — there is no better page to go to', () => {
    expect(directoryOffsetCorrection({ totalCount: 0, limit: 25, offset: 0 })).toBeNull();
    expect(directoryOffsetCorrection({ totalCount: 0, limit: 25, offset: 500 })).toBe(0);
  });

  // The adapter clamps `offset` to `MAX_LIST_OFFSET`, so a huge page number arrives as a large but
  // finite offset that is still past the end of a small table.
  it('corrects an adapter-clamped offset that is still past the end', () => {
    expect(directoryOffsetCorrection({ totalCount: 30, limit: 25, offset: 100_000 })).toBe(25);
  });
});

describe('directoryStatusLine', () => {
  it('reports the span, the total, and the page position', () => {
    const slice = directorySlice({ totalCount: 30, limit: 25, offset: 0 });
    expect(directoryStatusLine(slice)).toBe('Employees 1–25 of 30 · Page 1 of 2');
  });

  it('reports the EFFECTIVE values after a clamp, never the requested ones', () => {
    // Requested limit 1,000,000; the adapter echoed 200. The line must describe 200.
    const slice = directorySlice({ totalCount: 500, limit: 200, offset: 0 });
    expect(directoryStatusLine(slice)).toBe('Employees 1–200 of 500 · Page 1 of 3');
  });

  // Determinism in the small (Law 6 / AD-19): the locale is pinned, exactly as `import-report.ts`
  // pins it, so a count does not change meaning with the machine that rendered it.
  it('groups large counts in one pinned locale', () => {
    const slice = directorySlice({ totalCount: 9947, limit: 25, offset: 0 });
    expect(directoryStatusLine(slice)).toContain('of 9,947');
  });

  it('is total for an empty directory', () => {
    const slice = directorySlice({ totalCount: 0, limit: 25, offset: 0 });
    expect(directoryStatusLine(slice)).toBe('Employees 0–0 of 0 · Page 1 of 1');
  });
});

describe('directoryHref', () => {
  it('drops the query entirely when nothing survives', () => {
    expect(directoryHref({}, { page: 1 })).toBe(EMPLOYEES_HREF);
  });

  // The as-of date is ambient provenance carried on every link (DESIGN § As-of date control). A
  // pager link that rebuilt the query from scratch would wind the whole application back to today
  // as a side effect of turning a page.
  it('carries `asOf` and the search term across a page change', () => {
    const href = directoryHref({ asOf: '2026-01-01', q: 'ana', page: '2' }, { page: 3 });
    expect(href).toBe('/employees?asOf=2026-01-01&q=ana&page=3');
  });

  it('drops `page` when it returns to 1 rather than spelling out the default', () => {
    const href = directoryHref({ asOf: '2026-01-01', q: 'ana', page: '2' }, { page: 1 });
    expect(href).toBe('/employees?asOf=2026-01-01&q=ana');
  });

  // A new search is a new result set, so the old page position is meaningless — `page` is dropped
  // while `asOf` survives.
  it('resets the page when the search term changes', () => {
    const href = directoryHref({ asOf: '2026-01-01', q: 'ana', page: '2' }, { q: 'bob', page: 1 });
    expect(href).toBe('/employees?asOf=2026-01-01&q=bob');
  });

  it('removes `q` when the search is cleared', () => {
    const href = directoryHref({ asOf: '2026-01-01', q: 'ana' }, { q: null, page: 1 });
    expect(href).toBe('/employees?asOf=2026-01-01');
  });

  it('preserves a param it has never heard of', () => {
    expect(directoryHref({ threshold: '20' }, { page: 2 })).toBe('/employees?threshold=20&page=2');
  });

  it('preserves every value of a repeated param it does not own', () => {
    expect(directoryHref({ asOf: ['2026-01-01', '2026-02-01'] }, { page: 2 })).toBe(
      '/employees?asOf=2026-01-01&asOf=2026-02-01&page=2',
    );
  });

  it('collapses a repeated param it DOES own when that param is patched', () => {
    expect(directoryHref({ q: ['a', 'b'] }, { q: 'c', page: 1 })).toBe('/employees?q=c');
  });

  it('encodes a term that would otherwise break the query string', () => {
    expect(directoryHref({}, { q: 'a b&c=d', page: 1 })).toBe('/employees?q=a+b%26c%3Dd');
  });

  it('leaves a param it owns untouched when that param is not patched', () => {
    expect(directoryHref({ q: 'ana', page: '2' }, {})).toBe('/employees?q=ana&page=2');
  });

  it('names the params it owns as constants rather than as scattered strings', () => {
    expect(DIRECTORY_SEARCH_PARAM).toBe('q');
    expect(DIRECTORY_PAGE_PARAM).toBe('page');
  });
});

describe('directoryEmptyState', () => {
  it('is absent whenever there is anything to show', () => {
    expect(directoryEmptyState(30, null)).toBeNull();
    expect(directoryEmptyState(1, 'ana')).toBeNull();
  });

  // The ratified 1-6 first-run copy, preserved verbatim — this is the sentence the placeholder
  // route has shown since the shell landed, and the surface that replaces it says the same thing.
  it('states the first-run sentence when the table itself is empty', () => {
    const empty = directoryEmptyState(0, null);
    expect(empty).toEqual({
      kind: 'first-run',
      statement: 'No employees yet. Import a spreadsheet to begin.',
    });
  });

  // A search that matched nothing is NOT the first run: telling someone to import a spreadsheet
  // when they have 10,000 employees and mistyped a name is a false statement about their data.
  it('names the term when a search matched nothing, and never offers the import copy', () => {
    const empty = directoryEmptyState(0, 'zzz');
    expect(empty?.kind).toBe('no-match');
    expect(empty?.statement).toContain('zzz');
    expect(empty?.statement).not.toContain('Import a spreadsheet');
  });
});
