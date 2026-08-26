Verdict: pass

# SA4 静态验尸报告 — issue #112：idle retention / Cordis plugin / ordered shutdown

**Date**: 2026-08-27
**评审者**: SA4（静态实现评审/验尸）
**评审对象**: `packages/namespace-registry` worktree `/home/wangjian/nomicore-fix-issue-112`（branch `fix/issue-112-on-docs-namespace-registry`）相对基线 `e1efbbe` 的全部改动：src×8 + test×4 修改 + `plugin.ts`/3 新测试文件 + package.json + pnpm-lock.yaml（授权伴随物）。
**对照权威**: 冻结设计 `task_registry-idle-plugin-shutdown.md`（R1 修订 776 行）、SA6 红灯契约 `..._sa6_red.md`（35 锚点 + §7 R-fix）、SA3 档案 `..._sa3_impl.md`（§4 三处工程细节 / §5 争议灯——总控已全判测试侧缺陷且 SA6 R-fix 修复，本评审独立复核而非照抄）。
**方法**: 只读逐行对照 + 敌意源码审查（arm-token 闭包 / 并发交错 / ABA / 恰一次性 / 契约连锁）+ 自跑门禁（独立后台进程）+ cordis 4.0.1 / cordis-plugin-timer 1.1.3 构建产物源码抽查。

---

## 0. 门禁复算（亲跑，独立后台进程，不信任档案数字）

| 门禁 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 目标套件 | `pnpm exec vitest run packages/namespace-registry --typecheck` | **Test Files 8 passed (8)；Tests 137 passed (137)；Type Errors no errors** | **0** |
| 全仓 | `pnpm test`（= `vitest run --typecheck`） | **Test Files 113 passed (113)；Tests 1378 passed (1378)；Type Errors no errors** | **0** |
| 类型 | `pnpm typecheck`（九包 tsc 链，含本包） | 全过 | **0** |

与 SA6 R-fix §7.5 / SA3 §3 档案数字一致（137 / 1378 / TS18048=0），独立复算确认。

---

## 1. Scope Gate（skill §1.1）

**creep = ∅**。

实际改动集（`git status --porcelain` 全量核对，含 untracked）：

| 文件 | 状态 | 判定 |
|---|---|---|
| `src/plugin.ts` | 新增 | ALLOW（§4 新建） |
| `src/registry.ts` `lease.ts` `types.ts` `errors.ts` `observer.ts` `testing.ts` `index.ts` | 修改 | ALLOW（§4 修改，7/7） |
| `package.json` | 修改 | ALLOW（+2 依赖，见 §5-G） |
| `test/registry-idle.test.ts` `registry-shutdown.test.ts` `registry-plugin.test.ts` | 新增 | ALLOW（§4 新建） |
| `test/registry-open.test.ts` `registry-create.test.ts` `registry-node-dispose.test.ts` `registry-surface.test.ts` | 修改 | ALLOW（§4 修改） |
| `pnpm-lock.yaml` | 修改 | 白名单豁免（diff 仅 +2 依赖条目 6 行，已亲核） |
| `wiki/raw/task_registry-idle-plugin-shutdown*.md` ×6 | 新增 | 白名单豁免（SA 流水线档案） |

- **DENY LIST 零触碰**：`packages/persistence/**`、`packages/namespace-runtime/**`、`packages/clock/**`、`dsh-persistence/**`、`src/identity.ts`、`src/create-document.ts`、`docs/**`、根 `package.json`、`.github/workflows/ci.yml` 均不在 diff（git status 全量核对）。
- **BLACKLIST 零命中**（package-lock.json / yarn.lock / TASK.md / *.bak / .DS_Store）。

### 触发性自检（skill §1.3/§1.4）

- 无 `*.spec.ts` 新增 → E2E 门 N/A。
- 新增 `*.test.ts` 全在 `packages/namespace-registry`；CI `pnpm test`（ci.yml:39）= 根 `vitest run --typecheck`，本地复算 113 文件含本包 8 文件——**包级触发已接通**；`pnpm typecheck`（ci.yml:36）链末含 `tsc -p packages/namespace-registry/tsconfig.json`。无孤儿测试。

### 协议假设抽查（skill §1.5，设计 §5 表 8 条抽 3 条亲核源码）

1. **§5#1 timer disposer 幂等**：`cordis-plugin-timer@1.1.3/lib/index.js:24-35` `timeout(callback, delay)` 逐字 = `const dispose = this.ctx.effect(() => { const timer = setTimeout(() => { dispose(); callback(); }, delay); return () => clearTimeout(timer) }, 'ctx.timeout()')`——桥接 `clearTimeout: (handle) => handle()` 语义成立 ✓（且 plugin 测试 28 以真实 `ctx.timeout` 通道动态确认）。
2. **§5#7 `ctx.get` 缺失返回 undefined**：cordis `lib/index.js:762-771` `_getImpl` 缺服务 `return;`（undefined）✓。
3. **fiber state 语义（测试 26/28a 判别基础）**：`lib/index.js:1287-1292` `_getState()`：`uid===null → 4`、`_error → 3`、`epoch !== INACTIVE → 2`、否则 `0`；`fiber.d.ts:67-74` FiberState 常量枚举 PENDING=0/ACTIVE=2/DISPOSED=4——依赖消失触发 `_setEpoch(INACTIVE)→_unload` 后 `state===0`（PENDING 可重载），测试 26 断言 `toBe(0)` 与源码一致 ✓。

---

## 2. 设计逐行对照（§2 A–M）

全部逐条对照冻结设计伪码/文本（含 message 逐字），**零危险偏离**。要点核验：

- **§2.A**：`RegistryTimeoutScheduler` property-signature 形态（types.ts:164-169）✓；scheduler 必需 + 形状门禁（registry.ts:300-309，message 逐字 `NAMESPACE_REGISTRY_SCHEDULER_REQUIRED: …`）且**排在 clock 门禁之后**（registry.ts:447-450，SA6 要点 2 时序裁决，既有 `{clock:{}}` 断言零改动的前提）✓；`resolveIdleTimeoutMs`/`DEFAULT_IDLE_TIMEOUT_MS` 唯一运行时定义点同居 registry.ts:107-129，plugin.ts:51 纯 re-export、index.ts 沿 plugin 链转出（R1/M3 单点化，surface 值锚 300_000）✓；cordis 桥 plugin.ts:110-118 与 persistence service.ts:48-54 同构 ✓。
- **§2.B**：phase 三态词表 + Entry 字段（`idleTimerHandle` 增、`lifecycleTail` 删）✓；I1 域限定注释、I2 先赋值后翻相（registry.ts:631-633）、I3 四同步段、**I4 arm-token 回调首查**（registry.ts:588-596：闭包捕获 `handle`，回调第一语句 `if (entry.idleTimerHandle !== handle) return`，先于任何副作用——含 m-R2-1 收窄句注释 :593）✓；`handleLeaseReleased` 双早退（acceptance≠running / phase≠active / leases.size≠0）✓；`beginIdleClose` 守卫次序（ABA → phase → 清 handle → close → 写 entry → 翻相 → 双臂 settle 处理器）与设计伪码逐字对应（registry.ts:627-646）✓；`activateEntry` 同步取消+翻相（:658-665）✓；`runOpenSlot` 三态重写（active 签租 / idle 激活复用 / closing-wait **catch-吞并** + 三态 recheck，:701-727）✓；`runCreateSlot` idle 第五态分派 + await 后 recheck 扩 idle（:796-848）✓；timeout=0 异步性（fake 队列 + advanceBy(0) 触发，测试 4 双锚）✓；fatal/degraded 零特判（测试 5a/5b）✓。
- **§2.C**：`closePromise.then(两臂)` 派生恒 resolve（零 unhandled rejection——测试 11 显式 `process.on('unhandledRejection')` 探针 + setImmediate 展开断言空）✓；`idle-close-failed` 单点（close 发起侧 reject 臂 :636-642）恰一次 ✓；`removeOnlySelf` 双守卫代际局部清理 ✓；后续 open 全新 generation 零污染（测试 11/9）✓。
- **§2.D**：`shutdown()` **非 async 方法**（registry.ts:1040-1055——AC12 exact same-Promise 的必要工程化，SA3 §4.1，接口签名 `Promise<void>` 不变）✓；同步段三动作原子（翻相 → 取消全部 idle timer → 缓存 promise）✓；`runShutdown` 冻结次序（carrier 快照等待 → 全量发起（复用在途 closePromise）→ 全量聚合（不因首败跳过）→ entries.clear + stopped + 聚合 reject）:973-1005 ✓；**stopped 先于 throw**（:1001-1004）✓；幂等缓存含已 reject 实例（测试 20 两相）✓；接纳门迁移至 open/create 公共入口首语句（:1012/:1025，先于 identity/Proxy trap 一切输入访问——测试 14 trap 计数 0）✓；槽内 acceptance 检查删除（runOpenSlot/runCreateSlot 首行无检查）✓；shutdown 期间 release 不武装（acceptance 早退，测试 17 尾段）✓。`runShutdown` 首行 `await Promise.resolve()` 微任务边界（SA3 §4.2）：空 registry 下保住 `shutting-down` 可观测性（registry-open.test.ts:739-742 与测试 13 实锚）；非空路径行为与设计伪码一致（额外一层微任务不触任何冻结锚）——判定为**必要工程化表达，非偏离**。
- **§2.E**：三相恒冻结常量投影（:252-254, :1030-1037），零内部计面 ✓。
- **§2.F**：`NOMICORE_REGISTRY_SERVICE='nomicoreRegistry'`（issue #104 冻结名）✓；Context augmentation ✓；provide/require（require 缺失 throw 文案逐字）✓；断言三件套次序 clock → timer → nomicorePersistence、timer 专属双句文案逐字（plugin.ts:88-98，测试 23 三剔除逐一锚定）✓；`createCordisRegistryScheduler` 断言先于桥接 ✓；`resolvePluginIdleTimeoutMs` 形状/键集 TypeError + 复用核心单点（plugin.ts:127-136，测试 24 矩阵：TypeError/RangeError 二分、0/2147483647 接受、缺省 300_000）✓；`createNamespaceRegistryPlugin` inject 三服务 + generator effect（yield revoke 先、yield shutdown-disposer 后；finally `revokeService?.()` + `instance = undefined` 回收——SA3 §4.3，SA6 测试 25-27 锚）✓；头注宿主接线契约三条（timer⊇registry + 先卸后果 / AC11 fiber 级解读 + adapter 残余并发 / reload 全量回收）plugin.ts:12-34 ✓；`import type {}` 双通道纯类型（见 §4 敌意审查）✓。
- **§2.G**：依赖 +2 形态 `dependencies`（与 persistence/package.json 先例逐字段同款——亲核）；exports 恰 `.`/`./testing` 不变（surface 测试锚）；主入口 9 运行时值 + 3 类型（surface 精确 key 集断言，多余导出会爆）✓。
- **§2.H**：`RegistryOperationUnavailableIssue`/`NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE`/`SHUTDOWN_UNAVAILABLE` 全仓 grep 零存活引用（仅注释提及「已删除」与 surface 负锁）✓；`shutdown(): Promise<void>` ✓；`NamespaceRegistryShutdownError`（code/name/message 恒定常量/failures 冻结数组，`this.name` 赋值与 `NamespaceRegistryFatalError` 同款写法，errors.ts:65-74）✓；五条 message 常量入 types.ts 单一真相源（:66-75）✓。
- **§2.I**：事件七形 → 十形（observer.ts:30-33），shutdown 不加事件 ✓。
- **§2.J**：overrides `scheduler` 必需 / `idleTimeoutMs?` 可选（testing.ts:42-46）；`createRegistryTestScheduler`（属性箭头形态、到期序触发 + 3 层微任务展开、`pending()` 即时计面）✓；testing 子路径恰 2 导出 ✓；零默认 scheduler（拒绝虚假降级）✓。
- **§2.M**：**亲扫复核**（非仅信任测试）：`grep -rnE '(^|[^.a-zA-Z_])(setTimeout|setInterval|clearTimeout)\(' src/*.ts` 与 `Date.now(` ——命中全部为注释行（plugin.ts:107-108、testing.ts:67、registry.ts:281、types.ts:343），**零真实裸调用，testing.ts 零豁免成立**；cordis specifier 亲扫仅 plugin.ts（36/37 两行均 `import type`）✓；plugin.ts 经 `./registry.js` 相对通道 ✓；internal subpath 消费仍仅 registry.ts（surface 活链路扫描）✓。surface 双守卫自带正反样本表自证判别力（判别力样本 12 条亲核）。

**§2.K 回归重裁决**：release same-Promise/asyncDispose 契约零变化（测试 1/6/17 回归锚）✓；idle → ALREADY_EXISTS 同码第五态（测试 10 + create idle 行）✓；R2-M1 fail-closed / HIGH-1 变体 B fatal 守卫逐字保留（registry.ts:804-846；fixture 断言逐字未动——diff 亲核）✓；`runOpenSlot` closing 等待补 catch-吞并（有意不对称冻结）✓。

---

## 3. 敌意源码审查（独立攻击，非照抄档案）

| # | 攻击面 | 推演结论 |
|---|---|---|
| 1 | **arm-token 闭包捕获**（SA2 H1 场景重演） | T1 到期入队 → open 激活（clearTimeout no-op + handle=undefined）→ release 重武装 T2（handle=新 token）→ C1 执行：首查 `entry.idleTimerHandle !== handle` → undefined/新token ≠ T1 handle → no-op。旧回调不产生任何副作用（无 close、无 observer、无 phase 变更）。**结构性免疫成立**；adversarial 测试 3a/15a 分别锚 re-arm 与 shutdown 两个变体（公共注入面 `RegistryTimeoutScheduler` 自实现，仅暴露自身队列，零 Registry 内部状态读取）。 |
| 2 | **handleLeaseReleased 早退漏武装** | shutdown 后 release：acceptance 早退 → entry 停留 active(零 lease)，由 runShutdown 步 2 关闭——与「shutdown 后新武装 timer」互斥 ✓。idle 期重复 release：`releasePromise` 缓存守卫使 onReleased 恰一次（lease.ts:76-88，回调在 `if (releasePromise === undefined)` 块内）✓。多 lease 交错：非最后 release `leases.size !== 0` 早退 ✓。 |
| 3 | **beginIdleClose 双守卫必要性与正确性** | token 判别后 ABA/phase 守卫为第二层防御（fixture 注入 / 违约 scheduler 双 fire 等）：置 `idleTimerHandle = undefined` 先于 `runtime.close()`，使同回调二次执行亦失配。守卫次序与设计伪码逐字一致。 |
| 4 | **shutdown 并发** | 同 tick 双调用：非 async 方法 + `shutdownPromise` 缓存 → exact same Promise（测试 20 两相 toBe）✓。open 与 shutdown 同 tick：open 先 → 同步接纳（carrier 已入 map）→ runShutdown 快照含之、await tail 完整结算（测试 16：loadDoc 挂 gate 时 shutdown 不 settle、放行后 open 签 lease 非 NOT_ACCEPTING、新建 entry 被 close `closeCalls===1`）✓；shutdown 先 → NOT_ACCEPTING 零输入访问（Proxy trap 计数 0，测试 14）✓。**carrier 快照完备性**：快照取于微任务边界后、接纳门已关（唯一建 carrier 路径 open/create 均首查 acceptance）→ 无漏 ✓。**entries 枚举时机**：`for (const carrier of [...carriers.values()]) await carrier.tail`（:975）整体完成**之后**才 `for (const entry of entries.values())`（:978）——在途槽 settle 后新建的 entry 必进关闭全集（测试 16 实锚）✓。green tail 使 await 永不 reject（operationGreenTail 双臂 catch 化）✓。closing-wait 挂起 + shutdown → runShutdown 阻塞于 carrier await 直至 close settle——R3 契约行为（设计 §8 冻结，测试 12 锚等待而非崩溃）✓。 |
| 5 | **runOpenSlot 三态 / runCreateSlot 变体** | closing-wait catch-吞并后 recheck：active/idle → 复用（activateEntry）；undefined → 唯一放行 loadDoc；仍 closing → 落穿不改写（结构性不可达，设计伪码同款）✓。create 侧三 fail-closed 变体（closing 缺 closePromise / await reject / await 后仍 closing）逐字保留 + fixture 断言零改动 ✓。 |
| 6 | **lease.ts onReleased 恰一次与 throw 隔离** | 回调点为裸调（lease.ts:86 `onReleased?.()`，无局部 try/catch）——**设计 §3 明文裁决「隔离在 registry 回调内」**：handleLeaseReleased 唯一可抛点 `scheduler.setTimeout` 被 try/catch 包裹（registry.ts:587-608 → idle-arm-failed 通道），phase/handle 写入在 try 成功后；release 的 released 标记与 releasePromise 缓存先于回调 → 回调任何异常不破坏 same-Promise（测试：throwing scheduler → release resolve undefined + observer exact cause + entry 停留 active 可复用）✓。 |
| 7 | **observer 恰一次性** | `entry-idle`（唯一武装成功点 :611）/ `idle-arm-failed`（唯一 catch :601）/ `idle-close-failed`（唯一 close reject 臂 :637）各单点；shutdown 发起的 close 失败**零** idle-close-failed（§2.I——测试 15a 断言 0）✓；`dispatchObserver` 双 try/catch 隔离 ✓。 |
| 8 | **类型/常量/错误类** | 五条 message 常量 types.ts 单点，registry/plugin/errors 全部 import 引用（零第二定义点，grep 亲核）；ShutdownError `extends Error` + `this.name` + `super(常量)` 与 FatalError 写法同款；聚合 `Object.freeze` 数组 + 逐元素 freeze、顺序 = Map 插入序（测试 19 三 key 两 cause 实锚）✓。 |
| 9 | **plugin.ts 纯度与回收** | cordis 双 import 均 `import type`（TS 剥离，零运行时 cordis 依赖进本模块）；运行时 import 仅 `@nomicore/clock`/`@nomicore/persistence`/相对 `./registry.js`/`./types.js` ✓。instance：apply 赋值 → disposer finally 置 undefined；cordis reload 语义（unload 完成 → 再 apply）保证旧 disposer 的清理先于新赋值，无竞态窗口 ✓（测试 22/25/26/27 锚）。 |
| 10 | **package.json 依赖形态** | `dependencies`（非 peerDependencies）+ `^4.0.1`/`^1.1.3`，与 persistence 先例逐字段同款（亲核 persistence/package.json）✓；pnpm-lock diff 仅 +2 条目 6 行 ✓。 |
| 11 | **契约改动连锁（skill §1.6）** | `shutdown()` 新增 reject 路径的全仓 caller 清单（grep 亲核）：生产唯一 = plugin.ts:171，位于 `try { … } finally { … }`，rejection 交 cordis fiber `_unload` catch（测试 27 零 unhandled 探针实锚）；其余全为测试（vitest 吸收）。`createLeaseController` 第三参可选（内部）；`createNamespaceRegistry` options 增量（生产唯一 caller = plugin apply，断言先行）。**无 uncaught rippling**。 |
| 12 | **runtime.close() 同步 throw 可能性** | 生产 `close()`（namespace-runtime/src/runtime.ts:253-264）：幂等缓存 + 同步 `state.lifecycle='closing'` + `sequencer.enqueue`（thunk 经 .then 微任务排程，纯调用无可抛点）——同步不可抛，`beginIdleClose`/runShutdown 裸调安全（SA2 O4 独立结论，本轮亲读源码再确认）。见 OBS-1 的 seam 边界注记。 |

---

## 4. 测试质量敌意审查（SA6 新测试 + 迁移零改动声明核实）

- **行为锚定而非实现细节**：34 新用例全部经公共面（registry API + 注入 seam：`scheduler`/`runtimeFactory`/`observer`/`idleTimeoutMs`）驱动；断言对象 = 可观测结果（issue 形状、closeCalls、loadCalls、pending()、observer 事件、Promise 恒等、探针次序）。零内部状态读取、零源码字符串断言反模式（skill §1.7 扫描：新测试文件无 readFileSync+toMatch 契约锚点；surface 双守卫为设计 §2.M 明文要求的静态守卫、自带正反判别样本，且同契约有行为测试覆盖——豁免条款 3 适用）。
- **adversarial scheduler（3a/15a）**：`createLooseClearScheduler` 仅实现 `RegistryTimeoutScheduler` 公共接口并暴露**自身**武装队列（token + callback + fire），不触碰 entry map/lease/timer handle——§2.J 冻结边界（不暴露内部计面）守住。判别力：3a 锚「旧回调 no-op + 新 timer 存活 + 完整窗口后 close」；15a 锚「shutdown 取消后旧回调 fire → closeCalls 保持 0 → 最终恰 1 次 close、聚合恰 1、零 idle-close-failed、终态 stopped」。
- **28a PENDING→ACTIVE 与 cordis 语义**：`fiber.state` 数值断言（PENDING=0/ACTIVE=2）与 cordis 4.0.1 `_getState()` 源码（本轮亲核 lib/index.js:1287-1292 + fiber.d.ts 常量枚举）一致；三段补装（全缺→补 clock+timer 仍 PENDING→补 persistence 转 ACTIVE）双向锚定依赖门，不半启动。
- **测试 25 判别核心**：close 挂 gate 时 `disposalSettled===false`（shutdown 完成前 fiber dispose 不 settle）在案（registry-plugin.test.ts:292）；探针次序四段与 R1/M2 修正一致。测试先行直调 `registry.shutdown()` 借 AC12 幂等使 disposer await 同一实例（O-R2-2 手法，注释在案）——判别力保留，接受。
- **既有断言零改动声明核实（逐行 diff 亲审）**：
  - `registry-open.test.ts`：32 处 `scheduler: createRegistryTestScheduler()` 追加（设计口径 33 = 32 调用 + 1 helper 定义重复计数，SA6 §4 已澄清）+ **恰好两处**点名语义替换（732-749 占位块 → 三相 + resolve undefined 轻量回归锚；1101 腿 → 仅两断言、零 stringify 入 publicTexts）——其余断言文本逐字未动。
  - `registry-create.test.ts`：47 工厂 + 4 internal fixture 追加 scheduler；新增 1 条 idle duplicate 行（§7 测试 10 create 侧）；R2-M1/HIGH-1 三变体断言与 `lifecycleTail` fixture 字面量逐字未动（:1674/:1769 死字段保留系「零改动」纪律的有意结果）。
  - `registry-node-dispose.test.ts`：import + 1 处工厂追加，别无他改。
  - `registry-surface.test.ts`：仅导出面/守卫/可达图增量（9 值精确 key 集、testing 2 值、plugin.d.ts 入图、双静态守卫 + 判别样本表）；既有守卫语义未动。
- **§7 R-fix 四项修订复核**：idle 测试 11 尾段（idle 武装断言 + 完整窗口后 create ok）、plugin 测试 26 state===0、plugin 测试 27 cause 链判别（code `NSRT-CLOSE-RELEASE-FAILED` + `.cause === releaseCause`，与 close.ts:54 包装语义一致——本轮亲读 close.ts 确认）、TS18048 清零（require 通道）——全部与冻结设计/真实运行时语义一致，修订合理。

---

## 5. 发现分级

### HIGH：0
### MEDIUM：0

### MINOR：1

- **MINOR-1** `packages/namespace-registry/src/plugin.ts:42` —— **未使用的命名导入**。`import { createNamespaceRegistry, DEFAULT_IDLE_TIMEOUT_MS, resolveIdleTimeoutMs } from './registry.js'` 中 `DEFAULT_IDLE_TIMEOUT_MS` 在模块体内零引用（:51 的 re-export `export { DEFAULT_IDLE_TIMEOUT_MS } from './registry.js'` 是独立 export-from 语句，不消费该局部绑定）。tsconfig 未开 noUnusedLocals 故编译不报。**影响**：零运行时/行为影响（纯卫生；读者可能误以为 plugin 逻辑消费该常量）。**修复建议**（SA3 顺手，不阻塞）：从 import 列表删除该项，保留 :51 的 re-export。

### OBSERVATION：4

- **OBS-1** `registry.ts:631 / :982` —— `entry.runtime.close()` 裸调无 try/catch。生产 Runtime `close()` 同步不可抛已由 #92 源码锚定（幂等 + enqueue 微任务排程，本轮亲核 runtime.ts:253-264）；设计伪码同款结构（SA2 O4 亦有独立结论）。但注入 seam 的**契约违约** stub（close 同步 throw）会使 entry 滞留 idle-无-timer（I1 豁免窗口外破坏）且异常抛入 scheduler 调度栈（cordis 通道为宏任务未捕获异常）。属 seam 契约外输入 + 设计冻结结构，非实现缺陷。处置：记录；现有测试 stub 均无同步 throw，无需动作。
- **OBS-2** `registry.ts:588` —— 违约 scheduler 若 `setTimeout` 返回 `undefined` 作 handle，token 判别退化为 `undefined !== undefined` 恒假（旧回调可通过）。设计 m-R2-1 已冻结前提「同时存活的武装返回可判别 handle」；cordis 桥（返回 disposer 函数）与 fake（递增 id）均满足。契约内无风险。
- **OBS-3** `plugin.ts:131` —— `Object.keys(config)` 键集校验不覆盖 symbol 键（`{[Symbol(x)]:1, idleTimeoutMs:5}` 通过）。与设计冻结伪码逐字一致（设计 §2.F 同为 Object.keys）；影响仅限「symbol 键拼错被静默忽略」的极端误配面。记录性。
- **OBS-4** `registry-create.test.ts:1674/:1769` —— fixture 对象保留死字段 `lifecycleTail: Promise.resolve()`（Entry 该字段已删，经 `as never` 桥接无类型依赖）。系「既有断言零改动」纪律的有意保留；后续票可随 fixture 重构一并清理。

### 工程细节三处（SA3 §4，独立复核后均判定为冻结语义的忠实工程化、非偏离）

1. `shutdown()` 非 async 方法——AC12 exact same-Promise 必需（async 包装每次新建外层 Promise 会破坏 `toBe` 恒等；测试 20 实锚）。
2. `runShutdown()` 首行 `await Promise.resolve()`——空 registry 下保住三相可观测性（§7 测试 13 / registry-open:739-742 锚）；非空路径无锚位差异。
3. plugin disposer finally 内 `instance = undefined`——SA6 测试 25-27 锚（dispose 后 `plugin.instance === undefined`）；与 reload 语义兼容。

---

## 6. 审核结论（skill 模板）

1. **设计一致性**：✅ 一致——§2 A–M 逐条对照通过；三处工程细节为必要工程化表达（见 §5）；零危险偏离。
2. **读写路径一致性**：✅ 一致——无数据源分叉类改动（本票为生命周期/宿主接线层；persistence 访问路径不变，仅 idle duplicate 分派在 Persistence 之前早退）。
3. **静默失败**：✅ 无——所有失败通道均有可观察出口（observer 事件 / 聚合错误 / issue 常量）；武装失败 idle-arm-failed loud 上报且 release 契约不破。
4. **降级方案**：✅ 安全——零降级：scheduler/clock 无缺省 fallback（构造期同步 TypeError）；AC3 双通道（inject PENDING 门 + apply 形状断言）均非静默降级。
5. **极端攻击**：✅ 未发现漏洞——arm-token 重演、shutdown 交错、ABA、恰一次性、并发同 tick、close 永挂起传导（R3 契约）均推演闭合（§3 十二项）。
6. **错误处理**：✅ 完整——beginIdleClose 双臂、runShutdown 聚合 catch、shutdown reject 通道 caller 全覆盖（plugin try/finally）、observer 隔离、零 unhandled rejection（双探针测试实锚）。
7. **架构评估**：✅ 可行——Host 无关核心 + 单文件 Cordis Adapter + 确定性注入测试的架构在本票规模下无死胡同信号；无需退回 SA1。
8. **过度设计**：✅ 精简——新增面均为 AC 直接所需；无「为将来预留」的抽象（idle 容量上限/LRU 等明示非目标零预留）。

**Verdict = pass**：SA7 可进入动态验证（发布侧 CI Node 20/24 实跑证据）。

---

## 7. 动态审核重点（交 SA7 / 发布阶段）

1. **CI Node 20/24 矩阵实跑**（AC13 的 CI 侧证据）：本轮仅本地单 Node 复算三绿；`ci.yml` 的 matrix 实跑日志需在 PR 阶段摘录（`Test` / `Typecheck` 两 step + 本包 8 文件 137 用例出现在输出中）。
2. **真实 native timer 交错**（SA2 H1 生产形态）：确定性 fake 结构性无法表达「已到期未执行的 native 回调 vs re-arm」；adversarial 注入是其最近似。若 SA7 需更强证据，可做一次性真实 `ctx.timeout`（cordis-plugin-timer native 模式）+ 亚毫秒 delay 的烟囱验证——plugin 测试 28 已覆盖真实 `ctx.timeout` 通道（fake 时基），native 时基仅剩 OS 调度噪声面。
3. **persistence adapter dispose 与 Registry shutdown 残余并发**（设计 §8 R1 / SA2 O1）：fiber 级先序已由测试 26 实锚；adapter 级并发（close 写排空撞已销毁 handle → 聚合错误）是声明的残余风险，动态环境如出现 `NSRT-CLOSE-RELEASE-FAILED` 聚合项属预期通道而非新缺陷。

---

## 附：证据索引

- 门禁日志：`/tmp/sa4-gates.log`（三段 EXIT=0）。
- 亲扫命令：裸 timer/Date.now 正则、cordis specifier grep、`RegistryOperationUnavailable` 全仓 grep、`.shutdown()` 全仓 caller grep、pnpm-lock diff 亲核。
- 源码抽查：`node_modules/.pnpm/@deepseek-ai+cordis-plugin-timer@1.1.3_.../lib/index.js:24-35`、`cordis@4.0.1/lib/index.js:762-771,1287-1292`、`fiber.d.ts:67-74`、`packages/namespace-runtime/src/runtime.ts:253-264`、`src/close.ts`（包装语义）。
