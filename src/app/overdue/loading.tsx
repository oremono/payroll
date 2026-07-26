import { SkeletonRows, SkeletonSurface } from '@/ui/skeleton';

/**
 * The Overdue surface's cold-load state: hairline skeleton rows, and no spinner.
 *
 * DR17 / EXPERIENCE § Cross-cutting state patterns bans progress theater outright — no spinner, no
 * bar, no percentage (epic-11-context § UX: "cold load shows skeleton hairline rows, never
 * spinners"). What a skeleton buys instead is that the page's CHROME and its SHAPE land immediately,
 * so the surface does not jump when the rows arrive: three columns, 40px rows, the same hairline
 * dividers the real table draws.
 *
 * The shapes themselves come from `@/ui/skeleton`, which every route's `loading.tsx` shares — see
 * that module for why the whole thing is `aria-hidden` behind a single `sr-only` statement.
 */

/** Matches the list's page size, so the surface does not resize when the rows land. */
const SKELETON_ROWS = 25;

const COLUMNS = 3;

export default function OverdueLoading() {
  return (
    <SkeletonSurface id="overdue-loading-heading" heading="Loading the overdue-for-review list">
      <SkeletonRows rows={SKELETON_ROWS} columns={COLUMNS} rowHeightClass="h-10" />
    </SkeletonSurface>
  );
}
