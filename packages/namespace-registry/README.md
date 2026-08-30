# `@nomicore/namespace-registry`

`NamespaceRegistry` is the host-level lifecycle owner for namespace runtimes. It guarantees one active runtime and one write sequencer per `namespaceId` (ADR 0010: the Registry entry key is the namespaceId alone — owner identity is a persisted partition property plus a reuse-time check), while independent namespace keys may progress concurrently.

第三方 Cordis 宿主的完整插件装配、配置表、数据读写和停止顺序见 [`docs/integration/cordis-plugin-hosting.md`](../../docs/integration/cordis-plugin-hosting.md)。

## Public API

The main entry exports `NamespaceRegistry`, `NamespaceLease`, result/status/error types, and the Cordis plugin. It does not expose a production runtime constructor, `DocHandle`, live `Y.Doc`, entry map, queue, timer handle, or testing seams.

- `open(owner, namespaceId)` loads or reuses a runtime and returns an independent lease.
- `create(input)` exclusively creates a complete namespace document and returns a lease.
- A lease is the caller capability for reads and controlled ROOT/SCHEMA writes. `release()` and `[Symbol.asyncDispose]()` share one idempotent operation.
- The final released lease leaves an **idle Runtime** retained until `idleTimeoutMs`; reopen during that interval reuses it.
- `shutdown()` synchronously stops acceptance, drains accepted lifecycle operations, cancels idle timers, closes every runtime, and aggregates close failures.

### ReplicationSession

- **登记句**：`lease.openReplicationSession({ localRole, remoteInstanceId })` 是高级受信租借入口（trusted raw 例外指针——Host 只把该能力交给可信 transport；拒绝码闭集见 ADR 0010 修订节注册表；每 Lease 至多一个活跃 session；`close`/epoch fence 终态后同 Lease 可再 open）。
- **Plugin configuration**：`createNamespaceRegistryPlugin({ idleTimeoutMs?, role? })`——`role: 'hub'|'peer'`（缺省 `'hub'`；非法值 loud 拒绝 `NAMESPACE_REGISTRY_ROLE_INVALID`；生产 composition root 必须显式传——切片 9 义务提前）。
- **peer 权限边界**：peer 实例的 `replaceSchema`/`enableReplication`/`bumpReplicationEpoch` 以 `REPLICATION_ROLE_PERMISSION` 稳定拒绝；ROOT 业务写不受限；session `localRole` 必须等于实例静态角色。
- **生命周期边界**：Lease release 同步 close 既有 session（hostile seam 隔离——release 永不因 session 异常半释放：`onReleased`/idle 武装无条件到达）；Registry shutdown → Runtime close → sessions 终态 `closed`。
- **status 词汇**：`state/direction/冻结四域/currentEpoch/rootValidation/durability/observerFailures/needsResync`（ADR 0010 修订节指针——`needsResync` 为 fanout 投递队列溢出 sticky 标记）。

## Plugin configuration

`createNamespaceRegistryPlugin({ idleTimeoutMs?, role? })` 接受 `idleTimeoutMs`（可选）与 `role`（`'hub'|'peer'`，可选，缺省 `'hub'`）：`idleTimeoutMs` 为最后一个 lease 释放后空闲 Runtime 的保留时间，默认值为 `300_000` ms，值必须是 `0..2147483647` 的有限整数，`0` 会立即安排回收；`role` 为实例静态角色（合法值仅 `'hub'|'peer'`，非法值 TypeError `NAMESPACE_REGISTRY_ROLE_INVALID`）。多余键或非法值会响亮拒绝。

## Cordis service

`createNamespaceRegistryPlugin()` provides `ctx.nomicoreRegistry`. Startup requires all three services and fails loudly when any is absent:

- `ctx.timeout()` from the Cordis Timer plugin;
- `ctx.clock` from `@nomicore/clock`;
- `ctx.nomicorePersistence` from `@nomicore/persistence`.

No system clock or global timer fallback is used by the Registry.

## Errors

Expected open/create failures use narrow result issues such as `REGISTRY_NOT_ACCEPTING`, `NAMESPACE_NOT_FOUND`, `NAMESPACE_INVALID_IDENTITY`, typed persistence failures, and schema/ROOT validation issues. Internal failures reject with `NamespaceRegistryFatalError`; shutdown close failures reject with `NamespaceRegistryShutdownError`.

`NAMESPACE_ALREADY_EXISTS` remains part of the public `CreateNamespaceIssue` union for the planned trusted-import slice, but ordinary open/create no longer produce it: ordinary create collisions are resolved internally by regeneration (entry or persisted duplicate → retry up to 8 times) and then reject a `committed:false` `NamespaceRegistryFatalError` (`phase: 'namespace-id-generation'`) on budget exhaustion. `NAMESPACE_CREATE_INVALID_INPUT` covers the three-key shape (carrying a caller-selected `namespaceId` key is rejected); `open` of an existing namespace never conflicts — an owner mismatch on a live entry returns `NAMESPACE_NOT_FOUND` with zero exposure.

## Contract and verification

The normative contract is `CONTEXT.md` plus ADR 0009. MemoryPersistence and FilePersistence run the same Registry acceptance contract, including FilePersistence restart/reopen.

```sh
pnpm typecheck
pnpm test
./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit
```

Node 20 and Node 24 CI both execute the `Symbol.asyncDispose` / `await using` behavior tests without conditional skips.
