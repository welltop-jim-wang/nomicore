# SA7 动态验证报告 — issue #164 切片 9（apps/yjs-server 组合根 + 真实 WebSocket adapter）

**Date**: 2026-08-30
**对象**: SA4 R2 pass 后的 SA3 实现（commit `a1fdcfb`）+ SA6 回流修复（commit `5c4b235`）
**新增验证资产**: `apps/yjs-server/test/issue164-sa7-dynamic.test.ts`（7 用例 DV1–DV6b）+
`apps/yjs-server/test/sa7-a1-probe.mts`（A1 子进程探针，tsx 运行、按扩展名天然不进 tsc include）
**SA4 verdict 前置**: R2 = **pass**（§R2.3「零残余阻断…流水线可进入 SA7 动态验证」）→ 本验证合法进入
**SA7 verdict**: **pass（6/6 本地可验证项全绿 + 全量回归零回归；第 7 项 CI 触发证据 = 环境阻塞：PR 未建立，push/PR 为总控禁区）**

---

## Step 0：SA4 verdict 校对

```
[SA7 Step 0 结论]
SA4 verdict: pass（R1 pass + R2 pass）
操作: 进 Step 1
```

`…_sa4_review.md` 顶部 Verdict 行：R1 = pass（SA3 实现侧零剩余工作）；R2 = pass（回流核销，零残余阻断）。无洗白空间，无下发空间。

## Step 1：SA6 冻结测试复跑（红灯关）

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（13/13）
操作: 进入 Step 2
```

- 命令（后台独立进程，`setsid nohup`）：`npx vitest run apps/yjs-server/test`
- 结果：**Test Files 2 passed (2)；Tests 13 passed (13)；Type Errors no errors；exit 0**（日志 `/tmp/sa7-step1.log`）
- FS5b（SA6 回流后 sendRaw 直发）与 TF3（RawWsClient 回放）均绿——SA4 R2 §4 回流核销结论运行时复证。

## Step 2：SA4 §5「动态审核重点」七项逐条验证

> 每项一行裁定 + 证据。全部为真实运行（真实 TCP / 真实进程级异常观测 / 真实端口占用），
> 零静态推断替代。新增 7 用例见 §测试资产；复现命令见 §复现。

### 1. A5 红灯（同步 throw 的 verifier）——✅ PASS（DV1）

- 场景：`verifyToken: () => { throw new Error('sync-throw-from-verifier') }` + 合法 Bearer → upgrade。
- 断言（`issue164-sa7-dynamic.test.ts` DV1）：HTTP **403**（非 101，`sec-websocket-accept` 空）、`ws` 未建立；
  临时注册的 `process.on('uncaughtException')` / `process.on('unhandledRejection')` 计数 **0/0**
  （150ms 结算窗后核；二次请求仍 403——失败不污染后续裁决）。
- 运行时结论：同步 throw 在 promise executor 求值点折入 rejection → `verifier-threw` → 403，
  绝不逃逸外层 `.catch`（SA2 §R1.4-1 的远程崩溃向量在运行时确认消除）。

### 2. A1 红灯（无 alert + 缺面 transportFactory）——✅ PASS（DV2，子进程探针）

- 方法论：该路径**故意**制造进程级 uncaughtException，在 vitest worker 内触发会被 vitest 自身
  uncaught 收集打红整个 run——故以 `node_modules/.bin/tsx apps/yjs-server/test/sa7-a1-probe.mts`
  独立子进程观测（探针自注册 uncaughtException/unhandledRejection 计数器；DV2 spawn 并断言其
  stdout JSON + exit 0）。
- 探针实测输出（`/tmp/sa7-probe.log`，独立复跑两次 + vitest 内 2 次共 4 次全一致）：
  ```json
  {"upgradeStatus":101,"closeCode":1011,"closeReason":"transport-faces-missing","frames":[],
   "uncaughtCount":1,
   "uncaughtFirst":{"name":"TypeError","message":"transport missing required production faces: bufferedAmount, ping, onPong（§17：缺面 = 配置错误，非运行时降级）"},
   "unhandledCount":0,"unhandledFirst":null}
  ```
- 逐点对 SA4 §5-2 原文：**uncaughtException 捕获 TypeError 且 message 含 'bufferedAmount'** ✅；
  **unhandledRejection 处理器零触达**（P14 通道选择钉死：同步异常域而非 promise 域）✅；
  **零协议帧/零 HELLO_ACK**（`frames: []`）✅；**连接 1011 'transport-faces-missing' 收口** ✅；
  探针 exit 0（进程存活自证）✅。
- 与 SA4 E7（真实 ws 客户端 + alert 在场形态）互补：本项覆盖 alert **缺席**的缺省路径。

### 3. A2 红灯（永不 resolve 的 verifier）——✅ PASS（DV3）

- 场景：`verifyToken: () => new Promise(() => {})` + `timeouts: { helloTimeoutMs: 300 }` + 合法 Bearer。
- 断言（DV3）：`wsUpgrade`（握手超时 10s）在 **306ms** resolve `{status: 503, ws: undefined}`，
  状态行含 **'Auth Timeout'**；elapsed ∈ [helloTimeoutMs−100, helloTimeoutMs+2000]（实测远低于 10s
  握手超时——悬挂被 helloTimeoutMs 封顶打破，非 403 污染）；随后同服务 `wsUpgrade`（无凭据）
  → 401 即时返回（进程存活 + 服务继续裁决）。
- 运行时结论：pre-auth 等待封顶运行时成立；迟归 verifier 的 rejection 零 unhandledRejection
  （DV1/DV2 的进程级计数同时覆盖）。

### 4. D7 maxPayload 双层同界 ——✅ PASS（DV4，边界三点探测）

- 场景：`limits: { maxFrameBytes: 4096, maxBootstrapBytes: 2048, maxSyncDiffBytes: 2048,
  maxUpdateBytes: 1024, maxQueuedUpdateBytes: 4096 }`（整组满足 validateLimits 链式不变量）。
- 三个观测点（DV4，全部真实 wire 行为）：
  | 探测 | payload | 结果 | 层归属证明 |
  |---|---|---|---|
  | (a) 合法 HELLO | ≪4096 | HELLO_ACK 正常握手 | 界值非退化 |
  | (b) 认证前超限垃圾帧 | **4097** | **close 1009**，零协议帧 | ws 层（`maxPayload`）截断——若覆写未传播（缺省 8 MiB）将放行至协议层得 1002，1009 为传播的直接判据 |
  | (c) 界内垃圾帧 | **4000** | 通过 ws 层 → ERROR(BAD_MAGIC) 帧 + **close 1002** | 协议层拒绝形态（与 同形态负载在 得 1009 对照）|
- 运行时结论：组合根 `maxPayload = resolvedLimits.maxFrameBytes` 双层同界成立，limits 覆写真实传播。

### 5. A4(a) 运行时（EADDRINUSE）——✅ PASS（DV5）

- 场景：`net.Server` 占住端口 P → `createYjsHubServer({ listen: { port: P } })`。
- 断言（DV5）：第一次 `start()` reject **code=EADDRINUSE**（同步 reject 非悬挂）；
  **失败复位后重试 `start()` 仍 reject EADDRINUSE（真实根因），非 'YJS_HUB_SERVER_STARTED'「重复 start」**；
  释放占用端口后**同一实例**第三次 `start()` 成功且端口 = P，随后无凭据请求得 401（复用后功能完整）。
- 运行时结论：相位 1 失败复位（`started = false`）与真实根因上报在运行时成立。

### 6. FS6 深水变体（活跃 channel 下 close()）——✅ PASS（DV6a 被动 deadline + DV6b 主动收口）

- 前置（两变体同）：101 → HELLO_ACK → OPEN_NAMESPACE → OPEN_OK(bootstrap) → BOOTSTRAP_SNAPSHOT →
  BOOTSTRAP_ACK——hub 侧 channel 处于**非终态活跃**（冻结 FS6 仅覆盖 ready 零 channel 形态）。
- **DV6a 被动 deadline**（`closeTimeoutMs: 400`）：`close()` 期间客户端观测 **GOAWAY
  `{reasonCode:'SERVER_SHUTTING_DOWN', drainTimeoutMs:400}`** 先于 close 上 wire → drain 窗末
  **close 1001 'hub-shutdown'** → `close()` Promise 在预算内结算（真实等待 drain 窗）→
  `registry.getStatus().state === 'stopped'` → 新连接被拒（listen 已停）。436ms 全绿。
- **DV6b 主动收口**（`closeTimeoutMs: 5000`）：GOAWAY 后客户端发 **CLOSE_NAMESPACE** →
  收到 **CLOSE_OK** → 连接 **1001 'hub-shutdown'** 提前收口（实测远早于 5000ms deadline——
  `maybeFinishDrainEarly` 自然 CLOSE 握手路径）→ close() 结算 + Registry stopped + 端口拒绝。
- 运行时结论：§21 停机编排对活跃 channel 连接的 GOAWAY/drain/deadline/提前完成三入口在真实
  TCP 上全部按包语义工作；组合根只编排不越权的边界（GOAWAY 归包）运行时成立。

### 7. SA6 修复后 CI 环境复跑（gh run view --log 摘录）——⚠ 环境阻塞（非实现缺陷，PR 建立后补录）

- 只读查询证据（2026-08-30，均 exit 0）：
  - `gh run list --branch fix/issue-164-on-docs-phase-5-websocket-replication --limit 5` → **空**（无任何 CI run）
  - `gh pr list --head fix/issue-164-on-docs-phase-5-websocket-replication --state all` → **空**（无 PR）
  - `git ls-remote --heads origin fix/issue-164-on-docs-phase-5-websocket-replication` → **空**（分支未 push）
- 阻塞原因：总控指令明确「不得 push/PR/lifecycle 操作」；SA4 R2 亦预登记「第 7 项在 PR 建立
  后由 SA7 从 gh run view --log 摘录」。**CI Node 20/24 双矩阵触发证据（含 FS5b/TF3 转绿行）
  属 PR 建立后的补录项**，本地无等效替代（ci.yml 每 PR 触发，无 nightly/push 路径可借）。
- 本地最强等价证据（已提供）：全量 `pnpm test`（与 ci.yml test job 同命令）**194 files / 2186
  tests 全绿 0 failed**（含 FS5b/TF3 的 13/13 与本报告新增 7 例），`pnpm typecheck`（同 CI 命令）
  **0 errors**。

## 全量回归证据（真实运行，后台独立进程）

| 命令 | 结果 | 日志 |
|---|---|---|
| `npx vitest run apps/yjs-server/test`（SA7 后） | **Test Files 3 passed (3)；Tests 20 passed (20)（13 SA6 + 7 DV）；Type Errors no errors；exit 0**（复跑两次全绿，时序断言无抖动） | `/tmp/sa7-apps2.log`、`/tmp/sa7-apps3.log` |
| `npx tsc -p apps/yjs-server/tsconfig.json --noEmit` | **exit 0（0 errors）**（include 含 test/**；`--listFiles` 亲核：新 .ts 测试在列、`.mts` 探针按扩展名不在列——设计内） | — |
| `pnpm test` 全量 | **Test Files 194 passed (194)；Tests 2186 passed (2186)；Type Errors no errors；exit 0**（SA4 R2 基线 193/2179 → +1 文件 +7 测试，既有零回归） | `/tmp/sa7-full.log` |
| `pnpm typecheck` | **exit 0（0 errors；12 项目含 apps/yjs-server）** | `/tmp/sa7-tc2.log`（注：首次与 pnpm test 并行跑时日志文件被本 SA7 自身 shell 重定向竞态删除、exit 1 无日志可查；干净单独复跑 exit 0 为准） |

## 测试资产与纪律

- `apps/yjs-server/test/issue164-sa7-dynamic.test.ts`：7 用例（DV1/DV2/DV3/DV4/DV5/DV6a/DV6b），
  逐条映射 SA4 §5-1…§5-6；零源码 grep，全部锚在 HTTP 状态行 / WS 帧（codec 编解码）/ 关闭码 /
  Registry 状态 / 进程级异常计数；port 0（无固定端口，无需 fuser）；有界轮询等待。
- `apps/yjs-server/test/sa7-a1-probe.mts`：A1 子进程探针（P14 通道隔离方法论见 §2）；
  运行方 = 根 devDependency `tsx`（root package.json `generate`/`schema:check` 同源工具，CI 必装）；
  不进 vitest include（非 `.test.ts`）也不进 tsc include（`.mts` 扩展名）——探针为 tsx
  transpile-only 运行件，类型由主测试文件的断言面约束。
- **零生产代码改动**：`git status` 仅 2 个新增测试文件（本报告与 dispatch log 追加属流水线档案）。
  未 push、未建 PR、未做任何 lifecycle 操作。

## 复现

```bash
cd <worktree>
npx vitest run apps/yjs-server/test            # 20/20（含 DV1–DV6b）
./node_modules/.bin/tsx apps/yjs-server/test/sa7-a1-probe.mts   # A1 探针单跑，stdout JSON
pnpm test                                      # 全量 194 files / 2186 tests
pnpm typecheck                                 # 0 errors
```

## 裁定与交接

- **SA7 verdict: pass**。SA4 R2 pass 之上，七项动态重点中六项本地全绿、零可修复阻断项、
  零 residual fail；实现（commit a1fdcfb）+ 回流（commit 5c4b235）在真实运行链路上未发现任何缺陷。
- **唯一开放项（非阻断、非实现缺陷）**：第 7 项 CI 触发证据需 PR 建立后从
  `gh run view <run-id> --log` 摘录 FS5b/TF3 转绿行（Node 20/24 双矩阵）——归总控在后续
  publication/CI observation 阶段处置，SA7 已提供同命令本地全绿基线。
- 无需 SA3 修复轮；无需 SA4 复审。若后续轮次需要，复验范围 = 本报告 §Step 2 七项 + 全量四命令。
