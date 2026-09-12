# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文行号，需要时按编号回查 ADR 全文。

## 任务标识

- 任务：Issue #330 — nomicore 服务表面 getter 化：冻结服务可被 Proxy 包装消费（ADR 0023 落地）
- 简报：`wiki/raw/task_issue-330.md`（Issue #330 正文同源；REST Issue-comments 读取结果为 `[]`——无 Owner 评论要求、无可应用的 comment ID/时间戳）
- Worktree：`/home/wangjian/nomicore-fix-issue-330`（branch `mabf/issue-330`，HEAD `83581b3` = ADR 0023 文档落地 commit）
- 冲突基准：`docs/adr/` 全集 **20 个文件（0001–0014、0016–0019、0022、0023；无 0015/0020/0021 编号文件）逐个核对状态行** + 根目录 `CONTEXT.md` 全读；模块决策按收录关系附三包 `AGENTS.md` 与 `docs/protocols/instance-replication-v1.md`
- 任务谱系：tracking issue #328 → PR #329（ADR 0023 文档，commit `83581b3` 已合入）→ 本票 #330（代码落地）

## 决策集合状态盘点

- 全部 20 个 ADR 状态均为「已接受」；无整篇 superseded 的 ADR。ADR-0007 的 open/read 编排与 schema-aware read 条款被 ADR-0008 部分取代（0007 文内自declare），残余条款（logical validation、零写入、observer no-rollback）仍有效——与本任务无交集。
- `CONTEXT.md` L129–131 已登记「服务表面（service surface）」术语并引用 ADR 0023——术语面与 ADR 同步，无需本变更集再改 CONTEXT。

## 相关 ADR

### ADR 0023 Cordis 服务表面 getter 化——冻结服务可被 Proxy 包装消费（accepted；本任务的直接母法）

`docs/adr/0023-proxy-consumable-frozen-service-surfaces.md`

- 与本任务的关联点：本任务是该 ADR 的**代码落地票**——ADR 已接受（commit `83581b3`），代码尚未改造（现状核验见下）。
- 核心条款（原文摘录，编号=文件行号）：
  1. L45（决策）：「凡经 `ctx.provide` 发布的 nomicore 服务对象，**函数成员一律以访问器属性构造**：方法体提为稳定闭包，对象字面量中改为 getter 返回该闭包，`Object.freeze` 保留。方法体、闭包封装、内部状态机一行不动。」
  2. L54–59（范例）：改前数据属性方法（触发 Proxy 不变量）→ 改后 `const openImpl = ...` 稳定闭包 + `get open() { return openImpl }`。
  3. L62（范围）：「落地上述影响面中全部“受影响”行（4 处生产 + 1 处 testing），并把该形态冻结为**构造纪律**：未来新增含函数成员的对象字面量服务一律遵循。」
  4. L30–39（影响面表，全仓审计结论）：受影响 5 行 = `nomicoreRegistry`（`packages/namespace-registry/src/registry.ts`）、`nomicoreHubReplication` / `nomicorePeerReplication`（`packages/ws-replication/src/plugin.ts`）、`clock`（`systemClock`，`packages/clock/src/system.ts`）、`ManualClock`（testing 导出，`packages/clock/src/manual.ts`）；不受影响 3 行 = `nomicoreInstance`（纯数据）、`nomicorePersistence`（class 原型方法）、`timer`（上游 class，非本仓资产）。
  5. L41（范围排除）：「服务方法的返回值（`NamespaceLease`、`ReplicationSession` 等）、issue/status 信封等数据对象、内部诊断 sink 均不经过消费方沙箱的顶层包装，不受影响。」
  6. L64–74（不可变姿态不弱化对照表）：赋值拒绝（访问器无 setter）、`defineProperty` 重定义拒绝（non-configurable）、TS 公共类型/Equal 锁不变、调用方 `registry.open(...)` 不变、方法引用缓存不变（getter 返回同一稳定闭包）、枚举性保持（字面量 getter 默认 enumerable）。
  7. L78（实现注意）：「自研 `deepFreeze` 类工具若按 `descriptor.value` 递归，注意访问器属性没有 `value`；`Object.freeze` 本身对访问器正常生效。」
  8. L90–93（验收）：每个受影响服务新增「可被返回包装闭包的 Proxy 合法消费」回归测试（包内既有 seam + 包内 guard-proxy helper，**不新建共享测试设施**）；既有 `writable === false` 数据属性形态断言更新为访问器形态断言（`configurable === false`、`typeof get === 'function'`、`set === undefined`）；三包门禁 + root `pnpm typecheck` / `pnpm test`、类型面零变化；出新版 local tarball 供 DSH 侧重建联动。
  9. L95–97（残留）：DSH 沙箱一般性缺陷属 host 侧议题，不构成本仓义务。

### CONTEXT.md「服务表面（service surface）」（L129–131）

- L130：「凡含函数成员的对象字面量形态服务，函数成员一律以访问器属性（getter 返回稳定闭包）构造并保留 `Object.freeze`……纯数据服务对象与 class 实例（原型方法）天然合规。服务方法返回的对象（lease/session 等）不是服务表面，不适用本纪律。」
- L131（Avoid）：「冻结对象字面量 + 数据属性方法（触发消费方 Proxy 不变量 TypeError）、为可包装性去掉 `Object.freeze`」——本任务两条红线的术语面来源；已与 ADR 0023 同步登记，本变更集无需改 CONTEXT。

### ADR 0009 + clock contract（间接约束：Clock 形状门禁与消费纪律）

`docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md`、`packages/clock/src/contract.ts`、`packages/clock/AGENTS.md`

- `packages/namespace-registry/src/registry.ts` L620–628：Registry 构造期 Clock 形状门禁要求 `typeof clock.now === 'function'`（禁 `Date.now()` fallback）。getter 化后经属性读取取得稳定闭包，`typeof` 仍为 `'function'`——门禁天然通过，不得借机改动门禁文案/顺序。
- `packages/ws-replication/src/plugin.ts` L482：peer 侧 `clock: { now: () => clock.now() }` 包装消费——不受属性形态影响。
- `packages/clock/AGENTS.md` L9–13：`Clock.now()` 语义（Unix epoch ms、不承诺单调）、manual clock 保持 `@nomicore/clock/testing` 显式 testing 导出、公共 API 只经 `src/index.ts`。

### ADR 0012 实例身份与 WebSocket plugin 所有权（间接约束：provide/teardown 模式）

`docs/adr/0012-instance-identity-and-websocket-plugin-ownership.md`、`packages/ws-replication/AGENTS.md` L16–17

- Hub/Peer plugin 对「自有发布 service」的所有权与 teardown 次序（`plugin.ts` L438–445 / L540–545：`ctx.effect` 内 `provide` revoke 与 `stop` 的 reverse-yield 次序）不受属性形态改造影响；getter 必须返回**同一稳定闭包**（ADR 0023 L72），保证 `yield stop` 引用不变。

### `docs/protocols/instance-replication-v1.md`（无交集核验）

- 协议权威域为 wire 帧/状态机/错误码/关闭语义（§21、issue #229 Hub close 偏离 L685 等）。本任务零 wire 触碰：服务对象构造形态是 Cordis 进程内 JS 面，非 wire 面。`ws-replication/AGENTS.md` L5 的「改 wire 行为前先读协议」触发条件不成立，但包门禁（L20–22）仍按 ADR 0023 验收节执行。

## 现状事实核验（源码佐证，不构成独立冲突基准）

1. `registry.ts` L2179–2281：`const registry: NamespaceRegistry = Object.freeze({ async open(...){...}, ... })`——七个方法（open/create/importReplica/resetReplica/deleteNamespace/getStatus/shutdown）全为数据属性，与 ADR 影响面表「受影响」一致。
2. `plugin.ts` L431–437（Hub）：`status` **已是**访问器 getter；`requestReauth`、`stop` 为数据属性。L505–539（Peer）：`status` 已是 getter；`addTarget`/`removeTarget`/`notifyAuthChanged`/`waitForLive`/`stop` 为数据属性。
3. `system.ts` L9–11：`Object.freeze({ now: () => Date.now() })` 单成员数据属性。`manual.ts` L34–52：`now`/`set`/`advance` 三成员数据属性。
4. `instance/src/index.ts` L61–64：纯数据冻结字面量（instanceId/role）——不在改造面。`persistence/src/memory.ts` L74 / `file.ts` L59：class 声明——不在改造面。
5. `persistence/src/testing.ts` L161–191：fake timer 为**未冻结** plain 字面量（上游 `timer` service 的测试 shim，非 nomicore 冻结服务表面，不进 ADR 0023 影响面表，亦不在本票范围）；未冻结属性 writable+configurable，Proxy `[[Get]]` 不变量不约束。
6. 仓内 `deepFreeze`（`namespace-diagnostic-log/src/pipeline.ts` L36–43 及 vfsl 消费）作用于诊断 record / compiled cache 等数据载荷，**不消费上述五个服务对象**——ADR 0023 L78 的注意事项在本仓无实际命中面。
7. 冻结面测试现状：`clock-contract.test.ts` L71–72 断言 `Object.keys(systemClock) === ['now']` + `Object.isFrozen`；L110–111 断言 ManualClock 键面 `[now, set, advance]` + isFrozen——字面量 getter 默认 enumerable，两断言在访问器形态下保持绿灯（ADR 0023 L73 明文）。**三包测试中无任何针对服务成员的 `writable === false` 数据属性形态断言**（`writable` 命中全部为 socket `writableLength`，无涉）——AC4 走「无此类断言则审计结论记录在案」分支，本条即审计结论的先期核验。
8. 生产代码中的 `writable: false` defineProperty（`registry.ts` L763–768 clonePlainData、`namespace-runtime/src/runtime.ts` L619 copyFrozen 族）是**数据载荷快照纪律**（JSON 域、函数在域外被拒），不是服务表面——不得被本任务的「访问器化」误伤。
