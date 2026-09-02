# 设计（Revision Round 2，delta）— issue #137：R2-1~R2-5 协议一致性修复

> **【R2 修订，2026-08-30 · SA2 攻击评审 verdict: reject 后修订】**
> 报告：`wiki/raw/task_phase5-ws-multiplex-backpressure-r2_sa2_review.md`。修订面：
> ① CRITICAL 攻击点 #1——R2-4（生效）冻结红灯末段守卫 `hub n === K(40)` 结构性不可满足
> （SA2 实测 UPDATE_ACK = 57B ⇒ allowed=26 ⇒ 第 27 个 ACK 耗尽关连接 ⇒ hub 应用上界
> 35 < 40）；本轮更正 §8 走查数值、解除 §12「r2-red 零改动」冻结、新增 §5.6 钉死 SA6
> 守卫修订形态（区间守卫，含对 SA2 选项 A 精确形态的源码级反证）并登记 SA6 修订依赖。
> ② MEDIUM #2——§3「encodeMessage import 保留」事实错误，更正为删除两文件 import +
> 登记 SA4 grep 门禁。③ LOW #3~#6 接受性登记（reasonCode 复用 / close 1008 灰区 /
> §2.3 措辞对齐 R2-B1 / patch bump 维持）。五项修复决策（R2-D1~D4、R2-D6 适配集）本身
> 经 SA2 独立复核全部维持，本轮零架构变更。逐条回应表见文末「SA2 反馈逐条回应（R2 修订）」。
> **【R2 复审勘误落文，2026-08-30 · SA2 R2 复审 verdict: pass】** 附两项非阻断文字勘误已落文
> （见文末「R2 复审勘误落文（N1/N2）」）：N1 = §5.4 r2-red 行口径对齐「恰 1 处守卫修订」；
> N2 = makeEnd.send 实为 queueMicrotask 延迟投递（非同步）、hub n ∈ [27,34] 终值非确定、
> 上界由发送侧窗口算术保证——§5.6/§8/§11-R2-A10/回应表措辞更正。修复决策零改动。
> **【实现期勘误落文，2026-08-30 · SA3 commit 34bbfba 实测反馈】** 三项登记（见文末
> 「实现期勘误落文（E1~E3）」）：E1 = §5.6 末段建议的直发 IT `state needs-resync` 快照断言
> 不可满足（收口自身驱动恢复 round 在 settle 预算内完成 ⇒ 恒 live）——正确契约形态已钉死
> （RESYNC_REQUIRED ≥ 1 + 本地保留 + ready + hub 收敛，删除瞬态快照）；E2 = 第三笔写字段名
> 以 schema 合法 `ext` 落盘（设计示例名 other/extra2 非法）；E3 = peer-connection
> codecFieldLimits 死 import 随 encodeMessage 一并删除 + SA4 grep 门禁扩展。修复决策零改动。

- run_id: issue-137-1787922674-8367 / round: 2 / branch `fix/issue-137-on-docs-phase-5-websocket-replication`
- 任务类型：Bug 修复（质量复审修订轮：5 个协议一致性缺陷 R2-1~R2-4 + 1 项测试覆盖缺口 R2-5）
- **本文档是 delta 设计**：基线 = Round 1 设计 `wiki/raw/task_phase5-ws-multiplex-backpressure_design.md`
  （739 行，D1–D11 决策 + §1–§16 全量架构）。本文只登记 R2-1~R2-5 的修复决策、被推翻的 round-1
  决策点、ALLOW/DENY 修订与回归面；未提及的 round-1 条款**全部继续有效**。
- 输入文档（全部已读）：
  - 简报 `task_phase5-ws-multiplex-backpressure-r2.md`（R2-1~R2-5 逐条 review 原文 + 验收 6 条）
  - 相关决议 `task_phase5-ws-multiplex-backpressure-r2_relevant_decisions.md`（ADR 约束基准 delta；
    含 round-1 设计决策 D3/D8/D10 推翻登记节）
  - SA8 冲突报告 `task_phase5-ws-multiplex-backpressure-r2_conflict_report.md`（verdict `clear`；
    三条非冲突注记 = 设计红线）
  - SA6 红灯报告 `task_phase5-ws-multiplex-backpressure-r2_sa6_red.md` + 红灯测试
    `packages/ws-replication/test/ws-replication-issue137-r2-red.test.ts`（8 用例 = 行为契约，
    字段名 `controlReserveBytes` 已冻结）
  - 协议 v1 `docs/protocols/instance-replication-v1.md`（§1/§3/§10/§13/§14/§16/§17 相关条款按
    relevant_decisions 摘录引用）
  - 源码现状：`update-channel.ts` / `backpressure.ts` / `peer-connection.ts` / `hub-connection.ts` /
    `peer-namespace.ts` / `hub-namespace.ts` / `types.ts` / `defaults.ts` / `validate.ts` / `frame-io.ts`
    + 全部既有测试对 `maxQueuedUpdateCount`/`lowWater` 语义的依赖面（grep 全量 + 逐文件精读）

---

## §0. 范围、红线与 round-1 决策推翻登记

### §0.1 本轮改动面（恰五项，全部是协议既有条款的执行面收口）

| 项 | 一句话 | 源码落点 | 协议依据 |
|---|---|---|---|
| R2-1 | 超大 UPDATE 不得静默丢失：队尾超限项丢弃时响亮收口（resync 声明） | `update-channel.ts` sendAndRegister | §10.1 L259/261 + §17 L488 + §1 不变量 9 L29 |
| R2-2 | sequence 耗尽不得再发任何帧（删 0xffffffff ERROR 直发），直接 close(1008) | `peer-connection.ts` / `hub-connection.ts` onSequenceExhausted | §1 不变量 2 L22 + §3 L54 + §14 L391「否则直接 close」 |
| R2-3 | queued count/bytes 溢出判据只计未发送队列，不含 in-flight | `update-channel.ts` overflows() | §17 L479–486 分列 + L488 + §10.2 L279 |
| R2-4 | control 保留额度独立配置 `controlReserveBytes`，与 lowWater 解耦 | `types.ts`/`defaults.ts`/`validate.ts`/`backpressure.ts` | §17 L490 + L492 + §13.1 CONNECTION_BACKPRESSURE |
| R2-5 | 对抗流量 no-starvation / bounded-memory 测试落盘（零 src 改动） | 无（SA6 测试已直绿落盘） | phase-5 L180/193/195/221 + §15.1 L431 |

### §0.2 红线（继承 round 1，本轮全部维持）

- **R0-2 两级队列属主边界**（SA8 注记 ③）：R2-1/R2-3 的全部队列记账与溢出修复位于 ws-replication
  连接域；`namespace-registry` fanout 投递队列（session 域、容量 16 冻结、溢出弃新保旧、sticky
  needsResync）零触碰。
- **R0-1 已绿域不得重做**：零新状态机状态、零 OPEN/bootstrap/round/close 迁移矩阵改动、零新
  wire 消息码/错误码（R2-1 复用 RESYNC_REQUIRED + 既有 reasonCode；R2-4 复用
  CONNECTION_BACKPRESSURE 注册条目）。
- **R0-3 不提前提取 transport-independent seam**（ADR 0010 L177）：本轮零 transport 面改动。
- **不进 Runtime sequencer**（ADR 0010 L151 / ADR 0008 #132）：R2 修复全部在连接/通道层，零
  Runtime status 触碰。
- **§17 L494–506 配置纪律**（SA8 注记 ①，本轮新增承重）：新增配置须安全默认值 + 构造期响亮
  TypeError + **不得运行时 clamp**——R2-4 的 `controlReserveBytes` 全程遵守（§5）。

### §0.3 Round-1 决策推翻登记（对账 relevant_decisions「Round 1 设计决策 delta 登记」节）

| Round-1 决策 | 处置 | 理由 |
|---|---|---|
| **D3（control 保留额度 = `limits.lowWater` 字节）** | **显式推翻**（SA8 注记 ① / review R2-4） | 协议 §17 L490 要求独立保留额度、L492 钉死 low-water 语义仅为恢复 dequeue 的水位迟滞；round-1 以 lowWater 充当额度是量纲借用（当时 R0-4 冻结面下唯一解），review 显式要求独立配置 ⇒ 推翻合法且必要 |
| **D10 子项（`types.ts`/`defaults.ts`/`validate.ts` 零改动）** | **解除到「为 control reserve 配置所必需的最小改动」** | 同上；`index.ts` 导出面仍零改动（`ReplicationLimits` 类型 re-export 自动携带新字段，无需改 index）。D10 其余 seam 登记（UpdateChannelHost 钩子、pullAndSendOne、OutboundQueue 收窄）为 round-1 实现现状事实，维持 |
| **D8（合并触发判据）** | **不动**（relevant_decisions 预留的「出队前校验」牵动位——本轮选择发送漏斗判别而非改 D8 判据，见 §2.4） | 贪心合并的累计上界已保证多项帧 ≤ maxUpdateBytes；超限只可能是单笔项自身超限，在发送漏斗判别即可，无需改合并策略 |
| D1/D2/D4/D5/D6/D7/D9/D11 | 未触及，维持 | 本轮零架构变更 |
| §15 B-8（N-2/N-3 留痕） | **顺带定案**（§13.2）：接受「实现形态为准」——N-3 的直发路径双读闸门微窗口实现为 F4 丢弃；与 R2-1 修复后的语义（非队尾超限 F4 丢弃、队尾响亮收口）同族兼容，登记为定案 | R2-1 恰好把 F4 族语义钉死为「丢弃可、静默终局不可」，B-8 的二选一随之收敛 |

---

## §1. 基线勘察（缺陷锚点 + 契约映射 + 既有测试依赖）

### §1.1 四缺陷的源码现状（逐项已核）

| 缺陷 | 源码锚（现状） | 行为事实 |
|---|---|---|
| R2-1 | `update-channel.ts:137-142`（sendAndRegister：seq≤0 即 return，零标记）+ `:164-173`（pullAndSendOne：takeItems 已核减、sendAndRegister 失败不回滚）+ 大小门 `peer-namespace.ts:743-747` / `hub-namespace.ts:658-661`（超限返回 0） | 超限项被消费后：不置 needsResync、不发 RESYNC_REQUIRED、不报 UPDATE_TOO_LARGE；若该丢失不被后续 round 覆盖 ⇒ 永久静默发散 |
| R2-2 | `peer-connection.ts:478-495`、`hub-connection.ts:413-433`（onSequenceExhausted：`transport.send(encodeMessage(connectionErrorFrame('CONNECTION_POLICY_VIOLATION'), { sequence: 0xffffffff, … }))`） | 耗尽后仍发 1 帧 ERROR，其 sequence 重复最后合法序列 0xffffffff（违反 §1 不变量 2 严格递增；§14 L391 明示 framing 不可信时「否则直接 close」） |
| R2-3 | `update-channel.ts:124-130`（overflows：`pending = inFlight.size + queued.length`；`pendingBytes = queuedByteCount + Σ inFlight payload`） | 合法满窗口（in-flight = maxInFlightUpdates）+ 空队列时，第一笔候选 UPDATE 即 `pending ≥ max` 误溢出 → 丢弃 + declareLocalResync → 不必要 resync（违反 §17 分列 + §10.2「窗口满只暂停」） |
| R2-4 | `backpressure.ts:75-86`（sendControl：耗尽谓词 `controlReserveUsed + frameBytes > limits.lowWater`） | 额度错挂 lowWater：调 transport hysteresis 即连带改变控制帧容量；协议要求独立额度（§17 L490），low-water 仅是恢复 dequeue 水位（L492） |

### §1.2 SA6 红灯 7+1 用例 ↔ 本设计落点

| 红灯用例 | 红灯断言（行为契约） | 设计落点 |
|---|---|---|
| R2-1（1 例） | 超限项出队后预算内必须出现 ① RESYNC_REQUIRED / ERROR UPDATE_TOO_LARGE 或 ② hub 经恢复 round 收敛；本地已接受不回滚 | §2（选 ①：resync 声明；② 随之自然达成） |
| R2-2（peer/hub 2 例） | 本方向发送帧序列严格递增；耗尽后零 ERROR 帧；close(1008) + blocked/closed 守卫 | §3 |
| R2-3（count/bytes 2 例） | 合法满窗口 + 空队列：state 恒 live、零 RESYNC_REQUIRED；释放后第 9 笔发出、hub 收敛、全程零 resync | §4 |
| R2-4（独立性/生效 2 例） | 独立性：`controlReserveBytes=64000` 时 3,000B control 流量存活（ready、零 ERROR、K 笔 ACK、无重拨）；生效：`controlReserveBytes=1500` 时必须耗尽（ERROR CONNECTION_BACKPRESSURE ×1 + close 1011 + peer backoff + 数据面 K 笔全应用） | §5 |
| R2-5（1 例，直绿） | hot 永久 jam 下 normal 全部获发（no-starvation）；超上界对抗生产溢出收口（bounded-memory）+ 本地 sequencer 全接受；释放后恢复 round 收敛 | §6（零 src；落盘即修复） |

### §1.3 既有测试依赖勘察（本轮设计的关键新信息——决定修复形状与适配集）

对全部既有测试 grep `maxQueuedUpdateCount|lowWater` 并逐文件精读，得到四类依赖：

1. **R2-3 边界依赖（3 个测试编码了缺陷边界，修复后必红，须适配）**——均为
   `maxInFlightUpdates:1, maxQueuedUpdateCount:1` 且断言「第二笔即溢出」：
   - `ws-replication-ac6-resync-close.test.ts:40-71`（AC6 溢出→RESYNC→round 修复主用例）
   - `ws-replication-sa4-f1-f2-f3-red.test.ts:28-61`（F1 hub 侧溢出声明）
   - `ws-replication-r3-r4-regressions.test.ts:274-311`（⑧a fence × 恢复 round）
   修复后溢出点后移一笔（见 §4.3 数值走查），三个用例各需**插入第三笔写**触发溢出，
   原溢出后断言（RESYNC=1 / needs-resync / UPDATE=1 / round 修复 / fence 流程）全部保持。
2. **R2-4 额度锚依赖（2 个测试以 lowWater 为保留额度锚，须适配）**：
   `ws-replication-sa7-issue137-dynamic.test.ts` D3a（lowWater=1 首帧耗尽）/ D3c（lowWater=100
   谓词精确帧数）——各加一行 `controlReserveBytes` 覆写即恢复原语义（§5.4）。D3b（缺省 64KiB
   大控制帧）因缺省零漂移**不动**。
3. **R2-1 语义钉死依赖（D4 = round-1 R2-N1 活性测试，必须零适配保持绿）**：
   `ws-replication-sa7-issue137-dynamic.test.ts:425-506` D4 钉死「超限首项 F4 消费后，**同一次
   drain** 后续 pass 照发合法项（wire 上合法帧到达）+ 超限项零 UPDATE wire 帧 + 终态 live +
   零 resync 噪音」。**任何在超限消费点立即置 needsResync / 丢弃全队列 / 发 ERROR 的修复都会
   打断 pass2 合法项发送而击穿 D4**——这是 R2-1 修复形状的核心约束（§2.3）。
4. **无依赖（保持绿）**：ac5-live（窗口 2/队列 100）、ac1-ac7-red（窗口 1/32/2，队列 100/1000；
   AC-5 shed 走连接 cap 与 per-ns 队列字节，不经 count 边界）、ac7-faults:192-219（构造期校验，
   lowWater=256/highWater=512 仅构造不触额度行为）、r3-r4:243（窗口 2）、sa7-dynamic 其余
   （窗口 1/队列 100）、R2-5 红灯自身（§4.3 走查：溢出点从对抗第 5 笔后移到第 7 笔，仍在
   阶段 2 的 8 笔窗口内，断言全过）。

---

## §2. R2-1 设计决策：队尾超限项的响亮收口（resync 路径）

### §2.1 三条协议合法路径的抉择（SA8 注记 ② 授予的选择权）

review 给出三条建议路径，协议均合法；本设计**选「发送失败时进入 resync」并限定收口范围**
（下述），否决另两条的理由：

| 路径 | 裁决 | 理由 |
|---|---|---|
| ① 出队前校验合并结果 | **不采纳为独立机制**（其可达面已被 ② 覆盖） | 贪心合并以「累计原始字节 ≤ maxUpdateBytes」为上界（round-1 §5），多項合并帧**结构上不可能**超限；唯一超限形态 = 单笔项自身 > maxUpdateBytes——该判别在发送漏斗（sendAndRegister）做与在 takeItems 做等价，但漏斗能同时覆盖 deliver(live) 直发路径（§2.2 边界 4），单点收口最小 |
| ② 发送失败时进入 resync | **采纳（本轮设计）** | 复用 §10.2 溢出拓扑（needsResync + declareLocalResync/declareHubResync + 恢复 round state-vector diff）——零状态机改动（R0-1）、零新 wire 码、修复 diff 走 SYNC_STEP2 受独立配置 maxSyncDiffBytes 约束（R2-1 红灯场景 20KB diff ≪ 2MiB 缺省）⇒ hub 收敛（红灯验收分支 ② 同时达成）；不烧毁 namespace 生命周期 |
| ③ UPDATE_TOO_LARGE 收口 | **否决** | ① 终态 failed ⇒ 同连接该 namespace 不得重开（§1 不变量 4 + §16）——对「配置病理 + 可 round 修复」的形态过重，且需新的状态迁移面（违反 R0-1「不改迁移矩阵」）；② 其 registry 行 retry=config 属「等待连接重建或配置变化」的运维语义，而本形态（合法写、超配额单笔）在 maxSyncDiffBytes 允许时可自愈——resync 路径更符合 §1 不变量 9「队列丢弃由 state-vector reconciliation 修复」的字面拓扑 |

**登记**：UPDATE_TOO_LARGE 仍是协议注册码，未来若出现「单笔真实增量 > maxUpdateBytes 且
diff 亦不可承载」的不可修复形态，其收口属运维/演进域（§13.2 R2-B1），本轮不实现。

### §2.2 收口规则（钉死，SA3 不得变形）

**判别点 = `UpdateChannel.sendAndRegister` 入口前置（channel 自持 `host.limits`，单漏斗覆盖
直发 + drain 两路径）；规则 = 「超限且此刻未发送队列已空 ⇒ 响亮收口；队列非空 ⇒ 维持 round-1
F4 静默丢弃」**：

```ts
// update-channel.ts —— sendAndRegister（R2-1 修订；其余逐字不动）
private sendAndRegister(bytes: Uint8Array): void {
  if (bytes.byteLength > this.host.limits.maxUpdateBytes) {
    // R2-1：超限面判别（唯一可达形态 = 单笔项自身超限，§2.1①）。该项无论走哪条
    // 路径都永不可 wire——F4 丢弃语义不变；但丢弃必须可修复：
    //  - 队列非空：后续未发送项承载通道活性（R2-N1/D4 钉死——同 drain 合法项照发），
    //    丢失项由既有 config-pathology 立场（round-1 B-2 R4）与下一次 reconciliation 修复；
    //  - 队列已空：丢弃即终局静默（三个 drain 触发点均不可达——R2-N1 同型分析），
    //    ⇒ §10.2 同构响亮收口。
    if (this.queued.length === 0) {
      this.discardQueued();            // no-op（队列已空）；保持 §17 L488「丢弃全部未发送」形状
      this.needsResync = true;         // 停发新 UPDATE（deliver 首行丢弃）
      this.host.declareLocalResync();  // peer: RESYNC_REQUIRED{send-queue-overflow} + setState
                                       //       + maybeStartRecovery；hub: declareHubResync 同构
                                       // （host 钩子既有：peer-namespace.ts:143 / hub-namespace.ts:149）
    }
    return; // 不调用 host.sendUpdateFrame——控制器大小门（peer:743/hub:658）保留为不可达后盾
  }
  const seq = this.host.sendUpdateFrame(bytes);
  if (seq <= 0) return; // F4：非超限原因（连接收口/ready 门/编码错）——round-1 语义不变
  this.inFlight.set(seq, bytes);
  this.armAckTimer();
}
```

- **pullAndSendOne 返回值不变**：消费即进展（round-1 R3/SA2 R2-N1 方案 A）——超限项被消费 ⇒ true；
  响亮收口发生在返回 true 的同一调用内，drain 后续 pass 因前置 ②（!needsResync）/队列空自然收尾
  （`backpressure.ts:152-158` removeFromWheel / 循环退出），零额外编排。
- **reasonCode**：复用 `'send-queue-overflow'`（§10.2 既有声明语义——「本端发送面无法继续承载」；
  不新增 wire 枚举值，R0-1 维持）。**（R2 修订，SA2 #3 接受性登记）**协议 reasonCode 为自由
  非空字符串（replication-protocol payloads.ts:600-602 仅 checkNonEmpty），复用无编码违规；
  与队列溢出/连接 shed 在 wire 上不可区分的张力是 R0-1 零新枚举红线下 的受约束最优解——
  SA2 裁定接受；运维 metrics 若需区分诱因，属 slice-10 演进位（§13.2 R2-B1 同域登记）。
- **控制器大小门不动**：`peer-namespace.ts:743-747` / `hub-namespace.ts:658-661` 保留（channel
  前置判别后它们对 channel 发送不可达，属纵深防御；hub/peer 对称零改动 ⇒ §12 ALLOW 不含两文件）。
- **重入安全**：declareLocalResync → sendChecked(RESYNC_REQUIRED) → host.sendControl →
  sender.sendControl（observeWater——同步、无 await）在 drainData 调用栈内完成；peer 侧
  `resyncDeclared` 记忆化防重复声明；drain 循环在下一 pass 前重读 paused/isEmitAllowed
  （`backpressure.ts:158`）吸收 sendControl 可能引起的再暂停。

### §2.3 D4 相容性论证（为何「队列非空不收口」是必要且充分的钉死）

- **必要**：D4（§1.3-3）队列 = [超限 BIG, 合法①, 合法②]，断言合法项在同一次 drain 内上 wire
  （`settleUntil(UPDATE ≥ 2)`）且终态 live。若在超限消费点无条件收口（置 needsResync 或发
  UPDATE_TOO_LARGE），pullAndSendOne 前置 ② 立即阻断 pass2 ⇒ 合法帧永不出队 ⇒ D4 红。
  「先发完合法项再收口」的延迟变体则使 D4 终态进入 needs-resync→round→live 的异步链，
  其 `expect(state).toBe('live')` 即时断言不确定——同样不可接受。
- **充分**：R2-1 红灯场景中队列在 F4 时刻**恰为空**（BIG 是最后一笔，takeItems 取出后
  `queued.length === 0`）⇒ 响亮收口立即发生；D4 场景 F4 时刻队列非空 ⇒ 维持现状，D4 全绿零适配。
  两份冻结契约（SA6 r2-red + 既有 94）同时满足，且规则只用通道可见状态（队列长度）表达，
  无时序耦合。
- **语义辩护**（防「规则过窄」质疑；**R2 修订——措辞对齐 §13.2 R2-B1，SA2 #5**）：「队列已空」=
  该丢失是**未发送面的终局状态**——此后三个 drain 触发点（onAck 空位 / 水位恢复 / resetForLive）
  无一可达（与 R2-N1 搁浅面同型分析，round-1 §4.5 论证移用），静默即永久发散，必须此刻声明。
  「队列非空」的合法性依据**不是**「后续存在保证触发的 reconciliation」——在健康 live 连接上
  （ACK 正常回流、无 watchdog 边沿、无重连）**不存在保证触发的 reconciliation**，非队尾超限
  丢弃可无限期静默存续；其依据只有两条：(a) **D4 冻结契约钉死该域**（同 drain 合法项照发 +
  终态 live + 零 resync 噪音——任何更响亮的收口都击穿它），(b) 协议对发送侧超限处置无强制
  条款（§10.1/§17 仅规定队列上限溢出纪律）。该残余静默面即 §13.2 R2-B1 登记的风险（含运维
  下界指导与 slice-10 演进位），**是显式登记的已接受风险，不是修复保证**。红灯用例与 review
  文本（「该项已被消费，且不设置 needsResync / 不声明 RESYNC_REQUIRED」）命中的正是终局静默
  形态，已由队尾规则消灭。

### §2.4 边界矩阵（全部形态走查）

| # | 队列形态（F4 时刻视角） | 行为 | 契约 |
|---|---|---|---|
| 1 | `[BIG]`（BIG 超限，队尾/唯一） | 取出后队列空 ⇒ **响亮收口**：RESYNC + needs-resync + 恢复 round → hub 经 Step2 diff 收敛 | R2-1 红灯 ✓（①②两分支同时满足） |
| 2 | `[BIG, 合法①, 合法②]`（D4） | F4 静默；pass2 合法项合并发出；终态 live、零 resync 噪音 | D4 零适配全绿 ✓ |
| 3 | `[合法, BIG]`（超限在尾） | 合法项先发；pass2 BIG F4 ⇒ 队列空 ⇒ 响亮收口 | 终局不静默 ✓ |
| 4 | 直发路径超限（窗口开 + 闸门开 + 单笔 > maxUpdateBytes，未入队） | sendAndRegister 入口判别：队列通常为空 ⇒ 响亮收口（新行为，无既有测试钉旧静默形态——grep 全量核实：所有既有超限构造均先经队列路径）；队列非空（瞬态）⇒ 静默 F4 同规则。**（第三轮勘误）可观察终态 = 恢复 round 后 live + hub 收敛**（declareLocalResync → maybeStartRecovery 同步开 round、settle 预算内完成——needs-resync 为瞬态不可快照，IT 契约形态见 §5.6 末段勘误） | 规则统一 ✓ |
| 5 | `[BIG1, BIG2]`（连续超限） | pass1 BIG1 F4（队列余 BIG2 ⇒ 静默）；pass2 BIG2 F4（队列空 ⇒ 响亮收口） | 终局不静默 ✓ |
| 6 | 窗口满滞留：BIG 在队但 pull 前置 ③ 阻塞 | 不消费不判别；ACK 到位后 drain 拉出 → 回到 #1/#2/#3 | 无提前收口 ✓ |
| 7 | uint32 耗尽（OutboundExhaustedError）与超限叠加 | sendUpdateFrame 的 catch 收敛 seq≤0（peer-namespace:748-756）——但此时**连接已被 onSequenceExhausted 先行收口**（round-1 §6.3 R2），needsResync 由通道 teardown 置位（update-channel.ts:228-234） | 两修复正交 ✓（§7） |
| 8 | 恢复 diff 本身超限（墓碑形态） | 既有边界：SYNC_STEP2 受 maxSyncDiffBytes；`maxUpdateBytes < 单笔真实增量（含墓碑）` 属配置病理（round-1 B-2 R4 运维指导维持） | 不在本轮范围，登记 §13.2 R2-B1 |

### §2.5 账务一致性（与 round-1 §5 R2 口径无冲突）

超限项在 takeItems 已按入账字节数核减（原始字节口径）；响亮收口的 discardQueued 对空队列是
no-op；needsResync 置位后 deliver 首行丢弃新交付（不产生新账务）。三套记账
（overflows / facet.queuedBytes / §11.3 有界内存）零变化。

---

## §3. R2-2 设计决策：sequence 耗尽 = 直接 close，零出站帧

**修复（双侧对称，各删一段 try/send，~12 行/侧）**：

```ts
// peer-connection.ts / hub-connection.ts —— onSequenceExhausted（R2-2 修订后形态）
private onSequenceExhausted(transport: DuplexTransport): void {
  if (transport.closed) return;
  // R2-2：出站 uint32 耗尽 ⇒ framing 不可信（§14 L391「否则直接 close」字面）。
  // 任何后续帧都只能以重复序列 0xffffffff 发送 ⇒ 违反 §1 不变量 2 / §3 L54 严格递增，
  // 且对端按 gap/repeat 判 SEQUENCE_VIOLATION 自伤——故零出站帧，直接 close(1008)。
  // （删除原 best-effort ERROR 直发——它正是重复序列号的唯一来源。）
  // hub 侧保留 sender.teardown() 于 close 前（既有，hub-connection.ts:415）；
  // peer 侧 teardown 由 enterBlocked() 承担（peer-connection.ts:565-575 已含 sender?.teardown()）。
  if (!transport.closed) {
    transport.close(1008, 'sequence-exhausted');
  }
  // peer: this.enterBlocked()（既有，:494）；hub: closedFlag/state/cleanupAll（既有，:430-432）
}
```

- **依据**：§14 L391「如果 framing仍可信，关闭前 best-effort 发送 connection ERROR；**否则直接
  close**」——sequence 耗尽 = 序列分配面已死 = framing 不可信的字面情形；ADR 0010 L147
  「每方向 sequence 从 1 严格递增，不回绕；gap、repeat 或错误 ACK 关联关闭连接」。
- **收口拓扑不变**：peer close(1008) → blocked（onClose 既有分类 1008 → enterBlocked；
  本地 close 不触发本地 onClose（P-8），enterBlocked 由本方法显式调用——既有代码 :494 保持）；
  hub → closed + cleanupAll。SA6 断言（严格递增 + 零 ERROR + close 1008 + blocked/closed）全过。
- **注释/文档面（R2 修订，SA2 #2——原「import 保留」指示事实错误）**：两方法 doc 注释由
  「best-effort connection ERROR + close」改写为「直接 close（§14 framing 不可信）」。
  **import 处置 = 删除两文件的 `encodeMessage` import**：R2-2 删帧后 `encodeMessage` 在
  peer-connection.ts 与 hub-connection.ts 的调用点归零（peer 唯一调用 :482、hub 唯一调用 :418
  均在删除块内；peer :522/:553 与 hub :372 的收口 ERROR 走 `connectionErrorFrame` 构造消息后
  经 `emitControl` → `OutboundQueue.sendControl` 内部编码，**不经过** `encodeMessage`）。精确
  形态：
  - `peer-connection.ts:6`：`import { encodeMessage, type ReplicationMessage } from '@nomicore/replication-protocol';`
    → `import type { ReplicationMessage } from '@nomicore/replication-protocol';`
  - `hub-connection.ts:6`：`import { encodeMessage, selectProtocolVersion, type ReplicationMessage } from '@nomicore/replication-protocol';`
    → 删 `encodeMessage`，保留 `selectProtocolVersion` 与 `type ReplicationMessage`。
  - `connectionErrorFrame`（来自 './frame-io.js'）保留——收口路径仍在用。
  **SA4 静态门禁登记（grep 兜底，tsc 不可依赖）**：tsconfig.base.json 未开 `noUnusedLocals`
  （仅 `strict`，不含该项），死 import 会静默存续——SA4 须校验
  `grep -c "encodeMessage" src/peer-connection.ts src/hub-connection.ts` 两文件计数均 = 0。
  **（第三轮勘误 · SA3 实现 deviation 登记，供 SA4 比对——超出本节原指示的同类死 import
  清理）** peer-connection.ts 的 `codecFieldLimits` import 在 R2-2 删帧后调用点同样归零
  （其唯一调用 `:485 limits: codecFieldLimits(this.limits)` 在删除块内）——SA3（commit
  34bbfba）随 encodeMessage 一并删除（本设计独立复核：现 peer-connection.ts 中
  codecFieldLimits 计数 = 0 ✓）。hub-connection.ts 的 `codecFieldLimits` **保留且正确**——
  `:279 namespaceFieldViolation(message, codecFieldLimits(this.hub.limits))` 仍在用（现计数
  import+调用 = 2 ✓）。**SA4 grep 门禁随之扩展**：peer-connection.ts
  `encodeMessage = 0 ∧ codecFieldLimits = 0`；hub-connection.ts
  `encodeMessage = 0 ∧ codecFieldLimits ≥ 1`（import 保留且在用）。

---

## §4. R2-3 设计决策：溢出判据只计未发送队列

### §4.1 判据（钉死）

```ts
// update-channel.ts —— overflows（R2-3 修订；签名不变）
private overflows(incoming: Uint8Array): boolean {
  // §17 L479–486 分列限制 + L488「**未发送队列**任一上限超出」：
  // in-flight 窗口是独立限制（maxInFlightUpdates，§10.2 L279「窗口满只暂停发送」），
  // 不得计入 queued count/bytes 判据。
  if (this.queued.length >= this.host.limits.maxQueuedUpdateCount) return true;
  return this.queuedByteCount + incoming.byteLength > this.host.limits.maxQueuedUpdateBytes;
}
```

- **边界语义**：count 用 `>=`（入队后队列长度 ≤ maxQueuedUpdateCount 恰达上界）；bytes 沿用
  严格大于（入队后 queuedByteCount ≤ maxQueuedUpdateBytes）。溢出处置（discardQueued +
  needsResync + live/deferred 分派）逐字不动——AC3 语义（只丢 unsent + needs-resync + 本地保留）
  保持，只有**触发边界**被纠正。
- **validate 既有约束的语义复活**：`maxQueuedUpdateBytes ≥ maxUpdateBytes`（validate.ts:131-135）
  在旧判据下被 in-flight 字节架空（空队列单笔也可能被误拒）；新判据下它恰好保证「空队列时
  任何单笔（≤ maxUpdateBytes）必可入队」——约束与判据自洽，无需新增校验。

### §4.2 为什么必须改既有测试（而非软化判据）

三个既有用例（§1.3-1）在 `maxInFlightUpdates:1, maxQueuedUpdateCount:1` 下断言「第二笔即溢出」
——这正是 review 指出的缺陷边界（pending = inFlight + queued 把 1 笔在途错算进队列额度）。
SA6 契约提示 §3.3 明示修复 = 「overflows() 只计 queued.length / queuedByteCount + incoming，
不含 inFlight」；softening（如只除 bytes 不除 count）会保住旧测试但违背 §17 分列字面与
R2-3 两条红灯（count 侧用例直接锚定 count 分离）。**结论：边界按协议纠正，三个测试各加一笔
写把溢出点推回可达位**——它们验证的 AC3/F1/⑧a 语义（溢出声明 + round 修复 + fence 流程）
原样保持。

### §4.3 数值走查（适配后逐用例）

| 用例 | 修复后序列 | 关键断言核对 |
|---|---|---|
| AC6 溢出主用例 | w1 `{n:1}` 在途（gate 扣 ACK）；w2 `{extra:2}` → **入队**（queued 0→1）；**新增 w3 `{other:3}`** → `queued(1) ≥ 1` → 溢出：discard（extra:2 弃）+ needs-resync + RESYNC×1 | state needs-resync ✓ RESYNC=1 ✓ UPDATE=1（仅 w1）✓ 释放 → round 修复 → hub n=1/extra=2 ✓（other=3 亦收敛，建议断言补齐一行，非必须） |
| F1（hub 侧） | w1 `{extra:5}` 在途；w2 `{n:6}` 入队；**新增 w3 `{extra2:7}`** → 溢出 → hub RESYNC×1 | RESYNC=1 ✓ 释放 → r2 Step1×2 / hub n=6/extra=5 ✓（extra2 亦收敛） |
| ⑧a | w1 `{n:1}` 在途；w2 `{extra:2}` 入队；**新增 w3 `{other:3}`** → 溢出 → RESYNC×1 + needs-resync | bump/fence/conflicted/IDENTITY_CHANGED×1/零 INTERNAL_ERROR 全部不受影响 ✓ |
| R2-3 红灯 count | 8 笔在途（gates 扣）+ 第 9 写：queued(0) ≥ 8? 否 → 入队 → live | state live ✓ 零 RESYNC ✓ 释放 → 第 9 笔发出收敛 ✓ |
| R2-3 红灯 bytes | 8 笔在途 ~10.4KB + 第 9 写 1.3KB：queuedBytes(0)+1.3KB ≤ 5,000 → 入队 | 同上 ✓ |
| R2-5 红灯 | 阶段 1：12 写 → 2 在途 + 10 队列（10 < 16 不溢）✓；阶段 2：8 写 → 第 7 写时 queued(16) ≥ 16 → 溢出（旧实现第 5 写触发——均在 8 笔窗口内） | needs-resync ✓ RESYNC ≥1 ✓ hot wire ≤ 2 ✓ 本地 208 ✓ 释放 → 收敛 208 ✓ |

> **（第三轮勘误 · SA3 实现 deviation 登记，供 SA4 比对）** 上表三处第三笔写的示例字段名
> `{other:3}` / `{extra2:7}` **非默认 schema 合法字段**（默认 schema =
> `type ROOT = { n: number; ext?: number; extra?: number; }`，harness SCHEMA_ENVELOPE）——
> SA3（commit 34bbfba）以 schema 合法字段名 **`ext`** 落盘 ac6 / F1 / ⑧a 的 w3 适配（设计
> 示例名仅为示意载体）。语义等价论证：第三笔写的作用 = 把 queued 推到 `≥ maxQueuedUpdateCount`
> 触发溢出，载体字段名不参与任何被断言的语义（溢出边界 / RESYNC 声明 / round 修复 / fence
> 流程均与字段名无关）；收敛断言中相应值断言（如 hub `ext` 字段）随实现同步。§12 ALLOW 对应
> 三条目的说明文字以本注为准。

---

## §5. R2-4 设计决策：`controlReserveBytes` 独立契约面

### §5.1 契约面四点改动（SA6 冻结名；SA8 注记 ① 全程遵守）

| 文件 | 改动 | 内容 |
|---|---|---|
| `types.ts` | +1 字段 | `ReplicationLimits` 增 `readonly controlReserveBytes: number; // 64 KiB——control 帧独立保留额度（§17 L490）；耗尽 = CONNECTION_BACKPRESSURE`（置于 `highWater` 之后；`ResolvedLimits extends ReplicationLimits` 自动携带） |
| `defaults.ts` | +1 行 | `DEFAULT_REPLICATION_LIMITS` 增 `controlReserveBytes: 64 * 1024`（**与旧 lowWater 缺省逐值相等 ⇒ 缺省行为零漂移**，SA6 冻结建议）；`resolveLimits` spread 自动生效 |
| `validate.ts` | +1 行 | `validateLimits` 增 `positiveSafeInteger(limits.controlReserveBytes, 'controlReserveBytes');`——构造期响亮 TypeError，**不运行时 clamp**（§17 L494–506 字面）。不加跨字段约束（无协议依据：额度与水位量纲独立，reserve 可大于/小于 highWater 均合法） |
| `backpressure.ts` | 1 处判据 + 注释 | `sendControl` 耗尽谓词 `this.controlReserveUsed + frameBytes > this.host.limits.lowWater` → `> this.host.limits.controlReserveBytes`。**谓词形状不变**（触发帧 = 首个会越界的帧，round-1 §4.3 R2 钉死保持）；`observeWater` 的 `lowWater` 两处读取（:172/:198）**保留**——那正是 §17 L492 恢复 dequeue 的水位迟滞语义，与额度无关 |

### §5.2 lowWater 语义收窄声明（设计登记）

修复后 `lowWater` 的**全部**运行时语义 = ① 暂停段恢复判据（`level ≤ lowWater` → resume +
drain，backpressure.ts:172）② poll 到期再检查阈值（:198）——与协议 §17 L492 逐字对齐。
「暂停段 control 容量」语义整体迁移到 `controlReserveBytes`。round-1 §4.3「额度 = lowWater
字节」段与「合法极端配置登记」（lowWater=1 → 首控制帧即 1011）随之**作废**，等价形态改由
`controlReserveBytes=1` 表达（D3a 适配即此，§5.4）。

### §5.3 缺省零漂移论证

`controlReserveBytes` 缺省 64 KiB == 旧判据 `lowWater` 缺省 64 KiB（defaults.ts:25）⇒ 未覆写
任一字段的配置（绝大多数用例与生产缺省）耗尽谓词数值恒等，行为逐帧零变化。受影响面 =
**仅覆写了 lowWater 且依赖额度行为的测试**：D3a（lowWater=1）、D3c（lowWater=100）——§5.4
适配；ac7-faults:216（lowWater=256 仅构造）不受影响；R2-4 两条红灯显式传新字段。

### §5.4 既有测试与镜像适配（登记于 ALLOW，各 1–3 行）

| 文件 | 适配 | 说明 |
|---|---|---|
| `ws-replication-sa7-issue137-dynamic.test.ts` D3a | limits 增 `controlReserveBytes: 1`（lowWater:1/highWater:2 保留——水位迟滞语义原样） | 首个 ACK 帧字节 > 1 ⇒ 耗尽 → 1011 + backoff：与原 lowWater=1 语义逐帧等价，全部断言原样通过 |
| 同文件 D3c | limits 增 `controlReserveBytes: 100`（lowWater:100/highWater:200 保留） | `allowed = floor(100/ackBytes)` 数值不变（实测 ackBytes=57B ⇒ allowed=1，与旧 lowWater=100 数值恒等——SA2 复核确认），谓词锚换成新字段；断言消息/标题中 lowWater 措辞同步（~3 处字符串） |
| 同文件 D3b | **零改动** | 缺省 64KiB 额度 == 旧缺省 lowWater——BOOTSTRAP_SNAPSHOT ~90KB 首帧即耗尽行为不变（注释中「lowWater=64KiB 缺省」措辞可顺带改为 controlReserveBytes，非必须） |
| `ws-replication-api.test-d.ts:124-135` | 形状断言对象增 `readonly controlReserveBytes: number;`（1 行） | `toMatchTypeOf` 为单向结构匹配——不加也绿（11 字段可赋给 10 字段形状）；加上以保持「契约面 pin 完整」的文件立意（该文件的存在目的） |
| `test/harness.ts` | `WsReplicationLimits` 镜像接口 +1 字段；`CONTRACT_LIMITS` +`controlReserveBytes: 64 * 1024`（共 2 行） | 文件头立意「与包 DEFAULT_* 逐值一致」；无运行时断言依赖（grep 证实 CONTRACT_LIMITS 无测试比对消费），纯镜像同步 |
| r2-red 测试 | **恰 1 处守卫修订**（R2 勘误 N1——原「零改动」表述与 §5.6/§9-6a/§12/§14/验收表五处登记矛盾，对齐口径）：R2-4（生效）末段数据面守卫按 §5.6 钉死形态修订（SA6 域执行，需总控 dispatch） | 其余 7 用例与全部构造零触碰；`as Partial<ReplicationLimits>` 双处 cast 在类型增字段后成为冗余但合法，不属守卫修订面、原样保留 |

### §5.5 耗尽动作零改动声明

`onBackpressureExhausted` 两实现（peer `failConnectionBackpressure`：豁免 ERROR 直发 +
close(1011) + onTemporaryFailure→backoff；hub `connectionFatal('CONNECTION_BACKPRESSURE',
1011)`）**逐字不动**——R2-4 只换额度来源。R2-4（生效）红灯的耗尽面断言（ERROR×1 + 1011 +
backoff）由既有机制在新阈值下产出；**（R2 勘误，SA2 #1）**其数据面守卫「hub n === K」在耗尽
语义下结构性不可满足（连接于第 27 个 ACK 死亡 ⇒ hub 应用上界 35 < 40）——守卫修订见 §5.6。

### §5.6 R2-4（生效）红灯末段守卫修订（R2 新增——SA6 域依赖，本设计钉死形态）

**【依赖登记】** r2-red `R2-4 (生效)` 用例末段守卫 `expect(run.rootValue('hub', a, 'n')).toBe(K)`
（:419）在**任何满足其前置断言（1011 + backoff + ERROR×1）的实现下均不可满足**——SA2 攻击点
#1 实测推演成立，本设计 §8 原走查「hub n=40 ✓」为错误自证（把「逐帧 apply 先于 ACK」混同
「全部 K 笔已应用」）。该守卫**必须由 SA6 修订**（[SA6 owned] 文件，需总控 dispatch；属测试锚
修正而非软化断言）；R2-D6 登记（relevant_decisions）的「r2-red 零改动」子项随之作废，
其余子项维持。

**结构性不可满足的定量依据（实测）**：UPDATE_ACK 帧 = **57 字节**（20B 定长 envelope +
1B nsId 长度前缀 + 35B `ns-`+32hex + 1B varuint ackedSequence，本场景 ackedSequence < 128
恒 57B——SA2 tsx 实测，非估算）。`controlReserveBytes=1500` ⇒ `allowed = floor(1500/57) = 26`
（26×57=1482 ≤ 1500；1482+57=1539 > 1500）⇒ **第 27 个 ACK 触发 connectionFatal**：ERROR×1 +
close(1011) + peer backoff。死亡时刻：apply 1..27 已完成（apply 先于 ACK 发射，
hub-namespace.ts:695-711）；peer 已发送帧 = 8（首窗直发）+ 26（每 ACK 回收一窗位、drain 补发
一笔——窗口算术硬约束）≤ 34；**（R2 勘误 N2）** makeEnd.send 为 **queueMicrotask 延迟投递**
（harness.ts makeEnd——非同步，SA2 R2 复审实证），在途帧是否赶在 closedFlag 置位前 dispatch
属微任务交错非确定：赶及者由 `onConnectionClosed → drainPendingApplies`
（hub-namespace.ts:561-567 → :814 `await Promise.allSettled([...pendingApplies])`）**补完应用**，
未赶及者被 `onMessage` 首行 closedFlag 守卫丢弃——两分支均落界内；其余 ≥6 笔（40 − 已发送）
滞留 peer 未发送队列，连接 teardown 时丢弃（update-channel.ts:228-234）；重连需 backoff timer
推进而用例零 `advanceBy` ⇒ 测试期内不可达。⇒ **hub n ∈ [27, 34]**（上界由发送侧窗口算术
保证、与投递时序无关；恒 ≤ allowed+1+maxInFlight = 35），`toBe(40)` 不可满足。

**钉死的修订形态（区间守卫 = SA2 红灯思路 #2 的界形态）**：

```ts
// r2-red R2-4（生效）末段守卫（SA6 修订落盘形态；既有 1011/backoff/ERROR×1/牙口元断言不动）：
const ackBytes = ackByteLength(wire0);                 // 实测 57B（>128 序列变 58B，本场景不达）
const allowed = Math.floor(1_500 / ackBytes);          // = 26
// ① 下界：触发帧所属写已应用（apply 先于 ACK：hub-namespace:695-711 ⇒ 恒 ≥ allowed+1）
expect(run.rootValue('hub', a, 'n')).toBeGreaterThanOrEqual(allowed + 1);
// ② 上界：连接死亡截断界——发送 ≤ ACKed(26) + 首窗(8)（一 ACK 一发的窗口算术），
//    在途经 drainPendingApplies(:814) 补完 ⇒ 恒 ≤ allowed + 1 + maxInFlightUpdates（=35）
expect(run.rootValue('hub', a, 'n')).toBeLessThanOrEqual(allowed + 1 + 8);
// ③ 本地完备性：K 笔全本地接受——「不阻塞 sequencer」的可满足守卫
expect(run.rootValue('peer', a, 'n')).toBe(K);         // = 40
```

**为何不采 SA2 选项 A 的精确 `toBe(allowed + 1)`（源码级反证）**：选项 A 假设死亡时刻的
在途残差不计入 hub n——但 `drainPendingApplies`（:814 allSettled）**必然补完在途应用**，
且一 ACK 一发的窗口算术使在途残差可达 7 笔（赶及 dispatch 者经 drainPendingApplies 补完）
⇒ hub n 可达上界 34 > 27、终值非确定，精确 `toBe(27)` 将再次
不可满足/闪烁（恰是 SA2 #1 否决的原守卫同类缺陷：断言值与耗尽语义的死亡截断矛盾）。
终值的精确取值还依赖「测试循环发满 40 笔」与「apply 链推进」的微任务交错（issued-at-fatal
非确定）⇒ 任何精确 toBe 都不可钉。区间形态是 SA2 评审报告自身给出的界
（推演步骤 4「hub n ∈ [27,35]」+ 红灯思路 #2「断言 `hub n ≤ allowed+1+maxInFlightUpdates`
且 `≥ allowed+1`——把『连接死亡截断数据面』的界钉死，防止后续再以全量收敛写守卫」）——
本设计逐字采纳其 published 界形态。**非软化论证**：修订后守卫仍钉死三件事——下界（数据面
在死亡前至少推进到触发写：额度耗尽不阻塞 apply）、上界（死亡截断：全量收敛守卫永久不可
回归）、本地完备（K 笔全接受：sequencer 不受控）。SA2 红灯思路 #2 原设想的独立非冻结 IT
（同构造钉界）被本修订吸收进冻结用例本身——更强，无需另落。

**（非阻断建议，随 SA6 修订一并考虑；**第三轮勘误落文见下**）** SA2 红灯思路 #4：直发路径
响亮收口 IT（live + 窗口有空位 + 队列空 + 单笔超限直发）——现无既有测试覆盖边界 #4 的
新行为面（grep 实证全量超限构造均经队列路径），补一条防将来形状漂移；属可选加固，
不列 ALLOW（若 SA6 采纳则随其文件域落盘）。

**（第三轮勘误，2026-08-30 · SA3 实现 commit 34bbfba 实测实证——本段原建议的守卫形态
部分错误）** 原建议文本「→ RESYNC_REQUIRED ≥ 1 + state needs-resync」中的**瞬时 state
快照断言不可满足**：§2.2 收口规则（队列空 ⇒ declareLocalResync）经 peer-namespace.ts:697-707
立即触发 maybeStartRecovery（直发路径 inFlight=0、无 round ⇒ 同步开恢复 round），round 全链
（RESYNC_REQUIRED → SYNC_STEP1 → SYNC_STEP2 → SYNC_APPLIED）在 settle() 预算内完成 ⇒
断言时刻 state **恒为 'live'**（SA3 4 次复跑 + 10-tick trace 确定性一致）——与 §5.6 冻结守卫
勘误同类的「断言与修复语义矛盾」（收口动作自身驱动的恢复使瞬态不可观察）。**钉死的正确
契约形态**：`RESYNC_REQUIRED ≥ 1`（核心红灯锚，不动）+ 本地已接受保留（`peer blurb === BIG`）
+ `connectionState === 'ready'` + **`hub blurb === BIG` 收敛**（② 分支更强形态——直发收口后
恢复 round 同步完成的确定性使 ② 恒可达，与队列路径 R2-1 冻结契约「① 显式收口 或 ② 收敛」
二选一形态对齐）；**删除瞬时 state 快照断言**（needs-resync 是恢复 round 的瞬态而非可观察
终态）。SA6 正并行修订该守卫，本登记为其契约依据。

---

## §6. R2-5：对抗流量覆盖缺口——落盘即修复（零 src 改动）

- **结论**：RR 公平轮转（round-1 §4.5：wheel 每轮每 ns 至多一帧 + 有界队列 + 三层上限）已满足
  no-starvation / bounded-memory 语义；SA6 实测直绿（14ms）。缺口是**覆盖缺失**而非实现缺陷，
  简报验收第 2 条字面授权「落盘即修复」。
- **设计对应关系**（SA4/SA7 复查锚）：no-starvation = round-1 §4.5 无饥饿论证（每 ns 每轮必访，
  跳过仅因自身窗口/round 进度）；bounded-memory = §11.3 三层上限（per-ns inFlight×max +
  queued ≤ maxQueuedUpdateBytes/Count；连接 Σ ≤ cap；control ≤ reserve）；「不阻塞 Runtime
  sequencer」= §11.2 结构保证（本 地写全接受，R2-5 阶段 2 断言 peer n=208）。
- **R2-3 交互**：R2-5 阶段 2 的溢出触发点因判据修正后移两笔（§4.3 表）——仍在对抗窗口内，
  断言全过；溢出后的 bounded-memory 信号（停发 + needs-resync + RESYNC）语义不变。

---

## §7. 修复间交互与全局一致性

1. **R2-1 × R2-3**：超限项按原始字节入账（入队无大小门，round-1 §5）——R2-3 修的是 count/bytes
   判据的基数，不含大小面；超限项占用 queued 名额/字节直至被 F4 消费，账务口径不变。
2. **R2-1 × R2-2**：uint32 耗尽 → OutboundExhaustedError 被 sendUpdateFrame catch 收敛 seq≤0
   → 非超限原因 F4（sendAndRegister 后段）；此刻连接已被 onSequenceExhausted 收口
   （R2-2 修复后：close 1008 + blocked/closed），通道 teardown 置 needsResync
   （update-channel.ts:228-234）——两修复正交，无双重收口面。
3. **R2-4 × R2-1/R2-3**：额度域（control 出站字节）与 data 队列域（queued count/bytes）分列，
   与 §17 L479-490 逐条对应；收口动作各自独立（1011 分类失败 vs per-ns resync）。
4. **两级队列属主**：全部修复位于 UpdateChannel/ConnectionSender/连接层——`namespace-registry`
   fanout 队列零触碰（R0-2）；R2-1 的 needsResync 是 ws-replication 通道级标记（非 sticky、
   round 后回 live），与 session 域 `status.needsResync`（sticky）分属两套语义（round-1 §3.2
   对账表继续有效）。
5. **状态机/wire 面**：零新状态、零迁移矩阵改动、零新消息码/错误码/reasonCode——R0-1 维持。

---

## §8. 七红灯转绿走查（设计自证）

**R2-1**：窗口 1、`maxUpdateBytes=8192`、n=2 在途（saveGate 扣）→ BIG(20KB) 入队（count 1≤100、
bytes 20KB≤1MB；state live ✓ 前置守卫）。释放 → ACK(n=2) → onAck → requestDataDrain →
pullAndSendOne：前置全过 → takeItems 单项 BIG → sendAndRegister 前置判别：20KB > 8192 且
`queued.length===0` ⇒ **响亮收口**：needsResync + declareLocalResync → RESYNC_REQUIRED
{send-queue-overflow} 上 wire（连接 ready、无压力、sender.sendControl 直通）→ 红灯 ①满足
（tryUntil 立即 true）；maybeStartRecovery（inFlight=0、无 round）→ reconciling → r2
Step1/Step2（hub 缺 BIG，diff ~20KB ≤ maxSyncDiffBytes 2MiB 缺省）→ hub blurb=BIG → ②亦满足。
本地 blurb=BIG 全程保留 ✓ 零 unhandled ✓。

**R2-2 (peer)**：拨 lastSeq=0xfffffffe → 写 n=5 → UPDATE seq=0xffffffff（drop 隔离）→ 写 n=6 →
emitOne 检查 `lastSeq >= 0xffffffff` → throw → onSequenceExhausted（R2-2 后）：**零出站帧** →
close(1008) → enterBlocked（含 sender.teardown）。timeline：…UPDATE(0xffffffff] 严格递增 ✓
零 ERROR ✓ closed ✓ blocked ✓。

**R2-2 (hub)**：对称（hub sender.teardown 先行 → close(1008) → closedFlag/closed/cleanupAll）✓。

**R2-3 (count)**：8 gates 扣 8 笔在途 → 第 9 写：`queued(0) ≥ 8`? 否；bytes 0+~1.3KB ≤ 1MiB →
入队 → state live ✓ 零 RESYNC ✓ ready ✓。释放 → ACK×8 → drain → 第 9 笔发出 → hub n=9 收敛 ✓
全程零 resync ✓。

**R2-3 (bytes)**：8×~1.3KB 在途；第 9 写：`queuedByteCount(0)+1.3KB ≤ 5,000` → 入队 → live ✓；
释放 → 收敛 LAST ✓ 零 resync ✓。

**R2-4 (独立性)**：pressure 3,000 > highWater 2,000 → hub 暂停段；40 笔写 → 40 个 UPDATE_ACK
（control，不被闸门阻塞；实测帧长 57B）：`used + 57B > controlReserveBytes(64,000)`?
40×57 = 2,280 < 64,000 恒否 → 全部放行 → ready ✓ 零 ERROR ✓ 40 ACK ✓ hub n=40 ✓ 单 wire ✓
（牙口元断言 2,280 ∈ (512, 64,000) ✓——旧实现 ceiling=lowWater=512：8×57=456 ≤ 512、
456+57=513 > 512 ⇒ 第 9 个 ACK 即耗尽 → 1011——红灯原貌）。

**R2-4 (生效)**（**R2 修订，SA2 #1——原走查「hub n=40 ✓」为错误自证，已重算**）：
pressure 150,000 > highWater 100,000 → 暂停段；实测 ACK = 57B ⇒ allowed = floor(1500/57) = 26
（26×57 = 1482 ≤ 1500；1482+57 = 1539 > 1500）⇒ **第 27 个 ACK 触发耗尽**：hub
connectionFatal → 豁免 ERROR(CONNECTION_BACKPRESSURE) 直发 + close(1011) → peer onClose 1011
→ temporary → backoff ✓；ERROR×1 ✓ 1011 ✓（旧实现 ceiling=lowWater=64,000 → 2,280 不耗尽、
state ready——红灯原貌）。**数据面终局（死亡截断）**：apply 1..27 先于各自 ACK 完成；peer
发送 = 8（首窗）+ 26（一 ACK 一发）≤ 34 帧（**R2 勘误 N2**：makeEnd.send 为 queueMicrotask
延迟投递，在途帧赶及 closedFlag 前 dispatch 者经 drainPendingApplies（:814）补完、未赶及者被
onMessage 守卫丢弃——两分支均界内）；余 ≥6 笔 peer 队列丢弃、重连零推进不可达 ⇒
**hub n ∈ [27, 34]，恒满足区间守卫 allowed+1 ≤ hub n ≤ allowed+1+maxInFlight（=35）**——
原守卫 `toBe(40)` 不可满足，SA6 按本设计 §5.6 钉死的区间守卫修订（`≥ allowed+1` ∧
`≤ allowed+1+8` ∧ `peer n === K`）。

**R2-5**：直绿（RR + 有界队列已满足；§6 对应关系），随修复套件保持绿（§4.3 走查）。

---

## §9. 回归面分析（既有 14 文件 / 94 测试）

| # | 文件 | 处置 | 论证 |
|---|---|---|---|
| 1 | `ws-replication-ac6-resync-close.test.ts` | **适配**（+1 写 +注释，§4.3） | 溢出边界后移一笔；AC6 语义（声明/round 修复）保持 |
| 2 | `ws-replication-sa4-f1-f2-f3-red.test.ts` | **适配**（F1 +1 写） | 同上；F2/F3 零触及 |
| 3 | `ws-replication-r3-r4-regressions.test.ts` | **适配**（⑧a +1 写） | ⑦（窗口 2/队列 100）零触及；fence 流程不变 |
| 4 | `ws-replication-sa7-issue137-dynamic.test.ts` | **适配**（D3a/D3c 各 +1 行 limits；§5.4） | D3b/D4/D5/D6/E5 零触及（D3b 缺省零漂移；D4 = §2.3 钉死保持） |
| 5 | `ws-replication-api.test-d.ts` | **适配**（+1 行形状） | toMatchTypeOf 单向匹配本可不改；补齐契约 pin |
| 6 | `test/harness.ts` | **适配**（镜像 +2 行） | 无运行时依赖，纯同步 |
| 6a（R2 修订，SA2 #1） | `ws-replication-issue137-r2-red.test.ts`（本轮红灯，[SA6 owned]） | **SA6 守卫修订**（恰 1 处：R2-4（生效）末段数据面守卫，§5.6） | 原守卫 `hub n === K(40)` 被其自身前置断言（1011/backoff/ERROR×1 ⇒ 连接第 27 个 ACK 死亡）结构性否决，hub 应用上界 35 < 40；修订 = 区间守卫（`≥ allowed+1` ∧ `≤ allowed+1+maxInFlight` ∧ `peer n === K`）——测试锚修正而非软化（三重钉死：死亡前数据面至少推进到触发写 / 死亡截断界 / 本地完备），SA6 域执行（需总控 dispatch）；其余 7 用例零触及 |
| 7 | `ws-replication-ac1-ac7-red.test.ts` / `ac5-live` / `ac7-faults` / `driver.ts` / `issue137-driver.ts` | 零触及 | §1.3-4 逐项论证（窗口/队列配置不达新边界；构造面测试不受缺省增字段影响——resolveLimits spread） |
| 8 | 其余（sa6 既有 ac 套件、metrics/handshake 等 14 文件中未列者） | 零触及 | 无 maxQueuedUpdateCount/lowWater 依赖；R2-2/R2-4 修复面（耗尽路径/暂停段额度）在缺省配置下行为恒等 |
| 9 | src 侧 | 仅 §12 ALLOW 五文件 + 配置三文件 | R2-1 收口点在 drain 同步栈内、declareLocalResync 记忆化——无帧序/序列面变化（RESYNC_REQUIRED 是 control 帧，序列由 OutboundQueue 单点分配，插入不破坏「交付序 = 序列序」——round-1 §4.1 序列纪律论证适用） |

**风险自查**：R2-1 收口新引入一个 wire 可观察变化 = 队尾超限丢弃时多 1 帧 RESYNC_REQUIRED +
state 短暂 needs-resync（旧：零帧恒 live）——与 AC6/F1 既有溢出声明同族（同帧型同 reasonCode），
无既有断言计数「零 RESYNC」的用例处于该形态（grep resyncsOf/RESYNC_REQUIRED 断言：均出现在
「预期有 resync」或「无溢出」场景；R2-3 两条红灯断零 RESYNC 的场景在新判据下不溢出 ⇒ 不触发
R2-1 收口——超限面不存在）。

---

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/类型

| 对象 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `ReplicationLimits`（公共类型） | `packages/ws-replication/src/types.ts:18-29` | 10 字段 | **11 字段**（+`controlReserveBytes: number`，必填） |
| `DEFAULT_REPLICATION_LIMITS`（公共常量） | `packages/ws-replication/src/defaults.ts:16-27` | 10 值 | 11 值（+64*1024） |
| `UpdateChannel.overflows`（私有） | `update-channel.ts:124-130` | pending 含 in-flight | 只计 queued（§4.1） |
| `UpdateChannel.sendAndRegister`（私有） | `update-channel.ts:137-142` | seq≤0 一律静默 F4 | 超限+队尾 ⇒ 响亮收口（§2.2） |
| `onSequenceExhausted`（私有） | peer:478 / hub:413 | ERROR 直发 + close(1008) | 仅 close(1008)，零出站帧（§3） |

**SA4 §1.5 五类触发（return→throw / Promise 形态 / 同步变异步 / catch 重抛 / 可空性翻转）：
零命中**——全部改动是私有方法内部行为与类型增量。但 `ReplicationLimits` 是公共冻结面字段
**新增**，按立法精神列全消费方：

### 消费方清单（`git grep ReplicationLimits` 全仓 = 仅 ws-replication 包内 + 测试；包外零消费）

| 消费方 | 位置 | 消费形态 | 是否需要适配 |
|---|---|---|---|
| `resolveLimits` | defaults.ts:47-49 | spread 合并——新字段自动带缺省 | 否（自动） |
| `validateLimits` | validate.ts:103-142 | 逐字段校验 | **是**（+1 行，§5.1） |
| `ConnectionSender`（额度判据） | backpressure.ts:79 | `limits.lowWater` → `limits.controlReserveBytes` | **是**（1 处） |
| `ConnectionSender`（水位迟滞） | backpressure.ts:172,198 | `limits.lowWater` 保留 | 否 |
| `UpdateChannel` / 控制器 / frame-io / round 引擎 | 各文件经 `ResolvedLimits`/`host.limits` 读既有字段 | 只读既有 10 字段 | 否 |
| `index.ts` 类型 re-export | index.ts:19 | `export type { ReplicationLimits }` | 否（接口增量自动导出） |
| 测试 driver `limits` 参数 | driver.ts:123 / issue137-driver.ts:52 / sa7-dynamic:653 | `Readonly<Partial<ReplicationLimits>>` | 否（Partial 增量兼容；r2-red 的 cast 转为冗余合法） |
| harness 镜像 | harness.ts:42-53,126-137 | 本地 `WsReplicationLimits`（独立接口） | 否（编译无依赖；按文件立意同步，§5.4） |
| 构造侧穷举字面量 | 仅 `DEFAULT_REPLICATION_LIMITS` 一处（全仓 grep 证实） | 必填新字段 | **是**（defaults.ts +1 行） |

### 风险评估

- 增字段是**纯增量**：外部按 `Partial<ReplicationLimits>` 传参的既有调用零影响；按完整对象
  穷举构造的只有 DEFAULT_REPLICATION_LIMITS（已同步）。漏配 `controlReserveBytes` 的完整对象
  字面量会被 tsc 结构检查捕获（必填字段）——编译期封闭，无运行时 undefined 面。

---

## §11. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| P-1（继承） | transport `bufferedAmount` number 属性 / 缺失=0 | 源码+测试引用 | round-1 §12 P-1（issue137-driver.ts:120-125 + WHATWG API）；本轮零 transport 面改动 | 低 |
| P-2（继承） | fake scheduler `advanceBy` 到期触发 | 源码引用 | round-1 §12 P-2（namespace-registry/src/testing.ts:92-107） | 低 |
| P-3（继承） | close 1011 → peer 临时失败 backoff | 源码引用 | peer-connection.ts:499-510（仅 1002/1008 → blocked） | 低 |
| P-4（继承） | `CONNECTION_BACKPRESSURE` 注册条目 1011/retryable | 源码引用 | replication-protocol/src/errors.ts:27,108 | 低 |
| P-5（继承） | saveGates 到达序消费 | 测试引用 | harness.ts:403-408 | 低 |
| P-6（继承+扩展） | `Y.mergeUpdates` 产物长度 ≤ Σ 输入原始字节长度 ⇒ 多项贪心帧结构性不超限 | 源码引用+设计依赖 | round-1 §5 既有依赖（贪心以累计原始字节为上界）；本轮 §2.1① 据此把超限判别收敛到单笔形态。**防御面**：即使该性质意外失效（无已知反例），sendAndRegister 入口判别对任意超限帧同样生效（队尾响亮/非队尾 F4），行为退化为 round-1 已接受族 | 低 |
| R2-A1 | R2-1 红灯场景 F4 时刻队列恰空（BIG 是最后一笔写） | 现有测试引用 | ws-replication-issue137-r2-red.test.ts:104-118（仅两笔写：n=2 在途 + BIG 入队；无后续写） | 低 |
| R2-A2 | D4 场景 F4 时刻队列非空（合法①②在后） | 现有测试引用 | ws-replication-sa7-issue137-dynamic.test.ts:444-446（BIG 后还有 delete+set 两笔合法写） | 低 |
| R2-A3 | 私态 `outbound.lastSeq` 注入可达且 timeline 记录被 drop 的帧 | 现有测试引用 | r2-red.test.ts:167/:171（`as unknown as { outbound… }` 注入 + `wire.timeline` 含 dropped 帧 :67-72）；frame-io.ts:108 `private lastSeq = 0`（运行时普通属性） | 低 |
| R2-A4 | peer `enterBlocked()` 含 sender teardown ⇒ R2-2 删 ERROR 后 peer 侧无 timer 泄漏缺口 | 源码引用 | peer-connection.ts:565-575（enterBlocked 首行 `sender?.teardown()`）；onSequenceExhausted:494 调用之 | 低 |
| R2-A5 | `UPDATE_TOO_LARGE` 注册行终态 failed ⇒ 若采纳则同连接禁重开 | 协议文本引用 | instance-replication-v1.md §13.2 L371 + §1 不变量 4 L24（relevant_decisions 摘录）——**否决路径 ③ 的依据** | 低 |
| R2-A6 | 控制帧编码长度与序列号取值无关（measureFrame 探针有效性，R2-4 判据确定性） | 源码引用 | backpressure.ts:263-273 既有注释（envelope sequence 定长 4B writeBe32）；R2-4 只换阈值来源，measure 机制不变 | 低 |
| R2-A7 | 恢复 round 的 Step2 diff 承载被弃增量（peer→hub 方向收敛） | 现有测试引用 | ws-replication-ac6-resync-close.test.ts:40-71（溢出丢弃后 hub 经 r2 diff 收敛 extra=2——与 R2-1 收口同一恢复拓扑） | 低 |
| R2-A8（R2 修订，SA2 #1） | UPDATE_ACK 帧 = 57B（本场景 ackedSequence < 128 恒定） | 设计期实测验证 | SA2 tsx 实测（评审报告附录 1：ackedSequence=7/30 → 57B、300 → 58B）；构成 = 20B 定长 envelope（envelope.ts 文件头「固定 20-byte 大端 NMCR envelope」）+ 1B nsId 长度前缀 + 35B `ns-`+32hex + 1B varuint ackedSequence。⇒ reserve=1500 时 allowed=26、reserve=100 时 allowed=1、reserve=64000 时 40 帧（2,280B）不耗尽 | 低 |
| R2-A9（R2 修订，SA2 #1） | 连接死亡时刻的在途 apply 由 hub 侧补完应用（不因 close 丢弃） | 源码引用 | hub-namespace.ts:561-567 `onConnectionClosed → drainPendingApplies` → :814 `await Promise.allSettled([...this.pendingApplies])`；:695-711 apply 先于 UPDATE_ACK 发射且 pending 入集合——帧在 closedFlag 置位前已 dispatch ⇒ 其 apply 必然落账 | 低 |
| R2-A10（R2 修订，SA2 #1；**N2 勘误修订**） | makeEnd.send 为 queueMicrotask 延迟投递（非同步）；closedFlag 置位后入站帧丢弃 | 源码引用 | harness.ts makeEnd（send → `queueMicrotask(() => { for (const listener of …peer.listeners) listener(copy); })`——SA2 R2 复审实证，本设计独立复核一致）；hub-connection.ts:184-185（`onMessage` 首行 `if (this.closedFlag) return`）+ :365-381（connectionFatal 同步置位 closedFlag 后 cleanup）——死亡时刻在途帧是否赶及 dispatch 属微任务交错非确定，但 hub n 上界由**发送侧窗口算术**保证（≤ ACKed + 首窗），与投递时序无关 | 低 |

无其余协议级假设：本轮不涉 HTTP 端点/端口/进程时序/第三方库新行为。

---

## §12. 文件清单（File Scope）——Round 2 delta

> Round-1 ALLOW 已交付（基线 58150ad）；本清单 = **本轮预期 git diff 的完整集合**（SA4 比对
> 基准）。Round-1 ALLOW 中未列于下方者 = 本轮零改动。

### ALLOW LIST

**生产代码（7 文件，其中 3 文件为 round-1 DENY 显式解除——SA8 注记 ① / review R2-4 要求）**

- `packages/ws-replication/src/update-channel.ts` — 修改（~20 行）：R2-1 sendAndRegister 超限
  判别 + 队尾响亮收口（§2.2）；R2-3 overflows 队列唯一判据（§4.1）
- `packages/ws-replication/src/backpressure.ts` — 修改（~4 行）：R2-4 sendControl 耗尽谓词换
  `limits.controlReserveBytes` + 注释（§5.1）
- `packages/ws-replication/src/peer-connection.ts` — 修改（~12 行删减）：R2-2 onSequenceExhausted
  删 0xffffffff ERROR 直发、注释改写（§3）
- `packages/ws-replication/src/hub-connection.ts` — 修改（~12 行删减）：R2-2 对称（§3）
- `packages/ws-replication/src/types.ts` — 修改（+1 字段）：**原 round-1 DENY 解除**——review
  R2-4 显式要求改配置面（SA8 注记 ① / relevant_decisions D3 推翻登记）；`ReplicationLimits`
  +`controlReserveBytes`（§5.1）
- `packages/ws-replication/src/defaults.ts` — 修改（+1 行）：同上解除；缺省 64KiB 零漂移（§5.1）
- `packages/ws-replication/src/validate.ts` — 修改（+1 行）：同上解除；构造期响亮校验、不运行时
  clamp（§5.1）

**包版本（验收第 5 条）**

- `packages/ws-replication/package.json` — 修改（1 行）：0.1.1 → 0.1.2（patch）

**测试（7 文件：1 个 [SA6 owned] 守卫修订（R2 修订，SA2 #1——解除原「零改动」冻结）+ 5 个既有
测试适配 + harness 镜像——适配理由均为 review/SA2 强制的语义修正所迫，逐条对应 R2-x）**

- `packages/ws-replication/test/ws-replication-issue137-r2-red.test.ts` — `[SA6 owned]` 本轮
  红灯验收。**（R2 修订，SA2 #1）预期恰 1 处守卫修订**：R2-4（生效）末段数据面守卫
  `toBe(K)` 结构性不可满足（§5.6 定量依据），SA6 按 §5.6 钉死形态修订为区间守卫
  （`hub n ≥ allowed+1` ∧ `hub n ≤ allowed+1+maxInFlightUpdates` ∧ `peer n === K`）——属
  **测试锚修正而非软化断言**；需总控 dispatch SA6 执行（本设计已登记依赖，R2-D6 的
  「r2-red 零改动」子项作废）；其余 7 用例与全部构造零改动
- `packages/ws-replication/test/ws-replication-ac6-resync-close.test.ts` — 修改（~4 行）：R2-3
  边界适配——溢出主用例 +1 笔写（**第三轮勘误 E2：实际以 schema 合法字段 `ext` 落盘**，
  设计示例名 `{other:3}` 非法——§4.3 表后注）+ 注释 + 可选收敛断言（§4.3）
- `packages/ws-replication/test/ws-replication-sa4-f1-f2-f3-red.test.ts` — 修改（~3 行）：R2-3
  适配——F1 +1 笔写（**同 E2：实际字段 `ext`**，示例名 `{extra2:7}` 非法）+ 注释（§4.3）
- `packages/ws-replication/test/ws-replication-r3-r4-regressions.test.ts` — 修改（~3 行）：R2-3
  适配——⑧a +1 笔写（**同 E2：实际字段 `ext`**，示例名 `{other:3}` 非法）+ 注释（§4.3）
- `packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts` — 修改（~6 行）：
  R2-4 适配——D3a/D3c limits 各 +1 行 `controlReserveBytes` + 措辞（SA6 红灯报告 §3.4 明示
  「属设计修订/SA7 适配域」）；断言逻辑零改（§5.4）
- `packages/ws-replication/test/ws-replication-api.test-d.ts` — 修改（+1 行）：R2-4 契约形状
  pin 补 `controlReserveBytes`（§5.4）
- `packages/ws-replication/test/harness.ts` — 修改（+2 行）：`[SA6 owned]`（round-1 既有标记）
  契约镜像同步——WsReplicationLimits +1 字段 / CONTRACT_LIMITS +1 值（§5.4）

### DENY LIST

- `packages/ws-replication/src/frame-io.ts` — round-1 ALLOW 已交付；本轮零改动（序列分配单点/
  emitOne 耗尽检查均不动——R2-2 修复在连接层收口）
- `packages/ws-replication/src/peer-namespace.ts` / `hub-namespace.ts` — R2-1 修复不触控制器
  （大小门保留为不可达后盾；declareLocalResync 钩子既有复用）；状态机零改动红线维持
- `packages/ws-replication/src/index.ts` — 类型 re-export 自动携带新字段，导出面零变化
- `packages/ws-replication/src/round-engine.ts` / `fence-watchdog.ts` / `lifecycle-queue.ts` /
  `error-mapping.ts` / `testing.ts` — 非本轮改动面（round-1 DENY 维持）
- `packages/replication-protocol/**` — 纯协议包（UPDATE_TOO_LARGE/CONNECTION_BACKPRESSURE 均
  既有注册条目，零新码）
- `packages/namespace-registry/**` / `packages/namespace-runtime/**` / `packages/doc-runtime/**`
  — **两级队列属主红线（R0-2/SA8 注记 ③）**：fanout 投递队列域零触碰
- `apps/**` — composition root 非本轮范围
- `docs/**` — 协议文档是裁决基准非交付物（本轮全部修复 = 向协议对齐，无文档变更需求）
- 其余 `packages/ws-replication/test/*`（非上列） — 既有套件冻结零改动

---

## §13. 风险登记（round-1 §15 的 delta 更新）

### §13.1 更新项

| # | round-1 项 | 本轮处置 |
|---|---|---|
| B-2（reserve 量化选择） | 额度域由 lowWater 迁至 `controlReserveBytes`（缺省 64KiB 不变）；风暴闭环/终止条件/backoff 收敛论证**原样有效**（数值恒等）；运维下界指导改写为「期望暂停期控制面存活 / reconcile 期 Step2 不瞬断的部署应使 `controlReserveBytes ≥ maxSyncDiffBytes`（与水位独立配置，不再连带 highWater——R2-4 修复红利：oldWater 联动 TypeError 约束解除）」 | §5.1/§5.2 |
| B-8（N-2/N-3 留痕二选一） | **定案：以实现形态为准**——N-2（onAck 触发条件形式差）维持实现形态（self-limit、纯形式差）；N-3（双读闸门微窗口）接受「F4 丢弃」为定案措辞——R2-1 修复把 F4 族语义钉死为「非队尾丢弃（D4 域）/ 队尾响亮收口（§2.2）」，「过冲 ≤1 帧发出」的旧建模正式作废 | §0.3/§2 |

### §13.2 新登记项

| # | 风险 | 缓解 | 演进位 |
|---|---|---|---|
| R2-B1 | R2-1 非队尾超限丢弃仍静默（D4 钉死域）：丢失项若不被后续写覆盖且无 round 触发，发散静默存续（round-1 B-2 R4 墓碑边界同域） | 属协议 §17「配置保证单笔必可发送」既定配置病理面；运维指导 `maxUpdateBytes ≥ 单笔真实增量（含墓碑）`（B-2 R4 维持）；红灯契约（终局静默）已收口 | 切片 10 复议：若需全形态响亮，须 D4 锚点同步修订（SA6 域）+ 引入 deferred-closure 机制（预登记，不本轮实现） |
| R2-B2 | R2-3 边界后移使「满窗口 + 满队列」的稳态积压上界增大（queued 可达 max 且另有 in-flight 满窗）——内存上界由 §11.3 三层上限覆盖，但 resync 触发延迟一笔 | §11.3 上界不变（queued ≤ maxQueuedUpdateBytes/Count 本就如此记账）；AC3 语义（溢出只丢 unsent）无变化 | 无需演进 |
| R2-B3 | R2-4 增字段后旧版本序列化配置/快照无该字段（若未来有限配置持久化面） | v1 无配置持久化（构造期 Partial 合并，缺字段走缺省 64KiB）；tsc 必填检查只作用于穷举字面量 | 出现配置持久化时补迁移注记 |

---

## §14. 输入契约逐条回应

### SA6 红灯报告 §3（对 SA1/SA3 的契约提示）

| # | SA6 提示 | 回应 | 位置 |
|---|---|---|---|
| 1 | R2-1 修复落点 + 三路径合法 + UPDATE_TOO_LARGE 终态警示 | ✅ 选 resync 路径（②），落点 sendAndRegister 单漏斗；路径 ③ 否决（终态 failed 过重 + 状态机红线）；路径 ① 可达面被覆盖 | §2.1/§2.2 |
| 2 | R2-2 = 删 0xffffffff ERROR、仅 close(1008)；断言已兼容 | ✅ 双侧对称删除，收口拓扑（blocked/closed）不变 | §3 |
| 3 | R2-3 = overflows 只计 queued + incoming | ✅ 逐字采纳（count `>=` / bytes 严格大于，边界语义钉死） | §4.1 |
| 4 | R2-4 = types/defaults/validate + sendControl 判据换 controlReserveBytes；D3a/D3c 属适配域 | ✅ 四点全落（§5.1）；D3a/D3c 适配登记（§5.4）；lowWater 收窄声明（§5.2） | §5 |
| 5 | 既有 94 零回归（baseline）+ 触碰面核对 | ✅ 逐文件勘察：6 文件适配（3×R2-3 边界 + 2×R2-4 锚 + 2 镜像/pin）+ 其余零触及论证；D4 零适配为 R2-1 形状硬约束 | §1.3/§9/§2.3 |
| 6（R2 修订，SA2 #1 冲突登记） | SA6 红灯报告 §2 R2-4「守卫（两实现均成立）：数据面不受控（hub 已应用 K=40 笔）」 | ⚠️ **该声明不成立**：守卫位于首个失败断言（1011）之后，红灯运行中从未被执行（SA2 实证）；实测 57B ⇒ 第 27 个 ACK 耗尽关连接 ⇒ hub 应用上界 35 < 40，任何合格实现下不可满足。处置 = SA6 守卫修订依赖（§5.6 钉死形态，总控 dispatch），属测试锚修正而非软化断言；红灯复现结论（旧实现早耗尽/不耗尽的原貌）不受影响 | §5.6/§8/§9-6a |

### SA8 冲突报告三条非冲突注记

| # | 注记 | 回应 | 位置 |
|---|---|---|---|
| ① | R2-4 触及配置面须登记 ALLOW 变更 + §17 L494-506 纪律（安全默认/启动响亮验证/不运行时 clamp） | ✅ types/defaults/validate 三文件 DENY 显式解除并登记理由（§12）；缺省 64KiB 零漂移 + positiveSafeInteger 构造期 TypeError + 零运行时 clamp（§5.1） | §5/§12 |
| ② | R2-1 三路径合法、选择属 SA1；若选 UPDATE_TOO_LARGE 则终态 failed 同连接禁重开 | ✅ 选 resync——不触发该约束；UPDATE_TOO_LARGE 否决理由与不可修复形态的演进位登记 | §2.1/§13.2 |
| ③ | 两级队列属主红线不得触碰 #134 已交付域 | ✅ 全部修复位于连接域；fanout 队列/namespace-registry 零触碰（DENY 明示）；通道级 needsResync（非 sticky）与 session 级 sticky 标记分属两套语义 | §7-4/§12 |

### 简报验收 6 条对照

| 验收 | 落实 |
|---|---|
| 1. R2-1~R2-4 修复各有红灯先行锚定 | ✅ SA6 7 红灯 ↔ §8 逐用例转绿走查。**（R2 修订，SA2 #1）** R2-4（生效）转绿依赖 §5.6 钉死的守卫修订（SA6 域 dispatch）——原守卫不可满足，不修订则本条不可闭合 |
| 2. R2-5 落盘即修复（直绿授权） | ✅ §6（零 src；覆盖缺口闭合） |
| 3. AC1–AC7 语义保持（语义 = 协议语义；边界按协议纠正 + 适配登记） | ✅ §4.2/§9（适配 6 文件 + r2-red 守卫修订 1 处全登记，AC3 溢出处置语义逐字不变） |
| 4. 套件全绿 + tsc + git diff --check | ✅ §9/§10（类型增量 tsc 封闭；无空白面新增） |
| 5. 最小修复 + 协议一致 + patch bump | ✅ §12（src 面加法 ~+30 行 [其中约 20 行为 R2-1 判别块与注释]、删法 ~−24 行 [两段 ERROR 直发]、判据换 1 处、配置面 3 行）；package.json 0.1.1→0.1.2 |
| 6. 禁 push/PR/label；REPORT 不 commit | ✅ 设计层声明（本轮仅产出本文档） |

---

## 修订自查

1. **delta 边界**：未重写 round-1 全文；被推翻决策（D3/D10 子项）显式登记于 §0.3 并在 §5/§12
   落实；未触及的 D1/D2/D4–D11 与 §1–§16 条款声明继续有效。
2. **关键术语全文一致**：「响亮收口」仅指 §2.2 形态（needsResync + declareLocalResync）；
   「F4」= 消费即丢弃（round-1 语义）；「额度」R2 后唯一指 `controlReserveBytes`
   （§5.2 lowWater 语义收窄声明消除混用面）；「队列」在本轮语境恒指 ws-replication 未发送
   data 队列（两级队列对账表 §7-4 维持）。
3. **与冻结契约的一致性**：8 用例逐条走查（§8）；D4/R2-5 直绿用例的保持论证（§2.3/§6）。
4. **硬门禁自检**：零 src/test 代码触碰（本文档为唯一产出）；SA6 owned 文件未入 DENY；
   协议假设/契约审计/文件清单三章节齐备（§11/§10/§12）。

---

## SA2 反馈逐条回应（R2 修订，2026-08-30）

> 报告：`wiki/raw/task_phase5-ws-multiplex-backpressure-r2_sa2_review.md`（verdict: reject；
> 1 CRITICAL + 1 MEDIUM + 4 LOW）。约束遵守：五项修复决策（R2-D1~D4 / R2-D6 适配集）经 SA2
> 独立复核确认维持，本轮零架构变更、零修复决策改动；修订集中在冻结契约可达性（守卫）、
> import 事实更正与接受性登记。

| # | SA2 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|:--:|---|---|
| 1（CRITICAL） | R2-4（生效）末段守卫 `hub n === K` 结构性不可满足（57B 实测 ⇒ allowed=26 ⇒ 第 27 ACK 耗尽关连接 ⇒ hub 上界 35 < 40）；§8 走查自证错误；§12 冻结「r2-red 零改动」使验收不可达成。修订要求：更正 §8/§12/§14 + 登记 SA6 守卫修订依赖 + 钉死修订后断言形态 | ✅ | §5.6（新章，钉死形态）+ §8（两处 R2-4 走查重算）+ §5.5 尾句勘误 + §9 行 6a + §12 r2-red 条目 + §14 表行 6 + §11 R2-A8~A10 | §8 以实测数值重算（57B / allowed=26 / 死亡于第 27 ACK / hub n ∈ [27,35]——N2 勘误后收紧为 [27,34]）；§12 解除「零改动」冻结 →「恰 1 处守卫修订（SA6 域，需总控 dispatch）」；§5.6 钉死修订形态并登记依赖。**形态 deviation 申报**：不采选项 A 的精确 `toBe(allowed+1)`，钉死为区间守卫（`hub n ≥ allowed+1` ∧ `≤ allowed+1+maxInFlightUpdates` ∧ `peer n === K`）= SA2 报告自身 published 界（推演步骤 4「hub n ∈ [27,35]」+ 红灯思路 #2 原文「断言 hub n ≤ allowed+1+maxInFlightUpdates 且 ≥ allowed+1」）；源码级反证：`drainPendingApplies`（hub-namespace:561-567→:814 allSettled）必然补完在途应用 ⇒ 残差赶及 dispatch 者计入 hub n（可达上界 34 > 27、终值非确定——N2 勘误后口径），且终值随测试循环/apply 链微任务交错非确定 ⇒ 任何精确 toBe 不可钉——落 toBe(27) 将复发同类「守卫与耗尽语义矛盾」缺陷。非软化论证成文（三重钉死） |
| 2（MEDIUM） | §3「encodeMessage import 保留」事实错误（删帧后两文件引用归零；tsconfig 无 noUnusedLocals，兜底空转） | ✅ | §3「注释/文档面」条（R2 重写） | 更正为**删除两文件 encodeMessage import**（peer-connection.ts:6 → `import type { ReplicationMessage }`；hub-connection.ts:6 删 encodeMessage 保留 selectProtocolVersion + type）；connectionErrorFrame 保留（:522/:553/:372 走 emitControl→outbound 内部编码）；登记 SA4 静态门禁：grep 两文件 encodeMessage 计数 = 0（tsc 无 noUnusedLocals，必须 grep 兜底） |
| 3（LOW） | reasonCode 复用张力（'send-queue-overflow' 与真实诱因在 wire 上不可区分）——接受，维持演进位 | ✅（接受性登记） | §2.2 reasonCode 条（R2 追注） | 登记协议依据（reasonCode 自由非空字符串，无编码违规）+ R0-1 零新枚举下受约束最优解 + slice-10 演进位（运维 metrics 区分诱因） |
| 4（LOW） | close 1008 灰区（sequence 类错误 §14 粗分类更贴 1002）——接受，无动作 | ✅（接受性登记） | 本表 | 预存灰区（round-1 已接受映射），delta 外；本轮只删帧不改码维持 |
| 5（LOW） | §2.3「队列非空 = 承载未来的 reconciliation 触发面」言过其实——健康 live 连接无保证触发的 reconciliation，非队尾丢弃可无限期静默；应向 R2-B1 措辞对齐 | ✅ | §2.3「语义辩护」条（R2 重写） | 删除「保证触发」表述，明示健康 live 连接上**不存在保证触发的 reconciliation**、非队尾丢弃可无限期静默存续；合法性依据收窄为两条（D4 冻结契约钉死 + 协议无发送侧超限强制条款）；该残余面显式归属 §13.2 R2-B1（已接受风险，非修复保证） |
| 6（LOW） | 公共契约 +必填字段按 semver 更贴 minor；patch bump 系简报验收第 5 条明文 | ✅（接受性登记） | 本表 | 简报强制 + §10 审计闭合（包外零消费、穷举字面量仅 DEFAULT 一处）⇒ 现实破坏面为零，维持 patch（0.1.1→0.1.2） |

**R2 修订自查**：① 本轮 12 处落文（文件头横幅 / §2.2 / §2.3 / §3 / §5.4 / §5.5 尾句 / §5.6 新章 /
§8 两行 / §9 行 6a / §11 三行 / §12 两处 / §14 行 6）+ 本表，全部为走查更正、依赖登记、形态钉死
与接受性登记——零修复决策变更（R2-D1~D4 原文未动）；② 关键数值全文一致：「57B / allowed=26 /
第 27 ACK / hub n ∈ [27,35]」在 §5.5/§5.6/§8/§9/§11 五处同口径（N2 勘误后统一收紧为 [27,34]，见文末勘误节）；「区间守卫三断言」在 §5.6/§9/§12
三处同形态；③ 偏差申报单点成文（回应表 #1）：对 SA2 选项 A 的 deviation 以源码证据
（drainPendingApplies/R2-A9 + 交错非确定性）+ SA2 自身 published 界（思路 #2）双重支撑，
无隐瞒；④ SA4/SA7 消费锚已内嵌：§3 grep 门禁（#2）、§5.6 钉死形态（#1）、§11 R2-A8~A10 依据锚。

---

## R2 复审勘误落文（N1/N2，2026-08-30 · SA2 R2 复审 verdict: pass 附非阻断勘误）

> 复审结论 pass、修复决策零改动；本节落文两项文字勘误，全文口径随之闭合。

| # | 勘误内容 | 落文位置 | 修订摘要 |
|---|---|---|---|
| N1（MEDIUM） | §5.4 适配表 r2-red 行仍写「零改动/断言与构造零触碰」，与 §5.6/§9-6a/§12/§14/验收表五处「恰 1 处守卫修订」登记矛盾 | §5.4 末行 | 改为「恰 1 处守卫修订（§5.6 钉死形态，SA6 域执行）；其余 7 用例与构造零触碰；双处 cast 冗余合法、不属修订面」——六处同口径 |
| N2（LOW） | 「makeWire 同步投递」「hub n 典型 34」不准：makeEnd.send 实为 queueMicrotask 延迟投递；在途帧是否赶及 closedFlag 前 dispatch 非确定，hub n ∈ [27,34] 终值非确定；上界由发送侧窗口算术保证（与投递时序解耦——结论不受影响，区间守卫的界论证反而更强） | §5.6（定量依据段 + 选项 A 反证段）+ §8（数据面终局段）+ §11 R2-A10 + 回应表 #1 | 「同步投递」→「queueMicrotask 延迟投递（SA2 R2 复审实证，本设计独立复核 harness.ts makeEnd 一致）」；「典型值 34」→「可达上界 34、终值非确定」；结论区间统一为「hub n ∈ [27,34]，恒满足 ≤ allowed+1+maxInFlight(=35)」——SA4/SA7 验证锚定区间界而非「典型 34」 |

---

## 实现期勘误落文（E1~E3，2026-08-30 · SA3 commit 34bbfba 实测反馈）

> 触发：SA3 实现后实测实证——§5.6 末段建议的 R2-1（直发）IT 守卫形态部分错误（「断言与
> 修复语义矛盾」类，同 §5.6 冻结守卫勘误先例的第三轮）；另登记两处实现层 deviation 供 SA4
> 比对。修复决策零改动（§2.2 收口规则 / §4.1 判据 / §5.1 契约面均不受影响）。

| # | 勘误/偏差内容 | 落文位置 | 修订摘要 |
|---|---|---|---|
| E1（MEDIUM · 断言形态勘误） | §5.6 末段建议的直发 IT 守卫「RESYNC_REQUIRED ≥ 1 + **state needs-resync**」中，瞬时 state 快照断言不可满足：§2.2 收口（队列空 ⇒ declareLocalResync）经 peer-namespace.ts:697-707 立即触发 maybeStartRecovery（直发路径 inFlight=0、无 round ⇒ 同步开恢复 round），round 全链在 settle() 预算内完成 ⇒ 断言时刻恒 'live'（SA3 4 次复跑 + 10-tick trace 确定性一致） | §5.6 末段（勘误块）+ §2.4 边界矩阵 #4 行 | 钉死正确契约形态：`RESYNC_REQUIRED ≥ 1`（核心红灯锚，不动）+ 本地已接受保留（peer blurb === BIG）+ `connectionState === 'ready'` + **`hub blurb === BIG` 收敛**（② 分支更强形态——直发收口后恢复 round 同步完成的确定性使 ② 恒可达，与队列路径 R2-1 冻结契约「① 显式收口 或 ② 收敛」二选一形态对齐）；**删除瞬时 state 快照断言**（needs-resync 是恢复 round 的瞬态而非可观察终态）。SA6 并行修订该守卫，本登记为其契约依据 |
| E2（LOW · deviation 登记） | §4.3 数值走查建议的第三笔写字段名 `{other:3}` / `{extra2:7}` 非默认 schema 合法字段（默认 schema = `type ROOT = { n: number; ext?: number; extra?: number; }`，harness SCHEMA_ENVELOPE）——SA3 以 schema 合法字段名 **`ext`** 落盘 ac6 / F1 / ⑧a 三处 w3 适配 | §4.3 表后注 + §12 对应条目说明以注为准 | 语义等价论证：第三笔写的作用 = 把 queued 推到 ≥ maxQueuedUpdateCount 触发溢出，载体字段名不参与任何被断言语义（溢出边界 / RESYNC 声明 / round 修复 / fence 流程与字段名无关）；收敛值断言随实现同步到 `ext`。设计示例名仅为示意载体，非契约 |
| E3（LOW · deviation 登记 + 门禁扩展） | §3 原指示「仅删 encodeMessage」之外的同类死 import：peer-connection.ts 的 `codecFieldLimits` 唯一调用（:485，删除块内）随 R2-2 删帧归零——SA3 随 encodeMessage 一并删除；hub-connection.ts 的 `codecFieldLimits` **保留**（:279 `namespaceFieldViolation(message, codecFieldLimits(...))` 仍在用） | §3「SA4 静态门禁登记」条（追注） | 本设计独立复核（SA3 后源码 grep）：peer-connection encodeMessage=0 ∧ codecFieldLimits=0 ✓；hub-connection encodeMessage=0 ∧ codecFieldLimits=2（import+调用）✓。**SA4 grep 门禁扩展**：peer-connection `encodeMessage=0 ∧ codecFieldLimits=0`；hub-connection `encodeMessage=0 ∧ codecFieldLimits≥1`（import 保留且在用） |

**落文自查**：① 三项均为文字勘误/deviation 登记，零修复决策变更；② E1 的正确契约形态与
队列路径 R2-1 冻结契约（§1.2「① 显式收口 或 ② 收敛」）形态对齐，无新语义；③ E2/E3 的
deviation 论证均附独立复核证据（schema 字段面 / grep 计数），SA4 可直接比对；④ 全文口径：
「直发 IT 正确契约」在横幅 / §2.4#4 / §5.6 末段 / 本节四处同形态。
