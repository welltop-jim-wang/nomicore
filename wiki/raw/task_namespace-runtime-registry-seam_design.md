# 设计文档 — namespace-runtime：Registry 专用受限生产构造 seam（issue #109，R0 初版）

- **任务类型**：功能开发（Feature）——新增 `@nomicore/namespace-runtime/internal` 生产 subpath，零存量代码行为改动
- **Worktree**：`/home/wangjian/nomicore-fix-issue-109`（Branch `fix/issue-109-on-docs-namespace-registry`，merge-base 5db6f83）
- **设计输入**：任务简报 `wiki/raw/task_namespace-runtime-registry-seam.md`；SA8 相关决议 `…_relevant_decisions.md`（ADR 约束基准，本文引用 ADR 一律以原文为准——SA8 注记：简报「构造序（ADR 0008 D1）」的 D 编号是简报瑕疵，ADR 0008 无 D 编号条款，下文一律引 ADR 章节名）；SA8 冲突报告 `…_conflict_report.md`（verdict: clear，含 4 条已裁定张力的裁决）；SA6 红灯测试 2 文件 11 用例（Phase 1 已锚定）。
- **ADR 约束基准（冻结，不得改写）**：
  - ADR 0009 §模块与 Cordis service：「Registry 通过 `@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime；主 entry 不公开生产 Runtime 构造器。模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费。」——subpath 名、factory 名、「仅一个导出」三点均被 ADR 原文冻结（冲突报告非阻塞注记 3）。
  - ADR 0008 §生命周期、状态与所有权：「Runtime 成功构造后独占一个 `DocHandle`；构造失败时所有权仍归调用方。……生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault。」
  - ADR 0008 §单一 write sequencer（写槽序列与 notifyDirty 接缝）：「`notifyDirty` 是由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝；Runtime 不依赖整个 `DocPersistence`。」
  - ADR 0009 §取代与关联：「本ADR不取代ADR 0008的单Runtime语义」——AC4「保持全部现有语义」即 ADR 0008 各节行为不变量的逐条保持。

---

## §1. 现状核对（设计期实测，2026-08-25 worktree HEAD 3451eca）

| # | 事实 | 核对方式 |
|---|---|---|
| F1 | `packages/namespace-runtime/package.json` exports 恰 `{ ".": "./src/index.ts" }`，version `0.1.5`，`"private": true` | read 该文件 |
| F2 | 主 entry `src/index.ts` 值导出恰一键 `RuntimeWriteFatalError`，其余全为 type export；不 re-export `createNamespaceRuntime` / `createNamespaceRuntimeWithSeam` / `NamespaceRuntimeSeamInput` | read `src/index.ts` |
| F3 | 生产工厂 `createNamespaceRuntime(handle, notifyDirty)` 与测试 seam `createNamespaceRuntimeWithSeam(input)` 均为 `src/runtime.ts` 模块级导出；`captureSeamInput`（V1 形状守卫）+ V2 状态门 + V3 入队的完整构造序在该文件；`compile` 缺省 `?? compileSchemaEnvelope`（runtime.ts:167）、`p0Gate` 缺省无门、`notifyDirty` 缺省未绑定（写槽 S2 loud 拒绝） | read `src/runtime.ts` |
| F4 | 仓库内（packages/domains/apps 生产源码）**零个** `@nomicore/namespace-runtime` 的包外消费方；包内测试经相对导入 `../src/runtime.js` 消费 seam，经 `../src/index.js` 审计主 entry | `git grep -rn "namespace-runtime" --include='*.ts' --include='*.json' -- packages domains apps`（排除本包后零命中） |
| F5 | SA6 红灯 2 文件已落盘并暂存（`git status` A 状态），真实运行 exit 1（vite `Missing "./internal" specifier`、tsc TS2307）；存量 exports-audit 4 it 仍全绿；总控已做模拟实现验证 11/11 绿后回滚，工作树复原 | 简报 §红灯验证 + §修绿可行性验证；`git status` 复核 |
| F6 | `tsconfig.base.json` `moduleResolution: "bundler"`（tsc 按 package.json `exports` 解析子路径）；`packages/namespace-runtime/tsconfig.json` include `src/**/*.ts`；根 `tsconfig.typecheck.json` include `packages/*/test/**/*.ts`；`vitest.config.ts` include `packages/*/test/**/*.test.ts` + typecheck `**/*.test-d.ts` | read 各配置 |
| F7 | 仓库全部 7 个 workspace 包的 exports 都是单 entry `{"."}` 形态——`./internal` 是本仓库**首个**多 entry exports（无既有先例，机制依据见 §7） | `grep '"exports"' packages/*/package.json domains/*/package.json` |
| F8 | 无 CHANGELOG、无 `scripts/` 目录（简报「无需维护 test-lock.sh」与实际一致） | `ls` 核对 |

## §2. 需求推演（Feature 切入面）

**要解决的问题**（ADR 0009 §背景 + 本 ticket）：未来 Registry 必须能合法取得独占 DocHandle 并绑定 dirty notifier 来构造生产 Runtime；但在本切片之前，唯一的构造通道是 `src/runtime.ts` 的模块级导出——**包外模块无法消费**（exports 封装），包内相对导入又不该开放给另一个包。同时这条通道一旦开了，必须是「受限的」：只放行最小生产输入，绝不能把测试注入面（`p0Gate`/`compile`/fault）一并带出。

**架构切入点**：不新增任何运行时逻辑，只新增一个**模块边界**——

1. **文件层**：新 leaf 模块 `src/internal.ts`，唯一的职责是把「生产工厂 + 必须显式绑定的 notifyDirty」这两个既有事实包装成 ADR 0009 冻结的名字。
2. **配置层**：package.json exports 增加 `"./internal"` 子路径映射（同文件 patch bump 0.1.5 → 0.1.6）。
3. **契约层**：存量 T1.4 键集断言演进为 `['.', './internal']`（唯一被授权的既有测试改动）。
4. **边界层**：AC5 审计测试（SA6 已写）白名单 = `packages/namespace-registry/src/**`（前瞻空集）；实现侧义务 = 生产代码零消费 + `internal.ts` 只走相对导入（§D-F）。

**为什么不把 factory 放进主 entry**：AC3/ADR 0008/ADR 0009 三重冻结「主 entry 不公开生产 Runtime 构造器」。放主 entry 会让任何依赖方都能构造第二个 Runtime/sequencer，直接破坏「同一 namespace 的所有受控写严格 FIFO」这一 ADR 0009 §背景声明的安全不变量。subpath 是唯一既能被 Registry 定向消费、又能被静态审计圈住的通道。

**为什么需要新函数而不直接把 `createNamespaceRuntime` 挂到 subpath**：ADR 0009 冻结的名字是 `createNamespaceRuntimeForRegistry` 且「唯一导出」；直接 re-export 会在 internal entry 上出现 `createNamespaceRuntime` 键——SA6 断言（seam.test.ts「零生产工厂别名」）即红。更重要的是语义分离：`createNamespaceRuntime` 是包内普通生产工厂；`createNamespaceRuntimeForRegistry` 是**模块边界意义上的受控通道**，其类型签名即 AC2 的最小输入面声明（§D-B）。

## §3. 设计决策

### D-A. internal entry 文件：新建 `packages/namespace-runtime/src/internal.ts`

- 新 leaf 模块，不 import `index.ts`，不被 `index.ts` import，无环（internal.ts → runtime.ts → {errors,p0,projection,sequencer,status,close,write,schema-write}.ts，反向零引用）。
- 主 entry 依赖图完全不触碰 internal.ts——主 entry 消费方（现状为零，F4）的加载路径字节不变。
- 文件内**恰好一个值导出** `createNamespaceRuntimeForRegistry`，**零类型导出**（ADR 0009「唯一导出」按最强解读执行：名字集合恰为 1，运行时 `Object.keys` 与类型面 `import` 均只见这一键）。返回值类型 `NamespaceRuntime` 直接复用主 entry 已导出的同名 interface，消费方无需从 internal 拿类型。

### D-B. factory 签名：两参形 `(handle, notifyDirty)`（在 SA6 允许的两种形态中选定）

```ts
export function createNamespaceRuntimeForRegistry(
  handle: DocHandle,
  notifyDirty: () => Promise<void>,
): NamespaceRuntime
```

SA6 类型测试（type-guard.test-d.ts）允许两参形或恰 `{handle, notifyDirty}` 单对象形。**选两参形**，理由按强度排列：

1. **与既有生产工厂同形**：`createNamespaceRuntime(handle, notifyDirty)`（runtime.ts:274-279）就是两参形——委托即恒等，无任何参数拆包/重组代码。
2. **AC2 的结构化最强保证**：两参签名**不存在输入对象**，`p0Gate`/`compile`/fault 在类型面上无处安放；SA6 行为探针把 sentinels 作为**第 3 个位置实参**传入（seam.test.ts `buildViaInternalFactory`），JS 调用语义对未声明位置参数天然忽略——注入面「到达即死亡」，seam 层**零守卫代码**（无守卫 = 无守卫 bug，无「承认注入但静默丢弃」的降级嫌疑，符合拒绝虚假降级立法）。
   - 对照：若选单对象形，SA6 探针的 fallback 分支会以 `{handle, notifyDirty, compile: spy, p0Gate: neverResolve, fault}` 整体调用——实现必须靠解构丢弃多余键才安全，等价于把 AC2 的正确性押在「实现记得只取两键」上，弱于两参形的语言级保证。
3. **类型判别直落第一分支**：`Parameters<Factory>` 恰 `[DocHandle, () => Promise<void>]`，SA6 `Allowed` 条件类型首分支命中；`LeakTwoArg`/`LeakObj` 均判 false。
4. **简报推荐形态**：总控模拟实现（已验证 11/11 绿）即两参形。

**输入语义（JSDoc 必写，源自 ADR 原文，不新造）**：
- `handle`：独占 `DocHandle` 租约——「Runtime 成功构造后独占一个 `DocHandle`；构造失败时所有权仍归调用方」（ADR 0008 §生命周期、状态与所有权）。状态门：`getStatus() ∈ {ready, persistence-degraded}` 放行，其余 loud throw（既有行为，委托继承）。
- `notifyDirty`：**必填、无缺省**——「由构造方绑定 `persistence.saveDoc(handle)` 的窄接缝」（ADR 0008 §单一 write sequencer）。未来 Registry 切片负责绑定 `() => persistence.saveDoc(handle)`；本工厂不代绑、不提供默认 no-op（未绑定的 loud gate 住在写槽内，是既有语义，非本设计新增）。

### D-C. internal.ts 实现体：纯委托既有生产工厂（构造序「逐字节保持」的唯一可证形态）

```ts
// packages/namespace-runtime/src/internal.ts（新建）
/**
 * @nomicore/namespace-runtime/internal —— Registry 专用受限生产构造 seam
 * （ADR-0009 §模块与 Cordis service；issue #109）。
 *
 * 消费边界：本 subpath 仅允许 @nomicore/namespace-registry 生产代码消费
 * （模块边界测试 import 图审计强制；当前仓库消费方为空集）。
 * 导出面纪律：值导出恰本函数一键；不导出测试 seam（createNamespaceRuntimeWithSeam
 * / NamespaceRuntimeSeamInput 保留包内模块通道，ADR-0008「测试通过包内确定性
 * seam 注入」）、不导出生产工厂别名（createNamespaceRuntime）、不导出运行态
 * 与任何类型——主 entry 的公共类型面（NamespaceRuntime 等）不在此重复。
 */
import type { DocHandle } from '@nomicore/persistence';
import { createNamespaceRuntime } from './runtime.js';   // 相对导入，绝不走本包 subpath specifier（§D-F）
import type { NamespaceRuntime } from './runtime.js';

/**
 * 构造生产 NamespaceRuntime（ADR-0009 冻结名）。
 *
 * - handle：独占 DocHandle 租约，所有权随构造成功转移给 Runtime；
 *   构造 throw（形状守卫/状态门）时所有权仍归调用方，零副作用（ADR-0008）。
 * - notifyDirty：构造方绑定的 dirty notification 窄接缝——Registry 应绑定
 *   `() => persistence.saveDoc(handle)`；本工厂不提供缺省绑定。
 *
 * 构造序（形状守卫 → 状态门 → 所有权转移/P0 入队）与十键公共面语义
 * 由 src/runtime.ts 既有实现逐字节承载：本函数纯委托，无任何自有分支。
 */
export function createNamespaceRuntimeForRegistry(
  handle: DocHandle,
  notifyDirty: () => Promise<void>,
): NamespaceRuntime {
  return createNamespaceRuntime(handle, notifyDirty);
}
```

**为什么委托而非在 internal.ts 重写构造序**：
1. 「逐字节保持」（简报 §边界与纪律）的最强形式是**同一份代码**——委托使 ADR 0008 构造序（V1 形状守卫 / V2 状态门 / V3 所有权转移 + P0 队首入队）与十键/七键公共面成为结构继承，不存在「两条构造路径日后漂移」的可能。这正是本 ticket 的存在理由：**消灭第二个构造通道**；重写守卫等于在 internal.ts 里再造一个。
2. AC4 全部断言（P0 队首、构造即读、FIFO、status 面、close 幂等、落盘）由同一实现承载，行为差异在构造上不可能出现。
3. 委托链只有一层：`createNamespaceRuntimeForRegistry → createNamespaceRuntime → createNamespaceRuntimeWithSeam({handle, notifyDirty})`——第三跳是既有生产工厂的既有写法（runtime.ts:278），`p0Gate`/`compile` 在该对象上**缺席** → P0 恒走真实 `compileSchemaEnvelope`、无 gate（AC2 的「注入面零效果」与 AC4 的「真实编译」同源成立）。

**运行时导出表推导**：internal.ts 的动态 import namespace 只含其值导出——恰 `['createNamespaceRuntimeForRegistry']`（`import type` 在 verbatimModuleSyntax 下编译期擦除；`import { createNamespaceRuntime }` 是模块内部消费、不 re-export，不进 namespace）。与 SA6 断言逐键吻合。

### D-D. `package.json` 双改动（同一文件的仅两处 diff）

```jsonc
{
  "name": "@nomicore/namespace-runtime",
  "version": "0.1.6",                       // ← 硬门禁 #9：改包必 bump patch（0.1.5 → 0.1.6）
  "exports": {
    ".": "./src/index.ts",
    "./internal": "./src/internal.ts"        // ← 新增唯一 subpath；无 ./testing /./test /./seam /./internal/testing
  },
  // 其余字段零改动
}
```

- exports 键集恰 `['.', './internal']`（SA6 seam.test.ts AC1/AC6 断言 + T1.4 演进后断言双重锚定）。
- `private: true` 不变——subpath 只服务 workspace 内定向消费（未来 `@nomicore/namespace-registry` 声明 `workspace:*` 依赖后 import），无发布语义。
- 不新增 dependencies/devDependencies（internal.ts 只用既有 `@nomicore/persistence` 类型 + 包内模块）。

### D-E. 存量 T1.4 契约演进（唯一被授权的既有测试改动）

`packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts` 第 4 个 it（行 56-66）——键集断言 `['.']` → `['.', './internal']`，标题与头注改引 ADR-0009 / issue #109。精确 diff 形态：

```ts
  it('T1.4（存量审计锚）：package.json exports 键集恰 [".", "./internal"]——./internal 为 ADR-0009 冻结的 Registry 生产 seam，仍无任何测试子路径（配置审计，防回潮）', () => {
    // 配置审计（package.json 是配置元数据，非被测源码文本）。
    // 契约演进（issue #109）：issue #93 立法的不变量「testing seam 绝不进 package entry」保持；
    // ADR-0009 §模块与 Cordis service（docs/adr/0009-namespace-registry-leases-and-host-lifecycle.md）
    // 冻结新增唯一生产 subpath "./internal" → "./src/internal.ts"（Registry 专用受限构造通道，
    // 非测试通道——p0Gate/compile/fault 注入面在 internal entry 上零暴露，见
    // runtime-registry-internal-seam.test.ts / runtime-registry-internal-type-guard.test-d.ts）。
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    expect(pkg.exports).toBeTypeOf('object');
    const keys = Object.keys(pkg.exports as Record<string, unknown>).sort();
    expect(keys).toEqual(['.', './internal']);
  });
```

- **其余三个 it（主 entry 值导出恰一键、禁导清单缺席、唯一值导出是 function）零改动**——它们锚定的是 `src/index.js` 模块 namespace 与主 entry 面，本次完全未触碰（AC3 保持的验证面）。
- 演进依据已在简报「已知契约演进点」节预授权：底层不变量（testing seam 不进 entry）保持，仅精确键集断言随新增生产 subpath 同步。T1.4 与 SA6 新断言互为冗余锚（两处独立断言同一键集），非冲突。

### D-F. AC5 边界的实现侧义务（不写代码的纪律条款）

SA6 已交付审计测试（import 图静态审计 + 白名单谓词自检 + 防空扫）。设计要求实现侧遵守三条硬规则，使审计恒绿：

1. **生产源码零消费**：本任务不向任何生产文件添加 `@nomicore/namespace-runtime/internal` 的 import（静态或动态）——当前消费方必须保持空集；白名单唯一前缀 `packages/namespace-registry/src/` 属未来切片 5/6。
2. **internal.ts 只走相对导入**：`import … from './runtime.js'`。**禁止**在本包任何文件写 `from '@nomicore/namespace-runtime/internal'` 自引用——审计谓词对 `packages/namespace-runtime/src/internal.ts` 判 false（seam.test.ts 白名单自检 it 已显式锚定该路径不获放行），自引用 specifier 会立即使 AC5 红。
3. **测试文件的 specifier 消费不越界**：SA6 两个测试文件位于 `packages/namespace-runtime/test/`，审计 walk 跳过 `test` 目录（其 `import '@nomicore/namespace-runtime/internal'` 是被测对象探测，不是生产消费）——这是审计设计的一部分，无需也不得为绕过审计而移动测试文件。

### D-G. README 一行对齐（可选但建议，≤2 行改动）

`packages/namespace-runtime/README.md` 第 9 行已预写「Production assembly is performed by the owning server/registry layer through the package-internal factory」——subpath 落地后该句应落为具体通道，防止 package docs 漂移（Phase 4 阶段门禁要求 package docs 一致）：

```md
Production assembly is performed by the owning registry layer through the restricted `@nomicore/namespace-runtime/internal` subpath (`createNamespaceRuntimeForRegistry`, consumed only by `@nomicore/namespace-registry` production code). Tests inside this package may import the internal seam constructor directly from `src/runtime.ts`; it is not a business API.
```

仅替换该段一句话，其余章节零改动。若 SA2/SA4 认为应砍掉以收窄 scope，此条可整段放弃（DENY 化），不影响任何 AC。

## §4. AC 覆盖矩阵

| AC | 设计承载 | SA6 锚点（已落盘） |
|---|---|---|
| AC1 internal 仅导出一个 Registry 专用生产 factory | §D-A（恰一键、零类型导出）+ §D-B（冻结名与签名）+ §D-C（纯委托）+ §D-D（exports 恰两键） | seam.test.ts「AC1/AC6」三 it（键集 / 动态导入键集恰一键 / 禁导缺席） |
| AC2 只接收 handle + dirty notifier，不暴露 compile/fault/testing seam | §D-B 两参形（注入面无处安放、位置实参天然忽略）+ §D-C 委托链（p0Gate/compile 在委托对象上缺席 → 真实 vfsl 编译） | type-guard.test-d.ts 三 it（参数形状 / p0Gate・compile 键缺席）；seam.test.ts「AC2」it（spy 零调用 + never-resolve gate 零消费 + fault 哨兵零效果 + Runtime 全功能） |
| AC3 主 entry 继续封闭 | §D-A（index.ts 与 internal.ts 互不引用；主 entry 零改动）+ §D-E（exports-audit 其余三 it 零改动留守） | 既有 exports-audit 三 it + type-guard @ts-expect-error 副锚（主 entry 不导出 `createNamespaceRuntime`） |
| AC4 产出 Runtime 保持全部现有语义 | §D-C 委托 = 同一实现承载（构造序/P0 队首/FIFO/status 七键/十键/close 幂等/落盘全部结构继承） | seam.test.ts「AC4」it（全链七段断言） |
| AC5 仅 Registry 生产代码可消费 internal subpath | §D-F 三条硬规则（生产零消费 / 相对导入 only / 测试目录豁免属审计设计） | seam.test.ts「AC5」三 it（防空扫 / 谓词自检 / 消费方 ⊆ 白名单） |
| AC6 testing seam 不进任何 package entry | §D-C（internal.ts 零 re-export seam/工厂别名/类型）+ §D-D（无任何测试子路径）+ §D-E（T1.4 不变量注释保持） | seam.test.ts 键集+禁导探测；type-guard @ts-expect-error 双副锚 |
| AC7 全量 typecheck/test + Node 20/24 CI | §D-H 门禁路径（F6 globs 已覆盖全部新文件，零配置改动） | SA3 交卷时全量验证（当前红灯为预期中间态） |

### D-H. 验证路径（SA3 交卷门禁，本设计零配置依赖）

```bash
cd <worktree>
npx vitest run packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts \
  packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts   # 11/11 绿
npx vitest run packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts  # 4/4 绿（含 T1.4 演进后）
pnpm test          # vitest run --typecheck 全量（新文件已被 include globs 覆盖，F6）
pnpm typecheck     # 逐包 tsc（src/**/*.ts 自动含 internal.ts）
pnpm exec tsc -p tsconfig.typecheck.json --noEmit   # 聚合
```

Node 20/24 CI：改动为纯 TS 源 + exports 映射，无运行时依赖变化；解析机制依据见 §7（SA1/SA6 已在仓内实测）。

## §5. 风险与边界条件分析

| # | 风险/边界 | 分析与处置 |
|---|---|---|
| R1 | internal.ts 重写守卫导致双构造路径漂移 | §D-C 选纯委托——构造序只有 runtime.ts 一份，结构上不存在第二实现 |
| R2 | 单对象形签名会迫使实现「记得」丢弃注入键 | §D-B 选两参形——语言级忽略位置实参，零守卫代码即满足 AC2 哨兵探针 |
| R3 | internal.ts 误用自引用 specifier 触发 AC5 红 | §D-F 规则 2 显式禁止；SA6 谓词自检 it 已把 `packages/namespace-runtime/src/internal.ts` 锚定为 deny 例 |
| R4 | 循环导入 | 无：internal.ts 是 leaf（§D-A）；index.ts 不 import internal.ts，主 entry 加载图不变 |
| R5 | 主 entry 回归 | index.ts 零改动；exports-audit 其余三 it 断言对象是 `src/index.js` namespace，与 package.json 键集无关，保持绿 |
| R6 | exports 封装破坏既有消费 | F4：包外生产消费方为零；包内测试走相对导入，不经 exports；根 entry 映射不变 |
| R7 | 解析机制（vite/tsc/Node 对 subpath + 自引用的支持） | 仓内实测证据链见 §7 P1/P2/P3——红灯报错形态 + 模拟实现 11/11 绿已闭环验证 |
| R8 | notifyDirty 误绑定（未来 Registry 传错绑定） | 非 本 ticket 面：必填参数 + 写槽内未绑定 loud gate（既有）兜底；ADR 归属 Registry 切片 |
| R9 | T1.4 演进被指 scope creep | 简报「已知契约演进点」节预授权（不变量保持、键集演进、注引改 ADR-0009/#109）；改动限定单 it 块，其余断言逐字不动 |
| R10 | 未来切片 5/6 落地时本 seam 成为阻塞 | 白名单谓词前瞻放行 `packages/namespace-registry/src/**`（SA6 测试已锚）；本设计不预建 Registry 包、不预写其消费代码 |
| R11 | 版本纪律遗漏 | §D-D 同一 diff 内 0.1.5 → 0.1.6（硬门禁 #9）；无 CHANGELOG 机制（F8），不新建 |

## §6. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-runtime/src/internal.ts` — **新建**，internal subpath entry，恰一键值导出 `createNamespaceRuntimeForRegistry`，纯委托既有生产工厂（§D-A/§D-B/§D-C，约 35 行含 JSDoc）
- `packages/namespace-runtime/package.json` — **修改**，仅两处：exports 增 `"./internal": "./src/internal.ts"` + version 0.1.5→0.1.6（§D-D）
- `packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts` — **修改**，仅第 4 个 it（行 56-66）：键集断言 `['.']`→`['.', './internal']` + 标题/头注改引 ADR-0009/issue #109；其余三 it 逐字不动（§D-E）
- `packages/namespace-runtime/README.md` — **修改（可选）**，仅第 9 行一句：package-internal factory 落为具体 subpath 通道（§D-G，≤2 行；可按评审意见 DENY 化放弃）
- `packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts` — `[SA6 owned]` 验收红灯测试（已落盘暂存）；SA3/SA4 不得改断言逻辑，仅允许测试基础设施级修复（如 hook/fixture 隔离）
- `packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts` — `[SA6 owned]` 验收红灯类型测试（已落盘暂存）；同上
- `wiki/raw/task_namespace-runtime-registry-seam_design.md` — `[SA1 owned]` 本设计文档
- `wiki/raw/task_namespace-runtime-registry-seam.md` — `[总控 owned]` 任务简报（已暂存）
- `wiki/raw/task_namespace-runtime-registry-seam_relevant_decisions.md` / `…_conflict_report.md` — `[SA8 owned]` 前置门禁产出（已暂存）
- `wiki/raw/task_namespace-runtime-registry-seam_dispatch.md` — `[总控 owned]` 派发日志（已暂存）

### DENY LIST

- `packages/namespace-runtime/src/index.ts` — 主 entry 公共面冻结（AC3/ADR-0008/ADR-0009 三重冻结），零改动
- `packages/namespace-runtime/src/runtime.ts` — 生产工厂/构造序/测试 seam 已按 ADR-0008 落定并被 20+ 存量测试锚定，零改动（委托即复用）
- `packages/namespace-runtime/src/{errors,p0,projection,sequencer,status,close,write,schema-write,plain-data}.ts` — Runtime 语义层，AC4 要求逐字节保持，零改动
- `packages/namespace-runtime/tsconfig.json`、根 `tsconfig.base.json`/`tsconfig.typecheck.json`、`vitest.config.ts` — include globs 已覆盖新文件（F6），零改动
- `packages/persistence/**`、`packages/doc-runtime/**`、`packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**`、`packages/dsh-persistence/**` — 依赖包，零改动
- `packages/namespace-registry/**` — 切片 5/6 交付物，本任务不新建（AC5 白名单前瞻空集）
- `packages/namespace-runtime/test/` 其余 20 个存量测试文件 — 除 exports-audit 的 T1.4 it 外全部零改动
- `docs/adr/**`、`CONTEXT.md` — ADR 已冻结命名与约束，零改动
- `domains/**`、`apps/**`（如存在）— 无关面，零改动

## §7. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| P1 | package.json exports 增 `"./internal"` 后，vitest/vite 内 `import('@nomicore/namespace-runtime/internal')` 可解析 | 设计期实测验证（仓内） | SA6 红灯真实运行（简报 §红灯验证，2026-08-25）：报错为 vite `Missing "./internal" specifier`——证明解析已抵达本包 exports map、仅缺该子路径键；总控模拟实现加该键后同命令 `Test Files 2 passed (2); Tests 11 passed (11)`（简报 §修绿可行性验证，已回滚） | 低 |
| P2 | tsc（`moduleResolution: "bundler"`，tsconfig.base.json）经 exports map 解析该 subpath；`import type` 判别与 @ts-expect-error 副锚可翻转 | 设计期实测验证（仓内） | 红灯 TS2307 `Cannot find module '@nomicore/namespace-runtime/internal' or its corresponding type declarations`（简报 §红灯验证）+ 模拟实现后 `Type Errors no errors`（同上验证记录）；bundler resolution 按 exports 解析是 TS 官方语义（tsconfig.base.json:6 现行配置即所依赖机制） | 低 |
| P3 | Node 20/24 下 exports subpath + 包自引用（包内测试以包名 specifier 导入自身）可用 | 类比已有 job 验证 + 机制依据 | 上述 11/11 绿运行即在本仓 Node 环境经 vitest 完成（同一机制 CI 复跑）；Node ≥12.16 原生支持含 `exports` 的包自引用（Node 官方 docs: Packages > Package entry points / self-referencing）；`private: true` 不影响 workspace 内解析 | 低 |
| P4 | 动态 import namespace 的键集只反映值导出（type import 编译期擦除；模块内部消费的 import 不出现在 namespace） | 现有测试引用 | `packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts:29`：对 `import * as publicEntry from '../src/index.js'` 断言键集恰 `['RuntimeWriteFatalError']`——而 index.ts 同时含 10 个 `export type`（src/index.ts:21-30）与模块内部值 import，现行全绿，即同一机制先例 | 低 |
| P5 | exports 键集变更不破坏根 entry 解析 | 现有测试引用 + 仓内实测 | 根 entry 映射 `"."` 未动；F4 包外生产消费方为零；模拟实现期间存量 exports-audit 4 it 与全量 11/11 同时绿（简报 §修绿可行性验证） | 低 |

其余（tsconfig/vitest include glob 覆盖、无环依赖）为纯代码/配置事实（F4/F6），不属协议级假设。

## §8. 契约改动连锁审计 (Contract Change Caller Audit)

**无既有函数契约改动**：本设计仅新增函数 `createNamespaceRuntimeForRegistry`（新 leaf 模块、当前全仓零 caller）与 exports 配置扩展；`createNamespaceRuntime` / `createNamespaceRuntimeWithSeam` / 主 entry 全部导出的签名、返回类型、throw 路径、同步性逐字不动（AC3/AC4 的验证面即其不动性）。

唯一触碰的既有契约是**配置级**契约 `package.json exports` 键集，其消费方审计如下：

| 消费方 | 位置 | 消费方式 | 受影响判定 | 处置方案 |
|---|---|---|---|---|
| exports-audit T1.4 | `packages/namespace-runtime/test/runtime-acceptance-exports-audit.test.ts:56-66` | 静态读 package.json 断言键集恰 `['.']` | **唯一会红**的既有断言（简报预授权的已知演进点） | §D-E：键集演进为 `['.', './internal']` + 注引 ADR-0009/#109；不变量（无测试子路径）保持 |
| SA6 seam.test.ts AC1/AC6 it | `packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts:102-115` | 静态读 package.json 断言键集恰 `['.', './internal']` | 修绿目标（当前红） | 无需处置（实现即满足） |
| vite/tsc 解析器 | 运行时/编译期工具链 | 按 exports map 解析 specifier | 新增键纯加法，根 entry 不变（P1/P2/P5） | 无需处置 |
| 包外生产消费方 | 全仓（F4：零个） | import `@nomicore/namespace-runtime`（根） | 不受影响 | 无 |

**风险评估**：新增 subpath 对既有解析是纯加法；不删除、不改写 `"."` 映射，故不存在「消费方断裂」路径。未来唯一预期 caller（`packages/namespace-registry/src/**`，切片 5/6）的类型契约已由 SA6 type-guard 测试冻结为两参形/单对象形判别，本设计选定两参形（§D-B）落在其第一允许分支。

## SA2 反馈逐条回应

（R0 初版——尚无 SA2 反馈；R1+ 修订时在此逐条登记落实映射，修订汇总表按 SKILL §SA2 反馈修订协议追加。）
