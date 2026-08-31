# Cordis host branch

Compose Nomicore inside the independent host's existing composition root. Read `$NOMICORE_ROOT/docs/integration/cordis-plugin-hosting.md` before changing plugin assembly or lifecycle.

## Process

1. Inspect the host's current Cordis context ownership, configuration system, persistence requirements, health checks, and shutdown path.
2. Link or install the public packages used by the host. For unpublished local integration, prefer the complete tarball graph from `$NOMICORE_ROOT/artifacts/local-packages/manifest.json`; when intentionally linking checkout directories, include every runtime package the selected branches consume, including `packages/instance` and `packages/ws-replication` for embedded replication.
3. In one Cordis `Context`, install in dependency order:
   1. `createInstancePlugin()` with the one immutable `{ instanceId, role }` source;
   2. `createSystemClockPlugin()`;
   3. `@deepseek-ai/cordis-plugin-timer`;
   4. exactly one production Persistence plugin (`createMemoryPersistencePlugin` for ephemeral use or `createFilePersistencePlugin` for restart recovery);
   5. `createNamespaceRegistryPlugin()`, which reads role from the Instance service and has no role configuration;
   6. when embedding replication, the matching `createHubReplicationPlugin()` or `createPeerReplicationPlugin()` from `@nomicore/ws-replication`.
4. Await plugin Fibers before requiring their services. Obtain Registry with `requireNomicoreRegistry(ctx)` and replication with `requireHubReplication(ctx)` or `requirePeerReplication(ctx)`.
5. Create or open each host-owned namespace and persist its `lease.namespaceId`. On a Hub, call and await `lease.enableReplication()` before starting any scanner, worker, or request handler that depends on that namespace. On a Peer, configure or add the corresponding target instead; `enableReplication()` is Hub-only. Keep each business consumer's lifetime within its lease lifetime.
6. For reopen, call `registry.open(owner, namespaceId)` with the same persistence-partition owner. Branch on stable `result.ok` and `code`; do not parse message text. Let business code consume Registry leases and the role-specific service rather than Persistence handles, raw controllers, ReplicationSessions, or live Yjs objects.
7. Add health projection from public status methods. Test missing dependencies, invalid schema/root, replication enablement or target setup, business-consumer startup gating, read/write rejection, lease release, persistence restart behavior, and zero-write validation failure.
8. Shutdown in reverse ownership order: stop and drain business consumers, release their leases, dispose the role-specific replication Fiber, await `registry.shutdown()` when explicitly owned, dispose Persistence, then tear down Timer/Clock/Instance/root Context. Replication disposal drains only its listener/dialer, controller, connections, channels, and service; it never shuts down Registry or Persistence. Use one teardown chain rather than racing manual and Cordis cascade disposal.

## Guardrails

- `@nomicore/dsh-persistence` is a DSH development/profile adapter, not the default third-party production choice.
- Memory persistence does not survive adapter destruction.
- File persistence needs a host-selected writable root and exclusive lifecycle ownership.
- Use public `create*Plugin()` factories. Embedded Hub/Peer replication uses the role-specific factories and services from `@nomicore/ws-replication`; a self-contained `createNomicoreYjsServerPlugin()` / `requireNomicoreYjsServer()` API is not part of the architecture. Dynamic plugin IDs, source scanning, and `cordis_define` are not stable Nomicore contracts.

## Completion gate

Complete when startup proves Instance → Clock → Timer → Persistence → Registry → role-specific replication plugin → namespace lease → Hub enableReplication/Peer target → business consumer ordering, Registry and replication consume the same immutable identity, invalid writes remain zero-write, every consumer stays within its lease lifetime, and graceful shutdown reverses ownership by draining consumers before leases, replication, Registry, and Persistence.
