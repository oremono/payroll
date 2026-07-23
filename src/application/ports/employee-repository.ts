import type { Gender, ReferenceData } from '@/domain/import-row';
import type { CurrencyFormat, Money } from '@/domain/money';
import type { PlainDate } from '@/domain/plain-date';
import type { SalaryRecordView } from '@/domain/salary-timeline';

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
  /**
   * Every ACTIVE currency, as the one money formatter and its inverse need it (story 4-2).
   *
   * The country above carries only a CODE, and a code cannot be converted with: the CAP-3 form
   * takes an amount in major units and turns it into minor units with the currency's own
   * `minorUnitExponent`, which is 0 for JPY and never a hard-coded 100 (Law 4 / AD-4). This is the
   * first time that number crosses the boundary, and it crosses it as `CurrencyFormat` — the exact
   * shape `formatMoney` and `parseMajorAmount` take — rather than as a second money vocabulary.
   *
   * Keyed by nothing: it is a LIST, ordered totally by `code`, because a `Map` does not survive the
   * Server-Component boundary as data and the caller resolves one row at a time anyway.
   */
  readonly currencies: readonly CurrencyFormat[];
};

/**
 * What an edit did. `hire-date-after-salary` is the database's verdict (SQLSTATE `AP004`) reaching
 * the caller as DATA rather than as an exception — see `updateEmployee`.
 */
export type UpdateEmployeeOutcome =
  | { readonly kind: 'updated' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'hire-date-after-salary' };

/**
 * One salary record, appended to an employee who already exists (CAP-3, story 4-1).
 *
 * Deliberately CARRIES NO COUNTRY. The country is the EMPLOYEE's, immutable since create (AD-6), and
 * the adapter reads it inside its own transaction and re-resolves the currency from it there. A
 * country travelling on this input would be a second answer to a question the employee row already
 * answers, and the two could disagree.
 */
export type NewSalaryRecord = {
  /** From the id port (AD-10) — generated in the shell, never by the database. */
  readonly salaryRecordId: string;
  readonly employeeId: string;
  /**
   * AD-4: never bare. The `currency` carried here is what the domain validated against the
   * country's — the implementation RE-RESOLVES it from the country inside the transaction anyway,
   * because a reference table can change between the read and the write.
   */
  readonly salary: Money;
  readonly effectiveFrom: PlainDate;
};

/**
 * What an append did.
 *
 * `effective-before-hire` is the AD-16 trigger's verdict (SQLSTATE `AP004`) reaching the caller as
 * DATA rather than as an exception, exactly as `hire-date-after-salary` does on the edit path.
 *
 * It carries the `hireDate` the DATABASE enforced against, and that is not decoration. The domain
 * judges this same rule against the hire date it READ, and it only lets an input through when that
 * date permits it — so this arm firing is PROOF that the stored hire date is a different one. A
 * caller composing a sentence from the date it read would quote a hire date the effective date is
 * demonstrably not earlier than, in every single case the arm appears. The truth has to travel back
 * from the transaction that lost the race, so it does.
 *
 * With one honest limit: the adapter recovers that date by RE-READING the row after the rollback,
 * because the trigger reports a SQLSTATE and not a value. A hire date edited a second time in that
 * window is quoted as it stands at the re-read, not as the trigger judged it — so this arm reports
 * the CURRENT stored hire date, which is the date the user must act on, rather than a snapshot of
 * the one that lost. It narrows the wrong sentence to a double-edit race; it does not eliminate it.
 *
 * There is no `rejected` arm and no future-date arm: a future-dated record is an INVARIANT
 * violation by the time it reaches the funnel (the domain judged it and reported on it), so the
 * adapter throws, as every other funnel breach here does.
 */
export type AppendSalaryRecordOutcome =
  | { readonly kind: 'appended' }
  | { readonly kind: 'not-found' }
  | {
      readonly kind: 'effective-before-hire';
      /** The hire date the trigger judged against — read back from the database, never the caller's. */
      readonly hireDate: PlainDate;
    };

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

  // ── CAP-3 (story 4-1) ──────────────────────────────────────────────────────────────────────
  // A SIBLING of the batch funnel above, on this same port and this same adapter — not a second
  // write path. It shares the funnel's per-record guard verbatim (in-transaction currency
  // re-resolution against the ACTIVE country, and the no-future-dating check), because a divergence
  // between the two is exactly the defect AD-6's single funnel exists to prevent.
  //
  // APPEND ONLY, and there is no matching update or delete anywhere on this port (Law 5 / AD-18).
  // That is not merely convention here: `payroll_app` has UPDATE and DELETE revoked on
  // `salary_record` AND a BEFORE UPDATE OR DELETE trigger raising `AP001` behind the revoke, so a
  // port method offering either would be a promise the database refuses to keep. Appending a new
  // record dated today is the only correction mechanism there is.

  /**
   * Append ONE salary record to an existing employee.
   *
   * Returns an OUTCOME rather than throwing for the two things a caller must act on. `not-found` is
   * the normal answer to a stale id — including an id that is not a UUID at all, since it arrives
   * from a URL segment a user can hand-edit. `effective-before-hire` is the AD-16 trigger's `AP004`
   * verdict mapped to data, carrying the hire date the database enforced against — see
   * `AppendSalaryRecordOutcome` for why that date cannot be the caller's. Every OTHER database
   * error still throws: those are invariant violations, not input, and the Server Action boundary
   * answers them with a payload.
   *
   * `today` is passed in rather than read: no application code may touch a clock (Law 6).
   */
  readonly appendSalaryRecord: (
    record: NewSalaryRecord,
    today: PlainDate,
  ) => Promise<AppendSalaryRecordOutcome>;

  // ── CAP-4 (story 5-1) ──────────────────────────────────────────────────────────────────────
  // The FIRST salary READ on this port, and it is READ-ONLY: there is no update and no delete over
  // `salary_record` anywhere here, and there never will be (Law 5 / AD-18). It reads the whole
  // append-only series and hands it to the domain UNORDERED — the ordering is AD-8's one comparison
  // in `salary-timeline.ts`, never a second `ORDER BY` in the adapter.

  /**
   * Every salary record for one employee, in NO GUARANTEED ORDER, or `null` when no such employee
   * exists — the same read-null idiom `findEmployeeById` uses, and for the same reasons.
   *
   * `null` distinguishes "there is no such employee" from "the employee exists with an empty
   * history": a present employee with zero salary records answers `[]`, not `null`. That distinction
   * is what lets the use-case answer `not-found` versus a `timeline` with no rows, and a single
   * nested read makes it without a second query. A malformed / non-UUID id answers `null` rather
   * than throwing, because it arrives from a URL segment a user can hand-edit (AD-8 / AD-18).
   *
   * Returns `SalaryRecordView`s — money as domain `Money` and `seq` as the native `bigint` the ONE
   * resolver orders by. The currency is each record's OWN, read straight off the row and never
   * re-resolved from the employee's country at read time (AD-6). The use-case is what encodes money
   * to `BoundaryMoney` and drops `seq` before anything crosses to a surface.
   */
  readonly findSalaryHistory: (
    employeeId: string,
  ) => Promise<readonly SalaryRecordView[] | null>;
};
