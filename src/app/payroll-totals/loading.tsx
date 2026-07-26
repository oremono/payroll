import {
  SkeletonAsOfEcho,
  SkeletonCardHeading,
  SkeletonRows,
  SkeletonSurface,
  SkeletonTextLine,
} from '@/ui/skeleton';

/**
 * Payroll Totals' cold-load state: the as-of echo line, the per-country table's chrome, and the
 * org-wide tile land on the click; the figures land when the totals and the currency reference list
 * return.
 *
 * No spinner, no bar, no percentage (EXPERIENCE § Cross-cutting state patterns) — see `@/ui/skeleton`
 * for the shared vocabulary and why the shapes are `aria-hidden` behind one `sr-only` statement.
 */

/** Enough rows to fill the fold without pretending to know the country count. */
const COUNTRY_ROWS = 8;

export default function PayrollTotalsLoading() {
  return (
    <>
      <SkeletonAsOfEcho />

      <div className="mt-3 flex flex-col gap-gutter">
        <SkeletonSurface
          id="payroll-totals-loading-heading"
          heading="Loading payroll totals by country"
        >
          <SkeletonCardHeading />
          <div className="mt-3">
            <SkeletonRows
              rows={COUNTRY_ROWS}
              columns={3}
              rowHeightClass="h-9"
              rowPaddingClass="px-cell-padding-h"
            />
          </div>
        </SkeletonSurface>

        <SkeletonSurface
          id="payroll-org-wide-loading-heading"
          heading="Loading the organisation-wide total"
        >
          <SkeletonCardHeading />
          {/* `number-lg` is a 32px line box — the converted headline figure. */}
          <div className="mt-3">
            <SkeletonTextLine lineHeightClass="h-8" widthClass="w-56" />
          </div>
          {/* Its provenance caption, which is never separated from the figure it qualifies. */}
          <div className="mt-1">
            <SkeletonTextLine lineHeightClass="h-4" widthClass="w-72" />
          </div>
        </SkeletonSurface>
      </div>
    </>
  );
}
