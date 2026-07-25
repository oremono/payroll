---
title: 'Employee directory — role / level / country filters'
type: 'feature'
created: '2026-07-25'
status: 'done'
baseline_commit: 'ee322aa5e234f4ffd77db89943f3da93732b77f2'
review_loop_iteration: 0
context: ['{project-root}/docs/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Employees directory can only be narrowed by name. The ratified UX (`screen-02-employees.html`, action bar) specifies Role / Level / Country dropdowns beside the search field; story 3-2 shipped the search half and left the filters unbuilt, so a 10,000-row directory has no way to answer "show me IC5 engineers in India".

**Approach:** Widen `EmployeeListQuery` with three optional exact-match codes, add an `is_active`-INCLUSIVE facet read for the dropdown options, and extend the directory's one GET form with three `<select>`s. Filters AND together and AND with the name search; each is one value.

## Boundaries & Constraints

**Always:**
- One value per dimension, exact match on the reference `code`, AND-ed with each other and with `q`.
- Facet options come from a NEW `is_active`-INCLUSIVE read — never `loadFormOptions` (AD-16: `is_active` gates pickability for NEW writes, never an existing employee's visibility). An employee on a retired role stays filterable.
- Every param is hostile input: absent, repeated (`?role=a&role=b`), or blank all mean "no filter", TOTAL — never a throw, never an `unavailable` screen.
- An unknown-but-present code is a REAL filter matching nothing — never dropped to "show all".
- Filters ride the same `method="get"` form as search (AD-21). Changing one resets to page 1.
- `directoryHref` keeps every other param, `asOf` above all. Reads stay TOTAL.
- `src/ui/**` may not import `@/adapters/*`; bounds arrive as arguments from `page.tsx`.
- Test-first (Law 1): red before green, in that commit order.

**Ask First:** Any schema/migration change (none expected — this is read-only). A fourth dimension (e.g. gender), or making any dimension multi-value.

**Never:** No new Route Handler. No client fetch or debounced type-ahead. No `GROUP BY`/`COUNT` for a user-facing statistic beyond the existing paired page+total. No change to `salary_record`. No country-EDIT affordance (AD-6) — read filter only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Single filter | `?level=IC5` | Only IC5 employees; `totalCount` is the matched count | N/A |
| Combined | `?q=ana&role=ENG&country=IN` | Name contains `ana` AND role `ENG` AND country `IN` | N/A |
| Absent / blank / whitespace | no param, `?role=`, `?role=%20%20` | No filter on that dimension | N/A |
| Repeated param | `?role=ENG&role=DES` | Ambiguous ⇒ no filter on that dimension | N/A |
| Unknown code | `?role=NOPE` | Zero rows, `no-match` empty state naming the criteria | N/A |
| Retired reference row | role `REM_ENG` is `is_active: false`, 12 employees hold it | Option appears in the Role select; filtering returns those 12 | N/A |
| In-effect code absent from facets | `?role=GONE` (row deleted) | Select renders an option for the raw code so it reflects the filter actually in effect | N/A |
| Filter changed on page 3 | `?page=3` + new `level` | Submits without `page` ⇒ page 1 | N/A |
| Zero rows, no criteria at all | empty table | `first-run` state + Import link | N/A |
| Zero rows, `q` only | `?q=zzz` | Existing sentence verbatim: `No employee’s name contains “zzz”.` | N/A |
| Zero rows, any filter set | `?level=IC5` | `no-match` sentence naming every criterion in effect; no Import link | N/A |
| Facet read fails | DB down | `unavailable` — toolbar renders search only, no selects, with a stated reason | Answered as data, never thrown |
| Whole list read fails | DB down | Existing `unavailable` region, unchanged | Answered as data |

</frozen-after-approval>

## Code Map

- `src/application/ports/employee-repository.ts` -- `EmployeeListQuery` (widen); new `DirectoryFacets` type + `loadDirectoryFacets` method
- `src/adapters/db/employee-repository.ts` -- `listEmployees` `where` (l.695); new `normalizeFilterCode`; new `loadDirectoryFacets` (mirror `loadFormOptions` at l.759 MINUS the `isActive` filter)
- `src/application/use-cases/employees.ts` -- new `loadDirectoryFacets` total read + `DirectoryFacetsResult` union
- `src/ui/employee-directory.ts` -- param constants, `parseDirectoryParams`, `directoryHref` patch, `directoryEmptyState` (signature widens to criteria)
- `src/ui/employee-search.tsx` -- the directory's one GET form; gains the three selects. Hidden-input carry-over must exclude them
- `src/app/employees/page.tsx` -- composition root: loads facets, threads filters into the query and into the empty state
- `tests/ui/employee-directory.test.ts`, `tests/adapters/employee-repository.test.ts`, `tests/application/employees.test.ts`, `tests/integration/employees.test.ts`, `e2e/employees.spec.ts` -- existing suites to extend

## Tasks & Acceptance

**Execution:**
- [x] `tests/ui/employee-directory.test.ts` -- RED first: parse (absent/repeated/blank/long), `directoryHref` drop-when-null + `asOf` survival, empty-state across criteria combinations -- the only place vitest reaches these decisions
- [x] `src/ui/employee-directory.ts` -- add `role`/`level`/`country` param constants; extend `DirectoryParams` and `DirectoryHrefPatch`; re-shape `directoryEmptyState` to take the criteria set -- a filtered zero-result must not claim the install is empty
- [x] `src/application/ports/employee-repository.ts` -- widen `EmployeeListQuery`; declare `DirectoryFacets` + `loadDirectoryFacets`, documenting why it is `is_active`-INCLUSIVE where `loadFormOptions` is not
- [x] `tests/adapters/employee-repository.test.ts` -- RED first: `normalizeFilterCode` totality/bounding; a stub probe that filters reach `where` as exact equality AND-ed with the search
- [x] `src/adapters/db/employee-repository.ts` -- `normalizeFilterCode`; extend the `listEmployees` `where`; implement `loadDirectoryFacets` with the same TOTAL orderings and no `isActive` filter
- [x] `tests/application/employees.test.ts` -- RED first: `loadDirectoryFacets` is total (throw ⇒ `unavailable`); `listEmployees` passes filters through untouched
- [x] `src/application/use-cases/employees.ts` -- `loadDirectoryFacets` + `DirectoryFacetsResult`, mirroring `loadEmployeeFormOptions`
- [x] `src/ui/employee-search.tsx` -- three labelled `<select>`s in the existing form; exclude the three params from the hidden carry-over; render an option for an in-effect code missing from the facets; update the module doc
- [x] `src/app/employees/page.tsx` -- load facets, thread filters into the query and criteria into the empty state, degrade to search-only when facets are `unavailable`
- [x] `tests/integration/employees.test.ts` -- real Postgres: filters really filter and combine with search; `loadDirectoryFacets` INCLUDES an inactive row where `loadFormOptions` excludes it
- [x] `e2e/employees.spec.ts` -- browser: filter narrows the table, resets to page 1, survives `asOf`, toolbar passes axe in light and dark

**Acceptance Criteria:**
- Given 30 seeded employees, when `?role=<code>` is applied, then only that role's rows render and the pager total is the matched count.
- Given a filter and a search together, then results satisfy both and both controls echo their in-effect value.
- Given a deactivated role still held by employees, when the Role select is opened, then that role is offered and selecting it returns those employees.
- Given a filter changed while on page 3, when the form submits, then the URL carries no `page` and page 1 renders.
- Given an `asOf` in the URL, when a filter is applied or a page turned, then `asOf` is still present.
- Given the facet read answers `unavailable`, then search and table still work and the absence of filters is stated, not silently omitted.
- Given the full suite, when `npm run lint && npm run typecheck && npm test` runs, then all pass with coverage and import-boundary gates green.

## Design Notes

**Why a new read.** `loadFormOptions` is `isActive: true` by contract — it feeds a CREATE form, where a retired role must not be choosable. A filter is not a write. Reusing it would make every employee on a deactivated role unreachable, under-reporting a group with no signal — the exact population divergence AD-16 exists to prevent. Two reads, two contracts, documented against each other.

**An unknown code filters to nothing — deliberately.** `?role=NOPE` returning the whole directory is a filter that silently does not filter. Codes are opaque; the honest answer is zero rows plus a `no-match` state naming what was asked.

**Empty-state composition.** The `q`-only sentence stays VERBATIM (`e2e` asserts it). `first-run` fires only with no criteria at all. Anything else composes:

```
No employee matches role ENG, level IC5, country IN, and a name containing “ana”.
```

**The select must not misreport.** A `<select>` whose value is absent from its options displays the first one — so a URL naming a code the facets no longer carry would show "All roles" while the filter is live. The component prepends an option for the raw in-effect code instead.

## Verification

**Commands:**
- `npm run lint` -- expected: clean, import-boundary rule included
- `npm run typecheck` -- expected: clean; the widened `EmployeeListQuery` must not break existing call sites
- `npm test` -- expected: green, coverage floor on `src/domain` + `src/application` held
- `npm run test:integration` -- expected: green against real Postgres 18; run TWICE in a row (the suite's stated re-runnability criterion)
- `npm run test:browser:db` -- expected: `e2e/employees.spec.ts` green, axe clean in light and dark

## Suggested Review Order

**The decision this change rests on**

- Why the filter needs its own is_active-INCLUSIVE read, and not `loadFormOptions`.
  [`employee-repository.ts:213`](../../src/application/ports/employee-repository.ts#L213)

- The adapter honouring it — the same query as `loadFormOptions`, minus one `where`.
  [`employee-repository.ts:848`](../../src/adapters/db/employee-repository.ts#L848)

- The total read, sibling of `loadEmployeeFormOptions`; a throw is `unavailable`, never an exception.
  [`employees.ts:285`](../../src/application/use-cases/employees.ts#L285)

**Hostile input, and the one thing NOT normalized away**

- An unknown code survives on purpose — dropping it would render the whole directory.
  [`employee-repository.ts:264`](../../src/adapters/db/employee-repository.ts#L264)

- The bound the UI is handed; `src/ui` may not import it directly.
  [`employee-repository.ts:245`](../../src/adapters/db/employee-repository.ts#L245)

- Absent, repeated, and blank all mean "no filter" — total over every `searchParams` shape.
  [`employee-directory.ts:79`](../../src/ui/employee-directory.ts#L79)

**The query — one predicate, both statements**

- Filters AND with the search and with each other; the same `where` feeds rows AND count.
  [`employee-repository.ts:752`](../../src/adapters/db/employee-repository.ts#L752)

- The port's widened contract, documenting that an unknown code is a real filter.
  [`employee-repository.ts:140`](../../src/application/ports/employee-repository.ts#L140)

**Not lying to the reader**

- A filtered zero-result must not claim the install is empty; the `q`-only sentence stays verbatim.
  [`employee-directory.ts:355`](../../src/ui/employee-directory.ts#L355)

- `a` / `a and b` / `a, b, and c` — the Oxford comma only where there is a list.
  [`employee-directory.ts:395`](../../src/ui/employee-directory.ts#L395)

- A select whose value matches no option displays the first one; this prevents that lie.
  [`employee-search.tsx:93`](../../src/ui/employee-search.tsx#L93)

- Facets `unavailable` degrades to search-only with a stated reason, never three empty selects.
  [`employee-search.tsx:254`](../../src/ui/employee-search.tsx#L254)

**Wiring**

- The form's own controls must not also be hidden inputs — they would submit twice.
  [`employee-search.tsx:197`](../../src/ui/employee-search.tsx#L197)

- Both reference reads run concurrently and fail independently.
  [`page.tsx:126`](../../src/app/employees/page.tsx#L126)

- Both adapter bounds enter the UI as arguments from the composition root.
  [`page.tsx:88`](../../src/app/employees/page.tsx#L88)

**Tests**

- Proves the two reference reads DISAGREE by exactly the inactive rows — real Postgres only.
  [`employees.test.ts`](../../tests/integration/employees.test.ts)

- A retired role the create form withholds and the filter offers, end to end.
  [`employees.spec.ts`](../../e2e/employees.spec.ts)

- Empty-state composition across every criteria combination.
  [`employee-directory.test.ts`](../../tests/ui/employee-directory.test.ts)
