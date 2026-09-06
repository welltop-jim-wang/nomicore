# SA6 契约对齐与轻量复验证据 — Issue #249（acceptance-contract R1）

- 阶段：acceptance-contract，iteration 1（durable dispatch `sa-338b70eb-71dd-49ab-9844-5b0f6c45c84f`；round 1）
- Worktree：`/home/wangjian/nomicore-fix-issue-249`（branch `mabf/issue-249`，HEAD `ac91a6bf17ae7661df3f6461456e7ca4e8e81526` = PR #248）
- 日期：2026-09-06（UTC）；执行：后台独立进程（`run_in_background: true`，Job 服务持有）
- 输入依据（全部已 approve / clear）：
  - SA2 独立攻击评审 `wiki/raw/task_249_sa2_review.md`（**approve**；§1.1 R2a 建议取 N4-(a) 形状、§1.2 R3-2 判别联合化 + O2 类型门禁勘误、§1.3 T-C 按 D-2 对齐；O7 覆盖域登记移交 SA6）
  - 设计 `wiki/raw/task_249_design.md` §10（SA6 owned 三处对齐）+ §5.2（reportDrop 判别联合）+ §6.6/§10.4（D-2）
  - SA8 设计后复审 `wiki/raw/task_249_design_conflict_report.md`（clear；N1–N5：N3 R2a 授权性质、N4 双向形状、N5 轻量复检）
  - 契约文件：`packages/namespace-registry/test/registry-issue-249-pump-red.test.ts`（R1a–d/R2a–d/R3-1/R3-2）、`registry-issue-249-duplicate-red.test.ts`（T-A/T-B/T-C）
- 本轮边界：只改两个 SA6 契约测试文件（对齐修订）+ 本证据文件；**零产品代码（src/）改动、零其他测试改动、零提交/推送/PR**。

## 0. 结果摘要

轻量复验（对齐修订后的两契约文件 × 当前 HEAD）：**7 failed | 6 passed (13)，Type Errors: no errors**，
exit=1（7 个失败均为预期红灯断言失败——正确缺陷断言；6 个绿灯守护锚全部保持）。
完整运行日志：`.scratch/249/sa6-align-final-run.log`。
与 R0 基线（6 failed | 7 passed）的差异仅为 **T-C 由绿转红**（D-2 对齐使其成为缺陷 C 的红→绿断言，
见 §4），其余用例判定逐项不变。

## 1. R2a 对齐（pump-red；绿灯守护锚的制造机制更换）

### 1.1 问题与修订形状

R0 编排依赖旧泵的重复调度制造第二个 pending 回调（`enqueue(2)` 排 S2），再以三次 `flushOne` 探
stale；修复后（scheduled+running 合一单飞位）全场景仅 2 次调度，第三次 `flushOne` 必抛
`no pending immediate to flush`（手工调度器 pump-red L77–82 对空 pending 无条件 throw）——绿锚被
修复本身击穿。修订（设计 §10.2 + SA2 建议形状 (a)）：**显式捕获并重调已触发回调**，且重调置于
下一次入队之前（队列真空 → 真「空队 no-op」，保 R0 语义），随后在两活回调之间入队并正常 flush。

### 1.2 双向绿逐符号推演（本证据独立复算）

| 步骤 | 现泵（running-only `draining`） | 修复后泵（`inflight` 合一位） | 断言 |
|---|---|---|---|
| `enqueue(1)` → 捕获 `stale = pending[0]` | 排 S1 | 排 S1（位已置） | — |
| `flushOne()`（S1） | 投递 1；`draining` finally 清除 | 投递 1；回调 finally 清位 | `delivered == ['0001']` |
| 显式重调 `stale()` | 队列真空 → 空跑 no-op（add/delete 位、`queues.delete` 缺键 no-op），零投递零调度 | 同左（`inflight.delete` no-op） | `delivered == ['0001']`；`pending.length == 0`；`scheduleCount == 1` |
| `enqueue(2)` | 位空 → 排 S2 | 位空 → 排 S2 | `scheduleCount == 2` |
| `flushOne()`（S2） | 投递 2 | 投递 2 | `delivered == ['0001','0002']`；`pending.length == 0`；`fired == 2` |

- 现泵逐符号复算依据 `src/diag-pump.ts` L106–141 亲读（drain 体内 add/delete、空判 break、
  排空 `queues.delete`、enqueue 容量早退先于调度门、裸 setImmediate 引用时点对 globalThis 求值）。
- 修复后泵按设计 §4.2 伪码推演（位排定前置、回调 finally 清除、drain 本体结构保持）。
- 两侧全部断言绿 → **双向绿成立**（与 SA2 §1.1 N4 双向推演一致）。
- 覆盖域（SA2 O7 落字）：修订后 R2a 探「已触发回调的重复触发」违约域；「重复调度产生第二个
  pending 回调」形态修复后结构性不可达（缺陷本体，由 R1a–R1c 锁定）。与 R2b/R2c/R2d 联合仍
  锁定设计 §4.3-4 坏修复反例（位清除时序错位 → R2b 红；循环外缓存队列数组引用 → R2a/R2b 红；
  位不提前到排定点 → R1a/R1b/R1c 红）。

### 1.3 授权性质登记（SA8 N3 落地）

契约头原无 R3-2/T-C 式明文预留通道（仅「现实现成立，修复不得破坏——以『持续绿』验收」条款）；
本修订合法锚 = **守护锚语义保持（stale 安全、零丢失、FIFO）前提下的制造机制更换**，已落字为
pump-red 契约头 R1d/R2a–R2d 分类注释（含 N3 授权说明、O7 覆盖域、双向绿声明）。修订版现泵
实跑绿（见 §5 结果表 R2a ✓）。

## 2. R3-2 对齐（pump-red；上报载荷判别联合化）

### 2.1 修订内容

- R0 本地 `DropReport = { operation: string; reason: 'queue-full' }` 字面形状无法给 init-stream
  丢弃诚实 operation（建流无词表位）——设计 §5.2 定形判别联合（emit 分支带被丢 emission 自身的
  operation；init-stream 分支无 operation），R0 契约头「SA1 设计若选不同 seam 形状/命名，须经
  SA6 对齐修订本契约」即预授权通道。
- 测试改为本地镜像类型：`EmitDropReport { kind:'emit'; operation; reason } | InitStreamDropReport
  { kind:'init-stream'; reason }`（与 §5.2 `DiagPumpDropReport` 逐字段一致；产品类型由 SA3 随实现
  导出），`reportDrop` 参数按镜像联合声明，断言先 `kind === 'emit'` 收窄再查 operation。
- 既有断言全数保留：44 条 emit 丢弃逐条上报、`reason === 'queue-full'`、`operation ===
  'namespace-create'`、载荷不含 namespaceId/streamId/token（低基数红线 ADR-0010 L159/ADR-0011 L87）。

### 2.2 类型级双向兼容论证（SA2 O2 落地）

- 修复前：`DiagPumpDeps` 无 `reportDrop`（src/diag-pump.ts L60–65 亲读）→ `satisfies DiagPumpDeps
  & { reportDrop: (drop: 本地联合) => void }` 仅约束字面量自身 → 零类型错误（实测确认）。
- 修复后：`DiagPumpDeps.reportDrop?: (drop: DiagPumpDropReport) => void`；函数参数逆变要求
  `DiagPumpDropReport` 可赋给本地镜像联合——emit 变体 `operation`（6 值封闭词表）⊆ `string` ✓，
  init-stream 变体逐字段同构 ✓ → satisfies 原样成立；`kind` 收窄后 `r.operation` 访问合法。
- 门禁通道（O2 修正）：`pnpm typecheck`（逐包 tsconfig 仅 include `src/**/*.ts`）不看测试文件；
  vitest typecheck 面仅 `*.test-d.ts`——两契约 `.test.ts` 的类型错误经 `pnpm exec vitest run`
  的 tsc 程序（`tsconfig.typecheck.json` 纳入各包 test/）以 unhandled/source error 暴露。
  **本对齐按构造保证类型清洁，不依赖 CI 兜底**；修订版实测 Type Errors: no errors（§5）。

### 2.3 R3-3（init-stream 丢弃上报）说明

设计 §13.3-a 的 R3-3 新覆盖（init-stream drop 上报恰一次）属 §13.3「随 SA6 对齐/SA3 实现落地」
的可选槽位，本轮对齐范围外的**新增覆盖**留 SA3 实现轮一并落地（其本地类型形状已由本修订的
判别联合镜像预置兼容）。本轮只完成 §10 指定的 R2a/R3-2/T-C 三处对齐与 N5 轻量复验。

## 3. T-C 对齐（duplicate-red；D-2 耗尽链路断言）

### 3.1 修订内容（设计 §6.6 D-2 / §10.4；契约头「耗尽链路……待设计冻结后由 SA6 对齐」预留通道）

- 业务锚不变：branded `NamespaceRegistryFatalError`、`committed:false`、
  `phase='namespace-id-generation'`（ADR-0010 L28）；耗尽终局本身零诊断记录（observer-only——
  `create-id-generation-failed` 事件），契约头已注明。
- 新增诊断面断言（D-2 对齐）：NS_A 流 = 1 committed（create #1）+ 9 rejected（create #2 的 9 个
  碰撞候选：`MAX_NAMESPACE_ID_RETRIES = 8`（registry.ts L202）→ 首生成 + 8 重试 = 9 候选，逐条
  与 T-A 同发射点）；9 条全部 `result.kind === 'rejected'`、`operation === 'namespace-create'`；
  NS_A `initStream` 恰 1 次（create #1 建流；候选经 `streamedNamespaces` 入队时登记 → 零补建，
  create-diagnostic.ts L440–449 亲证）；`unattributedDrops === 0`。
- 当前 HEAD 零候选发射（registry.ts L1311/L1410 静默 retry）→ `length 1 ≠ 10` **红灯**（缺陷 C
  的正确断言）；修复后 10/10 记录断言全过 → 转绿。

### 3.2 判定帧注记（供 SA3/总控防误读）

设计 §13.1「R1a/R1b/R1c、R3-2、T-A、T-B 六红转绿；…T-C（对齐版）持续绿」以 SA3 修绿后的
**验收帧**表述（AC7 终态 13/13 全绿，其中 T-C 由本对齐版红→绿）；对齐后当前 HEAD 基线的红集 =
**7**（新增 T-C）。SA3 修绿判据 = 本两文件 13 用例全绿 + Type Errors: no errors，非「六红」。
业务侧计数复核（SA2 §1.3 同）：9 碰撞候选各侧读一次 clock（DC-3 逐尝试恰一次保持）；fatal 终局
不入流、零补建流、unattributed 恒零。

## 4. 轻量复验（N5）— 对齐后契约 × 当前实现

命令（后台独立进程，Job 服务；root vitest 配置同 R0/SA2）：
`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run
 packages/namespace-registry/test/registry-issue-249-pump-red.test.ts
 packages/namespace-registry/test/registry-issue-249-duplicate-red.test.ts --reporter=verbose`

```text
Test Files  2 failed (2)
      Tests  7 failed | 6 passed (13)
Type Errors  no errors
Duration 3.08–3.27s（三轮复跑一致）
```

| 用例 | 判定 | 断言/实测 | 失败断言位置 | 缺陷链/性质 |
|---|---|---|---|---|
| R1a | 🔴 | scheduleCount 256 ≠ 1 | pump-red L203 | AC1 单飞违约（缺陷 A） |
| R1b | 🔴 | fired 256 ≠ 1 | pump-red L218 | AC1 重复调度空转放大（缺陷 A） |
| R1c | 🔴 | scheduleCount 256 ≠ 1 | pump-red L240 | AC1 跨窗口累积（缺陷 A） |
| R3-2 | 🔴 | reports 0 ≠ 44 | pump-red L420 | AC3 静默丢弃零上报（缺陷 B） |
| T-A | 🔴 | nsARecords 1 ≠ 2 | duplicate-red L226 | AC4 entry-collision 候选零发射（缺陷 C） |
| T-B | 🔴 | nsARecords 0 ≠ 1 | duplicate-red L250 | AC4 DOC_DUPLICATE 候选零发射（缺陷 C） |
| T-C | 🔴（对齐后） | nsARecords 1 ≠ 10 | duplicate-red L287 | AC4 耗尽链候选零发射（缺陷 C；D-2 对齐断言） |
| R1d | 🟢 | — | — | 守护锚（running 期重入同轮消费） |
| R2a | 🟢（对齐版） | delivered ['0001','0002']、pending 0、scheduleCount 2、fired 2 | — | 守护锚（stale 空队 no-op / 回调间任务不丢） |
| R2b/R2c/R2d | 🟢 | — | — | 守护锚（末任务期重入 / FIFO+init 序 / 违约隔离） |
| R3-1 | 🟢 | delivered 256 保序 | — | 守护锚（drop-newest 有界保序本体） |

- 红灯集合恰为三缺陷链（A/B/C）的正确断言：R1a/b/c + R3-2 + T-A/T-B/T-C；守护锚（R1d、R2a–R2d、
  R3-1）全部保持绿。Type Errors: no errors（R3-2 判别联合镜像在现实现上零类型错误；修复后兼容性
  按 §2.2 论证成立）。
- 对齐触面仅三处测试力学（R2a 制造机制 / R3-2 载荷类型与收窄 / T-C 断言集），其余用例零触碰
  （逐用例判定与 R0 一致，除 T-C 按 D-2 翻红——见 §3.2）。

## 5. N1–N5 / O1–O7 落地核验清单

| 注记 | 落地核验 |
|---|---|
| SA8 N3（R2a 授权性质） | §1.3 落字契约头（pump-red R1d/R2a–R2d 分类注释） |
| SA8 N4（R2a 双向形状） | §1.2 逐符号推演 + 现泵实跑绿；取形状 (a)（重调先于入队(2)，真空 no-op） |
| SA8 N5（轻量复检） | 本文件 §4（触发面仅三处）+ §5；ADR 层裁决仍属后续 SA8 复检位（流程卫生建议，非本阶段阻断） |
| SA2 O2（类型门禁通道） | §2.2 落字契约头 seam 锚注；验证命令 = `pnpm exec vitest run`（含 tsc 程序） |
| SA2 O7（R2a 覆盖域收窄） | §1.2 落字契约头（覆盖域 = 已触发回调重复触发；缺陷本体形态由 R1a–R1c 锁定） |
| SA2 §1.3（T-C 算术/归属复核） | §3.1 断言与 registry/create-diagnostic 源码锚逐项吻合（9 候选、seed 登记、零补建） |
| N1/N2（行号勘误 / clock 锚） | 本轮不涉（设计引用修正属 SA3/SA4 注释面，契约零相关） |
| O1/O3/O4/O5/O6 | 不涉契约文本；登记 SA3/SA4 观察面（sa7-dynamic 计数锚、结构等价理解、语义框架、stage 先例、滞留语义） |

## 6. 产物与后续路由

- 对齐修订文件：`packages/namespace-registry/test/registry-issue-249-pump-red.test.ts`、
  `packages/namespace-registry/test/registry-issue-249-duplicate-red.test.ts`
- 本证据：`wiki/raw/task_249_sa6_align_verification.md`；运行日志 `.scratch/249/sa6-align-final-run.log`
- 路由：对齐完成且轻量复验通过 → SA3 修绿（设计 §13.4 命令，后台进程执行；判据 = 13/13 全绿 +
  Type Errors 零 + 既有 5 套件 94/94 + 全量 `pnpm test`）→ SA4/SA7 双清。SA3 不得早于本对齐进入
  （本轮已消除其前置击穿：R2a 双向绿、R3-2 类型兼容、T-C D-2 断言）。
