# SA7 动态验证报告 — 求值器核心：evaluate 公共导出与派生 schema（issue #20）

**Date**: 2026-08-19
**SA7 verdict**: **pass**（SA4 动态审核重点 5/5 全部实弹确认；2 项非阻断观察/建议 + 1 项留档注记移交）
**验证对象**: commit `e73eeef`（SA3 实现：evaluate/derived/resolve + 37 条测试）于分支 HEAD `eccad91` 之上；包版本 `0.1.5`
**环境**: 本地 worktree `/home/wangjian/nomicore-fix-issue-20`（branch `fix/issue-20-on-adr-union-representation`）。本任务为纯函数库功能开发——**无服务、无端口**（SKILL 的 fuser 清场步骤 N/A）、**无 PR 无 CI**（发布推送属外部 issue-runner 职责；SA7 不建 PR、不推分支，CI 摘录义务按总控约束以本地全量后台运行输出替代，见「vitest 触发证据」节）。长命令一律 `setsid nohup` 后台独立进程 + 日志轮询，无前台同步阻塞。

---

## Step 0: SA4 verdict 校对（2026-06-13 立法）

- `wiki/raw/task_vfsl-evaluator_sa4_review.md` 顶部 R2 Verdict: **pass**（R1 唯一阻断项 TASK.md BLACKLIST 违规已由 `9e10a95` 回滚，R2 复审通过、明确「放行 SA7 动态验证」，5 条动态审核重点原样承继）。
- 操作：进入 Step 1。✅

```
[SA7 Step 0 结论]
SA4 verdict: pass（R2）
操作: 进 Step 1
```

## Step 1: SA6 红灯测试转绿确认

后台独立进程（setsid nohup）全量 `pnpm test`（运行 A，Start 19:38:50）：**exit 0，Test Files 10 passed (10)，Tests 253 passed (253)**——`evaluate-derived-schema.test.ts` 37 条全绿（SA6 红灯接缝已闭合：36 例 `evaluate is not a function` + 1 例 typeof 断言全部转绿），parse 侧 216 条零回归。`pnpm typecheck`（独立进程）exit 0。

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN
操作: 进入 Step 2
```

---

## Step 2: SA4 动态审核重点逐条实弹

### #1 E100 崩溃边界实弹 — 手造 IR 五例 ✅

**方法**：临时 vitest 探针 `packages/vfsl/test/zz-sa7-probe.test.ts`（python3 组装避免 shell 拼接陷阱；跑完即删；typecheck 删前删后双 exit 0）。手造 IR 构造子直接绕过 parse 层全部不变量，从公共面打 `evaluate()`。每例断言四件套：`ok:false`、`issues` 恰 1 条、`message` 以 `VFSL-E100:` 起头、`line === column === 1`。

| # | 攻击载荷（手造 IR） | 实测 `issues[0].message`（逐字摘录） | 四件套 |
|---|---|---|---|
| a | 双 ROOT 重名（aliases 两同名条目） | `VFSL-E100: 内部错误（意外异常）: 重复别名 ROOT` | ✅ |
| b | ref 环（ROOT→A→B→A） | `VFSL-E100: 内部错误（意外异常）: 引用环: A` | ✅ |
| c | 未声明名（ROOT 字段位 `ref Missing`） | `VFSL-E100: 内部错误（意外异常）: 未声明别名 Missing` | ✅ |
| d | ROOT 缺席（`aliases: []`） | `VFSL-E100: 内部错误（意外异常）: resolveChain: 空类型（手造 IR：ROOT 缺席）` | ✅ |
| e | `evaluate(null)` | `VFSL-E100: 内部错误（意外异常）: Cannot read properties of null (reading 'aliases')` | ✅ |

**结论**：五例全部 loud 收编——无一逃逸为异常抛出、无一静默 `ok:true`、无行列漂移。SA4 静态核过的处置路径（buildResolver 重名 seen-Set / resolveChain 环 inFlight 与缺席 / ROOT 缺席 TypeError / null 属性读 TypeError）运行时全部进顶层 catch → E100。消息 detail 与源码处置点逐例对得上（resolve.ts:44 / resolve.ts:69 / resolve.ts:74 / resolve.ts:63 / V8 TypeError）。

### #2 20k 线性 ref 链求值耗时（SA4 观察项，非性能 AC）— O(N²) 静态预判获运行时证实

T-l 同型文本（`type A0 = string;` + 20000 条 `type A_i = A_{i-1};` + `Record<A20000, string>` + `ROOT = {}`）喂 `parseVfsl → evaluate`，探针内计时（performance.now）：

| 指标 | 实测 |
|---|---|
| parseVfsl | 260ms |
| evaluate 第一次 | **28249ms ≈ 28.2s** |
| evaluate 第二次（确定性重放） | 28631ms，与第一次 `toEqual` 全等 |
| 派生物规模 | aliases=20003 / values=20003 / indexKeys=1 / JSON 序列化 **1267166 字节**（≈63 B/别名） |

- **派生物大小 O(文本规模) 确认**（ADR 0003 §4 的承诺不受影响）：1.24MB 对 20k 链线性、无 2^N 膨胀；索引仅 1 行（ROOT 空对象 + 别名物化 path=null 不立行，符合设计）。
- **求值时间 O(N²) 确认**：每别名物化 `resolveChain` 重走全链，Σi ≈ 2×10⁸ 步 ≈ 28s，与 SA4 静态推算吻合。
- **阈值裁定（如实上报）**：28.2s 介于 SA4 给出的「秒级即接受」与「分钟级上报」两档之间（<60s，未达分钟级）。按 SA4 原文该现象「属优化非缺陷」（后续票可 memo 化链终点），**不构成 fail 依据**；建议后续票立项时以此为基线——若出现 >20k 裸链真实场景，memo 化优先级应上调。

### #3 Record 值位解析为 map 的索引续行政策 — 运行时确认 ✅

`type ROOT = { m: Record<string, { x: string }> };`（经 parseVfsl 正规链路，非手造）：

- 索引行全集（Object.keys 实测）= `ROOT` / `ROOT.m` / `ROOT.m.<key>`（`match:'pattern'`；无键约束 → `keyPattern` 省略）/ **`ROOT.m.<key>.x`（`match:'exact'`）——值位续行在场**，与设计 §7.2 停止表「续行」分支一致。
- 行内 node 与树内字段节点**同一对象引用**（`===` 断言通过，§7.1）。
- `resolvePath('ROOT.m.<key>.x')`（索引最长前缀 + ref/union 穿透）命中 `leaf`——查询无歧义 ✅。
- Pattern 键变体（`type Id = string & Pattern<"^[a-z]+$">` + `Record<Id, {x:string}>`）：`ROOT.m.<key>` 携带 `keyPattern: '^[a-z]+$'`（解码后原文），`<key>.x` 续行同样在场，穿透查询同样命中 ✅。

建议（与 SA4 同议，非阻断）：后续票由 SA6 在永久测试内补一行 `ROOT.m.<key>.x` 在场性断言，冻结该政策（附录 A 探针 #3 段可直接改写收录）。

### #4 CI 触发证据 → 本地全量运行证据（总控约束 2 替代方案）✅

见下「vitest 触发证据」节（37 条执行行 + 10 文件清单 + typecheck 绿）。

### #5 空联合手造 IR 输出形态（SA4 #N1 留档，供 SA1 决策）✅

`evaluate(moduleOf([alias('ROOT', { kind:'union', members: [] })])` → **ok:true**，形态逐字留档：

| 位置 | 实测 JSON |
|---|---|
| `derived.aliases.ROOT` | `{"kind":"union","members":[]}`（无 `discriminator` 键） |
| `derived.structure.node` | `{"kind":"union","members":[]}` |
| `derived.values.ROOT` | `{"kind":"enum","values":[]}` |

纯数据、JSON 往返无损、`index['ROOT']` exact 条目在场。**留档细节**：值侧把空联合折叠为 `enum`/空 `values`（evaluate.ts:289 的 `literals.length === members.length` 对 0===0 成立），与结构侧 `union`/空 `members` 形成不对称——SA1 后续票二选一处置 #N1（删防御分支回归 E100 / 设计成文接受）时，应一并裁定值侧空枚举是否同批处置。

---

## vitest 触发证据（verdict 升级小节 — 2026-06-15 立法；本任务以本地全量后台运行替代 CI）

- 本地无 PR 无 CI（发布推送属外部 issue-runner 职责，SA7 不得建 PR/推分支）——按总控约束 2 以**本地全量 `pnpm test` 输出**替代 CI run log。
- **运行 A**（默认 reporter，setsid 独立进程，Start 19:38:50）：exit 0，`Test Files 10 passed (10)` / `Tests 253 passed (253)`；文件级汇总即下方 10 文件清单。
- **运行 B**（`pnpm test --reporter=verbose`，同一全套件，Start 19:39:45）：exit 0，同 253/253——默认 reporter 只打文件级汇总行，37 条逐条执行行摘自本运行的完整输出（全量 253 行中的 evaluate 文件子集）。
- typecheck（`tsc -p packages/vfsl/tsconfig.json`，独立进程，19:39 与删探针后各一次）：**exit 0**。

**10 个测试文件清单（运行 A 文件级汇总逐字）**：

```
 ✓ packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts (79 tests) 55ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts (37 tests) 63ms
 ✓ packages/vfsl/test/parse-vfsl-root-convention.test.ts (36 tests) 27ms
 ✓ packages/vfsl/test/parse-vfsl-containers-markers.test.ts (33 tests) 38ms
 ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests) 15ms
 ✓ packages/vfsl/test/parse-vfsl-cycle-detection.test.ts (16 tests) 32ms
 ✓ packages/vfsl/test/parse-vfsl-jsdoc.test.ts (7 tests) 8ms
 ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests) 21ms
 ✓ packages/vfsl/test/parse-vfsl-sa7-supplementary.test.ts (8 tests) 1210ms
 ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests) 9ms
```

**evaluate-derived-schema.test.ts 的 37 条执行行（运行 B 逐字摘录）**：

```
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — ADR 0003 §1 接缝：结果联合形状与派生 schema 纪律 > AC1：evaluate 为包的第二公共导出（函数） 5ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — ADR 0003 §1 接缝：结果联合形状与派生 schema 纪律 > AC1：合法模块 → ok:true，结果携带 derived（ok 判别联合分支） 4ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — ADR 0003 §1 接缝：结果联合形状与派生 schema 纪律 > AC1：evaluate 是纯函数——同输入两次求值输出全等 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — ADR 0003 §1 接缝：结果联合形状与派生 schema 纪律 > AC1：ok:true 时 derived JSON 往返无损（纯数据、无函数） 19ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — ADR 0003 §1 接缝：结果联合形状与派生 schema 纪律 > AC1：derived 无行列位置（内容哈希纪律——任何层级不出现 line/column/pos 键） 7ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 结构树节点全形态（root/map/array/xml-fragment/leaf/plain/union/ref） > AC：规格 §10 fixture（含 ROOT）全量求值通过，八种节点形态齐备 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 结构树节点全形态（root/map/array/xml-fragment/leaf/plain/union/ref） > AC：root 为派生入口节点，包裹 ROOT 的 map 物化 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 结构树节点全形态（root/map/array/xml-fragment/leaf/plain/union/ref） > AC：map 字段保留声明序，字段含 optional 与节点 6ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 结构树节点全形态（root/map/array/xml-fragment/leaf/plain/union/ref） > AC：xml-fragment 为终态节点（不透明语义：无 children，ADR §5） 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 物化折叠四规则（各含正反断言） > 规则1 正：裸对象 → map（默认物化即 YMap） 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 物化折叠四规则（各含正反断言） > 规则1 反：纯值上下文（YPlainArray 子树）内裸对象不物化为 map（→ plain 终态） 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 物化折叠四规则（各含正反断言） > 规则2 正：裸 T[] → array（同步 Y.Array 物化） 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 物化折叠四规则（各含正反断言） > 规则2 反：纯值上下文内裸数组不物化为 array（→ plain 终态） 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 物化折叠四规则（各含正反断言） > 规则3 正：全标量联合 → leaf（成员细节入值 schema 枚举） 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 物化折叠四规则（各含正反断言） > 规则3 反：全容器联合不折叠为 leaf（→ union 分支列表） 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 物化折叠四规则（各含正反断言） > 规则4 正：YPlainArray 子树 → plain 纯值上下文终态 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 物化折叠四规则（各含正反断言） > 规则4 反：同步标记 YArray 不折叠为 plain（→ array） 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 物化折叠四规则（各含正反断言） > 规则4 反：YXmlFragment 不折叠为 plain（→ xml-fragment 终态） 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 联合：分支列表表示与判别式缓存边界（ADR 0003 §3） > AC：联合以成员分支列表表示，成员按声明序保留 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 联合：分支列表表示与判别式缓存边界（ADR 0003 §3） > AC：全成员互异字面量字段 → 附判别式缓存（字段名 + 值→成员序号跳转表） 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 联合：分支列表表示与判别式缓存边界（ADR 0003 §3） > AC：判别式缓存与「逐个尝试」路径一致——byValue 指向的成员其判别字段字面量 = 键 3ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 联合：分支列表表示与判别式缓存边界（ADR 0003 §3） > AC：缓存缺失/存在不改变可观测行为——有缓存联合的 members 与无缓存基线全等（缓存仅附加） 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 联合：分支列表表示与判别式缓存边界（ADR 0003 §3） > AC：无互异字面量字段的联合不附缓存（无公共字段） 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 联合：分支列表表示与判别式缓存边界（ADR 0003 §3） > AC：无互异字面量字段的联合不附缓存（公共字段但值不两两互异） 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — ref 按名引用不内联展开（ADR 0003 §4）：菱形引用链 2^N 对抗 > AC：派生物大小 O(文本规模)——2^N 对抗文本不炸（序列化长度线性界） 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — ref 按名引用不内联展开（ADR 0003 §4）：菱形引用链 2^N 对抗 > AC：ref 节点保留不展开——结构树与别名表均以 ref 承载，序列化中 ref/map 出现次数线性界 4ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — ref 按名引用不内联展开（ADR 0003 §4）：菱形引用链 2^N 对抗 > AC：路径索引同步保持线性（不枚举 ref 穿透后的展开路径） 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 值 schema：字面量枚举 / Pattern 正则 / optional > AC：字面量联合 → 枚举（声明序保留） 0ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 值 schema：字面量枚举 / Pattern 正则 / optional > AC：string & Pattern → pattern（正则解码后原文） 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 值 schema：字面量枚举 / Pattern 正则 / optional > AC：?: 可选字段 → 值 schema optional 包装，且结构树字段 optional:true 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 值 schema：字面量枚举 / Pattern 正则 / optional > AC：值 schema 与结构树正交并存（同一别名两棵独立可查的树） 2ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 路径索引：可查、ref 穿透、Record 键模式 > AC：exact 路径条目——ROOT 入口与字段路径 3ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 路径索引：可查、ref 穿透、Record 键模式 > AC：Record 键模式——<key> 段为 pattern 条目且携带键约束正则 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 路径索引：可查、ref 穿透、Record 键模式 > AC：数组元素段——<item> 条目可查 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — 路径索引：可查、ref 穿透、Record 键模式 > AC：ref 穿透——索引 + 别名表足以支撑穿透下钻查询（最小消费者验证数据充分性） 1ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — no-match 诊断接缝（ADR 0003 §3：失败距离最小成员 + 「联合成员 i/N」） > AC：联合成员按声明序编号且完整保留（诊断生成所需数据预置；计算属 validateSnapshot 消费） 3ms
 ✓ packages/vfsl/test/evaluate-derived-schema.test.ts > evaluate — no-match 诊断接缝（ADR 0003 §3：失败距离最小成员 + 「联合成员 i/N」） > AC：无判别联合同样保留声明序（「逐个尝试」路径的诊断基础） 1ms
```

**verdict**: ✅ all-vitest-packages-triggered（本地全量运行等价证据：37/37 执行行在场，10/10 文件清单一致，253/253 绿，typecheck exit 0；`vitest-package-not-triggered` 不成立）

---

## 探针纪律与工作树卫生

- 探针 `packages/vfsl/test/zz-sa7-probe.test.ts`：python3 组装（规避 shell heredoc 行丢失陷阱）→ setsid 后台 `pnpm test`（探针 9 条全绿，连带全量 262/262：253 基线 + 9 探针）→ **已删除**（附录 A 留全文）。
- 删后复验：`pnpm typecheck && pnpm test`（setsid 后台）exit 0，**253/253，回到 10 文件基线**——临时文件零残留，`src/test/packages` 全程零改动。
- `git status --porcelain`：仅未跟踪 `.mabf-bg/`（运行时目录，不进任何 commit）。
- 补充性/破坏性测试落库说明：总控约束限定本 SA 仅可改 `wiki/`——探针不落库，其断言以附录 A 全文移交（SA6 后续票可直接改写收录；#3 续行断言为现成素材）。

## 移交与建议（全部非阻断）

1. **（观察）** 20k 线性裸链 evaluate 实测 28.2s（parse 仅 260ms）——O(N²) 获运行时证实，派生物大小 O(文本) 不受影响；后续票 memo 化链终点属优化非缺陷，建议以本数据为立项基线。
2. **（建议）** SA6 后续在永久测试补 `ROOT.m.<key>.x` 在场性断言，冻结 Record 值位 map 续行政策（SA4 #3 同议；附录 A #3 段现成）。
3. **（留档）** 空联合手造 IR 双树形态——结构 `union/空 members/无判别式`、值 `enum/空 values`——交 SA1 决策（#N1 延伸：值侧空枚举折叠是否同批处置）。

## 裁定

**verdict: pass**

- SA4 R2 pass 基础上独立动态验证：5/5 动态审核重点全部实弹确认，无新增 fail 项、无静默失败、无逃逸异常；
- 全量 253/253 + typecheck exit 0（探针删后复验回到基线）；
- E2E spec 触发性：diff 无 `*.spec.ts` → N/A（SA4 R3 同判）。

---

## 附录 A：探针源码全文（复现用；原路径 packages/vfsl/test/zz-sa7-probe.test.ts，跑完即删）

```ts
/**
 * [SA7-DIAG] 临时动态探针 — issue #20 SA4 动态审核重点 #1/#2/#3/#5 实弹验证。
 * 跑完即删、不进 commit（SA7 SKILL 临时探针纪律）；typecheck 仅在删前后各跑一次。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl, evaluate } from '../src/index.js';
import type { VfslAlias, VfslModule, VfslType, DerivedSchema, EvaluateResult, StructureNode } from '../src/index.js';

// —— 手造 IR 构造子（绕过 parse 层不变量的公共面攻击载荷）——

const tStr: VfslType = { kind: 'primitive', name: 'string' };
const tRef = (name: string): VfslType => ({ kind: 'ref', name });
const tObj = (fields: Array<[string, VfslType]>): VfslType => ({
  kind: 'object',
  fields: fields.map(([name, type]) => ({ kind: 'field' as const, name, optional: false, docs: [], type })),
});
const alias = (name: string, type: VfslType): VfslAlias => ({ kind: 'alias', name, docs: [], type });
const moduleOf = (aliases: VfslAlias[]): VfslModule => ({ kind: 'vfsl-module', aliases });

/** E100 三段断言（SA4 移交口径）：ok:false / message 前缀 / line=column=1；返回 message 全文供留档。 */
function expectE100(result: EvaluateResult): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable: ok:true');
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0]!;
  expect(issue.message.startsWith('VFSL-E100:')).toBe(true);
  expect(issue.line).toBe(1);
  expect(issue.column).toBe(1);
  return issue.message;
}

function evaluateParsed(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`前置 parse 失败: ${JSON.stringify(parsed.issues)}`);
  const result: EvaluateResult = evaluate(parsed.module);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`evaluate 失败: ${JSON.stringify(result.issues)}`);
  return result.derived;
}

// —— SA6 测试内 resolvePath 的最小同构拷贝（查询期穿透消费者；不 import 测试文件避免连带执行）——

function walkFrom(derived: DerivedSchema, node: StructureNode, segments: string[], i: number): StructureNode | null {
  if (i >= segments.length) return node;
  const seg = segments[i]!;
  switch (node.kind) {
    case 'root':
      return walkFrom(derived, node.node, segments, i);
    case 'ref': {
      const target = derived.aliases[node.name];
      return target ? walkFrom(derived, target, segments, i) : null;
    }
    case 'map': {
      const field = node.fields.find((f) => f.name === seg);
      return field ? walkFrom(derived, field.node, segments, i + 1) : null;
    }
    case 'array':
      return walkFrom(derived, node.element, segments, i);
    case 'union': {
      for (const member of node.members) {
        const hit = walkFrom(derived, member, segments, i);
        if (hit) return hit;
      }
      return null;
    }
    default:
      return null;
  }
}

function resolvePath(derived: DerivedSchema, path: string): StructureNode | null {
  const segments = path.split('.');
  for (let n = segments.length; n >= 1; n--) {
    const entry = derived.index[segments.slice(0, n).join('.')];
    if (entry) {
      const node = walkFrom(derived, entry.node, segments, n);
      if (node) return node;
    }
  }
  return null;
}

// —— #1 E100 崩溃边界实弹：手造 IR 五例 ——

describe('[SA7 #1] E100 崩溃边界实弹（SA4 移交清单 #1）', () => {
  it('a) 双 ROOT 重名（手造 IR）→ ok:false E100@1:1', () => {
    const m = moduleOf([alias('ROOT', tObj([['x', tStr]])), alias('ROOT', tObj([['y', tStr]]))]);
    const detail = expectE100(evaluate(m));
    console.log(`[SA7-DIAG] a-double-ROOT: ${detail}`);
  });

  it('b) ref 环（ROOT→A→B→A）→ ok:false E100@1:1', () => {
    const m = moduleOf([alias('ROOT', tRef('A')), alias('A', tRef('B')), alias('B', tRef('A'))]);
    const detail = expectE100(evaluate(m));
    console.log(`[SA7-DIAG] b-ref-cycle: ${detail}`);
  });

  it('c) 未声明名（ROOT 字段位 ref Missing）→ ok:false E100@1:1', () => {
    const m = moduleOf([alias('ROOT', tObj([['x', tRef('Missing')]]))]);
    const detail = expectE100(evaluate(m));
    console.log(`[SA7-DIAG] c-undeclared: ${detail}`);
  });

  it('d) ROOT 缺席（aliases: []）→ ok:false E100@1:1', () => {
    const detail = expectE100(evaluate(moduleOf([])));
    console.log(`[SA7-DIAG] d-root-absent: ${detail}`);
  });

  it('e) evaluate(null) → ok:false E100@1:1（TypeError 收编）', () => {
    const detail = expectE100(evaluate(null as unknown as VfslModule));
    console.log(`[SA7-DIAG] e-null-module: ${detail}`);
  });
});

// —— #2 20k 线性裸引用链耗时观察（SA4 观察项，非性能 AC；秒级接受分钟级上报）——

describe('[SA7 #2] 20k 线性裸引用链 parse→evaluate 耗时观察', () => {
  it('T-l 同型 20k 链全链路计时 + 派生物规模 + 确定性', { timeout: 180_000 }, () => {
    const lines: string[] = ['type A0 = string;'];
    for (let i = 1; i <= 20000; i += 1) lines.push(`type A${i} = A${i - 1};`);
    lines.push('type R = Record<A20000, string>;');
    lines.push('type ROOT = {};');
    const text = lines.join('\n');
    const t0 = performance.now();
    const parsed = parseVfsl(text);
    const t1 = performance.now();
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const result = evaluate(parsed.module);
    const t2 = performance.now();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const derived = result.derived;
    const serialized = JSON.stringify(derived);
    console.log(`[SA7-DIAG] 20k-chain timing: parse=${(t1 - t0).toFixed(0)}ms evaluate=${(t2 - t1).toFixed(0)}ms`);
    console.log(`[SA7-DIAG] 20k-derived size: aliases=${Object.keys(derived.aliases).length} values=${Object.keys(derived.values).length} indexKeys=${Object.keys(derived.index).length} jsonBytes=${serialized.length}`);
    expect(JSON.parse(serialized)).toEqual(derived); // 纯数据往返
    const again = evaluate(parsed.module); // 确定性：同输入两次求值全等（含第二次耗时观察）
    const t3 = performance.now();
    console.log(`[SA7-DIAG] 20k-chain second evaluate=${(t3 - t2).toFixed(0)}ms (determinism replay)`);
    expect(again).toEqual(result);
  });
});

// —— #3 Record 值位解析为 map 的索引续行（设计 §7.2 政策运行时确认）——

describe('[SA7 #3] Record 值位 map 索引续行 + resolvePath 无歧义', () => {
  it('Record<string, {x:string}>：<key> pattern 行 + <key>.x exact 行在场，穿透查询命中 leaf', () => {
    const derived = evaluateParsed('type ROOT = { m: Record<string, { x: string }> };');
    const keyRow = derived.index['ROOT.m.<key>'];
    expect(keyRow).toBeDefined();
    expect(keyRow?.match).toBe('pattern');
    expect(keyRow?.keyPattern).toBeUndefined(); // 无约束键 → 省略 keyPattern
    const xRow = derived.index['ROOT.m.<key>.x'];
    expect(xRow).toBeDefined();
    expect(xRow?.match).toBe('exact');
    expect(xRow?.node).toBe(keyRow?.node.fields[0]!.node); // 行内 node 与树内字段节点同一引用（§7.1）
    const hit = resolvePath(derived, 'ROOT.m.<key>.x');
    expect(hit?.kind).toBe('leaf');
    console.log(`[SA7-DIAG] record-map-continuation keys: ${Object.keys(derived.index).join(' | ')}`);
  });

  it('Record<Id, {x:string}>（Pattern 键）：keyPattern 携带解码后正则，续行同样在场', () => {
    const derived = evaluateParsed('type Id = string & Pattern<"^[a-z]+$">;\ntype ROOT = { m: Record<Id, { x: string }> };');
    const keyRow = derived.index['ROOT.m.<key>'];
    expect(keyRow).toBeDefined();
    expect(keyRow?.match).toBe('pattern');
    expect(keyRow?.keyPattern).toBe('^[a-z]+$');
    expect(derived.index['ROOT.m.<key>.x']?.match).toBe('exact');
    expect(resolvePath(derived, 'ROOT.m.<key>.x')?.kind).toBe('leaf');
    console.log(`[SA7-DIAG] record-pattern-key keys: ${Object.keys(derived.index).join(' | ')}`);
  });
});

// —— #5 空联合手造 IR 输出形态（SA4 #N1 留档，供 SA1 决策）——

describe('[SA7 #5] 空联合手造 IR 输出形态确认', () => {
  it('members: [] → ok:true；结构侧 union/空 members/无判别式；值侧 enum/空 values；纯数据可往返', () => {
    const result = evaluate(moduleOf([alias('ROOT', { kind: 'union', members: [] })]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const derived = result.derived;
    console.log(`[SA7-DIAG] empty-union aliases.ROOT: ${JSON.stringify(derived.aliases.ROOT)}`);
    console.log(`[SA7-DIAG] empty-union structure.node: ${JSON.stringify(derived.structure.node)}`);
    console.log(`[SA7-DIAG] empty-union values.ROOT: ${JSON.stringify(derived.values.ROOT)}`);
    expect(derived.aliases.ROOT).toStrictEqual({ kind: 'union', members: [] });
    expect(derived.structure.node).toStrictEqual({ kind: 'union', members: [] });
    expect(derived.values.ROOT).toStrictEqual({ kind: 'enum', values: [] });
    expect(derived.index['ROOT']?.match).toBe('exact');
    expect(JSON.parse(JSON.stringify(derived))).toEqual(derived);
  });
});
```
