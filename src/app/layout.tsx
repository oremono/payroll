import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

// Self-hosted webfonts, static packages. DESIGN binds every label to Hanken Grotesk and EVERY
// numeral to JetBrains Mono ("a proportional numeral anywhere in a data surface is a defect"), and
// until now neither face was ever loaded — the generated `--font-sans` / `--font-mono` stacks fell
// through to `ui-sans-serif` / `ui-monospace`, which satisfies the monospacing but not the
// identity.
//
// Fontsource rather than `next/font` on purpose: `next/font` mints a GENERATED family name
// (`__Hanken_Grotesk_1a2b3c`), but the two font tokens are generated from DESIGN.md and drift-gated
// by `npm run tokens:check`, so naming it would mean hand-authoring a token or amending the single
// source of visual truth. These packages declare the LITERAL families 'Hanken Grotesk' and
// 'JetBrains Mono' — which the existing stacks already name first, so nothing about the token
// contract changes; the fallback simply stops being what renders.
//
// Only the weights DESIGN actually uses: sans 400 (body), 600 (headlines), 700 (label-caps);
// mono 400 (number-sm), 500 (number-md), 600 (number-lg).
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';

import './globals.css';

import { systemClock } from '@/adapters/clock';
import { AppHeader } from '@/ui/app-header';
import { Announcer } from '@/ui/announcer';
import { SidebarNav } from '@/ui/sidebar-nav';
import { SkipLink } from '@/ui/skip-link';

// A title TEMPLATE, not one static string: each route sets its own short `title` (the sidebar
// label, or the employee's name on the detail route) and Next composes it as `<label> · <product>`,
// so the browser tab, history, and bookmarks name the surface being viewed. Home and any route that
// sets no title of its own fall through to `default` — the bare product name, unprefixed.
export const metadata: Metadata = {
  title: {
    default: 'Salary Management for ACME HR',
    template: '%s · Salary Management for ACME HR',
  },
  description: 'Salary management for ACME HR.',
};

/**
 * The composition root (AD-21). This is the ONE place that constructs an adapter and injects it —
 * `src/ui/**` receives values as props and never reaches for infrastructure.
 *
 * ## Why `await connection()` comes first
 *
 * `systemClock.todayUtc()` reads the wall clock. Without `connection()`, Next would evaluate it at
 * BUILD time and bake the build date into a static prerender, so "today" would silently be the day
 * the app was deployed — for as long as the deployment lived. `connection()` marks the render as
 * depending on an actual request, which moves the clock read to request time where it belongs. It
 * also makes the render dynamic, which is what lets `useSearchParams()` inside `<AsOfControl>`
 * resolve without a Suspense boundary.
 *
 * ## Structure
 *
 * `<Announcer>` is outermost so the live region is mounted once, above every surface, and survives
 * every same-route as-of change (see its own header for why that is the whole point). `<SkipLink>`
 * is the first focusable element in the document — before the sidebar's seven links — which is the
 * only position that makes it a bypass. `main` carries `tabIndex={-1}` so the skip link moves FOCUS
 * into it rather than merely scrolling to it.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const today = systemClock.todayUtc();

  return (
    <html lang="en">
      <body>
        <Announcer>
          <SkipLink />
          <SidebarNav />
          {/* `pl-64` clears the fixed 256px sidebar — 64 x --spacing, the same token the sidebar's
              own `w-64` reads, so the two can never drift apart. */}
          <div className="pl-64">
            <AppHeader today={today} />
            <main id="main-content" tabIndex={-1} className="bg-surface-base p-container-margin">
              {children}
            </main>
          </div>
        </Announcer>
      </body>
    </html>
  );
}
