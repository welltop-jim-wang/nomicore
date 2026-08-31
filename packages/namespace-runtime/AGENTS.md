# Namespace Runtime Agent Instructions

## Contract

This package owns one namespace's runtime capabilities over a persistence handle. Read `README.md`, ADR 0008, ADR 0010 when replication is involved, and the relevant vocabulary in root `CONTEXT.md` before changing behavior.

## Boundaries

- Preserve one strict FIFO for P0, accepted ROOT/SCHEMA writes, remote replication applies, epoch fences, dirty notification, and the close barrier. Reads stay outside that sequencer.
- Snapshot mutable inputs at slot start, re-check writable capability before mutation, and keep ordinary validation failures zero-write. Trusted raw replication is the documented exception and uses its own role, identity, epoch, and protected-field gates.
- Persistence degradation disables ordinary writes while retaining reads. Preserve the explicitly bounded Peer apply bypass and its honest durability/status projection; internal fatal state permanently disables writes while retaining reads.
- Keep ReplicationSessions narrow and lease-owned: expose detached bytes/status only, bound asynchronous fanout, isolate observer failures, make epoch fences terminal, and close sessions synchronously when Runtime close begins.
- `close()` synchronously stops acceptance, terminates live sessions, drains accepted slots, releases exactly once, and remains idempotent. `getStatus()` stays observable throughout lifecycle transitions.
- Public APIs expose detached projections only. The owned handle, live Y.Doc, writable roots, sequencer, queues, fanout host, production constructor, and test seams remain internal.
- `@nomicore/namespace-registry` owns entries, leases, idle retention, static role enforcement, and production assembly through the restricted `@nomicore/namespace-runtime/internal` seam.

## Verification

Run sequencer, lifecycle, degradation, fatal, acceptance, replication-session/write, epoch-fence, fanout, and public-surface tests for focused changes. Run root `pnpm typecheck` and `pnpm test` before completing any runtime or replication contract change.
