/**
 * SA6 红灯测试 — domains/vfs3-assets 领域包 dogfood（issue #27）· AC1/AC2：
 * 设计文档 §8.4 正负例矩阵在**真实 fixture 生成类型表**上的编译断言。
 *
 * 契约来源：
 * - 任务简报 wiki/raw/task_vfsl-domains-assets-dogfood.md AC1/AC2；
 * - ADR 0004 D1–D5（投影机制）+ D4（vitest typecheck：正例 expectTypeOf 类型相等、
 *   负例 @ts-expect-error 自我反转）；
 * - ADR 0005 §5（领域包组成：schema.vfsl + generated.ts + index.ts 增广挂载 + test/ +
 *   package.json 纯类型）；
 * - docs/vfsl/v1-spec.md §10 修订版 fixture（ROOT map 形：
 *   assets / attachments / audit / notes? / keywords）；
 * - 复刻样板：packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts（§8.4 矩阵既有复刻）。
 *
 * ── 编码假设（SA1 钉死前的工作假设；若不同只改本文件顶端接线，不改断言语义）──
 * 1. 包名 `@nomicore/vfs3-assets`（目录 domains/vfs3-assets/，任务简报名）；index.ts 为
 *    增广挂载点：re-export generated.ts 的别名类型（AssetId/Audit/AssetEntity/Attachments），
 *    且经 import 链把 generated.ts 的 `declare module '@nomicore/vfsl-protocol'` 增广带入
 *    编译程序（ADR 0005 §5「挂载点」）。
 *    ⚠️ id/目录名张力（提请 SA1 钉死，本测试不依赖其选择——包名是唯一接缝）：
 *    ADR 0005 §2 样例 id `vfs3.assets@1` 的 idBase 为 `vfs3.assets`，而 F2 collect.ts
 *    不变式要求 idBase == 目录名（ vfs3-assets ）——schema.vfsl 头部三键与目录名须对齐
 *    （如 `@id: vfs3-assets@1`），否则 `pnpm generate` 响亮 exit 2。
 * 2. 生成类型表预期形态（映射表 = ADR 0004 后果 + F2 既有发射规则）：
 *    - assets: PathSchema<Record<string, PathSchema<AssetEntity, 'map'>>, 'map'>
 *      （Record<AssetId, …>：Pattern 键 → string；ref → 别名引用不内联）；
 *    - attachments: PathSchema<string[], 'plain'>（YPlainArray = 纯值终态，下钻 → UnknownPath）；
 *    - audit: PathSchema<Audit, 'map'>（ref → 别名引用）；
 *    - notes?: PathSchema<string, 'leaf'>（可选字段：read 含 | undefined，patch 取声明处 T）；
 *    - keywords: PathSchema<Record<`${number}`, PathSchema<string, 'leaf'>>, 'array'>
 *      （裸 T[] 按规格 §3 默认物化规则 = Y.Array 载体——与 YPlainArray 的 plain 终态不同！）。
 * 3. 增广泄漏与 protocol 测试同构：module augmentation 程序级全局生效；本文件刻意依赖
 *    `@nomicore/vfs3-assets` 增广后的 VfslPathMap（顶层键 = ROOT 字段，路径无 ROOT 前缀，D5）。
 *    本文件自身**不做** declare module 增广（防与 protocol 测试的手写表互相污染键空间；
 *    好在本表顶层键 assets/attachments/audit/notes/keywords 与 protocol 测试表
 *    name/portraitResourceId/tree 不相交）。
 * 4. 红灯机制（双重，均为真红）：(a) 包尚不存在 → `import … from '@nomicore/vfs3-assets'`
 *    TS2307 → 全文件红；(b) 即使包存在但增广未挂载，按 D3 空表 fail-closed，全部正例路径
 *    解析为 UnknownPath → 编译错误——故本文件转绿 = 包结构 + 增广挂载 + 生成类型表三达成。
 *
 * 断言纪律：全部锚定公共接缝的**类型投影行为**（PathAt/PathValue/PathKind/PathElementValue/
 * VfslTypedAccess 方法签名），不读源码、不 grep 文本形状。负例 @ts-expect-error 自我反转：
 * 该行被错误放行时测试反而失败。
 */
import { describe, it, expectTypeOf } from 'vitest';
import type {
  PathAt,
  PathElementValue,
  PathKind,
  PathValue,
  UnknownPath,
  VfslPathMap,
  VfslTypedAccess,
} from '@nomicore/vfsl-protocol';
// AC1 锚点：领域包可解析 + 别名导出面存在 + 增广经本 import 链挂载（包不存在 → TS2307 红）。
import type { AssetEntity, Audit } from '@nomicore/vfs3-assets';

/**
 * 纯类型访问器：typecheck 编译单元永不求值，`declare const` 直接获得值（protocol 测试同款装置）。
 * 与 protocol 测试的差异：本文件**不**手写本地表——VfslPathMap 由领域包增广（被测对象本身）。
 */
declare const access: VfslTypedAccess<VfslPathMap>;

/** 实体判别联合的**值投影**期望形（手写独立 oracle——不引用生成物别名，防同源自证）。 */
type ExpectedEntityValue =
  | { kind: 'image'; url: string; width: number; height: number; audit: { createdBy: string; createdAt: number } }
  | { kind: 'text'; body: string; audit: { createdBy: string; createdAt: number } }
  | {
      kind: 'file';
      name: string;
      size: number;
      tags: Record<`${number}`, string>;
      audit: { createdBy: string; createdAt: number };
    };

describe('AC1 — 包导出面与增广挂载锚点', () => {
  it('领域包别名类型可引用（AssetEntity / Audit 存在于导出面）', () => {
    // 包不存在或别名未导出 → 本文件 import 编译错误（红灯）；存在则类型可用。
    expectTypeOf<AssetEntity>().not.toBeNever();
    expectTypeOf<Audit>().not.toBeNever();
  });

  it('D5：kindOf([]) → map（空路径 = 根节点自身；顶层键 = ROOT 字段、无 ROOT 前缀）', () => {
    expectTypeOf<PathKind<PathAt<VfslPathMap, []>>>().toEqualTypeOf<'map'>();
  });
});

describe('AC2 §8.4 正例 — ROOT 标量字段（audit map / notes 可选 leaf）', () => {
  it('audit 子树：createdBy/createdAt 精确标量；整 audit 值 = 封闭对象', () => {
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['audit', 'createdBy']>>>().toEqualTypeOf<string>();
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['audit', 'createdAt']>>>().toEqualTypeOf<number>();
    expectTypeOf<PathKind<PathAt<VfslPathMap, ['audit']>>>().toEqualTypeOf<'map'>();
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['audit']>>>().toEqualTypeOf<{
      createdBy: string;
      createdAt: number;
    }>();
    access.patch(['audit'], { createdBy: 'u', createdAt: 0 });
    access.patch(['audit', 'createdBy'], 'u2');
  });

  it('notes?（可选 leaf）：read → string | undefined；patch 取声明处 string', () => {
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['notes']>>>().toEqualTypeOf<string | undefined>();
    expectTypeOf(access.read(['notes'])).toEqualTypeOf<string | undefined>();
    expectTypeOf<PathKind<PathAt<VfslPathMap, ['notes']>>>().toEqualTypeOf<'leaf'>();
    access.patch(['notes'], 'v1 备注');
  });
});

describe('AC2 §8.4 正例 — Record 键空间（assets）与判别联合实体', () => {
  it('assets：Record<string, 实体子表>；任意字符串键段可解析（Pattern 键 → string）', () => {
    expectTypeOf<PathKind<PathAt<VfslPathMap, ['assets']>>>().toEqualTypeOf<'map'>();
    // 任意字符串 id 段命中 Record 通配层（D1 通配语义在 string 键上的对应形态）
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['assets', 'asset-01']>>>().toEqualTypeOf<ExpectedEntityValue>();
  });

  it('判别字段 kind → 精确字面量联合（三成员）；kindOf → leaf', () => {
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['assets', 'a1', 'kind']>>>().toEqualTypeOf<
      'image' | 'text' | 'file'
    >();
    expectTypeOf<PathKind<PathAt<VfslPathMap, ['assets', 'a1', 'kind']>>>().toEqualTypeOf<'leaf'>();
  });

  it('成员独有字段 read → T | undefined（D2 诚实宽度），含 xml-fragment 的 body', () => {
    // url 仅 image 成员有
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['assets', 'a1', 'url']>>>().toEqualTypeOf<
      string | undefined
    >();
    // width/height 仅 image；size/name/tags 仅 file
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['assets', 'a1', 'width']>>>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['assets', 'a1', 'name']>>>().toEqualTypeOf<
      string | undefined
    >();
    // body（YXmlFragment → string，xml-fragment kind）仅 text 成员有
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['assets', 'a1', 'body']>>>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<PathKind<PathAt<VfslPathMap, ['assets', 'a1', 'body']>>>().toEqualTypeOf<
      'xml-fragment'
    >();
  });

  it('全成员共有字段 audit 穿透联合：read 无 undefined', () => {
    expectTypeOf<
      PathValue<PathAt<VfslPathMap, ['assets', 'a1', 'audit', 'createdAt']>>
    >().toEqualTypeOf<number>();
  });

  it('成员独有字段 patch 值取声明处类型 T（非 T | undefined，D2 写投影）', () => {
    access.patch(['assets', 'a1', 'url'], 'https://x');
    access.patch(['assets', 'a1', 'body'], '<p>hi</p>');
    access.patch(['assets', 'a1', 'name'], 'f.ts');
    access.patch(['assets', 'a1', 'kind'], 'file');
  });

  it('整实体写入接受三成员判别联合的任一完整成员', () => {
    access.patch(['assets', 'a1'], {
      kind: 'image',
      url: 'u',
      width: 1,
      height: 2,
      audit: { createdBy: 'u', createdAt: 0 },
    });
    access.patch(['assets', 'a1'], {
      kind: 'text',
      body: '<p>x</p>',
      audit: { createdBy: 'u', createdAt: 0 },
    });
    access.patch(['assets', 'a1'], {
      kind: 'file',
      name: 'f.ts',
      size: 3,
      tags: { 0: 't' },
      audit: { createdBy: 'u', createdAt: 0 },
    });
  });

  it('整值读出判别联合 —— tsc 可按 kind 窄化取成员独有字段（D2 整值窄化）', () => {
    type Entity = PathValue<PathAt<VfslPathMap, ['assets', 'a1']>>;
    // 分发 helper（裸类型参数条件分发；protocol 测试同款装置）
    type UrlOf<E> = E extends { kind: 'image'; url: infer U } ? U : never;
    type BodyOf<E> = E extends { kind: 'text'; body: infer B } ? B : never;
    type NameOf<E> = E extends { kind: 'file'; name: infer N } ? N : never;
    expectTypeOf<UrlOf<Entity>>().toEqualTypeOf<string>();
    expectTypeOf<BodyOf<Entity>>().toEqualTypeOf<string>();
    expectTypeOf<NameOf<Entity>>().toEqualTypeOf<string>();
  });
});

describe('AC2 §8.4 正例 — 数组（裸 T[] / YArray → array 载体）与 plain 终态', () => {
  it('keywords（裸 YLeaf<string>[] 默认物化 Y.Array）：array 载体、下标段可解析、值精确', () => {
    expectTypeOf<PathKind<PathAt<VfslPathMap, ['keywords']>>>().toEqualTypeOf<'array'>();
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['keywords', '2']>>>().toEqualTypeOf<string>();
    access.patch(['keywords', '2'], 'k');
    // 序列编辑三件套（D1：下标为显式参数）
    access.appendToArray(['keywords'], 'k');
    access.insertIntoArray(['keywords'], 0, 'k');
    access.deleteFromArray(['keywords'], 0);
    expectTypeOf<PathElementValue<PathAt<VfslPathMap, ['keywords']>>>().toEqualTypeOf<string>();
  });

  it('file 成员 tags（YArray<YLeaf<string>>）：array 载体、序列编辑可达（穿透联合成员独有字段）', () => {
    expectTypeOf<PathKind<PathAt<VfslPathMap, ['assets', 'f1', 'tags']>>>().toEqualTypeOf<'array'>();
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['assets', 'f1', 'tags', '0']>>>().toEqualTypeOf<string>();
    access.appendToArray(['assets', 'f1', 'tags'], 't');
  });

  it('attachments（YPlainArray）：plain 纯值终态——整体 string[]，下钻 → UnknownPath（D1 精确终态断言）', () => {
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['attachments']>>>().toEqualTypeOf<string[]>();
    expectTypeOf<PathKind<PathAt<VfslPathMap, ['attachments']>>>().toEqualTypeOf<'plain'>();
    // 精确失败态：plain 终态拒下钻 → 保留剩余段 ['0']
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['attachments', '0']>>>().toEqualTypeOf<
      UnknownPath<['0']>
    >();
    access.patch(['attachments'], ['a', 'b']);
  });

  it('body（YXmlFragment）：不透明终态——继续下钻 → UnknownPath（ADR 0003 §5）', () => {
    expectTypeOf<
      PathValue<PathAt<VfslPathMap, ['assets', 'a1', 'body', 'paragraphs']>>
    >().toEqualTypeOf<UnknownPath<['paragraphs']>>();
  });
});

describe('AC2 §8.4 负例 — @ts-expect-error 自我反转（每行一个）', () => {
  it('值类型错误（标量 leaf / 可选 leaf / 判别字段字面量外）', () => {
    // @ts-expect-error notes 是 string leaf，patch 值 42 类型错误
    access.patch(['notes'], 42);
    // @ts-expect-error createdAt 是 number leaf，patch 值 string 类型错误
    access.patch(['audit', 'createdAt'], 'not-a-number');
    // @ts-expect-error 判别字段仅 'image'|'text'|'file'，'video' 不在字面量联合内
    access.patch(['assets', 'a1', 'kind'], 'video');
    // @ts-expect-error url 声明处类型 string，patch 值 42 类型错误
    access.patch(['assets', 'a1', 'url'], 42);
    // @ts-expect-error width 声明处类型 number，patch 值 string 类型错误
    access.patch(['assets', 'a1', 'width'], 'wide');
  });

  it('未知路径 → UnknownPath → 访问面 fail-closed（缺必需 rest 实参 TS2554）', () => {
    // @ts-expect-error 未声明顶层字段不在 ROOT 键空间
    access.patch(['notDeclaredKey'], 'x');
    // @ts-expect-error 联合成员键空间并集之外的字段不可解析
    access.patch(['assets', 'a1', 'nosuchField'], 'x');
    // @ts-expect-error 越过 audit map 的封闭字段集（createdBy 下无子键）
    access.patch(['assets', 'a1', 'audit', 'createdBy', 'x'], 'y');
    // @ts-expect-error attachments 是 plain 终态，下标段不可解析
    access.read(['attachments', '0']);
    // @ts-expect-error body 是 xml-fragment 终态，paragraphs 不可下钻
    access.patch(['assets', 'a1', 'body', 'paragraphs'], 'x');
  });

  it('整实体写入缺必填字段 / 形状不符', () => {
    // @ts-expect-error image 成员缺 url/width/height/audit
    access.patch(['assets', 'a1'], { kind: 'image' });
    // @ts-expect-error text 成员缺 audit
    access.patch(['assets', 'a1'], { kind: 'text', body: '<p/>' });
    // @ts-expect-error 整 audit 缺 createdAt
    access.patch(['audit'], { createdBy: 'u' });
    // @ts-expect-error keywords 数组载体整体写入值须为 Record<`${number}`, string>，number 不符
    access.patch(['keywords'], 42);
  });

  it('序列编辑门禁：非 array 节点 / 元素类型错误', () => {
    // @ts-expect-error attachments 是 plain 终态（YPlainArray 只能整体替换，ADR 0004 D1），非 array
    access.appendToArray(['attachments'], 'x');
    // @ts-expect-error audit 是 map 节点，非 array
    access.appendToArray(['audit'], 'x');
    // @ts-expect-error keywords 元素 = string，append 值 42 类型错误
    access.appendToArray(['keywords'], 42);
    // @ts-expect-error tags 元素 = string，insert 值缺元素类型（number 不符）
    access.insertIntoArray(['assets', 'f1', 'tags'], 0, 42);
  });
});
