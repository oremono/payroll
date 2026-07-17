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
  },
});
