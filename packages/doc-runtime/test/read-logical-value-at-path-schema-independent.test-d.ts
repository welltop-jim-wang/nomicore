/**
 * SA6 红灯测试（类型层）— @nomicore/doc-runtime readLogicalValueAtPath 签名契约
 * （issue #86 / ADR-0008：schema-independent `readLogicalValueAtPath(doc, path)`）。
 *
 * 契约来源：
 * - 任务简报 AC1：`readLogicalValueAtPath` 不再接收 derived schema（ADR-0008「必要的底层
 *   演进 1」：`readLogicalValueAtPath(derived, doc, path)` → `readLogicalValueAtPath(doc, path)`）；
 * - 任务简报 AC2/AC6 + ADR-0007 仍生效条款：路径统一为 `readonly (string | number)[]`——
 *   map/object/Record 用 string，Y.Array 用 number；禁止点号字符串与 JSON Pointer；
 * - task_doc-runtime-root-carrier-projection-read_relevant_decisions.md（ADR-0008 原文摘录）：
 *   「预期路径、载体和 lifecycle 失败使用同步结果联合，只有 internal bug 才抛异常」。
 *
 * 断言纪律（同 vfsl-protocol / read-logical-value-at-path test-d 先例）：全部锚定签名/类型
 * 投影行为；负例用 `@ts-expect-error` 自我反转断言——任一负例被实现误放行（如第一参数
 * 放宽为 `any`、derived 旧签名复活、path 参数放宽为 `string`）即触发 unused directive 报错，
 * 本文件转红，强制 SA3 冻结签名。
 *
 * 红灯现状（构造性红灯）：当前实现为 issue #75 冻结的 schema-aware 三参签名
 * readLogicalValueAtPath(derived, doc, path)——
 * - 本文件全部双参调用（`readLogicalValueAtPath(doc, …)`）报 TS2554（期望 3 参数，实得 2）；
 * - 旧签名三参调用行上的 `@ts-expect-error` 为 unused directive（当前三参合法），同样报错。
 * SA3 实现 `readLogicalValueAtPath(doc, path)` 后：双参调用合法、三参调用变错误（directive
 * 反转生效），本文件转绿。
 */
import { describe, expectTypeOf, it } from 'vitest';
import * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';
import { readLogicalValueAtPath } from '../src/index.js';

declare const derived: DerivedSchema;
declare const doc: Y.Doc;

describe('readLogicalValueAtPath — schema-independent 双参签名契约（AC1 / ADR-0008）', () => {
  it('接受 (doc: Y.Doc, path: readonly (string | number)[]) 双参——不含 derived', () => {
    readLogicalValueAtPath(doc, []); // 空 path = 深拷贝完整 ROOT
    const path: readonly (string | number)[] = ['cfg', 'limit'];
    readLogicalValueAtPath(doc, path); // readonly 变量
    readLogicalValueAtPath(doc, ['items', 0]); // 可变字面量数组
    readLogicalValueAtPath(doc, ['meta', 'nested', 'deep'] as const); // readonly 元组
  });

  it('derived 不再是公共参数：旧三参签名 (derived, doc, path) 必须编译错误（@ts-expect-error 自我反转）', () => {
    // @ts-expect-error —— ADR-0008 底层演进 1：derived 参数已移除（本行当前三参合法 → unused directive 红灯）
    readLogicalValueAtPath(derived, doc, []);
    // @ts-expect-error —— 缺 path 参数（仅 doc）也不合法
    readLogicalValueAtPath(doc);
  });

  it('路径纪律：禁点号字符串 / JSON Pointer / 裸标量 / null（ADR-0007 仍生效条款）', () => {
    // 合法类型面：Y.Array number 段与 map string 段同属 readonly (string | number)[]（类型层畅通；
    // 段型与载体不符由运行时结果联合拒绝——见行为测试 AC2）
    readLogicalValueAtPath(doc, ['items', 0]);
    // @ts-expect-error —— 点号字符串路径类型层禁用（ADR-0007「禁点号字符串与 JSON Pointer」）
    readLogicalValueAtPath(doc, 'cfg.limit');
    // @ts-expect-error —— 裸数字 path 非法（path 必须是数组）
    readLogicalValueAtPath(doc, 0);
    // @ts-expect-error —— 裸字符串 path 非法
    readLogicalValueAtPath(doc, 'cfg');
    // @ts-expect-error —— null path 非法
    readLogicalValueAtPath(doc, null);
  });

  it('结果联合：ok:true 携带 value；ok:false 携带字面量错误码与路径（同步结果联合，ADR-0008）', () => {
    const r = readLogicalValueAtPath(doc, []);
    if (r.ok) {
      expectTypeOf(r.value).toEqualTypeOf<unknown>(); // 成功携带 value（缺键时 value 为 undefined）
    } else {
      expectTypeOf(r.code).not.toEqualTypeOf<string>(); // 错误码为字面量联合，非宽 string
      expectTypeOf(r.path).toEqualTypeOf<readonly (string | number)[]>(); // path 回显为段数组
    }
  });
});
