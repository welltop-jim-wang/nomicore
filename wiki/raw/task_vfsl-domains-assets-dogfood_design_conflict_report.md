# 冲突门禁报告（设计后复审）— task_vfsl-domains-assets-dogfood（issue #27，SA1 R1 设计）

被审对象：`wiki/raw/task_vfsl-domains-assets-dogfood_design.md`（SA1 R1，D1–D5 + §1–§14 + 附录 A/B/C）
冲突基准：`docs/adr/` 全集（0001–0005）+ `CONTEXT.md` + 前置门禁产出的 `_relevant_decisions.md`
实证核对（只读）：`packages/vfsl-codegen/src/collect.ts`（assertIdBaseDir）、`packages/vfsl-protocol/src/index.ts`（三处推断位）、`docs/vfsl/v1-spec.md` §7（信封 id 语义）、`packages/vfsl/test/evaluate-derived-docs-audit.test.ts`（F1 docs 审计存在性）

## Verdict

`clear`

## ADR 盘点（设计维度增量）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源（修订：目标态/阶段态二分） | accepted | 是 | 无冲突——D3 选 (a) 保持 schema.vfsl = 规格 §10 逐字 + 头部，正是单一真相源纪律的忠实执行；头部 `@`-指令仍属 ADR 0005 §2 切割的文件格式约定 |
| 0002 | authority 出范围 | accepted | 弱 | 无冲突——设计不触及 |
| 0003 | 求值器与派生 schema | accepted | 是 | 无冲突——附录 A fixture 逐字保留 `type ROOT = YMap<{…}>`（map 形）与 YXmlFragment 演示位；未引入任何与 ROOT 约定/联合表示/按名引用相左的设计 |
| 0004 | vfsl-protocol 类型投影（D1–D5） | accepted | 是（D2 修复的直接基准） | 无冲突——修复恢复 D2 联合键空间本意、保持 D3 fail-closed 方向、不动 D4 装置与 D5 路径形态；属 ADR 0004 后果明示允许的「协议包独立演进节奏」内的缺陷修复 |
| 0005 | 投影生成管线 | accepted | 是（D1/D4 的直接基准） | 无冲突——D1 逐条兑现 §4/§5；D4 的 id 取值不违反 §2（样例非冻结值，详见冲突点表 #1） |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | —（重点复审点 1） | ADR-0005 §2 样例 `// @id: vfs3.assets@1`；§1「**id 是标签不是键**：引擎正确性不依赖 id 唯一性」；规格 §7「id：字符串，文档标识；对 parser 不透明（不解析、不校验唯一性）」 | D4：`@id: vfs3-assets@1`（idBase = `vfs3-assets` = 目录名） | **no-conflict** | §2 冻结对象是「三键全部必需 + 缺失/方言不符响亮拒绝」与文件格式，样例代码块演示的是三键语法，id 字符串值未被任何条款冻结；ADR 0005 §1 与规格 §7 双重确认 id 无引擎级语义约束。目录名 `vfs3-assets` 由简报（`domains/vfs3-assets`）与包名 `@nomicore/vfs3-assets` 钉死，F2 `collect.ts` `assertIdBaseDir`（已实读核实：idBase 目录不存在 → ProjectionError → exit 2）是代码冻结不变式，两钉相交 id 唯一可行解即 `vfs3-assets@1`。**本门禁前置报告补充观察 3 的样例值建议（`vfs3.assets@1`）据此修正**：该建议隐含「目录名可随 id」假设，不成立；以目录名为准 |
| 2 | —（重点复审点 2） | ADR-0005 §3：「**派生 schema 必须携带 `docs`**（从 IR 节点继承）——TSDoc 发射……与 Phase 4 AI namespace card 都依赖它；此要求写入 #20 验收」 | D3 选 (a)：schema.vfsl 保持 §10 逐字 → 标记位 TSDoc 臂空转（vacuous）+ 守门 + 缺口路由规格轴 follow-up | **no-conflict（附观察）** | §3 的约束对象是 **evaluate 的派生 schema**（生成器输入契约），验收归 #20（已闭环；F1 `evaluate-derived-docs-audit.test.ts` 性质断言「markerDocs 键数 === IR marker 节点总数」在案——实读核实存在）。本票 fixture 不携带标记位 JSDoc 是**数据属性**，不违反「派生 schema 携带 docs」的机制契约；AC5 断言「fixture 携带的全部 JSDoc 出现在 TSDoc」在逐字 fixture 下完整成立（vacuous truth 非断言规避）。观察：证据缺口真实存在，设计已显式登记并路由规格轴（#46 方向）follow-up，守门链（fixture 驱动自动激活 + F1 性质断言 + 字段位响亮失败）非裸空转；**AC 完整性是否接受 vacuous 臂属 SA2/总控验收判断，非冲突门禁裁决面**——回退 (b) 精确 diff 已备，总控可一句话激活 |
| 3 | —（重点复审点 3） | ADR-0004 D2「键空间 = 各成员字段键集之并集」、D3「空 `VfslPathMap` 默认 fail-closed」「纯类型 + 接口，零运行时」、D4 测试装置、D5 路径形态；后果「协议包独立演进节奏：类型规则变更 → 消费方重编译即见，无运行时兼容负担」 | D2 选型 A：改 `packages/vfsl-protocol/src/index.ts` 三处内部类型（MemberKeys → distributive `keyof`；VfslValueOf/PathPatchUnwrap → 同态 keyof 映射）+ bump 0.1.1 | **no-conflict** | 已实读核实三处位点（:27 / :63-65 / :88-90）与设计所述逐字吻合。① 对 D2：坍缩使含可选成员的联合/表键空间变为 never，恰是 D2 并集语义的破坏；修复是**恢复** D2 本意，非变更语义决策。② 对 D3：未知键仍 `keyof` 不属 → never → UnknownPath；空表 `keyof {}` = never——fail-closed 方向不变，被移除的是过度失败（已声明可选成员连坐全表）与更坏的 silent-`{}` 假型（fail-open，诚实性方向修正与 D2「诚实反映」一致）。③ 对 D3 包形态：修复纯类型空间，零运行时代码不变。④ 对 D4：装置不动，既有套件零改动全绿为验收门禁。⑤ 导出面 12 名冻结名单无增删，版本 bump 纪律（硬门禁 9）合规。⑥ ADR 0004 后果明示协议包独立演进——缺陷修复在其节奏内，不构成 ADR 演进 |
| 4 | — | ADR-0005 §4「schema 改动与重新生成同一原子提交」 | D1 + §9.7：协议修复 + bump + 领域包四件 + lockfile + ci.yml 单原子提交 | no-conflict | 与前置门禁补充观察 2（flag 移除与首领域同票）一致，纪律延伸方向正确 |
| 5 | — | ADR-0001 修订节脚手架纪律（消费方经 SchemaSource 接缝） | 设计不新增消费方；tsdoc 测试经 FileSchemaSource/parseVfsl/evaluate 接缝消费 | no-conflict | 接缝纪律保持 |

## 结论

**Verdict: clear** —— SA1 R1 设计的三处主动披露偏离/裁决（D4 id 取值、D3 AC5 (a)、D2 协议修复选型 A）经逐条对照与代码/规格实证核对，全部裁决 **no-conflict**；无 override 声明需求、无 evolution 存疑项、无 hard-violation。

补充观察（非阻塞，供总控/SA2 知悉）：

1. **前置门禁观察 3 修正**：id 样例值 `vfs3.assets@1` 不具约束力；本票正确解 = `@id: vfs3-assets@1`（目录名钉死 + collect.ts 不变式）。相关决议文档已追加此决策点。
2. **AC5 标记臂 vacuity 的验收裁量权在 SA2/总控**：冲突门禁只确认无 ADR 条款被违反；若总控裁决「AC5 须本票内三臂实证」，设计 §6.3 回退 (b) 可一句话激活（设计期实测 6/6 绿），无需重新设计。无论哪条路，规格轴 follow-up（§10 fixture 标记位补 JSDoc + 同步 #32/#21 两份逐字副本）都应登记。
3. **D2 修复的 TS 版本敏感性**已在设计 E6 登记（typescript 锁 5.9.3）；未来 TS bump 由全量套件 + CI 兜底，机制充分。
4. 相关决议文档已按设计后复审流程追加三条新决策点（D4/D2/D3 裁决摘要），供 SA2/SA3 复用。
