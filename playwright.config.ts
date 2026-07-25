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
  // Two retries in CI, none locally. This is NOT a blanket tolerance for flaky assertions — it is
  // scoped cover for one diagnosed, third-party failure mode in the App Router's client navigation.
  //
  // Evidence, from the trace uploaded by the `browser-db` job of run 30153631063 (the pager test's
  // `Previous page` click):
  //   - the click landed on the real `<a href="/employees">` and its default WAS prevented, so the
  //     client router took the navigation (no document request follows);
  //   - the router issued the navigation's RSC fetch 2ms later, and it returned 200 with a
  //     COMPLETE payload — 39 flight rows, no gaps, containing the expected `Page 1 of 2`;
  //   - and then nothing happened for the full 5s: no screencast frame, so not one pixel changed;
  //     `employees/loading.tsx` never appeared, so the transition never even committed its loading
  //     boundary; and the URL stayed `/employees?page=2`.
  // A payload that arrives and is never rendered is not something this repo's code can influence:
  // the stall is upstream of the app, in the router's own transition. It is the long-running
  // App Router "soft navigation stops working" bug (vercel/next.js#57565), reported through 14 and
  // 15 and still open on 16 — and 16.2.11, the only newer patch, is security-only.
  //
  // Retries keep the gate honest rather than blind: Playwright reports a passed-on-retry test as
  // FLAKY (a distinct, visible outcome, not a silent pass), so a recurrence is still on the record,
  // while a stall that reproduces three times over is a real failure and still fails the build.
  // Revisit when a Next release fixes the stall — this should go back to 0.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL,
    // Kept on failure rather than gated behind a retry: this is the artifact that diagnosed the
    // stall above, and the CI job uploads it. `retain-on-failure` still writes it for the LAST
    // attempt, which is the one that actually failed the build.
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
