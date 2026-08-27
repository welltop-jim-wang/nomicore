# 设计 — Phase 5 切片 3/4：expose trusted NamespaceLease ReplicationSession（issue #134，round 1）

- **修订轮次**: **R1**（2026-08-28）——逐条落实 SA2 攻击评审（verdict: reject，报告 `task_namespace-lease-replication-session_sa2_review.md`：HIGH×2 / MEDIUM×3 / LOW×5 / INFO×6）；O-1..O-12 裁决骨架与机制层（槽序/seam/扇出/锁面结构）零改动（SA2 认定「架构本体经全维度攻击存活，无需返工」），本修订全部为类型计划修正、文档清单落实与规约精化。逐条 mapping 见文末「SA2 反馈逐条回应」表。
- **worktree**: /home/wangjian/nomicore-fix-issue-134（基线 ebc5419）
- **任务类型**: feature（ADR 0010 §NamespaceLease 与 ReplicationSession / §Trusted raw update / §SCHEMA 与 META 权限 / §Persistence degraded 四节 + phase-5 切片 3/4 的落地设计）
- **必读输入已消化**: 任务简报（7 AC + 边界 + 验收门槛）、SA8 冲突门禁（verdict clear，T-1..T-7 和解 + O-1..O-12 开放点）、SA8 权威条款摘录、SA6 红灯锚定记录（20 行为用例 + 2 类型红 + §6.2 待冻结词汇）、ADR 0010/0009/0008（#93/#132 修订节）/0007（L42/L54）/0006（#79 修订）、phase-5 文档 §切片 3/4、CONTEXT.md、现有代码（runtime 十二键面与构造序、sequencer、replication-write E1–E7、write S1–S7、status、close、p0、errors、index、internal；registry types/lease/registry/observer/testing/index；persistence contract 四态）。
- **验证基线**: SA6 两个测试文件（`registry-phase5-replication-session-red.test.ts` 20 用例、`registry-phase5-replication-session-surface.test-d.ts` 5 探针）逐用例核对（§9 测试矩阵），全部有实现路径；设计期 Yjs 语义实测见 §14。

---

## §0. 开放点 O-1..O-12 裁决总表（一句话结论；论证见 §2/§4/§5）

| # | 裁决（冻结） |
|---|---|
| O-1 | degraded bypass 唯一例外谓词 = `lifecycle==='ready' ∧ fatal 未置位 ∧ direction==='hub-to-peer'（创建时冻结）∧ handle.getStatus()==='persistence-degraded' ∧ notifyDirty 已绑定`；`released`/`disposed`/degraded+peer→hub/`closing`/`closed`/fatal 一律拒绝；稳定码**复用 `RUNTIME_WRITE_DISABLED` 码族**（不设新码），message 文案分域（§6.2）。 |
| O-2 | seam = Runtime 构造期创建 fanout hub + replication host 并登记入模块级 `WeakMap<NamespaceRuntime, host>`；`@nomicore/namespace-runtime/internal` 增**第二值导出** `openReplicationSessionCoreForRegistry(runtime, options)`（消费边界仍是 Registry 生产代码，审计谓词零改动）；apply 槽 `enqueue` **同一 WriteSequencer 闭包实例**——结构性不出现第二写队列。 |
| O-3 | `ReplicationSession` 等类型落位 registry `types.ts`（纯结构性、零 Runtime 命名类型/内部 subpath 字面量）；锁面 = SA6 test-d 结构探针（已有）+ `lease.ts`（声明图外）对 runtime core/status 类型的编译期 `Equal` 断言；**两侧主入口值导出面零突破**（runtime 仍恰 `RuntimeWriteFatalError` 一键；registry 主入口仍 type-only 追加）；released 通道表增补：`openReplicationSession` → 经返回 Promise 结算 `NAMESPACE_LEASE_RELEASED`。 |
| O-4 | 实例静态角色经 **Registry 构造 options.role**（生产 `CreateNamespaceRegistryOptions.role` 与 testing overrides 同形：`'hub'\|'peer'` 可选、缺省 `'hub'`、构造期形状门禁）注入；peer 的 `replaceSchema`/`enableReplication`/`bumpReplicationEpoch` 在 **Lease 接纳段**以稳定 issue 拒绝（码前缀 message `REPLICATION_ROLE_PERMISSION`，结果联合零改形）；session open 校验 `options.localRole === 实例 role`（不等 → `REPLICATION_ROLE_MISMATCH`）。 |
| O-5 | 两项补锚落位：(a) hub-degraded 拒 peer→hub apply = O-1 谓词的 direction 分支（§4.5）；(b) peer replaceSchema 角色拒绝 = Lease 接纳段 role gate（§5.4）——分别对应 SA6 用例 12/13。 |
| O-6 | 本切片「authenticated hub-to-peer」等价物 = **在 peer 角色实例上以 `localRole:'peer'` 打开的 session（direction 创建时冻结为 `hub-to-peer`）+ Host 搭建方只把 Lease 交给可信代码**（ADR 0010 L79）；bypass 谓词以冻结 direction 为唯一判据，业务写与 hub 实例 session 结构性无法获得；契约测试等价物即 SA6 用例 11（冻结方向 + 受信 Lease 持有 = 切片 6/7 认证的先行词）。 |
| O-7 | replication disabled（两态 `{state:'disabled'}`）命名空间上 open → **稳定拒绝 `REPLICATION_NOT_ENABLED`**（复用 #132 已冻结 message 族，零新词）；理由：四域冻结（L81）前置要求 replicationId/epoch 存在，允许开将迫使 session 携带 undefined 谱系，击穿「身份与 epoch 相同才允许 reconciliation」（L55）。 |
| O-8 | apply 槽内**重读当前 facts**（`state.replication` 投影链单点）与冻结四域中 id+epoch 比对：不等 → session 转终态 **`conflicted`** + `ok:false REPLICATION_EPOCH_CONFLICTED` 零写入（对齐 L53「旧 epoch 必须显式 reset/bootstrap」/L55「稳定 conflicted」）；终态释放 Lease session 槽位——新 open 冻结新 epoch 即显式 reset/bootstrap 的本切片等价物；在途竞态由 FIFO + 槽内逐槽重读确定性判定（bump 落在两个 apply 槽之间时，前者已过 gate 照常提交、后者被 fence——与 ADR 0008「gate 是瞬时观察」同构）。 |
| O-9 | 「每 Lease 最多一个 duplex session」词义冻结为：**至多一个活跃（core state `'open'`）session，计数在 Lease 层**（同一 Runtime 被多 Lease 共享——AC-6 fan-out 的结构前提，Runtime 层不可计数）；`closed`（显式 close 或 release 同步调 `session.close()`）与 `conflicted`（epoch fence）皆终态并释放槽位，**终态后同 Lease 可再 open**（非终身制）；release 语义 = 同步段调用既有 session 的 `close()`（停接纳 + 退订 + 终态；**零新增方法面**——core 与公共类型十键 Equal 锁的前提）+ release 后 session apply 经包装层 revoked 前置检查映射 `NAMESPACE_LEASE_RELEASED`（SV/diff 终态 throw 属 session 域码 `REPLICATION_SESSION_CLOSED`——lease 域码只出现在结果联合通道，与 Lease 既有通道纪律一致）+ **已接纳 apply 槽照常排空**（release 不追踪已接纳写——ADR 0009 L42 同款）。 |
| O-10 | 单 Runtime observer = 构造期恰一个 `doc.on('update', ...)` 监听（AC-6 单点），同步扇出；每 listener 调用独立 try/catch 自捕获（计数进 `status.observerFailures`——ADR 0007 L54「必须记录或异步上报」的记录面）、**绝不向 Yjs transaction 栈抛**；每投递独立 `Uint8Array` 副本（`slice()`）；回声抑制排除谓词 = **`origin === 本 session 的 applyOrigin token` 的 update 不投给该 session，其余一切 origin（含本地业务写的 `null` origin）投给全部活跃 channel**；队列/背压/`needs-resync` 属切片 6，本切片无队列（同步扇出天然不阻塞 sequencer）。 |
| O-11 | session status 词汇冻结：`state('open'|'closed'|'conflicted')` + 冻结四域 + `direction` + `currentEpoch`（Runtime 投影链当前值——fence 可观测）+ `rootValidation('none'|'replication-unvalidated'`，raw apply 成功后置位、session 生命周期内**永不清除**——session 无法证明 ROOT 重新合法，只置不清是诚实方向`)` + `durability({memoryCaughtUp（**初值 false**——R1 冻结）, diskCaughtUp:false}` 字面量——**永不声称 durable**，ADR 0010 L139`)` + `observerFailures`（扇出 listener 失败计数）。release 事实不经 session status 复投影（Lease `getStatus()` 的 `lease:'released'` 已是单一真相源——不双写）。 |
| O-12 | scratch-check 判据 = **(a) 内容投影相等**：scratch clone（`new Y.Doc()` + `Y.encodeStateAsUpdate(liveDoc)` 全量装载 + 装载待审 update——构造序冻结）上比对 SCHEMA/META 的全键值投影；字节级 (c) 无良定义（encodeStateAsUpdate 非规范编码、跨合并序不稳定）、零操作 (b) 需解析 update 结构且漏判「删后重写同值」——(a) 是 ADR 0010 L105「确认 update 不改变 SCHEMA」的字面语义（内容不变 ⇒ 未改变）且可用公共 API 确定性实现（实测见 §14）；受保护字段集合 = **冻结常量**：hub 侧（peer→hub）`SCHEMA 全容器 + META 全键`、peer 侧（hub→peer）`META 全键`（SCHEMA/ROOT 放行）；peer「允许的 META 字段」白名单**首版 = 空集**（⟺ META 全键保护，两侧对称；ADR 0010 L121「未决定即不可同步」的保守读法，且与 L120「epoch 只经 hub 显式管理操作修改、peer 永不经 raw 获得」一致）；非 primitive 值形态（Yjs 容器入 SCHEMA/META——契约外）保守判「已改变」→ 拒绝。 |

---

## §1. 架构总览

```
┌─ @nomicore/namespace-registry ────────────────────────────────────────────┐
│  NamespaceLease（types.ts 声明面 + lease.ts controller）                    │
│  ├─ openReplicationSession(options) ── Lease 层编排（全同步，无 await）：     │
│  │    released 通道 → 输入校验 → role 匹配 → 每 Lease 一活跃 session 计数      │
│  │    → 调 internal seam → 包装公共 ReplicationSession（恰 10 键冻结对象）     │
│  ├─ replaceSchema/enable/bump ── role==='peer' → Lease 接纳段稳定 issue 拒绝  │
│  └─ release() ── 同步段调用 session.close()（停接纳 + 退订 + 释放槽位）        │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ 唯一通道：@nomicore/namespace-runtime/internal
                │   openReplicationSessionCoreForRegistry(runtime, options)
┌───────────────▼──────────────────────────────────────────────────────────┐
│  @nomicore/namespace-runtime  src/replication-session.ts（新模块，包内）     │
│  ├─ SessionFanout：构造期 doc.on('update') 恰一监听；按 origin token 抑制回声；│
│  │   每 listener try/catch + 每 listener 每投递独立 Uint8Array 副本            │
│  ├─ RuntimeReplicationHost：{doc, handle, state, sequencer, notifyDirty,    │
│  │   fanout}——由 runtime.ts 构造期一次成型，登记模块级 WeakMap                │
│  ├─ RuntimeReplicationSessionCore：冻结四域 + 六能力；apply 槽 R1–R7 挂接     │
│  │   **同一 WriteSequencer 实例**（与 mutateRoot/replaceSchema/enable/bump    │
│  │   共享唯一 FIFO——AC-3 的结构性保证）                                       │
│  └─ apply 槽序 R1–R7：fatal → 身份/epoch → writable(+degraded bypass) →      │
│      受保护字段检查（scratch clone 预演）→ 一次 Y.applyUpdate(origin=token)    │
│      → session 标记 → await notifyDirty → 释放槽                              │
└──────────────────────────────────────────────────────────────────────────┘
```

分层职责（每层只做自己的事）：

- **runtime 侧 core**：一切需要 doc/handle/state/sequencer/notifyDirty 的机制——gate、scratch-check、apply、SV/diff、扇出、session 内部终态机。公共 Runtime 对象**零改动**（仍恰十二键、`Object.freeze`、index 值导出仍恰一键）。
- **registry 侧**：Lease 语义——released 通道、每 Lease 一活跃 session 计数（O-9：Runtime 多 Lease 共享，计数只能在 Lease 层）、实例角色注入与权限 gate、公共类型声明与稳定 message 单一真相源。

---

## §2. 决策清单（D-1..D-16）

| # | 决策 | 关键理由 |
|---|---|---|
| D-1 | session core 实现于 `namespace-runtime` 新模块 `replication-session.ts`（模块级导出，不经 index）；registry 经 internal subpath 消费 | doc/sequencer/notifyDirty/state 全部闭包私有于 Runtime 构造栈（ADR 0008 L91「生产工厂保留包内」）；session 机制属 Runtime 域，Lease 只做代理编排（ADR 0009 L38 先例） |
| D-2 | host 通道 = Runtime 构造期创建 host + fanout，登记模块级 `WeakMap<NamespaceRuntime, host>`；internal subpath 增第二值导出 `openReplicationSessionCoreForRegistry` | 备选否决：(a) runtimeFactory 返回 `{runtime, host}` 对——破坏既有 20+ 处 `runtimeFactory: () => makeRuntime(...)` 替身注入（既有测试大面积红）；(b) Runtime 增第十三键——击穿 `runtime-registry-internal-seam.test.ts:270` 十二键锁与 ADR 0008 面纪律；(c) `Symbol.for` 反射通道——绕过 internal subpath import 图审计（ADR 0009 L18 治理面）。WeakMap + internal 第二导出：import 图可见、审计谓词（`packages/namespace-registry/src/` 前缀白名单）自动放行、公共面零污染；代价 = internal 值导出键集锁测试同步演进一键（沿该测试文件头注「精确键集断言由实现时同步演进」既定先例，见 §13 ALLOW） |
| D-3 | apply 槽序 R1–R7 与既有 S/E 槽同构（详表 §4.4）：共享骨架 fatal gate → writable gate → 校验 → 单次 doc 写 → 投影/标记 → `await notifyDirty` → 释放；差异 = 输入校验是 scratch 预演（兼畸形字节过滤）、无 VFSL 预校验（ADR 0010 L94 明示例外）、标记写 session 域而非 `state.replication` | ADR 0010 L96–103 六步的字面落地；T-3 和解（同一 FIFO、按操作族各自槽体） |
| D-4 | origin 规则：本地业务/管理写沿用既有无 origin transact（事件 origin 为 `null`，实测见 §14）；session apply 用 `Y.applyUpdate(doc, bytes, token)`，token = 每 session 唯一 symbol；fanout 投递谓词 = `origin !== 本 channel token` | 回声抑制只需「token 等值否定」一个谓词：null origin（一切 Runtime 内部写）恒投全部、apply 源恒被其所属 session 排除——**零 doc-runtime/vfsl 改动**即满足 AC-6 |
| D-5 | O-1 bypass 谓词按 §0 表冻结；bypass 路径同样 `await notifyDirty`（ADR 0010 L135「仍调用 saveDoc 登记」；ADR 0006 #79「degraded 不构成 saveDoc 拒绝理由」互证）；notifier 未绑定时 bypass 亦拒（D6.4 立法：无持久化绑定不得写） | T-1/T-7 和解的机制闭合 |
| D-6 | epoch fence 在 apply 槽内以 `state.replication`（#132 投影链单点：构造期 V2.5 + enable/bump E5.5 整替，两写入点均在 sequencer 内或构造栈，恒诚实）比对冻结值；不等 → core 转终态 `conflicted` | T-6 单一事实源裁决；不重读 live META（避免新的损坏通道——corrupt 只可能出现在构造/槽 E4，session 不引入第三读取点） |
| D-7 | 每 Lease 一活跃 session 计数 + 终态释放槽位 + release 同步段调用既有 `close()`（零新增方法面）；open 编排全同步（check-then-set 原子，JS run-to-completion） | O-9 冻结；SA6 用例 17（同 Lease 二开须在 fence 后成功）与用例 2（活跃期二开拒绝）同时成立的唯一自洽词义 |
| D-8 | role 注入 = 构造 options（生产/testing 同形），缺省 `'hub'`；peer 三管理写 gate 在 Lease 接纳段（released 检查之后、runtime 调用之前） | 缺省 'hub' 是唯一零回归选择（基线无角色 = 全权限 = hub 权限面；必填将击穿既有公共类型与 135 文件绿基线）；切片 9 composition root 必须显式传 role（文档同步项） |
| D-9 | scratch-check 判据 (a) + 受保护常量（hub：SCHEMA 全容器+META 全键；peer：META 全键）+ peer META 白名单空集 + 非 primitive 值判「已改变」 | O-12 冻结（论证 §0）；hub 侧全 META 保护严于 ADR L105 字面最小集（L105 只列 SCHEMA+保留字段）——取更严冻结的理由：docId/createdAt 是 Registry 身份元数据、本切片无任何合法 raw 路径修改非保留 META（L121 未决定），对称谓词可测性与防篡改性均更优；此为**对 ADR 最小检查集的收紧而非放宽**，文档同步时在 ADR 0010 增补节登记 |
| D-10 | session status 词汇按 §0 O-11 冻结（`durability.diskCaughtUp: false` 为字面量类型——结构性地禁止声称 durable） | ADR 0010 L139；SA6 `/memory/i` 正则锚与 `'replication-unvalidated'` 子串锚均由该形状满足 |
| D-11 | 稳定词汇注册表见 §6（全部 message 冻结文案 + 码归属）；新 fatal 码 `NSRT-FATAL-REPLICATION-APPLY-INTERNAL` + WriteSlot 追加 `'replication-apply'`（append-only） | ADR 0008 #93 修订 §5「以包内各稳定码定义处的 append-only 注册表为准」；apply fatal 与管理写 fatal 分码防诊断失真（root/schema/replication 先例） |
| D-12 | 值导出纪律零突破：runtime index 不动（仍恰一键）；registry index 仅 type-only 追加；`package.json` exports 两侧均不动（仍 `['.','./internal']` / `['.','./testing']`） | 简报验收门槛「优先不突破」；session 面值全在对象方法层，无模块级值导出需求 |
| D-13 | fanout 构造期挂接、永不离线（空 channel 集合零成本快路径）；listener 迭代取快照（`[...listeners]`）防重入变异；listener throw 自捕获并计数 `observerFailures` | T-2 和解条件（自捕获/记录/永不抛入 transaction 栈）；ADR 0007 L54「记录或异步上报」取「记录」最小面 |
| D-14 | 文档同步四件套：ADR 0010 增补节（词汇注册）、ADR 0009 两处注记（internal 第二导出 + Lease 面/通道表）、phase-5 文档切片 3/4 锚定、CONTEXT.md 词条扩 | 简报验收门槛：新增公共 API/稳定词汇 ⇒ 文档同步是验收项 |
| D-15 | disabled 命名空间 open → `REPLICATION_NOT_ENABLED` 稳定拒绝（零新词，复用 #132 message 族） | O-7 冻结 |
| D-16 | 本切片不实现：队列/背压/`needs-resync`（切片 6）、WS/认证（切片 6/7）、resetReplica/archive（切片 2/8）、`@nomicore/replication-protocol` 依赖（切片 6 接线） | 简报边界；SA6 已把 needs-resync 列为切 6 验收项 |

---

## §3. 公共面定义（类型签名级）

### §3.1 registry `types.ts` 新增（全部纯结构性；声明纪律延续——零 Runtime 命名类型、零内部 subpath 字面量、零 Y.Doc/DocHandle/sequencer 引用）

```ts
/** 实例静态角色（ADR 0010 静态星型拓扑；O-4 注入点：Registry 构造 options.role）。 */
export type InstanceRole = 'hub' | 'peer';

/** openReplicationSession 输入（ADR 0010 L81 冻结四域中的两域为调用方输入；
 * replicationId/replicationEpoch 由 Runtime 投影链冻结，非调用方输入——SA8 T-6/O-7）。 */
export interface OpenReplicationSessionOptions {
  readonly localRole: InstanceRole;
  /** 远端实例标识；采纳 ADR 0010 L156 instanceId 安全文法（切片 6/7 wire 身份先行词）。 */
  readonly remoteInstanceId: string;
}

/** open 拒绝码闭集（append-only）。 */
export type OpenReplicationSessionIssueCode =
  | 'NAMESPACE_LEASE_RELEASED'        // released lease 通道（冻结码）
  | 'REPLICATION_SESSION_INPUT_INVALID'
  | 'REPLICATION_ROLE_MISMATCH'
  | 'REPLICATION_SESSION_EXISTS'
  | 'REPLICATION_NOT_ENABLED'         // #132 已冻结族的新结果面用法
  | 'RUNTIME_WRITE_DISABLED'          // 既有码族（lifecycle≠ready / fatal 已置位）
  | 'REPLICATION_SESSION_UNSUPPORTED';

export type OpenReplicationSessionResult =
  | Readonly<{ ok: true; session: ReplicationSession }>
  | Readonly<{ ok: false; code: OpenReplicationSessionIssueCode; message: string }>;

/** apply 拒绝码闭集（append-only；fatal 经 RuntimeWriteFatalError rejection，不入本联合）。 */
export type ReplicationSessionApplyRefusalCode =
  | 'NAMESPACE_LEASE_RELEASED'        // lease 已 release（会话吊销）
  | 'REPLICATION_SESSION_CLOSED'      // 显式 close 终态
  | 'REPLICATION_EPOCH_CONFLICTED'    // 冻结 epoch 过期（终态 conflicted）
  | 'REPLICATION_RAW_UPDATE_INVALID'  // 非 Uint8Array / scratch 预演无法接纳
  | 'REPLICATION_PROTECTED_FIELDS_CHANGED'
  | 'RUNTIME_WRITE_DISABLED';         // lifecycle / fatal / writable gate（含 hub-degraded）

export type ReplicationSessionApplyResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: ReplicationSessionApplyRefusalCode; message: string }>;

/** session 独立状态查询面（O-11 冻结词汇；Runtime status 的 replication 域仍只含两态持久事实——T-4）。 */
export interface ReplicationSessionStatus {
  /** session 终态机：open → closed（显式 close 或 Lease release）| conflicted（epoch fence，稳定）。 */
  readonly state: 'open' | 'closed' | 'conflicted';
  readonly localRole: InstanceRole;
  /** 创建时派生冻结：localRole==='peer' ⇔ 'hub-to-peer'（星型拓扑下 peer 的唯一对端是 hub）。 */
  readonly direction: 'hub-to-peer' | 'peer-to-hub';
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  /** 冻结值——永不随 Runtime bump 漂移（ADR 0010 L81；SA6 用例 17 锚）。 */
  readonly replicationEpoch: number;
  /** Runtime 投影链当前 epoch（fence 可观测：currentEpoch !== replicationEpoch ⟹ 已过期）。 */
  readonly currentEpoch: number;
  /** raw apply 成功后置位、session 生命周期内永不清除（session 无法证明 ROOT 重新合法——只置不清是诚实方向）。 */
  readonly rootValidation: 'none' | 'replication-unvalidated';
  /** ADR 0010 L139：必须区分「内存已追上」与「磁盘未追上」，不得声称 durable。
   * memoryCaughtUp **初值冻结为 false**（open 时刻尚无经本 session 的 raw apply——SA2 R1 #7），
   * 首次 apply 槽 R5.5 置 true 后不回落。
   * diskCaughtUp 为字面量 false 类型——本查询面结构性永不声称磁盘已追上
   *（durable 证据通道在本切片不存在；Persistence retry 落盘不由 session 观测）。 */
  readonly durability: Readonly<{ readonly memoryCaughtUp: boolean; readonly diskCaughtUp: false }>;
  /** 扇出 listener 抛错的自捕获计数（ADR 0007 L54「记录」面；不 fatal、不断扇出）。 */
  readonly observerFailures: number;
}

/** ReplicationSession 公共窄能力面（ADR 0010 L81–88 六项 + 冻结四域；恰十键）。 */
export interface ReplicationSession {
  readonly localRole: InstanceRole;
  readonly remoteInstanceId: string;
  readonly replicationId: string;
  readonly replicationEpoch: number;
  /** 反射 live doc 真实状态向量（与 Y.encodeStateVector(doc) 逐字节一致）。终态 session 同步 throw
   * ReplicationSessionClosedError（code REPLICATION_SESSION_CLOSED——沿 getter 域 throw 先例）。 */
  encodeStateVector(): Uint8Array;
  /** 按远端 state vector 编码 diff（Y.encodeStateAsUpdate(doc, sv)）。终态同上。
   * 畸形 state vector（无法被 lib0/yjs 解码）→ 照实抛 Yjs 原生错误——**可信域契约**
   * （调用方为 Host 组装的可信 transport；本方法为同步编码面，不经结果联合包装——SA2 R1 #8 冻结）。 */
  encodeDiff(remoteStateVector: Uint8Array): Uint8Array;
  /** 订阅 owned 本地 updates：每投递独立 Uint8Array 副本；本 session apply 的源 origin 被排除
   * （回声抑制）；返回退订函数。终态 session 退化为永不投递的 no-op 订阅。
   * listener 非函数 → 订阅时同步 TypeError（形状门禁——SA2 R1 #8 冻结；listener 运行期 throw
   * 由扇出层自捕获计数，不熔断）。 */
  subscribeOwnedUpdates(listener: (update: Uint8Array) => void): () => void;
  /** trusted raw apply：进入唯一 write sequencer，槽内完成 dirty notification 后 resolve；
   * 一切拒绝经返回 Promise 的 ok:false 结果结算（含敌意 Uint8Array 子类——A2 陷阱安全拷贝，
   * §4.4）；internal fatal 经 RuntimeWriteFatalError rejection。 */
  applyRemoteUpdate(update: Uint8Array): Promise<ReplicationSessionApplyResult>;
  /** 独立复制状态（全生命周期可观测——沿 lease.getStatus 先例，不在停接纳范围）。
   * 每次调用返回**全新深冻结对象**（沿 runtime buildStatus/INV-R6 先例——SA2 R1 #6：
   * state/currentEpoch/rootValidation/observerFailures/durability 均为时变域，共享可变产物
   * 会污染后续读数）。 */
  getStatus(): Readonly<ReplicationSessionStatus>;
  /** 幂等 close：所有调用返回同一 Promise 实例；首次调用**同步段**标记终态 + 摘除扇出 channel
   * （停接纳即时生效）；Promise 结算语义冻结为 **barrier 语义**（SA2 R1 #5）：resolve 时点 =
   * 先于本次 close() 接纳的全部任务（含在途 apply 槽）经唯一 write sequencer 排空之后
   * （空槽体 barrier 队尾入队——镜像 runtime.close INV-C4 形状，直接服务 ADR 0010 L179
   * 「等待已被 Runtime 接纳的 apply 槽完成但不无限等待网络 ACK」）；**close() 永不 reject**
   * （barrier 为恒绿空槽体，结构性无 reject 面）。后接纳的 apply 在接纳层被拒（A1），不入队。 */
  close(): Promise<void>;
}
```

`NamespaceLease` 接口追加（第十四个成员；released 通道 = 经返回 Promise 结算 `NAMESPACE_LEASE_RELEASED`，与四写同款）：

```ts
export interface NamespaceLease {
  // …既有十三成员不变…
  /** ADR 0010 L73–79：受信任 duplex raw 复制会话入口。raw replication 绕过 VFSL 业务校验
   *（ADR 0010 L94 明示例外）——Host 搭建方负责只把 Lease 交给可信代码。
   * 拒绝全部经返回 Promise 的 ok:false 结果结算（released / 输入形状 / role 不匹配 /
   * 已有活跃 session / 复制未启用 / Runtime lifecycle 或 fatal / 宿主缺席）。 */
  openReplicationSession(options: OpenReplicationSessionOptions): Promise<OpenReplicationSessionResult>;
}
```

生产与 testing 工厂选项追加（O-4）：

```ts
// CreateNamespaceRegistryOptions（生产）与 NamespaceRegistryTestingOverrides（testing）同形追加：
/** 实例静态角色（ADR 0010 静态星型拓扑）。可选，缺省 'hub'（基线全权限等价面——零回归）；
 * 提供非法值 → 构造期同步 TypeError（NAMESPACE_REGISTRY_ROLE_INVALID，检查顺序在 randomBytes 之后）。
 * 生产 composition root（phase-5 切片 9）必须显式传入。 */
readonly role?: InstanceRole;
```

registry `index.ts`：type-only 追加 `InstanceRole / OpenReplicationSessionOptions / OpenReplicationSessionResult / OpenReplicationSessionIssueCode / ReplicationSession / ReplicationSessionStatus / ReplicationSessionApplyResult / ReplicationSessionApplyRefusalCode`（值导出面不变）。

### §3.2 runtime 侧 internal 面（`@nomicore/namespace-runtime/internal` 第二值导出 + type-only）

```ts
// src/replication-session.ts（新模块；index.ts 零 re-export）
export interface RuntimeReplicationSessionOptions {
  readonly localRole: 'hub' | 'peer';
  readonly remoteInstanceId: string;
}
export type RuntimeReplicationSessionApplyRefusalCode =
  | 'REPLICATION_SESSION_CLOSED' | 'REPLICATION_EPOCH_CONFLICTED'
  | 'REPLICATION_RAW_UPDATE_INVALID' | 'REPLICATION_PROTECTED_FIELDS_CHANGED'
  | 'RUNTIME_WRITE_DISABLED'
  | 'NAMESPACE_LEASE_RELEASED';
  // 【SA2 R1 HIGH-1 修法】core 侧联合与公共联合（§3.1 六码）**逐字相同**——这是 §3.3
  // `Equal<RuntimeReplicationSessionCore, ReplicationSession>` 十键逐字段相等成立的前提
  //（SA2 实证：5 码版 TS2344 红、6 码版 exit 0）。`'NAMESPACE_LEASE_RELEASED'` 在 core 侧
  // **结构性永不结算**——唯一产出点是 registry 包装层 wrapCore 的 revoked() 前置检查（§5.1/§5.3）；
  // core 并入该码纯粹是类型层锁面要求，运行时无第二产出路径。
export type RuntimeReplicationSessionApplyResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: RuntimeReplicationSessionApplyRefusalCode; message: string }>;
/** core 与公共 ReplicationSession 十键逐字段同构（close 同为 `Promise<void>` 无参——release 路径
 * 复用同一 close()，不设第二方法面）；由 lease.ts Equal 断言锁死（§3.3）。 */
export interface RuntimeReplicationSessionCore { /* 十成员签名与 §3.1 ReplicationSession 相同 */ }
export type RuntimeReplicationSessionOpenResult =
  | Readonly<{ ok: true; core: RuntimeReplicationSessionCore }>
  | Readonly<{ ok: false; code: 'REPLICATION_NOT_ENABLED' | 'RUNTIME_WRITE_DISABLED' | 'REPLICATION_SESSION_UNSUPPORTED'; message: string }>;
/** 全同步（无 await——Lease 层 check-then-set 原子性的依赖）。open 门序：
 * host 缺席 → lifecycle≠ready → fatal 已置位 → facts disabled → 通过则冻结 facts 建 core。
 * 【显式裁决，SA2 R1 #16】门序**不含 schemaState 检查**（preparing/unavailable 期 open 合法）——
 * 有意行为：apply 与 active schema 无关（raw 无 VFSL 预校验，ADR 0010 L94），复制事实已在
 * 构造期 V2.5 预投影（#132：preparing 期 facts 已诚实）。SA3 不得自行追加 schema gate。 */
export function openReplicationSessionCoreForRegistry(
  runtime: NamespaceRuntime,
  options: RuntimeReplicationSessionOptions,
): RuntimeReplicationSessionOpenResult;

// src/internal.ts 追加（值导出由一键扩为两键——本设计显式裁决 D-2；锁测试同步演进见 §13）：
export { openReplicationSessionCoreForRegistry } from './replication-session.js';
export type { RuntimeReplicationSessionCore, RuntimeReplicationSessionOptions,
  RuntimeReplicationSessionOpenResult, RuntimeReplicationSessionStatus,
  RuntimeReplicationSessionApplyResult, RuntimeReplicationSessionApplyRefusalCode } from './replication-session.js';
```

### §3.3 类型锁面（O-3 的「新锁面机制」）

1. **SA6 test-d 结构探针**（已存在，零改动即为本设计锁）：`HasSessionCaps<ReplicationSession>` 十成员结构检查 + `HasForbiddenRefs`（doc/handle/sequencer/runtime/ydoc/sharedTypes 键缺席）+ `HasOpenReplicationSession<NamespaceLease>` + `HasLeaseRawApply=false` 保持性守卫。
2. **lease.ts 编译期 Equal 断言**（声明图外模块，允许引用 runtime/internal 命名类型——沿既有 `_readAlias` 系列先例）：

```ts
import type { RuntimeReplicationSessionCore, RuntimeReplicationSessionStatus } from '@nomicore/namespace-runtime/internal';
type _sessionCoreAlias = AssertTrue<Equal<RuntimeReplicationSessionCore, ReplicationSession>>;          // 十键逐字段相等
type _sessionStatusAlias = AssertTrue<Equal<RuntimeReplicationSessionStatus, ReplicationSessionStatus>>; // status 形状逐字段相等
// 声明期证明追加进 LeaseTypeAssertions。
```

3. 运行时属性探测（SA6 用例 5）：公共 session 对象 = `Object.freeze` 的**恰十键**字面量（能力键齐 + 句柄键零）。

---

## §4. Runtime 侧 session core 设计

### §4.1 构造期装配（runtime.ts 增量，公共面零变化）

`createNamespaceRuntimeWithSeam` 构造序追加（SA2 R1 #15 时点精化）：

```ts
// V3d'''' 之后、V3e（十二键对象字面量构造）之前：fanout + host 一次成型
//（仅依赖已捕获局部量与 sequencer——INV-N14 纪律延续：纯数据闭包）
const fanout = createSessionFanout(doc);            // 恰一次 doc.on('update', dispatch)
const host: RuntimeReplicationHost = { doc, handle, state, sequencer, notifyDirty: captured.notifyDirty, fanout };
// … V3e：const runtime: NamespaceRuntime = { …十二键… }；Object.freeze(runtime) …

// V3e 之后、函数返回之前（SA2 R1 #15：登记点在 runtime 对象构造后——WeakMap 以对象引用为键）：
registerReplicationHost(runtime, host);             // WeakMap.set——不触碰 runtime 对象本身，无属性污染
```

- `Object.keys(runtime)` 仍恰十二键（WeakMap 登记不触碰对象）——`runtime-registry-internal-seam.test.ts:270` 锁零改动即绿。
- fanout 挂接无条件执行（无 session 时空集合快路径）；**每 Runtime 恰一个** `doc.on('update')` 监听（INV-S2）。

### §4.2 fanout 与 origin 规则（O-10 / AC-6）

```ts
interface SessionChannel {
  readonly applyOrigin: symbol;          // 每 session 唯一 token
  listeners: Set<(u: Uint8Array) => void>;
  failures: number;                      // listener throw 自捕获计数（ADR 0007 L54「记录」）
}
function createSessionFanout(doc: Y.Doc) {
  const channels = new Set<SessionChannel>();
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    for (const ch of channels) {
      if (origin === ch.applyOrigin) continue;      // 回声抑制排除谓词（唯一谓词）
      for (const l of [...ch.listeners]) {          // 快照迭代：重入退订/订阅安全
        try { l(update.slice()); }                  // 每 listener 独立副本（字节不可变纪律）
        catch { ch.failures += 1; }                 // 自捕获：永不抛入 transaction 栈（T-2）
      }
    }
  });
  return { attach(ch) { channels.add(ch); }, detach(ch) { channels.delete(ch); } };
}
```

- 本地业务写/管理写（`doc.transact(fn)` 无 origin → 事件 origin 为 `null`，§14 实测）与 doc-runtime 内部事务：`null !== token` → **投递全部 channel** ✓（AC-6「本地业务写必须仍被订阅」）。
- session apply（`Y.applyUpdate(doc, bytes, token)`）：源 channel 被排除、其余照收 ✓（回声抑制）。
- **零 doc-runtime / vfsl / write.ts 既有事务路径改动**（D-4：不改既有 transact 调用面）。
- 【SA2 R1 #14 显式化】`observerFailures` 为无界纯计数、失败 listener 不熔断不自动退订——O-10 的**显式选择**（ADR 0007 L54「记录」面的最小实现；永久失败的 listener 每次投递仅多一份 `slice()` 副本与 +1 计数）；熔断/退订/背压策略属切片 6 队列属主，本切片不引入。

### §4.3 core 状态机与能力

```
        openReplicationSession（facts 冻结）
              │
              ▼
           ┌open┐
     close()│   │apply 槽 R2 发现冻结 facts ≠ 当前 facts
              ▼   ▼
            closed    conflicted（稳定终态）
              ▲
 release() 同步段调用既有 close()（同一方法面，零新增）
```

- 终态三联拒：apply → 按 §5.3 映射码；`encodeStateVector`/`encodeDiff` → 同步 throw `ReplicationSessionClosedError`（errors.ts 新类，code `REPLICATION_SESSION_CLOSED`，不导出 index——沿 `RuntimeReadDisabledError` 先例）；`subscribeOwnedUpdates` → 返回 no-op 退订（永不投递）；`getStatus` 恒可观测（每次调用全新深冻结对象——§3.1）。
- **两种终态共用同一摘除点（SA2 R1 #4）**：`fanout.detach(channel)` 在 `close()` 首调同步段**与** apply 槽 R2 的 conflicted 转换处各执行一次——即无论经何路径进入终态（显式 close / Lease release 复用 close / epoch fence），存量 listener 一律停止投递（「终态 session 订阅永不投递」对已注册订阅同样成立，transport 不会据旧 session 字节继续错误同步）。
- `close(): Promise<void>`（**结算语义冻结——SA2 R1 #5**）：幂等 same-promise 缓存（沿 `runtime.close` INV-C2 形状）。首调**同步段**做两件事：① 标记终态 + `fanout.detach`（停接纳即时生效，后到的 apply 在接纳层 A1 被拒、不入队）；② `sequencer.enqueue(恒绿空槽体)` 入队 **close barrier**——Promise 的 resolve 时点 = 先于本次 close() 接纳的全部任务（含在途 apply 槽）排空之后（镜像 runtime.close barrier/INV-C4；直接服务 ADR 0010 L179 与 phase-5 切片 9 停机序「等待已被 Runtime 接纳的 apply 槽完成，不无限等待网络 ACK」——notifyDirty 属 dirty 登记非网络 ACK，有界）。**close() 永不 reject**：barrier 槽体为空 async 函数，结构性无 reject 面（§5.2 的 `void activeSession.close()` fire-and-forget 因此零 unhandled rejection 前提成立）。后续调用返回同一 Promise 实例。release 路径调用同一 `close()`（release 事实由 Lease `getStatus()` 单点投影，session status 不复写——O-9/O-11）。
- `encodeStateVector()` = `Y.encodeStateVector(host.doc)`；`encodeDiff(sv)` = `Y.encodeStateAsUpdate(host.doc, sv)`（§14 实测）。

### §4.4 apply 槽序 R1–R7 与 S1–S7 / E1–E7 的同构与差异（AC-3 / T-3）

**接纳层（同步段，非槽——镜像 D5.1 接纳门）**，顺序冻结：

```
A0  lease revoked（registry 包装层）      → NAMESPACE_LEASE_RELEASED（ok:false 结算）
A1  core 终态                             → REPLICATION_SESSION_CLOSED / REPLICATION_EPOCH_CONFLICTED
A2  输入形状：instanceof Uint8Array        → 否则 REPLICATION_RAW_UPDATE_INVALID
    通过则立即 bytes = new Uint8Array(update)——【SA2 R1 #3 陷阱安全构造，冻结】不得用
    update.slice()：敌意子类（class Evil extends Uint8Array { slice(){ throw } }）instanceof
    通过而 slice() 同步 throw，将击穿「一切拒绝经 Promise 结算」；new Uint8Array(update)
    经不可截获的整型索引读取复制，产物为纯 Uint8Array（中性化 Buffer 伪装/子类覆写，
    SA2 实证），排队期间调用方对原对象的变异无效（单读捕获——快照纪律的 bytes 最小实现）
A3  runtime lifecycle ≠ 'ready'           → RUNTIME_WRITE_DISABLED（零入队、零输入副作用语义同 D5.1）
A4  sequencer.enqueue(() => runSessionApplySlot(host, session, bytes))
```

**槽内（R1–R7，ADR 0010 L96–103 六步逐位对应）**：

| 槽位 | 内容 | 与 S/E 槽对应 | 差异说明 |
|---|---|---|---|
| R1 | fatal gate：`state.fatal !== undefined` → `ok:false RUNTIME_WRITE_DISABLED`（零 doc 访问） | = S1/E1 | 同码族，message 分域（§6.2） |
| R2 | 身份/epoch gate：`state.replication` 与冻结 `replicationId`+`replicationEpoch` 比对；不等 → core 终态 `conflicted` **（同步执行 `fanout.detach(channel)`——与 close() 共用同一终态摘除点，SA2 R1 #4：存量 listener 即刻停投）** + `ok:false REPLICATION_EPOCH_CONFLICTED` 零写入 | ≈ E4（领域事实读取）的 session 变体 | 事实源是投影链 `state.replication`（T-6 单点），不读 live META；fence 顺带终态化 + 摘除（O-8 + §4.3 终态纪律） |
| R3 | writable gate + bypass 谓词 + notifier 绑定（O-1）：`handle.getStatus()` throw → `markWriteFatal(env, err, 'replication-apply')` + reject `RuntimeWriteFatalError('write-slot-internal', committed:false)`；`'ready'` → 放行；`'persistence-degraded' ∧ direction==='hub-to-peer' ∧ notifyDirty 绑定` → **放行（唯一例外）**；其余（released/disposed/degraded+peer→hub）→ `ok:false RUNTIME_WRITE_DISABLED`；notifier 未绑定（任意方向含 bypass）→ `ok:false RUNTIME_WRITE_DISABLED` | = S2/E2 | 唯一差异 = degraded 例外窗口（ADR 0010 L131–139 后法决定，T-1 和解）；短路顺序 fatal→getStatus→notifier 与 E2 逐字节同序 |
| R4 | 受保护字段检查（O-12，hub 侧 & peer 侧谓词见 §4.6）：scratch clone 预演 + 内容投影比对；预演 throw（畸形字节）→ `ok:false REPLICATION_RAW_UPDATE_INVALID` 零写入；投影变化 → `ok:false REPLICATION_PROTECTED_FIELDS_CHANGED` 零写入 | ≈ S3/S5 的「输入校验+领域校验」合体 | scratch 预演兼畸形字节过滤器（live doc 永不被无效字节触碰——§14 实测）；**无 VFSL ROOT 预校验**（ADR 0010 L94/L107 明示例外——不校验即特征，非缺陷） |
| R5 | 一次 `Y.applyUpdate(doc, bytes, sessionApplyOrigin)`（受控 origin token） | = S5/E5 单事务 | 本槽唯一 live Y.Doc 写入口；fanout 在事务内同步扇出（ADR 0010 六步之 4「Runtime observer 产出 owned update 与受控 origin」——结构性满足）；throw（结构性不可达：R4 同步预演已过同字节）→ 保守 committed:true `RuntimeWriteFatalError('unknown-pipeline-throw', true)` |
| R5.5 | session 标记：`rootValidation='replication-unvalidated'` 置位（永不清除）+ `memoryCaughtUp=true` | = E5.5 时序镜像 | notify 挂起窗口内 status 已可观测提交事实；标记写 session 域（`state.replication` 不动——session 状态绝不入 Runtime status，T-4） |
| R6 | 同槽 `await notifyDirty()`（**bypass 路径同样调用**——ADR 0010 L135）；throw → `markWriteFatal(env, err, 'replication-apply')` + reject `RuntimeWriteFatalError('notify-dirty-failed', committed:true)` | = S6/E6 | committed 事实诚实（SA6 用例 19 已锚）；不重试 |
| R7 | 槽释放（promise settle `{ok:true}`；sequencer 自动放行下一项） | = S7/E7 | — |

FIFO 证明（SA6 用例 6）：`applyRemoteUpdate`/`mutateRoot` 在同一 `WriteSequencer` 实例上同步接纳定序 → 提交序 [applyA, write, applyB] ⇒ saveEvents 序逐槽累计一致；apply A resolve 时其 R6 已完成（dirty 先于 resolve）。

### §4.5 degraded 矩阵（O-1 谓词落位）

| 实例角色/方向 | handle 状态 | 结果 |
|---|---|---|
| peer，hub→peer（冻结 direction） | `persistence-degraded` | **放行**：内存 apply + `saveDoc` 照常登记（#79：degraded 非 saveDoc 拒绝理由）+ `durability` 区分内存/磁盘 |
| hub，peer→hub | `persistence-degraded` | 拒 `RUNTIME_WRITE_DISABLED` 零写入（L127；读/身份/SV 保留——session 未终态，`encodeStateVector` 照常） |
| 任意 | `released` / `disposed` | 拒 `RUNTIME_WRITE_DISABLED` 零写入（L136「handle 失效不得绕过」） |
| 任意 | `getStatus()` throw | `markWriteFatal` + `RuntimeWriteFatalError(committed:false)`（adapter bug 统一 fatal——E2 同款） |
| 任意（含 bypass） | notifier 未绑定 | 拒 `RUNTIME_WRITE_DISABLED`（D6.4：无持久化绑定不得写——bypass 亦不得「提交成功但永无 dirty 登记」） |
| 任意 | Runtime `closing`/`closed`/fatal | 接纳层 A3 / 槽 R1 拒 `RUNTIME_WRITE_DISABLED`（L136；SA6 用例 16） |

### §4.6 受保护字段检查（O-12 冻结谓词）

```ts
// 冻结常量（raw caller 不得逐次自定义——ADR 0010 L121）。以「接收方本地角色」为键：
const RAW_PROTECTED_FIELDS = Object.freeze({
  // hub session（接收 peer→hub update）：SCHEMA 全容器 + META 全键（L105 + D-9 收紧）
  'hub': { readonly schema: true, readonly meta: true },
  // peer session（接收 hub→peer update）：META 全键保护；SCHEMA/ROOT 放行（L105「允许同步 ROOT、SCHEMA」）
  'peer': { readonly schema: false, readonly meta: true },
} as const);
// peer 允许的 META 白名单：首版空集（frozen const PEER_ALLOWED_META_KEYS: readonly string[] = []）
// —— ⟺ META 全键保护；两侧 META 皆全键 ⇒ META 检查谓词统一为「全键投影相等」，仅 SCHEMA 随角色分叉
```

执行序（槽内同步，无 await）：

```
1. scratch = new Y.Doc(); Y.applyUpdate(scratch, Y.encodeStateAsUpdate(liveDoc));
2. Y.applyUpdate(scratch, bytes);            // throw → REPLICATION_RAW_UPDATE_INVALID
3. 投影比对（内容投影相等判据 (a)；比对对象 = scratch vs liveDoc 的当前投影）：
   - SCHEMA（仅接收方为 hub 时检查）：全部键值投影 deepEqual
   - META（两侧皆检查）：全部键值投影 deepEqual
   - 值投影：primitive（string/number/boolean/null）直比；非 primitive 形态（Yjs 容器/对象——
     SCHEMA/META 契约外值域）保守判「已改变」→ 拒（契约外形态不得经 raw 入容器）
4. 不等 → REPLICATION_PROTECTED_FIELDS_CHANGED（整体拒绝、零写入、saveDoc 0 次、拒绝行为稳定）
```

判据论证（(a) vs (b) vs (c)）：见 §0 O-12；hub 侧全 META 保护为对 L105 最小集的**收紧**（理由 D-9，ADR 增补节登记）。性能注记：scratch 预演 O(doc) 每 apply——本切片正确性优先，增量检查留待后续（非过早优化）。

### §4.7 錯误分类汇总（runtime 侧）

- 一切可预期拒绝（gate/scratch/fence/终态/lifecycle）→ `ok:false` 结果联合（§6.2 message 注册表）。
- internal fatal（getStatus adapter 违约 / R5 未知 throw / R6 notify 失败）→ `RuntimeWriteFatalError` rejection（既有公共值导出，`committed` 诚实；slot 词 `'replication-apply'` → 新 fatal 码 `NSRT-FATAL-REPLICATION-APPLY-INTERNAL`，append-only）。
- `WriteSlot` 联合追加 `'replication-apply'`：`markWriteFatal`/`writeFatalMessage` 增渲染分支（`'root'/'schema'/'replication'` 既有渲染逐字节不变——`runtime-write-fatal-message-rev1.test.ts` 零改动即绿）。

---

## §5. Registry 侧 lease session 设计

### §5.1 openReplicationSession 编排（全同步——check-then-set 原子）

```ts
// lease.ts（controller 闭包内新增）
let activeSession: ReplicationSession | undefined;   // 每 Lease 一活跃 session 计数（O-9：Lease 层）

openReplicationSession: (options) => {
  // ① released 通道（O-3 通道表增补；与四写同款——经返回 Promise 结算）
  if (released) return Promise.resolve(RELEASED_SESSION_OPEN_ISSUE);   // {ok:false, code:'NAMESPACE_LEASE_RELEASED', message: 冻结文案}
  // ② 输入校验（单读捕获 + 全探测 try/catch——沿 enableReplication D-7 纪律；敌意 Proxy 零升级 fatal）
  //    localRole ∈ {'hub','peer'} ∧ remoteInstanceId 匹配 INSTANCE_ID_PATTERN
  //    → 否则 {ok:false, REPLICATION_SESSION_INPUT_INVALID}
  // ③ 角色匹配（O-4）：options.localRole !== deps.role → {ok:false, REPLICATION_ROLE_MISMATCH}
  // ④ 每 Lease 一活跃 session：activeSession 存在且 getStatus().state==='open'
  //    → {ok:false, REPLICATION_SESSION_EXISTS}（终态 closed/conflicted 不占槽——O-8/O-9）
  // ⑤ internal seam（全同步）：
  const opened = openReplicationSessionCoreForRegistry(entry.runtime, { localRole, remoteInstanceId });
  if (!opened.ok) return Promise.resolve({ ok: false, code: opened.code, message: opened.message });
  // ⑥ 包装公共 session（恰十键冻结对象；冻结四域以构造时捕获常量直读——结构性不漂移）：
  activeSession = wrapCore(opened.core, () => released);
  return Promise.resolve({ ok: true, session: activeSession });
}
```

`wrapCore`（registry 侧唯一逻辑层）：

```ts
const session: ReplicationSession = Object.freeze({
  localRole: core.localRole, remoteInstanceId: core.remoteInstanceId,       // 捕获常量
  replicationId: core.replicationId, replicationEpoch: core.replicationEpoch,
  encodeStateVector: () => core.encodeStateVector(),                        // 终态 throw 由 core 承担
  encodeDiff: (sv) => core.encodeDiff(sv),
  subscribeOwnedUpdates: (l) => core.subscribeOwnedUpdates(l),
  applyRemoteUpdate: (u) => revoked()                                        // lease release 先行映射
    ? Promise.resolve({ ok: false, code: 'NAMESPACE_LEASE_RELEASED', message: NAMESPACE_LEASE_RELEASED_MESSAGE })
    : core.applyRemoteUpdate(u),
  getStatus: () => core.getStatus(),
  close: () => core.close(),                                                 // 幂等 same-promise 在 core
});
```

### §5.2 released 通道表增补（O-3）

| Lease 方法 | released 后行为 |
|---|---|
| `openReplicationSession` | **新增行**：经返回 Promise 结算 `{ok:false, code:'NAMESPACE_LEASE_RELEASED', message: NAMESPACE_LEASE_RELEASED_MESSAGE}`（SA6 用例 3 锚） |
| 既有 read/getter/getStatus/四写/release | 不变 |

`doRelease` 同步段追加（在 `entry.leases.delete` 与 observer 事件之后、`onReleased` 之前）：

```ts
if (activeSession !== undefined && activeSession.getStatus().state === 'open') {
  void activeSession.close();   // 复用公共 close()：同步标记终态 + 退订 + 释放 Lease 槽位（零新增方法面）
}
```

（release 不追踪已接纳 apply 槽——ADR 0009 L42；在途槽经 sequencer 自然排空，INV-S11。）

### §5.3 applyRemoteUpdate 拒绝码映射（registry 包装层先行 + core 槽内）

| 触发 | 码 | 结算 |
|---|---|---|
| lease released（包装层 A0） | `NAMESPACE_LEASE_RELEASED` | ok:false |
| core 终态 closed（A1） | `REPLICATION_SESSION_CLOSED` | ok:false |
| core 终态 conflicted（A1） | `REPLICATION_EPOCH_CONFLICTED` | ok:false |
| 输入非 bytes（A2）/ scratch 预演失败（R4） | `REPLICATION_RAW_UPDATE_INVALID` | ok:false |
| lifecycle≠ready（A3）/ fatal（R1）/ writable gate（R3，含 hub-degraded、released/disposed、notifier 未绑定） | `RUNTIME_WRITE_DISABLED` | ok:false |
| epoch fence（R2） | `REPLICATION_EPOCH_CONFLICTED`（core 同步转终态） | ok:false |
| 受保护字段变化（R4） | `REPLICATION_PROTECTED_FIELDS_CHANGED` | ok:false |
| internal fatal（R3/R5/R6） | — | **RuntimeWriteFatalError rejection**（committed 诚实；SA6 用例 19） |

### §5.4 实例角色 gate（O-4 / O-5b）

`deps` 第 4 参增 `role: InstanceRole`（registry 闭包绑定；构造期已过形状门禁）。Lease 接纳段（released 检查之后、runtime 调用之前）：

```ts
const ROLE_PERMISSION_ISSUE = Object.freeze({
  ok: false as const,
  issues: [{ message: REPLICATION_ROLE_PERMISSION_MESSAGE, path: [] }],   // 稳定常量实例——重复调用 JSON 逐字节相同
});
replaceSchema(input) {
  if (released) return Promise.resolve(RELEASED_ISSUE);
  if (deps.role === 'peer') return Promise.resolve(ROLE_PERMISSION_ISSUE);   // ADR 0010 L118
  return entry.runtime.replaceSchema(input);
}
// enableReplication / bumpReplicationEpoch 同款前置 gate（L120 hub-only；enable 的随机抽取在 gate 之后——released/peer 零消耗）
```

- 错误形状 = **既有 `{ok:false; issues}` 联合零改形**（码前缀 message，沿 `REPLICATION_INPUT_INVALID` 族先例）——SA6 用例 13（ok:false + 两次 JSON 逐字节相同 + SCHEMA 载体完整 + ROOT 写不受影响）全满足。
- ROOT 业务写不受角色限制（hub 与 peer 均可本地 ROOT 写——ADR 0010 L117）。
- registry `createRegistryInternal` 增补：options.role 读取（缺省 `'hub'`）+ `assertRoleShape`（非法值 → TypeError `NAMESPACE_REGISTRY_ROLE_INVALID`，检查顺序 clock → scheduler → idleTimeoutMs → randomBytes → role）+ `issueLease` deps 传 role。

### §5.5 idle / shutdown / 多 Lease 交互

- **idle 复用**（SA6 用例 18）：session 槽位是 **Lease 级**状态——新 Lease = 新槽位，idle 复用同一 Runtime 不影响（新 session 冻结当前 facts、观察到旧写状态 ✓）。
- **shutdown**（用例 16）：Registry shutdown → Runtime close → 既有 session 的 apply 经接纳层 A3 拒 `RUNTIME_WRITE_DISABLED`；Registry **不**主动终态化 session（ADR 0010 L179 停止序：transport 先关 channel/session 再释放 Lease——切片 6 职责；本切片 session 保持 open 但写通道死）。Runtime closed 后的观测面（SA2 R1 #9 软化）：`getStatus()` 照常（只读 core 状态与 `state.replication` 投影，零 doc 访问）；`encodeStateVector` 为 **best-effort**——doc 在 Persistence 未驱逐/未 dispose 期间可用，但 handle 已 release、doc 生命周期归 Persistence（ADR 0006），shutdown+dispose 后调用属**停止序违约**（ADR 0010 L179 要求 transport 先关 session），本设计不承诺其结果；切片 6 transport 必须按停止序先行 close session。
- **多 Lease 多 session fan-out**（用例 14）：同 namespace 两 Lease → 两 session → 两 channel 共享一个 fanout（结构性 AC-6）。

---

## §6. 错误与稳定词汇注册表（message 冻结文案）

### §6.1 registry `types.ts` 新增 const（单一真相源；零插值、零值回显）

```ts
export const NAMESPACE_REGISTRY_ROLE_INVALID_MESSAGE =
  'NAMESPACE_REGISTRY_ROLE_INVALID: Registry 实例角色 role 必须是 "hub" 或 "peer"';
export const REPLICATION_SESSION_INPUT_INVALID_MESSAGE =
  'REPLICATION_SESSION_INPUT_INVALID: openReplicationSession 输入必须恰含 localRole（"hub"|"peer"）与 remoteInstanceId（^[a-z][a-z0-9-]{0,62}$）';
export const REPLICATION_ROLE_MISMATCH_MESSAGE =
  'REPLICATION_ROLE_MISMATCH: options.localRole 与实例静态角色不一致（session 的 localRole 必须等于 Registry 构造时注入的 role）——本调用零写入';
export const REPLICATION_SESSION_EXISTS_MESSAGE =
  'REPLICATION_SESSION_EXISTS: 此 Lease 已有一个活跃 ReplicationSession（每 Lease 首版最多一个 duplex session；close 或终态后槽位释放方可再开）——本调用零写入';
export const REPLICATION_ROLE_PERMISSION_MESSAGE =
  'REPLICATION_ROLE_PERMISSION: peer 实例无权本地修改 SCHEMA 或复制保留字段（ADR 0010：SCHEMA 与复制身份 hub-only）——本调用零写入';
```

（`NAMESPACE_LEASE_RELEASED_MESSAGE` 既有 const 复用；`REPLICATION_NOT_ENABLED_MESSAGE` / `RUNTIME_WRITE_DISABLED` 码族复用 #132/errors.ts 既有冻结词——open 结果面的 `REPLICATION_NOT_ENABLED` message 在 registry 侧持结构复制副本，注释互引，沿 `REPLICATION_ID_PATTERN` 双副本先例。）

### §6.2 runtime `errors.ts` / `replication-session.ts` 新增（append-only）

```ts
// errors.ts
export const FATAL_REPLICATION_APPLY_WRITE_INTERNAL_CODE = 'NSRT-FATAL-REPLICATION-APPLY-INTERNAL' as const;
export const FATAL_REPLICATION_APPLY_WRITE_INTERNAL_MESSAGE =
  'REPLICATION apply internal fault：会话 apply 管线产生结果联合之外的 internal fatal；该 fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留。' as const;
/** 终态 session 的同步能力拒绝（getter/编码域 throw 通道——沿 RuntimeReadDisabledError 先例；类不导出 index）。 */
export class ReplicationSessionClosedError extends Error { readonly code = 'REPLICATION_SESSION_CLOSED'; … }

// replication-session.ts（session 域拒绝 message——码前缀 + 零写入尾注，全部恒定文案）
'REPLICATION_SESSION_CLOSED: 此 ReplicationSession 已关闭（close 或 Lease release），不再接纳会话操作——本调用零写入'
'REPLICATION_EPOCH_CONFLICTED: 复制代际已提升，本 session 冻结的 replicationEpoch 已过期（须以新 epoch 显式重建 session 或 reset/bootstrap）——本调用零写入'
'REPLICATION_RAW_UPDATE_INVALID: raw update 非 Uint8Array 或无法被 Yjs 接纳（scratch clone 预演失败）——本调用零写入'
'REPLICATION_PROTECTED_FIELDS_CHANGED: raw update 改变了受保护内容（SCHEMA 容器或 META 字段；受保护集合为冻结常量，raw caller 不得逐次自定义）——本调用零写入'
'REPLICATION_SESSION_UNSUPPORTED: Runtime 未提供复制会话宿主（测试替身 Runtime 或包版本错配）——显式能力缺席拒绝，本调用零写入'
// RUNTIME_WRITE_DISABLED 族分域 message（复用 errors.ts 既有码常量）：
// · lifecycle（接纳层）：'RUNTIME_WRITE_DISABLED: Runtime lifecycle 为 {closing|closed}——close 已停止接纳会话 apply；本调用零写入、输入零访问'
// · fatal（R1）：'RUNTIME_WRITE_DISABLED: fatal 已置位（internal fatal 已永久禁用本 Runtime 的全部写能力）——会话 apply 拒绝；本调用零写入'
// · writable（R3）：'RUNTIME_WRITE_DISABLED: DocHandle 状态 {persistence-degraded 在 peer-to-hub 方向|released|disposed} 不可写（hub degraded 拒绝复制写；released/disposed 同拒）——本调用零写入'
// · notifier（R3）：'RUNTIME_WRITE_DISABLED: notifyDirty 未绑定——degraded bypass 亦不得绕过 dirty 登记；本调用零写入'
```

词汇与既有注册表的关系：`NAMESPACE_LEASE_RELEASED` / `RUNTIME_WRITE_DISABLED` / `REPLICATION_NOT_ENABLED` / `replication-unvalidated` / `RuntimeWriteFatalError.committed` 为 SA6 §6.1 已冻结词，本设计**零改名复用**；新增词全部为上表 append-only 注册（ADR 增补节同步登记，§10）。

---

## §7. 不变量（INV-S1..S14）

| # | 不变量 |
|---|---|
| INV-S1 | **唯一 sequencer**：session apply 槽 `enqueue` 的 sequencer 引用即 Runtime 构造闭包的那一个 `WriteSequencer` 实例；全仓不存在第二条该 namespace 的写队列（T-3/CONTEXT 写序列器 _Avoid_）。 |
| INV-S2 | **单 observer**：每 Runtime 生命周期恰一次 `doc.on('update')` 挂接（构造期），扇出至全部活跃 channel；channel 在**两种终态**（close() 首调同步段、apply 槽 R2 conflicted 转换处）共用同一摘除点 `fanout.detach`（SA2 R1 #4）。 |
| INV-S3 | **回声抑制谓词**：`origin === channel.applyOrigin` ⇒ 不投该 channel；其余一切 origin（含 `null` 本地业务写）⇒ 投全部活跃 channel。 |
| INV-S4 | **字节不可变**：每 listener 每次投递获得独立 `Uint8Array` 副本；listener 对已交付字节的突变不影响 live doc、其他 listener 与后续投递。 |
| INV-S5 | **冻结四域**：`localRole/remoteInstanceId/replicationId/replicationEpoch` 在 open 时捕获为常量，任何 Runtime 状态变化（含 bump）不改变 session 上的值（SA6 用例 17 锚）。 |
| INV-S6 | **身份/epoch gate**：apply 槽内以 `state.replication` 与冻结 id+epoch 比对；不等 ⇒ core 终态 `conflicted` + 零写入拒绝；已过 gate 的在途槽照常提交（gate 瞬时观察——ADR 0008 L47 同构）。 |
| INV-S7 | **degraded bypass 唯一例外**（O-1 谓词）：五条件合取是唯一的非 ready 放行；bypass 路径仍 `await notifyDirty`；普通业务写与 peer→hub update 结构性不可获得该例外。 |
| INV-S8 | **受保护集合冻结常量**：hub 侧 SCHEMA 全容器+META 全键、peer 侧 META 全键、peer META 白名单空集——非调用方可定制（ADR 0010 L121）；拒绝路径先于一切 live doc 写（scratch 预演先行）。 |
| INV-S9 | **raw 无 VFSL 预校验、无 rollback**：ROOT 形态违约照常接受并标记 `replication-unvalidated`；绝不「先 apply 再回滚」、绝不虚假声称 zero-write（ADR 0010 L107）。 |
| INV-S10 | **每 Lease 至多一个活跃 session**（活跃 ⟺ `state==='open'`）；计数在 Lease 层；`closed`/`conflicted` 终态同步释放槽位。 |
| INV-S11 | **release/close 同步停接纳 + barrier 结算**：release 同步段调用既有 `close()`（同一方法面）；close 幂等 same-promise；首调同步段停接纳+摘除，Promise 以恒绿空槽体 barrier 结算——resolve 时点 = 先于 close() 接纳的任务排空之后，**永不 reject**（SA2 R1 #5 冻结）；两者均不取消已接纳 apply 槽（照常排空）。 |
| INV-S12 | **committed 诚实**：apply 的 notify 失败 → `RuntimeWriteFatalError(committed:true)`，committed 事实保留（ext 已在 live doc）、fatal 后 session apply 与业务写同拒 `RUNTIME_WRITE_DISABLED`、读取保留。 |
| INV-S13 | **会话面无句柄泄漏**：公共 session 对象恰十键；不暴露 Y.Doc/DocHandle/sequencer/live shared types（运行时属性探测 + 类型面 + Equal 三重锚）；open 结果只携带 session，绝不携带 runtime/handle。 |
| INV-S14 | **角色静态注入**：role 经 Registry 构造选项一次注入（缺省 'hub'）；peer 的 replaceSchema/enable/bump 在 Lease 接纳段稳定拒绝（重复调用 JSON 逐字节相同）；session `localRole` 必须等于实例 role。 |
| INV-S15 | **A2 陷阱安全拷贝**：apply 接纳层以 `new Uint8Array(update)` 复制输入（绝不用 `update.slice()`——敌意子类可覆写 slice 同步 throw）；敌意 `Uint8Array` 子类的一切拒绝路径经返回 Promise 的 ok:false 结算（SA2 R1 #3 实证修法）。 |
| INV-S16 | **status 产物纪律**：`getStatus()` 每次调用返回全新深冻结对象（共享可变产物污染读数——SA2 R1 #6）；`durability.memoryCaughtUp` 初值冻结 `false`（open 时刻尚无经本 session 的 raw apply——SA2 R1 #7），首次 apply 成功置 true 后不回落。 |

---

## §8. 状态机汇总

**session core**：`open → closed | conflicted`（后两者终态；`conflicted` 由 apply 槽 R2 发现 fence 进入；`closed` 由显式 `close()` 或 Lease release 调用同一 `close()` 进入——`conflicted` 后调用 `close()` 幂等无害，状态保持 `conflicted`）。终态后：apply/SV/diff 拒、订阅永不投递、getStatus 恒可观测。

**openReplicationSession 决策序**（全同步）：released → 输入形状 → role 匹配 → 活跃 session 占槽 → host 缺席/lifecycle/fatal/disabled（internal seam 内；**无 schemaState gate——有意行为，§3.2 显式裁决**）→ 冻结 facts 建 core → 包装发布。

**applyRemoteUpdate 决策序**：revoked → 终态 → bytes 形状（`new Uint8Array(update)` 陷阱安全拷贝，INV-S15）→ lifecycle（接纳层）→ [槽] fatal → facts 比对（不等 → conflicted + fanout.detach）→ writable(+bypass) → scratch 预演 → applyUpdate → 标记 → notifyDirty → resolve。

**close 决策序**：幂等缓存命中 → 返回同一 Promise；否则同步段（标记终态 + fanout.detach，停接纳即时生效）+ 恒绿空槽体 barrier 入队 → Promise 于在途任务排空后 resolve（永不 reject，INV-S11）。

---

## §9. 测试矩阵（SA6 锚点 → 设计落位；逐条对照 SA6 §3 契约锚点表 + 7 AC + O-5 补锚）

| SA6 用例 | 契约 | 设计落位 | 转绿路径 |
|---|---|---|---|
| 1 open 成功 + 冻结四域 | AC-1 | §5.1 ①–⑥ / §4.3 | role 匹配（hub）；facts 从 status 投影链冻结；apply 全链通 |
| 2 每 Lease 至多一 session | AC-1 | §5.1 ④ / INV-S10 | 二次 open → `REPLICATION_SESSION_EXISTS` ok:false（SA6 允许三形态之一）；首个 session 不受影响 |
| 3 released → NAMESPACE_LEASE_RELEASED | AC-1/O-3 | §5.2 通道表 | `{ok:false, code:'NAMESPACE_LEASE_RELEASED'}` 冻结码 |
| 4 六能力真实可用 | AC-2 | §4.3 / §4.4 | SV 逐字节=live；diff=encodeStateAsUpdate(doc,sv)；订阅投递字节可重放；apply ok；status 含 `replication-unvalidated`；close 幂等同值；close 后 apply 非.ok 零写入 |
| 5 属性探测不暴露 | AC-2 | §3.3 / INV-S13 | 恰十键冻结字面量；FORBIDDEN 键全缺席 |
| 6 唯一 FIFO + dirty 先于 resolve | AC-3 | §4.4 / INV-S1 | 同一 sequencer 同步接纳；R6 先于 resolve |
| 7 hub scratch 拒 SCHEMA 变更 | AC-4 | §4.6 / INV-S8 | SCHEMA 全键投影变化 → 整体拒绝零写入零 saveDoc，重复稳定 |
| 8 hub 拒 META.replicationId 变更 | AC-4 | §4.6 | META 全键保护（收紧冻结 D-9） |
| 9 raw 不预校验 + unvalidated + 后续业务写被拒 | AC-4 | §4.4 R4/R5.5 / INV-S9 | 违型 ROOT 照常接受、标记置位；既有 VFSL 业务写管线拒绝（零改动侧） |
| 10 peer 收 hub ROOT/SCHEMA；META 仍拒 | AC-4 | §4.6 | peer 侧 SCHEMA 放行、META 全键保护 |
| 11 peer-degraded bypass 全链 | AC-5/O-6 | §4.5 / INV-S7 | 五条件合取放行；saveDoc 照常（#79）；`durability` 含 memory 面；恢复后 retry 合一（persistence 既有行为） |
| 12 hub-degraded 拒 peer→hub；读/SV 保留 | O-5a | §4.5 | direction 分支拒；session 未终态 → SV 照常、身份冻结未破坏 |
| 13 peer replaceSchema 角色拒绝；enable/bump hub-only | O-5b | §5.4 / INV-S14 | Lease 接纳段常量 issue（JSON 逐字节稳定）；ROOT 写不受限；hub 对照正常 |
| 14 多 Lease fan-out + 回声抑制 + 字节快照 | AC-6 | §4.2 / INV-S3/S4 | 一个 fanout 两 channel；null origin 全投；apply token 抑制源；每投递独立副本 |
| 15 observer 抛错隔离 | AC-6 | §4.2 / INV（T-2） | 每 listener try/catch 自捕获 + `observerFailures` 计数；事务 ok、fatal null、他 session 照收 |
| 16 shutdown → apply RUNTIME_WRITE_DISABLED | AC-7 | §5.5 / §4.4 A3 | 接纳层 lifecycle 拒（JSON 含码）零写入 |
| 17 epoch fencing | AC-7/O-8 | §4.4 R2 / INV-S5/S6 | 冻结值不漂移；fence 零写入零 saveDoc + core 转 conflicted 释放槽位 → 新 session 冻结 epoch 2 可 apply |
| 18 idle 复用 | AC-7 | §5.5 | Lease 级槽位 + Runtime 复用两不误 |
| 19 fatal committed facts | AC-7 | §4.4 R6 / INV-S12 | notify 失败 → RuntimeWriteFatalError committed:true；ext 保留；后续 apply/业务写 RUNTIME_WRITE_DISABLED |
| 20 File 重启 SV 一致 + apply 可用 | AC-7/AC-2 | §4.3 | 同内容 ⇒ 同 SV（Yjs 确定性）；重启后 open/apply 全链 |
| 类型探针 ×5 | AC-1/AC-2/AC-4 | §3.1 / §3.3 | `ReplicationSession` 自 registry 导出；十成员结构含；FORBIDDEN 键无；lease open 方法 Promise/ok 通道；lease 无裸 apply 旁路 |

**AC 覆盖自检**：AC-1（用例 1/2/3）✓；AC-2（4/5/20+类型面）✓；AC-3（6）✓；AC-4（7/8/9/10）✓；AC-5（11）✓；AC-6（14/15）✓；AC-7（16/17/18/19/20）✓；O-5a（12）✓；O-5b（13）✓。**无任何锚需要改形。**

### §9.1 R1 修订新增红灯测试要点（SA3 owned `runtime-replication-session.test.ts` 补充；SA6 20+5 锚点零增改）

| # | 对应修订 | 断言要点（SA2 §5 建议采纳） |
|---|---|---|
| T-1 | HIGH-1 | `lease.ts` Equal 断言随 `pnpm typecheck` 本身即红/绿门；另在包内 test-d 加 `Equal<RuntimeReplicationSessionCore, ReplicationSession>` 双向探针防回退 |
| T-2 | MEDIUM-1 | `class EvilBytes extends Uint8Array { slice(){ throw } }` → `settleOf(session.applyRemoteUpdate(new EvilBytes(8)))` 断言 resolved + ok:false + code `REPLICATION_RAW_UPDATE_INVALID`（绝不同步 throw、绝不 rejection）+ live doc 零变化 + saveEvents 不增 |
| T-3 | MEDIUM-2 | session1 订阅收集 → bump → apply 被 fence（conflicted）→ 随后 `mutateRoot` 成功 → 断言 session1 listener **零新增投递**（终态停投对存量订阅成立）；对照新开 session2 照常收 |
| T-4 | MEDIUM-3 | 受控 notifyDirty 门挂起一个 apply → 调 `close()` → 断言结算序 = apply 先 settle、close Promise 后 settle（barrier 语义）；`void session.close()` 全路径 unhandledRejection 捕获计数为 0（never-reject） |
| T-5 | LOW-1 | `s1=getStatus(); s2=getStatus();` → `s1!==s2` 且 `Object.isFrozen(s1)`；突变副本不影响后续读数 |
| T-6 | LOW-2 | fresh session（未 apply）`durability.memoryCaughtUp===false`；apply 成功后 `===true` |
| T-7 | LOW-3 | `session.encodeDiff(new Uint8Array([0xff,0xff,0xde,0xad]))` → 照实抛 Yjs 原生错误（可信域契约断言）；`subscribeOwnedUpdates(非函数)` → 订阅时同步 TypeError |
| T-8 | INFO-16 | P0 preparing 期（p0Gate 挂起）open → 成功且 facts 诚实；随后 apply 可用（无 schema gate——防 SA3 自行加门） |

---

## §10. 文档同步清单（验收门槛项）

| 文档 | 增补内容 | 依据 |
|---|---|---|
| `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | 新增「issue #134 修订：ReplicationSession 落地冻结词汇」节：open/apply 拒绝码注册（§6 全表）、session status 词汇（state/direction/currentEpoch/rootValidation/durability.memoryCaughtUp（**初值 false**——SA2 R1 #7）+diskCaughtUp:false/observerFailures）、O-7 disabled 拒绝、O-9 生命周期词义（活跃 session 计数/终态释放/release 同步停接纳/close barrier 永不 reject）、O-12 判据（内容投影相等 + 受保护常量 + peer META 白名单空集 + **hub 侧全 META 收紧** + **判据 (a) 边界点名：「删后同值重写 = 内容未变 = 允许」及同值重写历史膨胀注记**——SA2 R1 #11）、O-4 role 注入点与缺省 'hub'、internal seam 第二导出指针、**scratch 预演 O(doc)/apply 已知成本登记与增量检查演进位**（SA2 R1 #12）、**「META 触碰的管理写（enable/bump）字节不得经 raw 回灌对端；epoch 传播走控制面（切片 6 IDENTITY_CHANGED）」踩坑注记**（SA2 R1 #13） | 新增公共 API/稳定词汇 ⇒ ADR 0010 为第一权威；SA8 放行条件与 SA2 三条 INFO 的登记落点 |
| `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md` | 两处注记：(a) §模块 L18——internal subpath 值导出扩为两键（`createNamespaceRuntimeForRegistry` + `openReplicationSessionCoreForRegistry`），消费边界不变（仍仅 Registry 生产代码，import 图审计谓词零改动）；(b) Lease 代理面（L38）与 released 通道表——`openReplicationSession` 增补（授权已在 ADR 0010 L73–79） | ADR 0009 拥有 internal subpath 与 Lease 面契约 |
| `docs/phases/phase-5-websocket-replication.md` | 切片 3/4 锚定：方法名（`encodeStateVector/encodeDiff/subscribeOwnedUpdates/applyRemoteUpdate/getStatus/close` + `openReplicationSession(options)`）、role 注入（options.role，缺省 'hub'）、status 词汇、受保护常量与白名单空集；切片 9 注记：生产 composition root 必须显式传 role；**切片 3「needs-resync 通知」对账注记（SA8 放行条件 C-1，SA2 R1 HIGH-2）：本切片无队列 ⇒ ADR 0010 L113 唯一触发面（队列溢出）结构性不可达；needs-resync 与队列属主 = 切片 6** | phase 文档是实施合同；C-1 为 SA8 放行硬条件 |
| `CONTEXT.md` | `ReplicationSession` 词条扩写（六能力方法名、status 词汇、每 Lease 一活跃 session 词义、终态/conflicted 词）；Hub/Peer 词条注记实例角色经 Registry 构造注入 | 词汇收口 |

不改动：ADR 0006/0007/0008（0008 的 #132 修订节已覆盖 sequencer/status 纪律；T-1 和解按 SA8 建议以 ADR 0010 增补节陈述，不回改 0008 正文——lex posterior）。

---

## §11. 需 SA6 同步改测试清单

**结论：零。** 设计逐项采纳 SA6 §6.2 建议形状（逐项核对：能力方法名 ✓ / open 输入两域 ✓ / open 结果联合 ✓ / role 注入点 `createNamespaceRegistryForTesting` overrides.role ✓ / 冻结四域为 session 只读属性 ✓ / `REPLICATION_SESSION_EXISTS` ✓ / `REPLICATION_SESSION_CLOSED` ✓ / `REPLICATION_EPOCH_CONFLICTED` ✓ / `REPLICATION_ROLE_PERMISSION` ✓ / `durability.memoryCaughtUp`+`diskCaughtUp` ✓ / 已冻结四词零改名 ✓）。可选精化（非阻塞、不属「必须同步」）：SA6 记录 §6.2 自述的 `/memory/i` 正则可精化为 `durability.memoryCaughtUp===true` 断言——SA6 自行决定，与本设计无依赖。

---

## SA2 反馈逐条回应（R1 修订 — 评审报告 `task_namespace-lease-replication-session_sa2_review.md`，2026-08-28）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|:--:|---|---|
| **HIGH-1**（#1）：§3.2 core 5 码 vs §3.1 公共 6 码 vs §3.3 Equal 十键相等自相矛盾（TS2344 实证） | ✅ | §3.2 | core 侧 `RuntimeReplicationSessionApplyRefusalCode` 并入第 6 码 `'NAMESPACE_LEASE_RELEASED'`，与公共联合逐字相同；注释明示该码在 core **结构性永不结算**、唯一产出点是 registry 包装层 `revoked()` 前置检查——类型层锁面要求、运行时无第二产出路径；§15-7 自检三处一致性（SA2 probe5 已实证 6 码版 exit 0）；§9.1 T-1 补 Equal 双向探针防回退 |
| **HIGH-2**（#2）：SA8 放行条件 C-1（needs-resync 推迟对账注记）未落入 §10 phase-5 行 | ✅ | §10 phase-5 行 | 追加对账注记原文：「切片 3『needs-resync 通知』对账注记（SA8 放行条件 C-1）：本切片无队列 ⇒ ADR 0010 L113 唯一触发面（队列溢出）结构性不可达；needs-resync 与队列属主 = 切片 6」 |
| **MEDIUM-1**（#3）：A2 `update.slice()` 可被敌意 Uint8Array 子类覆写同步 throw，击穿「一切拒绝经 Promise 结算」 | ✅ | §4.4 A2 / INV-S15 / §3.1 applyRemoteUpdate JSDoc / §13 新证据行 | 冻结陷阱安全构造 `bytes = new Uint8Array(update)`（不可截获整型索引复制、产物纯 Uint8Array、中性化子类/Buffer 伪装——SA2 实证）；§9.1 T-2 红灯（resolved + ok:false + RAW_UPDATE_INVALID + 零写入） |
| **MEDIUM-2**（#4）：R2 conflicted 终态的 fanout 摘除未写明——存量 listener 将持续收投递 | ✅ | §4.3 / §4.4 R2 / INV-S2 / §8 | 明示「两种终态（close() 首调同步段、apply 槽 R2 conflicted 转换处）共用同一摘除点 `fanout.detach(channel)`」；§9.1 T-3 红灯（fence 后业务写对 session1 listener 零新增投递） |
| **MEDIUM-3**（#5）：close() 的 Promise 结算语义未冻结（立即 vs barrier 二择分歧源）+ never-reject 未声明 | ✅ | §3.1 close JSDoc / §4.3 / INV-S11 / §8 | 冻结 **barrier 语义**：首调同步段停接纳+摘除，恒绿空槽体 barrier 入队，resolve 时点 = 先于 close() 接纳的任务排空之后（镜像 INV-C4，直接服务 ADR 0010 L179/切片 9 停机序）；**close() 永不 reject**（空槽体结构性无 reject 面）——§5.2 fire-and-forget 零 unhandled rejection 前提成立；§9.1 T-4 红灯（结算序 + unhandledRejection 计数 0） |
| **LOW-1**（#6）：getStatus 产物新鲜度/冻结未声明 | ✅ | §3.1 getStatus JSDoc / INV-S16 | 每次调用返回全新深冻结对象（沿 buildStatus/INV-R6 先例）；§9.1 T-5 红灯 |
| **LOW-2**（#7）：memoryCaughtUp 初值未冻结 | ✅ | §3.1 durability JSDoc / INV-S16 / §10 ADR 0010 增补节登记项 | 初值冻结 `false` + 语义注记「open 时刻尚无经本 session 的 raw apply」；§9.1 T-6 红灯 |
| **LOW-3**（#8）：encodeDiff 敌意 SV / subscribe 非函数 listener 行为未定义 | ✅ | §3.1 encodeDiff/subscribe JSDoc | 冻结：畸形 SV → 照实抛 Yjs 原生错误（可信域契约，JSDoc 声明，同步编码面不经结果联合）；非函数 listener → 订阅时同步 TypeError（形状门禁；运行期 throw 由扇出自捕获计数）；§9.1 T-7 红灯 |
| **LOW-4**（#9）：Runtime close 后 encodeStateVector「照常」断言缺机制支撑（handle 已 release、doc 归 Persistence） | ✅ | §5.5 shutdown 条目 | 软化：`getStatus()` 照常（零 doc 访问）；`encodeStateVector` best-effort——shutdown+dispose 后调用属**停止序违约**（ADR 0010 L179 要求 transport 先关 session），不承诺其结果；切片 6 transport 必须按停止序先行 close |
| **LOW-5**（#10 / SA8 R-4）：§14 表第 5 行命名笔误 | ✅ | §14 表 | `openRuntimeReplicationSessionForRegistry` → `openReplicationSessionCoreForRegistry`（与 §0/§3.2/D-2 统一） |
| **INFO-1**（#11）：判据 (a) 允许「删后同值重写」边界未点名 | ✅ | §10 ADR 0010 增补节登记项 | 点名边界「删后同值重写 = 内容未变 = 允许」+ 同值重写历史膨胀注记（可信域威胁、危害有界）——防后续审查者误判重开议题；机制零改动（O-12 裁决推论） |
| **INFO-2**（#12）：scratch O(doc)/apply 成本未入 ADR 登记 | ✅ | §10 ADR 0010 增补节登记项 | 已知成本登记 + 增量检查演进位；§4.6 性能注记保持 |
| **INFO-3**（#13）：enable/bump 字节经 raw 回灌对端的踩坑点未注记 | ✅ | §10 ADR 0010 增补节登记项 | 注记：「META 触碰的管理写字节不得经 raw 回灌对端；epoch 传播走控制面（切片 6 IDENTITY_CHANGED）」 |
| **INFO-4**（#14）：observerFailures 无界计数 + 不熔断 | ✅（接受现状，显式化） | §4.2 新增 bullet | 注明这是 O-10 的**显式选择**（ADR 0007 L54「记录」面最小实现）；熔断/退订/背压属切片 6 队列属主——与 SA2 结论一致，机制零改动 |
| **INFO-5**（#15）：§4.1 伪代码时点笔误（registerReplicationHost 引用尚未构造的 runtime） | ✅ | §4.1 | 精化：fanout+host 创建在 V3d 之后 V3e 之前；WeakMap 登记在 V3e（对象构造）之后、返回之前 |
| **INFO-6**（#16）：P0 preparing 期 open 为隐式允许——建议明示防 SA3 自行加门 | ✅ | §3.2 open 门序注释 / §8 / §9.1 T-8 | 显式裁决：「门序不含 schemaState 检查——有意行为：apply 与 active schema 无关（raw 无 VFSL 预校验），facts 构造期 V2.5 已预投影；SA3 不得自行追加 schema gate」 |

**R1 修订不变项**：O-1..O-12 裁决骨架（SA8 已背书）、机制层（唯一 sequencer 挂接/WeakMap host seam/fanout-origin/scratch 判据/degraded 矩阵/生命周期词义——SA2 认定「经全维度攻击存活」）、§12 ALLOW/DENY 边界（仅 SA3 owned 测试条目的用例清单扩容）、§11 需 SA6 同步改测试清单（仍为零——SA2 §2.4 逐项核对确认 20+5 锚点零挑战，本修订全部落在锚点间空隙）。

---

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-runtime/src/replication-session.ts` — **新建**：fanout hub、RuntimeReplicationHost、WeakMap 登记、core 工厂、apply 槽 R1–R7、scratch-check、session status 投影、session 域拒绝 message（§4 全部；约 420–520 行）。
- `packages/namespace-runtime/src/runtime.ts` — 修改：构造期 fanout+host 创建与 WeakMap 登记（§4.1；≤ 30 行，公共面零变化）。
- `packages/namespace-runtime/src/write.ts` — 修改：`WriteSlot` 追加 `'replication-apply'` + `markWriteFatal`/`writeFatalMessage` 渲染分支（既有 slot 渲染逐字节不变；≤ 15 行）。
- `packages/namespace-runtime/src/errors.ts` — 修改：append-only 新 fatal 码/文案 + `ReplicationSessionClosedError`（≤ 40 行）。
- `packages/namespace-runtime/src/internal.ts` — 修改：第二值导出 + type-only 导出 + 头注纪律更新（≤ 45 行；D-2 显式裁决）。
- `packages/namespace-registry/src/types.ts` — 修改：§3.1 全部新类型 + §6.1 message 常量 + `NamespaceLease.openReplicationSession` + 两工厂 options.role（约 130–170 行）。
- `packages/namespace-registry/src/lease.ts` — 修改：released 通道行 + role 三 gate + open 编排 + wrapCore + doRelease 会话终结 + Equal 断言追加（约 140–180 行）。
- `packages/namespace-registry/src/registry.ts` — 修改：role 读取/形状门禁 + issueLease deps.role（≤ 35 行）。
- `packages/namespace-registry/src/testing.ts` — 修改：overrides.role 透传（≤ 10 行）。
- `packages/namespace-registry/src/index.ts` — 修改：type-only 追加导出（≤ 12 行）。
- `packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts` — 修改：internal 值导出键集锁由 `['createNamespaceRuntimeForRegistry']` 演进为两键（沿该文件头注「精确键集断言由实现时同步演进」既定先例；约 4 行——**既有测试文件的唯一必要改动**）。
- `packages/namespace-runtime/test/runtime-replication-session.test.ts` — **新建 [SA3 owned]**：单包级槽级测试（fanout 隔离/origin 谓词逐项/R 门序短路/gate 访问计数/role 无关面 + **R1 新增 §9.1 T-1..T-8：Equal 双向探针/敌意子类 Promise 结算/conflicted 终态停投/close barrier 结算序与 never-reject/status 新鲜冻结/memoryCaughtUp 初值/敌意 SV 与非函数 listener/P0 preparing 期 open**），沿 `runtime-replication-write.test.ts` 先例（约 300–420 行）。
- `packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` — `[SA6 owned]` 已存在：红灯转绿目标文件；SA3 不得改断言（本设计零改形要求，§11）。
- `packages/namespace-registry/test/registry-phase5-replication-session-surface.test-d.ts` — `[SA6 owned]` 同上。
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` — 修改：增补节（§10；约 30–45 行）。
- `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md` — 修改：两处注记（§10；约 10–16 行）。
- `docs/phases/phase-5-websocket-replication.md` — 修改：切片 3/4 锚定 + 切片 9 role 注记（§10；约 15–25 行）。
- `CONTEXT.md` — 修改：ReplicationSession 词条扩写 + Hub/Peer 注记（§10；约 10–15 行）。

### DENY LIST

- `packages/namespace-runtime/src/index.ts` — 值导出面冻结（恰一键）；本设计零改动（D-12）。
- `packages/namespace-runtime/package.json` / `packages/namespace-registry/package.json` — exports 键集不变（`['.','./internal']` / `['.','./testing']` 锁测试零改动即绿）。
- `packages/namespace-registry/src/plugin.ts` — 插件 config 不加 role（composition root 职责，切片 9）。
- `packages/namespace-registry/src/observer.ts` — 不扩 RegistryObserverEvent（fanout 失败经 session status `observerFailures` 记录；插件级 observer 留切片 6/8）。
- `packages/persistence/**` — dirty/durable 契约不动；degraded retry 为既有行为。
- `packages/doc-runtime/**`、`packages/vfsl/**` — origin 经 `null` 默认传导，零改动（D-4）。
- `packages/replication-protocol/**` — 本切片非依赖（切片 6 接线）。
- `packages/namespace-runtime/test/runtime-write-fatal-message-rev1.test.ts` — 既有 slot 渲染逐字节保持（新增分支为加法），不改。
- `apps/**`、`domains/**` — 与本切片无关。

## §13. 协议假设依据 (Protocol Assumption Evidence)

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| `Y.applyUpdate(doc, bytes, origin)` 第三参 origin 原样回传至 `'update'` 事件第二参；`doc.transact(fn)`（无 origin）事件 origin 为 `null` | **设计期实测验证** | `packages/namespace-runtime` 下 node 实测：`origins: [ 'Symbol(sessionA)', 'null' ]`（命令与完整输出已附于设计过程记录；同款 API 亦为 y-protocols/sync 标准用法，yjs 官方文档 `Y.applyUpdate(doc, update, transactionOrigin)` 与 `doc.on('update', (update, origin, doc, tr))`） | 低 |
| `Y.encodeStateAsUpdate(doc, sv)` = 相对 sv 的 diff；`Y.encodeStateVector(doc)` 反射真实 SV | 设计期实测 + 现有测试引用 | 实测 `diff replay ROOT: {"n":9,"ext":7}`（pre-view 仅空 SV）；SA6 红文件 §replayDelta/makeRemoteUpdate 即同款用法（自举+增量重放） | 低 |
| scratch clone 内容投影比较可行；同内容 ⇒ 投影相等；改变 ⇒ 不等 | 设计期实测 | 实测 `scratch equal before: true \| after malicious: false`（SCHEMA.note 注入被投影比较检出） | 低 |
| 畸形字节在 scratch clone 上 `applyUpdate` 同步 throw（live doc 可被预演保护） | 设计期实测 | 实测 `malformed throws on scratch: Error` | 低 |
| `saveDoc` 在 `persistence-degraded` 下仍 resolve（bypass 槽 R6 可完成登记） | ADR 引用 + 现有测试引用 | ADR 0006 #79 修订 L190–195「entry 处于 persistence-degraded 不构成拒绝理由」；#132 既有 degraded 用例（`registry-phase5-replication-red.test.ts` degraded retry 场景）已实证 MemoryPersistence 行为 | 低 |
| 每 listener 独立 `Uint8Array` 副本足以保证字节不可变 | 源码引用 + 语言语义 | Yjs 每 transaction 新建 update 数组；`TypedArray.prototype.slice` 返回独立缓冲（ECMAScript 语义）；SA6 用例 14 步 3 以 `fill(0xff)` 锚 | 低 |
| 敌意 `Uint8Array` 子类（覆写 `slice()` 同步 throw）可被 `new Uint8Array(update)` 中性化 | 设计期实测 + **SA2 独立复跑**（双源） | SA2 评审 §0/§7（`/tmp/sa2-probe/yjs-check2.mjs`）：`hostile subclass slice throws: true / instanceof: true`；`new Uint8Array(subclass) ok, ctor Uint8Array`——INV-S15 修法依据 | 低 |
| Yjs origin/diff/scratch 四项语义（§4.2/§4.3/§4.6 根基） | **SA2 独立复跑证实**（双源） | SA2 评审 §0：`origins: ['null','Symbol(sessionA)','null']`、判据 (a) 同值重写允许/删键拒/畸形字节 scratch throw——与 §13 前四行实测互为第二来源 | 低 |

（本设计无 HTTP/WS/端口/跨进程/CI runner 类协议假设——WS/认证属切片 6/7 非目标。）

## §14. 契约改动连锁审计 (Contract Change Caller Audit)

**无既有公共函数契约改动**（本设计为纯加法新面 + 一处内部枚举 append-only 扩成员 + 一处 deps 参数加字段）。逐项：

| 函数/面 | 文件 | 改动前契约 | 改动后契约 | Caller 处置 |
|---|---|---|---|---|
| `WriteSlot`（类型联合） | `namespace-runtime/src/write.ts` | `'root'\|'schema'\|'replication'` | 追加 `'replication-apply'` | 既有调用（write.ts 内部 + replication-write.ts）零改动（参数缺省/既有字面量不受影响）；新消费者仅 session 槽 |
| `createLeaseController` 第 4 参 `deps` | `namespace-registry/src/lease.ts` | `{ drawReplicationId }` | `{ drawReplicationId, role }` | **唯一 caller** `registry.ts issueLease`（registry.ts:706）同步增传 role——已列 ALLOW |
| `internal.ts` 导出面 | `namespace-runtime/src/internal.ts` | 值导出一键 | 值导出两键（加法） | 既有 caller `registry.ts:46`（`createNamespaceRuntimeForRegistry`）零影响；新 caller `lease.ts`（`openReplicationSessionCoreForRegistry`）；键集锁测试演进已列 ALLOW |
| `NamespaceRegistryInternalOptions` / testing overrides | registry `registry.ts`/`testing.ts` | 无 role | 可选 role（缺省 'hub'） | 既有全部 135 测试文件零传 role ⇒ 行为零回归（缺省 = 基线全权限等价面） |
| `openReplicationSessionCoreForRegistry`（新） | `namespace-runtime/src/replication-session.ts` | 不存在 | 全同步 `(runtime, options) → open result` | 新 caller 唯一 `lease.ts`（模块边界审计白名单 `packages/namespace-registry/src/` 自动放行） |
| `NamespaceLease` 接口 | registry `types.ts` | 十三成员 | 追加 `openReplicationSession`（加法） | 既有消费者结构性兼容（接口加法）；SA6 类型面守卫 `HasLeaseRawApply=false` 仍成立（无 applyRemoteUpdate/applyUpdate/rawUpdate 键） |

抓全方法备注：`git grep -n "createLeaseController\|createNamespaceRuntimeForRegistry\|WriteSlot" -- 'packages/**/*.ts'`——分别仅 registry.ts 单点、registry.ts 单点、write.ts/replication-write.ts 内部。

---

## §15. 设计自检结论

1. **SA6 §3 契约锚点表 10 行**：§9 矩阵逐条有实现路径，零锚改形。
2. **7 AC + O-5 两补锚**：§9 末行自检全 ✓。
3. **SA8 O-1..O-12**：§0 逐条显式裁决，正文 §2/§4/§5/§6 落实。
4. **T-1..T-7 和解条件**：T-1（O-1 谓词+ADR 0010 增补节陈述）、T-2（fanout 自捕获+记录）、T-3（同一 sequencer、槽体各自）、T-4（session 状态不入 Runtime status）、T-5（internal seam 显式裁决）、T-6（投影链单点冻结/比对）、T-7（四态词精确化）全部机制闭合。
5. **公共面纪律**：runtime 值导出仍恰一键、十二键对象面不变、exports 不变；registry 主入口 type-only 追加——简报「优先不突破」成立。
6. **最小扩面**：不改 doc-runtime/vfsl/persistence/plugin；不改任何既有 transact origin；唯一既有测试改动 = internal 键集锁演进一行（既定先例）。
7. **R1 修订自检（SA2 HIGH-1 修法后三处码联合一致性——SA2 probe5 验证路径）**：§3.1 公共 `ReplicationSessionApplyRefusalCode`（6 码）≡ §3.2 core `RuntimeReplicationSessionApplyRefusalCode`（R1 起并入第 6 码 `NAMESPACE_LEASE_RELEASED`，注释产出点归属 registry 包装层）⟹ §3.3 `Equal<RuntimeReplicationSessionCore, ReplicationSession>` 十键逐字段相等**可满足**（SA2 实证：6 码版 `npx tsc --noEmit --strict` exit 0，5 码版 TS2344）；全文 grep 确认无第 5 码残留表述（见 R1 修订记录）。
8. **R1 SA6 影响**：SA2 逐条核对确认 20 行为用例 + 5 类型探针零锚挑战——本修订全部落在锚点之间的规约空隙（close 结算序/敌意子类/终态摘除/初值/新鲜度），**需 SA6 同步改测试清单仍为 §11 的「零」**；新增红灯测试（§9.1 T-1..T-8）全部落 SA3 owned `runtime-replication-session.test.ts`。
