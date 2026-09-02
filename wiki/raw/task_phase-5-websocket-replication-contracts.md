# Issue #172 — Phase 5 WebSocket replication authoritative contracts

- **Repository:** `welltop-jim-wang/nomicore`
- **Issue:** #172 — Phase 5 follow-up: reconcile ws-replication authoritative contracts and delivery boundaries
- **Task type:** Feature/documentation and public-contract reconciliation
- **Branch:** `fix/issue-172-on-docs-phase-5-websocket-replication`
- **Run ID:** `issue-172-1788016848-4073122`
- **Round:** 1

## Required scope

1. Remove source references which call `wiki/raw/...` a frozen public contract or authoritative design; public behavior must point to `CONTEXT.md`, an ADR, or `docs/protocols/`.
2. Reconcile `instance-replication-v1.md`, ADR-0010, Phase 5 documentation, and public TypeScript API for control reserve names/defaults/lower bounds/accounting; backpressure polling; ping/pong timeout error/close semantics; `CLOSE_OK` correlation violations; and `GOAWAY` quiesce/deadline behavior.
3. State the undelivered boundaries: `resetReplica`; structured observability (#163); apps/yjs-server plus real WebSocket adapter/composition (#164).
4. Correct outdated red-phase test narratives and vacuous assertions.
5. Do not invent unimplemented behavior. Distinguish current contract, known gap, and planned fixes #169/#170/#171.

## Acceptance criteria

- `wiki/raw` is historical evidence only, not an authoritative contract in source/specification.
- Public fields/defaults/error and close-code semantics map one-to-one between code and one authoritative document.
- Phase documentation identifies #163/#164 and `resetReplica` delivery/dependency status.
- No contradictory repository guidance for control reserve, polling interval, pong timeout, `CLOSE_OK`, or `GOAWAY`.
- Tests describe current behavior and critical assertions are non-vacuous.
- `git diff --check` passes; executable-contract changes include relevant typecheck/tests.

## References

PR #130, PR #165, #163, #164, #169, #170, #171; `docs/AGENTS.md`; `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`; `docs/protocols/instance-replication-v1.md`; `docs/phases/phase-5-websocket-replication.md`.

## SA6 契约锚定（执行验收锚 + 红灯/回归契约）

**产出文件**：`packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts`（16 用例：11 红灯 + 5 回归锁；零源码 grep 断言；真实 yjs/Registry/Runtime + fake-duplex + fake scheduler；零 real sleep）。

**权威来源**：protocol §17（`maxQueuedControlBytes` 缺省 8 MiB、`≥ maxBootstrapBytes + 协议开销`、checkpoint 公式）、§18（pong 超时 close 1001）、§6.3/§21（GOAWAY 相对 drain timeout、停机先发 GOAWAY）、§10.2/§13.1（错误 ACK 关联 → `ACK_STATE_VIOLATION` 1002）；ADR-0010 issue #161 修订节（同上冻结值）。SA8 conflict-report 门禁提示 1：**向权威文档+冻结值对齐，不得以代码现状改写冻结值**。

### 模型与偏差证据（本轮运行）

| 组 | 用例 | 断言（冻结契约） | 当前实现 | 运行结果 |
|---|---|---|---|---|
| G1 control reserve | A1-1 | `DEFAULT_REPLICATION_LIMITS.maxQueuedControlBytes === 8MiB` | 字段为 `controlReserveBytes`=64KiB | 🔴 `expected undefined to be 8388608` |
| G1 | A1-2 | 构造期 `maxQueuedControlBytes < maxBootstrapBytes+开销` → TypeError | `validateLimits` 无该校验 | 🔴 `expected function to throw an error, but it didn't` |
| G1 | A1-2b（回归锁） | 满足下界（5,000,000）不得拒绝 | 通过 | 🟢 |
| G1 | A1-3 | 冻结字段驱动记账：暂停段 >1,500B control → `CONNECTION_BACKPRESSURE`(1011) | 字段被 merge 忽略 → 实际 64KiB 额度零耗尽 | 🔴 `expected undefined to be 1011` |
| G2 poll checkpoint | A2-1 | 缺省 checkpoint=floor(10000/100)=**100ms**，advance 150ms 后必须恢复派发 | 固定 `BACKPRESSURE_POLL_INTERVAL_MS=1000` | 🔴 `expected 1 to be 2` |
| G2 | A2-2 | ackTimeoutMs=600 → checkpoint=**6ms**，advance 20ms 后必须恢复 | 同上 1000ms | 🔴 `expected 1 to be 2` |
| G3 pong 语义 | A3-1 | hub 侧 pong 超时 → close **1001** | `connectionFatal('PONG_TIMEOUT', 1002)`；且 `PONG_TIMEOUT` 不在 §13.1 注册表（encodeError 未知码 throw → 无 ERROR 帧） | 🔴 `expected 1002 to be 1001` |
| G3 | A3-2（回归锁） | `pongTimeoutMs < pingIntervalMs` 构造期 TypeError | 已有 | 🟢 |
| G3 | A3-3（回归锁） | 缺省 ping 30_000 / pong 10_000 | 已一致 | 🟢 |
| G4 CLOSE_OK 关联 | A4-1 | closing 期 ackedSequence ≠ CLOSE 序列 → connection fatal 1002 + `ACK_STATE_VIOLATION` | `onCloseOk` 不匹配静默忽略（等 closeTimeout） | 🔴 `fatal = false` |
| G4 | A4-2 | 无未决 CLOSE 的 CLOSE_OK（live 期）→ connection fatal | 静默忽略 | 🔴 `fatal = false` |
| G5 GOAWAY | A5-1 | drain 窗口内 addTarget 停止 OPEN | `addTarget` 在 ready 下直接 `startOpen`（`goawayActive` 未门） | 🔴 `expected 2 to be 1`（多出 OPEN_NAMESPACE） |
| G5 | A5-2 | drain 窗口内 needs-resync 不启动新 sync round | `maybeStartRecovery` 未查 `isGoawayDraining`（host 接口泄漏：声明未用） | 🔴 `expected 2 to be 1`（多出 SYNC_STEP1） |
| G5 | A5-3（回归锁） | deadline → 传输 close(1001) | 已实现 | 🟢 |
| G5 | A5-4（回归锁） | GOAWAY(SHUTTING_DOWN) → blocked | 已实现 | 🟢 |
| G5 | A5-5 | `HubReplication.close()` 先发 GOAWAY（§21 停机第 1 步） | 零 GOAWAY 帧（`close()` 直接 `transport.close(1001,'hub-shutdown')`） | 🔴 `expected +0 to be 1` |

**运行命令**：`pnpm exec vitest run packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts`（`pnpm test` 全量含本文件）。
**结果统计（本轮，worktree `fix/issue-172-on-docs-phase-5-websocket-replication`）**：`Test Files 1 failed | 22 passed (23)`；`Tests 11 failed | 5 passed (16)`（本文件）；既有 22 个测试文件 **159 passed + 0 failed**（无回归）。`Type Errors: no errors`；零 unhandled rejection；`git diff --check` 待 SA3 收尾（本产出仅新增一个测试文件）。
**用途归口**：A1-1/A1-2/A1-3（公开字段名/缺省/下界/记账—规范面）为本票收敛锚，SA3 收敛后转绿；A2-1/A2-2 → **#169** 验收锚；A3-1 → **#170** 验收锚；A4-1/A4-2、A5-1/A5-2/A5-5 → **#171** 验收锚（本票文档须区分 current contract / known gap / planned fix，不得删除或改写成现状值）。A5-5 若 SA1 裁决 hub 侧 GOAWAY 发送属 #164 composition root 未交付边界，须在 §21/切片 9 明确标注而非静默删除。

### 现有测试的过时叙事与恒真断言（要求 4 的证据，修正交 SA3）

- **恒真/空断言**：
  - `ws-replication-ac4-reconcile.test.ts:71`：`expect(peerStep1At, 'peer 的 Step1 必须已发出').toBeGreaterThanOrEqual(0)`——≥0 恒真，与 message 声称的「必须已发出」矛盾（真空）。
  - `ws-replication-review-revisions-r1-r7-red.test.ts:428`：`expect(resyncCount(run), '严格准入不得产生重复/虚假声明').toBeGreaterThanOrEqual(0)`——恒真。
  - `ws-replication-review-revisions-r1-r7-red.test.ts:442`：`expect(channelPendingDataOf(...)).toBeGreaterThanOrEqual(0)`——恒真护栏。
  - `ws-replication-sa7-round2-dynamic.test.ts:393/401/404`：`toBeGreaterThanOrEqual(0)` 三处恒真护栏。
- **过时叙事（-red 命名文件内的「当前实现」注释与现状不符）**：
  - `ws-replication-issue137-ac1-ac7-red.test.ts:114-116`：注释「当前实现：完全无视 bufferedAmount → 6 帧立即发出 → 本断言红」——实现已接入 bufferedAmount 水位（该文件实际全绿）。
  - `ws-replication-issue137-r2-red.test.ts:389`：注释「SA6 冻结新契约字段」指 `controlReserveBytes`——按本票收敛应更名 `maxQueuedControlBytes`（8 MiB）。
  - 同文件 R2-4「(独立性)/(生效)」两用例与 `harness.ts` 的 `CONTRACT_LIMITS` / `WsReplicationLimits` 镜像仍以 `controlReserveBytes`（64KiB）为契约——改名落地时须同步迁移，否则 R2-4 会因字段失效变红（我的 A1-3 即默认替身锚）。
  - `ws-replication-sa6-hardening-g1-g2-red.test.ts` / `g3-g4-red.test.ts` 文件名与头部「当前全部无实现」叙述随实现落地已过时。

### 边界陈述提醒（要求 3）

- `resetReplica`：Registry 侧（`packages/namespace-registry`）已有 `resetReplica`（issue #133 交付）；ws-replication 层**未暴露** peer resetReplica 编排（切片 8 未交付——`PeerReplication` 无 reset 面）。陈述时须以 ADR-0010 #133 round-2 修订节为准（正文 L57 旧次序描述不得引用）。
- 结构化 observability（#163）：`ws-replication` 无 observer/metrics 面（`HubReplication`/`PeerReplication` 公共 API 无事件面）——known gap。
- apps/yjs-server + real WebSocket adapter/composition（#164）：`apps/` 下仅 AGENTS.md/README.md，无 composition root——known gap；`DuplexTransport` 三可选面（bufferedAmount/ping/onPong）的生产装配期断言（§17）随 #164 交付。
