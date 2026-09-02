# 冲突门禁报告（设计后复审，Revision Round 2）

- 被审对象：`wiki/raw/task_phase5-ws-multiplex-backpressure-r2_design.md`（SA1 r2 delta 设计，617 行；§0.3 登记 round-1 D3/D10 子项推翻，§12 ALLOW/DENY 修订）
- 冲突基准：ADR 全集 `docs/adr/0001`–`0010`（10 个，本会话全量逐个读取）+ `CONTEXT.md` + `docs/protocols/instance-replication-v1.md`（ADR 0010 L151 指定的唯一 wire contract，具 ADR 级约束力）+ `docs/phases/phase-5-websocket-replication.md`；round-1 设计文档与 SA6 红灯测试**不构成冲突基准**（前者是被审对象的基线文档，后者是冻结行为契约），但按总控指令对「round 1 设计登记」做了对账复审
- 审查方式：设计后复审（轻量 delta）——前置门禁（round 2，verdict `clear`）已做全量盘点，本轮只裁决 r2 设计引入的新决策点；前置门禁三条非冲突注记（①配置面 ALLOW 登记 + §17 L494–506 纪律、②R2-1 路径选择权 + UPDATE_TOO_LARGE failed 终态警示、③两级队列属主红线）逐条复核设计回应
- 审查轮次：run_id issue-137-1787922674-8367, round 2（Phase 2 设计后复审）

## Verdict

`clear`

## 重点裁决（总控指定四项）

### ① types/defaults/validate 原 DENY 解除 + `controlReserveBytes` 新契约字段 — no-conflict

| 检查项 | 设计落点（§5.1） | 基准条款 | 裁决 |
|---|---|---|---|
| 独立保留额度的存在性 | `ReplicationLimits` +必填 `controlReserveBytes: number` | 协议 §17 L490「Control frame有独立保留额度，耗尽为 `CONNECTION_BACKPRESSURE`」——独立额度本就是协议要求；review R2-4 与 SA8 注记 ① 显式要求配置面 | no-conflict（DENY 解除是**回归一致**而非引入偏离） |
| 配置纪律三件套 | 缺省 `64*1024`（== 旧 lowWater 缺省 ⇒ 缺省行为零漂移）+ `positiveSafeInteger` 构造期响亮 TypeError + 零运行时 clamp | §17 L494–506「配置启动时响亮验证……不得运行时 clamp」+ ADR 0010 L165「以下上限均为插件配置并提供安全默认值」 | no-conflict |
| 零跨字段约束 | 不加 reserve↔水位/reserve↔其他上限约束 | §17 L494–504 校验清单为「必须验证」的最低枚举，未列 control reserve 相关不变量；L503 仅 `low-water < high-water`——不加约束不违反任何条款 | no-conflict |
| lowWater 语义收窄 | §5.2 声明 lowWater 运行时语义仅剩水位迟滞两处（:172/:198） | §17 L492「超过 high-water暂停 dequeue，降至 low-water恢复」——收窄后与 L492 逐字对齐；round-1 D3 的量纲借用才是偏离 | no-conflict |
| round-1 登记对账 | §0.3 显式推翻 D3、D10 子项解除到最小改动；§12 三文件标「原 round-1 DENY 显式解除」并附理由 | 简报 R2-4 ⚠️ 条款 + SA8 r2 报告注记 ① 的登记义务 | no-conflict（登记完备，链路对账成立） |
| 公共契约面增长 | `ReplicationLimits` 10→11 必填字段；§10 审计：包外零消费、穷举字面量仅 `DEFAULT_REPLICATION_LIMITS` 一处、漏配被 tsc 结构检查捕获 | ADR 0010 L174 只冻结包职责边界（`@nomicore/ws-replication` 含背压），无字段数/形状冻结条款 | no-conflict |

### ② R2-1 队尾限定 resync 收口（否决 UPDATE_TOO_LARGE） — no-conflict

| 检查项 | 设计落点（§2） | 基准条款 | 裁决 |
|---|---|---|---|
| 路径选择权 | 选 ②「发送失败时进入 resync」，否决 ③ | SA8 r2 报告注记 ② 授予选择权（三条路径均协议合法） | no-conflict |
| UPDATE_TOO_LARGE 否决的正当性 | 终态 failed ⇒ §1 不变量 4/§16 同连接禁重开——对「可 round 修复」形态过重 + R0-1 零状态机迁移红线 | §13.2 L371 注册行 `UPDATE_TOO_LARGE \| yes \| config \| failed` + §1 不变量 4 L24 + §16 L468——设计对终态后果的引用准确；resync 路径不触发该约束 | no-conflict（A5 假设登记正确） |
| 收口动作的协议同构性 | 队尾超限 ⇒ `discardQueued()`（空 no-op）+ `needsResync` + `declareLocalResync()`，复用 reasonCode `'send-queue-overflow'`，停发新 UPDATE，恢复走新 round state-vector diff（受 `maxSyncDiffBytes` 独立约束） | §17 L488 溢出拓扑同构 + §9.4 L248「发出后不再发送新 UPDATE……Peer等待 in-flight 窗口收口后开始新 round」+ §1 不变量 9 L29「队列丢弃均由 state-vector reconciliation 修复」——字面拓扑吻合 | no-conflict |
| 状态机红线 | 零新状态、零迁移改动、零新 wire 码/reasonCode | §16 namespace 状态机（needs-resync→reconciling 既有路径）+ R0-1 自设红线 | no-conflict |
| 队尾/非队尾二分 | 队列空 ⇒ 响亮（终局静默不可达）；队列非空 ⇒ 维持 F4 静默（D4 钉死域）；非队尾残余静默登记 R2-B1 演进位 | 协议未定义发送侧超限项处置（§10.1 L259 只钉「最大 maxUpdateBytes」不可发）；review R2-1 命中的是终局静默形态；非队尾静默依赖后续 reconciliation 触发面（§9.4 L250 触发枚举内），round-1 B-2 R4 配置病理域同族 | no-conflict（见非冲突注记 2——残余面已显式登记，非隐藏决策） |

### ③ R2-2 删 0xffffffff ERROR 直发 — no-conflict

| 检查项 | 设计落点（§3） | 基准条款 | 裁决 |
|---|---|---|---|
| 字面一致性 | 耗尽 ⇒ 零出站帧 + `transport.close(1008, 'sequence-exhausted')`；删除的 ERROR 直发正是重复序列 0xffffffff 的唯一来源 | §14 L391「如果 framing仍可信，关闭前 best-effort发送 connection ERROR；**否则直接 close**」——sequence 耗尽 = 序列分配面已死 = framing 不可信的字面情形 | no-conflict（字面吻合） |
| 严格递增 | 修复后本方向不再产生任何重复/回绕序列帧 | §1 不变量 2 L22 + §3 L54 + ADR 0010 L147「每方向sequence从1严格递增，不回绕；gap、repeat或错误ACK关联关闭连接」 | no-conflict |
| close code 1008 | 保持 round-1 既有映射（CONNECTION_POLICY_VIOLATION 注册行 WS close 1008），本轮只删帧不改码 | §14 分类中「1002：bad framing、sequence……」与 1008（policy）的归属是 round-1 已接受映射，非本轮 delta 引入；§15.1 L439 1002/1008 同归 blocked，状态机面等价 | no-conflict（见非冲突注记 3——预存灰区，delta 外） |
| 收口拓扑 | peer `enterBlocked()`（含 sender teardown）/hub `closedFlag`+`cleanupAll` 既有路径不动 | §15.1「permanent protocol failure → blocked」 | no-conflict |

### ④ 既有测试适配面 — no-conflict（无隐藏契约破坏）

| 适配项 | 契约破坏检查 | 裁决 |
|---|---|---|
| 3 个溢出测试（ac6/F1/⑧a）各 +1 笔写 | 旧断言编码的正是 review R2-3 判定的**缺陷边界**（in-flight 计入 queued 判据）；适配只推回触发点，被验证语义（AC3 溢出声明/round 修复/F1 hub 侧声明/⑧a fence 流程）断言原样；简报验收 3「AC1–AC7 语义保持」在此读作协议语义保持——R2-3 本身即简报强制要求，测试适配是被 Review 要求**蕴含**的必然结果，设计 §4.2 已显式论证「改边界而非软化判据」 | no-conflict |
| D4 零适配（sa7-dynamic:425-506） | D4 钉死「超限首项 F4 后同 drain 合法项照发 + 终态 live」——设计把 D4 作为 R2-1 修复形状的硬约束（§2.3 必要性论证）而非绕过对象；该钉死行为不违反任何协议条款（协议未定义发送侧超限处置），维持 = 维持 round-1 已验收行为 | no-conflict |
| D3a/D3c 各 +1 行、D3b 零改动 | 覆写锚从 lowWater 换 controlReserveBytes、数值语义逐帧等价（缺省零漂移 §5.3）；断言逻辑零改（仅 ~3 处措辞） | no-conflict |
| api.test-d.ts +1 行 / harness.ts +2 行 / r2-red 零改动 | 单向结构匹配（不加也绿）+ 纯镜像同步（grep 证实无运行时断言消费）+ SA6 owned 不可改地位声明 | no-conflict |
| R2-5 红灯溢出点后移（第 5→第 7 写） | §4.3 数值走查：仍在对抗窗口 8 笔内，断言语义（溢出收口 + bounded-memory）不变 | no-conflict |

## ADR 复核（delta 摘要）

前置门禁（round 2）10/10 no-conflict 的盘点未被本设计推翻：0001–0005 未触及；0006 未触及 Persistence；0007 被取代条款不构成约束；0008 #132 status 边界维持（零 Runtime status 触碰，§0.2）；0009 Cordis Timer 纪律维持（零原生 timer 引入，R2-5 用 fake scheduler）；0010 权威域逐条吻合——L143（零 multiplex 面改动）、L147（R2-2 正向对齐）、L151（唯一 wire contract：全部修复向协议收敛、零新码、背压不进 Runtime sequencer）、L165（新上限=插件配置+安全默认）、L167（零 observer 面改动）、L174（包边界内）、L177（零 transport 面改动）、#134 round-2 两级队列属主边界维持（§7-4 对账 + §12 DENY 明示 registry/runtime/doc-runtime 零触碰）。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | — | — | — | — | 未发现直接违反 ADR/CONTEXT/wire contract 的设计决策；无未声明推翻、无未走正式 supersede 的实质演进 |

## 结论

**Verdict: `clear` —— 放行（设计后复审通过）。**

- 冲突点数：0；裁决分布：no-conflict 4/4（总控指定重点）+ 10/10（ADR 层面复核），override-declared 0，evolution 0，hard-violation 0。
- 前置门禁三条非冲突注记的回应全部落实：①ALLOW 登记完备（§0.3/§12）且 §17 L494–506 三件套（安全缺省/构造期响亮/不 clamp）逐项满足；②路径选择在授权自由度内、UPDATE_TOO_LARGE 否决理由与终态警示引用准确；③两级队列属主红线经 §7-4 对账表 + DENY 清单双重维持。
- 相关决议文档已按设计后复审义务追加 R2-D1~R2-D6（`task_phase5-ws-multiplex-backpressure-r2_relevant_decisions.md`「设计后复审追加」节），供 SA2/SA3/SA4/SA7 比对。
- 四条非冲突注记（供 SA2 攻击评审参考，不构成门禁约束）：
  1. **reasonCode `'send-queue-overflow'` 复用的语义张力**：R2-D1 队尾收口的真实诱因是「单笔超限」而非「队列超限」，与 round-1 D6 连接总压 shed 共用同一 reasonCode——协议 §9.4 仅要求「稳定安全原因」字符串，不要求按诱因区分，且 R0-1 零新枚举红线使复用成为受约束下的最优解；但 wire 语义上两种诱因不可区分，SA2 可评估是否接受（接受则维持，不接受属 slice-10 枚举扩张演进位）。
  2. **R2-B1 残余静默面已显式登记**：非队尾超限丢弃在无后续触发时静默发散存续——设计未隐藏该边界（§13.2 R2-B1 + 运维指导维持 + D4 域论证），且协议对该形态无强制响亮条款；此为协议自由度内的已登记取舍，非冲突。若 Jim 认为全形态响亮是应有语义，那是协议演进诉求（走修订），不是本设计的违规。
  3. **close code 1008 预存灰区**：§14 分类中 sequence 类协议错误更贴 1002，sequence 耗尽沿用 1008（policy）系 round-1 已接受映射；本轮 delta（删帧）严格改善一致性，未引入新偏离——扩大到改码会超出 R2-2 最小修复范围。SA2 可探测，门禁不要求动作。
  4. **验收 3「零回归」的读法已被设计显式化**：6 文件适配均为 review 强制语义修正所迫且逐条登记（§1.3 勘察 → §4.3/§5.4 适配 → §9 回归面），无「为绿而改断言」项——D4/r2-red 两个不可改契约零适配通过，佐证修复形状受冻结契约约束而非反向。
