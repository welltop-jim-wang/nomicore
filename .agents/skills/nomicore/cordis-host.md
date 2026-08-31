# Cordis host branch

Compose Nomicore inside the independent host's existing composition root. Read `$NOMICORE_ROOT/docs/integration/cordis-plugin-hosting.md` before changing plugin assembly or lifecycle.

## Process

1. Inspect the host's Cordis context ownership, configuration system, existing Timer provider, persistence/recovery identity, health/readiness model, domain startup policy, and shutdown path.
2. Link or install the public packages used by the host. For unpublished local integration, prefer the complete tarball graph from `$NOMICORE_ROOT/artifacts/local-packages/manifest.json`; when intentionally linking checkout directories, include every runtime package the selected branches consume, including `packages/instance` and `packages/ws-replication` for embedded replication.
3. In one Cordis `Context`, install in dependency order:
   1. `createInstancePlugin()` with one immutable `{ instanceId, role }` source; for Fiber management pass that config both to the factory and as the second `ctx.plugin(plugin, config)` argument;
   2. `createSystemClockPlugin()`;
   3. exactly one Timer provider: construct it only in an independent composition root, or consume the existing Host Timer when embedded;
   4. exactly one production Persistence plugin (`createMemoryPersistencePlugin` for ephemeral use or `createFilePersistencePlugin` for restart recovery);
   5. `createNamespaceRegistryPlugin()`, which reads role from the Instance service and has no role configuration;
   6. when embedding replication, the matching `createHubReplicationPlugin()` or `createPeerReplicationPlugin()` from `@nomicore/ws-replication`.
4. Call `await fiber.await()` after each provider/plugin before requiring its service. Current Cordis wrappers are thenable too, but explicit `.await()` makes lifecycle readiness and startup-error propagation unambiguous. Obtain Registry with `requireNomicoreRegistry(ctx)` and replication with `requireHubReplication(ctx)` or `requirePeerReplication(ctx)`.
5. Decide create versus recovery before startup. Recovery requires the same File `rootDir`, owner, and persisted `namespaceId`; a fresh root cannot open old IDs. Create or open each namespace and persist `lease.namespaceId`. On a Hub, await `lease.enableReplication()` before dependent consumers. On a Peer, configure/add the target and decide whether domain activation must await `waitForLive(namespaceId)`. Keep each consumer within its lease lifetime.
6. Put readiness-critical startup in the owning plugin's `async apply()` path so namespace/schema/enablement/live-wait failures reject Loader activation. Use `ctx.effect()` to register cleanup after startup, not to launch hidden background initialization. Let business code consume Registry leases and role-specific services rather than Persistence handles, raw controllers, ReplicationSessions, or live Yjs objects.
7. Expose transport liveness, namespace readiness, and domain readiness separately. Treat the Node listener `/healthz` as transport-only. Test missing dependencies, duplicate Timer prevention, invalid schema/root, recovery with matching and fresh roots, replication enablement/target setup, each Peer boot policy, business-consumer startup gating, lease release, and zero-write validation failure.
8. Shutdown in reverse ownership order: stop and drain business consumers, release their leases, dispose the role-specific replication Fiber, await `registry.shutdown()` when explicitly owned, dispose Persistence, then tear down Timer/Clock/Instance/root Context. Replication disposal drains only its listener/dialer, controller, connections, channels, and service; it never shuts down Registry or Persistence. Use one teardown chain rather than racing manual and Cordis cascade disposal.

## Guardrails

- `@nomicore/dsh-persistence` is a DSH development/profile adapter, not the default third-party production choice.
- Memory persistence does not survive adapter destruction.
- File persistence recovery identity is `rootDir + owner + namespaceId`; a fresh root means no existing namespace. Each active adapter/process exclusively owns its root.
- Use public `create*Plugin()` factories and the Cordis Fiber dependency graph. Do not invent `startNomicoreHubRuntime()` / `startNomicorePeerRuntime()` helpers that create or own Instance, Timer, Persistence, and Registry: that hides Host policy and recreates the self-contained server plugin rejected by ADR 0012. Embedded replication uses role-specific factories/services from `@nomicore/ws-replication`; Node transport wiring may use `createNodeHubListenAdapter()` from `@nomicore/yjs-server`. Dynamic plugin IDs, source scanning, and `cordis_define` are not stable Nomicore contracts.

## Completion gate

Complete when startup proves Instance → Clock → Timer → Persistence → Registry → role-specific replication plugin → namespace lease → Hub enableReplication/Peer target → business consumer ordering, Registry and replication consume the same immutable identity, invalid writes remain zero-write, every consumer stays within its lease lifetime, and graceful shutdown reverses ownership by draining consumers before leases, replication, Registry, and Persistence.
