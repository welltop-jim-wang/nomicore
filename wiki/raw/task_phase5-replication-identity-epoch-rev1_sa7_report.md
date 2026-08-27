# SA7 动态验证报告 — Phase 5 replication identity / epoch（issue #132，round 2）

- **审查对象**：HEAD `8dade807a43a16865fae3cd8ffa7117c547e3921`（包含 SA3 实现 `ace6f83`）
- **前置条件**：SA4 `Verdict: pass`（`task_phase5-replication-identity-epoch-rev1_sa4_review.md:5`）
- **执行方式**：所有测试均经 `setsid nohup` 在独立后台进程执行；开始前仅对 8000/8081/3005 执行了无目标时安全的 `fuser -k`，未清理未知进程。

## Step 0 / SA4 前置结论

SA4 verdict 为 **pass**，因此进入独立动态验证。此修订轮按任务简报明确没有 SA5/SA6 红灯测试，未将“无 SA6”误报为失败。

## 全量回归与稳定性

```text
pnpm test
=> exit 0
=> Test Files 126 passed (126)
=> Tests 1485 passed (1485)
=> Type Errors no errors
=> Duration 108.97s
```

指定改动测试随后独立重复执行两次，均无 flake：

```text
pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-write.test.ts packages/namespace-registry/test/registry-phase5-replication-red.test.ts --typecheck
=> Test Files 2 passed (2); Tests 30 passed (30); Type Errors no errors; exit 0

# 重跑
=> Test Files 2 passed (2); Tests 30 passed (30); Type Errors no errors; exit 0
```

最终在还原所有变异后，连同已有真实 File 动态用例再次执行：

```text
pnpm exec vitest run packages/namespace-registry/test/registry-phase5-replication-red.test.ts packages/namespace-runtime/test/runtime-replication-write.test.ts packages/namespace-registry/test/registry-sa7-phase5-replication-dynamic.test.ts --typecheck
=> Test Files 3 passed (3); Tests 34 passed (34); Type Errors no errors; exit 0
```

## AC-6 活链路验证

### A. File bump durable restart

`registry-phase5-replication-red.test.ts` 的 AC-6 File 用例走真实 `FilePersistence`、真实 fs `writeFile → rename` 和新 `FilePersistence`/新 Registry reopen：enable 后 bump 到 epoch 2，先对磁盘 committed snapshot 的 `META.replicationEpoch === 2` 与 `META.replicationId === id0` 分别执行 `waitDurableSnapshot`，然后 dispose/restart，最终断言 reopen 的 META 与 `status.replication` 精确为 enabled/id0/2。

这不是 fake scheduler 或 `saveDoc` resolve 伪锚。对 durable wait 的目标值执行可逆变异（`2 → 999`）后，单文件测试在该 AC-6 用例约 5 秒超时并以 exit 1 失败：

```text
FilePersistence bump 恢复 ...
→ Test timed out in 5000ms.
Test Files 1 failed (1); Tests 1 failed | 15 passed (16); exit 1
```

随即将测试文件逐字节还原，指定两文件重跑恢复为 `2 passed / 30 passed`，最终三文件复跑为 `3 passed / 34 passed`。因此 durable wait 是真实磁盘事实门，而非空断言。

### B. fatal committed-not-durable recovery

同一 AC-6 文件的 fatal 用例真实执行如下因果链：可失败 notifier 的同一 live Y.Doc 中 enable 成功；bump notifier reject；获得 `RuntimeWriteFatalError(committed:true)`；旧 generation 的 live META/status 保留 id0/2 且 fatal 非空；**在 rejection 之后**才用该 live doc 的 `Y.encodeStateAsUpdate`/`Y.applyUpdate` 生成 seed；新 registry 仅从 seed persistence open，fatal 为空，继续 bump 到 3。

动态运行两次的指定测试均通过（每次均为 `registry-phase5-replication-red.test.ts (16 tests)`），证明该恢复路径可重复且不依赖失败 notifier persistence 作为 durable/reopen 前提。

## 共享 gate 双入口等价性

`runtime-replication-write.test.ts` 的五类实际入口测试全部通过，覆盖 enable/bump 两入口的：

1. fatal：`getStatus`、notifier、hostile enable input 均零访问；
2. non-ready：`getStatus` 恰一次、notifier/input 零访问；
3. `getStatus` throw：两个入口均抛 branded `RuntimeWriteFatalError(write-slot-internal, committed:false)`，无 notifier/input/META 写；
4. notifier absent：`getStatus` 恰一次后拒绝，输入不进入 E3；
5. 成功：`getStatus` 恰一次，enable input 单读，两个 notifier 均在 E5 提交 META 后恰一次调用。

对 fatal enable 的关键短路计数断言做可逆变异（预期 `0 → 1`）后，测试确定性失败：

```text
expected +0 to be 1
FAIL ... fatal 已置位 ... E1 短路于一切
Test Files 1 failed (1); Tests 1 failed | 13 passed (14); exit 1
```

随后逐字节还原测试，最终三文件动态重跑全绿。此变异表明访问计数断言实际能捕捉 E1 短路漂移。

## ADR 语义与运行时行为抽查

已有真实 File 动态用例 `registry-sa7-phase5-replication-dynamic.test.ts` 与本次最终目标运行一同通过（4 tests）。其中：

- 磁盘 snapshot 中 `replicationEpoch` 键存在但值 `undefined`，round-trip 后仍 `has() === true`，open 被收编为 `NamespaceRegistryFatalError(operation=open, phase=runtime-construction, committed=false)`，cause 含 `NSRT-REPLICATION-META-CORRUPT`；
- 双键真缺席的同类磁盘 seed 则成功 open，`status.replication === { state: 'disabled' }`；
- `META` 异型为 `Y.Text` 的 live seed 同样构造期响亮拒绝。

这与 ADR 增补的窄读取例外、构造期损坏拒绝和 disabled/enabled 两态投影一致；未观察到将损坏伪装为 disabled 的运行时路径。

## vitest 触发证据（硬门禁 14）

本轮尚未产生可查询的发布后 CI run/job log，故不能把本地执行伪称 CI 触发证据。以下是本地根 `pnpm test` 的真实 runner 输出，证明根 Vitest include 实际命中两个目标 workspace 文件：

```text
✓ packages/namespace-registry/test/registry-phase5-replication-red.test.ts (16 tests) 898ms
✓ packages/namespace-runtime/test/runtime-replication-write.test.ts (14 tests) 26ms

Test Files 126 passed (126)
     Tests 1485 passed (1485)
Type Errors no errors
```

| Workspace Package | 本地 root `pnpm test` 命中行 | 结果 |
|---|---|---|
| `@nomicore/namespace-registry` | `✓ packages/namespace-registry/test/registry-phase5-replication-red.test.ts (16 tests)` | ✓ 本地根 runner 触发并通过 |
| `@nomicore/namespace-runtime` | `✓ packages/namespace-runtime/test/runtime-replication-write.test.ts (14 tests)` | ✓ 本地根 runner 触发并通过 |

**CI Run**：未提供 / 本 SA 不创建或等待发布后 CI。
**CI verdict**：⚠ 待总控在 PR/latest CI run 完成后用 job log 补录；这不是本地动态验证失败，也不宣称 CI 已绿。

## 工作区完整性

变异只涉及两个测试文件，均从 `/tmp/sa7-issue132-*-pre-mutation.test.ts` 精确还原；最终 `git diff --` 两测试文件为空。预存的 `REPORT.md` 修改未被 SA7 触碰。

## Verdict

**pass**

SA4 已通过；全量 `pnpm test` 126/1485 绿；改动测试的根 runner 触发、AC-6 durable/recovery、共享 gate 访问纪律和 ADR 运行时投影均获得活链路证据。CI job-log 触发证据仍须在发布后由总控补录，SA7 不将其伪称为已验证 CI。
