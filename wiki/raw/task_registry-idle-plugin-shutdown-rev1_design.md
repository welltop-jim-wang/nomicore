# 设计（rev1）— registry-idle-plugin-shutdown 三项 spec 审查缺陷修复（issue #112 round 2）

> **版本**：R2（SA2 攻击评审 reject 后的修订版——攻击点 #1 HIGH 必做 + #2/#3 顺手 +
> #4 可选 + SA8 勘误；修订面 = 设计文本与契约注释层，机制主体经 SA2 源码亲核 +
> 双实验证实不动）。SA2 评审：`wiki/raw/task_registry-idle-plugin-shutdown-rev1_sa2_review.md`。
> 逐条回应见文末「SA2 反馈逐条回应（R2）」。

## §0. 输入、范围与身份

- 任务：issue #112 round 2 修订轮（Bug 修复）；worktree `/home/wangjian/nomicore-fix-issue-112`，
  branch `fix/issue-112-on-docs-namespace-registry`（PR #126 全绿基线之上）。
- 输入（已全文亲读）：
  - 简报 `wiki/raw/task_registry-idle-plugin-shutdown-rev1.md`（3 项缺陷 + 13 AC 保持要求）；
  - 相关决议 `wiki/raw/task_registry-idle-plugin-shutdown-rev1_relevant_decisions.md`
    （ADR-0009 / ADR-0008 / ADR-0006 摘录 + 上一轮冻结决策摘录 + SA8 前置门禁
    verdict=clear：persistence 侧排空钩子已放行但非强制，所选路径须文本显式记录并守住
    ADR-0006 四条约束）；
  - SA6 红灯契约 `wiki/raw/task_registry-idle-plugin-shutdown-rev1_sa6_red.md`（4 用例，
    当前实现下 4/4 红，`Tests 4 failed | 150 passed (154)`）；
  - 红灯测试源码（`registry-shutdown.test.ts` 19b、`registry-idle.test.ts` 11b、
    `registry-plugin.test.ts` 29、`registry-sa7-cordis.test.ts` SA7-P2 改写）；
  - round 1 冻结设计（`task_registry-idle-plugin-shutdown.md` §2.A–§2.M/§5/§8）；
  - 生产源码：`packages/namespace-registry/src/{registry,plugin,observer,errors,testing}.ts`、
    `packages/persistence/src/{service,memory,file,lifecycle,contract}.ts`、
    `packages/dsh-persistence/src/profile.ts`；
  - Cordis 4.0.1 构建产物**随包发布的 TypeScript 源码**（本会话亲核，
    `node_modules/.pnpm/@deepseek-ai+cordis@4.0.1/node_modules/@deepseek-ai/cordis/src/{fiber,reflect,utils}.ts`）。
- 本设计的三项修复与验收锚：
  | 缺陷 | 位置 | 修复章节 | 红灯锚 |
  |---|---|---|---|
  | P1 shutdown 未收编 close() 同步 throw | `registry.ts` runShutdown 关闭发起段 | §2.A | 19b |
  | P2 idle-close 同步 throw 逃出 timer 回调 | `registry.ts` beginIdleClose | §2.B | 11b |
  | P3 未真正保证 Registry shutdown 先于 Persistence dispose | `persistence` 侧 wiring + `plugin.ts` 头注 | §2.C | 29 + SA7-P2 |

---

## §1. 根因推演

### §1.1 P1：runShutdown 关闭发起段的同步 throw 中断枚举

现状（`registry.ts:977-987`）：

```ts
const closures: Array<{ entry: Entry; promise: Promise<void> }> = [];
for (const entry of entries.values()) {
  if (entry.closePromise !== undefined) {
    closures.push({ entry, promise: entry.closePromise });   // AC10 复用（无缺陷）
  } else {
    const promise = entry.runtime.close();   // ★ 缺陷点：同步 throw 未收编
    entry.closePromise = promise;
    entry.phase = 'closing';
    closures.push({ entry, promise });
  }
}
```

根因链（最深层的单一事实）：**runShutdown 只为 close 的 *rejection* 准备了收编通道
（§2.D 步骤 3 的 `try { await promise } catch`），没有为 close 的*发起*本身
（同步 throw）准备通道**。`entry.runtime.close()` 是跨包边界调用（ADR-0008 :67 明文：
该 ADR 未规定 close() 是否可能同步 throw——收编属 Registry 自身聚合职责
ADR-0009:101），一旦同步抛错：

1. 异常沿 async 函数体直接 reject `runShutdown()` 的 Promise → 裸原因逃逸
   （非 `NamespaceRegistryShutdownError`）；
2. 枚举中断：后续 Runtime 的 close() 不被调用（红灯 19b：`closeCalls(k2)===0` 段）；
3. `entries.clear()` / `acceptance='stopped'` 不可达 → Registry 永停 `shutting-down`；
4. 同步 throw 的 entry 处于 `phase` 未翻、`closePromise` 未写的中间态（I2 未破坏但
   生命周期悬置）。

### §1.2 P2：beginIdleClose 的同步 throw 逃出 timer 回调

现状（`registry.ts:627-646`）：

```ts
function beginIdleClose(entry: Entry): void {
  if (entries.get(entry.key) !== entry) return;   // ABA 守卫（无缺陷）
  if (entry.phase !== 'idle') return;             // 结构性防御（无缺陷）
  entry.idleTimerHandle = undefined;              // I4 token 收缴（无缺陷）
  const closePromise = entry.runtime.close();     // ★ 缺陷点：同步 throw 未收编
  entry.closePromise = closePromise;              // I2 落位
  entry.phase = 'closing';                        // AC5 不可逆翻相
  closePromise.then( … ④ settle 移除 / ⑤ idle-close-failed observer … );
}
```

根因：**beginIdleClose 隐含假定 `runtime.close()` 恒返回 Promise**（「① 先取得 close
Promise」的注释即证据）。同步抛错时异常沿 `scheduler.setTimeout` 回调栈直接逃出：
fake scheduler 的 `advanceBy` 被拒绝（红灯 11b 第一个断言失败点）；
`entry.idleTimerHandle` 已清但 `phase` 停留 idle、`closePromise` 未写——entry 卡死在
「无 timer、无 close、不可复用语义歧义」态；observer `idle-close-failed` 不产生；
真实 Cordis `ctx.timeout` 路径下该异常同样逃出 timer 插件的 effect 回调（进入 cordis
`ctx.logger.error`，而非 Registry 的失败通道）。这不是降级场景（外部资源不可用），
是正常生命周期路径上的收编缺口——按 SKILL 纪律必须设计**统一失败通道**而非任何
静默吞咽或降级。

### §1.3 P3：adapter dispose 与 Registry shutdown 的并发未被编排消除

现状（`persistence/src/memory.ts:104-111`，`file.ts:89-96` 同形）：

```ts
apply(ctx: Context): void {
  assertPersistenceHostDependencies(ctx)
  ctx.effect(() => {
    provideNomicorePersistence(ctx, this)   // provide wrapper 留在 fiber 级清单
    return () => this.dispose()             // adapter dispose = 同 fiber 另一 disposable
  }, 'memory-persistence: service')
}
```

机制级根因（本会话对照 Cordis 4.0.1 `src/*.ts` 逐条亲核，引用见 §5）：

- **M-A（fiber 级并发）**：`Fiber._unload`（fiber.ts:675-687）以
  `await Promise.all(this._disposables.clear().map(...))` **并发**运行本级全部
  disposables。provide wrapper（撤服务 + 级联依赖）与 adapter dispose effect 是同级
  两个 disposable → adapter dispose 不等依赖方 settle 即开始（红灯 29 事件序
  `['persistence-adapter-disposed','persistence-adapter-disposed-complete','registry-shutdown-settled']`
  即其直接观测）。
- **M-B（依赖级联只串行化 service 撤销，不串行化 sibling effect）**：
  `ReflectService.provide` 的 disposer（reflect.ts:296-303）=「delete store →
  notify（触发 inject 该服务的依赖 fiber 卸载）→ `await Promise.allSettled(fibers.map(f
  => f.await()))`」。它保证**依赖 fiber settle 先于 provide disposal 完成**——这是
  round 1 已兑现的 fiber 级保证；但 adapter dispose 是它的**并发 sibling**，不在该
  join 内。
- **M-C（后果）**：Registry shutdown 的排空对象（runtime close barrier 的写槽
  S6 `await notifyDirty`＝`persistence.saveDoc(handle)`、`handle.release()`）会撞上
  `PersistenceLifecycle.dispose()` 已置的 `closed=true`（`saveDoc` →
  `assertWritable` → throw `'persistence is disposed'`）→ close 失败 → 进入 shutdown
  聚合错误。round 1 SA7-P2 把该并发失败固化为预期——spec 审查判定其弱于 AC11。

关键结论（路径裁决的机制基础，详 §2.C.1）：**adapter dispose 的调用点
（effect disposer 内的 `this.dispose()`）位于 persistence fiber 自己的 disposable 里，
registry 侧对它没有任何重排杠杆**；红灯探针挂在 `adapter.dispose` 实例方法**入口**，
任何「在 dispose 内部等待」的方案都无法满足「dispose 开始晚于
registry-shutdown-settled」的次序契约——等待必须发生在 `this.dispose()` 被调用**之前**。

---

## §2. 修复设计

### §2.A P1：runShutdown 关闭发起段收编同步 throw（与 rejection 同构聚合）

改动点唯一：关闭发起分支加 try/catch，同步 throw 合成为 **rejected Promise**，
其余全部冻结逻辑（复用分支、聚合循环、终态推进）逐字不动：

```ts
// registry.ts runShutdown 关闭发起段（§2.D 步骤 2，rev1 修订）：
const closures: Array<{ entry: Entry; promise: Promise<void> }> = [];
for (const entry of entries.values()) {
  if (entry.closePromise !== undefined) {
    closures.push({ entry, promise: entry.closePromise });   // AC10 复用（不变）
  } else {
    let promise: Promise<void>;
    try {
      promise = entry.runtime.close();       // 关闭发起（同步 throw 收编点）
    } catch (cause) {
      // P1：同步 throw 与 Promise rejection 同构——合成为 rejected Promise，
      // 进入下方同一聚合通道（failures 收录 exact cause，恰一次）。
      promise = Promise.reject(cause);
      void promise.catch(() => {});          // 即刻挂接空处理：见下「零 floating window」
    }
    entry.closePromise = promise;            // I2：closing ⟹ closePromise 定义（rejected 亦落位）
    entry.phase = 'closing';                 // 不可逆翻相（与 rejection 路径同款记账）
    closures.push({ entry, promise });
  }
}
// 步骤 3（聚合）与步骤 4（entries.clear + acceptance='stopped' + 聚合 throw）
// 逐字不变——同步 throw 经合成 Promise 走完全相同的路径。
```

**设计裁决与不变量**：

1. **同构聚合（红灯 19b ①③）**：`Promise.reject(cause)` 使同步 throw 与 rejection
   共用「步骤 3 `await promise → catch → failures.push({owner, namespaceId, cause})`」
   ——`NamespaceRegistryShutdownError.failures` 收录 exact 同步 cause（instance 级
   恒等，19b 断言 `cause === syncCause`）、恰一次、次序 = Map 插入序（与 rejection
   完全同构，无第二套失败通道）。
2. **全部 Runtime 必被尝试（19b ②）**：try/catch 吸收首抛，枚举不中断；
   `closeCalls` 计数含同步 throw 的调用（ObservableRuntime 在 throw 前自增，
   `registry-shutdown.test.ts:197-198`）。
3. **`entries.clear()` + `acceptance='stopped'` 恒执行（19b ③）**：发起段不再有
   逃逸异常，runShutdown 必然到达步骤 4——「状态机先到 stopped 再 throw、失败不回滚
   终态」的冻结裁决对同步 throw 同样成立。
4. **零 floating window（unhandled rejection 免疫）**：rejected Promise 从创建到被
   聚合循环 `await` 之间可能隔有**其他 closure 的 await 挂起**（同步 throw entry 不在
   closures 首位、前置 close Promise 未结算时，微任务排空会先回到事件循环——Node 在
   该 checkpoint 对无 handler 的 rejected Promise 触发 `unhandledRejection`，依据见
   §5#9）。故在合成点**同一同步段**挂接 `void promise.catch(() => {})`：该 Promise
   从出生即 handled；聚合循环的 `await` 是第二个 handler（多 handler 合法），cause
   仍恰一次进 failures。这不是可选加固，是任意 entries 次序下的正确性要件。
5. **不新增 observer 事件**：shutdown 发起的 close 失败走聚合错误通道（冻结裁决
   「shutdown 不加事件——close 失败经聚合错误交付」）；`idle-close-failed` 仍专属
   idle 发起侧。同步 throw 路径同理，零事件面增量。
6. **I2/接口面零增量**：rejected Promise 也是「closePromise 落位」，`phase='closing'`
   记账与 rejection 路径同款；types/errors/observer/testing 零改动。

### §2.B P2：beginIdleClose 收编同步 throw（I2 许可的 closing 语义，四通道结构不变）

改动点唯一：close 发起加 try/catch，其余（ABA 守卫、token 收缴、I2 落位顺序、
翻相、settle 双臂）逐字不动：

```ts
// registry.ts beginIdleClose（§2.B ④⑤，rev1 修订）：
function beginIdleClose(entry: Entry): void {
  if (entries.get(entry.key) !== entry) return;   // 旧 generation ABA 守卫（不变）
  if (entry.phase !== 'idle') return;             // 结构性防御（不变）
  entry.idleTimerHandle = undefined;              // I4 token 收缴（不变，先于 close 发起）
  let closePromise: Promise<void>;
  try {
    closePromise = entry.runtime.close();         // ① close 发起（同步 throw 收编点）
  } catch (cause) {
    // P2：同步 throw ⟶ rejected Promise 落位——I2 许可的 closing 语义对同步 throw
    // 同构成方；异常不逃出 timer 回调（I4 收缴先行，本函数零逃逸点）。
    closePromise = Promise.reject(cause);
  }
  entry.closePromise = closePromise;              // ② I2：closing ⟹ closePromise 定义（rejected 亦「落位」）
  entry.phase = 'closing';                        // ③ 不可逆翻相（AC5）
  closePromise.then(                              // ④⑤ 同一同步段挂接两臂（零 floating window，见下）
    () => removeEntryAfterClose(entry, undefined),
    (cause) => {
      dispatchObserver(observer, {                // AC7：exact cause 进内部 observer
        type: 'idle-close-failed',                //     恰一次（close 发起侧单点，同构保持）
        identity: entryIdentity(entry),
        generation: entry.generation,
        cause,
      });
      removeEntryAfterClose(entry, cause);        // removeOnlySelf 双守卫移除
    },
  );
}
```

**四通道结构核对（冻结 §2.C 1-4 条逐条保持，扩展到同步 throw）**：

| 通道 | rejection（既有，冻结） | 同步 throw（rev1 扩展） |
|---|---|---|
| ① 零 unhandled rejection | `.then(onF, onR)` 两臂均不重抛 | **同一同步段**挂接同一 `.then`——从 `Promise.reject(cause)` 创建到挂接之间零 await/零挂起（三条同步语句），不存在 §2.A 那种跨 closure 的 floating window，无需额外空 catch；reject 臂内 `dispatchObserver` 被 try/catch 隔离（observer.ts:53-63，sink throw 静默丢弃），派生 Promise 不 reject |
| ② observer `idle-close-failed` exact cause 恰一次 | reject 臂单点 | 同一 reject 臂单点——同步 cause 经合成 Promise 流入，零第二上报点（红灯 11b ②） |
| ③ settle → removeOnlySelf 移除 | 两臂均移除 | 同一 settle 语义：rejected Promise 立即 settle → reject 臂 `removeEntryAfterClose` → identity+generation 双守卫删除（红灯 11b ③ 前置） |
| ④ 后续 open 不被污染 | entry 移除 → 全新 generation | 同：entry 移除后 open 走 loadDoc/factory 新 generation（11b 断言 `loadCalls===2`、新 Runtime marker） |

**「不逃出 timer callback」（11b ①）**：收编点在 beginIdleClose 函数体内，异常不再
沿 `scheduler.setTimeout` 回调栈传播——fake scheduler 的 `advanceBy` 正常 settle；
真实 Cordis 路径下 timer 插件 effect 回调零异常。「不污染后续 open」：phase='closing'
+ rejected closePromise 与 rejection 路径**完全同态**——在途 open 的 closing-wait
分支 `await closePromise` catch 后建新 generation（§2.B 冻结行为），shutdown 遇
closing entry 走复用分支（AC10）。I4 前提保持：token 收缴语句在 close 发起之前
（既有次序不动）。

**与 §2.A 的对称性说明（有意的不对称设计）**：idle 路径不挂额外空 catch 而依赖
同一同步段挂接，是因 reject 臂**就是**该 Promise 的消费通道且无跨 await 间隙；
shutdown 路径必须挂空 catch，是因聚合循环的 await 可能晚于其它 closure 的挂起。
两处各自取「最小必要防御」，语义同为「rejected Promise 出生即 handled」。

### §2.C P3：persistence 侧有序 disposer——adapter dispose 严格晚于依赖方 settle

#### §2.C.0 路径裁决（brief 明文要求：显式记录，SA8 verdict=clear 下的自主定夺）

| 路径 | 裁决 | 依据（机制/源码级） |
|---|---|---|
| **甲：纯 plugin 侧编排**（registry plugin 侧表达强依赖） | ❌ 拒绝 | adapter dispose 的调用点在 persistence fiber 自己的 disposable 内（M-A）；registry plugin 对 persistence fiber 的 `_disposables` 清单无任何杠杆——不持有 fiber 引用、不可 re-parent 他 fiber 的 effect、不可包装其 disposer。唯一「plugin 侧」手段是运行时替换 `adapter.dispose` 实例方法（monkey-patch），但红灯探针挂在 `dispose` **入口**（`registry-plugin.test.ts:486-490`：影子方法首行 push 事件后才调原实现）——任何 dispose 内部的等待都晚于探针触发，次序断言必失败；且跨包篡改他包实例方法属架构违约。SA8「机制证据显示不完整」的判断与此一致，本设计以源码证据将其闭合为「结构性不可行」。 |
| **乙：persistence 共享 core 的 handle 排空钩子**（`PersistenceLifecycle` 等 outstanding handle 全部 release 后再 dispose） | ❌ 拒绝 | （a）**微任务次序洞**：handle release 发生在 runtime close barrier 内部（`PersistenceHandle.release()` 同步删 `entry.handles`，lifecycle.ts:110-116/511-516），早于 close Promise settle、早于 `registry.shutdown()` resolve——排空等待在 `releaseHandle` 处唤醒，`this.dispose()`（探针）会在 `registry-shutdown-settled` **之前**触发，红灯 29/SA7-P2 的 `indexOf` 断言仍失败。（b）向共享 lifecycle core 加「handle 计数 + waiter 集合」状态机（ADR-0006 :157-159 共享 core 纪律的最敏感区），并引入新挂起类（调用方泄漏 handle → fiber 卸载永挂）。 |
| **丙：persistence 侧有序 disposer**（service 撤销 → await 依赖 fiber settle → adapter dispose） | ✅ **采纳** | 表达的依赖恰是问题本体：「adapter 资源释放必须晚于 `nomicorePersistence` 全部依赖方的 settle」。等待对象是**依赖 fiber 卸载完成**（registry fiber 卸载完成 ⊇ `registry.shutdown()` settle，时序上严格后于 `registry-shutdown-settled` 探针），无乙的微任务洞；等待机制 = Cordis 依赖图既有 join（§5#2/#5），零新状态机、零新 API 面。 |

#### §2.C.1 机制（Cordis 4.0.1 源码亲核，完整证据链见 §5）

采纳路径丙的机制载体是 round 1 已在 registry plugin 验证过的**generator effect +
yield re-parent + 逆序串行**三件套（plugin.ts:159-177 先例），本设计将其施加到
persistence adapter 的 service wiring 上：

1. **re-parent**：generator effect 内 `yield revoke` 使嵌套 `ctx.provide` wrapper 从
   fiber 级**并发**清单（M-A 的 `Promise.all`）移入本 effect 的**有序**表
   （fiber.ts:445-452 `collect`：`disposables.push(dispose); this._disposables.delete(dispose)`）。
2. **逆序串行**：effect 的本地 disposables 按收集序**逆序**执行，且以
   `task.then(() => runDisposable(next))` 链式**串行**（fiber.ts:421-436）。
3. **join 安全（R2 归因修正，与 §5#5 一致）**：`runDisposable` + `effectInertia`
   （fiber.ts:116-120）使同一 wrapper 的二次执行 join 到既有 disposal task
   （no-op）——这是结构性 owner（fiber `_unload`、外层 effect 串行链）的完整 join
   路径。本设计 helper 内的 `await revoke()` 走**调用路径**（先调用后 await 返回值）：
   re-parent 后串行链上 drainStep 先行、无人提前启动 wrapper，直接调用体在未启动态
   `finalizeDisposal` 启动 disposal 并返回 inFlight——`await` 等的是该返回值，全程
   等待；`.then` 覆写（fiber.ts:544-548）服务的是对 wrapper 本身的 thenable-await
   路径（裸 `await revoke`），同为「未启动则直启 + 全程等待」。两路径在「已启动」
   态均不 join——join 完整性由 yield re-parent + 串行链保证。
4. **provide disposer 的等待内容**：`delete store → notify → await
   Promise.allSettled(依赖 fiber.await())`（reflect.ts:296-303）——依赖 fiber
   （registry）**卸载完成**（含其 plugin 有序 disposer：`await registry.shutdown()` →
   revoke nomicoreRegistry → `instance=undefined` → 该 fiber 其余 disposables）之后
   provide disposal 才 settle。

#### §2.C.2 实现：共享 wiring helper（单源，两 Adapter 复用）

`packages/persistence/src/service.ts` 新增（该文件是既有「Cordis wiring leaf」，
模块图 DAG：service → contract，lifecycle.ts 永不 import 它——新增边不构成环，
module-graph-regression.test.ts 只禁 reverse-barrel import 与 host-global timer API，
均不触碰）：

```ts
// service.ts（新增，rev1 问题 3 的唯一机制落点）
import { provideNomicorePersistence } from './contract.js'   // 运行时导入（既有类型导入之外新增）

/**
 * 绑定 persistence adapter 的 Cordis 生命周期（rev1 问题 3，ADR-0006 :86 宿主逆序
 * 停止职责 + ADR-0009 :103 Plugin dispose 有序 disposer）：service 撤销与 adapter
 * dispose 纳入同一个**有序** effect——
 *
 *   卸载序（effect 本地 disposables 逆序串行执行）：
 *     drainStep（先执行）：await revoke() —— 撤销 nomicorePersistence（delete store →
 *                          notify → await 全部依赖 fiber 卸载完成）；finally 兜底
 *                          await adapter.dispose()（撤销链异常也不漏资源释放）；
 *     revoke（后执行）  ：runDisposable join 到同一 disposal task（no-op）。
 *
 * 由此 adapter dispose（文件句柄/后台任务/Y.Doc 缓存释放）严格晚于
 * nomicorePersistence 全部依赖方（如 NamespaceRegistry plugin：其 shutdown 排空
 * 期间的 handle.release / saveDoc 的 entry 断言全程面对未 disposed 的 adapter
 * ——「close 撞已销毁 handle」聚合失败被消灭）——AC11「先于 Persistence dispose」
 * 从 fiber 级提升为 adapter 级真实保证。
 *
 * ⚠️ 宿主接线契约（R5′，生产 timer 限定）：本 fiber 处于 UNLOADING 的 drain 窗口内，
 * 经 `ctx.timeout` 的**新 flush/retry timer 武装**会抛 CordisError('INACTIVE_EFFECT')
 * （真实 TimerService 语义：副作用绑定调用方 fiber，fiber.effect 对 UNLOADING 态
 * 显式 throw）→ 窗口内到达 saveDoc 的在途写收到响亮 rejection（交付写调用方）。
 * 需要写排空完整落盘的宿主应先 settle 依赖方（await registry shutdown/fiber 卸载）
 * 再拆 persistence fiber。fake-timer 测试 seam（testing.ts）不经 ctx.effect，对该
 * 窗口结构性失明。详见设计 rev1 §8 R5′。
 *
 * 直接调用 adapter.dispose() 的宿主编排（不经 fiber 卸载）不受影响：dispose 语义
 * 与幂等性零变化（宿主职责，ADR-0006 :86）。
 */
export function bindPersistenceAdapterLifecycle(
  ctx: Context,
  adapter: { dispose(): Promise<void> },
  label: string,
): void {
  ctx.effect(function* () {
    // yield 收集序 [revoke, drainStep] → 逆序执行 [drainStep, revoke]。
    // yield revoke 同时把嵌套 provide wrapper 从 fiber 级并发清单 re-parent 进本
    // 有序表——否则它与 drainStep 在 fiber _unload 的 Promise.all 中并发（round 1
    // 缺陷根源，§5#1/#6）。
    const revoke = provideNomicorePersistence(ctx, adapter)
    yield revoke
    yield async () => {
      try {
        await revoke()        // 撤服务 → 级联依赖 fiber 卸载并 settle
                             // （await revoke() = 先调用后 await 返回值：直接调用体在未启动时
                             //  finalizeDisposal 启动 disposal 并返回 inFlight——await 等的是该
                             //  返回值，全程等待；归因区分见 §5#5）
      } finally {
        await adapter.dispose() // 依赖方 settle 后才释放 adapter 资源；revoke 异常亦不漏
      }
    }
  }, label)
}
```

`memory.ts` / `file.ts` 的 `apply` 改为调用共享 helper（两 Adapter 单源 wiring，
无状态机复制）：

```ts
// memory.ts apply（rev1：原 ctx.effect(() => { provide…; return () => this.dispose() }) 整体替换）
apply(ctx: Context): void {
  // AC2: loud fail on missing clock/timer before ANY service is provided.
  assertPersistenceHostDependencies(ctx)
  bindPersistenceAdapterLifecycle(ctx, this, 'memory-persistence: service')
}

// file.ts apply（同款替换；label 保持 'file-persistence: service'）
apply(ctx: Context): void {
  assertPersistenceHostDependencies(ctx)
  bindPersistenceAdapterLifecycle(ctx, this, 'file-persistence: service')
}
```

（随之机械清理：memory.ts/file.ts 对 `provideNomicorePersistence` 的直接 import 移除
——唯一使用点已上移 helper；其余 contract 类型导入不动。）

#### §2.C.3 红灯 29 / SA7-P2 的次序证明（逐步 trace，确定性）

前置：写槽 S6 挂于门控 `saveDoc`；`p = registry.shutdown()` 已发起并挂接 settle 探针
（AC12 same-Promise，plugin disposer 内 `await registry.shutdown()` 得到同一实例）；
`shutdownSettled === false`。

**运行环境限定（R2 修订，SA2 攻击点 #1）**：本 trace 及红灯 29/SA7-P2 均在
**fake-timer 测试 seam**（`createFakeTimerPlugin`，persistence/src/testing.ts:158-193
——`timeout` 为纯箭头函数、直接进 fake scheduler，**不经 `ctx.effect`**）下成立；
生产真实 TimerService 在 drain 窗口内的**写路径**差异见 §8 R5′（次序契约本身
——`registry-shutdown-settled` 先于 `persistence-adapter-disposed`——经 SA2 实验 1
在真实 cordis + 真实 timer 接线下验证，对两种 timer 均成立；差异仅在窗口内在途写
的 flush 武装是否可用）。

| 步 | 事件 | 机制依据 |
|---|---|---|
| 1 | `memoryFiber.dispose()` → memory fiber `_unload` → fiber 级清单仅剩本 effect wrapper（provide wrapper 已 re-parent）→ 逆序串行执行 drainStep | §5#1/#3/#4 |
| 2 | drainStep：`await revoke()` → `delete store['nomicorePersistence']` → `notify` → registry fiber 依赖断裂 → 级联卸载启动 | §5#2 |
| 3 | registry fiber 卸载 → registry plugin 有序 disposer：`await registry.shutdown()`（= p，门控挂起中） | plugin.ts 冻结逻辑（零改动） |
| 4 | （窗口内）`shutdownSettled` 仍 false；**adapter dispose 未被调用**——它在 drainStep 的 `await revoke()` 之后，串行链上尚未轮到 | 红灯旁证锚 `expect(shutdownSettled).toBe(false)` 期间探针零事件 |
| 5 | `saveGate.resolve()` → 写槽 S6 settle（fake-timer seam 下 saveDoc 面对活 adapter：`assertWritable` 通过、`scheduleFlush` 经 fake scheduler 武装成功）→ close barrier `handle.release()`（core 活，release 正常）→ close Promise settle → runShutdown 步骤 3/4 → **p resolve → `registry-shutdown-settled` 入 events**。〔生产真实 timer 下本步的写路径差异见 R5′：窗口内到达 saveDoc 的写会在 `scheduleFlush → ctx.timeout` 处 reject INACTIVE_EFFECT，写调用方收响亮 rejection；close barrier 经 sequencer 在写槽 settle（含 reject）后照常执行，release/close 不受影响〕 | §2.A/§2.B 及 registry.ts 冻结逻辑；R5′ |
| 6 | registry plugin disposer finally：revoke nomicoreRegistry → `instance=undefined` → registry fiber 卸载完成（PENDING） | plugin.ts 冻结逻辑 |
| 7 | `revoke()` 的 `Promise.allSettled([registryFiber.await()])` settle → provide disposal settle → drainStep 的 `await revoke()` 返回 → **`adapter.dispose()` 被调用 → `persistence-adapter-disposed` 入 events**（严格晚于步骤 5） | §5#2/#4/#5 |
| 8 | `core.dispose()`（abort/clear/await in-flight/snapshots.clear）→ `persistence-adapter-disposed-complete` → 串行链尾 runDisposable(revoke) join no-op → memory fiber 卸载完成 → `disposal` settle | §5#4/#5 |

终值断言逐一成立（**fake-timer seam 环境**）：`indexOf('registry-shutdown-settled')
< indexOf('persistence-adapter-disposed')` ✓；双探针恰一次（dispose 仅 drainStep
单点调用一次；revoke 的 join 是 no-op 不再触 dispose）✓；`p` resolve undefined
（seam 下排空全程 adapter 活：saveDoc/release 无一撞 `closed=true` → close 零失败 →
聚合空）✓。**「消灭」声明的精确边界（R2 修订）**：被本设计机制性消灭的是
round 1 SA7-P2 固化的「**close 撞已销毁 handle（adapter `closed=true`）→ close
聚合失败**」——该消灭对 fake-timer seam 与生产 timer **均成立**（adapter dispose
不先于 shutdown settle 是 wiring 级保证，与 timer 实现无关，SA2 实验 1 在真实
cordis 接线下证实）。生产真实 timer 下**另有**一个本机制无法消除、也非本票引入的
残余窗口（drain 窗口内在途写的 flush 武装 reject INACTIVE_EFFECT——写路径响亮
失败，交付写调用方；close/shutdown 终态不受影响）——其机制链、影响面与宿主规避
手段见 §8 R5′，不与「close 聚合失败消灭」混同。旧实例 `stopped`、service/instance
撤销、registry fiber `PENDING` 均为级联既有语义，零改动。

#### §2.C.4 ADR-0006 四条约束逐条核对（SA8 前置门禁条件）

| 约束 | 核对 |
|---|---|
| 1. 共享 lifecycle core 不复制状态机（:157-159/:196） | `PersistenceLifecycle` **零改动**（lifecycle.ts 不在改动面）。新增的是 Cordis **wiring** helper（service.ts，两 Adapter 单源共用）；状态机、entry/cell 协调、flush 调度一字未动 |
| 2. 只依赖 Cordis/Yjs/contracts（:83） | helper 仅新增 `provideNomicorePersistence`（本包 contract.ts）运行时导入 + 既有 `Context` 类型；零新依赖、零 DSH/NomicoreServer import |
| 3. 宿主职责不转嫁（:86） | 不要求宿主做新事：fiber 卸载路径的次序由插件自身 wiring 保证（Cordis 依赖图是宿主侧「按依赖逆序停止」的平台化承载——adapter 对齐同一逆序，正是把「依赖逆序」原则落实进自身 dispose 编排，而非转嫁）。宿主**直接**调用 `adapter.dispose()` 的编排语义与幂等性零变化（dsh-persistence profile 的「adapter 先、fiber 后」属宿主直调职权，见 §8 边界注记） |
| 4. service 面不变 | `DocPersistence`（createDoc/loadDoc/saveDoc）接口、`nomicoreRegistry`/`nomicorePersistence` service 值、`MemoryPersistence`/`FilePersistence` 公共方法签名（含 `dispose(): Promise<void>` 与幂等性）全部不变；改动仅在 `apply` 的内部 effect 结构 |

#### §2.C.5 plugin.ts 头注契约第 2 条改写（唯一 plugin.ts 改动，纯注释）

```ts
 * 2. **AC11 时序解读（rev1 强化：adapter 级真实保证）**：「先于 Persistence dispose」
 *    = adapter 级保证——persistence 侧共享 wiring（bindPersistenceAdapterLifecycle，
 *    packages/persistence/src/service.ts）把 service 撤销与 adapter dispose 纳入同一
 *    有序 effect：卸载时先撤 nomicorePersistence（delete store → notify → await
 *    全部依赖 fiber 卸载完成），后执行 adapter dispose。因此 Registry shutdown
 *    settle（含 handle.release 全程与 saveDoc 的 entry 断言）严格先于 persistence
 *    adapter dispose 开始（机制 = generator effect re-parent + 逆序串行 + provide
 *    disposer 的依赖 fiber join）；「close 撞已销毁 handle → shutdown 聚合失败」
 *    被消灭。fiber 级保证（Registry fiber 卸载完成先于 persistence fiber 卸载完成）
 *    仍由 inject 依赖图承载，且是 adapter 级保证的上游前提。
 *    ⚠️ 残余窗口（R5′，生产 timer 限定）：persistence fiber 自身 UNLOADING 的 drain
 *    窗口内，经 ctx.timeout 的新 flush/retry timer 武装抛 CordisError('INACTIVE_EFFECT')
 *    （真实 TimerService 语义，副作用绑定调用方 fiber）→ 窗口内到达 saveDoc 的在途写
 *    收到响亮 rejection（交付写调用方；close barrier 在写槽 settle 后照常执行，
 *    shutdown 终态不受影响）。需要写排空完整落盘的宿主：先 settle 依赖方（await
 *    registry shutdown / fiber 卸载）再拆 persistence fiber。fake-timer 测试 seam
 *    不经 ctx.effect，对该窗口结构性失明。round 1 的「fiber 级限定 + adapter 级残余
 *    并发（§8 R1）」声明废止（§8 R1 并发已根治；本窗口为 cordis fiber 状态门的
 *    独立残余，见设计 rev1 §8 R5′）。
```

（同文件 `inject` 行注释「依赖图边：AC11 时序保证的机制载体（§5#5/#8）」补一引
「rev1：adapter 级次序另经 persistence 侧有序 disposer 兑现（设计 rev1 §2.C）」。）

#### §2.C.6 挂起/死锁分析（防弹核对）

- **等待有界性**：drainStep 等待的是「依赖 fiber 卸载完成」。该等待的进展由同一
  卸载流驱动：`revoke()` 的 notify **就是**触发依赖 fiber 卸载的机制——被等的对象
  由等待的发起者启动，无第三方推进依赖、无循环等待（registry fiber 卸载不等
  persistence fiber 卸载：其 disposer 只 await 自身 shutdown 与 nomicoreRegistry 的
  撤销，后者无依赖方）。
- **非新挂起类**：现状下 provide wrapper 本就以 `await Promise.allSettled(依赖
  fiber.await())` 阻塞 fiber 卸载（§5#2，round 1 既有行为）——依赖 fiber 永不 settle
  时 fiber 卸载**今天就会**挂起；本设计只把 adapter 资源释放挪到该既有等待之后，
  不引入任何新的「谁来推进」问题。
- **registry 排空不等待 persistence flush**：runtime close barrier 排空的是写槽
  （sequencer），其 S6 `await notifyDirty` = `saveDoc`（记账 + 调度 flush 后即返回，
  lifecycle.ts:277-287，**不 await io.write**——该「即返回」在 fake-timer seam 下于
  drain 窗口内同样成立；生产真实 timer 下窗口内 `scheduleFlush → ctx.timeout` 会
  throw 而非返回，见 R5′）；`handle.release()` 也不等待 flush
  （ADR-0006 :37 release = 通知，maybeEvict 只在 saved===dirty 时才即时回收）。故
  不存在「adapter dispose 等 registry、registry 排空等 flush、flush 等 adapter abort」
  的环。pending flush 定时器由 `core.dispose()` 的 `clearTimers` 取消（既有语义，
  红灯 29 中 fake timer 从未推进、inFlight 为空，dispose 即返）。
- **dispose/revoke rejection 的最终通道（R2 补写，SA2 攻击点 #3）**：drainStep 的
  `finally { await adapter.dispose() }` 保证 revoke disposal reject 时 adapter 资源
  仍被释放（不漏）；此后串行链 task 转 rejected → 链尾 `runDisposable(revoke)` 被
  `.then` 短路跳过（revoke 的 disposal 已在 `await revoke()` 内启动，无泄漏、无二次
  执行）→ 外层 wrapper 的 disposalTask reject → `_unload` 的 per-disposable
  try/catch 捕获 → `this.ctx.logger.error(reason)`（fiber.ts:676-686）。`adapter.dispose()`
  自身 reject 同路（经串行链上传）。**结局响亮、非静默**：失败进 cordis fiber 日志，
  fiber 卸载不因清理异常崩溃（与 round 1 既有行为同通道）。
- **在途 close 永挂起传导**（round 1 R3）：registry shutdown 挂起 → registry fiber
  卸载挂起 → provide disposal 挂起 → adapter dispose 延后。与 R3 冻结行为同向
  （「等待而非崩溃」），只是等待链延长至 adapter 释放——ADR-0008「不取消、不设内部
  timeout」的契约行为保持。
- **双路并发处置**：宿主先直调 `adapter.dispose()` 再拆 fiber（dsh-persistence
  profile 形态）——drainStep 的 `adapter.dispose()` 命中 `closed` 幂等分支
  （lifecycle.ts:314-318），零重复副作用；「unloads one Cordis service exactly
  once across repeated fiber disposal」（memory-persistence.test.ts:548-571）在
  重复 `ctx.fiber.dispose()` 下 join 同一卸载，serviceEvents 恒 1。
- **根级全拆**：root `_unload` 并发运行各子 fiber 的 dispose effect——memory fiber
  的 drainStep 等待 registry fiber 卸载，而 registry fiber 同时被 root 侧直接卸载：
  fiber 卸载单次执行、双触发 join（§5#5/§5#6），无重入。

### §2.D 上一轮冻结决策修订记录（brief 明文要求）

| 冻结决策（round 1 出处） | 处置 | 修订内容与理由 |
|---|---|---|
| §2.F 头注契约第 2 条：「先于 Persistence dispose」= fiber 级保证；adapter 级不保证 | **修订** | §2.C.5：提升为 adapter 级真实保证（spec 审查裁定 round 1 解读弱于 AC11 原文；SA8 放行 persistence 侧改动） |
| §8 R1：「残余并发……根治（persistence 将 adapter dispose 串行化进 provide disposer 之后）超出本票 DENY 边界，建议后续票」+ 开放问题 2 | **修订（根治落地）** | 本轮即为该「后续票」：串行化落点 = service.ts 共享 wiring（§2.C.2），形态恰为 R1 预言的「adapter dispose 串行化进 provide disposer 之后」 |
| §4 DENY LIST：`packages/persistence/**` | **解除（窄边界）** | rev1 边界 = `persistence/src/{service,memory,file}.ts` 的 wiring 三文件 + `persistence/package.json`（patch bump）；`lifecycle.ts`/`contract.ts`/`index.ts`/`testing.ts` 仍禁（ADR-0006 约束 1/4 的落点）。SA8 前置门禁 verdict=clear 为放行依据 |
| §5#6 机制事实「跨 fiber 卸载无严格串行」 | **保留** | 事实陈述仍真；其工程后果（adapter dispose 并发先行）由 §2.C 的 effect 内有序化抵消（re-parent 使二者同 fiber 内串行） |
| §2.B I1/I2/I4、§2.C 四通道、§2.D 三相迁移/幂 same-Promise/双通道恰一次、§2.F plugin 代码 | **保持** | P1/P2 均为框架内补同步 throw 路径（P1 补发起段收编、P2 扩展四通道到同步 throw），状态机、不变量、双通道语义零修订；plugin.ts 代码零改动（仅注释） |

---

## §3. 不变量与 13 AC 不回归矩阵

**不变量**：I1（idle ⟺ 武装；shutdown 豁免窗口）零触碰——P2 不改武装/取消逻辑；
I2（closing ⟹ closePromise 定义）**强化**——同步 throw 路径同样先落位（rejected
Promise）后翻相，同一同步段；I4（arm-token 判别）零触碰——token 收缴语句次序不变；
removeOnlySelf 双守卫、carrier 三条件清理、幂 same-Promise（shutdown/release）全部
零触碰。

| AC | 影响分析 |
|---|---|
| 1 service 面 | plugin.ts 代码零改动；service 名/instance 语义不变 ✓ |
| 2 config | 零触碰 ✓ |
| 3 强依赖 | 零触碰（helper 在依赖断言之后执行，断言次序不变）✓ |
| 4 idle 武装/重置 | 零触碰（P2 只改 close 发起段）✓ |
| 5 idle/open 交互 | closing 语义扩展为含 rejected closePromise——closing-wait 分支 `await closePromise`（catch 吞）+ recheck 移除 → 新 generation，既有测试 8/9 行为不变（rejection 与同步 throw 同态）✓ |
| 6 timeout=0/fatal 同语义 | 零触碰 ✓ |
| 7 idle-close failure 四通道 | 结构不变，通道扩展到同步 throw（§2.B 表）；既有 11（rejection）不受影响 ✓ |
| 8 getStatus 三相 | P1 使 stopped 恒可达（同步 throw 不再卡 shutting-down）——是强化非回归 ✓ |
| 9 停接纳/取消 timer/等待已接纳/不等外部 release | runShutdown 仅改发起分支；步骤 1（carrier 等待）与同步段零触碰 ✓ |
| 10 复用/全尝试/稳定聚合 | 复用分支零触碰；全尝试从「rejection 不跳过」强化为「同步 throw 亦不跳过」；聚合错误形状/文案/failures 冻结结构零改动（19b 与 15a/18/19 共同锚定）✓ |
| 11 有序 disposer 先于 Persistence dispose | **本轮强化对象**：registry plugin 有序 disposer（shutdown → 撤 service）零改动；persistence 侧兑现 adapter 级次序（§2.C）✓ |
| 12 幂等 same-Promise | 零触碰（P1 不改 shutdown() 同步段缓存逻辑）✓ |
| 13 确定性/全量/CI | 改动纯 TS、零新依赖、零 real sleep；typecheck/test/Node 20/24 面不变 ✓ |

---

## §4. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-registry/src/registry.ts` — 修改，P1 runShutdown 发起段 try/catch + 即刻空 catch（§2.A，≤10 行）、P2 beginIdleClose try/catch（§2.B，≤8 行）；其余零触碰
- `packages/namespace-registry/src/plugin.ts` — 修改，**仅注释**：头注契约第 2 条改写 + inject 行补引（§2.C.5，≤18 行注释，零代码变更）
- `packages/persistence/src/service.ts` — 修改，新增 `bindPersistenceAdapterLifecycle` 共享 wiring helper（§2.C.2，≤45 行含文档注释；新增 contract.js 运行时导入）
- `packages/persistence/src/memory.ts` — 修改，apply 改用 helper + import 清理（§2.C.2，≤8 行）
- `packages/persistence/src/file.ts` — 修改，apply 改用 helper + import 清理（§2.C.2，≤8 行）
- `packages/namespace-registry/package.json` — 修改，patch bump 0.1.2 → 0.1.3（简报执行约束）
- `packages/persistence/package.json` — 修改，patch bump 0.2.0 → 0.2.1（简报执行约束）
- `packages/namespace-registry/test/registry-shutdown.test.ts` — `[SA6 owned]` 已交付红灯 19b（SA6 红灯契约；断言逻辑 SA3 不改）
- `packages/namespace-registry/test/registry-idle.test.ts` — `[SA6 owned]` 已交付红灯 11b
- `packages/namespace-registry/test/registry-plugin.test.ts` — `[SA6 owned]` 已交付红灯 29
- `packages/namespace-registry/test/registry-sa7-cordis.test.ts` — `[SA6 owned]` 已交付 SA7-P2 改写（旧假设移除）
- `wiki/raw/task_registry-idle-plugin-shutdown-rev1*.md` — 本设计与后续评审记录

### DENY LIST

- `packages/persistence/src/lifecycle.ts`、`src/contract.ts`、`src/index.ts`、`src/testing.ts` — 共享 core 状态机与 service 契约面零增量（ADR-0006 约束 1/4 落点；路径乙拒绝的必然结论）
- `packages/namespace-registry/src/{types,errors,observer,lease,testing,index,identity,create-document}.ts` — P1/P2 是 registry.ts 内部收编，公共面/事件面/注入面/导出面零增量
- `packages/namespace-runtime/**` — close 契约已冻结（#92），internal subpath 不动
- `packages/clock/**`、`packages/dsh-persistence/**` — DSH 接线与 profile 宿主直调编排属后续票/宿主职权（§8 边界注记）
- `packages/vfsl*/**`、`packages/doc-runtime/**` — 无关
- `docs/**`、根 `package.json`、`.github/workflows/**` — ADR 无修订需求（本设计是 ADR 既有条款的兑现而非推翻）；CI 矩阵已就位

---

## §5. 协议假设依据 (Protocol Assumption Evidence)

本会话设计期亲核 Cordis 4.0.1 **随包发布 TS 源码**
（`node_modules/.pnpm/@deepseek-ai+cordis@4.0.1/node_modules/@deepseek-ai/cordis/src/`）
与 Node 官方文档。round 1 §5 表 #1-#8 的事实本次全部复核成立（其中 #3/#4/#5/#6
原引 `lib/index.js` 构建产物，本次改引语义相同的 `src/*.ts` 并补精确行为）；
#9-#11 为 rev1 新增。

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| 1 | fiber `_unload` 以 `Promise.all(this._disposables.clear().map(...))` 并发运行本级 disposables | 源码引用 | `src/fiber.ts:675-687` `private async _unload()`：`await Promise.all(this._disposables.clear().map(async (dispose) => { … await runDisposable(dispose) … }))`；`src/utils.ts:27-31` `clear()` 返回 `values.reverse()`（只决定启动序） | 低（已亲核；红灯 29 事件序为其直接观测） |
| 2 | `ctx.provide` disposer =「delete store → notify → `await Promise.allSettled(fibers.map(fiber => fiber.await()))`」——依赖 fiber 卸载完成先于 provide disposal settle | 源码引用 | `src/reflect.ts:277-304` `provide(name, value, check)` 返回的 effect disposer 逐字：`delete this.store[key]; const fibers = this.notify([name]); await Promise.allSettled(fibers.map((fiber) => fiber.await())); delete this.ctx.fiber.store![name]`；`notify` 只遍历 `name in fiber.inject` 的 fiber | 低 |
| 3 | generator effect 内 `yield` 的 disposer 被 re-parent：`disposables.push(dispose); this._disposables.delete(dispose)`——离开 fiber 级并发清单，进入外层 effect 有序表 | 源码引用 | `src/fiber.ts:445-452` `runner.collect` 实现（`_execute` 的 iterator 分支 `safeCollect(result.value)` 逐 yield 收集，fiber.ts:388-396） | 低 |
| 4 | effect 本地 disposables 按收集序**逆序串行**执行：`disposables.splice(0).reverse()` + `task = task.then(() => runDisposable(disposable))` 链式 | 源码引用 | `src/fiber.ts:421-436` effect 内 `dispose()` 闭环；`fiber.d.ts` Effect 文档「generator effects register each yielded disposer as it is produced / Disposers run in reverse registration order … they may be async, in which case unloading awaits them」 | 低 |
| 5 | wrapper 单次执行 + join：`dispose()` 有 `if (disposing) return disposalTask` 单次守卫；`runDisposable` 经 `effectInertia` join 他人已启动的清理。**直启 + 全程等待的两条路径区分（R2 修正归因）**：① **调用路径**（`await revoke()` = 先调用后 await 返回值）：直接调用体在 epoch 未翻转时 `finalizeDisposal(dispose)` 启动 disposal 并返回 inFlight promise，`await` 等的是该**返回值**（全程等待）；epoch 已翻转时调用体返回 `undefined`（除 setupFailed）——**不 join**。② **thenable 路径**（裸 `await revoke` / 把 wrapper 本身当 thenable）：`.then` 覆写（`Promise.resolve(task).then(() => disposeAsync)`）→ `disposeAsync` 在 epoch 未翻转时启动并返回 inFlight（全程等待）；已翻转时返回 `undefined`——同样**不 join**。完整 join 语义只在 `runDisposable` 路径（`effectInertia.get(wrapper)?.()` 恒返 inFlight） | 源码引用 | `src/fiber.ts:421-428`（单次守卫）、`116-120`（`runDisposable` + `effectInertia`，注释原文「structural owners and outer effects must still be able to join a cleanup that another caller started」）、`544-548`（`wrapper.then` 覆写——服务 thenable 路径）、`543`（`disposeAsync`）、`494-501`（wrapper 体：epoch 翻转后直接调用返 undefined） | 中（两路径在「已启动」态均不 join——故 §2.C.2 必须 yield re-parent（保证 drainStep 先行、串行链外无人提前启动 wrapper），不能依赖 fiber 级并发清单里的显式 `await revoke()`；设计已按此收敛。本设计 helper 内 `await revoke()` 走①调用路径：re-parent 后 wrapper 未启动 → 直启 + 全程等待） |
| 6 | `MemoryPersistence.apply`/`FilePersistence.apply` 现状将 provide wrapper 留在 fiber 级清单（未 re-parent）——与 adapter dispose effect 并发 | 源码引用 | `persistence/src/memory.ts:104-111`、`file.ts:89-96`（`ctx.effect(() => { provideNomicorePersistence(ctx, this); return () => this.dispose() })`，普通函数 effect 不 yield provide wrapper） | 低（即缺陷本体） |
| 7 | registry plugin 有序 disposer（shutdown → 撤 service）已按 yield re-parent + 逆序串行实现——persistence 侧改造的同构先例在仓内可运行验证 | 源码引用 + 现有测试 | `namespace-registry/src/plugin.ts:159-177`；`registry-plugin.test.ts` 25/26/28a 全绿基线 | 低 |
| 8 | runtime close barrier 排空写槽（sequencer）而 `saveDoc` 不等待 flush；`handle.release()` 不等待 flush | 源码引用 | `persistence/src/lifecycle.ts:277-287`（`saveDoc`：记账 + `scheduleFlush` 即返回）、`511-516`（`releaseHandle` → `maybeEvict` 仅 saved===dirty 时回收）；ADR-0006 :37 release 语义（relevant_decisions 摘录） | 低（§2.C.6 无死环论证的基础） |
| 9 | rejected Promise 若在创建的同一微任务排空周期内未被挂 handler，Node 在该 tick 结束的 rejection 检查点触发 `unhandledRejection` | 官方文档引用 | Node docs（Process: `'unhandledRejection'`）："The unhandledRejection event is emitted whenever a Promise is rejected and **no error handler is attached to the Promise within a turn of the event loop**" | 低（§2.A 即刻空 catch / §2.B 同步段挂接的直接依据） |
| 10 | `ctx.effect(function* …)` 类型契约接受 `Iterable<Disposable, void, void>`（Generator 满足）；label 参数进入 `getEffects()` 诊断元数据 | 源码引用 | `src/fiber.ts:79-83`（`SyncEffect = Disposable | Iterable<Disposable, void, void>`）；plugin.ts:159 同款已通过全量 typecheck | 低 |
| 11 | `notify` 触发的依赖 fiber 卸载单次执行，多个等待者（root 直拆 + provider 级联）join 同一卸载（fiber `inertia` 单实例） | 源码引用 | `src/fiber.ts:283/635/669`（`this.inertia = this._unload()` 幂等赋值）、`async await()` 循环 `while (this.inertia) await this.inertia`（fiber.ts:690-696） | 低 |
| 12 | **（R2 新增，SA2 攻击点 #1 的缺失假设）**生产真实 TimerService 下，`ctx.timeout`（→`this.ctx.effect`）的副作用**绑定调用方 fiber**；调用方 fiber 处于 `UNLOADING` 时 `fiber.effect()` 显式 throw `CordisError('INACTIVE_EFFECT')`。fake-timer 测试 seam（纯对象 service）不经 `ctx.effect`，对该行为结构性失明 | 设计期实测验证 + 源码引用 | SA2 实验 2（`node /tmp/sa2-cordis-unloading-probe.mjs`：`memoryFiber state in window (5=UNLOADING): 5`、`ctx.timeout during OWN fiber UNLOADING threw: Error: cannot create effect on inactive context`）；`cordis-plugin-timer/src/index.ts:35-42`（`timeout` 经 `this.ctx.effect` 注册）；`src/utils.ts:163-170`（traceable 服务副作用绑定 caller，原文「Non-noShadow services strip — their side effects bind to caller, not origin」）；`src/fiber.ts:418-421`（`effect()` 对 `state === UNLOADING` throw）；`persistence/src/testing.ts:158-193`（fake `timeout` 纯箭头函数零 ctx.effect） | 中（已按此修订 §2.C.3/§2.C.6/§8 R5′ 的环境限定；根因处置出票边界见 R5′） |

无 HTTP/WS/端口类协议假设；本表覆盖本设计全部第三方运行时行为假设。

---

## §6. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/签名

| 函数/方法 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `runShutdown`（内部，不导出） | `namespace-registry/src/registry.ts` | close 发起同步 throw → 裸原因 reject、枚举中断、终态不可达 | 同步 throw 合成 rejected Promise 进聚合；`shutdown()` 对外契约（`Promise<void>` / reject `NamespaceRegistryShutdownError` / same-Promise）**不变** |
| `beginIdleClose`（内部，不导出） | `namespace-registry/src/registry.ts` | close 同步 throw 逃出 timer 回调 | 收编为 rejected closePromise；对外契约（open/create/observer 面）**不变** |
| `MemoryPersistence.apply` / `FilePersistence.apply` | `persistence/src/{memory,file}.ts` | 注册 service + adapter dispose 为 fiber 级并发 disposables（卸载时并发执行） | 注册 service + **有序** disposer（卸载时：撤服务 → await 依赖 fiber settle → adapter dispose）。方法签名、service 值、`dispose()` 直调语义与幂等性**不变**；仅 fiber 卸载路径的 dispose **时点**后移 |
| `plugin.ts` 头注 | `namespace-registry/src/plugin.ts` | 契约第 2 条 = fiber 级限定 | 文本改为 adapter 级保证（纯注释） |

**公共 API 零签名变更**：无 `return → throw`、无 async 化、无 catch 语义翻转、无
nullable 翻转——P1/P2 是纯内部收编，P3 是纯 wiring 时序。

### Caller 清单

| Caller | 文件:位置 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| `registry.shutdown()` 全部 caller（plugin 有序 disposer；测试 19/19b/20/25/26/27/29/SA7-P2 等） | `plugin.ts:170`；4 个测试文件 | await | ✅ plugin disposer `try/finally`；测试侧 `.then(,err=>)`/`rejects` matcher | cordis `_unload` catch→`ctx.logger.error`；vitest | 契约不变；P1 只是把「同步 throw 逃逸为裸原因」修正为「聚合错误」——19b 断言即目标态；20 的 rejected same-Promise 复用不变 |
| `beginIdleClose` 唯一 caller（idle timer 武装闭包） | `registry.ts:588-596` | N/A（同步回调） | ❌（修复后无需） | 修复前依赖 scheduler 吞异常（fake scheduler 会 reject——红灯即此） | §2.B 使回调零逃逸；I4 token 判别先行，ABA/phase 守卫不变 |
| `MemoryPersistence.apply` caller：`createMemoryPersistencePlugin`、直调测试、DSH profile | `memory.ts:139-151`；`memory-persistence.test.ts:559`；`dsh-persistence/src/profile.ts:62` | N/A（同步 apply） | apply 栈（断言 throw → fiber FAILED/宿主观察） | cordis | 行为增量 = 卸载时 dispose 时点后移；「exactly once across repeated fiber disposal」由 join 语义保持（§2.C.6）；profile 的宿主直调 `dispose()` 先行时命中幂等分支 |
| `FilePersistence.apply` caller：`createFilePersistencePlugin`、file 测试 | `file.ts:158-166`；`file-persistence.test.ts` | N/A | 同上 | cordis | 同上（label 'file-persistence: service' 不变） |
| `nomicorePersistence` 服务消费方（inject 声明方） | `namespace-registry/src/plugin.ts:149`（唯一仓内消费方） | — | — | — | 服务值/形状不变；卸载级联次序为其受益方（P3 目标） |
| `adapter.dispose()` 直调 caller | `dsh-persistence/src/profile.ts:108`、persistence 各测试 | await | 测试/profile 自有 | vitest | `dispose()` 公共语义（abort → clear → await in-flight → 幂等）零变化 |

抓全方法（已执行）：`grep -rn "registry.shutdown\|\.shutdown()" packages/namespace-registry/{src,test}`；
`grep -rn "apply(ctx)\|\.apply(" packages/persistence/src packages/persistence/test packages/dsh-persistence/src`；
`grep -rln "createMemoryPersistencePlugin\|createFilePersistencePlugin\|nomicorePersistence" packages apps domains --exclude-dir=node_modules`。

### 风险评估

- 遗漏 caller 的代价：P1 若漏掉某个 shutdown caller 的 rejection 处理——本轮 shutdown
  reject 路径在 round 1 已全量落地（SA4 §1.5 已审），P1 不新增 reject 通道，只是把
  「逃逸裸原因」并入既有聚合错误，caller 面零扩张。P3 的 dispose 时点后移若被某测试
  断言「dispose 已发生」于依赖方 settle 前——已核 persistence 侧测试（559-571 行用例
  语义为「重复卸载恰一次」，join 语义下保持）；DSH profile 断言 dispose 幂等非时点。
- 最大残余风险：第三方宿主依赖「persistence fiber 卸载开始即 adapter 已释放」——
  该时序从未是契约（ADR-0006 :86 宿主逆序职责），且仓内无此依赖（§6 caller 清单）。

---

## §7. 测试锚与回归面

### 红灯 → 设计条款映射（修复后必绿）

| 红灯用例 | 断言核心 | 设计条款 |
|---|---|---|
| 19b（registry-shutdown） | ①聚合错误收录同步 cause 恰一次（`instanceof NamespaceRegistryShutdownError`、`failures[0].cause === syncCause`）；②k1/k2 `closeCalls` 均 1；③`getStatus()==={state:'stopped'}` | §2.A 裁决 1/2/3 |
| 11b（registry-idle） | ①`advanceBy` settle（不逃出回调）；②`idle-close-failed` exact cause 恰一次；③entry 移除 → `loadCalls===2`、新 Runtime；④零 unhandled rejection | §2.B 四通道表 ①-④ |
| 29（registry-plugin） | `registry-shutdown-settled` 严格先于 `persistence-adapter-disposed`；双探针恰一次；旧实例 stopped/撤销/PENDING；`p` resolve undefined；零 unhandled | §2.C.2 + §2.C.3 trace（**fake-timer seam 环境**——`p resolve` 与写槽成功断言以 seam 为限，生产窗口差异见 §8 R5′；次序断言本身两种 timer 均成立，SA2 实验 1） |
| SA7-P2 改写（registry-sa7-cordis） | 同上次序契约（SA7 套件视角）；「close 撞已销毁 handle → 聚合失败」旧预期删除 | §2.C.2/§2.C.3（**close 聚合失败**被机制性消灭——对两种 timer 均真；生产 timer 的写路径残余窗口另见 R5′，不混同） |

### 既有 150 绿用例回归面（逐处影响分析）

**环境限定（R2，SA2 攻击点 #1）**：下述含 cordis 组合的用例（registry-plugin 全部、
SA7-P2/P3 等）均运行于 fake-timer seam——其断言在 seam 下有效；生产 timer 的 drain
窗口写路径差异（R5′）不在这些用例的覆盖声明内，亦不被它们证伪（seam 结构性失明）。

- **registry-plugin 25/27/28/28a**：registry fiber 自身卸载路径，persistence 侧 wiring
  不参与（25 用 root 级 stub provide，27 用 stub，28/28a 用 timer/persistence 组合的
  PENDING 门）——零影响。**26**：`['registry-shutdown-settled','persistence-fiber-dispose-settled']`
  次序保持（disposal settle 现在还包含 adapter dispose，仍在 shutdown settle 之后）；
  根级全拆/零 unhandled 由 join 语义保持。
- **registry-shutdown 15a/18/19/20**（rejection 聚合、复用在途 close、same-Promise）：
  复用分支与聚合循环零改动；P1 只影响 `closePromise === undefined` 的发起分支。
- **registry-idle 10/11/12**（idle 武装、rejection 四通道、never-settle）：P2 只在
  `runtime.close()` 抛错时改变行为（原为逃逸，现为收编）；rejectWith/neverSettle/gate
  路径逐字不变。
- **registry-sa7-cordis P1/P3/P4、registry-node-dispose、registry-open/create/surface、
  sa7-hostile/concurrency**：不触及三处改动点（P1/P4 根级/级联卸载、hostile scheduler
  的 I4 判别均走既有逻辑）。
- **persistence 包全量测试**（memory/file/contract/lifecycle/issue-79/sa7）：
  `lifecycle.ts`/`contract.ts` 零改动；apply wiring 变更只影响「fiber 卸载时的 dispose
  时点」，`memory-persistence.test.ts:548-571`（恰一次卸载）经 §2.C.6 双路分析保持；
  直调 dispose 用例零影响；module-graph 回归（reverse-barrel/host-global timer）不触碰
  新增边。
- **dsh-persistence 包**：profile 直调编排零改动（宿主职权边界，见 §8）。

### SA3 实现注意（非测试改动）

1. §2.A/§2.B 的 try/catch 是仅有的 registry.ts 逻辑增量——不得顺手改写冻结次序
   （I4 收缴先行、I2 先落位后翻相、聚合循环/终态推进语句逐字保持）。
2. §2.C.2 helper 的 yield 次序与 try/finally 形状是机制要件（§5#4/#5），不得简化为
   普通函数 effect 或调换 yield 序。
3. memory.ts/file.ts 的 `provideNomicorePersistence` import 清理须同步（否则残留
   unused import 挂 typecheck）。
4. 两包 package.json patch bump（0.1.3 / 0.2.1）。
5. plugin.ts 头注第 2 条按 §2.C.5 **R2 修订版**落纸（含 R5′ 残余窗口段与宿主规避
   手段）；service.ts helper 文档注释按 §2.C.2 **R2 修订版**落纸（含宿主接线契约
   段与 ADR 引用勘误：ADR-0006 :86 + ADR-0009 :103）。

### R2 增补测试思路（可选，SA3/SA6 裁量——SA2 攻击点 #4）

以下用例不在本轮红灯验收面内（4 红灯用例已足锚定三项缺陷）；作为加固建议记录，
落地与否由 SA3/SA6 决定（测试文件均已在 ALLOW LIST 的 `[SA6 owned]` 边界内）：

1. **19c（多 entry 全同步 throw）**：k1/k2 均 `syncThrowWith`（不同 cause 实例）→
   断言 `failures.length===2`、`failures[0].cause===cause1`、`failures[1].cause===cause2`
   （次序 = Map 插入序）、每 cause 恰一次、`getStatus()==={state:'stopped'}`、双
   `closeCalls===1`、零 unhandled rejection——把「同构聚合 + 插入序 + 恰一次」在
   多同步 throw 下钉死（19b 只锚单 entry）。
2. **effect-faithful timer stub（R5′ 残余窗口契约化）**：fake timer service 的
   `timeout` 改为经 `ctx.effect` 注册到**调用方 fiber**（复刻真实 TimerService 的
   caller-binding + UNLOADING throw 语义，§5#12），复用测试 29 门控手法 → 断言：
   ① 窗口内放行的写 promise reject 且 cause 为 `CordisError('INACTIVE_EFFECT')`
   （或实现后声明的稳定形态）；② `p`（shutdown）终态与 R5′ 声明一致（close 不受
   写失败影响 → resolve undefined）；③ 零 unhandled rejection；④ 次序断言
   （`registry-shutdown-settled` < `persistence-adapter-disposed`）仍成立——把
   残余窗口从未定义行为钉成声明式契约。
3. **11c（P2 phase 守卫防误伤，可选）**：同步 throw entry 在 throw 前已被并发 open
   激活（phase ≠ idle）→ 断言 `closeCalls===0`、open 复用同 Runtime、零
   `idle-close-failed` 事件——锁死「结构性防御分支不被收编逻辑误伤」。

---

## §8. 风险与边界

- **R1′（残余时序窗口）宿主直调编排不在保证内**：`dsh-persistence` profile 的
  `dispose()`（先 `persistence.dispose()` 后 `ctx.fiber.dispose()`）是宿主直调职权
  （ADR-0006 :86「宿主负责按依赖逆序停止插件」）；若未来 DSH 宿主把 registry plugin
  接进 profile.ctx 并依赖 profile.dispose() 的既有次序，需后续票调整 profile 编排
  （当前 `git grep` 仓内无此接线——apps/domains 零消费方，已核）。fiber 卸载路径
  （AC11 的规范路径）已由本设计保证。
- **R2′ adapter dispose 后移的可用性观感（R2 修订：按 timer 实现分层表述）**：
  依赖 fiber 卸载完成前 adapter 的 `getStatus()` 恒 `ready`、core 未 `closed`
  ——这是次序契约的**目的态**（close 排空期 entry 断言/release 全程面对活 adapter），
  非缺陷。但「saveDoc 仍可写入」的完整成立**仅在 fake-timer 测试 seam 下**：
  生产真实 timer 下 drain 窗口内新 dirty notification 的 flush 武装会 reject
  （见 R5′）。getStatus 在 drainStep 前不受影响。
- **R3′ 在途 close 永挂起传导延长**（round 1 R3 同源）：registry shutdown 挂起 →
  adapter dispose 延后。ADR-0008「不取消、不设内部 timeout」契约行为保持；等待而非
  崩溃。
- **R4′ 测试基础设施**：无新依赖、无端口、无脚本改动；红灯 4 用例已由 SA6 交付
  （当前工作区未提交，SA3 落地时随实现一并提交）。
- **R5′（R2 新增，SA2 攻击点 #1）生产 timer 下 drain 窗口内在途写的 flush 武装
  残余失败**：
  - **触发面**：persistence fiber 自身处于 `UNLOADING`（= 本设计 drainStep 的等待
    窗口：从 `memoryFiber.dispose()` 起、到 drainStep 末尾 `adapter.dispose()` 止）
    且有在途写的 S6（`saveDoc`）在窗口内到达。
  - **机制链（SA2 实验 2 实测 + 源码亲核，本会话复核）**：memory adapter 的
    scheduler 由 `createCordisPersistenceScheduler(ctx)` 捕获 memory fiber 自己的
    ctx（memory.ts:145）；真实 TimerService 的 `timeout` 经 `this.ctx.effect`
    注册（cordis-plugin-timer/src/index.ts:35-42），而 cordis traceable 服务的
    副作用**绑定调用方 fiber**（utils.ts:163-170「Non-noShadow services strip —
    their side effects bind to caller, not origin」）→ memory fiber `UNLOADING`
    态下 `fiber.effect()` 显式 throw `CordisError('INACTIVE_EFFECT')`
    （fiber.ts:418-421）→ `core.saveDoc` 的 `scheduleFlush` 同步武装路径抛错
    （lifecycle.ts:518-531，无 fiber 状态守卫）→ `saveDoc` promise reject →
    写槽 S6 reject → **写调用方收到响亮 rejection（exact cause =
    INACTIVE_EFFECT）**——交付通道 = 写 promise（`mutateRoot`）本身 reject 归其
    调用方、不进 shutdown 聚合，与 ADR-0009:101「open/create 自身的结果只交付
    原调用者，不重复进入 shutdown aggregation」的冻结纪律同型（写路径同理适用）。
  - **影响边界**：close barrier 经 sequencer 在写槽 settle（含 reject）后照常执行，
    `handle.release()` 面对活 core（`closed=false`）可成功 → close 照常 settle →
    **shutdown 终态不受该失败影响**（聚合只收 close rejection）；零 unhandled
    rejection（写 promise 归写调用方）。失败类别**响亮、非静默**。
  - **与 round 1 对比（窗口收窄而非消灭写路径失败）**：round 1 的失败因是 adapter
    已销毁（`'persistence is disposed'`，M-C）且其后果进 **close 聚合失败**——rev1
    机制消灭的是该类（close 撞已销毁 handle）；残余的是「flush 武装不可用」类写路径
    失败，其根因是 cordis fiber 状态门对 UNLOADING fiber 上新建 effect 的禁止——
    **非本票 dispose 编排可消除**（与 dispose 时序无关：即便 adapter dispose 更早或
    更晚，`ctx.timeout` 在 UNLOADING 态一律 throw）。
  - **测试 seam 失明（结构性的）**：`createFakeTimerPlugin`（persistence/src/
    testing.ts:158-193）的 service 是纯箭头函数对象，`timeout` 直接进 fake
    scheduler、不经 `ctx.effect`——红灯 29/SA7-P2 在 seam 下的「写槽成功 + p
    resolve undefined」断言**有效且不受影响**，但该行为**不可外推为生产契约**。
  - **宿主规避手段**：需要写排空完整落盘的宿主（生产 teardown），先 settle 依赖方
    再拆 persistence fiber——例如先 `await registry.shutdown()`（或 `await
    registryFiber.dispose()`）再 `await memoryFiber.dispose()`；根级一把全拆
    （`ctx.fiber.dispose()`）时窗口同样存在（各子 fiber 并发卸载）。
  - **出票边界声明**：让 flush 武装在 UNLOADING 窗口内存活（如 scheduler 所有权
    迁移到独立长命 fiber、或 lifecycle core 引入绕过 fiber 状态的武装通道）需触及
    共享 lifecycle core 的调度所有权——受 ADR-0006 共享 core 纪律约束，超出本票
    （SA8 放行边界 = wiring 三文件），建议后续票；本票以本条 + §2.C.5/§2.C.2
    契约注记显式声明该残余窗口。可选的「effect-faithful timer stub」契约测试
    （把残余行为钉成声明式契约）见 §7 R2 增补，归 SA3/SA6 裁量。

---

## SA2 反馈逐条回应（R2）

评审来源：`wiki/raw/task_registry-idle-plugin-shutdown-rev1_sa2_review.md`（verdict:
reject；机制主体全部通过，修订面 = #1 HIGH 文本/契约层 + #2/#3 LOW 顺手 + #4 LOW
可选）。逐条落实：

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1 HIGH：P3「排空期 saveDoc 可用 / 聚合失败被机制性消灭」声明在生产 timer 下不成立（UNLOADING 窗口内 `ctx.timeout` → `ctx.effect` throw `INACTIVE_EFFECT`；fake-timer seam 结构性失明）——按建议 (a)+(b) 修订 | ✅ | §2.C.3（环境限定段 + 步骤 5 内注 + 终值断言「消灭声明的精确边界」）、§2.C.6（第三弹 seam/生产分层）、§2.C.5（头注改写补 R5′ 残余窗口段 + 宿主规避手段 + seam 失明声明）、§2.C.2（helper 宿主接线契约注记）、§8 R2′（按 timer 实现分层表述）+ **§8 R5′ 新增**（触发面/机制链/影响边界/与 round 1 对比/seam 失明/宿主规避/出票边界七段）、§5 **#12 新增**（补上被实测证伪的缺失假设：caller-fiber 绑定 + UNLOADING throw + seam 失明，附 SA2 实验 2 与四处源码引用）、§7（红灯映射两行加 seam 限定 + 回归面环境限定段） | (a) 全部泛化声明改为「fake-timer seam 环境」显式限定；「消灭」精确化 = close 聚合失败类消灭（两种 timer 均真，SA2 实验 1），生产 timer 写路径残余失败单列 R5′（不混同）；(b) plugin.ts 头注（§2.C.5）与 service.ts 宿主契约注记（§2.C.2）均补记窗口、出票理由与宿主规避（先 settle 依赖方再拆 persistence fiber） |
| #2 LOW：§5#5 归因措辞——`await revoke()` 等的是 wrapper 调用**返回值** vs `.then` 覆写服务 thenable-await 路径，两条路径区分写清 | ✅ | §5#5（两条路径分别列写：调用路径返 inFlight / 已启动返 undefined 不 join；thenable 路径 disposeAsync 同型；完整 join 仅 runDisposable 路径）、§2.C.1 第 3 条（同步修正）、§2.C.2 helper 代码内注释 | 归因逐路径澄清，load-bearing caveat（必须 yield re-parent）保留并强化为「两路径在已启动态均不 join」 |
| #3 LOW：§2.C.6 补写 dispose/revoke rejection 的最终通道 | ✅ | §2.C.6 新增末弹 | 最终通道 = cordis `_unload` per-disposable catch → `ctx.logger.error`（fiber.ts:676-686）；串行链短路无泄漏/无二次执行；响亮非静默 |
| #4 LOW（可选）：增补 19c 与「effect-faithful timer stub」残余窗口契约用例思路 | ✅（以「可选、SA3/SA6 裁量」记录） | §7「R2 增补测试思路」 | 19c（多 entry 全同步 throw：failures 插入序/恰一次/stopped/零 unhandled）、effect-faithful timer stub（caller-binding + UNLOADING throw 复刻，断言写 reject INACTIVE_EFFECT + p 终态与 R5′ 声明一致 + 次序仍成立）、11c（P2 phase 守卫防误伤） |
| SA8 复审非阻塞勘误：§2.C.2 helper 注释「ADR-0006 :103」系笔误，应引 ADR-0009:103 | ✅ | §2.C.2 helper 文档注释首行 + §7 SA3 实现注意第 5 条 | 改为「ADR-0006 :86 宿主逆序停止职责 + ADR-0009 :103 Plugin dispose 有序 disposer」 |

**修订边界自检**：R2 未触碰机制主体（helper yield 序/try-finally 形状、registry.ts
两处 try/catch、ALLOW/DENY 清单边界均与 R1 相同）；全部修订落在设计文本、契约注释
措辞与风险登记层。一致性自检已执行（`grep -n "fiber 级\|adapter 级\|R5′\|INACTIVE_EFFECT"`——
「消灭」声明在 §2.C.3/§7/R5′ 三处均限定为 close 聚合失败类；「saveDoc 可用」在
§2.C.3 步骤 5/§2.C.6/§8 R2′ 三处均带 seam/生产分层限定）。
