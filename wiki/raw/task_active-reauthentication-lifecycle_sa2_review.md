# SA2 攻击评审报告

**Date**: 2026-08-30
**Verdict**: **pass**（附 4 项非阻断 MINOR 建议；两项 SA6 锚点争议与 drain=0/双 blocked reason 协议解释均已独立裁决，裁决结论 = 维持 SA1 设计主张，详见 §裁决一/二/三）

- 评审对象：`wiki/raw/task_active-reauthentication-lifecycle_design.md`（SA1，2026-08-30）
- 输入：任务简报 + `_relevant_decisions.md`（ADR 约束基准）+ 红灯套件 `ws-replication-reauth-lifecycle-red.test.ts` + `test/driver.ts` + `test/harness.ts` + `src/{types,hub-connection,peer-connection,frame-io,validate,defaults}.ts` + 冻结绿套件（G1/G2、D5-B1、hardening-R4、r1-transport-auth-D4、auth-lifecycle-AC-6、review-revisions-R3-4/R7-1）+ 协议 `docs/protocols/instance-replication-v1.md` §5/§6.3/§15.1/L450/L524。
- 本评审为全新视角独立推演：未采信 SA1 报告的任何断言为前提，每条关键机制链均回源码/测试逐行复核，并实跑红灯基线与冻结绿套件。

---

## 裁决一（总控交办）：IT4 L358 `hubSideCloseInfo?.code === 1000` 锚点缺陷 —— **SA1 的缺陷申报成立**

SA1 §10.1 主张该断言在任何满足 IT1/IT3/AC4 的设计下不可满足。独立复核结论：**成立**。完整机制链（逐环均已回源码验证）：

1. `advanceMs(run, 60_000)`（driver.ts:590-593）推进的是 **peer** scheduler；fake scheduler `advanceBy` 触发一切 `at <= deadline` 的 timer（`namespace-registry/src/testing.ts:92-107`，due 过滤 + 到期序逐个 fire）。IT4 L341 注入 `drainTimeoutMs: 5_000` → 本设计 §6 的 receiver 侧 deadline 武装于 peer 时钟 t+5000 → **必然在 L346 的 60s 大步中 fire**。
2. fire 动作 = peer 本端 `close(1001, 'blocked-deadline')`（peer 端发起）。fake wire 的观测语义是「对端观测」：`hubSideCloseInfo` **只**由 hubEnd wrapper 的 onClose 拦截器记录（harness.ts:695-699），仅 peer 端 close 时触发 → 记为 `{code: 1001}`。
3. L353 通知触发的 `requestRebuild` 内 `transport.close(1000)`（peer-connection.ts:710-713）：旧 transport 已 closed → 条件跳过；即使调用，`makeEnd.close` 幂等（`if (self.closed) return`，harness.ts:580-586）→ no-op。**首个 peer 端 close 的码（1001）胜出**。
4. → `hubSideCloseInfo.code = 1001 ≠ 1000` → 断言必败。

**与 IT3 的矛盾性证明（独立推演）**：IT3（L298-318）注入帧无 hub 侧连接状态变化（injectHub 只经 hubEnd.send 上 wire，hub 连接不解析自己的出站帧），peer 侧 deadline 自行收口是 IT3 L312-313 的**唯一**满足方式 → 任何合规设计的武装函数 f 必须满足 f(60) ≤ 60（IT3，closeTimeout=5000 缺省）；IT4 要求 f(5000) > 60000（closeTimeout=5000，与 IT3 同值，连接状态史相同）。两界无连续/成比例函数同时满足。**唯一能区分两测试输入的是 drain 与 peer 自身 closeTimeoutMs 的相对比较**（如「drain < closeTimeout 才武装」）——我独立构造并验证了该分支确能使六条 IT 字面全绿，**但它在缺省生产配置下（双侧 closeTimeoutMs 缺省均为 5000，drain == closeTimeout）永不武装**，SA5 R3（发送方 drain 窗内死亡 → wire 无限开放）在缺省部署中原样存续，直接违反 AC4「不无限保持开放」。SA1 对该分支的「numerology，非语义」驳斥**成立**；其「不可满足」的措辞应理解为「不可满足于任何不违反 AC4 缺省配置语义的设计」——SA1 在同段已明示这一定性，无实质瑕疵。

**红灯潜伏性实证**：本评审实跑 `npx vitest run packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts` → 6 failed / 0 passed，IT4 现死于 L353（notifyAuthChanged TypeError），L358 从未执行——与 SA1「冲突未被暴露」的根因陈述一致。

**对 SA6 修正建议（drain 5_000 → 300_000）的复核**：60s 零通知窗口完整落在 deadline 之前（blocked 不变、dialCount 1 保持）；rebuild 的 1000 重新成为旧 wire 首个 peer 端 close；恢复链断言（dial 2 / verifyCalls / live / 收敛 / 零 token 泄漏）全部不受影响。**语义零损失，同意该修正**。

## 裁决二（总控交办）：IT6 L438 `hubSideCloseInfo?.reason.includes(TEST_TOKEN) === false` 锚点缺陷 —— **SA1 的缺陷申报成立**

独立复核结论：**成立**。机制链：

1. `hubSideCloseInfo` 仅在 **peer 端发起 close** 时记录（harness.ts:695-699 + makeEnd :583-585 的对端通知方向）。
2. IT6 全程只推进 **hub** 时钟（L431）；peer 时钟冻结 → peer 侧 blocked deadline 永不满期；hub deadline 触发的 `close(1001,'hub-reauth')` 到达 peer 后被 blocked 早退吸收（peer-connection.ts:555，不发起本端 close）→ **peer 端永不 close → hubSideCloseInfo 恒 undefined**。
3. 补充复核（比 SA1 论证更强的封闭性）：即使假想 peer 稍后 close，hub 侧 `cleanupAll()` 同步段早已 splice 掉 transport 订阅（hub-connection.ts:548；transport.close 的通知经 queueMicrotask 投递，cleanupAll 同步前缀先运行）→ wrapper 拦截器已摘除，仍无法记录。两路独立封死。
4. `undefined?.reason.includes(...)` 短路求值 = `undefined`；`expect(undefined).toBe(false)`（Object.is）必败。

**AC7 覆盖不受损**：L435 全 wire 字节扫描 + L437 `peerSideCloseInfo`（hub 主动 close 的真实观测侧，值为 `{code:1001, reason:'hub-reauth'}` 静态无凭据）已完整覆盖本形态。SA1 的替代路径分析（重排 hub 收口拓扑迁就误模断言 = fake/生产语义分叉）驳回正确。

**对修正建议的补充意见**：删除 L438 可接受；**更优变体**是改为 `expect(run.wire.hubSideCloseInfo).toBeUndefined()`——把 harness「对端观测」语义钉成显式断言，防止未来重新引入同类误模锚点（供 SA6 参考，二选一即可）。

## 裁决三（总控交办）：drain=0 不武装 + 两个 blocked reasonCode 都武装的协议解释 —— **维持 SA1 解释**

### 3a. 「blocked 两类 reason（SERVER_SHUTTING_DOWN / REAUTH_REQUIRED）都武装」= 协议忠实读法

- §6.3 L141 的 deadline 规则是 GOAWAY **字段级**规则（`drainTimeoutMs | varUint | 接收时开始计算本地 elapsed deadline`），对 reason 无条件；L148「之后发送方以 WS 1001 关闭」的发送方义务同样不区分 reason。§15.1（L435-442）只区分 deadline 关闭**后的重连调度**（blocked vs backoff vs retryAfter），从不涉及 wire 生命周期。现实现的不对称（drain 类 `armDrainClose` peer-connection.ts:419-430 武装、blocked 类不武装）正是 SA5 根因 #3。
- **冻结绿套件兼容性逐一复核**（这是本裁决的最大攻击面，SA1 未逐条列证）：
  - G2（sa7-dynamic:218-225，SHUTTING_DOWN drain=60）：`settle()` 只排微任务不推进 scheduler（harness.ts:247-251）→ deadline 不 fire，`peerSideClosed === false` 仍绿；
  - hardening-R4（:888 区域，drain=5_000）：peer 时钟仅推进 2×1000ms < 5000 → 不 fire；
  - review-revisions R3-4 / R7-1（drain=5_000）：零时钟推进（R7-1 的 rebuild 亦会经 §6.4 清句柄）；
  - r1-transport-auth D4 / auth-lifecycle AC-6：真实 hub.close() 路径，发送方立即 close → deadline 回调撞 `transport.closed` 跳过。
  - **结论：无一冻结绿测试会被「双 reason 武装」击红。**
- SA1 登记的 REAUTH-only fallback（§6.1 一行条件）在本裁决下无需启用。

### 3b. 「drain=0 不武装」= 冻结语义钉死的唯一读法

- D5-B1（sa7-issue137-dynamic:583-631）注入 `drainTimeoutMs: 0` 后断言 `pending() < pausedPending`（:616）——若 0 值武装，timer 入计面恰 +1 回到 `pausedPending`，`<` 失败（`settle()` 不推进时间，timer 不会提前消失）；:624-625 的 60s 冻结锚同理。**实测语义 = 0 值不产生任何新 timer。**
- 0 是 varUint 合法 wire 值；生产 Hub 两条 GOAWAY 生产路径恒发 `closeTimeoutMs`（validate.ts positiveSafeInteger 构造期保证 >0）→ 0 只来自注入/异常对端。
- **补充证据（SA1 未列，进一步支撑）**：drain=0 不武装 ≠ wire 无限开放——`enterBlocked` **不**停止 liveness（`stopLivenessNow` 仅在 stop():118 与 dialNow():191），ping/pong 在 blocked 期继续，pong 超时按 L524 以 1001 关传输（onClose blocked 早退保持状态）。生产面 wire 生命周期仍有界。该 backstop 建议补入 §6.3 论证（MINOR 建议，非阻断）。
- 虚假降级判定：**非伪降级**——0 值语义有冻结绿测试 + 生产恒 >0 双重锚定，不属「正常路径前提缺失被降级掩盖」。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | MINOR | §4.3 论证强度 | 「红灯套件算术确认……drain 值必须恰等于 closeTimeoutMs」言过其实：IT1/IT2/IT5/IT6 均从**发出的帧**读取 `goaway.drainTimeoutMs` 再 advanceBy 该值，测试实际约束是「hub deadline timer == 帧携带值」的自洽性，而非特定数值。closeTimeoutMs 是良好的设计选择（close():221 先例 + 零新 knob），但不是测试强制算术。 | 措辞降级为设计选择依据（SA1 修订文档时顺手改，不影响 SA3 蓝本）。 |
| 2 | MINOR | §3 冻结面注记 | types.ts 头部注释「SA6 冻结，逐字段；实现不得增删改名」（types.ts:1-2）在新增两成员后将自相矛盾。§3 论证了冻结基线随任务前移的合法性（简报 §SA6 明文要求扩展），但未指示 SA3 同步更新头注。 | SA3 实现时在头注追加「#175 SA6 冻结契约扩展：requestReauth/notifyAuthChanged」引注（comment-only，在 ALLOW 文件内，不违反「不得增删改名」的成员面纪律）。 |
| 3 | MINOR | §7 竞态矩阵完备性 | 缺一行：`requestReauth` 与同身份新连接 `accept()`（认证中，连接尚未入 connectionList）并发——本轮迭代错过该连接。契约上无害（幂等、调用方重发即覆盖），但 SA7 动态面宜有覆盖说明。 | §7 追加设计期推演行（非缺陷登记），SA7 可选加动态变体。 |
| 4 | MINOR | §6.2 措辞 | 「enterBlocked 首行动作是 clearDrainClose()」——实际首语句是 blocked 幂等守卫（:656），clearDrainClose 在 :657。排序论证（先 enterBlocked 后武装）不受影响。 | 措辞修正，非必需。 |
| 5 | 无（记录） | 竞态/死锁全扫 | 单线程事件循环无锁序风险；hub reauth deadline 句柄单点清理（cleanupAll 头部）覆盖全部四条收口路径（:317/:541/:572/:615，逐一核对）；peer `drainCloseHandle` 清除点（stop:116 / dialNow:189 / requestRebuild§6.4新增 / onGoawayClosed:581 / onClose draining:564 / enterBlocked:657）无泄漏路径。§4.6 双序竞态逐行推演通过（shutdownWithGoaway :324-340 + onMessage 状态门 :255 + onClose blocked 早退 :555，peer 观测 1001 成立）。 | — |
| 6 | 无（记录） | 极端输入 | 畸形/超长 instanceIdentity → 零匹配 → resolve（键查询语义）；wire 侧 drain 为 varUint 超大值 → 长_timer，生产有 liveness 兜底（裁决三 3b）。无 panic 面（sendControl try/catch fail-closed，镜像 :336-338 家族）。 | — |

**未发现 CRITICAL/MAJOR 级攻击点。**

## 协议假设依据审查

- §11 章节存在，9 条假设全部给出可验证依据（源码行号引用 / 冻结测试引用 / 实测结果引用），无「应该/通常/预计」类无据推断。逐条抽验：依据 1（sendControl 同步冲刷，frame-io.ts:126-147 `push + drain()` 同步）、依据 2（positiveSafeInteger，validate.ts:160-176 实测核对；defaults closeTimeoutMs=5000）、依据 3（makeEnd 幂等 + 对端观测）、依据 4（fake scheduler due 过滤）、依据 5（onClose :555 早退 + G2）、依据 6（handshaking 非 HELLO_ACK → CONNECTION_POLICY_VIOLATION，peer-connection.ts:272-279）、依据 8（四路径汇聚 cleanupAll）——**全部与源码吻合**。
- 依据 9 的实测验证有命令与输出在案（任务简报 §红灯验证结果），且本评审独立重跑复现：红灯套件 6 failed / 6（exit 1，全部死于 seam TypeError 锚）；三冻结绿套件 `ws-replication-sa7-dynamic` + `sa7-hardening-dynamic` + `sa7-r1-transport-auth` **19/19 通过**（3 files passed，Type Errors: no errors）。SA4 可按同命令重跑验证。
- 本设计无新增端点/端口/进程时序/第三方库假设——纯包内状态机 + 既有注入 seam，声明属实。

## 错误处理链路审查

- **静默失败**：未发现。GOAWAY 发送失败（framing 不可信 / uint32 耗尽 OutboundExhaustedError）→ catch → `close(1001,'hub-reauth')` fail-closed（§4.2）；绝无「无帧 + 无收口 + 无状态」路径。
- **状态闭环**：blocked 态经 `enterBlocked` 在所有 blocked 入口统一写入（onGoaway 两条 reason / onClose 1002/1008 / connectionFatal / onSequenceExhausted）；draining 态经 setState；hub 侧 closedFlag 单点。
- **降级路径**：三类降级（未知身份 no-op / 非 blocked 通知 no-op / drain=0 不武装）逐项过虚假降级判定——均有冻结契约或冻结绿测试锚定，非 bug 掩盖（裁决三已详述 drain=0）。
- **用户可感知性**：库层无 UI；可观测面 = `HubConnection.state`（§15.2 合法迁移 ready→draining）+ `PeerConnectionState` blocked + wire 码/reason（静态安全码）。本包 src 零 logger/console 面（grep 实证）——AC7「零日志暴露」由结构保证。
- **虚假降级识别**：§9 自检表五行独立复核全部成立，无伪降级。

## 红线测试思路（对应攻击点 + 裁决的 SA7 动态面建议）

1. **（裁决一修正后的回归锚）** IT4 修正（drain=300_000）落地后，SA7 应追加镜像断言：`advanceMs(run, drainTimeoutMs + 60_000)` **无通知**时旧 wire 以 1001（blocked-deadline）收口且仍 blocked——把「receiver deadline 与 rebuild 1000 的先后序」两个分支都钉死，防止未来实现把 deadline 悄悄挪到 rebuild 之后。
2. **（裁决二修正后的观测语义锚）** IT6 修正若采纳 `toBeUndefined()` 变体，即冻结 harness「对端观测」语义；SA7 动态面再补一条真实 socket 版（r1-transport-auth D4 同款基建）：hub 主动 reauth → peer 原始 socket 事件序 `frame:GOAWAY(REAUTH_REQUIRED) → socket-close(1001)`，双侧 close reason 无 token。
3. **（攻击点 3）** requestReauth 与 accept 竞态：`callReauth` 与 `hub.accept(newWire)` 同 tick 背靠背 → 断言二发 requestReauth 后新连接也收到 GOAWAY（幂等重发覆盖语义），零 unhandled rejection。
4. **（裁决三 3a 的负面锚）** SHUTTING_DEADLINE 武装不误伤既有语义：注入 `GOAWAY(SERVER_SHUTTING_DOWN, drain=60)` 后 `advanceBy(60)` → wire 收口 1001 且 **state 仍 blocked**（不 backoff、不重拨）——G2 只覆盖 fire 前半段，fire 后半段（本设计新增行为）目前无冻结锚。
5. **（drain 边界）** 注入 `drainTimeoutMs: 0`（REAUTH_REQUIRED）→ 断言与 D5-B1 同款：`pending()` 计面不增、wire 冻结、blocked 保持——把 0 值语义从 SHUTTING_DOWN 扩展锚到 REAUTH_REQUIRED（现 D5-B1 只测前者）。

## 结论

设计三腿（Hub 主动侧 / Peer 恢复缝 / receiver 侧 deadline）架构自洽、ADR-0010/0008/0009 全条款合规、AC1–AC8 覆盖矩阵完整、竞态幂等矩阵（10 场景）与零 unhandled rejection 论证经独立推演成立。总控交办的三项争议均独立裁决为**维持 SA1**（两处 SA6 锚点缺陷申报成立、修正建议同意；协议解释正确）。4 项 MINOR 均不阻断 SA3 开工。

**Verdict: pass。** 附带条件：§10 的 SA6 测试修正（IT4 L341 drain 值 / IT6 L438）须按本报告裁决由 SA6 流转执行后方可全绿验收；`pass` 不替代 SA4/SA7 对实现与活链路的后续验证。
