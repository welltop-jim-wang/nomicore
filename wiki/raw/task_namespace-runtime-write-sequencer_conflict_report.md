# 冲突门禁报告

- 被审对象：任务简报 `wiki/raw/task_namespace-runtime-write-sequencer.md`（issue #90，Phase 0 前置门禁）
- 冲突基准：`docs/adr/` 全集 8 份（全读，无抽样）+ 根目录 `CONTEXT.md`
- 审查日期：2026-08-24（run_id: issue-90-1787537615-442625）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 修订、2026-08-21 SCHEMA 键名修订） | 低 | no-conflict。任务不动 schema 文本入仓与信封写入；SCHEMA 键名修订仅作背景 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 低 | no-conflict。ROOT write 走「结构→值→单事务」管线，未引入 authority 类不变式 |
| ADR-0003 | 求值器与派生 schema | accepted | 中 | no-conflict。ROOT 固定物化 Y.Map / `doc.getMap('ROOT')` 与 mutateRoot 作用对象一致；派生 schema 纪律经 active schema tools 间接消费，未被触碰 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 无 | no-conflict。编译期类型投影轨道，与运行时写路径无交集 |
| ADR-0005 | 投影生成管线 | accepted | 无 | no-conflict。生成管线轨道，与运行时写路径无交集 |
| ADR-0006 | server persistence docstore（含 #64、#79 修订节） | accepted | 高 | no-conflict。saveDoc=dirty notification、degraded 拒绝面归 Runtime 写前 gate、gate 后降级写仍登记、getStatus entry 级瞬时观察——与 AC2/AC7 及关键上下文 5/6 逐条吻合 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款被 ADR-0008 部分取代；其余继续有效） | 高 | no-conflict。AC5 调用 applyValidatedMutation、无写旁路、窄结果联合、零写入、observer no-rollback 均为本文条款的直接兑付；恢复 doc-runtime 公共面导出兑现本文公共入口条款；set-only 为「首版仅支持四操作」上限集合的子集（注记 N3）。与被取代部分（schema-aware read、open 编排）无接触 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（本任务唯一行为契约源） | 核心契约 | no-conflict。简报 AC1–AC10 与关键上下文 4–8 逐句映射本文「单一 write sequencer」「ROOT write」「Fatal 与失败通道」「读取能力」节条款（对照明细见相关决议文档）；SCHEMA write/close barrier/公共事件订阅延后属任务范围切分，非条款违反（注记 N1） |

CONTEXT.md 术语对照：写序列器 / P0 / active schema / 信封 / 载体投影读取 / 零写入 / 重建校验等简报用词与 CONTEXT.md 定义一致，无术语冲突。

## 冲突点

无。逐条对照未发现任何 hard-violation、override-declared 或 evolution 级冲突：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突点 |

关键对照明细（佐证「无冲突」结论，非冲突条目）：

1. **槽体顺序**：AC1–AC6（同步接纳定序 → lifecycle/fatal + writable gate 先于输入快照 → 递归冻结快照 → active schema 校验 → 单事务 → 同槽 await notifyDirty）与 ADR-0008「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务」逐位一致。
2. **执行时 schema**：AC4 与 ADR-0008「ROOT write 在自己的槽开始时使用当时 active schema；它不绑定调用时 schema generation」一致。
3. **degraded 语义**：AC7 与 ADR-0008「`persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写；它不阻止 read 或不写 Y.Doc 的 P0。gate 是瞬时观察：检查后才发生的降级不撤销已提交事务」及 ADR-0006 #79 修订节「gate 检查通过后才转为 degraded 的 mutation 不属『后续』写入」一致。
4. **fatal 通道**：关键上下文 4 与 ADR-0008「Fatal 与失败通道」节五条 bullet 逐句对应；AC1「单项失败不毒死后续队列」与「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`」相容——队列持续流转（不毒死）与写能力永久关闭（RUNTIME_WRITE_DISABLED）同时成立，无矛盾。
5. **读侧**：AC8 与 ADR-0008「读取只观察调用瞬间已经提交的 live Y.Doc，不等待已接纳但尚未提交的写」及 CONTEXT.md「读取不进入该序列」一致。
6. **写旁路禁令**：AC5 与 ADR-0007「业务调用方不得取得可写 Yjs 引用或绕过该入口」及 ADR-0008「Runtime 不公开 handle、Y.Doc……live 引用」一致。
7. **测试 seam**：关键上下文 5 的 notifier seam 注入与 ADR-0008「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」明文一致；AC10 双轨验收（确定性并发 + 真实 Persistence 集成）对应 ADR-0008「以确定性状态机测试和真实 compiler/doc-runtime/Persistence 集成测试共同验收」。

## 非冲突注记（供总控与全链 SA 参考，不构成阻塞）

- **N1（范围切分，no-conflict）**：ADR-0008 定义 v1 完整契约（mutateRoot + replaceSchema + close + status），本任务只实现 ROOT write 子集；简报明文声明其余归后续 issue。ADR 是行为契约而非一次性交付清单，子集实现不违反任何条款。SA1 设计时不得将未实现部分提前实现（简报已划界）。
- **N2（公共面恢复导出，no-conflict）**：简报关键上下文 3 将「doc-runtime 恢复导出 applyValidatedMutation（set-only）+ 同步更新 public-surface-guard 测试」纳入本任务范围。ADR-0007 明文将 applyValidatedMutation 列为 `@nomicore/doc-runtime` 公共入口，当前「不导出」状态是 commit 21b0eed 的临时下架（代码事实，非 ADR 决策）；恢复导出是兑付 ADR-0007，非冲突。守卫测试当前锁定的「不导出」断言不是冲突基准（代码/测试，非 ADR/CONTEXT 收录决策）。
- **N3（set-only 子集，no-conflict）**：ADR-0007「首版 mutation 仅支持 `set`、`delete`、`array-insert`、`array-delete`」为上限约束（「仅支持」划定边界）；#76/#87 以 set-only 收口是上限内的部分兑付，非违反。后续扩展其余三操作仍在 ADR-0007 范围内。
- **N4（被取代条款，无接触）**：ADR-0007 被 ADR-0008 取代的仅是 schema-aware `readLogicalValueAtPath(derived, doc, path)` 与 open 编排条款；本任务 read 走已交付的 schema-independent 透传（#89），未触碰被取代语义。无任何 ADR 处于 superseded-by 终态，全集 8 份均为有效约束。
- **N5（非基准纪律）**：简报引用的「硬门禁 9（bump patch 版本）」、tsconfig include 边界（#89 设计 §7.1）等仓库纪律不源于 ADR/CONTEXT，不构成冲突基准；全链 SA 按简报执行即可。

## 结论

**Verdict: `clear`，冲突点 0，裁决分布：no-conflict ×8（ADR 层面）+ 0 evolution + 0 override-declared + 0 hard-violation。**

无需 override，无需 Jim 裁决条目。任务简报与 ADR 全集及 CONTEXT.md 无冲突，**放行**——总控可按计划将简报派发 SA1（设计）。约束清单见同目录 `task_namespace-runtime-write-sequencer_relevant_decisions.md`。
