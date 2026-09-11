# SA1 架构设计 — issue #270：Server 集成验收（REST 与 WebSocket 共享 Registry + 有序停止）

> 阶段：design（iteration 1 —— SA2 评审修订轮，逐条落实 F1–F4，映射见 §14）。Dispatch：
> `sa-ef2d8484-1795-43af-a071-68662470efb6`（mabf-sa1）。
> 输入基线：任务简报 `wiki/raw/task_issue-270.md`（Issue #270，comments REST 读取 = `[]`——无 Owner
> 追加要求）；SA6 验收契约 `wiki/raw/task_issue-270_sa6_contract.md`（verdict `approve`，H1–H4 契约
> 假设——已由本设计与 SA2/SA8 复核确认）；SA8 冲突门禁 `wiki/raw/task_issue-270_sa8_gate.md`
> （verdict `clear`，advisory A1–A3）；SA8 设计后复审 `wiki/raw/task_issue-270_sa8_recheck.md`
> （verdict `clear`，advisory R1/R2——其 `requiresConflictRecheck:false` 前置条件由本轮 F1/F4 落实）；
> SA2 设计评审 `wiki/raw/task_issue-270_sa2_review.md`（verdict `reject`，MAJOR F1–F3 + MINOR F4）。
> 本任务无独立 `_relevant_decisions.md` / `_conflict_report.md`（SA6 §1 与目录盘点一致）——SA8 输入
> 以同任务等价固定产物 `task_issue-270_sa8_gate.md` 附录 A 决议摘录 + `task_issue-270_sa8_recheck.md`
> 承接。iteration 0 头注「`_sa2_review.md` 不存在」声明已失效（该文件现已存在并为本轮修订输入）。
> 代码基线：HEAD `0b06050`（= `origin/docs/rest-namespace-create`，#267 经 PR #296 合入）。

---

## 1. 任务类型、目标与非目标

**任务类型：Feature（server 集成验收）**——不是缺陷回归。ADR 0015 的「server 集成验收」测试决策
（L210）与装配条款（L18–20/L32/L232）在本仓尚未落地：#267 只交付了 Host 无关的 REST router 骨架，
部署组合根 `apps/yjs-server` 还没有把该骨架接入真实 server 生命周期。

**目标**（= Issue AC1–AC4 的可实施化）：

1. **AC1**：composition root 构造 REST 与 WebSocket Module 时注入并共享同一个 `NamespaceRegistry`
   引用——REST router 经构造注入取得组合根 Registry；WS plugin 经 Cordis service 取得**同一实例**；
   同一 namespace 在进程内只有一个 Runtime 与一个 write sequencer。核心 Module 不读 Cordis Context、
   不运行时替换。
2. **AC2**：server（组合根的单一 HTTP listener）先按 raw path 选择 REST 与 WebSocket route family：
   普通请求 REST family 优先（判别 `matched:false` 时回落到 listener 自有路由），upgrade 请求维持
   `/replication` 单一门。
3. **AC3**：有序停止——停止 intake（listener 关闭 + 迟到请求 503 门）→ 等待已接纳 REST/WS 工作
   settle（**新增**：已接纳 REST 工作的有界排空）→ 释放 Lease/Session（WS 侧由包内既有
   「先 close session、后 release Lease」收口）→ `registry.shutdown()` → persistence dispose。
4. **AC4**：WebSocket Module 不依赖 REST create——WS 路径零改动，仍直接使用
   Registry/Lease/ReplicationSession。

**非目标**：

- REST 错误契约（4xx/5xx problem shape）、limits、`Request.signal`、observer **事件**发射——
  FR-1/FR-3/FR-4 后续票（本设计只做 server 侧 rejection→500 的临时占位，见 §9/§13）；
- peer 角色 REST listener（peer 组合根无 listener；role gate 已由 #267 包级契约
  `packages/namespace-api/test/rest-role-gate-routing-contract.test.ts` 覆盖）；
- REST 认证/owner authorization（ADR 0015 L36：首版受信 localhost/受信网络暴露）；
- 遗留低层 `createYjsHubServer`（`apps/yjs-server/src/index.ts`）承载 REST（见 H4 裁决）;
- 新增 REST 开关配置键或显式 opt-in（见 H1 裁决）；
- 修改任何 `@nomicore/*` 包公共契约。

## 2. 当前行为与证据锚点

| # | 事实 | 锚点 |
|---|---|---|
| C1 | 部署组合根 = `createNomicoreApp`（`apps/yjs-server/src/app.ts`），`main.ts` 唯一生产入口；`boot()` 按 Instance → Clock → Timer → Persistence → Registry → role-specific 复制插件装配；`this.registry = requireNomicoreRegistry(ctx)`（app.ts:233）在 registry fiber 就绪后取得**唯一** Registry 引用 | `apps/yjs-server/src/app.ts:188-238`、`src/main.ts:200-218` |
| C2 | `NomicoreApp` 公共面仅 `ready/stop/sink/handleControlLine`（app.ts:103-112、162-172）；无 Registry 观测面——SA6 红灯点②（`'registry' in app === false`） | `apps/yjs-server/src/app.ts:103-112`；SA6 §5/§8 |
| C3 | hub listener = `startHubWsServer`（`apps/yjs-server/src/transport/ws-server.ts`）：普通请求处理器固定 `req.method === 'GET' && req.url === '/healthz'`（**精确等值**——`/healthz?x=1` 现状 404）→ 200、其余 404（ws-server.ts:161-169）；upgrade 只认 `options.path`（`/replication`），其余 404/401/403/503——REST path upgrade 404 已是现状 | `apps/yjs-server/src/transport/ws-server.ts:161-227` |
| C4 | 组合根经 `createHubListenAdapter()`（app-owned adapter 包装 `createNodeHubListenAdapter`，ws-server.ts:289-312）向 hub plugin 注入 listener；plugin 契约 `HubListenAdapter.listen({host,port,path,authenticate,accept})` 不含 plain-HTTP 面 | `packages/ws-replication/src/plugin.ts:58-71`；`apps/yjs-server/src/app.ts:285-307` |
| C5 | REST router 骨架已存在且独立可用：`createRestRouter`（构造校验 role/registry/两 observer，缺 observer → `TypeError`）；`handle(Request)` 判别 `{matched:false}` / `{matched:true;response}`；成功路径 201/405/403 齐备；未映射结局一律 **rejection**（不产生 HTTP 错误 Response） | `packages/namespace-api/src/rest.ts:119-179`、`src/create-namespace.ts:31-81`；包 AGENTS.md |
| C6 | 现行停机链 `performStop()`（app.ts:414-468）：`hubListener.close()`（同步停接纳）→ `hubService.stop()`（WS 1001 `'hub-shutdown'` 收口 + 包内 close session → release lease + Runtime barrier）→ `await listenerClosed` → `peerService.stop()` → sink `replication-drained` → `registry.shutdown()` → `registry-stopped` → diagnostics O(1) close → file 排空窗 → `persistenceFiber.dispose()` → `persistence-disposed` → `ctx.fiber.dispose()` → `app-stopped`；`stop()` 单飞幂等（stopPromise） | `apps/yjs-server/src/app.ts:405-468`；`packages/ws-replication/src/hub-connection.ts:398-402` |
| C7 | `registry.shutdown()` 同步段停接纳（此后 `open/create` → `REGISTRY_NOT_ACCEPTING` 窄 issue）并等待**已接纳** lifecycle 槽结算后关闭全部 Runtime；幂等 same-Promise | `packages/namespace-registry/src/registry.ts:2120-2271`、`src/types.ts:759-768` |
| C8 | `apps/yjs-server` 不依赖 `@nomicore/namespace-api`（package.json:16-28）；SA6 实证：接线即 7/7 绿、不排空则 T3 红（`unmapped registry issue: REGISTRY_NOT_ACCEPTING`）——AC3 缺口独立于路由接线 | `apps/yjs-server/package.json`；SA6 §8/§9-E1/E2-M3/M5 |
| C9 | ws-replication 包内 `closeSessionAndRelease` 严格保持 close session → release lease 次序（§12/§13.2），集成层不暴露 session/lease 内部对象 | `packages/ws-replication/src/hub-namespace.ts:436-450,641-643,1163-1188` |
| C10 | 测试解析纪律：根 `vitest.config.ts` alias 覆盖 `@nomicore/<pkg>`（根入口）与显式子路径 `/testing`、`/internal`；`@nomicore/namespace-api/rest` **无** alias 规则；包无 `dist` 构建；`tsconfig.base.json` `customConditions:["nomicore-source"]` | `vitest.config.ts:7-12`、`packages/namespace-api/`（无 dist）、`tsconfig.base.json` |
| C11 | **boot 窗口停机事实（F2 依据）**：`main.ts` 在 `createNomicoreApp` 返回后立即挂 SIGTERM/SIGINT（main.ts:210-212）；`boot()` 首个 await（clock fiber，app.ts:195）即让出事件循环，boot 各 await 边界均有 `if (this.stopRequested) return;` 早退（app.ts:196/211/232/277/281/304/309）——停机请求真实可落于「服务尚未构造」窗口；现行 `performStop()` 对全部可能未构造的服务守卫：`this.hubListener?.close()`、`hubService !== undefined`、`peerService !== undefined`、`registry !== undefined`、`this.diagnostics?.close()`、`persistenceFiber !== undefined`（app.ts:414-453） | `apps/yjs-server/src/main.ts:200-218`、`src/app.ts:188-238/414-468` |

## 3. 能力缺口（承接 SA6 §8）

| Step | 缺口 | 证据 |
|---|---|---|
| 症状 | 契约 T1-A/T1-B/T2/T3 红灯（4 红 / 3 绿锚稳定复现 3/3） | SA6 §5/§13.1，`task_issue-270_sa6_red.log` |
| 缺口① | 组合根 HTTP listener 无 REST route family：canonical `POST /v1/owners/{owner}/namespaces` → 404 | C3、SA6 §8 直接故障点① |
| 缺口② | 组合根不暴露共享 Registry 观测面：AC1 无法被集成观测 | C2、SA6 §8 直接故障点② |
| 缺口③ | **AC3 真实缺口**：现行停机链在「已接纳 REST 请求仍持有 body/lease」时即执行 `registry.shutdown()` → 在途 create 得 `REGISTRY_NOT_ACCEPTING` → rejection。仅接线不排空时 T3 仍红；M3（移除排空）/M5（registry 提前）均被 T3 单点捕获 | C6/C7、SA6 §8「关键因果发现」、§9-E2 |
| 最深根因 | ADR 0015「server 集成验收」本体（组合根注入共享 Registry、raw path 分流、含 REST 排空的有序停止）尚未实现；#267 只交付 Host 无关骨架 | SA6 §8、SA8 gate R6 |
| 排除项 | 环境/依赖/fixture/入口/超时/HTTP 客户端/WS 协议/Registry/Persistence 均被 SA6 §6/§11 排除 | SA6 §6/§11 |

## 4. Owner 要求落实

Issue comments REST 快照 = `[]`（dispatch 前两读均为空）——无 Owner 追加要求；验收口径 = Issue body。

| 来源 | 要求 | 设计落实 |
|---|---|---|
| Issue body AC1 | REST 与 WS Module 持有同一个 `NamespaceRegistry` 引用（不经 Cordis Context 查找、不运行时替换） | §7-D1（构造注入同一 `this.registry`）、§7-D2（`NomicoreApp.registry` 观测面）、§8 装配序 |
| Issue body AC2 | raw path 正确分流 REST 与 WebSocket route family | §7-D3（plain 请求 REST 优先 + 判别回落；upgrade 维持 `/replication` 单一门） |
| Issue body AC3 | 停止顺序：停止 intake → 等待已接纳工作 → 释放 Lease/Session → shutdown Registry 与 Persistence | §7-D4（迟到 503 门 + 有界 REST 排空插位，含 boot 窗口守卫）、§8 停机状态机 |
| Issue body AC4 | WebSocket Module 不依赖 REST create，仍直接使用 Registry/Lease/ReplicationSession | §7 非目标 + §12 N1 恒绿锚（WS 路径零改动） |
| Issue body 范围 | 基于骨架 router 落地；不等待完整错误契约与 observer 行为；后续 ticket 不得破坏本验收 | §9（rejection→500 占位不预发明 problem shape）、§7-D5（observer 显式 no-op 注入）、§12 N1–N3 |

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 红灯 4 例只落在本票目标面（无 REST route family、无观测面） | SA6 §5/§13.1 | §7-D1/D2/D3 直接补齐两个缺口 |
| 接线但不排空 ⇒ T3 红（`REGISTRY_NOT_ACCEPTING`）；排空后 7/7 绿 | SA6 §8/§9-E1/E2-M3 | §7-D4 把「已接纳 REST 工作结算」设为 `registry.shutdown()` 前的显式步骤 |
| M1（第二 Registry）被 T1-A/T3 捕获 | SA6 §9-E2 | REST router 构造注入**同一** `this.registry` 字段引用（§7-D1），构造后冻结、零重建路径 |
| M4（漏注入 observer）→ 7/7 启动点红 | SA6 §9-E2 | §7-D5：构造点显式注入两个 no-op observer（`createRestRouter` 构造期 TypeError 兜底） |
| M6（role 固定 `'peer'`）→ T1-A/T2/T3 红 | SA6 §9-E2 | §7-D6：role 自 Instance service（`requireNomicoreInstance(ctx).role`）读取后注入 |
| M2′（route family 串线）被 T2/N3 捕获 | SA6 §9-E2 | §7-D3：plain=REST 优先/upgrade=WS 单一门，两族互不接管 |
| 绿灯模拟件已证明最小接线形态可满足全部断言（测试字节不变） | SA6 §9-E1/§13.2 | 本设计即该形态的生产化（ observational surface / hook 命名与模拟件同构） |
| #229 `hub-restart-static-target-red` 为既有 flake（与本票无关） | SA6 §14 | 不纳入本票范围；验收口径按 §12 排除说明 |

上游事实与源码无矛盾（C1–C11 逐条核对）。

## 6. SA8 约束落实

输入：`task_issue-270_sa8_gate.md`（verdict `clear`；附录 A 决议摘录为 `relevant_decisions` 等价产物——
本任务无独立 `_relevant_decisions.md`，已在文首声明）+ `task_issue-270_sa8_recheck.md`（verdict
`clear`；advisory R1/R2 由本轮 F1/F4 落实）。

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| **A1** 停机「先 close session、后 release Lease」（ADR 0010 L90 / protocol §21 ③） | §8 停机链步骤 2 | 集成层只 `await hubService.stop()`（1001 `'hub-shutdown'` 收口 + Runtime barrier），**不重排、不绕过**包内 `closeSessionAndRelease` 次序（C9）；集成观测面 = 1001 clean close + `replication-drained < registry-stopped` | 否（消费既有契约） |
| **A2** REST Module 构造期两个同步 void observer 显式注入（ADR 0015 L186） | §7-D5 | `createRestRouter({... metricsObserver: noOp, diagnosticObserver: noOp})`——显式 no-op 是显式决定；漏注入由构造期 TypeError → `ready` reject（fail loud，M4 已证敏感） | 否 |
| **A3** 不无限等待日志 sink、单一拆卸链（ADR 0011 L129 / ADR 0014 门槛 13；app AGENTS.md） | §8 停机链、§9 | REST 排空为**有界**（常量预算 + 超时 abort），插在既有单链内（`replication-drained` 前），不新增第二条链、不触碰 diagnostics O(1) close 位置；`stop()` 单飞不变（N2 恒绿锚） | 否 |
| ADR 0015 L18–20/L32/L210/L232（共享 Registry、raw path 分流、server 集成验收停机序、WS 不依赖 REST create） | §7 全部 | 逐条对应 AC1–AC4；REST router 不拥有 listener/auth/drain——drain 归组合根（§7-D4） | 否（SA8 设计后复审复查面 1/2/3/5 已裁 no-conflict） |
| ADR 0009 L8/L99–103/L118（单 Runtime/单 sequencer；shutdown 停接纳、等已接纳槽、Registry 先于 Persistence） | §7-D1、§8 | 共享引用兑现单 sequencer 不变量；AC3 序严于「shutdown 不等待外部 lease release」（SA8 R4 已裁更严不构成冲突）；`registry.shutdown()` 先于 `persistenceFiber.dispose()` 维持 | 否 |
| ADR 0012 L5/L19/L37（composition root 拥有最终 teardown；plugin dispose 只收自身资源；上游按 Registry → Persistence → Timer/Clock 释放） | §8 | 停机编排仍由 `performStop()` 单点拥有；WS plugin 生命周期语义零改动 | 否 |
| protocol §21 六步梯子（①停接纳/关 transport ②排空已接纳 apply ③close sessions + release leases ④Registry shutdown ⑤Persistence dispose ⑥Timer/Clock） | §8 停机状态机 | server 级投影（**与 §8 实际执行序一致——F1/R1 修订**）：①=intake 停止（listener close + 503 门）＋WS 1001；②③（WS 包内）=已接纳 apply 排空 + closeSessionAndRelease，由 `await hubService.stop()` **一次完成**（protocol §21 L591：Hub replication close Promise 必须等待停机前已接纳 apply 无条件排空、session close 与 replication lease release）；**server 级 REST 排空在 ③ 之后、④ 之前插入**（§8 步 4）——REST drain 是 server 职责（ADR 0015 L32），**非 §21 梯子成员、无梯子位**；④⑤⑥ 照旧。（iteration 0 本行的失真投影已按 SA2 F1 / SA8 R1 全文改写并删除，修订映射见 §14-F1） | 否 |
| ADR 0015 状态 = 提议（SA8 冲突点 4 状态注记） | §6 本行、§15 | 两种读法下设计同构（实施其条款=同向）；SA8 设计后复审已裁 no-conflict；本轮修订未触发任何重开条件（§15） | 否（PR #158 合入时状态自收敛） |
| **SA8 recheck R1**（§6/§8 停机映射一致 + AGENTS.md 措辞约束） | §6 §21 投影行（本轮重写）、§7-D4 编号（0–7 对齐 §8）、§11 ALLOW AGENTS.md 行 | 已按实际执行序重写（= SA2 F1）；AGENTS.md 补充句受同款措辞约束（§11） | 否（纯文字，SA8 recheck 已预告无需再开门禁） |
| **SA8 recheck R2**（503/500 双表面 FR-3 收敛义务登记） | §13「FR-3 表面收敛义务」、§7-D8、§11 AGENTS.md 措辞 | (a)(b)(c) 显式登记（= SA2 F4）：intake 门 503 定性 transport 层拒绝；500 占位 FR-3 加法替换；AGENTS.md 不把占位 body 形状写成终态契约 | 否（登记性，SA8 recheck 已预告无需再开门禁） |

## 7. 设计决策与主要备选方案（含 H1–H4 仲裁）

### D1 / H4 仲裁：集成 seam = 部署组合根 `createNomicoreApp`（**确认 H4 原案**）

- REST hosting 只落在 `createNomicoreApp`（`main.ts` 唯一生产入口，拥有 Registry + Persistence
  生命周期——AC3 的前提）。`bootHub()` 在 registry fiber 就绪后、hub plugin listen 之前构造 REST
  router 与 plain-HTTP 宿主（§8 装配序）。
- 遗留低层 `createYjsHubServer`（`src/index.ts:96-515`）**不改**：它不拥有 Persistence，无法兑现
  AC3 的「shutdown Registry 与 Persistence」；其普通请求 404 占位保持原样。若未来票要给它加 REST，
  须另立 seam 议题。
- **备选**（不采）：同时改造 `createYjsHubServer`——违反 AC3 归属且扩大公共兼容面（index.ts:46-48
  注明该面有冻结兼容套件），收益为零。
- **备选**（不采）：在 `@nomicore/ws-replication` 包内加 plain-HTTP 面——违反「plugin 只拥有
  listener/dialer/复制资源」边界（ADR 0012、包 AGENTS.md），且 REST 分流是 server 职责
  （ADR 0015 L32）。

### D2 / H2 仲裁：`NomicoreApp.registry` 观测面（**确认 H2 原案，类型按事实收窄**）

- `NomicoreApp` 增加只读属性：

  ```ts
  readonly registry: NamespaceRegistry | undefined;
  ```

  实现为 `publicFace()` 上的 getter（委托 `handle.registry` 私有字段，即 boot 时
  `requireNomicoreRegistry(ctx)` 的同一实例）：registry fiber 就绪前/启动失败时为 `undefined`；
  就绪后**终生同一实例**（构造注入 REST router 的就是该字段，构造后无任何再赋值路径——AC1「不运行
  时替换」）；`stop()` 后不清空（`getStatus().state === 'stopped'` 可观测，T3 ⑥）。
- 类型取 `| undefined` 而非裸 `NamespaceRegistry`：getter 在 ready 前返回 `undefined` 是事实语义，
  诚实类型优于「ready 前抛错」的敌对面。SA6 `appRegistry()`（结构窄化
  `{ readonly registry?: NamespaceRegistry }`）与该形状**结构兼容**——契约测试零字节改动，
  不触发修订轮（SA6 §15「等价但不同名须适配」条款不适用：名称与语义均按原案；SA2 §5-H2 已源码级
  复核 contract-support.ts:220-222）。
- **备选**（不采）：暴露模块句柄（如 `app.rest`/`app.ws`）——观测面宽于 AC1 需要，泄露内部装配；
  **备选**（不采）：方法 `getRegistry()`——与 `ready/stop/sink` 的属性面风格不一致，且 SA6 契约
  的结构读取以属性为准。

### D3 / H1 仲裁：hub listener 默认承载 REST route family，raw path 分流（**确认 H1 原案**）

- **零新增配置键**：hub 角色无条件构造 REST router 并挂载 plain-HTTP 分流（issue 文本「server 先按
  raw path 选择 REST 与 WebSocket route family」为无条件句）；peer 无 listener、不构造 REST 面。
  不提供 opt-out 开关（无需求来源；后续票如需再加可选键，属加法）。
- **raw path 分流规则**（plain 普通请求，`handlePlain` 内）：
  1. 若 `stopRequested === true` → 503（intake 已停，见 D4；不进入任何 route family。**定性：server
     transport 层拒绝，非 router 错误契约成员**——收敛义务见 §13「FR-3 表面收敛义务」，F4/R2）；
  2. REST family 优先：构造标准 Web `Request` → `restRouter.handle(request)`：
     - `matched:true` → 把 `Response` 写回 `ServerResponse`（201/405/403 均此路）；
     - `matched:false` → 回落到 listener 自有路由：`GET /healthz` → 200 `'ok\n'`；其余 →
       404 `'not found\n'`（与现行 ws-server.ts:161-169 **逐字节一致**——判定保持
       `req.method === 'GET' && req.url === '/healthz'` **精确等值语义，含 query-string 行为**
       （`/healthz?x=1` 现状即 404，实现必须保持；行为测试例 4 锚定——SA2 O1）——N3/T2 的
       404/healthz 断言与既有面零漂移）；
  3. upgrade 请求维持现状：仅 `options.path`（`/replication`）走 WS family，其余 404/401/403/503
     （ws-server.ts:173-227 不改语义）——REST path upgrade 404、未知 path upgrade 404 均为现状。
- **实现 seam**：`startHubWsServer` 选项增加可选 `handleRequest?: (req, res) => void`；存在时普通
  请求完全委托该钩子，否则走原 `/healthz`+404 路径（默认路径字节不变——`node-hub-peer-live` /
  `ws-server-upgrade-admission` 等直用 adapter 的测试零影响）。app-owned
  `createHubListenAdapter(options?: { handleRequest? })` → `createNodeHubListenAdapter(observer?,
  handleRequest?)` 透传。`HubListenAdapter` 包契约（plugin.ts:63-71）**零改动**。
- **Request 适配**：`new URL(req.url ?? '/', 'http://localhost')` 为 URL（router 只消费 pathname，
  authority 不参与路由）；method/headers 直传；**body 以流透传**（`Readable.toWeb(req)` +
  `duplex:'half'`），适配层**不预读 body**——body 读取策略（未来的 limits/signal）必须留在 router
  内单一位置（FR-1 加法前提）。无 body 方法（GET/DELETE/…）传 `body: undefined`。
- **Response 适配**：`response.arrayBuffer()` → `res.writeHead(response.status, headers)` →
  `res.end(buffer)`；写失败（socket 已亡）静默收口并结束该请求的 in-flight 记账。
- **备选**（不采）：适配层先缓冲完整 body 再构造 Request——会剥夺 router 的 body 读取单一策略位，
  FR-1 落地时必返工；**备选**（不采）：为 REST 另起独立 listener/端口——违反「同一 listener raw
  path 分流」的 issue 文本与 ADR 0015 L32。

### D4 / H3 仲裁：停止顺序语义（**确认 H3 原案，补两个缺口③的具体机制**）

停机链（`performStop()` 修订；步骤号与 §8 停机状态机**一一对应**——O4 对齐）：

0. `stopRequested = true`（同步，`stop()` 入口）——此后到达的普通请求在 `handlePlain` 入口被 503
   拒绝（**intake 门 A**：防 listener close 前的微窗内既有 keep-alive 连接塞入新请求；503 定性
   见 D3 规则 1 与 §13 FR-3 登记）；
1. `hubListener.close()`（同步关 listening socket——新 TCP 连接 ECONNREFUSED，**intake 门 B**；
   测试以 `agent:false` 独立连接观测为 status 0，双门兜底使竞态窗内也 ≥400）；
2. `await hubService.stop()`（WS：1001 `'hub-shutdown'`；包内**一次完成** protocol §21 ② 已接纳
   apply 排空 + ③ closeSessionAndRelease（close session → release lease）+ Runtime barrier——
   见 §6 §21 投影行；集成层不重排包内次序，A1）；
3. `await listenerClosed` → `peerService.stop()`（若有）；
4. **新增**：`await this.restHost?.drain(REST_DRAIN_BUDGET_MS)`——等待**已接纳**（`handlePlain`
   入口已登记 in-flight）REST 工作结算。
   - **F2 守卫（boot 窗口）**：`restHost` 在 `bootHub` 中段才构造（registry fiber 就绪、provision
     完成后、hub plugin listen 前，§8 装配序），而 `main.ts` 在 `createNomicoreApp` 返回后即挂
     SIGTERM/SIGINT（main.ts:210-212）、boot 首个 await 已让出事件循环（C11）——停机请求落于
     boot 窗口时 `this.restHost === undefined`。**optional chaining 使该步跳过**、`stop()` 干净
     结算（`app-stopped`，无 `app-stop-failed`→exit 0）——与同函数既有守卫纪律
     （`this.hubListener?.close()`、`hubService !== undefined`、`registry !== undefined` 等，
     app.ts:414-453，C11）一致，保持现行「boot 窗口早停干净退出」行为零回归；回归锚 =
     `rest-hosting-behavior.test.ts` 例 3（§12）。restHost 于 boot 成功后终生非 undefined
     （构造一次冻结），该守卫不掩盖运行期不变量缺失——运行期 drain 缺失属正常路径不变量缺失，
     由 fail-loud 面（构造/注入错误）与契约测试覆盖。
   - 预算 `REST_DRAIN_BUDGET_MS = 10_000`（模块常量，**不加配置键**——H1 零配置面的最强形态；
     上有 main.ts 60s watchdog、下与 N2 无 in-flight 时即时返回兼容）。超时 → 对剩余 in-flight
     逐个 abort（销毁对应请求 socket，使挂起的 body 读取以流错误结算、客户端得到传输层失败——
     诚实失败，不无限等待）后即继续；迟到结算为 no-op；
5. sink `replication-drained`（语义扩为「intake 已停 + 已接纳 REST/WS 工作已 settle + 会话/租约已
   释放」——恰为 ADR 0015 L210 停机句的事件投影；无既有测试断言该事件排除 REST——SA2 O6 复核）；
6. `await registry.shutdown()`（同步停接纳 + 等已接纳 lifecycle 槽结算 + 关全部 Runtime——若
   REST create 已过 body 读取进入 `registry.create`，本步是其第二道结算保障）→ sink
   `registry-stopped`；
7. 之后与现行完全一致：diagnostics O(1) close → `diagnostics-closed` → file 排空窗 →
   `persistenceFiber.dispose()` → `persistence-disposed` → `ctx.fiber.dispose()` → `app-stopped`。

- **接纳判定**（与 T3 的 admission 锚对齐）：普通请求的接纳 = Node 触发 request 事件并调用
  `handlePlain`（`Expect: 100-continue` 且无 `checkContinue` 监听时，Node 自动回 100 Continue——
  SA6 已实测「100 到达 ⟺ 头已解析并接纳」）。`handlePlain` 入口登记 in-flight（含 /healthz/404
  等全部普通请求——统一记账，且这些路径同步完成、零排空成本）；响应写回完成时注销。
- **单链与幂等**：drain 在 `performStop()` 内单点调用；`stop()` 单飞（stopPromise）不变——二次
  `stop()` 返回同一 Promise，不产生第二条链（N2）。
- **备选**（不采）：无界等待已接纳 REST 工作——客户端永不发 body 时违反 N2 的 15s 有界断言与
  ADR 0011 L129 的有界精神；**备选**（不采）：把排空放在 `replication-drained` 之后——事件语义
  与 ADR 0015 L210「等待已接纳工作…再 shutdown」的先后颠倒，M5 类变异将无法区分；
- **备选**（不采）：排空实现在 ws-replication 包内——REST 工作记账是 server 资源（ADR 0015 L32
  「graceful drain」属 server），包不感知 REST。
- **备选**（不采，F2）：`if (this.restHost !== undefined) { await this.restHost.drain(...) }`
  显式分支——与 optional chaining 等价，取 `?.` 以贴合同函数既有写法；无论何种写法，核心是
  **未构造 ⇒ 跳过且不抛**，而非把 restHost 提前构造到 boot 起点（那会让 REST family 在 registry
  fiber 就绪前接管 plain 面，引入「listener 已挂而 Registry 未就绪」的新中间态）。

### D5：observer 显式注入（SA8 A2）

`bootHub()` 构造点：

```ts
const restRouter = createRestRouter({
  role,                                  // D6：来自 Instance service
  registry: this.registry,               // D1/D2：同一引用
  metricsObserver: () => {},             // 显式 no-op（本版 router 零事件发射）
  diagnosticObserver: () => {},          // 显式 no-op；FR-4 事件契约票替换
});
```

显式 no-op 是 ADR 0015 L186 认可的显式决定；不预发明事件形状。漏注入由 `createRestRouter` 构造期
`TypeError` → `boot()` reject → `ready` reject（fail loud；M4 已证 7/7 启动点红）。

### D6：role 单真相（M6 敏感项）

`bootHub()` 内 `const role = requireNomicoreInstance(this.ctx).role`（Instance service 是
`instanceId + role` 唯一生产来源——`packages/instance/src/index.ts` `Instance` 接口；app 在 boot
起点已 apply Instance plugin），读出后注入 router。**备选**（不采）：直接用 `this.config.role`——
值等价但绕开了 ADR 0012 的单真相纪律面，且与 ws-replication plugin 的取值路径（同样经
`requireNomicoreInstance`）形成第二来源观感。

### D7：包导入路径（C10 解析约束）

`app.ts` 从**包根入口** `@nomicore/namespace-api` 导入 `createRestRouter`（`src/index.ts` 与
`./rest` 子路径同面——包 AGENTS.md/`index.ts` 头注均确认两面等价）。理由：根 `vitest.config.ts`
alias 只覆盖 `@nomicore/<pkg>` 根入口与显式 `/testing`、`/internal` 子路径，`namespace-api/rest`
无 alias 且包无 `dist`——子路径导入在 vitest 下解析不可靠；根导入命中 alias 规则
（`vitest.config.ts:11`），typecheck 经 `customConditions` 同样成立。`apps/yjs-server/package.json`
增加 `"@nomicore/namespace-api": "workspace:*"` 依赖（连动 `pnpm-lock.yaml` importers 段）。
`requireNomicoreInstance` 取自已在依赖中的 `@nomicore/instance`（instance/src/index.ts:39 公共导
出——SA2 §5-C8 复核），无需新增依赖项。

### D8：rejection 的 server 侧处置（临时占位，不预发明 problem shape）

骨架契约：未映射结局以 rejection 结算、不产生 HTTP 错误 Response（`rest.ts` 头注/create-namespace.ts）。
server 侧必须给 rejection 一个诚实结局，不得静默回落 404（那会把「路由已匹配但失败」伪装成「无此
路由」——被禁止的静默 fallback）：

- `handle` rejection → 记账 in-flight 结束 + sink 事件 `rest-request-failed`（app 自有 NDJSON 面，
  携带 `message`；与 `app-stop-failed` 同族的 app 级事件，非包契约）→ 回
  `500` `text/plain` `internal error\n`。
- 正文刻意**不用** JSON problem shape——ADR 0015 L165–178 的最终 500 `INTERNAL_ERROR` 映射属
  FR-3；本占位与之无冲突（FR-3 落地时以**加法替换**，收敛登记见 §13「FR-3 表面收敛义务」(b)——
  F4/R2）。
- 契约测试不触达该路径（T2/T3 只走 matched 成功/判别路径）；行为测试落位
  `apps/yjs-server/test/rest-hosting-behavior.test.ts` 例 1（§11/§12——F3）。

## 8. 接口、状态机和数据流

### 装配序（bootHub 增量，其余不变）

```
Instance plugin → clock → timer → persistence → diagnostics? → registry fiber
→ this.registry = requireNomicoreRegistry(ctx)              [既有]
→ role = requireNomicoreInstance(ctx).role                  [新，D6]
→ restRouter = createRestRouter({role, registry, noOp, noOp}) [新，D5]
→ restHost  = createRestHosting({restRouter, isStopping, onRejection}) [新]
→ listenAdapter = createHubListenAdapter({handleRequest: restHost.handle}) [签名扩展]
→ hub plugin install（listener 就绪，single listener 双 route family）
→ sink listening / ready                                   [既有]
```

REST router 与 restHost 均**构造一次、终生冻结**（无重建/替换路径）。app 以私有字段
`restHost: RestHosting | undefined` 持有——**boot 窗口为 `undefined`**（与
`hubService`/`hubListener`/`peerService` 同款可选生命周期，C11），停机链以 optional chaining 消费
（§7-D4 步 4，F2）。peer 路径（`bootPeer`）零改动。

### 新模块：`apps/yjs-server/src/rest-hosting.ts`

```ts
export interface RestHostingOptions {
  readonly restRouter: RestRouter;
  /** 停机门：true 时新普通请求 503（intake 已停）。 */
  readonly isStopping: () => boolean;
  /** router.handle rejection 的观测回调（app 注入 sink 事件；回调 throw 被隔离）。 */
  readonly onRejection: (error: unknown) => void;
}
export interface RestHosting {
  /** plain HTTP 总入口：REST family 优先 → /healthz → 404；内含 intake 门与 in-flight 记账。 */
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** 有界排空：等已接纳请求结算；预算尽则 abort（销毁 socket）后返回。幂等（二次调用 no-op）。 */
  drain(budgetMs: number): Promise<void>;
}
export function createRestHosting(options: RestHostingOptions): RestHosting;
```

内部：`Set<{ settled(): void; abort(): void } >`（每请求一项：promise + `req.socket.destroy()`）；
`handle` 以 `void (async …)()` 包裹异步主体（EventEmitter 上下文不外抛）；`onRejection` 回调
try/catch 隔离（观测不改变结果——与 ws-server `notifyAdapter` 同纪律）。

### ws-server.ts 增量（最小）

- `HubWsServerOptions` 增加 `readonly handleRequest?: (req: IncomingMessage, res: ServerResponse) => void`；
- `createServer((req,res) => { if (options.handleRequest !== undefined) { options.handleRequest(req,res); return; } /*原 /healthz + 404*/ })`；
- `createNodeHubListenAdapter(observer?, handleRequest?)`、`createHubListenAdapter(options?)` 透传；
  缺省路径逐字节保持。

### 停机状态机（performStop 修订版；步骤号与 §7-D4 一一对应）

| 步 | 动作 | 可观察结果 | 证据/契约 |
|---|---|---|---|
| 0 | `stopRequested=true`；单飞 stopPromise | 新普通请求 → 503 | D4 门 A；T3 ④ |
| 1 | `hubListener.close()`（同步） | 新 TCP 连接 ECONNREFUSED | C3/C6；T3 ④（status 0） |
| 2 | `await hubService.stop()` | WS 1001 `'hub-shutdown'`；包内一次完成 §21 ② apply 排空 + ③ session→lease 收口 | C6/C9；T3 ⑤、A1、§6 §21 投影 |
| 3 | `await listenerClosed`；`peerService.stop()`（若有） | — | C6 |
| 4 | `await this.restHost?.drain(10_000)`（**F2 守卫**：boot 窗口 `restHost === undefined` ⇒ 该步跳过，不抛） | 已接纳 REST create 完成 201；超时者 socket 销毁；boot 窗口早停干净结算 | **新增**；T3 ③、C8/C11；行为测试例 2/例 3 |
| 5 | sink `replication-drained` | 事件序锚 | T3 ⑥ |
| 6 | `await registry.shutdown()` | `getStatus().state==='stopped'` | C7；T3 ⑥ |
| 7 | diagnostics close → `diagnostics-closed`；file 排空窗 → `persistenceFiber.dispose()` → `persistence-disposed`；`ctx.fiber.dispose()` → `app-stopped` | 单链五事件各恰一次、严格递增 | C6；N2 |

### 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| R1 REST create（运行期） | HTTP 客户端 `POST /v1/owners/{owner}/namespaces`（JSON body） | `handlePlain` 登记 in-flight → Web Request（流 body）→ `restRouter.handle` → `orchestrateCreateNamespace` → `deriveSchemaIdentity`（`sc1-`）→ `registry.create({owner,schema,root})`（**共享 Registry 实例**） | node req → Web Request（transport 边界，单跳进程内）；DTO 复制冻结（release 前） | Persistence `createDoc`（file: debounce/maxDirty 调度）→ `lease.release()`（恰一次）→ 201 Response → ServerResponse → 客户端 | T1-A `appRegistry().open+readData`；T3 ⑦ 重启读回 | 201 + `namespaceId`（`^ns-[0-9a-f]{32}$`）；`registry.getStatus()==='running'` | rejection → `rest-request-failed` + 500；`release()` 失败仍 201（包内既有）；in-flight 记账于响应完成时注销 | T1-A/T2 |
| R2 WS 复制（**零改动**） | peer/raw WS 客户端 upgrade `/replication` | 包内 channel/session（经 Lease） | upgrade 认证（Bearer 前置）→ HELLO/OPEN/BOOTSTRAP 帧 | 同一共享 Registry 的 Runtime/同一 write sequencer | T1-B bootstrap 快照 | `ROOT.n===99`（app registry lease 写入经 WS 可见） | 1001 clean close 于停机；包内既分类 | N1/T1-B/T3 ⑤ |
| R3 有序停止 | `stop()`/SIGTERM/控制通道 shutdown | §8 停机状态机各步 | intake 门（503/ECONNREFUSED）→ WS drain（包内 ②③）→ REST drain（新，步 4）→ registry → persistence | file 排空窗（maxDirtyMs+margin）保证 R1 提交落盘 | sink 事件链 + `registry.getStatus()` | `replication-drained < registry-stopped < persistence-disposed < app-stopped`；重启可读回 | 任一步 throw → `app-stop-failed` + rethrow（现行）；drain 超时 → socket abort（诚实传输层失败）；boot 窗口 drain 步跳过（F2） | T3/N2 |
| R4 停机期新请求 | 停机发起后的 HTTP 客户端 | intake 门 A（503）/门 B（ECONNREFUSED） | — | — | 客户端 | 非 201；status 0 或 ≥400 | 不登记 in-flight（未接纳） | T3 ④ |
| R5 boot 窗口早停（F2） | boot 任一 await 边界期间的 SIGTERM/SIGINT/控制通道 shutdown | `performStop` 全守卫链（`restHost === undefined` ⇒ 步 4 跳过） | C11：boot 各边界 `stopRequested` 早退 + 停机链 optional 守卫 | — | sink 事件链 | 干净 `app-stopped`（无 `app-stop-failed`）；main.ts exit 0 | 守卫缺失将致 TypeError → `app-stop-failed` → exit(1)（被 F2 修复排除） | 行为测试例 3 |

## 9. 错误、恢复、并发和幂等

- **rejection（router 未映射结局）**：500 占位 + `rest-request-failed` 事件（D8）；进程不因请求路径
  异常退出（`handle` 异步主体全路径收编；响应写失败静默——socket 已亡）。
- **客户端断连**：req 流错误 → `request.json()` rejection → 同 500 路径（写回失败被吞）→ in-flight
  注销。不产生半提交（registry.create 未过接纳即无副作用；已过接纳则由 registry 自身语义收口）。
- **drain 超时**：abort 销毁 socket → 客户端传输层失败（诚实）；已进入 `registry.create` 的在途槽由
  `registry.shutdown()` 的「等已接纳 lifecycle 槽结算」二次保障（C7）——不重复实现。
- **boot 窗口早停（F2，并发）**：`restHost` 未构造 ⇒ drain 步经 optional chaining 跳过，`stop()`
  干净结算、不产生 `app-stop-failed`——与现行早停行为（boot 中途 stop → 干净 `app-stopped`、
  main.ts exit 0）零回归；守卫纪律与同函数既有 optional 面（C11）一致。
- **幂等**：`stop()` 单飞（same-Promise）；`drain()` 幂等（二次 no-op）；`restRouter` 零状态
  （构造冻结）；`NomicoreApp.registry` getter 恒等实例。
- **并发**：并发 REST create 互不在 router 层串行（router 无队列/锁——包契约），由 Registry 的
  per-key FIFO 维持不变量；REST 与 WS 写共享同一 write sequencer（AC1 的运行期兑现，T1-B 行为证明）。
- **503/500 占位与 FR-3 的收敛义务（F4/R2）**：intake 门 503 定性为 server transport 层拒绝（非
  router 错误契约成员）；rejection→500 占位由 FR-3 加法替换——完整登记见 §13「FR-3 表面收敛
  义务」。
- **正常路径不变量缺失 → fail loud**：组合根漏注入 observer/漏传 registry → 构造期 TypeError →
  `ready` reject（无静默降级）；观测面缺失已由红灯契约证明可检测。F2 的 optional chaining 不是
  正常路径 fallback——boot 窗口 `restHost === undefined` 是 C11 记录的事实生命周期（与
  `hubService` 等同款），运行期（boot 成功后）drain 缺失不会被静默吞掉。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `apps/yjs-server/src/main.ts` | 消费 `ready/stop/sink/handleControlLine` | 同左；`registry` getter 为加法；60s watchdog 已覆盖含 drain 的停机链；boot 窗口 SIGTERM → 停机链全守卫（含 drain 步跳过），早停行为与现行一致 | **零改动** | main.ts:67-87,200-218、C11 |
| hub plugin（经 `createHubListenAdapter`） | adapter 无 plain-HTTP 面 | adapter 可选携带 `handleRequest`；缺省行为不变 | ws-server.ts 签名加法（上文 §8） | C4、ws-server.ts:289-312 |
| `createNodeHubListenAdapter`/`startHubWsServer` 直接消费者（测试 `node-hub-peer-live`、`ws-server-upgrade-admission`、`ws-replication-issue190-sa7-real-transport`） | 不传新参数 → 原 `/healthz`+404 路径 | 逐字节不变 | **零改动** | 测试 grep §2/C3 |
| `NomicoreApp` 消费者（app 测试套件、SA6 契约） | 公共面 4 成员 | +`registry`（加法；无既有测试断言键集合封闭） | **零改动**（SA6 `appRegistry()` 即取该面） | C2、issue270-contract-support.ts:220-222 |
| `registry.shutdown()`（`performStop` 调用） | WS drain 后调用 | 位置不变，前置新增 REST drain（boot 窗口跳过） | app.ts 单点 | C6/C7/C11 |
| WS plugin / packages/* | — | 零触达 | **零改动** | §11 DENY |
| 遗留 `createYjsHubServer` 消费者（公共兼容套件） | 404 占位 | 保持 | **零改动** | index.ts:46-48,154-158 |

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `apps/yjs-server/src/app.ts` | `NomicoreApp`/`publicFace` 增加 `registry` getter；私有字段 `restHost: RestHosting \| undefined`；`bootHub` 构造 restRouter/restHost 并把 `handleRequest` 传入 `createHubListenAdapter`；`performStop` 在 `replication-drained` 前插入 `this.restHost?.drain(REST_DRAIN_BUDGET_MS)`（F2 守卫）；新增 `rest-request-failed` sink 事件与 `REST_DRAIN_BUDGET_MS` 常量；新增 `@nomicore/namespace-api`、`@nomicore/instance`（`requireNomicoreInstance`）导入 | AC1 观测面（D2）、AC1/AC2 装配（D1/D3/D5/D6）、AC3 排空（D4，含 boot 窗口守卫）、rejection 观测（D8） |
| `apps/yjs-server/src/rest-hosting.ts`（新增） | plain-HTTP 总入口（intake 门 + REST 优先 + /healthz/404 回落 + in-flight 记账/abort + drain） | D3/D4/D8 的承载模块；bridge 与记账同点内聚 |
| `apps/yjs-server/src/transport/ws-server.ts` | `HubWsServerOptions.handleRequest?` + createServer 委托 + `createNodeHubListenAdapter`/`createHubListenAdapter` 透传；缺省路径不变 | D3 的 listener 注入面（app-owned 层，包契约零改动） |
| `apps/yjs-server/package.json` | dependencies 增加 `"@nomicore/namespace-api": "workspace:*"` | D7 导入解析 |
| `pnpm-lock.yaml` | workspace 依赖增量（importers 段） | package.json 连动 |
| `apps/yjs-server/AGENTS.md` | 一句式补充（**措辞与 §8 实际执行序一致——F1/R1 约束**）：hub listener 经 raw-path 分流承载 REST route family（REST 优先，`matched:false` 回落自有 `/healthz`+404；upgrade 维持 `/replication` 单一门）；停机链在包级 WS 停机（`hubService.stop()` 内完成已接纳 apply 排空 + close session → release lease）**之后**、`registry.shutdown()` 之前插入「已接纳 REST 工作有界排空」（`restHost?.drain`，boot 窗口未构造时跳过）——**不得**表述为 REST 排空先于包内 session/lease 收口或归入 §21 ②；**不得**把 503/500 占位 body 形状写成终态契约（F4/R2(c)） | docs AGENTS「代码行为变化须同步规范文档」+「documentation-only wording changes must not invent implementation behavior」；app AGENTS 单链表述保持真确 |
| `apps/yjs-server/test/rest-hosting-behavior.test.ts`（新增，**非 issue270 命名**） | 行为测试四例：(1) D8 rejection→500 + `rest-request-failed` 恰一次（canonical path 畸形 JSON body）；(2) D4 drain 超时——admitted 请求不发 body → `stop()` 在预算+余量内完成且该连接被销毁；(3) F2 boot 窗口早停——不 await `ready` 即 `stop()` → `stop()` resolve、无 `app-stop-failed`、事件链收敛 `app-stopped`；(4) O1 回落精确匹配——`GET /healthz?x=1` → 404（`req.url === '/healthz'` 精确等值语义含 query 行为） | F3：§12 引用的行为测试合法落点（SA6 冻结契约不覆盖 D8/F2/O1 面）；非 issue270 命名使 DENY 冻结 glob 零例外、SA3/SA4 无歧义执行 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/namespace-api/**` | REST router 骨架与 SA6 冻结契约套件 | #267 已交付且够用；包 AGENTS 禁止为适配实现改契约测试；本票零包改动（SA8 gate「零契约变更」） |
| `packages/ws-replication/**` | A1 次序（`closeSessionAndRelease`）所有者 | 集成层只消费不重排（C9）；改包扩大爆炸面 |
| `packages/namespace-registry/**` | shutdown 语义提供方 | `REGISTRY_NOT_ACCEPTING`/已接纳槽结算是被消费的既有契约（C7） |
| `apps/yjs-server/src/main.ts` | 生产入口 | 无需改动（§10）；watchdog 已覆盖 |
| `apps/yjs-server/src/index.ts` | 公共导出面（含遗留 `createYjsHubServer`） | 无导出变化需求；遗留面 H4 出范围 |
| `apps/yjs-server/test/issue270-*.ts` | SA6 冻结验收契约（3 文件哈希见 SA6 §13.4） | 修订须走 SA6 修订轮；本设计不触发（H1–H4 按原案确认，`appRegistry()` 结构兼容）。**F3 裁决**：新增行为测试采用非 issue270 命名（`rest-hosting-behavior.test.ts`，已在 ALLOW），本 glob 含义不变 = 冻结三文件，零例外 |
| `wiki/raw/task_issue-270_sa6_*`、`task_issue-270_sa8_gate.md`、`task_issue-270_sa8_recheck.md`、`task_issue-270_sa2_review.md`、`task_issue-270.md` | 上游证据 | 只读输入 |
| `vitest.config.ts` | 测试解析配置 | D7 以根导入规避；仅当实现证明解析仍失败时才经修订轮显式加 alias |
| `docs/adr/**`、`CONTEXT.md`、`docs/protocols/**` | 决策基准 | 本票零契约变更（SA8 gate/recheck）；不因实现改决策文档 |

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 共享引用（REST 侧） | 红灯 T1-A（SA6 §5） | 既有 `issue270-server-integration-red.test.ts` T1-A（实现后转绿，测试字节不变） | 201 → `appRegistry()` open/readData 读回 ROOT；第二 Registry `NAMESPACE_NOT_FOUND`；二次 create 后观测面恒等 |
| AC1 共享引用（WS 侧行为证明） | 红灯 T1-B | T1-B | app registry lease `mutateData(n=99)` → WS BOOTSTRAP_SNAPSHOT `ROOT.n===99` |
| AC2 raw path 分流 | 红灯 T2 + 恒绿 N3 | T2 + N3 | canonical POST 201 / GET 405+`Allow: POST` / 非 canonical 404 / `/replication` 普通 404 / `/healthz` 200 / upgrade 101 / REST-path upgrade 404 / 无凭据 401 / 错凭据 403 |
| AC3 有序停止 | 红灯 T3（含 `REGISTRY_NOT_ACCEPTING` 因果，SA6 §8） | T3 | 已接纳 create drain 期 201；停后新请求 status 0 或 ≥400；WS 1001；事件链严格递增；`state==='stopped'`；同 rootDir 重启读回 |
| AC4 WS 独立 | 恒绿 N1 | N1（保持绿） | 零 REST 请求下 bootstrap + 双向收敛 |
| SA8 A3 有界/单链 | 恒绿 N2 | N2（保持绿） | stop() < 15s；五事件各恰一次且递增 |
| D3/D8 rejection 处置 | 无（骨架不产生 Response；契约不触达） | `apps/yjs-server/test/rest-hosting-behavior.test.ts`（ALLOW 已列）**例 1**：canonical path 提交畸形 JSON body | 500 + `rest-request-failed` 事件恰一次；进程存活；后续请求不受影响 |
| D4 drain 超时路径 | 无（T3 只测及时结算） | 同文件**例 2**：启动 hub → `openAdmittedRequest` 不发 body → `stop()` | 有界停机（10s 预算+余量内）；客户端传输层失败；`app-stopped` 恰一次无缺失/重复 |
| F2 boot 窗口早停 | 无（现行早停行为无专测；契约测试先 await ready 再 stop，不触达该窗口） | 同文件**例 3**：`createNomicoreApp` 后不 await `ready` 即 `stop()`（模拟 SIGTERM 于 boot 窗口） | `stop()` resolve（不 reject）；`app-stop-failed` 不出现；事件链干净收敛 `app-stopped`（drain 步跳过不致 TypeError） |
| D3 回落精确匹配（O1） | 现行面（ws-server.ts:162 `req.url === '/healthz'`） | 同文件**例 4**：`GET /healthz?x=1` | 404（与现行精确等值语义逐字节一致，含 query-string 行为） |
| 回归面 | SA6 §14：全 app 套件 30 文件/162 例（排除本票契约）全绿；`#229` 为既有时序 flake（单独 3/3 绿） | `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck apps/yjs-server/test`；`tsc -p apps/yjs-server/tsconfig.json`；根 `pnpm typecheck`/`pnpm test` | 全绿（`hub-restart-static-target-red` 若现 `expected 'ready' to be 'backoff'` 按 SA6 §14 三角验证归 #229，不归本票）；typecheck 0 错 |

## 13. 风险、回滚和残余问题

| 风险 | 等级 | 缓解 | 残余 |
|---|---|---|---|
| `@nomicore/namespace-api` 导入解析（C10） | 低 | D7 根入口导入命中既有 alias；typecheck `customConditions` 已覆盖 | 若实现期仍遇解析失败 → 修订轮加 vitest alias（DENY LIST 已注明例外路径） |
| 100-continue 接纳判定依赖 Node 自动 continue 行为 | 低 | SA6 绿灯模拟已实测该机制（§9-E1）；契约以 100 到达为 admission 锚 | Node 大版本行为变化时契约自身会红灯（可检测） |
| body 读取无界（受信网络限制） | 中（已文档化） | ADR 0015 L36/包 AGENTS 明示首版受信暴露；drain 预算约束停机面 | FR-1 limits 票收口（follow-up，非本票必要条件） |
| boot 窗口停机竞态（restHost 未构造即 `stop()`，F2） | 低 | 停机链步 4 optional-chaining 守卫（与同函数既有纪律一致，C11）+ 行为测试例 3 锚定 | 无（F2 已闭合；boot 成功后 restHost 终生非 undefined，运行期无静默跳过） |
| `replication-drained` 语义扩宽 | 低 | 无测试断言其排除 REST（SA2 O6 复核）；事件名不变；AGENTS.md 措辞随 F1 约束同步 | 无 |
| 新公共面（`NomicoreApp.registry`、`rest-request-failed` 事件、`handleRequest` 钩子、REST drain 生命周期步）触碰 ADR 冻结面的邻接区 | 低（已复核） | SA8 设计后复审（`task_issue-270_sa8_recheck.md`）5/5 复查面 no-conflict；本轮修订未触发其重开条件（§15） | 无 |
| 回滚 | 低 | 撤销 ALLOW LIST 七文件改动即回到 HEAD（红灯契约自动回到红态）；无 schema/wire/持久化格式变化 | 无 |

### FR-3 表面收敛义务登记（F4 / SA8 recheck R2）

同一 listener 将出现两个 503 来源与一个 500 占位；FR-3（错误契约票）落地时必须按下述登记收敛，
防止占位被误当终态契约固化进规范文档：

- **(a) intake 门 503**（`text/plain`，停机期新请求拒绝）定性为 **server transport 层拒绝**，
  非 router 错误契约成员（与 router 未来 `REGISTRY_NOT_ACCEPTING` problem-shape 503 分属两层，
  §7-D3 规则 1/§8 步 0）。FR-3 落地时二选一收敛：采用 problem shape，**或**显式登记该 transport
  层定性（由 FR-3 票裁定，非本票预发明）；
- **(b) rejection→500 占位**（D8）由 FR-3 `INTERNAL_ERROR` problem shape **加法替换**（本设计已
  声明，FR-3 落地前保持 `text/plain` 占位）；
- **(c) `apps/yjs-server/AGENTS.md` 一句式补充不得把上述占位 body 形状写成终态契约**（§11 ALLOW
  行措辞已受本条与 F1 约束）。

**任务内不解决的必要条件**：无。follow-up（非本票）：FR-1/FR-3/FR-4（limits、错误契约、observer
事件）、peer REST listener（若出现）、REST owner authorization、drain 预算可配置化（出现真实需求
时）、matched 早返回不消费 body 的 keep-alive socket 处置（SA2 O2——405/403 在 body 读取前返回，
带 body 的非 POST 请求在 keep-alive 连接上可能由 Node 销毁/滞留 socket；随 FR-1
limits/`Request.signal` 票登记，非本票义务——drain 记账以响应写回完成结算，停机面不受影响）。

## 14. 评审修订映射

评审输入：`wiki/raw/task_issue-270_sa2_review.md`（iteration 0 设计的攻击评审，verdict `reject`：
MAJOR F1–F3 + MINOR F4）。逐条落实：

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **F1（MAJOR）** §6 protocol §21 梯子投影行与 §7-D4/§8 矛盾（把 REST 排空归入 ②、置于 ③ 之前）；AGENTS.md 一句式若照抄将把实现不具备的次序写进规范文档 | §6 §21 投影行按实际执行序重写（「②③（WS 包内）由 `hubService.stop()` 一次完成；server 级 REST 排空在 ③ 后、④ 前插入，非梯子成员」）；§7-D4 步 2/步 4 与 §8 步 2/步 4 同款表述；§11 ALLOW AGENTS.md 行加同款措辞约束（含「不得表述为 REST 排空先于包内 session/lease 收口或归入 §21 ②」） | **已落实**：全文档（§5–§13）不再存在把 REST 排空置于包内 ③ 之前（或归入 ②）的任何表述；§8 本身次序未动（评审已确认其正确）；无决策语义变动；满足 SA8 recheck R1 |
| **F2（MAJOR）** §7-D4 步 4 / §8 步 4 `await this.restHost.drain(...)` 无守卫——boot 窗口（C11）停机将 TypeError → `app-stop-failed` → exit(1)，回归现行早停干净退出 | §2 新增事实锚 C11；§7-D4 步 4 改 `await this.restHost?.drain(REST_DRAIN_BUDGET_MS)` 并写明守卫理由与备选否决；§8 装配序/状态机步 4、§8 R5 数据流路线、§9「boot 窗口早停」条目、§10 main.ts 行、§12 行为测试例 3、§13 风险行 | **已落实**：设计文本含守卫表述且与同函数既有 optional-chaining 纪律一致；boot 窗口 `stop()` 不因 restHost 缺位 reject（行为测试例 3 锚定）；「未构造 ⇒ 跳过」补入并发/幂等清单（§9） |
| **F3（MAJOR）** §12 两处「建议补充」测试无 ALLOW 落点；`issue270-*` 命名落入 DENY 冻结 glob——设计自相缠绕 | §11 ALLOW 新增 `apps/yjs-server/test/rest-hosting-behavior.test.ts`（非 issue270 命名，DENY glob 零例外，DENY 行注明裁决）；§12 rejection/drain-超时两行落位该文件（例 1/例 2），并增例 3（F2）/例 4（O1） | **已落实**：§12 引用的每个测试路径均在 ALLOW；SA3/SA4 可无歧义执行（新文件名不与任何 DENY glob 相交） |
| **F4（MINOR）** intake 门 503 表面与 FR-3 收敛决策未登记（SA8 recheck R2 前置条件） | §13 新增「FR-3 表面收敛义务登记」(a)(b)(c)；§7-D3 规则 1 加 transport 层定性；D8 加 (b) 交叉引用；§11 AGENTS.md 行受 (c) 约束；§9 加占位收敛条目 | **已落实**：登记文字入正文与 follow-up 义务；满足 SA8 recheck 对 R2 的前置条件 |

非阻塞观察（SA2 §14）随行落实：O1（§7-D3 回落精确匹配语义显式化 + 行为测试例 4）、O2（§13
follow-up 登记 FR-1）、O4（§7-D4 步骤号 0–7 与 §8 状态机一一对应）、O6（§7-D4 步 5 措辞与 §8 一
致，已复核）；O3/O5 为确认性注记（公共面加法已过 SA8 复审、H2 兼容已源码级复核），无需动作。

## 15. 是否需要设计后 ADR 冲突复查及理由

**不需要（`requiresConflictRecheck: false`）**。理由：

1. iteration 0 §15 自报的四项增量面（公共 API：`NomicoreApp.registry`/`handleRequest` 钩子；
   生命周期：有界 REST drain 与 `replication-drained` 语义扩宽；H1–H4 仲裁；新 app 级事件
   `rest-request-failed`）**已由 SA8 设计后复审**（`task_issue-270_sa8_recheck.md`，verdict
   `clear`，5/5 复查面 no-conflict）逐面覆盖；该复审的 `requiresConflictRecheck: false` 前置
   条件（R1/R2 落实）恰由本轮 F1/F4 修订满足。
2. 本轮四项修订均为文字对齐（F1）、守卫补齐（F2——与 `performStop` 既有 optional 纪律同款，
   不新增生命周期所有权或失败语义，反而排除一个 TypeError 失败源）、清单增补（F3——新增测试
   文件不触任何生产契约）与登记义务（F4），未触发 SA8 recheck 所列任一重开条件：REST drain 仍在
   `registry.shutdown()` 之前（未移后）；Registry 未经任何 `@nomicore/*` 包公共面暴露；H1 未反转
   为 opt-in 配置键；`packages/*` 公共契约与 ws-replication 包内 close/release 次序零触碰；
   占位 503/500 未被写成终态契约（F4(c) 反向加固）；ADR 0015 状态未变。
3. SA2 评审 §2 同款裁定：三条 MAJOR 与一条 MINOR「均不改变架构面、不停机链次序语义（F1 恰是把
   文档改回 §8 已裁定的正确次序）」，其 `requiresConflictRecheck: false` 以 R1/R2（=F1/F4）落实
   为前提——本修订轮即该前提的兑现。
