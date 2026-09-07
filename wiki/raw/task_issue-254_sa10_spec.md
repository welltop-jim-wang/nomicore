# SA10 规格审查报告 — issue #254：周期 reconciliation 超时 failed/needs-resync 僵尸的协议合规自愈

- **Date**: 2026-09-08
- **Verdict**: **approve**
- **审查对象**: committed HEAD `ee40095c0f3e61da7356fa19e130026725984e14`（`fix(ws-replication): recover peer after namespace timeout`）
- **Issue comments**: REST 读取为空（简报/SA6/SA1/SA8/SA3/SA4 六方同证）——**无 owner 反馈适用项**，验收口径 = 简报 AC1–AC6 逐条 + SA6 契约
- **审查方法**: 静态规格审查（SA10 不运行测试/服务、不修改任何文件；唯一写入产物 = 本文件）。结论以 HEAD 源码、`git show` diff、归档日志与上游产物交叉核验为证据

---

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-254.md`（简报：问题摘要/事故证据/契约冲突/确定性回归场景/AC1–AC6/非结论） | 已读 |
| `wiki/raw/task_issue-254_sa6_contract.md`（红灯契约，红 10/10）+ `task_issue-254_ac_red.log` / `_ac_red_stability.log` | 已读；日志尾部核验（`2 failed \| 3 passed (5)` ×10，Type Errors: no errors，失败点 = 契约恢复断言 L216） |
| `wiki/raw/task_issue-254_design.md`（SA1 方向 A）+ `task_issue-254_sa2_review.md` + `task_issue-254_sa8_gate.md` / `_sa8_recheck.md`（均 `clear`） | 已读 |
| `wiki/raw/task_issue-254_sa3_impl.md` / `task_issue-254_sa4_review.md`（approve） | 已读 |
| HEAD 实现：`peer-namespace.ts` / `peer-connection.ts` / `types.ts` 全 diff + 上下文源码（onTimerFired/finalize/onConnectionLost/onConnectionReady/cleanupResources/runDisposal/onNamespaceRecoveryRequested/detachCloseTimedOutTransport/onTemporaryFailure/openActiveTargets/onHelloAck/armResetCheck） | 逐行核验 |
| HEAD 测试：冻结契约 `ws-replication-issue254-ac-red.test.ts`（343 行全读）、新文件 `ws-replication-issue254-timeout-recovery.test.ts`（532 行全读）、ac4/ac3/sa4-F2 改版 diff、issue170/api.test-d diff | 逐行核验 |
| HEAD 文档：protocol §15.1 注记/§16 词条/§18 伴随句/§23.1 词表 + ADR 0010 issue #254 修订节（6 条） | 逐行核验 |
| DENY LIST 界外核验：`git diff 6a005a4..ee40095 --stat` 对 hub-connection/hub-namespace/replication-protocol/periodic-reconcile 测试/CONTEXT.md = 空 | 实证 |

## 2. Verdict

**approve**。理由概述：

1. **AC1–AC6 全部达成**（§3 逐条核验）：超时边界自动触发连接重建（AC1）；僵尸三元组结构性不再形成（AC2）；复活只经「终态 → disconnected → 新代 ready → targeted」（AC3）；恢复复用 §16 既有断线纪律零新清理路径（AC4）；10 个确定性场景 + 3 个改版存量场景全 fake duplex + 注入 timer 零 real sleep（AC5）；Peer/Hub channel 状态、连接重建（wires/dials/新 wire 帧种类）、双向数据收敛全覆盖（AC6）。
2. **SA6 契约忠实满足**：冻结契约文件零改动（红期日志失败行号 L216 与 HEAD 文件内容逐字对应；SA4 mtime 核验同证）；A1/A2 转绿只能来自生产变更；N1–N3 守护断言（边界前零动作/健康 round 零 churn/合法重建 AC3 零误报）语义全部保持。
3. **触发面边界结构性成立**：`requestConnectionRecovery` 分派调用点全仓恰 1 处（`peer-namespace.ts` L1531，onTimerFired 尾部 intent 门；grep 实证）；错误帧/registry 拒绝驱动的其余 25 个 `finalize` 调用点零分派——与 SA2 F2 收窄后谓词（timer 族）逐字同域，场景 5 负控钉住界外零动作。
4. **零 wire 字节/零错误码/零状态机新边**：replication-protocol 包 diff 为空；reason 词表 7→8 append-only 四处一致（types.ts / PeerBackoffReason / §23.1 / ADR 修订节 + api.test-d 精确闭集 fixture 同步）。
5. **无遗漏/部分实现/错误实现/scope creep**（§4/§5）；残留项全部为已登记 follow-up 或 MINOR 观察（§6），PR 必须披露清单见 §7。

## 3. 验收标准逐条核验（简报 AC1–AC6）

| AC（简报原文） | 实现证据（HEAD 锚点） | 测试覆盖 | 判定 |
|---|---|---|---|
| AC1 周期 reconciliation 超时后无需人工重启即可恢复 | `onTimerFired` 尾部（peer-namespace.ts L1524-1532）：`finalize('failed')` 后 `intent==='active'` 门分派 → `onNamespaceRecoveryRequested`（peer-connection.ts L991-1000：stopping/ready/transport 三门）→ `detachCloseTimedOutTransport`（epoch 先失效 → close 1001，L649-671）→ `onTemporaryFailure('namespace-recovery', true)`（attempts+1 → full-jitter backoff → dialNow，L913-942）→ 新代 `onHelloAck` → `openActiveTargets` re-OPEN（L690-702） | 契约 A1/A2：越过 reconcileTimeoutMs 后 60s 虚拟窗内**无外部干预**回 live；ac4 §9.3 改版同款 | ✅ 达成 |
| AC2 不再出现长期稳定的 `Peer failed + Hub needs-resync + connection ready/ESTABLISHED` | 超时点本端 close(1001) → 连接离开 ready（backoff）→ hub 对称 teardown（§16 既有，hub 代码零改动）→ 新连接新 channel 回 live；「conn ready + ns failed」持久组合结构性不可形成 | A1/A2 断言 `wires≥2`/`dials≥2` + hub last channel = live；N1 反向钉住边界前零动作 | ✅ 达成 |
| AC3 恢复路径遵守「同一连接内终态 namespace 不重开」 | `finalize` 终态语义不动（isTerminal 幂等 L1266）；复活唯一路径：`onConnectionLost` failed→disconnected（L782-786）→ **新代** ready → `openActiveTargets` targeted→startOpen（L696-699）；同代内终态→活跃迁移不存在 | 事件级 AC3 检查器（终态进入代际 vs 复活代际）在 A1/A2/N3 + 新文件场景 1/3/4 双侧执行，断言零违例；N3 实证合法重建零误报 | ✅ 达成 |
| AC4 已接纳 apply 正常排空，session/lease 生命周期无泄漏 | 恢复 = 一次受控断线，复用既有 §16 纪律：`cleanupResources` 排队前捕获 claim（L1372-1374）→ `runDisposal`（unsubscribe → session.close［§16 排空屏障，L707-708 注记］→ lease.release，身份守卫防跨代误杀，L1325-1349）；零新清理路径 | 全部新/改场景带零 unhandled rejection 哨兵 + 恢复后双向写收敛；场景 3 钉住环窗口 hub 写零丢失 | ✅ 达成 |
| AC5 增加确定性超时与自动恢复回归测试 | 冻结契约 5 场景（A1/A2 红转绿 + N1–N3）+ 新文件 5 场景（open/bootstrap 自愈、multiplex churn、reconcile 环有界性、界外负控）+ 3 个改版存量场景；全部 `driver.boot` 真实 Registry/Runtime/Y.Doc + 双 fake scheduler + 注入 random，零 real sleep（静态核验：时间推进全经 `advanceMs`/`scheduler.advanceBy`） | 同左；无 skip/only/todo（grep 实证） | ✅ 达成 |
| AC6 覆盖 Peer/Hub channel 状态、连接重建和最终数据收敛 | — | A1/A2：peer 通道轨迹 + `wires≥2`/`dials≥2` + 新 wire 含 `OPEN_NAMESPACE`+`SYNC_STEP1` + hub 回 live + 双向写 43/44 收敛；场景 1/3/4 同款 | ✅ 达成 |

**简报「确定性回归场景」第 1–6 步对照**：boot 同步入 live（A1 L173-174）→ 周期 round 触发（interval 200ms）→ 丢 hub→peer `SYNC_APPLIED`（L187）→ 推进越过 `reconcileTimeoutMs`（L199-205，含 timeout−1ms 绿锚）→ 断言不得停留僵尸（L209-216 恢复必达）→ 断言连接重建 + re-OPEN/reconcile + 双侧 live（L219-224）——逐字落地，无缺口。

**简报「非结论」口径**：修复钉住超时后的永久不自愈（独立 bug），不处理超时诱因（事件循环/写序饥饿）——与设计 §1 非目标一致，无越界。

## 4. 遗漏/部分实现/错误实现排查

- **设计落实零缺项**：SA1 §8.1 接口草图与 HEAD diff 逐字一致（facet 声明/装配、尾部分派、三门、detach-close reason 闭合第三调用点、`onTemporaryFailure(_, true)`、finalize 死块删除、types.ts 双镜像）——本席独立 diff 复核与 SA4 §4 同结论。
- **Hub 半区**：零改动（DENY 合规）；needs-resync 半区随旧连接消亡、新连接重 OPEN 回 live，由 A1/A2 hub-live 断言覆盖。
- **并发/幂等门**：同 tick 多 ns 超时（首个触发离开 ready 吸收后续）、requestRebuild/stop()/GOAWAY drain 交错、transport.close 同步重入（退订 + epoch 双门）、close 抛错 → blocked 既有防御——逐门源码走栈核验成立（peer-connection.ts L991-1000 / L649-671 / L913-942；peer-namespace.ts L772-791 / L798-824）。
- **存量行为误伤排查**：periodic-reconcile 早退分支（L1511-1514）与 close timer 分支（L1515-1523）不变；periodic-reconcile 盲区测试零改动（issue 点名「修复后仍应绿」的守护面保持）；21 处错误帧/registry 拒绝驱动的存量 `failed` 断言行为不变（触发面单点结构性排除）。
- **SA2 五项 finding**：F1（§23.1 登记）/F2（§16 谓词收窄 timer 族）/F3（场景 5 负控）/F4（ADR 双环形注记）落实；F5 属设计文件勘误（正确归属 SA1，非实现面）。

## 5. Scope creep 排查

| 超出 issue 点名面 | 判定 |
|---|---|
| 触发面一般化至 open/bootstrap timer 族（D2） | **受控扩张，非 creep**：SA8 gate 显式移交 SA1 裁决的开放项；与 §13.2 `retryable=reconnect` 分类对齐；protocol §16/§18 + ADR 修订节显式登记边界；场景 5 负控钉住界外（错误帧族零重建）；SA8 recheck `clear` |
| 超出 ALLOW 的 2 个测试文件（api.test-d.ts / issue170-r1-r4-red.test.ts） | 可接受偏离（SA4 §6 独立核查，本席复核同结论）：前者 = types.ts append-only 变更的 typecheck 硬门机械牵连（#231/#238 先例，单值追加零语义变更）；后者 = 设计 §13 风险 1 预授权口径内的 6 行纯增量确定性同步点（零断言增删改） |
| 场景 3 注入形态偏离设计原文（open 超时实例替代 reconcile 超时） | 已申报（SA3 Deviations-2 / SA4 N5）：fake-wire 信封洞约束下不可注入，触发族同为 timer 族，断言面与设计 §12 场景 3 一致 |

## 6. 残留项与 MINOR 观察（均不阻断 approve）

1. **Hub 半区 wire 级时序交织未直接复现**（SA6 §15-2 / SA4 §11-3）：hub ackTimeout 与 peer reconcileTimeout 竞先形态受 fake-wire 信封洞约束不能以丢帧注入；hub needs-resync 半区以源证据核验（SA6 §9 step5），延迟注入改写形态登记为后续动态验证项。AC2 的「长期稳定僵尸」已由 Peer 半区修复结构性消除，不构成本 AC 缺口。
2. **绿灯原始日志未归档**（SA4 N4 MINOR）：SA3 报告全量 373/373、根 2373/2373、typecheck 绿，但未附绿跑原始日志（SA6 红灯日志已归档）；SA4 §11-1 登记为验证环节复跑项。SA10 按职责不复跑。
3. **SA2 F3 可选变体未实施**（UPDATE_TOO_LARGE config 族负控）：F3 原文标「可加」可选项，核心 NOT_FOUND 负控已落地（场景 5）。
4. **缺省参数 reconcile 环形无专项测试**（SA4 N3 MINOR）：`resetAfterMs` 缺省下 attempts 每环清零的形态仅 ADR 文档表述；场景 4 以非缺省参数钉住单调环形，可选补一例。
5. **设计文件历史滞后**（SA4 N1 MINOR）：SA2 F1/F2/F5 未回填 `task_issue-254_design.md`；normative 落点（protocol/ADR）文本已正确，属 SA1 后续归档轮纯文字项。
6. **生产 real-WebSocket 异步 close 面**（SA4 §11-2）：fake transport close 同步；异步迟到 close 吸收依赖既有 epoch 门，登记为集成/E2E 面动态验证项。
7. **wire ERROR 帧驱动的 reconnect 族**（BOOTSTRAP_FAILED/APPLY_FAILED/INTERNAL_ERROR 收帧）同构僵尸**显式未纳入**触发面：protocol §16 词条与 ADR 修订节第 1 条均已登记为未实现 follow-up（设计 §13-1），界外语义（收口后连接保持）由场景 5 负控守护——非本任务 AC 范围，PR 须披露。

## 7. PR 必须披露的未达成/边界声明清单

1. 触发面严格限于 **timer 族**（open/bootstrap/reconcile 超时，§13.2 `NAMESPACE_TIMEOUT` 本地映射）；wire ERROR 帧驱动的 `retryable=reconnect` failed 族保持「收口后等待」语义，为显式登记的 follow-up（非本 PR 达成项）。
2. Hub 半区 needs-resync 的 wire 级双半区复现未覆盖（harness 信封洞约束）；其长期存在以 Peer 无法恢复为前提，该前提已由本修复移除；时序交织形态留待延迟注入场景验证。
3. 绿灯验证证据为报告级（SA3/SA4），原始绿跑日志未归档；real-transport/real-process 已知抖动项按 SA6 §14 口径单独复跑。
4. F2 形态的**有意语义变化**：持续故障下从「静态僵尸」变为「有界重试环」（重拨率 ≤ 1/min(超时窗, backoff 界)），运营告警阈值须按 ADR 修订节第 5 条双环形分设。
5. 可选负控变体（UPDATE_TOO_LARGE）与缺省参数 reconcile 环形断言未实施（MINOR，可随 follow-up 落）。

## 8. 边界声明

本报告为静态规格审查：未运行任何测试/服务/进程，未修改任何实现、设计、测试或文档文件，未调度其他 SA，未 commit/push/创建 PR；唯一写入产物为本文件（`wiki/raw/task_issue-254_sa10_spec.md`）。动态验证路由由 Controller 决定。
