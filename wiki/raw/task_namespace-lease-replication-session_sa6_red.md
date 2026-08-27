# SA6 红灯锚定记录 — issue #134（Phase 5: expose trusted NamespaceLease ReplicationSession）

- **round**: 1 · **基线**: ebc5419（branch fix/issue-134-on-docs-phase-5-websocket-replication）
- **SA6 结论摘要**: 20 条运行时行为用例 + 1 个类型面文件，基线上全部真实红灯（20/20 行为红 + 类型红 2 处编译期信号）；零源码 grep 断言；零既有文件改动。红灯根因全部为「功能不存在」（openReplicationSession 方法缺席 = 特征缺失；实例角色概念缺席 = 角色锚缺失），非测试自身缺陷。

## 1. 测试文件清单（只新增）

| 文件 | 锚层面 | 用例数 |
|---|---|---|
| `packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` | 运行时行为（真实 Yjs + 真实 Runtime + 真实 Memory/File Persistence；经 Lease 集成面全链） | 20 `it()` |
| `packages/namespace-registry/test/registry-phase5-replication-session-surface.test-d.ts` | 公共类型面（vitest --typecheck 程序） | 5 探针（2 红 2 绿守卫 + 1 绿） |

未新增 Runtime 层独立文件：全部契约锚点可经 Lease 集成面真实执行（Runtime/sequencer/observer/persistence 均真实，仅随机源/scheduler/notifier 受控），与既有 red 套件先例一致；对 SA1 的包内 seam 形状（O-2）零预设。

## 2. 基线红/绿矩阵

### 2.1 行为面（`registry-phase5-replication-session-red.test.ts`）— 20/20 红

| # | 用例 | 锚 | 红灯证据（基线日志摘录） |
|---|---|---|---|
| 1 | AC-1 open 成功 + 冻结四域 | `typeof lease.openReplicationSession` 缺失 | `TypeError: asSessionLease(...).openReplicationSession is not a function` |
| 2 | AC-1 每 Lease 至多一个 session | 同上（二次 open 锚在 SA3 后生效） | 同上 |
| 3 | AC-1 released → NAMESPACE_LEASE_RELEASED | 同上 | 同上 |
| 4 | AC-2 六项能力（SV/diff/订阅/apply/status/close） | 同上 | 同上 |
| 5 | AC-2 不暴露 doc/handle/sequencer（属性探测） | 同上 | 同上 |
| 6 | AC-3 apply 与业务写共享唯一 FIFO、dirty 先于 resolve | 同上 | 同上 |
| 7 | AC-4 hub scratch 拒 SCHEMA 变更 | 同上 | 同上 |
| 8 | AC-4 hub 拒 META.replicationId 变更 | 同上 | 同上 |
| 9 | AC-4 raw ROOT 不预校验 + replication-unvalidated + 后续业务写被拒 | 同上 | 同上 |
| 10 | AC-4 peer 收 hub ROOT/SCHEMA；META 保留仍拒 | 同上 | 同上 |
| 11 | AC-5 peer-degraded：业务写禁 / hub→peer apply 允 / saveDoc 仍登记 / 内存-磁盘区分 / retry 合一 | 同上 | 同上（先导写期 create+enable+落盘全绿——既有功能零回归） |
| 12 | O-5(a) hub-degraded 拒 peer→hub apply；读/SV 保留 | 同上 | 同上 |
| 13 | O-5(b) peer 本地 replaceSchema → 稳定角色权限错误；enable/bump hub-only | 实例角色概念缺席 | `AssertionError: expected true to be false`（基线无角色 → replaceSchema 成功） |
| 14 | AC-6 多 lease 多 session fan-out + 回声抑制 + 字节快照 | `openReplicationSession` 缺失 | TypeError 同上 |
| 15 | AC-6 observer 抛错隔离（提交不回滚/不 fatal/扇出不断） | 同上 | 同上 |
| 16 | AC-7 Runtime close（shutdown）→ apply RUNTIME_WRITE_DISABLED | 同上 | 同上 |
| 17 | AC-7 epoch fencing（冻结不漂移 / bump 后 fenced / 新 session 正常） | 同上 | 同上 |
| 18 | AC-7 idle 复用（release 后 idle 窗口 open 复用同一 Runtime） | 同上 | 同上 |
| 19 | AC-7 fatal committed facts（notify 失败 → RuntimeWriteFatalError committed:true） | 同上 | 同上 |
| 20 | AC-7/AC-2 FilePersistence 重启后 SV 逐字节一致 + apply 可用 | 同上 | 同上 |

> 用例 13（O-5b）红灯根因 = 基线无实例角色注入概念（`createNamespaceRegistryForTesting` overrides 的 `role` 键被忽略 → replaceSchema 照常成功）。该用例先于任何 session 调用即红——与「功能不存在」属同一语义级。

### 2.2 类型面（`registry-phase5-replication-session-surface.test-d.ts`）— 红 2 处（编译期信号）

| 探针 | 基线证据 | 机制 |
|---|---|---|
| `ReplicationSession` 自 package 导出 | `TypeCheckError: Module '@nomicore/namespace-registry' has no exported member 'ReplicationSession'` | 任务简报允许的「导入即编译失败」级类型红 |
| `NamespaceLease.openReplicationSession` 存在 + Promise/ok 通道 | `TypeCheckError: Type 'true' is not assignable to type 'never'` | 条件类型 `HasOpenReplicationSession<NamespaceLease>` 基线求值 `never`（方法缺席）→ TS2322 |
| 绿守卫（SA3 后生效）：ReplicationSession 键集含冻结四域+六能力（`HasSessionCaps`=true）；键集不含 doc/handle/sequencer/runtime/ydoc/sharedTypes（`HasForbiddenRefs`=false）；Lease 无裸 raw apply 旁路（`HasLeaseRawApply`=false） | 基线不可判定（文件在导入处即红） | — |

### 2.3 既有测试零回归

- 全量 `pnpm test`（资源受限池：forks=1/1 + timeout 60s，后台执行）实测：`Test Files 2 failed | 135 passed (137)`、`Tests 21 failed | 1628 passed (1649)`——失败全部为新增两个文件的红灯信号（行为 20/20 + 类型面 2 处），**既有 135 文件 1628 用例全部通过（零回归）**；详见 §5。
- `git diff --check`：干净；`git status`：仅新增两个测试文件（加 wiki 记录）。

## 3. 契约锚点逐条（AC ↔ 测试 ↔ ADR 条款）

| 契约 | ADR/文档锚点 | 测试锚（行为断言要点） |
|---|---|---|
| AC-1 open 存在、每 Lease 至多一 session、冻结四域 | ADR 0010 L73–81；切片 3 L69–70 | ① open 成功 → session.localRole/remoteInstanceId/replicationId/replicationEpoch 与实例角色、远端 ID、status 投影事实一致；② 二次 open 行为可区分（幂等同对象 or 拒绝；绝无第二个可 apply 的 session）；③ released lease → `{ok:false, code:'NAMESPACE_LEASE_RELEASED'}`（O-3 通道表增补，冻结码） |
| AC-2 六项窄能力 + 不暴露 | ADR 0010 L81–88；切片 3 L71–73；runtime AGENTS.md | encodeStateVector 与 `Y.encodeStateVector(liveDoc)` 逐字节一致；encodeDiff 重放写前副本得 n=8；订阅字节重放得 ext=7、unsubscribe 后停投；apply 后 live 可见；getStatus 对象 + raw 后含 `replication-unvalidated`（冻结词）；close 幂等（两次结算同值）+ close 后 apply 非 ok 零写入；Object.keys/属性探测无 doc/handle/sequencer/runtime/ydoc/sharedTypes |
| AC-3 唯一 sequencer + 槽内 dirty | ADR 0010 L96–103；ADR 0008 L36/L45；CONTEXT 写序列器 | 提交序 [apply(k1=1), 业务写(n=9), apply(k2=2)] → saveEvents 快照序 [k1=1/n=42, k1=1/n=9, k1=1/k2=2/n=9]（唯一 FIFO 证据）；apply A resolve 时其 saveDoc 已登记（dirty 先于 resolve） |
| AC-4 scratch + raw 语义 | ADR 0010 L105/L107/L115–121；切片 4 L78–81 | hub 对 SCHEMA 变更 update：整体拒绝、SCHEMA/ROOT 零写入、saveDoc 0、重复拒绝稳定；META.replicationId 变更：拒绝、保留字段零写入；ROOT 违反 schema 类型（ext='zzz'）：仍接受 ok:true + `replication-unvalidated` 标记 + 后续业务写被拒零写入；合法 raw 同样标记（从不 VFSL 预校验）；peer 收 hub：SCHEMA.note/ROOT.ext 新键允许、META 保留仍拒 |
| AC-5 peer degraded 只允许 hub→peer trusted apply | ADR 0010 L131–139；ADR 0006 #79；切片 4 L82 | 真实 MemoryPersistence 磁盘两阶段（writer 落盘 → main 打开）：degraded 后业务写 `RUNTIME_WRITE_DISABLED`（冻结码）+ 零写入；hub→peer session apply ok:true、内存更新（ROOT.ext=7）、saveDoc 仍计数（#79 degraded 非拒绝理由）；磁盘 reader 无 ext（内存/磁盘可区分）→ 恢复后 retry 落盘合一；session status 含内存面词汇（待冻结） |
| AC-6 fan-out / 回声抑制 / observer 隔离 | ADR 0010 L109–113；切片 3 L72–73；ADR 0007 L54（T-2 和解） | 同 namespace 双 Lease 双 session：本地写两者均投（字节重放 n=7）；apply@A → A 不投（排除源 origin）、B 投（字节重放 ext=7）；已交付字节突变不影响 live；订阅回调抛错 → 写仍 ok:true、status.fatal null、B 仍收到后续写（无泄漏、扇出不断） |
| AC-7 生命周期/竞态/fencing/fatal | ADR 0010 L53/L55/L90/L98/L136/L179；ADR 0009 L42–44/L48–50/L99–101；ADR 0008 #132 L136 | shutdown → apply 非 ok + `RUNTIME_WRITE_DISABLED` + 零写入；epoch 冻结不漂移（session1.replicationEpoch=1 且 bump 后仍 1）→ 旧 session apply fenced 零写入 → 新 session(epoch=2) apply 成功；idle 窗口 open 复用（新 lease 新 session 观察到旧写状态）；apply 的 notify 失败 → `RuntimeWriteFatalError.committed===true` + ext=7 事实保留 + 后续写禁 + 读取保留；FilePersistence 重启后新 session SV 与重启前逐字节一致 + apply 可用 |
| O-5(a) hub degraded 拒 peer→hub apply | ADR 0010 L125–129 | degraded hub：apply 非 ok 零写入；read 保留；encodeStateVector 与 live 一致（SV 交换保留）；session 冻结身份未被降级破坏 |
| O-5(b) peer replaceSchema 稳定角色权限错误 | ADR 0010 L118/L120；切片 4 L80 | peer 实例 replaceSchema 两次均 ok:false 且 JSON 逐字节相同（稳定）、SCHEMA 载体完整、ROOT 业务写不受影响；enable/bump hub-only（ok:false）；hub 对照 replaceSchema ok:true |

## 4. 运行命令（红灯验证）

```bash
# 行为面（20/20 红；exit code 1）——输出 .mabf-bg/sa6-session-red.log
pnpm vitest run packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts
# 类型面（Type Errors 1 failed：2 处编译期红）——输出 .mabf-bg/sa6-session-td.log
pnpm vitest run --typecheck packages/namespace-registry/test/registry-phase5-replication-session-surface.test-d.ts
# 全量（资源受限池；预期仅新增文件红灯信号）——输出 .mabf-bg/sa6-full-test.log
pnpm test --pool=forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 --testTimeout=60000 --hookTimeout=60000
```

baseline `pnpm typecheck`（10 包 tsc，仅 src）——本机实测复跑 exit 0（`.mabf-bg/sa6-typecheck.log`，测试文件仅入 tsconfig.typecheck.json 的 vitest 程序，不进各包 tsconfig）；tsconfig.typecheck.json 程序内 `.test.ts` 已保证零类型噪声（行为文件 Type Errors: no errors）。

## 5. 全量结果（后台作业，已完成）

- 命令：`pnpm test --pool=forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 --testTimeout=60000 --hookTimeout=60000` → `.mabf-bg/sa6-full-test.log`（exit code 1，预期）
- 结果：`Test Files  2 failed | 135 passed (137)`；`Tests  21 failed | 1628 passed (1649)`；`Type Errors  1 failed`
- **失败清单 = 仅新增两个文件**（`replication-session-red.test.ts` 20 用例全部灯红 + `replication-session-surface.test-d.ts` 类型红 2 处）；**既有 135 个测试文件 1628 用例全部通过 → 零回归**。exit 1 即本阶段验收信号（红灯锚定），非回归。
- 行为文件红灯形态：19 例 `TypeError: asSessionLease(...).openReplicationSession is not a function`（特征缺失）+ 1 例（O-5b 角色锚）`AssertionError: expected true to be false`（基线无实例角色概念 → peer replaceSchema 照常成功）。
- 类型文件红灯形态：`Module '@nomicore/namespace-registry' has no exported member 'ReplicationSession'`（导入即编译失败级）+ `Type 'true' is not assignable to type 'never'`（openReplicationSession 条件探针求值 never）。
- 单文件红灯命令（快速复验）：
  - `pnpm vitest run packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` → 20/20 红（`.mabf-bg/sa6-session-red.log`）
  - `pnpm vitest run --typecheck packages/namespace-registry/test/registry-phase5-replication-session-surface.test-d.ts` → Type Errors 1 failed（`.mabf-bg/sa6-session-td.log`）

## 6. 待设计冻结的稳定词汇清单（SA6 建议名；SA1 设计可裁决改名，行为契约不变）

### 6.1 已冻结词汇（测试已按冻结词锚定）
- `NAMESPACE_LEASE_RELEASED`（types.ts 冻结码；released lease 的 openReplicationSession 通道）
- `RUNTIME_WRITE_DISABLED`（errors.ts 冻结码族；闭环 write gate 拒绝）
- `replication-unvalidated`（ADR 0010 L107 / CONTEXT 复制未校验——raw 后 session status 必须携带）
- `RuntimeWriteFatalError` / `committed`（既有公开值导出）

### 6.2 SA6 建议、待 SA1 冻结的词汇与形状
| 项 | SA6 建议 | 依据 | 备注 |
|---|---|---|---|
| 能力方法名 | `encodeStateVector()` / `encodeDiff(remoteStateVector)` / `subscribeOwnedUpdates(listener): () => void` / `applyRemoteUpdate(bytes)` / `getStatus()` / `close()` | ADR 0010 L83–88 概念清单（名字未冻结） | 测试已按此名调用；SA1 改名单需同步测试 |
| open 输入 | `{ localRole: 'hub'\|'peer'; remoteInstanceId: string }` | ADR 0010 L81 冻结四域中两域；replicationId/epoch 取自 Runtime 投影链（SA8 T-6/O-7——非调用方输入） | SA1 可增字段（测试仅传此处两域） |
| open 结果 | `Promise<{ok:true; session} \| {ok:false; code; message}>` | O-3：一切拒绝经返回 Promise 结算（released 通道已按冻结码锚定） | 与既有 lease 写面同构 |
| 实例角色注入点 | `createNamespaceRegistryForTesting` overrides `role: 'hub'\|'peer'`（生产工厂对应选项待 SA1 定形） | O-4 | 行为契约与注入机制分离：改机制不改断言 |
| 冻结四域查询面 | session 只读属性 `localRole` / `remoteInstanceId` / `replicationId` / `replicationEpoch` | ADR 0010 L81 | SA1 可改由 status 域承载（测试需同步）；冻结值不随 bump 漂移已被锚定 |
| 二次 open 拒绝形状 | 未锚定具体码（允许幂等同对象/ok:false/reject 三形态之一） | O-9 | 行为可区分锚；建议码 `REPLICATION_SESSION_EXISTS`（待冻结） |
| session close 后 apply 拒绝 | 未锚定具体码（行为：非 ok、零写入） | — | 建议 `REPLICATION_SESSION_CLOSED`（待冻结） |
| release 后既有 session 语义 | 未锚定（O-9：自动 close vs 仅拒新操作——设计裁决） | 切片 3 L69 | 本套件只锚「release 后 openReplicationSession → NAMESPACE_LEASE_RELEASED」 |
| epoch fence 拒绝码 | 未锚定具体码（行为：非 ok、零写入） | ADR 0010 L53/L55/L98；O-8 | 建议沿用 `RUNTIME_WRITE_DISABLED` 族或 `REPLICATION_EPOCH_CONFLICTED`（待冻结） |
| degraded 拒绝码（hub 拒 peer→hub） | 未锚定具体码（行为：非 ok、零写入；读/SV 保留） | O-1 | O-1 明确「RUNTIME_WRITE_DISABLED 码族是否复用」待裁决 |
| peer replaceSchema 角色错误码 | 未锚定具体码（行为：ok:false + 两次调用 JSON 逐字节相同 + SCHEMA 零变化） | O-4 | 建议 `REPLICATION_ROLE_PERMISSION`（待冻结）；错误形状（ReplaceSchemaIssue 扩展 or 新码）待设计 |
| 内存/磁盘区分词汇 | session status 含内存面标记（测试以 `/memory/i` 正则锚定 status 输出） | ADR 0010 L139「不得声称 durable」 | 建议 `memory-caught-up` / `disk-lagging`（或布尔域 `memoryCaughtUp`/`diskCaughtUp`）；SA1 冻结后建议改精确断言 |
| `needs-resync` | 未锚定（队列/背压形状属切片 6；O-10/O-11） | ADR 0010 L113 | 列为切 6 验收项，本切片不锚 |
| 允许 META 白名单 | 未锚定（首版空集与否） | O-12 | 保留字段（replicationId/replicationEpoch）双向不可 raw 改已被锚定（L120，稳固条款） |
| scratch-check 判据 | 未锚定判据细节（(a) 内容投影 (b) 零操作 (c) 字节级） | O-12 | 测试锚「行为结果」：变更即拒、不变即允——判据任选其一均满足 |
| disabled 命名空间 open 行为 | 未锚定 | O-7 | 建议设计裁决后补锚 |

## 7. 设计与实现注意事项（SA1/SA3 交接）

1. **测试契约即建议面**：§6.2 全部为 SA6 对 ADR 未冻结点的建议形状；SA1 可裁决改形，但须同步本测试（或经设计文档说明偏离，SA4/双轴终审裁决）。
2. **确定性 Yjs 纪律**：所有「远端 update」只写新键（Yjs 并发键胜者按随机 clientID 决胜——写既有键产生不可确定结果）；快照重放同 clientID 无冲突。SA3 若模拟远端 update 也必须遵守（可直接复用本文件 `makeRemoteUpdate` 模式）。
3. **角色注入至少覆盖**：peer 本地 replaceSchema 拒绝、peer enable/bump hub-only、peer session 收 hub ROOT/SCHEMA、hub session scratch-check、peer degraded bypass 方向性——即 §3 表 O-5(b)+AC-4/AC-5 全部适用面。
4. **degraded 矩阵已锚定磁盘两阶段**：writer（hub）落盘 → main（被测角色）从真实磁盘字节 round-trip 打开——SA3 无须额外的「种子」设施，真实 Persistence 路径已可驱动。
5. **observer 隔离**：fan-out observer 必须自捕获全部回调异常（T-2 和解条件）——测试以「抛错回调 + 事务仍 ok + status.fatal null + 另一 session 仍收」锚定。
6. **每 Lease 一 session 的幂等/拒绝二选一**：测试允许两者，但「第二个独立可 apply 的 session」必须不存在。
7. 本记录不修改任何 src/ 与既有测试文件（`git status` 仅新增测试 + wiki 记录）。

---

# R2 修复记录（SA3 实现落地后 回流 SA6 — 8 项测试口径缺陷修复）

- **背景**：SA3 实现提交 `666f9b1`（Phase 5 切片 3/4 expose trusted ReplicationSession）后，SA6 红文件 13/20 行为绿 + 5/5 类型绿；剩余 7 行为红 + 1 类型红经 SA3 诊断（`wiki/raw/task_namespace-lease-replication-session_sa3_impl.md` §5）与总控独立复核，确认为 **SA6-owned 测试口径缺陷**（实现侧无可修面）。本轮仅修改 SA6 自己的两个测试文件；基线语义与锚定强度逐项保持。

| # | 用例 | 缺陷机理 | 修复 | 修复后证据 |
|---|---|---|---|---|
| 1 | AC-3 FIFO（`saveEvents[0]` 绝对索引 / `length===3`） | `saveEvents` 绝对计数漏计 enable 的既有 E6 notify（#132 基线测试自身断言 enable 后 `toHaveLength(1)`——registry-phase5-replication-red.test.ts L332）；实测事件序 [enable, applyA, write, applyB] | 断言基准化：`const saveBaseline = stub.saveEvents.length`（enable 之后、session 阶段之前）→ `length === saveBaseline + 3`、按 `saveBaseline` 偏移取值（FIFO 相对序契约不变，语义未削弱） | 行为文件 20/20 绿 |
| 2 | AC-4 hub scratch 拒 SCHEMA（`length===0`，实际 1） | 同 #1（基准 = enable 1 条） | `saveBaseline` 基准化 → `length === saveBaseline`（拒绝路径零新增——语义不变） | 同上 |
| 3 | AC-4 hub 拒 META.replicationId（`length===0`） | 同 #1 | 同上 | 同上 |
| 4 | AC-4 raw ROOT（`length===1` / 第二次 apply 后无断言） | 同 #1；第二次 apply 前未重新取基准 | 首次 apply：`length === saveBaseline + 1`；第二次 apply 前 `saveBaseline2 = length` → `length === saveBaseline2 + 1`（每次 apply 恰登记一次 dirty——语义不变） | 同上 |
| 5 | AC-5 peer degraded 磁盘断言行（`diskAfter.ext===7` 实际 undefined） | MemoryPersistence 活单元缓存：同实例第二次 `loadDoc` 命中 live cell 返回旧解码 doc（lifecycle.ts L177，总控已核实）——step 4 首读句柄未 release | ① 首读后 `await diskFirst?.release()`；② step 5 改用 fixture 新方法 `freshReader()`（读取同一 store 的全新 MemoryPersistence 实例——必然重读 store）。内存/磁盘区分断言语义不变 | 同上 |
| 6 | AC-7 epoch fencing（`length===0`，实际 2） | 基准 = enable 1 + bump 1（两者 E6 均 notify） | fence 前 `const saveBaseline = stub.saveEvents.length` → `length === saveBaseline`（fenced 零新增——语义不变） | 同上 |
| 7 | AC-7/AC-2 File 重启（`first.persistence.dispose is not a function`） | `DocCapturingPersistence` fixture 未转发底层 `dispose`（#132 同型场景直接用 FilePersistence 实例，未包包装类） | fixture 增 `async dispose()` 透传 inner（沿本文件 `CountingDocPersistence.dispose` 先例——纯测试助手面，零业务语义） | 同上 |
| 8 | 类型红（released lease 用例 `result.code`） | 真实类型落地后 `asSessionLease(lease)` 交集方法签名解析为真实 `OpenReplicationSessionResult`：ok:true 分支无 `code`，非窄化访问即 TS 红 | ok 判别优先：`if (result.ok) throw` 后再 `expect(result.code)`（窄化后断言；运行时行为与锚定码不变） | 类型面 5/5 绿（连同 phase5-replication-surface 共 11/11 探针绿） |

**修复纪律**：仅改 `packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` 与 `registry-phase5-replication-session-surface.test-d.ts`（后者本轮零改动）；零 src/ 改动；无断言语义削弱（相对序/零新增/恰一次/内存-磁盘区分/锚定码全部保持）。

**修复后三档绿灯证据**：

| 档位 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 单文件行为 | `pnpm vitest run packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` | **20/20 绿**，Type Errors: no errors，exit 0 | `.mabf-bg/sa6-fix-behavior.log`（exit 0） |
| 类型面 | `pnpm vitest run --typecheck packages/namespace-registry/test/registry-phase5-replication-session-surface.test-d.ts packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts` | **11/11 绿**（session 5 + replication-surface 6），Type Errors: no errors，exit 0 | `.mabf-bg/sa6-fix-typecheck.log`（exit 0） |
| 全量 | `pnpm test --pool=forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 --testTimeout=60000 --hookTimeout=60000` | **Test Files 138 passed (138)；Tests 1679 passed (1679)；Type Errors: no errors**；exit 0 | `.mabf-bg/sa6-fix-full.log`（exit 0） |

`git diff --check` 干净；本轮修改仅限 SA6 两个测试文件 + 本记录（`git status` 无 src/ 改动）。
