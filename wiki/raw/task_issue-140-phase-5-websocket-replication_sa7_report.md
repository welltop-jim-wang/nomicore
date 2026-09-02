# SA7 动态验证报告 — Issue #140 Phase 5 收口（app 黑盒管理动词面）

- **Date**: 2026-08-30（R1 动态验证 / R2 复验，见文末「SA7 R2 复验」节）
- **Verdict**: R1 = **fail-needs-fix**（F1）→ **最新（R2 复验，SA3 修复 commit `f310f18`）= pass**——F1 两轮 reset 重引导断裂已修复（红锚转绿）、SA4 O-R3-1 终态放行分支已钉住并实证、锚/全量/类型面零回归；CI 触发证据仍环境阻塞（§5，Host 发布不可用）
- **验证对象**: SA3 commit `3863a69`（R1）→ `f310f18`（R2 复验对象），基线 `469ca36`
- **输入**: 任务简报 + SA1 设计 + SA4 静态审核报告（R1「动态审核重点」7 项 + O-A；R3 O-R3-1 必验项；R4 最新 verdict pass）+ SA6 红灯报告与锚测试（已入库）
- **工位**: `/home/wangjian/nomicore-fix-issue-140`（worktree，branch `fix/issue-140-on-docs-phase-5-websocket-replication`）
- **验证环境**: 独立后台进程（`setsid nohup`），全部测试命令零 ACP 同步阻塞；端口全部 ephemeral/自由，运行前 stale 进程 `pgrep` 为空

---

## 0. 一句话结论

**R2 复验（最新，针对 `f310f18`）**：SA4 R4 pass 基础上，F1 修复经红锚转绿实证（两轮 bump→fence→reset 运维循环第二轮重引导收敛 + `add-target` 恢复入口真实可达），SA4 O-R3-1 必验项（终态通道 + peerOwners 在册 → add-target 放行 → `target-added` + 重建收敛）以新增入库用例钉住并通过，锚 6/6、全量 app 套件 47/47、typecheck 全绿零回归——**SA7 最新 verdict = pass**。CI 触发证据维持环境阻塞（分支未 push、Host 发布不可用，§5）。

**R1 记录（针对 `3863a69`，已由 `f310f18` 修复）**：SA6 锚 6/6 全绿、SA4 移交的 6 项动态审核重点全部拿到活链路证据（含 E14 停机窗口 5/5 命中文档化终态、fence 时延实测 8.3s/1.5s < 10s 契约上界），但 SA7 独立发现确定性缺口 F1：对同一 namespace 做第二轮 `bump-epoch → fence → reset-replica`（部署文档定义的标准重入运维循环）时，reset 回执 `ok:true` + `replica-reset` 事件齐备，但冻结编排 ③ 承诺的「addTarget → §14.1 整连接重建 → 重 OPEN → bootstrap」静默不发生——channel `closing→closed` 后无任何重建，peer 该 ns 永久 `read-failed`（>90s），且部署文档登记的恢复入口 `add-target` 返回伪 `ok:true` 零动作（被 G5c 恢复的 `peerOwners` 幂等集拦截）。R1 判 fail-needs-fix 回流 SA3；SA3 于 `f310f18` 修复（G5b settle-wait + 状态感知 add-target 幂等），本节以下 R1 内容保留为历史证据。

## 1. 门禁执行记录

| 步骤 | 结果 | 证据 |
|---|---|---|
| Step 0 SA4 verdict 校对 | ✅ pass（R2 复审，`3863a69`） | `sa4_review.md` 顶部 Verdict 行 + R2 节「最新 Verdict: pass」 |
| Step 1 SA6 锚复跑 | 🟢 **GREEN 6/6**（exit 0，49.5s） | `npx vitest run apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts --no-typecheck` → `1 passed (1) \| 6 passed (6)`（AC1×2 + AC6 + AC3-①②③ 全绿） |
| Step 2 SA4 动态审核重点 7 项 | ✅ 1–6 全部实证（§3）；第 7 项 CI 摘录**环境阻塞**（§5） | 逐条见 §3 |
| 回归 | ✅ 零回归 | `pnpm typecheck` exit 0；`npx vitest run apps/yjs-server/test/ --no-typecheck` → `45 passed \| 1 failed (46)`——**唯一红 = SA7 自建 F1 红锚**，既有 8 文件 42 测试 + SA6 锚 6/6 + SA7 补充 3 例全绿 |
| 边界 | ✅ 零生产代码改动 | `git status --short`：仅新增本报告 + `apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts`（untracked）；`git diff HEAD` 空 |

## 2. 产出文件

| 产物 | 位置 | 说明 |
|---|---|---|
| 补充性测试 + F1 红锚 | `apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` | 4 用例：3 绿（契约对齐的补充验证）+ 1 红（F1 红锚，SA3 修复目标）；vitest include `apps/*/test/**/*.test.ts` 覆盖，入库即进 CI |
| 本报告 | `wiki/raw/task_issue-140-phase-5-websocket-replication_sa7_report.md` | — |
| 一次性探针（不入库） | `/tmp/sa7-probe-{ab,c,d,e,f}.mjs`、`/tmp/sa7-e14-probe.mjs` | F1 取证/E14 观测/根因定位；worktree 零残留 |

## 3. SA4「动态审核重点」逐条回复

### 3.1 重点 1 — AC3-① 修复后 6/6 + 传播链端到端 ✅

锚 6/6 全绿（Step 1）。传播链：`replace-schema`（V2opt 可选字段演进，keep-root）→ `ok:true` → hub `verify-write note` → `waitConverged(['note'])` 双 peer 收敛（锚内绿 + SA7 补充测试第 2 例绿，收敛实测 38–200ms）。
**增量观察（O-F2，非阻断，见 §6.2）**：peer **本地写**新 schema 字段在增量传播后仍 `write-failed`（引擎「活动 schema 仅在（重）物化时切换」；peer reset 重引导后即 ok）——不在 AC3-① 验收面内（验收只要求 hub 写 + 收敛），登记为设计文档 L140 表述偏差 + 运维认知项。

### 3.2 重点 2 — R2 修复后 extra-key 拒绝的动态确认 ✅

`stdin` 发送 5 键信封（合法四键 + `extra:'future-field'`）→ 回执 `{"ok":false,"code":"write-failed"}`（响亮拒绝，无静默剥离）。SCHEMA 未变的行为证据：(a) 新 schema 独有字段 `note` 在旧 schema 下写入被拒（封闭对象不接受未声明键）；(b) 旧字段 `tags` 读数不变（'hub'）、`count` 写入 ok。零破坏佐证：同 schema 四键干净重提 → `ok:true`，随后 hub 写 note 收敛。全部在补充测试第 2 例（绿）。

### 3.3 重点 3 — `replicationEpoch` 回执值正确性 ✅

首 bump 回执 `replicationEpoch=2`（`typeof number` + `Number.isSafeInteger`）。以受控 reset 的 expected 身份门（= peer **本地**身份，ADR 0010 `expectedLocalIdentity`）双向交叉验证：fenced peer 以本地旧身份 `{rid,1}` reset → `ok`（本地确为 1）；rejoin 收敛后以 `{rid,1}` 再 reset → `NAMESPACE_RESET_IDENTITY_MISMATCH` 且零破坏（读仍 'hub'）——证明 rejoin 已采纳权威代际 2 = 回执值。回执值 ⟺ 权威代际 ⟺ rejoin 后本地身份，三方同一。（「以回执值直接 reset → ok」的第三向交叉因 F1 卡死无法在 live 重入通道上取绿，已并入 F1 红锚断言。）

### 3.4 重点 4 — file 适配器 reset-replica 全周期 ✅

补充测试第 3 例（file，绿）：reset `ok` + `replica-reset` 事件 + **归档落盘**（`{peerRoot}/archive/users/alice/{nsId}.snapshot` 存在）+ 进程内重引导收敛 + 硬崩溃（SIGKILL 真实 pid）→ 同 rootDir 重启 → 恢复收敛（count=100 + tags='hub' 零丢失；重启时本地副本在档 → 引擎走 reconcile/sync 路径，日志摘录 `[SA7] file reset 后崩溃重启恢复路径: reconcile/sync`）。
**「归档后 key 缺席 → 重启 bootstrap 资格」的直接证据**来自 E14 探针（§3.5）：reset 归档后进程在重引导完成前退出 → 同 rootDir 重启 → `bootstrap-imported` 事件 + 收敛，5/5 次。

### 3.5 重点 5 — 停机窗口伪回执（E14）动态观测 ✅（按设计为已知有限偏差，不求修）

一次性探针（file 拓扑，reset 进行中对真实 app pid 发 SIGTERM，sigDelay ∈ {0,5,15,40,80}ms × 5 次）：**5/5 全部命中文档化终态 T1（伪回执）**，与设计 §3.3 竞态表逐字一致：

```text
[E14 attempt#1..#5] exit=0
  terminal        : T1(pseudo-receipt ok:true)          ← 回执 {"ok":true} + replica-reset 事件，重引导不发生
  archive on disk : true                                ← 归档先于回执完成
  restart converge: true (count→77)                     ← 重启后按配置 targets 重引导
  restart bootstr : true (bootstrap-imported)           ← key 缺席 → bootstrap 资格（重点 4 交叉证据）
  tags after      : hub                                  ← 数据零丢失
  shutdown events : replication-drained,registry-stopped,persistence-disposed,app-stopped  ← 优雅停机序完整
```

### 3.6 重点 6 — fence 检出延迟稳定性 ✅（实测记录）

两轮独立实测（bump 回执 → `identity-conflicted` 事件）：**peer-1 = 8387/8346ms，peer-2 = 1480/1521ms**——均在契约上界 `ackTimeoutMs=10s` 内，远低于锚测试 30s 窗口与 SA4 指定 CI 慢机 3 倍余量。补充测试第 1 例将该测量固化为断言（assert <30s，非 flaky 界）并 console.log 实测值。

### 3.7 重点 7 + O-A — CI 触发证据 / 锚 6/6 CI 稳定性 ⚠️ 环境阻塞（非代码问题）

分支 2 个 commit（`dbd36d4`/`3863a69`）**未 push**、无 PR、`gh run list --branch fix/issue-140-on-docs-phase-5-websocket-replication` 为空——CI 动态证据在发布（push/PR）前不存在。SA7 不负责 push/建 PR（权限边界）。**静态前置已核验**：`.github/workflows/ci.yml` 触发 `pull_request` → `Test` 步骤 `pnpm test` = `vitest run --typecheck`，`vitest.config.ts` include `apps/*/test/**/*.test.ts` 覆盖锚测试与 SA7 补充测试两个文件 → PR 建立后两者必被收集。**移交总控**：发布阶段完成后补 CI run log 摘录（锚 6/6 + 补充套件 + F1 红锚的预期红）。

## 4. 🔴 阻断发现 F1 — 第二轮 reset-replica 后重引导静默失效（fail-needs-fix）

### 4.1 复现（确定性，4 次独立复现：补充测试 + 探针 B/D/F）

标准运维循环（部署文档 reset 行定义的 epoch fencing 恢复路径）第二轮：

```text
基线收敛 → bump#1（回执 replicationEpoch=2）→ 双 peer identity-conflicted
→ reset#1（expected=本地身份 {rid,1}）→ ok → 重引导收敛（25–400ms）✅ 第 1 轮正常
→ bump#2（回执 replicationEpoch=3）→ fence
→ reset#2（expected=本地身份 {rid,2}）→ 回执 {"ok":true} + replica-reset 事件
→ channel-state-changed: live→closing → (回执) → closing→closed
→ 【无任何整连接重建/重开/bootstrap 事件】→ peer 该 ns read-failed 永久（>90s）🔴
```

### 4.2 恶化面：文档化恢复入口 `add-target` 亦失效

卡死后人工 `add-target` → 回执 `{"ok":true}` 但**零动作**（无 `target-added` 事件、无通道重建、60s 不收敛）。机制：G5c 在 G5b 同步返回前恢复 `peerOwners[nsId]`，`opAddTarget` 的幂等短路（`peerOwners.has → return ok`）把运维重试拦截为伪成功——正是 app.ts G5a 注释自认要防的撕裂 (i)，但 G5c 的恢复时机使该防护在「重引导链已失败」场景下反噬。
**临时绕过（探针 F 实证）**：两步 `remove-target`（清 peerOwners）→ `add-target`（controller 已 `closed` → re-add 分支 `targeted` + `requestRebuild('re-add')`）→ conn-3 重建 → `bootstrap-imported` → live，25ms 收敛。

### 4.3 根因定位（黑盒事件流 + 代码指针，供 SA3 诊断；SA7 不改生产代码）

- **观测事实**：卡死轮的 G5b `addTarget` 未产生任何 `closed→targeted` 通道迁移（对照探针 F 恢复轮有该迁移）；通道事件止于 `closing→closed`。
- **代码指针（假设，两候选）**：`packages/ws-replication/src/peer-connection.ts:216-248` `addTarget` re-add 分支仅当 controller state ∈ {closed, conflicted, failed}（或 connState blocked/rebuildPending）才 `requestRebuild`；G5b 的 `addTarget` 在 `removeTarget` memo 结算后同步执行，此刻 controller 仍处 `closing`（回执先于 `closing→closed` 事件）→ 落入合流分支（`intent='active'`，零动作零事件），close 完成后无人再触发重建。第 1 轮之所以正常：fenced 态 controller 为 `conflicted` ∈ re-add 集 → 直接重建。
- **修复域归属**：app 编排层（`apps/yjs-server/src/app.ts` G5b/G5c——本任务 ALLOW LIST 内）：如 `removeTarget` 后等待 controller 终态再 `addTarget`、或显式触发重建、或 `add-target` 恢复入口不以 `peerOwners` 短路（重引导链失败的可观测恢复语义）。

### 4.4 契约违反而非文档化行为

部署文档 `reset-replica` 行与「管理动词」节：冻结编排 ③「`peer.addTarget`（§14.1 **整连接重建 → 重 OPEN → bootstrap**）」；回执语义「ok = 归档完成 + 重引导已入队」的 hedge（「重引导链随后的失败走既有 channel/连接 observer 事件，恢复入口 = add-target」）不覆盖本例——**无任何失败事件**（通道优雅关闭非失败），且恢复入口本身被短路为伪 ok。锚测试 AC3-③ 仅覆盖单轮 reset，故 CI 现状全绿——这正是 SA7 动态验证的价值所在。

### 4.5 红锚（SA3 修复目标）

`apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` 第 4 例：「🔴 第二次成功 reset-replica 后应重引导收敛（部署文档冻结编排 ③）；文档化恢复入口 add-target 应有效」。当前 `convergence timeout (60000ms) ... ["hub",null,"hub"]`；修复后应全绿。**注意：本文件含预期红用例，发布后 CI `pnpm test` 将红——这是回流 SA3 的执行目标，非误报。**

## 5. vitest 触发证据（Step 4 立法，2026-06-15）

**CI Run: （无——分支未 push、无 PR，环境阻塞待发布；静态前置见 §3.7）**

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| apps/yjs-server（锚 + SA7 补充） | Test（`pnpm test`） | 🔥 待发布后摘录 | include 模式 `apps/*/test/**/*.test.ts` 静态核验通过；发布后须补 run log 中两文件 `Running N tests` 证据 |

本地等价证据（活链路）：锚 `6 passed (6)`、补充 `3 passed + 1 failed(F1 红锚) (4)`、全 app 套件 `45 passed + 1 failed(F1) (46)`、`pnpm typecheck` exit 0。

## 6. 非阻断观察项（移交）

### 6.1 O-A（SA4 移交）— CI 上锚 6/6 稳定性
环境阻塞（§3.7）。本地串行两轮锚 6/6 稳定（49.5s / 含 SA4 R2 轮共三轮）；本轮全程零 EAGAIN/零孤儿进程（`pgrep` 空）。发布后从 CI run log 复核。

### 6.2 O-F2（SA7 新增）— peer 活动 schema 仅在（重）物化时切换
`replace-schema` 增量传播后：peer **读**新字段正常（Y.Doc 已同步），peer **本地写**新字段持续 `write-failed`（60s 重试仍拒；写旧字段 ok 对照正常）；reset 重引导（重新物化）后 peer 写新字段立即 ok。设计文档 L140 传播链「→ peer installActive」表述与实现不符（installActive 仅发生于物化/schema 写槽，增量 apply 不触发）。**判定非本任务缺陷**：ADR 0010 L107 已登记「后续普通业务写仍按现有完整 ROOT 校验，可能被拒绝」原则，引擎 `packages/**` 不在本任务改动面；建议 SA1/文档侧修订 L140 表述并在部署指南补一句运维认知（peer 写新 schema 字段需先 reset/restart）。

### 6.3 O-F3（SA7 新增，记录）— E14 观测副产
E14 五次全部走 T1 且重启 `bootstrap-imported`——「归档 → key 缺席 → 重启 bootstrap 资格」链路鲁棒（与 §3.4 互证）。

## 7. 验证命令与结果汇总

| 命令（独立后台进程） | 结果 |
|---|---|
| `npx vitest run apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts --no-typecheck` | `1 passed (1) \| 6 passed (6)`，exit 0 |
| `npx vitest run apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts --no-typecheck` | `1 failed \| 3 passed (4)`——唯一红 = F1 红锚（预期） |
| `npx vitest run apps/yjs-server/test/ --no-typecheck` | `1 failed \| 45 passed (46)`——既有 42 + 锚 6 + 补充 3 全绿，零回归 |
| `pnpm typecheck` | exit 0 |
| `node /tmp/sa7-e14-probe.mjs`（5 attempts） | 5/5 T1 伪回执 + 归档落盘 + 重启 bootstrap-imported + 零丢失 |
| `node /tmp/sa7-probe-{ab,c,d,e,f}.mjs` | F1 复现×4 + 根因事件流 + 两步恢复绕过面实证 |

## 8. 回流指令（总控，R1 版——已执行完毕，保留为记录）

1. ~~**退回 SA3**（fail-needs-fix）：修复 F1~~ ✅ 已执行：SA3 于 `f310f18` 修复（G5b settle-wait + 状态感知 add-target 幂等）。
2. ~~SA3 修复后 SA7 复跑~~ ✅ 见文末「SA7 R2 复验」：红锚转绿 + 5 用例全绿 + 既有套件零回归。
3. **发布（push/PR）后补 §5 CI 触发证据与 O-A 的 CI 稳定性摘录**（SA7 权限不含 push/建 PR；R2 时点 Host 发布仍不可用，维持阻塞登记）。
4. O-F2 建议并行开 SA1/文档卫生票（设计 L140 表述 + 部署指南运维认知一句），不阻断 #140。

---

# SA7 R2 复验（2026-08-30，修复 commit `f310f18`；SA4 R4 verdict = pass 基础上执行）

- **复审范围（总控指令固定）**：F1 两轮 reset/重引导验证 + SA4 O-R3-1 必验项（终态通道 + peerOwners 在册 → add-target → `target-added` + 重建收敛）+ 相关锚/回归复检 + CI 证据限制保留上报；不改生产代码。
- **最新 Verdict**: **pass**——F1 闭环、O-R3-1 钉住、零回归、零新阻断发现。

## R2.1 修复内容核验（diff 逐项 vs R1 回流要求）

| R1 要求 | 修复落点（`git show f310f18`） | 判定 |
|---|---|---|
| G5b 重引导编排修复 | `app.ts` G5b 在 `addTarget` 前新增 `waitPeerTargetSettled`（预算 = `closeTimeoutMs` 缺省 5s + 2s 边距；终态/`disconnected`/controller 缺席 = settled；超限 → 诚实 `reset-replica-failed`，peerOwners 保持 deleted） | ✅ 与 R1 §4.3 建议方向一致 |
| `add-target` 恢复入口真实可达 | `opAddTarget` 幂等短路改状态感知：`peerOwners.has && state ∉ {closed, conflicted, failed}` 才短路；终态放行 → engine re-add（§14.1 重建 + `target-added`） | ✅ R1 §4.2 恶化面闭环 |
| 文档同步 | 部署文档 L124（add-target 终态放行语义）/ L130（reset ok = 归档 + 收口结算完成 + 重引导入队）/ L150/L169（管理动词节冻结次序补 settle-wait） | ✅ 与实测行为逐字一致 |
| 锚回归锁 | `phase5-mgmt-verbs-sa7.test.ts` 随 `f310f18` 入库（642 行，与 SA7 R1 版本逐字节一致——`git show f310f18:... \| diff -` 零差异，`[SA7 owned]` 边界被尊重） | ✅ |

## R2.2 F1 必验——两轮 reset/重引导（红锚转绿）

命令：`npx vitest run apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts --no-typecheck` → **`1 passed (1) | 4 passed (4)`，exit 0**（R1 为 3 passed + 1 failed）。

红锚用例（第 4 例）在 `f310f18` 上的完整通过路径：第 1 轮 bump（回执 epoch=2）→ fence → reset(本地 1) ok → 收敛；第 2 轮 bump（回执 epoch=3）→ fence → reset(本地 2) **ok → 重引导收敛**（R1 卡死点）；随后 `add-target` 恢复入口 ok 且收敛（R1 伪 ok 点）。R1 确定性复现（4 次）的缺口在修复后消失，无新抖动。

## R2.3 O-R3-1 必验——终态通道 + peerOwners 在册 → add-target 放行分支

**引擎语义前置（黑盒可观测事实 + 源码核对）**：`peer-connection.ts` `openActiveTargets` 对 `closed`/`conflicted` **等待显式 re-add（§14.1）**、对 `disconnected`/`failed` 自愈——故终态放行分支的确定性锚定态 = `conflicted`（经 `bump-epoch` fence 的 `finalize('conflicted')` 达成，且 fencing 不触碰 `peerOwners`，恰构成「peerOwners 在册 + 通道终态」）。

**新增入库用例**（`phase5-mgmt-verbs-sa7.test.ts` 第 5 例，`-t "O-R3-1"` 单跑 **passed, 13.7s**）：

1. bump → p1 `identity-conflicted`（通道 → `conflicted` 终态，peerOwners 在册）；
2. `add-target` → 回执 ok + **`target-added` 事件恰在本次后发射**（旧实现短路分支零事件——放行证据）+ **`channel-state-changed from:'conflicted'`**（离开终态进入 re-add 的 `targeted`——重建证据）；
3. 重 OPEN 因本地身份陈旧再入 conflicted（契约内行为），紧接受控 reset（本地身份 {rid,1}）→ ok → 三处收敛——证明放行分支重建出的通道/机制可收敛（rebuilt → converged）。

**旁证（探针 G，`/tmp/sa7r2-probe-g.mjs`）**：`failed` 终态上 `add-target` 同样放行——事件流 `failed→targeted` + conn-1→conn-2 整连接重建 + `target-added` + 重 OPEN（该 OPEN 被 hub 以 `NAMESPACE_UNAUTHORIZED` 拒绝系探针自身用 **provision 形式**重启 hub 所致——见 R2.5 O-G1，非分支缺陷）。

**SA4 建议场景的实证定位（探针 H，`/tmp/sa7r2-probe-h.mjs`）**：reset ok 后 SIGKILL hub → 通道 `disconnected→closed closed→targeted targeted→disconnected`（非终态重试中）→ 以**部署契约的直引（direct-reference）形式**复活 hub（T6 冻结的重启路径）→ **19.3s 自愈收敛**（`disconnected→targeted→opening→bootstrapping→reconciling→live`，零 add-target、零丢失）——即 SA4 建议的断 hub 场景实际命中的是**非终态短路 + 连接重建自愈**分支，无法钉住终态放行分支；终态分支的锚定必须走 `conflicted` 路线（本节新增用例）。此结论已按实证记录，供后续 SA 复用。

## R2.4 回归复检（串行、独立后台进程）

| 复检项 | 命令 | 结果 |
|---|---|---|
| SA6 锚 | `npx vitest run apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts --no-typecheck` | **`6 passed (6)`**，exit 0（53.1s）✅ |
| SA7 补充套件（含 F1 锚 + O-R3-1） | 同文件全量 | **`5 passed (5)`** ✅ |
| 全量 app 套件 | `npx vitest run apps/yjs-server/test/ --no-typecheck` | **`9 passed (9) \| 47 passed (47)`**，exit 0——R1 的 46 例全部保持绿 + O-R3-1 新例绿，零回归 ✅ |
| 类型面 | `pnpm typecheck` | exit 0 ✅ |
| fence 时延（重点 6 复测） | 套件 console 摘录 | peer-1=8346ms / peer-2=1521ms（<10s 契约上界，与 R1 一致）✅ |

## R2.5 观察项（非阻断）

- **O-G1（记录，文档化行为）**：以 **provision 形式**重启 file 持久化 hub 会**新建** namespace（`registry.create` 非幂等；重启后旧 nsId 对 hub app 层 `namespace-unknown`，peer OPEN 收 `NAMESPACE_UNAUTHORIZED`）。此为部署文档 L75 明示行为（「file 模式下重启 N 次 = N 个累积持久 namespace」），正确重启路径 = 直引形式（L69/T6）。建议（可选）在 runbook 节加粗提示，不阻断。
- **O-G2（覆盖缺口记录）**：G5b settle-wait 的**预算超限分支**（`reset-replica-failed` + peerOwners 保持 deleted）无动态证据——触发需 controller 卡在 `closing` 超过 closeTimeout+2s，引擎侧由 closeTimeout 兜底保证不可达，黑盒无故障注入面。已按诚实口径登记；如后续引入故障注入 seam 可补锚。
- O-F2（R1 移交）与 O-A/CI 证据限制**继续保留**（见 §6.2/§5）。

## R2.6 CI 证据限制（保留上报）

R2 时点：分支 3 commit（`dbd36d4`/`3863a69`/`f310f18`）**仍未 push**、无 PR、`gh run list --branch fix/issue-140-...` 为空——**Host 发布（push/PR/CI 观察）尚不可用**，SA7 权限不含 push/建 PR。静态前置维持核验通过：`.github/workflows/ci.yml` `pull_request` 触发 → `Test` 步骤 `pnpm test`（vitest include `apps/*/test/**/*.test.ts`）必收集锚 + SA7 两测试文件。**发布后需补**：两文件在 `Test` 步骤 log 的 `Running N tests` 摘录 + 锚 6/6 的 CI 稳定性（O-A）。

## R2.7 结论

- **最新 Verdict: pass**（R1 fail-needs-fix → SA3 `f310f18` 修复 → R2 复验全绿）。
- 产出增量：`apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` 新增 O-R3-1 用例（4→5 例，工作区 M 状态待随发布收纳）；本报告 R2 节。
- 零生产代码改动（`git status`：仅测试文件 M + wiki 工件）；零孤儿进程。
- 移交总控：发布后补 CI 摘录（R2.6）；O-F2 文档卫生票可选并行。
