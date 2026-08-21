/**
 * SA6 红灯测试 — domains/vfs3-assets（issue #27）· AC3：设计文档 §8.5 迁移演示。
 *
 * 契约来源：任务简报 AC3「模拟字段重命名后旧路径全部编译错误（每行一个 @ts-expect-error）」；
 * ADR 0005 §4「§8.5 迁移清单价值」——schema 改动与再生成同原子提交后，**旧路径的全部
 * 消费点在编译期当场亮红**，PR diff 即迁移清单。本文件把该承诺钉成编译断言：
 *
 *   模拟迁移：AssetEntity 的 file 成员字段 `name` → `label` 重命名。
 *   - 迁移前 = 真实生成表（领域包增广的 VfslPathMap，被测对象）：旧路径合法（对照组）；
 *   - 迁移后 = 手写模拟「再生成输出形态」的本地表 MigratedPathMap（生成器是票 F 职责，
 *     本票不重跑生成器，按映射表逐字模拟 rename 后的类型表——protocol 测试手写表同款先例）；
 *   - 旧路径清单逐行 @ts-expect-error（自我反转：任何一行被错误放行 → 测试失败）；
 *   - 另附精确失败态断言：旧路径解析 = UnknownPath<剩余段>（比「有错误」更强的等价锚）。
 *
 * 编码假设：同 vfs3-assets-projection.test-d.ts 文件头（包名/挂载/映射表形态）。
 * MigratedPathMap 复用领域包导出的 Audit 别名（未迁移部分逐字不变），顺带锚定
 * 「别名导出面可被消费方引用」这一挂载点契约。
 *
 * 断言纪律：类型投影行为断言（PathAt/访问面签名），不读源码、不 grep 文本形状。
 */
import { describe, it, expectTypeOf } from 'vitest';
import type {
  PathAt,
  PathSchema,
  PathValue,
  UnknownPath,
  VfslPathMap,
  VfslTypedAccess,
} from '@nomicore/vfsl-protocol';
import type { Audit } from '@nomicore/vfs3-assets';

// ── 迁移前：真实生成表（领域包增广）——对照组 ──
declare const before: VfslTypedAccess<VfslPathMap>;

// ── 迁移后：手写模拟再生成表——file 成员 name → label，其余逐字不变 ──
type MigratedAssetEntity =
  | {
      kind: PathSchema<'image', 'leaf'>;
      url: PathSchema<string, 'leaf'>;
      width: PathSchema<number, 'leaf'>;
      height: PathSchema<number, 'leaf'>;
      audit: PathSchema<Audit, 'map'>;
    }
  | {
      kind: PathSchema<'text', 'leaf'>;
      body: PathSchema<string, 'xml-fragment'>;
      audit: PathSchema<Audit, 'map'>;
    }
  | {
      kind: PathSchema<'file', 'leaf'>;
      label: PathSchema<string, 'leaf'>;
      size: PathSchema<number, 'leaf'>;
      tags: PathSchema<Record<`${number}`, PathSchema<string, 'leaf'>>, 'array'>;
      audit: PathSchema<Audit, 'map'>;
    };

/** 模拟「重命名后 regenerate 的 VfslPathMap」（本地接口，**不**做 declare module——防污染全局增广）。 */
interface MigratedPathMap {
  assets: PathSchema<Record<string, PathSchema<MigratedAssetEntity, 'map'>>, 'map'>;
  attachments: PathSchema<string[], 'plain'>;
  audit: PathSchema<Audit, 'map'>;
  // 可选成员按修复后语法直写 `notes?:`（vfsl-protocol 可选成员坍缩修复随本 PR 落地：
  // Record-infer → 同态 keyof，可选 `?` 修饰符保留——旧「必填 + undefined 并」绕行形态退役）。
  notes?: PathSchema<string, 'leaf'>;
  keywords: PathSchema<Record<`${number}`, PathSchema<string, 'leaf'>>, 'array'>;
}

declare const after: VfslTypedAccess<MigratedPathMap>;

describe('AC3 §8.5 迁移演示 — 对照组：迁移前旧路径合法', () => {
  it('真实生成表上「assets → id → name」可解析（file 成员独有字段 → string | undefined）', () => {
    expectTypeOf<PathValue<PathAt<VfslPathMap, ['assets', 'f1', 'name']>>>().toEqualTypeOf<
      string | undefined
    >();
    before.read(['assets', 'f1', 'name']);
    before.patch(['assets', 'f1', 'name'], 'old.ts');
  });
});

describe('AC3 §8.5 迁移演示 — 旧路径清单：重命名后逐行编译错误', () => {
  it('旧路径 read/patch/kindOf 三访问面全部 fail-closed（每行一个 @ts-expect-error）', () => {
    // @ts-expect-error 旧路径：name 已重命名为 label → 不在迁移后键空间 → UnknownPath
    after.read(['assets', 'f1', 'name']);
    // @ts-expect-error 旧路径：name 已重命名为 label → 不在迁移后键空间 → UnknownPath
    after.patch(['assets', 'f1', 'name'], 'old.ts');
    // @ts-expect-error 旧路径：name 已重命名为 label → 不在迁移后键空间 → UnknownPath
    after.kindOf(['assets', 'f1', 'name']);
  });

  it('旧形状整实体写入（带 name、缺 label）不再匹配判别联合', () => {
    // 旧实体形状：file 成员现要求 label；name 是未知字段 → 整实体写入编译错误
    // （tsc 把多余属性错误报在属性行而非调用行，故 @ts-expect-error 贴在 name 行上）
    after.patch(['assets', 'f1'], {
      kind: 'file',
      // @ts-expect-error 旧字段 name 已重命名为 label，不在迁移后 file 成员键空间
      name: 'old.ts',
      size: 1,
      tags: { 0: 't' },
      audit: { createdBy: 'u', createdAt: 0 },
    });
  });

  it('精确失败态：旧路径解析 = UnknownPath<剩余段>（等价锚，非仅「有错误」）', () => {
    expectTypeOf<PathAt<MigratedPathMap, ['assets', 'f1', 'name']>>().toEqualTypeOf<
      UnknownPath<['name']>
    >();
    // fail-closed 扩散：UnknownPath 的 PathValue 仍为 UnknownPath（never 不污染类型断言视野外）
    expectTypeOf<PathValue<PathAt<MigratedPathMap, ['assets', 'f1', 'name']>>>().toEqualTypeOf<
      UnknownPath<['name']>
    >();
  });
});

describe('AC3 §8.5 迁移演示 — 新路径正例：迁移后表上消费方改写后即转绿', () => {
  it('新路径「assets → id → label」解析为 file 成员独有字段（read → string | undefined）', () => {
    expectTypeOf<PathValue<PathAt<MigratedPathMap, ['assets', 'f1', 'label']>>>().toEqualTypeOf<
      string | undefined
    >();
    after.read(['assets', 'f1', 'label']);
    after.patch(['assets', 'f1', 'label'], 'new.ts');
  });

  it('新形状整实体写入编译通过；未迁移成员不受影响', () => {
    after.patch(['assets', 'f1'], {
      kind: 'file',
      label: 'new.ts',
      size: 1,
      tags: { 0: 't' },
      audit: { createdBy: 'u', createdAt: 0 },
    });
    // image/text 成员路径逐字未变 → 迁移不波及其消费点
    after.patch(['assets', 'i1', 'url'], 'https://x');
    after.patch(['assets', 't1', 'body'], '<p>x</p>');
  });
});
