# 派生 schema 不携带 docs（ADR 0005 §3 契约缺口）+ typeCls 调用惯例发散

**Status**: analyzed | **Date**: 2026-08-19
**Severity**: medium（阻塞下游 F2 TSDoc 发射与 Phase 4 namespace card 的数据源；不影响既有 253 用例的运行时行为）
**Type**: new-feature-defect（docs 携带决策形成于 issue #20 发布之后、未入 PR #28 正文；PR #28 合入 commit `40c1be0` 落地求值器时该契约尚不存在——runner 无责，非回归）
**Layer**: backend（`packages/vfsl` 库内契约缺口 + 内部件调用惯例）

## Symptoms

1. **docs 断流（主症状）**：`evaluate` 产出的派生 schema 全程不携带 JSDoc 原文。以规格 §10 fixture（7 处 docs：6 个别名级 + `ROOT.notes?` 字段级 1 处）求值，派生 schema JSON 序列化文本（9811 字符）中 `"docs"` 键出现次数为 **0**。下游消费者（票 F2 生成器发射 TSDoc、Phase 4 AI namespace card）无数据可读。
2. **typeCls 调用惯例发散（Standards 轴次要症状）**：`typeCls(t, cls, bodies)` 以自由函数形态从 `resolve.ts` 导出，调用方需解包 `Resolver` 的 `cls` / `bodies` 两个成员传参；而同一 `Resolver` 上的另一查询 `resolveChain` 已收敛为方法形态。零行为影响，纯调用惯例不一致。

## Reproduction

诊断路径（临时测试 `packages/vfsl/test/sa5-diag-docs-repro.test.ts`，`[SA5-DIAG]` 标记，已还原删除）：

1. 基线：根目录 `pnpm test` → **10 文件 / 253 用例全绿**（缺口是"缺特性"而非"既有断言失败"，与 new-feature-defect 定性一致）。
2. 取规格 §10 fixture 全文，`parseVfsl(text)` → `ok: true`。
3. 断言 IR 三锚位已捕获 docs（见 Evidence 第 1 节）——**上游捕获正常**。
4. `evaluate(module)` → `ok: true`；`JSON.stringify(derived)` 中 `/\"docs\"/g` 计数 = **0**——**缺口成立**。
5. 直接查看 `derived.aliases.Audit` 与 `structure.node.fields[...notes]`：节点对象中无 docs 槽位（见 Evidence 第 2 节）。

## Investigation

阅读文件（≤10 上限内）：`ir.ts`、`derived.ts`、`evaluate.ts`、`resolve.ts`（+ `shapes.ts` 局部 grep 对照惯例）、任务简报、规格 §10。

**数据流追踪**（断点定位）：

- **产生**：tokenizer/parser 已将 docs 写入 IR 三锚位——`VfslAlias.docs`（`ir.ts:26`）、`VfslField.docs`（`ir.ts:36`）、marker `.docs`（`ir.ts:55`），均必填、无注释为空数组（§7.2 纪律；`parse-vfsl-jsdoc.test.ts` 7 用例守护）。
- **转换（断点所在）**：`evaluate.ts` 全部构造点丢弃 docs——
  - `evaluate.ts:53` 别名表物化：`aliases[a.name] = structureOf(a.type, ctx, null)`，`a.docs` 未读；
  - `evaluate.ts:160-168` `materializeObject`：`MapField` 只构造 `{name, optional, node}`，`f.docs` 未读（联合成员为内联 object 时同经此路径，故"联合成员内字段位"同样断流）；
  - `evaluate.ts:112-125` marker 分支 + `evaluate.ts:204-211` `terminalOf`：marker 的 `t.docs` 未读；
  - `evaluate.ts:271-277` `valueOf` object 分支：`ValueField` 只构造 `{name, value}`，`f.docs` 未读；
  - `evaluate.ts:296-308` `valueOf` marker 分支：`t.docs` 未读。
- **消费**：类型面即无槽可容——`derived.ts` 的 `StructureNode` / `MapField` / `ValueSchema` / `ValueField` / `IndexEntry` / `DerivedSchema`（`derived.ts:26-78`）无任何 docs 字段。断点是"类型无槽 + 构造点不读"的双侧缺口，非单点遗漏。
- **JSON 往返**：派生 schema 为纯数据（`derived.ts:8`），增补 `docs: string[]` 不破坏序列化纪律。

**typeCls 考古**：

- 签名 `resolve.ts:129`：`typeCls(t, cls, bodies)`——自由函数，吃解包后的两张表。
- 全部调用点：`evaluate.ts:106`、`evaluate.ts:140`，均为 `typeCls(t, ctx.R.cls, ctx.R.bodies)` 解包形态；内部递归 `resolve.ts:144`。
- 对照先例：`resolveChain` 已挂为 `Resolver` 方法（`resolve.ts:52` 构造闭包），`evaluate.ts` 中 `ctx.R.resolveChain(t)` 直接调用（`evaluate.ts:79/:94/:131/:318`）。**同一 Resolver 状态出现两种访问形态，typeCls 是唯一发散点**。
- `resolve.ts` 是内部件（`index.ts` 公共面仅导出类型、`evaluate`、`parseVfsl`，grep 确认无 resolve 符号）→ 签名收敛不构成公共 API 破坏。
- 惯例锚：任务简报引 shapes.ts「查询只经自含助手」；实证 shapes.ts 的纪律形态是**单一查询网关**（`shapes.ts:9`「E304/E309 的一切查询位只经 clsOf」、`shapes.ts:130`「localCls 不接受 ref/union，查询位必须经 clsOf」），且 `resolve.ts:103` 已有同款措辞。注意 `shapes.ts` 的 `clsOf` 本身也是自由函数——本票收敛的对齐目标是 **Resolver 内聚**（resolveChain 先例），报告如实记录以免 SA1 过度对齐。

**观察项评估（任务简报第 3 条，非必须）**：`detectDiscriminator`（`evaluate.ts:220-257`）在 `evaluate.ts:222` 以 `t.members.every((m) => m.kind === 'object')` 只认内联 object 成员。放宽到 ref 成员技术上可行：对每成员 `resolveChain` 取终形后按同一 (a)(b)(c) 判据处理（文法保证成员恒非内联联合，`resolve.ts:143`）；判别式是非契约缓存（`derived.ts:17` 引 ADR 0003 §3：缺失/存在不改变消费者可观测契约），故放宽只影响 JSON 文本不影响契约。规格 §10 fixture 的 `AssetEntity` 成员全为内联 object，现判据已覆盖——放宽属增量收益，纳入与否交 SA1 评估。

## Root Cause

**主根因（契约缺口）**：派生 schema 类型族自 ADR 0003 冻结以来无 docs 槽位（`derived.ts:26-78`），`evaluate` 的全部节点构造点（`evaluate.ts:53/:160-168/:112-125/:271-277/:296-308`）因此不读 IR docs。时序：docs 携带决策（issue 正文称 ADR 0005 §3，该 ADR 未入库，权威内容以任务简报「工作内容 1」为准）形成于 #20 发布之后，PR #28（`40c1be0`）落地时无此契约——属新增契约未落地，非实现偏差。

**次根因（惯例发散）**：`typeCls` 在 `resolve.ts:129` 以解包签名导出，未随 `buildResolver`（`resolve.ts:37-54`）收敛为 Resolver 方法，导致 `evaluate.ts:106/:140` 两处解包传参。

**Fix direction**（供 SA1 设计参考，不展开具体实现方案）：

1. derived 类型族在**别名 / map 字段 / 标记位**三锚（与 IR 三锚位对应）增加必填 `docs: string[]`（无注释为空数组，对齐 IR §7.2；`exactOptionalPropertyTypes` 纪律下用必填而非可选键）；`evaluate` 从 IR 对应节点逐字继承，覆盖联合成员内字段位与标记实参位。别名级 docs 的具体承载位置（现 `DerivedSchema.aliases` 条目为 `StructureNode`，其自身无别名槽）需 SA1 定形。
2. `typeCls` 收敛为 Resolver 方法（沿 `resolveChain` 先例），调用方不再解包 `ctx.R.cls` / `ctx.R.bodies`，内部递归闭包化。
3. 观察项（判别式放宽到 ref 成员）由 SA1 评估决定是否纳入本票；不纳入不阻塞。
4. 约束提醒：`packages/vfsl` 现版本 0.1.5，改动须 bump patch（Hard Gate 9）；253 存量用例须保持全绿（本底已验证）。

## Evidence

**1. IR 三锚位捕获正常**（诊断测试输出，fixture = 规格 §10 全文）：

```
[SA5-DIAG] IR alias docs (ROOT): [" ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 "]
[SA5-DIAG] IR field docs (ROOT.notes): [" @semantic 可选说明字段 "]
[SA5-DIAG] IR marker docs (Audit=YMap<...>): []
```

**2. 派生侧 docs 计数 = 0（缺口复现）**：

```
[SA5-DIAG] derived JSON 总长: 9811
[SA5-DIAG] derived JSON 中 "docs" 键出现次数: 0 (期望 >0，实际=0 即缺口成立)
[SA5-DIAG] aliases["Audit"] = {"kind":"map","fields":[{"name":"createdBy","optional":false,"node":{"kind":"leaf"}},{"name":"createdAt","optional":false,"node":{"kind":"leaf"}}]}
[SA5-DIAG] structure(ROOT).node.fields[notes] = {"name":"notes","optional":true,"node":{"kind":"leaf"}}
```

**3. 基线**：`pnpm test` → `Test Files 10 passed (10)` / `Tests 253 passed (253)`，Duration 2.81s。

**4. typeCls 调用点全景**（grep 全仓）：

```
packages/vfsl/src/resolve.ts:129:export function typeCls(t: VfslType, cls: Map<string, Cls>, bodies: Map<string, VfslType>): Cls
packages/vfsl/src/resolve.ts:144:  return fold(t.members.map((m) => typeCls(m, cls, bodies)));   // 内部递归
packages/vfsl/src/evaluate.ts:106:  if (typeCls(t, ctx.R.cls, ctx.R.bodies) === 'scalar') ...  // 解包调用 ①
packages/vfsl/src/evaluate.ts:140:  if (typeCls(r, ctx.R.cls, ctx.R.bodies) === 'scalar') ...  // 解包调用 ②
```

对照：`resolveChain` 已为 Resolver 方法（`resolve.ts:52`），调用形态 `ctx.R.resolveChain(t)`（`evaluate.ts:79` 等 4 处）。

**5. 公共面检查**：`grep -n "resolve|typeCls|Resolver" packages/vfsl/src/index.ts` → 无匹配（exit 1），`resolve.ts` 内部件未进公共导出，签名收敛无公共 API 影响。

**6. 现场清理确认**：诊断测试文件已删除；`git status --short` 仅余调度器自身 `TASK.md` 改动与任务简报未跟踪文件；`git diff --stat` 无本 SA 残留。

---

*SA5 故障分析 · 分析用时约 6 分钟 · 复现回路（红测试形态）已在 Evidence 1-2 节完整留档，供 SA6/SA3 直接转正为验收断言。*
