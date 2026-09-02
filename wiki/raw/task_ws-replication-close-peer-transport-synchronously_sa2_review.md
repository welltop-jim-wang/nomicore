# SA2 攻击评审报告

**Date**: 2026-08-30
**Verdict**: pass（4 项非阻断修订建议：MINOR × 2、LOW × 1、INFO × 1——无 CRITICAL/HIGH；核心攻击面全部守住的条件下放行，建议 SA1 在 SA3 动工前顺手吸收 #1/#4，#2/#3 至少登记）

**被审对象**：`wiki/raw/task_ws-replication-close-peer-transport-synchronously_design.md`（SA1 R0）
**评审基线**：worktree `ffca4f6`（与设计声明一致；`git` HEAD、`peer-connection.ts` 962 行、两锚测试在场均核实）
**ADR 约束基准**：`_relevant_decisions.md`（SA8 前置 + 设计后复审追加节）；ADR-0010 唯一管辖，wire contract `docs/protocols/instance-replication-v1.md` §18/§15.1/§14/§13.1/§23.2 经其纳入

---

## 0. SA2 独立验证证据（攻击前提的真实性核对）

SA2 以全新视角重放了设计的全部关键声明（源码逐行 + 全量测试基线），结果：

| # | 设计声明 | SA2 验证手段 | 结果 |
|---|---|---|---|
| V1 | 缺陷定位：`armHello` :908-914 回调只调 `onTemporaryFailure('hello-timeout')`，无自关 | 读源码 :908-914 | ✅ 属实 |
| V2 | 路径责任矩阵六行（:292/:431/:736/:745/:817/:912） | 逐行核对六个 `onTemporaryFailure` 调用点 | ✅ 全对；grep 确认无第七处 |
| V3 | pong detach-close 序列 :421-432 与 helper 四步「行为字节等价」 | 逐行对照 :427-430（stopLivenessNow → unsubscribeTransport → epoch+1 → `if (!transport.closed) close(1001,'pong-timeout')`）vs §4.1 helper | ✅ 机械等价成立（守卫留在调用点，序列入 helper） |
| V4 | §18 条款原文 | 协议 :524（R4 次序 + 「epoch 必须在……close() 前失效」）、:526（「HELLO/pong timeout关闭连接」） | ✅ 引用准确；helper 次序逐步一致 |
| V5 | hub 侧零改动安全性（A3/A4） | hub-connection.ts :372-376（state 守卫）、:379（onClose 订阅）、:610（helloHandle 仅 HELLO_ACK 清除——N1）、:761-792（onTransportClosed → cleanupAll → :785 dropConnection） | ✅ 全对；close 事件 info 在 onTransportClosed 入口被丢弃（无 code 分支），1001 不会被误读为 GOAWAY |
| V6 | A2 close 签名可达 hub 侧 | 测试 wire `makeLivenessLogWire`（issue168 红 测试 :123-129/:179-184）：peerEnd.close(code,reason) → queueMicrotask → hubCloseListeners 携带 `{code,reason}`；D3 先例 :663-667 对 pong 断言同款 toEqual | ✅ 成立 |
| V7 | 「hello 超时入口仅被两个 #168 锚测试驱动」 | grep `hello-timeout`（仅 2 锚 + api.test-d 类型面）；grep `helloTimeoutMs` 短值（另两处 auth-lifecycle:625 / sa7-r1:606,627 均 hub 侧认证等待超时，raw transport、无 peer FSM 参与）；**全量基线实测** | ✅ 实证（见 V8） |
| V8 | 红灯真实 + 回归面隔离 | `npx vitest run packages/ws-replication` → **Test Files 2 failed \| 40 passed (42)；Tests 2 failed \| 306 passed (308)；Type Errors 0**。2 失败 = 恰好 T1（:296）与 D5（:802），均 `peerSideClosed expected false to be true` | ✅ 与 SA6 证据一致；306 绿面 = 修复后必须保持的面 |
| V9 | `armHello` 唯一 caller = dialNow :333 | `grep -rn armHello packages/`（排除测试） | ✅ 定义 + 单调用点 |
| V10 | liveness 回调时已自停（§11 依据 liveness.ts:79） | liveness.ts `loseLiveness`：`stopInternal()` 先于 `deps.onPongTimeout()` | ✅ 属实 |
| V11 | R2 clearHello 枚举完整性 | :409/:194/:748/:828/:856/:878 逐一在源码确认；补充：dialNow 本身不 clearHello，靠 armHello 开头 `clearHello()`（:909）在同一同步栈完成——单线程 + fake scheduler 仅 advanceBy 触发，栈内零发射窗口 | ✅ 论证成立（设计 R2 (1) 措辞已准确覆盖此点） |
| V12 | 迟到 HELLO_ACK 零扰动（R1/A5） | 订阅闭包 epoch 门 :335-336 + helper 退订先行；测试 wire 中 unsubscribe 从 Set 摘除监听，排队的微任务遍历空集 | ✅ 双闸成立 |

**攻击总评**：对以下攻击向量逐一想定攻击，全部被设计既有结构化解：hello 超时 vs in-flight ACK 竞速（R1）、旧代 timer 误伤新代（R2 三层防线）、close() 同步重入（R3，epoch 先失效 + 退订先行）、timer fire 时对端已关（R4，`!transport.closed` 合法幂等）、stop 竞速（R5）、handshaking 期 GOAWAY/协议违规（R6，connectionFatal → enterBlocked → clearHello :828）、hub 迟到 HELLO_TIMEOUT（R7，state 守卫 + closedFlag 双拦）、恢复链（R8）、exactly-once 观测（R9，backoff 事件仅在 onTemporaryFailure 单点发射 :867）、退避公式（R10）、背压叠加（R12，handshaking 期 sender 零控制帧流量——HELLO 经 outbound 直发 :323，不经 sender）。

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | MINOR | 设计文档事实准确性（§11 改动函数表 / §4.3 措辞） | §11 声称 `armHello` 改动前契约为「`(): void`——**内部读 `this.transport`**」、§4.3 称参数化「**消除 `this.transport` 可空读取**」——实测现状 armHello（:908-914）回调**不读 `this.transport`**（仅 `connStateValue` 守卫 + `onTemporaryFailure`）。参数化的真实且充分的理由是「武装时刻捕获传输身份 + 代际双凭据」（pong 同构），现状描述失准会误导 SA4/SA7 的前后对照 | 修订 §11「改动前契约」为「回调不持有传输身份/代际凭据（仅状态守卫）——双凭据守卫无从书写」；§4.3 同步措辞。纯文档修订，不动代码方向 |
| 2 | MINOR | helper 契约的未强制不变量 | `detachCloseTimedOutTransport(transport, …)` 内部 `unsubscribeTransport()` 作用于 `this.transportSubscriptions`（= `this.transport` 的监听），却 close 参数 `transport`——不变量 `this.transport === transport` 仅由调用方守卫保证（今日两调用点 :424/:175 设计稿均在前三行守住）。未来第三个调用点漏写守卫 → **退订错代监听 + 关错传输**（当前代监听残留、旧代被关），恰是本代码库处处用「双凭据」防御的代际 bug 形态；仓库自身纪律（requestRebuild :881-883「杜绝『守卫兜底』成为唯一防线」）支持在此加第二道防线 | 任选其一：(a) helper 头部把身份校验做成 loud 前置（不满足即 console.error/断言，**不得静默 return**——静默跳过即伪降级）；(b) helper 不收 transport 参数、直接读 `this.transport`（调用方守卫后语义等价，错配不可能）；最低限度：把该不变量写入 §11 的 SA4 caller-audit 清单（现有 grep 命令之外加「每个调用点前三行含 `this.transport !== transport`」检查项） |
| 3 | LOW | `transport.close()` 同步 throw 的暴露面未登记 | §11 声称 helper「零 throw 路径（DuplexTransport.close 契约为 void）」——void 返回 ≠ 永不 throw（types.ts :62 仅签名约束）。若第三方 adapter 的 close() 同步抛错：epoch 已失效 + 监听已退订 + helloHandle 已清 → `onTemporaryFailure` 不执行 → **连接永久卡 'handshaking'**（无任何在武定时器；远端 close 也因退订不可见；唯一出路是外部 stop()）。pong 路径自 issue #170 起同构暴露且 real-transport 测试绿——非本设计引入的回归，但本设计把该暴露面**复制到了第二条路径**，且 §10 假设表未登记此依据 | 二选一：(a) helper 内 `close` 包 try/catch（吞异常但**保证 `onTemporaryFailure` 必达**——backoff 恢复链不能被 adapter 异常劫持）；(b) 维持现状但 §10 增设 A8：「transport.close() 不同步抛错」+ 依据（types.ts :62 契约 + pong :430 无 catch 先例 + sa7-issue170-real-transport 实路径绿）。任一均可接受 |
| 4 | INFO | 引用章节号失准（§6 论证 2 / §10 A1） | 两处引「**§25** `PONG_TIMEOUT`『无 wire 帧——本地内部路径』」——协议文档无 §24/§25，该文实际位于 **§23.2 稳定码闭联合**（instance-replication-v1.md:653-656）。摘引文字属实，仅章节号失准；前置决议文档已登记同源勘误，设计未吸收 | 改引 §23.2（:656）。SA4/SA7 按章节号回查才能定位 |

**未列为攻击点的审查项**（查过、无问题）：close code 1001 裁决（§6 三重论证与 §14:387 / §15.1:440 / ADR-0010 round 2 先例一致，SA8 亦已裁定 no-conflict）；`!transport.closed` 跳过的定性（真实竞速下的合法幂等，**非伪降级**——见 §3）；hub 侧 helloHandle 10s 残留（state 守卫 + closedFlag 双拦，既有行为）；`connectionIdValue` 跨代滞留（既有行为，与本修复零交互，事件仅可选字段）；T2/T3 冻结面（dialNow catch :291-293 早 return，armHello 不可达；onClose 路径零触碰；T3 迟到 timer 被 state 守卫拦截且新双凭据守卫不产生假阳性——ready 态下 state 守卫先行返回）。

---

## 2. 协议假设依据审查（2026-06-13 立法）

- **章节存在性**：§10 在场，7 条（A1–A7），表格四列齐全。✅
- **依据可验证性**（SA2 逐条实测抽查）：A1（hub-connection.ts:374 消费 `connectionFatal('HELLO_TIMEOUT', 1002)` ✅）、A2（D3 先例 sa7-round2-dynamic.test.ts:663-667 ✅）、A3（:761-792 → :785 dropConnection ✅）、A4（:372-376 + :610 ✅）、A5（:335-336 epoch 门 ✅）、A6（红灯运行实证 fake scheduler 语义 ✅）、A7（§14:387 / §15.1:440 原文 ✅）。全部命令可重跑、引用可定位。✅
- **「应该/通常/预计」类无据推断**：未发现。✅
- **缺口**：「transport.close() 不同步 throw」这一隐性假设仅在 §11 以「契约为 void」带过，未入 §10 表（攻击点 #3）——这是 7 条之外唯一承载行为结论（onTemporaryFailure 必达）却无登记项的假设。
- **引用勘误**：A1/§6 的「§25」应为 §23.2（攻击点 #4）。

## 3. 错误处理链路审查（2026-05-07 立法；后端传输生命周期域映射）

- **静默失败**：被修复的孤儿传输本身就是静默失败面（旧 wire 不读不写、无任何观测信号）——设计以同步 close + hub 侧可观测 close 签名收口，静默窗口从最长 ~helloTimeoutMs 缩至一次微任务传播。✅
- **状态闭环**：全部失败路径收敛到 backoff/blocked 终态（六调用点核对，V2）；唯一缺口 = 攻击点 #3 的 close-throw 边（卡 handshaking、无定时器、无观测事件——三种静默形态叠加）。
- **降级路径**：hub 侧 HELLO_TIMEOUT 兜底保留 = 对**硬崩溃 peer**（本地定时器随进程蒸发）的真纵深防御——该前提在正常流程不成立，属真降级而非伪降级。✅
- **虚假降级识别（三度立法重点）**：`!transport.closed` 跳过 close——触发条件是「对端已关、close 事件尚在队列」的**真实网络竞速**，正常流程不承诺 transport 开放，属合法幂等；设计 §4.1 已显式论证此定性，SA2 认同。`connStateValue !== 'handshaking'` 早退——仅拦迟到 timer（helloHandle 已清后的假想残余），真实竞速态。**结论：零伪降级。** ✅
- **可感知性**：exactly-once `connection-backoff-scheduled`（reason=hello-timeout, attempt=1）+ 零 `connection-failed`（临时失败分类正确）+ hub 侧 `{1001,'hello-timeout'}` 签名——T1 :304-312 / D5 :804-807 断言面覆盖。✅

## 4. 红线测试思路（逐攻击点）

1. **（攻击点 #1/#4）** 无行为面——文档修订；SA4 复核时对照现状 `armHello` 源码与 §23.2 行号确认即可。
2. **（攻击点 #2）** 行为级红灯不可直达（私有方法、第三调用点尚未存在）。等价验证面：(a) SA4 静态审计——`git grep -n "detachCloseTimedOutTransport" -- 'packages/**/*.ts'` 必须恰好 3 处（定义 + pong/hello 两调用点），且每调用点守卫块内含 `this.transport !== transport`；(b) 既有 T1 :337（`wire2.peerSideClosed === false`）+ D5 :812（恰两代 wire）已隐式锁定「关的是旧代、新代无扰」——身份错配若发生必翻红。
3. **（攻击点 #3）** 红灯构想（仅当 SA1 采纳加固 (a) 时成立）：测试 wire 变体 `close() { throw new Error('adapter boom') }`（仅 peer 半边），hello 超时到点 → 断言 `getConnectionState() === 'backoff'`、恰好一次 backoff 事件、恢复链（重拨 wire2 → ready → live）完整；若 SA1 选择登记假设 (b)，则此构想作废，改由 pong real-transport 既有绿面背书。
4. **既有红灯契约无需改动**：T1/T2/T3 与 D5 的断言面与设计 §4 逐点对应（SA2 已逐行核对测试源码：T1 时序锚 :290-296、签名锚 :299-302、观测锚 :304-312、迟到 ACK :314-328、恢复链 :330-344；T2 dial-throw 冻结 :353-376；T3 onClose 冻结 + 迟到 timer :378-413）。

---

## 5. 裁决

**pass。** 设计对 §18 显式条款的对齐方式（共享 guarded helper 承载 R4 次序纪律）、冻结面零触碰、hub 侧零改动、观测面零新词——全部经 SA2 独立源码核验与全量基线实测支持；核心竞速矩阵（R1-R12）推演无洞。4 项发现均为加固/文档级（最高 LOW，且为 pong 路径既有暴露的同构复制、非本设计引入的回归），不构成 reject 事由。建议 SA1 于 SA3 动工前吸收 #1/#4（两处文字修订），#2/#3 至少以登记形式落地；SA4 按 §3/§4 的验证面复核。

（本报告为 SA2 唯一可写产物；未修改任何生产代码、测试或 SA1 设计文档。）
