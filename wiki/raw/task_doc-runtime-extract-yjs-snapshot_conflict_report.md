# 冲突门禁报告

- 被审对象：`wiki/raw/task_doc-runtime-extract-yjs-snapshot.md`（任务简报，Issue #73，前置门禁）
- 冲突基准：`docs/adr/0001`–`0007` 全集（7 篇，逐篇全读）+ `CONTEXT.md`
- 门禁日期：SA8 前置门禁（run_id: issue-73-1787369064-158976）
- 复核记录（SA8 二次独立审计，同 run）：重新逐篇全读 ADR 0001–0007 与 CONTEXT.md，逐字核对本文与
  `_relevant_decisions.md` 的全部引文及对照结论——无偏差，裁决维持 **Verdict: clear / 0 冲突点**；
  下游可放心以两份文件为准。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中 | accepted（含 2026-08-19 修订节、2026-08-21 命名修订） | 低 | 无冲突。任务不引入仓内 schema 文本；行为测试 fixture 属明确例外。loud-fail / 错误信息回带语义与简报「响亮失败」同向。 |
| ADR-0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 低 | 无冲突。任务仅做 ROOT 载体提取，不涉及 authority 不变式。 |
| ADR-0003 | 求值器与派生 schema（evaluate 接缝 / ROOT 约定 / 联合表示 / ref 按名引用 / XML 终态） | accepted | 高 | 无冲突。简报「只读取固定 ROOT」依 ROOT 固定物化 Y.Map 条款；「遍历覆盖 …union/ref」与联合 any-of、ref 不内联展开、遍历经共享解析器条款一致；XML 快照值为 XML 字符串条款与简报「XML 保证语义等价而非逐字 round-trip」相容（ADR-0007 已将该等价边界细化为最新决策）。 |
| ADR-0004 | vfsl-protocol 类型协议包（D1–D5） | accepted | 低 | 无冲突。任务不触碰协议包；doc-runtime 为运行时包，与 D3「协议包零运行时」不交叉。 |
| ADR-0005 | 投影生成管线（SchemaSource / 生成器 / 入仓） | accepted | 中 | 无冲突。任务不触碰生成管线；仅沿用其「`packages/` = 可复用库」落位惯例供新包放置参考。 |
| ADR-0006 | Cordis 持久化插件（DocPersistence / doc 三条目布局，含 2026-08-21 修订节） | accepted（早期「首个 saveDoc 创建」与 `DocHandle.user` 条款已被文末修订节正式取代，现行文本有效；无整篇 superseded） | 中 | 无冲突。简报「Persistence 不新增 VFSL/doc-runtime 依赖」与「持久层看不见 schema 语义」一致；「SCHEMA 与 META 不在本能力范围」与三条目布局及「校验只作用 ROOT 子树」一致。 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | 极高（直接依据） | 无冲突。简报是本 ADR「Yjs bridge 独立为 `@nomicore/doc-runtime`」中 `extractYjsSnapshot` 单能力的忠实落地：包名与依赖（vfsl + yjs）、只读固定 ROOT、严格区分四类载体、首个结构错误立即停止、不读 SCHEMA/META、路径 string/number、fail-fast 领域化 issue、XML 语义等价——逐条与 ADR 原文对应。任务只实现四入口之一属分期实现，ADR 未要求一次交付全部入口，不构成违反。 |

无 superseded 状态的 ADR 文件；与 ADR-0006 已被修订节取代的早期条款（首个 saveDoc 创建、`DocHandle.user`）即使潜在相涉也不计入约束，且本任务不触碰持久化语义。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现任何直接违反、override 声明或未走 supersede 的演进意图 |

对照明细（佐证无冲突的关键锚点）：

1. 包与依赖：简报 AC「新包依赖 `@nomicore/vfsl + yjs`；VFSL 不新增 yjs 依赖，Persistence 不新增 VFSL/doc-runtime 依赖」＝ ADR-0007「新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`」「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL」→ no-conflict。
2. 提取语义：简报「只读取固定 ROOT……首个结构错误即停止；成功返回普通 logical ROOT snapshot。SCHEMA 与 META 不在本能力范围」＝ ADR-0007 extractYjsSnapshot 条款原文 → no-conflict。
3. 载体区分：简报「严格区分 Y.Map/Y.Array/Y.XmlFragment/plain 载体」「Yjs 与 plain 载体错位响亮失败」＝ ADR-0007「严格验证实际 Yjs 载体」「YArray 与 plain array 的逻辑值相同，但实际 Yjs 载体仍被严格区分」→ no-conflict。
4. 路径与 issue 形态：简报「fail-fast 单 issue 携带精确 string/number path」＝ ADR-0007「路径统一为 `readonly (string | number)[]`」「Yjs 结构与路径/操作错误 fail-fast」「底层能力各自保留领域化结果联合」→ no-conflict（expected/actual 字段为 ADR 未规定的补充细节，不构成违反）。
5. XML 等价：简报「XML 保证语义等价而非逐字 round-trip」＝ ADR-0007「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」；与 ADR-0003「JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致）」相容（值形状 vs 等价承诺，两不矛盾）→ no-conflict。
6. 结构遍历 kinds：简报「覆盖 root/map/array/xml/leaf/plain/union/ref」落在 ADR-0003 结构树（union/ref 成员、XML 终态、leaf/plain 终态）与 CONTEXT.md「结构树：kind/storage/opaque」框架内；ADR 未冻结 kind 枚举表，无冲突可言 → no-conflict。
7. 前置依赖：简报「Blocked by #71（已合入 rename validateSnapshot → validateLogicalSnapshot, ADR-0007）」与 CONTEXT.md 术语「逻辑快照校验（validateLogicalSnapshot）」一致 → no-conflict。
8. CI/typecheck 覆盖（AC5）与行为测试矩阵（AC6）：ADR 全集无相反约束 → no-conflict。

## 结论

**Verdict: `clear`——放行。** 任务简报与 ADR-0001–0007 全集及 CONTEXT.md 无任何冲突点：无 override-declared、无 evolution、无 hard-violation。简报实质是 ADR-0007 `extractYjsSnapshot` 单能力（四入口之一）的直接实现，其余条款均与其保持同向。无需 Jim 裁决事项。

提示给下游 SA（非门禁结论，仅导航）：全量约束清单见同目录 `task_doc-runtime-extract-yjs-snapshot_relevant_decisions.md`；SA1 设计时应注意本任务范围不含 materializeRoot / readLogicalValueAtPath / applyValidatedMutation 与 SCHEMA/META 处理。
