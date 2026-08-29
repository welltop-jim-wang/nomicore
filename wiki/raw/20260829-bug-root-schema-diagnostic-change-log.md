# [Bug] NamespaceRuntime ROOT mutation 与 SCHEMA replacement 未接入诊断变更日志（零记录）

**Status**: analyzed | **Date**: 2026-08-29
**Severity**: medium
**Type**: new-feature-defect（接线从未存在，非回归——ADR-0012 amendment C 点名的 #149 接线缺口）
**Layer**: multi-service（`@nomicore/namespace-runtime` + `@nomicore/doc-runtime` + `@nomicore/namespace-diagnostic-log` 三包接缝缺失）

## Symptoms

操作者装配了 namespace 诊断变更日志（`@nomicore/namespace-diagnostic-log` 的 memory/file adapter）后，通过 NamespaceRuntime 公共面 `mutateRoot()` / `replaceSchema()` 执行的**每一条**变更尝试——无论 committed、rejected 还是 fatal——在日志流中产生 **0 条记录**。操作者无法通过稳定 stage/code 区分 committed update、no-op、expected rejection 与 committed-aware fatal（Issue #149 Objective 所要求的全部能力均不可用）。

影响范围：诊断 observability 面全部缺失；业务面（返回值、sequencer 顺序、zero-write、dirty notification、capability 状态）不受影响——缺口是纯增量观测面，不是业务故障。

## Reproduction

复现方式：SA5 临时 vitest 测试（文件已删除，关键内容保留于此）。在 `packages/namespace-runtime/test/` 下构造真实 Runtime（真实内存 Persistence + P0 ready + `notifyDirty` 绑定），装配 memory 诊断日志，连续执行 6 种既有结果路径：

1. `mutateRoot({op:'set',path:['n'],value:42})` → `{ok:true}`（committed）
2. `mutateRoot({op:'set',path:['a'],value:99})` → `ok:false`（validation 拒绝）
3. `mutateRoot(带 accessor 的敌意输入)` → `ok:false`（input-snapshot 拒绝）
4. `replaceSchema({schema: <合法同型 envelope>})` → `{ok:true}`（committed，keep-root）
5. `replaceSchema({schema: <畸形 text envelope>})` → `ok:false`（schema-compile 拒绝）
6. `runtime.close()` 后 `mutateRoot(...)` → `ok:false`（acceptance 拒绝）

命令与结果（2026-08-29，worktree `nomicore-fix-issue-149`，node/pnpm 已装依赖）：

```
$ npx vitest run packages/namespace-runtime/test/sa5-diag-repro.test.ts --typecheck.enabled=false
[SA5-DIAG] memory log records after 5 attempts: 0
[SA5-DIAG] memory log stats: {"streamId":"log-78dcd…","capacity":1024,"queueDepth":0,
             "accepted":0,"droppedTotal":0,…,"lastSequenceAssigned":null}
[SA5-DIAG] records after acceptance refusal: 0
 ✓  (2 tests) 157ms
```

另一层复现（结构性，更根本）：在 namespace-runtime 的任何文件 `import { createBoundedMemoryDiagnosticLog } from '@nomicore/namespace-diagnostic-log'` 直接失败——该包不在 `packages/namespace-runtime/package.json` 依赖中，说明符不可解析（首次运行复现测试即以此方式失败）。

基线：两包既有测试 `npx vitest run packages/namespace-runtime/test packages/namespace-diagnostic-log/test` → **49 文件 / 533 测试全绿**（缺口不破坏任何既有契约）。

## Investigation

静态考古（阅读文件：runtime.ts、write.ts、schema-write.ts、emission.ts、vocabulary.ts、index.ts×2、mutation.ts/schema-replace.ts 摘录）+ 动态复现 + 全仓 grep。

**两侧接缝均健康、中间链路整体缺失**：

1. **消费侧（诊断日志包，#148/#152/#153 已交付）**：`NamespaceDiagnosticChangeEmitter` 接缝（`packages/namespace-diagnostic-log/src/emission.ts:74-76`，同步 void 不 throw）、`EmissionResult` 七分支判别联合（committed/noop、committed/update、committed/update-omitted、rejected、fatal×3——emission.ts:15-23）、`EmissionInput` 四态（not-accessed/unavailable/unsafe-input/snapshot——emission.ts:26-30）、冻结词表（vocabulary.ts：`root-mutation`/`schema-replacement` operation 与 8 值 stage 均已就位）全部可用。memory adapter `createMemoryLog` 提供 `records()`/`stats()` 读面。
2. **生产侧（Runtime 写路径）**：`runRootWriteSlot`（write.ts:77-166）与 `runSchemaWriteSlot`（schema-write.ts:102-199）结构完整、结果路径齐全，但整文件零诊断引用。
3. **全仓 grep**：`createDiagnosticChangeEmitter`/`createBoundedMemoryDiagnosticLog`/`createFileDiagnosticLog` 在生产代码中的引用**仅存在于诊断日志包自身**；`.emit(` 调用全仓无一处指向诊断 emitter（命中皆为 vfsl `ctx.emit` 与 TS `program.emit`，无关）。
4. **数据流断点**：变更事实的产生点在两个写槽的 gate/校验/事务/notifier 各分支（含接纳层 lifecycle 拒绝 runtime.ts:236-247），而日志消费者（emitter）从未被传入 Runtime——数据在源头即丢失，链路第二环（producer→emitter）物理不存在。
5. **effect 载荷断点（AC2 前置）**：`applyValidatedMutation`（doc-runtime/src/mutation.ts:44-56）返回 `{ok:true}|{ok:false,issues}`，`replaceSchemaAndRoot`（doc-runtime/src/schema-replace.ts:123）返回 `ReplaceResult`——**两者都不产出该事务的 owned Yjs update bytes**；doc-runtime 全包无 `encodeStateAsUpdate` 捕获路径。ADR-0011 §D Consequences 已明文预告此缺口（"transaction seam 未来需要提供 owned update bytes"）。

**git 考古**：`packages/namespace-runtime/src` 最后修改于 5db6f83（Phase 3 #85）/ 6472485（Phase 4 #105）；诊断日志契约 7ceede1（#156，2026-08-28"Freeze the v1 diagnostic record contract and memory adapter"）及其后 #152/#153 提交均未触碰 runtime 包——接线从未存在，非回归。

**依赖说明（任务简报 Dependency note 复核）**：简报称"Blocked by #148, which may not yet be merged"——实际 #148 的交付已合入当前 worktree（commit 7ceede1，`packages/namespace-diagnostic-log` v0.1.4 完整存在且测试绿）。**依赖已满足，无需阻塞**；本报告按当前 worktree 现状分析，无因依赖缺位导致的限制。

## Root Cause

四层缺口，逐层精确：

1. **包依赖层**：`packages/namespace-runtime/package.json` `dependencies` 缺 `@nomicore/namespace-diagnostic-log`——生产代码 import 不可达。
2. **注入层**：`NamespaceRuntimeSeamInput`（runtime.ts:53-64）与生产工厂 `createNamespaceRuntime`（runtime.ts:274-279）均无 emitter/诊断注入字段；`WriteEnv`（write.ts:40-50）与 `SchemaWriteEnv`（schema-write.ts:50-61）同缺——emitter 无法到达写槽闭包。
3. **发射层**：两个写槽与接纳层的全部既有结果路径无一处 emit 调用。需覆盖的路径清单（SA1 映射 stage 的完整输入集）：
   - 接纳层（runtime.ts:236-247）：lifecycle≠ready 拒绝 → `acceptance` / `RUNTIME_WRITE_DISABLED`（input `not-accessed`）
   - S1 fatal 已置位（write.ts:79-81 / schema-write.ts:104-106）→ `capability-gate` / `RUNTIME_WRITE_DISABLED`（input `not-accessed`）
   - S2 handle 非 ready（write.ts:97-101 / schema-write.ts:116-120）与 notifyDirty 未绑定（write.ts:102-107 / schema-write.ts:121-126）→ `capability-gate` / `RUNTIME_WRITE_DISABLED`（input `not-accessed`）
   - S2 getStatus throw（write.ts:87-96 / schema-write.ts:109-115）→ fatal `write-slot-internal` committed:false
   - S3 快照失败（write.ts:111-112 / schema-write.ts:130-131）→ `input-snapshot` / `MUTATION_INPUT_NOT_PLAIN_DATA`（input `unavailable/unsafe-input`，不再读原输入）
   - S3 形状检查失败（schema-write.ts:132-133，仅 SCHEMA）→ `input-snapshot` 或 `validation`（SA1 裁决）
   - S4 schema unavailable（write.ts:115-124，仅 ROOT）→ `capability-gate` / `SCHEMA_UNAVAILABLE`
   - S4 compile ok:false（schema-write.ts:139-146）→ `schema-compile` / issues
   - S4 守卫 throw（schema-write.ts:147-153）→ fatal `schema-compile-throw` committed:false → `schema-compile`
   - S5 领域失败（write.ts:146-148 / schema-write.ts:175）→ `validation` / issues
   - S5 DocRuntimeFatalError 透传（write.ts:141-143 / schema-write.ts:170-172）与未知异常保守 committed:true（write.ts:144 / schema-write.ts:173）→ fatal（phase 透传）→ `transaction`
   - S6 notifyDirty 失败（write.ts:151-162 / schema-write.ts:182-195）→ fatal committed:true `notify-dirty-failed` → `dirty-notification`
   - S7 成功（write.ts:165 / schema-write.ts:198）→ `committed`；update bytes 可得时 `effect:update`，不可得时显式 `update-omitted`（受控 reason 词表：`payload-too-large`/`update-capture-disabled`/`empty-update`——新增 reason 须过设计评审，见 CONTEXT.md）
4. **effect 捕获层（AC2 深层前置）**：doc-runtime 事务接缝（`applyValidatedMutation` / `replaceSchemaAndRoot`）不返回 owned Yjs update bytes，也无 transaction update 捕获 seam——committed `effect:update` 所需的权威载荷当前无处获取（不得以事务后整文档编码冒充，ADR-0011 §D 明文禁止）。

**根因一句话**：#148/#152/#153 只交付了诊断日志的契约与存储侧，NamespaceRuntime 的两个写槽与接纳层从未获得 emitter 注入与发射调用（依赖、seam、emit、owned-bytes 四层全缺）——ROOT/SCHEMA 变更事实在产生点即丢失。

**Fix direction**（供 SA1 设计参考，不展开具体实现方案）：
需要沿"注入—发射—载荷"三段补线：(a) 在 Runtime 构造 seam（`NamespaceRuntimeSeamInput` + 生产工厂）新增可选 emitter + Clock 注入，emitter 引用进入 `WriteEnv`/`SchemaWriteEnv` 闭包；(b) 在两个写槽的全部既有结果路径（含接纳层拒绝与 fatal/notifier 路径）按上文 stage 映射发射语义 emission，emit 位置遵守 ADR-0012 amendment C（不得在 write sequencer slot 内执行同步 File adapter emit；slot 外或 slot 释放后发射）并保持 gate 拒绝 `input:not-accessed`、快照失败不重读敌意输入；(c) 为 doc-runtime 事务 seam 增加"不暴露 live Y.Doc 的 owned update bytes 交付"能力（transaction 内捕获该事务 update），使 committed 记录可携带精确 effect，捕获不可得时显式 `update-omitted`。

## Evidence

**E1 全仓零 emitter 消费者**（生产代码引用仅诊断日志包自身）：
```
$ grep -rln "createDiagnosticChangeEmitter|createBoundedMemoryDiagnosticLog|createFileDiagnosticLog" packages domains apps --include="*.ts" | grep -v test
packages/namespace-diagnostic-log/src/pipeline.ts
packages/namespace-diagnostic-log/src/index.ts
packages/namespace-diagnostic-log/src/adapters/memory.ts
packages/namespace-diagnostic-log/src/adapters/file.ts
（namespace-runtime / doc-runtime / namespace-registry：零命中）
```

**E2 依赖不可达**：`packages/namespace-runtime/package.json` dependencies = `{doc-runtime, persistence, vfsl, yjs}`——无 `namespace-diagnostic-log`；复现测试以裸说明符 import 直接 `Cannot find package '@nomicore/namespace-diagnostic-log'`。

**E3 动态复现（六路径零记录）**：见 Reproduction 小节命令输出——`records().length === 0`、`stats().accepted === 0`。

**E4 Seam 无注入字段**：`NamespaceRuntimeSeamInput`（runtime.ts:53-64）仅 `{ handle, p0Gate?, compile?, notifyDirty? }`；`WriteEnv`（write.ts:40-50）仅 `{ doc, handle, state, notifyDirty }`；`SchemaWriteEnv`（schema-write.ts:50-61）多 `compile`——三者均无 emitter/Clock。

**E5 owned bytes 缺口**：
```
mutation.ts:28-30  export type ApplyValidatedMutationResult = { ok: true } | { ok: false; issues: MutationIssue[] };
schema-replace.ts:123  export function replaceSchemaAndRoot(doc, input): ReplaceResult
$ grep -n "encodeStateAsUpdate|updateBytes" packages/doc-runtime/src/*.ts → 无命中
ADR-0011 §D Consequences：「为记录精确 committed effect，doc-runtime/replication transaction seam 未来需要提供 owned update bytes」
```

**E6 基线绿**：`npx vitest run packages/namespace-runtime/test packages/namespace-diagnostic-log/test` → 49 files / 533 tests passed，typecheck no errors。

**E7 git 考古（非回归）**：
```
$ git log -1 --format="%h %s" -- packages/namespace-runtime/src/write.ts
5db6f83 Phase 3：NamespaceRuntime 读写能力与单序列器 (#85)
$ git log --oneline -3 -- packages/namespace-runtime/src
6472485 Phase 4：NamespaceRegistry、调用方租约与 Cordis Host 生命周期 (#105)
5db6f83 Phase 3：NamespaceRuntime 读写能力与单序列器 (#85)
（诊断日志三连提交 7ceede1/8611e68/eaf0484 均未触碰 runtime 包）
```

**E8 词表已就位**（vocabulary.ts:13-31）：`Operation` 含 `root-mutation`/`schema-replacement`；`Stage` 8 值封闭枚举齐备——日志侧无需任何演进即可承接本票 emission。

**现场清理**：临时测试 `sa5-diag-repro.test.ts` 已删除；`git diff --stat` 为空（无残留源码改动）。
