# SA3 实现报告 — issue #164 切片 9（apps/yjs-server 组合根 + 真实 WebSocket adapter）

**Date**: 2026-08-30
**实现对象**: `wiki/raw/task_issue-164-on-docs-phase-5-websocket-replication_design.md`（SA1 R1 修订版；SA2 R1 verdict = PASS，十条就绪约束见 `_sa2_review.md` §R1.3，约束 2/A5 为强制）
**实现范围**: ALLOW LIST 全部条款（新建 apps/yjs-server 包 + 根 typecheck 追加 + pnpm-lock 增量）；测试代码零改动（含 `[SA6 owned]` 三件——harness.ts + 2 测试文件，原样保留）；DENY LIST 零触碰。

---

## §1. 交付内容（对设计 §3/§4/§6 逐条落实）

| 设计条款 | 文件 | 落实摘要 |
|---|---|---|
| §6.1 | `apps/yjs-server/package.json` | 新建；deps = ws@^8.21.3 + @nomicore/{ws-replication,namespace-registry,persistence,replication-protocol} + yjs@^13.6.30；devDeps = @types/node/@types/ws/typescript/vitest；`"type":"module"`、`"exports":{".":"./src/index.ts"}`（testing.ts 不存在，声明可解析面）、`"private":true` |
| §6.2 | `apps/yjs-server/tsconfig.json` | 新建；extends 根 base；**include 收窄为 `["src/**/*.ts"]`**——§6.2 降级预案触发（冻结测试严格编译缺陷，见 §4），显式登记，不静默 |
| §3.1/§3.2 | `apps/yjs-server/src/transport.ts` | `WebSocketLike`（method 语法事件重载，FakeSocket 与 @types/ws 双向 bivariance）；`createWebSocketAdapter`（三面：bufferedAmount 实时投影 / ping 无 closed 门 / onPong 订阅退订；text 帧与不明 binary 载体 → close(1002) 零投递；'error' 最先订阅吸收；send 竞态吸收 + ownClosed；close 仅 readyState===OPEN 调 socket.close；onClose 恰一次守卫；onClose 不补发声明）；`toBytes`（Buffer 直通 / ArrayBuffer 视图化 / Buffer[] 碎片拼接 / 不明形态 → undefined）；`assertProductionTransportFaces`（缺任一三面 → 同步 TypeError，message 列全部缺面名——TF3 锚 'bufferedAmount'） |
| §4.1 | `apps/yjs-server/src/index.ts` | 公共面 = SA6 冻结形状逐字段（含 exactOptionalPropertyTypes 细则：可选属性 `\| undefined` 联合；向下传包条件展开，不传显式 undefined）；`PRODUCTION_TIMER` 组合根唯一原生 timer 引入点；`resolvedTimeouts`/`maxFrameBytes` 私有装配面（DEFAULT_* 整值替换合并）；index.ts re-export transport 三件 |
| §4.2 | 同上 | `validateConfig`：role 恒 'hub' / listen 形状与 port 0–65535 整数 / host 非空字符串或省略 / registry.shutdown 函数 / transportFactory/alert 函数形状；instanceId 文法与 verifyToken/authorize 形状由 `createHubReplication`→`validateHubOptions` 单一权威校验（零重复实现） |
| §4.3 | 同上 | http.Server（'request'→404 占位）；构造期相位路由 error 订阅（相位 1 pendingStart reject + started 复位；相位 2 notify——同步 EventEmitter 上下文直调不包装）；wss `'error'` 订阅（D14）；'connection' socket 登记 + once('close') 清除 |
| §4.4 | 同上 | upgrade 路由：closed→503；safePathname 非 /replication→404；extractBearerToken（RFC 7235 大小写不敏感、捕获组非空）缺/非 Bearer→401；**A2 甲案 pre-auth 封顶**（race + timer.setTimeout(helloTimeoutMs)；executor 同步武装、句柄全出口必清；timeout→503 'Auth Timeout'；verifier-threw/畸形裁决→403；迟归不复活零 UHR）；closed 复核门→503；`wss.handleUpgrade` cb 经 `runLoud` 包装；(f) 本地 catch 专职 ws 畸形握手（destroy 零 notify）；外层 .catch = destroy + escalate |
| §4.5 | 同上 | `wireConnection` totality：工厂 throw 本地 catch / 断言 throw 本地 catch（清理先行：transport 收口 → 真 socket 1011 → notify）/ accept rejection 分支 = safeCloseTransport + `runLoud(notify)`；**A5 强制落实**：verifyToken 调用求值包入 `new Promise((resolve) => resolve(this.config.verifyToken(token)))` → 同步 throw 折入 .then rejection → verifier-threw → 403（SA2 实测过的 R1 伪码字面远程崩溃向量已消除）；notify 缺省抛 TypeError 逐字保留（改变的是谁接住它——runLoud/escalate；P14 通道）；零协议分配（faces 拒绝不调 accept） |
| §4.6 | 同上 | close()：closed 先置位 → ① httpServer.close → await hub.close()（GOAWAY 归包）→ socket 清扫 destroy → wss.close() → ④ registry.shutdown()（响亮上抛）→ await httpClosed；closePromise 幂等 same-Promise |
| §6.3 | `apps/yjs-server/AGENTS.md` | 新建（10 行内：角色/命令/边界——ws 依赖边界 + 零 env fallback） |
| §6.4/§7 | `package.json` | typecheck 脚本仅追加 `&& tsc -p apps/yjs-server/tsconfig.json`（零删改） |
| §7 | `pnpm-lock.yaml` | `pnpm install` 自动增量：+ ws@8.21.3 / @types/ws@8.18.1（+2 packages；apps/yjs-server importer 块；yjs/vitest/typescript 复用既有解析，无网络新拉超集） |

**零包修改**：`packages/**` 全部未动（§2 边界裁决 1——红灯用例协议语义全部由既有包承载，亲核；本实现仅注入式消费）。**零测试改动**：SA6 三件原样。**零 env-override/fallback**：生产路径零 NODE_ENV 分支、零 `??`/`||` 隐式兜底（PRODUCTION_TIMER 等显式装配面除外——那是设计指定的能力提供）。

## §2. 验证结果

### §2.1 切片 9 红灯契约（`npx vitest run apps/yjs-server/test`）

| 锚 | 结果 | 证据 |
|---|---|---|
| FS1 幸福路径（101+HELLO_ACK+verifier≥2+authorize 0） | ✅ | verifier 消费 ≥2（预验证 + accept gate 4 二次），authorize 零调 |
| FS2 全链路（bootstrap+reconcile+hub ROOT.n=43） | ✅ | 10s 内 `persistence.peek` 收敛 43；零新协议逻辑——全部由包 + Registry 承载 |
| FS3 缺凭据 → 401 无 WS | ✅ | status 401 + 无 sec-websocket-accept |
| FS4 非法 token → 403 | ✅ | status 403 + ws undefined |
| FS5 身份不符 → ERROR(INSTANCE_IDENTITY_MISMATCH)+1008 | ✅ | waitKind('ERROR') + code 1008 + 零 HELLO_ACK |
| **FS5b 文法违例 → 帧级拒绝** | ❌ | **SA6-owned 冻结缺陷 A**（§4；与实现无关——客户端编码器先行抛错） |
| FS6 close() → 收口+端口拒绝+registry stopped | ✅ | 既有连接 1001 收口（hub.close 包语义）+ 新连接非 101 + `getStatus().state==='stopped'` |
| FS7 未授权 ns → NAMESPACE_UNAUTHORIZED 连接不杀 | ✅ | ERROR 帧 + 300ms 后 wire.closed 仍 undefined + authorize.called 含 ns |
| FS8 hub 真发 WS ping 且回 pong 保持 | ✅ | pings ≥2 + closed undefined（adapter ping/onPong 面 → liveness 自动武装） |
| FS9 不回 pong → pong-timeout 收口 | ✅ | closed.reason==='pong-timeout'，code=1001 |
| TF1 adapter 三面 + 运行时行为 | ✅ | 逐锚（投影/字节等同/text 帧 1002 零投递/ping/onPong 退订/close 语义/onClose 恰一次） |
| TF2 assertProductionTransportFaces 三态 | ✅ | memory（三缺）throw / bufferedOnly throw / 全集 no-throw |
| **TF3 组合根缺面响亮拒绝** | ❌ | **SA6-owned 冻结缺陷 B**（§4；服务器行为亲证正确——真实 ws 客户端观测到 close(1011) + alert + 零 HELLO_ACK，仅冻结客户端观察窗竞态） |

结果：**11/13 绿；2 败均为 SA6-owned 冻结测试/夹具缺陷（缺陷 A/B）**，实现侧无剩余工作。`Type Errors no errors`。

### §2.2 全仓回归（`pnpm test`）

- **Test Files 2 failed | 191 passed (193)**；**Tests 2 failed | 2177 passed (2179)**——失败 2 = 缺陷 A/B（与 §2.1 同）；新增 11 绿 + 既有 2166 全绿，**零回归**（SA6 简报基线：193 文件 / 2166 测试 / 2 failed 仅新增红灯文件——本报告后：同 2 failed，2177 passed）。
- `Type Errors no errors`（vitest typecheck 域不含 apps 测试——SA6 简报既定）。

### §2.3 全仓类型检查（`pnpm typecheck`）

- **0 errors**（12 个 tsc 项目含新 `apps/yjs-server/tsconfig.json`）。生产代码（src/）进静态门禁 ✓。**降级登记**：tsconfig include 收窄为 src/**（冻结测试类型缺陷见 §4 缺陷 C——TS 5.9 泛型 TypedArray/`exactOptionalPropertyTypes`/`noUncheckedIndexedAccess` 下 harness 与 TF 文件报错 9 处；按设计 §6.2 降级预案执行并显式登记，不静默）。

## §3. SA2 十条就绪约束核对

| 约束 | 落实 |
|---|---|
| 1. A1 机制照抄（escalate/runLoud 双原语；cb runLoud 包装；(f) catch 仅 destroy；外层 .catch escalate；accept rejection runLoud(notify)；§4.3 两处同步 EventEmitter 直调 notify） | ✅ 逐条；全文唯一 notify 调用点：httpServer 相位 2 / wss error（直调）、wireConnection (1)/(2)（runLoud 边界内）、accept rejection（显式 runLoud）。P14 通道语义保留 |
| 2. **A5（强制）**：verifyToken 调用求值同步 throw 折入 verifier-threw → 403 | ✅ `new Promise((resolve) => resolve(this.config.verifyToken(token))).then(ok, fold)`——executor 内求值，同步 throw 使 Promise reject → .then 折叠；async throw 同折；wrapper 永不 reject，race 时不吃 unhandledRejection |
| 3. A2 pre-auth 封顶照抄（race + helloTimeoutMs；executor 同步武装、声明在先；全出口 clearTimeout；timeout→503；401/403 映射；停机门 503） | ✅ |
| 4. §4.1 eOPT 细则（`\| undefined` 联合 + 条件展开；resolvedTimeouts/maxFrameBytes 私有装配面） | ✅ |
| 5. §3.2 adapter 精确行为（ping 无 closed 门；close 仅 OPEN；onClose 恰一次；text/不明载体 → 1002；'error' 最先；send 竞态吸收） | ✅ |
| 6. §4.5 顺序与零协议分配（transport 收口 → 真 socket 1011 → notify；拒绝路径不调 accept） | ✅ 同步序列逐行落实 |
| 7. §4.6 停机全序 + 幂等 same-Promise | ✅ |
| 8. §4.3 相位路由（pendingStart 挂/摘、失败复位、wss error 订阅、closed 单向门） | ✅ |
| 9. §6.1/§6.2 接线照抄（降级预案触发 → 本报告 + dispatch log 显式登记） | ✅ 见 §2.3 |
| 10. 零修改红线（packages/**、SA6 三件、vitest.config.ts、docs、根 tsconfig 基座）+ 验收命令 | ✅ DENY LIST 零触碰；vitest.config.ts 保持 SA6 原样（git 状态 = SA6 的 +include 一行）；tsconfig.base.json 未动 |

## §4. SA6-owned 冻结缺陷登记（SA3 无权修改，须总控授权 SA6 修正；未动测试文件）

### 缺陷 A（FS5b，`issue164-slice9-red.test.ts:292`）—— 客户端编码器先抛，帧级拒绝路径不可达

- **现象**：`wire.send(helloMsg('Peer_Alpha!'))` 在 **PeerWire.send → encodeMessage → encodeHello → checkInstanceId**（`packages/replication-protocol/src/payloads.ts:64,156`）抛 `ProtocolError: MALFORMED_FRAME: invalid peerInstanceId`——发生在测试自身发送路径，**帧从未到达 wire**，hub 侧帧级拒绝（[1002,1008]）从被测过。缺失 token 也不会发生（TEST_TOKEN 合法）。
- **根因**：`encodeMessage` 执行与解码同套字段验证（R9 立法：protocol 编码先验），HELLO instanceId 文法 `^[a-z][a-z0-9-]{0,62}$` 在**编码端**即拒绝 'Peer_Alpha!'——与 hub 侧 decode 拒绝是**同源单向**行为，PeerWire 无法构造该异常帧。
- **可证伪性**：任何符合协议与 DENY LIST（replication-protocol 禁改）的实现都无法让该用例走到 wire；SA6 简报 §5「12 用例进入行为断言」的假设不成立。
- **最小修正方向（SA6 裁量）**：改用 `RawWsClient.sendBinary` 直发手工编码帧（绕过 encodeMessage 的编码端校验，payload = 合法 HELLO 字段表 + 非法 instanceId），或 harness 增加 `PeerWire.sendRaw(bytes)` 基建；断言逻辑（零 HELLO_ACK + `[1002,1008]` 收口）零改动。

### 缺陷 B（TF3，`issue164-transport-faces-red.test.ts:188-233`）—— 冻结客户端 close 观察窗竞态

- **现象**：TF3 超时在 `waitUntil('连接收口', () => wire.closed !== undefined)`；**alert 与零 HELLO_ACK 断言均已满足**。
- **根因（实测证据链）**：服务器行为正确——独立复现（真实 ws 客户端，`/tmp/debug-tf3-realws2.mts`）：`client close 1011 transport-faces-missing` ✓、alert 触发 ✓、零 HELLO_ACK ✓。冻结客户端缺失：`wsUpgrade` 返回后立即 `raw.closed === true`（`/tmp/debug-tf3-inspect.mts` 输出）——ws 的 `completeUpgrade` 在构造 cb 同 tick 同步写 101（`websocket-server.js:429`）+ 组合根拒绝 close(1011)（`websocket.js:302`）在 loopback 上合并为**单个 TCP segment**；`RawWsClient` 在 `wsUpgrade` 数据处理器内 `ws.feed(残余)` 阶段已消费 close 帧（`closed=true` + `socket.end()`），随后 `PeerWire` 订阅 onClose 时关闭事件早已发生（RawWsClient 'close' 事件因 `this.closed` 已 true 而跳过 notify 分支——`harness.ts:298-300`），且 RawWsClient **不回放**已发生关闭 → `wire.closed` 恒 undefined。与生产实现无关（真实 ws 客户端可观测）。
- **最小修正方向（SA6 裁量）**：harness 为 RawWsClient 增加「已关闭状态回放」——如 `closed` getter + PeerWire 构造时播种（`if (ws.closed) this.closed = {code:..., reason:...}`，RawWsClient 记录最后 close 帧信息即可），一行级 fixture 改动，断言零改动。

### 缺陷 C（§6.2 降级预案触发，`apps/yjs-server/test/**` 严格编译）—— 冻结测试类型缺陷

- **现象**：`tsc -p apps/yjs-server/tsconfig.json`（include 含 test/**）报 9 处：harness.ts(242:9 缺参；309/313:17 TS2322 泛型 TypedArray ArrayBufferLike/ArrayBuffer；327/493:18 TS2532 possibly undefined)、issue164-transport-faces-red.test.ts(62:26 TS2379 exactOptionalPropertyTypes；136:12 TS2532；140/143:21 TS2722/TS18048 / possibly undefined)。
- **处置**：按设计 §6.2 降级预案 → include 收窄 `["src/**/*.ts"]`（生产代码保留静态门禁，0 errors），**显式登记不静默**。冻结测试仍由 vitest 运行期执行（esbuild 转译，无类型检查依赖）——不阻塞红灯契约验证；类型缺陷修复归 SA6（若要求测试文件严格编译通过）。

## §5. 生产行为与冻结契约对账（实现自检）

- **升级前验证**：401（无/非 Bearer）/403（verifier 拒绝/抛错/畸形裁决，含 A5 同步 throw）/503（超时/停机）→ 均不建 WS；状态行原始写出（无 Sec-WebSocket-Accept）。
- **纵深防御**：101 后原始 token 透传 `hub.accept(transport, {token})`——包内 gate 4 二次消费（FS1 锚 ≥2）。
- **装配期三面断言**：缺面 = 配置错误 → 结构化告警（缺省 alert = TypeError 经 runLoud → uncaughtException，P14 通道）→ transport/真 socket 双收口 → 零协议分配。
- **活性**：adapter ping/onPong 面在场 → 包 startLiveness 自动武装（FS8/FS9）。
- **停机**：§21 顺序编排（GOAWAY 归包；registry.shutdown 第 4 步；httpClosed 权威确认；清扫兜底 D9）。
- **一次性 loud fail-fast**：错误路径全部命中 notify/escalate 单通道；无静默吞（D1/D2 外部网络故障吸收除外——正当降级）。

## §6. 验收命令汇总（全部真实执行）

| 命令 | 结果 |
|---|---|
| `pnpm install` | ✅ Done（+2 packages：ws@8.21.3/@types/ws@8.18.1） |
| `npx vitest run apps/yjs-server/test` | ✅ 11 passed / 2 failed（缺陷 A/B）——实现侧 11/13 |
| `pnpm test` | ✅ 191 files passed / 2 failed（缺陷 A/B）；2177 tests passed（零回归）；Type Errors no errors |
| `pnpm typecheck` | ✅ 0 errors（12 项目；apps 生产 src 入列，test/** 按 §4 缺陷 C 降级收窄并登记） |
