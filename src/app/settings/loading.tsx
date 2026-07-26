import { SkeletonBar, SkeletonCardHeading, SkeletonSurface, SkeletonTextLine } from '@/ui/skeleton';

/**
 * Settings' cold-load state: the threshold card's chrome lands on the click, the persisted value
 * lands when `getSettings` returns.
 *
 * The control's own shapes (the number input and the Apply button) are drawn at their real heights
 * rather than as text bars, because this surface is a FORM — a person reaching for the input should
 * find it where the skeleton put it. No spinner, no bar, no percentage (EXPERIENCE § Cross-cutting
 * state patterns).
 */
export default function SettingsLoading() {
  return (
    <SkeletonSurface id="settings-loading-heading" heading="Loading the outlier threshold">
      <SkeletonCardHeading />

      {/* The explanatory `body-sm` line under the heading. */}
      <div className="mt-2">
        <SkeletonTextLine lineHeightClass="h-4" widthClass="w-96" />
      </div>

      {/* The input and its two buttons, at the form's own `items-end` / `gap-gutter` rhythm. */}
      <div className="mt-4 flex flex-wrap items-end gap-gutter">
        <SkeletonBar className="h-9 w-24" />
        <SkeletonBar className="h-9 w-20" />
      </div>
    </SkeletonSurface>
  );
}
