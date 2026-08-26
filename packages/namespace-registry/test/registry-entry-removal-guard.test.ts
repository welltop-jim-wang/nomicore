/**
 * SA7 核对补证 — issue #110 AC10：entry 删除守卫（§5 removeOnlySelf）的
 * identity + generation 防 ABA 动态证据。
 *
 * 背景（SA7 核对结论 AC10 PARTIAL）：#110 无 close/create 调用方，守卫无端到端
 * 路径；SA7 方案 1 要求把守卫做模块级导出（包内模块通道纪律——本文件经相对导入
 * 直接消费 ../src/registry.js，主入口与 testing 均不 re-export；surface 测试另行
 * 断言主入口不出现 'removeOnlySelf'）。
 *
 * 覆盖（方案 2 a/b/c）：
 * - (b) 匹配 identity + generation：正常删除；
 * - (a) ABA：旧对象引用/旧 generation 的删除调用不能删「同 key 的新 generation entry」；
 * - 双守卫各自独立维度：同 key 同 generation 但不同对象引用（identity 守卫单独生效）；
 * - (c) 其余分支：key 不存在 no-op；其它 key 不受影响；匹配时只删同 key 条目。
 */
import { describe, expect, it } from 'vitest';
import { removeOnlySelf } from '../src/registry.js';

/** 守卫最小结构（完整 Entry 结构性满足该约束；此处以最小形状直接驱动）。 */
interface GuardEntry {
  readonly key: string;
  readonly generation: bigint;
}

function makeMap(entries: GuardEntry[]): Map<string, GuardEntry> {
  const map = new Map<string, GuardEntry>();
  for (const entry of entries) {
    map.set(entry.key, entry);
  }
  return map;
}

describe('entry 删除守卫 removeOnlySelf（§5；AC10 动态证据）', () => {
  it('模块级可测通道存在：removeOnlySelf 是函数；主入口不 re-export', async () => {
    expect(typeof removeOnlySelf).toBe('function');
    const main = await import('@nomicore/namespace-registry');
    expect((main as Record<string, unknown>).removeOnlySelf).toBeUndefined();
    const testing = await import('@nomicore/namespace-registry/testing');
    expect((testing as Record<string, unknown>).removeOnlySelf).toBeUndefined();
  });

  it('(b) 匹配 identity + generation：正常删除该 key 的 entry', () => {
    const entry: GuardEntry = { key: 'k', generation: 7n };
    const map = makeMap([entry]);
    removeOnlySelf(map, entry);
    expect(map.has('k')).toBe(false);
    expect(map.size).toBe(0);
  });

  it('(a) ABA：旧 identity + 旧 generation 的删除调用不删同 key 的新 generation entry', () => {
    const oldEntry: GuardEntry = { key: 'k', generation: 1n };
    const newEntry: GuardEntry = { key: 'k', generation: 2n };
    const map = makeMap([newEntry]); // 新 generation 已置入 map（旧 completion 迟到）
    removeOnlySelf(map, oldEntry); // 旧 entry 引用 + 旧代际的删除尝试
    expect(map.has('k')).toBe(true);
    expect(map.get('k')).toBe(newEntry); // 新 entry 未被删除/替换
  });

  it('identity 守卫独立生效：同 key 同 generation、但不同对象引用 → 不删', () => {
    const first: GuardEntry = { key: 'k', generation: 5n };
    const second: GuardEntry = { key: 'k', generation: 5n }; // 代际相同、引用不同
    const map = makeMap([second]);
    removeOnlySelf(map, first);
    expect(map.has('k')).toBe(true);
    expect(map.get('k')).toBe(second);
  });

  it('(c) key 不存在：no-op（不 throw、不产生副作用）', () => {
    const entry: GuardEntry = { key: 'absent', generation: 3n };
    const map = makeMap([{ key: 'other', generation: 9n }]);
    expect(() => removeOnlySelf(map, entry)).not.toThrow();
    expect(map.has('absent')).toBe(false);
    expect(map.has('other')).toBe(true);
  });

  it('(c) 匹配时只删同 key 条目：其他 key 不受影响', () => {
    const a: GuardEntry = { key: 'a', generation: 1n };
    const b: GuardEntry = { key: 'b', generation: 2n };
    const map = makeMap([a, b]);
    removeOnlySelf(map, a);
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(true);
    expect(map.get('b')).toBe(b);
  });

  it('(a) 变体：同 key 新代际 entry 也不能被「generation 已被重写但引用仍旧」的消息错删', () => {
    // 双条件语义：删除要求「当前值 === entry」——任何新对象（即便伪造旧代际号）都
    // 不能命中；旧 completion 只能携带它自己捕获的旧引用。
    const oldRef: GuardEntry = { key: 'k', generation: 1n };
    const impersonator: GuardEntry = { key: 'k', generation: 1n }; // 同代际号的伪造新对象
    const map = makeMap([impersonator]);
    removeOnlySelf(map, oldRef);
    expect(map.get('k')).toBe(impersonator);
  });
});
