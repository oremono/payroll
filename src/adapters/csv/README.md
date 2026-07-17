# `src/adapters/csv/`

CSV import parse / export render. Empty seam in Story 1-1; populated in **Epic 2** (CAP-1 Bulk
Import) and the export capability. Import is **create-only** — the file carries no identity. (AD-7)

Import rule (inherited from the adapters layer): **`application`, `domain`**.
