# Standards Review（终审·仓库标准轴）— issue #161 ws-replication 协议加固

**Verdict: clear**

**Date**: 2026-08-29 | **审查员**: 独立 Standards 终审 subagent（与此前的 SA1–SA8 无会话继承）
**审查范围**: `git diff origin/docs/phase-5-websocket-replication HEAD`（基线 6f2676f → HEAD 610c16e；
31 文件，+5435/−163：`packages/ws-replication` 12 src + 6 test + package.json，wiki/raw 12 档案）
**权威输入**: 任务简报、设计 R2+裁决3（`task_ws-replication-hardening_design.md`）、SA4 R2 pass、
SA7 pass、CONTEXT.md、`docs/protocols/instance-replication-v1.md`、`docs/adr/0010`

**阻断清单：无（0 项）。** 非阻断观察 6 项见 §六，均不构成本轮发布障碍。

---

## 一、独立实测复核（非转述 SA 声明，本轮重跑）

| 命令 | 实测结果 |
|---|---|
| `./node_modules/.bin/vitest run packages/ws-replication`（repo root，独立进程） | **Test Files 15 passed (15) / Tests 110 passed (110) / Type Errors none**（Duration 3.01s，两 SA6 红灯文件 + SA7 新锚文件均在 runner 列表且全绿） |
| `./node_modules/.bin/tsc -p packages/ws-replication/tsconfig.json` | **exit 0** |
| `git diff --check origin/docs/phase-5-websocket-replication HEAD` | **零输出（干净）** |
| `git diff … -- packages/ws-replication/package.json` | **恰一行**：`"version": "0.1.0"` → `"0.1.1"`，无其他字段变更 |
| `git status --short` | 仅 `M wiki/raw/task_ws-replication-hardening_dispatch.md`（本轮终审 dispatch 行在记）+ `?? .mabf-dispatch-ts`（调度标记）——diff 范围内全部产物已入库 |

与 SA7 §四、AC 核对表 AC7 的证据链一致，无夸大。

## 二、审查面 1：仓库惯例与 CONTEXT.md 硬性惯例 —— ✅ 无违规

- **冻结词/术语**：对 diff 全部新增行（src + wiki）grep `master|slave|leader|follower|mutation queue|SCHEMA_REGISTRY|DerivedSchema|validateSnapshot|resolveChild|YLEaf` —— 零命中；wiki 唯一 match 是 `20260828-bug-…md` **引用 CONTEXT.md 原文的 _Avoid_ 定义**（合规引用，非使用）。
- Hub/Peer 语义符合 CONTEXT.md 定义（Hub 非 leader、Peer 非 follower 的措辞在设计与注释中一致）；`namespaceId`/`replicationId`/epoch 复制身份三分纪律保持——wire 身份只取 Upgrade 受信产物（`UpgradeIdentity`），owner 不上 wire，HELLO 自述身份不再被采信（hub-connection.ts onHello 首查 + `peerInstanceId = this.trust.peerInstanceId`）。
- **注释风格**：全量中文注释 + `§n.n` / ADR / 协议行号锚（如 `§3.4`、`§17 L490`、`ADR-0010 L165`、裁决编号 A1/A2/A7、NB2(a)），与包内既有风格逐字同构；新增文件 `liveness.ts` 头部块注释含协议 L40 立法引文。
- 实例角色、停接纳、write sequencer 等 CONTEXT 既有术语未被借用或重定义。

## 三、审查面 2：文档与测试要求（wiki/raw 任务档案完整性）—— ✅ 齐备且入库

| 档案 | 状态 |
|---|---|
| 任务简报 `task_ws-replication-hardening.md`（含 run_id/round/AC/SA6 红灯契约指针） | ✅ 入库 |
| 缺陷分析 `20260828-bug-ws-replication-hardening.md`（SA5，6 组 21 项全景） | ✅ 入库 |
| SA8 前置门禁 `…_conflict_report.md` + `…_relevant_decisions.md` | ✅ 入库 |
| 设计 `…_design.md`（1013 行，R2 修订摘要 + §3.8 裁决 1/2/3 + §10 ALLOW/DENY + §13 映射表） | ✅ 入库 |
| SA8 设计复审 `…_design_conflict_report.md` | ✅ 入库 |
| SA2 攻击评审 `…_sa2_review.md`（R1 reject → R2 pass → R3 窄域 reject → E5 补句放行链完整） | ✅ 入库 |
| SA6 红灯契约 `…_sa6_red.md` | ✅ 入库 |
| SA4 静态验尸 `…_sa4_review.md`（R1 reject 四项 → R2 pass 逐项闭合 + 非阻断处置表） | ✅ 入库 |
| SA7 动态验证 `…_sa7_report.md`（pass，D1–D6 七例 + Hard Gate #13/#14 证据段） | ✅ 入库 |
| dispatch 日志 `…_dispatch.md`（25 行派发链，SA8→SA5→SA6→SA1→SA2→SA3→SA4→SA7→AC→双轴终审） | ✅ 入库（本轮终审行在 worktree 补记中，属收尾提交面） |
| AC 逐条核对表 `…_ac_checklist.md`（7/7 ✅ + G6 开票 #163/#164） | ✅ 入库 |

裁决链可追溯性：测试构造调整（AC5-RR/AC1 第二锚/测试⑦豁免）三项均有 §3.8 裁决编号 +
SA2 批准记录 + ALLOW LIST 显式条目 + SA4 R2 逐字核验四重证据——无「先改后补票」。

## 四、审查面 3：生命周期与防御模式规则 —— ✅ 无违规

- **事件驱动 vs 轮询环**：生产代码的 512 跳 `queueMicrotask` 轮询环（G5.2 立法对象）已删除，
  替换为显式 `deferTask` seam（生产缺省单微任务 `defaultDefer`；512 跳 `TEST_DEFER` 常数移入
  `test/driver.ts`，归测试侧所有）。close 承诺结算为封闭事件集 E1–E5（CLOSE_OK 关联 / closeTimeout /
  CLOSE 请求完成段 / 断线·blocked·stop / E5 终局收口），零轮询。`grep` src 全量无 `while(true)`/
  `setInterval`/残留 attempts 计数环。
- **无死代码**：`LifecycleQueue` 类（零引用）、`NamespaceChannelCore` 接口（零引用）、
  `OutboundQueue.sendData` 死桩、`goawayDrainMs` 死字段全部移除；`lifecycle-queue.ts` 头部注释
  明示收敛理由（§5.3）。反向确认：新增面（`enqueueData`/`dropData`/`onDataDispatched`/
  `onDataShed`/`canDispatchData`/`startLiveness`/`settleClosingOpenWaiters`）均有真实调用方。
- **timer/订阅清理卫生**（逐路径核对）：
  - OutboundQueue checkpoint timer：`dispose()` 清除，起挂/续挂条件 A1（paused∨排队∨buffered>0），空闲零挂（N1 纪律）✓；
  - liveness：hub `cleanupAll` / peer `stop`/`dialNow`/`enterBlocked`/`onTemporaryFailure` 五路径均 `stopLiveness(Now)`；`pongTimeoutMs < pingIntervalMs` 构造期校验保证 pong 计时器恒先于下一 ping 结算，无句柄覆盖泄漏 ✓；
  - GOAWAY drain 句柄：`stop`/`dialNow` 清除 ✓；
  - transport 订阅：hub `cleanupAll` 退订 + peer 代际闸（回调闭包绑 connectionEpoch）+ 重拨前 `unsubscribeTransport` 双防线 ✓；
  - channel 订阅摘除先于 session.close barrier（§4.4c），peer 侧保留 `this.unsubscribe === unsubscribe` 捕获比对守卫（防迟到 cleanup 误杀新连接 listener）✓。
- **无魔法常数**：新增数值（ping 30_000/pong 10_000、checkpoint = `max(1, floor(ackTimeoutMs/100))`、
  1011/1008/1002 close code）均带 §/ADR 出处注释；`512 * 1024` 等限额为 PR #160 既有 §2 配置值，非本 diff 引入。
- **出站无静默吞帧**：shed/非 ready 门/dispose/teardown 四出口全部经 `onDataShed` 显影 +
  记忆化 RESYNC 声明（A7 恰一出口纪律）✓。

## 五、审查面 4：可维护性（注释与实现一致性、API 面整洁）—— ✅ 无阻断

- **抽查注释↔实现一致性**（重点核 SA4 R1 修复面）：
  - `sendControl` 注释「返回本帧自身序列」↔ `drain()` 返回 `lastControlSeq`（数据帧派发不污染），
    SA7 D2 锚 `ret === bootOwnSeq === 2` 动态锁定 ✓；
  - `cleanupAll` 注释「通道收口后 dispose → isQuietState 守卫为真 → 零多余帧」↔ `declareHubResync`
    首行 `isQuietState()` 守卫实测在场（hub-namespace.ts:649）✓；
  - `peer-connection.ts` requestRebuild 段注释解释「单跳 queueMicrotask 不经 deferTask」的 spec B-1 锚理由
    ——必要偏离已声明且设计 §5.2 追认 ✓；
  - `enterBlocked` dispose 注释自证「onDataShed → declareLocalResync 经非 ready 门零出站帧」与控制流一致 ✓。
- **API 面**：`accept(transport, identity?)` 可选第二参但缺失即同步 TypeError（响亮拒绝虚假降级，
  注释明示立法）；`UpgradeIdentity` 经 index.ts 导出；`DuplexTransport` 新增三面全可选（缺面 dormant，
  注释标明「正确降级」）；`ResolvedTimeouts` 收窄 ping/pong 为必填、`validateTimeouts` 同步改收
  `ResolvedTimeouts`——类型链一致，tsc 全绿。
- **版本 bump**：恰一行 patch（0.1.0→0.1.1），命中硬门禁 #9 且经设计 §10 ALLOW LIST 显式扩展授权
  （SA4 R1 R2 处置记录可查）✓。

## 六、非阻断观察（记录在案，不影响 verdict）

1. **`update-channel.ts` 头部注释 L5 陈旧**：「本通道的 `send` 回调即该分配点」指向已删除的
   `sendUpdateFrame` 回调形态；序列分配点已移至连接层 drain（`emitOne`），通道经 `onDataDispatched`
   回传获知。首句「序列号在帧实际出队发送时由宿主连接层分配」仍准确，仅末分句失指。建议下次
   触碰该文件时改写（本 diff 内其他注释均已完成此迁移，属漏网一行）。
2. **`frame-io.ts` `dropData` 与私有 `shedNamespace` 函数体逐字重复**（§3.5 触发面 API vs §3.2
   滞回内部路径）：可 `dropData → shedNamespace` 去重；保留两份亦各有语义标注，不强制。
3. **`UpdateChannel.overflows()` 的 per-ns 计数门不含 `pendingDataCount`**（inFlight+queued 口径）：
   较设计上限宽松 ≤ maxInFlightUpdates 帧；总量仍由连接级 `maxQueuedBytesPerConnection` 收口，
   与 A7 不变量自洽。信息性记录。
4. **`hub-namespace.ts` `openWaiters` 闭包只作计数、从不被调用**（flush 点按计数重发帧而非 invoke
   闭包）：该形态为 PR #160 基线既有模式，新 `settleClosingOpenWaiters` 与之保持一致（文件内自洽）；
   若未来收紧可让闭包真正承载发送逻辑。非本 diff 引入。
5. **SA7 新测试文件 `ws-replication-sa7-hardening-dynamic.test.ts` 晚于设计 §10 文件清单落盘**
   （§10 DENY 段冻结的是另一文件 `ws-replication-sa7-dynamic.test.ts`，本 diff 未触碰——边界守住）。
   SA7 增测试锚有 dispatch #23 授权（含 SA4 R2-6 O1 的 E5 运行时锚）且零生产代码触碰，符合阶段惯例；
   清单未回补属文档滞后，信息性记录。
6. **流程面（diff 范围外）**：仓库根 `REPORT.md` 仍为基线继承的 issue-133 frontmatter（本 diff 未含
   REPORT.md）；`dispatch.md` 本轮终审行在 worktree 未提交。二者属收尾阶段必办（Host 完成事务校验
   要求 REPORT.md 当前 run_id），不构成本 diff 的标准违规。

## 七、结论

- 五个审查面全部通过，**零硬性违规**；
- 独立实测：110/110 测试绿、typecheck exit 0、`git diff --check` 干净、版本 bump 恰一行且已授权；
- 档案链（简报→分析→门禁→设计→攻击评审→红灯→实现→验尸→动态→AC）完整入库、裁决可追溯；
- 非阻断观察 6 项（§六）均为注释一行/去重/文档滞后级，建议记入后续切片顺手处理，无需回流。

**Verdict: clear** —— 从仓库标准轴批准进入发布面（推送/PR/CI 观察）。
