/**
 * The directory's cold-load state: hairline skeleton rows, and no spinner.
 *
 * DR17 / EXPERIENCE § Cross-cutting state patterns bans progress theater outright — no spinner, no
 * bar, no percentage. What a skeleton buys instead is that the page's CHROME and its SHAPE land
 * immediately, so the surface does not jump when the rows arrive: six columns, 36px rows, the same
 * hairline dividers the real table draws.
 *
 * `aria-hidden` on the whole thing, with one `sr-only` statement carrying the meaning. A screen
 * reader has nothing to gain from twenty-five empty rows, and announcing them as a table would be
 * announcing data that does not exist.
 */

/** Matches the table's page size, so the surface does not resize when the rows land. */
const SKELETON_ROWS = 25;

const COLUMNS = 6;

export default function EmployeesLoading() {
  return (
    <section
      aria-labelledby="employees-loading-heading"
      className="rounded border border-border-hairline bg-surface-card p-4"
    >
      <h2 id="employees-loading-heading" className="sr-only">
        Loading the employee directory
      </h2>

      <div aria-hidden="true">
        {Array.from({ length: SKELETON_ROWS }, (_unused, row) => (
          <div
            key={row}
            className="flex h-9 items-center gap-3 border-b border-border-hairline px-cell-padding-h"
          >
            {Array.from({ length: COLUMNS }, (_alsoUnused, column) => (
              // `surface-tint` rather than an animated shimmer: the flat-surface rule holds here
              // too, and an animation would be the progress theater the skeleton replaces.
              <div key={column} className="h-3 flex-1 rounded-sm bg-surface-tint" />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
