# 冲突门禁报告（修订轮 rev2）

- **被审对象**：`wiki/raw/task_read-logical-value-at-path_rev2.md`（PR #83 owner 第二轮 Review「Request changes」修订简报；剩余问题：R1/R2/R3 回归测试对 D17 value-first 核心分支缺乏变异判别力——可测性重构 + 测试硬化，无 correctness blocker）
- **冲突基准**：`docs/adr/` 全集（0001–0007，共 7 份，逐份全文读取，无抽样）+ `CONTEXT.md`。基准自 rev1 门禁后零变更（`git log --oneline -- docs/adr/ CONTEXT.md` 最新提交 `ee3643c` 早于 rev1 全部工作提交；8 个文件 mtime 同批 2026-08-22 15:28:27；`git status --porcelain docs/adr/ CONTEXT.md` 为空）。
- **门禁人**：SA8（Conflict Gatekeeper）
- **日期**：2026-08-22（worktree `/home/wangjian/nomicore-fix-issue-75`，branch `fix/issue-75-on-docs-doc-runtime-validation`，run_id `issue-75-rev-1787397220`）
- **特别审查点**（总控指定）：`NavOutcome` 与仲裁函数以「包内可测试 seam」（不从 `packages/doc-runtime/src/index.ts` 导出）暴露给包内测试，是否触碰 INV-14 或任何 ADR 条款；rev1 DENY 面本轮延续有效性。

## Verdict

`clear`

rev2 简报与 ADR 全集 + CONTEXT.md 无冲突。总控可放行 rev2 工作流（SA6 红灯锚定 → SA1 设计 → SA8 设计复审 → SA2 攻击评审 → SA3 实现 → 总控亲跑验收 → SA4 → SA7 → AC 门禁）。

## ADR 盘点（7 份逐份对照）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订节） | 间接 | 无冲突。rev2 不触 schema 文本、脚手架纪律、SchemaSource 接缝与方言冻结；改动域为 `@nomicore/doc-runtime` 包内测试 seam 与测试文件 |
| ADR-0002 | nomicore 是全新重写，authority 出范围 | accepted | 无关 | 无冲突。纯读取路径内部可测性重构 + 测试，不涉 authority、不触写入管线 |
| ADR-0003 | 求值器与派生 schema | accepted（取代同号草稿，无对外 supersede） | **直接** | 无冲突。seam 抽取**不改仲裁语义**——D17 四规则（首个真实 value 胜、missing 继续、全 missing → missing、全 reject → reject）逐字保持，而该语义正是 §3「路径存在性为**任一成员出现即存在**」的读取维度兑付；表驱动首行锁的正是「前序 missing 不得遮蔽后序在场 value」；判别式缓存条款不触（读取零判别式消费）；派生 schema 形状不动（DENY 延续）。§4「解析动作由**包内共享解析器**完成」为「包内导出、不经公共 barrel」提供家族级模式先例 |
| ADR-0004 | vfsl-protocol 类型协议包 | accepted | 间接 | 无冲突。D3 协议包零运行时代码，不构成运行时约束；D4 test-d 方法学（`expectTypeOf` / `@ts-expect-error` 自反转）正是 AC-R2-1 要求保持绿的冻结形态锁的方法出处——rev2 是该锁的**延续适用**而非修改 |
| ADR-0005 | 投影生成管线 | accepted | 无关 | 无冲突。codegen 管线与运行时读取无交集 |
| ADR-0006 | Cordis 持久化插件与 doc 三条目布局 | accepted（含 createDoc/owner 修订节） | 间接 | 无冲突。rev2 读取面仍止于 ROOT 子树（「校验只作用 ROOT 子树」同款边界）；不触持久层 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted | **直接** | 无冲突。见下「特别审查点裁决」与逐条对照表——seam 属本 ADR 公共条款之下的实现粒度；公共四能力、签名、结果联合、fail-fast 边界零改动 |

无任何 ADR 处于 superseded 状态（ADR-0003 取代同号未定稿草稿、ADR-0006 修订节取代本 ADR 内部早期条款——均按现行有效文本对照，同 rev1 结论）。

## 特别审查点裁决：包内可测试 seam vs INV-14 / ADR

**结论：不触碰 INV-14，不触碰任何 ADR 条款（no-conflict）。** 论据四层：

1. **INV-14 的约束单位是包边界，不是模块边界。** INV-14（rev1 设计 §6，任务族内规、非 ADR）原文：「三态不泄漏：`NavOutcome` 包内私有；missing/reject 不进公共联合、不进 issues 体系；顶层映射恒收束到冻结两态」；其执行锚是「test-d 冻结形态；SA8 注记 3」——test-d 锁从 `../src/index.js` 导入并只锚定公共签名与两态联合。「包内私有」的判据是**不经 `packages/doc-runtime/src/index.ts` 转出口**；从 `read.ts` 或包内新文件做模块级 `export`（供同包测试 deep import）不越过包边界，对 `@nomicore/doc-runtime` 消费方不可见。AC-R2-1 自身已把该判据焊死（「index.ts 公共导出零新增，test-d 冻结形态锁保持绿」）——简报与内规同向，非绕行。
2. **同一模式有已评审先例。** rev1 设计 §8.2：「`packages/doc-runtime/src/extract.ts` — 首轮落地（`walk`/`makeRefResolver` **包内导出**，≤8 行）；rev1 零改动」——包内导出测试/共享 seam 经首轮 SA2/SA4 评审与 owner rev1 Review（「生产实现修复正确」）确认，非新形态。ADR-0003 §4「包内共享解析器」为家族级同款。
3. **ADR 层无约束条款，且有同向条款。** ADR-0007 列举的公共提供面为四能力；「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」主动容纳包内领域联合（`NavOutcome` 三态即其一）；「成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或**内部类型**」（mutation 条款）与 INV-14 同精神——公共接缝不泄漏内部类型。rev2 对此零触碰：实测 index.ts 现行导出恰为五项（`extractYjsSnapshot`/`ExtractIssue`/`ExtractResult`/`readLogicalValueAtPath`/`ReadLogicalValueResult`），零 `NavOutcome`、零仲裁函数，rev2 要求维持。
4. **语义面零变更由简报自锁。** seam 抽取伴随的语义约束（「声明序迭代与首 value 短路惰性（不预先消费后序成员）语义不变」）正是 INV-7 精确化 + D17 + INV-13（观测等价）的重述——重构是这些既有不变量的**载体迁移**，不是修改。

## rev2 要求逐条对照（ADR-0007 / ADR-0003 为依据；INV/D 编号为任务族内规，出处见 relevant_decisions）

| # | 被审对象要求（rev2 简报） | ADR 条款（原文） | 裁决 |
|---|---|---|---|
| 1 | AC-R2-1：三态仲裁抽为包内纯函数 `arbitrateUnion(outcomes: Iterable<NavOutcome>): NavOutcome` 或等价包内 seam；`read.ts` union 分支经该 seam 仲裁；INV-14 不破坏（index.ts 零新增导出、test-d 锁保持绿）；声明序迭代与首 value 短路惰性语义不变 | ADR-0007「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」+ 公共四能力清单（seam 属其下实现粒度）；ADR-0003「路径存在性为**任一成员出现即存在**」（语义原样保持）；「解析动作由包内共享解析器完成」（模式先例）。INV-14/H-3 判据按包边界满足（见特别审查点） | no-conflict |
| 2 | AC-R2-2：表驱动包内仲裁测试六行（`[missing, value('v')] → value('v')` 首行证明前序 missing 后仲裁继续、后序真实 value 胜出；含 mixed 双序与全同态） | ADR-0003「任一成员出现即存在」「any-of……重叠成员不构成错误」——首行锁「前序合法缺席不得遮蔽后序在场」；mixed 双序锁 D17 §3.3「value > missing > reject」。测试义务，ADR 无涉语义冲突 | no-conflict |
| 3 | AC-R2-3：R1/R2/R3 测试说明改写为「行为一致性锁」，删除「动态覆盖 missing → later value」宣称；行为断言零改动 | 无 ADR 条款涉测试注释措辞；改写方向与 rev1 SA5 结构不可达结论一致（不虚构可达性），同 ADR-0003 重叠合法性精神的诚实成文 | no-conflict |
| 4 | AC-R2-4：mutation proof——临时变异「首 missing 即返回」证明新增测试转红（R1/R2/R3 对照仍绿）→ 还原复绿，证据入 SA7 报告 | 无 ADR 条款涉验证方法学；变异目标是 rev2 ALLOW 面（read.ts union 分支/seam）内的一次性临时改动并还原，不触 DENY、不触公共行为 | no-conflict |
| 5 | AC-R2-5：不回归既有测试（rev1 五组绿灯锁 + H-a/H-b/H-c + SUP 系列 + 全仓）；`packages/doc-runtime` patch bump 0.1.3 → 0.1.4（硬门禁 #9）；DENY 面零改动 | ADR-0007「性能优化必须在行为等价测试下后续引入」（行为等价锁的义务面）、「普通读取成本与目标 path 子树规模相关」（H-a 锚点延续）；ADR-0003 派生 schema 纪律（`packages/vfsl` 零改动）；ADR-0007「`@nomicore/vfsl` 继续保持无 Yjs 依赖」（vfsl DENY 同向）。版本 bump 为流水线门禁惯例，无 ADR 约束 | no-conflict |
| 6 | 任务类型判定「深度重构」及工作流排布（SA6 红灯锚定在前、SA1/SA2/SA3/SA4/SA7 全链、修订轮允许 push、禁提交 `.mabf/**`） | 流程排布属总控职权，无 ADR 对照对象；不触任何 ADR 条款 | no-conflict |

## 冲突点

无。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | （空表：0 冲突点） |

裁决分布：no-conflict ×6（逐条对照）＋7（ADR 盘点）＋1（特别审查点）；override-declared ×0；evolution ×0；hard-violation ×0。

rev2 不改写任何 ADR 决策条款，也不修订任何任务族冻结契约（公共签名/两态联合/AC3 缺键形态/message 字段原样；INV-14 经包边界判据维持而非放松）；「抽取 seam」是既有不变量的实现载体迁移，**不构成 ADR 演进**，无 Jim 裁决项。

## 非冲突注记（不阻塞；指定验证责任）

- **注记 R2-1（seam 落位与 ALLOW 面收口——SA1 设计义务）**：`arbitrateUnion`/`NavOutcome` 的模块级导出落位（`read.ts` 内导出或包内新文件如 `arbitrate.ts`）由 SA1 定夺并写入 ALLOW LIST；无论落位何处，硬约束是 index.ts 零转出口（INV-14）+ 测试经 deep import（`../src/read.js` 等）消费。现有 10 个测试文件全部从 `../src/index.js` 导入——seam 测试的 deep import 是**经简报明文批准的破例**，SA1 应在设计文档成文，防 SA4 静态验尸误报。
- **注记 R2-2（短路惰性是 SA2 首要攻击面）**：`Iterable<NavOutcome>` 形态的 seam 若在仲裁前物化（如 `Array.from(outcomes)` 或生成器外层预构造全部成员结局），即破坏「首 value 短路不预先消费后序成员」（INV-7 精确化）并连带 H-a 成本护栏（D13 上界 O(触及节点数 × 路径长 × 成员扇出) 的常数因子前提）。表驱动测试本身无法锁惰性（传静态序列恒可仲裁）——SA2 须攻击此点；如需动态锁（如生成器计数副作用断言「首行场景只拉取 2 个成员」），属 SA1/SA2 设计裁量，非 ADR 义务。
- **注记 R2-3（mutation proof 卫生）**：AC-R2-4 的临时变异必须 (a) 只落在 ALLOW 面（seam/read.ts union 分支），(b) 验证后完全还原（diff 为零）方可进入后续门禁，(c) 变异态产物不得随 commit/push 泄漏；对照事实（R1/R2/R3 在变异下仍全绿）按简报要求记入 SA7 报告——它同时是 AC-R2-3 措辞改写（「判别力仅由新增测试提供」）的证据底座。
- **注记 R2-4（DENY 面延续有效性核验）**：rev1 DENY 全部延续且 rev2 表述收紧无松动——`packages/vfsl/src/**`（ADR-0003 派生形状冻结 + 结构系统不得为凑测试放宽）；extract.ts / carrier.ts / index.ts 行为变更禁止（index.ts 叠加「公共导出零新增」；extract.ts 首轮既有 `walk`/`makeRefResolver` 包内导出属已评审存量，不要求回退、本轮零新改动）；read.ts Phase A / `notAllowed` / 顶层 try/catch 编排不动。实测现行 index.ts 导出恰为冻结五项，基准干净。
- **注记 R2-5（SA6 owned 纪律分工）**：AC-R2-3 的 R1/R2/R3 措辞勘误由 SA6 执行（行为断言零改动），SA3 不得触碰已入库测试断言；表驱动新测试（AC-R2-2）的 owner 归属与红灯锚定顺序（SA6 先行）由总控按简报工作流执行——流程事项，无 ADR 对照。

## 结论

**Verdict = clear，放行。** owner 第二轮修订建议（包内纯仲裁函数 seam + 表驱动六行 + 行为一致性锁措辞改写 + mutation proof）与 ADR 全集 + CONTEXT.md 零冲突：seam 以「包内可测试、公共面零新增」形态落地，恰是 INV-14「三态不泄漏」判据（包边界）的维持而非触碰，且有 extract.ts `walk`/`makeRefResolver` 已评审先例与 ADR-0003「包内共享解析器」家族模式支撑；D17/INV-7/D13/INV-13 语义约束经简报自锁为「载体迁移、零语义变更」。无需 override，无 Jim 裁决项。注记 R2-1/R2-2 建议随派发转交 SA1/SA2 重点处理（seam 落位成文 + 惰性攻击面）。
