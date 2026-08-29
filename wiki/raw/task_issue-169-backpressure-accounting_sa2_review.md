# SA2 攻击评审报告 — issue #169 连接级背压记账 / 控制保留额度 / poll 公式

**Date**: 2026-08-29（R1）/ 2026-08-29（R2）/ 2026-08-29（R3）/ 2026-08-30（R11 裁定复审）/ 2026-08-30（R12 复审，见文末「R12 退休账本独立复审」节）
**Verdict**: R1 = **reject**（R1-R8）→ R2 = **reject**（R9/R10）→ R3 = **pass** → R11 复审 = **pass** → 双轴 BLOCK（推翻 SA7 F1 非阻断归类）→ v5 → **R12 复审 = pass** —— kind-aware 退休账本经机理结构、G3b 重走、D1 反转算术（对落地测试构造独立复算）、aggregate-only 保守性双轴向独立推导四维核验成立；「data flush 绝不释放控制额度」为优先序结构性保证；R3/R11/压力侧/窗口语义零改动。4 条非阻断备注（NC-5 跨窗口候选类未入 §14.6 枚举 / NC-6 v4 违反叙事数字与落地构造有 12↔13 帧出入 / NC-7 D1 ★ 断言反转的 owner 未指名 / NC-8 附录 teardown 清单漏列两计数）。本轮为设计门禁——v5 实现与 D1 反转由后续 SA3/SA6 轮落地并经 SA4/SA7 复证。

**被审对象**：`wiki/raw/task_issue-169-backpressure-accounting_design.md`（SA1，631 行）
**审查方式**：全新视角；全部关键声明对照源码（`backpressure.ts` / `frame-io.ts` / `update-channel.ts` / `hub-connection.ts` / `peer-connection.ts` / `types.ts` / `defaults.ts` / `validate.ts` / `hub-namespace.ts` / `peer-namespace.ts`）、红灯契约（17 用例）与全部既有测试套件逐一复核；独立重跑了设计自称的审计 grep。

---

## 〇、先行结论摘要

SA1 的根因模型（P1–P4 四相位、P2 结构性缝隙、六处偏差）**与代码实况完全吻合**（本评审核对了全部引用行号，无一虚指）；P2 台账、暂停窗口控制额度、poll 公式、字段迁移、G1–G9 逐条走查数值**全部独立复算成立**；DENY LIST 对 PR #162 单数据面的保护、1011 接线零改动的论证成立。核心方向 **不需要推翻**。

但攻击找到 **4 个必须修订的实质漏洞**（R1/R2 为已实证的审计与算术错误，R3/R4 为可达生产缺陷面）与若干文档级问题。以下逐条给出触发条件、影响、修订要求与测试构想。

---

## 一、攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 修订要求 |
|---|--------|--------|---------|---------|
| R1 | **HIGH** | §11/§15/§17 caller 审计 | **迁移清单漏掉 `test/ws-replication-sa7-hardening-dynamic.test.ts`**——:473 `new ConnectionSender({...})` 宿主字面量**未提供**新必填 `ackTimeoutMs` 且**无 cast**（对照红灯测试 ：210 有 `as unknown as` cast），C2 落地即 `pnpm run typecheck` / `vitest --typecheck` 红；:424-435 `QUEUE_LIMITS as ResolvedLimits` cast 今天就在撒谎（无 `controlReserveBytes`），迁移后将缺 `maxQueuedControlBytes` → 若 SA6 只做「加 ackTimeoutMs」最小修补，`sendControl` 额度判据读到 `undefined` → `number > undefined = NaN 比较 = false` → **额度检查静默失效**（测试 harness 内的静默失败面，违反 I-7 响亮纪律）。设计声称的审计命令 `git grep -n "ConnectionSender("` 实际输出 **5 处**构造点（hub / peer / review-revisions:509 / **sa7-hardening:473** / sa7-round2:722），设计只记录了 4 处——**审计未真正执行或结果被错抄**，「caller 清单已抓全」「其余既有套件零改动」两项声明被 falsify | (a) §11 表追加该文件行：`ackTimeoutMs: 10_000`（或与用例语义一致的值）+ `maxQueuedControlBytes` 显式补齐或改用 `resolveLimits()` 构造 QUEUE_LIMITS（cast 不再遮缺键）；(b) §15 ALLOW LIST 测试清单同步追加；(c) §11 引言「7 个测试文件」改 8、§12.4 同步；(d) 重跑并如实转录三组审计 grep 输出 |
| R2 | **HIGH** | §11 #6（D3b 迁移配方） | **帧头算术错误：BOOTSTRAP 帧头是 93B 不是 ≈293B**。设计原文「BOOTSTRAP 帧头 ≈293B，G3b 探针 16,477−16,384」——16,477−16,384 = **93**（UPDATE 16,443−16,384=59，BOOTSTRAP 多出 replicationId 32B + epoch ≈2B = 93；红灯 G3b 探针断言已实测通过，数值无可争议）。连锁后果：配方的「设 maxBootstrapBytes=P、quota=P+128 → F=P+293 > P+128 → **首帧即耗尽**」不成立——真实 F=P+93 < P+128 ≤ quota，**在「quota ≥ maxBootstrapBytes+128」启动约束下，单帧合法 BOOTSTRAP 结构上永远不可能是首过限帧**（可行区间为空集；设计写的「maxBootstrapBytes ∈ (P−149, P]」同样推错方向）。SA6 照配方写出的迁移测试必然红：第 1 帧被放行（打破「BOOTSTRAP 零上线」锚），第 2 帧才耗尽 | 重写 §11 #6，三选一并重推全部数字：(a) 双帧耗尽配方——quota=mb+128 恰值，断言组改为「恰 1 帧 BOOTSTRAP 上 wire + ERROR×1 + 1011 + backoff + 恢复」；(b) 换不受 maxBootstrapBytes 链约束的控制帧类（如 SYNC_STEP2，其 payload 上限=maxSyncDiffBytes，quota 只与 maxBootstrapBytes 链接）保「首帧即耗尽」，但须明示被测面从 BOOTSTRAP 迁移；(c) 采纳设计自己的退路——按 G8/G9 新语义改写，并在设计中**明文登记**「单帧合法 BOOTSTRAP 自杀在修复后结构性不可达」（这本身就是缺陷已修的漂亮断言）。任一选型都必须给出正确的帧头常量及其来源 |
| R3 | **HIGH** | §3.4/§6 统一台账触发项 | **已吸收未冲刷控制字节在 shed 触发中被双重计数 → 可达的假阳性 shed（破坏性）**。机理：暂停窗口内交接的控制字节计入 `controlUnflushed`；被 socket 吸收后 `bufferedAmount` 上升（deltaUp）使 `lastObservedBuffered` **同时**包含这批字节——而 §3.2 规定 deltaUp 只释放 data 侧、**不释放** `controlUnflushed`（该定向对「额度」判据是 G3b 钦定的正确语义，但对「总压」判据造成同一批字节进两个账本）。触发条件（真实可达）：jam（observed≈600KiB data）+ 暂停窗口内放行一帧 4MiB BOOTSTRAP（缺省 quota 8MiB 内合法，G9 同构场景的 4MiB 文档版）且被吸收 + 其他 ns 排队 2MiB → 台账 = 4.6MiB + **4MiB(control 重复计)** + 2MiB ≈ 10.6MiB > cap 8MiB → **假 shed**：全部排队 data 被丢到 lowWater + 多 ns needs-resync；而协议公式（queued + bufferedAmount = 6.6MiB ≤ cap）不溢出。高估倍率上界 = min(controlUnflushed, 窗口内 observed 上升量) ≤ maxQueuedControlBytes（缺省 8MiB）。I-4「只允许高估」不是免罪牌——shed 是**破坏性**动作，假阳性 = 无谓数据丢失 + reconcile 风暴；且协议 §17 总账公式并无第二个 control 项，这是对 SA8 已裁「口径落实」结论的**实现级偏离**（SA8 裁定时未审出吸收期双计） | 总压触发项中的 control 贡献改为**未吸收**交接控制字节（deltaUp 即释放——与 data 侧 P2 同构），「未冲刷窗口台账」只用于 §4.3 额度判据：即拆成 `controlPendingHandoff`（喂 totalPressure，吸收释放）与 `controlUnflushed`（喂额度，冲刷释放+窗口重置）两个账本。这同时修复 R4 的 I-1 破缺，且仍是「queued+buffered 的无缝隙落实」，不触碰 SA8 裁定。若 SA1 坚持不拆账本，则必须在 §3.4/§14 给出双计上界推导 + 假 shed 可达性分析，并明示接受破坏性假阳性的理由（不建议） |
| R4 | **MEDIUM** | §2 I-1 / §4.2 / §14.2 | **I-1 不变量对「非暂停期交接的控制帧」为假 + §14.2 残余暴露界错误**。I-1 称控制帧「同理（P2'→P3→P4）任一时刻恰好落在一个相位、恰好被一个账本计入」——但 §4.2 `onEmitted` 只在 `paused` 时累计 `controlUnflushed`：非暂停期交接、未吸收的控制帧**不在任何账本**（P3 未反映、P2' 不计、P2 是 data 专用）→ I-1 被自己的伪代码打破，总压对它有盲区。且 §14.2「暴露 ≤ 一帧 + 观察滞后」在任务自己的前提（bufferedAmount 异步滞后，G1 的立论基础）下**不成立**：同一同步栈可连发 N 个控制帧（单帧可达 maxBootstrapBytes+开销 ≈ 4MiB），栈内观察值零变动 → 全部免检（例：hub 在一个栈里响应多 ns 的 OPEN/SYNC/BOOTSTRAP 风暴）。现实现同形（非回归）、缺面 dormant 模式按 B 读法免检是设计意图，但**设计文本断言了一个假界** | (a) 修正 I-1 措辞：控制相位声明只覆盖暂停窗口内交接的控制帧，非暂停控制交接的盲区单列为已知暴露；(b) §14.2 界改写为诚实形式：「单同步栈内无界（上界 = 栈产生的控制字节总量；实践上受 socket 排水速率 × 栈时长约束）；缺面模式恒免检（dormant 语义）」；(c) 若采纳 R3 的双账本修订，`controlPendingHandoff` 恒计账即可同时收窄此盲区到「一帧 + 观察滞后」且 dormant 不假杀（其释放走 deltaUp，与额度窗口无关）——推荐一并解决 |
| R5 | **MEDIUM-LOW** | §3.3 释放方向性论证 | **deltaUp⇒data 已吸收的归因依赖未声明的 FIFO 假设**。缓冲区里 data/control 字节不可区分，一次上升无法归因；「上升 ⇒ 释放 pendingDataHandoff」只有在「吸收按交接序（FIFO）」时才精确（真实 WS 传输满足，设计未声明）。非 FIFO/观察乱序下，控制帧的吸收会错误释放 data 台账 → 欠计（严格违反 I-4 的方向声明）。§16 证据表亦无此假设条目 | §3.3 与 §16 各补一条：FIFO 吸收假设 + 依据（如 `ws` 库 send 队列语义/浏览器 bufferedAmount 语义的官方文档引用），并给出假设不成立时的欠计上界；或改用 R3 双账本后把「data 释放归因」改为与 control 分账对冲，声明残余风险 |
| R6 | **MEDIUM-LOW** | §14.4 缺面 dormant 长期累积 | **缺面连接的数据面永久饱和无终局信号**。buffered 恒 0 ⇒ 永无 deltaUp ⇒ `pendingDataHandoff` 只增不减 ⇒ 单连接累计发满 cap（8MiB）后**一切 data 准入永久拒绝**：数据侧不 1011（G1 钦定）、连接不重连（控制面照常）、needs-resync/reconcile 无限空转，本地写永不上行——活锁而非收口。设计的护栏是 issue #164 装配期断言，但 **#164 在本仓尚未实现**（本次审查 grep 证实 apps/ 零 adapter、无任何装配期缺面断言）——即护栏今天是期票不是事实 | (a) §14.4 明文登记「依赖 #164 落地前，任何缺面组合将命中此悬崖」并把可观测症状写实（observer seam 的 backpressure-resync 计数单调升 + UPDATE 字节零增长——ADR-0010 最小观测面已含 backpressure resync 项）；(b) 至少给出一个响亮信号设计（如 P2 饱和跨一轮 reconcile 未释放时经 observer seam 上报事件；**不是**运行时 clamp，不违反 §17）；(c) 红灯侧补缺面饱和行为测试（见测试构想 T6） |
| R7 | LOW | §11 #8 与 §17 C2 自相矛盾 | §11 #8（review-revisions QUEUE_LIMITS 迁移）配方只写「2 行」（bootstrap 16KiB + 字段改名），未含 §17 C2 自己要求的 R2-A2a 宿主（:509）补 `ackTimeoutMs`——同一文件两处口径不一致，SA6 照 §11 执行会漏改再红一次 | §11 #8 配方补第 3 处改动：host 增 `ackTimeoutMs: 10_000`（与 §17 C2 行对齐） |
| R8 | LOW | §16 A11 / 头部声明 | §16 证据本身可验证（本次逐条核对 frame-io:165-166 / hub:435-442 / peer:499-508 / validate.ts:14,118 / update-channel:90-93,160-166 全部行号属实），但 §11 #6 的 293B 帧头（见 R2）与 §14.2 的暴露界（见 R4）是**无据推断混入设计正文**——按 2026-06-13 立法标准应予拒绝并要求补据 | 随 R2/R4 一并修订；§16 增补 FIFO 假设条目（随 R5） |

---

## 二、协议假设依据审查（2026-06-13 立法）

- **章节存在性**：§16 存在，11 条假设（A1–A11）带类型标注。✅
- **依据可验证性**：抽查 A1（红灯探针 L279/L345 实测值）、A2（frame-io.ts:165-166 逐字核对）、A3（hub:435-442 / peer:499-508 逐字核对）、A4/A6（validate.ts:161、hub:61-63、peer:71-74 核对）、A5（createRegistryTestScheduler 存在于 namespace-registry/src/testing.ts:74）、A8/A9（update-channel.ts:90-93 / 160-166 核对）——**全部可定位、可复跑**。✅
- **无据推断**：两处混入正文而非 §16 的无据推断被本次攻击证伪——§11 #6 的「BOOTSTRAP 帧头 ≈293B」（实测 93B，见 R2）与 §14.2 的「暴露 ≤ 一帧 + 观察滞后」（同步栈内不成立，见 R4）。§16 表内无「应该/通常」类措辞。⚠️ 需按 R2/R4/R5 修订。
- **实测声明**：A11 基线（13 failed | 159 passed）与简报红灯证据一致；设计期 grep 声明与实况不符的一处已列为 R1。⚠️

## 三、错误处理链路审查（2026-05-07 立法）

- **静默失败**：既有链路无静默面——data 拒纳 `seq≤0` → `discardQueued + needsResync + declareLocalResync`（update-channel.ts:160-166 核对属实）；入队路径 shed → `discardForConnectionPressure` → declareHubResync/declareLocalResync/pendingResync（hub-namespace.ts:106-111 / peer-namespace.ts:107-112 核对属实）；控制耗尽 → ERROR + close(1011)，hub/peer 双侧幂等守卫核对属实。**新增静默面两处**：R1（迁移后测试 harness 读 `undefined` 额度 → 判据静默恒假）与 R6（缺面数据面饱和无信号空转）。均需按修订要求消除。
- **状态闭环**：`exStatus` 类比面——连接级错误状态在所有失败路径闭环（closedFlag / enterBlocked / backoff 状态机守卫逐条核对）；G7c 构造期 TypeError 同步抛出、无半初始化对象逃逸（validateLimits 先于 sender 构造，hub:61-63）。✅
- **降级路径**：缺面 dormant 是协议明文 sanctioned 的降级（「缺面视为 0」），**不是虚假降级**——其前提（生产组合装配期断言三面）在 #164 落地后由 loud assert 保证。但 R6 指出：降级模式内部的「永久数据面死亡且零信号」把 sanctioned 降级变成了静默活锁，需要观测面闭环，这是本审查对「虚假降级识别」标准的适用结论。
- **用户可感知性**：连接级失败 = ERROR 帧 + close(1011)（对端可观测）；ns 级 = RESYNC_REQUIRED；构造期 = TypeError。R6 场景是唯一无感知面。⚠️ 见 R6。

## 四、红线测试思路（每漏洞对应；供 SA6/SA4 编写，无需本轮落码）

- **T1（R1）**：`pnpm run typecheck` 与 `pnpm exec vitest run packages/ws-replication --typecheck` 本身即红灯门禁——设计修订后 §11 清单覆盖 8 文件应全绿。另加运行时防线：直构 harness 处断言 `Number.isFinite(limits.maxQueuedControlBytes)`（或改用 `resolveLimits()` 构造），使 cast 无法再遮缺键。
- **T2（R2）**：迁移后 D3b 若选双帧配方：暂停窗口 + quota=mb+128 + 连发 2 帧 BOOTSTRAP → 断言 wire 上恰 1 帧 BOOTSTRAP + 恰 1 个 CONNECTION_BACKPRESSURE ERROR + close(1011) + backoff 非阻塞 + 撤压重连恢复；并加一条「结构性不可达」显式断言：单帧 BOOTSTRAP（payload=mb）在任何合法 quota 下永不触发首帧耗尽（可作纯公式断言测试）。
- **T3（R3）**：直构 sender + 手控 buffered：暂停（observed=600KiB）→ sendControl 4MiB BOOTSTRAP 放行 → 模拟吸收（buffered += 4MiB，deltaUp，仍 > lowWater 保持暂停）→ 其他 ns 排队 2MiB（总真压 6.6MiB ≤ cap 8MiB）→ 触发 onDataQueued → 断言 **discardLog 为空、零 RESYNC**（修复后）；当前设计口径下此测试会抓到假 shed（discardLog 非空）。
- **T4（R4）**：非暂停 socket（buffered ≤ highWater）+ 同步栈连发 2 帧 4MiB BOOTSTRAP + 显式小 quota（满足 ≥ mb+128）→ 断言第 2 帧在栈内被额度判据拦截（采纳 R3/R4 修订后）；或按修订后的诚实界断言「栈内全放行 + 栈末观察点收口」——取决于 SA1 选型，但必须有一个测试钉死所选语义。
- **T5（R5）**：手控非 FIFO 吸收（data 交接 → 仅 control 被吸收 → observed 上升）→ 断言 data 台账不被错误释放（欠计为零）；若 SA1 声明 FIFO 假设，则该测试作为假设边界文档化存在。
- **T6（R6）**：缺面 wire（bufferedAmount 恒缺失）+ 累计 data > cap → 断言（按修订后口径三选一）：(i) observer seam 收到饱和信号；(ii) 连接进入显式收口/重连；(iii) 设计明文接受的行为——resync 声明计数单调升 + 零 UPDATE 字节上线（把「接受」变成受钉的可观测契约而非静默）。
- **T7（R1 附带）**：保留 4 锚绿（G2c/G3a/G4b/G7d）与 13 红转绿的原始断言不动——本次修订不应触碰红灯契约文件。

## 五、核对无误、无需改动的部分（攻击未破面，供 SA1/SA3 参考）

1. 根因六处偏差表（§1.2）与代码逐行对照**全部属实**；P2 缝隙机理（G1 击穿推演）复算成立。
2. G1/G2a/G2b/G2c/G3a/G3b/G4/G4b/G5/G6a/G6b/G7a-d/G8/G9 的走查数值**全部独立复算吻合**（含 16,443/16,477 探针、49,329=3×16,443、G5 的 74,752 触发、G3b 的 18,502→1,025 释放链）。
3. §12.2 R2-A2a/D4「恒定 buffered 下新旧口径逐帧同数」论证成立（r1-r7:512 的 `readBufferedAmount: () => Σheld` 同步语义核对属实）；§12.3 的 P2 零干扰论证对暴露 bufferedAmount 的 gated wire 成立（buffered getter 同步反映，见 sa6-hardening-g3-g4:189）。
4. 调用点行号（hub:145-154 / peer:215-224 / frame-io:165-166 / update-channel:90-93,160-166 / validate.ts:14,118 / hub-namespace:102-114 / peer-namespace:103-115）**全部核对无误**；爆炸半径声明（ws-replication 之外零消费）本次 grep 复证成立。
5. 字段迁移无兼容层 + G7b 双断言、poll 公式（max(1, floor(ackTimeoutMs/100))）、§8 启动验证形状、DENY LIST（frame-io/update-channel/namespace 层零改动）——与协议 §17 及 SA8 前置门禁逐条一致，I-5/I-6 不变量保持。

## 六、修订后重审范围

仅需复审：§3.1/§3.4（R3/R4/R5 台账拆分或界论证）、§4.2/§4.4（同上）、§11（R1/R2/R7 清单与配方重写）、§14.1/§14.2/§14.4（R2/R4/R6）、§15 ALLOW LIST（R1）、§16（R5 新增条目）、§17 caller 表（R1 补行）。核心章节 §0/§1/§2/§5/§6/§7/§9/§10/§12/§13 无需重写。

**结论：reject —— 待 SA1 按上表修订设计后再审；红灯契约（SA6 产物）不需要任何改动。**

---
---

# R2 独立复审（2026-08-29；被审对象：SA1 设计 v2「R1-R8 修订版」，725 行）

**Verdict: reject** —— R1-R8 全部核实已落实且质量良好；但 R2 以全新视角复审 v2 新增/改写内容时实证 **1 个新的单一阻断项 R9**（§11 #5/#7 迁移配方不可行，属 R2 同类的可行性算术错误，v1 遗留、R1 未审出——本审查如实认领）。生产设计零阻断；预期 SA1 仅需重写 §11 两行配方数字即可过审。

## R2.1 R1-R8 修订逐项核验（全部对照 v2 原文 + 源码/测试/实测复证）

| 项 | v2 落实位置 | 核验方法与证据 | 结论 |
|---|---|---|---|
| R1 caller/limits 审计 | §11.0（grep verbatim）/ §11 #10 / §11 引言 8 文件 / §12.3 sa7-hardening 行 / §12.6 / §15 ALLOW LIST / §17 C1/C2/C4 三表补行 | 本审查独立重跑 `git grep -n "new ConnectionSender"` → **5 处**（hub:145 / peer:215 / review-revisions:509 / **sa7-hardening:473** / sa7-round2:722），与 §11.0 转录逐行一致；`BACKPRESSURE_POLL_INTERVAL_MS` → 4 行一致；外部消费 grep → 空一致。§11 #10 配方含 ackTimeoutMs + maxQueuedControlBytes + `resolveLimits()` 化/`Number.isFinite` 双防线；D2/D3 断言面（:517-550 纯派发序/轮转、恒 0 面不触额度与 poll）本审查此前已读源码核实 | ✅ 落实 |
| R2 93B 数学与 D3b 配方 | §4.1（59B/93B + 探针来源）/ §11 #6 重写 / §14.1 / §16 A1 | 帧头复算：16,443−16,384=**59**、16,477−16,384=**93**（红灯探针实测值）✓。结构性不可达公式复算：F=P+93 ≤ mb+93 < mb+128 ≤ quota ⟹ 单帧自杀不可达（区间空集）✓。主配方数字复算：mb=96KiB=98,304、quota=98,432（恰值合法）；帧1 = P+93 ≈ 92,458 ≤ 98,432 放行（quota 余量 5,974B ≫ 窗口内 OPEN_OK/HELLO_ACK 等小控制帧）；帧2 累计 ≈ 184,916 > 98,432 耗尽；`2(P+93) > mb+128 ⟺ P > 49,123` ✓（90KB blurb ≈ 92,365B 宽裕满足，无边界耦合）。双 ns 同窗口构造可行（openActiveTargets 依序 OPEN、压力恒持、控制不受闸门） | ✅ 落实 |
| R3 总压/额度分离 | §3.1/§3.2/§3.3/§3.4/§5/§6/§12.4 | `totalPressure = observed + pendingDataHandoff + controlPendingHandoff + Σqueued`，`controlUnflushed` 从 admission（§5 projected）/ shed 触发（§6）/总压（§3.4）三处全部移除、仅存于 §4.3 额度判据 ✓。§12.4 走查复算：吸收后 4.6MiB(observed) + 0 + 0 + 2MiB = 6.6MiB ≤ 8MiB 不触发（协议公式同判）；v1 口径 10.6MiB 假 shed 对照 ✓。**R2 追加核验**：v2 的 any-Δ FIFO 释放是对 SA2 R3 处方的改进而非偏离——逐点占优论证成立（bridge = 协议公式 + staged 余额 ≥ 协议公式，staged ≥ 0 恒成立 ⟹ 桥台账永不比权威口径更宽松），且 (c) 论证（仅 Δ>0 释压会在恒动面留下不可回收 stale → 健康连接假拒）正确；I-4 措辞相应弱化为「宽松度 ≤ \|Δ\| ≤ 协议自身宽松度」是诚实且可证明的表述 | ✅ 落实（且优于处方） |
| R4 非暂停控制 P2 + 界修正 | §2 I-1 重写 / §4.2 / §5 / §6 / §4.4 / §14.2 / §12.5 | onEmitted 控制帧**恒**入 FIFO 压力账（不区分暂停）✓；projected 与 enforce 触发均纳入 controlPendingHandoff ✓；I-1 重写为「压力相位 vs 策略覆盖层」双层措辞——与伪代码一致，不再自相矛盾 ✓；§4.4/§14.2 诚实界：「栈内无界（= 栈产生控制字节总量；实践受排纳速率约束）+ 压力侧无盲区 + 栈末观察点入窗」，v1 错误断言明文废止 ✓；§12.5 T4 语义钉死（栈内全放行 + data 准入被封 + 栈末收口）可测 | ✅ 落实 |
| R5 FIFO 假设声明 | §3.3 / §13.3 / §16 A12 | 假设显式声明 + MDN bufferedAmount 原文引用（「queued using calls to send() but not yet transmitted」——与 MDN 实文一致）+ Node writableLength 语义 + 本仓适配器实证（sa7-r2-transport.test.ts:74/108 `bufferedAmount = socket.writableLength`——本审查读源码核实存在）+ 非 FIFO 欠计上界 ≤ min(\|Δ\|, 被误释侧余额) 且逐点 ≤ 协议公式宽松度 | ✅ 落实 |
| R6 dormant/write-through 风险 | §14.4 重写 / §13.11 / §16 A13 | 悬崖范围纠正（缺面 + write-through-0 同构）；A13 证据核实：sa7-r2-transport.test.ts:328-334 注释确有「稳态读数……writableLength 回 0 = 未饱和」（本审查读原文核实）；三层处置如实：(1) 饱和签名可观测契约（RESYNC 单调升 + UPDATE 字节平，T6(iii) 钉死）；(2) #164 期票如实登记为上线前置依赖（未实现事实明文写入，不偷渡）；(3) observer-seam 增强仅登记不实现——符合 SA2 R6 修订要求 (a)+(b) | ✅ 落实 |
| R7 §11/§17 口径 | §11 #8 | 配方补齐 host `ackTimeoutMs: 10_000`（三处改动），与 §17 C2 行一致 | ✅ 落实 |
| R8 §16 无据推断 | §4.1/§11 #6/§14.1（293B 废止）/ §4.4/§14.2（界重写）/ §16 A1 修正 + A12/A13 新增 | 两处无据推断均已替换为实测常量或诚实界声明；§16 无「应该/通常」类措辞 | ✅ 落实 |

## R2.2 红灯契约 17 用例对 v2 语义的重新走查（防 v2 改动引入契约漂移）

G1（Δ=0 FIFO 不弹）/G2a-c/G4/G4b/G5（纯 data 面，控制账零参与）逐值同 R1 复算；G3a（恒 8,193：Δ=+8,193 时 FIFO 空 → 策略账 16,477 → 32,954 > 32,768 耗尽）/G3b（Δ=−17,477：FIFO 弹 control chunk + 策略账 min 释放 → 第二帧放行）在 any-Δ 释放语义下重走 ✓；G6a（poll 火 observe Δ=−7,169、FIFO 空、resume、drain projected = 1,024+0+0+0+16,443）✓；G7 配置面 ✓；G8（入窗策略账 0 + ~102.6KB ≪ 8MiB）✓；G9（恒 524,289 冻结面：Δ=0 → FIFO 累计 ~103KB + observed 524,289 ≈ 627KiB ≤ cap 8MiB 无 shed、策略账 ≪ 8MiB 零耗尽）✓。**17/17 与 v2 伪代码一致，无契约漂移。**

## R2.3 新攻击点

| # | 严重度 | 攻击面 | 具体漏洞 | 修订要求 |
|---|--------|--------|---------|---------|
| **R9** | **HIGH（本轮唯一阻断项）** | §11 #5（D3a）/ §11 #7（D3c）迁移配方 | **`maxBootstrapBytes: 1` 使 D3a/D3c 在 boot 期即红——配方不可执行**。触发链（全部源码实证）：`maxBootstrapBytes: 1` 经 limits 传入 → hub 侧 `OutboundQueue.emitOne` 的 `encodeMessage(..., limits: codecFieldLimits(...))`（frame-io.ts:159-163）→ `encodeBootstrapSnapshot` **encode 侧硬校验** `snapshot.byteLength > maxBootstrap` → throw `BOOTSTRAP_TOO_LARGE`（replication-protocol/payloads.ts:479-486；`resolveFieldLimit` 对显式正值恒执行）→ hub 无法编码**任何**真实 snapshot（issue137-driver 种子 root `{n, blurb:'seed'}` 的 yjs snapshot ≈ 100–300B ≫ 1）。D3a/D3c 都**必须**先完成初始 bootstrap（D3a 的 `peerWrite + rootValue('hub')===5` 前置、D3c 的探针写 :384 与重连恢复 live 断言 :419-422），且 1011 后的重连恢复也要再 bootstrap 一次——**两阶段全灭**，测试根本到不了额度相位。此缺陷 v1 即存在（v1 #5/#7 同值），R1 只复算了 quota 算术、未审 mb 收缩对 boot 相位的副作用——SA2 认领漏审 | (a) mb 改为容纳真实种子 snapshot 的值：探针实测（与 ackBytes 探针同法）或安全定值（建议 512–4,096；种子 snapshot ≈ 100–300B，10× 裕量）；(b) quota = mb + 128 相应放大；(c) `allowed = floor(quota/ackBytes)` 运行时自算——D3c 的写循环/终值断言（`43 + allowed`）本就按 allowed 参数化，结构零改动；**(d) D3a 的写阶段必须改循环**（原为单写，quota 放大后需连续 allowed+1 笔写使第 allowed+1 个 ACK 成为首个越界帧——v2 #5 已改断言措辞但未写明循环改动，~5 行估计偏低）；(e) 配方行明示「mb 下界 = 该 harness 种子 ns 的实测 snapshot 峰值」并把探针步骤写进配方 |
| R10 | LOW（非阻断，随下轮一并修） | §14.4/A13 悬崖范围措辞 | 悬崖机理是 **Δ≡0（恒读数面）**，不止「恒读 0」：冻结非 0 面（如红灯 G9 wire 恒 524,289）同样使 FIFO 永不弹出 → totalPressure 无界增长 → cap 后假 shed。G9 自身量级微小无碍、冻结面实际仅存在于测试 wire，但风险登记的范围措辞应一行补齐 | §14.4/A13 措辞改为「Δ≡0 恒读数面（恒 0 缺面/write-through-0 与冻结非 0 同构；后者仅测试 wire）」 |

## R2.4 R9 的修订验证命令（SA1 改后 SA2/SA4 复核用）

```bash
# encode 侧硬校验存在性（R9 触发链锚点）：
sed -n '479,486p' packages/replication-protocol/src/payloads.ts   # encodeBootstrapSnapshot throws BOOTSTRAP_TOO_LARGE
# 配方可行性下界（种子 snapshot 实测）：在 D3a/D3c harness 内对种子 ns 做 snapshot 探针
#（与 ackBytes 探针同法），断言 mb ≥ 实测峰值 × 安全系数。
```

**T8（R9 红灯构想）**：迁移后的 D3a/D3c 保留一条 boot 前置断言——`setHubPressure` 之前 `peer.getNamespaceState(a) === 'live'`（若 mb 配错，此断言先红并指向 BOOTSTRAP_TOO_LARGE，而非在额度相位给出误导性失败）。

## R2.5 结论

- **R1-R8：全部核实落实**，其中 R3 的 v2 实现（any-Δ FIFO 释放 + 逐点占优论证）优于 SA2 原处方，予以认可。
- **红灯契约 17 用例对 v2 语义重走无漂移**；§15 生产面/DENY 面不变。
- **唯一阻断项 R9**：§11 #5/#7 的 `maxBootstrapBytes: 1` 不可执行（encode 侧 BOOTSTRAP_TOO_LARGE 灭 boot 与重连两阶段）。修订量 = 两行配方数字 + D3a 写循环说明 + R10 一行措辞，**不触任何生产设计面**。
- **Verdict: reject**——待 SA1 修订 §11 #5/#7（附 R10 措辞）后回轮；预期 R3 轮仅复核该两行即可 pass。

---
---

# R3 独立复审（2026-08-29；被审对象：SA1 设计 v3——R9/R10 修订，737 行）

**Verdict: pass** —— R9/R10 逐项核验落实且配方可执行；v3 改动严格局限于 R9/R10 面（grep 定位：:154 / :232-233 / :427 / :429 / :504 / :516 / :522-539 / :559-560 / :617），其余章节与 R2 已全量验证的 v2 逐字一致，零回归。附 2 条非阻断备注。

## R3.1 R9 修订核验（§11 #5/#7——总控钦定的四个焦点）

| 焦点 | v3 方案 | 核验方法与证据 | 结论 |
|---|---|---|---|
| **mb=512/quota=640 不触发 BOOTSTRAP_TOO_LARGE** | §11 #5(a)/(b)：mb=512（∈SA2 钦定 [512,4096]）、quota=640=mb+128 恰值合法（G7d 同构） | 种子文档实证：D3a/D3c 的 `bootMulti`（issue137-driver.ts:92-93）种子 root = `{ n: index+1, blurb: 'seed' }`，schema 文本 43B（ISSUE137_SCHEMA 实测 `type ROOT = { n: number; blurb: string; };\n`）——yjs snapshot payload 量级数十–低二百字节，**≪ 512 有一个数量级裕度**；encode 侧门（payloads.ts:479-486 `snapshot.byteLength > maxBootstrap` 才 throw）对 512 恒不触发。约束链完整：512 ≤ maxFrameBytes−128 ✓、640 ≥ 512+128 恰值 ✓。**双保险**：(d) mb 下界探针断言（wire 日志取 boot 期 BOOTSTRAP_SNAPSHOT 的 `snapshot.byteLength`，`expect < 512`）把「安全值覆盖种子 snapshot」从假设变为受测前置——yjs 膨胀越界会响亮红并直指 BOOTSTRAP_TOO_LARGE 类因，优于 SA2 R9(e) 的「写进步骤」要求。重连恢复阶段同一种子文档、同一 mb——两阶段皆过门 ✓ | ✅ |
| **boot-before-pressure 前置** | §11 #5(c)：置压前显式 `expect(peer.getNamespaceState(nsId)).toBe('live')`（settleUntil 升格为断言），保证 boot 期控制帧（OPEN_OK/SYNC/BOOTSTRAP）落在暂停窗口外 | 窗口语义核对：`enterPause` 起点重置 `controlUnflushed = 0`（§4.2）⟹ 置压前的一切控制发射不占窗口额度 ✓；置压后首个 `sendControl` 的 `observeWater` 才开窗（D3a setHubPressure(3) > highWater 2 / D3c 300 > 200 ✓ 冻结非 0 子类入窗）。D3c 的探针写本就在置压前，配方注明「天然满足，仅显式化」✓。该断言同时就是 SA2 T8 构想的实现 ✓ | ✅ |
| **动态 allowed+1 ACK 驱动与断言可执行** | §11 #5 驱动形态：探针实测 ackBytes → `allowed = floor(640/ackBytes)`（≈11）→ 连续 allowed+1 笔写（逐笔 settle）→ 第 allowed+1 个 ACK 为首个越界帧（627+57=684 > 640）触发耗尽不上 wire；断言「暂停段 wire 上恰 allowed 个 UPDATE_ACK + ERROR×1(无 namespaceId) + close(1011) + backoff 非 blocked + 撤压重连恢复」 | 算术复算：floor(640/57)=11；11×57=627 ≤ 640 ✓、12×57=684 > 640 ✓（ackBytes 若 58/60 → 11/10，探针自适化，无边界耦合）。可执行性核对（读测试源码）：harness 已有 `wireFrames(wire0,'hubToPeer')` + `decodeMessage` 助手（:282-284 实用在用）✓；ACK 逐字节等长有既有锚（:380 注释「同 kind 同 ns → 逐字节等长——sequence 定长 4 字节」）✓；peer→hub 写方向不受 hub 侧出站压力影响（压力仅 defineProperty 在 hubEnd）✓；耗尽后 `isEmitAllowed=false` 封口，无第 13 个 ACK 混入，「恰 allowed 个」确定 ✓；D3c 的循环/终值（`43+allowed`）本就按 allowed 参数化——v3「断言结构零改动」的声明在 640 口径下成立（v2 129/57≈2 贴边问题已消）✓；窗口内 11×57B FIFO 累积 + observed 300 ≪ cap（缺省 8MiB）零 shed 干扰 ✓ | ✅ |
| **R9 其余要求** | quota 恒取 mb+128 恰值；D3a 写循环明示；mb 下界受测 | 全部在 §11 #5 配方内逐条落地；「#3/#4/#6 的 mb 亦满足同一纪律」复核：63,872 / 1,372（种子 {n, blurb:'seed'} ≪ 1,372）/ 96KiB（blurb 90KB 构造性满足）✓ | ✅ |

## R3.2 R10 修订核验（Δ≡0 风险措辞）

§14.4 重构为「**Δ≡0 恒读数面**」风险类：充要条件 = 观察值永不移动（与绝对值无关）——严格优于 SA2 R10 的一行措辞要求。三成员表各带本仓锚：(a) 恒 0 缺面（协议 §17 L494 + hub:435-442/peer:499-508）、(b) write-through-0（sa7-r2-transport:328-334 自证）、(c) 仅测试 wire 冻结非 0（D3 族 setHubPressure/G 族直构 harness）。**两子类下游差异如实区分且内部自洽**：恒 0 读数 → 永不暂停 → 额度 dormant 免检 + 数据面预算收口；冻结非 0 且 > highWater → 恒暂停 → 额度窗口活跃（Δ<0 永不发生 → 额度满即 1011）+ 闸门/shed 收口——后者正是 D3a/D3c/D3b 测试机制的自我描述，设计与测试互证 ✓。测试面 (c) 体量护栏（P2 ≪ cap）与 §12.3 已核全套件一致 ✓；处置 2 补注「#164 断言只覆盖 (a)，(b) 存在且读 0 无法由缺面断言拦截 → 归处置 3」——诚实且精确 ✓。§3.4 尾注/§4.4 读法 A 行/§13.11/§14.2/A13 五处措辞同步、无残留旧口径（grep「恒读数面/Δ≡0」全命中核对）✓。

## R3.3 零回归定位

v3 相对 v2 的改动经逐处定位核对，**严格局限于**：§3.4 尾注（:154）、§4.4 两读法行（:232-233）、§11 #5（:427）、§11 #7（:429）、§13.11（:504）、§14.2 尾注（:516）、§14.4（:522-539）、SA2 反馈表 R9/R10 行（:559-560）、§16 A13（:617）。其余章节（含 §11 #6 D3b 配方、§12 全部走查、§15/§17、A1-A12）与 R2 已全量验证的 v2 一致；红灯契约 17 用例的 v2 语义走查结论（R2.2 节）继续成立。

## R3.4 非阻断备注（不构成回轮条件）

| # | 级别 | 内容 | 建议 |
|---|---|---|---|
| NC-1 | cosmetic | 设计标头（:1「R1-R8 修订版 v2」）与修订记录（:7「v2（本版）」）未随 R9/R10 升版——内容实为 v3（反馈表 R9/R10 行在），版本追溯链靠读者自行拼合 | SA1 方便时改两处标头为 v3 + 补一句 R9/R10 修订记录；不阻断放行 |
| NC-2 | micro | §11 #5 预估「~8 行」偏乐观：boot 前置断言 + mb 探针断言 + allowed+1 循环 + 断言组调整实际约 12-15 行 | 纯工时估计，SA6 自行把握 |

## R3.5 结论

- **R9 四焦点（mb=512/quota=640 过门、boot 前置、动态 allowed+1 驱动、断言可执行）全部核验通过**，且 mb 下界探针断言把 R9 的根因假设变成受测前置——比 SA2 要求做得更稳。
- **R10 措辞重构优于要求**（充要条件化 + 三成员两子类 + 各自锚证 + #164 覆盖缺口的诚实补注）。
- **零回归**：改动严格局部化；v2 已验证面原样。
- NC-1/NC-2 为非阻断备注。
- **Verdict: pass —— 设计通过 SA2 攻击评审，同意放行**（SA3 实现 / SA6 迁移可按 v3 §11 配方执行；pass 不替代 SA4 静态门禁与 SA7 活链路验证）。

---
---

# R11 裁定独立复审（2026-08-30；被审对象：SA1 设计 v4「R11 裁定版」+ SA3 commit 541c3b7）

**Verdict: pass（裁定接受）** —— v4 撤回「非暂停控制恒入压力桥」（SA2 R1 轮 R4 可选项 (c)），回归必要项 (a)+(b)。经机理、算术、契约依赖、处方回溯四维独立核验，裁定**成立且为本仓约束下的正确解**；R3 双账本拆分（假 shed 修复）完整保留；实现与设计一致、全套件独立复跑全绿。

## R11.1 冲突机理独立核验（不依赖 SA3 叙述，从源码重推）

1. **GatedWire Δ≡0 boot 相位属实**：`bootReview`（ws-replication-review-revisions-r1-r7-red.test.ts:222-253）——`peer.start()` → `settleUntil(live)` 全程 gate **off**，`wire.setGate(true)` 在 live **之后**（:253）；GatedWire `hubEnd.send`（:148-160）gate-off 分支 `deliveredToPeer.push + queueMicrotask` 直投、**不入 held**；`bufferedAmount` getter = Σheld（:180-184）⟹ boot 期全部控制帧（HELLO_ACK/OPEN_OK/SYNC 族）交付后观察值恒 0，Δ≡0 相位成立（设计 A14 引用行号逐字核对无误）。
2. **残差机理与内在性独立重推导**：恒计形状下 boot 控制 chunk（789B）滞留 FIFO；gate-on 后每个 data 帧吸收的 Δ>0 依队首弹出——先弹尽滞留控制 chunk、再部分弹最老 data chunk → data 侧留下等额永久残差。**关键论证（§12.7.3）独立复核为数学事实**：对 Δ 的任何归属策略（队首/队尾/按 kind），Σ残差 ≡ Σ不可观察离线字节——归属只转移残差载体侧，不改变总量；「桥覆盖不可观察交接字节」+「该相位不可观察」⟹ 残差是恒计的固有代价，非实现瑕疵。反事实检验：即便把 boot 流量估小，残差仍随 boot 流量漂移——R1-1 的逐字节边界（margin 65,536−64,808=728B < 789B）只是击穿点，**任何非零残差都已把协议公式边界锚污染为实现细节锚**（§12.7 理由 3 的锚退化论证对任意残差量成立）。
3. **R1-1 是协议公式边界锚而非实现锚**：其断言组（恰 8 帧放行 + 第 9 笔拒纳 + 字节级零新增）的标定来源是协议公式（queued+buffered+frame ≤ cap）与 SA6 的「R2-N1 构造精度：8L+512 > 64KiB」注释——把它的期望值改写为「协议公式 + 实现残差」即把语义锚降级为随 boot 流量逐测试漂移的实现锚。SA6 owned 断言不可由 SA3 迁移——约束链正当。

## R11.2 裁定五项理由逐条核验

| # | 设计理由 | 独立核验 | 结论 |
|---|---|---|---|
| 1 | 17 红灯零依赖非暂停控制 P2 | R2 轮逐例走查复核：G3a/G3b/G8/G9 的控制帧全部在暂停窗口内（首个 sendControl 的 observeWater 即入窗——G8/G9 观察值恒 > highWater、G3 预置 8,193 > 8,192），照常双登记；纯 data 用例无控制 | ✅ |
| 2 | R3 假 shed 修复完整保留 | §12.4 T3 场景的 4MiB BOOTSTRAP 在**暂停窗口内**交接 → 入桥+策略账双登记 → 吸收 Δ>0 弹出 → 双计消除路径不变；实现 `onEmitted` control 分支 `if (this.paused)` 内 FIFO+controlUnflushed 双登记（commit 541c3b7 逐行核对）| ✅ |
| 3 | 选项 (b) 锚退化 + 残差内在性 | R11.1.2/3 独立重推导成立 | ✅ |
| 4 | SA2 R1 轮 R4 必要项 = (a)+(b)，(c) 为「推荐一并解决」可选项 | 对照 SA2 R1 原文逐字核实：R4 修订要求 (a) 措辞修正 + (b) 诚实界为必要项；(c) 前缀「若采纳……推荐」——v4 回归必要项的处方回溯**准确** | ✅ |
| 5 | SA3 已全绿 + 与协议「不更严不更松」 | 本审查独立复跑 `pnpm exec vitest run packages/ws-replication --typecheck` → **23 files / 172 tests 全绿、Type Errors no errors、exit 0**（含 R1-1 与 17 例红灯契约）；非暂停控制未吸收窗口对协议公式与本项目账本**同为盲区**（协议公式 queued+buffered 对未吸收交接字节同样不可见），吸收后两者同计于观察值——非暂停控制侧与协议逐点等宽；暂停窗口内本项目更严（保守方向，I-4 允许，且受 quota 封顶） | ✅ |

## R11.3 SA2 自我修正（认领）

R2 轮曾背书 v2 的 (c) 恒计实现为「优于处方」——该背书未预见「Δ≡0 相位（write-through/直投）→ 随后 Δ>0」混合观察面上的等额永久残差（生产 write-through 健康连接同样存在该混合面：健康期 ACK/控制直投滞留、jam 期吸收 Δ>0 转嫁残差——恒计的残差人口以高频控制帧为主）。SA3 实现期证伪是流程设计的目的达成，非流程失败。本轮**撤回 R2 的「优于处方」评价**；v4 的 control 仅暂停入桥同时把滞留人口收敛为 data-only（§3.3(d) 的 data-only 残差恒 0 精确性论证随之成立）。

## R11.4 v4 一致性核验

- **§4.4/§14.2 暴露界**：非暂停控制对两套判据（额度/压力桥）均不可见；单栈免检上界 = 栈控制字节总量（实践受排纳速率约束）；跨栈吸收后协议同计；栈末观察点入窗收口——**与 SA2 R1 轮 R4(b) 的诚实界要求同形**（v1 的「≤一帧」假界未复返）✅。
- **T4 语义重钉**（§12.5）：「栈内全放行（控制不入账）+ 栈末观察点入窗收口」——SA2 T4 原文明确允许「按修订后的诚实界断言」这一选型 ✅。
- **§12.4/§12.1 走查**：T3 与 17 例红灯在 v4 形状下全部成立（G9：恒 524,289 冻结面首个 sendControl 即入窗，后续控制全窗口内双登记，压力侧 ≈ 627KiB ≤ cap 零 shed）✅。
- **改动局部性**：v4 相对 v3 的改动集中于 §2 I-1/§3.1/§3.3(d)/§3.4/§4.2/§4.4/§5 注/§12.3/§12.5/§12.7(新)/§13.1-2/§16 A14(新)/附录——其余（§11 迁移配方、§14.4、A1-A13）与 R3 已放行的 v3 一致 ✅。
- **实现匹配**：commit 541c3b7 的 `onEmitted`（control 分支整体 paused 门控 + FIFO/controlUnflushed 双登记 + 裁定注）、`observe()`（any-Δ 队首弹出 + Δ<0 另释策略账）、`totalPressure`（无 controlUnflushed、含窗口内 controlPendingHandoff）与 v4 §3/§4 逐条对应 ✅。

## R11.5 非阻断备注

- **NC-3**：789B 为 SA3 实测值（本轮未复测——重测需回退生产代码，超出 SA2 权限）；裁定的正确性**不依赖该精确值**（R11.1.2：任意非零残差已构成锚退化，728B margin 只是击穿阈值），机理三步全部有源码锚（本轮逐行核对）。建议 SA4 静态门禁时对 A14 的 wire 行号做常规复核。
- **NC-4（micro）**：§12.7 理由 5「既有 159 用例绿」的口径为旧基线的 passed 计数（含红灯文件 4 锚）；复跑实测 23 文件/172 用例全通过，总数与基线 13 failed | 159 passed = 172 吻合、零用例丢失——措辞口径问题，无实质影响。

## R11.6 结论

- 冲突机理（GatedWire Δ≡0 boot → 恒计残差 → R1-1 协议边界击穿）从源码独立重推成立；残差内在性为数学事实，非可修实现瑕疵。
- 裁定回归 SA2 R1 轮 R4 的**原始必要处方**（(a) I-1 措辞收窄 + (b) 诚实暴露界），撤回的仅是与既有协议锚冲突的可选项 (c)；R3 假 shed 修复零影响。
- 实现形状与 v4 一致；全套件独立复跑全绿；红灯契约 17/17。
- **Verdict: pass —— R11 裁定接受，v4 设计维持放行**（NC-3/NC-4 为非阻断备注；pass 不替代 SA4 静态门禁与 SA7 活链路验证）。

---
---

# R12 退休账本独立复审（2026-08-30；被审对象：SA1 设计 v5「R12 退休账本版」+ SA7 落地测试 `ws-replication-sa7-issue169-dynamic.test.ts`）

**Verdict: pass** —— kind-aware 保守退休账本（§3.5）经四维独立核验成立：机理结构、G3b 重走、D1 反转算术（对落地测试构造逐相位复算）、aggregate-only 保守性双轴向推导。「data flush 绝不释放控制额度」由优先序结构保证而非约定；R3 假 shed 修复 / R11 裁定 / 压力侧机制 / 窗口语义零改动。附 4 条非阻断备注（NC-5..NC-8）。本轮为**设计门禁**：v5 尚未实现（backpressure.ts 仍为 v4 形状），实现 + D1 ★ 断言反转由后续 SA3/SA6 轮落地，SA4/SA7 复证。

## R12.1 机理与硬不变量核验（§3.1/.2/.3/.5）

- **结构保证**：退休预算按 ①unretiredAbsorbedData → ②handoff data → ③unretiredAbsorbedControl → ④handoff control 优先序消耗，额度释放 = `min(r3+r4, controlUnflushed)`——①② 消耗在结构上不触释放语句，「data flush 绝不释放」是**优先序定理**而非注释约定 ✅。伪代码逐行核读：Δ>0 归因弹出累积 ①/③、超额外部不记账；Δ<0 四步消耗 + clamp 释放；`retireFromHandoff` 遍历中不变异数组（仅 chunk.bytes 原地缩减 + 事后 filter）✅ 无迭代-变更冲突。
- **候选池跨窗口持续（仅 teardown 清零）**：计数是纯数字（FIFO 已弹出，无对象滞留）——零内存泄漏面；大 ① 只延迟额度释放（保守方向）✅。
- **G3b 重走（§12.1 行独立复算）**：Δ=+17,502（FIFO 空 → 全外部）；入窗 reset；帧1 交接 → ④ 候选 16,477；setBuffered(1,025) → Δ=−16,477：①②③ 全零 → ④ 全退休 16,477 → 释放 min(16,477, 16,477) = 16,477 → 策略账 0 + 压力侧同步归零；1,025 > lowWater 仍暂停；帧2 放行、exhausted 0 ✅ **G3b 兼容成立**。
- **17 红灯全量重走**：G1/G2a-c/G4/G4b/G5（Δ=0 或纯 data，退休不参与）✓；G3a（Δ=0 零退休）✓；G6a/G6b（Δ<0 时空候选零退休零释放）✓；G7 配置面 ✓；G8（首观察 Δ=+524,289 FIFO 空 → 纯外部；入窗后额度判据照常）✓；G9（冻结 Δ=0）✓——红灯契约零改动裁定与我的逐例 trace 一致 ✅。

## R12.2 aggregate-only 保守性独立推导（总控钦定焦点一）

- **轴 1（本连接字节）「只会欠释放」独立证明**：窗口内 data 只能在非暂停期交接（R11 入队纪律）⟹ 窗口内任意时刻 ①② 候选**全部老于**窗口内全部 control chunk。FIFO 冲刷真值下：最老窗口 control C1 冲刷当且仅当下降 ≥ 其前全部字节 = ①+② —— 与规则阈值**相等**（非仅保守）；后续 C_k 的 ③④ 最老优先消耗序 = FIFO 真值序。故单写入者 + FIFO + 无外部积压下规则**窗口内精确**；跨序假想（data 新于 control——本协议拓扑不可达）下保守。✅
- **轴 2（外部积压）受控乐观**：无 data 候选时下降归因 ③④——G3b 红灯锚钦定（预置电平内含待发控制帧的下降必须释放）；过释放 ≤ 控制账面 ≤ quota ✅（§14.6 已登记）。生产面外部积压不可达（单写入者，A15 引证 hub-connection.ts:137-144 / peer-connection.ts:204-211 —— R11 轮已逐行核实的 emitRaw 单点）✅。
- **压力侧影响**：totalPressure 公式不变；bridge ≥ 协议公式的逐点占优论证（balances ≥ 0）原样成立；Δ<0 的 ①优先消耗使压力弹出 ≤ v4（更保守）——§12.3「data-only 逐值等价」对实际套件成立（R1-1 形流：升恰弹、降恰退 ①，FIFO 终态相同）✅。
- **欠释放方向的代价定位正确**：更早 1011 = 协议允许的收口域（retryable/backoff），优于 v4 的额度击穿（违反 issue 硬语义）——取舍方向与 issue 一致 ✅。

## R12.3 D1 反转算术核验（对落地测试构造逐相位复算；总控钦定焦点二/三）

对 `ws-replication-sa7-issue169-dynamic.test.ts` D1 的实际构造（QUOTA=163,840、F_CTRL=16,477、F_DATA=16,443、6×16KiB data 直发、revealed=61,440、n1=floor(163,840/16,477)=9）逐相位重推 v5 行为：

- P1-P2：data backlog 98,658 交接；显影 61,440 → ①=61,440、FIFO 残 data 37,218；入窗 reset。
- P3（9 帧）：帧1 Δ=0；帧2-9 各 Δ=+16,477 弹 FIFO 头（先残 data 37,218 → ①；后 control chunk → ③）——**策略账不因 Δ>0 释放**；9 帧后 controlUnflushed=148,293=9×16,477 ≤ 163,840 ✓（第 9 帧判据 131,816+16,477=148,293 ≤ 163,840 ✓）。
- P4（data flush 61,440）：退休预算 61,440 **全被 ①（=98,658）消耗** → ②③④ 零退休 → **控制额度零释放**（硬不变量生效）✅——v4 同场景释放 61,440（额度过释放，SA7 D1 钉死的缺陷面）。
- P5：第 10 帧判据 148,293+16,477=**164,770 > 163,840** → 拒绝不上 wire、exhausted 恰一次 → n2=0、wire control=148,293 ≤ QUOTA ✅。
- **§12.8 的断言面（第 10 帧拒绝 / 恰一次 1011 / wire ≤ quota）与落地构造逐值吻合** ✅。D2（Δ≡0 饱和签名，真实 TCP）与 R12 无机制交叠（Δ≡0 无退休路径）——v4/v5 同绿 ✅。

## R12.4 控制额度错误释放的残余类清单（总控钦定焦点三）

| 类 | 状态 | 界 |
|---|---|---|
| data flush 释放控制额度（R12 修复目标） | **结构性消除**（①② 先耗 + 释放仅由 ③④ 驱动；D1 反转钉死） | 0 |
| 外部积压冲刷归因 ③④ | §14.6 轴 2 已登记（G3b 锚钦定） | ≤ quota；生产不可达（单写入者） |
| **跨窗口 ③④ 残留候选释放当前窗口额度**（窗口 reset 只清 controlUnflushed 不清候选；③④ 跨窗口持续，深处下降退休旧窗口控制字节时释放额落在当前窗口账上） | **未入 §14.6 枚举**（NC-5）——与外部类同族同界 | ≤ min(残留候选, 当前账面) ≤ quota；实际 ≤ lowWater 量级（resume 条件 observed ≤ lowWater ⟹ 窗口起点残留缓冲 ≤ lowWater） |

## R12.5 非阻断备注

| # | 内容 | 建议 |
|---|---|---|
| NC-5 | §14.6 轴 2 的过释放类枚举只列「外部积压」，漏「跨窗口退休候选」类（§R12.4 第三行）——两类的合并界已是轴 2 所述 ≤ quota，纯枚举完整性 | 轴 2 行补一句「含跨窗口 ③④ 残留候选（界 ≤ lowWater 量级，resume 条件所限）」 |
| NC-6 | §12.8/修订记录的 v4 违反叙事「3 次 data flush（各 16,477）→ 12×16,477=197,724」与**落地 D1 构造**（单次 61,440 flush）不符——单次构造下 v4 放行 13 帧（214,201B）；两者同证违反（> quota 且 ≤ QUOTA+dataBacklog 界内），v5 反转数字（9+第 10 帧拒）不受影响（零释放与 flush 次数无关） | 对齐叙事与落地构造（或注明两变体）；防 SA6/SA7 复证时数字对不上 |
| NC-7 | D1 ★ 断言反转（n2>0→0、wire>QUOTA→≤QUOTA 等）的 owner 未在设计中指名——测试文件为 SA7 新增（untracked），其头注自认「届时更新断言即为修复的回归锚」 | 设计补一行归属（建议 SA6 按 §11 纪律执行断言迁移、SA7 复证），避免实现轮落地后无人认领 |
| NC-8（micro） | 附录 A teardown 行「handoffQueue/两余额/策略账/基线清零」漏列两个退休候选计数（§3.1 与字段注释均为「仅 teardown 清零」——意图一致，枚举不同步） | teardown 行补「+ 两退休候选计数」 |

## R12.6 结论

- **机理**：硬不变量由优先序结构保证；伪代码无迭代/状态缺陷；候选计数零泄漏。
- **G3b 兼容**：④ 退休路径独立重走成立，红灯契约零改动。
- **D1 反转**：对落地测试构造逐相位复算——9 帧放行、第 10 帧 164,770 > 163,840 拒绝、恰一次收口、wire 148,293 ≤ quota；v4 同构造违反面复证（data flush 释放 61,440 额度）。
- **保守性**：窗口内精确（单写入者+FIFO）、跨序保守、过释放两类有界且（补 NC-5 后）全登记。
- **R3/R11/压力侧零改动**：totalPressure/onEmitted/入队纪律原样。
- **Verdict: pass —— R12 设计放行**（NC-5..NC-8 非阻断；v5 实现与 D1 反转落地后由 SA4 静态门禁 + SA7 活链路复证收口）。
