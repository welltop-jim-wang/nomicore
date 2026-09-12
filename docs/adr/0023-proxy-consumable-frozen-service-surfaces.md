# ADR 0023：Cordis 服务表面 getter 化——冻结服务可被 Proxy 包装消费

日期：2026-09-12（设计冻结：tracking issue #328）
状态：已接受（构造纪律冻结；影响包 `@nomicore/namespace-registry`、`@nomicore/ws-replication`、`@nomicore/clock`）

## 背景

DeepSeek Harness（DSH）的动态插件沙箱（cordis-host-runner）在消费 nomicore 发布的 Cordis 服务时，**每次成员访问都抛出 Proxy 不变量 TypeError**，服务完全不可用：

```text
TypeError: 'get' on proxy: property 'open' is a read-only and non-configurable
data property on the proxy target but the proxy did not return its actual value
```

根因是两种合法构造的正面冲突：

1. **DSH 沙箱**把注入的服务对象包进一个 Proxy，`get` 陷阱为每个函数成员返回**新闭包**（用于在返回值上挂守卫）；
2. **nomicore 的服务对象**是 `Object.freeze` 的对象字面量，每个方法是自有的、不可配置的、不可写的**数据属性**。

ECMA-262 对 Proxy `[[Get]]` 陷阱返回值的不变量约束恰好禁止这种组合：

- 目标属性是**自有的、不可写的、不可配置的数据属性** → 陷阱必须返回目标的真实值（不能返回包装闭包）；
- 目标属性是**不可配置的、getter 为 `undefined` 的访问器属性** → 陷阱必须返回 `undefined`；
- **带 getter 的访问器属性——即使不可配置——不受任何约束。** 这是规范留出的合法通道。

这阻断了 DSH 的 L2 会话级工具路线：会话级动态插件经 `ctx.get('nomicoreRegistry')` 获取服务后，连读取方法引用都会抛错。

### 影响面（全仓审计结论）

| 服务对象 | 构造位置 | 形态 | 受影响 |
|---|---|---|---|
| `nomicoreRegistry` | `packages/namespace-registry/src/registry.ts` | 冻结字面量 + 数据属性方法 | 是 |
| `nomicoreHubReplication` | `packages/ws-replication/src/plugin.ts` | 冻结字面量 + 数据属性方法 | 是 |
| `nomicorePeerReplication` | `packages/ws-replication/src/plugin.ts` | 冻结字面量 + 数据属性方法 | 是 |
| `clock`（`systemClock`） | `packages/clock/src/system.ts` | 冻结字面量 + 数据属性方法 | 是（初版排查遗漏——业务在 Registry 即全线崩溃，未走到 Clock） |
| `ManualClock`（testing 导出） | `packages/clock/src/manual.ts` | 冻结字面量 + 数据属性方法 | 是（测试面，同款预防） |
| `nomicoreInstance` | `packages/instance/src/index.ts` | 冻结字面量，纯数据 | 否（Proxy 陷阱对非函数值原样返回） |
| `nomicorePersistence` | `packages/persistence/src/memory.ts` / `file.ts` | class 实例，方法在原型 | 否（不变量只约束自有属性） |
| `timer` | 上游 `@deepseek-ai/cordis-plugin-timer` | class | 否（非本仓资产） |

服务方法的返回值（`NamespaceLease`、`ReplicationSession` 等）、issue/status 信封等数据对象、内部诊断 sink 均不经过消费方沙箱的顶层包装，不受影响。

## 决策

凡经 `ctx.provide` 发布的 nomicore 服务对象，**函数成员一律以访问器属性构造**：方法体提为稳定闭包，对象字面量中改为 getter 返回该闭包，`Object.freeze` 保留。方法体、闭包封装、内部状态机一行不动。

```ts
// 改前：数据属性方法（触发 Proxy 不变量）
const registry: NamespaceRegistry = Object.freeze({
  async open(owner: unknown, namespaceId: unknown): Promise<OpenNamespaceResult> { ... },
})

// 改后：访问器属性方法（合法通道）
const openImpl = async (owner: unknown, namespaceId: unknown): Promise<OpenNamespaceResult> => {
  // 方法体原样
}
const registry: NamespaceRegistry = Object.freeze({
  get open() { return openImpl },
})
```

本 ADR 落地上述影响面中全部"受影响"行（4 处生产 + 1 处 testing），并把该形态冻结为**构造纪律**：未来新增含函数成员的对象字面量服务一律遵循；新增服务在选型时优先考虑纯数据对象或 class 实例（两者天然合规）。

### 不可变姿态不弱化（对照）

| 姿态 | 数据属性 + freeze（改前） | 访问器 + freeze（本 ADR） |
|---|---|---|
| `registry.open = fn` 赋值 | 拒绝 | 拒绝（访问器无 setter） |
| `Object.defineProperty` 重定义 | 拒绝（non-configurable） | 拒绝（non-configurable） |
| TS 公共类型 / Equal 锁 | — | 不变（接口不区分数据/访问器） |
| 调用方 `registry.open(...)` | — | 不变 |
| 方法引用缓存（`const open = registry.open`） | — | 不变（getter 返回同一稳定闭包） |
| 枚举性（`Object.keys`/展开/`JSON.stringify`） | 可枚举 | 可枚举（字面量 getter 默认 enumerable） |
| 被包装 Proxy 消费 | 抛不变量 TypeError | 合法 |

### 实现注意

- 自研 `deepFreeze` 类工具若按 `descriptor.value` 递归，注意访问器属性没有 `value`；`Object.freeze` 本身对访问器正常生效（置 non-configurable、保留 getter）。
- 每次属性访问调用一次 getter，成本可忽略。

## 备选（已否决）

- **DSH 侧 facade 门面服务**：同一能力出现两个发布面，nomicore API 每演进一次门面要跟进，且只治好自家服务。
- **DSH fork 修改沙箱守卫**（对冻结方法跳过包装）：已在 fork 实现并测试通过，但无法提回上游，会累积 host-core 分歧债；本 ADR 落地后该 fork 修复整体回退。
- **nomicore 改 class + 原型方法**：原型方法非自有属性同样绕开不变量，但闭包封装需改写为私有字段，diff 大，且原型共享可变、姿态反而弱。
- **nomicore 去掉顶层 `Object.freeze`**：diff 最小但直接削弱深冻结完整性纪律，不值得为消费方一个沙箱让步。

## 验收

- 每个受影响服务新增"可被返回包装闭包的 Proxy 合法消费"回归测试（包内既有公共服务面/插件测试 seam + 包内 guard-proxy helper，不新建共享测试设施）；
- 既有断言数据属性形态（`writable === false`）的冻结测试更新为访问器形态（`configurable === false`、`typeof get === 'function'`、`set === undefined`）；
- `namespace-registry`、`ws-replication`、`clock` 全套包门禁 + root `pnpm typecheck` / `pnpm test`；类型面零变化；
- 发布后联动：出新版 local tarball，DSH 侧重建 `nomicore-host` 并做 revision 切换（live reload，无需进程重启），随后回退 DSH fork 的沙箱守卫改动。

## 残留

本 ADR 解决 nomicore 服务表面的可包装性。DSH 沙箱对"任意冻结服务"的一般性缺陷仍在，属 host 侧后续议题；本部署内唯一的冻结服务提供方即 nomicore，将来出现第二个提供方时参照本模式处理。
