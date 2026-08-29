# SA2 攻击评审报告

**Date**: 2026-08-30
**Verdict**: **reject**（1 个 CRITICAL：冻结红灯契约 R2-4（生效）末段守卫在任何合格实现下不可满足，验收标准 1「红灯转绿」按现设计不可达成；其余修复形状经独立走查全部成立，修订面很窄）

> ↑ R1 轮裁决（历史留档，全文见下）。SA1 已完成 R2 修订（设计 617→746 行）；SA2 复审裁决为 **pass（附 2 项非阻断勘误 + 1 项流程前置）**——见文末「R2 轮次（修订复审，2026-08-30）」节。

- 被审对象：`wiki/raw/task_phase5-ws-multiplex-backpressure-r2_design.md`（617 行 delta，基线 round-1 设计）
- 行为契约：`task_phase5-ws-multiplex-backpressure-r2_sa6_red.md` + `packages/ws-replication/test/ws-replication-issue137-r2-red.test.ts`（8 用例）
- ADR 基准：`task_phase5-ws-multiplex-backpressure-r2_relevant_decisions.md`（含 R2-D1~D6 设计后复审登记）
- 审查方法：全新视角，全部关键声明逐条对源码/测试独立复核（update-channel / backpressure / peer-connection / hub-connection / peer-namespace / hub-namespace / frame-io / round-engine / types / defaults / validate + 全部涉案测试文件精读；关键帧长用 tsx 实测，见下）

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | R2-4（生效）冻结红灯用例末段守卫 × 设计 §8 走查 | `ws-replication-issue137-r2-red.test.ts:419` 断言 `hub n === K(40)`，但用例自身前置断言（1011 + backoff + ERROR×1）强制连接在额度耗尽点死亡，此后 peer 侧未发送写永不可达 hub ⇒ 断言不可满足（详见下文推演）。设计 §8（L399-402）对该用例走查标注「hub n=40（apply 先于 ACK）✓」是**错误的自证**——把「逐帧 apply 先于 ACK」混同「全部 K 笔已应用」。SA6 报告「守卫（两实现均成立）」同样不成立：旧实现下该断言位于首个失败断言（1011）之后，从未被执行过。 | 见「修订要求 #1」——需 SA6/controller 层最小修订测试守卫 + SA1 重做 §8 实测走查；设计必须显式登记该依赖，不得维持「r2-red 零改动」表述 |
| 2 | MEDIUM | 设计 §3「注释/文档面」段（L238-241） | 事实错误：R2-2 删除 ERROR 直发后，`encodeMessage` 在 `peer-connection.ts` 与 `hub-connection.ts` 各只剩 0 个调用点（peer 唯一调用 :482、hub 唯一调用 :418 都在删除块内；:522/:553/:372 用的是 `connectionErrorFrame`，不经过 `encodeMessage`）。设计却指示「import 因 connectionFatal / failConnectionBackpressure 仍在用而**保留**」。且 tsconfig.base.json 未开 `noUnusedLocals`，设计自设的兜底「以 tsc 零未用 import 为准」是空转——死 import 会静默存续。 | 修订 §3：明确删除两文件的 `encodeMessage` import（`connectionErrorFrame` 保留）；或将兜底改为「SA4 静态门禁 grep 校验两文件 encodeMessage 引用数=0」 |
| 3 | LOW | R2-1 reasonCode 复用（SA8 注记 ①） | 队尾超限收口的真实诱因是「单笔超限」却复用 `'send-queue-overflow'`，与队列溢出/连接 shed 在 wire 上不可区分。协议 reasonCode 是自由非空字符串（replication-protocol payloads.ts:600-602 仅 checkNonEmpty），无编码违规；R0-1 零新枚举红线下复用是受约束最优解。 | 接受。维持 slice-10 演进位登记（SA8 注记 ① 同判）；运维 metrics 若需区分诱因属该演进位 |
| 4 | LOW | R2-2 close code 1008（SA8 注记 ③） | sequence 类错误按 §14 粗分类更贴 1002，耗尽沿用 1008 系 round-1 已接受映射；本轮只删帧不改码是最小修复。 | 接受，无动作（预存灰区，delta 外） |
| 5 | LOW | R2-1 §2.3「语义辩护」措辞 | 「队列非空 = 后续项仍承载活性**与未来的 reconciliation 触发面**」言过其实：健康 live 连接上（ACK 正常回流、无 watchdog 边沿、无重连）**不存在保证触发的 reconciliation**，非队尾超限丢弃可无限期静默。§13.2 R2-B1 的表述（「无 round 触发，发散静默存续」）才是准确的。 | 接受 R2-B1 登记（D4 冻结契约钉死该域 + 协议未定义发送侧超限处置）；建议 §2.3 措辞向 R2-B1 对齐，非阻断 |
| 6 | LOW | R2-4 公共契约 10→11 必填字段 × patch bump | 向公共接口新增**必填**字段对「穷举字面量构造完整 ReplicationLimits」的包外消费者是编译期破坏性变更，按语义化版本更贴 minor。全仓 grep 证实当前仅 `DEFAULT_REPLICATION_LIMITS` 一处穷举构造、包外零消费（设计 §10 审计属实），现实破坏面为零；patch bump 系简报验收第 5 条明文。 | 接受（简报强制 + 审计闭合）；无动作 |

### 攻击点 #1 的完整推演（CRITICAL 依据）

**实测前提**（命令与输出见文末「验证证据」）：UPDATE_ACK 帧 = **57 字节**（20B 定长 envelope + 1B nsId 长度前缀 + 35B `ns-`+32hex + 1B varuint ackedSequence）。测试注释「~75B」是估算错误，但不影响结论——两种取值下结论同向。

1. 用例配置：`controlReserveBytes=1500`、`maxInFlightUpdates=8`、`K=40`、压力 150,000 > highWater 100,000（暂停段）。
2. 耗尽谓词（设计 §5.1 保持 round-1 形状）：`used + frameBytes > 1500`。实测 57B/帧 ⇒ `allowed = floor(1500/57) = 26`，第 27 个 ACK 触发耗尽（26×57=1482 ≤ 1500；1482+57=1539 > 1500）。（按 SA6 估算 75B：allowed=20，第 21 个触发——同构。）
3. 触发即 `connectionFatal('CONNECTION_BACKPRESSURE', 1011)` → ERROR×1 + close(1011) + peer backoff——这正是用例第 409-417 行断言、也是 §17 L490/§13.1 的规定动作。**连接在此刻死亡。**
4. 死亡时刻 hub 已应用笔数：apply 先于 ACK 发射（hub-namespace.ts:698-711 实证）⇒ 触发帧所属的第 27 笔已应用；peer 在途窗口 ≤ 8（`maxInFlightUpdates=8`，sendAndRegister 仅对 seq>0 登记 inFlight，deliver 直发与 drain 均受窗口上界）⇒ hub 至多再收 ≤ 8 帧并在 cleanup 的 drainPendingApplies 中补完 ⇒ **hub n ∈ [27, 35]，上界 35 < 40**。
5. peer 侧其余 ~12 笔在连接关闭时被 teardown `discardQueued`（update-channel.ts:228-234）；重连需 backoff timer（fake scheduler）推进，用例零 `advanceBy` ⇒ 测试期内不可达。
6. 结论：`expect(run.rootValue('hub', a, 'n')).toBe(40)`（:419）**在任何满足其前置断言的实现下均失败**。R2-4 红灯无法转绿 ⇒ 简报验收第 1 条不可达成；而设计 §12 把 r2-red 冻结为「[SA6 owned] 预期零改动」，SA1 在 ALLOW 内无法自救。
7. 对照实证：同文件 D3c（sa7-dynamic:384-402）的守卫写法是**正确的**——`allowed = floor(lowWater/ackBytes)` 动态实测、断言 `hub n === 43 + allowed`（恰到触发帧）。R2-4B 的守卫应同型，却写成了全量 K。

### 修订要求 #1（可执行）

1. **SA1 修订设计**：§8「R2-4（生效）」走查行更正（实测 57B、allowed=26、耗死于第 27 ACK、hub n ∈ [27,35]）；§12 r2-red 条目由「预期零改动」改为「预期 1 处守卫修订（SA6 域，需总控 dispatch）」并登记依赖；§14 输入契约对照表补记该冲突。
2. **SA6 最小修订**（二选一，建议 A）：
   - A（稳健，同 D3c 型）：`const allowed = Math.floor(1_500 / ackBytes);` → `expect(run.rootValue('hub', a, 'n')).toBe(allowed + 1)`（触发帧所属写已应用）+ 补 `expect(run.rootValue('peer', a, 'n')).toBe(K)`（本地 sequencer 全接受——「不阻塞」的可满足守卫）。
   - B（保 `toBe(K)` 形态）：将 K 改为恰使耗尽落在最后一笔（57B 实测下 K=27），但 ackBytes 随 ackedSequence 序数增长（≥128 时 58B）使 B 脆弱，不建议。
3. **SA1 以实测帧长重算 §4.3/§8 全部数值走查**（本审查已复核其余 7 用例在新数值下均成立：R2-4 独立性 40×57=2280 ∈ (512, 64000) ✓；D3c allowed=floor(100/57)=1 与旧 lowWater=100 数值恒等 ✓）。

### 其余修复形状的独立复核结论（均成立，供 SA3/SA4/SA7 复用）

- **R2-1**：判别点 `sendAndRegister` 入口 + 「队列空⇒响亮 / 非空⇒F4」规则与源码逐行对得上；贪心合并（takeItems 累计原始字节 ≤ maxUpdateBytes，超限项必为单项帧）⇒ 队尾判定完备；D4 场景 F4 时刻队列非空（sa7-dynamic:444-446 实证 BIG 后有 2 笔合法写）⇒ 零适配保持绿；响亮收口后 inFlight>0 时恢复由 `onUpdateAck`（peer-namespace:481-483）重触发、hub 侧等待 peer round（F1 拓扑）——无卡死面；直发路径超限 + 瞬态非空队列的静默 F4 已登记（边界 #4），既有测试无该形态（ac5-live:149 的 maxUpdateBytes=32 是**收侧**门，不经发送路径）。
- **R2-2**：双侧删帧后零出站帧 + close(1008) + blocked/closed 与 frame-io.ts:147-153 的耗尽回调序（onSequenceExhausted 先于 throw，throw 由 sendChecked 全捕收敛 0）自洽；enterBlocked 含 sender teardown（:567）；红灯两用例可转绿。
- **R2-3**：新判据（count `>=` 入队前查 / bytes 严格大于）+ validate 既有 `maxQueuedUpdateBytes ≥ maxUpdateBytes` 复活自洽；受影响测试集经全量 grep 独立验证**恰好**为设计所列 3 个 count=1 用例（其余配置队列上界 100/1000 ≫ 窗口 1/2/32，in-flight 计入与否不达边界；AC-5 走 maxQueuedBytesPerConnection shed，不经 overflows）；三用例各 +1 笔写的适配走查（AC6/F1/⑧a）与断言保持逐条核对无误；R2-5 阶段 2 溢出点 5→7 笔仍在 8 笔窗口内。
- **R2-4 契约面**：`lowWater` 全部 src 消费点 = backpressure.ts:79（改）/ :172/:198（保留水位迟滞）——设计 §5.1/§5.2 声明与源码一致；缺省 64KiB 零漂移成立（defaults.ts:25 实证）；以 lowWater 为额度锚的既有测试恰为 D3a/D3c（ac7-faults:216 仅构造 `.not.toThrow()`，transport 已关，不受影响；ac1-ac7-red/sa7-dynamic 的 `LOW_WATER` 常量仅作 setPeerPressure 值非 limits 覆写）；api.test-d.ts:124-135 与 harness.ts:42-53/126-137 镜像适配定位准确，CONTRACT_LIMITS 无运行时断言消费（grep 实证）。
- **ALLOW/DENY**：`ReplicationLimits` 消费方全仓 = ws-replication 包内 + 测试（grep 实证），穷举字面量仅 DEFAULT 一处——§10 审计属实；7 src + package.json(0.1.1→0.1.2) + 6 test 与五项修复落点一一对应，无越权面。

---

## 协议假设依据审查

- **§11 章节存在**：✅（含 P-1~P-6 继承 + R2-A1~A7 本轮新增，共 13 条）。
- **依据可验证性**：逐条复核通过——R2-A1（r2-red:104-118 恰两笔写、BIG 居尾）、R2-A2（sa7-dynamic:444-446）、R2-A3（frame-io.ts:108 `private lastSeq = 0` 运行时普通属性 + timeline 含 dropped 帧）、R2-A4（peer-connection.ts:565-575 enterBlocked 首行 sender?.teardown()）、R2-A5（§13.2 L371 + §1 不变量 4）、R2-A6（envelope 实证 20B 定长头、sequence 为 writeBe32 定长字段，实测 57B/58B 仅随 ackedSequence 序数变化）、R2-A7（AC6 同一恢复拓扑）全部锚在可定位源码/测试；P-6 带防御面声明（即使失效，漏斗判别兜底），姿态合格。
- **「应该/通常/预计」类无据推断**：未发现。但 **§8 走查的 R2-4（生效）行是「无据断言 ✓」**——其「hub n=40」未经数值推演且与自身描述（~20 笔耗尽关连接）直接矛盾（攻击点 #1）。这属设计自证错误而非协议假设，已单列。

## 错误处理链路审查

- **静默失败**：R2-1 的核心即消灭「终局静默丢失」——队尾（队列空）形态已响亮收口（needsResync + RESYNC_REQUIRED + 恢复 round，红灯 ①② 双分支达成）；残余非队尾静默面已登记 R2-B1 + 运维下界指导 + slice-10 演进位，且被 D4 冻结契约钉死（协议对发送侧超限处置无强制条款）——登记合格，非隐藏决策。R2-2 消灭重复序列 ERROR（自伤面）；R2-4 新配置构造期响亮 TypeError、不运行时 clamp（§17 L494-506 合规）。
- **状态闭环**：响亮路径 needs-resync 状态在 peer 侧经 onUpdateAck:481-483 重触发恢复、hub 侧经 peer round 恢复（F1 实证拓扑）；R2-2 耗尽路径 close(1008)→blocked/closed 闭环。未发现「置标记后无恢复触发点」的新增面（含直发路径 inFlight>0 的延迟恢复场景）。
- **降级路径**：依赖不可用场景（配置病理：单笔真实增量 > maxUpdateBytes）有运维指导与演进位，不以降级掩盖 bug。
- **虚假降级识别**：未发现。「队列非空 ⇒ 静默 F4」的条件（F4 时刻的排序状态）**不是**正常流程恒真前提，不构成把 bug 伪装成降级；其丢失面已被显式登记为风险（R2-B1）而非合理化。

## 红线测试思路

1. **（对应攻击点 #1，必做）** R2-4（生效）守卫修订后的断言形态：`allowed = floor(controlReserveBytes / ackBytes)`；断言 `hub n === allowed + 1`（触发帧所属写已应用——apply 先于 ACK 的可满足化）+ `peer n === K`（K 笔全本地接受，不阻塞 sequencer）+ 既有 1011/backoff/ERROR×1 断言不动。旁证测试：D3c（既有）已是该形态，双态对照即回归锚。
2. **（对应攻击点 #1 的防复发）** 新增一条非冻结 IT（可落 ac7/sa7 域）：reserve=1500、K=40 同构造，断言 `hub n ≤ allowed + 1 + maxInFlightUpdates` 且 `≥ allowed + 1`——把「连接死亡截断数据面」的界钉死在测试里，防止后续再以全量收敛写守卫。
3. **（对应攻击点 #2）** SA4 静态门禁补一条：`grep -c "encodeMessage" peer-connection.ts / hub-connection.ts` 的引用计数与 import 一致（删除后应为 0 引用 0 import）——tsc 无 noUnusedLocals，必须以 grep 兜底。
4. **（R2-1 附加，可选）** 直发路径响亮收口 IT：live + 窗口有余位 + 队列空 + 单笔超限直发 → 断言 RESYNC_REQUIRED ≥1 且 state needs-resync（现无既有测试覆盖边界 #4 的新行为面，grep 实证全量超限构造均经队列路径——补一条防将来形状漂移）。
5. **（R2-2 附加，可选）** 耗尽后零出站帧的守卫已由 r2-red 两用例锁定（严格递增 + 零 ERROR）；无需新增。

---

## 裁决说明

- **reject 的唯一阻断项是攻击点 #1**：它不是修复方案本身的错误（R2-1/R2-2/R2-3 的修复形状与 R2-4 的契约面设计经独立攻击全部站得住），而是设计对**冻结验收契约的可达性验证失败**——§8 自证错误 + §12 把不可达的契约冻结为零改动，将导致 round-3 实现完成后 r2-red 永红、验收第 1 条无法闭合。修订面窄：更正 §8/§12/§14 三处文字 + 向总控登记 SA6 守卫修订依赖（修订要求 #1），无需改动任何修复决策（R2-D1~D6 除 D5 涉及的走查数值外全部维持）。
- 攻击点 #2 需随修订一并更正（防 SA3 按错误文本留下死 import）；#3~#6 为接受性登记，无阻断。
- `pass` 与否不替代 SA4/SA7 对实现与活链路的验证；本报告的源码/测试复核结论（「其余修复形状独立复核」节）供下游直接引用。

---

## 附录：验证证据（命令 + 结果摘录）

1. **UPDATE_ACK 实测帧长**（攻击点 #1 的定量前提）：
   `node_modules/.bin/tsx /tmp/measure-ack.mts`（import 本仓 `packages/replication-protocol/src/index.js` 的 `encodeMessage`，nsId = `ns-`+32hex）：
   `ackedSequence=7 → frame 57 bytes`、`ackedSequence=30 → frame 57 bytes`、`ackedSequence=300 → frame 58 bytes`。
   推导：20B 定长 envelope（envelope.ts 文件头「固定 20-byte 大端 NMCR envelope」）+ varstring(nsId=35 字符 → 1B 长度前缀 + 35B) + varuint(ackedSequence)。
   R2-4（生效）场景 ackedSequence < 128 ⇒ 恒 57B ⇒ allowed = floor(1500/57) = 26，第 27 个 ACK 耗尽。
2. **apply 先于 ACK**：`packages/ws-replication/src/hub-namespace.ts:695-711`——`await pending`（session apply）完成后才 `sendChecked({kind:'UPDATE_ACK',…})`。
3. **peer 在途上界 = maxInFlightUpdates**：`update-channel.ts:74`（deliver 直发门）与 `:166`（pullAndSendOne 前置③）均以 `inFlight.size < max` 限流；`:228-234` teardown 丢弃未发送队列。R2-4（生效）配置 `maxInFlightUpdates: 8`（r2-red:387）⇒ hub 收帧上界 = ACKed(26) + 在途(8) = 34，应用上界 35 < 40。
4. **重连不可达**：`issue137-driver.ts:141` timer = fake scheduler；peer backoff 经 `scheduler.setTimeout`（peer-connection.ts:589 一带），测试零 `advanceBy` ⇒ 测试期内无重拨（r2-red:378-425 无任何 scheduler 推进调用）。
5. **encodeMessage 死 import**（攻击点 #2）：`grep -n "encodeMessage" src/peer-connection.ts src/hub-connection.ts` → peer 仅 :6(import)/:482(删除块内)；hub 仅 :6(import)/:418(删除块内)；:522/:553（peer）/ :372（hub）为 `connectionErrorFrame`。`tsconfig.base.json` 无 `noUnusedLocals`（有 `strict` 但不含该项）。
6. **受影响测试集完整性**：`grep -rn "maxQueuedUpdateCount|lowWater" packages/ws-replication/test`——count=1 边界恰为 ac6:42 / f1:30 / ⑧a:278 三处；lowWater 覆写恰为 D3a:256 / D3c:361 / r2-red:337,385；ac7-faults:216 为构造期 `.not.toThrow()`（transport 已关）；`LOW_WATER` 常量（ac1-ac7-red:45/127/227、sa7-dynamic:79/166）仅作压力注入值。
7. **契约消费面**：`grep -rln "ReplicationLimits" packages apps` → 全部位于 ws-replication src+test（10 文件）；穷举字面量仅 `defaults.ts:16-27` 一处。
8. **D4 契约钉死**：`ws-replication-sa7-issue137-dynamic.test.ts:425-506`——断言同 drain 合法项 ≥2 帧上 wire、超限项零 wire、终态 live；`:444-446` BIG 后有 delete+set 两笔（F4 时刻队列非空实证）。
9. **D3c 正确守卫形态对照**：`ws-replication-sa7-issue137-dynamic.test.ts:384,400,402`——`allowed = Math.floor(100/ackBytes)`、断言 `hub n === 43 + allowed`（Rev R2-4B 应同型）。

---

# R2 轮次（修订复审，2026-08-30）

**Verdict（本轮最终）**: **pass** —— 附 2 项非阻断勘误（N1/N2，须落文但不阻断放行）+ 1 项流程前置（总控向 SA6 dispatch §5.6 钉死形态的守卫修订；设计已正确登记，缺位则验收 1 仍不可闭合）。

- 复审对象：`task_phase5-ws-multiplex-backpressure-r2_design.md` **R2 修订版（617→746 行）**，含文末「SA2 反馈逐条回应」表（6 行）与「R2 修订自查」（自报 12 处落文）。
- 复审方法：对 16 处修订痕迹逐条定位原文核对；对偏差申报（区间守卫 vs 本报告 R1 建议 A）按源码独立验证；对修订后全部数值走查独立重算；R1 已复核结论不重复（R2-D1~D4 修复决策原文逐字比对确认零改动）。

## 1. CRITICAL 修订核验（R1 修订要求 #1 逐条）

| 要求 | 落实 | 核验证据（设计行号 + 独立复核） |
|---|:--:|---|
| §8 走查以实测数值重算 | ✅ | §8（L486-496）：57B / `allowed = floor(1500/57) = 26`（26×57=1482 ≤ 1500；1482+57=1539 > 1500）/ 第 27 个 ACK 触发 connectionFatal / `hub n ∈ [27,35]`——与本报告 R1 推演同口径；§8（L480-484）独立性用例同步换实测值（40×57=2,280 ∈ (512,64,000)；旧实现 ceiling=512 ⇒ 第 9 个 ACK 耗尽）。算术独立复算无误 |
| §12 解除 r2-red「零改动」冻结 | ✅ | §12（L618-623）：改为「预期恰 1 处守卫修订（SA6 域，需总控 dispatch）……属测试锚修正而非软化断言」，并明示「R2-D6 的『r2-red 零改动』子项作废，其余 7 用例与全部构造零改动」。§12 头部声明本清单 = git diff 完整集合（SA4 比对基准）⇒ 权威基准已更新 |
| §5.6 新章钉死守卫修订形态 | ✅ | §5.6（L366-419）：依赖登记 + 定量依据（实测 57B 推演，含死亡时刻逐帧账）+ 钉死形态代码块（三断言，见下节）+ 不采建议 A 的源码级反证 + 非软化论证（三重钉死）+ 吸收本报告 R1 红灯思路 #2 入冻结用例（更强）+ 思路 #4 转为 SA6 可选项登记。形态钉死可执行、无自由度残留 |
| §9 行 6a 依赖登记 | ✅ | §9（L512）：新增 6a 行，登记「SA6 守卫修订（恰 1 处）」+ 不可满足定量结论 + 区间守卫三断言 + 「测试锚修正而非软化」论证 |
| §14 表行 6 冲突登记 | ✅ | §14（L687）：新增行 6，直接标注 SA6 红灯报告 §2「守卫（两实现均成立）」声明**不成立**及理由（守卫位于首个失败断言后从未执行；57B ⇒ 上界 35 < 40），处置 = SA6 修订依赖 |
| 验收对照表登记 | ✅ | 验收第 1 条（L701）：显式注明「R2-4（生效）转绿依赖 §5.6 钉死的守卫修订——原守卫不可满足，不修订则本条不可闭合」 |
| R2-D6 子项作废登记 | ✅ | §5.6（L372-373）+ §12（L622-623）双处。注：`relevant_decisions.md` 为 SA8 域文件，SA1 无权改——设计侧作废声明 + 总控 dispatch 是正确通路；SA8/总控应随后在决议文档同步该子项状态（流程项，非设计缺陷） |

## 2. ⚠️ 偏差申报独立验证：区间守卫 vs 精确 `toBe(allowed+1)` —— **裁决：接受偏差，且承认建议 A 本身有缺陷**

**SA1 的论证链逐环源码验证**：

1. **「在途 apply 必然补完」** ✅ 证实：`hub-connection.ts:365-381 connectionFatal` → `:381 void this.cleanupAll()` → `:358-363 cleanupAll` 对每 channel 调 `channel.onConnectionClosed()` → `hub-namespace.ts:560-567 onConnectionClosed` → `await this.drainPendingApplies()` → `:813-815 await Promise.allSettled([...this.pendingApplies])`（设计 R2-A9 引用的 :814 准确）。且 `:695-711` 中 pending 在 await 前入集合 ⇒ 连接死亡不丢已 dispatch 的 apply。
2. **「精确 toBe(27) 不可钉」** ✅ 证实——这构成对本报告 R1 建议 A 的**正当反驳**：R1 建议 A 标注「稳健」是错误标签——按上面链条，快流水线交错下 applies 28..34 补完 ⇒ hub n 典型 34 ≠ 27，`toBe(allowed+1)` 会以 R1 #1 同型的「守卫值与死亡截断语义矛盾」方式翻红。SA1 用源码证据纠正了 SA2 自己的建议，应予确认。
3. **区间是硬不变量（本轮独立重证，比设计表述更强）**：
   - **下界 `≥ allowed+1 = 27` 确定性成立**：耗尽谓词的消费者只有 ACK 帧（暂停段内 hub→peer 唯一 control 流），ACK #k 只在 apply #k 完成后发射（hub-namespace:698-711）⇒ 触发帧恒为第 27 个 ACK 的尝试 ⇒ apply #27 必已完成且其文档值先于断言可观测。
   - **上界 `≤ allowed+1+maxInFlightUpdates = 35` 确定性成立**：任意时刻 `发送数 ≤ 已收 ACK 数 + 窗口(8)`（每帧占用一个窗口位直至 ACK——deliver 直发门 update-channel:74 与 pullAndSendOne 前置③同守此界）；fatal 时刻 ACK=26 ⇒ 发送 ≤ 34 ⇒ 应用 ≤ 34 ≤ 35。**该上界由窗口算术保证，与投递时机无关**（见 N2：设计的「同步投递」机制描述不准，但结论不受影响）。
   - 故区间 [27,35] 钉死的恰是**全部语义确定性**——精确值在 [27,34] 跨微任务交错非确定，任何 toBe 都会引入伪确定性。
4. **「非软化 + 红灯语义保持」** ✅：核心红灯断言（1011 + backoff + ERROR×1 + 牙口元断言）零改动；修订只针对数据面守卫，且新守卫三断言分别钉死「额度耗尽不阻塞 apply（下界）/ 连接死亡截断数据面（上界，全量收敛守卫永久不可回归）/ 本地 sequencer 全接受（peer n === K）」——比原 `toBe(40)` 更强而非更弱（原守卫断言了一个不可满足的值，等于断言 false）。区间形态即本报告 R1「红线测试思路 #2」原文 published 的界，SA1 逐字采纳并吸收进冻结用例（消灭了另落非冻结 IT 的需要）——成立。

## 3. MEDIUM / LOW×4 处置核验

| R1 项 | 落实 | 核验 |
|---|:--:|---|
| #2（MEDIUM）§3 import 事实错误 | ✅ | §3（L257-271）R2 重写：精确到行的 import 前后形态（peer:6 改 `import type`；hub:6 删 `encodeMessage` 留 `selectProtocolVersion`）+「收口 ERROR 走 connectionErrorFrame→emitControl→OutboundQueue 内部编码，不经 encodeMessage」的机理说明 + **SA4 grep 门禁登记**（两文件 `grep -c encodeMessage` = 0，明示 tsc 无 noUnusedLocals 不可依赖）。与 R1 证据一致，无遗留 |
| #3（LOW）reasonCode | ✅ | §2.2（L174-178）追注：自由非空字符串依据 + R0-1 受约束最优解 + slice-10 演进位。接受性登记，无需动作 |
| #4（LOW）close 1008 | ✅ | 回应表行 4：预存灰区、delta 外、维持。无动作（与 R1 裁定一致） |
| #5（LOW）§2.3 措辞 | ✅ | §2.3（L197-207）R2 重写：显式撤回「保证触发的 reconciliation」表述（「健康 live 连接上不存在保证触发的 reconciliation，非队尾超限丢弃可无限期静默存续」），合法性依据收窄为 D4 冻结契约 + 协议无强制条款两条，残余面归 §13.2 R2-B1「显式登记的已接受风险，不是修复保证」。措辞与 R1 要求完全对齐 |
| #6（LOW）patch bump | ✅ | 回应表行 6：简报强制 + §10 审计闭合 ⇒ 维持 0.1.1→0.1.2。与 R1 裁定一致 |

修复决策零改动确认：§2.2 代码块、§3 代码块、§4.1 判据、§5.1 四点改动逐字比对 R1 版——R2-D1~D4 原文未动 ✅。

## 4. 本轮新发现（均非阻断）

| # | 严重度 | 位置 | 问题 | 要求 |
|---|--------|------|------|------|
| N1 | MEDIUM（文字勘误，不阻断） | §5.4 末行（L356） | **内部矛盾残留**：r2-red 行仍写「**零改动**……[SA6 owned] 断言与构造零触碰」，与 §5.6/§9-6a/§12/§14-6/验收表五处已修订的「恰 1 处守卫修订」直接矛盾。§12 是权威 diff 基准（其头部声明），实质无歧义；但该残留行是 R1 CRITICAL 同类病灶（冻结契约记账自相矛盾）的未清尾巴——SA6/SA4 并读 §5.4 时存在误读面（「12 处落文」清单显示 §5.4 被触及但只改了 D3c 行的实测数值注） | 1 行修订：r2-red 行改为「守卫修订 1 处（§5.6 钉死形态，SA6 域 dispatch）+ 其余构造/断言零改动」。SA1 可径直落文，无需再过 SA2 全审（本轮已核其余内容） |
| N2 | LOW（依据行措辞，不阻断） | §11 R2-A10（L582）+ §5.6（L380-383, L491-493） | 「makeWire **同步投递**、dispatch 先于 closedFlag ⇒ 34 帧全达、applies 28..34 必然补完（典型 34）」的**机制描述不准**：`harness.ts makeEnd.send` 经 `queueMicrotask` 延迟投递（非同步），fatal 后才到达的帧被 `hub-connection.ts:184-185` closedFlag 守卫丢弃 ⇒ 实际 hub n ∈ [27,34] 跨交错非确定，「典型 34」是上界场景而非保证。**结论不受影响**：区间 [27,35] 的上界由「发送 ≤ ACKed + 窗口」窗口算术保证（与投递时机无关），下界由「apply #27 先于其 ACK 尝试」确定性保证——且该事实**进一步支持**区间形态、强化拒绝任何精确 toBe 的论证 | 1-2 句措辞修正：投递为 queueMicrotask 延迟、closedFlag 守卫兜底、「34」为上界非典型值。防 SA4/SA7 复核时按「典型 34 / 必然补完」验证失败而误判 |

## 5. 放行条件与下游消费锚

1. **流程前置（非设计缺陷，设计已登记）**：总控须向 SA6 dispatch §5.6 钉死形态的守卫修订（r2-red R2-4（生效）末段三断言 + 1011/backoff/ERROR×1 不动）；SA8/总控随后在 `relevant_decisions.md` 同步 R2-D6「r2-red 零改动」子项作废状态。缺 dispatch ⇒ 验收 1 不可闭合（§14-6/验收表行 1 已明示该依赖）。
2. **SA4 静态门禁**（设计 §3 已登记）：`grep -c "encodeMessage" src/peer-connection.ts src/hub-connection.ts` 两文件计数 = 0。
3. **SA7 活链路锚**：R2-4（生效）修订后守卫的实测落点应在 [27,35] 内（预期常见 27~34，取决于写循环与 apply 链的微任务交错）；SA7 无需按特定精确值验证（N2 修正后设计不再声称「典型 34」）。
4. N1/N2 两处勘误建议随 SA6 dispatch 同批落文（均为 1-2 行，不动任何决策）。

## 6. R2 轮验证证据（命令 + 结果摘录）

1. **修订痕迹定位**：`grep -n "R2 修订" design.md` → 16 处（横幅/§2.2/§2.3/§3/§5.4-D3c/§5.5/§5.6/§8×2/§9-6a/§11×3/§12×2/§14-6）+ 回应表 + 自查节，逐条读原文核对（与本报告第 1/3 节表格一一对应）。
2. **偏差论证链源码验证**：`hub-connection.ts:184-185`（onMessage 首行 closedFlag 守卫）、`:358-363`（cleanupAll → 每 channel onConnectionClosed）、`:365-381`（connectionFatal → :381 cleanupAll）；`hub-namespace.ts:560-567`（onConnectionClosed → drainPendingApplies）、`:813-815`（`await Promise.allSettled([...this.pendingApplies])`）、`:695-711`（pending 先入集合、await 后才发 ACK）；`harness.ts makeEnd.send`（`queueMicrotask(() => { for listener … })`——**延迟投递实证，N2 依据**）。
3. **窗口算术上界**：`update-channel.ts:74`（deliver 直发门 `inFlight.size < max`）+ `:166`（pullAndSendOne 前置③）⇒ 任意时刻 发送 ≤ ACK + 窗口；fatal 时 ACK=26、窗口=8 ⇒ 发送 ≤ 34。
4. **57B 帧长**：R1 附录 1 实测维持有效（本场景 ackedSequence < 128 恒 57B；wire 序列 ≈ HELLO+OPEN+bootstrap+40 UPDATE < 128）。
5. **修复决策零改动**：§2.2/§3/§4.1/§5.1 代码块与 R1 版逐字 diff（人工比对）——无任何谓词/判据/配置面形态变化。
6. **peer n === K 可满足性**：`issue137-driver.ts:153-166 write()`（mutateRoot await = 本地 sequencer 槽完成）+ r2-red 循环 `for n=1..40 await peerWrite` ⇒ 断言时 peer 文档 n=40 确定性成立。

## 7. R2 轮裁决

**pass**。R1 唯一阻断项（CRITICAL #1）的修订**全部落实且经独立验证成立**：数值走查重算正确、冻结解除与依赖登记完备（§5.6/§9/§12/§14/验收表五处一致）、守卫修订形态钉死为**语义确定的硬不变量区间**（下界确定性 / 上界窗口算术保证 / 红灯核心断言零触碰——非软化）。偏差申报（区间 vs 精确 toBe）**接受**：其对建议 A 的源码级反驳成立（drainPendingApplies 补完在途 apply），R1 建议 A 的「稳健」标签系 SA2 自身失误，本案予以更正承认；区间形态即 R1 published 界，采纳正确。MEDIUM #2 与 LOW×4 全部落实。新发现 N1（§5.4 残留矛盾行）/N2（投递机制措辞）均为 1-2 行文字勘误，不动任何决策，**不构成阻断**——随 SA6 dispatch 同批落文即可。`pass` 不替代 SA4/SA7 对实现与活链路的验证；SA6 守卫修订落盘后，红灯转绿验收以 §5.6 钉死形态为准。
