# SA4 静态实现评审（Issue #111）

**Worktree**: `/home/wangjian/nomicore-fix-issue-111`  
**Baseline**: `cdcf28b`  
**当前有效 Verdict（最新一轮）**: **pass**（R2 复审，见文末「R2 复审」节 L102 起；SA3 修订轮 R2 已闭合全部发现）  
**R1 初评 Verdict（历史记录）**: **changes-required**（1 HIGH/1 MEDIUM/2 MINOR——均已闭合，详见 R2 节）

## 审核结论（R1 初评，历史记录）

1. **设计一致性**：❌ 有一项 HIGH 设计偏离/安全漏洞；另有一项 MEDIUM payload 复制纪律偏离。
2. **读写路径一致性**：✅ Registry 仅将成功的自持 doc 传给 `persistence.createDoc`；失败 result 路径没有 partial doc 返回 Registry。
3. **静默失败**：✅ 可达失败分支均返回 domain issue 或 reject branded fatal；observer 本身的 throw 被隔离。
4. **降级方案**：✅ `DocCreateOperationalError` 是窄降级，unknown 不降级；未发现 create-as-open/upsert fallback。
5. **并发/状态机**：⚠️ 正常 active/FIFO/green-tail 实现正确；但 closing promise resolve 后再次观察到 `closing` 时，代码仍继续 create，违反 fail-closed 的单 generation 约束（见 HIGH-1）。
6. **错误处理/零回显**：✅ Registry 公开 issue/fatal 文本为常量，fatal 文本不插入 cause；observer 保留 controlled identity 和 exact cause 符合 §8。
7. **架构评估**：✅ 不需要退回 SA1；问题应回流 SA3 修实现。
8. **过度设计**：⚠️ 为 closing fixture 新增的 `testEntries` 是未在 §12 ALLOW 逐项列出的内部生产注入面，扩大攻击面；优先改成仅测试可达的封装，或把其设计/边界显式收口。

## 发现清单

### HIGH-1 — closing await 后再度 closing 被错误放行（并发/TOCTOU）

- **位置**：`packages/namespace-registry/src/registry.ts:566-585`
- **问题**：当前代码只在 await 后检查 `after.phase === 'active'`（581-583）；当 `after` 仍是 `phase:'closing'` 时落到 587，继续 payload → Clock → create-document → `createDoc`。这与冻结设计 §5:124 的限定“`after===undefined` 才继续”不一致，也违背 SA2 R3 剩余风险（closing 状态机必须统一处理 await 后仍 closing）。
- **可复核证据**：
  - 源码控制流：`await current.closePromise`（579）→ `entries.get(key)`（580）→ 非 active 不 return（581-583）→ 无 `after !== undefined` fail-loud/loop guard（584-585）→ create continues（587）。
  - 这可由 close 实现的同 key entry 在 promise resolve 前/后被重新置 closing 触发；Registry 在已有/未完成关闭 generation 上并发 `createDoc`，破坏同 key 代际排他和“closing fail-closed”原则。
  - SA6 仅覆盖 `closePromise === undefined` fixture（`registry-create.test.ts:1485-1577`），没有覆盖 **defined promise resolve 后仍 closing** 或 close rejection。
- **影响**：可能在关闭中的 generation 尚未完成时创建持久化文档，形成同 key 双 generation、错误 duplicate 语义或覆盖/泄漏资源。
- **建议修法（回流 SA3）**：await 后用 loop/re-evaluate；只有 `entries.get(key) === undefined` 才可进入 payload。若仍 closing 或 await reject，按稳定 `create/lifecycle-slot-internal/false` observer+fatal fail-closed，绝不可继续。补 deterministic deferred fixture 覆盖“resolve 后仍 closing”和 rejected close promise。

### MEDIUM-2 — `clonePlainData` 未实施同族四查，且对数组漏检 symbol/non-enumerable key

- **位置**：`packages/namespace-registry/src/registry.ts:292-305`，对照 `packages/namespace-runtime/src/write.ts:278-324`
- **问题**：数组分支只以 `Object.keys(arr).length === arr.length` 检查（294-295），随后读取 indexed descriptors。它没有检查：
  1. `Object.getOwnPropertySymbols(arr)`；
  2. `Object.getOwnPropertyNames(arr).filter(k => k !== 'length')` 与 enumerable key 集一致性；
  3. `Object.getPrototypeOf(arr) === Array.prototype`（数组子类/替换 prototype 被放行）。
- **可复核证据**：
  - `namespace-runtime/src/write.ts:279-315` 对同类 copyFrozen 明确包含数组原型、symbol、非枚举、descriptor、额外 enumerable 四查；Registry 的 285-305 不包含前述前三项。
  - 可构造 `const a=[1]; Object.defineProperty(a,'x',{value:1,enumerable:false});` 或 `a[Symbol('x')]=1`：`Object.keys(a).length === a.length` 仍成立，`clonePlainData` 返回 `[1]`，静默丢弃调用方 own 数据。数组原型替换也会被放行。
- **影响**：违反设计 §4:100-102 与审查清单的“数组四查纪律”；攻击者可让 input 的实际 own-state 与 snapshot 不一致，造成验证/持久化输入不透明地被降级、审计不可复现。
- **建议修法（回流 SA3）**：将数组分支与 `write.ts:278-324` 的检查对齐：要求 `Array.prototype`，拒绝 symbol key、任何除 length 外的 non-enumerable own key、holes/accessors 和额外 enumerable key；完成全部 descriptor 检查后再读元素。新增 array symbol、non-enumerable property、altered prototype/array subclass 的输入失败测试。

### MINOR-3 — 类型契约与对象实现之间有可见但受控的参数宽度差

- **位置**：`packages/namespace-registry/src/types.ts:288`；`packages/namespace-registry/src/registry.ts:704`
- **问题**：公共 `NamespaceRegistry.create` 为 `CreateNamespaceInput`，对象字面量实现为 `input: unknown`。这是 TypeScript 方法参数双变型下可赋值且是设计注明的“双层”模式，不构成当前安全故障；但任何内部直接消费 `createRegistryInternal` 返回 `NamespaceRegistry` 以外对象的扩展都可能绕过 public static contract。
- **建议修法（回流 SA3，非阻塞可与 HIGH 一并处理）**：保留 runtime `unknown` 接纳合理，但可显式把实现函数声明为 overload/局部 helper，令公开对象字段使用 `CreateNamespaceInput`，内部转交 `unknown`，减少维护者误读。

### MINOR-4 — `testEntries` 扩大内部生产实现注入面，未在 File Scope 说明

- **位置**：`packages/namespace-registry/src/registry.ts:104-114,345-350`
- **问题**：冻结设计 §8 只冻结 testing 的 `clock/createDocumentFactory`；§12 对 `registry.ts` 的说明没有列 `testEntries`。它不经 `testing.ts` 导出，但 `createRegistryInternal` 是文件级 export，包内调用可将任意对象写入 entries。
- **证据**：该 seam 由 `registry-create.test.ts:1490-1539` 经相对 internal import 使用；`NamespaceRegistryInternalOptions.testEntries` 是生产源码 exported interface 属性。
- **建议修法（回流 SA3/SA1 视治理决定）**：将 fixture mechanism 限在 test-only module/闭包，或由 SA1 修订允许清单与 §8 seam 说明，定义 shape/freeze/不可达边界。不得公开 re-export。

## 设计对账表（§3–§8）

| 设计节 | 实现落点 | 静态结论 |
|---|---|---|
| §3 公共类型/message | `namespace-registry/src/types.ts:36-58,148-205,278-305`; `index.ts:9-24` | 类型 union、readonly、message literal、typed public create、shutdown `'shutdown'` 收窄均一致。 |
| §4 identity/DQ-1 | `identity.ts:123-145`; `registry.ts:532-549,249-316` | 顶层非 object→create-invalid；identity trap 捕获且 carrier 创建后无 map 写入失败路径；payload 读取时序正确。数组 clone 四查不完整（MEDIUM-2）。 |
| §5 create slot | `registry.ts:556-692` | acceptance→active→closing→payload→Clock→document→persistence→runtime 主次序正确；error mapping/green tail/entries.set 时点正确；closing recheck 不完整（HIGH-1）。 |
| §6 Clock/create-document | `registry.ts:226-234,367-390`; `create-document.ts:97-120`; `doc-runtime/create-initial-document.ts:87-188` | Clock shape 和单次读时点正确；compile/root split、seam input-invalid fail-loud、doc self-owned、single guarded transaction 和四类 verify 均有落点。 |
| §7 失败映射 | `registry.ts:604-675,684-690`; `observer.ts:14-26` | typed duplicate/operational/fatal、unknown false、post-commit runtime true、observer event 基本一致。 |
| §8 observer/testing/exports | `observer.ts:14-69`; `testing.ts:23-70`; `index.ts:9-24`; `doc-runtime/index.ts:29-30` | observer union 扩展保持 open；testing clock/factory；主入口 runtime value 三个；doc-runtime seam 正确导出。`testEntries` 是额外 internal seam（MINOR-4）。 |

## 范围、导出与 CI 审计

- **File scope**：`git diff --name-status cdcf28b --` 的生产/测试文件均落在 §12 ALLOW（档案与 `pnpm-lock.yaml` 适用豁免）；无 DENY 路径、无 blacklist 文件。`git diff --check cdcf28b --` 无 whitespace 错误。
- **依赖**：`packages/namespace-registry/package.json:13-19` 含 `@nomicore/clock` 与 doc-runtime；`pnpm-lock.yaml` 已包含 clock importer（按实现档案 R1）。
- **导出边界**：主入口仅三项 runtime value（`registry-surface.test.ts:48-74`）；create-document 仅 import doc-runtime/vfsl public package入口（`create-document.ts:28-30`）。
- **CI 触发性：changes-required 的独立门禁**：`.github/workflows/ci.yml` 只显式运行 persistence、vfsl、`packages/doc-runtime/test/materialize-root.test.ts`（grep 结果），没有运行 namespace-registry test 或本次新增的 doc-runtime tests；design §12 又明确 DENY workflow/config。即本次新增 `registry-create.test.ts`、`create-initial-document.test.ts`、`doc-runtime-surface.test.ts` 不在现有显式 CI 命令覆盖范围。应由 **SA1** 扩展 ALLOW/补 runner 触发性设计，随后 **SA3** 接通 CI；在此之前这些回归测试可成为本地孤儿。

## 测试质量静态抽查

- ✅ 新测试主链驱动真实 Registry/doc-runtime 行为；没有“读生产 `.ts` 后对源码文本断言”的伪测试。surface 声明测试读取 **emit 产物**，属于有效 API surface 验证。
- ✅ never-settle 测试采用 promise settled flag + microtask/setImmediate，而不是依赖测试超时（`registry-create.test.ts:1346-1390`）。
- ✅ afterTransaction 探针已改成 per-doc `WeakMap`，scratch 重放不会污染 target 计数（`registry-create.test.ts:248-297`; `create-initial-document.test.ts:114-164`）。
- ❌ 缺失 HIGH-1 的 await 后仍 closing/reject 分支；缺失 MEDIUM-2 数组 keys/proto 防线回归。

## 动态审核重点（交 SA7）

1. SA3 修复 HIGH-1 后，以 deferred close promise 验证 resolve 后仍 closing、reject、active、undefined 四分支均不产生错误 createDoc。
2. SA3 修复 MEDIUM-2 后，以 symbol/non-enumerable/array-subclass/prototype-altered payload 运行验证均在 Clock 前窄拒绝。
3. CI 接通后，从 workflow log 证明 namespace-registry 与 doc-runtime 新增 tests 确实执行，而非仅本地 `npx vitest` 通过。
4. 运行 stress：同 key create/open 与 close transition 交错，核对持久化唯一性和 carrier cleanup 三条件。

## 验证证据

- `git diff --name-status cdcf28b -- && git diff --check cdcf28b -- && git status --short` → 无 whitespace 错误；无 blacklist 路径；变更与设计 allow-list 对账。
- `grep -RInE 'vitest run|playwright test' .github/workflows` → 仅发现 `ci.yml` 对 persistence/vfsl/materialize-root 的显式 Vitest 调用，未覆盖本票新增测试包/文件。
- 静态逐行审阅：`registry.ts:249-316,556-692`；`identity.ts:123-145`；`create-document.ts:97-120`；`create-initial-document.ts:87-188`；`types.ts:148-205,278-305`；对照 `namespace-runtime/src/write.ts:278-324`。

## 遗留风险

- `open` 的既有 `closing && closePromise===undefined` 静默坠落仍按设计留给 #112；本评审不将其计入 #111 修改回归，但 #112 必须统一 open/create closing loop/reject 策略。
- Registry public `create` 的 typed contract 正确，但 runtime hostile-input coverage 依赖 implementation 的 unknown 接纳；应保留 current tests 的 `as never` 边界用例。

---

## R2 复审（SA3 修订轮 R2）

**Verdict：pass**。此前 HIGH-1、MEDIUM-2 及两个 MINOR 均已闭合；未发现 R2 补丁引入新的 HIGH/MEDIUM 级静态缺陷。

### 前轮发现闭合状态

| 前轮项 | 状态 | 修复后证据 |
|---|---|---|
| HIGH-1：await closing 后仍 closing 被放行 | ✅ closed | `registry.ts:622-665` 先处理 missing promise（625-634），`try/catch` 精确包住 await（638-648），后续仅 `after===undefined` 放行（665）；active 返回 duplicate（650-652），任何其他 entry（即仍 closing）以 lifecycle fatal false 终止（653-663）。 |
| MEDIUM-2：数组 snapshot 漏 symbol/non-enumerable/prototype 检查 | ✅ closed | `registry.ts:301-335` 依序检查精确 Array 原型、symbol、names/keys 与长度、所有 index descriptor，再读值；与 `namespace-runtime/src/write.ts:278-324` 的同族防线一致。 |
| MINOR-3：public typed / implementation unknown 可读性 | ✅ closed | `registry.ts:785-792` 明确记录公开 `CreateNamespaceInput` 与内部 hostile-input runtime 接纳的双层签名；`types.ts` 的公共签名仍是 typed。 |
| MINOR-4：testEntries 未冻结/边界不明 | ✅ closed | 设计 §8:283 将其冻结为 closing 红灯专用 internal seam；`registry.ts:100-121,393-406` 仅由包内相对模块消费，不经 `index.ts` 或 `testing.ts` 导出，并限定静态 Map/seed function 两种形态。 |

### 二次攻击结论

1. **Fail-closed cause 与 observer 精确性：通过。**
   - missing promise 使用内部 `Error`，observer event 为 `lifecycle-slot-failed`、`identity:id`、`operation:'create'`（`registry.ts:625-633`）；公开 fatal 为 `create/lifecycle-slot-internal/false`。
   - close rejection 在 catch 中保留 exact rejected value 同时传给 observer 与 fatal（638-648），没有裸传。SA6 变体 B 逐一锁住 fatal branded shape、`err.cause === closeCause`、`event.cause === closeCause`（`registry-create.test.ts:1739-1783`）。
   - close resolve 后仍 closing 使用新建内部 cause 并以同样 observer/fatal 参数 fail-closed（653-663）；变体 A 断言 pending 等待期和结算后均为零 schema get trap、零 Clock、零 persistence/createDocument（1667-1737）。

2. **种子函数形态、调用时点与异常面：通过（静态范围）。**
   - 构造时 entries map 创建后、任何 public operation 前同步执行 seed（`registry.ts:393-406`），故 fixture 可以注册 `closePromise.then(delete)` 再接纳 create；不存在跨 slot 的异步 seed 写入。
   - SA6 变体 C 通过 promise reaction FIFO 保证 delete reaction 先于 await continuation，随后 `after===undefined` 才走全链，且锁住 `createCalls=1`、Clock=1、metadata/read（`registry-create.test.ts:1786-1811`）。
   - seed function 若同步 throw，构造调用同步抛出。这是 test-only internal fixture 的正确 fail-loud 行为，未泄漏到公共 production/testing factory；没有引入公开错误契约。

3. **clonePlainData 与 copyFrozen 同族性：通过。**
   - 数组：Registry 的 prototype（305-307）、symbol（309）、non-enumerable/own key set（312-320）、descriptor/hole/accessor（324-328）、最后才读取（331-334）分别对应 `write.ts:280-282,285-287,290-292,301-314,316-324`。
   - 对象：Registry 的 plain/null proto、symbol、ownNames-vs-keys、descriptor-before-read（337-365）与 `write.ts:327-361` 对齐；Registry 保留设计指定的全图 `WeakSet` shared-reference rejection，区别于 write 的 ancestor-only DAG copy，是有意且与 §4 一致。
   - 对象补强不会误杀合法对象：plain 与 null-prototype object 仍允许；正常 own enumerable data keys 仍进入复制；`Object.defineProperty` 保持 own `__proto__` 为数据键而不触发 setter。原成功全链（schema/root normal object）仍覆盖合法绿路径；R2 数组灯另以可编译 schema + clone 后合法 `{n:42,list:[1]}` 前置证明，不把验证失败误诊为 clone 拒绝（`registry-create.test.ts:658-716`）。

4. **SA6 新增四灯断言强度：通过。**
   - A 有 pending 阶段及 close settle 后双重零副作用锚：schema Proxy get count、Clock、create/load persistence、document factory（1699-1704、1724-1729），并锁 observer create operation（1730-1736）。
   - B 同时锁 branded error four fields、fatal exact cause、observer exact same cause，以及 Clock/create/load 均为零（1760-1783）。
   - C 是必要正向对照，确认 `after===undefined` 不被过度 fail-closed 误杀（1803-1811）。
   - MEDIUM-2 对五类数组变体逐个要求 input issue 和每例 Clock=0，另锁全局 persistence/load/document factory 均为零（668-715）；其 factory 成功而非 throw，避免伪红。

### 验证证据

- 静态逐行审阅：`registry.ts:100-121,299-365,393-406,622-665,785-792`；对照 `namespace-runtime/src/write.ts:278-362`；设计补遗 `design.md:114-135,245-246,283`。
- SA3 R2 档案记录：定向 `npx vitest run packages/namespace-registry packages/doc-runtime` 为 **414/414，exit 0**；全仓 `1333/1333，exit 0`；`pnpm typecheck` 和 `tsc -p tsconfig.typecheck.json --noEmit` 均 **0**（`sa3_impl.md:221-233`）。本轮定位为静态复审，未重复执行动态测试。

### R2 后动态审核重点

1. 在真实 close 状态机（#112）落地后，验证 close resolve/reject/replace entry 与 create/open 的完整竞争序列。
2. 对 Proxy 的状态化 ownKeys/descriptor trap 进行运行时 fuzz，确认其 throw 仍只造成本 slot input issue、green tail 保持。
3. 从 CI run log 继续确认设计 §11 所述的全仓 Vitest 入口实际触发新增测试。
