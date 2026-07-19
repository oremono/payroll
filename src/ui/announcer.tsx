'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

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

/**
 * A REQUEST to announce, as opposed to what the region currently holds.
 *
 * `nonce` is what separates two requests carrying identical text — see the effect below. `pathname`
 * is what makes a request expire when the surface it describes is no longer on screen.
 */
type Announcement = {
  readonly text: string;
  readonly nonce: number;
  readonly pathname: string;
};

const SILENCE: Announcement = { text: '', nonce: 0, pathname: '' };

export function Announcer({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [request, setRequest] = useState<Announcement>(SILENCE);
  const regionRef = useRef<HTMLDivElement>(null);

  const announce = useCallback<Announce>(
    (next) => {
      setRequest((previous) => ({ text: next, nonce: previous.nonce + 1, pathname }));
    },
    [pathname],
  );

  /**
   * Turn a REQUEST into the region's contents. Two defects live here, and they are the same defect
   * seen from two sides: a live region announces its MUTATIONS, and this component was reasoning
   * about its state instead. (Code review 2026-07-19.)
   *
   * CLEAR-THEN-SET, because `setSpoken(sameString)` is a React no-op. Re-applying the SAME as-of
   * date recomputed the whole view while the region's text never changed, so the DOM never mutated
   * and the screen reader stayed silent about a recompute that genuinely happened. Emptying the
   * region and then filling it is what makes the second announcement a real mutation; the nonce is
   * what lets this effect see that a second request arrived at all.
   *
   * EXPIRES ON A PATHNAME CHANGE, because the region is `aria-atomic` and polite: whatever it holds
   * is what a screen reader re-reads on request. Left alone, it went on asserting "Findings updated
   * as of 12 May 2026" on every later surface — a true sentence about a page the person had since
   * navigated away from, which is a false one about the page they are on. The pathname is carried
   * ON the request rather than watched in a second effect so there is no ordering hazard between
   * the two: a stale request can never be spoken, because it is not for this pathname.
   *
   * Clearing is not remounting. The region element is rendered unconditionally and keeps its
   * identity throughout — AD-20's whole point, pinned by `e2e/shell.spec.ts`'s node probe.
   */
  useEffect(() => {
    const region = regionRef.current;
    if (region === null) {
      return undefined;
    }

    region.textContent = '';

    if (request.nonce === 0 || request.pathname !== pathname) {
      return undefined;
    }

    // A task, not a microtask: the empty state has to land in the DOM on its own, or the two writes
    // collapse into one and there is again no mutation for the region to announce.
    const timer = setTimeout(() => {
      region.textContent = request.text;
    }, 0);
    return () => clearTimeout(timer);
  }, [request, pathname]);

  return (
    <AnnounceContext.Provider value={announce}>
      {/* Written IMPERATIVELY, and rendered with no children so React never reconciles what is
          inside it. Two reasons, both about honesty rather than style: a live region announces DOM
          mutations, so the clear-then-set above has to be two real writes rather than two renders
          React is free to coalesce; and keeping React out of the subtree makes it structurally
          impossible for a re-render to replace the text node and re-announce something nobody
          asked for. The ELEMENT itself is rendered unconditionally and never remounted (AD-20). */}
      <div
        ref={regionRef}
        id="app-announcer"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      {children}
    </AnnounceContext.Provider>
  );
}
