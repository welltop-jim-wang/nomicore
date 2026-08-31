# Hub/Peer replication branch

Nomicore calls the roles **Hub** and **Peer**. Map “主” to Hub and “从/副本” to Peer while preserving the actual multi-writer contract: both hold full local replicas and may accept controlled ROOT writes; Hub alone controls SCHEMA and replication identity.

Read these authorities before implementation:

1. `$NOMICORE_ROOT/docs/adr/0010-hub-peer-websocket-ydoc-replication.md` — architecture;
2. `$NOMICORE_ROOT/docs/protocols/instance-replication-v1.md` — normative wire contract;
3. `$NOMICORE_ROOT/docs/integration/hub-peer-deployment.md` — deployable app configuration and operations.

## Choose the integration level

- Prefer the composed `@nomicore/yjs-server` package when the host needs a standalone Hub/Peer process. Its local tarball contains compiled `dist` JavaScript/declarations and the `nomicore-yjs-server` CLI. Follow the deployment guide's strict JSON config and NDJSON operations.
- Use `@nomicore/ws-replication` directly only when embedding transport into an existing host. Then assemble public `createHubReplication()` / `createPeerReplication()` options, trusted Upgrade authentication, authorization, Registry, timer, clock, observer, and transport adapters. Derive option shapes from current public types; do not invent config fields from the standalone app.

## Local tarball distribution

Run `pnpm pack:local` in Nomicore. Replication consumers need the complete unpublished graph, including:

```text
@nomicore/replication-protocol
@nomicore/ws-replication
@nomicore/yjs-server
```

plus Registry/Runtime/Persistence/Clock/VFSL dependencies listed in `artifacts/local-packages/manifest.json`. Until packages are published to a registry, point every `@nomicore/*` dependency to the local tarball or an extracted local package directory; installing only the top-level server tarball makes the package manager query npm for unpublished transitive versions. Consume packed `dist`, not Nomicore source links.

## Deployment process

1. Give every process one static `role` (`hub` or `peer`), a safe unique `instanceId`, its own Persistence instance, and—when file-backed—its own exclusive `rootDir`.
2. Hub configuration supplies:
   - listen address;
   - token mapping from authenticated peer identity;
   - authorization entries binding a trusted peer to namespace and Hub-local owner, with read/submit permissions;
   - existing namespace references for production, or explicitly temporary provisioning for bootstrap/demo use.
3. Peer configuration supplies:
   - Hub `ws://`/`wss://` URL and expected Hub instance ID;
   - its own bearer token;
   - replication targets containing namespace ID and Peer-local owner.
4. Enable replication on a Hub-owned namespace before expecting it to replicate. Keep owner local: it is a persistence partition key and is never sent over the wire.
5. Start Hub before Peer. Observe readiness and channel state until targets reach `live`; do not equate an UPDATE ACK with disk flush or quorum durability.
6. For production, terminate TLS outside the app and use `wss://`. Restrict config/token file permissions. Never send bearer tokens over untrusted plaintext networks.
7. Test bootstrap, restart/reconcile, bidirectional ROOT changes, unauthorized namespace access, bad credentials, identity/epoch conflict, backpressure, and graceful drain.

## Recovery and operations

- Hub graceful restart sends GOAWAY and can leave Peer `blocked`. After Hub is ready, invoke `notify-auth-changed` when Peer credentials/config are unchanged, or restart/reload Peer when they changed.
- Hub hard failure does not send GOAWAY; Peer uses backoff to reconnect automatically.
- SCHEMA replacement is Hub-only. A Peer may require controlled reset/re-bootstrap or restart before local business writes use newly introduced fields.
- Epoch bump fences old replicas asynchronously. Recover a conflicted Peer with guarded `reset-replica` using its expected old replication identity, then observe bootstrap to the new epoch.
- A Peer target re-add after terminal state rebuilds the whole connection; other namespaces on that connection may briefly reconnect.
- Stop Peer before Hub when orchestrating manually, or signal each process and let its ordered drain run.

## Hard invariants

Authentication evidence comes from successful HTTP Upgrade verification, never HELLO self-report. Hub authorization runs before namespace existence is revealed. One active file root belongs to one process. Raw replication is trusted and bypasses full VFSL prevalidation; keep ReplicationSession capabilities inside trusted integration code.

## Completion gate

Complete when each process has isolated storage and static identity, trusted auth and per-namespace authorization are tested, targets bootstrap and reconcile to `live`, TLS/token handling is production-safe, conflict/reset and Hub-restart runbooks are verified, and shutdown reaches replication drain before Registry and Persistence teardown.
