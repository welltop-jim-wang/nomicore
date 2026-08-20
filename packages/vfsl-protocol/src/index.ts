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
