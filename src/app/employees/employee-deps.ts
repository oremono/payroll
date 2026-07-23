import { createEmployeeRepository } from '@/adapters/db/employee-repository';
import { createUuidV7Generator } from '@/adapters/id';
import type {
  EmployeeListQuery,
  EmployeeRepository,
  EmployeeUpdate,
  NewEmployee,
  NewEmployeeWithSalary,
  NewSalaryRecord,
} from '@/application/ports/employee-repository';
import type { EmployeeUseCaseDeps } from '@/application/use-cases/employees';
import type { PlainDate } from '@/domain/plain-date';

/**
 * The CAP-2 read surfaces' composition root: adapters constructed here and injected inward.
 *
 * ## Why the repository is built INSIDE each method rather than once, up front
 *
 * `createEmployeeRepository()` defaults its client to `getDbClient()`, which THROWS when
 * `DATABASE_URL_APP` is unset. `src/adapters/db/client.ts` documents why that is deliberate: the
 * `check` and `a11y` CI jobs build and serve the app with no database at all, which is what makes
 * the axe scan of `/employees` a real test of the `unavailable` arm.
 *
 * But a default parameter is evaluated EAGERLY, so `const repository = createEmployeeRepository()`
 * at the top of a page throws during render — before the use-case, and therefore outside the
 * `try` that turns an outage into `{ kind: 'unavailable' }`. The database-free surface would answer
 * a framework error page instead of the calm region the spec requires, and the acceptance criterion
 * "renders its `unavailable` state, returns HTTP 200" would be unmeetable.
 *
 * Deferring construction into the method body is what fixes it, and it fixes it in the RIGHT place:
 * the throw becomes a rejected promise from a port method, which is exactly the shape story 3-1's
 * reads already handle. No `try`/`catch` is added to any surface, no read is wrapped, and the
 * `unavailable` arm stays the single mechanism by which "we could not find out" reaches a reader.
 *
 * `getDbClient()` caches on `globalThis`, so calling this per read costs an object literal and a
 * cache hit, not a connection.
 *
 * The forwarding is exhaustive over the port on purpose: a `Pick<>` here would have to be widened
 * every time a surface reads one more method, and a partial implementation cast to the port would
 * be a lie that typechecks.
 */
function lazyEmployeeRepository(): EmployeeRepository {
  return {
    loadReferenceData: async () => createEmployeeRepository().loadReferenceData(),
    createEmployeesWithSalaries: async (batch: readonly NewEmployeeWithSalary[], today: PlainDate) =>
      createEmployeeRepository().createEmployeesWithSalaries(batch, today),
    createEmployee: async (employee: NewEmployee) =>
      createEmployeeRepository().createEmployee(employee),
    updateEmployee: async (employeeId: string, update: EmployeeUpdate) =>
      createEmployeeRepository().updateEmployee(employeeId, update),
    findEmployeeById: async (employeeId: string) =>
      createEmployeeRepository().findEmployeeById(employeeId),
    listEmployees: async (query: EmployeeListQuery) =>
      createEmployeeRepository().listEmployees(query),
    loadFormOptions: async () => createEmployeeRepository().loadFormOptions(),
    appendSalaryRecord: async (salaryRecord: NewSalaryRecord, today: PlainDate) =>
      createEmployeeRepository().appendSalaryRecord(salaryRecord, today),
    findSalaryHistory: async (employeeId: string) =>
      createEmployeeRepository().findSalaryHistory(employeeId),
  };
}

/**
 * The dependencies every CAP-2 read use-case takes. No `today`, no clock — a future hire date is
 * accepted, so no CAP-2 rule is date-relative and an unused clock would be a Law 6 hazard.
 *
 * The id generator is here because `EmployeeUseCaseDeps` declares it, not because a read needs one;
 * it constructs nothing and reads no environment.
 */
export function employeeReadDeps(): EmployeeUseCaseDeps {
  return { repository: lazyEmployeeRepository(), idGenerator: createUuidV7Generator() };
}
