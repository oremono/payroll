/**
 * Pure, total text helpers for the domain core.
 *
 * No I/O, no clock, no randomness — just input in, value out. (Law 2 / AD-1)
 */

/**
 * Normalize a free-text value for storage: trim surrounding whitespace, and treat a value that is
 * empty or whitespace-only as absent (`null`). Total — every string maps to a `string | null`.
 */
export function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
