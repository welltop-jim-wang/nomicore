# VFSL v1 方言规格（VFSL Dialect — version 1）

> 状态：已冻结（v1 frozen）｜ 演进规则：只增不改（§8）
> 本规格是 VFSL v1 方言的唯一规范来源：语法子集（§2）、六个标记类型语义（§3）、
> 禁止清单与结构化错误（§4）、注释规则（§5）、大小写契约（§6）、信封形状（§7）、
> 方言演进（§8）、实现自由度与未冻结项（§9）、参考 fixture（附录 §10）。
> 上游需求：PRD issue #3。附录 fixture 依据 issue #9 描述还原。

## 1. 概述与范围

VFSL（VF Schema Language）是 Namespace Schema 的单一真相源文本方言：以
TypeScript 的一个冻结子集书写，用标记类型表达 Yjs 物化语义。parser（issue #5~#9）
按本规格实现；文本之外的一切以本规格为输入另行发展。

范围内：v1 语法与语义的全部规范条款（§2~§9）与参考 fixture（附录 §10）。

出范围（out of scope）：

- parser 实现与 IR 具体形状——公共接缝 `parseVfsl(text)` → `{ ok: true, module }` 或 `{ ok: false, issues }`（PRD #3 冻结）；
- 求值器（结构树 / 值 schema 派生）、路径索引、`validateSnapshot`、编译缓存；
- 信封解析与方言路由（未知方言 loud-fail 只读）；
- JSDoc 标签的结构化解析（语义层任务；本方言无机器标签——ADR-0001 主题）；
- yjs-server 服务端（WS/REST、存储、同步协议、namespace 生命周期与创建事务）；
- schema 升级 / 迁移（Phase 3）。

术语：本规格自含全部术语定义；「物化」指某类型按其标记对应的 Yjs 运行时结构
（Y.Map / Y.Array / Y.XmlFragment / 原生值）承载的方式。

## 2. 语法子集（EBNF）

v1 冻结的允许语法：类型别名；封闭对象字面量类型（未声明字段拒绝的语义基础）；
`?:` 可选属性；原始类型 `string` / `number` / `boolean` / `null` / `unknown`；
字面量联合；`T[]`；`Record<K, V>`；`string & Pattern<"正则">`（唯一允许的交叉
类型）；注释。

```ebnf
(* VFSL v1 冻结语法子集；char/digit/letter/eol 为词法元符号，由 tokenizer 直接实现 *)
Module        = { TypeAlias } ;
TypeAlias     = "type", Ident, "=", TypeExpr, ";" ;
TypeExpr      = UnionType ;
UnionType     = [ "|" ], ArrayType, { "|", ArrayType } ;
ArrayType     = PrimaryType, { "[", "]" } ;
PrimaryType   = RecordType | ObjectType | Marker
              | PatternType | LiteralType | PrimitiveType | TypeRef ;
RecordType    = "Record", "<", TypeExpr, ",", TypeExpr, ">" ;
ObjectType    = "{", [ FieldList ], "}" ;
FieldList     = Field, { ( ";" | "," ), Field }, [ ";" | "," ] ;
Field         = Ident, [ "?" ], ":", TypeExpr ;
Marker        = "YMap", "<", TypeExpr, ">"
              | "YArray", "<", TypeExpr, ">"
              | "YPlainArray", "<", TypeExpr, ">"
              | "YLeaf", "<", TypeExpr, ">"
              | "YXmlFragment", "<", TypeExpr, ">" ;
PatternType   = "string", "&", "Pattern", "<", StringLiteral, ">" ;
LiteralType   = StringLiteral | NumberLiteral ;
PrimitiveType = "string" | "number" | "boolean" | "null" | "unknown" ;
TypeRef       = Ident ;
Comment       = LineComment | BlockComment | DocComment ;
LineComment   = "//", { char }, eol ;
BlockComment  = "/*", { char }, "*/" ;
DocComment    = "/**", { char }, "*/" ;
StringLiteral = '"', { char }, '"' ;
NumberLiteral = digit, { digit } ;
Ident         = letter, { letter | digit | "_" } ;
```

语法注记（与文法同等效力）：

1. **优先级与结合**：`|`（联合）最低；`[ ]` 后缀紧贴其前置 PrimaryType——
   `string & Pattern<"a">[]` 是「约束字符串的数组」，`A | B[]` 是 `A | (B[])`。
   同层联合记号自左向右，无结合性歧义。
2. **前导 `|`**：联合允许 TS 风格前导分隔符（`type T = | A | B;`），文法以
   `[ "|" ]` 冻结。
3. **字段分隔符**：对象字段以 `;` 或 `,` 分隔，二者等价；允许尾分隔符
   （`{ a: string; }` 与 `{ a: string }` 均合法）；空对象 `{}` 合法。
4. **别名终止与模块**：每个类型别名必须以 `;` 终止；模块为别名的任意序列，
   可为空（空文本合法，产出空模块）。
5. **无括号分组**：括号分组类型（如 `( A | B )[]`）不在 v1 子集，出现即
   VFSL-E100。`<` 与 `>` 仅作为 Marker 与 Record 的实参括号。
6. **字符串字面量**：以 `"` 界定，不得跨行（未闭合 → VFSL-E201）；仅认 `\"` 与
   `\\` 两个转义（`\"`→`"`、`\\`→`\`），其余任何 `\x` 序列非法（→ VFSL-E202）。
   正则实参中的反斜杠须按此规则双写（正则 `\d` 写作 `\\d`）。
7. **数字字面量**：仅无符号十进制整数。负数、小数、其他进制不在 v1 子集
   （→ VFSL-E100）。
8. **字面量联合成员种类**：v1 冻结为字符串字面量与数字字面量两类；`true` /
   `false` / `null` 字面量不进入 LiteralType（布尔与空值语义由原始类型
   `boolean` / `null` 表达）。`true` / `false` 词法上是普通 Ident（不在保留名
   集合，§4）：未声明引用按 **VFSL-E301** 报未知名（与 §6 `yleaf` 同构），
   亦可被声明为普通别名。
9. **空白与注释是词法级 trivia**：空白（空格 / 制表 / 行结束）与注释可出现于
   **任意记号边界**，不参与语法推导——本节全部产生式均按「剥离 trivia 后的
   记号序列」解释；记号**内部**不容 trivia（`str/**/ing` 是两个记号，不可推导，
   → VFSL-E100）。`Comment` 系列产生式（Comment / LineComment / BlockComment /
   DocComment）因此不出现在任何语法产生式的右部：它们仅规范注释**自身的词法
   形状**（起止界定与未闭合判定），是 VFSL-E203 判定与 §5 原文捕获的依据。
10. **词法元符号 `char` 的双语义**：StringLiteral 的 char **不含行终止**（字符串
   跨行即未闭合 → VFSL-E201，注记 6「不得跨行」由此实现）；注释产生式
   （LineComment / BlockComment / DocComment）的 char **含行终止**——多行块
   注释 / 文档注释由此可能，§5 原文捕获「逐字保留，含内部 `*` 与缩进」即依赖
   此项；行注释由 eol 终结，文本在 EOF 结束而无换行时**视同 eol** 终结行注释
   （合法，不报错）。

微示例（合法）：

```ts
type Port = 80 | 443;
type Name = string & Pattern<"^[a-z]+$">;
type Pair = { first: string; second?: number };
type Names = Name[];
type Index = Record<string, Port>;
```

微示例（非法，错误码见 §4）：

```ts
type A = ( string | number )[];    // VFSL-E100：括号分组不在子集
type B = string & Pattern<"a\d">;  // VFSL-E202：非法转义（须写 \\d）
type C = -1 | 1;                   // VFSL-E100：负数字面量不在子集
type D = true | false;             // VFSL-E301：true/false 未声明（布尔字面量不进入 LiteralType，注记 8；按未知名报错）
```

## 3. 标记类型语义

六个标记类型，大小写是契约（§6）。标记表达**结构语义**（Yjs 物化），与**值语义**
（原始类型、字面量、约束）正交：标记不改写值约束，值类型不隐含结构。

### 默认物化规则（无标记类型的物化基准）

| 类型写法 | 默认物化 | 说明 |
| --- | --- | --- |
| 裸对象类型 `{ ... }` | 等价 `YMap<...>` 物化 | 封闭键空间的 Y.Map |
| 裸数组 `T[]` | 等价 `YArray<T>` 物化 | 同步元素序列 |
| `Record<K, V>` | Y.Map（键空间受 K 约束） | 键须为 string 形（E306） |
| 容器内的原始类型 / 字面量**及其联合**（成员全部为标量形） | 原生叶子值 | 等价 `YLeaf<...>` 的值语义 |
| 含对象 / 数组成员的联合（成员全部为容器形） | 按命中成员的形状物化（多态值形状） | 成员各自适用默认 / 标记规则；适用于字段类型、数组元素、Record 值位与标记实参（实参位置先判形状约束 E304） |

联合成员的形状归类（判定在**别名解析后**进行，沿别名链取最终形状；上表末两行
由此三分类确定）：

- **全部标量形**（原始类型 / 字面量 / 含 Pattern 约束）→ 原生叶子值（上表
  第 4 行），如 `keywords: YLeaf<string>[]` 的元素；
- **全部容器形**（对象 / 数组 / Record）→ 按命中成员的形状物化（上表第 5 行）：
  对象成员 → Y.Map、数组成员 → Y.Array、Record 成员 → Y.Map。附录 fixture 的
  `Record<AssetId, AssetEntity>` 即此——`AssetEntity` 的每个联合成员按其对象
  形状物化为 Y.Map，成员内部的标记字段（`audit: Audit` 等）各自适用标记规则；
- **标量形与容器形并存（混合联合）**，如 `{ a: string } | number` → 在同步物化
  上下文中**拒绝**：VFSL-E309（定位锚为首个与首成员形状类别不同的成员起点
  记号）。纯值上下文（YPlainArray 子树，见下）不适用本条——普通 JSON 值允许
  混合形状联合。

**标记成员的形状归类**（联合成员是标记、或经别名解析到标记时，按该标记的物化归类，
判定时机同上——别名解析后）：`YMap` / `YArray` / `YXmlFragment` → **容器形**；
`YLeaf` / `Pattern`（`string & Pattern<…>` 的约束侧）→ **标量形**；`YPlainArray`
在同步物化上下文按**标量形**（父容器中以单一 JSON 值承载，不可下钻）。三分类由此
对标记成员闭合，无两可读法：`type M = YMap<{ x: string }>;` 与 `type T = M | { y: number };`
（别名解析后 M 为标记 → 全容器形 → 多态物化，合法）；
`YPlainArray<{ a: string }> | string`（全标量形 → 原生叶子值，非 E309）。

显式标记的意义：物化在文本上自描述（不依赖读者记忆默认规则），以及切换默认
（`YPlainArray` 显式退出同步）。

### 纯值上下文（YPlainArray 子树）

`YPlainArray<T>` 的实参 T 处于**纯值上下文**：子树内一切按普通 JSON 值解释
（裸对象 = 普通对象，裸数组 = 普通数组，Record = 普通对象），**禁止**出现同步标记
`YMap` / `YArray` / `YXmlFragment`（→ VFSL-E307）；`YLeaf` 与 `Pattern` 是值
语义标记，允许出现。纯值上下文内联合按普通 JSON 值形状解释，混合联合合法
（见「默认物化规则」三分类）。

**判定时机与别名传递**：本条在模块全量解析、别名解析后判定——同步标记可经
别名**间接**进入纯值上下文：`type A = YMap<{ x: string }>; type B = YPlainArray<A>;`
中 B 的实参 A 解析后含同步标记 → VFSL-E307。锚点：标记记号直接出现时为该标记
记号；经别名引入时为实参中引入该别名的**引用记号**（上例锚点为 `A`）。

### 标记实参的形状约束

| 标记 | 实参形状约束 | 违反错误 |
| --- | --- | --- |
| `YMap` | 对象形：内联 ObjectType，或解析到 ObjectType / 对象形联合的别名 | VFSL-E304 |
| `YXmlFragment` | 同 `YMap` | VFSL-E304 |
| `YArray` | 任意 TypeExpr | — |
| `YPlainArray` | 任意 TypeExpr（子树进纯值上下文） | — |
| `YLeaf` | 标量形：原始类型 / 字面量 / 其联合 / 含 Pattern 约束（`unknown` 允许） | VFSL-E304 |
| `Pattern` | 仅 StringLiteral，且仅在 `string & Pattern<...>` 中出现 | 裸 Pattern → VFSL-E100 |

形状解析沿**别名链传递**：`type A = B;` 的形状即 B 解析后的最终形状（链式展开
到非别名目标为止），判定同样在模块全量解析后进行。标记实参位置先适用本表形状
约束（E304）；非标记位置（字段 / 元素 / Record 值）的联合形状归类见「默认物化
规则」三分类（E309）。

### YMap

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 物化为 `Y.Map`：封闭键空间逐键同步，未声明字段按对象封闭语义拒绝 | 属性级（单键 set / delete） | 可下钻 |

`YMap<T>` 的 T 为对象形（形状约束表）；T 为**对象形联合**时，键空间为各成员
字段键集之**并集**（封闭）——未被任何成员声明的键不属于该联合的键空间；写入值
与命中成员的字段匹配校验属语义层（validateSnapshot），方言层仅冻结键空间的
并集封闭。裸对象类型的默认物化即 YMap；根别名 `ROOT`（见「命名空间根」）的标记决定文档根的物化。

### YArray

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 物化为 `Y.Array`：有序元素序列，逐元素同步 | 元素级（按下标 insert / delete） | 可下钻 |

裸数组 `T[]` 的默认物化即 YArray。元素为联合时按「默认物化规则」三分类处理
（全部容器形 → 元素级多态物化；全部标量形 → 原生叶子元素；混合 → E309）。

### YPlainArray

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 不物化为 Yjs 类型：在父容器中以普通 JSON 数组这一单一值承载，Yjs 不感知其内部变化 | 整体级（整体替换） | 不可下钻 |

实参子树为纯值上下文（见上），同步标记进入（含经别名间接进入）即 VFSL-E307。

### YLeaf

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 标量叶子：在父容器中以 Yjs 原生值（非 Y 类型）存储，内部结构不被 Yjs 感知 | 值级（整体赋值） | 不可下钻 |

实参须为标量形（形状约束表）；容器形实参 → VFSL-E304。

### YXmlFragment

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 物化为 `Y.XmlFragment`：子节点（文本 / 元素）可区分的结构容器 | 子节点级 | 可下钻 |

实参为对象形（形状约束表，违反 → VFSL-E304）。实参字段与 XML 结构（元素 /
属性 / 子节点）的**语义映射属语义层（求值器）职责**，方言层不冻结；方言层仅
冻结对象形约束（E304）与字段上的注释挂载规则（§5）。

### Pattern

| Yjs 物化含义 | 写入粒度 | PATCH 可否下钻 |
| --- | --- | --- |
| 无独立物化：静态字符串约束（`string & Pattern<"正则">` 的约束侧），校验属语义层 | 类型级（不可写入） | 不可下钻 |

正则语义：Pattern 实参解码后的字符串按 ECMAScript RegExp（无标志）解释；锚定
不由方言隐含（须如附录 fixture 显式书写 `^` / `$`）。实参解码后是否为合法正则
**不在方言层校验**（见 §9）。

### 命名空间根（ROOT 约定）

每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约；`root` / `Root` 不
算），它描述文档根的形状：

- 缺失 → VFSL-E310（锚模块起始）；
- 重复声明 → VFSL-E302（重复声明名的既有语义）；
- 非容器形 → VFSL-E311：标量形（原始类型 / 全标量联合 / `YLeaf` / `YPlainArray` /
  `Pattern`）无法物化为 doc 根共享类型；形状按三分类经别名解析后判定，锚 ROOT
  的类型表达式起点记号。

`ROOT` 的标记（或裸对象 / 裸数组的默认规则）决定文档根的物化；Yjs 映射为 doc 根
的 `getMap / getArray / getXmlFragment('ROOT')`。`ROOT` 可被其他别名引用（既当根
又当积木，合法）。其余无人引用的别名是**惰性积木**：合法、不进数据面、不参与
物化。

## 4. 禁止清单与错误语义

### 结构化错误模型

违反任何规范条款即产生结构化错误：**错误身份 = 错误码 + 人类可读消息 + 行列**。
行列基准：line 与 column 均 1 起；column 按 Unicode 码点计（自行首累加）；行分隔
为 `\n`（`\r\n` 中的 `\r` 不占列）。issues 数组的精确字段形状由 parser 公共接缝
（PRD #3）冻结；本规格冻结错误身份与定位锚。

错误码共 **21 个**，三层分野：语法 E100~E106（E100 为越界语法 catch-all）、
词法 E201~E203、引用 / 语义 E301~E311。

**错误码传递通道**：issues 数组的字段形状由 PRD #3 冻结为
`{ message, line, column }`（无独立 code 字段，本规格不增改该公共接缝）。错误码
以 message 的**冻结前缀格式**传递：每条 issue 的 message 必须形如
`VFSL-E<编号>: <人类可读消息>`（如 `VFSL-E101: any 类型不在 v1 冻结子集`）——
前缀（`VFSL-E` + 三位编号 + 冒号 + 单空格）是本规格冻结项，消息正文措辞不冻结。
issue #5 起的测试应以前缀为断言锚（断言前缀格式而非消息全文，给实现留措辞
自由度）。未来若需独立 code 字段，属公共接缝变更，须回 PRD #3 走变更流程，
不在本规格 §8 演进条款的「只增不改」范畴内。

**错误数量与恢复策略**：v1 冻结「首个错误即失败」，issues 数组恰含 1 条。错误
报告**分相位**：词法 / 语法相位（E100~E105、E201~E203，含按「错误判定顺序」映射
出的专属码，以及第 7 条在声明名位映射出的 E303）在**遇到处即时失败并即报**；
仅当模块**全量解析成功**，才进入引用 / 语义相位（E106 引用图成环与
E301 / E302 / E304~E311），相位内取**文本位置最前**的一处。同一记号命中多个条件
时按「错误判定顺序」的优先级取一（该特征分派亦在词法 / 语法相位内）。错误恢复
与多错误报告留给未来版本只增引入（issues 的数组形状已为此预留）。

### 禁止清单（越界即错误）

| 禁止构造 | 违反示例 | 错误类型 | 行列信息 |
| --- | --- | --- | --- |
| any 类型 | `type T = any;` | VFSL-E101 | `any` 记号起点的 line/column |
| 自定义泛型 | `type Box<T> = { value: T };` | VFSL-E102 | 泛型参数表 `<` 起点的 line/column |
| 条件类型 | `type T = A extends B ? C : D;` | VFSL-E103 | `extends` 记号起点的 line/column |
| mapped type | `type T = { [K in Keys]: V };` | VFSL-E104 | `[` 起点的 line/column |
| interface 继承（interface 声明族） | `interface A extends B {}` | VFSL-E105 | `interface` 记号起点的 line/column |
| 递归 / 循环引用 | `type A = { b: B }; type B = { a: A };` | VFSL-E106 | 再入引用记号的 line/column（消息含环路径） |

注：PRD 禁止条目为「interface 继承」，v1 按「interface 声明族」整族冻结——任何
`interface` 声明（含无 `extends` 形态）一律 E105。

### 错误判定顺序（规范性）

E101~E105 对应的构造在 §2 文法下**不可推导**（形式上会落入 E100 catch-all：
`interface` 不以 `type` 开头、别名名后遇 `<` 非 `=`、TypeRef 后遇 `extends`、
字段名位遇 `[`）。为使专属错误码可达，tokenizer / parser 在落入 E100 之前，必须
先按下列特征把禁止构造映射到专属码（规范性判定顺序，逐条自上而下）：

1. 模块层（TypeAlias 期望位）遇前导 `interface` 记号，或类型位置（TypeExpr
   期望位）遇 `interface` 记号 → **E105**（锚 `interface` 记号）；
2. 别名声明名（Ident；声明名位为保留名时不适用本条，见第 7 条）之后遇 `<` 而非
   `=` → **E102**（锚 `<` 记号）；
3. 类型位置遇 `extends` 记号 → **E103**（锚 `extends` 记号）；
4. 字段名位置（Field 的 Ident 期望位）遇 `[` → **E104**（锚 `[` 记号）；
5. 类型位置遇 `any` 记号 → **E101**（锚 `any` 记号）；
6. `<` 前的标识符不是 `Record`、不是六个标记的标准拼写、**且不是保留名**（保留
   名见第 7 条）时：
   - 该标识符为**未声明名或标记的大小写变体**（如 `YLEaf`）→ **E301**（锚该
     引用记号）；
   - 该标识符为**已声明别名** → **E100**（锚 `<` 记号；v1 无自定义泛型的声明
     与调用，别名带实参使用即越界语法）。
7. **保留名记号出现在其对应产生式不适用的位置**：裸引用六个标记 / `Record` /
   `Pattern`（如 `type T = YMap;`，或 `Pattern` 脱离 `string &` 语境——§3「裸
   Pattern → E100」即本条实例）、保留名（`Record` 与六标记之外）后随 `<`（如
   `type T = string<number>;`）、`type` 出现在类型位置（如 `type T = type;`）→
   **E100**（锚该保留名记号）；**声明名位出现保留名 → E303**（锚声明名，解析到
   声明名时即时判定——`type type = string;` 与 `type any = string;` 同归）；
   **E301 仅适用于非保留名的标识符记号**。本条与第 1~6 条共同使「keyword 记号」
   与「统一 Ident + 后置查表」两种 tokenizer 设计产出相同的错误码与锚点。
   keyword 记号的分类以保留名集合（§4）为完备边界——集合之外不存在被分类为
   keyword 的标识符（`true` / `false` 即属此类，词法上为普通 Ident，见注记 8）：
   两种 tokenizer 设计对非保留名标识符一律按普通 Ident 读法处理，错误码与锚点
   一致。

一处构造同时命中多个特征时，取**文本位置最前**的特征；位置并列时按本条次序
靠前者（本段的特征分派在词法 / 语法相位内进行；与引用 / 语义相位的先后见
「错误数量与恢复策略」的分相位规则）。第 6 条中「已声明 / 未声明」的终判在
模块全量解析后进行——**别名解析与声明顺序无关**（前向引用
`type A = B; type B = string;` 合法），「未声明」=
模块内不存在该名的 TypeAlias 声明。该解析时机条款同样适用于
E301 / E304 / E306 / E307 / E309 / E310 / E311（全部引用 / 语义层错误）。

### 递归与循环引用检测

类型别名引用图（引用边来自字段类型、Marker 实参、Record 键 / 值、数组元素、联合
成员、Pattern 之外的一切别名引用）成环即拒绝：自引用（`type A = { x: A };`，含经
容器包裹的 `type A = { x: A[] };`）与互引用（A→B→A）同样 → E106。消息携带环路径
（如 `A → B → A`），line/column 为检测到再入的引用记号。

### 错误码总表

| 错误码 | 条件 | 定位锚 |
| --- | --- | --- |
| VFSL-E100 | 越界语法：不可从 §2 文法推导的任何构造（括号分组、负数 / 小数字面量、裸 Pattern、裸标记 / 保留名误用（判定顺序第 7 条）、未知记号等；判定顺序见 §4） | 构造起点记号 |
| VFSL-E101 | `any` 类型 | `any` 记号 |
| VFSL-E102 | 自定义泛型参数 | 泛型参数表 `<` |
| VFSL-E103 | 条件类型 | `extends` 记号 |
| VFSL-E104 | mapped type | `[` 记号 |
| VFSL-E105 | interface 声明族 | `interface` 记号 |
| VFSL-E106 | 别名引用图成环 | 再入引用记号（消息含环路径） |
| VFSL-E201 | 字符串字面量未闭合（含跨行） | 起始 `"` |
| VFSL-E202 | 非法转义（`\"` `\\` 之外） | 反斜杠记号 |
| VFSL-E203 | 块注释 / 文档注释未闭合 | 起始 `/*` |
| VFSL-E301 | 未知名引用：引用未声明别名（模块全量解析后判定，声明顺序无关），或六个标记的大小写变体（按未知名报错）；仅适用于非保留名的标识符（保留名见判定顺序第 7 条） | 引用记号 |
| VFSL-E302 | 类型别名重复声明 | 重复的声明名 |
| VFSL-E303 | 别名名占用保留名（含声明名位出现保留名 / 文法关键字，如 `type type = …`——判定顺序第 7 条） | 声明名 |
| VFSL-E304 | 标记实参形状不合法（YMap / YXmlFragment 非对象形；YLeaf 非标量形；形状沿别名链解析后判定） | 标记记号 |
| VFSL-E305 | 悬空文档注释：`/** */` 后无任何可挂载的后续声明性节点 | 注释起始 |
| VFSL-E306 | Record 键类型非 string 形（string / string & Pattern / 其别名） | 键类型起点 |
| VFSL-E307 | 同步标记位于纯值上下文（YPlainArray 子树内，含经别名间接引入） | 标记记号；经别名引入时为引入别名的引用记号 |
| VFSL-E308 | 对象字段重名 | 重复字段名 |
| VFSL-E309 | 混合联合：同步物化上下文中联合成员标量形与容器形并存（别名解析后判定；纯值上下文不适用） | 首个与首成员形状类别不同的成员起点记号 |
| VFSL-E310 | 缺少 ROOT 别名：模块未声明名为 `ROOT` 的命名空间根别名（见 §3「命名空间根」） | 模块起始（1:1） |
| VFSL-E311 | ROOT 别名非容器形：标量形无法物化为 doc 根共享类型（三分类经别名解析后判定） | ROOT 的类型表达式起点记号 |

保留名集合：`type`、`Record`、`Pattern`、`string`、`number`、`boolean`、`null`、
`unknown`、`any`、`extends`、`interface`、`YMap`、`YArray`、`YPlainArray`、
`YLeaf`、`YXmlFragment`。别名声明占用任一保留名 → VFSL-E303（如
`type any = string;` → E303，锚声明名——保留名含 `any` 后，`any` 不再可能成为
合法别名，消解「合法声明却永不可用」的矛盾；声明名位出现文法关键字亦同，
`type type = string;` → E303，判定顺序第 7 条给唯一答案）。标识符大小写敏感，由 ASCII 字母
开头，可含 ASCII 字母 / 数字 / 下划线：letter ∈ [A-Za-z]、digit ∈ [0-9]
（**ASCII 冻结**；`$` 与非 ASCII 字母均不在 v1 标识符字符集——`type A$B = …`、
`type 資産 = …` 均不可推导 → VFSL-E100）；Unicode 标识符留给未来版本只增引入。

## 5. 注释规则

三态处理：

| 注释形态 | 处理 | IR 影响 |
| --- | --- | --- |
| `//` 行注释 | 忽略 | 无节点 |
| `/* */` 块注释 | 忽略 | 无节点 |
| `/** */` 文档注释 | 原文捕获（逐字保留，含内部 `*` 与缩进） | 挂载到相邻 IR 节点 |

**忽略与捕获的边界**：以 `/*` 开头的注释，若开标签后紧接 `*`（即 `/**` 开头）
则为文档注释；特例 `/**/` 与 `/***/` 是（空 / 单星内容的）块注释，不是文档注释。
文档注释不嵌套：自开标签后首个 `*/` 即终结。未闭合的块注释 / 文档注释 →
VFSL-E203。

**挂载规则（捕获的目标节点）**：文档注释是前导注释——挂载到紧随其后（中间仅
允许空白与忽略型注释）的**声明性节点**，三类：**类型别名**（声明处）、**属性**
（对象字段处）、**标记类型**（Marker 记号处）。连续多个文档注释按出现顺序全部
挂载到同一后续节点。若直到模块末尾都没有可挂载节点 → VFSL-E305（拒绝静默丢弃
作者语义——单一真相源不容丢失）。

**`@tag`**：不做机器解析（本方言无机器标签，全部文档性质——ADR-0001 主题）；
标签随文档注释**原文保留**，不校验、不告警（标签的机器语义属语义层任务，出范围）。

**挂载示例**（附录 fixture 的全部 7 条文档注释 → 挂载点）：

| fixture 中的文档注释 | 挂载目标 |
| --- | --- |
| `/** vfs3.assets — … */`（文件首个） | 类型别名 `AssetId`（相邻的下一个声明） |
| `/** 资产 ID：… */` | 类型别名 `AssetId`（与上一条连续，同挂一节点） |
| `/** 审计信息：… */` | 类型别名 `Audit` |
| `/** 资产实体：… */` | 类型别名 `AssetEntity` |
| `/** 附件：… */` | 类型别名 `Attachments` |
| `/** ROOT：… */` | 类型别名 `ROOT` |
| `/** @semantic 可选说明字段 */` | 属性 `notes?`（`ROOT` 对象内） |

## 6. 大小写契约

标记类型六个，大小写是契约（精确拼写）：

`YMap`、`YArray`、`YPlainArray`、`YLeaf`、`YXmlFragment`、`Pattern`

变体拼写（`YLEaf`、`yleaf`、`ymap`、`yarray`、`yplainarray`、`YXMLFRAGMENT`、
小写 `pattern` 等）**不是已知名**：作为类型引用出现且未被声明为别名时，按
**未知名**报错（VFSL-E301，消息含原文记号与行列）。v1 **不把任何变体拼写纳入
保留名**——`type yleaf = string;` 是合法的别名声明，此后 `yleaf` 即已知名（普通
别名，与标记语义无关）；未声明时引用 `type T = yleaf;` 同样落 E301。标记拼写、
内建名与别名同居同一标识符名空间，一律大小写敏感（§4 保留名集合）。

## 7. 信封形状

```json
{
  "lang": "vfsl",
  "version": 1,
  "id": "<文档标识>",
  "text": "<VFSL 文本>"
}
```

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `lang` | 字符串，`"vfsl"` | 方言名 |
| `version` | 整数，`1` | 方言版本（文本自述版本的来源） |
| `id` | 字符串 | 文档标识；对 parser 不透明（不解析、不校验唯一性——引擎层职责，出范围） |
| `text` | 字符串 | VFSL 文本本体（UTF-8） |

parser **只消费 `text`**：信封解析与方言路由（未知方言 loud-fail 只读）是后续
引擎任务，**出范围**（out of scope）。parser 隐式按 v1 解释 text；`version` 与
text 的匹配、以及 `version ≠ 1` 的路由决策由引擎层完成。

## 8. 方言演进

v1 冻结后的演进规则：**只增不改**。

1. 语法只增：后续版本可新增生产式 / 记号，不得收窄或废除 v1 已有推导；
2. 语义不改：既有构造的物化 / 挂载 / 错误语义不得重新解释；
3. 错误码稳定：已发布错误码的条件与含义不变（新条件用新码）。

对历史文本的解释，永远以**文本自述**的方言版本为准（即信封 `version` 字段）；
本规格自身的修订同样只增不改。**首次发布前**的规格评审修订轮次不受本条约束
（错误码编号随首次发布冻结；发布后新增条件一律用新码，不得复用既有编号）。

## 9. 实现自由度与未冻结项声明

以下各项是 v1 明确**不冻结**或已给出唯一立场的边界。issue #5~#9 在这些位置
**不得做静默决定**——按本节（及所引条款）实现：

1. **Pattern 实参的正则合法性**：方言层不校验实参解码后是否为合法 ECMAScript
   正则——`type T = string & Pattern<"[">;` 通过词法 / 语法 / 形状全部检查，
   `ok: true`；非法正则的暴露时点属语义层（validateSnapshot）。
2. **UTF-8 BOM**：text 经 UTF-8 解码后的首个字符若为 U+FEFF（BOM），parser 须
   剥离且不报错；行列基准自 BOM 之后的首个字符起算（BOM 不占 line 1 的任何
   列，不计入 column）。
3. **多错误恢复**：v1 冻结单错误——issues 恰含 1 条（见 §4「错误数量与恢复
   策略」），错误恢复与多报留给未来版本只增引入。
4. **@tag 的未来语义**：story 12 的 warn 语义属语义层任务；未来版本若引入标签
   机器语义，按 §8 只增不改演进——新增告警不构成对 v1 文本「不解析、不校验、
   不告警」行为的改写。

## 10. 附录：vfs3.assets 参考 fixture

> 溯源：本 fixture 依据 **issue #9** 描述**还原**构造——原设计文档《yjs-server
> Namespace Schema 自描述体系》**缺位**（仓库与上游均无），fixture 以 issue #9
> 描述 + PRD #3 语法子集为约束自洽构造，作为规格的自含正例，供 issue #9 直接引用。

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

/** 附件：与 Yjs 同步无关的纯值数组 */
type Attachments = YPlainArray<YLeaf<string>>;

/** ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 */
type ROOT = YXmlFragment<{
  assets: Record<AssetId, AssetEntity>;
  attachments: Attachments;
  audit: Audit;
  /** @semantic 可选说明字段 */
  notes?: YLeaf<string>;
  keywords: YLeaf<string>[];
}>;
```

fixture 构造覆盖：六标记全部出现；`AssetId`（Pattern 键约束）、`Audit`、判别联合
`AssetEntity`（字面量联合成员 `"image"` / `"text"` / `"file"`，全部容器形成员——
按 §3 三分类物化为多态 Y.Map，非混合联合）、`ROOT`；
`?:` 可选属性（`notes?`）、`T[]`（`keywords`）、`Record<`（`assets`）、
`string & Pattern<`（`AssetId`）、文档注释原文（含 `@tag`）。该文本**除词法
trivia（空白与注释，注记 9）外**按 §2 文法完全可推导，语义检查（§3~§5）全部
通过。
