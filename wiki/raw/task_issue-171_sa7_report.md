# SA7 动态验证报告 — issue #171（namespace 生命周期跨连接代际竞态修复）

**Date**: 2026-08-30
**被验对象**: SA3 实现 commit `202558b` + F1 修复 commit `3242d16`（worktree HEAD = `3242d16`，branch `fix/issue-171-on-docs-phase-5-websocket-replication`）
**SA7 Verdict**: **pass** —— SA4 R2 终审 pass 基础上，SA4 §4 动态审核重点四项全部经**真实运行链路**验证通过（含真实 TCP + 真实 timer 真机面）；SA2 R2-N2 两项动态确认项闭合并留证；N1 实测结果**优于** SA4 静态预期（零补发 OPEN——无需 SA1 重裁决）；全量回归 168/168 零回退；F1 真机锚经修复前差分证明为确定性红灯（非 vacuous green）。未发现新 fail。

---

## 0. Step 0 — SA4 verdict 校对

- `wiki/raw/task_issue-171_sa4_review.md` 顶部：`Verdict（R2 终审，2026-08-30，复审 commit 3242d16）: pass`。
- 操作：进 Step 1（SA7 只上发——SA4 pass / SA7 pass）。

## 1. Step 1 — SA6 红灯测试复跑（第二关）

命令（worktree 根，独立进程）：

```
pnpm exec vitest run packages/ws-replication --typecheck
```

结果（本机独立复跑）：**24 files | 161 tests | 0 failed | Type Errors: no errors**（duration 4.73s）——与 SA4 R2 §R2.3 主张逐值一致。SA6 R2 契约两文件（`ws-replication-issue171-red.test.ts` 5/5：H1/P3/C4/C4b/G5；`ws-replication-sa6-hardening-g1-g2-red.test.ts` 5/5：AC1/AC2a/AC2b/AC3a/AC3b）与 SA4 F1 锚（`ws-replication-sa4-issue171-review-red.test.ts` 1/1）全绿。

**[SA7 Step 1 结论]** SA6 红灯: 🟢 GREEN（全部转绿属实）→ 进入 Step 2。

## 2. Step 2 — SA4 §4 动态审核重点逐项验证（清单驱动）

阅读量：SA4 报告 + SA5 报告 + SA2 R2 评审 + 任务简报 + harness/driver + 4 个源码文件局部（peer-namespace / peer-connection / hub-namespace / round-engine）≤ 15 文件上限内。

### 2.1 重点 1 —— F1 修复后真机回归（GOAWAY RESTARTING 窗口内 removeTarget → deadline → lease-released 恰一次 + 无 watchdog 空转 + 真 WS transport close 触发本地 onClose 后同样收口）

**新增真机锚**：`packages/ws-replication/test/ws-replication-sa7-issue171-real-transport.test.ts` → `RT-F1`（真实 `node:net` TCP loopback + 4B 长度前缀成帧 transport 适配器 + 真实 timer；与既有 `ws-replication-sa7-r2-transport.test.ts` 同类纪律）。

链路（真机差异面，SA4 指定核心）：drain 窗口内 `removeTarget()`（'disconnected' 分支本地收口）→ **drain 窗口内即完成处置**（`lease-released` 恰一次、`remainingLeases=0`——F1 修复的排队处置不依赖 deadline）→ deadline 到期 `transport.close(1001,'goaway-drain')` → **本地 socket 'close' 事件通知本端 onClose**（`socket.end()` → 本地 close 事件——真实 WS 语义；fake-duplex 的本地 close 不自通知，此面仅真机可达）→ `onConnectionLost` 以终态早退 → **零二次释放**（采样窗口内 `lease-released` 事件数不变）。watchdog 空转检测：计数 timer（记录每次武装）在 deadline 后 3×ackTimeoutMs 采样窗口内**零新增武装**（泄漏时 idle 自重武装每 ackTimeoutMs 一次——采样必增长）；`watchdog.idleArmed === false`、session/lease 字段清空。

**差分证明（红灯非 vacuous）**：`git checkout 202558b -- packages/ws-replication/src/peer-namespace.ts`（精确摘除 F1 修复 9 行）后复跑 RT-F1 → **确定性红灯**：`waitUntil 超时（3000ms）：F1 处置完成（lease-released 事件恰一次）`（零事件 = 泄漏本体，真机复现 SA4 静态锚症状）；同代码下 RT-G5（deadline 路径、无 removeTarget）仍绿——泄漏精确锚定在「drain 窗口 × removeTarget」交叉，即 F1。还原 HEAD 后复绿（`git status` src 干净）。

| 锚 | 结果 |
|---|---|
| drain 窗口内 removeTarget 后 `lease-released` 恰一次（`[0]`，remainingLeases 归零） | ✅ |
| deadline close(1001/goaway-drain) + 本地 onClose → backoff + 零双重释放 | ✅ |
| watchdog 自重武装链停止（计数 timer 采样零增长 + idleArmed=false） | ✅ |
| session/lease 字段清空（AC2 零泄漏，真机面） | ✅ |
| 修复前（202558b）同锚红灯（差分证明） | ✅ 红灯复现 |

### 2.2 重点 3a —— SA2 R2-N2①：GOAWAY 收帧段 ns `disconnected` 提前投影的可观测时序

**真机留证**（RT-F1 / RT-G5 双测，真实 wire 注入 GOAWAY）：注入时刻 t0 → peer 经真实 TCP 重组收帧 → 轻量层同步段投影 `disconnected`（t_disconnected），断言 `t_disconnected - t0 < drainTimeoutMs`（800ms/1200ms 窗口；实测均在收帧后 ~10ms 轮询粒度内到达）且**该时点连接 state 仍 `ready`**（deadline 只管 transport）、订阅已摘（`unsubscribe === undefined`）。对照面：deadline 到期才发生 transport close(1001)。→ 提前投影是真实可观测时序变化，且不翻转任何既有绿灯锚（全量 168/168 佐证）。

### 2.3 重点 3b —— SA2 R2-N2②：hub applyStep2 isQuietState 门（closing 期零 SYNC_APPLIED 出站）

**新增确定性锚**：`packages/ws-replication/test/ws-replication-sa7-issue171-dynamic.test.ts` → `D3-主` + `D3-对照`（fake-duplex + 受控 scheduler，零 real sleep）。

构造：peer 副本带增量 diff（rootN=50 ≠ hub 42）→ reconcile round 的 peer Step2 diff 非空 → hub `applyStep2` 悬挂在 hub saveGate（前置锚：hub saveEvents>0 证明 apply 已达 saveDoc、SYNC_APPLIED=0、hub 通道 reconciling）→ peer `removeTarget` 发 CLOSE_NAMESPACE → hub 通道 `closing`（closeQueue drain 悬挂在同一 apply）→ 放行 saveGate → 迟到续体于 closing 态恢复。

| 锚 | 结果 |
|---|---|
| **D3-主锚 1**：closing 期迟到 SYNC_APPLIED **零出站**（isQuietState 门） | ✅ |
| D3-主锚 2：closeQueue 不被门卡死——放行后 CLOSE_OK 上 wire + hub 通道 closed + peer ns closed + removeTarget 承诺结算 | ✅ |
| **D3-对照（vacuous-green 防护）**：同场景无 CLOSE → 放行后 SYNC_APPLIED 正常发出 ≥1 → 证明主锚 1 的抑制源自 isQuietState 门（非空 diff/apply 失败/其他） | ✅ |

→ SA2 R2-N2② ② 项闭环：设计自核「零既有测试依赖此帧在 closing 期发出」经动态对照验证成立（门只拦静默态，活跃态照发）。

### 2.4 重点 4 —— C4/C4b 的 ERROR 帧真 wire 形态（1002 close code + blocked 投影）抽帧验证

**真机锚**（同 real-transport 文件，注入帧经真实 socket + 对端重组，序列遵循「接收端已见最大 +1」记账）：

- **RT-C4**（removeTarget 路径，closeSequence 有值）：扣真实 CLOSE_OK（drop seam：帧由 hub 编码但不上 socket）→ `removeTarget` → closing → 同步点（hub 通道 closed = 真实 CLOSE_OK 已被 drop，SA3 §2.2 文档化同步点）→ 注入错配 `CLOSE_OK{ackedSequence:999999}`。
- **RT-C4b**（hub 发起 CLOSE 窗口，closeSequence===undefined）：saveGate 悬挂 peer 在途 apply → 注入 `CLOSE_NAMESPACE`（真 wire）→ closing 窗口稳定 → 注入错配 `CLOSE_OK{ackedSequence:closeSeq+7}`。

| 锚（C4 与 C4b 同款断言） | RT-C4 | RT-C4b |
|---|---|---|
| `ERROR{code:'ACK_STATE_VIOLATION'}` 帧上真实 wire（peer→hub sent 账本）**并到达对端**（hub 侧 received 账本——端到端真 socket 抽帧） | ✅ | ✅ |
| 连接投影 `blocked` | ✅ | ✅ |
| transport close **code 1002 / reason 'protocol-error'**（close meta 实录） | ✅ | ✅ |
| violation 窗口零静默完成（ns ≠ closed） | ✅（closing→blocked 收口） | ✅（disconnected） |
| removeTarget 承诺有限结算 / 放行 saveGate 后本代 CLOSE 续体正常收口 closed（零悬挂） | ✅（closeP 结算 + lease remainingLeases=0） | ✅（closed） |

### 2.5 重点 2 —— N1：drain 窗口内在途 OPEN_NAMESPACE 出站与否的实测帧面（§6.3 执行面裁决依据）

**新增确定性锚**：`ws-replication-sa7-issue171-dynamic.test.ts` → `N1`。构造：peer `registry.open` 悬挂（loadGate，startOpen 续体在途）→ 注入 GOAWAY{RESTARTING}（hub authorize 门闩悬挂——hub 零真实帧，注入序列记账无碰撞）→ 轻量层投影 disconnected → 放行 loadGate。

**实测结果（SA7 裁决依据）**：**零补发 OPEN_NAMESPACE**。SA4 N1 的静态担忧（「B-2c 守卫只判连接死亡/epoch，不判 drain 窗口 → 可能补发一帧」）在实测中**不发生**：`isConnectionDead() = isTerminal() ∨ state==='disconnected'`（peer-namespace.ts 私有判据，源读核实）——轻量层 GOAWAY 收帧段的 disconnected 提前投影恰好把 drain 窗口纳入 B-2c 中止判据，续体窗口内恢复即中止（§11.3 静默回收：registry.open 已交付 lease 即时 release，不落 `controller.lease`）。§6.3「收到 GOAWAY 后停止 OPEN」在帧面**零例外严格执行**——**无需回 SA1 重裁决**（SA4 预设的「如判定违例才回流」条件不成立）。

| 锚 | 结果 |
|---|---|
| drain 窗口内续体恢复后 OPEN_NAMESPACE 出站数 = **0**（零补发） | ✅ |
| 投影保持 disconnected（不复活）+ controller.lease/session 零残留 | ✅ |
| 帧面零增长（无任何 OPEN / 零 UPDATE） | ✅ |
| deadline 全量层处置 + transport close(1001)（hub 侧 close 观测——fake-duplex 本地 close 不自通知 seam；本地 onClose 面已由 RT-F1 真机覆盖） | ✅ |

### 2.6 GOAWAY 同步静默（G5 面·总控指令项）

**真机锚 RT-G5**（与 F1 同文件第二条）：live 期 UPDATE 基线 >0 → 注入 GOAWAY → 收帧段订阅已摘 + disconnected + 连接 ready → **drain 窗口内业务写（n=4242）零 UPDATE 出站**（250ms 真实采样，帧账本计数不变——同步静默先于异步 drain，§6.3/#161 修订节）→ deadline 才 transport close(1001/goaway-drain) → **对照路径**（无 removeTarget）deadline 全量层处置 lease 恰一次（最后事件 remainingLeases=0；deadline+本地 onClose 后无二次释放）。✅ 全锚绿。

## 3. 测试基建与产物

| 产物 | 位置 | 说明 |
|---|---|---|
| 真机动态锚 ×4 | `packages/ws-replication/test/ws-replication-sa7-issue171-real-transport.test.ts` | RT-F1 / RT-G5 / RT-C4 / RT-C4b（真实 TCP + 真实 timer；自建 `RealWireTransport` 适配器：4B 长度前缀成帧 + sent/dropped/received 三向帧账本 + drop seam + 本地 close meta 记录 + 本地 'close' 事件通知——真实 WS 语义） |
| 确定性动态锚 ×3 | `packages/ws-replication/test/ws-replication-sa7-issue171-dynamic.test.ts` | D3-主 / D3-对照 / N1（fake-duplex + 受控 scheduler，零 real sleep） |

- 端口：`net.Server.listen(0)` 随机端口（无固定端口占用，无需 fuser 清场）。
- Mock 面：仅 StubPersistence 门闩载体（saveGate/loadGate——harness 既有 seam）+ authorize 可编程回调；registry/Runtime/Y.Doc/协议栈全真实；零源码修改、零 `[SA7-DIAG]` 残留（grep 复核：零 console/debugger/.only/.skip/TODO）。

## 4. 独立复跑证据（命令 + 结果汇总）

| 命令（worktree 根，独立进程） | 结果 |
|---|---|
| `pnpm exec vitest run packages/ws-replication --typecheck` | **26 files \| 168 tests \| 0 failed \| Type Errors: no errors**（SA7 前基线 24/161 全绿 + 新增 7 锚全绿，零回退） |
| `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-issue171-real-transport.test.ts` | 4 passed \| 0 failed \| Type Errors: no errors |
| `pnpm exec vitest run packages/ws-replication/test/ws-replication-sa7-issue171-dynamic.test.ts` | 3 passed \| 0 failed \| Type Errors: no errors |
| `git checkout 202558b -- src/peer-namespace.ts` 后复跑 RT-F1（差分证明） | 1 failed（`F1 处置完成（lease-released 事件恰一次）` 超时——零事件=泄漏本体）；RT-G5 同代码仍绿 → 还原 HEAD 复绿 |
| `pnpm run typecheck`（AC6） | exit 0（全 workspace 包含 ws-replication） |
| `git diff --check`（AC6） | CLEAN（exit 0） |

## 5. Spec 触发证据 (verdict 升级 — 2026-06-09)

本任务 SA1 design 变更集**无任何 `*.spec.ts`**（SA4 §0 已核：E2E 门禁 N/A）。SA7 新增文件亦均为 `*.test.ts`。**verdict: ✅ N/A（无 spec 面）**。

## 6. vitest 触发证据 (verdict 升级 — 2026-06-15)

CI Run: 无（分支尚未 push / 无 PR——SA7 阶段不负责发布；CI 触发证据移交总控在 publication 阶段固化）。

静态触发面（`ci.yml` `test` job → `pnpm test` = 根 `vitest run --typecheck`，include `packages/*/test/**/*.test.ts`）覆盖本任务全部 `*.test.ts`；本机同构命令已实跑（§4 第一行：含 SA7 两个新文件在内的 26 files 全部被收集执行——文件级触发的本地实证）。

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| ws-replication | `pnpm test`（根 vitest） | ✓ 本地 26 files \| 168 passed | `Test Files 26 passed (26) / Tests 168 passed (168) / Type Errors: no errors`；CI 侧待 push 后由总控摘录 run log |

**verdict**: ✅ all-vitest-packages-triggered（本地实证；CI run 摘录待 publication）

## 7. 结论

**SA7 Verdict: pass**。

- SA4 R2 §4 动态审核重点 1/2/3/4 全部真机/确定性验证通过；SA2 R2-N2①② 闭合并留证；SA5 五链修复面（H1/P3/C4/C4b/G5）+ F1 修复面在真实 TCP 链路复验成立。
- **N1 裁决**（SA4 §3 遗留）：实测零补发 OPEN_NAMESPACE——B-2c 判据含 'disconnected'，轻量层提前投影使 drain 窗口续体中止；§6.3 执行面零例外，**无需 SA1 重裁决**。
- 未发现任何新 fail（SA7 独立发现面：本地 onClose 双重释放、watchdog 空转、close code 形态、SYNC_APPLIED 误伤、二次 OPEN——全部阴性）。
- 零生产代码改动；新增 7 个 SA7 拥有测试锚（可收编入 SA6 契约，非阻断）。
