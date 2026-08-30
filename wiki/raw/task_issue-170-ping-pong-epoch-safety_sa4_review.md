# SA4 静态验尸报告 — issue #170 ping/pong epoch safety（SA3 commit `ea1fdfe`）

**Date**: 2026-08-30
**Verdict**: **pass**
**被审对象**: SA3 commit `ea1fdfe`（基线 `ef19bae`，4 个 src 文件 +125/−27、3 个 test 文件）
**参照物**: SA1 design `task_issue-170-ping-pong-epoch-safety_design.md`（§11 ALLOW/DENY、§12 协议假设、§13 连锁审计）、SA2 MINOR #1–#4、SA5 `20260830-bug-ping-pong-epoch-safety.md`（R1–R4）、SA6 红灯契约（任务简报 §SA6）
**审查方式**: 全量 diff 逐行 + 4 个 src 文件现行全文 + 红灯测试 562 行全文亲读；协议文档锚点独立重验；全仓 grep 连锁审计独立重跑；验收命令全量复跑；**基线还原红灯取证**（src 还原 `ef19bae` 后运行已提交红灯文件 → 6 failed，再还原修复态）。

---

## 一、门禁项结论（skill 立法条款逐项）

### 1.1 文件清单 Scope Creep Guard — ✅ 通过

- 基线选择：design 明示基线 `ef19bae`（worktree `HEAD~1`）；`mabf.basebranch` 配置值 `docs/namespace-registry` 含上游整条 phase-5 历史文件，不适用本任务比对，采用 design 基线。
- `git diff --name-only ef19bae HEAD` 项目文件恰为 ALLOW LIST 7 项：`src/liveness.ts`、`src/types.ts`、`src/hub-connection.ts`、`src/peer-connection.ts`、`test/ws-replication-issue170-r1-r4-red.test.ts`、`test/ws-replication-sa7-hardening-dynamic.test.ts`、`test/ws-replication-sa7-round2-dynamic.test.ts`（+ design 文档自身）。
- diff 中 wiki 附加文件（任务简报/SA5 报告/dispatch/sa2_review）全部命中白名单 pattern（`^wiki/raw/task_`、`^wiki/raw/[0-9]{8}-bug-`）→ 非越界。
- BLACKLIST（package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）零命中。
- DENY LIST 逐项核验零触碰：`docs/protocols/instance-replication-v1.md`、`packages/replication-protocol/**`、`src/index.ts`、`src/defaults.ts`/`validate.ts`、`peer-namespace.ts`/`hub-namespace.ts`/`backpressure.ts`/`frame-io.ts`、`ws-replication-review-revisions-r1-r7-red.test.ts`、其余测试与其余包——均不在 diff。`grep -rn "PONG_TIMEOUT" packages/ docs/`（排除 wiki/test）零命中：未注册错误码确未发明、未登记。

### 1.3 E2E spec 触发性 — N/A（diff 无 `*.spec.ts`）

### 1.4 vitest 触发性自检 — ✅ 通过

- 本任务涉及 `*.test.ts`：`packages/ws-replication/test/` 下 3 个文件。
- 根 `vitest.config.ts`：`include: ['packages/*/test/**/*.test.ts', ...]` → 三文件全部落入收集范围；`.github/workflows/ci.yml` `test` job（Node 20/24 矩阵）`Test: pnpm test` = `vitest run --typecheck`，`Typecheck: pnpm typecheck` 串含 `tsc -p packages/ws-replication/tsconfig.json`（tsconfig include `test/**/*.ts`）。
- 即本任务全部测试经 CI `test` job 主步骤触发（非 `--filter` 型配置，glob 覆盖成立）。SA7 仍需按职责从 `gh run view --log` 摘录 vitest 触发证据。

### 1.5 协议假设审查（design §12 A1–A6）— ✅ 通过

design §12 章节存在，A1–A6 均给出可定位依据，无「应该/通常/预计」类无据推断。SA4 独立重验：

| # | 假设 | SA4 复核证据 |
|---|---|---|
| A1/A6 | pong 回显 ping 载荷（RFC 6455 §5.5/§5.5.2）、控制帧 ≤125 字节 | 与 RFC 原文一致；8 字节凭据合法；仓内无生产 adapter（grep `onPong`/`DuplexTransport` 全仓仅 ws-replication 及其测试）→ 契约注释 + dormant 降级兜底成立 |
| A3 | hub pong 超时 = close 1001 + 零 ERROR 帧 + 对端 backoff | **亲验协议文档**：§2「活性检测只使用 WebSocket ping/pong。协议不定义业务 PING/PONG frame」原文在；§13.1 注册表恰 17 码、无 liveness 码；§14「1001：GOAWAY、计划重启或服务停止；1002：bad framing…协议错误」；§18 L524「pong 超时按临时失败处理：关闭传输（close code 1001）并经 backoff 重连」逐字在。`payloads.ts:310-315` `encodeError` 对未注册码 `throwMalformed` 在；`validate.ts:164-168` `pongTimeoutMs < pingIntervalMs` TypeError 在 |
| A4 | 已关 socket 上 `ping()` 抛 `WebSocket is not open` | 与 `ws` 库语义一致；红灯 fixture `throwPingWhenClosed` 同构建模；P4 以 `closedTransportPingErrors()===0`（结构性不发生）收口 |
| A5 | 虚拟时钟按到期序执行、微任务投递 | 本轮 161/161 全绿即运行时证据（见 §验收命令） |

### 1.6 契约改动连锁审查 — ✅ 通过

- 唯一公共面变化：`DuplexTransport.onPong` 监听器参数 `() => void` → `(payload?: Uint8Array) => void`（可选成员、可选参数，method bivariance 向后兼容）。无 return→throw、无签名收窄、无同步变 async。
- 注册方（listener 传入点）全仓唯一 = `liveness.ts:69`，经 `hub-connection.ts:260` / `peer-connection.ts:308` 传入（grep 独立重跑确认，无其他 caller）。监听器体为纯比较 + clearTimeout，无 throw 面；`stopped`/`pongHandle`/`outstanding` 三重早退。
- 实现方（transport 侧）：red fixture（新契约）、sa7-hardening/round2（已忠实化）、review-revisions（旧签名、`firePong` 亲验零调用点 :626/:715 仅声明+定义）——`tsc -p packages/ws-replication/tsconfig.json` 绿证明旧签名实现仍可赋值。
- `LivenessDeps.onPongTimeout` 语义扩展（新增 ping 抛错触发源 + 回调前自停）：唯二 caller 均幂等——hub `onLivenessLost` `closedFlag` 守卫；peer 闭包 `stopping` + transport 身份/epoch 双凭据 + funnel 状态守卫三层。
- `onTemporaryFailure` 行为扩展的 5 个 caller（dialNow catch / hello 超时 / onClose / failConnectionBackpressure / pong 超时闭包）逐个核对：新三件套幂等叠加（E11），1011/1001 关闭码不被 funnel 覆盖（funnel 不关传输，I5）。

### 1.7 源码 GREP 断言禁令 — ✅ 通过

红灯文件与两个 fixture：零 `readFileSync`、零对源码字符串的 `toMatch/toContain`；全部断言为运行时可观测行为（wire 帧解码/close 码/监听计数/ping 计数/FSM 状态/副本收敛值）。

---

## 二、专项审查结论（重点项）

### 协议语义（R1）— ✅ 与协议权威语义完全对齐

`hub-connection.ts:380-395` `onLivenessLost`：与 `connectionFatal` 同拓扑（sender 停 → closedFlag/state → 通道 quiesce → `close(1001,'pong-timeout')` → `cleanupAll` 停活性+退订+dropConnection），差异恰为 design §5 的两处：零 ERROR 帧尝试（注册表无码可发，`connectionFatal` 的 17 个注册码路径不变）、1001/`pong-timeout`（非 1002/`protocol-error`）。`grep PONG_TIMEOUT` src 零残留。对端效果：peer `onClose(1001)` → 非 1002/1008 → `onTemporaryFailure` → backoff 重拨（H1 全链路断言绿）。

### epoch/teardown 顺序（R3/R4）— ✅ 同步栈顺序与 issue 原文一致

- peer pong 超时闭包（`peer-connection.ts:309-319`）：`stopping` 守卫 → **双凭据**（`this.transport !== transport || this.connectionEpochValue !== epoch` → 静默返回）→ `stopLivenessNow()` → `unsubscribeTransport()` → `close(1001,'pong-timeout')` → `onTemporaryFailure()`（其顶部 `epoch += 1` 在 `setState('backoff')` 与 backoff timer 排程**之前**）。满足「epoch invalidation before scheduling backoff」+「同步栈内关旧传输、解绑旧监听/liveness」。
- liveness 自停（I2）：pong 超时/ping 抛错 → 回调前清双 timer + 退订 pong 监听（`loseLiveness`→`stopInternal`）——僵尸循环结构性消除（P4 `peerPingsAfterClose()===0`、`closedTransportPingErrors()===0` 绿）。
- `enterBlocked`（:603-628）与 `onTemporaryFailure`（:630-655）顶部同三件套；`requestRebuild`（:664-668）同加固。全部临时失败/blocked/重建路径统一获得「停活性 + 退订 + 代际作废」纪律。
- hub 无 epoch（I6）：独立复核成立——每 `HubConnectionImpl` 构造期独占 transport；liveness 仅在 `onHello` 的 handshaking 态武装一次（二次 HELLO 走 fatal）；`cleanupAll:405-414` 同步前缀停活性+退订；`closedFlag` 吸收重入。

### 版本 bump（epoch 递增）规则 — ✅ 纪律一致

递增点全表：`dialNow:193`（既有）、`onTemporaryFailure:639`、`enterBlocked:611`、`requestRebuild:668`（新增三处），pong 超时路径经 funnel 单点递增（避免双计数）。规则统一为：**每次连接终结/替换编排启动时、在任何 backoff 排程或状态迁移之前递增**；武装时捕获（:302）、触发时校验（:312）。消费面独立 grep：`peer-namespace.ts` 全部 9 处消费均为 `!==` 不等式判迟到（:191/:224/:294/:321/:386/:405/:785/:822 + :58 声明），无「等于特定值」假设 → `dialNow` 随后再 +1 的双递增无害。epoch 前移到失败时刻只使「迟到」判定更早，语义更准。

### pong payload seam（R2）— ✅ 签名拓宽 + 凭据关联完整落地

`types.ts:60-66` 与 design §3 逐字一致（含「无法透传载荷的实现不得暴露 onPong」契约注释）；`liveness.ts` 8 字节大端单调计数凭据 + `credentialMatches` 三重判否（undefined 载荷/长度不等/字节不等），迟到/重复/未请求 pong 一律忽略；零应用级 PING/PONG 帧（P1–P3 绿）。I1 的结构性依托（`pongTimeoutMs < pingIntervalMs` 配置期 TypeError）亲验在 `validate.ts:164-168`，hub/peer 两处配置均经同一校验。

### fixture 断言未弱化 — ✅ 双重证据

1. **静态**：红灯文件 6 例断言与任务简报 §SA6 契约逐条吻合（H1：1001/零 PONG_TIMEOUT 帧/backoff/dialCount===2/hub.connections===1/收敛 99；P1–P3：迟到/重复/未请求注入 → t+10s 必须 backoff+close(1001)；P4：三监听 0/backoff 窗 [40s,90s) 零 ping 已关传输/零 ping 错误/重连 dialCount===2/旧代 pong 零扰动/收敛 77；P5：三监听 0/零 ping/零二次 close/blocked 不重拨）。两个既有 fixture 的 diff 严格限定 wire 机制行（`ping(data?)` 记录、监听器类型、`firePong`/`autoPong` 回显投递），**零 `expect(` 行变更**（SA2 MINOR #1 裁决落实）。
2. **动态（基线还原取证）**：`git checkout ef19bae -- packages/ws-replication/src` 后运行已提交红灯文件 → **`Tests 6 failed (6)`**，6 条失败消息与简报红灯证据逐字一致（`expected 1002 to be 1001`、`expected 'ready' to be 'backoff'` ×3、`expected 1 to be +0` ×2）→ 断言真实钉住缺陷、非空洞、未被 SA3 弱化以适配实现；还原修复态后同文件 6 passed。取证后 src 已完整恢复（`git status` 仅余派发前已存在的 dispatch 文件改动）。

---

## 三、审核结论（skill 输出模板）

1. **设计一致性**：✅ 一致——4 个 src 文件实现与 design §3/§4/§5/§6.1–§6.5 逐段对应（含注释逐字）；§6.4 requestRebuild 加固与 §8.1 两 fixture 忠实化均按 §14 ④ 执行；无偏离项。
2. **读写路径一致性**：✅ 一致——凭据单源（会话内单调计数，ping 时编码、pong 时比对同一 buffer）；不涉 YDoc/store 数据源分叉。
3. **静默失败**：✅ 无新增——全部失败路径 wire 可见（close 码）+ FSM 迁移 + ns 投影三层可观测；旧代惰性早退（stopping/双凭据/状态守卫）是设计要求的静默，非缺陷。liveness catch 吞 ping 异常细节 = SA2 MINOR #2 登记项（本包零 console/logger/observer seam，grep 亲验；将来引入 seam 时补 `onPingError` 钩子）。
4. **降级方案**：✅ 安全——缺 ping/onPong 面 → dormant 是 types.ts 可选成员的既有合法能力降级（先例 D4 长绿）；strict 匹配拒绝无载荷 pong 是把 fixture 非忠实建模掩盖的真语义纠正回来，非降级掩盖。
5. **极端攻击**：✅ 未发现可静态确认的漏洞——E1–E13 矩阵独立重推成立；额外攻击：凭据计数精度（2^53 @30s 间隔 ≈ 10¹³ 年，不可达）、`offPong` TDZ（stopInternal 仅可于 startLiveness 返回后触达；注册期同步回调被 `pongHandle===undefined` 早退拦住）、pong 超时×远端 close 竞速（先到者走 funnel、后到者被退订/状态守卫吸收）、双 funnel 叠加（全幂等）、epoch 双递增（消费面全 `!==`）。
6. **错误处理**：✅ 完整——每条分支落 close 码/FSM/ns 投影或设计内惰性；`onLivenessLost` 重入被 `closedFlag` 吸收。
7. **架构评估**：✅ 可行——修复顺着协议权威语义与既有 funnel 拓扑，无绕过/临时补丁/FIXME；无退回 SA1 信号。
8. **过度设计**：✅ 精简——4 文件 +125/−27 对四个同源根因成比例；8 字节单调计数优于随机 nonce（不引 random 依赖）；§6.4 三行加固有 R3 同构论证支撑。

## 验收命令复跑证据（SA4 独立执行，独立进程）

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run packages/ws-replication` | **Test Files 23 passed (23)，Tests 161 passed (161)，Type Errors no errors**（155 既有 + 6 红转绿，与 §8 预期一致） |
| `pnpm run typecheck` | exit 0（含 `tsc -p packages/ws-replication/tsconfig.json`） |
| `pnpm exec vitest run packages/ws-replication --typecheck` | 23 files / 161 tests passed + typecheck no errors |
| `git diff --check` | exit 0 |
| （基线还原红灯取证）`git checkout ef19bae -- src` + 运行红灯文件 | `Tests 6 failed (6)`，消息与简报红灯证据逐字一致；随后 src 还原、`git status` 干净 |

## 动态审核重点（交 SA7）

1. **CI 触发证据**：从 PR CI `gh run view --log` 摘录 `pnpm test` job 中 `ws-replication-issue170-r1-r4-red.test.ts`（6 tests）与两个 fixture 文件的收集/通过行——补 §1.4 静态结论的动态面。
2. **真实 `ws` adapter 语义（A4/A6）**：生产 adapter 落地时验证 pong 事件透传回显载荷、closed socket 上 `ping()` 抛错被 liveness catch 吸收（切片 9 前以契约注释约束，仓内无此面）。
3. **SA2 MINOR #4（hub 异步 drop）**：H1/P4 的 `hub.connections.length===1` 依赖 `cleanupAll` 的 registry 异步收口在微任务排水内完成（不推进 hub 时钟）——本轮本地绿；CI runner 上关注是否 flaky。
4. **SA2 MINOR #3（GOAWAY drain × 长 backoff）**：既有语义观察探针（drain 5s × backoff 50s：FSM 恒 backoff、零二次 close、重连后 ns failed→targeted 重开收敛）——非本任务缺陷面。
5. **既有观察项**：`enterBlocked`/`onTemporaryFailure` 均不清 `goawayDrainHandle`（本 commit 未改该面，维持既有语义）；hello 超时孤儿传输窗口（D5 登记项）按 design I5 明示不动。

## 结论

**pass**。SA3 实现与 SA1 设计逐段一致、与协议文档权威语义（§2 L42 / §13.1 / §14 / §18 L524）完全对齐；epoch/teardown 同步收口栈与双凭据校验按 issue 原文顺序落地；pong payload seam 拓宽最小且向后兼容；6 条红灯契约经基线还原取证证明真实且未被弱化，161/161 全绿、typecheck/vitest --typecheck/git diff --check 全过。SA2 的 4 个 MINOR 锚点全部核销或登记给 SA7。SA7 可进入动态验证。
