# SA3 实现档案 — issue #112：idle retention / Cordis plugin / ordered shutdown

- **实现者**：SA3（TDD Executor）
- **契约来源**：`wiki/raw/task_registry-idle-plugin-shutdown.md`（冻结设计 R1 修订版 776 行）、
  `wiki/raw/task_registry-idle-plugin-shutdown_sa6_red.md`（SA6 红灯报告 35 条实现锚点 + §6 cordis 实测发现）
- **分支**：`fix/issue-112-on-docs-namespace-registry`；worktree：`/home/wangjian/nomicore-fix-issue-112`
- **测试只读纪律**：`packages/namespace-registry/test/**` 一行未改；全部测试改动均系 SA6 既有工作树改动（本档案签名时 `git status` 无任何测试文件被 SA3 触碰）。

---

## 1. 改动文件逐文件摘要（ALLOW LIST 全覆盖，零超界）

| 文件 | 状态 | 摘要 |
|---|---|---|
| `src/plugin.ts` | 新建（~200 行） | Cordis 插件适配层：`NOMICORE_REGISTRY_SERVICE`、Context augmentation（`nomicoreRegistry`）、`provideNomicoreRegistry`/`requireNomicoreRegistry`、`assertNamespaceRegistryHostDependencies`（clock → timer → nomicorePersistence 固定次序）、`createCordisRegistryScheduler`（`ctx.timeout` 桥 + 幂等 disposer 清理）、`resolvePluginIdleTimeoutMs`（键集 TypeError + 复用 resolveIdleTimeoutMs）、`createNamespaceRegistryPlugin`（inject 依赖图边 + generator effect 有序 disposer：yield revoke 先、shutdown 后——逆序串行保证 shutdown 完成后才撤 service；finally 内 `instance = undefined` 回收暴露面）、`DEFAULT_IDLE_TIMEOUT_MS` re-export；文件头固化宿主接线契约三条（timer⊇registry 生命周期 + timer 先卸后果/AC11 fiber 级解读 + adapter 级残余并发/reload 全量回收语义）。cordis specifier 仅此文件（类型级）。 |
| `src/registry.ts` | 修改（+391/−40 净） | ① Entry 词表/字段：phase 三态 `'active'|'idle'|'closing'`、新增 `idleTimerHandle`（I1）、删除 `lifecycleTail`（死代码）；② 模块级 `DEFAULT_IDLE_TIMEOUT_MS = 300_000` + `resolveIdleTimeoutMs`（R1/M3 单点化；TypeError/RangeError 二分 + 零回显）；③ `assertSchedulerShape`（scheduler 必需，**clock 门禁之后**检查——SA6 要点 2 时序裁决）；④ `issueLease` 绑定 onReleased → `handleLeaseReleased`（release 同步段武装、I4 arm-token 判别——含 m-R2-1 收窄句「前提：同时存活的武装返回可判别 handle」、arm 失败 `idle-arm-failed` 通道）；⑤ `beginIdleClose`（① 先取 closePromise ② 后写 entry ③ 翻相 ④⑤ settle 双臂、`idle-close-failed`）+ `activateEntry`（同步取消复用）+ `removeEntryAfterClose` + `entryIdentity`；⑥ `runOpenSlot` 三态重写（acceptance 检查删除；idle 激活复用；closing 等待加 catch-吞并；recheck idle 复用）；⑦ `runCreateSlot` idle 第五态分派（active/idle 同码 ALREADY_EXISTS 零 Persistence + await 后 recheck 扩 idle）；⑧ acceptance 门迁移至 open/create **公共入口同步段**（先于一切输入访问）；⑨ `shutdown()` 真实化（**非 async 方法**——AC12 exact same-Promise 必需；同步段 = 翻相 + 取消全部 idle timer + 缓存 promise；`runShutdown` 微任务边界化 + 冻结次序：carrier 快照等待 → 全量发起 close（复用在途）→ 全量聚合 → entries.clear + stopped + 聚合 reject）；⑩ `getStatus` 三相冻结常量；⑪ 头注更新。 |
| `src/lease.ts` | 修改（+12） | `createLeaseController` 第三参 `onReleased?: () => void`——首次 release() 同步段内、`entry.leases.delete` 与 `lease-released` 事件**之后**调用（恰一次）；same-Promise/同步失效契约零改动。 |
| `src/types.ts` | 修改 | 删 `RegistryOperationUnavailableIssue`/`NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE`；增 `RegistryTimeoutScheduler`（property-signature 形态、零 cordis）、`NamespaceRegistry.shutdown(): Promise<void>`、`NamespaceRegistryShutdownFailure`、`CreateNamespaceRegistryOptions.scheduler`(必需)/`idleTimeoutMs?`、五条 message 常量（scheduler/idle-type/idle-range/plugin-config/shutdown-failed，单一真相源）。 |
| `src/errors.ts` | 修改 | `NamespaceRegistryShutdownError`（code/name 稳定、message 恒定零插值、failures 冻结数组存根）。 |
| `src/observer.ts` | 修改 | `RegistryObserverEvent` 七形 → 十形（+`entry-idle`/`idle-arm-failed`/`idle-close-failed`，均携带受控 identity + generation + exact cause）。 |
| `src/testing.ts` | 修改 | overrides 增 `scheduler`(必需)/`idleTimeoutMs?`；`createRegistryTestScheduler()`/`RegistryTestScheduler`（persistence `createTestScheduler` 蓝本：到期序触发 + 3 层微任务展开 + `pending()`；**属性箭头形态**——满足 §2.M 静态守卫判别力样本「对象方法简写会命中 host-global-timer 正则」）；工厂传导。 |
| `src/index.ts` | 修改 | 导出面增量（§2.G 冻结清单）：值 9 键（`createNamespaceRegistry`/三个错误类/`createNamespaceRegistryPlugin`/`NOMICORE_REGISTRY_SERVICE`/`provideNomicoreRegistry`/`requireNomicoreRegistry`/`DEFAULT_IDLE_TIMEOUT_MS`——后者沿 plugin 链转出）+ 类型 3 新项（`NamespaceRegistryPluginConfig`/`NamespaceRegistryShutdownFailure`/`RegistryTimeoutScheduler`）；不导出 `createCordisRegistryScheduler`/`assertNamespaceRegistryHostDependencies`/`resolveIdleTimeoutMs`/testing 面。 |
| `package.json` | 修改 | dependencies += `@deepseek-ai/cordis ^4.0.1`、`@deepseek-ai/cordis-plugin-timer ^1.1.3`；`pnpm install` 刷新 `pnpm-lock.yaml`（+6 行，CI frozen-lockfile 授权伴随物）。 |

**改动面核查**：`git diff --stat` 仅 src ×8 + package.json + pnpm-lock.yaml 属 SA3；testing 文件 diff 全部为 SA6 既有改动（本档案生成时未触碰）。零 DENY LIST 触碰。

---

## 2. 设计落点对照（A–M 逐条）

- **A**（timeout 能力抽象）：✅ `RegistryTimeoutScheduler`（types.ts）、`scheduler` 必需 + 形状门禁（clock 之后）、`resolveIdleTimeoutMs`/`DEFAULT_IDLE_TIMEOUT_MS` 单点（registry.ts 模块级）、`createCordisRegistryScheduler`（plugin.ts 逐字同构 persistence service.ts:48-54）。
- **B**（idle 状态机）：✅ 三态词表、Entry 字段、I1-I4（含 m-R2-1 收窄句）、`handleLeaseReleased`/`beginIdleClose`/`activateEntry`/`removeEntryAfterClose`/`entryIdentity` 逐字伪码、runOpenSlot 三态（closing-wait catch-吞并）、runCreateSlot idle 分派、timeout=0 异步性（零 close 于 release 栈内）、fatal/degraded 零特判。
- **C**（idle-close failure 通道）：✅ `closePromise.then(两臂)` 派生恒 resolve（零 unhandled rejection）；observer `idle-close-failed` exact cause 恰一次（close 发起侧单点）；`removeOnlySelf` 双守卫代际局部清理；后续 open 全新 generation。
- **D**（shutdown 状态机）：✅ 三相 acceptance、首次调用同步段（翻相→取消 idle timer→缓存 promise）、`runShutdown` 冻结次序（carrier 快照等待→全量发起→全量聚合→stopped+聚合 reject）、接纳门迁移至公共入口同步段 + 槽内检查删除、在途 closePromise 复用、幂等 same-Promise（非 async 方法）、shutdown 期间 release 不武装（acceptance 早退）。
- **E**（getStatus 投影）：✅ 三相恒冻结常量。
- **F**（Cordis plugin）：✅ `NOMICORE_REGISTRY_SERVICE`、augmentation、provide/require、断言三件套（顺序固定、文案逐字）、`createCordisRegistryScheduler`、`resolvePluginIdleTimeoutMs`、`createNamespaceRegistryPlugin`（inject + 有序 disposer + finally 撤 service + instance 回收）、双通道 AC3（inject PENDING 门依赖 cordis 原生，apply 断言为通道 A loud 门）、头注契约三条。
- **G**（package.json/exports）：✅ 依赖 +2、exports 不变、主入口 9 值 + 3 类型、`DEFAULT_IDLE_TIMEOUT_MS` 沿 plugin 链 re-export（零第二定义点）。
- **H**（types.ts 公共面）：✅ 占位删除、`shutdown(): Promise<void>`、`NamespaceRegistryShutdownError`（code/name/message/failures 冻结）、`NamespaceRegistryShutdownFailure`、五条常量。
- **I**（observer 事件 +3 形）：✅；shutdown 不加事件（聚合 + getStatus 双通道）。
- **J**（testing seam）：✅ overrides `scheduler` 必需 + `idleTimeoutMs?`；`createRegistryTestScheduler`（纯 map 队列 fake，零 native timer——§2.M 零豁免成立）；testing 子路径导出 = 2 值。
- **K**（回归重裁决）：✅ release same-Promise/asyncDispose 不变（onReleased 恰一次、回调 throw 隔离）；idle → ALREADY_EXISTS 同码（第五态）；R2-M1 fail-closed / HIGH-1 三变体守卫逐字保留（testEntries 内部 fixture 通路不变；Entry.lifecycleTail 删除——fixture 以 `as never`/`any` 桥接，零类型依赖该字段）；`runOpenSlot` closing 等待补 catch-吞并（与 create 的 fatal 为有意冻结不对称）。
- **L**（测试计划）：✅ 由 SA6 红灯全量承载；SA3 产出见 §3 验证。
- **M**（模块边界）：✅ cordis 白名单 = {plugin.ts}（src 全量扫描零违例——surface 双守卫绿）；**全部 src（含 testing.ts）零裸 `setTimeout(`/`setInterval(`/`clearTimeout(`/`Date.now(`**（testing.ts 以属性箭头形态规避——首轮实测曾因对象方法简写命中，已修正）；plugin.ts 经 `./registry.js` 相对通道导入；internal-subpath 消费仍仅 registry.ts。

**SA2 R2 残留 MINOR（m-R2-1）**：✅ 已在 registry.ts `handleLeaseReleased` 的 I4 注释处收窄——原文「不依赖 scheduler 自身正确性」后追加「前提：同时存活的武装返回可判别 handle」一句注释级措辞。

---

## 3. 验证命令与完整结果

### 3.1 目标套件（SA6 红灯 129 锚 + plugin 8 例）

```
pnpm exec vitest run packages/namespace-registry --typecheck
```

**结果：Test Files 6 passed | 2 failed (8) ；Tests 134 passed | 3 failed (137) ；Type Errors no errors**

逐文件：idle 15/16、shutdown 10/10、open 32/32、create 50/50、node-dispose 2/2、surface 12/12、entry-removal-guard 7/7、plugin 6/8。

- **17 盏守护型绿锚全部保持绿**（entry-removal-guard 7、create-clock-gate 2、surface 既有 8——含 cordis 白名单/host-global-timer 双守卫与声明可达图审计）。
- **112 盏验收红灯中 109 盏转绿**；3 盏保持红 = **争议灯**（见 §5，均为测试侧与冻结设计/cordis 语义的矛盾，建议总控判由 SA6 修）。
- 另：plugin 套件（基线为套件级收集失败、未计数）8 例中 6 例绿、2 例红（同 §5 争议 #2/#3）。

### 3.2 全仓

```
pnpm test
```

**结果：Test Files 111 passed | 2 failed (113) ；Tests 1375 passed | 3 failed (1378)**

基线（#112 前）110 文件 1341/1341 全绿——本实现后其余 9 包与既有 1341 用例**零回归**（1334 既有用例全部保持绿 + 41 个 #112 新锚点中 38 绿）。3 个失败 = §5 争议灯（与 3.1 同一集合，全在 namespace-registry 新测试文件）。
**另注**：全量 `vitest --typecheck` 的 checker 在 SA6 测试文件 `registry-plugin.test.ts` 报告 3 个 TS18048（`'registry' is possibly 'undefined'`，行 176/179/188）——cordis `Context.get<K extends keyof this>` 返回 `undefined | this[K]`，SA6 测试对 `ctx.get('nomicoreRegistry')` 仅做 `expect(registry).toBeDefined()`（expect 不产生类型收窄）——属 §5 争议 #4（测试侧需显式收窄；`pnpm typecheck` 链不受影响，见下）。

### 3.3 类型检查

```
pnpm typecheck
```

**结果：EXIT 0**——九包（vfsl/vfsl-protocol/vfsl-codegen/persistence/dsh-persistence/doc-runtime/namespace-runtime/clock/namespace-registry）tsc 全过。

### 3.4 改动面自查

```
git diff --stat
```

改造面 = ALLOW LIST（src ×8 修改/新建 + package.json + pnpm-lock.yaml）；test/** 无 SA3 改动；0 DENY LIST 触碰。

---

## 4. 实现要点说明（设计未变，工程细节三处）

1. **shutdown() 为非 async 方法**：设计伪码以 `shutdown(): Promise<void>` 表达；实现采用普通方法（非 `async`）——`async` 包装会为每次调用新建外层 Promise，破坏 AC12「并发/重复调用返回 exact same Promise」的 `toBe` 恒等断言（§7 测试 20 实测捕获，registry-shutdown.test.ts:639）。接口类型不变（`Promise<void>`）。
2. **runShutdown 微任务边界化**：设计伪码 runShutdown 在**空 registry**（零 carrier/零 entry）下无任何可 await 点，async 函数体会在 `shutdown()` 返回前同步执行到 `acceptance='stopped'`——三相投影坍缩为 running→stopped，违反 §7 测试 13 与 registry-open.test.ts:747 的「首次 shutdown 同步段后（promise 未 settle 前）`{state:'shutting-down'}` 可观测」锚。实现：`runShutdown()` 首行 `await Promise.resolve()`（微任务边界），保持设计「同步段（翻相 + 取消 idle timer）先交付观测面，异步段后行」的语义；非空路径行为与设计伪码逐字节一致（该边界对非空路径是额外一层微任务，不影响任何锚定断言——全部既有/SA6 测试通过为证）。
3. **plugin.instance 卸载回收**：设计 §7 测试 25-27 锚 `plugin.instance === undefined` 于 fiber dispose 后（SA6 报告要点 30-32）。实现：generator 的有序 disposer（shutdown disposer）`finally` 内撤 service 后置 `instance = undefined`——与「reload 语义：每次 apply 构造全新实例」兼容（reload 时 apply 重新赋新值）。

---

## 5. 争议灯登记（3 盏 + 1 处 checker 噪声；均判为 SA6 测试侧缺陷，待总控裁决）

| # | 位置 | 锚定断言 | 冲突事实（冻结设计/cordis 语义） | 建议处置 |
|---|---|---|---|---|
| 1 | `registry-idle.test.ts:852-860`（§7 测试 11 尾段） | `await lease2.release()` 后直接 `registry.create(...)` 且 `expect(r.ok).toBe(true)`（注释「entry 已清」） | 最后 lease release → idle 武装（AC4/§2.B handleLeaseReleased）→ idle 态 create 必须 `ALREADY_EXISTS`（ADR-0009:68 / §2.B runCreateSlot 分派——本文件测试 10 与 registry-create.test.ts idle 行均锚定同码）。R2 的 300_000ms 窗口未推进，entry 不可能「已清」。 | 测试侧补 `await scheduler.advanceBy(300_000); await flushMicrotasks();`（沿用测试 10 的清理模式）后再 create。 |
| 2 | `registry-plugin.test.ts:332`（§7 测试 26） | `expect(registryFiber.state).toBe(4)`（DISPOSED） | cordis 4.0.1：inject 依赖服务（nomicorePersistence）消失触发依赖 fiber `_refresh → _setEpoch(INACTIVE) → _unload`——卸载后 `_getState()` 因 `uid !== null` 返回 **0（PENDING，可 reload）**，仅显式 `fiber.dispose()` 置 `uid=null` 才为 4。设计 §5#8/§2.F R5 的 reload 语义恰恰依赖「PENDING 可重载」，而 DISPOSED 与之矛盾。 | 断言改为 `toBe(0)`（或注释「已卸载=非 ACTIVE 可重载」），或测试尾部显式 `await registryFiber.dispose()` 后再断 4。 |
| 3 | `registry-plugin.test.ts:376`（§7 测试 27） | `expect(err.failures[0]?.cause).toBe(releaseCause)`（原始 release 异常恒等） | 真实 runtime 的 close 经 close barrier：release reject 被 `runCloseBarrier` 包装为 `NamespaceRuntimeCloseError`（其 `.cause` 保留原始异常）后作为 close Promise rejection 传播——聚合/observer 的 exact cause = **该 close error**（设计 §2.C 明文「exact cause（通常为 NamespaceRuntimeCloseError，cause 链保留原始 release 异常）」；§2.D 步 4 的 `cause` = 捕获的 rejection）。 | 断言改为 `(failures[0].cause as {cause: unknown}).cause).toBe(releaseCause)` 或 `toBeInstanceOf(NamespaceRuntimeCloseError)` + 其 `cause` 恒等（with test 18 的 stub 路径不受影响）。 |
| 4 | `registry-plugin.test.ts:176/179/188`（checker 噪声，不入测试计数） | —— | cordis `Context.get<K extends keyof this>(name): undefined | this[K]`：`ctx.get('nomicoreRegistry')` 类型 = `NamespaceRegistry \| undefined`；`expect(...).toBeDefined()` 不产生 TS 收窄（tsconfig.typecheck.json 含全部 test/**）。全量 `pnpm test` 报 3 个 TS18048「Unhandled Source Error」（定向 `vitest run packages/namespace-registry --typecheck` 因 checker include 仅 test-d 未计，但 `pnpm typecheck` 九包链不含该工程——**CI 命中面 = 全量 pnpm test**）。 | 测试侧改为 `const registry = requireNomicoreRegistry(ctx)!` / 显式 `if (registry === undefined) throw` 收窄后使用（`requireNomicoreRegistry` 已是公开通道）。 |

> 结论：以上四项均为**测试侧与冻结设计（或 cordis 4.0.1 实测语义）的矛盾**，SA3 实现逐字遵循设计与真实运行时语义，未做任何绕行/降级/特殊分支。按任务规则「停止该方向、登记争议、继续其余」，全部其余锚点（含 17 守护绿 + 109 验收红 + 6 plugin 例）已绿。

---

## 6. 偏离登记

- **零实现偏离**：全部行为逐字遵循冻结设计伪码与稳定 message 文本（types.ts 单一真相源常量、零插值、零 identity 回显）。
- 工程细节三处（§4）为冻结语义的必要工程化表达（非偏离）：shutdown 非 async 化（AC12 恒等）、runShutdown 微任务边界（三相可观测性）、plugin.instance 卸载回收（§7 测试 25-27 锚）。
- m-R2-1（SA2 R2 唯一残留 MINOR）：已按总控指示在 registry.ts I4 注释处收窄措辞（一句话注释级）。

---

## 7. R1 记录

- **R1（SA4 MINOR-1 闭合）**：删除 `src/plugin.ts:42` 的命名导入 `DEFAULT_IDLE_TIMEOUT_MS`（:51 的 `export { DEFAULT_IDLE_TIMEOUT_MS } from './registry.js'` 是独立 export-from 语句，不消费该局部绑定——未使用导入）。re-export 形态不动（R1/M3 单点化导出链完整）。
- **R1 复验记（MINOR-1 修订后全量）**：
  1. `pnpm exec vitest run packages/namespace-registry --typecheck` → **Test Files 8 passed (8) / Tests 137 passed (137) / Type Errors no errors / EXIT 0**（三连复跑稳定；含此前登记的 3 盏争议灯——见下）。
  2. `pnpm test` → **Test Files 113 passed (113) / Tests 1378 passed (1378) / Type Errors no errors / EXIT 0**（全仓零回归；一次复跑曾报 1 个 `[vitest-worker] Timeout calling "onTaskUpdate"` 基础设施超时噪声，重跑确认消失——非测试失败）。
  3. `pnpm typecheck` → **EXIT 0**（九包）。
- **R1（争议灯终态：全部由 SA6 测试侧修订闭合，SA3 零代码变更）**：SA3 档案 §5 登记的 4 项测试侧矛盾（idle-11 窗口前置、plugin-26 fiber.state、plugin-27 聚合 cause 恒等、plugin-22 `ctx.get` 收窄噪声）在总控裁决后由 SA6 修订测试文件——idle-11 改为「release 后断言 pending 1 + create ALREADY_EXISTS → 完整窗口推进 → create 恢复」、plugin-26 改断 `state===0`（PENDING 可重载，cordis `_getState` 语义 + 设计 §2.F R5 注释）、plugin-27 改断包装 `NamespaceRuntimeCloseError`（code `NSRT-CLOSE-RELEASE-FAILED` + `.cause === releaseCause`）、plugin-22 改经 `requireNomicoreRegistry(ctx)`（返回类型非 undefined，消除 TS18048）。修订后全部绿灯——**SA3 实现与冻结设计一致，无需任何实现侧回改**。
