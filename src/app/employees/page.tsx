import type { Metadata } from 'next';
import Link from 'next/link';

import { DEFAULT_LIST_LIMIT, MAX_SEARCH_LENGTH } from '@/adapters/db/employee-repository';
import { pageTitleFor } from '@/ui/nav-items';

// The browser-tab title for this surface, drawn from the same IA declaration the sidebar and the
// header `<h1>` read (`nav-items`), so the tab can never name the page differently than the shell.
// Next composes it through the layout's template as `Employees · Salary Management for ACME HR`.
export const metadata: Metadata = { title: pageTitleFor('/employees') };
import {
  listEmployees,
  loadEmployeeFormOptions,
  type ListEmployeesResult,
} from '@/application/use-cases/employees';
import {
  directoryEmptyState,
  directoryOffsetCorrection,
  directoryOffsetFor,
  directorySlice,
  parseDirectoryParams,
  type DirectorySearchParams,
} from '@/ui/employee-directory';
import { EmployeeFormPanel } from '@/ui/employee-form-panel';
import { EmployeePager } from '@/ui/employee-pager';
import { EmployeeSearch } from '@/ui/employee-search';
import { EmployeeTable } from '@/ui/employee-table';
import { EmployeeUnavailable } from '@/ui/employee-unavailable';

import { createEmployeeAction } from './actions';
import { employeeReadDeps } from './employee-deps';

/**
 * Employees — the CAP-2 directory (story 3-2). Until now this route was story 1-6's placeholder.
 *
 * A React Server Component calling `listEmployees` and `loadEmployeeFormOptions` IN-PROCESS
 * (AD-21). There is no `fetch` to our own origin anywhere on this surface, and no Route Handler:
 * exactly two exist in the whole system and neither is this.
 *
 * This file is the COMPOSITION ROOT for the surface — the only one allowed to touch both
 * `@/adapters/*` and `@/ui/*`. That is why `DEFAULT_LIST_LIMIT`, `MAX_SEARCH_LENGTH`, and
 * `createEmployeeAction` are read here and passed inward as arguments and props: `src/ui/**` may
 * import `domain` and `application` only, and a second copy of the page size in the UI would let
 * the pager and the adapter disagree about the same number.
 *
 * ## This is not an as-of surface
 *
 * `listEmployees` takes no as-of date, and `totalCount` counts the `employee` TABLE, not the AD-16
 * as-of population. No copy on this page calls that number a headcount, a population, or anything a
 * statistic would own. The `asOf` param is nonetheless preserved on every link, because it is
 * global ambient provenance and a link that dropped it would wind the whole application back to
 * today as a side effect of turning a page.
 *
 * ## Why the read can happen twice
 *
 * `?page=99` against 30 employees reads past the end and comes back with no rows, while
 * `totalCount` still describes the whole table — so the pager and the status line would sit beside
 * an empty table describing page 2 of 2. `directoryOffsetCorrection` says so, and the surface reads
 * again at the last page's offset. Only the hostile path pays for it: a page turn follows a link
 * this surface built, and lands with no correction.
 *
 * ## The `unavailable` arm
 *
 * When the read answers `unavailable` this page renders ONLY the calm region — no toolbar, no
 * search field, no Add-employee button, no table, no pager. The `/` shortcut therefore has no
 * target on that state, which is correct: it binds to a surface that has a search field. Nothing
 * here is wrapped in `try`/`catch`; totality is the contract's, not this file's.
 */

const UNAVAILABLE_HEADING = 'The employee directory could not be read';

export default async function EmployeesPage({
  searchParams,
}: {
  readonly searchParams: Promise<DirectorySearchParams>;
}) {
  const params = await searchParams;
  const { q, page } = parseDirectoryParams(params, MAX_SEARCH_LENGTH);

  const deps = employeeReadDeps();
  const query = { search: q, limit: DEFAULT_LIST_LIMIT };

  let listed: ListEmployeesResult = await listEmployees(deps, {
    ...query,
    offset: directoryOffsetFor(page, DEFAULT_LIST_LIMIT),
  });

  if (listed.kind === 'page') {
    const correction = directoryOffsetCorrection(listed);
    if (correction !== null) {
      listed = await listEmployees(deps, { ...query, offset: correction });
    }
  }

  if (listed.kind === 'unavailable') {
    return (
      <EmployeeUnavailable
        id="employees-unavailable-heading"
        heading={UNAVAILABLE_HEADING}
        statement="The directory is not readable right now, so no employees can be listed. Nothing has changed."
      />
    );
  }

  const options = await loadEmployeeFormOptions(deps);
  const slice = directorySlice(listed);
  const empty = directoryEmptyState(listed.totalCount, q);

  return (
    <>
      {/* The toolbar is a CARD, not a bare strip: form controls sit on `surface-card`, where
          `input-border` measures 3.09:1 — on `surface-base` it is 2.96:1 and on `surface-tint`
          2.82:1, both below DESIGN's own 3:1 non-text floor. The search field being inside a card
          is that rule, not decoration. */}
      <section
        aria-labelledby="employees-toolbar-heading"
        className="rounded border border-border-hairline bg-surface-card p-4"
      >
        {/* `<h2>`, not `<h1>` — the header owns the document's one top-level heading, derived from
            nav-items so it cannot disagree with the sidebar. */}
        <h2 id="employees-toolbar-heading" className="text-headline-md text-ink">
          Employee directory
        </h2>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <EmployeeSearch searchParams={params} q={q} />
          {options.kind === 'options' ? (
            <EmployeeFormPanel
              mode={{ kind: 'create', action: createEmployeeAction }}
              options={options.options}
            />
          ) : (
            // No Add-employee button, and never an empty select: the reference tables are what a
            // create would have to choose from, so a form that could not read them has nothing to
            // offer. Said out loud rather than silently omitting the control.
            <p className="text-body-sm text-ink-muted">
              The reference tables could not be read, so no employee can be added right now.
            </p>
          )}
        </div>
      </section>

      {empty === null ? (
        <section
          aria-labelledby="employees-list-heading"
          className="mt-4 rounded border border-border-hairline bg-surface-card p-4"
        >
          <h2 id="employees-list-heading" className="sr-only">
            Employees
          </h2>
          <EmployeeTable employees={listed.employees} asOfParam={asOfParamOf(params)} />
          <EmployeePager slice={slice} searchParams={params} />
        </section>
      ) : (
        <section
          aria-labelledby="employees-empty-heading"
          className="mt-4 rounded border border-border-hairline bg-surface-card p-4"
        >
          <h2 id="employees-empty-heading" className="text-body-md font-medium text-ink-muted">
            {empty.kind === 'first-run' ? 'No employees yet' : 'No matches'}
          </h2>
          <p className="mt-1 text-body-md text-ink">{empty.statement}</p>
          {empty.kind === 'first-run' ? (
            <p className="mt-2 text-body-sm">
              <Link href="/import" className="text-primary underline underline-offset-2">
                Import a spreadsheet
              </Link>
            </p>
          ) : null}
        </section>
      )}
    </>
  );
}

/**
 * The RAW `asOf` param, for `navHrefWithAsOf`. `undefined` for an absent OR repeated one — a
 * repeated param is ambiguous, `resolveAsOf` is the one place that decides so, and an ambiguous
 * value resolves to today identically on both sides of a navigation.
 */
function asOfParamOf(params: DirectorySearchParams): string | undefined {
  const raw = params['asOf'];
  return typeof raw === 'string' ? raw : undefined;
}
