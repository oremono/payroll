# Deferred Work

## Deferred from: code review of 1-2-ci-pipeline-and-gates (2026-07-18)

- `ui → application` "types only" is stated in the ESLint zone message (`eslint.config.mjs`, ui zone) but not mechanically enforced — value imports from `application` into `ui` pass lint. Deferred because the `ui` layer is empty until Story 1-6; when the first component lands, add a type-only carve-out (e.g., a stricter zone plus `@typescript-eslint/consistent-type-imports`, or an importKind-aware boundary rule) so the convention becomes a gate.
