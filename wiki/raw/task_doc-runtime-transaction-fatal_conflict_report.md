# 冲突门禁报告（Phase 0 前置门禁）

- 被审对象：`wiki/raw/task_doc-runtime-transaction-fatal.md`（issue #87：doc-runtime committed-aware transaction fatal 契约——第 0 阶段前置冲突门禁；功能开发：冻结新异常契约 + 回归测试）
- 冲突基准：`docs/adr/0001`–`0008` 全集（8 份，逐个全读，无抽样）+ `CONTEXT.md`。本 worktree 基线 `docs/namespace-runtime`（PR #85 head，74b9cfd）**新增 ADR-0008**——较此前各任务门禁（0001–0007）多一份，且恰为本任务的直接授权来源；worktree 对 `docs/adr/` 与 `CONTEXT.md` 零本地改动。
- 门禁：SA8（run_id: issue-87-1787469258-378585）
- 前序门禁记录：doc-runtime 轨道 materialize-root 初轮/rev1/rev2 前置门禁与设计后复审均 clear（E200/E201/E202 通道即其产物）；本轮按 ADR 原文（含新入基准的 ADR-0008）独立裁决。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19、2026-08-21 修订节） | 低 | 无涉：本任务纯运行时异常契约，不触碰 schema 文本/信封/codegen 轨道 |
| ADR 0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted | 低 | 一致：phase 区分是管线阶段的事实披露（调用语境与提交状态），非 authority 式数据值不变式；「结构 → 值 → 单事务提交」三步纪律恰是（pre-commit 失败 ⟹ 文档不变）的上游依据 |
| ADR 0003 | 求值器与派生 schema | accepted | 低 | 无涉（纪律同向）：结果联合可失败接缝先例不受触碰——fatal 通道不反向吞并结果联合面；ROOT=Y.Map / 联合表示不涉及 |
| ADR 0004 | vfsl-protocol 类型协议包 | accepted | 无 | 无涉：编译期类型投影轨道 |
| ADR 0005 | 投影生成管线 | accepted | 无 | 无涉：SchemaSource/生成器/CI 保鲜轨道 |
| ADR 0006 | Cordis 持久化插件与 doc 三条目内容布局 | accepted（含 2026-08-21、2026-08-22 修订节） | 中 | 一致且同向强化：对已提交事务的「不通用回滚」处置与 committed fatal「不补偿、不 fallback、不声称 rollback」是同向纪律的两层（落盘层 vs 内存事务层）；`persistence-degraded`/写前 gate 归属条款防止把持久化失败误并入 transaction fatal；「单 update 单元」是 transaction helper 原子性前提 |
| ADR 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（Runtime/open/read 条款由 ADR 0008 部分取代） | **直接** | 一致：被取代面（schema-aware readLogicalValueAtPath、open 编排）与本任务无交集；继续有效面恰是本任务的上游——materializeRoot/applyValidatedMutation 两入口条款、失败边界（observer fatal / 不虚假声称回滚 / 不尝试 fallback）、领域结果联合纪律逐条被 AC 兑现而非违反 |
| ADR 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（本基线新增） | **直接（授权来源）** | 一致：本任务 = ADR-0008「必要的底层演进」第 2 条（「transaction helper 提供 committed-aware branded fatal contract」）的明文兑付；fatal 与失败通道一节（DocRuntimeFatalError / committed / 稳定 phase / 保守语义 / 不补偿不 fallback 不声称 rollback / 双通道边界）与 AC1–AC5 逐句对应 |

无任何 ADR 处于整份 superseded 状态；ADR-0007 的部分取代面（ADR-0008「取代关系」节自述）不涉及本任务管辖面；ADR-0001/0006 的修订节均为 owner 裁决放行的内部演进，按修订后文本对照。

## 冲突点

**无**（0 条 hard-violation / 0 条 evolution / 0 条 override-declared）。任务简报未声明推翻任何 ADR；全部要求均为 ADR-0007/0008 既定条款的直接兑付或其未枚举空间（phase 取值集、意外异常归类）的契约化，裁决权按简报规划交给 SA1，出口受本报告边界条件（W1–W5）约束。

---

## 重点裁决一：AC1 branded fatal = ADR-0008 明文授权的底层演进，非新决策

**问题**：简报要求「提供稳定 branded fatal error，至少包含 committed 与稳定 phase」——这相对于现行裸 `Error` + 消息前缀通道（E201/E202 throw 家族）是新契约。与既有 ADR 是否冲突？

**裁决：no-conflict——不是引入新决策，而是执行 ADR-0008 已冻结的决策。** 论证：

1. **授权条目逐字对应**：ADR-0008「必要的底层演进与实施顺序」第 2 条明文要求「transaction helper 提供 committed-aware branded fatal contract」，且在演进列表中标序为 Runtime 实现的前置（「Runtime 实现前先完成以下 `@nomicore/doc-runtime` 契约演进」）。本任务就是该条目的兑付票。
2. **形状与命名按 ADR 原文**：ADR-0008 冻结「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`」——简报 AC1 的措辞（「至少包含 committed 与稳定 phase」）与 ADR 最小面一致，未加码也未削减。公共类型名应取 ADR 原文 `DocRuntimeFatalError`（W2'）；Runtime 层的 `RuntimeWriteFatalError` 亦为 ADR-0008 原文命名，两层互不侵占。
3. **现行通道的升格是收紧不是违反**：E201（写后偏离）/E202（写前语境拒绝）现为裸 Error throw；为其补 branded 身份与 committed/phase 事实面，不改变任何既有 ADR 承诺方向（零写入、throw 形态、不补偿），反而使 ADR-0008 要求的「可区分」可机读。

## 重点裁决二：AC2 三相区分落在 ADR「稳定 phase」的未枚举空间

**问题**：简报要求「observer cleanup throw、post-transaction verification 与明确 pre-commit internal failure 可被准确区分」。ADR 只要求「稳定 `phase`」未枚举取值——三相区分是否触碰冻结条款？

**裁决：no-conflict——phase 取值集是 ADR-0008 留白的实现空间；三相均可锚定既有条款语义，方向是精确化。** 论证：

1. **「observer cleanup throw」**：ADR-0007 失败边界已定谳「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」——该情形的事务提交状态（yjs cleanup 期抛错时 update 通常已发出）正是 committed-aware 契约必须诚实披露的事实；为它定一个 phase 值是事实披露，不改变 fatal 定性。
2. **「post-transaction verification」**：对应现行写后校验面（rev2 RD1 ⑤/RD8 ⑥，E201 家族）——ADR-0007「零写入承诺覆盖所有验证失败和 detached 构造失败」界定的是**写前**验证；写后校验失败天然 committed:true，纳入 fatal 通道与 rev2 W1 红线（唯一相容形态 = throw）同向。
3. **「明确 pre-commit internal failure」**：对应 committed:false 面——ADR-0008 fatal 条款明文列举「`committed:false` 不调用 dirty notifier」，即 ADR 已预设 committed:false 的 internal fatal 存在；三相区分只是把该预设显性化。
4. **约束不变**：phase 细化不得改变 ADR-0007 observer 纪律（「Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报」——这是 Runtime 层义务，doc-runtime fatal 只如实上报观察到的异常）；phase 取值集一经发布即冻结稳定（ADR-0008「稳定 phase」+ CONTEXT.md loud-fail/冻结文化）。

## 重点裁决三：AC3/AC5 双通道边界——领域联合不被吞并、未识别异常保守归 committed:true

**问题**：简报要求「普通 logical/path/materialization/mutation 失败继续使用领域结果联合，不进入 fatal 通道」与「未识别 transaction 异常采用保守语义并有回归测试」。现行 E200（写前意外异常 → ok:false 结果联合）与 fatal 通道的边界如何落位？

**裁决：no-conflict——AC3/AC5 是 ADR 条款的逐句重述；「意外异常归类」是未枚举空间，归 SA1，受红线约束。** 论证：

1. **AC3 直接重述两份 ADR**：ADR-0007「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型……逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast」+ ADR-0008「普通、可预期且零写入的读取或写入失败使用领域化结果联合；ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型」。logical/path/materialization/mutation 失败留在联合面 = 维持条款。
2. **AC5 直接重述 ADR-0008**：「`committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal」——「保守语义」即未识别一律按 committed:true 处置；回归测试要求是验收强化（W3 锚：committed:true 不得降格为 false）。
3. **意外异常的归类是未枚举空间**：ADR 未逐类枚举哪些异常进 fatal、哪些收编结果联合（现行 E200 把写前意外异常收编为 ok:false 单 issue 是 rev1 设计决策，非 ADR 条款）。SA1 可在 W1/W3/W5 约束下调整归类（如明确 internal 性质的写前异常改道 committed:false fatal），但凡「普通、可预期且零写入」失败必须留在联合面（W5），且任何写前 fatal 必须锚 0 update / state 字节不变（W3）。
4. **与持久层失败不混淆**（ADR-0006）：`persistence-degraded`、saveDoc 失败、flush retry 是持久层内部异步行为（「失败不向触发该事务的客户端追溯报错、不通用回滚」），不属于 transaction fatal 契约的 phase 面——SA1 不得把持久化失败收编进 DocRuntimeFatalError。

## 逐条对照明细（全部判 no-conflict，供复核）

| # | 被审对象条款 | ADR 依据（原文） | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | What to build：为 transaction fatal 冻结 committed-aware 异常契约，使上层 Runtime 能区分零写入 internal failure 与已提交 fatal，不猜测、不虚假声称回滚 | ADR-0008：「transaction helper 提供 committed-aware branded fatal contract」+「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`」；ADR-0007：「不虚假声称自动回滚，也不尝试 fallback」 | no-conflict | ADR-0008 演进条目第 2 条的明文兑付；详见重点裁决一 |
| 2 | AC1：稳定 branded fatal error，至少含 committed 与稳定 phase | ADR-0008：「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`」 | no-conflict | 与 ADR 最小面逐字一致；命名按 ADR 原文（W2'） |
| 3 | AC2：observer cleanup throw、post-transaction verification、明确 pre-commit internal failure 三相可区分 | ADR-0007：「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal……」+「零写入承诺覆盖所有验证失败和 detached 构造失败」；ADR-0008：「稳定 `phase`」「`committed:false` 不调用 dirty notifier」 | no-conflict | phase 取值集为 ADR 留白空间；三相均可锚定既有条款语义；详见重点裁决二 |
| 4 | AC3：普通 logical/path/materialization/mutation 失败继续用领域结果联合，不进 fatal 通道 | ADR-0007：「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」；ADR-0008：「普通、可预期且零写入的读取或写入失败使用领域化结果联合」 | no-conflict | ADR 条款逐句重述（W5 红线同向） |
| 5 | AC4：committed fatal 不执行补偿写、不 fallback、不声称 rollback | ADR-0008：「不补偿、不 fallback、不声称 rollback」；ADR-0007：「不虚假声称自动回滚，也不尝试 fallback」「不覆盖、不合并、不 fallback」 | no-conflict | ADR 条款逐句重述（W1 红线同向） |
| 6 | AC5：未识别 transaction 异常采用保守语义并有回归测试 | ADR-0008：「`committed:true` 或未知异常保守视为可能已提交，在当前槽内 best-effort `notifyDirty()`，但始终 reject 原始 fatal」 | no-conflict | 保守语义的 ADR 原文兑付；回归测试 = 验收强化（W3） |
| 7 | AC6：materializeRoot 与 applyValidatedMutation 相关测试覆盖 exact error identity、commit 状态、Y.Doc 最终状态 | ADR-0007：materializeRoot / applyValidatedMutation 两入口条款 + 失败边界；ADR-0006：「事务原子性由 Y.transact（单 update 单元）保证」 | no-conflict | 经 ADR 冻结入口做契约测试是正用；注意 applyValidatedMutation 仓内未实现——落地方式是范围治理点（观察项 O1），非 ADR 冲突 |
| 8 | AC7：全量 typecheck/test 与 Node 20/24 CI 通过 | （无 ADR 条款治理 CI 流程；ADR-0005 CI 条款属投影保鲜轨道，无交集） | no-conflict | 纯工程流程条款 |
| 9 | Blocked by #74 #76、base=docs/namespace-runtime（PR #85 head）、branch fix/issue-87-on-docs-namespace-runtime | （无 ADR 条款治理依赖/分支流程；已核对基线 ADR 全集与 CONTEXT.md 无本地改动，冲突基准成立） | no-conflict | 纯流程条款；#74（materializeRoot，含 rev2 guard/verify 面）已并入基线，是本任务的直接前置 |

## 边界条件（非冲突；SA1 设计约束 + SA8 设计后复审复核锚点）

- **W1（写后 fatal 唯一相容形态 = throw/reject）**：committed:true 面不得开 ok:false 后门、不得补偿修复写入、不得声称已回滚（ADR-0007 失败边界 + ADR-0008 fatal 条款；沿 materialize-root rev1/rev2 门禁 W1）。
- **W2'（branded 形状与命名）**：公共 fatal 类型名与最小字段面按 ADR-0008 原文 `DocRuntimeFatalError` + `committed` + 稳定 `phase`；phase 取值集一经发布即冻结；不侵占 Runtime 层 `RuntimeWriteFatalError` 命名。
- **W3（零写入锚 + 诚实 committed）**：写前/committed:false fatal 回归测试锚 0 update 与 state 字节不变；committed:true 不得降格为 false；未识别异常一律保守归 committed:true。
- **W4（分层红线）**：`@nomicore/doc-runtime` 仅依赖 `@nomicore/vfsl + yjs`（ADR-0007 依赖面），不得 import Runtime/持久层；`notifyDirty` best-effort 与「永久关闭写能力」是 Runtime 层槽内职责（ADR-0008），doc-runtime fatal 只携带事实。
- **W5（领域联合不吞并）**：现行 ok:false + issues 联合面（E100/E200 家族及 AC3 列举的普通失败）不得被改道进 fatal 通道；「意外异常」归类调整属 ADR 未枚举空间、归 SA1，但受 W1/W3 约束；持久化失败（persistence-degraded/flush retry）不并入 transaction fatal phase 面（ADR-0006）。

## 观察项（SA8 登记，非门禁结论）

- **O1（AC6 范围治理）**：`applyValidatedMutation` 生产代码尚未实现（全仓 grep 仅 ADR/PRD/wiki 档案命中；PRD 0060 §6 规划中）。AC6 对它的测试覆盖须由 SA1 显式设计落地方式（共享 transaction helper 的复用测试面 / 测试 seam / 范围声明），**不得以静默实现完整 validated mutation 管线的方式扩范围**——其语义由 ADR-0007 冻结（含首版 set/delete/array-insert/array-delete 全部条款），属独立任务面；若总控决定扩范围应显式立项。
- **O2（E202 归类语义重量）**：现行 E202（写前活动 transaction 语境拒绝）是**调用方契约破坏**而非引擎 internal failure。若 SA1 将其归入 DocRuntimeFatalError，Runtime 层按 ADR-0008「任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力」处置——语境误用即触发永久关闭，语义偏重。归类归 SA1 + SA2 评审；若保持独立拒绝形态（非 branded fatal），与 ADR-0008 无冲突（该 ADR 只约束 internal fatal 面）。

## 结论

**verdict = clear，放行进入流水线（SA1 → SA8 设计后复审 → SA2 → SA3 → SA4 → SA7 → AC 门禁）。**

- 冲突点数：**0**；裁决分布：no-conflict × 9（明细行 #1–#9，含三组重点裁决展开）、override-declared × 0、evolution × 0、hard-violation × 0。
- 本任务是 ADR-0008「必要的底层演进」第 2 条的明文兑付票：branded `DocRuntimeFatalError`（committed + 稳定 phase）形状、保守语义、不补偿/不 fallback/不声称 rollback、双通道边界全部为 ADR-0007/0008 既有条款的直接执行；phase 取值集与意外异常归类是 ADR 留白空间，归 SA1，受 W1–W5 边界条件约束。
- 无需任何 override；无条目需 Jim 裁决。观察项 O1（applyValidatedMutation 测试落地方式）与 O2（E202 归类语义重量）移交 SA1/SA2 处理，不构成阻塞。
- 相关决议文档已同步产出（`task_doc-runtime-transaction-fatal_relevant_decisions.md`，含 8 份 ADR 约束清单、CONTEXT.md 术语、前序红线 W1 沿用与现行通道形态导航）供全链 SA 复用。
