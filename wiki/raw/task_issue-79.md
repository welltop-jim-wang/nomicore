# MABF Task: Persistence：DocHandle entry status 与 degraded 期间 dirty registration

## Issue #79

## Parent

PR [#70](https://github.com/welltop-jim-wang/nomicore/pull/70)（docs/doc-runtime-validation）

## Task Type

feature

## What to build

为 NamespaceRuntime 的写前 writable gate 补齐具体 DocHandle/entry 级状态查询，并收窄 `saveDoc` 的职责：Runtime 在业务 mutation 前读取 handle 当前状态，已处于 `persistence-degraded` 时拒绝开始新写入；一旦 mutation 已通过检查并进入 live Y.Doc，`saveDoc` 只负责登记 dirty，不得因状态在检查后转为 degraded 而拒绝该 mutation，最新完整 Y.Doc 必须由现有 retry 最终持久化。

`getStatus()` 只表示调用瞬间状态，不承诺后续 flush 成功。检查后发生持久化失败属于正常 degraded/retry 路径：已提交内存事务保留，后续业务写入被 gate 拒绝，retry 成功后恢复 ready。

## Acceptance criteria

- [ ] `DocHandle` 提供同步、entry 级 `getStatus()`；至少可区分 `ready`、`persistence-degraded`、`released`、`disposed`
- [ ] 状态查询必须对应该 handle 的具体 `(owner, docId)` entry，不能以 Adapter 聚合状态代替
- [ ] entry flush 失败后，相关 handle 返回 `persistence-degraded`；无关 namespace handle 仍返回 `ready`
- [ ] 该 entry 自身 retry 成功后，相关 handle 恢复 `ready`
- [ ] `saveDoc(handle)` 不再因 entry 已 degraded 而拒绝；必须递增 dirty generation，并保持/确保 retry 覆盖最新完整 live Y.Doc
- [ ] foreign、released、entry 身份失配和 Persistence disposed 等非 degraded 错误继续响亮拒绝
- [ ] 确定性竞态测试覆盖：generation 1 flush 已开始 → 写前观察 ready → mutation 2 进入 live Y.Doc → generation 1 flush 失败 → mutation 2 的 `saveDoc` 在 degraded 状态成功登记 → retry 成功 → 新 Persistence 实例 load 可见 mutation 2
- [ ] ADR 0006 补充职责：Runtime 负责 mutation 前 gate；`saveDoc` 是 mutation 后 dirty notification；写前状态检查不是持久化成功保证
- [ ] MemoryPersistence 与 FilePersistence contract tests、全量 test/typecheck、Node 20/24 CI 通过

## Phase 1 — 红灯验收测试（SA6，2026-08-22）

### 测试设计（AC → 测试锚点映射）

新增测试文件（均在 `packages/persistence/test/`，只测行为、不碰生产代码）：

- `issue-79-entry-status.test.ts`（MemoryPersistence，fake timer + 可控 I/O hook，全确定性）
- `issue-79-file-entry-status.test.ts`（FilePersistence，ManualTimer + chmod EACCES 降级 + 真实文件系统）

未来 API 通过本地 cast 调用（`(handle as unknown as { getStatus(): 'ready'|'persistence-degraded'|'released'|'disposed' }).getStatus()`），使套件在当前 seam 上可编译可运行；断言全部锚定运行时行为。

| AC | 测试锚点 |
|----|---------|
| AC1 | `getStatus()` 同步区分 `ready`/`persistence-degraded`/`released`/`disposed`（Memory + File 两 adapter 各一条） |
| AC2 | 同 adapter 上 alice/doomed 降级时 alice/fine 仍 `ready`，并对照 Adapter 聚合 `getStatus()==='persistence-degraded'` |
| AC3 | flush 失败 → 相关 handle `persistence-degraded`；无关 handle `ready` |
| AC4 | 仅该 entry 自身 retry 成功恢复 `ready`；同窗口内无关 flush 成功不恢复 |
| AC5 | degraded 期间 `saveDoc(handle)` resolve（登记 dirty）；retry 落盘含最新 mutation；新 Persistence 实例 load 可见 |
| AC6 | foreign / released / 伪造身份对象 / disposed 的 saveDoc 继续响亮拒绝（回归护栏） |
| AC7 | 确定性竞态（见下），MemoryPersistence + createDocStore + fake timer 全手动推进 |

### AC7 确定性竞态序列（全部手动控制，无真实时钟）

1. seed `race-doc`，`ROOT.generation=1`，`saveDoc` → dirty gen 1
2. `timer.advanceBy(debounce)` → gen-1 flush 开始，`writeSnapshot` 在 store gate 上停住（`writes===1`）
3. **写前观察**：flush 在途但未失败 → `handle.getStatus()==='ready'`（AC1 语义：只反映调用瞬间）
4. mutation 2：`ROOT.generation=2` 进入 live Y.Doc
5. 释放 gate 并让其 reject → gen-1 flush 失败 → entry 降级 → `getStatus()==='persistence-degraded'`
6. **degraded 状态下 `saveDoc(handle)` 必须 resolve**（当前实现此处 reject → 红灯核心点）
7. `timer.advanceBy(retryDelay)` → retry flush 以完整 live Y.Doc 落盘（`writes===2`）→ 恢复 `ready`
8. 新 `createMemoryPersistence` 实例（共享 store hooks）`loadDoc` → `ROOT.generation===2`

### 预期红灯（当前实现缺口）

- `DocHandle` 无 `getStatus()` → 调用抛 `TypeError: handle.getStatus is not a function`（AC1–AC4、AC7 步骤 3/5/7 全部命中）
- `PersistenceLifecycle.saveDoc` 在 `entry.degraded` 时抛 `persistence-degraded: writes are rejected until retry succeeds`（AC5/AC7 步骤 6 命中）
- AC6 护栏断言当前即绿（防回归锚），整条用例因上述红灯断言整体变红

### 红灯运行证据

命令（worktree 根，2026-08-22）：

```bash
npx vitest run packages/persistence/test/issue-79-entry-status.test.ts \
              packages/persistence/test/issue-79-file-entry-status.test.ts
# Test Files  2 failed (2)   Tests  8 failed (8)   Type Errors  no errors
```

全量 persistence 套件：`npx vitest run packages/persistence` → `2 failed | 7 passed (9)`、`8 failed | 65 passed (73)`——**仅新增 2 个文件 8 条用例红灯，65 条既有用例全绿**。`npx tsc -p packages/persistence/tsconfig.json` 通过（Type Errors: no errors）。

两种独立红灯原因（均锚定运行时行为，非 grep）：

1. **缺 `getStatus()`**（AC1–AC4/AC7）：`TypeError: handle.getStatus is not a function`（`statusOf` 调用点）——命中 6 条用例：AC1（Memory/File）、AC2+AC3、AC4、AC7 竞态、AC6 的 released/disposed 状态断言。
2. **degraded 拒绝 saveDoc**（AC5/AC7 核心）：`AssertionError: promise rejected "Error: persistence-degraded: writes are rejected until retry succeeds" instead of resolving`，堆栈直指 `PersistenceLifecycle.saveDoc`（`src/lifecycle.ts:200`，Memory 与 File 两条用例均命中）——当前实现违反 AC5「saveDoc 只登记 dirty，不得因检查后转 degraded 而拒绝」。

完整日志：`/tmp/sa6-issue79-red.log`。

### ⚠️ SA3 提示：旧测试将随契约收窄转红

- `packages/persistence/test/memory-persistence.test.ts` L307/L350：`saveDoc(...).rejects.toThrow(/persistence-degraded/)` —— AC5 收窄后必须改为 resolve
- `packages/persistence/test/file-persistence-sa7-dynamic.test.ts` L188：同上
- 上述测试断言的是"degraded 拒绝 saveDoc"旧契约，与新 AC5 冲突，SA3 实现后需同步更新

## Blocked by

Blocked by: None - can start immediately

## Working Directory

/home/wangjian/nomicore-fix-issue-79

## Branch

fix/issue-79-on-docs-doc-runtime-validation
