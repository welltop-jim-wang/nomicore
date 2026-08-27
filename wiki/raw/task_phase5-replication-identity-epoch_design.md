# 设计文档 — Phase 5: enable replication identity and epoch management

- **Issue**: #132（welltop-jim-wang/nomicore）
- **任务类型**: 功能开发（feature）
- **Worktree**: /home/wangjian/nomicore-fix-issue-132
- **设计（SA1）**: R2 修订（逐条落实 SA2 R1 全部 3 必修 + 2 建议 + 2 INFO，共 7 项；架构内核
  §4.1-§4.2 分层/槽序/通道归属经攻击验证成立、零回退；修订面 = §2 D-3、§3-9、§4.1.2、§4.2
  E3/E4/E5、§4.3 读取器与判据论证、§4.5 类型落位、§4.6、§4.10.1（新增）、§5 INV-R5/INV-R9、
  §6、§7 ALLOW LIST（追加 2 测试文件）+ SA2 反馈逐条回应表）
- **输入**:
  - 任务简报 `wiki/raw/task_phase5-replication-identity-epoch.md`
  - 相关决议 `wiki/raw/task_phase5-replication-identity-epoch_relevant_decisions.md`（SA8 前置门禁：ADR 0006/0007/0008/0009/0010 摘录 + CONTEXT.md 词汇——本文约束基准）
  - SA6 红灯锚定 `wiki/raw/task_phase5-replication-identity-epoch_sa6_red.md`
    + `packages/namespace-registry/test/registry-phase5-replication-red.test.ts`（14 条运行时用例）
    + `packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts`（6 条类型面契约）
  - SA2 R1 评审 `wiki/raw/task_phase5-replication-identity-epoch_sa2_review.md`（verdict: reject → 本 R2 修订依据）
- **基线**: `7425164 Phase 5: generate namespaceId and migrate Registry identity (#143)`（#131 已交付：entry key=namespaceId、注入式 `RegistryRandomBytes`、`ns-`+32hex 生成纪律）

---

## §1. 任务类型与需求推演

ADR 0010「复制谱系与 epoch」节（accepted）已裁决：META 增加两个复制层保留字段
（`replicationId` = 128-bit 随机值 32 位小写 hex；`replicationEpoch` = 从 1 开始的十进制安全
整数，达 `Number.MAX_SAFE_INTEGER` 拒绝提升不回绕）；hub 对现有 namespace 经显式
`enableReplication()` 原子写入复制身份并登记 dirty；`bumpReplicationEpoch()` 是 hub 显式提升
的权威代际；两字段**只能**由 hub 的显式复制管理操作修改。本票 = 该节 + phase-5 文档
§实施切片 1 复制部分的落地（WS transport / ReplicationSession / bootstrap / archive 均为后续
切片，明确排除）。

**需求推演（Feature 切入点）**——基线三处缺口（SA6 红灯已逐条锚定）：

| # | 基线事实 | 代码位置 | ADR 0010 / SA6 契约要求 |
|---|---|---|---|
| B-1 | `NamespaceLease` 无 `enableReplication()` / `bumpReplicationEpoch()`；`NamespaceRuntime` 十键公共面（owner/namespaceId/read/getSchemaEnvelope/getMetadata/getActiveSchema/getStatus/mutateRoot/replaceSchema/close）无复制管理写 | `packages/namespace-registry/src/types.ts:292`、`packages/namespace-runtime/src/runtime.ts:81` | Lease（调用方唯一能力入口）暴露两操作，返回 `Promise<Readonly<{ok:boolean}>>` 结果联合 |
| B-2 | META 无复制保留字段概念：`create-initial-document` 只写 docId/createdAt；无任何代码读/写/校验 `replicationId`/`replicationEpoch` | `packages/doc-runtime/src/create-initial-document.ts`、全仓 grep 零命中 | enable 单槽单事务原子安装两字段（ADR 0010 冻结格式）；epoch 从 1、溢出拒升 |
| B-3 | `NamespaceRuntimeStatus` 恰七键（lifecycle/read/rootWrite/schemaWrite/schema/fatal/close），无复制域 | `packages/namespace-runtime/src/status.ts:29` | status 增 `replication: {state:'disabled'} \| {state:'enabled'; replicationId; replicationEpoch}`（runtime 包与 registry 投影双侧同构） |

推演结论：这是一次**沿既有写管线 Discipline 的加法扩展**——两个新受控 Y.Doc 写进入唯一
write sequencer（ADR 0008 槽序逐位沿用），一个新 status 域进入既有投影，一个新 Lease 能力。
变更半径 = `packages/namespace-runtime`（写槽 + status + 公共面）+ `packages/namespace-registry`
（Lease 代理 + 随机源编排）+ 既有键集锁测试的机械迁移。Persistence / doc-runtime / vfsl /
apps 零改动；无跨包生产消费者（`apps/` 空壳、全仓无 `enableReplication` 引用）。

## §2. 设计决策总表

| # | 决策 | 章节 |
|---|---|---|
| D-1 | **随机源归属 Registry 层**：replicationId 由 Registry 已注入的 `randomBytes`（#131 交付的 `RegistryRandomBytes`）在 Lease 接纳段同步抽取，作为**值输入**传入 Runtime 写槽；Runtime 包零随机依赖、`/internal` 工厂签名不变（仍 2 参）。核心零全局 crypto（ADR 0009 修订节 3 同款纪律 + phase-5 切片 1「核心不得直接调用不受控全局 crypto」） | §4.1 |
| D-2 | Runtime 新增第三类写槽 `replication`：`enableReplication(input)` / `bumpReplicationEpoch()` 与 mutateRoot/replaceSchema 共享同一 `WriteSequencer` 实例，槽序 E1–E7 逐位镜像 ROOT 写槽（fatal gate → writable+notifier gate → 输入校验 → 领域事实读取 → 单 Yjs transaction → 同槽 `await notifyDirty()` → 槽释放） | §4.2 |
| D-3 | META 保留字段格式与事实读取单点 `readReplicationFacts(doc)`：**以 `meta.has(k)` 区分键存在/缺席**——两键真缺席 → disabled；两键存在且值/格式合法 → enabled；**恰一键存在、键存在而值为显式 undefined、格式违约或载体异型 → `NSRT-REPLICATION-META-CORRUPT` loud**（构造期 = 零副作用构造 throw；槽内 = internal fatal committed:false）——拒绝虚假降级【R2 修订，SA2 #1】 | §4.3 |
| D-4 | status 复制域：`RuntimeState` 增 `replication` 事实字段（构造期 V2.5 从 live META 单次读取预投影；enable/bump 槽 E5.5 事务提交后同步整替）；`buildStatus` 每次调用全新深冻结投影；**无第三态**（SA6 类型锚锁死两态联合） | §4.4 |
| D-5 | enable 幂等语义 = 结果联合 `{ok:true}`：已启用命名空间再 enable → 零写入、零 dirty 通知、身份/epoch 不变（AC-3 二选一中取幂等路径，文档化为稳定结果）；bump 前置于 disabled → `REPLICATION_NOT_ENABLED` 结果面拒绝 | §4.2/§4.8 |
| D-6 | overflow = 结果面 `ok:false`（`REPLICATION_EPOCH_OVERFLOW` 稳定文案），**绝不计算/存储 MAX+1**；与 SA6 锚定「结果面拒绝、绝不回绕」一致，零回流 | §4.2/§4.8 |
| D-7 | Lease 增两方法（released → `RELEASED_ISSUE` 同款通道）；`createLeaseController` 增第 4 参 `deps.drawReplicationId`（包内签名扩展，唯一 caller = registry.ts `issueLease`）；随机源抽取失败 = 结果面 `REPLICATION_RANDOM_SOURCE_INVALID`（不同步 throw、不走 rejection——Lease 写操作纪律「一切拒绝经返回的 Promise 结算」） | §4.5 |
| D-8 | 类型面：runtime 导出 `EnableReplicationInput`/`EnableReplicationResult`/`BumpReplicationEpochResult`/`ReplicationManagementIssue`/`NamespaceRuntimeReplicationStatus` 类型（值导出面**零新增**——`Object.keys` 审计锚保持恰一键）；registry `types.ts` 以结构复制型 + runtime 结果类型组合表达（沿 `MutateRootResult` 先例，declaration 审计禁词零触碰）；`NamespaceRuntimeStatusProjection` 与 `NamespaceRuntimeStatus` 同步加 `replication` 域（lease.ts Equal 断言双向锁死） | §4.6 |
| D-9 | fatal 域：`WriteSlot` 词表扩 `'replication'`，新稳定码 `NSRT-FATAL-REPLICATION-WRITE-INTERNAL`（status.fatal 诊断不失真）；`RuntimeWriteFatalPhase` 零新增（复用 `write-slot-internal`/`unknown-pipeline-throw`/`notify-dirty-failed` 三相位）；notify-dirty 失败 → `RuntimeWriteFatalError('notify-dirty-failed', committed:true)` + E5.5 已更新的复制事实**不回滚**（诚实 committed 事实） | §4.2/§4.8 |
| D-10 | 普通业务写 zero-touch 复制字段 = **结构性保证，零新代码**：`applyValidatedMutation` 的读写面钉死在 `doc.getMap('ROOT')` 全量重建 + `validateLogicalSnapshot` 封闭校验（顶层未声明键即拒），META/SCHEMA 是 ROOT 兄弟条目、不在 mutateRoot 路径可达面内；`['META','replicationEpoch']` 路径经 schema 校验拒绝（红灯用例即此机制） | §4.9 |
| D-11 | 既有键集锁测试机械迁移：runtime 十键→十二键、status 七键→八键、lease 十键→十二键（+asyncDispose 符号键不变）；所有以 `NamespaceRuntime`/`NamespaceRuntimeStatus` 显式定型的测试 fake 补 replication 域与两方法 | §4.10 |
| D-12 | Persistence / doc-runtime / vfsl / `internal.ts` / `sequencer.ts` / `close.ts` / `plugin.ts` / testing.ts / apps / wiki ADR 文档**全部零改动**（ADR 0010 即本票的规范来源，无需对齐性修订；CONTEXT.md 词汇已就位） | §4.10/文件清单 |

## §3. 现状关键事实（设计依据的代码锚点）

以下事实已在设计期逐行核实（基线 `7425164`）：

1. **唯一 write sequencer**：`packages/namespace-runtime/src/sequencer.ts:38` `enqueue<T>(run)` ——
   promise-chain 尾接尾、前项 settle 后项方启、链尾恒绿；P0 是队首真实节点
   （runtime.ts:190）。mutateRoot/replaceSchema/close barrier 均经同一实例（runtime.ts:241/251/262）。
   新写槽挂接同一实例即获得全部 FIFO/屏障性质——零排序新机制。
2. **ROOT 写槽序（S1–S7，write.ts:77）**：S1 fatal gate（零输入访问）→ S2 writable gate
   （`handle.getStatus()!=='ready'` → `disabled()`；notifyDirty 未绑定 → `disabled()` loud）→
   S3 受控输入快照 → S4 执行时 active schema → S5 领域校验 + 单事务 → S6 同槽
   `await notifyDirty()` → S7 槽释放。SCHEMA 写槽（schema-write.ts:102）同构，S5.5 在事务后、
   notifyDirty 前**同步**安装 active tools（installActive）——「提交事实先于通知挂起窗口可观测」
   的既有先例，本设计的 E5.5 复制事实更新照抄该时序。
3. **fatal 机械（write.ts:184-230）**：`markWriteFatal(env, cause, slot)` 同步先行置
   `state.fatal`（稳定 code/message，不插值原始异常）→ committed:true 时 best-effort
   notifier 恰一次 → throw `RuntimeWriteFatalError(phase, committed, writeFatalMessage(slot,…))`。
   `disabled(reason)`（write.ts:171）产出 `{ok:false, issues:[{message:'RUNTIME_WRITE_DISABLED: …', path:[]}]}`——
   红灯用例以 `JSON.stringify(result)).toContain('RUNTIME_WRITE_DISABLED')` 判定，结果联合通道复用即满足。
4. **status 组装（status.ts:46）**：`buildStatus(handle, state)` 每次调用全新对象；键集恰七键；
   writableNow 仅 ready 期短路观察。`RuntimeState`（p0.ts:35）是闭包私有唯一可变源，P0/lifecycle/
   写槽各写各的域。**加法扩域的先例**：#92 曾以同款方式加 `close` 第七键并同步迁移键集锁测试。
5. **构造序（runtime.ts:148）**：V1 形状守卫（captureSeamInput，一切 seam 读取限构造栈内、
   入队前）→ V2 状态门（throw = 零副作用）→ V3 env 一次成型 + P0 入队 + 公共面 freeze。
   构造 throw 路径零副作用（INV-N4）——本设计 V2.5 的 META 读取是**纯读**（`doc.share.has` +
   `getMap` + 两次 `get`），throw 前零写入，满足同一不变量。
6. **`/internal` 工厂（internal.ts:27）**：`createNamespaceRuntimeForRegistry(handle, notifyDirty)`
   恰 2 参、纯委托。**红灯 fatal 用例以 2 参调用并要求 enable 成功**（red.test.ts:484-489）——
   这是随机源必须经值输入（而非构造注入）的直接证据（详见 §4.1 论证）。
7. **Registry 随机源（registry.ts:141-155/479/539）**：`randomBytes` 构造期形状门禁（缺失/
   非函数 → 同步 TypeError，禁全局 fallback）；`generateNamespaceId` 每次 `randomBytes(16)` →
   `ns-`+32 小写 hex，形状违约 → `throwIdGenerationFatal`（committed:false）。replicationId
   复用同一注入源与同一编码纪律（无 `ns-` 前缀、无重试环——见 §4.1.2）。
8. **Lease（lease.ts:64）**：`createLeaseController(entry, observer, onReleased?)` 三参，唯一
   caller = registry.ts:659 `issueLease`；released 逐方法通道（read 结果联合 / getter throw /
   两写 `Promise.resolve(RELEASED_ISSUE)` / getStatus 恒成功）；类型级 Equal 断言锁死 public
   alias 与 Runtime 能力逐字段相等（lease.ts:142-169）。
9. **投影与 META 深拷贝（projection.ts:138）**：`projectMetadata` 全键深拷贝、载体缺席/异型
   loud（NSRT-META-E2）、值域违规 loud（NSRT-META-E1）、proto-key 经 putPlainKey。复制保留
   字段是 plain string/number → **getMetadata 零改动即投影两字段**（AC-1 的 META 面自动满足）。
   键缺席/显式 undefined → 键省略（projection.ts:32 冻结语义）——**该省略语义仅属 SCHEMA 四键的
   公共投影输出面，本设计的复制事实读取不沿用**（R2 修订，SA2 #1：SCHEMA 面的宽容有 compile
   ENV-2 下游兜底且无状态变迁后果；复制面的宽容直接导向静默换谱系——详见 §4.3 判据论证）。
10. **mutateRoot 的 META 不可达性（doc-runtime/src/mutation.ts:49-75）**：
    `applyValidatedMutation` = extract ROOT 快照 → `validateLogicalSnapshot`（封闭校验，顶层
    未声明键即 issue）→ JSON clone + apply → 再校验 → `buildTopEntries` → 单事务全量重建
    `doc.getMap('ROOT')`。META 是 ROOT 兄弟条目，路径空间与重建面均不可达——zero-touch 为
    结构性事实。
11. **declaration 审计（registry-surface.test.ts:41-205）**：主入口可达声明图文本禁词
    `/\bNamespaceRuntime\b/`、`DocHandle`、`Y.Doc`、internal subpath 字面量；主入口运行时
    export keys 恰九值冻结。本设计 registry 侧新增均为类型（type-only，运行时导出面零变化），
    且沿 `MutateRootResult` 从 `@nomicore/namespace-runtime` 类型导入的既有先例——禁词零触碰
    （`NamespaceRuntimeReplicationStatus` 等含前缀但非 `\bNamespaceRuntime\b` 整词匹配）。
12. **键集锁测试**（必须机械迁移，见 §4.10）：`runtime-close-lifecycle.test.ts:160`（runtime
    恰十键）、`:495`（status 恰七键）；`runtime-registry-internal-seam.test.ts:270`（十键）；
    `registry-open.test.ts:907`（lease 十键 + asyncDispose）；显式定型 fake：
    `registry-open.test.ts:162-191`（`READY_STATUS: NamespaceRuntimeStatus` + `makeRuntime(): NamespaceRuntime`）、
    registry-idle/shutdown/surface/sa7-concurrency/sa7-rev1/sa7-hostile 同族。
13. **红灯用例的驱动面**：stub/真实 Persistence 全确定性；fatal 用例经
    `runtimeFactory` 注入可失败 notifier（red.test.ts:483-489）；degraded 用例经 memory
    persistence 可失败 `writeSnapshot` + `flushAll`；close 竞态经 `registry.shutdown()`。
    全部驱动面在既有基建内，零新测试依赖。

## §4. 详细设计

### §4.1 分层与能力归属：随机源在 Registry，安装权在 Runtime（D-1）

**结论**：`lease.enableReplication()` 在 Lease 接纳段（同步、released 检查之后）调用
Registry 私有 `drawReplicationId()` 抽取 32 位小写 hex，将其作为**值输入**传给
`runtime.enableReplication({ replicationId })`；Runtime 写槽只做格式校验与原子安装。
`runtime.bumpReplicationEpoch()` 无输入。

**论证（为什么随机源不能在 Runtime 层注入）**：

| 候选 | 判定 | 依据 |
|---|---|---|
| (a) Runtime 构造注入 `randomBytes`（`/internal` 工厂加第 3 参，缺省拒绝） | ❌ 与红灯契约冲突 | red.test.ts:484-489 以 **2 参** `createNamespaceRuntimeForRegistry(handle, notifier)` 构造 Runtime 并要求 `enableReplication()` 成功且产出合法 32-hex——第 3 参缺省即无法抽取；SA6 契约面（红灯用例）不可回流 |
| (b) Runtime 构造注入 + 缺省回退全局 `crypto` | ❌ 违反注入纪律 | ADR 0009 修订节 3「核心不得回退到全局随机源」；phase-5 切片 1「核心不得直接调用不受控全局 crypto」；SA6 锚点 10「注入式，禁全局 fallback」 |
| (c) Runtime 槽内直调 `node:crypto` / `crypto.getRandomValues` | ❌ 同上 | 同 (b)；且 Runtime 包为 Host 无关核心，引入 Node/全局依赖破坏包边界 |
| **(d) Registry 层抽取 + 值输入（本设计）** | ✅ | Registry **已经持有** #131 注入的 `randomBytes`（registry.ts:488）——零新注入点、零新 capability；随机纪律（受控 CSPRNG、构造期门禁、禁 fallback）全部继承；Runtime 保持纯函数式输入校验（与 mutateRoot 收 mutation、replaceSchema 收 envelope 同构——公共写方法收领域载荷是既有范式） |

**(d) 的 Hub-only 语义论证**：ADR 0010「`META.replicationId` 与 `META.replicationEpoch` 只能
由 hub 的显式复制管理操作修改」在本票的可锚定面 = SA6 锚点 6（「独占写面即本票可锚定的
Hub-only 语义」；peer 角色拒绝属后续切片）。Runtime 的 `enableReplication`/`bumpReplicationEpoch`
与 `replaceSchema`（同为 hub 管理面：ADR 0010「SCHEMA 只允许 hub 的本地 replaceSchema() 修改」）
处于完全相同的暴露层级：生产中唯一构造/持有 Runtime 的是 Registry（`/internal` subpath 的
模块边界审计强制，internal.ts:5-7），公共入口不导出工厂；调用方唯一可达面是 Lease 两方法。
与 SCHEMA 写面先例的一致性即架构一致性论证。

**§4.1.1 抽取时机与 FIFO**：抽取发生在 Lease 方法调用的同步段（released 检查后、委托前）。
`Promise.all([enable(), bump(), bump()])`（red.test.ts:348）三调用同步依次执行：enable 抽取
id → `runtime.enableReplication` 接纳门 → `sequencer.enqueue`（槽 1）；bump → enqueue（槽 2）；
bump → enqueue（槽 3）。接纳序 = 槽序 = 通知序 `[1,2,3]`——与 mutateRoot 的「同步接纳定序」
（runtime.ts:239-241）逐字节同机制。抽取本身零 await、零副作用（`randomBytes(16)` 同步），
不改变任何时序。

**§4.1.2 `drawReplicationId()`（registry.ts 新私有函数）**：

```ts
// registry.ts（包内私有；与 generateNamespaceId 并列，不共享实现——失败通道不同，见下）

// 【R2 修订，SA2 #3】registry 本地结构守卫常量——沿 NAMESPACE_ID_PATTERN（registry.ts:142）
// 本地常量先例。跨包 import 对方模块级常量不可达（registry 只能 import runtime 的 index 面，
// 而该 RegExp 是值导出——从 index 导出会击穿 runtime-acceptance-exports-audit.test.ts:29
// 「值导出恰一键」冻结审计）；两份副本互为结构守卫（注释互相引用对方落点）：
//   runtime 侧：packages/namespace-runtime/src/replication-write.ts REPLICATION_ID_PATTERN
const REPLICATION_ID_PATTERN = /^[0-9a-f]{32}$/;

// 【R2 修订，SA2 #6a】类型落位 lease.ts（deps 第 4 参的消费方）并包内导出；registry.ts 经
// 既有 './lease.js' import 引用——registry → lease 单向 import 已存在（registry.ts:64），
// 零循环；不落 types.ts（避免为主入口可达声明图新增内部形状声明）。
// （签名见 §4.5：lease.ts export type ReplicationIdDraw = …）

function drawReplicationId(): ReplicationIdDraw {
  let bytes: unknown;
  try {
    bytes = randomBytes(16);                    // 与 namespaceId 同一受控源、同一 16 字节契约
  } catch {
    return { ok: false, issue: { message: REPLICATION_RANDOM_SOURCE_INVALID_MESSAGE, path: [] } };
  }
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    return { ok: false, issue: { message: REPLICATION_RANDOM_SOURCE_INVALID_MESSAGE, path: [] } };
  }
  let hex = '';
  for (let i = 0; i < 16; i += 1) hex += bytes[i]!.toString(16).padStart(2, '0');
  return REPLICATION_ID_PATTERN.test(hex)
    ? { ok: true, replicationId: hex }          // 结构守卫：非法产物结构性无法离开抽取器
    : { ok: false, issue: { message: REPLICATION_RANDOM_SOURCE_INVALID_MESSAGE, path: [] } };
}
```

- **无重试环**：namespaceId 的 8 次重试针对的是「Registry entry / Persistence duplicate 的
  瞬态碰撞」；replicationId 不是任何 map 的 key、无碰撞检测面（128-bit 概率唯一，ADR 0010
  「namespaceId 的概率全局唯一由生成策略负责」同款论证）——重试无语义。
- **不与 `generateNamespaceId` 合并实现**：create 路径的随机源违约 = `NamespaceRegistryFatalError
  ('create','namespace-id-generation',false)`（orchestration 级 rejection，#131 冻结行为零回归）；
  enable 路径的随机源违约 = Lease 写操作结果联合 issue（§4.5——写操作纪律「任何拒绝经返回的
  Promise 结算」）。两者的失败通道不同，共享实现会迫使其一让步；共享的只有 16 字节契约与
  hex 编码形态（6 行重复是有意为之，注释互相引用）。
- `REPLICATION_RANDOM_SOURCE_INVALID_MESSAGE` 为 types.ts 稳定 message 单点表新常量（零值回显）。

### §4.2 Runtime 复制写槽（D-2/D-5/D-6/D-9）

新模块 `packages/namespace-runtime/src/replication-write.ts`，与 write.ts/schema-write.ts 并列。
`WriteSlot` 词表（write.ts:71）扩为 `'root' | 'schema' | 'replication'`（append-only，缺省
'root' 渲染逐字节不变——`runtime-write-fatal-message-rev1.test.ts` 子串锚零回归）。

**槽序 E1–E7（enable 与 bump 共用机械，差异仅在 E3/E4/E5）**：

```
E1 fatal gate（零输入访问）：state.fatal 已置位 → disabled('fatal 已置位（…）')
    [lifecycle gate 半边已兑现于公共方法接纳层（runtime.ts D5.1 同款）；槽内不设——
     已接纳任务无条件排空（ADR 0008）]
E2 writable gate + notifier 绑定检查（零输入访问）：
    handle.getStatus() throw → rejectWithWriteFatal(env,false,'write-slot-internal',err,'replication')
    handleStatus !== 'ready' → disabled('DocHandle 状态 … 不可写（persistence-degraded 阻止
        全部 Y.Doc 写；released/disposed 同拒）')   ← degraded 红灯用例的拒绝面
    notifyDirty === undefined → disabled('notifyDirty 未绑定——…')   ← loud gate，非静默降级
E3 输入校验（enable 专属；bump 无输入）——【R2 修订，SA2 #2：单读捕获 + 全探测异常收编】：
    try {
      const replicationId = (input as { replicationId?: unknown }).replicationId;
      //   ↑ 恰一次属性读（捕获）——此后本槽零再读 input：E5 消费同一捕获常量。
      //     Proxy get trap 双读分叉（首读合法 32-hex、次读 'ZZZ'）在此结构性不可达——
      //     非法值无法穿越 E3 格式门直入 META（INV-R9 第二重守卫闭合）。
      形状门（全部作用于捕获值与元数据探测，零第二次值读取）：
      input 非 object / 为 null、Object.keys(input) own 键集 ≠ {replicationId}、
      捕获值非 string、不匹配 /^[0-9a-f]{32}$/（runtime 侧模块级常量）
        → { ok:false, issues:[{message:'REPLICATION_INPUT_INVALID: …', path:[]}] }
    } catch {
      return { ok:false, issues:[{message:'REPLICATION_INPUT_INVALID: …', path:[]}] };
      //   ↑ 敌意 Proxy/getter/ownKeys trap 的任何 throw 收编为类 B issue（结果联合结算）——
      //     绝不裸 reject 原始 TypeError（击穿 INV-R7 二通道纪律）、绝不升格 fatal
      //     （防「一次敌意 value → 永久禁写」DoS——write.ts:248 snapshotMutation 立法注释同源）。
    }
    ——「单读捕获」= 受控 snapshotter 纪律（S3/copyFrozen 立法）在不可变标量载荷上的最小实现：
      快照器职责有二——深结构复制（对 string 载荷退化为恒等，copyFrozen 确实不适用）与
      「敌意陷阱中和 + 槽起点一次读取后零再读」（对 string 载荷 = 单读捕获 + 探测全 try/catch）。
      R1 以「string 无快照语义」跳过后者是把两个职责混为一谈（SA2 #2 指正）；本修订补齐第二职责，
      与 SCHEMA 写槽 S3「快照后形状检查」的等价性由此锚定。
E4 领域事实读取（从 live META 读取执行时事实——镜像 S4「执行时 active schema」纪律）：
    facts = readReplicationFacts(doc)（§4.3；三出口）：
      · throw（恰一键存在 / 键存在而值 undefined【R2，SA2 #1】/ 格式违约 / 载体异型）→
        rejectWithWriteFatal(env,false,'write-slot-internal', cause,'replication')——槽内不变量
        破坏 = internal fatal（镜像 write.ts S4 结构性不可达分级：doc 在唯一 sequencer 之外
        被改写 = 包缺陷，loud，不静默）
      · {state:'disabled'}：
          - enable：二次纯读 doc.share.has('META')【R2，SA2 #6b：载体在场信号的获取点——读取器
            签名只返回公共两态 status，槽体在 E4 同步段内二次 share.has 判别（两读之间零 await，
            JS 单线程 run-to-completion，无 TOCTOU 面）】→ 仍 false →
            { ok:false, issues:[REPLICATION_META_ABSENT] }（零写入——拒绝在无 docId 的 META 上
            凭空造载体，防「下次 loadDoc 被 META.docId 校验击穿」的真实损坏；生产不可达，
            seedForTest 设施专用防御）；true → 走 E5 安装
          - bump：→ { ok:false, issues:[REPLICATION_NOT_ENABLED] }（零写入；两键真缺席与
            载体缺席在此同拒——无谱系即无代际可提升）
      · {state:'enabled', replicationId, replicationEpoch}：
          - enable：→ return { ok:true }（幂等：零事务、零 notifyDirty、身份/epoch 不变；
            调用方传入的 replicationId 被弃用——见 §4.9 边界决策 3）
          - bump：epoch >= Number.MAX_SAFE_INTEGER → { ok:false, issues:[REPLICATION_EPOCH_OVERFLOW] }
            （结果面拒绝；**判据先于任何 +1 运算**——MAX+1 永不被计算、永不入存储，无回绕面）；
            否则走 E5
E5 单 Yjs transaction（本槽唯一 Y.Doc 写入口）：
    enable：doc.transact(() => { meta.set('replicationId', replicationId);
    //                                    ↑ E3 捕获常量（SA2 #2：绝不重读 input——双读分叉结构性不可达）
                                 meta.set('replicationEpoch', 1); })   ← 两键同事务 = 原子安装
    bump：  doc.transact(() => { meta.set('replicationEpoch', facts.replicationEpoch + 1); })
            （replicationId 不触碰——身份不可变；facts.replicationEpoch <= MAX-1 已由 E4 保证，
             +1 后 <= MAX 恒安全整数）
    transaction throw → rejectWithWriteFatal(env,true,'unknown-pipeline-throw',err,'replication')
    （保守 committed:true——ADR「未知异常保守视为可能已提交」过报方向强制，镜像 write.ts S5；
     该路径 E5.5 被跳过 → status.replication 可能陈旧于 live META，见 INV-R5 登记的例外窗口）
E5.5 复制事实同步整替（transaction 返回后、await notifyDirty 之前——镜像 SCHEMA 槽 S5.5
    installActive 时序）：state.replication = Object.freeze({ state:'enabled', replicationId,
    replicationEpoch: <新值> })。notifier 挂起窗口内 status 已可观测提交事实；notify-dirty
    失败路径**不回滚**（committed 事实诚实——红灯 fatal 用例断言 META=epoch2 即此保证）。
E6 同槽 await notifyDirty()（完成信号 = live commit + dirty 登记两者——每提交槽恰一次通知）：
    失败 → markWriteFatal(env,err,'replication') + throw new RuntimeWriteFatalError(
      'notify-dirty-failed', true, writeFatalMessage('replication','notify-dirty-failed',true),
      { cause: err })
E7 槽释放：return { ok: true }（promise settle；sequencer 自动放行下一项）
```

**dirty 通知映射**（ADR 0006「saveDoc = Doc 每次变更后的脏通知」）：enable 安装槽 → 恰 1 次；
bump 提升槽 → 恰 1 次；幂等再 enable → 0 次（无变更即无通知——红灯 AC-2 用例锚
`saveEvents).toHaveLength(3)` 对 `[enable,bump,bump]` 恰好成立）；overflow/not-enabled/absent
拒绝 → 0 次（零写入零通知）；fatal 已置位/degraded/未绑定 notifier 拒绝 → 0 次。

**与 schema 状态正交**：E 序不读 `state.schemaState`——复制管理写是 META 层操作，不依赖
active schema 可编译（preparing/unavailable 期照常接纳排队，镜像「早期写排在 P0 后」的
rootWrite 语义；红灯用例均在 schemaReady 后调用，此为超集兼容）。

**公共方法接纳层（runtime.ts，镜像 mutateRoot D5.1）**：

```ts
enableReplication: (input: EnableReplicationInput): Promise<EnableReplicationResult> => {
  if (state.lifecycle !== 'ready') {
    return Promise.resolve(disabled(lifecycleWriteRefusal(state.lifecycle)));  // 零入队、零输入访问
  }
  return sequencer.enqueue(() => runEnableReplicationSlot(replicationWriteEnv, input));
},
bumpReplicationEpoch: (): Promise<BumpReplicationEpochResult> => {
  if (state.lifecycle !== 'ready') {
    return Promise.resolve(disabled(lifecycleWriteRefusal(state.lifecycle)));
  }
  return sequencer.enqueue(() => runBumpReplicationEpochSlot(replicationWriteEnv));
},
```

`replicationWriteEnv` 构造栈一次成型（V3c''''，与 writeEnv 同批捕获局部量：`doc/handle/state/
notifyDirty`）——纯数据闭包，槽体零读 seam 输入（INV-N14 延续）。

### §4.3 META 保留字段：格式、事实读取与损坏判据（D-3）

**格式冻结（ADR 0010 唯一权威）**：

```ts
export const REPLICATION_ID_PATTERN = /^[0-9a-f]{32}$/;   // 128-bit 随机值，32 位小写 hex
// replicationEpoch：Number.isSafeInteger(v) && v >= 1；上限 Number.MAX_SAFE_INTEGER（拒升不回绕）
```

**`readReplicationFacts(doc): NamespaceRuntimeReplicationStatus`（replication-write.ts 导出，
两个消费方共享单点）**：

```ts
export function readReplicationFacts(doc: Y.Doc): NamespaceRuntimeReplicationStatus {
  if (!doc.share.has('META')) return Object.freeze({ state: 'disabled' });
  //   ↑ 载体缺席 = 无保留字段 = 事实性 disabled（纯读取判据；不惰性 getMap——零副作用，
  //     与 projectSchemaEnvelope ① 同款守卫）。这不是虚假降级：'disabled' 是关于
  //     「复制身份是否已安装」的真命题；META 载体缺席本身的 loud 面在 getMetadata
  //     （NSRT-META-E2）保留，双通道互不掩盖。
  let meta: Y.Map<unknown>;
  try {
    meta = doc.getMap('META');               // 载体异型（同名 Y.Text 等）→ throw
  } catch (err) {
    throw new ReplicationMetaCorruptError('载体异型', err);
  }
  const hasId = meta.has('replicationId');   // R2 修订（SA2 #1）：以 has() 区分「键存在」与「键缺席」
  const hasEpoch = meta.has('replicationEpoch');
  //   ↑ Yjs 语义（SA2 实证，yjs 13.6.32）：meta.set(k, undefined) 后 has()===true 且 get()===undefined，
  //     且该状态经 Y.encodeStateAsUpdate/applyUpdate round-trip 持久化存活——「键存在而值 undefined」
  //     是可持久的损坏形态，不是瞬态；唯一合法写入面 E5 永不写 undefined，故该形态与「恰一键存在」
  //     同属「部分存在/格式违约」损坏家族（见下方判据论证），必须 loud，绝不判 disabled。
  if (!hasId && !hasEpoch) return Object.freeze({ state: 'disabled' });   // 两键真缺席
  if (!hasId || !hasEpoch) throw new ReplicationMetaCorruptError('恰一键存在');
  const id = meta.get('replicationId');
  const epoch = meta.get('replicationEpoch');
  if (id === undefined) {
    throw new ReplicationMetaCorruptError('replicationId 键存在而值为显式 undefined');
  }
  if (epoch === undefined) {
    throw new ReplicationMetaCorruptError('replicationEpoch 键存在而值为显式 undefined');
  }
  if (typeof id !== 'string' || !REPLICATION_ID_PATTERN.test(id)) {
    throw new ReplicationMetaCorruptError('replicationId 格式');
  }
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1) {
    throw new ReplicationMetaCorruptError('replicationEpoch 格式');
  }
  return Object.freeze({ state: 'enabled', replicationId: id, replicationEpoch: epoch });
}
```

**「disabled 仅限两键真缺席」的判据论证（R2 修订，SA2 #1——为什么不能沿用 SCHEMA 面的
键省略宽容）**：projection.ts:32 的「键缺席/显式 undefined → 键省略」是 SCHEMA 四键**公共投影
输出**的省略语义——其宽容有 compile ENV-2 下游兜底（缺键进编译门即数据级 unavailable），
且不触发任何状态变迁。复制面不具备这两个安全网，宽容的直接后果是三重立法违背：

1. **静默换谱系**：双键存在而值 undefined 的文档被判 disabled → 随后 enable 静默安装全新
   谱系并重置 epoch=1——「replicationId 是 namespace 不可变的复制谱系身份」（ADR 0010）被
   无声击穿，下游只能靠 wire 身份核对事后发现（本设计 §6 末行「绕道写入在下次 open 即响亮
   失败」的纵深防御承诺对该形态不成立）。
2. **自相矛盾**：本节立法自检称「两键要么都不在、要么都在且合法应恒真」——键存在而值
   undefined 正是该不变量的违约成员（唯一合法写入面 E5 永不写 undefined），按本设计自己的
   unreachable-即-corrupt 逻辑应 loud。
3. **双读者分歧**：同一文档上 `getMetadata()` 对 undefined 值 loud throw NSRT-META-E1
   （projection.ts:182-183——META 值域对 undefined 是 loud），而 status.replication 说
   disabled——两个只读面对同一持久事实给出相反判断。

**损坏判据的立法依据（拒绝虚假降级）**：两字段是 ADR 0010 冻结格式的**保留字段**，唯一合法
写入面是本设计的受控写槽（写入前双过格式门）；因此「恰一键存在 / **键存在而值显式
undefined** / 格式违约 / 载体异型」在生产路径结构性不可达，出现即持久化损坏或包缺陷——与
ADR 0006 对 `META.docId` 不一致「视为持久化损坏并响亮失败」同族。**判别标准自检**：「功能
完备的项目里，META 两键要么都不在（真缺席）、要么都在且值合法——这个条件应该总是为 true
吗？」是。→ 不是降级场景，是 bug → loud，不设计静默降级。

**两个消费方的通道差异（同一 loud 度，不同层纪律）**：

| 消费方 | 位置 | ReplicationMetaCorruptError 的归宿 |
|---|---|---|
| 构造期 V2.5（预投影，§4.4） | runtime.ts 构造栈 | 构造 throw（零副作用，INV-N4）→ Registry `factory` catch → `open-runtime-construction-failed` observer + `NamespaceRegistryFatalError('open','runtime-construction',…)` reject——open 即响亮失败（fail-fast，镜像 DocHandle 状态门 throw 的既有通道） |
| 写槽 E4 | replication-write.ts | 槽内 internal fatal（`write-slot-internal` + slot 'replication'，committed:false——此时尚零 doc 写）→ `RuntimeWriteFatalError` rejection + status.fatal 永久置位 |

**运维诊断对照（R2 修订，SA2 #7——记录性说明，不改判）**：两类「持久化损坏」走不同通道——
`META.docId` 损坏在 Persistence loadDoc 层检测 → `NAMESPACE_LOAD_FAILED` **结果 issue**（运营
故障面，可重试 open）；复制保留字段损坏在 Runtime 构造门检测 → `NamespaceRegistryFatalError
('open','runtime-construction')` **rejection**（internal 面）。差异源自检测层不同（persistence
校验 vs Runtime 构造门），两者均 loud 且均已文档化；诊断「namespace 打不开」时应两个通道都查。

**预启用种子文档**（红灯 overflow 用例：`makeSeedDoc('ns-seeded-overflow',
{replicationId:'f'.repeat(32), replicationEpoch:MAX})`）：V2.5 读取 → `enabled('f'×32, MAX)` →
open 后 status 即 enabled——AC-1 投影面在 P0 之前已就绪（复制域不依赖 schema 编译）。

### §4.4 status 复制域（D-4）

**RuntimeState 增域**（p0.ts）：

```ts
export interface RuntimeState {
  …
  /** 复制身份事实（构造期 V2.5 单次预投影；enable/bump 槽 E5.5 整替——唯一两写入点，
   *  均在唯一 write sequencer 内或构造栈内，JS 单线程零竞态；读取面零写）。 */
  replication: NamespaceRuntimeReplicationStatus;
}
```

**构造期 V2.5（runtime.ts，V2 状态门之后、V3 env 成型之前）**：

```ts
// V2.5 复制事实预投影（纯读：share.has + getMap + has/get 探测——R2 修订后含键存在性判别；
// throw = 零副作用构造拒绝）
const replicationFacts = readReplicationFacts(doc);
const state: RuntimeState = { schemaState: 'preparing', lifecycle: 'ready', replication: replicationFacts };
```

时序论证：预投影在构造栈内同步完成 → status 从 t=0 起即诚实（预启用文档不存在
「preparing 期短暂谎报 disabled」窗口——SA6 类型锚锁死两态联合，无 'unknown' 第三态可用，
唯一诚实解是构造期就位而非 P0 期补读；P0 的文档化职责「只读取 SCHEMA 标准四键」保持不变）。

**buildStatus 投影（status.ts）**：

```ts
export interface NamespaceRuntimeStatus {
  …（七键原样）
  readonly replication: NamespaceRuntimeReplicationStatus;   // 第八键（append-only）
}

// buildStatus 内：
replication: Object.freeze({ ...state.replication }),   // 每次调用全新 + 深冻结子对象
```

- **新鲜性**：每次 `getStatus()` 展开重建（顶层对象本就每次新建；replication 子对象同样
  展开冻结——`s1 !== s2` 且突变探针不逃逸，红灯 AC-5 用例两路径（冻结抛错 / 赋值不逃逸）
  均满足）。
- **全生命周期可用**：getStatus 不在停接纳范围（CONTEXT.md「停接纳」词条 + #92 冻结）；
  replication 域从 state 投影、**不触碰 handle/doc**——closing/closed 期照常投影最后已知事实
  （与 writableNow 的 ready 期短路观察互不干扰）。
- **fatal 后**：E5.5 已更新的事实保留（enabled + 提升后 epoch）——诚实 committed 事实，
  与「fatal 只禁写、读保留」一致。
- **不暴露队列/任务面**：域内仅 state/replicationId/replicationEpoch 三键，无数组值字段
  （INV-N11 延续；`runtime-close-lifecycle.test.ts:517` 的 `Array.isArray` 负向断言保持绿）。

### §4.5 Lease 面：方法、结果联合与 released 通道（D-7/D-8）

**registry types.ts 新增（结构复制型 + 既有先例组合；禁词零触碰）**：

```ts
/** Lease status 复制域的结构复制型（§3.2 纪律：不 re-export 运行时命名类型；形状与
 *  runtime 包 NamespaceRuntimeReplicationStatus 逐字段相等，由 lease.ts Equal 断言锁死）。 */
export type NamespaceLeaseReplicationStatus =
  | Readonly<{ state: 'disabled' }>
  | Readonly<{ state: 'enabled'; replicationId: string; replicationEpoch: number }>;

export interface NamespaceRuntimeStatusProjection {
  …（七键原样）
  readonly replication: NamespaceLeaseReplicationStatus;   // 同步扩域
}

/** Lease 复制管理结果 = runtime 同名结果 | released issue（沿 NamespaceLeaseMutateRootResult 先例）。 */
export type NamespaceLeaseEnableReplicationResult =
  EnableReplicationResult | NamespaceLeaseReleasedIssue;        // import type 自 @nomicore/namespace-runtime
export type NamespaceLeaseBumpReplicationEpochResult =
  BumpReplicationEpochResult | NamespaceLeaseReleasedIssue;

export interface NamespaceLease {
  …
  /** Hub 显式复制管理操作（ADR 0010 冻结名）：原子安装随机 128-bit 复制谱系 + epoch 1。
   *  已启用命名空间 → 幂等 ok:true（零写入、零 dirty、身份/epoch 不变——稳定文档化结果）。
   *  拒绝（ok:false, issues）经结果联合结算：REPLICATION_RANDOM_SOURCE_INVALID /
   *  REPLICATION_INPUT_INVALID / REPLICATION_META_ABSENT / RUNTIME_WRITE_DISABLED 系；
   *  写管线 internal fatal 经 RuntimeWriteFatalError rejection。 */
  enableReplication(): Promise<NamespaceLeaseEnableReplicationResult>;
  /** Hub 显式提升权威代际（身份不变）。overflow（epoch = MAX_SAFE_INTEGER）→ ok:false
   *  结果面拒绝、绝不回绕；未启用 → REPLICATION_NOT_ENABLED；fatal/degraded/close →
   *  RUNTIME_WRITE_DISABLED 零写入。 */
  bumpReplicationEpoch(): Promise<NamespaceLeaseBumpReplicationEpochResult>;
}
```

**lease.ts 实现**：

```ts
/** 【R2 修订，SA2 #6a】抽取结果类型落位本文件并包内导出（registry.ts 经既有 './lease.js'
 *  import 引用——单向，零循环；不进主入口可达声明图）。 */
export type ReplicationIdDraw =
  | { readonly ok: true; readonly replicationId: string }
  | { readonly ok: false; readonly issue: { readonly message: string; readonly path: readonly [] } };

export function createLeaseController(
  entry: LeaseEntryRef,
  observer: RegistryObserver | undefined,
  onReleased?: () => void,
  deps: { readonly drawReplicationId: () => ReplicationIdDraw },   // 第 4 参（包内签名；必选——无缺省即无降级）
): NamespaceLease {
  …
  enableReplication(): Promise<NamespaceLeaseEnableReplicationResult> {
    if (released) return Promise.resolve(RELEASED_ISSUE);           // released 通道与两写同款
    const drawn = deps.drawReplicationId();                          // 同步抽取（released 后零消耗）
    if (!drawn.ok) return Promise.resolve({ ok: false, issues: [drawn.issue] });
    return entry.runtime.enableReplication({ replicationId: drawn.replicationId });
  },
  bumpReplicationEpoch(): Promise<NamespaceLeaseBumpReplicationEpochResult> {
    if (released) return Promise.resolve(RELEASED_ISSUE);
    return entry.runtime.bumpReplicationEpoch();
  },
```

**registry.ts `issueLease` 接线**（唯一 caller 扩参）：

```ts
function issueLease(entry: Entry): Readonly<{ ok: true; lease: NamespaceLease }> {
  const lease = createLeaseController(entry, observer, () => handleLeaseReleased(entry), {
    drawReplicationId,            // 闭包绑定本 Registry 的受控 randomBytes（§4.1.2）
  });
  …
}
```

**类型级锁（lease.ts 追加）**：

```ts
type _enableReplicationResultAlias = AssertTrue<Equal<
  NamespaceLeaseEnableReplicationResult,
  Awaited<ReturnType<NamespaceRuntime['enableReplication']>> | NamespaceLeaseReleasedIssue>>;
type _bumpResultAlias = AssertTrue<Equal<
  NamespaceLeaseBumpReplicationEpochResult,
  Awaited<ReturnType<NamespaceRuntime['bumpReplicationEpoch']>> | NamespaceLeaseReleasedIssue>>;
```

（Lease 侧无输入参数——runtime 侧 `EnableReplicationInput` 是内部编排载荷，不做 Lease 级
input alias；`_projectionAlias` 既有断言随两侧同步扩域自动保持成立。）

**index.ts（registry）**：type-only 追加导出 `NamespaceLeaseReplicationStatus` /
`NamespaceLeaseEnableReplicationResult` / `NamespaceLeaseBumpReplicationEpochResult`——运行时
export keys 恰九值冻结（registry-surface.test.ts:60）零变化。

### §4.6 类型面与导出总表（D-8）

| 包 | 文件 | 新增 | 导出通道 |
|---|---|---|---|
| namespace-runtime | `replication-write.ts`（新） | `REPLICATION_ID_PATTERN`、`NamespaceRuntimeReplicationStatus`、`EnableReplicationInput`、`EnableReplicationResult`、`BumpReplicationEpochResult`、`ReplicationManagementIssue`、`readReplicationFacts`、`runEnableReplicationSlot`、`runBumpReplicationEpochSlot`、`ReplicationWriteEnv` | 模块级；index 仅 re-export 五个**类型**（值导出面恰 `RuntimeWriteFatalError` 一键冻结——runtime-acceptance-exports-audit.test.ts:29 运行时探测，类型导出不入 `Object.keys`）；槽体/读取器/Env/**RegExp 常量**均不进 index——【R2 修订，SA2 #3】`REPLICATION_ID_PATTERN` 是值导出，从 index 导出会击穿恰一键审计；registry 侧使用本地副本（§4.1.2，沿 `NAMESPACE_ID_PATTERN` registry.ts:142 先例），两份副本互为结构守卫、注释互相引用（`runEnableReplicationSlot` 加入 exports-audit 禁止清单断言的可选加固项，见 §4.10） |
| namespace-runtime | `status.ts`/`p0.ts`/`runtime.ts`/`errors.ts`/`write.ts` | 见 §4.2-§4.4、§4.8 | `NamespaceRuntimeStatus` 经 index 既有导出自动携带新域 |
| namespace-registry | `types.ts`/`lease.ts`/`registry.ts`/`index.ts` | 见 §4.5 | type-only 追加；主入口运行时九值不变；testing.ts **零改动**（runtimeFactory 2 参签名不变、randomBytes 已必需） |

**SA6 类型锚兼容性自检**（registry-phase5-replication-surface.test-d.ts）：
`HasEnableReplication`/`HasBumpReplicationEpoch`：Lease 方法返回联合的每个成员都携带
`ok: boolean`（`{ok:true}` / `{ok:false; issues}` / released issue）→ 协变可赋 ✓；
`HasReplicationStatus<NamespaceRuntimeStatus>`：`replication` 域 = 恰两态联合（无第三态、
无可选化）→ `{replication: 两态}` 可赋 ✓；`LeaseStatusCheck<NamespaceLeaseStatus>`：active
分支的 projection 同步扩域 ✓；两保持性守卫（无通用 META 写面 / 无 doc/handle/runtime 原始
引用）：本设计零新增此类成员 ✓。

### §4.7 并发与生命周期语义矩阵（AC-2/AC-4/AC-6 逐用例对位）

| 红灯用例 | 设计机制 | 对位 |
|---|---|---|
| AC-2 原子安装（saveEvents[0] 同槽含两字段、saveDoc 恰 1 次） | E5 两键**同一 `doc.transact`** → E6 通知时刻 META 已含本槽提交（stub 的通知时刻快照即观测面）；每提交槽恰一次 notifyDirty | §4.2 E5/E6 |
| AC-2 并发 `[enable,bump,bump]` 通知序 `[1,2,3]`、单一身份 | Lease 同步接纳定序（§4.1.1）→ 同一 `WriteSequencer` FIFO（§3-1）→ enable 槽装身份、bump 槽依次 +1；bump 不触碰 replicationId | §4.1.1/§4.2 |
| AC-3 重复 enable（含 bump 后）身份不变 epoch 不重置 | E4 已启用 → 幂等 `{ok:true}` 零事务零通知；epoch 由 bump 槽独立推进，enable 永不写 epoch | §4.2 E4 |
| AC-4 monotonic + zero-touch | bump 槽 E5 只写 epoch 键；普通写在 ROOT 重建面内结构性不可达 META（§3-10） | §4.2/§4.9 |
| AC-4 overflow（MAX 拒升 / MAX-1 边界） | E4 判据 `epoch >= MAX` 先于任何 +1；MAX-1 → E5 写 MAX（安全整数）→ 再 bump 拒 | §4.2 E4/E5 |
| AC-4 fatal（notify-dirty 失败 committed:true） | E6 → `markWriteFatal('replication')` + throw `RuntimeWriteFatalError('notify-dirty-failed', true, …)`；META 已提升（E5 已提交，不回滚）；status.fatal 非 null；后续写（再 bump / mutateRoot）经各自 S1/E1 → `RUNTIME_WRITE_DISABLED` 零写入；read/getMetadata 保留（fatal 只禁写） | §4.2 E1/E6 |
| AC-5 判别链 disabled→enabled(id,1)→bump(id,2) | status.replication 值投影（E5.5 同步整替）；无 changed 态——两读值比较即判别面（SA6 锚定兼容，零回流） | §4.4 |
| AC-5 新鲜对象/突变不逃逸 | buildStatus 每调用展开重建 + 冻结 replication 子对象 | §4.4 |
| AC-6 close 竞态（enable 已接纳后 shutdown） | enable 同步入队（acceptance）→ shutdown 的 close barrier 经同一 sequencer 队尾排队 → 已接纳任务无条件排空（ADR 0008/#92）→ 身份提交 + dirty 登记 → flushAll → 新 Registry loadDoc 恢复 | §4.2 接纳层 + 既有 barrier |
| AC-6 degraded（gate 过后降级） | enable 经 E2 瞬时观察（ready）→ 提交 + 登记；flush 失败 → handle degraded → 后续 bump E2 拒（`RUNTIME_WRITE_DISABLED` 零写入，status 位如实）；I/O 恢复 → 持久层 retry 覆盖 → bump 成功 → epoch 2 → Memory 恢复 | §4.2 E2 + ADR 0006 #79 既有机械 |
| AC-6 FilePersistence 全链恢复 | META 两键为 plain JSON 值，随全量 snapshot 编解码 round-trip；重启 open → V2.5 预投影 enabled | §4.3/§4.4 |

### §4.8 稳定文案与错误注册表（新增单点表）

| 稳定码/常量 | 通道 | 文案要点（零值回显、零原始异常插值） |
|---|---|---|
| `NSRT-FATAL-REPLICATION-WRITE-INTERNAL`（errors.ts 新 code+message 常量） | status.fatal 摘要 + `writeFatalMessage('replication',…)` | 「REPLICATION write internal fault：…internal fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留…」（slot 名词参数化渲染，root/schema 渲染逐字节不变） |
| `NSRT-REPLICATION-META-CORRUPT`（errors.ts 新类 `ReplicationMetaCorruptError`，不导出——code+message 字符串消费） | 构造 throw / 槽内 fatal 的 cause | message 含违约类别（载体异型 / 恰一键存在 / **键存在而值显式 undefined**【R2，SA2 #1】/ id 格式 / epoch 格式）与观测 typeof，不含值内容 |
| `REPLICATION_EPOCH_OVERFLOW` | bump 结果 issue.message 前缀 | 「epoch 已达 Number.MAX_SAFE_INTEGER，拒绝提升（不回绕）——本调用零写入」 |
| `REPLICATION_NOT_ENABLED` | bump 结果 issue.message 前缀 | 「复制身份未安装（disabled）——先 enableReplication()；本调用零写入」 |
| `REPLICATION_INPUT_INVALID` | enable 结果 issue.message 前缀 | 「replicationId 必须为 32 位小写 hex 字符串（ADR 0010 冻结格式）；本调用零写入」 |
| `REPLICATION_META_ABSENT` | enable 结果 issue.message 前缀 | 「META 载体缺席，拒绝在其上安装复制身份（防产生无 docId 的 META）——生产路径不可达（仅 seedForTest 设施）；本调用零写入」 |
| `REPLICATION_RANDOM_SOURCE_INVALID_MESSAGE`（registry types.ts 稳定 message 单点表新常量） | Lease 结果 issue.message | 「受控随机源必须返回 16 字节 Uint8Array（ADR 0009 依赖纪律）——本调用零写入、零随机消耗副作用」 |
| `RUNTIME_WRITE_DISABLED`（复用，零新码） | fatal 已置位 / degraded / notifier 未绑定 / lifecycle≠ready | 复用 `disabled()` + `lifecycleWriteRefusal()`（red 灯用例 `JSON.stringify …toContain` 判定面） |

issue 元素形状 `ReplicationManagementIssue { message; path: Array<string|number> }`（path 恒
`[]`——META 管理写无路径语义，与 gate 级 issue 同款）；`RuntimeWriteFatalPhase` 零新增。

### §4.9 边界决策记录（SA2 预答区）

1. **replicationId ≠ namespaceId / ≠ SCHEMA id 不做运行时强制**：生成面结构性保证
   （无 `ns-` 前缀 + 128-bit 随机 vs 调用方 schema id 概率不相交）；ADR 0010 的表述是
   定义性区分（三者是不同身份空间），不是待强制的运行时不变量。legacy 自由文法
   namespaceId（如恰为 32-hex 的旧 ID）与 replicationId 字符串相等在语义上无碰撞后果
   （wire 身份核对同时携带两者），强制拒绝反而把一个无害巧合升格为 open 失败。红灯
   AC-1 用例的 `not.toBe` 断言由生成面满足。
2. **预启用文档的 replicationId 不校验「是否真随机」**：随机性不可结构化验证；格式门
   （§4.3）是全部可执行契约。种子文档（overflow 用例）自带合法格式即被接纳。
3. **幂等再 enable 弃用当次抽取的 id**：决策单点在槽内（唯一 sequencer 串行域），Lease
   不做 read-then-write 预检（避免 TOCTOU 双逻辑）。被弃 id 是惰性数据、零副作用；SA6
   明文「不做随机源消耗计数锚定」。代价：重复 enable 消耗一次 CSPRNG 抽取——非稀缺资源。
4. **enable 在 preparing 期可接纳**：复制写不依赖 active schema（§4.2）；排队等待 P0 后
   执行，与 rootWrite「早期写排在 P0 后」语义一致。
5. **bump 前置于 disabled 拒绝**：epoch 属于已安装谱系；无身份即无代际可提升
   （`REPLICATION_NOT_ENABLED`，结果面、零写入）。
6. **`['META','replicationEpoch']` 经 mutateRoot 触达的拒绝机制 = 既有 schema 封闭校验**
   （extract → validateLogicalSnapshot 顶层未声明键即 issue，§3-10）：这是结构性保证而非
   巧合——mutateRoot 的整个读写面钉死在 ROOT 子树（提取快照 + 全量重建），META/SCHEMA
   作为兄弟条目不在可达面内；即使某 schema 故意声明 `ROOT.META` 键，写入的也是 ROOT 内
   业务数据，触碰不到顶层 META 保留字段。零新代码、零新码。
7. **META 载体缺席 → enable 拒绝而非创建载体**：在生产路径 META 恒在（createDoc/loadDoc
   强制 docId 校验）；缺席仅 seedForTest 可达。若 enable 凭空 `getMap('META')` 创建只含
   复制键的载体，将产生下次 loadDoc 被 docId 校验击穿的**真实损坏**——拒绝（结果面）是
   唯一不制造损坏的处置。
8. **随机源运行期违约 = 结果面 issue 而非 fatal**（§4.1.2）：Lease 写操作纪律「任何拒绝经
   返回的 Promise 结算」（与 mutateRoot 的 gate/校验拒绝同通道）；构造期已同步验证
   randomBytes 形状（registry.ts:479），运行期 throw/形状违约是 Host 布线 bug 的晚发现——
   loud code 进 message，不伪装成功、不静默重试。与 create 路径 fatal 的差异是**编排级
   （create 是 Registry 自己的编排错误类）vs 能力代理级（Lease 是写操作面）**的通道归属，
   两者都已文档化。
9. **status 复制域不进网络状态**（ADR 0010「网络状态保留在 ReplicationSession/复制插件，
   不塞入 Runtime 的业务 capability status」）：本域只投影身份/epoch 持久事实。后续切片
   的 conflicted/bootstrap 状态属 ReplicationSession，本票不预留键位。

### §4.10 既有测试迁移面（D-11/D-12）

| 文件 | 迁移内容 | 性质 |
|---|---|---|
| `packages/namespace-runtime/test/runtime-close-lifecycle.test.ts` | :160 runtime 键集 10→12（+`bumpReplicationEpoch`/`enableReplication`）；:495 status 键集 7→8（+`replication`） | 键集锁的契约性扩展（#92 加 close 键同款先例） |
| `packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts` | :270 十键面锁 → 十二键 | 同上 |
| `packages/namespace-registry/test/registry-open.test.ts` | :907 lease 键集 → 12 键；`READY_STATUS` 字面量 + `replication: {state:'disabled'}`；`makeRuntime` fake + 两方法（`async () => ({ok:true})`） | 显式定型 fake 的机械补齐 |
| `packages/namespace-registry/test/registry-idle.test.ts`、`registry-shutdown.test.ts`、`registry-surface.test.ts`、`registry-sa7-concurrency.test.ts`、`registry-sa7-rev1.test.ts`、`registry-sa7-hostile.test.ts` | 同族：`NamespaceRuntime`/`NamespaceRuntimeStatus` 定型处补域/补方法（判定标准：凡以这两个类型显式定型的字面量/fake 必须补；松散 untyped fake——registry-create / registry-phase5-identity-red / registry-sa7-phase5-dynamic——零改动） | 机械补齐；SA3 以 typecheck 红绿为准逐一核销 |
| `packages/namespace-registry/test/registry-phase5-replication-red.test.ts` / `…surface.test-d.ts` | **零改动**（SA6 owned；本设计四项对齐提示全部无回流：幂等取 ok:true ✓、overflow 走结果面 ✓、无 changed 态 ✓、随机注入位置已设计 ✓） | 验收锚不可触碰 |
| `packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts` | 可选加固：禁止清单追加 `'runEnableReplicationSlot'`/`'runBumpReplicationEpochSlot'`/`'readReplicationFacts'`（防未来值导出回潮；运行时导出面本就零新增，不加亦绿） | 可选 |

**§4.10.1 新文档化通道的测试锚要求【R2 修订，SA2 #5】**：SA6 红灯套件按 AC 锚定（合理边界），
未覆盖本设计 §4.8 新登记的稳定通道；SA3 实现时**必须**为下列场景各补至少一条单元/集成用例
（新增两个测试文件，见 ALLOW LIST；场景清单与 SA2 评审 §五.5 对齐）：

| 通道/场景 | 锚定要求 | 落位 |
|---|---|---|
| `REPLICATION_NOT_ENABLED` | 未 enable 直接 bump → `ok:false` + message 含码；META 两键仍真缺席（`has()` false）；saveDoc 0 次 | registry 集成（经 Lease） |
| `REPLICATION_META_ABSENT` | 无 META 载体种子（seedForTest 设施）+ enable → `ok:false` + message 含码；**`doc.share.has('META')` 仍 false**（未凭空造载体）、零 dirty | registry 集成 |
| `REPLICATION_RANDOM_SOURCE_INVALID` | 注入违约 randomBytes（返回非 16 字节 / throw）→ Lease 结果 `ok:false` + message 含码（不 fatal、不同步 throw） | registry 集成（testing overrides） |
| `REPLICATION_INPUT_INVALID`（/internal 级） | (a) Proxy get trap 首读 `'a'.repeat(32)`、次读 `'ZZZ'` → 结算后 META 中 replicationId ≠ `'ZZZ'`（单读捕获闭合）；(b) ownKeys/getter trap throw → 结算 `ok:false` issue（JSON 含码），**绝不** raw rejection（`.then(null, …)` 断言 rejection 通道为空或仅 RuntimeWriteFatalError） | runtime 单测（经 seam 直构——公共 Lease 面不可达，registry 自造 plain literal） |
| 损坏 META 构造 throw（V2.5） | 种子族：id=`'f'.repeat(32)`+epoch 为 string `'999'`/`0`/`1.5`/大写 32hex/仅 id 无 epoch/**双键 set undefined**/**单键 undefined + 另一键合法** → open 以 `NamespaceRegistryFatalError('open','runtime-construction')` rejection 响亮失败 + observer `open-runtime-construction-failed`；**反向守卫**：两键真缺席种子 open 成功且 status=disabled（防过纠）；**双读者一致性**：损坏文档上 getMetadata 与 status.replication 不同时给出保守值 | registry 集成 |
| 槽内 E4 corrupt fatal | 构造后破坏 META（仅 seam 级可达——直构 runtime 后手工改 doc）→ `RuntimeWriteFatalError`（phase `write-slot-internal`、committed:false）+ status.fatal 置位 + 后续写 `RUNTIME_WRITE_DISABLED` | runtime 单测 |

**零改动证明**（对应 DENY LIST）：Persistence 两键是 plain JSON 值随全量 snapshot round-trip，
无 schema/布局变更；doc-runtime 的 mutation/replace 管线不触 META；`/internal` 工厂 2 参签名
不变（§4.1 论证）；sequencer/close/p0 槽体机械零改动（p0.ts 仅 RuntimeState 接口加字段）；
plugin.ts 无新 capability 桥接（randomBytes 已在 #131 桥接 node:crypto）；ADR/CONTEXT/phase
文档已是本票规范本身，无对齐性修订（对照 #131 的 D-11：彼票改了 ADR 已裁决的 key 条款需回写
修订节，本票纯落地）。

## §5. 不变量清单（本设计新增/延续）

| # | 不变量 | 机制 |
|---|---|---|
| INV-R1 | replicationId 一经安装永不被任何 API 改写（enable 幂等零写、bump 只写 epoch、普通写结构性不可达 META） | E4/E5 分支 + §3-10 |
| INV-R2 | META 两键只经唯一 write sequencer 的复制槽成对变更（同事务原子） | E5 单 transact + sequencer FIFO |
| INV-R3 | 通知时刻 META 已含本槽提交（每提交槽恰一次 dirty；零写入路径零通知） | E5→E6 槽序 |
| INV-R4 | epoch 严格单调、`>=1`、`<=MAX_SAFE_INTEGER`，永不出域 | E4 判据先于 +1；唯一写点 E5 |
| INV-R5 | status.replication ≡ 最后已提交的 META 复制事实（构造期预投影 + E5.5 同步整替；fatal/closing 期不回滚不冻结读取）。【R2 修订，SA2 #4：登记唯一例外窗口】E5 transaction 中途 throw（`unknown-pipeline-throw` 保守 committed:true fatal）时 Yjs 事务不回滚、META 可能已部分前进而 E5.5 被跳过 → status.replication 陈旧于 live META（`getMetadata()` 读 live doc 较新）——不重读收敛，与 SCHEMA 槽 S5.5 先例同构（installActive 跳过 → getActiveSchema 陈旧 vs getSchemaEnvelope 新）；生产不可达（E5 只写已验证 string/number，两键同事务无现实 throw 面），fatal 置位后读取面保留、后续写全拒，陈旧窗口无放大面 | V2.5 + E5.5 |
| INV-R6 | status 无第三态、无 mutable 引用逃逸（每次全新 + 冻结） | buildStatus 展开 + freeze |
| INV-R7 | 复制管理拒绝永不走同步 throw / 永不伪装 ok:true（结果联合或 RuntimeWriteFatalError rejection 二通道） | Lease/槽体纪律 |
| INV-R8 | 随机源唯一注入点 = Registry 构造（randomBytes），核心零全局 crypto | §4.1 |
| INV-R9 | replicationId 格式非法值结构性无法进入 META（抽取器结构守卫 + 槽 E3 **单读捕获**格式门【R2，SA2 #2：双读分叉结构性不可达】+ 读取器损坏判据三重；含 undefined 值/部分存在的绕道写入在下次 open 即响亮失败【R2，SA2 #1】） | §4.1.2/§4.2/§4.3 |

## §6. 风险与防御

| 风险 | 防御 |
|---|---|
| 键集锁测试迁移被 SA4 误判 scope-creep | ALLOW LIST 逐一列出 + §4.10 判定标准（「显式定型处必补」）+ #92 先例引用 |
| 声明图禁词审计误伤新类型名 | 新名均不含 `\bNamespaceRuntime\b` 整词（前缀复合词）；registry 侧类型导入沿 MutateRootResult 先例；SA3 实现后跑 registry-surface declaration 审计即验证 |
| 测试 fake 补齐遗漏（typecheck 噪声） | 判定标准明确（显式定型）；vitest --typecheck 全目录跑即全覆盖暴露 |
| 槽 E4 读到损坏 META 被降级为 issue | 已立法为 internal fatal（§4.3 表格；committed:false 零写入事实） |
| 未来切片（trusted apply）绕过复制槽写 META | 本票不实现；INV-R9 的读取器损坏判据使任何绕道写入在下次 open 即响亮失败（构造 throw）——R2 修订（SA2 #1）后该承诺对**含 undefined 值的绕道**同样成立（has() 判别收编进损坏家族）——纵深防御闭合 |
| 幂等 enable 与并发 FIFO 交错产生双身份 | 决策单点在槽内（sequencer 串行域）；第二 enable 槽观察到 enabled → 幂等返回，被弃 id 零副作用 |
| 敌意 input（/internal 直构面）经 Proxy trap 双读分叉/探测 throw 逃逸 | E3 单读捕获（E5 消费同一常量）+ 全探测 try/catch 收编为 REPLICATION_INPUT_INVALID（SA2 #2 修订落实；§4.10.1 有锚定要求） |

---

## SA2 反馈逐条回应

评审来源：`wiki/raw/task_phase5-replication-identity-epoch_sa2_review.md`（verdict: reject → 本 R2 修订）。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| **#1（HIGH，必修）** readReplicationFacts 以 `has()` 区分键存在/缺席；键存在且 `get()===undefined` → ReplicationMetaCorruptError；`disabled` 仅限两键真缺席；删除 projection.ts:32 类推 | ✅ | §4.3 伪代码 + §4.3 判据论证段 + §2 D-3 + §3-9 + §4.2 E4 + INV-R9 + §6 | 读取器改为 `hasId/hasEpoch` 判别：`!hasId && !hasEpoch → disabled`（两键真缺席）；`!hasId \|\| !hasEpoch → corrupt`（恰一键）；随后 `get()===undefined → corrupt`（键存在而值显式 undefined，注明 Yjs round-trip 存活的实证前提）；删除「键缺席与显式 undefined 同判」类推，新增三重论证段（静默换谱系 / 自相矛盾 / getMetadata 与 status 双读者分歧——SCHEMA 面宽容有 ENV-2 兜底且无状态变迁后果，复制面无此安全网） |
| **#2（MEDIUM，必修）** E3 单读捕获 + 全探测 try/catch 收编为 REPLICATION_INPUT_INVALID；E5 消费捕获值 | ✅ | §4.2 E3 + §4.2 E5 + INV-R9 + §6 + §4.10.1 | E3 重写：`const replicationId = input.replicationId`（恰一次属性读，捕获），形状门全部作用于捕获值与元数据探测；整段 try/catch，任何 trap throw → 类 B issue（绝不裸 reject、绝不升格 fatal）；E5 改为 `meta.set('replicationId', replicationId)`（E3 捕获常量，双读分叉结构性不可达）；显式记录「单读捕获 = 快照纪律在不可变标量载荷上的最小实现」及 R1 把快照器两职责混为一谈的指正 |
| **#3（MEDIUM，必修）** registry 本地 REPLICATION_ID_PATTERN 常量（沿 NAMESPACE_ID_PATTERN 先例）；§4.6 澄清 runtime 侧常量不跨包 | ✅ | §4.1.2 + §4.6 表 | §4.1.2 增 registry.ts 本地 `const REPLICATION_ID_PATTERN = /^[0-9a-f]{32}$/`（注明沿 registry.ts:142 先例、跨包 import 模块级值不可达、从 index 导出值会击穿恰一键冻结审计、两份副本互为结构守卫并注释互引）；§4.6 表行同步澄清「RegExp 常量不进 index」 |
| **#4（LOW，建议）** INV-R5 声明 E5-throw 例外窗口 | ✅ | §5 INV-R5 + §4.2 E5 尾注 | 取评审建议 (a)（零代码）：INV-R5 登记唯一例外窗口（unknown-pipeline-throw 保守 committed:true 时 E5.5 跳过 → status.replication 陈旧于 live META；与 SCHEMA 槽 S5.5 先例同构；生产不可达论证 + fatal 后无放大面）；§4.2 E5 尾注互引 |
| **#5（LOW，建议）** 为新文档化通道登记 SA3 补测试锚的场景清单 | ✅ | §4.10.1（新增）+ §7 ALLOW LIST | 新增 §4.10.1 场景表（6 通道：NOT_ENABLED / META_ABSENT / RANDOM_SOURCE_INVALID / INPUT_INVALID（含 Proxy 双读分叉与 trap throw 两型）/ 损坏 META 构造 throw（含双键 undefined、单键 undefined、反向真缺席守卫、双读者一致性）/ 槽内 E4 corrupt fatal）；ALLOW LIST 相应新增 2 个 SA3-owned 测试文件 |
| **#6（INFO，可选）** ReplicationIdDraw 落位（避免包内循环引用）；E4 载体在场信号获取点明示 | ✅ | §4.1.2 + §4.5 lease.ts 伪代码 + §4.2 E4 | (a) `ReplicationIdDraw` 类型移至 lease.ts 定义并包内导出（registry→lease 单向 import 已存在 registry.ts:64，零循环；不进主入口可达声明图）；(b) E4 明示「槽体在 E4 同步段内二次 `doc.share.has('META')` 判别载体在场」（两读之间零 await，run-to-completion 无 TOCTOU 面） |
| **#7（INFO，可选）** 持久化损坏通道不对称的对照说明 | ✅ | §4.3 消费方表后新增段 | 补运维诊断对照：docId 损坏 → loadDoc 层 `NAMESPACE_LOAD_FAILED` 结果 issue vs 复制字段损坏 → Runtime 构造门 `runtime-construction` fatal rejection；差异源自检测层不同，均 loud 均已文档化；诊断「namespace 打不开」应两通道都查（记录性说明，不改判） |

---

## §7. 文件清单（File Scope）

### ALLOW LIST

**生产代码（11 文件）**：

- `packages/namespace-runtime/src/replication-write.ts` — 新建，复制域单点模块：格式常量 + `readReplicationFacts` + enable/bump 两写槽 + 类型（~260 行）
- `packages/namespace-runtime/src/runtime.ts` — 修改，公共面 +2 方法（十一/十二键）、V2.5 预投影、replicationWriteEnv、接纳门（~90 行）
- `packages/namespace-runtime/src/status.ts` — 修改，`NamespaceRuntimeReplicationStatus` 类型 + status 第八键 + buildStatus 投影（~30 行）
- `packages/namespace-runtime/src/p0.ts` — 修改，`RuntimeState` 增 `replication` 字段（~8 行）
- `packages/namespace-runtime/src/errors.ts` — 修改，`NSRT-FATAL-REPLICATION-WRITE-INTERNAL` code/message + `ReplicationMetaCorruptError` 类（~25 行）
- `packages/namespace-runtime/src/write.ts` — 修改，`WriteSlot` 词表扩 `'replication'` + markWriteFatal/writeFatalMessage 分支（~12 行）
- `packages/namespace-runtime/src/index.ts` — 修改，type-only 追加导出 5 个类型（~6 行）
- `packages/namespace-registry/src/types.ts` — 修改，`NamespaceLeaseReplicationStatus` + projection 扩域 + 两结果 alias + Lease 接口 +2 方法 + 随机源 message 常量（~45 行）
- `packages/namespace-registry/src/lease.ts` — 修改，两方法 + `deps` 第 4 参 + Equal 断言 ×2（~40 行）
- `packages/namespace-registry/src/registry.ts` — 修改，`drawReplicationId` 私有函数 + `issueLease` 接线（~30 行）
- `packages/namespace-registry/src/index.ts` — 修改，type-only 追加导出 3 个类型（~5 行）

**包版本 bump（2 文件——R3 惯例注记，SA4 静态验尸 L1 收口）**：

- `packages/namespace-registry/package.json` — 修改（仅 `version` 0.1.4→0.1.5），公共面加法（Lease 两方法 + status 复制域 + 3 类型导出）随仓库硬门禁 #9 惯例 bump patch 位
- `packages/namespace-runtime/package.json` — 修改（仅 `version` 0.1.7→0.1.8），公共面加法（Runtime 两方法 + status 第八键 + 5 类型导出）同款惯例 bump

> 惯例依据：本仓跨包公共面变更 PR 均同步 bump 受影响包 patch 版本（同型先例 `7425164` /
> `6472485` / `5db6f83`）；沿 #131（issue #132 前序切片）SA4 L1 先例以设计文档注记收口——
> 版本号不是行为契约，属发布簿记，SA4 比对时按本注记放行（SA4 R1 verdict: pass 已确认
> L1 非阻断）。

**测试文件（8 文件，均为既有键集锁/定型 fake 的机械迁移；SA6 红灯两文件零改动列入监护）**：

- `packages/namespace-registry/test/registry-phase5-replication-red.test.ts` — `[SA6 owned]` 验收红灯（14 例）。本设计四项对齐提示全部无回流——SA3 **不得**修改其断言；仅当 SA2 攻击裁决要求契约变更时经总控回流 SA6 记录后同步
- `packages/namespace-registry/test/registry-phase5-replication-surface.test-d.ts` — `[SA6 owned]` 类型面契约（6 例）。同上零改动
- `packages/namespace-runtime/test/runtime-close-lifecycle.test.ts` — 修改，runtime 键集 10→12（:160）、status 键集 7→8（:495）（§4.10）
- `packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts` — 修改，十键面锁 → 十二键（:270）（§4.10）
- `packages/namespace-registry/test/registry-open.test.ts` — 修改，lease 键集（:907）+ `READY_STATUS`/`makeRuntime` 补域补方法（:162-191）（§4.10）
- `packages/namespace-registry/test/registry-idle.test.ts` — 修改，`NamespaceRuntimeStatus`/`NamespaceRuntime` 定型字面量与 fake 补 `replication` 域/两方法（§4.10）
- `packages/namespace-registry/test/registry-shutdown.test.ts` — 修改，同上机械补齐（§4.10）
- `packages/namespace-registry/test/registry-surface.test.ts` — 修改，定型 fake 补齐（运行时九值导出断言零变化）（§4.10）
- `packages/namespace-registry/test/registry-sa7-concurrency.test.ts` — 修改，同上机械补齐（§4.10）
- `packages/namespace-registry/test/registry-sa7-rev1.test.ts` — 修改，同上机械补齐（§4.10）
- `packages/namespace-registry/test/registry-sa7-hostile.test.ts` — 修改，同上机械补齐（§4.10）
- `packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts` — 修改（可选加固），禁止清单追加复制槽体名（§4.10；不加亦绿——若 SA3 判断零改动，SA4 按 warning 处理非 reject）

**测试文件（R2 修订追加，2 文件——SA2 #5 要求的新通道锚落位，场景表见 §4.10.1）**：

- `packages/namespace-runtime/test/runtime-replication-write.test.ts` — `[SA3 owned]` 新建，槽级单元：敌意输入双读分叉/探测 throw 收编（REPLICATION_INPUT_INVALID 两型）、槽内 E4 corrupt fatal（write-slot-internal + committed:false + 后续写禁）、NOT_ENABLED/META_ABSENT 的 runtime 侧行为（经 seam 直构，~150 行）
- `packages/namespace-registry/test/registry-phase5-replication-channels.test.ts` — `[SA3 owned]` 新建，集成：损坏 META 种子族构造 throw（含双键 undefined / 单键 undefined / 格式违约五型 + 两键真缺席反向守卫 + 双读者一致性）、`drawReplicationId` 违约随机源结果面、bump-before-enable 零写入零通知、META 载体缺席不造载体（~180 行）

### DENY LIST

- `packages/persistence/**` — Persistence 契约/布局零改动（ADR 0006 对齐说明 #131 已冻结；复制字段是 plain JSON 值随全量 snapshot round-trip）
- `packages/doc-runtime/**` — mutation/replace/create-initial 管线零改动（zero-touch 为结构性保证，§4.9-6）
- `packages/vfsl/**`、`packages/vfsl-codegen/**`、`packages/vfsl-protocol/**` — schema 面与本票无关
- `packages/namespace-runtime/src/internal.ts` — `/internal` 工厂 2 参签名不变（§4.1 论证：随机源经值输入不经构造注入）
- `packages/namespace-runtime/src/sequencer.ts`、`src/close.ts`、`src/projection.ts`、`src/plain-data.ts` — 排序/生命周期/投影机械零改动（projection 的 getMetadata 已自动投影新键）
- `packages/namespace-registry/src/testing.ts`、`src/plugin.ts`、`src/observer.ts`、`src/identity.ts`、`src/create-document.ts`、`src/errors.ts` — 无新 capability/事件/身份变更（randomBytes 桥接已在 #131 交付；observer 不加事件——复制管理是调用方操作不是内部生命周期故障）
- `packages/clock/**`、`packages/dsh-persistence/**`、`apps/**` — 无关
- `docs/adr/**`、`docs/phases/**`、`CONTEXT.md`、`docs/protocols/**` — ADR 0010 即本票规范来源，纯落地零对齐性修订（§4.10）

---

## §8. 协议假设依据 (Protocol Assumption Evidence)

**无协议级假设**：本设计仅涉及进程内库层代码（TypeScript 包间的函数调用、Yjs 内存事务、
Promise 微任务次序），不包含 HTTP/WS 端点行为、端口占用/释放、跨进程资源生命周期或第三方
工具行为假设。仅有的次序性论断（sequencer FIFO、close barrier 队尾语义、`Promise.all` 同步
接纳序）全部锚定既有源码与测试：

| 论断 | 依据类型 | 依据内容 |
|---|---|---|
| 同一 sequencer 实例 FIFO：接纳序 = 完成序 = 通知序 | 源码引用 | `packages/namespace-runtime/src/sequencer.ts:38-42`（promise-chain 尾接尾）+ `runtime-mutate-root-sequencer.test.ts` / `runtime-replace-schema-sequencer.test.ts`（既有次序锚） |
| enable 已接纳后 close/shutdown 不取消 | 源码 + 现有测试引用 | `runtime.ts:253-264`（close barrier 经同 sequencer 队尾）+ ADR 0008「已接纳任务无条件排空」+ registry-shutdown 既有排空锚 |
| `Promise.all` 内三调用同步依次接纳 | 源码引用 | Lease 方法体无 await 前置于委托（§4.5 伪代码）；ECMAScript `Promise.all` 对 iterand 逐项同步求值（`runtime.ts:239` 同款「同步接纳定序」既有注释） |
| `doc.transact` 单事务内两 `set` 对通知时刻可见 | 源码引用 | yjs `Y.Doc.transact` 同步执行回调后事务方结束；write.ts S5→S6 槽序先例（`StubReplicationPersistence.saveDoc` 的通知时刻快照即既有观测面，red.test.ts:180-188） |

## §9. 契约改动连锁审计 (Contract Change Caller Audit)

**结论：无既有函数契约改动。** 本设计全部为加法（新函数/新接口成员/新类型/新稳定码），
不修改任何既有函数的签名、返回联合、throw/reject 行为或时序。加法面带来的**接口扩波**
（implementor/字面量迁移）与一处包内函数扩参审计如下。

### 改动函数（新增，非契约变更）

| 函数 | 文件 | 契约 |
|---|---|---|
| `runEnableReplicationSlot` / `runBumpReplicationEpochSlot` | `packages/namespace-runtime/src/replication-write.ts`（新建） | `Promise<{ok:true} \| {ok:false; issues:unknown[]}>`；internal fatal 经 `RuntimeWriteFatalError` rejection |
| `readReplicationFacts` | 同上（新建） | 同步纯读；损坏 → throw `ReplicationMetaCorruptError`（构造通道） |
| `drawReplicationId` | `packages/namespace-registry/src/registry.ts`（新建私有） | 同步；`{ok:true; replicationId} \| {ok:false; issue}`，永不 throw |
| `enableReplication` / `bumpReplicationEpoch`（Lease 与 Runtime 两面） | types.ts/lease.ts/runtime.ts（新增成员） | Lease 面：`() => Promise<Readonly<{ok:boolean}> 形联合>`（SA6 冻结）；Runtime 面：enable 收 `{replicationId}` 输入 |

### 唯一签名扩展（包内函数，非公共契约）

| 函数 | 文件 | 改动 | Caller 清单 |
|---|---|---|---|
| `createLeaseController` | `packages/namespace-registry/src/lease.ts:64` | 三参 → 四参（+`deps.drawReplicationId`，必选） | **恰一个**：`registry.ts:659` `issueLease`（同 PR 内同步扩参；`git grep -n "createLeaseController"` 全仓唯一 caller，§设计期已核） |

Caller 三栏判定（`createLeaseController`）：是否 await ＝ 否（同步构造）；直接 try/catch ＝
无（throw 仅构造期、由 registry factory catch 收编为 runtime-construction fatal——既有通道）；
顶层 catch-all ＝ `runOpenSlot`/`runCreateAttempt` 的 factory try/catch（registry.ts:856-870/1090-1103）。

### 接口加法扩波（implementor/字面量必须同步——非行为变更）

| 接口/类型 | 加法成员 | 受影响 implementor/字面量 | 处置 |
|---|---|---|---|
| `NamespaceRuntime`（公共） | +`enableReplication`/`bumpReplicationEpoch` | 生产唯一 implementor：`runtime.ts:197` 对象字面量（本 PR 实现）；测试 fake：registry-open `makeRuntime`、registry-idle/shutdown/surface/sa7-concurrency/sa7-rev1/sa7-hostile 定型 fake | 生产随设计实现；fake 机械补两方法（ALLOW LIST） |
| `NamespaceRuntimeStatus`（公共） | +`replication`（必选键——可选键会被 SA6 类型锚 `extends {replication: 两态}` 拒绝，不可选） | `status.ts buildStatus`（唯一生产构造点）；测试 status 字面量：registry-open `READY_STATUS`、registry-idle 等同族 | 生产随设计实现；字面量机械补 `replication: {state:'disabled'}`（ALLOW LIST） |
| `NamespaceRuntimeStatusProjection`（registry 结构复制型） | +`replication` | `types.ts:119` 声明 + `lease.ts:154` Equal 断言（编译期锁） | 两侧同步扩域，Equal 断言保持成立 |
| `NamespaceLease`（公共） | +两方法 | `lease.ts:91` 对象字面量（唯一构造点） | 本 PR 实现；lease 键集锁测试迁移（ALLOW LIST） |
| `RuntimeState`（包内） | +`replication` 字段 | `runtime.ts:171` 唯一构造字面量 | 本 PR 实现 |

**风险评估**：接口加法对「读取型消费者」（只读 status/lease 的代码）零影响；对
「构造型消费者」全部枚举于上表且均在本 PR 的 ALLOW LIST 内（生产 1 处 + 测试 fake 若干，
判定标准 §4.10）。无类似 PR #255 的 `return false → throw` 类契约翻转——本设计不改任何既有
函数的错误通道。
