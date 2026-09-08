# SA2 攻击评审报告 — issue #254 周期 reconciliation 超时僵尸的协议合规自愈设计（iteration 0）

**Date**: 2026-09-07/08
**Verdict**: **approve（有条件通过）**——方向 A 机制、不变量保持、重连界与 SA6 契约闭合论证经独立源码推演全部成立；**2 项 P1 必改**（SA8 复审 R1/R2 尚未并入设计，属文档登记面缺项，修订为纯文字增改）、1 项 P2 应改（触发面边界的显式负控测试）、2 项 P3 建议。无决策级/机制级缺陷。

**评审对象**: `wiki/raw/task_issue-254_design.md`（SA1 iteration 0；上游 = 简报 + SA6 契约 + SA8 门禁/复审）。
**审查方法**: 全新视角独立攻击——逐一复核设计全部源码锚点（`peer-namespace.ts`、`peer-connection.ts`、`types.ts`、`defaults.ts`、`index.ts`、`hub-namespace.ts`）、协议全文相关节（§1/§7.1/§13.2/§14/§15.1/§16/§18/§21/§23.1）、ADR 0010/0012 条款、SA6 契约测试全文 343 行（A1/A2/N1–N3 断言面与 AC3 检查器逐行推演）、三个被点名改版的存量测试触发源、以及全测试目录 `failed` 断言穷尽清点（grep 21 处逐一定性触发源）。基线 HEAD `6a005a4` 与 git status 核验：SA6 契约文件在场且未跟踪未改动，无 `task_issue-254_sa2_review.md`（iteration 0 属实）。

---

## 一、发现清单

| # | 严重度 | 攻击面 | 一句话结论 | 修订位置 |
|---|---|---|---|---|
| F1 | **P1（必改）** | SA8 复审 R1 未并入 | 设计 §8.4/§11 缺 protocol **§23.1** `connection-backoff-scheduled.reason` 枚举的 append-only 修订登记；观测契约与代码闭集合将出现规范文档缺口 | §8.4 增补 + §11 ALLOW LIST protocol 行 |
| F2 | **P1（必改）** | SA8 复审 R2 未并入 | §8.4-1 拟写入 §16 的触发谓词仍为**类宽读法**（「§13.2 `retryable=reconnect` 分类」），与实现/§8.4-4 的 timer 族边界不一致——照抄落地将登记实现不具备的行为（wire ERROR 驱动 reconnect 族即重建），违反 docs/AGENTS.md「documentation-only wording must not invent implementation behavior」 | §8.4-1 措辞收窄（或双文本一致登记 follow-up 边界） |
| F3 | **P2（应改）** | 决策 2 触发面边界的测试钉住 | 新测试文件四场景全部在界**内**，缺一个显式负控钉住「错误帧/registry 拒绝驱动的 failed **不得**触发重建」——当前仅由存量测试隐式守护（见下文 D1b 推演） | §11/§12 新文件增场景 5 |
| F4 | **P3（建议）** | §9.5 风暴界叙事只覆盖 open-timeout 环形 | reconcile-timeout 持续故障环的 ready 驻留 ≈ `reconcileTimeoutMs`(10s 缺省) ≥ `resetAfterMs`(10s) → attempts 每环清零、退避恒为 base 抖动，环周期 ≈ 超时窗 + 握手（≈10.1s）而非「attempts 单调增长至 cap」；界仍成立但两个环形应分别表述，避免 ADR 修订节的运营口径失真 | §9.5 + §8.4-4 运营注记 |
| F5 | **P3（勘误）** | 事实性小错 | §7 决策 4「finalize 的 26 个调用点」实为 **25**（`this.finalize(` 基线计数）；§2.1-10 引 types.ts L287-297 实际 7 值闭合跨 L287-299。论点不受影响，改数即可 | §7/§2.1 文字 |

### F1（P1）§23.1 reason 枚举修订未登记（SA8 复审 R1 未并入）

- **触发条件**：实现按设计决策 5 落地后，`types.ts` 内联 reason 闭集合与 `peer-connection.ts` `PeerBackoffReason` 各 7→8 值（两处源码已核验：`types.ts` L287-299、`peer-connection.ts` L38-45），而 protocol §23.1（L613）将该 7 值集合登记为规范观测契约，且 §23 开篇明文「事件类型、reason/cause/via 词表、稳定码表只增不改」。
- **影响**：代码与规范文档的观测词汇失同步。仓库先例硬约束：issue #238 的 ADR 0010 修订节明文要求此类追加「由 §23.1 显式修订登记，标 issue 号」（`docs/adr/0010-...md` issue #238 修订节原文已核验）；docs/AGENTS.md 要求 code behavior change 同步每一份 stated contract 的 normative document。设计 §8.4 清单与 §11 ALLOW LIST 的 protocol 行（现文「§16/§18/§15.1 登记性文本（§8.4-1/2/3）」）均不含 §23.1——SA8 复审已具名该缺项（R1），但设计文本尚未并入。
- **修订要求（可执行）**：§8.4 增补第 5 条——「protocol §23.1 `connection-backoff-scheduled.reason` 枚举追加 `'namespace-recovery'`（标注 issue #254，append-only，20→21 值不变、reason 词表 7→8）」；§11 ALLOW LIST protocol 行预期改动同步加「§23.1 reason 枚举 append-only 追加」；§8.4-4 ADR 修订节登记一句同款引语（对齐 #238 先例）。
- **测试构想**：实现轮验收清单加一项文档一致性核对：`types.ts`/`peer-connection.ts` 闭集合、protocol §23.1 枚举、ADR 修订节四处的 `'namespace-recovery'` 齐备；新场景测试断言恢复路径上观测到 `connection-backoff-scheduled{reason:'namespace-recovery'}`（同时守住 emitBackoffScheduled → types 联合的 typecheck 面）。

### F2（P1）§16 登记文本谓词与实现边界宽窄不一（SA8 复审 R2 未并入）

- **触发条件**：§8.4-1 现文以「当 failed 源于 §13.2 `retryable=reconnect` 分类（如 NAMESPACE_TIMEOUT）且 target 仍被需要而连接仍存活时，由 Peer 控制器触发整连接重建」写入 protocol §16；而实现（决策 2/4：仅 `onTimerFired` 尾部单点分派；finalize 内无条件分派被明确否决，F5 勘误后 25 个调用点中仅 timer 族 1 点触发）与 §8.4-4 ADR 修订节（「触发谓词（§13.2 timer 族 + target 活跃 + 连接存活）」）均为 **timer 族**边界；wire ERROR 帧驱动的 reconnect 族（BOOTSTRAP_FAILED/APPLY_FAILED/INTERNAL_ERROR 收帧）显式记 follow-up（§13-1）。
- **影响**：按 §8.4-1 现文落地，protocol 将登记实现不具备的行为——读者据 §16 预期「任何 reconnect 分类 failed 都触发重建」，而 BOOTSTRAP_FAILED 等收帧后连接维持现状（§2.2 表右列存量测试钉住「收口后连接保持」）。两份 normative 文档（protocol §16 vs ADR 0010 修订节）谓词互相矛盾，属 SA8 复审点名的「invent implementation behavior」+ 文本不一致双违。
- **修订要求（可执行）**：二选一（SA8 复审已给两口径）：(a) §8.4-1 收窄为「当 failed 源于 open/bootstrap/reconcile timer 超时（§13.2 `NAMESPACE_TIMEOUT`，本地映射）且 target 仍被需要而连接仍存活时……」；(b) 保留类宽措辞但与 §8.4-4 一致地在两处文本登记「reconnect 分类其余路径（wire ERROR 帧驱动族）的自动重建为显式未实现 follow-up（issue #254 设计 §13-1）」。推荐 (a)（收窄性文字变更，与 SA8 复审「无需重开门禁」的前提吻合）。
- **测试构想**：与 F3 的边界负控互补——负控测试绿 = 实现行为与（收窄后的）§16 登记谓词一致；文档核对项：§16 新句、§18 伴随句、§8.4-4 ADR 修订节三处谓词逐字同域（timer 族）。

### F3（P2）触发面边界缺显式负控测试

- **触发条件**：设计把触发面收在 timer 族（决策 2），排除错误帧/registry 拒绝驱动的 failed 终局（含同为 reconnect 分类的 wire ERROR 族与必须排除的 config 族）。§11/§12 新文件四场景（open 超时/bootstrap 超时/multiplex/churn 界）全部断言「界内必愈」，无任何场景断言「界外必不动」。
- **影响**：未来实现漂移（如有人把分派挪进 finalize 无条件执行——恰是设计决策 4 明确否决的形态）不会被本任务新增测试面捕获，只能依赖存量测试的隐式行为断言。本人推演确认现存隐式守护确实存在且会红：`ws-replication-sa7-round2-dynamic.test.ts` D1b（NOT_FOUND → failed 后断言 `connectionState()==='ready'`、手工断线后 `dialCount==2`）在「无条件重建」实现下会在 `waitConnection('backoff')`/dialCount 断言处红；ac1-ac2/ac7/r3-r4 同族。但隐式守护不指向「触发面边界」这一设计语义，回归报告可读性差。
- **修订要求（可执行）**：§11 新文件增场景 5（负控）：`hubNamespace:false`（OPEN → NOT_FOUND ERROR 帧）→ `waitNamespace('failed')` → 推进 ≥ 恢复窗口（同 HORIZON 量级虚拟时间）→ 断言 `wires==1`、`dials==1`、`connectionState()==='ready'`、ns 保持 `failed`（界外稳定等待，§16「等待连接重建或配置变化」语义零变更）。可加一个 config 族变体（UPDATE_TOO_LARGE 收帧）同款断言。
- **测试构想**：即上；与 D1b 互补成「显式 + 隐式」双层钉住，直接锚定 F2 收窄后的 §16 谓词。

### F4（P3）风暴界叙事补全两种环形

- **触发条件**：§9.5 以「openTimeout(5s) < resetAfterMs(10s) ⇒ attempts 单调增长至 cap=30s」推导稳态界——该推导只对 open-timeout 环（F2 形态：authorize 悬挂）精确。reconcile-timeout 持续故障环（如事故形态的持续饥饿）中：ready 起点 = HELLO_ACK，round 开始晚 δ>0，reconcile timer 于 round+10s 到期，`armResetCheck`（ready+10s，`peer-connection.ts` L1001-1007：ready 态到期才清零 attempts）先于超时 fire → attempts 每环归零 → 退避恒为 `random(0,100ms)` 量级，环周期 ≈ `reconcileTimeoutMs` + 握手 + 小抖动 ≈ 10.1s。
- **影响**：界**仍成立**（每环必须先烧完一个完整超时窗，重拨率 ≤ ~1/10s；multiplex churn 同界），但「attempts 单调增长至 cap」对 reconcile 环为假——若 ADR 修订节运营注记照抄，值班对 `connection-backoff-scheduled.attempt` 字段的预期（应增长 vs 恒 1）与告警阈值设定会失真。
- **修订要求（可执行）**：§9.5 与 §8.4-4 运营注记区分两环形：open-timeout 环 attempts 增长至 cap（周期 → ~35s）；reconcile-timeout 环 attempts 每环清零（周期 ≈ reconcileTimeoutMs + 握手）；统一上界表述为「重拨率 ≤ 1/min(超时窗, backoff 界)」。
- **测试构想**：§12 场景 4（churn 界）参数化两种持续故障（authorize 悬挂 / 周期 round 持续丢 SYNC_APPLIED），分别断言窗口内 dialCount 上界（open 环按退避增长曲线；reconcile 环按 ⌈窗口/reconcileTimeoutMs⌉+ε）。

### F5（P3）事实性勘误

- §7 决策 4「finalize 的 26 个调用点」→ 基线实数 **25**（`grep -c "this.finalize(" peer-namespace.ts`）；论点（多调用点跨族、无条件分派违界）不变。§2.1-10 types.ts 锚 L287-297 → L287-299。§2.1-6「PeerBackoffReason 在 peer-connection.ts 同构镜像」锚 L38-45 ✓ 保持。

---

## 二、派发指令四项确认（逐项给出证据链）

### 2.1 SA6 红灯契约的可满足性 —— ✅ 成立（机制级逐断言推演）

设计机制（onTimerFired 尾部 finalize 后 intent 门分派 → `requestConnectionRecovery` → ready/stopping/transport 三门 → `detachCloseTimedOutTransport('namespace-recovery')` → `onTemporaryFailure('namespace-recovery', true)`）对契约各断言的闭合推演：

| 契约断言（`ws-replication-issue254-ac-red.test.ts`） | 推演 | 源码依据（本人核验） |
|---|---|---|
| A1/A2 `recovered==true`（60s 窗内回 live） | 超时边界同步栈内：finalize → close(1001) → backoff（`random:()=>0` → delay 0）→ dialNow → HELLO_ACK → `openActiveTargets` → failed→targeted→startOpen → 新 round → SYNC_APPLIED 到达 → live；全程 ≪ 60s | `onTimerFired` L1505-1522 尾部、`detachCloseTimedOutTransport` L644-666、`onTemporaryFailure` L908-937（timer→dialNow L933-936）、`openActiveTargets` L685-697、`onRoundSettled`→live+periodic 再武装 L860-872 |
| A1/A2 `wires≥2 / dials≥2`、新 wire 含 OPEN_NAMESPACE+SYNC_STEP1 | close → 重拨必经 `dialNow` 新 transport；`openActiveTargets` 对 disconnected/failed 发 OPEN；round 起步发 SYNC_STEP1 | 同上 + `startOpen`/round 路径 |
| A1/A2 hub 侧回 live、双向写收敛、零 unhandled rejection | 与 N3 已实证轨道逐字同构（N3 = 同场景手工断线全绿）；hub 侧对 1001 close 对称 teardown（§16），新 channel 经新 round 回 live | SA6 §7/§9 因果实验；`onConnectionLost` L766-785 |
| AC3 检查器零违例 | 终态 failed 与复活 targeted 之间必有：ready→backoff→connecting→handshaking→ready（代际 +1）且 failed→disconnected 投影先于新代 ready；检查器以 ready 计数为代际尺 → 合法 | 检查器实现（契约文件 L72-97）+ `onConnectionLost` failed→disconnected L776-779 |
| N1（timeout−1ms 零动作）| 触发点在 timer 回调内，边界前不 fire；wires/dials 恒 1 | 触发点唯一定义于 `onTimerFired` |
| N2（健康 round 零 churn）| 无超时即无触发；periodic 分支 L1507-1509 早退不受影响 | 同上 |
| N3 修复后仍绿 | 超时即自动重建；N3 的手工 closeHubSide(1006) 落在已重建连接上 → 再走一次既有断线恢复 → 终态断言全部保持（wires≥2/ready/live/AC3/收敛/零 rejection）；测试注释已自认「修复实现：无论是否先 failed，恢复都须可达」 | N3 体 L302-341 |

fake-wire 信封洞相容性：finalize 零 wire 帧 + peer 主动 close，旧 wire 上超时后 peer 零出站——满足 SA6 §15-1「红灯场景在超时后保持发送方零出站」约束，重建即序列归零。✅

### 2.2 连接/namespace 协议不变量保持 —— ✅ 成立

- **§1 不变量 4 / §7.1（同连接终态不重开）**：复活唯一入口 `openActiveTargets`/`onConnectionReady` 只在新代 ready 后执行（`peer-connection.ts` L457/L685-697；`peer-namespace.ts` L832-838），设计零改动该入口；触发边只产生 终态→disconnected→(新代)→targeted。设计删除的 L1261-1262 空块确为死代码（本人核验：空语句体）。
- **§13.2 映射零变更**：超时仍 `finalize('failed')`；零错误码/零 wire 字节/零注册表改动（DENY LIST 冻结 `replication-protocol/**` 与 Hub 半区，git status 佐证契约文件未被触碰）。
- **§15.1 状态机**：`ready ├─ namespace-recovery → backoff` 是 `ready ├─ temporary-close → backoff`（protocol L410/414）的新触发实例而非新边；close(1001) 分类与 pong-timeout 先例（L658 生产代码同款）一致；§21/ADR 0012 L36 所有权（Peer 拥有 dial loop）无越界。
- **§18 epoch-first 纪律**：`detachCloseTimedOutTransport` 单点承载（停 liveness→退订→epoch+1→close），同步重入被双门吸收——与 pong/hello-timeout 既有轨道逐字同构（L444-453/L988-990 模板）。
- **§16/ADR 0010 L90 生命周期**：恢复 = 一次受控断线，`onConnectionLost`→`runDisposal`（session.close→lease.release，身份守卫 L1328-1344）与真实断线逐字同构；「已接纳 apply 排空」由既有 sequencer 纪律承载（N3/A1 的零 unhandled rejection + 收敛哨兵为功能级验证）。
- **并发/幂等攻击推演**（本人逐条走栈）：同 tick 多 ns 超时——首个触发同步离开 ready，后续被 `connStateValue !== 'ready'` 门吸收，且兄弟 ns 的 timer 已被 `onConnectionLost` 的 `clearAllTimers`（L769）清除；残角（timer 回调已出队、clear 无效 → 迟到 fire 落在 disconnected 上 → finalize('failed')）为**存量语义**（onTimerFired 仅 isTerminal 门），disconnected→failed 无 wire 副作用且新代 ready 后同样复活，触发请求被 ready 门吸收——无害且非本设计引入。与 `requestRebuild` 交错（backoff 期 config-change → `clearBackoff` L945 接管）、stop()（stopping 门 + timer 清除）、GOAWAY drain（draining 非 ready → no-op；`onConnectionQuiesce` L801 清 timer 为纵深）全部闭合。close-throw 边角（adapter 违约 → INTERNAL_ERROR/1011 + blocked）为 detach 轨道既有防御，非新风险面。

### 2.3 重连行为有界性（含 multiplex，D5）—— ✅ 成立（表述补全见 F4）

- 复用 §15.1 full-jitter + attempts 记账 + ready 稳定 `resetAfterMs` 才清零（`onTemporaryFailure` L923-936、`armResetCheck` L1001-1007；defaults：base 100ms/max 30s/reset 10s/open 5s/reconcile 10s 已核验）。
- open-timeout 环：attempts 单调增长至 cap，稳态周期 ≈ 5s+握手+≤30s。reconcile-timeout 环：每环烧满 10s 超时窗，attempts 每环清零，周期 ≈ 10.1s。两环形重拨率均 ≤ ~1/10s 量级，**有界且低频**；`connection-backoff-scheduled` 每次尝试提供告警面（F1 落实后 reason 可区分）。
- multiplex：整连接重建 → 兄弟 ns 走 disconnected 投影 → 新代 re-OPEN/reconcile，与真实断线同构（§16 断线纪律 + state-vector round 收敛，双侧全量副本）；同 tick 多 ns 触发零重复 close。配 §12 场景 3/4 专项验收。✅

### 2.4 SA8 复审 R1/R2 文档澄清的并入状态 —— ❌ 未并入（→ F1/F2 必改）

设计 §8.4 现清单 4 条无 §23.1；§11 ALLOW LIST protocol 行预期改动不含 §23.1（**R1 未落实**）。§8.4-1 谓词仍为「§13.2 `retryable=reconnect` 分类」类宽读法，与 §8.4-4/决策 2/决策 4 的 timer 族边界不一致（**R2 未落实**）。两项均纯文字增改、不动任何决策语义——SA8 复审已预裁定该等修订属 append-only/收窄性变更，落实后**无需重开冲突门禁**。

---

## 三、攻击未遂面（独立复核通过、无需修订）

供总控与实现轮参考：

- **timer 族一般化的事实基础**：`armTimer` 全部 8 个调用点定性（open L233 / bootstrap L326 / reconcile L357/495/890/903 / periodic L871/898 / close L694）；`onTimerFired` 三分支（periodic 重武装 / close→closed / 尾部 finalize('failed')）与设计 §2.1-1 逐字一致。close timeout 排除正当（closed = 正常生命周期完结，非 reconnect 终态；SA8 复审 N1 同款）。
- **「瞬态 failed 不可轮询」主张**：`driver.ts` `waitNamespace` = `settleUntil` 轮询同步投影 `namespaceState()`（L311-319）；恢复触发在 timer 回调同步栈内贯通 finalize→close→onConnectionLost，轮询结构性捕不到瞬态 failed——§2.2 对三个存量测试必红的预判成立（ac4 L124、ac3 L134、sa4-f1-f2-f3 L97 均为 `waitNamespace('failed')` 轮询形态，本人核验触发源均为 timer 族）。
- **§2.2 枚举穷尽性**：grep 全测试目录 21 处 `failed` 断言逐一定性——其余全部为错误帧/registry 拒绝/本地映射驱动（ac1-ac2 授权族、ac3 L85/111 BOOTSTRAP_FAILED、ac4 L152 SYNC_STATE_VIOLATION、ac6 L158、ac7 PERSISTENCE_DEGRADED、auth-lifecycle L320、observer-red、r3-r4 L232 INTERNAL_ERROR、sa7-hardening L956 closing 期迟到 OPEN_OK、sa7-round2 D1b NOT_FOUND），触发面仅 timer 族 ⇒ 「不受影响」判断准确；sa7-round2 D1b 兼为决策 2 边界的隐式守护（见 F3）。
- **`onTemporaryFailure(reason, true)` 签名相容**：第二参 `epochAlreadyInvalidated = false`（L908），hello-timeout 调用点（L988-989）与设计草图同款；`detachCloseTimedOutTransport` 返回 boolean（L644-666），reason 现为二值闭合、追加第三值闭合合法，身份守卫 fail-loud 保留。
- **观测面零新增事件类型**：`emitBackoffScheduled`（L135-147）直通 reason 字段；types.ts 内联合与 PeerBackoffReason 双镜像 append-only（先例 #231/#238 已核验，#238 走 §23.1 显式登记——即 F1 义务来源）。`PeerNamespaceHost`/`PeerBackoffReason` 均未从 index.ts 导出（index.ts 全文核验）——「内部缝、非公共 API 变更」成立；facet 先例（`requestDataDrain`/`connectionFatal`）在场。
- **Hub 半区零改动的充分性**：事故形态的 Hub needs-resync 是 Peer 终态的投影（round 恒由 Peer 发起，`declareHubResync` L775-800 + 终态 peer `isInboundQuiet` 静默）；修复使 Peer 在超时边界（先于 Hub ack-timeout）主动 close → Hub 对称 teardown → 僵尸组合结构性不形成——AC2 由 Peer 侧单独成立。
- **DENY LIST 完整性**：`ws-replication-periodic-reconcile.test.ts` 修复后仍绿（推进量 < 超时，SA6 §5 复证）；SA6 契约文件在 DENY LIST 且 git 未跟踪未改动；`defaults.ts`/背压/round/liveness/fence-watchdog 不在触发面。
- **回滚面**：3 源文件单边缘路径 + 3 测试改版 + 文档；revert 即恢复基线，无持久化变更。✅

---

## 四、结论与修订映射

**Verdict: approve（有条件通过）。** 方向 A 的机制选择、触发落点、幂等门、退避轨道、文档修订纪律全部经对抗推演成立；SA6 契约可满足性、协议不变量、重连界（含 multiplex）三面均闭合。必改项仅 SA8 复审 R1/R2 的文字并入（F1/F2）——SA1 按 SA8 复审给定口径落实即可，无需更改任何决策；F3 建议随新测试文件一并落，F4/F5 属文字精度。

| 发现 | 严重度 | 修订要求 | 落实位置（SA1 更新设计时登记） |
|---|---|---|---|
| F1 | P1 | §8.4 增 §23.1 reason 枚举 append-only 登记（标 issue #254）+ §11 protocol 行同步 + ADR 修订节同款引语 | §8.4-5 / §11 / §8.4-4 |
| F2 | P1 | §8.4-1 谓词收窄至 timer 族（推荐），或双文本一致登记 follow-up 边界 | §8.4-1（+§8.4-4 对齐核对） |
| F3 | P2 | 新测试文件增场景 5：错误帧驱动 failed 界外负控（NOT_FOUND / UPDATE_TOO_LARGE → 零重建零重拨） | §11 新文件行 / §12 表 |
| F4 | P3 | §9.5 与 ADR 修订节分别表述 open-timeout / reconcile-timeout 两环形的 attempts 行为与周期界 | §9.5 / §8.4-4 |
| F5 | P3 | 26→25 调用点计数；types 锚 L287-299 | §7 决策 4 / §2.1-10 |

**requiresConflictRecheck: false**——F1/F2 按 SA8 复审预裁定的 append-only/收窄口径落实、F3–F5 不触契约语义，均不满足 SA8 复审「重开条件」任一（方向变更/映射或帧字节变更/触发面越界/close code 分类变更/Hub 或 replication-protocol 改动/CONTEXT 术语增改）。

**SA4/SA7 注意（非本评审义务，转述）**：`pass` 仅覆盖设计；实现轮须按 §12 全量门验收（含 real-transport 抖动项按 SA6 §14 口径单独复跑），A1/A2 只能因生产行为变更转绿。
