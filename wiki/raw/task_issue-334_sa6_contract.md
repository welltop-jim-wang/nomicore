# SA6 验收契约 — task_issue-334（形状预算 T1：载体投影读取三参化与截断省略）

- **Task type**：**Feature（能力缺口）** —— 不是 Bug 根因修复；本轮证明「三参形态 + 预算递归 + 截断事实通道」这一能力在 HEAD 上整体缺失，并给出下游可直接机械执行的目标行为验收契约。
- **Issue**：welltop-jim-wang/nomicore #334（parent PR #332 / ADR-0024；tracking issue #331）
- **SA6 迭代 0（契约初版）**：mabf-sa6，dispatch `sa-907442dc-e0bc-4ca6-a584-9a531a113440`，phase acceptance-contract——能力缺口证明 + 可执行契约（生产零改动）。
- **SA6 迭代 1（本版，原位修订）**：mabf-sa6，dispatch `sa-341c9d32-be17-44db-9595-3c851a225d38`，仅裁决 SA3 实现报告 §7 记录的**唯一矛盾**：SA6 §12.7 S19④ 的 detached 容器「raw 子项数 1」前提与 Yjs 语义、S21 反证互斥。本版钉死 **detached 容器 `d===0` 折叠口径（B16/R9）**、同步修订 S19④/O-1 断言（`packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts`）与相关解析项；**不修改生产实现**，其余已批准要求逐条原样保留（见 §0.1「保留面」）。
- **HEAD**：`ba11f328ae845bf882d131a2098a7afc8dfcc17c`（branch `mabf/issue-334`；SA3 实现以未提交工作区形态在位，`git diff` 仅 §10 允许文件）。
- **产出**：本文件（固定报告）+ 上述测试文件内 S19④/O-1 两条断言与夹具注释的同步修订（契约的机械形态；路径与 §10 ALLOW/§12.9 一致）。
- **Verdict**：**approve**（矛盾已裁决为唯一口径：detached 容器 `d===0` = 同形空容器 + rawTotal 0 + 无条目，展开/保留物化才响亮失败；契约可执行、测试入口真实、负控不受影响；唯一待办是 SA3 按 B16④ 施加 2–4 行 `budgetFold` 短路，见 §15 A-1）

---

## 0. 裁决摘要

| 问题 | 结论 | 依据 |
|---|---|---|
| 能力缺口是否真实存在 | 是，运行时 + 类型层双面缺口 | §5/§9：第三参在类型层 TS2554、运行时静默忽略；非法 options 静默接受；零物化哨兵今日必然失败 |
| 是否可稳定复现 | 是，3 次重复逐字节一致 | §7：runtime probe ×3 sha256 相同 |
| 旧实现在目标断言处是否失败 | 是，且失败原因是「无预算/无截断通道」本身，不是环境/fixture/入口 | §9/§13 |
| 契约是否可执行 | 是，全部断言锚定公共接缝可观测行为/类型投影 | §12 |
| 测试入口是否真实 | 是，vitest include 已实证发现拟新增路径 | §14 |
| 基线是否干净 | 是，doc-runtime 24 文件/374 测试全绿 + `tsc` exit 0 | §4 |
| 是否有阻塞未知 | 无 | §15（SA3 §7 矛盾已由本版裁决；仅列需 SA1/SA3 承接的解析项，均已给出契约口径） |

### 0.1 本轮裁决：detached 容器 `d===0` 语义（消解 SA3 §7 唯一矛盾）

**矛盾陈述（SA3 §7.1，已独立复现）**：§12.7 S19④ 原钉死「detached `Y.Map` 先 `set('k',1)` 使其 raw 子项数 1」→ 折叠条目 `omitted 1`；而 §12.7 S21 要求同一实例在 `depth:2` 展开时 `PATH_NOT_ALLOWED`（前提 `doc === null`）。Yjs 13.6.32 公共 API 下两者互斥：未集成容器的全部公共读数（`size`/`length`/`keys()`/`toArray()`/`toJSON()`）**恒为空**，prelim 内容只在内部 `_prelimContent`；`size ≥ 1` ⟺ 已集成（`doc !== null`）⟹ S21 前提失效（§5.4 逐字证据）。

**裁决（唯一口径，B16/R9）**：

| 项 | 裁决 |
|---|---|
| 折叠是否发生（`d===0`） | **发生**（B15 不变）：detached Yjs 容器首先是「容器」，不被 detached 守卫拦截 → 同形空容器 `{}`/`[]`（与判据前置一致：折叠处不允许触碰子项内部） |
| raw 子项数（count 口径） | **契约定义 `rawTotal := 0`**：detached 容器没有**文档可观测**子项；prelim 内容不是文档状态、不是公共 API。**不得**以 `_prelimContent` 等内部字段计数（§12.12 否决） |
| 公共 count 读 | **零执行**：折叠 detached 实例时不得读 `size`/`length`/`keys()`/`get`/`toJSON`——yjs 对未集成类型的这些读报 `Invalid access: Add Yjs type to a document before reading data.`（返回 0 是回退而非语义值），契约不依赖该回退 |
| 断言形态 | `read(doc,['holder'],{depth:1})` → `{ok:true, value:{ys:{}}, truncated:false, truncations:[]}`（**无 depth 条目**）；detached `Y.Array` 同形（`{ys:[]}`）；目标入口 `['holder','ys'],{depth:0}` 同款（SA2 O-1 的折叠读法落形） |
| 展开/保留（`d ≥ 1`） | **现行响亮失败面原样**：`['holder'],{depth:2}` / width 保留槽位物化 → `PATH_NOT_ALLOWED`（S21/NC-2/NC-8 不变）——与折叠读共同构成 B16 的对称钉死 |
| 判据边界 | detached 判据沿用现行 R2 #2：`instanceof Y.AbstractType && doc === null`。**跨 doc 集成容器（`doc !== null`）不属 detached**，计数/展开行为逐字不变（T1 不改）；detached 非容器（`Y.Text`/`Y.XmlFragment`/未知 shared）不入折叠，走 B2 终态 no-op + 现行守卫 |

**保留面（本版零改动）**：§12.1 类型面/§12.2 校验矩阵/§12.3 B1–B3、B6、B7、B9–B15 语义/§12.4/§12.5/§12.6 冻结面/§12.7 除 S19④·S21 加严外的全部 S 场景/§12.8 NC-1…NC-6/§12.9 路径/§12.10 E1–E10/§12.11 R1–R8/§12.12 既有否决项——逐条原样（B4/B5/B8/B15 仅追加 detached 例外指引，非 detached 语义不变；S21 仅追加 `holderArr` 同形断言）。

---

## 1. Task type and inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-334.md` | 已在位（issue body + 5 条 AC；零评论） |
| SA8 conflict-gate 产物 | `wiki/raw/task_issue-334_conflict_report.md` | 已在位（verdict clear；D-1/D-2/D-3；requiresConflictRecheck=true） |
| SA1 设计 | `wiki/raw/task_issue-334_design.md`（§7.2 折叠槽位表、§7.3 B15/O-1、§8 编排、§11 ALLOW/DENY） | 已在位 |
| SA2 设计评审 | `wiki/raw/task_issue-334_sa2_review.md`（approve；O-1 = detached 目标 + `depth:0` 折叠先后观察） | 已在位 |
| SA3 实现报告（本轮直接输入） | `wiki/raw/task_issue-334_sa3_impl.md`（verdict reject；唯一红 = §7 S19④ 矛盾；其余 502/503 绿、root typecheck exit 0） | 已在位，本版逐条复核 |
| 决策摘录 | `wiki/raw/task_issue-334_relevant_decisions.md` | 已在位 |
| 直接治理 ADR | `docs/adr/0024-readdata-shape-budget.md`（accepted；决策 1/2/3/6 + 验收节「载体单元」条） | 已入库 |
| 基线行为锚 | `packages/doc-runtime/test/read-logical-value-at-path-{schema-independent.test.ts,schema-independent.test-d.ts,guards.test.ts}`、`public-surface-guard.test.ts`、`public-surface-type-guard.test-d.ts`（后两处仅 SA3 加法锚） | 全绿，不得修改（SA3 加法锚除外） |
| 现行实现（SA3 落地） | `packages/doc-runtime/src/read.ts`（新增 `budgetFold` L578-582、`projectValue` 折叠前置 L534-545、detached 守卫 L546-550）；`packages/doc-runtime/src/index.ts`（仅加法类型导出） | 已逐行核对；与设计零偏移，唯一待办 = B16 短路 |
| Issue 评论快照 | REST 读评论成功、**零评论** | 无 Owner override 需应用 |

任务范围（简报 What-to-build + ADR-0024 决策 6）：只做 **doc-runtime 载体单元（值通道）** 切片——三参 `readLogicalValueAtPath(doc, path, options?)`、预算在投影递归内生效、截断省略 + 截断事实随结果返回、非法 options 新失败分支、无 options 逐字节不变。**不触碰** runtime `readData` 五键修订（决策 4）、`resolveSchemaAtPath`/投影包装（决策 5）、`DeepOptional` 类型面（决策 7）、registry/文档负控/协议面。

## 2. Owner comment mapping

| 项 | 内容 |
|---|---|
| 评论快照 | REST 读成功、零评论（comment IDs: none） |
| Owner override | 无——无任何要求需要应用或映射 |
| 影响 | 契约完全由 ADR-0024（已接受）+ 简报 AC1–AC5 + SA8 约束推导，无外部偏好输入 |

## 3. SA8 constraints（必须承接的门禁结论）

SA8 裁决：implements-existing-decision ×5、no-conflict ×9、hard-conflict ×0、evolution-required ×0；**clear 放行**。本契约承接其全部冻结面与开放注记：

| SA8 项 | 内容 | 本契约落点 |
|---|---|---|
| §4 冻结面（无 options 两键成功形态/缺席吸收/零 throw/`PATH_NOT_ALLOWED` 码域/终态语义/值域纪律/ValueSchema 不扩展/公共面经 index.ts/surface guard/越界零接触） | 逐项不变 | §12.6 F1–F14；§12.8 负控 |
| §8 D-1 | doc-runtime 结果联合如何携带截断事实（AC2 可组合 / 无 options 逐字不变 / 新失败分支不借路径码） | **§12.4 解析并钉死** |
| §8 D-2 | options 校验失败边界（定序、零 throw/E100 覆盖、失败分支字段构成） | **§12.5 解析并钉死** |
| §8 D-3 | 实现后按 §4 冻结面逐项复查 | §12.10 E6/E7 证据清单 |
| §8 N-1/N-2 | ADR-0008/0016 镜像节、CONTEXT 词条补句（非阻塞 docs 债） | 非 T1 义务；§15 |
| §10 | requiresConflictRecheck=true（公共 API + 失败语义面） | 本契约维持 **true**（§15） |

## 4. Environment and baseline

**环境**（可复现证据）：

| 项 | 值 |
|---|---|
| worktree | `/home/wangjian/nomicore-fix-issue-334` |
| HEAD / branch | `ba11f32…` / `mabf/issue-334`；起点 `git status` 仅 3 个 untracked wiki 输入 |
| node / pnpm | v24.13.0 / pnpm 10.28.2（`pnpm install --frozen-lockfile --offline`，store 复用，exit 0） |
| typescript / vitest / yjs | 5.9.3 / 3.2.7 / 13.6.32 |
| tsconfig 关键开关 | `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `moduleResolution: bundler`, `customConditions: ["nomicore-source"]`, `noEmit` |
| 测试入口 | `pnpm test` = `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck` |

**基线全绿证据**（改动前，HEAD）：

```
$ NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/doc-runtime
 Test Files  24 passed (24)
      Tests  374 passed (374)
Type Errors  no errors

$ npx tsc -p packages/doc-runtime/tsconfig.json
exit 0
```

其中冻结读锚 3 文件 **75 tests passed**（`read-logical-value-at-path-schema-independent.test.ts` 33、`…guards.test.ts` 39、`public-surface-guard.test.ts` 3），类型锚 `…schema-independent.test-d.ts` 4 tests 无类型错误。

**基线关键形状事实**（后续回归锚）：

- 现行成功面恰两键：`Object.keys(readLogicalValueAtPath(doc,['title']))` = `["ok","value"]`；
- 现行 `PATH_NOT_ALLOWED` 失败面携带 `path` 新鲜副本 + `message`（E100 亦回显 path：`read.ts:146-148`）；
- doc-runtime 零命中：`maxChildrenPerNode` / `READ_OPTIONS_INVALID` / `truncations` / `TruncationEntry` / `DeepOptional`（全仓 `*.ts` grep 0 hits）——预算面为**全新落地面**。

**当前工作区基线（SA3 实现后、本契约修订前，SA6 迭代 1 亲跑复核）**：

| 命令 | 结果 |
|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts` | `Tests 1 failed \| 32 passed (33)`、`Type Errors no errors`；唯一 FAIL = S19④ 条目断言（`expected [] to deeply equal ['[["holder","ys"],"depth",1]']`）——与 SA3 §7.2 逐字一致 |
| `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/doc-runtime`（SA3 §6.2） | 26/27 文件绿；503 tests 中唯一红 = 同一 S19④；root `pnpm test` 3716/3717 同源 |
| `npx tsc -p packages/doc-runtime/tsconfig.json` | exit 0（SA3 §6.2；本版未改类型面） |
| `git diff --stat` | 仅 `src/index.ts`(+7)、`src/read.ts`(+412/−34)、`test/public-surface-type-guard.test-d.ts`(+15) 与 3 个新测试文件——范围与 §10 ALLOW 一致（E6/E7 已由 SA3 备证） |

即：**除 S19④ 这一条外，T1 全部已批准验收均为绿**；本版修订只把该条从「不可满足 + 与 S21 互斥」改为 B16/R9 的可满足口径。

## 5. Positive reproduction（能力缺口证明）

### 5.1 类型层缺口（probe：`.scratch-sa6-334/type-probe.ts`，tsc 输出逐字）

```
packages/doc-runtime/.scratch-sa6-334/type-probe.ts(11,33): error TS2554: Expected 2 arguments, but got 3.
packages/doc-runtime/.scratch-sa6-334/type-probe.ts(13,33): error TS2554: Expected 2 arguments, but got 3.
tsc exit: 2
```

结论：公共签名只接受 `(doc, path)`；第三参与 options 类型面**不存在**（负例：同文件 2 参调用在基线类型锚中编译通过）。

### 5.2 运行时缺口（probe：`.scratch-sa6-334/runtime-probe.ts`，输出逐字）

```
--- A1. 无 options 基线（全量投影触及 poison → 响亮失败；成功面两键） ---
no-options [poison]         {"ok":false,"code":"PATH_NOT_ALLOWED","path":["poison"],"message":"non-finite number（目标.bad）"}
no-options [sparse]         {"ok":false,"code":"PATH_NOT_ALLOWED","path":["sparse"],"message":"数组位置 undefined 不可投影（稀疏空洞）"}
no-options success own keys: ["ok","value"]
--- A2. 三参调用（预算应绕过 poison）→ 今日第三参静默忽略，仍全量物化 ---
depth:0 ['poison']          {"ok":false,"code":"PATH_NOT_ALLOWED","path":["poison"],"message":"non-finite number（目标.bad）"}
depth:1 []                  {"ok":false,"code":"PATH_NOT_ALLOWED","path":[],"message":"non-finite number（目标.bad）"}
depth:0 ['sparse']          {"ok":false,"code":"PATH_NOT_ALLOWED","path":["sparse"],"message":"数组位置 undefined 不可投影（稀疏空洞）"}
options success own keys   : ["ok","value"]
--- B1. width 预算今日无操作：maxChildrenPerNode:1 仍全量 ---
width:1 ['items']           {"ok":true,"value":["a","b","c","d"]}
width:0 ['items']           {"ok":true,"value":["a","b","c","d"]}
--- B2. depth 预算今日无操作：depth:1 仍下钻两层 ---
depth:1 ['nested']          {"ok":true,"value":{"k1":{"x":1},"k2":"v"}}
--- B3. 非法 options：今日静默接受并全量投影（无 READ_OPTIONS_INVALID） ---
[] {depth:-1}               {"ok":true,"value":{"title":"Hello","items":["a","b","c","d"],"nested":{"k1":{"x":1},"k2":"v"}}}
[] {depth:1.5}              {"ok":true,"value":{…}}
[] {depth:NaN}              {"ok":true,"value":{…}}
[] {depth:Infinity}         {"ok":true,"value":{…}}
[] {bogus:1}                {"ok":true,"value":{…}}
[] 42                       {"ok":true,"value":{…}}
[] null                     {"ok":true,"value":{…}}
```

（B3 中 `{…}` 均与首行同值：完整 ROOT 投影。）

结论（逐条可观测）：
1. **第三参被 `arguments` 之外的 JS 语义静默丢弃**——`depth:0` 要求的骨架读仍返回全量物化失败；`maxChildrenPerNode:0/1` 无操作；`depth:1` 仍下钻全深。
2. **非法 options 静默接受**：负数/非整数/非有限数/非对象/未知键全部无拒绝、无新码。
3. **无截断事实通道**：带 options 调用的成功面仍恰两键 `["ok","value"]`。
4. **零物化承诺不存在**：预算本应绕过的 non-finite number / 稀疏空洞今日必然被物化并触发 `PATH_NOT_ALLOWED`。

### 5.3 复数载体事实（probe：`.scratch-sa6-334/facts-probe.ts`，输出逐字）

```
Y.Map size with undefined-valued key: 3 keys: ["a","u","b"]        ← size/keys 计入 undefined 值键（raw 计数口径）
fresh doc share.has(ROOT) before read: false
fresh doc share.has(ROOT) after rejected 2-arg read: true          ← 现行 2 参拒绝路径仍走 N0 探针、惰性创建 ROOT
plain object own enumerable string keys: ["a","u","acc"]           ← Object.keys 含 accessor 键
projection of po: {"ok":true,"value":{"a":1}}                      ← undefined 值键与 accessor 键均吸收/不产出
sparse array length: 3 hasOwn(1): false
read sparse: {"ok":false,…,"message":"数组位置 undefined 不可投影（稀疏空洞）"}
full read 10k Y.Array: length 10000 ms 3.03                        ← 大 fixture 构造成本可忽略，规模断言可行
```

这三条事实直接决定契约口径：`omitted` 的「直接子项数」= 载体 raw 子槽数（含 undefined 值键）；plain object 的可读子项 = own enumerable **data** 键；非法 options 的「零 doc 触碰」可用 `doc.share.has('ROOT')` 观测（现行失败读会建 ROOT，故该锚有判别力）。

### 5.4 detached 容器事实（本轮新增；独立探针，SA6 迭代 1）

**yjs 公共 API（13.6.32，`packages/doc-runtime` 下 `node --input-type=module`，输出逐字）**：

```text
detached Y.Map : doc===null true | size 0 | keys [] | toJSON {} | _prelimContent Map(1) | warns 3
detached Y.Array: doc===null true | length 0 | toArray [] | _prelimContent 3         | warns 2
after integrate (root.set)      : doc===null false | size 1 | keys ["k"] | _prelimContent null | warns 0
nested-in-plain-value（S19 夹具形态）: doc===null true | size 0 | root.toJSON() holder → {"holder":{"ys":{}}}
other-doc integrated            : doc===null false | size 1（不属 detached 判据面）
```

- 全部公共读数（`size`/`length`/`keys()`/`toArray()`/`toJSON()`）对未集成容器**恒为空**，且每次越权读打印
  `Invalid access: Add Yjs type to a document before reading data.`（yjs `AbstractType.warnPrematureAccess`，`src/types/AbstractType.js:25`）；
- prelim 缓冲只在内部 `_prelimContent`（`YMap.js:57`、`YArray.js:37`；集成时置 `null`）——**非公共 API、非文档状态**；
- 公共 count ≥ 1 ⟺ 已集成（`doc !== null`）⟹ 真 detached（`doc === null`，S21 前提）与「raw 子项数 1」不可同时构造（**证实 SA3 §7.2**）。

**当前实现（SA3 落地形态）在 F-POISON 上的读数（探针 `P1–P5`，逐字节）**：

```text
['holder'],{depth:1}      → {"ok":true,"value":{"ys":{}},"truncated":false,"truncations":[]}  | 1×Invalid access 警告
['holder','ys'],{depth:0} → {"ok":true,"value":{},"truncated":false,"truncations":[]}          | 1×Invalid access 警告
['holderArr'],{depth:1}   → {"ok":true,"value":{"ys":[]},"truncated":false,"truncations":[]}  | 1×Invalid access 警告
['holderArr','ys'],{depth:0} → {"ok":true,"value":[],"truncated":false,"truncations":[]}      | 1×Invalid access 警告
['holder'],{depth:2}      → {"ok":false,"code":"PATH_NOT_ALLOWED","path":["holder"],…}        | 0 警告
['holderArr'],{depth:2}   → {"ok":false,"code":"PATH_NOT_ALLOWED","path":["holderArr"],…}     | 0 警告
['holder'],{maxChildrenPerNode:1}（ys 在保留前缀内被物化）→ PATH_NOT_ALLOWED | 0 警告
无 options 2 参读 ['holder','ys'] → PATH_NOT_ALLOWED（detached 守卫，现行不变） | 0 警告
instrumented own `size` getter 计数 = 1（当前实现确实执行了该公共 count 读）
3 次重复逐字节一致（确定性）
```

**derived 裁决**：结果面（`{ys:{}}`、`truncated:false`、空清单）与 S21 并不冲突，冲突只在**计数前提**（`omitted 1`）与**公共 count 读的合法性**；故 B16 钉死 `rawTotal := 0` **且零公共 count 读**（当前实现读 `size` 的 1 次无效访问，是本版要求 SA3 消除的唯一 delta）。

## 6. Negative control

**基线负控（迭代 0 缺口语境："今日"= HEAD 无预算面；SA3 实现后实测见 §13 迭代 1）**：

| # | 负控 | 期望 | 现状证据 |
|---|---|---|---|
| NC-1 | F-POISON 上 **不带 options** 读 `['poison']` | `PATH_NOT_ALLOWED`（NaN 真不可表示，证明夹具有效、不是宽松套件） | probe A1；实现后绿 |
| NC-2 | 保留/展开到 poison 的预算读（`depth:2` 或 `width` 覆盖 poison） | `PATH_NOT_ALLOWED`（预算不能把不可表示值洗白） | probe P3（§5.4）；实现后 S21 全绿 |
| NC-3 | 干净夹具无 options 全量读 | 深等于改动前基线（逐字节回归锚） | 迭代 0：75 tests 绿；实现后 4 冻结点锚未改全绿 |
| NC-4 | 携带合法 options 的**路径缺陷**读（段型不符/空洞/终态下钻） | 仍是 `PATH_NOT_ALLOWED` + path 回显，不得被 options 分支掩盖 | §12.8；实现后 S18 + guards NC-4 绿 |
| NC-5 | 非法 options 本身 | 必须 `READ_OPTIONS_INVALID`，**不得** `ok:true` | 迭代 0：静默接受（红）；实现后 guards 矩阵 88 tests 全绿 |
| NC-6 | 无 options 成功面 | 恰两键、无 `truncated`/`truncations` | probe A1/B1；实现后 S1/S23 绿 |
| NC-7 | 哨兵夹具的「预算内 poison 可读性」反证（S21 第一行） | 同夹具 `depth:2` 必须红——证明 S19/S20 绿不是因为 poison 被静默吞掉 | probe P3（§5.4）；实现后绿 |
| NC-8 | 同一 detached 夹具**展开**（`['holder'],{depth:2}`、`['holderArr'],{depth:2}`，及 width 保留槽位物化） | `PATH_NOT_ALLOWED`（S19④ 折叠绿不是把 detached 内容静默吞掉；折叠/展开对称性即 B16） | probe P3（§5.4）；实现后绿 |

**契约级负控（下游实现必须产出绿证据）**：NC-1、NC-2、NC-4、NC-6、NC-7、NC-8 在实施前后均绿；NC-5 按 Feature 节奏「红→绿」。编号与 §12.8 一致。负控失败 = 实现越界（动了冻结面或断言不敏感），向总控报告。

## 7. Stability, scale and timing

- **稳定性**：runtime probe 连续 3 次运行输出 sha256 完全一致（`1b32b66005e6f234`），exit 0——同步纯读、零时序依赖；迭代 1 的 detached 折叠读数同样 3 次逐字节一致（§5.4 P5）。目标行为同样为确定性同步纯函数（ADR-0008「读取只观察调用瞬间已提交的 live Y.Doc」）。
- **规模**：10k 元素 `Y.Array` 全量读 ~3ms（facts probe），大夹具可负担。契约的规模断言是**形状断言**（输出长度/`omitted` 计数），**不是**计时断言——ADR-0024 验收节明文「行为级断言，不依赖性能基准」。
- **深度**：预算读的收益是「小于预算处不再递归」；绑定证据是 poison 哨兵（NC-1/NC-2 对照）。不引入计时门禁；深层链式夹具（数万层）属环境敏感的鲁棒性观察项，非门禁（§12.7 S22 注）。
- **重复/竞态**：无并发、无时钟、无 I/O；不存在竞态面。重复调用幂等（同 doc 状态 → 深等结果、身份独立，S21）。

## 8. Capability gap chain（Feature：能力缺口，不虚构 Bug 根因）

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 1 | 请求能力：三参公共面 + depth/width 预算在投影递归内生效 + 截断省略/清单 + 非法 options 新失败分支 + 无 options 逐字节不变 | 简报 L17/AC1–AC5；ADR-0024 决策 1/2/3/6 + 验收节「载体单元」条 | high |
| 2 | 公共签名今日为双参，第三参与 options 类型面不存在 | `read.ts:53-56`；`index.ts:12-13`；TS2554 ×2（§5.1） | high |
| 3 | 运行时第三参被 JS 静默忽略：预算零效果 | probe A2/B1/B2 | high |
| 4 | 无 options 校验：负/非整数/非有限/非对象/未知键全部静默接受 | probe B3；`READ_OPTIONS_INVALID` 全仓 0 命中 | high |
| 5 | 成功面恒两键，无截断事实通道可被 runtime 组合消费 | probe A1/B1；`runtime-readdata-schema-projection-control.test.ts:7`「成功 = {ok:true,value} 恰两键」 | high |
| 6 | 投影递归无预算参数、无截断边界短路：目标子树整体物化 | `read.ts:340-445`（`projectValue` → `projectYMap`/`projectYArray`/`copyPlainStrict` 无 budget 形参、无条件提前返回） | high |
| 7 | **最深能力缺口**：`projectYMap`/`projectYArray`/`copyPlainStrict` 的递归对每个子项无条件 `projectValue`/`copyPlainStrict`，故「未展开分支零物化」不可达；同时无「直接子项数」读取通道，故截断清单的 `omitted` 口径无处产出 | `read.ts:367-390`（逐 keys/下标全量递归）、`read.ts:404-445`（plain 全量递归） | high |
| 8 | 放大因素：不传预算时成本 O(目标子树)（ADR 背景）；runtime 组合面（T2）需要 doc-runtime 提供同预算截断事实才能贯彻决策 6 | ADR-0024 背景节 + 决策 6；`runtime.ts:119/484-486` 现行单源派生/透传结构 | high |
| 9 | 未证实假设 | 「截断清单条目顺序稳定」「Y.Map 前 K 子项跨版本稳定」——ADR 明文不承诺，契约不依赖（§12.12） | — |
| 10 | 已排除 | 「options 已有隐藏支持」「零物化已由惰性 Yjs 读取达成」「omitted 可复用 PATH_NOT_ALLOWED 通道」——见 §11 | high |

## 9. Causal experiments（最小因果实验，控制变量）

| # | 最小输入 | 自变量 | 观察 | 对照 | 结论 |
|---|---|---|---|---|---|
| X1 | `readLogicalValueAtPath(docA, ['poison'], {depth:0})`（运行时经类型断言） | 是否多传第三参 | 仍 `PATH_NOT_ALLOWED`（probe A2） | 同调用 2 参形态同样失败；`width:1` 与 `width:0` 输出完全相同 | 第三参无运行时语义 |
| X2 | `readLogicalValueAtPath(docB, ['items'], {maxChildrenPerNode:1})` | width 值 0 vs 1 | 均返回 4 元素全量（probe B1） | 2 参调用 | width 无操作 |
| X3 | `readLogicalValueAtPath(docB, [], {depth:-1})` | options 合法性 | `ok:true` 全量投影（probe B3） | `{depth:0}` 同样 `ok:true` | 无非法拒绝分支 |
| X4 | 同一 poison 夹具：无 options vs `{depth:0}` | budget 边界位置 | 两者都失败；而**目标要求的** `{depth:0}` 应 `ok:true {}` | NC-2（保留 poison 的预算读必须失败） | 失败原因是「无预算递归」而非夹具/环境 |
| X5 | `tsc` 编译 3 参调用 vs 2 参调用 | 参数个数 | 3 参 TS2554 ×2（§5.1） | 2 参基线类型锚编译通过 | 类型面缺口与运行时缺口一致 |
| X6 | `Y.Map` 含 undefined 值键：`size`/`keys()` | 计数口径 | size=3、keys 含 `'u'`（facts probe） | plain object `Object.keys` 含 accessor 键但投影不含 | `omitted` 必须用 raw 子槽口径，不能拿投影键数替代 |
| X7 | detached 容器（Y.Map/Y.Array）作为折叠目标：`doc === null` vs integrated；公共 count vs 内部 `_prelimContent` | 集成状态 × 读数面 | 未集成：`size`/`length` 0（+Invalid access 诊断）、`_prelimContent` 有内容；集成后：count ≥ 1、`_prelimContent === null`（§5.4） | instrumented own `size` getter：当前实现折叠读触发 1 次；`['holder'],{depth:2}` 现行守卫红、零警告 | 「真 detached 且 raw 子项数 1」不可构造（SA3 §7.2 证实）；契约侧钉死 `rawTotal := 0` 且零公共 count 读（B16/R9）——不依赖 yjs 的 invalid-access 回退值 |

所有实验均在 fixture 层控制变量；无一处 mock 掉故障所在边界（均走公共接缝 `src/index.ts`）。

## 10. Impact surface

**T1 允许触碰**（且仅此）：

| 文件 | 变更性质 |
|---|---|
| `packages/doc-runtime/src/read.ts` | 加法：第三参、options 校验分支、budget 参数贯通两条投影递归、截断清单收集；无 options 路径字节不变 |
| `packages/doc-runtime/src/index.ts` | 加法：导出新 options/entry/budget-result 类型名目（无新值导出） |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts`（新；本版原位修订 S19④/O-1 断言与夹具注释，见 §12.7） | 行为验收（§12.9） |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test-d.ts`（新） | 类型验收（§12.9） |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget-guards.test.ts`（新） | options 校验/零 throw/零触碰守卫（§12.9） |
| `packages/doc-runtime/test/public-surface-type-guard.test-d.ts` | **仅加法**：新类型名目可导入锚 |

**冻结/零接触**：runtime `readData` 三键形状与失败联合（`runtime.ts:119,126-129,484-486`）、`resolveSchemaAtPath`、`DeepOptional`、registry 文档负控、`docs/integration`、wire/协议、ValueSchema 9-kind（ADR-0003）、写路径/sequencer/persistence、`carrier.ts`/`extract.ts` 等只读非目标模块。

**跨包类型耦合关键点**：`packages/namespace-runtime/src/runtime.ts:119`
`type ReadLogicalValueFailure = Extract<ReadLogicalValueResult, { ok: false }>` —— 该派生意味着：若把 `READ_OPTIONS_INVALID` 成员**加进** `ReadLogicalValueResult`，runtime 公共失败联合会**自动**获得一个 T1 未授权的新成员（跨包公共类型面被 T1 改动）。这是 §12.4 采用「双结果类型 + 重载」而非单联合扩展的决定性理由。

## 11. Ruled-out hypotheses

| # | 假设 | 排除证据 |
|---|---|---|
| H1 | 「三参/预算已有隐藏支持，只是没测」 | TS2554 + 运行时静默忽略（X1–X3）；全仓符号 0 命中 |
| H2 | 「零物化已由 Yjs 惰性 `toJSON` 达成」 | X4：同一调用在预算边界应绕过 poison 却仍全量失败；`read.ts` 递归逐子项 `get`/`descriptor` 物化 |
| H3 | 「新失败码可复用 `PATH_NOT_ALLOWED`」 | ADR-0024 决策 1 明文「不借用路径失败码」；SA8 §4 冻结码域 |
| H4 | 「T1 顺手把 runtime `readData` 改五键」 | 决策 4 属 T2；SA8 §4 冻结「runtime readData 形状不动」；简报 AC1 限定 doc-runtime 单元面 |
| H5 | 「截断通道可以条件在场（有截断才带 keys）」 | 决策 3「恒在场（无截断时为空清单）」；CONTEXT「截断清单」_Avoid_ 明列「条件在场」 |
| H6 | 「`omitted` 可用后代总数」 | 决策 3 钉死直接子项数（O(1)）；统计后代违背零物化（决策 1）；S12 以「直接 ≠ 后代」夹具显式反证 |
| H7 | 「`Y.Map.size` 不计 undefined 值键，故 raw 口径不成立」 | facts probe：size=3、keys 含 undefined 值键 |
| H8 | 「options 可在 N0 探针之后再校验」 | 可运行但契约钉死 G0→options→N0（§12.5）：保证非法 options 零 doc 触碰且定序唯一可锚 |
| H9 | 「把 `READ_OPTIONS_INVALID` 加进 `ReadLogicalValueResult` 无副作用」 | `runtime.ts:119` Extract 会把新成员漏进 runtime 公共联合（§10） |
| H10 | 「`depth:-0` 是非法值」 | `-0 >= 0 && Number.isInteger(-0) && Number.isFinite(-0)` 均真；与既有段纪律 `-0 归一 0` 先例一致 → 合法，等价 `depth:0` |
| H11 | 「显式 `{depth: undefined}` 在 `exactOptionalPropertyTypes` 下类型合法」 | ts-semantics probe：`@ts-expect-error` 被消费（确为编译错误）；运行时按「键在场、值 undefined ≡ 缺席」容忍 |

## 12. Acceptance contract and test paths

### 12.1 公共签名与类型面（加法，机制不限，义务钉死）

```ts
// 公共出口经 src/index.ts（包 AGENTS 纪律）
export interface ReadLogicalValueAtPathOptions {
  depth?: number;               // ≥0 有限整数；-0 ≡ 0
  maxChildrenPerNode?: number;  // ≥0 有限整数；-0 ≡ 0
}

export interface ReadLogicalValueTruncationEntry {
  path: readonly (string | number)[];  // ROOT 基绝对路径（与 path 实参同基），新鲜副本
  kind: 'depth' | 'width';
  omitted: number;                     // ≥1；直接子项数（depth）/ 超出保留数（width）
}

// 三参重载结果（新名目）
export type ReadLogicalValueAtPathBudgetResult =
  | { ok: true; value: unknown; truncated: boolean;
      truncations: readonly ReadLogicalValueTruncationEntry[] }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string }
  | { ok: false; code: 'READ_OPTIONS_INVALID'; path: readonly (string | number)[]; message: string };

// 既有名目：成员与语义逐字不变（T1 只加不改）
export type ReadLogicalValueResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'PATH_NOT_ALLOWED'; path: readonly (string | number)[]; message?: string };
```

| # | 义务 | 断言口径 |
|---|---|---|
| T1-1 | `readLogicalValueAtPath(doc, path)`（2 参）静态返回型**恰为** `ReadLogicalValueResult`（成员、成功面两键、失败面不变） | test-d `expectTypeOf(fn(doc,[])).toEqualTypeOf<ReadLogicalValueResult>()`；无 options 访问 `.truncations` 编译错误 |
| T1-2 | `readLogicalValueAtPath(doc, path, options)` 静态返回型**恰为** `ReadLogicalValueAtPathBudgetResult`（`options` 形参**非可选**） | test-d `expectTypeOf(fn(doc,[],{})).toEqualTypeOf<ReadLogicalValueAtPathBudgetResult>()` |
| T1-3 | 重载顺序保证 2 参调用解析到 T1-1（不得让 2 参调用落到 budget 型） | test-d 断言（同 T1-1） |
| T1-4 | options 封闭形状：对象字面量未知键/类型不符/数组/裸非对象 → 编译错误；`{}` 合法 | test-d `@ts-expect-error`：`{bogus:1}`、`{depth:'1'}`、`{maxChildrenPerNode:null}`、`[]`（TS2559 weak-type 实证）、`42`、`null` |
| T1-5 | 显式 `undefined` 第三参：类型层**拒绝**（非可选形参）；运行时按「无 options」处理（2 键成功） | test-d `@ts-expect-error fn(doc,[],undefined)`；行为锚 §12.7 S23 |
| T1-6 | 新类型名目经 `src/index.ts` 可导入；`ReadLogicalValueResult` 仍可导入且不变 | `public-surface-type-guard.test-d.ts` 加法导入 + `expectTypeOf` 投影 |
| T1-7 | 不新增**值**导出（函数仍是唯一读入口；决策 6「不新增第二条读路径」） | `public-surface-guard.test.ts` 原样绿 |
| T1-8 | 无 options 的值类型不受影响（doc-runtime 值通道恒 `unknown`；`DeepOptional` 属 T4，不落此处） | test-d 成功面 `value: unknown` |

### 12.2 options 校验矩阵（**响亮拒绝 → `READ_OPTIONS_INVALID`**）

| 类别 | 输入 | 判定 | 依据 |
|---|---|---|---|
| 缺席 | 第三参不传 | 无预算路径（逐字节现行） | 决策 1「不传 options = 完整投影」 |
| 显式 undefined | 第三参 `undefined`（JS/断言调用） | 同「缺席」（2 键成功） | SA6 解析（§12.11 R1）；类型层拒绝（T1-5） |
| 合法空对象 | `{}`、`{depth:undefined}`、`{depth:undefined,maxChildrenPerNode:undefined}` | **预算读**（4 键成功、`truncated:false`、`[]`） | options 在场即预算语义；`undefined` 值键 ≡ 缺席 |
| 合法值 | 有限非负整数（含 `-0`、`0`、`2**53` 量级） | 预算读 | 决策 1；段纪律 `-0` 先例 |
| 合法宿主 | `Object.prototype`/`null` 原型对象；frozen/sealed | 预算读 | 封闭形状只约束键与值 |
| 非法：非对象 | `null`、`42`、`'x'`、`true`、`1n`、`Symbol()`、函数 | `READ_OPTIONS_INVALID` | 决策 1「非对象」 |
| 非法：非 plain 宿主 | 数组、`new Date()`、`new Map()`、class 实例、自定义原型对象（`Object.create({depth:1})`） | `READ_OPTIONS_INVALID` | 封闭形状 + 本包 plain 判据精神 |
| 非法：未知键 | 任一 own enumerable **string** 键 ∉ `{depth,maxChildrenPerNode}`（含值为 `undefined` 的键）；own enumerable accessor 键 | `READ_OPTIONS_INVALID` | 决策 1「含未知多余键」 |
| 非法：值域 | 负数、非整数、`NaN`、`±Infinity`、`'0'`、`null`、`{}`、`1n`、`true` | `READ_OPTIONS_INVALID` | 决策 1「负数/非整数/非有限数」 |
| 非法：accessor 值 | `{get depth(){…}}`/`{set depth(v){…}}` | `READ_OPTIONS_INVALID`，**绝不执行 getter/setter**（副作用计数 0） | 本包零 accessor 执行纪律（D5/INV-R4） |
| 非法：敌意对象 | Proxy（`ownKeys`/`getOwnPropertyDescriptor`/`get` trap 抛）等探测期抛异常 | `READ_OPTIONS_INVALID`（**绝不外抛**） | §12.5 策略 A |
| 键空间口径 | options 的 keyspace = own enumerable string **data** 属性；symbol/非 enumerable 键忽略；继承键忽略 | — | D5 同源（own enumerable string data property） |

### 12.3 预算语义（depth/width 递归，钉死）

**depth `D`（≥0 整数）**：自目标节点向下允许**展开**的容器层数；容器 = `Y.Map`/`Y.Array`/plain object/plain array，各计一层；标量与 `Y.XmlFragment` 是终态（不耗层）。

递归语义（`project(node, D)`，与决策 1 逐点对应）：

1. `node` 是终态（标量 / `Y.XmlFragment`）→ 原样投影，**任何 D/K 都是 no-op**（终态无展开：决策 1）。
2. `node` 是容器且 `D === 0` → **同形空容器**折叠（`{}` / `[]`）+ 若其 raw 直接子项数 ≥1 则记**一条** depth 条目 `{path: node 的 ROOT 基路径, kind:'depth', omitted: rawChildCount}`；子项**一律不读**（零物化）。**detached 容器（`doc === null`）按 B16：`rawChildCount := 0`、不记条目，且连计数读也不执行。**
3. `node` 是容器且 `D ≥ 1` → 按 width 取保留前缀并展开：
   - 保留子项逐个投影（容器子项用 `D-1`，终态子项原样）；
   - 被保留的 `undefined` 值键/越界语义遵循既有吸收纪律（E1，不新增第三态）；
   - 超出前缀的子项**一律不读**，整节点只记一条 width 条目。

**width `K`（≥0 整数）**：每个被展开节点保留**前 K 个 raw 直接子项**（载体序：`Y.Array`/plain array 下标序；`Y.Map` 插入序——ADR 明文不承诺跨版本稳定；plain object `Object.keys` 序）；`rawTotal > K` 时记一条 width 条目 `{path: 父路径, kind:'width', omitted: rawTotal - K}`；`rawTotal ≤ K` 不记条目、不截断。

| # | 语义点 | 口径（钉死） |
|---|---|---|
| B1 | depth 计层 | 目标容器自身计入第一层：`D:0` 折目标、`D:1` 展开目标直接子项、容器子项用 `D-1` |
| B2 | 终态 no-op | 目标为标量/`Y.XmlFragment` → 原样返回，`truncated:false`、`truncations:[]`；`width` 同理不适用 |
| B3 | depth 折叠优先级 | 同一节点被 `D:0` 折叠时**只记一条 depth 条目**，不再记 width 条目（决策 1「单条」） |
| B4 | 空容器/无公共子项折叠 | 折叠容器 raw 子项数为 0 时**不记条目**（无省略）；`truncated:false`（SA6 解析 R2/R9，§12.11）。detached 容器按 B16 的 `rawTotal := 0` 落此条 |
| B5 | **raw 计数口径** | `omitted`（depth）= 被折容器的 raw 直接子项数：`Y.Map.size`（含 undefined 值键，实证 size=3）/ `Y.Array.length` / plain array `length` / plain object 的 own enumerable **data** 键数（accessor 与非 enumerable 不计）；**绝不是后代总数**。**detached 例外（B16/R9）**：Yjs 家族未集成容器（`doc === null`）rawTotal **契约定义恒 0**，且不执行 `size`/`length` 读——prelim 内容不是文档状态，其公共读数是 yjs 的 invalid access 回退；**跨 doc 集成容器**（`doc !== null`）不属 detached，按上表计数（行为不变） |
| B6 | width 计数 | `omitted` = `rawTotal - K`（仅 `rawTotal > K` 时）；`K:0` → 全部省略、同形空容器 |
| B7 | 前缀口径 | 前缀在 raw 子槽序上先取，再按既有规则投影/吸收（被保留的 undefined 值键仍被吸收但**占用保留额度**）；plain object 的子槽序列 = own enumerable **data** 键序列（accessor/非 enumerable 不占槽） |
| B8 | 零物化边界 | 折叠与超出前缀的子项：不得 `get`/`descriptor.value` 读值、不得递归；只允许 O(1)/O(子槽) 计数读（`size`/`length`/own keys 枚举，无值读取、无 accessor 执行）。**detached 容器例外（B16/R9）**：`doc === null` 时连计数读也不得执行（yjs 对该读报 Invalid access；契约定义 `rawTotal = 0`，不依赖该回退值） |
| B9 | 路径基 | 条目 `path` 与 `path` 实参同基（自 ROOT 起算的绝对路径），**绝不相对目标**：`read(doc,['cfg'],{depth:0})` → `path:['cfg']`；`read(doc,[],{depth:0})` → `path:[]` |
| B10 | depth 条目 path 尾段 | 折叠子容器条目的 `path` 尾段即被裁键名（`['nested','k1']`）——键名唯一在场位置（值内已省略） |
| B11 | width 条目粒度 | 只在父路径记一条，不逐键罗列 |
| B12 | 值域纪律 | 省略 = 键不出现在值中；无「键在值 undefined」第三态、无魔法哨兵；**唯一例外**＝`D:0` 时目标节点自身以同形空容器呈现（决策 2） |
| B13 | 导航不变 | options 不影响路径解析/载体分类/失败分类；先导航到目标，再对目标子树做预算投影（决策 6：仅投影递归携带预算） |
| B14 | 不变量 | `truncated === (truncations.length > 0)`；条目 `omitted ≥ 1`；`(path,kind)` 不重复；条目顺序不承诺（§12.12） |
| B15 | 载体分类 vs 折叠 | 折叠/裁减判定只按「是否容器（Y.Map/Y.Array/plain object/plain array）」与 raw 子槽数进行（允许廉价类型分类；非 detached 容器的计数读按 B8，detached 按 B16）；**detached 判别不改变折叠**——被折子项即便内部含不可表示值、`Y.Text` 或 detached 载体，也不在折叠处失败；只有被**展开/保留并物化**时才响亮失败（NC-2/S21 反证） |
| B16 | **detached 容器 `d===0` 语义（本版裁决，消解 SA3 §7；与 B4/B5/B8/B15 同源）** | 折叠目标或被折子项是 Yjs 家族容器（`Y.Map`/`Y.Array`）且 `doc === null`、`d === 0` 时：①**折叠照常发生**（B15 优先，不走 detached 守卫）；②落**同形空容器** `{}`/`[]`（proto = Object.prototype）；③`rawTotal := 0`（B5 detached 例外）→ 不记条目、`truncated:false`、`truncations:[]`；④对被折 detached 实例**零读**：不读 `size`/`length`/`keys()`/`get`/`toJSON`（B8 例外）；⑤`d ≥ 1`（含 width 保留槽位被物化）→ 现行响亮失败面原样生效（`PATH_NOT_ALLOWED`，S21/NC-2/NC-8）；⑥detached **非容器**（`Y.Text`/`Y.XmlFragment`/未知 shared）不入折叠，走 B2 终态 no-op + 现行守卫（响亮失败）。理由：prelim 内容非文档状态、非公共 API；未集成类型的公共读数在 yjs 中是 invalid access（0 回退 + 诊断），契约不依赖该回退；`truncated:false` 断言的是「文档在该节点无子项被省略」，不是「调用方对象无 prelim 内容」 |

### 12.4 D-1 解析：doc-runtime 结果联合如何携带截断事实（钉死）

**决议**：**双结果类型 + 重载**——无 options 走既有 `ReadLogicalValueResult`（两键成功、成员逐字不变）；带 options 走新 `ReadLogicalValueAtPathBudgetResult`（四键成功 + 新失败码）。截断通道只在预算读成功面**恒在场**（`truncated` + `truncations`，空清单也是空数组），无 options 成功面**永不出现**这两个键。

| 约束（SA8 D-1） | 满足方式 |
|---|---|
| AC2：可供 runtime 组合消费 | 预算成功面直接给出 `value` + `truncated` + `truncations`（条目三字段 path/kind/omitted，ROOT 基）→ T2 组合 `{ok:true,value,schema,truncated,truncations}` 为机械加法；无需二次遍历 |
| AC5 + 0016 修订条款 2：无 options 逐字节/逐字不变 | 2 参重载返回型**就是**未改动的 `ReadLogicalValueResult`；成功面恰两键；options 失败码不进该类型 |
| 决策 1：新失败分支不借路径码 | 新码 `READ_OPTIONS_INVALID` 只出现在 budget 结果类型的失败成员；`PATH_NOT_ALLOWED` 码域不动 |
| 额外：T1 不触碰 runtime 公共类型 | `runtime.ts:119` 的 `Extract<ReadLogicalValueResult,{ok:false}>` 保持不变（若把新码塞进旧联合，会把 T1 未授权成员漏进 `NamespaceRuntimeReadDataResult`） |

**否决备选**：单一 `ReadLogicalValueResult` 加宽（两个成功成员 + 新失败码）——2 参调用的静态类型会含**不可能出现**的 `READ_OPTIONS_INVALID`，且经 Extract 泄漏到 runtime 公共面；并迫使既有结构性测试别名（`schema-independent.test.ts:81-83`、`guards.test.ts:29-31`、`runtime-readdata-schema-projection-red.test.ts:50-53`）全部改动。

### 12.5 D-2 解析：options 校验失败边界（钉死）

| # | 边界 | 口径 |
|---|---|---|
| V1 | **定序** | `G0 path 形态守卫` → `options 校验` → `N0 probeRoot` → `N1 导航` → `P1 预算投影`。两者同时非法时 **G0 优先**（`read(doc, null, {depth:-1})` → `PATH_NOT_ALLOWED`；`read(doc, ['x'], {depth:-1})` → `READ_OPTIONS_INVALID`）。理由：G0 是既有「守卫前置」锚不许漂移；options 校验插在 G0 与 N0 之间的最小 diff 位；两者都在 doc 触碰之前 |
| V2 | **零 doc 触碰** | 非法 options 一律在 N0 之前短路：新 doc `share.has('ROOT') === false`、既有 doc `update` 事件计数 +0、不产生任何写/事件 |
| V3 | **零 throw / 零副作用** | 校验总函数、绝不外抛；不执行 options 上的任何 getter/setter、不修改 options 对象（前后深等 + own 键集不变）；探测期异常（Proxy trap 等）一律收编为 `READ_OPTIONS_INVALID`（策略 A） |
| V4 | **E100 兜底** | 顶层 try/catch（E100）继续兜底一切内部意外；但 options 域缺陷**不得**走 E100/`PATH_NOT_ALLOWED`（预算缺陷不是路径缺陷）。E100 仍只表示内部 bug |
| V5 | **失败分支字段** | `{ ok:false, code:'READ_OPTIONS_INVALID', path, message }`：`path` = `path` 实参的**新鲜回显副本**（非数组 → `[]`），与 `PATH_NOT_ALLOWED` 的 `path` 回显纪律一致（仓内先例：E100 亦回显 path）；`message` 为非空 string（诊断，非契约字段）；**不得**携带 `value`/`truncated`/`truncations` |
| V6 | **码字面量** | `READ_OPTIONS_INVALID` 为稳定字面量；`code !== 'PATH_NOT_ALLOWED'`；不借用 `RUNTIME_READ_DISABLED` |

### 12.6 兼容约束（冻结面，实施必须保持）

| # | 冻结面 | 要求 | 证据锚 |
|---|---|---|---|
| F1 | 无 options 行为逐字节不变 | 成功恰 `{ok,value}` 两键（值字节不变）；失败恰 `PATH_NOT_ALLOWED` 单码；投影输出与改动前深等 | ADR-0024 L29/L102；简报 AC5 |
| F2 | 缺席吸收（D4） | 缺键/越界 ≡ `ok:true,value:undefined`（value 键显式在场）；中间缺失立即结束；plain undefined 值键吸收 | ADR-0008 L23；S14 |
| F3 | 键空间（D5） | own enumerable string **data** property；不执行 accessor、不走原型链、非 enumerable/symbol 不参与 | ADR-0008；S15 |
| F4 | 零 throw | 一切预期失败（含非法 options）同步结果联合返回；仅 internal bug 抛（顶层 E100 兜底） | ADR-0008 L28；S20 |
| F5 | `PATH_NOT_ALLOWED` 码域 | 路径/载体缺陷专用；预算缺陷不得借用；也不借 `RUNTIME_READ_DISABLED` | ADR-0024 L30；V4/V6 |
| F6 | 终态语义 | `Y.XmlFragment`（含子类）→ 语义字符串、不可下钻；标量原样；Y.Text/未知 shared 无 `toJSON` fallback | ADR-0008 L26；S13/S19 |
| F7 | 值域纪律 | 无第三态/无哨兵/无同形空占位（`D:0` 目标唯一例外）；输出键 `defineProperty` 四真、不 freeze；返回值可变深拷贝、与 live doc 解耦 | ADR-0024 L40；S18/S21 |
| F8 | ValueSchema 9-kind 冻结 | 零触碰（ADR-0003） | ADR-0024 L77 |
| F9 | 公共面纪律 | 仅经 `src/index.ts`；surface guard 覆盖每个导出；read 保持 schema 无关 | `packages/doc-runtime/AGENTS.md`；T1-6/T1-7 |
| F10 | 不新增第二条读路径 | 预算必须贯通既有 `projectValue`/`copyPlainStrict` 双递归，不得旁路实现 | ADR-0024 L87；`read.ts` 头注 D6 |
| F11 | 越界零接触 | runtime `readData` 三键形状/失败联合、`resolveSchemaAtPath`、`DeepOptional`、registry、docs 负控、wire 全部不动 | SA8 §4；§10 |
| F12 | 导航相不变 | options 不改变段纪律/载体分类/路径失败分类 | ADR-0008；B13 |
| F13 | 无选项回归锚 | 3 个既有读锚 + 类型锚**不得修改**且全绿；`public-surface-guard.test.ts` 不改断言 | §14 |
| F14 | 模块态纪律 | 零模块级可变态/零 memo/零订阅（清单随调用新鲜构造） | `read.ts` 头注 INV-R9/R10；S21 |

**禁止实现手法**（反例清单，命中即违约）：
1. 先全量物化再裁剪（哨兵必红）；
2. 为拿 `omitted` 遍历被截子树统计后代；
3. 以 `{}`/`[]`/魔法哨兵在**子项位**表达省略（`D:0` 目标自身除外）；
4. 省略键以「键在值 undefined」表达；
5. 条件在场截断通道（有截断才带 keys）；
6. 非法 options 走 `PATH_NOT_ALLOWED`/E100/外抛；
7. 第二读写路径或改写既有导航/投影实现来旁路预算。

### 12.7 验收场景（行为层，逐条可执行）

夹具 **F-CANON**（干净 Yjs 夹具，ROOT 插入序）：
`title:'Hello'`、`count:42`、`nothing:null`、`items:Y.Array['a','b','c','d']`、`cfg:Y.Map{mode:'fast',limit:10,extra:Y.Array[1,2]}`、`nested:Y.Map{k1:Y.Map{x:1},k2:'v'}`、`plainObj:{a:1,b:{c:2}}`、`plainArr:[10,20,30]`、`xmlEl:Y.XmlElement<p>hi</p>`（ROOT.size = 9）。

| # | 输入 | 期望（精确可观测） | 覆盖 |
|---|---|---|---|
| S1 | `read(doc,['cfg'])`（2 参） | `{ok:true,value:{mode:'fast',limit:10,extra:[1,2]}}`；own keys 排序 = `['ok','value']`；无 `truncated`/`truncations` 键 | F1 |
| S2 | `read(doc,['cfg'],{depth:0})` | `value` = 同形空容器 `{}`（proto=Object.prototype）；`truncated:true`；`truncations` = 恰 1 条 `{path:['cfg'],kind:'depth',omitted:3}` | §12.3 B1/B5/B9 |
| S3 | `read(doc,['items'],{depth:0})` | `value:[]`；条目 `{path:['items'],kind:'depth',omitted:4}` | 同上（数组同形） |
| S4 | `read(doc,[],{depth:0})` | `value:{}`；条目 `{path:[],kind:'depth',omitted:9}` | B9 空路径 |
| S5 | `read(doc,['nested'],{depth:1})` | `value:{k1:{},k2:'v'}`；恰 1 条 `{path:['nested','k1'],kind:'depth',omitted:1}`（`k2` 终态原样） | B1/B10 |
| S6 | `read(doc,[],{depth:1})` | 终态子项原样（`title/count/nothing/xmlEl`）；容器子项折叠：`items:[]`、`cfg:{}`、`nested:{}`、`plainObj:{}`、`plainArr:[]`；恰 5 条 depth 条目，`omitted` 分别为 4/3/2/2/3；`truncated:true` | B1/B2 |
| S7 | `read(doc,['cfg'],{depth:2})` | `value` = `cfg` 全量（`extra:[1,2]`）；`truncated:false`；`truncations:[]`（空数组**在场**） | B1、恒在场 |
| S8 | `read(doc,['cfg'],{depth:5})` | 同 S7（预算大于实际深度 → 无截断） | 恒在场 |
| S9 | `read(doc,['items'],{maxChildrenPerNode:2})` | `value:['a','b']`；条目 `{path:['items'],kind:'width',omitted:2}` | B6/B7 |
| S10 | `read(doc,['items'],{maxChildrenPerNode:0})` | `value:[]`；条目 `{path:['items'],kind:'width',omitted:4}` | B6 |
| S11 | `read(doc,['items'],{maxChildrenPerNode:4})` / `{maxChildrenPerNode:99}` | 全量 `['a','b','c','d']`；`truncated:false`；`truncations:[]` | B6 边界 `rawTotal ≤ K` |
| S12 | `read(doc,['cfg'],{maxChildrenPerNode:2})` | `Object.keys(value)` = 现场 `[...cfg.keys()].slice(0,2)` = `['mode','limit']`；条目 `{path:['cfg'],kind:'width',omitted:1}` | B7 + Y.Map 序派生 |
| S13 | `read(doc,['plainArr'],{maxChildrenPerNode:1})` / `['plainObj'],{maxChildrenPerNode:1}` | `[10]` + omitted 2；`{a:1}` + omitted 1 | B5/B6（plain 载体） |
| S14 | `read(doc,[],{depth:1,maxChildrenPerNode:3})` | `value:{title:'Hello',count:42,nothing:null}`（前 3 raw 子项）；**恰 1 条** width 条目 `{path:[],kind:'width',omitted:6}`；被裁容器子项零读取（无 depth 条目） | B3/B6/B8 |
| S15 | `read(doc,['title'],{depth:0})`、`{depth:0,maxChildrenPerNode:0}`、`['nothing'],{depth:0}`、`['xmlEl'],{depth:0}` | 标量/`null` 原样；`xmlEl` → 语义字符串（归一化 `<p>hi</p>`）；全部 `truncated:false`、`truncations:[]` | B2 终态 no-op |
| S16 | `read(doc,['absent'],{})`、`['items',99],{depth:0}`、`['cfg','u'],{depth:0}`（`u` 为 undefined 值键） | 全部 `ok:true`、`value` 键显式在场且 `undefined`、`truncated:false`、`[]` | F2（预算不破坏吸收） |
| S17 | accessor/proto/non-enumerable 夹具（同既有套件）：`read(doc,['acc'],{depth:1})`、`['protoObj'],{depth:1}` | `{own:'x'}` / `{own:'v'}`；accessor 计数器保持 0；`hidden` 不在输出 | F3 |
| S18 | `read(doc,['title','x'],{})`、`['items','0'],{depth:0}`、`['xmlEl','child'],{}`、`read(doc,null,{depth:0})`、Proxy-iterator path + 合法 options | 全部 `PATH_NOT_ALLOWED` + path 回显（非数组 → `[]`）；无 `truncated`/`truncations`；**零外抛** | F4/F5/F12/S19 码域 |
| S19 | **零物化哨兵（depth）**：F-POISON = ROOT{`title:'Hello'`,`poison:{ok:1,bad:NaN,deep:{more:NaN}}`,`sparse:[1,,3]`,`holder:{ys:<detached Y.Map>}`}；S19④/O-1 用独立同构子夹具 `ROOT{holder:{ys:<detached Y.Map>}, holderArr:{ys:<detached Y.Array（prelim [1,2,3]）>}}`。detached 实例先写 prelim（`set('k',1)` / `insert(0,[1,2,3])`）——**公共 raw 子项数恒 0**（§5.4 / SA3 §7.2），不再当作 count=1 | ① `read(doc,['poison'],{depth:0})` → `ok:true`、`{}`、条目 `['poison'] depth omitted 3`；② `read(doc,[],{depth:1})` → `ok:true`（`poison`/`sparse`/`holder` 在 D=0 折叠，NaN 与 detached 内部均未读；`holder` 为 plain 容器 → 一条 `['holder'] depth omitted 1`）；③ `['sparse'],{depth:0}` → `ok:true`、`[]`、omitted 3；④ `['holder'],{depth:1}` → `ok:true`、`{ys:{}}`、`truncated:false`、**`truncations:[]`（无 depth 条目）**；⑤ 载体同形：`['holderArr'],{depth:1}` → `ok:true`、`{ys:[]}`、`truncated:false`、`truncations:[]`；⑥ **零公共 count 读**：detached 实例以 own accessor 计数器（`size` / `length`）instrumentation，上述折叠读计数器均 = 0（不执行 yjs invalid access；B16④）；⑦ 目标入口同款（SA2 O-1）：`['holder','ys'],{depth:0}` → `{}`、`truncated:false`、空清单、计数器 0 | **主判别锚**：退化实现（先物化再裁剪）必红；B16/R9 |
| S20 | **零物化哨兵（width）**：`mix = ['a', <hole>, 'c']`；`textHolder = {wrap:{t:new Y.Text('x')}}` | ① `['mix'],{maxChildrenPerNode:1}` → `ok:true`、`['a']`、omitted 2；② `['mix'],{maxChildrenPerNode:0}` → `ok:true`、`[]`、omitted 3；③ `['textHolder'],{depth:1}` → `ok:true`、`{wrap:{}}` + 条目 `['textHolder','wrap'] depth omitted 1`（Y.Text 在折叠容器内未读）；④ `read(doc,[],{maxChildrenPerNode:0})` → `ok:true`、`{}` + width 条目 omitted = ROOT.size | **主判别锚** |
| S21 | **NC（哨兵反证）**：S19/S20 夹具上预算覆盖到 poison/detached：`['poison'],{depth:2}` → `PATH_NOT_ALLOWED`；`['mix'],{maxChildrenPerNode:2}` → `PATH_NOT_ALLOWED`；`['holder'],{depth:2}` → `PATH_NOT_ALLOWED`（detached 被展开）；`['holderArr'],{depth:2}` → `PATH_NOT_ALLOWED`（同形载体） | 证明不可表示值真实、套件非宽松；**折叠（`d===0`）绿 vs 展开（`d≥1`）红**的对称性共同钉死 B16 | NC-2/NC-8 |
| S22 | **规模形状（无计时）**：10k 元素 `Y.Array`：`{maxChildrenPerNode:5}` → `value.length===5`、条目 omitted 9995；`{maxChildrenPerNode:0}` → `[]`、omitted 10000；`{maxChildrenPerNode:10001}` → 全量、`truncated:false` | 输出/计数 O(预算) | §7 |
| S23 | `read(doc, [], undefined as never)`（JS 形态） | 同 S1：`{ok:true,value}` 恰两键（显式 undefined ≡ 无 options） | T1-5 运行时侧 |
| S24 | `read(doc,['nested2'],{depth:0})`，`nested2:Y.Map{k1:Y.Map{x:1,y:2,z:3},k2:Y.Map{w:4}}` | `omitted === 2`（直接子项数），**显式断言 `!== 4`（后代键总数）**；`{depth:1}` → 条目 `['nested2','k1'] omitted 3` 与 `['nested2','k2'] omitted 1` | B5、ADR 验收「直接 ≠ 后代」 |
| S25 | 空容器折叠：`emptyObj={}`、`emptyArr=[]`；`read(doc,['emptyObj'],{depth:0})` / `['emptyArr'],{depth:0}` | `ok:true`、`{}`/`[]`、`truncated:false`、`truncations:[]`（无条目） | B4（§12.11 R2） |
| S26 | 值内形态纪律：S9/S14 中被裁键 `Object.hasOwn(value, cutKey) === false`；`Object.keys(value).length === 保留且可投影子项数`；不存在 `undefined` 值在场键；`D:0` 目标自身是唯一空容器形态 | 无第三态/无哨兵 | F7/B12 |
| S27 | 隔离/新鲜/幂等：连续两次同调用 → 深等但 `result`/`truncations`/条目/`path` 身份互异；突变返回值或条目 path 后再读 → 不变；突变调用方 path/options 后原结果不变；调用前后 options 深等（未被修改） | `truncations` 不得是模块级共享 | F14/S21 |

**类型层场景**（`.test-d.ts`，`@ts-expect-error` 自反转纪律）：

| # | 断言 |
|---|---|
| TD1 | 2 参调用型 `= ReadLogicalValueResult`；`r.ok === true` 分支**无** `truncated`/`truncations`（`@ts-expect-error` 访问） |
| TD2 | 3 参调用型 `= ReadLogicalValueAtPathBudgetResult`；成功分支 `truncated: boolean`、`truncations: readonly ReadLogicalValueTruncationEntry[]`、`value: unknown` |
| TD3 | 3 参失败分支 `code` 恰为 `'PATH_NOT_ALLOWED' \| 'READ_OPTIONS_INVALID'`；`path: readonly (string \| number)[]` |
| TD4 | 封闭 shape：`@ts-expect-error` `{bogus:1}`、`{depth:'1'}`、`{maxChildrenPerNode:null}`、`[]`（TS2559）、`42`、`null`；合法：`{}`、`{depth:0}`、`{depth:-0}`、`{maxChildrenPerNode:0}`（`{depth:undefined}` 在 `exactOptionalPropertyTypes` 下为编译错误——td 以 `@ts-expect-error` 锚定该事实） |
| TD5 | 参数个数：`@ts-expect-error` 1 参、4 参、显式 `undefined` 第三参（T1-5） |
| TD6 | 新类型名目经 `index.ts` 可导入（缺失即 TS2305 红）；`ReadLogicalValueResult` 仍可导入 |

### 12.8 负控清单（下游必须产出绿证据）

| # | 负控 | 期望 | 适用相位 |
|---|---|---|---|
| NC-1 | F-POISON 无 options 读 poison | `PATH_NOT_ALLOWED`（夹具有效性自证） | HEAD + 目标实现 |
| NC-2 | S21：预算覆盖到 poison | `PATH_NOT_ALLOWED`（预算不洗白不可表示值） | HEAD + 目标实现 |
| NC-3 | 干净夹具无 options 全量读 | 深等基线（S1/S6 的 2 参对照） | HEAD + 目标实现 |
| NC-4 | 合法 options + 路径缺陷（S18） | `PATH_NOT_ALLOWED` + path 回显；不被 options 分支掩盖 | HEAD + 目标实现 |
| NC-5 | 非法 options（S20 矩阵） | 必须 `READ_OPTIONS_INVALID`，不得 `ok:true` | 目标实现（HEAD 红） |
| NC-6 | 无 options 成功面 | 恰两键、无截断键 | HEAD + 目标实现 |
| NC-7 | 哨兵夹具的「预算内 poison 可读性」反证 | 同夹具 `depth:2` 必须红——证明 S19/S20 绿不是因为 poison 被静默吞掉 | 目标实现 |
| NC-8 | detached 折叠 vs 展开的对称性反证（S21 扩展） | 同夹具 `['holder'],{depth:2}` 与 `['holderArr'],{depth:2}` 必须 `PATH_NOT_ALLOWED`——证明 S19④ 的 `{ys:{}}` 不是把 detached 内容静默当空吞掉 | HEAD + 目标实现 |

### 12.9 测试路径与 runner

| 文件（worktree-relative） | 内容 | runner 发现实证 |
|---|---|---|
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts` | S1–S27 行为验收（**本版原位修订 S19④/O-1 断言 + 新增 `makeDetachedFoldDoc`/`instrumentPublicCount` 夹具助手**） | 已实证（临时同路径探针被 `vitest list` 发现，随后删除；SA3/本版均实跑） |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test-d.ts` | TD1–TD6 类型验收 | 已实证（`vitest run --typecheck` 认作 TS 文件并执行） |
| `packages/doc-runtime/test/read-logical-value-at-path-shape-budget-guards.test.ts` | §12.2 校验矩阵 + V2/V3 零触碰/零副作用 + 敌意 options | 同 include 规则（`packages/*/test/**/*.test.ts`） |
| `packages/doc-runtime/test/public-surface-type-guard.test-d.ts` | 加法：3 个新类型名目导入锚 | 既有 typecheck include |
| 既有 3 个读锚 + 类型锚 | **不得修改**，全绿 | 基线 75 tests 已绿 |

禁止：skip/only/todo、env override、fallback、吞错、软化断言、以源码字符串/正则断言代替行为断言（唯一例外：§12.2 的 accessor 副作用计数器、`doc.share.has('ROOT')` 零触碰观测、**本版 B16④ 的 own `size`/`length` accessor 计数器**——均为公共/载体可观测面的行为观测，非源码文本断言）。

### 12.10 所需证据（实施阶段的完成判据）

| # | 证据 | 判据 |
|---|---|---|
| E1 | 新套件在 HEAD 上的红灯根因 | 红必须是 TS2554（3 参）+ 目标行为断言失败；不得是模块/路径/fixture 错误 |
| E2 | 实施后新套件全绿 | 3 文件（含 typecheck）全绿、零 type errors。**本版注**：SA3 首轮唯一红 = S19④ 的不可满足前提（见 §13）；按 B16 施加 `budgetFold` detached 短路后全绿（503/503），S1–S18、S19①②③、S20–S27、TD1–TD6 与 guards 88 tests 均无需改动 |
| E3 | 负控全绿 | NC-1…NC-8（NC-5 为目标相位绿） |
| E4 | 无选项回归锚 | 既有 3 读锚 + 类型锚**未修改**且全绿；1:1 与基线一致 |
| E5 | 变异敏感（mutation / 反证） | 至少：m1 忽略 options（= 现状）→ 哨兵/形状红；m2 先全量物化再裁剪 → 哨兵红；m3 `omitted` 用后代数 → S24 红；m4 条件在场截断通道 → S7/S15 红；m5 `truncated` 恒 false → S2 红；m6 非法 options 返回 `PATH_NOT_ALLOWED` → S20 红；**m7 去掉 detached 折叠短路（恢复对 `doc === null` 实例读公共 `size`/`length`）→ S19④⑥ 计数器红、而 S19④④/⑤ 结果断言仍绿**（证明该断言对「无效访问」敏感、不是结果面的重复）；**m8 以内部 `_prelimContent` 计 detached 的 rawTotal → S19④④/⑤ 条目断言红（多出 omitted=1/3）**。逐条记录「施加变异 → 红 → 还原 → 绿」 |
| E6 | 范围证据 | `git diff --stat` 仅 §10 允许文件；runtime/vfsl/registry/wire/ValueSchema 零 diff |
| E7 | 公共面证据 | `index.ts` 仅加类型导出；`public-surface-guard.test.ts` 原样绿；type-guard test-d 加法锚绿 |
| E8 | 全量门禁 | `npx tsc -p packages/doc-runtime/tsconfig.json` exit 0；根 `pnpm typecheck` 绿；根 `pnpm test`（`vitest run --typecheck`）绿 |
| E9 | 规模形状 | S22 断言（10k 夹具）绿；**不引入计时断言** |
| E10 | 契约口径成文 | SA1 设计文档逐条锚定 §12.3/12.4/12.5 的解析项（B4/B5/B8/B15/**B16**、V1–V6、T1-1…T1-8、R1–R8/**R9**），不得静默偏移 |

### 12.11 SA6 解析项（ADR 未预设处的钉死口径 + 理由）

| # | 解析 | 口径 | 理由 / 依据 | 若 SA1 拟改 |
|---|---|---|---|---|
| R1 | 显式 `undefined` 第三参 | ≡ 无 options（2 键成功、逐字节现行） | JS 可选参数语义；`{depth:undefined}`（对象在场）才是预算读；类型层拒绝显式 undefined 以避免静态/运行时形状错配 | conflict recheck |
| R2 | 空容器 `D:0` 折叠 | 不记条目、`truncated:false`（detached 容器按 R9 落此条） | 决策 3「无截断时为空清单」优先于决策 1 的描述性「单条」句；`omitted≥1` 与 `truncated` 语义自洽 | conflict recheck |
| R3 | `omitted` raw 口径 | 含 undefined 值键的 raw 子槽数（`Y.Map.size` 实证）；plain object 数 own enumerable **data** 键；**detached 容器例外见 R9** | 决策 3 明文点名 `Y.Map.size`；投影键数会把吸收/accessor 排除混进计数 | conflict recheck |
| R4 | `D:0` 折叠 vs width 条目 | 折叠节点只记 depth 单条，不记 width | 决策 1「单条 depth 截断项」 | conflict recheck |
| R5 | 失败分支 `path` | `READ_OPTIONS_INVALID` **携带** path 新鲜回显 | 仓内失败通道统一回显 path（E100 亦回显，`read.ts:146-148`）；保 runtime 失败联合形状兼容 | conflict recheck |
| R6 | 条目顺序 | 不承诺稳定顺序；套件按 `(path,kind)` 多重集断言；`(path,kind)` 唯一 | ADR 未定；Y.Map 序明文不承诺 | 无需（契约已兼容任意序） |
| R7 | options 宿主 | 仅 `Object.prototype`/`null` 原型；数组/类实例/自定义原型 → 非法 | 封闭形状 + 零 accessor/原型纪律 | conflict recheck |
| R8 | options 键空间 | own enumerable string **data**；symbol/非 enumerable/继承忽略；accessor 键非法且不执行 | D5 同源 | conflict recheck |
| R9 | **detached 容器 `d===0`（本版裁决，消解 SA3 §7）** | 折叠照常（B15）；`rawTotal := 0` 且**零公共 count 读**；无条目、`truncated:false`、空清单；`d ≥ 1` 展开/保留物化 → 现行 detached 守卫 `PATH_NOT_ALLOWED` | `doc === null` 的 Yjs 容器无文档可观测子项；yjs 13.6.32 对未集成类型的 `size`/`length`/`keys()` 报 `Invalid access` 并回退 0（§5.4）——ADR-0024 决策 3 的 `size`/`length` 口径对未集成类型无定义值，故契约侧定义 0 且不依赖回退；prelim 内容（`_prelimContent`）非公共 API、非文档状态 | 已裁决（本版钉死）；SA3 唯一实现 delta = `budgetFold` 对 `instanceof Y.AbstractType && doc === null` 短路（结果面不变，见 §15） |

### 12.12 已否决备选

| 备选 | 否决理由 |
|---|---|
| 单联合加宽 `ReadLogicalValueResult`（含新码与新成功成员） | 2 参静态型含不可能码；经 `runtime.ts:119` Extract 泄漏到 runtime 公共面；迫使既有结构性别名改动（§12.4） |
| 截断通道条件在场 | 违反决策 3「恒在场」与 CONTEXT _Avoid_「条件在场」；消费方须靠 `in` 猜形状 |
| 嵌套单键（`truncation:{truncated,entries}`） | 迫使 T2 组合面多一层翻译、与决策 4 词汇（`truncated`/`truncations`）分叉 |
| `omitted` 记后代总数 | 需遍历被截子树，直接违背零物化（决策 1/3） |
| 在 `depth:0` 子项位使用 `{}`/`[]` 占位 | 决策 2 明文禁止（目标自身例外除外） |
| options 校验放 N0 之后 / 借 `PATH_NOT_ALLOWED` / 外抛 | 违反 V1/V2/V4/V6 与 ADR 决策 1 |
| 用「事后裁剪完整投影」实现预算 | 主判别哨兵必红（ADR 验收明文） |
| 以内部 `_prelimContent` 计 detached 容器的 raw 子项数（可让 S19④ 原 `omitted 1` 字面成立） | 依赖 yjs 私有实现（非公共 API）；把从未提交的 prelim 缓冲当文档内容计数，与 ADR-0008「读取只观察调用瞬间已提交的 live doc」冲突；字段消失/改名即崩溃并外显，跨版本脆弱——B16/R9 明文禁止 |
| 折叠前先走 detached 守卫（SA3 §7.4 选项 b：`['holder'],{depth:1}` / `['holder','ys'],{depth:0}` → `PATH_NOT_ALLOWED`） | 与设计 §7.3「detached 判别不前置」/ B15 / SA2 O-1 冲突；使 `depth:0` 骨架读变成**内容敏感**（未展开的 prelim 内容决定失败），违背「未展开分支零物化」与骨架读可用性；需重开 design 与 SA8 冲突复审 |
| 把 detached 容器的公共 count 读（`size`/`length`）当作 `omitted` 数据源（SA3 §7.4 选项 a 的机制面） | yjs 对未集成类型的这些读数标记 invalid access（0 为回退值 + 每次读产生诊断）；契约结果不得依赖该回退（B5/B8/B16）。结果口径与选项 a 相同，本版仅额外禁止该无效访问（唯一实现 delta = `budgetFold` 短路） |

## 13. Red/green or baseline evidence

**迭代 0（Feature 缺口证明，已取得）**：

| 证据 | 命令 | 结果 |
|---|---|---|
| 基线全绿 | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/doc-runtime` | 24 files / 374 tests / no type errors |
| 基线类型 | `npx tsc -p packages/doc-runtime/tsconfig.json` | exit 0 |
| 类型缺口（红） | `npx tsc -p packages/doc-runtime/.scratch-sa6-334/tsconfig.json` | TS2554 ×2（§5.1） |
| 运行时缺口（红） | `NODE_OPTIONS=--conditions=nomicore-source npx tsx packages/doc-runtime/.scratch-sa6-334/runtime-probe.ts` | §5.2（预算无操作 / 非法接受 / 无截断通道 / 哨兵失败） |
| 载体事实 | `…tsx …/facts-probe.ts` | §5.3 |
| 稳定性 | runtime probe ×3 | sha256 一致 `1b32b66005e6f234` |

**迭代 1（detached 裁决；SA6 亲跑，工作区 = SA3 实现 + 本版断言）**：

| 证据 | 命令 | 结果 |
|---|---|---|
| detached 载体事实（独立复现） | `node --input-type=module`（§5.4 探针 P0–P5） | 未集成容器全部公共读数恒空 + `Invalid access` 诊断；`size ≥ 1 ⟺ doc !== null`；`_prelimContent` 为唯一非公共存储；3 次重复逐字节一致 |
| 矛盾红灯（修订前） | `npx vitest run …shape-budget.test.ts` | `1 failed \| 32 passed (33)`；唯一红 = S19④ 的 `expected [] to deeply equal ['[["holder","ys"],"depth",1]']`（不可满足前提） |
| **修订后行为套件** | `npx vitest run …shape-budget.test.ts` | `2 failed \| 31 passed (33)`、`Type Errors no errors`。**S19④ 结果面全绿**（`{ys:{}}`、`{ys:[]}`、`truncated:false`、`truncations:[]`）与 **O-1 结果面全绿**；唯一 2 红 = B16④ 新增的零公共 count 读断言（`expected 1 to be +0`，当前实现读 `size`/`length` 各 1 次） |
| 负控 | 同上 + 既有锚 | NC-1/2/3/4/5/6/7/8 全绿（NC-5 = guards 校验矩阵 88 tests，SA3 §6.2；含 S21 扩展的 `['holderArr'],{depth:2}` 响亮失败） |
| 类型面 | `npx tsc -p packages/doc-runtime/tsconfig.json`；`pnpm typecheck`（root） | **两者 exit 0**（own accessor instrumentation 与修订后的全测试文件类型面通过；14 个 package tsconfig 全过） |
| 全套 doc-runtime | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/doc-runtime` | `Test Files 1 failed \| 26 passed (27)`、`Tests 2 failed \| 501 passed (503)`、`Type Errors no errors`——**除 B16④ 两条断言外全部绿**；SA3 首轮的 S19④ 条目红已消除 |
| 断言敏感性（机制面） | 探针 P4 + 上述红/绿对照 | 当前实现计数器 = 1 → B16④ 红；结果面断言对机制不敏感（读/不读回退值结果相同）→ 两族断言互补，非重复 |
| 根门禁（E8） | `pnpm typecheck`；`pnpm test` | typecheck **exit 0**（14 个 package tsconfig）；root test `Test Files 1 failed \| 340 passed (341)`、`Tests 2 failed \| 3715 passed (3717)`、`Type Errors no errors`——唯一红 = B16④ 两条计数器断言（A-1 落地后 → 341/341 文件、3717/3717 tests 全绿） |

**下游（目标相位）**：SA3 按 B16④ 在 `budgetFold` 加 detached 短路（见 §15）→ 全套件绿（其余 501 tests 与全部断言零改动）；E5 m1–m8 逐条红/还原绿。

## 14. Runner trigger evidence

- 根 runner：`vitest.config.ts` → `test.include = ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts']`；`test.typecheck.include = ['packages/*/test/**/*.test-d.ts', …]`，`tsconfig: ./tsconfig.typecheck.json`；`pnpm test` 带 `--typecheck`。
- 实际发现：`npx vitest list packages/doc-runtime` 列出全部 24 个 doc-runtime 测试文件（含 3 个读锚与 1 个 test-d）。
- **拟新增路径实证**：临时创建 `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts` 与 `…test-d.ts`（各 1 条 trivial 探针）→ `vitest list` 两者均被列出；`vitest run --typecheck <两文件>` → `2 passed`、`Type Errors no errors`；**随后已删除**（§16）。
- 结论：§12.9 的路径与仓库真实 package/测试入口一致，无需额外配置。
- **迭代 1 复核**：`NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/doc-runtime` 收集 **27 个文件**（SA3 新增 3 个：shape-budget `33`、guards `88`、test-d `7`），修订后的行为文件仍被发现并执行（`Tests 2 failed | 501 passed (503)`，唯一红 = B16④ 两条计数器断言）；`vitest list` 与 `--typecheck` 行为不变。

## 15. Unknowns and blockers

**阻塞项**：无。SA3 §7 记录的「S19④ 与 S21/B5 互斥」已由本版裁决消解（§0.1 / B16 / R9）：契约内不再有任何不可满足断言，且全部断言与 ADR-0024、设计 §7、SA2 O-1、SA8 冻结面一致。

**本版裁决对齐（SA3 唯一待办，非 SA6 权限内）**：

| # | 待办 | 精确落点 | 判据 |
|---|---|---|---|
| A-1 | `budgetFold` 对 detached Yjs 容器短路（B16④/R9）：`Y.Map`/`Y.Array` 且 `doc === null` → `{ rawTotal: 0, empty: {} / [] }`，**不读** `size`/`length`/`keys()` | `packages/doc-runtime/src/read.ts` 的 `budgetFold`（SA3 落地为 L578-582）加 `doc === null` 前置分支（约 2–4 行；`projectValue` 折叠前置与 detached 守卫的先后**不变**） | 修订后 `…shape-budget.test.ts` 由 `2 failed \| 31 passed` → 全绿；结果面断言不因该改动变化（§13 已证） |
| A-2 | 其余实现**零改动** | S1–S18、S19①②③、S20–S27、§12.2 矩阵 88 tests、TD1–TD6 已全绿；既有 5 个锚 + `public-surface-guard.test.ts` 未改 | 全套件绿（§13 迭代 1 基线 + A-1） |

**需 SA1 设计成文/锚定的解析项**（本契约已给口径，见 §12.11 R1–R9）：B4 空容器/detached 折叠条目、B5/B8 raw 计数与零物化边界（含 B16 detached 例外）、V1–V6 options 边界与失败字段、T1-1…T1-8 类型面、R5 失败分支 path。**任何偏移都必须走 conflict recheck**（SA8 §10 已置 `requiresConflictRecheck=true`，本契约维持 **true**：公共 API 可加性扩展 + 新失败语义 + 新导出类型面 + 本版新增的 detached 计数口径）。

**备选机制面（已否决，留档）**：若 SA3/SA1 主张「允许读 detached 的公共 count（yjs 回退值 0）」而不加短路（SA3 §7.4 选项 a 的机制面），必须走 conflict recheck 并明示：结果面与本版相同，但契约将重新依赖 yjs 的 invalid-access 回退值（§12.12 第三行给出否决理由）。**折叠先于 detached 守卫（选项 b）** 与设计 §7.3/B15/SA2 O-1 冲突，需重开 design 复审。

**依赖/边界（非 T1 义务）**：
- T2 runtime `readData` 五键（决策 4）+ lease 透传、T3 `resolveSchemaAtPath` 同 depth 裁剪（决策 5）、T4 `DeepOptional`（决策 7）、T5 registry 文档负控正则与 docs/integration 形状注记——T1 只提供 doc-runtime 预算面与截断事实通道，**不抢先实现**。
- SA8 N-1/N-2（ADR-0008/0016 镜像修订节、CONTEXT「载体投影读取」词条补三参句）为**非阻塞 docs 债**，不属 T1。

**已知非承诺面（契约不依赖）**：
- `Y.Map` 子项序跨版本不稳定 → 精确前缀断言仅用于 `Y.Array`/plain array，`Y.Map` 用现场 `keys()` 派生期望（S12）；
- 条目顺序不承诺（R6）；
- 深层递归链（数万层）的栈行为属环境敏感观察项，不进验收门禁（§7）。

## 16. Temporary diagnostics cleanup

| 临时物 | 路径 | 处置 |
|---|---|---|
| 迭代 0：运行时/类型/事实/TS 语义探针 | `packages/doc-runtime/.scratch-sa6-334/{runtime-probe.ts,type-probe.ts,facts-probe.ts,ts-semantics-probe.ts}` + 3 个 probe tsconfig | **已删除**（`rm -rf …/.scratch-sa6-334`） |
| 迭代 0：探针输出存档 | 同上 `.out` | 已删除；逐字证据已固化于本报告 §5/§7 |
| 迭代 0：runner 发现探针（2 个临时测试文件） | `packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts` / `.test-d.ts` | 已删除（证据见 §14）；随后由 SA3 正式落成同路径验收文件 |
| 迭代 1：detached 折叠诊断探针（P0–P5） | `packages/doc-runtime/.scratch-sa6-334-r2/detached-fold-probe.ts` | **已删除**（`rm -rf …/.scratch-sa6-334-r2`，`ls` 零命中）；逐字输出已固化于 §5.4/§9 X7/§13 |
| 迭代 0：**事故性 tsc emit** | 因 `extends` 路径笔误回退默认 `noEmit:false`，向 `packages/doc-runtime/src/` 生成 17 个 `.js` | **已全部删除**；删除后重跑全量 doc-runtime 套件与 `tsc`（exit 0）确认无残留 |
| 后台服务/进程 | 无（未启动任何服务；本轮 4 个 vitest/tsc job 全部 completed，无遗留进程） | — |
| 生产实现 | **未修改**：`git diff` 与 SA3 交付态逐字节一致（`src/index.ts +7`、`src/read.ts +412/−34`、`public-surface-type-guard.test-d.ts +15`；`git diff packages/doc-runtime/src` sha256 `f3fb6922…02df`） | — |

**收尾核验**（本轮结束时）：

```
$ git status --short
 M packages/doc-runtime/src/index.ts
 M packages/doc-runtime/src/read.ts
 M packages/doc-runtime/test/public-surface-type-guard.test-d.ts
?? packages/doc-runtime/test/read-logical-value-at-path-shape-budget-guards.test.ts
?? packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test-d.ts
?? packages/doc-runtime/test/read-logical-value-at-path-shape-budget.test.ts
?? wiki/raw/task_issue-334.md
?? wiki/raw/task_issue-334_conflict_report.md
?? wiki/raw/task_issue-334_design.md
?? wiki/raw/task_issue-334_relevant_decisions.md
?? wiki/raw/task_issue-334_sa2_review.md
?? wiki/raw/task_issue-334_sa3_impl.md
?? wiki/raw/task_issue-334_sa6_contract.md

$ ls -d packages/doc-runtime/.scratch-sa6-334*
ls: cannot access 'packages/doc-runtime/.scratch-sa6-334*': No such file or directory

$ find packages/doc-runtime -name "*.js" -path "*/src/*"
（零命中）
```

`M` 三行与 3 个 `shape-budget*` 新测试文件均为 SA3 交付态（本版零生产改动，仅 `read-logical-value-at-path-shape-budget.test.ts` 内 S19④/O-1 断言与夹具注释原位修订；`git diff packages/doc-runtime/src` sha256 `f3fb6922…02df` 与 SA3 交付一致）。

—— 报告结束 ——
