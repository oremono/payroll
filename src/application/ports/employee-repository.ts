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
};
