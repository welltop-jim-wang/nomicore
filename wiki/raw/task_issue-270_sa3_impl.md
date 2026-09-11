# SA3 Implementation Report — issue #270：Server 集成验收（REST 与 WebSocket 共享 Registry + 有序停止）

> 阶段：implementation（iteration 0 —— 首次实现轮）。Dispatch：`sa-33fd87ef-705d-45b1-a740-2f034459a9ae`（mabf-sa3）。
> 依据：SA1 设计 `wiki/raw/task_issue-270_design.md`（iteration 1 修订轮，逐条落实 SA2 F1–F4）、
> SA2 评审 `wiki/raw/task_issue-270_sa2_review.md`（verdict `approve`，0 BLOCKER/MAJOR）、
> SA6 红灯契约 `wiki/raw/task_issue-270_sa6_contract.md`（verdict `approve`，冻结 3 文件）、
> SA8 门禁 `task_issue-270_sa8_gate.md` + 设计后复审 `task_issue-270_sa8_recheck.md`（均 `clear`）。
> Issue comments REST 快照（dispatch 前）= `[]`——无 Owner 追加要求。
> 基线：HEAD `0b06050`（branch `mabf/issue-270`）。SA3 未执行 commit/push/PR。

## Inputs consumed

| 输入 | 位置 | 用途 |
|---|---|---|
| 任务简报（Issue #270 body；comments `[]`） | `wiki/raw/task_issue-270.md` | AC1–AC4 口径 |
| SA1 设计（iteration 1 修订轮） | `wiki/raw/task_issue-270_design.md`（512 行，全文） | §7-D1–D8 决策、§8 装配序/停机状态机、§11 ALLOW/DENY、§12 行为测试四例、§13 FR-3 登记、§14 F1–F4 映射 |
| SA2 设计评审 | `wiki/raw/task_issue-270_sa2_review.md`（全文） | F1–F4 落实核验、O1/O7/O8 实现注记 |
| SA6 验收契约 + 红灯/绿灯/变异证据 | `task_issue-270_sa6_contract.md`（全文）、`task_issue-270_sa6_red.log` | 冻结断言语义；红灯基线；§13.4 哈希 |
| SA8 前置门禁 + 设计后复审 | `task_issue-270_sa8_gate.md`、`task_issue-270_sa8_recheck.md` | A1/A2/A3、R1/R2、5 条重开条件 |
| 冻结契约三文件（只读） | `apps/yjs-server/test/issue270-{contract-support,server-integration-red,regression-anchors}.ts` | sha256 逐字节核验（见 §Verification） |
| 源码基线 | `apps/yjs-server/src/{app,index,main}.ts`、`src/transport/ws-server.ts`、`packages/namespace-api/src/{rest,create-namespace,index}.ts`、`packages/instance/src/index.ts`、`vitest.config.ts`、根/应用 tsconfig、`pnpm-lock.yaml` | 事实锚 C1–C11 复核与实现 |
| decisions | `docs/adr/0015`（L18–32/L186/L210）、`docs/protocols/instance-replication-v1.md` §21、`apps/AGENTS.md`、`apps/yjs-server/AGENTS.md`、`packages/namespace-api/AGENTS.md` | 边界与停机次序 |

## Existing worktree reconciliation

- 实现开始前 `git status --short`：生产代码零改动（HEAD `0b06050`）；仅 SA6 契约 3 文件与
  `wiki/raw/*` 证据未跟踪；SA6 临时绿灯模拟件已逐字节回退（SA6 §16）。
- **无既有 `wiki/raw/task_issue-270_sa3_impl.md`、无未提交实现**——本轮为首个 SA3 实现轮，
  无「过时/冲突实现」需要修正或删除。
- `apps/yjs-server/test/rest-hosting-behavior.test.ts` 实现前不存在（SA2 §11 已核）；本轮新建，
  与 DENY glob `issue270-*.ts` 零相交。
- 冻结契约三文件在本轮全程零字节改动（哈希见 §Verification），deny 面（`packages/**`、
  `main.ts`、`index.ts`、`vitest.config.ts`、`docs/**`）零触达。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `apps/yjs-server/src/app.ts` | §7-D1/D2/D4/D5/D6/D8、§8 装配序/停机状态机、§11 ALLOW 行 1 | `NomicoreApp`/`publicFace` 增加 `registry` getter（`NamespaceRegistry \| undefined`）；私有字段 `restHost`；`bootHub` 以 Instance role + **同一** `this.registry` + 显式 no-op observer 构造 `restRouter`/`restHost`，并把 `handleRequest` 传入 `createHubListenAdapter`；`performStop` 在包级 WS 停机之后、`replication-drained` 之前插入 `await this.restHost?.drain(REST_DRAIN_BUDGET_MS)`；新增 `REST_DRAIN_BUDGET_MS = 10_000` 常量与 `rest-request-failed` sink 事件；新增 `@nomicore/namespace-api`/`requireNomicoreInstance` 导入；头注同步 |
| `apps/yjs-server/src/rest-hosting.ts`（新增，196 行） | §8 新模块、§7-D3/D4/D8 | plain-HTTP 总入口（intake 门 503 → REST family 优先 → `matched:false` 回落 `/healthz`+404，精确等值含 query）＋ in-flight 记账/abort ＋ 有界 `drain`（幂等）＋ rejection→观测+`500 text/plain` 占位 ＋ 观测 try/catch 隔离 |
| `apps/yjs-server/src/transport/ws-server.ts` | §8「ws-server.ts 增量（最小）」、§7-D3 | `HubPlainRequestHandler` 类型 + `HubWsServerOptions.handleRequest?` + `createServer` 委托；`createNodeHubListenAdapter(observer?, handleRequest?)` 与 `createHubListenAdapter(options?)` 透传；缺省 `/healthz`+404 路径逐字节不变（upgrade 面零改动） |
| `apps/yjs-server/package.json` | §7-D7、§11 ALLOW 行 4 | dependencies 增加 `"@nomicore/namespace-api": "workspace:*"` |
| `pnpm-lock.yaml` | §11 ALLOW 行 5 | `apps/yjs-server` importers 段增加 `@nomicore/namespace-api → link:../../packages/namespace-api` |
| `apps/yjs-server/AGENTS.md` | §11 ALLOW 行 6（受 F1/R1 + F4/R2(c) 措辞约束） | Role 消费面补 `namespace-api`；单拆卸链句补「包级 WS 停机（含包内 apply 排空 + close session → release lease）→ 已接纳 REST 工作有界排空（boot 窗口跳过）→ registry shutdown」；新增 raw-path 分流句并显式声明 503/500 为 transport 占位、非终态错误契约形状 |
| `apps/yjs-server/test/rest-hosting-behavior.test.ts`（新增，153 行） | §11 ALLOW 行 7、§12 行为测试四例 | 例 1 D8 rejection→500 + 事件恰一次；例 2 D4 drain 超时（有界 + socket abort + `app-stopped` 恰一次，20s per-test timeout——O7）；例 3 F2 boot 窗口早停；例 4 O1 `/healthz?x=1` → 404 |
| `wiki/raw/task_issue-270_sa3_impl.md`（本文件） | 技能固定产物 | 实现报告 |
| `wiki/raw/task_issue-270_sa3_{contract,app-suite,typecheck,root-typecheck}.log` | 技能固定产物（证据） | 原始命令输出 |

## SA2 Finding 落实

| Finding ID | 本轮实现 | Result |
|---|---|---|
| **F1** 停机次序文档失真 | 实现严格按 §8 实际执行序：`hubService.stop()`（包内 ②③ 一次完成：已接纳 apply 排空 + close session → release lease）→ 步 4 `restHost?.drain` → `replication-drained` → `registry.shutdown()` → `persistenceFiber.dispose()`；`app.ts` 步 4 注释显式写「包级 WS 停机**之后**、registry.shutdown() 之前」；`AGENTS.md` 同款措辞（不称 REST 排空先于 session/lease 收口、不归入 §21 ②） | ✓ 落实（设计 §6/§7-D4/§8/§11 四处表述在实现与文档中一致） |
| **F2** boot 窗口停机未防护 | 步 4 为 `await this.restHost?.drain(REST_DRAIN_BUDGET_MS)`（optional chaining，与同函数既有 guard 纪律一致）；`restHost` 在 bootHub 中段（provision 之后、plugin install 之前）构造一次冻结 | ✓ 落实：行为测试例 3（不 await `ready` 即 `stop()`）绿——`stop()` resolve、`app-stop-failed` 0 次、事件链收敛 `app-stopped` |
| **F3** 行为测试无 ALLOW 落点 | 四例行为测试全部落位新增 `apps/yjs-server/test/rest-hosting-behavior.test.ts`（非 `issue270-*` 命名，与 DENY glob 零相交） | ✓ 落实：四例全绿；冻结契约文件哈希不变 |
| **F4** 503/500 表面收敛未登记 | 实现注释登记：503 = server transport 层拒绝（非 router 错误契约成员）；500 = FR-3 加法替换的 `text/plain` 占位；`AGENTS.md` 显式声明两者非终态形状（不固化 body 语义） | ✓ 落实（对应设计 §13 (a)(b)(c)） |
| O1（回落精确匹配） | `req.method === 'GET' && req.url === '/healthz'` 精确等值；行为测试例 4 | ✓ 绿 |
| O7（例 2 超时预算） | 例 2 使用 `it(..., 20_000)`，实测 10 008 ms | ✓ |
| O8（方法引用传递） | `createRestHosting` 为闭包工厂，`handle` 不依赖 `this`；`createHubListenAdapter({handleRequest: restHost.handle})` 安全 | ✓ |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `apps/yjs-server/src/app.ts` | §11 ALLOW 行 1（逐项命中） | 观测面/装配/排空/事件/常量 |
| `apps/yjs-server/src/rest-hosting.ts` | §11 ALLOW 行 2（新增） | D3/D4/D8 承载模块 |
| `apps/yjs-server/src/transport/ws-server.ts` | §11 ALLOW 行 3 | `handleRequest` 注入面；缺省路径不变 |
| `apps/yjs-server/package.json` | §11 ALLOW 行 4 | D7 依赖解析 |
| `pnpm-lock.yaml` | §11 ALLOW 行 5 | 依赖连动 |
| `apps/yjs-server/AGENTS.md` | §11 ALLOW 行 6 | 规范文档同步（F1/F4 措辞约束） |
| `apps/yjs-server/test/rest-hosting-behavior.test.ts` | §11 ALLOW 行 7（新增） | §12 行为测试四例 |
| `wiki/raw/task_issue-270_sa3_impl.md` + `task_issue-270_sa3_*.log` | 技能固定产物（实现报告与验证证据） | 报告/证据 |

DENY 面核验：`git status --short` 对 `packages/**`、`docs/**`、`apps/yjs-server/src/main.ts`、
`apps/yjs-server/src/index.ts`、`vitest.config.ts` 零条目；`apps/yjs-server/test/issue270-*.ts`
三文件哈希与 SA6 §13.4 逐字节一致（未修改）。

## Verification

| Command | Result | Evidence |
|---|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run apps/yjs-server/test/issue270-server-integration-red.test.ts apps/yjs-server/test/issue270-regression-anchors.test.ts`（实现前基线） | `Test Files 1 failed \| 1 passed (2)` / `Tests 4 failed \| 3 passed (7)` / `Type Errors no errors`（T1-A/T1-B/T2/T3 红；与 SA6 §13.1 逐位一致） | 本会话实测（09:37）；原始基线 `task_issue-270_sa6_red.log` |
| `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck apps/yjs-server/test/issue270-server-integration-red.test.ts apps/yjs-server/test/issue270-regression-anchors.test.ts apps/yjs-server/test/rest-hosting-behavior.test.ts` | **`Test Files 3 passed (3)` / `Tests 11 passed (11)` / `Type Errors no errors`（exit 0）**——SA6 红灯契约 4/4 转绿、恒绿锚 N1–N3 保持、行为测试 4/4 绿 | `wiki/raw/task_issue-270_sa3_contract.log` |
| `tsc -p apps/yjs-server/tsconfig.json` | exit 0（空输出） | `wiki/raw/task_issue-270_sa3_typecheck.log` |
| `pnpm typecheck`（根链：14 包 + app） | exit 0（含 `packages/namespace-api` 与 `apps/yjs-server`） | `wiki/raw/task_issue-270_sa3_root-typecheck.log` |
| `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run apps/yjs-server/test`（设计 §12 回归行） | **`Test Files 33 passed (33)` / `Tests 173 passed (173)` / `Type Errors no errors`（429s）**——含直用 adapter 的既有测试（`ws-server-upgrade-admission`、`node-hub-peer-live`、`ws-replication-issue190-sa7-real-transport`）与 `hub-restart-static-target-red`（本轮未现 #229 flake） | `wiki/raw/task_issue-270_sa3_app-suite.log` |
| 冻结契约哈希 | `5cea9d4e…`/`06e0bfe3…`/`2060e130…` 与 SA6 §13.4 逐字节一致 | `sha256sum`（本会话） |
| `grep -nE '\.(only\|skip\|todo)\(\|process\.env'` 新增行为测试 | 无命中（exit 1） | 本会话 |
| 静态生成/check | 设计未指定（本票零 VFSL schema/codegen 变更） | — |

红灯转绿归因：契约红点仅来自两个能力缺口（组合根无 REST route family、无共享 Registry 观测面）
＋ AC3 排空缺失；实现后 T1-A/T1-B/T2/T3 全部转绿，且未修改任何契约断言。

## Deferred verification

- SA4/SA7 的动态与真实环境验收（含 SA6 §14 三角验证口径下的 #229 `hub-restart-static-target-red`
  时序 flake 监测；本轮全量 app 套件该用例通过）。
- 根 `pnpm test`（全仓 vitest 含 `--typecheck`，覆盖 packages/domains）——SA3 只跑受影响 app 套件；
  根 `pnpm typecheck` 已跑（exit 0）。
- FR-1/FR-3/FR-4 follow-up（limits/`Request.signal`、problem shape 收敛、observer 事件发射）、
  peer REST listener、REST owner authorization、drain 预算可配置化（设计 §13 已登记）。
- matched 早返回不消费 body 的 keep-alive socket 处置（SA2 O2 → 随 FR-1 limits 票登记）。

## Deviations or blockers

无阻塞。实现与设计一致的说明与两处实现层细节（不改变设计语义）：

1. **行为测试复用冻结 fixture（只读）**：`rest-hosting-behavior.test.ts` 从
   `issue270-contract-support.ts` 导入真实组合根启动器/HTTP 客户端/记录 sink（未修改该文件，
   哈希不变），避免第二套 harness 漂移；例 3 因需「不 await ready」而直接用 `createNomicoreApp`。
2. **占位 body 字面量**：设计未固定 503/500 的 body 文本——实现取 `service unavailable\n` /
   `internal error\n`（`text/plain`，与 listener 既有小写风格一致）；行为测试只断言状态/类型/事件，
   不固化 body 形状（F4-(c)）。FR-3 落地时按设计 §13 (b) 加法替换。
3. **`handle` 兜底 `.catch`**：异步主体除设计要求的 `void (async …)()` 包裹与
   `onRejection` try/catch 隔离外，另加结构性兜底 `.catch → notifyRejection`——不外抛到
   EventEmitter 上下文，且意外错误仍经 `rest-request-failed` 可观测（非静默降级）。
4. **deny 面零触碰**：`packages/**`、`main.ts`、`index.ts`、`vitest.config.ts`、`docs/**`、
   SA6 冻结契约三文件与上游 wiki 输入均未修改。

## Suggested commit message

```
fix(#270): 组合根承载 REST route family + 共享 Registry 观测面 + 已接纳 REST 工作有序排空

- app.ts：NomicoreApp.registry 观测面（同一 Registry 引用，构造后零替换）；hub 组合根以
  Instance role + 显式 no-op observer 构造 REST router，经 listener handleRequest 钩子按 raw
  path 分流（REST 优先，matched:false 回落 /healthz+404）；performStop 在包级 WS 停机之后、
  registry.shutdown() 之前有界排空已接纳 REST 工作（restHost?.drain，boot 窗口跳过）
- rest-hosting.ts（新增）：intake 门 503、REST→Response 写回、rejection→rest-request-failed+500
  占位、in-flight 记账与超时 abort、幂等 drain
- transport/ws-server.ts：可选 handleRequest 注入面（缺省 /healthz+404 字节不变）
- 依赖/锁文件/AGENTS.md 同步；行为测试四例（D8/D4/F2/O1）落位 rest-hosting-behavior.test.ts
```

## 附：实现要点对照（可选审计索引）

| 设计条款 | 实现位置 |
|---|---|
| §7-D1 共享引用 / 零 Cordis Context 查找 | `app.ts` bootHub：`const registry = this.registry` → `createRestRouter({registry, …})`（构造一次冻结） |
| §7-D2 观测面（`\| undefined`） | `app.ts`：`NomicoreApp.registry` 接口 + `publicFace()` getter 委托私有字段 |
| §7-D3 raw path 分流 / 回落精确等值 | `rest-hosting.ts` `dispatch`（`outcome.matched` 判别 + `req.url === '/healthz'`） |
| §7-D3 Request/Response 适配（流透传、不预读） | `rest-hosting.ts` `toWebRequest`（`Readable.toWeb` + `duplex:'half'`；GET/HEAD 无 body）与 Response 写回段 |
| §7-D3 upgrade 单一门零改动 | `ws-server.ts` upgrade 段未触碰；`HubListenAdapter` 包契约零改动 |
| §7-D4 步 0–7 | `app.ts` `stop()`（步 0）+ `performStop()`（步 1–7 单链） |
| §7-D4 接纳判定/abort/幂等 | `rest-hosting.ts` `register`/`runDrain`/`drain` |
| §7-D5 observer 显式 no-op | `app.ts` bootHub `metricsObserver/diagnosticObserver: () => {}` |
| §7-D6 role 单真相 | `app.ts` bootHub `requireNomicoreInstance(this.ctx).role` |
| §7-D7 根入口导入 + workspace 依赖 | `app.ts` import；`package.json`；`pnpm-lock.yaml` |
| §7-D8 rejection 处置 | `rest-hosting.ts` dispatch catch（`notifyRejection` + `writePlain(500)`）；`app.ts` `rest-request-failed` |
| §9 单链/幂等/无静默 fallback | `stop()` 单飞不变；`drain()` 幂等；F2 守卫为 boot 窗口事实生命周期（非运行期 fallback） |
