import type {
  GenderDistributionCandidate,
  LevelAxisEntry,
} from '@/domain/gender-distribution';
import type { GenderGapCandidate } from '@/domain/gender-gap';
import type { Gender, ReferenceData } from '@/domain/import-row';
import type { CurrencyFormat, Money } from '@/domain/money';
import type { OverdueCandidate } from '@/domain/overdue';
import type {
  CountryRef,
  CurrencyRef,
  PayrollCandidate,
} from '@/domain/payroll-totals';
import type { PeerCandidate } from '@/domain/peer-comparison';
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

/**
 * The `(role, level, country)` triple that DEFINES a peer group (AD-16). Read off the subject's own
 * employee row — never chosen, never widened. A peer group is not a table; this key is resolved at
 * read time and the population read below derives the group from it fresh, per request (AD-2 / AD-12).
 */
export type PeerGroupKey = {
  readonly roleCode: string;
  readonly levelCode: string;
  readonly countryCode: string;
};

/**
 * The as-of peer population for one triple, plus everything the verdict needs to NAME the group.
 *
 * `candidates` is EVERY employee sharing the triple, each carrying their WHOLE append-only salary
 * history UNORDERED — the read does no as-of filtering and imposes no `ORDER BY` (AD-8). The domain
 * decides in-population membership through the ONE resolver and computes `n` as the cardinality of
 * that exact set (Law 2 / AD-16); the read never runs a `COUNT`.
 *
 * The labels and `currencyFormat` are resolved WITHOUT an `is_active` filter (AD-16): `is_active`
 * gates pickability for NEW writes, never the visibility of an existing employee's statistics or the
 * labels of a retired role/level/currency they still hold. The group is single-currency by
 * construction (country immutable, currency follows country), so ONE `currencyFormat` describes
 * every candidate's money.
 */
export type PeerPopulation = {
  readonly candidates: readonly PeerCandidate[];
  readonly roleName: string;
  readonly levelLabel: string;
  readonly countryName: string;
  readonly currencyFormat: CurrencyFormat;
};

/**
 * One candidate as the WHOLE-POPULATION read (CAP-6) hands them over: a `PeerCandidate` — the id and
 * their whole UNORDERED append-only salary history — PLUS the employee's display `name`.
 *
 * The name rides along because CAP-6's findings row names the person, and the sweep that flags them
 * is pure (it computes over `salaryHistory` and knows nothing of names). Carrying the name on the
 * candidate lets the use-case join it back onto a flagged member without a second read. The domain
 * sweep takes only the `PeerCandidate` half; the name is application/boundary data.
 */
export type OutlierCandidate = PeerCandidate & { readonly name: string };

/**
 * The as-of peer population for ONE `(role, level, country)` triple, as CAP-6's whole-population
 * read returns it — the CAP-5 `PeerPopulation` shape, but KEYED by its triple and carrying employee
 * names (see `OutlierCandidate`), because the sweep processes every group at once and each finding
 * must name both its group and its person.
 *
 * The read returns EVERY group in one call and does the grouping in-process (AD-2 / AD-16): it loads
 * all employees with their whole UNORDERED history and partitions them by the exact triple in
 * TypeScript. There is no as-of filter, no `ORDER BY`, no `COUNT`, and no `is_active` filter in the
 * SQL — the domain owns the ordering (AD-8), the as-of population and `n` (AD-16), and the labels
 * resolve for retired roles/levels/currencies the same way CAP-5's single-group read does.
 * Single-currency by construction, so ONE `currencyFormat` describes every candidate's money.
 */
export type PeerGroupPopulation = {
  readonly key: PeerGroupKey;
  readonly roleName: string;
  readonly levelLabel: string;
  readonly countryName: string;
  readonly currencyFormat: CurrencyFormat;
  readonly candidates: readonly OutlierCandidate[];
};

/**
 * The as-of peer population for ONE `(role, level, country)` triple, gender-carrying — the CAP-7
 * gender gap's read (AD-17). The exact `PeerPopulation` shape (same labels, same single
 * `currencyFormat`), but each candidate is a `GenderGapCandidate` carrying the employee's `gender`,
 * because the split by gender happens WITHIN this one group and the domain needs the gender on every
 * member. Gender is never part of peer identity — it only slices within the group (Law 3 / AD-17).
 *
 * Like `PeerPopulation` it is returned WITHOUT any as-of filtering, `ORDER BY`, `COUNT`, or grouping
 * — the domain owns the ordering (AD-8), the as-of population, and every per-gender `n` (AD-16 / Law
 * 2). Labels and currency resolve WITHOUT an `is_active` filter (AD-16).
 */
export type GenderGapPopulation = {
  readonly candidates: readonly GenderGapCandidate[];
  readonly roleName: string;
  readonly levelLabel: string;
  readonly countryName: string;
  readonly currencyFormat: CurrencyFormat;
};

/**
 * The ORG-WIDE gender-distribution population (CAP-8, AD-16 / AD-2) — the read-only sibling of
 * `findAllPeerGroups`, gender- and level-carrying. Where `findAllPeerGroups` serves the outlier
 * sweep, this serves the distribution-by-level chart: it carries the canonical level `axis` PLUS
 * every employee as a `GenderDistributionCandidate` (their `gender`, `levelCode`, and whole UNORDERED
 * salary history), so the domain can fold the as-of population into per-level gender counts.
 *
 * Two halves, and the split is the whole point (AD-2):
 *   - `levels` is the reference taxonomy, resolved is_active-INCLUSIVE and rank-ordered — the chart's
 *     axis. Enumerating every level guarantees each candidate's `levelCode` has a bucket (no orphan
 *     is silently dropped) and honours "is_active never hides existing statistics"; the domain drops
 *     only retired, empty levels.
 *   - `candidates` is EVERY employee, gender- and level-tagged, carrying their salary history
 *     UNORDERED and as-of-UNFILTERED. The domain owns the ordering (AD-8), the as-of population, and
 *     every per-level and org-wide count (AD-16 / Law 2).
 *
 * Returned WITHOUT any `where`/`orderBy`/`COUNT`/`GROUP BY` on the employee sweep — the database
 * SELECTs rows only and computes no count a user sees (AD-2). Gender is the SLICE dimension, never
 * part of a group identity: the group axis is `level` alone (Law 3).
 */
export type GenderDistributionPopulation = {
  readonly levels: readonly LevelAxisEntry[];
  readonly candidates: readonly GenderDistributionCandidate[];
};

/**
 * The ORG-WIDE payroll-totals population (CAP-9, AD-13 / AD-16 / AD-2) — a read-only org-wide read,
 * the sibling of `findGenderDistributionPopulation`, money-carrying rather than gender-carrying.
 * Where that read serves the distribution chart, this serves the payroll totals: it loads the whole
 * population at once (the Payroll Totals surface and the Home metric are org-wide, so there is no
 * subject to key off) plus the reference the domain needs to name countries and scale currencies.
 *
 * Three halves, and the split is the whole point (AD-2 / AD-13):
 *   - `candidates` is EVERY employee, carrying their `countryCode` and whole UNORDERED salary history
 *     reduced to the ordering columns + `Money`. The domain owns the ordering (AD-8), the as-of
 *     population, every per-country `n`, and every sum (AD-16 / Law 2) — the SQL runs no
 *     `where`/`orderBy`/`COUNT`/`GROUP BY`/`SUM`.
 *   - `countries` is the reference naming, resolved is_active-INCLUSIVE — an inactive country that
 *     still holds an in-population employee must name its row (AD-16); the domain decides which
 *     countries appear (those with `n > 0`).
 *   - `currencies` is every currency as a `CurrencyRef` (the ONE money formatter's `CurrencyFormat`,
 *     carrying the `minorUnitExponent` the conversion needs — JPY 0, never a hard-coded 100), each
 *     guarded by `isSupportedExponent` so only a usable format crosses the port.
 *
 * The per-country totals never convert (AD-13); only the domain's org-wide figure does, over the FX
 * rows the separate `FxRateRepository` loads. There is no `null` arm and no refusal here: an empty
 * population is a valid answer of zero, and the org-wide refusal (missing rates) is the domain's.
 */
export type PayrollTotalsPopulation = {
  readonly candidates: readonly PayrollCandidate[];
  readonly countries: readonly CountryRef[];
  readonly currencies: readonly CurrencyRef[];
};

/**
 * The ORG-WIDE overdue-for-review population (CAP-10, AD-22 / AD-16 / AD-2 / AD-8) — a read-only
 * org-wide read, the sibling of `findPayrollTotalsPopulation`, identity- and money-carrying. The
 * Overdue surface and the Home count are org-wide, so there is no subject to key off: it loads every
 * employee at once, each carrying their `employeeId`, display `name`, and whole UNORDERED salary
 * history reduced to the resolver's `SalaryRecordView` (the ordering columns + `Money`).
 *
 * The domain owns everything a user sees: the cutoff (`asOf − period`, AD-22), the as-of population
 * and membership, the strictly-earlier overdue judgement, and the ordering (AD-8 / AD-16 / Law 2).
 * The SQL SELECTs rows only — NO `where` for membership, NO `orderBy`, NO `COUNT`. There is no `null`
 * arm and no refusal: an empty `candidates` list is valid, and the domain answers it with an empty
 * overdue list (`rows: []`, the zero-state).
 */
export type OverduePopulation = {
  readonly candidates: readonly OverdueCandidate[];
};

// The port re-exports the domain shapes it speaks in, so a reader of the port sees the whole
// vocabulary in one place — as it already does for `GenderDistributionCandidate` et al. via the
// method signatures below.
export type { CountryRef, CurrencyRef, OverdueCandidate, PayrollCandidate };

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

  // ── CAP-5 (story 6-1) ──────────────────────────────────────────────────────────────────────
  // A READ-ONLY sibling on this same port — not a second one, and emphatically not a write. Peer
  // comparison is a pure consumer of the append-only series: it SELECTS the candidate set and the
  // domain computes the median, spread, distance, and `n` in process (Law 2 / AD-2). There is no
  // update or delete here and never will be (Law 5 / AD-18); it belongs on this port because it
  // reads the same `employee` + `salary_record` tables `findSalaryHistory` does, through the same
  // client, and a peer comparison is reached only THROUGH an employee — there is no peer-group
  // index to hang a separate port off.

  /**
   * The as-of peer population for a `(role, level, country)` triple: every employee sharing it, each
   * with their whole UNORDERED salary history, plus the group's display labels and `CurrencyFormat`.
   *
   * Returns the population WITHOUT any as-of filtering, `ORDER BY`, or `COUNT` — the domain owns all
   * three (AD-8 / AD-16 / Law 2). The subject is among the returned candidates by construction (it
   * shares its own triple), so the caller hands the whole set to `comparePeers`, which decides
   * in-population membership through the ONE resolver and derives `n` from the exact in-memory set.
   *
   * The labels and currency are resolved WITHOUT an `is_active` filter — a subject holding a retired
   * role, level, or currency still has statistics and a nameable group (AD-16). Filtering inactive
   * rows out here would reintroduce the population divergence the schema exists to avoid.
   *
   * `null` when the group's currency format cannot be resolved into a form the ONE money formatter
   * can use (an unknown currency, or a grouping style / exponent the domain does not support), or
   * when a reference label is missing — a data condition, surfaced as a value the use-case maps to
   * `unavailable`, never an exception across the boundary. A triple no employee matches is NOT this
   * case: it answers a population with an EMPTY `candidates` list (the domain then refuses), the same
   * "present but empty" distinction `findSalaryHistory` draws.
   */
  readonly findPeerPopulation: (group: PeerGroupKey) => Promise<PeerPopulation | null>;

  // ── CAP-6 (story 7-1) ──────────────────────────────────────────────────────────────────────
  // A READ-ONLY sibling of `findPeerPopulation` on this same port — the whole-population read the
  // outlier sweep needs. Where `findPeerPopulation` serves ONE triple (reached through a subject),
  // this serves EVERY group: Home surfaces outliers unprompted, so there is no subject to key off,
  // and the sweep must see the entire as-of population at once (AD-16). It belongs here because it
  // reads the same `employee` + `salary_record` tables through the same client; there is no
  // peer-group index to hang a separate port off, and a peer group is not a table (AD-2).

  /**
   * Every `(role, level, country)` peer group in the product, each with every employee sharing its
   * triple — id, display `name`, and whole UNORDERED salary history — plus the group's labels and
   * `CurrencyFormat`. The GROUPING is done in-process (AD-2): the adapter loads all employees and
   * partitions by the exact triple in TypeScript, so the database never groups, counts, or filters
   * a user-facing set.
   *
   * Returns the populations WITHOUT any as-of filtering, `ORDER BY`, `COUNT`, or `is_active` filter
   * — the domain sweep owns the ordering (AD-8), the as-of population and every `n` (AD-16), the
   * median/distance/flag (Law 2), and the labels resolve for retired roles/levels/currencies the
   * same way `findPeerPopulation` resolves them.
   *
   * A group whose currency format cannot be resolved into a form the ONE money formatter can use, or
   * a group missing a reference label, is a data condition — it is DROPPED from the returned list (a
   * value, never an exception), leaving the rest computable, exactly as CAP-5's read maps such a
   * condition to a value rather than throwing. Findings are computed fresh per request; nothing here
   * is materialized or cached (AD-12).
   */
  readonly findAllPeerGroups: () => Promise<readonly PeerGroupPopulation[]>;

  // ── CAP-7 (story 8-1) ────────────────────────────────────────────────────────────────────────
  // A READ-ONLY, gender-carrying SIBLING of `findPeerPopulation` on this same port — not a second
  // one, and emphatically not a write (Law 5 / AD-18). Where `findPeerPopulation` serves the peer
  // comparison, this serves the gender gap: the SAME single-triple read (reached through a subject),
  // the SAME `is_active`-inclusive labels and currency, but each candidate carries `gender` so the
  // domain can split the as-of population WITHIN the group (AD-16 / AD-17). Grouping, counts, and
  // every median stay OUT of SQL — the database SELECTs the candidate set, the domain computes the
  // per-gender medians, the gap, and the counts (Law 2 / AD-2).

  /**
   * The as-of gender-gap population for a `(role, level, country)` triple: every employee sharing it,
   * each with their whole UNORDERED salary history AND their `gender`, plus the group's display
   * labels and single `CurrencyFormat`.
   *
   * Returned WITHOUT any as-of filtering, `ORDER BY`, or `COUNT` — the domain owns all three (AD-8 /
   * AD-16 / Law 2) and splits by gender itself. Labels and currency resolve WITHOUT an `is_active`
   * filter (AD-16), exactly as `findPeerPopulation` resolves them. `null` on an unresolvable currency
   * format or a missing reference label — a data condition the use-case maps to `unavailable`, never
   * an exception; a triple no employee matches is a present-but-EMPTY `candidates` list instead.
   */
  readonly findGenderGapPopulation: (group: PeerGroupKey) => Promise<GenderGapPopulation | null>;

  // ── CAP-8 (story 9-1) ────────────────────────────────────────────────────────────────────────
  // A READ-ONLY, ORG-WIDE, gender-and-level-carrying SIBLING of `findAllPeerGroups` on this same
  // port — not a second one, and emphatically not a write (Law 5 / AD-18). Where `findAllPeerGroups`
  // serves the outlier sweep, this serves the gender-distribution-by-level chart: it loads the whole
  // population at once (Home surfaces the chart unprompted, so there is no subject to key off) plus
  // the canonical level axis, and the domain folds the as-of population into per-level gender counts.
  // Grouping and counting stay OUT of SQL — the database SELECTs the candidate set and the level
  // rows, the domain computes every per-level and org-wide count (Law 2 / AD-2). Computed fresh per
  // request; nothing is materialized or cached (AD-12).

  /**
   * The org-wide gender-distribution population: the canonical level `axis` (is_active-INCLUSIVE,
   * rank-ordered) PLUS every employee carrying their `gender`, `levelCode`, and whole UNORDERED
   * salary history — enough for the domain to fold the as-of population into per-level gender counts.
   *
   * The employee sweep is returned WITHOUT any `where`, `orderBy`, `COUNT`, or `GROUP BY` — the
   * domain owns the ordering (AD-8), the as-of population, and every count (AD-16 / Law 2 / AD-2).
   * The level axis is read WITHOUT an `is_active` filter (AD-16): an inactive level that still holds
   * an in-population employee must appear, so the domain — not the SQL — decides which levels show.
   * There is no `null` arm and no refusal: an empty population is a valid answer of zeros, computed
   * by the domain over an empty candidate set.
   */
  readonly findGenderDistributionPopulation: () => Promise<GenderDistributionPopulation>;

  // ── CAP-9 (story 10-1) ───────────────────────────────────────────────────────────────────────
  // A READ-ONLY, ORG-WIDE, money-carrying SIBLING of `findGenderDistributionPopulation` on this same
  // port — not a second one, and emphatically not a write (Law 5 / AD-18). Where that read serves the
  // gender-distribution chart, this serves the payroll totals: it loads every employee at once (the
  // surface and the Home metric are org-wide, so there is no subject to key off), plus the country
  // naming and the currency reference the domain needs. Grouping, counting, and every sum stay OUT of
  // SQL — the database SELECTs the candidate set and the reference rows, and the domain computes every
  // per-country total, headcount, and the org-wide converted total (Law 2 / AD-2 / AD-13). Computed
  // fresh per request; nothing is materialized or cached (AD-12).

  /**
   * The org-wide payroll-totals population: every employee carrying their `countryCode` and whole
   * UNORDERED salary history (with `Money`), the is_active-INCLUSIVE country naming, and every
   * currency as an `isSupportedExponent`-guarded `CurrencyRef` — enough for the domain to fold the
   * as-of population into per-country totals and one org-wide converted total.
   *
   * The employee sweep is returned WITHOUT any `where`, `orderBy`, `COUNT`, `GROUP BY`, or `SUM` —
   * the domain owns the ordering (AD-8), the as-of population, every count, and every sum (AD-16 /
   * Law 2 / AD-2). Country naming is read WITHOUT an `is_active` filter (AD-16). There is no `null`
   * arm and no refusal: an empty population is a valid answer of zero, and the org-wide refusal on
   * missing FX rates is the domain's, not this read's.
   */
  readonly findPayrollTotalsPopulation: () => Promise<PayrollTotalsPopulation>;

  // ── CAP-10 (story 11-1) ──────────────────────────────────────────────────────────────────────
  // A READ-ONLY, ORG-WIDE, identity-and-money-carrying SIBLING of `findPayrollTotalsPopulation` on
  // this same port — not a second one, and emphatically not a write (Law 5 / AD-18). Where that read
  // serves the payroll totals, this serves the overdue-for-review list: it loads every employee at
  // once (the surface and the Home count are org-wide, so there is no subject to key off), each with
  // their id, name, and whole UNORDERED salary history. The cutoff, membership, the strictly-earlier
  // overdue judgement, and the ordering are all the domain's — the SQL SELECTs rows only, with no
  // membership `where`, no `orderBy`, no `COUNT` (AD-22 / AD-16 / AD-8 / Law 2 / AD-2). Computed
  // fresh per request; nothing is materialized or cached (AD-12).

  /**
   * The org-wide overdue population: every employee carrying their `employeeId`, display `name`, and
   * whole UNORDERED salary history (as `SalaryRecordView`s with `Money`) — enough for the domain to
   * resolve the cutoff from `asOf`, the as-of population, and the strictly-earlier overdue list.
   *
   * Returned WITHOUT any membership `where`, `orderBy`, or `COUNT` — the domain owns the ordering
   * (AD-8), the as-of population, the cutoff, and the overdue judgement (AD-22 / AD-16 / Law 2). There
   * is no `null` arm and no refusal: an empty population is a valid answer of `rows: []` (the
   * zero-state), computed by the domain over an empty candidate set.
   */
  readonly findOverduePopulation: () => Promise<OverduePopulation>;
};
