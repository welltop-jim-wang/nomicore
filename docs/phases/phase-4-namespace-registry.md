# Phase 4：NamespaceRegistry 集成范围

Phase 4 在 NamespaceRuntime 之上建立通用 Cordis NamespaceRegistry plugin，使 DSH 与未来 NomicoreServer 共享同一套 namespace create/open、调用方租约、空闲保留和 Host shutdown 编排。

## 设计基准

- ADR 0006：Persistence、DocHandle、create/load、degraded/retry。
- ADR 0008：单 NamespaceRuntime、P0、单 sequencer、ROOT/SCHEMA 写、fatal/status/close。
- ADR 0009：Registry、NamespaceLease、同键生命周期串行、idle retention 和 Cordis Host 生命周期。
- `CONTEXT.md`：namespace、空闲 Runtime 和 META createdAt 的当前术语。
- Tracking issue #104：Phase 4 完整用户故事、Implementation Decisions、Testing Decisions 与范围。

## 集成模型

本阶段使用 `docs/namespace-registry` 作为设计和实现集成分支。Phase 4 implementation tickets 从该分支派生并以其 PR 为 Parent；阶段收口后统一审查并合入 `main`。

Registry 是 Host 级通用 Cordis plugin，Runtime 继续是普通模块：

```text
Cordis Host
├── Timer plugin                 → ctx.timeout()
├── @nomicore/clock              → ctx.clock
├── Nomicore Persistence         → ctx.nomicorePersistence
└── @nomicore/namespace-registry → ctx.nomicoreRegistry
    └── ordinary NamespaceRuntime instances
```

## 实施切片

按依赖顺序实施：

1. `@nomicore/clock` Cordis Clock capability；
2. Persistence service name、Timer/Clock 依赖迁移；
3. Persistence typed load/create operational errors 与 committed-aware create fatal；
4. NamespaceRuntime 的受限 Registry factory；
5. Registry 核心、NamespaceLease、同键 lifecycle queue 与 idle retention；
6. Registry Cordis plugin 与 ordered shutdown；
7. Memory/File Persistence 共用 Registry contract tests 和真实 Cordis composition 验收；
8. Phase 4 最终整体审查、文档/exports 收口与集成合并。

## 测试 seam

最高测试 seam 是公开的 `NamespaceRegistry` / `NamespaceLease` Interface。MemoryPersistence 与 FilePersistence 共用 Registry contract suite。Testing subpath仅允许替换 Runtime factory、create-document factory、Clock、timeout和observer，以确定性覆盖并发、时间和fatal；不公开entry map、lease count、queue或timer handle。

## 非目标

- REST、HTTP映射、authentication与authorization；
- WS room、raw Yjs sync和客户端更新协议；
- META创建后的写入；
- namespace list/search；
- idle容量上限、LRU、显式eviction或admin close；
- 分布式Registry、文件锁或leader election；
- durable timer/cron；
- 自动schema migration、默认ROOT或create-as-upsert；
- 公共Registry事件订阅；
- Persistence package重命名。

## 阶段门禁

Phase 4 收口要求：

- ADR 0009、CONTEXT、package docs、public types和错误词汇一致；
- Memory/File/Cordis全链验收通过；
- Node 20/24验证`Symbol.asyncDispose` / `await using`行为；
- `pnpm typecheck`、全量`pnpm test`与聚合`tsc --noEmit`通过；
- 所有实现tickets关闭且不存在merge blocker；
- 对integration PR执行Standards/Spec两轴最终审查。
