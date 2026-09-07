/**
 * SA6 红灯/验收锚 — issue #237（namespace-runtime 层：唯一公共入口 mutateData 的
 * 写热路径）。
 *
 * 规范来源（任务材料）：
 * - issue #237 正文 + Owner 2026-09-05T16:01Z（范围收敛 / phase-1 前置假设 /
 *   「无关分支不被访问、复制或校验」测试义务）、2026-09-05T16:08Z（validation
 *   failure 先于 live Y.Doc 写；禁 undo）、2026-09-06T02:55Z（大 ROOT + 连续五笔
 *   叶子 mutation 的 instrumentation：保持 dirty notification 与 wire update
 *   count；不把 #238 replication latency 归因本 issue；不扩公共 API/事件面）；
 * - SA5 报告 wiki/raw/20260906-bug-237.md（R3 现状锚：8k 无关条目 5 笔叶子写 =
 *   5 次 dirty notification + 5 个 owned update 事件 + 29–33 B/笔——缺陷只在延迟，
 *   不在计数）；
 * - SA8 门禁 wiki/raw/task_237_conflict_report.md（对照 11：instrumentation 用测试
 *   内部 seam；E1–E4 文档修订义务随代码交付，见 wiki/raw/20260906-ac-issue-237.md）。
 *
 * 红灯纪律：真实 Yjs / 真实 vfsl 编译 / 真实 Runtime（包内 seam
 * createNamespaceRuntimeWithSeam）——零源码 grep、零真实 sleep、拒绝与结果一律经
 * 返回 Promise 结算断言。预期当前代码必红的用例标注「必红」，直接绿的锁定用例标注
 * 「绿锁定」。
 *
 * wire update count 的 wire 级冻结另由
 * packages/ws-replication/test/ws-replication-issue230-incremental-mutation.test.ts
 * 承担（5 笔小写 = 5 update-sent / 5 acked / 5 applied，零 resync）；本文件在
 * doc 事务事件层锚定同一计数（SA5 R3 口径），不重复搭建复制链路。
 *
 * 「30 秒周期」压缩说明（Owner 2026-09-06 评论 benchmark 场景）：scanner/liveness
 * 每 ~30s 一批五笔叶子 mutation——本文件把该批五笔压缩为紧邻顺序调用（写路径本身
 * 无墙钟依赖，fake clock 不改变任何断言语义），断言确定性计数，不做 flaky 计时。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DerivedSchema } from '@nomicore/vfsl';
import { evaluate, parseVfsl, validateLogicalSnapshot } from '@nomicore/vfsl';
import { extractYjsSnapshot, materializeRoot } from '@nomicore/doc-runtime';
import type { DocHandle, User } from '@nomicore/persistence';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { MutateDataResult, NamespaceRuntime } from '../src/index.js';

const OWNER: User = { userId: 'u-sa6-237' };
const DOC_ID = 'ns-237';
const TEXT =
  'type Item = { name: string; qty: number };\n'
  + 'type ROOT = { target: { value: number }; library: YArray<Item> };';
const ENVELOPE = { lang: 'vfsl', version: 1, id: DOC_ID, text: TEXT } as const;

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(`前置 parseVfsl 失败（fixture 缺陷）：${JSON.stringify(parsed.issues)}`);
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(`前置 evaluate 失败（fixture 缺陷）：${JSON.stringify(evaluated.issues)}`);
  return evaluated.derived;
}

function librarySeed(n: number): Array<{ name: string; qty: number }> {
  return Array.from({ length: n }, (_, i) => ({ name: `item-${i}`, qty: i }));
}

/** 种子文档：materialize ROOT（SCHEMA/META 兄弟条目后置——与 SA5 repro Stage C 同序）。 */
function seedRuntimeDoc(n: number): { derived: DerivedSchema; doc: Y.Doc } {
  const derived = derivedOf(TEXT);
  const doc = new Y.Doc();
  const m = materializeRoot(derived, { target: { value: 0 }, library: librarySeed(n) }, doc);
  if (!m.ok) throw new Error(`前置 materializeRoot 失败（fixture 缺陷）：${JSON.stringify(m.issues).slice(0, 400)}`);
  const sc = doc.getMap('SCHEMA');
  for (const [k, v] of Object.entries(ENVELOPE)) sc.set(k, v);
  const meta = doc.getMap('META');
  meta.set('docId', DOC_ID);
  meta.set('createdAt', 1_700_000_000_000);
  return { derived, doc };
}

/** phase-1 前置条件断言：mutation 前 committed 文档合法（logical values + carrier topology）。 */
function expectValidBaseline(derived: DerivedSchema, doc: Y.Doc): void {
  const ex = extractSnapshot(derived, doc);
  const v = validateLogicalSnapshot(derived, ex.snapshot);
  expect(v.ok, '前置条件：logical values 符合 active schema').toBe(true);
}

function extractSnapshot(derived: DerivedSchema, doc: Y.Doc): { ok: true; snapshot: unknown } {
  // doc-runtime 公共读入口（schema-independent 载体投影 + 严格 carrier 检查）
  const r = extractYjsSnapshot(derived, doc);
  if (!r.ok) throw new Error(`前置 extract 失败（fixture 缺陷）：${JSON.stringify(r.issues).slice(0, 300)}`);
  return { ok: true, snapshot: r.snapshot };
}

function stateBytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

function eventsOf(doc: Y.Doc): { count: number; bytes: number[] } {
  const e = { count: 0, bytes: [] as number[] };
  doc.on('update', (u: Uint8Array) => {
    e.count += 1;
    e.bytes.push(u.byteLength);
  });
  return e;
}

interface RuntimeHarness {
  readonly runtime: NamespaceRuntime;
  notifyCount(): number;
}

function makeRuntime(doc: Y.Doc): RuntimeHarness {
  let notifyCount = 0;
  const handle = {
    owner: OWNER,
    docId: DOC_ID,
    doc,
    getStatus: () => 'ready',
    release: async () => {},
  } as unknown as DocHandle;
  const runtime = createNamespaceRuntimeWithSeam({
    handle,
    notifyDirty: async () => {
      notifyCount += 1;
    },
  });
  return { runtime, notifyCount: () => notifyCount };
}

async function readyOf(runtime: NamespaceRuntime): Promise<void> {
  await expect.poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 }).toBe('ready');
}

function libraryOf(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getMap('ROOT').get('library') as Y.Array<Y.Map<unknown>>;
}

function targetValueOf(doc: Y.Doc): unknown {
  return (doc.getMap('ROOT').get('target') as Y.Map<unknown>).get('value');
}

const SET_TARGET = (value: number) => ({ op: 'set', path: ['target', 'value'], value });

// ═══════════════════════ B-1【绿锁定】公共 interface + 槽序 + 单事务语义 ═══════════════════════

describe('B-1【绿锁定】mutateData 公共 interface / 严格 FIFO / 最小 edit / 单 guarded transaction 不回归', () => {
  it('5 笔顺序叶子 set：逐笔精确 { ok:true } 结果联合、notify=5、doc update 事件=5 且每笔 <128B、carrier identity 稳定', async () => {
    const { derived, doc } = seedRuntimeDoc(2_000);
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    // phase-1 前置条件：P0 ready 后 committed ROOT 合法（carrier topology + logical values）
    expectValidBaseline(derived, doc);
    const target = doc.getMap('ROOT').get('target');
    const library = libraryOf(doc);
    const ev = eventsOf(doc);

    for (let i = 1; i <= 5; i++) {
      const r = await runtime.mutateData(SET_TARGET(i));
      expect(r, '结果联合成功支必须精确为 { ok:true }（ADR-0008 窄完成信号）').toEqual({ ok: true });
      expect(targetValueOf(doc)).toBe(i);
    }

    expect(notifyCount(), '每笔成功写恰 1 次同槽 dirty notification（S6）').toBe(5);
    expect(ev.count, '每笔成功写恰 1 个 Yjs update 事件（单 guarded transaction）').toBe(5);
    for (const b of ev.bytes) {
      expect(b, '最小 edit：owned update 不得随 ROOT 规模放大（现状 29–33B）').toBeLessThan(128);
    }
    expect(doc.getMap('ROOT').get('target')).toBe(target); // 目标 carrier identity 保留
    expect(doc.getMap('ROOT').get('library')).toBe(library); // 无关 carrier identity 保留
    expect(library.length).toBe(2_000); // 无关分支不被访问/复制/改写
    expect((library.get(0)!.get('name'))).toBe('item-0');
    expect((library.get(1_999)!.get('qty'))).toBe(1_999);
    // 全局 logical 有效性保持（batch 尾校验一次——归纳维持：合法基线 + 边界合法 ⇒ 全局合法）
    const tailEx = extractSnapshot(derived, doc);
    expect(validateLogicalSnapshot(derived, tailEx.snapshot).ok).toBe(true);
    expect(runtime.getStatus().schema.state).toBe('ready');
  });
});

// ═══════════════════════ B-2【绿锁定】校验失败零写入 / 零 dirty / 零事件 ═══════════════════════

describe('B-2【绿锁定】validation failure 在触碰 live Y.Doc 前决定（经 mutateData 公共入口）——零写入、零 dirty、零事件、槽不中毒', () => {
  it('路径内非法新值 → ok:false + issues 非空 + 状态字节不变 + notify=0 + update 事件=0；后续合法写不受影响', async () => {
    const { derived, doc } = seedRuntimeDoc(3);
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    expectValidBaseline(derived, doc);
    const before = stateBytes(doc);
    const ev = eventsOf(doc);

    const r = await runtime.mutateData({ op: 'set', path: ['target', 'value'], value: 'not-a-number' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0);
    }
    expect(stateBytes(doc)).toEqual(before);
    expect(notifyCount()).toBe(0);
    expect(ev.count).toBe(0);
    expect(targetValueOf(doc)).toBe(0);

    // 失败不 poison 槽：后续合法写照常
    const ok = await runtime.mutateData(SET_TARGET(1));
    expect(ok).toEqual({ ok: true });
    expect(notifyCount()).toBe(1);
    expect(ev.count).toBe(1);
  });
});

// ═══════════════════════ B-3【必红】无关分支非法数据不阻断普通写 ═══════════════════════

describe('B-3【必红】无关 ROOT 分支不被 mutateData 访问/复制/校验——replication-unvalidated 形态不再阻断路径外写（Owner 2026-09-05T16:01Z 已声明语义）', () => {
  it('无关 library[0].qty 为非法 string 时，["target","value"] 路径合法写成功、无关分支原样保留（当前: 被旧 ROOT 全量校验拒绝 ok:false）', async () => {
    const { doc } = seedRuntimeDoc(3);
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    // 经 live carrier 直接写坏无关叶子（绕过一切校验——replication-unvalidated / 损坏存量形态）
    const library = libraryOf(doc);
    const item0 = library.get(0)!;
    doc.transact(() => {
      item0.set('qty', 'corrupt-not-a-number');
    });
    const ev = eventsOf(doc);

    const r = await runtime.mutateData(SET_TARGET(42));

    // 【必红】当前：ok:false（拒绝由无关分支的旧 ROOT 全量校验触发）；契约：ok:true
    expect(r.ok).toBe(true);
    expect(targetValueOf(doc)).toBe(42);
    expect(item0.get('qty'), '无关分支非法值原样保留（不静默修复、不被扫描破坏）').toBe('corrupt-not-a-number');
    expect(library.length).toBe(3);
    expect(notifyCount(), '成功写仍同槽恰一次 dirty notification').toBe(1);
    expect(ev.count, '成功写仍恰一次 Yjs transaction').toBe(1);
  });
});

// ═══════════════════════ B-4 大 ROOT 连续五笔叶子 mutation instrumentation ═══════════════════════

describe('B-4 benchmark/instrumentation：大 ROOT + 连续五笔叶子 mutation（30s 扫描周期压缩；Owner 2026-09-06 场景）', () => {
  it('8k 无关条目：5 笔顺序叶子 set 全部成功，dirty notification=5、wire/update 事件=5、单笔最小 edit、无关分支零触碰、尾部全局合法', async () => {
    const N = 8_000;
    const { derived, doc } = seedRuntimeDoc(N);
    const { runtime, notifyCount } = makeRuntime(doc);
    await readyOf(runtime);
    const library = libraryOf(doc);
    const ev = eventsOf(doc);

    // 五笔叶子 mutation 紧邻顺序执行（等价于 scanner 每 30s 一批五笔，写路径无墙钟依赖）
    for (let i = 1; i <= 5; i++) {
      const r = await runtime.mutateData(SET_TARGET(i));
      expect(r).toEqual({ ok: true });
      expect(targetValueOf(doc)).toBe(i);
    }

    // 保持 dirty notification（每笔成功写恰一次，共 5 次——SA5 R3 现状锚）
    expect(notifyCount(), '5 笔成功写 = 5 次 dirty notification（保持，不得因优化改变事务语义）').toBe(5);
    // 保持 wire update count（doc 事务事件层计数 = 5 笔；wire 层冻结见 ws-replication-issue230 测试）
    expect(ev.count, '5 笔成功写 = 5 个 update 事件（wire update count 保持）').toBe(5);
    for (const b of ev.bytes) {
      expect(b, 'owned update 保持最小（29–33B 量级），不得随 ROOT 规模放大').toBeLessThan(256);
    }
    // 无关 ROOT 分支零访问/复制/校验（identity + 规模 + 内容 + 不被遍历破坏）
    expect(doc.getMap('ROOT').get('library')).toBe(library);
    expect(library.length).toBe(N);
    expect(library.get(0)!.get('name')).toBe('item-0');
    expect(library.get(N - 1)!.get('qty')).toBe(N - 1);
    // 尾部全局 logical + carrier 合法（归纳不变量保持）
    const tail = extractSnapshot(derived, doc);
    expect(validateLogicalSnapshot(derived, tail.snapshot).ok).toBe(true);
    expect(runtime.getStatus().schema.state).toBe('ready');
  });
});
