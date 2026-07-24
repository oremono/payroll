// Runtime resolver for `npm run seed`: teaches Node's ESM loader the two conventions the rest of
// the codebase is written against but plain Node does not know — the `@/*` -> `src/*` path alias
// (tsconfig paths) and extensionless relative imports (`./clock` -> `./clock.ts`). TypeScript itself
// is handled by Node's built-in type stripping (`--experimental-strip-types`). This is the seed's
// composition-root runtime only; it changes nothing about how the app or the test suites resolve.

const srcDir = new URL('../src/', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier;
  if (spec === '@/' || spec.startsWith('@/')) {
    spec = srcDir + spec.slice(2);
  }
  try {
    return await nextResolve(spec, context);
  } catch (error) {
    if (!/\.[cm]?[jt]s$/.test(spec)) {
      try {
        return await nextResolve(spec + '.ts', context);
      } catch {
        try {
          return await nextResolve(spec + '/index.ts', context);
        } catch {
          // Name the ORIGINAL specifier (not the last `/index.ts` attempt) so a genuine bad seed-time
          // import is debuggable rather than surfacing as an opaque `.../index.ts not found`.
          throw new Error(
            `seed resolver could not resolve import "${specifier}" ` +
              `(tried "${spec}", "${spec}.ts", and "${spec}/index.ts")`,
          );
        }
      }
    }
    throw error;
  }
}
