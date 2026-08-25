# 冲突门禁报告

- 被审对象：`wiki/raw/task_namespace-runtime-replace-schema-rev1.md`（issue #91 round 2 修订轮任务简报）
- 冲突基准：`docs/adr/` 全集 8 份（全部读取）+ `CONTEXT.md`
- 产出时间：round 2 第 0 阶段前置门禁

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本唯一真相源 | accepted（含 2026-08-19 修订节） | 否 | 无 root 校验/投影条款，不触及 |
| 0002 | 重写定位与 authority 出范围 | accepted | 否 | 不触及 |
| 0003 | 求值器与派生 schema | accepted | 弱 | ROOT 别名/联合表示；R2-2 union loud 行为与其一致 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 编译期类型投影，与本任务运行时 root 校验不同域 |
| 0005 | 投影生成管线 | accepted | 否 | 不触及 |
| 0006 | 持久化 DocStore | accepted（含两节 owner 裁决演进） | 弱 | saveDoc=脏通知；失败不调 notifier 与 0008 槽序一致 |
| 0007 | 逻辑验证与 Yjs Bridge | accepted（Runtime/open/read 条款由 0008 部分取代） | 是 | 沿用条款（validateLogicalSnapshot / detached / 零写入 / observer no-rollback）与简报一致 |
| 0008 | NamespaceRuntime 读写与单序列器 | accepted | 是 | 核心基准；简报系回归其 SCHEMA write 第 3 条，见冲突点 #1–#3 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | — | ADR 0008 §SCHEMA write 第 3 条（:69）「提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容」 | 简报必改 1–3：删除 provided-root 静默投影；完整 ROOT 原样传 `validateLogicalSnapshot()`/detached builder/⑥；未声明顶层键 `ok:false` + 指向该键的 issue | no-conflict | 简报要求与条款逐字对齐，属回归 ADR 0008 与 Issue #91 AC3 原文；ADR 0008 全文无投影授权（第 2 条「严格提取」仅限未提供 root 的 keep-root 分支） |
| 2 | — | ADR 0008 §槽序（:45、:75）+ §Fatal 与失败通道（:79）+ ADR 0007 失败边界（:54） | 简报必改 4：失败时 SCHEMA/ROOT/active tools 完全不变、不调 dirty notifier（0 Yjs update）；必改 3 的 `ok:false` 窄 issue | no-conflict | 「失败发生在 transaction 前，零写入、active tools 不变」与槽序（校验→构造→transaction→notifyDirty）一致；`ok:false` 领域结果联合 + 窄 issue 即 0008 失败通道原文 |
| 3 | — | ADR 0008 §单一 write sequencer（:43） | 简报侦察项：sequencer 用例（:672-697）改输入数据但保持「槽起点快照获胜」断言 | no-conflict | 「取得槽后立即快照，之后只使用该内部快照」语义不变，仅输入数据适配新契约，快照时点断言不削弱 |
| 4 | 记录性 | CONTEXT.md:17-19「顶层声明域投影」现行文本 | 简报必改 5：删除或改写该术语条目为「provided root 原样封闭校验、未声明键响亮拒绝」 | no-conflict（该条目是修改对象，非冲突源） | 该条目无任何 ADR 授权背书，且与 ADR 0008 第 3 条及 CONTEXT.md 自身「封闭对象」条目矛盾，系 round 1 偏差产物落档；简报明确声明废止并给出 ADR/AC 依据（即使按最严读法视为对 CONTEXT 条目的显式推翻，也属 override-declared，同样放行） |

### 附：对 round 1 交付态的追溯裁决（非本简报冲突）

round 1 设计 D7「顶层声明域投影」（静默剥离未声明顶层键并 `ok:true`）对照 ADR 0008 §SCHEMA write 第 3 条为 **hard-violation**：无 override 声明、非演进、ADR 0008 全文无投影授权——D7 系仓内自创语义，其后果（静默数据丢失、拼写错误被掩盖）正是本修订的修复对象。本简报废止 D7 即消除该违规，属回归而非新冲突。

## 结论

**放行。** 简报 7 条必改与 ADR 0008（SCHEMA write 第 3 条、槽序、Fatal 与失败通道）、ADR 0007 沿用条款（零写入、detached、领域结果联合）及 CONTEXT.md「封闭对象」「零写入」惯例全部一致；唯一文本冲突点是 CONTEXT.md:17-19 术语条目本身，它是本修订的修改对象而非冲突源（无 ADR 背书且与 ADR 0008 矛盾）。无需 override，无条目需 Jim 裁决；ADR 决策集零变更，本轮不构成 ADR 演进。
