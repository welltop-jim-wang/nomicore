# SA1 修订设计（round 2 / rev1）— replaceSchema provided-root 静默投影偏差修复（issue #91）

## §0. 任务定位与取代声明

- **类型**：Bug 修复（merge-blocking）。触发 = 人工 review：round 1 交付的 D7「顶层声明域投影」是仓内自创越权语义，与 Issue #91 AC3 / ADR 0008 §ROOT write 与 SCHEMA write 第 3 条直接冲突——调用方提供的 `root` 是**完整最终 logical ROOT snapshot**，应原样接受封闭校验，出现未声明字段时 `ok:false` 零写入，而不是先修改输入再校验。
- **取代声明**：round 1 设计（`wiki/raw/task_namespace-runtime-replace-schema_design.md`）的 **D7 顶层声明域投影 / INV-S12 / 锚 15 投影读法及其「⑥ 必须喂 narrowed」推论** 全部废止；round 1 档案为历史记录不改写，取代关系以本文件为准。round 1 设计的其余部分（D1–D6/D8–D10、槽序、fatal 分类、seam 职责二分）不受影响，继续有效。
- **约束基准**：`wiki/raw/task_namespace-runtime-replace-schema-rev1_relevant_decisions.md`（SA8 前置门禁产出）。关键条款：ADR 0008 §SCHEMA write 第 3 条（:69「提供 root 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容」）、同节失败语义（:75 编译/校验/构造失败均在 transaction 前，零写入、active tools 不变）、ADR 0007 底层决策（零写入承诺覆盖所有验证与构造失败）。SA8 明示：第 2 条「提取投影」仅限 keep-root 分支，**不构成 provided-root 的投影授权**。
- **规模自知**：精确限定的小修订。生产代码净变化集中在 `schema-replace.ts` 单文件（删一个模块私有函数 + 换一个喂值 + 注释改写），另有 JSDoc/术语两处文档面、两个 patch 版本号。SA6 红灯已锚定（R2-1 真实转红，全仓唯一失败；R2-3 修订后全绿）。

## §1. 根因（一段话）

`packages/doc-runtime/src/schema-replace.ts:170` 在 provided-root 分支的校验与构造前调用 `projectDeclaredRootKeys()`，把 snapshot 静默投影到 proposed 结构树顶层声明键集。后果：调用方笔误多传的顶层键（如 `email`）被悄悄剥离且返回 `ok:true`——**永久数据丢失 + 拼写错误被掩盖**，同时使 ①d 校验/构造与 ⑥ 写后校验消费「改造后的输入」而非调用方的真实意图。这不是降级场景（无外部故障），是正常路径上的契约违约：修复方式是删除投影、原样喂值、让未声明顶层键与嵌套未知键同族响亮失败（validate.ts 封闭对象「未知字段 "<k>"」天然覆盖顶层，path=`[<k>]`）。

## §2. 变更点规格（生产代码，全部落在 `packages/doc-runtime/src/schema-replace.ts`）

### D1（主变更）删除投影，①d replace-root 分支原样喂 validate/build

删除 `projectDeclaredRootKeys()` 函数本体（:318-337 含 doc 块）及其调用（:170）。修订后 ①d replace-root 分支（步骤次序、失败透传、probeRoot 位置与 keep-root 分支概略对称——均不变，仅消费原样 snapshot）：

```ts
// replace-root：完整最终 logical ROOT —— 原样（不投影）逻辑校验 → detached 构造
// → ROOT 载体判定（rev1：D7 顶层声明域投影废止；validate/build/⑥ 三处同源同形态）
const snapshot = input.root.snapshot;                    // 原样——调用方提供的完整 ROOT
const logical = validateLogicalSnapshot(input.derived, snapshot);
if (!logical.ok) return { kind: 'fail', issues: logical.issues };   // 顶层未声明键在此响亮失败
const top = buildTopEntries(input.derived, snapshot);
if (top.kind === 'issue') return { kind: 'fail', issues: [top.issue] };
const rootProbe = probeRoot(doc);
if (rootProbe.carrier !== 'Y.Map') { /* 原样：单 issue fail */ }
return {
  kind: 'ready', branch: 'replace-root', schemaMap,
  rootMap: rootProbe.map, entries: top.entries,
  snapshot,                                               // 原样携带（⑥ 消费）
};
```

- **顶层未声明键的失败来源**：validate 先于 build 执行，故 R2-1 类输入（ns-2b 声明 `{a,n}` × root 含 `b`）由 `vfsl/validate.ts:577` 发出 `未知字段 "b"：封闭对象不接受未声明键`、`path=['b']`（顶层 path 基点 `[]` + 键段——封闭对象检查对顶层与嵌套同一实现，天然覆盖）。SA6 断言「验证/构造双 loud 任一来源」兼容（build F7 `快照含结构树未声明字段 "b"` 亦为 path `['b']`，但 validate 先拦）。
- **次序不变性**：validate → build → probeRoot 与修订前一致（前值是 validate(narrowed)→build(narrowed)）；②③④⑤ 与 ⓪①a①b①c 零触碰。

### D2 `PreparedSchemaReplace` 字段处置：`narrowed` → `snapshot`

```ts
| {
    kind: 'ready'; branch: 'replace-root'; schemaMap: Y.Map<unknown>;
    rootMap: Y.Map<unknown>; entries: Array<[string, unknown]>;
    /** ⑥ 消费的原样 provided-root snapshot（与 validate/build 同一引用——rev1 单形态纪律）。 */
    snapshot: unknown;
  }
```

- 字段更名 + 语义翻转（投影形态 → 原样引用），**不删除字段**：④ 处 `ready.branch === 'replace-root'` 无法从类型层窄化 `input.root`，沿 ready 载荷携带是既有模式（entries/rootMap 同款），diff 最小。该类型为模块私有（doc-runtime `index.ts` 只导出 `SchemaReplaceInput`/`SchemaRootPlan`），更名无公共面影响。

### D3 ④ ⑥ `verifySnapshotIntact` 喂原样 snapshot

```ts
verifyInstall({ rootMap: ready.rootMap, entries: ready.entries });   // ④ ⑤-R（不变）
verifySnapshotIntact(input.derived, ready.snapshot, doc);            // ④ ⑥（原样）
```

**喂原样的正确性论证**（取代 round 1「⑥ 必须喂 narrowed」推论）：

1. round 1 的「喂 raw → scratch F7 → E201 变体 D」实证成立于**旧管线**：validate/build 消费 `narrowed` 而 raw 残留未声明键——⑥ 若喂 raw，scratch 侧 build 的输入与 prepare 侧 build 的输入**不是同一个值**，确定性重放被破坏。
2. 新管线下 validate/build/scratch-build 三处消费**同一引用**。能到达 ② 的输入必已通过「validate 封闭对象 + build F7」双闸 ⇒ 原样 snapshot 不含未声明键 ⇒ 对成功路径 `raw ≡ narrowed`（投影对全声明输入是恒等映射）。scratch 侧 `buildTopEntries(derived, raw)` 是 prepare 侧已成功构造的确定性重放（`(derived, snapshot)` 对合规调用者不可变：namespace-runtime 路径 snapshot 经受控 snapshotter 递归冻结、compiled 五件套深冻结），E201-C/D 可达集不扩张。
3. **同族先例**：`replace.ts:106`（replaceRootContent ⑥）一直喂原样 snapshot——姊妹 seam 的既定模式，本修订使 schema-replace 与之对齐（消除同一包内两种 ⑥ 喂值纪律）。

### D4 imports 清理

`projectDeclaredRootKeys` 是 `makeRefResolver` / `plainObjectOf` / `recordSlotOf` 在本文件的**唯一**消费点（:320/:325/:323），删除后三个 import 必须一并移出（`buildTopEntries` 保留）——否则 typecheck/lint 报未用导入。

### D5 schema-replace.ts 注释面修订（load-bearing 逐处）

| 位置 | 现文要点 | 修订为 |
|---|---|---|
| :18-19 | 「新增代码只有……与顶层声明域投影（projectDeclaredRootKeys）」 | 删去投影项 |
| :37-39 | ①d「replace-root：projectDeclaredRootKeys（D7 顶层声明域投影）→ validate → build → probeRoot」 | 「replace-root：原样 snapshot → validateLogicalSnapshot → buildTopEntries → probeRoot（rev1：D7 废止，原样封闭校验）」 |
| :45-47 | ④「必须喂投影后 snapshot——喂 raw 会把未声明键用例变成不可达的 E201 fatal」 | 「④ ⑥ 喂原样 snapshot——与 ①d validate/build 同一 (derived, snapshot) 输入对，scratch 确定性重放（rev1 单形态；旧论证随投影废止失效）」 |
| :89-90 | narrowed 字段 JSDoc「投影形态（与 keep-root 提取投影同构——D7）」 | D2 新文案 |
| :128 | 「⑥ 对称重物化——必须喂投影形态」 | 「⑥ 对称重物化——原样 snapshot」 |
| :134-136 | catch 注释「①a 显式 sentinel / projectDeclaredRootKeys 内 makeRefResolver 环/缺名 sentinel / buildTopEntries 的非 map 形裸 throw 不在此列」 | 「①a 显式 sentinel / buildTopEntries 内 makeRefResolver 环/缺名 sentinel / buildTopEntries 的非 map 形裸 throw 不在此列」（throw 源清单投影项由 build 项吸收，分类不变；doc 块 :133-137 整体核对） |
| :168-169 | 「完整最终 logical ROOT → 顶层声明域投影 → ……全部消费投影形态——D7」 | 「完整最终 logical ROOT → 原样逻辑校验 → detached 构造 → 载体判定（rev1：原样、无投影）」 |
| :300-337 | 函数 + D7 三层论证 doc 块 | 整体删除 |

### D6 schema-write.ts 公共 JSDoc 改写（`ReplaceSchemaInput.root`，:76-80 逐字基准）

删除「未声明顶层键不进入新 generation……被剥离且 ok:true 不携带任何反馈（冻结锚 15 语义……）」与「嵌套未声明键响亮拒绝」两段，合并替换为：

```ts
   * - **未声明键一律响亮拒绝（顶层与嵌套同族）**：root 作为完整最终 logical ROOT
   *   **原样**送入封闭对象校验（validateLogicalSnapshot）与 detached 构造
   *   （buildTopEntries）——未声明顶层键与嵌套未知键同样返回 `ok:false` + 指向该键
   *   的 issue（path=[<k>]），零写入、SCHEMA/ROOT/active tools 不变（issue #91 AC3 /
   *   ADR 0008 §SCHEMA write 第 3 条；round 1 的顶层静默剥离契约已废止）。
```

（:70-75 提供性判定段、:81-83 issues 窄化示例段**逐字保留**。）

### D7 CONTEXT.md 术语条目改写（:17-19 逐字基准）

```markdown
**原样封闭校验（provided-root as-is closed validation）**:
`replaceSchema` 提供 `root` 时，root 被视为完整最终 logical ROOT snapshot，**原样**送入封闭对象校验（validateLogicalSnapshot）与 detached 构造（buildTopEntries）——任何未声明键，无论顶层还是嵌套，一律响亮拒绝（`ok:false` + 指向该键的 issue，零写入）；不投影、不剥离、不合并。
_Avoid_: 顶层声明域投影（round 1 自创语义，已废止）、宽松合并（merge）、schema 演进迁移（migration 属上层语义，非本层职责）
```

（保留条目位（信封条目后）与 `_Avoid_` 惯例；删「顶层声明域投影」术语本身。round 1 登记的「被剥离键 advisory 上报另立 issue」随剥离语义消亡而**不再需要**——无剥离即无 advisory 对象，§10 R7 登记作废。）

### D8 版本 bump（HG #9）

- `packages/doc-runtime/package.json`：`0.1.9` → `0.1.10`（公共 seam 行为契约收紧）
- `packages/namespace-runtime/package.json`：`0.1.3` → `0.1.4`（公共 API `replaceSchema` 行为契约收紧 + JSDoc）

## §3. E204 崩溃边界可达性论证（γ 路径保持）

**问题**：γ 注入用例（手造环 ref derived → E204 pre-commit-internal）当前经 `projectDeclaredRootKeys` 内 `makeRefResolver` 触发；删投影后 E204 是否仍可达、分类是否漂移？

**论证（三步，全部源码可查）**：

1. **validate 结构盲**：修订后 ①d 第一个消费者是 `validateLogicalSnapshot`。`packages/vfsl/src/validate.ts:4-6`：「validateLogicalSnapshot 是值 schema（`derived.values`）的解释器；结构树（aliases / structure / index）**本文件内零消费**（两树正交纪律）」。γ 派生物只污染 `structure`/`aliases`（值树是真实编译产物），且输入 `{n:999,a:'x'}` 对 ns-2b 值树合法 ⇒ validate `ok:true` 通过，不提前拦截、不抛错。
2. **结构树首消费者前移到 buildTopEntries**：`detached-build.ts:51` `makeRefResolver(derived)` → `rootEntries` 首行 `resolve(node)`（:65）→ `resolve.ts:25` inFlight 环守卫（先于 memo 命中）抛 `DerivedInvariantError('结构 ref 环（SA7CYC）')`；缺名 sentinel 同理（`resolve.ts:33`）。γ 派生物 `structure.kind === 'root'` 过 ①a（:141）与 buildTopEntries 自身 root 检查（`detached-build.ts:46`），环在首个 resolve 即触发。
3. **捕获与分类零变化**：该 throw 落在 `prepareSchemaReplace` ① 唯一 try/catch 内，`instanceof DerivedInvariantError` 分支（:191-203）→ `DOCRT-E204` pre-commit-internal committed:false——与修订前**同一 catch、同一 phase/committed、同一 cause 链**。γ 用例全部断言（rejection 非 ok:false、committed=false、cause 保留、0 update / 0 notifier / state 字节不变、SCHEMA/ROOT/active 三不变、fatal 摘要码 + 永久禁写保读）逐条保持。

**throw 源集合净变化**：①d 内被删的 throw 源只有投影内部 resolver 的 `DerivedInvariantError`——它与 buildTopEntries 内 resolver 的 throw **同类同源**（同一 `makeRefResolver` 实现），故 prepare catch 面的异常类别集合不变；`buildTopEntries`「ROOT 结构节点非 map 形」裸 throw → E200 的分类亦不变（:133-137 注释同步，见 D5）。**结论：E204 经 buildTopEntries 环守卫保持可达，无分类漂移。**（SA6 round-2 红灯记录 :98 同判：「γ 用例的 E204 经 buildTopEntries 内 makeRefResolver 环守卫保持可达」。）

## §4. 既有行为零回归清单（逐项处置依据）

| # | 既有行为 | 处置 | 依据 |
|---|---|---|---|
| 1 | keep-root 分支（extractYjsSnapshot → validate，AC2） | 零触碰 | 修订只在 replace-root 分支；ADR 0008 第 2 条的提取投影**仅限 keep-root**，保留合法 |
| 2 | ⓪/①a/①b/①c（事务语境守卫、root 结构 sentinel、envelope 形状纵深防御、probeSchemaMap 四级级联） | 零触碰 | D1 只改 ①d |
| 3 | ② 单事务机械：SCHEMA 原实例 clear+恰四 set、ROOT 原实例 clear+entries 安装、恰 1 update、双顶层 identity | 零触碰 | 事务体只消费 ready 载荷；entries 构造源仅从 narrowed 换 raw（对到达 ② 的输入恒等，D3-2） |
| 4 | ③ ⑤-S `verifySchemaFourKeys` / ④ ⑤-R `verifyInstall` | 零触碰 | 与 root 处置计划无关 |
| 5 | ⑥ 对称重物化（E201-C/D 语义） | 喂值换原样，语义保持 | D3 三点论证 + replace.ts:106 同族先例 |
| 6 | 嵌套未声明键 loud（A2-嵌套） | 恒等 | 旧投影只动顶层（:330 顶层循环）；validate/build 对嵌套的拒绝路径原本就吃原样输入 |
| 7 | union 形 ROOT loud（A2-union 不投影） | 恒等 | 旧投影对 union 本就整段返回原样（:322）；新代码 = 无投影的同一路径 |
| 8 | Record 形 ROOT 全保留 | 恒等 | 旧投影对 Record 形整段返回原样（:323 `recordSlotOf !== undefined` → return snapshot） |
| 9 | 合法 provided-root 幸福路径（ns-2 × `{n,a,b}`、ns-2b × `{n,a}`、ns-arr × `{n,a:['x','y']}`）ok:true / 恰 1 update / notifier 1 / ⑥ 双侧提取等价 | 保持绿 | 全声明输入下投影是恒等映射 ⇒ validate/build/⑥ 输入逐键相等；`runtime-replace-schema-persistence.test.ts:47,129,185`（ENV2 声明 `{n,a,b}`）不需改动 |
| 10 | sequencer 槽序 S1–S7、S3 快照时点（AC3）、S4 零读 active 域（AC1/AC8） | 零触碰 | 槽体与 seam 契约零变化；R2-3 已由 SA6 修订输入（root 去掉 `b`）保持「槽起点快照获胜」意图，快照时点断言原样 |
| 11 | fatal 三分类（α E201 / β E203 / γ E204、A1 四变体 schema-compile-throw、S2 write-slot-internal、S6 notify-dirty-failed）与过报方向 | 保持 | §3；catch 面异常类别集合不变 |
| 12 | E202 结构性不可达论证 | 不变 | ⓪ guard 位置不动；seam 仍只被槽同步调用 |
| 13 | `__proto__` own 键 / present 惯例（undefined 视同缺席） | 恒等或更优 | validate（Object.keys + present）/ build mapEntries（own 数据属性遮蔽原型 accessor，T10 锚）/ ⑥ scratch 同一实现；删投影反而少一个拷贝点（其 defineProperty 纪律随之退役，无新拷贝引入） |
| 14 | 全量门禁：`pnpm typecheck` / `pnpm test` / `tsc -p tsconfig.typecheck.json --noEmit`（基线 84 files / 1078 tests） | 必须全绿 | 唯一预期翻转 = R2-1 红→绿；SA6 全量对照（修订后、当前代码）76 files/1021 tests（--no-typecheck 口径）仅 R2-1 一败 |

## §5. 红灯映射（SA6 已锚定，SA3 修绿方向）

| 红灯 | 修绿落点 | 说明 |
|---|---|---|
| R2-1 顶层未声明键 → ok:false + path=['b'] + 五零写入断言 | D1+D2+D3 | 当前代码 `expected {ok:true} to match {ok:false}`（sa7-dynamic:461）；删投影后 validate 封闭对象首发 issue |
| R2-2 保持项（嵌套 loud / union loud / 幸福路径 / γ / A1 / AC9 / ⑥） | §4 清单 | SA6 实跑：sa7-dynamic 9 tests 仅 R2-1 红 |
| R2-3 sequencer 快照时点用例 | 无生产代码需求 | SA6 已改输入为 `{n:1,a:'x'}`（对槽起点 schema ns-2b 全声明）；断言（ok:true、notifier 恰 1、read n===999、envelope id ns-2b）原样保留 |

## §6. 实现注意事项（给 SA3）

1. D4 imports 清理勿漏——`tsc --noEmit` 对未用导入不报错，但 lint/typecheck 流水线（`tsconfig.typecheck.json` 含 `noUnusedLocals` 语义时）会；逐一核对 `makeRefResolver`/`plainObjectOf`/`recordSlotOf` 在文件内确无第二消费点（SA1 已核：仅投影使用）。
2. `snapshot` 字段更名后全文检索 `narrowed` 确认零残留（含注释）。
3. 注释修订按 D5 表逐处落，勿留「D7」/「投影」死引用（自检：`grep -n "投影\|narrowed\|projectDeclaredRootKeys\|D7" packages/doc-runtime/src/schema-replace.ts` 应只剩 rev1 语境的「废止」说明）。
4. 版本 bump 只动 version 字段，不触 dependencies。

## §7. 文件清单（File Scope）

### ALLOW LIST

- `packages/doc-runtime/src/schema-replace.ts` — 修改：删 `projectDeclaredRootKeys`（:170 调用 + :300-337 本体）、`narrowed`→`snapshot`（:89-90/:128/:182-189）、注释面修订（:18-19/:37-39/:45-47/:134-136/:168-169）、imports 清理（D4）；§2 D1–D5，净约 −60 行
- `packages/namespace-runtime/src/schema-write.ts` — 修改：`ReplaceSchemaInput.root` JSDoc 契约段改写（:76-80，≤10 行）；§2 D6
- `CONTEXT.md` — 修改：术语条目「顶层声明域投影」→「原样封闭校验」（:17-19，约 4 行）；§2 D7
- `packages/doc-runtime/package.json` — 修改：version `0.1.9`→`0.1.10`；§2 D8（HG #9）
- `packages/namespace-runtime/package.json` — 修改：version `0.1.3`→`0.1.4`；§2 D8（HG #9）
- `packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts` — `[SA6 owned]` R2-1 契约红灯 + 头部/describe 措辞（SA6 已写入，git 已暂存）；SA3 **不得改断言逻辑**，仅当实现命名与注释发生漂移时可同步注释措辞
- `packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts` — `[SA6 owned]` R2-3 快照时点用例输入修订（SA6 已写入，git 已暂存）；SA3 不改

### DENY LIST

- `packages/doc-runtime/src/{detached-build,resolve,install-verify,extract,replace,carrier,fatal,tx-guard,materialize,mutation,read}.ts` 与 `src/index.ts` — 共享 seam 单源：⑥ 换喂值不需要动 `install-verify` 签名（`replace.ts:106` 已示范原样喂值）；`projectDeclaredRootKeys` 未在 index.ts 导出，删除无公共面影响
- `packages/vfsl/**` — validate.ts 封闭对象「未知字段 "<k>"」天然覆盖顶层（:573-578），零改动需求
- `packages/namespace-runtime/src/{runtime,p0,write,errors,projection,status,index}.ts` — 槽体、状态机、错误码零变化
- `packages/namespace-runtime/test/runtime-replace-schema-persistence.test.ts`、`runtime-replace-schema-type-guard.test-d.ts` — 既有绿锚（§4 #9），零改动需求
- `packages/persistence/**`、`apps/**`、`docs/adr/**` — 不涉；ADR 0007/0008 冻结不动（本修订是回归 ADR 而非修改 ADR）
- `wiki/raw/task_namespace-runtime-replace-schema*.md`（round 1 档案）— 历史记录不改写，取代关系由本 rev1 档案显式声明
- `REPORT.md` — 总控专属（完成事务边界：总控只写 REPORT.md，禁止 push/PR/label）

## §8. 协议假设依据 (Protocol Assumption Evidence)

无协议级假设：本设计仅涉及纯 TypeScript 代码修订 + JSDoc/术语文档修订，不含 HTTP/WS 端点、端口/进程时序、跨 job 资源生命周期或第三方库行为假设。两条**行为级**论断的源码依据（非协议类，供 SA4 复核）：

| 论断 | 依据类型 | 依据内容 | 风险等级 |
|---|---|---|---|
| validateLogicalSnapshot 对结构树零消费（E204 论证前提） | 源码引用 | `packages/vfsl/src/validate.ts:4-6`「结构树（aliases / structure / index）本文件内零消费（两树正交纪律）」 | LOW |
| 顶层未声明键由封闭对象检查以 path=[k] 拒绝（R2-1 断言兼容） | 源码引用 + 现有测试引用 | `packages/vfsl/src/validate.ts:573-578`（`ctx.emit([...path, k], 未知字段 "<k>"…)`，顶层 path 基点 `[]`）；嵌套同族先例 `runtime-replace-schema-sa7-dynamic.test.ts:486-512`（A2-嵌套 loud） | LOW |
| γ E204 经 buildTopEntries 环守卫可达 | 源码引用 + 设计期红绿对照 | `detached-build.ts:51,65` + `resolve.ts:25`；SA6 round-2 红灯记录（简报 :91-95、:98） | LOW |

## §9. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `replaceSchemaAndRoot` | `packages/doc-runtime/src/schema-replace.ts:105` | 签名 `(doc: Y.Doc, input: SchemaReplaceInput) => ReplaceResult`（同步）；provided-root 含未声明顶层键 → 投影剥离后 `ok:true` | 签名**零变化**；同输入 → `ok:false` + issues（path=[<k>]）。**非** 5 类触发清单中的 throw/async/签名变化——结果联合的值域收紧（原 ok:true 的一个输入子集变为 ok:false），无新增 throw 路径（§3：catch 面异常类别集合不变） |
| `replaceSchema`（公共 API） | `packages/namespace-runtime/src/schema-write.ts:101` + `runtime.ts` | 同上透传 | 同上透传（本任务目的本身） |
| `projectDeclaredRootKeys` | `packages/doc-runtime/src/schema-replace.ts:318` | 模块私有（index.ts 不导出——:23-24 仅导出 `replaceSchemaAndRoot`/`SchemaReplaceInput`/`SchemaRootPlan`） | 整函数删除，无外部 caller |

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `runSchemaWriteSlot` S5（`replaceSchemaAndRoot` 唯一 caller） | `packages/namespace-runtime/src/schema-write.ts:161` | 同步调用（async 函数体内） | ✅ try/catch（:160-173：`DocRuntimeFatalError` 透传 committed/phase，未知异常保守 committed:true） | sequencer 链尾恒绿接线 | **零改动**：`result.ok === false` → :174 `return {ok:false, issues}` → S5.5 installActive / S6 notifyDirty 不执行（R2-1 的 0 notifier、active tools 不变、非 fatal、schemaWrite 仍 enabled 由现有结构天然满足） |
| `runtime.replaceSchema` 公共方法 → 测试调用 | `packages/namespace-runtime/src/runtime.ts`（唯一实现转发）+ 4 个测试文件 | await | N/A（公共 API） | N/A | 行为变化即本任务目的；测试面已由 SA6 R2-1/R2-3 锚定，persistence/type-guard 零影响（§4 #9） |
| `verifySnapshotIntact`（⑥ 被换喂值，非契约改动） | `schema-replace.ts:128`（本文件）+ `replace.ts:106`（姊妹 seam，喂值本就原样） | 同步 | ①/④ 各自崩溃边界收编 | — | D3；`replace.ts` 零触碰 |

### 风险评估

- 遗漏 caller 的代价：若有第二个 `replaceSchemaAndRoot` caller 依赖「剥离后 ok:true」，行为收紧会使其失败面扩大。抓全方法：`git grep -n "replaceSchemaAndRoot\|replaceSchema(" -- 'packages/**/*.ts' 'apps/**/*.ts'` → 生产 caller 唯一（schema-write.ts:161）；`replaceSchema` 生产 caller 唯一（runtime.ts 公共面转发）。已全列。
- doc-runtime 直接服务调用方（①b 纵深防御的信任边界）同样受益于收紧：不再有「输入被改造后才校验」的静默面。

—— SA1 修订设计完。交出控制权，等待 SA8 设计复审与 SA2 破壁攻击。
