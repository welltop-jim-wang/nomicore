# SA6 红灯档案 — rev2 反馈 1：`handle.release()` 永不 settle 时 `open()` 仍须交付原 factory fatal

- **issue**: #110（welltop-jim-wang/nomicore）
- **worktree**: /home/wangjian/nomicore-fix-issue-110
- **round**: 2（修订轮，PR #119 评审反馈 1 为阻断项）
- **SA6 产出日期**: 2026-05（run_id issue-110-1787703160-3494569）
- **档案性质**: 确定性红灯回归测试 + 红灯证据（断言失败，非框架超时兜底）

## 1. 契约来源（评审反馈 1 原文摘要）

`packages/namespace-registry/src/registry.ts:292-303`：Runtime factory 抛错后先
`await releaseHandleBestEffort(handle, identity)`。若 `handle.release()` 永不 settle，
`open()` 永久挂起，调用方收不到本应交付的
`NamespaceRegistryFatalError(operation='open', phase='runtime-construction', committed=false)`。

要求（全部必须满足）：
1. `handle.release()` 仍恰调用一次；
2. release rejection 仍经 observer（`handle-release-failed`）上报且不能替换 factory cause；
3. 清理 Promise 不得阻塞 factory fatal 的交付；
4. 确定性回归测试：`release()` 永不 settle 时，`open()` 仍 reject 原 factory branded fatal。

## 2. 新用例

- **文件名**：`packages/namespace-registry/test/registry-open.test.ts`
- **位置**：`describe('open 分支与 fatal 分类（§6.4-§6.7）')` 内，紧邻既有两条 factory-throw
  锚之后（L572 释放成功路径 / L610 release reject 路径之后；现位于本 describe 第 4 条
  `it`，紧随 L610 用例，位于 `getStatus 恒 running` 用例之前）。
- **用例名**：
  `factory throw 且 handle.release 永不 settle：open() 仍 reject 原 factory branded fatal（清理不阻塞交付）`
- **新增测试设施**：`NeverSettleStubHandle extends StubHandle`（同名文件内新类，
  `override release()` 返回 `new Promise<void>(() => {})` —— 永不 resolve/reject 的
  Promise；`releaseCalls` 计数继承自 StubHandle）。既有 `StubHandle` /
  `StubPersistence` / `flushMicrotasks` / `deferred` 设施原样复用，未改动。

### 断言面（全部为可观察运行时行为）

1. **settle 判定（主红灯锚）**：`p.then(...)` 双通道捕获 settled 状态，随后
   `expect(settled).not.toBe('pending')` —— 当前实现以 `await handle.release()`
   阻塞，`open()` 永不 settle，此断言失败（红灯证据）。
2. **fatal 判定面**（修绿后逐项生效）：
   - `outcome instanceof NamespaceRegistryFatalError`；
   - `operation === 'open'`；`phase === 'runtime-construction'`；`committed === false`；
   - `cause` 为 factory 抛出的**原错误实例**（`toBe(factoryCause)`，未被 release 替换）；
   - 零回显契约：`message` 不含 `factory-boom-never-settle`（cause 文本）。
3. **副作用计数**：`handle.releaseCalls === 1`（release 仍恰调用一次）。
4. **observer**：收到 `open-runtime-construction-failed` 且 `cause` 为 exact factory cause。

## 3. 确定性手法说明

- **零 real sleep / 零定时器等待**：唯一等待为
  `awaited flushMicrotasks(20)`（20 轮显式 `await Promise.resolve()` 微任务展开，
  覆盖 accept→slot→load gate→factory→entry→cleanup 的嵌套层数上界）+ 一个
  `setImmediate` 宏任务让出（`await new Promise<void>((r) => setImmediate(r))`）。
  该组合保证：凡能经由纯 promise 链 settle 的 `open()` 必然已 settle；仍未 settle
  即判定「永久挂起」。
- **判定「未永久挂起」**：不是等待框架超时，而是先挂 settled 探针
  （`void p.then(resolve-sink, reject-sink)`），再排空微任务+宏任务后**断言
  settled 状态**——红灯是断言失败（`expected 'pending' not to be 'pending'`），
  测试在数十 ms 内失败退出，不依赖 vitest 默认 5s testTimeout。
- **无 unhandled rejection**：`p` 双通道探针已消费 reject 侧；`(operation)` 的
  carrier tail 有 green-tail 吞弃；`NeverSettleStubHandle.release()` 的 Promise
  永不 reject，不产生 unhandled rejection。
- **不锁定修复方案**：未断言 `handle-release-failed` 是否/何时到达（release 永不
  settle 即永不失败，反馈 2 的「rejection 上报」场景已由既有 L610 锚覆盖）；
  只锁定反馈 1 的行为面（fatal 交付、release 恰一次、cause 不替换、零回显）。

## 4. 红灯命令与证据（真实执行，2026-05 于本 worktree，Node v24.13.0）

命令（worktree 根，后台独立进程 `setsid nohup`，非 ACP 内同步阻塞）：

```bash
cd /home/wangjian/nomicore-fix-issue-110
# 定向红灯：
pnpm exec vitest run packages/namespace-registry/test/registry-open.test.ts -t "永不 settle"
# 全文件回归确认（既有 31 条 + 新增 1 条）：
pnpm exec vitest run packages/namespace-registry/test/registry-open.test.ts
```

### 结果 1：定向运行（1 failed | 31 skipped，exit 1，11ms）

```
 RUN  v3.2.7 /home/wangjian/nomicore-fix-issue-110
 ❯ packages/namespace-registry/test/registry-open.test.ts (32 tests | 1 failed | 31 skipped) 11ms
   × open 分支与 fatal 分类（§6.4-§6.7） > factory throw 且 handle.release 永不 settle：
     open() 仍 reject 原 factory branded fatal（清理不阻塞交付） 10ms
     → handle.release() 永不 settle 时 open() 必须仍 settle 并 reject runtime-construction
       fatal，不得永久挂起: expected 'pending' not to be 'pending' // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed | 31 skipped (32)
Type Errors  no errors
   Duration  662ms
```

### 结果 2：全文件运行（1 failed | 31 passed (32)，exit 1，42ms）

```
 ❯ packages/namespace-registry/test/registry-open.test.ts (32 tests | 1 failed) 42ms
   ✓ open 分支与 fatal 分类（§6.4-§6.7） > factory throw → handle.release 恰一次；
     release reject 与 observer throw 都不替换 runtime-construction fatal      [L572 锚 ✓]
   ✓ open 分支与 fatal 分类（§6.4-§6.7） > factory throw 且 handle.release reject：
     release 恰一次、handle-release-failed 上报 exact cause、主 fatal 仍为 factory cause  [L610 锚 ✓]
   × open 分支与 fatal 分类（§6.4-§6.7） > factory throw 且 handle.release 永不 settle：
     open() 仍 reject 原 factory branded fatal（清理不阻塞交付） 9ms
     → ...expected 'pending' not to be 'pending' // Object.is equality（registry-open.test.ts:698:11）
   ✓ 其余 30 条全部通过（identity/并发串行/carrier/lease/capability/P0/零回显/reentrancy）

 Test Files  1 failed (1)
      Tests  1 failed | 31 passed (32)
Type Errors  no errors
   Duration  695ms
```

**红灯证据性质**：断言失败 `expected 'pending' not to be 'pending'`（`Object.is`），
触发于 `registry-open.test.ts:698` 的 `expect(settled, ...).not.toBe('pending')`；
整个文件 42ms 内完成，非框架超时兜底（vitest testTimeout 默认 5000ms 未被触及）。

## 5. 既有锚零改动确认

- 本文件相对 HEAD 的 diff 为**纯新增**（+71 / 0 语义行删除；唯一 `-` 为 diff
  header `--- a/...`）。
- L572 / L610 两条 factory-throw 锚经全文件运行确认仍绿（见上「结果 2」），
  语义未被改动：未修改、未删除、未加 skip/条件分支。
- `StubHandle` / `StubPersistence` / `flushMicrotasks` 既有设施未经改动；
  新增的 `NeverSettleStubHandle` 与用例均为追加。

## 6. 改动范围核验

- 仅新增/追加：`packages/namespace-registry/test/registry-open.test.ts`（+71 行）。
- 未触碰 `src/`（registry.ts 仍为 round 1 阻塞实现，红灯保持红）。
- 未执行 `git commit` / `git push`；未改 GitHub label；未写 `.mabf-done`。
  （工作树中 `REPORT.md`、`wiki/raw/*` 若干文件为总控 round-2 预处理修改，非本 SA 产出。）
- 无新测试包/端口依赖 → 无需更新 `scripts/test-lock.sh`（该脚本在本 worktree 不存在）。

## 7. 报告摘要（供总控/SA3）

- 新用例：`factory throw 且 handle.release 永不 settle：open() 仍 reject 原 factory branded fatal（清理不阻塞交付）`
- 位置：`packages/namespace-registry/test/registry-open.test.ts`，
  `describe('open 分支与 fatal 分类（§6.4-§6.7）')`，紧随 L572/L610 锚之后。
- 红灯证据：`expected 'pending' not to be 'pending'`（`registry-open.test.ts:698` 断言失败，
  1 failed / 31 passed，42ms；定向 11ms / 1 failed / 31 skipped）。**断言失败，非超时。**
- 修绿门槛：`open()` 在 release 永不 settle 时仍 reject 原 factory branded fatal
  （NamespaceRegistryFatalError / open / runtime-construction / false / exact cause），
  release 恰一次，零回显，observer 收 exact cause。
