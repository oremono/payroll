'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/**
 * The ONE app-level polite live region, and the context that lets anything announce into it.
 *
 * The rule it implements (epic-1-context § Announcement plumbing, AD-20): recompute and copy
 * announcements ride a **single** `aria-live="polite"` region **that is not remounted** by an as-of
 * or threshold change. Both halves are load-bearing:
 *
 *   SINGLE — a second live region means two things can speak at once, and screen readers give no
 *            guarantee about which wins or in what order. One region, one voice.
 *
 *   NOT REMOUNTED — this is the subtle one. A live region announces its CHANGES; a region that is
 *            itself replaced has no previous content to differ from, and most screen readers say
 *            nothing at all. So a region rendered inside the surface it reports on would be silent
 *            in exactly the case it exists for. Mounting it here, in the root layout, above every
 *            surface, is what makes it survive: an as-of change is a same-route param change, which
 *            re-renders the page but never remounts the layout, so this element is the SAME DOM
 *            node before and after. `e2e/shell.spec.ts` asserts precisely that, by tagging the node
 *            before the change and reading the tag back after.
 *
 * `aria-atomic="true"` makes the region read as a whole sentence rather than only the words that
 * changed — "Findings updated as of 12 May 2026" is one statement, not a diff.
 *
 * Deliberately NOT `role="alert"` / `aria-live="assertive"`: recompute is not an emergency, and
 * assertive interrupts whatever the user is reading. Refusal payloads are held to the same rule
 * (they render as a region with a heading, never an alert).
 */

type Announce = (message: string) => void;

const AnnounceContext = createContext<Announce>(() => undefined);

/**
 * Announce a sentence into the app-level live region.
 *
 * Safe to call from any client component under the layout. Outside the provider it is a no-op
 * rather than a throw — an announcement is an accessibility affordance, and failing to make one
 * must never take a working surface down with it.
 */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}

export function Announcer({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');

  const announce = useCallback<Announce>((next) => {
    setMessage(next);
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      <div id="app-announcer" aria-live="polite" aria-atomic="true" className="sr-only">
        {message}
      </div>
      {children}
    </AnnounceContext.Provider>
  );
}
