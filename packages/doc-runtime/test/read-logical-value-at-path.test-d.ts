/**
 * SA6 红灯测试（类型层）— @nomicore/doc-runtime readLogicalValueAtPath 签名契约（issue #75）。
 *
 * 契约来源：
 * - 任务简报 AC1：path 统一为 `readonly (string | number)[]`；空 path 显式读取完整 ROOT；
 * - ADR-0007：路径统一为 `readonly (string | number)[]`——map/object/Record 用 string，Y.Array
 *   用 number；禁止点号字符串与 JSON Pointer；
 * - wiki/raw/task_read-logical-value-at-path_conflict_report.md 注记 B：失败形态为领域化结果联合
 *   `{ ok:false, code:'PATH_NOT_ALLOWED', … }`，不得并入逻辑校验 issues 体系。
 *
 * 断言纪律（同 vfsl-protocol test-d 先例）：全部锚定签名/类型投影行为；负例用 `@ts-expect-error`
 * 自我反转断言——任一负例被实现误放行（如 path 参数放宽为 `string`）即触发 unused directive 报错，
 * 本文件转红，强制 SA3 冻结签名。
 *
 * 红灯现状（构造性红灯）：index.ts 尚不导出 readLogicalValueAtPath → import 即 TS2305/TS2307
 * （vitest typecheck 与 tsc -p packages/doc-runtime/tsconfig.json 双通道全红）。
 */
import { describe, expectTypeOf, it } from 'vitest';
import * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';
import { readLogicalValueAtPath } from '../src/index.js';

declare const derived: DerivedSchema;
declare const doc: Y.Doc;

describe('readLogicalValueAtPath — path 签名契约（AC1 / ADR-0007）', () => {
  it('接受 readonly (string | number)[] 路径（map string 段 + Y.Array number 段混合）', () => {
    const path: readonly (string | number)[] = ['assets', 'img1', 'url'];
    readLogicalValueAtPath(derived, doc, path); // readonly 变量
    readLogicalValueAtPath(derived, doc, []); // 空 path = 显式读取完整 ROOT
    readLogicalValueAtPath(derived, doc, ['keywords', 0]); // 可变字面量数组
    readLogicalValueAtPath(derived, doc, ['assets', 'img1', 'url'] as const); // readonly 元组
  });

  it('禁止点号字符串 / JSON Pointer / 非数组 path（类型层编译错误）', () => {
    // @ts-expect-error —— 点号字符串路径类型层禁用（ADR-0007「禁点号字符串与 JSON Pointer」）
    readLogicalValueAtPath(derived, doc, 'assets.img1.url');
    // @ts-expect-error —— 裸数字 path 非法（path 必须是数组）
    readLogicalValueAtPath(derived, doc, 0);
    // @ts-expect-error —— 裸字符串 path 非法（path 必须是数组）
    readLogicalValueAtPath(derived, doc, 'assets');
  });

  it('结果联合：ok:true 携带 value；ok:false 携带 code:"PATH_NOT_ALLOWED"（注记 B 冻结形态）', () => {
    const r = readLogicalValueAtPath(derived, doc, []);
    if (r.ok) {
      expectTypeOf(r.value).toEqualTypeOf<unknown>(); // 成功携带 value（缺键时 value 为 undefined）
    } else {
      expectTypeOf(r.code).toEqualTypeOf<'PATH_NOT_ALLOWED'>(); // 错误码为字面量联合，非宽 string
    }
  });
});
