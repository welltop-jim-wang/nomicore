# SA3 实现档案 — rev2 反馈 1/2 修复与版本 bump（issue #110，round 2）

- **issue**: #110（welltop-jim-wang/nomicore）
- **worktree**: /home/wangjian/nomicore-fix-issue-110
- **round**: 2（修订轮，PR #119 评审反馈驱动）
- **SA3 产出日期**: 2026-05（run_id issue-110-1787703160-3494569）
- **输入**: `task_namespace-registry-open_rev2.md`（评审反馈全文与硬约束）、
  `task_namespace-registry-open_rev2_sa6_red.md`（红灯档案与修绿门槛）
- **性质**: SA6 红灯已就位（唯一红灯：never-settle 用例），SA3 只改 src + package.json，
  未触碰测试文件（registry-open.test.ts 的 +71 行为 SA6 产出，工作树中保持原样）。

## 1. 改动 diff 摘要（`git diff --stat`，仅列本轮 SA3 相关）

```
 packages/namespace-registry/package.json      |  2 +-      (0.1.0 → 0.1.1)
 packages/namespace-registry/src/registry.ts   |  7 +-      (fire-and-forget + 注释语义更新)
 packages/namespace-registry/src/testing.ts    |  8 +-      (删两个 never 字段 + 头 docstring 同步)
```

## 2. 反馈 1（阻断）：factory fatal 不被 handle 清理阻塞

**位置**：`packages/namespace-registry/src/registry.ts`（round 1 的 L292-303 区域）。

**处理方式**：catch 块内调用点由 `await releaseHandleBestEffort(handle, identity)` 改为
`void releaseHandleBestEffort(handle, identity)`（fire-and-forget），其余逻辑不变：

```ts
    } catch (e) {
      // 所有权仍归调用方：handle.release() 恰一次（resolve/reject 均不替换 factory cause）。
      // 清理不阻塞 fatal 交付（#110 R2）：fire-and-forget 同步发起 release、绝不 await；
      // 浮动 Promise 由 releaseHandleBestEffort 内部 try/catch 全包，永不 unhandled rejection。
      void releaseHandleBestEffort(handle, identity);
      dispatchObserver(observer, {
        type: 'open-runtime-construction-failed',
        identity,
        cause: e,
      });
      throw new NamespaceRegistryFatalError('open', 'runtime-construction', false, e);
    }
```

- **release 恰一次**：`releaseHandleBestEffort` 为 async 函数，调用即同步执行至
  `await handle.release()` 表达式求值处，`handle.release()` 同步发起（releaseCalls 同步 +1）。
- **rejection 上报不替换 cause**：函数内部 `try/catch` 全包，reject 时
  `dispatchObserver(observer, { type: 'handle-release-failed', identity, cause: e })`
  上报 exact cause；`dispatchObserver`（observer.ts）对 observer 自身 throw 也隔离，
  浮动 Promise 无法以任何路径 reject → 无 unhandled rejection。
- **不阻塞 fatal 交付**：`open()` 不再 await 清理，同步 dispatch
  `open-runtime-construction-failed`（exact factory cause）后立即 throw 原
  `NamespaceRegistryFatalError('open','runtime-construction',false,e)`。
- **零回显**：fatal message 模板未动（不包含 cause 文本）。
- **注释更新**：catch 块内注释新增「清理不阻塞 fatal 交付（#110 R2）」语义说明；
  `releaseHandleBestEffort` 的 docstring 追加「调用方必须 fire-and-forget（void、不 await）」
  契约，防止未来回归 reintroduce await。两处均沿用既有中文注释风格。
- **未改动**：`releaseHandleBestEffort` 函数体、dispatchObserver/observer 事件形、
  fatal message 模板、acceptance/load 分支。

## 3. 反馈 2（合并前清理）：删除不可用的 testing overrides

**位置**：`packages/namespace-registry/src/testing.ts`。

**处理方式**：

1. 删除 `NamespaceRegistryTestingOverrides` 中两个字段及各自注释行：
   - `/** 为 #111 预留，#110 不消费。 */ readonly createDocumentFactory?: never;`
   - `/** 为 idle/#112 预留，#110 不消费。 */ readonly scheduler?: never;`
2. 文件头 docstring 第 10-11 行改写为“不再预留”的表述：
   `#111/idle 的 createDocumentFactory/scheduler seam 不在本切片预留（rev2 合并前清理）：
   待真实实现引入具体类型与注入路径时再加入。`
3. 全仓 grep 确认：`createDocumentFactory` / `scheduler?: never` 仅剩 docstring 中的
   叙述性提及（描述“不预留”，非字段引用）；`registry-open.test.ts:286` 的 `scheduler`
   属 `createMemoryPersistence` 参数（persistence 包），与本 overrides 无关，不受影响。
4. `createNamespaceRegistryForTesting` 的 internal 转发逻辑本就只读三个实际字段，
   删除 `never` 字段后无需改动；无测试断言 overrides 键集 → 无引用残留。

## 4. 版本 bump

`packages/namespace-registry/package.json`：`"version": "0.1.0"` → `"0.1.1"`。

## 5. 验证输出摘录（全部后台独立进程 setsid nohup，未同步阻塞）

### 5.1 定向：`pnpm exec vitest run packages/namespace-registry`（EXIT_CODE=0）

```
 RUN  v3.2.7 /home/wangjian/nomicore-fix-issue-110
 ✓ packages/namespace-registry/test/registry-open.test.ts (32 tests) 199ms
 ✓ packages/namespace-registry/test/registry-surface.test.ts (9 tests) 7694ms
 ✓ packages/namespace-registry/test/registry-node-dispose.test.ts (2 tests) 8ms
 ✓ packages/namespace-registry/test/registry-entry-removal-guard.test.ts (7 tests) 7ms

 Test Files  4 passed (4)
      Tests  50 passed (50)
Type Errors  no errors
   Duration  13.91s
EXIT_CODE=0
```

- registry-open.test.ts 32 条全绿：含 SA6 新增
  `factory throw 且 handle.release 永不 settle：open() 仍 reject 原 factory branded fatal（清理不阻塞交付）`
  （红灯 → 修绿），以及既有 L572/L610 两条 factory-throw 锚（语义无回归）。

### 5.2 聚合：`./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit`（EXIT_CODE=0）

```
EXIT_CODE=0   （无输出 = 零错误）
```

### 5.3 全仓：`pnpm test`（vitest run --typecheck）（EXIT_CODE=0）

```
 Test Files  106 passed (106)
      Tests  1274 passed (1274)
Type Errors  no errors
   Duration  112.13s (… typecheck 6.55s)
EXIT_CODE=0
```

### 5.4 附加

- `git diff --check -- packages/namespace-registry`：clean（无 trailing whitespace）。
- 测试零 real sleep：never-settle 用例按 SA6 手法（排空微任务 + setImmediate 后断言
  settled 状态），全程无定时器等待；红灯证据为断言失败而非框架超时。

## 6. 硬约束合规

- 改动范围仅 `packages/namespace-registry/**`（src/testing.ts、src/registry.ts、
  package.json）；未触碰其他包；测试文件为 SA6 既有产出，SA3 未修改。
- 未执行 git commit / git push / gh pr / git worktree；未写 .mabf-done；
  未改 GitHub label。
- 无 env-override / fallback 软兌底；生产代码仅一条控制路径（fail-loud throw fatal）。
- 未改既有用例语义；既有 L572/L610 锚保持绿色。

## 7. 结论

SA6 红灯档案的修绿门槛全部满足：`open()` 在 `handle.release()` 永不 settle 时仍
reject 原 factory branded fatal（NamespaceRegistryFatalError / open /
runtime-construction / false / exact cause），release 恰一次、零回显、observer 收
exact cause；反馈 2 字段清理与版本 bump 完成；定向/聚合/全仓三验证全绿。
