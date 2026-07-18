import { defineConfig, devices } from '@playwright/test';

// Accessibility gate (NFR9): an automated axe pass over the built app. This is a browser test —
// kept OUT of the Vitest unit suite (which stays DB/clock/network-free, AD-23) by living under
// e2e/ with its own runner. Story 1-2 wires it against the placeholder page so Story 1-6's real
// app shell inherits a working gate.
//
// This config is tooling (imperative shell / build plane), not domain or application code — reading
// process.env here is fine; the Law-6 clock/env ban applies only to src/domain and src/application.

// A dedicated port, NOT 3000 — otherwise a `next dev` already running locally gets reused and the
// axe pass silently judges the dev build instead of the built app.
const PORT = 3100;

// Story 1-7: when PLAYWRIGHT_BASE_URL is set, the target is an ALREADY-DEPLOYED URL (the preview
// pipeline points the smoke spec at the Vercel deployment it just created). Building and serving a
// local copy in that case would be wasted work AND wrong — the point is to prove the DEPLOYED
// instance serves. Unset, behaviour is exactly as before: build once, serve on 3100.
// Normalised to `undefined` when blank. `??` treats '' as SET while a truthiness test treats it as
// UNSET, so reading the raw variable in both places made the two disagree: an empty value produced
// baseURL '' AND still started the local webServer, i.e. a full build followed by an unparseable
// URL. Empty is reachable — it is what the preview pipeline passes if the deploy step captures no
// URL — so it is rejected loudly rather than silently coerced. (Code review 2026-07-19.)
const rawBaseURL = process.env.PLAYWRIGHT_BASE_URL;

if (rawBaseURL !== undefined && rawBaseURL.trim() === '') {
  throw new Error(
    'PLAYWRIGHT_BASE_URL is set but empty. Unset it to test a local build, or give it the deployed ' +
      'URL — an empty value almost always means an upstream step failed to capture the deploy URL.',
  );
}

const deployedBaseURL = rawBaseURL?.trim();
const baseURL = deployedBaseURL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL,
    // retries is 0, so a retry-gated trace would never fire — keep the artifact on failure.
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Build once and serve the production output — the surface the axe pass judges is the built app.
  // Omitted entirely against a deployed URL: there is nothing to start, and passing a webServer
  // whose `url` is the remote host would make Playwright wait on (and then race) a server it never
  // launched.
  ...(deployedBaseURL
    ? {}
    : {
        webServer: {
          command: `npm run build && npm run start -- --port ${PORT}`,
          url: baseURL,
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
        },
      }),
});
