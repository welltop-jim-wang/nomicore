# SA3 实现报告 — Issue #249（implementation R0）

- 阶段：implementation，iteration 0（dispatch `sa-dd9624c1-0502-4920-a7a4-1ea0b0b2a911`；round 1）
- Worktree：`/home/wangjian/nomicore-fix-issue-249`（branch `mabf/issue-249`，HEAD `ac91a6bf17ae7661df3f6461456e7ca4e8e81526` = PR #248）
- 日期：2026-09-06（UTC）
- 批准输入：设计 `wiki/raw/task_249_design.md`（SA8 前置/设计后 clear、SA2 approve）；SA6 R1 对齐契约两文件 + `wiki/raw/task_249_sa6_align_verification.md`
- 本轮边界：实现 + 新增覆盖（design §13.3 a–d）+ 本报告；**零提交、零推送、零 PR**（交付 Host 精确路径，由 Controller/总控 finalize）

## 1. 改动总表（5 个产品文件 + 1 个版本 + 1 个新增测试文件）

| 文件 | 改动（对照设计） |
|---|---|
| `packages/namespace-registry/src/diag-pump.ts` | AC1：调度门 `draining`（running-only）→ **`inflight` scheduled+running 合一位**（排定时置位、setImmediate 回调末尾 finally 清除——design §4.2/§4.3）；drain 循环结构（每轮重取引用/空判 break/排空 delete）与 runTask 保持（SA2 O3）。AC3：`DiagPumpDropReport` 判别联合导出 + `DiagPumpDeps.reportDrop?` 可选依赖 + 满队 drop 点逐条上报（同步、恰一次、泵侧 try/catch 收编——design §5.2）；敌意 setImmediate 位回滚（SA2 O6 正向改进 + 滞留语义注释） |
| `packages/namespace-registry/src/observer.ts` | `RegistryObserverEvent` 联合增 `diag-pump-drop` 变体（type/taskKind/operation?/reason 四封闭维度——design §5.3；ADR-0009 L95 内部 seam 按票增量；index.ts 零导出） |
| `packages/namespace-registry/src/create-diagnostic.ts` | `CreateDiag.emitCandidateOutcome` 新方法（泵路径实现：observedAt 复用/侧读 clock → assemble → seedRejectedStreamIfAbsent → enqueueEmit；legacy 与 NOOP_DIAG no-op——D-1）；`CreateEmissionArgs` 增可选 `sourceModule`（缺省 'registry'；assembleEmission 成对展开采用）；`createDiagRuntime` 第三参 options `reportPumpDrop` 接线进泵 |
| `packages/namespace-registry/src/registry.ts` | 泵装配增 `reportPumpDrop` 窄回调 → `dispatchObserver`（`diag-pump-drop` 事件，design §5.4）；**发射点 1**（L1311 entry collision）候选 emission：identity / NAMESPACE_ALREADY_EXISTS / rejected / not-accessed / observedAt=undefined（侧读一次 clock）；**发射点 2**（DOC_DUPLICATE）候选 emission：transaction / DOC_DUPLICATE / sourceModule persistence / snapshot 复用 p.createdAt；orchestrateCreate 头注释按新事实改写（design §6.1/§6.3） |
| `packages/namespace-registry/package.json` | patch 版本 bump **0.1.8 → 0.1.9**（唯一被改包；namespace-diagnostic-log 零改动——指纹/schema/词表冻结面零触碰） |
| `packages/namespace-registry/test/registry-issue-249-coverage.test.ts` | **新增**（SA3 owned）：design §13.3-a R3-3（init-stream 丢弃上报恰一次、无 operation、从未执行）；§13.3-b observer 落点锁（满队丢弃 → `diag-pump-drop` 恰四键低基数载荷、不含 namespaceId/streamId/token；observer throw 隔离锁）；§13.3-c legacy no-op 锁（entry collision + DOC_DUPLICATE 内部重试零候选记录）；§13.3-d sourceModule 成对锁（DOC_DUPLICATE→persistence、NAMESPACE_ALREADY_EXISTS→registry + stage 精确映射） |
| `packages/namespace-registry/test/registry-issue-249-duplicate-red.test.ts` | **类型机械修正（语义零改动，SA6 契约文件）**：`tsconfig.typecheck.json` 编译面（noUncheckedIndexedAccess / exactOptionalPropertyTypes）下 latent source 类型错误——`scriptedIds` 数组索引读加非空断言（L69→`!`）；`assemble` 的 `StubPersistence` 可选参按在场性分形构造。断言/语义/注释契约零触碰（`pnpm test` = `vitest run --typecheck` 全程序编译 test/ 目录时暴露；SA6 R0/R1 两文件显式跑未含 `--typecheck` 标志故未暴露） |

## 2. ADR 红线保持（自检）

- 词表冻结：候选记录全部取既有冻结值（identity/transaction、NAMESPACE_ALREADY_EXISTS/DOC_DUPLICATE、rejected、registry/persistence）；**零词表演进、零 schema/指纹变更、零公共面（index.ts）改动**。
- 泵 ≠ adapter writer queue：单 record 同步 append 语义一字未动；只改调度门与上报。
- 低基数健康面：drop 上报/事件只有 kind/operation/reason 或 type/taskKind/operation?/reason 封闭维度；namespaceId/streamId/token 不进（新增覆盖 b 以「事件键集恰四维」锁定）。
- 输入零访问：entry collision `not-accessed`（只读 entries map）；DOC_DUPLICATE 复用既有 frozen snapshot。
- 归属/建流：候选归候选 id 流；seed 语义复用（`streamedNamespaces` 入队时登记 → T-A 零补建 / T-B 恰一次 genesis-less / T-C 零补建）；unattributed 恒零。
- 业务零漂移：两发射点均在既有 retry return 之前、槽内 O(1)、既有吞没边界内；legacy/NOOP no-op 保 #150「恰一条最终结局」冻结锚（registry-create-diagnostic-red L529 + sa7-dynamic `emitCalls===10` 实测保持绿）。
- 调度原语：仍恒裸 `setImmediate`；未引入被守卫的 setTimeout/setInterval/Date.now。
- 版本：`@nomicore/namespace-registry` patch 0.1.8 → 0.1.9。

## 3. 验证证据（后台独立进程，Job 服务持有；root vitest 配置）

### 3.1 对齐验收契约 + 新增覆盖（13 对齐契约 + 7 覆盖 = 20/20 全绿，Type Errors 零）

命令：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run registry-issue-249-pump-red / -duplicate-red / -coverage`

```text
Test Files  3 passed (3)
      Tests  20 passed (20)
Type Errors  no errors
Duration 4.76s
```

红→绿逐用例（对照 SA6 R1 基线 7 failed | 6 passed）：

| 用例 | R1 基线 | 修复后 | 断言命中 |
|---|---|---|---|
| R1a/R1b/R1c | 🔴 | 🟢 | scheduleCount=1 / fired=1 / pending 有界（AC1 单飞） |
| R1d | 🟢 | 🟢 | running 期重入同轮消费 |
| R2a（对齐版） | 🟢 | 🟢 | stale 重调空队 no-op、零丢失、scheduleCount 2 |
| R2b/R2c/R2d | 🟢 | 🟢 | 交错/保序/违约隔离守护锚保持 |
| R3-1 | 🟢 | 🟢 | drop-newest 有界保序 |
| R3-2 | 🔴 | 🟢 | 44 条丢弃逐条上报（判别联合 + kind 收窄） |
| T-A/T-B | 🔴 | 🟢 | 候选 rejected 落正确流；T-B genesis-less 补建恰一次 |
| T-C（D-2 对齐版） | 🔴 | 🟢 | NS_A = 1 committed + 9 rejected、零 fatal 记录、initStream 恰 1、unattributedDrops 0 |
| §13.3-a R3-3 | 新增 | 🟢 | init-stream drop 上报恰一次、无 operation、未执行 |
| §13.3-b×2 | 新增 | 🟢 | diag-pump-drop 事件恰四键；observer throw 零影响 |
| §13.3-c×2 | 新增 | 🟢 | legacy 候选零记录（entry collision 2 committed / DOC_DUPLICATE 1 committed） |
| §13.3-d×2 | 新增 | 🟢 | DOC_DUPLICATE→persistence/transaction；NAMESPACE_ALREADY_EXISTS→registry/identity |

### 3.2 既有绿基线（防回退面，104/104 全绿）

命令：6 文件（SA5 基线 5 套件 94/94 + SA2 O1 显式观察面 sa7-dynamic 10/10）

```text
Test Files  6 passed (6)
      Tests  104 passed (104)
Type Errors  no errors
Duration 39.35s
```

关键锚：registry-create-diagnostic-red L529（legacy DOC_DUPLICATE 恰 1 条最终结局）、registry-create.test（无日志 clock 锚族）、registry-issue-226-red（泵路径 13 项隔离/顺序）、registry-surface（12 项导出/守卫面）、sa7-dynamic（`emitCalls===10` 与 stream 计数锚）。

### 3.3 根门禁（AC8）

- `pnpm typecheck`（14 工程串行）：**PASS（exit 0）**（`.scratch/249/sa3-root-typecheck.log`）。
- `pnpm test`（`vitest run --typecheck`，root 收集面含三个 `registry-issue-249-*.test.ts`）：
  首轮 **2889 用例中 2887 绿**、`Type Errors: no errors`、263 文件 262 绿；唯一 2 失败 =
  `packages/vfsl-codegen/test/generate-cli-check.test.ts` 两例 **5s 默认超时**（该包与本票
  零代码交集；30s 预算下 8/8 全过——`codegen-check-widebudget.log`，纯机器预算边缘，
  非逻辑失败）。首轮另两例 `registry-phase5-replication-session-red` AC-5 超时（隔离实跑
  4.86–5.0s 边缘）在次轮全量复跑中通过。**namespace-registry 全部套件两轮全量均绿**。
  日志：`.scratch/249/sa3-root-test.log`、`.scratch/249/sa3-root-test2.log`。
- `git diff --check`：**PASS（exit 0）**（两轮）。

## 4. 剩余风险

| # | 风险 | 状态/缓解 |
|---|---|---|
| 1 | Runtime wrapper emission 经 pump 满队时以 `reportDrop` 上报、不进诊断流——修复语义为「记录丢失但可见」 | 设计预期（ADR-0014 L240 低基数 dropped metrics）；既有 drop 有界性不变 |
| 2 | entry collision 候选侧读一次 clock（每碰撞候选 +1 读数） | DC-3 每尝试恰一次保持；无既有 clock 计数锚受影响（registry-create.test 无日志场景 zero 读数不变——实测 47/47 绿） |
| 3 | 敌意全局 setImmediate 持续 throw 时队列滞留（≤256/ns） | 有界、不外溢、不重复投递；注释登记（SA2 O6） |
| 4 | 生产 Host 未注入 observer → drops 静默（事件无消费方） | 与全部既有 observer 事件同语义；yjs-server 装配零改动（已核） |
| 5 | 新测试依赖队列容量 256 与槽内 enqueue 次序（b 锁两处丢弃计数 2 = burst 越界 1 + committed 1） | 注释已写明推导；容量/次序变更会显式击穿该锁（锁的有意灵敏度） |
| 6 | 全量 `pnpm test` 两例环境性超时：`vfsl-codegen/generate-cli-check`（该包与本票零代码交集；30s 预算 8/8 全过——纯 5s 默认预算边缘；CI 以 runner 实际能力裁决） | 已证 budget-only（wide-budget 复跑全绿）；非 #249 改动引入；namespace-registry 全量两轮全绿 |

## 5. 产物与路由

- 改动：见 §1 表；测试证据日志：`.scratch/249/sa3-contract-run.log`、`.scratch/249/sa3-regression-run.log`、`.scratch/249/sa3-root-*.log`（不入仓候选，仅审计）
- 路由：交付 Controller/总控 → SA4 静态验尸 → SA7 动态验证 → AC 门禁 → finalize（`verificationMode: required-sa-approvals`）
