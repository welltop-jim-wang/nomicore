# SA1 架构与实现设计 — Issue #330 nomicore 服务表面 getter 化（ADR 0023 机械落地）

- 派发：`sa-a89131cf-9fdd-4bff-8a14-e1c3cde71b7e`（role `mabf-sa1`，phase `design`，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-330`（branch `mabf/issue-330`，HEAD `83581b3` = ADR 0023 文档落地 commit，已核实）
- 任务：Issue #330「nomicore 服务表面 getter 化：冻结服务可被 Proxy 包装消费（ADR 0023 落地）」
- 上游输入（全部已读）：
  - 任务简报 `wiki/raw/task_issue-330.md`（Issue 正文 AC1–AC8；`Comments` 为空）
  - SA6 验收契约 `wiki/raw/task_issue-330_sa6_contract.md`（verdict `approve`，红/绿证据与测试路径已钉死）
  - SA6 红证据 `wiki/raw/task_issue-330_sa6_red_probe.log`（HEAD 实跑 18/18 函数成员访问即抛 TypeError，200/200 稳定）
  - SA8 冲突报告 `wiki/raw/task_issue-330_conflict_report.md`（verdict `clear`；`requiresConflictRecheck=true`）
  - SA8 决议摘录 `wiki/raw/task_issue-330_relevant_decisions.md`
  - 母法 `docs/adr/0023-proxy-consumable-frozen-service-surfaces.md`；术语面 `CONTEXT.md` L129–131
- 评审输入：`wiki/raw/task_issue-330_sa2_review.md` **不存在**（本 iteration 无评审修订输入，见 §14）
- 派发约束：**不实现代码、不编写验收测试**——本设计给出精确机械变换规格、稳定闭包与冻结姿态契约、包内 guard-proxy 回归覆盖需求与验证门，由下游实现角色执行。

---

## 1. 任务类型、目标与非目标

**任务类型：Feature（ADR 0023 构造纪律的代码兑现）**。ADR 已接受（commit `83581b3`）、术语面已登记，但五个受影响服务表面在 HEAD 仍为「冻结对象字面量 + 数据属性方法」形态；缺口以 DSH 动态插件沙箱（cordis-host-runner）中每次成员访问抛 ECMA-262 Proxy `[[Get]]` 不变量 `TypeError` 呈现（SA6 实跑复现，非本设计复演）。

**目标**：

1. 把 4 处生产 + 1 处 testing 服务对象（`nomicoreRegistry`、`nomicoreHubReplication`、`nomicorePeerReplication`、`systemClock`、`ManualClock`）的全部函数成员从数据属性机械变换为访问器属性（getter 返回稳定闭包）。
2. 冻结姿态不弱化：`Object.freeze` 保留、赋值与 `defineProperty` 重定义仍拒、枚举性与键序不变、TS 公共类型面零变化。
3. 每个服务配一款「guard-proxy 合法消费」包内回归测试，把可包装性契约锁死。
4. 三包门禁 + root `pnpm typecheck` / `pnpm test` 全绿；三包 local tarball 可构建（tsc target ES2022 保留 getter）。

**非目标（可验证排除面，依据 ADR 0023 L30–41 + SA8 §3）**：

- 不改 `nomicoreInstance`（纯数据冻结字面量，`instance/src/index.ts` L60–64；SA6 负控 ACCESS_OK）。
- 不改 `nomicorePersistence`（class 原型方法，`persistence/src/memory.ts` L74 / `file.ts` L59；非冻结、不变量只约束自有属性）。
- 不改 `timer`（上游 `@deepseek-ai/cordis-plugin-timer`，非本仓资产）。
- 不改服务方法返回值（`NamespaceLease`、`ReplicationSession`）、issue/status 信封、`ws-replication/src/testing.ts` L44 `decorateLease` 冻结字面量（lease 返回值，非 `ctx.provide` 服务）。
- 不改方法体、闭包封装、内部状态机、teardown 次序、service 名、wire 协议（`instance-replication-v1.md` 零触碰）。
- 不误伤数据载荷快照纪律（`registry.ts` L763–772 `clonePlainData` 与 `namespace-runtime` `copyFrozen` 的 `writable: false` defineProperty——JSON 域数据，非服务表面）。
- 不新建共享测试设施（AC6 / ADR L90：guard-proxy helper 每包内联复制约 10 行）。
- 不做 DSH 侧 `nomicore-host` 重建 / live reload / fork 回退（仓外联动，本仓验收边界止于 tarball 可构建）。

---

## 2. 当前行为与证据锚点（HEAD `83581b3` 实读核验）

### 2.1 五个服务表面的现状形态

| # | 服务 | 构造点（HEAD 实读） | 现状成员形态 | Cordis 发布 |
|---|---|---|---|---|
| S1 | `nomicoreRegistry` | `packages/namespace-registry/src/registry.ts` L2179–2281（`createRegistryInternal` 末段：`const registry: NamespaceRegistry = Object.freeze({...}); return registry`） | 7 成员全为数据属性：`open` `create` `importReplica` `resetReplica` `deleteNamespace` `getStatus` `shutdown`（`async` 方法简写 ×5 + `getStatus` + 非 async `shutdown`） | `provideNomicoreRegistry`（plugin.ts L86–89，名 `nomicoreRegistry` L67；`requireNomicoreRegistry` L91–96） |
| S2 | `nomicoreHubReplication` | `packages/ws-replication/src/plugin.ts` L431–437（`apply` 内 `const service: HubReplicationService = Object.freeze({...})`） | `status` **已是**访问器 getter（L432–434）；`requestReauth`（L435，内联箭头）、`stop`（L436，引用 L421 命名 const `stop`）为数据属性 | `ctx.provide(NOMICORE_HUB_REPLICATION_SERVICE, service)` L441（名 L27） |
| S3 | `nomicorePeerReplication` | `packages/ws-replication/src/plugin.ts` L505–539（`apply` 内） | `status` 已是 getter（L506–513）；`addTarget` `removeTarget` `notifyAuthChanged` `waitForLive`（内联箭头）、`stop`（引用 L492 命名 const）为数据属性 | `ctx.provide(NOMICORE_PEER_REPLICATION_SERVICE, service)` L542（名 L28） |
| S4 | `clock`（`systemClock`） | `packages/clock/src/system.ts` L9–11 | `now` 数据属性（箭头函数） | `provideClock`（contract.ts L29–31，名 `clock` L20；system.ts L21） |
| S5 | `ManualClock`（testing 导出） | `packages/clock/src/manual.ts` L32–53（`createManualClock` 工厂内 `return Object.freeze({...})`） | `now` `set` `advance` 数据属性（捕获工厂局部 `let current`） | 经 `createManualClockPlugin`（manual.ts L59–65）以 `provideClock` 发布 |

### 2.2 关键现状锚点（设计依赖的事实）

- **`shutdown` 非 async 契约**：`registry.ts` L2262–2264 注释明言「非 async 方法：精确返回缓存的 shutdownPromise 实例（async 包装会新建 Promise，破坏 AC12『并发/重复调用 exact same Promise』）」，体 L2264–2279 同步停接纳 + 清 idle timer + `shutdownPromise = runShutdown()` 后返回同一实例。
- **hub/peer `stop` 已是一次性闭包**：hub L421 `const stop = (): Promise<void> => stopPromise ??= (async () => {...})()`；peer L492–504 同款（先结算 `liveWaits` 再 `replication?.stop()`）。`ctx.effect` 内 `yield revoke; yield stop` reverse-yield 次序（hub L438–445 / peer L540–545）。
- **Clock 形状门禁**：`registry.ts` L620–628 `assertClockShape` 用 `typeof (value as { now?: unknown }).now !== 'function'`（属性读取 + `typeof`）；peer 侧 `plugin.ts` L482 `clock: { now: () => clock.now() }` 包装。
- **键面/冻结既有断言**：`packages/clock/test/clock-contract.test.ts` L70–73（`Object.keys(systemClock) === ['now']` + `Object.isFrozen`）、L109–113（manual 键面 `['now','set','advance']` + `isFrozen`）。
- **TS 类型面**：`Clock`（contract.ts L14–17）、`ManualClock`（manual.ts L17–20）、`HubReplicationService`（plugin.ts L35–40）、`PeerReplicationService`（plugin.ts L48–56）、`NamespaceRegistry`（types.ts ~L712 起接口签名）——均以属性签名描述方法，不区分数据/访问器。
- **导出面**：clock 主入口 `src/index.ts`（`CLOCK_SERVICE`/`provideClock`/`requireClock`/`Clock`/`createSystemClockPlugin`/`systemClock`）与 `src/testing.ts`（`createManualClock`/`createManualClockPlugin`/`ManualClock`）；`registry-surface.test.ts` 断言主入口运行时 export keys 恰九个。
- **测试入口**：`vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', ...]`、`typecheck.include: ['packages/*/test/**/*.test-d.ts', ...]`、`passWithNoTests: true`（默认；CI 对指定文件用 `--passWithNoTests=false` 先例 `.github/workflows/ci.yml` L80/L114–122）。跨包源码解析：`NODE_OPTIONS=--conditions=nomicore-source` + `tsconfig.base.json` `customConditions`。
- **构建**：`tsconfig.base.json` `target: ES2022`（getter 为 ES5+ 语法，tsc 原生保留，无 downlevel 变形）；`pack:local` 走 `scripts/build-package.mjs`。
- **消费侧审计（SA6 §10 + 本设计复核）**：三包与 `apps/yjs-server` 对五服务的消费全部为属性读取/调用（`assertClockShape`、`plugin.ts` L482、`persistence/src/service.ts` L27 `requireClock`、`apps/yjs-server/src/app.ts` L281 `now: () => requireClock(this.ctx).now()`）；仓内 `getOwnPropertyDescriptor` 消费全部位于敌意输入校验路径（`identity.ts` L146/L182/L186、`registry.ts` L319–320/L672/L730/L754），无一作用于五服务对象；无服务对象 spread / `Object.assign` / `vi.spyOn` 消费。

---

## 3. 根因 / 能力缺口

**能力缺口（非缺陷根因链——ADR 0023 已裁决）**：五个经 `ctx.provide` 发布的服务对象以「`Object.freeze` 对象字面量 + 数据属性方法」构造；ECMA-262 对 Proxy `[[Get]]` 陷阱的不变量规定：目标属性为**自有的、不可写的、不可配置的数据属性**时陷阱必须返回 SameValue 真值——DSH 沙箱为函数成员返回新包装闭包的合法构造因此每次成员访问即抛 `TypeError`。规范留出的合法通道是：**带 getter 的访问器属性即使不可配置也不受该不变量约束**。ADR 0023 已决策采用访问器形态并把其冻结为构造纪律，但代码未落地。触发条件、敏感性对照（同 freeze 仅属性形态翻转红绿）、排除面负控均由 SA6 在 HEAD 实跑钉死（契约 §5/§6/§9，`task_issue-330_sa6_red_probe.log`），本设计不再复演。

---

## 4. Owner要求落实

Issue-comments REST 读取结果为 `[]`（派发说明 + 简报 `Comments` 空节 + SA6/SA8 一致记录）：**不存在 Owner 评论来源的 override 或附加义务，无 comment ID/时间戳可应用**。全部义务 = Issue 正文 AC1–AC8 + ADR 0023（SA8 裁决 4 项 `implements-existing-decision`）。

| 来源 | 要求 | 设计落点 |
|---|---|---|
| Issue 正文 AC1 | registry 全函数成员访问器形态 + guard-proxy 消费回归 | §7.2 S1、§7.6、§12 |
| Issue 正文 AC2 | Hub/Peer 同款 + 各一款 guard-proxy 回归（既有插件 seam），覆盖 `status`/`requestReauth`/`stop` 与 `status`/`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive` | §7.2 S2/S3、§7.6、§12 |
| Issue 正文 AC3 | systemClock + ManualClock 同款 + guard-proxy 用例；既有 `Object.isFrozen` 断言保持绿 | §7.2 S4/S5、§7.4、§12 |
| Issue 正文 AC4 | 既有 data 属性形态断言更新为访问器形态；无则审计结论记录在案 | §7.7（审计结论承接） |
| Issue 正文 AC5 | `Object.freeze` 保留；赋值/`defineProperty` 重定义仍拒；TS 公共类型面零变化 | §7.4、§7.2（注解纪律） |
| Issue 正文 AC6 | helper 包内复制（约 10 行），不新建共享测试设施 | §7.6 |
| Issue 正文 AC7 | 三包门禁 + root `pnpm typecheck` / `pnpm test` 全绿 | §12.3 |
| Issue 正文 AC8 | 三包 local tarball 可构建 | §12.3、§8 数据流路线 3 |
| ADR 0023 L45–62 | 函数成员一律访问器属性、稳定闭包、`Object.freeze` 保留、方法体一行不动 | §7.2、§7.3 |
| ADR 0023 L64–74 | 姿态对照（赋值拒/重定义拒/类型面不变/引用缓存不变/枚举性保持） | §7.4 |
| ADR 0023 L90–93 | guard-proxy 回归、形态断言更新、门禁、tarball | §7.6、§7.7、§12 |

---

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| HEAD 上五服务经「get 陷阱返回包装闭包」guard Proxy 访问函数成员：18/18 抛同型 `TypeError`（`read-only and non-configurable data property ... did not return its actual value`）；hub/peer `status`（已是 getter）2/2 绿 | `task_issue-330_sa6_red_probe.log`；契约 §5 逐成员红表 | 变换目标形态即 probe 已验证的「访问器形态冻结模型」（负控绿 + 姿态探针全过）——设计按该模型落地（§7.2/§7.4） |
| 稳定性 200/200；失败同步、可重入、无并发/时钟依赖 | 契约 §7 | 设计不引入任何时序/并发新面（§9） |
| 负控：诚实 Proxy、非冻结字面量、纯数据服务（`nomicoreInstance`）、class 原型（`nomicorePersistence`）、访问器模型全绿 | 契约 §6；probe 13/14/27–33/2–6 | 排除面成立，非目标清单据此固定（§1） |
| 敏感性：仅改属性形态即翻转红绿（E1/E6） | 契约 §9 | 验收断言对根因敏感；新测试必须带 helper 正控防空洞绿（§7.6） |
| 基线全绿：三包 120 文件 1010 用例 + root typecheck（14 tsc project）+ pack:local（14 tgz） | 契约 §4 | 验证门基线（§12.3）；改造后必须保持 |
| SA6 判定「红在 HEAD 由 probe 实跑证明；SA3 落地测试文件后须先在 HEAD 复跑捕获红再转绿」 | 契约 §13 | 采纳为验收流程纪律（§12.2） |

上游事实与源码无矛盾（本设计对全部行号锚点做了 HEAD 实读复核，见 §2）。

---

## 6. SA8约束落实

SA8 verdict `clear`（no-conflict 8 / implements-existing-decision 4 / evolution 0 / hard-conflict 0；无 override）。`requiresConflictRecheck=true` → 见 §15。

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| ADR 0023 L45–62：函数成员一律访问器属性、方法体提稳定闭包、freeze 保留 | §7.2/§7.3 | 逐服务机械变换规格 + 稳定闭包纪律 | 是（实现 diff 复核，§15） |
| ADR 0023 L30–41 影响面：排除 instance/persistence/timer/lease 返回值/信封 | §1 非目标、§11 DENY | 可验证排除面 | 否（纯排除，无决策触碰） |
| ADR 0023 L64–74 姿态对照 + L90–93 验收 | §7.4、§7.6、§12 | 姿态断言块 + 三重对照回归 | 是（姿态属冻结面复核项） |
| ADR 0023 L78：deepFreeze 按 `descriptor.value` 递归注意访问器 | §9 | 仓内 deepFreeze（namespace-diagnostic-log/vfsl/yjs-server config）只消费数据载荷、不消费五服务（SA8 现状核验 6 + ADR 审计）——无命中面，设计无动作、实现不得顺手改 deepFreeze | 否 |
| Cordis service 名不变（4 名） | §7.2 | 变换不触碰任何 service 名常量 | 否 |
| 公共 TS 类型面零变化（5 接口） | §7.2 注解纪律、§12.1 | 接口零 diff；提升闭包显式注解避免 implicit any | 是（类型面属冻结面） |
| 枚举性：键面断言保持绿 | §7.4 | 成员序与字面量 getter 默认 enumerable | 是 |
| 方法体/状态机一行不动；`shutdown` 不 async；stop 缓存 Promise 语义 | §7.2 S1/S2/S3 | 体逐字平移；`shutdown` 保持非 async 函数表达式 | 是 |
| plugin teardown reverse-yield 次序不变 | §7.3 | `stop` 闭包实例不变，`yield stop` 引用同一性保持 | 是 |
| Registry issue/status 信封与冻结常量不改 | §1 非目标、§11 DENY | 不在改造面 | 否 |
| 数据载荷 `writable:false` 不误伤（clonePlainData/copyFrozen） | §11 DENY（文件内子范围排除） | 同文件内显式排除 L763–772 | 是（diff 复核） |
| testing 导出边界：ManualClock 仅经 `@nomicore/clock/testing`；不新建共享测试设施 | §7.6、§11 | 导出零变化；helper 包内复制 | 否 |
| wire 协议零触碰 | §1 非目标 | 进程内 JS 构造面，非 wire 面 | 否 |
| SA8 §8 提醒 1–6（稳定闭包/shutdown 不 async/AC4 审计分支/不误伤数据载荷/fake timer 范围外/status 已 getter） | §7.3/§7.7/§11/§1 | 全部采纳并落入对应章节 | — |

---

## 7. 设计决策与主要备选方案

### 7.1 总体裁决

**纯机械属性形态变换**：每个受影响成员 = 「提升闭包到正确作用域 + 字面量内改 getter」两步；方法体、闭包封装、内部状态机、发布与 teardown 路径一行不动。无新抽象、无新模块、无运行时分支。这是 ADR 0023 L45–62 的直接兑现，也是唯一同时满足「可包装」与「姿态不弱化」的已裁决路线。

### 7.2 精确机械变换规格（逐服务）

通用规则（全部五处适用）：

- **R1 提升作用域**：闭包必须在**拥有该实例状态的函数作用域**内声明、恰一次（SA6 约束 1）；具体作用域见下表。禁止把带实例状态的实现提到模块作用域（跨实例串状态）、禁止在 getter 内联函数表达式。
- **R2 getter 形态**：对象字面量内 `get <member>() { return <closureIdent> }`——getter 体内只允许 `return` 一个闭包标识符。字面量**成员声明序保持不变**（`Object.keys` 顺序 = 字面量插入序，键面断言锚定）。
- **R3 方法体一行不动**：提升 = 声明包装从「方法简写 / 内联箭头」改为「`const <ident> = ... =>`」，注释随体平移；体内零改动（含 `registry.ts` L2262–2264 的 exact-same-Promise 契约注释）。
- **R4 TS 注解纪律**：提升后字面量的 contextual typing 不再覆盖闭包，每个提升闭包必须**显式标注参数与返回类型**，逐字取自现有方法签名或所属接口；禁止依赖推断（防 implicit any 与签名漂移）。这是唯一允许的签名层新增（注解本身），接口零改动。
- **R5 `Object.freeze` 保留**：五处 freeze 调用原样；不为可包装性去 freeze（CONTEXT Avoid 红线）。
- **R6 `this` 无关性**：五服务全部方法体现状即无 `this` 引用（本设计逐体核验）；提升为箭头后 `this` 绑定差异不可观察，guard-proxy 的 `Reflect.apply(value, receiver, args)` 与直连调用结果一致。

#### S1 `nomicoreRegistry`（registry.ts L2179–2281）

提升点：`createRegistryInternal` 作用域内、`runShutdown`（L2128–2177）之后、`const registry` 字面量之前。七个闭包捕获工厂局部状态（`acceptance`/`entries`/`scheduler`/`shutdownPromise`/`diag` 等——作用域不变）。

```ts
// 改后骨架（ADR 0023 L54–59 同款；体 = 现 L2180–2279 逐字平移，注释随体）：
const open = async (owner: unknown, namespaceId: unknown): Promise<OpenNamespaceResult> => {
  // ……现 L2181–2192 体一行不动……
}
const create = async (input: unknown): Promise<CreateNamespaceResult> => { /* 现 L2195–2218 */ }
const importReplica = async (owner: unknown, namespaceId: unknown, doc: unknown,
  expectedReplicationIdentity: unknown): Promise<ImportReplicaResult> => { /* 现 L2220–2231 */ }
const resetReplica = async (owner: unknown, namespaceId: unknown,
  expectedLocalIdentity: unknown): Promise<ResetReplicaResult> => { /* 现 L2233–2243 */ }
const deleteNamespace = async (owner: unknown,
  namespaceId: unknown): Promise<DeleteNamespaceResult> => { /* 现 L2245–2252 */ }
const getStatus = (): NamespaceRegistryStatus => { /* 现 L2254–2260 */ }
// 非 async 方法：精确返回缓存的 shutdownPromise 实例（原 L2262–2264 注释随体平移，
// exact-same-Promise 语义保持——禁止 async 化）
const shutdown = (): Promise<void> => { /* 现 L2264–2279 体一行不动 */ }

const registry: NamespaceRegistry = Object.freeze({
  get open() { return open },
  get create() { return create },
  get importReplica() { return importReplica },
  get resetReplica() { return resetReplica },
  get deleteNamespace() { return deleteNamespace },
  get getStatus() { return getStatus },
  get shutdown() { return shutdown },
})
return registry
```

#### S2 `nomicoreHubReplication`（plugin.ts L421–437）

`stop` 已是命名 const（L421–430）——**零提升**。仅提升 `requestReauth`（显式返回类型取自接口 L37 `Promise<void>`；体内 `HubReplication.requestReauth` 返回 `Promise<void>`，types.ts L178 核验）：

```ts
// apply 内、const stop 之后、service 字面量之前：
const requestReauth = (instanceId: string): Promise<void> =>
  replication?.requestReauth(instanceId) ?? Promise.resolve()
const service: HubReplicationService = Object.freeze({
  get status(): HubReplicationStatus { /* 现 L432–434 一行不动 */ },
  get requestReauth() { return requestReauth },
  get stop() { return stop },
})
```

#### S3 `nomicorePeerReplication`（plugin.ts L505–539）

`stop` 已是命名 const（L492–504）——零提升。提升四个内联箭头（`waitForLive` 闭包体 L517–537 一行不动，捕获 `liveWaits`/`timer`/`replication`/`stopped`；注解取自接口 L50–53）：

```ts
// apply 内、const stop 之后、service 字面量之前：
const addTarget = (target: ReplicationTarget): void => { replication?.addTarget(target) }
const removeTarget = (namespaceId: string): Promise<void> =>
  replication?.removeTarget(namespaceId) ?? Promise.resolve()
const notifyAuthChanged = (): void => { replication?.notifyAuthChanged() }
const waitForLive = (namespaceId: string): Promise<void => new Promise<void>((resolve, reject) => {
  /* 现 L518–536 体一行不动 */
})
const service: PeerReplicationService = Object.freeze({
  get status(): PeerReplicationStatus { /* 现 L506–513 一行不动 */ },
  get addTarget() { return addTarget },
  get removeTarget() { return removeTarget },
  get notifyAuthChanged() { return notifyAuthChanged },
  get waitForLive() { return waitForLive },
  get stop() { return stop },
})
```

注：`status` getter 返回的快照对象（含 `getNamespaceState` 函数成员）是**方法返回值**而非服务表面（ADR 0023 L41），不改；guard-proxy 对非函数成员原样透传，快照对象不经顶层包装。

#### S4 `systemClock`（system.ts L9–11）

模块级单例——闭包提升到**模块顶层**（SA6 约束 1 明示允许；无实例状态，单例语义不变）：

```ts
/** 稳定闭包（ADR 0023）：模块级单例提一次，getter 恒返回同一函数实例。 */
const nowImpl = (): number => Date.now()

export const systemClock: Clock = Object.freeze({
  get now() { return nowImpl },
})
```

#### S5 `ManualClock`（manual.ts L32–53）

闭包提升到**工厂作用域**（捕获 per-instance `let current`——不得提到模块作用域，否则跨实例串状态）；成员序 now/set/advance 保持（键面断言锚）：

```ts
export function createManualClock(initialMs = 0): ManualClock {
  let current = assertTime('initialMs', initialMs)
  // 稳定闭包（ADR 0023）：工厂作用域内各提一次，捕获本实例 current。
  const now = (): number => current
  const set = (timeMs: number): void => {
    current = assertTime('timeMs', timeMs)
  }
  const advance = (deltaMs: number): void => {
    /* 现 L40–50 体一行不动（loud 校验语义不变） */
  }
  return Object.freeze({
    get now() { return now },
    get set() { return set },
    get advance() { return advance },
  })
}
```

### 7.3 稳定闭包纪律（可执行不变量）

1. getter 每次访问返回**同一**闭包实例：`service.m === service.m` 恒真；跨访问引用缓存（`const open = service.open`）语义不变。
2. 每服务实例恰一次提升（作用域表：S1 工厂 `createRegistryInternal`、S2/S3 `apply`、S4 模块顶层、S5 工厂 `createManualClock`）；禁止 getter 内联函数表达式（含 IIFE、bind 产物）。
3. teardown 引用同一性：hub/peer `ctx.effect` 的 `yield stop` 引用即 L421/L492 的 const 实例——reverse-yield 次序（先 revoke 后 stop 的 Cordis 排序语义）不变（plugin.ts L438–445 / L540–545）。
4. `shutdown` exact-same-Promise：非 async 闭包返回缓存的 `shutdownPromise`（含已 reject 实例）；`p.shutdown() === first` 恒真。
5. 验收锚：三新测试文件断言 `service.m === service.m`（§12.1）。

### 7.4 冻结姿态（目标描述符 + 对照）

变换 + `Object.freeze` 后，每个改造成员的目标描述符：

```text
{ get: [Function], set: undefined, enumerable: true, configurable: false }   // 无 value 槽
```

| 姿态 | 数据属性 + freeze（改前） | 访问器 + freeze（目标） | 验收锚 |
|---|---|---|---|
| `service.m = fn` 赋值 | 拒（non-writable） | 拒（访问器无 setter → strict TypeError） | 姿态断言块 |
| `Object.defineProperty(service, m, {...})` 重定义 | 拒 | 拒（non-configurable → TypeError） | 姿态断言块 |
| strict `delete service.m` | 拒 | 拒 | 姿态断言块（SA6 模型探针已验证） |
| 键面/枚举性 | enumerable、键序=成员序 | 不变（字面量 getter 默认 enumerable + 成员序保持） | `clock-contract.test.ts` L71/L111 保持绿 |
| `Object.isFrozen` | true | true | L72/L112 保持绿 |
| guard-proxy 消费 | 抛不变量 TypeError | 合法（带 getter 访问器不受 `[[Get]]` 不变量约束） | 三新测试文件 |
| `JSON.stringify` | 函数值成员被省略 | 同（getter 调用得函数值仍被省略）——无漂移 | 无既有断言，行为等价 |

### 7.5 主要备选方案（未选择及原因）

| 备选 | 否决原因 |
|---|---|
| DSH 侧 facade 门面服务 | ADR 0023 L83 已否决：双发布面跟进债、只治自家服务 |
| DSH fork 修改沙箱守卫（对冻结方法跳过包装） | ADR 0023 L84 已否决：无法提回上游、累积 host-core 分歧债；本 ADR 落地后 fork 整体回退 |
| nomicore 改 class + 原型方法 | ADR 0023 L85 已否决：闭包封装需改私有字段、diff 大、原型共享可变、姿态更弱 |
| 去掉顶层 `Object.freeze` | ADR 0023 L86 已否决：削弱深冻结完整性纪律；CONTEXT Avoid 红线 |
| 用 `Object.defineProperty` 逐成员构造访问器（替代字面量 getter） | 本设计否决：diff 更大、失去字面量成员序与默认 enumerable 的直接性；ADR L54–59 的字面量 getter 是钦定范式 |
| 共享 guard-proxy 测试 helper 模块 | AC6 / ADR L90 明令禁止新建共享测试设施；每包内联复制约 10 行 |

### 7.6 guard-proxy 回归覆盖（三文件、包内复制 helper、三重对照）

**新增三个测试文件**（路径由 SA6 契约 §12.5 钉死，命中 `vitest.config.ts` include glob，同目录兄弟文件在基线实跑被收集）：

| 包 | 新增测试路径 | 覆盖服务 | 组合 seam（既有模式） |
|---|---|---|---|
| `packages/clock` | `test/clock-guard-proxy-consumption.test.ts` | `systemClock` + `ManualClock` | 直接 import `../src/index.js` / `../src/testing.js`；裸 `Context`（`createSystemClockPlugin`/`createManualClockPlugin` 视用例需要） |
| `packages/namespace-registry` | `test/registry-guard-proxy-consumption.test.ts` | `nomicoreRegistry` | 对齐 `registry-plugin.test.ts` 测试 22（L165–180）：`createInstancePlugin` + `createManualClockPlugin` + `createFakeTimerPlugin(createRegistryTestScheduler())` + `createMemoryPersistencePlugin` + `createNamespaceRegistryPlugin`，`requireNomicoreRegistry(ctx)` |
| `packages/ws-replication` | `test/ws-replication-guard-proxy-consumption.test.ts` | Hub + Peer | 对齐 `ws-replication-plugin.test.ts` `dependencies()`（L17–30）：`provideInstance`/`provideClock`/`provideNomicoreRegistry` + timer shim；Hub 用 `overrides.listen` stub、Peer 用 `dial` stub |

**helper（每包内联复制，与 SA6 契约 §12.3/附录 A 逐字同款，约 10 行）**：

```ts
function guardProxy<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver)
      if (typeof value !== 'function') return value
      // DSH cordis-host-runner 语义：为每个函数成员返回新的包装闭包
      return (...args: unknown[]) => Reflect.apply(value, receiver, args)
    },
  }) as T
}
```

**每文件必备内容**（设计需求，SA3 落地）：

1. **敏感性正控**：同一 helper 套 `Object.freeze({ now: () => 1 })`，断言访问 `now` 抛 `TypeError`——证明 helper 真的在包装、断言非空洞绿。
2. **诚实 Proxy 负控**：`get` 返回实际值 → 访问同一成员不抛（证明失败不来自 Proxy/冻结本身）。
3. **被测断言**：guard Proxy 套真实服务 → 逐成员（AC2 清单：hub `status`/`requestReauth`/`stop`；peer `status`/`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive`/`stop`；registry 7 成员；clock 2 对象全成员）访问不抛 + 调用行为直通（行为断言采用 SA6 契约 §12.2 十四行表：如 `p.open(...) 与直连 deep-equal`、`p.shutdown() === first`、manual 错误语义透传 `RangeError`/`TypeError`、`waitForLive` 用注入 timer + `stop()` 触发 settle、无真实 sleep/轮询）。
4. **稳定闭包断言**：`service.m === service.m`（同实例同一闭包）。
5. **姿态断言组**（每个改造成员，SA6 §12.4 断言块）：

```ts
const d = Object.getOwnPropertyDescriptor(service, member)!
expect('value' in d).toBe(false)          // 访问器，无 data 槽
expect(typeof d.get).toBe('function')     // getter 返回稳定闭包
expect(d.set).toBeUndefined()             // 无 setter：赋值拒绝
expect(d.configurable).toBe(false)        // non-configurable：重定义拒绝
expect(d.enumerable).toBe(true)           // 枚举性不变
expect(Object.isFrozen(service)).toBe(true)
expect(() => { (service as any)[member] = () => 1 }).toThrow(TypeError)   // ESM strict
expect(() => Object.defineProperty(service, member, { value: () => 1 })).toThrow(TypeError)
```

**禁止**（SA6 §12.3 纪律，设计采纳）：skip/only/todo、env override、fallback、吞错、宽松断言（如仅 `toBeDefined()`）、源码字符串/正则断言代替运行时行为观察。

### 7.7 AC4 审计结论承接（无需更新既有断言的分支）

本设计在 HEAD 复核 SA6 §12.4 审计：`grep -rn "\bwritable\b" packages/clock packages/namespace-registry packages/ws-replication` 命中恰 2 处——`types.ts:518`（文档注释词）、`registry.ts:766`（`clonePlainData` 数据载荷 `writable: false`）。**三包不存在针对服务成员的 `writable === false` 形态断言** → AC4 走「审计结论记录在案」分支：既有形态断言即 `clock-contract.test.ts` L70–73/L109–113 的 `Object.keys` + `Object.isFrozen`，访问器形态下保持绿灯（§7.4）；**SA3 须把本审计结论写入实现说明**。不新增任何对既有测试文件的形态断言改写。

---

## 8. 接口、状态机和数据流

**接口**：五个公共接口（`Clock`/`ManualClock`/`HubReplicationService`/`PeerReplicationService`/`NamespaceRegistry`）零改动——接口以属性签名描述方法，不区分数据/访问器（ADR 0023 L70）。运行时 export keys（含 `registry-surface.test.ts` 九键断言、clock 双入口导出面）零变化。

**状态机**：无状态机变化。registry 三相接纳态（running → shutting-down → stopped）、hub/peer 连接/通道 FSM、idle timer、`stopPromise ??=` 一次性结算、`liveWaits` 结算——全部在闭包体内一行不动，捕获作用域不变。

**数据流路线**（变更仅在第 2 跳的属性形态；无跨进程/持久化/wire 边界变化）：

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| 1. 服务构造与发布（无变化） | Host 装配（plugin apply / 工厂调用） | 工厂/apply 内 `Object.freeze({ getters })` 构造服务对象（形态变、身份不变） | `ctx.provide(<service 名>, service)`——名与对象恒等性不变 | Cordis 内存 service registry | `ctx.get` / `require*` 返回同一冻结对象 | 消费方取得的服务实例与改造前同一构造点产出 | 构造期门禁（assertClockShape 等）不变；teardown reverse-yield 不变 | 三新文件组合 seam + 既有 plugin 测试 |
| 2. 成员读取（形态变化、语义不变） | 任意消费方 `service.m`（含 guard Proxy `get` 陷阱 `Reflect.get`） | 无写入 | data property 查找 → accessor `[[Get]]` → getter（O(1)，ADR L79）→ 返回稳定闭包 | 无 | 消费方拿到函数值（每实例恒 SameValue） | `service.m === service.m`；guard Proxy 下访问不抛（不变量不再适用）；`typeof clock.now === 'function'` 保持 | getter 体只 `return` const，不可抛；赋值/重定义/strict delete 全拒（TypeError） | §7.4 姿态断言 + §7.6 三重对照 |
| 3. 构建产物（新增 getter 语法） | `pnpm pack:local` → `scripts/build-package.mjs` → tsc | `packages/*/dist`（ES2022：getter 原生保留，无 downlevel 变形） | tarball 打包 `dist`（`files: ["dist"]`） | `artifacts/local-packages/*.tgz` + `manifest.json` | DSH 侧 `nomicore-host` 重建消费（仓外，本仓边界止于 tarball 含访问器形态产物） | 三 tgz 可构建、dist 含 getter 形态 | 构建失败即门禁红，无静默回退 | AC8：`pnpm pack:local` exit 0 + 三 tgz 在场 |

---

## 9. 错误、恢复、并发和幂等

- **无新错误路径**：getter 体只返回 const 闭包，不可抛；方法体一行不动 ⇒ 全部领域错误语义（issue 信封、branded fatal、manual clock 的 TypeError/RangeError loud 校验、hub/peer stop 结算路径）逐字保持。
- **失败语义不变**：异常路径不新增失败类型；正常路径不变量（冻结姿态）缺失时 fail loud——赋值/重定义/strict delete 在 ESM strict mode 下仍抛 `TypeError`（由 non-writable data 变为 getter-only accessor + non-configurable，两者均 TypeError，调用方可观察结果不变）。
- **并发**：无并发面变化。getter 每次访问一次 O(1) 调用（ADR L79 判定成本可忽略）；闭包内状态（`stopPromise ??=`、`shutdownPromise` 缓存、`liveWaits`）访问序不变。
- **幂等**：`shutdown` exact-same-Promise（含 reject 实例）、hub/peer `stop` 缓存 Promise、registry `getStatus` 恒三相冻结常量——全部经「同一稳定闭包」保持（§7.3）。
- **恢复/回滚**：纯机械 diff，`git revert` 即回 data-property 形态；无持久化状态、无 schema、无 wire、无数据迁移。
- **资源所有权**：服务对象仍由构造点唯一拥有；Cordis provide/revoke 所有权与 fiber dispose 清理不变；DSH 侧 Proxy 不取得所有权（透传 + 包装闭包）。

---

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `assertClockShape`（registry 构造期门禁） | `typeof clock.now !== 'function'`（属性读取 + typeof） | getter 返回稳定闭包 ⇒ `typeof` 仍 `'function'`，门禁通过 | **无**（不得借机改文案/顺序） | registry.ts L620–628；SA8 决议表 |
| peer plugin Clock 包装 | `clock: { now: () => clock.now() }` | 属性读取经 getter 取闭包后调用，行为不变 | 无 | plugin.ts L482 |
| `assertPersistenceHostDependencies` | `requireClock(ctx)` 取服务 | 同一对象，形态变化不可观察 | 无 | persistence/src/service.ts L27 |
| yjs-server Host 诊断 | `now: () => requireClock(this.ctx).now()` | 同上 | 无 | apps/yjs-server/src/app.ts L281 |
| Cordis `ctx.provide`/`ctx.get`/`require*` | 存取冻结服务对象 | 对象身份与发布名不变 | 无 | contract.ts L29–44、plugin.ts L92–94 |
| 既有三包测试（属性读取/调用/键面/isFrozen） | 直接成员访问 | 经 getter 取同一闭包；键面与枚举性不变 | 无（全部保持绿） | clock-contract.test.ts L70–73/L109–113；registry-plugin.test.ts；ws-replication-plugin.test.ts |
| `registry-surface.test.ts` 导出面审计 | 运行时 export keys 恰九个 | 导出面零变化 | 无 | registry-surface.test.ts L57 起 |
| DSH cordis-host-runner guard Proxy（仓外） | 函数成员访问抛 Proxy `[[Get]]` 不变量 TypeError（SA6 实跑红） | 访问器成员不受不变量约束 ⇒ 合法访问 + 包装闭包调用直通 | 仓外消费方零改动（fork 守卫回退属 AC8 仓外联动） | ADR 0023 L8–26；probe log |
| 实现角色（SA3） | — | 按 §7.2 规格实施四源文件机械变换 + 三新测试文件 | 4 源文件 + 3 测试文件 | §11 |

无未覆盖调用方：消费侧审计（§2.2）证明仓内对五服务的消费全部为属性读取/调用，无 descriptor/展开/克隆/spy 消费。

---

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/clock/src/system.ts` | `nowImpl` 模块级提升 + `systemClock` 字面量改 getter（§7.2 S4） | S4 服务表面访问器化 |
| `packages/clock/src/manual.ts` | `now`/`set`/`advance` 工厂作用域提升 + 字面量改 getter（§7.2 S5） | S5 服务表面访问器化 |
| `packages/ws-replication/src/plugin.ts` | hub：`requestReauth` 提升 + `requestReauth`/`stop` 改 getter；peer：四内联箭头提升 + 全函数成员改 getter；`status` getter 与 `stop` const 不动（§7.2 S2/S3） | S2/S3 服务表面访问器化 |
| `packages/namespace-registry/src/registry.ts` | 七方法闭包提升至 `runShutdown` 后 + registry 字面量改 getter（§7.2 S1）；**仅此范围** | S1 服务表面访问器化 |
| `packages/clock/test/clock-guard-proxy-consumption.test.ts` | 新增：helper + 三重对照 + 姿态组 + 稳定闭包断言（§7.6） | AC3/AC5/AC6 回归 |
| `packages/namespace-registry/test/registry-guard-proxy-consumption.test.ts` | 新增：同款（组合 seam 对齐 registry-plugin.test.ts 测试 22） | AC1/AC5/AC6 回归 |
| `packages/ws-replication/test/ws-replication-guard-proxy-consumption.test.ts` | 新增：同款（seam 对齐 ws-replication-plugin.test.ts `dependencies()`） | AC2/AC5/AC6 回归 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/namespace-registry/src/registry.ts` **L763–772（`clonePlainData`）** | 同文件内的数据载荷快照 `writable: false` defineProperty | 数据快照纪律（JSON 域），非服务表面；SA8 §8.4 明令不误伤（文件在 ALLOW 内，此为文件内子范围排除） |
| `packages/namespace-runtime/src/runtime.ts`（`copyFrozen` 族） | 数据载荷冻结 | 同上（SA8 Frozen surfaces 第 8 行） |
| `packages/namespace-registry/src/types.ts`、`packages/clock/src/contract.ts`、`packages/ws-replication/src/plugin.ts` **接口区块（L35–56）** | 公共 TS 类型面 | AC5 类型面零变化（接口不区分数据/访问器） |
| `packages/instance/src/index.ts` | 纯数据冻结服务 | ADR L37 排除；天然合规 |
| `packages/persistence/src/memory.ts`、`file.ts`、`service.ts`、`testing.ts` | class 原型方法 / 未冻结 fake timer shim | ADR L38 排除；SA8 §8.5 范围外备案 |
| `packages/ws-replication/src/testing.ts`（`decorateLease` L44 冻结字面量） | lease 返回值装饰 | ADR L41：方法返回值非服务表面，不得顺手改造 |
| `packages/namespace-registry/src/create-diagnostic.ts`（`NOOP_DIAG`） | 内部诊断 sink | ADR L41/L78；非服务表面 |
| `CONTEXT.md`、`docs/adr/**`、`docs/protocols/instance-replication-v1.md` | 术语/决策/wire 面 | SA8 §6：术语已与 ADR 同步，零文档演进；wire 零触碰 |
| `vitest.config.ts`、`.github/workflows/ci.yml`、`scripts/**`、三包 `package.json` | 测试发现/门禁/构建配置 | include glob 已命中新路径；构建链零变化（ES2022 保留 getter） |
| 任何新建共享测试 helper / `test/utils.ts` 类设施 | guard-proxy helper 复用诱惑 | AC6 / ADR L90 明令包内复制 |
| `apps/**`、`domains/**`、其余 `packages/**` | 消费方/无关包 | 消费侧零改动（§10） |

---

## 12. 验收与验证映射

### 12.1 需求 → 测试落点

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 registry 访问器形态 + guard-proxy 消费 | HEAD 7/7 成员访问 THROW（probe） | `registry-guard-proxy-consumption.test.ts`：真实组合 + guard Proxy 逐成员访问/调用 + 行为直通（open 结果 deep-equal、`getStatus()` 恒等常量、`shutdown()` exact same Promise）+ 姿态组 + 稳定闭包 | 全绿；`Object.isFrozen` 仍 true |
| AC2 Hub/Peer 覆盖清单成员访问 | hub `requestReauth`/`stop`、peer 5 成员 THROW；`status`×2 已绿 | `ws-replication-guard-proxy-consumption.test.ts`：hub `status`/`requestReauth`/`stop`、peer `status`/`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive`/`stop` 全覆盖；`waitForLive` settle 用注入 timer + `stop()`（SA6 §12.2 #13） | 全绿；`status` 两例不得回归 |
| AC3 clock 双对象 + isFrozen 保持 | systemClock `now`、manual 3/3 THROW | `clock-guard-proxy-consumption.test.ts`：bracket 断言（`before <= p.now() <= after`）、manual set/advance/错误语义透传（`set(NaN)` RangeError、`set('1')` TypeError、失败后读数不变）；既有 L70–73/L109–113 不动 | 全绿 |
| AC4 形态断言审计 | 三包无服务成员 `writable === false` 断言（本设计 HEAD 复核恰 2 处 src 命中、均非服务成员断言） | 无测试改动；审计结论写入 SA3 实现说明（§7.7） | 既有键面/isFrozen 断言保持绿 |
| AC5 姿态 + 类型面 | 基线 root typecheck 绿 | 三文件姿态断言组（§7.6 第 5 项）+ root `pnpm typecheck` + 既有 `*-test-d.ts` | 姿态断言绿；接口零 diff |
| AC6 helper 包内复制 | 无 | 三文件内联 `guardProxy`（§7.6 helper 逐字同款） | 无新增共享测试模块/导出 |
| AC7 门禁 | 基线三包 120 文件 1010 用例 + root typecheck 绿 | §12.3 命令全集 | 全绿 |
| AC8 tarball | 基线 pack:local 14 tgz 绿 | `pnpm pack:local` | 三 tgz 在场且 dist 含 getter 形态产物 |
| 风险：getter 内联闭包 | — | `service.m === service.m` 断言 | 恒真 |
| 风险：成员序漂移 | — | 既有 `Object.keys` 键面断言 | 键面不变 |

### 12.2 红→绿流程纪律（SA6 §13 采纳）

SA3 须先落地三个测试文件并在 **HEAD（改造前）** 复跑捕获红（预期同 SA6 §5 表：18 函数成员访问抛同型 TypeError、`status`×2 绿），再实施 §7.2 改造转绿；不得跳过红捕获直接声称红→绿。

### 12.3 验证门（实现完成后必须全部通过）

```bash
# 新文件显式运行（防文件失配静默假绿——CI 先例 ci.yml L80/L114–122）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck \
  packages/clock/test/clock-guard-proxy-consumption.test.ts \
  packages/namespace-registry/test/registry-guard-proxy-consumption.test.ts \
  packages/ws-replication/test/ws-replication-guard-proxy-consumption.test.ts \
  --passWithNoTests=false

pnpm --filter @nomicore/clock typecheck
pnpm --filter @nomicore/namespace-registry typecheck
pnpm --filter @nomicore/ws-replication typecheck
pnpm typecheck          # root 14 tsc project
pnpm test               # root vitest run --typecheck 全集
pnpm pack:local         # 三 tgz + manifest.json（AC8）
```

---

## 13. 风险、回滚和残余问题

| 风险 | 等级 | 缓解 | 可重试/回滚 |
|---|---|---|---|
| 平移时人为改写方法体/注释 | 中 | §7.2 R3「一行不动」；评审 diff 只允许声明形态变化（方法简写/内联箭头 → const + getter） | git revert 即回滚；无状态迁移 |
| 成员声明序漂移 → `Object.keys` 键面红 | 低 | §7.2 R2 成员序保持；既有键面断言锁定 | 可 |
| getter 内联函数表达式（违反稳定闭包） | 中 | §7.3 纪律 + `service.m === service.m` 断言 | 可 |
| 提升作用域错误（ManualClock/registry/hub/peer 提到模块级 → 跨实例串状态；或捕获未初始化变量） | 中 | §7.2 作用域表逐服务钉死；S5 实例状态捕获为最高风险点，多实例测试（createManualClock ×2 隔离）在既有用例覆盖 | 可 |
| TS contextual typing 丢失 → implicit any / 签名漂移 | 低 | §7.2 R4 显式注解纪律；root typecheck 门禁 | 可 |
| 误伤同文件 `clonePlainData` `writable: false` | 低 | §11 文件内子范围 DENY + diff 复核 | 可 |
| dist 产物 getter 变形 | 极低 | tsconfig target ES2022 原生保留 getter（无需 polyfill/downlevel）；AC8 tarball 构建验证 | 可 |

**任务内必要条件（非 follow-up）**：三个新测试文件、四个源文件改造、§12.3 验证门、AC4 审计结论入实现记录——全部属本票交付，缺一不可。

**残余 / follow-up（明确非本票义务）**：

1. DSH 侧 `nomicore-host` 重建、revision 切换 live reload、fork 守卫回退——仓外联动（AC8 后半；ADR L93）。
2. DSH 沙箱对「任意冻结服务」的一般性缺陷——host 侧议题（ADR 0023 残留节 L95–97）。
3. 未来新增对象字面量服务的访问器构造纪律由 code review 执行（ADR 已冻结为纪律；可选的 lint 规则化属独立改进，非本票必要条件）。

---

## 14. 评审修订映射

`wiki/raw/task_issue-330_sa2_review.md` 不存在（本 iteration 无评审输入），无适用 finding 需要映射。后续如出现评审输入，按 skill 规程在本节逐条映射并在原位修订全文。

---

## 15. 是否需要设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）**。理由：本设计变更五个公共 Cordis 服务对象的**运行时属性形态**（公共 API 运行时面）与 plugin `apply` 内的构造/闭包提升点（生命周期构造面）；SA8 冲突报告 §10 已明示 `requiresConflictRecheck=true`。虽目标形态由已接受的 ADR 0023 完整规定且本设计零决策演进，实现 diff 仍须按 SA8 §5 Frozen surfaces 逐项复核：

1. Cordis service 名（4 名）零变化。
2. 五接口 TS 类型面零 diff。
3. `Object.freeze` 保留；赋值与 `defineProperty` 重定义仍拒；getter 返回同一稳定闭包。
4. 键面/枚举性断言保持绿（clock-contract.test.ts L71/L110）。
5. 方法体/状态机一行不动；`shutdown` 非 async、exact-same-Promise；hub/peer `stop` 缓存 Promise 语义。
6. teardown reverse-yield 次序（plugin.ts L438–445/L540–545）不变。
7. issue/status 信封与冻结常量不变。
8. `clonePlainData`/`copyFrozen` 的 `writable: false` 未被触碰。
9. ManualClock 仅经 `@nomicore/clock/testing`；无新建共享测试设施。
10. wire 协议零触碰。

复核证据源：实现 diff + 三新测试文件姿态断言组 + §12.3 验证门输出。
