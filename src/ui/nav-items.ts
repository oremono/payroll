/**
 * The application's information architecture as DATA.
 *
 * The seven destinations and their labels are ratified verbatim (epic-1-context § App shell and
 * IA); this module is their single declaration, so the sidebar, the page `<h1>`, and any future
 * breadcrumb all read the same list rather than three drifting copies.
 *
 * Pure and framework-free on purpose — no React, no `next/navigation`. That is what lets the order,
 * the labels, and the active-item rule be unit-tested without a DOM (story constraint: no jsdom,
 * no `@testing-library`). The components that consume it are the things Playwright tests.
 */

/** One sidebar destination. */
export type NavItem = {
  readonly href: string;
  readonly label: string;
};

/** Shown on a route no nav item claims and that is not otherwise named below. */
const PRODUCT_NAME = 'Salary Management for ACME HR';

/**
 * The employee DETAIL route (`/employees/<id>`) has no nav item of its own. Naming the SURFACE —
 * "Employee" — is truer than the bare product-name fallback: the header `<h1>` then says what kind
 * of page this is, consistent with every other route, while the person's name stays the card's own
 * heading in the page body (the document keeps its one `<h1>` in the header).
 */
const EMPLOYEE_DETAIL_LABEL = 'Employee';

/** The six working destinations, in the order they appear in the sidebar. */
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/employees', label: 'Employees' },
  { href: '/gender-insights', label: 'Gender Insights' },
  { href: '/payroll-totals', label: 'Payroll Totals' },
  { href: '/overdue', label: 'Overdue for Review' },
  { href: '/import', label: 'Import' },
];

/**
 * Settings, held apart because it is PINNED TO THE BOTTOM of the sidebar rather than following the
 * others in flow. Separate constants rather than an index into a combined list: under
 * `noUncheckedIndexedAccess` an index yields `NavItem | undefined` and would force an unreachable
 * branch into every consumer.
 */
export const SETTINGS_NAV_ITEM: NavItem = { href: '/settings', label: 'Settings' };

/** All seven, in reading order — which is also DOM order, and therefore Tab order. */
export const NAV_ITEMS: readonly NavItem[] = [...PRIMARY_NAV_ITEMS, SETTINGS_NAV_ITEM];

/**
 * Whether `itemHref` is the destination currently being viewed.
 *
 * EXACT match, not a prefix. `/` is a prefix of every path in the application, so a prefix rule
 * would light Home up on all seven routes — and `aria-current="page"` on two items at once is an
 * accessibility defect (WCAG 2.2 AA is the floor), not a cosmetic one.
 */
export function isActiveNavItem(itemHref: string, pathname: string): boolean {
  return itemHref === pathname;
}

/**
 * A nav destination's href with the current as-of date carried onto it.
 *
 * The as-of date is PERSISTENT ambient provenance, not a per-page filter (DESIGN § Components →
 * As-of date control: "always visible on every screen; it is ambient provenance, not a filter
 * buried in toolbars"). It lives in the URL, so a link that omits it silently winds the whole
 * application back to today on every navigation — with no signal, because the header dutifully
 * reports the today it was just handed. That defeats both halves of the promise: the date persists,
 * and a bookmarked URL reproduces the view.
 *
 * Only `asOf` travels. Every other search param is a property of the surface that owns it — a query
 * string, a page number — and carrying those across destinations would be the opposite mistake.
 *
 * `asOfParam` is the RAW param, not a parsed date: this module is pure and has no clock, so it
 * cannot resolve one, and it does not need to. `resolveAsOf` at the destination's boundary is the
 * single place that decides what a param means, and a hostile value therefore resolves to today
 * identically before and after the navigation.
 *
 * `undefined` (no param, or an ambiguous repeated one) leaves the href bare — today is the default
 * and needs no spelling out.
 */
export function navHrefWithAsOf(itemHref: string, asOfParam: string | undefined): string {
  if (asOfParam === undefined) {
    return itemHref;
  }
  return `${itemHref}?asOf=${encodeURIComponent(asOfParam)}`;
}

/**
 * The page title for a path — the header's `<h1>`, which is the first heading in DOM order and
 * therefore the document's accessible name for the surface being viewed.
 */
export function pageTitleFor(pathname: string): string {
  const active = NAV_ITEMS.find((item) => isActiveNavItem(item.href, pathname));
  if (active !== undefined) {
    return active.label;
  }
  // `/employees/<id>` — a claimed SURFACE without its own nav item. Any path one segment below the
  // directory is a detail page; `/employees` itself is the nav item handled above.
  if (isEmployeeDetailPath(pathname)) {
    return EMPLOYEE_DETAIL_LABEL;
  }
  return PRODUCT_NAME;
}

/** Whether `pathname` is an employee DETAIL route — `/employees/<non-empty>`, not `/employees`. */
function isEmployeeDetailPath(pathname: string): boolean {
  const prefix = '/employees/';
  return pathname.startsWith(prefix) && pathname.length > prefix.length;
}
