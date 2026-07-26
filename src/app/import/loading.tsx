import { SkeletonBar, SkeletonSurface, SkeletonTextLine } from '@/ui/skeleton';

/**
 * Import's cold-load state.
 *
 * This route reads nothing — the report is produced by an upload, not by a query — so its server
 * render is trivial and this fallback is usually gone before it is seen. It exists anyway, because
 * "usually" is doing real work in that sentence: the navigation is still a round trip, and on a slow
 * link or a cold server the alternative is the previous page sitting there looking unclicked.
 *
 * The shapes are the upload form's: a headline, a labelled file input, its help line, and the
 * button. No spinner, no bar, no percentage (EXPERIENCE § Cross-cutting state patterns).
 */
export default function ImportLoading() {
  return (
    <SkeletonSurface id="import-loading-heading" heading="Loading the import form">
      {/* `headline-md` is a 24px line box — this card titles itself, unlike the data cards. */}
      <SkeletonTextLine lineHeightClass="h-6" widthClass="w-56" />

      <div className="mt-3">
        <SkeletonTextLine lineHeightClass="h-4" widthClass="w-32" />
      </div>
      <div className="mt-1">
        <SkeletonBar className="h-9 w-72" />
      </div>
      <div className="mt-1">
        <SkeletonTextLine lineHeightClass="h-4" widthClass="w-96" />
      </div>

      <div className="mt-3">
        <SkeletonBar className="h-9 w-32" />
      </div>
    </SkeletonSurface>
  );
}
