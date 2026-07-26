import {
  SkeletonCardHeading,
  SkeletonRows,
  SkeletonSurface,
  SkeletonTextLine,
} from '@/ui/skeleton';

/**
 * The employee detail surface's cold-load state.
 *
 * This route is reached by clicking a row in the directory, and it makes FIVE reads behind one
 * render — the employee, the reference options, the salary timeline, the peer comparison, and the
 * gender gap. Without a boundary here the directory simply sat there after the click, which reads as
 * a dead row rather than a loading page.
 *
 * The four cards mirror the four sections the page renders, in DOM order: the detail card with its
 * attribute list, then the salary timeline, the peer comparison, and the gender gap. No spinner, no
 * bar, no percentage (EXPERIENCE § Cross-cutting state patterns).
 */

/** The five attributes the detail card lists: role, level, country, gender, hire date. */
const ATTRIBUTE_ROWS = 5;

/** Enough rows to fill the fold without pretending to know the history's length. */
const TIMELINE_ROWS = 6;

export default function EmployeeDetailLoading() {
  return (
    <>
      <SkeletonSurface id="employee-detail-loading-heading" heading="Loading the employee">
        {/* The person's name, at `headline-md` (a 24px line box) — this card's own heading. */}
        <SkeletonTextLine lineHeightClass="h-6" widthClass="w-64" />

        {/* The attribute list: a label and its value per row, no hairlines (the real `<dl>` draws
            none either). */}
        <div className="mt-4">
          <SkeletonRows rows={ATTRIBUTE_ROWS} columns={2} rowHeightClass="h-7" />
        </div>
      </SkeletonSurface>

      <div className="mt-4">
        <SkeletonSurface id="salary-timeline-loading-heading" heading="Loading the salary history">
          <SkeletonCardHeading />
          <div className="mt-3">
            <SkeletonRows
              rows={TIMELINE_ROWS}
              columns={3}
              rowHeightClass="h-9"
              rowPaddingClass="px-cell-padding-h"
            />
          </div>
        </SkeletonSurface>
      </div>

      <div className="mt-4">
        <SkeletonSurface
          id="peer-comparison-loading-heading"
          heading="Loading the peer comparison"
        >
          <SkeletonCardHeading />
          <div className="mt-3">
            <SkeletonTextLine lineHeightClass="h-5" widthClass="w-80" />
          </div>
          <div className="mt-3">
            <SkeletonTextLine lineHeightClass="h-4" widthClass="w-64" />
          </div>
        </SkeletonSurface>
      </div>

      <div className="mt-4">
        <SkeletonSurface id="gender-gap-loading-heading" heading="Loading the gender gap">
          <SkeletonCardHeading />
          <div className="mt-3">
            <SkeletonTextLine lineHeightClass="h-5" widthClass="w-80" />
          </div>
          <div className="mt-3">
            <SkeletonTextLine lineHeightClass="h-4" widthClass="w-64" />
          </div>
        </SkeletonSurface>
      </div>
    </>
  );
}
