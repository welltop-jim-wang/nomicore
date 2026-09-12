# SA6 诊断与验收契约 — issue #330（nomicore 服务表面 getter 化 / ADR 0023 机械落地）

- 派发：`sa-7600cbc7-5963-4e8e-ad09-9d37264ebc98`（role `mabf-sa6`，phase `acceptance-contract`，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-330`（branch `mabf/issue-330`，HEAD `83581b3` = ADR 0023 文档落地 commit）
- 产出日期：2026-09-12
- 任务类型：**Feature**（ADR 0023 已接受但代码未落地 = 构造纪律兑现缺口；缺口以 HEAD 实跑的运行时 `TypeError` 呈现，不虚构 Bug 根因）
- 派发约束：**不实现代码、不新增测试**——红在 HEAD 由最小复现 probe 实跑证明（§5），契约断言与测试路径在本报告钉死（§12），由下游 SA3 实现。
- 上游：SA8 `clear`；Issue-comments REST 读取结果 `[]`（无 owner 要求、无可应用 comment ID/时间戳）。

## Verdict

`approve`

能力缺口（ADR 0023 构造纪律未落地）已证实：五个受影响服务表面在 HEAD 上经"get 陷阱返回包装闭包"的 guard Proxy 访问任一函数成员，**每次访问抛 ECMA-262 Proxy `[[Get]]` 不变量 `TypeError`**（`read-only and non-configurable data property ... did not return its actual value`），200/200 稳定；负控（诚实 Proxy、非冻结字面量、纯数据服务、class 原型方法、访问器形态模型）全绿，且访问器形态模型在 `Object.freeze` 下同时满足姿态表（赋值/`defineProperty`/strict delete 全部拒绝、键面与枚举性不变）。验收契约可执行、测试入口真实（root vitest include 命中 `packages/*/test/**/*.test.ts`；三包基线 120 文件 1010 用例 + root typecheck + 三包 local tarball 全绿）。可进入 SA1 设计 / SA3 实现。

---

## 1. 任务类型与输入

| 输入 | 路径 | 采用 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-330.md` | issue #330 正文 + AC1–AC8；`Comments` 空 |
| Issue-comments REST 快照 | 派发说明 | `[]`——无 owner 评论要求、无 comment ID/时间戳可应用 |
| SA8 冲突门禁 | `wiki/raw/task_issue-330_conflict_report.md` | Verdict `clear`；裁决分布 no-conflict 8 / implements-existing-decision 4 / evolution 0 / hard-conflict 0；`requiresConflictRecheck=true` |
| SA8 决议摘录 | `wiki/raw/task_issue-330_relevant_decisions.md` | ADR 0023 条款 + CONTEXT 术语 + 三包 AGENTS + 现状核验 1–8 |
| 母法 | `docs/adr/0023-proxy-consumable-frozen-service-surfaces.md` | 决策 L45–62、姿态对照 L64–74、实现注意 L78、验收 L90–93 |
| 术语面 | `CONTEXT.md` L129–131 | 「服务表面」+ Avoid 两条红线（已与 ADR 同步，零文档演进） |
| 现状实现锚 | `packages/namespace-registry/src/registry.ts` L2179–2281、`packages/ws-replication/src/plugin.ts` L431–445/L505–545、`packages/clock/src/system.ts` L9–11、`packages/clock/src/manual.ts` L34–52 | 五处冻结字面量服务表面 |
| 现存测试 | 三包 `test/` 全集（clock 3 文件 / registry 44 文件 / ws-replication 73 文件） | 基线与测试 seam |
| 运行入口 | `vitest.config.ts`、`package.json`、`.github/workflows/ci.yml`、`scripts/package-catalog.mjs` | 测试发现、门禁、tarball 范围 |

本 iteration 无 SA1 设计产物。凡 ADR 0023 留出的实现自由度（helper 形态、测试文件命名、断言强度），本契约在 §12.3 钉死；SA1/SA3 若另有选择须先原位修订本契约。

## 2. Owner 评论映射

无 owner 评论：REST Issue-comments 读取为 `[]`，不存在评论来源的 override 或附加义务。本契约全部义务 = issue #330 正文 AC1–AC8 + ADR 0023（SA8 判定 4 项 `implements-existing-decision`）。AC → 契约落点见 §12.1。

## 3. SA8 约束采纳

- **裁决无冲突**：8 项 no-conflict + 4 项 implements-existing-decision；无 evolution-required、无 hard-conflict、无 override。本任务 = ADR 0023 的纯兑现。
- **Frozen surfaces（SA8 §5，下游实现后须逐项复核）**：
  1. Cordis service 名不变：`nomicoreRegistry` / `nomicoreHubReplication` / `nomicorePeerReplication` / `clock`。
  2. 公共 TS 类型面零变化：`NamespaceRegistry`（`packages/namespace-registry/src/types.ts` L712）、`HubReplicationService`（`packages/ws-replication/src/plugin.ts` L35）、`PeerReplicationService`（plugin.ts L48）、`Clock`（`packages/clock/src/contract.ts` L14）、`ManualClock`（`packages/clock/src/manual.ts` L17）；接口不区分数据/访问器。
  3. 冻结姿态：五对象 `Object.freeze` 保留；赋值与 `defineProperty` 重定义仍拒；getter 返回**同一稳定闭包**。
  4. 枚举性：`Object.keys(systemClock) === ['now']`、ManualClock `['now','set','advance']`（`clock-contract.test.ts` L71/L110）；`Object.isFrozen` 断言（L72/L112）保持绿灯。
  5. 方法体/状态机一行不动；`registry.shutdown()` 不得 async 化（L2262–2279 exact-same-Promise 幂等锚）；`shutdown` 非 async、`hub/peer stop` 缓存 Promise 语义不变。
  6. plugin teardown：`ctx.effect` 内 provide-revoke 与 stop 的 reverse-yield 次序（`plugin.ts` L438–445 / L540–545）不变。
  7. Registry issue/status 信封与冻结常量不变（非服务表面，不访问器化）。
  8. 数据载荷快照纪律：`registry.ts` L763–768 `clonePlainData` 与 `namespace-runtime` `copyFrozen` 的 `writable:false` **不得**被访问器化误伤。
  9. testing 导出边界：`ManualClock` 仅经 `@nomicore/clock/testing`；不新建共享测试设施。
  10. wire 协议零触碰（进程内 JS 构造面，非 wire 面）。
- **SA8 §8 非冲突提醒全部采纳**（稳定闭包、shutdown 不 async、AC4 审计分支、不误伤数据载荷、`persistence/src/testing.ts` fake timer 范围外、hub/peer `status` 已是 getter）。
- **`requiresConflictRecheck=true`**：实现 diff 需按上述 Frozen surfaces 逐项核对；本契约 §12.4 把姿态断言写成可执行门禁。

## 4. 环境与基线

- 运行时：Node v24.13.0；pnpm 10.28.2（corepack）；仓库零构建产物起步。
- 依赖：`pnpm install --offline --frozen-lockfile` → exit 0（16 workspace projects，65 包全部 store 复用；`packages/ws-replication/node_modules/@nomicore/{clock,instance,namespace-registry,persistence,replication-protocol}` 软链在场）。pnpm 提示 `esbuild` build script 被忽略——实测 `pnpm exec vitest --version` = 3.2.7、`tsx` 4.23.12 均可用，未影响任何门禁。
- **基线（HEAD `83581b3`，未做任何改动）**：

| 命令 | 结果 |
|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/clock/test packages/namespace-registry/test` | exit 0；**47 files / 475 tests passed；Type Errors: no errors** |
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/ws-replication/test` | exit 0；**73 files / 535 tests passed；Type Errors: no errors** |
| `pnpm typecheck`（root，14 个 tsc project） | exit 0（无输出） |
| `pnpm pack:local` | exit 0；`artifacts/local-packages/` 产出全部 14 tgz + `manifest.json`，含 `nomicore-clock-0.1.0.tgz`、`nomicore-namespace-registry-0.1.10.tgz`、`nomicore-ws-replication-0.1.5.tgz` |

- 测试入口：`vitest.config.ts` → `include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts']`，`maxWorkers: 1`，typecheck 子集 `packages/*/test/**/*.test-d.ts`。跨包解析走 `customConditions: ["nomicore-source"]`（`tsconfig.base.json`）与 `NODE_OPTIONS=--conditions=nomicore-source`，无需先 build。
- 探针运行入口（临时，已删）：`NODE_OPTIONS=--conditions=nomicore-source ../../node_modules/.bin/tsx .sa6-probe-issue-330.ts`（cwd `packages/ws-replication`，使 `@nomicore/*` 解析命中该包 node_modules 软链）。

## 5. 正例复现（能力缺口，HEAD 实测红）

- 最小复现 = 把 ADR 0023 L17 的 DSH 沙箱 `get` 陷阱语义落到约 10 行 guard Proxy，套在经真实 Cordis 组合取得的服务对象上，**只读取成员引用即触雷**：

```ts
function guardProxy<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver)
      if (typeof value !== 'function') return value
      // DSH cordis-host-runner：为每个函数成员返回新的包装闭包
      return (...args: unknown[]) => Reflect.apply(value, receiver, args)
    },
  }) as T
}
```

- 复现证据：`wiki/raw/task_issue-330_sa6_red_probe.log`（49 行 JSON 行；exit 0）。
- 逐成员红表（`outcome: THROW` = 访问即抛；错误均为 `TypeError`，message 含 `'get' on proxy: property '<m>' is a read-only and non-configurable data property on the proxy target but the proxy did not return its actual value`）：

| 服务（取得方式） | 当前成员描述符 | HEAD guard-proxy 访问结果 |
|---|---|---|
| `nomicoreRegistry`（真实组合：instance + manual clock + fake timer + memory persistence + `createNamespaceRegistryPlugin`，`ctx.get(NOMICORE_REGISTRY_SERVICE)`） | 7 成员全部 `{ kind: data, writable: false, configurable: false, enumerable: true }` | `open`/`create`/`importReplica`/`resetReplica`/`deleteNamespace`/`getStatus`/`shutdown` **7/7 THROW** |
| `nomicoreHubReplication`（真实组合 + stub listen） | `status` 已是 `{ kind: accessor, configurable: false, enumerable: true, get: function, set: undefined }`；`requestReauth`/`stop` 为 data | `status` **ACCESS_OK**（既有 getter）；`requestReauth`/`stop` **THROW** |
| `nomicorePeerReplication`（真实组合 + stub dial） | `status` 已是 accessor；`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive`/`stop` 为 data | `status` **ACCESS_OK**；其余 5 成员 **THROW** |
| `systemClock`（`@nomicore/clock`） | `now` 为 data | `now` **THROW** |
| `ManualClock`（`createManualClock()`，testing 导出） | `now`/`set`/`advance` 为 data | **3/3 THROW** |

- 复现摘要（log 行号）：registry 17–24；hub 34/36/37；peer 40/42–46；clock 7/9；manual 8/10–12；组合取得 registry 16。
- 稳定性：同一 trap 语义重复 200 次（每次新建 guard Proxy）：`systemClock.now` **200/200 THROW**（错误种类单一）。

## 6. 负控

全部为"相近但不应失败"对照，HEAD 实测绿（log 行号）：

| 负控 | 构造 | 结果 |
|---|---|---|
| 诚实 Proxy | `new Proxy(target, { get: (t,p,r) => Reflect.get(t,p,r) })`，套 `systemClock` / registry / hub / peer | 成员访问 **ACCESS_OK**（13/25/26/38/39/47/48）——证明失败不来自 Proxy/freeze 本身，而来自"陷阱返回值 ≠ 目标值" |
| 非冻结普通字面量 | `{ now: () => 42 }` + guard Proxy | ACCESS_OK + 调通 `now() === 42`（14/15）——非冻结 data 属性不受不变量约束 |
| 纯数据冻结服务 | `nomicoreInstance`（`instanceId`/`role`，ADR 排除行） | `isFrozen: true`、访问 **ACCESS_OK**、值原样（27–29） |
| class 原型方法 | `nomicorePersistence`（memory class 实例，ADR 排除行） | `isFrozen: false`、ownKeys 为数据字段、原型方法访问 **ACCESS_OK**（30–33） |
| 访问器形态冻结模型 | `Object.freeze({ get now() { return impl } })` + guard Proxy | 访问 ACCESS_OK、调通返回值 7、getter 目标侧稳定闭包、Proxy 侧每次新包装（规范允许）（2/4/5） |
| 敏感性对照（同一模型只改属性形态） | `Object.freeze({ now: impl })` vs `Object.freeze({ get now() {...} })` | data → **THROW**（3）；accessor → **ACCESS_OK**（4）——断言对属性形态敏感 |
| 姿态模型 | accessor 冻结模型 | 赋值 `TypeError: ... which has only a getter`；`defineProperty` `TypeError: Cannot redefine property`；strict `delete` `TypeError`；键面 `['now']`、`isFrozen: true`、仍可调用（6） |

## 7. 稳定性、规模与时序

- **确定性**：无并发、无真实 sleep、无系统时钟依赖（clock 走 manual/fake timer；ws 走 stub timer/dial）；五种失败均为同步、可重入的 `TypeError`。
- **重复率**：200 次独立 guard Proxy 访问 `systemClock.now` → 200 次同型 `TypeError`；同法访问 accessor 模型 → 0 次异常（log 49）。
- **规模/时序**：本次无规模或时序契约；访问器只增加一次 O(1) getter 调用（ADR L79 判定成本可忽略）。契约不设任何时间阈值断言；`waitForLive` 的 settle 必须用注入 timer + `stop()` 触发（§12.2），不得用真实 sleep 或轮询。
- **进程边界**：真实 Cordis `Context` 组合（非 mock 掉服务构造层）；registry 使用 memory persistence + fake timer；ws 使用 stub listen/dial + timer shim（包内既有 seam，见 `ws-replication-plugin.test.ts` `dependencies()` 模式）。

## 8. 能力缺口链

| 步 | 事实 | 证据 | 置信 |
|---|---|---|---|
| 症状 | DSH 会话级插件经 `ctx.get('nomicoreRegistry')` 取服务后，连读取方法引用都抛 `TypeError`，服务完全不可用 | ADR 0023 L8–13/L26；brief L17 | 高（ADR 来源；本仓可复现同型错误） |
| 直接故障点 | guard Proxy `get` 陷阱对函数成员返回**新包装闭包**，与目标属性实际值 `SameValue` 不符 | probe log 3/18–24；ECMA-262 Proxy `[[Get]]` 不变量 | 高（HEAD 实跑） |
| 触发条件 | 目标属性 = **自有的、不可写的、不可配置的数据属性**且陷阱返回值 ≠ 实际值 | probe 2/4/5 对照：同 freeze、仅属性形态不同 → 翻转 | 高（控制变量） |
| 最深根因（能力缺口） | nomicore 五个经 `ctx.provide` 发布的服务对象是冻结字面量 + data-property 方法；ADR 0023 的"函数成员一律访问器属性"构造纪律尚未落到代码 | `registry.ts` L2179；`plugin.ts` L431/L505；`system.ts` L9；`manual.ts` L34；probe descriptors 7/8/17/34/40 | 高（源码 + 运行时描述符） |
| 放大因素 | `Object.freeze` 使描述符 `configurable:false`+`writable:false`，不变量强制成立 → 每次成员访问必抛，非偶发 | probe 49（200/200） | 高 |
| 未证实假设 | DSH 沙箱 trap 是否绑定 `this`/传递 args 的精确实现；本契约按 ADR L17 语义等价复刻（本项目内所有服务方法都是 `this` 无关闭包，两种绑定行为下断言一致） | ADR L17；probe guardProxy | 中（外部实现不在本仓） |
| 排除项 | Cordis `provide/get` 机制、getter 成本、TS 类型面、wire 协议、class/纯数据服务 | §11 | 高 |

## 9. 因果实验

| 实验 | 控制 | 观察 | 结论 |
|---|---|---|---|
| E1 属性形态 | 同一 `Object.freeze`、同一函数体：`{ now: impl }` vs `{ get now() { return impl } }` | THROW vs ACCESS_OK | 故障由 data-property 形态导致 |
| E2 陷阱语义 | 同一冻结 data 对象：诚实陷阱 vs 包装闭包陷阱 | ACCESS_OK vs THROW | 故障由"返回值 ≠ 目标值"导致，非 Proxy 存在性 |
| E3 冻结 vs 非冻结 | 非冻结 `{ now: () => 42 }` + 包装陷阱 | ACCESS_OK | 不变量仅在 non-writable+non-configurable 时强制 |
| E4 排除面 | `nomicoreInstance`（自有纯数据）/ `nomicorePersistence`（原型方法） | ACCESS_OK | ADR 影响面表"不受影响"三行中的两行在仓内实测成立 |
| E5 目标形态可行性 | accessor 冻结模型 + 包装陷阱 + 姿态探针 | 访问/调通/赋拒/重定义拒/strict delete 拒/键面与 `isFrozen` 保持 | ADR 0023 姿态表在访问器形态下可达，`Object.freeze` 无需移除 |
| E6 敏感性 | E1 只改一个属性形态即可让断言翻转 | 红↔绿 | 契约断言对被测根因敏感（mutation 等价证据） |

## 10. 影响面

**改造面（5 个服务对象，4 生产 + 1 testing）：**

| 服务 | 构造点 | 现形态 | 需访问器化成员 | 备注 |
|---|---|---|---|---|
| `nomicoreRegistry` | `registry.ts` L2179–2281（`createRegistryInternal` 内） | 冻结字面量，7 方法全 data | `open` `create` `importReplica` `resetReplica` `deleteNamespace` `getStatus` `shutdown` | `shutdown` 非 async、exact-same-Promise；闭包须在工厂作用域内提一次 |
| `nomicoreHubReplication` | `plugin.ts` L431–437（`apply` 内 `service`） | `status` 已 getter；其余 data | `requestReauth` `stop` | `stop` 已是一次性闭包；禁止每次 getter 新建 |
| `nomicorePeerReplication` | `plugin.ts` L505–539（`apply` 内 `service`） | `status` 已 getter；其余 data | `addTarget` `removeTarget` `notifyAuthChanged` `waitForLive` `stop` | 同上；`waitForLive` 闭包捕获 `liveWaits` |
| `clock`（`systemClock`） | `system.ts` L9–11 | 冻结字面量，`now` data | `now` | 模块级单例，闭包可模块级提一次（单例语义不变） |
| `ManualClock`（testing 导出） | `manual.ts` L34–52（`createManualClock` 内） | 冻结字面量，3 成员 data | `now` `set` `advance` | 闭包必须在工厂作用域内提（捕获 `current` 状态） |

**关键实现约束（由本契约锁定）：**

1. 稳定闭包**每服务实例**提一次（registry/manual 在工厂函数体内，hub/peer 在 `apply` 内，systemClock 为模块单例）——禁止在 getter 内联新建函数表达式，禁止把带实例状态的实现提到模块作用域（会跨实例串状态）。
2. getter 返回同一闭包实例：`service.m === service.m` 恒真；跨访问引用缓存（`const open = service.open`）语义不变。
3. `Object.freeze` 保留；不得为可包装性去 freeze（CONTEXT Avoid）。
4. 方法体、参数/返回类型、`this` 无关性、状态机、teardown 次序、service 名、信封、wire 全部一行不动。

**消费侧影响（已审计，全部为属性读取，兼容访问器）：** `registry.ts` L620–628 Clock 形状门禁 `typeof clock.now === 'function'`、`plugin.ts` L482 `clock: { now: () => clock.now() }`、`persistence/src/service.ts` L27 `requireClock`、`apps/yjs-server/src/app.ts` L281 `requireClock(this.ctx).now()`。无服务对象 spread/`Object.assign`/`vi.spyOn`/`getOwnPropertyDescriptor` 消费。三包无任何服务成员的 `writable === false` 断言（§12.4）。

**明确不改（可验证排除面）：**

| 排除项 | 依据 | 验证 |
|---|---|---|
| `nomicoreInstance` | ADR L37；brief L21 | 纯数据冻结字面量（`instance/src/index.ts` L60–64）；probe 27–29 ACCESS_OK |
| `nomicorePersistence` | ADR L38 | class 实例、原型方法、非冻结；probe 30–33 ACCESS_OK |
| `timer` | ADR L39 | 上游 `@deepseek-ai/cordis-plugin-timer`，非本仓资产 |
| 服务方法返回值（`NamespaceLease`/`ReplicationSession`）与 issue/status 信封 | ADR L41 | 不经消费方顶层包装；`registry.ts` L465–591 常量不改 |
| `packages/ws-replication/src/testing.ts` L44 `decorateLease` 冻结字面量 | ADR L41（lease 返回值，非 `ctx.provide` 服务） | 保留；不得顺手改造 |
| 数据载荷冻结：`registry.ts` L763–768 `clonePlainData`、`namespace-runtime` `copyFrozen`、`create-diagnostic.ts` L121 `NOOP_DIAG` | ADR L78 + SA8 §8.4 | 内部 sink / JSON 域数据，非服务表面 |
| `persistence/src/testing.ts` L161–191 fake timer | SA8 §8.5 | 非冻结 plain 字面量 + 上游 `timer` shim；不受不变量约束 |
| wire 帧/状态机/错误码、`instance-replication-v1.md` | brief L21 + SA8 §3 | 零触碰 |
| 新共享测试设施 | ADR L90 | guard-proxy helper 每包内联复制（约 10 行） |

## 11. 排除的假设

1. **"这是 DSH 沙箱 bug，本仓无义务"**——ADR 0023 已接受并选择 nomicore 侧 getter 化（L81–86 明确否决了 DSH fork 与 facade 两条替代）；一般性沙箱缺陷才是 host 侧残留（ADR L95–97）。
2. **"`Object.freeze` 本身触发 TypeError"**——诚实 Proxy 在冻结对象上全绿（probe 13/25/38）；非冻结 data 也绿（14）；只有冻结 data + 包装陷阱组合触发（E1/E2）。
3. **"所有成员都要访问器化"**——hub/peer `status` 已是访问器（probe 34/40）；`nomicoreInstance`/`nomicorePersistence` 无需改造（probe 27–33）。
4. **"`Object.keys`/`isFrozen` 既有断言会因访问器化转红"**——字面量 getter 默认 enumerable；模型实测键面与 `isFrozen` 不变（probe 2/5/6），`clock-contract.test.ts` L71–72/L110–111 应保持绿。
5. **"deepFreeze 工具会误伤访问器"**——仓内 `deepFreeze`（`namespace-diagnostic-log/src/pipeline.ts`、`packages/vfsl/src/index.ts`、`apps/yjs-server/src/config.ts`）只消费诊断记录/编译缓存/config 数据，不消费五个服务对象（grep 实证）。
6. **"TS 类型面需要改"**——接口以属性签名描述方法，数据/访问器同型；改造不应改任何 interface（§12.4 门禁）。
7. **"`shutdown` 可以顺手 async 化"**——会破坏 AC12 exact-same-Promise（`registry.ts` L2262–2264 注释契约）；禁止。
8. **"测试可用源码字符串/正则断言 getter 形态"**——本契约禁止；形态必须经运行时描述符观察（§12.3）。

## 12. 验收契约与测试路径

### 12.1 契约总表（AC1–AC8 → 落点）

| Issue AC | 契约落点（测试路径） | 断言要点 | HEAD 预期（红/绿） | 目标预期 |
|---|---|---|---|---|
| AC1 registry 全函数成员访问器形态 + Cordis 取得后 guard-proxy 消费 | `packages/namespace-registry/test/registry-guard-proxy-consumption.test.ts` | 真实组合取 `nomicoreRegistry`；guard Proxy 访问 + 调用 7 成员不抛；行为直通；描述符姿态 | 7/7 成员访问 THROW（probe 18–24） | 全绿 |
| AC2 Hub/Peer 同款 + 各一款 guard-proxy 消费回归（既有插件 seam） | `packages/ws-replication/test/ws-replication-guard-proxy-consumption.test.ts` | Hub：`status`/`requestReauth`/`stop`；Peer：`status`/`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive`/`stop` | hub `requestReauth`/`stop` THROW、`status` 绿；peer 除 `status` 外 5/5 THROW（probe 36–37/42–46） | 全绿 |
| AC3 systemClock + ManualClock 同款 + guard-proxy 用例；既有 `Object.isFrozen` 保持绿 | `packages/clock/test/clock-guard-proxy-consumption.test.ts` | 两服务全部成员访问/调用；`Object.isFrozen` 与键面断言不动 | systemClock `now` THROW；manual 3/3 THROW（probe 9–12） | 全绿 |
| AC4 既有 data 属性形态断言更新为访问器形态；无则审计结论记录在案 | 审计结论见 §12.4；新姿态断言落在三个新测试文件 | 三包无服务成员 `writable === false` 断言 → 走"审计结论"分支 | 不存在此类断言 | 审计结论入实现记录；既有 `Object.keys`/`isFrozen` 保持绿 |
| AC5 `Object.freeze` 保留；赋值/`defineProperty` 重定义仍拒；TS 公共类型面零变化 | 三个新测试文件的姿态组 + root typecheck + 既有 `*-test-d.ts` | 描述符 `configurable:false`/`enumerable:true`/`get:function`/`set:undefined`/无 `value`；赋值与 `defineProperty` 抛 TypeError；interface 零改 | 姿态当前为 data 形态（红，若断言访问器形态） | 全绿 |
| AC6 测试 helper 为包内复制（约 10 行），不新建共享设施 | 三个新测试文件内联 `guardProxy` | 无新增共享测试模块/导出 | — | 全绿 |
| AC7 三包门禁 + root `pnpm typecheck` + `pnpm test` 全绿 | §12.6 命令 | 见 §4 基线与 §12.6 | 基线已绿 | 改造后仍绿 |
| AC8 三包 local tarball 可构建 | `pnpm pack:local` + `manifest.json` | 三 tgz 存在且包含 `dist/` 产物 | 基线已绿（§4） | 改造后仍绿 |

### 12.2 五服务逐成员契约（最小输入 / 可观察断言 / 旧实现 → 目标实现）

通用：`const p = guardProxy(service)`（service 取自 `@nomicore/*` 公共导出或 `ctx.get(<SERVICE>)`，见 §12.3）。“旧实现预期”= HEAD 实测（§5）；“目标实现预期”= 落地后必须通过。

| # | 服务 / 成员 | 最小输入 | 可观察断言（目标） | 旧实现预期 | 目标预期 |
|---|---|---|---|---|---|
| 1 | `systemClock.now` | 无 | 访问不抛；`const before = Date.now(); const r = p.now(); const after = Date.now();` → `before <= r <= after`（有限 number） | TypeError at access | 绿 |
| 2 | `ManualClock.now/set/advance` | `const c = createManualClock(100); p = guardProxy(c)` | 访问不抛；`p.set(250)` → `p.now()===250`；`p.advance(5)` → `255`；`p.set(NaN)` 仍 `RangeError`、`p.set('1')` 仍 `TypeError`（错误语义透传）；失败后读数不变 | 3/3 TypeError at access | 绿 |
| 3 | `nomicoreRegistry.open` | 组合后 `p.open({ userId: 'u' }, 'missing-ns')` | 访问不抛；结果与直连 `registry.open(...)` deep-equal（`{ ok:false, code:'NAMESPACE_NOT_FOUND' }`） | TypeError at access | 绿 |
| 4 | `nomicoreRegistry.create/importReplica/resetReplica/deleteNamespace` | 非法输入（如 `{}`） | 访问不抛；调用返回与直连同型 issue 信封（不新增状态副作用） | TypeError at access | 绿 |
| 5 | `nomicoreRegistry.getStatus` | 无 | 访问不抛；`p.getStatus() === registry.getStatus()`（冻结常量恒等锚） | TypeError at access | 绿 |
| 6 | `nomicoreRegistry.shutdown` | 无（测试末尾；先 `const first = registry.shutdown()`） | 访问不抛；`p.shutdown() === first`（exact same cached Promise，AC12 幂等锚）；`p.shutdown() === p.shutdown()`；`Object.isFrozen(registry)` 仍 true | TypeError at access | 绿 |
| 7 | `nomicoreHubReplication.status` | 组合后 | 访问不抛；`p.status` deep-equal 直连 `{ state:'ready', connections:0 }` | 已绿（已是 getter） | 绿（不得回归） |
| 8 | `nomicoreHubReplication.requestReauth` | `'peer-one'` | 访问不抛；`await p.requestReauth('peer-one')` resolves | TypeError at access | 绿 |
| 9 | `nomicoreHubReplication.stop` | 无（末尾；先 `const first = direct.stop()`） | 访问不抛；`p.stop() === first`（缓存 Promise 恒等）；随后 `ctx.fiber.dispose()` 排空、listener close 恰一次 | TypeError at access | 绿 |
| 10 | `nomicorePeerReplication.status` | 组合后 | 访问不抛；`p.status` deep-equal 直连；`connection ∈ ['connecting','handshaking']` | 已绿（已是 getter） | 绿（不得回归） |
| 11 | `nomicorePeerReplication.addTarget/notifyAuthChanged` | `{ namespaceId, localOwner:{userId:'owner'} }` / 无 | 访问不抛；调用不抛 | TypeError at access | 绿 |
| 12 | `nomicorePeerReplication.removeTarget` | `namespaceId` | 访问不抛；`await p.removeTarget(ns)` resolves | TypeError at access | 绿 |
| 13 | `nomicorePeerReplication.waitForLive` | `namespaceId` | 访问不抛；返回 Promise；`const w = p.waitForLive(ns); w.catch(()=>{})`；`await p.stop()` 后 `await expect(w).rejects.toThrow('peer replication stopped')`（注入 timer，无真实 sleep） | TypeError at access | 绿 |
| 14 | `nomicorePeerReplication.stop` | 无（末尾） | 访问不抛；`await p.stop()` resolves；service 在 drain 窗口内仍可按既有语义访问 | TypeError at access | 绿 |

### 12.3 guard-proxy helper 与负控纪律（SA6 钉死）

- **helper**：每包内联复制约 10 行（`get` 陷阱：函数成员 → 新包装闭包 `Reflect.apply(value, receiver, args)`；非函数成员原样返回；`as T`）。不得新建共享测试设施（AC6 / ADR L90）。
- **每条新用例必须含三重对照**：
  1. **敏感性正控**：同一 helper 套 `Object.freeze({ now: () => 1 })`，断言访问 `now` **抛 TypeError**——证明 helper 真的在包装、断言不是空洞的绿。
  2. **诚实 Proxy 负控**：`get` 返回实际值 → 访问同一成员不抛（证明失败不来自 Proxy/冻结本身）。
  3. **被测断言**：guard Proxy 套真实服务 → 访问/调用不抛 + §12.2 行为直通。
- **禁止**：skip/only/todo、env override、fallback、吞错、宽松断言（如仅 `toBeDefined()` 代替访问不抛）、源码字符串/正则断言代替运行时行为观察。
- **`this` 绑定纪律**：helper 用 `Reflect.apply(value, receiver, args)`；本仓五服务方法均为 `this` 无关闭包，直连与包装调用结果必须一致。
- **每服务实例稳定闭包**：断言 `service.m === service.m`（同实例同一闭包）；实现不得在 getter 内新建函数。

### 12.4 AC4 审计结论 + 姿态断言

- **AC4 审计结论**（HEAD 实测）：`grep -rn "\bwritable\b" packages/clock packages/namespace-registry packages/ws-replication | grep -v writableLength` 于探针在场时命中 3 处、探针删除后现存 2 处：`types.ts:518`（文档注释词）、`registry.ts:766`（`clonePlainData` 数据载荷 `writable:false`，非服务成员）。**三包不存在针对服务成员的 `writable === false` 断言** → 无既有形态断言需更新，走 AC4"审计结论记录在案"分支（须写入实现说明）。既有形态断言为 `clock-contract.test.ts` L71–72 / L110–111 的 `Object.keys` + `Object.isFrozen`，访问器形态下保持绿灯。
- **姿态断言（AC5，每个改造成员）**：

```ts
const d = Object.getOwnPropertyDescriptor(service, member)!
expect('value' in d).toBe(false)          // 访问器，无 data 槽
expect(typeof d.get).toBe('function')     // getter 返回稳定闭包
expect(d.set).toBeUndefined()             // 无 setter：赋值拒绝
expect(d.configurable).toBe(false)        // non-configurable：defineProperty 重定义拒绝
expect(d.enumerable).toBe(true)           // 枚举性不变
expect(Object.isFrozen(service)).toBe(true)
expect(() => { (service as any)[member] = () => 1 }).toThrow(TypeError)   // ESM strict
expect(() => Object.defineProperty(service, member, { value: () => 1 })).toThrow(TypeError)
```

- **TS 公共类型面零变化门禁**：`NamespaceRegistry`（`types.ts` L712）、`HubReplicationService`/`PeerReplicationService`（`plugin.ts` L35/L48）、`Clock`（`contract.ts` L14）、`ManualClock`（`manual.ts` L17）零 diff；`registry-surface.test.ts` 的"主入口运行时 export keys 恰九个"断言保持绿；既有 `*-test-d.ts` + root typecheck 绿。

### 12.5 测试路径与入口证据

| 包 | 新增测试路径（建议） | 覆盖服务 | 依赖 seam |
|---|---|---|---|
| `packages/clock` | `test/clock-guard-proxy-consumption.test.ts` | `systemClock` + `ManualClock` | 直接 import `../src/index.js` / `../src/testing.js`；`createSystemClockPlugin`/`createManualClockPlugin` + 裸 `Context` |
| `packages/namespace-registry` | `test/registry-guard-proxy-consumption.test.ts` | `nomicoreRegistry` | 真实组合（对齐 `registry-plugin.test.ts` 测试 22）：`createInstancePlugin` + `createManualClockPlugin` + `createFakeTimerPlugin(createRegistryTestScheduler())` + `createMemoryPersistencePlugin` + `createNamespaceRegistryPlugin`，`requireNomicoreRegistry(ctx)` |
| `packages/ws-replication` | `test/ws-replication-guard-proxy-consumption.test.ts` | Hub + Peer | 对齐 `ws-replication-plugin.test.ts`：`provideInstance`/`provideClock`/`provideNomicoreRegistry` + timer shim；Hub 用 `overrides.listen` stub、Peer 用 `dial` stub |

- 入口命中：`vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', ...]` 与三条路径逐一匹配；三条路径中已有同目录兄弟文件在基线实跑被收集（§4：47 + 73 文件）。
- 若测试文件被删/改名，CI 用 `--passWithNoTests=false` 防静默假绿（`.github/workflows/ci.yml` L80/L114–122 先例）。
- 运行命令（实现后）：

```bash
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck \
  packages/clock/test/clock-guard-proxy-consumption.test.ts \
  packages/namespace-registry/test/registry-guard-proxy-consumption.test.ts \
  packages/ws-replication/test/ws-replication-guard-proxy-consumption.test.ts \
  --passWithNoTests=false
```

### 12.6 验证门（实现完成后必须全部通过）

```bash
pnpm --filter @nomicore/clock typecheck
pnpm --filter @nomicore/namespace-registry typecheck
pnpm --filter @nomicore/ws-replication typecheck
pnpm typecheck                                        # root 14 project
pnpm test                                             # root vitest run --typecheck（全部 packages/domains/apps）
pnpm pack:local                                       # 三 tgz + manifest.json（AC8）
```

范围外说明：AC8 后半"DSH 侧 `nomicore-host` 重建 + revision 切换（live reload）+ 回退 DSH fork 守卫"属**仓外联动**，本仓验收边界止于 tarball 可构建且 `dist/` 含访问器形态产物（tsc target ES2022 保留 `get`）。

## 13. 红/绿证据

- **红（HEAD 实测，本报告 §5）**：5 个服务共 20 个成员（18 个 data-property 函数成员 + 2 个已是访问器的 `status`）；**18/18 函数成员**在 guard Proxy 访问处抛同型 `TypeError`；`status`×2 已绿。失败原因是 PR 目标断言处的真实运行时行为（`read-only and non-configurable data property ... did not return its actual value`），非环境/fixture/超时/入口错误——诚实 Proxy 与全部排除面负控绿。
- **绿（基线）**：三包 120 文件 1010 用例、root typecheck、pack:local 全绿（§4）。
- **本契约不新建交付测试（派发约束）**：红在"契约测试将断言的同一 trap 场景"层面实跑证明；SA3 落地测试文件后须先在 HEAD 复跑捕获红（预期同 §5 表），再实施改造转绿，否则不得声称红。
- **敏感性与反证**：E1/E6（§9）只改属性形态即翻转红绿；每个新文件必须带"helper 正控"（§12.3）防空洞绿。

## 14. 测试入口证据

- `vitest.config.ts`：`include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts']`；`typecheck.include: ['packages/*/test/**/*.test-d.ts', ...]`；`maxWorkers: 1`。
- 基线实跑（§4）列出 clock/registry 47 文件、ws-replication 73 文件的收集清单——三条建议路径与既有兄弟文件同目录同后缀，命中同一 glob。
- 跨包源码解析：`NODE_OPTIONS=--conditions=nomicore-source` + `tsconfig.base.json` `customConditions`（无需 build）。
- 类型级门禁：`pnpm test` 内含 `--typecheck`；`pnpm typecheck` 覆盖 14 个 tsc project（含三包）。

## 15. 未知与阻塞

- **无阻塞**：能力缺口已稳定复现（200/200），契约可执行，入口真实，基线全绿。
- 未知（不影响契约成立，记录备查）：
  1. DSH `cordis-host-runner` 守卫的精确实现（是否绑定 `this`、包装闭包参数形状）不在本仓；本契约按 ADR 0023 L17 语义等价复刻，且五服务方法均 `this` 无关，断言对绑定差异不敏感。
  2. AC8 的 DSH 侧重建/live reload 与 fork 回退为仓外动作，无法在本 worktree 验证；本仓侧只保证 tarball 构建（基线已证）。
  3. pnpm 忽略 `esbuild` build script（warning）不影响任何已跑门禁；`pack:local` 用 tsc 构建，实证通过。
- 依赖安装状态：worktree 已 `pnpm install --offline --frozen-lockfile`；下游可直接跑门禁。

## 16. 临时诊断清理

- 临时文件（本契约收尾时删除）：`packages/ws-replication/.sa6-probe-issue-330.ts`（probe 源码见附录 A）。
- 保留证据：`wiki/raw/task_issue-330_sa6_red_probe.log`（红线原始输出）、本报告。
- 基线验证产生的构建产物（`packages/*/dist`、`apps/*/dist`、`**/tsconfig.build.json`、`artifacts/local-packages/*.tgz`）为 gitignore 内产物；收尾时清理，避免改造前的 dist/tarball 被下游误用。仓内被 git 跟踪的 `artifacts/local-packages/manifest.json` 与 `packages/instance/tsconfig.build.json` 已 `git checkout --` 还原 HEAD 版本（`git diff` 为空）。
- 收尾后 `git status --short` 恰为 5 个 `wiki/raw/task_issue-330*` 未跟踪文件（brief / conflict_report / relevant_decisions / 本契约 / red probe log）；`node_modules/` 及其余构建产物均在 gitignore 内、不出现在 status 输出；`git diff` 为空（跟踪文件零改动）。
- 无生产实现、无测试文件、无 fixture 改动。

## 附录 A：最小复现 probe（临时文件，已删；关键源码）

```ts
// packages/ws-replication/.sa6-probe-issue-330.ts（cwd=packages/ws-replication）
import { Context } from '@deepseek-ai/cordis'
import { provideClock, systemClock } from '@nomicore/clock'
import { createManualClock, createManualClockPlugin } from '@nomicore/clock/testing'
import { createInstancePlugin, provideInstance } from '@nomicore/instance'
import { createMemoryPersistencePlugin } from '@nomicore/persistence'
import { createFakeTimerPlugin } from '@nomicore/persistence/testing'
import { NOMICORE_REGISTRY_SERVICE, createNamespaceRegistryPlugin,
         provideNomicoreRegistry, requireNomicoreRegistry } from '@nomicore/namespace-registry'
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing'
import { createHubReplicationPlugin, createPeerReplicationPlugin,
         requireHubReplication, requirePeerReplication } from '@nomicore/ws-replication'

function guardProxy(target: any): any {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver)
      if (typeof value === 'function') return (...args: unknown[]) => Reflect.apply(value, receiver, args)
      return value
    },
  })
}

// 1) clock：systemClock / ManualClock —— 访问 now/set/advance 即 TypeError
// 2) registry：真实组合后 ctx.get('nomicoreRegistry') —— 7 成员访问即 TypeError
const registryCtx = new Context()
createInstancePlugin().apply(registryCtx, { instanceId: 'sa6-host', role: 'hub' })
createManualClockPlugin(createManualClock(1_700_000_000_000)).apply(registryCtx)
createFakeTimerPlugin(createRegistryTestScheduler()).apply(registryCtx)
createMemoryPersistencePlugin().apply(registryCtx)
await registryCtx.plugin(createNamespaceRegistryPlugin())
const registry = requireNomicoreRegistry(registryCtx)
// guardProxy(registry).open —— TypeError（同 6 个方法 + shutdown）
// 3) ws：hub/peer 真实组合后 requireHubReplication/requirePeerReplication
//    status（已是 getter）OK；requestReauth/stop、addTarget/removeTarget/
//    notifyAuthChanged/waitForLive/stop 访问即 TypeError
// 4) 负控：诚实 Proxy / 非冻结字面量 / nomicoreInstance / nomicorePersistence /
//    accessor 冻结模型（全 ACCESS_OK + 姿态探针）
```

运行：`NODE_OPTIONS=--conditions=nomicore-source ../../node_modules/.bin/tsx .sa6-probe-issue-330.ts > ../../wiki/raw/task_issue-330_sa6_red_probe.log`（exit 0，输出 49 行 JSON）。
