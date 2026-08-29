# SA4 静态验尸报告（Revision Round 2）

**Date**: 2026-08-30
**Verdict**: **pass**
**被审对象**: commit `34bbfba`（src 7 文件 + package.json bump + 6 测试适配 + r2-red 入库）+ `c95c088`（SA6 守卫修订，仅 r2-red 测试文件）；diff 基线 `58150ad..HEAD`（15 文件，+640/−63）
**行为契约与比对基准**: `task_phase5-ws-multiplex-backpressure-r2_design.md`（822 行最终态，含 E1~E3 勘误）/ SA2 评审（R2 轮 verdict pass）/ SA6 红灯报告（8 红灯 + 1 直绿）

---

## 审核结论

1. **设计一致性：✅ 一致**（含三项实现期勘误 E1/E2/E3 逐条核实，零未申报偏离）
2. **读写路径一致性：✅ 一致**（`controlReserveBytes` 单一消费点；无数据源分叉）
3. **静默失败：✅ 无新增**（R2-1 消灭终局静默；残余非队尾面 = 已登记 R2-B1 接受风险，非隐藏决策）
4. **降级方案：✅ 安全**（无新增降级；队列非空 F4 = round-1 冻结语义 + D4 钉死域）
5. **极端攻击：✅ 安全**（§2.4 边界矩阵 8 形态逐项源码级复核通过，见下「极端条件攻击」节）
6. **错误处理：✅ 完整**（收口路径全部有 wire/状态可观察信号；无三层防御缺口）
7. **架构评估：✅ 可行**（零绕过、零 FIXME、变更半径 = 缺陷面）
8. **过度设计：✅ 精简**（src 净变化 ~+30/−24 行 + 判据换 1 处 + 配置 3 行，与设计 §14 验收第 5 条及简报一致）

---

## 一、文件清单 Scope Creep Guard（§1.1 立法）——✅ 通过

- **ALLOW LIST 比对**：`git diff --name-only 58150ad..HEAD`（15 文件）与设计 §12 ALLOW LIST
  （7 src + package.json + 7 test）**精确集合相等，零越界、零缺失**：
  - src：`update-channel.ts` / `backpressure.ts` / `peer-connection.ts` / `hub-connection.ts` /
    `types.ts` / `defaults.ts` / `validate.ts`
  - `packages/ws-replication/package.json`（0.1.1 → 0.1.2 patch ✓，验收第 5 条）
  - test：`ws-replication-issue137-r2-red.test.ts`（[SA6 owned]）/ `ac6-resync-close` /
    `sa4-f1-f2-f3-red` / `r3-r4-regressions` / `sa7-issue137-dynamic` / `api.test-d.ts` / `harness.ts`
- **BLACKLIST**：零命中（无 package-lock/yarn.lock/.DS_Store/TASK.md/.bak）。
- **DENY LIST 核实**：`frame-io.ts`、`peer-namespace.ts`、`hub-namespace.ts`、`index.ts`、
  `round-engine.ts` 等全部零改动（`git diff 58150ad..HEAD -- <deny files>` 空）；控制器大小门
  （hub-namespace.ts:658 `> maxUpdateBytes → return 0`）按设计 §2.2 保留为不可达后盾 ✓。
- **REPORT.md**：工作区有修改但**未 commit**（简报验收第 6 条 ✓）。
- `c95c088` 仅触 r2-red 测试文件（13+/5−），与设计授权的「两处守卫修订」（§5.6 区间守卫 +
  E1 直发守卫勘误）一致，非第三处。

## 二、SA4 grep 门禁（设计 §3 / E3 扩展）——✅ 通过

`tsconfig.base.json` 确无 `noUnusedLocals`（grep 证实）→ grep 兜底必要且充分：

| 文件 | encodeMessage | codecFieldLimits | 门禁要求 | 判定 |
|---|---|---|---|---|
| `src/peer-connection.ts` | **0** | **0** | 0 ∧ 0 | ✅ |
| `src/hub-connection.ts` | **0** | **2**（import :12 + 调用 :279） | 0 ∧ ≥1 | ✅ |

辅助核实：`connectionErrorFrame` 保留且在用（peer :513/:544、hub :372——收口路径走
`emitControl → OutboundQueue.sendControl` 内部编码，不经 encodeMessage）；peer 其余 frame-io
import（decodeInbound/OutboundQueue/namespaceErrorFrame）全部存活，无其它新增死 import。

## 三、五项修复的逐项源码比对（设计一致性）

### R2-1（§2.2 钉死形态）✅ 逐字一致

`update-channel.ts sendAndRegister` 入口前置判别与设计代码块逐行对应：

- 超限且 `queued.length === 0` → `discardQueued()`（空队列 no-op）+ `needsResync = true` +
  `host.declareLocalResync()`；超限且队列非空 → 静默 F4（D4 钉死域，R2-B1 登记）。
- **重入安全独立复核**：代码顺序为 `needsResync = true` **先于** `declareLocalResync()` ⇒
  声明链（sendChecked → host.sendControl → sender.sendControl → observeWater → 同步
  resume/drainData 重入）中任何 channel 再入（deliver 首行 / pullAndSendOne 前置②）立即被
  needsResync 挡住——无双重收口/无帧序扰动。
- **延迟恢复触发面存在**：直发/队尾收口时 `inFlight > 0` 的场景由 `onUpdateAck →
  (state==='needs-resync') → maybeStartRecovery`（peer-namespace.ts:481-483）重触发；
  `maybeStartRecovery` 的 inFlight>0 早退（:690）与之配对闭环。`resyncDeclared` 记忆化在
  round 完成点复位（peer:662 / hub:763）。
- hub 侧 host 钩子 `declareLocalResync → onLocalResyncEdge → declareHubResync`（hub-namespace.ts:149,
  :640-647）存在且 `isQuietState` 守卫与既有语义一致——双侧对称成立。
- `pullAndSendOne` 返回值语义（消费即进展）未动；drain 循环（backpressure.ts drainData）帧间
  复查 `paused/isEmitAllowed` 吸收收口引起的再暂停 ✓。

### R2-2（§3 钉死形态）✅ 双侧对称一致

- peer：删 0xffffffff ERROR 直发 → `close(1008)` → `enterBlocked()`（:485；enterBlocked 首行
  `sender?.teardown()` :556-562 实证——R2-A4 依据成立）；import 按设计精确形态改写
  （`import type { ReplicationMessage }` + 删 codecFieldLimits）。
- hub：`sender.teardown()` 先行 → `close(1008)` → `closedFlag/state='closed'/void cleanupAll()`
  （既有收口拓扑逐行保留）。
- 耗尽后零出站帧：全方法仅 close 调用，无任何 send/emit 残留（源码通读证实）。

### R2-3（§4.1 钉死形态）✅ 逐字一致

`overflows()` = `queued.length >= maxQueuedUpdateCount`（count `>=`）∨
`queuedByteCount + incoming.byteLength > maxQueuedUpdateBytes`（bytes 严格大于）；in-flight
全部剔除。溢出处置（discardQueued + needsResync + live/deferred 分派）逐字未动。validate 既有
`maxQueuedUpdateBytes ≥ maxUpdateBytes` 约束在新判据下自洽复活（设计 §4.1 论证与源码一致）。

### R2-4（§5.1 契约面四点）✅ 全部落位

- `types.ts` +1 必填字段（highWater 之后）；`defaults.ts` +`controlReserveBytes: 64*1024`
  （与旧 lowWater 缺省逐值相等 → 缺省零漂移）；`validate.ts` +`positiveSafeInteger`（构造期
  响亮 TypeError，零运行时 clamp——§17 L494-506 纪律 ✓）。
- `backpressure.ts sendControl` 耗尽谓词换 `limits.controlReserveBytes`（唯一消费点）；
  `observeWater` 的 lowWater 读取（:172/:198）保留 = §17 L492 水位迟滞语义收窄声明与源码一致。
- 耗尽动作（`onBackpressureExhausted` 两实现）逐字未动 ✓。

### R2-5 ✅ 落盘即修复（零 src）

测试为真行为断言（wire 帧数 / 收敛 / 状态 / 本地接受），与设计 §6 对应关系一致；无伪绿面。

## 四、SA6 守卫修订核验（§5.6 钉死 + E1 勘误）——✅ 形态逐字落实

- **R2-4（生效）区间守卫**：实测 `ackBytes2 = ackByteLength(wire0)`（运行时测量非硬编码）→
  `allowed = floor(1500/ackBytes2)` → 三断言 `hub n ≥ allowed+1` ∧ `hub n ≤ allowed+1+8`
  （=maxInFlightUpdates）∧ `peer n === K`——与设计 §5.6 代码块逐字对应；1011/backoff/ERROR×1/
  牙口元断言全部保留。
- **R2-1（直发）E1 修订**：删除瞬时态快照断言；保留 `RESYNC_REQUIRED ≥ 1`（核心红灯锚）+
  `peer blurb === BIG` + `connectionState === 'ready'`；新增 `settleUntil(hub blurb === BIG)`
  收敛分支——与 E1 钉死契约形态逐条对应。

**非软化实证（本报告关键证据）**：将 src 临时回退至 `58150ad`（修复前）后运行**修订后**的
r2-red 测试 → **恰 8 红 + R2-5 绿**（exit 1），其中 R2-1（直发）失败锚 = `expected 0 to be
greater than or equal to 1`（RESYNC_REQUIRED 缺席，非旁因）。⇒ 守卫修订后的测试对旧实现仍是
真实红灯，「锚修正非软化」成立；红→绿闭环完整。回退实验后工作区已精确恢复（`git status
--porcelain packages/ws-replication` 空 + `git diff HEAD -- src` 空）。

## 五、既有测试适配核验（§5.4/§9）——✅ 全部登记面落实

- 3 个 R2-3 边界用例（ac6 / F1 / ⑧a）各 +1 笔第三写（字段 `ext`——E2 deviation 落实；
  `SCHEMA_ENVELOPE`（harness.ts:162）证实 `ext` 为 schema 合法字段 ✓）；原溢出后断言
  （RESYNC=1 / needs-resync / round 修复 / fence）保持；ac6 收敛断言补 `ext=3` 一行。
- D3a/D3c 各 +1 行 `controlReserveBytes` 覆写（lowWater/highWater 保留原值作水位迟滞）——
  与原语义逐帧等价；D3b 零改动（注释措辞更新）。
- `api.test-d.ts` +1 行形状 pin；`harness.ts` 镜像 +2 行（WsReplicationLimits 字段 +
  CONTRACT_LIMITS 值）——纯镜像，无运行时断言消费面。

## 六、测试质量与 CI 触发性（§1.3/§1.4/§1.7 立法）——✅ 通过

- **§1.7 源码 grep 断言禁令**：15 个 diff 测试文件扫描 `readFileSync + toMatch/toContain`
  反模式 → **0 命中**；r2-red 全部锚在 wire 帧 / 状态投影 / 持久化值（R2-2 私态注入
  `lastSeq` 为文档化 seam，断言为运行时 wire 行为）。
- **vitest 触发性**：全部改动 `*.test.ts` 位于 `packages/ws-replication/test`；CI `Test` step
  （`pnpm test` = `vitest run --typecheck`）经根 `vitest.config.ts` include
  `packages/*/test/**/*.test.ts` 覆盖该包；`api.test-d.ts` 由 typecheck include
  `packages/*/test/**/*.test-d.ts` 覆盖；`pnpm typecheck` 显式含
  `tsc -p packages/ws-replication/tsconfig.json`。零「测试存在但未接通」面。
- E2E spec：本轮零 `*.spec.ts` 改动，§1.3 不触发。

## 七、协议假设审查（§1.5）——✅ 通过

设计 §11 章节齐备（P-1~P-6 + R2-A1~A10），依据全部为源码/测试/实测引用，无「应该/通常」类
无据推断。关键实测类假设 R2-A8（UPDATE_ACK=57B）不构成测试脆弱点：r2-red 的 allowed 由
`ackByteLength(wire)` 运行时测量推导（非硬编码 57），区间守卫自适配帧长变化——SA2 N2 勘误
要求的「锚定区间界而非典型值」已在测试形态中落实。本轮无 HTTP 端点/端口/进程时序类新假设。

## 八、契约改动连锁审查（§1.6）——✅ 无触发

五类触发（return→throw / Promise 形态 / 同步变异步 / catch 重抛 / 可空性翻转）零命中——全部
改动为私有方法内部行为 + 类型增量。公共面唯一增量 `ReplicationLimits` +必填字段：全仓穷举
字面量仅 `DEFAULT_REPLICATION_LIMITS` 一处（已同步），外部消费均经 `Partial`（增量兼容）——
设计 §10 审计与源码一致（SA4 grep 复核）。

## 九、读写路径 / 静默失败 / 降级 / 极端条件攻击

- **读写路径**：`controlReserveBytes` 写入面（types/defaults/validate/resolveLimits spread）与
  读取面（backpressure sendControl 单点）闭环；`overflows` 记账面（queued.length/
  queuedByteCount）与入账面（deliver 入队 / takeItems 核减）口径一致，R2-1 收口的
  discardQueued 对空队列 no-op——三套账务零分叉。
- **静默失败**：R2-1 消灭「队尾超限终局静默」（RESYNC_REQUIRED + 恢复 round 双可观察）；
  R2-2 耗尽路径保留 close(1008) + blocked/closed 可观察收口；残余非队尾静默面为显式登记的
  R2-B1 已接受风险（D4 冻结契约钉死 + 协议无发送侧超限强制条款），非本轮引入亦非隐藏。
- **降级**：无新增降级路径；「队列非空 ⇒ F4」不是恒真前提的条件化收窄（B-8 定案登记）。
- **极端条件攻击（§2.4 矩阵 + 补充推演，全部静态通过）**：
  - `[BIG]` 队尾 / `[BIG,合法×2]`（D4）/ `[合法,BIG]` / `[BIG1,BIG2]`（pass1 静默 + pass2 响亮）/
    窗口满滞留 / 耗尽叠加（连接已先行收口，通道 teardown 置 needsResync）——与矩阵逐项一致。
  - 合并模式（queuedCount > avail）下超限首项：takeItems「至少一项 + 累计原始字节上界」⇒
    BIG 独占一帧 → 漏斗判别命中，后续 pass 发合法项——D4 活性保持。
  - `byteLength === maxUpdateBytes`（严格 `>`，恰等放行）；`maxQueuedUpdateCount=1` 最小合法值
    （validate positiveSafeInteger）；needsResync 已置位时 deliver/pull 双前置拦截（无重复声明）；
    needsResync 先置后声明的重入序（见 R2-1 节）；声明链中 sendControl 触发额度耗尽的极端
    （→ connectionFatal 1011）亦为响亮路径。
  - 未发现可静态确认的新漏洞；无需运行时验证的新风险面（既有动态面见下节）。

## 十、架构与过度设计

- 无「绕过 3 处架构约束」信号、零 FIXME/临时补丁、零与设计相悖的新数据流——不触发退回 SA1。
- 变更半径 = 缺陷面：R0-1（零新状态/零新 wire 码，reasonCode 复用 'send-queue-overflow'——
  SA2 #3 接受性登记）、R0-2（namespace-registry 零触碰）、R0-3（零 transport 面）全部维持。
- src 净变化与设计估算一致（判别块 + 注释 ~20 行、双侧删帧 ~−24 行、判据 1 处、配置 3 行），
  无为未来需求的抽象层。

---

## 验证证据（命令 + 结果）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx vitest run packages/ws-replication`（独立后台进程复跑） | **15 文件 / 103 测试全绿，Type Errors: no errors，exit 0**（/tmp/sa4.log；与 SA6 终态日志 `.mabf-bg/sa6-r2-final-vitest.log` 一致） |
| 2 | `npx tsc -p packages/ws-replication/tsconfig.json` | **exit 0**（零类型错误） |
| 3 | `git diff --check 58150ad..HEAD` | 干净（零空白错误） |
| 4 | `grep -c "encodeMessage\|codecFieldLimits" src/{peer,hub}-connection.ts` | peer 0/0、hub 0/2——门禁精确命中（§二表格） |
| 5 | `git diff --name-only 58150ad..HEAD` ∩ 设计 §12 ALLOW | 集合精确相等（15/15），comm 差集空 |
| 6 | **红灯复现**：`git checkout 58150ad -- src package.json` → 运行修订后 r2-red → 恢复 | **8 failed + 1 passed（R2-5），exit 1**；R2-1（直发）失败锚 = `expected 0 to be ≥ 1`（RESYNC 缺席）——守卫修订非软化实证；恢复后 `git status --porcelain packages/ws-replication` 为空 |
| 7 | `.mabf-bg/sa6-r2-full-vitest-r2.log`（红灯期归档） | `Tests 8 failed + 95 passed (103)`，VITEST_EXIT=1——8 红灯原貌与 SA6 报告一致 |
| 8 | 源码 grep 断言扫描（15 测试文件） | 0 命中 |
| 9 | `.github/workflows/ci.yml` + 根 `vitest.config.ts` | ws-replication 测试全部被 CI `pnpm test`/`pnpm typecheck` 覆盖 |

## 动态审核重点（交 SA7）

1. **R2-4（生效）hub n 实测落点**：区间守卫自适配（allowed 运行时测量），静态下界 27/上界
   34（窗口算术）已由本测试钉死；SA7 可从 `gh run view --log` 或本地复跑记录实际观测值
   （预期 [27,34]，微任务交错非确定——无需按精确值验证，SA2 N2 口径）。
2. **真实 transport 下的缺省零漂移**：本轮测试全走 fake-duplex；生产 WS（真实 bufferedAmount
   水位驱动暂停段）下 `controlReserveBytes` 缺省 64KiB 与旧 lowWater 缺省逐帧等价的声明，
   建议在活链路抽样暂停段 control 行为对照。
3. **R2-1 直发路径 in-flight>0 变体**：本轮直发 IT 为空窗口形态；「窗口部分占用 + 单笔超限
   直发 → 收口 → onUpdateAck 延迟恢复」链路（静态闭环已核：peer-namespace:481-483）无专测，
   属 slice-10 可选加固位（非本轮验收面）。
4. **vitest/spec 触发证据摘录**：按 §1.4 与 SA7 SKILL 联动要求，从 CI 日志摘录
   ws-replication 103 测试被执行的证据行。

---

## 门禁字面值索引（HG14/HG15 补齐，零内容变更）

- 1.4 vitest 触发性自检：all-vitest-packages-triggered —— 详见 §六（packages/ws-replication/test 经根 vitest.config include + pnpm test/typecheck 全覆盖，零未接通面）
- 1.5 协议假设审查：protocol-assumption-pass —— 详见 §七（设计 §11 P-1~P-6 + R2-A1~A10 逐条可验证，零无据推断）

---

## 结论

五项缺陷（R2-1~R2-4）修复与设计钉死形态逐字一致，R2-5 覆盖缺口落盘；8 红灯 → 修复 → 转绿
闭环经 SA4 独立复现证实为真实闭环（含守卫修订后测试对旧实现仍 8 红的关键反证）；103/103 全绿
+ tsc 零错 + `git diff --check` 干净 + scope 精确匹配 + grep 门禁通过 + 零源码 grep 断言 +
CI 全接通。**Verdict: pass**——可进入后续流程；动态面留 SA7 四项抽查点（均非阻断）。

---

## 状态事故与修复（2026-08-30 追记 · 硬门禁透明性登记）

### 事故描述

本报告第四节的「红灯复现」实验采用**原地暂态回退**：detached 脚本内
`git checkout 58150ad -- packages/ws-replication/src packages/ws-replication/package.json`
→ 运行 r2-red → `git checkout HEAD -- <同路径>` 恢复。该方法存在两个缺陷：

1. **暂态窗口**：`git checkout <commit> --` 同时更新 index 与 worktree ⇒ 实验期间
   `git status` 呈现「8 文件 staged 逆向 diff」（7 src + package.json，与总控巡查观察
   完全吻合）；窗口持续整个 vitest 运行期（~数秒），期间任何并发巡查/读取都会看到
   受损状态。
2. **恢复无保障**：脚本内恢复命令无 `trap` 兜底——若 vitest 阶段进程被杀或 shell 异常
   退出，worktree+index 将**滞留 58150ad 旧内容**。总控判定该滞留实际发生（grep
   `controlReserveBytes` = 0 命中、peer/hub 仍含 0xffffffff ERROR 直发代码、8 文件
   staged = 修复逆向 diff）。

### 法证核查（修复轮实测，如实登记）

SA4 接到修复指令后、执行 restore **之前**的勘察显示当时状态已与 HEAD 一致：
`git diff HEAD -- src+package.json` 与 `git diff --cached HEAD -- 同路径` 均为空、
`controlReserveBytes` 命中 backpressure=2/types=1/defaults=1/validate=1、status 仅余两个
SA7 未跟踪测试文件。两种观察并存的可能解释：总控快照命中实验暂态窗口（缺陷 1），或快照
与修复轮勘察之间存在中间态。两种观察均如实登记，不以己方单一观察否定总控记录；实验设计
缺陷 1/2 成立并在此认领。原报告「恢复后 src diff 空」的检查方法本身可靠
（`git diff HEAD` 比较 worktree vs HEAD，不受 index 状态遮蔽），不能作为「未发生滞留」的
证明——事后单点检查无法排除检查时刻与恢复时刻之间的异常。

### 修复执行（按总控指令，git 操作零手写文件）

1. `git restore --source=HEAD --staged --worktree packages/ws-replication/` → `RESTORE_OK`
   （对当时状态为幂等操作，仍按指令完整执行）。
2. 验证结果：
   - `git status --short -- packages/ws-replication/src packages/ws-replication/package.json`
     → **全空** ✓
   - `grep -c controlReserveBytes` → backpressure.ts=2 / types.ts=1 / defaults.ts=1 /
     validate.ts=1（全部非零）✓
   - `grep -c 0xffffffff peer/hub-connection.ts` = 各 **1**——该命中为 **34bbfba 修复提交
     自带的 R2-2 doc 注释文本**（peer:477 / hub:413「任何后续帧都只能以重复序列
     0xffffffff 发送 ⇒ …」），属正确修复态的合法内容，非残留代码；**代码级**命中
     （`transport.send`/`encodeMessage`/`sequence: 0xffffffff` 模式）= **0** ✓，设计 §3
     注册的 grep 门禁（encodeMessage/codecFieldLimits）同步复核通过（peer 0/0、hub 0/2）✓。
     指令判据「grep -c 0xffffffff 须为 0」对注释字符串过严，以代码级门禁为准，如实登记。
   - `git diff HEAD --stat -- packages/ws-replication/` = 0 行 ∧
     `git diff --cached --stat` = 0 行（worktree、index、HEAD 三方一致）✓

### 复跑验证（后台独立进程，修复后终态）

- `npx vitest run packages/ws-replication` → **17 文件 / 106 测试全绿，Type Errors: no
  errors，exit 0**（= 本轮验收面 15 文件/103 测试 + SA7 新增未跟踪文件
  `ws-replication-sa7-r2-transport.test.ts` / `ws-replication-sa7-r2-supplement.test.ts`
  合计 2 文件/3 测试——**零失败**，无失败清单需要记录；SA7 文件零触碰、src 零改动）。
- `npx tsc -p packages/ws-replication/tsconfig.json` → **exit 0**（零输出零错误）。

### 教训与自律（对后续 SA4 轮次的约束）

红灯复现类实验**禁止在受审 worktree 原地回退**，一律改用隔离载体
（`git worktree add <tmp> 58150ad` + 拷入测试文件 + 独立依赖解析），使受审 worktree 在
任何时刻不出现非 HEAD 状态；如必须原地操作，恢复命令须置于 `trap … EXIT` 保障，并在脚本
尾追加三方一致性自检（`git diff HEAD` ∧ `git diff --cached` 双空断言）。本事故未影响本轮
验尸结论的正确性（全部结论基于 HEAD 状态的读取与运行；实验仅产生上述暂态/滞留窗口），
Verdict 维持 **pass**。
