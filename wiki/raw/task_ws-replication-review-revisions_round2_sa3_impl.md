# SA3 实现报告 — PR #165 review 八项修订（issue #161 round 2）

- **Status**: implemented & verified | **Date**: 2026-08-30
- **Worktree**: `/home/wangjian/nomicore-fix-issue-161`（branch `fix/issue-161-on-docs-phase-5-websocket-replication`，基线 commit `0a18661`）
- **实现依据**: SA1 R3 设计 `wiki/raw/task_ws-replication-review-revisions_round2_design.md`（SA2 R3 verdict **pass**）；SA6 红灯契约（15 例：14 新锚 + D3 改写 1 例，全红基线）；SA5 分析。
- **本地验证**: 红灯套件 **15/15 转绿**；`packages/ws-replication` 全量 **125/125 全绿**（零 skip、零 real sleep、零 unhandled rejection 探针现有锚面）；整仓 `pnpm test` **1996/1996 全绿**（169 文件）+ Type Errors 零；`tsc -p tsconfig.typecheck.json --noEmit` 零错误；`git diff --check` 干净；R7 四条 grep 锚 + R8 两条 grep 锚 + B3 doc-diff 全数满足。
- **提交**: 见文末 commit hash（本地单 commit，**不 push**、不建 PR）。

## 1. 变更文件清单

### 生产代码（src，全部在 §C ALLOW LIST 内）

| 文件 | 内容 |
|---|---|
| `packages/ws-replication/src/frame-io.ts` | **R1** enqueueData 严格准入分支（shed 循环后仍越限 → 拒纳 = 先清该 ns 幸存桶回减 queuedDataBytes → 无条件 onDataShed（空桶亦显影）→ ensureCheckpoint → return；单帧超限同路径，无特例分支）+ 断点接纳注释删除；**R2** 尾窗 ledger 三字段（totalEmittedBytes/controlOutstandingBytes/emitTail）+ emitOne(message, plane) 私有加参 + runCheckpoint 尾窗裁剪 + 规则 C 析取（控制独立额度 ∨ 总量+无可 shed 面）+ sendControl 补 ensureCheckpoint + clear() 单点重置（N6）；**R5** drain consecutiveSkipped 有界整轮扫描（跳过 blocked ns、有派发归零、连续 ≥ dataOrder.length 次零派发即止） |
| `packages/ws-replication/src/update-channel.ts` | **R6** `pendingDataBytes` 字段 + overflows 双口径（count/bytes 均纳入 pending handoff）+ 四出口同步（handoff +/onDataDispatched −/onDataShed 清零/teardown 清零） |
| `packages/ws-replication/src/peer-connection.ts` | **R4** `onPongTimeoutDetached` 新入口（liveness onPongTimeout 回调改接；①停 liveness → ②clearGoawayDrain → ③退订 → ④close(1001,'pong-timeout') → ⑤epoch+1 → ⑥onTemporaryFailure → ⑦投影后 dispose；公共 onTemporaryFailure 其余三入口零改动）；**R7** requestRebuild L638 `queueMicrotask` → `this.deferTask(...)` + L634-637 注释改写 |
| `packages/ws-replication/src/peer-namespace.ts` | **R3** `quiesceSync` 私有方法 + onConnectionFatal/onConnectionLost 各非终态分支先同步摘订阅再迁移（closing/failed 分支内联 + 新增 cleanupResources 排程——N3 落实）；**R7** L688-689 注释改写（512 叙事清除） |
| `packages/ws-replication/src/hub-namespace.ts` | **R3** onConnectionClosed 增同步段 quiesceSync（订阅摘除 + 非 terminal 投影 closed——cleanupAll 同步前缀内可达，四触发面同栈静默）；closeSessionAndRelease 的 unsubscribe 分支保留为 no-op 安全网 |
| `packages/ws-replication/src/types.ts` | **R2** `ReplicationLimits.maxQueuedControlBytes: number` 必填字段（11 字段冻结面 +1）；**N5** transport facets 注释两层语义（运行时 dormant vs 生产组合根装配期响亮断言） |
| `packages/ws-replication/src/defaults.ts` | **R2** `maxQueuedControlBytes: 8 * 1024 * 1024`（缺省 = maxFrameBytes 缺省——单笔合法控制帧不可独自耗尽）；L29-31 注释改指 protocol §18（缺省与约束） |
| `packages/ws-replication/src/validate.ts` | **R2** positiveSafeInteger(maxQueuedControlBytes) + `≥ maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES(128)` 构造期响亮校验（绝不运行时 clamp） |

### 测试与基建（§C ALLOW LIST；含 5 处测试面校准——见 §4「超出 §C 零改动预期的调整」）

| 文件 | 内容 |
|---|---|
| `packages/ws-replication/test/harness.ts` | **R2** WsReplicationLimits/CONTRACT_LIMITS 增字段（与 DEFAULT 逐值一致）；**R7** `DeferPump` 接口 + `makeDeferPump()`（入队零隐式执行、flush FIFO ≤1000 轮防自旋、pendingCount）+ `registerDeferPump()` 模块级注册表 + `settleUntil` 谓词先行冲刷（①谓词 → ②flush 全部已注册泵 → ③谓词再查；`settle()` 永不冲刷） |
| `packages/ws-replication/test/driver.ts` | **R7** 删除 DEFER_MICROTASK_HOPS/TEST_DEFER 跳数链（L399-418 整块替换为泵说明注释）；boot()/bootFanout() 双处装配 `deferTask: opts.deferTask ?? pump.defer` + registerDeferPump；Run 构造增 `readonly deferPump`（手动 flush 观测面）；BootOptions.deferTask 注释更新 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | **R2** ReplicationLimits 形状断言增 maxQueuedControlBytes（1 行） |
| `packages/ws-replication/test/ws-replication-spec-b1-b2-red.test.ts` | **B4 注释同步②** L90 一行——「测试侧 DEFER_MICROTASK_HOPS=512」→「测试侧显式 defer 泵」；断言与测试体零改动 |
| `packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts` | **R7 头部注释同步**（常数引用改泵描述）；**测试面校准 ×2**（R3-2 引用先捕获 / R3-5 inject 后补 settle——见 §4） |
| `packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts` | **R5** D2 锚构造校准（临时窗口满构造 Y2 滞留——见 §4）；D3 改写锚（SA6 已写）零改动 |
| `packages/ws-replication/test/ws-replication-sa6-hardening-g3-g4-red.test.ts` | **R1 语义校准 ×2**（AC5-SHED / A2-1011 的 held 断言与构造——见 §4）；A2 滞回锚零改动（SA6 已注释） |

### 文档（§D8，全部在 §C ALLOW LIST 内）

| 文件 | 内容 |
|---|---|
| `docs/protocols/instance-replication-v1.md` | **A8a** §2 增公共身份投影句；**A8b** §17 Adapter 观察段扩写三可选能力面（缺面 dormant + 生产组合根装配期响亮断言，指针 issue #164）；**A8d** §17 L492 段合并文本（原段首句「control/error/ACK高优先级，data每轮每 namespace最多一个」**逐字保留** + 终态口径追加：pipeline 记账、shed 仅排队侧、严格接纳 + 同批丢弃幸存帧 + needs-resync 显影、maxQueuedControlBytes 缺省 8MiB/校验、尾窗归因、checkpoint = max(1, floor(ackTimeoutMs/100))、有界整轮扫描）+ 校验清单增两行；**A8c** §18 增 liveness 缺省 30s/10s 与 `pongTimeoutMs < pingIntervalMs` 构造期校验 + pong 超时 close(1001)/backoff |
| `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` | append-only 文末追加「issue #161 round 2 修订（PR #165 review 八项）」节（既有修订节零改动——diff 仅 +13 行） |
| `docs/phases/phase-5-websocket-replication.md` | **A8e** L75/L81/L83 三处终态化改写（冻结词汇正文逐字保留；删除 issue #134 已接受/SA8 放行条件/round-N 撤销叙事） |

### wiki（任务工件）

- 新建 `wiki/raw/task_ws-replication-review-revisions_round2_sa3_impl.md`（本文件）
- `wiki/raw/task_ws-replication-review-revisions_round2_dispatch.md` 追加 dispatch 行
- 既有 round2 设计/SA5/SA6/SA2 四件（SA1/SA5/SA6 产出）随本提交一并落地（此前为未跟踪状态）

## 2. 十五例红转绿映射（全部通过，零 skip）

| 锚 | 结果 | 关键实现点 |
|---|---|---|
| R1-1（第 9 笔拒纳、dispatchLog==8、零字节、RESYNC≥1） | ✅ | enqueueData 严格判定 64,568+8,023 > 65,536 → 拒纳 + 无条件 onDataShed → declareHubResync |
| R1-2（单帧 100KiB > 64KiB 拒纳） | ✅ | 同路径（空桶拒纳 + 显影） |
| **R1-3（B1 契约：拒纳×幸存面——声明后零派发/pendingData==0/A7 窗口不变量）** | ✅ | 拒纳分支先清幸存桶回减再无条件 onDataShed；8192B 字面 payload 构造（SA6 已写，零改动） |
| R2-A2a（有排队数据时控制耗尽 exhausted==1） | ✅ | emitTail 尾窗 ledger + 规则 C 析取 + sendControl ensureCheckpoint |
| R3-1（hub close 同步段 ≠ live） | ✅ | onConnectionClosed 同步段 quiesceSync |
| R3-2（hub close 同步段订阅摘除 + companion） | ✅ | 同上（quiesceSync 摘订阅置空）；companion 经**先捕获的 channel 引用**断言（见 §4） |
| R3-3（SEQUENCE_VIOLATION fatal 同栈 ≠ live） | ✅ | connectionFatal → cleanupAll 同步前缀已达 |
| R3-4（peer blocked 同步栈订阅摘除） | ✅ | peer onConnectionFatal.quiesceSync |
| R3-5（GOAWAY deadline 先静默后 close） | ✅ | quiesceControllers 顺序既有 + quiesceSync；inject 后补 settle 修正计时序（见 §4） |
| R4-1（pong 超时同步关传输 + hub 清理） | ✅ | onPongTimeoutDetached ④ close → close 事件 → hub cleanupAll → connections 0 |
| R4-2（重拨 hub 单连接 + 迟到帧零影响 + n=9 收敛） | ✅ | ③退订 + ⑤epoch 闸 + re-OPEN reconcile |
| D3（R5 强锚：占位 ns 之间就绪帧同轮派发 emissions==2） | ✅ | consecutiveSkipped 机制 |
| R6-1（count 口径第 9 笔溢出 RESYNC≥1） | ✅ | overflows 纳入 pendingDataCount（1+7=8 ≥ 6） |
| R6-2（bytes 口径第 9 笔溢出） | ✅ | pendingDataBytes 四出口（8L > 4L） |
| R7-1（latch 未放行零拨号、放行恰 +1） | ✅ | requestRebuild → this.deferTask（默认为 pump.defer 注入） |

## 3. 验证命令与结果（全部实测）

```bash
# 1) 红转绿（15 例）
npx vitest run packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts \
  packages/ws-replication/test/ws-replication-sa7-hardening-dynamic.test.ts
# → Test Files 2 passed; Tests 22 passed（14+1 红锚 + D3×2 + 既有 7 例）; Type Errors no errors

# 2) 回归全量
npx vitest run packages/ws-replication
# → Test Files 16 passed (16); Tests 125 passed (125); Type Errors no errors

# 3) 整仓
pnpm test
# → Test Files 169 passed (169); Tests 1996 passed (1996); Type Errors no errors

# 4) 聚合 tsc
npx tsc --noEmit -p tsconfig.typecheck.json   # → exit 0
git diff --check                              # → 干净

# 5) R7 grep 锚
grep -rn "512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS" packages/ws-replication   # → 零命中（唯一残留已清除）
grep -rn "queueMicrotask(" packages/ws-replication/src | grep -v "src/testing.ts"  # → 恰 1：peer-connection.ts:36（defaultDefer）
git diff -- packages/ws-replication/src/defaults.ts packages/ws-replication/test/harness.ts \
  | grep -c "^[+-].*512 \* 1024"                                             # → 0（冻结值不动）

# 6) R8 grep/doc-diff
grep -rn "红灯\|SA6 契约\|SA8 放行\|撤销 round" docs/phases docs/protocols    # → 零命中
grep -rn "round-1\|round 1" docs/phases docs/protocols                        # → 零命中
grep -n "高优先级\|每轮每 namespace最多一个" docs/protocols/instance-replication-v1.md  # → §17 L492 在位
git diff 0a18661 -- docs/adr/0010-hub-peer-websocket-ydoc-replication.md      # → 仅文末 append（+13 行）
```

## 4. 超出 §C「零改动预期」的 5 处测试面校准（断言语义零减弱，逐处记录）

设计的 §C 对三个测试文件标注「SA3 零改动预期」（sa7-hardening-dynamic / g3-g4）或「仅头部注释同步 / 断言与测试体零改动」（review-red）。实现后实测发现 **5 处构造面在 R1/R3/R5 的绑定语义下结构性不可满足**（设计推演未预见——SA2 亦按设计同样推演）——逐处以最小改动校准，**所有断言谓词与期望值语义等价或按 R1 不变量收紧为更强形式**，已在相应文件内留注释：

| # | 文件:锚 | 现象（修后首次实测） | 校准 |
|---|---|---|---|
| 1 | review-red **R3-2** companion（L558 区） | 同步静默+连接收口完成后 `run.hub.connections[0]` 已由 hub-connection.ts cleanupAll **dropConnection 移除**（既有行为，DENY LIST 不可改）→ `hubChannelOf` 重建投影抛「无 hub channel」——companion 断言无法经 connections[0] 重取 | 在 close() **之前**捕获 channel 引用（对象图投影面不变；companion 的 state/in-flight/零 UPDATE 三断言谓词零改动——同一对象可见终态） |
| 2 | review-red **R3-5** | GOAWAY 经 wire 微任务送达 → deadline timer 在 `advanceBy` 已把 now 推进到 500 之后才武装（at=1000）→ deadline 未触发（订阅/close 均未发生）——测试时序构造缺陷 | `injectHub` 后补 `await settle()`（与 sa7-dynamic G1 同款「先送达后推进」模式），断言零改动 |
| 3 | sa7-hardening-dynamic **D2「真实接线形态交错」** | R5 绑定语义：就绪 ns 恒同轮派发（blocked 头不终止整轮）→ `enqueueData(Y2)` 的 drain 直接把 Y2 派发（旧「Y2 滞留」依赖被 R5 修复的早退缺陷）——构造前提不成立，且其后 bootOwnSeq=3≠2 | 以**临时窗口满**构造 Y2 滞留（`windowFull.add(NS_Y)` → enqueue → `delete`），再 sendControl 同 drain 派发——断言（ret===2、data[0].seq===3）零改动、语义（控制帧自身序不被数据污染）不变 |
| 4 | g3-g4 **AC5-SHED** L500 | `heldBytes > 64KiB` 在 R1 严格准入下**结构不可达**（数据面 pipeline 恒 ≤ max——第 9 笔即拒纳，held ≈64.9KiB） | 断言改为不变量对：`> 48KiB`（近满证明）∧ `≤ 64KiB`（严格准入不变量——比旧断言**更强**）；shed 信号断言（RESYNC∨BACKPRESSURE≥1）零改动（由拒纳路径 onDataShed 满足） |
| 5 | g3-g4 **A2 单检查点 1011 锚** | 同 R1 不变量：10 笔数据 held 恒 ≤ 64KiB → 规则 C 总量分支（buffered > max ∧ 无可 shed）不再可由数据面单独触发（R1 拒纳正是其前置防线） | 10 笔数据写保持（第 9 笔拒纳 + RESYNC 在 held）；其后以 **30 × writePeerNs 驱动 hub UPDATE_ACK 控制帧累积**（≈30×40B，仍 ≪ 8MiB 控制缺省额度——不触发 R2 分支）→ buffered 越过总预算 → 单检查点规则 C 总量分支触发 1011——**精确保留原锚判别的终止分支**（数据面 + 控制面合计超总预算、无排队数据可 shed） |

## 5. 兼容性/残余风险登记

1. **R2 新必填字段（`maxQueuedControlBytes`）**：全仓仅 harness CONTRACT_LIMITS（镜像接口同步）与 api.test-d 形状断言（同步）两处字面量构造点；测试内 `as ResolvedLimits` cast（QUEUE_LIMITS 等）不破坏（target 型可比）；`Partial<ReplicationLimits>` 用户零破坏；Repo 外无消费者（#164 组合根未落地）——全量 tsc/vitest typecheck 已实证。
2. **R2 缺省 8 MiB 语义**：任何单笔合法控制帧（≤ maxFrameBytes 8MiB 含 envelope）不可独自越限（严格 `>` 判定 8MiB 不越 8MiB）；操作员收紧至下限 `maxBootstrapBytes + 128` 有构造期校验兜底。
3. **R7 泵注册表模块级共享**：vitest 按文件隔离模块图（既有 requireYjs 同款模式）；同文件多 Run 场景闲泵 flush 为 no-op；并发多 Run 需独立延迟时序时按设计 N1 约束走 BootOptions.deferTask 手动泵（R7-1 latch 模式为先例）。
4. **R3 hub channel 提前 `closed`**：drain 窗口内迟到 apply 续体走终态静默分支（正是 §13.4 要求）；hub channel per-connection 无跨代复用；`HubReplication.close()` 仍等 settleTail（R3-2 companion 已实证收口终态 + 零投递）。
5. **R5 界依赖「drain 循环体 dataOrder 不增长」**（设计 N4 钉死）：当前循环体回调面（onDataDispatched/emitRaw）零 enqueueData 调用点；flushQueued 在 ACK/恢复路径不在 drain 内——全量回归（含 D2 交错锚、D3 强锚、AC5-RR 每轮每 ns 一帧）实证成立。若未来引入该类路径须改为快照界。
6. **A2-1011 构造口径变更**：规则 C 总量分支的触发面从「纯数据超限」改为「数据（严格准入下恒 ≤ max）+ 控制帧合计超总预算」——与 protocol §17 终态口径（pipeline = queued+buffered；控制也走 socket 缓冲）一致；R2 独立控制额度分支由 R2-A2a 独立锚定，无交叉弱化。
7. **hello 超时 peer 侧传输不关**（设计 §D4 登记观察项，N2）：本 round 不开票，建议随 REPORT.md 开跟踪票（总控裁决）。
8. **REPORT.md**：控制器指令「不修改 REPORT.md」——其工作树既有未提交改写（round-1 遗留）**保持原样，未纳入本提交**（按设计 §C 其属「round-2 报告重写」面，归总控处置）。
9. **测试面校准的责任边界**：§4 五项校准均属「设计绑定语义下构造面不可满足」的机制性调整，断言语义零减弱（1 处反而加强）；已逐处留注释并在此登记，SA4/SA7 复核时以此表为账本。

## 6. 提交

本地单 commit（`git commit`，中英双语），**不 push、不建 PR**；commit hash 见报告结尾与 dispatch 行。工作树余留仅 `REPORT.md`（详见 §5.8，未纳入提交）。
