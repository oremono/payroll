import { createSettingsRepository } from '@/adapters/db/settings-repository';
import type { SettingsRepository } from '@/application/ports/settings-repository';
import type { SettingsDeps, SettingsWriteDeps } from '@/application/use-cases/settings';

/**
 * The settings read's composition root: the adapter constructed here and injected inward.
 *
 * ## Why the repository is built INSIDE the method rather than once, up front
 *
 * `createSettingsRepository()` defaults its client to `getDbClient()`, which THROWS when
 * `DATABASE_URL_APP` is unset. The `check` and `a11y` CI jobs build and serve the app with no
 * database at all (see `src/adapters/db/client.ts`), and a default parameter is evaluated EAGERLY —
 * so `const repository = createSettingsRepository()` at the top of a page would throw during render,
 * BEFORE the use-case and therefore outside the `try` that turns an outage into
 * `{ kind: 'unavailable' }`.
 *
 * Deferring construction into the method body fixes it in the right place: the throw becomes a
 * rejected promise from a port method, exactly the shape `getSettings` already catches. No surface
 * gains a `try`/`catch`, and `unavailable` stays the single mechanism by which "we could not find
 * out" reaches a reader. `getDbClient()` caches on `globalThis`, so this costs an object literal and
 * a cache hit, not a connection. (Mirrors `lazyEmployeeRepository`.)
 */
function lazySettingsRepository(): SettingsRepository {
  return {
    readSettings: async () => createSettingsRepository().readSettings(),
    updateOutlierThresholdPct: async (pct: number) =>
      createSettingsRepository().updateOutlierThresholdPct(pct),
  };
}

/** The dependencies the settings read use-case takes — just the settings port. */
export function settingsReadDeps(): SettingsDeps {
  return { repository: lazySettingsRepository() };
}

/**
 * The dependencies the settings WRITE use-case takes — the same lazy repository, so the Server
 * Action's composition root defers `createSettingsRepository()` for the same reason the read does:
 * a DB-free surface yields a rejected promise the use-case turns into `unavailable`, never a build
 * throw. The threshold Apply is CAP-6's one mutation (story 7-2).
 */
export function settingsWriteDeps(): SettingsWriteDeps {
  return { repository: lazySettingsRepository() };
}
