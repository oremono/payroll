import { describe, expect, it } from 'vitest';

import { blankToNull } from '@/domain/text';

// Test-first (Law 1 / AD-23): this spec lands before `src/domain/text.ts` exists. It asserts real
// branching behaviour of a pure, total normalizer — not a mirror of a constant — and imports the
// domain module through the `@/domain/*` alias, proving the runner, the aliases, and the domain
// layer all resolve.
describe('blankToNull', () => {
  it('trims surrounding whitespace from a non-blank value', () => {
    expect(blankToNull('  Engineering  ')).toBe('Engineering');
  });

  it('returns a non-blank value unchanged when it has no surrounding whitespace', () => {
    expect(blankToNull('Sales')).toBe('Sales');
  });

  it('collapses a whitespace-only string to null (the other branch)', () => {
    expect(blankToNull('   ')).toBeNull();
  });

  it('collapses an empty string to null', () => {
    expect(blankToNull('')).toBeNull();
  });
});
