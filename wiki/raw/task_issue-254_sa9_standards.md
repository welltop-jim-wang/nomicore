# SA9 标准评审报告 — issue #254：周期 reconciliation 超时 failed/needs-resync 僵尸的协议合规自愈

- **Reviewed HEAD（本轮）**: `09348e797403ed311d852db8d600749f1f41f4a4`（`docs(issue-254): record SA9 standards and SA10 spec review artifacts`；worktree 干净，`git status --porcelain` 空）
- **Fix HEAD（实质变更，已批准）**: `ee40095c0f3e61da7356fa19e130026725984e14`（`fix(ws-replication): recover peer after namespace timeout`）
- **Phase**: final-verification，iteration 1（dispatch sa-94d7dd7c-c3b7-42ef-8687-4a7ae96c8028）
- **Date**: 2026-09-08
- **Verdict**: **approve** —— 当前 HEAD 与已批准 fix HEAD 的唯一差异为补交既存 SA9/SA10 评审产物（2 个 `wiki/raw/` 文件，纯新增）；**代码、测试、protocol/ADR 规范文本、配置零变化，行为零变化**；delta 提交本身符合提交信息/产物命名/证据纪律；§C 并入的 ee40095 全量标准评审结论（approve，无 BLOCKER/MAJOR，4 条 MINOR 不阻断）对当前 HEAD 继续完全有效。
- **Owner feedback**: Issue comments REST 读取为空（本轮 dispatch 简报同证；前序简报/SA6/SA8/SA4 五方同证）——无 owner 反馈项适用。
- **评审方法**: 静态标准审查（SA9 不运行测试/服务、不修改任何实现/设计/测试文件）；结论以 `git diff`/`git show`、HEAD 源码、规范文本与已归档上游产物为证据。本轮唯一写入产物 = 本文件。

---

## A. 当前 HEAD delta 核验（09348e7 vs ee40095）

| 核验项 | 证据 | 结论 |
|---|---|---|
| diff 文件全集 | `git diff ee40095 09348e7 --name-status`：`A wiki/raw/task_issue-254_sa9_standards.md`、`A wiki/raw/task_issue-254_sa10_spec.md`；`--stat`：2 files，+199/−0 | ✅ 恰为 dispatch 声明的两个评审产物，纯新增 |
| 代码/测试/规范零变化 | `git diff ee40095 09348e7 -- packages/ domains/ apps/ docs/` 为空；`--name-only` 剔上两文件后无剩余（实证输出 `ONLY_SA9_ARTIFACTS` 口径成立） | ✅ **无任何代码/测试/protocol/ADR/CONTEXT 行为变化** |
| 行为不变性推论 | 两产物均非构建/运行/测试输入（`packages/*/test/**`、`tsconfig include`、CI workflow 均不引用 `wiki/raw/**`） | ✅ 协议行为、测试面、CI 门与 ee40095 逐字节等价 |
| 工作树状态 | `git status --porcelain` 空；HEAD 哈希与 dispatch 指定值逐字一致 | ✅ |
| 产物内容准确性 | SA9 产物 L3 标 Reviewed HEAD = `ee40095c…e14`；SA10 产物 L5 同款——与所评 fix 提交逐字对应，无错标 | ✅ |
| 产物判定与证据链一致性 | SA9 approve / SA10 approve 与 SA8 gate/recheck 双 `clear`、SA2 approve（F1–F4 已落实）、SA4 approve、SA6 红 10/10 归档日志（tail 复核：`2 failed \| 3 passed (5)` ×10，Type Errors: no errors）全链一致，无越证判定 | ✅ |

## B. delta 提交本身的标准合规

| 标准 | 核验 | 结论 |
|---|---|---|
| 提交信息惯例 | `docs(issue-254): record SA9 standards and SA10 spec review artifacts`，body 显式声明「evidence only, no code changes」并锚定所评 HEAD——conventional 格式与仓史 `docs(adr): …`/`docs(skill): …`/`docs: …` 同款纪律 | ✅ |
| 产物命名/落位纪律 | `wiki/raw/task_issue-254_sa9_standards.md` / `_sa10_spec.md` 符合 `wiki/raw/task_<slug>_*` 既有约定（与 #191/#238 等同目录先例一致） | ✅ |
| 模块边界 | 改动全集位于 `wiki/raw/`，不触及 `packages/ docs/ domains/ apps/` 任何模块 AGENTS 管辖面 | ✅ |
| 单一事实源 | 产物为评审证据的归档提交，不新增/不篡改任何 normative 文本；protocol/ADR/CONTEXT 在 delta 中零 diff | ✅ |

## C. 并入：fix HEAD `ee40095` 全量标准评审（前轮 SA9 产物，结论对当前 HEAD 继续有效）

> 以下为本任务前轮 SA9 对 `ee40095` 的全量评审原文（该轮产物已随 09348e7 归档入库）。因 §A 证明当前 HEAD 与 `ee40095` 行为逐字节等价，本节全部结论无需任何修订即适用于 `09348e7`。

- **Verdict**: **approve** —— 实现符合仓库 AGENTS/ADR/protocol 规范、模块责任边界、单一事实源、生命周期对称性、文件范围与测试质量标准；SA4 approve 及其证据链经独立复核成立；无 BLOCKER/MAJOR finding。4 条 MINOR 观察项登记于 §C.8，均不阻断。

### C.1 Reviewed inputs

| 输入 | 状态 |
|---|---|
| 任务简报 `wiki/raw/task_issue-254.md`（issue #254，AC1–AC6） | 已读 |
| SA6 红灯契约 `task_issue-254_sa6_contract.md` + `task_issue-254_ac_red.log` / `_stability.log`（红 10/10：`2 failed \| 3 passed` ×10，Type Errors: no errors） | 已读 + 日志 tail 复核（本轮再核同款结论） |
| SA1 设计 `task_issue-254_design.md`（iteration 0，方向 A） | 已读 |
| SA2 评审 `task_issue-254_sa2_review.md`（approve 有条件；F1/F2 P1、F3 P2、F4/F5 P3） | 已读 |
| SA8 门禁/复审 `task_issue-254_sa8_gate.md` / `_sa8_recheck.md`（clear / clear；R1/R2 advisory） | 已读 |
| SA3 实现报告 `task_issue-254_sa3_impl.md` | 已读 |
| SA4 实现评审 `task_issue-254_sa4_review.md`（approve，无必改项） | 已读 |
| 实际 diff：`git show ee40095` 全量（3 源文件 + 7 测试 + 2 规范文档 + wiki 产物；22 files，+2852/−53） | 全量逐行审查 |
| HEAD 源码复核：`peer-namespace.ts`（L58-66 facet、L96-120 装配、L1265-1273 finalize、L1509-1533 onTimerFired）、`peer-connection.ts`（L37-47 reason、L636-671 detach-close、L913-941 onTemporaryFailure、L976-1000 onNamespaceRecoveryRequested）、`types.ts` L296-301、`index.ts` 全文 | 按锚点复核 |
| 规范：root/`docs`/`packages/ws-replication` 三份 AGENTS.md、protocol §15.1/§16/§18/§23.1 现状、ADR 0010 修订节、ADR 0012 L36、CONTEXT.md、`vitest.config.ts`、root `package.json`、`.github/workflows/ci.yml`、测试 harness API（driver.ts/harness.ts） | 已读/已核 |

### C.2 标准逐项核对

#### C.2.1 仓库 AGENTS 与既有架构惯例

| 标准 | 核验 | 结论 |
|---|---|---|
| root AGENTS「Instance replication」：ADR 0010 = 架构、protocol = normative wire contract，先读最近模块 AGENTS | 全链产物（SA8→SA1→SA3→SA4）均以该两份为裁决基准；本席复核同口径 | ✅ |
| 提交信息惯例（conventional，`fix(ws-replication): …`） | 与 #231/#238/#252/#253 历史提交同款格式 | ✅ |
| worktree/产物纪律 | HEAD 干净无未提交残留；`.scratch-*`/`REPORT.md` 经 git log 核验属历史提交 4755e1c，与本变更无涉 | ✅ |

#### C.2.2 模块责任（packages/ws-replication/AGENTS.md）

| Boundary | 实现证据 | 结论 |
|---|---|---|
| 「terminal channels reopen only on a new connection」 | 复活唯一入口 `openActiveTargets` 零改动；恢复必经 终态→disconnected（连接死投影）→新代 ready→targeted；契约 + 新文件 AC3 检查器（代际尺）全场景零违例断言 | ✅ 保持 |
| 「Use injected transport, scheduler, randomness, observer/clock seams」 | 全部新/改测试 fake duplex + 双 fake scheduler + 注入 random；零 real sleep | ✅ |
| 「Export production APIs through src/index.ts」 | 新 facet `PeerNamespaceHost.requestConnectionRecovery` 与 `PeerBackoffReason` 均未从 `index.ts`/`testing.ts` 导出（全文 + grep 实证）；公共面仅 append-only 观测字面量 | ✅ 内部缝保持 |
| Hub/Peer 所有权（ADR 0012 L36：Peer 拥有 dial loop） | 恢复触发落 Peer 侧；Hub 半区零改动（DENY 核验：`hub-connection.ts`/`hub-namespace.ts` 不在 diff） | ✅ 无越权 |
| Verification 门（focused tests + package typecheck + root `pnpm typecheck`/`pnpm test`） | SA3 报告全绿（373 tests/54 files、双 typecheck、根 suite 2373）；SA4 静态核验口径自洽；绿灯原始日志未归档 → 见 §C.8 M1 | ✅（证据缺口属 MINOR） |

#### C.2.3 Protocol/ADR 要求

| 条款 | 核验 | 结论 |
|---|---|---|
| §13.2 `NAMESPACE_TIMEOUT → failed` 映射不变 | `onTimerFired` 尾部仍 `finalize('failed')`；三分支结构（periodic 早退/close→closed/尾部）保持；零错误码/零 wire 字节/零 `replication-protocol/**` 变更（diff 实证） | ✅ |
| §1 不变量 4 / §7.1（同连接终态不重开） | 分派点在 finalize **之后**，复活只经新代连接；同代终态→活跃迁移结构性不存在 | ✅ |
| §18 epoch-first 纪律 | 复用 `detachCloseTimedOutTransport` 单点（停 liveness→退订→epoch+1→close(1001)），与 pong/hello-timeout 调用点逐字同构；`onTemporaryFailure('namespace-recovery', true)` 防 epoch 重复递增 | ✅ |
| §15.1 状态机 | `ready→backoff` 为既有 temporary-close 边的新触发实例，§15.1 注记明文「不新增状态机边」；backoff full-jitter/attempts/resetAfterMs 零改动（defaults.ts 在 DENY） | ✅ |
| §16 登记文本谓词 | 已按 SA2 F2/SA8 R2 收窄至 timer 族（「open/bootstrap/reconcile timer 超时（§13.2 NAMESPACE_TIMEOUT，本地映射）」），并登记 wire ERROR 族为显式未实现 follow-up——与实现单点分派同域，未「invent implementation behavior」（docs/AGENTS.md 红线） | ✅ |
| §18 伴随句 / §15.1 注记 / §23.1 词表登记 | 四处（types.ts、`PeerBackoffReason`、§23.1、ADR 修订节第 4 条）`namespace-recovery` 齐备，append-only，标 issue #254，21 型不变；对齐 #238 先例纪律 | ✅ |
| ADR 0010 修订节（6 条） | 触发谓词与域界（L165 双向声明）、编排与不变量、close code/所有权、观测登记、双环形风暴界（SA2 F4）、协议文本修订清单——显式修订而非静默矛盾（docs/AGENTS.md） | ✅ |
| CONTEXT.md 术语纪律 | 零变更（`namespace-recovery` 为观测字面量非域术语；SA8 复审 N2 同款结论） | ✅ |

#### C.2.4 单一事实源

| Fact | Authoritative source | Derived/mirror | Drift 核验 |
|---|---|---|---|
| backoff reason 词表 | protocol §23.1（规范） | types.ts 内联合 + `PeerBackoffReason` + api.test-d 精确闭集 fixture | 四处一致；fixture `toEqualTypeOf` 精确匹配使漂移在 typecheck 即红 |
| 触发面边界 | `onTimerFired` 尾部单点（peer-namespace.ts L1531；全仓 grep 恰 1 调用点） | §16/§18/§15.1/ADR 谓词文本（timer 族） | 四处同域；错误帧/registry 拒绝路径结构性排除 |
| 连接代际 | `connectionEpochValue` | epoch 门/退订双保险（既有） | 未新增派生态 |

#### C.2.5 生命周期对称性

| Acquire | Release | 核验 |
|---|---|---|
| 新代 HELLO_ACK → `openActiveTargets`（registry.open → 新 Lease/session） | `onConnectionLost` → `cleanupResources`（session.close → lease.release，claim 幂等，ADR 0010 L90 顺序） | 恢复 = 一次受控断线，完全复用既有断线纪律；**零新增清理路径**；场景 2/3/4 多代环以零 unhandled rejection + 双向收敛为功能级哨兵 |

#### C.2.6 文件范围

| 面 | 核验 |
|---|---|
| ALLOW 9 行 | 全部逐项对应，预期改动与实际 diff 一致 ✅ |
| 超 ALLOW 2 项 | `api.test-d.ts`（单值联合追加）：types.ts 7→8 的机械牵连——缺它 package/root typecheck 必红（tsconfig `include: test/**/*.ts` + root vitest typecheck 实证该面为 CI 硬门），#231/#238 同 commit 同步先例成立；`issue170-r1-r4-red.test.ts`（6 行纯增量 `settleUntil(ns==='live')` 同步点）：设计 §13 风险 1 预授权口径内收敛，零断言增删改。SA4 独立核查结论（N6 可接受偏离）本席复核成立 ✅ |
| DENY LIST | 冻结契约 `ws-replication-issue254-ac-red.test.ts`（本 commit 首次入库即 SA6 冻结版，343 行逐行核验：无 skip/only/todo、断言与 SA6 §12 逐字对应、红灯日志归档）、hub-connection/hub-namespace、`replication-protocol/**`、registry/runtime/persistence 各包、`frame-io/backpressure/round-engine/update-channel/liveness/fence-watchdog/validate/defaults`、`ws-replication-periodic-reconcile.test.ts`、CONTEXT.md、上游 wiki 产物——diff 全集核验零越界 ✅ |

#### C.2.7 测试质量

| 维度 | 核验 |
|---|---|
| 确定性 | 全部 fake duplex + 注入 timer/random；零 real sleep；harness API（`boot`/`advanceMs`/`collectUnhandledRejections`/`settleUntil`/`makeHubNamespace` 等）逐一存在性核验 ✅ |
| 断言形态 | 全部为行为断言（事件轨迹/帧种类/计数/收敛值）；零源码字符串断言；失败消息携带僵尸全貌上下文 |
| 断言保持/增强 | 3 个改版存量场景原断言语义全部保留并增强（轮询僵尸态 → 事件轨迹 + 重建 + 收敛 + 零 rejection 哨兵）；契约文件零改动 |
| 负控/敏感性 | 场景 5 钉住界外零动作（SA2 F3）；场景 1/4 dialCount 上下界双向钉住「无动作」与「无界重拨」两类回归；契约 N1（边界前零动作）/N2（健康轮零 churn）/N3（单变量因果对照）齐备 |
| 卫生 | 7 个改动测试文件 grep 无 skip/only/todo/fixme；每场景 finally 清理 + unhandled-rejection 哨兵 dispose ✅ |
| Runner 入口 | root `vitest.config.ts` `packages/*/test/**/*.test.ts` 自动发现 + `typecheck.enabled` 覆盖 `.test-d.ts`；CI `pnpm typecheck` + `pnpm test` 与 SA3 报告门一致 ✅ |

#### C.2.8 SA4 批准与验收证据链

- SA4 verdict `approve`、无必改项；其依赖链（SA8 gate/recheck 双 `clear`、SA2 approve 有条件 F1–F4 已落实、SA6 红 10/10 归档、SA3 全量门报告）经本席对 HEAD 独立复核全部成立：SA8 复审重开条件（方向变更/映射或帧字节/触发面越界/close code 变更/Hub 或 replication-protocol 改动/CONTEXT 术语增改）**无一触发**。
- 红灯→绿灯因果链闭合：契约 A1/A2 的恢复断言只能由生产变更转绿（SA6 §15-4 纪律），冻结契约未动（§C.2.6）。
- AC 覆盖：AC1/AC2/AC6（契约 A1/A2 + 新文件场景 1/2/4）、AC3（双侧 AC3 检查器全场景）、AC4（零 rejection + 收敛哨兵 + 既有 cleanup 纪律复用）、AC5（确定性回归测试），与简报验收标准逐条映射成立。
- 未发现回归或未批准范围；reconnect recovery、终态 namespace 不变量、文档、测试四个点名面全部核验通过。

### C.7 Findings

无 BLOCKER / MAJOR。

### C.8 MINOR 观察项（不阻断）

| # | 观察 | 处置建议 |
|---|---|---|
| M1 | SA3 绿灯验证未归档原始日志（仅报告表格；SA6 红灯有归档）——SA4 N4/§11-1 已登记为后续动态验证项。静态层面无法独立复证绿跑，但验证门（package+root typecheck、root test）与 CI 配置一致，无标准违例 | 后续验证轮按 SA4 §11-1 复跑并归档 |
| M2 | 设计文件（iteration 0）未回填 SA2 F1/F2/F5 文字修订——normative 落点（protocol/ADR）已是正确文本，设计文件呈历史滞后态（SA4 N1 同款） | 后续设计归档轮由 SA1 回填（纯文字） |
| M3 | SA2 F3 的 config 族变体（UPDATE_TOO_LARGE 界外负控）未实施——原文「可加」可选项，核心 NOT_FOUND 负控已落地（SA4 N2 同款） | 可随 wire ERROR 族扩面 follow-up 一并落 |
| M4 | 缺省值 reconcile 环「attempts 每环清零」仅有 ADR 文档表述、无测试面（测试以 `resetAfterMs=4000` 非缺省钉单调环形；SA4 N3 同款） | 可选：加一例缺省参数环形断言 attempt 恒 1 |

## D. 评审边界声明

本报告为静态标准审查：未运行任何测试/服务/进程，未修改任何实现/设计/测试文件，未调度其他 SA，未 commit/push/创建 PR。本轮唯一写入产物为本文件（`wiki/raw/task_issue-254_sa9_standards.md` 的当前 HEAD 复审版）。Issue 需求完整实现度判定属 SA10 职责，不在本报告范围。
