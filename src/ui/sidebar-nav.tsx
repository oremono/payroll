'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isActiveNavItem, PRIMARY_NAV_ITEMS, SETTINGS_NAV_ITEM, type NavItem } from '@/ui/nav-items';

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
 * Every class compiles to a generated token: `w-64` is 64 x `--spacing` (256px), `h-16` is 64px,
 * `p-container-margin` is `--spacing-container-margin`. Nothing here is a hand-written length, and
 * there is no `dark:` variant — the same names re-point themselves under `prefers-color-scheme`.
 */

const LINK_BASE = 'block rounded px-3 py-2 text-body-md';
const LINK_IDLE = `${LINK_BASE} text-ink-muted hover:bg-surface-tint hover:text-ink`;
const LINK_ACTIVE = `${LINK_BASE} bg-surface-tint font-semibold text-primary`;

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = isActiveNavItem(item.href, pathname);

  return (
    <li>
      <Link
        href={item.href}
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

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-border-hairline bg-surface-card"
    >
      <div className="flex h-16 shrink-0 items-center border-b border-border-hairline px-3">
        <span className="text-headline-md text-primary">ACME HR</span>
      </div>

      <ul className="flex-1 space-y-1 p-3">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>

      {/* Settings is pinned to the BOTTOM (ratified IA), which is why it is a list of its own
          rather than the last row of the one above — `flex-1` on that list pushes this to the
          floor of the sidebar at any viewport height. */}
      <ul className="border-t border-border-hairline p-3">
        <NavLink item={SETTINGS_NAV_ITEM} pathname={pathname} />
      </ul>
    </nav>
  );
}
