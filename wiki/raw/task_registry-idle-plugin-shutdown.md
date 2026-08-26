# Issue #112 冻结设计：namespace-registry idle retention、Cordis plugin 与 ordered shutdown

- Parent PR：#105（docs/namespace-registry）
- 设计权威：ADR 0009（空闲保留 / Shutdown / 模块与 Cordis service 节）；Phase 4 范围（`docs/phases/phase-4-namespace-registry.md`）
- 前置切片：#110（open/唯一 Runtime/NamespaceLease/carrier FIFO）、#111（排他 create 与完整初始 generation）
- 基线：`packages/namespace-registry` @ e1efbbe（registry.ts 817 行，shutdown 为占位，无 idle）

---

## §1. 需求理解与 AC 映射

本票补齐 ADR 0009 已冻结但未实现的三块：**idle retention**（最后 lease 释放后按 `idleTimeoutMs` 延迟 close，窗口内复用 Runtime）、**通用 Cordis plugin**（依赖 clock/timer/nomicorePersistence，发布 `ctx.nomicoreRegistry`，有序 dispose）、**Host shutdown**（三相状态机、停接纳、排空已接纳槽、关全部 Runtime、聚合 close 失败）。核心约束：Registry 核心保持 Host 无关（scheduler/clock 全注入，禁全局 timer/Date.now fallback），测试经确定性注入驱动时间与并发。

| AC | 内容 | 设计落点 |
|---|---|---|
| 1 | plugin 发布 `ctx.nomicoreRegistry`；包含核心/Adapter/testing subpath | §2.F、§2.G |
| 2 | config 仅 `idleTimeoutMs`，默认 300,000，0..2,147,483,647 有限整数 | §2.F（config 校验）、§2.A（resolveIdleTimeoutMs） |
| 3 | 强依赖 clock/timer/nomicorePersistence，缺失 loud fail 无 fallback | §2.F（assert + inject 双机制）、§5 |
| 4 | 最后 lease 释放→idle，`ctx.timeout()` 延迟 close；重进 idle 重置完整时限 | §2.B（状态机 + lease 回调） |
| 5 | idle 期 open 同步取消 timer 复用；timer 先转 closing 则 open 等待 close 后建新 generation | §2.B（runOpenSlot 冻结伪码） |
| 6 | timeout=0 仍异步调度；fatal/degraded Runtime 同 idle 语义 | §2.B |
| 7 | idle-close failure 零 unhandled rejection、不污染后续 open、进 observer | §2.C |
| 8 | getStatus 仅 running/shutting-down/stopped | §2.E |
| 9 | shutdown 同步停接纳（不访问新输入）、取消 idle timer、等已接纳槽结算、不等外部 release | §2.D |
| 10 | shutdown 复用在途 close Promise、关全部 Runtime、稳定聚合错误 | §2.D、§2.H |
| 11 | plugin 有序 async disposer：shutdown 完成后撤 service，先于 Persistence dispose | §2.F、§5（协议依据） |
| 12 | shutdown 与 release 幂等 same-Promise | §2.D、§2.K |
| 13 | 确定性时间/并发测试、全量 typecheck/test、Node 20/24 CI | §7、§2.L |

---

## §2. 冻结设计（A–M 逐条裁决）

### §2.A timeout 能力抽象（裁决 A）

**核心新增注入 seam（Host 无关，对齐 PersistenceScheduler 先例的 property-signature 形态，不共享 persistence 的类型——语义边界分离）**：

```ts
// types.ts（主入口可达声明图内；零 cordis、零运行时对象类型名）
export interface RegistryTimeoutScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}
```

**生产工厂 options 增量（`CreateNamespaceRegistryOptions`）**：

```ts
export interface CreateNamespaceRegistryOptions {
  readonly clock: Clock                      // 既有（#111 冻结，必需）
  readonly scheduler: RegistryTimeoutScheduler // 新增：必需（ADR-0009 禁系统 timer fallback）
  readonly idleTimeoutMs?: number            // 新增：可选，默认 300_000（resolveIdleTimeoutMs 校验）
  readonly observer?: RegistryObserver       // 既有
}
```

- `scheduler` 必需 + 构造期同步形状门禁（与 `assertClockShape` 同款纪律）：缺失/null/非 object/`setTimeout`/`clearTimeout` 任一非函数 → 同步 `TypeError`，稳定 message：
  `NAMESPACE_REGISTRY_SCHEDULER_REQUIRED: Registry 必须提供可调用的 setTimeout/clearTimeout 调度能力`（零回显传入值）。
- `idleTimeoutMs` 校验单点 `resolveIdleTimeoutMs(config)`（**定义在 registry.ts 并模块级导出**，plugin.ts 相对导入复用；不经 index 转出）。**默认值常量 `DEFAULT_IDLE_TIMEOUT_MS = 300_000` 同居 registry.ts 模块级导出（R1/M3 单点化：运行时定义点唯一在 registry.ts；plugin.ts 经相对通道 `./registry.js` import 后 re-export；index.ts 沿 plugin 链转出——两处导出均为 re-export，无第二定义点）**：
  - `undefined` → `DEFAULT_IDLE_TIMEOUT_MS = 300_000`；
  - `typeof !== 'number'` → `TypeError`，message 恒定：`NAMESPACE_REGISTRY_IDLE_TIMEOUT_TYPE: idleTimeoutMs 必须是 number（0..2147483647 有限整数）`；
  - number 但 `!Number.isInteger(v)` 或 `< 0` 或 `> 2_147_483_647` → `RangeError`，message 恒定：`NAMESPACE_REGISTRY_IDLE_TIMEOUT_RANGE: idleTimeoutMs 必须是 0..2147483647 的有限整数`；
  - 错误类型二分对齐 `@nomicore/clock/testing` manual.ts 先例（TypeError=形状，RangeError=数值域）；零值回显。

**Cordis Adapter 桥接（plugin.ts）**：

```ts
export function createCordisRegistryScheduler(ctx: Context): RegistryTimeoutScheduler {
  assertNamespaceRegistryHostDependencies(ctx)   // 见 §2.F；订单保证：断言先于任何桥接
  return {
    setTimeout: (callback, delayMs) => ctx.timeout(callback, delayMs),
    clearTimeout: (handle) => { (handle as () => void)() },
  }
}
```

与 `createCordisPersistenceScheduler`（persistence/src/service.ts:48-54）逐字同构。`ctx.timeout(cb, ms)` 返回幂等 disposer（timer 触发时先 `dispose()` 再 `callback()`——timer 插件源码核实，见 §5），故 `clearTimeout(handle) === handle()`：触发前取消底层 native timer，触发后调用是无害清理。

**testing subpath 注入（裁决 J 前置）**：`NamespaceRegistryTestingOverrides` 新增 `scheduler: RegistryTimeoutScheduler`（**必需**，同款式构造期形状门禁）与 `idleTimeoutMs?: number`（可选）；testing.ts 新导出确定性 fake `createRegistryTestScheduler()`（形状对齐 persistence `createTestScheduler`：`setTimeout`/`clearTimeout`/`advanceBy(ms)`/`pending()`，`advanceBy` 按到期序逐个触发并做有限微任务展开）。**禁止任何默认 scheduler**——release 即武装 timer，缺省会静默掩盖 idle 行为（拒绝虚假降级）。

**全局 timer 禁令**：registry 生产 src 零 `setTimeout`/`setInterval`/`Date.now` 裸调用（静态守卫落 §2.M / §7）。

### §2.B idle 状态机（裁决 B）

**entry phase 词表**：`'active' | 'idle' | 'closing'`（#110 的 `'active' | 'closing'` 扩一词）。

**Entry 结构冻结增量**（`lifecycleTail` 字段删除——#110 注释预留 #112 接管，实际 shutdown 经 carrier tails 聚合，无消费者，死代码移除）：

```ts
interface Entry {
  readonly key: string
  readonly generation: bigint
  readonly owner: Readonly<{ readonly userId: string }>
  readonly namespaceId: string
  readonly runtime: NamespaceRuntime
  phase: 'active' | 'idle' | 'closing'
  readonly leases: Set<NamespaceLease>
  idleTimerHandle: unknown | undefined    // 不变量：phase==='idle' ⟺ 已武装（构造后同一同步段内成立）
  closePromise?: Promise<void>           // 不变量：phase==='closing' ⟹ closePromise 已定义（先赋值后翻相，同一同步段）
}
```

**不变量（冻结）**：
- I1 `phase==='idle' ⟺ idleTimerHandle !== undefined`（武装失败不进 idle，见下）。**域限定**：本等价在 `acceptance==='running'` 期间成立；shutdown 同步段取消全部 idle timer 后至 §2.D 步骤 2 关闭发起段翻相前，`phase==='idle' ∧ idleTimerHandle===undefined` 是**唯一豁免窗口**（entry 停留无 timer 的 idle，由 shutdown 统一关闭）；
- I2 `phase==='closing' ⟹ closePromise !== undefined`（runCreateSlot 的 R2-M1 fail-closed 守卫因此保持结构性不可达）；
- I3 phase 迁移只在四个同步段内发生：`beginIdleClose`（timer 回调）、`activateEntry`（open 快路径）、`handleLeaseReleased`（release 同步段）、shutdown 同步段/关闭发起段。generation 永不复用；
- I4 **arm-token 判别（R1/H1）**：idle timer 回调仅在「本次武装闭包捕获的 handle === `entry.idleTimerHandle` 当前值」时生效，失配即 no-op。`activateEntry` 与 shutdown 取消段置 `idleTimerHandle = undefined`、重武装写入新 handle——三者天然使一切旧 token 失配。本判别使 Registry 对「取消/替换后仍被调度的回调」（adversarial 或违约 scheduler）结构性免疫，不依赖 scheduler 自身正确性。

**状态机**：

```
                issueLease(open/create)
   (无 entry) ─────────────────────────▶ active ──── 最后 lease release(同步段) ──▶ idle
                        ▲                   │                                          │ timer 到期(回调)
                        │ open 快路径        │ shutdown 发起 close                      │ beginIdleClose(同步段)
                        │ (同步取消 timer)   │                                          ▼
                        ├───────────────────┤                                      closing ──close settle──▶ (entry 移除)
                        └───── open 等待 closePromise settle 后 recheck ──────────────┘
```

**lease release → 武装 timer 的触发点（机制裁决）**：lease controller 是独立闭包，observer 是可选注入，均不能作唯一通知机制。冻结：`createLeaseController` 新增**第三参 `onReleased?: () => void`**（lease.ts），在首次 `release()` 同步段内、`entry.leases.delete(controller)` 与 `lease-released` observer 事件**之后**调用（恰一次，仅首次 release）。registry 侧在 `issueLease` 处闭包绑定：

```ts
function issueLease(entry: Entry) {
  const lease = createLeaseController(entry, observer, () => handleLeaseReleased(entry))
  entry.leases.add(lease)
  return Object.freeze({ ok: true as const, lease })
}

/** 最后 lease 释放的 idle 武装（release 同步段内执行）。 */
function handleLeaseReleased(entry: Entry): void {
  if (acceptance !== 'running') return          // shutdown 期不武装：entry 保持 active(零 lease)，由 shutdown 关闭
  if (entry.phase !== 'active' || entry.leases.size !== 0) return
  let handle: unknown
  try {
    handle = scheduler.setTimeout(() => {
      // I4 arm-token 判别：仅当本次武装的 handle 仍是 entry 当前武装时才生效——
      // activateEntry / shutdown 取消段置 idleTimerHandle=undefined、重武装写新 handle，
      // 均使旧 token 失配 no-op（对取消/替换后仍被调度的回调结构性免疫）。
      if (entry.idleTimerHandle !== handle) return
      beginIdleClose(entry)
    }, idleTimeoutMs)
  } catch (cause) {
    // 武装失败不破坏 release() 的 same-Promise 契约：entry 保持 active(零 lease)，
    // 内部 observer 上报（§2.I idle-arm-failed），shutdown 兜底关闭；绝不静默重试/降级。
    dispatchObserver(observer, { type: 'idle-arm-failed', identity: entryIdentity(entry),
      generation: entry.generation, cause })
    return
  }
  entry.idleTimerHandle = handle
  entry.phase = 'idle'
  dispatchObserver(observer, { type: 'entry-idle', identity: entryIdentity(entry), generation: entry.generation })
}
```

每次 active→idle 都是**全新完整 `idleTimeoutMs`**（AC4 重置语义：不存在递减/累计）。fatal/persistence-degraded Runtime **零特判**（AC6：capability 不影响 retention——degraded Runtime 读面仍可用，idle 复用照常）。

**timer 回调 → closing → close 的精确次序**（`beginIdleClose`，运行在 timer 调度栈（经 I4 token 判别后的武装闭包调用），**不进 carrier FIFO**——它是内部生命周期，不是调用方操作）：

```ts
function beginIdleClose(entry: Entry): void {
  if (entries.get(entry.key) !== entry) return        // 旧 generation ABA 守卫（结构性防御）
  if (entry.phase !== 'idle') return                  // 已被 open 激活 / 已 closing（结构性防御）
  entry.idleTimerHandle = undefined
  const closePromise = entry.runtime.close()          // ① 先取得 close Promise（runtime 同步进 closing）
  entry.closePromise = closePromise                   // ② 后写 entry（I2：closing ⟹ closePromise 定义）
  entry.phase = 'closing'                             // ③ 不可逆转换（AC5）
  closePromise.then(
    () => removeEntryAfterClose(entry, undefined),    // ④ settle（成败皆然）→ removeOnlySelf 双守卫移除
    (cause) => {
      dispatchObserver(observer, { type: 'idle-close-failed', identity: entryIdentity(entry),
        generation: entry.generation, cause })        // ⑤ AC7：exact cause 进内部 observer
      removeEntryAfterClose(entry, cause)
    },
  )
}

function removeEntryAfterClose(entry: Entry, _cause: unknown): void {
  removeOnlySelf(entries, entry)   // #110 identity+generation 双守卫；runtime 无论 release 成败都 closed
}

// 包内 helper：entry → InternalIdentity 的只读投影（owner/namespaceId/key 均为 entry 既有
// 只读字段，零新建身份；observer 事件载荷专用）。
function entryIdentity(entry: Entry): InternalIdentity {
  return { owner: entry.owner, namespaceId: entry.namespaceId, key: entry.key }
}
```

微任务次序事实（#111 HIGH-1 结论在 #112 依旧成立）：closePromise 的 settle 处理器④在 close 发起时**最先挂接**，任何后来 slot 对 `entry.closePromise` 的 await 续体都排在它之后——await 醒来时 entry 必已移除（同 key 后续槽又 FIFO 排在本槽之后，不可能插入新 entry）。因此 `runCreateSlot` 的「await 后仍 closing」分支保持**结构性不可达**（§2.K 保留守卫）。

**open 在三态下的精确行为**（`runOpenSlot` 冻结伪码，替换 #110 版本）：

```ts
async function runOpenSlot(identity: InternalIdentity): Promise<OpenNamespaceResult> {
  // acceptance 检查已迁移至公共入口同步段（§2.D）；已接纳槽按自身事实结算，此处不再检查
  const key = identity.key
  const current = entries.get(key)
  if (current !== undefined && current.phase === 'active') return issueLease(current)
  if (current !== undefined && current.phase === 'idle') return issueLease(activateEntry(current))   // AC5 同步取消 timer + 复用
  if (current !== undefined && current.phase === 'closing' && current.closePromise !== undefined) {
    try { await current.closePromise }
    catch { /* idle-close 失败已在发起侧上报 observer（idle-close-failed）；本槽继续建新 generation（ADR-0009:50「后续 open 等待同一个 close Promise 结算，再 load 并建立新 generation」）*/ }
    const recheck = entries.get(key)
    if (recheck !== undefined && (recheck.phase === 'active' || recheck.phase === 'idle')) {
      return issueLease(activateEntry(recheck))     // 复用（含新 generation 已 idle 再激活）
    }
    // recheck===undefined：唯一放行至 loadDoc（新 generation）；recheck 仍 closing 结构性不可达，落穿不改写
  }
  // …loadDoc → factory → makeEntry(active) → entries.set → issueLease（#110 冻结决策逐字保留）
}

function activateEntry(entry: Entry): Entry {
  if (entry.phase === 'idle') {
    if (entry.idleTimerHandle !== undefined) scheduler.clearTimeout(entry.idleTimerHandle)  // AC5 同步取消
    entry.idleTimerHandle = undefined
    entry.phase = 'active'
  }
  return entry
}
```

**open 对 closePromise reject 的裁决（新冻结）**：吞掉并继续（open 的 closing 分支原为 #112 预留不可达，无冻结测试）。依据：ADR 0009:50 明文「后续 open 等待同一个 close Promise **结算**，再 load 并建立新 generation」——结算含 reject；close 失败属 Registry 内部 idle 生命周期（发起侧已 observer 上报），不归属 opener；新 generation 的 loadDoc/createDoc 与旧 handle 的 release 失败互不阻塞（Persistence twin lease 合法）。与 create 的 fatal（#111 冻结 + 红灯锚定）不同轨的辩护：create 是**提交型排他操作**，在同 key close 失败之上继续提交会混淆两个失败域，#111 R2 裁决维持；open 仅加载，可用性优先且 ADR 文本直译。此不对称为**有意冻结**，非疏漏。

**create 对 idle 的行为（ADR-0009:68 裁决）**：`runCreateSlot` 的 entry 分派更新为：

```ts
if (current !== undefined && (current.phase === 'active' || current.phase === 'idle')) {
  return ALREADY_EXISTS_ISSUE   // DQ-5 扩 idle 行：active（含零 lease 临时态）与 idle 同码，零 Persistence
}
```

closing 分支保持 #111 冻结伪码不变，仅再评估处扩 idle：

```ts
const after = entries.get(key)
if (after === undefined) { /* 唯一放行 */ }
else if (after.phase === 'active' || after.phase === 'idle') return ALREADY_EXISTS_ISSUE   // 新增 idle（防御可达）
else { /* after 仍 closing：结构性不可达 → 保留 fail-closed fatal 守卫（#111 冻结文本不变） */ }
```

**timeout=0（AC6）**：`scheduler.setTimeout(cb, 0)` 照常异步调度（生产桥 = native `setTimeout(cb, 0)` 宏任务；测试 fake = `advanceBy(0)` 触发）。release 调用栈内**零 close**、零 runtime 状态变更（除 phase→idle）。测试锚：release resolve 后、advance 前，runtime 未 closed。

### §2.C idle-close failure 通道（裁决 C，AC7）

1. **零 unhandled rejection**：`closePromise.then(onFulfilled, onRejected)`（§2.B ④⑤）派生 Promise 两臂均不重抛——基 Promise 的 rejection 被「已处理」；任何后续 await 者（open 槽 catch 吞 / create 槽 catch→fatal / shutdown 聚合 catch 收集）各自处理。
2. **observer 事件**：`{ type: 'idle-close-failed'; identity; generation; cause }`——exact cause（通常为 `NamespaceRuntimeCloseError`，cause 链保留原始 release 异常），触发点 = close reject 臂（§2.B ⑤）。恰一次（close 发起侧单点）。
3. **entry 清理**：settle（成败皆然）→ `removeOnlySelf`（identity + generation 双守卫，§2.B ④）——旧 close completion 绝不按 key 无条件 delete 后来建立的新 entry。
4. **后续 open 不被污染**：失败状态是 entry 代际局部的；新 entry 全新 generation；open closing-wait 后 recheck undefined → 全新 loadDoc/factory 路径（§2.B）。跨 generation 零残留。

### §2.D shutdown 状态机（裁决 D）

**acceptance 三相与写入点**：

- `'running' → 'shutting-down'`：**首次 `shutdown()` 调用同步段**（JS run-to-completion 内立即可观测）；
- `'shutting-down' → 'stopped'`：全部 Runtime close 聚合结算之后、结果交付（resolve/throw）之前；
- `'stopped'` 终态，不再迁移。

**接纳门迁移（关键裁决）**：#110/#111 的 acceptance 检查在**槽开始处**。#112 起迁移至 **open/create 公共入口的同步段**（async 函数体首语句，调用方 tick 内执行）：

```ts
async open(owner: unknown, namespaceId: unknown): Promise<OpenNamespaceResult> {
  if (acceptance !== 'running') return NOT_ACCEPTING_ISSUE   // 先于一切输入访问（AC9「不访问新输入」）
  const outcome = validateOpenIdentity(owner, namespaceId)   // …#110 冻结体不变
  …
}
async create(input: unknown): Promise<CreateNamespaceResult> {
  if (acceptance !== 'running') return NOT_ACCEPTING_ISSUE   // 先于 acceptCreateIdentity（零 descriptor/Proxy trap 执行）
  …
}
```

**槽内的 acceptance 检查删除**（`runOpenSlot`/`runCreateSlot` 首行）：ADR-0009:99「等待此前**已接纳**的 lifecycle 操作结算」——shutdown 前已入 carrier 的操作按自身事实完整结算（loadDoc/createDoc/factory/签 lease 照常），不折损为 NOT_ACCEPTING。（#110/#111 无测试可触及该分支——shutdown 占位从不翻转 acceptance，删除无回归面。）

**首次 shutdown 的同步段**（原子，run-to-completion）：

```ts
shutdown(): Promise<void> {
  if (shutdownPromise !== undefined) return shutdownPromise        // AC12 幂等 same-Promise（含已 reject 实例）
  acceptance = 'shutting-down'                                      // ① 同步停接纳（后续 open/create 立即 NOT_ACCEPTING）
  for (const entry of entries.values()) {                          // ② 取消全部 idle timer（不再有自发 close）
    if (entry.phase === 'idle' && entry.idleTimerHandle !== undefined) {
      scheduler.clearTimeout(entry.idleTimerHandle)
      entry.idleTimerHandle = undefined
    }
  }
  shutdownPromise = runShutdown()                                   // ③ 缓存并返回同一 Promise
  return shutdownPromise
}
```

**异步段（`runShutdown`，冻结次序）**：

```ts
async function runShutdown(): Promise<void> {
  // 1) 等待全部已接纳 open/create 结算：carrier tail 恒绿，逐 key await（快照迭代——
  //    接纳门已关，无新 carrier；green tail 使 await 永不 reject）。不等待外部 lease release
  //    （release 不经 carrier；带存活 lease 的 entry 直接进入第 2 步关闭，AC9）。
  for (const carrier of [...carriers.values()]) await carrier.tail

  // 2) 枚举关闭全集 = 当前 entries 全集（active + idle(timer 已取消) + closing(含 idle close 在途)）。
  //    先全部发起、后统一等待（发起序 = Map 插入序，确定）。
  const closures: Array<{ entry: Entry; promise: Promise<void> }> = []
  for (const entry of entries.values()) {
    if (entry.closePromise !== undefined) {
      closures.push({ entry, promise: entry.closePromise })        // AC10 复用已在途 close Promise（共享同一实例）
    } else {
      const promise = entry.runtime.close()                         // shutdown 发起的 close：active/idle → closing
      entry.closePromise = promise
      entry.phase = 'closing'
      closures.push({ entry, promise })
    }
  }

  // 3) 全部尝试，不因首败跳过其余（AC10）；close reject 不外泄（await catch 收集）。
  const failures: NamespaceRegistryShutdownFailure[] = []
  for (const { entry, promise } of closures) {
    try { await promise }
    catch (cause) {
      failures.push(Object.freeze({ owner: entry.owner, namespaceId: entry.namespaceId, cause }))
    }
  }

  // 4) 终态与清理。
  entries.clear()
  acceptance = 'stopped'
  if (failures.length > 0) throw new NamespaceRegistryShutdownError(Object.freeze(failures))
  // failures 为空 → resolve undefined
}
```

**裁决明细**：
- **reject vs resolve**：close failures 非空时 shutdown Promise **reject** `NamespaceRegistryShutdownError`（ADR-0009:101「以稳定 NamespaceRegistryShutdownError 聚合 close failures」）；状态机仍先到 `'stopped'` 再 throw——失败不回滚终态。空 failures → resolve `undefined`。
- **与在途 idle close 的交互**：复用同一 Promise（§2.D 步 2）；其 rejection 双通道各恰一次——发起侧 observer `idle-close-failed`（§2.C）+ shutdown 聚合收录（两通道不同受众，非重复上报）。
- **幂等**：`shutdownPromise` 缓存于同步段，并发/重复调用返回 exact same Promise（含 rejected 实例，AC12）。
- **shutdown 后 open/create**：公共入口 NOT_ACCEPTING（零输入访问、零 Persistence/carrier/Runtime）；`getStatus()` 恒可用。
- **在途 close 永不 settle（runtime release 挂起）**：shutdown 随之挂起——ADR-0008「不取消、不设内部 timeout」契约行为（§8 风险）。
- **shutdown 期间 lease release**：`handleLeaseReleased` 的 `acceptance !== 'running'` 早退使 entry 停留 active(零 lease)，由步 2 关闭——不存在「shutdown 后新武装的 timer」。

### §2.E getStatus 投影（裁决 E，AC8）

```ts
const RUNNING_STATUS: NamespaceRegistryStatus = Object.freeze({ state: 'running' })
const SHUTTING_DOWN_STATUS: NamespaceRegistryStatus = Object.freeze({ state: 'shutting-down' })
const STOPPED_STATUS: NamespaceRegistryStatus = Object.freeze({ state: 'stopped' })

getStatus(): NamespaceRegistryStatus {
  return acceptance === 'running' ? RUNNING_STATUS
    : acceptance === 'shutting-down' ? SHUTTING_DOWN_STATUS : STOPPED_STATUS
}
```

仅三相、恒冻结常量、不暴露 entry/lease/queue/timer 任何内部计面（`NamespaceRegistryStatus` 类型 #110 已冻结为三相联合，无需改动）。

### §2.F Cordis plugin（裁决 F）

**模块**：新文件 `src/plugin.ts`（本包唯一 import cordis 的模块，§2.M）。**形状**：函数工厂返回 plugin 对象（对齐 `createMemoryPersistencePlugin` 的 `{apply, instance}`，增 `inject`）：

```ts
export const NOMICORE_REGISTRY_SERVICE = 'nomicoreRegistry' as const   // issue #104 决策冻结名

declare module '@deepseek-ai/cordis' {
  interface Context { nomicoreRegistry: NamespaceRegistry }
}

export function provideNomicoreRegistry(ctx: Context, registry: NamespaceRegistry): () => void {
  return ctx.provide(NOMICORE_REGISTRY_SERVICE, registry)
}
export function requireNomicoreRegistry(ctx: Context): NamespaceRegistry {
  const registry = ctx.get(NOMICORE_REGISTRY_SERVICE)
  if (registry === undefined) throw new Error('required Cordis service "nomicoreRegistry" is unavailable')
  return registry
}

export interface NamespaceRegistryPluginConfig {
  readonly idleTimeoutMs?: number          // 唯一配置键（AC2）；多余键 loud 拒绝
}

export function createNamespaceRegistryPlugin(config: NamespaceRegistryPluginConfig = {}) {
  const idleTimeoutMs = resolvePluginIdleTimeoutMs(config)   // 工厂调用期同步校验（见下）
  let instance: NamespaceRegistry | undefined
  return {
    inject: ['clock', 'timer', 'nomicorePersistence'],        // 依赖图边：AC11 时序保证的机制载体（§5）
    apply(ctx: Context): void {
      assertNamespaceRegistryHostDependencies(ctx)            // 形状级 loud fail（见下）
      const registry = createNamespaceRegistry(requireNomicorePersistence(ctx), {
        clock: requireClock(ctx),
        scheduler: createCordisRegistryScheduler(ctx),
        idleTimeoutMs,
      })
      instance = registry
      let revokeService: (() => void) | undefined
      ctx.effect(function* () {
        // 有序 disposer（AC11）：yield 顺序 = 收集顺序 [revoke, shutdownDisposer]；
        // fiber/effect dispose 按收集序逆序**串行**执行 → shutdown 完成后才撤 service。
        // yield revoke 同时把嵌套 provide wrapper 从 fiber 级清单 re-parent 进本 effect
        // 的有序表（否则它与外层 disposer 在 fiber _unload 的 Promise.all 中并发——次序不确定）。
        revokeService = provideNomicoreRegistry(ctx, registry)
        yield revokeService
        yield async () => {
          try { await registry.shutdown() }
          finally { revokeService?.() }   // shutdown reject（聚合错误）也不阻断撤 service；rejection 交 cordis fiber 日志
        }
      }, 'namespace-registry: service')
    },
    get instance(): NamespaceRegistry | undefined { return instance },
  }
}
```

**依赖断言（AC3）——inject 与 loud assert 双机制互补（冻结）**：

```ts
export function assertNamespaceRegistryHostDependencies(ctx: Context): void {
  requireClock(ctx)   // 缺失 → throw 'required Cordis service "clock" is unavailable'（@nomicore/clock 现有文案）
  const timer = ctx.get('timer') as { timeout?: unknown } | undefined
  if (timer === undefined || typeof timer.timeout !== 'function') {
    throw new Error(
      'required Cordis service "timer" is unavailable: '
      + 'install @deepseek-ai/cordis-plugin-timer before the namespace-registry plugin',
    )
  }
  requireNomicorePersistence(ctx)   // 缺失 → throw 'required Cordis service "nomicorePersistence" is unavailable'
}
```

- 断言在 provide service **之前**同步执行（对齐 `assertPersistenceHostDependencies` 订单纪律）；检查顺序固定 clock → timer → nomicorePersistence，首个失败即 throw。
- **AC3 双通道裁决（R1/M1 落纸）——「缺失 loud fail 且无 fallback」由两条装载通道各自承载，语义互补且均非静默降级**：
  - **通道 A（直接 `plugin.apply(ctx)`，DSH profile 先例装配式）**：`inject` 声明不被处理（只有 `ctx.plugin`/`ctx.inject` 读它），apply 内断言是**在场+形状**的完整 loud 门——缺失任一依赖即 apply 栈内同步 throw 稳定文案，宿主立即观察、零 service 提供、零 Registry 实例构造。
  - **通道 B（`ctx.plugin(createNamespaceRegistryPlugin(...))`）**：`inject` 声明使 fiber 在三服务齐备前保持 cordis 原生 PENDING 门——语义 = **不半启动**（apply 零执行、零 Registry 实例、零 side effect）、**零 service 提供**、**零 fallback**（绝不以残缺依赖半启动后降级运行）。PENDING 不是静默降级：plugin 根本没有启动，不存在「带着缺失依赖继续跑」的状态；这是 Cordis 依赖图的原生依赖门（§5#8）。apply 内断言在通道 B 下仍是**形状级** loud 门（inject 只保证服务在场，不保证形状——如无 `timeout` 成员的假 timer 服务仍由断言 throw）。
  - 通道判定给测试与宿主的观测面：通道 A 的失败 = throw 冒泡；通道 B 的缺失 = `fiber.state !== ACTIVE`（PENDING）且 `ctx.get('nomicoreRegistry') === undefined` 且 `plugin.instance === undefined`（§7 测试 28a）。
- plugin.ts 需 `import type {} from '@deepseek-ai/cordis-plugin-timer'`（引入 timer Context mixin 类型，persistence service.ts 同款）。

**plugin.ts 头注宿主接线契约（冻结要点，随实现落纸）**：
1. **timer fiber 生命周期必须 ⊇ Registry plugin 生命周期**：宿主必须先装 timer（及 clock/persistence）、后停 registry（persistence R1/#15 同款契约）。timer plugin 先卸的后果：其 fiber 卸载会**静默清除**本 Registry 经 `ctx.timeout` 武装的全部 pending idle timer（回调永不触发，§5#2）——受影响 entry 滞留 idle（无 timer、无自发 close），直至后续 open 激活复用或 Registry shutdown 关闭（R1/O2 后果声明：滞留不崩溃、不泄漏 entry 之外资源，但 idle 回收停摆）；其后任何 `ctx.timeout` 调用（新武装）抛 `INACTIVE_EFFECT`，属宿主接线违约，不在 plugin 内防御。
2. **AC11 时序解读（R1/O1）**：「先于 Persistence dispose」= **fiber 级**保证——Registry fiber 卸载完成（含 `registry.shutdown()` settle 与 `nomicoreRegistry` service 撤销完成）先于 persistence fiber 卸载完成与 `nomicorePersistence` service 撤销完成（机制 = inject 依赖图 join，§5#5）；**adapter 级**排空次序（persistence adapter 自身 dispose 与 Registry shutdown 的并发）不在此保证内，为 §8 R1 残余并发声明。
3. **fiber reload 语义**：persistence 服务替换/重启触发本 fiber 卸载+重载，每次 apply 构造全新 Registry 实例（§2.F reload 冻结声明）。

**config 校验（AC2）——工厂调用期同步 loud（对齐 `resolvePersistenceSchedule` 先例；不声明 cordis Config schema，零新依赖）**：

```ts
// M3 单点化：DEFAULT_IDLE_TIMEOUT_MS 唯一运行时定义点在 registry.ts（与 resolveIdleTimeoutMs
// 同居）；plugin.ts 经相对通道 import 后 re-export，index.ts 沿 plugin 链转出——零第二定义点。
export { DEFAULT_IDLE_TIMEOUT_MS } from './registry.js'

function resolvePluginIdleTimeoutMs(config: NamespaceRegistryPluginConfig): number {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError(NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE)
  }
  const keys = Object.keys(config)                       // 恒 'idleTimeoutMs' 子集
  if (keys.some((k) => k !== 'idleTimeoutMs')) {
    throw new TypeError(NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE)   // 拒绝静默忽略拼错键（默认 5 分钟将掩盖错误）
  }
  return resolveIdleTimeoutMs(config)                    // 复用核心单点（§2.A：类型/域二分 + 默认值）
}
```

`NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE = 'NAMESPACE_REGISTRY_PLUGIN_CONFIG: namespace-registry 插件配置仅接受 idleTimeoutMs 键'`。非法值在 `createNamespaceRegistryPlugin(...)` 调用栈同步 throw（TypeError=形状/键集，RangeError=数值域，§2.A 文案）——早于任何 fiber/apply，栈指向误配点。

**「先于 Persistence dispose」的机制与精确边界（AC11；解读按上方头注契约第 2 条 = fiber 级）**：`inject: ['nomicorePersistence', …]` 建立 Cordis 依赖图边；persistence 卸载时其 `ctx.provide('nomicorePersistence')` disposer 的实现是「删除服务 → notify → `await Promise.allSettled(依赖 fiber.await())`」（§5 机制 5）——Registry fiber（含上述有序 disposer：shutdown → 撤 service）**先 settle，persistence fiber 的卸载后完成**。残余并发（persistence adapter 自身 dispose 与 Registry shutdown 在各自 fiber 的 `_unload` Promise.all 中并发）是 persistence 包既有注册形态的产物，本票不改 persistence src（DENY LIST），其影响与声明见 §5/§8。

**fiber reload 语义（inject 的必然后果，冻结声明）**：persistence 服务替换/重启触发 Registry fiber 卸载+重载——每次 apply 构造**全新 Registry 实例**（旧实例 shutdown、service 撤销、`instance` 指向新实例）。v1 接受完整回收（Registry 不跨 persistence 代际存续，lease 随旧实例失效）。

### §2.G package.json / exports / 依赖（裁决 G）

- **依赖**（对齐 persistence 包先例：cordis 系为 `dependencies`，非 peerDependency——本仓包私有、workspace 内版本由锁文件收敛）：
  - `@deepseek-ai/cordis: ^4.0.1`
  - `@deepseek-ai/cordis-plugin-timer: ^1.1.3`
  - 既有五个 workspace 依赖不动。
- **exports 不变**：`"."` 与 `"./testing"`。plugin 从主入口导出（persistence 先例：plugin 工厂在主入口；DSH/NomicoreServer 为未来外部消费者）；**不新增子路径**。
- **主入口 index.ts 导出面增量（冻结精确清单）**：
  - 值（运行时）：`createNamespaceRegistryPlugin`、`NOMICORE_REGISTRY_SERVICE`、`provideNomicoreRegistry`、`requireNomicoreRegistry`、`NamespaceRegistryShutdownError`（经 registry.ts→errors.ts 既有转出链再转出，或 index 直接 from './errors.js'——冻结：沿用现有链，registry.ts 的 errors re-export 行追加）、`DEFAULT_IDLE_TIMEOUT_MS`（**R1/M3 单点化：唯一运行时定义点在 registry.ts，plugin.ts 相对 import 后 re-export，index.ts 沿 plugin 链转出——测试锚定默认值**）。
  - 类型：`NamespaceRegistryPluginConfig`、`NamespaceRegistryShutdownFailure`、`RegistryTimeoutScheduler`。
  - 移除：`RegistryOperationUnavailableIssue` 本就不在 index 导出面（surface 已断言缺席），#112 连 types.ts 内部定义一并删除（§2.H）。
  - 主入口运行时 export keys 由 3 → 9（新增 6）：`['DEFAULT_IDLE_TIMEOUT_MS', 'NOMICORE_REGISTRY_SERVICE', 'NamespaceLeaseReleasedError', 'NamespaceRegistryFatalError', 'NamespaceRegistryShutdownError', 'createNamespaceRegistry', 'createNamespaceRegistryPlugin', 'provideNomicoreRegistry', 'requireNomicoreRegistry']`——registry-surface.test.ts 同步更新。
- **§2.2 导出面纪律核查**：plugin.ts 进入主入口可达声明图——其声明文本只含 `Context`（cordis）、`DocPersistence`/`Clock`（外部包公开类型）、`NamespaceRegistry`/配置类型；**不出现** `NamespaceRuntime`/`DocHandle`/`Y.Doc`/internal subpath 字面量（surface 审计继续绿）。

### §2.H types.ts 公共面增量（裁决 H）

| 项 | 裁决 |
|---|---|
| `RegistryOperationUnavailableIssue` + `NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE` | **删除**（连同 registry.ts 的 `SHUTDOWN_UNAVAILABLE` 常量）。shutdown 真实化后零消费者；surface 测试已断言其不在 index.d.ts，删除无外溢。 |
| `NamespaceRegistry.shutdown()` | 签名 `Promise<RegistryOperationUnavailableIssue>` → **`Promise<void>`**（reject `NamespaceRegistryShutdownError`；resolve undefined）。 |
| 新错误类 `NamespaceRegistryShutdownError`（errors.ts，主入口转出） | 见下。 |
| 新类型 `NamespaceRegistryShutdownFailure` | `Readonly<{ owner: Readonly<{userId: string}>; namespaceId: string; cause: unknown }>`——结构化携带受控 identity（宿主运维必需的定位面；message 恒定零回显纪律不约束结构化字段与 cause——与 `NamespaceRegistryFatalError.cause` 同款先例）。 |
| 新常量 | `NAMESPACE_REGISTRY_SHUTDOWN_FAILED_MESSAGE = 'NAMESPACE_REGISTRY_SHUTDOWN_FAILED: Registry shutdown 期间部分 Runtime 关闭失败'` |
| 新选项类型 | `CreateNamespaceRegistryOptions.scheduler: RegistryTimeoutScheduler`（必需）、`.idleTimeoutMs?: number`；三条校验 message 常量（§2.A/§2.F）入 types.ts 单一真相源。 |

```ts
// errors.ts 增量
export class NamespaceRegistryShutdownError extends Error {
  readonly code = 'NAMESPACE_REGISTRY_SHUTDOWN_FAILED' as const
  readonly failures: ReadonlyArray<NamespaceRegistryShutdownFailure>
  constructor(failures: ReadonlyArray<NamespaceRegistryShutdownFailure>) {
    super(NAMESPACE_REGISTRY_SHUTDOWN_FAILED_MESSAGE)   // 恒定，零插值、零 identity 回显
    this.name = 'NamespaceRegistryShutdownError'
    this.failures = failures
  }
}
```

聚合稳定性：failures 顺序 = shutdown 枚举时的 Map 插入序（Registry 生命周期内确定）；数组与逐元素 `Object.freeze`。零插值、零 identity 回显纪律延续（message 层面）。

### §2.I observer 事件增量（裁决 I）

`RegistryObserverEvent` 七形 → **十形**（新增三形，全部携带受控 identity + generation）：

```ts
| { type: 'entry-idle'; identity: InternalIdentity; generation: bigint }                       // active→idle 武装成功（§2.B）
| { type: 'idle-arm-failed'; identity: InternalIdentity; generation: bigint; cause: unknown }  // scheduler.setTimeout throw（§2.B）
| { type: 'idle-close-failed'; identity: InternalIdentity; generation: bigint; cause: unknown } // idle close reject（§2.C）
```

shutdown 不加事件：close 失败经聚合错误交付（AC10），shutdown 进度经 getStatus 投影（AC8）——双通道已足，避免冗余事件面。diagnostics 事件（carrier-created/deleted）不动。

### §2.J testing seam 增量（裁决 J）

`NamespaceRegistryTestingOverrides`（testing.ts）：

```ts
export interface NamespaceRegistryTestingOverrides {
  readonly runtimeFactory?: …            // 既有
  readonly observer?: RegistryObserver   // 既有
  readonly diagnostics?: …               // 既有
  readonly clock: Clock                  // 既有（必需）
  readonly createDocumentFactory?: …     // 既有
  readonly scheduler: RegistryTimeoutScheduler   // 新增：必需（同生产形状门禁；无缺省——release 即武装，禁静默掩盖）
  readonly idleTimeoutMs?: number        // 新增：可选（默认 300_000；测试常用小值或直接驱动 fake）
}
```

testing.ts 新导出 `createRegistryTestScheduler(): RegistryTestScheduler`（`RegistryTestScheduler extends RegistryTimeoutScheduler { advanceBy(ms): Promise<void>; pending(): number }`，实现移植 persistence `createTestScheduler` 的到期序触发 + 3 层微任务展开）。**冻结边界（phase-4）**：不暴露 entry map、lease count、queue、timer handle——scheduler 注入给测试的是「时间推进能力」，timer 句柄停留 Registry 内部（fake 自持队列）。testing 子路径运行时导出 = `['createNamespaceRegistryForTesting', 'createRegistryTestScheduler']`。

### §2.K 对既有行为的回归风险重裁决（裁决 K）

| #110/#111 冻结语义 | #112 后的状态 | 裁决 |
|---|---|---|
| lease release same-Promise / sync released / `[Symbol.asyncDispose]` | release 同步段新增 `onReleased` 回调（观察者事件后） | 契约不变：released 标记与 releasePromise 缓存先于回调；release 仍 resolve undefined、不等 close；回调 throw 被隔离（§2.B idle-arm-failed） |
| create 排他（DQ-5 四源 duplicate） | idle 成为第五态 | idle → `ALREADY_EXISTS` 同码零 Persistence（ADR-0009:68 明文）；既有「lease 全释放后临时保留态」红灯从 active-零lease 语义变为 idle 语义，断言同码**保持绿** |
| `runCreateSlot` closing 缺 closePromise（R2-M1 fail-closed） | #112 后**仍结构性不可达**（I2：closePromise 先赋值后翻相，同一同步段） | 保留守卫与红灯不动（内部缺陷防御）；testEntries fixture 注入路径不变 |
| `runCreateSlot` await 后仍 closing（HIGH-1 变体 A fail-closed） | #112 后**仍结构性不可达**（closePromise settle 处理器最先挂接 + 同 key FIFO，§2.B 微任务次序证明） | 保留守卫与红灯不动；再评估分支新增 `idle → ALREADY_EXISTS`（防御位，不可达但与 DQ-5 对齐） |
| `runCreateSlot` await closePromise reject → fatal（HIGH-1 变体 B） | #112 后**可达**（idle close 失败真实化） | **维持 #111 冻结**：fatal(create, lifecycle-slot-internal, false, exact cause)。不重开已冻结并有红灯锚定的裁决 |
| `runOpenSlot` closing 等待（#110 预留分支） | 可达；原实现 `await` 无 catch——close reject 会裸抛 `NamespaceRuntimeCloseError`（非 branded fatal，#110 未定义） | **补 catch-吞并继续**（§2.B 裁决与 ADR 直译）；与 create 的 fatal 差异为有意冻结 |
| acceptance 槽位检查（#110 §5） | 迁移至公共入口（§2.D） | 槽检查删除；已接纳操作完整结算（ADR-0009:99）。#110/#111 无触及该分支的测试（占位 shutdown 从不翻转 acceptance） |
| `Entry.lifecycleTail`（#110 预留字段） | 无消费者 | 删除（shutdown 经 carriers 聚合）；`removeOnlySelf` 双守卫复用于 idle/shutdown close settle |
| `NamespaceRegistryFatalError.operation` 含 `'shutdown'` | 仍零使用 | 保留（预声明词表，无害） |
| `registry-open.test.ts:732-749/1101` shutdown 占位断言 | 占位删除 | 测试改为真实 shutdown 断言（§7） |

### §2.L 测试计划（裁决 L）

见 §7（逐 AC + 文件清单 + 并发场景设计）。

### §2.M 模块边界（裁决 M）

- **cordis import 白名单 = {plugin.ts}**：唯一样本 `import type { Context } from '@deepseek-ai/cordis'` + `import type {} from '@deepseek-ai/cordis-plugin-timer'`（类型级；plugin.ts 仍是运行时 Host 无关核心的唯一外围）。registry.ts/lease.ts/observer.ts/types.ts/errors.ts/identity.ts/create-document.ts/testing.ts **零 cordis**。
- **静态守卫**（参照 persistence module-graph-regression）新增至 registry-surface.test.ts：
  1. `src/*.ts` 中除 plugin.ts 外不得含 `@deepseek-ai/cordis` specifier（AST/正则语句级，先证判别力后扫）；
  2. **全部** `src/*.ts`（**含 testing.ts——零豁免，R1/m3 收紧**：`createRegistryTestScheduler` 是纯 map 队列 fake，零 native timer 调用，豁免无必要）零裸 `setTimeout(`/`setInterval(`/`clearTimeout(`/`Date.now(`（同 persistence HOST_GLOBAL_TIMER 三正则，负向 lookbehind 排除 `scheduler.`/属性签名位）；若实现期确需豁免某文件，须在设计中注明**具体成员与理由**（当前设计零豁免）；
  3. 既有 internal-subpath 审计（registry.ts 唯一消费者）继续绿。
- plugin.ts 经**相对模块通道**导入 registry.ts（`./registry.js`），绝不走包内 subpath specifier 或 barrel（persistence service.ts 先例）。

---

## §3. 文件级改动清单

### 新增

| 文件 | 内容 | 规模估算 |
|---|---|---|
| `packages/namespace-registry/src/plugin.ts` | NOMICORE_REGISTRY_SERVICE、Context augmentation、provide/require、依赖断言、`createCordisRegistryScheduler`、`resolvePluginIdleTimeoutMs`、`DEFAULT_IDLE_TIMEOUT_MS`、`createNamespaceRegistryPlugin`（inject + 有序 disposer） | ~180 行 |
| `packages/namespace-registry/test/registry-idle.test.ts` | §7 AC4/5/6/7 全量 | ~520 行 |
| `packages/namespace-registry/test/registry-shutdown.test.ts` | §7 AC8/9/10/12 全量 | ~560 行 |
| `packages/namespace-registry/test/registry-plugin.test.ts` | §7 AC1/2/3/11/12 全量（真实 Cordis 组合） | ~420 行 |

### 修改

| 文件 | 改动 | 规模估算 |
|---|---|---|
| `src/registry.ts` | Entry 词表/字段（idleTimerHandle、删 lifecycleTail）、`resolveIdleTimeoutMs`、scheduler/idleTimeoutMs 门禁、`handleLeaseReleased`/`beginIdleClose`/`activateEntry`/`removeEntryAfterClose`、runOpenSlot 三态重写、runCreateSlot idle 分派、acceptance 门迁移、shutdown 真实化、getStatus 三相、头注更新 | +260/−40 |
| `src/lease.ts` | `createLeaseController` 第三参 `onReleased?: () => void`（首次 release 同步段、observer 事件后、try/catch 隔离不必要——隔离在 registry 回调内） | +12 |
| `src/types.ts` | 删 `RegistryOperationUnavailableIssue`/`NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE`；增 `RegistryTimeoutScheduler`、shutdown 签名、`NamespaceRegistryShutdownFailure`、`idleTimeoutMs` 选项、5 条 message 常量 | +55/−18 |
| `src/errors.ts` | `NamespaceRegistryShutdownError` | +22 |
| `src/observer.ts` | 事件联合 +3 形 | +9 |
| `src/testing.ts` | overrides 增 `scheduler`(必需)/`idleTimeoutMs`；`createRegistryTestScheduler`/`RegistryTestScheduler` | +75 |
| `src/index.ts` | 导出面增量（§2.G 冻结清单） | +14 |
| `package.json` | dependencies += cordis / cordis-plugin-timer | +2 |
| `test/registry-open.test.ts` | 33 处工厂调用补 `scheduler: createRegistryTestScheduler()`；shutdown 占位断言（732-749、1101）改真实断言 | ~70 行 |
| `test/registry-create.test.ts` | 47 处工厂调用 + 4 处 `createRegistryInternal` fixture 补 scheduler；duplicate 组增 idle 显式行 | ~60 行 |
| `test/registry-node-dispose.test.ts` | 2 处工厂调用补 scheduler | 2 行 |
| `test/registry-surface.test.ts` | export keys 9 值断言、testing 子路径 2 导出、plugin.d.ts 入可达图审计、cordis import 白名单守卫、host-global-timer 守卫 | ~90 行 |

零改动：`src/identity.ts`、`src/create-document.ts`、`test/registry-entry-removal-guard.test.ts`（纯 removeOnlySelf 单元）、根 package.json（typecheck 链已含本包）。

---

## §4. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-registry/src/plugin.ts` — 新建，Cordis Adapter（§2.F）
- `packages/namespace-registry/src/registry.ts` — 修改，idle 状态机 + shutdown 真实化 + 接纳门迁移（§2.B/§2.D，改动 ≤ 300 行）
- `packages/namespace-registry/src/lease.ts` — 修改，onReleased 回调第三参（§2.B，12 行）
- `packages/namespace-registry/src/types.ts` — 修改，公共面增量与占位删除（§2.H）
- `packages/namespace-registry/src/errors.ts` — 修改，NamespaceRegistryShutdownError（§2.H）
- `packages/namespace-registry/src/observer.ts` — 修改，事件 +3 形（§2.I）
- `packages/namespace-registry/src/testing.ts` — 修改，scheduler/idleTimeoutMs 注入 + createRegistryTestScheduler（§2.J）
- `packages/namespace-registry/src/index.ts` — 修改，导出面增量（§2.G）
- `packages/namespace-registry/package.json` — 修改，+2 依赖（§2.G）
- `packages/namespace-registry/test/registry-idle.test.ts` — `[SA6 owned]` 新建，AC4/5/6/7 验收红灯
- `packages/namespace-registry/test/registry-shutdown.test.ts` — `[SA6 owned]` 新建，AC8/9/10/12 验收红灯
- `packages/namespace-registry/test/registry-plugin.test.ts` — `[SA6 owned]` 新建，AC1/2/3/11 验收红灯
- `packages/namespace-registry/test/registry-open.test.ts` — `[SA6 owned]` 修改，工厂 seam 迁移 + shutdown 占位断言替换（断言语义变更限于 §2.K 列出的两处）
- `packages/namespace-registry/test/registry-create.test.ts` — `[SA6 owned]` 修改，工厂 seam 迁移 + idle duplicate 行（既有断言不动）
- `packages/namespace-registry/test/registry-node-dispose.test.ts` — `[SA6 owned]` 修改，工厂 seam 迁移（2 行）
- `packages/namespace-registry/test/registry-surface.test.ts` — `[SA6 owned]` 修改，导出面/模块边界守卫增量
- `wiki/raw/task_registry-idle-plugin-shutdown*.md` — 本设计及后续评审记录

### DENY LIST

- `packages/persistence/**` — persistence 插件的 adapter dispose 注册形态（§5 残余并发根源）不属本票；连带 `packages/persistence/src/testing.ts` 的 fake timer 复用只经 import 消费
- `packages/namespace-runtime/**` — close 契约已冻结（#92），internal subpath 不动
- `packages/clock/**`、`packages/dsh-persistence/**` — DSH 接线 registry 属后续票
- `packages/namespace-registry/src/identity.ts`、`src/create-document.ts` — 零改动
- `packages/vfsl*/**`、`packages/doc-runtime/**` — 无关
- `docs/**`（ADR 0009/phase-4 已冻结本设计全部决策，无文档修订需求）
- 根 `package.json`、`.github/workflows/ci.yml`（Node 20/24 矩阵已就位）

---

## §5. 协议假设依据 (Protocol Assumption Evidence)

以下每条均经设计期直接阅读 Cordis 4.0.1 / cordis-plugin-timer 1.1.3 构建产物源码核实（`node_modules/.pnpm/@deepseek-ai+cordis@4.0.1/.../lib/index.js`、`fiber.d.ts`、`.../cordis-plugin-timer@1.1.3/.../lib/index.js`）。

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| 1 | `ctx.timeout(cb, ms)` 返回幂等 disposer；native 到期时先 `dispose()` 再 `callback()` | 源码引用 | timer 插件 `lib/index.js` `timeout(callback, delay)`：`const dispose = this.ctx.effect(() => { const timer = setTimeout(() => { dispose(); callback(); }, delay); return () => clearTimeout(timer) }, 'ctx.timeout()')`；effect `dispose()` 有 `disposing` 单次守卫 | 低 |
| 2 | timer effect 登记在 **timer plugin 自己的 fiber**（`this.ctx` = TimerService 构造 ctx）——Registry plugin 卸载**不**自动取消 idle timer；timer plugin 先卸则 timer 静默清除（回调不触发）、其后 `ctx.timeout` 抛 INACTIVE_EFFECT | 源码引用 | `TimerService extends Service`，`timeout()` 内 `this.ctx.effect(...)`；persistence/src/service.ts:11-17 已固化同一宿主接线契约（先装 timer、后停使用方） | 中（宿主接线契约，plugin.ts 头注固化；Registry shutdown 显式 clearTimeout 兜底自持 timer） |
| 3 | effect disposer 可为 async；fiber unload 等待其完成；effect 本地 disposers **逆收集序串行**执行 | 源码引用 | `fiber.d.ts:36-39`「Disposers run in reverse registration order … they may be async, in which case unloading awaits them」；`lib/index.js` `effect()` 的 `dispose()`：`disposables.splice(0).reverse()` + `task.then(() => runDisposable(...))` 链式 | 低 |
| 4 | generator/iterable effect：每个 yield 的 disposer 依序收集；嵌套 `ctx.provide` 的 wrapper 只有被 yield/return 才 re-parent 进外层有序表（否则停留 fiber 级清单） | 源码引用 | `fiber.d.ts` Effect 文档「generator effects register each yielded disposer as it is produced」；`_execute` iterator 分支 `safeCollect(result.value)`；`runner.collect` 内 `this._disposables.delete(dispose)` | 低 |
| 5 | **依赖图 join**：`ctx.provide` 的 disposer 实现 =「`delete store[key]` → `notify([name])`（触发声明了该服务 inject 的依赖 fiber 卸载）→ `await Promise.allSettled(fibers.map(f => f.await()))`」——依赖 fiber（Registry）settle 先于 provider（persistence）fiber 卸载完成 | 源码引用 | `lib/index.js` `ReflectService.provide` 返回的 disposer 逐字：`delete this.store[key]; const fibers = this.notify([name]); await Promise.allSettled(fibers.map((fiber) => fiber.await())); …`；`notify` 仅遍历 `name in fiber.inject` 的 fiber | 中（见 #7 残余并发） |
| 6 | fiber `_unload` 以 `Promise.all(this._disposables.clear().map(...))` **并发**运行本级 disposables（`clear()` 逆序只决定启动序）——跨 fiber 卸载无严格串行 | 源码引用 | `lib/index.js` `Fiber._unload` 与 `DisposableList.clear()`（`values.reverse()`） | 中（§8 R1 声明） |
| 7 | `ctx.get(name)` 缺失返回 `undefined`、从不 throw | 源码引用 + 先例 | `ReflectService.get`→`_getImpl` 缺服务返回 undefined；persistence `assertPersistenceHostDependencies` 注释「cordis 已核实：缺失返回 undefined、从不 throw」 | 低 |
| 8 | inject 声明的 fiber：服务不齐 PENDING、服务消失触发卸载、恢复触发重载（每次重载重新执行 apply） | 源码引用 | `registry.d.ts` Plugin.Base.inject「Services the plugin requires; it only loads while all are available」；`Fiber._refresh/_setEpoch`（INACTIVE→`_unload`，恢复→`_reload` 重执行 `_execute`） | 低（§2.F reload 语义冻结声明） |

无 HTTP/WS/端口类协议假设；本表覆盖全部第三方库行为假设。

---

## §6. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/签名

| 函数/类型 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `NamespaceRegistry.shutdown()` | `src/types.ts`、`src/registry.ts` | `Promise<RegistryOperationUnavailableIssue>`（恒 resolve 占位） | `Promise<void>`（resolve undefined / reject `NamespaceRegistryShutdownError`）——新增 reject 路径 |
| `createNamespaceRegistry(persistence, options)` | `src/registry.ts` | options `{clock, observer?}` | options 新增**必需** `scheduler`（缺省 → 构造期同步 TypeError）+ 可选 `idleTimeoutMs` |
| `createNamespaceRegistryForTesting(persistence, overrides)` | `src/testing.ts` | overrides `{clock, …}` | overrides 新增**必需** `scheduler`（缺省 → 同步 TypeError） |
| `createRegistryInternal(persistence, options)` | `src/registry.ts`（包内） | 内部 options | 新增 `scheduler`（必需）+ `idleTimeoutMs?` |
| `createLeaseController(entry, observer)` | `src/lease.ts`（包内） | 两参 | 第三参 `onReleased?: () => void`（可选，向后兼容） |
| `open`/`create` 公共入口 | `src/registry.ts` | 直接进入 identity 校验 | acceptance≠running 时**新增早退分支** resolve `REGISTRY_NOT_ACCEPTING`（仍 resolve 窄 issue，非 throw） |

### Caller 清单

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| shutdown 占位断言 ×2 | `test/registry-open.test.ts:732-749、1101` | await | ❌ | vitest | **改写为真实断言**（§7：resolve undefined / 聚合 reject），占位 issue 断言删除 |
| plugin 有序 disposer | `src/plugin.ts`（新增） | await | ✅ `try { await shutdown() } finally { revoke() }` | cordis fiber `_unload` catch→`ctx.logger.error` | 聚合 rejection 不阻断撤 service；交 cordis 日志（§2.F） |
| lease 工厂（onReleased 唯一注入点） | `src/registry.ts` `issueLease` | N/A（同步回调） | ✅（回调内 setTimeout 已 try/catch→idle-arm-failed） | N/A | release 公开契约零变化 |
| `createNamespaceRegistry` 生产 caller | `src/plugin.ts` apply（唯一） | 构造期 | ✅ apply 栈（assert/门禁 throw → fiber FAILED） | cordis | 依赖断言先于 provide |
| `createNamespaceRegistryForTesting` caller | `test/registry-open.test.ts`(33)、`registry-create.test.ts`(47)、`registry-node-dispose.test.ts`(2)、`registry-surface.test.ts`(3) | 构造期 | ❌（测试工厂行） | vitest | 机械追加 `scheduler: createRegistryTestScheduler()`（ALLOW LIST 内 SA6 owned） |
| `createRegistryInternal` caller | `src/testing.ts:70` + `test/registry-create.test.ts:1661/1745/1813/1861`（testEntries fixture，`as never` 双通道） | 构造期 | ❌ | vitest | 同上补 scheduler（fixture 内部 options） |
| `open`/`create` 早退分支 caller | 全部现有测试的 open/create 调用 | await | resolve 值新增一分支 | — | 仅 shutdown 后触发；既有测试构造的 registry 恒 running，零影响 |

### 风险评估

- shutdown 新增 reject 路径的遗漏 caller 代价：未 catch → unhandled rejection。仓内 caller 仅测试（vitest 吸收）与 plugin disposer（已 catch/finally）；DSH/NomicoreServer 尚未接线（`git grep nomicoreRegistry` 生产消费方为空集）。
- 抓全方法已执行：`grep -rn "shutdown\|RegistryOperationUnavailable" packages/namespace-registry/test/`（结果即上表两处）；`grep -rn "createNamespaceRegistryForTesting\|createRegistryInternal" packages/namespace-registry/`。

---

## §7. 测试计划（逐 AC）

统一纪律：deferred gate + 显式微任务展开（沿用 registry-open.test.ts 原语）；时间全经 `createRegistryTestScheduler().advanceBy`；零 real sleep；clock 用固定 manual；公开文本零回显负锁；observer 收 exact cause/identity。

### AC4+AC6（registry-idle.test.ts）

1. 最后 lease release → 同步段后：entry 进入 idle（经 observer `entry-idle` 恰一次）、fake scheduler `pending()===1`、runtime **未** closed、`lease.release()` same-Promise 不变量保持。
2. 完整时限：`advanceBy(299_999)` 不 close；再 `advanceBy(1)` close 发生（runtime closed、entry 可再 open 得全新 generation）。
3. 重进 idle重置完整 timeout：release→advance(150_000)→open（激活）→release→advance(299_999) 不 close（新窗口）、再 advance(1) close。
3a. **arm-token 红灯（R1/H1）**：经 `RegistryTimeoutScheduler` 注入面自定义 **adversarial scheduler**（记录每次武装的回调、`clearTimeout` 为 no-op——即「取消后回调仍可被手动触发」的违约 scheduler）：release 武装 → open 激活（取消）→ release 重武装（re-arm）→ 手动触发**旧**回调 → 断言旧回调 no-op（runtime 未 close、phase 不变、零 closePromise）；新 timer 存活（adversarial 记录的最近回调未被消费/`pending()===1` 语义等价锚）；此后完整窗口 advance（或手动触发**新**回调）才 close——I4 判别与新 token 生效双锚。
4. timeout=0：`idleTimeoutMs:0` 下 release resolve 后（含微任务排空）runtime 仍未 closed；`advanceBy(0)` 后 closed——异步性双锚。
5. fatal/degraded 同语义：runtimeFactory 注入构造后置 fatal 的 Runtime（经 seam/受控 stub），release→idle→advance→close 照常；degraded 同。
6. idle 期第二次 release / asyncDispose 等既有 lease 语义回归（same-Promise）。

### AC5（registry-idle.test.ts）

7. idle 期 open（advance 前）：同步取消 timer（`pending()===0`）、复用**同一** Runtime identity（marker 断言）、零 loadDoc、新 lease。
8. timer 先行：advance 触发后（closing，closePromise pending 于 deferred release gate）→ open 入槽等待（不 loadDoc）；放行 release → close settle → entry 移除 → open 继续 loadDoc 建新 generation（新 Runtime identity marker）。
9. closing-wait 中 close reject（StubHandle.release reject）：open 仍成功建新 generation；observer `idle-close-failed` exact cause 恰一次（AC7 并锚）。
10. create 于 idle：`ALREADY_EXISTS` 零 Persistence（显式 idle 行，补 #111 duplicate 组）。

### AC7（registry-idle.test.ts）

11. close reject 全链：无 unhandled rejection（`process.on('unhandledRejection')` 探针或 vitest `dangerouslyIgnoreUnhandledRejections` 对照——采用显式 rejection 探针收集断言空）；observer 事件载荷；后续 open 全新 generation 成功（零污染）；再 create 同 key 成功（entry 已清）。
12. close 永挂起（release never-settle handle）：open/create 等待挂起属契约（withTimeout 探针证明等待中而非崩溃）——只锚「不产生 unhandled rejection」。

### AC8/9/10/12（registry-shutdown.test.ts）

13. 三相投影：构造→running；shutdown 同步段后（promise 未 settle 前）`getStatus()==={state:'shutting-down'}`；settle 后 stopped。
14. 同步停接纳 + 零输入访问：shutdown() 后 open(Proxy owner 访问计数 0)/create(Proxy input)→ `REGISTRY_NOT_ACCEPTING` 且 trap 零执行、零 Persistence/Runtime。
15. 取消 idle timer：两 key 各 idle 武装 → shutdown → `pending()===0` 且无自发 close。
15a. **取消后旧回调 adversarial 变体（R1/M5，与 3a 共用注入面）**：武装 idle timer 后测试经 adversarial 注入面取出回调**不执行** → `shutdown()`（同步段取消）→ 手动触发该旧回调 → 断言：恰单次 close（arm-token 失配使旧回调 no-op，close 仅来自 shutdown 步骤 2 的发起）、聚合恰收录该 close 失败一次（若 reject，不重复收录）、终态 `stopped`。
16. 等待已接纳结算：open 的 loadDoc 挂于 gate 时 shutdown → shutdown promise 未 settle；放行 → open 完整成功（签 lease，非 NOT_ACCEPTING）→ 全部 close → shutdown resolve。
17. 不等外部 release：entry 持有未 release lease 时 shutdown → close 照常发起、shutdown resolve（聚合空）；lease release 之后仍幂等。
18. 复用在途 close：idle close 挂于 release gate 时 shutdown → 放行 → 同一 close Promise 结算一次（releaseCalls===1）、shutdown 聚合收录其失败（若 reject）。
19. 聚合错误形状：三 key、两个 close reject（不同 cause）→ reject `NamespaceRegistryShutdownError`：code/name/**`message === NAMESPACE_REGISTRY_SHUTDOWN_FAILED_MESSAGE` 恒定常量断言（R1/M4：shutdown 零回显负锁的专测落点）**、failures 冻结、顺序=插入序、逐项 {owner,namespaceId,cause-exact}（**结构化字段与 cause 不进 sentinel 负锁循环——边界见下方迁移节 M4 注记**）、第三 key 仍被尝试关闭（不因首败跳过）；status 仍 stopped。
20. 幂等 same-Promise：并发双调用与结算后重调用返回同一实例（reject 实例同样复用）；release same-Promise 回归锚。
21. shutdown 后 create/open → NOT_ACCEPTING（同 14）。

### AC1/2/3/11/12 plugin（registry-plugin.test.ts，真实 `new Context()` 组合）

22. 组合：manualClockPlugin + persistence `createFakeTimerPlugin`(testing) 或本地 fake + `createMemoryPersistencePlugin` + `createNamespaceRegistryPlugin` → `ctx.nomicoreRegistry` 为真实 `NamespaceRegistry`（open/create/getStatus 可用）。
23. 缺依赖 loud：逐一剔除 clock/timer/nomicorePersistence 直接 `apply` → 稳定文案 throw（clock/persistence 沿用各包现有文案、timer 为 §2.F 文案）；零 service 提供。
24. config：缺省 `DEFAULT_IDLE_TIMEOUT_MS===300_000`；`{idleTimeoutMs:0}`/`{idleTimeoutMs:2147483647}` 接受；`-1`/`1.5`/`NaN`/`'300000'`/`2147483648` → 工厂期 RangeError/TypeError 恒定文案；`{foo:1}` → TypeError 恒定文案。
25. **有序 disposer**：fiber dispose 顺序探针——记录数组 `shutdownStarted → statusWhileDisposing → shutdownSettled → serviceRevoked` **恰呈该序**（R1/M2 修正：shutdown settle 先于 service 撤销的可观测时刻；`serviceRevoked` 以 `ctx.get('nomicoreRegistry')===undefined` 的**首个可观测时刻**为准——provide disposer 的 `delete store[key]` 同步发生（§5#5），撤销链上无额外异步间隙被误计）。
26. **先于 Persistence**：组合后 dispose persistence fiber → registry fiber 先卸载（其 shutdown 已完成的探针先于 persistence fiber dispose promise settle）；根级 `ctx.fiber.dispose()` 全拆下 service 均撤销、无 unhandled rejection。
27. close 失败的 dispose：注入 reject release 的 persistence → plugin disposer 仍完成撤 service（finally 路径），cordis 捕获聚合 rejection（`fiber` 不因清理崩溃、instance 清理）。
28. timer 经 ctx.timeout 真实桥：production 组合下 idle close 由 fake timer service 的 `ctx.timeout` 通道触发（advance 驱动）。
28a. **通道 B（`ctx.plugin`）依赖门语义（R1/M1）**：`ctx.plugin(createNamespaceRegistryPlugin())` 于缺 timer（或缺 persistence/clock）的组合上装载 → `await fiber` 后断言 fiber **非 ACTIVE**（PENDING）、`ctx.get('nomicoreRegistry')===undefined`、`plugin.instance===undefined`（不半启动、零 service、零实例）；**补装缺失服务后**（同 ctx 再 plugin timer）→ fiber 转 ACTIVE、service 与 instance 就绪——依赖门双向（缺失拦截/补齐放行）单测锚定。

### 修改文件断言迁移

- registry-open.test.ts：33 处工厂补 scheduler；shutdown 占位两处改真实断言——**732-749 占位块**改为真实 shutdown 语义组（resolve undefined / 聚合 reject，与 §7 测试 13-21 分工：该文件只保留轻量回归锚，主断言在 registry-shutdown.test.ts）；**1101 腿（R1/M4 精确化）仅锚 `await registry.shutdown()` resolve `undefined` 与 `getStatus()==={state:'stopped'}` 两断言，零 `JSON.stringify` 入 publicTexts 负锁循环**——零回显负锁对 shutdown 的覆盖改由 **shutdown 侧专测**（§7 测试 19）断言 `NamespaceRegistryShutdownError.message === NAMESPACE_REGISTRY_SHUTDOWN_FAILED_MESSAGE`（恒定常量、零插值）承载。**纪律边界注记（M4）**：ADR-0009:95 的零回显纪律是 **message 级**（公开 issue/error message 不含 owner/namespace 原值与 cause 文本）；`NamespaceRegistryShutdownFailure` 的结构化字段（owner/namespaceId）与 `cause`（exact 事实）是该纪律的**显式边界**，与 `NamespaceRegistryFatalError.cause` 同款先例——sentinel 负锁循环不扫描 failures 数组与 cause 链。
- registry-create.test.ts：47 处工厂 +4 处 internal fixture 补 scheduler；duplicate 组增 idle 显式行；全部既有断言（含 R2-M1/HIGH-1 三变体）**不动**。
- registry-node-dispose.test.ts：2 处工厂。
- registry-surface.test.ts：export keys 9 值、testing 子路径 2 值、plugin.d.ts 可达图无禁词、cordis import 白名单、host-global-timer 守卫（正反样本表先证判别力；testing.ts 零豁免——§2.M m3）。

### AC13

`pnpm typecheck`（根链已含本包）、全量 `pnpm test`、CI Node 20/24 矩阵（既有 ci.yml）+ `registry-plugin.test.ts` 显式步骤建议追加（`--passWithNoTests=false`，对齐 persistence-contract 门禁先例——列入开放问题，默认依赖全量 test 已覆盖）。

---

## §8. 风险与开放问题

### 风险

- **R1（最大风险）persistence adapter drain 与 Registry shutdown 的残余并发**：Cordis 4.0.1 的 fiber `_unload` 对本级 disposables 用 Promise.all 并发（§5#6）；Memory/File persistence 把 adapter `dispose()` 注册为 service provide 的**同级** effect——persistence fiber 卸载时，adapter 的「closed=true+abort+destroy docs」与依赖级联触发的 Registry shutdown 并发执行。后果：shutdown 期间 runtime close 的写排空/saveDoc/release 可能撞上已销毁 handle → close 失败 → 进入聚合错误（诚实、响亮、不静默）。依赖图保证的是 **fiber 级**次序（Registry settle 先于 persistence fiber 卸载完成，§5#5），非 adapter 内部排空次序。缓解已内置：shutdown 聚合错误即为此类失败的设计通道；plugin.ts 头注固化宿主接线契约（registry fiber 先于 persistence fiber 显式 dispose 的宿主可获严格序）。根治（persistence 将 adapter dispose 串行化进 provide disposer 之后）超出本票 DENY 边界，建议后续票。
- **R2 测试面机械迁移（85 处工厂调用 + 4 处 internal fixture，R1/m4 口径）**：`scheduler` 必需化触及全部既有测试文件（registry-open 33 + registry-create 47 + node-dispose 2 + surface 3 的 `createNamespaceRegistryForTesting` 调用，另 registry-create 4 处 `createRegistryInternal` fixture）。缓解：单一 `createRegistryTestScheduler()` helper、纯追加字段、既有断言零改动（§7 修改清单已逐文件列明）；SA4 比对以 ALLOW LIST 为界。
- **R3 close 永挂起传导**：runtime release 永不 settle → open/create 的 closing-wait 与 shutdown 均挂起（ADR-0008「不取消、不设内部 timeout」契约行为）。已以测试 12 显式锚定其为等待而非崩溃。
- **R4 inject 的 PENDING 语义与 AC3 字面张力**：`ctx.plugin` 装载路径下缺依赖表现为 cordis 原生依赖门（PENDING、零半启动），非 apply 栈 throw；loud-fail 由直接 apply 路径与形状断言承载（§2.F 双机制，**R1/M1 已落纸双通道裁决与 28a 测试锚**）。若 SA2/总控判 AC3 要求 `ctx.plugin` 路径也必须 throw，则需放弃 inject（代价：丢失 AC11 的依赖图机制，须改为纯宿主接线契约）——总控 R1 已裁决维持双机制，本项转为记录性风险。
- **R5 fiber reload 回收**：persistence 服务重启 → Registry 全量重建（lease 失效）。v1 冻结接受（§2.F）；观测面为 service 撤销+重提供。

### 开放问题

1. CI 是否为 `registry-plugin.test.ts` 增加显式 workflow 步骤（对齐 persistence-contract 门禁）——影响 `.github/workflows/ci.yml`（当前 DENY）；默认不加，依赖全量 `pnpm test`。
2. persistence 侧 dispose 串行化（R1 根治）是否立后续票。
3. idle 容量上限/LRU/explicit eviction 为 Phase 4 非目标（ADR-0009:50 冻结），本票零预留。

---

## SA2 反馈逐条回应（R1 修订，总控裁决：全部局部改动、A–M 主裁决维持）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| H1：beginIdleClose 增 arm-token 判别 | ✅ | §2.B（handleLeaseReleased 武装闭包 + 不变量 I4）、§7 测试 3a | 武装闭包捕获本次 handle，回调首查 `entry.idleTimerHandle !== handle` 失配即 no-op；activateEntry/shutdown 取消段置 undefined 天然使旧 token 失配；新增不变量 I4（timer 回调仅 token 匹配时生效）；§7 新增 adversarial scheduler 红灯（旧回调 no-op、新 timer 存活、完整窗口后才 close） |
| M1：AC3 双通道裁决落纸 + 头注契约 + PENDING 测试 | ✅ | §2.F（「AC3 双通道裁决」节 + 「plugin.ts 头注宿主接线契约」节）、§7 测试 28a | 通道 A（直接 apply：apply 栈 throw 在场+形状 loud 门）/通道 B（ctx.plugin：inject PENDING 门=不半启动、零 service、零 fallback，非静默降级）双通道语义落纸；头注契约三条（timer⊇registry、AC11 fiber 级解读、reload）；28a 锚 fiber 非 ACTIVE + service/instance undefined + 补装后转 ACTIVE |
| M2：测试 25 探针次序修正 | ✅ | §7 测试 25 | 次序改为 `shutdownStarted → statusWhileDisposing → shutdownSettled → serviceRevoked`；注明 serviceRevoked 以 `ctx.get('nomicoreRegistry')===undefined` 首个可观测时刻为准（provide disposer 的 delete store[key] 同步发生） |
| M3：DEFAULT_IDLE_TIMEOUT_MS 单点化 | ✅ | §2.A、§2.F（plugin.ts re-export 形态）、§2.G（导出链注记） | 常量唯一运行时定义点在 registry.ts（与 resolveIdleTimeoutMs 同居）模块级导出；plugin.ts `export { DEFAULT_IDLE_TIMEOUT_MS } from './registry.js'` 仅 re-export；index.ts 沿 plugin 链转出——三处文本同步，零第二定义点 |
| M4：open 测试 1101 腿精确化 + 零回显边界注记 | ✅ | §7 测试 19、「修改文件断言迁移」节 | 1101 腿仅锚 resolve undefined + getStatus stopped（零 stringify 入负锁循环）；shutdown 零回显改由测试 19 断言 message 恒定常量；结构化 failures 字段与 cause 不进 sentinel 负锁——注明 ADR-0009:95 纪律为 message 级、结构化字段是显式边界（FatalError.cause 同款先例） |
| M5：测试 15 增 adversarial 变体 | ✅ | §7 测试 15a | 与 3a 共用注入面：取出回调不执行 → shutdown → 手动触发旧回调 → 断言恰单次 close、聚合不重复收录、终态 stopped |
| m1：两处 ADR-0009:54→:50 | ✅ | §2.B（runOpenSlot catch 注释 + open reject 裁决段） | 两处引用均改为 ADR-0009:50（idle 保留节原文所在行） |
| m2：I1 域限定 | ✅ | §2.B 不变量 I1 | I1 等价域限定为 acceptance==='running' 期间；shutdown 同步段取消后至步骤 2 翻相前为唯一豁免窗口（phase==='idle' ∧ handle===undefined） |
| m3：守卫 2 收紧（testing.ts 零豁免） | ✅ | §2.M 静态守卫 2 | 守卫覆盖全部 src/*.ts 含 testing.ts——createRegistryTestScheduler 为纯 map 队列 fake 零 native timer，豁免无必要；如未来需豁免须注明具体成员与理由（当前零豁免） |
| m4：R2 口径修正 | ✅ | §8 R2 | 「~85 处测试工厂」改为「85 处工厂调用 + 4 处 internal fixture」（含逐文件计数） |
| O1：AC11 解读补句 | ✅ | §2.F 头注契约第 2 条 + 「先于 Persistence dispose」段首 | 「先于 Persistence dispose」= fiber 级（Registry fiber 卸载完成含 shutdown settle 与 service 撤销，先于 persistence fiber 卸载完成）；adapter 级排空次序为 §8 R1 残余并发声明 |
| O2：头注契约补 timer-plugin 先卸后果 | ✅ | §2.F 头注契约第 1 条 | timer plugin 先卸 → pending idle timer 静默清除（回调不触发）→ entry 滞留 idle（无自发 close）直至 open 激活或 shutdown 关闭（idle 回收停摆、不崩溃不泄漏）；其后 ctx.timeout 调用抛 INACTIVE_EFFECT 属宿主接线违约，不在 plugin 内防御 |
