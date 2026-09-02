# 任务简报 — Phase 5: expose trusted NamespaceLease ReplicationSession（issue #134，round=1）

- **repositoryId**: nomicore
- **issue**: 134（labels: in-progress, feature）
- **round**: 1
- **branch**: fix/issue-134-on-docs-phase-5-websocket-replication（基于 origin/docs/phase-5-websocket-replication，ebc5419）
- **run_id**: issue-134-1787847658-8367
- **worktree**: /home/wangjian/nomicore-fix-issue-134
- **任务类型自判**：feature → 完整工作流：SA8 前置门禁 → SA6 验收锚定（红灯）→ SA1 设计 → SA8 设计复审 → SA2 攻击评审 → SA3 TDD 实现 → 总控亲验 → SA4 静态验尸 → SA7 动态验证 → AC 门禁 → 双轴终审 → 收尾。
- **Blocked by**：#131（namespaceId/Registry identity，PR #143 已合入）、#132（replication identity/epoch，PR #145 已合入）——均已落地于当前基线。

## Issue 原文（gh api 2026-08-27 拉取）

### What to build

Expose a deep ReplicationSession Interface from NamespaceLease so trusted transports can encode state vectors and diffs, subscribe to owned updates, and apply remote Yjs updates through the existing namespace sequencer without obtaining a live Y.Doc.

### Acceptance criteria

- AC-1: NamespaceLease exposes openReplicationSession with one active session per Lease and explicit role, remote instance, lineage, and epoch binding.
- AC-2: Session provides state-vector/diff encoding, owned update subscription, trusted apply, status, and idempotent close without exposing Y.Doc, DocHandle, sequencer, or live shared types.
- AC-3: Remote apply shares the existing write sequencer and completes dirty notification before resolving.
- AC-4: Hub applies scratch-check Peer updates for SCHEMA and reserved META mutation before live apply; normal ROOT raw updates remain replication-unvalidated rather than receiving full VFSL validation.
- AC-5: Peer persistence-degraded permits only authenticated Hub-to-Peer trusted apply while ordinary business writes remain disabled.
- AC-6: One Runtime observer fans out immutable owned updates to multiple sessions and excludes the source origin without observer failures affecting committed transactions.
- AC-7: Lease release, session close, Runtime close, Registry idle/shutdown, apply races, epoch fencing, and fatal committed facts have deterministic contract tests.

## 规范依据（权威顺序）

1. `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`（NamespaceLease 与 ReplicationSession 节、Trusted raw update 与现有不变量节、SCHEMA 与 META 权限节、Persistence degraded 语义节）
2. `docs/phases/phase-5-websocket-replication.md` §实施切片 3（NamespaceLease ReplicationSession）与 §实施切片 4（Trusted apply 与角色权限）
3. `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`（唯一 write sequencer、lifecycle gate、停接纳、ADR 0008 issue #132 修订节）
4. `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md`（Lease 代理/release/idle/shutdown）
5. `CONTEXT.md`（ReplicationSession、复制未校验、Hub/Peer、复制谱系/epoch、写序列器词条）

### ADR 0010 关键冻结条款（摘录）

- `NamespaceLease.openReplicationSession(options)`：所有 Lease 可调用，不设不可伪造 capability；Host 搭建方负责只把 Lease 交给可信代码；API 文档必须明确 raw replication 绕过 VFSL 业务校验。
- 每 Lease 首版最多一个 duplex session；Session 创建时冻结 `localRole`、`remoteInstanceId`、`replicationId`、`replicationEpoch`。
- 窄能力：编码 state vector；按远端 state vector 编码 diff；订阅 owned `Uint8Array` 本地 updates；在唯一 write sequencer 中应用远端 update；查询独立复制状态；幂等 close。不暴露 Y.Doc / DocHandle / sequencer / live shared types。
- Lease release 同步停止 session 接纳；channel 关闭先关闭 session 再释放 Lease；网络状态不塞入 Runtime 业务 capability status。
- 远端 update 必须进入唯一 write sequencer：lifecycle/角色/身份/epoch gate → 必要的受保护字段检查 → 一次 `Y.applyUpdate` → Runtime observer 产出 owned update 与受控 origin → `await saveDoc(handle)` 登记 dirty → 释放 sequencer 槽。
- Hub 接收 peer update 前在 scratch clone 上确认 update 不改变 SCHEMA、不改变 META 复制身份保留字段（`replicationId`/`replicationEpoch`）；Peer 接收 hub update 时允许同步 ROOT、SCHEMA 和允许的 META 字段。该检查执行角色权限，不等同于 VFSL ROOT 校验。
- Raw apply 不做完整 VFSL ROOT 预校验；merge 后 ROOT 可能不符合当前 SCHEMA，update 仍被接受并继续复制，复制状态标记 `replication-unvalidated`；不得「先 apply 再 rollback」，不得虚假声称 zero-write。
- Runtime update observer：只交付 owned bytes + 受控 origin，不暴露 live Y.Doc；observer 失败不得回滚 transaction 或使 Runtime fatal；队列溢出只标 `needs-resync`，不阻塞 write sequencer。
- SCHEMA 只允许 hub 本地 `replaceSchema()`；peer 本地调用以稳定角色权限错误拒绝；hub SCHEMA update 正常向 peer 单向复制；`META.replicationId`/`replicationEpoch` 只能由 hub 显式复制管理操作修改。
- Hub degraded：拒绝 peer→hub raw update，保留读取/身份检查/state-vector 交换。Peer degraded：拒绝本地业务 mutation；仍允许**已认证 hub→peer session** 将 update 应用到内存；仍调用 `saveDoc(handle)` 登记（Persistence retry 保存完整 live doc）；Runtime closing/fatal 或 handle 失效时不得绕过；该 bypass 只属于创建时冻结为 `hub-to-peer` 的可信 session。

### Phase-5 文档切片 3/4 要点

- 切片 3：`openReplicationSession(options)` + 每 Lease 一个 session 生命周期；冻结 local role/remote instance/replication identity/epoch；窄能力六项；本地 transaction origin 与远端 connection/channel origin；observer failure 隔离与 `needs-resync` 通知；不暴露 Y.Doc、DocHandle、live shared type。
- 切片 4：所有远端 apply 进唯一 write sequencer 并在槽内完成 dirty notification；Hub scratch clone 检查 SCHEMA 与复制身份 META 不变；Peer 收 hub ROOT/SCHEMA/允许 META；Peer 本地 `replaceSchema()` 稳定角色权限错误；raw apply 不执行 VFSL 预校验、状态标 `replication-unvalidated`；Hub degraded 拒复制写；peer degraded 只允许 hub→peer 内存 apply 并继续 `saveDoc()`。

## 当前基线事实（总控勘察 2026-08-28）

- `packages/namespace-runtime`：十二键公共面（owner/namespaceId/read/三 getter/getStatus/mutateRoot/replaceSchema/enableReplication/bumpReplicationEpoch/close）；值导出恰一键 RuntimeWriteFatalError；`WriteSequencer`（sequencer.ts）严格 FIFO promise-chain；`replication-write.ts` 已交付 enable/bump 两管理写槽（E1–E7 槽序、共享 gate runReplicationWriteGate、readReplicationFacts 事实读取单点、REPLICATION_ID_PATTERN）；`status.ts` getStatus 八键含 replication 域；构造期 V2.5 复制事实预投影。Runtime 闭包持有 doc/handle/state/notifyDirty——session 需要的 doc 访问与 sequencer 挂接只能经包内 seam 完成。
- `packages/namespace-registry`：`NamespaceLease`（types.ts）代理 Runtime 除 close 外全部能力；`createLeaseController`（lease.ts）released 逐方法通道 + 类型级 Equal 断言锁（public alias 与 Runtime 成员逐字段相等）；lease 签发持有 `LeaseEntryRef{runtime,...}`；registry.ts Entry{phase,generation,leases,idleTimerHandle} + idle/shutdown 编排；observer.ts dispatchObserver 隔离；testing.ts 受控 testing subpath。
- `packages/replication-protocol`（#135 已交付）：纯 wire codec 包——本切片**不**依赖它（session 层不碰 envelope/消息码；wire 集成属切片 6）。
- 根 `package.json`：`pnpm test` = `vitest run --typecheck`（packages/*/test + domains/*/test，含 test-d）；`pnpm typecheck` = 10 包 tsc 链。
- 验收测试命名惯例：`<pkg>/test/*.test.ts` + `*.test-d.ts` 类型门禁；测试经包内 seam（`createNamespaceRuntimeWithSeam`）与 registry testing subpath 注入确定性依赖。
- 历史档案：`wiki/raw/task_phase5-replication-identity-epoch{,-rev1}_*`（切片 1）、`task_replication-protocol-v1-codec_*`（切片 5）。

## 边界与非目标（本切片）

- 不实现 WebSocket / 连接与 namespace 状态机 / 认证授权（切片 6/7）；
- 不实现 `resetReplica`/archive（切片 2/8）；
- 不改 `@nomicore/replication-protocol`；
- 不给 Runtime status 增加 session/网络/队列/sync 状态（session status 独立查询）；
- 不引入第二种 transport，不提前抽取 transport-independent seam；
- raw update 不做完整 VFSL 校验、不做自动 rollback（明示例外，非缺陷）。

## 验收门槛（本地 MABF 完成事务）

- 7 条 AC 逐条有实现 + 确定性契约测试证据；
- `git diff --check`、`pnpm typecheck`、全量 `pnpm test` 通过并记录命令与输出；
- 公共面纪律：namespace-runtime 值导出仍恰一键（或经设计显式裁决的新值导出）、不暴露 Y.Doc/DocHandle/sequencer/live shared types；registry 公共类型白名单纪律（结构性复制型 alias + Equal 断言）延续；
- 规范文档一致性：若新增公共 API/稳定错误词汇，CONTEXT.md/ADR 0010/phase-5 文档相应条目需核对同步（必要时设计阶段裁决增补）；
- SA4 静态验尸 pass + SA7 动态验证 pass + AC 门禁 + 双轴终审（standards/spec）无阻断。
