# `@nomicore/persistence`

服务端 `DocPersistence` / `DocHandle` 契约，以及共享同一生命周期语义的 Memory、File adapters。

第三方 Cordis 宿主的 Instance → Clock → Timer → Persistence → Registry → 可选角色专用 replication plugin 装配顺序、插件配置和停止流程见 [`docs/integration/cordis-plugin-hosting.md`](../../docs/integration/cordis-plugin-hosting.md)。

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

File 插件要求非空 `rootDir`，快照布局为 `rootDir/users/<userId>/<namespaceId>.snapshot`。`owner.userId` 与 `namespaceId` 必须匹配 `^[a-z][a-z0-9-]{0,62}$`。同一时刻只允许一个 active File adapter/process 独占整个目录；同一 root 只可在旧 owner 完全 dispose 后用于重启或迁移接管。

`rootDir` 不是共享数据库或跨进程写接口。另一个进程不得同时以同一 root 打开/修改 namespace，不得绕过锁，也不得直接编辑、替换或复制回 `.snapshot` 文件来提交业务数据。此类操作绕过唯一 Runtime/write sequencer、VFSL 校验、dirty/flush 与 replication 身份，结果不在兼容性或恢复保证内。

业务数据访问必须经 `@nomicore/namespace-registry` 的 `NamespaceLease` 或拥有者公开的业务接口完成。跨进程写使用独立 root 的 Hub/Peer replication；直接消费 `DocHandle` 仅表示宿主正在实现生命周期层，仍必须遵守单 owner 和 [ADR-0006](../../docs/adr/0006-server-persistence-docstore.md)。
