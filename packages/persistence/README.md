# `@nomicore/persistence`

服务端 `DocPersistence` / `DocHandle` 契约，以及共享同一生命周期语义的 Memory、File adapters。

第三方 Cordis 宿主的 Clock → Timer → Persistence → Registry 装配顺序、插件配置和停止流程见 [`docs/integration/cordis-plugin-hosting.md`](../../docs/integration/cordis-plugin-hosting.md)。

## 插件入口

- `createMemoryPersistencePlugin(options)`：进程内快照，适合开发、测试或无需重启恢复的宿主。
- `createFilePersistencePlugin({ rootDir, ...options })`：文件快照，可用同一 `rootDir` 重启恢复。
- `requireNomicorePersistence(ctx)`：读取已挂载服务；缺失时响亮失败。

插件依赖宿主先提供 `ctx.clock` 和 Cordis Timer。插件路径会从 `ctx.timeout()` 创建 scheduler，不接收宿主传入的 scheduler。

## 配置

共享的 `schedule` 可部分配置；未提供的字段使用 `DEFAULT_PERSISTENCE_SCHEDULE`：

| 配置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `schedule.debounceMs` | 非负有限 `number` | `500` | dirty 后的 debounce flush 延迟。 |
| `schedule.maxDirtyMs` | 非负有限 `number` | `5000` | dirty 状态允许持续的最大时间。 |

Memory 插件还接受 `writeSnapshot` 和 `readSnapshot` seam；其内建快照属于当前 adapter 实例，dispose 后不可重启恢复。

File 插件要求非空 `rootDir`，快照布局为 `rootDir/users/<userId>/<namespaceId>.snapshot`。`owner.userId` 与 `namespaceId` 必须匹配 `^[a-z][a-z0-9-]{0,62}$`。同一时刻只让一个 active File adapter 拥有该目录。

业务数据访问优先经 `@nomicore/namespace-registry` 的 `NamespaceLease` 完成。直接消费 `DocHandle` 表示宿主正在实现生命周期层，必须遵守 [ADR-0006](../../docs/adr/0006-server-persistence-docstore.md)。
