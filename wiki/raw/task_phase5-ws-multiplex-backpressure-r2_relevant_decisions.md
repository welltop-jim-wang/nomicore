# 相关决议 (Relevant Decisions) — 全链 SA 复用（Revision Round 2，delta）

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_phase5-ws-multiplex-backpressure-r2.md`（issue #137 round 2，Bug 修复修订轮：5 个协议一致性缺陷 R2-1~R2-4 + 1 项测试覆盖缺口 R2-5）。
> 本文档是 **delta 文档**：round 1 全量约束清单见 `wiki/raw/task_phase5-ws-multiplex-backpressure_relevant_decisions.md`（ADR 全集 `docs/adr/0001`–`0010` 逐个全量读取 + CONTEXT.md + phase-5 规格 + 协议 v1 全书），本轮只增量摘录 R2-1~R2-5 新触及的条款；round 1 已摘录的条款仍全部有效、继续约束本轮。
> 摘录范围：ADR 全集（本轮重读 10/10）+ `CONTEXT.md` + `docs/protocols/instance-replication-v1.md`（ADR 0010 L151 指定的唯一 wire contract，具 ADR 级约束力）+ `docs/phases/phase-5-websocket-replication.md`。

## R2-1（HIGH）超大 UPDATE 静默丢失 —— 相关条款

### docs/protocols/instance-replication-v1.md

- §10.1 UPDATE 帧定义（L259）：「update | varUint8Array | Yjs update，最大 `maxUpdateBytes`」——单帧 UPDATE 载荷上限即 `maxUpdateBytes`。
- §10.1 未发送合并（L261）：「普通 UPDATE 只允许在 live 状态发送。Reconcile期间本地 updates进入有界未发送队列；round完成后发送。尚未分配 sequence、尚未发送的 updates允许 `Y.mergeUpdates()` 合并；发出后不得改写。」——合并合法但产物仍受 `maxUpdateBytes` 约束。
- §17 溢出纪律（L488）：「未发送队列任一上限超出：丢弃全部未发送增量，标记 needs-resync，停止新 UPDATE。已发送窗口等待 ACK或连接断开；窗口收口后由 Peer开始新 reconciliation。」
- §13.2 既有注册码（L371）：「`UPDATE_TOO_LARGE | yes | config | failed`」——单笔超限的协议收口码已存在（namespace scope、fatal、config 重试、终态 failed）。
- §16 终态语义（L468）：「`failed`：等待连接重建或配置变化」；§1 不变量 4（L24）：「同一连接内，同一 namespaceId 只允许一个生命周期；closed、conflicted 或 failed 后不得重新 open，重新 add 必须重建连接。」——若选 UPDATE_TOO_LARGE 路径，终态为 failed ⇒ 同连接不得重开。
- §1 不变量 9（L29）：「Origin 只用于回声抑制；重连、bootstrap 竞态和队列丢弃均由 state-vector reconciliation 修复。」——丢弃修复走 reconciliation，不允许静默丢失。

## R2-2（MEDIUM）sequence 耗尽路径发送重复序列号 —— 相关条款

### docs/protocols/instance-replication-v1.md

- §1 不变量 2（L22）：「每条正常 frame 都消费本发送方向的 sequence；对端严格按期望值接收。」
- §3 envelope（L54）：「sequence | uint32，正常 frame 从 `1` 严格递增」。
- §14（L391）：「如果 framing仍可信，关闭前 best-effort发送 connection ERROR；否则直接 close。稳定机器语义由 ERROR code定义，WS close code只做粗分类。」——「否则直接 close」是 sequence 耗尽（framing 不可信）时的直接依据。

### ADR-0010（accepted）

- L147：「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接。WS ping/pong负责活性，GOAWAY提供相对drain timeout。」

## R2-3（MEDIUM）queued limits 错计入 in-flight —— 相关条款

### docs/protocols/instance-replication-v1.md

- §17 限制清单（L479–486）：「`maxQueuedUpdateBytes`；`maxQueuedUpdateCount`；`maxInFlightUpdates`，默认 32；`maxUpdateBytes`；`maxBootstrapBytes`；`maxSyncDiffBytes`。」——queued count/bytes 与 in-flight window 是**分列的不同限制**。
- §17 溢出触发面（L488）：「**未发送队列**任一上限超出：丢弃全部未发送增量……」——溢出判据只针对未发送队列，不含已发送 in-flight。
- §10.2 滑动窗口（L279）：「每 namespace每方向采用可配置滑动窗口，默认 32 个 in-flight UPDATE。窗口满只暂停该 namespace发送，不阻塞本地写或其他 namespace。」——窗口满是暂停发送，不是溢出、不触发 resync。

## R2-4（MEDIUM）control reserve 需独立配置 —— 相关条款

### docs/protocols/instance-replication-v1.md

- §17（L490）：「Connection使用 per-namespace队列和 round-robin：control/error/ACK高优先级，data每轮每 namespace最多一个。总队列超限时，按最大 queued namespace依次丢弃未发送增量并标记 needs-resync，直到回到低水位。**Control frame有独立保留额度，耗尽为 `CONNECTION_BACKPRESSURE`**。」
- §17（L492）：「Adapter观察 WebSocket `bufferedAmount`：超过 high-water暂停 dequeue，降至 low-water恢复。……」——low-water 的协议语义**仅**为恢复 dequeue 的水位迟滞，与 control 额度无关。
- §17 启动校验（L494–506）：「配置启动时响亮验证：`maxBootstrapBytes <= maxFrameBytes - protocol overhead`……`low-water < high-water`」「**不得运行时 clamp**。」——任何新增配置须带安全默认值、启动响亮验证，不得运行时 clamp。
- §13.1（L350）：「`CONNECTION_BACKPRESSURE | yes | yes | 1011`」——额度耗尽的既有收口码。

### ADR-0010（accepted）

- L165：「以下上限均为插件配置并提供安全默认值：最大 WS frame、最大单 update/diff、每连接最大 channel 数、per-channel/连接待发送字节、bootstrap/idle timeout、心跳与失联判定。普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接。」——上限属插件配置域；新增 control reserve 配置落在此纪律内。

### docs/phases/phase-5-websocket-replication.md

- L110：「Per-namespace滑动窗口、有界队列、round-robin公平调度与connection control保留额度；溢出丢弃未发送增量并重新diff，不阻塞Runtime sequencer。」

## R2-5（MEDIUM）AC7 对抗流量测试缺口 —— 相关条款

### docs/phases/phase-5-websocket-replication.md

- L180（场景 13）：「frame/update/channel/queue 上限按 channel 或连接正确隔离；」
- L193（测试 seam）：「WS 层使用内存双端 transport/fake socket 覆盖连接与 channel 状态机，不用真实时间等待。」
- L195（故障注入）：「故障注入覆盖丢帧、重复帧、乱序、连接中断、队列溢出、flush failure、认证撤销和 shutdown race。」
- L221（阶段门禁）：「所有 frame/update/queue/channel 上限有确定性失败测试。」

### docs/protocols/instance-replication-v1.md

- §15.1（L431）：「Scheduler和random必须注入测试 seam。」
- §17（L492）：「……无 drain event时使用 Cordis Timer调度检查，不使用原生 timer，也不进入 Runtime sequencer。」

### ADR-0009（accepted）

- L83：「Persistence 和 Registry 都依赖外部 Clock 与 Cordis Timer，不各自实现或 fallback 到系统 timer。……确定性测试使用 manual Clock 状态与 fake timer协调推进。」

### ADR-0010（accepted）

- L167：「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events。最小观测面包括：……backpressure resync……」（对抗测试若需观测面，只经既有 seam。）

## 继承约束（round 1 已摘录、本轮继续生效——此处只列最高承重项）

> 全量清单见 `wiki/raw/task_phase5-ws-multiplex-backpressure_relevant_decisions.md`。

- **ADR-0010 L151**：「连接与namespace状态、消息码、payload字段、错误码、timeout、close code、backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract。关键恢复纪律为：连接断开即close sessions/release Leases，不保留outbox；重连重新OPEN并reconcile。Per-namespace有界队列溢出时丢弃未发送增量并进入needs-resync；connection按namespace round-robin公平发送，control/ACK保留额度，网络背压不得进入Runtime sequencer。」
- **ADR-0010 L113**：「队列溢出只把 channel 标记为 `needs-resync`，不得阻塞 write sequencer。」
- **ADR-0010 L177（transport 抽象纪律）**：「在出现第二种 transport 前，不提前提取 transport-independent replication package。」——R2 修复不得借机长出第二种 transport 抽象。
- **两级队列属主边界（ADR 0010 #134 round-2 修订节）**：fanout 投递队列（runtime 内、session 域，容量 16 冻结常量、溢出弃新保旧、`status.needsResync` sticky）与 WS 发送队列/连接级背压（L151 域，溢出丢全部未发送、标记 namespace needs-resync、停发新 UPDATE）是**两套队列、两个属主、两种溢出语义**；R2-1/R2-3 的修复全部落在后者域内，不得触碰 #134 已交付域。
- **ADR-0008 #132 修订节**：Runtime status 的 `replication` 域仅含持久 identity/epoch 两态，不含 session、网络、队列或 sync 状态——本轮任何修复状态不得塞入 Runtime status。
- **CONTEXT.md**：Hub/Peer/namespaceId/写序列器/ReplicationSession/复制谱系/复制代际/复制未校验/实例角色词条（round 1 文档已逐条摘录）。

## Round 1 设计决策 delta 登记（只登记，不裁决）

> Round 1 设计文档及其 D1–D11 决策点**不构成冲突基准**（基准只有 ADR 全集 + CONTEXT.md + ADR 0010 L51 指定的协议 v1）；此处登记本轮简报对其的显式推翻，供 SA1 设计修订时对账：

- **D3（control 保留额度 = `limits.lowWater` 字节）被 R2-4 推翻**：review 依据协议 §17 L490（独立保留额度）+ L492（low-water 仅恢复 dequeue）要求独立且可验证的 control reserve 配置。简报明文：「Round 1 设计 DENY LIST 原声明 types/defaults 零改动；本轮 review 明确要求改配置面，设计修订必须登记此 ALLOW 变更。」
- **D10 之子项（`types.ts`/`defaults.ts`/`validate.ts`/`index.ts` 零改动）随之放开到「为 control reserve 配置所必需的最小改动」**：其余 D10 内部 seam 变更（UpdateChannelHost 钩子、pullAndSendOne、OutboundQueue 收窄等）未被推翻，仍为 round 1 实现现状的登记事实。
- **D8（合并触发判据）可能被 R2-1 牵动**：R2-1 建议「出队前校验合并结果」——若采纳，D8 的贪心合并需补「合并产物 ≤ `maxUpdateBytes` 且单笔超限有明确收口」的前置校验；属设计修订域，非门禁域。
- D1/D2/D4/D5/D6/D7/D9/D11 未被本轮 review 触及。

## 设计后复审追加（SA8 登记 `...-r2_design.md` 引入的新决策点；只登记，不裁决）

> 以下为 SA1 r2 delta 设计（`wiki/raw/task_phase5-ws-multiplex-backpressure-r2_design.md`）钉死的、
> 基准文本（ADR/协议/phase-5）未显式定量或留有自由度的决策点。SA8 已逐项对照裁 no-conflict
> （见 `...-r2_design_conflict_report.md`）；此处按链路复用需求登记原文锚点，SA2/SA3/SA4/SA7 据此比对。

- **R2-D1 R2-1 队尾限定响亮收口**（§2.2）：判别点 = `UpdateChannel.sendAndRegister` 入口前置
  （单漏斗覆盖直发 + drain 两路径）；规则 =「超限（> `maxUpdateBytes`）且此刻未发送队列已空 ⇒
  `discardQueued()`（空队列 no-op）+ `needsResync = true` + `declareLocalResync()`/`declareHubResync()`；
  队列非空 ⇒ 维持 round-1 F4 静默丢弃」。reasonCode 复用 `'send-queue-overflow'`（零新 wire 枚举）；
  路径 ③ `UPDATE_TOO_LARGE` 否决（终态 failed 过重 + R0-1 状态机红线），不可修复形态登记演进位
  §13.2 R2-B1；路径 ①（出队前校验）不采纳为独立机制（P-6：贪心合并累计上界 ⇒ 多项帧结构性
  不超限，超限唯一可达形态 = 单笔自身超限）。控制器大小门保留为不可达后盾。依据：§10.1 L259/261
  + §17 L488 同构 + §1 不变量 9 L29 + §9.4 L248。
- **R2-D2 R2-2 sequence 耗尽 = 零出站帧直接 close**（§3）：双侧删除 0xffffffff ERROR 直发
  （~12 行/侧）；`onSequenceExhausted` 仅 `transport.close(1008, 'sequence-exhausted')` +
  peer `enterBlocked()`/hub `closedFlag`+`cleanupAll`（既有收口拓扑不变）；close code 1008 为
  round-1 既有映射（CONNECTION_POLICY_VIOLATION 注册行），本轮只删帧不改码。依据：§14 L391
  「否则直接 close」+ §1 不变量 2 + §3 L54 + ADR 0010 L147。
- **R2-D3 R2-3 溢出判据队列唯一**（§4.1）：`overflows()` = `queued.length >= maxQueuedUpdateCount`
  ∨ `queuedByteCount + incoming.byteLength > maxQueuedUpdateBytes`——count 用 `>=`（入队后恰达上界）、
  bytes 严格大于；in-flight 窗口（`maxInFlightUpdates`）完全退出溢出判据；溢出处置逐字不动；
  validate 既有 `maxQueuedUpdateBytes >= maxUpdateBytes` 约束在新判据下语义复活（空队列单笔必可入队），
  零新增校验。依据：§17 L479–486 分列 + L488「未发送队列」+ §10.2 L279。
- **R2-D4 R2-4 `controlReserveBytes` 契约面**（§5.1–§5.3）：`ReplicationLimits` +必填字段
  `controlReserveBytes: number`（10→11 字段）；缺省 `64 * 1024` == 旧 lowWater 缺省 ⇒ 缺省行为
  零漂移；`validateLimits` +`positiveSafeInteger('controlReserveBytes')`（构造期响亮 TypeError、
  不运行时 clamp、零跨字段约束——额度与水位量纲独立）；`sendControl` 耗尽谓词阈值来源
  `limits.lowWater` → `limits.controlReserveBytes`（谓词形状不变）；`observeWater` 的 lowWater 两处
  读取保留（§17 L492 水位迟滞语义）；lowWater 运行时语义收窄声明（§5.2）；耗尽动作（peer
  `failConnectionBackpressure` / hub `connectionFatal`）逐字不动。依据：§17 L490 + L492 + L494–506
  + §13.1 CONNECTION_BACKPRESSURE + ADR 0010 L165。
- **R2-D5 R2-5 落盘即修复**（§6）：零 src 改动；no-starvation/bounded-memory 由 round-1 §4.5 RR
  轮转 + §11.3 三层上限既已满足，缺口纯覆盖性；R2-3 判据修正使阶段 2 溢出点后移两笔（第 5→第 7 写），
  仍在对抗窗口内。
- **R2-D6 既有测试适配集（6→7 文件，见 R2-D6a 修订）与 B-8 定案**（§5.4/§9/§12）：3 个溢出测试（ac6/F1/⑧a）各 +1
  笔写推回溢出点（断言语义原样）；D3a/D3c 各 +1 行 `controlReserveBytes` 覆写（断言逻辑零改）；
  api.test-d.ts +1 行形状 pin、harness.ts +2 行镜像同步（纯镜像，无运行时依赖）；D4 零适配
  （§2.3 相容性论证：F4 时刻队列非空 ⇒ 维持静默 ⇒ D4 全绿）；~~r2-red [SA6 owned] 零改动~~
  【**子项作废**，由 R2-D6a 取代】；round-1 §15 B-8 定案为「N-3 以实现形态为准（F4 丢弃）」。
  源文件 ALLOW = 7 src + package.json（0.1.1→0.1.2 patch）+ 7 test 文件（6 既有适配 + r2-red
  恰 1 处守卫修订）；frame-io/peer-namespace/hub-namespace/index.ts 及
  namespace-registry/runtime/doc-runtime/replication-protocol/apps/docs 全 DENY。
- **R2-D6a r2-red「零改动」子项作废登记**（SA2 R1 CRITICAL #1 → 设计 R2 修订 → SA2 R2 pass）：
  R2-D6 原「r2-red [SA6 owned] 零改动」子项**作废**。依据与形态：
  - **作废原因**（SA2 R1 攻击点 #1，CRITICAL，verdict reject）：R2-4（生效）用例末段守卫
    `expect(run.rootValue('hub', a, 'n')).toBe(K=40)` 结构性不可满足——57B 实测 ⇒ allowed=26 ⇒
    额度耗尽使连接死于第 27 个 ACK ⇒ hub 应用上界 35 < 40；且该守卫位于首个失败断言（1011）之后，
    红灯运行中从未被执行（SA6「两实现均成立」声明随之不成立）。
  - **取代形态**（设计 §5.6 新章钉死，R2 修订 617→746 行）：守卫修订为**区间守卫**——
    `hub n ≥ allowed+1` ∧ `hub n ≤ allowed+1+maxInFlightUpdates` ∧ `peer n === K`，三重钉死
    （死亡前数据面至少推进到触发写 / 死亡截断界 / 本地完备性「不阻塞 sequencer」），**非软化**；
    SA2 R2 对偏差申报（区间 vs 精确 `toBe(allowed+1)`）独立验证后**接受**并承认其 R1 建议 A 自身
    有缺陷（`drainPendingApplies` 补完在途 apply ⇒ 残差非确定，任何精确 toBe 不可钉）。
  - **冻结解除范围**：§12 r2-red 条目由「预期零改动」解除为「恰 1 处守卫修订（SA6 域，需总控
    dispatch）」；其余 7 用例、构造、1011/backoff/ERROR×1 断言零触碰。验收 1「红灯转绿」以 §5.6
    钉死形态闭合（设计 §14 验收表行 1 已同步）。
  - **依据锚**：设计 `...-r2_design.md` §5.6/§9 行 6a/§12/§14 表行 6/验收表/§11 R2-A8~A10；
    SA2 报告 `...-r2_sa2_review.md`「R2 轮次（修订复审，2026-08-30）」节（verdict **pass**：
    §1 CRITICAL 修订核验通过、§2 偏差申报独立验证、§7 裁决；附非阻断勘误 N1/N2——N1 为设计
    §5.4 末行残留「零改动」措辞 1 行勘误，由 SA1 随 SA6 dispatch 同批落文）。
  - **维持面**：R2-D6 其余子项（3 溢出测试 +1 写、D3a/D3c +1 行、api.test-d +1 行、harness +2 行、
    D4 零适配、B-8 定案）与 DENY 清单**不受影响，全部维持**；测试文件集合 6→7（仅纳入 r2-red
    守卫修订一项）。
