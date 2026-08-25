# SA2 攻击评审报告 — issue #107 persistence 迁移 nomicorePersistence 与外部 Clock/Timer

**Date**: 2026-08-25
**Verdict**: **FAIL**（3 项阻断缺陷；设计主体强——9 条协议假设 8 条经我方独立读源码证实，逐文件改动面与 11 处 file 构造点枚举全部核实无误——但 AC4 机械锚点自相矛盾、文档 sweep 证据被证伪、probe 双时间基不变式缺失，三者均会在 SA3/SA4 阶段直接卡门禁）

**评审对象**: `wiki/raw/task_persistence-timer-service-migration_design.md`（SA1 R0，565 行）
**独立证据来源**（本人亲自读取，非转述 SA1）：
- `node_modules/.pnpm/@deepseek-ai+cordis@4.0.1/.../cordis/src/{service,reflect,fiber,context}.ts`（逐段）
- `/tmp/ds-timer-inspect/package/src/index.ts` + `package.json` + `lib/types/index.d.ts`（@deepseek-ai/cordis-plugin-timer@1.1.3 tarball 解包，SA1 留存目录仍然在位，我已复核）
- `packages/persistence/src/{contract,lifecycle,memory,file,testing,index}.ts`、`packages/dsh-persistence/src/{profile,clock,probe,events,index,cli,record}.ts`、`packages/clock/src/*`、两包全部 12 个测试文件、根 `package.json`/`pnpm-workspace.yaml`/`tsconfig.base.json`/`vitest.config.ts`
- 全仓 grep 复核（`docPersistence|PersistenceTimer|systemPersistenceTimer|provideDocPersistence|requireDocPersistence|DOC_PERSISTENCE`，排除 node_modules/wiki/raw）

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | AC4 静态守卫（§6.9 / §5 AC4 锚点） | 守卫正则 `/\b(?:setTimeout\|setInterval\|clearTimeout\|clearInterval)\s*\(/` 对迁移后代码**自身**命中 ≥9 处（lifecycle 7 个 `this.scheduler.setTimeout/clearTimeout(` 调用点 + contract.ts `PersistenceScheduler` 接口签名 2 处），「零命中」目标在正确的实现下**永不可达** | 改为只禁 host 全局 API：`/(?<![\w$.])(?:setTimeout\|setInterval\|clearTimeout\|clearInterval)\s*\(/`（排除属性调用）+ 显式 `/\bglobalThis\s*\.\s*(?:setTimeout\|setInterval\|clearTimeout\|clearInterval)\s*\(/` + `/\bDate\s*\.\s*now\s*\(/`；仓内已有变长 lookbehind 先例（module-graph 测试） |
| 2 | **CRITICAL** | 文档面 sweep（裁决 9 / §10 假设 8 / §8 步骤 12） | `packages/clock/src/contract.ts:28` JSDoc「对齐 **provideDocPersistence** 模式」落在设计自己给出的 grep 扫描范围内（`packages --include='*.ts'`），假设 8「文档面无残留」被证伪；步骤 12 的预期「仅 wiki/raw 历史档案命中」必然失败；而 `packages/clock/**` 又在 DENY LIST——设计自相矛盾，SA3 无合法修复路径 | 二选一并在设计中写死：(a) ALLOW LIST 增补 `packages/clock/src/contract.ts` 仅第 28 行注释一条（doc-only，零行为）；(b) 步骤 12 预期显式豁免该行。同时修正证据引用（见 #11） |
| 3 | **CRITICAL** | probe 确定性（裁决 6 双不变式） | 只列了两个不变式，**缺第三不变式「单一虚拟时间基」**：伪码只 `manual.set(...)`，从未规定 fake timer 的 `at = ??? + delayMs` 以哪个 now 为基。若 SA3 按 §3.2 把 `createFakeTimerPlugin` 委托给 `createTestScheduler`（其内部 now 已删、无法被 timeline 读取/推进），后续 setTimeout 的 deadline 与 manual clock 脱钩 → 事件刻度漂移 → `dsh-file-probe-determinism` 的 `t=2008/t=2009/events=28` 逐字节断言红 | 裁决 6 补不变式 ③：「timeline 独占 timer 登记表；fake scheduler 是该表 + `manual.now()` 的视图（`setTimeout: at = manual.now()+delay`），禁止复用 createTestScheduler 的独立内部时钟」；并给出 wiring 伪码 |
| 4 | MINOR | §4.B 行号枚举 | 「6 处调度点（434/436、490、505/510/517）」漏了 **435**（`this.timer.clearTimeout(entry.debounceTimer)`）；实际 `this.timer.` 调用点 = **7**（434/435/436/490/505/510/517，本人 grep 核实） | 字段更名 `this.timer→this.scheduler` 由 typecheck 兜底，但请改准枚举，防 SA3 逐行机械执行漏改 |
| 5 | MINOR | §4.E 导出计数 | 「-5 旧名 +2 新名」：实际新增 4（`NOMICORE_PERSISTENCE_SERVICE`/`provideNomicorePersistence`/`requireNomicorePersistence`/`PersistenceScheduler`），删除 5 ✓ | 改为 +4 |
| 6 | MINOR | §6.4 构造点计数 | issue-79-entry-status.test.ts 实际 **9** 处构造点（57/88/120/162/198/237/277/294/295），设计写「6 处」 | 改准；规则本身（`{ timer }`→`{ scheduler }` 全量）没错 |
| 7 | MINOR | §6.1 双选项陷阱 | 「本地 FakeTimer 删 now（**或直接 import createTestScheduler**）」——选项 B 会丢 `cleared()`（memory-persistence 192/211 行断言依赖），与「断言零变化」承诺冲突 | 删掉选项 B 或注明「cleared() 用例必须保留本地 FakeTimer（仅删 now）」 |
| 8 | MINOR | §3.2 createFakeTimerPlugin 契约 | 未写明 fake 的 `timeout` **必须返回 disposer 函数**——桥接 `clearTimeout(handle) === handle()` 依赖它；若 SA3 直接透传 scheduler 的 number id，clearTimeout 静默变 `(number)()` → TypeError | §3.2 补一句签名：`timeout(cb, ms): () => void`（内部包 `() => timer.clearTimeout(id)`） |
| 9 | MINOR | §6.2 谓词充分性 | 「谓词如快照文件存在」只对首写用例成立；`file-persistence.test.ts:300-324`（chmod 0o444 后二次 flush）文件已存在，谓词必须解码内容断言 generation=2；另 `seedAndFlush` 虚拟化后 waitFor 必须在 `writer.dispose()` **之前**完成（dispose 经 AbortSignal 掐断在途写 → 永不落盘） | §6.2 逐用例列谓词：首写=存在；覆盖写=内容解码；并显式「waitFor 先于 dispose」 |
| 10 | MINOR | §8 中间态 | 步骤 2–7 期间包内 typecheck/test 必红（设计已承认步骤 3 红点，但未禁止中途跑全量门禁） | 步骤 8/11 前加一句「不跑 pnpm typecheck/test 全量门禁」 |
| 11 | MINOR | 裁决 9 证据引用 | 声称 grep 命中「TASK.md」——但该 grep 路径列表（CONTEXT.md AGENTS.md README.md docs packages）**不含 TASK.md**；声称「phase-4:23 命中 docPersistence」——phase-4 全文无该串（只有 `ctx.nomicorePersistence` 前瞻表述）。证据链与命令输出不符 | 修正引文；重跑并把真实输出贴进 §10 |
| 12 | MINOR | 风险 8 计数 | 「~8 处 sleep(250)」实际 **7** 处（seedAndFlush 内 1 + 6 个调用点，+L138 直调 1 = waitForFlush 总 7 次调用） | 改准（不影响方案） |
| 13 | MINOR | AC2 锚点覆盖 | 负向 A/B 都打在 memory plugin 工厂；file plugin apply 路径走同一 `assertPersistenceHostDependencies`（共享单点），可接受但建议补一条 file 工厂负向 | 可选加一条负向锚点 |
| 14 | MINOR | AC3 锚点指名 | 「组合测试经 fake timer plugin 验证 ctx.timeout→虚拟计时器」成立但未指名文件——实际驱动者是 dsh-profile-acceptance AC4 service 级用例（经 ProbeTimeline 走完整 ctx.timeout 桥）+ core-dsh-boundary 正向（真实 TimerService） | §5 AC3 行补锚点文件名，便于 SA4 对照 |
| 15 | MINOR | timer fiber 生命周期不变式 | 风险 3 只覆盖 adapter 自身 dispose；若未来宿主先拆 timer fiber 再用 persistence（今日 DSH profile 顺序下不可达），`scheduleRetry→ctx.timeout` 会在 native 回调里抛 INACTIVE_EFFECT（uncaught） | service.ts JSDoc 写明「timer fiber 生命周期 ⊇ persistence adapter 生命周期」契约 |

---

## 2. 阻断缺陷详述

### B1（CRITICAL）— AC4 静态守卫正则与设计自身的调度缝签名冲突

- **位置**：§2 裁决 2 引用、§5 AC4 行、§6.9 第 9 行（module-graph-regression 新增 it()）。
- **证据**：设计 §3.1 规定 `PersistenceScheduler { setTimeout(callback…): unknown; clearTimeout(handle…): void }`（contract.ts）；§4.B 规定 lifecycle 保留 7 个 `this.scheduler.setTimeout/clearTimeout(` 调用点（434–436/490/505/510/517）。正则 `/\b(?:setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/` 中 `\b` 在 `.` 与 `s` 之间成立，`this.scheduler.setTimeout(` 与接口签名 `setTimeout(callback…` 均**命中**。合计 ≥9 处真实命中（contract.ts 2 + lifecycle.ts 7）。
- **为何阻断**：AC4 的机械锚点「六生产文件零命中」在**任何正确实现下都不可能绿**。SA3 要么擅自改弱正则（锚点与设计文本背离，SA4 静态门禁红），要么卡死；AC4→§6.9 这条映射链断裂。
- **建议修法**：守卫目标改为「host 全局 timer API」而非「任何同名调用」：
  1. `/(?<![\w$.])(?:setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/`（裸调用；负向 lookbehind 排除 `scheduler.`/`globalThis.` 属性调用——V8 变长 lookbehind 仓内已有先例：module-graph-regression.test.ts:34）；
  2. `/\bglobalThis\s*\.\s*(?:setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/`（现行 `systemPersistenceTimer` 的确切形态）；
  3. `/\bDate\s*\.\s*now\s*\(/`。
- **红灯测试思路**：守卫用例自带正反样本表（同文件既有 `guard matches … only` 先例）：合法样本 `this.scheduler.setTimeout(cb, 10)`、`setTimeout: (cb, ms) => …`（接口/对象字面量成员位）；非法样本 `setTimeout(cb, 10)`、`globalThis.setTimeout(cb, 10)`、`Date.now()`；先在守卫自身断言判别力，再扫六文件。

### B2（CRITICAL）— 假设 8（文档面无 docPersistence 残留）被证伪，步骤 12 门禁必红且与 DENY LIST 矛盾

- **位置**：§2 裁决 9、§10 假设 8、§8 步骤 12、§9 DENY LIST（`packages/clock/**` 冻结）。
- **证据**（本人独立 grep）：`packages/clock/src/contract.ts:28`——`/** 在当前 Context 发布 Clock service；返回注销函数（对齐 provideDocPersistence 模式）。 */`。该文件命中设计自己给出的命令 `grep -rn "docPersistence" … packages --include='*.ts' --include='*.md'` 的全部过滤条件。另：裁决 9 引用的「TASK.md 命中」不在该命令路径内、「phase-4:23 命中」实际不存在（phase-4 只有 `ctx.nomicorePersistence`），证据文本与可复现输出不符（攻击点 #11）。
- **为何阻断**：(a) §8 步骤 12 是设计的收口验证步，预期「仅 wiki/raw 历史档案命中」——注意该命令路径根本不含 wiki/raw，且必命中 clock/src/contract.ts，**按字面执行必失败**；(b) 唯一修复（改注释）被设计自己的 DENY LIST 禁止，SA3 无合法动作空间；(c) AC7「文档…与新 service 名一致」字面下，冻结包内留旧符号名注释属于验收争议面。
- **建议修法**：ALLOW LIST 增补一条：`packages/clock/src/contract.ts` **仅 28 行注释**（「对齐 provideDocPersistence 模式」→「对齐 provide 型 helper 模式」），并在设计里注明这是 doc-only 例外、不触碰 clock 任何行为/API（issue #106 冻结的是行为面）；或步骤 12 预期显式列白名单。二选一写死，消除 SA3 的自由裁量。
- **红灯测试思路**：步骤 12 命令原样重跑并把 stdout 贴入 REPORT 作为机械证据；若选 ALLOW，grep 预期输出恰为 `packages/clock/src/contract.ts` 0 命中 + ADR-0009:26（前瞻原文，保留）。

### B3（CRITICAL）— ProbeTimeline 缺「单一虚拟时间基」不变式，record 逐字节等价无保证

- **位置**：§2 裁决 6（advanceBy 伪码 + 两不变式）、§3.2/§3.3（createFakeTimerPlugin 委托「注入的 fake scheduler」）、§6.10/§6.12。
- **证据**：旧 `ProbeClock` 单对象同时持有 `now`（观测）与 timer 登记基线（`at = now + delayMs`，clock.ts:41-44），两者天然同源。新设计拆成 manual clock（`@nomicore/clock/testing` 的 `createManualClock`，本人核实其确有 `set/advance` 且初值 0）+ fake timer（`createFakeTimerPlugin` 委托注入 scheduler）。裁决 6 伪码只出现 `manual.set(timer.at)` / `manual.set(deadline)`，**从未规定 fake 侧 `setTimeout` 的 `at` 以何为基、由谁推进**。而 `TestScheduler`（裁决 7）恰恰「实现即现行 createTestTimer 主体删 now」——其内部 now 不可外部读取/推进。若 SA3 依 §3.2 签名把一个独立 TestScheduler 塞给 createFakeTimerPlugin，首腿之后所有 `at = 0 + delay`（内部 now 停在 0）≠ 旧实现 `at = 当前刻度 + delay`。
- **为何阻断**：`dsh-file-probe-determinism.test.ts` 钉死 `t=2008 / t=2009 / events=28` 与三跑逐字节一致；deadline 基线漂移直接改写 `t` 序（retry 链 `delay×2 cap maxDirtyMs` 全部错位）→ 该锚红 → AC6（probe record 逐字节）/AC7 连带红。设计的「两不变式」对这类实现**结构性失明**。
- **建议修法**：裁决 6 增补不变式 ③ 并给出 wiring：「timeline 独占 timer 登记表与虚拟刻度；`createFakeTimerPlugin` 注入的是该表的 scheduler **视图**——`setTimeout(cb, d): at = manual.now() + d`；`clearTimeout(id): timers.delete(id)`；禁止委托带独立内部时钟的 TestScheduler」。伪码同步把 `timers`/`manual` 标注为同一闭包状态。
- **红灯测试思路**：新增单测：同一 timeline 上 `advanceBy(500)` 后再 `setTimeout(cb, 10)`，断言 `pending()===1` 且 `advanceBy(10)` 恰触发、触发时 `now()===510`（内部时钟停摆实现下此断言必红）；再跑 determinism 锚确认 28 事件与 t 序不变。

---

## 3. 非阻断建议

即攻击点清单 #4–#15。重点重申三条：#7（§6.1 选项 B 是陷阱，先删）、#9（file 虚拟化谓词逐用例化 + waitFor 先于 dispose）、#15（timer fiber ⊇ adapter 生命周期契约写入 service.ts JSDoc）。其余为计数/引文修正，SA1 修订时可顺手清掉。

另核验通过、无需改动的两个「疑似盲点」（总控攻击面 #7）：
- **根 typecheck 脚本顺序（persistence 在 clock 之前）**：不构成问题。各包 tsconfig 均 `noEmit` + `include` 仅自身、无 references/paths，跨包解析经 pnpm symlink → `exports`（`.`→`src/index.ts`）由 `moduleResolution: bundler` 直读**源码**；脚本条目相互独立。既有先例：dsh-persistence（第 5 位）依赖 persistence（第 4 位）全绿至今，方向相同。
- **pnpm `workspace:*`**：`pnpm-workspace.yaml` 声明 `packages/*`，dsh-persistence 已用 `"@nomicore/persistence": "workspace:*"`；新增 `@nomicore/clock: workspace:*` 同构。tsconfig 零改动（设计 §4.M 正确）。

---

## 4. 协议假设逐条复核表（§10 全部 9 条 + 3 项追加）

| # | 假设 | 裁定 | 我方独立证据（亲自读到） |
|---|---|---|---|
| 1 | `ctx.timeout` 返回幂等 disposer；effect 挂 TimerService 自身 ctx；触发路径先 `dispose()` 再 `callback()` | **confirmed** | timer `src/index.ts` timeout(callback) 分支：`const dispose = this.ctx.effect(() => { const timer = setTimeout(() => { dispose(); callback() }, delay); return () => clearTimeout(timer) }, 'ctx.timeout()')`；cordis `fiber.ts` effect 内 `const dispose = () => { if (disposing) return disposalTask; disposing = true; … }`（单次守卫）。effect 归属 `this.ctx`（TimerService 构造 ctx = root）——风险 1 的表述准确 |
| 2 | `new TimerService(ctx)` 同步 provide + mixin，apply 返回即可用 | **confirmed** | cordis `service.ts` 构造器尾行 `self.ctx.reflect.provide(name, self, this[symbols.check])`（同步）；`reflect.ts` provide → `this.ctx.fiber.effect(...)`，`fiber.ts` `effect()` 内同步 `task = this._execute(runner)` 执行 effect 体（写 store）；timer 构造器随后同步 `ctx.mixin('timer', [...])`；`fiber.ts` root 分支 `this.state = FiberState.ACTIVE` → strict `ctx.get('timer')` 立即非 undefined |
| 3 | `ctx.plugin()` 异步启动 | **confirmed** | `fiber.ts` `_reload()`：`this.store = {…}` 后首 checkpoint `await Promise.resolve()` 才 `_execute(this._runner)`——同步装配不得用 ctx.plugin，设计规避正确 |
| 4 | `ctx.get` 缺失返回 undefined、从不 throw | **confirmed** | `reflect.ts` `get(name, strict=true)` → `_getImpl`：`if (!impl) return` / `if (strict && impl.fiber.state !== ACTIVE) return`，无 throw 路径 |
| 5 | service active ⟺ mixin 可解析（同 fiber） | **confirmed**（限直接 apply 路径） | provide 与 mixin 都落在 TimerService 构造 fiber 的 effect；`ReflectService.handler.get` waterfall 默认回调自 `(ctx.shadow ?? ctx).fiber` 逐级 `fiber.store?.[prop]` 上溯，isolate key 同源即达——**非 root 子 Context 上 `ctx.timeout` 同样可解析**（总控追问点，已闭）；注意若宿主改用 `ctx.plugin` 装载，激活前 strict get 为 undefined——风险 2 已覆盖 |
| 6 | `./testing` subpath 指向 .ts 可用 | **confirmed** | `packages/clock/package.json` exports 已含 `"./testing": "./src/testing.ts"`（#106 交付全绿先例）；vitest（vite-node）与 tsc bundler 均按 exports 解析 |
| 7 | timer 插件 peer（cordis ^4.0.1）兼容 | **confirmed** | tarball `package.json`：peerDependencies `@deepseek-ai/cordis ^4.0.1`、dependencies `@deepseek-ai/cosmokit ^1.8.2`；仓锁 cordis 4.0.1，`.pnpm` store 已有 cosmokit@1.8.2 |
| 8 | 文档面无 docPersistence 残留 | **REFUTED** | `packages/clock/src/contract.ts:28` 注释含 `provideDocPersistence`，在设计的 grep 范围内；且引文 TASK.md 不在命令路径、phase-4:23 无该串 → B2 |
| 9 | profile dispose 顺序（adapter→fiber）仍成立 | **confirmed** | `memory-persistence.test.ts:510-531` 现绿；root fiber dispose 实为 restart：`_setEpoch(INACTIVE)`→`_unload()` 清 effect（reverse）→ reload 空转；adapter dispose 幂等（closed 卫），timer disposers 挂 root fiber 随 unload 回收；`dsh-profile-acceptance.test.ts:477` 断言 dispose 后 service undefined 现绿 |
| 追加 A | mixin 属性访问器在子 Context 可用 | confirmed | 见 #5 证据行（handler.get 上溯 + `withProps(receiver, service)` 绑定） |
| 追加 B | fake plugin（`ctx.provide('timer', obj)` + `ctx.mixin('timer',['timeout'])`）可行 | confirmed | `reflect.ts` provide 接受任意 value；mixin 只要求访问时 `Reflect.get(service, key)` 存在——fake 仅需 `timeout` 成员；strict get 要求提供 fiber ACTIVE（root 直接 apply 即 ACTIVE）。补充契约缺口见攻击点 #8 |
| 追加 C | timer 触发路径「先 dispose 再 callback」对 clearTimers 无坑 | confirmed | dispose 先行只清 native timer 与 effect 登记，callback 仍执行；lifecycle 的 `clearTimers` 在 dispose 路径同步调用 disposer（幂等，已触发腿为 no-op）；触发后重排（flush finally → scheduleFlush）走同一 `ctx.timeout`，fiber 仍 ACTIVE（adapter 未 closed） |

**协议假设依据审查（技能立法项）**：§10 章节在位 ✓；8/9 条依据含具体源码行引用且我方可复现 ✓；唯假设 8 的「实测验证」与其自称的命令输出不符（REFUTED，B2）——依据链必须重跑修正。

---

## 5. AC 映射完整性表

| AC | 设计条款 | 机械锚点 | SA2 裁定 |
|---|---|---|---|
| AC1 service 更名 + 消费方同步 | 裁决 4；§4.A/D/E/I/J/K | contract 常量断言 + `ctx.get(...)` 更名清单（§11 表逐行枚举，本人核对 memory:516/520/527、file:354/363、core-dsh:40-48、dsh-acceptance:148/477 与源码一致）+ 全仓 typecheck | **完整** |
| AC2 强依赖 clock+timer loud fail | 裁决 3；§4.C/D | core-dsh-boundary 负向 A（缺 clock）/B（缺 timer）文案断言；requireClock 现文案 `required Cordis service "clock" is unavailable`（clock/src/contract.ts:41）逐字匹配 | **完整**（file 工厂负向可选补，#13） |
| AC3 全部一次性调度走 lifecycle-managed ctx.timeout | 裁决 1/2；§4.B/C/D | 桥为 plugin 路径唯一 scheduler 源；fake-timer 组合 + dsh profile（经 ProbeTimeline 真走 ctx.timeout 桥）+ AC4 守卫 | **基本完整**，锚点未指名文件（#14） |
| AC4 不提供/fallback 自建 timer | 裁决 1/2；§4.B/E | 导出删除 + 构造器无默认 + 静态守卫 | **条款完整、锚点缺陷**（B1：正则必红） |
| AC5 Clock 只观测 / Timer 管调度 | 裁决 1/6；§3.1/§3.3 | `PersistenceScheduler` 无 now；probe `t` 读 manual clock、flush/retry 走 fake timer | **完整**（clock 断言未消费已由风险 9 显式承认，符合 ADR-0009:83 Host 契约） |
| AC6 行为零回归 | §4.B（只换缝名）；裁决 2/7 | 共享套件断言逐字不动（已核：testing.ts 套件从不调 `timer.now()`，仅 advanceBy/pending 于 247/281/283/405/553 + 解构 236/270/395/528）；probe 逐字节锚 | **条款完整**；lifecycle 枚举漏 435（#4）；probe 等价性缺不变式 ③（B3） |
| AC7 DSH profile/接线/文档/contract tests 一致 | 裁决 5/9；§4.H–L | dsh-profile-acceptance 更名断言 + 文档 grep sweep | **sweep 证据被证伪**（B2），其余完整 |
| AC8 typecheck/test 全绿 + Node 20/24 | §8 步骤 11 | `pnpm typecheck`（8 包 tsc）+ `pnpm test`（vitest --typecheck） | **完整**（typecheck 顺序疑点已排除，见 §3；timer 插件 `Promise.withResolvers` 仅 promise 分支触及、persistence 只用 callback 形态，Node>=20 安全） |

---

## 6. 错误处理链路审查（技能立法项）

- **静默失败**：无。AC2 断言在 provide 之前同步 throw；`ctx.get` 探针失败路径全覆盖（缺 service / service 非 active / 成员非函数三态都有 loud 出口）；`clearTimers` 的 disposer 调用幂等（fiber.ts 单次守卫）。
- **状态闭环**：plugin 启动失败 → apply 同步上抛 → profile/probe/测试三层 caller 的处置在 §11 caller 表逐行登记（本人核对行号与源码一致）；`apply` 失败不 provide，无半注册状态（断言先于 `ctx.effect`）。
- **降级路径**：无降级设计（正确——缺依赖是 Host 装配错误，不是可降级场景）。
- **虚假降级识别**：无伪降级。fake scheduler/fake timer plugin 是**测试显式注入的替身**且生产路径无默认可达（构造器必填 + 工厂内唯一来源 `ctx.timeout`），与「bug 被降级掩盖」形态无关；`withTimeout` 的 globalThis.setTimeout 是 never-settle 守卫，豁免正当。
- 遗留建议：#15（timer fiber 生命周期契约）与 #8（fake timeout 返回形状）是两条会让错误「晚到而非不到」的缝，写入设计即可闭。

## 7. 红灯测试思路（汇总）

1. **B1**：守卫正反样本表 + 六文件零命中（修正版正则下绿、原版正则下必红——先用样本表证明判别力）。
2. **B2**：步骤 12 grep 重跑贴输出；ALLOW 修订后 clock/src/contract.ts 零命中。
3. **B3**：timeline 基线单测（advanceBy(500) 后 setTimeout(cb,10)，advanceBy(10) 恰触发且 now()===510）+ determinism 三跑逐字节锚不降级。
4. **#9**：file 虚拟化用例逐个：首写谓词=快照存在；覆盖谓词=解码 rev；断言 waitFor 超时路径 loud（ProbeTimeoutError 同款）。
5. **#7**：memory「cancels the paired timer」两用例保留本地 FakeTimer（删 now）后 `cleared()` 断言原样绿。
6. **#8**：fake timer plugin 单测：`timeout` 返回值可调用且二次调用幂等、调用后 pending 减一。

## 8. 裁决

**FAIL**。三项阻断缺陷（B1 AC4 锚点自相矛盾 / B2 文档 sweep 证伪+DENY 矛盾 / B3 probe 时间基不变式缺失）均可在 SA1 一轮文字修订内闭合——不触及任何裁决方向本身（十条裁决的架构选择我方全部认可：双轨测试 seam、service.ts 叶子模块、同步直 apply 装配、ProbeTimeline 拆分、DocPersistence 接口名保留，依据链均扎实）。修订后建议快速复审（只看 B1–B3 修订块与 #7/#8/#9 三条），无需全量重审。

---

## R1 复审（2026-08-25，按本报告 §8 建议的快速复审范围）

**R1 Verdict: PASS**——B1/B2/B3 三项阻断全部实质闭合（非承认式回应，每项都有独立可复现证据）；MINOR #7/#8/#9 落实到位；R1 修订未引入新缺陷。放行 SA3。遗留 1 条非阻断建议（L-1，不设门禁）。

### B1（AC4 静态守卫）——已闭合 ✅

**修订面**：§6.9 守卫重写（三条正则 + 剥注释/字符串 + 正反样本表先证后扫）；裁决 1 + §3.1 接口锁定 property-signature 形态；§5 AC4 行同步。

**我方独立验证**（node 正则仿真，无状态匹配）：
- 三正则 ①`/(?<![\w$.])(?:setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/` ②`globalThis.…` ③`Date.now(`：**10 个合法形态全部不命中**（含 `readonly setTimeout: (cb, ms) => unknown` 接口成员位、`setTimeout: (cb, ms) => ctx.timeout(…)` service.ts 桥接箭头形态、`this.scheduler.setTimeout/clearTimeout(` 属性调用、`ctx.timeout(`、timer 插件 type-only import）；**6 个非法形态全部命中**（裸 `setTimeout(cb, ms)`、`globalThis.setTimeout/clearTimeout(`（现行 `systemPersistenceTimer` 的确切形态）、`clearTimeout(x)`、`Date.now()`）。
- **配套自洽性核实**：R0 正则 `\b…\s*\(` 确实同时命中 R0 的 method-signature 接口（`setTimeout(callback: …)`）与 lifecycle 属性调用——B1 前提成立；R1 改 property-signature（`setTimeout:` 后接 `: (`，`\s*\(` 不跨过冒号）+ 负向 lookbehind（属性调用前是 `.`）双保险，缝签名与守卫目标（host 全局 API）精确解耦。R1 对「method-signature 会被 lookbehind 漏排（即被误报）」的表述方向正确。
- 样本表先证后扫复用了本文件既有 guard-samples 先例（module-graph-regression.test.ts:78-105）与既有 strip 助手——可实现性无疑问。
- 残留（可接受）：若 SA3 把 service.ts 桥接写成 method-shorthand（`clearTimeout(handle) { … }`），守卫会红——这是守卫的保守性在强制 property 形态，与裁决 1 的逐字桥接代码一致，非缺陷。

### B2（文档 sweep 证据链）——已闭合 ✅

**修订面**：裁决 9 重写（含 R0 引文两处错误的自认勘误）；§8 步骤 12 换完整变体清单；§9 ALLOW 增 clock:28 单行 doc-only 例外 + DENY 加注；§10 假设 8 按真实输出重写。

**我方独立重跑**（在当前 worktree 逐字执行 R1 定稿命令）：
- 命中文件分布与 R1 声称的分类**完全一致**：persistence/dsh 两包 src+test 共 19 个文件（全部在 §4/§6 改动面 = ALLOW LIST 覆盖，迁移后符号消失）+ **恰好 2 处外部命中**：`docs/adr/0009…md:26`（迁移句，有意保留）与 `packages/clock/src/contract.ts:28`（ALLOW 内 doc-only 修订）。迁移后「恰 1 行」预期在算术上成立。
- **大写 D 论断实证**：`grep -c "docPersistence" packages/clock/src/contract.ts` = **0**，`grep -c "provideDocPersistence"` = **1**——R1 指出「仅小写 grep 会漏报 clock:28」属实（这正是 R0 设计漏掉它的机理）；完整变体清单是必要修正而非冗余。
- **替换文案核验**：ALLOW 修订目标文案「对齐 provide 型 helper 模式」对全部 6 个变体 0 命中——修后 clock 干净。
- **盲区探测**（我方主动加测）：sweep 路径外的根 `tests/` 目录（仅 `acceptance` 子目录）0 命中；`*.json/*.yaml/*.yml`（--include 不覆盖）0 命中——无路径外残留。DENY/ALLOW 的单行例外表述（clock 其余文件仍冻结）消除了 R0 的自相矛盾。

### B3（ProbeTimeline 单一虚拟时间基）——已闭合 ✅（附 1 条非阻断加固建议）

**修订面**：裁决 6 不变式 ③ + 同闭包 wiring 伪码（`at = manual.now() + delayMs`）+ 禁止形态明文（禁塞 `createTestScheduler` 等带独立内部时钟的 scheduler）；§3.2 createFakeTimerPlugin 补视图契约；§6.13 基线红灯单测；§7 风险 4 三不变式。

**我方独立验证**：
- 不变式 ③ 的 wiring 伪码与 `@nomicore/clock/testing` 的 `createManualClock(0)`（`set/advance` 均存在，初值 0 = 旧 ProbeClock 起点）及 §3.2 `createFakeTimerPlugin(Pick<PersistenceScheduler,…>)` 签名精确咬合，可直接照抄实现。
- §6.13 对**灾难形态**（独立内部时钟、从不被 timeline 推进）判红成立：该形态下 `setTimeout(cb,10)` 的 `at = 0+10`，`advanceBy(500)` 期间即被错误消耗/错位，`now()===510` 与「恰触发」断言必红——伪码+禁令+单测三层把 R0 的结构性失明闭死。
- **判别力边界（残留 L-1，非阻断）**：存在一种字面违反 ③ 但 §6.13 照绿的接线——「manual 先 `advance(ms)` 再委托内部时钟 scheduler 的 advanceBy」（单腿 `at===deadline` 场景下两种接线观测值相同）。该形态在 probe 全部现存场景（每腿 advanceBy(x) 恰对 at=now+x）下与正确接线**字节同值**，故 determinism 锚也不红——即今日无行为危害，仅违反立法字面。**建议（不设门禁）**：§6.13 追加一条两计时器中途断言（arm +5/+15 → `advanceBy(20)` → 断言两次触发时观测 `now()` 分别 ===+5/+15），可将该边界形态也判红。因 wiring 伪码已唯一规定正确形态、且错误形态无观测危害，不构成阻断。

### MINOR #7/#8/#9 落实质量 ✅

- **#7**：§6.1 删除选项 B、写死唯一方案「保留本地 FakeTimer 仅删 now」，并注明 192/211 行 `cleared()` 断言是硬依赖——与 R0 攻击点完全对位。
- **#8**：§3.2 契约补明 `timeout/setTimeout → () => void` 幂等 disposer（done 标志伪码、禁透传裸 id、附「裸 id 会 `(number)()` TypeError」的失败机理）+ B3 视图契约注释——闭合且可执行。
- **#9**：§6.2 谓词逐用例化（首写=existsSync；chmod 0o444 覆盖写用例=解码内容断言 `ROOT.rev===2`）+ 显式时序纪律「waitFor 必须先于 dispose（AbortSignal 掐在途写）」+ 超时路径 loud；§7 风险 8 同步更新（7 次运行时调用的源码点/运行时点拆分与我方 R0 实测一致）。
- 顺带核验 R1 其余 MINOR（#4–#6/#10–#15）的修订位置与内容抽样一致：7 调度点、+4 导出、9 构造点计数均与我方 R0 grep 实测吻合；§8 中间态纪律、负向 C、AC3 锚点指名、#15 生命周期契约 JSDoc 均已在正文落地。R1 新增表述（property-signature、不变式 ③、负向 C、三正则）在裁决/§3/§5/§6/§8/§9/§10 间交叉引用一致，未发现新引入的自相矛盾。

### R1 遗留问题清单

| # | 级别 | 内容 | 处置建议 |
|---|---|---|---|
| L-1 | 建议（非阻断，不设门禁） | §6.13 对「manual 先行 advance + 委托内部时钟 scheduler」的字面违规形态判别力不足（该形态今日无观测危害） | SA3 实现 §6.13 时顺手加两计时器中途断言（arm +5/+15 → advanceBy(20) → 触发时 now() 依次 ===+5/+15）；无需 SA1 再修设计、无需复审 |
