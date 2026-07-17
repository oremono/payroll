# Stitch Import Manifest — Salary Management for ACME HR (v2 regeneration)

- **Stitch project ID:** `17248335032802531831`
- **Design system:** `assets/68858245aabd424fb25258447e2eb029` ("Equilibrium Finance")
- **Device / model:** DESKTOP / GEMINI_3_1_PRO
- **Harvested:** 2026-07-17
- **Note:** The `.html` files in this folder are authoritative. The `.png` files are 512x410 Stitch canvas thumbnails, for quick visual reference only.

## Canonical local files → Stitch v2 screens (all 11 verified)

Verified checks per screen: contains `As of 16 Jul 2026`; no "snapshot"/"Snapshot"; no "CompDirect"/"Compa-ratio"; no "Peer Groups" nav item (allowed only as page title/breadcrumb on the peer-group screen and lowercase "peer groups" in the gender-insights caption).

| Local file pair | Stitch screen title | Screen ID | Checks |
|---|---|---|---|
| `screen-01-home-sweep.html/.png` | Home - The Sweep (Final v3) | `3792d8f9790446148fe4e0443cf5bc2d` | PASS |
| `screen-02-employees.html/.png` | Employees - Salary Management (Final) | `12d08097f47b43918d00d1aad2a7768f` | PASS |
| `screen-03-employee-detail.html/.png` | Employee Detail - Priya Nair (Final) | `1b37c9d16e274ce0b84894346d68ec06` | PASS |
| `screen-03b-refusal-tomas.html/.png` | Employee Detail - Tomas Berg (Refusal State v2) | `b0ad9776610d4cc195dea4984f095864` | PASS (only benign "Peer Comparison" heading) |
| `screen-04-peer-group.html/.png` | Peer Group: Software Engineer L4 - India (Final) | `e3bcd9210942413e8345635f975c8ccf` | PASS ("Peer Groups" only in title + breadcrumb, allowed) |
| `screen-05-gender-insights.html/.png` | Gender Insights — Org-wide Distribution | `b1c563a673d44a2181a054e4ae2b1903` | PASS (lowercase "peer groups" caption, allowed) |
| `screen-06-payroll-totals.html/.png` | Payroll Totals - Salary Management (Final) | `c87adafa9b304e6aa11f23143396b9c8` | PASS (only benign "Comparisons" footer caption) |
| `screen-07-overdue.html/.png` | Overdue for Review - Salary Management (Final) | `8d4fa33935f342ceb6b4a7dff66d5e29` | PASS |
| `screen-08-import.html/.png` | Bulk Import - Rejection Report (Final) | `f183e6f2708b463182c55ada59696550` | PASS |
| `screen-09-record-change.html/.png` | Record a salary change - Priya Nair (Final) | `84abd3d67c34451fb9177e2c5731b68c` | PASS |
| `screen-10-settings.html/.png` | Settings - Salary Management (Final v2) | `d4b2288de1ec4aa99aa543c97e64eff5` | PASS |

Former `screen-04-peer-group-corrected.*` and `screen-05-gender-insights-corrected.*` files were replaced by the canonical names above and deleted. `screen-03-employee-detail-A.png` / `-B.png` are older exploratory thumbnails kept for reference only.

## DELETE IN STITCH UI — superseded old screens still on canvas (1)

Audited against the live canvas on 2026-07-17: the canvas holds 12 screens — the 11 canonical screens above plus one duplicate.

| Screen title | Screen ID |
|---|---|
| Home - The Sweep (Final v3) | `359a61292b0946f38aca7419cfc3fe54` |

This is a same-titled duplicate of the canonical Home (`3792d8f9…`); it is a 3072px-wide render, whereas the canonical screen is the standard 2560px width. The 12 previously listed superseded screens (`f58ce40d…`, `d5e457cc…`, `dff16564…`, `020a207f…`, `97b15415…`, `f474bf50…`, `79c8bec0…`, `88dd87a0…`, `9d755096…`, `333ae874…`, `727222b0…`, `c1506031…`) have all been deleted, as had three earlier ids (`72eb605a…`, `811ee7bf…`, `ac70ade8…`). After deleting the duplicate above, the canvas should hold exactly the 11 canonical screens.
