# SA6 诊断与验收契约报告 — issue #254：周期 reconciliation 超时 failed/needs-resync 僵尸必须自愈

> 阶段：acceptance-contract（红灯固化，iteration 0）。前置：SA8 冲突门禁 `clear`
> （`wiki/raw/task_issue-254_sa8_gate.md`），方向注记 = 重连触发恢复为兼容方向（方向 A）。
> Issue comments：派发前 REST 读取为空——无 Owner 反馈适用。
> 结论：红灯契约测试已固化并亲跑验证——生产修复前 **10/10 次运行均按预期红
> （A1/A2 恰 2 failed，失败断言全部且仅为本契约的恢复/不变量断言），负控 N1–N3 恒绿**。
> 红灯失败日志中的状态轨迹即为僵尸的运行时证据（见 §5）。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `packages/ws-replication/test/ws-replication-issue254-ac-red.test.ts` | 红灯验收契约测试（新文件，5 场景：A1/A2 红灯 + N1–N3 绿负控/守护） |
| `wiki/raw/task_issue-254_ac_red.log` | 单次 verbose 红灯运行原始日志（2 failed [A1/A2] + 3 passed [N1–N3]，Type Errors: no errors） |
| `wiki/raw/task_issue-254_ac_red_stability.log` | 10 连跑稳定性原始日志（RED as-expected 10/10，unexpected 0） |
| `wiki/raw/task_issue-254_sa6_contract.md` | 本报告 |

## 2. Task type and inputs

- **类型：Bug**（确定性回归红灯契约；不设计最终修复）。
- 输入：任务简报 `wiki/raw/task_issue-254.md`（issue #254，open）；SA8 门禁报告
  `wiki/raw/task_issue-254_sa8_gate.md`（verdict `clear`，含 AC1–AC6 对照与协议条款核验）；
  仓库基线 HEAD `6a005a4`（branch `mabf/issue-254`，与 origin/main 一致）。
- 简报核心主张（SA8 已实证为真，本报告复证）：
  1. peer-namespace 非周期 timer（open/bootstrap/reconcile）到期统一
     `this.finalize('failed')`（`onTimerFired()` 尾部，`peer-namespace.ts` L1505-1522）；
  2. `failed` 是同一连接内的 namespace 终态，同连接禁重开（protocol §1 不变量 4 / §7.1）；
  3. `onConnectionReady()` 只在连接重建后复活 `failed` target（`peer-namespace.ts` L832-838；
     `peer-connection.ts` `openActiveTargets()` L685-697）；
  4. reconcile 超时不关闭/重建仍 ready 的连接 → `failed` 无自愈出口。
- 事故形态（简报）：Peer channel `failed` + Hub `needs-resync`（ack-timeout 后
  `RESYNC_REQUIRED`）+ connection `ready`/TCP ESTABLISHED → 双方永久互等。

## 3. Owner comment mapping

Issue comments REST 读取返回空。无 owner 反馈项。验收口径 = 简报 AC1–AC6 逐条
（§12 映射）。

## 4. SA8 constraints（本契约的落实）

| SA8 裁决/约束 | 本契约落实 |
|---|---|
| 零 wire 字节变更可交付（方向 A）；不得改 §1 不变量 4 / §9.4 / §13.2 / §15.1 / §16 语义 | 契约断言**不要求任何新帧/新错误码/新状态**；恢复断言 = 既有机制（断线 → §15.1 backoff 重拨 → §16 断线纪律 → re-OPEN/reconcile）的可观测执行 |
| AC3 逐字钉住「同一连接内终态 namespace 不重开」 | §12 契约 3：事件级 AC3 违例检查器（本报告 §12.2），A1/A2/N3 全场景执行 |
| D1 方向 A/B 二择 | 本契约按**方向 A 形态**固化（连接重建是断言目标，AC6「连接重建」逐字来自简报回归场景第 6 步）；§15 记录对纯方向 B 的影响 |
| D2 恢复规则一般化 vs reconcile 专项 | 红灯契约只钉 issue 点名的**周期 reconcile** 路径；open/bootstrap 同构死局以代码证据记入 §10（impact），不提前锁死 D2 裁决 |
| D4 勿混淆 channel 级 needs-resync 与 ReplicationSession sticky needs-resync | 全报告/测试只在 channel 域叙述 |
| AC4 已接纳 apply 排空 / session-lease 无泄漏 | §12 契约 5：恢复后双向业务写收敛 + 全程零 unhandled rejection；failed 路径的 cleanup（session.close + lease.release）源证据见 §8 |
| 测试形态 = fake duplex + 注入 timer（§22 conformance 面） | 全部场景用 `driver.boot`（真实 Registry/Runtime/Y.Doc + StubPersistence + 双 fake scheduler），零 real sleep |

## 5. Environment and baseline

- 运行环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7；`pnpm install --frozen-lockfile` 干净完成。
- HEAD：`6a005a4`（fix(#238): …）；工作树：branch `mabf/issue-254`，仅新增本 SA6 文件与 wiki 报告（未提交）。
- 基线：现有 `ws-replication-periodic-reconcile.test.ts` 5/5 绿（88ms）——其中「进行中的
  周期 round 不重叠」正是 issue 点名「只推进了少于 reconcile timeout 的时间」的盲区测试；
  复跑确认其断言（reconciling + 单 round）在超时前成立，但**不覆盖超时后**。

## 6. Positive reproduction（红灯场景，生产实现上稳定复现）

确定性场景（简报「确定性回归场景」逐字落地，`driver.boot` fake duplex + 注入 timer）：

1. Hub/Peer 首次同步完成，双方 `live`（peerReplica='same'）；
2. `reconcileIntervalMs=200`：触发周期 reconciliation；
3. 丢弃该 round 必需的 hub→peer `SYNC_APPLIED`（round 的「peer 本地 diff 已被 hub 接纳」
   确认帧；peer 侧 round 永不结算，hub 侧 round 已结算保持 live）；
4. 推进 `reconcileTimeoutMs − 1 = 499ms`：peer 保持 `reconciling`、零重拨、零重建（绿锚，
   同款负控见 N1）；
5. 推进越过 500ms：reconcile timer 到期 → `onTimerFired('reconcile')` 尾部
   `finalize('failed')`（`peer-namespace.ts` L1505-1522、L1259-1269）；
6. 此后 60s 虚拟时间零事件：连接不重建、hub 无新 round、双方永久停摆。

红跑观测（`..._ac_red.log` 逐字，A1）：

```text
peer ns=failed conn=ready wires=1 dials=1 rounds(2) hubLastChannel=live
peer channel trail: targeted→opening@hub-omega-conn-0 | opening→reconciling@hub-omega-conn-0
  | reconciling→live@hub-omega-conn-0 | live→reconciling@hub-omega-conn-0 | reconciling→failed@hub-omega-conn-0
hub channel trail: opening→reconciling@hub-omega-conn-0 | reconciling→live@hub-omega-conn-0
peer conn trail: stopped→disconnected | … | handshaking→ready
```

`reconciling→failed@hub-omega-conn-0` 即为事故的 Peer 半区；hub 通道保持 live（无新
round 发起——§9.4 round 恒由 Peer 发起），连接恒 ready（wires/dials 恒 1）。事故报告中的
「Hub 半区 needs-resync」成因与可复现性见 §10/§15（fake-wire 信封洞限制）。

## 7. Negative control（相近负控，恒绿）

| # | 负控 | 断言（全部运行时行为） | 结果 |
|---|---|---|---|
| N1 | 同一丢帧，但停在超时边界内（timeout−1ms） | round 保持进行中 `reconciling`、单 round、零重建/重拨；**对照现有测试盲区：推到超时前最后一毫秒仍必须绿**（修复不得提前动作） | 绿 |
| N2 | 健康周期 round（零丢帧） | round 完成回 `live`、cadence 再武装、`wires==1`/`dials==1`（修复不得给正常 round 引入重建 churn） | 绿 |
| N3 | 同款僵尸 + **手工触发断线**（closeHubSide 1006）= 修复将自动执行的同一动作 | 自动重拨 → 新连接 re-OPEN/reconcile → 双方 `live`；AC3 检查器对该合法重建**零违例**（无假阳性）；恢复后双向数据收敛 | 绿 |

N3 是**控制变量对照**：与红灯 A1 只差「连接重建是否被触发」一个变量——触发即恢复，
证明 A1 的红=「缺少重建触发」这一根因（§9），而非 harness/时序噪声。

## 8. Stability, scale and timing

- 稳定性：契约文件 10 连跑，**10/10 次恰好 `2 failed | 3 passed`，Type Errors: no errors，
  unexpected 0**（`..._ac_red_stability.log`）。全部时间虚拟（fake scheduler），零 real sleep，
  无 flake 面。
- 时序条件：reconcile timer 恰在 round 发起时刻 +500ms 到期（advanceBy 按到期序触发）；
  场景在 timeout−1ms 的边界断言保证「超时动作恰在边界触发」为契约前提。
- 规模：1 namespace / 1 peer；恢复窗口 60s 虚拟时间（合规修复的恢复路径远小于该窗口，
  红灯侧则是零事件）。

## 9. Root-cause chain（含因果实验）

| Step | 事实 | 证据 | Confidence |
|---|---|---|---|
| 1（症状） | 周期 round 卡在 `reconciling` 且越过超时后，Peer channel 永久 `failed`、连接恒 `ready`、无任何后续帧 | 红灯日志事件轨迹：`live→reconciling→failed@conn-0` 后 60s 零事件；wires/dials 恒 1 | 高（10/10 复现） |
| 2（直接故障点） | 非周期 timer 到期一律 `finalize('failed')`（`onTimerFired` 尾部，L1505-1522），且 `finalize` 只收口 namespace（L1259-1269：clearAllTimers + setState + cleanupResources） | `peer-namespace.ts` L1505-1522 / L1259-1269；事件 `reconciling→failed` | 高 |
| 3（触发条件） | round 在 reconcileTimeoutMs 内未结算（§9.1 双位结算缺 hub→peer `SYNC_APPLIED`） | 丢帧后 `reconciling` 保持至 timeout−1ms（绿锚）；跨 500ms 即 failed | 高 |
| 4（最深根因） | `failed` 在**同一连接**内是终态：无任何事件/路径使其迁移；唯一复活点 `openActiveTargets()`（failed → targeted → startOpen）只在**新连接 ready 后**执行（`peer-connection.ts` L685-697 = `onHelloAck` 路径），而 reconcile 超时**不触发连接关闭/重建** | `peer-namespace.ts` L832-838；`peer-connection.ts` L457/L685-697、L908-967；事件轨迹 60s 零连接迁移 | 高 |
| 5（放大/并发症） | Hub 侧：round 由 Peer 独占发起（§9.4）；hub 通道保持 live 直到自身出向 ACK 超时，`declareHubResync('ack-timeout')` → `needs-resync` + `RESYNC_REQUIRED`（`hub-namespace.ts` L775-800）→ 终态 Peer 静默忽略（`peer-namespace.ts` isInboundQuiet L1296-1300）→ 永久互等 | `hub-namespace.ts` L777-800；`peer-namespace.ts` L534-540（onResyncReceived quiet 门） | 高（源证据；hub 半区未在 fake wire 直接驱动，见 §15） |
| 6（排除项） | 「连接级活性/liveness 会收口连接」：peer liveness 只探测 ping/pong（fake wire 无 ping 面 → dormant），且与 namespace 状态无关 | `peer-connection.ts` L416-456；makeWire 无 ping/onPong | 高（已排除） |
| 7（排除项） | 「全部 namespace 终态会触发连接级动作」：namespace finalize 不通知连接层；无「全终态→关连接」路径 | 事件轨迹 60s 连接保持 ready | 高（已排除） |

**因果实验（最小控制变量）**：A1 场景在 `failed` 形成后**手工触发连接重建**
（N3：closeHubSide → §15.1 backoff 重拨 → 新连接 ready → failed→disconnected→
targeted→opening→reconciling→live@conn-1），其余完全不变 → 同一条断言链（最终双方
live、AC3 零违例、双向数据收敛）**全部转绿**。同一代码、同一场景、唯一变量=重建触发
⇒ 恢复机制（§15.1/§16/§21）本身完好，缺口**仅**为「超时后无人触发重建」——即红灯
断言所钉的行为。

## 10. Impact surface

- 事故形态要求 Peer `failed` + Hub `needs-resync` + 连接 ready 的组合长期停摆；本契约红灯
  直接钉 Peer 半区（AC1/AC2 恢复必达）。Hub 半区（needs-resync + RESYNC_REQUIRED 后无人
  应答）在源层已核验（§9 step5），其长期存在以 Peer 无法开新 round 为前提。
- **同类路径（证据支持的类比）**：`onTimerFired` 对 `open`/`bootstrap`/`reconcile` 三种 timer
  共用同一尾部 `finalize('failed')`（L1505-1522；SA8 实证核验同款），且连接就绪期
  `open`/`bootstrap` 超时同样不触发重建 → 结构性死局对三者同构（SA8 冲突点 #4 / D2）。
  本契约不提前锁死一般化裁决：红灯只覆盖 issue 点名的周期 reconcile；SA1 若选一般化，
  同款断言形态可直接扩到 open/bootstrap（超时后 horizon 内自愈）——报告记为设计输入。
- **AC4 生命周期面**：`finalize('failed')` 收口链含 `cleanupResources()`（L1268；
  claimForDisposal/runDisposal：session.close → lease.release，L1321-1371）——failed 本身不
  泄漏；契约以「恢复后双向写收敛 + 零 unhandled rejection」作功能级泄漏哨兵。

## 11. Ruled-out hypotheses

1. **Hub 侧 needs-resync 是独立死因**：否。Hub 从不发起 round（§9.4），hub 半区是 Peer
   半区无法恢复的投影；红灯在 hub 无任何异常动作（channel 保持 live）时依然成立。
2. **事件循环/写序饥饿是必要诱因**：否（简报「非结论」同款）。虚拟时间下无饥饿，纯
   控制帧丢失即可触达同一死局——死局与诱因正交。
3. **超时会经 liveness/watchdog/连接级路径自愈**：排除（§9 step6/7）。
4. **丢帧信封洞是生产等价路径**：排除。fake wire 丢帧在发送方向留下信封序列洞，洞后
   再发帧 → 接收端 `SEQUENCE_VIOLATION` connection-fatal（探针实证：hub 写 → peer
   `connection-failed{SEQUENCE_VIOLATION,1002}` → blocked）。真实 TCP 无单帧洞语义，属
   harness 注入的合成形态——因此全部红灯场景在超时后保持发送方零出站（见 §15），红灯
   断言不受该合成路径污染。

## 12. Acceptance contract and test paths

### 12.1 场景断言（契约=可观察行为；零源码字符串断言）

1. **A1/A2（红）**：周期 round（首轮/后续轮）丢弃必需 `SYNC_APPLIED` 并越过
   `reconcileTimeoutMs` 后，系统必须在窗口内**无需任何外部干预**自愈：Peer namespace
   回到 `live`；连接被重建（`wires≥2`/`dials≥2`，新 wire 含 `OPEN_NAMESPACE` + `SYNC_STEP1`
   = 重新 OPEN/reconcile）；hub 侧回 `live`（AC1/AC2/AC6）。随后双向业务写收敛
   （AC4 功能锚）且零 unhandled rejection。
2. **N1（绿）**：同丢帧在超时前 = 合法慢 round：保持 reconciling/不重叠/不重建/不重拨
   （修复不得提前触发——超时动作必须恰在边界；issue 点名现有测试盲区的补完）。
3. **N2（绿）**：健康 round 完成 + cadence 再武装 + 零 churn（修复不得误伤正常轮询）。
4. **N3（绿）**：僵尸 + 手工断线触发 = 恢复全链可观测 + AC3 检查器零误报（§7）。

### 12.2 AC3 违例检查器（事件级运行时不变量）

以单侧事件流内 `connection-state-changed` 至 `ready` 次数为连接代际尺：某 namespace
进入终态（failed/closed/conflicted）后，若**同一代际内**直接迁回活跃态
（targeted/opening/bootstrapping/reconciling/live/needs-resync）→ 违例。合法重建路径
（终态 → `disconnected`（连接死投影）→ 新代 ready → 复活）因中间必有一次 ready 代际
推进而不被标记（N3 实测零误报）。A1/A2/N3 全场景执行。

### 12.3 测试入口（真实触发路径）

`pnpm exec vitest run packages/ws-replication/test/ws-replication-issue254-ac-red.test.ts`
（root vitest config 自动发现；`boot` 驱动器组装真实 Registry/Runtime/Y.Doc + 双端 fake
transport + 双 fake scheduler，observer seam 经生产注入面 `observer` 选项）。无 skip/only/
todo/env override/超时软化/字符串断言。

## 13. Red/green evidence

- **红灯（修复前必须红，失败原因 = 本契约断言）**：A1/A2 在 `expect(recovered).toBe(true)`
  处红——失败消息自带僵尸全貌（§6）；红非 fixture/入口错误（同主体绿锚在超时前全部
  通过；N3 同场景变量单点翻转即全绿）。
- **绿负控/守护**：N1–N3 恒绿（含现有 suite 5/5 基线）。
- 断言敏感性：N3 证明同一断言链对「重建触发」变量敏感（A1 红 → 加触发 → 绿）；
  AC3 检查器在合法重建零误报，若修复在同连接内复活终态 namespace 将精确变红。

## 14. Runner trigger evidence

- 单次 verbose：`..._ac_red.log` —— `Tests 2 failed | 3 passed (5)`，`Type Errors: no errors`。
- 稳定性：`..._ac_red_stability.log` —— 10/10 `2 failed | 3 passed`，unexpected 0。
- 全量 ws-replication suite 复跑（`pnpm exec vitest run packages/ws-replication/test`）：
  首轮 `3 failed | 365 passed`（3 个失败 = A1/A2 红灯 + 1 个真实 TCP 测试 RT-G5
  `ws-replication-sa7-issue171-real-transport.test.ts` 的全量并行负载时序抖动——单独复跑
  4/4 通过；第二轮全量仅剩 `2 failed | 366 passed`，抖动未复现，与本契约零交叉污染）。
  本契约文件只新增、不改任何既有测试/生产代码。

## 15. Unknowns and blockers（移交设计/后续环节）

1. **修复方向（SA8 D1）**：本契约红灯场景用 wire 丢帧制造 round 卡死。fake wire 丢帧 =
   信封序列洞 → 洞后**同连接**任何新帧都会 SEQUENCE_VIOLATION——因此该场景的任何合规
   修复都必须**重置连接**（重建 → 序列归零）。纯方向 B（同连接继续新 round、不重建）
   在该注入形态下不可达（洞未消）；若 SA1 裁定纯方向 B，需把红灯场景改写成「延迟而非
   丢帧」的卡死注入（hub 侧 apply 门闩）并重述第 6 步断言（SA8 D3/D5 预登记）。本契约
   断言已按简报推荐形态（第 6 步 = 重建 + re-OPEN/reconcile）固化。
2. **hub 半区（needs-resync）的 wire 级直接复现**：因 §11-4 的信封洞限制，红灯场景不能在
   丢帧后另发 hub UPDATE；hub 半区以源证据核验（§9 step5）并作为 Peer 半区的并发形态
   记录。若需要 wire 级完整双半区复现，同样需要延迟注入改写（上条）。
3. **D2（一般化）**：open/bootstrap timeout 与 reconcile 同构死局（§10）——红灯只钉
   reconcile；一般化裁决属 SA1，落地时按同断言形态扩场景即可。
4. 生产修复前该测试文件保持**红**（A1/A2）；设计/实现轮次不得以 skip/only/todo/改断言
   方式让它变绿——只有修复实现才能转绿（N1–N3 必须持续绿）。

## 16. Temporary diagnostics cleanup

- 探针文件（scratch1–3：复现/信封洞/受控对照）已删除；`git status` 无残留。
- 生产实现与既有测试**零改动**；新增文件仅：契约测试
  `packages/ws-replication/test/ws-replication-issue254-ac-red.test.ts` + 2 份运行日志 +
  本报告（均未提交，worktree 待后续环节）。
- 未启动任何长驻服务；全部运行经 vitest 前台/后台 job 收口，job 均已结束。
