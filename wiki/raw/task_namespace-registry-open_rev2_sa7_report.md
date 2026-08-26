# SA7 动态验证报告 — issue #110 rev2

**Worktree**: `/home/wangjian/nomicore-fix-issue-110`
**SA4 verdict gate**: pass（`task_namespace-registry-open_rev2_sa4_review.md:6`）
**Verdict**: pass

## 执行方式与边界

全部 Vitest/TypeScript 测试均从 worktree 根以独立后台进程执行：`setsid nohup bash -c '<command>; echo $? > /tmp/sa7-*.exit' ... &`；运行前执行了技能要求的 `fuser -k 8000/tcp 8081/tcp 3005/tcp 2>/dev/null || true`。没有执行 git commit/push/gh，也没有写 `.mabf-done`。

## 反馈 1：factory fatal 与异步清理闭环

### 修复态定向验证

命令：

```bash
pnpm exec vitest run packages/namespace-registry/test/registry-open.test.ts
```

结果：exit `0`。

```text
✓ packages/namespace-registry/test/registry-open.test.ts (32 tests) 35ms
Test Files  1 passed (1)
Tests  32 passed (32)
Type Errors  no errors
```

这是真实运行的完整 `registry-open` 文件，覆盖 SA6 never-settle 回归用例以及既有 factory-throw 的 L572/L610 语义锚。

### 红灯变异抽查（核心防御性证据）

临时、仅为验证目的将 `packages/namespace-registry/src/registry.ts` 的唯一调用点由：

```ts
void releaseHandleBestEffort(handle, identity);
```

变异为：

```ts
await releaseHandleBestEffort(handle, identity);
```

然后独立后台运行：

```bash
pnpm exec vitest run packages/namespace-registry/test/registry-open.test.ts -t "永不 settle"
```

**变红结果**：exit `1`，且是确定性的断言失败，不是 Vitest 超时：

```text
× ... factory throw 且 handle.release 永不 settle：open() 仍 reject 原 factory branded fatal（清理不阻塞交付） 9ms
→ handle.release() 永不 settle 时 open() 必须仍 settle并 reject runtime-construction fatal，不得永久挂起:
  expected 'pending' not to be 'pending' // Object.is equality

Test Files  1 failed (1)
Tests  1 failed | 31 skipped (32)
Duration  691ms ... tests 11ms
```

失败点为 `registry-open.test.ts:698` 的 settled 状态断言；11ms 测试执行时间证明确为预期的快速断言红灯，非 5s 框架 timeout。

### 还原与复绿

立即将该调用点还原为 `void releaseHandleBestEffort(handle, identity);`。以变异前/还原后的 `git diff -- packages/namespace-registry/src/registry.ts` 做字节级比较，得到：

```text
RESTORE_DIFF_MATCH=0
```

随后独立后台重跑同一 never-settle 用例：exit `0`。

```text
✓ packages/namespace-registry/test/registry-open.test.ts (32 tests | 31 skipped) 5ms
Test Files  1 passed (1)
Tests  1 passed | 31 skipped (32)
Type Errors  no errors
```

此外运行现有 release-reject 路径：

```bash
pnpm exec vitest run packages/namespace-registry/test/registry-open.test.ts -t "factory throw 且 handle.release reject"
```

结果 exit `0`：`1 passed | 31 skipped`。该运行路径实际验证 factory failure 与异步 cleanup rejection 观察者契约所对应的既有锚。

### 进程级 unhandled-rejection 观察

所有上述真实 Node/Vitest 子进程均以 exit `0`（修复态）结束；输出中不存在 `UnhandledPromiseRejection`、`unhandled rejection`、`uncaught` 或进程崩溃警告。never-settle 修复态用例还实际完成为 1 passed；因此浮动 cleanup Promise 没有阻断 factory fatal 交付，也未导致子进程异常终止。变异态的唯一非零退出是预期的测试断言失败（exit `1`）。

## 反馈 2：testing overrides 清理与聚合类型检查

独立后台命令：

```bash
./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit
```

结果：exit `0`，无输出（零 TypeScript 错误）。

在 `packages/` 的生产/测试 TypeScript 文件中实跑检索：

```bash
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --include='*.ts' --include='*.tsx' 'createDocumentFactory' packages
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --include='*.ts' --include='*.tsx' 'scheduler[[:space:]]*?[[:space:]]*:[[:space:]]*never' packages
```

结果：

```text
createDocumentFactory: packages/namespace-registry/src/testing.ts:10
  （仅说明性 docstring：明确该 seam 不在本切片预留）
scheduler?: never: 无匹配
```

即没有生产或测试代码对被删除 overrides 字段的可执行/类型引用残留。

## 反馈 3：wiki whitespace

命令：

```bash
git diff --check 1a7154e -- wiki/
```

结果：exit `0`，无输出。

## 整包回归

独立后台命令：

```bash
pnpm exec vitest run packages/namespace-registry
```

结果：exit `0`。

```text
✓ packages/namespace-registry/test/registry-surface.test.ts (9 tests) 9693ms
✓ packages/namespace-registry/test/registry-node-dispose.test.ts (2 tests) 19ms
✓ packages/namespace-registry/test/registry-entry-removal-guard.test.ts (7 tests) 13ms
✓ packages/namespace-registry/test/registry-open.test.ts (32 tests) 80ms

Test Files  4 passed (4)
Tests  50 passed (50)
Type Errors  no errors
Duration  14.24s
```

同时还原核验：`registry.ts` 中没有 `await releaseHandleBestEffort(handle, identity);`，唯一命中为第 300 行的 `void releaseHandleBestEffort(handle, identity);`；对该文件运行 `git diff --check` exit `0`。

## vitest 触发证据

本轮未进行 push/PR/CI 查询（SA7 硬约束禁止 `gh`，不宣称 CI 已绿），故以下为本 worktree 的实际 Vitest runner 触发证据，而非 CI run log。

| Workspace Package | 本地 runner 命令 | 实际触发文件与结果 | 输出摘录 |
|---|---|---|---|
| `@nomicore/namespace-registry` | `pnpm exec vitest run packages/namespace-registry` | `registry-surface.test.ts` (9)、`registry-node-dispose.test.ts` (2)、`registry-entry-removal-guard.test.ts` (7)、`registry-open.test.ts` (32)；共 50 passed | `Test Files  4 passed (4)` / `Tests  50 passed (50)` |
| `@nomicore/namespace-registry`（反馈 1 精确用例） | `pnpm exec vitest run packages/namespace-registry/test/registry-open.test.ts -t "永不 settle"` | never-settle 回归测试 1 passed，31 skipped | `Test Files  1 passed (1)` / `Tests  1 passed | 31 skipped (32)` |

**本地触发 verdict**: ✅ package tests genuinely triggered and passed。CI Node 20/24 runner log 的运行级证据不在本 SA 的允许操作范围内，不能据此声称 CI 已验证；SA4 已记录 workflow 静态覆盖关系，发布后应由总控/CI 观察阶段补充实际矩阵日志。

## 最终结论

SA4 已 pass；SA7 动态验证没有发现新的失败。反馈 1 的修复在实际 runner 中通过，且必需的 await 回归能被 never-settle 测试快速、精确地捕获为断言红灯，随后已立即还原并复绿；release reject 路径、类型检查、字段残留清理、wiki whitespace 与 namespace-registry 全包回归均通过。故 **Verdict**: pass。
