# SA3 实现报告 — issue #133 round-2「Phase 5: bootstrap import, archive, and guarded replica reset」

- **Worktree**: /home/wangjian/nomicore-fix-issue-133（分支 fix/issue-133-on-docs-phase-5-websocket-replication）
- **实现基线**: 任务简报 R2-AC-1..R2-AC-6；SA1 R3 设计（含 R2-R1/R2-R2 修订）；SA2 R3 verdict pass（红线验证清单 5 条）；SA8 R3-delta verdict clear（非阻断观察 2 条已采纳）。
- **本地验证**: 全量套件 147 文件 / **1754 用例全绿**（= 基线 1711 + SA6 守卫绿 3 + 本批新增 31 + 原 9 红转绿），`tsc -p tsconfig.typecheck.json --noEmit` 零错误；`git diff --check` 干净。
- **版本**: namespace-registry 0.1.5→0.1.6；persistence 0.2.1→0.2.2；namespace-runtime 0.1.9→0.1.10。

## 变更文件清单

### 生产代码（ALLOW LIST 内 + 2 处按必要性报告）

| 文件 | 内容 |
|---|---|
| `packages/persistence/src/contract.ts` | probe 结果/checked 类型 + `DocPersistedIdentityProbe{Operational,Corrupt,Fatal}Error` 三分类（全部 committed:false、稳定消息）+ `DocPersistence.readPersistedReplicationIdentity?` / `ReplicaPersistence` required 成员（additive） |
| `packages/persistence/src/lifecycle.ts` | `PersistenceLifecycle.readPersistedReplicationIdentity`：io.read 直读 committed 主快照 → detached 解码 → docId/载体/corrupt 分类 → `readPersistedReplicaFacts` 判据族；同步 throw→adapter-violation、epoch 终结→read-aborted、入口 disposed→lifecycle-disposed；零 cell/handle/saveDoc/flush/archive |
| `packages/persistence/src/memory.ts` / `file.ts` | probe 委托（File 沿 SAFE_PATH_SEGMENT 双段入口门） |
| `packages/persistence/src/index.ts` | 新类型/错误类导出（additive） |
| `packages/persistence/src/testing.ts` | `PersistenceIoFaults.failNextRemove`（归档 remove 段故障槽） |
| `packages/namespace-runtime/src/runtime.ts` | 内部 `beginResetFence`（包内类型；唯一 sequencer 槽内 probe→live→同步 arm closing；槽后 lazy continuation 产出 `startCloseAfterFence`；`lazyCloseBarrier` 与公共 close() 共享同一 closePromise 幂等缓存）；以 **non-enumerable** 键挂载（Object.keys 十二键审计零漂移） |
| `packages/namespace-runtime/src/close.ts` | `enqueueCloseBarrier(sequencer, env)` 共用入队封装（普通 close 与 fence lazy continuation 同一 barrier 路径；FIFO/无 timeout/单次 release 零改动） |
| `packages/namespace-registry/src/types.ts` | `ImportReplicaIssue` append-only 两成员（`NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH` / `NAMESPACE_IMPORT_EXPECTED_IDENTITY_INVALID`）+ 两条 message 常量 + `importReplica` 四参公共签名（第 4 参 required） |
| `packages/namespace-registry/src/registry.ts` | import：`snapshotReplicationIdentityRef`（敌意 expected 零副作用快照）+ ②c Hub 广告 equality（②a/②b 之后、capability/importDoc 之前）；reset：R2 capability gate（archiveDoc/probe/runtime-fence，先于一切破坏性动作）→ closing 重评估（await closePromise → 槽重读 → probe 分类，零 archive）→ 无 entry probe 判别 → active fence 槽 → armed 破坏性段（forceRelease/cancelIdleArm/lazy close/I2）→ `mapArmedArchiveFailure`（§3.5.2）→ bootstrap 资格 |
| `packages/namespace-registry/src/observer.ts` | **ALLOW LIST 未列（记录）**：追加 `reset-archive-after-arm-failed` 事件成员（设计 §3.5.2 明示「distinct event」；additive，既有事件零改动） |
| `docs/adr/0006-server-persistence-docstore.md` / `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | 追加授权修订节（§5.1/§5.2 文案；append-only） |
| 三包 `package.json` | patch 版本 bump |

### 测试（新增 3 文件；校准 3 个既有文件——全部经续跑总控 dispatch.md 行 #12 授权「按 round-1 回流惯例校准…行为断言不削弱」）

| 文件 | 性质 |
|---|---|
| `packages/persistence/test/persistence-phase5-bootstrap-reset-r2.test.ts`（新，11 用例） | probe 纯净性（dirty live≠store、零 write/scheduler/saveDoc/archive）、missing、operational/corrupt/found{ok:false} 分类、dispose 两态、adapter-violation、归档 relocate-remove committed:true + latest-wins 收敛重试 |
| `packages/namespace-runtime/test/runtime-phase5-reset-fence-r2.test.ts`（新，8 用例） | 十二键/key 审计 + index 值导出不变；FIFO 交错（bump 先于 fence → mismatch 零破坏）；arm 后 bump 零入队拒绝 + close/startCloseAfterFence 同一 Promise、release 恰一次；无自等待（挂起期不结算、放行后 probe→armed→barrier→release）；arm 前窗口已接纳 mutation 按 ADR-0008 排空（SA8 非阻断观察 1 显式覆盖） |
| `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-internal.test.ts`（新，12 用例） | armed 后 archive 五类矩阵（identity/active/duplicate/operational→RESET_FAILED；fatal committed 原样；unknown→false）；legacy fake 缺 fence → 破坏性前 branded fatal（零 probe/close/archive、lease active）；敌意 expected 15 形态 → INVALID + 零 doc 访问/零 importDoc/零 entry + 正确重试成功；closing 矩阵三态（NOT_FOUND/RESET_FAILED/LOAD_FAILED，零 archive）；probe Operational→LOAD_FAILED、Corrupt→fatal(false)（零破坏） |
| `registry-phase5-bootstrap-reset-r2-red.test.ts`（SA6 红文件，仅 fixture 扩展） | Stub 增 `readPersistedReplicationIdentity`（设计 §3.3「R2 test stub 必须提供它」）；**行为断言零改动**（9 红转绿 + 3 守卫绿原样） |
| `registry-phase5-bootstrap-reset-red.test.ts`（round-1 文件，校准） | ① importReplica 全部调用点补第 4 参数（设计 §7 caller audit：`Parameters` 四元组 + 敌意校验在入口前——3 参调用将全部退化为输入拒绝；expected = 各测试自身 Hub 广告身份）；② Stub 增 probe 能力；③「并发 open+reset」单用例改为 R2 冻结两序断言（**行为演进**：无 live entry + 主键仍在 → RESET_FAILED（设计 §3.4 ④ + SA2 R1-1 冻结），拆分为 reset-first / open-first 两用例，原「无 entry 直接 loadDoc 归档」round-1 行为被设计明确取代——已在文件内留注释） |
| `registry-phase5-bootstrap-reset-surface.test-d.ts`（round-1 类型锚，校准） | `HasImportReplica` 演进为四参形状（与 r2 surface 锚一致；保持性守卫 reset 三参不变） |
| `registry-sa7-phase5-bootstrap-reset-dynamic.test.ts`（round-1 文件，校准） | 3 处 importReplica 调用补第 4 参数（seedIdentityDoc {ID_A, epoch}；2b 用已有 `expected` 变量）——机械调用面更新，断言零改动 |

## SA2 R3 红线验证清单落实

1. fenceTask resolve 先于 barrier 创建 + reset/shutdown 有界结算：runtime-fence-r2 T3 + 既有 SA7 2c（reset×shutdown ×真实 Memory，新 fence 路径下全绿）。
2. 普通 close() 与 startCloseAfterFence() 同一 Promise、无第二 barrier：runtime-fence-r2 T2 两序。
3. armed 后逐类注入 DOC_ARCHIVE_*：internal 测试 A 五分支 + committed 原样 + unknown。
4. 生产 factory 满足 RuntimeForRegistry（真实 runtime 非枚举键）、legacy fake 缺能力 → 破坏性前 branded fatal(false)、Runtime barrel 值导出不变：internal B + runtime-fence-r2 T0。
5. SA6 两 dirty race 严格拒绝/零破坏/字节原样：r2-red 竞态 A/B 全绿（真实 Memory hook store 字节 decode）。

## 遗留事项 / 说明

- **无阻断遗留**。两点一致性说明：① `packages/namespace-runtime/src/types.ts` 在基线不存在（设计 §8 笔误）——fence 类型与实现以 `runtime.ts` 包内模块承载（non-enumerable 键 + 零公共导出），效果等价且无泄漏；② SA8 非阻断观察 2（internal subpath 措辞）按「不新增 subpath import、沿既有 factory 接线」理解落实。
- 本报告只做本地 commit，**不 push**；CI/AC 门禁与双轴终审留待总控/SA7。

---

## R-FIX-1 修复轮（SA4 verdict pass 后；commit `4fe3a02` 之后的追加改动）

- **R-FIX-1（MEDIUM-HIGH，必须修复）**：`resetReplica` 公共入口 expected 快照校验缺失（设计 §3.2「格式错误…不能误报本地 mismatch，也不能访问 Persistence」双违）。
  - 修复：resetReplica 入口镜像 import 侧纪律——acceptance → validateOpenIdentity → `snapshotReplicationIdentityRef(expectedLocalIdentity)` → 失败即返回 `RESET_EXPECTED_IDENTITY_INVALID_ISSUE`（code = 既有 `NAMESPACE_INVALID_IDENTITY`——设计 §3.2 原文「沿既有 NAMESPACE_INVALID_IDENTITY…处理」直接命中，**零新错误码**；`field: 'expectedLocalIdentity'` 为 `InvalidIdentityIssue.field` 判别字的 additive 新成员——SA4 方案 A'：诚实描述「期望身份」输入缺陷，open/create 共享形状零破坏，已有 field 消费方（open/create/identity 测试）零影响）；`expectedOutcome.value`（冻结快照）进入 admitResetSlot——同时消除 fence 槽/archiveDoc 双读分叉 TOCTOU。入口快照点先于任何 carrier/entry/Persistence 访问（含 getter/Proxy throw 收编）。
  - 顺带（指令第 2 条）：resetReplica 入口段过时注释（「期望身份纯传递 §4.7…」）已同步更新为 R2 现状。
  - 测试锚（internal 测试 +3 用例）：敌意 16 形态 → `NAMESPACE_INVALID_IDENTITY` + **`stub.probeCalls` 为空（零 Persistence 触达分界锚）** + lease active/lifecycle ready/零 archive + 正确 expected 重试成功（含重试路径首次 probe 计数 ==1）；可变 expected 双读分叉攻击（接纳后改写 → 归档收到冻结样本 {ID_A,1}）→ 成功。
- **F-1（LOW，顺带）**：`reset-archive-after-arm-failed` observer 真实派发断言——armed + `DOC_ARCHIVE_OPERATIONAL` → `NAMESPACE_RESET_FAILED` + observer 恰一次收到该事件 + cause 负载零复制身份值回显（ID_A/NS_B/u-alice 均不出现于 cause 文本）。
- **验证**：`tsc -p tsconfig.typecheck.json --noEmit` 零错；受影响 3 文件 44 用例全绿；全量套件复跑零回归（见总控采信日志 `.mabf-bg/rfix1-full.log`——147 文件 / 1757 用例全绿）；`git diff --check` 干净。版本号同轮内不重复 bump（registry 已 0.1.6）。
