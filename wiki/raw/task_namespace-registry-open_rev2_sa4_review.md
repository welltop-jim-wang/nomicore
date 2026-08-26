# SA4 静态验尸报告 — issue #110 rev2

**Date**: 2026-05-24
**Worktree**: `/home/wangjian/nomicore-fix-issue-110`
**Scope audited**: 未提交 `git diff HEAD`，以及 frozen design / rev2 brief / SA6 red / SA3 implementation record。
**Verdict**: pass

## 审核结论

1. **设计一致性与范围**：✅ 一致。
   - rev2 brief 是本轮精确行为规格；round-1 frozen design 的 `§13 File Scope` 已允许 `packages/namespace-registry/package.json`、`src/registry.ts`、`src/testing.ts` 与 `test/registry-open.test.ts`。本轮生产变更仅落在这些允许路径。
   - `git diff --check HEAD` 无输出；blacklist（`package-lock.json`、`yarn.lock`、`.DS_Store`、`TASK.md`、根 `.bak`）无命中。
   - `REPORT.md`、dispatch 与旧 SA 档案变更属于总控/流水线档案；三个指定 round-1 wiki 文档仅为 trailing-whitespace 清理。没有生产范围越界。未发现需要 SA1 redesign 的结构性偏离。

2. **fire-and-forget 语义**：✅ 正确，且不产生浮动 Promise unhandled-rejection 路径。
   - `packages/namespace-registry/src/registry.ts:293-306` 在 factory 同步 throw 后调用 `void releaseHandleBestEffort(handle, identity)`，随后同步分发 `open-runtime-construction-failed` 并抛出原 factory cause 的 `NamespaceRegistryFatalError('open', 'runtime-construction', false, e)`；清理不再位于 fatal 的 await 链上。
   - `releaseHandleBestEffort`（同文件 `:227-238`）只有一个调用点；其 `try { await handle.release(); } catch (e) { dispatchObserver(...handle-release-failed..., cause:e); }` 覆盖 `release()` 同步 throw 和 Promise rejection。该 async 函数所有路径 resolve `undefined`，因此 `void` 浮动的返回 Promise 不会 reject。
   - 调用 async 函数时会同步执行至首个 `await handle.release()` 的求值，故 `handle.release()` 在 factory catch 同一调用栈内启动；测试中的 `releaseCalls` 精确锚定为 1。没有第二个 factory-error cleanup caller。
   - `dispatchObserver`（`src/observer.ts:38-49`）自身以 try/catch 隔离 observer throw。release reject 仍按原样作为 `handle-release-failed.cause` 上报，factory fatal 的 `cause` 仍为 exact factory error；`src/errors.ts:25-37` 的 fatal message 仅含 operation/phase/committed，未拼接 cause 文本。
   - 生产 `packages/*/src` 未发现 `process.on('unhandledRejection'|'uncaughtException')` exit handler；没有额外的未处理 rejection 崩溃链。

3. **既有时序锚与新回归用例质量**：✅ 稳定且行为驱动。
   - 既有 release-reject 用例（`registry-open.test.ts:623-657`）先 `await p.catch(() => {})` 再读取异步 observer 事件，因而对 fire-and-forget 后 release rejection 的微任务到达顺序有明确同步点；factory-fatal 用例（`:585-621`）只依赖 release 同步发起的计数和同步 observer 事件。因此没有把旧的「release observer 必须先于 open reject」排序假设隐式保留下来。
   - 新用例（`:659-714`）以 `NeverSettleStubHandle.release()` 返回永不 settle 的 Promise，先安装 `p.then` 双通道 settled 探针，再执行 `flushMicrotasks(20)` 与一个 `setImmediate`。本链路仅含 Promise 微任务：`open → carrier.tail.then → runOpenSlot → await loadDoc → factory catch → throw fatal → operation rejection → probe`；不依赖 timer/I/O。20 个显式微任务轮次加一个 macrotask 已充分跨越这一有限链，且旧 await 实现稳定保持 pending，因此失败面是即时断言而非 Vitest timeout。
   - 用例断言 reject（而非仅 settled）、fatal brand 的 operation/phase/committed、exact factory cause、零回显、release 恰一次和 exact factory observer cause；没有以源码字符串 grep 替代行为验证。扫描新增测试没有 `readFileSync` + 文本断言反模式。

4. **testing API 清理与版本**：✅ 完成。
   - `src/testing.ts:20-25` 的 public `NamespaceRegistryTestingOverrides` 只剩实际可注入的 `runtimeFactory`、`observer`、`diagnostics`；转发实现 `:32-46` 也只消费这三项。
   - 全仓检索 `createDocumentFactory` 与 `scheduler?: never`：仅命中冻结设计、rev2 简报/实现档案和当前 docstring 的历史/说明性文本；没有公开类型、类型断言或测试仍试图使用已删除字段。`registry-open.test.ts` 内 persistence scheduler 使用不属于此 overrides surface。
   - `packages/namespace-registry/package.json:3` 已从 `0.1.0` bump 到 `0.1.1`。

5. **Vitest 触发性（1.4）**：✅ 接通。
   - 改动测试为 `packages/namespace-registry/test/registry-open.test.ts`，所属 workspace package 为 `@nomicore/namespace-registry`。
   - 根 `vitest.config.ts:5` include `packages/*/test/**/*.test.ts`，匹配该文件；根 `package.json:11` 的 `pnpm test` 是 `vitest run --typecheck`；`.github/workflows/ci.yml:38-39` 的 PR `test` job 运行 `pnpm test`。故新增用例由 PR CI 收集和执行（Node 20、24 matrix）。

6. **读写路径、静默失败、降级、极端条件、错误处理**：✅ 无新增问题。
   - 此修订不改持久化读写路径、Runtime ownership、entry publishing 或 lease 数据流；fire-and-forget 只调整 factory failure 的 cleanup wait semantics。
   - factory failure 继续有可观察的 branded rejection 与 synchronous observer 事件；release failure 有 observer exact-cause 事件，release 永不 settle 不再吞没 factory fatal。不存在无请求、无状态、无错误交付的新增静默路径。
   - 未引入 fallback、timer、额外抽象、跨模块调用或新的 throw/return 契约给现有 caller；`releaseHandleBestEffort` 仍内部吞清理失败，公共 `open` 的 factory failure brand 未改变。

7. **架构与复杂度**：✅ 精简。变更为一个 await→void 的精准纠正、对应契约文档、一个行为型永不 settle regression、无用 public `never` 字段移除及 patch bump；未引入新层或规避原有架构。

## 验证证据

| 命令 | 结果 |
|---|---|
| `git -C /home/wangjian/nomicore-fix-issue-110 diff --check HEAD` | exit 0，无输出 |
| `git -C /home/wangjian/nomicore-fix-issue-110 diff --name-only HEAD` + blacklist regex | 无 blacklist 命中 |
| `pnpm exec vitest run packages/namespace-registry/test/registry-open.test.ts`（按独立 `setsid nohup` 进程运行） | exit 0；`1 passed`，`32 passed`，Type Errors `no errors`，35ms tests |
| 全仓文本检索 `createDocumentFactory`、`scheduler?: never` | 无 production/testing override 残留；仅设计/brief/archive 与说明性 docstring 命中 |
| 根 `vitest.config.ts`、`package.json`、`.github/workflows/ci.yml` 静态核对 | include 覆盖 package test；`pnpm test` 为 `vitest run --typecheck`；PR CI 调用 `pnpm test` |

## 动态审核重点（交 SA7）

1. 在真实 Node 20 与 Node 24 CI runner 上确认新增 never-settle case 被根 `pnpm test` 收集（应为 `registry-open.test.ts` 的 32 条之一），并确认 CI log 不出现 unhandled-rejection warning。
2. 运行 factory throw + asynchronously rejected `handle.release()` 的路径，确认 `open-runtime-construction-failed` 与稍后 `handle-release-failed` 都可被 observer 接收、两个 event 的 cause identity 分别保持 factory/release 原对象，且 `open()` 不等待后者。
3. 运行 `handle.release()` 永不 settle 的场景，确认 `open()` 的 runtime-construction fatal 可交付而进程结束不被悬挂 cleanup 阻止。
