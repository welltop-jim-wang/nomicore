# SA6 红灯锚定记录 — Phase 5: enable replication identity and epoch management

- **Issue**: #132（welltop-jim-wang/nomicore）
- **任务类型**: 功能开发（feature）
- **分支**: fix/issue-132-on-docs-phase-5-websocket-replication
- **Worktree**: /home/wangjian/nomicore-fix-issue-132
- **阶段**: Phase 1 验收锚定（AC-1..AC-6 → 红灯验收测试）
- **日期**: 2026-08-27（run_id issue-132-1787809226-3529662, round 1）

## 结论摘要

基线实现 = 无任何复制管理面：`NamespaceLease` 无 `enableReplication()` /
`bumpReplicationEpoch()`；META 无 `replicationId`/`replicationEpoch` 保留字段；
`getStatus()` 无 `replication` 域。SA6 编写 2 个验收测试文件（14 条运行时行为用例
+ 6 条类型面检查），**全部 18 条红灯锚在基线上真实失败**（14/14 运行时红、4/6 类型红
——另 2 条为保持性守卫、基线即绿）；现有全套既有测试保持全绿（本次未触碰任何 src/
与既有测试文件；`packages/namespace-registry/test` 全目录 192 例既有用例全部通过）。
测试全部锚定可观察运行时行为或类型契约，**零源码 grep 断言**。

## 测试文件清单

| 文件 | 类型 | 用例数 | 基线状态 |
|---|---|---|---|
| `packages/namespace-registry/test/registry-phase5-replication-red.test.ts` | 运行时行为（vitest；真实 Runtime + 真实 Yjs + 真实 Memory/File Persistence，仅随机源/调度器/IO hook 受控） | 14 | 14/14 红 |
| `packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts` | 类型面契约（`pnpm test` 的 `--typecheck` 段） | 6 | 4 红 + 2 绿（保持性守卫） |

新增能力/依赖：无（未新增测试包、未新增端口依赖；`scripts/test-lock.sh` 无需更新）。
测试运行命令（标准链）：`pnpm test` / `pnpm vitest run packages/namespace-registry/test/...`。

## 契约锚点（SA6 锁定，SA1/SA3 需按此落位）

1. **Lease 复制管理操作**（ADR 0010 冻结名；Lease 是调用方唯一能力入口，ADR 0009）：
   - `lease.enableReplication(): Promise<Readonly<{ ok: boolean }>>`——启用时 `ok:true`；
     重复启用允许幂等 `ok:true` **或** 稳定文档化结果（AC-3 允许二选一，本套件只锚定
     不变式：结算不抛、身份不变）；
   - `lease.bumpReplicationEpoch(): Promise<Readonly<{ ok: boolean }>>`——成功 `ok:true`；
     overflow 领域拒绝以 `ok:false` 结算（结果面拒绝，绝不回绕）；写管线 internal fatal
     以 `RuntimeWriteFatalError` rejection（沿用 ADR 0008 committed 事实纪律）。
2. **status 复制域**（AC-5；`NamespaceRuntimeStatus` 与 registry 侧
   `NamespaceLeaseStatus.active.runtime` 投影——即 `NamespaceRuntimeStatusProjection`
   必须**同时**新增，二者同构）：
   ```ts
   readonly replication:
     | Readonly<{ state: 'disabled' }>
     | Readonly<{ state: 'enabled'; replicationId: string; replicationEpoch: number }>;
   ```
   - 未 enable → `{state:'disabled'}`；enable 后 → `{state:'enabled', replicationId, replicationEpoch:1}`；
   - 「identity change」判别面 = 两次读取的值比较（身份/epoch 任一变化可观测），
     **不是**新枚举态——SA1 若采用独立 `changed` 态亦可满足本套件（值判别面不变）；
   - 状态对象每次调用全新、深冻结各级（含 replication 子对象），突变不逃逸。
3. **META 保留字段格式**（ADR 0010 冻结；经 `lease.getMetadata()` 深拷贝投影）：
   - `replicationId`：string，`/^[0-9a-f]{32}$/`（32 位小写 hex），≠ namespaceId、
     ≠ SCHEMA 信封 `id`；
   - `replicationEpoch`：safe integer，从 1 开始（`Number.isSafeInteger`，
     `Number.MAX_SAFE_INTEGER` 时拒绝提升不回绕）；
   - 未启用命名空间：两键缺席（field 键不存在）。
4. **enable 原子安装 + dirty**（AC-2）：单槽单次 Yjs transaction 同时写入两字段；
   槽序 = 提交 → `notifyDirty`（ADR 0008），故 **saveDoc/notifyDirty 被调用时刻
   META 已同时含两字段**（本套件经 stub saveDoc 的通知时刻快照观测——原子性与
   dirty 登记的合并可观测面）；每槽恰一次 dirty 通知。
5. **sequenced**（AC-2/AC-4）：enable/bump 与全部受控写共享唯一 write sequencer——
   并发 `[enable, bump, bump]` 的通知序恒为 `[epoch1, epoch2, epoch3]`（接纳序 =
   完成序，FIFO）。
6. **Hub-only 独占写面**（AC-4）：`META.replicationId/replicationEpoch` 只能经
   Lease 两个显式复制管理操作修改；普通业务写（mutateRoot / replaceSchema）对复制
   字段 zero-touch；经 `mutateRoot` 以 `['META','replicationEpoch']` 路径触达 →
   领域拒绝零写入；类型面无通用 META 写面（无 setMetadata/writeMetadata/mutateMeta/
   rawUpdate）。peer 角色拒绝属后续切片（ReplicationSession/trusted apply 角色权限），
   本票无可观测角色面——独占写面即本票可锚定的 Hub-only 语义。
7. **fatal/committed 事实**（AC-4）：notify-dirty 失败 → `RuntimeWriteFatalError`
   rejection 且 `committed: true`；META 已反映提升后的 epoch（事实保留，不回滚）；
   `status.fatal` 非 null；后续一切写（再 bump / mutateRoot）→
   `RUNTIME_WRITE_DISABLED` 零写入；读取与 getMetadata 保留。
8. **degraded / retry / 恢复**（AC-6，沿 ADR 0006 #79 / #102 语义）：
   writable gate 瞬时观察通过后降级 → enable 成功提交；后续 bump 被 gate 拒绝
   （`RUNTIME_WRITE_DISABLED`，零写入）；I/O 恢复后持久层 retry 覆盖最新完整 live
   doc（含已提交身份），全新实例 loadDoc 恢复身份与最新 epoch。
9. **close 竞态**（AC-6）：enable 已接纳后 close（本套件经 registry.shutdown 驱动
   runtime close）不取消——已接纳任务无条件排空，身份提交 + dirty 登记仍发生，
   close 结算后可经持久化恢复。
10. 随机纪律：replicationId 由受控 128-bit CSPRNG 生成（注入式，禁全局 fallback，
    ADR 0009 修订节 3）——生成源注入位置属 SA1 设计；本套件**不做**随机源消耗计数
    锚定（只锚定格式、单一性、不可变性——捕获对比，不预设值）。

## AC → 测试用例映射

### AC-1 META 保留并投影 replicationId / replicationEpoch（ADR 0010 冻结格式）

- [红] `AC-1 … > 未 enable 时 META 无复制字段、status 为 replication-disabled；enable 后两字段以冻结格式投影`
  （基线上 `enableReplication is not a function` 红；绿判链：格式 regex / 长度 32 / safe
  integer / ≠namespaceId / ≠SCHEMA id / status 与 META 值一致。）
- [红] `AC-1 … > 未启用命名空间：META 无 replicationId/replicationEpoch 键，status 判别为 disabled（AC-5 判别面）`
  （基线红：`expected undefined to deeply equal { state: 'disabled' }`——status
  replication 域缺席。）
- [红·类型] `surface.test-d.ts > 类型面：status 复制域（AC-5） > NamespaceRuntimeStatus（runtime 包）暴露 replication 复制域`
- [红·类型] `同左 > NamespaceLeaseStatus.active.runtime（即 registry 包 Lease status 投影）暴露同款复制域`

### AC-2 enableReplication 原子安装 128-bit 身份 + epoch 1（sequencer + dirty）

- [红] `AC-2 … > enable 成功：通知时刻 META 已含身份+epoch 1（同槽原子），saveDoc 恰一次，status 同步 enabled`
  （saveEvents[0] 同时含两字段 = 原子安装的可观测面；saveDoc 恰 1 次 = dirty 登记。）
- [红] `AC-2 … > 并发 enable×2 + bump×2 与唯一 sequencer 同序：通知序 [1,2,3]、monotonic、单一身份不漂移`
  （FIFO 序 = 通知序；最终 epoch 3；全程单一 replicationId。）
- [红·类型] `surface.test-d.ts > 类型面：Lease Hub 复制管理操作（AC-2/AC-3/AC-4，ADR 0010 冻结名） > NamespaceLease 暴露 enableReplication(): Promise<{ok:boolean}>`

### AC-3 重复 enable 幂等/稳定文档化结果，不改变身份

- [红] `AC-3 … > 二次 enable：结果稳定、身份不变、epoch 不重置；bump 后再 enable 亦不重置 epoch`
  （锚定不变式：结算不抛 + replicationId 恒同 + epoch 不回置 1（bump 到 2 后再 enable
  仍 2）。）

### AC-4 bumpReplicationEpoch：Hub-only、sequenced、monotonic、overflow 拒升、committed/fatal 事实

- [红] `AC-4 … > bump monotonic：epoch 2→3 递进、身份不变、status 同步；普通 ROOT/SCHEMA 写 zero-touch 复制字段`
  （含 Hub-only 独占面：3 笔普通写后复制字段不变；`['META','replicationEpoch']`
  路径触达 → 领域拒绝零写入。）
- [红] `AC-4 … > overflow：epoch 达 Number.MAX_SAFE_INTEGER 拒绝提升、绝不回绕`
  （预启用种子文档（META 已带合法身份 + MAX）→ open 即 status enabled（AC-1 投影面）；
  bump → `ok:false`，epoch 保持 MAX，身份不变。）
- [红] `AC-4 … > overflow 边界：MAX-1 → bump 成功至 MAX → 再 bump 拒绝，epoch 保持 MAX`
- [红] `AC-4 … > fatal 事实：notify-dirty 失败 → RuntimeWriteFatalError committed:true；META 已提升（事实保留）；后续写 RUNTIME_WRITE_DISABLED；读取保留`
  （notifier 经可切换接缝注入真实 Runtime（createNamespaceRuntimeForRegistry）；
  committed:true 且 META epoch=2（不回滚）；status.fatal 非 null；再 bump/mutateRoot
  零写入；read 保留。）
- [红·类型] `surface.test-d.ts > … > NamespaceLease 暴露 bumpReplicationEpoch(): Promise<{ok:boolean}>`

### AC-5 Open/Runtime status 区分 disabled/enabled/identity change；无 mutable META 引用

- [红] `AC-5 … > 判别面：disabled → enabled(id,epoch1) → bump 后 epoch 变而身份不变（可比较判别演进）`
- [红] `AC-5 … > status 每次调用为新鲜对象、值稳定，对象突变不逃逸（无 mutable META 引用）`
  （getStatus 每次新对象；status.replication 突变探针（冻结抛错或赋值后不影响后续）；
  getMetadata 深拷贝突变不逃逸。）

### AC-6 测试覆盖（并发 enable/bump、degraded、close/fatal 竞态、retry、Memory/File 恢复）

- [红] `AC-6 … > close 竞态：enable 已接纳后 close（registry shutdown）——enable 排空成功、身份经真实持久化恢复`
  （真实 MemoryPersistence 编码/解码全链；新 Registry 实例 loadDoc 恢复身份 epoch 1。）
- [红] `AC-6 … > persistence-degraded：gate 通过后降级——enable 成功、后续 bump 被 RUNTIME_WRITE_DISABLED 拒绝零写入；恢复后 retry 覆盖、bump 成功；Memory 恢复可见`
  （真实 MemoryPersistence + 可失败 writeSnapshot hook；degraded 位（rootWrite/
  schemaWrite 关、read 开）；恢复后 retry 覆盖含身份；新实例恢复 identity+epoch 2。）
- [红] `AC-6 … > FilePersistence 全链：create → enable → flush → 重启（同 rootDir）→ open 恢复身份与 epoch`
  （真实 FilePersistence 磁盘快照；重启后 META 身份 + status enabled。）
- 并发 enable/bump：AC-2 第二用例（[enable,bump,bump] FIFO）+ AC-2 第一用例
  （enable 原子）覆盖。
- [绿（保持性守卫）] `surface.test-d.ts > … > NamespaceLease 无 setMetadata/writeMetadata/mutateMeta/rawUpdate 成员`
- [绿（保持性守卫）] `surface.test-d.ts > … > NamespaceLease 无 doc/handle/runtime 原始引用成员`

## 红灯运行证据摘要（基线 HEAD `7425164 Phase 5: generate namespaceId and migrate Registry identity (#143)`）

锚定前基线全绿（`packages/namespace-registry/test` 全目录 192 例既有用例通过）。

锚定后实测（独立进程，全部 exit 1）：

1. `pnpm vitest run --typecheck packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts packages/namespace-registry/test/registry-phase5-replication-red.test.ts`
   → **exit 1；18 失败 | 2 通过；Type Errors 4 failed；0 unhandled source errors**。
   失败签名三型：
   - 10 例：`TypeError: asRepLease(...).enableReplication / rep.enableReplication /
     rep.bumpReplicationEpoch is not a function`——复制管理操作整体缺失；
   - 2 例：`expected undefined to deeply equal { state: 'disabled' }`——status
     replication 域缺席；
   - 1 例：`Cannot read properties of undefined (reading 'state')`——预启用种子文档
     场景 status 域缺席；
   - 类型轴 4 红：`Type 'true' is not assignable to type 'never'` ×4（Lease 双方法
     缺席；RuntimeStatus 复制域缺席；LeaseStatus.active.runtime 复制域缺席）；
   - 2 绿：无通用 META 写面 / 无原始引用（保持性守卫）。
2. `pnpm vitest run --typecheck packages/namespace-registry/test`（整目录回归）
   → **exit 1；2 failed | 16 passed（files）；18 failed | 192 passed（tests）**——
   全部既有用例绿（零回归，仅 18 条新增红灯），无超时、无挂起、无 unhandled
   rejection（stub/真实 persistence 全确定性驱动，零 real-sleep）。

**门禁结论**：红灯真实、可稳定复现——当前实现确实不含复制身份/epoch 管理面，与
AC-1..AC-6 不符；不存在「绿灯假红」或无法复现情形，流水线可继续进入 SA1 设计 /
SA3 实现。

## SA3 实现后的绿判标准（供复核）

- 14 条运行时用例全部转绿：enable 安装身份+epoch 1（格式/≠nsId/≠schemaId/原子
  通知序/saveDoc 恰一次）；未启用 META 无字段 + status disabled；并发
  [enable,bump,bump] 通知序 [1,2,3] 单一身份；重复 enable 身份不变 epoch 不重置
  （含 bump 后）；bump monotonic + 普通写 zero-touch + META 路径触达拒绝；
  overflow MAX 拒升不回绕（含 MAX-1 边界）；notify-dirty 失败
  RuntimeWriteFatalError committed:true + META 已提升 + RUNTIME_WRITE_DISABLED +
  读取保留；disabled→enabled→bump 判别链；status/getMetadata 突变不逃逸；
  close 竞态排空 + Memory 恢复；degraded gate + retry 覆盖 + Memory 恢复可见；
  FilePersistence 重启恢复。
- 4 条类型锚转绿：Lease 暴露 enableReplication/bumpReplicationEpoch
  （Promise<{ok:boolean}>）；NamespaceRuntimeStatus 与
  NamespaceLeaseStatus.active.runtime 均含 replication 复制域。
- 2 条保持性守卫持续绿：Lease 无通用 META 写面、无 doc/handle/runtime 原始引用。
- 既有测试保持全绿。

## SA1/SA3 对齐提示（防误解）

- **实现位置**：锚在 `NamespaceLease`（ADR 0009「Lease 是调用方唯一能力入口」+ ADR 0010
  命名）。Runtime 侧的内部写路径与随机源注入位置属 SA1 设计；若 SA1 选择 Runtime 层
  方法（经 lease 代理），本套件不改——Lease 面即验收面。
- **状态值**：本套件只锚定 `state: 'disabled' | 'enabled'` 判别 + 两事实值；若 SA1
  增加独立 `changed` 状态作为 AC-5「identity change」的显式表达，判别面用例无需修改
  （比较语义兼容），类型锚的联合需在实现时同步扩并回流本记录。
- **重复 enable 结果形状**：AC-3 允许幂等 `ok:true` 或稳定文档化结果；两实现方向
  均与本套件兼容（不变式锚定）。
- **overflow 拒绝通道**：锚定为结果面 `ok:false`（写域失败经结果联合的仓库既有
  惯例，对照 mutateRoot/replaceSchema）；若 SA1 论证走 rejection 通道，需回流修订
  本记录与对应用例（SA8 设计复审时同步确认）。

## 修订记录 R1（Phase 1 回流，2026-08-27，SA3 实现落位后）

**背景**：SA3 实现 commit `8113083` 落位后，总控独立复跑确认仅剩 2 红，均为
SA6-owned 锚文件缺陷（非实现缺陷）。仅修订两个测试锚文件与本节记录，未触碰任何
src/ 与其他测试文件。修订后两文件 **20/20 全绿**（14 运行时 + 4 类型锚 + 2 保持性
守卫），Type Errors: no errors；另复跑 2 次红文件 14/14 稳定绿（零 flake）；
`packages/namespace-registry/test` 全目录 19 files / 224 tests 全绿（含 SA3 新增
测试文件），零回归。

**R1-1 类型锚结构性缺陷（`registry-phase5-replication-surface.test-d.ts`）**：

- 缺陷：`ActiveRuntimeHasReplication<T>` 对 `NamespaceLeaseStatus` 联合分布式求值，
  产生 `true | false` = `boolean`；`LeaseStatusCheck<T> = boolean extends true ?
  true : never` 恒为 `never`——任何正确实现都无法转绿（`released` 分支 `runtime:null`
  失配所致）。
- 修正（锚定语义不变：active 分支 runtime 投影必须携带 replication 域）：改为两步
  无分布残留判别——
  ```ts
  type LeaseActiveRuntime<T> = T extends { readonly lease: 'active'; readonly runtime: infer R } ? R : never;
  const projectionHasStatus: HasReplicationStatus<LeaseActiveRuntime<NamespaceLeaseStatus>> = true;
  ```
  分布式推断把联合消解为单类型（active 分支 → 投影 R；released 分支失配 → never，
  联合吸收后恰为投影类型本身），再以既有单层 `HasReplicationStatus` 判别；基线红 /
  实现绿翻转机制与本文件其余锚完全一致。

**R1-2 FilePersistence 全链用例 harness 竞态（`registry-phase5-replication-red.test.ts`，
修订前 3/3 确定性失败）**：

- 缺陷：enable 的 saveDoc 只登记 dirty + 武装 debounce（ADR 0006）；`advanceBy(1_000)`
  触发 flush 后真实 fs 的 writeFile→rename 在事件循环上异步进行，测试在
  `advanceBy` 返回后立即 `shutdown() + dispose()`，dispose abort 了尚未落地的写入——
  磁盘快照停留在 create 时刻，重启断言 `replicationId` 为 `undefined`。
- 修正：采用仓库既有正式解法（issue #108 的
  `packages/namespace-runtime/test/durable-snapshot-wait.ts` 模式）——**只读 import
  该 helper**（未修改其内容），在 shutdown/dispose 之前对磁盘 committed 快照文件
  （`rootDir/users/{userId}/{docId}.snapshot`）做有界轮询等待：
  ```ts
  await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('META').get('replicationEpoch'), 1);
  await waitDurableSnapshot(ALICE, nsId, rootDir, (doc) => doc.getMap('META').get('replicationId'), id0);
  ```
  直接文件读（不干扰 flush 写路径）；磁盘事实成立后无在途写，随后的重启断言确定，
  真实持久化缺陷仍会被抓（超时响亮失败，断言强度不变）。

**R1 复跑验证**（独立进程）：

1. `pnpm vitest run --typecheck packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts packages/namespace-registry/test/registry-phase5-replication-red.test.ts`
   → **exit 0；Tests 20 passed (20)；Type Errors: no errors**；
2. `pnpm vitest run packages/namespace-registry/test/registry-phase5-replication-red.test.ts`
   ×2（flake 检查）→ 两次均 exit 0、14/14 绿；
3. `pnpm vitest run --typecheck packages/namespace-registry/test`（全目录）→ **exit 0；
   19 files / 224 tests 全绿；Type Errors: no errors**（含 SA3 新增测试文件，零回归）。
