# WebSocket Replication Agent Instructions

## Contract

This package implements the Hub/Peer connection and namespace state machines over `@nomicore/replication-protocol`, plus role-specific Cordis plugins. Read ADR 0010, ADR 0012, and `docs/protocols/instance-replication-v1.md` before changing wire behavior, authentication, service ownership, lifecycle, backpressure, or reconciliation.

## Boundaries

- Keep topology static: Hub accepts authenticated peers; Peer dials one configured Hub. Both sides remain full local replicas and may accept controlled ROOT writes.
- Bind Hub connections to the trusted identity produced before WebSocket Upgrade. `acceptTrusted` receives that identity; HELLO self-report never becomes authentication evidence.
- Preserve protocol ordering and FSM invariants: HELLO gates namespace traffic, one namespace lifecycle exists per connection, sequence and sync-round counters do not wrap, and terminal channels reopen only on a new connection.
- Route namespace ownership and raw Yjs operations through public Registry leases and ReplicationSessions. The transport layer never reaches into Runtime, Persistence, snapshots, or live Y.Doc internals.
- Keep remote apply, ACK, bootstrap, resync, epoch conflict, and protected SCHEMA/META behavior aligned with ADR 0010. ACK means sequenced live apply plus dirty registration, not flush or quorum durability.
- Keep admission bounded across handshake, ready, backpressure, and drain windows. Control/data accounting, queued bytes, early frames, timers, retries, and periodic reconciliation are observable concurrency contracts.
- Use injected transport, scheduler, randomness, and optional observer/clock seams. Observer or adapter failures must follow their documented isolation and close classifications.
- Role-specific Cordis plugins consume Instance, Clock, Timer, and Registry services. They own only listener/dialer, replication controller, connections/channels, and their published service; teardown upstream services at the composition root.
- Preserve shutdown safety and follow `docs/protocols/instance-replication-v1.md` §21 as the authority for Hub close, Runtime barriers, session/lease release, and reauthentication drain behavior.
- Export production APIs through `src/index.ts`; keep programmable adapters and test controls in the explicit testing surface.

## Verification

Run the focused tests for every changed state-machine path, including auth/HELLO, open/bootstrap/live update, reconciliation, periodic reconciliation, close/GOAWAY, epoch races, backpressure, liveness timers, observer isolation, real-transport dynamics, API types, and protocol faults. Then run the package typecheck plus root `pnpm typecheck` and `pnpm test` for any wire or lifecycle change.
