Verdict: REJECT

# SA2 攻击评审报告 —— issue #112 冻结设计（idle retention / Cordis plugin / ordered shutdown）

**Date**: 2026-08-26
**评审对象**: `wiki/raw/task_registry-idle-plugin-shutdown.md`（742 行，提交基线 e1efbbe）
**需求权威**: issue #112 十三条 AC（`gh issue view 112`）；ADR 0009；`docs/phases/phase-4-namespace-registry.md`
**评审方法**: 全新视角逐节重查——所有 Cordis 4.0.1 / cordis-plugin-timer 1.1.3 结论均由 SA2 独立阅读
`node_modules/.pnpm/@deepseek-ai+cordis@4.0.1/.../lib/index.js`（1828 行）、`lib/types/fiber.d.ts`、timer 插件
`lib/index.js` 原文复核，未照抄 SA1 的 §5 结论；JS 事件循环推演均给出反例或证明。

**结论**：设计整体骨架（carrier 快照论证、微任务次序证明、generator re-parent 机制、AC11 依赖图机制）
经独立复核**全部成立**，质量高于本轮基线均值。但存在 **1 个 HIGH 设计错误**（idle timer 回调缺少
arm-token 判别，可在生产 native timer 交错下提前关闭刚重新武装的 idle entry，击穿 AC4/AC5 的
「完整时限/窗口内复用」承诺，且设计自述的「结构性防御」不覆盖该 ABA 形态）与 4 个需修订的 MEDIUM。
按纪律（HIGH=设计错误）裁 REJECT；修订项全部局部、无需推翻任何 A–M 主裁决。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 修复建议 |
|---|--------|--------|---------|---------|
| H1 | HIGH | §2.B `beginIdleClose` ABA 守卫不完备（AC4/AC5） | 守卫只有 entry identity + generation + phase 三查，但**同一个 entry（同 identity、同 generation）可以被反复武装**（idle→active→idle 循环复用 entry 对象）。已到期但尚未执行的 native timer 回调（`clearTimeout` 对已到期 timer 是 no-op，回调必然入队执行）会在重新武装后的第二个 idle 窗口上通过全部三查：`entries.get(key)===entry` ✓（同一对象）、`entry.phase==='idle'` ✓（第二窗口）、→ 提前发起 close，砍断第二窗口的完整 `idleTimeoutMs`；且 `entry.idleTimerHandle=undefined` 覆写时**未取消仍在武装中的 T2**（泄漏一个后续定时器，幸被同一守卫兜底为 no-op）。触发序列（生产可达，无需奇异假设）：T1 到期 → 回调 C1 入宏任务队列 → 在 C1 执行前，同一宏任务的微任务尾内调用方完成 `open()`（activate，clearTimeout no-op）+ `release()`（重武装 T2，phase→idle）→ C1 执行 → 提前 close。后果：窗口内复用失效（下个 open 等待 close 后重建 generation，AC4「重置完整时限」被击穿）；零数据丢失（close 排空写、零 lease 期关闭）。设计 §2.B 声称「结构性防御」对此形态**不成立**；§2.J 的 fake scheduler（到期先 delete 再 fire）结构性无法表达此竞态 → 该缺陷会带病通过全部确定性测试直达生产。 | `beginIdleClose` 增加 arm-token 判别：武装时闭包捕获本次 handle（`const handle = scheduler.setTimeout(() => { if (entry.idleTimerHandle !== handle) return; … }, …)`），回调首查 token；`activateEntry`/shutdown 段清 handle 的既有逻辑天然使旧 token 失配。红灯测试：注入自定义 adversarial scheduler（`setTimeout` 记录回调并允许测试在 re-arm 后手动触发旧回调），断言旧回调 no-op、`pending()===1`（新 timer 存活）、runtime 未 close。 |
| M1 | MEDIUM | §2.F/AC3 `ctx.plugin` 装载通道的「loud fail」缺位 | `inject: ['clock','timer','nomicorePersistence']` 使 `ctx.plugin` 装载下缺依赖表现为 cordis 原生 PENDING（Fiber 构造期 `_checkImpl`→`_refresh`→epoch INACTIVE，apply 永不执行，无 throw、无日志——cordis lib/index.js:1094-1099/1316-1341 独立核实），是**静默等待**而非 AC3 字面的「缺失时 loud fail」；亦偏离 ADR-0009:26「缺失任何依赖均在 plugin 启动时响亮失败」的字面与 persistence 先例（`createMemoryPersistencePlugin` **不声明 inject**，缺依赖在 apply 栈 throw→fiber FAILED，响亮）。设计 R4 自曝并预留裁决。§7 测试 23 只覆盖直接 apply 通道，`ctx.plugin`+缺依赖通道**零测试**。 | 维持双机制（见「点名裁决」#3：inject 是 AC11 唯一机制载体，不可去），但需三点落纸：(a) §2.F 明确 AC3 的裁决解释——「loud fail」由直接 apply 通道 + apply 内形状断言承载，`ctx.plugin` 通道语义为「不半启动、零 service、零 fallback」（PENDING）；(b) plugin.ts 头注固化宿主接线契约时把该通道语义一并写入；(c) §7 增测试：`ctx.plugin` 装载缺 timer → fiber state PENDING（或等价探针：若干微任务后 `ctx.get('nomicoreRegistry')===undefined` 且 instance 未构造），补依赖后转 ACTIVE。 |
| M2 | MEDIUM | §7 测试 25 探针次序与断言不变量自相矛盾 | 探针数组列为 `[shutdownStarted, statusWhileDisposing, serviceRevoked, shutdownSettled]`，而同句断言「shutdown 完成先于 `ctx.get('nomicoreRegistry')===undefined`」。按 §2.F 冻结伪码，service 撤销发生在第二个 disposer 的 `finally`（即 `await registry.shutdown()` settle 之后），真实可观测次序是 `[shutdownStarted, statusWhileDisposing, shutdownSettled, serviceRevoked]`。SA6 照抄探针表会烤进错误期望（或被迫写出歪曲时序的探针）。 | 修正 §7.25 探针表次序为 `shutdownStarted → statusWhileDisposing → shutdownSettled → serviceRevoked`，并注明 `serviceRevoked` 以 `ctx.get('nomicoreRegistry')===undefined` 的首个可观测时刻为准（provide disposer 的 `delete store[key]` 在首次调用 wrapper 时同步发生——cordis lib/index.js:817 独立核实）。 |
| M3 | MEDIUM | §2.A 与 §2.G 对 `DEFAULT_IDLE_TIMEOUT_MS` 定义点自相矛盾（含循环导入） | §2.A：`resolveIdleTimeoutMs` 定义在 registry.ts，`undefined → DEFAULT_IDLE_TIMEOUT_MS = 300_000`（registry.ts 需要该常量）；§2.G/§2.F：`DEFAULT_IDLE_TIMEOUT_MS`（plugin.ts 定义）自主入口导出。而 §2.M 冻结导入方向是 **plugin.ts → registry.ts**（相对通道），registry.ts 不能反向 import plugin.ts——按现文本要么循环导入、要么两处重复定义（违背 types.ts「稳定 message 单一真相源」同款纪律与 §2.H「常量入 types.ts 单一真相源」的自我声明）。 | 单点化：常量定义于 registry.ts（与 `resolveIdleTimeoutMs` 同居）并模块级导出，plugin.ts 相对导入后 re-export（index.ts 经 plugin 链转出）；或定义于 types.ts。§2.G 冻结清单同步改写定义点。 |
| M4 | MEDIUM | §7 未点名 registry-open.test.ts:1101 零回显负锁与 shutdown 新契约的相互作用 | 现测试把 `JSON.stringify(await registry.shutdown())` 推入 `publicTexts` 后统一做 sentinel 负锁。新契约下 resolve undefined → `JSON.stringify(undefined)` 返回 `undefined`，`expect(undefined).not.toContain(...)` 是 matcher 报错而非通过；若 SA6 改走聚合 reject 路径取文本，则 `NamespaceRegistryShutdownError.failures` 的**结构化字段合法携带 owner.userId/namespaceId**（§2.H 冻结），sentinel 负锁必然爆红——这不是缺陷而是纪律边界（message 级零回显 ≠ 结构化字段），但 §7「占位断言改真实断言」未告知 SA6 该边界，存在烤错测试或误改生产面的风险。 | §7 修改文件断言迁移处显式注明：registry-open.test.ts:1101 的 shutdown 腿仅锚 `resolve undefined` 与 `getStatus()==={state:'stopped'}`（零 stringify）；零回显负锁对 shutdown 的覆盖以 `NamespaceRegistryShutdownError.message` 恒定常量断言为限（新增于 shutdown 侧专测），结构化 failures 不进 sentinel 负锁循环。 |
| M5 | MEDIUM | §7 测试 15 无法表达「已到期未执行的 timer 回调 vs shutdown」竞态 | 与 H1 同根：设计级 fake（移植 persistence `createTestScheduler`，persistence/src/testing.ts:117-148——到期先 `timers.delete` 再 `callback`）结构性不可能产生「clear 之后回调仍执行」。而 native 语义下 shutdown 同步段 `clearTimeout` 对已入队回调是 no-op，迟到的 `beginIdleClose` 靠 phase/identity 守卫兜住（SA2 独立推演：shutdown 段后回调命中 `phase==='idle'`→提前转 closing→步骤 2 复用 closePromise，无双重 close；步骤 4 后命中 identity 守卫 no-op——**设计正确但无测试证据**）。 | §7 测试 15 增 adversarial scheduler 变体：武装 idle timer 后先让测试「假到期」（取出回调不执行）→ `shutdown()` → 手动触发该回调 → 断言单次 close、聚合不重复收录、终态 stopped。可与 H1 的 adversarial scheduler 共用注入面。 |
| m1 | MINOR | §2.B ADR 引用行号错误 | 两处引用「ADR-0009:54『等待同一个 close Promise 结算，再 load』」——该文本实际在 **ADR-0009:50**（「若 timer callback 先同步将 entry 转为 closing……后续 open 等待同一个 close Promise 结算，再 load 并建立新 generation」）；:54 是 Open 节首段（不等待 P0）。文本存在、行号失准。 | 两处改为 `ADR-0009:50`。其余引用（:68/:99/:101/:50/:26）经逐行核对全部准确。 |
| m2 | MINOR | §2.B 不变量 I1 措辞过强 | `phase==='idle' ⟺ idleTimerHandle !== undefined` 在 shutdown 同步段被有意打破（取消 timer 置 undefined、phase 留 idle 至步骤 2 翻 closing）。行为正确（该窗口内无 open 可达），但「⟺」按字面在 shutting-down 期不成立。 | I1 加域限定：「acceptance==='running' 期间成立；shutdown 同步段取消后至步骤 2 翻相前为唯一豁免窗口（无观察者可达）」。 |
| m3 | MINOR | §2.M 守卫 2 对 testing.ts 的豁免过宽 | testing.ts 的 fake scheduler 是纯 Map 实现（对齐 persistence 先例），根本不需要 native timer——「testing.ts 豁免——其内是受控 fake」的豁免理由与实际实现不符，且豁免会放行未来混入的裸 `setTimeout`。 | 收紧：fake 实现零 native timer，守卫 2 无需豁免 testing.ts；如确需豁免（如未来 flush helper），注明具体成员与理由。 |
| m4 | MINOR | §8 R2 规模口径含混 | 「~85 处」= 33+47+2+3（工厂调用）；另有 registry-create.test.ts 4 处 `createRegistryInternal` fixture（1661/1745/1813/1861，已核实）需补内部 options scheduler——实际触点 89。 | R2 改为「85 处工厂调用 + 4 处 internal fixture」。 |
| O1 | OBSERVATION | AC11「先于 Persistence dispose」的解读边界 | 机制链独立核实成立：inject 使 Registry fiber 成为依赖 → persistence `ctx.provide` disposer（lib/index.js:817-820 逐字）`delete store → notify → await Promise.allSettled(fibers.map(f=>f.await()))` → Registry fiber（含 generator 有序 disposer）先 settle → persistence fiber 卸载后完成。**残余**（R1 已诚实声明）：persistence ADAPTER 的 `this.dispose()`（memory.ts:107-110 注册为 service effect 的同级 disposer）在 persistence fiber `_unload` 的 Promise.all（lib/index.js:1371-1381）中与 provide disposer **并发**——AC11 的「Persistence dispose」若被 SA7 读作 adapter 级排空则不成立，读作 fiber 级则成立。 | 建议 §2.F 正文补一句解读：「AC11 的『先于 Persistence dispose』= persistence fiber 卸载完成与 nomicorePersistence service 撤销完成之前（fiber 级）；adapter 自身 dispose 的排空次序是 R1 声明的残余并发」。避免 SA7 验收口径漂移。 |
| O2 | OBSERVATION | timer plugin 先卸 → idle entry 永久滞留 | §5#2 已声明：timer fiber 卸载时其 fiber 上的 timer effect disposer 清 native timer（回调不再触发），idle entry 停留 idle 直至 shutdown 兜底。零数据丢失，属宿主接线契约。 | plugin.ts 头注「宿主接线契约」与 persistence/src/service.ts:11-17 同款对齐时，把该后果一并写明（Registry 无检测面，靠契约）。 |
| O3 | OBSERVATION | `RegistryTestScheduler` 3 层微任务展开的深度余量 | 移植 persistence 的 3-turn 展开。registry 的 idle close 链（closePromise settle → ④ removeEntry → slot 续体 → recheck）至少 2 层，SA6 的 stub 若在 close 内再 await 会耗尽深度。 | SA6 实测；必要时为 fake 增 `flush()` 显式排空 helper（仍在 §2.J 冻结边界内——只加时间推进能力，不加内部状态读取）。 |
| O4 | OBSERVATION | 生产 `runtime.close()` 同步不可抛已被 #92 锚定 | 独立核实 namespace-runtime/src/runtime.ts `close()`（幂等同实例 INV-C2、同步段仅状态写入 + `sequencer.enqueue` 经 .then 排程，无可抛点）——§2.B/§2.D 裸调 `entry.runtime.close()` 不加 try/catch 是安全的；AC10 复用在途 close 与测试 18 的 `releaseCalls===1` 站在 INV-C2 之上。testing stub 若同步 throw close 属契约外（无需防御）。 | 无需改动；SA4 实现评审时确认 stub 不引入同步 throw 即可。 |
| O5 | OBSERVATION | `NamespaceRegistryShutdownError.failures` 结构化 identity 与零回显纪律 | ADR-0009:95 纪律是 **message 级**（「公开 issue/error message 不包含 owner/namespace 原值……」）；结构化字段携带受控 identity 与 exact cause 有 `NamespaceRegistryFatalError.cause` 同款先例（errors.ts:26）。接受该裁决；注意 ops 侧 `JSON.stringify(err)` 会带出 identity/cause 文本——与 `.cause` 同暴露面，属日志 adapter 责任。 | 无需改动；§2.H 可补一句「序列化暴露面与 cause 同级」备注。 |

---

## 点名裁决项的 SA2 明确立场（攻击面 3/4/5）

### 攻击面 3：open 吞 close-reject vs create fatal 的不对称 —— **支持设计裁决**

- **ADR 文本依据真实存在**：原文在 **ADR-0009:50**（设计误引 :54，见 m1）——「后续 open 等待同一个
  close Promise **结算**，再 load 并建立新 generation」是无条件的：结算含 reject，且下文直接以
  「再 load」续接，未给 close 失败留任何 open 侧失败通道。open 的公开失败分类（ADR-0009:54-56：
  invalid/not-found/typed load operational/not-accepting 四窄 issue）中也不存在「前代 close 失败」通道。
- **第三条路径（open 以 branded fatal reject）更不合规**：它会违背 :50 的「结算后 load」直译、向
  `OpenNamespaceIssue` 联合外新增公开失败面、并把内部生命周期故障错归给 opener——三者都与 ADR 相抵触。
  现裁决（吞 + 发起侧 observer `idle-close-failed` 恰一次 + 新 generation 全新事实）与 ADR:32
  「前项的领域失败或 branded rejection 不成为后项结果」一脉相承。
- create 侧维持 #111 fatal 冻结亦合理：create 是提交型排他操作（ADR-0009:68），在同 key close 失败
  之上继续提交会混淆失败域，且已有红灯锚定（§2.K 明示不重开冻结裁决）。
- **附条件**：修正两处 :54→:50 引用（m1）。

### 攻击面 4：§2.D shutdown —— **五问全部独立复核通过**（附 H1/M5 两个旁支）

1. **同步段交错严格串行**：`shutdown()` 非 async 函数体（缓存检查→翻 acceptance→取消 timer→缓存
   promise，全同步）；`open`/`create` 的 acceptance 检查是 async 函数体首语句、其后到
   admitXxxSlot 之间无 await——两侧同步段在 run-to-completion 下不可分割，同 tick 任意调用序结果确定
   （先 open 则该槽按已接纳语义完整结算，先 shutdown 则 NOT_ACCEPTING 且零输入访问）。**成立**。
2. **`[...carriers.values()]` 快照不漏**：`createCarrier` 仅被 `admitOpenSlot`/`admitCreateSlot` 调用，
   二者唯一入口是公共 open/create；接纳门在 shutdown 同步段关闭后**结构性地**不可能新增 carrier 或
   在既有 carrier 上链接新槽——故 `carrier.tail` 在快照时刻已被冻结，快照读到的 tail 覆盖全部已接纳
   操作（tail 是恒绿尾：`operation.then(()=>undefined,()=>undefined)`，await 永不 reject）。
   「await 期间新结算的 carrier 又接纳新槽」不可达。**成立**。await 期间在途槽新建的 entry（旧 close
   settle→removeEntryAfterClose→slot recheck undefined→loadDoc→entries.set）会**进入**步骤 2 的
   entries 枚举并被关闭——闭环完整。
3. **idle timer 取消 vs 已排队回调**（macrotask 语义）：native 下已到期回调必然执行，迟到
   `beginIdleClose` 被现有守卫正确吸收（shutdown 段前→步骤 2 复用同一 closePromise；步骤 2 后→
   `phase!=='idle'` 拦截；步骤 4 后→identity 守卫拦截）。**设计正确但测试计划表达不出**（M5）。
4. **entries.clear() 与 removeOnlySelf**：全部 ④ 处理器按注册序先于步骤 3 await 续体执行，clear 后
   迟到的 removeOnlySelf 因 `entries.get(key)===undefined` 天然 no-op。**成立**。
5. **聚合错误确定性**：failures 顺序 = closures 数组序 = entries Map 插入序（Map 迭代序确定），
   数组与逐元素 freeze。**成立**。AC12 含 reject 实例的 same-Promise 由同步段缓存保证。

### 攻击面 5：§2.F plugin —— **generator 有序 disposer 机制全部独立核实成立；附 M1/M2/O1 修订条件**

SA2 逐行复核 cordis 4.0.1 `lib/index.js`（不采信 §5 转述）：

- **逆序串行**：effect 本地 `dispose()` 取 `disposables.splice(0).reverse()`，后项经
  `task.then(() => runDisposable(disposable))` 链式等待（lib/index.js:1174-1186）——异步 disposer
  串行且被 unload 等待。`fiber.d.ts` Effect 文档（"Disposers run in reverse registration order …
  they may be async, in which case unloading awaits them"）与实现一致。**§5#3 属实**。
- **re-parent**：generator 分支 `_execute` 同步迭代 `iter.next()` 并 `safeCollect(result.value)`
  （:1145-1152）；`runner.collect` 执行 `disposables.push(dispose)` **并**
  `this._disposables.delete(dispose)`（:1192-1197）——`yield revokeService` 确实把嵌套 provide 的
  wrapper 从 fiber 级清单移入外层有序表；不 yield 则停留 fiber 级、落入 `_unload` 的
  `Promise.all`（:1371-1381）并发。**§5#4/「否则并发」的边界声明属实**。
- **「shutdown 完成后才撤 service」真成立**：收集序 `[revokeService, shutdownDisposer]` 逆序执行
  → shutdownDisposer 先行；其 `finally { revokeService?.() }` 保证 **shutdown reject（聚合错误）
  时仍撤 service**（此处 finally 是承重结构：effect 串行链 `task.then(...)` 在前项 reject 时会跳过
  后项，撤 service 不能依赖链式第二步）；revokeService 二次调用因 effect wrapper 的
  `if (disposing) return disposalTask` 单次守卫而幂等 no-op。
- **AC11 机制链**（inject→notify→provide disposer 的 `await Promise.allSettled(fibers.map(f=>
  fiber.await()))`，:817-820；notify 仅遍历 `name in fiber.inject` 的 fiber，:831-846）：
  **inject 是该机制的唯一载体**——去掉 inject 则 Registry fiber 不是依赖、persistence 撤服务时
  完全不等待 Registry。这是对 M1 裁决「维持 inject」的机理级依据。fiber 级先序成立；adapter 级
  残余并发即 R1（O1 建议落一句解读）。
- **fiber reload**：persistence 服务替换 → notify → Registry fiber `_setEpoch(INACTIVE)` →
  `_unload()`（:1329-1341/1371）→ generator disposer → 旧 Registry 真实 shutdown → 新 provide →
  `_reload()` 重执行 apply 构造新实例。R5 声明与机理一致，**无泄漏**。
- **timer 归属**：`ctx.timeout` 经 mixin 绑定到 TimerService（`this.ctx` = timer plugin fiber 的
  ctx），idle timer effect 落 **timer fiber** 而非 Registry fiber——§5#1/#2 与 timer 插件源码逐字
  符合（`const dispose = this.ctx.effect(() => { const timer = setTimeout(() => { dispose();
  callback(); }, delay); … })`，且 `dispose` 幂等）；Registry fiber 卸载不自动取消 idle timer、
  Registry shutdown 显式 `clearTimeout`（= 调 disposer，幂等安全）自持。**属实**。
- **双通道 AC3**：直接 apply → apply 栈 throw（断言先于 provide）；`ctx.plugin` → PENDING 门。
  两通道机理均核实，但 PENDING 通道的非 loud 性与零测试见 **M1**。

### 攻击面 9（模块边界）—— **通过**

- `persistence/src/testing.ts` 首两行确为 `import type { Context } from '@deepseek-ai/cordis'` /
  `import type { TimerService } from '@deepseek-ai/cordis-plugin-timer'`——但设计 §2.J 是**移植实现**
  （`createRegistryTestScheduler` 自持，零跨包 import），registry 的 testing.ts 不引 persistence/testing；
  cordis specifier 仅出现在**测试文件**（registry-plugin.test.ts 组合装配，§7.22）与 plugin.ts。
  守卫 1（src 除 plugin.ts 外零 cordis specifier）不被穿透。**设计无漏**（m3 的豁免宽度另计）。

### AC 覆盖完备性（13/13 逐条）

AC1 ✓(§2.F/G+测22)、AC2 ✓(§2.F+测24；`NaN→RangeError` 与 §2.A 二分一致)、AC3 △(双通道，M1)、
AC4 △(§2.B+测1-3，H1 击穿点)、AC5 ✓(§2.B+测7-9)、AC6 ✓(测4-5)、AC7 ✓(§2.C+测9/11/12)、
AC8 ✓(§2.E+测13)、AC9 ✓(§2.D+测14-16；「不访问新输入」由 acceptance 先于
validateOpenIdentity/acceptCreateIdentity 保证)、AC10 ✓(§2.D/H+测18-19)、AC11 ✓(机理核实+测25-26，
M2/O1 口径)、AC12 ✓(测20)、AC13 ✓(§7)。**无整条缺位**；H1/M1 为质量缺口而非覆盖缺口。

---

## 协议假设依据审查

§5 章节存在；8 条假设逐条给出「源码引用」级依据。SA2 独立重查结果：

| # | SA2 复核 | 结论 |
|---|---|---|
| 1 | timer 插件 lib/index.js `timeout(callback, delay)` 逐字核对（dispose 先行、幂等守卫在 cordis effect `if (disposing) return disposalTask`，lib/index.js:1174-1177） | **属实** |
| 2 | `TimerService extends Service`，`super(ctx,'timer')` 在 timer fiber provide，`this.ctx.effect` 落 timer fiber；persistence/src/service.ts:11-17 契约注存在 | **属实**（O2 建议头注补后果） |
| 3 | fiber.d.ts Disposable 文档 + lib/index.js:1174-1186 逆序串行链 | **属实** |
| 4 | `_execute` iterator 分支 :1145-1152 + `runner.collect` 的 `this._disposables.delete` :1192-1197 | **属实** |
| 5 | provide disposer :817-820 逐字（`delete this.store[key]` → `notify` → `await Promise.allSettled(fibers.map(fiber=>fiber.await()))`） | **属实** |
| 6 | `_unload` :1371-1381 `Promise.all(this._disposables.clear().map(...))` 并发；`clear()` 返回 `values.reverse()` | **属实** |
| 7 | `ReflectService.get`→`_getImpl`（strict 下非 ACTIVE 服务也返回 undefined）：缺失返回 undefined、从不 throw | **属实** |
| 8 | Fiber 构造 :1094-1099 `_checkImpl`+`_refresh`；`_setEpoch` :1329-1341 INACTIVE↔reload/unload | **属实** |

依据栏无「应该/通常/预计」类无据推断；引用可定位、可被 SA4 重跑。**通过**（本节为全设计最强部分）。

## 错误处理链路审查

- **静默失败**：idle-close 失败三通道齐备（零 unhandled rejection——`closePromise.then(两臂)` 派生
  Promise 恒 resolve，后续 await 各自 catch；observer exact cause 恰一次；entry 代际局部清理）✓；
  idle-arm 失败 loud（observer + shutdown 兜底，绝不静默重试/降级）✓；shutdown 聚合失败诚实 reject ✓。
  唯一静默面：`ctx.plugin` 缺依赖 PENDING（M1，cordis 原生语义、设计已自曝）与 timer-plugin 先卸的
  idle 滞留（O2，契约声明）。
- **状态闭环**：acceptance 三相写入点全覆盖（同步段→shutting-down 立即可观测；步骤 4→stopped 先于
  throw）；步骤 2 若被契约外的同步 throw 打断会滞留 shutting-down——但 O4 已证生产 `close()` 无可抛点，
  非缺陷。
- **降级路径**：无伪降级。`idle-arm-failed` 不是降级（scheduler 能力真失败，loud 上报+兜底关闭）；
  open 吞 close-reject 不是降级（ADR:50 语义本体，发起侧已上报）。§2.A「禁止任何默认 scheduler」
  明确拒绝虚假降级 ✓。
- **用户可感知性**：本票无直接用户交互面；宿主可感知面 = getStatus 三相 + 聚合错误 + observer 事件，
  覆盖全部失败模式 ✓。

## 红灯测试思路（对应漏洞）

1. **H1**：adversarial scheduler（注入 seam 已支持——`RegistryTimeoutScheduler` 是公共注入面）：
   武装 T1 → 测试取出回调不执行 → open+release 重武装 T2 → 手动触发旧回调 → 断言
   `pending()===1`、runtime 未 closed、observer 无 `idle-close-failed`/无 close 发起；随后
   `advanceBy(idleTimeoutMs)` 才 close（窗口完整）。
2. **M1**：真实 `new Context()` + `ctx.plugin(createNamespaceRegistryPlugin())` 缺 timer → 断言
   fiber 未 ACTIVE、`ctx.get('nomicoreRegistry')===undefined`、plugin.instance undefined；
   装 fake timer 后转 ACTIVE 且 service 可用。
3. **M2/M5**：见攻击点清单对应条目（探针次序修正；shutdown 后手动触发已取出回调 → 单次 close、
   聚合恰一次、stopped）。
4. **M4**：shutdown 侧零回显专测：聚合 reject 实例上断言 `err.message` 恒定常量、
   `JSON.stringify(err.message)` 不含 sentinel；`failures` 结构化字段不进负锁循环。
5. **O1（建议性）**：真实组合（memory persistence + registry plugin）下 dispose persistence fiber，
   探针断言 registry shutdown 完成先于 persistence fiber dispose promise settle（即 §7.26 现有设计，
   补 fiber 级口径注释后照写）。

## 修订轮要求汇总（REJECT → PASS 的最小改动集）

1. §2.B `beginIdleClose` 增 arm-token 判别 + §7 增 adversarial scheduler 红灯（H1）。
2. §2.F/§7：AC3 双通道裁决落纸 + 头注契约 + `ctx.plugin` 缺依赖测试（M1）。
3. §7.25 探针次序修正（M2）。
4. §2.A/§2.G `DEFAULT_IDLE_TIMEOUT_MS` 单点化（M3）。
5. §7 迁移注记：registry-open.test.ts:1101 shutdown 腿的零回显边界（M4）。
6. §7.15 增 adversarial 变体（M5）。
7. 顺手项：m1 引用行号、m2 I1 措辞、m3 豁免收紧、m4 口径、O1 解读句。

以上均为局部修订；A–M 十三项主裁决与 §5 证据表**无需推翻任何一项**。

---

# SA2 攻击评审报告 R2（验证轮）—— issue #112 冻结设计修订版（776 行）

Verdict: PASS

**Date**: 2026-08-26
**评审对象**: `wiki/raw/task_registry-idle-plugin-shutdown.md` 修订版（742 → 776 行）
**方法**: 不依赖文末「SA2 反馈逐条回应」落实表——逐项回到 §2.A/§2.B/§2.F/§2.G/§2.M/§7/§8 的**实际修订文本**核验；对修订引入的新文本（arm-token 闭包、I4 不变量、双通道裁决段、头注契约、测试 3a/15a/28a/25/19）做新一轮独立攻击（含退化 handle、同步触发 scheduler、shutdown 复用路径、removeOnlySelf 交互、注入面边界五类推演）。

## R1 要求逐条核验（7 必修 + 5 顺手 = 12/12 落地，均经正文实文确认）

| R1 要求 | 正文实文证据 | 核验结论 |
|---|---|---|
| H1 arm-token 判别 | §2.B 不变量 I4（:107）+ `handleLeaseReleased` 武装闭包（:136-142，`if (entry.idleTimerHandle !== handle) return; beginIdleClose(entry)`）+ §7 测试 3a（:689） | **真实落地**。闭包形态正确：`let handle` 由 `scheduler.setTimeout` 返回值赋值后才可能被异步回调读到；契约违约的**同步触发** scheduler 在赋值前调用回调时，token 两边均为 undefined 会「匹配」，但随即被 `beginIdleClose` 的 phase 守卫拦截（此时 phase 尚为 'active'）→ 安全 no-op，entry 停留可被 shutdown 兜底关闭的 idle——无新缺陷 |
| M1 AC3 双通道落纸 | §2.F「AC3 双通道裁决」节（:427-430，通道 A=apply 栈在场+形状 loud 门 / 通道 B=inject PENDING 门=不半启动、零 service、零 fallback）+ 头注契约三条（:433-436）+ §7 测试 28a（:728）+ §8 R4 更新（:750） | **落地**。通道 B 观测面（`fiber.state !== ACTIVE` ∧ `ctx.get('nomicoreRegistry')===undefined` ∧ `plugin.instance===undefined`）均可公开断言（cordis Fiber.state 公有、`ctx.plugin` 返回的 wrapped fiber 原型链可达），28a 可执行 |
| M2 测试 25 探针次序 | §7.25（:724）：`shutdownStarted → statusWhileDisposing → shutdownSettled → serviceRevoked` + serviceRevoked 以 `ctx.get` 首个 undefined 时刻为准 + provide disposer 的 `delete store[key]` 同步发生注记 | **落地**，与 cordis 事实一致（R1 已核实 lib/index.js:817） |
| M3 DEFAULT_IDLE_TIMEOUT_MS 单点化 | §2.A:59（唯一运行时定义点 registry.ts）+ §2.F:441-443（`export { DEFAULT_IDLE_TIMEOUT_MS } from './registry.js'` 纯 re-export）+ §2.G:471（index 沿 plugin 链转出） | **三处零矛盾**。导入链 index→plugin→registry 无环；§2.G 九值清单含该键 ✓ |
| M4 1101 腿精确化 | §7 迁移节（:732）：1101 腿仅锚 resolve undefined + getStatus stopped、零 stringify 入负锁；shutdown 零回显由测试 19 的 message 恒定常量断言承载；ADR-0009:95 message 级纪律边界注记 | **落地**，边界注记准确（结构化 failures/cause 不进 sentinel 循环，FatalError.cause 同款先例） |
| M5 测试 15a | §7.15a（:711）：取出回调不执行 → shutdown → 手动触发旧回调 → 恰单次 close、聚合不重复收录、终态 stopped | **落地**。语义正确：该场景 close 仅由步骤 2 发起（arm-token 拦截旧回调），且 shutdown 发起的 close **不派发** `idle-close-failed`（§2.I「shutdown 不加事件」一致），聚合恰一次 |
| m1 引用 :54→:50 | 正文 :202（runOpenSlot catch 注释）与 :222（open reject 裁决段）均已改 :50；全文正文已无 :54 残留（仅落实表自述行） | **落地** |
| m2 I1 域限定 | §2.B I1（:104）：`acceptance==='running'` 期间成立 + shutdown 豁免窗口（idle ∧ handle===undefined 至步骤 2 翻相前） | **落地**，与 I4/§2.D 交互自洽（豁免窗口内旧回调被 I4 失配拦截；步骤 2 先赋 closePromise 后翻相保持 I2） |
| m3 守卫 2 零豁免 | §2.M 守卫 2（:557）：全部 src/*.ts 含 testing.ts，零豁免 + 未来豁免须注明成员与理由 | **落地**（fake 为纯 map 队列，确无 native timer；属性签名位 `setTimeout:` 不触发裸调用正则） |
| m4 R2 口径 | §8 R2（:748）：85 工厂调用 + 4 internal fixture，含逐文件计数 | **落地** |
| O1 AC11 fiber 级解读 | 头注契约第 2 条（:435）+ 机制段首「解读按…= fiber 级」（:459） | **落地** |
| O2 timer 先卸后果 | 头注契约第 1 条（:434）：idle 回收停摆、不崩溃不泄漏、后续 `ctx.timeout` 抛 INACTIVE_EFFECT 属宿主违约 | **落地**，且经复核「后续 open 仍可激活滞留 entry」（disposer 幂等 no-op，不 throw）的表述准确 |

## 专项核验（R2 任务点）

1. **arm-token 首查位置（token 在 entries/phase 守卫之前）——次序无关性论证：通过**。
   设计把 token 判别放在武装闭包内、`beginIdleClose`（identity→phase 守卫）之前。三查均为纯读、
   首个副作用（`idleTimerHandle=undefined`）在全部守卫之后，故任意次序等价。逐一枚举五类 no-op
   场景验证双序皆拦截：(a) 同 entry 重武装（re-arm）→ 仅 token 拦（T 先/T 后皆然）；(b) 已激活
   → token+phase 双拦；(c) entry 已被替换 → identity 拦；(d) shutdown 取消后迟到回调（handle=
   undefined ≠ T1）→ token 拦；(e) 步骤 4 清空后 → identity 拦。反向论证：token 匹配 ⟹ entry
   仍当前且 idle（activateEntry/shutdown 均先置 undefined 后翻相，同一同步段）——token 几乎单独
   充分，identity/phase 为纵深防御。**次序选择正确，无次序错误**。
2. **I4×I1×shutdown 交互自洽——通过**（见上表 m2 行；步骤 2 assign-then-flip 保 I2；豁免窗口
   内无 re-arm 可能——`handleLeaseReleased` 的 acceptance 早退）。
3. **§2.A/§2.F/§2.G 三处 DEFAULT_IDLE_TIMEOUT_MS 零矛盾——通过**（见上表 M3 行）。
4. **测试 3a/15a/28a/25/19 可执行性——通过**（附 2 条 SA6 执行注记，见下方 OBSERVATION）：
   - 3a：adversarial scheduler 经公共 `RegistryTimeoutScheduler` 注入面即可构造（自记回调、
     `clearTimeout` 为 no-op）——**不泄漏任何 Registry 内部状态**（fake 只知自己的回调队列，
     `pending()` 语义等价锚是 fake 自身计面），不违反 §2.J 冻结边界（不暴露 entry map/lease
     count/queue/registry 侧 timer handle）。
   - 15a/19：断言全部落在公共面（stub close 调用计数、shutdown rejection 的 code/name/message/
     failures、getStatus）✓。
   - 28a：`fiber.state`、`ctx.get`、`plugin.instance` 均公有可断言；「补装后转 ACTIVE」经
     `await fiber`（fiber.then → fiber.await）可等待 ✓。
   - 25：次序断言需 SA6 用「测试先直调 `registry.shutdown()` 拿 same-Promise 并先行挂接 settle
     续体 + gate 卡住 close」技巧拉开可观测窗口（AC12 幂等使 disposer 内 await 与测试共享同一
     实例、注册序保证测试续体先醒）——规格可照写，见 O-R2-2 注记。

## R2 新一轮攻击发现

| # | 严重度 | 位置 | 漏洞 | 修复建议 |
|---|--------|------|------|---------|
| m-R2-1 | MINOR | §2.B I4（:107） | I4 宣称「对取消/替换后仍被调度的回调（adversarial 或违约 scheduler）结构性免疫，**不依赖 scheduler 自身正确性**」——该无条件声明对 **handle 不可判别的 scheduler**（每次 setTimeout 恒返 undefined/常量）不成立：两代武装的 token 相等（undefined===undefined）→ 迟到旧回调通过 token 检查且 phase==='idle'（第二窗口）→ H1 的提前 close 在该退化 scheduler 下复活；同时 I1 的 ⟺ 也被破坏（idle ∧ handle===undefined 出现于 running 期）。缓解事实：此类 scheduler 连自身 `clearTimeout` 契约都无法履行（无法区分该取消谁），生产桥（ctx.timeout disposer 恒为互异函数对象）与官方 fake（递增 id）均不产生该形态，故实际攻击面为空——但冻结不变量的**声明范围过宽**。 | 二选一：(a) 措辞收窄（最小改动）——I4 补一句「前提：scheduler 对同时存活的武装返回可相互判别的 handle（clearTimeout 语义的必然要求；生产桥与官方 fake 均满足）」，并在 §2.A 的 `RegistryTimeoutScheduler` 契约注释写明同一前提；(b) 内部 arm-token（每次武装生成唯一闭包哨兵对象存 entry、判别比较哨兵而非 scheduler handle）——使免疫真正无条件。任一均可，(a) 已足。 |
| O-R2-1 | OBSERVATION | §7 测试 3a | 「phase 不变、零 closePromise」是内部态速记——SA6 需以公共可观测等价物落笔（stub `close()` 调用计数===0、后续 create→`ALREADY_EXISTS` 零 Persistence、或 open 复用同 Runtime marker）。 | SA6 落笔时替换为可观测断言；无需改设计。 |
| O-R2-2 | OBSERVATION | §7 测试 25 | 「恰呈该序」的严格次序观测依赖测试先行直调 `registry.shutdown()` 挂接 same-Promise settle 续体（AC12）+ gate 卡 close 拉开窗口；若 disposer 先行触发，`shutdownSettled` 与 `serviceRevoked` 退化为同拍不可分辨（断言仍真但失去区分力）。 | 建议在 25 规格补一句执行技巧注记（先行直调 + gate），SA6 照写即得严格序。 |
| O-R2-3 | OBSERVATION | §2.M 守卫 2 | plugin.ts 现也落入「全部 src」扫描面：其内 `setTimeout: (callback, …) => …` 属属性签名位（`setTimeout` 后随冒号非裸调用），正则不误报；实现时保持「桥接只调 `ctx.timeout`、不裸调 setTimeout」即绿。 | 无需改动；SA4 实现评审照此核对。 |

**R2 新攻击中确认无缺陷的点**（已推演排除）：arm-token 与 shutdown 步骤 2 复用 closePromise 路径正交（wrapper 只门控 timer→beginIdleClose，shutdown 直接发起 close，无双发）；stale 回调在任何 no-op 路径上都先于副作用返回，与 `removeOnlySelf` 零交互；同一匹配回调被 adversarial scheduler **二次触发**亦被 I4 吸收（beginIdleClose 首次执行即置 handle=undefined → 二次 token 失配）——I4 顺带获得了 double-fire 免疫；同步触发 scheduler（赋值前回调）被 phase 守卫安全拦截（见 H1 行核验）。

## R2 结论

- R1 全部 12 项要求（7 必修 + 5 顺手）经正文实文核验**真实落地**，无「只改落实表不改正文」项。
- 修订未引入 HIGH/MEDIUM 缺陷；新增文本中仅 1 个 MINOR（I4 声明范围过宽，措辞级，附一行修复）
  与 3 条 SA6/SA4 执行注记。
- **Verdict: PASS**。m-R2-1 建议随 SA4 实现评审顺手收窄（不阻塞放行）；O-R2-1/2 转 SA6 落笔参考。
- `pass` 仅表示设计通过审查；实现与活链路验证仍由 SA4/SA7 承担（R1 的 O4：生产 `runtime.close()`
  同步不可抛 + 幂等同实例是 §2.B/§2.D 裸调的前提，SA4 需确认实现不引入违背项）。
