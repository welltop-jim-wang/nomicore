# VFSL Schema 编写指南

本指南面向编写或修改 `domains/*/schema.vfsl` 的 agent。它把常用决策与交付步骤整理成操作指南；语法和语义的最终权威仍是 [`v1-spec.md`](./v1-spec.md)。领域词汇以根目录 [`CONTEXT.md`](../../CONTEXT.md) 为准，生成链路以 [ADR 0005](../adr/0005-projection-generation-pipeline.md) 为准。

## 编写流程

### 1. 确认领域边界

先阅读目标领域的需求、现有 schema、测试和导出。列出：

- 文档根包含哪些字段；
- 每个字段是同步容器还是整体值；
- 动态键的约束；
- 判别联合的判别字段；
- 哪些字段可选。

Schema 只表达 VFSL v1 的结构和值约束。权限、authority 规则、业务状态机、迁移流程和传输协议属于上层。此步完成标准：每个需求字段都能归入上述一种 schema 职责，超出职责的规则已留在上层设计中。

### 2. 建立领域目录和身份

每个领域放在 `domains/<domain>/`，schema 源文件固定为 `schema.vfsl`。当前生成器要求一域一 schema，并由 schema source 提供满足 `<domain>@<digits>` 的 id；去掉版本后缀所得 id base 必须等于领域目录名，生成物固定为 `domains/<domain>/generated.ts`。

现有仓库 schema 文件顶部使用以下元数据注释，新增领域沿用该布局：

```vfsl
// @lang: vfsl
// @id: inventory@1
// @version: 1
```

### 3. 先定义可复用别名，再定义 ROOT

VFSL v1 模块由 `type` 别名组成，每个声明必须以 `;` 结束。每个模块必须恰好有一个大写的 `ROOT`，且 ROOT 必须是 map 形：裸对象、`YMap`、`Record` 或全 map 形联合。

推荐按“键约束 → 值对象 → 联合 → ROOT”的顺序组织：

```vfsl
type ItemId = string & Pattern<"^[A-Za-z0-9_-]{1,64}$">;

type Item = YMap<{
  name: YLeaf<string>;
  quantity: YLeaf<number>;
}>;

type ROOT = YMap<{
  items: Record<ItemId, Item>;
}>;
```

别名引用必须存在且无循环；无人引用的别名不会物化进文档。

### 4. 按写入粒度选择载体

载体选择决定 Yjs 物化、下钻能力和写入粒度。

| 需求 | 写法 | 运行时形态 | 写入方式 |
| --- | --- | --- | --- |
| 封闭对象、字段需独立同步 | `{ ... }` 或 `YMap<{ ... }>` | `Y.Map` | 属性级，可下钻 |
| 有序序列、元素需独立同步 | `T[]` 或 `YArray<T>` | `Y.Array` | insert/delete，可下钻 |
| 数组只需整体保存 | `YPlainArray<T>` | 单个普通 JSON 数组值 | 整体替换，不可下钻 |
| 标量或标量联合 | 原始类型或 `YLeaf<T>` | Yjs 原生叶子值 | 整体赋值，不可下钻 |
| XML 内容 | `YXmlFragment<{ ... }>` | `Y.XmlFragment` | 整体替换，不可下钻 |
| 动态字符串键对象 | `Record<K, V>` | `Y.Map` | 按键写入，可下钻 |

裸对象、裸数组和标量已有默认物化；显式标记适合强调结构意图。`YXmlFragment` 的对象实参只记录文档语义，不定义 XML 元素映射；逻辑值是良构 XML 字符串。

`YPlainArray<T>` 的整个 T 子树是普通 JSON 值上下文。其内使用裸对象、裸数组、`Record`、标量、`YLeaf` 和 `Pattern`；同步标记 `YMap`、`YArray`、`YXmlFragment` 即使经别名间接引入也不合法。

### 5. 表达值约束

VFSL v1 常用值类型：

```vfsl
type Primitive = string | number | boolean | null | unknown;
type Status = "draft" | "published";
type Port = 80 | 443;
type Slug = string & Pattern<"^[a-z0-9-]+$">;
type OptionalField = { description?: string };
```

注意：

- 数字字面量仅支持无符号十进制整数；
- 字符串只支持 `\"` 和 `\\` 转义，正则里的 `\d` 在 schema 文本中写成 `\\d`；
- `Pattern` 只写作 `string & Pattern<"...">`，锚定需显式写 `^` 和 `$`；
- Pattern 的 ECMAScript 正则合法性在运行时语义校验阶段暴露；
- 布尔值用 `boolean`，不是 `true | false`；
- 对象默认封闭，未声明字段会被拒绝；`?` 表示字段可缺失。

### 6. 正确设计联合

在同步物化上下文中，联合成员必须全部是标量形，或全部是容器形。标量和容器混合会被拒绝。

判别联合使用共同的字符串字面量字段，并让每个成员保持对象形：

```vfsl
type Asset =
  | { kind: "image"; url: string; width: number; height: number }
  | { kind: "text"; body: YXmlFragment<{ format: "rich-text" }> };
```

联合对象的键空间是所有成员字段的并集，但具体值仍须完整匹配其中一个成员。普通 JSON 的混合形状联合仅能放在 `YPlainArray` 的纯值子树中。

### 7. 写可挂载的文档注释

使用紧邻声明、字段或标记的 `/** ... */` 文档注释记录领域含义。`//` 和普通 `/* ... */` 只作说明，不进入 IR。文档注释必须能挂载到后续声明性节点；文件末尾悬空的文档注释会报错。`@tag` 在 v1 中仅作为原文保存，不产生机器语义。

```vfsl
/** 订单当前状态 */
type Status = "draft" | "submitted";

type ROOT = YMap<{
  /** 外部系统可见的订单标识 */
  orderId: string;
}>;
```

## v1 语法护栏

只使用以下构造：类型别名、封闭对象、可选字段、原始类型、字符串或整数文字、联合、数组、`Record`、六个标准标记和注释。

以下 TypeScript 构造不属于 VFSL v1：`interface`、`extends`、泛型别名、函数类型、tuple、enum、索引签名、`readonly`、`keyof`、条件类型、映射类型、交叉类型（Pattern 特例除外）以及括号分组。标记拼写严格区分大小写：`YMap`、`YArray`、`YPlainArray`、`YLeaf`、`YXmlFragment`、`Pattern`。

遇到表达能力不足时，先核对 [`v1-spec.md`](./v1-spec.md)；需要改变方言时走规格和 ADR 修订，而不是把 TypeScript 语法直接写进 schema。

## 校验 Schema 和 ROOT 数据

以下命令都从仓库根目录运行。

### 直接校验一个 schema

```bash
pnpm schema:check ./path/to/schema.vfsl
```

该命令直接读取指定文件，运行 `parseVfsl` 和 `evaluate`，不要求文件位于 `domains/`，也不写入 `generated.ts`。语法错误、未知别名、非法标记实参、ROOT 错误和循环引用会以退出码 1 拒绝，并在 stderr 输出行列与 VFSL 错误码；合法时退出 0 并输出 `Schema valid`。文件读取错误或命令参数错误使用退出码 2。

### 用 schema 校验 ROOT 数据

ROOT 数据必须是普通 JSON 逻辑快照，而不是 `Y.Doc`、`Y.Map` 或 `Y.Array`。从文件读取：

```bash
pnpm schema:check ./path/to/schema.vfsl --data ./path/to/root.json
```

从 stdin 读取：

```bash
cat ./path/to/root.json | pnpm schema:check ./path/to/schema.vfsl --data -
```

也可以直接传入：

```bash
printf '%s' '{"title":"hello","items":[]}' |
  pnpm schema:check ./path/to/schema.vfsl --data -
```

工具先校验 schema，再以其派生 value schema 调用 `validateLogicalSnapshot` 校验完整 ROOT。数据不符合 schema 时退出 1，并以 `$` 开头的 JSON path 报告全部可收集问题，例如 `$.items[0].name`；JSON 无法解析或文件无法读取时退出 2。看到 `Schema valid` 和 `ROOT data valid` 且退出码为 0，才表示两层校验均通过。

### 领域生成与完整验证

直接校验通过后，领域内 schema 还必须刷新并验证生成投影：

1. `pnpm generate`：解析并求值全部 `domains/*/schema.vfsl`，写出 `generated.ts`；
2. 审查 schema 与 `generated.ts` 的 diff，生成物只应反映预期投影；
3. `pnpm generate --check`：重新生成到内存并逐字节比较，确认无缺失、过期或孤儿生成物；
4. `pnpm typecheck`：确认协议投影、路径类型和领域消费代码成立；
5. `pnpm test`：确认 parser、evaluator、CLI、codegen 和领域契约回归通过；
6. `git diff --check`：确认补丁格式干净。

推荐流程：

```bash
pnpm schema:check ./domains/<domain>/schema.vfsl --data ./root-example.json &&
pnpm generate &&
pnpm generate --check &&
pnpm typecheck &&
pnpm test &&
git diff --check
```

`pnpm generate --check` 只检查生成物新鲜度，不替代 `schema:check --data` 的样例数据验证。任一步非零退出都表示 schema 交付尚未完成。`generated.ts` 是生成物；需要改变其结构时修改 schema 或 `@nomicore/vfsl-codegen`，然后重新生成，不直接维护生成文件。

## 提交前检查表

- [ ] 领域目录、schema id base 和生成路径一致；
- [ ] 模块恰有一个 map 形 `ROOT`；
- [ ] 所有别名可解析、无重复、无循环；
- [ ] 每个字段的载体符合所需写入粒度和下钻能力；
- [ ] `YPlainArray` 子树不含同步标记；
- [ ] 同步上下文中的联合没有混合标量形与容器形；
- [ ] 动态键使用 string 形 `Record` 键，Pattern 转义和锚定正确；
- [ ] 文档注释紧邻目标且无悬空；
- [ ] 未使用 VFSL v1 之外的 TypeScript 构造；
- [ ] 生成物已刷新，generate check、typecheck、tests 和 diff check 全部通过。
