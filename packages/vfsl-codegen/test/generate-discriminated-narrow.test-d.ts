/**
 * SA6 红灯测试 — `@nomicore/vfsl-codegen` 判别式联合的**编译级窄化**契约（issue #26 AC3 + D2）。
 *
 * 角色分工：本 `.test-d.ts` 是「发射目标参照系」——手写嵌入生成器应对 `Entity` 判别联合
 * 产出的 `VfslPathMap` 增广（载体形态复刻 `vfsl-protocol-projection.test-d.ts` 顶部迷你增广，
 * SA5 锚点 6）。生成本身是纯发射文本，无法在编译期 import 生成函数的运行输出；故本文件
 * 以「参照样板」静态锚定 AC3 的编译级要求：
 * - **可窄化**：判别字段 `kind` 为精确字面量联合 `'image'|'text'`；整实体 `read` 返回判别联合；
 *   分发/窄化后各成员独有字段可精确取得（非 never）；
 * - **D2 宽度**（AC1）：成员独有字段（`url` 仅 image、`richBody`/`title` 仅 text）**read →
 *   `T | undefined`**（诚实反映 "当前成员可能没带这个键"）；patch → 声明处类型 `T`；
 * - **联合节点 kind = 'map'**：Entity 实体在 `entityList` 数组元素位是 `map` 载体。
 *
 * 本文件不依赖生成器函数（无法 type-level 调用）；它与运行时 `generate-discriminated-emission.test.ts`
 * 配合：运行时断言生成器确实**发射出本文件所嵌入的形状**，本文件断言该形状**确可窄化**。
 * 两者共同锁定 AC3。SA3 落地后，若生成的增广与该参照不一致，运行时实测会转红；本文件保证
 * 发射目标本身是编得过的可窄化判别联合。
 *
 * 断言纪律：全部锚定协议包 `PathAt`/`PathValue`/`PathKind` 的类型投影行为；负例用
 * `@ts-expect-error` 自我反转断言。
 */
import { describe, it, expectTypeOf } from 'vitest';
import type {
  PathAt,
  PathValue,
  PathKind,
  PathSchema,
  VfslPathMap,
  VfslTypedAccess,
} from '@nomicore/vfsl-protocol';

/** 发射目标参照：Entity 判别联合（image 独有 url；text 独有 richBody/title）。 */
declare module '@nomicore/vfsl-protocol' {
  interface VfslPathMap {
    entityList: PathSchema<
      Record<
        `${number}`,
        PathSchema<
          | { kind: PathSchema<'image', 'leaf'>; url: PathSchema<string, 'leaf'> }
          | { kind: PathSchema<'text', 'leaf'>; richBody: PathSchema<string, 'leaf'>; title: PathSchema<string, 'leaf'> },
          'map'
        >
      >,
      'array'
    >;
  }
}

declare const access: VfslTypedAccess<import('@nomicore/vfsl-protocol').VfslPathMap>;
type Entity = PathValue<PathAt<import('@nomicore/vfsl-protocol').VfslPathMap, ['entityList', '0']>>;

/** 分发 helper：逐成员按 kind 窄化取成员独有字段（E 是裸类型参数 → 条件类型逐成员分发）。 */
type UrlOf<E> = E extends { kind: 'image'; url: infer U } ? U : never;
type RichBodyOf<E> = E extends { kind: 'text'; richBody: infer B } ? B : never;

describe('AC3 — 判别式联合发射为可窄化 TS 判别联合（编译级）', () => {
  it('整实体 read 返回判别联合（image|text 两成员）', () => {
    expectTypeOf<Entity>().toEqualTypeOf<
      | { kind: 'image'; url: string }
      | { kind: 'text'; richBody: string; title: string }
    >();
  });

  it('判别字段 kind 为精确字面量联合，可被判别类型守卫窄化到成员独有字段（非 never）', () => {
    expectTypeOf<
      PathValue<PathAt<import('@nomicore/vfsl-protocol').VfslPathMap, ['entityList', '0', 'kind']>>
    >().toEqualTypeOf<'image' | 'text'>();
    // 分发窄化：成员独有字段可精确取得 → 非 never
    expectTypeOf<UrlOf<Entity>>().not.toEqualTypeOf<never>();
    expectTypeOf<RichBodyOf<Entity>>().not.toEqualTypeOf<never>();
  });

  it('union 节点的 kind = \'map\'(数组元素位 Entity 是 map 载体)', () => {
    expectTypeOf<
      PathKind<PathAt<import('@nomicore/vfsl-protocol').VfslPathMap, ['entityList', '0']>>
    >().toEqualTypeOf<'map'>();
  });
});

describe('AC1/D2 — 联合成员独有字段 read → T | undefined、patch → T（发射目标参照）', () => {
  it('read 成员独有字段 → T | undefined（仅 image 有 url：url 读宽度 string | undefined）', () => {
    expectTypeOf<
      PathValue<PathAt<import('@nomicore/vfsl-protocol').VfslPathMap, ['entityList', '0', 'url']>>
    >().toEqualTypeOf<string | undefined>();
  });

  it('read 另一成员独有字段（text 独有 richBody / title）同样带 undefined 宽度', () => {
    expectTypeOf<
      PathValue<PathAt<import('@nomicore/vfsl-protocol').VfslPathMap, ['entityList', '0', 'richBody']>>
    >().toEqualTypeOf<string | undefined>();
  });

  it('patch 成员独有字段 → 声明处类型 T（非 T|undefined）：url 可 patch string', () => {
    // patch 值取声明处类型 T（string），read 的 undefined 宽度合成不用于写投影（D2 / A.6）
    access.patch(['entityList', '0', 'url'], 'https://x');
    // @ts-expect-error patch 值不接受 undefined（声明处类型是 string 非 string|undefined）
    access.patch(['entityList', '0', 'url'], undefined);
  });
});
