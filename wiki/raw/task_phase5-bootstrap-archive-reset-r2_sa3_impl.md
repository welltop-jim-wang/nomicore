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

---

## R4 微调段（SA2 delta reject → SA1 R4 微设计 → SA2 复审 pass 后的方案 B 落地）

### 审计采信（SA3 对外部候选实现的独立复核）

外部会话在 commit `1aa1994` 落地的方案 B 候选实现（registry.ts / types.ts / internal 测试 / surface test-d 4 文件 + 本记录段）经 SA3 对照设计 §3.6（R4 冻结）**逐块审计**结果：

| hunk | 审计结论 | 说明 |
|---|---|---|
| types.ts：`InvalidIdentityIssue.field` 回退二元 | ✅ 采信 | 与 §3.6.1 逐字一致（撤销 `'expectedLocalIdentity'` 第三成员） |
| types.ts：`NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE` | ✅ 采信 | 常量文本与 §3.6.1 逐字一致；单一真相源；未进 barrel 值导出 |
| types.ts：`ResetReplicaIssue` append-only 无 field 成员 | ✅ 采信 | code/message 与 §3.6.1 一致 |
| registry.ts：`RESET_EXPECTED_IDENTITY_INVALID_ISSUE` 新码常量 + 入口次序 | ✅ 采信 | 入口次序 = §3.6.2 冻结序（acceptance → validateOpenIdentity → 快照 → 专属 issue → admitResetSlot(snapshot.value)）；零 carrier/entry/probe/archive 触达；快照消除双读分叉 |
| internal 测试：16 形态**完整 toEqual 深等**（code + 导入常量 message + 无 field）+ 常量文本锁 | ✅ 采信并**加强** | §3.6.3 第 1 条「每形态保留 probeCalls=[]/archiveCalls=[]/lease active/Runtime ready」——SA3 将零触达/零破坏断言**逐形态移入循环内**（原为循环后汇总断言；逻辑等价但文字更忠实于冻结规格） |
| internal 测试：`okIssue` 观测面扩展携带 message | ✅ 采信 | 既有 `.code` 消费方零影响（additive） |
| internal 测试：F-1 标题收窄「cause 零身份值回显」 | ✅ 采信 | 断言体保持 cause-scoped（与 §3.6.3 第 5 条一致，不误称整个 event payload 无受控 identity） |
| surface test-d：四 alias field 恒等 + 新码可达无 field 键 | ✅ 采信 | 与 §3.6.3 第 3 条一致（`Equal` 编译期恒等；`InvalidIdentityIssue` 未按名导出，经公开联合 `Extract`） |
| SA3 追加（本轮） | ① §3.6.2 边界行为锚：resetReplica 的 owner/namespace 非法仍返回上游 `NAMESPACE_INVALID_IDENTITY` + 正确二元 field（专属 reset 码不劫持上游身份分类，零触达）；② 标准轴 F-2（registry.ts `beginCloseCurrent` 悬空注释引用 → 现行 fence/lazy-close 名称）；③ 标准轴 F-4（r2-red 头注/标题 SA6 期「临时拼写，待 SA1 冻结」→ 已冻结现状措辞，行为断言零改动） | 设计 §3.6.3 第 4 条 + §3.6.3 标准轴授权 |

### 改动点（与 R4-D1..D3、D-3/D-4 逐条映射）

| 文件 | 改动 | 映射 |
|---|---|---|
| `packages/namespace-registry/src/types.ts` | ① `InvalidIdentityIssue.field` 回退为 round-1 冻结二元联合 `'owner.userId' \| 'namespaceId'`（删除 `'expectedLocalIdentity'` 第三成员；docstring 恢复「open/create 共用」原文）；② 冻结常量区新增 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE`（文本逐字 `'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID: 期望本地复制身份（reset expectedLocalIdentity）不符合安全文法'`，落位镜像 import 侧常量的 R2 增量块尾）；③ `ResetReplicaIssue` append-only 追加 `{ok:false; code:'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID'; message:typeof …}` 成员（**无 field**），docstring 注明触发条件/零 Persistence 触达/零值回显 | **R4-D1**（field 回退，撤销未经授权的第三成员）+ **R4-D2**（新码+专用常量）+ **R4-D3**（append-only 无 field 成员） |
| `packages/namespace-registry/src/registry.ts` | ① `RESET_EXPECTED_IDENTITY_INVALID_ISSUE` 冻结常量形状替换：`ok:false / code:'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID' / message:NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE`（无 field）；② import：新增 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE`、删除不再被引用的 `NAMESPACE_INVALID_IDENTITY_MESSAGE`；③ 入口次序零改动（仅快照失败返回常量），入口注释「沿既有 `NAMESPACE_INVALID_IDENTITY` 通道」表述改为新码专属通道；④ **标准轴 F-2**：`beginCloseCurrent` 悬空注释引用改为现行实现名（`beginIdleClose` I2 记账 + `fence.startCloseAfterFence()` 懒创建 close barrier、closePromise 幂等缓存共用）——注释-only | **R4-D2**（词汇替换）+ 设计 §3.6.2（入口次序不变 + 三码不重合）+ **F-2** |
| `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-internal.test.ts` | ① 敌意 16 形态断言由 `expect(issue.code).toBe('NAMESPACE_INVALID_IDENTITY')` 升级为**完整形状深等** `toEqual({ok:false, code:'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID', message:NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE})`（message 从 `../src/types.js` 导入，按 `registry-create.test.ts` 既有先例；单条断言同锁 code+常量 message+无 field），且 **probeCalls=[]/archiveCalls=[]/lease active/lifecycle ready 逐形态断言**（§3.6.3 第 1 条）；② 补常量文本字面量锁断言；③ describe 标题旧码替换为新码；④ F-1 `it` 标题收窄为「cause 零身份值回显」（断言体零改动）；⑤ `okIssue` 观测面扩展携带 `message`（既有 `.code` 消费方零影响）；⑥ 全部既有行为锚保留：正确 expected 重试成功且首次 probe 恰 1、TOCTOU 冻结样本、observer 恰一次；⑦ **SA3 追加**：owner/namespace 非法 → 上游 `NAMESPACE_INVALID_IDENTITY` + 二元 field 行为锚 | **D-3**（16 形态深等 + 常量文本锁，禁降级单属性断言）+ **D-4**（F-1 标题收窄）+ §3.6.3 第 4 条 |
| `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-surface.test-d.ts` | 公共类型保持锚：`Extract<OpenNamespaceIssue/CreateNamespaceIssue/ImportReplicaIssue/ResetReplicaIssue, {code:'NAMESPACE_INVALID_IDENTITY'}>['field']` 恒等 `'owner.userId' \| 'namespaceId'`（`Equal` 编译期恒等，经公开 result alias——`InvalidIdentityIssue` 未按名导出）；`Extract<ResetReplicaIssue, {code:'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID'}>` 非 never **且 keys 不含 `field`**；既有 4 参数 import / 3 参数 reset 签名锚零改动 | **D-1**（公共声明图回退的可观测保证）+ **R4-D3**（新码成员无 field 的可达断言） |
| `packages/namespace-registry/test/registry-phase5-bootstrap-reset-r2-red.test.ts` | **标准轴 F-4**：头注/契约声明段/describe 标题/`it` 标题的 SA6 期「临时拼写/临时签名，待 SA1 冻结」措辞更新为「已由 R2/R3 设计冻结」现状；**行为断言零改动** | 设计 §3.6.3 F-4 |
| 禁止改动 | `index.ts`（零 barrel 变化——`ResetReplicaIssue`/`ResetReplicaResult` 已在 type 白名单，append-only 成员自然可达；message 常量与 import 侧同纪律不进 barrel）、observer.ts、persistence/runtime 任何文件、ADR、round-1 测试 | 设计 §8 R4 注记（负向声明） |

### 验证命令与结果（SA3 亲跑，全量）

1. `npx tsc -p tsconfig.typecheck.json --noEmit` → **exit 0**（含 surface test-d 类型锚）。
2. `npx vitest run` 全量 → **exit 0；147 文件 / 1760 用例全绿**（1757 基线 + R4 新增 3：internal 新增 owner/namespace 边界锚 1 项 + surface 类型锚 2 项；`Type Errors: no errors`；`.mabf-bg/r4-full.log`）。
3. `git diff --check` 干净；版本号同轮不重复 bump（registry 已 0.1.6）。

### 说明

- 涉及一次中间失败已消除：首版 16 形态深等因 `okIssue` 观测面只回传 `code`（剥离 `message`）而失败——已按「观测面携带 message」修正（设计 §3.6.3「禁止复制字面量/禁降级单属性断言」口径下该失败是断言强度的预期体现，非实现缺陷）；首版 surface `field` 锚以 `['field']` 索引泛型 `Extract` 结果触发 TS 泛型延迟求值错误——改为条件类型 `extends { readonly field: infer F }` 形式，语义等价。
- **工作区并发事件（重要，供总控知悉）**：外部会话执行期间共享仓库 HEAD 不断前进（docs 提交与最终实现提交 `1aa1994`），其间发生过一次工作区重置事件（清除未提交的 SA1 R4 设计文本与首版实现）；外部候选最终以 commit `1aa1994` 落盘，SA3 接手时工作区干净、候选即 HEAD——审计即针对该 commit 内容（与任务简报「未提交候选」描述的状态差异已在审计结论中覆盖）。
- **SA3 最终落盘**：外部候选逐块审计后**全部采信**（无偏离项）；SA3 追加项为 §3.6.3 第 1 条逐形态断言加强、§3.6.3 第 4 条边界行为锚、标准轴 F-2/F-4；最终由 SA3 提交（工作区仅含 SA3 复核后文件）。
