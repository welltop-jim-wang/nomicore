# `@nomicore/persistence`

服务端 `DocPersistence` / `DocHandle` 契约，以及共享同一生命周期语义的 Memory、File adapters。

第三方 Cordis 宿主的 Clock → Timer → Persistence → Registry 装配顺序、插件配置和停止流程见 [`docs/integration/cordis-plugin-hosting.md`](../../docs/integration/cordis-plugin-hosting.md)。

## 插件入口

- `createMemoryPersistencePlugin(options)`：进程内快照，适合开发、测试或无需重启恢复的宿主。
- `createFilePersistencePlugin({ rootDir, ...options })`：文件快照，可用同一 `rootDir` 重启恢复。
- `requireNomicorePersistence(ctx)`：读取已挂载服务；缺失时响亮失败。

插件依赖宿主先提供 `ctx.clock` 和 Cordis Timer。插件路径会从 `ctx.timeout()` 创建 scheduler；宿主只配置 `schedule.debounceMs` 与 `schedule.maxDirtyMs`，不自行传入 scheduler。

业务数据访问优先经 `@nomicore/namespace-registry` 的 `NamespaceLease` 完成。直接消费 `DocHandle` 表示宿主正在实现生命周期层，必须遵守 [ADR-0006](../../docs/adr/0006-server-persistence-docstore.md)。
