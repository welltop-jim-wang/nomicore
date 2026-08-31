import { describe, expect, it } from 'vitest';
import {
  createHubReplication,
  createPeerReplication,
  type ReplicationObserverEvent,
} from '@nomicore/ws-replication';
import { createNodeHubListenAdapter, createNodePeerDial } from '../src/index.js';
import {
  HUB_INSTANCE,
  HUB_OWNER,
  PEER_INSTANCE,
  TEST_TOKEN,
  makeCounterRandomBytes,
  makeHubNamespace,
  makeTestRegistry,
  waitUntil,
  StubPersistence,
} from './harness.js';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';

describe('public Node Hub/Peer adapters', () => {
  it('carries the immediate Peer HELLO through a real WebSocket and reaches live', async () => {
    const hubFixture = makeTestRegistry();
    const hubNamespace = await makeHubNamespace(hubFixture.registry);
    const peerScheduler = createRegistryTestScheduler();
    const peerRegistry = createNamespaceRegistryForTesting(new StubPersistence(), {
      clock: { now: () => Date.now() },
      scheduler: peerScheduler,
      randomBytes: makeCounterRandomBytes(),
      role: 'peer',
      idleTimeoutMs: 1_000_000,
    });
    const events: ReplicationObserverEvent[] = [];
    const hub = createHubReplication({
      instanceId: HUB_INSTANCE,
      registry: hubFixture.registry,
      timer: hubFixture.scheduler,
      verifyToken: async (token) => token === TEST_TOKEN
        ? { ok: true, instanceId: PEER_INSTANCE }
        : { ok: false },
      authorize: async (instanceId, namespaceId) => instanceId === PEER_INSTANCE
        && namespaceId === hubNamespace.namespaceId
        ? { ok: true, localOwner: HUB_OWNER, permissions: { read: true, submit: true } }
        : { ok: false },
      observer: (event) => events.push(event),
    });
    const acceptTrusted = hub.acceptTrusted;
    if (acceptTrusted === undefined) throw new Error('trusted accept unavailable');
    const listener = await createNodeHubListenAdapter().listen({
      host: '127.0.0.1',
      port: 0,
      path: '/replication',
      authenticate: async (token) => token === TEST_TOKEN
        ? { peerInstanceId: PEER_INSTANCE }
        : undefined,
      accept: (transport, identity) => { void acceptTrusted.call(hub, transport, identity); },
    });
    if (listener.port === undefined) throw new Error('listener port unavailable');

    const peer = createPeerReplication({
      instanceId: PEER_INSTANCE,
      hubInstanceId: HUB_INSTANCE,
      registry: peerRegistry,
      dial: createNodePeerDial(`ws://127.0.0.1:${listener.port}/replication`, TEST_TOKEN),
      timer: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      targets: [{ namespaceId: hubNamespace.namespaceId, localOwner: HUB_OWNER }],
      observer: (event) => events.push(event),
    });
    peer.start();

    await waitUntil('real Node peer reaches live', () =>
      peer.getNamespaceState(hubNamespace.namespaceId) === 'live', 10_000);
    expect(peer.getConnectionState()).toBe('ready');
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'connection-backoff-scheduled',
      reason: 'hello-timeout',
    }));

    await peer.stop();
    await listener.close();
    await hub.close();
    await hubNamespace.lease.release();
    await peerRegistry.shutdown();
    await hubFixture.registry.shutdown();
  }, 15_000);
});
