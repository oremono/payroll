'use client';

import { useEffect, useRef } from 'react';

import type { DirectoryFacets } from '@/application/ports/employee-repository';
import {
  DIRECTORY_COUNTRY_PARAM,
  DIRECTORY_LEVEL_PARAM,
  DIRECTORY_PAGE_PARAM,
  DIRECTORY_ROLE_PARAM,
  DIRECTORY_SEARCH_PARAM,
  EMPLOYEES_HREF,
  type DirectoryCriteria,
  type DirectorySearchParams,
} from '@/ui/employee-directory';

/**
 * The directory's one narrowing form — the search field, the Role / Level / Country filters, and
 * the `/`-focuses-search shortcut the shell deferred to it.
 *
 * ## Why a plain `method="get"` form, and not a debounced input
 *
 * The directory is a Server Component calling `listEmployees` in-process (AD-21). A debounced,
 * type-as-you-go search would need a client-side fetch to our own origin on every keystroke, which
 * that decision forbids outright. A GET form gives shareable, bookmarkable, back-button-correct
 * URLs for free, and `Enter` submits it — which is the ratified dialog/interaction rule, not a
 * workaround for the constraint.
 *
 * ## One form, four controls
 *
 * The filters live INSIDE the search form rather than beside it. Two forms would mean picking a
 * level discarded the term (or the reverse), because a GET submission serializes only its own
 * form's controls — so every control that narrows the same result set has to submit together.
 *
 * Every OTHER current param is re-emitted as a hidden input so it survives the submission —
 * `asOf` above all, which is ambient provenance carried on every navigation. `page` is deliberately
 * NOT re-emitted: a narrowed result set is a NEW result set, so the old page position is
 * meaningless and the results must start at page 1. That now covers a filter change as much as a
 * new search term.
 *
 * ## The select must not misreport what is in effect
 *
 * A `<select>` whose value matches none of its options silently displays the FIRST one. So a URL
 * naming a code the facets no longer carry — a reference row deleted since the link was bookmarked
 * — would render "All roles" while that filter is live, and the reader would be looking at a
 * narrowed table with a control claiming nothing is narrowing it. `optionsFor` prepends an option
 * for the in-effect code whenever the facets do not account for it.
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

/** One reference row as a filter option. Code and label only — see `DirectoryFacets`. */
type FacetRow = { readonly code: string; readonly name: string };

/**
 * The options a filter select renders, with the in-effect code guaranteed to be among them.
 *
 * When `selected` names a code the facets do not carry, it is prepended verbatim as its own label:
 * there is no name to show for a row that is gone, and the raw code is honest where "All roles"
 * would be a lie about a filter that is demonstrably applied.
 */
function optionsFor(rows: readonly FacetRow[], selected: string | null): readonly FacetRow[] {
  if (selected === null || rows.some((row) => row.code === selected)) {
    return rows;
  }
  return [{ code: selected, name: selected }, ...rows];
}

// A FIXED width, not the browser's content-derived one. Left to size themselves, the three selects
// come out three different widths — the widest role name, the widest level name, the widest country
// name — which reads as a ragged toolbar rather than three peers narrowing the same list.
const CONTROL_WIDTH = 'w-44';

// `truncate` is what makes that width safe: an unusually long reference name ends in an ellipsis
// instead of being cut mid-letter against the arrow. Only the CLOSED control is ever abbreviated —
// the open list renders every option in full, and the table below always names the row verbatim.
const SELECT_CLASS =
  `mt-1 block truncate ${CONTROL_WIDTH} rounded border border-input-border bg-surface-card px-3 py-2 text-body-md text-ink focus:border-primary`;

/**
 * A label-shaped spacer for the toolbar children that have no label of their own — the submit
 * button, the sentence that replaces the filters when the facets cannot be read, and (from the
 * page, which composes the row) the Add-employee control beside them.
 *
 * The toolbar aligns its children by their TOPS, which is what puts every label on one line and
 * every control on the next. Anything without a label would otherwise land on the LABEL line,
 * floating above the controls it belongs beside. This reserves exactly the line box a
 * `text-label-caps` label occupies (16px, `--text-label-caps--line-height`), so the offset is
 * derived from the same type scale the labels are rather than hand-measured into a margin.
 *
 * `aria-hidden` and empty: it is a spacer, not a silent label.
 */
export function ToolbarLabelSpacer() {
  return <span aria-hidden className="block h-4" />;
}

/** One labelled filter select. A real `<label htmlFor>`, never a placeholder standing in for one. */
function FilterSelect({
  id,
  name,
  label,
  allLabel,
  rows,
  selected,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly allLabel: string;
  readonly rows: readonly FacetRow[];
  readonly selected: string | null;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-label-caps text-ink-muted uppercase">
        {label}
      </label>
      {/* `defaultValue`, not `value`: this is an uncontrolled control in a GET form, and the URL is
          the state. `''` is the "all" option. Submitting it puts `?role=` on the URL rather than
          removing the key — a native GET form serializes every named control it holds, and this
          form runs no JavaScript on submit (the search field has behaved this way since 3-2). An
          empty value is not a filter, which `normalizeFilterCode` and `parseDirectoryParams` both
          settle, so the residue is cosmetic. */}
      <select id={id} name={name} defaultValue={selected ?? ''} className={SELECT_CLASS}>
        <option value="">{allLabel}</option>
        {optionsFor(rows, selected).map((row) => (
          <option key={row.code} value={row.code}>
            {row.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function EmployeeSearch({
  searchParams,
  criteria,
  facets,
}: {
  readonly searchParams: DirectorySearchParams;
  /**
   * Everything currently narrowing the directory, echoed back so a search or filter that matched
   * nothing keeps showing what was asked for.
   */
  readonly criteria: DirectoryCriteria;
  /**
   * The filter options, or `null` when the facet read answered `unavailable`. `null` renders the
   * search field alone plus a sentence saying so — never three empty selects, which would read as
   * "there are no roles" rather than "we could not find out".
   */
  readonly facets: DirectoryFacets | null;
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

  // Every param except the five this form owns. `q` and the three filter codes are the form's own
  // controls — re-emitting them as hidden inputs too would submit each one TWICE, and the second
  // (stale) copy is the one the URL would end up carrying. `page` is dropped so a narrowed result
  // set starts at page 1.
  const owned = new Set<string>([
    DIRECTORY_SEARCH_PARAM,
    DIRECTORY_PAGE_PARAM,
    DIRECTORY_ROLE_PARAM,
    DIRECTORY_LEVEL_PARAM,
    DIRECTORY_COUNTRY_PARAM,
  ]);

  const carried: readonly (readonly [string, string])[] = Object.entries(searchParams).flatMap(
    ([key, value]) => {
      if (owned.has(key)) {
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
    // Aligned by the TOP, not the bottom. Every child is the same two-part shape — a label's line
    // box, then the control — so aligning tops puts all four labels on one line and all four
    // controls on the next. Bottom alignment cannot: the search field carries a help line UNDER it,
    // so its bottom is that sentence rather than its input, and matching bottoms therefore lifted
    // the search field a whole line above the three selects and left the button compensating with a
    // hand-measured `mb-8`. The help line now simply hangs off the end of its own column, where it
    // moves nothing.
    <form method="get" action={EMPLOYEES_HREF} className="flex flex-wrap items-start gap-3">
      {carried.map(([key, value], index) => (
        // Index is part of the key deliberately: a repeated param yields two hidden inputs sharing
        // a name, and the pair `${key}-${index}` is what makes them distinct React children.
        <input key={`${key}-${String(index)}`} type="hidden" name={key} value={value} />
      ))}

      {/* The column is what carries the width, and the field fills it. The help line beneath then
          wraps INSIDE the column instead of setting its own width — left to itself that one sentence
          is wider than the field it describes, and it would be the thing deciding how much of the
          toolbar the search occupies. */}
      <div className="w-56">
        {/* A real `<label htmlFor>`, not a placeholder and not an aria-label standing in for one. */}
        <label htmlFor="employee-search" className="block text-label-caps text-ink-muted uppercase">
          Search employees by name
        </label>
        <input
          ref={inputRef}
          id="employee-search"
          name={DIRECTORY_SEARCH_PARAM}
          type="search"
          defaultValue={criteria.q ?? ''}
          aria-describedby="employee-search-help"
          // Form controls sit on `surface-card`: `input-border` measures 3.09:1 there but 2.96:1 on
          // `surface-base` and 2.82:1 on `surface-tint`, both below DESIGN's 3:1 non-text floor.
          // That is why this field lives inside a card toolbar rather than loose on the page.
          className="mt-1 block w-full rounded border border-input-border bg-surface-card px-3 py-2 text-body-md text-ink focus:border-primary"
        />
        {/* The shortcut is discoverable in TEXT, associated with the field programmatically —
            not hidden in a placeholder, which assistive technology may never announce and which
            disappears the moment anything is typed. */}
        <p id="employee-search-help" className="mt-1 text-body-sm text-ink-muted">
          Press <span className="font-mono text-number-sm">/</span> to focus this field. Enter to
          search.
        </p>
      </div>

      {facets === null ? (
        // Said out loud rather than silently omitting the controls, and the same shape the surface
        // uses when the create form cannot read its reference tables: three empty selects would
        // tell the reader there are no roles, which is a different and false statement.
        <div className="w-80">
          <ToolbarLabelSpacer />
          <p className="mt-1 text-body-sm text-ink-muted">
            The reference tables could not be read, so the filters are unavailable. Search still
            works.
          </p>
        </div>
      ) : (
        <>
          <FilterSelect
            id="employee-filter-role"
            name={DIRECTORY_ROLE_PARAM}
            label="Role"
            allLabel="All roles"
            rows={facets.roles}
            selected={criteria.role}
          />
          <FilterSelect
            id="employee-filter-level"
            name={DIRECTORY_LEVEL_PARAM}
            label="Level"
            allLabel="All levels"
            rows={facets.levels}
            selected={criteria.level}
          />
          <FilterSelect
            id="employee-filter-country"
            name={DIRECTORY_COUNTRY_PARAM}
            label="Country"
            allLabel="All countries"
            rows={facets.countries}
            selected={criteria.country}
          />
        </>
      )}

      {/* One submit for the whole form. The label says "Apply" rather than "Search" now that it
          also applies three filters — a button that named only one of the four controls it submits
          would be a label that is true of a quarter of what it does. */}
      <div>
        <ToolbarLabelSpacer />
        <button
          type="submit"
          className="mt-1 rounded border border-input-border bg-surface-card px-3 py-2 text-body-md text-ink"
        >
          Apply
        </button>
      </div>
    </form>
  );
}
