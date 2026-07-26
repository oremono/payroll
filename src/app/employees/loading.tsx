import { SkeletonRows, SkeletonSurface } from '@/ui/skeleton';

/**
 * The directory's cold-load state: hairline skeleton rows, and no spinner.
 *
 * DR17 / EXPERIENCE § Cross-cutting state patterns bans progress theater outright — no spinner, no
 * bar, no percentage. What a skeleton buys instead is that the page's CHROME and its SHAPE land
 * immediately, so the surface does not jump when the rows arrive: six columns, 36px rows, the same
 * hairline dividers the real table draws.
 *
 * The shapes themselves come from `@/ui/skeleton`, which every route's `loading.tsx` shares — see
 * that module for why the whole thing is `aria-hidden` behind a single `sr-only` statement.
 */

/** Matches the table's page size, so the surface does not resize when the rows land. */
const SKELETON_ROWS = 25;

const COLUMNS = 6;

export default function EmployeesLoading() {
  return (
    <SkeletonSurface id="employees-loading-heading" heading="Loading the employee directory">
      <SkeletonRows
        rows={SKELETON_ROWS}
        columns={COLUMNS}
        rowHeightClass="h-9"
        rowPaddingClass="px-cell-padding-h"
      />
    </SkeletonSurface>
  );
}
