# SA4 静态验尸报告

**Date**: 2026-08-20
**Verdict**: pass
**审查对象**: SA3 commit `f071f3e`（基线 `adr/union-representation` @ `40c1be0`，`mabf.base-branch` 配置核实）
**输入**: 任务简报 + SA5 报告 + SA1 R2 设计 + SA2 R1/R2 评审 + 红灯测试文件 + 实际 diff

## 审核方法声明

未转引 SA2/SA1 的任何推演结论作证据。独立重做：diff 全量逐行阅读、ALLOW/DENY set 比对、typeCls/DerivedSchema 消费面 grep 复跑、E306 拦截链与 claimDocs 调用点源码复核、**全量测试与 typecheck 后台独立进程实跑**、以及一次性动态探针（§4.5 排序全键集 + 三锚守卫 E100，跑完即删、git status 复核无残留——探针不是交付物，结论如下）。

## 逐项结论

### 0. Scope Creep Guard（§1.1）

- **ALLOW LIST 在位**（设计 §9）。actual diff（`40c1be0..HEAD`）恰 5 文件：`packages/vfsl/{package.json, src/derived.ts, src/evaluate.ts, src/resolve.ts}` + `test/evaluate-derived-docs-typecls.test.ts`——与 ALLOW LIST 五条目**一一对应，零 creep**。
- DENY LIST 全部未触碰（ir.ts / index.ts / tokenizer / parser / semantic / shapes / errors.ts / 10 个存量测试 / spec / ADR / wiki 均不在 diff）。
- BLACKLIST：diff 内无 TASK.md / package-lock.json / yarn.lock / .DS_Store / *.bak。`TASK.md` 在 base `40c1be0` 中已存在（`340425d` 引入的历史遗留，非本票带入），本 commit 未触碰、工作区 `M TASK.md` 为调度器运行时改动未 commit；`.mabf-bg/` 保持未跟踪未 commit（SA2 R2 提醒的纪律被遵守）。
- ⚠️ 流程备注（供总控）：worktree 的 base 配置键是 `mabf.base-branch` 而非 SKILL §1.1 命令读的 `mabf.basebranch`——后者 fallback 到 `origin/main` 会把三个历史任务的提交错爆进 diff。本次以任务简报 base + `mabf.base-branch` 双核对。

### 1. 设计一致性（§1.2）：✅ 逐行一致

- `derived.ts`：三必填槽位 + JSDoc，形状/位置/注释与 §2.2 逐字对应。
- `evaluate.ts`：import 行去 `typeCls`（:20）与 `Cls`（:21，SA2 #3）✓；`collectDocs` 位于 values 循环后、return 前、**try 内**（:61，异常收编 E100）✓；返回键序 `aliases→structure→values→index→aliasDocs→fieldDocs→markerDocs`（§4.2 固定序）✓；`put`/`appendDocs`/`collectDocs`/`walkDocs` 与 §4.1 伪码逐字对应（含 `Array.isArray` 守卫、record `<key>` 恒 `[]`、YArray/YPlainArray 入 `<item>` 其余透明、ref 终态不穿越）✓；:118/:152 两调用点方法化 ✓。
- `resolve.ts`：`Resolver` 接口增 `typeCls` 方法、`const cls` 提取 + 闭包委托、自由函数去 export、模块头「三个能力→四个能力」✓（§5.1 全项）。
- `package.json` 0.1.5→0.1.6（Hard Gate 9）✓。
- **§6 改动级护栏**：`detectDiscriminator` / `unionNode` 零改动（diff 无此二函数 hunk，全文核对）✓。

### 2. Runner 触发性（§1.3 / §1.4 vitest 触发性自检）：✅

- 无 `.spec.ts`（E2E 门禁不适用）。新 `.test.ts` 落 `packages/vfsl/test/`，被根 `vitest.config.ts` 的 `include: ['packages/*/test/**/*.test.ts']` 覆盖；`.github/workflows/ci.yml` Test job（`pnpm test`，node 20/24 矩阵）+ Typecheck job（`pnpm typecheck` → `tsc -p packages/vfsl/tsconfig.json`）在 `pull_request` 事件触发——**CI 接通，无黑洞**。

### 3. 协议假设（§1.5）：✅

设计 §10 声明无协议级假设，与改动面（类型扩展 + 纯函数内新增遍历 + 内部件方法化）相符。唯一运行时依赖「evaluate 不抛错 + 顶层 catch → E100」经源码核实为真（evaluate.ts:74-77，catch 全类型 → makeIssue(E100)）。

### 4. 契约改动连锁（§1.6）：✅

| 改动 | caller 全景（grep 复跑） | 判定 |
|---|---|---|
| `typeCls` 去 export | 源内仅 evaluate.ts:118/:152（已方法化）+ resolve.ts:150 内部递归；测试仅做导出断言/方法调用 | 同步、非 async、**无 throw 契约变化**（闭包委托，语义逐字不变）；typecheck 通过 = 无未列消费方（「编译期自愈」成立） |
| `Resolver` 加方法 | 纯增量成员，无 implementor | pass |
| `DerivedSchema` 加必填三键 | 唯一构造方 evaluate（diff 核实）；index.ts:36 `export type` 透传只读；两测试文件用局部结构类型/`unknown` 收窄，只读不构造 | pass |

### 5. 测试质量（§1.7 源码 grep 断言禁令）：✅

红灯测试文件**零** `readFileSync` + `toMatch/toContain` 源码字符串断言；8 断言全部为运行时行为/模块导出断言（`slot()` 取值 `toEqual`、`mod.typeCls === undefined`、`typeof === 'function'`、真实调用 S/M/U/ROOT 四例语义）。断言内容与任务简报 SA6 记录的 8 条红灯失败信息逐条吻合（`expected null to deeply equal …` / `expected [Function typeCls] to be undefined` 等）——**无转绿过程中篡改断言的迹象**（单 commit、断言语义与 SA6 记录一致）。

### 6. 读写路径一致性：✅ 无分叉

IR docs（parser 写）→ `collectDocs` 读**同一 IR 节点字段** → derived 三表 → JSON。单数据源。`put` 单值位直接引用 IR 数组（非拷贝）与 index 条目 node 共享引用的既有显式纪律同构（derived.ts:9-13 不可变契约 JSDoc 在位）；`toEqual`/JSON 往返对引用 vs 拷贝无差别。

### 7. 静默失败 / 8. 降级 / 9. 错误处理链路：✅

- 无静默路径：合法输入全键落表（动态预验，见 §探针）；手造 IR 异常 → TypeError → E100（`ok:false` 可观察）。
- 无降级：record `<key>` 恒空数组是真实无数据（ir.ts record 节点确无 docs 槽，独立核实）；守卫是 loud 边界，无 `?? []` 静默规范化。
- E100 闭环：三锚守卫 (a) alias docs undefined、(b) field docs undefined、(c) marker docs `'foo'`（非数组）均动态预验产出 `VFSL-E100` 前缀 + `ok:false`；正向对照合法 FIXTURE 仍 `ok:true`（不误伤）。

### 10. 极端条件攻击：✅（静态推演 + 动态预验）

- 空别名手造模块：`rootType` undefined → `resolveChain` TypeError → E100，先于 `collectDocs`（不可达空表垃圾产出）。
- 重名别名：`buildResolver` InternalError 先拦（collectDocs 之后置）。
- **fieldDocs 同路径静默覆盖的唯一理论入口**（手造 IR record 键为 object 形，键值两位同路径递归）：`valueOf` record 分支必经 `keyPatternOf`（evaluate.ts:292-294→:329-333）抛 E306，而 `collectDocs` 位于 values 循环**之后**（:60→:61 时序核实）——覆盖不可达。独立复核 SA2 论断成立。
- 手造环形 IR：`walkDocs` 对 ref 终态不穿越、不查 bodies——无死循环。
- 键整数式重排（JS 对象整数式键优先）：别名名字母起始、三表键含 `.`/`<`——不可达。
- 递归深度：≤ 解析层 `MAX_TYPE_NESTING` 已付费界（parser 四处计费点在位）。
- `walkDocs` switch 穷尽 ir.ts 全部 9 个 kind（逐项比对）。

### 11. 架构评估 / 12. 过度设计：✅

独立 `collectDocs` 与既有两条遍历零耦合（`structureOf`/`valueOf` 一行未动，仅在主流程插一次调用）——设计 §3.1「不缝补」论证在实现面成立。改动总量 ~100 行（含 JSDoc/注释）对「类型族无槽 + 构造点不读」双侧缺口属最小半径；无新抽象层、无 FIXME、无越界防御。

### 13. 运行证据（后台独立进程实跑）

- `pnpm test` → **Test Files 11 passed (11) / Tests 261 passed (261)**（253 存量 + 8 新增，含新文件 8/8 绿）。
- `pnpm typecheck` → **exit 0**。
- SA4 动态探针（一次性，已删）：§4.5 排序全键集 5/22/18 **逐键全等** + IR marker 节点计数 18 = markerDocs 键数 + derived 全树无 undefined 值 + 三锚守卫 E100 三例 + 正向对照。**SA1 R2 对账表与实现产出零偏差**（SA2 R1 攻击点 #1 的事故形态——键集错——经独立重算不存在）。探针自身一条 `toContain('foo')` 断言过强而失败：守卫消息模板按 §4.1 只含 key 不含值，属探针错误非实现缺陷（SA7 落地断言按 SA2 R2 口径只验 E100 前缀即可）。

## 动态审核重点（交 SA7）

1. **落地 `packages/vfsl/test/evaluate-derived-docs-audit.test.ts`（设计 §8 方向 #1–#3，ALLOW LIST 已列）**：排序全键集三断言（§4.5 字面量 5/22/18）+「marker 节点计数 = markerDocs 键数」性质断言 + 手造 IR 三例 E100（断言只验 `VFSL-E100` 前缀，**勿要求消息含 docs 值**）+ 无 undefined 全树性质 + 正向对照。SA4 探针已预验全部可过（本报告 §13 为参照基线，探针未留存）；**当前仓内 18 键中仅 7 键、22 键中仅 5 键被红灯锚定**——audit 不落地则全键集回归防护空缺（设计容忍 warning，SA4 同样容忍但列首提醒）。
2. **同路径嵌套标记串联（§3.3 契约空白）无任何测试锚定**：`YMap<YMap<{…}>>`、`YLeaf<YLeaf<string>>` 等 parser 可达形（claimDocs 三调用点已核）的 `markerDocs` 源序串联行为，红灯 8 断言未覆盖。SA7 可加嵌套标记形合成模块断言外层在前串联序；mutation 侧重点测 `appendDocs`→`put` 替换（串联语义丢失预计**不被**现有 261 拦截——即本条缺失的实际风险）。
3. **CI 动态确认**：PR 上 ci.yml 两 node 版本矩阵跑 261 + typecheck 的 `gh run view --log` 证据（静态已核 include 覆盖，动态留痕按 SA7 SKILL「vitest 触发证据」要求）。
4. **mutation 跑全量 261**（非单文件——聚合类突变只被前序回归锚定）；重点突变面：marker 分支 `argPath` 分流（YArray/YPlainArray vs 透明三标记）、`<member N>` 序号偏移、record `<key>` 恒空数组改读 `t.value.docs`。

## 回流目标

无 reject 项。两条 warning 均回流 **SA7**（动态审核重点 #1/#2）；流程备注（base 配置键名）供总控知悉，无代码动作。

---

*SA4 静态验尸 · 探针与实跑日志：/tmp/sa4-test.log（261/261 + TSC_EXIT=0）、/tmp/sa4-probe.log（5/6 过，唯一失败为探针自误）。worktree 终态复核：git status 与 SA3 commit 后一致，探针无残留。*
