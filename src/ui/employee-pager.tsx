import Link from 'next/link';

import {
  directoryHref,
  directoryStatusLine,
  type DirectorySearchParams,
  type DirectorySlice,
} from '@/ui/employee-directory';

/**
 * The directory's pager. URL-driven, because the page it turns is a Server Component.
 *
 * `import-panel.tsx`'s pager is two buttons over client state, which works because its report lives
 * in `useState`. That cannot work here: turning a page means running `listEmployees` again on the
 * server, and AD-21 forbids a client-side fetch to our own origin for a read. So each end is a real
 * `<Link>` to a real URL — which also makes a page position shareable, bookmarkable, and correct
 * under the back button, for free.
 *
 * Pagination, never infinite scroll (epic-3-context § UX: "data tables paginate — infinite scroll
 * is banned").
 *
 * ## Why the ends are text rather than links
 *
 * On the first page there is no previous page, so there is no URL to point at. A disabled-looking
 * link that still navigates is a trap for a keyboard user, and a link to the page you are already
 * on is a lie about where it goes. `<a>` has no `disabled`, so the honest rendering is to stop
 * being a link at all: the end control becomes plain `ink-faint` text, and the Tab sequence simply
 * has one fewer stop.
 *
 * Every number in the status line comes from the slice, which came from the payload's ECHOED
 * effective limit and offset — never from what the URL asked for.
 */
export function EmployeePager({
  slice,
  searchParams,
}: {
  readonly slice: DirectorySlice;
  /** The current URL's params, so `asOf` and everything else survives a page change. */
  readonly searchParams: DirectorySearchParams;
}) {
  const hasPrevious = slice.pageNumber > 1;
  const hasNext = slice.pageNumber < slice.pageCount;

  const END_TEXT = 'rounded border border-border-hairline px-3 py-2 text-body-sm text-ink-faint';
  const LINK = 'rounded border border-input-border bg-surface-card px-3 py-2 text-body-sm text-ink';

  return (
    <nav aria-label="Employee directory pages" className="mt-3 flex items-center gap-3">
      {hasPrevious ? (
        <Link href={directoryHref(searchParams, { page: slice.pageNumber - 1 })} className={LINK}>
          Previous page
        </Link>
      ) : (
        <span className={END_TEXT}>Previous page</span>
      )}

      <p className="font-mono text-number-sm text-ink-muted">{directoryStatusLine(slice)}</p>

      {hasNext ? (
        <Link href={directoryHref(searchParams, { page: slice.pageNumber + 1 })} className={LINK}>
          Next page
        </Link>
      ) : (
        <span className={END_TEXT}>Next page</span>
      )}
    </nav>
  );
}
