/**
 * SA6 F-1 回归红灯锚 — Record 动态键 '__proto__'（issue #73，R2.2 追加）。
 *
 * 落位依据：SA4 R1 评审（wiki/raw/task_doc-runtime-extract-yjs-snapshot_sa4_review.md）
 * verdict: reject 的唯一阻塞项 F-1——`packages/doc-runtime/src/extract.ts:104-106`
 * （walk map Record 分支 `out[key] = r.snapshot;` 赋值式写入）使 Record 动态键
 * `'__proto__'` 在 `ok:true` 下静默丢键/原型劫持；设计 R2.2（commit 7646f06）已落文
 * 修复纪律 D13/B16（putSnapshotKey：defineProperty 四描述符安全写入，禁赋值式），
 * §11 备位本回归锚文件 [SA6 owned / R2.2 追加]。
 *
 * 缺陷机理（SA4 实测证据，本文件在 commit 079e957 上复现）：
 * - `out['__proto__'] = v` 命中 `Object.prototype.__proto__` accessor：标量值被 setter
 *   静默忽略（键丢失）；对象值把 out 的原型设为该快照对象（键丢失 + 原型劫持）——
 *   JSON 序列化后数据整体蒸发，且下游 validateLogicalSnapshot 只看快照、永难发现
 *   （端到端零信号静默丢失）。live 侧 `ymap.set('__proto__', v)` 是公共 API 直接可达
 *   （keyPattern 零消费为 D4/B5 明文，Record 键集即数据面）。
 * - 同文件 plain 值分支（copyPlainValue）早已 defineProperty 安全写入（§4.6/B15，
 *   SA4 D 对照探针：plain 值 own '__proto__' 键保留）——Record 分支与 plain 分支纪律
 *   自相矛盾是 F-1 为规格空洞的铁证。
 *
 * 断言锚（全部公共接缝可观测输出，不断言内部实现）：
 * - ① Record 形 ROOT + live own 键 '__proto__'（标量值）→ ok:true 且 snapshot 以
 *   own 属性保留 '__proto__' 键与值（Object.hasOwn / Object.keys / 索引读取）；
 * - ② 嵌套 map 值场景 → snapshot own keys 含 '__proto__' +
 *   `Object.getPrototypeOf(snapshot.m) === Object.prototype`（原型未被劫持）+
 *   JSON.stringify 往返含该键（JSON.parse 按 CreateDataProperty 建 own 键，往返保真）。
 *
 * 红灯现状（F-1 真实红，断言失败而非模块缺失）：当前实现（commit 079e957）Record 分支
 * 赋值式写入——标量 '__proto__' 键静默丢失、对象值原型被劫持，下列断言全部失败；
 * SA3 按 D13/B16 以 putSnapshotKey 修复 Record 分支后转绿（修复半径一行级）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
import { extractYjsSnapshot } from '../src/index.js';

interface ExtractIssue {
  message: string;
  path: Array<string | number>;
  expected: string;
  actual: string;
}

type ExtractResult =
  | { ok: true; snapshot: unknown }
  | { ok: false; issues: ExtractIssue[] };

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

function expectOkSnapshot(result: ExtractResult): Record<string, unknown> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok:true，实际 ok:false（issues: ${JSON.stringify(result.issues)}）`);
  }
  return result.snapshot as Record<string, unknown>;
}

describe('F-1 回归锚 — Record 动态键 __proto__（标量值）：own 键保真，禁静默丢失', () => {
  it('Record 形 ROOT live 含 own 键 __proto__（标量）→ ok:true 且 own 属性保留键与值', () => {
    const derived = derivedOf('type ROOT = Record<string, YLeaf<string>>;');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    root.set('normal', 'v1');
    root.set('__proto__', 'v2'); // 公共 API 直接可达（SA4 A 探针：live keys 含该键）
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    // ① own 键保留（F-1 红点：赋值式写入下标量值被 __proto__ setter 静默忽略 → 键丢失）
    expect(Object.hasOwn(snapshot, '__proto__')).toBe(true);
    expect(Object.keys(snapshot).sort()).toEqual(['__proto__', 'normal']);
    // ② 键值保真（红点：无 own 键时索引读取落到原型链，得到 Object.prototype 而非 'v2'）
    expect(snapshot['__proto__']).toBe('v2');
    expect(snapshot['normal']).toBe('v1');
    // ③ JSON 往返含该键（JSON.parse 按 CreateDataProperty 建 own 键，往返保真）
    const roundtrip = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
    expect(Object.hasOwn(roundtrip, '__proto__')).toBe(true);
    expect(roundtrip['__proto__']).toBe('v2');
  });
});

describe('F-1 回归锚 — Record 动态键 __proto__（嵌套 map 值）：own 键保留 + 原型未被劫持 + 往返含键', () => {
  it('嵌套 Record 值场景：live m 含 own 键 __proto__（Y.Map 对象值）→ snapshot own keys 含该键、原型仍为 Object.prototype、JSON 往返含该键', () => {
    const derived = derivedOf('type ROOT = { m: Record<string, { x: YLeaf<string> }> };');
    const doc = new Y.Doc();
    const root = doc.getMap('ROOT');
    const m = new Y.Map();
    root.set('m', m); // 先挂接再写入（yjs 读取纪律）
    const hijack = new Y.Map();
    m.set('__proto__', hijack);
    hijack.set('x', 'y');
    const normal = new Y.Map();
    m.set('normal', normal);
    normal.set('x', 'n');
    const snapshot = expectOkSnapshot(extractYjsSnapshot(derived, doc));
    const sm = snapshot['m'] as Record<string, unknown>;
    // ① own keys 含 '__proto__'（红点：对象值经赋值式写入 → 键丢失）
    expect(Object.hasOwn(sm, '__proto__')).toBe(true);
    expect(Object.keys(sm).sort()).toEqual(['__proto__', 'normal']);
    // ② 键值保真 + 原型未被劫持（红点：赋值式写入把 sm 原型设为该快照对象 → 键丢失 + 原型劫持）
    expect(sm['__proto__']).toEqual({ x: 'y' });
    expect(Object.getPrototypeOf(sm)).toBe(Object.prototype);
    // ③ JSON.stringify 往返含该键（红点：数据整体蒸发，往返后键不可见）
    expect(JSON.stringify(snapshot)).toContain('"__proto__"');
    const roundtrip = JSON.parse(JSON.stringify(snapshot)) as { m: Record<string, unknown> };
    expect(Object.hasOwn(roundtrip['m'], '__proto__')).toBe(true);
    expect(roundtrip['m']['__proto__']).toEqual({ x: 'y' });
  });
});
