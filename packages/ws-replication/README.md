# `@nomicore/ws-replication`

Role-specific Cordis plugins and lower-level controllers for the Nomicore Hub/Peer WebSocket replication protocol. The normative architecture is [ADR 0010](../../docs/adr/0010-hub-peer-websocket-ydoc-replication.md); wire framing and state machines are defined by the [instance replication v1 protocol](../../docs/protocols/instance-replication-v1.md).

## Cordis plugins

Both plugins consume the host-owned `nomicoreInstance`, `clock`, `timer`, and `nomicoreRegistry` services. They read `instanceId` and `role` from `@nomicore/instance`; neither plugin creates or shuts down those upstream services.

- `createHubReplicationPlugin(config, overrides?)` requires a Hub Instance, starts the injected listener, and publishes `ctx.nomicoreHubReplication` only after the listener is ready.
- `createPeerReplicationPlugin(config, overrides?)` requires a Peer Instance, starts its dial loop without waiting for a live Hub connection, and publishes `ctx.nomicorePeerReplication` only after `replication.start()` returns successfully.
- A role mismatch fails before listener or dial side effects.

The Hub config contains listener settings and may contain static token and authorization tables. A production host may instead inject `verifyToken`, `authorize`, and `listen` adapters through overrides. `overrides.tokens` and `overrides.authorization` replace their entire configured collections when defined; `undefined` means no override. The Peer config identifies the expected Hub and may contain initial targets. A host either injects `dial` directly, or supplies static `hubUrl` + `token` together with the portable `createDial({ hubUrl, token })` factory seam; URL/token without a factory is rejected rather than accepted as dead configuration. `overrides.targets` likewise replaces the complete initial target collection when defined. Limits, timeouts, and backoff remain nested per-field merges, while unknown nested keys and malformed adapter/target shapes fail synchronously without echoing credentials.

Use `requireHubReplication(ctx)` or `requirePeerReplication(ctx)` for readiness-sensitive service discovery. Peer `ready` means the controller and dial loop have started, not that a connection or target is live; use `waitForLive(namespaceId)` when an operation requires a live namespace.

## Lifecycle and ownership

The plugins own only their network adapter, replication controller, connections/channels, and published replication service. Fiber disposal revokes that service and drains/stops replication resources. The host remains responsible for the surrounding order:

1. install Instance, Clock, Timer, Persistence, and Registry;
2. install the role-specific replication plugin;
3. stop accepting application work;
4. dispose the replication plugin before Registry shutdown;
5. shut down Registry, then Persistence, then Timer/Clock.

See the [Cordis plugin hosting guide](../../docs/integration/cordis-plugin-hosting.md) for complete composition examples.

## Lower-level controllers

`createHubReplication()` and `createPeerReplication()` remain public for trusted hosts that own their own transport integration. They consume public Registry leases and `ReplicationSession`; they do not expose live `Y.Doc`, Persistence handles, or Registry internals. Test adapters and programmable controls are exported only from `@nomicore/ws-replication/testing`.
