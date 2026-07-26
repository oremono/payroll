import { SkeletonAsOfEcho, SkeletonCardHeading, SkeletonRows, SkeletonSurface } from '@/ui/skeleton';

/**
 * Gender Insights' cold-load state: the as-of echo line and the distribution card's chrome land on
 * the click, the counts land when the read returns.
 *
 * No spinner, no bar, no percentage (EXPERIENCE § Cross-cutting state patterns) — see `@/ui/skeleton`
 * for the shared vocabulary and why the shapes are `aria-hidden` behind one `sr-only` statement.
 */

/** One hairline row per level bar, matching the fully-visible counts table the surface draws. */
const LEVEL_ROWS = 4;

export default function GenderInsightsLoading() {
  return (
    <>
      <SkeletonAsOfEcho />

      <div className="mt-3">
        <SkeletonSurface
          id="gender-insights-loading-heading"
          heading="Loading the gender distribution by level"
        >
          <SkeletonCardHeading />
          <div className="mt-3">
            <SkeletonRows rows={LEVEL_ROWS} columns={3} rowHeightClass="h-9" />
          </div>
        </SkeletonSurface>
      </div>
    </>
  );
}
