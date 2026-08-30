# SA2 攻击评审报告 — Issue #170 ping/pong epoch safety 设计（SA1 R1）

**Date**: 2026-08-30
**Verdict**: **pass**（未发现 CRITICAL/MAJOR 级攻击点；4 个 MINOR 观察项登记给 SA4/SA7 验证锚点，不阻断 SA3 实现。技术核心——凭据关联、同步收口栈、双凭据校验、协议语义对齐——经本 SA2 逐条独立验证全部成立）
**被审对象**: `wiki/raw/task_issue-170-ping-pong-epoch-safety_design.md`（SA1 Round 1，584 行全读）
**任务简报**: `wiki/raw/task_issue-170-ping-pong-epoch-safety.md`（含 SA6 红灯契约 H1/P1–P5）
**相关决议文档**: `task_issue-170-ping-pong-epoch-safety_relevant_decisions.md` 不存在（总控已声明「如存在」；无 ADR 摘录基准 → 以任务简报 + 协议文档 `docs/protocols/instance-replication-v1.md` 为约束基准）
**审查方式**: 全新视角通读设计 + 逐行核对基线源码（`liveness.ts`/`types.ts`/`hub-connection.ts`/`peer-connection.ts`/`peer-namespace.ts`/`validate.ts`/`payloads.ts` 全文或定点）+ 协议文档锚点逐条亲验（§2 L42、§13.1、§14、§18 L524）+ SA6 红灯测试 6 例虚拟时钟时间线独立重推演 + 既有 4 个 pong 相关测试文件（D4/D3/D5/R4-1/R4-2）断言与 fixture 亲核 + 全仓 grep 连锁审计复核（`onPong`/`firePong`/`connectionEpoch`/`startLiveness`）。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（处置） |
|---|--------|--------|---------|------|
| 1 | MINOR | §11/§8.1 `[SA6 owned]` 标签 × §14 ④ 的执行主体一致性 | 两处既有 fixture 更新（sa7-hardening D4 wire、round2 LivenessLogWire）在 §11 ALLOW LIST 中标注 `[SA6 owned]`，而同清单内红灯测试文件的 `[SA6 owned]` 语义是「SA3 预期零改动」。两种读法（SA3 执行 vs 需总控重派 SA6）在 §11 层面有歧义；§14 SA3 实现顺序 ④（「§6.3/6.4 + §8.1 两 fixture」）已隐含裁决 = SA3 执行，但 SA4 做 scope 比对时若按标签机械门禁可能误判越权。**不阻断**：§14 ④ 已给出可执行裁决，且 §8.1「只改 wire 机制、断言零改动」约束明确 | SA3 按§14 ④ 执行即可；SA4 scope 比对时以本审查结论为准——两 fixture 的改动在 ALLOW 内、断言 diff 必须为零。SA1 下轮修订时可顺手在 §8.1 加一句「执行主体 = SA3（§14 ④），`[SA6 owned]` 仅指标语所有权」 |
| 2 | MINOR | §4 liveness catch 分支的可观测性 | `deps.ping(outstanding)` 抛错被空 catch 吞掉（`catch { loseLiveness(); }`），Error 对象的诊断信息（真实 ws 的 `WebSocket is not open: readyState 3` 等）无处留存。**不是静默失败**：该路径产生 wire 可见 close(1001,'pong-timeout') + FSM backoff + ns disconnected 投影，链路响亮闭环；且本包当前零日志/observer seam（grep 亲验 src 无 console/logger/observer），要求本任务引入日志面 = 超出 issue 范围（liveness/transport generation） | 登记为后续观察项：将来引入 observer seam 时为 LivenessDeps 增补可选 `onPingError?(err)` 钩子。本任务不要求 SA1 修订 |
| 3 | MINOR | §9 E-matrix 缺「pong 超时 × GOAWAY drain 窗口重叠」与「drain deadline 落在长 backoff 窗口内」两行 | round2 D3（:640-680，现役绿色）已覆盖短 backoff 下的「pong 超时赢过 drain deadline」语义（设计 §8.2 亦论证其保持绿）；但 drain deadline 落在**长** backoff 窗口内的交互（deadline 回调对已 onConnectionLost 的控制器再调 `quiesceControllers→onConnectionFatal`，ns 投影 failed，重连后经 openActiveTargets 的 failed→targeted 重开自愈）未入 E-matrix。该行为为**既有语义**（现行 `onTemporaryFailure` 同样不清 goawayDrain），设计既未恶化也未修复，非本任务缺陷面 | SA7 活链路验证时可将「GOAWAY drain 5s × backoff 50s」作为观察探针（FSM 保持 backoff、零二次 close、重连后 ns 重开收敛）；SA1 下轮可选补 E14/E15 行并引用 D3 |
| 4 | MINOR | §7 H1/P4 的 `hub.connections.length===1` 依赖异步 `cleanupAll` 在**不推进 hub 时钟**下完成 | hub dropConnection 在 `await settleTail`（channel cleanup 的 registry 异步操作）之后；H1 在 hub t=40 后不再推进 hub 时钟，仅靠 peer 侧 settleUntil 的微任务排水。风险被先例排除：round2 D3 的 `settleUntil(() => env.hub.connections.length === 0)` 同构场景（hub 时钟未推进）长期绿色，证明 registry cleanup 不依赖 hub-clock timer。属运行时验证事项而非设计缺陷 | SA4/SA7 运行验收时确认 H1/P4 的 connections 断言；若 flaky 再回溯（预期不会——先例绿色） |

**未成立的攻击（攻过且排除，留档防复审重复劳动）**：

- **「hub 也需要 epoch/transport 双凭据」**：不成立。逐行核对 `hub-connection.ts`：每 `HubConnectionImpl` 构造期独占 transport（:130-134）、liveness 每 connection 至多武装一次（`onHello` 仅 handshaking 态可达，二次 HELLO 走 :280-286 fatal）、`cleanupAll` 的同步前缀停 liveness（:386-390，`close()`/`connectionFatal`/`onTransportClosed` 均同步触达）、`onLivenessLost` 的 `closedFlag` 守卫吸收一切重入。hub 无「替换连接」概念——替换 = 新实例 + 新 transport，旧回调只能触达旧实例。I6 论证成立。
- **「6 例红灯时间线推演有断言对不上」**：对 H1/P1/P2/P3/P4/P5 逐时刻重推演（含双调度器分离——`harness.ts:493-503` 亲验 `makeNode` 每节点独立 scheduler；H1 的 hub liveness 走 hubNode.scheduler、peer backoff 走 peerNode.scheduler）。设计 §7 各行与测试断言（closeLog 码值、backoff 时刻、监听计数、ping 计数、dialCount、收敛值）全部对上。P1/P2 的迟到/重复 pong = 上一凭据回声、P3 的 `[0xde,0xad]` 长度 2≠8，均被 `credentialMatches` 三重判否正确拒绝。
- **「§8.1 fixture 忠实化是否真的必要/充分」**：亲核两 fixture 源码——D4 wire（:600-641）`firePong()` 无载荷投递、`ping()` 不收参；round2 LivenessLogWire（:502-511）`autoPong` 无载荷投递。在 strict 凭据匹配下 D4 的 :723-726「pong 已清计时——不误杀」断言**必红**（无载荷 pong 不再清超时 → t+500 收口 backoff），证明 fixture 更新在关键路径上、且设计给出的最小改动（记录 lastPingData + 回显投递）恰好充分。review-revisions 的 `firePong` 亲验仅 :626/:715 两处定义、零调用点 ✓ 设计判断准确。
- **「strict 匹配会不会打死合法场景（迟到但有效的 pong）」**：RFC 6455 §5.5.2 pong 必须回显 ping 载荷；本设计凭据为 8 字节会话内单调计数，`pongTimeoutMs < pingIntervalMs`（validate.ts:165 亲验 TypeError）保证至多一个在途凭据——迟到回声的载荷必然 ≠ 在途凭据，忽略它是**正确**语义（它属于已死 ping），不是误杀。
- **「epoch 前移到失败时刻会破坏 peer-namespace 消费方」**：grep 亲验 `peer-namespace.ts` 全部 9 处 `connectionEpoch()` 消费均为 `!==` 不等式判迟到（:191/:224/:294/:321/:386/:405/:785/:822），无「等于特定值」假设；且 backoff 窗口内控制器已 `onConnectionLost` 投影 disconnected，`isConnectionDead()`（`= isTerminal() \|\| state==='disconnected'`）独立覆盖。前移只会更早丢弃本应丢弃的续体。
- **「类型拓宽破坏公共契约」**：`onPong` 为接口 method 语法定义 → 参数双变（bivariance），旧签名实现可赋值；`api.test-d.ts:114` 的 `toMatchTypeOf` 仅锚 5 个必选成员（亲核），可选成员拓宽不影响双向可赋值性；`index.ts:13` 导出 `DuplexTransport` 但全仓 grep `onPong` 无包外消费者（A6 风险定级诚实）。
- **「TDZ：`stopInternal` 引用后置声明的 `offPong`」**：`stopInternal` 仅经 timer 回调与返回的停用函数触达，二者只可能在 `startLiveness` 返回后执行；同步注册期 `deps.onPong` 即刻回调监听器也被 `pongHandle===undefined` 早退拦住。设计要点 5 论证成立。
- **「protocol 依据造假/行号漂移」**：逐条亲验——§2 L42「活性检测只使用 WebSocket ping/pong。协议不定义业务 PING/PONG frame」原文在；§13.1 注册表恰 17 码、无 liveness 码（我逐行数过）；§18「pong 超时按临时失败处理：关闭传输（close code 1001）并经 backoff 重连」原文在；`pongTimeoutMs < pingIntervalMs` 配置期 TypeError 在 validate.ts:165；`encodeError` 对未注册码 `throwMalformed('unknown error code for ...')` 在 payloads.ts:310-315（与 SA5 Evidence #2 及红灯注释一致）。基线 `ef19bae` = worktree HEAD 亲验。

## 协议假设依据审查

- **§12 章节存在**：✓（「## §12. 协议假设依据」，A1–A6 编号表，依据类型/内容/风险三栏）。
- **依据可验证性**：A1/A6 引 RFC 6455 §5.5/§5.5.2（pong 回显义务 + unsolicited pong MAY + 控制帧 125 字节上限——与我对 RFC 的独立知识一致）；A2 引红灯 fixture 精确行为（亲核 :152-226，`ping` 记录载荷 / `injectPeerPong` 任意注入，与引用吻合）；A3 引协议文档 5 处锚点 + payloads.ts throw（全部亲验成立）；A4 引 SA5 动态取证（报告 `20260830-bug-ping-pong-epoch-safety.md` 存在，R3 时间线与 `throwPingWhenClosed` 建模一致）；A5 引同类绿色先例（D3/R4-2 同构 scheduler 断言，属实）；A6 自评「中」风险并给出契约注释 + dormant 兜底——诚实且已 grep 佐证无包外消费者。
- **「应该/通常/预计」类无据推断**：未发现。所有可静态核验的断言（行号、注册表内容、校验行为、fixture 形态、grep 计数）经我独立复核无一失实。
- **SA4 可验证性**：依据均可定位可重跑（源码行引用准确、协议文档行号准确、测试引用准确）；SA4 无需重跑 SA5 动态取证，但红灯 6 例转绿 + 161/161 全量绿本身就是运行时证据。

## 错误处理链路审查

- **静默失败**：未发现新增静默失败面。liveness 的 ping 抛错 catch（防御）虽吞掉异常细节（攻击点 #2，MINOR），但失败本身响亮：close(1001,'pong-timeout') 上 wire + FSM backoff + 控制器 disconnected 投影，三层可观测。hub `onLivenessLost` 与 peer 闭包的守卫链（closedFlag / stopping+双凭据+状态）覆盖全部重入路径（E4/E5/E6/E11 逐一成立）。
- **状态闭环**：pong 超时→backoff、远端 1002/1008→blocked、GOAWAY SHUTTING_DOWN/REAUTH→blocked 全部经带状态守卫的 funnel 收口；blocked/backoff 后监听三面归零（I4）、零存活 timer——状态机无悬空分支。
- **降级路径**：缺 ping/onPong 面 → liveness dormant（零 timer、连接照常）——这是传输契约（types.ts 可选成员，切片 9 前无生产 adapter）下的**合法**能力降级，先例（D4「缺面 dormant」用例）长期绿色，**非虚假降级**。反之，strict 凭据匹配把「无载荷 pong」从静默放行改为拒绝，配 §3 契约立法（无法透传载荷的实现不得暴露 onPong）+ §8.1 fixture 忠实化——这是把被 fixture 非忠实建模掩盖的真语义纠正回来，方向正确、无降级掩盖 bug 之嫌。
- **用户可感知性**：每类失败（超时/死对端/协议错误/hub 停机）均落到 close 码 + FSM 状态 + ns 投影 + 重拨收敛，红灯测试逐面断言。

## 红灯测试思路（对攻击点 #1–#4 的验证方向）

1. **#1（fixture 执行主体）**：SA3 交付后 `git diff` 两 fixture 文件——断言块（`expect(...)` 行）diff 必须为零、仅 wire 机制行（`ping(data?)` 记录/`firePong` 回显/监听器类型）变更；随后 `pnpm exec vitest run packages/ws-replication` 必须 161/161——若 D4 :723-726 红，即 fixture 更新缺失或回显不忠实的直接证据。
2. **#2（ping 抛错可观测性，非本任务门禁）**：将来落 observer seam 后补——transport `ping` 注入一次性 throw（throwPingWhenClosed 面已有）→ 断言 close(1001) 且 `onPingError` spy 收到原始 Error；当前轮以 P4 的 `closedTransportPingErrors()===0`（结构性不发生）为足够门禁。
3. **#3（GOAWAY drain × 长 backoff）**：probe 构思——GOAWAY(SERVER_RESTARTING, drain 5_000) + pingInterval 1s/pongTimeout 0.5s + backoff base/max 100_000（random 0.5 → 50s）：pong 超时于 t=1.5s 收口 backoff；drain deadline t=5s 在 backoff 窗内触发 → 断言 FSM 恒 'backoff'、peerCloseLog 仅一条 {1001,'pong-timeout'}、t=51.5s 重拨后 ns 经 failed→targeted 重开并收敛写值。当前为观察探针（既有语义），非红灯要求。
4. **#4（hub 异步 drop）**：H1/P4 已内建断言（`hub.connections.length===1`）；SA4 只需按验收命令跑全量——绿色即证明 cleanupAll 不依赖 hub 时钟推进（与 D3 先例一致）。

---

## 结论

**pass**。设计的四层修复（§3 seam 拓宽 → §4 凭据关联+自停 → §5 hub 协议语义 → §6 peer 同步收口栈/终态拆除）与 SA5 R1–R4 根因、SA6 红灯契约、issue 六条验收标准逐一对齐；全部静态可核验主张（协议锚点、源码行号、fixture 形态、类型兼容、epoch 消费面、grep 连锁审计）经本 SA2 独立复核无一失实；六例红灯的虚拟时钟时间线独立重推演全部转绿成立。4 个 MINOR 观察项不构成修订门槛，登记为 SA4/SA7 的验证锚点。同意放行 SA3 按 §14 四步实现顺序动工。
