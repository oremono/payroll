'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import {
  isActiveNavItem,
  navHrefWithAsOf,
  PRIMARY_NAV_ITEMS,
  SETTINGS_NAV_ITEM,
  type NavItem,
} from '@/ui/nav-items';

/**
 * The fixed 256px primary sidebar (DESIGN § Layout & Spacing: "fixed 256px side nav").
 *
 * A client component for exactly one reason: `usePathname()`. The active item must be known on the
 * client so it stays correct across a client-side navigation, and `aria-current="page"` must move
 * with it — a stale `aria-current` is worse than none, because it asserts something false to the
 * one user who cannot see the highlight.
 *
 * The brand block is deliberately **not a heading**. The first `<h1>` in DOM order is the page
 * title in the header, which is what names the surface being viewed; a brand `<h1>` here would
 * outrank it and make every one of the seven routes announce the same title.
 *
 * Active state is carried by THREE signals — background, weight, and `aria-current` — never by
 * color alone (DESIGN: "Color is never the sole carrier of meaning").
 *
 * Every href CARRIES THE AS-OF DATE (`navHrefWithAsOf`). The as-of date is persistent ambient
 * provenance, not a per-page filter, and it lives in the URL — so a bare href silently returns the
 * whole application to today on every navigation, with no signal at all, because the header then
 * reports the today it was just handed. That is why this component reads the search params as well
 * as the path. (Code review 2026-07-19.)
 *
 * Every class compiles to a generated token: `w-64` is 64 x `--spacing` (256px), `h-16` is 64px,
 * `p-container-margin` is `--spacing-container-margin`. Nothing here is a hand-written length, and
 * there is no `dark:` variant — the same names re-point themselves under `prefers-color-scheme`.
 */

const LINK_BASE = 'block rounded px-3 py-2 text-body-md';
const LINK_IDLE = `${LINK_BASE} text-ink-muted hover:bg-surface-tint hover:text-ink`;
const LINK_ACTIVE = `${LINK_BASE} bg-surface-tint font-semibold text-primary`;

function NavLink({
  item,
  pathname,
  asOfParam,
}: {
  item: NavItem;
  pathname: string;
  asOfParam: string | undefined;
}) {
  const isActive = isActiveNavItem(item.href, pathname);

  return (
    <li>
      <Link
        href={navHrefWithAsOf(item.href, asOfParam)}
        aria-current={isActive ? 'page' : undefined}
        className={isActive ? LINK_ACTIVE : LINK_IDLE}
      >
        {item.label}
      </Link>
    </li>
  );
}

export function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `getAll`, not `get` — the same reading `<AsOfControl>` and `resolveAsOf` make. A REPEATED param
  // is ambiguous, and an ambiguous param is not a date: propagating one of two contradictory
  // instructions would be worse than propagating neither, and the destination resolves it to today
  // either way. Zero values is the same non-answer.
  const asOfValues = searchParams.getAll('asOf');
  const asOfParam = asOfValues.length === 1 ? asOfValues[0] : undefined;

  return (
    <nav
      aria-label="Primary"
      // `overflow-y-auto` is load-bearing, not defensive (code review 2026-07-19). This element is
      // `fixed`, so its content does not extend the page: at a 320px-tall viewport the sidebar's
      // scrollHeight is 385px, the Settings link sits at y=337, and with the default
      // `overflow-y: visible` it is simply unreachable — off the bottom of a box that cannot
      // scroll and cannot be scrolled past.
      className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col overflow-y-auto border-r border-border-hairline bg-surface-card"
    >
      <div className="flex h-16 shrink-0 items-center border-b border-border-hairline px-3">
        <span className="text-headline-md text-primary">ACME HR</span>
      </div>

      <ul className="flex-1 space-y-1 p-3">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} asOfParam={asOfParam} />
        ))}
      </ul>

      {/* Settings is pinned to the BOTTOM (ratified IA), which is why it is a list of its own
          rather than the last row of the one above — `flex-1` on that list pushes this to the
          floor of the sidebar at any viewport height. */}
      <ul className="border-t border-border-hairline p-3">
        <NavLink item={SETTINGS_NAV_ITEM} pathname={pathname} asOfParam={asOfParam} />
      </ul>
    </nav>
  );
}
