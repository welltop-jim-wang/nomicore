# [Bug] readLogicalValueAtPath Phase B union 仲裁「合法缺席遮蔽后序实际值」可达性核实（PR #83 owner Review rev1）

**Status**: analyzed | **Date**: 2026-08-22
**Severity**: low（报告缺陷本身不可达；修订定性为防御性语义硬化）
**Type**: architecture（仲裁策略层语义缝隙，非可达数据缺陷）
**Layer**: backend（`@nomicore/doc-runtime` 读取路径）

**关联**: `task_read-logical-value-at-path_rev1.md`（owner Review 简报）；`task_read-logical-value-at-path_rev1_conflict_report.md` 注记 1/2（SA8 前置门禁实证注记，本次独立复核对象）

## Symptoms

Owner（PR #83 Review，Request changes）报告 P1 正确性缺陷：Phase B union 仲裁以首个 `r.ok` 为胜者（read.ts:343-349），而 Record 缺键（read.ts:323-325）与 optional 缺席（read.ts:329-334）都返回成功的 `undefined`，因此**前序成员的"合法缺席"会短路 union 成员试探，遮蔽后序成员中实际存在的值**。owner 给出最小反例：`U = Record<string, YLeaf<string>> | { foo: YLeaf<string> }`、live `x = Y.Map({ foo: "v" })`、读 `['x','foo']` → 声称返回错误的 `undefined`。

**本次核实结论：该症状在现行实现与现行结构系统内不可达——owner 反例实际返回正确的 `"v"`。** SA8 门禁注记 1 的实证注记（"不复现"）经独立复现确认成立。

## Reproduction

隔离实证（tsx 直跑 worktree 源码；脚本置于 `/tmp/sa5-repro/`，用后已删除；worktree 源码零改动，`git status -- packages/` 干净）。fixture 经 `parseVfsl → evaluate → derived` 公共管线构造，doc 经 `new Y.Doc()` + `doc.getMap('ROOT').set('x', …)` 构造——与既有测试同款 harness。

24 项断言矩阵全部 PASS（代表项）：

| # | fixture（union 成员序） | live x | 读取 | 实际结果 | owner 预期（若缺陷可达） |
|---|---|---|---|---|---|
| 1a | `Record<string,YLEAF> \| {foo:YLEAF}`（Record 先） | `Y.Map({foo:"v"})` | `['x','foo']` | **`{ok:true, value:"v"}`** | `value:undefined`（**不复现**） |
| 1b | 交换序（封闭先） | 同上 | `['x','foo']` | `{ok:true, value:"v"}` | — |
| 1c/1d | 两序 | `Y.Map({})`（真缺席） | `['x','foo']` | `{ok:true, value:undefined}`（value 键显式存在） | —（正确） |
| 2a-2f | `{foo?:YLEAF} \| {foo:YLEAF}` 及变体（optional 先/后、vs Record） | `{foo:"v"}` / `{}` | `['x','foo']` | 在场→`"v"`；缺席→`undefined` | 无遮蔽 |
| 3a | Record 先 | `{foo: Y.Map({})}`（载体错位） | `['x','foo']` | `{ok:false, PATH_NOT_ALLOWED}`（reject 正常穿透成员） | — |
| 3b/3c | `Record \| {bar:YLEAF}` | `{bar:"w"}` / `{}` | `['x','bar']` | `"w"` / `undefined` | 无遮蔽 |
| 4a-4d | `YArray \| YArray`、`YArray \| Record` | `[]` / `["v"]` | `['x',0]` | 越界→`undefined`；在场→`"v"` | 无遮蔽 |
| 5a/5c | `{foo?:YLEAF} \| {bar:YLEAF}`、`\| YArray` | `{bar:"w"}` / `{}` | `['x','foo']` | `undefined`（mixed missing+reject：missing 胜） | — |
| 6a/6b | F1 两序 | `{foo:"v",bar:"w"}` | `['x']`（终点=union） | Record 先→`{foo:"v",bar:"w"}`；封闭先→`{foo:"v"}`（**交换序合法改变投影**） | — |
| 6c/6d | F1 两序 | 同上 | `['x','foo']`（终点=leaf） | 两序均 `"v"`（swap 不变式成立域） | — |

边界探针：

- **E309 探针**：`{ foo?: YLeaf<string> } | YLeaf<string>`（map 形 | 标量形混合联合）被 VFSL parser 拒绝——`VFSL-E309: 同步物化上下文混合联合：标量形与容器形并存`。结构系统在源头即禁止标量/容器形成员并存，进一步约束成员形状分歧空间。
- **yjs undefined 探针**：`Y.Array.insert([undefined])` 在 yjs 层即抛 `Cannot read properties of undefined (reading 'constructor')`——**显式 undefined 数组元素经公共 API 不可构造**，`ya.get(seg)`（`seg < length`）恒非 undefined，read.ts:340 越界是数组上唯一 undefined 源。`Y.Map.set('foo', undefined)` 可存（`has===true`），读路径按 D4「`get()===undefined` 视同缺席」→ `value:undefined`，与 extract walk 跳过 undefined 值（extract.ts:107/118）语义一致，两成员同见同判。

基线回归：`vitest run read-logical-value-at-path.test.ts read-logical-value-at-path-supplementary.test.ts` → **48/48 通过**（含 SUP-1 XML 情形）。

## Investigation

阅读链（≤10 文件纪律内）：`read.ts`（全文）→ `extract.ts`（walk/walkUnion/trialMember）→ `carrier.ts`（carrierOf 五值词汇表）→ 补充测试 harness（fixture 构造模式）→ rev1 简报 + SA8 冲突报告注记。数据流追踪分三层：

1. **Phase A**（read.ts:130-204）：纯 schema 许可判定，union 位 `members.some(...)`（read.ts:194）any-of 短路——许可与缺席无关，修订不触。
2. **Phase B 导航**（read.ts:267-357）：`navigate` 对 live 的全部读取只有三处形态——`ymap.get(seg)`（read.ts:323/329）、`ya.get(seg)`/`ya.length`（read.ts:339-341）。**成员形状不参与 live 读取**；容器下钻每层恰消耗一个段，root/union/ref 仅委托零消耗。
3. **终点转换**（read.ts:304-308 → extract.ts `walk`）：路径耗尽处复用 extract 单一转换语义源（D7）；快照构造点枚举：Record→`{}`（extract.ts:104-112）、封闭 map→`{}`（115-123）、数组→`[]`（128-134）、xml→字符串（137-138）、leaf/plain→`copyPlainValue`（对实际在场值）——**恒非 `undefined`**。

由此形成并验证了两条假设：(H1) owner 反例的步骤 1 前提（Record 成员把在场的 `foo` 解释为缺失键）不成立——`ymap.get('foo')` 返回 `"v"` 非空，Record 成员直接下钻 leaf 产出真值（实证 1a）；(H2) 三源缺席均为 **live 数据事实**而非成员形状事实，故不可能出现"前序见缺席、后序见在场"（下述结构性论证 + 24 项矩阵实证）。

## Root Cause

**结论 (a)：owner 报告的缺陷在现行结构系统内不可达。** 行号引注属实、缺陷机理描述属实（若可达，短路确会遮蔽），但触发前提不可构造。严格论证（四步）：

1. **live 导航确定性**：深度 k 处的 live 值 `live_k` 是 `(ROOT live, segs[0..k-1])` 的纯函数——每步读取仅 `child(live_{k-1}, segs[k-1])`，成员形状零参与。一切存活到深度 k 的成员看到**同一个** `live_k`。
2. **段消耗无跳跃**：容器下钻每层恰耗一段；路径耗尽（`i === n`）必须经过全部 n 段，任何成员都不能少耗段抵达终点（root/union/ref 零消耗仅委托）。
3. **`value:undefined` 三源皆为 live 缺席事实**：read.ts:324（Record `get(seg)===undefined`）、read.ts:331（optional `get(seg)===undefined`）、read.ts:340（`seg >= ya.length`）——三者读的都是 live 容器状态，与成员形状无关；终点 walk 快照恒非 undefined（Investigation 第 3 层枚举 + yjs 探针：显式 undefined 数组元素公共 API 不可构造、map 显式 undefined 值被 D4 先收）。另 E309 在结构系统源头禁止标量/容器混合联合。
4. **归谬**：设成员 j 以合法缺席胜出 ⟹ 存在深度 `k < n` 使 `live_k` 在 `segs[k]` 上缺席。任一后序成员 m′ 或在深度 k 前已拒（载体错位/封闭 map 未声明字段/数字段非数组成员——D9），或到达深度 k 面对同一缺席（同样 missing 或 reject）——**m′ 不可能产出真实 value**。∎

**推论（两仲裁策略观测等价）**：对一切合法输入，现行「首个 ok 胜」与 owner「value-first」仲裁返回完全相同的结果——(i) 首 ok 为真值 X 时，X 亦为首真值（此前无任何 ok），同取 X；(ii) 首 ok 为 missing 时，由上述归谬无任何成员可产真值，value-first 落入「非全拒 → undefined」，同为 `{ok:true, value:undefined}`。分叉面仅存于手造派生物（Phase A `some()` 短路可跳过 value-first 会新增试探的 lockstep-断裂成员 → E100），合法 derived（parseVfsl+evaluate 产物）锁步结构保证不触。

**结论 (b)：本次修订的性质界定 = 防御性语义硬化**（在策略层封死「missing 短路」类病态，无论当前可达与否），与 ADR-0003「路径存在性为任一成员出现即存在」读取维度兑付同向，**对合法输入零可观测行为变更**。仍需在设计中成文（AC-R3）的真实语义缝隙：

1. **mixed missing+reject 优先级**（SA8 注记 2 开放点）：现行实证 = missing 胜 → `undefined`（5a/5c）；owner 规则 3 的「可行成员」未定义。建议成文：reject 成员非可行；可行成员存在 missing 且无 value → `ok:true, value:undefined`；全部成员 reject → `PATH_NOT_ALLOWED`（与现行行为及 owner 规则 2-4 同时相容）。
2. **INV-7 精确化**：「首个可产出者胜」→「可产出 = 产出真实 value；missing 不构成胜出」——纯措辞立法，行为不变。
3. **swap 不变式范围**：仅终点为叶子/标量的多段读成立（6c/6d）；终点为 union 自身的整树投影在重叠成员上交换序**合法改变结果**（6a/6b，ADR-0003 重叠合法性 + extract INV-8 声明序平局裁决）。
4. **硬化风险清单**：value-first 扩大成员试探集 → SA1 须重述 D13 memo 健全性与多项式上界（SA8 注记 4）；手造派生物 E100 面轻微扩大（防御域，不涉合法输入）。

**结论 (c)：对 SA6 红灯测试可构造性的明确建议**：

| owner 要求的测试 | 可构造性 | 建议 |
|---|---|---|
| 前序 Record 缺键 vs 后序封闭 map 字段在场 | **不可构造红灯**（后序字段在场 ⟹ 同一 live 下 Record `get` 同键必有同值并直接产出，1a/3b） | 降级：**绿灯行为锁**（两序均返回真值 `"v"`——防未来实现把在场合键误判缺席）+ 设计文档论证性覆盖 |
| 前序 optional 缺席 vs 后序实际值在场 | **不可构造红灯**（optional 缺席 ⟹ `live.get(k)===undefined` ⟹ 后序同见 undefined，2a-2f） | 同上：绿灯锁（optional 成员对在场值直读 `"v"`）+ 论证性覆盖 |
| 前序数组越界 vs 后序可解析同一路径 | **不可构造红灯**（结构性地：数字段仅数组成员可接受（D9），同位数组成员读同一 `ya.length` 同界，4a-4d；owner 本人亦附「若结构系统允许」保留） | 同上：绿灯锁（越界→`undefined`、界内→真值，与成员序无关）+ 论证性覆盖；设计文档成文「该竞争结构性不可达」 |
| 全部可行成员合法缺席 → `ok:true, value:undefined` | **可构造**（1c/1d/2c/2d/2f/3c/4a/4c 均为真复现） | 直接落测（含 value 键显式存在断言） |
| 交换声明序结果不变 | **限域可构造**：仅终点为叶子/标量的同 live 读（6c/6d） | 落测但**必须限定范围**；禁止对终点=union 的重叠成员投影写 swap 不变（6a/6b 反例在案，否则与 ADR-0003 相抵） |

SUP-1（AC-R5）不受修订影响：其走路径耗尽处 `walkUnion`（extract 提交层仲裁），不经中段 `navigate` union 循环。

**结论 (d)：行号引注复核**——三处引注全部准确：read.ts:323-325 = Record 形 live 读取 + 缺键吸收式短路 + 下钻（L323 `const v = ymap.get(seg)`；L324 `if (v === undefined) return { ok: true, value: undefined }`；L325 下钻）；read.ts:329-334 = 封闭 map live 读取、L330-333 optional 缺席→成功 undefined / required 缺席→`{ok:false}`、L334 下钻；read.ts:343-349 = union 声明序循环、L347 首个 `r.ok` 即胜、L349 全拒 `{ok:false}`。引注无偏差；不可达的是缺陷触发前提，非行号定位。

**Fix direction**（供 SA1 设计参考，不展开实现）：按 AC-R1/R2 落地 `NavOutcome` 三态（value/missing/reject 或等价机制）与 value-first 仲裁，作为**行为不变的防御性硬化**实现；设计中成文上述等价性论证与 (b) 四点缝隙裁决；SA6 按 (c) 表落测（三组降级为绿灯锁 + 论证覆盖，两组直接落测）。不得为凑红灯测试虚构 fixture 或放宽结构系统。

## Evidence

- 实证脚本（已删除，worktree 零改动）：`/tmp/sa5-repro/union-arbitration-repro.ts`（24 断言矩阵）、`/tmp/sa5-repro/edge-probes.ts`（E309/yjs-undefined 探针）；运行命令 `tsx`（worktree `node_modules/.bin/tsx`），输出 `=== 汇总: 24/24 PASS ===`。
- 关键输出摘录：
  - `1a F1(Record 先) x={foo:"v"} read [x,foo] → ok:true value="v"`（**owner 反例不复现的直接证据**）
  - `[E309 探针] map|leaf 混合联合被结构系统拒绝: VFSL-E309: 同步物化上下文混合联合：标量形与容器形并存`
  - `[探针a] Y.Array.insert([undefined]) → Cannot read properties of undefined (reading 'constructor')`；`[探针b1] read [x,foo] → ok:true value=undefined`（map 显式 undefined 值 = D4 缺席）
  - `6a → {"foo":"v","bar":"w"}` vs `6b → {"foo":"v"}`（swap 合法变值域证据）；`6c/6d → "v"`（swap 不变域证据）
- 基线：`vitest run packages/doc-runtime/test/read-logical-value-at-path.test.ts packages/doc-runtime/test/read-logical-value-at-path-supplementary.test.ts` → `Test Files 2 passed (2), Tests 48 passed (48)`。
- 现场清理：`rm -rf /tmp/sa5-repro` 完成；`git status -- packages/` 无输出（源码零改动）；worktree 内既存流水线产物（wiki/raw rev1 系列文件）未触碰。
