import {
  SkeletonAsOfEcho,
  SkeletonCardHeading,
  SkeletonRows,
  SkeletonSurface,
  SkeletonTextLine,
} from '@/ui/skeleton';

/**
 * Home's cold-load state — and, because this is the ROOT segment's `loading.tsx`, the fallback for
 * any route below it that declares none of its own.
 *
 * Home is the heaviest surface in the application: the outlier sweep, the gender pulse, the payroll
 * summary, and the overdue count are four independent reads over the same as-of date. Without a
 * boundary here, clicking "Home" left the PREVIOUS page on screen for the whole of that server
 * render — the router had committed, the browser was working, and the only thing the person could
 * see was that nothing had happened. That is the failure this file exists to end: the chrome lands
 * on the click, the data lands when it lands (EXPERIENCE § Cross-cutting state patterns, "no
 * spinners, no progress theater").
 *
 * The four cards mirror the four Home renders in DOM order, at the same `mt-3` rhythm, so the
 * surface settles in place rather than growing under the reader.
 */

/** Enough rows to fill the fold without pretending to know the finding count. */
const FINDING_ROWS = 8;

/** The distribution and by-country pulses draw one hairline row per bar. */
const PULSE_ROWS = 4;

export default function HomeLoading() {
  return (
    <>
      <SkeletonAsOfEcho />

      <div className="mt-3">
        <SkeletonSurface id="home-findings-loading-heading" heading="Loading the outlier findings">
          <SkeletonCardHeading />
          <div className="mt-3">
            <SkeletonRows
              rows={FINDING_ROWS}
              columns={5}
              rowHeightClass="h-9"
              rowPaddingClass="px-cell-padding-h"
            />
          </div>
        </SkeletonSurface>
      </div>

      <div className="mt-3">
        <SkeletonSurface
          id="home-gender-loading-heading"
          heading="Loading the gender distribution by level"
        >
          <SkeletonCardHeading />
          <div className="mt-3">
            <SkeletonRows rows={PULSE_ROWS} columns={2} rowHeightClass="h-9" />
          </div>
        </SkeletonSurface>
      </div>

      {/* The payroll summary is a TILE plus a pulse, at `gap-gutter` — the same two-card stack
          `PayrollSummary` renders. */}
      <div className="mt-3 flex flex-col gap-gutter">
        <SkeletonSurface id="home-payroll-tile-loading-heading" heading="Loading the total payroll">
          <SkeletonCardHeading />
          {/* `number-lg` is a 32px line box: the headline figure is the tallest thing on Home. */}
          <div className="mt-3">
            <SkeletonTextLine lineHeightClass="h-8" widthClass="w-56" />
          </div>
          <div className="mt-1">
            <SkeletonTextLine lineHeightClass="h-4" widthClass="w-72" />
          </div>
        </SkeletonSurface>

        <SkeletonSurface
          id="home-payroll-pulse-loading-heading"
          heading="Loading payroll by country"
        >
          <SkeletonCardHeading />
          <div className="mt-3">
            <SkeletonRows rows={PULSE_ROWS} columns={2} rowHeightClass="h-9" />
          </div>
        </SkeletonSurface>
      </div>

      <div className="mt-3">
        <SkeletonSurface id="home-overdue-loading-heading" heading="Loading the overdue count">
          <SkeletonCardHeading />
          <div className="mt-3">
            <SkeletonTextLine lineHeightClass="h-5" widthClass="w-80" />
          </div>
          <div className="mt-3">
            <SkeletonTextLine lineHeightClass="h-4" widthClass="w-48" />
          </div>
        </SkeletonSurface>
      </div>
    </>
  );
}
