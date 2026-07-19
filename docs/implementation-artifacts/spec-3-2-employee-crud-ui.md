---
title: 'Employee CRUD UI (CAP-2)'
type: 'feature'
created: '2026-07-19'
status: 'in-progress'
baseline_revision: '4da357294e83483595eadb8b5a8e08cd2af80809'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/implementation-artifacts/spec-3-1-employee-crud-backend.md'
  - '{project-root}/src/ui/README.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Story 3-1 finalized the whole CAP-2 boundary — five total use-cases and two Server
Actions — and nothing consumes it. `src/app/employees/page.tsx` is still the 1-6 placeholder
(`No employees yet. Import a spreadsheet to begin.`), so the only way a person enters the system is
still a 10,000-row CSV, `getEmployee` and `loadEmployeeFormOptions` have no caller at all, and the
`/`-focuses-search shortcut deferred out of 1-6 has still not landed.

**Approach:** Build the Employees directory as a React Server Component calling `listEmployees`
in-process (AD-21), with URL-driven search and offset pagination; add a minimal identity-only
`/employees/[id]` detail route as the row's destination and the edit form's invoking control; and
render create/edit through one hand-rolled `role="dialog"` side panel that receives the Server
Actions as props from the composition root. Every decision the surface makes lands in a
framework-free `src/ui/*.ts` module that vitest can reach; the `.tsx` stays thin and Playwright
proves the rendered behaviour.

## Boundaries & Constraints

**Always:**
- **Consume the 3-1 payload unmodified (Law 7).** Every read is rendered from its union — including
  the `unavailable` arm — and no read is wrapped in `try`/`catch`. The frontend adds nothing to the
  contract: no new use-case, no new port method, no `revalidatePath` of its own (the actions
  already invalidate `/employees` and `/employees/{id}`), no widening of any result type.
- **The directory is not an as-of surface.** `listEmployees` takes no as-of date and `totalCount` is
  the count of the `employee` table, not the AD-16 as-of population. The `asOf` param is preserved
  in every link because it is global, but no directory copy may call this number a headcount, a
  population, or anything a statistic would own.
- **`src/ui/**` may import `domain` and `application` types plus pure, total, clock-free functions
  only.** It may not import `@/adapters/*` or `@/app/*` — so the Server Actions and
  `DEFAULT_LIST_LIMIT` reach `src/ui` as props/arguments from `src/app/employees/page.tsx`, which is
  the composition root.
- **No new runtime dependency.** No shadcn/ui, no `@radix-ui`, no focus-trap library, no date
  library, no `clsx` — the ban and its reasoning are already ratified in `src/ui/README.md`. The
  dialog is hand-rolled from the `as-of-control.tsx` pattern, extended to real modal semantics.
- **Form controls sit on `surface-card`,** never on `surface-base` or `surface-tint` —
  `input-border` measures below DESIGN's 3:1 non-text floor on the latter two. The search field is
  therefore inside a card toolbar, not loose on the page background.
- No color literal and no `dark:` anywhere; tokens only. No shadows, no spinners, no toasts, no
  `role="alert"`, no red/green semantics, no error styling, no celebration, no infinite scroll.
- Gender renders as the literal `MALE` / `FEMALE` everywhere, in table cells and select options
  alike (Law 3, exact vocabulary). No `M`/`F` abbreviation, no title-casing.
- Every page renders correctly with **no database reachable** — `getDbClient()` throws when
  `DATABASE_URL_APP` is unset, the use-case answers `unavailable`, and the surface must render that
  arm and pass axe. The existing DB-free `a11y` CI job scans `/employees` and must stay green.

**Block If:**
- Rendering the directory, the detail page, or the form requires a change to any 3-1 type, a new
  repository method, or a new use-case.
- Honouring "no error color exists in this system" turns out to be incompatible with WCAG 2.2 AA
  3.3.1 error identification for the form (i.e. identification cannot be carried by text alone).
- Adding browser coverage of the directory requires changing the existing DB-free `a11y` job's
  guarantee that the app builds and serves without a database.

**Never:**
- A salary field, a Current Salary column, a peer comparison, a salary timeline, or a
  record-a-change entry point — CAP-3/CAP-4/CAP-5 own those, and the current-salary resolver
  (AD-8) does not exist yet.
- A country-edit affordance on the edit path, or a currency chooser anywhere.
- Free text for role, level, country, or gender.
- A Route Handler (exactly two exist; neither is this), or a client-side `fetch` to our own origin
  for a read.
- Rewriting `composeRejectionSentence` or any domain validator to suit the form. The form copy is a
  presentation projection built in `src/ui/`; the domain is not touched.
- Delete, deactivate, or bulk-select affordances — the port exposes no delete and the epic scopes
  none.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Directory, populated | 30 employees, no `q`, no `page` | First 25 rows ordered `(name, id)`; status line reads the **effective** limit/offset echoed by the payload; pager Next enabled, Previous disabled | No error expected |
| Directory, empty table | `totalCount: 0`, no `q` | `No employees yet. Import a spreadsheet to begin.` with a link to `/import`; no table, no pager | No error expected |
| Directory, search matches nothing | `?q=zzz`, `totalCount: 0` | A no-match statement naming the term; the search field retains `zzz`; **not** the first-run Import copy | No error expected |
| Directory, search | `?q=ana` | Case-insensitive name substring matches only; `page` resets to 1 on a new search | No error expected |
| Directory, read fails | `listEmployees` → `unavailable` | **Only** the calm region with a heading stating the directory could not be read — no toolbar, no search field, no Add-employee button, no table, no pager. The `/` shortcut therefore has no target on this state, which is correct: it binds to a surface that has a search field | Rendered as an answer, never thrown; axe-clean |
| Directory, hostile params | `?q=a&q=b`, `?page=-5`, `?page=abc`, `?page=1e9`, `q` longer than 200 chars | Repeated/non-string `q` → no filter; `page` clamps to `1..pageCount`; nothing throws and no 500 | Total parsing in `src/ui/employee-directory.ts` |
| Directory, page past the end | `?page=99` with 30 employees | Last page rendered, status line and pager agree with it | No error expected |
| Pager status line | limit clamped by the adapter below what was requested | Line reports the **echoed effective** values, never the requested ones | No error expected |
| `/` pressed on the directory | Focus on `body` or a link | Search input receives focus; default `/` insertion suppressed | No error expected |
| `/` pressed while typing | Focus in the search input, the header date input, a select, or the open dialog | Shortcut is inert — the character types normally | No error expected |
| Detail page, present | Valid id | Identity fields only (name, role code, level code, country code + currency line, gender, hire date) and an `Edit employee` button | No error expected |
| Detail page, unknown id | `getEmployee` → `not-found` | A statement that no employee has that id, with a link back to the directory. HTTP 404 via `notFound()` | Not an exception |
| Detail page, read fails | `getEmployee` → `unavailable` | Same calm unavailable region as the directory; no Edit button | Rendered as an answer |
| Add employee, options unavailable | `loadEmployeeFormOptions` → `unavailable` | No Add-employee button and no Edit button; a statement that the reference tables could not be read | Never an empty select |
| Dialog open | Add employee clicked | `role="dialog"` `aria-modal="true"` with an accessible name; focus lands on the first field; background inert; page scroll locked; named close button | No error expected |
| Dialog keyboard | Tab / Shift+Tab / Esc | Tab cycles inside the dialog both directions; Esc closes and returns focus to the invoking control; Enter submits | No error expected |
| Create, valid | Six valid fields | `{ kind: 'created' }` → dialog closes, focus returns, directory refreshes, polite announcement | No error expected |
| Create, several bad fields | Blank name AND unknown level | Every `reasons[]` entry rendered under its own field; `aria-invalid="true"` and `aria-describedby` on each; focus moves to the first rejected field; dialog stays open with values retained | Rejection is data |
| Create, adapter failure | `{ field: null }` rejection | Rendered in a form-level region (it blames no field) rather than dropped | Rejection is data |
| Edit, country | Any employee | Country is present but read-only text with the immutability reason; nothing named `countryCode` is submitted | No error expected |
| Edit, employee vanished | `{ kind: 'not-found', employeeId: '' }` | A form-level statement that the employee no longer exists; the empty id is never rendered | Not an exception |
| Edit, hire date after salary | `AP004` rejection | Its `sentence` is rendered verbatim under Hire date — it already reads correctly for a form | Rejection is data |
| Rejection copy | `sentence: 'The hire_date cell is blank.'` | Projected to form copy naming the field label, no `cell`, no `hire_date` token | Unrecognized shapes fall through to `sentence` verbatim |

</intent-contract>

## Code Map

- `src/app/employees/page.tsx` -- the 1-6 placeholder. **Replaced** by the directory RSC.
- `src/app/employees/actions.ts` -- `createEmployeeAction(input: unknown)`, `updateEmployeeAction(employeeId: unknown, input: unknown)`; already calls `revalidatePath` for both routes. **Read only.**
- `src/application/use-cases/employees.ts` -- the five use-cases and every result union; re-exports `EmployeeInput`, `EmployeeUpdateInput`, `FieldRejection`. **The finalized contract — read only.**
- `src/application/ports/employee-repository.ts` -- `EmployeeSummary` = `EmployeeDetail` (`id`, `name`, `roleCode`, `levelCode`, `countryCode`, `gender`, `hireDate: PlainDate`), `EmployeeListQuery`, `EmployeeFormOptions` (roles/levels-by-`rank`/countries-with-`currencyCode`). **Read only.**
- `src/adapters/db/employee-repository.ts` -- `DEFAULT_LIST_LIMIT = 25`, `MAX_LIST_LIMIT = 200`, `MAX_SEARCH_LENGTH = 200`. Importable by `src/app` only.
- `src/domain/employee.ts` / `employee-fields.ts` -- `EmployeeField`, `FieldRejection`, `Gender`, `EMPLOYEE_FIELD_LABELS`. **Read only.**
- `src/domain/plain-date.ts` -- `formatPlainDate` (display, **returns `null` on a bad month**), `plainDateToIso` (for `<input type="date">`).
- `src/application/as-of.ts` -- `resolveAsOf(param, today)`, total.
- `src/ui/as-of-control.tsx` -- **the dialog pattern to extend**: `FOCUSABLE_SELECTOR`, live Tab query, Esc on the root wrapper, focus return via `buttonRef`, the `new URLSearchParams(searchParams)` merge idiom.
- `src/ui/import-panel.tsx` -- table markup, pager grammar, and the thin-`.tsx` precedent.
- `src/ui/import-report.ts` + `tests/ui/import-report.test.ts` -- the framework-free decision module pattern to mirror exactly.
- `src/ui/announcer.tsx` -- `useAnnounce(): (message: string) => void`.
- `src/ui/nav-items.ts` -- `navHrefWithAsOf`; the header owns the one `<h1>`, so this surface starts at `<h2>`.
- `src/ui/README.md` -- the no-shadcn ruling, the `surface-card` form-control rule, the `ui → application` calling rule. **Amended by this story.**
- `e2e/import.spec.ts` -- spec structure + the per-state axe loop to copy.
- `e2e/accessibility.spec.ts` -- `/employees` is already in `ROUTES`; it runs **without a database**.
- `.github/workflows/ci.yml` -- the `integration` job's Postgres service, `bootstrap-roles.sql`, and `migrate deploy` steps are the template for the new browser-with-database job.
- `playwright.config.ts` -- `webServer` builds and serves on port 3100; skipped entirely when `PLAYWRIGHT_BASE_URL` is set.
- `docs/planning-artifacts/ux-designs/EXPERIENCE.md` / `DESIGN.md` -- DR13, DR17, DR18, the state patterns, the token vocabulary.

## Tasks & Acceptance

**Execution:**

- [ ] `src/ui/employee-directory.ts` -- new framework-free module owning every directory decision: `parseDirectoryParams(searchParams)` (total over `string | string[] | undefined` for `q` and `page`; repeated or non-string `q` → `null`; `q` trimmed, whitespace-only → `null`, truncated to `MAX_SEARCH_LENGTH` passed in as an argument, never imported); `directorySlice({ totalCount, limit, offset })` → `{ pageNumber, pageCount, firstIndex, lastIndex }` computed from the **echoed effective** values; `directoryStatusLine(slice)`; `directoryHref(searchParams, { q, page })` merging into `new URLSearchParams` so `asOf` and every unknown param survive, and dropping `page` when it is 1; `directoryEmptyState(totalCount, search)` distinguishing first-run from no-match. -- Every trap on this surface (clamping, param hostility, requested-vs-effective, param preservation) is arithmetic and string work; putting it here is the only way vitest can reach it, since `src/app` and `src/ui/*.tsx` are outside the coverage gate.
- [ ] `tests/ui/employee-directory.test.ts` -- test-first, covering every Matrix row that is decision-level: repeated `q`, non-string `q`, over-long `q`, `page` of `-5` / `abc` / `1e9` / past the end, a clamped limit producing a status line that reports the effective value, `asOf` surviving a page change, `page` dropping when it returns to 1, and both empty states. -- The directory's whole correctness surface, at zero browser cost.
- [ ] `src/ui/employee-form.ts` -- new framework-free module owning every form decision: `EMPLOYEE_FORM_FIELDS` (ordered `name, role, level, country, gender, hire_date`) with their labels; `formRejectionText(rejection)` — **the copy projection**; `rejectionsFor(reasons, field)` and `formLevelRejections(reasons)` (the `field: null` arm); `fieldDescribedById(field)`; `initialFormValues(detail)` using `plainDateToIso`; `currencyLineFor(options, countryCode)` returning `null` when the country is not among the active options; `composeFormAnnouncement(result)`. -- The dialog's `.tsx` must be left with no judgement to get wrong, and the copy projection needs unit tests to be defensible.
- [ ] `tests/ui/employee-form.test.ts` -- test-first. Pin the projected copy for blank name, unknown role/level/country/gender, unparseable hire date, and blank hire date; pin that the `AP004` hire-date sentence, the write-failure sentence, and any unrecognized shape pass through **verbatim**; pin the `field: null` partition; pin `currencyLineFor` returning `null` for an inactive country; pin `initialFormValues` round-tripping a `PlainDate`. -- The projection is a spec-level copy decision (see Design Notes); tests are where it becomes a contract rather than a preference.
- [ ] `src/ui/employee-table.tsx` -- new server component rendering six columns in order — Name, Role, Level, Country, Gender, Hire date — with `<caption class="sr-only">`, `<th scope="col">`, 36px rows, sticky `label-caps` header, `surface-tint` hover, `border-hairline` dividers, `font-mono` + `text-number-sm` for Country/Gender/Hire date, keyed on `employee.id`. Takes the rows and the current `asOf` param as props (it may not read the URL itself — it is a server component); Name is a `<Link>` to `/employees/{id}` built through `navHrefWithAsOf` so the global param survives the hop. `formatPlainDate` returning `null` renders the ISO form rather than an empty cell. -- The directory's data surface; codes are rendered verbatim (see Design Notes).
- [ ] `src/ui/employee-pager.tsx` -- new server component: `<nav aria-label="Employee directory pages">` with named `Previous page` / `Next page` `<Link>`s built from `directoryHref`, a mono status line, and the ends rendered as non-link disabled text rather than links to nowhere. -- URL-driven, because the page that reads it is a Server Component; the import pager's client state cannot work here.
- [ ] `src/ui/employee-search.tsx` -- new client component: a `method="get"` form to `/employees` with a labelled `type="search"` input named `q`, a submit button, and hidden inputs re-emitting every other current param **except `page`** so a new search returns to page 1. Holds the `/` shortcut: a `document` keydown listener that focuses the input, guarded to ignore modifier keys, `event.defaultPrevented`, an open dialog, and any editable target (`input`, `textarea`, `select`, `[contenteditable]`) — the header's date input is the concrete reason the guard exists. -- Submit-driven, not debounced: a Server Component read cannot be driven per keystroke without a client fetch, which AD-21 forbids.
- [ ] `src/ui/employee-form-panel.tsx` -- new client component: the trigger button plus the modal. `role="dialog"` `aria-modal="true"` `aria-labelledby` a heading; focus to the first field on open; live-queried Tab containment in both directions; Esc closes; focus returns to the trigger; a **named** close button; a backdrop that dismisses on pointerdown; `inert` on the app shell and `overflow: hidden` on the document while open. Takes `mode: 'create' | 'edit'`, `options`, an optional `employee`, and the Server Action as a prop. On rejection: render each `reasons[]` entry under its field via `formRejectionText`, set `aria-invalid` + `aria-describedby`, render `field: null` entries in a form-level region, move focus to the first rejected field, keep every entered value. On success: close, return focus, `announce(...)`. -- The one interactive surface; extends the as-of popover to the modal semantics DR18 requires and the popover deliberately lacks.
- [ ] `src/app/employees/page.tsx` -- replace the placeholder with the directory RSC: `await searchParams`, `parseDirectoryParams`, call `listEmployees` and `loadEmployeeFormOptions` with `createEmployeeRepository()` + `createUuidV7Generator()`, passing `limit: DEFAULT_LIST_LIMIT`. Renders the card toolbar (search + Add employee), then branches on `kind`: `page` → table + pager or an empty state; `unavailable` → the calm region. Passes `createEmployeeAction` into the panel as a prop. No `<h1>`. -- The composition root for this surface; the only file allowed to touch both `adapters` and `ui`.
- [ ] `src/app/employees/loading.tsx` -- skeleton hairline rows matching the table's column count and row height, no spinner (DR17). -- Cold load renders chrome immediately; a spinner is banned.
- [ ] `src/app/employees/[id]/page.tsx` -- new detail RSC: `getEmployee`, branch on `kind` — `employee` → identity fields plus the currency line and an `Edit employee` trigger wired to `updateEmployeeAction`; `not-found` → `notFound()`; `unavailable` → the calm region with no Edit button. Identity fields only. -- The row's destination and the edit form's invoking control; see Design Notes for why this route is in scope.
- [ ] `e2e/fixtures/seed-employees.ts` -- new deterministic fixture connecting as the **owner** (`DATABASE_URL`, not `DATABASE_URL_APP`) with its own `PrismaPg` adapter: truncate, insert the reference rows the fixture needs (including one inactive role and one inactive country), then 30 employees with fixed ids and names — including a duplicated name, a name matching `ana`, and one on the inactive role. -- The browser suite has no data source today; every later capability surface needs this too.
- [ ] `e2e/employees.spec.ts` -- new Playwright spec mirroring `import.spec.ts`'s shape: directory rows/order/columns, search, pager across pages and at both ends, `asOf` surviving a page change, `page` resetting on a new search, the `/` shortcut and its guard while focus is in the header date input, row → detail, detail identity fields, the create dialog (focus on open, Tab containment both ways, Esc + focus return, background inert, named close), a multi-field rejection rendering under each field with `aria-invalid`, a successful create appearing in the directory, an edit showing country read-only, and a final axe loop over each state × both color schemes. -- Rendered behaviour is Playwright's job here; there is no jsdom and none is being added.
- [ ] `e2e/accessibility.spec.ts` -- add a detail route (e.g. `/employees/00000000-0000-0000-0000-000000000000`) to the `ROUTES` list so the DB-free scan covers the new route's `unavailable` state in both color schemes, alongside the existing `/employees` entry. -- The new route must be axe-clean in the state the database-free job can actually reach; leaving it unregistered means it is never scanned there.
- [ ] `.github/workflows/ci.yml` -- add a `browser-db` job cloning the `integration` job's Postgres 18 service, `bootstrap-roles.sql`, and `migrate deploy` steps, then seeding the fixture, installing chromium, and running `npm run test:browser:db`. Leave the existing `a11y` job **untouched and database-free**. -- The DB-free property of `a11y` is documented in `src/adapters/db/client.ts` and is worth keeping; isolating the new dependency preserves it.
- [ ] `package.json` -- add `test:browser:db` running `playwright test e2e/employees.spec.ts`, and `e2e:seed` running the fixture. Do **not** add the employees spec to `test:browser`. -- A spec that needs a database must not be in the script the database-free job runs.
- [ ] `src/ui/README.md` -- record that the first capability form did **not** trigger the shadcn copy-in and why, and document the modal contract this story establishes (what the as-of popover deliberately lacks and the dialog adds). -- The README explicitly parks the copy-in decision at this story; leaving it silently unresolved re-defers it invisibly.
- [ ] `docs/implementation-artifacts/deferred-work.md` -- close the `/`-focuses-search entry, re-record the shadcn entry with this story's ruling, and record any newly-surfaced item (in particular whether the optimistic-concurrency gap on `updateEmployee` is now reachable through a real two-editor form). -- The ledger is the project's memory of what was deferred and why.

**Acceptance Criteria:**

- Given `npm run lint`, when it runs, then `import/no-restricted-paths` reports no violation — no file under `src/ui/` imports from `@/adapters/*` or `@/app/*`.
- Given `npm run lint` and `npm run test` (`tests/tokens/no-hex.test.ts`), when they run, then no color literal and no `dark:` string exists in anything this story adds.
- Given `npm run test:coverage`, when it runs, then it passes with `src/domain/**` unchanged at 100% and `src/application/**` at or above 90% — this story adds no `src/domain` or `src/application` code.
- Given `npm run typecheck`, when it runs, then it is clean, and no file this story adds declares a type that duplicates or widens one exported by `src/application/use-cases/employees.ts`.
- Given `git diff` on `src/domain/`, `src/application/`, `src/adapters/`, and `prisma/`, when read, then it is empty — this is a frontend story consuming a finalized contract.
- Given the app is built and served with **no** `DATABASE_URL_APP`, when `/employees` and `/employees/any-id` are loaded, then each renders its `unavailable` state, returns HTTP 200, and passes axe in both color schemes — and the existing `a11y` job stays green.
- Given the search input, when a screen reader inspects it, then it has a programmatically associated label, and the "Press / to focus" affordance is discoverable without relying on the placeholder alone.
- Given the create dialog is open, when the whole form is completed and submitted using only the keyboard, then an employee is created and focus is returned to the trigger — no pointer input at any step.
- Given the create dialog is open, when the axe pass runs, then it reports no violation, including that the background is inert and the close button has an accessible name.
- Given a rejected submission, when the DOM is inspected, then no rendered text contains `cell`, `hire_date`, `role_code`, `level_code`, or `country_code`, and every rejected field carries `aria-invalid="true"` with an `aria-describedby` resolving to its message.
- Given a rejected submission, when the styling is inspected, then no error color, red/green semantic, or `role="alert"` is used, and the messages sit in a `refusal-fill` region or under their field as plain ink.
- Given the directory at `?asOf=2026-01-01&q=ana&page=2`, when Next page is followed, then `asOf` and `q` survive and only `page` changes; and when a new search is submitted, then `page` is dropped while `asOf` survives.
- Given `EmployeeUpdateInput`, when the edit form is submitted, then the payload sent to `updateEmployeeAction` has no `countryCode` key at all, and the rendered form offers no control that could produce one.
- Given `npm run build`, when it runs, then it succeeds and `/employees` is not statically prerendered with baked data.
- Given `npm run test:browser` (no database), when it runs, then it is green; and given `npm run test:browser:db` with the fixture seeded, when it runs twice in a row, then it is green both times.

## Spec Change Log

## Review Triage Log

## Design Notes

**Why the detail route is in scope, and how far it goes.** `getEmployee` and the
`revalidatePath('/employees/{id}')` call were both finalized by 3-1 *for this story*; without a
detail route they are dead code and an unreachable cache invalidation. The epic assigns Epic 3 the
"row-to-detail navigation", and `reconcile-stitch.md` puts the `Edit employee` control on the detail
screen. So 3-2 builds the route as a thin identity page and nothing more: no current salary (the
AD-8 resolver does not exist), no timeline (DR9 → Epic 5), no peer comparison (Epic 6), no
record-a-change (Epic 4). Epic 5 adds content to an existing page rather than inventing one.

**The rejection copy projection — a spec-level decision, taken here.** `deferred-work.md` records
that CAP-2 form rejections reuse the CSV importer's composer verbatim, so a form user reads
`The hire_date cell is blank.` — spreadsheet vocabulary and a raw column token, in a side panel
whose field is already labelled *Hire date*. The ledger explicitly rules that a form projection is
"a spec-level decision for 3-2's copy pass, not a unilateral contract change". This spec takes that
decision: **`formRejectionText` in `src/ui/employee-form.ts` is a pure projection over the payload's
own structured fields** (`field`, `offendingValue`), never a re-validation and never an edit to the
domain composer. It recognizes exactly the shapes the composer produces and falls through to
`sentence` verbatim for everything else — which is what keeps the `AP004` hire-date sentence, the
write-failure sentence, and any future reason kind correct by default rather than silently
mistranslated. Law 7 holds: this consumes the fixed payload and adds nothing to the contract.

```ts
// Shape only. Blank → the field label; a bad value → quote it back.
export function formRejectionText(r: FieldRejection): string {
  if (r.field === null) return r.sentence;
  const label = EMPLOYEE_FORM_FIELDS[r.field].label;      // 'Hire date'
  if (r.offendingValue === null && isBlankSentence(r.sentence)) return `${label} is required.`;
  if (isUnknownCodeSentence(r.sentence)) return `${label} “${r.offendingValue}” is not in the reference tables.`;
  if (isBadDateSentence(r.sentence)) return `${label} reads “${r.offendingValue}”, which is not a date in YYYY-MM-DD form.`;
  return r.sentence;                                       // unrecognized → verbatim, never guessed
}
```

**Codes, not names, in the table and on the detail page.** The list payload carries `roleCode` /
`levelCode` / `countryCode` and no display names; the names live only on `EmployeeFormOptions`, which
**excludes inactive rows**. Joining the two would leave a blank cell for anyone sitting on a
deactivated role — a hole that appears exactly when something is already wrong. Codes are the
reference-table identity and Law 3 favours exact vocabulary, so codes render verbatim in data
positions and names appear only in the form's selects, where the options list is the source anyway.

**Search is submit-driven, and paging is URL-driven.** The directory is a Server Component calling
the use-case in-process (AD-21); a debounced search would require a client-side fetch to our own
origin, which is banned. A `method="get"` form gives shareable, bookmarkable, back-button-correct
URLs for free, and `Enter` submits it — which is the DR18 rule, not a workaround. Page size is
`DEFAULT_LIST_LIMIT` (25) imported from the adapter by the page; the mock's 50 is marked mock-local
and inventing a second constant would let the UI and the adapter disagree. Everything the pager
renders comes from the payload's **echoed effective** `limit`/`offset`, never from what was asked
for — a pager that reports the requested value after the adapter clamped it lies.

**The dialog is the as-of popover plus the four things a modal needs.** The popover already gives
the live-queried Tab containment, Esc on the root wrapper, focus return via a trigger ref, and
outside-pointerdown dismissal — all hand-rolled, and `src/ui/README.md` records the deliberate ban
on the five-dependency shadcn alternative. What it lacks, because it is a popover and not a modal,
is `aria-modal="true"`, a backdrop, background `inert`, and scroll lock. This story adds those four
and no dependency. The copy-in stays deferred, with the reason now recorded rather than re-parked.

**The `unavailable` arm needs a voice the docs never gave it.** DR17 has no such state. The nearest
ratified register is the refusal panel: a `refusal-fill` region with a heading, announced as content
and not `role="alert"`, in a calm statement register — an answer-shaped object, never an error. It
says what could not be read and nothing more; it does not apologise, retry, or offer a reload
button, and it never speculates about the cause (every error in the CAP-2 stack is currently
swallowed, so the surface genuinely does not know).

**Why the browser suite gets its own database job.** `src/adapters/db/client.ts` documents that the
`check` and `a11y` jobs build and serve with no database, which is why the Prisma client is
constructed lazily. That property is worth keeping, and the existing DB-free axe scan of
`/employees` becomes a real test of the `unavailable` arm. But a directory and a modal form proven
only in the unavailable state are not proven at all, so a separate `browser-db` job — the
`integration` job's Postgres steps plus a fixture and chromium — carries the specs that need rows.
The fixture connects as the owner because it inserts reference data, which `payroll_app` cannot.

## Verification

**Commands:**
- `npm run lint` -- expected: clean, including `import/no-restricted-paths` across the new `src/ui` files.
- `npm run typecheck` -- expected: clean.
- `npm run tokens:check` -- expected: no drift (this story authors no token).
- `npm run test` -- expected: all suites green, including the two new `tests/ui/` files and the unchanged token tests.
- `npm run test:coverage` -- expected: passes; domain and application floors unchanged.
- `npm run test:mutation` -- expected: unchanged, no surviving mutant (this story adds no `src/domain` code).
- `npm run build` -- expected: succeeds.
- `npm run test:browser` -- expected: green with **no** database, including the existing axe scan of `/employees` now rendering the `unavailable` arm.
- `npm run e2e:seed && npm run test:browser:db` -- expected: green against a disposable Postgres 18 with `DATABASE_URL` and `DATABASE_URL_APP` set; run twice to prove re-runnability.
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` -- expected: "No difference detected" (no schema change in this story).

**Manual checks (if no CLI):**
- Keyboard-only pass on `/employees`: Tab reaches skip link → sidebar → header → search → Add employee → table links → pager, in reading order; `/` focuses search from a link but not from the header date input; the dialog opens on Enter, traps Tab both directions, submits on Enter, closes on Esc, and returns focus to the trigger.
- Both color schemes on the directory, the open dialog, a rejected submission, the empty state, and the unavailable state — the first dense form and data table this project renders in dark, and the dark tokens still carry an `[ASSUMPTION]` flag that axe cannot judge.
