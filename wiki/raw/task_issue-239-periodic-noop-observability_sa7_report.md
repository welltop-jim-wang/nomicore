# 独立动态验证 — issue #239: periodic reconciliation 的 no-op 与有效同步可观测性（SA7）

> 阶段：final verification（SA7）。审查对象：当前 worktree 全部未提交改动（10 修改 + 2 新增测试 + wiki 证据）。
> 前置输入全读：任务简报、SA8 conflict report（`clear`）+ relevant_decisions、SA1 设计（D1–D8）、
> SA2 attack review（approve）、SA3 实现证据、SA4 implementation review（approve，含 RT-G5 独立判定）、
> SA6 冻结红灯契约（ac_red.md + 两 log + 冻结测试文件）。
> Issue comments 独立复核（`gh issue view 239 --json comments,state`）：**0 条评论，state OPEN，无额外 Owner 要求**。
> 方法：不轻信 SA3/SA4 的运行结论，全部动态链路亲跑（后台进程）；生产代码零改动、零提交、零 push。

## Verdict

**`approve`**（`requiresConflictRecheck=false`）

## 1. 冻结件「不改一字且为绿」— 通过（双重证据）

1. **亲跑转绿**：`pnpm exec vitest run ws-replication-issue239-ac-red.test.ts --reporter=verbose`
   → **2 passed**，console 锚：
   - 场景 1：`[issue239 ac-red] no-op rounds=3 groups=4 periodicGroups=3 全部断言完成`（每轮 namespace 回 live、roundId 单调 +1、双侧 SV/ROOT/META 不变、`bytes > 0` 与全 noop 并存）；
   - 场景 2：`[issue239 ac-red] hub-drift 修复 round：delta={"hub":false,"peer":true} changedEvents=1` + `修复后 no-op round：changedEvents=0`（与实测 round 级 SV 增量一一对应、非粘滞）。
2. **冻结件未被篡改的溯源证据**（独立取得）：
   - SA6 红灯 log 中 4 条失败消息 `…缺语义字段 syncRoundId——红灯：生产修复前不得在场` 与当前测试文件
     `numberField`/`booleanField` 模板（L127/L136）**逐字一致**——产出红灯 log 的就是眼前这份文件；
   - mtime 链：冻结测试 00:55:48 → 红灯 log 00:58:40 → 生产实现 02:02:51——冻结文件晚于红灯运行即未被再写；
   - 测试内容与 ac_red.md §2 契约逐条一致（无弱化断言）。
3. **稳定性**：连续 10 次全量重跑 → **pass=10 fail=0**（0 flake）。

## 2. no-op 与漂移修复链路 event semantics — 通过（真实运行链路）

- **repro（翻转断言，2/2 绿）**：已收敛副本 7 轮 periodic round 全部
  `stateVectorChanged=false ∧ applyEffect='noop'`（每轮 hub/peer sent/applied 均 10 B——`bytes > 0` 恒真，
  编码非零与语义 noop 并存即 issue 现象的可观测化）；漂移修复 round peer 侧报 `changed`
  （hub sent 36 B / peer applied 36 B，before≠after hash）、hub 侧报 `noop`，修复后下一轮回全 noop。
  事件键集 log 实证新字段在场：`syncRoundId,encodedUpdateBytes` + 效果组四键。
- **关联契约**：事件 `syncRoundId` 集合 === wire SYNC_STEP1 roundId 集合（每轮有事件、无孤儿）、单调递增
  （ac-red 场景 1/2 与 repro (5) 断言亲跑绿）。
- **safe-field 深扫**：全事件树无 `Uint8Array`/`ArrayBuffer`/`DataView`（raw SV/Yjs bytes 零泄漏，
  ac-red `assertEventTreeSafe` + observer-red T9 深扫均绿）。

## 3. safe digest — 通过（双实现互证）

- `stateVectorSafeDigest`（observer.ts）：双泳道 FNV-1a-32（正序+逆序，basis 2166136261、prime 16777619、
  mod 2³²、`Math.imul`）实读复核。
- **本验证以独立 BigInt 模乘实现重算基准向量**（与被测 `Math.imul` 实现不同路径）：
  - 空输入 `811c9dc5811c9dc5` **MATCH**
  - `[0,0]`（Yjs 最小空 diff 探针）`117697cd117697cd` **MATCH**
  - 递增 0..9 `2f8540720825a114`（正逆泳道可分辨）**MATCH**
- observer-red 单元块（testing 子路径导入）确定性/文法/三态比较 3/3 绿；算法注册于协议 §23.3（append-only，
  注册即冻结）。

## 4. observer isolation 与无 observer 热路径 — 通过

- **T8 三运行基线亲跑绿**：无 observer / 良性 observer / 每事件必 throw——wire 帧协议语义序列与文档内容
  **全等**、零 unhandled rejection（observer-red 内，本次 36/36 的一部分）。
- 门控实读复核：before 捕获 `isStep2 && this.observerOn`（peer/hub 两侧）、after 捕获在 `if (this.observerOn)`
  块内且以 `svBefore !== undefined` 短路——无 observer ⇒ 零捕获、零 digest、零新字段构造；UPDATE 热路径
  （isStep2=false）零新增读取。
- 捕获折叠：`safeStateVector` try/catch → undefined → 效果组**单命运**整组缺失（绝不伪造 noop）；
  observer-red 一致性断言（四键同现同缺 + 组内一致性 + hash 文法）对矩阵全量 sync 事件逐笔绿。
- peer degraded 分支效果组不附着（互斥三选一保持，T13 绿）。

## 5. wire bytes / §9.4 / §16 不变 — 通过（独立静态 + 动态）

- `git diff` 独立清点：**改动面恰为** 10 个文件（`packages/ws-replication/src/{types,observer,round-engine,
  peer-namespace,hub-namespace,testing}.ts`、`test/{driver,api.test-d,observer-red}`、协议文档）+ 2 个新增
  测试文件 + wiki 证据；`packages/replication-protocol`（wire codec）**零 diff**；vitest 配置/根
  package.json/pnpm-lock 零改动；**零 skip/todo 标记**（全 diff grep）。
- 协议文档 5 个 hunk（L625/677/701/725/746）**全部落在 §23（L598 起）内**——§9/§16/§18/§21 一字未动
  （节锚点核对）。
- round-engine 改动 = 三处纯参数透传（`RoundHost.applyStep2` 接口、`onStep2` 传帧内 roundId、
  `applyStep2Safely` 透传）；违例矩阵/结算/reset 零改动。
- 发射点 grep：`sync-step2-sent`/`sync-diff-applied` 在 src **恰 4 处**（peer L160/L1119、hub L147/L932）
  + types.ts 联合两成员；事件型数 **20** 不变；`applyRemoteUpdate(…, true, …)` isStep2 调用点全仓恰 2 处
  （peer L1016 / hub L844）——`syncRoundId!` 非空断言来源封闭。
- helpers 只经 `@nomicore/ws-replication/testing` 导出，`src/index.ts` 零新增（grep 为空）。
- 状态机守护动态锚：ac-red/repro/periodic-reconcile/ac4/ac5/issue231 全绿（namespace 回 live、roundId
  单调 +1、无重叠轮）。

## 6. 触发性验证矩阵（SA7 亲跑，全部后台进程）

| # | 命令 | 结果 |
|---|---|---|
| V1 | vitest ac-red（冻结件） | **2/2 passed**（见 §1） |
| V2 | vitest repro（翻转断言） | **2/2 passed**（7 轮全 noop + 漂移 changed + 回 noop） |
| V3 | vitest observer-red | **32/32 passed**（T1–T13 + B1/T11 + issue239 helpers 单元块；Type Errors: no errors） |
| V4 | vitest periodic-reconcile + ac4 + ac5 + issue231 | **27/27 passed** |
| V4b | vitest issue230-incremental-mutation | **2/2 passed**（sync 计数邻接面） |
| V5 | vitest --typecheck api.test-d.ts | **16/16 passed，Type Errors: no errors** |
| V6 | `tsc -p packages/ws-replication/tsconfig.json` | **exit 0** |
| V7 | 根 `pnpm typecheck`（13 项目） | **exit 0** |
| V8 | ws-replication 包全量（53 文件，无跳过） | **352/354 passed**；2 失败均位于 `ws-replication-sa7-issue171-real-transport.test.ts`（见 §7） |
| V9 | ac-red 连续 10 次 | **10/10 pass，0 fail** |
| V10 | digest 基准向量独立 BigInt 复算 | **3/3 MATCH**（§3） |

## 7. real-transport 失败独立复核（不屏蔽、不跳过）

V8 中两失败均在 issue #171 真机文件：**RT-G5**（L508 `expected 'blocked' to be 'draining'`——SA4 已判定
的同一签名）与 **RT-C4**（「ERROR 帧经真实 socket 到达 hub 侧」同步断言——SA3/SA4 运行中均绿，本次为
新观察）。本验证独立处置：

1. **复跑特性**：该文件单独串行 ×3 → RUN1 RT-G5 fail（同签名）、RUN2/RUN3 **4/4 pass**——带全部 #239
   改动仍间歇通过 ⇒ 非确定性，非本改动回归（确定性回归应稳定失败）。
2. **机制独立实读**：两测试共用 `injectHubToPeer`（以 `peerSide.nextSequenceForReceiver()` 手工编序把
   原始帧写进真实 socket）；RT-C4 失败点为「peer 出站 ERROR 的 waitUntil 通过后**同步**断言 hub 侧已
   收帧」——真实 TCP 传输时延内的等待缺失，属测试基建时序竞态；RT-G5 为 SA4 §6 已定位的手工序列记账
   vs 对端活跃发送器之争。
3. **与 #239 零因果通道**（独立核实）：`bootReal({})` **不注入 replication observer**（文件内仅 L252
   registry lease observer）⇒ `observerOn=false` ⇒ 本改动全部新增行为在该文件中**根本不执行**；
   wire codec 零 diff；round-engine 为纯参数透传；CLOSE/GOAWAY/ERROR/connection-state 路径零触碰。
4. 与 SA3 pristine-HEAD 基线（同款间歇失败）与 SA4 八次运行（带改动 1 次串行通过）相互印证。
   该测试守护的 issue #171 语义另有 RT-F1/C4b 锚通过。判定：**预先存在的环境敏感测试基建缺陷，建议
   另立维护任务（注入前等待对端 in-flight 排空 / hub 收帧改 waitUntil），不阻断本交付，且未屏蔽任何测试**。

## 8. 结论

- 冻结 ac-red 契约不改一字转绿且 10/10 稳定；
- no-op / 漂移修复两链路的 event semantics（noop↔changed 与实测 SV 增量一一对应、roundId 关联、非粘滞）、
  safe digest（双实现互证）、observer isolation（T8 三运行全等 + 单命运折叠）全部经真实运行验证；
- wire bytes / §9.4 / §16 状态机零变化（独立清点 + 协议 hunk 全落 §23 + 状态机守护锚全绿）；
- 包全量唯一失败为与本改动无因果通道的预先存在测试基建时序竞态（独立复跑 + 机制实读 + SA4/SA3 基线
  三方印证）。
- SA4 两项实现偏差裁决（periodic 组口径、delete-set-only 注记）与本验证观察一致。

**Verdict = `approve`，无冲突需复审。**

## 9. 证据文件清单

- `wiki/raw/task_issue-239-periodic-noop-observability_sa7_report.md`（本文档）
- `packages/ws-replication/test/ws-replication-issue239-ac-red.test.ts`（冻结件，转绿判据）
- `packages/ws-replication/test/ws-replication-issue239-repro.test.ts`
- `packages/ws-replication/test/ws-replication-observer-red.test.ts`
- `wiki/raw/task_issue-239-periodic-noop-observability_ac_red.md` + 两 log（红灯证据）
- `wiki/raw/task_issue-239-periodic-noop-observability_sa4_review.md`
