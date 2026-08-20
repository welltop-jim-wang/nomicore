/**
 * SA6 红灯测试 — `@nomicore/vfsl-protocol` 编译期路径投影协议 · 实验矩阵（issue #24）。
 *
 * 契约来源（任务简报 §8.4 实测矩阵 + ADR 0004 D1/D2/D3/D4/D5 + ADR 0003 kind 词汇表）：
 * - D1：数组节点带 `Record<\`${number}\`, 元素子树>` 子树（下标段可解析、值类型精确）；
 *   `YPlainArray` 为终态节点（下钻 → `UnknownPath`）。
 * - D2：联合键空间 = 各成员字段键集并集；成员独有字段 read → `T | undefined`、patch → `T`；
 *   判别字段为精确字面量联合；整实体 read 发射判别联合（可被 tsc 窄化）；路径级窄化不做。
 * - D3：协议包为纯类型（类型空间产物若缺 → 本文件 import 即编译错误 = 红灯锚点）。
 * - D4：vitest typecheck 模式；正例 `expectTypeOf`（类型相等）、负例 `@ts-expect-error`
 *   （自我反转断言：该行被错误放行时，本测试反而失败）。
 * - D5：`VfslPathMap` 顶层键 = ROOT 的字段（路径无 `ROOT` 前缀）；`kindOf([])` → `'map'`。
 *
 * ⚠️ 运行验证延期（如实标注）：
 *   本会话所在主机命令执行能力不可用（沙箱后端缺失，bash 一律被拒），本文件**未在本轮实际执行**。
 *   `package` 尚不存在 → 本文件任何对 `@nomicore/vfsl-protocol` 的 import 都会抛出
 *   TS2307/TS7016（module not found），使整个编译单元红灯。这是预期的红灯锚点；
 *   红灯运行验证延期到具备命令执行能力的会话补跑（`pnpm vitest --typecheck`）。
 *
 * ── 编码假设（按 TASK.md / ADR 0004 最字面读法书写；SA1 设计以此为锚对账）──
 * 1. 载体 `PathSchema<Value, Kind>`：Kind 取 kind 词汇表 `'map' | 'array' | 'xml-fragment' | 'leaf' | 'plain'`；
 *    Value 为该节点投影到运行时的值类型（map 节点的 Value 为该节点的 `Record<字段, 子表>`）。
 * 2. leaf：`PathSchema<string, 'leaf'>`；可空 leaf：`PathSchema<string | null, 'leaf'>`；
 *    xml-fragment：`PathSchema<string, 'xml-fragment'>`；plain：`PathSchema<V, 'plain'>`（纯值透传）。
 * 3. array 节点：`PathSchema<Record<\`${number}\`, 元素子表>, 'array'>` —— 下标段经 `Record<number,子表>`
 *    解析，值类型精确；`YPlainArray` 终态用 `plain` kind 表达（其 Value 是数组，但无 `Record<number,子表>`
 *    子树，故继续下钻 → `UnknownPath`）。
 * 4. 联合节点：Kind `'map'`，Value = 各成员字段子表的并集形式；判别字段为唯一字面量字段。
 *    从联合节点解析成员独有字段 → 类型合并规则产出 `T | undefined`（read 语义）；patch 值取声明处类型 `T`。
 * 5. `PathAt<Map, Path>`：`[]` → 根节点 `Map` 自身（D5）；否则逐个消费路径段。命中无法解析的段
 *    （未知字段 / 不在键空间 / 非法下标 / 下钻越过终态节点）→ `UnknownPath<Path>`。
 * 6. `VfslTypedAccess<Map>`：以 `Map` 为根的表对象；`patch<Path, Value>` / `read<Path>` / `kindOf<Path>`，
 *    以及 `appendToArray<Path, Value>` / `insertIntoArray<Path, Index, Value>` / `deleteFromArray<Path, Index>`
 *    （序列编辑下标为显式参数）。路径解析到 `UnknownPath` 时，`patch`/`read`/`kindOf` 应报编译错误
 *    （fail-closed 扩散到访问面，D3）。
 * 7. 访问值的取得方式：本文件用 `declare const access: VfslTypedAccess<AugVfslPathMap & VfslPathMap>` 构造
 *    一个纯类型访问器（typecheck 单元永不求值，故无需运行时实现）。若 D4 装置要求以
 *    `PrivilegedAccess<VfslPathMap>` 类型工厂 + `access` 别名调用的接缝呈现，见文件顶端接线假设。
 *    （接线最终由 SA1 钉死 / SA3 落地；若与本假设不同，只改接缝写法，不改下方断言。）
 * 8. vitest typecheck 接线假设（最终由 SA1 设计钉死、SA3 落地；若不同只需改配置，不动断言）：
 *    根 vitest.config.ts 开启 typecheck（include 覆盖各包 test 目录的 *.test-d.ts），
 *    且该 typecheck 编译单元的 tsconfig 可解析 `@nomicore/vfsl-protocol` 导出（JSR/路径别名/tsconfig paths）。
 *    命名按 vitest typecheck 约定：`*.test-d.ts`。
 *
 * 断言纪律：全部锚定公共接缝的**类型投影行为**（`PathAt`/`PathValue`/`PathKind`/访问面方法签名），
 * 不读源码、不 grep 文本形状。负例用 `@ts-expect-error` 自我反转断言。
 */
import { describe, it, expectTypeOf } from 'vitest';
import type {
  PathAt,
  PathElementValue,
  PathKind,
  PathSchema,
  PathValue,
  UnknownPath,
  VfslPathMap,
  VfslTypedAccess,
} from '@nomicore/vfsl-protocol';

// ── 手写迷你 VfslPathMap 增广：复刻设计文档 §8.4 实测矩阵（生成器是票 F 职责，本票用精简手写表）──
declare module '@nomicore/vfsl-protocol' {
  interface VfslPathMap {
    name: PathSchema<string, 'leaf'>;
    portraitResourceId: PathSchema<string | null, 'leaf'>;
    /** 联结树：元数据（map）+ 实体列表（array，元素为判别联合实体） */
    tree: PathSchema<
      {
        title: PathSchema<string, 'leaf'>;
        entities: PathSchema<
          Record<
            `${number}`,
            PathSchema<
              | { kind: PathSchema<'image', 'leaf'>; url: PathSchema<string, 'leaf'> }
              | { kind: PathSchema<'text', 'leaf'>; body: PathSchema<string, 'xml-fragment'> },
              'map'
            >
          >,
          'array'
        >;
        /** YPlainArray 终态：plain kind，Value 为纯值数组，无 Record<number, 子表> 子树 */
        attachments: PathSchema<string[], 'plain'>;
      },
      'map'
    >;
  }
}

/**
 * 纯类型访问器：typecheck 编译单元永不求值，故可用 `declare const` 获得值而无任何运行时实现。
 * 增广后 `VfslPathMap` 与非空增广合并，锚定「增广经 declare module 生效」验收点。
 *
 * ⚠️ 增广泄漏说明：module augmentation 是 vitest typecheck 编译单元的**程序级全局**——本文件的
 * `declare module` 增广会在同一 typecheck program 内泄漏进其他文件。因此 `vfsl-protocol-empty-fail-closed.test-d.ts`
 * 不得依赖「未增广的 VfslPathMap 就是空接口」，而是用本地空接口 `LocalEmptyMap` 锚定空表 fail-closed 语义
 * （见该文件）。本文件侧无需防泄漏——它刻意依赖增广生效投影出非空表语义。
 */
declare const access: VfslTypedAccess<AugVfslPathMap & VfslPathMap>;

/** 增广类型：把 VfslPathMap & VfslPathMap 的字段按 §8.4 矩阵引用到 PathAt/PathValue 断言。 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type AugVfslPathMap = {} & import('@nomicore/vfsl-protocol').VfslPathMap;

describe('§8.4 正例矩阵 — 字段写/读精确类型', () => {
  it('正例 1: patch(["name"], string) 编译通过', () => {
    // 类型级锚点：path 解析目标 = leaf 的 string
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['name']>>>().toEqualTypeOf<string>();
    access.patch(['name'], 'ok');
  });

  it('正例 2: patch(["portraitResourceId"], string | null) 编译通过', () => {
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['portraitResourceId']>>>().toEqualTypeOf<
      string | null
    >();
    access.patch(['portraitResourceId'], 'id');
    access.patch(['portraitResourceId'], null);
  });

  it('正例 3: 整实体写入接受实体类型（判别联合形态）', () => {
    // tree.entities 数组元素 = 判别联合实体；patch 整个元素接受实体类型。
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['tree', 'entities', '0']>>>().toEqualTypeOf<
      | { kind: 'image'; url: string }
      | { kind: 'text'; body: string }
    >();
    expectTypeOf<PathKind<PathAt<AugVfslPathMap, ['tree', 'entities', '0']>>>().toEqualTypeOf<
      'map'
    >();
    access.patch(['tree', 'entities', '0'], { kind: 'image', url: 'u' });
    access.patch(['tree', 'entities', '0'], { kind: 'text', body: '<p>x</p>' });
  });

  it('正例 4: read 返回精确类型（name / portraitResourceId / 成员独有字段 / 判别字段 / 整实体）', () => {
    // name → string（leaf）
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['name']>>>().toEqualTypeOf<string>();
    // portraitResourceId → string | null（可空 leaf）
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['portraitResourceId']>>>().toEqualTypeOf<
      string | null
    >();
    // 成员独有字段 url（仅 image 成员有）→ string | undefined（D2：当前成员可能没带这个键）
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['tree', 'entities', '0', 'url']>>>().toEqualTypeOf<
      string | undefined
    >();
    // 判别字段 kind → 精确字面量联合（D2）
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['tree', 'entities', '0', 'kind']>>>().toEqualTypeOf<
      'image' | 'text'
    >();
    // 整实体 read → 判别联合（D2：整值读出发射判别联合）
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['tree', 'entities', '0']>>>().toEqualTypeOf<
      | { kind: 'image'; url: string }
      | { kind: 'text'; body: string }
    >();
  });

  it('正例 5: 整值读出判别联合 —— 以 kind 字段窄化后访问成员独有字段（D2 整值窄化）', () => {
    // 读整实体，看值能否以判别字段 tsc 窄化（只读类型级即可验证投影质量）。
    type Entity = PathValue<PathAt<AugVfslPathMap, ['tree', 'entities', '0']>>;
    // 分发 helper：E 是裸类型参数 → 条件类型逐成员分发；模式 infer 取代索引取值（索引取值会使未约束 E 触发 TS2536）
    type UrlOf<E> = E extends { kind: 'image'; url: infer U } ? U : never;
    type BodyOf<E> = E extends { kind: 'text'; body: infer B } ? B : never;
    // 整实体 read 发射判别联合，经分发 helper 逐成员取得成员独有字段（窄化成立 → 非 never）
    expectTypeOf<UrlOf<Entity>>().not.toEqualTypeOf<never>();
    expectTypeOf<BodyOf<Entity>>().not.toEqualTypeOf<never>();
    // 路径级窄化不做（D2）：以下成员独有字段含 undefined（诚实反映联合）
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['tree', 'entities', '0', 'url']>>>().toEqualTypeOf<
      string | undefined
    >();
  });

  it('§8.4 正例 6: kindOf 投影出 kind', () => {
    // name → leaf；portraitResourceId → leaf
    expectTypeOf<PathKind<PathAt<AugVfslPathMap, ['name']>>>().toEqualTypeOf<'leaf'>();
    expectTypeOf<PathKind<PathAt<AugVfslPathMap, ['portraitResourceId']>>>().toEqualTypeOf<'leaf'>();
    // 整实体 → map
    expectTypeOf<PathKind<PathAt<AugVfslPathMap, ['tree', 'entities', '0']>>>().toEqualTypeOf<'map'>();
    // D5: kindOf([]) → 'map'（空路径 = 根节点自身）
    expectTypeOf<PathKind<PathAt<AugVfslPathMap, []>>>().toEqualTypeOf<'map'>();
    // 数组元素最终下钻到 xml-fragment body
    expectTypeOf<PathKind<PathAt<AugVfslPathMap, ['tree', 'entities', '0', 'body']>>>().toEqualTypeOf<
      'xml-fragment'
    >();
    // D1: 数组中间/元素节点 → 'array' / 'map'
    expectTypeOf<PathKind<PathAt<AugVfslPathMap, ['tree', 'entities']>>>().toEqualTypeOf<'array'>();
  });
});

describe('D1 — 数组下标段可解析且值类型精确；YPlainArray 终态', () => {
  it('D1 正例: 数组下标段可解析', () => {
    // tree.entities 元素 = 判别联合实体（map）
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['tree', 'entities', '5']>>>().toEqualTypeOf<
      | { kind: 'image'; url: string }
      | { kind: 'text'; body: string }
    >();
    // 用数字字面量下标段（等价于 `${number}` 段）
    type P = PathAt<AugVfslPathMap, ['tree', 'entities', '0', 'kind']>;
    expectTypeOf<PathValue<P>>().toEqualTypeOf<'image' | 'text'>();
  });

  it('D1 负例: YPlainArray 下钻 → UnknownPath（精确终态断言）', () => {
    // attachments 是 plain 终态；下钻到下标段 → 精确失败态 UnknownPath<['0']>。
    // 此为正例式精确等价断言（比原「≠ string」负例更强）：
    // PathAt<...,['tree','attachments','0']> = UnknownPath<['0']>（Step 对 plain 终态拒下钻 → never →
    //   PathAtImpl 识 never → 保留剩余段 ['0']）；PathValue<UnknownPath<['0']>> = UnknownPath<['0']>
    //   （UnknownPath 的 __kind:'unknown' 破坏 PathSchema 的 Kind 约束 → VfslValueOf :T 透传）。
    // 若实现使 plain 节点下钻解析成任何非 UnknownPath 类型 → 本断言 mismatch → 测试失败。
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['tree', 'attachments', '0']>>>().toEqualTypeOf<
      UnknownPath<['0']>
    >();
  });
});

describe('D2 — 联合成员独有字段 read/patch、判别字段', () => {
  it('D2 正例: 成员独有字段 patch 值 → 声明处类型 T（非 T|undefined）', () => {
    // url 在 image 成员声明为 string → patch 接受 string
    access.patch(['tree', 'entities', '0', 'url'], 'https://x');
    // body 在 text 成员声明为 string → patch 接受 string
    access.patch(['tree', 'entities', '0', 'body'], '<p>hi</p>');
    // 判别字段 patch → 精确字面量联合
    expectTypeOf<PathValue<PathAt<AugVfslPathMap, ['tree', 'entities', '0', 'kind']>>>().toEqualTypeOf<
      'image' | 'text'
    >();
  });
});

describe('§8.4 负例矩阵 — @ts-expect-error（自我反转断言）', () => {
  it('负例 1: patch(name, 42) 值类型错误', () => {
    access.patch(['name'], 'ok');
    // @ts-expect-error name 是 string leaf，patch 值 42 类型错误
    access.patch(['name'], 42);
  });

  it('负例 2: 未知路径（未声明字段 / 不存在的下标段）', () => {
    // @ts-expect-error 未声明字段 notDeclaredKey 不在键空间 → UnknownPath → 编译错误
    access.patch(['notDeclaredKey'], 'x');
    // @ts-expect-error 数组下标段超出 Record<named,string> 语义：tree 无 name 子键
    access.patch(['tree', 'title', 'name'], 'x');
    // @ts-expect-error 不存在于元素联合键空间的字段
    access.patch(['tree', 'entities', '0', 'nonexistentField'], 'x');
  });

  it('负例 3: 整实体写入缺必填字段', () => {
    // @ts-expect-error 整实体写入缺必填字段（image 需要 kind+url）
    access.patch(['tree', 'entities', '0'], { kind: 'image' });
  });

  it('负例 4: 数组下标值类型错误', () => {
    // 数组下标段元素 = 判别联合实体（map）；传纯 string 与该元素类型不符 → 编译错误
    // @ts-expect-error 数组下标元素应为判别联合实体，传 string 值类型错误
    access.patch(['tree', 'entities', '0'], 'not-an-entity');
    // 且数组下标段上不允许下钻到非 Record<number, 子表> 的缺失键
    // @ts-expect-error 下标段之后不存在键（entities 元素无 title 键）
    access.patch(['tree', 'entities', '0', 'title'], 'x');
  });
});

describe('序列编辑三件套 + PathElementValue — 数组节点 appendToArray/insertIntoArray（C.7）', () => {
  it('正例: appendToArray/insertIntoArray 值接受元素判别联合', () => {
    // appendToArray 追加到数组末尾，值 = 数组元素判别联合 → image/text 均合法
    access.appendToArray(['tree', 'entities'], { kind: 'image', url: 'u' });
    access.appendToArray(['tree', 'entities'], { kind: 'text', body: '<p>x</p>' });
    // insertIntoArray 在指定下标插入，值同为元素判别联合
    access.insertIntoArray(['tree', 'entities'], 0, { kind: 'text', body: '<p>x</p>' });
    access.insertIntoArray(['tree', 'entities'], 0, { kind: 'image', url: 'u' });
  });

  it('负例: appendToArray/insertIntoArray 值类型不符（纯 string 非元素判别联合）', () => {
    // appendToArray 值必须匹配元素判别联合；纯 string 不匹配 → 编译错误
    // @ts-expect-error appendToArray 值应为实体判别联合，传 string 类型错误
    access.appendToArray(['tree', 'entities'], 'x');
    // insertIntoArray 同理：值须为元素判别联合
    // @ts-expect-error insertIntoArray 值应为实体判别联合，传 plain 对象缺判别字段类型错误
    access.insertIntoArray(['tree', 'entities'], 0, { kind: 'image' });
  });

  it('PathElementValue：数组节点的元素值类型 = 元素判别联合', () => {
    // 数组节点（非下标）经 PathElementValue 投影出元素值类型 = 实体判别联合
    expectTypeOf<PathElementValue<PathAt<AugVfslPathMap, ['tree', 'entities']>>>().toEqualTypeOf<
      | { kind: 'image'; url: string }
      | { kind: 'text'; body: string }
    >();
  });
});

/**
 * 运行验证（延期）：
 * 本会话命令执行不可用，未真实执行。预期红灯表现：本文件 import `@nomicore/vfsl-protocol`
 * 抛 TS2307（模块不存在）→ 全编译单元红灯。实现后（SA1 设计 + SA3 落地）该文件应在
 * `vitest --typecheck` 下转绿：正例 `expectTypeOf` 相等 + 负例 `@ts-expect-error` 均为真实错误。
 * 未尽事项以 wiki/raw/task_vfsl-protocol.md 的 SA6 红灯测试记录为准。
 */
