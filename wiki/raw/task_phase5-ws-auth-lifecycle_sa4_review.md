# SA4 静态验尸报告 — issue #138 Phase 5 切片 7：实例认证与连接生命周期

**Date**: 2026-08-29
**Reviewer**: SA4（Red Team）
**Reviewed commits**: `556d6da`（实现）+ `f749c89`（档案）；基线 `08da15b`
**Verdict**: **pass**

---

## 0. 独立验证证据（SA4 自跑，非采信 SA3 声明）

| 命令（独立后台进程，无端口依赖） | 结果 |
|---|---|
| `node node_modules/vitest/vitest.mjs run packages/ws-replication/test/ --typecheck` | **Test Files 18 passed / Tests 121 passed / Type Errors 0 / EXIT=0**（含红灯契约 15/15 逐 IT ✓，verbose 摘录见本节末） |
| `tsc -p tsconfig.typecheck.json --noEmit`（全仓） | **EXIT=0** |
| `node node_modules/vitest/vitest.mjs run`（全仓） | **Tests 1992 passed / Type Errors 0 / EXIT=0**（Duration 488s；summary 报 `Errors 2`——非 ws-replication 面，见 §9-动态重点 D1） |

红灯契约 15 IT 全绿逐条确认（verbose reporter）：#1 幸福路径（verifyCalls 记账 + HELLO_ACK nonce + token 零上 wire）、#2–#5 upgrade 拒绝四态、#6 身份绑定、#7/#8 revoke、#9 GOAWAY draining/hint 调度、#10 hub.close GOAWAY 先行、A2-a/b/c/d/e 全数 ✓。

---

## 审核结论

### 1. 设计一致性：✅ 一致（含 2 项已呈报的合理偏差，逐项复核如下）

- **§1.1 Scope Creep Guard：通过**。actual diff（base `08da15b` → HEAD，22 文件）逐文件比对 §11 ALLOW LIST：
  - 6 个 src 文件（types/validate/index/hub-connection/hub-namespace/peer-connection）全部在 ALLOW；
  - 测试面 8 文件全部在 ALLOW，且**内容级**核对在授权范围内：
    - `ws-replication-sa7-dynamic.test.ts`：G1 改锚**恰 2 行**（L188 注释 + L189 `'ready'`→`'draining'`），L190-215 零触碰（§6.5-A1 授权面，diff 逐行核对）；
    - `ws-replication-api.test-d.ts`：纯类型断言锁同步（accept 双参/Promise/undefined、revoke、verifyToken 必填），零运行时逻辑；
    - 4 处直建 hub（issue137-driver / spec-b1-b2 / sa7-issue137 / sa7-r2-transport）：各 1 行 `verifyToken: DEFAULT_PEER_VERIFIER` + import（§11 允诺形态）；
    - `driver.ts`：+51 行全部为简报「Fixture/测试基础设施变更」节 SA6 已声明的面（契约镜像/TEST_TOKEN/DEFAULT_PEER_VERIFIER/boot 选项/verifyCalls/accept 侧 token 注入）——**无越出声明面的运行时逻辑或断言改动**；
    - 红灯契约文件：SA3 修整 2 处均为时序基建（见下），断言值与简报测试矩阵逐条对账一致（#9 的 dialCount 1@5000/2@7500、A2-d 四变体、A2-e 双关闭码）。
  - **DENY LIST 零触碰**（`git diff --name-only | grep replication-protocol|namespace-registry|defaults|peer-namespace|round-engine|update-channel|backpressure|fence-watchdog|frame-io|error-mapping|lifecycle-queue|testing.ts|harness.ts` → 空集）；BLACKLIST（npm/yarn lockfile、TASK.md、*.bak）零命中。
- **§1.2 设计偏离**：D1–D5 逐面与设计伪代码比对一致（accept 门 0–5 次序与语义、onHello 绑定插入点在 expectedHubInstanceId 对照之前、revoke 三层链 + settleClose 链式追加含 N4 归一化、onGoaway 分级/onClose draining 分类/onGoawayClosed hint 公式、close GOAWAY 先行 + handshaking 直关 1001）。基线对照（`git show 08da15b`）证实设计 §0.1 所述三缺陷（ready 键控缺失/drain 句柄不可清/忽略 retryAfterMs）确实全部修复。**两项实现期偏差（SA3 §3 已呈报）复核**：
  - **偏差 1（红灯 #9 补 `await settle()`）**：属「测试基础设施级修复」授权域——断言值零改动（与简报逐字一致），仅修正 close 事件微任务交付与 fake scheduler 时钟推进的时序前提（设计 §6.3 时间轴本就以「close 事件在 t_close 同刻处理」为前提，G1/D5/A2-c 同款先 settle 再推进模式）。**放行**。
  - **偏差 2（门 4 与门 5 之间 `await queueMicrotask` 让出 + authRejected 兜底复核，hub-connection.ts:168-174）**：为满足冻结锚 A2-d 单帧超界变体（即时验证器下首帧投递微任务与验证器续体同批竞争）的最小实现侧扩展。安全性复核：①让出点在 clearAuthTimer 之后（窗口内零 timer 悬挂）；②让出后 `detachEarly→复查→构造→重放` 仍为同一同步块——§3.3 不变量 2（摘监听与连接监听安装之间无第三帧窗口）保持；③让出期间到达帧仍走有界早到缓冲（≤16）；④让出期间世界变化（closed/earlyClosed/transport.closed/authRejected）四态全部在既有门 5/兜底复核覆盖；⑤全量回归 1992/1992 证明零既有面扰动。**方向为收紧**（把「超界帧零分配」从宽窗口扩展到零宽窗口），不弱化任何契约。**放行**；同意 SA3 呈报：建议 SA8 将其登记为设计勘误（§3.2 伪代码补让出 + §3.4 零宽窗口声明）——该项不构成本轮 reject 义务。
- **§1.3 E2E spec runner**：本任务零 E2E spec，N/A。
- **§1.4 vitest 触发性：通过**。CI（`.github/workflows/ci.yml` L39 `pnpm test`）= `vitest run --typecheck`，根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` → 新增红灯契约与全部改动 test 文件均在 `test` job 触发范围内；typecheck include 覆盖 `*.test-d.ts`。
- **§1.5 协议假设：通过**。设计 §12 表完整（A1–A12，含依据类型分类，无「应该/通常」类无据行）；SA4 抽检重核：A1（`messages.ts` GoawayMsg 四字段 + 可选 retryAfterMs ✓）、A2（`harness.ts:540-568` makeEnd 微任务 FIFO + listener 快照 ✓）、A12（`sa7-r2-transport.test.ts:132-144` TcpTransport 注册即同步重放、重放先于 return ✓）——三处引用行号与内容实测相符。
- **§1.6 契约改动连锁：通过**。`accept` 同步→异步 + `verifyToken` 必填的 caller 矩阵全仓 grep 复核：6 处运行时 caller（driver×2、issue137-driver、spec-b1-b2、sa7-issue137、sa7-r2-transport）全部 fire-and-forget 且不消费返回值——依赖「accept 永不 reject」不变量，该不变量经三层验证：门 4 全 catch、no-op off 句柄使同步重放型 transport 上 `onMessage(...)` 调用点零同步抛出（A2-e 的 `resolves.toBeUndefined` + `collectUnhandledRejections` 空 + 重放计数防流产三重锚）、红灯 #5 probe。全仓无 ws-replication 包外消费方（apps/domains 零引用，package private）——无隐藏 caller 面，C 层（process.exit catch-all）不存在。

### 2. 读写路径一致性：✅ 一致
认证身份单一数据源：D1 构造注入 `authenticatedInstanceId`（写）= D2 `onHello` 绑定对照（读）= D3 `revoke` 权威键（读）——三处同源，无自声明身份分叉。peer 侧 nonce/hubInstanceId 对照链未被触碰。

### 3. 静默失败：✅ 无
新代码全路径逐条 trace：accept 六类拒绝全部有 transport.close(静态 reason) 可观察效应；auth 超时 1008；revoke 未知 scope 零副作用是冻结契约本体（红灯 #8 断言该行为）；onGoaway 两分支均有状态迁移（blocked/draining）。无「无请求/无状态/无 UI」三无路径。

### 4. 降级方案：✅ 安全
fail-closed 拒绝簇（验证器抛错/ok:false/文法违例/畸形成功裁决/帧超界/认证超时）全部为设计 §9 立法的信任边界异常路径处置——显式关闭 + 静态 reason + 有界资源账，非静默降级。门 2「无认证器 = 全部拒绝」为纵深防御（构造期 TypeError 响亮失败优先，运行期残留 fail-closed），正确方向。

### 5. 极端攻击：✅ 安全（静态可确认面闭合；动态面移交 §9）
- **资源界**：早到缓冲 ≤16 帧 × maxFrameBytes 单帧界 + 认证等待 ≤ helloTimeoutMs；每 accept 独立缓冲/timer，并发 N 界 = N×单项界；迟归验证器不复活（`authRejected` 首检）。
- **Timer 矩阵**：drainCloseHandle（fire 自清/onGoawayClosed/dialNow/stop/enterBlocked 单点）、backoffHandle（hint 复用既有清理列）、authHandle（任何 accept 出口必清；验证器永不 settle 时 timer 自耗散不泄漏）——逐出口核对无悬挂。
- **同步重放型 transport**（A12 形态）：no-op 句柄 + 幂等早退 + 注册后同步收口段——重放期拒绝只置标志+close，摘监听延后，调用点零同步抛出（A2-e 实证：`replayedCount` = 预置数）。
- **竞态清单**（§8.3 全表）：认证期 close/断线/早到/双 GOAWAY/stop 期 drain/draining 期 removeTarget/恢复触发双路径——实现逐一有对应处置，未发现无覆盖窗口。
- **AC-7 脱敏**：全部新 close reason 为静态常量（`upgrade-unauthorized`/`upgrade-frame-limit`/`upgrade-timeout`/`hub-shutdown`）；ERROR safeMessage 走 frame-io 静态表（DENY 冻结未动）；token 仅存于内存 request 对象；红灯 #1 全字节扫描 + #6 safeMessage 断言双锚。零 console/零 env-override/零 process handler 新增（diff 扫描）；`Math.random` 唯一命中为设计 §6.3 字面规定的注入 seam 缺省（与既有 makeNonce/onTemporaryFailure 同款）。

### 6. 错误处理：✅ 完整
§8.2 不变量验证：accept 恒 resolve（含 undefined）；settleClose 存储前归一化（N4）杜绝 floating rejection；shutdownWithGoaway GOAWAY 发送 try/catch；terminateUnauthorized→terminationSettled 吞清理异常使 revoke resolve 语义稳定。

### 7. 架构评估：✅ 可行
D1–D5 全部落在既有模块边界；无绕过性硬编码；diff 中零 FIXME/TODO；不触及 #136/#137 冻结面（namespace 状态机/round engine/背压）。无退回 SA1 信号。

### 8. 过度设计：✅ 精简
hub-connection 净 +185 行承载五正交改动面（认证管线/绑定/revoke 链/停机序），与 7 条 AC 体量相称；MAX_EARLY_FRAMES 模块常数零新 knob（SA2 A2 裁定遵守）；无投机抽象层。

### 9. 测试行为质量（§1.7 源码 grep 禁令）：✅ 通过
红灯契约文件零 `readFileSync`+`toMatch/toContain` 反模式；全部断言为运行时行为（wire 解码帧计数/关闭码+reason/状态投影/verifyCalls 记账/连接分配观测）；A2-e 的 makeReplayTransport 为 seam 层 fixture（实现 DuplexTransport 五成员），非 mock 被测对象；driver 的 injectHub/dropNextHubFrame 为 wire 级故障注入 seam。红灯→绿灯证据链完整（简报 R2 运行证据 16 红逐断言失败点 vs 本轮全绿）。

---

## 动态审核重点（交 SA7）

1. **D1（全仓 suite `Errors 2` 基线归属）**：全仓 1992/1992 绿、EXIT=0，但 vitest summary 报 2 条 non-fatal errors（SA4 运行管道截断了明细；ws-replication verbose 运行零 unhandled）。请在 `gh run`/本地全量运行摘录该 2 条 error 的归属文件，确认系其他包 pre-existing 基线噪声、非本切片引入（ws-replication 无包外消费方，静态判定概率极低，动态确认封口）。
2. **D2（真实 WS 栈 bearer 通道）**：`HubUpgradeRequest.token` 在切片 9 composition root 前无生产注入点。动态验证时确认真实 HTTP Upgrade → accept 映射中 token 取自 header（非 URL query——URL 会进访问日志），且上游网关日志零 token 落盘（AC-7 的包外半边）。
3. **D3（早到缓冲洪泛面）**：静态界 = 16×maxFrameBytes（默认 8MiB → 单恶意 upgrade 窗口内 ≤128MiB 实占内存，以实发字节为限）+ helloTimeoutMs 时限。请在真实 socket 上做一次未认证灌帧洪泛，观测 hub 进程 RSS 峰值与回收（超时关闭后归零）。
4. **D4（GOAWAY→close(1001) 真实 TCP 次序）**：§7.2 帧序保证在 fake wire 上是微任务 FIFO；真实 TCP 上 `send(GOAWAY)` 后立即 `close(1001)`——请用 sa7-r2-transport 的真实 TCP 形态确认 peer 先收 GOAWAY 帧再收 close 事件（TCP 半关闭次序）。
5. **D5（真实 TcpTransport × 认证窗口叠加）**：A2-e 以 fixture 覆盖同步重放；真实 `sa7-r2-transport` 全量回归虽绿，请确认其 server 回调路径在 verifyToken 异步窗口内的积压重放与早到缓冲叠加无双重投递（设计 A3「二者叠加无双重投递」声明的动态面）。

---

## 处置结论

- **Verdict = pass**：SA7 可进入动态验证（重点 D1–D5）。
- 无 reject 项；无回流目标（SA1/SA3/SA6 均无整改义务）。两项备忘：
  - **M-1（SA8，非阻塞）**：SA3 偏差 2（accept 门 4/5 之间的微任务让出）建议登记为设计勘误（§3.2 伪代码 + §3.4 零宽窗口声明）——SA3 实现档案 §3.2 已自行呈报，SA4 复核通过。
  - **M-2（随切片 8/9，非本切片义务）**：§8.4 所述 observer/auth-failure 观测事件面按设计归属切片 8 回补。
