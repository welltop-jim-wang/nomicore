# SA3 实现报告 — issue #108 persistence：typed load/create 错误与 committed-aware create fatal

- **SA**: SA3（TDD Implementer）
- **worktree**: /home/wangjian/nomicore-fix-issue-108（branch `fix/issue-108-on-docs-namespace-registry`；全程无 git 写操作）
- **设计依据**: `wiki/raw/task_persistence-typed-errors_design.md`（R1.1，675 行，唯一权威）
- **红灯依据**: `wiki/raw/task_persistence-typed-errors_sa6_red.md`（94 总数：21 红 / 73 绿；tsc 5 处构造性错误）
- **SA2 R2 前提保持**: 「io.write 调用点 = 2 且均 tracked」——实现后 `createDoc` 写段与 `flush` 写段仍为仅有的两个 `io.write` 调用点，均在 tracked op 内（`op`/`flush` 各自 track）；新增分类 catch 均锚定在这两个位点内，未新增第 3 个调用点。

---

## 1. 验收结果（命令 + exit code + 计数摘录）

| 命令 | exit code | 结果 |
|---|---|---|
| `npx tsc -p packages/persistence/tsconfig.json --noEmit` | **0** | 5 处构造性错误清零 |
| `npx vitest run packages/persistence` | **0** | **Test Files 10 passed (10)；Tests 94 passed (94)**；Type Errors no errors；0 unhandled errors |

消费者包类型抽查（防全仓回归，设计 §10 审计佐证）：
- `npx tsc -p packages/dsh-persistence/tsconfig.json --noEmit` → exit 0（见 /tmp/tsc-dsh-persistence.exit）
- `npx tsc -p packages/namespace-runtime/tsconfig.json --noEmit` → exit 0
- `npx tsc -p packages/clock/tsconfig.json --noEmit` → exit 0
- `npx tsc -p packages/doc-runtime/tsconfig.json --noEmit` → exit 0

（命令均后台独立进程运行，exit code 落文件后读取：/tmp/tsc-issue108.exit、/tmp/vitest-issue108.exit、/tmp/tsc-consumers.exit。）

---

## 2. 逐文件改动要点（对照设计章节）

### 2.1 `packages/persistence/src/contract.ts`（+102 行，0 删除；§1.1–§1.3 + §4.1）

1. 追加 `DocLoadOperationalError`（§1.1 逐字：`code:'DOC_LOAD_OPERATIONAL'` 字面字段、`override readonly cause: unknown`、默认 message 常量、JSDoc 含「Corruption/validate failures 非本类型」段）。
2. 追加 `DocCreateOperationalError`（§1.2 逐字：`code:'DOC_CREATE_OPERATIONAL'`、`readonly committed: false = false` 字面、JSDoc 含 Boundary 段——信任 PersistenceIO 契约 §3.1、seam 违约 ⇒ adapter bug、AC6 以契约守恒）。
3. 追加 `DocCreateFatalPhase` 四值类型（§1.3：`'probe-read' | 'snapshot-encode' | 'store-write' | 'post-commit'`，注释含与 Registry 三值零词面重叠说明）。
4. 追加冻结映射 `DOC_CREATE_FATAL_PHASE_COMMITTED`（§1.3/R1/A-7：`Readonly<Record<DocCreateFatalPhase, boolean>>` + `Object.freeze`，post-commit 唯一 true；export const）。
5. 追加 `DocCreateFatalError`（§1.3：`code:'DOC_CREATE_FATAL'`、`phase`、`committed` 由冻结映射派生、`cause`；JSDoc：永不声称/承担 rollback，committed:true 时不得重试）。
6. `DocDuplicateError` 与其余全部既有声明逐字未动（§1.0/§6.1）。
7. **偏离 1（最小编译修正，登记于 §4）**：三类的 `cause` 字段声明为 `override readonly cause: unknown`——`lib: ES2022` 使 `Error.cause?: unknown` 存在，`noImplicitOverride: true` 要求 `override` 修饰符。这是等价微调：运行时形状（own-enumerable 字段、构造器赋值）与设计 §1.4（a）完全一致，`toMatchObject`/`JSON.stringify` 行为不变；设计签名本身在 tsconfig 下不可编译，若不修则 tsc 永不绿。设计 §8 对 src 文件「实现需要等价微调」已预授权。
8. 无共享基类裁决落实（§1.4）：四个类型互相独立、`instanceof` 两两互斥；无 `isPersistenceError` 之类判别器（YAGNI，代价已登记在 §1.4）。

### 2.2 `packages/persistence/src/lifecycle.ts`（+108/−12；§2.1/§2.2/§3.1/§4.2）

1. **import 扩展**（§4.2.2）：`DocCreateFatalError, DocCreateOperationalError, DocLoadOperationalError` 进入来自 `./contract.js` 的既有 import（DAG 不变——contract.ts 仍为叶，无反向 barrel import；module-graph-regression 两守卫保持绿）。
2. **`PersistenceIO` 契约注释重写**（§4.2.1/§3.1 文案）：观察通道公理四条 bullet——resolve ⟺ 基准 store 已持有快照（禁止 silent no-op resolve）；reject ⟹ 本次 write 未改变基准 store + abort 由**入口门**承载（Memory：hook 前；File：三道门全在 rename 前）+ 已进入的写运行至完成；seam 违约定义（部分提交后 reject / **同步 throw——PersistenceIO 方法不得同步 throw，一切失败必须经 returned Promise 拒绝**，R1/A-2）；read 同 honor signal。接口签名逐字不动。
3. **claim 段分类**（§4.2.3/§2.2 R1/R2/R3）：两个 `await …rawPromise` + `assertCurrentEpoch` 位点各包一个 try/catch；三元归类 `this.isCurrent(epoch) ? new DocCreateOperationalError(err) : new DocCreateFatalError('probe-read', err)`——rawPromise 拒绝（epoch current → operational；stale → fatal，AC6 不谎报 operational）与 `assertCurrentEpoch` 拒绝（恒 stale → fatal probe-read，旧裸 disposed Error 成为 cause，§6.2 字面存续）均落在该格点。duplicate 判定在 try 之外，逐字不动（§2.2 C1）。
4. **写段/注册段三段式**（§4.2.4/§2.2 W1–W5）：
   - encode 段 catch → `DocCreateFatalError('snapshot-encode', err)`（W1，AC6 不降级；未触写路径 ⇒ committed:false 权威）；
   - write 段 catch → 三元 `current → DocCreateOperationalError(err)`（W2）/ `stale → DocCreateFatalError('store-write', err)`（W3，入口门下 reject ⇒ 提交段未执行 ⇒ committed:false）；
   - 提交后段 catch（`assertCurrentEpoch` + `createEntry` + `cells.set` + `issueHandle` 整体）→ `DocCreateFatalError('post-commit', err)`（W4/W5，`write resolved ⇒ 提交段已执行 ⇒ committed:true`；无 rollback 声称/承诺/执行——N5 负锁满足）。
   - 外层 catch 只做 claim 清理（`cur?.state === 'creating' && cur.claim === claim` 守卫逐字保留，§2.2 C2）后 rethrow。
   - `claim.promise = op.then(...)` 派生接线逐字不动（U8）。
5. **load 路由分类**（§4.2.5/§2.1 L1）：`routeOwnedRead` 的 `snapshot instanceof ReadError` 分支 `cells.delete(key)` 清理保持在前，`throw snapshot.err` 改为 `throw new DocLoadOperationalError(snapshot.err)`（exact cause identity；同一 ticket 共享 ⇒ 同一包装实例——EC1 同一性断言满足）。disposed-first 分支（L2）、restore/validate 分支（L3）、`loadSlowPath` 出口 `assertReadable`（L5）、适配器层出口（L6）逐字不动。
6. **`completion.catch(() => {})` 守卫**（§4.2.6，必改）：`createReadTicket` 中 deferred `completion` 构造后立即挂 no-op 吸收 handler + 注释——create 发起的 read ticket 被拒且无并发 load 等待 completion 时不再产生进程级 unhandledRejection（EC4/EC6 由此由红转绿；vitest 0 unhandled errors）。
7. `saveDoc`/`flush`/`scheduleRetry`/`maybeEvict`/`dispose`/`seedForTest`/句柄与状态机：**零改动**（§4.2.7/§6.3/§6.4；flush 三结局可观察等价性由 §3.3 已证，本实现未触碰 flush 一行）。

### 2.3 `packages/persistence/src/memory.ts`（+75/−4；§3.1/§3.4/§3.5/§4.3）

1. **abort 门移位**（§4.3.1/§3.5 方案 (a)）：write 闭包 `if (signal.aborted) return`（早退 resolve）删除；`signal.throwIfAborted()` 提至 **io.write 入口、flat hook 之前**；hook 之后直接 `this.snapshots.set(...)`，**无第二道门**——已进入的写运行至完成（hook 副作用 + mirror set）⇒ resolve ⇒ committed:true（委托模型读权威可读一致，EC10 锚定）。
2. **io 闭包内联注释改写**（§4.3.3/R1.1/N-3）：语义句改为「the abort gate sits at io.write ENTRY (before any hook side effect); a write that has entered runs to completion — hook side effects + mirror set — and resolving means committed (§3.5/ADR observability axiom)」；「Byte-order and await-depth identical…」句保留（await 深度确实不变）；read 侧注释（`??` 短路、hook 唯一读权威）逐字不动。
3. **`writeSnapshot` 注释契约义务改写**（§4.3.4/R1/A-1）：hook 一经进入应运行至完成（含自身全部副作用）或在其副作用开始前 reject；不得部分提交后 reject（§3.1 seam 违约定义）；abort 检查由 adapter 入口门承担，hook 可 consult signal 但非必须。`readSnapshot` 注释与语义逐字不动（§4.3.5）。
4. **`MemoryPersistenceOptions` 追加 `wrapIo`**（§3.4 JSDoc 逐字：around-seam、默认不传零行为增量、返回 io 必须 uphold PersistenceIO 契约）+ 构造器装配 `const baseIo = {...}; const io = options.wrapIo !== undefined ? options.wrapIo(baseIo) : baseIo`。
5. **`dispose()` 注释不变量重述**（§4.3.2/R1/A-1 连带②）：「aborted-signal guard already prevents any mirror write after dispose」→ 排空+清序机制陈述：`core.dispose()` 先排空全部 tracked op（每个写都在 tracked op 内），abort 前已进入的写其晚到 mirror set 发生在 `allSettled` 返回之前、随后 `snapshots.clear()` 清除——disposed 实例数据不可复活（IO-3 语义不变，机制换骨不换魂）。类 doc（R4 isolation rules）不动。
6. **插件工厂 options 收紧**（§4.3.6/R1/A-3）：`Omit<MemoryPersistenceOptions, 'scheduler'>` → `Omit<MemoryPersistenceOptions, 'scheduler' | 'wrapIo'>`（wrapIo 不泄入生产插件签名；profile.ts 只传 schedule/writeSnapshot/readSnapshot，零破坏）。

### 2.4 `packages/persistence/src/file.ts`（+14/−1；§3.4/§4.4）

1. `FilePersistenceOptions` 追加 `wrapIo`（§3.4 JSDoc 逐字）。
2. 构造器：既有 io 闭包提为 `baseIo`，`const io = options.wrapIo !== undefined ? options.wrapIo(baseIo) : baseIo` 装配（默认不传 ⇒ 真实 mkdir→tmp→rename 逐字节不变，§6.6/R1.1/N-1）。
3. `readCommittedSnapshot`/`writeCommittedSnapshot`/`validateIdentity`/`resolveSnapshotPaths` 等**逐字不动**（§4.4.1——默认 IO 提交点本体零改动；EC5 在真实 rename 提交点上锚定 AC5）。
4. `createFilePersistencePlugin` options 同款收紧 `Omit<FilePersistenceOptions, 'scheduler' | 'wrapIo'>`（§4.4.2）。

### 2.5 `packages/persistence/src/index.ts`（+9；§1.5）

additive 导出：`DOC_CREATE_FATAL_PHASE_COMMITTED`、`DocCreateFatalError`、`DocCreateOperationalError`、`DocLoadOperationalError`、`type DocCreateFatalPhase` 并入既有 `./contract.js` 导出块；新增 `export { type PersistenceIO } from './lifecycle.js'`（类型 only，模块图不变——index 聚合再导出不违反 reverse-barrel 守卫）。既有导出逐字未动。

---

## 3. 实现后的绿灯证据映射（SA6 红灯 → 绿灯根因）

| SA6 红灯项 | 根因解锁点 |
|---|---|
| tsc 5 处（TS2305 ×2 / TS2353 ×2 / TS2339 ×1） | contract.ts 三类型 + index.ts 导出（§2.1/§2.5）+ memory/file wrapIo（§2.3.4/§2.4.1） |
| EC1/EC2/EC3/EC4/EC8（wrapIo 未生效 / instanceof undefined） | 同上 + routeOwnedRead 包装（§2.2.5）+ claim 段分类（§2.2.3）+ 写段三段式（§2.2.4） |
| EC5/EC6/EC7（1970 ms hold 超时） | seam 接线（wrapIo）+ 提交后段分类（§2.2.4）+ claim 段分类 + `completion.catch` 守卫（§2.2.6） |
| EC9（encode fatal） | 写段 encode 段分类（§2.2.4 W1） |
| EC10（委托模型 committed:true 自洽） | memory.ts 门位移（§2.3.1）——abort-during-hook 写运行至完成 ⇒ resolve ⇒ post-commit committed:true 且共享 store 可读一致 |
| §5.4.1/§5.4.2/§5.4.3 修订点 | 写段 W2 分类（operational + cause identity）/ W3 分类（store-write fatal + cause identity）/ L1 包装（operational + cause EACCES 保真） |

---

## 4. 偏离登记

| # | 偏离 | 理由 | 影响 |
|---|---|---|---|
| D-1 | contract.ts 三类 `cause` 字段加 `override` 修饰符（设计 §1.1–§1.3 签名为 `readonly cause: unknown`） | `lib: ES2022` 声明 `Error.cause?: unknown` + `noImplicitOverride: true` ⇒ 无 override 时 TS4114，设计签名在 tsconfig 下不可编译（`DocDuplicateError` 无此问题因不声明 cause） | 零：运行时形状与设计 §1.4(a) 类字段模式完全一致（own-enumerable、构造器赋值、`toMatchObject`/`JSON.stringify` 行为不变）；设计 §8「实现需要等价微调」预授权 |
| D-2 | lifecycle.ts 内部以局部 try/catch + 三元单表达式实现 claim 段分类（设计 §4.2.3 伪代码为「按 epoch current/stale 归类」） | 每站点单 try/catch 涵盖 rawPromise 拒绝与 assertCurrentEpoch 拒绝两失败面（后者恒走 stale→fatal 分支），与 §2.2 R1/R2/R3 行语义逐条一致；未引入新私有方法，最小 diff | 零：分类结果与设计伪代码一致 |
| D-3 | 未物理新增 `completion.catch` 于类构造外（挂在 `createReadTicket` 内 deferred 本体上） | 设计 §4.2.6 原文「挂在 deferred 本体上」，实现位置即设计位置 | 零 |
| D-4（无偏离项） | wrapIo JSDoc 内的「§3.5 方案 (a)」字样在 file.ts 同样出现 | §3.4 JSDoc 为共享文案，按设计「逐字」复制到两处 | 零（仅注释） |

**无法实现/需退回的情形**：无。全部需求在 ALLOW LIST 5 文件内完成，未触碰 DENY LIST 任何文件；未改任何测试文件与 src/testing.ts；未做任何 git 写操作；无 env-override/fallback 类软兌底（铁律合规——所有新增 throw 均为既有裸 throw 的 typed 包装或分类替换，无新增绕过路径）。

---

## SA4 发现闭合（F-1/F-2；SA4 verdict pass 附随 PR 闭合项）

来源：`wiki/raw/task_persistence-typed-errors_sa4_review.md` 发现清单节。两处均在原 ALLOW LIST 文件内一行级闭合；未触碰其他文件、未改任何测试、无 git 写操作。

### F-2（MINOR）— memory.ts `writeSnapshot` JSDoc 陈旧首句 ‖ 已闭合

- **问题**：首句「The hook must honor `signal` (abort ⇒ reject promptly)」与本块新契约（已进入的写运行至完成 / abort 检查由入口门承担 / hook may consult but is not required to）自相矛盾——若 hook 需在 abort 时 prompt reject，run-to-complete 语义即被推翻。
- **闭合**：删除该首句，改写为设计 §4.3.4 文案（一行级、纯注释；接口签名与运行时零变化）。重写后全文：hook 一经进入应运行至完成（含自身全部副作用）或在其副作用开始前 reject；不得部分提交后 reject（§3.1 seam 违约定义）；abort 检查由 adapter 入口门承担（门在 io.write ENTRY、hook 之前）；hook 可 consult `signal` 但非必须。
- **相关 hunk**（`git diff -U2 -- packages/persistence/src/memory.ts`，相对 HEAD；该 hunk 即 F-2 修正后的最终形态）：

```diff
@@ -22,8 +22,25 @@ export interface MemoryPersistenceOptions {
    */
   readonly scheduler: PersistenceScheduler
-  /** Implementations must honor `signal` to make in-flight I/O cancellable. */
+  /**
+   * Optional flat write hook. Contract (design §4.3.4/§3.1): a hook that has
+   * entered runs to completion — all of its own side effects — or rejects
+   * before any side effect begins; it must never reject AFTER partially
+   * committing (that is a seam violation, an adapter bug the lifecycle
+   * declares but does not defend against). Abort checks are the adapter
+   * entry gate's job (the gate sits at io.write ENTRY, before this hook):
+   * the hook may consult `signal` but is not required to.
+   */
   readonly writeSnapshot?: (key: string, snapshot: Uint8Array, signal: AbortSignal) => Promise<void> | void
```

### F-1（TRIVIAL）— index.ts 既有导出行字母序重排 ‖ 已闭合

- **问题**：上一版将既有导出行重排为字母序（`DEFAULT_PERSISTENCE_SCHEDULE` 升至 `NOMICORE_PERSISTENCE_SERVICE` 之前、`DocDuplicateError` 移至新类型之后），违反设计 §4.5「既有导出与分组逐字不动」。
- **闭合**：恢复既有行的**原相对顺序**（`NOMICORE_PERSISTENCE_SERVICE` → `DEFAULT_PERSISTENCE_SCHEDULE` → `DocDuplicateError` → `provideNomicorePersistence` → `requireNomicorePersistence` → `resolvePersistenceSchedule` → `type DocHandle` → `type DocHandleStatus` → `type DocPersistence` → `type PersistenceSchedule` → `type PersistenceScheduler` → `type User`，与 HEAD 逐行一致）；5 个新导出作为**纯新增组**落位于 `DocDuplicateError` 之后（对齐设计 §1.5 草图：`DOC_CREATE_FATAL_PHASE_COMMITTED`、`DocCreateFatalError`、`DocCreateOperationalError`、`DocLoadOperationalError`、`type DocCreateFatalPhase`）；`export { type PersistenceIO } from './lifecycle.js'` 保持独立分组。导出集合不变（additive 不变）。
- **相关 hunk**（`git diff -U2 -- packages/persistence/src/index.ts`）：

```diff
@@ -3,4 +3,9 @@ export {
   DEFAULT_PERSISTENCE_SCHEDULE,
   DocDuplicateError,
+  DOC_CREATE_FATAL_PHASE_COMMITTED,
+  DocCreateFatalError,
+  DocCreateOperationalError,
+  DocLoadOperationalError,
+  type DocCreateFatalPhase,
   provideNomicorePersistence,
   requireNomicorePersistence,
@@ -14,4 +19,6 @@ export {
 } from './contract.js'
 
+export { type PersistenceIO } from './lifecycle.js'
+
 export {
   MemoryPersistence,
```

（注意：diff 相对 HEAD 基线呈现整体实现增量；上述 index.ts hunk 中 `NOMICORE_PERSISTENCE_SERVICE` 行在上下文之外未动，与 HEAD 逐字一致——已用 `git show HEAD:…/index.ts` 逐行比对确认。）

### 复验（F-1/F-2 闭合后重跑）

| 命令 | exit code | 结果 |
|---|---|---|
| `npx vitest run packages/persistence` | **0** | **Test Files 10 passed (10)；Tests 94 passed (94)**；Type Errors no errors；0 unhandled errors |
| `npx tsc -p packages/persistence/tsconfig.json --noEmit` | **0** | 零输出（无类型错误） |

（后台独立进程，exit code 落 /tmp/vitest-issue108-r2.exit；与闭合前 94/94 + exit 0 完全一致，F-1/F-2 为零行为变更的注释/排序级闭合。）

---

## 双轴终审 Standards 发现闭合（4 条 judgement 级；Spec 轴 faithful 零发现）

来源：双轴终审报告（Standards 轴 5 条 judgement：4 条可修复已闭合，第 5 条「冻结映射导出」= SA2 R1 A-7 明文要求，裁决保留并登记）。全部改动仍在设计 §8 File Scope（src 5 文件 + testing.ts + 两个测试文件的基础设施修订）；未动 DENY 文件、未动任何断言语义、无 git 写操作。

### 1. Duplicated Code（lifecycle.ts createDoc）— 已闭合

抽取私有分类器 `classifyCreateStoreFailure(phase: 'probe-read' | 'store-write', err, epoch)`（语义 = 原三元 `this.isCurrent(epoch) ? new DocCreateOperationalError(err) : new DocCreateFatalError(phase, err)`），三处复用：claim 段位点 1（reading cell）、位点 2（自探测）、写段 W2/W3。分类结果逐点不变——R3 的 `assertCurrentEpoch` 失败走同一三元时 `isCurrent(epoch)` 必 false ⇒ 恒 stale→fatal（与既有事实一致）；W2/W3 同理（current→operational / stale→'store-write' fatal）。R1/R2/R3 rationale 注释保留在两位点（位点 1 原注释逐字保留；位点 2 补同款简要注解指向位点 1 rationale）。**此修复推翻 §4 D-2 的「未引入新私有方法」选择**——D-2 理由（最小 diff）被 review 反馈以重复代码缺陷推翻，现按 review 采用私有分类器（review 反馈驱动，非自主决策）。

```diff
@@ -204,7 +204,5 @@ export class PersistenceLifecycle {
           // verify. The disposed-epoch Error survives as the exact `cause`.
-          throw this.isCurrent(epoch)
-            ? new DocCreateOperationalError(err)
-            : new DocCreateFatalError('probe-read', err)
+          throw this.classifyCreateStoreFailure('probe-read', err, epoch)
         }
         if (raw !== undefined) throw this.duplicateError(owner, key)
@@ -218,7 +216,7 @@ export class PersistenceLifecycle {
         this.assertCurrentEpoch(epoch)
       } catch (err) {
-        throw this.isCurrent(epoch)
-          ? new DocCreateOperationalError(err)
-          : new DocCreateFatalError('probe-read', err)
+        // R1/R2/R3 rationale 同上（design §2.2）：probe-read 拒绝按 epoch
+        // current/stale 分类；assertCurrentEpoch 失败恒 stale ⇒ 走 fatal 分支。
+        throw this.classifyCreateStoreFailure('probe-read', err, epoch)
       }
@@ -250,7 +248,5 @@ export class PersistenceLifecycle {
           await this.io.write(key, snapshot, this.abortController.signal)
         } catch (err) {
-          throw this.isCurrent(epoch)
-            ? new DocCreateOperationalError(err)
-            : new DocCreateFatalError('store-write', err)
+          throw this.classifyCreateStoreFailure('store-write', err, epoch)
         }
@@ -469,4 +465,27 @@ export class PersistenceLifecycle {
   }
 
+  /** One classifier for every store-level create failure before the commit point …（含 R3 恒 stale 说明、W4/W5 不经过此分类器的说明） */
+  private classifyCreateStoreFailure(
+    phase: 'probe-read' | 'store-write',
+    err: unknown,
+    epoch: number,
+  ): DocCreateOperationalError | DocCreateFatalError {
+    return this.isCurrent(epoch)
+      ? new DocCreateOperationalError(err)
+      : new DocCreateFatalError(phase, err)
+  }
```

### 2. Stale TDD scaffolding + type erasure（testing.ts 新套件 + EC10）— 已闭合

- `describePersistenceErrorContract` 的 `(await import('./contract.js')) as unknown as {…}` 动态导入块（TDD 红阶段「类型不存在」脚手架）删除；四个类型改从模块顶部**静态 import**（`DocDuplicateError`/`DocLoadOperationalError`/`DocCreateOperationalError`/`DocCreateFatalError`），`as unknown as` 与运行时守卫全部移除，断言直接引用真实导出构造器。
- `memory-persistence.test.ts` EC10 的 `await import('../src/index.js')` 同款改为模块顶部静态 import（并入既有 `../src/index.js` 导入块）。
- **保持不动（review 明示 scoping）**：`assertDuplicateError` 的 `DocDuplicateError` 动态导入（issue-64 预存模式）；`describeDocCreateContract` 的懒加载块（既有套件，不在「仅新套件」diff 面）。

```diff
@@ import { Context } from … (testing.ts 顶部)
-import type { DocHandle, DocPersistence, PersistenceScheduler, User } from './contract.js'
+import {
+  DocCreateFatalError,
+  DocCreateOperationalError,
+  DocDuplicateError,
+  DocLoadOperationalError,
+  type DocHandle, type DocPersistence, type PersistenceScheduler, type User,
+} from './contract.js'
@@ describePersistenceErrorContract 函数体
-  // Loaded lazily: the classes do not exist before the SA3 implementation, …
-  const contractMod = (await import('./contract.js')) as unknown as { … }
-  const DocDuplicateError = contractMod.DocDuplicateError as new (message?: string) => Error
-  const DocLoadOperationalError = contractMod.DocLoadOperationalError as … 
-  const DocCreateOperationalError = contractMod.DocCreateOperationalError as …
-  const DocCreateFatalError = contractMod.DocCreateFatalError as …
+  // Typed error faces (issue #108 §5): statically imported from the module
+  // top — the classes ship with the production implementation, so this suite
+  // branches and asserts on the real exported constructors.
@@ memory-persistence.test.ts
-    const { DocCreateFatalError } = await import('../src/index.js')
+    （删除；DocCreateFatalError 并入文件顶部静态 import）
```

### 3. Stale comment（persistence-encode-fatal.test.ts 文件头）— 已闭合

「Phase-1 state: the new error types do not exist yet…」段改写为现状描述：生产实现已输出 typed error，静态 import 为真实导入，本文件锚定 EC9 分类（snapshot-encode phase + 权威 committed:false）。

```diff
- * Phase-1 state: the new error types do not exist yet, so the static imports
- * below are the constructive red — this file fails to load until SA3 lands
- * (same pattern as the vfsl Phase-1 anchors).
+ * The production implementation now ships the typed error, so the static
+ * imports below are the real imports and the assertions run against the
+ * exported `DocCreateFatalError` (this file anchors EC9's classification:
+ * snapshot-encode phase + authoritative committed:false).
```

### 4. Brittle ADR 行号引用（contract.ts 注释）— 已闭合

| 原引用 | 改后（节名引用） |
|---|---|
| `ADR-0009 L76/L81`（DocLoadOperationalError） | `ADR-0009 §Persistence 错误演进` |
| `ADR-0009 L77/L81`（DocCreateOperationalError） | `ADR-0009 §Persistence 错误演进` |
| `ADR-0009 L78/L81, ADR-0008 §Fatal 同款纪律`（DocCreateFatalError） | `ADR-0009 §Persistence 错误演进, ADR-0008 §Fatal 与失败通道 同款纪律`（节名以 docs/adr/0008 实际标题「## Fatal 与失败通道」为准） |
| `ADR-0009 L89–L93`（DocCreateFatalPhase） | `ADR-0009 §Fatal、错误与 observability`（docs/adr/0009 实际标题「### Fatal、错误与 observability」，Registry 三值原文在内） |
| `Boundary (R1/A-5):` | `Boundary note:`（后文已自含描述边界语义，删除轮次指针） |
| `Exported (R1/A-7, additive): SA6/未来消费方可…` | `Exported (additive): 测试套件与未来消费方可…` |

**保留不动（review 明示）**：`design §x.y` 引用（含 memory.ts 既有 `design §5.3.1/IO-1` 惯例）、分类表行名（R1/R2/R3、W1–W5、L1 等）——预存仓库惯例且 wiki 档案随分支提交，属耐久文档。lifecycle.ts 无任何 ADR 行号引用（复查：仅 design § 引用 + 分类表行名），无需改动。`file-persistence.test.ts` 头注「Phase-1 acceptance anchor」为 issue-58 预存文案，非本 issue 脚手架，不在 review 点名范围，未动。

### 复验（4 条闭合后重跑，后台独立进程）

| 命令 | exit code | 结果 |
|---|---|---|
| `npx vitest run packages/persistence` | **0** | **Test Files 10 passed (10)；Tests 94 passed (94)**；Type Errors no errors；0 unhandled |
| `npx tsc -p packages/persistence/tsconfig.json --noEmit` | **0** | 零输出 |
| `npx vitest run packages/dsh-persistence packages/namespace-runtime` | **0** | **Test Files 29 passed (29)；Tests 170 passed (170)**；Type Errors no errors |

（exit code 落 /tmp/combo-3.exit；与闭合前完全一致——本次改动为重构级（分类器抽取）+ 测试基础设施（导入形态）+ 纯注释，零行为变更。）

---

### 2b. 补充闭合：`describeDocCreateContract` 懒加载块（Standards 复审残留 1 条）

复审核实：testing.ts 该懒加载块（`contractMod = (await import('./contract.js')) as unknown as {…}` + 两条 `as` 断言 + 「these classes do not exist before the SA3 implementation」注释）确为本提交（SA6 §5.4 修订时）新增——baseline 仅有 `assertDuplicateError` 的 `DocDuplicateError` 懒加载（L277，issue-64 预存模式，保持不动）。块内两个用例（§5.4.1/§5.4.2 修订处）直接引用文件顶部已静态导入的 `DocCreateOperationalError`/`DocCreateFatalError`，懒加载块与陈旧注释删除，type erasure 清空。

```diff
@@ describeDocCreateContract 函数体
   const { describe, expect, it } = await vitest()
-  // Typed create error faces (issue #108 §5.4). Loaded lazily: these classes do
-  // not exist before the SA3 implementation, and a static import of a missing
-  // export would make every consumer of this module fail to load.
-  const contractMod = (await import('./contract.js')) as unknown as {
-    DocCreateFatalError?: new (phase: string, cause: unknown, message?: string) => Error
-    DocCreateOperationalError?: new (cause: unknown, message?: string) => Error
-  }
-  const DocCreateFatalError = contractMod.DocCreateFatalError as new (phase: string, cause: unknown, message?: string) => Error
-  const DocCreateOperationalError = contractMod.DocCreateOperationalError as new (cause: unknown, message?: string) => Error
   describe('DocPersistence createDoc contract', () => {
```

**补充复验**（后台独立进程；exit code 落 /tmp/combo-4.exit）：`npx vitest run packages/persistence` → exit 0，**Test Files 10 passed (10)；Tests 94 passed (94)**；Type Errors no errors；`npx tsc -p packages/persistence/tsconfig.json --noEmit` → **exit 0**（零输出）。与闭合前完全一致——测试基础设施导入形态清理，零行为变更。
