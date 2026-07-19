/**
 * The id port (AD-10) — the only source of entity identifiers in the application.
 *
 * Ids are UUIDv7 and are generated in the SHELL, never by the database and never by Prisma: the
 * schema deliberately declares no `@default` on `employee.id` or `salary_record.id`. Two reasons,
 * both recorded on the schema itself — the id is opaque and appears in URLs, so a sequential id
 * would leak headcount; and generation belongs to a port so the pure layers stay free of
 * randomness (AD-14 bans `Math.random` repo-wide and lint bans `crypto.randomUUID` in
 * `src/domain/**` and `src/application/**`).
 *
 * The port is declared here and implemented only in `src/adapters/id.ts`.
 */
export type IdGenerator = {
  readonly next: () => string;
};
