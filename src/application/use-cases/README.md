# `src/application/use-cases/`

One use-case per capability (CAP-1 … CAP-11), populated by later stories. A use-case wires domain
functions to ports and returns an AD-20 receipt-carrying answer/refusal union.

Import rule: **`domain` only** (and sibling `application` modules) — never an adapter, never Next.
