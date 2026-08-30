# SA4 静态验尸报告 — issue #171（实现后红队审查）

**Date**: 2026-08-30
**被审对象**: SA3 实现 commit `202558b`（src 四文件）+ SA6 R2 测试 commit `fc09cbb`（C4 时序修正 / AC3b 翻转 / C4b 新增）
**Verdict**: **reject**（1 项阻断 F1 —— AC2 违例 + 对 #165 基线回归；回流目标 SA3（一行修复）+ SA1（设计注记，含 R2-N1 措辞对齐）；其余全部审查维度通过）

---

## 0. 审查方式与独立验证证据

- 全文通读 SA1 R1 设计（773 行）/ SA2 R1+R2 评审 / SA5 分析 / SA6 冻结契约与 R2 决策表；`git diff ef19bae HEAD` 逐 hunk 比对四源码文件；终态源码复核（peer-namespace / hub-namespace / peer-connection / hub-connection / fence-watchdog / lifecycle-queue / defaults / 测试 harness·driver）。
- **独立复跑**（worktree 根，独立进程）：
  - `pnpm exec vitest run packages/ws-replication --typecheck` → **23 files | 160 tests | 0 failed**（Type Errors: no errors）——与 SA6 R2 登记的 160/160 全绿一致，H1/P3/C4(修正时序)/C4b/G5/AC3b(翻转) 全部转绿属实。
  - `git diff --check ef19bae HEAD` → CLEAN（无空白错误）。
  - **新增 SA4 红灯复现锚** `packages/ws-replication/test/ws-replication-sa4-issue171-review-red.test.ts`（F1，见 §2）→ 当前实现确定性红灯：`deadline 后 session 必须已收口（AC2 零泄漏）: expected {…ReplicationSession} to be undefined`（1 failed；其余 160 项不受影响）。
- CI 触发性：根 `pnpm test` = `vitest run --typecheck`，include `packages/*/test/**/*.test.ts` 覆盖 `packages/ws-replication/test/**`；`pnpm typecheck` 含 `tsc -p packages/ws-replication/tsconfig.json`。本任务全部 `*.test.ts` 均在 CI 触发面内（无 `.spec.ts`，E2E 门禁 N/A）。

## 1. 审核结论（按技能清单）

1. **设计一致性：⚠️ 偏离 1 处（即 F1——设计 §D3 伪代码自身的洞，非 SA3 抄写错误）；其余逐条款（§D1–§D9）与 R1 设计机制级一致**。
   - Scope Creep Guard：actual diff = ALLOW LIST 四源码文件 + 两个 `[SA6 owned]` 测试文件（SA6 R2 提交）+ wiki 白名单文件；**零 DENY LIST 触碰**（协议文档 / replication-protocol / namespace-registry / index.ts / 其余 src 均未改，`isGoawayDraining` 全仓清零）。BLACKLIST 零命中（`TASK.md` 为 git-ignored 且不在 diff）。
   - H1 链：`isOpenAborted()`（终态 ∨ closing）覆盖 startOpen 全部恢复点（含 R1 #5 五处取得后失败出口）；D-H1（authorize 成功不拦截 registry.open）与 `finishOpenSilently(pendingLease?, pendingSession?)` 显式回收（先 session 后 lease，ADR-0010 L90；`pendingLease !== this.lease` 判据保证恰一次）——逐行落实。
   - P3 链：claim **排队前**在 caller 同步栈求值（onCloseRequest / ensureCloseMemo / cleanupResources 三处）；`runDisposal` 身份守卫（`this.session === claim.session` + lease 子守卫）；epoch 仅作 §D2 续体 wire 门——SA2 #1/#3 CRITICAL/MAJOR 修复机制级到位。
   - C4/C4b 链：`onCloseOk` universal fatal（closing 期除「有值且匹配」外一律 `connectionFatal('ACK_STATE_VIOLATION',1002)`；活跃态未请求同款）——与库内权威策略对称（hub-connection.ts:323-326 方向异常 + hub `onBootstrapAck` 同款 fatal，源码复核属实）。
   - G5 链：轻量/全量两层（`onConnectionQuiesce` 零处置排队 / deadline 全量 + 只关 transport）；连接级状态保持 ready。
   - Timer 卫生：peer 侧 onConnectionLost/onConnectionQuiesce/onConnectionFatal/removeTarget/onCloseRequest 全入口 `clearAllTimers()`；hub 侧 quiesceConnection/onCloseRequest 补齐（TimerKind 'bootstrap'|'close' 全覆盖）。
2. **读写路径一致性：✅**（本任务为生命周期/资源账目变更，无数据源分叉面；lease 计量单源经 release 调用链）。
3. **静默失败：❌ 发现 1 处（F1）**——removeTarget 在 GOAWAY drain 窗口的承诺正常结算、状态正常 `closed`，但资源账目零处置（外部完全不可观察的静默完成——恰是本任务要消灭的缺陷类）。其余路径（removeTarget 承诺七条结算点 / 错误态写入面）复核完整。
4. **降级方案：✅ 安全**。轻量/全量两层静默是 #161 修订节既定决策的落实（非新增降级）；D5 计面钉死论证与 `sa7-issue137 D5` 全绿互相印证；`drainPendingApplies` = `Promise.allSettled`（结构性不可 reject）——SA2 #7「任务体结构性零 throw」逐点复核成立（unsubscribe 包 try/catch、close/release 各自 `.catch`、全部 fire-and-forget 调用点显式 `.catch(()=>undefined)`）。
5. **极端攻击：❌ 发现 1 漏洞（F1，REJECT）**；其余攻击推演（同一 claim 重复排队幂等、stuck-disposal 部分建立新代、drain 窗口内 CLOSE 履行、deadline 先于 pong 超时取消、gen2 open 路径 aux 重置、终态迟到匹配 CLOSE_OK 静默）均复核封死。
6. **错误处理：⚠️ 缺口 1 处（即 F1：处置链在「removeTarget(drain 窗口) → deadline」路径断裂）**；协议错误收口面（violation fatal / 方向异常 / suppressed-send 本地结算）完整。
7. **架构评估：✅ 可行**（§D9 双侧分责裁决合理，死抽象清除到位；无需退回 SA1 重设计——F1 是边界条件缺口而非架构制约）。
8. **过度设计：✅ 精简**（变更半径与 Scope 对齐；claim/enqueueLifecycle 原语最小化；hub `closeSessionAndRelease` 保留字段读取语义正确）。

### 专项复核（本轮指令点）

- **SA2 R2 non-blocking notes 处置验证**：
  - **R2-N1（总则 1/3 措辞滞后）**：⚠️ 未执行——设计.md 仍为 R1 原文（总则 1 仍写 claim 含 epoch /「代际未推进才清字段」），dispatch log 亦无「§4.1/§4.2 为唯一权威」注记（SA2 给出的两条处置路径均未见落实）。**但所防风险（SA3 误读）经实证未发生**：实现严格按 §4.1 身份守卫语义（跨代但无新 session 时有意清字段 + aux teardown）。→ 不构成独立阻断；并入 F1 的 SA1 设计修订批（见 §2 回流目标），一次修完。
  - **R2-N2-①②（GOAWAY 提前投影时序 / hub applyStep2 门）**：SA3 报告 §4 已正式移交 SA7 ✓；静态面（G1/R3-5/D5/D6 全绿、零既有测试依赖 closing 期 SYNC_APPLIED）与全量回归互证。保持 SA7 动态确认项。
  - **R2-N2-③（§13.4 六新锚 SA6 决策）**：✅ 已闭——SA6 R2 决策表（C4b 新增；P3b/L1/W1/W2/W3 附理由不新增）登记于 task_issue-171.md。注：L1 不新增的理由（watchdog 零残留由 H1/P3/D5「代偿」）被 F1 证伪——F1 正是 L1 家族泄漏且无一既有锚覆盖；F1 锚已由本轮 SA4 补上（SA6 可斟酌收编/迁移，非阻断）。
- **无调试残留**：✅ 全部干净——diff 新增行零 `console.*`/`debugger`/`.only`/`.skip`/`TODO`/`FIXME`；SA3 自述的 `zz-debug-c4-green` 临时文件已删除（工作区与提交均无）；`TASK.md` git-ignored 未入提交；工作区唯一未提交变更为 `wiki/raw/task_issue-171_dispatch.md`（总控 runtime 日志，白名单）。
- **生命周期资源/协议错误收口**：除 F1 外全部到位（H1/P3/C4/C4b/G5 五链 + timer 卫生 + 恰一次释放判据 + 恰一条 fatal 收口路径）；测试侧 160/160 独立复现。

## 2. 阻断项（REJECT）— 可共同修复集合

### F1【CRITICAL / AC2 违例 / 对 ef19bae 基线回归】GOAWAY drain 窗口内 `removeTarget()` 泄漏已取得的 session/lease/watchdog

- **攻击路径**（全部源码行号以 HEAD 为准）：
  1. peer ns `live`（session/lease 已取得、watchdog idle 自 `subscribe()` 起武装且自重武装——peer-namespace.ts:1041 + fence-watchdog.ts startIdle 递归）；
  2. `GOAWAY{SERVER_RESTARTING}` 收帧 → `quiesceControllersLite()` → `onConnectionQuiesce()`（peer-namespace.ts:710-719）：投影 `disconnected`、**零处置排队**（§D6 轻量层，设计如此）；
  3. drain 窗口内（deadline 未到、连接仍 ready——removeTarget 是宿主任意时刻可调的公共 API）宿主调用 `removeTarget()` → `case 'disconnected'`（peer-namespace.ts:597-602）：`setState('closed') + settleCloseMemo()`，**不排队任何处置**；
  4. deadline 到期 → `quiesceControllers()` → `onConnectionFatal()` 首行 `if (this.isTerminal()) return;`（peer-namespace.ts:725-733）——state 已 `closed`（终态）→ **早退，处置排队被跳过**；transport close(1001) 后生产路径 `onConnectionLost()` 同样以终态早退（peer-connection.ts 连接级 `removeTarget` 为纯透传，无补偿处置）。
- **后果**：session 永不 close、lease 永不 release（registry remainingLeases 不回落 → namespace 永不 idle，ADR-0009 违例）、watchdog idle timer 永久自重武装（timer 泄漏 + 每 ackTimeoutMs 空转探测）、round/channel 簿记残留——直到连接级 `stop()`（`onConnectionStopped` 无条件处置）才被兜底。多 ns 长连接下为**无限期**泄漏。
- **回归依据**：ef19bae 基线该窗口资源照常处置——旧 `onGoaway` 收帧不动控制器（state 保持 `live`）→ removeTarget 走 `case 'live'` 收口链（CLOSE_NAMESPACE + ensureCloseMemo → drain + closeSessionAndRelease）。新实现因轻量层提前投影 `disconnected` 使该窗口落入无处置分支。
- **设计层根因**：SA1 R1 §D3 伪代码的 `case 'targeted'/'disconnected'` 同样没有 cleanupResources（SA3 忠实照抄）；SA2 R2 新攻击扫描核对了「stop() 在 deadline 前调用」却漏了「removeTarget 在窗口内调用」。
- **可复现证据**：`packages/ws-replication/test/ws-replication-sa4-issue171-review-red.test.ts`（SA4 新增，本轮）——确定性红灯：`deadline 后 session 必须已收口（AC2 零泄漏）: expected {…} to be undefined`；红灯症状即泄漏本体，无构造性假红（前置锚 live/GOAWAY/disconnected/removeTarget-closed 全部按预期通过后才红）。
- **修复方向（SA3 执行，最小变更）**：`removeTarget` 的 `case 'targeted'/'disconnected'` 在 settle 后补 `void this.cleanupResources().catch(() => undefined)`（与同函数 seq≤0 分支同款；claim 于同步段捕获——'targeted' 态 claim 为空 → 幂等 no-op；'disconnected'（GOAWAY 窗口）态 claim = 本代资源 → 恰一次处置；与 loss 路径已排队处置经幂等 same-promise 兑付不冲突）。**禁止**改 `onConnectionFatal` 的终态早退门（该门保护终态控制器免受重复静默投影，拆门会引入更大面）。
- **回流目标与固定复验范围**：
  - **SA3**：上述一行修复；复验范围 = F1 锚转绿 + `pnpm exec vitest run packages/ws-replication --typecheck` 全量 161/161（160 既有 + F1）+ `git diff --check`。直接影响面仅 removeTarget 分支，不需重验其余五链。
  - **SA1（设计注记，随本轮一并修，避免二次回流）**：§D3 `case 'targeted'/'disconnected'` 补 cleanupResources 语义 + §4.2 表 removeTarget 行「捕获时点」列同步；顺带落实 R2-N1（总则 1/3 措辞对齐身份守卫语义，SA2 建议的两行对齐）。
  - **SA6（可选，非阻断）**：F1 锚收编入 SA6 契约文件或保留 SA4 文件名；§13.4 L1「不新增」理由中的 H1/P3/D5 代偿主张已被 F1 证伪，决策表宜补注。

## 3. 残留注记（非阻断）

| # | 注记 | 处置 |
|---|---|---|
| N1 | drain 窗口内**在途** peer `startOpen` 续体（GOAWAY 前已发起）B-2c 守卫只判连接死亡/epoch，不判 drain 窗口 → 可能补发一帧 OPEN_NAMESPACE（有界：hub 应答被 §D7 静默、lease 在 deadline/失联处置中回收；新 OPEN 已被 `goawayActive` 门拦） | 交 SA7 动态观察；如判定违反 §6.3「停止 OPEN」严格执行面，回 SA1 裁决 |
| N2 | R2-N2-①②（GOAWAY 提前投影可观测时序 / hub applyStep2 门动态面） | SA7 动态轮（SA3 已移交） |
| N3 | R2-N1 设计措辞（总则 1/3） | 并入 F1 的 SA1 修订批（§2） |

## 4. 动态审核重点（交 SA7）

1. **F1 修复后的真机回归面**：GOAWAY RESTARTING 窗口内 removeTarget → deadline → registry `lease-released` 事件恰一次 + 无 watchdog 空转（静态锚已覆盖测试环境，动态面确认真 WS transport close 触发本地 onClose 后同样收口）。
2. N1：drain 窗口内在途 OPEN_NAMESPACE 出站与否的实测帧面（§6.3 执行面裁决依据）。
3. R2-N2-①②原项：GOAWAY 收帧段 ns `disconnected` 提前投影的可观测时序留证；hub applyStep2 isQuietState 门（closing 期零 SYNC_APPLIED 出站）。
4. C4/C4b 的 ERROR 帧真 wire 形态（1002 close code + blocked 投影）抽帧验证（测试 harness 已绿，动态面留证）。

## 5. Verdict

**reject** —— 阻断集合 = {F1}（可共同修复：SA3 一行 + SA1 设计注记批）；修复后按 §2 固定复验范围复审，预期 pass。本轮其余维度（Scope/调试残留/五链机制落实/测试质量/CI 触发性/协议假设）全部通过。
