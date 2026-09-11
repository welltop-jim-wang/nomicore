# SA4 实现红队审查 — issue #270：Server 集成验收（REST 与 WebSocket 共享 Registry + 有序停止）

> 阶段：implementation-review（iteration 0 —— 首个实现轮静态审查）。Dispatch：`sa-f7e83a99-0eda-4432-bf94-85c7b708a4d4`（mabf-sa4）。
> 技能：`exploit-vulnerability` 已加载并按本报告执行（只读源码/diff/测试/日志；未修改实现、未运行测试、未启动服务）。
> 被审对象：SA3 实现（worktree `nomicore-fix-issue-270`，branch `mabf/issue-270`，基线 HEAD `0b06050`，
> 未提交工作树改动）。Issue comments 派发前 REST 快照 = `[]`——无 Owner 追加要求。

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（Issue #270 body；comments `[]`） | `wiki/raw/task_issue-270.md` | 已读；AC1–AC4 为验收口径 |
| SA1 设计（iteration 1 修订轮，SA2 `approve`） | `wiki/raw/task_issue-270_design.md`（512 行全文） | 已读；§7-D1–D8、§8 装配序/停机状态机、§11 ALLOW/DENY、§12 测试映射、§13 FR-3 登记为审查基准 |
| SA2 设计评审 | `wiki/raw/task_issue-270_sa2_review.md` | 已读；F1–F4 落实 + O1/O7/O8 实现注记逐条核对 |
| SA3 实现报告 | `wiki/raw/task_issue-270_sa3_impl.md` | 已读；其「实现要点对照」逐项与源码比对 |
| SA6 验收契约（冻结） | `wiki/raw/task_issue-270_sa6_contract.md` | 已读；§12.2/§12.3/§13.4 冻结断言与哈希 |
| SA8 门禁 + 设计后复审 | `task_issue-270_sa8_gate.md`、`task_issue-270_sa8_recheck.md` | 已读；A1/A2/A3、R1/R2、5 条重开条件 |
| SA3 验证证据 | `task_issue-270_sa3_{contract,app-suite,typecheck,root-typecheck}.log` | 已读（contract：3 文件 11/11 绿、Type Errors none；app-suite：33 文件/173 例绿 428s、exit 0；两个 typecheck exit 0） |
| 实际 diff（只读 git） | `git diff` + `git status --short` | 5 改 2 增（生产/测试/文档）+ wiki 产物；逐行审查（下文） |
| 源码锚点 | `apps/yjs-server/src/{app,rest-hosting}.ts`、`src/transport/ws-server.ts`、`packages/namespace-api/src/{rest,create-namespace}.ts`、`src/main.ts`、`src/lifecycle.ts`、`vitest.config.ts`、`scripts/ci-test-shard.mjs`、`.github/workflows/ci.yml`、`apps/yjs-server/tsconfig.json` | 逐锚点核对 |
| 冻结契约三文件 | `apps/yjs-server/test/issue270-*.ts` | **sha256 本轮复算**：`5cea9d4e…`/`06e0bfe3…`/`2060e130…` 与 SA6 §13.4 逐字节一致（零改动） |

## 2. Verdict

**`approve`** —— 实现忠实落实批准设计（SA1 iteration 1）与冻结 SA6 契约：共享 Registry 身份
（构造注入单赋值 + `NomicoreApp.registry` 观测面）、raw-path 双 route family 分流（默认路径逐字节
保持）、有序停止（intake 双门 → 包级 WS 停机 → 已接纳 REST 工作有界排空 → registry → persistence）、
observer 显式注入、rejection 诚实 500 占位全部按设计落位；文件范围与 ALLOW/DENY 逐路径吻合，
冻结契约零字节改动且红灯 4/4 转绿（日志证据）；无 BLOCKER/MAJOR finding。三条 MINOR 观察与
若干动态验证项列入 §10–§12，均不阻断。

`requiresConflictRecheck: false` —— 实现未偏离设计的任何决策面（SA8 recheck 5 条重开条件逐条
零触发：REST drain 在 `registry.shutdown()` 之前；Registry 仅经 app face 暴露；H1 零配置键；
`packages/*` 零触达；503/500 占位未固化为终态契约——AGENTS.md 措辞显式反向声明）。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue AC1：REST 与 WS Module 共享同一 `NamespaceRegistry` 引用（不经 Cordis Context、不运行时替换） | `app.ts:260` `this.registry = requireNomicoreRegistry(ctx)` 为**全文件唯一赋值**（grep 证实）；`bootHub` `app.ts:316-323` `const registry = this.registry` → `createRestRouter({role, registry, …})` 构造一次冻结；`rest.ts` 零 Context 访问、构造后 `Object.freeze` 配置；`NomicoreApp.registry` getter（`publicFace()` 委托私有字段，`app.ts:193-196`、接口 `app.ts:127`）就绪后终生同一实例、`stop()` 后不清空 | ✓ 落实（T1-A `expect(appRegistry(hub.app)).toBe(reg)` 身份断言 + T1-B 同 Runtime lease 写入→WS bootstrap `n===99` 行为证明，contract log 双绿） |
| Issue AC2：raw path 正确分流 REST 与 WS route family | `ws-server.ts:171-176` 存在 `handleRequest` 时普通请求完全委托；缺省 `/healthz`+404 分支（177-183）逐字节保持；upgrade 段（188-242）零触碰；`rest-hosting.ts:97-128` REST 优先 → `matched:false` 回落 `req.method === 'GET' && req.url === '/healthz'` 精确等值（含 query）→ 404 | ✓ 落实（T2 canonical 201/GET 405+`Allow: POST`/非 canonical 404/`/replication` 普通 404/upgrade 101/REST-path upgrade 404 + N3 恒绿锚全绿） |
| Issue AC3：停 intake → 等已接纳工作 → 释放 Lease/Session → shutdown Registry 与 Persistence | `app.ts:461-466` `stopRequested=true` 同步置位（门 A）；`performStop` `app.ts:468-531`：`hubListener?.close()`（门 B）→ `await hubService.stop()`（包内 §21 ②③ 一次完成）→ `await listenerClosed` → `peerService?.stop()` → **`await this.restHost?.drain(REST_DRAIN_BUDGET_MS)`**（app.ts:488，插位 = 包级 WS 停机之后、`replication-drained`/`registry.shutdown()` 之前）→ `registry.shutdown()` → diagnostics close → file 排空窗 → `persistenceFiber.dispose()` → `ctx.fiber.dispose()` | ✓ 落实（T3 全链：drain 期已接纳 create 201、停后新请求非 201 且 ≥400/status 0、WS 1001、事件链严格递增、`state==='stopped'`、同 rootDir 重启读回） |
| Issue AC4：WS Module 不依赖 REST create | `bootPeer`（app.ts:425-457）零 REST 构造；WS 路径仅消费 Registry/Lease/ReplicationSession；`packages/ws-replication/**` 零改动 | ✓ 落实（N1 恒绿锚：零 REST 请求下 bootstrap + 双向收敛） |
| SA8 A1（先 close session 后 release Lease） | 集成层只 `await this.hubService.stop()`（app.ts:473-475），无重排、无绕过；T3 以 1001 clean close + `replication-drained < registry-stopped` 观测 | ✓ 保全 |
| SA8 A2（两 observer 显式注入） | `app.ts:321-322` `metricsObserver: () => {}`、`diagnosticObserver: () => {}` 显式 no-op；`rest.ts:137-144` 构造期 TypeError fail-loud | ✓ 保全（M4 敏感度已由 SA6 变异证明） |
| SA8 A3（有界/单链） | `REST_DRAIN_BUDGET_MS = 10_000`（app.ts:88，模块常量、零配置键）< `STOP_WATCHDOG_MS = 60_000`（main.ts:30，本轮复核）；drain 在 `performStop` 单链内单点调用；`stop()` 单飞 stopPromise 不变（app.ts:461-466）；`drain()` 幂等（`drainPromise ??=`，rest-hosting.ts:168-171） | ✓ 保全（N2 双 stop() 五事件恰一次、525ms 有界绿） |
| SA2 F1（停机映射措辞） | `app.ts:480-483` 注释与 AGENTS.md 新句均表述「包级 WS 停机（含 close session → release lease）**之后**、registry shutdown 之前」；无任何把 REST 排空归入 §21 ② 或置于 ③ 之前的表述 | ✓ 落实 |
| SA2 F2（boot 窗口守卫） | `await this.restHost?.drain(...)`（app.ts:488）optional chaining；restHost 在 bootHub 中段（provision 后、plugin install 前，app.ts:308-339）构造一次 | ✓ 落实（行为测试例 3 绿：不 await ready 即 stop → 干净 resolve、无 `app-stop-failed`、链收敛） |
| SA2 F3（行为测试落点） | 四例全部落位新增 `apps/yjs-server/test/rest-hosting-behavior.test.ts`（非 `issue270-*`，与 DENY glob 零相交） | ✓ 落实 |
| SA2 F4（FR-3 收敛登记） | `rest-hosting.ts:179`（503 = transport 层拒绝注释）、`rest-hosting.ts:11-12`（500 = FR-3 加法替换占位）；AGENTS.md 显式「not terminal error-contract shapes (FR-3 converges them)」；行为测试只断言状态/类型/事件不固化 body 形状 | ✓ 落实（对应设计 §13 (a)(b)(c)） |
| SA2 O1/O7/O8 | 例 4（`/healthz?x=1` → 404）绿；例 2 显式 `20_000` per-test timeout（实测 10 007ms < 20s）绿；`createRestHosting` 闭包工厂，`handleRequest: restHost.handle` 无 `this` 丢失（rest-hosting.ts:195 `Object.freeze({handle, drain})`，`handle` 引用闭包变量） | ✓ 全部处置 |

Owner 评论：无（`[]`）——无遗漏或被旧状态覆盖的要求。

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| §7-D1 集成 seam = `createNomicoreApp`；遗留 `createYjsHubServer` 零改动 | `src/index.ts` 零改动（git status 证实）；REST hosting 仅在 `bootHub` | ✓ | — |
| §7-D2 `NomicoreApp.registry`（`\| undefined` getter，stop 后不清空） | `app.ts:123-127`（接口 + 注释）、`app.ts:193-196`（publicFace getter）；冻结契约 `appRegistry()` 结构窄化读取（contract-support.ts:220-222）零适配命中 | ✓ | — |
| §7-D3 分流规则 1：`stopRequested` → 503（先于任何 route family、不登记 in-flight） | `rest-hosting.ts:177-182`（`handle` 首同步段判定 → `writePlain(res, 503, 'service unavailable\n')` 后 return） | ✓ | — |
| §7-D3 规则 2：REST 优先；`matched:true` 写回 Response；`matched:false` 回落精确等值 `/healthz`+404 | `rest-hosting.ts:97-128`（`dispatch`）；回落判定 `req.url === '/healthz'` 精确等值（109），body `'ok\n'`/`'not found\n'` 与 `ws-server.ts:177-183` 缺省分支逐字节一致 | ✓ | — |
| §7-D3 Request 适配（流透传、不预读；无 body 方法 `body: undefined`） | `rest-hosting.ts:77-94`（`toWebRequest`：`Readable.toWeb(req)` + `duplex:'half'`；`BODYLESS_METHODS = {GET, HEAD}` 传 `body: undefined`） | ✓（GET/HEAD 为 Fetch `Request` 构造禁止 body 的全集；DELETE 等带 body 方法按流透传是 Fetch 合法且更保守的读法，设计括注「GET/DELETE/…」为示意非约束；405/403 路径不读 body 不受影响） | — |
| §7-D3 Response 适配（`arrayBuffer()` → `writeHead` → `end`；写失败静默 + 注销） | `rest-hosting.ts:116-127`（try/catch 静默；注销由 `handle` finally 承担 186-188） | ✓ | — |
| §7-D3 规则 3：upgrade 维持 `/replication` 单一门零改动 | `ws-server.ts:188-242` 本轮零触碰（diff 证实） | ✓ | — |
| §7-D4 步 0–7（含 F2 守卫、有界预算、超时 abort、幂等） | `app.ts:461-466`（步 0）+ `performStop` 步 1–7；`rest-hosting.ts:130-171`（`register`/`runDrain`/`drain`：快照、`Promise.race` 有界、超时逐个 `req.socket.destroy()`、迟到结算 no-op、`drainPromise` 幂等缓存） | ✓ | — |
| §7-D5 observer 显式 no-op | `app.ts:321-322` | ✓ | — |
| §7-D6 role 单真相（Instance service） | `app.ts:319` `requireNomicoreInstance(this.ctx).role`（非 `config.role`） | ✓ | — |
| §7-D7 根入口导入 + workspace 依赖 | `app.ts:23` `import { createRestRouter } from '@nomicore/namespace-api'`（根入口，命中 `vitest.config.ts` alias `/^@nomicore\/([^/]+)$/`）；`package.json` +20 `workspace:*`；`pnpm-lock.yaml` importers 段 +3 行连动 | ✓ | — |
| §7-D8 rejection → `rest-request-failed` + 500 `text/plain internal error\n`，不静默回落 404 | `rest-hosting.ts:100-105`（catch → `notifyRejection` → `writePlain(500)`）；`app.ts:327-332`（sink 事件携带 `message`）；行为测试例 1 锚定 | ✓ | — |
| §8 新模块形状（`RestHostingOptions`/`RestHosting`/`createRestHosting`） | `rest-hosting.ts:25-52` 与设计接口逐成员一致；内部 `Set` 记账 + `void (async …)()` 包裹 + `onRejection` try/catch 隔离（68-74）均按设计 | ✓ | — |
| §8 ws-server 增量（最小） | `HubPlainRequestHandler` 类型 + `HubWsServerOptions.handleRequest?` + createServer 委托 + 双 adapter 透传（`createNodeHubListenAdapter(observer?, handleRequest?)` 条件展开、`createHubListenAdapter(options?)` 缺省 `{}`）；缺省路径逐字节保持 | ✓ | — |
| §8 停机状态机步骤 0–7 一一对应 | `app.ts:461-466` + `468-531`（1 listener close、2 hubService.stop、3 listenerClosed+peer、**4 restHost?.drain**、5 replication-drained、6 registry.shutdown、7 尾段五事件） | ✓ | — |
| §13 FR-3 登记 (a)(b)(c) | 实现注释 + AGENTS.md 显式声明（见 §3 F4 行） | ✓ | — |
| SA3 自报偏差 3 项（fixture 复用冻结 contract-support 只读；占位 body 字面量；`handle` 兜底 `.catch`） | 复核：`rest-hosting-behavior.test.ts` 仅 import 冻结 fixture 导出（该文件哈希不变）；占位 body 未被任何断言固化；`.catch → notifyRejection`（rest-hosting.ts:189-192）不外抛且可观测 | ✓ 三项均为设计语义内的实现细节，无隐性削弱 | — |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| listener/raw-path 分流、intake 门、REST 有界排空、in-flight 记账 | server（组合根；ADR 0015 L32「router 不拥有 listener…graceful drain」） | `apps/yjs-server/src/rest-hosting.ts` + `app.ts` 装配 | ✓ 归属正确 |
| WS 停机次序（§21 ②③ 包内） | `@nomicore/ws-replication` | 集成层只 `await hubService.stop()` | ✓ 只消费不重排 |
| role 单真相 | Instance service（ADR 0012） | `requireNomicoreInstance(ctx).role` 注入 | ✓ |
| Registry 生命周期/teardown | composition root | boot 单赋值注入 + performStop 单链 teardown | ✓ |
| body 读取策略 | router 单点（FR-1 加法前提） | 适配层流透传不预读 | ✓ |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 有界排空 + 诚实失败收口 | `hubService.stop()`（包内 close Promise，protocol §21 L591） | `restHost.drain(budget)`（预算 + abort + 幂等） | 一致 | drain 归 server（ADR 0015 L32），分层同构 |
| 观测回调隔离 | `ws-server.ts notifyAdapter`（140-143） | `notifyRejection` try/catch（rest-hosting.ts:68-74） | 一致 | 同纪律：观测不改变结局 |
| 停机链生命周期步插入 | diagnostics O(1) close 步（#155 先例） | drain 插入 `replication-drained` 前 | 一致 | 单链定点插入、不动 diagnostics 位置 |
| HTTP in-flight 记账 | 无 app 级既有等价（grep 复核） | rest-hosting 内 `Set` | 一致（新机制有据） | 无平行机制可复用 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| Registry 实例 | `this.registry`（app.ts:260 唯一赋值） | router 构造注入、publicFace getter 委托 | 低（零再赋值路径，grep 证实） |
| role | Instance service | boot 期读出注入 router | 低 |
| 停机状态 | `stopRequested` + `stopPromise` | rest-hosting 经 `isStopping()` 闭包读 | 低（回调委托，无第二标志） |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| bootHub 构造 restRouter/restHost（一次冻结；boot 窗口 `undefined` 与 `hubService` 等同款） | performStop 步 4 `restHost?.drain()`（boot 窗口跳过；restHost 无资源不需 dispose，`Set` 自清） | 构造期失败 → ready reject（fail loud）；boot 窗口早停 → 干净结算（例 3 绿） | ✓ 对称 |
| `stop()` 单飞 | stopPromise 同实例 | `app-stop-failed` + rethrow | ✓ |
| `drain()` | 幂等（`drainPromise ??=`） | 超时 abort 后迟到结算 no-op | ✓ |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二条拆卸链 | 无（app AGENTS 硬约束） | drain 插入既有单链 | 非重复 ✓ |
| 第二 HTTP listener/端口 | 无 | 同一 listener 双 route family | 非重复 ✓ |
| 包内 REST 逻辑 | 无（REST 归 namespace-api） | app 只 bridge/记账 | 非重复 ✓ |
| 第二 drain worker/定时器 | 无 | 预算常量 + 一次性 setTimeout（清除于 162） | 非重复 ✓ |
| /healthz+404 判定复制 | `ws-server.ts:177-183` 缺省分支 | `rest-hosting.ts:106-114` 回落复刻 | **受控复刻**（设计明文要求的形态；两侧分别被 N3/T2 与行为例 4 锁死，漂移可检测——见 O-B） |

## 6. 文件范围审查

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `apps/yjs-server/src/app.ts`（修改，+75/-3） | §11 行 1 逐项命中 | 观测面 getter、restHost 字段、bootHub 装配、drain 插位、常量、事件、导入、头注 | ✓ 超范围零条目 |
| `apps/yjs-server/src/rest-hosting.ts`（新增，196 行） | §11 行 2 | D3/D4/D8 承载模块 | ✓ |
| `apps/yjs-server/src/transport/ws-server.ts`（修改，+38/-4） | §11 行 3 | `handleRequest` 注入面；缺省路径逐字节保持（177-183 与 HEAD 比对一致）；upgrade 面零改动 | ✓ |
| `apps/yjs-server/package.json`（+1） | §11 行 4 | `@nomicore/namespace-api: workspace:*` | ✓ |
| `pnpm-lock.yaml`（+3） | §11 行 5 | importers 连动 | ✓ |
| `apps/yjs-server/AGENTS.md`（+15/-3） | §11 行 6（F1/R1 + F4/R2(c) 措辞约束） | 消费面包加 `namespace-api`；单链句补 REST 排空（表述「包内 close session → release lease 之后」——次序正确、未归入 §21 ②）；503/500 显式声明为 transport 占位非终态契约 | ✓ 措辞符合双约束 |
| `apps/yjs-server/test/rest-hosting-behavior.test.ts`（新增，153 行） | §11 行 7（非 issue270 命名） | §12 行为测试四例 | ✓ 与 DENY glob 零相交 |
| `wiki/raw/task_issue-270_sa3_impl.md` + 4 log | 技能固定产物 | 报告/证据 | ✓ |

DENY 面核验（本轮独立执行）：`git status --short` 对 `packages/**`、`docs/**`、`apps/yjs-server/src/main.ts`、`apps/yjs-server/src/index.ts`、`vitest.config.ts`、`docs/adr/**` 均零条目；冻结契约三文件 sha256 与 SA6 §13.4 逐字节一致。**无越界。**

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `NomicoreApp` +`registry` getter（加法） | `main.ts`（零改动）、app 测试套件、SA6 契约 `appRegistry()` | 结构窄化读取直接命中；无任何测试断言公共面键集封闭（grep `Object.keys(app)`/`'registry' in app` 零命中）；33 文件/173 例全绿 | 无 | — |
| `createNodeHubListenAdapter(observer?, handleRequest?)` 可选参扩展 | `index.ts` 公共导出（零改动）；`node-hub-peer-live`（无参调用）、`ws-server-upgrade-admission`（仅 observer 参） | 不传新参 → 缺省路径逐字节不变；两测试 app-suite 绿 | 无 | — |
| `createHubListenAdapter(options?)` 无参→可选参 | app.ts 唯一消费者（未导出于 index.ts） | `= {}` 缺省兼容 | 无 | — |
| `HubWsServerOptions.handleRequest?`（`startHubWsServer`） | ws-replication-issue190-sa7-real-transport 等 | 可选加法；app-suite 绿 | 无 | — |
| sink 事件面（NDJSON）新增 `rest-request-failed` | `EventSink = (event: Readonly<Record<string, unknown>>) => void`（lifecycle.ts:20，开放形状——本轮复核） | 无枚举封闭约束；NDJSON 可序列化 `{event, message}`；lifecycle.ts 零改动（不在 ALLOW，亦未触碰） | 无 | — |
| `registry.shutdown()` 前置新增 drain | `performStop` 单点 | 位置 = 设计步 4；boot 窗口 optional 跳过；M3/M5 类变异已被 T3 锁死（SA6 变异证据） | 无 | — |
| WS plugin / `packages/*` 公共面 | — | 零触达（DENY 全绿） | 无 | — |
| 遗留 `createYjsHubServer` | 公共兼容套件 | 零改动；其 404 占位保持 | 无 | — |
| 升级 family（`/replication`） | 契约 N3/T2 | upgrade 段零改动；404/401/403/503 面全绿 | 无 | — |

## 8. 错误、恢复与并发

| 检查点 | 结论 | 证据 |
|---|---|---|
| rejection 不静默、不伪装 404 | ✓ catch → 观测 + 500；行为例 1（500 + 事件恰一次 + 后续 201 + 计数不增） | rest-hosting.ts:100-105、行为测试日志 |
| 观测回调 throw 隔离 | ✓ `notifyRejection` try/catch | rest-hosting.ts:68-74 |
| EventEmitter 上下文不外抛 | ✓ `void (async …)()(...).catch(...)` 双层收编；`.catch` 为结构性兜底且经 `rest-request-failed` 可观测（非静默） | rest-hosting.ts:173-193 |
| 响应写失败（socket 已亡） | ✓ 静默收口 + finally 注销（设计 E2 形态） | rest-hosting.ts:57-65、116-127、186-188 |
| 接纳记账无中间态 | ✓ `isStopping()` 判定与 `register(req)` 均在 async 主体**首个同步段**（首个 await 之前）；Node request 事件同步派发 ⇒ 要么登记、要么 503 | rest-hosting.ts:176-188 |
| drain 快照完备性 | ✓ `stopRequested` 在 `stop()` 同步段置位且先于一切 await ⇒ runDrain 快照 `[...inFlight]` 必含全部已接纳项；快照后不可能有新登记（门 A 拦截） | app.ts:461-466、rest-hosting.ts:151-153 |
| drain 超时诚实失败 + 幂等 + 迟到 no-op | ✓ 逐个 `req.socket.destroy()` → body 读取以流错误结算 → 客户端传输层失败（行为例 2 实测 status 0 + transportError）；`settle` 双调 no-op（resolve 一次 + Set.delete 幂等）；timer 于 settled 分支清除 | rest-hosting.ts:130-171、行为例 2（10 007ms） |
| 已进入 `registry.create` 的在途槽 | ✓ 不被 abort 取消（ADR 0015 L113）；`registry.shutdown()` 等已接纳 lifecycle 槽结算为第二道保障（包语义，零重复实现） | 注释 rest-hosting.ts:142-144 + T3 ⑦ 重启读回 |
| boot 窗口早停（F2） | ✓ optional chaining 跳过；行为例 3 绿（干净 resolve、无 `app-stop-failed`、链收敛） | app.ts:488、行为例 3 |
| 运行期 restHost 缺位静默降级（SA2 S8） | ✓ 结构性排除：restHost 构造先于 `createHubListenAdapter({handleRequest})`（app.ts:324-339）⇒ listener 接纳请求 ⟹ restHost 已构造；`registry === undefined` 于 fiber ready 后为显式 throw（fail loud） | app.ts:316-339 |
| `toWebRequest` 构造异常（非法 URL 等） | ✓ 在 `restRouter.handle(toWebRequest(req))` 的 try 内 → 500 路径 | rest-hosting.ts:99-105 |
| 双 `stop()` / 二次 drain | ✓ stopPromise 单飞；drain 幂等缓存 | app.ts:461-466、rest-hosting.ts:168-171 |
| GET/HEAD 请求流无 error 监听 | 与 HEAD 基线同构（原 `/healthz`+404 处理器同样不消费 req）；带 body 方法的流错误经 `Readable.toWeb` → `request.json()` rejection → 500 路径（设计 E3）；N3 的 `POST /not-a-route` 带 body 实测无崩溃（app-suite 绿） | rest-hosting.ts:77-94 + N3 |
| matched 早返回不消费 body 的 keep-alive socket | 设计 §13 显式登记为 follow-up（SA2 O2 → FR-1 票）；停机面不受影响（drain 记账以响应写回完成结算）——非本票义务 | 设计 §13、SA2 §14 |

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `issue270-server-integration-red.test.ts` T1-A（**冻结，哈希一致**） | 201 + namespaceId 形状；组合根 Registry reopen 读回；第二 Registry `NAMESPACE_NOT_FOUND` 反证；二次 create 后观测面恒等（`toBe` 身份） | 根 vitest include `apps/*/test/**/*.test.ts` + CI 分片（磁盘枚举，新文件必入片） | 无削弱（零字节改动） | — |
| 同上 T1-B（冻结） | app registry lease `mutateData(n=99)` → WS BOOTSTRAP_SNAPSHOT `ROOT.n===99`（同 Runtime/sequencer 行为证明） | 同上 | 无 | — |
| 同上 T2（冻结） | canonical 201/GET 405+Allow/非 canonical 404/`/replication` 普通 404/`/healthz` 200/upgrade 101/REST-path upgrade 404 | 同上 | 无 | — |
| 同上 T3（冻结） | 100-continue 已接纳 create drain 期 201；停后新请求非 201 且 ≥400/0；WS 1001；五事件严格递增；`state==='stopped'`；同 rootDir 重启读回 | 同上 | 无 | — |
| `issue270-regression-anchors.test.ts` N1/N2/N3（冻结） | WS 独立复制双向收敛；stop 有界 + 双 stop 单链五事件恰一次；既有 listener/凭据门面 | 同上 | 无 | — |
| `rest-hosting-behavior.test.ts` 例 1（D8） | 畸形 JSON → 500 + `rest-request-failed` 恰一次 + message 非空 + 后续 create 201 + 计数不增 | 同上（vitest list 命中；contract log 实跑 3 文件 11/11） | 无（状态/头/事件断言，零源码字符串） | — |
| 例 2（D4） | admitted 不发 body → stop 有界（≥5s、<15s）+ 客户端传输层失败（status 0 + transportError）+ `app-stopped` 恰一次 + 无 `app-stop-failed` | 同上；per-test timeout 20 000（O7 落实，实测 10 007ms） | 无（下界 5s 与预算常量耦合为有意敏感度，见 O-C） | — |
| 例 3（F2） | 不 await ready 即 stop → `stop()` resolve、`ready` 干净 resolve、无 `app-stop-failed`、四事件恰一次且严格递增 | 同上 | 无 | — |
| 例 4（O1） | `GET /healthz?x=1` → 404；`/healthz` → 200（精确等值含 query） | 同上 | 无 | — |
| skip/only/todo/env override | `grep -nE '\.(only\|skip\|todo)\(\|process\.env'` 新行为测试 → 零命中（本轮独立复跑） | — | 无 | — |
| fixture 隔离与清理 | 全部 `finally { stop() }`；agent:false 独立连接；冻结测试 tmpdir `rmSync`；行为测试无 tmpdir | app-suite 33/33 绿（含直用 adapter 三个既有测试） | 无 | — |
| SA6 红灯断言保持 | 冻结三文件 sha256 逐字节一致；红灯基线 4 红（SA3 实现前复跑于本会话）→ 实现后 11/11 绿（contract log） | 真实仓库入口（`--typecheck` 亦绿） | 无伪绿路径（实现前基线与 SA6 §13.1 逐位一致） | — |
| typecheck | `tsc -p apps/yjs-server/tsconfig.json`（include 含 `test/**`）exit 0；根 `pnpm typecheck` 14 包+app exit 0 | 真实入口 | 无 | — |

## 10. Required revisions

**无 BLOCKER / MAJOR / MINOR 阻断项。**

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 根 `pnpm test` 全仓套件（SA3 只跑 app 套件 + 根 typecheck，已显式 defer） | 根 vitest（含 packages/domains） | 全绿；本票改动面全部位于 `apps/yjs-server`（deny 零触达），预期无跨包影响 | 任何 packages/domains 用例因本票转红 |
| `hub-restart-static-target-red`（#229 既有 flake）在全量运行下的表现 | 全 app 套件复跑（SA3 本轮通过） | 按 SA6 §14 三角验证口径：单独跑绿、排除本票契约的全量绿 | 仅与本票文件同批运行时红且可 3/3 复现（则需重审资源干扰假设——当前证据相反） |
| 生产式 keep-alive 客户端在 matched 早返回（405/404 不消费 body）路径上的 socket 处置 | 带真实 keep-alive agent 的客户端（FR-1 票范围，SA2 O2 已登记） | 连接被 Node 关闭或滞留至 keepAliveTimeout，无进程崩溃 | 进程因未消费请求流错误崩溃（`Readable.toWeb` 已挂 error 处理，预期不触发） |
| 高负载下 `res.end()` 字节在进程退出前完整 flush | 负载下 stop() + 客户端收包 | T3 ⑦ 已覆盖 admitted-create 单例（客户端实测收到完整 201 且重启读回）；负载场景由后续性能票观测 | 客户端截断响应且持久化已提交（不可重试的静默丢失） |
| `drain` 预算常量未来调整 | 后续 ticket 改 `REST_DRAIN_BUDGET_MS` | 行为例 2 上下界断言随预算同步修订 | 改常量而不改测试导致假红/假绿 |

## 12. Non-blocking observations

- **O-A（根套件 defer）**：SA3 按 AGENTS「root `pnpm typecheck` + app 套件」执行且已显式登记 defer；
  deny 零触达使跨包风险接近零，动态验证项已登记（§11 第 1 行）。
- **O-B（/healthz+404 判定受控复刻）**：`rest-hosting.ts:106-114` 回落分支复刻了 `ws-server.ts:177-183`
  缺省路径的判定与 body（设计明文要求的形态——保证缺省路径逐字节不变）。两处实现并存存在漂移可能，
  但双侧分别被 N3/T2（缺省路径，直用 adapter 测试）与行为例 4（回落路径，query 语义）锁定，漂移必红。
  另：`ws-server.ts:5` 头注「`matched:false` 时仍回落**下面的** /healthz+404 缺省路径」措辞略不精确
  （实际回落发生在 rest-hosting 内的等价复刻，非下面的缺省分支）——注释级 nit，随 FR-1/FR-3 票顺手校正即可。
- **O-C（例 2 下界耦合）**：行为例 2 的 `elapsedMs >= 5_000` 与 `REST_DRAIN_BUDGET_MS = 10_000` 耦合
  （有意敏感度）；未来调低预算须同步测试（已在 §11 登记）。
- **O-D（drain 超时 abort 的观测事件）**：超时 abort 引发的流错误会经同一 rejection 路径发出
  `rest-request-failed`（自致 abort 也计一次失败观测）。不违反 D8（任何 handle rejection → 事件），
  FR-4/FR-3 票若需区分「自致 abort」与「真实失败」可加分类字段。
- **O-E（drain 首预算缓存）**：`drainPromise ??= runDrain(budgetMs)` 使二次调用以首预算的同一 Promise
  结算——当前单调用点 + 常量预算下正确且即「二次 no-op」语义；若未来出现第二调用点传不同预算，
  首值静默生效（当前无此调用面，仅备忘）。
- SA2 遗留观察项处置确认：O1（行为例 4）、O7（例 2 显式 20s timeout）、O8（闭包工厂无 `this` 丢失）
  均已在实现中落实并复核。

## 13. 结论

实现与批准设计（SA1 iteration 1，SA2 `approve`）逐决策面一致，与冻结 SA6 契约零冲突（三文件哈希
逐字节一致、红灯 4/4 转绿且断言零改动），SA8 A1/A2/A3 与 recheck R1/R2 全部保全、5 条重开条件零触发；
文件范围与 ALLOW/DENY 逐路径吻合；错误路径（rejection/写失败/断连/超时 abort/boot 窗口早停）均有
诚实结局与行为证据。**verdict：`approve`**（MINOR 观察不阻断）；`requiresConflictRecheck: false`。
