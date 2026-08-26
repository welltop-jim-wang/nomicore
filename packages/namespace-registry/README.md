# `@nomicore/namespace-registry`

`NamespaceRegistry` is the host-level lifecycle owner for namespace runtimes. It guarantees one active runtime and one write sequencer per `(owner.userId, namespaceId)`, while independent namespace keys may progress concurrently.

第三方 Cordis 宿主的完整插件装配、配置表、数据读写和停止顺序见 [`docs/integration/cordis-plugin-hosting.md`](../../docs/integration/cordis-plugin-hosting.md)。

## Public API

The main entry exports `NamespaceRegistry`, `NamespaceLease`, result/status/error types, and the Cordis plugin. It does not expose a production runtime constructor, `DocHandle`, live `Y.Doc`, entry map, queue, timer handle, or testing seams.

- `open(owner, namespaceId)` loads or reuses a runtime and returns an independent lease.
- `create(input)` exclusively creates a complete namespace document and returns a lease.
- A lease is the caller capability for reads and controlled ROOT/SCHEMA writes. `release()` and `[Symbol.asyncDispose]()` share one idempotent operation.
- The final released lease leaves an **idle Runtime** retained until `idleTimeoutMs`; reopen during that interval reuses it.
- `shutdown()` synchronously stops acceptance, drains accepted lifecycle operations, cancels idle timers, closes every runtime, and aggregates close failures.

## Cordis service

`createNamespaceRegistryPlugin()` provides `ctx.nomicoreRegistry`. Startup requires all three services and fails loudly when any is absent:

- `ctx.timeout()` from the Cordis Timer plugin;
- `ctx.clock` from `@nomicore/clock`;
- `ctx.nomicorePersistence` from `@nomicore/persistence`.

No system clock or global timer fallback is used by the Registry.

## Errors

Expected open/create failures use narrow result issues such as `REGISTRY_NOT_ACCEPTING`, `NAMESPACE_NOT_FOUND`, `NAMESPACE_ALREADY_EXISTS`, typed persistence failures, and schema/ROOT validation issues. Internal failures reject with `NamespaceRegistryFatalError`; shutdown close failures reject with `NamespaceRegistryShutdownError`.

## Contract and verification

The normative contract is `CONTEXT.md` plus ADR 0009. MemoryPersistence and FilePersistence run the same Registry acceptance contract, including FilePersistence restart/reopen.

```sh
pnpm typecheck
pnpm test
./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit
```

Node 20 and Node 24 CI both execute the `Symbol.asyncDispose` / `await using` behavior tests without conditional skips.
