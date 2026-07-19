'use client';

import { useEffect, useRef } from 'react';

import {
  DIRECTORY_PAGE_PARAM,
  DIRECTORY_SEARCH_PARAM,
  EMPLOYEES_HREF,
  type DirectorySearchParams,
} from '@/ui/employee-directory';

/**
 * The directory's search field, and the `/`-focuses-search shortcut the shell deferred to it.
 *
 * ## Why a plain `method="get"` form, and not a debounced input
 *
 * The directory is a Server Component calling `listEmployees` in-process (AD-21). A debounced,
 * type-as-you-go search would need a client-side fetch to our own origin on every keystroke, which
 * that decision forbids outright. A GET form gives shareable, bookmarkable, back-button-correct
 * URLs for free, and `Enter` submits it — which is the ratified dialog/interaction rule, not a
 * workaround for the constraint.
 *
 * Every OTHER current param is re-emitted as a hidden input so it survives the submission —
 * `asOf` above all, which is ambient provenance carried on every navigation. `page` is deliberately
 * NOT re-emitted: a new search is a new result set, so the old page position is meaningless and the
 * results must start at page 1.
 *
 * ## The `/` shortcut, and the guard that is the real work
 *
 * EXPERIENCE § Interaction Primitives specifies `/` focuses search, "active only when focus is
 * outside editable fields". `deferred-work.md` deferred it out of story 1-6 because there was no
 * search field in the product yet, and named the guard as the reason it could not be done naively:
 * the header now holds a native date input, and a global key handler without the guard would
 * swallow `/` while someone is typing into it.
 *
 * Five things make the shortcut inert, and each one is a real case:
 *   - a modifier is held — `Ctrl+/`, `Cmd+/` and `Alt+/` are the browser's or the OS's, not ours.
 *   - something already handled the event (`defaultPrevented`).
 *   - focus is in an editable target: `input`, `textarea`, `select`, or `[contenteditable]`. The
 *     as-of date input and this very field are both covered by that one rule.
 *   - a dialog is open. `[role="dialog"]` catches both the as-of popover and the employee form
 *     panel, so the shortcut cannot yank focus out from under a modal.
 *   - the field is not on the page. On the `unavailable` state there is no toolbar at all, so the
 *     listener has no target — which is correct, and is why it binds to the ref rather than
 *     querying for an input by name.
 */

const SLASH_KEY = '/';

/** Every target that is taking text. `isContentEditable` covers `[contenteditable]` at any depth. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function EmployeeSearch({
  searchParams,
  q,
}: {
  readonly searchParams: DirectorySearchParams;
  /** The term currently in effect, echoed back so a search that matched nothing keeps its text. */
  readonly q: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== SLASH_KEY) {
        return;
      }
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      if (document.querySelector('[role="dialog"]') !== null) {
        return;
      }

      const input = inputRef.current;
      if (input === null) {
        return;
      }

      // Suppress the default `/` insertion (and Firefox's quick-find) BEFORE moving focus —
      // otherwise the character lands in the field the shortcut just focused.
      event.preventDefault();
      input.focus();
      input.select();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Every param except the two this form owns. `q` is the form's own input; `page` is dropped so a
  // new search starts at page 1.
  const carried: readonly (readonly [string, string])[] = Object.entries(searchParams).flatMap(
    ([key, value]) => {
      if (key === DIRECTORY_SEARCH_PARAM || key === DIRECTORY_PAGE_PARAM) {
        return [];
      }
      if (typeof value === 'string') {
        return [[key, value] as const];
      }
      if (Array.isArray(value)) {
        return value.map((one) => [key, one] as const);
      }
      return [];
    },
  );

  return (
    <form method="get" action={EMPLOYEES_HREF} className="flex items-end gap-3">
      {carried.map(([key, value], index) => (
        // Index is part of the key deliberately: a repeated param yields two hidden inputs sharing
        // a name, and the pair `${key}-${index}` is what makes them distinct React children.
        <input key={`${key}-${String(index)}`} type="hidden" name={key} value={value} />
      ))}

      <div>
        {/* A real `<label htmlFor>`, not a placeholder and not an aria-label standing in for one. */}
        <label htmlFor="employee-search" className="block text-label-caps text-ink-muted uppercase">
          Search employees by name
        </label>
        <input
          ref={inputRef}
          id="employee-search"
          name={DIRECTORY_SEARCH_PARAM}
          type="search"
          defaultValue={q ?? ''}
          aria-describedby="employee-search-help"
          // Form controls sit on `surface-card`: `input-border` measures 3.09:1 there but 2.96:1 on
          // `surface-base` and 2.82:1 on `surface-tint`, both below DESIGN's 3:1 non-text floor.
          // That is why this field lives inside a card toolbar rather than loose on the page.
          className="mt-1 block rounded border border-input-border bg-surface-card px-3 py-2 text-body-md text-ink focus:border-primary"
        />
        {/* The shortcut is discoverable in TEXT, associated with the field programmatically —
            not hidden in a placeholder, which assistive technology may never announce and which
            disappears the moment anything is typed. */}
        <p id="employee-search-help" className="mt-1 text-body-sm text-ink-muted">
          Press <span className="font-mono text-number-sm">/</span> to focus this field. Enter to
          search.
        </p>
      </div>

      <button
        type="submit"
        className="mb-8 rounded border border-input-border bg-surface-card px-3 py-2 text-body-md text-ink"
      >
        Search
      </button>
    </form>
  );
}
