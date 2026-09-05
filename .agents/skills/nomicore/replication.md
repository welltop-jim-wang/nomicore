# Hub/Peer replication branch

Nomicore calls the roles **Hub** and **Peer**. Map “主” to Hub and “从/副本” to Peer while preserving the actual multi-writer contract: both hold full local replicas and may accept controlled ROOT writes; Hub alone controls SCHEMA and replication identity.

Read these authorities before implementation:

1. `$NOMICORE_ROOT/docs/adr/0010-hub-peer-websocket-ydoc-replication.md` — replication architecture;
2. `$NOMICORE_ROOT/docs/adr/0012-instance-identity-and-websocket-plugin-ownership.md` — identity, plugin boundaries, and lifecycle ownership;
3. `$NOMICORE_ROOT/docs/protocols/instance-replication-v1.md` — normative wire contract;
4. `$NOMICORE_ROOT/docs/integration/cordis-plugin-hosting.md` — embedded Cordis composition;
5. `$NOMICORE_ROOT/docs/integration/hub-peer-deployment.md` — standalone process configuration and operations.

## Choose the integration level

- Use the released `@nomicore/yjs-server` package from npm when the deployment needs a standalone Hub/Peer process. It contains compiled `dist` JavaScript/declarations and the `nomicore-yjs-server` CLI. Follow the deployment guide's strict JSON config and NDJSON operations; the package is an application composition root, not a self-contained Cordis plugin.
- When embedding replication into an existing Cordis host, compose Instance → Clock → Timer → Persistence → Registry, then install `createHubReplicationPlugin()` or `createPeerReplicationPlugin()` from `@nomicore/ws-replication`. A Node.js Hub supplies `createNodeHubListenAdapter()` and a Node.js Peer supplies `createNodePeerDial()` from `@nomicore/yjs-server`; other runtimes implement the corresponding interfaces. Never use generic `createWebSocketAdapter()` for a Node Peer socket while it is CONNECTING: it does not queue the controller's immediate HELLO. Discover the ready service with `requireHubReplication(ctx)` or `requirePeerReplication(ctx)`. There is no `createNomicoreYjsServerPlugin()` / `requireNomicoreYjsServer()` integration surface.
- Use lower-level `createHubReplication()` / `createPeerReplication()` only for a trusted host that deliberately owns custom transport integration and controller lifecycle. They are not the default Cordis embedding path.

## Package installation

Ordinary consumers install released packages from npm:

```bash
pnpm add @nomicore/yjs-server @nomicore/ws-replication
```

The package manager resolves the published Registry/Runtime/Persistence/Clock/VFSL dependency graph. Use `pnpm pack:local` and the complete manifest tarball set only for an explicitly unreleased Nomicore change; final production and integration verification should return to npm packages whenever possible.

## Deployment process

1. Give every process one static `role` (`hub` or `peer`), a safe unique `instanceId`, its own Persistence instance, and—when file-backed—its own exclusive `rootDir`. A root is private storage, not a cross-process mutation channel: never point a second live process at it or edit its snapshots; use replication between distinct roots. In an embedded host, configure `instanceId + role` exactly once through `createInstancePlugin()`; Registry and replication both consume that service, and static identity is restart-only.
2. Hub configuration supplies:
   - listen address;
   - token mapping from authenticated peer identity;
   - authorization entries binding a trusted peer to namespace and Hub-local owner, with read/submit permissions;
   - existing namespace references for production, or explicitly temporary provisioning for bootstrap/demo use.
3. Peer configuration supplies:
   - Hub `ws://`/`wss://` URL and expected Hub instance ID;
   - its own bearer token;
   - replication targets containing namespace ID and Peer-local owner.
4. After the Hub replication plugin is ready, create or open each Hub-owned namespace, retain its lease, and await `lease.enableReplication()` before starting scanners/workers that depend on replication. Keep owner local: it is a persistence partition key and is never sent over the wire. The plugin may listen before this step, but that namespace is not a usable replication entry until enablement and authorization both reference its persisted `namespaceId`.
5. Start Hub before Peer. Hub plugin readiness means transport listener/auth wiring only, not namespace or domain readiness. Peer plugin readiness means its dial loop started, not target liveness. Choose a Peer boot policy: reconnect daemons may publish early and gate operations; data-plane services and one-shot jobs await `waitForLive(namespaceId)` before publishing/working. Keep readiness-critical waits in `async apply()`, not a background effect. Do not equate an UPDATE ACK with disk flush or quorum durability.
6. For production, terminate TLS outside the app and use `wss://`. Restrict config/token file permissions. Never send bearer tokens over untrusted plaintext networks.
7. Test bootstrap, restart/reconcile, bidirectional ROOT changes, unauthorized namespace access, bad credentials, identity/epoch conflict, backpressure, and graceful drain.

## Recovery and operations

- Hub graceful restart sends GOAWAY and can leave Peer `blocked`. After Hub is ready, invoke `notify-auth-changed` when Peer credentials/config are unchanged, or restart/reload Peer when they changed.
- Hub hard failure does not send GOAWAY; Peer uses backoff to reconnect automatically.
- SCHEMA replacement is Hub-only. A Peer may require controlled reset/re-bootstrap or restart before local business writes use newly introduced fields.
- Epoch bump fences old replicas asynchronously. Recover a conflicted Peer with guarded `reset-replica` using its expected old replication identity, then observe bootstrap to the new epoch.
- A Peer target re-add after terminal state rebuilds the whole connection; other namespaces on that connection may briefly reconnect.
- Peer target persistence belongs to the host; `addTarget()` / `removeTarget()` mutate only the current process.
- Static identity, endpoints, credentials, limits, timeouts, backoff, and static authorization are restart-only; runtime target changes are the supported dynamic configuration surface.
- Stop Peer before Hub when orchestrating standalone processes, or signal each process and let its ordered drain run. In an embedded host, dispose the role-specific replication Fiber before Registry shutdown and Persistence disposal; the replication plugin never owns or tears down those upstream services.

## Replication observability and logs

`ReplicationObserver` is an optional callback seam, not a default persistent logger. The package-level `createHubReplicationPlugin()` and `createPeerReplicationPlugin()` factories emit no externally observable replication records unless the Host explicitly supplies `overrides.observer`; synchronization continues normally when the observer is absent. An observer callback still does not persist anything by itself—the Host owns the adapter that writes events to stdout, files, logs, metrics, or traces.

The standalone `@nomicore/yjs-server` application explicitly installs observers on both roles and maps their events to its stdout NDJSON channel. Embedded Cordis Hosts must install and retain their own observer adapters on both Hub and Peer. Hub and Peer produce independent local event streams; there is no central stream, cross-replica global sequence, or default durable log.

Persist at least these events when a deployment must diagnose synchronization and recovery:

- connection lifecycle: `connection-state-changed`, `connection-backoff-scheduled`, `goaway-received`, `connection-failed`;
- namespace lifecycle: `channel-state-changed`, `namespace-error`, `identity-conflicted`;
- bootstrap/reconciliation: `bootstrap-snapshot-sent`, `bootstrap-imported`, `sync-step2-sent`, `sync-diff-applied`, `resync-required`;
- live updates: `update-sent`, `update-applied`, `update-acked`, `degraded-bypass-applied`;
- backpressure: `send-paused`, `send-resumed`.

`ReplicationObserver` records transport and replication progress using safe metadata such as side, connection ID, namespace ID, byte length, state, stable code, and optional latency. It deliberately excludes bearer tokens, owners, ROOT/SCHEMA contents, raw Yjs bytes, stacks, and uncontrolled causes. Current update events do not provide a globally stable update ID, so concurrent same-size updates may not be correlated across replicas without additional Host-owned tracing.

Do not confuse transport observation with the optional namespace diagnostic change log: `ReplicationObserver` explains connection/channel/send/apply/ACK/reconcile behavior, while the diagnostic change log records local Y.Doc mutation or trusted replication-apply attempts and their committed/rejected/fatal outcomes. Complete Hub/Peer inconsistency diagnosis generally needs both sides' replication observer logs and, when enabled, both sides' independent diagnostic change streams.

Example embedded wiring:

```ts
const observer: ReplicationObserver = (event) => replicationLog.write(event)

createHubReplicationPlugin(hubConfig, { listen, observer })
createPeerReplicationPlugin(peerConfig, { createDial, observer })
```

The adapter must preserve the observer's failure-isolation contract: callback failures must not change replication state or business results, and sensitive fields must remain redacted.

## Diagnosis ladder

For Node Hub/Peer handshake failures, combine `createNodeHubListenAdapter(observer)` events with `ReplicationObserver`: no `upgrade-authenticated` means routing/auth; authenticated without `transport-accepted` means adapter handoff; accepted without Hub handshaking/ready means trusted controller admission; Hub handshaking plus Peer `hello-timeout` means the Peer HELLO was not delivered—first verify `createNodePeerDial()` is used; Hub ready but target not live moves diagnosis to OPEN, authorization, bootstrap, or reconcile. Keep all captured credentials redacted.

For data divergence, compare both local streams in order: prove the writer committed a local Y.Doc effect, then find `update-sent`, receiver `update-applied`, sender `update-acked`, and any intervening `resync-required` or reconnect/reconcile events. Absence of a receiver apply record narrows the problem to fanout/connection/wire state but does not by itself explain where the update stopped. Record the exact target state and path-level public `readData()` result at the failed business decision; snapshot mtimes or raw string matches do not prove that a live Peer was connected or converged.

## Hard invariants

Authentication evidence comes from successful HTTP Upgrade verification, never HELLO self-report. Hub authorization runs before namespace existence is revealed. One active file root belongs to one process. Raw replication is trusted and bypasses full VFSL prevalidation; keep ReplicationSession capabilities inside trusted integration code.

## Completion gate

Complete when each process has isolated storage and one static Instance identity source, the selected standalone or embedded surface is used without inventing a unified yjs-server plugin, trusted auth and per-namespace authorization are tested, plugin readiness is distinguished from Peer target liveness, targets bootstrap and reconcile to `live`, TLS/token handling is production-safe, conflict/reset and Hub-restart runbooks are verified, and shutdown reaches replication drain before Registry and Persistence teardown.
