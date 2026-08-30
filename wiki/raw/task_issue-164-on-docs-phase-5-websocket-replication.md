# Issue #164: On Docs Phase 5 WebSocket Replication

## Task identity
- Repository: welltop-jim-wang/nomicore
- Issue: #164
- Branch: fix/issue-164-on-docs-phase-5-websocket-replication
- Run ID: issue-164-1788076071-447205
- Round: 1

## Source of truth
The full requirement must be read from GitHub issue #164 using:
`gh issue view 164 --repo welltop-jim-wang/nomicore`

This task brief was initialized by the controller after the GitHub CLI query encountered an upstream GraphQL Projects (classic) deprecation error. Each specialist must independently retrieve the issue body with a compatible read-only GitHub query before performing its assigned stage.

## Task type
Feature development: documentation Phase 5 WebSocket replication.

---

# SA6 红灯契约报告（Round 1）— issue #164 切片 9：apps/yjs-server composition root + 真实 WebSocket adapter

- 阶段：Phase 1 红灯锚定（功能开发 A.2：幸福路径 + 边界 + 异常输入 + 长链路）
- 需求来源：`gh issue view 164 --repo welltop-jim-wang/nomicore --json body`（兼容查询，无 Projects classic 错误）
- 产出：
  - `apps/yjs-server/test/harness.ts`（测试自有：最小 RFC 6455 客户端 + StubPersistence + Registry fixture + 帧观测器）
  - `apps/yjs-server/test/issue164-slice9-red.test.ts`（9 用例：FS1–FS9）
  - `apps/yjs-server/test/issue164-transport-faces-red.test.ts`（3 用例：TF1–TF3）
- 测试基建改动：`vitest.config.ts` include 增加 `apps/*/test/**/*.test.ts`（apps 是 pnpm-workspace 成员；**只加 include，零删改**）
- 红灯证据：`VITEST_EXIT=1 / Test Files 2 failed`（真实红灯，见 §5；两文件均因 `apps/yjs-server` 模块不存在而收集期失败）

## 1. 需求拆解（issue #164 → 可执行验收锚）

| # | 需求 | 权威出处 | 验收锚 |
|---|---|---|---|
| R1 | HTTP Upgrade bearer-token 验证 → `HubReplication.accept(transport, …)` 接线 | issue Scope + protocol §2 | FS1/FS3/FS4/FS5：合法 → 101+HELLO_ACK；缺 → 401；非法 → 403；身份不符 → INSTANCE_IDENTITY_MISMATCH+1008 |
| R2 | 真实 WebSocket adapter 实现 `DuplexTransport` | issue Scope + protocol §17 | TF1：send/onMessage/onClose/close/bufferedAmount/ping/onPong 全部运行时行为 |
| R3 | Adapter **必须**暴露 `bufferedAmount`（G3.4 背压前提） | issue 强制要求（#161 A11） | TF1（投影 socket 未冲刷字节）+ TF2/TF3（缺面 loud 拒绝） |
| R4 | Adapter **必须**暴露 `ping`/`onPong`（G5.1 活性前提） | issue 强制要求（#161 A11） | TF1 + FS8/FS9（WS ping 到达、pong-timeout 收口） |
| R5 | 宿主装配期一次性 loud 断言（缺面 → TypeError/结构化告警，防静默降级） | issue 建议 + protocol §17“组合根在装配期对缺面做响亮断言” | TF2（assertProductionTransportFaces 同步 TypeError）+ TF3（组合根对缺面 transport 响亮拒绝：结构化告警 + 零 HELLO_ACK） |
| R6 | instanceId/namespace 权限接线 | issue Scope + protocol §19/§13.2 | FS7：未授权 namespace → NAMESPACE_UNAUTHORIZED（连接不杀）；FS5b：instanceId 文法违例 → 帧级拒绝 |
| R7 | 停机编排（§21 顺序：replication 收口 → Registry shutdown → …） | phase §9 交付现状“切片 9 只负责按 §21 顺序编排停机”+ protocol §21 | FS6：close() → 既有连接收口 + 端口停止接纳 + registry.getStatus().state === 'stopped' |
| R8 | 全链路（Upgrade → HELLO → OPEN/bootstrap → reconcile → 远端 diff 应用） | protocol §2/§8/§9/§10 + A.2 长链路要求 | FS2：101 → HELLO_ACK → OPEN_OK(mode=bootstrap) → BOOTSTRAP_SNAPSHOT → BOOTSTRAP_ACK → round 1 STEP1/STEP2 → hub 持久化 doc ROOT.n=43（后向闭环） |

## 2. SA6 冻结的切片 9 公共面（SA3 必须实现到该形状）

```ts
// apps/yjs-server/src/index.ts（单公共入口）
export interface YjsHubServerConfig {
  readonly role: 'hub';                                  // 显式角色（phase §9 注记）
  readonly instanceId: string;                           // ^[a-z][a-z0-9-]{0,62}$（协议 §6.1）
  readonly listen: Readonly<{ readonly host?: string; readonly port: number }>; // port 0 = OS 随机
  readonly verifyToken: PeerTokenVerifier;               // 与 HubReplicationOptions.verifyToken 同形
  readonly authorize: NamespaceAuthorizer;               // 必填（fail-closed，零静默策略）
  readonly registry: NamespaceRegistry;                  // 宿主注入（role 在构造 Registry 时显式传入）
  readonly limits?: Readonly<Partial<ReplicationLimits>>;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>>;
  readonly transportFactory?: (socket: WebSocketLike) => DuplexTransport; // 缺省 = createWebSocketAdapter
  readonly alert?: (message: string) => void;            // 结构化告警出口；缺省 = 抛 TypeError
}
export interface YjsHubServer {
  start(): Promise<Readonly<{ readonly host: string; readonly port: number }>>;
  close(): Promise<void>;                                // §21 停机编排（含 Registry.shutdown）
}
export function createYjsHubServer(config: YjsHubServerConfig): YjsHubServer;

// apps/yjs-server/src/transport.ts（经 index.ts 再导出）
export interface WebSocketLike { … }                     // 冻结的 ws.Socket 最小形状（bufferedAmount/readyState/send/close/ping/on/off + message/close/pong/error 事件）
export function createWebSocketAdapter(socket: WebSocketLike): DuplexTransport;
export function assertProductionTransportFaces(transport: DuplexTransport): void; // 缺任一三面 → 同步 TypeError
```

**接线语义（冻结，防止静默降级）**：
- Upgrade 路径 = `GET /replication`；token 取自 `Authorization: Bearer <token>` 头。
- **升级前验证**（protocol §2“Bearer token 在 HTTP Upgrade 前验证，失败返回 HTTP 401/403，不建立 WebSocket”）：无 token/非 Bearer → `401`；verifier 拒绝 → `403`；两者均不得返回 101。
- 升级通过后把**原始 token** 传入 `HubReplication.accept(transport, { token })`（ws-replication 包内 verifyToken 再验——纵深防御；同一 verifier 消费 ≥2 次）。
- 每个经 transportFactory 产出的 transport，在交给 accept 前执行 `assertProductionTransportFaces`——缺面 = 配置错误：结构化告警（`alert(message)`，message 含缺失面名如 `bufferedAmount`）+ 关闭该连接 + 零协议分配；绝不静默降级为无背压/无活性会话。
- `close()`：停止接纳 → 等既有连接收口（ws-replication 包负责 GOAWAY/drain，#171 语义归包）→ `registry.shutdown()` 完成后 resolve。

## 3. 测试文件与命令

| 项 | 值 |
|---|---|
| 红灯测试 | `apps/yjs-server/test/issue164-slice9-red.test.ts`（FS1–FS9，9 用例） |
| 红灯测试 | `apps/yjs-server/test/issue164-transport-faces-red.test.ts`（TF1–TF3，3 用例） |
| 运行命令 | `npx vitest run apps/yjs-server/test`（子集）/ `pnpm test`（全量） |
| 既有回归 | 全量 `pnpm test`（`--typecheck` 开启；apps 测试不参与 typecheck——只新增 `apps/*/test/**/*.test.ts` 到 include） |

## 4. SA3 交付要求（测试运行前置，缺一红灯即非实现问题而是装配缺失）

1. 创建 `apps/yjs-server/package.json`（workspace 成员）：deps = `ws` + `@nomicore/{ws-replication,namespace-registry,persistence,replication-protocol}` + `yjs`（测试 harness 直接依赖）；devDeps = `vitest`/`typescript`；`private: true`、`type: module`。
2. `pnpm install`（生成 apps/yjs-server/node_modules 符号链接——当前 apps 目录零包，测试导入 `yjs`/`@nomicore/*` 无法解析；这是红灯的一个来源）。
3. 实现 `src/transport.ts`（adapter 三面 + 装配断言）+ `src/index.ts`（组合根）。
4. 建议：为 apps/yjs-server 增加 tsconfig + root `typecheck` 脚本条目（非我方交付，SA3/SA4 自行决定；不阻塞 vitest 运行）。

## 5. 红灯验证证据（真实运行，后台独立进程）

- 命令：`setsid nohup bash -c 'npx vitest run apps/yjs-server/test; echo $? > /tmp/sa6-red-exit'`（2016-08-30 执行，两次：`/tmp/sa6-red.log` + 终稿后复跑 `/tmp/sa6-red2.log`）
- 结果：**exit code 1；Test Files 2 failed（2/2）；Tests no tests（收集期失败）**：
  - `issue164-slice9-red.test.ts`：`Error: Cannot find package 'yjs' … (Failed to load url yjs)` —— apps 无包（无 node_modules 符号链接）证明 `apps/yjs-server` 尚未存在；
  - `issue164-transport-faces-red.test.ts`：`Error: Cannot find module '../src/index.js' … Failed to load url ../src/index.js` —— **切片 9 组合根未交付的直接证据**。
- 全量回归（`pnpm test`，`/tmp/sa6-full-test.log`）：**Test Files 2 failed | 191 passed（193）；Tests 2166 passed；Type Errors no errors** —— 仅新增两红灯文件失败，既有 193 文件/2166 测试零回归；`vitest.config.ts` include 追加对既有测试无影响。
- 结论：红灯真实（功能 100% 未实现），非伪红；无「测试写绿但功能缺失」风险。实现后上述两处解析失败自动消失，12 用例进入行为断言。

## 6. 测试纪律

- 零源码 grep：全部断言锚在 HTTP 状态行 / WS 帧（codec 解码）/ WS close 码 / Y.Doc 内容 / Registry 生命周期 / 回调调用。
- 最小 Mock：被测对象（组合根 + adapter）零 mock；仅外部库 seam（ws.Socket 形状替身、内存双端 transport）与测试自有 RFC 6455 客户端作为 fixture。
- 端口：`listen.port = 0`（OS 随机端口）——并行安全，无固定端口占用。
- 零 real sleep：所有等待为 10ms 有界轮询（`waitUntil`）。
- 未修改任何 `src/` 生产代码；唯一非测试文件改动 = `vitest.config.ts` include（+1 行模式），用于让 `pnpm test` 覆盖应用测试。

## 7. 后续轮次标记

- 本红灯契约是 issue #164 的实现前锚；SA3 实现后由 SA4 静态验收 + SA7 动态验证扩展（压力/时序/互通属 SA7 职责）。
- 若后续发现本契约断言自身缺陷（SA4/SA7 指出），按最小范围修正本文件或 harness fixture。

