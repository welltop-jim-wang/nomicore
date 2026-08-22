# 冲突门禁报告 — 设计后复审（Phase 2）

- 被审对象：`wiki/raw/task_rename-validate-logical-snapshot_design.md`（SA1 设计 R1，§0–§12，
  含决策冻结表 D1–D9）
- 冲突基准：`docs/adr/0001`–`0007`（7/7 全读，状态均 accepted，无 superseded 条目——承自前置
  门禁盘点，见 `_conflict_report.md`，本复审不重复）+ `CONTEXT.md`
- 关联输入：任务简报（含 SA6 Phase 1 红灯契约记录，2026-08-22 更新版）、
  `_relevant_decisions.md`（已随本复审追加设计决策点 D1–D9）

## Verdict

`clear`

## 设计决策对照表

| # | 设计决策 | 基准条款 | 对照结论 | 裁决 |
|---|---|---|---|---|
| 1 | **D1** 更名半径最小化：函数体 / `interpret` / `validateSubtree` / 消息字面量逐字节不动，签名逐字不变 | ADR-0007「`validateSnapshot` 直接更名」；ADR-0003 L46「派生 schema 的形状变更须走设计修订流程（公共契约）」 | 纯名称迁移，不触派生 schema 形状、issues 形状与行为——恰是该等条款要求的形态 | no-conflict |
| 2 | **D2** 不留 alias：禁止任何形式兼容绑定 | ADR-0007 L14「不保留兼容 alias」明文 | 逐字落实；AC2 红灯 `toBeUndefined` 为守卫 | no-conflict |
| 3 | **D3** JSDoc 载体边界逐字文本（logical JSON / 不接受 Y.Doc·Y.Map·Y.Array / 不验证载体 / 载体校验属 Runtime 层 / 不提旧名） | ADR-0007 L8（更名动机）/L14（输入边界）/L24-25（extractYjsSnapshot·materializeRoot 载体域）；CONTEXT.md 术语条目 L47-49 | 文本语义与 ADR-0007 决策逐条对应；「logical ROOT snapshot」即 CONTEXT.md 术语原文 | no-conflict |
| 4 | **D4** 不改测试文件名（`validate-snapshot.test.ts` 等 kebab-case 路径保留） | 无 ADR/CONTEXT 条款约束文件路径命名；简报 AC1/AC2 验收域为「模块导出与调用方」（符号级） | 路径名残留不构成基准条款违反；已自设 SA2 显式裁定修订门（ALLOW LIST 扩展属单点修订） | no-conflict |
| 5 | **D5** 历史档案不迁移：`docs/adr/**`、`wiki/prd/**`、`wiki/raw/` 历史、`TASK.md` 不改写 | 无任何 ADR 条款强制回改 ADR 行文；ADR-0007（2026-08-22）为更晚命名决策，ADR-0003/0006 行文旧名由其管辖（前置门禁已裁定） | 行使前置门禁报告注记 2 授予 SA1/SA2 的裁量并给出完整论证（ADR 不可变 / 后法优于前法 / 审计轨迹保全）；ADR-0007 L14 更名决策本身须两名并陈，docs/adr 零旧名不可达——处置与前置盘点结论同向 | no-conflict |
| 6 | **D6** SA6 双文件零改动（红灯测试 + 共享断言集冻结） | 无 ADR 条款触及测试文件；简报 SA3 迁移提示明示（「断言零改动」「无需迁移」） | 红灯探针以旧名**缺席**为断言（AC2 `toBeUndefined`），机制与 ADR-0007「不留 alias」同向 | no-conflict |
| 7 | **D7** 版本 bump 0.1.10 → 0.2.0 | 无 ADR/CONTEXT 条款约束包版本纪律 | 无基准交集；semver 破坏性变更纪律属流程惯例（Hard Gate #9 为 wiki 流程文档，不构成冲突基准） | no-conflict |
| 8 | **D8** CONTEXT.md 不动（术语条目已终态，`_Avoid_` 含旧名是执行机制） | CONTEXT.md L47-49 本身 | 术语契约保持稳定、不在任务中改基线文件——与基准自我一致 | no-conflict |
| 9 | **D9** 单提交原子迁移 + 落地前三重门（G1 符号 / G2 活文档 / G3 test+typecheck） | 无 ADR 条款约束提交流程 | 流程决策，无基准交集；G1/G2 门是 AC1 与 ADR-0007 更名条款的执行机制 | no-conflict |
| 10 | §4.2(b) index.ts 接缝清单行更新 + §4.5 活文档 3 文件迁移 | ADR-0003 L14「`parseVfsl` / `evaluate` / `validateSnapshot` / `validatePatch` …以各自 Interface 作为公共观察点」（名称经 ADR-0007 修订） | 观察点仍经 Interface 暴露，仅名称行文随 ADR-0007 更新——暴露纪律不破坏 | no-conflict |
| 11 | §12 Caller 审计「生产 caller = 0、半径封闭于单包」（grep 实证下游包零命中） | ADR-0007 L25 `materializeRoot` 内部调用 `validateLogicalSnapshot`（`@nomicore/doc-runtime` 为前瞻新包，尚未存在） | 现状陈述与 ADR 前瞻条款无矛盾：现行代码面无遗漏迁移半径 | no-conflict |

CONTEXT.md 复核：设计未引入任何 `_Avoid_` 项（`validateSnapshot` 仅以受控形态存在于：SA6
红灯探针的缺席断言、CONTEXT.md `_Avoid_` 条目自身、ADR/wiki 历史档案——三者均属执行机制或
不可变记录）；`ROOT`、`零写入（zero-write）`、`派生 schema`、`逻辑快照校验` 等术语用法与
术语表逐条一致。

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 未发现设计任何决策（D1–D9 及 §4/§12 各规格项）直接违反 accepted ADR 条款或 CONTEXT.md 硬性惯例 |

裁决分布：no-conflict 11/11（D1–D9 九项决策 + 接缝行/活文档迁移 + caller 审计）；
override-declared 0；evolution 0；hard-violation 0。

## 结论

**Verdict: clear——设计放行，无需 override，无需 Jim 裁决。**

设计是 ADR-0007 更名条款的忠实实现而非修订：全部冻结决策与基准零冲突，且对基准约束
（不留 alias / 零行为回归 / 派生 schema 形状冻结 / ADR 不可变）逐条设置了对应守卫
（D2+AC2 红灯、D1+27 条共享断言、D1 半径冻结、D5 档案豁免）。前置门禁遗留的唯一裁量点
（ADR/wiki 历史行文是否回改）已由 D5 显式闭环，处置方向与前置门禁盘点结论一致。

非阻塞观察两条（供 SA2 全维度评审参考，SA8 不判定优劣）：

1. **D4 路径名残留**：两个 kebab-case 测试文件名无基准条款约束，属简报验收域解释问题；
   设计已自设「SA2 裁定 → 显式扩展 ALLOW LIST」的修订门。若 SA2 裁定必须改，仍不构成
   ADR/CONTEXT 冲突。
2. **D7 版本 bump 依据**：其引用的 Hard Gate #9 属 wiki 流程文档，不在冲突基准内——本复审
   仅确认无基准冲突，不背书其流程合理性。
