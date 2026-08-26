# SA6 红灯测试报告 — issue #112：idle retention / Cordis plugin / ordered shutdown

- **任务**：为 `wiki/raw/task_registry-idle-plugin-shutdown.md`（冻结设计，R1 修订 776 行）编写验收红灯测试。
- **基线**：`packages/namespace-registry` @ e1efbbe（shutdown 占位、无 idle、无 plugin.ts、无 scheduler seam）。
- **红线边界**：只改 `packages/namespace-registry/test/` 与 `wiki/raw/`；零 src/、零 package.json、零 tsconfig 改动。
- **验证命令**：`pnpm exec vitest run packages/namespace-registry --typecheck`（后台独立进程，`.mabf-bg/sa6-red.log`）。

---

## 1. 新增用例总数与逐文件清单

**新增测试用例 = 34 个**（3 个新文件 34 条 it；另 1 条新增 idle duplicate 行在 registry-create.test.ts —— 共 35 条新增断言单元）。

### `packages/namespace-registry/test/registry-idle.test.ts`（16 用例）

| # | 用例名 | 对应 AC / 设计测试编号 |
|---|---|---|
| 1 | scheduler 构造门禁：omitted/null/非 object/setTimeout 非函数/clearTimeout 非函数 → 同步 TypeError 恒定文案 | §2.A（scheduler 必需 + 形状门禁；AC4 基础面） |
| 2 | 最后 lease release → entry 进入 idle：entry-idle 恰一次、timer 武装、runtime 未 close、release same-Promise | §7 测试 1（AC4） |
| 3 | 完整 idleTimeoutMs：advanceBy(299_999) 不 close；advanceBy(1) close、entry 清理、新 open 全新 generation | §7 测试 2（AC4） |
| 4 | 重进 idle 重置完整时限：重武装后新窗口从零起算 | §7 测试 3（AC4） |
| 5 | **3a. arm-token adversarial（R1/H1）**：旧回调手动触发 no-op、新 timer 存活、完整窗口后才 close | §7 测试 3a（R1/H1） |
| 6 | timeout=0：release resolve 后 runtime 仍未 closed；advanceBy(0) 后才 close（异步性双锚） | §7 测试 4（AC6） |
| 7 | fatal Runtime 同 idle 语义：release → idle → advance → close 照常 | §7 测试 5（AC6） |
| 8 | degraded Runtime 同 idle 语义 | §7 测试 5（AC6） |
| 9 | idle 期第二次 release / asyncDispose 回归：same-Promise 与 released status；open 复用仍同步取消 | §7 测试 6（AC4） |
| 10 | idle 期 open（advance 前）：同步取消 timer（pending 0）、复用同一 Runtime、零 loadDoc、新 lease | §7 测试 7（AC5） |
| 11 | timer 先行（closing 已建立）：open 等待同一 close Promise 结算 → entry 移除 → 全新 generation | §7 测试 8（AC5） |
| 12 | closing-wait 中 close reject：open 吞掉并继续建新 generation；observer idle-close-failed exact cause 恰一次 | §7 测试 9（AC5/AC7 并锚） |
| 13 | create 于 idle：ALREADY_EXISTS 零 Persistence、零 Clock 读；窗口后恢复可创建 | §7 测试 10（AC5；ADR-0009:68） |
| 14 | idle-arm-failed：scheduler.setTimeout 同步 throw → release 仍 resolve undefined；observer exact cause；entry 停留 active | §2.B（handleLeaseReleased catch 分支派生） |
| 15 | close reject 全链：零 unhandled rejection；observer exact cause 恰一次；后续 open 全新 generation；再 create 同 key 成功 | §7 测试 11（AC7） |
| 16 | close 永挂起：open/create 等待属契约（等待而非崩溃）；零 unhandled rejection | §7 测试 12（AC7） |

### `packages/namespace-registry/test/registry-shutdown.test.ts`（10 用例）

| # | 用例名 | 对应 AC / 设计测试编号 |
|---|---|---|
| 17 | getStatus 三相投影（构造 running；同步段后 shutting-down；settle 后 stopped） | §7 测试 13（AC8） |
| 18 | shutdown 后 open(Proxy)/create(Proxy)：REGISTRY_NOT_ACCEPTING 且 trap 零执行、零 Persistence/Runtime | §7 测试 14（AC9） |
| 19 | 取消全部 idle timer：两 key 各武装 → shutdown → pending()===0 且无自发 close | §7 测试 15（AC9） |
| 20 | **15a. adversarial（R1/M5）**：取消后手动触发旧回调 → 恰单次 close、聚合恰一次、终态 stopped | §7 测试 15a（R1/M5） |
| 21 | 等待已接纳结算：open loadDoc 挂于 gate 时 shutdown 未 settle；放行后 open 完整成功 → 全部 close → resolve | §7 测试 16（AC9；ADR-0009:99） |
| 22 | 不等外部 release：entry 持未释放 lease 时 shutdown 照常关闭并 resolve；release 之后仍幂等 | §7 测试 17（AC9） |
| 23 | 复用在途 close：idle close 挂于 gate 时 shutdown → 同一 close Promise 结算一次、聚合收录其失败恰一次 | §7 测试 18（AC10） |
| 24 | **聚合错误形状（含 M4 专测）**：三 key、两个不同 cause → ShutdownError code/name/恒定 message/failures 冻结+顺序；第三 key 仍被尝试；status stopped | §7 测试 19（AC10；R1/M4） |
| 25 | 幂等 same-Promise：并发双调用与结算后重调用返回同一实例（resolve 与 reject 两相） | §7 测试 20（AC12） |
| 26 | shutdown 后 create/open 有效输入 → REGISTRY_NOT_ACCEPTING（零 Persistence、零 Runtime）；getStatus 恒可用 | §7 测试 21 |

### `packages/namespace-registry/test/registry-plugin.test.ts`（8 用例；真实 `new Context()` 组合）

| # | 用例名 | 对应 AC / 设计测试编号 |
|---|---|---|
| 27 | 组合：manualClockPlugin + createFakeTimerPlugin + createMemoryPersistencePlugin + createNamespaceRegistryPlugin → ctx.nomicoreRegistry 真实可用 | §7 测试 22（AC1） |
| 28 | 缺依赖 loud（直接 apply 通道）：clock/timer/nomicorePersistence 逐一剔除 → 稳定文案 throw + 零 service 提供 | §7 测试 23（AC3 通道 A） |
| 29 | config 校验矩阵：缺省 300_000（M3 值锚）；0/2147483647 接受；类型/数值域/键集二分 TypeError/RangeError 恒定文案 | §7 测试 24（AC2） |
| 30 | 有序 disposer：shutdown 完成前 fiber dispose 不 settle；探针次序 shutdownStarted → statusWhileDisposing → shutdownSettled → serviceRevoked | §7 测试 25（AC11；R1/M2） |
| 31 | 先于 Persistence dispose（fiber 级）：撤 persistence fiber → registry fiber 先卸载；shutdown 探针先于 persistence dispose settle；根级全拆无 unhandled | §7 测试 26（AC11） |
| 32 | close 失败的 dispose：reject release 的 persistence → plugin disposer 仍完成撤 service（finally 路径）；聚合 rejection 交 cordis，零 unhandled | §7 测试 27（AC11） |
| 33 | timer 经 ctx.timeout 真实桥：idle close 由 fake timer service 的 ctx.timeout 通道触发（advance 驱动；releaseCalls===1） | §7 测试 28（AC11） |
| 34 | **28a. 通道 B（ctx.plugin）依赖门**：缺依赖 → fiber PENDING（非 ACTIVE）、零 service、零 instance；补装 → ACTIVE + 就绪（双向） | §7 测试 28a（R1/M1） |

### 修改文件新增用例（1 条）

- `registry-create.test.ts`：duplicate 四源组新增「idle 态（#112 第五态）→ ALREADY_EXISTS 零 Persistence；完整窗口后恢复可创建」——ADR-0009:68 明文 idle 行（§7 测试 10 的 create 侧对应）。

### 修改文件断言迁移（既有断言语义零改动）

- `registry-open.test.ts`：732-749 占位块 → 「getStatus 三相 + shutdown resolve undefined + 零 Persistence」轻量回归锚（§2.K 点名替换；主断言在 registry-shutdown.test.ts）；1101 腿 → 仅锚 `shutdown resolve undefined` + `getStatus()==={state:'stopped'}` 两断言，**零 JSON.stringify 入 publicTexts**（R1/M4 精确化）。
- `registry-surface.test.ts`：主入口 export keys 3→9（含 DEFAULT_IDLE_TIMEOUT_MS=300_000 与 NOMICORE_REGISTRY_SERVICE='nomicoreRegistry' 常量值锚）；testing 子路径 1→2 导出；可达图期望含 plugin.d.ts；index.d.ts 断言 9 个 #112 名称在 + RegistryOperationUnavailableIssue 不在；**新增两道静态守卫**（cordis import 白名单 {plugin.ts}；host-global-timer 三正则扫全部 src/*.ts **含 testing.ts 零豁免**；均先正反样本表自证判别力再扫）。

---

## 2. 红灯清单（112 测试级失败 + 1 套件级收集失败；分类逐项）

实测（全量输出 `.mabf-bg/sa6-red.log`，退出码 1）：

```
Test Files  7 failed | 1 passed (8)
Tests       112 failed | 17 passed (129)
Type Errors  no errors
```

| 文件 | 结果 | 失败类别（精确） |
|---|---|---|
| `registry-idle.test.ts` | 16/16 红 | ① 构造门禁用例：**断言失败=行为未实现**（基线无 scheduler 门禁，`expected undefined to be an instance of TypeError`）；② 其余 15 例：**import/API 未实现**——`createRegistryTestScheduler` 未从 testing 子路径导出，Vite 解析为 `undefined`，工厂参数 `scheduler: undefined` → 构造/运行期失败（测试首锚前置即失败） |
| `registry-open.test.ts` | 32/32 红 | **import/API 未实现**（`createRegistryTestScheduler` 未导出 → 工厂调用点 TypeError）；占位断言替换处同样（shutdown 真实行为未实现） |
| `registry-create.test.ts` | 48/50 红 | 同上（47 工厂 + 4 fixture 的 scheduler 传导）；新增 idle 行断言失败=scheduler 未实现（`scheduler.pending` 不可用）；**2 例绿 = 既有 Clock 构造门禁用例（未触及，语义零改动，基线即绿——既知非新功能锚）** |
| `registry-node-dispose.test.ts` | 2/2 红 | import/API 未实现（scheduler 传导） |
| `registry-shutdown.test.ts` | 10/10 红 | import/API 未实现 + shutdown 真实行为未实现（resolve undefined/reject ShutdownError 断言失败） |
| `registry-surface.test.ts` | 4/12 红 | **断言失败=行为/导出面未实现**：主入口 9 值（现 3）、testing 2 值（现 1）、index.d.ts 缺 #112 名称、可达图缺 plugin.d.ts；其余 8 例绿（见「意外绿」节） |
| `registry-plugin.test.ts` | **套件级收集失败**（8 用例全部红） | **import 失败=API 未实现**：`Error: Cannot find package '@deepseek-ai/cordis'`（packages/namespace-registry 依赖清单未含 cordis——属 SA3 ALLOW LIST 内 package.json 增量）+ 主入口未导出 plugin 工厂（同一收集失败面） |

**失败类别汇总**：import 失败=API 未实现（plugin 套件 8 例 + 迁移文件的 `createRegistryTestScheduler` 传导 ~93 例）；构造期门禁缺失=断言失败（idle 门禁用例 1 例 + create 新增 idle 行）；行为未实现=断言失败（shutdown 真实语义、surface 导出面、index.d.ts、可达图）。

## 3. 意外绿 = 0 确认

**17 例通过均为「非验收锚点」**，逐项说明为何可以绿（零意外）：

1. `registry-entry-removal-guard.test.ts`（7 例）——**未触碰文件**（ALLOW LIST 明确零改动；removeOnlySelf 纯单元）；#112 不改变其语义（§2.K「保留守卫与红灯不动」）。
2. `registry-create.test.ts` Clock 构造门禁 2 例——**未触碰配置调用**（`c.options as never` 是敌意输入本体，不可注入 scheduler）；按 §8 R2「纯追加字段、既有断言零改动」保留原断言。
3. `registry-surface.test.ts` 8 例——package.json exports（不变项）、testing 入口声明审计（受控内部 import，不变项）、**cordis import 白名单守卫与 host-global-timer 守卫**（设计 §2.M 静态守卫：基线 src 零 cordis、零裸 timer → 守护型绿锚，**并非行为验收红灯**；其正反样本自证判别力后先扫，当前零违例即事实，SA3 实现 plugin.ts 后守卫继续守护 = 双向阀门）、模块边界活链路 3 例（internal subpath 仅 registry.ts 消费者——#112 新增 plugin.ts 不消费 internal，不变项）、根 typecheck 链（不变项）。

> 结论：**验收红灯无任何意外绿**。设计 §7 的 AC1-AC12 全部 28+3a/15a/28a 锚点在基线全部为红，无一通过。

## 4. 迁移触点计数与既有断言零改动声明

| 文件 | 实际触点 | 说明 |
|---|---|---|
| `registry-open.test.ts` | **32 处方工厂调用**补 `scheduler: createRegistryTestScheduler()` | 设计口径「33」含 helper def 的重复计数（`grep -o manualClock()` = 32 调用 + 1 定义）；2 处占位断言按 §2.K 点名替换 |
| `registry-create.test.ts` | **47 处方工厂调用 + 4 处 createRegistryInternal fixture**（1 处 internalOptions 字面量 + 3 处内部 options 字面量） | 与设计 R2/m4 口径一致；另增 1 条 idle duplicate 行 |
| `registry-node-dispose.test.ts` | **1 处方工厂调用** | 设计口径「2」含 helper def 重复计数 |
| `registry-surface.test.ts` | 导出面/守卫/可达图改写（#112 清单全部落点）；无工厂调用需迁移 | 设计口径「3」为字符串引用（禁词表、子路径断言），非调用 |

合计：**80 处工厂调用 + 4 处 internal fixture**（设计「85」口径 = 82 真实调用 + 3 处 surface 字符串引用；差异源于重复计数，已逐项核实无遗漏）。

**既有断言零改动声明**：除 §2.K 点名列出的 registry-open.test.ts 两处（732-749 占位块、1101 shutdown 腿）与 surface 导出面口径外，**全部既有断言文本与语义零改动**——迁移只做 `scheduler` 字段追加（新增键、零删改）；registry-create.test.ts 的 HIGH-1/R2-M1 三变体与 closing fail-closed fixture 断言（含 `lifecycleTail` 字段）**逐字未动**；registry-open.test.ts 的 33→32 处调用点仅追加键。§2.K「既有『lease 全释放后临时保留态』从 active-零lease 语义变 idle 语义、断言同码保持绿」由既有断言原样承担（零改动成立）。

**对既有两处既有断言语义变化的说明**（§2.K 点名授权，非擅自改动）：732-749（占位 #`NAMESPACE_OPERATION_UNAVAILABLE` 断言删除 → 真实三相 + resolve undefined）与 1101（stringify 入负锁循环删除 → M4 边界两断言）。

## 5. 给 SA3 的实现指引要点（测试期望的精确行为锚点清单）

### 核心 seam（§2.A/§2.J）

1. `NamespaceRegistryTestingOverrides.scheduler` **必需**：缺失/null/非 object/`setTimeout` 或 `clearTimeout` 非函数 → 构造期同步 `TypeError`，message **逐字** `NAMESPACE_REGISTRY_SCHEDULER_REQUIRED: Registry 必须提供可调用的 setTimeout/clearTimeout 调度能力`（零回显传入值）。
2. **⚠️ 门禁顺序裁决（测试侧已隐含）**：scheduler 门禁必须排在 **clock 门禁之后**——registry-create.test.ts 既有构造门禁用例以 `{ clock: {} }` 断言 CLOCK message；若 scheduler 门禁先行，`{ clock: {} }` 会改抛 SCHEDULER 文案，既有断言红（违反「既有断言零改动」）。实现时保持 clock → scheduler 检查顺序。
3. `createRegistryTestScheduler(): { setTimeout; clearTimeout; advanceBy(ms): Promise<void>; pending(): number }`——到期序触发 + 3 层微任务展开（persistence `createTestScheduler` 蓝本）；`pending()` 即时返回计面。
4. `idleTimeoutMs` 校验单点 `resolveIdleTimeoutMs`（registry.ts 导出）：`undefined`→300_000；非 number→TypeError `NAMESPACE_REGISTRY_IDLE_TIMEOUT_TYPE: idleTimeoutMs 必须是 number（0..2147483647 有限整数）`；非整数/负/超 2_147_483_647→RangeError `NAMESPACE_REGISTRY_IDLE_TIMEOUT_RANGE: idleTimeoutMs 必须是 0..2147483647 的有限整数`；`DEFAULT_IDLE_TIMEOUT_MS = 300_000` （仅 registry.ts 断言点，plugin/index 纯 re-export——surface 断言 9 键含该常量且值===300_000）。

### idle 状态机（§2.B/§2.C/§2.I）——按我测试的精确断言

5. 最后 lease release 的**同步段**内：observer `entry-idle` 恰一次（identity 含 owner/namespaceId/key、generation bigint）、fake `pending()===1`、runtime `close()` 零调用；release same-Promise（二次 release 与 asyncDispose 同一实例）。
6. `advanceBy(299_999)` 不 close；`advanceBy(1)` close 恰一次→entry 移除→再 open 走**全新 loadDoc + 全新 Runtime**（marker 断言 `R2`）、loadCalls===2。
7. 重进 idle=**全新完整窗口**（450_000 总时长不起作用：150_000+激活+299_999 不 close，再 1 才 close）。
8. **I4 arm-token**：adversarial scheduler（clearTimeout no-op、自记回调、可手动 fire）下——release 武装 T1 → open 激活 → release 重武装 T2 → 手动 fire T1 → closeCalls===0、零 `idle-close-failed`、entry 仍活（create→`ALREADY_EXISTS` 零 Persistence）、T2 仍存活（armed 计面）→ fire T2 → close 恰一次。**回调首查 `entry.idleTimerHandle !== handle` 失配即 return**（先于任何副作用）。
9. `idleTimeoutMs: 0`：release 后（含微任务排空）close 零调用（`pending()===1`）；`advanceBy(0)` 才 close。
10. fatal/degraded Runtime 零特判：release→idle→advance→close 照常。
11. idle 期 open：`pending()===0`（同步取消）、复用同一 Runtime（marker/`getMetadata`）、loadCalls 不变、新 lease 对象。
12. closing-wait：open 槽 `await current.closePromise`（不 loadDoc、不结算）；settle 后 recheck undefined → 全新 generation；**close reject：open 吞掉并继续**（§2.B 裁决；loadCalls===2、新 marker）；observer `idle-close-failed` **exact cause 恰一次**。
13. create 于 idle → `ALREADY_EXISTS`（**在 payload/Clock 之前**：零 createCalls、零 loadCalls、clock.calls 不变）；窗口满后无残留（create 恢复）。
14. `arm-failed`：`scheduler.setTimeout` throw → release 仍 resolve undefined、observer `idle-arm-failed` exact cause 恰一次、close 零调用、entry 停留 active（open 零 loadDoc 复用）。
15. close reject 全链：`closePromise.then(两臂)` 派生恒 resolve（零 unhandled rejection——`process.on('unhandledRejection')` 探针 + setImmediate 展开后断言空）；后续 open 全新 generation；**同 key create 成功**（代际局部清理）。
16. close 永挂起：create 等待（flush 30 层 + setImmediate 后仍 `pending`——契约等待不崩溃），零 unhandled。

### shutdown（§2.D/§2.E/§2.H/§2.K）

17. 首次 `shutdown()` **同步段**翻 `acceptance='shutting-down'`（返回前 getStatus 可观测）；全体 close 聚合 settle 后、交付前翻 `'stopped'`；终态不再迁移。
18. 停接纳在**公共入口同步段、先于一切输入访问**：shutdown 后 open(Proxy owner)/create(Proxy input) → `REGISTRY_NOT_ACCEPTING` 且 trap 计数 0、零 Persistence/Runtime。
19. idle timer 取消：两 key 各武装 → shutdown 同步段 `pending()===0`、同步段零 close；close 仅来自 shutdown（每 key 恰一次）；advanceBy 完整窗口不追加。
20. **15a**：adversarial 下 fire 旧回调（shutdown 同步段后、异步段前——豁免窗口）→ closeCalls 保持 0（失配 no-op）→ 最终恰 1 次 close（仅 shutdown 步骤 2）、聚合 failures.length===1（不重复）、零 observer `idle-close-failed`（§2.I shutdown 不加事件）、终态 stopped。
21. 已接纳槽完整结算：loadDoc 挂 gate 时 shutdown 未 settle；放行后 open **成功签 lease**（绝非 NOT_ACCEPTING）；在途槽新建 entry 进 shutdown 关闭全集（closeCalls===1）；shutdown resolve undefined。
22. 不等外部 release：持未 release lease 的 entry 照常关闭（closeCalls===1）、resolve undefined；此后 release 仍幂等 same-Promise。
23. 复用在途 close：idle close 挂 gate → shutdown 复用同一 Promise（closeCalls===1）；reject 时聚合恰一次 exact cause、observer `idle-close-failed` 恰一次（双通道）。
24. **聚合错误**：`NamespaceRegistryShutdownError`——`name==='NamespaceRegistryShutdownError'`、`code==='NAMESPACE_REGISTRY_SHUTDOWN_FAILED'`、**message 恒定常量** `NAMESPACE_REGISTRY_SHUTDOWN_FAILED: Registry shutdown 期间部分 Runtime 关闭失败`（零插值；message 不含 cause 文本/identity——R1/M4 零回显专测）；failures Object.freeze（数组与逐元素）、顺序=entries Map 插入序（k1,k2）、逐项 `{owner:{userId}, namespaceId, cause: exact}`（结构化字段与 cause 是 message 级纪律的显式边界，不进负锁循环）；**不因首败跳过其余**（k3 closeCalls===1）；status 仍 stopped。
25. **same-Promise 幂等**：并发双调用与结算后重调用（含已 reject 实例）返回 exact same Promise。
26. shutdown 后 create/open → NOT_ACCEPTING 零副作用；getStatus 恒可用。

### plugin（§2.F/§2.G/§5）

27. **主入口导出 9 值**（surface 精确清单）：`DEFAULT_IDLE_TIMEOUT_MS`(300_000)、`NOMICORE_REGISTRY_SERVICE`('nomicoreRegistry')、`NamespaceLeaseReleasedError`、`NamespaceRegistryFatalError`、`NamespaceRegistryShutdownError`、`createNamespaceRegistry`、`createNamespaceRegistryPlugin`、`provideNomicoreRegistry`、`requireNomicoreRegistry`；testing 子路径 2 值。
28. `createNamespaceRegistryPlugin(config?)`：工厂**调用期**同步校验（无 ctx）——`{idleTimeoutMs:-1|1.5|NaN|2147483648}`→RangeError、`'300000'`→TypeError、`{foo:1}`→TypeError（文案见上）；`{idleTimeoutMs:0|2147483647}`接受；缺省 plugin 对象可构造。
29. `assertNamespaceRegistryHostDependencies(ctx)`：检查顺序 **clock → timer → nomicorePersistence**，文案逐字（clock: `'required Cordis service "clock" is unavailable'`；timer: `'required Cordis service "timer" is unavailable: install @deepseek-ai/cordis-plugin-timer before the namespace-registry plugin'`；persistence 沿用 `'required Cordis service "nomicorePersistence" is unavailable'`）；apply 栈内同步 throw、零 service 提供、`instance===undefined`。**必须提供 `inject: ['clock','timer','nomicorePersistence']`**（28a PENDING 门）。
30. **有序 disposer（generator effect）**：`yield revokeService` 先、`yield async () => { try { await registry.shutdown() } finally { revokeService?.() } }` 后——逆序串行保证 shutdown 完成前 fiber dispose 不 settle（测试 25 判别核心：gate 卡 close 时 `disposalSettled===false`）、完成后撤 service。测试 25 已注记实测事实：cordis `_unload` 期间服务在首个微任务即不可观测（fiber store 清理语义），故「serviceRevoked」探针以 `await disposal` 后首个稳定 undefined 为准——**不要依赖「shutdown 进行中 ctx.get 仍可见」做探针**（那是 cordis 卸载机制，非 disposer 次序）。
31. **fiber 级先序（测试 26）**：`ctx.plugin(memory)` + `ctx.plugin(registryPlugin)` 组合下 `await memoryFiber.dispose()` → 探针序 `['registry-shutdown-settled','persistence-fiber-dispose-settled']`、nomicoreRegistry/nomicorePersistence 均撤销、instance undefined、**registry fiber state===0（FiberState.PENDING——依赖消失触发 `_setEpoch(INACTIVE)→_unload`，卸载后 uid 非 null → PENDING、可重载（§2.F R5）；DISPOSED=4 仅显式 `fiber.dispose()` 到达——R-fix 修订）**；根级 `ctx.fiber.dispose()` 全拆零 unhandled rejection。
32. **28a 双向门**：`ctx.plugin(createNamespaceRegistryPlugin())` 缺依赖 → `await fiber` 后 `fiber.state===0`（FiberState.PENDING）、`ctx.get('nomicoreRegistry')===undefined`、`plugin.instance===undefined`；补 clock+timer 仍 PENDING；再补 nomicorePersistence → state===2（ACTIVE）、service/instance 就绪、`requireNomicoreRegistry(ctx)` 可读。
33. `createCordisRegistryScheduler(ctx)`：`clearTimeout(handle) === handle()`（幂等 disposer 桥）；timer 走 `ctx.timeout`（测试 28：真实组合 + fake timer 下 advanceBy 驱动 idle close、`handle.releaseCalls===1`）。
34. `registry-open.test.ts` 1101 腿与 `registry-shutdown.test.ts` 24 号的纪律边界：**1101 只做两断言（resolve undefined + status stopped），零 stringify**；shutdown 零回显由 24 号的 message 恒定常量断言承载。
35. **模块边界**：plugin.ts 是唯一 cordis 消费者（守卫扫 src 全量）、全部 src（含 testing.ts）零裸 `setTimeout(`/`setInterval(`/`clearTimeout(`/`Date.now(`（属性签名位/桥接箭头位合法——正反样本表已自证）；plugin.ts 经 `./registry.js` 相对通道导入、index 沿 plugin 链 re-export `DEFAULT_IDLE_TIMEOUT_MS`（零第二定义点）；`RegistryOperationUnavailableIssue`/`NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE`/`SHUTDOWN_UNAVAILABLE` 删除（surface 断言 index.d.ts 不含 + 主入口 9 键无它）。

---

## 6. 附注（SA6 执行中的实测发现，供 SA4/SA7 参考）

- **cordis 4.0.1 实测**（node:24，仅用于测试设计校验，非源码修改）：① `ctx.plugin` 子 fiber 的 `inject` PENDING→ACTIVE 双向、`fiber.dispose()` 后服务撤销、generator `yield` 的 keep-alive 次序（shutdown 先、revoke 后）与设计 §5#3/#4 一致；② fiber `_unload` 期间服务在首微任务即不可观测（见要点 30 注记——设计 §7.25 原「serviceRevoked 以 ctx.get 首个 undefined 时刻为准」在 cordis 卸载语义下会提前观测；本报告按可判别锚点重写 25 号，判别力保留）。
- 红线执行过程中未修改任何 src/、package.json、tsconfig；`git status` 预期改动 = 3 新测试文件 + 4 修改测试文件 + 本报告。

---

## 7. R-fix 修订轮（总控逐项裁决：4 项争议全部判为测试侧缺陷，SA3 实现零偏离）

**裁决背景**：SA3 实现落地后（src/plugin.ts 等 8 文件 + package.json +2 依赖），总控逐项复核 4 项争议（1 盏 idle 无残留断言 + 3 盏 plugin 探针/类型噪声），全部判为**测试侧缺陷**。本修订只改 test/（3 处新文件内容），零 src 改动。修订后验证（后台独立进程）：

```
pnpm exec vitest run packages/namespace-registry --typecheck
  Test Files  8 passed (8)
  Tests       137 passed (137)   ← 含 3 盏争议灯转绿；Type Errors no errors
pnpm test（全仓）
  <结果见下>
```

### 7.1 修订 1 — registry-idle.test.ts 测试 11 尾段（AC7 跨 generation 零残留）

- **缺陷**：`await lease2.release()` 后注释「entry 已清」+ `create → ok:true` 与 #112 AC4 语义矛盾——release 后 entry 进入 **idle 武装**（窗口未推进时 entry 存活；本文件测试 10 与 registry-create.test.ts idle 行即此语义），create 必须 `ALREADY_EXISTS`。
- **修复**：release 后先断言 idle 已武装（`scheduler.pending()===1`）+ create → `ALREADY_EXISTS` 零 Persistence（显式锚该语义）；再 `advanceBy(300_000)` + 微任务排空（沿用本文件测试 10 的清理模式）→ R2 代际 idle close 结算（`runtimes[1].closeCalls===1`）→ entry 移除 → create → `ok:true` 且 `createCalls===1`——**「跨 generation 零残留」断言意图保留**（complete window settle 后才恢复创建）。

### 7.2 修订 2 — registry-plugin.test.ts 测试 26 尾段（fiber state 判别）

- **缺陷**：`expect(registryFiber.state).toBe(4)`（DISPOSED）与 cordis 4.0.1 `_getState()`（lib/index.js）语义矛盾——`uid===null` 才为 4（仅显式 `fiber.dispose()` 到达）；依赖消失触发的是 `_setEpoch(INACTIVE) → _unload`，卸载后 uid 非 null → `state===0`（**PENDING、可重载**——设计 §2.F R5 reload 语义正依赖此态）。
- **修复**：断言改为 `expect(registryFiber.state).toBe(0)`，注释补全 `_getState` 语义（PENDING=非 ACTIVE、非 DISPOSED；DISPOSED=4 仅显式 fiber.dispose()）。

### 7.3 修订 3 — registry-plugin.test.ts 测试 27（聚合 cause 身份）

- **缺陷**：`expect(err.failures[0]?.cause).toBe(releaseCause)` 与真实 runtime close 语义矛盾——namespace-runtime/src/close.ts:54：release reject 被包装为 `NamespaceRuntimeCloseError`（稳定 `code='NSRT-CLOSE-RELEASE-FAILED'`、恒定 message、`.cause` 保留原始 release 异常）；聚合 exact cause = 该包装错误（设计 §2.C 明文「通常为 NamespaceRuntimeCloseError，cause 链保留原始 release 异常」）。该类不经 @nomicore/namespace-runtime 主入口导出（包内类），不得 import。
- **修复**：改为 `cause` 链判别——`failureCause instanceof Error` + `code==='NSRT-CLOSE-RELEASE-FAILED'` + `failureCause.cause === releaseCause`（exact 原始异常保留在包装链上）。
- **边界确认**：registry-shutdown.test.ts 测试 18/23（复用在途 close、聚合错误形状）走 `runtimeFactory` stub 路径、close rejection 不经过真实 barrier（ObservableRuntime.close 直接返回 reject）——不受本修订影响，**未改动**（总控点名确认）。

### 7.4 修订 4 — registry-plugin.test.ts（TS18048 收窄噪声）

- **缺陷**：cordis `Context.get<K>(name)` 返回 `undefined | this[K]`，`expect(registry).toBeDefined()` 不产生 TS 收窄；全量 checker（tsconfig.typecheck.json 含全部 test/**）报 3 个 TS18048（测试 22 的 `registry.open/create/getStatus` 三处使用），CI 命中面。
- **修复**：测试 22 改用公开 require 通道 `const registry = requireNomicoreRegistry(ctx)`（缺失即 throw——组合上下文服务必在；返回类型 `NamespaceRegistry` 非 undefined），176/179/188 三处使用点一并消除；断言语义保留（`toBe(plugin.instance)`、require 通道可读、9 键常量锚不变）。`npx tsc -p tsconfig.typecheck.json --noEmit` 复核：**TS18048 = 0**。

### 7.5 验证结果

- `pnpm exec vitest run packages/namespace-registry --typecheck`：**8 文件全绿、137/137 用例通过、Type Errors 0**（3 盏争议灯：idle 测试 11 尾段、plugin 测试 26 state、plugin 测试 27 cause 全部转绿；套件级收集失败消除——plugin.ts 8 用例并入 137）。
- 全量 `pnpm test`（后台独立进程，`.mabf-bg/sa6-full-test.log`）：**Test Files 113 passed (113)；Tests 1378 passed (1378)；Type Errors no errors；退出码 0**——全仓绿、TS18048 清零（checker 含全部 test/**）。
