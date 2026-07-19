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

/** Shown on every route when no nav item claims the path (e.g. a future `/employees/[id]`). */
const PRODUCT_NAME = 'Salary Management for ACME HR';

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
 * The page title for a path — the header's `<h1>`, which is the first heading in DOM order and
 * therefore the document's accessible name for the surface being viewed.
 */
export function pageTitleFor(pathname: string): string {
  const active = NAV_ITEMS.find((item) => isActiveNavItem(item.href, pathname));
  return active === undefined ? PRODUCT_NAME : active.label;
}
