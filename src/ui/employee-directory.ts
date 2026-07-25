/**
 * Everything the Employees directory DECIDES, with no React in it.
 *
 * The same split `nav-items.ts` and `import-report.ts` make, and for the same reason: the repo
 * carries no jsdom and no @testing-library, and none is being added. Judgement lives here and is
 * unit-tested under node (`tests/ui/employee-directory.test.ts`); `src/app/employees/page.tsx` and
 * the `.tsx` components stay thin enough that what they do is visible by reading them, and their
 * RENDERED behaviour is proven in `e2e/employees.spec.ts`.
 *
 * It matters more here than it did for import. `src/app/**` and `src/ui/**` are BOTH outside the
 * coverage gate (`vitest.config.ts` includes only `src/domain` and `src/application`), so a page
 * component that clamped its own page numbers would carry the surface's whole correctness surface
 * in code no gate ever measures.
 *
 * ## Requested versus EFFECTIVE — the one rule everything here turns on
 *
 * `ListEmployeesResult`'s `page` arm echoes the `limit` and `offset` the ADAPTER used, after
 * clamping (`clampListLimit` bounds limit to 1..200, `clampListOffset` bounds offset to
 * 0..100_000). Story 3-1 states the reason plainly: "a pager that renders the requested value after
 * the adapter clamped it lies". So every function below is fed the ECHO and never the URL's
 * ambition, and the URL's ambition never reaches a rendered number.
 *
 * ## Why the params are hostile input by default
 *
 * `searchParams` yields `undefined` for an absent parameter and an ARRAY for a repeated one
 * (`?q=a&q=b`). Story 3-1's third review pass found exactly that array reaching `.trim()` as a
 * `TypeError` which the read use-case then reported as `{ kind: 'unavailable' }` — an outage screen
 * for a duplicated query parameter. Every parse here is TOTAL over `string | string[] | undefined`:
 * an ambiguous value means "no filter", which is a real answer, not a failure.
 *
 * ## What this module may NOT do
 *
 * Import `@/adapters/*`. `DEFAULT_LIST_LIMIT` and `MAX_SEARCH_LENGTH` are the adapter's constants
 * and arrive here as ARGUMENTS from `src/app/employees/page.tsx`, which is the composition root.
 * Re-declaring them here would let the UI and the adapter disagree about the same number.
 */

/** The search param, `?q=`. */
export const DIRECTORY_SEARCH_PARAM = 'q';

/** The page param, `?page=`. 1-based, and absent when it is 1. */
export const DIRECTORY_PAGE_PARAM = 'page';

/**
 * The three filter params, `?role=` / `?level=` / `?country=`. Each carries ONE reference `code`,
 * they AND with each other and with `q`, and each is absent when nothing is selected.
 *
 * A CODE, never a display name: the code is the reference table's identity, and Law 3 favours exact
 * vocabulary. It is also what makes a bookmarked URL survive a role being renamed.
 */
export const DIRECTORY_ROLE_PARAM = 'role';
export const DIRECTORY_LEVEL_PARAM = 'level';
export const DIRECTORY_COUNTRY_PARAM = 'country';

/** The directory's own path — the base every link this module builds hangs off. */
export const EMPLOYEES_HREF = '/employees';

/**
 * The locale every count on this surface is grouped in, PINNED — the same constant and the same
 * reasoning as `import-report.ts`. Under the ambient locale the same payload reads `9,947` in one
 * place and `9.947` in another; a count is data and does not change meaning with the machine.
 */
const NUMBER_LOCALE = 'en-US';

/**
 * Search params as Next hands them to a Server Component: a value may be absent, a single string,
 * or an array when the param was repeated.
 */
export type DirectorySearchParams = Readonly<Record<string, string | string[] | undefined>>;

/**
 * Everything the reader asked the directory to narrow by, after every hostile shape is answered.
 *
 * `null` means "no filter on this dimension" in every field — including for a repeated, blank, or
 * whitespace-only value. An unrecognised code is NOT null: it is a real filter that will match
 * nothing, because `?role=NOPE` rendering the whole directory would be a filter that silently does
 * not filter.
 */
export type DirectoryCriteria = {
  readonly q: string | null;
  readonly role: string | null;
  readonly level: string | null;
  readonly country: string | null;
};

/** The bounds this module is handed. They are the ADAPTER's — see the module header. */
export type DirectoryBounds = {
  readonly maxSearchLength: number;
  readonly maxCodeLength: number;
};

/** What the URL asked for, after every hostile shape has been answered. */
export type DirectoryParams = DirectoryCriteria & {
  /** 1-based and at least 1. Whether the page EXISTS is settled later, from the echo. */
  readonly page: number;
};

/**
 * An upper bound on the page number a URL may name.
 *
 * Not a product rule — an arithmetic guard. `?page=1e15` would otherwise produce a requested offset
 * beyond `Number.MAX_SAFE_INTEGER`, where integer arithmetic stops being exact and a comparison
 * against the total can silently answer wrong. The adapter clamps the offset it receives anyway;
 * this keeps the number that reaches it a safe integer in the first place.
 */
const MAX_PAGE = 1_000_000;

/** One value of a search param, or `null` when the param is absent or ambiguous. */
function singleValue(raw: string | string[] | undefined): string | null {
  return typeof raw === 'string' ? raw : null;
}

/**
 * Read the search term, the three filter codes, and the page out of the URL. Total for every shape
 * `searchParams` can produce.
 *
 * `bounds` carries the ADAPTER's `MAX_SEARCH_LENGTH` and `MAX_FILTER_CODE_LENGTH`, passed in.
 * Bounding here as well as in the adapter is not belt-and-braces: every one of these values is
 * echoed back into a form control AND into every pager link, so an unbounded one would be
 * re-serialized into the URL on every page turn.
 */
export function parseDirectoryParams(
  searchParams: DirectorySearchParams,
  bounds: DirectoryBounds,
): DirectoryParams {
  const code = (param: string) =>
    trimmedBounded(singleValue(searchParams[param]), bounds.maxCodeLength);

  return {
    q: trimmedBounded(singleValue(searchParams[DIRECTORY_SEARCH_PARAM]), bounds.maxSearchLength),
    role: code(DIRECTORY_ROLE_PARAM),
    level: code(DIRECTORY_LEVEL_PARAM),
    country: code(DIRECTORY_COUNTRY_PARAM),
    page: parsePageNumber(singleValue(searchParams[DIRECTORY_PAGE_PARAM])),
  };
}

/**
 * Trim, then bound. In that order — padding must never be what pushes a value over the bound.
 *
 * One function for the search term and for the three codes, because their NORMALIZATION is
 * identical: a cleared control sends `''`, a brushed space bar sends `'   '`, and both mean "I am
 * not narrowing by this". What differs is the bound each is given and what the adapter then DOES
 * with the survivor — a substring match for the term, exact equality for a code.
 */
function trimmedBounded(raw: string | null, bound: number): string | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed.slice(0, bound);
}

function parsePageNumber(raw: string | null): number {
  if (raw === null || raw.trim() === '') {
    return 1;
  }
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(Math.max(parsed, 1), MAX_PAGE);
}

/** The offset a 1-based page number asks for at a given page size. */
export function directoryOffsetFor(page: number, limit: number): number {
  return (page - 1) * limit;
}

/** One page of the directory, described entirely from the values the payload echoed back. */
export type DirectorySlice = {
  /** 1-based, and CLAMPED into `1..pageCount`. */
  readonly pageNumber: number;
  /** At least 1, so `Page 1 of 0` is never renderable. */
  readonly pageCount: number;
  /** 1-based span of this page within the whole result; `0`/`0` when there is nothing at all. */
  readonly firstIndex: number;
  readonly lastIndex: number;
  /** The size of the whole result — the table's count, never an as-of population. */
  readonly totalCount: number;
  /** The EFFECTIVE values, echoed by the payload. */
  readonly limit: number;
  readonly offset: number;
};

/** The `page` arm of `ListEmployeesResult`, reduced to what the pager needs. */
export type DirectoryPageEcho = {
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
};

/**
 * A limit that can actually be divided by. The adapter never echoes one below 1, but this module is
 * total by contract and a zero would otherwise yield `Infinity` pages.
 */
function effectiveLimit(limit: number): number {
  return Math.max(Math.trunc(limit), 1);
}

/** Describe the page the payload actually answered with. */
export function directorySlice(echo: DirectoryPageEcho): DirectorySlice {
  const limit = effectiveLimit(echo.limit);
  const totalCount = Math.max(Math.trunc(echo.totalCount), 0);
  const offset = Math.max(Math.trunc(echo.offset), 0);

  const pageCount = Math.max(1, Math.ceil(totalCount / limit));
  const pageNumber = Math.min(Math.floor(offset / limit) + 1, pageCount);

  return {
    pageNumber,
    pageCount,
    // Derived from the PAGE NUMBER rather than from the raw offset, so the span can never describe
    // a position the pager does not also report.
    firstIndex: totalCount === 0 ? 0 : (pageNumber - 1) * limit + 1,
    lastIndex: totalCount === 0 ? 0 : Math.min(pageNumber * limit, totalCount),
    totalCount,
    limit: echo.limit,
    offset: echo.offset,
  };
}

/**
 * The offset the surface SHOULD have read at, or `null` when the echoed one already agrees with the
 * page it reports.
 *
 * `?page=99` against 30 employees reads at an offset past the end and comes back with no rows — but
 * `totalCount` is the whole table either way, so the pager and the status line would describe page
 * 2 of 2 beside an empty table. Rather than lie in either direction, the surface re-reads at the
 * offset this returns. Non-null is the hostile path only: an ordinary page turn follows a link this
 * module built and lands here as `null`.
 */
export function directoryOffsetCorrection(echo: DirectoryPageEcho): number | null {
  const slice = directorySlice(echo);
  const aligned = (slice.pageNumber - 1) * effectiveLimit(echo.limit);
  return aligned === echo.offset ? null : aligned;
}

function grouped(count: number): string {
  return count.toLocaleString(NUMBER_LOCALE);
}

/**
 * `Employees 1–25 of 30 · Page 1 of 2` — the import pager's grammar, over the directory's nouns.
 *
 * Every number in it comes from the slice, which came from the echo. There is no path by which a
 * requested limit or offset reaches this string.
 */
export function directoryStatusLine(slice: DirectorySlice): string {
  return (
    `Employees ${grouped(slice.firstIndex)}–${grouped(slice.lastIndex)} of ` +
    `${grouped(slice.totalCount)} · Page ${grouped(slice.pageNumber)} of ${grouped(slice.pageCount)}`
  );
}

/** The five params this module owns; everything else on the URL is somebody else's and survives. */
export type DirectoryHrefPatch = {
  readonly q?: string | null;
  readonly role?: string | null;
  readonly level?: string | null;
  readonly country?: string | null;
  readonly page?: number;
};

/** The filter params, paired with the patch key that sets each. */
const FILTER_PARAMS = [
  [DIRECTORY_ROLE_PARAM, 'role'],
  [DIRECTORY_LEVEL_PARAM, 'level'],
  [DIRECTORY_COUNTRY_PARAM, 'country'],
] as const;

/**
 * A directory href with `q` and/or `page` changed and EVERYTHING ELSE carried over.
 *
 * Merged into a `new URLSearchParams`, never rebuilt as a fresh `?q=…&page=…` string — the same
 * idiom `as-of-control.tsx` adopted after a code review found that rebuilding destroyed every other
 * param on the surface. `asOf` is the concrete casualty: it is ambient provenance carried on every
 * link, so a pager that dropped it would wind the whole application back to today as a side effect
 * of turning a page, with no signal at all.
 *
 * `page` is DROPPED when it is 1. The first page is the default, and spelling it out makes two URLs
 * for one view — which matters because these URLs are bookmarked and shared.
 *
 * Only the keys present on `patch` are touched. A key that is patched is `set` (which also collapses
 * a repeated param to the one value that now holds); a key that is not is left exactly as it
 * arrived, repetitions included.
 */
export function directoryHref(
  searchParams: DirectorySearchParams,
  patch: DirectoryHrefPatch,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') {
      query.append(key, value);
    } else if (Array.isArray(value)) {
      for (const one of value) {
        query.append(key, one);
      }
    }
  }

  if (patch.q !== undefined) {
    if (patch.q === null) {
      query.delete(DIRECTORY_SEARCH_PARAM);
    } else {
      query.set(DIRECTORY_SEARCH_PARAM, patch.q);
    }
  }

  // The three filters follow the search term's rule exactly: `null` is "all", and "all" is the
  // default, so it is DELETED rather than spelled out as an empty value. Two URLs for one view is
  // what that would cost, and these URLs are bookmarked and shared.
  for (const [param, key] of FILTER_PARAMS) {
    const value = patch[key];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      query.delete(param);
    } else {
      query.set(param, value);
    }
  }

  if (patch.page !== undefined) {
    if (patch.page <= 1) {
      query.delete(DIRECTORY_PAGE_PARAM);
    } else {
      query.set(DIRECTORY_PAGE_PARAM, String(patch.page));
    }
  }

  const serialized = query.toString();
  return serialized === '' ? EMPLOYEES_HREF : `${EMPLOYEES_HREF}?${serialized}`;
}

/**
 * Which empty state a zero-row directory is in, or `null` when it has rows.
 *
 * The distinction is the whole function. "No employees yet. Import a spreadsheet to begin." is a
 * TRUE statement about a fresh install and a FALSE one about ten thousand employees and a mistyped
 * search — and the second reader is the one who would act on it. So a narrowed result that matched
 * nothing says so, names what it looked for, and never offers the import copy.
 *
 * It takes the whole CRITERIA SET rather than the term alone for exactly that reason: once filters
 * exist, `q === null` no longer means "nothing was asked for". A reader who picked a level and
 * matched nobody would otherwise be told their database is empty and pointed at the import screen.
 */
export type DirectoryEmptyState = {
  readonly kind: 'first-run' | 'no-match';
  readonly statement: string;
};

export function directoryEmptyState(
  totalCount: number,
  criteria: DirectoryCriteria,
): DirectoryEmptyState | null {
  if (totalCount > 0) {
    return null;
  }

  const { q, role, level, country } = criteria;
  const named: string[] = [];
  if (role !== null) {
    named.push(`role ${role}`);
  }
  if (level !== null) {
    named.push(`level ${level}`);
  }
  if (country !== null) {
    named.push(`country ${country}`);
  }

  if (named.length === 0) {
    if (q === null) {
      // The 1-6 placeholder's ratified sentence, verbatim — the surface that replaces it says
      // exactly what it said. The link to `/import` is the component's; the sentence is this
      // module's.
      return { kind: 'first-run', statement: 'No employees yet. Import a spreadsheet to begin.' };
    }
    // The search-only sentence, unchanged since story 3-2 and asserted VERBATIM by
    // `e2e/employees.spec.ts`. A filter being available is no reason to reword the answer to a
    // question that did not involve one.
    return { kind: 'no-match', statement: `No employee’s name contains “${q}”.` };
  }

  if (q !== null) {
    named.push(`a name containing “${q}”`);
  }
  return { kind: 'no-match', statement: `No employee matches ${joinCriteria(named)}.` };
}

/** `a` · `a and b` · `a, b, and c` — the Oxford comma only where there is a list to punctuate. */
function joinCriteria(parts: readonly string[]): string {
  const last = parts.at(-1);
  if (parts.length <= 1 || last === undefined) {
    return parts.join('');
  }
  const rest = parts.slice(0, -1);
  return rest.length === 1 ? `${rest.join('')} and ${last}` : `${rest.join(', ')}, and ${last}`;
}
