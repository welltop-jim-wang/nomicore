# SA7 动态验证报告 — issue #133「Phase 5: bootstrap import, archive, and guarded replica reset」

verdict: pass

**Date**: 2026-05-30（Phase 3 动态验证）
**前置校验**: SA4 verdict = **pass**（sa4_review.md 首行），SA6 红灯已绿（本地实跑 4 文件 75 用例全过，exit 0），总控亲验 140 文件 1687 用例全绿 + typecheck exit 0。
**验证基线**: worktree `/home/wangjian/nomicore-fix-issue-133`；实现 = `packages/persistence/src/{lifecycle,memory,file,contract,testing}.ts` + `packages/namespace-registry/src/registry.ts`（SA3 落地面）。
**验证面**: 用真实运行攻击实现的活性/竞态/恢复面——settle 排空、degraded 回退、dispose 三重交错、resetReplica 并发矩阵、forceReleasing 观测、Memory/File dispose 窗口（F-7 双窗）、File 崩溃恢复实机、identity 守卫动态边界、公共面运行时枚举。

---

## 〇、Step 0/1（skill 纪律）

- [SA7 Step 0 结论] SA4 verdict: **pass** → 进动态验证。
- [SA7 Step 1 结论] SA6 红灯: 🟢 GREEN
  - 命令：`npx vitest run packages/persistence/test/persistence-phase5-archive-red.test.ts packages/persistence/test/persistence-phase5-import-red.test.ts packages/namespace-registry/test/registry-phase5-bootstrap-reset-red.test.ts packages/namespace-registry/test/registry-phase5-identity-red.test.ts`
  - 结果：exit 0；`Test Files 4 passed (4)` / `Tests 75 passed (75)` / `Type Errors no errors`。

## 零、验证纪律声明

- 真实 yjs / 真实 MemoryPersistence / FilePersistence（真实 tmpdir、真实 fs rename/mkdir/writeFile）/ 真实 Registry + Runtime（默认 runtimeFactory = createNamespaceRuntimeForRegistry）。
- fault 注入仅经 `createPersistenceIoFaultSeam`（holdNextWriteBeforeCommit）或自定义 `wrapIo`（Memory/File 构造选项的规格化 around-seam，设计 §4.6）；零 mock 本地服务。
- 零 real sleep：persistence/registry 均用 fake scheduler + `advanceBy`；真实异步排空用微任务 drain（`await Promise.resolve()` ×N）与 `setImmediate` 事件栅栏；全部竞态用例包 `withTimeout`（@nomicore/persistence/testing 既有工具），超时即失败。
- 零 flake 纪律：两个新测试文件各连跑 3 次（1 次单跑 + 2 次合并跑），每次 24/24 全过、exit 0；并发类用例内嵌 ×50 轮（seeded PRNG 随机化调用次序与微任务交错深度，两形态均被抽到并有断言守卫）。
- 未修改任何 src/ 与既有测试（`git status`：本 SA 仅新增 2 个测试文件；src 的 M 均为 SA3 既有实现面）。

---

## 一、重点 1：settle 排空活性（BLOCKER-1 的动态实证）

落点：`packages/persistence/test/persistence-sa7-phase5-bootstrap-dynamic.test.ts` §1（4 用例）+ registry 链 §1a（下述第七节前的专门用例）。

### 1a 零-handle dirty → 立即归档（真实链）
- **场景**：MemoryPersistence（hook store）createDoc → 业务写 ROOT.n=77 → saveDoc（dirty 登记，debounce 武装，零 advanceBy）→ handle.release()（entry 零-handle dirty）→ **立即** archiveDoc。
- **注入**：无（纯真实时序攻击——pending flush 若不被 settle 排空，会把主键 snapshot 写回归档后复活文档）。
- **断言**：归档有限结算（withTimeout 2s）；强制 flush 跳过 debounce（write 尝试相对基线恰 +1，未推进任何虚拟时钟）；归档字节 decode 后 ROOT.n===77、META 身份完整；外部 store 主键删除；loadDoc → null。
- **实测**：✅ 全过（14/14 文件级；本用例含其中）。归档内容含最后写入值——BLOCKER-1 排空语义在真实持久化链上成立。
- **registry 真实版**（`registry-sa7-phase5-bootstrap-reset-dynamic.test.ts` §1a）：importReplica → schemaReady → mutateRoot(n=77) 在途（不 await）→ lease.release() → 立即 resetReplica → 写槽与 reset 双双有限结算（withTimeout 5s），归档字节 ROOT.n===77 / epoch 1，remove 恰一次，open → NAMESPACE_NOT_FOUND。SA6 REG「在途写+reset」的真实持久化版通过。

### 1b degraded 回退窗 × reset
- **场景**：create → 写 → saveDoc → release → `failNextWrites(3)`（wrapIo 注入 pre-commit 拒绝，store 不变）→ advanceBy(1) 首次 flush 失败 → entry 进入 degraded、retry 武装 → 发起 archiveDoc。
- **断言**：settle **被动等待**（等待窗内连续微任务排空后 write 尝试数不变——不热循环失败 store）；每 advanceBy(1) 恰一次重试（计数逐步 +1，有界）；failNextWrites 耗尽后第 4 次尝试成功 → waiter 通知 → settle 排空 → 归档 ok:true；总尝试恰 4 次（3 失败+1 成功）；scheduler.pending()===0；归档字节含最后写入值（n=88）；主键移除。
- **实测**：✅ 全过。回退被尊重、排空后归档成功。

### 1c dispose × settle（在途 flush）
- **场景**：零-handle dirty → `holdNextWriteBeforeCommit()`（标准 fault seam）→ archiveDoc → settle 强制 flush 进入 pre-commit hold → 发起 dispose → release hold。
- **断言**：archiveDoc 有限结算且为 **bare disposed**（Error /disposed/，非 DocArchive* typed 分类——settle 苏醒后置 archiving cell 前的 assertWritable 收口）；dispose 有限结算；scheduler.pending()===0；归档提交段从未执行（log 无 archive-committed）。
- **实测**：✅ 全过（通知点 1：flush finally 首位无条件通知 waiter）。

### 1d 三重交错（SA2 BLOCKER-1 原始脚本动态版）
- **场景**：degraded retry 武装（failNextWrites(999) 持续失败 + advanceBy(1) 首败）+ 零在途 flush（等待窗内尝试数恒定）+ archiveDoc settle 挂起于 archiveWaiters → dispose。
- **断言**：archiveDoc 有限结算（bare disposed，INV-15）；dispose 有限结算；retry timer 被 clearTimers 取消、死亡瞬间零额外重试（尝试数恒为基线+1）；定时器全清；归档/remove 从未触达。
- **实测**：✅ 全过（通知点 2：dispose 同步段 splice-通知 waiters，不依赖未来 flush）。

**结论（重点 1）**：BLOCKER-1 修复的三通知点（flush finally 首位 / dispose 同步段 / archiveDoc 全程 track）在四种真实交错下全部有限结算，零挂起、零热循环。**通过**。

---

## 二、重点 2：resetReplica 并发矩阵真跑（×50 轮）

落点：`packages/namespace-registry/test/registry-sa7-phase5-bootstrap-reset-dynamic.test.ts` §2（4 用例，每轮真实 Memory persistence + 真实 Registry + Runtime，seeded PRNG 随机化次序与交错深度）。

### 2a 并发 open + reset ×50
- **场景**：每轮种子 importReplica（epoch 1）→ release → 随机次序并发 open/resetReplica（两调用间随机 0–3 层微任务 yield）。
- **断言**：恰两形态——open 先 → open 得 lease 且 reset 后 lease.getStatus()==='released'（被强制失效）；reset 先 → open NAMESPACE_NOT_FOUND；**无第三结局**（open 结果非 ok 时 code 必为 NAMESPACE_NOT_FOUND）；每轮 reset ok:true、归档恰一次、主键移除、终态 open NOT_FOUND；零挂起（全 withTimeout 5s）。
- **实测**：✅ 50/50 轮全过，两形态均被抽到（openFirst>0 且 resetFirst>0 断言生效）。

### 2b reset × import 并发 ×50
- **场景**：每轮全新实例（key 缺席——崩溃后 bootstrap 场景），随机次序并发 resetReplica/importReplica（import doc epoch 2）。
- **断言**：import 先 → import ok + reset ok:true（归档字节 = 导入副本：ROOT.n===9、epoch===2；导入 lease 被强制失效；主键移除）；reset 先 → reset NAMESPACE_NOT_FOUND（零归档触达）+ import ok（lease 可用、open 复用）；两序终态自洽（主键在/不在与 removes 计数一一对应）。
- **实测**：✅ 50/50 轮全过，两序均被抽到。

### 2c reset × shutdown 并发
- **场景**：变体一：种子 → release → wrapIo `holdAfterArchiveCommit()`（归档写提交段完成后挂起）→ resetReplica 在途 → shutdown() 同步发起 → release → 双方结算。变体二：shutdown 先行 → resetReplica。
- **断言**：shutdown 同步段后 getStatus()==='shutting-down' 立即可观测；在途 reset 按自身事实完整结算（ok:true，已接纳槽不被关门打断）；shutdown 有限结算、终态 stopped；`registry.shutdown()` 二调返回 **same Promise 实例**（AC12 幂等）；进程级 `unhandledRejection` 监听捕获 **0** 事件；shutdown 先行变体 reset → REGISTRY_NOT_ACCEPTING、零归档触达。
- **实测**：✅ 全过（events 数组恒空）。

### 2d 同 key 双 reset 并发 ×50
- **场景**：种子 → release → 同 tick 两次 resetReplica（同期望身份，中间随机微任务 yield）。
- **断言**：先接纳者 ok:true；后者 NAMESPACE_NOT_FOUND（**按当前事实**：entry 移除 + 探针 loadDoc → null → NOT_FOUND_ISSUE）；writeArchive 恰 1 次（无双重归档）、remove 恰 1 次；主键移除；终态 open NOT_FOUND；零挂起。
- **实测**：✅ 50/50 轮全过。

**结论（重点 2）**：并发矩阵四种交错在 200 轮真实运行中结局面与设计冻结完全一致，零第三结局、零挂起、零 unhandled rejection。**通过**。

---

## 三、重点 3：forceReleasing 观测面

落点：同 registry 文件 §3（2 用例）。

- **场景 A（reset 强制失效）**：importReplica（lease #1 未释放）+ open（lease #2 未释放）→ resetReplica → observer 计数。
- **断言**：`lease-released` 事件恰 2（= 未决 lease 数），remainingLeases 快照迭代递减含 {1, 0}；**零 `entry-idle` 事件**（强制失效路径抑制——该 entry 从未进入 idle，径直 closing）；零 `idle-arm-failed`；两 lease getStatus()==='released'；归档照常完成。
- **场景 B（对照组）**：importReplica → lease.release()（自然释放至零 lease）→ `entry-idle` 恰 1 照发；advanceBy(idleTimeout) 后不再增加（恰一次）；无归档副作用；open 恢复新 generation 且内容完好。
- **实测**：✅ 两用例全过。

**结论（重点 3）**：SA2 INFO-9 轻量抑制旗标（forceReleasing）的观测语义与 §4.8.2 冻结一致：lease-released 照发（真实事实）、entry-idle 抑制（诚实观测）。**通过**。

---

## 四、重点 4：Memory dispose 窗口（F-7 / INFO-R2-1）

落点：`persistence-sa7-phase5-bootstrap-dynamic.test.ts` §4（2 用例）。

### 4a writeArchive resolve 后 remove 前 dispose（F-7-i 原项）
- **注入**：自定义 wrapIo —— writeArchive 内层完成（archiveSnapshots 已写入）后挂起；在挂起点发起 dispose；释放后 remove 入口 abort 门（`signal.throwIfAborted()`）拒绝。
- **断言**：archiveDoc = `DocArchiveFatalError('relocate-remove', committed:true)`（对提交瞬间为真）；**drain-then-clear 次序证据**：log 中 `archive-committed` 先于 `dispose-returned`（core.dispose 的 allSettled 先结算被 track 的归档提交段，clear 后置——与既有 mirror 同款纪律）；`remove-done` 不在 log（remove 提交段未执行）；**外部主键未删**（hook store 仍持 key——外部视角「归档未发生、文档原样」——重启恢复语义诚实）；dispose 有限结算；**新实例重试收敛**（共享同一 hook store 的重启实例 archiveDoc → ok:true，主键删除，removes===[key]）。
- **实测**：✅ 全过。

### 4b relocate-remove 在途失败 × 重试收敛（F-7-ii 抛错路径）
- **注入**：deleteSnapshot hook 首调拒绝（任何 side effect 前——PersistenceIO 契约形态）。
- **断言**：archiveDoc = committed:true fatal（writeArchive 已 resolve、归档区持副本 + 主键仍在的双窗口现场）；**重试 archiveDoc 收敛**：guard-read 见主键 → 身份复验 → 再归档（archiveWrites 两次、字节相同——单槽 latest-wins）→ 主键删除 → loadDoc null；**幂等**：收敛后再归档 → `DOC_ARCHIVE_DUPLICATE`。
- **实测**：✅ 全过。

**结论（重点 4）**：SA4 F-7 登记的两个活链路窗口均诚实收敛：committed 事实对提交瞬间为真、dispose 有限、重启重试收敛单副本归档、幂等拒绝。**通过**。

---

## 五、重点 5：File 归档崩溃恢复实机演练（真实 tmpdir）

落点：同文件 §5（5 用例；全部真实 fs）。

| 场景 | 崩溃语义构造（注入） | 断言 | 实测 |
|---|---|---|---|
| 5a 归档成功后新实例 | 无（正常归档 + dispose + 同 rootDir 新实例） | loadDoc → null；`archive/users/<u>/<doc>.snapshot` 存在、字节可 decode、META.docId/replicationId/replicationEpoch 完整、ROOT 值正确；零 .tmp 残留 | ✅ |
| 5b 归档 tmp 残留 | 真实 fs 写入归档区 `.snapshot.tmp` 垃圾字节（tmp 残留 + 主键仍在） | 新实例 loadDoc 正常恢复主键文档（恢复不触归档区）；再归档 ok:true；tmp 被覆盖式清理（absent）；归档字节正确 | ✅ |
| 5c 双副本窗口 | 真实 fs 把主键 snapshot 字节复制进归档位（write resolve + remove 前崩溃） | 重启后两副本并存、主键可 load（诚实）；重试 archiveDoc 收敛：归档区同字节覆盖、主键删除、loadDoc null；再归档 → DUPLICATE（幂等单槽） | ✅ |
| 5d owner 分区 | 无（A/B 同 docId 双分区） | A 归档后 B 分区文件字节逐字节一致、B loadDoc 身份/内容原样；A 主键缺席 + 归档文件在受控 `archive/` 子树 | ✅ |
| 5e F-7-ii 双窗（File 版） | 窗 1：wrapIo 在 remove 内层完成后挂起→dispose；窗 2：writeArchive 完成后挂起→dispose | 窗 1：rm 已进入→完整执行→archive **ok:true 且效果落地**（主键删/归档在）——诚实；窗 2：remove abort 门拒绝→committed:true fatal + **双副本落盘**（归档文件+主键均在）；重启重试收敛→主键删→再归档 DUPLICATE | ✅ |

**结论（重点 5）**：File 归档的原子提交（tmp→rename）、崩溃残局（tmp 残留/双副本）、恢复不触归档区、重定位重试收敛、owner 分区隔离全部实机成立。**通过**。

---

## 六、重点 6：identity 守卫的动态边界

落点：persistence 文件 §6（2 用例）+ registry 文件 §6（2 用例）。

### 6a 持久身份演进后 reset（INV-6 动态版）
- **persistence 版**：createDoc(epoch 1) → release → loadDoc → META.epoch 改写为 2 + ROOT 改写 → saveDoc → advanceBy(1) flush 落盘（decode 外部 store 证 epoch===2）→ 以旧 epoch(1) archiveDoc → `DOC_ARCHIVE_IDENTITY_MISMATCH`；store 字节逐字节零改动；loadDoc 恢复 epoch 2 / ROOT 4；零归档写。✅
- **registry 版**：importReplica(epoch 1) → `lease.bumpReplicationEpoch()`（真实写槽）→ advanceBy(1) flush 落盘 → release → 以旧 epoch(1) resetReplica → `NAMESPACE_RESET_IDENTITY_MISMATCH` + 零 archiveWrites/零 removes → open 恢复（epoch 2、ROOT 5 完好）→ 以当前 epoch(2) reset → ok:true 且归档字节 epoch===2。✅
- **结论**：守卫以**持久快照复制事实**为权威（演进落盘后旧期望拒绝、当前期望放行），拒绝时零部分删除、文档完好、open 恢复。

### 6b 导入后立即 reset（未 flush 窗口）
- **场景**：importDoc（create 提交点即落盘）→ **零 advanceBy** → 立即 archiveDoc / resetReplica。
- **断言**：以导入身份（epoch 7）归档/reset → **成功**（守卫读到的是导入 committed 字节身份；归档字节 epoch 7/ROOT 3 正确）；以陈旧身份（epoch 6）→ `DOC_ARCHIVE_IDENTITY_MISMATCH` / `NAMESPACE_RESET_IDENTITY_MISMATCH` + 导入副本完好（open 恢复 epoch 7）。✅（persistence 与 registry 双链各验证）
- **结论**：导入的持久身份权威在 create 提交点即成立——「未 flush 窗口」不构成身份歧义（flush 语义只关乎后续 dirty 写，导入字节已 committed）。

**结论（重点 6）**：通过。

---

## 七、重点 7：类型/公共面动态守卫

落点：两文件 §7（2 用例）+ 进程级 node 探针（tsx）。

- **vitest 断言**：`@nomicore/persistence` 主入口运行时枚举键不含 removeDoc/deleteDoc/listDocs/dropDoc/destroyDoc/restoreDoc/putDoc/getDoc/removeAll/deleteAll/archiveAll；Memory/FilePersistence 实例原型面不含上述禁词且恰含 createDoc/loadDoc/saveDoc/importDoc/archiveDoc。`@nomicore/namespace-registry` 实例运行时可枚举键**恰六面** `['create','getStatus','importReplica','open','resetReplica','shutdown']`；主入口无 removeNamespace/deleteNamespace/closeNamespace/dropNamespace/archiveNamespace/listNamespaces/resetAllNamespaces/destroyNamespace/purgeNamespace。✅
- **node 进程探针**（独立进程证据）：
  - 命令：`cd packages/namespace-registry && npx tsx -e '<IIFE 探针>'`（枚举两包模块键 + 双 adapter 原型 + registry 实例键，含禁词表过滤，命中即 exit 1）
  - 结果：**exit 0**。摘录：`PERSISTENCE forbidden hits: []`；`MemoryPersistence proto: apply,archiveDoc,constructor,createDoc,dispose,getStatus,importDoc,loadDoc,saveDoc`；`REGISTRY instance keys: create,getStatus,importReplica,open,resetReplica,shutdown`；`REGISTRY forbidden hits: []`。
  - 备注：FilePersistence 原型含 `removeCommittedSnapshot/writeArchiveSnapshot/resolveArchivePaths` 等包内私有 io 方法（设计 §4.9 归档重定位能力的内部 seam，非公共删除 API，不在禁词面——与 SA4 静态结论一致）。

**结论（重点 7）**：通过。

---

## 八、新增测试文件清单（永久回归资产）

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `packages/persistence/test/persistence-sa7-phase5-bootstrap-dynamic.test.ts` | 14 | 重点 1（1a/1b/1c/1d）、4（4a/4b）、5（5a-5e）、6（6a/6b）、7 |
| `packages/namespace-registry/test/registry-sa7-phase5-bootstrap-reset-dynamic.test.ts` | 10 | 重点 1a（registry 链）、2（2a/2b/2c/2d）、3（两用例）、6（6a/6b registry 链）、7 |
| **合计** | **24** | |

## 九、实测命令与结果汇总

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | SA6 红灯四文件 `npx vitest run ...`（Step 1） | 0 | 4 files / 75 tests passed |
| 2 | `npx vitest run packages/persistence/test/persistence-sa7-phase5-bootstrap-dynamic.test.ts`（首跑） | 0 | 14 tests passed, no type errors |
| 3 | `npx vitest run packages/namespace-registry/test/registry-sa7-phase5-bootstrap-reset-dynamic.test.ts`（首跑） | 0 | 10 tests passed, no type errors |
| 4 | 两文件合并连跑（零 flake 纪律，终版三连跑） | 0 / 0 / 0 | 各 2 files / 24 tests passed（含 `--typecheck` 复验单跑 exit 0） |
| 5 | `npx tsx -e` 运行时公共面探针（进程级） | 0 | 零禁词命中（第七节摘录） |
| 6 | `pnpm test`（全量零回归，`vitest run --typecheck`） | 0 | **142 test files / 1711 tests 全过 + Type Errors no errors + Errors 0**（1687 既有 + 24 新增） |
| 7 | `git status` | — | 本 SA 仅新增上述 2 个测试文件；src/ 与既有测试零改动 |

**过程记录（透明）**：首次全量跑（142/1711 全过但 exit 1）暴露本 SA 新建 registry 测试文件的一处类型导入笔误（`RegistryTestScheduler` 误从主入口导入——该类型属 `@nomicore/namespace-registry/testing` 子路径；单文件跑无 `--typecheck` 故未先暴露）。**属测试文件自缺陷，非实现缺陷**；已在测试文件内修复（仅改 import 行）并以 `npx vitest run --typecheck` 单文件复验 + 全量复跑 exit 0 收口。

## 十、缺陷清单

无。本次动态验证未发现实现缺陷（D-x：零项）。SA4 交办的 F-7 双窗口、SA2 INFO-R2-1/BLOCKER-1 复发面均以活链路实证诚实收敛。

## 十一、Spec / vitest 触发证据（skill Step 3/4 声明）

- 本任务 SA1 设计无新增/改动 `*.spec.ts`（E2E）；新增面全部为 vitest 单测（上述 2 文件）。
- CI 触发证据（runner log 摘录）需 push 后的 run——按 SA7 职责边界（不负责 push/建 PR/宣称 CI 绿），本报告交付本地真实触发证据（`npx vitest run <file>` 逐文件实跑 exit 0，见第九节），CI run log 摘录由总控 push 后按 Step 4 表格补录：
  - 预期 runner 面：workspace packages `@nomicore/persistence`（Test Files +1 / +14）与 `@nomicore/namespace-registry`（Test Files +1 / +10）。

---

**最终 verdict: pass** —— SA3 实现在动态攻击面（活性/竞态/恢复）与冻结设计一致；两个活链路窗口（F-7-i/ii）诚实收敛；并发矩阵 200 轮零第三结局零挂起；新增 24 用例成为永久回归资产；全量零回归。
