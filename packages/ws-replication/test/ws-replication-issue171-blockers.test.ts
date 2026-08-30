import { describe, expect, it } from 'vitest';
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import { boot } from './driver.js';
import { settle } from './harness.js';

describe('issue #171 merge blockers', () => {
  it('GOAWAY drain window still settles an already-sent CLOSE_NAMESPACE with its CLOSE_OK', async () => {
    const run = await boot();
    await run.waitNamespace('live');

    let settled = false;
    run.dropNextHubFrame('CLOSE_OK');
    const close = run.peer.removeTarget(run.nsId).then(() => { settled = true; });
    await settle();
    const closeFrame = run.peerFramesAll('CLOSE_NAMESPACE')[0];
    expect(closeFrame, 'removeTarget must send CLOSE_NAMESPACE before GOAWAY').toBeDefined();
    if (closeFrame === undefined) throw new Error('missing CLOSE_NAMESPACE');

    run.injectHub({
      kind: 'GOAWAY',
      reasonCode: 'SERVER_RESTARTING',
      drainTimeoutMs: 5_000,
    } as ReplicationMessage);
    await settle();

    run.injectHub({
      kind: 'CLOSE_OK',
      namespaceId: run.nsId,
      ackedSequence: closeFrame.header.sequence,
    } as ReplicationMessage);
    await settle();

    expect(run.namespaceState()).toBe('closed');
    expect(settled).toBe(true);
    await close;
  });
});
