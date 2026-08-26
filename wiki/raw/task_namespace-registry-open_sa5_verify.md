# Issue #110 — namespace-registry `open` 独立全量验证（SA5）

**Date**: 2026-08-26
**Worktree**: `/home/wangjian/nomicore-fix-issue-110`
**Branch**: `fix/issue-110-on-docs-namespace-registry`
**Node**: `v24.13.0`
**Verdict**: **ALL-GREEN**

> 本报告仅以本次 SA5 在上述 worktree 亲自执行的命令输出为依据。未修改任何生产、测试或配置文件；红灯抽查只短暂修改了 `lease.ts`，随后由备份逐字节还原，并以 Git diff 再确认。

## 1. 工作树范围与禁止文件检查

### 1.1 命令

```bash
git status --short
git diff --stat HEAD
git diff --name-only HEAD -- REPORT.md .mabf-done
```

### 1.2 退出码

- `git status --short` / `git diff --stat HEAD`: **0**
- 禁止路径的 `git diff --name-only`: **0**，且无输出

### 1.3 关键输出原文

```text
 M package.json
 M packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts
 M pnpm-lock.yaml
?? packages/namespace-registry/
?? wiki/raw/task_namespace-registry-open_design.md
?? wiki/raw/task_namespace-registry-open_design_conflict_report.md
?? wiki/raw/task_namespace-registry-open_dispatch.md
?? wiki/raw/task_namespace-registry-open_sa4_review.md

 package.json                                       |  2 +-
 .../runtime-registry-internal-seam-rev1.test.ts    | 11 +++++++++
 pnpm-lock.yaml                                     | 28 ++++++++++++++++++++++
 3 files changed, 40 insertions(+), 1 deletion(-)

--- FORBIDDEN TRACKED DIFF ---
```

### 1.4 判定

**PASS**。改动面为预期的根 `package.json`、`packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts`、`pnpm-lock.yaml`、新建 `packages/namespace-registry/` 与任务 wiki 档案；`REPORT.md` 和 `.mabf-done` 没有 Git diff。注意：未跟踪目录不进入 `git diff --stat HEAD`，但已通过 `git status --short` 显示并人工归类为预期的新包与任务档案。

额外执行 `git diff --check`，退出码 **0**、无输出，未发现 whitespace error。

## 2. 全量 TypeScript typecheck（后台）

### 2.1 命令

按长命令纪律后台启动：

```bash
setsid nohup bash -c 'pnpm typecheck; echo $? > .mabf-bg/exit-sa5-typecheck' \
  > .mabf-bg/log-sa5-typecheck 2>&1 < /dev/null & disown
```

随后读取 `.mabf-bg/exit-sa5-typecheck` 和日志尾部。

### 2.2 退出码

**0**

### 2.3 关键输出原文

```text
> nomicore@0.1.0 typecheck /home/wangjian/nomicore-fix-issue-110
> tsc -p packages/vfsl/tsconfig.json && tsc -p packages/vfsl-protocol/tsconfig.json && tsc -p packages/vfsl-codegen/tsconfig.json && tsc -p packages/persistence/tsconfig.json && tsc -p packages/dsh-persistence/tsconfig.json && tsc -p packages/doc-runtime/tsconfig.json && tsc -p packages/namespace-runtime/tsconfig.json && tsc -p packages/clock/tsconfig.json && tsc -p packages/namespace-registry/tsconfig.json
```

### 2.4 判定

**PASS**。根 typecheck 链实际包含并成功执行 `packages/namespace-registry/tsconfig.json`。

## 3. 聚合 TypeScript typecheck

### 3.1 命令

```bash
./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit
```

### 3.2 退出码

**0**

### 3.3 关键输出原文

```text
(no output)
```

### 3.4 判定

**PASS**。聚合 no-emit 类型检查无诊断。

## 4. 全量测试（后台）

### 4.1 命令

按长命令纪律后台启动：

```bash
setsid nohup bash -c 'pnpm test; echo $? > .mabf-bg/exit-sa5-test' \
  > .mabf-bg/log-sa5-test 2>&1 < /dev/null & disown
```

随后轮询 exit 文件并读取日志尾部。

### 4.2 退出码

**0**

### 4.3 关键输出原文（完成尾部）

```text
 ✓ packages/namespace-registry/test/registry-open.test.ts (31 tests) 34ms
 ✓ packages/namespace-registry/test/registry-node-dispose.test.ts (2 tests) 6ms
 ✓ packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts (4 tests) 4ms
 ✓ packages/doc-runtime/test/public-surface-guard.test.ts (3 tests) 2ms
 ✓ packages/vfsl-protocol/test/vfsl-protocol-empty-module.test.ts (1 test) 2ms

 Test Files  105 passed (105)
      Tests  1266 passed (1266)
Type Errors  no errors
   Start at  09:21:23
   Duration  122.29s (transform 1.58s, setup 0ms, collect 8.47s, tests 99.58s, environment 15ms, prepare 4.87s, typecheck 5.06s)
```

### 4.4 判定

**PASS**。`pnpm test`（实际为 `vitest run --typecheck`）收集并通过 105 个测试文件、1266 个用例，且 Type Errors 为 `no errors`。

## 5. 定向 namespace-registry 测试

### 5.1 命令

```bash
npx vitest run packages/namespace-registry
```

### 5.2 退出码

**0**

### 5.3 关键输出原文

```text
 ✓ packages/namespace-registry/test/registry-surface.test.ts (9 tests) 8875ms
 ✓ packages/namespace-registry/test/registry-open.test.ts (31 tests) 107ms
 ✓ packages/namespace-registry/test/registry-node-dispose.test.ts (2 tests) 24ms

 Test Files  3 passed (3)
      Tests  42 passed (42)
Type Errors  no errors
   Duration  12.17s
```

### 5.4 判定

**PASS**。新包的 42 个定向用例全部绿；包含两个 Node async disposal 用例。

## 6. 定向 namespace-runtime 测试

### 6.1 命令

```bash
npx vitest run packages/namespace-runtime
```

### 6.2 退出码

**0**

### 6.3 关键输出原文

```text
 ✓ packages/namespace-runtime/test/runtime-registry-internal-seam-rev1.test.ts (20 tests) 1032ms
 ✓ packages/namespace-runtime/test/runtime-acceptance-fullchain.test.ts (8 tests) 446ms
 ...
 ✓ packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts (4 tests) 4ms

 Test Files  26 passed (26)
      Tests  150 passed (150)
Type Errors  no errors
   Duration  21.20s
```

### 6.4 判定

**PASS**。实际结果为 **150**（不少于验证清单所述“20+”）个 namespace-runtime 定向用例全绿，其中包含 issue #110 改动的 `runtime-registry-internal-seam-rev1.test.ts` 20 个用例。

## 7. 红灯有效性抽查（可逆变异）

### 7.1 变异和还原方法

目标文件：`packages/namespace-registry/src/lease.ts`，其正常逻辑为：

```ts
read(path) {
  if (released) return RELEASED_ISSUE;
  return entry.runtime.read(path);
}
```

先备份到 `.mabf-bg/lease.ts.sa5-redcheck.bak`，临时删除 released guard，使 `read()` 在 release 后错误地继续委托 runtime；再运行定向用例。无论测试结果如何，立即将备份复制回目标文件。

### 7.2 命令

```bash
cp packages/namespace-registry/src/lease.ts .mabf-bg/lease.ts.sa5-redcheck.bak
# 临时将 read() 改为仅：return entry.runtime.read(path)
npx vitest run packages/namespace-registry/test/registry-open.test.ts \
  > .mabf-bg/log-sa5-redcheck 2>&1
# 立即：cp .mabf-bg/lease.ts.sa5-redcheck.bak packages/namespace-registry/src/lease.ts
git diff --quiet -- packages/namespace-registry/src/lease.ts
```

### 7.3 退出码

- 变异后的 `npx vitest ...registry-open.test.ts`: **1**（预期红灯）
- 还原后的 `git diff --quiet -- packages/namespace-registry/src/lease.ts`: **0**

### 7.4 关键输出原文

```text
❯ packages/namespace-registry/test/registry-open.test.ts (31 tests | 1 failed) 89ms
...
× lease 语义（§7 逐方法表格） > released 逐方法通道：read 同步 issue；三 getter 同步 throw 公开 NamespaceLeaseReleasedError；两写 resolve issue；status 唯一成功
  → expected { ok: true, value: undefined } to deeply equal { ok: false, …(2) }

 FAIL  packages/namespace-registry/test/registry-open.test.ts > lease 语义（§7 逐方法表格） > released 逐方法通道：read 同步 issue；三 getter 同步 throw 公开 NamespaceLeaseReleasedError；两写 resolve issue；status 唯一成功
AssertionError: expected { ok: true, value: undefined } to deeply equal { ok: false, …(2) }

- Expected
+ Received

  {
-   "code": "NAMESPACE_LEASE_RELEASED",
-   "message": "NAMESPACE_LEASE_RELEASED: 此 NamespaceLease 已 release，不能再接纳业务操作",
-   "ok": false,
+   "ok": true,
+   "value": undefined,
  }

 ❯ packages/namespace-registry/test/registry-open.test.ts:881:24
...
 Test Files  1 failed (1)
      Tests  1 failed | 30 passed (31)
Type Errors  no errors
```

还原确认：

```text
lease_restore_diff_exit=0
```

### 7.5 判定

**PASS**。关键 release gate 被破坏后，目标行为测试确定性转红，且准确指向 release 后 `read()` 应返回 `NAMESPACE_LEASE_RELEASED` issue 的断言；随后已还原，无该源码文件的残留 diff。

## 8. Node 版本及 asyncDispose 实测状态

### 8.1 命令

```bash
node --version
npx vitest run packages/namespace-registry
```

### 8.2 退出码

- `node --version`: **0**
- 定向 Vitest: **0**

### 8.3 关键输出原文

```text
v24.13.0

✓ packages/namespace-registry/test/registry-node-dispose.test.ts (2 tests) 24ms
Test Files  3 passed (3)
     Tests  42 passed (42)
```

### 8.4 判定

**PASS（当前 Node 24）**。当前环境是 Node **24.13.0**；`registry-node-dispose.test.ts` 的两个 `asyncDispose` 用例实际执行且通过，输出没有 skip。此 SA5 worktree/runtime 中没有 Node 20 运行环境，因此不能把本次执行证据外推为 Node 20 的实际运行结果；但全量与定向输出均确认当前 Node 24 的用例未跳过。

## 9. 清理复核

### 9.1 命令

```bash
git status --short
git diff --stat HEAD
git diff --quiet -- packages/namespace-registry/src/lease.ts
```

### 9.2 退出码

均为 **0**（`git status` 的“存在改动”是命令输出，不是失败状态）。

### 9.3 判定

**PASS**。红灯变异的 `lease.ts` 已恢复。工作树保持验证开始时的预期实现改动集合；没有额外生产、测试或配置文件残留。SA5 所写文件仅本报告，诊断/测试日志和备份仅位于许可的 `.mabf-bg/`。

## 总结论

**ALL-GREEN**。

独立执行的根 typecheck、聚合 typecheck、全量 `pnpm test`、namespace-registry 定向 42 tests、namespace-runtime 定向 150 tests均成功。关键 release-after-read 行为的可逆变异使一个精确的契约断言转红，证明该测试并非空绿；还原后 Git 检查确认目标源码无残留修改。当前 Node 24.13.0 下 asyncDispose 两个测试实际执行通过、未跳过。
