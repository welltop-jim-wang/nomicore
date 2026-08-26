# task_namespace-registry-create — SA6 红灯清单与证据（issue #111）

> 角色：SA6（Red Test Writer）· worktree `/home/wangjian/nomicore-fix-issue-111` ·
> branch `fix/issue-111-on-docs-namespace-registry` · 冻结设计 R3 PASS。
> 本档案是红灯的事实记录与 SA3 实现指引；所有「红」均为**断言失败**（resolve 占位 vs
> 期望结果、未 reject vs 期望 fatal、未 throw vs 期望构造 TypeError、计数 0 vs 期望 N），
> 无框架超时、无 real sleep、无源码 grep 伪测试。

## 1. 红门命令与总结果

```
cd /home/wangjian/nomicore-fix-issue-111
setsid nohup npx vitest run packages/namespace-registry packages/doc-runtime; echo $? > exit-file
```

- 结果（2026-08-26 基线 cdcf28b）：**Test Files 4 failed | 23 passed (27)；Tests 56 failed | 354 passed (410)；exit 1；Duration 8.4s**。
- 4 个失败文件全部是本次新增/扩展的测试文件（无一既有文件被迁移编辑转红）：
  - `packages/namespace-registry/test/registry-create.test.ts` — 43/43 红（新建）
  - `packages/doc-runtime/test/create-initial-document.test.ts` — 9/9 红（新建）
  - `packages/namespace-registry/test/registry-surface.test.ts` — 2 个新断言红、8 个既有断言绿（扩展）
  - `packages/doc-runtime/test/doc-runtime-surface.test.ts` — 2/2 红（新建）
- 迁移验证：`registry-open.test.ts` 32/32 绿、`registry-node-dispose.test.ts` 2/2 绿、
  `registry-entry-removal-guard.test.ts` 7/7 绿、doc-runtime 其余 20 个文件全绿。
- typecheck 侧：`tsc -p packages/doc-runtime` 与 `tsc -p packages/namespace-registry` 均
  exit 0（doc-runtime tsconfig 含 test/**，本 SA 新测试文件零类型错误）。
- vitest --typecheck 的中间态噪音（89 条 TypeCheckError，不影响测试结果）只在两类，
  实现后全部消失（见 §5）。

## 2. 红灯清单（新用例逐灯：锚点 → 基线失败形态）

### 2.1 registry-create.test.ts（43 灯；全部红）

| # | 用例（describe > it） | 基线失败形态（vitest 实际输出摘要） |
|---|---|---|
| 1 | 成功全链 > 默认工厂全链 | `create 应成功，实际：{"ok":false,"code":"NAMESPACE_OPERATION_UNAVAILABLE",...}: expected false to be true` |
| 2 | 成功全链 > lease.getStatus() preparing→ready 轨迹 | 同上（`okLease` 断言） |
| 3 | 成功全链 > runtimeFactory seam 形状 | 同上 |
| 4 | snapshot > 排队期间突变生效 | `expected {code:'NAMESPACE_CREATE_FAILED'} to match {code:'NAMESPACE_OPERATION_UNAVAILABLE'}`（占位码不符） |
| 5 | snapshot > slot 后突变无效 | `okLease` 断言失败（占位 resolve） |
| 6 | snapshot > owner 冻结 | `expected +0 to be 1`（createDoc 未达/hold 计数不符） |
| 7 | hostile > 顶层 ownKeys trap | `expected {ok:false,…} to match {ok:false,code:'NAMESPACE_CREATE_INVALID_INPUT'}` |
| 8 | hostile > top-level desc trap | 同上（期望 NAMESPACE_CREATE_INVALID_INPUT——input 自身 descriptor 元操作在槽内快照发生） |
| 9 | hostile > owner Proxy trap | 同上 |
| 10 | hostile > payload 变体 12 例 | 每例 `toMatchObject {code:'NAMESPACE_CREATE_INVALID_INPUT'}` 失败（占位码） |
| 11-12 | identity invalid > 表 / 先短路 | `toMatchObject {code:'NAMESPACE_INVALID_IDENTITY'}` 失败（占位码） |
| 13 | domain > schema compile verbatim | 期望 `NAMESPACE_SCHEMA_INVALID` + issues 深等；实际占位码不符 |
| 14 | domain > ROOT validate verbatim | 同上（NAMESPACE_ROOT_INVALID） |
| 15 | domain > green tail | `okLease` 失败 |
| 16 | domain > message 恒定表 | 五条 message 断言全不符（占位 message） |
| 17 | 负锁 > sentinel | 断言中 `ok`/code/message 均不符（占位码本身正确但断言链前置失败） |
| 18-20 | duplicate > active / lease-zero / 并发 FIFO | 期望 ALREADY_EXISTS；实际占位；FIFO 用例另有 `expected...` 计数不符 |
| 21 | duplicate > persisted | `toMatchObject {code:'NAMESPACE_ALREADY_EXISTS'}` 失败 |
| 22 | persistence > operational + observer | `toMatchObject {code:'NAMESPACE_CREATE_FAILED'}` 失败 |
| 23 | persistence > fatal false | `rejects.toMatchObject {...}` 失败（占位 resolve，未 reject） |
| 24 | persistence > fatal true | 同上（未 reject） |
| 25 | persistence > unknown false | 同上（未 reject） |
| 26 | persistence > observer 隔离 | 未 reject/未窄化失败 |
| 27 | persistence > tail 继续 | okLease 失败 |
| 28 | Clock > 生产门禁 4 变体 | 未 throw 同步 TypeError（`thrown` undefined ≠ TypeError） |
| 29 | Clock > testing 门禁 3 变体 | 同上 |
| 30 | Clock > now() throw fatal | `rejects toMatchObject {phase:'create-document-internal'}` 失败（占位 resolve） |
| 31 | Clock > NaN/Infinity/超界 | 同上 ×5 |
| 32 | Clock > ±8.64e15 边界 | okLease 失败 |
| 33 | Clock > 恰读一次 counter | `expected +0 to be 1`→ 后续 multi 断言失败 |
| 34 | post-commit > resolved→factory throw | `rejects toMatchObject {phase:'runtime-construction',committed:true}` 失败（未 reject） |
| 35 | post-commit > release reject 注入 | 未 reject + releaseCalls/事件断言失败 |
| 36 | post-commit > never-settle | settled 状态断言 `expected 'pending'... not toBe 'pending'` 失败——注意：占位 resolve 使
  `settled='resolved'`，仍为明确断言失败（非超时） |
| 37-40 | ordering > create→open / open→create / gate 排队 / tail | 期望 createDoc/open 计数与码，实际占位 |
| 41 | ordering > hostile slot 后 open | 码不符 |
| 42 | closing fail-closed（any-bridge fixture） | `rejects toMatchObject {phase:'lifecycle-slot-internal',committed:false}` 失败（占位 resolve） |
| 43 | seam 注入 > input-invalid fatal | 同上（未 reject） |

### 2.2 create-initial-document.test.ts（9 灯；全部红）

| # | 用例 | 基线失败形态 |
|---|---|---|
| 1 | 公共入口存在且为函数 | `expected false to be true`（hasOwnProperty） |
| 2 | 畸形 envelope → input-invalid | `expected undefined to be type of 'function'` |
| 3 | 畸形 META → input-invalid | `fn is not a function`（TypeError） |
| 4 | 手造 derived → pre-commit-internal false fatal | `expected TypeError: fn is not a function to be an instance of DocRuntimeFatalError` |
| 5 | ROOT validate verbatim | `fn is not a function` |
| 6 | 成功面（单事务/空置/内容/读回） | `fn is not a function` |
| 7-9 | observer 篡改 SCHEMA/META/ROOT → committed:true fatal | `expected TypeError: fn is not a function to be an instance of DocRuntimeFatalError` ×3 |

### 2.3 surface 扩展（registry-surface.test.ts 2 灯；doc-runtime-surface.test.ts 2 灯）

| 文件 | 用例 | 基线失败形态 |
|---|---|---|
| registry-surface | index.d.ts 新增 trio 导出/移除占位别名 | `expected ... to contain 'CreateNamespaceInput'` |
| registry-surface | testing.d.ts 含 clock/createDocumentFactory | `expected ... to contain 'clock:'` |
| doc-runtime-surface | createInitialDocument 值导出 | `expected false to be true` |
| doc-runtime-surface | d.ts 正向 fixture（createInitialDocument + 合法 Y.Doc） | `expected ... to contain 'createInitialDocument'` |

## 3. 意外绿登记

**无。** 新用例 56 灯全红；无任何新用例在基线转绿。（占位实现恰好满足的「意外绿」不存在；
若未来发现，红线说明见 §6「锚定强度」。）

## 4. 迁移点计数（设计 §14 全量表落地）

| 文件 | 迁移 | 计数 |
|---|---|---|
| registry-open.test.ts | 全部 `createNamespaceRegistryForTesting(...)` 调用注入 `clock: manualClock()` | 32/32 |
| registry-open.test.ts | create 占位断言（NAMESPACE_OPERATION_UNAVAILABLE create + evil input 零访问）删除，
  迁往 registry-create.test.ts 真实行为；shutdown 占位断言保持不动 | 1 处 |
| registry-open.test.ts | 零回显测试的 create 调用保留（实现后 resolve NAMESPACE_INVALID_IDENTITY 恒定
  message，零回显契约不变——已在用例注释标记） | 0（保留） |
| registry-node-dispose.test.ts | 唯一 factory 调用注入 manual clock helper | 1/1 |
| registry-surface.test.ts | 新增 index.d.ts 导出增量断言 + testing.d.ts clock/createDocumentFactory 断言 | 2 断言 |
| registry-seam-audit.ts | **零改动**（与上游逐字副本纪律）：§8 边界由既有「仅 registry.ts 消费 internal
  subpath」断言覆盖，create-document.ts 若消费 internal 会被现有断言抓红 | 0 |
| 全仓 caller 审计 | `git grep createNamespaceRegistryForTesting(` 除本 SA 三个测试文件与 src/testing.ts
  定义外无其它调用点（无生产实例化调用） | — |

## 5. vitest --typecheck 中间态噪音（实现后自动消失，非测试问题）

基线的 `pnpm test`（vitest --typecheck）对全仓测试文件做整程序类型检查，当前报 89 条
TypeCheckError，全部源于**冻结设计声明的契约中间态**（SA3 实现即消失）：
1. `'clock' does not exist in type 'NamespaceRegistryTestingOverrides'`（73 条，open 测试迁移注入 + create 测试）；
2. `RegistryObserverEvent` 联合尚无 create 事件（16 条，`'create-persist-failed'` /
   `'create-runtime-construction-failed'` / `operation:'create'` 判别，create 测试的 observer 断言）。

这些不影响 vitest 测试结果与 exit code 语义（56 失败 = 断言失败）。实现后两者随 §8 契约落地清零。

## 6. SA3 必须特别注意的红灯形态

1. **【唯一新增内部 seam】closing fail-closed fixture（registry-create.test.ts「closing fail-closed」）**
   —— 设计 §9 要求「testing seam 置 phase:'closing' 且 closePromise:undefined」，但冻结 §8
   测试 seam（clock/createDocumentFactory）**没有 entry 注入面**；R2-M1 冲突报告与 R3 审核
   均依赖「testing-only entry hook」。本测试按任务授权以 any-bridge 内部 fixture 表达：
   **SA3 必须在 `createRegistryInternal` 的内部 options 支持 `testEntries?: ReadonlyMap<string, EntryShape>`
   （该 key 在槽开始时经 entries.get(key) 命中 phase:'closing'），且 `closePromise===undefined`
   时：observer `lifecycle-slot-failed(create)` + reject `NamespaceRegistryFatalError('create',
   'lifecycle-slot-internal', false)`，发生在任何 payload/Clock/Persistence 访问之前。**
   `testing.ts` 公共子路径**不**导出该 hook（入口导出面保持 createNamespaceRegistryForTesting 单键）；
   若 SA3 以其它形式提供等价注入（如内部 options 的不同键名），请保持测试语义等价并可读，
   本测试通过 `as never` 传内部 options，键名以测试内常量 `testEntries` 为准。
2. **单事务/空置/篡改观测手法**：测试用 `Y.Doc.prototype.getMap` 包装器在首次探针时注册
   afterTransaction（计数/tamper）——依赖设计 §6「三者以 getMap 惰性取得」的冻结机制。
   SA3 实现**必须**在安装事务前经 `doc.getMap('SCHEMA'/'META'/'ROOT')` 探针（fresh map
   size===0 断言 + afterTransaction 计数恰 1 即从此锚定）；observer 篡改必须导致
   `DocRuntimeFatalError('post-commit-verification', true)`（写后核验保留）。
3. **成功链默认工厂**：成功全链第 1 灯走**默认内部工厂**（真实 createNamespaceRuntimeForRegistry）
   ——`lease.read(['n'])===42`、`getMetadata().createdAt`、P0 结算后 schema.state='ready'。
   该灯同时锚定「factory 走普通 P0 seam」；不要用 stub runtime 顶替。
4. **Clock 门禁必须构造期同步 throw**：`createNamespaceRegistry(persistence, ...)` 与 testing
   工厂在 omitted/null/non-object/now 非函数时同步 `TypeError('NAMESPACE_REGISTRY_CLOCK_REQUIRED:
   Registry 必须提供可调用的 Clock.now')`；本测试 4+3 变体逐字断言。
5. **doc-runtime `createInitialDocument` 命名空间**：doc-runtime 主入口新增该值与 input-invalid/
   root-invalid 结果联合（§6 冻结签名，含 `kind` 判别）；`input-invalid` 单 issue path=[]；
   手造 derived → `pre-commit-internal,false` fatal；root-invalid issues 与
   `validateLogicalSnapshot` 直接输出深等。doc-runtime 的 tsconfig 含 test/**，测试文件
   any-bridge 取用（实现后无需改动）。
6. **duplicate/Clock/observer 计数类断言**（FIFO 后手零 createDocument、payload 失败不读
   Clock、duplicate 不读 Clock、lifecycle-slot-failed 只发 fatal 路径）：全部以可观测计数
   锚定，实现需按 §5 伪码次序（entry → payload → clock → createDocument → persistence）。
7. **registry-open.test.ts 已迁移**（32 处 clock 注入 + create 占位断言移除）：SA3 不得回退；
   若实现后 open 用例转红，优先检查 Clock 是否在 testing 工厂被强制读取。

---

# 修订轮 R-fix（SA3 交付后，总控逐项亲核：5 盏残留灯均为测试侧缺陷；另 2 项总控裁决配套）

## R-fix 一：五盏缺陷灯修复（实现无缺陷）

| # | 灯 | 缺陷根因 | 修法（落点 = registry-create.test.ts） | 修订后状态 |
|---|---|---|---|---|
| 1 | identity 表 case 0 | `makeCreateInput` 的 `overrides.owner ?? {userId:'u-alice'}` 吞掉显式 `owner:null` → 表面 identity 合法，create 走到了成功路径 | case 0 直构 `{owner:null,...}`；badCases 成员类型放宽为 `input: unknown`（调用点 `as never` 不变） | ✅ 绿 |
| 2 | 负锁 persist sentinel | `persistEv.cause` 是 `DocCreateOperationalError` 实例，sentinel 原文在其 `.cause`（open 侧 `.cause.cause` 先例未复制） | `((persistEv.cause as {cause?:unknown}).cause as Error).message`；operational exact-instance 引脚（`ev.cause === typed`）不动 | ✅ 绿 |
| 3 | Clock 恰读一次末段 | persisted duplicate 用**同 key**（已有 active entry）→ entry 短路，slot 未走到 createDoc，Clock 不再读 | 末段改新 key `k-persisted`（无 entry）+ `queueCreate({error: DocDuplicateError()})`；`clock.calls` 1→2 期望保持；注释更新 | ✅ 绿 |
| 4 | post-commit 恢复 | `runtimeFactory` 恒 throw → 恢复性 open **也**经该工厂 → runtime-construction fatal，open 无法得 lease | 计数器工厂：仅首次 throw `factoryCause`，后续委托真实 `createNamespaceRuntimeForRegistry`（`@nomicore/namespace-runtime/internal` 相对导入）；「create 拒 + 后续 open 得 lease 且内容完整」不变；**零 entry 残留锚改型**（原「再 create 成功」与 open 恢复互斥——open 已建 entry）：改为「failed create 未建 entry，首次 open 走 loadDoc 恢复（loadCalls=1）而非 entry 命中；再 open 复用同一 Runtime 且 loadCalls 不增」 | ✅ 绿 |
| 5 | closing fail-closed 健康回归 | 注入 factory 对**所有** key 恒 throw → k-other create 于 create-document-internal fatal | 工厂改条件抛错（仅 `k-ns` 目标 key 触发）；其余 key 走**真实创建路径**（与默认工厂同构：`createInitialDocument` 公共 seam，含 SCHEMA/META/ROOT 安装）；fail-closed 主体断言（零 payload/Clock/Persistence + fatal create/lifecycle-slot-internal/false）不变；末段新增 `documentFactoryCalls === 1`（仅 k-other 到达创建路径） | ✅ 绿 |

## R-fix 二：总控裁决配套（2 项）

6. **create 公共签名恢复 typed**（`NamespaceRegistry.create(input: CreateNamespaceInput): Promise<CreateNamespaceResult>`，设计 §3/§14）——src 侧由 SA3 恢复（本 SA 未改 src）：
   - `makeCreateInput` 返回面改 `as CreateNamespaceInput` 单点断言（import type 自主入口），全部正常调用点零改动；
   - 敌意/缺键调用点 `as never`：registry-open.test.ts 零回显探针 `registry.create({schema,root})`；identity 表直构敌意输入（经 `input: unknown` + `as never`）；
   - 用独立探针程序（临时文件，已删）在 `create(input: CreateNamespaceInput)` 假设签名下验证全部调用模式 assignability：**零错误**；`tsc -p tsconfig.typecheck.json --noEmit` 当前 exit 0。
7. **doc probe 改 per-doc 锚定**（为 SA3 复用共享 verifySnapshotIntact/scratch 重物化让路；两处 installDocProbe 同步）：
   - afterTransaction 计数改 per-doc `WeakMap<Y.Doc, number>`；`probe.txCount` 只锚定**目标 doc**（首个经 SCHEMA/META/ROOT 探针的 fresh doc）；
   - scratch doc 的事务计入 scratch 自身条目、不影响目标锚；tamper one-shot 只对目标 doc 首次 afterTransaction 触发；空置快照逻辑不变；
   - 锚点成立性：当前镜像实现（无 scratch）绿；SA3 改回复用共享 verify（有 scratch）后必须仍绿——锚写法对两种实现都成立。

## 修订后红绿状态实录（后台独立进程，2026-08-26）

```
npx vitest run packages/namespace-registry packages/doc-runtime
→ Test Files 27 passed (27)；Tests 410 passed (410)；Type Errors no errors；exit 0；Duration 8.6s
```

- 5 盏缺陷灯全部转绿：identity 表 / 负锁 persist sentinel / Clock 恰读一次 / post-commit 恢复 / closing fail-closed；
- per-doc 锚改动后，单事务/空置/篡改全部用例在当前镜像实现下保持绿；
- 无断言强度削弱（修复均为「可达性」修复：直构 null owner、.cause.cause、新 key persisted duplicate、计数器工厂、条件抛错工厂）；
- 全程零 real sleep。

---

# 修订轮 R-fix2（SA4 changes-required 的 HIGH-1 / MEDIUM-2 红灯锚定）

## 新红灯清单（registry-create.test.ts，4 灯；当前实现全红，SA3 修复后转绿）

| 灯 | 落点 | 锚点 | 当前实现失败形态（vitest 实录） |
|---|---|---|---|
| HIGH-1 变体 A | closing fail-closed describe 内「deferred resolve 后 entry 仍 closing」 | await 后仍 closing 必须 fail-closed：rejects `create/lifecycle-slot-internal/false` + observer lifecycle-slot-failed(create)；等待期与全程零 payload 读取（Proxy trap 计数）/零 Clock 追加/零 createDoc/零 createDocument（计数器） | `expected phase:'lifecycle-slot-internal' received phase:'create-document-internal'`——await 后仍 closing 被放行，继续走到 createDocument（registry.ts:584-585 无 re-evaluate guard） |
| HIGH-1 变体 B | 「closePromise reject」 | close 的 rejection 不得裸传：rejects branded fatal（cause 保留 exact `closeCause`）+ observer 同源 exact cause | `expected {code,operation,phase,committed} toMatchObject received Error{message:'close-reject-caught-e9'}`——裸 rejection 直接传播（无 fatal 包装/无 observer） |
| HIGH-1 变体 C（对照绿锚） | 「resolve 后 entry 已消失 → 全链成功」 | 种子函数 fixture（`testEntries` 扩展形态）在 close settle 时删除 entry → after===undefined → create 继续正常（createCalls=1、Clock=1、createdAt 锚、read 42） | `TypeError: options.testEntries is not iterable`（registry.ts:347）——当前 testEntries 仅支持 Map 静态种子，**种子函数形态未获实现支持**：C 的红是 fixture 注入形态扩展的前置红灯（SA3 扩展 testEntries 为 `ReadonlyMap<string,any> | ((entries: Map<string,any>) => void)` 并修复 HIGH-1 后转绿；语义对照锚 = 不误伤合法 generation 迁移） |
| MEDIUM-2 | hostile input describe「数组四查」 | symbol 键 / 非枚举 own 键 / 数组子类实例 / null 与自定义原型 5 变体全部 NAMESPACE_CREATE_INVALID_INPUT、零 Clock、零 createDocument（计数 factory）/零 Persistence；对照 `namespace-runtime/src/write.ts:278-324` copyFrozen 四查纪律；fixture 前置锚：宿主 root 克隆后语义合法（漏检才会成功） | `array symbol key → expected {ok:false...} received {ok:true, lease:...}`——当前 clonePlainData 数组分支仅 `Object.keys(arr).length===arr.length`（registry.ts:292-305），symbol/非枚举/原型四查缺失 → 静默放行 create 成功（其余 4 变体同形态） |

## 断言纪律与不可弱化点

- 变体 A/B 的 failure 形态证明当前实现行为不符（A 继续走 createDocument、B 裸传 rejection），非超时；全部 deferred + flushMicrotasks，零 real sleep。
- 变体 C 的种子函数 fixture 是**测试侧允许的注入形态扩展**（总控 R-fix2 明示）；SA3 实现须同步支持。其余既有 43 灯不受影响（两包 414 用例：410 既有绿 / 4 新红）。
- 断言强度零削弱：A/B 的「零 payload/Clock/Persistence」为等待期+全程双锚；MEDIUM-2 的 fixture 前置（克隆产物合法才可能成功）保证红灯根因是「漏检放行」而非验证错误。

## 实录

```
npx vitest run packages/namespace-registry packages/doc-runtime
→ Test Files 1 failed | 26 passed (27)；Tests 4 failed | 410 passed (414)；exit 1；
  Type Errors no errors；Duration 8.7s（2026-08-26 当前实现镜像）
```

---

# 加固轮（SA7 动态验证：declaration-emit 用例在 CPU 争抢下触发 vitest 默认 5s testTimeout）

## 改动清单（纯抗负载加固，断言本体一字未动）

基于 TS compiler API emit 的 it 全部加显式第三参数 `{ timeout: 30_000 }`（vitest
`TestCollectorOptions.timeout`——`it(name, fn, options)` 等价形态）：

| 文件 | it | 说明 |
|---|---|---|
| packages/namespace-registry/test/registry-surface.test.ts | 主入口可达声明图文本不包含任何禁用标识符，且审计本身非空（覆盖 wrapper 链） | emitDeclarations + reachableFrom BFS |
| packages/namespace-registry/test/registry-surface.test.ts | 主入口 index.d.ts：新增 create 类型导出在、被替换的 RegistryOperationUnavailableIssue 不在（§2.3） | emitDeclarations |
| packages/namespace-registry/test/registry-surface.test.ts | testing 入口声明允许内部类型 import（Runtime/DocHandle 仅出现在受控子路径） | emitDeclarations |
| packages/doc-runtime/test/doc-runtime-surface.test.ts | 主入口可达声明图包含 createInitialDocument 且合法出现 Y.Doc（正向 fixture） | emitDeclarations |

排查范围：create-initial-document.test.ts（无 emit/重编译用例——纯运行期 getMap 探针）、
registry-create.test.ts（无 emit）、registry-open.test.ts / registry-node-dispose.test.ts
（无 emit）→ 无需追加。

## 运行证据

```
npx vitest run packages/namespace-registry packages/doc-runtime
→ Test Files 27 passed (27)；Tests 414 passed (414)；Type Errors no errors；exit 0；
  Duration 8.4s（2026-08-26；含 SA3 对 HIGH-1 A/B/C 与 MEDIUM-2 的修复落地，
  414/414 全绿）。tsc -p tsconfig.typecheck.json --noEmit exit 0。
```

---

# 终审锚定轮（双轴终审 ADVISORY 落实 + Standards ④ 格式清理）

## 改动清单

| 项 | 落点 | 内容 | 结果 |
|---|---|---|---|
| D1 红灯锚 | registry-create.test.ts（hostile input describe 内新增 it） | accessor getter 提供 owner/namespaceId：接纳段**零 getter 执行**（calls===0）+ resolve `NAMESPACE_CREATE_INVALID_INPUT` + 零 carrier（diagnostics 无 carrier-created）/零 Persistence；keeper 形态对照（own data descriptor）正常成功 | **红**：`expected 2 to be +0`——当前实现在 identity.ts 以属性 GET 读取（getter 执行 2 次）；SA3 改 descriptor-only 读取后转绿 |
| D2 锚补齐 | registry-create.test.ts（新增「输入形状」describe） | 五键（多 meta）/五键（多 createdAt）/错名键（rooot 代替 root）/缺 root（恰三键）→ 全部 `NAMESPACE_CREATE_INVALID_INPUT` + 零 Clock + 零 Persistence | **绿**（现机制已覆盖，专属锚无意外转红） |
| Standards ④ 格式清理 | registry-open.test.ts | 21 处多行胶合行（`{ clock: manualClock(),` + 参差换行）→ 分行对象标准格式；7 处 `{ clock: manualClock(),});` → `{ clock: manualClock() });`；双空行检查（本文件无）；断言文本/语义零触碰 | 零行为变化：registry-open.test.ts 32/32 绿 |

## 运行证据

```
npx vitest run packages/namespace-registry
→ Test Files 1 failed | 4 passed (5)；Tests 1 failed | 99 passed (100)；
  Type Errors no errors；exit 1（唯一红灯 = D1 getter 零执行锚；
  registry-open 32/32、registry-surface、node-dispose、entry-removal-guard 全绿）；
  tsc -p tsconfig.typecheck.json --noEmit exit 0。
```
