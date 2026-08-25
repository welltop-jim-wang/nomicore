# Design — issue #107：persistence 迁移 `nomicorePersistence` 与外部 Clock/Timer

> **R1（2026-08-25）**：按 SA2 评审报告（`task_persistence-timer-service-migration_sa2_review.md`，verdict=FAIL）修订——B1（AC4 守卫正则改为只禁 host 全局 API + 守卫判别力样本表）、B2（clock/src/contract.ts:28 doc-only 例外进 ALLOW + 裁决 9/§10 假设 8 证据重跑修正）、B3（裁决 6 不变式 ③「单一虚拟时间基」+ wiring 伪码 + timeline 基线红灯单测）三项阻断全部落实；MINOR #4–#15 逐条清零。修订对照见文末「SA2 反馈逐条回应」。十条裁决的架构方向 R0→R1 无变化。

- worktree：`/home/wangjian/nomicore-fix-issue-107`（branch `fix/issue-107-on-docs-namespace-registry`）
- 设计基准：ADR-0009（`docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md`，「模块与 Cordis service」节 + 第 83 行 Clock/Timer 分工与确定性测试纪律）、`docs/phases/phase-4-namespace-registry.md`（集成模型图：Timer plugin → `ctx.timeout()`、`@nomicore/clock` → `ctx.clock`、Nomicore Persistence → `ctx.nomicorePersistence`）
- 现状侦查已核对：`packages/persistence/src/{contract,lifecycle,memory,file,testing,index}.ts`、`packages/dsh-persistence/src/{profile,clock,probe,events,index,cli}.ts`、两包全部测试、`packages/clock/src/*`、`packages/namespace-runtime/src/*`（仅 type-only 消费 `DocHandle`/`DocHandleStatus`）、两包 `package.json`、根 `package.json`/`pnpm-workspace.yaml`
- 第三方 API 已实测核实：`@deepseek-ai/cordis-plugin-timer@1.1.3` npm tarball 解包读源码（见 §10 协议假设依据）；`@deepseek-ai/cordis@4.0.1`（worktree node_modules）`Service`/`Fiber`/`ReflectService` 源码逐段核实

---

## §1 目标与非目标

### 目标（全部可追溯到 issue #107 AC1–AC8）

1. Cordis service 名 `docPersistence` → `nomicorePersistence`：常量、Context augmentation 属性、provide/require helpers、全部消费方（probe、DSH profile、全部测试）同步更名。
2. Persistence plugin 启动强依赖 `clock`（`@nomicore/clock`）与 Cordis `timer`（`@deepseek-ai/cordis-plugin-timer` 的 `ctx.timeout`）：缺失任一在 provide service 之前 loud throw。
3. 所有一次性延迟调度（debounce / max-dirty / retry）经 lifecycle-managed `ctx.timeout()`。
4. 删除 `systemPersistenceTimer` 与 `PersistenceTimer`：包内零自建 system/global timer、零 `Date.now()`。
5. 调度缝与 wall-clock 观测分离：调度缝无 `now` 成员；Clock 只作 wall-clock 观测。
6. Memory/File Adapter 的 debounce、max-dirty、single-flight flush、degraded/retry 退避、generation 保序行为**零回归**（调度状态机逻辑不动，只换缝）。
7. DSH profile 接线先装 clock+timer 再装 persistence；probe 确定性 record 逐字节不变。
8. 文档/共享 contract tests/service 常量与新名一致；`pnpm typecheck` + `pnpm test` 全绿。

### 非目标（护栏）

- **Persistence package 重命名**（phase-4 非目标原文）：`@nomicore/persistence`、`@nomicore/dsh-persistence` 包名不变。
- Persistence typed load/create operational errors 与 committed-aware create fatal（phase-4 切片 3，独立任务）。
- Registry 的任何实现（切片 4–7）。
- Persistence 业务行为变更：不新增 clock.now() 的业务消费（persistence 现不读写 wall time；不发明用途——见裁决 4/风险 9）。
- `DocHandle`/`User`/`DocHandleStatus`/`DocDuplicateError`/`resolvePersistenceSchedule`/`DEFAULT_PERSISTENCE_SCHEDULE` 名称与语义冻结。
- wiki/raw 历史档案不改。

---

## §2 十个设计问题的裁决（结论 + 理由 + 替代方案驳回）

### 裁决 1：调度缝形状 —— 保留最小 scheduler 接口 `{ setTimeout, clearTimeout }`（删 `now`），桥接代码放新模块 `src/service.ts`

**结论**：`PersistenceLifecycle` 保留注入缝，改名并削减为（**R1/B1：必须用 property-signature 形态**，与现行 `PersistenceTimer` 的书写风格一致，且是 §6.9 AC4 静态守卫正则可判别的前提——method-signature 形态 `setTimeout(...)` 会以裸标识符 + `(` 形态被守卫的负向 lookbehind 漏排）：

```ts
export interface PersistenceScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}
```

桥接函数 `createCordisPersistenceScheduler(ctx)` 放在**新文件 `packages/persistence/src/service.ts`**（Cordis 接线叶子模块：依赖断言 + ctx.timeout 桥 + provide 辅助），由 `memory.ts`/`file.ts` 的 plugin 工厂消费。桥接体：

```ts
setTimeout: (callback, delayMs) => ctx.timeout(callback, delayMs),
clearTimeout: (handle) => { (handle as () => void)() },
```

`ctx.timeout(cb, ms)` 返回幂等 disposer（已核实 timer 插件源码：effect wrapper 有 `if (disposing) return disposalTask` 单次守卫；timer 触发时先 `dispose()` 再 `callback()`），**disposer 即 handle**，`clearTimeout(handle) === handle()`：触发前调用取消底层 native timer，触发后调用是无害清理——与 `clearTimeout(handle)` 语义精确对齐。

**理由**：(a) `lifecycle 从不调用 timer.now()`（现行 545 行已核实零调用），`now` 是死重；AC5 要求 Clock/Timer 职责分离，缝里删 `now` 把该纪律写进类型。(b) lifecycle 保持 Cordis-free 普通模块（module-graph DAG 纪律：`service.ts` 是 Cordis 接线叶子，`lifecycle.ts` 不 import 它，无环）。(c) `ctx.effect`-free 的 lifecycle 使直连构造测试不需要 Cordis fiber。

**驳回**：
- 「lifecycle 直接持有 ctx、直接调 ctx.timeout」——把 Cordis 类型引入 lifecycle 核心，破坏「Host 无关 lifecycle 内核」分层与 module-graph 回归守卫（`lifecycle.ts` 不得反向依赖接线层）；且直连构造路径（测试主力）被迫拖一个 Cordis Context。
- 「保留 `now()` 以备将来」——YAGNI 且违反 AC5 的字面纪律；将来真需要 wall-clock 观测应经 `ctx.clock`（AC5），不是调度缝。

### 裁决 2：直连构造路径 —— 保留显式 **必填** `scheduler` 构造参数（无默认、不可选）；确定性测试走「adapter 构造器显式 scheduler 注入」，Cordis 组合测试另配 fake timer plugin

**结论**：`MemoryPersistenceOptions` / `FilePersistenceOptions` / `PersistenceLifecycle` 构造 options 中 `timer?` 删除，替换为**必填** `scheduler: PersistenceScheduler`（`exactOptionalPropertyTypes` 下直接写必填成员，非 `| undefined` 可选）。plugin 工厂（`createMemoryPersistencePlugin` / `createFilePersistencePlugin`）的 options 类型为 `Omit<XxxPersistenceOptions, 'scheduler'>`，在 `apply(ctx)` 时才构造 adapter 实例（现行已是延迟构造），用 `createCordisPersistenceScheduler(ctx)` 派生 scheduler 注入。

测试 seam 采用**双轨**：
- **行为套件**（memory/file/issue-79/sa7 等全部直连构造测试）：显式注入 fake scheduler（`= createTestScheduler()`，虚拟时钟 advanceBy/pending，无 `now`）——即「adapter 构造器显式 scheduler 参数」路线。
- **Cordis 组合测试**（core-dsh-boundary、persistence-contract、file/memory 的 apply 段、dsh profile/probe 全部）：经 **fake Cordis timer plugin**（`createFakeTimerPlugin`，提供 `'timer'` service + mixin 伪造 `ctx.timeout`）+ manual clock plugin 走真实接线。

**为何这不算违反 AC4**：AC4 禁的是 Persistence「提供或 fallback 到自建 system/global timer」。fake scheduler 是**测试显式注入的受控替身**（testing seam），不是 Persistence 提供的实现，更不是 fallback——生产路径（plugin 工厂）唯一入口是 `ctx.timeout`，包内不存在任何 `setTimeout`/`Date.now` 调用（新增静态守卫测试机械钉死，见 §6）。该形态与 ADR-0009:83「确定性测试使用 manual Clock 状态与 fake timer 协调推进」逐字一致。

**两条路线的评估与取舍**：
- 「全部走 fake Cordis timer plugin + Cordis 组合」：单一缝最纯，但 ~7 个测试文件、约 45+ 个构造点要改为 `new Context()` + 装双插件 + async fiber teardown，行为断言与 Cordis 生命周期耦合（apply/fiber.dispose 异步化），对 AC6「零回归」引入大且无收益的机械风险；且 ADR-0009:83 的字面是「fake timer」，不是「fake Cordis plugin」。
- 「只留构造器 scheduler、不做 fake timer plugin」：plugin 路径的 `ctx.timeout` 桥接（AC3 的字面落点）将没有任何确定性测试覆盖，probe 与 profile 也失去注入点。
- 故取双轨：行为确定性靠显式 scheduler（低风险零回归），接线正确性靠 fake timer plugin（覆盖 AC2/AC3 的 Cordis 面）。

**驳回**：「scheduler 可选 + 默认」= AC4 违规，直接排除；「移除构造器选项、只能走 plugin」见上。

### 裁决 3：plugin 启动强依赖 —— 共享 `assertPersistenceHostDependencies(ctx)`，在 `ctx.effect(provide)` **之前**同步执行；错误文案镜像 `requireClock` 纪律

**结论**：`src/service.ts` 导出（包内使用，不进公共 index）：

```ts
export function assertPersistenceHostDependencies(ctx: Context): void {
  requireClock(ctx) // 缺失 → throw 'required Cordis service "clock" is unavailable'（复用 @nomicore/clock 现有文案）
  const timer = ctx.get('timer') as { timeout?: unknown } | undefined
  if (timer === undefined || typeof timer.timeout !== 'function') {
    throw new Error(
      'required Cordis service "timer" is unavailable: '
      + 'install @deepseek-ai/cordis-plugin-timer before the persistence plugin',
    )
  }
}
```

时序（两个 adapter 的 `apply(ctx)` 同构，`createCordisPersistenceScheduler` 内部先调 assert）：

```ts
apply(ctx: Context): void {
  assertPersistenceHostDependencies(ctx)   // ① loud fail 在任何 provide 之前
  ctx.effect(() => {
    provideNomicorePersistence(ctx, this)  // ② service 发布
    return () => this.dispose()
  }, 'memory-persistence: service')
}
```

**检测手段依据**（已核实 cordis 4.0.1 `reflect.ts`）：`ctx.get(name)` 的实现只查 store、查不到返回 `undefined`，**从不 throw**——是安全的启动期探针（比探测 `ctx.timeout` 属性稳健：后者在非 root fiber 上、属性未声明时访问会 throw "cannot get property without inject"）。真实 TimerService 与 fake plugin 都在**同一 fiber** 上先 `provide('timer')` 再 `mixin('timer', ['timeout', …])`（timer 源码 13–16 行），故 service active ⟺ `ctx.timeout` 可解析；再校验 `typeof timer.timeout === 'function'` 兜住「给了 service 但成员缺失」的病态 provider。若某病态 provider 只 provide 不 mixin，首次 `ctx.timeout` 调用会 loud throw（"cannot get property … without inject"），不会静默。

**文案纪律**：稳定、单句、含 service 名与安装指引；不 fallback、不 console.error 后继续。类构造器中不查（构造期无 ctx）；`apply` 是 plugin 启动的唯一入口，检查必在 provide 前（AC2 的「plugin 启动时」字面落点）。

**驳回**：「用 `ctx.inject(['clock','timer'], cb)` 声明式依赖」——cordis 的 inject/fiber 机制经 `_reload()` 的 `await Promise.resolve()` **异步启动**（已核实 fiber.ts），plugin apply 变异步、报错延迟到 fiber 状态机且被 logger 吞掉等级，与「apply 同步 loud fail」的既有包纪律（memory/file 现行同步 apply）和 DSH profile 同步构造模型冲突；本仓全部插件均用「apply 内手动断言」模式（clock 包 `requireClock` 同款），保持一致。

### 裁决 4：符号更名清单 —— service 侧 4 名更名；`DocPersistence` 接口名**保留**；`PersistenceTimer`/`systemPersistenceTimer` **删除**

| 旧 | 新 | 说明 |
|---|---|---|
| `DOC_PERSISTENCE_SERVICE = 'docPersistence'` | `NOMICORE_PERSISTENCE_SERVICE = 'nomicorePersistence'` | 与 `CLOCK_SERVICE='clock'` 命名风格一致（issue #104 决策：service names `clock`/`nomicorePersistence`/`nomicoreRegistry`） |
| `provideDocPersistence(ctx, p)` | `provideNomicorePersistence(ctx, p)` | 签名不变 |
| `requireDocPersistence(ctx)` | `requireNomicorePersistence(ctx)` | 缺失文案 `'required Cordis service "nomicorePersistence" is unavailable'`（镜像 requireClock） |
| Context augmentation `docPersistence: DocPersistence` | `nomicorePersistence: DocPersistence` | ADR-0009:26 字面 |
| `PersistenceTimer`（接口） | **删除**，替换为 `PersistenceScheduler`（无 `now`） | 裁决 1 |
| `systemPersistenceTimer` | **删除**（不提供替换） | AC4：包内不得再有自建 system timer |
| `DocPersistence` / `DocHandle` / `User` / `DocHandleStatus` / `DocDuplicateError` / `PersistenceSchedule` / `DEFAULT_PERSISTENCE_SCHEDULE` / `resolvePersistenceSchedule` | 保留原名 | 见下 |

**`DocPersistence` 保留理由**：(a) phase-4 非目标「Persistence package 重命名」表明包级概念名保持稳定，ADR 只强制 **service 名**迁移；(b) `namespace-runtime` 5 处 type-only 消费 `DocHandle`/`DocHandleStatus` 零改动（已核实），改名接口会扩大无语义收益的 churn；(c) 一致性风险（service 属性叫 `nomicorePersistence` 而接口叫 `DocPersistence`）用 JSDoc 交叉引用钉住：接口注释写明「Cordis service 名为 `nomicorePersistence`（`NOMICORE_PERSISTENCE_SERVICE`）」。**驳回改名**：收益纯审美，代价是跨 3 包 + 9 测试文件的机械 churn，且与「Persistence package 重命名是非目标」的精神相悖。

### 裁决 5：DSH profile 接线 —— 先 `clockPlugin.apply` → `timerPlugin.apply` → persistence plugin；options 的 `timer?: PersistenceTimer` 替换为 plugin 形态的 `clock?` / `timer?` 注入缝；dispose 顺序**不变**

**结论**：`DshPersistenceProfileOptions` 变为：

```ts
export interface DshPersistenceProfileOptions {
  readonly adapter: 'memory' | 'file'
  readonly rootDir?: string
  readonly schedule?: Partial<PersistenceSchedule>
  readonly memoryIo?: DshPersistenceMemoryIo
  /** Clock capability plugin；缺省 = createSystemClockPlugin()（@nomicore/clock）。 */
  readonly clock?: DshCordisPlugin
  /** Timer capability plugin；缺省 = 真实 TimerService（@deepseek-ai/cordis-plugin-timer）。 */
  readonly timer?: DshCordisPlugin
}
// type DshCordisPlugin = { apply(ctx: Context): void }
```

装配顺序（保持 profile 构造**同步**）：

```ts
const ctx = new Context()
;(options.clock ?? createSystemClockPlugin()).apply(ctx)  // ① clock
;(options.timer ?? defaultTimerPlugin).apply(ctx)         // ② timer（真实缺省：{ apply(ctx) { new TimerService(ctx) } }）
apply(ctx)                                                 // ③ persistence plugin（内部再断言依赖 → provide）
```

**关键机制依据**（已核实）：`ctx.plugin()` 的 fiber 经 `_reload()` 首行 `await Promise.resolve()` **异步启动**——同步装配**不能**用 `ctx.plugin(TimerService)`；而 `new TimerService(ctx)` 走 `Service` 构造器（cordis `service.ts`：构造器内**同步** `ctx.reflect.provide(name, self)` + `ctx.mixin(...)`，root fiber 构造即 ACTIVE），service 与 mixin 在 `apply` 返回时已可用——这与 profile 现行「直接 `plugin.apply(ctx)`、同步取得 instance」的模型精确兼容。

**dispose 顺序不变**：`persistence.dispose()`（settle in-flight、清三计时器、销毁 live Y.Doc）→ `ctx.fiber.dispose()`（root fiber 逆序清 effect：persistence service effect 的 cleanup 再跑一次幂等 dispose → timer mixin/provide 注销 → clock 注销）。理由与现行设计相同：adapter 停机有直接 await 点；所有 cleanup 幂等。计时器 disposers 挂在 timer plugin 的 root fiber 上（见风险 1），root fiber dispose 兜底回收任何泄漏的 `ctx.timeout` effect——双保险。

**驳回**：「profile 变 async、用 `ctx.plugin` + await fiber」——破坏现行同步 API（测试与 probe 都同步取 `profile.persistence`），且把装配错误延迟到 fiber 状态机；「`DshPersistenceProfileOptions.timer` 保留旧 PersistenceTimer 形态」——类型已删除，且绕过 Cordis 接线会让 profile 失去 AC3 的 `ctx.timeout` 路径。

### 裁决 6：probe 迁移 —— `ProbeClock`（extends PersistenceTimer）重塑为 `ProbeTimeline`：manual Clock（观测）+ fake timer（调度）**同一虚拟时间线协调推进**；`ProbeRunOptions.timer` → `timeline?: ProbeTimeline`

**结论**：`dsh-persistence/src/clock.ts` 重写（`createDeterministicClock`/`ProbeClock` 删除）：

```ts
export interface ProbeTimeline {
  now(): number                                            // wall-clock 观测（manual clock 状态）
  pending(): number                                        // 已武装未到期计时器数（触发即删，语义同旧）
  advanceBy(milliseconds: number): Promise<void>           // 协调推进：到期序触发 timer + 同步 manual clock
  readonly clockPlugin: DshCordisPlugin                    // 发布 ctx.clock（manual clock）
  readonly timerPlugin: DshCordisPlugin                    // 发布 'timer' + mixin ctx.timeout（fake 虚拟计时器）
}
export function createProbeTimeline(): ProbeTimeline
```

单一推进循环（保持 record 逐字节不变的三个不变式，**R1/B3 补不变式 ③**）：

```ts
async advanceBy(milliseconds) {
  const deadline = manual.now() + milliseconds
  while (true) {
    const due = [...timers.entries()].filter(([, t]) => t.at <= deadline).sort(([, l], [, r]) => l.at - r.at)[0]
    if (due === undefined) break
    const [id, timer] = due
    timers.delete(id)        // 不变式 ①：触发前删除——advanceBy 返回瞬间到期腿已消耗（base=0 算术保持）
    manual.set(timer.at)     // 不变式 ②：wall clock 先行到刻度，再触发回调——事件 t 与旧实现逐字节同值
    timer.callback()
    await settle(3)
  }
  manual.set(deadline)
  await settle(3)
}
```

**不变式 ③（单一虚拟时间基，R1/B3 立法）**：`timers` 登记表与虚拟刻度**由 timeline 闭包独占**——`manual`（`createManualClock(0)`）与 `timers` 是 `createProbeTimeline()` 同一闭包内的两个状态槽；`timerPlugin` 注入 `createFakeTimerPlugin` 的 scheduler 是**该表的视图**，其 `setTimeout` 的到期刻度必须以 `manual.now()` 为基：

```ts
// createProbeTimeline() 内部 wiring（timers/manual/nextId 同闭包）
const schedulerView: PersistenceScheduler = {
  setTimeout: (callback, delayMs) => {
    const id = nextId++
    timers.set(id, { at: manual.now() + delayMs, callback })  // ★ 基线 = manual.now()，不是任何独立内部时钟
    return id
  },
  clearTimeout: (handle) => { timers.delete(handle as number) },
}
const timeline: ProbeTimeline = {
  now: () => manual.now(),
  pending: () => timers.size,
  advanceBy,                                    // 上面的单一推进循环
  clockPlugin: createManualClockPlugin(manual), // 发布 ctx.clock ← 同一 manual
  timerPlugin: createFakeTimerPlugin(schedulerView), // 'timer' service + ctx.timeout ← 同一 timers 表
}
```

**禁止形态**：把 `createTestScheduler()`（裁决 7——内部 now 已删、无法被 timeline 读取/推进）或任何**带独立内部时钟**的 scheduler 塞给 `createFakeTimerPlugin`——那样 `at = 内部now + delay` 中内部 now 停在初值，首腿之后所有 deadline 与 manual clock 脱钩，retry 链（`delay×2 cap maxDirtyMs`）全部错位，`dsh-file-probe-determinism` 的 `t=2008/t=2009/events=28` 逐字节断言必红。旧 `ProbeClock` 之所以确定，正因 `now`（观测）与 `at = now + delay`（登记基线）天然同源；不变式 ③ 把这个同源性在新拆分下**显式立法**。该不变式的机械锚点 = §6.13 timeline 基线红灯单测。

probe.ts 改法（逐点）：
1. `resolveProbeClock(options.timer)` 与「可推进性」守卫整体删除——timeline 由 probe 自建（或调用方注入），接口本身要求 `advanceBy`/`pending`，不可推进的输入在类型层消失；file 通道的 `pendingCount` 守卫同样消失（恒可内省）。
2. `const timeline = options.timeline ?? createProbeTimeline()`；`now()` → `timeline.now()`；全部 `clock.advanceBy(x)` → `timeline.advanceBy(x)`；`filePendingCount()` → `timeline.pending()`。
3. profile 装配：`timer: clock` 替换为 `clock: timeline.clockPlugin, timer: timeline.timerPlugin`。
4. `requireDocPersistence` → `requireNomicorePersistence`（service identity 自检语义不变）。
5. 事件时间戳 `t: now()` 语义不变（读 manual clock，与旧单一虚拟 `now` 同值同序）。

**外部观察能力保留**：`timeline.pending()` 即旧 `ProbeClock.pending()`；调用方（dsh-profile-acceptance 的 probe 用例）可自建 `createProbeTimeline()` 传入并在 run 后断言 `pending() === 0`。`settle`/`waitFor`/`ProbeTimeoutError` 原样保留（file 通道真实 I/O 轮询继续用系统时间——它是测试观察器，不是 Persistence 的调度，AC4 不管辖）。

**为何「注入 manual Clock + fake Cordis timer」**：这是 AC5 的 probe 字面落地——`t` 是 wall-clock 观测（经 `ctx.clock` 能力），flush/retry 是 elapsed 调度（经 `ctx.timeout` 能力）；两者由同一虚拟时间线协调推进，即 ADR-0009:83 的「manual Clock 状态与 fake timer 协调推进」。**驳回「单一融合 clock 对象（旧 ProbeClock 形态）」**：那正是把观测与调度焊死在一个接口上的旧模型，AC5 迁移的目的就是拆开它。

### 裁决 7：testing.ts 共享套件 —— `TestTimer` → `TestScheduler`（无 `now`）；fixture 暴露 `scheduler`；两 adapter 契约测试继续**直连构造**注入；新增 `createFakeTimerPlugin` 供 Cordis 组合

**结论**：
- `TestTimer extends PersistenceTimer` → `TestScheduler extends PersistenceScheduler`：成员 `setTimeout/clearTimeout/advanceBy/pending`，实现即现行 `createTestTimer` 主体删 `now`（到期序触发 + 每腿 3 微任务排空，逐字保留）。
- `DocCreateContractFixture`：`readonly timer: TestTimer` → `readonly scheduler: TestScheduler`；套件内部 `fixture.timer.advanceBy/pending` → `fixture.scheduler.advanceBy/pending`（套件断言逻辑零变化——已核实套件从不调 `timer.now()`）。
- 两个 adapter 的 fixture 工厂：`createMemoryPersistence({ timer })` → `createMemoryPersistence({ scheduler })`（直连构造，不经 Cordis）——理由同裁决 2 双轨制：契约套件钉的是**持久层行为**（AC6），Cordis 接线由组合测试另钉。
- `createFakeTimerPlugin(timer)` 新增于 testing.ts（`ctx.provide('timer', fakeService)` + `ctx.mixin('timer', ['timeout'])`，fake 的 `timeout`/`setTimeout` 委托注入的 fake scheduler，`interval/setInterval/throttle/debounce` 抛 TypeError——persistence 永不调用，出现即测试Bug）。
- `withTimeout`/`createDocStore`/`docWithMeta` 等其余导出不变（`withTimeout` 的 `globalThis.setTimeout` 是「never-settling 守卫」，非生产调度，保留并被静态守卫豁免，见 §6）。

**裁决 8 见 §4.G**（依赖与 subpath）。

### 裁决 9：文档同步 —— ADR-0009 为唯一保留命中；clock/src/contract.ts:28 注释为唯一真实残留，doc-only 修订进 ALLOW LIST（R1/B2 修订）

**R1 勘误**：R0 版声称「命中仅 TASK.md、ADR-0009:26 与 phase-4」——两项引文错误（SA2 攻击点 #11 属实）：该 grep 路径列表不含 TASK.md；phase-4 全文无 `docPersistence` 串（只有 `ctx.nomicorePersistence` 前瞻表述）。R1 已重跑真实命令（输出全文记入 §10 假设 8），事实如下：

- 设计收口 sweep 命令（R1 定稿，大小写敏感、覆盖全部旧符号变体）：
  ```bash
  grep -rn "docPersistence\|DOC_PERSISTENCE\|PersistenceTimer\|systemPersistenceTimer\|provideDocPersistence\|requireDocPersistence" \
    CONTEXT.md AGENTS.md README.md docs packages --include='*.ts' --include='*.md' --exclude-dir=node_modules
  ```
- **迁移前真实命中（R1 实测）分三类**：① `docs/adr/0009:26`（迁移句「从 docPersistence 迁移为 nomicorePersistence」——前瞻原文，**保留不动**）；② persistence/dsh 两包 src/test 内全部旧符号引用（本来就在 §4 改动面，迁移后消失）；③ **`packages/clock/src/contract.ts:28`** JSDoc「对齐 provideDocPersistence 模式」——R0 遗漏的唯一真实残留（注意：`provideDocPersistence` 含大写 D，仅 grep 小写 `docPersistence` 会漏报，sweep 必须用完整变体清单）。
- **clock:28 处置（B2 二选一，裁定方案 a）**：ALLOW LIST 增补 doc-only 例外——仅第 28 行注释「对齐 **provideDocPersistence** 模式」→「对齐 provide 型 helper 模式」（不含任何旧符号的措辞）。issue #106/#115 冻结的是 clock 的**行为面与公共 API**；单行 JSDoc 措辞修订零行为、零 API 变更，且 AC7「文档与新 service 名一致」字面要求清掉冻结包内的旧符号引用。DENY LIST 相应加注例外（§9）。
- **迁移后收口预期（§8 步骤 12 门禁）**：上述 sweep 命令输出**恰为 1 行** = `docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md:26`（迁移句，有意保留）；其余零命中。TASK.md（worktree 根的任务跟踪文件）与 wiki/raw 历史档案不在命令路径内，天然豁免。

### 裁决 10：core-dsh-boundary.test.ts —— 「裸 Cordis 独立启动」断言改写为「装上 clock+timer 后仍零 DSH 代码」，并新增「裸 Context 缺依赖 loud fail」负向锚点

**结论**：改写为四段（R1/#13 补负向 C）：
1. **正向**（原测试改写）：`new Context()` → 先 `createSystemClockPlugin().apply(ctx)` + `new TimerService(ctx)`（两依赖均非 DSH 代码）→ persistence plugin `apply` → 断言 `ctx.get('nomicorePersistence') === plugin.instance`、status ready → `ctx.fiber.dispose()` → 断言 service undefined。「核心插件不 import DSH」的边界主张不变：依赖清单是 `@nomicore/clock` + `@deepseek-ai/cordis-plugin-timer`，二者都不是 DSH；文件级断言（`import.meta.resolve('@nomicore/dsh-persistence')` 失败、package.json 依赖清单不含 DSH）原样保留。
2. **负向 A（AC2 锚点）**：裸 Context（不装任何依赖）上 `createMemoryPersistencePlugin().apply(ctx)` 必须 throw `/required Cordis service "clock" is unavailable/`。
3. **负向 B（AC2 锚点）**：只装 clock、不装 timer → throw `/required Cordis service "timer" is unavailable/`。
4. **负向 C（R1/#13，AC2 锚点——file 工厂独立覆盖）**：裸 Context 上 `createFilePersistencePlugin({ rootDir }).apply(ctx)` 同样 throw `/required Cordis service "clock" is unavailable/`——memory 与 file 工厂虽共享 `assertPersistenceHostDependencies` 单点，但各自 apply 入口独立覆盖，防止未来任一工厂重构（如 file 侧绕过共享 helper）时锚点失明。

---

## §3 新公共 API 面（确切签名）

### §3.1 `@nomicore/persistence`（根入口变更后全量）

```ts
// contract.ts（依赖叶子：cordis/yjs 仅 type-only）
export interface User { readonly userId: string }
export type DocHandleStatus = 'ready' | 'persistence-degraded' | 'released' | 'disposed'
export interface DocHandle { /* 不变 */ }
/** Cordis service 名为 nomicorePersistence（NOMICORE_PERSISTENCE_SERVICE）。 */
export interface DocPersistence { createDoc(...): Promise<DocHandle>; loadDoc(...): Promise<DocHandle | null>; saveDoc(...): Promise<void> }
export class DocDuplicateError extends Error { readonly code: 'DOC_DUPLICATE' }   // 不变

export const NOMICORE_PERSISTENCE_SERVICE = 'nomicorePersistence' as const        // ★ 更名
export interface PersistenceSchedule { readonly debounceMs: number; readonly maxDirtyMs: number } // 不变
export const DEFAULT_PERSISTENCE_SCHEDULE: Readonly<PersistenceSchedule>          // 不变（500/5000）
export interface PersistenceScheduler {                                           // ★ 新（替代 PersistenceTimer；R1/B1：property-signature 形态）
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}
export function resolvePersistenceSchedule(config?: Partial<PersistenceSchedule>): PersistenceSchedule // 不变

declare module '@deepseek-ai/cordis' {
  interface Context { nomicorePersistence: DocPersistence }                        // ★ 更名
}
export function provideNomicorePersistence(ctx: Context, persistence: DocPersistence): () => void  // ★ 更名
export function requireNomicorePersistence(ctx: Context): DocPersistence          // ★ 更名
// 删除：DOC_PERSISTENCE_SERVICE / PersistenceTimer / systemPersistenceTimer / provideDocPersistence / requireDocPersistence

// memory.ts
export interface MemoryPersistenceOptions {
  readonly schedule?: Partial<PersistenceSchedule> | undefined
  readonly scheduler: PersistenceScheduler                                        // ★ 必填
  readonly writeSnapshot?: (key: string, snapshot: Uint8Array, signal: AbortSignal) => Promise<void> | void
  readonly readSnapshot?: (key: string, signal: AbortSignal) => Promise<Uint8Array | undefined> | Uint8Array | undefined
}
export class MemoryPersistence implements DocPersistence { /* +apply(ctx) 内先断言依赖 */ }
export function createMemoryPersistence(options: MemoryPersistenceOptions): MemoryPersistence
export function createMemoryPersistencePlugin(options: Omit<MemoryPersistenceOptions, 'scheduler'> = {}): { apply(ctx: Context): void; get instance(): MemoryPersistence | undefined }

// file.ts（同构）
export interface FilePersistenceOptions {
  readonly rootDir: string
  readonly schedule?: Partial<PersistenceSchedule> | undefined
  readonly scheduler: PersistenceScheduler                                        // ★ 必填
}
export class FilePersistence implements DocPersistence { /* 同上 */ }
export function createFilePersistencePlugin(options: Omit<FilePersistenceOptions, 'scheduler'>): { apply(ctx: Context): void; get instance(): FilePersistence | undefined }
```

### §3.2 `@nomicore/persistence/testing`（新受控 subpath，镜像 `@nomicore/clock` 先例）

```ts
// 现有：describeDocPersistenceContract / describeDocCreateContract / DocStoreHooks / createDocStore /
//       DocPersistenceWithCreate / TestTimeoutError / withTimeout —— 契约不变，fixture 字段 timer→scheduler
export interface TestScheduler extends PersistenceScheduler {
  advanceBy(milliseconds: number): Promise<void>
  pending(): number
}
export function createTestScheduler(): TestScheduler          // ★ 替代 createTestTimer（无 now）
export interface DocCreateContractFixture {
  readonly persistence: DocPersistenceWithCreate
  readonly scheduler: TestScheduler                           // ★ 更名
  readonly store: DocStoreHooks
  readonly makeFresh: () => DocPersistence
  readonly dispose: () => Promise<void>
}
/**
 * Cordis fake timer plugin：提供 'timer' service + mixin ctx.timeout，委托注入的 fake scheduler。
 * R1/#8 契约：fake 的 timeout/setTimeout 必须返回 **幂等 disposer `() => void`**（内部包
 * `() => timer.clearTimeout(id)`），不得透传 scheduler 的裸 number id——生产桥接的
 * `clearTimeout(handle) === handle()` 依赖 disposer 形状（裸 id 会静默变 `(number)()` TypeError）。
 * R1/B3 契约：注入的 timer 必须是宿主时间线的**视图**（其 setTimeout 到期基线 = 宿主虚拟刻度，
 * 见裁决 6 不变式 ③）；禁止传入带独立内部时钟的 scheduler。
 */
export function createFakeTimerPlugin(
  timer: Pick<PersistenceScheduler, 'setTimeout' | 'clearTimeout'>,
): {
  /** fake service.timeout 形状（timeout 与 setTimeout 同实现，均返回 () => void）。 */
  apply(ctx: Context): void
}
// 实现要点（伪码）：
//   const service = {
//     timeout: (cb: () => void, delay: number): (() => void) => {
//       const id = timer.setTimeout(cb, delay)          // 登记进宿主时间线（视图）
//       let done = false
//       return () => { if (done) return; done = true; timer.clearTimeout(id) }  // 幂等 disposer
//     },
//     setTimeout(cb, delay) { return this.timeout(cb, delay) },  // 与真实 TimerService 同：委托 timeout
//     interval/setInterval/throttle/debounce: () => { throw new TypeError('fake timer plugin does not implement …') },
//   }
//   ctx.effect(() => {
//     const unregister = ctx.provide('timer', service as unknown as TimerService)
//     const unmixin = ctx.mixin('timer', ['timeout'])
//     return () => { unmixin(); unregister() }
//   }, 'fake-timer: service')
```

### §3.3 `@nomicore/dsh-persistence`（变更后公共面）

```ts
// clock.ts
export interface DshCordisPlugin { apply(ctx: Context): void }
export interface ProbeTimeline {                       // ★ 替代 ProbeClock
  now(): number
  pending(): number
  advanceBy(milliseconds: number): Promise<void>
  readonly clockPlugin: DshCordisPlugin
  readonly timerPlugin: DshCordisPlugin
}
export function createProbeTimeline(): ProbeTimeline   // ★ 替代 createDeterministicClock
export async function settle(ticks?: number): Promise<void>          // 不变
export async function waitFor(predicate: () => boolean, timeoutMs: number, reason: string): Promise<void> // 不变
export class ProbeTimeoutError extends Error { constructor(readonly reason: string) }                    // 不变

// profile.ts
export interface DshPersistenceProfileOptions {
  readonly adapter: 'memory' | 'file'
  readonly rootDir?: string
  readonly schedule?: Partial<PersistenceSchedule>
  readonly memoryIo?: DshPersistenceMemoryIo
  readonly clock?: DshCordisPlugin                     // ★ 新注入缝（缺省 systemClock plugin）
  readonly timer?: DshCordisPlugin                     // ★ 替代 timer?: PersistenceTimer（缺省真实 TimerService）
}
export interface DshPersistenceProfile { /* ctx / persistence（= ctx.get('nomicorePersistence')）/ getStatus / dispose 不变 */ }

// events.ts
export interface ProbeRunOptions {
  readonly adapter: 'memory' | 'file'
  readonly rootDir?: string
  readonly schedule?: Partial<PersistenceSchedule>
  readonly timeline?: ProbeTimeline                    // ★ 替代 timer?: PersistenceTimer
  readonly failFirstFlushes?: number
}
```

---

## §4 逐文件改动计划

### A. `packages/persistence/src/contract.ts`
改：裁决 4 全部符号操作——更名 3 个导出 + augmentation 属性；`PersistenceTimer`/`systemPersistenceTimer` 删除；新增 `PersistenceScheduler`；`DocPersistence` JSDoc 加 service 名交叉引用。其余逐字不动。
为什么：这是依赖叶子，全部更名的单一事实源；保持 cordis/yjs type-only（module-graph DAG 不破坏）。

### B. `packages/persistence/src/lifecycle.ts`
改：`import { systemPersistenceTimer, type PersistenceTimer }` → `import type { PersistenceScheduler }`；`private readonly timer: PersistenceTimer` → `private readonly scheduler: PersistenceScheduler`；构造 options `{ schedule?; timer? } = {}` → `{ schedule?: Partial<PersistenceSchedule> | undefined; scheduler: PersistenceScheduler }`（无默认值行 `this.timer = options.timer ?? systemPersistenceTimer` 删除）；**7 处** `this.timer.` 调用点（R1/#4 计数修正，grep 实证：scheduleFlush 的 434/435/436、scheduleRetry 的 490、cancelDebounce/cancelMaxDirty/clearTimers 的 505/510/517）`this.timer.` → `this.scheduler.`——字段更名由 typecheck 全量兜底，此处枚举仅为 SA3 逐行机械执行防漏。
**不改**：cells 状态机、flush 单飞、generation 记账、retry 退避公式、evict、dispose 序列的任何逻辑行——AC6 零回归的字面承诺。

### C. `packages/persistence/src/service.ts`（新建，~40 行）
内容：§2 裁决 3 的 `assertPersistenceHostDependencies` + 裁决 1 的 `createCordisPersistenceScheduler`；顶部 `import type {} from '@deepseek-ai/cordis-plugin-timer'`（引入 `ctx.timeout`/`ctx.timer` 的模块增强，使桥接类型成立）；runtime 依赖 `requireClock`（`@nomicore/clock`）。
**R1/#15 宿主接线契约（写入文件头 JSDoc，与函数 JSDoc 各一处）**：「timer fiber 生命周期 ⊇ persistence adapter 生命周期」——宿主必须**先装 timer、后停 persistence**（本任务 DSH profile 的 clock→timer→persistence 装配序与 adapter→fiber dispose 序即满足）；若宿主先拆 timer fiber 再使用 persistence adapter，`scheduleRetry`→`ctx.timeout` 会在 native 回调续体里抛 `INACTIVE_EFFECT`（uncaught）——该顺序是宿主接线契约，不在 persistence 内部防御（adapter `closed` 标志只覆盖自身 dispose 路径）。
为什么单独成文件：memory/file 共用；lifecycle 不反向依赖它（DAG）；不进公共 index（接线细节非公共面）。

### D. `packages/persistence/src/memory.ts` / `src/file.ts`
改：options 类型（裁决 2）；构造传参 `{ schedule?, scheduler }`（条件展开保留 exactOptionalPropertyTypes 纪律）；`apply(ctx)` 开头加 `assertPersistenceHostDependencies(ctx)`；`provideDocPersistence` → `provideNomicorePersistence`；plugin 工厂 apply 改为「先 `createCordisPersistenceScheduler(ctx)`（内含断言）→ 再构造实例 → `instance.apply(ctx)`」。file 的 rootDir 校验、路径安全、I/O 实现零改动。

### E. `packages/persistence/src/index.ts`
改：re-export 列表按 §3.1：**删 5 旧名**（`DOC_PERSISTENCE_SERVICE`/`provideDocPersistence`/`requireDocPersistence`/`systemPersistenceTimer`/`PersistenceTimer`），**增 4 新名**（`NOMICORE_PERSISTENCE_SERVICE`/`provideNomicorePersistence`/`requireNomicorePersistence`/`PersistenceScheduler`，R1/#5 计数修正）；不 re-export service.ts。

### F. `packages/persistence/src/testing.ts`
改：裁决 7（TestScheduler/createTestScheduler、fixture 字段更名、新增 createFakeTimerPlugin）；`import type { PersistenceTimer }` → `PersistenceScheduler` + `import type { Context, TimerService }`。

### G. `packages/persistence/package.json`
改：`dependencies` += `"@nomicore/clock": "workspace:*"`、`"@deepseek-ai/cordis-plugin-timer": "^1.1.3"`；`exports` += `"./testing": "./src/testing.ts"`；`version` 0.1.3 → 0.2.0（公共面破坏性更名，semver 0.x 用 minor 表达）。
**dependency 还是 peerDependency：regular `dependencies`**。理由：(a) 全仓既有惯例——cordis 在所有包都是 `dependencies`，无任何包用 peerDependencies；(b) timer 插件自身的 peer（cordis ^4.0.1）已被本包 dependencies 满足，pnpm 单版本策略下无 diamond 风险；(c) peer 会强迫每个传递消费者（dsh、未来 Registry）重复声明，纯 churn；(d) regular dep 保证 timer 包的 Context 模块增强在 typecheck 程序内可见（service.ts 的 `ctx.timeout` 类型依赖它）。**驳回 peer**：本仓是 private workspace 单图，peer 的「宿主自选版本」收益为零。

### H. `packages/dsh-persistence/src/clock.ts`（重写）
裁决 6 全文：`ProbeTimeline`/`createProbeTimeline`（manual clock 来自 `@nomicore/clock/testing` 的 `createManualClock`/`createManualClockPlugin`；fake timer plugin 来自 `@nomicore/persistence/testing` 的 `createFakeTimerPlugin`——注入的是 **timeline 闭包内 scheduler 视图**，R1/B3 不变式 ③ 与 wiring 伪码见裁决 6）；删 `ProbeClock`/`createDeterministicClock`；`settle`/`waitFor`/`ProbeTimeoutError` 保留。

### I. `packages/dsh-persistence/src/profile.ts`
裁决 5 全文：options 双注入缝；缺省 `createSystemClockPlugin()` / 真实 `new TimerService(ctx)` wrapper；装配三步序；`persistence` 字段注释更新为「与 `ctx.get('nomicorePersistence')` 恒等」；dispose 顺序不动；rootDir/memoryIo 冲突校验不动。

### J. `packages/dsh-persistence/src/probe.ts`
裁决 6 的 5 个逐点；S1–S4 场景脚本、memoryIo 观察通道、file 通道 waitFor 算术、teardown 纪律（先拆 destroyed 监听再 dispose）**零改动**（只有 `clock.` → `timeline.` 前缀替换与 profile 装配参数替换）。

### K. `packages/dsh-persistence/src/events.ts` / `src/index.ts`
events：`ProbeRunOptions.timer` → `timeline?: ProbeTimeline`（import type 自 clock.js，无环：clock.ts 不 import events.ts）。index：`createDeterministicClock`/`ProbeClock` 导出替换为 `createProbeTimeline`/`ProbeTimeline`/`DshCordisPlugin`；其余不变。`cli.ts`/`record.ts` 零改动（已核实 cli 不传 timer，record 只消费 schedule）。

### L. `packages/dsh-persistence/package.json`
`dependencies` += `"@nomicore/clock": "workspace:*"`、`"@deepseek-ai/cordis-plugin-timer": "^1.1.3"`；version 0.1.1 → 0.2.0。

### M. 根 `pnpm-lock.yaml`
`pnpm install` 再生成（新增 timer 插件与 cosmokit 已在 lock 的解析边）。`pnpm-workspace.yaml`、根 `package.json`（typecheck 脚本已含 persistence/dsh tsconfig）零改动。

---

## §5 AC → 设计条款映射

| AC | 设计条款 | 机械锚点 |
|---|---|---|
| AC1 service 更名 + 同步消费方 | §2 裁决 4；§4.A/D/E/I/J | `persistence-contract.test.ts` 常量断言 `NOMICORE_PERSISTENCE_SERVICE === 'nomicorePersistence'`；全部 `ctx.get(...)` 断言更名；typecheck 全仓编译期兜底 |
| AC2 强依赖 clock+timer loud fail | §2 裁决 3；§4.C/D | core-dsh-boundary 负向 A/B/C 三锚点（缺 clock / 缺 timer / file 工厂缺 clock 各自 throw 文案，R1/#13） |
| AC3 一次性延迟调度全走 lifecycle-managed `ctx.timeout()` | §2 裁决 1；§4.B/C/D | 桥接是 plugin 路径唯一 scheduler 来源；锚点文件（R1/#14 指名）：`dsh-profile-acceptance.test.ts`（AC4 service 级用例——经 `ProbeTimeline`→`createFakeTimerPlugin`→`ctx.timeout` 桥→虚拟计时器全链驱动 debounce/retry）+ `core-dsh-boundary.test.ts` 正向（真实 `TimerService` 的 `ctx.timeout`）+ §6.9 AC4 守卫（生产路径无第二调度来源） |
| AC4 不提供/fallback 自建 system/global timer | §2 裁决 1/2；§4.B/E | 导出删除 + lifecycle 无默认 + **静态守卫测试**（§6.9，R1/B1 修正：三条 host 全局 API 正则 + 判别力样本表自证，生产六文件零命中，testing.ts 豁免） |
| AC5 Clock 只观测、Timer 管调度 | §2 裁决 1/6；§3.1/§3.3 | `PersistenceScheduler` 无 `now`；probe 的 `t` 读 `ctx.clock`（manual），flush/retry 走 `ctx.timeout`（fake timer） |
| AC6 debounce/max-dirty/single-flight/degraded-retry/generation 零回归 | §4.B（只换缝名）；§2 裁决 2/7 | 共享 contract 套件断言逐字不动；probe record 逐字节比对（determinism 测试）；直连构造确定性保持 |
| AC7 DSH profile、接线、文档、contract tests 一致 | §2 裁决 5/9；§4.H–L | dsh-profile-acceptance 更名断言；文档 grep sweep 证据（§10 假设 8） |
| AC8 typecheck/test 全绿 | §8 实施顺序第 11 步（唯一全量门禁点，R1/#10：步骤 2–10 期间只跑包内定点验证） | `pnpm typecheck`（8 包 tsc）+ `pnpm test`（vitest --typecheck） |

---

## §6 测试迁移计划（逐文件）

| # | 文件 | 改法 | 确定性保证 |
|---|---|---|---|
| 1 | `packages/persistence/test/memory-persistence.test.ts` | **保留本地 `FakeTimer` 仅删 `now`**（R1/#7：唯一方案——192/211 行「cancels the paired timer」两用例的 `cleared()` 断言依赖本地 fake 的 `cleared()` 记账，`createTestScheduler` 无此能力，不得替换）；全部 `{ timer }` → `{ scheduler }`（约 25 处）；512–527 行 Cordis 段：`new Context()` 上先装 `createManualClockPlugin(createManualClock())` + `createFakeTimerPlugin(scheduler)`，断言 `ctx.get('nomicorePersistence')`；516 行 service 事件名同步 | 虚拟时钟 advanceBy 驱动 debounce/maxDirty，断言（含 `cleared()`）零变化 |
| 2 | `packages/persistence/test/file-persistence.test.ts` | fixture 与直连点同 #1；**真实 timer 依赖点迁移**：11 处 `{ rootDir, schedule }` 无 timer 构造点（132/155/161/190/201/219/220/241/271/278/302 行）+ `waitForFlush()`=sleep(250) 共 **7 次运行时调用**（R1/#12 计数修正：源码调用点 2 处 = seedAndFlush 内 104 行 + 直调 138 行；运行时 = 6 个 seedAndFlush 调用 + 1 直调）——改为显式 `createTestScheduler()` 注入，`waitForFlush()` 替换为「`await scheduler.advanceBy(TEST_SCHEDULE.debounceMs)` 触发 + deadline 式 `waitFor(predicate)` 等真实 I/O」（复用 dsh clock.ts 同款轮询语义，本地 ~10 行助手，超时路径 loud throw 同 ProbeTimeoutError 纪律）。**R1/#9 谓词逐用例化**：首写用例（129–150 等）谓词 = `fs.existsSync(snapshotPath)`；**覆盖写用例（300–324 行 chmod 0o444 后二次 flush）文件已存在，谓词必须解码内容**（`Y.applyUpdate` 后断言 `ROOT.rev === 2` 这类 generation 断言）；**时序纪律：`waitFor` 必须先于 `writer.dispose()` 完成**——dispose 经 AbortSignal 掐断在途写，先 dispose 后等待将永不落盘（伪红）；348–363 行 plugin 段装双依赖插件 | 消除 250ms 真实 sleep（更快更稳）；flush 完成由谓词轮询而非固定时长；谓词与断言目标一一对应 |
| 3 | `packages/persistence/test/persistence-contract.test.ts` | 删 `systemPersistenceTimer` 三断言（97–101 行）；`provide/require` 更名 + 新 service 名断言；fake timer seam 测试（80–95）改用 `createTestScheduler`（`now` 断言删除）；`stubPersistence` 不变 | 纯符号迁移 |
| 4 | `packages/persistence/test/issue-79-entry-status.test.ts` | `{ timer }` → `{ scheduler }`（**9 处**构造点，R1/#6 计数修正：57/88/120/162/198/237/277/294/295 行） | 不变 |
| 5 | `packages/persistence/test/issue-79-file-entry-status.test.ts` | `ManualTimer implements PersistenceTimer` → `implements PersistenceScheduler`（删 now）；`{ timer }` → `{ scheduler }`；81/154 行无 timer 构造点补注入（fireOldest 驱动的用例本就虚拟；无计时器用例注入后不推进即无 flush，dispose 清计时器） | 不变 |
| 6 | `packages/persistence/test/sa7-supplementary.test.ts` | `adapterOver(store, timer?)` → `adapterOver(store, scheduler)`；调用点注入 | 不变 |
| 7 | `packages/persistence/test/file-persistence-sa7-dynamic.test.ts` | `ManualTimer` 同 #5 | 不变 |
| 8 | `packages/persistence/test/core-dsh-boundary.test.ts` | §2 裁决 10 四段式（正向装依赖 + 负向缺 clock + 负向缺 timer + R1/#13 负向 C：file 工厂裸 ctx 缺 clock） | 负向用例断言 throw 文案（同步 throw） |
| 9 | `packages/persistence/test/module-graph-regression.test.ts` | deep-import 锚点：`new FilePersistence({ rootDir, scheduler })`、`new MemoryPersistence({ scheduler })`（注入 `createTestScheduler()`）；静态反 barrel 守卫不动（service.ts 自动纳入扫描）；**新增 it()：AC4 静态守卫（R1/B1 重写）**——守卫目标 = **host 全局 timer API，非任何同名调用**。三条正则（扫描前先剥注释与字符串字面量，复用本文件既有 strip 助手）：① `/(?<![\w$.])(?:setTimeout\|setInterval\|clearTimeout\|clearInterval)\s*\(/`（裸调用；负向 lookbehind 排除 `scheduler.`/`globalThis.` 属性调用，变长 lookbehind 仓内先例 = 本文件 34 行）；② `/\bglobalThis\s*\.\s*(?:setTimeout\|setInterval\|clearTimeout\|clearInterval)\s*\(/`（现行 `systemPersistenceTimer` 的确切形态）；③ `/\bDate\s*\.\s*now\s*\(/`。**守卫自带判别力样本表先证后扫**（同文件 `guard matches import/export statements only` 先例）：合法样本 `this.scheduler.setTimeout(cb, 10)`、`timer.setTimeout(cb, 10)`（属性调用）、`readonly setTimeout: (cb, ms) => unknown`（接口/对象字面量 property-signature 成员位，R1/B1 要求 §3.1 接口即此形态）、注释/字符串内提及；非法样本 `setTimeout(cb, 10)`、`globalThis.setTimeout(cb, 10)`、`clearTimeout(x)`、`Date.now()`——样本表断言全过后才扫 `src/{contract,lifecycle,memory,file,index,service}.ts` 六文件，三正则零命中（testing.ts 豁免：`withTimeout` 是 never-settle 测试守卫，非生产调度） | 样本表自证判别力（旧版 `\b` 正则对本设计自身的 scheduler 缝签名 ≥9 处误报、任何正确实现下永不绿——B1 教训）；文本扫描即机械证据 |
| 10 | `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` | 本地 `FakeTimer`（now/setTimeout/clearTimeout/advanceBy/pending/cleared）整体替换为 `createProbeTimeline()`；profile 用例：`{ adapter, rootDir?, clock: t.clockPlugin, timer: t.timerPlugin }`，`timer.advanceBy/pending` → `t.advanceBy/pending`；probe 用例：`{ adapter, timeline: t, failFirstFlushes }`；`DOC_PERSISTENCE_SERVICE` → `NOMICORE_PERSISTENCE_SERVICE`（148/477 行）；`PersistenceTimer` import 删除；**R1/B3 新增 describe：`ProbeTimeline` 确定性基线**（见 #13 行） | 同一虚拟时间线协调推进；断言目标值逐字保留 |
| 11 | `packages/dsh-persistence/test/dsh-probe-cli.test.ts` | import 面核对后预期仅符号级（若引用旧导出则同步）；CLI 不传 timer，行为不变 | record 断言不变 |
| 12 | `packages/dsh-persistence/test/dsh-file-probe-determinism.test.ts` | 不传 timer（已核实 73 行只传 adapter/rootDir）→ 预期零改动或仅 import 面；record 逐字节断言继续钉 AC6/确定性 | probe 内建 timeline 从 0 起，事件序与刻度与旧实现同构（§2 裁决 6 三不变式） |
| 13 | `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts`（新增 describe，R1/B3） | **`ProbeTimeline` 单一虚拟时间基基线红灯单测**（裁决 6 不变式 ③ 的机械锚点）：同一 timeline 上 `await timeline.advanceBy(500)` 后 `setTimeout(cb, 10)`（经 `timeline.timerPlugin` 装配的 ctx 或直接经视图）→ 断言 `pending() === 1`；`await timeline.advanceBy(10)` 恰触发该回调；**触发时刻 `now() === 510`**；再断言 `pending() === 0`。反例不可绿性：若实现把带独立内部时钟的 scheduler（如 `createTestScheduler()`）塞给 `createFakeTimerPlugin`，`at = 0 + 10` 已在 advanceBy(500) 时被消耗/错位，`now()===510` 与「恰触发」断言必红 | 钉死不变式 ③；determinism 三跑逐字节锚（#12）叠加 = probe 确定性双保险 |

---

## §7 风险清单

| # | 风险 | 分析与缓解 |
|---|---|---|
| 1 | **`ctx.timeout` 的 effect 归属**：timer 插件的 `timeout()` 把 effect 注册在 **TimerService 自己的构造 ctx**（`this.ctx.effect`，已核实源码），不是调用方 persistence 的 fiber——persistence fiber dispose **不会**自动取消已武装延迟 | 缓解已内建：adapter `dispose()` 显式 `clearTimers(entry)`（经 disposer 取消），且 effect cleanup 幂等；DSH profile 的 root fiber dispose 兜底回收任何残余 disposers。顺序「adapter dispose → ctx.fiber.dispose()」保持 |
| 2 | **`ctx.plugin()` 异步启动**（`_reload` 首行 `await Promise.resolve()`，已核实）：若 profile 用 `ctx.plugin(TimerService)` 同步装配，apply 返回时 'timer' 尚未 provide → persistence 断言误炸 | 设计明确：profile 一律直接 `plugin.apply(ctx)`；真实 timer 缺省用 `new TimerService(ctx)`（Service 构造器同步注册，已核实）。组合测试同理直接 apply |
| 3 | **`ctx.timeout` 在「effect 外」调用**（即不在任何插件 apply 栈内调用）的语义：无问题——effect 挂在 timer plugin 的 root fiber 上，与调用栈无关；但 root fiber 已 dispose 后调用会 `assertActive` throw INACTIVE_EFFECT | persistence `closed` 标志保证 dispose 后不再武装；负向路径 flush 的 `this.closed` 早退先于调度 |
| 4 | **probe 确定性回归**：advanceBy 循环任何时序抖动都会破坏 record 逐字节断言 | **三**个不变式写入裁决 6（触发前删登记、manual.set 先于回调、**R1/B3 单一虚拟时间基**）；`settle(3)` 微任务排空逐字保留；timeline 基线单测（§6.13）+ determinism 三跑锚（§6.12）双钉 |
| 5 | **module augmentation 冲突**：clock（`Context.clock`）、timer（`Context.timer` + 6 mixin 成员）、persistence（`Context.nomicorePersistence`）三方声明合并 | 全部 additive interface merging，无同名成员；timer 增强经 service.ts 的 type-only import 进入 persistence/dsh 编译程序；namespace-runtime/doc-runtime 程序不含 service.ts，其 Context 类型不受污染（它们不消费这些成员） |
| 6 | **同 ctx 重复 provide('timer')**：真实+fake 同装会 throw "service has been registered" | 测试各自 `new Context()`（现状即如此）；属 loud 正常行为 |
| 7 | **exactOptionalPropertyTypes**：options 展开遗漏 `\| undefined` 会 TS2379 | §3 类型全部显式 `schedule?: … \| undefined`；scheduler 为必填成员；条件展开模式沿用 |
| 8 | **真实 timer 文件测试迁移**（file-persistence：11 处无 timer 构造点 + `waitForFlush()`=sleep(250) 共 **7 次运行时调用**——源码 2 处调用点：seedAndFlush 内 104 行 + 直调 138 行，运行时 = 6 seedAndFlush 调用 + 1 直调；R1/#12 计数修正）：虚拟化后 flush 完成需等真实 fs I/O | advanceBy 触发后用 deadline 式谓词轮询（dsh `waitFor` 同款，5s 上限），不依赖固定轮次/时长；**谓词逐用例化 + waitFor 先于 dispose**（§6.2，R1/#9：首写=存在、覆盖写=解码内容；dispose 经 AbortSignal 掐在途写，先 dispose 后等待永不落盘） |
| 9 | **clock 依赖被断言但未被消费**的「死重」质疑 | 这是 AC2/ADR-0009:83 的 Host 契约声明（Persistence 与 Registry 都依赖外部 Clock 与 Timer），非业务消费；future typed-error/Registry 阶段消费。设计显式承认并记录，不发明用途（发明 = scope creep + 违反「Persistence 只保存不解释 createdAt」的 CONTEXT.md 术语） |
| 10 | **锁文件/CI**：新增 npm 依赖 | `pnpm install` 一次；Node 20/24 矩阵由外层 CI 负责（任务边界） |

---

## §8 实施顺序建议（SA3 可按序执行）

> **R1/#10 中间态纪律**：步骤 2–7 期间包内 typecheck/test 必红（结构性中间态，已在各步标注）；此区间**禁止跑 `pnpm typecheck` / `pnpm test` 全量门禁**（根 typecheck 串联 8 包、vitest 全仓收集，跨包红点无信息量）——只允许包内定点验证：`pnpm exec vitest run packages/persistence/test/<file>` 或 `pnpm exec tsc -p packages/persistence/tsconfig.json --noEmit`（预期能过时才跑）。全量门禁仅两处：步骤 11 之后（typecheck+test）与步骤 12（文档 sweep）。

1. `packages/persistence/package.json` + `packages/dsh-persistence/package.json` 依赖与 exports/testing subpath、版本号 → `pnpm install`（timer 插件落地）。
2. `src/contract.ts`（更名 + PersistenceScheduler，property-signature 形态）。
3. `src/lifecycle.ts`（换缝 7 处；此时包内编译应只剩 memory/file/testing 红点）。
4. `src/service.ts` 新建（断言 + 桥 + R1/#15 生命周期契约 JSDoc）。
5. `src/memory.ts` / `src/file.ts`（options + apply + 工厂）。
6. `src/index.ts` exports（-5 旧名 +4 新名）。
7. `src/testing.ts`（TestScheduler + createFakeTimerPlugin[含 R1/#8 disposer 契约] + fixture 更名）。
8. persistence 测试迁移（§6 #1–#9，含 AC4 静态守卫[判别力样本表先行]与 AC2 负向 A/B/C 锚点）→ 包内定点 `pnpm exec vitest run packages/persistence` 全绿。**此步完成前不跑全量门禁（R1/#10）。**
9. dsh 源迁移：`clock.ts` → `profile.ts` → `probe.ts` → `events.ts` → `index.ts`（cli/record 预期零改动）。
10. dsh 测试迁移（§6 #10–#13，含 R1/B3 timeline 基线单测）→ 包内定点 `pnpm exec vitest run packages/dsh-persistence` 全绿。
11. 全量 `pnpm typecheck && pnpm test`（唯一全量门禁点）。
12. 文档验证 sweep（R1/B2 修订：完整旧符号变体 + 排除 node_modules）：
    ```bash
    grep -rn "docPersistence\|DOC_PERSISTENCE\|PersistenceTimer\|systemPersistenceTimer\|provideDocPersistence\|requireDocPersistence" \
      CONTEXT.md AGENTS.md README.md docs packages --include='*.ts' --include='*.md' --exclude-dir=node_modules
    ```
    **预期输出恰为 1 行**：`docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md:26`（迁移句前瞻原文，有意保留）；其余零命中（含 `packages/clock/src/contract.ts`——第 28 行注释已按 ALLOW LIST doc-only 修订）。stdout 原样贴入 REPORT 作为机械证据。注意：该命令路径不含 wiki/raw 与 TASK.md，二者天然豁免。

---

## §9. 文件清单（File Scope）

### ALLOW LIST

- `packages/persistence/src/contract.ts` — 修改，service 更名 + PersistenceScheduler + 删 system timer（§4.A）
- `packages/persistence/src/lifecycle.ts` — 修改，仅换调度缝名（§4.B，~10 行）
- `packages/persistence/src/service.ts` — **新建**，依赖断言 + ctx.timeout 桥（§4.C，~40 行）
- `packages/persistence/src/memory.ts` — 修改，options/apply/工厂（§4.D）
- `packages/persistence/src/file.ts` — 修改，同构（§4.D）
- `packages/persistence/src/testing.ts` — 修改，TestScheduler + createFakeTimerPlugin + fixture 更名（§4.F）
- `packages/persistence/src/index.ts` — 修改，导出面（§4.E）
- `packages/persistence/package.json` — 修改，依赖 + ./testing subpath + 版本（§4.G）
- `packages/persistence/test/memory-persistence.test.ts` — `[SA6 共享]` 迁移：scheduler 注入 + Cordis 段装依赖（§6.1）
- `packages/persistence/test/file-persistence.test.ts` — `[SA6 共享]` 迁移：同上 + 真实 timer 用例虚拟化（§6.2）
- `packages/persistence/test/persistence-contract.test.ts` — `[SA6 共享]` 符号迁移 + 新 service 名断言（§6.3）
- `packages/persistence/test/issue-79-entry-status.test.ts` — `[SA6 共享]` scheduler 更名（§6.4）
- `packages/persistence/test/issue-79-file-entry-status.test.ts` — `[SA6 共享]` ManualTimer 改型 + 补注入（§6.5）
- `packages/persistence/test/sa7-supplementary.test.ts` — `[SA6 共享]` adapterOver 签名（§6.6）
- `packages/persistence/test/file-persistence-sa7-dynamic.test.ts` — `[SA6 共享]` ManualTimer 改型（§6.7）
- `packages/persistence/test/core-dsh-boundary.test.ts` — `[SA6 共享]` 四段式改写（正向 + 负向 A/B/C，§2 裁决 10）
- `packages/persistence/test/module-graph-regression.test.ts` — `[SA6 共享]` 构造点补 scheduler + 新增 AC4 静态守卫 it()（R1/B1 三正则 + 判别力样本表）
- `packages/clock/src/contract.ts` — **（R1/B2 追加）仅第 28 行 JSDoc 注释**：「对齐 provideDocPersistence 模式」→「对齐 provide 型 helper 模式」。doc-only 例外：零行为、零 API、零导出变更；issue #106/#115 冻结的是 clock 行为面，本修订只清除旧符号引用以满足 AC7 文档一致性（SA2 攻击点 #2/B2 裁定方案 a；DENY LIST 的 `packages/clock/**` 对本行解除，其余 clock 文件仍冻结）
- `packages/dsh-persistence/src/clock.ts` — 重写为 ProbeTimeline（§4.H）
- `packages/dsh-persistence/src/profile.ts` — 修改，双注入缝 + 装配序（§4.I）
- `packages/dsh-persistence/src/probe.ts` — 修改，裁决 6 五点（§4.J）
- `packages/dsh-persistence/src/events.ts` — 修改，timeline 选项类型（§4.K）
- `packages/dsh-persistence/src/index.ts` — 修改，导出面（§4.K）
- `packages/dsh-persistence/package.json` — 修改，依赖 + 版本（§4.L）
- `packages/dsh-persistence/test/dsh-profile-acceptance.test.ts` — `[SA6 共享]` ProbeTimeline 迁移 + 符号更名（§6.10）
- `packages/dsh-persistence/test/dsh-probe-cli.test.ts` — `[SA6 共享]` 预期仅 import 面核对（§6.11）
- `packages/dsh-persistence/test/dsh-file-probe-determinism.test.ts` — `[SA6 共享]` 预期零改动/仅核对（§6.12）
- `pnpm-lock.yaml` — `pnpm install` 再生成

### DENY LIST

- `packages/namespace-runtime/**` — 仅 type-only 消费 `DocHandle`/`DocHandleStatus`，零改动（已核实 5 处 import）
- `packages/clock/**` — issue #106/#115 交付冻结，只消费不修改。**R1/B2 例外**：`src/contract.ts` 第 28 行 JSDoc 注释单行 doc-only 修订已在 ALLOW LIST 显式解除（见上），其余 clock 文件（含 manual.ts/system.ts/testing.ts/index.ts/package.json）仍全冻结
- `packages/doc-runtime/**`、`packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**`、`apps/**`、`domains/**` — 与 persistence service 无关
- `packages/dsh-persistence/src/cli.ts`、`packages/dsh-persistence/src/record.ts` — 不传 timer、只消费 schedule，零改动
- `packages/persistence/test/memory-testkit.ts` — 只 import `DocHandle`/`User` 类型，零改动
- `docs/adr/**`、`docs/phases/**`、`CONTEXT.md`、`AGENTS.md`、`README.md` — 已核对：ADR-0009:26 迁移句为唯一 docs 命中且有意保留（裁决 9），phase-4/CONTEXT/AGENTS/README 零命中（R1 实测，见假设 8）；本任务不改（若实施中发现新残留，须先回流本设计扩展 ALLOW）
- `wiki/raw/**` — 历史档案
- 根 `package.json`、`pnpm-workspace.yaml`、`tsconfig.*.json` — 零改动

---

## §10. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| 1 | `ctx.timeout(cb, ms)` 返回幂等 disposer（= 取消 handle），effect 挂在 timer plugin 自身 ctx、fiber dispose 自动 clearTimeout（lifecycle-managed） | 设计期实测验证（源码） | npm pack `@deepseek-ai/cordis-plugin-timer@1.1.3` 解包 `src/index.ts:29-53`：`timeout(cb, delay)` = `this.ctx.effect(() => { const timer = setTimeout(() => { dispose(); callback() }, delay); return () => clearTimeout(timer) }, 'ctx.timeout()')`，返回 `dispose`；cordis `fiber.ts` effect wrapper `if (disposing) return disposalTask` 幂等 | LOW |
| 2 | `new TimerService(ctx)` 同步完成 `provide('timer')` + `ctx.mixin('timer', [...])`，apply 返回即可用 | 源码引用 | timer `src/index.ts:12-16`（构造器两步）；cordis `service.ts` 构造器「The service is registered immediately」→ `ctx.reflect.provide(...)`；`reflect.ts` provide 在当前 fiber effect 内同步执行；root fiber 构造即 `state = ACTIVE`（fiber.ts else 分支）→ strict `ctx.get('timer')` 立即非 undefined | LOW |
| 3 | `ctx.plugin()` 异步启动（apply 不在调用栈内同步执行） | 源码引用 | cordis `fiber.ts` `_reload()` 首行 `await Promise.resolve()`——故 profile/组合测试必须直接 `plugin.apply(ctx)`/`new TimerService(ctx)`，不得用 `ctx.plugin` 做同步装配 | MED（设计已规避） |
| 4 | `ctx.get('timer')` 在 service 缺失时返回 `undefined`、从不 throw（安全启动探针） | 源码引用 | cordis `reflect.ts` `get(name, strict=true)` → `_getImpl`：`if (!impl) return` / `if (strict && impl.fiber.state !== ACTIVE) return`——无 throw 路径 | LOW |
| 5 | service active ⟺ `ctx.timeout` mixin 可解析（同 fiber 注册） | 源码引用 | timer 构造器在加载 fiber 上先 provide 后 mixin；`reflect.ts` accessor 随 fiber 卸载移除；mixin get 转发 `ctx['timer']` | LOW |
| 6 | `./testing` subpath 指向 `.ts` 在 vitest/tsc 下可用 | 类比已有验证 | `packages/clock/package.json` exports 已含 `"./testing": "./src/testing.ts"`（issue #106 交付、测试全绿先例） | LOW |
| 7 | timer 插件 peer 约束（cordis ^4.0.1）与本仓兼容 | 官方元数据 + 仓内核实 | `pnpm view @deepseek-ai/cordis-plugin-timer@1.1.3`：peerDependencies `@deepseek-ai/cordis ^4.0.1`；仓内锁定 cordis 4.0.1；dep cosmokit ^1.8.2 已在 lock 中 | LOW |
| 8 | 迁移后文档面旧符号残留面 = ADR-0009:26（有意保留）+ clock/src/contract.ts:28（ALLOW 内 doc-only 修订）；除此之外零残留（**R1/B2 重跑修正**：R0 版引文有两处事实错误——TASK.md 不在该命令路径内、phase-4 全文无 `docPersistence` 串——SA2 #11 属实，本条按真实输出重写） | 设计期实测验证（R1 重跑） | 命令与输出（节选，2026-08-25 worktree 实测）：`grep -rn "docPersistence" CONTEXT.md AGENTS.md README.md docs packages --include='*.ts' --include='*.md' --exclude-dir=node_modules` → 命中 = ADR-0009:26（迁移句）+ persistence/dsh 两包 src/test 内符号（均在 §4/§6 改动面）；`grep -rn "provideDocPersistence" …同路径` → 额外命中 **`packages/clock/src/contract.ts:28`**（R0 遗漏的唯一真实残留；注意 `provideDocPersistence` 含大写 D，仅 grep 小写 `docPersistence` 会漏报——收口 sweep 必须用完整变体清单，见 §8 步骤 12）；phase-4/CONTEXT.md/AGENTS.md/README.md **零命中**。迁移后收口预期：全变体 sweep 恰 1 行 = ADR-0009:26 | LOW |
| 9 | profile dispose 顺序（adapter → fiber）在新依赖下仍成立 | 现有测试引用 | `dsh-profile-acceptance.test.ts:477`（dispose 后 service undefined）、`memory-persistence.test.ts:516-527`（unload exactly once）现行绿色先例；新增的 timer/clock effect 清理均幂等 | LOW |

---

## §11. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动契约清单

| 契约 | 文件 | 改动前 | 改动后 |
|---|---|---|---|
| 导出删除 ×5 | `src/index.ts`（源 `contract.ts`） | `DOC_PERSISTENCE_SERVICE`/`provideDocPersistence`/`requireDocPersistence`/`systemPersistenceTimer`/`PersistenceTimer` | 删除（编译期不可用） |
| `MemoryPersistenceOptions` / `FilePersistenceOptions` | `src/memory.ts`/`src/file.ts` | `timer?: PersistenceTimer`（可选、默认 system） | `scheduler: PersistenceScheduler`（必填） |
| `apply(ctx)` | `src/memory.ts`/`src/file.ts` | 裸 ctx 直接 provide 成功 | **新增无条件 throw**：缺 clock 或 timer 时同步 throw（AC2） |
| Cordis service 名 | `src/contract.ts` | `'docPersistence'` | `'nomicorePersistence'`（运行时字符串） |
| `DshPersistenceProfileOptions.timer` | `dsh src/profile.ts` | `timer?: PersistenceTimer`（透传 adapter） | 删除；新增 `clock?`/`timer?`（plugin 形态） |
| `ProbeRunOptions.timer` | `dsh src/events.ts` | `timer?: PersistenceTimer` | `timeline?: ProbeTimeline` |
| `PersistenceLifecycle` 构造 options | `src/lifecycle.ts` | `{ schedule?; timer? = {} }` | `{ schedule?; scheduler }`（包内） |

### Caller 清单（编译期符号类——typecheck 全仓兜底，逐文件已枚举）

| Caller | 文件:行号（现状） | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 导出删除的全部引用 | persistence `src/{index,lifecycle,memory,file,testing}.ts`；dsh `src/{profile,probe,events,clock}.ts`；persistence test ×9；dsh test ×1 | N/A（import） | N/A | N/A | 全部在 §4/§6 改动清单内；`pnpm typecheck` 编译期兜底（漏改即红） |
| `ctx.get('docPersistence')` 字符串消费 | `memory-persistence.test.ts:516,520,527`；`file-persistence.test.ts:354,363`；`core-dsh-boundary.test.ts:40-48`；`dsh-profile-acceptance.test.ts:148,477`（常量引用） | 否（同步 get） | 否 | 否 | 逐一更名（§6.1/2/8/10）；编译期仅常量引用处兜底，裸字符串处靠清单人工覆盖——已 grep 全量枚举无遗漏 |
| `requireDocPersistence` | `dsh src/probe.ts:190`；`persistence-contract.test.ts:9,109,117` | 否（同步） | probe：外层 try → ProbeFailure（scenario-error） | 是（probe 顶层 catch） | probe 更名后自检语义不变；测试更名 |

### Caller 清单（运行时行为类——`apply(ctx)` 新 throw 路径）

| Caller | 文件:行号（现状） | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| DSH profile 装配 | `dsh src/profile.ts:55,70`（`plugin.apply(ctx)`） | 否（同步） | 否 | 否（createDshPersistenceProfile 直抛） | 装配序先装 clock+timer（§4.I）→ 断言恒过；缺省插件兜底 |
| probe 装配 | `dsh src/probe.ts:183-189`（经 profile） | 否 | 外层 step/try → ProbeFailure | 是 | profile 恒装依赖；异常归入 `scenario-error:<step>` 现行通道 |
| core-dsh-boundary 正向用例 | `persistence test/core-dsh-boundary.test.ts:37-38` | 否 | 否 | 否 | 改写为装依赖后 apply（§2 裁决 10）；另加**三**负向用例（缺 clock / 缺 timer / file 工厂缺 clock，R1/#13）**期望** throw |
| file plugin 组合用例 | `persistence test/file-persistence.test.ts:348-350` | 否 | 否 | 否 | 装双依赖插件后 apply（§6.2） |
| memory apply 组合用例 | `persistence test/memory-persistence.test.ts:519` | 否 | 否 | 否 | 同上（§6.1） |
| 插件工厂内部 | `src/memory.ts`/`src/file.ts` 工厂 `apply` | 否 | 否 | 否 | 工厂先 `createCordisPersistenceScheduler(ctx)`（断言+桥），失败即同步上抛给上表 caller |

### 风险评估

- 遗漏 caller 的代价：编译期类 = `pnpm typecheck` 红（安全网）；运行时字符串类（`ctx.get('docPersistence')`）无编译保护——本表已 grep 全量枚举（见 §2 裁决 9 的 grep 证据），且 vitest 断言 `toBe(undefined)` 类误漏会显式红。
- 新 throw 路径的代价：任何未装依赖的宿主（未来 NomicoreServer/Registry Host）apply 即同步 throw——这是 AC2 的**设计意图**（loud > silent），错误文案给出安装指引。

---

## SA2 反馈逐条回应

**R1（2026-08-25）**：对 SA2 评审报告（verdict=FAIL，3 阻断 + 12 MINOR）逐条回应。全部条目均在正文对应章节做了**实质修订**（非承认式回应）；修订后全文旧名/计数/引文已按修订后事实重写。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| **B1**（CRITICAL）：AC4 守卫正则对本设计自身 scheduler 缝签名 ≥9 处误报，零命中目标永不可达 | ✅ | §6.9（守卫重写）；§5 AC4 行；裁决 1 + §3.1（接口形态） | 守卫目标改为 **host 全局 timer API**：三条正则（① 裸调用 `/(?<![\w$.])(?:setTimeout\|setInterval\|clearTimeout\|clearInterval)\s*\(/` 负向 lookbehind 排除属性调用，② 显式 `globalThis.…`，③ `Date.now(`）；扫描前先剥注释/字符串，**守卫自带正反样本表先证判别力后扫六文件**（同文件既有 guard-samples 先例）；配合 `PersistenceScheduler` 接口锁定 property-signature 形态（`readonly setTimeout: (…) => unknown`），缝签名与属性调用均落入合法样本 |
| **B2**（CRITICAL）：假设 8 被 clock/src/contract.ts:28 证伪 + DENY 矛盾 + 步骤 12 必红 | ✅ | §2 裁决 9（重写）；§9 ALLOW/DENY；§8 步骤 12；§10 假设 8 | 裁定方案 (a)：ALLOW LIST 增补 `packages/clock/src/contract.ts` **仅第 28 行 JSDoc** doc-only 修订（「对齐 provideDocPersistence 模式」→「对齐 provide 型 helper 模式」），DENY LIST 加注单行例外（clock 其余文件仍冻结，#106 冻结的是行为面）；步骤 12 sweep 换完整旧符号变体清单（含大写 D 的 `provideDocPersistence`——仅 grep 小写会漏报，R1 实测确认），预期输出恰 1 行 = ADR-0009:26，stdout 贴 REPORT |
| **B3**（CRITICAL）：ProbeTimeline 缺「单一虚拟时间基」不变式，deadline 基线漂移 → determinism 锚必红 | ✅ | §2 裁决 6（不变式 ③ + wiring 伪码）；§3.2（视图契约）；§6.13（基线红灯单测）；§7 风险 4 | 增补**不变式 ③**：`timers` 登记表与虚拟刻度由 timeline 闭包独占，`createFakeTimerPlugin` 注入的是该表视图（`setTimeout: at = manual.now() + delay`），**禁止**委托带独立内部时钟的 `createTestScheduler`；给出完整 wiring 伪码（timers/manual/nextId 同闭包）；§6.13 新增基线单测：advanceBy(500) 后 setTimeout(cb,10) → pending 1、advanceBy(10) 恰触发、**触发时 now()===510**（独立内部时钟实现下必红） |
| #4 lifecycle 调度点漏 435 | ✅ | §4.B | 枚举改准：**7 处**（434/435/436/490/505/510/517，R1 grep 复核与 SA2 一致） |
| #5 导出计数 +2 错误 | ✅ | §4.E | 改为 **+4 新名**（NOMICORE_PERSISTENCE_SERVICE / provideNomicorePersistence / requireNomicorePersistence / PersistenceScheduler），删 5 旧名不变 |
| #6 issue-79 构造点 6→9 | ✅ | §6.4 | 改准 **9 处**（57/88/120/162/198/237/277/294/295），规则不变 |
| #7 §6.1 选项 B 陷阱（cleared() 断言依赖本地 FakeTimer） | ✅ | §6.1 | 删除选项 B，写死唯一方案：**保留本地 FakeTimer 仅删 now**；注明 192/211 行 `cleared()` 断言是其硬依赖 |
| #8 fake timeout 须返回幂等 disposer | ✅ | §3.2 | `createFakeTimerPlugin` 契约补明：`timeout/setTimeout: (cb, ms) => () => void`，内部包 `() => timer.clearTimeout(id)` 且幂等（done 标志），禁透传裸 number id——附实现伪码 |
| #9 file 虚拟化谓词逐用例化 + waitFor 先于 dispose | ✅ | §6.2；§7 风险 8 | 谓词逐用例：首写 = `fs.existsSync(snapshotPath)`；覆盖写（300–324 chmod 0o444 用例）= 解码内容断言 generation（ROOT.rev===2）；显式时序纪律：**waitFor 必须先于 dispose**（dispose 经 AbortSignal 掐在途写，后等待永不落盘） |
| #10 中间态禁止跑全量门禁 | ✅ | §8 头注 + 步骤 8/10 | 增「中间态纪律」块：步骤 2–7 结构性红点期间只允许包内定点 vitest/tsc，全量 `pnpm typecheck`/`pnpm test` 仅步骤 11 与 12 |
| #11 裁决 9 引文与命令输出不符 | ✅ | §2 裁决 9；§10 假设 8 | 随 B2 重写：R1 重跑真实 grep，TASK.md/phase-4 错误引文删除，真实输出（含 clock:28 大写 D 命中细节）贴入假设 8 |
| #12 waitForFlush 计数 8→7 | ✅ | §6.2；§7 风险 8 | 改准：**7 次运行时调用**（源码 2 处调用点 = seedAndFlush 内 104 行 + 直调 138 行；运行时 = 6 seedAndFlush 调用 + 1 直调）；构造点 11 处不变 |
| #13 补 file 工厂负向锚点 | ✅ | §2 裁决 10（负向 C）；§6.8；§5 AC2 行；§11 caller 表 | 新增负向 C：`createFilePersistencePlugin({ rootDir }).apply(裸ctx)` throw 缺 clock 文案——两工厂入口独立覆盖，防单点重构失明 |
| #14 AC3 锚点指名文件 | ✅ | §5 AC3 行 | 锚点指名：`dsh-profile-acceptance.test.ts`（AC4 service 级用例，ProbeTimeline→fake timerPlugin→ctx.timeout 桥全链）+ `core-dsh-boundary.test.ts` 正向（真实 TimerService）+ §6.9 守卫 |
| #15 timer fiber ⊇ adapter 生命周期契约 | ✅ | §4.C；§8 步骤 4 | service.ts 文件头/函数 JSDoc 各一处写明「timer fiber 生命周期 ⊇ persistence adapter 生命周期」宿主接线契约（先装 timer、后停 persistence；违反时 scheduleRetry 的 ctx.timeout 在 native 回调续体抛 INACTIVE_EFFECT） |

**一致性自检（R1 修订后全文执行）**：① 旧符号名仅存于更名映射表/「删除/替代」语境与 SA2 引文；② 「三正则守卫」「property-signature」「不变式 ③」「负向 C」等新表述在裁决/§3/§4/§5/§6/§8/§9/§10 间交叉引用一致；③ 全部计数（7 调度点、+4 导出、9 构造点、7 waitForFlush、11 file 构造点）与 R1 grep 实测一致。
