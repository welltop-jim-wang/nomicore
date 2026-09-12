/**
 * SA6 契约加固（可选，SA6 §12.5 建议）— issue #314 C4：负 / 小数字面量联合的**编译级**
 * 类型投影可用（写路径 fail-closed）。
 *
 * 角色分工：生成器本身是纯发射文本（无法在编译期 import 运行输出），故本文件以「发射目标
 * 参照系」手工嵌入 `generate-number-literals.test.ts` 所断言的发射形态（`PathSchema<-1 |
 * 0.5 | 2, 'leaf'>`，SA6 E5 实测生成文本），断言该形态在协议类型投影下：读精确、写接受
 * 精确成员值、非成员值 fail-closed（`@ts-expect-error` 自我反转）。运行时发射由同目录
 * `generate-number-literals.test.ts` + 真实 TS 编译器诊断锁定；两者共同锚定 AC4。
 *
 * 断言纪律：只锚协议包 `PathAt`/`PathValue`/`PathPatchValue` 的类型投影行为；负例用
 * `@ts-expect-error` 自我反转断言；不 skip / 不软化 / 不 grep 源码。
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { PathAt, PathPatchValue, PathValue, PathSchema, VfslPathMap, VfslTypedAccess } from '@nomicore/vfsl-protocol';

// ── 发射目标参照：issue #314 C4 fixture 的数值字面量节点（生成文本逐字形态） ──
declare module '@nomicore/vfsl-protocol' {
  interface VfslPathMap {
    /** `v: -1 | 0.5 | 2;`（generate-number-literals fixture） */
    numberLiteralsSigned: PathSchema<-1 | 0.5 | 2, 'leaf'>;
    /** `tiny: 0.0000001;` → 生成文本 `1e-7`（合法 TS、值等价） */
    numberLiteralsTiny: PathSchema<1e-7, 'leaf'>;
    /** `neg: -1.5 | -0.25;` */
    numberLiteralsNeg: PathSchema<-1.5 | -0.25, 'leaf'>;
  }
}

// typecheck 编译单元永不求值：`declare const` 获得访问器值而无运行时代码。
declare const access: VfslTypedAccess<import('@nomicore/vfsl-protocol').VfslPathMap>;

describe('C4（编译级）— 负 / 小数字面量联合的读投影精确', () => {
  it('PathValue：-1 | 0.5 | 2 / 1e-7 / -1.5 | -0.25 精确投影（f64 字面量类型）', () => {
    expectTypeOf<
      PathValue<PathAt<import('@nomicore/vfsl-protocol').VfslPathMap, ['numberLiteralsSigned']>>
    >().toEqualTypeOf<-1 | 0.5 | 2>();
    expectTypeOf<
      PathValue<PathAt<import('@nomicore/vfsl-protocol').VfslPathMap, ['numberLiteralsTiny']>>
    >().toEqualTypeOf<1e-7>();
    expectTypeOf<
      PathValue<PathAt<import('@nomicore/vfsl-protocol').VfslPathMap, ['numberLiteralsNeg']>>
    >().toEqualTypeOf<-1.5 | -0.25>();
  });

  it('PathPatchValue：写投影 = 声明处成员值类型（不走 never 坍缩）', () => {
    expectTypeOf<
      PathPatchValue<PathAt<import('@nomicore/vfsl-protocol').VfslPathMap, ['numberLiteralsSigned']>>
    >().toEqualTypeOf<-1 | 0.5 | 2>();
  });
});

describe('C4（编译级）— 写路径：成员值可写、非成员值 fail-closed', () => {
  it('正例：patch 各成员值（-1 / 0.5 / 2 / 1e-7 / -1.5 / -0.25）编译通过', () => {
    access.patch(['numberLiteralsSigned'], -1);
    access.patch(['numberLiteralsSigned'], 0.5);
    access.patch(['numberLiteralsSigned'], 2);
    access.patch(['numberLiteralsTiny'], 1e-7);
    access.patch(['numberLiteralsNeg'], -1.5);
    access.patch(['numberLiteralsNeg'], -0.25);
  });

  it('负例：非成员整数 / 越界值 / 近似值均被类型系统拒绝（@ts-expect-error 自我反转）', () => {
    // @ts-expect-error 1 不在 -1 | 0.5 | 2（f64 严格相等语义的类型侧镜像）
    access.patch(['numberLiteralsSigned'], 1);
    // @ts-expect-error 3 不在 -1 | 0.5 | 2
    access.patch(['numberLiteralsSigned'], 3);
    // @ts-expect-error 0.5000000000000001 是不同 f64 值，不在成员集合
    access.patch(['numberLiteralsSigned'], 0.5000000000000001);
    // @ts-expect-error 字符串不是数值字面量类型
    access.patch(['numberLiteralsSigned'], '-1');
  });
});
