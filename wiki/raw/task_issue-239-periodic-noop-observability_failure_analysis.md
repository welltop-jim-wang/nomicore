# 故障分析证据 — issue #239: periodic reconciliation 语义 no-op 不可观测

> 阶段：SA1 故障分析（可复现验证）。前置：SA8 冲突门禁 `clear`（`task_issue-239-periodic-noop-observability_conflict_report.md`）+ 全链约束清单（`..._relevant_decisions.md`）。
> 复现结论：**缺陷确认（reproduced，确定性 20/20）**。observer 事件 `sync-step2-sent` / `sync-diff-applied` 只携带编码后 update 的 `bytes`；已收敛副本的每个 periodic round 双方仍报非零 bytes，且事件不含 `syncRoundId` / `stateVectorChanged` / `applyEffect` 等语义效果字段——观察面无法区分「健康 periodic no-op round」与「真正 convergence defect 修复 round」。
>
> 本文档只做事实与证据，不做设计裁决；修复方向锚点仅供后续 SA 参考。

## 1. 缺陷定义（来自简报，逐字口径）

生产（2026-09-06 10:09–10:47，`ns-a14c373c98ddc2dbbc99f7ca244e82f8`）：live 后每 5 分钟一轮 periodic reconciliation，双方 `sync-step2-sent` / `sync-diff-applied` 稳定 1,272 B。现有 observer 只报编码后 Yjs update 的 `byteLength`，无法回答：round 前后 state vector 是否变化、apply 是否推进文档状态、encoded update 是否语义 no-op、两端是否反复认为同一历史缺失。

## 2. 根因链（三层，均有代码/实验锚点）

### R1（编码层，非缺陷）：Yjs「空 diff」结构性非零

- `ReplicationSession.encodeDiff(remoteSV)` = `Y.encodeStateAsUpdate(host.doc, remoteSV)`（`packages/namespace-runtime/src/replication-session.ts` L415-420；yjs ^13.6.30）。
- 协议 §9.2 Step2 `update`「按对端 state vector 编码的 diff，**允许空 diff**」——但 Yjs 编码**没有规范零长**：即使对端 SV 完全覆盖本地方，`encodeStateAsUpdate` 仍写 lib0 varUint 结构头（structs 计数 0、delete-set 0）。
- 最小实验（node + yjs@13.6.30，见 §4.3 探针）：含内容 doc 上 `encodeStateAsUpdate(doc, encodeStateVector(doc))` = **2 B `[0, 0]`**；应用到相同副本后 state vector 逐字节不变。
- 因此「空 diff round」在 wire 与 observer 上必然表现为 `bytes > 0`。**这是 issue 现象的协议层根因，本身不是缺陷**（SA8 relevant_decisions §9.2 注记同款结论）。

### R2（事件词汇层，缺陷本体）：§23 事件只投影 `bytes`，无语义效果字段

四处发射点全部直接发射 `update.byteLength`，无 round 前后 state vector 捕获、无派生效果、无 round 关联：

| 发射点 | 位置 | 事件 | 载荷 |
|---|---|---|---|
| Peer 出向 Step2 | `packages/ws-replication/src/peer-namespace.ts` L155-163（RoundEngine `send` 回调） | `sync-step2-sent` | `bytes: message.update.byteLength` |
| Peer apply 成功 | `peer-namespace.ts` L1056-1080（apply 结算续体） | `sync-diff-applied` | `bytes: update.byteLength`（+可选 latency） |
| Hub 出向 Step2 | `packages/ws-replication/src/hub-namespace.ts` L142-150 | `sync-step2-sent` | `bytes: message.update.byteLength` |
| Hub apply 成功 | `hub-namespace.ts` L886-902 | `sync-diff-applied` | `bytes: update.byteLength` |

类型面（`packages/ws-replication/src/types.ts` L336-351）：两事件字段集 = `{ type, side, connectionId?, namespaceId, bytes, applyLatencyMs? }`——**无 `syncRoundId`（wire §9.1-9.3 本就携带、发射点 `message.syncRoundId` 直接可得）、无 `stateVectorChanged`、无 `applyEffect`、无 `encodedUpdateBytes` 澄清字段**。

推论：`bytes > 0` 只说明编码后 update 有字节；对 no-op round 与 changed round 该信号恒真，判据失效。

### R3（生产放大）：固定 1,272 B 与 delete-set 机制同源

- 本地探针（§4.3）：300 次 set+delete 后 converged diff = 11 B——Yjs delete-set 按区间编码，随删除历史（区间数/客户端数）放大；发送侧每轮 Step2 都会重新携带这些结构字节，而接收侧早已持有 ⇒ apply 后 SV 不变。
- 生产 1,272 B 固定载荷与本机制同源（原始生产日志不在本机，不做超范围断言）；**核心不变式「encoded bytes > 0 ⇏ logical state 变化」已在最小情形（2 B）与本 worktree 集成复现（10 B no-op round）双重证明**，与简报「复现的是同一语义问题」口径一致。

## 3. 本 worktree 确定性复现（SA8 冲突报告注记 5 要求的重建）

SA8 已核实：简报所述 `ws-replication-issue239-repro.test.ts` 与 driver 注入 seam 存在于报告者本地 main 工作树，**本 worktree 缺失**。本次重建：

### 3.1 测试驱动 seam（additive）

`packages/ws-replication/test/driver.ts`：

- `BootOptions` 新增 `hubObserver?: ReplicationObserver` / `peerObserver?: ReplicationObserver`（缺省不注入 = 零事件，与生产 config 同一注入面），直通 `createHubReplication` / `createPeerReplication` 的 `observer` 选项。
- 与简报所述「Peer factory 注入」的实现偏差说明：直通选项同样达成「同时捕获 Hub/Peer observer 事件」的目标，改动面更小（无 factory 包装、不动 wires/dial 闭包）；均为测试侧 additive seam，未触碰任何生产代码。
- 静默漂移注入沿用既有受控 seam：`run.hubNode.persistence.peek(owner, nsId)`（persistence stub 测试面，与 `ws-replication-periodic-reconcile.test.ts` L61 同款）——**未要求生产代码暴露 live Y.Doc**（ADR-0012 被否决方案、包边界纪律遵守）。

### 3.2 复现测试

`packages/ws-replication/test/ws-replication-issue239-repro.test.ts`，两场景（fake scheduler 全虚拟时间，零真实等待；`reconcileIntervalMs=100`）：

**场景 1 — 已收敛副本 periodic no-op（`peerReplica:'same'` 起步，初始 reconcile 后 SV 逐字节相等）**，连续 7 轮逐轮断言：

1. `advanceMs(interval)` 后 roundId 单调 +1、namespace 回 `live`（§9.4/§16 状态机事实）；
2. 双方 state vector（`run.stateVectorOf`，经测试面 `encodeStateVector`）round 前后逐字节不变、彼此相等；
3. ROOT/META（`replicationId`）不变；
4. **缺陷观测**：双方每轮各发 ≥1 笔 `sync-step2-sent` 与 ≥1 笔 `sync-diff-applied`，且 `bytes` 全部 > 0；
5. **缺陷观测**：全部事件（含初始 reconcile 段）键集不含 `syncRoundId` / `stateVectorBeforeHash` / `stateVectorAfterHash` / `stateVectorChanged` / `encodedUpdateBytes` / `applyEffect` 任一。

**场景 2 — 静默漂移修复 round**：Hub live Y.Doc 直接写 `n=99`（不产生 UPDATE 帧），推进一个 interval：

1. 修复成功：peer ROOT `n=99`、roundId +1、回 live；
2. changed：peer SV 较 round 前推进，双方 SV 收敛相等；
3. **缺陷观测**：该 changed round 事件字段形状与场景 1 no-op round 完全相同（仅 `bytes,connectionId,namespaceId,side,type`）。

### 3.3 断言性质说明（红灯锚）

本测试是**缺陷存在的正向证明**：断言的是「现状确实只报 bytes、no-op round bytes 非零、无语义字段」。修复落地（§23 append-only 追加语义字段）后，场景 1 第 5 项与场景 2 第 3 项的「不含语义字段」断言按预期翻转（变为断言 `stateVectorChanged=false` / `applyEffect=noop` 存在且正确），即验收口径（简报 §Required feedback loop 6/7）。遵循简报纪律：**不锁死字节数**（10 B / 36 B 仅作为证据记录，随 client ID 编码宽度波动）。

## 4. 复现结果（原始日志：`..._repro.log`）

### 4.1 首次 verbose 运行（vitest 3.2.7，exit 0，2 tests passed，Type Errors: no errors）

场景 1 每轮观测（7 轮全部一致）：

```text
[issue239 repro] no-op round 1..7:
  hub  sent/applied = [10]/[10] B
  peer sent/applied = [10]/[10] B
[issue239 repro] no-op 事件字段形状（去重）:
  ["bytes,connectionId,namespaceId,side,type",        ← step2-sent / diff-applied
   "connectionId,from,namespaceId,side,to,type",      ← channel-state-changed（live→reconciling→live）
   "connectionId,from,side,to,type"]
```

场景 2 漂移修复 round：

```text
[issue239 repro] drift-repair round:
  hub  sent/applied = [36]/[10] B   ← hub Step2 携带漂移 op（36 B）；hub apply peer 空 diff（10 B）
  peer sent/applied = [10]/[36] B   ← peer Step2 空 diff（10 B）；peer apply 修复 op（36 B）
[issue239 repro] changed 事件字段形状（去重）:
  ["bytes,connectionId,namespaceId,side,type", "connectionId,from,namespaceId,side,to,type"]
```

字节量与简报口径吻合（no-op 9–10 B、漂移 round 34–36 B 本地 fixture 区间）。

### 4.2 稳定性与回归

- 稳定性：连续 20 次运行 **20/20 PASS**（每次 2 tests passed，共 40/40；`STABILITY RESULT: PASS=20/20 FAIL=0`）。
- 包 typecheck：`tsc -p tsconfig.json`（含 `test/**`，覆盖 driver 改动与新测试）exit 0。
- driver 改动回归面：`ws-replication-periodic-reconcile` + `ac4-reconcile` + `ac5-live` + `issue231-send-failure` 共 4 文件 27 tests 全绿（additive 选项零破坏）。

### 4.3 Yjs 编码探针（R1/R3 机制证据；node --input-type=module + yjs@13.6.30）

```text
[A] 含内容 doc（无删除）：encodeStateAsUpdate(doc, encodeStateVector(doc)) = 2 B [0, 0]；
    应用到相同副本后 SV 不变 = true
[C] 300 次 set+delete 后：converged diff = 11 B；应用到相同副本后 SV 不变 = true；
    重复编码仍 11 B（每轮 Step2 重复携带同一批结构字节）
```

## 5. 不可区分性论证（缺陷危害的观测面证明）

对一个只消费 observer 事件的诊断 Adapter：

1. **`bytes > 0` 恒真**：no-op round（10 B）与 changed round（36 B）都非零——简报所述「用 bytes>0 猜测是否存在语义 diff」必然把所有健康 periodic round 误报为「持续非空业务 diff」。
2. **bytes 大小不是可靠判据**：差异仅来自编码宽度（client ID/结构数量），简报明示「回归测试不应锁死字节数」；生产固定 1,272 B 的 no-op round 与真实缺陷 round 的字节数可以完全重叠。
3. **`channel-state-changed` 同样不区分**：两类 round 都经历 `live → reconciling → live`（场景 1/2 键集证据一致），状态迁移只证明「round 发生」，不证明「状态推进」。
4. **无 round 关联**：sent/applied 之间、trace/log 之间无 `syncRoundId` 等安全字段可关联（发射点拿得到 `message.syncRoundId` 但未投影）。

## 6. 约束合规注记（对照 SA8 relevant_decisions）

- **正交两维**（ADR-0010 #134 R2-7）：no-op round 的 Step2 仍是 sequenced apply + dirty + `rootValidation='replication-unvalidated'`；`applyEffect=noop` 只否定 SV 推进——本复现断言的「SV 不变」不与 dirty/unvalidated 冲突（场景 1 中 ROOT/META/SV 全部不变即该正交性的观测面）。
- **wire / 状态机零变化**：复现未触碰任何生产代码；driver seam 为测试侧 additive。
- **受控 seam**：SV 捕获经测试面（`run.stateVectorOf` / persistence stub peek），未要求暴露 live Y.Doc（ADR-0012）。
- **不锁字节数**：断言只用 `> 0` 与键集，字节量仅记录为证据。
- 范围切割：Hub/Peer 状态迁移不对称非缺陷（issue 明示）；#231/#232 不在本次分析面。

## 7. 修复方向锚点（非裁决，供后续 SA）

- 发射点可得的既有事实：`send` 回调内 `message.syncRoundId`（SYNC_STEP2 wire 字段）；apply 结算续体两侧均可经 session 受控能力捕获 before/after SV（`encodeStateVector`，读取面、不进 sequencer 槽）。
- §23.4 纪律约束（SA8 已摘录）：捕获必须 observer 注入门控（无 observer = 零捕获、热路径逐字节等价）；before 在帧分发同步段、after 在 apply 结算续体；捕获/比较路径 throw 静默折叠；`bytes` 只增不改（新增 `encodedUpdateBytes` 澄清而非 rename）；hash 字段需先在 §23.3 注册「documented safe digest」，否则走 issue 授权退路（`stateVectorChanged` + round-local correlation）；`syncRoundId` 关联域 = 单连接代际（§21）。

## 8. 证据文件清单

| 文件 | 内容 |
|---|---|
| `wiki/raw/task_issue-239-periodic-noop-observability_failure_analysis.md` | 本文档（故障分析证据） |
| `wiki/raw/task_issue-239-periodic-noop-observability_repro.log` | 复现原始日志（verbose 单跑 + 20/20 稳定性摘要） |
| `packages/ws-replication/test/ws-replication-issue239-repro.test.ts` | 确定性复现测试（两场景，未提交工作区改动） |
| `packages/ws-replication/test/driver.ts` | observer 直通 seam（additive，未提交工作区改动） |
