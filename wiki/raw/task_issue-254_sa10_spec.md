# SA10 规格审查报告 — issue #254：周期 reconciliation 超时 failed/needs-resync 僵尸的协议合规自愈（final-verification，iteration 1）

- **Date**: 2026-09-08
- **Verdict**: **approve**
- **审查对象（本轮）**: committed HEAD `09348e797403ed311d852db8d600749f1f41f4a4`（`docs(issue-254): record SA9 standards and SA10 spec review artifacts`）
- **Fix HEAD（实质变更，前轮已批准）**: `ee40095c0f3e61da7356fa19e130026725984e14`（`fix(ws-replication): recover peer after namespace timeout`）
- **Dispatch**: sa-5db82a4c-4e96-49b2-96ff-e61a490537ed（mabf-sa10，final-verification，iteration 1）
- **Issue comments**: REST 读取为空（本轮 dispatch 简报同证；前轮简报/SA6/SA1/SA8/SA3/SA4 六方同证）——**无 owner 反馈适用项**，验收口径 = 简报 AC1–AC6 逐条 + SA6 契约
- **审查方法**: 静态规格审查（SA10 不运行测试/服务、不修改任何实现/设计/测试文件；唯一写入产物 = 本文件）。结论以 `git rev-parse`/`git diff`、HEAD 源码锚点与上游归档产物交叉核验为证据

---

## 1. 本轮使命与结论摘要

本轮只须核验一件事：当前 HEAD `09348e7` 相对前轮已批准的 fix HEAD `ee40095` 的 delta **仅为补交既存 SA9/SA10 评审产物**，且 issue #254 验收标准与 SA6 契约在当前 HEAD 继续满足、无任何代码/测试/协议行为变化。

**核验结论：成立。**

- `git diff ee40095..09348e7 --name-status` = 恰 2 条 `A`：`wiki/raw/task_issue-254_sa9_standards.md`、`wiki/raw/task_issue-254_sa10_spec.md`；`--stat` = 2 files，+199/−0（纯新增）。
- `git diff ee40095 09348e7 -- packages domains apps docs tests scripts .github package.json pnpm-lock.yaml pnpm-workspace.yaml vitest.config.ts tsconfig.base.json` 输出 **0 行**；`--name-only` 剔除上述两文件后无剩余（实证 `ONLY_SA_REVIEW_ARTIFACTS`）。
- 两产物均为 `wiki/raw/**` 评审证据，非构建/运行/测试/CI 输入 ⇒ 当前 HEAD 的协议行为、测试面、类型门与 `ee40095` **逐字节等价**。
- 因此前轮 SA10 对 `ee40095` 的 AC1–AC6 全达成与 SA6 契约满足结论（见 §4 并入）对 `09348e7` **无需任何修订即继续完全有效**；本席另对关键 AC 锚点在 HEAD 源码做了独立抽查（§3），全部在位。

## 2. Reviewed inputs（本轮）

| 输入 | 状态 |
|---|---|
| 本轮 dispatch 指令（final-verification，iteration 1；HEAD 哈希指定值） | 已读；`git rev-parse HEAD` = `09348e797403ed311d852db8d600749f1f41f4a4` 逐字一致 |
| 前轮 SA10 产物（已随 HEAD 归档的 `wiki/raw/task_issue-254_sa10_spec.md`，verdict approve，审查对象 `ee40095`） | 已全读；其锚定对象与 `git log` 实证 fix 提交逐字对应，无错标 |
| 前轮 SA9 产物（随 HEAD 归档版本，approve）+ 工作树未提交的 SA9 final-verification 更新版（approve，§A delta 核验与本席独立 diff 结论一致） | 已读 |
| 简报 `wiki/raw/task_issue-254.md`（AC1–AC6；Comments 节为空） | 已复读 |
| SA6 契约 `wiki/raw/task_issue-254_sa6_contract.md`（红 10/10 固化；§15-4：生产修复前不得以 skip/only/改断言转绿） | 已复读 |
| HEAD delta：`git diff ee40095..09348e7`（name-status/stat/全代码路径空 diff） | 实证 |
| HEAD 源码抽查锚点：`peer-namespace.ts` L1509-1533（onTimerFired 尾部 intent 门分派）、`peer-connection.ts` L110（facet 装配）/ L66 对侧声明、`types.ts` L301（reason 词表） | 逐行核验 |
| HEAD 规范抽查锚点：protocol §16 `namespace-recovery` 词条（L445-447）、§23.1 reason 词表 7→8 append-only（L627）、ADR 0010 issue #254 修订节（L332-379） | 逐行核验 |
| HEAD 测试抽查：`ws-replication-issue254-ac-red.test.ts` / `ws-replication-issue254-timeout-recovery.test.ts` 存在性 + 无 skip/only/todo（grep 实证 `NO_SKIP_ONLY_TODO`） | 实证 |
| 上游判定链：SA8 gate/recheck 双 `clear`、SA2 approve 有条件（F1–F4 已落实）、SA3 报告绿、SA4 approve | 复核 verdict 行一致 |

## 3. 当前 HEAD delta 核验（09348e7 vs ee40095）

| 核验项 | 证据 | 结论 |
|---|---|---|
| diff 文件全集 | `git diff ee40095..09348e7 --name-status`：恰 `A` 两条（SA9/SA10 产物）；`--stat`：2 files，+199/−0 | ✅ 与 dispatch 声明逐字吻合，纯新增 |
| 代码/测试/协议/配置零变化 | `git diff ee40095 09348e7 -- packages/ domains/ apps/ docs/ tests/ scripts/ .github/ package.json pnpm-lock.yaml pnpm-workspace.yaml vitest.config.ts tsconfig.base.json` = 空（0 行）；`--name-only` 剔两产物后无剩余 | ✅ **无任何代码/测试/protocol/ADR/CONTEXT/CI 行为变化** |
| 行为不变性推论 | 两产物位于 `wiki/raw/**`，非任何构建/运行/测试/CI 输入 | ✅ 当前 HEAD 与已批准 fix HEAD 行为逐字节等价 |
| HEAD 哈希 | `git rev-parse HEAD` 与 dispatch 指定值逐字一致；分支 `mabf/issue-254` | ✅ |
| 工作树状态 | `git status --porcelain` 仅 ` M wiki/raw/task_issue-254_sa9_standards.md`（SA9 本轮 final-verification 自产物的未提交更新，不在 HEAD 内；本席不触碰、不代交） | 记录在案，不影响 HEAD 评审结论 |
| 产物内容准确性 | 归档版 SA9 L3 与归档版 SA10 L5 均标 Reviewed HEAD = `ee40095c…e14`，与所评 fix 提交逐字对应 | ✅ 无错标、无越证判定 |
| 判定链一致性 | 归档 SA9 approve / SA10 approve 与 SA8 双 `clear`、SA2 approve、SA4 approve、SA6 红 10/10 归档日志全链一致 | ✅ |

## 4. AC1–AC6 与 SA6 契约：当前 HEAD 继续满足的确认

因 §3 证明当前 HEAD 实质内容与 `ee40095` 逐字节等价，前轮 SA10 的逐条核验结论整体并入本节（不重述全文）；本席对每条 AC 的关键锚点在 HEAD 做了独立抽查复核：

| AC（简报原文） | 当前 HEAD 在位性抽查 | 判定 |
|---|---|---|
| AC1 周期 reconciliation 超时后无需人工重启即可恢复 | `peer-namespace.ts` L1524-1532：`finalize('failed')` 后 `intent==='active'` 门单点分派 `this.host.requestConnectionRecovery(...)`（全仓分派调用点恰此 1 处，前轮 grep 实证，本轮源码复读同）→ 连接层 `peer-connection.ts` L110 facet 装配在位 | ✅ 继续达成 |
| AC2 不再出现长期稳定的 `Peer failed + Hub needs-resync + connection ready/ESTABLISHED` | 超时点本端 close + backoff 重拨 + 对称 teardown 链路代码零 diff；hub 半区零改动 | ✅ 继续达成 |
| AC3 恢复路径遵守「同一连接内终态 namespace 不重开」 | `onTimerFired` 早退门（L1510）与终态语义零改动；复活仍唯一经由 终态 → disconnected → 新代 ready → targeted | ✅ 继续达成 |
| AC4 已接纳 apply 正常排空，session/lease 生命周期无泄漏 | 恢复复用 §16 既有断线纪律，清理路径零 diff、零新清理面 | ✅ 继续达成 |
| AC5 增加确定性超时与自动恢复回归测试 | 冻结契约 `ws-replication-issue254-ac-red.test.ts` 与恢复测试 `ws-replication-issue254-timeout-recovery.test.ts` 均存在且与 ee40095 零 diff；grep 实证无 skip/only/todo | ✅ 继续达成 |
| AC6 覆盖 Peer/Hub channel 状态、连接重建和最终数据收敛 | 契约 A1/A2 断言面（wires/dials≥2、新 wire 含 OPEN_NAMESPACE+SYNC_STEP1、hub 回 live、双向写收敛）所在文件零 diff | ✅ 继续达成 |

**SA6 契约满足性**：冻结契约文件自红期固化以来零改动（SA6 §15-4「只有修复实现才能转绿」纪律保持）；A1/A2 红转绿只能来自 `ee40095` 生产变更，且本轮 delta 不含任何生产/测试变更；N1–N3 守护断言语义保持。规范落点（protocol §16 词条 L445-447、§23.1 词表 L627、ADR 0010 issue #254 修订节 L332-379、`types.ts` L301）在 HEAD 全部在位。

## 5. 遗漏/部分实现/错误实现/scope creep 排查（当前 HEAD）

- **本轮 delta 自身**：纯评审证据归档，不可能引入实现缺口或 creep；提交信息 conventional、body 声明「evidence only, no code changes」并锚定所评 HEAD——合规。
- **实质内容**：与 `ee40095` 逐字节等价 ⇒ 前轮 SA10 §4/§5 结论原样成立：设计落实零缺项；Hub 半区零改动（DENY 合规）；触发面单点结构性排除存量误伤；D2 一般化属 SA8 显式移交的受控扩张（protocol §16/§18 + ADR 修订节已登记边界，场景 5 负控钉住界外）；2 个超 ALLOW 测试文件改动为已核查的可接受偏离；场景 3 注入形态偏离已申报。本轮无新增 finding。

## 6. 残留项与 MINOR 观察（均不阻断 approve；自前轮 SA10 §6 原样结转）

1. Hub 半区 wire 级双半区复现未覆盖（fake-wire 信封洞约束）；hub needs-resync 长期存在以 Peer 无法恢复为前提，该前提已由修复移除；时序交织形态留待延迟注入场景动态验证。
2. 绿灯验证证据为报告级（SA3/SA4），原始绿跑日志未归档；real-transport/real-process 已知抖动项按 SA6 §14 口径单独复跑。
3. SA2 F3 可选变体（UPDATE_TOO_LARGE config 族负控）未实施（原文标「可加」）。
4. 缺省参数 reconcile 环形无专项测试（SA4 N3 MINOR）。
5. 设计文件历史滞后（SA2 F1/F2/F5 未回填设计文件；normative 落点文本已正确）。
6. 生产 real-WebSocket 异步 close 面登记为集成/E2E 面动态验证项。
7. wire ERROR 帧驱动的 reconnect 族同构僵尸**显式未纳入**触发面，为已登记 follow-up（非本任务 AC 范围）。
8. （本轮新增观察）SA9 final-verification 更新版产物在工作树未提交；不影响 HEAD 内容与本轮结论，由后续归档环节处理。

## 7. PR 必须披露的未达成/边界声明清单（自前轮结转，逐字有效）

1. 触发面严格限于 **timer 族**（open/bootstrap/reconcile 超时，§13.2 `NAMESPACE_TIMEOUT` 本地映射）；wire ERROR 帧驱动的 `retryable=reconnect` failed 族保持「收口后等待」语义，为显式登记的 follow-up（非本 PR 达成项）。
2. Hub 半区 needs-resync 的 wire 级双半区复现未覆盖（harness 信封洞约束）；其长期存在以 Peer 无法恢复为前提，该前提已由本修复移除；时序交织形态留待延迟注入场景验证。
3. 绿灯验证证据为报告级（SA3/SA4），原始绿跑日志未归档；real-transport/real-process 已知抖动项按 SA6 §14 口径单独复跑。
4. F2 形态的**有意语义变化**：持续故障下从「静态僵尸」变为「有界重试环」（重拨率 ≤ 1/min(超时窗, backoff 界)），运营告警阈值须按 ADR 修订节第 5 条双环形分设。
5. 可选负控变体（UPDATE_TOO_LARGE）与缺省参数 reconcile 环形断言未实施（MINOR，可随 follow-up 落）。

## 8. 边界声明

本报告为静态规格审查：未运行任何测试/服务/进程，未修改任何实现、设计、测试或规范文件，未调度其他 SA，未 commit/push/创建 PR；唯一写入产物为本文件（`wiki/raw/task_issue-254_sa10_spec.md`，替换前轮同名归档版）。动态验证路由由 Controller 决定。
