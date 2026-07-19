'use client';

import { usePathname } from 'next/navigation';

import { AsOfControl } from '@/ui/as-of-control';
import { pageTitleFor } from '@/ui/nav-items';
import type { PlainDate } from '@/domain/plain-date';

/**
 * The fixed 64px application header (DESIGN § Layout & Spacing: "fixed 256px side nav + fixed 64px
 * header"). Page title on the left, the as-of control right-aligned — the placement DESIGN
 * specifies for it, on every screen without exception, because it is ambient provenance as much as
 * a control.
 *
 * The title is the document's one `<h1>` and the FIRST heading in DOM order (the sidebar brand is
 * deliberately not a heading), so it is what names the surface being viewed. It is derived from
 * `nav-items` rather than passed by each page: one declaration of the IA, so a label can never
 * disagree with the sidebar item that leads to it.
 *
 * `today` is a PROP, resolved once in `src/app/layout.tsx` from the clock port and handed down. No
 * component reads a clock — the composition root is the only place that may (Law 6 / AD-11).
 */
export function AppHeader({ today }: { today: PlainDate }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-border-hairline bg-surface-card px-container-margin">
      <h1 className="text-headline-lg text-ink">{pageTitleFor(pathname)}</h1>
      <AsOfControl today={today} />
    </header>
  );
}
