import type { ReactNode } from 'react';

/**
 * The cold-load vocabulary, declared ONCE.
 *
 * EXPERIENCE § Cross-cutting state patterns is unambiguous: "**No spinners, no progress theater.**
 * Cold loads render the surface's chrome immediately with skeleton hairline rows in place of data."
 * Every route's `loading.tsx` is therefore the same three moves — the card lands, the hairlines land,
 * and the shape is the shape the data will occupy — and this module is where those moves live so the
 * eight of them cannot drift into eight dialects of the same idea.
 *
 * Everything here is a SERVER component and a pure function of its props: no state, no effect, no
 * `'use client'`. A Suspense fallback that needed hydrating would be the one thing worse than no
 * fallback at all.
 *
 * ## Why `aria-hidden` covers the whole thing, with one `sr-only` statement beside it
 *
 * A screen reader has nothing to gain from twenty-five empty rows, and announcing them as a table
 * would be announcing data that does not exist. `SkeletonSurface` therefore carries the meaning in a
 * single visually-hidden `<h2>` and hides the bars themselves. The `<h2>`, not an `<h1>`: the
 * header's page title is the document's one `<h1>` and it is already on screen — the shell does not
 * unmount during a navigation, so the surface being loaded is named before this ever renders.
 *
 * Every class compiles to a generated token. `surface-tint` rather than an animated shimmer: the
 * flat-surface rule holds here too, and an animation would be the progress theater the skeleton
 * replaces.
 */

/** The one fill every skeleton shape is painted with. */
const FILL = 'rounded-sm bg-surface-tint';

/**
 * One placeholder bar. `className` carries its size — a bar with no height is not a bar, so callers
 * always say at least that much.
 */
export function SkeletonBar({ className }: { readonly className: string }) {
  return <div className={`${FILL} ${className}`} />;
}

/**
 * A bar standing in for ONE line of text, inside a line box of the real text's height.
 *
 * The wrapper is what keeps the page from jumping: a bare 12px bar where a 20px line of body copy
 * will land is 8px of movement per line, and the surfaces here stack four cards of them.
 * `lineHeightClass` is the generated `--text-*--line-height` for the scale being stood in for —
 * `h-4` for `label-caps` and `body-sm` (16px), `h-5` for `body-md` (20px), `h-8` for `number-lg`
 * (32px).
 */
export function SkeletonTextLine({
  lineHeightClass,
  widthClass,
}: {
  readonly lineHeightClass: string;
  readonly widthClass: string;
}) {
  return (
    <div className={`flex items-center ${lineHeightClass}`}>
      <SkeletonBar className={`h-3 ${widthClass}`} />
    </div>
  );
}

/**
 * The `label-caps` heading bar every data card opens with (`OUTLIER FINDINGS`, `TOTAL PAYROLL`,
 * `OVERDUE FOR REVIEW` — DESIGN § Components → Card).
 */
export function SkeletonCardHeading({ widthClass = 'w-40' }: { readonly widthClass?: string }) {
  return <SkeletonTextLine lineHeightClass="h-4" widthClass={widthClass} />;
}

/**
 * A card-shaped skeleton region: the real card's border, surface, and padding, landing immediately
 * with the placeholder shapes inside it.
 *
 * `heading` is what a screen reader gets INSTEAD of the shapes — a statement of what is being
 * loaded, not a label on a bar. `id` must be unique on the page, because a route that stacks several
 * of these stacks several headings.
 */
export function SkeletonSurface({
  id,
  heading,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded border border-border-hairline bg-surface-card p-4"
    >
      <h2 id={id} className="sr-only">
        {heading}
      </h2>

      <div aria-hidden="true">{children}</div>
    </section>
  );
}

/**
 * `rows` hairline rows of `columns` bars — the shape a table occupies before its data arrives.
 *
 * `rows` should match the surface's PAGE SIZE and `columns` its column count, so the surface does
 * not resize when the real rows land. `rowHeightClass` is the row height the real table draws (the
 * directory's 36px rows are `h-9`; the overdue list's 40px rows are `h-10`), and `rowPaddingClass`
 * exists for the tables that pad their cells horizontally — a skeleton indented differently from the
 * table it stands in for is a skeleton that moves when the data lands.
 */
export function SkeletonRows({
  rows,
  columns,
  rowHeightClass,
  rowPaddingClass = '',
}: {
  readonly rows: number;
  readonly columns: number;
  readonly rowHeightClass: string;
  readonly rowPaddingClass?: string;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_unusedRow, row) => (
        <div
          key={row}
          className={`flex items-center gap-3 border-b border-border-hairline ${rowHeightClass} ${rowPaddingClass}`}
        >
          {Array.from({ length: columns }, (_unusedColumn, column) => (
            <SkeletonBar key={column} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * The as-of echo line's placeholder — the one-line card every dated surface opens with ("Showing …
 * as of {date}.").
 *
 * Sized to 20px of content inside 12px of padding, which is `--text-body-md--line-height` inside
 * `p-3`: exactly the height of the real sentence, so the whole page below it does not jump down when
 * the date arrives. It is a `<div>` rather than a `<p>` deliberately — the real echo line is the
 * first `<p>` in `main`, which is what `e2e/tokens.spec.ts` reads its computed type scale off, and a
 * placeholder impersonating it during a navigation would be a second answer to that query.
 */
export function SkeletonAsOfEcho() {
  return (
    <div aria-hidden="true" className="rounded bg-surface-card p-3">
      <SkeletonTextLine lineHeightClass="h-5" widthClass="w-64" />
    </div>
  );
}
