# SA6 红灯契约 — PR #165 八项 review 修订（round 2）

**Status**: red-contract authored（14 新红灯锚 + 1 D3 改写红灯 + 驱动 seam 清理；R1-3 = SA1 §D1/SA2 B1 补充锚）| **Date**: 2026-08-30（R1-3 补写 2026-08-30）
**Worktree**: `/home/wangjian/nomicore-fix-issue-161`（branch `fix/issue-161-on-docs-phase-5-websocket-replication`，基线 commit `0a18661`）
**下游**: 修复实现归 SA3/SA1；本文件只锚定行为契约，**零生产代码改动、零提交**。

## 0. 产出文件（全部为测试 / 测试驱动 / wiki-raw）

| 文件 | 改动类型 | 内容 |
|---|---|---|
| `packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts` | 新增 | R1–R4 / R6 / R7 共 **14** 个确定性红灯锚（R5 见 D3 改写；R8 见本文档）；R1-3 为 SA1 §D1 / SA2 B1 契约补充锚（幸存面全弃 + 无条件显影 + pendingData 记账闭环 + A7 不变量） |
| `packages/ws-replication/test/driver.ts` | 修改（测试侧） | `TEST_DEFER` 512 跳魔法 → 显式命名常数 `DEFER_MICROTASK_HOPS = 512`（语义窗口成文）；`BootOptions.deferTask` 注入 seam（R7 latch 锚依赖） |
| `packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts` | 修改（测试侧） | D3 改写为 R5「有界整轮扫描」强锚（原「检查点兜底」锚与 R5 语义冲突，已替换） |
| `packages/ws-replication/test/ws-replication-sa6-hardening-g3-g4-red.test.ts` | 修改（测试侧） | A2 滞回锚注释更新（锚定字节级严格准入语义；计数界维持 ≤2——理由见 §仲裁） |
| `packages/ws-replication/test/ws-replication-spec-b1-b2-red.test.ts` | 修改（测试侧） | B-1 重建拨号等待 `settle()` → `settleUntil(...)`（R7 改为 seam 路由后时序窗放宽；语义不变：re-add 必须重建连接） |
| `wiki/raw/task_ws-replication-review-revisions_round2_sa6_red.md` | 新增 | 本文档（设计/结果/命令/R8 文档验收计划/仲裁记录） |
| `wiki/raw/task_ws-replication-review-revisions_round2_dispatch.md` | 追加行 | Dispatch row |

**未改动**: `packages/ws-replication/src/**`、`docs/**`、`packages/ws-replication/test/harness.ts`（测试基建零改动——driver 单点 seam 已够）。

## 1. 红灯命令与基线结果

```bash
# 目标红灯（新契约 + D3 改写）
npx vitest run packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts
npx vitest run packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts

# 回归面（既有锚必须保持绿）
npx vitest run packages/ws-replication/test/ws-replication-sa6-hardening-g3-g4-red.test.ts \
  packages/ws-replication/test/ws-replication-spec-b1-b2-red.test.ts
```

**基线（0a18661 实测）**：

- 新文件 `ws-replication-review-revisions-r1-r7-red.test.ts`：**14 个测试全部红灯**（14 failed）；失败断言即缺陷签名（实测摘录）：
  - R1-1 `第 9 笔（pipeline 超限）必须拒纳` — 期望 toHaveLength(8)，实际 9（断点接纳帧被派发）；
  - R1-2 超预算单帧 — 期望 wire 零该帧（0），实际 1；RESYNC 声明 — 期望 ≥1，实际 0；
  - R1-3（B1 契约）`拒纳必须产生 RESYNC 声明（桶非空亦显影——无条件）` — 期望 ≥1，实际 0（现实现断点接纳零声明）；R2-N1 构造精度前置（8L+512 > 64KiB，字面 8192B payload）通过——触发面已到，缺的是拒纳/显影；
  - R2-A2a `控制额度耗尽必须触发` — 期望 exhausted=1，实际 0（数据面仍有排队时规则 C 恒不触发）；
  - R3-1/R3-3 `close/fatal 同步段必须已静默 channel` — 实际 `live`；
  - R3-2 `close 同步段必须已摘除订阅` — 实际为 function（异步 closeSessionAndRelease）；companion（state=closed / in-flight=0 / 零 UPDATE）随后未达；
  - R3-4/R3-5 `blocked/deadline 同步栈内订阅必须已摘除` — 实际为 function；
  - R4-1 `pong 超时必须同步关闭传输` — 实际 false；`hub 必须清理死连接` — 实际 1（期望 0）；
  - R4-2 `hub 必须只见新连接` — 期望 1，实际 2（旧连接从未收口）；
  - R6-1/R6-2 `pending handoff 必须计入 count/bytes 口径` — 期望 RESYNC ≥1，实际 0（第 9 笔未溢出）；
  - R7-1 `latch 未放行前重建不得拨号` — 期望 1，实际 2（queueMicrotask 硬编码绕过 seam）。
- D3 改写（R5）：`占位 ns 之间的就绪帧同轮派发；追加排队帧无须等检查点` — **红灯**（追加帧被头部占位 ns 拖住：期望 emissions=2，实际 1）；同块「全阻塞有界」锚绿灯（有界性不误伤）。
- 回归面：g3-g4-red 16/16 绿、spec-b1-b2 5/5 绿、sa7-dynamic D1/D2/D4/D5/D6 7/7 绿（D3 改造前后各测）。
- 全量 `packages/ws-replication` 套件：见运行记录（§3）；除上述红灯外既有锚全部保持绿，零 real sleep、零 unhandled rejection。

## 2. 契约设计（R1–R7 → 测试 → 观测面）

### R1 — 严格字节接纳 + low-water（3 锚，全栈）
- **R1-1**（bootReview + GatedWire，`maxQueuedBytesPerConnection=64KiB`，**不推进任何检查点**）：
  gate 置停 + 9 笔 8KiB 连发 — 前 8 笔派发后 socket 缓冲 ≈64.8KiB（pipeline 主导），第 9 笔触发 shed 循环（queued 空 → 无 victim）——现实现按断点接纳并派发第 9 帧；修订必须拒纳 + `onDataShed`。
  断言（字节级）：dispatchLog UPDATE **== 8**；第 8 笔后 ΣUPDATE 字节 **== 0**；RESYNC_REQUIRED **≥ 1**。
- **R1-2**（A1b 单帧超限）：单笔 100KiB UPDATE > 64KiB 连接预算（空队列）——拒纳（wire 零该帧，杜绝 frame 级门只按 maxUpdateBytes 放行）+ 显影。
- **R1-3（B1 契约·SA2 §5 / SA1 §D1 / R2-N1 构造精度）**：拒纳 × **幸存面**——R1-1/R1-2 拒纳时队列皆空（SA2 B1：零覆盖），本锚覆盖「拒纳 ns 自有 ≤ lowWater 幸存排队帧」的 B1 缺陷面。构造（单 ns 变体——A 自任两角色，语义等价，设计授权）：`R13_LIMITS`（64KiB/1KiB/lowWater + highWater=4096 + maxInFlightUpdates=16）；字面 **8192B payload** ×7 突发（零检查点推进，held ≈57.8KiB）→ 一个检查点置 paused → 512B 帧（准入通过 ≈58.3KiB ≤ 64KiB；paused 保排队 = 幸存帧）→ 再投 8KiB 帧 → 触发面（queued ≈540 ≤ lowWater 1024 → shed 循环**不运行**）→ 严格判定 ≈66.5KiB > 64KiB → **拒纳 + 幸存面同批全弃 + 无条件 onDataShed(ns)**（三面不可拆，SA1 §D1）。
  断言：(①) RESYNC_REQUIRED ≥ 1（现实现 0 → 红灯——断点接纳零声明）；(a) 声明之后 wire 零该 ns UPDATE（首版设计不舍弃幸存面 → 恢复 drain 派发幸存帧 → 红灯）；(b) 释放 + 恢复排空后 `channel.pendingDataCount === 0`（首版 → 幸存帧派发时 onDataDispatched 再减一 → −1 → 红灯，负记账直接可观测——R6 记账闭环前提）；(c) 恢复 round 后 `inFlight.size + pendingDataCount ≤ maxInFlightUpdates(16)`（A7 窗口不变量回归面——负记账会放宽窗口）。
  R2-N1 精度注：**必须用 ≥8192B 字面 payload**（帧 ≈8,2xxB，8L+512 = 66,568 > 65,536，裕度 ~1KiB）；沿用 BLOB=8000（帧 ≈8,071B）→ 65,015 < 65,536 **不达限**，构造失败（假绿）。测试内含前置自检断言 `8L + 512 > 64KiB`（构造落地证明）。
- 低水位面：A2 锚保留 `≤2`（见 §4 仲裁——该场景严格准入后合法接纳 1 帧，计数 2 是**正确**终值；字节级拒纳判别由 R1-1/R1-2 承担）。

### R2 — 独立有界控制帧保留额度（1 锚，OutboundQueue 类级）
- **R2-A2a**：`highWater=16` 使检查点 #1 置暂停 → 第二数据帧排队（`largestQueuedNamespace() !== undefined`）→ 8KiB BOOTSTRAP_SNAPSHOT 控制帧 ×16 风暴（held ≈128KiB > 额度 32KiB 且 > 总预算 64KiB）→ 检查点 #2。断言：`onControlExhausted` 恰好 1 次（现实现：规则 C 要求 `largestQueuedNamespace() === undefined` → 恒 0 → 红灯）。
- **设计依赖（显式记录）**：测试以拟议新限制 `maxQueuedControlBytes: 32KiB`（经 cast 传入，当前类型面不存在）锚定「独立配额」契约。**若 SA1 裁决从总预算划分保留区（无新字段），本锚的额度来源字段需按裁决调整**——行为断言（有排队数据时控制耗尽必须触发 1011 接线）不变。

### R3 — 双侧同步静默（5 锚）
- **R3-1（hub close）**：`connections[0].close(1001)` 返回的**同步栈**内 channel state 离开 `live`（当前 `live` → 红灯）。
- **R3-2（hub 订阅）**：同上同步栈内 channel `unsubscribe === undefined`；companion：收口后 `writeHub` → state `closed`、in-flight 0、wire 零新增 UPDATE。
- **R3-3（hub fatal 触发面）**：注入错序帧（`nextPeerSeq()+2`）→ SEQUENCE_VIOLATION → fatal；**同栈采样**（零额外微任务跃层，`untilMicrotask` 包装会多跳一个微任务使异步链先推进——已内联循环）后 state 离开 `live`。
- **R3-4（peer GOAWAY SHUTTING_DOWN）**：blocked 投影同一微任务段内 `controller.unsubscribe === undefined`（当前：cleanupTail.then 异步链 → 仍注册）。
- **R3-5（peer GOAWAY SERVER_RESTARTING deadline）**：`advanceBy(500)` 触发栈内订阅已摘除；次序回归 `peerEnd.closed === true`（先静默后 close）。
- **幻影 in-flight 锚的重构说明（§4 仲裁）**：原设计「drain 窗口内 owned update 幻影登记」在真实运行时**不可构造**——hub 侧 drain 窗口的持有者恒为「hub 在途 apply」（peer UPDATE 的 apply 悬挂），此时 hub runtime 文档锁被占、fixture 写（owned update 的唯一生产面）阻塞（实测 5s 超时）。同步静默（state + unsubscribe）正是幻影的充要消灭条件——由 R3-1/R3-2 等价锚定；窗口语义记录于 SA5 分析不变。

### R4 — peer pong 超时收口（2 锚，liveness facet 全栈）
- **R4-1**：`pingInterval=1000/pongTimeout=500`，`advanceBy(1000+500)` → backoff 同栈断言 `wire1.peerSideClosed === true`（现实现 false → 红灯）+ close 事件传播后 `hub.connections.length === 0`（现实现 1 → 红灯）。backoff `random=0.99`（99ms）保证观察窗内不重拨。
- **R4-2**：重拨（+100ms）→ wire2 ready/live → `hub.connections.length === 1`（现实现 2 → 红灯）；旧 wire 迟到 RESYNC 帧零影响（ready/live 保持——代际回归面）；失联窗口内 hub 写 n=9 在重连 reconcile 后双侧收敛（无静默丢帧）。

### R5 — 有界整轮扫描（D3 改写，1 红灯 + 1 有界伴生）
- 用双占位 ns `[W, X]`（canDispatchData=false）+ 注册序末位就绪 ns `Y`：追加排队帧的 drain 自游标 1 起被 X 占位早退 → Y2 被迫等检查点（现实现：emissions=1 → 红灯；修订：单轮跳过占位 ns → =2）。「全阻塞有界」锚：单轮扫过即停、零派发、检查点推进亦零派发（伴生，当前即绿——有界性不被破坏）。

### R6 — UpdateChannel 溢出计入 pending handoff（2 锚，count/bytes 双口径）
- 构造：`maxInFlightUpdates=8`，gate 置停（检查点 → paused）→ #1 派发（in-flight 1）+ #2–#8 handoff（pendingData 7）→ #9 进队列路径。
- **R6-1（count）**：`maxQueuedUpdateCount=6` → 固定实现 `inFlight(1)+pending(7)+queued(0) ≥ 6` → #9 即溢出；现实现 1+0 < 6 → 入队（#14 才溢出）→ 断言 RESYNC ≥ 1（现实现 0 → 红灯）。
- **R6-2（bytes）**：两阶段——先测单笔 UPDATE wire 字节 L（同构内容 → 尺寸确定），再以 `maxQueuedUpdateBytes=4L` 起新 run：固定实现 8L > 4L → #9 溢出；现实现 2L ≤ 4L → 入队 → 断言 RESYNC ≥ 1（现实现 0 → 红灯）。

### R7 — 确定性重建 seam（1 锚 + 驱动清理）
- **R7-1**：`boot({ deferTask: latch })` → GOAWAY(SHUTTING_DOWN) → blocked → `addTarget`（config-change 重建）→ **latch 未放行前 `dialCount` 不变**（现实现 queueMicrotask 硬编码 → 2 → 红灯）→ 放行 → 恰好 +1 → ready/live。
- **驱动清理**：`TEST_DEFER` 512 字面魔法 → `DEFER_MICROTASK_HOPS = 512` 显式命名常数 + 语义窗口成文（settle 300 跳之后推进 / settleUntil 3000 预算内完成）；`BootOptions.deferTask` 覆盖 seam。生产注释中的「512 跳」叙事属 src 清理（SA3 职责，测试侧不再引用）。B-1 锚等待窗口同步放宽（settleUntil）——R7 修复后重建经 seam 路由仍绿。
- 既有 B-1「addTarget 后重建拨号」契约不变（仅等待窗口放宽）；AC4 系/AC6-3/D1 等依赖 TEST_DEFER 时序的锚**零改动**（均走 settleUntil/waitXxx，512→命名常数语义不变）。

## 3. 全量运行记录（基线实测）

- 目标红灯：新文件 `14 failed`；sa7-dynamic `1 failed | 7 passed`（D3 改写锚红，其余绿）。
- 回归：g3-g4-red `16 passed`；spec-b1-b2 `5 passed`。
- 全量 `packages/ws-replication`：`npx vitest run packages/ws-replication`（后台独立进程模式执行，见 /tmp/sa6-full.log）——结果以运行补记 §3.1。

### §3.1 全量结果（实测回填）

`npx vitest run packages/ws-replication`（后台独立进程，`setsid nohup bash -c ...`，零前台阻塞）：

```
Test Files  2 failed | 14 passed (16)
Tests       15 failed | 110 passed (125)
Type Errors  no errors
```

- 失败面 = **仅本 round 新增契约**：`ws-replication-review-revisions-r1-r7-red.test.ts` 14 例（R1×3 / R2×1 / R3×5 / R4×2 / R6×2 / R7×1）+ `ws-replication-sa7-hardening-dynamic.test.ts` D3 改写 1 例。
- 与基线 0a18661 差异清单：+15 红灯（预期，含 R1-3）；**其余 110 例全部保绿**——包括全部使用 driver 的 ac*/sa4/sa6/sa7/spec 套件（driver 常数改名 + deferTask 选项零行为变更）、A2 注释更新（g3-g4 16/16）、B-1 等待窗口放宽（spec-b1-b2 5/5）、D3「全阻塞有界」伴生锚。
- 零 unhandled rejection、零 real sleep（全部 fake scheduler / 微任务推进）。

## 4. 仲裁记录 / 与 SA5 分析的差异

| 项 | SA5 拟议 | SA6 裁决 | 依据 |
|---|---|---|---|
| A2 滞回锚 | 收紧 ≤2 → ≤1，删「断点接纳帧」 | **维持 ≤2**，注释更新 | 实测（探针）：严格准入（post-shed pipeline+incoming ≤ max 才接纳）下该场景第 9 帧**合法接纳**（16KiB ≤ 64KiB）→ 恢复后派发恒为 2（首帧缓冲 + 1 合法接纳帧）；≤1 将成永久红灯。字节级拒纳由 R1-1/R1-2 锚定 |
| R2 额度来源 | 新 limit 或划分保留区（SA1 定） | 测试锚定**行为结果** + 拟议字段（cast） | 字段名/来源随裁决调整断言参数；行为（有排队数据时控制耗尽 → 1011 接线）不变 |
| R3-2 幻影锚 | drain 窗口 owned update 零幻影 in-flight | 重构为**同步订阅摘除**锚 + 收口后零投递伴生 | 运行时锁序：hub drain 窗口 = 在途 apply 悬挂 → 占有 hub 文档锁 → 同 ns fixture 写（owned update 唯一生产面）阻塞 → 幻影场景在真实 harness 下不可构造（5s 超时验证）。同步 state+unsubscribe 是幻影的充要消灭条件 |
| R5 D3 | 改写为同轮派发强锚 | 同（已改写） | 追加排队帧为判别基（占位头阻塞 → 检查点兜底）——实测游标序下首帧同轮可达；第二帧被头部拖住即判别点 |
| R7 driver | 去 512 魔法（fake-scheduler/flush/步进） | 512 字面 → 显式命名常数 + 语义成文；latch 注入 seam | 语义窗口（settle 之后推进）被 AC4 系/AC6-3/D1 依赖（投影先可观测）——替换为 scheduler 调度会改变既有绿锚时序（零 advanceBy 即恢复的测试将挂死）；命名常数是最小确定性改动 |

**SA1/SA3 决策点**：R2 配额来源字段名；R4 收口入口拆分（pong 专属 vs onTemporaryFailure 公共）；R1 严格准入的「拒纳」在 `enqueueData` 内完成并经 `onDataShed` 走 A7 出口（与 R6 声明链一致）。

## 5. R8 — 权威文档验收计划（documentary checks；无文本断言）

R8 是文档任务（docs/protocol/adr/phase 四缺口 + 陈旧叙事）。**不落地脆弱的 docs grep/文本断言**（MEMORY 铁律：测试验行为不验文本形状；docs 内容由评审核对），本表为 SA1/SA3 验收清单与现有行为锚映射：

| 项 | 目标（出处） | 行为锚（已有/本 round） | 审核项 |
|---|---|---|---|
| A8a | 公共身份投影只取受信 Upgrade 身份；缺受信身份 accept = 响亮 TypeError | g1-g2-red AC1（INSTANCE_IDENTITY_MISMATCH wire 拒绝）；accept(transport, undefined) → 同步 TypeError（ac 套件语义回归面，建议 SA1 复核单测覆盖） | protocol §2/§6.1 增句 |
| A8b | transport facet 契约（bufferedAmount/ping/onPong 三可选面 + 缺面 dormant/视为 0 + 生产 adapter 必须暴露 + 装配期断言——#164 交叠） | sa7 D4-2（缺面 dormant）；D4-1（facet 武装）；g3-g4 highWater/bufferedAmount 面 | ADR 0010（或 protocol §17/§18）增契约段；与 #164 票面核对单一权威源 |
| A8c | liveness 缺省 30s/10s + `pongTimeout < pingInterval`（validate.ts:161-166 强制） | sa7 D4（运行时行为）；r3-r4-regressions 构造期校验面 | protocol §18 / ADR 补数值与约束 |
| A8d | 背压边界终态口径：pipeline = queued+buffered；shed 只作用 queued 侧；R1 严格接纳；R2 控制额度独立；checkpoint = max(1, floor(ack/100))；1011 终止 | 本 round R1-1/R1-2/R2-A2a + g3-g4 A2/A2-1011 + sa7 D2 | protocol §17 回写（依赖 R1/R2 裁决——先裁后排期） |
| A8e | phase-5 公共文档清理流水线回合叙事（round-N 撤销/SA8 放行条件类改写为终态规范句） | 无测试面（文档） | phase-5 doc 终态句；append-only ADR 修订节保留合法历史；成品级叙事归 REPORT.md（SA3 确认归属） |

**R8 红线纪律**：本 round 不写任何「读 docs 文本断言」；R8 验收 = SA1/SA2 对照 review 原文的评审核对（A8a–A8e 表）+ 既有行为锚保持绿。

## 6. 交接备注（SA1/SA3）

1. 红灯套件：14 + 1（D3）锚全部当前失败、缺陷签名可读；修绿后断言面不变（除 R2 若裁决改字段名——见 §4）。R1-3 首版缺陷签名：拒纳分支不清幸存桶 → (a)/(b) 双红；B1 修复后四断言（①/(a)/(b)/(c)）全绿。
2. 驱动 `DEFER_MICROTASK_HOPS` 与 `BootOptions.deferTask` 为**测试侧**改动——生产 `peer-connection.ts L638`（requestRebuild 的 queueMicrotask）与 `peer-namespace.ts L689` 注释（512 叙事）属 src 清理范围（SA3 实现 R7 时一并处理；测试侧已无「512」字面引用，仅命名常数）。
3. B-1 锚等待窗口放宽（settle → settleUntil）——R7 修复经 seam 路由后仍绿；其余 addTarget 重建锚（g1-g2/ac6/ac1/sa7-dynamic D1）已全部使用 waitConnection/waitNamespace（settleUntil 系），无需改动。
4. 零源码 grep 断言；零 real sleep；零 skip/伪红；fixture 全部真实 yjs/Registry/Runtime。
