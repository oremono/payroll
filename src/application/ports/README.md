# `src/application/ports/`

Port **interfaces** only — repository, clock, prng, id. Adapters in `src/adapters/**` implement
these; the domain and use-cases depend on the interface, never on the implementation. (AD-1)

Empty seam — populated by later stories (repository ports in 1-3+, clock/prng ports alongside their
adapters). Same import rule as the parent `application` layer: **`domain` only**.
