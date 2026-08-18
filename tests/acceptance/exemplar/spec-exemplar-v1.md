# VFSL v1 方言规格文档（契约示例）

> ⚠️ 本文件是 SA6 验收机制的**契约示例 fixture，不是 issue #4 的交付物**。
> 实现方（SA3）须按本示例的结构与机器契约撰写真实规格于 `docs/vfsl/v1-spec.md`，
> 并可通过 `python3 tests/acceptance/vfsl_spec_acceptance.py` 的绿路径验证。

## 1. 语法子集（EBNF）

v1 冻结语法子集，覆盖 PRD #3 Implementation Decisions 列出的全部允许语法：
类型别名、封闭对象字面量、`?:` 可选属性、原始类型、字面量联合、`T[]`、
`Record<K, V>`、`string & Pattern<"正则">`（唯一允许的交叉类型）、注释。

```ebnf
(* VFSL v1 冻结子集 — EBNF，覆盖 PRD #3 全部允许语法 *)
TypeAlias     = "type", Ident, "=", TypeExpr, ";" ;
TypeExpr      = ObjectType | UnionType | ArrayType | RecordType | PatternType
              | PrimitiveType | LiteralType | Marker ;
Marker        = "YMap", "<", ObjectType, ">"
              | "YArray", "<", TypeExpr, ">"
              | "YPlainArray", "<", TypeExpr, ">"
              | "YLeaf", "<", TypeExpr, ">"
              | "YXmlFragment", "<", ObjectType, ">" ;
ObjectType    = "{", [ FieldList ], "}" ;
FieldList     = Field, { ",", Field } ;
Field         = Ident, [ "?" ], ":", TypeExpr ;
UnionType     = TypeExpr, "|", TypeExpr ;
ArrayType     = TypeExpr, "[", "]" ;
RecordType    = "Record", "<", TypeExpr, ",", TypeExpr, ">" ;
PatternType   = "string", "&", "Pattern", "<", StringLiteral, ">" ;
LiteralType   = StringLiteral | NumberLiteral ;
PrimitiveType = "string" | "number" | "boolean" | "null" | "unknown" ;
StringLiteral = '"', { char }, '"' ;
NumberLiteral = digit, { digit } ;
Comment       = LineComment | BlockComment | DocComment ;
LineComment   = "//", { char }, eol ;
BlockComment  = "/*", { char }, "*/" ;
DocComment    = "/**", { char }, "*/" ;
Ident         = letter, { letter | digit | "_" } ;
```

## 2. 标记类型语义定义

六个标记类型，大小写是契约（见 §6 大小写契约）。每个标记定义
Yjs 物化含义、写入粒度与 PATCH 可否下钻。

### YMap

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 映射为 Yjs `Y.Map`，字段集合同步到文档 | 属性级 | 可下钻 |

### YArray

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 映射为 Yjs `Y.Array`，元素序列参与同步 | 元素级 | 可下钻 |

### YPlainArray

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 普通 JS 数组，不进入 Yjs 文档，仅作整体承载 | 整体级 | 不可下钻 |

### YLeaf

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 标量叶子值（string/number/boolean/null/unknown），Yjs 不感知内部结构 | 值级 | 不可下钻 |

### YXmlFragment

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 映射为 Yjs `Y.XmlFragment`，子节点（如文本、元素）可区分 | 子节点级 | 可下钻 |

### Pattern

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 字符串键约束（`string & Pattern<"正则">` 的右侧约束类型），无独立 Yjs 物化 | 类型级 | 不可下钻 |

## 3. 禁止清单与错误语义

越界构造逐项列出，违反即结构化错误：错误码 + 消息 + 行列（line/column）。

| 禁止构造 | 违反示例 | 错误类型 | 行列信息 |
| --- | --- | --- | --- |
| any | `type T = any;` | VFSL-E101 | 构造起点行列 |
| 自定义泛型 | `type Box<T> = { value: T };` | VFSL-E102 | 行 + 列 |
| 条件类型 | `type T = A extends B ? C : D;` | VFSL-E103 | line/column |
| mapped type | `type T = { [K in Keys]: V };` | VFSL-E104 | 行列 |
| interface 继承 | `interface A extends B {}` | VFSL-E105 | 行列 |
| 递归 / 循环引用 | `type A = { b: B }; type B = { a: A };` | VFSL-E106 | 行列 |

递归与循环引用（别名引用图成环，含自引用与互引用）一律拒绝，错误同样含行列。

## 4. 注释规则

- `//` 与 `/* */` 忽略：不产生任何 IR 节点。
- `/** */` 原文捕获：注释内容逐字保留，挂载到相邻 IR 节点——类型别名处、
  属性处、标记类型处；不受标记语法干扰。
- `@tag` 不做机器解析，原文保留（ADR-0001：本方言无机器标签）。

## 5. 大小写契约

标记类型六个，大小写是契约：

`YMap`、`YArray`、`YPlainArray`、`YLeaf`、`YXmlFragment`、`Pattern`

`YLEaf`、`yleaf`、`ymap`、`yarray` 等大小写变体不属于已知名，按未知名报错。

## 6. 信封形状

```json
{
  "lang": "vfsl",
  "version": 1,
  "id": "<文档标识>",
  "text": "<VFSL 文本>"
}
```

parser 只消费 `text` 字段；信封解析与方言路由（未知方言只读）是后续引擎任务，出范围。

## 7. 方言演进

v1 方言冻结语义：只增不改。对历史文本的解释以文本自述版本为准。

## 8. 附录：vfs3.assets fixture

> 本 fixture 依据 issue #9 描述还原（原设计文档《yjs-server Namespace Schema
> 自描述体系》缺位）；作为规格的自含正例，供 issue #9 直接引用。

```vfsl
/** vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） */

/** 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|" */
type AssetId = string & Pattern<"^[A-Za-z0-9_\\-]{1,64}$">;

/** 审计信息：所有写入留痕 */
type Audit = YMap<{
  createdBy: YLeaf<string>;
  createdAt: YLeaf<number>;
}>;

/** 资产实体：按 kind 判别的封闭联合 */
type AssetEntity =
  | { kind: "image"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number>; audit: Audit }
  | { kind: "text"; body: YLeaf<string>; audit: Audit }
  | { kind: "file"; name: YLeaf<string>; size: YLeaf<number>; tags: YArray<YLeaf<string>>; audit: Audit };

/** 附件：与 Yjs 无关的纯数组 */
type Attachments = YPlainArray<YLeaf<string>>;

/** AssetsDoc：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 */
type AssetsDoc = YXmlFragment<{
  assets: Record<AssetId, AssetEntity>;
  attachments: Attachments;
  audit: Audit;
  /** @semantic 可选说明字段 */
  notes?: YLeaf<string>;
  keywords: YLeaf<string>[];
}>;
```
