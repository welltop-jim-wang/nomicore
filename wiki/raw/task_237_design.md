# 设计（SA1）— issue #237：ordinary Namespace mutation 用路径级校验替代完整 ROOT 复制与全量校验

- **阶段**：design（SA1，round 1）| **日期**：2026-09-06 | **供 SA2 独立攻击评审**
- **Worktree**：`/home/wangjian/nomicore-fix-issue-237`（HEAD `9e3f0bf`，branch `mabf/issue-237`）
- **输入（全部读过）**：issue #237 正文；Owner 3 条评论（2026-09-05T16:01Z 范围收敛 / 2026-09-05T16:08Z carrier 正确性与校验架构 / 2026-09-06T02:55Z 生产证据与 benchmark）；SA5 `wiki/raw/20260906-bug-237.md`；SA6 `wiki/raw/20260906-ac-issue-237.md` + `wiki/raw/task_237_sa6.md`（红灯锚已 approve：**45 tests = 4 必红 + 41 绿锁定**）；SA8 `wiki/raw/task_237_conflict_report.md`（verdict `clear`，E1–E4 强制文档义务）+ `wiki/raw/task_237_relevant_decisions.md`；被改面源码逐文件（见 §19 证据）。
- **红灯锚（SA6 已固化并运行验证）**：`packages/doc-runtime/test/issue-237-path-localized-validation-red.test.ts`（41 tests：3 必红 + 38 绿锁定）+ `packages/namespace-runtime/test/runtime-mutate-issue-237-hot-path-red.test.ts`（4 tests：1 必红 + 3 绿锁定）。SA3 修绿目标 = 4 必红转绿且 41 绿锁定全绿；本设计另登记 **2 处既有测试面必须随语义演进修订**（§12/§13，其中 1 处为 SA6 契约自身缺陷，实证见 §12）。

---

## 1. 目标与非目标

**目标**（issue AC + Owner 评论逐条）：

1. `applyValidatedMutation` 内部把普通非空路径 mutation 的校验/提取/验证从 O(ROOT) 收窄到 **O(path depth + boundary size)**；公共 `mutateData` interface、结果联合、严格 FIFO、槽序 S1–S7、fatal 契约全部不变。
2. phase-1 前置假设显式化：mutation 开始前 committed ROOT 已符合 active schema（**logical values + carrier topology** 双半边，Owner 2026-09-05T16:08Z §3）；不建 committed-generation/document-baseline 状态机。
3. 删除热路径旧完整 ROOT `validateLogicalSnapshot()`；提交后不再无条件完整 ROOT 重提取/重校验。
4. set / delete / 批量 array-insert / 批量 array-delete 全部走局部校验路径；批量整体一次判定（不逐元素）。
5. 行为等价（ADR-0007 L59 明文前置）：合法 base/mutation 上增量判定 ≡ 「构造完整 proposed ROOT 后全量校验」（SA6 A-6 28 场景绿锁定即该等价的执行形态）。
6. 随代码交付 E1–E4 文档修订 + follow-up 显式登记（§14）。
7. benchmark/instrumentation 证据（§15）：无公共 API 面、零墙钟断言、不把 #238 归因本 issue。

**非目标**（Owner 明示让渡，另票处理）：

- replication / 损坏存量 / 不可信恢复状态的全局合法性重建（ADR-0010 follow-up）。
- carrier validation 覆盖面审计与合法矩阵补齐（Owner 评论 2 §1/§6，正确性 follow-up）。
- 上层「同值重复写 / 五笔合并」的 origin/path instrumentation（MABF 集成方）。
- #238 replication apply/sequencer 分段延迟。
- lazy logical cursor / overlay（Owner 评论 2 §5「进一步优化」，局部投影被证明为瓶颈后再议）。

## 2. 现状管线与缺陷点（SA5 结论摘要，本设计的事实基础）

`applyValidatedMutation`（`mutation.ts:49-63`）当前对**每笔**普通写执行（★ = O(ROOT) 缺陷点，SA5 R1b 实测占单笔成本 ~96%）：

```
prepareMutation:
  L72  extractYjsSnapshot(derived, doc)      ★完整 ROOT 提取（walk 整树 + 拷贝）
  L74  validateLogicalSnapshot(derived, old) ★完整旧 ROOT 逻辑校验【R2 无关分支拒绝点】
  L77  cloneJson(ex.snapshot)                ★JSON.parse(JSON.stringify) 整树深拷贝
  L78  applyToJson（O(path)，模拟）
  L81  validateLogicalSnapshot(derived, proposed) ★完整新 ROOT 逻辑校验
  L83  prepareCommit：navigateLive（O(path)）+ buildDetachedValue（O(boundary)）✔已局部化
L57  transactGuarded 单事务最小 edit           ✔已最小化（a3e9266/#236）
L61  verifySnapshotIntact                    ★scratch doc 整 ROOT 重物化 + 双侧整树提取 + 全树比较
```

关键既有能力（本设计直接复用，不重造）：

- `walk`（`extract.ts:91`，@internal 包内接缝）：从任意 StructureNode 对 live 载体做**局部**投影提取，严格校验该子树内每个节点的 carrier（`mutation.ts:9` 已 import 该接缝供 `resolveNode` 消费——先例在位）。
- `walkUnion`/`trialMember`（`extract.ts:160/187`）：union 位置的成员试验仲裁（载体前置判定 + 必填在场软拒 + 声明序首个接受 + 全软拒回退成员 0）——确定性、局部。
- `validate-patch.ts`（vfsl）：结构守卫 `guardWalk`（节点集游走 `drillStep`）、§3.3 **边界五规则**、`rebuildOp`（计算键展开的拷贝式重建）、`finish`（`validateSubtree` + 绝对路径 rebase）。写路径当前零消费（SA5 grep 证据）。
- `validateSubtree`（`validate.ts:658`，vfsl 内部件）：与 `validateLogicalSnapshot` 同一解释器主体的子树入口（联合三段算法/预算/E100 全共享）。
- `buildDetachedValue` / `navigateLive` / `resolveNode` / `transactGuarded` / fatal 分类（E201/E203/E204/E205）：提交与错误面不动。

## 3. 语义定稿（phase-1 契约）

### 3.1 前置假设（写入 `applyValidatedMutation` 内部契约注释 + 测试前置，Owner 评论 1+2）

> 调用前 committed ROOT 已符合 active schema：**logical values 符合值语义 ∧ carrier topology 符合 `YArray`/`YMap`/plain/leaf 声明**。本函数负责证明**本次 mutation 不破坏其触达的 schema 约束**，不扫描、不复制、不校验 mutation 路径与边界之外的既存数据。

- 合法性建立点（不动）：create（ADR-0009 封闭校验完整 ROOT）、SCHEMA write/replaceSchema（ADR-0008 全量校验含载体证明）、`set([])` 整体替换（proposed 全量校验）。
- 归纳维持：合法基线 + 「本次写保持其边界合法」 ⇒ 写后全局合法（B-1/B-4 尾部全量校验绿锁定即该归纳的可观测锚）。
- **不建任何 baseline 状态机**：无 generation 计数、无 validity 缓存、无 document validation baseline（Owner 评论 1 明令；SA8 对照 9 no-conflict）。

### 3.2 声明语义反转（E3，SA6 A-2/B-3 必红锚）

| | 现行为 | phase-1 后（本设计） |
|---|---|---|
| 无关分支非法数据（如 `library[0].qty='x'`，写 `['target','value']`） | 旧 ROOT 全量校验拒绝（ADR-0010 L107 登记通道） | **ok:true**，无关分支原样保留（不发现、不修复、不扫描破坏） |
| **路径内**非法（中间容器缺失/载体违规/越界） | ok:false 零写入 | 不变（导航期响亮拒绝，A-4 绿锁定） |
| **边界内**非法数据（boundary 子树内既存非法值/载体） | 全量校验拒绝 | 不变（边界提取 + 边界整体过子 schema 拒绝，A-5 语义） |

### 3.3 边界定义（最近必要语义边界；对齐 validate-patch §3.3 五规则 × mutation 词表）

| # | 触发条件（按优先级，命中即止） | boundary 位置 | 重建/校验单位 | mutation 词表映射 |
|---|---|---|---|---|
| R1 | 路径首次**穿越** union 位（该 hop 的节点集展开含 union 且命中非空） | union 位（prefix = 穿越前路径） | 整个 union 值（重建后过 union 值 schema，any-of 仲裁） | set/delete/array-* 的路径中段穿过 union |
| R2 | set/delete 终段经 Record `<key>` 槽放行 | Record map 位 | 整个 Record（含 keyPattern 逐键 + 全值校验） | set/delete 动态键 |
| R3 | （validate-patch 原规则 3：终段为数组下标的 replace） | — | — | **词表不适用**：`set` 终段为数组下标属拒绝域（`applyToJson` placeSet 现行规则保持） |
| R4 | array-insert / array-delete 的目标数组位（若路径未更早穿越 union） | 目标 Y.Array 位 | 整个数组（**批量一次**重建：insert `values[]` / delete `count`，过数组子 schema——中间态不参与判定） | array-insert / array-delete |
| R5 | delete 终段（封闭 map 字段删除） | **父 map 位**（prefix = path 去终段） | 整个父 map（重建去键后过父 schema：必填缺失/keyset 即拒） | delete |
| R6 | 其余 set（封闭 map 声明字段 / optional 填充 / 整值替换 / leaf） | **目标位本身** | payload 过目标位子 schema（旧值不消费——set 是整值替换） | set |
| ROOT | `set []`（空路径） | ROOT | **唯一合法全量形态**：走现行完整管线不动（extract+双 validate+clone+verifyInstall+verifySnapshotIntact） | set([]) 管理面 |

要点：

- **R6 的 O(1) 性与旧值不读**：封闭 map 的 keyset 约束不可能被「写一个结构树已声明的键」破坏（未声明键在结构守卫期已拒，见 §6）；故 leaf set 无需提取/重建父对象。这是 set 与 delete 的不对称（delete 可制造「缺必填」，该约束活在父层），有语义依据而非性能投机（SA2 攻击点见 §17-3）。
- **R5 的退化上界**：顶层字段 delete / 顶层 Record set 的边界 = ROOT map——提取+校验 O(ROOT)。这是 issue 明文允许的「schema 语义要求更大上下文时安全退化到更高边界直至 ROOT」的合法形态，且常数远优于现状（1 遍提取 + 1 遍校验 + 1 遍边界验证，对比现状 ~7 遍 + 2 次整树物化 + scratch doc）。
- R1 优先于 R4：路径先穿 union 再到数组 ⇒ 边界 = union（与 validate-patch 现行边界定夺次序一致）。

### 3.4 行为等价引理（ADR-0007 L59 硬前置；SA2 主攻击面）

**L1（局部性）**：`walk(node, live)` 只读取 `live` 子树（map 按声明字段/Record 动态键、array 逐元素、plain 深拷贝；无跨子树读）。因此对任意边界位置 p：`walk(node_p, live_p)` ≡ `extractYjsSnapshot(derived, doc)` 在 p 处的子树投影（同一代码路径、同一仲裁）。

**L2（投影一致性）**：SA6 A-6 的 oracle 基线 = `extractYjsSnapshot` 产物（`jsonMirror(baseEx.snapshot, mutation)` 后全量校验）。由 L1，局部边界提取得到的 boundary base ≡ oracle 基线在边界处的子值。故「在 boundary base 上重建 + `validateSubtree(boundaryValueNode, rebuilt)`」与「oracle 在整树上全量校验」比较的差集只剩**边界之外的未修改部分**。

**L3（不变量局部化）**：VFSL v1 值语义不存在跨子树约束（object = 必填集合 + 封闭 keyset（对象内）；Record = keyPattern + 值（Record 内）；union = any-of（值内）；array = 元素（数组内）；无 cross-field/跨分支约束——`validate.ts` 解释器全景表 §4 逐 kind 可验）。在 phase-1 前置假设（界外既存数据合法）下：**proposed 全量合法 ⇔ proposed 边界子树合法**。三引理合并 ⇒ 决策等价；结果等价（成功写后的完整 doc ≡ oracle proposed）由提交面不动（同一最小 edit 代码）保证。

已知推论（非缺陷，登记给 SA2）：重叠成员 union（如 `A={x,y?}` 与 `B={x,z}`）下，extract 侧声明序仲裁可能以 A 视角投影（z 不进快照）——**oracle 基线同样是该投影**（A-6 的 jsonMirror 就跑在 extract 产物上），两侧一致，等价不破；最终裁决由 `validateSubtree` 的 values-tree any-of 重仲裁兜底（§6）。

## 4. 总体架构：新管线（doc-runtime 内部，公共面零变化）

```
applyValidatedMutation(derived, doc, mutation)            [签名/结果联合不变]
 ├─ S0  assertOutermostTransactionContext（不变，E202 面）
 ├─ S1  parseMutation（不变：信封四操作 + path/index/values/count 规整）
 ├─ S2  set([]) → 【legacy 全量管线】原样保留（管理/迁移面；A-6 空路径等价用例的现行为载体）
 └─ S3–S10 【新局部管线】（packages/doc-runtime/src/mutation-local.ts）
     S3  plan = vfsl.planMutationBoundary(derived, path, op)        §6.2
         结构守卫（节点集游走 + 边界定夺 R1–R6）——纯结构树，零 base 读
         拒绝 → ok:false（未知字段/终态下钻/段型错/数组目标结构前置/delete[] 等）
     S4  live 导航（沿 prefix 与全路径；唯一一次导航，提交复用其引用）
         每 hop：union → 试验仲裁定成员（walkUnion 同款纪律）；载体检查
         （map→Y.Map+string 段 / array→Y.Array+整数段+界内 / 终态即拒）；
         中间 hop 在场检查（get(seg)===undefined → 「不自动创建中间容器」拒）；
         终段按 op 定在场/形态规则（set 不要求在场；delete 要求在场；
         array-* 要求目标为 Y.Array——YPlainArray/Y.Map 冒充 → 拒，A-4）
         一切拒绝 = 领域 ok:false + 零写入（**载体违规不升格 E204 fatal**，§7.3）
     S5  边界提取（R1/R2/R4/R5 需要；R6 跳过）
         boundaryLogical = walk(boundaryStructureNode, boundaryLive, prefix, resolve)
         issue → ok:false（边界内载体/值域非法——响亮拒绝）
     S6  proposed = vfsl.applyMutationAtBoundary(derived, plan, boundaryLogical, mutation)  §6.3
         relPath 尺度的域规则（= applyToJson 现行域规则：不自动创建/不 clamp/
         拒 no-op/set 终段禁数组下标）+ 拷贝式重建（批量整体）+
         validateSubtree(boundaryValueNode, rebuilt) + 绝对路径 rebase
         → ok:false issues（A-3/A-5/A-6 失败面）
     S7  detached 构造（复用现行件，零新语义）
         re-rooted navigateLive：以 (boundaryLive, boundaryNode, boundaryLogical) 为根
         沿 relPath 导航取 parent/target live 引用（resolveNode 的 union 匹配以
         boundaryLogical 的对应下钻值为 logical 输入——算法原样，换根）；
         buildDetachedValue 构造 set payload / array-insert 各元素（逐元素构造
         属**安装构造**，非校验——校验已在 S6 整体判定）
     S8  transactGuarded(doc, commitPrepared)（不变：单 guarded transaction 最小 edit，
         Y.Map.set/delete 或 Y.Array.insert/delete；E203 包装不变）
     S9  边界级提交后验证（新 verifyBoundaryIntact，install-verify.ts 内部导出）  §8
     S10 return { ok:true }
```

导航/提取/校验/构造**全部先于事务**（Owner评论 2 §4：校验失败在触碰 live Y.Doc 前决定；无 write 后 undo）。

## 5. 「无关分支零访问/复制/校验」的构造性保证

- S4 导航只做 `get(seg)` 逐 hop 读取；S5 `walk` 只读边界子树；S6 只重建边界；S9 只重读边界。**不存在任何 ROOT 级遍历入口**（`extractYjsSnapshot`/`validateLogicalSnapshot`/`verifySnapshotIntact` 在非空路径管线中零调用——这正是 SA6 A-1 计数锚的 mechanically 满足方式：三 seam 分别被 `vi.mock('../src/extract.js')`、`vi.mock('@nomicore/vfsl')`（仅包 `validateLogicalSnapshot`）、`vi.mock('../src/install-verify.js')`（仅包 `verifySnapshotIntact`）包装计数；本设计消费的是 `walk`（extract.js 的另一导出）与 vfsl 新增导出/`validateSubtree`，均不在包装面内——计数恒 0，与规模无关）。
- B-4 的 8k `library`：`set ['target','value']` 边界 = R6 目标位（O(1)），library 的 Y.Array 引用只在导航 `get('library')` 时**不**发生（路径不含 library）——零触碰；identity/规模/内容断言全保。
- 成本模型（每操作）：R6 set = O(path)+O(1)；R1/R2/R4 = O(path)+O(boundary)×(提取+校验+验证)；R5 delete = O(path)+O(parent)；set([]) = O(ROOT)（不变）。

## 6. VFSL 复用/扩展精确方案（`packages/vfsl`，保持无 Yjs 依赖）

### 6.1 复用（零改动）

- `validateSubtree`（`validate.ts:658`）继续作为值校验段唯一来源（`finish` 同款消费）。
- `drillStep` / `structureLens` / `descendValues` / `rebuildOp` / `finish` / `run` 崩溃边界 / `normalizePath`：原样复用为共享内部件。
- **四个既有公共导出（`validatePatch` / `validateAppendToArray` / `validateInsertIntoArray` / `validateDeleteFromArray`）签名与行为逐字节不变**（`validate-patch.test.ts` / `validate-patch-sa7.test.ts` 全绿是硬前置；重构只允许「纯机械抽取共享 helper」，SA4 复核 diff）。

### 6.2 扩展一：`planMutationBoundary`（结构侧规划，新增公共导出）

```ts
// packages/vfsl/src/validate-patch.ts（就地扩展；index.ts 增补导出）
export type MutationBoundaryOp = 'set' | 'delete' | 'array-insert' | 'array-delete';

export interface MutationBoundaryPlan {
  /** 边界绝对位置（段数组）。 */
  prefix: Array<string | number>;
  /** 边界到目标的剩余段。 */
  relPath: Array<string | number>;
  /** 边界值 schema 节点（值树，已归一化：非 ref/非 optional）。 */
  node: ValueSchema;
  /** 边界种类（doc-runtime 据此决定是否提取边界值 + 提交后验证形态）。 */
  kind: 'union' | 'record' | 'array' | 'parent' | 'target';
}

export function planMutationBoundary(
  derived: DerivedSchema,
  path: Array<string | number>,
  op: MutationBoundaryOp,
): { ok: true; plan: MutationBoundaryPlan } | { ok: false; result: ValidateResult };
```

行为：`normalizePath`（非空）→ `guardWalk` 的**结构侧**（drillStep 节点集游走、union 穿越冻结、`targetHasArrayCandidate` 数组目标结构前置、终段段型规则：set/delete 终段须 string、`delete []` 拒）→ 按 §3.3 R1–R6 定夺 boundary（`kind` 判定：union 穿越→`union`；终段 Record 槽→`record`；array-* 目标→`array`；delete→`parent`；其余 set→`target`）→ `descendValues(derived.values, prefix)` 取 `node`。同步、纯函数、不抛错（`run` 收编 E100）；零 base 读。实现上从 `guardWalk` 抽出结构侧共享段（机械抽取，四旧导出行为不变）。

### 6.3 扩展二：`applyMutationAtBoundary`（边界尺度重建 + 校验，新增公共导出）

```ts
export interface BoundaryMutationPayload {
  op: 'set'; value: unknown;
} | { op: 'delete' } | {
  op: 'array-insert'; index: number; values: readonly unknown[];
} | { op: 'array-delete'; index: number; count: number };

export function applyMutationAtBoundary(
  derived: DerivedSchema,
  plan: MutationBoundaryPlan,
  boundaryBase: unknown,            // 调用方（doc-runtime）局部提取的边界逻辑值
  mutation: BoundaryMutationPayload,
): { ok: true; proposedBoundary: unknown } | { ok: false; result: ValidateResult };
```

行为（全部与现行 `applyToJson` 域规则逐条对齐——等价性的域规则面）：

1. relPath 逐 hop：容器形态（string 段→plain object；number 段→Array）+ 中间在场（`Object.hasOwn` / 界内）——拒绝文案域与 `placeSet/placeDelete` 现行语义一致（「不自动创建中间容器」「set 终态不支持数组下标」「delete 目标键不存在（拒绝 no-op）」「array-insert index 越界（不 clamp）」「array-delete 范围越界（不 clamp、不接受越界 no-op）」）。
2. 重建：`rebuildOp` 扩展三原语——`insert-batch`（`[...a.slice(0,i), ...values, ...a.slice(i)]`）、`delete-count`（`[...a.slice(0,i), ...a.slice(i+count)]`）、`remove-key`（计算键展开去键）。**批量一次重建**（`values[]`/`count` 整体；不逐元素独立校验——A-5 锚）。R6（`target`）跳过重建，直接以 payload 为 proposed。
3. 校验：`validateSubtree(values, plan.node, proposed)`，issue 按 `plan.prefix` rebase 为绝对路径（`finish` 同款）。
4. 返回 `proposedBoundary`（供 S9 提交后对照）。

公共面影响：vfsl `index.ts` 增补 2 函数 + 3 类型（**additive**；不触碰既有导出）。doc-runtime 经 `@nomicore/vfsl` 公共入口消费（包边界纪律不变）。vfsl 头注补 issue #237 段落。

### 6.4 不做

- 不给 vfsl 引入 Yjs/carrier 概念（Owner 评论 2 §2 分层：carrier 校验留在 doc-runtime；SA8 对照 6 no-conflict）。
- 不改 `validateLogicalSnapshot` / `validateSubtree` 语义。
- 不在 doc-runtime 重复实现 schema 解释（结构守卫/边界规则/值校验全部单源于 vfsl）。

## 7. doc-runtime 改造清单

### 7.1 `mutation.ts`（重构编排层）

- `applyValidatedMutation`：S0/S1 不变；`set && path.length===0` → 现 legacy 管线原样（含 `verifyInstall` + `verifySnapshotIntact`）；非空路径 → 委托 `mutation-local.ts`。
- `parseMutation` / `commitPrepared` / `transactGuarded` 调用 / fatal catch 结构（E204/E205 分类）保留。
- `navigateLive` / `resolveNode` / `childNodeOf` / `logicalValuesEqual` / `carrierCompatible`：保留并导出给 `mutation-local.ts` 复用（包内 @internal，先例：extract.ts 的 walk 接缝）。`resolveNode` 的 union 匹配在换根导航中继续以「trial walk + logical 等值」消歧——logical 输入改为**边界提取值的对应下钻**（算法零改动）。

### 7.2 `mutation-local.ts`（新内部模块，非公共面）

S3–S7 + S9 编排（§4）。导航仲裁与 `walkUnion` 纪律一致（声明序、载体前置、必填软拒、成员 0 回退）；一切 live 状态异常 = 领域 issue。

### 7.3 错误分类表（不变量的关键——零写入面与 fatal 面的分界）

| 发现点 | 分类 | 现行为对照 |
|---|---|---|
| 结构守卫拒绝（未知字段/终态/段型/数组目标非 array 结构） | ok:false | 经 full validate/`prepareCommit` 拒 → 同 |
| 导航载体违规（Y.Map↔Y.Array 冒充等，A-4） | **ok:false（领域）** | 现为 extract issue → ok:false（A-4 现绿）。注意：现行 `navigateLive` 对同类事实抛 `DerivedInvariantError`→E204，但其可达序在 extract 之后（不可达）；新管线导航是第一载体防线，**必须归领域 issue**——E204 保留给手造派生物（结构/值树畸形） |
| 边界提取 issue（边界内载体/值域非法） | ok:false | 现为 extract/validate issue → 同 |
| relPath 域规则拒绝（缺失/no-op/越界/clamp 拒绝） | ok:false | `applyToJson` 同款 |
| 边界值校验失败 | ok:false issues（prefix rebase 绝对路径） | `validateLogicalSnapshot` proposed 同 |
| detached 构造失败 | ok:false | 不变 |
| 手造派生物（structure 非 root/ref 环/缺名/两树分歧） | E204 pre-commit-internal（committed:false） | 不变 |
| 信封/value 读取面意外异常（Proxy 等） | E205 ok:false | 不变（SA7 2② 面） |
| 事务内 observer 抛错 | E203 committed:true | 不变（transactGuarded） |
| S9 边界偏离/验证未能运行 | **E201 变体 C/D，committed:true** | 语义同族、范围收窄到边界（§8） |

### 7.4 `install-verify.ts`（内部扩展）

新增 `verifyBoundaryIntact(input)`（不进 index.ts）：见 §8。`verifyInstall` / `verifySnapshotIntact` 原样保留（set([]) legacy、materialize、replace 继续消费——SA7 2③ 的 materializeRoot ⑥ 面不动）。

### 7.5 公共面

`packages/doc-runtime/src/index.ts` **零改动**（`doc-runtime-surface.test.ts` / `public-surface-guard.test.ts` 全绿前提）。namespace-runtime **零源码改动**：`write.ts` S1–S7、`mutateData` 联合、sequencer、snapshotter 全不动（B-1/B-2 直接透传）。

## 8. 边界级提交后验证（替代无条件 ROOT 校验；fatal 不削弱）

`verifyBoundaryIntact({ derived, plan, boundaryLive, boundaryStructureNode, proposedBoundary, commit })`：

1. **安装事实核**（O(1)，verifyInstall 同款 identity 纪律）：set → `parentLive.get(key) === builtDetached`（yjs 按引用存储，同值重插不误报）；delete → `!parentLive.has(key)`；array-insert → `target.length === before + values.length`；array-delete → `target.length === before - count`。
2. **边界重投影核**（O(boundary)）：`walk(boundaryStructureNode, boundaryLive, prefix, resolve)` 重提取 → 与 `proposedBoundary` 深比较（`logicalValuesEqual`/`deepEqualValue` 同款语义；XML 走 canonical 同款）。
3. 偏离 → `DocRuntimeFatalError('post-commit-verification', true, E201 变体 C)`（措辞沿用「写入已提交，不回滚、不补偿」；detail 报边界 path + 两侧摘要）；核自身异常/无法运行 → 变体 D（防线未能运行，绝不假成功）。**不重新过 schema**（pre-commit 已证 proposed 合法；本核证明 installed ≡ proposed 的 internal invariant）。
4. 对抗性双读（SA7 重点 4 (F)(G) 面）：value 在校验读与构造读两次消费可能发散——installed（构造产物）≠ proposed（校验侧物化）→ 落 3 的变体 C，loud 不假成功（与现行 `verifySnapshotIntact` 对该向量的处置同形）。
5. 范围声明（E1 措辞）：提交后验证不再覆盖**边界外** observer 干扰——该检测面随全量校验一并收窄（声明语义，非静默）。

## 9. 不变项清单（修复后不得回归；SA6 绿锁定 ↔ 机制映射）

| 不变项 | 机制 | 锚点 |
|---|---|---|
| 公共 interface/结果联合 | 编排层签名/联合零改动 | B-1 |
| 严格 FIFO / 槽序 S1–S7 | namespace-runtime 零改动 | B-1/B-2 |
| 校验失败零写入/零 dirty/零事件/槽不中毒 | S3–S7 全部先于事务；失败只走 ok:false | A-3/B-2 |
| 失败先于 live 写（禁 undo） | 同上；无任何「先写后验」路径 | A-3/B-2 |
| 单 guarded transaction / 最小 edit | S8 = 现行 commitPrepared + transactGuarded | A-1/B-1/B-4 |
| carrier identity（目标与无关） | 只 set/delete 目标键或 insert/delete 数组段 | A-1/A-5/B-1/B-4 |
| 每笔成功恰 1 dirty + 1 owned update | S6 槽序不动（write.ts:158） | B-1/B-4 |
| 批量整体判定 | S6 批量重建后整体过子 schema | A-5 |
| union/Record/optional/数组/嵌套引用等价 | L1–L3 + A-6 28 场景 | A-6 |
| 退化到 ROOT（schema 要求） | set([]) legacy + R5/R1 上界 | A-6 空路径 |
| fatal 分类（E201/E203/E204/E205）不削弱 | §7.3 表 + §8 | 既有 fatal 族 |
| create/replaceSchema 全量合法性建立点 | 不在改动面 | 既有族 |

## 10. 热路径计数锚的满足方式（A-1 必红 → 绿）

非空路径管线中：`extractYjsSnapshot`=0（用 `walk`）、`validateLogicalSnapshot`=0（用 vfsl 新接缝 → `validateSubtree`）、`verifySnapshotIntact`=0（用 `verifyBoundaryIntact`）。三个被 mock 包装的模块导出一律不进入调用图；mock 的 `...mod` 透传不计数其余导出。**计数与 ROOT 规模无关、零墙钟**（SA6 红灯纪律）。

## 11. 测试与验收映射（45 锚点）

| SA6 锚点 | 设计机制 | 修绿后状态 |
|---|---|---|
| A-1 set（必红） | §10 三 seam 零调用 | 绿 |
| A-1 delete+批量（必红）* | 同上（**见 §12 契约缺陷：delete 腿需先修订 SA6 fixture**） | 绿（修订后） |
| A-2（必红） | R6 边界不含 library；旧 ROOT 校验已删 | 绿 |
| B-3（必红） | 同 A-2（mutateData 级） | 绿 |
| A-3/A-4/A-5/A-6、B-1/B-2/B-4（41 绿锁定） | §9 机制 | 保持绿 |

SA3 完成后运行面：两红灯文件 + doc-runtime 全部既有测试 + vfsl 全部 + namespace-runtime 聚焦（sequencer/fatal/persistence/public-surface）+ 根级 `pnpm typecheck` + `pnpm test`（issue AC 终项）。

## 12. ⚠️ SA6 契约缺陷登记（SA3 前必须处置——本设计实证发现）

**A-1 第二用例的 delete 腿不可满足**：fixture `TEXT_LIB_ITEM` 中 `target: { value: number }` 的 `value` 是**必填**字段；`r3 = delete ['target','value']` 断言 `expect(r3.ok).toBe(true)`。实证（本工作区，2026-09-06）：

```
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec tsx -e "…delete ['target','value']…"
delete target.value => {"ok":false,"issues":[{"message":"缺少必填字段 \"value\"","path":["target","value"]}]}
```

且 A-6 绿锁定用例「delete 存在键」（同形 schema）经 oracle 锁定该决策为 **ok:false**（proposed 缺必填 ⇒ oracle 拒绝 ⇒ 增量必须拒）。二者直接矛盾：**任何保持行为等价的实现都无法让 A-1 第二用例的 `r3.ok` 为 true**；当前该用例红在 r1 计数锚（r3 从未执行，缺陷处于潜伏态），SA3 修绿热路径后将在 `expect(r3.ok).toBe(true)` 处转為永久红——「4 必红转绿」不可达。

**处置（建议，最小修订）**：把该用例 delete 腿改为可删除目标——fixture 增 optional 字段（如 `type ROOT = { target: { value: number; note?: string }; library: YArray<Item> }`，r3 改 `delete ['target','note']` 并断言 `readNote(doc)).toBeUndefined()`），或 r3 改为 Record 动态键 delete。计数锚与用例数不变（仍 3 必红于 doc-runtime 文件）。该修订属 SA6 契约文件自身的缺陷修复（红因登记错误，非语义变化），由 SA3 随实现一并交付并在 SA4 复核时单列说明；**不允许**以「让 delete 接受删除必填字段」来满足该断言（会击穿 A-6 与 operations 既有用例「delete rejects required fields」）。

## 13. 既有测试面影响登记（随语义演进必须修订，E1/E3 授权）

| 文件 | 用例 | 现期望 | 新语义下 | 处置 |
|---|---|---|---|---|
| `apply-validated-mutation-fatal-contract.test.ts` | 「ROOT 已损坏（逻辑不合法）→ 普通 mutation 失败」（损坏 `count`，写 `['title']`——**路径/边界外**） | ok:false | **ok:true**（R6 边界=title 位，count 不被读） | 按 E1/E3 修订：改为**边界内**损坏形态保持 W5 意图（领域失败不入 fatal 通道）——建议 fixture 改为数组边界（`YArray<Item>` 内 `qty` 损坏 + 对该数组 array-insert → 边界整体校验拒），或中间载体损坏（A-4 形态）。修订时在用例注释引用 Owner 2026-09-05T16:01Z + ADR-0007 修订节 |
| 其余 doc-runtime / namespace-runtime / vfsl / ws-replication 既有族 | — | — | 全绿预期 | 不改动；SA4 全量跑 `pnpm test` 验证 |

SA6 AC 表 #13 把 fatal-contract 文件列为绿锁定回归锚——其**fatal 契约面**用例（observer 抛错 E203、exact identity、不虚假回滚）在本设计下不变绿转；仅上列 1 个领域用例属被 Owner 授权演进的语义面，需如上修订。此点提请 SA2 重点裁决措辞边界。

## 14. 文档义务 E1–E4（随代码交付；SA8 门禁登记的强制项）

模式：按仓内「owner 授权 + 显式修订节」先例（ADR-0006 #64/#79、ADR-0008 #93/#132），各文件追加 `## 修订（2026-09-XX，issue #237）` 节，引用授权链（issue #237 Owner 三评论 + `1c8b907` 先行修订 + ADR-0007 L59 后果句预告）。

- **E1 `docs/adr/0007-logical-validation-and-yjs-runtime-bridge.md`**（修订 L27 管线句 + L37 损坏句 + L59 后果句）：
  - 管线句改写为：非空路径 mutation = 「沿 live carrier 与 derived structure 导航（逐跳载体校验）→ 最近必要语义边界局部提取（union 穿越位 / Record 位 / 数组位 / delete 父位 / set 目标位）→ detached 重建与边界级 proposed 校验（复用 vfsl validate-patch 家族）→ 单 guarded transaction 最小 edit → 边界级提交后一致性验证」；
  - 新前置假设条款（§3.1 原文入 ADR）；`set([])` 保持全量形态；
  - 损坏条款收窄：「mutation 路径/边界内损坏仍响亮失败（ok:false 零写入）；路径/边界外既存非法数据不再被普通写发现（声明的语义让渡，合法性重建另票，见 ADR-0010 follow-up）」；
  - 后果句更新成本模型：普通写成本 ≈ O(path depth + boundary size)；保留「行为等价测试」硬前置表述。
- **E2 `docs/adr/0008-…`**（L69 ROOT write 段）：镜像句同步为「按 ADR 0007 的 validated mutation 管线沿路径导航并校验最近必要语义边界……事务后验证受影响边界与预期一致」；**其余不动**（槽序、active schema at slot、非空路径不重建完整 ROOT、SCHEMA write 全量、fatal、封装边界、status 观测面）。
- **E3 `docs/adr/0010-…`**（L107 §Trusted raw update）：后备句改写为「后续普通业务写按路径级/边界级校验：触达路径/边界内的非法数据仍会被响亮拒绝；触达面外的非法数据不再被普通写发现」+ **显式 follow-up 登记**（不得静默留白）：(a) replication / 损坏存量 / 不可信恢复的合法性重建机制另票；(b) carrier validation 覆盖面正确性审计（Owner 2026-09-05T16:08Z §1/§6 的六项核实清单方向：extract/verify 各路径的 carrier 检查职责、P0/load/replace/raw apply/恢复的合法性建立点、YArray/plain/YMap/plain-object/leaf/XML 载体合法矩阵测试）。
- **E4 `CONTEXT.md` 词条**：「逻辑快照校验」——用法清单删除 ordinary 写入前校验（改「创建前校验、SCHEMA replacement/迁移后体检、管理端点与测试共用；ordinary write 用路径级/边界级校验」）；「复制未校验」——后果句同步 E3 收窄；「载体投影读取」——不变量维持职责注明以 phase-1 前置假设为条件（归纳维持：合法基线 + 边界合法 ⇒ 全局合法）；「重建校验」补边界五规则 × mutation 词表交叉引用（可选）。
- **follow-up 注册面**（issue 关闭说明/报告层，不入 ADR 正文）：上层同值重复写/五笔合并需 MABF 集成方 origin/path instrumentation 另行确认；#238 独立调查，本票证据不归因。

## 15. benchmark / instrumentation 计划（Owner 2026-09-06T02:55Z）

1. **入仓锚（确定性、零 flake）**= SA6 A-1 计数锚（规模无关）+ B-4（8k×5 笔：ok×5、notify=5、update 事件=5、<256B/笔、carrier identity/规模/内容零触碰、尾部全局合法）。30s 周期压缩为紧邻调用（写路径无墙钟依赖）；**零墙钟断言进 CI**。
2. **证据运行（不入仓）**：SA3 以 SA5 同款 throwaway harness（`.mabf-bg/`，gitignore）重跑 R1/R3 场景（1k/8k/16k/64k 无关条目 × 单笔 set 与五笔连写），记录优化前后每笔 elapsed/heap 对比与「完整 ROOT 投影次数=0」计数旁证，写入交付报告（wiki/raw）。对比项含 sequencer 占用定性说明（槽内领域校验时长收缩）。
3. **边界纪律**：instrumentation 不新增公共 API/事件订阅/导出面（测试内 seam 与 throwaway harness 除外）；报告不把 Peer apply 2–11s 阶梯归因本票（#238 专属），仅引用 `ws-replication-issue230-incremental-mutation.test.ts` 冻结的 wire 计数对照。

## 16. 协议层假设与证据（Any protocol-level assumptions → evidence）

| # | 假设 | 证据 |
|---|---|---|
| P1 | wire 行为唯一权威 = `docs/protocols/instance-replication-v1.md`；5 笔小写 = 5 update-sent/acked/applied、零 resync | ADR-0010 L「wire 契约唯一权威」句；`packages/ws-replication/test/ws-replication-issue230-incremental-mutation.test.ts`（冻结测试） |
| P2 | 严格 FIFO 与槽序不变：applyValidatedMutation 在槽内 S5 同步执行、`await notifyDirty()` S6 | `packages/namespace-runtime/src/write.ts:4-11`（槽序注释）、`:143`（S5 调用点）、`:158`（S6）；本设计对 write.ts 零改动 |
| P3 | 每笔成功恰 1 次 Yjs transaction、owned update 29–33B 量级不随 ROOT 放大 | `mutation.ts:57` transactGuarded；`apply-validated-mutation-operations.test.ts`「each incremental operation commits through exactly one Yjs transaction」；SA5 R3 实测 |
| P4 | 校验失败零写入、禁止先 apply 后回滚（Yjs 无通用事务回滚；observer/replication 可能已见中间态） | ADR-0007 失败边界；ADR-0010 L107 后半句；CONTEXT「零写入」；Owner评论 2 §4 |
| P5 | `saveDoc` = 脏通知（非同步落盘）；事务原子性由 Y.transact 保证 | ADR-0006（#64/#79/#133 修订后文本）；`write.ts` S6 |
| P6 | extractYjsSnapshot 当前**确实**严格校验结构树各节点载体（Owner评论 2 §1 的疑点在本仓现状=已覆盖于 extract 面） | `extract.ts:100-152`（map/array/xml/leaf/plain 各 kind 的 carrierOf 判定 + mismatch issue）；A-4 用例现绿即证；覆盖面**审计**仍登记 follow-up（§14 E3） |
| P7 | active schema 取槽开始时 tools，不绑定 generation；P0 不是合法性建立点 | ADR-0008 L65；CONTEXT「P0」词条；本设计不引入任何跨调用校验状态 |
| P8 | yjs 语义：`Y.Map.get` 缺键返回 undefined；`Y.Array.length` O(1)；set 按引用存储（identity 可核） | 仓内既依赖（`verifyInstall` L56-68 identity 纪律及注释 A19/G5 实证） |

## 17. 风险与开放问题（SA2 攻击面清单）

1. **等价引理 L3 的完备性**：「VFSL v1 无跨子树约束」——请 SA2 对照 `validate.ts` 解释器与 `derived.ts` 值树形态逐 kind 复核（尤其 Record keyPattern、union 判别式缓存、optional present 语义、xml 良构）。
2. **换根 navigateLive 的 union 消歧**：logical 输入改为边界提取值下钻——与全量快照下钻值在 L1/L2 下同一；重叠成员投影语义见 §3.4 推论。
3. **R6（set 目标位）与 R5（delete 父位）的不对称**：性能不对称有语义依据（§3.3 要点）；但意味着「顶层字段 delete」退化为 O(ROOT)——是否可接受属 Owner 已授权的退化上界（issue 建议设计明示允许）。
4. **旧目标位载体不读（R6）**：set 整值替换不校验被替换旧值载体（修复语义）；中间载体违规仍拒（A-4）。无锁定测试覆盖旧目标位载体违规——SA2 裁决是否需补锚（建议：绿锁定补一条「set 替换损坏载体位 = 修复成功」或在 E1 措辞中显式声明）。
5. **导航期载体违规的分类降级**（§7.3：E204 不可达序消失后归领域 issue）——与 A-4 现绿行为一致，但改变了 `navigateLive` 异常面文档语义；SA4 复核注释与 E1 措辞同步。
6. **边界重投影核的成本**：array 边界提交后 O(array) 重读——与校验同界；对 8k 数组批量操作即 2×O(array)。可接受（远小于 O(ROOT)×7）；若 SA2 认为过重，可降级为「安装事实核 + 首末元素 spot check」——本设计默认保守（完整边界核）。
7. **SA6 A-1 第二用例缺陷**（§12）与 **fatal-contract 领域用例修订**（§13）——两处测试面修订的合法性与最小性请 SA2 裁决。
8. **vfsl 公共面 additive 扩展**：`planMutationBoundary`/`applyMutationAtBoundary` 成为长期公共契约（命名/形状定稿后不易改）；请 SA2 评审签名与 `kind` 枚举是否足以承载后续 lazy-cursor 演进（Owner评论 2 §5）而不破面。

## 18. SA3 实现顺序建议

1. vfsl：抽取 `guardWalk` 结构侧共享段（四旧导出回归绿）→ 新增两接缝 + 单测（边界五规则 × 四操作、批量整体、rebase、E100 面）→ `pnpm --filter @nomicore/vfsl test`。
2. doc-runtime：`mutation-local.ts` + `verifyBoundaryIntact` + `mutation.ts` 编排切换（set([]) legacy 分支保留）→ 两红灯文件转绿（先按 §12 修订 A-1 delete 腿 fixture）。
3. 既有面：§13 fatal-contract 用例修订；全量 `pnpm typecheck` + `pnpm test`。
4. 文档 E1–E4 + follow-up 登记；§15 证据运行入报告。
5. SA4 复核重点：vfsl 四旧导出 diff 零语义变化、错误分类表逐行对照、A-6 全绿、公共面三包守卫绿。

## 19. 设计证据（本次设计期间实际读取/运行）

- 读取：`packages/doc-runtime/src/{mutation,install-verify,extract,detached-build,read,resolve,carrier,fatal}.ts`、`src/index.ts`；`packages/vfsl/src/{validate-patch,validate}.ts`、`src/index.ts`（导出面）；`packages/namespace-runtime/src/write.ts`；三包 AGENTS.md；测试：SA6 两红灯文件全文、`apply-validated-mutation-{operations,fatal-contract}.test.ts`、`public-surface-guard.test.ts`、`sa7-fatal-dynamic-verify.test.ts`（用例清单与 2③ 细节）；`docs/adr/0007/0008/0010` 相关条款行；`CONTEXT.md` 词条行；issue #237 正文与 Owner 3 评论（gh CLI 全文）。
- 运行（只读，零源码改动）：SA6 doc-runtime 红灯套件（本工作区复跑：41 tests = 3 failed【必红】+ 38 passed，红因与 SA6 记录一致：A-1×2 计数锚 extract=3、A-2 ok:false）；`delete ['target','value']` 行为探针（§12 引用输出，tsx + nomicore-source 直读 src）。
- 关键行号锚：`mutation.ts:8,49,57,61,72,74,77,81,83`；`install-verify.ts:44,122-169`；`extract.ts:53,91,160,187`；`validate-patch.ts:111,301,429-461,522,611-686`；`validate.ts:598-660`；`write.ts:83-172`；ADR-0007 L27/L37/L59；ADR-0008 L65/L69；ADR-0010 L107/L198/L241/L277。
