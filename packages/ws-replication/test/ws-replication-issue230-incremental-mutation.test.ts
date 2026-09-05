import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ReplicationObserverEvent } from '@nomicore/ws-replication';
import { bootMulti } from './issue137-driver.js';
import { collectUnhandledRejections } from './driver.js';
import { HUB_OWNER, settle, settleUntil } from './harness.js';

const MAX_UPDATE_BYTES = 512 * 1024;
const LARGE_ROOT_VALUE = 'x'.repeat(MAX_UPDATE_BYTES + 64 * 1024);

type Direction = 'peer' | 'hub';

async function exercise(direction: Direction): Promise<void> {
  const sourceEvents: ReplicationObserverEvent[] = [];
  const destinationEvents: ReplicationObserverEvent[] = [];
  const run = await bootMulti({
    count: 1,
    initialBlurb: LARGE_ROOT_VALUE,
    limits: { maxUpdateBytes: MAX_UPDATE_BYTES },
    peerObserver: (event: ReplicationObserverEvent) =>
      (direction === 'peer' ? sourceEvents : destinationEvents).push(event),
    hubObserver: (event: ReplicationObserverEvent) =>
      (direction === 'hub' ? sourceEvents : destinationEvents).push(event),
  });
  const nsId = run.nsIds[0]!;
  const hubDoc = run.hubNode.persistence.peek(HUB_OWNER, nsId);
  if (hubDoc === undefined) throw new Error('hub replica missing');
  expect(Y.encodeStateAsUpdate(hubDoc).byteLength).toBeGreaterThan(MAX_UPDATE_BYTES);
  sourceEvents.length = 0;
  destinationEvents.length = 0;

  for (let n = 10; n < 15; n += 1) {
    if (direction === 'peer') await run.peerWrite(nsId, { n });
    else await run.hubWrite(nsId, { n });
    const destination: Direction = direction === 'peer' ? 'hub' : 'peer';
    await settleUntil(() => run.rootValue(destination, nsId, 'n') === n, `${direction}→${destination} n=${n}`);
  }
  await settle();

  const sent = sourceEvents.filter(
    (event): event is Extract<ReplicationObserverEvent, { type: 'update-sent' }> =>
      event.type === 'update-sent' && event.namespaceId === nsId,
  );
  expect(sent).toHaveLength(5);
  expect(sent.every((event) => event.bytes < MAX_UPDATE_BYTES)).toBe(true);
  expect(sourceEvents.filter((event) => event.type === 'update-acked' && event.namespaceId === nsId)).toHaveLength(5);
  expect(destinationEvents.filter((event) => event.type === 'update-applied' && event.namespaceId === nsId)).toHaveLength(5);
  for (const events of [sourceEvents, destinationEvents]) {
    expect(events.filter((event) => event.type === 'resync-required' && event.namespaceId === nsId)).toHaveLength(0);
    expect(events.filter((event) =>
      (event.type === 'sync-step2-sent' || event.type === 'sync-diff-applied') && event.namespaceId === nsId,
    )).toHaveLength(0);
  }
}

describe('issue #230 incremental mutation replication', () => {
  it('large ROOT small Peer→Hub writes use UPDATE/ACK without reconciliation', async () => {
    const probe = collectUnhandledRejections();
    try {
      await exercise('peer');
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });

  it('large ROOT small Hub→Peer writes use UPDATE/ACK without reconciliation', async () => {
    const probe = collectUnhandledRejections();
    try {
      await exercise('hub');
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});
