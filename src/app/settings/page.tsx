import { getSettings } from '@/application/use-cases/settings';
import { EmployeeUnavailable } from '@/ui/employee-unavailable';
import { ThresholdControl } from '@/ui/threshold-control';

import { applyThresholdAction } from './actions';
import { settingsReadDeps } from './settings-deps';

/**
 * Settings — the CAP-6 threshold surface (story 7-2). Until now this route was story 1-6's
 * placeholder ("Settings are not available yet.").
 *
 * A React Server Component reading `getSettings` IN-PROCESS (AD-21) — no `fetch` to our own origin,
 * no Route Handler. This file is the COMPOSITION ROOT for the surface: the only place allowed to
 * touch both `@/ui/*` and the Server Action, which is why `applyThresholdAction` is read here and
 * passed to `ThresholdControl` as a prop (`src/ui/**` may import `domain` + `application` only).
 *
 * ## The threshold Apply is the ONE mutation, deliberate and off the sweep
 *
 * The Settings surface never runs the outlier sweep — it reads only the persisted config and offers
 * the explicit Apply (no live slider, no live-count preview). Changing the threshold revalidates
 * Home and Settings from within the Server Action.
 *
 * ## The `unavailable` arm
 *
 * When `getSettings` answers `unavailable` this page renders ONLY the calm region — no control at
 * all. Nothing here is wrapped in `try`/`catch`; totality is the use-case's contract, not this
 * file's.
 *
 * There is no `<h1>` here: the header's page title is the document's one `<h1>`, derived from
 * `nav-items` so it cannot disagree with the sidebar.
 */

const UNAVAILABLE_HEADING = 'Settings could not be read';

export default async function SettingsPage() {
  const settings = await getSettings(settingsReadDeps());

  if (settings.kind !== 'settings') {
    return (
      <EmployeeUnavailable
        id="settings-unavailable-heading"
        heading={UNAVAILABLE_HEADING}
        statement="Settings are not readable right now, so the threshold cannot be changed. Nothing has changed."
      />
    );
  }

  return (
    <ThresholdControl current={settings.outlierThresholdPct} action={applyThresholdAction} />
  );
}
