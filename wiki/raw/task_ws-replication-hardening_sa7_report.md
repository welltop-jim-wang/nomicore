# SA7 动态验证报告 — issue #161 ws-replication 协议加固（SA4 R2 pass 后）

**Date**: 2026-08-29
**Verdict**: **pass**
**验证对象**: `packages/ws-replication` @ commit `1eb2038`（实现 066d01f + 回流修复 3e7df32，工作区在其上仅新增 SA7 补充测试）
**输入**: 任务简报 / SA4 R2 审核报告（§六动态审核重点 1–5 + R2-6 O1）/ SA6 红灯契约 / SA5 全景分析
**SA7 产出**:
- 新增补充测试（唯一代码改动，零生产代码触碰）：
  `packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts`（7 例，D1–D6）
- 本报告：`wiki/raw/task_ws-replication-hardening_sa7_report.md`

---

## 〇、流程结论

```
[SA7 Step 0 结论]
SA4 verdict: pass（R2 复验段，2026-08-29，R1–R4 全闭合）
操作: 进 Step 1

[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN
操作: 进入 Step 2
```

**Step 1 基线**（独立进程，repo root，`./node_modules/.bin/vitest run packages/ws-replication`）：

```
 Test Files  14 passed (14)
      Tests  103 passed (103)
Type Errors  no errors
```

- 两 SA6 红灯文件均在内且全绿：`ws-replication-sa6-hardening-g1-g2-red.test.ts (5 tests)`、
  `ws-replication-sa6-hardening-g3-g4-red.test.ts (16 tests)`；21 锚 + 6 补充锚 + 82 既有全绿。
- `tsc -p packages/ws-replication/tsconfig.json` exit 0；`git diff --check origin/docs/phase-5-websocket-replication HEAD` 零输出。

---

## 一、SA4 §六 动态审核重点逐项验证

### 1. R1 修复后关联完整性（§六.1）——✅ PASS（三层证据）

**(a) 类级·真实接线形态**（D2 测试 + SA4 复现脚本独立复跑，真实 `OutboundQueue` 类）：

- `tsx /tmp/sa4-repro/repro2-realshape.ts`（dropData 后无帧窗口满 ns 挡游标 + 兄弟 ns 两笔交付 + 控制发送）：

  ```
  Y 交付后 wire: [{"seq":1,"label":"WIRE"},{"seq":1,"label":"DATA:UPDATE:5"}]
  sendControl(BOOTSTRAP_SNAPSHOT) 返回值 = 2
  本次调用 wire 增量 = [{"seq":2,"label":"WIRE"},{"seq":3,"label":"WIRE"},{"seq":3,"label":"DATA:UPDATE:5"}]
  未复现。（EXIT=0）
  ```

  快照帧自身 wire 序 = 2；同一 drain 内兄弟 ns 数据帧以 seq=3 随后派发；返回值 = **2**（控制帧自身序）✓。
- `tsx /tmp/sa4-repro/repro.ts`（三 ns 竞争简化形）：`sendControl 返回值 = 2`（控制帧自身序）✓ EXIT=0。
- **D2 补充锚**（新增入仓，永久回归面）：`ws-replication-sa7-hardening-dynamic.test.ts` D2 以同一交错
  构造断言：`ret === bootOwnSeq === 2` 且本次调用内确有数据帧（seq=3）随后派发（污染前提在场）——
  锁定「返回值=控制帧自身 wire 序」语义。

**(b) 全链路·多 ns 竞争**（D1，真实 hub/peer/Registry/Runtime/yjs + 慢 socket 栅门，4 ns 同连接）：

构造序列：nsA ×2 写（8KiB×2）派发后滞留 socket 缓冲（in-flight 2/2 **窗口满未收口**，栅门持有 ACK 不回）
→ hub scheduler `advanceBy(300)` 越 ackTimeout → abandon + 记忆化 **RESYNC_REQUIRED×1**（nsA，控制帧）
→ 水位检查点（3ms 周期）暂停 → nsB ×2 写 **handoff 滞留连接级队列**（暂停窗口零数据派发）
→ `peer.addTarget(nsD)` → OPEN/OPEN_OK/BOOTSTRAP_SNAPSHOT（控制帧，seq=M）派发
→ 释放栅门 → peer 全量处理并回 BOOTSTRAP_ACK → 恢复水位 → nsD sync round 收敛 → `peer.removeTarget(nsB)`。

实测断言（全绿）：

| 锚 | 断言 | 结果 |
|---|---|---|
| ★ G2.1 关联 | wire 上 BOOTSTRAP_SNAPSHOT 帧序 M === BOOTSTRAP_ACK.ackedSequence | ✓（恰 1 个 nsD 的 ACK） |
| ★ G2.2 关联 | CLOSE_NAMESPACE wire 序 K === CLOSE_OK.ackedSequence | ✓ |
| close 经 E1 | removeTarget promise 微任务预算内结算（closeTimeout 5000ms **从未推进**——只能经关联 CLOSE_OK） | ✓ |
| false-fatal | 双向零 `ACK_STATE_VIOLATION` ERROR 帧；hub socket 未关；连接保持 ready | ✓ |
| 收敛 | nsD 经 bootstrap→reconcile→live；nsB→closed | ✓ |

**(c) 修复面静态确认**：`frame-io.ts` `drain()` 返回 `lastControlSeq`（三个早退点均带值），
`sendControl` 透传——控制/数据双平面分离后数据帧派发序不再污染关联基准。

### 2. N3 公平性——检查点 timer 兜底（§六.2）——✅ PASS（D3，类级 + 真实 scheduler）

构造：`canDispatchData(W)=false` 长期占位（窗口满未收口），Y 亦窗口满两帧滞留；随后 Y 窗口开放
（模拟 ACK 到达）且**无新 enqueue**——滞留帧唯一推进来源是检查点 timer（checkpointIntervalMs=100）：

```
enqueue W（占位注册）→ enqueue Y×2（Y 窗口满滞留）→ emissions=0
blocked.delete(Y) → advanceBy(100) → emissions=[Y1]   ← 检查点 #1 派发
                  → advanceBy(100) → emissions=[Y1,Y2] ← 检查点 #2 派发（每轮每 ns 至多一帧）
W 全程零派发、Y 零饿死；再排队一帧亦一个周期内派发
```

真实 `createRegistryTestScheduler` 推进（零 real sleep）：**有界延迟 = 每帧一个检查点周期（100ms），
无分钟级饿死**——SA4 N3 的「timer 兜底推进」论断动态成立。

### 3. N4 liveness 运行时行为（§六.3）——✅ PASS（D4 ×2，facet transport 注入）

| 面 | 构造 | 实测 |
|---|---|---|
| pong 超时收口 | pingInterval=1000/pongTimeout=500；ready 后 advanceBy(1000)→ping#1，无 pong 再 advanceBy(500) | pingCount=1 → 连接 `backoff`（onTemporaryFailure，§18「pong timeout 关闭连接」）✓ |
| pong 复清计时 | 每个 ping 后 firePong；advanceBy(1000)×3 + 499+1 | pingCount 递增、连接保持 `ready`（计时器被 pong 清零，不误杀）✓ |
| 重拨重武装 | backoff（delay=99ms）→ advanceBy(100) → 重拨（dialCount 2）→ 新 facet transport | 握手后活性重新武装（wire2 ping 计数生效）✓ |
| stop 清 timer | `peer.stop()` 后 advanceBy(10_000) | wire2 pingCount 停在 stop 时值——**零 timer 残留** ✓ |
| 缺面 dormant | transport 剥离 ping/onPong（stripFacets）；advanceBy(41_000) | 零 ping 调用、连接保持 `ready`——**零活性事件、零误收口** ✓ |

（附带发现：`random: ()=>0` 时 backoff 延迟 `max(0, random()*cap)=0` → 同一 advanceBy 窗口内零延迟重拨
立即可见——测试构造需 0.99 规避，非缺陷。）

### 4. R4：GOAWAY SHUTTING_DOWN → blocked 后 wire 零后续 UPDATE（§六.4）——✅ PASS（D5，全链路）

构造（peer 侧栅门 + bufferedAmount 观测面）：ns live → 栅住上行 → peer 写（n+blob 两笔 → 2 个
UPDATE）派发滞留 socket 缓冲（in-flight 2/3 未收口）→ 检查点暂停 → 再写两笔 handoff **滞留连接级队列**
→ 注入 `GOAWAY{SERVER_SHUTTING_DOWN}`（hub 静默期，序列 = 下一期望）：

| 断言 | 实测 |
|---|---|
| 连接 → `blocked`；**socket 保持开放**（peerEnd.closed=false，G1/G2 锚语义） | ✓ |
| blocked 后 `advanceBy(1000)`（多个检查点周期）：UPDATE 派发数恒为 2——**滞留连接队列帧经 dispose 后不再派发** | ✓ |
| blocked 后新业务写 + 再推进：仍恒为 2（disconnected 投影 + 出站队列已 dispose） | ✓ |
| ns 投影 `disconnected`；blocked 后零 ERROR 等噪声帧 | ✓ |

### 5. CI 触发证据（§六.5 / Hard Gate #14 动态面）——⚠️ 本地触发确认 + CI 观察阻塞（详见 §三）

### 6. O1：E5 运行时锚（R2-6）——✅ PASS（D6 全链路 + SA4 脚本复跑）

- **D6**（真实 peer/hub 全链路）：drop hub 的 CLOSE_OK → `removeTarget`（不 await）→ ns 进 `closing`
  且 CLOSE_NAMESPACE×1 已发、closeP 挂起（settle 后仍 closing——E1 不可达、事件驱动语义验证）
  → closing 期注入迟到 `OPEN_OK` → `finalize('failed')`（终态）→ **closeP 在 3_000 微任务预算内结算**
  （closeTimeout 5000ms 从未推进、CLOSE_OK 从未送达 → 结算点只能是 E5 无条件 settleCloseMemo）
  → 终态 `failed`、CLOSE_NAMESPACE×1 无重复。
- `tsx /tmp/sa4-repro/e5-verify.mts` 独立复跑：`>>> E5 验证 PASS：closing drain 期终局 → closeMemo 有限结算`（EXIT=0）。

---

## 二、SA7 观察项（非阻断，记录在案）

1. **R1 预修复攻击面的可达性收紧（正面观察）**：SA4 R1 的「真实系统可达链」依赖
   「ns 的 dropData 落在 in-flight 窗口仍满且连接桶非空之时」。本轮源码推演 + 动态构造复核确认：
   现实现的 A7 窗口不变量（`update-channel.ts` deliver/flushQueued 双入口均以
   `inFlight + pendingData < maxInFlightUpdates` 门 handoff）使「桶非空 ⟹ inFlight ≤ max−1」恒成立，
   故 dropData/shed 清桶后该 ns 的 `canDispatchData` 必为 true——**「注册空桶 + 窗口满挡游标」状态
   在当前生产接线中不可经 update-channel 纪律到达**（drain 的 canDispatch 早退目前是防御面而非活路径）。
   该交错仍可在 `OutboundQueue` 类级直接构造（D2/SA4 脚本即证）——R1 修复因此属 defense-in-depth，
   且 SA4 R2 的嵌套 drain 推演（内层 RESYNC/ERROR 控制发送不污染外层返回值）与 D1 全链路结果一致。
   若未来接线绕过 channel 窗口纪律直连 `enqueueData`，D2 锚将持续守住该面。
2. **一次 writeHubBlob/writePeer 产生 2 个 UPDATE**（n 与 blob 两笔 mutateRoot 各一帧）——多 ns
   字节记账类测试的计数基元，记录备后续切片引用。
3. D1 中 nsA 的 RESYNC_REQUIRED 释放后触发 peer 侧恢复 round（SYNC_STEP1 等），全部收敛、零违例帧——
   AC4/G2.3 面在多 ns 竞争下再获一次全链路确认。

---

## 三、Spec 触发证据（Hard Gate #13 — 2026-06-09 立法）

**不适用（N/A）**：本任务设计/实现/测试面**零 `*.spec.ts` E2E 改动**——
`git diff --name-only origin/docs/phase-5-websocket-replication HEAD -- '*.spec.ts'` → **0 文件**；
全部 29 个 diff 文件为 `packages/ws-replication/{src,test,package.json}`（17）+ `wiki/raw`（12）。
SA1 设计（§10 ALLOW LIST）亦仅含 `*.test.ts` vitest 面。无 E2E spec 即无「spec-not-triggered」黑洞面。

---

## 四、vitest 触发证据（Hard Gate #14 — 2026-06-15 立法，verdict 升级段）

**触发条件命中**：本任务含新增/改动 `*.test.ts`（SA6 两红灯文件 + 测试⑦豁免调整 + **SA7 本轮新增
`ws-replication-sa7-hardening-dynamic.test.ts`**）。

### 本地实际运行输出（独立进程，repo root，与 CI 同 glob 同命令面）

命令：`./node_modules/.bin/vitest run packages/ws-replication`（CI 的 `pnpm test` = 根
`vitest run --typecheck`，include glob `packages/*/test/**/*.test.ts` 与此一致）：

```
 ✓ packages/ws-replication/test/ws-replication-sa6-hardening-g1-g2-red.test.ts (5 tests) 64ms
 ✓ packages/ws-replication/test/ws-replication-sa6-hardening-g3-g4-red.test.ts (16 tests) 382ms
 ✓ packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts (7 tests) 115ms
 …（其余 12 文件全绿）

 Test Files  15 passed (15)
      Tests  110 passed (110)
Type Errors  no errors
```

| Workspace Package | 触发面 | 触发结果 | 证据摘录 |
|---|---|---|---|
| `@nomicore/ws-replication`（packages/ws-replication，v0.1.1） | 根 vitest include `packages/*/test/**/*.test.ts` | ✓ **Test Files 15 passed (15) / Tests 110 passed (110)** | 上行；两 SA6 红灯文件 + SA7 新文件均在 runner 列表且全绿 |
| `@nomicore/ws-replication` typecheck 面 | CI `pnpm typecheck` → `tsc -p packages/ws-replication/tsconfig.json` | ✓ exit 0（含本轮新增测试文件） | `TSC_EXIT=0` |

**本地 verdict**: ✅ all-vitest-packages-triggered（含 Hard Gate #14 关注的两新红灯文件与 SA7 新锚）。

### CI run 观察（§六.5 动态确认）——环境阻塞，交总控

- `git ls-remote --heads origin`：**远端无 `fix/issue-161-on-docs-phase-5-websocket-replication` 分支**
  （本地 `ahead 5` 未推送）；`gh pr view 161` → `Could not resolve to a PullRequest`（**PR 尚未创建**）；
  `gh run list` 最近 5 条均为其它分支/PR（issue #137/#152/#160 等）——**本分支零 CI run 存在，
  `gh run view --log` 无从摘录**。
- SA7 无 push/建 PR 权限与职责（边界明示）。**阻塞处置（交总控）**：分支推送 + PR 创建后，
  对 CI run 的 `Test: pnpm test` job log 复核 `ws-replication-sa6-hardening-*` 与
  `ws-replication-sa7-hardening-dynamic` 三文件执行行（静态门禁 SA4 Hard Gate #14 PASS 已确认
  glob 覆盖；本地同 glob 运行全绿——CI 意外跳过的先验概率极低，但动态确认须待 run 存在）。

**Hard Gate #14 动态结论**：本地实际运行证据齐备（上表）；CI 侧摘录列为**总控 push 后复核项**，
不构成本轮 verdict 降级事由（非「存在 CI run 但 package 未触发」，而是 run 尚不存在）。

---

## 五、命令与证据汇总

```bash
# Step 1 基线（独立进程，repo root）
./node_modules/.bin/vitest run packages/ws-replication
# → Test Files 14 passed (14) / Tests 103 passed (103) / Type Errors none（两 SA6 文件全绿）

# SA7 补充动态测试（新增文件）
./node_modules/.bin/vitest run packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts
# → Test Files 1 passed (1) / Tests 7 passed (7) / Type Errors none

# 终态全量（含新文件）
./node_modules/.bin/vitest run packages/ws-replication
# → Test Files 15 passed (15) / Tests 110 passed (110) / Type Errors none
./node_modules/.bin/tsc -p packages/ws-replication/tsconfig.json   # exit 0
git diff --check origin/docs/phase-5-websocket-replication HEAD    # 零输出

# R1/E5 类级独立复跑（SA4 脚本，真实类；/tmp/sa4-repro/）
tsx /tmp/sa4-repro/repro2-realshape.ts   # sendControl 返回 2 = 控制帧自身序（EXIT=0）
tsx /tmp/sa4-repro/repro.ts              # 同（EXIT=0）
tsx /tmp/sa4-repro/e5-verify.mts         # E5 终局 → closeMemo 有限结算 PASS（EXIT=0）

# 工作区终态
git status --short
# ?? .mabf-dispatch-ts（调度标记）
# ?? packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts（SA7 唯一代码产出）
```

测试纪律：全部零 real sleep（fake scheduler + 门闩 + 微任务驱动）；零源码 grep 断言；
`OutboundQueue` 为被测生产类（类级锚经相对路径导入）；真实 yjs/Registry/Runtime/双实例全链路。

---

## 六、Verdict

**pass**

- SA4 R2 verdict（pass）维持——SA7 未发现任何下调事由；
- SA4 §六 动态审核重点 1–4 + R2-6 O1 全部以活链路证据闭合（D1–D6 七例全绿，110/110 全量绿）；
- Hard Gate #13 不适用（零 `*.spec.ts`）；Hard Gate #14 本地触发证据齐备，CI run 摘录待总控
  push/建 PR 后复核（环境阻塞，非代码缺陷）；
- SA7 唯一代码产出为补充测试文件（CI 将自动纳入 runner），零生产代码改动，`git diff --check` 干净。
