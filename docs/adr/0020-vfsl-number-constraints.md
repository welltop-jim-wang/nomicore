# ADR 0020：VFSL 数值约束（Int / Range 形态与数字字面量拓宽）

日期：2026-09-11
状态：已接受
跟踪：issue #310

## 背景与动机

VFSL v1 的 `number` 是“裸”的：运行时判定为 `typeof value === 'number'`（值域全
f64，含 NaN 与 ±Infinity），schema 文本侧则只有无符号十进制整数字面量（负数、
小数均不在子集，v1-spec §2 注记 7）。由此产生一个表达力空洞：**数值口径无处
安放**——计数类字段的 `>0`、库存的非负整数、比率/百分比的 `[0, 1]` / `[0, 100]`
浮点区间，都没有语法承载。

唯一的替代写法是把口径写进 JSDoc 让人读：

```vfsl
/** 库存数量：必须为正整数 */
type Stock = number;
```

但 ADR 0001 确立 JSDoc 是纯文档性的、validate 不读取任何 docs——这样的“约束”
没有任何机器执行：IR 不携带、validate 不判定、derived 不可见、codegen 与
readData 投影无从感知。对语义与口径而言，这是有害的错觉。

字符串侧已有完整先例：`string & Pattern<"正则">` 以「约束叠加在原始类型上」的
构造形态，打通了 parser → IR → derived → validate（真判定）→ codegen →
readData 的全机器链（issue #21 / ADR 0003）。本 ADR 将同一构造哲学延伸到数值
侧，新增三个约束形态：

```vfsl
type Stock = number & Int<1, 99999>;       // 整数性 + 区间：>0 的整数
type PageSize = number & Int;              // 仅整数性
type Ratio = number & Range<0, 1>;         // 仅区间：浮点 [0, 1]
type Discount = number & Range<0.5, 1.5>;  // 小数端点
type Temperature = number & Range<-40, 85>; // 负端点
```

配套地，数字字面量从「无符号十进制整数」拓宽为「可选负号 + 可选小数部」（指数
记号不做），全局生效——这使小数/负数端点与浮点、负数枚举成员同时获得语法承载。
两个新保留名 `Int` / `Range` 属冻结规则的收窄项，按决策 1 的例外条款裁决放行。

## 决策

### 1. 演进路线：v1 修订例外（§8 增补「保留名增补」条款）

v1-spec §8 冻结规则为「语法只增不改、语义不变、错误码稳定」。本 ADR 的三个形态
与字面量拓宽本身是纯拓宽（仅让原 E100 文本变合法），但 `Int` 与 `Range` 进入
保留名集合是**收窄**：既有 `type Int = number;` 合法文本将变为非法。

裁决：**不引入方言 v2**，在 §8 增补一条窄例外——

> 保留名增补例外：新增保留名属收窄，不属「只增」；仅当满足下列全部条件时允许，
> 且须逐一经 ADR 显式裁决：(a) 仓库内全部 schema 与已知生态使用与该名无冲突；
> (b) 该名是某约束构造的语义必需组成，无等价的纯拓宽写法；(c) ADR 中附冲突排查
> 证据与收窄影响面评估。

`Int` / `Range` 为本条款首例：仓库内唯一 schema（`domains/vfs3-assets/
schema.vfsl`）无 `Int` / `Range` 标识符使用（grep 排查证据见 issue #310 讨论）；
约束构造名是判定顺序与派生协议的语义必需（语境关键字等替代方案见 Considered
Options）。

### 2. 概念模型与三形态：整数性 ∧ 区间，两维正交

数值约束建模为两个正交维度的叠加，不制造 `number` 之外的并列类型（与 JSON
Schema 的 `integer` + `minimum`/`maximum` 心智模型一致；位宽类型模型与 VFSL
的 JSON 值 + f64 载体定位不符）：

```
值约束 = 整数性（integerness） ∧ 区间（range）
```

三形态为其组合，与 `string & Pattern<"…">` 同属「约束叠加在原始类型上」家族：

| 形态 | 整数性 | 区间 | 端点要求 |
| --- | --- | --- | --- |
| `number & Int` | ✓ | — | 无参 |
| `number & Int<min, max>` | ✓ | ✓ | 两个**整数**字面量 |
| `number & Range<min, max>` | — | ✓ | 两个字面量，整数/小数皆可 |

parser 的交叉白名单「仅允许 `string & Pattern<…>`」（E100）相应扩为四例
（`string & Pattern`、`number & Int`、`number & Int<…>`、`number & Range<…>`），
E100 文案更新；判定顺序、保留名误用规则、`[]` 后缀结合规则（`number &
Int<0, 9>[]` = 约束整数的数组）全部镜像 Pattern 既有条款。`Int` / `Range` 进入
保留名集合；裸 `Int` 脱离 `number &` 语境、裸 `Range` 一律 E100（镜像裸 Pattern
判定）。

### 3. 数字字面量拓宽：负号与小数，全局生效

数字字面量文法从 `[0-9]+` 拓宽为：

```
NumberLiteral = "-"? [0-9]+ ("." [0-9]+)? ;
```

- **负号**：须与数字紧邻，作为 number 记号的一部分由 tokenizer 扫描；裸 `-`
  （后不接数字）维持「未知字符 → E100」延迟错误记号路径。**`-0` 字面量解析
  期 E100 拒绝**（锚该记号，消息引导写 `0`）——本句为 ADR 0021 决策 2 修订
  （初稿为「-0 合法，按 f64 与 0 严格相等」）：运行时值域收窄排除 -0 后，文
  本侧不留无存在理由的 -0 写法；
- **小数**：小数点两侧 digits 必填——`.5`、`1.` 维持 E100；
- **指数记号不做**：`1e3`、`1.5E-2` 维持 E100，留作后续纯拓宽；
- **全局生效**：字面量子集是全局规则，不做上下文特判——`-1 | 1`、`0.5 | 1.5`
  联合成员随之合法；浮点成员的相等语义为 f64 严格相等（`enumContains` 现状即
  此）；字面量与区间端点一律按 f64 语义解释（spec 注明，消解十进制直觉落差）；
- 超双精度字面量（含负值）沿 §7.3 既有路径判 E100。

这是纯拓宽：既有合法文本的语义、物化、指纹、错误码全不变。

### 4. 解析与判定规则：arity 严格、Int 端点整数限定、空区间解析期拒绝

- **arity**：`Int` 零参；`Int<min, max>` 与 `Range<min, max>` 恰两参。`Int<5>`、
  `Int<1, 2, 3>`、`Range<0>`、裸 `Range<>` → E100（与 Pattern 实参错误同码同锚
  位风格，锚定构造起点记号）；
- **Int 端点整数限定**：`Int<0.5, 1.5>` → E100（锚定该小数记号）。整数性约束配
  浮点端点是自相矛盾的描述，loud 优于静默；
- **区间包含性**：闭区间 `[min, max]`，含双端点；开放/半开区间无字面量可表达、
  无需求，不做；
- **空区间**：`min > max`（f64 比较）解析期 E100 拒绝。与 `Pattern<"[">` 延迟到
  validate 报错不同——正则合法性需引擎编译才能判，空区间不需要任何引擎，无延
  迟理由；永不满足的约束几乎必是笔误。

全部复用既有错误码，零新增错误码（冻结规则「错误码稳定」合规）。

### 5. IR / derived：新增 `int` / `range` 叶子种类

镜像 `pattern` 叶子先例：

- IR：`{ kind: 'int'; min?: number; max?: number }`（裸 `Int` 两键皆缺席）与
  `{ kind: 'range'; min: number; max: number }`；exactOptionalPropertyTypes
  条件键纪律不变；
- derived 两树同款叶子；`walkDocs` / 索引行等消费方的 switch 各加一个 case；
- 新叶子种类只服务新文本——无 Int/Range 的 schema，IR 紧凑 JSON 逐字节不变，
  **既有语义指纹（sha256:v1:）全部不变**。

### 6. validate：运行时逐值判定，真约束

三形态进入 validate 标量叶子判定（与 `pattern` 叶子同层）：

- `int` 叶子：`Number.isInteger(v)` 且（`min`/`max` 在场时）`min <= v && v <= max`；
- `range` 叶子：`typeof v === 'number'` 且 `min <= v && v <= max`；
- 失配报错（消息含期望区间/整数性描述与实际值），纳入全收集语义与工作预算计费；
  判定为 O(1) 比较，无引擎、无预算耗尽风险（与 Pattern 四类引擎错误无对应物）；
- `Int`/`Range` 约束天然排除非有限数：`isInteger(NaN)` / `isInteger(Infinity)`
  为假；NaN 的区间比较恒假，±Infinity 越有限端点（端点有限性由 §7.3 解析期保
  证）。

### 7. codegen：生成 `number` 原样

TS 类型层无法表达区间/整数性。codegen 对 `int`/`range` 叶子生成 `number` 原样：
生成物形状不胀、`generate --check` 字节稳定性基线不变；约束只活在 validate 运
行时与 derived 派生物。品牌类型（`type Int<Min, Max> = number & { … }`）若有真
实诉求，独立 ADR 单独裁决。

### 8. readData 投影：按标量下钻，不新增拒绝路径

number 不作键，无 keyPattern 对应物。`int`/`range` 叶子在 resolve-schema-at-path
中按标量叶子处理（终态/可下钻规则与 `pattern` 叶子同构），不新增拒绝路径与失
败码；投影生成的 TS 类型与 codegen 决策 7 一致（`number`）。

### 9. NaN / Infinity 口径（**已被 ADR 0021 supersede**）

> **Supersede 标注**：本决策初稿为「三形态自闭合、`number` 基线不动」，并预测
> 「收窄基线是语义变更，正面违反冻结规则」。ADR 0021 经 owner 裁决将裸
> `number` 基线收窄为 JSON 可忠实表示数（`Number.isFinite(v) && !Object.is(
> v, -0)`），本决策随之作废：三形态的「自闭合排除」被吸收为全 number 家族的
> 统一基线（连 -0 一并排除），裸 `number` 同样拒绝 NaN / ±Infinity / -0。保
> 留下文原始分析作为决策史证据。

现存事实：裸 `number` 经 `typeof` 判定放行 NaN/±Infinity；且载体链存在静默变形
——Yjs 活文档（lib0 f64 编码）可存 NaN/Infinity，ADR 0014 的 validated JSONL
changelog/snapshot 走 JSON 序列化，`NaN → null`。

裁决（初稿，已被 ADR 0021 supersede）：本 ADR 三形态自闭合排除非有限数（决策
6），**裸 `number` 基线一字不动**（收窄基线是语义变更，正面违反冻结规则，且影
响面远超本 ADR）。「number 基线有限化 + 载体链 NaN→null 静默变形」另立独立
issue 裁决（issue #312 → ADR 0021），不搭本 ADR 的车。

### 10. spec 落地与明确不做的部分

v1-spec §2（文法、字面量注记）、§3（保留名集合、判定顺序、交叉白名单）、§8
（例外条款）修订与实现**同 PR** 落地，避免 main 出现「规范已改、代码未跟」的中
间态；authoring guide 同步增补数值约束章节（含 `>0` ≡ `Int<1, …>`、锚定闭区间
语义、Int 端点整数限定）。

明确不做（本期范围外）：开放/半开区间语法；指数记号；品牌类型 codegen；number
基线有限化（决策 9 → 已由 ADR 0021 独立裁决采纳）；小数/负数以外的字面量形态（十六进制等）。

## Considered Options

1. **方言 v2**（拒绝）：新增保留名属收窄，严格读法下可另起 v2 方言（新 spec、
   新 parser 入口/模式开关、`sha256:v2:` 指纹前缀、双文档维护）。完全合规，但
   为两个保留名付出整套方言分裂成本，收益不成比例；改采 §8 窄例外条款（决策
   1）。
2. **JSDoc 机器标签**（拒绝）：如 `/** @range 1 100 */` 承载约束。违反 ADR 0001
   「JSDoc 纯文档性、validate 不读 docs」原则；且约束进不了 IR/derived/validate
   机器链，是「看似有约束、实际无人执行」的有害错觉。
3. **语境关键字**（拒绝）：`Int`/`Range` 仅在 `number &` 后特判、不进全局保留
   名集合，`type Int = number;` 保持合法。避免了收窄，但与 Pattern 全局保留的
   先例不一致，spec 判定顺序复杂化，且 `type Int = number; type T = number &
   Int;` 之类的两可读法留下长尾。改采例外条款 + 全局保留。
4. **小数仅端点放行**（拒绝）：parser 在 Int/Range 实参位特判接受小数记号，其
   余位置维持 E100。字面量子集是全局规则，上下文特判制造「端点能写 0.5、联合
   成员不能」的不一致，实现反而更复杂。改采全局放行（决策 3）。
5. **浮点精度特制口径**（拒绝）：为 `0.1` 类十进制字面量引入 epsilon 比较或十
   进制语义。f64 闭区间比较本身完全确定，直觉落差用「端点与字面量按 f64 语义
   解释」一句 spec 注记消解，不值得引入第二套数值语义。
6. **开放/半开区间语法**（拒绝）：如 `Range<(0, 1]>` 或省略端点。无字面量形态
   可自然表达、无需求驱动；半开需求可用整数端点偏移（`>0` ≡ `Int<1, …>`）或
   f64 nextafter 语义外业务化处理。
7. **指数记号**（拒绝，本期）：`1e3` / `1.5E-2`。无需求驱动，留作后续纯拓宽。
8. **品牌类型 codegen**（拒绝，本期）：`type Int<Min, Max> = number & { __brand:
   [Min, Max] }` 可获得编译期区分，但改变全部生成物形状、冲击 `generate
   --check` 字节稳定基线、写入路径类型全部需适配。留作独立 ADR。
9. **number 基线有限化搭车**（初稿拒绝，后经 ADR 0021 采纳为独立决策）：借本
   ADR 将裸 `number` 收窄为有限数。属语义变更、违反冻结规则、影响面远超本
   ADR——初稿按决策 9 独立立案；ADR 0021 经 owner 裁决正式采纳（含 -0 排除与
   §8 语义收窄例外条款），本项保留作为决策史证据。

## Consequences

### 正面

- 数值口径获得机器执行的语法承载：`>0`、整数性、整数/浮点区间全部进入
  validate 真判定，消灭「JSDoc 里写口径、运行时无人管」的错觉；
- 与 Pattern 先例全链同构：parser 判定、IR/derived 叶子、validate 叶子判定、
  codegen、投影六处皆有现成对照，实现与评审风险低；
- 概念模型（整数性 ∧ 区间正交）为未来留好扩展位：纯 `Int` 已含，浮点区间已含，
  指数记号/负数之外的字面量形态、开放区间均为独立纯拓宽，不被本期设计封死；
- 零新增错误码、零指纹变更、零生成物形状变化——既有 schema 与消费方完全无感。

### 负面 / 代价

- 冻结规则破例一次：`Int`/`Range` 保留名增补是收窄，依赖 §8 新例外条款的纪律
  （逐一 ADR 裁决 + 冲突排查证据）防止滑坡；外部生态若有 `Int`/`Range` 别名使
  用将 breaking，需在发版说明中显式告知；
- E100 文案随交叉白名单更新（测试断言前缀不受影响）；
- 小数字面量全局放行带来浮点枚举成员能力，f64 严格相等语义需 spec 注明，避免
  用户以十进制直觉误解；
- 保留名集合膨胀两名，「名字被方言占用」的长期成本随约束家族增长累积。

### 测试矩阵要点

- 解析：三形态正例（整数/小数/负端点）；`Int<0.5, 1.5>`、`Int<5>`、`Int<1,2,3>`、
  裸 `Range`、`Range<0>`、空区间 `Range<1, 0>` / `Int<5, 1>`、`.5`、`1.`、`1e3`、
  裸 `-` 各负例的 E100 码与锚位；
- 字面量：`-1 | 1`、`0.5 | 1.5` 联合合法性；**`-0` 字面量 E100**（ADR 0021 决策
  2 修订，初稿为「-0 ≡ 0」）；超双精度（含负）E100；
- validate：三形态逐值判定（边界含端点、区间外、非整数入 `Int`、NaN/±Infinity/-0
  入三形态均拒绝；**NaN/±Infinity/-0 入裸 `number` 同样拒绝**——ADR 0021 统一
  基线，初稿「基线不变的锁定测试」随之翻转）；
- 指纹：无 Int/Range 的既有 fixture 指纹逐字节不变；含 Int/Range 的新 fixture
  指纹稳定；
- codegen：`generate --check` 既有生成物零漂移；Int/Range 字段生成 `number`；
- 保留名：`type Int = number;` / `type Range = number;` → VFSL-E303（别名占用保留名）。
