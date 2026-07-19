import type { Gender, ReferenceData } from '@/domain/import-row';
import type { Money } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';

/**
 * The first repository port, and with it THE WRITE FUNNEL (AD-6 / AD-18).
 *
 * Every write of an employee and their salary passes through `createEmployeesWithSalaries` — this
 * import, the record-change form in Epic 3, and Epic 12's seed alike. Import does not get a
 * privileged path and neither does the seed; the seed is specified as a client of this same
 * use-case. That is what makes "currency is derived from country" and "no future-dating"
 * enforceable claims rather than things each caller remembers to do.
 *
 * There is deliberately NO update and NO delete method for salary records (Law 5 / AD-18):
 * `UPDATE`/`DELETE` are revoked on `salary_record` at the database role AND blocked by a trigger,
 * and a port that offered them would be a promise the database refuses to keep. Appending a new
 * record dated today is the only correction mechanism.
 */

/** One employee and their opening salary record, ready to be written together. */
export type NewEmployeeWithSalary = {
  /** From the id port (AD-10) — generated in the shell, never by the database. */
  readonly employeeId: string;
  readonly salaryRecordId: string;
  readonly name: string;
  readonly roleCode: string;
  readonly levelCode: string;
  /** Set at create and IMMUTABLE thereafter (AD-6) — no method here ever updates it. */
  readonly countryCode: string;
  readonly gender: Gender;
  readonly hireDate: PlainDate;
  /**
   * AD-4: never bare. The `currency` carried here is what the domain validated against the
   * country's — the implementation RE-RESOLVES it from the country inside the transaction anyway,
   * because a reference table can change between the read and the write.
   */
  readonly salary: Money;
  readonly effectiveFrom: PlainDate;
};

/**
 * One employee, created ALONE — with no salary record. (UX-DR13 / AD-16)
 *
 * There is deliberately no salary parameter here and there never will be one: adding it would fork
 * the write funnel this port exists to keep singular. The funnel's invariants
 * (currency-from-country, no future-dating) are properties of a SALARY RECORD, and this method
 * writes none — CAP-3 owns the first salary. An employee created here is legitimately outside every
 * as-of population until then, which is exactly what AD-16 specifies and not a defect to be
 * repaired by requiring a salary.
 */
export type NewEmployee = {
  /** From the id port (AD-10) — generated in the shell, never by the database. */
  readonly employeeId: string;
  readonly name: string;
  readonly roleCode: string;
  readonly levelCode: string;
  /** Set at create and IMMUTABLE thereafter (AD-6). See `EmployeeUpdate`. */
  readonly countryCode: string;
  readonly gender: Gender;
  readonly hireDate: PlainDate;
};

/**
 * The columns an edit may write. `countryCode` is ABSENT — not optional, absent (AD-6).
 *
 * A call that tries to set it must fail to TYPECHECK, and the database backs the same invariant up
 * independently: `payroll_app` holds column-level UPDATE on `name`, `role_code`, `level_code`,
 * `gender`, `hire_date`, and `updated_at` only, so even a hand-written statement is refused with
 * "permission denied for column country_code".
 */
export type EmployeeUpdate = {
  readonly name: string;
  readonly roleCode: string;
  readonly levelCode: string;
  readonly gender: Gender;
  readonly hireDate: PlainDate;
};

/**
 * One employee as a read answers them. IDENTITY FIELDS ONLY — no current salary.
 *
 * The current-salary resolver (AD-8) does not exist yet and belongs to CAP-3/CAP-4. Inventing a
 * second one here to decorate a detail payload is exactly the "never write a second resolver" the
 * Laws name; a payload that carries no salary cannot disagree with the one that eventually does.
 */
export type EmployeeDetail = {
  readonly id: string;
  readonly name: string;
  readonly roleCode: string;
  readonly levelCode: string;
  readonly countryCode: string;
  readonly gender: Gender;
  readonly hireDate: PlainDate;
};

/** A directory row. Same fields as the detail — the list adds nothing and hides nothing. */
export type EmployeeSummary = EmployeeDetail;

/**
 * One page of the directory. OFFSET pagination (data tables paginate; infinite scroll is banned),
 * with a case-insensitive substring search over the NAME only — names are searchable but never
 * identifying.
 *
 * Every field here is HOSTILE INPUT by default: `limit`, `offset`, and `search` arrive from a URL a
 * user can hand-edit. The adapter clamps and escapes them rather than trusting them; see
 * `listEmployees`.
 */
export type EmployeeListQuery = {
  /**
   * `null` means no search at all — and so does an EMPTY or whitespace-only term. A search box that
   * a reader has cleared sends `''`, and a reader who brushed the space bar sends `'   '`; both
   * mean "I am not searching", so both take the same path as `null` rather than becoming a filter
   * that matches everything by accident (`''`) or almost nothing (`'   '`). Surrounding whitespace
   * is trimmed off a term that does survive.
   */
  readonly search: string | null;
  readonly offset: number;
  readonly limit: number;
};

/**
 * A page plus the total the search matched, so a pager can say "of N" without a second call.
 * `totalCount` counts the TABLE, not an as-of population — this is a directory, not a statistic.
 *
 * `limit` and `offset` are the EFFECTIVE values the adapter actually used, after clamping. A pager
 * that renders the requested value when the adapter used another one lies to its reader.
 */
export type EmployeeListPage = {
  readonly employees: readonly EmployeeSummary[];
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
};

/**
 * The reference values a form may offer. Only `is_active` rows appear: `is_active` gates
 * PICKABILITY, so a retired role must not be choosable for a NEW write even though it still
 * resolves for the employees who already hold it.
 */
export type EmployeeFormOptions = {
  readonly roles: readonly { readonly code: string; readonly name: string }[];
  /** Ordered by `rank`, which is UNIQUE — so the order is total and cannot reshuffle on a tie. */
  readonly levels: readonly {
    readonly code: string;
    readonly name: string;
    readonly rank: number;
  }[];
  /** Each country carries its currency code: currency FOLLOWS from country, never chosen (AD-6). */
  readonly countries: readonly {
    readonly code: string;
    readonly name: string;
    readonly currencyCode: string;
  }[];
};

/**
 * What an edit did. `hire-date-after-salary` is the database's verdict (SQLSTATE `AP004`) reaching
 * the caller as DATA rather than as an exception — see `updateEmployee`.
 */
export type UpdateEmployeeOutcome =
  | { readonly kind: 'updated' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'hire-date-after-salary' };

export type EmployeeRepository = {
  /**
   * The reference codes a row is judged against, in the exact shape the domain validator wants.
   * INACTIVE rows are excluded: `is_active` gates PICKABILITY, so an inactive role may not be
   * chosen for a NEW write even though it still resolves for employees who already hold it.
   */
  readonly loadReferenceData: () => Promise<ReferenceData>;

  /**
   * Append a whole batch of employees and their opening salary records in ONE transaction.
   *
   * Rejected rows are filtered out by the use-case BEFORE this is called, so everything handed
   * here is expected to be valid — which is why this method is documented to THROW on an invariant
   * violation rather than returning a refusal. Adapters may throw; the Route Handler catches and
   * turns it into a whole-file refusal, because an unguarded call site here is a designed-in 500.
   *
   * `today` is passed in rather than read: no application code may touch a clock (Law 6).
   */
  readonly createEmployeesWithSalaries: (
    batch: readonly NewEmployeeWithSalary[],
    today: PlainDate,
  ) => Promise<void>;

  // ── CAP-2 (story 3-1) ──────────────────────────────────────────────────────────────────────
  // Sibling methods on THIS port, not a second one. There is deliberately no update or delete over
  // `salary_record` here and no delete over `employee` — but the two rest on DIFFERENT enforcement,
  // and conflating them would be a comment claiming a guarantee the database does not give.
  //
  // `salary_record`: the database revokes UPDATE and DELETE outright (Law 5 / AD-18), so offering
  // either would be a promise the database refuses to keep.
  //
  // `employee` DELETE: `payroll_app` still HOLDS it — granted in `20260718163326` and, unlike
  // `salary_record`, never revoked (recorded in `deferred-work.md`). So the only thing standing
  // between this product and a deleted employee is that no method here reaches it. That is a weaker
  // guarantee than the sentence above, and saying so is the point: a reader who believed the
  // database was the backstop would add a delete method thinking the revoke would catch a mistake.

  /**
   * Create ONE employee and no salary record (CAP-2). A sibling of the batch method above on the
   * same port and the same adapter — not a second funnel, and never given a salary parameter.
   *
   * Re-resolves role/level/country ACTIVITY inside its transaction: reference data is read outside
   * the transaction, so a role can be deactivated between judgement and write, and the FKs target
   * `code` — they check existence, not activity. (The batch funnel re-resolves the COUNTRY only,
   * because the invariant it is protecting is the currency AD-6 writes onto a salary record. This
   * method writes no salary record, so it has a different thing to protect and checks all three.)
   *
   * Throws on an invariant violation, like every write here; the Server Action boundary catches and
   * answers with a payload, because an unguarded call site is a designed-in 500.
   */
  readonly createEmployee: (employee: NewEmployee) => Promise<void>;

  /**
   * Edit the granted columns of one employee.
   *
   * Re-resolves role and level ACTIVITY inside its transaction, for the reason `createEmployee`
   * does — an edit must not assign a code retired between judgement and write. There is no country
   * to re-resolve: an edit cannot change it (AD-6).
   *
   * Returns an OUTCOME rather than throwing for the two things a caller must act on. `not-found` is
   * a normal answer to a stale id — including an id that is not a UUID at all, since it arrives
   * from a URL segment a user can hand-edit. `hire-date-after-salary` is the AD-16 trigger's
   * verdict: it is user input this layer cannot judge without reading the salary history, so the
   * database judges it and its `AP004` is mapped to data here. Every OTHER database error still
   * throws — those are invariant violations, not input.
   */
  readonly updateEmployee: (
    employeeId: string,
    update: EmployeeUpdate,
  ) => Promise<UpdateEmployeeOutcome>;

  /**
   * One employee by opaque id, or `null`. A name is never an identity (two people may share one).
   * A malformed id answers `null` rather than throwing, for the same reason `updateEmployee`
   * answers `not-found`.
   */
  readonly findEmployeeById: (employeeId: string) => Promise<EmployeeDetail | null>;

  /**
   * One offset page of the directory, ordered by `(name, id)`.
   *
   * The tie-break is not decoration: name alone ties on duplicates, and offset pagination over a
   * non-total order silently drops and repeats rows between pages. The page and its `totalCount`
   * are read in ONE transaction, so a pager cannot show a total that disagrees with the rows beside
   * it.
   */
  readonly listEmployees: (query: EmployeeListQuery) => Promise<EmployeeListPage>;

  /** The pickable reference values for the create/edit form. Active rows only. */
  readonly loadFormOptions: () => Promise<EmployeeFormOptions>;
};
