# SA3 Implementation Report

> 本文件覆盖 issue #269 的两次 SA3 迭代：
> **iteration 2（本次：GitHub CI shard 2/6 失败修复）** 见下；**iteration 1（归档：#269 REST 实现 + rebase，
> 已提交）** 原文保留在文末「Iteration 1（归档）」。
> 本次派发：`sa-3354cb58-9000-44d5-9c1a-6c7539d8bb65`（mabf-sa3，phase=implementation，iteration=2）；
> Worktree：`/home/wangjian/nomicore-fix-issue-269`（branch `mabf/issue-269`，HEAD `e84c160`，起手 clean）。

## Iteration 2 — CI 失败修复：`hub-restart-static-target-red` 的 backoff 窗口竞争

### Inputs consumed

| 输入 | 位置 | 使用 |
|---|---|---|
| 本次 dispatch | Host 提示词（iteration 2 / `sa-3354cb58…`） | 业务工作 = 修复具体 CI 失败并保留测试意图、不得弱化/skip/mask；comments 快照 `[]`（无 owner 要求）；要求最小安全语义修复 + 聚焦证据 + changed paths |
| 失败证据（CI） | Actions run `34556608627`，job `test (20, 2)`（id `103130502187`） | `apps/yjs-server/test/hub-restart-static-target-red.test.ts:262` → `AssertionError: expected 'handshaking' to be 'backoff'`；该测试 13380ms；分片汇总 `Test Files 1 failed | 47 passed`、`Tests 1 failed | 459 passed` |
| 任务简报 | `wiki/raw/task_issue-269.md` | issue #269（REST create）业务上下文；与本修复无文件面重叠（本修复不触碰 `packages/namespace-api/**`） |
| 上游实现/评审/契约 | `wiki/raw/task_issue-269_{design,sa2_review,sa6_contract,sa4_review,sa3_impl}.md` | 确认 #269 的 29 冻结用例、实现面与 ALLOW/DENY（iteration 1 §11）均不在本修复范围内；本修复不改变其任何断言 |
| 协议契约（只读） | `docs/protocols/instance-replication-v1.md` §15（L426-431） | 重拨延迟 full jitter：`cap = min(maxBackoffMs, baseBackoffMs * 2^attempt)`、`delay = random(0, cap)`；只有 ready 稳定超过 `resetAfterMs` 才清零 attempt |
| 实现（只读） | `packages/ws-replication/src/peer-connection.ts:913-953`（`onTemporaryFailure`）、`:1067-1077`（`setState` 迁移事件）、`:138-151`（`connection-backoff-scheduled` 发射） | 根因判定：`delay = max(0, random() * cap)` 无下界；每次定时器 fire 都发 `connection-state-changed`（窗口新鲜度可观测） |
| 被修对象 | `apps/yjs-server/test/hub-restart-static-target-red.test.ts`（issue #229 回归） | 唯一 changed path（测试面；无生产代码改动） |

未派发本修复的 SA1 设计 / SA2 评审 / SA6 红灯契约（dispatch 直接指定修复对象与约束）：不发明架构、不改验收语义，
只做「让第 262 行断言的**前提**成为确定事实」的最小修复。

### Root cause

旧第 260-262 行假设「`backoff: { baseMs: 5_000, maxMs: 5_000 }` ⇒ Peer 在 Hub 重启窗口内必然仍处
`backoff`，从而保证写入先于重拨」。该假设与协议 §15 的 full jitter 直接矛盾：`peer-connection.ts:933-935`
的实际延迟是 `delay = max(0, random() * min(maxMs, baseMs * 2 ** (attempts - 1)))`——帽值 5s 只给**上界**，
**没有下界**（可以接近 0）。因此：

- Hub v2b boot 期间，Peer 按随机延迟反复拨号；端口未开 ⇒ `backoff → connecting → handshaking → backoff`
  （本机 ~1ms 内失败）；
- Hub `listen` 一旦完成，**同一次拨号**即可停留在 `handshaking` 直到 HELLO_ACK；
- 测试在 `waitForEvent(hubV2b, 'ready')` 后立即取 `status`，于是在 CI（慢 runner + 冷 tsx）间歇观测到
  `handshaking`（run `34556608627`），断言失败。

**探针证据（临时脚本，仓库外；旧配置 `baseMs=maxMs=5000`，Hub SIGTERM 后 20s 事件面）**：

```text
delayMs values: [579, 848, 2580, 2121, 979, 4158, 1708, 4366, 1958, 12, 2863]
transitions: ready→backoff, 随后 10 轮 backoff→connecting→handshaking→backoff（每次间隔即随机延迟）
```

即：5s 帽配置下延迟在 `[0,5000)` 均匀分布（含 12ms 样本），第 262 行断言的 `backoff` 只是随机窗口里的
一个瞬态，不是不变量。CI 失败与本地偶发差异由此可解释（本地 hub boot ~0.35-0.5s，命中窗口概率高）。

### Fix（测试面最小语义修复；第 262 行断言文本与语义均未改）

1. 新增 helper `waitForArmedBackoffWindow(proc, fromIndex, minDelayMs, timeoutMs, what)`：以事件流中
   **最新**一条 `connection-backoff-scheduled` 为准，要求 `delayMs ≥ minDelayMs` 且**未被后续
   `connection-state-changed` 取代**（即定时器尚未 fire，窗口仍新鲜），返回该 `delayMs`；不满足则等下一次
   武装；超时以诊断错误（含已观测 `delayMs` 列表 + stderr）**响亮失败**，绝不静默放行或跳过。
2. Peer 的 backoff 帽值改为运行期实测而非硬编码：`hubRestartBudgetMs = ceil((hubV2 boot 实测 × 2 + 2s)/500ms)*500ms`
   （v2b 与 v2 同 config/同 rootDir；×2 覆盖「运行中 Peer 竞争下更慢」的边际，+2s 为 status 查询与
   verify-write 余量）；`backoffCapMs = 2 × hubRestartBudgetMs`；peer 配置改为
   `backoff: { baseMs: backoffCapMs, maxMs: backoffCapMs, resetAfterMs: 60_000 }`。full jitter 下
   「已武装 delayMs ≥ 预算」以约 50% 概率出现（帽子=2×预算时等待期望最短），并保证预算内可完成重启。
3. 重启 Hub **之前**先取窗口：`armedDelayMs = await waitForArmedBackoffWindow(peer, peerEventOffset, hubRestartBudgetMs, 90s, …)`，
   然后 `spawn hub v2b → waitForEvent('ready') → status → expect(connectionState).toBe('backoff') → verify-write(11)`。
   窗口覆盖 `boot + status + 写`，故断言的**前提**（Peer 处于已武装 backoff）成为确定事实；断言文本与
   「写发生在断线窗口内」的语义完全保留，仅把失败消息升级为 `Hub restart took <ms> of the armed <ms> backoff window`。
4. 后续 `channel-state-changed → live` 的等待上界由硬编码 60s 改为 `backoffCapMs + 30s`：Peer 只能在已武装延迟
   （≤ cap，其中预算部分已被重启消耗）内重拨，原上界在慢环境下可能小于 2×预算；属上界修正，非断言弱化。
5. 重启窗口与 Peer target/凭据/配置不变、不发恢复命令等既有断言（`goaway-received` 缺席、无 `blocked`、
   `peerProc.exitCode === null`、不 re-add / 不 notify-auth-changed / 不改配置）逐条保留。

**为什么是测试面修复而非生产代码修复**：full jitter 是协议 §15 / ADR-0010 的规范行为（上限抖动即抗惊群），
Peer 在 Hub boot 期间重拨并瞬时进入 `handshaking` 是**正确**语义；不可为让测试变绿而给生产加确定性 jitter、
env override 或下界（那会改变规范行为）。失效的是测试对「帽值 ⇒ 延迟下界」的错误推断，故修在测试。

### Changed paths

| Path | Scope | Change |
|---|---|---|
| `apps/yjs-server/test/hub-restart-static-target-red.test.ts` | dispatch 指定修复对象（测试面） | +73 / -4：新增 `waitForArmedBackoffWindow` helper；backoff 帽值改为实测预算派生；重启前取已武装窗口后再启动 Hub；live 等待上界改为 `backoffCapMs + 30s`；注释与失败消息同步（断言文本未变） |
| `wiki/raw/task_issue-269_sa3_impl.md` | SA3 报告（原位更新） | 本文件：新增 iteration 2 章节，iteration 1 原文保留为归档 |

未改动：`packages/**`（含 `packages/ws-replication/**`、`packages/namespace-api/**`）、`apps/yjs-server/src/**`、
其它 `apps/yjs-server/test/**`、`.github/**`、`docs/**`、`tsconfig*`、`package.json`、`.github/ci/test-durations.json`。

### File scope check

| Changed path | 授权来源 | Purpose |
|---|---|---|
| `apps/yjs-server/test/hub-restart-static-target-red.test.ts` | 本次 dispatch 逐字点名该文件为修复对象（本修复无 SA1 ALLOW 列表） | 让第 262 行断言的前提确定化；断言/验收语义逐条保留 |
| `wiki/raw/task_issue-269_sa3_impl.md` | SA3 角色固定产物（`sa3-implement-fix` skill） | 原位更新实现报告 |

范围结论：2 个 path，**无 ALLOW 扩张**（未新增/修改任何生产代码或其它测试；未触碰 iteration 1 的 ALLOW/DENY 面）。

### Verification

| # | Command | Result | Evidence |
|---|---|---|---|
| V1 | 根因探针（仓库外临时脚本，旧配置 `baseMs=maxMs=5000`）：Hub v1 provision → Hub v2 → Peer 静态 target live → SIGTERM Hub → 采集 20s 事件面 | 采集到 11 条 `connection-backoff-scheduled`，`delayMs = [579, 848, 2580, 2121, 979, 4158, 1708, 4366, 1958, 12, 2863]`，10 轮 `backoff→connecting→handshaking→backoff` | 证明「5s 帽 ⇒ 延迟下界」不成立，第 262 行探查的是瞬态 |
| V2 | 修复前基线：`NODE_OPTIONS=--conditions=nomicore-source vitest run apps/yjs-server/test/hub-restart-static-target-red.test.ts --typecheck.enabled=false` × 6 | 6/6 通过（本机 hub boot 快，未复现 CI 时序；与 CI 失败不矛盾，见 V1） | 本机 wall 21-23s/次 |
| V3 | 修复后：同一命令 × 10（4 + 6 连续） | **10/10 通过**（exit 0）；wall 18-24s/次 | 稳定性证据；CI 日志中的 `handshaking` 观测不再出现 |
| V4 | 修复后带临时诊断（`hubRestartBudgetMs` / `armedDelayMs` / 重启耗时 / 状态，证据采集后已移除） | `hubRestartBudgetMs=3000`、`backoffCapMs=6000`；`armedDelayMs ∈ {3343,3565,3793,3839,5103,5222,5754,5881}`；Hub 重启 `restartElapsedMs = 451-510ms`；`state = backoff`（全部样本） | 证明窗口（≥3000ms）显著覆盖实际重启耗时（≈0.5s），断言前提确定成立 |
| V5 | `pnpm typecheck`（根，15 包链式 tsc，含 `apps/yjs-server/tsconfig.json`） | exit 0（0 error） | 类型门 |
| V6 | `NODE_OPTIONS=--conditions=nomicore-source vitest run apps/yjs-server/test --typecheck.enabled=false`（app 全量包验证入口） | `Test Files 30 passed (30)`、`Tests 162 passed (162)`（含被修测试） | 无同包回归；该套件亦覆盖 `stdin-error-chain-red`（同款 hub 重启 + peer 重拨路径） |
| V7 | `git diff --stat` / `git status --short` | 仅 1 个测试文件 modified（+73/-4）+ 本报告；无临时诊断代码残留（`grep -n "tmp-gate\|tmp-diag\|tmp-phase"` 0 命中） | 范围与清理核对 |

修复前后关键点对照（同一断言，两种前提）：

```text
修复前：hub v2b ready ──► status（Peer 可能在随机重拨窗口：backoff|connecting|handshaking|ready）──► 间歇失败
修复后：等 armed delayMs ≥ 预算 ──► spawn hub v2b ──► status（窗口未过期 ⇒ 必为 backoff）──► verify-write
```

### Deferred verification

- **CI 复跑**：本修复需 Controller 在 GitHub CI（shard 2/6，Node 20 与 24 两腿）复跑确认；SA3 不执行 push/CI。
- **全仓 `pnpm test`**：非 SA3 范围（改动面为单测试文件）；已执行 app 包全量（V6）+ 根类型门（V5）。
- **`.github/ci/test-durations.json` 权重**：该文件仅供分片均衡（漂移不影响正确性/不漏跑）。既有条目
  `apps/yjs-server/test/hub-restart-static-target-red.test.ts: 19965ms` 与本机新耗时 18-24s 同量级，漂移可忽略；
  若需刷新，按 `scripts/ci-test-shard.mjs --update` 在空闲机/全量报告上执行（不属本次最小修复）。
- **慢环境残余风险**：若某环境 Hub 二次 boot > `hubRestartBudgetMs`（= 首次实测 × 2 + 2s），第 262 行会以
  带时间信息的断言消息响亮失败（而非静默通过）；此时应上调预算公式的边际系数，属后续可调项，非本次阻塞。

### Deviations or blockers

- **无阻塞**。一处需显式声明的范围事实（D7）：本次修复无 SA1 设计/ALLOW 列表（dispatch 未派发），
  授权来源是 dispatch 逐字点名的修复对象；改动严格限定在该测试文件 + SA3 报告，未触碰任何生产代码。
- **D8（测试面语义选择）**：选择「等已武装窗口再重启 Hub」而不是「把 `toBe('backoff')` 放宽为
  `not.toBe('ready')`」——后者会弱化断言且仍留毫秒级竞争窗口；本方案保持断言逐字不变并让前提确定成立。
- **D9（时间成本）**：修复后本机 18-24s（原 21-23s wall，CI 原 13.4s）。CI 上 cap 由实测 boot 派生，
  等待期望 ≈ 2×预算（约 +10-20s），仍在 240s 用例超时与 90s 窗口超时内。

### Suggested commit message

```
fix(#229): 消除 hub-restart-static-target 的 backoff 窗口竞争（CI shard 2/6）

- 根因：Peer 重拨延迟是协议 §15 full jitter（delay = random(0, cap)），
  5s 帽值不提供延迟下界；旧断言假设 Hub 重启窗口内必然仍处 backoff，
  CI 上在 Hub ready 后立即查询观测到 handshaking
- 修复（仅测试面）：新增 waitForArmedBackoffWindow，等最新一条已武装且
  delayMs ≥ 实测重启预算的 connection-backoff-scheduled 事件后再启动 Hub；
  预算 = 首次 boot 实测 × 2 + 2s，抖动帽 = 2×预算
- 保留：backoff 断言逐字不变、无 skip/弱化；断线期写 + 自动恢复 + 收敛语义不变
- live 事件等待上界改为 backoffCapMs + 30s（Peer 只能在已武装延迟内重拨）
```

---

# Iteration 1（归档）：#269 REST create 实现与 rebase

> 阶段：implementation（iteration 1）。派发：`sa-ea0d25aa-639d-4cba-93da-f1bb19896bef`（mabf-sa3）。
> Worktree：`/home/wangjian/nomicore-fix-issue-269`，branch `mabf/issue-269`。
> **本迭代业务工作：把 #269 实现（`7b40f50`）rebase 到当前 Parent PR base `209b046`
> （`feat(namespace-api): validate REST namespace creation (#297)`，即 issue #268 的落地内容），
> 解决 4 个冲突路径，并在合入语义下保持 #269 已批准验收契约与实现语义。**
> 实现依据：`wiki/raw/task_issue-269_design.md`（SA1）→ `wiki/raw/task_issue-269_sa2_review.md`
> （`approve`，0 BLOCKER / 0 MAJOR）→ `wiki/raw/task_issue-269_sa6_contract.md`（`approve`，29 用例冻结）
> → `wiki/raw/task_issue-269_sa4_review.md`（`approve`，0 BLOCKER / 0 MAJOR，OBS-A/B）。
> Issue-comment REST 快照 `[]`（dispatch 明示）⇒ 无 owner 评论级要求。

## Inputs consumed

| 输入 | 位置 | 使用 |
|---|---|---|
| 本次 dispatch | Host 提示词（iteration 1 / sa-ea0d25aa…） | rebase 冲突解决任务与验收保持要求；comments 快照空 |
| 批准设计 | `wiki/raw/task_issue-269_design.md` | §7.1 映射表 T1–T11、§7.3 取消状态机、§7.4 事件契约、§7.6 #268 共享 seam、§7.7/§7.8 接口与伪代码、§11 ALLOW/DENY |
| SA2 评审 | `wiki/raw/task_issue-269_sa2_review.md` | `approve`；Required revisions 为空；OBS-1~4（OBS-2 文档同步义务） |
| SA6 验收契约 | `wiki/raw/task_issue-269_sa6_contract.md` | 29 个冻结用例（mapping 9 / abort 5 / observer 6 / support 9）+ H-M/H-D/H-A + R1–R4 + §13.4 哈希 + C5「#268 合入后必须保持绿」 |
| SA4 实现后审查 | `wiki/raw/task_issue-269_sa4_review.md` | `approve`；OBS-A（文档概括句过宽）、OBS-B（实现细节入 Deviations）；残余风险行点名「#268 合入后 C5 与 abort 先于 413」 |
| #269 冻结测试（5 文件） | `packages/namespace-api/test/rest-{failure-contract-harness,registry-failure-mapping-contract,abort-boundary-contract,observer-contract,failure-contract-support}*` | 红灯契约（只读；sha256 已复核，见 E1） |
| Parent PR base（#268）设计/契约/实现 | `wiki/raw/task_issue-268{,_design,_sa6_contract,_sa4_review,_sa3_impl}.md`、`src/request-body.ts`、`src/rest-problem.ts`、`test/rest-create-*.test.ts`、`test/rest-validation-harness.ts` | 冲突两侧语义来源；合入后必须保持绿的 61 个 base 用例 |
| #267 冻结套件 | `test/rest-{create-hub,role-gate-routing,contract-support,public-seam-wiring}*` | 35 个 legacy 用例（保持绿） |
| ADR | `docs/adr/0015`（L103–113 limits、L113 signal、L163–182 错误契约、L186–190 观测） | 只读核对（未修改） |
| SA8 门禁（两轮） | 前序 SA3/SA4 报告转述的 `artifacts/sa8-conflict-report-issue-269{,-design-recheck}.md`（`clear`/`clear`） | 本 worktree 内**不存在**该两文件（见 Deviations D6）；无冲突未决结论 |

## Existing worktree reconciliation

- 起始状态即 **interactive rebase in progress**：`pick 7b40f50`（#269 实现，已应用）→ 待应用
  `c466b16 docs(issue-269): add SA8 conflict-gate reports and dispatch evidence`；onto `209b046`。
  4 个路径 `UU`：`packages/namespace-api/{AGENTS.md,README.md,src/create-namespace.ts,src/rest.ts}`；
  `src/index.ts` 自动合并（#269 的两行 type re-export 已 staged）。
- 前序 SA3 实现报告（`wiki/raw/task_issue-269_sa3_impl.md`，iteration 0）描述的是 **#267 骨架**上的实现；
  本迭代**原位重写**为「rebase 到 #268 base 后的合入实现」，并保留仍然成立的证据。
- 冲突两侧性质：#269 侧把 4xx/422 与 limits 留给「后续票」并按 rejection 结算；Parent base 已把
  `step 3`（owner/query/媒体层）与 `step 4–5`（有界读取 + 严格 UTF-8 + 形状/资源检查 + limits）落地为
  problem Response，且 observer 为「显式注入 + 零发射」。合入必须**同时**满足两侧冻结用例（#269 的 29 +
  base/legacy 的 96 = 125），并按设计 §7.6 保持「读取段内 abort 优先于 413」的排序不变量。

## Conflict resolution

| 路径 | 冲突区域 | 解决（保留两侧，取并集） |
|---|---|---|
| `src/create-namespace.ts` | 头注；imports；step 4/5 vs 最小读取；`registry.create` 前后分叉 | 以 #269 的**对象 deps + T1–T11 映射 + 发射 helper + release diagnostic + 私有 abort 错误类**为骨架；step 4 改为复用 base 的 `readBoundedBodyText`（有界 + 严格 UTF-8）并在其外层保留 #269 的三道 abort 闸门；step 5 形状/资源检查、malformed JSON 400、schemaText 413 与 `deriveSchemaIdentity` 422 分支逐字保留 base 行为；T5（`NAMESPACE_INVALID_IDENTITY` 等未映射窄 issue）保持 fail-loud rejection |
| `src/rest.ts` | 头注切片边界；`RestRouterOptions`；`RestRouterConfig`；`handle` 调用；`resolveLimits` | 保留 base 的 step 1–5 分发（route/method → role → owner/query/媒体层 → orchestration）、`ResolvedRestRouterLimits` 配置与 `resolveLimits` 构造门；采用 #269 的 `RestMetricsEvent`/`RestDiagnosticEvent` 类型、事件化 observer 签名与 deps 传递；`resolveLimits` 跨字段判定按 D1 收敛（见下） |
| `src/index.ts` | 无（自动合并） | #269 的两行 type re-export 保留；未手改 |
| `AGENTS.md` / `README.md` | 切片/延后清单两段 | 合并为单一事实陈述：4xx/422 + limits（#268）与 503/500 + 取消边界 + 双 observer（#269）均已实现；仍延后 = metrics `rejected` 发射策略、5xx body `message`、#270 server 生命周期；并落实 SA4 OBS-A 的概括句修正（metrics 事件口径改为「失败映射拥有的终局路径」+ 明确 4xx/422/403/405 零发射） |

**跨票语义裁决（本次 rebase 的唯一新裁决，D1）**：C5 冻结用例以 `limits: { maxBodyBytes: 16 }`
构造 router，而 base 的跨字段门对**合并默认后的有效值**要求 `maxSchemaTextBytes <= maxBodyBytes`
（默认 schema 上限 256 KiB > 16）⇒ 构造期 `TypeError`，C5 无法到达 abort 判定（首跑实测
`TypeError: limits.maxSchemaTextBytes 不得大于 maxBodyBytes`，rest.ts:196）。两侧冻结断言
（base AC2「两键显式矛盾 → TypeError」与 C5「单键可构造 + aborted 非 413」）必须同时保持，故把
跨字段门收敛为：**两键都显式给出且矛盾 ⇒ TypeError（矛盾指令 fail loud）；只给出一键时，另一键的
默认值按不变量向显式值收敛**（显式 body 上限压缩默认 schema 上限；显式 schema 上限抬升默认 body 上限），
使 ADR 0015 L113 的 `maxSchemaTextBytes <= maxBodyBytes` 对**有效配置恒成立**。未改写任何调用方显式值、
未弱化任何冻结断言、未新增 env override / fallback。

## Current implementation semantics (merged)

1. **失败映射（#269 §7.1）**：`REGISTRY_NOT_ACCEPTING` → 503；`NAMESPACE_CREATE_FAILED` → 500；
   fatal `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`；fatal `committed:false` /
   unknown exception / `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS` → 500
   `INTERNAL_ERROR`（后者 + diagnostic）；未映射窄 issue（`NAMESPACE_INVALID_IDENTITY`）保持 rejection。
   5xx/503 body 为 #269 的最小 `{"code"}` 形状。
2. **请求校验（#268）**：step 3 → 有界读取（`Content-Length` 提前拒绝 + stream byte 上限 + 严格 UTF-8）
   → malformed JSON / 形状 / 数字范围 400、body/schemaText/depth/nodes 413、媒体层 415、
   VFSL schema / ROOT 422（`NAMESPACE_SCHEMA_INVALID` / `NAMESPACE_ROOT_INVALID` 由 base 的 422 映射保留），
   全部经 `rest-problem.ts` 固定 problem shape。
3. **取消边界（#269 §7.3，适配共享 seam）**：读取段三道闸门——①入口同步判定 `signal.aborted`（先于任何
   读取期检查，含 413）；②读取段内被观察到的 abort（共享读取模块自身观察 signal：`reader.cancel()`
   使挂起读有界结算）在读取结算处再核对；③读取胜出后同步再核对。abort ⇒ metrics `{outcome:'aborted'}`
   （无 code/status）+ 零 diagnostic + 有界 rejection（固定 message `ABORTED_BODY_READ_MESSAGE` +
   `signal.reason` 作 cause）+ Registry 零触达。`registry.create` 一经调用零 signal 观察。
4. **观测（#269 §7.4）**：映射拥有的终局路径各恰一 metrics 事件（T1–T4/T6–T8/T10/T11 + T9 aborted）；
   4xx/422 problem 族与 403/405 零发射；diagnostic 仅三类 kind + exact cause 引用；全部经隔离 helper，
   observer throw 不改 HTTP 结果。
5. **成功路径**：DTO 复制 → release 恰一次（失败仍 201 + `lease-release-failure` diagnostic）→
   metrics `succeeded` → 201（无 `Location`）。

## SA2 / SA4 finding 落实

| Finding ID | Implementation | Result |
|---|---|---|
| SA2 Required revisions | 为空（0 BLOCKER / 0 MAJOR） | 无遗留 |
| SA2 OBS-1（§7.4.2 概括句对 T5/body 族不成立） | 实现按 T 表精确口径；本轮文档同步进一步把概括句改为「映射拥有的终局路径」并显式写出 4xx/422/403/405 零发射 | 落实（文档与实现一致） |
| SA2 OBS-2（MINOR：包文档失效表述） | `AGENTS.md`/`README.md` 在合入语义下重写 observers 条目、失败映射条目、取消边界条目、Deferred scope | 落实；无失效表述 |
| SA2 OBS-3（ADR 折入义务属治理面） | 无实现动作（`docs/adr/**` 属 DENY）；在 Deferred verification 登记 | 记录，不阻塞 |
| SA2 OBS-4（malformed JSON × abort） | 读取 seam 在结算处先核对 `signal.aborted`；未被观察为 abort 的 malformed JSON 走 #268 的 400 `MALFORMED_JSON`（零事件、Registry 零触达） | 行为与设计 SM-9 及 #268 契约一致 |
| SA4 OBS-A（文档概括句过宽 + `code` 键表述） | 已按建议改写 `AGENTS.md` observers 条目与 `README.md` Public API 条目：metrics 事件口径限定为「失败映射拥有的终局路径」，并声明 4xx/422 与 403/405 过渡期零事件、`code` 仅非 2xx/非 abort 出现、`status` 仅存在 Response 时出现 | 落实（MINOR，本轮处理） |
| SA4 OBS-B（实现细节集中到 Deviations） | 见 Deviations D2/D3（abort rejection 形状承接 base、读取段复用 base 的单机制） | 落实（MINOR，本轮处理） |
| SA4 残余风险「#268 合入后 C5 与排序不变量」 | C5 实跑转绿（pre-aborted + `maxBodyBytes:16` ⇒ aborted 非 413、零触达、metrics `['aborted']`）；读取 seam 在任何读取期结局返回/抛出前核对 `signal.aborted`；入口判定先于任何读取期校验 | 落实 |

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/namespace-api/src/create-namespace.ts` | §7.1/§7.3/§7.4/§7.6/§7.7/§7.8 | 合入：对象 deps（新增 `limits`）+ T1–T11 映射 + 发射 helper + 最小 `{code}` 5xx/503 + release diagnostic + 私有 abort 错误类（承接 base message/cause）+ 读取 seam 三道闸门复用 base `readBoundedBodyText` + #268 step 5/422 分支保留 |
| `packages/namespace-api/src/rest.ts` | §7.4.1/§7.7 + #268 limits 面 | 合入：保留 base step 1–5 分发与 `resolveLimits`；新增/保留 `RestMetricsEvent`/`RestDiagnosticEvent`、事件化 observer 签名、deps 传递；`resolveLimits` 跨字段收敛（D1）；头注切片边界合并 |
| `packages/namespace-api/src/index.ts` | §7.7 | #269 的两行 type re-export（rebase 自动合并，未手改） |
| `packages/namespace-api/AGENTS.md` | §1 目标 4 + SA2 OBS-2 + SA4 OBS-A | 合入两份 deferral 清单；observers/失败映射/取消边界/延后项重写为单一声明 |
| `packages/namespace-api/README.md` | 同上 | Public API + Deferred scope 合并重写（含 limits 跨字段口径与 C5 不变量） |
| `wiki/raw/task_issue-269_sa3_impl.md` | ALLOW 行 6 同类（SA3 实现报告） | 本报告（原位重写） |

未改动（DENY/范围外）：`packages/namespace-api/test/**`（16 文件字节未变，见 E1/E2）、
`src/request-body.ts`、`src/rest-problem.ts`、`package.json`、`packages/namespace-registry/**`、
`packages/vfsl/**`、`packages/persistence/**`、`docs/adr/**`、`CONTEXT.md`、`docs/protocols/**`。
无 4xx/422/limits 语义的重新实现（沿用 base），无 #268 抢跑改写。

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/namespace-api/src/create-namespace.ts` | ALLOW 行 1（readRequestBody / 失败映射 / 发射 helper / release diagnostic / 私有 abort 错误类 / 签名扩展） | 合入 #268 读取校验 + 保留 #269 映射与观测 |
| `packages/namespace-api/src/rest.ts` | ALLOW 行 2（observer 类型事件化 / 事件类型定义导出 / observers 传递 / 头注 deferral 更新） | 合入；`resolveLimits` 跨字段收敛为冲突解决必要项（D1） |
| `packages/namespace-api/src/index.ts` | ALLOW 行 3（re-export 两个事件类型） | rebase 自动合并 |
| `packages/namespace-api/AGENTS.md` | ALLOW 行 4（deferral 清单更新 + SA2 OBS-2 失效表述同步） | 合入 + SA4 OBS-A |
| `packages/namespace-api/README.md` | ALLOW 行 5（Public API / Deferred scope 更新 + SA2 OBS-2） | 合入 + SA4 OBS-A |
| `wiki/raw/task_issue-269_sa3_impl.md` | ALLOW 行 6 同类（SA3 报告） | 本报告 |

范围结论：6 个 path，**无 ALLOW 外改动、无 ALLOW 扩张**（未新增 `request-body.ts`/`rest-problem.ts` 的导出或修改）。

## Verification

| # | Command | Result | Evidence |
|---|---|---|---|
| F0 | 冲突标记扫描 `grep -rn "^<<<<<<< \|^>>>>>>> \|^=======$" packages/namespace-api/{src,AGENTS.md,README.md}` | 0 命中（exit 1） | 4 个冲突路径内容已解决 |
| F1 | `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test`（D1 修复后连跑 8 次；其间仅有包文档文本修订，源码未再变更） | 每次 `Test Files 13 passed (13)`、`Tests 125 passed (125)`、`Type Errors no errors`（exit 0） | 125 = #267 冻结 35 + base(#268) 61 + #269 冻结 29；含 C5（aborted 非 413）、base AC2（显式矛盾 TypeError）、base D6（abort message + cause） |
| F1a | 首次运行（D1 修复前） | `1 failed \| 12 passed`，失败点 = C5 构造期 `TypeError: limits.maxSchemaTextBytes 不得大于 maxBodyBytes`（rest.ts:196） | 证明 D1 是 C5 与 base AC2 的真实冲突面，非测试问题 |
| F2 | `node_modules/.bin/tsc -p packages/namespace-api/tsconfig.json` | exit 0（0 error） | 包源码类型门 |
| F3 | `node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` | exit 0（0 error） | `packages/*/src` + `packages/*/test` 类型门（含冻结测试） |
| F4 | `pnpm typecheck`（根，15 包链式 tsc） | exit 0 | 全包源码类型门 |
| E1 | `sha256sum` 5 个 #269 冻结测试文件 | 5/5 与 SA6 §13.4 逐字节一致（harness `14062b3d…`、support `9f9688ab…`、mapping `14465a40…`、abort `2f298a8e…`、observer `dbf8778a…`） | 冻结验收契约未被改写（无 skip/only/todo、无断言弱化） |
| E2 | 逐文件对比工作树与来源提交（`git show <commit>:path \| sha256sum`） | base 11 文件（4 测试 + 1 harness + 6 #268 文件）与 `HEAD`(209b046) 完全一致；#269 5 文件与 `7b40f50` 完全一致 | 两侧冻结测试零改动 |
| E3 | 非 ALLOW 源文件对比 | `src/request-body.ts`、`src/rest-problem.ts`、`package.json` 与 `HEAD` 完全一致 | 无 ALLOW 扩张、无 base 私改 |
| E4 | `git status --short` / `git ls-files -u` / `git diff --stat HEAD -- <4 paths>` | 仅 4 个冲突路径为 `UU`（内容已解决、未 stage）；`git diff --stat` = 4 files, 321 insertions(+), 69 deletions(-) | 范围与 DENY 遵守；未执行 `git add`/`commit`（SA3 边界，见 D5） |

设计方案明确指定的静态生成/check 命令：本票不触碰 VFSL schema 与打包面（无 `schema.vfsl`、
无 `package.json` exports 变更）⇒ 无 `generate --check` / `schema:check` / `pack-local` 义务；
包 AGENTS.md 既有验证入口（F1 + F2/F4）已全部执行。设计 §12 的「17 红转绿」基线属 #267 骨架；
rebase 到 #268 base 后不再存在该红灯态（两侧契约均已实现能力），故以「125/125 全绿 + C5 与 base AC2
同时成立」作为等价证据。

## Deferred verification

- 全仓 `pnpm test` 与其它 package 回归：非 SA3 范围；本票改动面只在 `packages/namespace-api`（仓内无
  其它 consumer，`grep` 仅 ADR 文本提及），该包全套三票契约已全绿。
- **Controller 收尾动作**：4 个 `UU` 路径需 `git add` 后 `git rebase --continue`（SA3 不执行 git 写操作，见 D5）；
  随后待应用 commit `c466b16` 仅新增 4 个文档路径（`artifacts/sa8-conflict-report-issue-269{,-design-recheck}.md`、
  `wiki/raw/task_issue-269.md`、`wiki/raw/task_issue-269_dispatch.md`），与 base 已跟踪路径零重叠
  （`git ls-tree -r HEAD` 实测）⇒ 无二次冲突风险，无源码改动。
- #270（server/composition root）：listener、连接级取消、graceful drain、abort rejection 的公共判别子；
  本实现诚实声明 abort 为有界 rejection（不得记 500 或重试）。
- metrics `rejected` outcome 的发射策略（4xx/422/403/405 族）与 5xx body `message` 字段：后续票加法。
- CI 的 Node 20 腿（SA4 残余风险）：#269 冻结 support 文件钉死 Node 24 平台事实；跨版本平台锚复估属 SA6 修订轮。
- 治理义务（SA8 OBS-R1-1 / SA2 OBS-3）：ADR-0015 经父 PR #158 正式接受时，把 R1（fatal `committed:false`
  → `INTERNAL_ERROR`）、H-A（abort 有界 rejection、无 HTTP status）、R3（读取段内 abort 优先于 413）、
  以及 **L-1 limits 跨字段口径**（两键显式矛盾 TypeError；单键时默认值收敛）折入 ADR 正文或修订节；
  `docs/adr/**` 属本票 DENY，未触碰。

## Deviations or blockers

- **无设计偏离、无阻塞。** 设计 §7.1/§7.3/§7.4/§7.6 在合入语义下逐条成立；两侧冻结契约一行未改、125 项断言全绿。
  以下为实现侧集中披露（SA4 OBS-B 建议）与本轮 rebase 的唯一新裁决：
  - **D1（跨票语义裁决，必要）**：`resolveLimits` 跨字段判定从「合并默认后的有效值矛盾即 TypeError」
    收敛为「两键显式矛盾 TypeError；单键时默认值按不变量向显式值收敛」。理由：C5（冻结）要求
    `{maxBodyBytes: 16}` 可构造，base AC2（冻结）要求 `{1024, 2048}` TypeError；两者只能以「错误门守卫显式
    矛盾指令、派生值按 ADR L113 不变量收敛」同时满足。已在 `rest.ts` 头注、`RestRouterLimits`/
    `RestRouterOptions` 文档与 README 同步；有效配置恒满足 `maxSchemaTextBytes <= maxBodyBytes`。
  - **D2**：abort rejection 形状改为承接 base 的事实（`ABORTED_BODY_READ_MESSAGE` + `signal.reason` 作
    `cause`，类名仍为包内私有 `RestBodyReadAbortedError`、不导出）。#269 H-A 明确 rejection 值形状非契约面
    （唯一公共分类面是 metrics `aborted`），而 base 的 `rest-create-body-read.test.ts` D6 逐字断言该 message+cause。
  - **D3**：读取段不再自建 `Promise.race([request.json(), abort])`，改为复用 base 的
    `readBoundedBodyText`（其内部已观察 signal：abort → `reader.cancel()` → 挂起读有界结算 → abort rejection），
    seam 只负责①/③闸门与 abort 分类/发射。理由：合入后 `request-body.ts` 是 step 4 的单一读取机制，
    再叠一层 race 属平行机制（违反单一路径纪律）；§7.6 要求的排序不变量由「入口判定 + 结算处核对 +
    入口先于任何读取期检查」结构性保证（C5 实跑锁定）。
  - **D4**：`create-namespace.ts` 仍额外导出接口 `CreateNamespaceOrchestrationDeps`（包内私有模块，不进
    `package.json` exports、不被 `index.ts` re-export），并新增 `limits` 字段。
  - **D5（边界声明，非阻塞）**：本迭代**未执行** `git add` / `git commit` / `git rebase --continue`
    （SA3 角色边界：不执行 git 写操作、不 finalize）。4 个路径在工作树中内容已解决且验证通过，
    索引仍标记 `UU`；Controller 需 `git add` 这 4 个路径后 `git rebase --continue`。
    `wiki/raw/task_issue-269_sa3_impl.md` 同理为未提交工作树改动。
  - **D6（输入缺失，非阻塞）**：本 worktree 内不存在 `wiki/raw/task_issue-269.md`（任务简报）与
    `artifacts/sa8-conflict-report-issue-269*.md`；其内容/裁决由前序 SA3/SA4 报告转述
    （SA8 两轮 `clear`、comments 快照空）。未发现影响 ALLOW/DENY、实现行为或红灯契约的信息缺口。

## Suggested commit message

```
fix(#269): REST create 的 Registry 失败语义、取消边界与双 observer 契约（rebase 到 #268 base）

- rebase 冲突解决：保留 #268 的 step 3/4/5 入站校验与 4xx/422 problem shape，
  叠加 #269 的 Registry 失败映射（503 / 500 FAILED / OUTCOME_UNKNOWN / INTERNAL_ERROR）、
  body 读取段取消边界（读取段内 abort 优先于 413）与双 observer 事件契约
- 读取 seam：复用 request-body.ts 的有界读取；入口/结算处两道 signal 核对保证
  abort 分类与 Registry 零触达；abort rejection 承接固定 message + signal.reason
- limits 跨字段口径：两键显式矛盾 → TypeError；单键时默认值按
  maxSchemaTextBytes <= maxBodyBytes 收敛（C5 与 #268 AC2 同时成立）
- 包 AGENTS.md/README 合入两份 deferral 清单并修正 metrics 事件概括句（SA4 OBS-A）
```
