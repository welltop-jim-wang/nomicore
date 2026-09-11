# SA6 诊断与验收契约报告 — issue #270：Server 集成验收（REST 与 WebSocket 共享 Registry + 有序停止）

> 阶段：acceptance-contract（Feature 红灯固化，iteration 0）。
> Dispatch：`sa-13ad6a7e-9971-402f-97fc-312975b89304`（mabf-sa6）。
> 前置：SA8 冲突门禁 `clear`（`wiki/raw/task_issue-270_sa8_gate.md`，0 hard-violation / 0 evolution /
> 3 条 advisory A1–A3）；Issue comments REST 读取 = `[]`（dispatch 前与本次收尾前各读一次均为空，
> `gh api .../issues/270/comments --jq length` → `0`）——无 Owner 追加要求。
> 结论：**能力缺口已实证且契约可执行**——hub 组合根 HTTP listener 当前不承载 REST route family
> （`POST /v1/owners/{owner}/namespaces` → 404），组合根不暴露共享 Registry 观测面；7 个契约用例
> （4 红 + 3 恒绿锚）已固化，红灯 3/3 复跑逐位一致；临时绿灯模拟件下 **7/7 全绿**（可满足性）；
> 6 例定点变异全部被目标断言捕获（断言敏感性）；生产实现已逐字节回退（§16）。
> Verdict：**`approve`**（详见 §17）。

## 0. 交付物

| 文件 | 内容 | 状态 |
|---|---|---|
| `apps/yjs-server/test/issue270-contract-support.ts` | 契约共享 fixture/harness：真实 `createNomicoreApp` 组合根 + 真实 TCP/HTTP（含 `Expect: 100-continue` admission 客户端、`agent:false` 独立连接）+ 真实 raw WS 协议消息 + 真实 Registry 观测面/独立第二 Registry + 有界轮询。非 `*.test.ts`，不被 vitest 收集 | 新增 |
| `apps/yjs-server/test/issue270-server-integration-red.test.ts` | 红灯契约：T1-A/T1-B（AC1 共享 Registry）、T2（AC2 raw path 分流）、T3（AC3 有序停止） | 新增（红灯） |
| `apps/yjs-server/test/issue270-regression-anchors.test.ts` | 恒绿回归锚：N1（AC4 WS 不依赖 REST create）、N2（SA8 A3 有界停止/单一拆卸链）、N3（AC2 既有 listener/凭据门面） | 新增（绿灯） |
| `wiki/raw/task_issue-270_sa6_contract.md` | 本报告 | 新增 |
| `wiki/raw/task_issue-270_sa6_red.log` | 红灯基线原始输出（含逐用例失败信息） | 新增 |
| `wiki/raw/task_issue-270_sa6_green-sim.log` | 临时绿灯模拟件下的 7/7 全绿原始输出 | 新增 |
| `wiki/raw/task_issue-270_sa6_mutations.log` | M1–M6 定点变异逐例原始输出 | 新增 |
| `wiki/raw/task_issue-270_sa6_app-suite.log` | 全 app 套件（含本票契约）原始输出（#229 flake 三角验证之一） | 新增 |
| `wiki/raw/task_issue-270_sa6_app-suite-no-contract.log` | 全 app 套件排除本票契约的既有面基线原始输出（30/30 绿） | 新增 |

无生产实现改动（§16 哈希/`git status` 证据）；无 commit/push/PR；无 skip/only/todo/env override。

## 1. Task type and inputs

- **任务类型：Feature（server 集成验收）**。issue #270 不是缺陷回归，而是 ADR 0015 的
  「server 集成验收」测试决策（L210）与装配条款（L18–20/L32/L232）本体尚未落地。契约证明
  **能力缺口**并固化目标行为，不虚构 Bug 根因。
- 输入（固定位置）：
  - 任务简报 `wiki/raw/task_issue-270.md`（issue #270，State: open，updated 2026-09-10T23:59:32Z；
    Parent = PR #158 `docs/rest-namespace-create`；Blocked by #267 已关闭；AC1–AC4）；
  - 派发记录 `wiki/raw/task_270_dispatch.md`（round 1：conflict-gate；Issue comments REST read none）；
  - SA8 冲突门禁 `wiki/raw/task_issue-270_sa8_gate.md`（verdict `clear`；移交 A1/A2/A3）；
  - 本仓无本票既有 SA6 报告、无 `task_issue-270_design.md`、无 `_relevant_decisions.md` /
    `_conflict_report.md`（`ls wiki/raw | grep 270` 仅三份上表前置件）——按简报 + 源码 + SA8 附录 A
    决议摘录推进；
  - governing 决策：`docs/adr/0015-vertical-rest-namespace-create.md`（提议；L18–32 模块与装配、
    L38–41 peer role gate、L210 测试决策、L232 取代与关联）；已接受 ADR 0009（L8/L99–103/L118）、
    0012（L5/L19/L37）、0010（L73–79/L90/L175/L179）、0011 L129、0014（门槛 13）；
    `docs/protocols/instance-replication-v1.md` §21；根 `CONTEXT.md`；
  - 上游代码事实（HEAD `0b06050`）：`packages/namespace-api/src/rest.ts` 骨架 router（#267 经 PR #296
    合入）已存在且独立可用；`apps/yjs-server/src/app.ts`（`createNomicoreApp` = 部署组合根，
    `main.ts` 唯一生产入口）构造 Registry + WS replication plugin；`src/transport/ws-server.ts`
    普通请求固定 `/healthz` 200 / 其余 404；`src/index.ts` 遗留低层 `createYjsHubServer`（非生产入口）。
- 环境：node `v24.13.0`、pnpm `10.28.2`、vitest `3.2.7`、TypeScript `5.9.3`；worktree
  `nomicore-fix-issue-270`，branch `mabf/issue-270`，HEAD `0b06050`；依赖经
  `pnpm install --offline --frozen-lockfile` 从本地 store 复用安装（65 packages，无网络需求）。

## 2. Owner comment mapping

| Owner 输入 | 内容 | 契约落实 |
|---|---|---|
| Issue comments REST snapshot | **空（`[]`）**（dispatch 前 + 本次收尾前两次 REST 读） | 无 Owner 追加要求/override；验收口径 = 简报 AC1–AC4 + SA8 附录 A 冻结条款 |
| 简报 AC1 | 集成测试证明 REST 与 WebSocket Module 持有同一个 `NamespaceRegistry` 引用（不经 Cordis Context 查找、不运行时替换） | T1-A（REST create → 组合根 Registry 可 reopen + 第二 Registry 反证 + 观测面对象恒等）、T1-B（组合根 Registry lease 写入 → WS bootstrap 观测同一 Runtime） |
| 简报 AC2 | raw path 正确分流 REST 与 WebSocket route family | T2（REST canonical/405/非 canonical 404；`/replication` 普通请求 404；`/healthz` 200；`/replication` 升级 101；REST 路径升级 404）+ N3（既有面不得破坏） |
| 简报 AC3 | 停止顺序：停止 intake → 等待已接纳工作 → 释放 Lease/Session → shutdown Registry 与 Persistence | T3（100-continue 已接纳 REST create 在 drain 期完成 201；停止后新请求不再接纳；WS 会话 1001 clean close；拆卸链事件严格递增；Persistence dispose 前已提交 → 同 rootDir 重启可读回）+ N2（SA8 A3） |
| 简报 AC4 | WebSocket Module 不依赖 REST create，仍直接使用 Registry/Lease/ReplicationSession | N1（零 REST 请求下 peer bootstrap + 双向收敛；当前即绿，必须保持） |
| 简报范围 | 本票基于骨架 router 即可落地；不等待完整错误契约与 observer 行为；后续 ticket 不得破坏本验收 | 契约只消费 #267 骨架已冻结的成功路径（canonical path + POST → 201、已知路径非 POST → 405 + `Allow: POST`）与标准 Web `Request→Response` 判别结果，不断言延后错误映射/limits/observer 事件；N1–N3 钉住「不得破坏」 |

## 3. SA8 constraints（本契约的落实）

| SA8 约束 | 本契约落实 | 证据/边界 |
|---|---|---|
| **A1** 停机时先 close session、后 release Lease（ADR 0010 L90 / protocol §21 ③） | T3 断言 WS 会话在拆卸期以 **1001 clean close** 关闭（`{code:1001,reason:'hub-shutdown'}`），且 `replication-drained`（含 hub drain：停接纳 + 会话收口 + lease 回收）严格先于 `registry-stopped`；集成层不得绕过 `hubService.stop()` | 集成层可观测量到此为止：session→lease 的**包内精确次序**由 `packages/ws-replication/src/hub-namespace.ts` `closeSessionAndRelease`（L436「严格保持 close session → release lease 的完成顺序」）+ 包级契约测试锁死；#270 只消费不重排。M5 变异（registry.shutdown 提前到 drain 之前）被 T3 捕获 |
| **A2** REST Module 构造期两个同步 void observer 必须显式注入（ADR 0015 L186） | 红灯契约全部经真实组合根启动：若组合根漏注入 `metricsObserver`/`diagnosticObserver`，`createRestRouter` 构造抛 `TypeError` → `ready` reject → 4 个红用例全部在启动点失败 | M4 变异（删除 `diagnosticObserver` 注入）→ 7/7 全红，错误逐字为「diagnosticObserver 必须显式注入（no-op 须显式）」 |
| **A3** 不得无限等待日志 sink、保持单一拆卸链（ADR 0011 L129/ADR 0014 门槛 13；app AGENTS.md） | N2（恒绿锚）：`diagnostics.enabled=true` + file persistence 下 `stop()` 有界（实测 525ms，断言 <15s），二次 `stop()` 不产生第二条链，`replication-drained/registry-stopped/diagnostics-closed/persistence-disposed/app-stopped` 各恰一次且顺序严格递增 | 红灯基线与绿灯模拟两态均绿；T3 同样断言拆卸链事件恰序 |

## 4. Environment and baseline

- 运行入口（仓库真实入口）：根 `package.json` `test = NODE_OPTIONS=--conditions=nomicore-source
  vitest run --typecheck`；根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', …,
  'apps/*/test/**/*.test.ts']`、`maxWorkers: 1`；`@nomicore/*` 经 resolve.alias 指向各包
  `src/index.ts`/`src/testing.ts`。
- 工作树基线：HEAD `0b06050`（= `origin/docs/rest-namespace-create`），生产实现零改动；
  本票契约 3 文件为唯一新增。
- 现有测试基线（原始生产代码、无并发变更，见 §14）：
  - 全 app 套件含本票契约：`Test Files 2 failed | 30 passed (32)`、
    `Tests 5 failed | 164 passed (169)`——其中 1 文件/4 用例为本票红灯契约，另 1 例为
    `hub-restart-static-target-red.test.ts`（issue #229）的已知时序 flake
    （`expected 'ready' to be 'backoff'`；见 §14 三角验证）；
  - 全 app 套件排除本票契约：`Test Files 30 passed (30)`、`Tests 162 passed (162)`——
    既有面基线全绿。
- `tsc -p apps/yjs-server/tsconfig.json`（含 `test/**/*.ts`）→ exit 0。

## 5. Positive reproduction（Feature 能力缺口：目标断言红灯）

命令（真实入口 + 路径过滤；`--typecheck` 同款亦复跑）：

```
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run \
  apps/yjs-server/test/issue270-server-integration-red.test.ts \
  apps/yjs-server/test/issue270-regression-anchors.test.ts
```

实测（exit=1，完整输出见 `task_issue-270_sa6_red.log`）：

```
 ❯ apps/yjs-server/test/issue270-server-integration-red.test.ts (4 tests | 4 failed) 600ms
   × T1-A：REST create 的 namespace 可在组合根同一 Registry 上 reopen（第二 Registry 反证）
     → 能力缺口（issue #270 AC1）：组合根 `NomicoreApp` 未暴露共享的 Registry 观测面 …: expected undefined to be defined
   × T1-B：WS 复制会话所在 Runtime 可由组合根 Registry 的 lease 写入并 bootstrap 观测
     → 同 T1-A（观测面缺失）
   × T2：同一 listener 上 REST 路径走 REST route family、/replication 走 WebSocket route family
     → REST create 应 201，实际 404 not found
   × T3：停止 intake 后已接纳 REST create 完成、新请求不再被接纳、WS Session 1001 关闭、Registry/Persistence 有序停止
     → 已接纳 REST create 应在 drain 期间完成 201，实际 404 not found
 ✓ apps/yjs-server/test/issue270-regression-anchors.test.ts (3 tests) 745ms

 Test Files  1 failed | 1 passed (2)
      Tests  4 failed | 3 passed (7)
Type Errors  no errors
```

红灯分解（全部落在本票目标面）：

1. **无 REST route family**：hub 组合根 listener 对 `POST /v1/owners/rest-owner-270/namespaces`
   返回 `404 not found`（`transport/ws-server.ts` 普通请求处理器仅 `/healthz` + 404 占位；
   `apps/yjs-server` 未依赖 `@nomicore/namespace-api`、`app.ts` 不构造 router、listener 无
   plain-HTTP 注入面）。
2. **无共享 Registry 观测面**：`NomicoreApp` 公共面仅 `ready/stop/sink/handleControlLine`
   （`('registry' in app) === false`），AC1 无法被观测。

## 6. Negative control（相近负控，恒绿）

1. **N1（AC4）**：hub `provision` 条目 → peer target → 零 REST 请求下 `bootstrap-imported` +
   peer `verify-write`(n=7) → hub `read` 收敛；hub `verify-write`(n=8) → peer `read` 收敛。
   红灯基线与绿灯模拟两态均绿——证明「WS Module 直接使用 Registry/Lease/ReplicationSession」
   不依赖 REST create，且测试驱动的是真实复制链路而非 mock。
2. **N2（A3）**：diagnostics + file persistence 下 `stop()` 有界（实测 525ms）+ 二次 stop
   单一拆卸链（5 个事件各恰一次、顺序严格递增）——恒绿回归锚。
3. **N3（AC2 既有面）**：`/healthz` 200、未知路径 404、`/replication` 普通请求 404、非 REST
   路径 POST 404、无凭据升级 401、错凭据升级 403、REST 路径升级 404——恒绿；M2′ 变异证明该锚
   对 route-family 串线敏感。
4. **T1-A 内置敏感度反证**：独立第二 Registry（自有 MemoryPersistence + 受控
   clock/scheduler/randomBytes）对第一 Registry 创建的 namespace 执行 `open` →
   `NAMESPACE_NOT_FOUND`——证明「同一引用」断言非恒真（M1 变异同向捕获）。
5. **支撑面绿锚**：红灯基线下 3 个用例全绿，证明组合根启动、provision、WS 复制、file
   persistence、HTTP 客户端、事件 sink 在 HEAD 全部可用——红灯不来自环境/fixture/入口。

## 7. Stability, scale and timing

- **红灯稳定性**：同一命令连续 3 次 → `Test Files 1 failed | 1 passed (2)`、
  `Tests 4 failed | 3 passed (7)`、`Type Errors no errors` 逐次一致（§13）。
- **绿灯可满足性稳定性**：临时模拟件下同一测试字节 7/7 全绿（两次运行一致，§9-E1）。
- **时序/规模条件**：全套 <3s（红灯基线 2.4s；绿灯模拟 2s 级）；T3 使用 file persistence +
  `schedule={debounceMs:10,maxDirtyMs:20}`（拆卸排空窗 ≈520ms，确定性进入 drain 观察窗）；
  N2 `stop()` 实测 525ms，断言上界 15s（CI 慢机 28× 余量）。
- **无竞态设计**：全部等待经有界轮询（10ms 步进）或事件/应答锚：
  - REST admission 用标准 `Expect: 100-continue`（server 自动回 100 ⇒ 请求头已解析并接纳），
    不依赖 sleep 推断；
  - 每条 HTTP 请求 `agent:false`（独立 TCP 连接），避免 Node ≥19 全局 keep-alive 连接复用
    把「intake 停止后新工作」混入既有连接；
  - WS 会话以 HELLO/HELLO_ACK、OPEN/OPEN_OK、BOOTSTRAP_SNAPSHOT 帧序锚定；
  - 无 `nohup`/`setsid`/PID/marker 轮询。

## 8. Capability gap（替代 Bug 根因链）

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | 契约 T1-A/T1-B/T2/T3 红灯 | §5 实测输出 | 确证 |
| 直接故障点① | hub 组合根 HTTP listener 无 REST route family：canonical path POST → 404 | `httpRequest(port,'POST',CREATE_PATH,…) → {status:404,body:'not found\n'}`；`transport/ws-server.ts` 普通请求处理器固定 `/healthz`200/其余404 | 确证 |
| 直接故障点② | 组合根不暴露共享 Registry 观测面 | `Object.keys(app)` = `[ready,stop,sink,handleControlLine]`；`'registry' in app === false` | 确证 |
| 触发条件 | 任何经组合根 listener 的 REST create、或对 AC1 共享引用的集成观测 | 契约 4 红用例 | 确证 |
| 最深根因 | ADR 0015「server 集成验收」本体（composition root 注入共享 Registry、raw path 分流、有序停止含 REST 排空）尚未实现；#267 只交付了 host 无关骨架 router | `apps/yjs-server/package.json` 无 `@nomicore/namespace-api` 依赖；`app.ts` 无 REST 构造；HEAD 日志 `0b06050` = #267 骨架 | 确证 |
| 放大因素 | 前提已就绪：#267 骨架 router 可用（`packages/namespace-api/src/rest.ts`，201/405/role gate 成功路径齐备）⇒ 唯一缺口就是本票集成面 | 绿灯模拟件仅接线组合根即 7/7 全绿 | 确证 |
| 未证实假设 | H1（hub listener 默认承载 REST，无需新增必填配置键）、H2（`NomicoreApp.registry` 观测面）、H3（停止顺序语义）、H4（集成 seam = 部署组合根 `createNomicoreApp`，非遗留 `createYjsHubServer`） | §12.1 | 待 SA1/SA2 仲裁（不阻塞红灯） |
| 排除项 | 环境/依赖/fixture/入口/超时/HTTP 客户端/WS 协议/Registry/Persistence | §11 | 确证 |

**关键因果发现（AC3 的真实缺口）**：把最小 REST 接线（不含任何排空）放入组合根后，T3 仍以
`已接纳 REST create 应在 drain 期间完成 201，实际 404` 失败；组合根侧观测到的真实异常是
`unmapped registry issue: REGISTRY_NOT_ACCEPTING`——即 `stop()` 的现有拆卸链在**已接纳 REST
请求仍持有 body/lease 时**就执行了 `registry.shutdown()`。只有追加「intake 停止后等待在途
REST 工作结算」才转绿（§9-E1/E2-M3/M5）。这证明 T3 断言的是本票真实缺口，而非路由缺失的
连带表象。

## 9. Causal experiments

### E1 可满足性（临时绿灯模拟件，唯一变量 = 组合根是否接线；测试字节不变）

- 方法：临时修改 `apps/yjs-server/src/transport/ws-server.ts`（普通请求处理器增加可选
  `handleHttpRequest` 钩子，经 `createNodeHubListenAdapter/createHubListenAdapter` 透传）+
  `apps/yjs-server/src/app.ts`（构造 `createRestRouter({role:this.role, registry:this.registry,
  metricsObserver, diagnosticObserver})`；REST 路径经标准 `Request→Response` 适配；公开
  `registry` 访问器；`stop()` 在 `registry.shutdown()` 前排空在途 REST 计数）。
  **非交付、非设计产物**；运行后逐字节回退（§16）。
- 结果：`Test Files 2 passed (2)` / `Tests 7 passed (7)` / `Type Errors no errors`（exit 0）。
- 推论：红灯唯一差异 = 组合根集成面是否存在 ⇒ 红灯因果归因于能力缺口，而非测试缺陷/环境。
- 中间态证据：接线但**不排空**时 T3 仍红（`REGISTRY_NOT_ACCEPTING` → 404）——AC3 排空语义
  独立于路由接线成立。

### E2 断言敏感性（定点变异矩阵，6 例；对临时模拟件单点变异，测试字节不变）

| # | 变异（对目标条款的反证） | 被捕获断言（失败用例） | 失败数 |
|---|---|---|---|
| M1 | REST router 绑定**第二个** Registry 实例（共享引用违约） | T1-A（`Registry.open` 读不回 REST 创建物）、T3（重启 durability 读不回） | 2（T1-B/T2/N× 仍绿） |
| M2′ | server 对 `/replication` 选择 REST route family（raw path 串线） | T2（`/replication` 普通请求预期 404 实得 405）、N3 | 2 |
| M3 | 移除 REST 排空（registry 先于在途 REST 工作 shutdown） | T3（已接纳 create 预期 201 实得 404） | 1 |
| M4 | 删除 `diagnosticObserver` 显式注入（SA8 A2） | 全部 7 例（组合根 `ready` 即抛 `TypeError: diagnosticObserver 必须显式注入`） | 7 |
| M5 | `registry.shutdown()` 提前到 WS drain 之前（AC3/A1 次序违约） | T3（已接纳 create 预期 201 实得 404） | 1（该文件 3/4 绿） |
| M6 | REST router `role` 不从组合根 Instance identity 取值（固定 `'peer'`） | T1-A/T2/T3（403 role gate） | 3（T1-B 与 N× 仍绿） |

- 每例只被**目标断言**捕获，且失败集合与因果预期一致；无「变异后仍全绿」盲区。
- 敏感度覆盖：共享引用身份（M1）、route family 分流（M2′）、REST 排空/拆卸次序（M3/M5）、
  构造注入义务（M4）、role 单真相（M6）。
- 变异原始输出：`task_issue-270_sa6_mutations.log`。

### E3 边界未被 mock；观测纪律

- 真实 `createNomicoreApp` 组合根、真实 TCP/HTTP、真实 RFC 6455 客户端（`test/harness.ts`
  `wsUpgrade`/`PeerWire`）、真实 Memory/FilePersistence、真实 Registry/Runtime/lease/session；
  唯一观测包装是 ADR 0015 §测试决策指定的 `NamespaceRegistry` 公共接口（`open/readData/
  mutateData/getStatus`）与 NDJSON 事件面；零源码字符串/正则断言。
- 独立第二 Registry 仅用于 AC1 敏感度反证（自有 persistence/clock/scheduler），不被注入被测
  组合根。

## 10. Impact surface

- 新增测试面：`apps/yjs-server/test/issue270-*.ts`（3 文件）。**零生产实现改动**（§16
  `git status` + 哈希）。
- 既有公共面零修改：测试只消费 `@nomicore/yjs-server` 公共入口、`@nomicore/namespace-registry`
  （含 `/testing`）、`@nomicore/persistence`（含 `/testing`）、`@nomicore/replication-protocol`
  、`yjs` 与 app 测试 harness。
- SA3 实现落地（预期变化，非本报告设计）：
  1. `apps/yjs-server` 依赖 `@nomicore/namespace-api`；组合根以 `role`（Instance identity）、
     **同一个** Registry 引用、显式 `metricsObserver`/`diagnosticObserver` 构造 REST router；
  2. hub listener 增加 raw path 分流（REST family 与 `/replication` upgrade family），REST
     router 不拥有 listener/auth；
  3. `stop()` 在 `registry.shutdown()` 前等待已接纳 REST 工作结算，且 intake 先停止；
  4. `NomicoreApp` 公开共享 Registry 观测面（H2）。
- 延后项（本票契约不断言）：完整 REST 错误契约/limits/#268 #269 行为、observer 事件发射、
  peer 角色 REST listener（peer 组合根无 listener；role gate 由 #267 包级契约覆盖，见 §15）。

## 11. Ruled-out hypotheses

| 假设 | 排除证据 |
|---|---|
| 红灯由依赖缺失/别名解析导致 | 同一入口下 N1/N2/N3 全绿；`@nomicore/*`、`yjs`、真实 `ws` 客户端全部解析；`Type Errors no errors` |
| 红灯由 fixture/HTTP 客户端/WS 协议缺陷导致 | 绿灯模拟件下 T1-A/T1-B/T2/T3 全部转绿且 bootstrap 数据正确（`ROOT.n===99`）；`Expect: 100-continue`、`agent:false`、raw WS 帧序在支撑面经实测验证 |
| 红灯由入口/配置错误导致 | `vitest list --filesOnly` 命中两文件；`--typecheck` 入口同结果；`tsc -p apps/yjs-server/tsconfig.json` exit 0；`startHubApp` 在红灯态正常启动并发出 `listening/ready` |
| 红灯由超时/flake/竞态导致 | 3/3 复跑逐位一致；无 sleep 推断（admission 由 100-continue 锚定）；全套 <3s；T3/N2 预算远大于实测 |
| 伪绿（临时模拟件残留把契约点绿） | 模拟件已逐字节回退（§16 哈希），回退后红灯 3/3 复现 |
| 伪红（测试自身写错 path/端口） | T2 在同一端口上实测 `/healthz` 200 与 `/replication` 101；M2′/M6 证明断言对具体路径/role 敏感 |
| 源码字符串断言替代行为验证 | 全部断言观测运行时：HTTP 状态/头/body、WS 关闭码/帧序、Registry 公共结果、NDJSON 事件序、重启后持久化事实；无源码 grep |
| skip/only/todo/env override/吞错制造伪结果 | `grep -nE '\.(only|skip|todo)\(|process\.env' apps/yjs-server/test/issue270-*.ts` → 无命中；`--conditions=nomicore-source` 是仓库既有条件 |

## 12. Acceptance contract and test paths

### 12.1 契约假设（PROPOSAL，待 SA1/SA2 仲裁；若设计另有裁决须走修订轮同步测试）

- **H1**：hub 组合根的 HTTP listener 默认承载 REST route family（`/v1/owners/{owner}/namespaces`）
  与 WebSocket route family（`/replication`）的 raw-path 分流；`hub.tokens` 只约束 WS 升级，
  不要求 REST 新增必填配置键。若设计改为显式 opt-in 键，须修订 T1/T2/T3 的启动配置。
- **H2**：`NomicoreApp` 公开组合后的唯一 Registry 引用（`readonly registry: NamespaceRegistry`，
  `ready` 后可用）——AC1「证明 REST 与 WebSocket Module 持有同一个引用」的最小观测面
  （ADR 0015 §测试决策把 `NamespaceRegistry` 公共接口指定为集成观测 seam；ADR 0009 L118
  「REST、WS 和管理任务共享一个安全生命周期入口」的可执行形态）。若设计以等价公共观测面
  命名（或经 app 组合面暴露模块句柄），`issue270-contract-support.ts` 的 `appRegistry()` 是
  唯一适配点，须走修订轮。
- **H3**：停止顺序 = 停止 intake（listener 关闭）→ 等待已接纳 REST/WS 工作 settle →
  释放 Lease/Session → `registry.shutdown()` → persistence dispose；已接纳 REST 工作必须在
  `registry-stopped` 前完成提交且可从持久化恢复。
- **H4**：集成 seam = 部署组合根 `createNomicoreApp`（`main.ts` 唯一入口，拥有 Registry +
  Persistence 生命周期，AC3 必需）；遗留低层 `createYjsHubServer`（不拥有 Persistence）不在
  本验收面内。

### 12.2 AC → 断言映射

| 要求 | 断言（运行时行为级） | 测试 |
|---|---|---|
| AC1 共享 Registry 引用 | （a）`POST canonical` → 201，`namespaceId` 命中 `^ns-[0-9a-f]{32}$`；（b）组合根 Registry `open(owner,id)` 成功且 `readData(['title'])` 等于 REST 提交 ROOT；（c）独立第二 Registry 同 id `open` → `NAMESPACE_NOT_FOUND`；（d）第二次 REST create 后观测面对象恒等；（e）组合根 Registry lease `mutateData(n=99)` → WS OPEN/BOOTSTRAP_SNAPSHOT 导入后 `ROOT.n===99` | T1-A/T1-B |
| AC2 raw path 分流 | canonical POST 201 / canonical GET 405 + `Allow: POST` / 非 canonical POST 404 / `/replication` 普通 GET 404 / `/healthz` 200 / `/replication`+Bearer 升级 101 / REST 路径升级 404 / 未知路径升级 404；既有面 N3 同步锁死 | T2/N3 |
| AC3 有序停止 | 100-continue admission 后发起 stop：已接纳 create 201 + namespaceId；停止后新 REST create（独立连接）非 201 且传输层拒绝或 ≥400；WS 会话 1001 clean close；`replication-drained < registry-stopped < persistence-disposed < app-stopped`；`registry.getStatus().state==='stopped'`；同 rootDir 重启后 `open+readData` 读回提交值 | T3 |
| AC4 WS 不依赖 REST create | 零 REST 请求：peer bootstrap + peer→hub、hub→peer 双向收敛 | N1 |
| SA8 A2/A3 | 组合根构造成功（显式 observer）；`stop()` 有界 + 单一拆卸链事件恰一次 | 全红用例启动点 / N2 |

### 12.3 测试路径

```
apps/yjs-server/test/issue270-contract-support.ts              （fixture，非测试）
apps/yjs-server/test/issue270-server-integration-red.test.ts   （T1-A/T1-B/T2/T3，红灯）
apps/yjs-server/test/issue270-regression-anchors.test.ts       （N1/N2/N3，恒绿）
```

## 13. Red/green or baseline evidence

### 13.1 最终红灯基线（生产实现原始字节）

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run \
    apps/yjs-server/test/issue270-server-integration-red.test.ts \
    apps/yjs-server/test/issue270-regression-anchors.test.ts
 Test Files  1 failed | 1 passed (2)
      Tests  4 failed | 3 passed (7)
Type Errors  no errors
# 3 次复跑逐位一致；exit=1；完整输出 task_issue-270_sa6_red.log
```

红灯点：T1-A/T1-B（Registry 观测面缺失）、T2/T3（REST route family 缺失 → 404）。
绿锚：N1/N2/N3 全绿。

### 13.2 可满足性绿灯锚（临时模拟件，测试字节不变）

```
 Test Files  2 passed (2)
      Tests  7 passed (7)
Type Errors  no errors
# exit=0；完整输出 task_issue-270_sa6_green-sim.log
```

### 13.3 变异矩阵（最终测试字节复跑）

M1 → 2 红（T1-A/T3）；M2′ → 2 红（T2/N3）；M3 → 1 红（T3）；M4 → 7 红（启动点）；
M5 → 1 红（T3）；M6 → 3 红（T1-A/T2/T3）。逐例目标断言命中，无全绿盲区
（原始输出 `task_issue-270_sa6_mutations.log`）。

### 13.4 最终测试文件哈希（sha256）

```
5cea9d4e19f645e2baf366dcf96b1c55f2527fe798b015644d6f19f214efbb43  issue270-contract-support.ts
06e0bfe3f83873a8efe5693b032e4cfa8d37fc1b9fea8eae7a98fdab9b2a4046  issue270-server-integration-red.test.ts
2060e130f5881bb01927816d7236fd6d352e87e7bdf3f13d5a78b2da74723d78  issue270-regression-anchors.test.ts
```

## 14. Runner trigger evidence

- 发现性（根配置 include `apps/*/test/**/*.test.ts`）：

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest list --filesOnly apps/yjs-server
apps/yjs-server/test/issue270-regression-anchors.test.ts
apps/yjs-server/test/issue270-server-integration-red.test.ts
```

- `issue270-contract-support.ts` 未被收集（fixture 身份正确）。
- 仓库真实入口（含 `--typecheck`，与根 `pnpm test` 同款参数）：

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck \
    apps/yjs-server/test/issue270-server-integration-red.test.ts \
    apps/yjs-server/test/issue270-regression-anchors.test.ts
 Test Files  1 failed | 1 passed (2)
      Tests  4 failed | 3 passed (7)
Type Errors  no errors
```

- 全 app 套件回归（原始生产代码、无并发变更）：

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run apps/yjs-server/test
 Test Files  2 failed | 30 passed (32)
      Tests  5 failed | 164 passed (169)
Type Errors  no errors
# 竞态三角验证：失败 2 文件 = 本票红灯契约（4 例）+ hub-restart-static-target-red.test.ts（1 例）

$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run apps/yjs-server/test \
    --exclude '**/issue270-*'
 Test Files  30 passed (30)
      Tests  162 passed (162)          # 既有面全绿（无本票契约时）

$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run \
    apps/yjs-server/test/issue270-server-integration-red.test.ts \
    apps/yjs-server/test/issue270-regression-anchors.test.ts \
    apps/yjs-server/test/hub-restart-static-target-red.test.ts
 Test Files  1 failed | 2 passed (3)     # #229 用例 2/2 通过（21.7s / 21.2s）
      Tests  4 failed | 4 passed (8)     # 4 红 = 本票契约
# 另：#229 单独 3/3 通过（20.8s / 18.6s / 18.8s）
```

  结论：全量运行中出现的 `hub-restart-static-target-red.test.ts` 单例失败（`expected 'ready'
  to be 'backoff'`）是 issue #229 既有**时序 flake**（该用例有 CI 红历史：`2c95ddc`
  「消除 #229 Hub 重启回归的 backoff 重拨竞态 (#241 CI 红)」），与本票契约无关：单独 3/3 绿、
  与本票文件同批 2/2 绿、排除本票文件的全量基线 30/30 绿。本票红灯契约在全部运行中稳定为
  4 例失败，既有面（162 例）零失败 ⇒ 新增契约不干扰既有测试与端口/进程资源。
- `tsc -p apps/yjs-server/tsconfig.json` → exit 0（含新测试文件的严格类型检查）。
- 无 skip/only/todo；无 env override（`--conditions=nomicore-source` 为仓库既有条件）。

## 15. Unknowns and blockers

- **H1（默认承载 REST）**：本契约按 issue 文本「server 先按 raw path 选择 REST 与 WebSocket
  route family」取默认-on 读法。若设计改为显式 opt-in 配置键，须修订轮同步测试配置（非阻塞）。
- **H2（观测面命名）**：`NomicoreApp.registry` 是 AC1 的最小可执行观测面；若设计采用等价但
  不同名的公共面，`appRegistry()` 单点适配 + 修订轮。
- **H4（集成 seam）**：契约锚在部署组合根（`createNomicoreApp`）；若设计主张遗留
  `createYjsHubServer` 也承载 REST（该入口不拥有 Persistence），须澄清 AC3 归属并修订。
- **peer 角色 REST listener**：peer 组合根当前无 listener，AC2 只覆盖 hub listener；peer role
  gate（403 + `INSTANCE_ROLE_FORBIDDEN`）由 `packages/namespace-api/test/rest-role-gate-routing-contract.test.ts`
  （#267 冻结契约）覆盖。若后续 ticket 给 peer 增加 listener，须追加集成断言。
- **SA8 A1 的包内精确次序**：集成 seam 不暴露 session/lease 内部对象；契约以 1001 clean
  close + `replication-drained < registry-stopped` 观测，精确「close session → release lease」
  由 `packages/ws-replication/src/hub-namespace.ts` 与包级契约锁死（§3）。
- 无阻塞红灯契约建立的环境或事实缺口。

## 16. Temporary diagnostics cleanup

| 临时件 | 处理 | 证据 |
|---|---|---|
| 诊断 probe 脚本 `apps/yjs-server/test/issue270-probe{,2,3}.mts` | **已删除** | `git status` 仅剩 3 个契约文件；目录内无 `issue270-probe*` |
| 临时绿灯模拟件（`src/app.ts`、`src/transport/ws-server.ts` 接线/排空/观测面） | **已逐字节回退** | 回退后 sha256：`app.ts d30d05fe7b94b2b908730bbeff4d39a3dad944a7d273c9b42574833b1bd71427`、`ws-server.ts 45928223d9b146fccaa01af53f0956e6322359c2fcd13c857436e7bff9393b73`（与改动前一致）；`git status --short` 生产文件零条目 |
| 变异探针（python 单点替换）与原始备份 | 仅存在于 worktree 之外 `/tmp/sa6-270-evidence/` + `/tmp/sa6-270-*.orig`，不进交付树 | `git status` 无相关条目 |

清理后复核：生产实现与 HEAD 逐字节一致；红灯基线 3/3 复现；无后台服务/监听端口残留（所有用例
`finally` 内 `stop()`，raw WS `destroy()`，tmpdir `rmSync`）；无 nohup/setsid/PID/marker。

## 17. Verdict

**`approve`**

- 能力缺口可信、因果闭合：RED 只落在本票目标面（组合根无 REST route family、无共享 Registry
  观测面；AC3 排空缺失以 `REGISTRY_NOT_ACCEPTING` 实证），非环境/fixture/入口/超时错误。
- 契约可执行且被仓库真实入口发现（`vitest list` + `--typecheck` + 全 app 套件回归）。
- 可满足性经临时最小接线 **7/7 全绿** 证明；6 例定点变异全部被目标断言捕获（含共享引用、
  route family、REST 排空/拆卸次序、observer 注入、role 单真相）。
- 负控恒绿（AC4 WS 独立复制、A3 有界单一拆卸链、listener 既有面），且红灯态 3/3 稳定复现。
- 临时诊断件全部清理、生产实现逐字节回退；H1–H4 为显式契约假设，交 SA1/SA2 仲裁后进入设计。
- 提交 `requiresConflictRecheck: true`：H1–H4（REST 默认承载/观测面命名/停止语义/集成 seam）为设计期
  裁定点，SA1 设计落地后须回到 SA8 冲突门禁复审（与 #267 SA6 的 B-1/B-2/B-3 同款流程）。
