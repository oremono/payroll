/**
 * Skip-to-content link (WCAG 2.2 AA — SC 2.4.1 Bypass Blocks).
 *
 * The sidebar puts seven links between a fresh page load and the data on every route. Without this,
 * a keyboard or screen-reader user pays for all seven on every navigation. It is therefore FIRST in
 * DOM order — before the sidebar, before the header — so it is the first Tab stop from page start,
 * which is the only position that makes it a bypass at all.
 *
 * Visually hidden until focused, never `display: none`: a hidden-from-everyone link is not
 * focusable and would be a decoration rather than an affordance. `sr-only` keeps it in the
 * accessibility tree and in the tab order; `focus:not-sr-only` brings it back into the page the
 * instant it receives focus, so a sighted keyboard user can see where they are.
 *
 * Not a client component — it has no state and no handler. The browser's own fragment navigation
 * does the work, and `#main-content` carries `tabIndex={-1}` so focus actually lands inside `main`
 * rather than merely scrolling to it.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only rounded border border-border-strong bg-surface-card p-3 text-body-md text-ink focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-30"
    >
      Skip to content
    </a>
  );
}
