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
const baseURL = `http://localhost:${PORT}`;

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
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
