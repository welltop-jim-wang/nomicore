# 任务简报 — Phase 5: multiplex namespaces with bounded fair backpressure（issue #137）

## 任务身份

- repository: welltop-jim-wang/nomicore（repositoryId: nomicore）
- issue: #137（label: feature）— https://github.com/welltop-jim-wang/nomicore/issues/137
- worktree: /home/wangjian/nomicore-fix-issue-137
- branch: fix/issue-137-on-docs-phase-5-websocket-replication
- run_id: issue-137-1787922674-8367
- round: 1
- 任务类型: **功能开发**（新增能力；无缺陷复现诉求，跳过 SA5）

## Parent

PR #130（docs/phase-5-websocket-replication）— umbrella 分支。

## Blocked by

- #136（「Phase 5: synchronize one namespace over WebSocket」，已经 PR #160 合入 umbrella，
  当前分支基点 6f2676f 即该 merge commit —— 阻塞已解除）

## What to build（issue 原文）

Allow one Peer WebSocket to carry many independent namespace lifecycles without allowing a hot or
slow namespace to block local writes, control traffic, or other namespaces.

## Acceptance criteria（issue 原文，逐条验收基准）

- [ ] AC-1: One connection multiplexes namespace frames directly by namespaceId and forbids
  reopening a closed namespace in the same connection.
- [ ] AC-2: Each namespace has bounded queued count/bytes, configurable in-flight UPDATE window,
  ACK timeout, and unsent-update merging.
- [ ] AC-3: Overflow discards only unsent increments for the affected namespace, enters
  needs-resync, and preserves already accepted local Y.Doc state.
- [ ] AC-4: Connection scheduling prioritizes control/error/ACK and round-robins data with at
  most one frame per namespace per turn.
- [ ] AC-5: Connection total-pressure recovery selects queued namespaces for resync while
  preserving a control-frame reserve; reserve exhaustion is a classified connection failure.
- [ ] AC-6: WebSocket bufferedAmount high/low-water gating uses the Cordis scheduler and never
  blocks the Runtime sequencer.
- [ ] AC-7: Tests demonstrate fairness, no starvation, independent namespace failure,
  queue/window limits, reconnect repair, and bounded memory under adversarial traffic.

## 规范依据（设计与裁决基准）

- **ADR 0010** `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`：
  - L143：每个 Peer→Hub 维持一条长期 WebSocket 并 multiplex 多个 namespace；wire 不使用
    channelId，每个 namespace-scope frame 直接携带 namespaceId；同一连接内同一 namespace
    只允许一个生命周期，关闭后重开必须重建连接（⇔ AC-1）。
  - L151：连接/namespace 状态、消息码、payload、错误码、timeout、close code、backpressure
    与完整时序以 `docs/protocols/instance-replication-v1.md` 为唯一 wire contract；连接断开
    即 close sessions/release Leases，不保留 outbox，重连重新 OPEN 并 reconcile；
    per-namespace 有界队列溢出丢弃未发送增量并进入 needs-resync；connection 按 namespace
    round-robin 公平发送，control/ACK 保留额度，网络背压不得进入 Runtime sequencer
    （⇔ AC-2/3/4/5/6）。
  - L113：队列溢出只把 channel 标记为 needs-resync，不得阻塞 write sequencer。
- **Phase 5 文档** `docs/phases/phase-5-websocket-replication.md`：
  - 切片 6（L103–110）：`@nomicore/ws-replication` namespace 状态机 —— per-namespace 滑动
    窗口、有界队列、round-robin 公平调度与 connection control 保留额度；溢出丢弃未发送
    增量并重新 diff，不阻塞 Runtime sequencer。
  - 切片 7（L114）：一个 peer→hub 长连接 multiplex 多个 namespace。
  - 必须通过场景 10（L177，慢消费者 needs-resync 不阻塞 sequencer）与 13（L180，
    frame/update/channel/queue 上限按 channel 或连接正确隔离）。
  - 测试 seam（L189–195）：内存双端 transport/fake socket、故障注入（丢帧/重复/乱序/连接
    中断/队列溢出/shutdown race）、不用真实时间等待。
- **Wire contract**：`docs/protocols/instance-replication-v1.md`（20-byte 大端 envelope、
  一 WS message 一 frame、namespaceId 直接寻址、专用 ACK、统一 ERROR、RESYNC_REQUIRED）。
- **切片 3 对账注记**（phase-5 文档 L81/L267）：fanout 投递队列（每 session 容量 16、溢出
  弃新置 needsResync）属切片 3 已交付域；本任务的 WS 发送队列/连接级背压属切片 6 域
  （ADR 0010 L151）——两者属主边界不得在设计与实现中混淆。

## 既有代码基线（issue #136 已交付，本任务在其上扩展）

- `packages/ws-replication/`：peer-connection.ts（连接状态机）、peer-namespace.ts、
  hub-connection.ts、hub-namespace.ts、round-engine.ts（sync round）、update-channel.ts、
  frame-io.ts、lifecycle-queue.ts、fence-watchdog.ts、defaults.ts、types.ts、validate.ts、
  error-mapping.ts、testing.ts；test/ 下 AC1–AC7 验收套件 + harness/driver。
- `packages/replication-protocol/`：envelope/messages/payloads/limits/negotiation/errors 纯包。
- 相关运行时：`packages/namespace-registry`（Lease/ReplicationSession/fanout 队列）、
  `packages/namespace-runtime`、`packages/doc-runtime`。
- #136 wiki 档案：`wiki/raw/task_phase5-ws-namespace-sync*.md`（设计/评审/dispatch 可复用）。
- 更早档案：`wiki/raw/task_phase5-bootstrap-archive-reset*.md`（#133）、
  `wiki/raw/task_namespace-lease-replication-session*.md`（#134）。

## 范围边界（非目标提示，来自 phase-5 文档 §非目标）

- 不做分布式 Registry、多 hub、peer-to-peer、awareness/presence、REST/y-websocket 兼容端点；
- 不做 durable outbox、增量 WAL、跨重连 update ID 去重表；
- 不做第二种 transport 或提前抽取 transport-independent seam；
- 认证/授权细节（切片 7 其余部分）与 apps/yjs-server composition root（切片 9）非本任务范围，
  除非为多路复用/背压所必需的最小接缝。

## 流水线路由（功能开发）

SA8 前置门禁 → SA6 验收红灯 → SA1 设计 → SA8 设计复审 → SA2 攻击评审 → SA3 TDD 实现 →
SA4 静态验尸 → SA7 动态验证 → AC 逐条门禁 → 双轴终审 → 收尾。

---

## SA6 红灯验收测试（Phase 1 验收锚定，2026-08-28 追加 · issue #137 红色契约）

### 产出文件

| 文件 | 内容 |
|---|---|
| `packages/ws-replication/test/ws-replication-issue137-ac1-ac7-red.test.ts` | 4 条红灯用例（AC-2 合并 / AC-6a+AC-4 高水位暂停+恢复轮转 / AC-5 连接总压力 / AC-6b hub 出站压力） |
| `packages/ws-replication/test/issue137-driver.ts` | 多命名空间驱动器：bootMulti（count 个 hub ns + 单 peer 连接 multiplex 全部 target）、自定义 schema（`blurb` 字符串字段——大体积 update 注入锚）、传输端 `bufferedAmount` 压力属性（AC-6 seam）、holdHubSaveDocs（saveGates 顺序门闩——多 ns 窗口分别满） |
| `packages/ws-replication/test/harness.ts` | 最小扩展：`StubPersistence.saveGates`（顺序门闩队列；空队列零影响——既有 73 用例零回归，实测验证） |

### AC 覆盖映射与成熟度测定（探针实测，2026-08-28）

关键结论：**AC-1/AC-3 与 AC-7 的三条演示轴（独立失败、重连修复、per-ns 队列/窗口/ACK-timeout 上限）在当前代码（issue #136 交付态）上已绿**——探针实测：双 namespace 单连接双向 live、断线重连双双 live 并收敛、A 终态失败 B 不受影响、A 的 per-ns 溢出不入 B。故不作红灯锚定（避免误绿）；以守卫断言组入下述用例。**连接级新域（本 issue）全部实测红**：

| AC | 用例（红灯锚） | 当前实现实测失败形态（=红锚） |
|---|---|---|
| AC-2（未发送增量合并） | `AC-2:`（1 ns；saveGate 扣 A1 ACK → 窗口满 → A2/A3/A4 入未发送队列 → 释放） | 断言 `UPDATE 帧数 < 4`：实测 `expected 4 to be less than 4`——逐笔一帧，无 Y.mergeUpdates |
| AC-4（公平轮转）+ AC-6a（peer 出站高水位暂停） | `AC-6a+AC-4:`（2 ns；`bufferedAmount` = 2×highWater；各写 3 笔） | ① 核心红锚：高水位下应零 UPDATE 帧——实测 3 帧立即发出（无 gating）；② 恢复段帧序应 A,B,A,B,A,B（round-robin 每轮每 ns 至多一笔）——当前无积压可观察（#136 设计 §4.4 自注「调度器结构性存在但测试中零积压——R-11/F6 演进位即本 issue」） |
| AC-5（连接总压力） | `AC-5:`（2 ns；`maxQueuedBytesPerConnection=60KB`；30KB blurb ×5；saveGates 扣双向 ACK → A 队列 60KB+B 30KB=90KB 超限） | `settleUntil 预算耗尽：A 进入 needs-resync（当前 live / B live）`——`maxQueuedBytesPerConnection` 仅在 defaults/validate/types 有值，运行时从未被读取 |
| AC-6b（hub 出站高水位暂停 + control 保留） | `AC-6b:`（hub 压力 2×highWater；peer 写经 hub ACK 应照常出（control 保留）；hub fan-out UPDATE 应暂停） | `expected 0 but got 1`——fan-out UPDATE 无视压力立即发出 |

### seam 说明（测试侧新增面，均为最小扩展）

1. **`bufferedAmount` 压力属性**（AC-6）：DuplexTransport 以 number 型动态属性暴露发送缓冲水位（与真实 WebSocket 属性同构；#136 设计 §4.4/R-11「切片 7 适配层必须接上 bufferedAmount 观察」）。实现经 `transport.bufferedAmount` 读取，**缺省 0 = 无压力**——既有 harness `makeWire`（无该属性）与 #136 全部用例零影响（实测 73/73 绿）。若 SA1 设计采用方法形态（`bufferedAmount()`），本 seam 需同步调整（一处），请 SA1/SA8 在设计中明示读取形态。
2. **`saveGates` 顺序门闩队列**（StubPersistence）：按 saveDoc 到达顺序逐个消费挂起（多 namespace 分别扣 ACK）；空队列零影响。用于 AC-4/5 的「两窗口各自满」确定性时序。
3. **恢复段计时假设**（AC-6a/b）：恢复检查经注入 Cordis Timer 驱动，测试以 1s 步进 ×30（30s 虚拟时间、ackTimeoutMs=120s 无干扰）覆盖检查间隔——**假设检查间隔 ≤ 30s**（协议 §17 未钉死间隔；若设计采用更长间隔请 SA1 注明，测试侧可调整推进量）。

### 红灯运行验证（独立进程，真实执行）

命令：`pnpm exec vitest run packages/ws-replication --no-typecheck`（worktree 根；后台独立进程，退出码落盘）。

结果（`/tmp/sa6-r137-full.log` 与终轮复跑 `/tmp/sa6-r137-final.log`，均 exit=1）：

```
Test Files  1 failed | 11 passed (12)   ← 新文件 4 it 全红；既有 11 文件（73 IT）零回归
Tests       4 failed | 73 passed (77)
EXIT=1（预期——本 issue 连接级背压域未实现）
```

红锚逐条与探针测定一致：① AC-2 合并帧数 4 ≥ 4；② AC-6a 高水位下 3 帧发出（应为 0）；③ AC-5 A 恒 live（连接限额未执行）；④ AC-6b 高水位下 fan-out 1 帧（应为 0）。**既有 73 IT 零回归**；`git diff --check` exit 0；类型干净性：`pnpm exec tsc -p packages/ws-replication/tsconfig.json` → exit 0（含新增测试与 driver，全程零错误）。

禁止事项核对：无源码 grep 断言（全部为 wire 帧/状态投影/持久化值/时序门闩断言）；零 real sleep（fake scheduler + 微任务 + 门闩）；未触碰 src/（生产代码零改动——harness/driver 为测试基建）；`scripts/test-lock.sh` 不存在（无脚本需维护）。

### 移交标注（SA1/SA3 注意）

- AC-1（multiplex + 禁止同连接重开）/AC-3（per-ns 溢出语义）已绿——**无需新实现**，SA1 不得以「实现缺失」为由重做（本 issue 的新域 = 连接级：§4.4 调度、总压力、水位闸门、合并）。
- AC-7 的「fairness/no-starvation/independent-failure/reconnect-repair/queue-window-limits/bounded-memory」演示面：前二者由 AC-6a+AC-4 用例承担；后四者既有 #136 套件 + 本批守卫已覆盖——SA7 动态验证可在此基础上扩展。
