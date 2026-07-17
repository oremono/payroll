import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirror the `@/*` -> `src/*` path aliases declared in tsconfig.json so imports resolve
// identically in tests and in the app. `srcDir` ends with a trailing slash so the regex
// replacement produces a clean absolute path.
const srcDir = fileURLToPath(new URL('./src/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${srcDir}$1` }],
  },
  test: {
    // Domain/application unit suite only — no DB, no clock, no network (Law: Testing / AD-23).
    include: ['tests/**/*.{test,spec}.ts'],
    environment: 'node',
    coverage: {
      // Coverage floor on the pure core (AD-23). Reports the CODE under test, not the tests.
      provider: 'v8',
      // Every file matched here is reported even with zero executed lines (Vitest 4 default when
      // `include` is set), so an untested new module fails the floor instead of silently vanishing.
      // Cover every compilable extension (tsconfig allows JS) so no file escapes the floor; the
      // layer README.md boundary docs are not code and stay out.
      include: [
        'src/domain/**/*.{ts,tsx,js,jsx,mts,cts}',
        'src/application/**/*.{ts,tsx,js,jsx,mts,cts}',
      ],
      // A colocated test file would count as never-executed source (the runner only picks up
      // tests/**) and spuriously fail the floor — exclude the pattern outright.
      exclude: ['**/*.{test,spec}.*'],
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        // Global floor across domain + application (defense in depth under the per-path floors).
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
        // The pure core is trivially coverable — hold it at 100. Mutation testing (Stryker) is the
        // real teeth; this floor stops an untested branch from ever landing.
        'src/domain/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Per-path floor so an under-tested application layer can never hide beneath the blended
        // global figure as domain LOC grows. No source files exist here yet (satisfied vacuously);
        // it bites as use-cases land in 1-3+.
        'src/application/**': {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90,
        },
      },
    },
  },
});
