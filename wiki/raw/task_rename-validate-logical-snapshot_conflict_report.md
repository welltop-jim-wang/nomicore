# 冲突门禁报告

- 被审对象：`wiki/raw/task_rename-validate-logical-snapshot.md`（前置门禁 · 任务简报）
- 任务：Issue #71，refactor——公共 API `validateSnapshot` 直接更名为 `validateLogicalSnapshot`，
  一次性迁移全仓源码、测试、文档与导出，不保留 deprecated alias；值语义、issues、资源预算、
  纯函数与零写入行为保持不变；JSDoc 明确 logical JSON 与 live Yjs 载体边界。
- 冲突基准：`docs/adr/0001`–`0007`（7/7 全读）+ `CONTEXT.md`。基准内无 superseded ADR
  （0006 含自身修订节，按修订后现行文本对照）。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订节） | 否 | 无接触点。其「语义层不设机器标签」约束 schema 文本内 JSDoc 标签，不约束任务要求的代码 API JSDoc 注释；任务不新增仓内 schema 文本、不触 codegen 纪律。 |
| ADR-0002 | nomicore 全新重写，authority 出范围 | accepted | 否 | 无接触点。纯命名迁移，不引入任何 authority 规则或旧系统接口。 |
| ADR-0003 | 求值器与派生 schema | accepted | 是 | no-conflict。§决策1 公共观察点清单以旧名 `validateSnapshot` 行文，但该命名已被更晚的 ADR-0007（2026-08-22，accepted）明文修订为 `validateLogicalSnapshot`；任务简报执行的就是 ADR-0007 的现行决策，非另起推翻。任务不触派生 schema 形状与 issues 形状（`VfslIssue` 复用），符合其「形状变更须走设计修订流程」条款。 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 否 | 无接触点。纯类型投影包，不含 `validateSnapshot` 引用；任务不触路径投影与类型契约。 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 无接触点。SchemaSource/生成器/CI 纪律与校验器命名无关；生成器吃 `evaluate` 派生物，不触被更名入口。 |
| ADR-0006 | server 持久化与 docstore | accepted（含 createDoc/owner 修订节） | 是 | no-conflict。「META/SCHEMA …… 天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）」条款以旧名行文，但其决策内容（校验范围仅 ROOT 子树；持久层看不见 schema 语义）与函数名正交。任务要求「既有校验契约零回归」恰是维持该范围语义；更名不使持久层引入 VFSL 依赖。行文旧名属历史记录残留，不构成约束违反（见结论注记 2）。 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | 是（核心） | no-conflict——逐条正向对齐：①「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias」⇔ 简报「直接更名……不保留 deprecated alias」「公共导出只存在 `validateLogicalSnapshot`」；②「只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array」⇔ 简报「输入是普通 JSON logical ROOT snapshot，不接受 Y.Doc、Y.Map 或 Y.Array」；③「`@nomicore/vfsl` 继续保持无 Yjs 依赖」⇔ 简报纯函数要求；④「零写入承诺」⇔ 简报「零写入行为保持不变」；⑤ doc-runtime 的 `materializeRoot` 内部调用已按新名行文，与全仓迁移目标一致。 |

CONTEXT.md 对照：术语条目「逻辑快照校验（validateLogicalSnapshot）」已将新名定为规范术语，并把
`validateSnapshot` 列入 `_Avoid_`——任务简报即该术语契约的执行，方向完全一致，无任何
_Avoid_ 项被引入。

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 未发现直接违反任何 accepted ADR 条款或 CONTEXT.md 硬性惯例的冲突点 |

裁决分布：no-conflict 7/7（其中相关 3：ADR-0003、0006、0007）；override-declared 0；
evolution 0；hard-violation 0。

## 结论

**Verdict: clear——放行，无需 override，无需 Jim 裁决。**

本任务不是对任何 ADR 的推翻或演进，而是 ADR-0007「逻辑层」更名条款 + CONTEXT.md 术语契约
(`validateLogicalSnapshot` 为规范名、`validateSnapshot` 入 _Avoid_) 的落地执行；其余 ADR 与
任务无接触点。

给总控与下游 SA 的两条注记（均非冲突）：

1. **行为基线锚点**：更名必须零行为变化（值语义 / issues 形状 / 资源预算 / 纯函数 / 零写入），
   以既有行为测试为对照；任何「顺手」的接缝形状调整都会触发 ADR-0003「派生 schema 的形状
   变更须走设计修订流程」，超出本 refactor 范围。
2. **ADR 行文旧名残留**：ADR-0003 L8/L14 与 ADR-0006 L73 的散文中保留旧名
   `validateSnapshot`（grep 全集证据：旧名命中仅此 3 处，另 ADR-0007 L8/L14 为更名
   决策本身、L25 为新名调用；ADR-0001/0002/0004/0005 零命中）。ADR 是历史决策记录，
   简报「迁移文档」是否覆盖改写 ADR 行文，属 SA1 设计裁量；SA8 不裁决、也不视为冲突。
