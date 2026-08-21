# 冲突门禁报告

> SA8 前置门禁（Phase 0）。被审对象：`wiki/raw/task_vfsl-schema-envelope.md`（Issue #52：`parseSchemaEnvelope` 信封解析与方言路由，功能开发）。
> 冲突基准：`docs/adr/` 全集（0001–0005，5 份全部逐个读取，无抽样；全部 accepted，无 superseded——ADR-0003 所「取代」的为未入库草稿，不构成作废决议）+ `CONTEXT.md`。
> 关联产出：`wiki/raw/task_vfsl-schema-envelope_relevant_decisions.md`（相关决议摘录，全链 SA 复用）。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中 | accepted（含 2026-08-19 修订、2026-08-21 命名修订） | 是 | 一致。信封四键 `{ lang, version, id, text }`、doc 键名 `SCHEMA`（任务简报 2026-08-21 修订与 ADR 命名修订同源同文）、「未知方言 loud-fail 只读」与本任务方言断言条款逐条对齐 |
| ADR-0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 否 | 不触及。任务不含 authority 规则与 `@invariant` 内容 |
| ADR-0003 | 求值器与派生 schema（evaluate 接缝 / ROOT 约定 / 联合表示） | accepted | 是 | 一致。ok-union、可失败、纯函数接缝纪律被本任务同款复用；`parseVfsl` 行列锚定与 E 码表归属不受影响。备注 N1（公共接缝面扩展）裁 no-conflict |
| ADR-0004 | vfsl-protocol 类型协议包（D1–D5） | accepted | 否 | 不触及。本任务为引擎侧运行时函数，不进协议包；D3 领地边界不受影响 |
| ADR-0005 | 投影生成管线（SchemaSource 接缝 / 生成器契约 / 生成物入仓） | accepted | 是 | 一致。「消费方首动作 = 方言断言（`lang==='vfsl' && version===1`）」「id 是标签不是键」「返回完整信封」与本任务验收条款直接对齐。备注 N3（同步 vs async）裁 no-conflict |

## 冲突点

无冲突点。四级裁决分布：**no-conflict × 全部对照项；override-declared × 0；evolution × 0；hard-violation × 0。**

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | （无） |

### 备注（最近边界项，均为 no-conflict，供 SA1/SA2 知悉，不构成阻塞）

- **N1 公共接缝面扩展**：ADR-0003 记录「PRD #3『唯一公共测试接缝』措辞相应修订为两个公共观察点（`parseVfsl` 与 `evaluate` 的入参/出参）」。本任务新增第三个公共导出 `parseSchemaEnvelope`。该条款是 evaluate 立票时对 PRD 措辞的修订记录，非封闭式禁增清单；且任务简报明引「PRD #3 明示『信封解析与方言路由是后续引擎任务』」——接缝扩展在 PRD 预告轨道内。裁决：no-conflict。
- **N2 信封「多键不拒」**：ADR-0001/CONTEXT.md 定义信封内部结构为四键（「信封内部结构 `{lang, version, id, text}` 不变」指键名与结构不作变更，语境为 `__schema__`→`SCHEMA` 改名）；验收「多键不拒（向前兼容加法）」是校验宽容度选择，ADR/CONTEXT 无「信封封闭」条款，且与「方言只增不改」的加法演进精神一致。裁决：no-conflict（若终态欲收紧为严格四键，属设计层新决策，走设计修订流程，非本门禁冲突）。
- **N3 同步纯函数 vs async 接缝**：ADR-0005 规定 SchemaSource `load` 从第一天起 async（终态网络）。`parseSchemaEnvelope` 为同步、纯函数、不抛错。二者是不同接缝（数据源接口 vs 解析函数），无共享契约，互不约束。裁决：no-conflict。
- **N4 错误码空间独立**：ADR-0003 冻结的 E 码表（E310/E311 等 21 码）属 `parseVfsl`；ADR 全集未冻结信封层错误码。验收要求「错误码/消息不与 parseVfsl 的 VFSL-E 码空间混淆（独立前缀或明确区分机制）」与任何条款不相抵，且方向与既有码表纪律同向。裁决：no-conflict。
- **N5 id 仅标签**：验收「`id` 任意字符串（含空串、撞名场景）不影响判定」是 ADR-0005「**id 是标签不是键**：引擎正确性不依赖 id 唯一性」的直接落法。裁决：no-conflict（一致，非边界）。

## 结论

**Verdict: `clear`。** 任务简报的全部要求（接缝形状、信封四键形状校验、方言断言 loud-fail 只读、parseVfsl 透传携行列、id 仅标签、错误身份可区分、错误码空间独立、`SCHEMA` 键名）均落在 ADR-0001（含两次修订）/ ADR-0003 / ADR-0005 与 CONTEXT.md 既有决策的轨道内，且其中多条恰是这些决策的运行时兑付。无需 override 声明，无 evolution 上报项，无 hard-violation。**前置门禁通过，SA 派发可继续。** 全链约束清单见 `task_vfsl-schema-envelope_relevant_decisions.md`。
