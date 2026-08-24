# 设计文档 — @nomicore/namespace-runtime：原子 SCHEMA replacement 与 ROOT generation（issue #91）

- Issue: #91（feature）｜branch `fix/issue-91-on-docs-namespace-runtime`｜base `docs/namespace-runtime`（HEAD 1616c28）
- 契约源：ADR-0008（唯一行为契约源）+ SA6 冻结红灯测试（15+1 锚）+ 任务简报「关键上下文」10 条
- 前置交付（已核实本分支 HEAD 在位）：#89 骨架/同步读取面/队首 P0（df22660）、#90 唯一 sequencer + validated ROOT write（1616c28）、#87/#88 doc-runtime fatal 契约 + replaceRootContent
- **设计期实测**：本设计的关键行为假设（validateLogicalSnapshot 严格性 / buildTopEntries F7 / ⑥ 比较基准 / 单事务 update 计数 / 公共成员类型与冻结孪生的逆变兼容）已用真实 vfsl/doc-runtime/yjs 逐项验证，命令与输出见 §12（R1.1 起附可复现脚本全文 §12.1；SA2 评审已对 9/9 条独立复跑证实，见其报告 §6/§7）。
- **修订史**：R1（2026-08-24 初版）→ **R1.1**（2026-08-24，落实 SA2 R1 评审——verdict **pass**，2 MEDIUM（A1/A2）+ 6 LOW（A3–A8）全部落入正文；逐条 mapping 见文末「SA2 反馈逐条回应」节）。

---

## §0. 任务定位与交付边界

**做什么**：交付 ADR-0008「ROOT write 与 SCHEMA write」节的 SCHEMA write 全部五步——`runtime.replaceSchema({ schema, root? })` 成为公共面第九键；与 mutateRoot 共享唯一严格 FIFO write sequencer；编译 proposed → （未提供 root：按 proposed derived 严格提取并验证当前 ROOT / 提供 root：验证并 detached 构造完整新内容）→ 单 transaction 原子替换 SCHEMA（clear + 恰四键）与必要 ROOT generation → transaction 返回后立即安装新 active tools → 再 await notifyDirty。

**不做什么**（后续 issue，本设计零预写）：`close()` barrier 与生命周期 gate 扩展位、公共事件订阅、META 写、mutateRoot 的 delete/array 操作族、Registry。

**必须新增的底层演进**（ADR-0008 §必要的底层演进 3 的收口）：doc-runtime 增设一个**包内组合 seam** `replaceSchemaAndRoot`——由它自开 `doc.transact`，事务体内消费 `buildTopEntries` 产物执行「SCHEMA clear+四键重写 + ROOT clear+install」。这正是 #88 设计 §5/D6 第 3 条**预先授权**的载体（原文：「该组合的正确载体是未来的包内组合 seam……由该 seam 自开 doc.transact，事务体内直接消费 buildTopEntries 产物执行『SCHEMA clear+四键重写 + ROOT clear+install』……届时无需放宽 replaceRootContent 的 ⓪，也无需 owner 裁决调整本接缝契约」）。本任务就是那个「届时」。

---

## §1. 契约来源与现状盘点

### 1.1 ADR-0008 条款 → 本设计消费映射

| ADR 条款 | 原文要点 | 本设计落点 |
|---|---|---|
| §单一 write sequencer | 所有受控写共享唯一严格 FIFO；输入排队期间可变、槽起点受控 snapshotter；degraded 阻止 ROOT/SCHEMA 及未来一切 Y.Doc 写；fatal 后已排队写仍取得槽、零访问输入、零写入 `RUNTIME_WRITE_DISABLED` | D2 槽序 S1–S3 逐位复用 write.ts；D1 共享同一 WriteSequencer 实例；D9 |
| §P0 与 active schema | 「正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write 仍可修复」；ROOT write 在自己槽开始时用当时 active schema | D4（S4' 不消费 active schema，只编译 proposed）；D8（成功后恢复 rootWrite） |
| §ROOT write 与 SCHEMA write | SCHEMA write 五步 + 「SCHEMA 是顶层具名 Y.Map……clear() 后写入恰好 lang/version/id/text 四个字符串键」+ 「提供完整 ROOT 时保留顶层 doc.getMap('ROOT') identity……不提供 ROOT 时不修改 ROOT，也不破坏其 identity」+ 「编译/校验/构造失败均发生在 transaction 前，SCHEMA/ROOT 零写入，active tools 不变。读取在准备期间继续观察旧 committed generation」 | D2/D6/D7/D8 |
| §Fatal 与失败通道 | 「ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型」；committed:false 不 notify；committed:true/未知保守 best-effort notify 但始终 reject；永久关写保读 | D5/D9 |
| §必要的底层演进 3 | 「SCHEMA replacement 可复用 detached builder 与原子 ROOT-content replacement helper，不复制 materialization 逻辑」 | D6（组合 seam 复用 buildTopEntries/probeRoot/tx-guard/install-verify/transactGuarded，仓内零第二份构造规则） |

### 1.2 前置交付消费面（已核实源码，只读消费）

| 资产 | 位置 | 本设计用法 |
|---|---|---|
| `WriteSequencer.enqueue`（泛型 FIFO，链尾恒绿） | `namespace-runtime/src/sequencer.ts` | 零改动直接复用（T=ReplaceSchemaResult） |
| `runRootWriteSlot` 槽体 + 受控 snapshotter + fatal 机械 | `namespace-runtime/src/write.ts` | S1/S2/S3/S6/S7 与 fatal 分类机械**导出复用**（D3/D9；ROOT 路径行为字节不变） |
| `RuntimeState` / `installActive` / `assertCompiledShape` / `toIssueSummary` | `namespace-runtime/src/p0.ts` | installActive 复用为「安装 active schema 单点」并增 `delete state.schemaIssue`；assertCompiledShape @internal 导出并**扩展检查面**（envelope 恰四键封闭 + 四值型——R1.1/A1，对 P0 零回归：⑤ 违约本就 throw → ⑦ fatal，且 P0 冻结测试无畸形 ok:true 注入）；toIssueSummary @internal 导出（D8/D5） |
| `RuntimeWriteFatalError` + phase 注册表 + 稳定码 | `namespace-runtime/src/errors.ts` | append-only 增补（D9）：`schema-compile-throw` phase、SCHEMA write fatal 摘要 code |
| `createNamespaceRuntimeWithSeam`（seam：handle/p0Gate?/compile?/notifyDirty?） | `namespace-runtime/src/runtime.ts` | **零新增注入点**：既有 `compile` seam 同时服务 P0 与 replaceSchema（D5，SA6 测试侧声明已锚定） |
| `buildTopEntries` / `probeRoot` / `assertOutermostTransactionContext` / `transactGuarded` / `verifyInstall` / `verifySnapshotIntact` / `extractYjsSnapshot` | `doc-runtime/src/*`（包内） | D6 组合 seam 的全部 prepare/commit/verify 部件，零修改 |
| `compileSchemaEnvelope`（ok 产物恰四键 envelope + module/derived + 双指纹，递归深冻结） | `@nomicore/vfsl` | S4' 编译（经 seam 注入路由） |
| `validateLogicalSnapshot`（严格：缺必填/未知键/类型错均 issue） | `@nomicore/vfsl` | keep-root 分支与 replace-root 分支的逻辑验证 |

### 1.3 SA6 冻结契约归纳（15+1 锚，只可补充不可收窄）

已在 §9 逐锚映射。两条对设计**有强制裁决力**的锚（本设计的两个非平凡裁决由此逼出）：

- **锚 15（AC3 快照获胜用例）**：proposed schema 为 `ns-2b`（仅声明 `{a:string; n:number}`）而提供的 root 为 `{n:999, a:'x', b:true}`（含未声明顶层键 `b`）→ 断言 `ok:true` 且 `read(['n'])===999`。实测证明 `validateLogicalSnapshot` 与 `buildTopEntries` 都会响亮拒绝未声明键（§12 依据 1/2）→ **提供 root 分支必须先做顶层声明域投影**（D7）。
- **锚 9（AC6 时序）**：notifier 挂住窗口内 `getActiveSchema().id` 必须已是新值 → install 必须同步发生在 transaction 返回与 `await notifyDirty()` 之间（D8）。

---

## §2. 需求推演（Feature）：不变量清单

| # | 不变量 | 锚定 |
|---|---|---|
| INV-S1 | sequencer 共享：`replaceSchema` 与 `mutateRoot` 经**同一** WriteSequencer 实例入队（同步接纳定序、占槽互斥、S6 同槽 await notifyDirty 构成屏障，双向互通） | AC1/锚3 |
| INV-S2 | 槽序不可重排：S1 fatal gate → S2 writable+notifier 绑定 → S3 输入快照+形状 → S4 proposed 编译 → S5 组合 seam（验证+构造+单事务+verify）→ S5.5 安装 active tools → S6 await notifyDirty → S7 槽释放。S1/S2 零输入访问 | ADR 槽序/锚11/12 |
| INV-S3 | 零写入失败面：编译失败/提取失败/逻辑校验失败/构造失败/快照拒绝/输入形状错误/write-disabled → `ok:false` 且 0 更新事件、0 notifier、state 字节不变、SCHEMA/ROOT 内容不变、active tools（getActiveSchema）不变、读取保留 | AC7/锚10 |
| INV-S4 | 单事务原子：SCHEMA clear+恰四键与（提供 root 时）ROOT clear+install 在**同一** `doc.transact`；成功 = 恰 1 次 Y.Doc 更新事件 + 恰 1 次 notifier | AC5/锚8 |
| INV-S5 | identity：顶层 `doc.getMap('ROOT')` 与 `doc.getMap('SCHEMA')` 实例跨成功调用严格同一（本设计全程 clear+set，无 delete/换名/异型写入）；未提供 root 时 ROOT 零修改；其下旧 Yjs 子类型 identity 可失效（不承诺） | AC5/锚5/6/7 |
| INV-S6 | AC6 时序：transaction 返回后**同步**安装新 active tools（含 schemaState→ready、schemaIssue 清除），再 `await notifyDirty()`；notifier 挂住窗口内 getActiveSchema/getSchemaEnvelope/read 已观察新 generation | AC6/锚9/13 |
| INV-S7 | 不依赖当前 schema 可编译：S4' 只消费 proposed（不读 state.activeTools）；P0 unavailable 态照常入槽执行；成功后 rootWrite 随 schemaState='ready' 恢复；persistence-degraded / prior fatal 仍拒（S1/S2） | AC1/AC8/锚4/11 |
| INV-S8 | 读隔离：准备/排队期间 read/getSchemaEnvelope/getActiveSchema 继续观察旧 committed generation；transaction 后才观察新 SCHEMA/ROOT 且 active identity 同步切换 | AC9/锚13 |
| INV-S9 | fatal 通道：internal fatal 一律 `RuntimeWriteFatalError` rejection + `markWriteFatal` 永久禁写保读；committed 诚实（compile 通道异常 → false（结构上先于一切 doc 写）；seam branded 透传；seam 未知异常 → true 保守；notify 失败 → true）；committed:true 槽内 best-effort notify 恰一次 | ADR §Fatal/锚2 |
| INV-S10 | 独立窄结果联合：`ReplaceSchemaResult = {ok:true} | {ok:false; issues: unknown[]}`，runtime 构造的每个 issue 恒为 `{message, path}`（`SchemaReplacementIssue` 构造侧纪律）；不复用 `RootMutationIssue`，不形成巨型 write issue | AC10/锚2/ADR |
| INV-S11 | 入口窄：模块级入口无 `replaceSchema` 值导出（`entry.replaceSchema === undefined`）；runtime 公共面恰九键 | 锚1 |
| INV-S12 | 顶层声明域投影：提供 root 时，snapshot 先投影到 proposed 结构树**顶层声明键集**（Record 形全保留；union/非 map 形 root 不投影交由下游严格拒绝）；验证、构造与 ⑥ 校验一律消费投影形态 | 锚15（强制）/§12 依据 |

---

## §3. 包结构与模块职责

```
packages/namespace-runtime/src/
  runtime.ts        修改：第九键 replaceSchema + SchemaWriteEnv 构造（V3c''，同一批捕获局部量）
  schema-write.ts   新建：SCHEMA 写槽唯一实现（S1–S7 槽体 + 编译步 + 输入形状检查 + issue 映射）
  write.ts          修改：导出共享槽基建（snapshotter/fatal 机械/disabled），供 schema-write.ts 复用；
                    fatal message 参数化槽位名词（ROOT 路径渲染逐字节不变）
  p0.ts             修改：@internal 导出 installActive/assertCompiledShape/toIssueSummary；
                    installActive 增 delete state.schemaIssue（P0 调用点为 no-op）
  errors.ts         修改：append-only 增补（SCHEMA write fatal 摘要 code/message + phase 'schema-compile-throw'）
  index.ts          修改：类型导出 ReplaceSchemaInput/ReplaceSchemaIssue/ReplaceSchemaResult
  sequencer.ts / status.ts / projection.ts   零改动

packages/doc-runtime/src/
  schema-replace.ts 新建：组合 seam replaceSchemaAndRoot（⓪ guard → prepare（投影/提取/验证/构造/双探针）
                    → 单事务（SCHEMA clear+四键 [+ ROOT clear+install]）→ ⑤-S/⑤-R/⑥ verify）
  index.ts          修改：导出 replaceSchemaAndRoot + 类型（+1 值导出，既有六值导出零变化）
  replace.ts / materialize.ts / mutation.ts / detached-build.ts / install-verify.ts /
  tx-guard.ts / carrier.ts / fatal.ts / extract.ts / read.ts / resolve.ts   零改动
```

职责二分（沿 #90「写槽唯一实现/分类权归捕获位置」哲学）：**namespace-runtime 拥有**定序、gate、快照、编译路由、active tools 生命周期、notifier、fatal 分类；**doc-runtime 组合 seam 拥有**一切 Y.Doc 变更机械（事务、clear+install、identity 保持、双探针、写后校验）。namespace-runtime 侧零 doc-runtime 读取 API 消费（extract/validate 全部内聚在 seam），零第二份构造规则。

---

## §4. 核心设计决策

### D1 公共面第九键与接纳语义（AC1 / INV-S1/S11）

```ts
// runtime.ts（NamespaceRuntime 接口新增——属性语法 + 类型化 input）
readonly replaceSchema: (input: ReplaceSchemaInput) => Promise<ReplaceSchemaResult>;

// schema-write.ts
export interface ReplaceSchemaInput {
  readonly schema: SchemaEnvelope;   // proposed envelope（运行时仍经快照+compile 严格门，类型只是意图声明）
  /**
   * 完整最终 logical ROOT snapshot（plain JSON 值域，经受控 snapshotter 递归冻结）。
   *
   * 【R1.1/A2 公共契约面规格——SA3 必须落 JSDoc，逐字保留语义】
   * - 提供性以**键存在性**判定：缺省 = 不修改 ROOT（也不破坏 identity）；显式传 `undefined`
   *   属非 plain 输入，被输入纪律拒绝（`MUTATION_INPUT_NOT_PLAIN_DATA`，message 携带键名，
   *   如「键 "root" 值为 undefined」）——不是「视为未提供」。
   * - **未声明顶层键不进入新 generation**：root 先投影到 proposed schema 结构树顶层声明
   *   键集（与 keep-root 分支对当前 ROOT 的提取投影同构），投影外顶层键被剥离且
   *   `ok:true` 不携带任何反馈（冻结锚 15 语义；advisory 通道另立 issue，见 §10 R7）。
   * - **嵌套未声明键响亮拒绝**：validateLogicalSnapshot「未知字段」/ buildTopEntries F7
   *   双 loud 失败（`ok:false` + issues），保持仓内拒绝静默丢键纪律。
   */
  readonly root?: unknown;
}
export interface SchemaReplacementIssue { message: string; path: Array<string | number>; }
export type ReplaceSchemaResult = { ok: true } | { ok: false; issues: unknown[] };
```

- **「顶层静默 vs 嵌套 loud」不对称的登记面（R1.1/A2）**：除上述 JSDoc 外，SA3 须在仓库根 `CONTEXT.md` 的 `## Language` 术语节新增术语条目（§11 ALLOW LIST 已增补；建议条目文本见 D7 末尾「CONTEXT.md 术语条目规格」）。

- **签名选型依据（类型层实证）**：冻结测试以 `interface ReplaceSchemaRuntime extends NamespaceRuntime { replaceSchema: (input: { schema: unknown; root?: unknown }) => Promise<{ok:true}|{ok:false;issues:ReplaceSchemaIssue[]}> }` 孪生扩展。在 `strict`（含 strictFunctionTypes）+ 属性语法成员下这是**逆变**检查；已实测 `tsc --strict --exactOptionalPropertyTypes` 验证本签名与该孪生兼容（`ReplaceSchemaInput` 可赋给 `{schema: unknown; root?: unknown}`，`ReplaceSchemaIssue[]` 可赋给 `unknown[]`）——见 §12 依据 6。若改用 `(input: unknown)` 属性语法则会 TS2430 破坏冻结测试文件；方法语法则与既有八键的属性语法风格不一致。故裁决为**属性语法 + 类型化 input**。
- **反向赋值登记（R1.1，SA2 §2 TWIN 复核发现）**：接口扩展方向（冻结孪生成员 → 本设计成员）已验证兼容；**反方向不成立**——本设计的 `{ok:false; issues: unknown[]}` 不可赋给冻结孪生的 `{ok:false; issues: ReplaceSchemaIssue[]}`（`unknown[]` → 具体元素类型数组不可赋值）。冻结测试以双重 `as` 断言消费故不受影响；登记含义：**调用方读取 `issues` 元素须自行窄化**（`unknown[]` 是有意为之的 R2 先例——兼容 `MutationIssue[]`/`ReplaceSchemaIssue[]` 双侧赋值）。消费示例写入 JSDoc：`(res.issues as Array<{ message: string; path: (string|number)[] }>)`。
- 接纳语义与 mutateRoot 完全同构：`sequencer.enqueue(() => runSchemaWriteSlot(schemaWriteEnv, input))`——同步接纳定序（enqueue 同步拼尾）、thunk 是纯调用（输入引用仅被捕获不被读取，Proxy 零触发）、无可抛点、任何拒绝都经返回的 Promise 结算。
- `SchemaWriteEnv` 在构造栈 V3c'' 一次成型（纯数据闭包）：`{ doc, handle, state, notifyDirty, compile }`——五个字段全部来自既有 V1/V3b 已捕获局部量，**零新增 seam 注入点**。
- 模块入口保持窄：index.ts 只增**类型**导出；`entry['replaceSchema'] === undefined` 锚定不变（锚 1）。

### D2 SCHEMA 写槽七步序（AC1–AC7 / INV-S2）

与 ROOT 写槽共享 S1–S3/S6/S7 的机械与语义，差异集中在 S4/S5（这正是「槽体分流、sequencer 共享」的裁决：**不**给 runRootWriteSlot 加 mode 参数——两类写的 S4 语义根本不同（active schema 消费 vs proposed 编译），合并槽体会制造伪同构）：

| 步 | ROOT write（#90，不动） | SCHEMA write（本设计） |
|---|---|---|
| S1 | fatal gate（零输入访问） | **同款逐字**（共享 disabled 路径） |
| S2 | writable gate + notifier 绑定（零输入访问；getStatus 抛错 → fatal `write-slot-internal` committed:false） | **同款逐字** |
| S3 | 受控 snapshotter 递归冻结 | **同款 snapshotter** + 输入形状检查（D3） |
| S4 | 执行时 active schema（unavailable → 零写入 ok:false `SCHEMA_UNAVAILABLE`） | **proposed 编译**（seam 注入 compile；不读 activeTools——unavailable 照常执行，D4/D5） |
| S5 | applyValidatedMutation（唯一 Y.Doc 写入口） | **replaceSchemaAndRoot**（唯一 Y.Doc 写入口，D6） |
| S5.5 | —（无） | **installActive**（transaction 返回后同步执行，D8） |
| S6 | 同槽 await notifyDirty | **同款**（失败 → fatal `notify-dirty-failed` committed:true） |
| S7 | 槽释放 | **同款** |

S4 语义差异是 AC1/AC8 的机制根源：ROOT write 「没有可用 schema 时零写入失败」；SCHEMA write 「不依赖当前 schema 可编译」。**【R1.1/A7 精确化】S4' 不设任何 `schemaState` 门**（unavailable/preparing 一律放行；SA4 红线：`grep schemaState packages/namespace-runtime/src/schema-write.ts` 应**零命中**——槽内不读该字段，D4/D8 的状态迁移全部经 `installActive` 在 p0.ts 单点发生）。`preparing` 态的结构不可达性由 FIFO 保证（P0 是队首真实节点，先于一切写槽 settle），**无需槽内检查、也不设防御性 loud fatal**——加门即直接违反 AC1/AC8（unavailable 必须放行）。

### D3 snapshotter 共享 + 输入形状检查（AC3/锚12 / INV-S2）

- S3 直接复用 write.ts 的 `copyFrozen` 管线（含 R2 立法后的数组四查/descriptor 先于值读取次序）：对整个 `{ schema, root? }` 输入对象做槽起点递归冻结深拷贝。非 plain 输入（class 实例/symbol 键/非有限 number/循环引用/function/undefined 值）→ `ok:false` 单 issue 含稳定码 `MUTATION_INPUT_NOT_PLAIN_DATA`，零写入（冻结测试五类负例全部命中此路径）。
- **显式裁决：`{ schema, root: undefined }`（显式 undefined 值）被 snapshotter 拒绝**（对象分支「键值 undefined」纪律，#90 冻结行为）——`root` 的提供性以**键存在性**判定（`Object.hasOwn(snap, 'root')`），与 exactOptionalPropertyTypes 的「缺省 vs 显式 undefined」区分一致；这是 loud 拒绝而非静默降级（undefined 在 JSON 值域外）。**【R1.1/A8】诊断面明示**：共享 snapshotter 的拒绝 message 携带键名与值详情（`MUTATION_INPUT_NOT_PLAIN_DATA: 键 "root" 值为 undefined`），调用方可直接读出「显式 undefined 而非缺省」的事实；公共契约面的规格化表述见 D1 root JSDoc（「显式传 undefined 属非 plain 输入……不是『视为未提供』」）。共享 message 文案**不改动**（#90 冻结行为，ROOT 路径零回归），明示义务由 JSDoc + 本登记承担。
- 快照成功后追加**输入形状检查**（镜像 mutation.ts (A) 信封校验的措辞风格，无新稳定码）：snap 必须是普通对象、含 `schema` 键、own 键集 ⊆ {schema, root}；违者 → 单 issue `path: []`（如 `未知键 "extra"（允许的键：schema/root）`、`缺少必需键 "schema"`）。非对象输入（null/数组等）同样在此响亮拒绝。
- 排队期间输入引用变化 → 槽开始时刻快照获胜（S3 时点保证，锚 15/AC3）。

### D4 不依赖当前 schema 编译成功（AC1/AC8 / INV-S7）

- S4' 只消费快照出的 proposed envelope；`state.activeTools`/`activeInfo` 不被读取。
- P0 `unavailable`（正常 compile result failure）态：S1 fatal 未置位 ✓、S2 只看 handle ✓ → 照常入槽执行；成功路径把 `schemaState` 迁回 `'ready'` 并清除 `schemaIssue`（D8）→ `status.rootWrite.enabled` 随之恢复（status.ts 既有推导 `schemaState !== 'unavailable'`，**零改动**）。
- `persistence-degraded` 与 prior fatal 分别被 S2/S1 拒绝（`RUNTIME_WRITE_DISABLED`、输入零访问、零写入）；degraded 不阻止 P0/read（S2 在 P0 之后才跑，且 P0 无写门——现状语义）。
- 提出的 proposed 编译失败（结果联合内 ok:false）**只**是普通失败：`schemaState` 不变、旧 active tools 继续服务（冻结测试「AC7 编译失败」锚定 `getActiveSchema()?.id === 'ns-1'`、`schema.state === 'ready'`）——这是与 P0 编译失败（→ unavailable）的关键差异：P0 失败描述「当前 doc 的 schema 不可用」，proposed 失败只是「这次替换没发生」。

### D5 编译步：seam 复用 + 形状守卫 + 分类（AC7 / INV-S9）

- **路由**：S4' 调用 `env.compile(snap.schema as SchemaEnvelope)`——`env.compile` 即构造栈 V3b 捕获的 seam 注入（缺省 `compileSchemaEnvelope`）。SA6 测试侧声明已锚定「proposed 编译必须经既有 seam 注入的 compile 路由」（dispatchCompile 按 envelope.id 分发注入确定性失败）。
- **分类**（沿 P0 的三级分级哲学，但送达形态是 rejection 而非 state 迁移）：
  1. `ok:true` → `assertCompiledShape(result)`（p0.ts @internal 导出，与 P0 同一守卫）→ 通过则持有 compiled（envelope/derived/module/双指纹）。**【R1.1/A1 强化】守卫检查面从「三身份字段 + 双指纹 + module/derived 形状」扩展为「envelope 恰四键封闭 + 四值型 + 双指纹 + module/derived 形状」**：新增 ① envelope 的 own 键集恰为 `{lang, version, id, text}`（多键/缺键均拒）；② `text` 为 string（原守卫漏检 text——`{…, text: 42}` 或 `{…, extra: 1}` 曾可漏过，随后在 seam ①b 被降级为普通 ok:false，构成「internal 产物劣化伪装成调用方领域失败」的分级漂移）。**扩展对 P0 零回归**：P0 消费同一守卫，其 ⑤ 违规本就 throw → ⑦ fatal，分类不变；且已核对 P0 冻结测试无畸形 ok:true 注入用例（`runtime-p0-sequencer.test.ts` 仅真实编译路径）。真实 vfsl 编译产物恒过（ENV-5 拒多余键、五件套递归深冻结——§12 依据 5），守卫唯一触发面 = 注入 seam / 未来 vfsl 回归——正是 P0 ⑤「防注入 seam 返回畸形 ok:true」的哲学面；
  2. `ok:false` 且 issues 非空 → **普通失败**：issues 经 `toIssueSummary` 同款码派生（`SCHEMA_ENVELOPE_*` / `SCHEMA_TEXT_INVALID`，p0.ts @internal 导出）映射为 `{message, path: []}` 列表 → `ok:false`，零写入，active tools 不变；
  3. **任何抛出**（注入 compile throw）、`ok:false` 零 issues、或畸形 `ok:true`（守卫 throw——**含 envelope 恰四键封闭/四值型违规**）→ **internal fatal**：`rejectWithWriteFatal(env, false, 'schema-compile-throw', err, 'schema')`。
- **【R1.1/A1 分级一致性论证——runtime 槽 vs seam ①b 的双检查点为何不同级】**：runtime 槽内的 compiled 是**内部可信产物**（经 seam 注入的 compile 产出），畸形 = internal fault → fatal loud（本条）；seam ①b 检查的 envelope 是 **doc-runtime 直接调用方的参数**（runtime 之外无人保证已过编译门），契约违背属调用方领域失败 → `ok:false` 单 issue（D6 ①b）。两个信任边界、两种分类，各守其面；经 runtime 路径时 ①b 结构性不可达（S4' 守卫先掷），仅作 doc-runtime 独立调用方的纵深防御存在。
- **`committed:false` 的诚实性论证**：编译步结构上先于 seam 调用（一切 doc 写之前），零 doc 写是结构事实而非猜测——与 P0「compile throw = internal fault、doc 零触碰」同源；W3「false = 确定零写入」成立。
- **新 phase `'schema-compile-throw'`**（errors.ts append-only，v1 冻结表「只增不改不删」允许）：既有的 `'write-slot-internal'` 文档语义是「槽内不变量破坏/getStatus adapter 违背」，compile 通道违约（seam 文档明示「抛错 = internal fault 注入」）与之不同源，混用会语义漂移；单列使诊断面诚实。

### D6 doc-runtime 组合 seam：单事务原子提交走线（AC4/AC5 / INV-S4/S5/S12）

**裁决（简报显式要求）**：不用「外层统一事务包住 replaceRootContent」——那会命中 #88 冻结的 ⓪ 前置（未闭合外层 `doc.transact` 内调用 → `DOCRT-E202`），且嵌套调用破坏三个可观测承诺（恰 1 次 update / ⑤⑥ 检测窗口 / 失败零变化，#88 §5/D6 第 2 条已定谳）。也**不**用「两次事务」（先 SCHEMA 后 ROOT）：违反 ADR 第 4 步「一个 transaction 中原子替换」与锚 8「恰 1 次更新事件」，且制造「新 SCHEMA + 旧 ROOT」的可观测中间态。**正确载体是 #88 D6 第 3 条预授权的组合 seam**：

```ts
// packages/doc-runtime/src/schema-replace.ts（新建，公共入口导出）
export type SchemaRootPlan =
  | { readonly kind: 'keep-root' }                                  // 未提供 root：ROOT 零修改
  | { readonly kind: 'replace-root'; readonly snapshot: unknown };  // 完整最终 logical ROOT

export interface SchemaReplaceInput {
  readonly envelope: SchemaEnvelope;   // 已编译 envelope（恰四键；seam 自带形状守卫兜底）
  readonly derived: DerivedSchema;     // proposed derived（提取/验证/构造/⑥ 共用）
  readonly root: SchemaRootPlan;
}

export function replaceSchemaAndRoot(doc: Y.Doc, input: SchemaReplaceInput): ReplaceResult;
// ReplaceIssue/ReplaceResult 复用 replace.ts 的形状（message + path 段数组）
```

**管线（六阶段，镜像 replaceRootContent 的编排纪律）**：

```
⓪ assertOutermostTransactionContext(doc, 'replaceSchemaAndRoot')   // 函数体第一句、一切 catch 之外
① prepare（唯一 try/catch，崩溃边界 DOCRT-E200 模块名制）：
   a. derived.structure.kind !== 'root' → DerivedInvariantError → E204（pre-commit-internal, committed:false）
   b. envelope 形状守卫：plain object、own 键集恰 {lang,version,id,text}、lang/id/text string、version number
      → 违者 ok:false 单 issue path=[]（【R1.1/A1】**纵深防御定位**：服务 doc-runtime 直接调用方——杜绝 set undefined
      造成「三键 SCHEMA」走私；runtime 路径结构性不可达，S4' 的 assertCompiledShape 强化守卫先掷
      schema-compile-throw fatal，两级分类的差异论证见 D5）
   c. SCHEMA 载体探针 probeSchemaMap(doc)（四级 getMap→getArray→getXmlFragment→getText 级联，
      镜像 probeRoot；只触碰 'SCHEMA' 名字空间）：异型 → ok:false 单 issue path=[]；缺席 → getMap 惰性创建（零 update）
   d. 分支 prepare：
      - keep-root：ex = extractYjsSnapshot(derived, doc)；!ok → issues 透传；
                   validateLogicalSnapshot(derived, ex.snapshot)；!ok → issues 透传（证明逻辑值与载体均已兼容）
      - replace-root：narrowed = projectDeclaredRootKeys(derived, snapshot)（D7）；
                   validateLogicalSnapshot(derived, narrowed)；!ok → issues 透传；
                   buildTopEntries(derived, narrowed)；issue → 单 issue fail-fast；
                   probeRoot(doc)；非 Y.Map → 单 issue path=[]
   （① 整体 try/catch——【R1.1/A4】catch 必须**逐字镜像 replace.ts prepareReplace 的分支结构**：
     `instanceof DerivedInvariantError` → E204（pre-commit-internal, committed:false）——覆盖 ①a 的显式 sentinel、
     projectDeclaredRootKeys 内 makeRefResolver 对伪造派生物的环/缺名 sentinel、buildTopEntries 的
     「ROOT 结构节点非 map 形」裸 throw；其余一切意外异常 → E200 ok:false 单 issue（模块名制 message）。
     SA2 实测佐证：合法编译产不出非 map 形 ROOT（`type ROOT = string;` → 编译期 VFSL-E311 拒绝），
     故 E204 仅经伪造派生物可达——「合规调用者不可达」措辞成立，若 SA3 漏写本分支即把 internal 缺陷
     降级为 E200 ok:false，SA4 红线可锚）
② 单事务（transactGuarded，物理位于一切 catch 之外）：
   doc.transact(() => {
     schemaMap.clear();
     schemaMap.set('lang', envelope.lang); schemaMap.set('version', envelope.version);
     schemaMap.set('id', envelope.id);     schemaMap.set('text', envelope.text);
     if (replace-root) { ready.rootMap.clear(); for ([k,v] of entries) ready.rootMap.set(k, v); }
   })                                                                  // observer 逃逸 → E203 committed:true
③ ⑤-S verifySchemaFourKeys(schemaMap, envelope)：size===4 且四键值与 envelope 严格同一
   → 偏离 throw DOCRT-E201（post-commit-verification, committed:true）
④ replace-root 时：verifyInstall({rootMap, entries})（⑤-R，install-verify 共享逐字）
                   verifySnapshotIntact(derived, narrowed, doc)（⑥，对称重物化——**必须喂 narrowed**：
                   scratch 侧 buildTopEntries 对未声明键 F7 拒绝，喂 raw 会把锚 15 用例变成 E201 fatal）
⑤ return { ok: true }
```

- **单源复用清单**（ADR 演进 3「不复制 materialization 逻辑」的落点）：`buildTopEntries`（②的构造与④⑥的 scratch 构造同一实现）、`probeRoot`、`assertOutermostTransactionContext`、`transactGuarded`、`verifyInstall`、`verifySnapshotIntact`、`extractYjsSnapshot`——本 seam 不含任何第二份构造/校验规则；新增代码只有编排、SCHEMA 四键写入、⑤-S、探针与投影。
- **E202 在生产路径结构性不可达**：seam 只被 sequencer 槽同步调用（槽是普通异步代码，外层无 `doc.transact`；notifyDirty 在 seam 返回后才 await）。若未来误用嵌套调用，E202 是裸 Error 逃逸 → 槽内按未知异常保守 `committed:true` fatal（ADR 过报方向强制；不靠 message 嗅探区分）。
- **keep-root 分支内聚在 seam 的理由**：ADR 第 2/3 步同属「SCHEMA write 槽内」的一个管线；把提取+验证留在 namespace-runtime 会造成「no-root 验证在 runtime、with-root 验证在 doc-runtime」的分裂，且 runtime 需额外消费 doc-runtime 读取 API。seam 承载两分支后，namespace-runtime 槽是纯编排（gate→快照→编译→seam→install→notify）。
- **⑤-S 的价值**：对称补齐 ⑤ 的诚实性——事务 cleanup 派发窗口内若 observer 破坏 SCHEMA 四键（tx-guard 只守入口），post-commit 校验把它升级为 E201 fatal 而非静默腐烂；~10 行成本换「恰四键」承诺的机制化。
- **同 envelope 重装**：clear+set 同值仍是非空变更集 → 恰 1 update + 1 notifier（#88 §4.3 update 计数法则：凡产生实际变更，全部变更恰在一个 transaction 内提交）；无冻结锚覆盖，行为确定性在此登记。

### D7 顶层声明域投影（锚 15 强制裁决 / INV-S12）

**问题**：冻结锚 15 要求 `schema ns-2b（声明 {a,n}）× root {n:999,a:'x',b:true}` → `ok:true`。实测（§12 依据 1/2）证明 `validateLogicalSnapshot` 对封闭对象未声明键发 issue（`未知字段 "b"：封闭对象不接受未声明键`）、`buildTopEntries` 的 `mapEntries` 在**每一层 map** 上 F7 拒绝（`快照含结构树未声明字段 "b"——拒绝静默丢键`）——任何「先验证/先构造 raw」的管线都无法让锚 15 转绿。

**裁决**：提供 root 时，snapshot 先投影到 proposed 结构树**顶层声明键集**，再验证、构造、安装；⑥ 校验同样消费投影形态。

```ts
// schema-replace.ts 包内私有（≈18 行）
function projectDeclaredRootKeys(derived: DerivedSchema, snapshot: unknown): unknown {
  if (derived.structure.kind !== 'root') return snapshot;        // 由 ①a 的 E204 路径收编
  const node = resolve(derived.structure.node);                   // makeRefResolver 共享解析（resolve.ts 包内）
  if (node.kind !== 'map') return snapshot;                       // union/异形 root：不投影，交下游严格拒绝（边界登记）
  if (recordSlotOf(node) !== undefined) return snapshot;          // 【R1.1/A6】Record 形判定消费 detached-build.ts:234
                                                                   // 的 @internal recordSlotOf（与 mapEntries/extract.ts
                                                                   // 同款约定的单点实现——不复制约定，杜绝漂移）
  const obj = plainObjectOf(snapshot);                            // 非 plain → 原样返回，交验证/构造响亮拒绝
  if (obj === null) return snapshot;
  const declared = new Set(node.fields.map((f) => f.name));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (!declared.has(k)) continue;                               // 未声明顶层键：不进 generation
    const v = obj[k];
    if (v === undefined) continue;                                // present 惯例（mapEntries 同款；post-snapshot 不可达，防御）
    Object.defineProperty(out, k, { value: v, writable: true, enumerable: true, configurable: true }); // proto-key 纪律（extract.ts putSnapshotKey 同款）
  }
  return out;
}
```

**论证（三层）**：
1. **契约对称性**：keep-root 分支的兼容性证明本来就是对「当前 ROOT 的 declared 投影」做的——`extractYjsSnapshot` 的 D4 纪律即「缺失字段与未知键不报不进快照」（实测：当前 ROOT {n,a} 对 v2b 提取得 {a,n}、验证通过）。replace-root 分支安装的内容同样只能是声明域内容（`buildTopEntries` 沿结构树构造，结构性无法持久化声明外键）。投影使两分支语义对称：**新 generation 的键集由 schema 声明域定义**。
2. **非静默数据丢失**：仓内 F7/（G½）纪律保护的是 **live doc 键不被无感丢弃**（持久化损失）；此处调用方**主动整体替换** ROOT generation——旧 ROOT 的全部键本就随 clear 消亡（ADR：「其下旧 Yjs 子类型 identity 可失效」），调用方数据中 schema 域外的部分不属于新 generation。锚 15 恰好冻结了这一语义（v2b × 含 b 的 root → ok:true）。
3. **边界诚实**：投影只做顶层。嵌套层未声明键仍被 validate/build 双 loud 拒绝（保持 F7 严格性）；union 形 root 不投影（试错语义归 build/validate，不在此层发明）。两条边界都在本节登记，不静默。

**【R1.1/A2】CONTEXT.md 术语条目规格（SA3 交付物，逐字基准）**——在仓库根 `CONTEXT.md` 的 `## Language` 节新增（置于「信封（envelope）」条目之后为宜）：

> **顶层声明域投影（top-level declared projection）**:
> `replaceSchema` 提供 `root` 时，root 先投影到 proposed schema 结构树**顶层**声明键集：未声明顶层键不进入新 generation（静默剥离，与 keep-root 分支对当前 ROOT 的提取投影同构）；嵌套层未声明键保持响亮拒绝（validateLogicalSnapshot「未知字段」/ detached builder F7）。generation 的键集由 schema 声明域定义。
> _Avoid_: 宽松合并（merge）、schema 演进迁移（migration 属上层语义，非本投影）

公共契约面三处同步显式化（缺一即 A2 未修）：① `ReplaceSchemaInput.root` JSDoc（D1）；② 本术语条目；③ `projectDeclaredRootKeys` 实现注释。advisory 反馈通道（被剥离键的上报）**另立 issue**——冻结结果联合无携带位，本任务不扩（§10 R7 登记）。

### D8 active tools 安装时点与 RuntimeState 更新（AC6/AC9 / INV-S6/S7）

- **时序**：seam 返回 `{ok:true}`（= transaction 已提交、⑤-S/⑤-R/⑥ 已通过）之后、`await notifyDirty()` 之前，**同步**调用 `installActive(compiled, env.state)`。锚 9 的可观测窗口由此成立：notifier 挂住时 `getActiveSchema().id` 已是新值、`getSchemaEnvelope()`/`read()` 观察已提交的新 generation、排队中的 mutateRoot 尚未启动。
- **installActive 复用与增补**（p0.ts @internal 导出）：设置五字段冻结身份（lang/version/id + envelope/semantic fingerprints 直引 compile 产物——「与 compileSchemaEnvelope 产物逐字节一致」的结构性保证，getActiveSchema 投影随之切换）+ `activeTools = {module, derived}` + `schemaState = 'ready'`；**增补 `delete state.schemaIssue`**（恢复卫生：unavailable 摘要不残留；status.ts 仅在 unavailable 态投影 issue，故删除是不可观测的清洁性动作，但使 state 单点写入纪律完整）。P0 调用点（preparing→ready）该字段恒 undefined → no-op，零回归。
- **install 与 notify 失败的交织**：notify 失败时新 tools 已安装、SCHEMA/ROOT 已提交——这是诚实状态（active 与 committed generation 一致），fatal 只额外永久禁写；不回滚、不卸载（ADR「不补偿」）。
- **【R1.1/A3】反向交织：fatal 后 active 与 committed 的永久撕裂（诚实登记，非缺陷）**：E201（⑤-S/⑤-R/⑥ 偏离）/ E203（事务逃逸）发生时，**事务已提交新 SCHEMA/ROOT 而 S5.5 未执行**（seam throw 先于 installActive）→ 此后 `getActiveSchema()` **永久停留旧 generation**（`state.activeInfo` stale，本 Runtime 生命周期内不再切换——fatal 永久禁写、无任何后续路径会再 install）、而 `read()`/`getSchemaEnvelope()` 观察已提交的**新** generation、`rootWrite`/`schemaWrite` 均 false（fatal 置位）、后续写一律 `RUNTIME_WRITE_DISABLED`。这是 ADR「不补偿、不声称回滚」的必然形态：撕裂态被 `status.fatal` 显式标记且永久禁写，**不静默冒充健康**；**读取语义以 live doc 为准**（getActiveSchema 只是工具安装投影，不是数据真相源）。观察点移交 SA7 动态验证（注入路径与断言清单见 D9 末条）。
- **AC9 反向**：准备/排队期间一切读取面只观察 live doc 与 state 的现状（旧 generation）——本设计在 transaction 前零 doc 写、零 state 迁移，天然成立。

### D9 失败通道：窄结果联合 + fatal 分类表（AC7/AC8 / INV-S3/S9/S10）

**普通失败（ok:false + issues，全部零写入）**：

| 来源 | issues 形态 |
|---|---|
| S1/S2 write-disabled（fatal 已置位 / handle 非 ready / notifier 未绑定） | 单 issue 含稳定码 `RUNTIME_WRITE_DISABLED`（共享 `disabled()`，输入零访问） |
| S3 快照拒绝 | 单 issue 含稳定码 `MUTATION_INPUT_NOT_PLAIN_DATA` |
| S3 输入形状（缺 schema / 未知键 / 非对象） | 单 issue `path: []`（镜像 mutation.ts (A) 措辞，无新稳定码） |
| S4 proposed 编译失败（结果联合内） | `toIssueSummary` 码派生映射的 issue 列表，`path: []` |
| S5 seam ok:false（SCHEMA/ROOT 载体异型 / keep-root 提取或验证失败 / replace-root 验证或构造失败） | seam issues 透传（元素形状 `{message, path}`；ExtractIssue 携带的 expected/actual 附加字段按结构兼容随行，公共元素类型仍以 `SchemaReplacementIssue` 为构造纪律） |

**fatal 分类表（唯一裁决点 = schema-write.ts 槽体 catch 位置；延续「分类权归捕获位置」）**：

| 触发 | committed | phase | notifier |
|---|---|---|---|
| S2 `handle.getStatus()` 抛错 | false | `write-slot-internal` | 0 |
| S4 compile 抛出 / ok:false 零 issues / 畸形 ok:true（守卫 throw——**含 envelope 恰四键封闭/四值型违规，R1.1/A1**） | false | `schema-compile-throw`（新） | 0 |
| S5 seam 抛 `DocRuntimeFatalError`（E201/E203/E204） | 透传 err.committed | 透传 err.phase | committed:true → 槽内 best-effort 恰一次 |
| S5 seam 抛未知异常（含结构性不可达的 E202 误用） | true（保守，过报方向强制） | `unknown-pipeline-throw` | best-effort 恰一次 |
| S6 `notifyDirty()` rejection | true | `notify-dirty-failed` | （notifier 本身已失败，不再重试） |

【R1.1/A1 表注】envelope 形状违规在 runtime 路径的**唯一**分级是 fatal（上表第 2 行）；seam ①b 的 ok:false 只服务 doc-runtime 直接调用方（信任边界不同，论证见 D5/D6 ①b）。SA4 红线：seam 注入 `compile` 返回 `{ok:true, envelope:{…,extra:1}, …}` / `text` 非 string / `version` 非 number → 断言 `RuntimeWriteFatalError` rejection（phase=`schema-compile-throw`、committed=false、status.fatal 非空、0 update、0 notifier）；若落 ok:false 即 A1 未修。

- 一律 `markWriteFatal`（新摘要 code `NSRT-FATAL-SCHEMA-WRITE-INTERNAL`，append-only；与 ROOT 写槽的 `NSRT-FATAL-WRITE-INTERNAL` 区分来源，status.fatal 诊断不失真）+ `RuntimeWriteFatalError` rejection；永久禁写保读；已排队后续写经 S1 取得槽、零访问输入、零写入 `RUNTIME_WRITE_DISABLED`。
- **rejection message 参数化**：`writeFatalMessage(slotNoun, phase, committed)`——ROOT 路径传 `'ROOT write'` 渲染**逐字节等于**现行文案（`runtime-write-fatal-message-rev1.test.ts` / sa7 动态测试只做子串锚定，且 ROOT 侧锚定子串全部保留）；SCHEMA 路径传 `'SCHEMA write'`。
- **replaceSchema 自身 fatal 通道无确定性冻结锚**（SA6 备注：依赖 SA3 对接缝走线的选型）：本设计下可用 doc 级 observer 确定性注入，**无需任何新注 seam**（SA2 已认可）。**【R1.1/A3 显式化——SA4 验尸/SA7 动态补锚的落点，同时是 SA6 移交的「replaceSchema fatal 通道确定性锚」】**：
  - **注入路径 α（E201 + 撕裂态）**：`doc.on('update', () => { doc.getMap('SCHEMA').delete('text'); })`（或改坏 ROOT 顶层键）→ 事务提交后 ⑤-S（或 ⑤-R/⑥）检出偏离 → seam throw branded `post-commit-verification` committed:true → 槽内 `markWriteFatal` + best-effort notify 恰一次 + `RuntimeWriteFatalError` rejection。**断言清单**：rejection phase=`post-commit-verification`、committed=true；`getActiveSchema()?.id` 仍为**旧** id 而 `getSchemaEnvelope()?.id` 为**新** id、`read()` 观察新 ROOT（A3 撕裂态）；`rootWrite`/`schemaWrite` 均 false；后续 `replaceSchema`/`mutateRoot` settle `{ok:false}` 含 `RUNTIME_WRITE_DISABLED`（队列持续流转不挂死）。
  - **注入路径 β（E203）**：`doc.on('update', () => { throw new Error('observer-boom'); })` → 事务 cleanup 派发期抛错 → `transactGuarded` 包装 branded `observer-cleanup-throw` committed:true → 同上 fatal 走线。
  - **注入路径 γ（E204，A4）**：seam 注入 compile 返回 ok:true 但 derived 为手造环 ref 结构 → ① catch 的 `instanceof DerivedInvariantError` 分支 → branded `pre-commit-internal` committed:false → rejection（**非** ok:false DOCRT-E200——SA4 红线）。

### D10 seam/状态面扩展需求裁决：零新增注入点

- namespace-runtime seam 输入**不变**（handle/p0Gate?/compile?/notifyDirty?）：`compile` 既有捕获同时服务 P0 与 SCHEMA 写槽（SA6 测试侧声明锚定的路由方式）；`SchemaWriteEnv` 只是同一批捕获局部量的第二次成型。
- status.ts / sequencer.ts / projection.ts **零改动**：schemaWrite 推导 `!fatal && writableNow` 已满足 AC8（unavailable 态仍 enabled）；rootWrite 恢复由 `schemaState` 迁移自动成立；六键键集不变。
- doc-runtime 侧唯一新增公共面 = `replaceSchemaAndRoot`（+类型）。已核对 `public-surface-guard.test.ts`：其锚定的五项必需值导出全部在位、`/^applyValidatedMutation$/` 唯一性正则不受新名影响。

---

## §5. 关键伪代码（SA3 实现蓝本）

```ts
// ═══ schema-write.ts（namespace-runtime，新建）═══
export interface SchemaWriteEnv {
  readonly doc: Y.Doc;
  readonly handle: DocHandle;
  readonly state: RuntimeState;
  readonly notifyDirty: (() => Promise<void>) | undefined;   // 显式 undefined 联合（沿 WriteEnv 先例）
  readonly compile: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
}

export async function runSchemaWriteSlot(env: SchemaWriteEnv, input: unknown): Promise<ReplaceSchemaResult> {
  // ── S1 lifecycle/fatal gate（零输入访问）──
  if (env.state.fatal !== undefined) {
    return disabled('fatal 已置位（internal fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留）');
  }
  // ── S2 writable gate + notifier 绑定检查（零输入访问）──
  let handleStatus: DocHandleStatus;
  try { handleStatus = env.handle.getStatus(); }
  catch (err) { return rejectWithWriteFatal(env, false, 'write-slot-internal', err, 'schema'); }
  if (handleStatus !== 'ready') {
    return disabled(`DocHandle 状态 ${handleStatus} 不可写（persistence-degraded 阻止全部 Y.Doc 写；released/disposed 同拒）`);
  }
  if (env.notifyDirty === undefined) {
    return disabled('notifyDirty 未绑定——构造方必须绑定 persistence.saveDoc(handle)（ADR-0008 窄接缝）；'
      + '无持久化绑定的 Runtime 拒绝一切 Y.Doc 写，杜绝「提交成功但永无 dirty 登记」的静默失信');
  }
  const notifyDirty = env.notifyDirty;
  // ── S3 槽起点输入快照 + 形状（本槽第一次也是唯一一次读取输入）──
  const snap = snapshotMutation(input);                        // write.ts 共享（copyFrozen 递归冻结）
  if (snap.kind === 'issue') return { ok: false, issues: [snap.issue] };
  const shape = shapeOfReplaceInput(snap.value);               // {kind:'ok',schema,hasRoot,root} | {kind:'issue'}
  if (shape.kind === 'issue') return { ok: false, issues: [shape.issue] };
  // ── S4 proposed 编译（seam 注入路由；不读 activeTools——AC1/AC8）──
  let compiled: CompileSchemaEnvelopeOk;
  try {
    const r = env.compile(shape.schema as SchemaEnvelope);     // 验证权单源在 compile 严格门（沿 P0 `as` 先例）
    if (!r.ok) {
      if (r.issues.length === 0) throw new Error('compile 返回 ok:false 且零 issues——结果联合之外的状态');
      return { ok: false, issues: r.issues.map((i) => toReplacementIssue(i)) };  // 普通失败：schemaState 不动
    }
    assertCompiledShape(r);                                    // 畸形 ok:true → throw → fatal（P0 同款守卫；
                                                               // 【R1.1/A1】扩展检查面：envelope own 键集恰
                                                               // {lang,version,id,text} + lang/id/text string +
                                                               // version number + text string（原守卫漏检 text/
                                                               // 键集）——违规一并走 schema-compile-throw fatal，
                                                               // 不允许漏到 seam ①b 降级为 ok:false）
    compiled = r;
  } catch (err) {
    return rejectWithWriteFatal(env, false, 'schema-compile-throw', err, 'schema');
  }
  // ── S5 组合 seam（唯一 Y.Doc 写入口：验证+构造+单事务+verify）──
  const plan: SchemaRootPlan = shape.hasRoot
    ? { kind: 'replace-root', snapshot: shape.root }
    : { kind: 'keep-root' };
  let result: ReplaceResult;
  try {
    result = replaceSchemaAndRoot(env.doc, { envelope: compiled.envelope, derived: compiled.derived, root: plan });
  } catch (err) {
    if (err instanceof DocRuntimeFatalError) {
      return rejectWithWriteFatal(env, err.committed, err.phase, err, 'schema');   // branded 事实透传
    }
    return rejectWithWriteFatal(env, true, 'unknown-pipeline-throw', err, 'schema'); // 保守过报
  }
  if (!result.ok) return { ok: false, issues: result.issues };  // 领域失败透传（零写入由 seam 承诺）
  // ── S5.5 安装新 active tools（AC6：transaction 返回后同步、notify 前）──
  installActive(compiled, env.state);                           // 五字段身份 + tools + schemaState='ready' + delete schemaIssue
  // ── S6 同槽 await notifyDirty ──
  try { await notifyDirty(); }
  catch (err) {
    markWriteFatal(env, err, 'schema');
    throw new RuntimeWriteFatalError('notify-dirty-failed', true,
      writeFatalMessage('SCHEMA write', 'notify-dirty-failed', true),
      err === undefined ? undefined : { cause: err });
  }
  // ── S7 槽释放 ──
  return { ok: true };
}

// shapeOfReplaceInput：snap 已是冻结 plain 数据（snapshotter 保证），此处只查键形状
function shapeOfReplaceInput(snap: unknown):
  | { kind: 'ok'; schema: unknown; hasRoot: boolean; root: unknown }
  | { kind: 'issue'; issue: SchemaReplacementIssue } {
  if (typeof snap !== 'object' || snap === null || Array.isArray(snap)) {
    return { kind: 'issue', issue: { message: '输入形状错误：期望普通对象 { schema, root? }，'
      + `实际 ${wordOf(snap)}`, path: [] } };
  }
  if (!Object.hasOwn(snap, 'schema')) {
    return { kind: 'issue', issue: { message: '输入形状错误：缺少必需键 "schema"（允许的键：schema/root）', path: [] } };
  }
  const unknownKey = Object.keys(snap).find((k) => k !== 'schema' && k !== 'root');
  if (unknownKey !== undefined) {
    return { kind: 'issue', issue: { message: `输入形状错误：未知键 "${unknownKey}"（允许的键：schema/root）`, path: [] } };
  }
  return { kind: 'ok', schema: (snap as Record<string, unknown>)['schema'],
    hasRoot: Object.hasOwn(snap, 'root'), root: (snap as Record<string, unknown>)['root'] };
}

// toReplacementIssue：SchemaParseIssue → {message, path:[]}（码派生与 p0.toIssueSummary 同源）
function toReplacementIssue(issue: SchemaParseIssue): SchemaReplacementIssue {
  const s = toIssueSummary(issue);                             // p0.ts @internal
  return { message: `${s.code}: ${s.message}`, path: [] };
}

// ═══ runtime.ts（修改：V3c'' + 第九键）═══
const schemaWriteEnv: SchemaWriteEnv = { doc, handle, state, notifyDirty: captured.notifyDirty, compile };
const runtime: NamespaceRuntime = {
  /* …既有八键不动… */
  replaceSchema: (input) =>
    sequencer.enqueue(() => runSchemaWriteSlot(schemaWriteEnv, input)),  // 同步接纳定序；thunk 纯调用
};

// ═══ schema-replace.ts（doc-runtime，新建）—— 主管线见 §4 D6 伪代码 ═══
```

---

## §6. 边界条件、并发与时序分析

### 6.1 时间线（µ = 微任务，T = 测试可控时点）

**场景 A（反向：replaceSchema 占槽、mutateRoot 排队——锚 9/AC6 时序锚）**
```
T0  runtime.replaceSchema({schema:ENV2, root:{n:20,a:'x',b:true}})  → enqueue(thunk_R)；输入引用仅捕获
µ1  thunk_R 启动：S1✓ S2✓ S3 快照 S4 compile(ENV2)→ok（seam 路由）
µ2  S5 seam：⓪✓ → prepare（投影→验证→构造→probeRoot）→ transactGuarded{SCHEMA clear+四键; ROOT clear+install}
    → 提交：恰 1 次 update 事件 → ⑤-S/⑤-R/⑥ ✓ → return {ok:true}
µ3  S5.5 installActive ── 此刻起 getActiveSchema().id==='ns-2'、getSchemaEnvelope().id==='ns-2'、read(['n'])===20
µ4  S6 await notifyDirty() ── notifier 内 await gateR（挂住；notifierCalls 已 =1）
T1  runtime.mutateRoot(SET_N(30)) → enqueue(thunk_M)（前项未 settle 不启动；order 仍 []）
T2  [挂住窗口断言全部成立——新 generation 可观测、后项未启动]
T3  gateR.resolve() → S7 → pR settle {ok:true} → thunk_M 启动（S4 用新 activeTools）
```

**场景 B（正向：mutateRoot 占槽 notifier 挂住 → replaceSchema 排队——AC9）**
```
µ0  mutateRoot 占槽：S1–S5 完成（ROOT n=2 已提交）、S6 await gateA（挂住）
T0  runtime.replaceSchema(input) → enqueue；同步段零输入读取（Proxy 零触发）
T1  [排队窗口] getSchemaEnvelope/getActiveSchema 观察 ns-1；read(['n'])===2（A 已提交的旧 generation）
T2  gateA.resolve() → M 的 S7 → R 取得槽 → S3 此刻快照（排队期调用方对 input 的改动在此获胜）→ …
```

**场景 C（P0 unavailable 恢复——AC8）**
```
µ0  P0：compile(ns-1) → ok:false → state = unavailable{schemaIssue}；rootWrite=false、schemaWrite=true
T0  replaceSchema({schema:ENV2B})：S1✓（fatal 未置位）S2✓（handle ready）S3✓ S4 compile(ENV2B)→ok
µ1  S5 seam keep-root 分支：extractYjsSnapshot(v2b, doc) → {a:'x',n:1} → validate ✓ →
    事务{SCHEMA clear + 四键}（恰 1 update；ROOT 零触碰）
µ2  S5.5 installActive：schemaState='ready'、delete schemaIssue → rootWrite 恢复 true
µ3  S6 notify → S7 → {ok:true}；后续 mutateRoot 用新 activeTools 成功（notifier 递增）
```

### 6.2 边界条件清单

| # | 条件 | 处置 | 锚 |
|---|---|---|---|
| 1 | 输入非 plain（class 实例/symbol 键/NaN/循环/function/显式 undefined 值） | S3 拒绝：`MUTATION_INPUT_NOT_PLAIN_DATA`，零写入 | 锚12 |
| 2 | 输入 plain 但形状错（非对象/缺 schema/未知键） | S3.5 单 issue `path:[]`，零写入 | — |
| 3 | proposed 编译失败（结果联合内） | ok:false（issues 码派生映射）；schemaState/active tools 不变（旧 generation 继续服务） | 锚10 |
| 4 | compile 抛出 / ok:false 零 issues / 畸形 ok:true（**含 envelope 恰四键封闭/四值型违规——R1.1/A1**） | fatal `schema-compile-throw` committed:false（结构上先于一切 doc 写） | — |
| 5 | keep-root：当前 ROOT 载体不兼容 | extract issue 透传，零写入，ROOT/identity 不动 | 锚5 |
| 6 | keep-root：载体兼容但逻辑不兼容（缺必填/类型错） | validate issues 透传，零写入 | 锚5 |
| 7 | replace-root：逻辑校验失败 | 投影后 validate issues 透传，零写入 | 锚10 |
| 8 | replace-root：构造失败（BuildIssue） | 单 issue fail-fast，零写入 | — |
| 9 | replace-root：含未声明**顶层**键 | 投影剥离（不进 generation）；结果 ROOT 恰为声明域内容，后续 mutateRoot 正常 | 锚15 |
| 10 | replace-root：含未声明**嵌套**键 | validate/build 双 loud 拒绝（F7 严格性保持，D7 边界登记） | — |
| 11 | SCHEMA 载体缺席（生产合法可达：createDoc/loadDoc 不触碰 SCHEMA） | getMap 惰性创建（零 update）→ clear 空转 → 四键写入；P0 曾 unavailable 的恢复主路径 | AC8 |
| 12 | SCHEMA 载体异型（同名 Y.Text 等） | probeSchemaMap 级联命名 → 单 issue `path:[]`，零写入 | — |
| 13 | ROOT 载体异型 + 提供 root | probeRoot ③ → 单 issue `path:[]`，零写入 | — |
| 14 | 同 envelope 重装（内容不变的 clear+set） | 非空变更集 → 恰 1 update + 1 notifier + ok:true；确定性登记 | — |
| 15 | persistence-degraded（S2 瞬时观察） | `RUNTIME_WRITE_DISABLED`、输入零访问（gate 先于快照）、零写入；不阻止 P0/read | 锚11 |
| 16 | prior fatal（S1） | 同上；后续再调用仍 settle disabled（队列持续流转不挂死） | 锚11 |
| 17 | S2 通过后 handle 才降级 | gate 是瞬时观察（ADR）：事务照常提交，notify 照常登记（不撤销已提交事务） | ADR |
| 18 | notify 失败（写已提交） | fatal `notify-dirty-failed` committed:true；新 tools 已装（与 committed generation 一致，不回滚） | INV-S9 |
| 19 | replaceSchema 在 P0 preparing 期排队（p0Gate 挂住） | FIFO 排 P0 后；S3 快照时点 = 取槽时刻（锚 15 的机制根源） | 锚15 |
| 20 | 连续两次 replaceSchema | FIFO 串行；第二次的 keep-root 提取观察第一次已提交的 SCHEMA/ROOT | — |
| 21 | **写后 fatal（E201/E203）——active/committed 永久撕裂（R1.1/A3）** | 事务已提交新 generation 而 installActive 未执行：`getActiveSchema()` 永久停留旧 id、`read()`/`getSchemaEnvelope()` 观察新 generation、双写位 false、后续写 `RUNTIME_WRITE_DISABLED`；撕裂被 status.fatal 显式标记（不静默冒充健康），读取以 live doc 为准；注入路径与断言清单见 D9 末条 | INV-S9 |

### 6.3 数据一致性

- **原子性**：SCHEMA 与（必要）ROOT 变更在同一 `doc.transact`（transactGuarded 包裹）——外部可观测面（update 事件、`encodeStateAsUpdate`、同步读取）只见终态；中途不存在「新 SCHEMA + 旧 ROOT」。
- **active 与 committed 的一致性**：installActive 只在 seam ok 之后执行；此后任意时刻 `getActiveSchema()` 与 `getSchemaEnvelope()` 描述同一 generation。notify 失败不破坏该一致性（fatal 但状态诚实）。**唯一例外（R1.1/A3 登记）**：写后 fatal（E201/E203）在 installActive 之前掷出 → active 永久 stale 而 committed 已新——撕裂被 status.fatal 显式标记且永久禁写（§6.2 行 21），非静默失信。
- **快照隔离**：输入在槽起点深冻结；编译/验证/构造/提交只消费快照与 compile 产物（`compileSchemaEnvelope` 递归深冻结五件套——`derived`/`envelope` 不可变）。
- **零写入可证性**：一切失败路径（S1–S5 的 ok:false 分支）都先于 `doc.transact`；seam prepare 只读（探针级联/extract/validate/build 均不写 doc）。

---

## §7. 构建集成与类型纪律

### 7.1 typecheck 双通道

- namespace-runtime tsconfig `include: ["src/**/*.ts"]`（#89 §7.1 决议维持）：新增 `schema-write.ts` 自动纳入 tsc；测试文件类型注入不进 tsc，由 `pnpm test`（vitest run --typecheck）与聚合通道 `tsc -p tsconfig.typecheck.json` 覆盖。doc-runtime 同理。
- 冻结类型守卫文件（`runtime-replace-schema-type-guard.test-d.ts`）的 TS2339 由接口新增 `replaceSchema` 成员消除；**签名选型已实测**不破坏冻结孪生的接口扩展（§12 依据 6）。
- `exactOptionalPropertyTypes`：`ReplaceSchemaInput.root?: unknown`、`SchemaRootPlan` 用判别联合（不用可选字段承载「提供性」——提供性语义由键存在性/判别式表达，杜绝 undefined 二义）。

### 7.2 SA6 冻结文件类型核对表

| 文件 | 依赖的公共名目 | 本设计供给 |
|---|---|---|
| runtime-replace-schema-type-guard.test-d.ts | `NamespaceRuntime['replaceSchema']` 成员存在 | D1（属性语法 + 类型化 input） |
| runtime-replace-schema-sequencer.test.ts | 运行时行为（15 锚）+ `entry['replaceSchema'] === undefined` | §9 映射；index.ts 只增类型导出 |
| runtime-replace-schema-persistence.test.ts | 真实 Persistence 集成 | 单事务/通知/跨实例语义由 D6/D8 成立 |

### 7.3 依赖、版本与测试收集

- 零新增依赖（yjs/@nomicore/doc-runtime/@nomicore/vfsl 均已在 namespace-runtime 依赖面）。
- 版本 bump（硬门禁 9）：`@nomicore/namespace-runtime` 0.1.2 → **0.1.3**；`@nomicore/doc-runtime` 0.1.8 → **0.1.9**（两包均有 src 改动）。
- `pnpm test`（vitest run --typecheck）+ `pnpm typecheck`（七包 tsc）+ 聚合通道 + Node 20/24 CI 全绿为验收前置；既有 10 文件 50 用例必须保持全绿（write.ts/p0.ts 的共享化改造为行为保持重构，ROOT fatal message 渲染逐字节不变）。

---

## §8. 全局兼容与影响评估

| 面 | 影响 | 论证 |
|---|---|---|
| mutateRoot / ROOT 写槽 | 零行为变化 | write.ts 仅导出既有内部函数 + message 参数化（ROOT 名词渲染字节不变）；既有 fatal message 测试（子串锚定）与 sa7 动态测试全部保持 |
| P0 | 零行为变化 | installActive 增 `delete state.schemaIssue` 在 P0 调用点是 no-op（preparing→ready 时该字段恒 undefined）；@internal 导出不改公共面 |
| 读取面（read/getSchemaEnvelope/getMetadata/getActiveSchema/getStatus） | 零改动 | projection.ts/status.ts 不动；getActiveSchema 的切换由 state.activeInfo 单点驱动 |
| sequencer | 零改动 | 泛型 enqueue 已支持任意槽结果类型；链尾恒绿接线消化 rejection |
| doc-runtime 既有公共入口 | 零改动 | replace/materialize/mutation/extract/read 逐字不动；index.ts 只增 `replaceSchemaAndRoot` 值导出与类型，`public-surface-guard.test.ts` 锚定的五项必需导出与 applyValidatedMutation 唯一性正则不受影响 |
| vfsl / persistence | 零改动 | 纯消费 |
| 架构一致性 | 无冲突 | 组合 seam 是 #88 D6 §3 预授权路径（「届时无需放宽 replaceRootContent 的 ⓪，也无需 owner 裁决调整本接缝契约」）；顶层投影是锚 15 强制的新语义，已在 D7 显式裁决并登记边界（非静默推翻既有严格性——嵌套层保持 F7 严格） |

---

## §9. 验收标准映射

| AC / 锚 | 设计落点 | 判定 |
|---|---|---|
| AC1 共享唯一 sequencer、不依赖当前 schema 编译 | D1（同一 WriteSequencer 实例）+ D2（S4' 不读 activeTools）+ D4 | ✓ |
| AC2 未提供 root：proposed derived 严格提取+验证，不兼容零写入 | D6 ①d keep-root 分支（extractYjsSnapshot + validateLogicalSnapshot，issues 透传）+ INV-S3 | ✓ |
| AC3 提供 root：完整最终 logical ROOT 验证+detached 构造+整体替换 | D6 ①d replace-root 分支（投影→validate→buildTopEntries→单事务 clear+install）+ D7 | ✓ |
| AC4 SCHEMA 顶层 Y.Map，事务内 clear 后恰四键 | D6 ②（clear + 恰四次 set）+ ①b 形状守卫 + ⑤-S | ✓ |
| AC5 单 transaction 原子提交、顶层 ROOT identity 保持 | D6 ②（同一 transactGuarded）+ probeRoot 原实例 clear+set + INV-S5 | ✓ |
| AC6 transaction 后立即安装 tools 再 await notify | D2 S5.5 + D8（同步 install 于 await 前） | ✓ |
| AC7 失败时 SCHEMA/ROOT/active tools 均不变 | INV-S3（一切失败先于事务；proposed 编译失败不动 schemaState——D4） | ✓ |
| AC8 unavailable 可恢复；degraded/prior fatal 拒绝 | D4 + D8（installActive + schemaIssue 清除 → rootWrite 恢复）+ S1/S2 | ✓ |
| AC9 准备期读取观察旧 committed generation | D8（transaction 前零 doc 写零 state 迁移）+ §6.1 场景 B | ✓ |
| AC10 独立窄联合 + 确定性/集成测试 + 全量 CI | D1/D9（SchemaReplacementIssue/ReplaceSchemaResult）+ §7.3 | ✓ |
| 锚1 第九键、入口窄 | D1 + INV-S11 | ✓ |
| 锚2 结果联合三态 | D9（ok:false 全来源表 + fatal 走 rejection） | ✓ |
| 锚3 双向 FIFO/屏障 | D1 + §6.1 场景 A/B | ✓ |
| 锚4 unavailable 恢复 | D4 | ✓ |
| 锚5 keep-root 严格提取/验证、ROOT 不动 | D6 ①d + INV-S5 | ✓ |
| 锚6 replace-root 整体替换、identity 保持 | D6 ②④ + INV-S5 | ✓ |
| 锚7 恰四键（键名四字符串、值型） | D6 ①b/②/⑤-S | ✓ |
| 锚8 同一 transaction：恰 1 update + 1 notifier | D6 ② + INV-S4（§12 依据 4） | ✓ |
| 锚9 AC6 时序窗口 | D8 + §6.1 场景 A | ✓ |
| 锚10 各类失败零写入五件套 | INV-S3 | ✓ |
| 锚11 write-disabled：稳定码/零访问/零写入/degraded 不阻止 P0/read/fatal 后队列流转 | D2 S1/S2 + D9 | ✓ |
| 锚12 snapshotter 共享 + 稳定码 + 快照获胜 | D3 | ✓ |
| 锚13 AC9 新旧 generation 切换时点 | D8 | ✓ |
| 锚15（快照获胜含未声明键容忍） | D7（顶层声明域投影）+ D3（S3 时点） | ✓ |

---

## §10. 风险登记与开放问题

| # | 风险/开放问题 | 缓解 |
|---|---|---|
| R1 | D7 顶层投影与仓内 F7「拒绝静默丢键」纪律存在表述张力 | 三层论证（契约对称/非 live-doc 键/边界登记）+ 锚 15 强制 + 代码注释显式标注裁决依据；**R1.1/A2 后契约面三处显式化**（D1 root JSDoc + CONTEXT.md 术语条目 + 实现注释）；若需进一步收窄，唯一出路是修订冻结锚 15（需总控/owner 介入——设计无权自行收窄） |
| R2 | replaceSchema 自身 fatal 通道无确定性冻结锚（SA6 已声明移交） | **R1.1/A3 已显式化**：三条确定性注入路径（α E201+撕裂态 / β E203 / γ E204）与断言清单见 D9 末条，零新注 seam（SA2 认可）；移交 SA4 验尸/SA7 动态补锚——路径 α 同时锚定撕裂态观察点（getActiveSchema 旧 id × getSchemaEnvelope 新 id × 双写位 false） |
| R3 | doc-runtime 公共面 +1 值导出（`replaceSchemaAndRoot`） | 已核对既有公共面守卫测试不受影响（D10）；seam 自带 envelope 形状守卫与双探针，误用面 loud |
| R4 | write.ts/p0.ts 共享化改造的回归风险 | 行为保持重构：ROOT 路径 fatal message 渲染逐字节不变；既有 50 用例 + fatal message 测试为门；**R1.1/A1 扩展 assertCompiledShape 对 P0 零回归**（P0 冻结测试无畸形 ok:true 注入用例，已核对；分类不变：⑤ 违约本就 throw → ⑦ fatal） |
| R5 | 复合事务（SCHEMA+ROOT 同事务）的 update 计数依赖 yjs 单事务语义 | #88 §4.3 update 计数法则 + 既有 replace-root-content 测试锚 + 本次实测（1 update）三重依据（§12 依据 4；SA2 复核 [4] 亦证） |
| R6 | union 形 ROOT × 未声明顶层键：不投影 → 下游 loud 拒绝 | D7 边界登记（与嵌套层同处置）；无冻结锚覆盖；如未来需要，属独立演进 |
| R7 | **【R1.1/A2 登记】顶层静默剥离无反馈通道**：typo 键名无声蒸发、ok:true 不携带任何被剥离键信息 | 冻结结果联合 `{ok:true}｜{ok:false; issues}` 无携带位，本任务不扩（扩即改公共契约）；advisory 通道（如返回 `droppedTopLevelKeys` 或诊断日志）**另立 issue**；过渡期缓解 = D1 JSDoc + CONTEXT.md 术语 + D7 论证三处显式化 |

---

## SA2 反馈逐条回应

**R1（初版，2026-08-24）**：SA2 评审 verdict **pass**（无 CRITICAL/HIGH；2 MEDIUM + 6 LOW），报告 `wiki/raw/task_namespace-runtime-replace-schema_sa2_review.md`。本轮为 **R1.1 增补轮**——M1/M2（A1/A2）与 A3–A8 全部落入正文，逐条 mapping 如下（「已落实」条目均有对应章节的实质改动，非注释式承认）：

| # | 严重度 | SA2 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|---|---|
| A1 | MEDIUM | envelope 形状违规经 assertCompiledShape 漏检后在 seam ①b 被降级为 ok:false，与 P0 三级分级哲学矛盾；要求在 S4' 守卫增补「envelope 恰四键封闭 + 四值型」检查，畸形 → schema-compile-throw fatal；seam ①b 保留为纵深防御 | ✅ | D5 分类第 1/3 条 + 分级一致性论证；D6 ①b（纵深防御定位）；D9 fatal 分类表第 2 行 + 表注 + SA4 红线；§5 S4 伪代码；§6.2 行 4；§10 R4 | `assertCompiledShape` 检查面扩展为「envelope own 键集恰四键 + lang/id/text string + version number + text string（原漏检）+ 双指纹 + module/derived」；扩展对 P0 零回归（已核对 P0 冻结测试无畸形 ok:true 注入；P0 ⑤违约本就 fatal）；runtime 槽（内部产物→fatal）与 seam ①b（外部调用方参数→ok:false）的信任边界差异成文 |
| A2 | MEDIUM | 顶层未声明键静默剥离未落到公共契约面；要求 root JSDoc 明示两级行为 + CONTEXT.md 术语节登记 + ALLOW LIST 增补 | ✅ | D1 root JSDoc（逐字规格：提供性以键存在性判定/顶层剥离/嵌套 loud）+「不对称登记面」条目；D7 末尾「CONTEXT.md 术语条目规格」（逐字基准文本）；§11 ALLOW LIST 增 `CONTEXT.md` 条目；§10 R7（advisory 另立 issue） | 三处显式化齐备：JSDoc + 术语条目 + 实现注释；CONTEXT.md 修改划入 SA3 文件清单 |
| A3 | LOW | fatal 后 active/committed 永久撕裂未登记；同时显式写明确定性注入路径（doc observer 改坏 SCHEMA 四键 → E201）供 SA4/SA7 使用 | ✅ | D8「反向交织」条目（撕裂态五要素：getActiveSchema 永久旧 id / read+getSchemaEnvelope 新 generation / 双写位 false / 后续写 DISABLED / status.fatal 显式标记不静默；读取以 live doc 为准）；D9 末条注入路径 α/β/γ + 断言清单；§6.2 行 21；§6.3 一致性例外；§10 R2 | 路径 α 同时是 SA6 移交的「replaceSchema fatal 通道确定性锚」落点（SA2 认可零新注 seam） |
| A4 | LOW | D6 ① catch 须镜像 prepareReplace 的 DerivedInvariantError→E204 分支（否则伪造派生物降级 E200） | ✅ | D6 ① 末尾新增 catch 规格块；D9 注入路径 γ + SA4 红线（rejection phase=pre-commit-internal 而非 ok:false） | 覆盖 ①a 显式 sentinel、projectDeclaredRootKeys 内 makeRefResolver 环/缺名、buildTopEntries 非 map 形裸 throw；引 SA2 [NONMAP] 实测（合法编译产不出非 map ROOT——VFSL-E311）佐证「合规调用者不可达」 |
| A5 | LOW | §12 逐条命令非 verbatim、scratch 已删，可复现性形式不足（SA2 已代复跑证实，不阻断） | ✅ | §12.1（新增）：可复现脚本全文 + 逐字命令 | 设计期验证脚本与 tsc 孪生检查全文落档于设计文档内，SA4 可逐字重跑；SA2 独立复跑结论（9/9 真）已在 §12 表注引用 |
| A6 | LOW | projectDeclaredRootKeys 手写 Record 形判定，应消费 detached-build 已导出的 recordSlotOf | ✅ | D7 伪代码（`recordSlotOf(node) !== undefined` 替代手写 `fields.length===1 && …`）+ 注释（detached-build.ts:234 @internal 单点，不复制约定） | 约定漂移风险消除 |
| A7 | LOW | ① D2 末句易误导 SA3 在 S4' 加 schemaState 门；② 共享 disabled()/snapshotMutation 的 issue 名目挂 RootMutationIssue，§11 未说明 | ✅ | ① D2 末段重写：S4' 不设任何 schemaState 门 + SA4 红线（grep schemaState 于 schema-write.ts 应零命中）+ preparing 不可达性由 FIFO 保证、不设防御性 fatal；② §11 ALLOW LIST 末尾「共享件名目说明」 | 两处措辞级精确化 |
| A8 | LOW | `{schema, root: undefined}` 落 MUTATION_INPUT_NOT_PLAIN_DATA——码与语义错位；建议 message 明示 | ✅（维持裁决 + 明示） | D3「诊断面明示」：共享 message 已携带键名与值详情（`键 "root" 值为 undefined`）；D1 root JSDoc 规格化表述（「显式传 undefined 属非 plain 输入……不是视为未提供」）；共享 message 文案不改动（#90 冻结、ROOT 零回归） | 明示义务由 JSDoc + 登记承担，不动共享文案 |

**一致性自检（R1.1 修订后全文复核）**：投影语义（顶层剥离/嵌套 loud/Record 全保留/union 不投影）在 D1/D3/D6/D7/INV-S12/§6.2 行 9-10/§9 锚15/R1/R7 九处表述一致；`schema-compile-throw` 分级在 D5/D6①b/D9 表/§5 伪代码/§6.2 行 4 五处一致（唯一 fatal 分级，①b 为外部纵深防御）；fatal 撕裂态在 D8/D9/§6.2 行 21/§6.3/R2 五处一致；无残留「S4' 设 schemaState 门」表述（D2/D4/§5 伪代码均为零读）。

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-runtime/src/schema-write.ts` — 新建，SCHEMA 写槽唯一实现（S1–S7 槽体 + 编译步 + 输入形状检查 + issue 映射，§4 D2/D3/D5、§5，约 240 行）
- `packages/namespace-runtime/src/runtime.ts` — 修改，第九键 `replaceSchema` + `SchemaWriteEnv` 构造（V3c''）+ 类型导入（§4 D1，约 30 行）
- `packages/namespace-runtime/src/write.ts` — 修改，导出共享槽基建（`snapshotMutation`/`markWriteFatal`/`rejectWithWriteFatal`/`writeFatalMessage`/`disabled`/`errDetailOf`）+ fatal message 参数化槽位名词（ROOT 路径渲染字节不变）（§4 D3/D9，约 40 行）
- `packages/namespace-runtime/src/p0.ts` — 修改，@internal 导出 `installActive`/`assertCompiledShape`/`toIssueSummary`；`installActive` 增 `delete state.schemaIssue`（P0 调用点 no-op）；**`assertCompiledShape` 扩展检查面（R1.1/A1：envelope own 键集恰四键 + text string 等四值型——对 P0 零回归）**（§4 D5/D8，约 20 行）
- `packages/namespace-runtime/src/errors.ts` — 修改，append-only：`FATAL_SCHEMA_WRITE_INTERNAL_CODE`/`_MESSAGE` + phase `'schema-compile-throw'`（§4 D5/D9，约 14 行）
- `packages/namespace-runtime/src/index.ts` — 修改，类型导出 `ReplaceSchemaInput`/`SchemaReplacementIssue`/`ReplaceSchemaResult`（§4 D1，约 5 行）
- `packages/namespace-runtime/package.json` — 修改，version 0.1.2 → 0.1.3（硬门禁 9）
- `packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts` — `[SA6 owned]` 冻结验收红灯测试（13 用例）；SA3 不得改断言逻辑，仅可在测试基础设施故障时经总控裁决调整
- `packages/namespace-runtime/test/runtime-replace-schema-persistence.test.ts` — `[SA6 owned]` 冻结真实 Persistence 集成测试（2 用例）；同上
- `packages/namespace-runtime/test/runtime-replace-schema-type-guard.test-d.ts` — `[SA6 owned]` 冻结类型守卫；同上
- `packages/doc-runtime/src/schema-replace.ts` — 新建，组合 seam `replaceSchemaAndRoot`（⓪–⑤ 管线 + probeSchemaMap + projectDeclaredRootKeys（消费 recordSlotOf）+ verifySchemaFourKeys + ① catch 的 E204 分支，§4 D6/D7，约 230 行）
- `packages/doc-runtime/src/index.ts` — 修改，导出 `replaceSchemaAndRoot` + `SchemaReplaceInput`/`SchemaRootPlan` 类型（§4 D6，约 4 行）
- `packages/doc-runtime/package.json` — 修改，version 0.1.8 → 0.1.9（硬门禁 9）
- `packages/doc-runtime/test/schema-replace.test.ts` — `[SA6 owned]` 可选新建：组合 seam 直测（envelope 形状守卫/双探针/投影边界/⑤-S/E204 分支）。不建不构成缺口——集成覆盖已在 namespace-runtime 冻结测试（真实 vfsl + doc + Persistence）；建则属 SA6 职责
- `CONTEXT.md`（仓库根）— 修改，`## Language` 术语节新增「顶层声明域投影（top-level declared projection）」条目（逐字基准文本见 D7 末尾；【R1.1/A2 修订追加】SA2 攻击点 A2 要求公共契约面显式化——本条目 + D1 root JSDoc + 实现注释三处同步，约 4 行）

**【R1.1/A7②】共享件名目说明**：`schema-write.ts` 复用 write.ts 导出的 `snapshotMutation`/`disabled`/`markWriteFatal`/`rejectWithWriteFatal` 时，其 issue 的类型名目仍挂 `RootMutationIssue`（write.ts 侧冻结名目，不改动以免波及 #90 类型面）——两 issue 形状结构同一（`{message, path: Array<string|number>}`），且两侧 Result 联合的 `issues` 均为 `unknown[]`，按**结构兼容**复用、零适配层；schema-write 侧自身构造的 issue 纪律仍是 `SchemaReplacementIssue`（D9/INV-S10），名目独立不巨型化。

### DENY LIST

- `packages/namespace-runtime/src/sequencer.ts` — 通用 FIFO 已满足两槽需求，零改动
- `packages/namespace-runtime/src/status.ts` — 六键键集与推导不变（AC8 语义已由现状成立）
- `packages/namespace-runtime/src/projection.ts` — 读取面不动
- `packages/namespace-runtime/test/` 下其余 10 个既有测试文件（`runtime-mutate-root-*.test.ts` / `runtime-p0-sequencer.test.ts` / `runtime-write-fatal-message-rev1.test.ts` / `runtime-public-surface-ownership.test.ts` / `runtime-sync-read-face.test.ts` / `runtime-boundary-supplementary.test.ts` / `metadata-proto-key.test.ts`）— 冻结回归锚，本任务不动（fatal message 参数化若有回归由它们捕获）
- `packages/doc-runtime/src/replace.ts` — #88 冻结契约（⓪ E202 前置/⑤⑥/公共形状），不动
- `packages/doc-runtime/src/materialize.ts` / `mutation.ts` / `detached-build.ts` / `install-verify.ts` / `tx-guard.ts` / `carrier.ts` / `fatal.ts` / `extract.ts` / `read.ts` / `resolve.ts` / `xml-parse.ts` / `xml-serialize.ts` — 共享 seam 只读消费，不修改
- `packages/doc-runtime/test/**`（除 ALLOW 中可选新文件外）— 既有冻结测试不动
- `packages/vfsl/**`、`packages/persistence/**`、`packages/dsh-persistence/**`、`packages/vfsl-codegen/**`、`packages/vfsl-protocol/**` — 纯消费方，零改动
- `docs/adr/**` — ADR-0008 为已接受契约源，本设计只消费不修订

## §12. 协议假设依据 (Protocol Assumption Evidence)

本设计含第三方库（yjs）行为假设与前置包（vfsl/doc-runtime）管线行为假设，逐条给依据（设计期实测 = SA1 在 design 期以 tsx/tsc 于本 worktree 真实运行，命令与输出如下；脚本即用即删，未落入 src/test）：

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| 1 | `validateLogicalSnapshot` 对封闭对象**未声明键**发 issue（严格） | 设计期实测 + 源码 | 实测：`validateLogicalSnapshot(compile('type ROOT = { a: string; n: number; };').derived, { n: 999, a: 'x', b: true })` → `{ok:false, issues:[{message:'未知字段 "b"：封闭对象不接受未声明键', path:['b']}]}`；源码 `packages/vfsl/src/validate.ts:573-577`（「(2) 未知键——快照键枚举序……封闭对象不接受未声明键」）；缺必填实测 → `'缺少必填字段 "b"'` | 低（直接锚定） |
| 2 | `buildTopEntries` 在每层 map 上 F7 拒绝未声明键；缺必填不在此报 | 设计期实测 + 源码 | 实测：`buildTopEntries(v2b.derived, {n:999,a:'x',b:true})` → `ISSUE: 快照含结构树未声明字段 "b"——拒绝静默丢键`；`buildTopEntries(v2.derived, {n:5,a:'z'})` → `entries [["n",5],["a","z"]]`（缺 b 由 validate 把关）；源码 `packages/doc-runtime/src/detached-build.ts:156`（mapEntries F7，root 顶层与嵌套共用本函数） | 低 |
| 3 | ⑥ `verifySnapshotIntact` 比较 `extract(real) ≡ extract(scratch 同输入)`；scratch 侧经 buildTopEntries（对未声明键 F7 拒绝） | 源码引用 | `packages/doc-runtime/src/install-verify.ts:122-160`（`buildScratchInstall` → `buildTopEntries` → scratch 安装 → 双侧 `extractYjsSnapshot` → `productEqual`）→ 推论：⑥ 必须喂**投影后** snapshot（喂 raw 会使锚 15 用例落 E201 变体 D） | 低 |
| 4 | 单个 `doc.transact` 含 SCHEMA+ROOT 变更 → 恰 1 次 update 事件；顶层 map clear+set 保持实例 identity | 设计期实测 + 既有测试/设计法则 | 实测：`replaceRootContent(v2b.derived, {n:7,a:'q'}, doc)` → `{ok:true}`、`updates:1`、`doc.getMap('ROOT') === before`（同一事务 clear+install 模式）；法则：#88 设计 §4.3「update 计数法则：变更集非空 → 恰 1 次 update」+ `packages/doc-runtime/test/replace-root-content.test.ts` 既有锚 | 低 |
| 5 | `compileSchemaEnvelope` ok 产物 envelope 恰四键、值透传、五件套递归深冻结 | 设计期实测 + 包文档 | 实测：`Object.keys(c.envelope).sort() === 'id,lang,text,version'`；`packages/vfsl/src/index.ts` 头注（「信封恰四键严格封闭（ENV-5 拒多余键）……双指纹……递归深冻结五件套」）；消费先例：`p0.ts installActive` 直引 `compiled.envelope` 三身份字段 | 低 |
| 6 | 公共成员签名 `(input: ReplaceSchemaInput) => Promise<ReplaceSchemaResult>` 与冻结孪生 `interface … extends NamespaceRuntime { replaceSchema: (input: {schema: unknown; root?: unknown}) => Promise<{ok:true}|{ok:false;issues:{message,path}[]}> }` 在 strict+exactOptionalPropertyTypes 下兼容 | 设计期实测（tsc） | 实测：`tsc --noEmit --strict --exactOptionalPropertyTypes --target ES2022 --module ESNext --moduleResolution bundler` 对「设计签名 + 逐字复刻冻结孪生」编译通过（`TYPE-CHECK PASS`）；机理：属性语法逆变要求 `ReplaceSchemaInput` 可赋给 `{schema: unknown; root?: unknown}` ✓ | 低 |
| 7 | tx-guard 三窗口模型（`_transaction`/`_transactionCleanups`，yjs@13.6.32） | 源码引用 + 既有设计 | `packages/doc-runtime/src/tx-guard.ts:47-60`（谓词逐字）+ Doc.d.ts:49/53 类型面声明；#88 rev2 设计 §3.1/§9 定稿 | 低 |
| 8 | `getMap` 惰性创建零 update 事件 | 既有设计/测试引用 | #88 设计 RA-4/G2（「缺席 ROOT 经探针惰性创建空 map（零 update）」）；`packages/doc-runtime/src/carrier.ts:47` 注释（「缺席分支的创建实测零 update 事件（P4）」）——本设计 SCHEMA 缺席分支同机理 | 低 |
| 9 | keep-root 提取兼容性：当前 ROOT {n,a} 对 v2b 提取+验证通过；对 v3（a:string[]）载体错位 | 设计期实测 | 实测：`extractYjsSnapshot(v2b.derived, doc)` → `{ok:true, snapshot:{a:'x',n:1}}`、validate ok；`extractYjsSnapshot(v3.derived, doc)` → `{ok:false, issues:[{message:'Yjs 载体错位（ROOT.a）：期望 Y.Array，实际 plain value', path:['a'],…}]}`——与冻结测试 ENV3 负例逐字对应 | 低 |

**实测命令形态（供 SA4/SA7 复核）**：于 `packages/namespace-runtime/` 下以 `../../node_modules/.bin/tsx <scratch>.ts` 直接 import `@nomicore/vfsl` / `@nomicore/doc-runtime` / `../doc-runtime/src/detached-build.js` 运行；类型验证以 `../../node_modules/.bin/tsc --noEmit --strict --exactOptionalPropertyTypes … <scratch>.ts` 运行。**【R1.1/A5】**SA2 评审已对本表 9/9 条独立复跑证实（其报告 §6/§7，scratch 置于 /tmp 即用即删）；为满足可复现性形式（PR #188/#189 复盘立法），设计期脚本全文与逐字命令落档如下。

### §12.1 可复现脚本全文（SA4 逐字重跑基准）

**脚本 A（行为验证，覆盖依据 1/2/4/5/9 + 投影语义）**——保存为 `packages/namespace-runtime/.verify-design.ts` 后执行：

```bash
cd /home/wangjian/nomicore-fix-issue-91/packages/namespace-runtime && ../../node_modules/.bin/tsx .verify-design.ts
```

```ts
// .verify-design.ts（运行后删除；不落入 src/ 与 test/）
import { compileSchemaEnvelope, validateLogicalSnapshot } from '@nomicore/vfsl';
import * as Y from 'yjs';
import { extractYjsSnapshot, replaceRootContent } from '@nomicore/doc-runtime';
import { buildTopEntries } from '../doc-runtime/src/detached-build.js';

const comp = (text: string, id: string) => compileSchemaEnvelope({ lang: 'vfsl', version: 1, id, text } as never);
const v2b = comp('type ROOT = { a: string; n: number; };', 'ns-2b');            // 依据 1/2/9
const v2 = comp('type ROOT = { n: number; a: string; b: boolean; };', 'ns-2');  // 依据 1
const v3 = comp('type ROOT = { n: number; a: string[]; };', 'ns-3');            // 依据 9
if (!v2b.ok || !v2.ok || !v3.ok) throw new Error('compile fail');
console.log('envelope keys:', Object.keys(v2b.envelope).sort().join(','));       // 依据 5 → id,lang,text,version
console.log('validate extra-key =>', JSON.stringify(validateLogicalSnapshot(v2b.derived, { n: 999, a: 'x', b: true })));   // 依据 1 → 未知字段 "b"
console.log('validate missing =>', JSON.stringify(validateLogicalSnapshot(v2.derived, { n: 5, a: 'z' })));                 // → 缺少必填字段 "b"
console.log('build extra-key =>', JSON.stringify(buildTopEntries(v2b.derived, { n: 999, a: 'x', b: true })));              // 依据 2 → F7 issue
console.log('build missing =>', JSON.stringify(buildTopEntries(v2.derived, { n: 5, a: 'z' })));                            // → entries [["n",5],["a","z"]]

const doc = new Y.Doc();
for (const [k, v] of Object.entries({ lang: 'vfsl', version: 1, id: 'ns-1', text: 'type ROOT = { n: number; a: string; };'})) doc.getMap('SCHEMA').set(k, v);
doc.getMap('META').set('docId', 'ns-1');
doc.getMap('ROOT').set('n', 1); doc.getMap('ROOT').set('a', 'x');
const ex = extractYjsSnapshot(v2b.derived, doc);                                 // 依据 9 → {a:'x',n:1}
console.log('extract v2b =>', JSON.stringify(ex), 'validate =>', JSON.stringify(validateLogicalSnapshot(v2b.derived, (ex as {ok:true;snapshot:unknown}).snapshot)));
console.log('extract v3 =>', JSON.stringify(extractYjsSnapshot(v3.derived, doc)));              // → Yjs 载体错位（ROOT.a）

const updates = { n: 0 }; doc.on('update', () => { updates.n += 1; });
const before = doc.getMap('ROOT');
console.log('replaceRootContent =>', JSON.stringify(replaceRootContent(v2b.derived, { n: 7, a: 'q' }, doc)),  // 依据 4 → ok + updates:1
  'updates:', updates.n, 'identity:', doc.getMap('ROOT') === before);
```

**脚本 B（类型层验证，覆盖依据 6）**——保存为 `packages/namespace-runtime/.verify-twin.ts` 后执行：

```bash
cd /home/wangjian/nomicore-fix-issue-91/packages/namespace-runtime && ../../node_modules/.bin/tsc --noEmit --strict --exactOptionalPropertyTypes --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck .verify-twin.ts && echo 'TYPE-CHECK PASS'
```

```ts
// .verify-twin.ts（运行后删除）
interface SchemaEnvelope { lang: string; version: number; id: string; text: string; }
export type ReplaceSchemaResultP = { ok: true } | { ok: false; issues: unknown[] };
export interface ReplaceSchemaInput { readonly schema: SchemaEnvelope; readonly root?: unknown; }
export interface Base { readonly replaceSchema: (input: ReplaceSchemaInput) => Promise<ReplaceSchemaResultP>; }
// —— 以下逐字复刻 SA6 冻结孪生（runtime-replace-schema-sequencer.test.ts:79-90）——
interface ReplaceSchemaIssue { message: string; path: Array<string | number>; }
type ReplaceSchemaResult = { ok: true } | { ok: false; issues: ReplaceSchemaIssue[] };
type ReplaceSchema = (input: { schema: unknown; root?: unknown }) => Promise<ReplaceSchemaResult>;
interface ReplaceSchemaRuntime extends Base { replaceSchema: ReplaceSchema; }
declare const b: Base;
void b.replaceSchema({ schema: { lang: 'vfsl', version: 1, id: 'x', text: 't' } });
void b.replaceSchema({ schema: { lang: 'vfsl', version: 1, id: 'x', text: 't' }, root: { a: 1 } });
```

预期输出（逐字锚）：脚本 A 见依据 1/2/4/5/9 各行「→」后内容；脚本 B 输出 `TYPE-CHECK PASS`（exit 0）。

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

**声明：本设计无「既有路径」的契约改动**——不含 §1.5 五类清单中的任何一种（无 `return X → throw`、无 Promise 形态变更、无同步转异步、无 catch swallow→rethrow、无 nullable↔non-null 翻转）。全部变更为**加法**（新函数/新接口成员/新导出/append-only 枚举）。加法面与内部行为微调的 caller 审计如下：

### 改动函数/类型

| 函数/类型 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `NamespaceRuntime`（接口） | `packages/namespace-runtime/src/runtime.ts` | 八键公共面 | **+第九键** `replaceSchema`（加法；实现方仅本包两个构造器） |
| `installActive`（包内） | `packages/namespace-runtime/src/p0.ts` | 设 activeInfo/activeTools、`schemaState='ready'` | 同左 **+ `delete state.schemaIssue`**（行为加法） |
| `markWriteFatal` / `rejectWithWriteFatal` / `writeFatalMessage`（包内） | `packages/namespace-runtime/src/write.ts` | 模块私有，ROOT 单态 | 导出供 schema-write.ts 复用 + 槽位名词参数（ROOT 渲染字节不变） |
| `replaceSchemaAndRoot` | `packages/doc-runtime/src/schema-replace.ts` | （不存在） | 新公共入口：`ReplaceResult` 联合 + E202/E201/E203/E204 throw 面（与 replaceRootContent 同族） |
| `RuntimeWriteFatalPhase`（联合） | `packages/namespace-runtime/src/errors.ts` | 六值 | **+`'schema-compile-throw'`**（append-only，v1 冻结表允许只增） |

### Caller 清单

| Caller | 文件:位置 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `runP0` → `installActive` | `packages/namespace-runtime/src/p0.ts:94` | 同步调用 | 槽体整体 try/catch（INV-N12 永不 reject） | 有 | 增量为 no-op（preparing→ready 时 `schemaIssue` 恒 undefined）；零处置需要 |
| `runRootWriteSlot` → `markWriteFatal`/`rejectWithWriteFatal`/`writeFatalMessage` | `packages/namespace-runtime/src/write.ts:146/119/83/192/198` | 同步/await | 槽内逐点分类 | sequencer 链尾恒绿 + 返回 Promise | 参数默认/显式 `'root'` → 渲染与现状逐字节相同；零处置需要 |
| `runSchemaWriteSlot`（新）→ 共享机械 | `packages/namespace-runtime/src/schema-write.ts`（新） | await | 槽内逐点分类（§5） | 同上 | 新 caller，设计即含分类表（D9） |
| `runSchemaWriteSlot`（新）→ `replaceSchemaAndRoot`（新） | 同上 | 同步调用（seam 同步完结） | try/catch 包裹（branded 透传 / 未知保守 true） | 同上 | 新 caller，设计即含（D9 表） |
| `replaceRootContent` / `materializeRoot` / `applyValidatedMutation`（既有公共入口） | `packages/doc-runtime/src/*.ts` | — | — | — | **零改动零新 caller**；本设计不触碰其调用面 |
| 测试消费面（`NamespaceRuntime` 新成员） | `packages/namespace-runtime/test/*`（10 既有文件） | — | — | — | 结构化新增成员对既有断言零影响（已核对无八键精确键集断言）；#91 三冻结文件即新成员的消费锚 |

### 风险评估

- **遗漏 caller 的代价**：接口加法对「实现 NamespaceRuntime 的外部代码」是 breaking——但本仓实现方只有包内 `createNamespaceRuntimeWithSeam`/`createNamespaceRuntime`（grep 全仓确认无其他 implements/字面量实现），公共消费均为方法调用方。
- **内部行为加法（installActive 删字段）**：唯一 caller 是 P0（字段恒 undefined → no-op）；`getSchemaEnvelope`/`buildStatus` 均不读 `schemaIssue` 于 ready 态 → 无可观测差异。
- **抓全 caller 的方法**（SA4 复核用）：`git grep -n "implements NamespaceRuntime\|: NamespaceRuntime = \|installActive(\|replaceSchemaAndRoot(" -- 'packages/**/*.ts'`。
