# SA4 静态验尸报告 — issue #133 round=2「Phase 5: bootstrap import, archive, and guarded replica reset」

**Date**: 2026-08-28
**Verdict**: **pass（带 1 项必须修复）** — R-FIX-1（MEDIUM-HIGH）：`resetReplica` 公共入口 expected 快照校验缺失，违反设计 §3.2 规范文本；不否定 R2-AC-1..6 达成，但须在收口前回流 SA3 落地（或 owner 明示豁免并登记设计偏离）。

- 审查对象：`git diff 6784645..HEAD`（4fe3a02 feat + de446f9 docs + 82a797c dispatch 收口；生产 diff 24 文件，wiki 档案 10 文件）。
- 设计基线：`task_phase5-bootstrap-archive-reset-r2_design.md`（R3 冻结版，515 行）。
- 评审基线：SA2 R3 pass + 红线验证清单 5 条；SA8 R2/R3-delta 双 clear + 非阻断观察 2 条。
- 审查方式：全量 diff 逐块阅读 + 关键实现（registry.ts / runtime.ts / close.ts / lifecycle.ts / contract.ts / testing.ts）与设计伪码逐行对照 + 测试断言强度核实（锚行为而非凑数）+ 静态攻击推演。未跑全量测试（总控已亲跑 147 文件/1754 用例绿 + typecheck 零错 + diff --check 干净，采信）。

---

## 一、总控移交关注项逐项裁决

### 关注项 1：resetReplica 公共入口 expected 校验缺口 → **确认为真实设计偏差，构成必须修复项（R-FIX-1）**

**事实核实**：

- `registry.ts:1894`：`return admitResetSlot(outcome.identity, expectedLocalIdentity as ReplicationIdentityRef);` —— 公共入口对 expected 仍仅做裸 cast，无任何运行时校验（round-1 原样）。对比 import 侧入口 `registry.ts:1875-1878` 已有 `snapshotReplicationIdentityRef` 安全快照（`registry.ts:251-280`，判据完备：own data descriptor / proto 门 / REPLICATION_ID_PATTERN / safe-integer ≥1 / getter+Proxy throw 收编 / 冻结值快照）。
- 设计 §3.2 明文（规范文本）：「实现应在公共入口的 identity validation 后验证 expected 的字段格式。格式错误是调用输入错误（沿既有 `NAMESPACE_INVALID_IDENTITY`/内部 API 前置约定处理），**不能误报本地 mismatch，也不能访问 Persistence**。」

**静态攻击推演（三条后果链，均可复核）**：

| 攻击输入 | 执行路径 | 结果 | 违反 §3.2 的哪一项 |
|---|---|---|---|
| `expected = null`（或 getter/Proxy-throw 形态） | admitResetSlot → carrier FIFO → runResetSlot → ② capability 门通过（真实 Memory+Runtime 均有能）→ ⑤ `beginResetFence(null, …)` → fence 槽内**先 `await readPersisted()`（Persistence 已被读）**→ `fenceIdentityEquals(liveChecked, null)` 读 `expected.replicationId`（runtime.ts:221）→ TypeError → fenceTask reject | `mapProbeOrFenceFailureBeforeDestruction` unknown 分支 → `NamespaceRegistryFatalError(reset, lifecycle-slot-internal, false, TypeError)`；sequencer 链尾恒绿（sequencer.ts `settled.then(noop, noop)`）不毒化 FIFO；**零破坏成立** | ① 访问了 Persistence；② 调用输入错误被分类为内部实现 fatal（observer 收到误导性 `lifecycle-slot-failed`） |
| `expected = {replicationId:'Z'×32, replicationEpoch:1}`（格式错误但不抛） | 同上进入 fence 槽 → probe 已读 → 双源比对全不等 → `{kind:'mismatch'}` | 返回 `NAMESPACE_RESET_IDENTITY_MISMATCH`（registry.ts:1651-1653） | ① **误报本地 mismatch**（把调用方输入缺陷伪装成本地身份分歧——未来 Hub 集成方会据此误诊本地副本 diverged）；② 访问了 Persistence |
| 可变 expected 对象 / getter 二次返回不同值 | expected 在 **fence 槽执行期**（carrier FIFO + sequencer 排队之后，可任意晚于调用）才被读取（runtime.ts:221-222），且 step ⑦ `archiveDocFn.call(persistence, …, expected)`（registry.ts:1688）第三次读取该对象 | 双读分叉 / TOCTOU：核对样本与归档守卫样本可能来自不同值 | §4.2.1 在 import 侧已用冻结快照免疫同类问题（「双读分叉免疫」），reset 侧裸奔 |

**为何不构成 reject**：全部路径零破坏性质经静态验证成立（TypeError/mismatch 均发生在 arm 之前，无 forceRelease/close/archive）；round-1 冻结词汇未破坏；R2-AC-1..6 无一覆盖敌意 reset 输入；设计虽写了要求但未冻结码拼写与测试锚（SA1 §3.2 一句带过，SA2 三轮评审与红线清单均未列入）——与 SA2 R1-4 在 import 侧攻击并冻结 §4.2.1 的待遇不对称，属设计规格密度缺口。

**为何不能论证现状可接受**：§3.2 的两个「不能」是硬性禁止项，实现双违；misclassification 有真实误诊向量（调用方拿到 mismatch → 错误运维路径）；「fence 槽内核验已保证零破坏」只成立一半——破坏性安全成立，但输入面（双读分叉）与分类诚实面不成立。

**最小修复方案（回流 SA3 + SA1 微设计追加，~5 行生产代码 + 1 个测试 describe）**：

1. 代码（registry.ts resetReplica 入口，镜像 import 侧 1875-1878）：
   ```ts
   const expectedOutcome = snapshotReplicationIdentityRef(expectedLocalIdentity);
   if (!expectedOutcome.ok) return <chosen-issue>;
   return admitResetSlot(outcome.identity, expectedOutcome.value);
   ```
2. **码裁决（经复核修正——「零新词汇复用」不成立）**：`ResetReplicaIssue` 联合虽含公共 `InvalidIdentityIssue`（types.ts:348），但该 issue 形状含**必填判别符 `field: 'owner.userId' | 'namespaceId'`**（types.ts:114-119，identity.ts:66-74 构造点）——`expectedLocalIdentity` 参数缺陷两个枚举值都无法诚实描述，强填即语义谎报。故设计 §3.2「沿既有 `NAMESPACE_INVALID_IDENTITY`…处理」在 reset 结果联合上**没有现成落位**——这正是 SA1 规格密度缺口的实锤（写了要求、未指定结果通道）。两个可行方案：
   - **方案 B（推荐，镜像 import 侧既有先例）**：新增 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID` + message 常量（如「期望本地复制身份（reset expected）不符合安全文法」）+ `ResetReplicaIssue` append-only 成员。SA1 在 import 侧面临同构局面时（`ImportReplicaIssue` 同样已含 `InvalidIdentityIssue`）**自己的既定选择就是专用码**（§4.2.1「deliberately distinct…under NAMESPACE_INVALID_IDENTITY semantics」）——对称先例成立。需 SA1 微设计追加冻结拼写 + SA2 快速复审（任务简报设计约束：「冻结词汇…除非 SA1 设计明确提出并经 SA2 评审通过」）。
   - **方案 A'（更小但触碰共享冻结形状）**：扩展 `InvalidIdentityIssue.field` 联合增加 `'expectedLocalIdentity'` 并在 reset 入口返回该形状——零新 code，但改的是 open/create 共用的冻结 issue 形状，消费方按 field 分支会见到新值；同样需要设计簿记。两案比较：B 的爆炸半径限于 reset 联合、与 import 对称、message 精确——**推荐 B**。
3. 测试锚：镜像 internal 测试 C 的 16 形态敌意矩阵用于 `resetReplica`——断言新码 + **`stub.probeCalls` 为空**（零 Persistence 触达——这是与现状的行为分界锚，必须显式断言）+ lease active/lifecycle ready/零 archive + 随后正确 expected 重试成功。
4. 附带收益：冻结快照同时消除上表第三行的 fence 槽/archiveDoc 双读分叉。
5. 流程注记：修复涉及新冻结词汇 → 走 SA1 微追加（§3.2 结果通道补一段）→ SA2 delta 复审 → SA3 落地 → SA4 增量复审；或 owner 裁决豁免并在 wiki 登记设计偏离（则 SA7 动态清单第 6 项作废）。

### 关注项 2：SA8 delta 观察 1（「fence 入队后、arm 前接纳」窗口排空）→ **已显式覆盖，断言真实锚定行为**

`runtime-phase5-reset-fence-r2.test.ts` T4（267-304 行）正是该窗口的定向用例：

- 构造：fence 入队且 `readPersisted` 被 gate 挂起（lifecycle 仍 ready）→ **挂起期间**接纳 `bumpReplicationEpoch()`（281-282 行——即「fence 入队后、arm 前接纳」窗口）→ 放行 gate → fence 采样（此时 bump 尚未执行——FIFO 保证 fence 任务先结算）→ armed。
- 断言（三重锚，非凑数）：`await bumpP` → `{ok:true}`（**窗口内接纳的写照常执行，未被拒绝**——ADR-0008 排空语义）；`notifyCalls.count === 1`（完整槽含 notify，非截断执行）；`startCloseAfterFence()` 后 `releaseCalls.count === 1` 且最终 replication = epoch 2（**barrier 排空 bump 后才 release；窗口写的身份变更确实发生**）。
- SA3 报告声称的「arm 前窗口已接纳 mutation 按 ADR-0008 排空」用例**属实**。
- 残余缝隙（LOW，动态注记）：窗口 mutation 的**下游后果**（live 身份 post-sample 变更 → 真 archiveDoc guard 拒绝 → `RESET_FAILED`）在 Registry 侧仅由注入式 guard 测试覆盖（internal A 的 IDENTITY_MISMATCH 分支），无「窗口 bump × 真实 store 归档守卫」端到端单测直连——交 SA7 动态验证（见动态审核重点 2）。

### 关注项 3：SA8 delta 观察 2（internal subpath 措辞过紧）→ **按建议口径落实，零偏差**

- `registry.ts:46` 的 `import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal'` 为 **round-1 既有授权消费**（`git show 6784645:packages/namespace-registry/src/registry.ts` 确认同一行存在）；本轮 diff 的 import 块变化仅涉及 `@nomicore/persistence` 的错误类（DocArchiveOperationalError 转值导入 + 三个 probe 错误类新增）。
- 未新增任何 runtime internal subpath import；`packages/namespace-runtime/src/index.ts` diff 为**零**（git diff 输出空）。
- `beginResetFence` 以 non-enumerable `Object.defineProperty` 挂载（runtime.ts:466-471，freeze 前定义），T0 用例断言 `Object.keys(runtime)` 恰十二键 + descriptor.enumerable === false + `Object.keys(publicEntry)` 恰 `['RuntimeWriteFatalError']` 一键——公共声明图与值导出面零漂移。
- Registry 侧消费面为结构复制型 `RuntimeForRegistryFence`（registry.ts:230-239，包内私有 interface），不从 runtime 包导入任何 fence 类型。生产接线：`createNamespaceRuntimeForRegistry`（internal.ts）→ `createNamespaceRuntime`（runtime.ts:480-485）→ `createNamespaceRuntimeWithSeam` 同一构造路径——**生产 factory 满足 capability**（SA2 红线 4(b) 成立，internal 测试 A/D/E 全部经默认 factory 走通 fence 路径即为行为证据）。

### 关注项 4：observer.ts 超 ALLOW LIST → **追认（additive 且设计有明文依据）**

- diff 仅 6 行：追加 `reset-archive-after-arm-failed` 事件成员，既有事件零改动。
- 设计 §3.5.2 明文「The observer records a **distinct** `reset-archive-after-arm-failed` event with stable operation metadata; it does not include identity contents」——实现该明文要求必然触及事件联合所在文件；§8 ALLOW LIST 漏列属 SA1 文件清单簿记缺口，非实现越界。裁决：**追认**，建议后续设计簿记补录（非阻断）。
- 派发点核实：`mapArmedArchiveFailure` 四类 RESET_FAILED 分支派发新事件（registry.ts:1748），fatal/unknown 分支沿 `lifecycle-slot-failed`（registry.ts:1751）——设计表未规定逐行 observer 事件，该分域解读合理（与既有 reset fatal 处置一致）。

### 关注项 5：round-1 测试校准保真 → **忠实，断言强度未削弱（一处实质增强）**

- **4 参调用面**（round-1 red 文件全部 `importReplica` 调用点）：第 4 参 = 各测试自身 Hub 广告身份，取值与文档身份一致——保证既有断言仍达原分支（②a/②b 先于 ②c：badId/badEpoch/plainDoc 用例的 `IMPORT_INVALID_IDENTITY`、foreign 用例的 `IMPORT_IDENTITY_MISMATCH` 语义不变）。
- **stub probe**：`StubReplicaPersistence.readPersistedReplicationIdentity` 为纯 fixture 能力补充（docs map 单一真相源、判据族镜像），注释留痕「fixture 能力补充，非行为断言改动」——属实。
- **「并发 open+reset」改写**：拆为两个确定性用例——reset 先接纳（→ `NAMESPACE_RESET_FAILED` + `archiveCalls` 空 + open 后续恢复成功、loadDoc 非 null）与 open 先接纳（→ reset 对 active generation 预核对后归档成功、open 的 lease released、终态 NOT_FOUND + `archives` 恰 1 + loadDoc null）。旧版是两序析取弱断言（`if (openResult.ok) … else …`），新版**逐序精确断言且增加零归档/恢复可用性锚——强度增强**。文件内注释明示「round-2 行为演进（SA2 R1-1 冻结）」并引用设计 §3.4 ④——与 SA2 R1-1「无 live entry 不得仅凭 persisted 事实归档」的冻结语义一致。
- **surface 锚演进**：round-1 `HasImportReplica` 四参化 + r2 surface 新文件反向保持性守卫 reset 三参不漂移（r2-surface.test-d.ts:47-55）——双向锁定。
- **sa7 动态 3 处**：机械第 4 参（seedIdentityDoc 用 ID_A+epoch、2b 用既有 `expected` 变量），断言零改动——核实为纯机械。

### 关注项 6：SA2 R3 红线验证清单 5 条 → **全部有真实实现级证据**

| # | 红线 | 实现级证据 | 裁决 |
|---|---|---|---|
| 1 | fenceTask resolve 先于 barrier 创建；reset+shutdown 有界结算 | runtime T3（gate 挂起期 fenceP 不结算、`releaseCalls===0`；放行后顺序 probe→armed→startCloseAfterFence→release，全微任务驱动零 real sleep）+ 既有 SA7 2c（reset×shutdown 并发、双方 `withTimeout 5s` 有界结算、shutdown 幂等 same-Promise——新 fence 路径下全绿，总控亲跑采信） | ✅ |
| 2 | 普通 close() 与 startCloseAfterFence() 同一 Promise、无第二 barrier | runtime T2 两序：close-first（`startP` toBe `closeP`）与 start-first（`closeP` toBe `startP`）；release 恰一次；后续 close 幂等复用。代码面：`lazyCloseBarrier` 单 `closePromise` 缓存（runtime.ts:363-367），公共 close 与 fence continuation 共用（runtime.ts:460 / 281） | ✅ |
| 3 | armed 后逐类注入 DOC_ARCHIVE_*，结果与 committed truth | internal 测试 A 五分支：IDENTITY_MISMATCH/ACTIVE_HANDLE/DUPLICATE/OPERATIONAL → `NAMESPACE_RESET_FAILED`；FATAL committed:true → branded fatal `committed:true` 且 cause `toMatchObject({code, committed})`；FATAL false / unknown plain Error → fatal false。代码 `mapArmedArchiveFailure`（registry.ts:1739-1761）与 §3.5.2 表**逐行一致**：`errorCodeOf` duck-type（registry.ts:288-293）+ instanceof 双保险；`DOC_ARCHIVE_FATAL` 走 `committedOf(cause)`（registry.ts:1756）原样传播 | ✅ |
| 4 | 生产 factory 满足 RuntimeForRegistry；legacy fake 缺能力 → 破坏性前 branded fatal(false)；barrel/d.ts 零泄露 | internal B：legacy fake（无 beginResetFence）→ `NamespaceRegistryFatalError(reset/lifecycle-slot-internal/false)`，`probeCalls`/`archiveCalls`/`closeCalls` 全空、lease 仍 active、无 TypeError；T0 十二键 + barrel 一键审计；gate 位置 registry.ts:1563-1582 先于一切 probe/forceRelease/close/archive（§3.5.1 放置点正确） | ✅ |
| 5 | SA6 两 dirty race 严格拒绝/零破坏/字节原样 | r2-red 竞态 A/B：**真实 MemoryPersistence + hook store**，`decodeStoredIdentity(store, primaryKey)` 字节级解码断言 persisted 仍 epoch 1（无强制 flush），live=epoch2 断言、lease active/lifecycle ready/leaseReadN 可用/`store.has(primaryKey)` 全家桶 | ✅ |

### 关注项 7：常规验尸面 → **全部通过（2 个 LOW 级新发现见下）**

- **probe 零副作用（代码级）**：`PersistenceLifecycle.readPersistedReplicationIdentity`（lifecycle.ts:361-437）函数体仅：disposed 入口门 → `toKey` → `io.read`（同步 throw → adapter-violation 分流）→ epoch 判别（operational vs read-aborted）→ `bytes===undefined` → missing → detached `new Y.Doc()` + `Y.applyUpdate`（decode 失败 → Corrupt）→ `getMap('META')`（载体异型 throw → Corrupt）→ `metaDocId !== docId` → Corrupt → `readPersistedReplicaFacts`（lifecycle.ts:1005-1029，与归档 verify **同一函数**——判据族单点共享，非复刻）→ finally `scratch.destroy()`。**无 cell 创建、无 handle 签发、无 saveDoc、无 scheduler 推进、无 flush、无 archive、无 ownership transfer**。persistence P1 用例以 `writeSnapshotCalls` 计数 + `scheduler.pending()` 不变 + store 字节 decode 三重锚定纯净性。
- **armed 后无 mismatch 返回路径**：全文件唯一 `RESET_IDENTITY_MISMATCH_ISSUE` 返回点在 `fence.kind === 'mismatch'`（registry.ts:1651-1653）——结构性先于 armed；step ⑥ close 失败 → fatal（registry.ts:1676-1682）、step ⑦ archive 失败 → mapArmedArchiveFailure（无 mismatch 出口）。✅
- **新公开 message 常量零身份回显**：types.ts:99-102 两条常量为固定文案，无任何插值。probe 三错误类 message 亦为稳定常量（contract.ts diff），cause 仅内部保留。✅
- **failNextRemove 故障槽**：一次性消费（触发即复位 NO_FAULT）、非注入路径原样透传 `io.remove`（testing.ts diff）——不改变既有行为。P8 用例锚定 `DocArchiveFatalError('relocate-remove', committed:true)` + 修复后 latest-wins 收敛重试成功。✅
- **读写路径一致性**：reset 的 persisted 真相源三处（closing 判别 1613 / 无 entry 判别 1624 / fence 槽闭包 1638）统一走 `readPersistedIdentity` 单点；round-1 的 `loadDoc` 探针在 reset 槽已完全移除（`beginCloseCurrent` 一并删除，grep 无残留引用，typecheck 零错佐证）。✅
- **错误处理链/静默失败/降级**：probe 三分类、armed 矩阵、capability 门、closing 矩阵全覆盖；probe 不 fallback live、I/O 失败 loud——无伪降级、无静默失败路径。✅
- **过度设计**：变更半径与设计 §8 预算一致（registry.ts +437 行含大量注释；runtime fence ~147 行含注释）；无投机抽象。✅

---

## 二、新发现问题清单（严重度分级）

| # | 严重度 | 问题 | 证据 | 处置 |
|---|---|---|---|---|
| R-FIX-1 | **MEDIUM-HIGH（必须修复）** | `resetReplica` 公共入口 expected 无快照校验（关注项 1 全文）：null/Proxy → fence 槽内 TypeError → branded fatal(false) + Persistence 已读；格式错误 → 误报 `NAMESPACE_RESET_IDENTITY_MISMATCH` + Persistence 已读；可变 expected 双读分叉（fence 槽 + archiveDoc 两处读点） | registry.ts:1894（cast）、1875-1878（import 侧对照）、runtime.ts:221-222（槽内读 expected）、registry.ts:1688（archiveDoc 再读）；设计 §3.2 | 回流 **SA1（微设计追加结果通道）+ SA3**（推荐方案 B：`NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID` 镜像 import 先例；详见关注项 1 修复方案）；测试锚必须含「敌意输入下 `probeCalls` 为空」分界断言 |
| F-1 | LOW | `reset-archive-after-arm-failed` observer 事件**零测试断言**：internal 测试 A 第三用例标题提及该事件但未接 observer、未断言派发；fatal 分支的 `lifecycle-slot-failed` 派发同样未锚 | internal 测试 360-365 行（标题有、断言无）；grep 全 test 目录无该事件断言 | 交 SA7 动态验证（动态审核重点 3）；或 SA3 修 R-FIX-1 时顺带补一个 observer 断言用例 |
| F-2 | LOW/INFO | 旧 observer 事件 `reset-archive-failed` 在 R2 后**零派发**（基线 registry.ts:1556 派发点被 armed 矩阵取代），union 成员成为死声明；基线无测试锚定该事件故无回归。append-only 纪律下保留成员可接受 | observer.ts:47（仅声明）；git grep 6784645 确认基线派发点 | 登记观察，无需动作（禁止移除成员） |
| F-3 | INFO | fence probe 挂起窗口内 idle-close 可并发翻 lifecycle（entry 无存活 lease 时 idle timer 触发 `runtime.close()`）：fence 任务随后 mismatch 返回时该 generation 已被**无关操作**关闭。reset 自身仍零破坏（mismatch 返回点在 forceRelease 之前），ADR-0009「按当时事实独立结算」相容；但调用方拿到 mismatch + generation 已关的组合语义未经测试 | runtime.ts:250-272（槽内无 lifecycle 复查）；registry.ts:1589（closing 分支只在槽起点检查一次） | 交 SA7 动态验证（动态审核重点 1）；非阻断 |
| F-4 | INFO | `DocPersistedIdentityProbeFatalPhase` 词表含 `'decode'` 但实现从不构造该 phase（decode 失败走 CorruptError——与设计 §3.3.1 表一致，词表仅对齐设计代码块声明） | contract.ts diff（词表）vs lifecycle.ts:407-410（decode → Corrupt） | 无害声明性词汇，登记即可 |
| F-5 | INFO | SA3 报告称敌意矩阵「15 形态」，实际 HOSTILE_INPUTS 为 16 项（多出 missing-epoch-key）——报告计数误差，测试本体无问题 | internal 测试 437-458 行 | 无需动作 |
| F-6 | INFO（scope） | 3 个 `package.json` patch bump（registry 0.1.6 / persistence 0.2.2 / runtime 0.1.10）超出 ALLOW LIST——仓库既有惯例（多任务先例）、SA3 报告明示、纯版本号非行为 | diff --stat；git log 先例 | 追认 |

**Scope Creep Guard（§1.1）结论**：actual − allow − 豁免 = 6 文件，全部有授权链：observer.ts（关注项 4 追认——设计 §3.5.2 明文）、3 个 round-1 测试校准（续跑总控 dispatch #12 明示授权「按 round-1 回流惯例校准…行为断言不削弱」，且 importReplica 四参化结构性强制所有既有调用点适配——§7 caller audit 预判）、3 个 package.json（F-6）。**黑名单零命中**（无 lockfile/.DS_Store/TASK.md/.bak）。设计 ALLOW 中 `namespace-registry/src/index.ts`（无需 barrel 扩张——新 issue 类型经既有 `ImportReplicaIssue` 类型导出流动）与 `namespace-runtime/src/types.ts`（基线不存在，设计笔误，SA3 报告已记录）未改动——ALLOW 是许可非义务。

**CI 触发性自检（§1.3/§1.4）**：根 `pnpm test` = `vitest run --typecheck`（vitest.config.ts include `packages/*/test/**/*.test.ts` + typecheck include `**/*.test-d.ts`）——新增 3 个 `.test.ts` 与 2 个 `.test-d.ts` 全部落入收集范围，PR CI（ci.yml `on: pull_request` → Test step）必然触发。**无 CI 黑洞**。

---

## 三、审核结论（skill 验尸清单）

1. **设计一致性**：⚠️ 一处规范文本偏离（R-FIX-1，§3.2 reset 入口校验）；observer.ts 文件清单簿记缺口（追认）；其余 §2 决策表 R2-D1..D7、§3.4/§3.5 二段 fence 协议、§3.3.1 probe 分类学、§4.2/§4.2.1 import 冻结序、§5 ADR 修订体例**逐项忠实落地**。
2. **读写路径一致性**：✅ 一致（persisted 真相源单点 `readPersistedReplicationIdentity`；live 真相源单点 `state.replication`——与 getStatus 同源）。
3. **静默失败**：✅ 无（所有拒绝/fatal 均有 typed 通道 + observer 记账；唯 F-1 的事件断言缺口）。
4. **降级方案**：✅ 安全（probe 无 live fallback；missing capability loud fatal 无 TypeError）。
5. **极端攻击**：❌ 发现 1 项（R-FIX-1 敌意 reset expected——处置：修复项回流 SA3，非 reject）；import 侧敌意矩阵 16 形态免疫验证通过。
6. **错误处理**：✅ 完整（R-FIX-1 的分类面缺陷已单列）。
7. **架构评估**：✅ 可行（fence 无自等待依赖图推演成立：fenceTask 唯一 await 是外部 readPersisted；barrier 仅经 post-settlement lazy continuation 创建，predecessor tail 不含 fence 任务；sequencer 链尾恒绿保证槽 reject 不毒化 FIFO）。
8. **过度设计**：✅ 精简（变更半径与 §8 预算一致）。

---

## 四、动态审核重点（交 SA7）

1. **fence probe 挂起窗口 × idle-close 并发**（F-3）：无存活 lease 的 entry、fence 挂起期 idle timer 触发 close → mismatch 返回时 generation 已关——验证调用方感知一致性（mismatch + 已关 runtime 组合）与 entry 清理闭环。
2. **窗口 mutation 端到端**（关注项 2 残余）：真实 Registry+Memory 下，「fence 后 arm 前接纳的 bump 排空 → archiveDoc 真实 guard 拒绝 → `NAMESPACE_RESET_FAILED`」全链（当前 Runtime 侧 T4 与 Registry 侧注入式 guard 测试分别覆盖两端，无单测直连）。
3. **`reset-archive-after-arm-failed` observer 事件**（F-1）：真实 armed 失败下的派发时序与 cause 零身份回显。
4. **File adapter probe 真实磁盘路径**：SAFE_PATH_SEGMENT 双段门 + 真实 `.snapshot` 读 + 归档布局 `{rootDir}/archive/users/{userId}/{docId}.snapshot` 落盘验证（Memory 侧已全覆盖，File 侧委托链仅静态核实）。
5. **fence armed 后 archive 挂起窗口 × shutdown 三方并发**：SA7 既有 2c 基础上加压一轮（armed → archive write 挂起 → shutdown），验证双方有界结算与 committed 语义不漂移。
6. **R-FIX-1 修复后回归**（若 SA3 落地）：敌意 reset expected 16 形态 → `NAMESPACE_INVALID_IDENTITY` + probeCalls 空 + 重试成功。

---

## 五、verdict 论证

**pass（带 1 项必须修复）**。核心理由：

- R2-AC-1..6 全部达成且证据扎实：零破坏 preflight（fence 槽线性化 + 三重零破坏断言电池）、双 dirty race 严格拒绝（真实字节级）、import Hub 广告绑定（②c 冻结位 + 敌意输入免疫）、ADR 0006/0010 授权修订（体例含 scope/取代/授权声明）、全量回归绿。
- SA2 R3 红线 5 条、SA8 两条非阻断观察全部有真实实现级证据（非采信报告）。
- 唯一规范偏离 R-FIX-1 具备：零破坏性（全部路径先于 arm）、无 AC 覆盖、最小修复已方案化（SA1 微追加结果通道 + 镜像 import 先例的专用码）——不满足 reject 的「不可靠 pass」门槛（实现的核心安全声明全部经静态验证成立），但也不能静默放行（违反设计硬性禁止项 + 真实误诊向量 + 输入 TOCTOU 面 + 结果通道规格缺口需 SA1 补位）。
- 建议处置路径：SA1 微设计追加（§3.2 结果通道，冻结 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID` 拼写）→ SA2 delta 快速复审 → SA3 落地 R-FIX-1（+F-1 顺带）→ SA4 仅对该增量复审（无需全量重验）→ 进入 SA7 动态验证；若 owner 裁决豁免，须在 wiki 登记设计偏离与理由，且 SA7 动态清单第 6 项作废。
