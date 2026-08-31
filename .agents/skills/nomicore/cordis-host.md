# Cordis host branch

Compose Nomicore inside the independent host's existing composition root. Read `$NOMICORE_ROOT/docs/integration/cordis-plugin-hosting.md` before changing plugin assembly or lifecycle.

## Process

1. Inspect the host's current Cordis context ownership, configuration system, persistence requirements, health checks, and shutdown path.
2. Link or install the public packages used by the host. For unpublished local integration, typical runtime paths are:

   ```bash
   cd /path/to/host
   pnpm link \
     "$NOMICORE_ROOT/packages/vfsl" \
     "$NOMICORE_ROOT/packages/doc-runtime" \
     "$NOMICORE_ROOT/packages/clock" \
     "$NOMICORE_ROOT/packages/persistence" \
     "$NOMICORE_ROOT/packages/namespace-runtime" \
     "$NOMICORE_ROOT/packages/namespace-registry"
   ```

3. In one Cordis `Context`, install in dependency order:
   1. `createSystemClockPlugin()`;
   2. `@deepseek-ai/cordis-plugin-timer`;
   3. exactly one production Persistence plugin (`createMemoryPersistencePlugin` for ephemeral use or `createFilePersistencePlugin` for restart recovery);
   4. `createNamespaceRegistryPlugin()`.
4. Await plugin Fibers before requiring their services. Obtain Registry with `requireNomicoreRegistry(ctx)`. Let business code consume Registry leases rather than Persistence handles or live Yjs objects.
5. Create a namespace with the host-owned VFSL file text, a matching `{lang:'vfsl', version:1, id, text}` envelope, and an initial plain JSON ROOT. Persist `lease.namespaceId` in the host's own data model. Release every lease after use.
6. For reopen, call `registry.open(owner, namespaceId)` with the same persistence-partition owner. Branch on stable `result.ok` and `code`; do not parse message text.
7. Add health projection from public status methods. Test missing dependencies, invalid schema/root, read/write rejection, lease release, persistence restart behavior, and zero-write validation failure.
8. Shutdown in ownership order: stop host requests, release leases, await `registry.shutdown()` when explicitly owned, dispose Persistence, then tear down Timer/Clock/root Context. Use one teardown chain rather than racing manual and Cordis cascade disposal.

## Guardrails

- `@nomicore/dsh-persistence` is a DSH development/profile adapter, not the default third-party production choice.
- Memory persistence does not survive adapter destruction.
- File persistence needs a host-selected writable root and exclusive lifecycle ownership.
- Use public `create*Plugin()` factories. Dynamic plugin IDs, source scanning, and `cordis_define` are not stable Nomicore contracts.

## Completion gate

Complete when startup proves Clock → Timer → Persistence → Registry ordering, a namespace can be created/read/mutated/reopened through a lease, invalid writes remain zero-write, every lease and Fiber has one owner, and graceful shutdown flushes/disposes in the documented order.
