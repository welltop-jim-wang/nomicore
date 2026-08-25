# 冲突门禁报告

- 被审对象：任务简报 `wiki/raw/task_namespace-runtime-fatal-status-close.md`（issue #92，Phase 0 前置门禁）
- 冲突基准：`docs/adr/` 全集 8 份（全读，无抽样）+ 根目录 `CONTEXT.md`
- 审查日期：2026-08-25（run_id: issue-92-1787617961-3408414）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19 修订、2026-08-21 SCHEMA 键名修订） | 低 | no-conflict。任务不触碰 schema 文本入仓与信封写入；AC1/AC5「摘要不暴露 SCHEMA 全文/ROOT 数据」是本文「schema 是数据」纪律在观测面的延续，无抵触 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 低 | no-conflict。close/status/fatal 均未引入 authority 类不变式，写路径维持「结构→值→单事务」管线 |
| ADR-0003 | 求值器与派生 schema | accepted | 低 | no-conflict。任务不动 ROOT 物化与求值链；status 的 schema 摘要键只读 active schema 身份，派生 schema 纪律未被触碰 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 无 | no-conflict。编译期类型投影轨道，与运行时生命周期无交集 |
| ADR-0005 | 投影生成管线 | accepted | 无 | no-conflict。生成管线轨道，与运行时生命周期无交集 |
| ADR-0006 | server persistence docstore（含 #64、#79 修订节） | accepted | 高 | no-conflict。close barrier 的 `handle.release()` 恰一次与本文 release 幂等、lease-only 语义吻合；#79 entry 级 getStatus 与 Runtime lifecycle 分层清晰（handle 状态 ≠ Runtime lifecycle，release 后 handle='released' 不反灌 Runtime 状态）；排空期内已接纳写的 notifyDirty 仍处租约有效期内（先于 barrier release） |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款被 ADR-0008 部分取代；其余继续有效） | 中 | no-conflict。close 排空期内已接纳写仍走本文 validated mutation 管线（零写入、observer no-rollback 不变）；fatal 语义与本文失败边界「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」一致；与被取代部分（schema-aware read、open 编排）无接触 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（本任务唯一行为契约源） | 核心契约 | no-conflict。AC1–AC8 与简报增量 1–5 逐句映射本文「Fatal 与失败通道」「生命周期、状态与所有权」节条款（对照明细见下与相关决议文档）；本任务是对该 ADR 剩余未实施条款的**兑付**，非演进、非推翻 |

CONTEXT.md 术语对照：写序列器 / P0 / 零写入 / 载体投影读取 / active schema 等简报用词与 CONTEXT.md 定义一致。close barrier 作为写序列器队尾节点与 P0（同为「不写 Y.Doc」的队列节点，ADR-0008 degraded 条款明文）先例一致，不构成「写序列器 = Y.Doc 写」术语违例。

## 冲突点

无。逐条对照未发现任何 hard-violation、override-declared 或 evolution 级冲突：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突点 |

关键对照明细（佐证「无冲突」结论，非冲突条目）：

1. **fatal 通道（AC1–AC4）**：与 ADR-0008「Fatal 与失败通道」节五条 bullet 逐句一致——任何 internal fatal 永久关闭全部写并保留读取；`committed:false` 不调用 dirty notifier；`committed:true` 或未知异常保守视为可能已提交、当前槽内 best-effort `notifyDirty()` 且始终 reject 原始 fatal；不补偿、不 fallback、不声称 rollback；已排队写按 FIFO 取槽、不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`。
2. **close 生命周期（AC6–AC7）**：与 ADR-0008「`close()` 幂等……」条款逐句一致——首次调用同步进入 `closing`、立即停止接纳公共 read 和 write、close barrier 入队尾、此前已接纳任务无条件排空、不取消、不设内部 timeout、barrier 只调用一次 `handle.release()`、release 失败 close Promise reject 但 Runtime 仍进入 `closed`、后续 close 返回同一个已结算 Promise。
3. **capability status（AC5）**：七键形状（lifecycle/read/rootWrite/schemaWrite + schema/fatal/close 摘要）即 ADR-0008「Runtime 提供结构化瞬时 capability status……schema、fatal、close issue 摘要。status 不暴露队列长度、任务类型或 sequence」的明文规定。当前代码六键无 close 摘要、`lifecycle` 恒 `'ready'` 是实施欠账（代码事实，非 ADR 状态）；本任务补齐是兑付条款，非演进。
4. **负向事件面（AC8）**：与「v1 不提供公共事件订阅；队列进度和内部事件属于日志、metrics 与 trace」一致；简报的十键负向锚（无 on/off/subscribe/emit）是执行细则。
5. **验收方式（AC9）**：确定性测试（fatal 全分类、dirty notification 计数、排队结算、幂等 close、release failure）对应 ADR-0008「以确定性状态机测试和真实 compiler/doc-runtime/Persistence 集成测试共同验收」；CI/typecheck/版本 bump 属工程纪律，非 ADR 基准（注记 N4）。
6. **fatal×close 交叉**：ADR-0008 中 fatal 只永久关闭写能力并保留读取，close 才停止接纳 read——简报「fatal 后 close 照常工作、read 在 close 后才停；close 排空期内 fatal 写槽照常 fatal 语义」是该两组条款的并读结论，无矛盾。fatal 后已排队写取得槽返回 `RUNTIME_WRITE_DISABLED`（零写入、不访问输入），与排空承诺（不取消、无条件执行到 settle）相容——排空指已接纳任务各自 settle，不要求其产生副作用。
7. **closing 期拒绝形状（SA1 开放点已受 ADR 约束）**：简报把 closing 期 read/write 结算形状留给 SA1 设计——ADR-0008 已有边界：read 侧「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常」；write 侧「普通、可预期且零写入的读取或写入失败使用领域化结果联合」。SA1 不得发明抛异常式公共拒绝 API（已写入相关决议文档约束清单）。

## 非冲突注记（供总控与全链 SA 参考，不构成阻塞）

- **N1（兑付非演进，no-conflict）**：ADR-0008 于 2026-08-23 定稿时即包含 close/status/fatal 全部条款；#89/#90/#91 为子集实施，本任务是剩余条款（close lifecycle、七键 status、fatal 验收收口）的兑付。简报「getStatus 结构化演进」措辞指 status 形状从六键到七键的**代码级**演进，不构成对任何 ADR 决策的修订——无需 override，无需 Jim 裁决。
- **N2（公共面测试锁，no-conflict）**：`runtime-public-surface-ownership.test.ts` 九键/六键/`lifecycle:'ready'` 锁为代码与测试事实，不构成 SA8 冲突基准（门禁基准仅 ADR 全集 + CONTEXT.md）；简报已声明十键/七键/三态为预期变更。SA1 设计须同步给出该测试的演进清单——实现范围问题，非门禁问题。
- **N3（fatal 措辞分域，no-conflict）**：#90 R2 的 `expectNoClosingWording`（fatal 文案不含 closing/closed 措辞）是测试锚纪律，不源于 ADR/CONTEXT；ADR-0008 对 fatal 摘要仅要求「稳定且不含原始 Error/stack/SCHEMA 全文/ROOT 数据」，措辞分域是其子集纪律，无抵触。简报自身声明该约束在引入 lifecycle 三态后仍然有效且与 status.lifecycle 状态值分域不冲突——术语边界由 SA1 显式维持即可。
- **N4（非基准纪律）**：HG #9 版本 bump（0.1.4 → 0.1.5）、`pnpm test`/`pnpm typecheck` 全量门禁、Node 20/24 CI、tsconfig include 边界等仓库纪律不源于 ADR/CONTEXT，不构成冲突基准；全链 SA 按简报执行即可。
- **N5（被取代条款，无接触）**：ADR-0007 被 ADR-0008 取代的仅是 schema-aware `readLogicalValueAtPath(derived, doc, path)` 与「普通 open 完成 schema 编译/META 检查/ROOT 提取/logical validation 后才注册」的编排条款；本任务 read 走已交付的 schema-independent 透传，close 停接纳 read 是 lifecycle gate 而非读取语义变更，未触碰被取代语义。全集 8 份 ADR 无一处于 superseded-by 终态，均为有效约束。
- **N6（层间状态不混淆，no-conflict）**：ADR-0006 #79 的 `DocHandleStatus`（entry 级：ready/persistence-degraded/released/disposed）与 ADR-0008 的 Runtime lifecycle（ready/closing/closed）是两层状态机；close barrier release 后 handle 层返回 `'released'` 不反灌 Runtime lifecycle，排空期写槽的 writable gate 全部先于 release 执行。两 ADR 分层清晰，简报的 lifecycle 状态机未混层。

## 结论

**Verdict: `clear`，冲突点 0，裁决分布：no-conflict ×8（ADR 层面）+ 0 evolution + 0 override-declared + 0 hard-violation。**

无需 override，无需 Jim 裁决条目。任务简报与 ADR 全集及 CONTEXT.md 无冲突，**放行**——总控可按路由进入 SA6 验收锚定，随后 SA1 设计。约束清单见同目录 `task_namespace-runtime-fatal-status-close_relevant_decisions.md`。
