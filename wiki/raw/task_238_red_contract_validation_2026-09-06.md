# Red 契约验证记录 — Issue #238 可执行红灯验收契约（design 前门禁）

- 任务：Issue #238 — Hub→Peer UPDATE apply 延迟阶梯累积（最高 11 秒）
- 执行日期：2026-09-06（本 worktree 实跑）；Worktree `/home/wangjian/nomicore-fix-issue-238`（branch `mabf/issue-238`）
- 输入：Owner 评论 `IC_kwDOT8JVvs8AAAABS2CyWg`（2026-09-06T13:39:25Z）基线要求 + SA5 分析
  `wiki/raw/task_238_sa5_bug-analysis_2026-09-06.md` + ADR 门禁产出
  `wiki/raw/task_238_conflict_report.md` / `task_238_relevant_decisions.md`（verdict: clear，G1–G4 演进门）
- 职责：在 design 前验证（必要时强化）可执行红灯验收契约；未提交、未推送、未改任何生产代码
- Verdict：**red contract 已演示（green 基线 + 双向红灯控制 + 10× 稳定 + 机制敏感性）**；契约经强化

## 1. 被审契约文件（SA5 产出，本验证强化）

| 文件 | 性质 | 状态 |
|---|---|---|
| `packages/ws-replication/test/ws-replication-issue238-repro.test.ts` | 确定性复现 + 分段分解 + 关联断言（红灯契约本体） | 验证通过并**强化**（3 处，见 §4） |
| `packages/ws-replication/test/issue137-driver.ts` | 加性 seam：可选 `hubClock`/`peerClock` 条件透传生产 `clock` 选项（types.ts:132/180，缺省 dormant） | 验证通过，未改动 |

## 2. Owner 基线逐条核验（代码级 + 实跑）

| Owner 要求 | 契约落点 | 验证 |
|---|---|---|
| 慢 dirty notification 占住一个 Peer namespace write sequencer | `saveGate` 单次门闩挂起 u1 的 R6 saveDoc（harness.ts:430-444 单次门闩语义；ADR-0008 L97 注入纪律）；单 ns、单连接 | ✓ 实测：门闩释放前 `saveStamps.length===1`、`enteredAt===0`、`exitedAt===-1` |
| 阶梯 `applyLatencyMs = [5000,4000,3000,2000,1000]` | 逐位断言（含 ackLatency 对称阶梯） | ✓ 实测绿；红向翻转报实际阶梯（§3） |
| 五笔 applies / 五笔 ACKs | 5×update-applied、5×update-acked、5×UPDATE 帧、5×UPDATE_ACK 帧 | ✓ 计数 + 帧数双断言 |
| 连接恒 live / 无重连 / 无 namespace error | `wires.length===1`、state `'ready'`、ns `'live'`、双侧零 namespace-error / 零 resync-required；**强化后**：双侧零 connection-state-changed（整窗口事件面） | ✓ |
| 注入单调时钟 | 共享 `ManualMonotonicClock` → driver seam → 生产 `clock` 选项；采样点核验：peer-namespace.ts t0 在 `session.applyRemoteUpdate` 前 / t1 在结算续体（`observerOn` 才采样）、update-channel U2 `sentAt` per sequence | ✓ 事件仅差值、无绝对时间戳；生产缺省不注入 = 逐字节等价 |
| 零 real sleep | 全部微任务泵（`settle`/`settleUntil` Promise.resolve 泵 + flushDeferPumps）+ deferred 门闩 + fake scheduler；test/harness/driver 路径无 setTimeout/sleep（grep 核验） | ✓ |

## 3. 实跑证据（全部本机执行）

### 3.1 Green 基线
```text
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue238-repro.test.ts --reporter=verbose
→ Test Files 1 passed (1), Tests 1 passed (1), Type Errors no errors；测试主体 48–64 ms
```

### 3.2 红灯控制（临时翻转期望为平坦 [0×5]，测后即删，未留残渣）
```text
AssertionError: expected [ 5000, 4000, 3000, 2000, 1000 ] to deeply equal [ +0, +0, +0, +0, +0 ]
Test Files 1 failed (1) → EXIT=1
```

### 3.3 机制敏感性控制（临时移除 saveGate——慢 dirty 缺位）
```text
→ expected [ +0, +0, +0, +0, +0 ] to deeply equal [ 5000, 4000, 3000, 2000, 1000 ]
（机制缺失 → 阶梯消失 → 契约红灯，证明断言非空洞）EXIT=1
```

### 3.4 稳定性
```text
10× 逐轮显式 exit code：run 1..10 exit=0, FAILS=0（单轮 ~0.9 s，测试主体 34–56 ms）
```

### 3.5 回归与类型
```text
repro + issue230（相邻）→ 2 files / 3 tests passed
包全套件 → 49 files / 348 tests passed（含全部 import issue137-driver 的文件），Type Errors no errors
pnpm --filter @nomicore/ws-replication typecheck → exit 0
```

## 4. 强化（本验证新增，均在契约文件内、零生产代码触碰）

1. **头注观测覆盖矩阵与边界声明**：四段各自的观测状态（queue wait 非零实测 / dirty 非零实测 / protected
   check+live apply 独立计段但本构型恒 0——非零时长非门闩可注入 / event-loop stall 结构性排除——H1 探针为
   design 输入）；事件面不携带 sequence（生产缺口属后续 §23 append-only 设计/实现）；**门闩悬挂是确定性
   替身，不是真实执行成本测量；本复现不构成生产 11 秒占槽阶段的证明**（与 SA5 §11 一致）。
2. **零连接状态迁移断言**：双侧 observer 事件面在整个「五笔写 + 门闩持有 + 排空」窗口零
   `connection-state-changed`（与 `wires.length===1` 互补，把「无重连」落到事件面证据）。
3. **逐笔跨侧时间线对齐断言**：反推 admission = [0,1000,2000,3000,4000]——每笔 UPDATE 恰在其发送 tick
   被 peer 接纳（sent_i@i·1000 → admitted_i@i·1000 → applied@5000 → acked@5000，共享单调域逐笔配对）。

## 5. 四段观测 + 关联 ID 覆盖评估（Owner 要求对照）

| 要求 | 可执行状态 | 说明 |
|---|---|---|
| sequencer queue wait | ✓ 直接观测（u2–u5 = [4000,3000,2000,1000] 非零） | admission→slotStart 差值，守恒断言 |
| dirty notification | ✓ 直接观测（u1 = 5000 非零） | saveDoc 入/出戳；门闩持有即「登记未完成」 |
| protected check + live apply | ◐ 独立计段 + 守恒 | 小 update 恒 0；非零时长需真实执行成本或生产时源，本 harness 不可注入——已登记 |
| event-loop stall | ✗ 结构性不可观测 | fake duplex + 微任务泵 + 手动时钟排除同步阻塞；H1 判别只能走生产探针（design 输入，SA5 §7.2/§8.3） |
| sent/applied/acked 关联 | ✓ 帧级 wire sequence 逐位配对 + 逐笔时间线 | 事件面无 sequence 是生产缺口（§23 append-only）；合并帧/跨事件面关联属后续设计/实现测试域 |
| 生产 11 秒阶段证明 | ✗（明示不承诺） | 机制（FIFO + 注入门闩）复现 ≠ 生产占槽根因；本文件头注 + SA5 §7 双重登记 |

## 6. 边界与遗留

- 未提交、未推送（`git status` 仅 SA5 既有改动 + 本验证强化于同一 untracked 契约文件；scratch/负控文件已全部删除，test 目录仅存一个 238 契约文件）。
- 红灯原因核验：翻转/移除均为**契约断言语义失效**（期望值与实际机制不匹配），非测试装配错误；实现修复后该契约文件保持绿（门闩注入是测试替身，不随生产修复消失）——它是机制锚 + 观测方法验证，不是单一修复腿的红灯。
- 给 design 的输入：event-loop stall 判别探针、事件面 sequence 字段、分段差值字段（§23 append-only、G3 红线零 wire 字节）与槽级记账的**生产实现测试**须在实现期补——本契约已把需要区分的段与关联键钉在可执行断言与头注矩阵中。

Verdict: approve — red contract demonstrated（green 基线 1/1、双向红灯控制 EXIT=1、机制敏感性红、10× 稳定、全包 348 测试无回归、typecheck exit 0）
