# 独立项目使用 VFSL 生成类型安全的 Namespace 读写代码

本文面向把 Nomicore 作为功能模块使用的独立项目。宿主项目拥有自己的目录结构、构建、测试、发布和生命周期；Nomicore 只提供 VFSL、类型投影、Namespace Registry/Lease 及其依赖，不要求宿主项目迁入 Nomicore 仓库。

插件装配、Persistence、Registry 创建与关闭见[第三方 Cordis 宿主接入指南](./cordis-plugin-hosting.md)。VFSL 建模和语法见 [VFSL Schema 编写指南](../vfsl/schema-authoring-guide.md)。本文只说明以下链路：

```text
宿主项目的 schema.vfsl
  → @nomicore/vfsl-codegen
  → 宿主项目的 generated.ts
  → 宿主业务代码中的类型安全路径和值
  → 宿主自己的 TypeScript typecheck
```

## 1. 宿主项目目录

当前生成器使用固定布局：从宿主项目根目录读取 `domains/*/schema.vfsl`，并在相同领域目录写入 `generated.ts`。

```text
my-service/
├── domains/
│   └── inventory/
│       ├── schema.vfsl       # 宿主维护的单一真相源
│       └── generated.ts      # 自动生成，入仓，不手改
├── src/
│   ├── nomicore.ts           # 宿主装配 Nomicore
│   └── inventory-service.ts  # 宿主业务代码
├── package.json
└── tsconfig.json
```

`domains/` 属于宿主项目；它不是 Nomicore checkout 内的目录。每个领域当前恰有一个 schema，schema 的 `@id` 去掉 `@<数字>` 后必须等于领域目录名。

例如 `domains/inventory/schema.vfsl`：

```vfsl
// @lang: vfsl
// @id: inventory@1
// @version: 1

/** 库存项 ID；由宿主业务生成，在该 namespace 内稳定 */
type ItemId = string & Pattern<"^[A-Za-z0-9_-]{1,64}$">;

/** 可独立同步的库存项 */
type Item = YMap<{
  /** 展示名称 */
  name: YLeaf<string>;
  /** 当前库存件数，单位为件 */
  quantity: YLeaf<number>;
  /** 标签序列 */
  tags: YArray<string>;
}>;

/** inventory namespace 的领域数据根 */
type ROOT = YMap<{
  items: Record<ItemId, Item>;
  note?: YLeaf<string>;
}>;
```

## 2. 安装或本机链接依赖

正式发布后，宿主项目应把实际使用的 Nomicore 包声明为自己的依赖和开发依赖。发布前同机联调，可从宿主项目根目录按实际路径链接：

```bash
cd /path/to/my-service

pnpm link \
  /home/wangjian/nomicore/packages/vfsl \
  /home/wangjian/nomicore/packages/vfsl-protocol \
  /home/wangjian/nomicore/packages/vfsl-codegen \
  /home/wangjian/nomicore/packages/doc-runtime \
  /home/wangjian/nomicore/packages/clock \
  /home/wangjian/nomicore/packages/persistence \
  /home/wangjian/nomicore/packages/namespace-runtime \
  /home/wangjian/nomicore/packages/namespace-registry
```

宿主还需自行安装 Cordis、Timer、TypeScript 和用于当前源码联调的 TS 执行器，例如：

```bash
pnpm add @deepseek-ai/cordis @deepseek-ai/cordis-plugin-timer yjs
pnpm add -D typescript tsx
```

当前本机链接的 Nomicore packages 直接 export TypeScript 源码，因此宿主开发工具链必须能处理 ESM TypeScript。正式 npm 包应改为消费编译后的 `dist`，但不改变本文的生成和类型检查模型。

## 3. 从宿主项目生成投影

当前 codegen CLI 的 `--domains` 参数接收的是**包含 `domains/` 的宿主项目根目录**。在宿主根目录运行：

```bash
pnpm exec tsx \
  /home/wangjian/nomicore/packages/vfsl-codegen/src/cli.ts \
  --domains .
```

生成器会读取：

```text
domains/inventory/schema.vfsl
```

并写出：

```text
domains/inventory/generated.ts
```

不要直接编辑 `generated.ts`。需要改变类型时修改 `schema.vfsl`，然后重新生成。

可在宿主 `package.json` 中把本机路径封装为脚本：

```json
{
  "scripts": {
    "nomicore:generate": "tsx /home/wangjian/nomicore/packages/vfsl-codegen/src/cli.ts --domains .",
    "nomicore:generate:check": "tsx /home/wangjian/nomicore/packages/vfsl-codegen/src/cli.ts --domains . --check",
    "typecheck": "tsc --noEmit"
  }
}
```

绝对路径脚本仅用于本机联调，不应作为可移植的团队或 CI 契约。Nomicore 发布后，脚本应改为包提供的稳定 CLI 命令。

## 4. 让 TypeScript 加载生成投影

`generated.ts` 会增广 `@nomicore/vfsl-protocol` 的 `VfslPathMap`。宿主的 TypeScript program 必须包含生成文件，否则增广不会生效。

宿主 `tsconfig.json` 至少包含：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true
  },
  "include": [
    "src/**/*.ts",
    "domains/**/*.ts"
  ]
}
```

`generated.ts` 只有类型声明和 `import type`，没有运行时副作用，但它必须进入**消费业务代码的同一个 TypeScript Program**，module augmentation 才会生效。仅生成、提交文件，或者让另一个无关 tsconfig 编译它，都不能让业务 package 看到类型。

先检查消费 package 的完整 tsconfig 继承链、构建/typecheck 脚本、`rootDir`、`include`/`files`、project references、emit 模式和 package 边界守卫。用以下命令取得证据：

```bash
pnpm exec tsc -p packages/<consumer>/tsconfig.json --listFilesOnly
```

输出必须包含消费源码和准确的 `domains/<domain>/generated.ts`。

按约束选择一种接线方式：

### A. 同一 Program 允许包含仓库级 projection

可以直接把特定 generated 文件加入 `include`，或者在 package 内增加类型入口：

```ts
// packages/<consumer>/src/nomicore-schema.d.ts
import type {} from '../../../../domains/inventory/generated.js'
```

相对路径从类型入口出发。确保 `.d.ts` 本身被 `include`/`files` 纳入。`import type {}` 不产生运行时 import，但会把目标 generated 模块拉进 TypeScript Program。

### B. 普通 build 不能越过 `rootDir`，no-emit typecheck 可以

保留 package-local build tsconfig，只编译/emit `src/`；另建 `tsconfig.typecheck.json` 和类型入口：

```text
packages/<consumer>/
├── src/
├── typecheck/nomicore-schema.d.ts
├── tsconfig.json
└── tsconfig.typecheck.json
```

```ts
// typecheck/nomicore-schema.d.ts
import type {} from '../../../../domains/inventory/generated.js'
```

类型检查配置使用 `noEmit: true`，包含 `src/**/*.ts` 与 `typecheck/**/*.d.ts`，并移除 `rootDir` 或把它提升到覆盖仓库级 projection 的目录。package CI 和仓库 CI 都必须运行这个 projection-aware typecheck；普通 build 仍保持 package-local emit。

### C. 任何 Program 都禁止读取 package 外文件

将 projection **直接生成**到 package 允许的 source/type 目录，例如 `src/generated/nomicore-schema.ts`：

```bash
pnpm generate --domains /path/to/host --domain inventory \
  --out packages/inventory/src/generated/nomicore-schema.ts
pnpm generate --domains /path/to/host --domain inventory \
  --out packages/inventory/src/generated/nomicore-schema.ts --check
```

`--domain` 与 `--out` 必须同时提供；相对输出路径按 `--domains` 根解析。`schema.vfsl` 仍是唯一可编辑真相，CI 用 `--check` 做逐字节 freshness gate。迁移到 package-local projection 后删除旧默认 projection，不手工复制或维护第二份 projection。

不要把整个仓库的 `domains/**/*.ts` 加入每个 package：同一 Program 中所有 `VfslPathMap` augmentation 会合并，无关 schema 会污染路径表，相同顶层字段还可能发生声明冲突。每个 package 只接入自己消费的 projection。

最后增加防退化类型守卫，同时证明“已加载”与“fail closed”：

```ts
import type { PathAt, PathPatchValue, VfslPathMap } from '@nomicore/vfsl-protocol'

type Quantity = PathPatchValue<
  PathAt<VfslPathMap, ['items', string, 'quantity']>
>

const valid: Quantity = 12
// @ts-expect-error quantity 必须是 number
const invalid: Quantity = 'twelve'

type Missing = PathPatchValue<
  PathAt<VfslPathMap, ['items', string, 'missing']>
>
// @ts-expect-error 未知路径必须 fail closed 为 never
const missing: Missing = 'x'
```

守卫中的路径和值必须来自实际 schema。已知路径精确解析、未知路径拒绝，再加 `--listFilesOnly` 中出现准确生成文件，三者全部成立才算接线完成。

## 5. 把运行时 Lease 适配成类型安全访问面

当前 `NamespaceLease` 的公共运行时方法为了验证敌意输入，接受动态路径和 `unknown` mutation；生成器提供的 `VfslTypedAccess<VfslPathMap>` 是编译期访问协议。二者不是同一个对象类型，宿主应在自己的 Nomicore 集成边界写一个薄适配器，而不是在每个业务调用点使用类型断言。

例如 `src/typed-namespace.ts`：

```ts
import type { NamespaceLease } from '@nomicore/namespace-registry'
import type {
  PathAt,
  PathElementValue,
  PathPatchValue,
  PathValue,
  VfslPathMap,
} from '@nomicore/vfsl-protocol'

export class TypedNamespace {
  constructor(private readonly lease: NamespaceLease) {}

  read<const P extends readonly string[]>(
    path: P,
  ): PathValue<PathAt<VfslPathMap, P>> {
    const result = this.lease.readData(path)
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
    return result.value as PathValue<PathAt<VfslPathMap, P>>
  }

  async set<const P extends readonly string[]>(
    path: P,
    value: PathPatchValue<PathAt<VfslPathMap, P>>,
  ): Promise<void> {
    const result = await this.lease.mutateData({ op: 'set', path, value })
    if (!result.ok) {
      throw new Error(result.issues.map(issue => `${issue.code}: ${issue.message}`).join('\n'))
    }
  }

  async append<const P extends readonly string[]>(
    path: P,
    value: PathElementValue<PathAt<VfslPathMap, P>>,
  ): Promise<void> {
    const current = this.read(path)
    const result = await this.lease.mutateData({
      op: 'array-insert',
      path,
      index: Array.isArray(current) ? current.length : 0,
      values: [value],
    })
    if (!result.ok) {
      throw new Error(result.issues.map(issue => `${issue.code}: ${issue.message}`).join('\n'))
    }
  }
}
```

适配器中的断言只位于运行时校验结果与生成类型之间的受控边界。Nomicore 仍会在运行时依据 namespace 自带的 SCHEMA 校验 mutation；TypeScript 类型不能替代运行时校验。

> 注意：mutation 的实际 `op` 名称与输入形状必须以 `@nomicore/doc-runtime` / `NamespaceLease.mutateData()` 当前公开契约为准。当前底层数组写操作是 `array-insert` 和 `array-delete`，没有独立的 `array-append`；上面的 `append()` 先读取当前数组长度，再转换为 `array-insert`。它不是并发原子 append，存在并发写入时宿主应直接使用满足业务并发语义的操作或上层协调机制。如果升级 Nomicore 后 mutation 联合改变，应先更新这个单一适配器。

## 6. 生成最小、可合并、有语义的 mutation

每个业务写入应同时满足三个标准：

1. **最小化**：生成能完成目标变更的最小 mutation，只触及 schema 中预期改变的节点；
2. **协作友好**：保留不相关的 Yjs 节点，让多方同时修改不同字段、Record 条目或数组位置时能够合并，并把冲突面压缩到实际竞争的节点；
3. **语义明确**：mutation 的操作和路径直接说明业务变化，例如“设置数量”“删除可选备注”“在标签数组插入元素”，而不是通过替换某份快照间接表达。

因此，普通业务写入应定位到 **schema 中最窄可独立写入路径**：

- 标量字段：`set` 到最后的 leaf 路径；
- optional 字段或 `Record` 条目：在该字段/条目路径执行 `set` 或 `delete`；
- `YArray`：在数组路径执行 `array-insert` / `array-delete`；
- `YPlainArray`、`YLeaf` 和 `YXmlFragment`：它们是不可下钻终态，业务确实要修改时整体 `set` 该终态值；
- 未改变的父容器和兄弟字段保持原位。

实现前先用一句话命名业务变更，再映射成 mutation：

| 业务变更 | mutation |
| --- | --- |
| 修改一个字段 | 在该字段终态路径执行 `set` |
| 新增或替换一个 Record 条目 | 在该条目路径执行 `set` |
| 删除 Record 条目或 optional 字段 | 在该路径执行 `delete` |
| 插入有序元素 | 在数组路径执行 `array-insert`，显式给出 index |
| 删除有序元素 | 在数组路径执行 `array-delete`，显式给出 index/count |
| 修改刻意不透明的整体值 | 在对应 `plain`/leaf/XML 终态执行 `set` |

例如只修改库存数量：

```ts
await lease.mutateData({
  op: 'set',
  path: ['items', itemId, 'quantity'],
  value: 12,
})
```

以下做法是普通业务更新的反例：

```ts
// 反例：读取完整 ROOT，在内存中重建，然后 set([]) 替换整个 ROOT。
const root = lease.readData([])
if (!root.ok) throw new Error(root.message)

await lease.mutateData({
  op: 'set',
  path: [],
  value: {
    ...root.value,
    items: {
      ...root.value.items,
      [itemId]: {
        ...root.value.items[itemId],
        quantity: 12,
      },
    },
  },
})
```

底层契约允许 `set([])`，但它是显式的**整 ROOT 替换**：旧 Yjs 子类型引用失效，不做 identity-preserving diff。用它模拟单字段更新会扩大写入和冲突范围，可能覆盖读取之后发生的并发修改，并浪费 VFSL 载体对同步粒度的建模。它只适用于经过专门并发控制和生命周期编排的管理迁移/整库替换，不用于日常业务写入。

同理，修改对象的一个子字段时，不应重建并替换整个父对象；继续下钻到最后一个可独立写入的终态。运行时仍会在 mutation 提交前验证完整 ROOT，并在失败时保持零写入，因此“窄路径写入”同时保留 Yjs 协作粒度和 VFSL 完整校验。

如果一个业务命令确实改变多个彼此独立的节点，应分别生成对应的最小 mutation，并明确该命令允许部分成功还是需要上层事务/补偿编排。不能为了把多项变化塞进一次调用而退化成父对象或完整 ROOT 替换。

并发测试至少应覆盖“两方修改不同叶子/不同 Record 条目，最终两项变化都保留”；若双方修改同一个终态，则只把该终态视为实际冲突范围，而不是让整个父对象或 ROOT 参与竞争。

## 7. 在宿主业务代码中读写

`src/inventory-service.ts`：

```ts
import type { NamespaceLease } from '@nomicore/namespace-registry'
import { TypedNamespace } from './typed-namespace.js'

export async function updateInventory(lease: NamespaceLease): Promise<void> {
  const namespace = new TypedNamespace(lease)
  const itemId = 'item-001'

  await namespace.set(['items', itemId, 'name'], 'Keyboard')
  await namespace.set(['items', itemId, 'quantity'], 12)
  await namespace.append(['items', itemId, 'tags'], 'featured')

  const quantity = namespace.read(['items', itemId, 'quantity'])
  quantity.toFixed(0) // quantity 被推导为 number

  // 以下代码应被 TypeScript 拒绝：
  // await namespace.set(['items', itemId, 'quantity'], 'twelve')
  // await namespace.set(['items', itemId, 'missingField'], 'x')
  // await namespace.append(['items', itemId, 'name'], 'x')
}
```

路径必须保持字面量元组，才能得到精确推导。直接传递数组字面量通常可由 `const` 泛型保留；复用路径时使用 `as const`：

```ts
const quantityPath = ['items', 'item-001', 'quantity'] as const
const quantity = namespace.read(quantityPath)
```

不要先把路径扩大为 `string[]`：

```ts
const path: string[] = ['items', 'item-001', 'quantity']
// path 已失去各段的字面量信息，无法提供精确的路径类型检查。
```

## 8. 创建 namespace 时仍使用同一份 schema

生成类型和运行时 SCHEMA 必须来自同一个 `schema.vfsl`。宿主创建 namespace 时应读取该文件文本，组装信封并传给 Registry，而不是在业务代码中复制一份 schema 字符串。

概念示例：

```ts
import { readFile } from 'node:fs/promises'
import type { NamespaceRegistry } from '@nomicore/namespace-registry'

export async function createInventoryNamespace(registry: NamespaceRegistry) {
  const text = await readFile(
    new URL('../domains/inventory/schema.vfsl', import.meta.url),
    'utf8',
  )

  return registry.create({
    owner: { userId: 'acme-user' },
    schema: {
      lang: 'vfsl',
      version: 1,
      id: 'inventory@1',
      text,
    },
    root: {
      items: {},
    },
  })
}
```

部署时必须把 `schema.vfsl` 作为宿主应用资源一并交付，或在构建阶段以不产生第二份可独立维护副本的方式嵌入。`generated.ts` 只提供静态类型，不能代替运行时 SCHEMA 文本。

## 9. 宿主项目的验证流程

每次修改 schema 后，在宿主项目执行：

```bash
pnpm nomicore:generate
pnpm nomicore:generate:check
pnpm typecheck
pnpm test
```

推荐把 `nomicore:generate:check` 和 `typecheck` 加入宿主 CI。验收标准：

- `schema.vfsl` 可以解析和求值；
- `generated.ts` 已刷新且入仓；
- 生成 diff 与 schema 修改一致；
- 所有 namespace 路径和值通过宿主 TypeScript typecheck；
- 业务测试仍覆盖运行时失败结果和零写入行为。

## 10. 多领域限制

每个 `generated.ts` 都通过 module augmentation 增广同一个 `VfslPathMap`。因此，若一个 TypeScript program 同时包含多个领域，而它们的 ROOT 顶层字段同名但类型不兼容，TypeScript 会报告声明合并冲突；即使不冲突，全局表也表示这些领域路径的并集，而不是某一个 namespace 的独立类型。

当前安全做法是：

- 不同领域使用不冲突的 ROOT 顶层字段；或
- 为不同领域使用独立的 TypeScript project/tsconfig 边界；
- 不要通过手写类型或 `any` 掩盖冲突。

在 Nomicore 提供按 schema/domain 参数化的独立生成类型之前，不应声称单个 `VfslPathMap` 能静态区分多个不同 namespace schema。

## 11. 职责边界

宿主项目负责：

- 自己的领域目录、VFSL schema、生成物和业务代码；
- 自己的 Cordis host、配置、Persistence 选择和生命周期；
- 自己的 typecheck、测试、构建、部署及 schema 资源交付。

Nomicore 负责：

- VFSL 解析、求值和运行时校验；
- 从 schema 生成 TypeScript 路径投影；
- Namespace Runtime、Registry、Lease 和 Persistence 接缝；
- 写入失败时的结构化结果和零写入保证。

这种关系是“独立宿主项目依赖 Nomicore 模块”，不是“把宿主项目放进 Nomicore 仓库”。
