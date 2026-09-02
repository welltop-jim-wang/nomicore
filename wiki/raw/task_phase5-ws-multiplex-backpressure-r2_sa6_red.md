# SA6 红灯契约报告（Revision Round 2）— issue #137 Phase 5 R2-1~R2-5

- 任务：`wiki/raw/task_phase5-ws-multiplex-backpressure-r2.md`（质量复审修订轮；Bug 修复）
- 阶段：Phase 1 红灯锚定（含 SA2 R2 复审后置项：§5.6 守卫修订 + 可选加固 IT + 直发守卫修订）
- 产出：`packages/ws-replication/test/ws-replication-issue137-r2-red.test.ts`（9 用例）
- 结论摘要：R2-1（队列 + 直发两路径）/ R2-2（peer+hub）/ R2-3（count+bytes）/
  R2-4（独立性+生效）= **8 个红灯全部真实复现 → SA3 修复（34bbfba）后全部转绿**（红灯→修复→
  转绿闭环完整，非伪红伪绿）；R2-5 = **修复前即绿**（RR 调度本已公平——覆盖缺口落盘即修复）；
  既有 14 文件 / 94 测试全程零回归；终态 **15 文件 / 103 测试全绿（VITEST_EXIT=0）**。

## 1. 测试文件与命令

| 项 | 值 |
|---|---|
| 测试文件 | `packages/ws-replication/test/ws-replication-issue137-r2-red.test.ts` |
| 用例数 | 9（R2-1×2 含直发路径，R2-2×2，R2-3×2，R2-4×2，R2-5×1） |
| 运行命令 | `npx vitest run packages/ws-replication`（全包）/ `... ws-replication-issue137-r2-red.test.ts`（单文件） |
| 类型检查 | `npx tsc -p packages/ws-replication/tsconfig.json`：**TSC_OK**（零类型错误，测试文件含约束性 `as` 断言亦通过） |
| 终态全包结果 | 15 文件 / 103 测试：**15 文件全绿 / 103 测试全绿**；退出码 0（SA3 修复 34bbfba + 守卫修订后） |

- 终态全量日志：`.mabf-bg/sa6-r2-final-vitest.log`（`VITEST_EXIT=0`；103 passed / 0 failed；TSC_OK）
- 红灯期全量日志：`.mabf-bg/sa6-r2-full-vitest-r2.log`（`VITEST_EXIT=1`；8 failed / 95 passed——红灯复现证据）
- 修订前全量日志：`.mabf-bg/sa6-r2-full-vitest.log`（7 failed / 95 passed；既有 94 零回归基线）
- 纪律：真实 yjs / Registry / Runtime；fake-duplex 内存双端；fake scheduler（零 real sleep）；
  零源码 grep 断言（全部锚在 wire 帧 / 状态投影 / 持久化值）；src/ 零改动（仅新增测试文件）。

## 2. 用例 ↔ R2-x 映射与红灯证据

### R2-1（HIGH）超大 UPDATE 静默丢失 — 红灯 ✅（队列路径 + 直发路径）

- 用例 ①（队列路径）：`R2-1: 单笔 UPDATE 编码超 maxUpdateBytes——发送返回 0 后不得静默丢失（显式收口或恢复 round 收敛）`
- 构造：`maxUpdateBytes=8192`、`maxInFlightUpdates=1`；`saveGate` 扣住首笔（n=2）saveDoc → 窗口满；
  写入 `blurb: 'z'.repeat(20000)`（整树 struct ≈ 20KB）→ 队列限 1MB 放行、入未发送队列；
  释放门闩 → drain 取出超限项 → `sendUpdateFrame` 返回 0（item 已被消费）。
- 契约断言（either-or 不锁定修复路径——三条建议路径均协议合法）：预算内必须出现
  ① 显式收口（RESYNC_REQUIRED / ERROR UPDATE_TOO_LARGE）或 ② hub 收敛（恢复 round diff）。
- 红灯证据（失败消息原文）：
  `超大 UPDATE 不得静默丢失：期望显式收口（RESYNC_REQUIRED/UPDATE_TOO_LARGE）或收敛，当前 hub blurb=seed state=live RESYNC=0`
  → 项被消费、hub 恒 seed、state 恒 live、零 RESYNC_REQUIRED、零 UPDATE_TOO_LARGE = review 描述的静默丢失原貌。
- 守卫（两实现均须成立）：peer 本地 blurb === BIG（本地已接受不回滚）。
- 用例 ②（直发路径，SA2 红线思路 #4 可选加固——已采纳落盘；设计 §5.6 末段授权）：
  `R2-1 (直发): live + 窗口有空位 + 队列空 + 单笔超限直发——发送失败必须响亮收口（RESYNC_REQUIRED ≥ 1 + needs-resync），不得静默丢弃`
  — 原无既有测试覆盖直发路径（全量超限构造均经队列路径）；钉死形态：RESYNC_REQUIRED ≥ 1 ∧
  state needs-resync（§17 L488 溢出纪律），守卫 connectionState ready（收口在 ns 域不杀连接）。
  红灯证据：`expected 'live' to be 'needs-resync'`（当前实现 deliver live 直发 F4 静默丢弃）。

### R2-2（MEDIUM）sequence 耗尽发重复序列号 — 红灯 ✅（peer + hub 双侧）

- 用例：`R2-2 (peer)` / `R2-2 (hub)`。
- 可达性说明：出站 uint32 耗尽实践不可达（2^32 帧）。唯一可达触发面 =
  **私态注入 `outbound.lastSeq = 0xfffffffe`**（TS `private` 运行时为普通属性；`OutboundQueue.emitOne`
  检查 `lastSeq >= 0xffffffff`）。断言全部为**运行时 wire 行为**（帧序列/帧种类/close 码），非源码形状。
- 构造：拨计数 → 第一笔写消耗最后一合法序列 0xffffffff（drop 帧保持对端健康——0xffffffff 对 hub 恒为
  gap，drop 隔离链路扰动）→ 第二笔写触发 `onSequenceExhausted`。
- 契约：§14「framing 不可信 → 直接 close」——不得再发送任何帧（尤其重复 0xffffffff 的 ERROR）；
  断言 ① 本方向发送帧序列严格递增（协议不变量 2）② 耗尽后零 ERROR 帧 ③ close(1008) + blocked/closed（守卫）。
- 红灯证据（失败消息原文，双侧同）：`发送序列必须严格递增（第 7 帧，前值 4294967295）` —
  第 6 帧（UPDATE，0xffffffff）后第 7 帧（ERROR，0xffffffff）重复已消费序列号 = review 描述原貌。

### R2-3（MEDIUM）queued limits 错计入 in-flight — 红灯 ✅（count + bytes 双侧）

- 用例：`R2-3 (count)` / `R2-3 (bytes)`。
- count 侧：`maxInFlightUpdates=8, maxQueuedUpdateCount=8`；8 笔合法在途（saveGates 扣 ACK）→
  第 9 写（未发送队列 0 项）触发当前实现 `pending = 8 + 0 = 8 ≥ 8` → 溢出。
- bytes 侧：`maxInFlightUpdates=8, maxQueuedUpdateBytes=5000, maxUpdateBytes=5000`（validate 要求
  `maxQueuedUpdateBytes ≥ maxUpdateBytes`——已取等值）；8 笔在途 × ~1.3KB ≈ 10.4KB > 5000 →
  第 9 写（队列 0 字节）触发当前实现 bytes 溢出。
- 契约：§17 分列限制 + §10.2「窗口满只暂停发送」——窗口合法满 + 空未发送队列不得溢出/不得 resync；
  断言 state 恒 live + 零 RESYNC_REQUIRED；释放后窗口滑动、第 9 笔发出、hub 收敛（全程零 resync）。
- 红灯证据（失败消息原文，双侧同）：`expected 'needs-resync' to be 'live'` —
  当前实现第 9 写即丢弃 + declareLocalResync → state needs-resync = review 描述的「合法满窗口触发不必要 resync」。

### R2-4（MEDIUM）control reserve 错用 lowWater — 红灯 ✅（独立性 + 生效性双侧）

- 新契约字段（SA6 冻结名，`types.ts` 冻结面随设计修订增补；本轮经
  `as Partial<ReplicationLimits>` 传值——`resolveLimits` spread 使其到达运行时，旧实现 validate 忽略额外字段）：
  **`controlReserveBytes`**（字节；建议安全缺省 64*1024 与旧 lowWater 缺省一致——默认行为零漂移；
  启动响亮验证、不得运行时 clamp，按 §17 L494–506 纪律）。
- 用例 A（独立性）：`lowWater=512, highWater=2000, controlReserveBytes=64000`；压力 3000 入暂停段；
  40 笔写 ≈ 3,000B control（ACK）流量——牙口元断言实测 `ackBytes × 40 ∈ (512, 64000)`。
  契约：额度是否耗尽只由独立配置决定——改 lowWater 不得改变 control 容量。
  红灯证据：`expected 'backoff' to be 'ready'` —— 当前实现以 lowWater=512 为 ceiling → 第 ~7 笔 ACK 即
  耗尽 → CONNECTION_BACKPRESSURE(1011) → backoff。
- 用例 B（生效性——新配置确实驱动耗尽）：`lowWater=64000, highWater=100000, controlReserveBytes=1500`；
  压力 150000；40 笔写 ≈ 3,000B。契约：reserve=1500 → 必须耗尽 → ERROR(CONNECTION_BACKPRESSURE) +
  close(1011) + backoff（§13.1 语义）。红灯证据：`expected undefined to be 1011` —— 当前实现
  ceiling=lowWater=64000 → 3,000B 不耗尽、连接存活（新字段未被实现，语义缺失原貌）。
  守卫（两实现均成立）：数据面不受控（hub 已应用 K=40 笔——apply 先于 ACK 发射）。

### R2-5（MEDIUM）AC7 覆盖缺口：持续对抗流量 no-starvation / bounded-memory — 修复前即绿 ✅（缺口落盘）

- 用例：`R2-5: 永久 hot namespace 竞争下普通 ns 最终获得发送机会（no-starvation）；对抗生产期间未发送队列始终有界（bounded-memory）`。
- 构造（fake scheduler，零 real sleep）：count=2（hot/normal）；`maxInFlightUpdates=2,
  maxQueuedUpdateCount=16`；**恰 1 个 saveDoc 门闩**（实测命名空间级串行 save 链——扣住 hot 首笔
  saveDoc 即阻塞 hot 全程窗口 ACK；多放门闩会被 normal 的 saveDoc 依次消费而误扣 normal，即首轮
  运行观测）→ hot 永久 jam（12 笔生产：2 在途 + 10 滞留）而 normal 管线独立放行。
  阶段 1：断言 hot 恒积压（wire 上 hot UPDATE 恒 = 窗口 2）且 normal 全部 6 笔均获发送机会并收敛
  （no-starvation）+ 零 resync。阶段 2：对抗生产继续（8 笔，超出 queued 上界）→ 溢出收口
  （needs-resync + RESYNC_REQUIRED；wire 仍 ≤ 2+16；本地 sequencer 全部接受——不阻塞）=
  bounded-memory 信号。阶段 3：释放门闩 → 恢复 round（state-vector diff，非逐笔 UPDATE）→
  hot 收敛 208；wire UPDATE 帧数 ≤ 窗口+上界。
- **结果：本用例在当前实现下直接通过（GREEN，14ms）**——round 1 的 RR 公平轮转 + 有界队列已满足
  no-starvation / bounded-memory 语义；其缺失本身是覆盖缺口，落盘即修复（简报验收标准第 2 条字面
  授权）。断言为真行为（wire 帧数 / 收敛 / 状态 / 本地接受），非伪绿。
- 注：构造修正确认记录——首轮运行 normal 仅 2 帧（gate 误扣）→ 门闩数改 1 后全绿，属测试构造迭代。

## 3. 对 SA1/SA3 的契约提示（不预设实现，只锚验收）

1. **R2-1**：修复落在 `UpdateChannel` 发送失败路径（`sendAndRegister` seq<=0 / `pullAndSendOne` 出队前
   合并校验）+ `peer-namespace.sendUpdateFrame`(743) / `hub-namespace.sendUpdateFrame`(658) 返回 0 面。
   三条路径（出队前校验 / 失败进 resync / UPDATE_TOO_LARGE 收口）协议均合法；唯若选
   UPDATE_TOO_LARGE，终态 failed 后同连接不得重开该 namespace（§1 不变量 4）。
2. **R2-2**：修复 = `onSequenceExhausted`（peer-connection.ts:478 / hub-connection.ts:413）删除
   `0xffffffff` ERROR 发送，仅 close(1008)（§14 直接 close）。断言已兼容（严格递增 + 零 ERROR）。
3. **R2-3**：修复 = `overflows()` 只计 queued.length / queuedByteCount + incoming，不含 inFlight。
4. **R2-4**：修复 = 配置面增字段 `controlReserveBytes`（types.ts / defaults.ts / validate.ts；
   `sendControl` 判据改为 `controlReserveUsed + frameBytes > limits.controlReserveBytes`），
   lowWater 仅保留恢复 dequeue 语义。**注意**：既有 SA7 D3a/D3c（以 lowWater 为额度锚）语义将被改写，
   属 SA1 设计修订 / SA7 适配域（本轮验收标准第 3 条「AC1–AC7 语义保持」指协议语义，配置面放开是
   review 显式要求，见 r2_conflict_report ALLOW 登记）。
5. **R2-1/R2-3/R2-5 触碰 red 锚的既有断言**：无——既有 94 测试全绿零回归（本轮 baseline 已核）。

## 4. 运行证据归档

- `.mabf-bg/sa6-r2-full-vitest.log`（修订前）：15 文件 / 102 测试 → `Test Files 1 failed | 14 passed (15)`、
  `Tests 7 failed | 95 passed (102)`、`VITEST_EXIT=1`（红灯期望）、Type Errors: no errors。
- `.mabf-bg/sa6-r2-full-vitest-r2.log`（修订后）：15 文件 / 103 测试 → `Test Files 1 failed | 14 passed (15)`、
  `Tests 8 failed | 95 passed (103)`、`VITEST_EXIT=1`（红灯期望）、Type Errors: no errors；TSC_OK。
- `/tmp/sa6-r2-run2.log`：单文件 tsc + vitest（TSC_OK，7 failed / 1 passed，构造迭代期）。
- 基线对照：round 2 启动总控亲测基线（.mabf-bg/ctl-r2-baseline-*.log）94 全绿本已确认；
  本轮确认既有 94 全绿（14 文件 pass）零回归。

## 5. R2 修订（SA2 复审 afterthought 后置项落盘）

### 5.1 R2-4（生效）末段守卫修订（设计 §5.6 钉死形态）

- 问题（SA2 #1 CRITICAL，实测成立）：原末段 `expect(run.rootValue('hub', a, 'n')).toBe(K)`
  在**任何满足其前置断言（1011 + backoff + ERROR×1）的实现下均不可满足**——UPDATE_ACK
  实测 57B ⇒ `allowed = floor(1500/57) = 26` ⇒ 第 27 个 ACK 触发 connectionFatal；
  peer 已发帧 = 8（首窗）+ 26（一 ACK 一发的窗口算术）= 34，其中 applies 28..34 在途由
  `drainPendingApplies` 补完 ⇒ hub n ∈ [27, 35]，恒 ≠ 40。且原守卫位于首个失败断言之后，
  红灯运行中从未实际执行（属死断言）。
- 修订形态（逐字落实 §5.6 代码块；既有 1011/backoff/ERROR×1/牙口元断言全部不动）：
  - ① 下界 `hub n ≥ allowed + 1`（触发帧所属写已应用——apply 先于 ACK ⇒ 恒 ≥ 27）；
  - ② 上界 `hub n ≤ allowed + 1 + maxInFlightUpdates`（= 35；死亡截断界——全量收敛守卫
    永久不可回归）；
  - ③ `peer n === K`（=40；本地完备——「不阻塞 sequencer」的可满足守卫）。
- 非软化论证（设计原文）：三重钉死（死亡前数据面至少推进到触发写 / 死亡截断界 / 本地完备）；
  不采 SA2 选项 A 的精确 `toBe(allowed+1)`——`drainPendingApplies` 必然补完在途应用且终值
  依赖微任务交错非确定，精确 toBe 会复发同类「守卫与耗尽语义矛盾」缺陷。

### 5.2 可选加固 IT（SA2 红线思路 #4，已采纳）

- 新增 `R2-1 (直发)`：live + 窗口有空位 + 队列空 + 单笔超限直发；原无既有测试覆盖直发路径
  （全量超限构造均经队列路径）。
- 红灯证据（旧实现）：`expected 'live' to be 'needs-resync'`（deliver live 直发 F4 静默丢弃）。

### 5.3 R2-1（直发）守卫修订（SA3 实证 4 次复跑 + 10-tick trace——§5.6 同类先例）

- 问题：本用例末段 `expect(run.peer.getNamespaceState(a)).toBe('needs-resync')` **瞬时态
  快照断言与修复语义结构性矛盾**——SA3 修复后 `declareLocalResync` 立即触发恢复 round 且在
  本 `settle()` 预算内完成（state 经 needs-resync 快速回到 live），断言时刻恒为 'live'
  （四次复跑 + 10-tick trace 确定性一致）；快照式状态断言不可钉瞬态路径。
- 修订形态（锚修正，非软化——核心红灯信号与收敛性全部保留并加强；与 R2-1 队列路径用例
  「① 显式收口 或 ② hub 收敛」二选一契约对齐）：
  1. **删除** state 瞬时快照断言（'needs-resync'）；
  2. **保留**：`resyncsOf(peerToHub) ≥ 1`（核心 wire 级红灯锚——旧实现下 RESYNC=0 红因不变）、
     `peer blurb === BIG`（本地接受保留）、`connectionState() === 'ready'`（ns 域收口不杀连接）；
  3. **新增（更强 ② 分支）**：`settleUntil(hub blurb === BIG)` —— 恢复 round（state-vector
     diff）确定性收敛；静默丢失下恒不收敛（红灯位移：RESYNC 帧缺席 + 收敛永不达成双锚）。
- 用例标题同步更新为「RESYNC_REQUIRED ≥ 1 并经恢复 round 收敛，不得静默丢弃」。

### 5.4 修订后复跑验证（SA3 修复 34bbfba 落库后终态）

- `npx tsc -p packages/ws-replication/tsconfig.json`：TSC_OK。
- `npx vitest run packages/ws-replication`（后台独立进程，日志 `.mabf-bg/sa6-r2-final-vitest.log`）：
  **`Test Files 15 passed (15)`、`Tests 103 passed (103)`、`VITEST_EXIT=0`** —— 8 个红灯全部
  转绿（SA3 修复）+ R2-5 保持绿 + 既有 94 零回归；`git diff --check` 干净。
- 提交：仅 `packages/ws-replication/test/ws-replication-issue137-r2-red.test.ts`
  （`test:` 前缀，中英双语 message，引用 issue #137 R2）。
- 附：修订前红灯运行证据（`.mabf-bg/sa6-r2-full-vitest-r2.log`：8 failed / 95 passed）——
  红灯复现→修复→转绿闭环完整，非伪红伪绿。
