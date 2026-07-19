/**
 * The unknown-path surface (code review 2026-07-19).
 *
 * Without this file, Next served its OWN built-in 404 markup for any unmatched path — INSIDE the
 * root layout, because that is where an app-router 404 renders. The result was a document carrying
 * two top-level headings (the shell header's page title and Next's `404`) plus a block of unstyled
 * UA-default markup in the middle of the workspace, on a path no gate had ever visited. Two `<h1>`
 * elements break the shell invariant `e2e/shell.spec.ts` asserts on every other route, and the
 * heading structure a screen-reader user navigates by stops being a structure at all.
 *
 * It is a real surface, not an edge case: a stale bookmark, a mistyped URL, and a link that
 * outlived its route all land here. `e2e/accessibility.spec.ts` now judges it with axe in both
 * color schemes, exactly like the seven ratified destinations.
 *
 * There is no `<h1>` here, for the same reason there is none on any other page: the header's page
 * title is the document's one `<h1>` and the first heading in DOM order. It is derived from
 * `nav-items`, and no nav item claims this path, so it falls back to the product name.
 *
 * The copy is a STATEMENT, in the same calm register as the placeholder routes (EXPERIENCE
 * § Cross-cutting state patterns: "statements, never celebrations"). Not an apology, not a joke,
 * and deliberately no invented capability copy — it does not offer to search, suggest a
 * destination, or describe anything this product cannot yet do. The sidebar is already on screen
 * and is the way back.
 */
export default function NotFound() {
  return <p className="rounded bg-surface-card p-3 text-body-md">This page does not exist.</p>;
}
