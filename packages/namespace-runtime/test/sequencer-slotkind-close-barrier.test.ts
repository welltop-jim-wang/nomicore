/**
 * issue #238 修复腿（评审发现回归锚）：`SequencerSlotKind` 词表含 `'close-barrier'`
 * （「close/fence 队列终节点」），但 `close.ts` 的 runtime close barrier 与
 * `runtime.ts` 的 `beginResetFence` 两个入队点曾缺标签——缺标签的槽在 slotMetrics
 * 武装下静默零样本（词表过度声称）。本文件锁定「close barrier 槽样本必然在场」的
 * 词表 ↔ 实现挂接；fence 支路共用同一入队签名（`enqueue(run, 'close-barrier')`）。
 *
 * 断言纪律：只经包内 seam（`createNamespaceRuntimeWithSeam` + 注入
 * `replicationObservability{ stageClock, slotMetrics }`）观测样本流；fake handle
 * 计数 release；零 real sleep（expect.poll 仅等 P0 编译结算）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNamespaceRuntimeWithSeam } from '../src/runtime.js';
import type { SequencerSlotSample } from '../src/sequencer.js';
import type { NamespaceRuntime } from '../src/index.js';
import type { DocHandle, User } from '@nomicore/persistence';

const OWNER: User = { userId: 'u-slot-kind' };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  sc.set('lang', 'vfsl');
  sc.set('version', 1);
  sc.set('id', 'ns-1');
  sc.set('text', 'type ROOT = { n: number; };');
  const meta = doc.getMap('META');
  meta.set('docId', 'ns-1');
  meta.set('createdAt', 1_700_000_000_000);
  doc.getMap('ROOT').set('n', 1);
  return doc;
}

function makeFakeHandle(doc: Y.Doc): { handle: DocHandle; releaseCalls: () => number } {
  let calls = 0;
  const handle = {
    owner: OWNER,
    docId: 'ns-1',
    doc,
    getStatus: () => 'ready',
    release: () => {
      calls += 1;
      return Promise.resolve();
    },
  } as unknown as DocHandle;
  return { handle, releaseCalls: () => calls };
}

async function waitReady(runtime: NamespaceRuntime): Promise<void> {
  await expect
    .poll(() => runtime.getStatus().schema.state, { interval: 10, timeout: 5_000 })
    .toBe('ready');
}

describe('sequencer 槽级记账 slotKind 挂接（issue #238 §7 词表回归锚）', () => {
  it('close barrier 槽样本携带 close-barrier 标签（词表 close/fence 队列终节点）', async () => {
    const samples: SequencerSlotSample[] = [];
    const { handle, releaseCalls } = makeFakeHandle(makeDoc());
    const runtime = createNamespaceRuntimeWithSeam({
      handle,
      notifyDirty: async () => {},
      replicationObservability: {
        stageClock: { now: () => 0 },
        slotMetrics: (sample: SequencerSlotSample) => samples.push(sample),
      },
    } as never);
    await waitReady(runtime);
    samples.length = 0; // 只观察 close 窗口（P0 等启动槽不计）

    await runtime.close();

    expect(releaseCalls()).toBe(1);
    const barriers = samples.filter((s) => s.slotKind === 'close-barrier');
    expect(barriers).toHaveLength(1); // close barrier 恰一槽一样本
    expect(typeof barriers[0]!.runMs).toBe('number');
    expect(barriers[0]!.queueDepthAtStart).toBeGreaterThanOrEqual(1);
  });

  it('dormant 等价：无 slotMetrics → close 路径零采样面（既有纪律不回归）', async () => {
    const { handle, releaseCalls } = makeFakeHandle(makeDoc());
    const runtime = createNamespaceRuntimeWithSeam({
      handle,
      notifyDirty: async () => {},
      replicationObservability: { stageClock: { now: () => 0 } },
    } as never);
    await waitReady(runtime);

    await runtime.close(); // 无 sink——记账关闭路径；close 语义不受影响

    expect(releaseCalls()).toBe(1);
    expect(runtime.getStatus().lifecycle).toBe('closed');
  });
});
