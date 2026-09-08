# 红灯验收契约证据 — issue #239: periodic reconciliation 的 no-op 与有效同步可观测性差异

> 阶段：acceptance-contract（红灯固化）。前置：SA8 冲突门禁 `clear` + relevant_decisions +
> SA1/SA5 故障分析（`..._failure_analysis.md`，缺陷确认 reproduced 20/20）与复现测试
> `packages/ws-replication/test/ws-replication-issue239-repro.test.ts`（未提交）。
> Issue comments 于派发前完整读取：**0 条评论，无额外 Owner 要求**。
> 结论：红灯契约测试已固化并亲跑验证——**生产修复前 10/10 按预期失败（红灯），
> 且失败原因全部且仅为本契约要求、而现行 §23 事件缺失的语义字段**；修复落地后本文件
> 不改即转绿（转绿条件见 §6）。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `packages/ws-replication/test/ws-replication-issue239-ac-red.test.ts` | 红灯验收契约测试（新文件；两场景，未提交） |
| `wiki/raw/task_issue-239-periodic-noop-observability_ac_red.log` | 单次 verbose 红灯运行原始日志（2 failed，全为缺失语义字段断言） |
| `wiki/raw/task_issue-239-periodic-noop-observability_ac_red_stability.log` | 10 连跑红灯稳定性原始日志（RED as-expected 10/10，unexpected 0） |

## 2. 契约定义（测试断言的精确语义）

以 issue #239 Expected behavior / Required feedback loop / AC 与 SA8 注记 1–4 为口径，
**hash 字段（stateVectorBeforeHash/stateVectorAfterHash）为可选落地、不纳入必达断言**
（issue 授权退路：`stateVectorChanged` + round 关联即满足验收；safe-digest 是否按
append-only 注册 §23.3 属设计裁决）。

### 2.1 字段契约（必达，按事件类型）

| 事件类型 | 必达字段 | 语义 |
|---|---|---|
| `sync-step2-sent`（hub/peer） | `syncRoundId`（number>0） | = wire §9.1–9.3 roundId（连接代际内单调递增），sent/applied 关联键 |
| `sync-step2-sent`（hub/peer） | `encodedUpdateBytes`（number） | === 既有 `bytes`（encoded update length 的 append-only 澄清字段；`bytes` 冻结不 rename/不重解释） |
| `sync-diff-applied`（hub/peer） | `syncRoundId`、`encodedUpdateBytes` | 同上（apply 侧结算续体投影收到帧的 roundId） |
| `sync-diff-applied`（hub/peer） | `stateVectorChanged`（boolean）、`applyEffect`（'changed'\|'noop'） | 由 apply 侧 before/after state vector 派生（非 byteLength）；两字段一致（changed↔true） |

### 2.2 语义契约（场景断言，全部经实测 SV 增量交叉验证）

1. **no-op round**（已收敛副本，初始 reconcile 后的 periodic round）：round 前后双方
   state vector 逐字节不变且互等、ROOT/META 不变、namespace 回 live、roundId +1
   （§9.4/§16 守护）；该轮每笔 `sync-diff-applied` 必须报 `stateVectorChanged=false` /
   `applyEffect='noop'`，即使 `bytes > 0` 恒真（Yjs 空 diff 结构性非零）——**bytes>0 与
   语义 noop 并存**即 issue 现象的可观测化。
2. **changed round**（hub 静默漂移，下一 periodic round 修复）：每侧 `sync-diff-applied`
   报告的 `stateVectorChanged` 必须等于该侧实测 round 级 SV 增量（漂移源 hub 侧 noop、
   接收方 peer 侧 changed）；round 内至少一笔报 `changed`；round 完成后双方 SV 收敛。
   修复后的下一 periodic round 必须回到全 noop（信号逐 round 正确、非粘滞）。
3. **关联契约**：全部 sync 事件的 `syncRoundId` 集合 === wire `SYNC_STEP1` roundId 集合
   （每轮均有事件、无孤儿事件），roundId 单调递增。
4. **safe-field**：全事件树深扫无 `Uint8Array`/`ArrayBuffer`/`DataView`
   （raw state vector = Yjs bytes，禁止泄漏；修复后仍必须保持）。

### 2.3 显式不锁定的面（设计自由，防过度约束）

- hash 字段不出现也能通过（§2 说明）；
- sent 事件不要求效果字段（发送不推进发送方 SV，语义无定义面）；
- 不锁死字节数（no-op 9–10 B / 漂移 34–36 B 仅随 Yjs client ID 编码宽度波动，只断言
  bytes>0 与 encodedUpdateBytes===bytes）；
- observer gating / throw 隔离 / 键集冻结白名单 = §23.7 conformance 面
  （ws-replication-observer-red.test.ts），实现阶段随 §23 append-only 同步扩展，不在本
  契约重复——**实现不得绕过该 conformance 面**（SA8 注记 6：键集白名单需 append-only
  追加新字段，否则实现后 conformance 红灯）。

## 3. 约束合规（对照 SA8 conflict_report/relevant_decisions）

| SA8 约束 | 本契约的落实 |
|---|---|
| 不改 wire bytes | 零 wire 断言/零新帧；`syncRoundId` 是既有 wire 字段（§9.1–9.3）的观测投影；测试只把它与 wire Step1 帧比对 |
| 不改变 §9.4/§16 状态机 | 每轮守护断言：namespace 回 live、roundId 单调 +1、无重叠轮；修复实现不得改状态机 |
| `bytes` 字段冻结（GA 后不可 rename/删除/重解释） | 断言 `bytes` 保持数值语义；长度澄清 = 新增 `encodedUpdateBytes` === bytes（SA8 注记 2 的 add-only 形式） |
| safe-digest append-only | hash 字段不强制；若设计落地 hash 必须按 §23.3 append-only 注册 documented safe digest + conformance 深扫（见 §2.3） |
| observer gating / throw 隔离 | §23.7 conformance 面职责（§2.3），实现须扩展既有 conformance 测试 |
| 泄漏禁令 | 深扫断言覆盖新增字段路径（§2.2-4） |
| 不暴露 live Y.Doc（ADR-0014） | 漂移注入用 persistence stub peek 测试面 seam（与 SA5 复现同款），零生产代码改动 |
| 不锁字节数 | §2.3 |

## 4. 漂移注入机制（探针实证，供后续 SA2/SA3 知悉——非契约）

直接改 hub live Y.Doc 会经 SessionFanout（`replication-session.ts` createSessionFanout：
null origin → 全部活跃 channel）**产生出向 UPDATE**（探针：settle 后 hub UPDATE 帧
0→1、peer 立即修复）——与 SA5 复现/故障分析的「不产生 UPDATE 帧」表述不同。本契约
复现并利用其确定性时序：

- `advanceMs` = fake scheduler `advanceBy`（同步触发 periodic timer，round 的
  Step1/Step2 编码在同一同步段完成）→ hub 出向 UPDATE 排在微任务 → **peer 先经 round
  的 Step2 apply 收到漂移（sync-diff-applied = changed），随后到达的 UPDATE 为重复
  no-op**。漂移注入后**不得 await**（await 使 UPDATE 先送达、round 变 no-op）；**不得丢
  UPDATE 帧**（信封序列按方向连续——丢帧后 hub 下一帧即 `SEQUENCE_VIOLATION`
  connection-failed，探针实证）。
- 漂移侧固定 hub（非 round 所有者）：peer 出向漂移 UPDATE 若丢失，peer（round 所有者）
  `channel.inFlightCount > 0` → `startPeriodicReconcile` 只重武装不开 round（§9.4 窗口
  收口纪律），periodic 修复需 ack-timeout → needs-resync 恢复——不在本契约面内。

## 5. 验证结果（亲跑，后台进程）

### 5.1 红灯（生产修复前必须失败）— 5.1.1 单次 verbose（`..._ac_red.log`）

命令：`pnpm exec vitest run packages/ws-replication/test/ws-replication-issue239-ac-red.test.ts --reporter=verbose`
结果：**exit 1，Tests 2 failed (2)，Type Errors: no errors**；两场景失败断言逐字一致：

```text
[issue239 ac-red] 场景1 no-op sync-step2-sent(hub) 缺语义字段 syncRoundId——红灯：生产修复前不得在场
[issue239 ac-red] 场景2 hub-drift sync-step2-sent(hub) 缺语义字段 syncRoundId——红灯：生产修复前不得在场
```

红灯精确性证据：场景 2 在缺字段断言前已通过的锚（每轮均在日志内可见）——
漂移后 peer 未见 99、双侧 SV 分歧；advance 后 namespace 回 live、roundId +1、
peer ROOT=99、双侧 SV 收敛、实测增量 delta={hub:false, peer:true} 全部成立；
**唯一失败点 = 契约字段缺失**（非夹具/机制失败）。

### 5.2 红灯稳定性 — 10 连跑（`..._ac_red_stability.log`）

`RED-STABILITY: red(as-expected)=10 unexpected=0`；每跑均恰 2 failed 且失败消息全为
「缺语义字段 syncRoundId」（共 20 条），无超时、无 type error、无偶发机制失败。

### 5.3 回归（不触碰既有文件；SA5 复现与周期性 reconcile 面保持绿）

命令：`pnpm exec vitest run .../ws-replication-issue239-repro.test.ts .../ws-replication-periodic-reconcile.test.ts`
结果：exit 0，Test Files 2 passed，Tests 7 passed（repro 2/2 + periodic 5/5）。

### 5.4 类型检查

`pnpm exec tsc -p packages/ws-replication/tsconfig.json`（含 `test/**`，覆盖新测试文件）
exit 0。

## 6. 转绿条件（实现阶段完成后本文件不改即绿）

1. `sync-step2-sent` / `sync-diff-applied`（hub/peer 四发射点，failure_analysis §2 R2 表）
   追加 §23.1 字段：`syncRoundId`（uint32、单连接代际内）、`encodedUpdateBytes`；
   `sync-diff-applied` 追加 `stateVectorChanged` / `applyEffect`（低基数闭联合字面量，
   §23.6 可作 metric label 候选）。
2. 效果字段派生：apply 前（帧分发同步段）/apply 后（结算续体）经 session 受控能力
   （`encodeStateVector`，读取面不进 sequencer 槽）捕获比较——**observer 注入门控**
   （无 observer = 零捕获，§23.4）；捕获/比较 throw 静默折叠。
3. `types.ts` 事件联合、§23.1 协议文档、§23.7 conformance 键集冻结白名单（
   ws-replication-observer-red.test.ts ALLOWED_KEYS）与事件型数同步 append-only 更新。

## 7. 证据文件清单（artifactPaths）

- `packages/ws-replication/test/ws-replication-issue239-ac-red.test.ts`
- `wiki/raw/task_issue-239-periodic-noop-observability_ac_red.md`（本文档）
- `wiki/raw/task_issue-239-periodic-noop-observability_ac_red.log`
- `wiki/raw/task_issue-239-periodic-noop-observability_ac_red_stability.log`
