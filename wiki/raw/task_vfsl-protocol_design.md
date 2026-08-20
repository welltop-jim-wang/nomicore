# SA1 设计 — `@nomicore/vfsl-protocol` 编译期路径投影协议（issue #24）

> 总述：`@nomicore/vfsl-protocol` 是 VFSL 的**编译期协议包**——用类型系统把已知 schema（`VfslPathMap` 增广）镜像为一套可编译期解析的路径投影，`patch`/`read`/`kindOf` 的路径与值类型在写代码时即被钉死。机制一句话：**幻影品牌 + 递归条件类型在类型树上做路径解析**，解析失败落到 `UnknownPath`（fail-closed）。D3 纪律：全部内容为类型空间产物（type/interface/declare + type-only export），编译产物为空模块，零运行时、零依赖。
>
> 路径约定（D5）：`VfslPathMap` 顶层键 = ROOT 的字段，路径不含 `ROOT` 前缀；`PathAt` 对空路径 `[]` 返回根节点本身。本部分锚点 = SA6 红灯测试 `vfsl-protocol-projection.test-d.ts` 的增广形状与断言。

## §A 核心类型机制

### A.1 幻影 unique symbol 口袋

任意值类型 `Value` 直接作为节点会淹没在 schema 里——无法区分「这是被投影的 schema 节点」和「这是普通数据类型」。用一个 ambient unique symbol 打品牌，把节点身份固着到类型参数，防止任意类型冒充投影节点。

```ts
/** 幻影口袋：仅作类型标定，零运行时。编译后是空声明，无任何值导出。 */
declare const __vfslNodeBrand: unique symbol;
type VfslNodeBrand = typeof __vfslNodeBrand;
```

**为何零运行时 / 编译后空模块**：`declare const` 只向类型系统声明一个符号，**不产生值**（TS 手册条款 *Ambient declarations: declaration-only，无实现、不发射 JS*）。`unique symbol` 是声明常量的属性的类型，也只活在类型空间。因此本文件经 `tsc` 编译后没有任何可求值的语句——`index.ts` 只 export type/interface + type-only re-export，产物为空模块（SA6 `empty-module.test.ts` 断言 `Object.keys(ns)` 为空）。`VfslNodeBrand` 随后钻进 `PathSchema` 的 `__brand` 字段（A.2），使「携带品牌」成为节点的必要身份。

**SA6 断言代入（来自 A.2 的 `PathSchema`，此处先锚定品牌进字段）**：`VfslNodeBrand` 进入 `PathSchema` 的 `__brand` 字段（A.2）。编译器在 `V extends Record<infer Key, unknown>` / `keyof` 匹配对象映射时，**只有**经 `PathSchema` 构造的类型带 `__brand`，普通字面量 `{ kind: 'map', value: … }` 因缺品牌不匹配 → 无法伪装成节点。品牌不进入任何值推导，全程零运行时成本。

### A.2 `PathSchema<Value, Kind>` 载体

schema 树的最小节点载体：携带被投影的**值类型** `Value` + **kind 词汇表** `Kind`。Kind 取 ADR 0003 的 kind 词汇表五值。

```ts
type VfslKind = 'map' | 'array' | 'xml-fragment' | 'leaf' | 'plain';

/** 载体：一个被投影节点的类型声明。__brand 保证只能经本接口构造出「真」节点。 */
export interface PathSchema<Value, Kind extends VfslKind> {
  readonly __brand: VfslNodeBrand;
  readonly __value: Value;
  readonly __kind: Kind;
}
```

**语义**：`__value` 承载该节点投影到运行时的值类型；`__kind` 承载 kind 词汇。`__brand` 锁死身份（A.1）。三个字段都是 `readonly` + `interface` 类型参数承载——**纯类型描述，无运行时属性**（一个仅含类型参数但不被实现的 interface，编译后不产生任何对象/值；它是给 `PathAt` 递归当「类型字典」用的抽象形状，从不实例化）。`PathSchema` 是「声明型接口」，与访问面接口同属 D3 的类型空间产物。

**SA6 断言代入 — 载体形态匹配增广**：
```
树  : PathSchema<{tree子表}, 'map'>
name: PathSchema<string, 'leaf'>
tree 节点含 entities: PathSchema<Record<`${number}`, PathSchema<…,'map'>>, 'array'>
```
这正对应断言 §4/§8.4：`PathSchema<string,'leaf'>` 的 `__value` 是 `string` → `PathValue` 取出 `string`；`PathSchema<string|null,'leaf'>` → `string|null`；`PathSchema<string[],'plain'>` → `string[]`（纯值透传，无 `Record<number,子表>` 子树，故下钻 → UnknownPath，见 A.4）。`xml-fragment`：`PathSchema<string,'xml-fragment'>` → `PathKind`='xml-fragment'（断言 6）。

### A.3 `UnknownPath<Path>` 与 fail-closed 标记

「解析失败」的唯一终态。钉死为专用接口（带品牌，使所有失败路径产出同一种带标记的「假节点」）——`PathAt` 找不到目标时返回它，访问面见它即编译错误（fail-closed 扩散到 D3 层）。

```ts
/** fail-closed 标记：唯一表示「路径不可解析」。与真节点同形但 Kind 固定 'unknown'。 */
export interface UnknownPath<Path extends readonly unknown[]> {
  readonly __brand: VfslNodeBrand;   // 同品牌 → 与 PathSchema 同属「节点形状」，
  readonly __value: never;           // 但取值失败（never 污染任何 PathValue 读取处）
  readonly __kind: 'unknown';
  readonly __path: Path;             // 保留原路径，便于诊断
}
```

**为何钉死为 interface 而非 `PathSchema<never,'unknown'>`**：`PathSchema` 的 `Kind extends VfslKind`，而 `'unknown'` 不在词汇表 `VfslKind` 中——若用 `PathSchema<never,'unknown'>` 会与 Kind 约束冲突，且会让 tsc 把失败路径误当成合法节点。独立接口 `UnknownPath<Path>` 单列一个形状：`__kind` 固定 `'unknown'`、`__value` 为 `never`。这样：
1. `PathKind<UnknownPath<…>>` = `'unknown'`（绝不会落入合法五值）；
2. 访问面签名以 `UnknownPath` 为非法的判据——落败路径的 `patch`/`read`/`kindOf` 重载匹配不上 → `@ts-expect-error` 命中。
3. `__brand` 与 `PathSchema` 相同，保证二者是同一「节点族」的互斥分支，递归可取 `Kind extends 'unknown'` 作终态短路。

**SA6 断言代入 — fail-closed 触发**（R4：由 rest 缺参标记承接，A.7.1.2）：
```
未增广空表 VfslPathMap = {}：
  PathAt<{}, ['name']> → 首段 'name'，Map['name'] 不存在 → 键空间查无 → UnknownPath<['name']>
  → access.patch(['name'], 'ok') 里 FailClosedRest<{}, ['name']> = [error:'路径不可解析']
  → rest 必需参数缺失 → TS2554 → 编译错误（empty-fail-closed.test-d.ts 的 @ts-expect-error 真实命中）
```
断言 7（`PathKind<PathAt<Map,['tree','attachments','0']>>` → UnknownPath）同理：`attachments` 是 `PathSchema<string[],'plain'>`、`__value` 是纯数组，`Map[key]` 无 `Record<number,子表>` 子树 → 下标段解析失败 → `UnknownPath`。保留 `__path` 使失败的 `PathKind` 可诊断（不参与访问面判据）。

### A.4 `PathAt<Map, Path>` 递归解析（含 `[]` 根分支）

类型级路径解析器：消费 `Path` 元组的每一段，从 `Map` 的字段出发往下钻。空路径返回「根节点」——**根节点表示钉死为 `RootSchema<Map>`**：把 `Map` 本身包成一个 `PathSchema<Map, 'map'>` 形状（V = 整表，不展开子级），使 `PathKind<PathAt<Map,[]>>` = `'map'` 成立（根不是用户手写的 `PathSchema` 字面量，需包装）。

**R2 修订（攻击点 1，CRITICAL）——键空间与取键分离，取键逐成员分发、缺键成员补 `undefined`**。旧 `Step` 用 `V extends Record<infer Key, unknown>` + `V[Seg]` 裸值索引，对 `V=Image|Text` 会在 V 上按成员**分发**（Image 支/Text 支），导致「只在部分成员存在的键」Text 支 `Seg extends keyof Text` 拒绝 → `never` → 结果 `PathSchema|never` = 无 `undefined`，**产不出读投影的 `T | undefined`**；且不分发时 `keyof(Image|Text)` = `keyof A ∩ keyof B` = 交集（TS 手册 `keyof` of union = intersection），`'url'` 直接 fail → `UnknownPath`。两条路都跑不到 `V[Seg]` 的 union 索引 `| undefined`。**R2 改为两个独立助手，键空间判断先做、取键再逐成员分发补位**（机制总表见 A.4.1）：

```ts
/** 根的抽象表示：把 PathMap 整表当作一个 'map' 节点（V = Map 自身，只做包装，不展开子级）。 */
export type RootSchema<M> = PathSchema<M, 'map'>;

/**
 * 键空间并集（R2 新增，A.4.1）：对 union V 显式逐成员分发取各成员 keyof 的并集——
 *   V=Image|Text → keyof Image ∪ keyof Text = 'kind'|'url'|'body'。
 * 注：这是「分发收集各成员 keyof 的并集」，与 TS 的 keyof(union)=交集 不同（naked 类型参数分发）。
 *   非 union 单对象 / 交叉根同键空间。
 */
type MemberKeys<V> = V extends Record<infer Key, unknown> ? Key : never;

/**
 * 成员独有键取键（R2 新增，A.4.1）：对 union V 逐成员分发，有该键的成员取 V[Seg]、
 *   缺该键的成员补 undefined，各分支并集。是读投影 `T | undefined` 的唯一来源。
 *   V=Image|Text 取 'url' → Image[url]=PathSchema<string,'leaf'> ; Text 缺键 → undefined
 *        = PathSchema<string,'leaf'> | undefined ✓（SA6 正例 4）
 *   取 'kind'（两成员都有）→ PathSchema<'image'>|PathSchema<'text'>（无 undefined）
 *   键空间门禁由 Step 用 MemberKeys 先做，这里只负责取键（单对象 V 命中即 V[Seg]）。
 */
type MemberLookup<V, Seg> = V extends unknown
  ? Seg extends keyof V ? V[Seg] : undefined
  : never;

/** 单段推进：Node 当前节点、Seg 消费段。命中 → 下一层节点（可为 节点|undefined）；未命中/越终态 → never。 */
type Step<Node, Seg> =
  Node extends PathSchema<infer V, infer K>
    ? K extends 'map' | 'array'                       // 仅可下钻节点接受段；leaf/plain/xml 为终态
      ? Seg extends MemberKeys<V>                     // Seg ∈ 成员键空间并集（字面量键 / 模板数字键）
        ? MemberLookup<V, Seg>                        // 逐成员取键：命中成员取 V[Seg]、缺键成员补 undefined
        : never                                       // 不在键空间并集 → 段失败
      : never                                         // 越过终态节点下钻 → 拒绝（D1 plain 终态）
    : never;

/** 内部递归：以当前节点与剩余段列表解析；任一段失败 → 标记失败（顶层包成 UnknownPath<Path>）。 */
type PathAtImpl<Node, Remaining> =
  Remaining extends readonly []
    ? Node                                            // 段消费完毕 → 当前节点即结果
    : Remaining extends readonly [infer Seg, ...infer Rest]
      ? Step<Node, Seg> extends infer Next
        ? [Next] extends [never]
          ? UnknownPath<Remaining>                    // 失败态：保留未消费路径供诊断
          : PathAtImpl<Next, Rest>
        : never
      : never;

/** 公开入口：M 从根 'map' 节点开始。[] → RootSchema<M>（D5）；否则逐段推进。 */
export type PathAt<M, Path extends readonly unknown[]> = PathAtImpl<RootSchema<M>, Path>;
```

（实现落地方向如上——钉死**语义**：空路径→根 `RootSchema<M>`；逐段 `Step` 推进；数组段经 `Record<\`${number}\`, 元素子树>` 模板键匹配（`MemberKeys<Record<\`${number}\`,T>>`=`` `${number}` ``，`MemberLookup` 对 `'0'/'5'` 字面量命中元素子树）；键空间并集由 `MemberKeys` 显式分发求得（非 keyof(union)）；任一段失败 → `UnknownPath`。失败分支用 `UnknownPath<Remaining>` vs 全路径传参属实现细节自由，语义一律「解析失败终态」。下标段模板键匹配的 **TS 行为依据**：TS 手册条款 *indexed access & template literal pattern types*——mapped type `Record<\`${number}\`, T>` 对一个 `Seg extends \`${number}\`` 的字面量（`'0'`、`'5'`）在 `V[Seg]` 处由模板字面量模式解析为对应值类型；`Seg='0'` 命中 `Record<number,T>` 的 `${number}` 键 → 取元素子树。union 键空间并集由 `MemberKeys` 的裸类型参数分发显式求得（A.4.1 / §D.2-② 修订）。）

> **为何 R2 新写法不依赖旧 §D.2-② 那条被攻破的承重墙**：旧写法想让 `V[Seg]` 在 union 上作为 `U['url']` 天然带 `| undefined`，但 `Step` 里的 `V extends Record<infer Key, unknown>` + `Seg extends keyof V` 已先把 `V=Image|Text` **分发**成逐成员分支，`V[Seg]` 不再是对整体 union 的一次索引，`| undefined` 永不到场（SA2 攻击 1 实证）。R2 把「键空间判断」与「取键」拆开：`MemberKeys<V>` 只求键空间并集做门禁（**允许**缺失键的段进入），`MemberLookup<V, Seg>` 再回到**逐成员分发**逐成员判断「该成员有没有这个键」——**有则取、没有则显式补 `undefined`**。undefined 补位发生在取键动作的每成员分支里（`Seg extends keyof V ? V[Seg] : undefined`），不依赖任何外层的 union 索引、不依赖 Step 的联合键判断，因此不依赖旧 §D.2-②。

**SA6 断言代入 — 数组 + 下标 + 联合元素下钻（R2 重推）**：
```
PathAt<Map, ['tree','entities','0']>
 = PathAt<Map, ['tree']> → tree 节点（PathSchema<{...},'map'>）
   找段 'tree' → MemberKeys<子表> 含 'tree' → MemberLookup<子表,'tree'> = 子表（可下钻 map）
   → PathAt<子表, ['entities','0']>
     'entities' → MemberKeys 含 → MemberLookup = PathSchema<Record<`${number}`, EntityMap>, 'array'>（可下钻）
     → PathAt<ElemRec, ['0']>，ElemRec = Record<`${number}`, EntityMap>
       '0' → MemberKeys<ElemRec> = `${number}` 含 '0' → MemberLookup<ElemRec,'0'> =（模板键匹配）
             EntityMap = PathSchema<Image|Text,'map'>（单对象 Record 只一分支，不补 undefined）
       → PathAtImpl<EntityMap, []> = 节点自身（消费完毕）
 结果：PathKind → 'map'；PathValue → VfslValueOf<EntityMap> = {kind,url}|{kind,body}（A.6）（断言 3）
```
**成员独有键下钻（R2 新增推演 — SA6 断言 4）**：
```
PathAt<Map, ['tree','entities','0','url']>：
  前段同上到 EntityMap = PathSchema<Image|Text,'map'>（'map' 可下钻）
  → Step<EntityMap, 'url'>：K='map' 可下钻；Seg='url' ∈ MemberKeys<Image|Text>='kind'|'url'|'body' ✓
      MemberLookup<Image|Text,'url'>
        = Image : 'url'∈keyof Image → Image['url']=PathSchema<string,'leaf'>
        | Text  : 'url'∉keyof Text='kind'|'body' → undefined
      = PathSchema<string,'leaf'> | undefined
  → PathAtImpl<..., []> = PathSchema<string,'leaf'> | undefined
  → PathValue<...> = VfslValueOf<PathSchema|undefined>（分发） = string | undefined ✓（SA6 正例 4，行 133/156）
```
断言 7 负例：`['tree','attachments','0']` → `attachments` 为 `PathSchema<string[],'plain'>` → `K='plain'` 非可下钻 → 段拒绝 → `UnknownPath<Path>`（下钻越终态，D1 plain 终态）。

### A.4.1 键空间并集与成员补位机制（R2 新增，SA1 单一锚点）

R2 把读投影的「键识别」与「取键」两件事分别钉死，全部语义收敛在这一节，A.5/A.6/A.8 只引用它：

| 机制 | 公式 | 语义 |
|---|---|---|
| 键空间并集 | `MemberKeys<V> = V extends Record<infer Key, unknown> ? Key : never` | 对 union 逐成员分发取各成员 `keyof` 再并集；**≠ keyof(union)=交集**。非 union 单对象 / 交叉根同键空间。 |
| 成员独有键取键 | `MemberLookup<V, Seg> = V extends unknown ? (Seg extends keyof V ? V[Seg] : undefined) : never` | 逐成员分发：有该键的成员取 `V[Seg]`，无该键的成员补 `undefined`，各分支并集。**undefined 只在此处产生**（读投影 `T|undefined` 的唯一来源）。 |
| 单段推进 | `Step<Node, Seg>` = 可下钻 `? (Seg ∈ MemberKeys<V> ? MemberLookup<V,Seg> : never) : never` | 键空间门禁 + 取键一体。返回「命中成员的子节点 union \| 缺键成员的 undefined」。 |
| 数组下标 | `MemberKeys<Record<\`${number}\`,T>>`=`` `${number}` ``；`MemberLookup<_, '0'>`=`元素子树`（模板键） | 下标段一律字符串数字字面量（如 `'0'`），无 number 段（攻击 8 收敛，路径约束统一 `readonly string[]`，A.7.2）。 |

**这个分节是 R2 之后读/写投影二象性的唯一类型来源**：读投影继承 `MemberLookup` 的 `| undefined`；写投影用 `PathPatchValue` 的 `:never` 丢弃它（A.6）。SA5 报告、SA6 断言、SA3 C.1 代码全部引用本节，不再有二义旧表述。

### A.5 `PathValue` / `PathKind` 与读/写投影二象性

取节点上的值/kind。**核心二象性**：同一路径，**读投影**（成员独有字段在联合中可能缺席 → `T | undefined`）与**写投影**（patch 值 = 声明处 `T`，不含 `| undefined`，A.6 丢弃 undefined）是两种独立类型函数。**R2 修订（攻击点 1/6）**：`Step` 对成员独有键已产出 `PathSchema<...> | undefined`（A.4），故 `PathAt<Map,['...','url']>` 可为 **`节点 | undefined`**。读走 `PathValue = VfslValueOf`——后者以 naked `T` 分发，`undefined` 分支持有透传，于是 `VfslValueOf<PathSchema|undefined>` = `string | undefined`（读）；写走 `PathPatchValue`——其 `:never` 分支丢弃 `undefined` 分量取声明处 `string`（写）。`undefined` 分量的存在与否完全由「该成员是否有此键」决定（A.4.1），不再依赖任何 union 直接索引。取值从节点 `__value` 出发：leaf/plain 直取；map/array 把子树**递归 unwrap 回值类型**（把 `PathSchema` 剥回 `VfslValueOf`）。

```ts
/** 整值投影：把 PathSchema 节点递归剥回运行时值类型。 */
export type VfslValueOf<T> =
  T extends PathSchema<infer V, infer K>
    ? K extends 'map' | 'array'
      ? (V extends Record<infer Key, unknown>
          ? { [K2 in Key]: VfslValueOf<V[K2]> }   // 递归展开映射/数组元素子树
          : V)
      : V                                        // leaf/plain/xml-fragment 直取
    : T;                                         // 非节点原样返回（含 undefined 透传）

/** 读投影：从 PathAt 节点取「读出的值类型」（成员独有字段含 undefined，见 A.6）。 */
export type PathValue<Node> = VfslValueOf<Node>;

/** kind 投影：取节点的 __kind；失败走 'unknown'、根走 'map'（D5）。 */
export type PathKind<Node> =
  Node extends UnknownPath<infer _P> ? 'unknown'
  : Node extends PathSchema<infer _V, infer K> ? K
  : never;

/** 写投影：patch 值参数使用的类型（成员独有键 → 声明处 T，丢弃 undefined）。定义见 A.6。 */
export type PathPatchValue<Node> = /* 见 A.6：PathAt 节点 clean up 成声明处值类型 */ Node;

/**
 * 数组元素读投影（R2 新增；攻击点 4）：array 节点 Value=Record<`${number}`, 元素子树> →
 *   取元素子树再经 PathValue（读投影）展开成元素级值类型（用于 append/insert 的 value）。
 *   appendToArray(['tree','entities'], v) 的 v 类型即 PathElementValue<array节点> = 判别联合元素。
 *   （deleteFromArray 无 value，不受影响。）
 */
export type PathElementValue<Node> =
  Node extends PathSchema<infer V, infer K>
    ? K extends 'array'
      ? (V extends Record<infer _Idx, infer ElementNode>
          ? VfslValueOf<ElementNode>
          : never)
      : never
    : never;
```

**读投影 vs 写投影 — 二象性依据（R2 重述）**：`vfsl-protocol-projection.test-d.ts` 断言 4 与 D2 同时要求：
- `PathValue<PathAt<Map,['tree','entities','0','url']>>` = `string | undefined`（read）；
- `access.patch(['tree','entities','0','url'], 'https://x')` 编译通过，且 patch 值参应为 `string` 而非 `string|undefined`（写）。故 `PathValue`（读）与 `PathPatchValue`（写）必须是两个函数——**读继承 `MemberLookup` 的 `| undefined`（经 `VfslValueOf` 分发透传），写丢弃它取声明处类型**。

**SA6 断言代入 — 断言 1/2/6 回代入 A.5 定义**：
```
断言1: PathValue<PathAt<Map,['name']>>
  → PathAt 落 root→...→ name 节点 = PathSchema<string,'leaf'>
  → VfslValueOf: K='leaf' 非 map/array → 直取 V = string  ✓
  PathKind<…> = 'leaf'  ✓
断言2: ['portraitResourceId'] → PathSchema<string|null,'leaf'> → 直取 string|null  ✓
断言6: PathKind<PathAt<Map,['tree','entities','0','body']>>
  → body 是成员独有键（仅 Text 有）→ PathAt = PathSchema<string,'xml-fragment'> | undefined（A.4 MemberLookup 补位）
  → PathKind 以 naked Node 分发：PathSchema 分支 K='xml-fragment'；undefined 分支（非 UnknownPath 非 PathSchema）→ :never
  = 'xml-fragment' | never = 'xml-fragment'  ✓
  PathKind<PathAt<Map,[]>> → RootSchema<M>（V=M，K='map'）→ 'map'  ✓（D5）
断言1 写：access.patch(['name'], 'ok') 的 value 类型 = PathPatchValue<name节点> = string
  而 access.patch(['name'], 42) → 42 不满足 string → @ts-expect-error 命中（负例1）✓
```

### A.6 判别联合投影（键空间并集与字面量判别）

联合节点 `PathSchema<Image|Text,'map'>`（`Image={kind:'image';url,…}`、`Text={kind:'text';body,…}`）的键/值/整值投影。**R2 修订（攻击点 1）**：三件事由 `MemberKeys`/`MemberLookup`（A.4.1）完成——tsc 原生分发 + 显式键空间并集 + 逐成员补位。不再依赖「union 直接索引访问」这条旧承重墙：

1. **键空间 = 成员键集并集**：`MemberKeys<V>`（A.4.1）对 union 值逐成员分发取各成员 `keyof` 再并集——`'kind'|'url'` 与 `'kind'|'body'` 合并为 **`'kind'|'url'|'body'`**（≠ `keyof(union)`=交集 `'kind'`）。
2. **成员独有字段 read → `T | undefined`**：`MemberLookup<V,Seg>`（A.4.1）逐成员分发：有该键的成员取 `V[Seg]`、无该键的成员**显式补 `undefined`**，各分支并集——`'url'` → `PathSchema<string,'leaf'> | undefined`。undefined 补位发生在取键动作的每成员分支（`Seg extends keyof V ? V[Seg] : undefined`），不依赖 union 索引，故不被 Step 分发破坏。
3. **判别字段精确字面量联合 + 整值判别联合**：`'kind'` 两成员都有 → `MemberLookup` 无 undefined 分量 → `PathSchema<'image'>|PathSchema<'text'>` → 读值 `'image'|'text'`；整值 = 各自 unwrap 后联合 → 消费方用 `Value['kind']` 可 tsc 窄化。**R3 澄清**：此「窄化」指**对整值的运行时控制流窄化**（`const e = read(...); if (e.kind === 'image') e.url` —— tsc 判别联合标准能力）；**不是**类型级 `Entity extends {kind:'image'}` 条件类型（后者因具体联合别名不分发而恒 never，断言 8 修正）——类型级验证窄化须经泛型分发 helper（C.7-5）。

```ts
/**
 * 写投影：把 read 语义的 PathAt 节点（成员独有键处为 PathSchema|undefined）clean up 成
 * 「声明处类型」值——leaf/plain 直取、map/array 逐子节点剥回，undefined 分量丢弃；
 * 失败态 UnknownPath 显式 never（双重 fail-closed，R2/攻击 6）。
 */
export type PathPatchValue<Node> =
  Node extends UnknownPath<infer _P> ? never              // R2：失败态显式 never
  : Node extends PathSchema<infer V, infer K>
      ? PathPatchUnwrap<V, K>        // 真节点 → 剥回声明处值类型
      : never;                        // read 特有的 undefined（或垃圾）丢弃

/** 写投影递归展开：map/array 逐子节点剥回；leaf/plain/xml-fragment 直取（声明处类型）。 */
type PathPatchUnwrap<V, K> =
  K extends 'map' | 'array'
    ? (V extends Record<infer Key, unknown>
        ? { [K2 in Key]: PathPatchValue<V[K2]> }
        : V)
    : V;
```

**读/写投影的关键差异（R2 钉死）**：`Step` 对成员独有键已产出 `PathSchema|undefined`（A.4），故 `PathAt` 结果可带 `| undefined` 分量——这是**读**语义的来源。`PathValue`（= `VfslValueOf`）以 naked `T` 因式分发该 union：`undefined` 走的 `: T` 分支透传为 `undefined`（诚实反映「当前成员不带此键」）。而**写**投影 `PathPatchValue` 以 naked `Node` 分发同一 union：`PathSchema` 分支进 `PathPatchUnwrap` 取声明处 `string`，`undefined` 分支（`undefined extends UnknownPath` 否、`extends PathSchema` 否）落 `: never` ——**丢弃 undefined**。这样 `url` 的写目标 = 宣告它的 Image 成员处 `string`（Text 缺席不参与），读目标 = `string | undefined`。**失败的 `UnknownPath` 两投影都透传**（不 hit `: never`），保证 fail-closed 一致（R2 另将 `PathPatchValue<UnknownPath>` 显式收敛为 `never`，双重 fail-closed，见 A.6 末与攻击点 2/6）。

**SA6 断言代入 — 断言 3/4/5/8 逐链**：
```
目标：NodeT = PathSchema< Image | Text , 'map'>，Image={kind:PathSchema<'image','leaf'>; url:PathSchema<string,'leaf'>}
      Text={kind:PathSchema<'text','leaf'>; body:PathSchema<string,'xml-fragment'>}

断言5（判别字段，R2）: PathAt<...,['kind']> = Step<NodeT,'kind'>
  → 'kind' ∈ MemberKeys<Image|Text>='kind'|'url'|'body'（A.4.1 并集） ✓
  → MemberLookup<Image|Text,'kind'>
  = Image:'kind'∈keyof Image → Image['kind']=PathSchema<'image','leaf'>
  | Text:'kind'∈keyof Text → Text['kind']=PathSchema<'text','leaf'>
  = PathSchema<'image'>|PathSchema<'text'>（无 undefined，两成员都有）→ VfslValueOf = 'image'|'text' ✓

断言4（成员独有键，读，R2）: PathAt<...,['url']> = Step<NodeT,'url'>
  → 'url' ∈ MemberKeys<Image|Text> ✓ → MemberLookup<Image|Text,'url'>
  = Image:'url'∈keyof Image → Image['url']=PathSchema<string,'leaf'>
  | Text:'url'∉keyof Text='kind'|'body' → undefined
  = PathSchema<string,'leaf'> | undefined → VfslValueOf（分发，undefined 透传）= string | undefined ✓
  写（R2 双投影）: PathPatchValue<PathSchema<string,'leaf'> | undefined>
  = PathSchema 分支 → PathPatchUnwrap<string,'leaf'> = string；undefined 分支 → :never → string | never = string
  → patch(['tree','entities','0','url'],'https://x') 编译通过、值为 string ✓

断言3: PathValue<NodeT 整值> = VfslValueOf<NodeT>
  → K='map' → 递归展开每个成员子类型再 union：
    VfslValueOf<{kind:'image',url:string}|{kind:'text',body:string}> = {kind:'image',url:string}|{kind:'text',body:string}
  → 判别联合整值  ✓ ；PathKind<NodeT> = 'map'（K='map'） ✓

断言8（整值窄化，R3 修正）：type Entity = PathValue<entity节点> = Image|Text（判别联合）
  **R3 修正（SA2 R2 证实：SA6 断言里 `Entity extends {kind:'image'} ? Entity['url'] : never` 推不出 ≠never）**。
  关键点：`Entity` 是**具体类型别名**（`Image|Text`，非裸类型参数）——条件类型**只对裸类型参数分发**
  （TS 手册条款 *Distributive conditional types*：条件类型欲分发，其检查类型必须是被泛化的**裸类型参数**；
  对具体联合类型 `Image|Text` 直接判 `extends {kind:'image'}` 时**不分发**，TS 把整个联合作为一个整体做
  可赋值性判定：`{kind:'text';body}` 不可赋给 `{kind:'image'}`（缺 url）→ 条件对被检查联合整体为假 → 取 `: never`）。
  故 `Entity extends {kind:'image'}` = `never`、`Entity extends {kind:'text'}` = `never`——这在**断言推演**层不成立，
  若照抄进测试，`UrlWhenImage`/`BodyWhenText` 恒 `never`，`not.toEqualTypeOf<never>()` 必 RED。
  注意：**判别联合整值本身依然是窄化友好的**——消费方对 `Entity` 值做**普通控制流窄化**
  （`if (e.kind === 'image')` 时 tsc 按判别字段 `kind` 收缩到 Image 成员，这是 TS 判别联合的标准能力，
  不受「条件类型不分发」影响）。「窄化可发生」仅在类型空间**类型级断言**里有约束：要在 `not.toEqualTypeOf<never>()`
  类型级验证这种窄化，须经**泛型分发 helper**，让检查类型回到裸类型参数位以触发分发：
  （测试内）
  type UrlOf<E> = E extends {kind:'image'} ? E['url'] : never;   // E 是裸类型参数 → 逐成员分发
  type UrlWhenImage = UrlOf<Entity>;                             // Entity=Image|Text → 逐支：Image→url=string、Text→never
  → UrlWhenImage = string | never = string ≠ never ✓；（body 同理，BodyOf<E> 同理 → string）。
  断言语义不变：仍在证明「整值判别联合可按判别字段窄化访问成员独有字段」；只是把「分发」显式交回给泛型 helper。
  以下附 SA6 建议替换写法（落入 C.7 SA6 修订轮工作单，见 C.7-5）。
```

**路径级窄化不做（R2 重述 + R3 澄清）**：元组路径静态、无法携带运行时判别事实，故 `['tree','entities','0','url']` 的读投影永远是 `string | undefined`，不做临别窄化——诚实反映 union 的「当前成员可能无此键」。`PathValue<[...'0']>` 整值（断言 3/8）则是**把判别联合整块交还**，消费方对 `Entity` 值自身做窄化。**R3 澄清**：这里的「窄化」必须是**运行时控制流窄化**（`if (e.kind === 'image')`，tsc 按 `kind` 判别字段收缩到 Image 成员——TS 判别联合标准能力），**而非类型级条件类型** `Entity extends {kind:'image'}`——后者因 `Entity` 是具体联合类型别名、检查类型非裸类型参数而**不分发**、恒取 `:never`（见断言 8 修正）。两种窄化的边界：消费方写业务代码用控制流窄化（合法、TS 原生），类型级断言验证窄化经泛型分发 helper（C.7-5）。路径级窄化（读投影内做）仍不做，二者不冲突。

**双重 fail-closed 收敛（R2 机制 + R4 接线修订）**：`PathPatchValue<UnknownPath<...>>` 显式收敛为 **`never`**（不再透传回 `UnknownPath` 接口，堵住 A.3 死字段暗门）——即 C.1 中对该接口分支直接给 `never`，使 `patch`/`appendToArray`/`insertIntoArray` 的值参在失败路径上也是 `never`。**R4 接线修订**：旧「与 path 参数 never 交叉」机制已废弃（A.7.1.1），值参现在与 **rest 缺参标记（`FailClosedRest`/`ArrayEditRest` → TS2554）** 构成**双重 fail-closed**：真正失败路径在「rest 标记缺参」与「value 值参 never」两个位置都被钉死为不可匹配，任何一方失效都不至于静默放行（接线机制见 A.7.1.2）。

**读投影对 UnknownPath 的红线锚定（R2 机制 + R4 接线修订）**：`read` 对未声明路径的返回 `PathValue<PathAt<Map,['notDeclared']>>` = `VfslValueOf<UnknownPath>` = `UnknownPath`（`VfslValueOf` 的 `: T` 对非 `PathSchema` 原样透传），读投影不塌陷成业务值；**但读访问点由 rest 缺参标记拦截**（A.7.1.2 `FailClosedRest` → TS2554，R4 取代旧 path never 交叉），保证无法真正读到 `UnknownPath`。「读未声明路径必须编译错误」由 SA6 负例 2 的 `@ts-expect-error` 锚定，返回类型形状恒为 `UnknownPath` 语义可被断言锚定（见 C.7 测试修订指令第 5 条）。

### A.7 `VfslTypedAccess<Map>` 访问面

对增广后的路径表，暴露六个类型严格的方法：三个读/写投影（`patch`/`read`/`kindOf`）+ 三个序列编辑（`appendToArray`/`insertIntoArray`/`deleteFromArray`）。对任意 `Map` 形状（空接口、本地接口、交叉类型皆可，见 A.7.3 与 B.2）通用；`Map` 的每一步解析由 A.4 `PathAt<Map,Path>` 完成，失败落 `UnknownPath` → rest 标记缺参（TS2554）使调用编译错误（fail-closed 从类型层扩散到调用点）。**R4**：fail-closed 由 A.7.1.2 的 rest 标记链承担（旧「条件 never 交叉」见 A.7.1.1 证伪）。

#### A.7.1 fail-closed 接线机制（R4 重写：废弃「条件 never 交叉参数」，采 `const P` + `NoInfer<P>` + 必需 rest 标记链；实测证伪链见下）

> **R4 先行交代（重要）**：本节的 v3 版（R2/R3 钉死的「条件 never 交叉参数」）已在有命令执行的会话被**实测证伪**——`pnpm typecheck` 首轮（`.mabf-bg/verify2.log`）全部 14 处合法路径调用点报 `TS2345: Argument of type 'string[]' is not assignable to parameter of type 'never'`，即**所有合法路径都被误杀**。R4 废弃该机制，按「实测通过的替代签名」重写本节。实测证据（可信，总控提供）+ 根因链 + 探针路径见 §A.7.1.1；新机制论证见 §A.7.1.2。

##### A.7.1.1 旧机制的实测证伪（R4 记录）

**失败证据**（`pnpm typecheck` 首轮，`.mabf-bg/verify2.log`）：两包 tsc 中 `vfsl-protocol-projection.test-d.ts` 共 14 行合法调用 `Argument of type 'string[]' is not assignable to parameter of type 'never'`（TS2345）。即所有正例（`patch(['name'],'ok')` 等）均被 fail-closed 误杀——**不是「个别歧义」，而是机制整体失效**：`Path & (PathAt<Map,Path> extends UnknownPath ? never : unknown)` 的右交叉对合法路径也坍缩成 `never`。

**根因链**（总控隔离实验 `.mabf-bg/probe/*.ts` 证实，三段）：

1. **参数类型含条件 → Path 推断回落到约束型 `readonly string[]`**：当形参位是 `Path & (…conditional…)` 时，`Path` 从实参 `['name']` 推断**不是**字面量元组 `readonly ['name']`，而是回落到**约束型** `readonly string[]`——SA2 攻击 2 的担忧（推断时序被条件交又破坏）**实名**。`.mabf-bg/probe/failclosed-probe.ts`（含注释 REPRO target）再现此现象。
2. **裸 `Path` 下元组推断成立、但字符串字面量被拓宽**：把条件从 path 参移出、参数只剩裸 `Path` 时，元组推断恢复，但 `['name']` 被推断为 `['name']` → 元素被拓宽成 `string`（约束元素型 `string` 提供上下文 → 拓宽）。于是 `PathAt<Map,[string]>` = UnknownPath → fail-closed 误杀。`.mabf-bg/probe/variants.ts`（C/E/H/J 五种签名形状）证实：仅裸参或交叉参均无法同时「元组 + 字面量保留」。
3. **`string & {}` 约束不能阻止拓宽**：`.mabf-bg/probe/constraints.ts` 实测五种约束形状（`string & {}` 元素、`[string & {}]` 首元素、`[never & string]`、`string & object` 等）元素推断**全部**被拓宽成 `string`，无一保留字面量。

**证伪结论**：v3 的 A.7.1（含 R3 轨一理论论证「裸成员承担推断、条件在类型实参实例化后求值」）在真实 TS 5.9.3 上不成立——交叉右分量让 `Path` 的推断回落到约束型。R3 轨一的「库生态同型签名先例」论点因条件位置（右分量）与裸位（左分量）**同时出现于同一交叉内**时推断规则不同而失效。**旧机制（含 R3 轨一/轨二）整体废弃**，R3 轨一的 read/kindOf 单点论证亦不再适用（read/kindOf 的新 fail-closed 由 rest 标记承担，见 A.7.1.2），原 §F.1 对 read/kindOf 的「须实测闭环」欠账由探针实测兑付（见 §F）。

##### A.7.1.2 新机制（R4 采纳，实测通过）—— `const P` 字面量保留 + `NoInfer` 单源推断 + 必需 rest 标记 fail-closed

实测通过的替代机制全文来自总控探针 `.mabf-bg/access-probe3.ts`（import 真实 `src/index.ts` 类型，**EXIT=0 全绿**：18 条正例全部精确编译 + 10 条负例全部 fail-closed，调用面零 `as const`）。机制三件套：

```ts
/** FAIL-CLOSED rest 标记（不导出，A.7.1.2）：合法路径 → []（零额外实参）；UnknownPath → [error:'…']（缺必需实参 → TS2554）。 */
type FailClosedRest<M, P extends readonly unknown[]> =
  PathAt<M, NoInfer<P>> extends UnknownPath<infer _> ? [error: '路径不可解析 (UnknownPath)'] : [];

/** 序列编辑三件套的 rest 标记（不导出，A.7.1.2）：path 非 array 节点 → [error:'非 array 节点']。 */
type ArrayEditRest<M, P extends readonly unknown[]> =
  PathAt<M, NoInfer<P>> extends UnknownPath<infer _>
    ? [error: '路径不可解析 (UnknownPath)']
    : PathKind<PathAt<M, NoInfer<P>>> extends 'array' ? [] : [error: '非 array 节点'];

interface VfslTypedAccess<Map> {
  patch<const P extends readonly string[]>(
    path: P, value: PathPatchValue<PathAt<Map, NoInfer<P>>>, ...rest: FailClosedRest<Map, P>): void;
  read<const P extends readonly string[]>(
    path: P, ...rest: FailClosedRest<Map, P>): PathValue<PathAt<Map, NoInfer<P>>>;
  kindOf<const P extends readonly string[]>(
    path: P, ...rest: FailClosedRest<Map, P>): PathKind<PathAt<Map, NoInfer<P>>>;
  appendToArray<const P extends readonly string[]>(
    path: P, value: PathElementValue<PathAt<Map, NoInfer<P>>>, ...rest: ArrayEditRest<Map, P>): void;
  insertIntoArray<const P extends readonly string[]>(
    path: P, index: number, value: PathElementValue<PathAt<Map, NoInfer<P>>>, ...rest: ArrayEditRest<Map, P>): void;
  deleteFromArray<const P extends readonly string[]>(
    path: P, index: number, ...rest: ArrayEditRest<Map, P>): void;
}
```

**机制要点逐条论证（TS 条款依据）**：

- **`const P` 类型参数（TS 5.0+）——字面量保留的唯一实测可行手段**：`<const P extends readonly string[]>` 使数组字面量实参推断为**只读元组且保留字符串字面量元素**——`['name']` → `readonly ['name']`（TS 5.0 release notes 条目 *const type parameters*：`const` 修饰的类型参数推断时对实参内的字面量类型不拓宽、保留字面量）。这是上面根因链 2/3（`string & {}` 约束不可阻止拓宽）的**唯一实测解**。仓库 TS `^5.9.3`（实际 5.9.3）满足 `const type parameter` 的 5.0 版本门槛。
- **`NoInfer<P>`（TS 5.4+）——rest/value/返回位不产生推断候选**：`PathAt<Map, NoInfer<P>>` 里 P 出现于 `NoInfer<…>` 内，告诉 TS 这些位置**不参与推断**（TS 5.4 release notes 条目 *NoInfer Utility Type*：禁止在 NoInfer 内发生的类型参数从该位置推断）。于是 P **只从 `path` 实参**推断，rest/value/返回位的 `PathAt<Map,NoInfer<P>>` 是**已推断 P 的消费方**，不反向干扰 `P`。这从根上消除了旧机制根因链 1（条件交叉位反向拖累推断）。
- **fail-closed 改由「必需 rest 形参标记」承担**：`...rest: FailClosedRest<Map, P>` 是一条**可选可空的 rest 元组**：合法路径 → 条件假 → `[]`（零额外实参，调用面**不变**，不引入 `as const`、不要求多写参数）；`UnknownPath` → 条件真 → `[error: '…']` 单元素 tuple——调用面未提供该参数时缺**必需第 N 参数** → tsc 报 **TS2554: Expected N arguments, but got N-1** → 编译错误（正/负例形态见 A.7.1.3）。与旧机制「path 参数坍缩 never」报 TS2345（类型不可赋值）相比，**错误位置移到「缺参错误 TS2554」**，`@ts-expect-error` 同样命中，且**不再把合法路径误杀成 never**（见 A.7.1.3 重推）。错误消息以**具名元组元素词**内嵌中文说明（`[error: '路径不可解析']`/`[error: '非 array 节点']`），DX 可读（TS 3.0+ *named tuple elements*，元组元素可带 `error:` 标签，错误提示呈现标签词）。
- **value 参双重 fail-closed 保留**：`patch`/`append`/`insert` 的 value 参类型 `PathPatchValue<PathAt<Map,NoInfer<P>>>` / `PathElementValue<…>` 在失败路径上 = `PathPatchValue<UnknownPath> = never`（A.6 R2 既有），**实测负例 `appendToArray(['tree','entities'],'x')` 等由 value never 报错**。于是含 value 方法在失败路径上「rest 缺参 TS2554」与「value 参 never」双钳，互为兜底。
- **三件套 array 门禁同样改 rest 标记链**：`ArrayEditRest` 在 path 非 array 节点（`PathKind ≠ 'array'`）时也给 `[error:'非 array 节点']` → 缺参 TS2554（`deleteFromArray(['name'],0)` 实测 go ERR）。合法 array 节点 → `[]`。**与 `FailClosedRest` 组合**：UnknownPath 优先判、再判 array-kind。
- **实测锚定（已在探针层面闭环，见 §F）**：`const P` 对空路径 `[]` 推断 `readonly []` → `kindOf([])` 返回 `'map'` ✓（D5）；`read(['tree','entities','0','url'])` 返回 `string | undefined` ✓（R2 读投影机制不变）；`patch(['tree','entities','0'],{kind:'image',url:'u'})` value 精确匹配判别联合 ✓（值类型一轨不被 rest 破坏）。

**回归/边界说明（与旧 A.7.1 的对比）**：

- **合法路径不再误杀**：`const P` 保证字面量保留，`PathAt<Map, NoInfer<P>>` 对 `['name']` 解析到真节点 → `FailClosedRest = []` → 调用只需 path/value 两参，形态与旧设计一致，「合法路径必须编译」恢复。
- **失败路径错误形态变化**：由「path 参数 TS2345 never」改为「rest 缺参 TS2554」（read/kindOf/delete 无 value 时单点；patch/append/insert 另有 value never 兜底）。**负例错误形态按此重推**（A.7.1.3）：所有 `@ts-expect-error` 负例命中「缺参 或 value never」，不再命中「path never」。
- **`@ts-expect-error` 命中语义**：TS2554 与 value never 报错都在**同一调用表达式**上，`@ts-expect-error` 注释覆盖该行 → 命中 ✓（vitest typecheck 的 unused-directive 反向守卫仍有效）。
- **为何不再用「重载分流」备选**：结论与 R2 一致（签名翻倍、否决重载易遮蔽合法），且 rest 标记链在单签名内完成「成功=零参数、失败=缺参」，更紧凑、实测通过。

##### A.7.1.3 正/负例推演（R4 按新签名重推）

**正例（全部编译通过，零额外实参）**（`Map = AugVfslPathMap & VfslPathMap`）：

- `patch(['name'],'ok')`：`P=readonly ['name']`（`const` 保留字面量）→ `PathAt<Map,NoInfer<['name']>> = PathSchema<string,'leaf'>` ≠ UnknownPath → `FailClosedRest=[]` → rest 收零实参：p=[前 2 参，无 rest] → 合法 ✓；value=`PathPatchValue<…>=string`，`'ok'` 匹配 ✓。
- `patch(['tree','entities','0','url'],'https://x')`：`PathAt = PathSchema<string,'leaf'>|undefined`（A.4 补位）。条件判据 `PathAt … extends UnknownPath<infer _>`：`PathAt` 是类型别名引用（非裸参数）不逐成员分发，整体匹配 `UnknownPath` → `PathSchema|undefined` 结构不满足（`__kind='leaf'`、无 `__path`）→ 判假 → `[]` → 合法 ✓；value=`PathPatchValue`（写投影丢弃 undefined，A.6）= `string`，`'https://x'` 匹配 ✓。**`|undefined` 合法不分与此「node≠UnknownPath」判据严格分隔，不串扰**（同 R2 论证，在新机制下由 `NoInfer` 消费位求值，判据唯一）。
- `read(['name'])` → `P=['name']` → 合法 rest=[] → 返回 `PathValue<…> = string` ✓；`kindOf([])` → `P=readonly []` → 合法 → `'map'` ✓。
- `appendToArray(['tree','entities'],{kind:'image',url:'u'})`：path 解析到 array 节点、非 UnknownPath → `ArrayEditRest` 再判 `PathKind='array'` → `[]` → 合法；value=`PathElementValue` = 判别联合元素，字面量匹配 ✓。

**负例（全部编译错误，`@ts-expect-error` 命中；错误形态 = rest 缺参 TS2554 或 value never）**：

- **空表**（`LocalEmptyMap`）：`patch(['name'],'ok')`/`patch(['assets'],{})`/`read(['name'])`/`kindOf(['name'])` → `PathAt<LocalEmptyMap,[…]>` 恒 UnknownPath → `FailClosedRest=[error:'…']` → 缺 rest 必需参数 → **TS2554** → 错 ✓（四 `@ts-expect-error` 命中，B.1 三处不改语义）。
- `patch(['notDeclaredKey'],'x')`：键空间查无 → UnknownPath → rest=[error] → 缺参 TS2554 → 错 ✓（同时 value 也 never，双钳）。
- `patch(['tree','title','name'],'x')`：`'title'` leaf 终态下钻 → 段失败 → UnknownPath → rest=[error] → 缺参 → 错 ✓。
- `patch(['tree','entities','0','nonexistentField'],'x')` / `patch(['tree','entities','0','title'],'x')`：键空间查无 → UnknownPath → 缺参 → 错 ✓。
- `read(['notDeclaredKey'])` / `kindOf(['notDeclaredKey'])`（**read/kindOf 单点 fail-closed**）：无 value 参，失败方向由 rest 缺参 TS2554 单点承担——**实测 access-probe3 负例 `read(['nope'])` go ERR ✓（探针级闭环）**，原 R3 轨一「双点/单点理论质差」随旧机制一并废弃，此方向已由探针实测（§F）。
- `patch(['name'],42)`：path 合法 → rest=[] 不报缺参；**value** 需 `string`、`42` 不匹配 → TS2345 → 错 ✓。
- `patch(['tree','entities','0'],{kind:'image'})`：value 判别联合缺必填 `url` → 结构不匹配 → 错 ✓。
- `patch(['tree','entities','0'],'not-an-entity')`：value 需判别联合、字符串不匹配 → 错 ✓。
- `appendToArray(['tree','entities'],'x')`：path 合法 → ArrayEditRest=[]（array 节点），**value** 需 `PathElementValue` 判别联合、`'x'` 字符串 → 错 ✓（实测 value never 拦截）。
- `insertIntoArray(['tree','entities'],0,{kind:'video'})`：value kind 不在判别联合 → 错 ✓。
- `deleteFromArray(['name'],0)`：path=`leaf` 非 UnknownPath 但 `PathKind='leaf'≠'array'` → `ArrayEditRest=[error:'非 array 节点']` → 缺参 TS2554 → 错 ✓。
- `read(['tree','attachments','0'])`：`attachments` plain 终态下钻 → UnknownPath → rest=[error] → 缺参 → 错 ✓（D1 plain 终态 fail-closed 保留）。

#### A.7.2 六方法完整签名（R4：rest 标记链版）

```ts
export interface VfslTypedAccess<Map> {
  /* 写投影：path 落 UnknownPath 时 rest 标记 [error]→缺参 TS2554；value 用 A.6 写投影（丢弃 undefined），失败亦 never（value 双重 fail-closed）。R4 改 NoInfer 消费位。 */
  patch<const P extends readonly string[]>(
    path: P,
    value: PathPatchValue<PathAt<Map, NoInfer<P>>>,
    ...rest: FailClosedRest<Map, P>
  ): void;

  /* 读投影：返回 PathValue（member 独有键经 A.4.1 补位 → 含 | undefined）。R4：fail-closed 由 rest 缺参承担。 */
  read<const P extends readonly string[]>(
    path: P,
    ...rest: FailClosedRest<Map, P>
  ): PathValue<PathAt<Map, NoInfer<P>>>;

  /* kind 投影：返回 PathKind（失败 'unknown'、根 'map'，A.5）。R4：fail-closed 由 rest 缺参承担。 */
  kindOf<const P extends readonly string[]>(
    path: P,
    ...rest: FailClosedRest<Map, P>
  ): PathKind<PathAt<Map, NoInfer<P>>>;

  /* 序列编辑三件套：path 须解析到 'array' kind 节点（ArrayEditRest 把非 array 标为缺参）；下标为显式参数。
     R2（攻击点 4）：value 改用 PathElementValue（数组元素子树读投影 = 单元素判别联合），非整数组写投影。R4 全改 rest 标记链。 */
  appendToArray<const P extends readonly string[]>(
    path: P,
    value: PathElementValue<PathAt<Map, NoInfer<P>>>,
    ...rest: ArrayEditRest<Map, P>
  ): void;

  insertIntoArray<const P extends readonly string[]>(
    path: P,
    index: number,
    value: PathElementValue<PathAt<Map, NoInfer<P>>>,
    ...rest: ArrayEditRest<Map, P>
  ): void;

  deleteFromArray<const P extends readonly string[]>(
    path: P,
    index: number,
    ...rest: ArrayEditRest<Map, P>
  ): void;
}
```

**要点**：六方法签名完全对齐实测通过的探针 `ProbeAccess`（`.mabf-bg/access-probe3.ts`）——`const P` 保留字面量、`NoInfer<P>` 单源推断、`FailClosedRest`/`ArrayEditRest` 承担 fail-closed 与 array-kind 门禁。**调用面不变**：合法路径 rest 收零实参（与旧设计参数个数一致），失败路径借「缺必需 rest 参数 → TS2554」报错。

**序列编辑的 array-kind 约束推演（R4，rest 标记版）**：

- **合法** `access.appendToArray(['tree','entities'], {kind:'image',url:'u'})`：`P=['tree','entities']` → `PathAt<Map,NoInfer<...>>` = `PathSchema<Record<\`${number}\`,EntityMap>,'array'>` ≠ UnknownPath → `ArrayEditRest` 再判 `PathKind='array'` → `[]` → 收零 rest；**value 用 `PathElementValue<array节点>`**（A.5）——`VfslValueOf` = 判别联合 → `{kind:'image',url:'u'}` 匹配 image 成员 ✓。
- **非法** `access.appendToArray(['tree','entities'], 'x')`：path 合法 array 节点 → `ArrayEditRest=[]` 不报缺参；**value** `'x'` 需判别联合元素、字符串不匹配 → 错 ✓（实测：value never 拦截）。这是「值类型错误」而非路径错——数组三件套语义锚定见 C.7 测试修订指令第 3 条。
- **非法** `access.deleteFromArray(['name'], 0)`：`PathAt<Map,NoInfer<['name']>>` = `PathSchema<string,'leaf'>` 非 UnknownPath，但 `PathKind='leaf'≠'array'` → `ArrayEditRest=[error:'非 array 节点']` → 缺 rest 必需参数 → **TS2554** → 错 ✓（array-kind 门禁，delete 无 value 故只靠 rest 缺参单点）。
- **下标显式参数**：`index: number` 与 path 元组无关——path 只锚定到数组**节点**，不承载具体下标（下标的键空间已在 `PathAt` 层经模板数字键处理，此处不必重复），TASK.md 冻结的三件套均以显式 `index` 参数收受。**value 三件套（append/insert）= `PathElementValue`（单元素判别联合），非整数组 `PathPatchValue`（`Record<number,元素>`）**——这是攻击点 4 的修订核心。

#### A.7.3 接口泛化

`VfslTypedAccess<Map>` 对 `Map` **形状无预设**（不要求 `Map` 是某 named interface/自带品牌）：只要传给 `PathAt<Map,Path>` 即可。三种 Map 形状的`RootSchema<M> = PathSchema<M,'map'>`（A.4）对空 `M={}`、本地接口、交叉类型同样成立——`M extends Record<...>` 在 `Step` 处对任一种对象类型做键查找。这使空表测试可用**本地空接口** `interface LocalEmptyMap {}` 充当 M（B.1），等效于未增广的 `VfslPathMap`；交叉类型根 `AugVfslPathMap & VfslPathMap` 见 B.2 推演（键空间并集，等价于增广后 VfslPathMap）。

## §B 已知张力裁决

### B.1 module augmentation 程序级泄漏 → 空表测试改用本地空接口（裁决）

**张力**：TS 的 `declare module '@nomicore/vfsl-protocol' { interface VfslPathMap {...} }` 增广对整个 tsc program **全局生效**（TS 手册 *Module augmentation*：对 module 声明接口的扩展影响全场，无文件局部作用域）。vitest typecheck 把 `*.test-d.ts` 全部纳入同一 program 编译 → `projection.test-d.ts` 的增广会泄漏进 `empty-fail-closed.test-d.ts`：彼文件写 `VfslTypedAccess<VfslPathMap>` 将**看到已增广接口**（其自身本想锚定空表 `VfslPathMap`），空表负例的 `@ts-expect-error` 自我反转失败——「未使用的 @ts-expect-error」同样编译错误（TS 手册 *unused @ts-expect-error directive*），测试反而失败。

**裁决**：`VfslPathMap` 本是空接口（未增广 = `{}`），空表 fail-closed 语义 = 「空接口 Map 的任一路径都解析失败」。故 empty 测试改用**本地声明的空接口**锚定同一语义：

```
interface LocalEmptyMap {} // 文件内私有，不受他文件增广影响
declare const access: VfslTypedAccess<LocalEmptyMap>;
```

**等价性**：LocalEmptyMap 与未增广 VfslPathMap 同为「零字段接口」，`{ keyof LocalEmptyMap = {} }`、`{}[key]` 键查无成立 → `PathAt<LocalEmptyMap,Path>` 恒 `UnknownPath` → fail-closed 机制在独立文件内可复现、可替换（把 LocalEmptyMap 换成未增广 VfslPathMap 断言结果不变）。

**对 `vfsl-protocol-empty-fail-closed.test-d.ts` 的最小修订指令（SA6 owned，共 3 处；执行者为 SA6 / 总控派 SA6 修订轮，见 C.7——不是 SA3）**：

1. **改第 1 行类型**：`declare const access: VfslTypedAccess<VfslPathMap>` → `declare const access: VfslTypedAccess<LocalEmptyMap>`。理由：文件内 name 引用改为本地空接口，切断对他文件增广的依赖；断言语义不变（仍是「空表 Map 全路径 fail-closed」）。
2. **新增一行**：在 access 声明上方加 `interface LocalEmptyMap {}`（文件内私有，可加 `// @ts-ignore` 避免 no-empty-interface lint 或改用 `interface LocalEmptyMap {}` 前缀 `export {}` 保模块性）。理由：锚定「空接口即空表」的机制语义，替代被全局增广污染的 `VfslPathMap` 引用。
3. **不再改动**：四个 `@ts-expect-error` 断言体（`patch(['name'],'ok')`/`patch(['assets'],{})`/`read(['name'])`/`kindOf(['name'])`）原样保留——它们的命中判据（`Map` 为空 → `PathAt` 恒 `UnknownPath` → rest 标记 `[error]` → 缺参 TS2554 / value never，见 A.7.1.3）只依赖 `Map` 为空，与具体 Map 名无关，故断言语义不变。

**备选评估并弃用**：
- **vitest 双 project / 独立 tsconfig 隔离**：把 empty 测试放进单独 tsconfig/project 可避免增广泄漏，但引入 project 边界、类型检查配置翻倍、与既有 vitest 单 program 接线冲突；且「泄漏」本身是机制特性，隔离治标不治本。弃用。
- **`// @ts-ignore` 包住增广**：仅在 projection 文件局部压制，但会静默掩盖增广本身的错误，风险大于收益。弃用。

### B.2 `VfslTypedAccess<AugVfslPathMap & VfslPathMap>` 交叉类型根

SA6 实际写法 `AugVfslPathMap = {} & import('...').VfslPathMap`，根 `Map = AugVfslPathMap & VfslPathMap`。推演（R2 走 A.4.1）：`RootSchema<M>`（A.4）把 M 整表包为 `PathSchema<M,'map'>`；`Step` 对 `M` 值先 `MemberKeys<M>` 求键空间再 `MemberLookup<M,Seg>` 取键。交叉根是**单类型不分发**：`MemberKeys<AugVfslPathMap & VfslPathMap>` = `keyof(AugVfslPathMap & VfslPathMap)` = **`keyof AugVfslPathMap ∪ keyof VfslPathMap`**（TS 手册 *keyof of intersection*，键空间并集）；`MemberLookup<M,Seg>` 逐分发单成员、`Seg extends keyof(M)` 命中则取 `(A&B)[Seg]`、不命中则补 undefined（此处不命中即段失败，门禁已拒）。叠三者为：`Map` 键空间 = `keyof AugVfslPathMap ∪ keyof VfslPathMap`，每键值 = 二者对应分量等价合并——与旧 `V[Seg]` 结论一致，仅机制源更新为 A.4.1。

**结论**：`AugVfslPathMap & VfslPathMap` 的键空间 = 增广后 VfslPathMap 自身（`{} & VfslPathMap` 与 `VfslPathMap` 键空间相同，空对象不贡献键）→ **该写法等价于直接用已增广 VfslPathMap**；且 `PathAt` 对交集键查找与对单接口一致 → 正例（A.7.3）不受影响。这是对 B.1 的补充：即便 projection 文件用交叉根，也只在**本 fileset** 内成立，另一文件（B.1）仍须本地空接口隔离。

### B.3 `Record<\`${number}\`,T>` 下标匹配依据（补 SA6 用例）

依据见 A.4：mapped type `Record<\`${number}\`,T>` 对 `Seg extends \`${number}\`` 的字面量（`'0'`/`'5'`）在 `V[Seg]` 处由模板字面量模式解析为元素类型（TS 手册 *template literal pattern types / indexed access*）。

**SA6 用例 `['tree','entities','5']` 推演（R2，走 A.4.1）**：`entities` 节点 = `PathSchema<Record<\`${number}\`,EntityMap>,'array'>`，`Step<..., '5'>` → `K='array'` 可下钻 → `MemberKeys<Record<\`${number}\`,EntityMap>>`=`` `${number}` `` 含 `'5'` ✓ → `MemberLookup<Record<\`${number}\`,EntityMap>,'5'>`：单成员 Record 分发、`'5' extends keyof` = `${number}` ✓ → `V['5']` 模板键匹配 → `EntityMap` 元素子树（单对象不分发，无 undefined）→ `PathAtImpl<EntityMap, []> = EntityMap` 本身。`PathKind='map'`、`PathValue=Image|Text`（A.6）✓。

### B.4 `kindOf([])` 与空路径

`PathKind<PathAt<Map,[]>>` = `PathKind<RootSchema<Map>>`（A.4 `[]` 根分支）= `'map'`（A.5 `RootSchema` K='map'）。一句话：空路径 → 根节点 → kind 恒 `'map'`（D5 根即 map）。

---

## §C 文件级实施蓝图（SA3 工作单）

> 本节是 SA3 的精确工作单：逐文件给全文或精确规格。**执行原则（D3）**：`index.ts` 是唯一核心交付物，SA3 照抄 C.1（零值导出、零依赖）；其余为接线文件。任何涉及 `[SA6 owned]` 文件的改动必须 SA3 先报总控，由 SA6 执行（见 C.7）。

### C.1 `packages/vfsl-protocol/src/index.ts` — 完整最终代码（核心交付物）

整合 §A 各节：imports 无（零依赖）；`VfslKind`、品牌（A.1）、`PathSchema`（A.2）、`UnknownPath`（A.3）、`RootSchema`/`MemberKeys`/`MemberLookup`/`Step`/`PathAtImpl`/`PathAt`（A.4/A.4.1）、`VfslValueOf`/`PathValue`/`PathKind`/`PathPatchValue`/`PathPatchUnwrap`/`PathElementValue`（A.5/A.6）、`FailClosedRest`/`ArrayEditRest`（A.7.1.2 内部助手）、`VfslTypedAccess`（A.7.2）、`VfslPathMap` 空接口。**零值导出纪律**：全文件只有 `declare`（ambient）+ interface + type + type-only export，经 `tsc` 编译产物为空模块（SA6 `empty-module.test.ts` 断言）。内部助手 `MemberKeys`/`MemberLookup`/`Step`/`PathAtImpl`/`PathPatchUnwrap`/**`FailClosedRest`**/**`ArrayEditRest`** 不导出。每个导出都有 TSDoc；引用 A 节 Anchor 回溯源。**R4 提示**：`NoInfer`/`const P` 均依赖仓库 TS 5.9.3（NoInfer 5.4+ / const type parameter 5.0+，均满足）；它们是 TS **内建**助手（非导出项），无需 import。

```ts
/** 幻影口袋：仅作类型标定，零运行时，编译后是空声明、无任何值导出。（A.1） */
declare const __vfslNodeBrand: unique symbol;
type VfslNodeBrand = typeof __vfslNodeBrand;

/** kind 词汇表（ADR 0003）：schema 树节点的五值 kind。（A.2） */
export type VfslKind = 'map' | 'array' | 'xml-fragment' | 'leaf' | 'plain';

/** 载体：一个被投影节点的类型声明。__brand 保证只能经本接口构造出「真」节点。（A.2） */
export interface PathSchema<Value, Kind extends VfslKind> {
  readonly __brand: VfslNodeBrand;
  readonly __value: Value;
  readonly __kind: Kind;
}

/** fail-closed 标记：代表「路径不可解析」的唯一终态。与真节点同形但 Kind 固定 'unknown'。（A.3） */
export interface UnknownPath<Path extends readonly unknown[]> {
  readonly __brand: VfslNodeBrand;   // 同品牌 → 与 PathSchema 同属「节点族」的互斥分支
  readonly __value: never;           // 取值失败：never 污染任何 PathValue 读取
  readonly __kind: 'unknown';
  readonly __path: Path;             // 保留原路径，便于诊断（不参与访问面判据）
}

/** 根的抽象表示：把 PathMap 整表当作一个 'map' 节点（V = Map 自身，不展开子级）。（A.4） */
export type RootSchema<M> = PathSchema<M, 'map'>;

/** 键空间并集：对 union V 逐成员分发取各成员 keyof 再并集（≠ keyof(union)=交集）。（A.4.1，不导出） */
type MemberKeys<V> = V extends Record<infer Key, unknown> ? Key : never;

/** 成员独有键取键：逐成员分发，有该键者取 V[Seg]、缺键者补 undefined，各分支并集——读投影 T|undefined 唯一来源。（A.4.1，不导出） */
type MemberLookup<V, Seg> = V extends unknown
  ? Seg extends keyof V ? V[Seg] : undefined
  : never;

/** 单段推进：Node 当前节点、Seg 消费段。命中→下一层节点（可为 节点|undefined）；未命中/越终态→ never。（A.4，不导出） */
type Step<Node, Seg> =
  Node extends PathSchema<infer V, infer K>
    ? K extends 'map' | 'array'          // 仅可下钻节点接受段；leaf/plain/xml-fragment 为终态
      ? Seg extends MemberKeys<V>        // Seg ∈ 成员键空间并集（字面量键 / 模板数字键）
        ? MemberLookup<V, Seg>           // 逐成员取键：命中成员取 V[Seg]、缺键成员补 undefined
        : never                          // 不在键空间并集 → 段失败
      : never                            // 越过终态节点下钻 → 拒绝（D1 plain 终态）
    : never;

/** 内部递归：以当前节点与剩余段列表解析；任一段失败→标记失败（保留未消费路径供诊断）。（A.4，不导出） */
type PathAtImpl<Node, Remaining> =
  Remaining extends readonly []
    ? Node                               // 段消费完毕 → 当前节点即结果
    : Remaining extends readonly [infer Seg, ...infer Rest]
      ? Step<Node, Seg> extends infer Next
        ? [Next] extends [never]
          ? UnknownPath<Remaining>       // 失败态：保留未消费路径
          : PathAtImpl<Next, Rest>
        : never
      : never;

/** 公开入口：M 从根 'map' 节点开始。[] → RootSchema<M>（D5）；否则逐段推进。（A.4） */
export type PathAt<M, Path extends readonly unknown[]> = PathAtImpl<RootSchema<M>, Path>;

/** 整值投影：把 PathSchema 节点递归剥回运行时值类型；非节点原样返回（含 undefined 透传）。（A.5） */
export type VfslValueOf<T> =
  T extends PathSchema<infer V, infer K>
    ? K extends 'map' | 'array'
      ? (V extends Record<infer Key, unknown>
          ? { [K2 in Key]: VfslValueOf<V[K2]> }   // 递归展开映射/数组元素子树
          : V)
      : V                                        // leaf/plain/xml-fragment 直取
    : T;

/** 读投影：从 PathAt 节点取「读出的值类型」（成员独有字段含 undefined，见 A.6）。（A.5） */
export type PathValue<Node> = VfslValueOf<Node>;

/** kind 投影：取节点的 __kind；失败走 'unknown'、根走 'map'（D5）。（A.5） */
export type PathKind<Node> =
  Node extends UnknownPath<infer _P> ? 'unknown'
  : Node extends PathSchema<infer _V, infer K> ? K
  : never;

/** 写投影：patch 值参数使用的类型（成员独有键 → 声明处 T，丢弃 undefined；UnknownPath→never 双重 fail-closed）。（A.6） */
export type PathPatchValue<Node> =
  Node extends UnknownPath<infer _P> ? never            // R2：失败态显式 never（攻击 6，双重 fail-closed）
  : Node extends PathSchema<infer V, infer K>
      ? PathPatchUnwrap<V, K>                           // 真节点 → 剥回声明处值类型
      : never;                                          // read 特有的 undefined（或垃圾）丢弃

/** 写投影递归展开：map/array 逐子节点剥回；leaf/plain/xml-fragment 直取。（A.6，不导出） */
type PathPatchUnwrap<V, K> =
  K extends 'map' | 'array'
    ? (V extends Record<infer Key, unknown>
        ? { [K2 in Key]: PathPatchValue<V[K2]> }
        : V)
    : V;

/** 数组元素读投影：array 节点 Value=Record<`${number}`, 元素子树> → 元素子树经 PathValue 展开（append/insert 的 value）。（A.5，R2） */
export type PathElementValue<Node> =
  Node extends PathSchema<infer V, infer K>
    ? K extends 'array'
      ? (V extends Record<infer _Idx, infer ElementNode>
          ? VfslValueOf<ElementNode>
          : never)
      : never
    : never;

/** FAIL-CLOSED rest 标记（不导出，A.7.1.2）：合法路径 → []（零额外实参，调用面不变）；UnknownPath → [error:'路径不可解析']（缺必需参数 → TS2554）。 */
type FailClosedRest<M, P extends readonly unknown[]> =
  PathAt<M, NoInfer<P>> extends UnknownPath<infer _>
    ? [error: '路径不可解析 (UnknownPath)']
    : [];

/** 序列编辑三件套 rest 标记（不导出，A.7.1.2）：先判 UnknownPath（同上），再判 PathKind 非 'array' → [error:'非 array 节点']（缺参 TS2554）。 */
type ArrayEditRest<M, P extends readonly unknown[]> =
  PathAt<M, NoInfer<P>> extends UnknownPath<infer _>
    ? [error: '路径不可解析 (UnknownPath)']
    : PathKind<PathAt<M, NoInfer<P>>> extends 'array' ? [] : [error: '非 array 节点'];

/** 访问面：六个类型严格方法。const P（TS5.0）保留路径字面量元组；NoInfer<P> 令 P 只从 path 实参推断；fail-closed 由必需 rest 标记承担（缺参 → TS2554），value 兼有 never 兜底。设计源见 A.7.1.2。 */
export interface VfslTypedAccess<Map> {
  /** 写投影：path 落 UnknownPath → rest=[error]（缺参 TS2554）；value 用写投影（丢弃 undefined），失败亦 never → 双重 fail-closed。 */
  patch<const P extends readonly string[]>(
    path: P,
    value: PathPatchValue<PathAt<Map, NoInfer<P>>>,
    ...rest: FailClosedRest<Map, P>
  ): void;
  /** 读投影：返回读出的值类型（member 独有键含 | undefined，A.4.1）。fail-closed 由 rest 缺参承担。 */
  read<const P extends readonly string[]>(
    path: P,
    ...rest: FailClosedRest<Map, P>
  ): PathValue<PathAt<Map, NoInfer<P>>>;
  /** kind 投影：返回 PathKind（失败 'unknown'、根 'map'）。fail-closed 由 rest 缺参承担。 */
  kindOf<const P extends readonly string[]>(
    path: P,
    ...rest: FailClosedRest<Map, P>
  ): PathKind<PathAt<Map, NoInfer<P>>>;
  /** 序列编辑：path 须解析到 'array' kind 节点（ArrayEditRest 标缺参）；value=单元素判别联合（PathElementValue）追加到数组末尾。 */
  appendToArray<const P extends readonly string[]>(
    path: P,
    value: PathElementValue<PathAt<Map, NoInfer<P>>>,
    ...rest: ArrayEditRest<Map, P>
  ): void;
  /** 序列编辑：path 须解析到 'array'；按下标插入单元素（index 显式参数）。 */
  insertIntoArray<const P extends readonly string[]>(
    path: P,
    index: number,
    value: PathElementValue<PathAt<Map, NoInfer<P>>>,
    ...rest: ArrayEditRest<Map, P>
  ): void;
  /** 序列编辑：path 须解析到 'array'；按下标删除元素（无 value，fail-closed 只靠 rest 缺参单点）。 */
  deleteFromArray<const P extends readonly string[]>(
    path: P,
    index: number,
    ...rest: ArrayEditRest<Map, P>
  ): void;
}

/** 顶层路径表：空接口占位，由消费方 module augmentation 增广（本项目测试文件增广）。（D5） */
export interface VfslPathMap {}
```

**SA3 校验清单（R4 同步）**：① 无 `import` 语句（零依赖；`NoInfer` 是 TS 内建助手，不 import）；② 除 `declare const __vfslNodeBrand` 与 TSDoc 外无任何值域代码，编译产物空模块；③ 全部语义类型 export；内部助手 `MemberKeys`/`MemberLookup`/`Step`/`PathAtImpl`/`PathPatchUnwrap`/`FailClosedRest`/`ArrayEditRest` 保持不导出；`PathElementValue` 是 export（供 append/insert 签名使用，A.5）；④ 每个 export 带 1 行 TSDoc；⑤ `VfslPathMap` 为可增广空接口（非 union `{}`，保证 module augmentation 可声明其成员）；⑥ `VfslTypedAccess` 六方法必须用 `const P` + `NoInfer<P>` + rest 标记（照抄 A.7.2，杜绝旧 never 交叉写法）。

### C.2 `packages/vfsl-protocol/package.json` — 全文

```json
{
  "name": "@nomicore/vfsl-protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

注：与既有 `@nomicore/vfsl` 模板同构；`exports` 指向 `.ts` 源（vitest 经 vfsl-protocol/tsconfig.json 解析，自名引用见 §D.2-⑧）。

### C.3 `packages/vfsl-protocol/tsconfig.json` — 全文

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`include` 覆盖 src+test，故 typecheck 能一次校验 `*.test-d.ts`（见 C.4 vitest `tsconfig` 指向）。

### C.4 `vitest.config.ts` 修订 — 全文

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    passWithNoTests: true,
    typecheck: {
      enabled: true,
      include: ['packages/*/test/**/*.test-d.ts'],
      tsconfig: './packages/vfsl-protocol/tsconfig.json',
    },
  },
});
```

**修订点**：
- **保留** `include` 既有 `*.test.ts` 规则——`pnpm test`（根脚本含 `--typecheck`，见 C.5）下普通单元测试照跑，vfsl 包 14 个测试文件不受影响。
- **新增** `test.typecheck.*`：vitest 3.2 `test.typecheck.enabled` / `test.typecheck.include` / `test.typecheck.tsconfig`（vitest 官方文档 *test.typecheck.* 条目：`enabled` 开关 `--typecheck` 支持、「.test-d.ts` 约定、`include` 指定 typecheck 目标、`tsconfig` 指定一个项目 tsconfig 用于校核）。`tsconfig` 只能指向**一个** tsconfig——type-d 文件全部位于 vfsl-protocol 包内，其 tsconfig（C.3）include 了 src+test，正好覆盖；vfsl 包无 type-d 文件，无需为其另配。
- **`passWithNoTests: true` 保留**：作为兜底，在 typecheck 目标集为空或有 test-d 的包在一次性安装前失败时不致整体红；不参与取舍既有 `*.test.ts` include。
- **R2 修订（攻击点 7 / §D.2-⑧）— 自名引用解析兜底**：测试文件自名 `import type {…} from '@nomicore/vfsl-protocol'`（name+exports 解析，TS 5.9 self-referencing + `.ts` exports 目标）。该解析未被本仓库验证，降级为中风险、由 SA4 列为专项门禁（可执行环境跑 `tsc -p packages/vfsl-protocol/tsconfig.json` 贴输出取证）。**兜底**：若自名解析在实践中失败，`*.test-d.ts` 的原 import 改相对路径 `import type {…} from '../src/index.js'`（同 program 内等价引用，type-d 编译单元即可解析）；但 `declare module '@nomicore/vfsl-protocol'` 的**增广目标必须是包名**才使 `VfslPathMap` 增广对同包名的 `import('@nomicore/vfsl-protocol')` 生效，故**以包名为准**、相对路径只作 fallback import 接缝、不改增广目标。

### C.5 根 `package.json` scripts 修订 — 钉死「单行 && 聚合」

钉死一种：**根脚本用单行 `&&` 直接聚合**，不在 `packages/*` 各包维护独立 test script（vfsl-protocol 只有 typecheck script，见 C.2；根层负责聚合）。

```json
{
  "scripts": {
    "typecheck": "tsc -p packages/vfsl/tsconfig.json && tsc -p packages/vfsl-protocol/tsconfig.json",
    "test": "vitest run --typecheck"
  }
}
```

- `typecheck` 一行 `&&` 聚合两包（vfsl 引擎包 + vfsl-protocol 协议包），CI 的 `pnpm typecheck` 自动覆盖两包。
- `test` 加 `--typecheck`，使 `vitest run` 同时执行 type-d 编译校验（依赖 vitest.config 的 `typecheck.enabled:true`，见 C.4）；CI 的 `pnpm test` 自动获得 typecheck 阶段。

### C.6 `pnpm-lock.yaml` importers — 精确手工条目

> CI 跑 `pnpm install --frozen-lockfile`，新增 importer 必须手工补进 lockfile（无法运行 `pnpm install`）。**R2 修订（攻击点 3，HIGH）**：实测 `pnpm-lock.yaml` 的 importer 键是 **2 空格**、`devDependencies:` **4 空格**、`typescript:`/`vitest:` **6 空格**、`specifier`/`version` **8 空格**（见仓库 `packages/vfsl:` 条目行 18-25，本设计 C.6 旧版误作 4 空格键 → 会被 YAML 解析为 vfsl 块的子键、pnpm 读不到新 importer）。**逐字节对齐修正如下**（与 `packages/vfsl:` 条目同缩进，插在 `packages/vfsl:` 条目之后、空行之下的同级）：

```yaml
  packages/vfsl-protocol:
    devDependencies:
      typescript:
        specifier: ^5.9.3
        version: 5.9.3
      vitest:
        specifier: ^3.2.4
        version: 3.2.7
```

（version 与 vfsl 条目同源锁定的 5.9.3 / 3.2.7；不动 lockfile 其它任何段——snapshot/registries 已覆盖这两个版本。**SA4 专项复核**：用 `cat -A` / 字节级 diff 核对本 importer 与 `packages/vfsl:`（行 18-25）逐字节对齐——`  packages/vfsl-protocol:` 两空格起头、非四空格；`    devDependencies:` 四空格；`      typescript:`/`      vitest:` 六空格；子级 `specifier`/`version` 八空格。）

### C.7 SA6 测试文件修订指令（B.1 裁决，SA6 owned）

> **R2 修订（攻击点 5，HIGH）——执行者钉死、流程顺序写清**。`vfsl-protocol-empty-fail-closed.test-d.ts` 的多处修订全部为 `[SA6 owned]`，**唯一执行者是 SA6**，由**总控在 SA2 复审通过（R2 获 pass）之后、SA3 落地实现之前，单独派一轮 SA6 修订轮**执行。**R3 追加**：该修订轮**一并对 projection 正例 5 改分发 helper**（C.7-5，R3 攻击点 1 CRITICAL 落点），与 B.1 三处 / empty 头注释 / 三件套断言**同轮执行**。**R4 追加**：fail-closed 机制已重写为 rest 标记版（A.7.1.2），SA6 修订轮的四 `@ts-expect-error` 断言体与三件套断言**原文保留**、命中判据更新为「rest 缺参 TS2554 / value never」（见 C.7-1 与 C.7-3）；SA6 需先按 A.7.1.3 核对负例错误形态已符合新机制。流程顺序钉死：
>
> ```
> SA1 R4 修订（本文档） → SA2 R4 复审（pass）→ 【总控派 SA6 修订轮】→ SA3 落地实现 → SA6/SA7 动态验证
> ```
>
> **SA3 全程不触碰任何 `[SA6 owned]` 文件**（SA6 owned = `vfsl-protocol-projection.test-d.ts` / `vfsl-protocol-empty-fail-closed.test-d.ts` / `vfsl-protocol-empty-module.test.ts`）；SA3 若因接线确需触碰，必须先报总控、由总控转派 SA6。**回读门禁**：SA6 修订轮完成时，总控/SA4 回读该文件出现 `LocalEmptyMap` 字样且四个 `@ts-expect-error` 仍在，方可放行进入 SA3。

**SA6 修订轮工作单**：

1. **empty 文件（B.1 三处）**：对 `packages/vfsl-protocol/test/vfsl-protocol-empty-fail-closed.test-d.ts`——
   1. `declare const access: VfslTypedAccess<VfslPathMap>` → `declare const access: VfslTypedAccess<LocalEmptyMap>`（切断对全局增广的依赖；B.1-1）；
   2. access 声明上方加 `interface LocalEmptyMap {}`（文件内私有；需保证模块性时前缀 `export {}`；B.1-2）；
   3. 四个 `@ts-expect-error` 断言体（`patch(['name'],'ok')`/`patch(['assets'],{})`/`read(['name'])`/`kindOf(['name'])`）**原样保留**（B.1-3：命中判据只依赖 Map 为空）。
2. **empty 文件头注释更新（攻击点 5 附带）**：文件头「分属不同编译单元」的理由已被 B.1 证伪为「module augmentation 程序级全局」——改文件头注释，删去「独立编译单元/隔离」的旧说法，改为「module augmentation 全局生效 → 用本地 `LocalEmptyMap` 锚定空表语义」。
3. **projection 文件新增三件套正例断言（攻击点 4，追加）**：在 `vfsl-protocol-projection.test-d.ts` 增补——
   - 正例：`access.appendToArray(['tree','entities'], {kind:'image',url:'u'})` 编译通过、value 推断为判别联合元素；`access.insertIntoArray(['tree','entities'],0,{kind:'text',body:'<p>x</p>'})` 编译通过；
   - 负例：`@ts-expect-error` 锚定 `access.appendToArray(['tree','entities'], 'x')`（value 需元素判别联合，字符串不匹配 → value never 报错，R4 机制，见 A.7.1.3）；如需补 array 门禁负例：`@ts-expect-error` 锚定 `access.deleteFromArray(['name'], 0)`（`ArrayEditRest=[error:'非 array 节点']` → 缺参 TS2554，R4）。
4. **projection 文件新增 PathElementValue / PathValue<UnknownPath> 类型断言（攻击点 6 补强）**：`expectTypeOf<PathElementValue<PathAt<Map,['tree','entities']>>>().toEqualTypeOf<{kind:'image',url:string}|{kind:'text',body:string}>()`（若可解析），以及锚定 `read` 未声明路径必须编译错误（负例 2 已覆盖）。
5. **projection 文件正例 5 两条窄化断言改分发 helper（R3 修订，攻击点 1 CRITICAL 落点）**：SA2 R2 证实 `vfsl-protocol-projection.test-d.ts` 正例 5（行 149-154）的 `type UrlWhenImage = Entity extends {kind:'image'} ? Entity['url'] : never` 与 `BodyWhenText` 两条断言因 `Entity` 是**具体联合类型别名**（非裸类型参数）而**不分发** → 恒 `never` → `not.toEqualTypeOf<never>()` 必 RED。**将正例 5 的断言改为泛型分发 helper**，断言语义不变（仍在证明「整值判别联合可按判别字段窄化访问成员独有字段」），精确替换写法如下：
   ```ts
   it('正例 5: 整值读出判别联合 —— 以 kind 字段窄化后访问成员独有字段（D2 整值窄化）', () => {
     type Entity = PathValue<PathAt<AugVfslPathMap, ['tree', 'entities', '0']>>; // Image|Text 判别联合
     // 分发 helper：E 是裸类型参数 → 条件类型逐成员分发；具体联合别名上直接 `Entity extends` 不分发（R3 修正）
     type UrlOf<E> = E extends { kind: 'image' } ? E['url'] : never;
     type BodyOf<E> = E extends { kind: 'text' } ? E['body'] : never;
     //UrlWhenImage/UrlBodyOf = UrlOf<Entity> = string|never = string ≠ never
     expectTypeOf<UrlOf<Entity>>().not.toEqualTypeOf<never>();
     expectTypeOf<BodyOf<Entity>>().not.toEqualTypeOf<never>();
     // 路径级窄化不做（D2）：成员独有字段含 undefined
     expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['tree', 'entities', '0', 'url']>>>().toEqualTypeOf<
       string | undefined
     >();
   });
   ```
   注：分发 helper 里 `UrlOf<Entity>` 实例化时 `E=Entity` 是**裸类型参数**（helper 的类型参数位），故逐 Image/Text 分发：Image 支 kind='image' 命中取 `url=string`、Text 支 kind='text' 走 `: never` → `string|never = string` ✓；BodyOf 对称 → `string`。`Entity` 值自身的**运行时控制流窄化**（`if (e.kind==='image')`，tsc 判别联合标准能力）不受此影响（A.6 断言 8 / A.6③）。此替换与 B.1 三处、正例 5 分发 helper、负例自我反转、空模块键集等**同轮执行**（详见 §F 与 C.9）。
6. **SA6 修订轮交付**：向总控回报「empty 文件含 `LocalEmptyMap`、头注释已改、projection 已加三件套正/负例、正例 5 已改分发 helper」，由总控记录在 dispatch log。

### C.8 `.github/workflows/ci.yml` — 结论：不动

**理由**：CI 步骤只调根脚本 `pnpm install` → `pnpm typecheck` → `pnpm test`；根 `typecheck` 脚本经 C.5 的 `&&` 聚合已覆盖 vfsl-protocol 包，根 `test` 脚本已含 `--typecheck`，故 CI 自动获得 type-d 编译校验与新包类型检查，无需改动 ci.yml。

### C.9 SA3 执行顺序

```
【前置，总控】SA1 R4 修订（实测证伪旧机制 + 重写为 const P/NoInfer/rest 标记，本文档）→ SA2 R4 复审（须 pass）
【总控派 SA6 修订轮】（C.7 六条：empty 三处 + 头注释 + projection 三件套断言 + 正例 5 分发 helper；R4 负例判据更新；SA6 owned，SA3 不触碰）
然后 SA3 落地：
建包文件（C.1 index.ts → C.2 package.json → C.3 tsconfig.json；C.1 照抄 R4 rest 标记签名，杜绝旧 never 交叉）
  → 根配置（C.4 vitest.config.ts → C.5 根 package.json scripts）
  → lockfile（C.6 pnpm-lock.yaml importers，2 空格缩进对齐 packages/vfsl:）
  →（SA3 落地后可跑 `pnpm typecheck` 做两包 tsc 复核（R4 环境有 tsc）；完整 vitest 动态验证延期至 SA7）
【后续】SA4 红队（含 C.6 `cat -A` 缩进复核 + 自名解析门禁 + R4 C.1 签名核对）→ SA7 动态验证
【收尾，总控】按 §F 延期验证清单补跑全部命令项（typecheck/test/断言形状），全过后方可标 complete（§F）
```

## §D 必填章节

### §D.1 文件清单（File Scope）

**ALLOW LIST**（本任务可改写的文件）：

| 文件 | 改动类型 | 理由 |
|---|---|---|
| `packages/vfsl-protocol/src/index.ts` | 新建 | 核心交付物，§C.1 完整最终代码 |
| `packages/vfsl-protocol/package.json` | 新建 | 新包元数据（C.2） |
| `packages/vfsl-protocol/tsconfig.json` | 新建 | 新包类型检查配置（C.3） |
| `packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts` | `[SA6 owned]` 不动 | 增广正例测试，已存在；本轮不触碰，SA3 如需动须报总控（C.7） |
| `packages/vfsl-protocol/test/vfsl-protocol-empty-fail-closed.test-d.ts` | `[SA6 owned]` 修改 | 按 §B.1 三处修订（C.7） |
| `packages/vfsl-protocol/test/vfsl-protocol-empty-module.test.ts` | `[SA6 owned]` 不动 | 空模块断言，已存在，不触碰 |
| `vitest.config.ts` | 修改 | 新增 typecheck 接线（C.4） |
| `package.json` | 修改（根 scripts） | test 加 `--typecheck`、typecheck 聚合两包（C.5） |
| `pnpm-lock.yaml` | 修改（importers） | 手工补 vfsl-protocol importer（C.6） |
| `wiki/raw/task_vfsl-protocol*.md` | 流程档案 | 本设计文档与派生档案 |

**DENY LIST**（本任务禁止改写）：

| 文件/目录 | 理由 |
|---|---|
| `packages/vfsl/**` | 引擎包不动（仅被协议包引用，无改动） |
| `docs/**` | ADR 冻结，kind 词汇表等已确定，不改 |
| `.github/workflows/ci.yml` | 本轮不动（见 C.8） |
| `packages/vfsl-protocol/src/**` 之外的一切 src | 除 C.1 新建的 index.ts 外不写任何其它源码 |

### §D.2 协议假设依据（Protocol Assumption Evidence）

> 假设以 TS 手册 / vitest 官方文档条款 + **R4 实测证据（`.mabf-bg/`）** 为依据。R4 之前（R1–R3）的承重假设标注「无命令执行环境，未实测，延期验证」；R4 已把 A.7.1 的 fail-closed 机制整体推到可执行环境实测闭环（A.7.1.1 证伪旧写 + A.7.1.2 验证新机制），row ⑫⑬⑭（及 A.7.1.2 全机制）为**已实测**项，其余保持延期验证。

| # | 假设 | 依据类型 | 依据内容 | 风险等级 |
|---|---|---|---|---|
| ① | `Record<\`${number}\`,T>`['5'] 模板键解析 | TS 手册 template literal types | 模板字面量模式类型对 `Seg extends \`${number}\`` 的 `'0'`/`'5'` 在 `V[Seg]` 处匹配元素类型 | 低 |
| ② | ~~union 索引访问 `U['url']`=T\|undefined~~ **（R2 废弃）** | ~~TS 手册 indexed access on unions~~ | **旧承重墙被 SA2 攻击 1 攻破：`Step` 的裸 `V` 分发使 `U['url']` 跑不到。R2 改走 row ⑩⑪，此依据不再被设计依赖** | ~~低~~ → 移除 |
| ③ | module augmentation 程序级全局 | TS 手册 module augmentation | 对 module 的接口扩展影响全场，无文件局部作用域（→ §B.1 隔离裁决，并由 C.7 钉死执行者） | 中（已被 B.1+C.7 化解） |
| ④ | `declare const`+unique symbol 零运行时 | TS 手册 ambient declarations | declaration-only，无实现不发射 JS | 低 |
| ⑤ | `never` 参数不可匹配 && rest 缺参报 TS2554 | TS 手册 never type / named tuple elements | assignable to everything, assignable from nothing（value 失败态 never 依赖，A.6）；rest 元组元素需提供（缺失报 TS2554）——R4 由 rest 标记缺参承接 fail-closed（A.7.1.2） | 低 |
| ⑥ | `{} & X` 键空间等价 X、keyof(A&B)=∪ | TS 手册 intersections / keyof of intersection | 空对象不贡献键；交叉根键空间=并集（B.2），R2 `MemberKeys` 同据此对单对象求 keyof | 低 |
| ⑦ | vitest typecheck 配置形状与 `*.test-d.ts` 约定 | vitest 官方文档 typecheck 章节 | `test.typecheck.enabled/.include/.tsconfig`，`--typecheck` 标志 | 低 |
| ⑧ | 自名引用经 package.json name+exports 解析 | TS 手册 self-referencing / Node package.json exports | 包内 `import('@nomicore/vfsl-protocol')` 经 exports 解析回 src/index.ts；**仓库无先例 → 降级为中，须 tsc 实测（SA4 专项门禁）**；C.4 补 relative-import 接线兜底说明 | 中（需实测） |
| ⑨ | ~~泛型调用实参推断 → 条件类型按已推断字面量实例化求值~~ **（R4 废弃）** | ~~TS 手册 Inference / Instantiation expressions~~ | **旧承重墙被实测证伪：形参位 `Path & (条件)` 时 `Path` 推断回落到约束型 `readonly string[]`，非字面量元组（A.7.1.1 根因 1）。R4 改走 row ⑫⑬⑭，此依据不再被设计依赖** | 移除（已被 A.7.1.1 证伪，改 R4 机制） |
| ⑩ | **（R2 新增）** 键空间并集 `MemberKeys<V>` 由裸 `V extends Record<infer Key,unknown>` 分发 | TS 手册 distributive conditional types | naked 类型参数的条件类型对 union 逐成员求值再并集 → keyof 并集（A.4.1） | 低 |
| ⑪ | **（R2 新增）** 成员独有键补位 `MemberLookup<V,Seg>` 裸 `V extends unknown` 分发、缺键分支补 `undefined` | TS 手册 distributive conditional types / conditional branches | 对每个成员 `Seg extends keyof V ? V[Seg] : undefined`，并集 → 独立补位产生 `T|undefined`（A.4.1） | 低 |
| ⑫ | **（R4 新增）** `const P` 类型参数使数组字面量推断为**只读元组且保留字符串字面量** | TS 5.0 release notes *const type parameters* | `<const P extends readonly string[]>`：对实参与字面量类型不拓宽。**实测**：`.mabf-bg/access-probe3.ts` 18 正例全部精确编译（`['name']`→`readonly ['name']`）。仓库 TS 5.9.3 满足 5.0 门槛。A.7.1.1 根因 2/3 实测：裸参虽然元组可推断但字面量被拓宽、`string & {}` 约束不可阻止——`const P` 是唯一可行解 | 低（已实测，见 §F） |
| ⑬ | **（R4 新增）** `NoInfer<P>` 使 P 只从 `path` 实参推断、rest/value/返回位不产生推断候选 | TS 5.4 release notes *NoInfer Utility Type* | `PathAt<Map,NoInfer<P>>` 中 P 被禁止从该位推断；P 只由裸 `path: P` 推断 → 消除「条件消费位反向拖累推断」的 R4 根因 1. 仓库 TS 5.9.3 满足 5.4 门槛。实测（A.7.1.2） | 低（已实测，见 §F） |
| ⑭ | **（R4 新增）** fail-closed 由「必需 rest 标记元组」承担：合法 `[]`/失败 `[error:…]`，缺必需参数报 TS2554 | TS 3.0+ rest/named tuple elements | rest 参数形如 `[error:'…']` 时调用需提供该元素，缺失报 `Expected N arguments, but got N-1`；`[]` 收零实参调用面不变。实测（A.7.1.2 负例） | 低（已实测，见 §F） |

### §D.3 契约改动连锁审计（Contract Change Caller Audit）

> 本任务无既有函数契约改动（全新零依赖包）；但**根 scripts 变更属调用面变化**，审计其消费方。

| 变更 | 消费方 | 现状 | 变更后 | 影响 |
|---|---|---|---|---|
| 根 `test` + `--typecheck` | `.github/workflows/ci.yml` 的 `pnpm test` 步骤 | `vitest run` 仅跑 `*.test.ts` | `vitest run --typecheck` 同时跑 type-d 编译校验（C.4 configured） | 新增 typecheck 阶段；既有 vfsl 14 个 `*.test.ts` 照跑，include 不变；新包无副作用 |
| 根 `typecheck` `&&` 聚合两包 | `.github/workflows/ci.yml` 的 `pnpm typecheck` 步骤 | `tsc -p packages/vfsl/tsconfig.json` | 追加 `-p packages/vfsl-protocol/tsconfig.json` | vfsl-protocol 包纳入类型检查，顺序在前包后无依赖冲突 |
| 根 scripts 变更 | 本地开发者命令习惯 | `pnpm test`/`pnpm run typecheck` | 语义扩展（typecheck 覆盖新包，test 含 typecheck） | 命令名不变、行为增强；无破坏性变化 |
| `vitest.config.ts` typecheck 块 | CI + 本地 | 无 typecheck 配置 | 见 C.4 | 类型检查汇聚到根脚本，与 CI 单 program 接线自洽 |

### §D.4 SA6 编码假设对账表

| # | SA6 假设 | 裁决 | 设计锚点 |
|---|---|---|---|
| 1 | `PathSchema<Value,Kind>`，Kind 五值词汇表、Value=节点运行时值类型 | 采纳 | A.2 `PathSchema<Value,Kind extends VfslKind>`（五值 `VfslKind`） |
| 2 | leaf/xml-fragment/plain、可空 `PathSchema<string\|null,'leaf'>` | 采纳 | A.5/A.6：leaf/plain/xml-fragment 直取 `V`；可空经 `string\|null` 通配 |
| 3 | array=`PathSchema<Record<\`${number}\`,子表>,'array'>`；YPlainArray 终态用 plain | 采纳 | A.4 `Step`：array 可下钻元模板键；plain 为终态拒下钻→UnknownPath（D1） |
| 4 | 联合节点 Kind='map'、Value=成员子表并集；独有字段 read→T\|undefined、patch→T | 采纳（机制改） | A.4.1 `MemberKeys`/`MemberLookup`（逐成员补位产 undefined）+ A.6 `PathPatchValue` 丢弃 undefined（R2 取代旧 union 索引） |
| 5 | `PathAt`：[]→根 Map；无法解析段→UnknownPath | 采纳 | A.4 `[]`→`RootSchema<Map>`；失败态 `UnknownPath<Remaining>`（A.3） |
| 6 | 六方法 + 三件套（显式 index 参数）；UnknownPath 时编译错误 | 采纳（签名 R4 修订） | A.7.2 六方法签名（`const P` + `NoInfer<P>` + `FailClosedRest`/`ArrayEditRest` rest 标记；append/insert value=`PathElementValue` 元素类型；PathPatchValue<UnknownPath>=never 双重 fail-closed）。R4 修订：旧 `Path & (条件)` 写法规实为证伪、改 rest 标记版 |
| 7 | 访问值构造 `declare const access: VfslTypedAccess<AugVfslPathMap & VfslPathMap>`；typecheck 永不求值 | 采纳 | A.7.3 接口泛化 + B.2 交叉类型根；D3 零运行时 |
| 8 | vitest 开 `typecheck.include`；tsconfig 可解析包导出（自名引用） | 采纳 | C.4 vitest typecheck 接线 + §D.2-⑦⑧ |
| 9 | 空表与增广测试分属独立编译单元 | **调整**为本地空接口隔离 | **证伪**（B.1）：module augmentation 程序级泄漏 → 局部 `interface LocalEmptyMap {}`（§B.1 三处修订） |

對账结论：九条中**采纳 8 条、调整 1 条**（#9 因 module augmentation 程序级泄漏由「独立编译单元」调整为「本地空接口隔离」，裁决见 §B.1）。R2 修订后 A.4/A.6 读投影机制改走 A.4.1 `MemberKeys`/`MemberLookup`（D.4 第 4 行「机制改」），SA6 断言语义不变、推导源更新。

---

## §E SA2 R1 反馈逐条回应（R2 修订）

> 每条对应 SA2 攻击评审 `task_vfsl-protocol_sa2_review.md` 的「修订清单」1-8 项。状态：`落实`＝已加入修订并同步全文档；`部分`＝附带说明。

| 攻击点 | 修订动作 | 落实位置（章节号） | 状态 |
|---|---|---|---|
| 1（CRITICAL）读投影 T\|undefined | `Step` 改 `MemberKeys`（键空间并集，裸分发）+ `MemberLookup`（逐成员取键、缺键补 undefined）；读经 `VfslValueOf` 分发透传、写经 `PathPatchValue` 的 `:never` 丢弃。不再依赖旧 §D.2-② union 索引。逐条重推 SA6 正例 1-6/负例 1-4/D1/D2/D5。 | A.4 / A.4.1（新增）/ A.5 / A.6 / A.7.3（重推）/ C.1 / §D.2-②⑩⑪ / D.4-4 | 落实 |
| 2（HIGH）fail-closed 推断时序 | 无实测环境→改写法：① Path 约束收敛 `readonly string[]`（防回落约束型歧义）；② 值参双重 fail-closed——`PathPatchValue<UnknownPath>` 显式 `never`（与攻击 6 一并）；③ 给出「裸类型参数承担推断、条件按其参数实例化求值」的严格论证 + 失败方向由双重 fail-closed 兜底，不依赖该求值时序；④ A.7.1/A.7.2/C.1 钉死最终写法。 | A.7.1（论证块）/ A.7.2 / A.6（双重 fail-closed）/ C.1 / §D.2-⑨ | 落实 |
| 3（HIGH）C.6 lockfile 缩进 | importer 键改 2 空格、`devDependencies` 4 空格、`typescript/vitest` 6 空格、子级 8 空格，逐字节对齐 `packages/vfsl:`（pnpm-lock L18-25）；新增 SA4 `cat -A` 复核指令。 | C.6（重写代码块与文字） | 落实 |
| 4（HIGH）append/insert value 类型 | value 改 `PathElementValue<Node>`（array 节点取元素子树经 PathValue→单元素判别联合）；推演 `append(['tree','entities'],{kind:'image',url:'u'})` 通过、传 `'x'` 报错；C.1 六方法签名同步；C.7 追加三件套正/负例测试修订指令（总控派 SA6 执行）。 | A.5（PathElementValue）/ A.7.2 / A.7.3 负例 9 / C.1 / C.7-3 | 落实 |
| 5（HIGH）B.1 执行者钉死 | 明确唯一执行者 SA6，由总控在 SA2 复审通过后派专轮执行；流程顺序写清（SA1-R2→SA2 复审→SA6 修订轮→SA3 实现）；empty 文件头注释更新指令列入；回读门禁「文件含 `LocalEmptyMap`、四 `@ts-expect-error` 保留」。 | C.7（开头）/ C.9 / B.1（引用 C.7） | 落实 |
| 6（建议）PathValue<UnknownPath> 相关 | `PathPatchValue<UnknownPath>` 显式 `never`（随攻击 2 落实）；`PathValue<UnknownPath>`= `UnknownPath`（读投影不塌陷）语义钉死 + SA6 断言锚定指令。 | A.5 / A.6（双重 fail-closed & 读锚定）/ A.7.1 / C.1 / C.7-4 | 落实 |
| 7（建议）自名引用 | 补依据（TS self-referencing + Node exports）+ 降级为中风险 + C.4 相对 import 兜底（增广目标仍以包名为准，因 declare module 增广必须对包名生效）+ SA4 专项门禁。 | C.4（兜底注）/ §D.2-⑧ | 落实 |
| 8（建议）Path 约束收敛 | 收敛为 `readonly string[]`；数组下标段一律字符串数字字面量（`'0'`）；推演不破坏任何 SA6 用例（所有路径段均为字符串字面量）；文档明示 number 段不支持。 | A.4.1 / A.6 ③ / A.7.1 / A.7.2 / C.1 | 落实 |

**R3（2026-08-25）对 SA2 R2 复审两个存活点的逐条回应**：

| 存活点 | 修订动作 | 落实位置 | 状态 |
|---|---|---|---|
| R3-1（CRITICAL）正例 5 窄化锚推不出 | 修正 A.6 断言 8 推演：明确「具体联合类型别名上的条件类型**不分发**」（TS 手册 *Distributive conditional types*：仅裸类型参数分发）；判别联合**整值**仍窄化友好（消费方控制流 `if (e.kind==='image')` 由 tsc 判别联合标准能力窄化，不受影响）；断言要「窄化可发生」须经**泛型分发 helper**（`type UrlOf<E> = E extends {kind:'image'} ? E['url'] : never; UrlOf<Entity>` → `string|never=string`）；C.7 追加 SA6 修订指令（C.7-5，精确替换写法并入 SA6 修订轮）。 | A.6 断言 8 / A.6③ / A.6「路径级窄化不做」/ C.7-5 / C.7 开头 / C.9 / §F / 本表 | 落实 |
| R3-2（MEDIUM 取证欠账）read/kindOf 单点 fail-closed | 双轨（**R4 已作废本条**）：轨一——A.7.1 补严格理论论证（TS 手册 *Inference*：推断只发生在裸类型变量位；参数类型 `Path & (Cond)` 中裸 `Path` 承载全部推断、条件类型内部非推断位、条件在类型实参实例化后求值（*Conditional types* deferred resolution）；type-fest/ts-reset 同型签名先例；如实标注单点 vs 双点残留质差，不降 fail-open，空表负例 2/3 的 `@ts-expect-error` 为后备捕获）；轨二——新增 §F 延期验证清单（须在可执行环境补跑 `pnpm typecheck`/`pnpm test` 并核对预期输出形状后标 complete，总控收尾轮执行、SA7 引用）。**R4：旧机制实测证伪，双轨处置随 A.7.1 废弃；单点新机制（rest 缺参）已探针实测闭环（§E R4-2）**。 | A.7.1（R3 轨一/轨二块 → R4 重写）/ §F / §E 本表 / C.9 收尾步 | 落实（R4 作废旧双轨） |

**R3 后 SA6 断言推导结论（修正）**：正例 1-6、负例 1-4、D1、D2、D5 在 A.4.1 机制下成立；**正例 5 的窄化断言须用分发 helper**（C.7-5）——分发 helper 实例化后 `UrlOf<Entity> = string`、`BodyOf<Entity> = string`，均 ≠ never，断言转绿；SA6 修订轮同轮完成。**R4 补充**：read/kindOf 单点 fail-closed 原「依赖 R3 轨一理论」已被 R4 实测证伪并重写为 rest 缺参机制，探针级实测闭环（A.7.1.2，§E R4-2）。

**R2 修订后 SA6 断言推导结论**：正例 1-6、负例 1-4、D1、D2、D5 在 A.4.1 机制下**全部可推导成立**——`PathValue`/`PathKind`/`PathPatchValue`/`PathElementValue` 对 `PathSchema|undefined` 的因式分发保证读投影含 `| undefined`、写投影丢弃之、fail-closed 双重钳制。其中正例 4（`string|undefined`）与 D2 写投影（声明处 `string`）是 R2 机制的直接验收点，已逐链推演（A.6）。**R3 修正**：正例 5 的窄化断言**须按 A.6 断言 8 修正改用分发 helper 后才成立**（原 `Entity extends {kind:'image'}` 因具体联合别名不分发而恒 never，已修正，见 C.7-5）。

**R4（2026-08-20，实测证伪触发）——A.7.1 fail-closed 机制整体重写**：

| 触发 | 修订动作 | 落实位置 | 状态 |
|---|---|---|---|
| **R4-1（CRITICAL）「条件 never 交叉参数」实测证伪** | 总控在可执行环境实跑 `pnpm typecheck` 首轮（`.mabf-bg/verify2.log`）：`vfsl-protocol-projection.test-d.ts` 全部 14 处合法路径调用点报 `TS2345: Argument of type 'string[]' is not assignable to parameter of type 'never'`——**所有合法路径被误杀**。隔离探针（`.mabf-bg/probe/*.ts`）定根因：① 参数型含条件时 Path 推断回落到约束型 `readonly string[]`（非字面量元组）；② 裸 Path 下元组推断成立但字符串字面量被拓宽（`string & {}` 约束不可阻止，实测五种形状全灭）；③ ⇒ R3 轨一「裸成员承担推断、条件在实参实例化后求值」的**理论论证被实测否定**。**R4 废弃旧机制（含 R3 轨一/轨二 read/kindOf 单点论证），采纳实测通过的替代签名** `const P` + `NoInfer<P>` + 必需 rest 标记（`FailClosedRest`/`ArrayEditRest`）。 | A.7.1（全节重写）/ A.7.2 / A.6 双重 fail-closed 接线修订 / C.1 / C.7-3 三件套 + empty 四断言判据更新 / §D.2-⑨废弃+⑫⑬⑭新增 / §F（R4 修订） / §E 本表 | 落实 |
| **R4-2（CRITICAL）read/kindOf 单点 fail-closed 由探针实测闭环** | 原 R3-2 轨二「须补跑 tsc」的 read/kindOf 单点漏洞，已随 R4 机制改为 rest 缺参标记并**在探针层实测**：`.mabf-bg/access-probe3.ts`（import 真实 `src/index.ts`）EXIT=0，10 负例含 `read(['nope'])`/`deleteFromArray(['name'],0)` 全部 fail-closed；`.mabf-bg/probe/c1_e2e.ts` 用本文档 C.1 最终代码块重测 9 正例 + 7 负例 EXIT=0。read/kindOf 单点由「依赖理论的行为」升级为**探针级已实测**（正式 `pnpm test` 全绿仍保留为唯一 complete 闸门，见 §F）。 | A.7.1.2 / A.7.1.3 / §F F.1-F.2 / 本表 | 落实（探针级实测，正式全绿仍待） |
| **R4-3（CRITICAL）C.1 index.ts 目标代码对齐实测签名** | C.1 六方法签名同步为 `const P` + `NoInfer<P>` + `FailClosedRest`/`ArrayEditRest` rest 标记；新增两个不导出内部助手；SA3 校验清单 ⑥ 钉死「照抄 A.7.2、杜绝旧 never 交叉」。**设计文档代码块经探针 `.mabf-bg/probe/c1_e2e.ts` 实测 EXIT=0**（正例精确编译 + 负例 `@ts-expect-error` 命中零 unused）。 | C.1（代码块 + 校验清单）/ C.1 集成段落 | 落实（代码块探针级实测） |

---

（§E 至此为 R2 修订完结点；§F 为 R3 新增的延期验证清单，见下。）

---

## §F 延期验证清单（Deferred Verification Checklist）— R3 新增，R4 修订

> **背景（R3，R4 修订）**：本设计初稿全程在没有命令执行/无 tsc 的环境编写，故 R3 设立本节把「依赖实测的结论」与「纯推演结论」分开。**R4 由总控在可执行环境补跑 `pnpm typecheck`，结果实测证伪了 A.7.1「条件 never 交叉参数」**（见 A.7.1.1 与 §E R4-1），并推动 fail-closed 机制整体重写为 `const P` + `NoInfer<P>` + rest 标记。**R4 已在探针层实测闭环的关键结论**（见 A.7.1.2、§E R4-2/R4-3）：
> - 新机制全量正/负例（`.mabf-bg/access-probe3.ts`，import 真实 `src/index.ts`）**EXIT=0 全绿**：18 正例精确编译 + 10 负例全部 fail-closed、零 `as const`；
> - C.1 最终代码块（`.mabf-bg/probe/c1_e2e.ts`）9 正例 + 7 负例 **EXIT=0**；
> - **read/kindOf 单点 fail-closed 已实测**（探针级）：`read(['nope'])` go ERR、`deleteFromArray(['name'],0)` go ERR（rest 缺参 TS2554 / value never）。
>
> **正式 complete 闸门不变**：探针级实测**不等于**完整 `pnpm test` 全绿。总控收尾轮仍须补跑下方 F.2 两项命令（两包 tsc + vitest typecheck 三测试文件），逐条核对 F.3 预期输出形状后，本设计才能标 `complete`。**F.3 的预期错误码已按 R4 新机制更新（rest 缺参 TS2554，非旧 TS2345 never）**。

### F.1 执行人 / 时机 / 引用

- **执行人**：总控在**收尾验证轮**（C.9 流程末）执行；SA7 动态验证报告**引用本清单结果**。
- **时机**：SA3 落地实现 → SA4 红队通过后，SA7 验证轮由总控统一跑 F.2 全部命令并核对 F.3 形状。
- **前置**：SA6 修订轮须已完成（C.7 六条，含正例 5 分发 helper、empty 换 `LocalEmptyMap`），否则 typecheck 断言源是旧态。
- **R4 状态说明**：本清单从 R3「全部待实测」更新为「**关键机制探针级已实测（A.7.1 read/kindOf 单点 fail-closed、C.1 代码块、新机制正/负例）**，正式全绿仍待收尾轮」。read/kindOf 单点漏项**已由探针实测闭环**（§E R4-2），不再列「理论待证」，仅保留「正式全绿」闸门。

### F.2 必须补跑的命令（逐条，任一失败即不得 complete）

| # | 命令 | 覆盖对象（本设计声称成立的） | 通过判据 |
|---|---|---|---|
| 1 | `pnpm typecheck`（根脚本 `tsc -p packages/vfsl/tsconfig.json && tsc -p packages/vfsl-protocol/tsconfig.json`） | 两包 tsc 全绿；**覆盖 read/kindOf 单点 fail-closed**（R4 `FailClosedRest` rest 缺参，A.7.1.2，**探针级已实测**）、`MemberKeys`/`MemberLookup` 全链（A.4.1）、`PathPatchValue`/`PathElementValue`（A.5/A.6）、`const P`/`NoInfer`（A.7.1.2）、自名 import 解析（§D.2-⑧）、空模块零运行时（D3） | tsc 退出码 0，无 TS2xxx error |
| 2 | `pnpm test`（根脚本 `vitest run --typecheck`） | SA6 三测试文件全绿 = 全部断言**实测**：projection 正例 1-6 与 D1/D2/D5、正例 5 分发 helper（C.7-5）、负例自我反转失败、empty fail-closed（`LocalEmptyMap` + 四 `@ts-expect-error`）、空模块键集 | vitest 全绿，无 unused-directive / 期望 error |

### F.3 预期输出形状（补跑时逐条核对，行号以最终实现为准）

| # | 场景 | 预期编译/运行结果 |
|---|---|---|
| 1 | fail-closed 负例：`patch(['notDeclaredKey'],'x')` / `read(['notDeclaredKey'])` / `kindOf(['notDeclaredKey'])` | **R4（新机制）**：path 落 `UnknownPath` → `FailClosedRest=[error:'…']` → **缺必需 rest 参数 → `TS2554: Expected N arguments, but got N-1`**（R4 取代旧 TS2345 never）；含 value 方法另由 value never 兜底（`patch` 兼 TS2345 value never）。**非静默放行** |
| 2 | fail-closed 负例（空表，`LocalEmptyMap`）：`patch(['name'],'ok')`/`patch(['assets'],{})`/`read(['name'])`/`kindOf(['name'])` | **R4**：同上 rest 缺参 TS2554（`read`/`kindOf` 单点）、`patch` 兼 value never；四 `@ts-expect-error` **真实命中**（无 unused-directive 报错） |
| 3 | 合法正例：`patch(['name'],'ok')` / `patch(['tree','entities','0','url'],'https://x')` / `read(['name'])` / `kindOf([])` | `tsc` **0 error**（正例 1-6 全编译通过，不误杀——R4 `const P` 保字面量，**探针级已实测** 18+9 正例全绿） |
| 4 | 正例 5 分发 helper：`UrlOf<Entity>` / `BodyOf<Entity>` | 期望 `string`；`not.toEqualTypeOf<never>()` **通过**（若此步 RED → C.7-5 未落地，退回 SA6 修订轮） |
| 5 | negative 三件套：`appendToArray(['tree','entities'], 'x')` / `insertIntoArray(['tree','entities'],0,{kind:'video'})` | **R4**：path 合法 → rest 不报缺参；**value 需元素判别联合，字符串/未知 kind 不可匹配（value never）→ 编译错误（`@ts-expect-error` 命中）**（delete 非 array → `ArrayEditRest=[error:'非 array 节点']` → TS2554） |
| 6 | positive 三件套：`appendToArray(['tree','entities'],{kind:'image',url:'u'})` / `insertIntoArray(['tree','entities'],0,{kind:'text',body:'<p>x</p>'})` | 编译通过（`const P` 保字面量，**探针级已实测**），value 推断为 `PathElementValue` = 判别联合元素 |
| 7 | 空模块 `empty-module.test.ts` | vitest 运行时断言 `Object.keys(ns)` 为空（D3 零运行时）通过 |
| 8 | `PathAt`/`MemberKeys`/`MemberLookup` 推导抽查（如 `PathAt<Map,['tree','entities','0','url']>` 含 `\|undefined`、`PathValue<'kind'>` = `'image'\|'text'`、`['tree','entities','5']` = Image\|Text） | `expectTypeOf<...>().toEqualTypeOf<...>()` 全通过 |

> **R4 注**：场景 1/3/5/6 的核心结果（rest 缺参 TS2554、value never、合法正例不误杀）已在探针层实测（`.mabf-bg/access-probe3.ts`、`.mabf-bg/probe/c1_e2e.ts`，均 EXIT=0）。本节仍保留场景 2（空表四断言）与场景 4（分发 helper）为「正式 file 级验证」项，须收尾轮在完整测试文件上跑通。

### F.4 结论闸门

> 总控在收尾轮跑完 F.2 两项命令且 F.3 八项形状全部符合后，才可把设计标 `complete` 并写入 `REPORT.md`/`.mabf-done`（硬门禁 3：本地完成事务须先经 SA7 完成并核对 §F）。任一命令失败或任一预期形状不符 → 不得 complete，按对应条目回到对应执行者（§F 场景 4 → SA6 修订轮；其余 → SA4 红队或 SA3 修复）。§F 结果由 SA7 报告引用。**R4 补充**：若收尾轮 `pnpm test` 中事件例因 `const P` 字面量保留/rest 标记任一环节不绿 → 命中 SA3 实现未照抄 C.1，退回 SA3；若探针已闭（A.7.1.2）而完整 file 仍红 → 多为接线/断言源问题，回 SA4 红队核查。

—— **R3 修订完结（后经 R4 实测证伪重写）**：§A/§B/§C/§D/§E/§F 齐备。**R4（2026-08-20）**：A.7.1「条件 never 交叉参数」由 `pnpm typecheck` 实测证伪（14 处合法路径 TS2345 死亡，A.7.1.1），机制重写为 `const P` + `NoInfer<P>` + 必需 rest 标记（A.7.1.2），`read`/`kindOf` 单点 fail-closed 探针级实测闭环，C.1 目标代码探针实测 EXIT=0，正式 `pnpm test` 全绿仍为唯一 complete 闸门（§F）。交下一轮（SA2 R4 复审 → SA6 修订轮 → SA3 落地，流程见 C.9）。
