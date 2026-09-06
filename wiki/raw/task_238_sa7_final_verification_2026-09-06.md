# Issue #238 最终动态验证（final verification）— 分段观测与 sent/applied/acked 关联

## 任务标识

- 验证对象：Issue #238 当前实现（worktree `/home/wangjian/nomicore-fix-issue-238`，branch
  `mabf/issue-238`，基准 HEAD `9e3f0bf`，未提交未推送——按任务要求「Do not commit or push」遵守）。
- 改动面：22 modified + 2 new test files（与 SA4 复核 §二 登记集合逐文件一致，本验证以
  `git status`/`git diff HEAD` 重新枚举核对）。
- 输入（全部实读）：SA4 实现复核 `wiki/raw/task_238_sa4_impl_review_2026-09-06.md`（approve）、
  设计 `wiki/raw/task_238_design_2026-09-06.md`（approve）、SA2 攻击复核、SA5 分析、SA6 红灯契约、
  冲突报告/决议摘录、Issue #238 正文与 Owner 评论 `IC_kwDOT8JVvs8AAAABS2CyWg`（本验证经
  `gh issue view 238` 独立拉取复读——内容与 Owner 要求一致，当前唯一评论，无新增）。
- 验证人：最终动态验证角色（与 SA1–SA6 无身份重叠）。方法：**不采信任何先前登记值**，
  全部动态命令本 worktree 本轮重跑（后台 Job 进程），静态面逐文件实读 diff。

## 一、独立动态复跑证据（2026-09-06 本轮实跑，全部后台 Job）

| # | 命令 | 结果 | 对照 |
|---|---|---|---|
| D1 | `pnpm exec vitest run packages/ws-replication/test/ws-replication-issue238-repro.test.ts packages/ws-replication/test/ws-replication-issue238-segmented-observation.test.ts --reporter=verbose` | **2 files / 9 tests passed**，`Type Errors no errors`，exit 0（repro 阶梯 48ms + 契约 8 用例全绿，单轮 1.02s） | = Controller 登记值与 SA4 §一 |
| D2 | `pnpm --filter @nomicore/ws-replication typecheck` | **exit 0**（tsc -p 无输出即过） | = SA4 §一 |
| D3 | `pnpm exec vitest run packages/namespace-runtime/test packages/namespace-registry/test packages/ws-replication/test/ws-replication-observer-red.test.ts packages/ws-replication/test/ws-replication-api.test-d.ts` | **64 files / 623 tests passed**，`Type Errors no errors`，exit 0 | = SA4 §一逐位 |
| D4 | `pnpm exec vitest run packages/ws-replication/test` | **50 files / 356 tests passed**，`Type Errors no errors`，exit 0（19.03s） | = SA4 §一（348 基线 + 8 新契约，零回归） |

四组数值与 Controller 已登记验证及 SA4 复核登记**逐位一致**；无任何跳过/屏蔽
（全 vitest 实跑、tsc 实跑，非静默通过）。

## 二、Owner 要求（评论 IC_kwDOT8JVvs8AAAABS2CyWg）逐项动态核验

| Owner 要求 | 动态证据（D1 用例级） | 裁决 |
|---|---|---|
| 确定性观测区分 **event-loop stall** | 契约 6：注入已知漂移 Δ=30/20 → `event-loop-delay-sampled.delayMs` 精确 `[30,20]`；契约 7：时源缺面 → 零采样（dormant）。gating = observer+clock+ping/onPong 三者齐备（hub/peer connection diff 实读确认条件装配） | ✓ |
| **sequencer queue wait** | 契约 1：saveGate 构型逐笔 `queueWaitMs=[0,4000,3000,2000,1000]` 精确断言通过；契约 8：槽级样本 `waitMs=[1000,0]`、`queueDepthAtStart=[2,1]` 与事件面交叉验证一致 | ✓ |
| **protected check / live apply** | 契约 1：`protectedCheckMs`/`liveApplyMs` 恒 0 逐笔断言（手动时钟域微任务跳不推进钟——结构性精确）；捕获点 diff 实读 = R4 后 R5 前 / R5.5 后 R6 前 | ✓ |
| **dirty notification** | 契约 1：`dirtyNotifyMs=[5000,0,0,0,0]`（u1 = 门闩持有时长）精确断言通过 | ✓ |
| 可靠 **sent/applied/acked 关联** | 契约 1：三事件面 sequence 逐位相等**且与 wire 权威锚逐位相等**（UPDATE `header.sequence` 尾部 5 帧 + `UPDATE_ACK.ackedSequence` 尾部 5 帧）；契约 2 合并构型：5 业务写 = 2 帧，一 sequence 覆盖合并帧、三事件计数一致、`sendQueueMs=[0,4000]` 精确差值、事件 `bytes` = wire 载荷长度 | ✓ |
| 保留基线五笔阶梯 + 5 ACK + live/无重连/无 namespace-error，注入时钟/零 real sleep | repro（untracked 冻结文件）本轮实跑绿：阶梯 `[5000,4000,3000,2000,1000]`、`wires===1`、`ready`、`live`、零 namespace-error/resync/连接迁移、5 ACK、收敛 n=24；契约 1 以生产 seam 复证同一阶梯。grep 证实两测试文件零 real timer/sleep（命中均为注释），时序全部来自 `ManualMonotonicClock.advance` + 微任务泵 + deferred 门闩 | ✓ |
| 基线 = 机制锚，非生产 11 秒证明 | repro 头注边界声明保留（「不构成生产 11 秒占槽阶段的证明」）；protocol §23.4 新登记「跨侧减法只作 triage 近似」；ADR-0010 修订节同口径——全链无越界断言 | ✓ |

## 三、wire / 协议行为零变更核验（静态 + 动态双面）

**静态（diff 实读）**：

1. 帧构码路径零改动：`sendChecked`/UPDATE_ACK 构帧、envelope 编码、合并逻辑均未触；
   `update-channel.ts` 变更 = `queuedAt` 记账 + `noteUpdateSent` 回调 + `onUpdateAcked` info
   加性扩展（seq<=0 早退保持 → `update-sent` 恰一语义保持，observer 门在发射方保留）。
2. `update-sent` 发射点从 `sendUpdateFrame` 迁至 `noteUpdateSent`（记账后构型）——语义面
   等价（同为 seq>0 每帧恰一、同 observer 门）；D4 全套件既有 update-sent 计数断言全绿佐证。
3. 协议文档 diff 全部位于 §23（21 型登记 + 字段表 + §23.3 差值类别 + §23.4 捕获纪律 +
   §23.7 conformance 增补）与 ADR-0010 追加修订节；**§3/§10 wire 契约原文零改动**。
4. 设计「不触碰」面逐一实证零 diff：`observer.ts`/`plugin.ts`/`defaults.ts`/`index.ts`
   （ws-replication）、`lease.ts`、`packages/persistence/**`、`namespace-runtime/src/index.ts`。
5. FIFO 槽序：记账关闭路径与既有实现逐字节同形（`settled = this.tail.then(run, run)` 链形
   原样）；记账在场路径仅加 `runMeasured` 包装（微任务跳不影响 `.then` 链定序）；
   `await notifyDirty()` 位置未动；refusal/fatal 分支逐字节保持。
6. dormant 等价：无 stageClock → 零槽内时钟读、`stages` 缺席（契约 3 字段缺席断言）；
   clock-throw → 折叠（契约 4）；无 observer → 零事件（既有面 + D4）。

**动态（契约 8）**：observer+clock+stageClock 在场/缺席两构型双向帧 kind#seq 语义序列逐帧
全等、帧计数一致、无 Yjs 载荷控制帧字节长度一致——观测注入零 wire 扰动实测成立。

## 四、测试触发面覆盖验证

- 全部为真实 vitest 触发（D1–D4 后台 Job，含内嵌 typecheck `no errors`）；按文件路径聚焦，
  无 `-t` 过滤、无 skip、无伪装绿。
- 冻结面负向守卫（D3 623 tests）：runtime 十二键、O-11、lease 2 键、导出审计、internal
  形状守卫、safe-field 白名单（21 型 + 新字段增列后旧键集不变）全绿——**G4 零触碰的机器证据**。
- 守卫测试修改审计：`runtime-registry-internal-type-guard.test-d.ts` 的 `Allowed` 形状从
  `[DocHandle, () => Promise<void>]` 放宽为 `[…, unknown?]`——对应 ADR-0010 修订节第 1 条
  登记的加性可选第三参（仍拒绝一切多必填参/形状放宽/测试 seam 泄漏），属被批准演进的
  同步登记，非屏蔽；observer-red/api.test-d 均为 append-only 增列（旧键集逐字保持）。
- E2E 边界：fake-duplex 结构性排除 event-loop stall（设计 §6 已明示），探针判别力按
  Owner R2 边界依赖部署后数据——正向控制测试形态与该边界一致，无 E2E 缺口。

## 五、发现（全部非阻塞）

- **V1**（= SA4 O1，确认仍在、维持非阻塞）：`runtime.ts` `captureSeamInput` 顶层 TypeError
  文案仍列 `{ handle, p0Gate?, compile?, notifyDirty? }`，未列新键 `replicationObservability`。
  形状守卫本身响亮且正确（stageClock/slotMetrics 分别校验）——纯文案精度，建议后续 PR 顺手补。
- **V2**（= SA4 O4，接受）：wire 不变断言以 kind#seq 语义序列 + 无载荷帧字节长度实现
  （Yjs update 载荷含随机 doc client id，跨运行字节比结构性不可确定）；与仓库 conformance
  惯例一致，语义覆盖达成设计意图。
- **V3**（登记性观察）：`deliver()` 直发路径在 clock 注入时多一次时钟读（queuedAt 记账）；
  观测-only，无 wire/协议影响，缺省 dormant 零读。

无 HIGH/MEDIUM 级发现；无返工依据。

## 六、裁决

- 四组动态验证（聚焦 9/9 + typecheck exit 0 + 守卫 623/623 + 全套件 356/356）本轮独立
  重跑全绿，与 Controller 登记及 SA4 复核逐位一致；零回归、零屏蔽。
- Owner 七项要求逐项以可复跑断言固化并本轮实测通过；基线锚（阶梯/5 ACK/live/无重连/
  无 namespace-error/注入时钟/零 real sleep）原样保留；「机制锚非生产证明」边界全链一致。
- wire/协议行为零变更：静态 diff（帧构码零触、§3/§10 原文零改动、不触碰面零 diff、FIFO
  链形保持）与动态 wire 全等契约双面成立；G1–G4 未触发（守卫 623 绿为机器证据）。
- 实现与已批准设计逐文件一致；SA4 发现 O1–O7 处置核实（O1 顺手项保留，其余登记性观察）。

**Verdict: approve**

（交付即本报告；未 commit、未 push——按任务边界。）
