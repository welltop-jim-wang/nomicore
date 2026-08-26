# Round 2 修订简报 — issue #110 namespace-registry open（PR #119 评审反馈）

- **issue**: #110（welltop-jim-wang/nomicore）
- **worktree**: /home/wangjian/nomicore-fix-issue-110
- **branch**: fix/issue-110-on-docs-namespace-registry（round 1 两 commit 已落：0895168 + fb62b86，基线 1a7154e）
- **run_id**: issue-110-1787703160-3494569
- **round**: 2（发布后修订轮；PR #119 CI 全绿，owner 要求合并前修复）
- **任务类型自判**：带精确规格的缺陷修订（feedback-driven revision）。路由：SA6 红灯锚定 → SA3 实现 → SA4 静态评审 → SA7 动态验证。SA5 复现省略（评审已给出精确根因与位置）；SA1/SA2 设计轮省略（评审反馈本身即行为规格，round 1 设计文档已冻结该区域语义）。工作流裁剪依据已记录于 dispatch log。

## 评审反馈逐条（逐条处理；1 为阻断，2/3 为合并前清理）

### 反馈 1（阻断）：factory fatal 不应被 handle 清理无限阻塞

位置：`packages/namespace-registry/src/registry.ts:292-303`

当前 Runtime factory 抛错后会先执行 `await releaseHandleBestEffort(handle, identity)`。若 `handle.release()` 永不 settle，`open()` 将永久挂起，调用方无法收到原本应交付的 `NamespaceRegistryFatalError(operation='open', phase='runtime-construction', committed=false)`。

要求（全部必须满足）：
1. `handle.release()` 仍恰调用一次；
2. release rejection 仍经 observer（`handle-release-failed`）上报且不能替换 factory cause；
3. 清理 Promise 不得阻塞 factory fatal 的交付；
4. 增加确定性回归测试：当 `release()` 永不 settle 时，`open()` 仍能 reject 原 factory branded fatal。

现状代码（round 1）：

```ts
} catch (e) {
  // 所有权仍归调用方：handle.release() 恰一次（resolve/reject 均不替换 factory cause）。
  await releaseHandleBestEffort(handle, identity);
  dispatchObserver(observer, {
    type: 'open-runtime-construction-failed',
    identity,
    cause: e,
  });
  throw new NamespaceRegistryFatalError('open', 'runtime-construction', false, e);
}
```

`releaseHandleBestEffort`（registry.ts:228-237）内部 try/catch 全包，永不 reject，fire-and-forget 不产生 unhandled rejection。既有测试锚（registry-open.test.ts）：
- L572「factory throw → handle.release 恰一次；release reject 与 observer throw 都不替换 runtime-construction fatal」（release 成功路径，observer 自身 throw 隔离）；
- L610「factory throw 且 handle.release reject：release 恰一次、handle-release-failed 上报 exact cause、主 fatal 仍为 factory cause」。
这两条必须保持绿色（语义无回归）；新增回归测试针对「release 永不 settle」场景。

### 反馈 2（合并前清理）：删除不可用的 testing overrides

位置：`packages/namespace-registry/src/testing.ts:25-28`

```ts
createDocumentFactory?: never;
scheduler?: never;
```

这两个字段无法实际替换依赖，却提前进入公开 testing 类型。请在当前切片删除（等 #111/#112 或 idle lifecycle 真正实现可用 seam 时再加入具体类型与注入路径）。删除后检查引用处并同步清理（含文件头 docstring 第 10-11 行的相关表述）。

已知引用面（总控预查）：`createDocumentFactory`/`scheduler` 字段名仅出现于 testing.ts 自身；registry-open.test.ts:273 的 `scheduler` 属于 `createMemoryPersistence`（persistence 包）参数，与本 overrides 无关；无测试断言 overrides 键集。

### 反馈 3（合并前清理）：修复 `git diff --check`

以下新增文档存在 trailing whitespace（总控已清理工作树，随本轮 commit 落盘，SA 无需处理）：
- wiki/raw/task_namespace-registry-open_design_conflict_report.md
- wiki/raw/task_namespace-registry-open_sa4_review.md
- wiki/raw/task_namespace-registry-open_sa5_verify.md

### 非阻断后续建议（仅记录在报告，本轮不实现）

- `packages/namespace-registry/test/helpers/registry-seam-audit.ts` 是 namespace-runtime helper 的逐字副本，建议后续抽成共享测试工具，避免两份门禁实现漂移。
- closing / closePromise / lifecycleTail 当前属于不可达预留结构，可在 close/shutdown 落地时再收敛。

## 硬约束（所有 SA 必须遵守）

1. 改动范围仅限 `packages/namespace-registry/**`（src/test）与 wiki/raw/ 档案；禁止动其他包。
2. **禁止** `git push`、`gh pr`、改 GitHub label、写 `.mabf-done`、执行 `git worktree` 命令。
3. **SA 一律不做 git commit**——统一由总控收口时 commit（保持仓库提交惯例：中文摘要 + 引用 #110）。
4. 测试必须确定性：禁止真实 sleep/定时器等待；永不 settle 场景用「排空微任务 + setImmediate 宏任务后断言 settled 状态」类手法，红灯证据必须是断言失败而非框架超时。
5. 测试运行走后台独立进程（setsid nohup），禁止同步阻塞。
6. 保持零回显契约：fatal message 不得回显 cause 文本（registry-open.test.ts:602 已有负锁）。
7. SA3 需 bump `packages/namespace-registry/package.json` patch 版本（0.1.0 → 0.1.1）。
