# Namespace Runtime Agent Instructions

## Contract

This package owns one namespace's runtime capabilities over a persistence handle. Read `README.md`, ADR 0008, and the relevant vocabulary in root `CONTEXT.md` before changing behavior.

## Boundaries

- Preserve one strict FIFO for P0, every accepted ROOT/SCHEMA write, dirty notification, and the close barrier. Reads stay outside that sequencer.
- Snapshot mutable inputs at slot start, re-check writable capability before mutation, and keep validation failures zero-write.
- Persistence degradation disables new writes while retaining reads; internal fatal state permanently disables writes while retaining reads.
- `close()` synchronously stops acceptance, drains accepted work, releases exactly once, and remains idempotent. `getStatus()` stays observable throughout lifecycle transitions.
- Public APIs expose detached projections only. The owned handle, live Y.Doc, writable roots, sequencer, queue state, production assembly seam, and test seams remain internal.
- NamespaceRegistry ownership, leases, and idle retention belong to the future registry/server layer rather than this package.

## Verification

Run sequencer, lifecycle, degradation, fatal, acceptance, and public-surface tests for focused changes. Run root `pnpm typecheck` and `pnpm test` before completing any runtime contract change.
