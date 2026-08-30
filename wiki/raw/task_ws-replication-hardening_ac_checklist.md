# AC 逐条核对表 — issue #161 ws-replication 协议加固（Phase 3.5 门禁）

**核对时间**：2026-08-29 | **核对者**：总控（证据全部来自 SA 产出与实测运行，非口头声明）
**实现基线**：commit 066d01f（主体）+ 3e7df32（SA4 R1 回流 + 裁决3 E5 + 测试⑦豁免）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | A spoofed HELLO identity is rejected before namespace authorization | ✅ | `test/ws-replication-sa6-hardening-g1-g2-red.test.ts` AC1：伪造 `peer-loki` → authorize 零调用 + ERROR `INSTANCE_IDENTITY_MISMATCH` + 1008 收口（裁决2替换锚 `hubSideClosed===true` + `connections.length===0`）；SA4 R2 §固定面核验；SA7 全链路绿 | SA3 实现（accept 受信身份绑定 + HELLO 首查），已绿 |
| AC2 | Delayed message/close callbacks from an old socket cannot affect a replacement connection | ✅ | 同文件 AC2a（迟到 message）/AC2b（迟到 close）：新连接保持 ready、旧 socket 帧/close 被代际闸静默丢弃；peer-connection.ts 回调绑 connectionEpoch + 退订 | SA3 实现，已绿 |
| AC3 | Forged/stale BOOTSTRAP_ACK and CLOSE_OK frames cannot advance state | ✅ | AC3a（伪造 BOOTSTRAP_ACK → `ACK_STATE_VIOLATION` fatal 1002）；AC3b（伪造 CLOSE_OK → 不完成 close，`closeSettled===false`，closeTimeout 兜底）；R1 修复后关联基准=控制帧自身序（SA4 复现脚本 EXIT=0、SA7 D2 类级锚） | SA3 实现 + SA4 R1 回流，已绿 |
| AC4 | Hub ACK timeout deterministically causes Peer-initiated reconciliation and convergence | ✅ | AC4-1（hub 记忆化 RESYNC_REQUIRED 恰一帧）/AC4-2（peer 恢复 round 收敛 n=9 双侧一致）；A5 语义锚（排队 UPDATE 保留 + zombie ACK 容忍）；SA7 D1 全链路（4 ns 竞争下 ACK 超时 → RESYNC → 收敛，零 false-fatal） | SA3 实现（复用 declareHubResync），已绿 |
| AC5 | Deterministic multi-namespace tests prove control priority, round-robin fairness, queue shedding, and high/low-water behavior | ✅ | AC5-RR（裁决1替换构造 `[a,b,a,b]`）/AC5-WATER/AC5-PRI/AC5-SHED + 补充锚 A1 窄锚/A2 滞回锚/A2 单检查点 1011 锚/A7 记账锚；SA7 D3 公平性兜底（滞留帧每检查点周期一帧，零饿死） | SA3 实现（OutboundQueue 数据面），已绿 |
| AC6 | Deterministic race tests prove CLOSE stops acceptance synchronously, drains all accepted applies, and terminal states cannot revive | ✅ | AC6-1（同步 closing）/AC6-2（drain 完整性）/AC6-3（`['closing','closed']` 零复活）/AC6-4（OPEN waiter flush `NAMESPACE_REOPEN_REQUIRES_RECONNECT`）；裁决3 E5 + SA7 D6（closing 期终局 → closeP 有限结算）；测试⑦豁免调整后全绿 | SA3 实现 + 裁决3 链，已绿 |
| AC7 | Existing PR #160 acceptance tests remain green, along with repository typecheck and `git diff --check` | ✅ | `vitest run packages/ws-replication` → 15 files/110 tests 全绿（PR #160 既有 82 例在内）；`tsc -p packages/ws-replication/tsconfig.json` exit 0；`git diff --check origin/docs/phase-5-websocket-replication HEAD` 零输出（SA7 §四；总控 Phase 4 全仓 typecheck 复验见 REPORT.md） | 多轮实测 |

## 交付澄清（G6）落实

| 项 | 结论 | 处置 |
|---|---|---|
| resetReplica | Registry 侧已交付（phase5-bootstrap-archive-reset 切片），非本包缺陷 | 设计 §6 记录归属，不改码 |
| 结构化 observability（ADR-0010 L167） | 未交付 | ✅ 已开票 **#163**（挂接 #161 预留的 onDataShed/onControlExhausted 回调面） |
| apps/yjs-server 组合根（切片 9，ADR-0010 L175） | 未交付 | ✅ 已开票 **#164**（含 A11 强制：adapter 必须暴露 bufferedAmount + ping/onPong + 装配期 loud 断言） |

## 结论

7/7 AC 全部 ✅，G6 三项全部落实（一项记录归属 + 两项开票）。无 ❌ 条目，进入双轴终审与 Phase 4 收尾。
