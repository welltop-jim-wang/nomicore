# SA4 静态验尸报告

**Date**: 2026-08-27  
**审查对象**: `ace6f83`（`757bcd1..ace6f83`）  
**Verdict**: **pass**

## 审核范围与证据方法

本报告按 SA4 静态审查职责核验 round-2 的六文件差异、规范合同、写槽重构及新增 AC-6/回归测试；未修改生产代码。目标测试另起独立进程执行并通过。

### 1. File Scope / 黑名单

`git diff --name-only 757bcd1 ace6f83` 的实际变更为：

- `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`
- `docs/phases/phase-5-websocket-replication.md`
- `packages/namespace-registry/test/registry-phase5-replication-red.test.ts`
- `packages/namespace-runtime/package.json`
- `packages/namespace-runtime/src/replication-write.ts`
- `packages/namespace-runtime/test/runtime-replication-write.test.ts`

逐项均在设计 §7 ALLOW LIST 内；没有命中 §7 DENY LIST。未发现 `package-lock.json`、`yarn.lock`、`.DS_Store`、`TASK.md` 或根级 `.bak` 黑名单文件。范围一致，未发现 scope creep。

### 2. ADR 0008 落地精确性（SA2 R2 条件 1 / SA8 条件）

**通过。** `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md:127-137` 已追加 issue #132 节：

- 第 129 行逐字保留授权链：`issue #132 / PR #145 review feedback 1 / owner welltop-jim-wang / 2026-08-27`，并明确选择构造期复制事实窄例外。
- 第 130-132 行将读取限定在 Runtime 构造、对外发布前的 `META.replicationId` 和 `META.replicationEpoch`，封闭双键 disabled/enabled 判定，枚举部分存在、`undefined`、格式错误和 META 异型的同步构造拒绝。
- 第 133 行逐字写入 **“除此之外，原第 14 行保持不变”**，并明确仍不读取/验证 `SCHEMA`、`ROOT`、logical value，不引入通用 META validation。
- 第 134-137 行同步四写槽 FIFO、`status.replication` 的持久 identity/epoch 限界、dirty-not-durable、fatal committed-state recovery，以及 ADR 0010 的格式/不可变性/epoch 上限/Hub 权限权威地位。

因此授权链、例外闭合边界和原普通 open 的非回流约束均已实际落地。

### 3. Phase 5 Slice / 场景 15 分层（SA2 R2 条件 2）

**通过。** `docs/phases/phase-5-websocket-replication.md:52-59` 明列 Slice 1 Runtime/Lease 基础合同，界定两态 `status.replication`、唯一 FIFO、构造读取例外和 dirty-not-durable；第 59 行明确本 slice 不实现 Session/WS/reset。第 171-173 行将场景 15 拆分为：

- **15a**：本阶段 FIFO、dirty-not-durable、File bump epoch 2 durable restart；fatal 仅为 committed-state recovery；
- **15b**：切片 3–8 的 identity conflict / `resetReplica` archive。

文档没有把 notifier failure 宣称为 File durable restart。

### 4. 共享 `runReplicationWriteGate` 与原双槽行为等价（SA2 R2 条件 4）

**通过。** `packages/namespace-runtime/src/replication-write.ts:140-184` 的私有 helper 保留 E1→E2 顺序：

1. `state.fatal` 优先短路，不触及 `handle.getStatus()`、notifier 或 enable 输入；
2. `handle.getStatus()` 仅调用一次；throw 时先同步 `markWriteFatal`，再形成 `RuntimeWriteFatalError('write-slot-internal', false, writeFatalMessage(...))`；
3. non-ready 与 notifier 缺失复用原有 `disabled()` 文案；
4. 成功才单读捕获 notifier。

`runEnableReplicationSlot`（257-267）与 `runBumpReplicationEpochSlot`（367-373）在 gate failure 中保留原有结算分流：disabled 为 resolved `{ok:false}`，`RuntimeWriteFatalError` 为 async rejection；无额外 META 写。与基线双份 E1/E2 逐项比对，stable message、拒绝通道、`committed:false` 和 `markWriteFatal` 同步性均未改变。该 helper 私有，未增加公共 export 或 caller ripple。

新增 `packages/namespace-runtime/test/runtime-replication-write.test.ts:345-618` 经两个公共入口（非私有 helper 名称）验证：fatal/non-ready/getStatus throw/notifier absent/成功路径；含 hostile enable input、getStatus/notifier 计数、META 零写、fatal 的 branded rejection 与 `committed:false`，并以 notifier 时 META 快照验证 E5 后才通知。未发现 `readFileSync` 加源码字符串断言反模式。

### 5. AC-6 因果锚定与 durable wait（SA2 R2 条件 3）

**通过。**

- `registry-phase5-replication-red.test.ts:709-793` 的 fatal 用例名称及注释明确为 **committed-not-durable / committed-state recovery，非 File durability recovery**。它先在同一 live `Y.Doc` enable，令 bump notifier reject，断言 `RuntimeWriteFatalError` 且 `committed === true`、live META/status 均为 `id0/2`、fatal 非空；仅在 rejection **之后**从该 source live doc `Y.encodeStateAsUpdate`、`Y.applyUpdate` 生成 seed，并在 clone 前后断言 `id0/2`。新 Registry 仅从 `seedPersistence` 的此 seed open，验证新 generation 无 fatal 且可 bump 到 3。failed notifier 的 `stub` 未被 reopen，且断言无独立 save/load durable 记录。因此未预制 epoch=2 seed，也未把失败 notifier persistence 当 durable/reopen 前提。
- `:852-903` 的 File 用例先 enable、bump 至 epoch 2；先验证 live META/status，再在 dispose/restart 前对**磁盘快照**分别执行 `waitDurableSnapshot` 断言 `replicationEpoch === 2` 与 `replicationId === id0`。之后才 shutdown/dispose，并以同 rootDir 新 FilePersistence/Registry reopen 验证 `id0/2` 及 exact enabled status。它没有以 scheduler advance 或 `saveDoc` resolve 伪作 durable 证据。

### 6. 版本门禁

**通过。** `packages/namespace-runtime/package.json` 从 `0.1.8` 升为 `0.1.9`。`packages/namespace-registry/package.json` 未变；registry 本轮仅变更验收测试文件，满足“registry 仅 test 变更”。

### 7. Vitest 触发性自检（硬门禁 13/14）

**通过。** 本轮变动的 `*.test.ts` 为：

- `packages/namespace-runtime/test/runtime-replication-write.test.ts`，包 `@nomicore/namespace-runtime`；
- `packages/namespace-registry/test/registry-phase5-replication-red.test.ts`，包 `@nomicore/namespace-registry`。

根 `vitest.config.ts:5` 的 include 为 `packages/*/test/**/*.test.ts`；两文件都匹配。`.github/workflows/ci.yml:35-39` 的 PR CI `test` job 执行根 `pnpm test`；根 `package.json` 的 test script 为 `vitest run --typecheck`。因此两个所属 workspace package 都由根 Vitest 工作区覆盖，非 CI 孤儿测试。

## 审核结论

1. **设计一致性**：✅ 四项反馈均按设计与 SA2 R2 四条实现门禁落地。
2. **读写路径一致性**：✅ 本轮未改变写入数据源；gate 仍在同一 live Y.Doc transaction 前执行，File 恢复测试从 committed snapshot 打开同一事实投影。
3. **静默失败**：✅ gate refusal 保持稳定可观察结果；adapter `getStatus` 异常为 branded fatal；notifier failure 保持 committed facts 并进入 fatal，无静默 fallback。
4. **降级方案**：✅ 未引入 fallback；notifier failure 未被伪装为 durability。
5. **极端攻击**：✅ hostile input、non-ready、notifier absent、getStatus throw、fatal 及 MAX/facts 主路径未见本轮回归；新增测试覆盖 gate 易漂移短路面。
6. **错误处理**：✅ `getStatus` throw 先同步 `markWriteFatal`，随后以 committed:false branded rejection 传播；post-commit notifier failure 的既有 committed:true 纪律未被重构破坏。
7. **架构评估**：✅ 私有 gate 只收拢共享 E1/E2，未扩公共抽象或越过 Runtime/Registry/Persistence 边界。
8. **过度设计**：✅ helper 为两个逐字重复 gate 的最小私有提取；无不必要 public type/API 扩张。

## 验证证据

```text
git diff --check 757bcd1 ace6f83
=> exit 0

pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-write.test.ts packages/namespace-registry/test/registry-phase5-replication-red.test.ts --typecheck
=> Test Files 2 passed (2); Tests 30 passed (30); Type Errors no errors; exit 0

Scope comparison (actual diff − design §7 ALLOW LIST)
=> empty; DENY hits empty; blacklist hits empty
```

## 动态审核重点（交 SA7）

1. 在真实 FilePersistence timer/IO 环境复验 File bump 到 epoch 2 后，双字段 durable snapshot 形成前重启不可被误判为保证；形成后重启必须恢复相同 `id0/2`。
2. 在真实 notifier failure 场景复验 post-commit `RuntimeWriteFatalError(committed:true)` 后旧 generation 只读、禁写，且只从 failure 后 live Y.Doc 克隆的 recovery seed 产生的新 generation 可独立继续 bump。
3. 从 CI run log 摘录根 `pnpm test` 收集这两个新增测试文件的证据，补强本报告的静态 Vitest 触发性结论。

## Verdict

**pass**
