import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';
import { provideClock } from '@nomicore/clock';
import { provideInstance } from '@nomicore/instance';
import { provideNomicoreRegistry } from '@nomicore/namespace-registry';
import {
  createHubReplicationPlugin,
  createPeerReplicationPlugin,
  requireHubReplication,
  requirePeerReplication,
  type DuplexTransport,
} from '../src/index.js';

const namespaceId = `ns-${'1'.repeat(32)}`;

function dependencies(
  ctx: Context,
  role: 'hub' | 'peer',
  timer: { timeout(callback: () => void, delayMs: number): () => void } = { timeout: () => () => {} },
): void {
  provideInstance(ctx, Object.freeze({ instanceId: `${role}-one`, role }));
  provideClock(ctx, { now: () => 1 });
  ctx.provide('timer', timer as never);
  provideNomicoreRegistry(ctx, { open: vi.fn() } as never);
}

function transport(): DuplexTransport {
  return {
    send: vi.fn(), close: vi.fn(), closed: false,
    onMessage: () => () => {}, onClose: () => () => {},
  };
}

describe('role-specific Cordis replication plugins', () => {
  it('rejects role mismatch before hub listener side effects', async () => {
    const listen = vi.fn();
    const plugin = createHubReplicationPlugin(
      { listen: { host: '127.0.0.1', port: 0 }, tokens: [], authorization: [] },
      { listen: { listen } },
    );
    const ctx = new Context();
    dependencies(ctx, 'peer');
    expect(() => plugin.apply(ctx)).toThrow(/requires instance role "hub"/);
    expect(listen).not.toHaveBeenCalled();
  });

  it('publishes hub status/reauth and owns only listener/replication resources', async () => {
    const listenerClose = vi.fn(async () => {});
    const plugin = createHubReplicationPlugin(
      {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: [{ token: 'secret', instanceId: 'peer-one' }],
        authorization: [{
          instanceId: 'peer-one', namespaceId, localOwner: { userId: 'owner' }, read: true, submit: true,
        }],
      },
      { listen: { listen: vi.fn(async () => ({ port: 1, close: listenerClose })) } },
    );
    const ctx = new Context();
    dependencies(ctx, 'hub');
    plugin.apply(ctx);
    await vi.waitFor(() => expect(plugin.listener).toBeDefined());
    expect(requireHubReplication(ctx).status).toEqual({ state: 'ready', connections: 0 });
    await ctx.fiber.dispose();
    expect(listenerClose).toHaveBeenCalledOnce();
  });

  it('starts peer without waiting for hub and exposes target/auth/live operations', async () => {
    const plugin = createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one' },
      { dial: () => transport() },
    );
    const ctx = new Context();
    dependencies(ctx, 'peer');
    plugin.apply(ctx);
    const service = requirePeerReplication(ctx);
    expect(service.status.state).toBe('ready');
    expect(['connecting', 'handshaking']).toContain(service.status.connection);
    service.addTarget({ namespaceId, localOwner: { userId: 'owner' } });
    service.notifyAuthChanged();
    await service.removeTarget(namespaceId);
    await ctx.fiber.dispose();
  });

  it('keeps the hub service available while Cordis drains it', async () => {
    let releaseClose!: () => void;
    const closeStarted = new Promise<void>((resolveStarted) => {
      releaseClose = resolveStarted;
    });
    let listenerCloseEntered!: () => void;
    const listenerCloseStarted = new Promise<void>((resolve) => {
      listenerCloseEntered = resolve;
    });
    const plugin = createHubReplicationPlugin(
      { listen: { host: '127.0.0.1', port: 0 }, tokens: [], authorization: [] },
      {
        listen: {
          listen: vi.fn(async () => ({
            close: async () => {
              listenerCloseEntered();
              await closeStarted;
            },
          })),
        },
      },
    );
    const ctx = new Context();
    dependencies(ctx, 'hub');
    await plugin.apply(ctx);

    const serviceDuringDrain = requireHubReplication(ctx);
    const disposing = ctx.fiber.dispose();
    await listenerCloseStarted;
    expect(serviceDuringDrain.status.state).toBe('stopped');
    releaseClose();
    await disposing;
    expect(() => requireHubReplication(ctx)).toThrow(/unavailable/);
  });

  it('cancels a pending waitForLive timer when stopped', async () => {
    const cancel = vi.fn();
    const timeout = vi.fn(() => cancel);
    const plugin = createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one' },
      { dial: () => transport() },
    );
    const ctx = new Context();
    dependencies(ctx, 'peer', { timeout });
    plugin.apply(ctx);
    const service = requirePeerReplication(ctx);

    const controllerTimerCount = timeout.mock.calls.length;
    const pending = service.waitForLive(namespaceId);
    expect(timeout).toHaveBeenCalledTimes(controllerTimerCount + 1);
    await service.stop();
    await expect(pending).rejects.toThrow('peer replication stopped');
    expect(cancel.mock.calls.length).toBeGreaterThanOrEqual(1);
    await ctx.fiber.dispose();
  });

  it('accepts static hubUrl/token through the portable dial factory seam', () => {
    const createDial = vi.fn(() => () => transport());
    const plugin = createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one', hubUrl: 'wss://hub.example/replication', token: 'secret' },
      { createDial },
    );
    expect(createDial).toHaveBeenCalledWith({ hubUrl: 'wss://hub.example/replication', token: 'secret' });
    expect(plugin).toBeDefined();
  });

  it('rejects dead or ambiguous peer dial configuration', () => {
    expect(() => createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one', hubUrl: 'wss://hub.example/replication', token: 'secret' },
      {},
    )).toThrow(/provide dial or static hubUrl\/token with createDial/);
    expect(() => createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one' },
      { dial: () => transport(), createDial: () => () => transport() },
    )).toThrow(/choose one dial adapter/);
  });

  it('supports whole-collection overrides and nested numeric merges', async () => {
    const targetTwo = `ns-${'2'.repeat(32)}`;
    const plugin = createPeerReplicationPlugin(
      {
        expectedHubInstanceId: 'hub-one',
        targets: [{ namespaceId, localOwner: { userId: 'old-owner' } }],
        limits: { maxFrameBytes: 8 * 1024 * 1024 },
      },
      {
        dial: () => transport(),
        targets: [{ namespaceId: targetTwo, localOwner: { userId: 'new-owner' } }],
        limits: { maxUpdateBytes: 1024 },
      },
    );
    const ctx = new Context();
    dependencies(ctx, 'peer');
    await plugin.apply(ctx);
    expect(plugin.replication?.getNamespaceState(namespaceId)).toBeUndefined();
    expect(plugin.replication?.getNamespaceState(targetTwo)).toBeDefined();
    await ctx.fiber.dispose();
  });

  it('supports whole static Hub collection overrides', async () => {
    let authenticate!: (token: string) => Promise<unknown>;
    const plugin = createHubReplicationPlugin(
      {
        listen: { host: '127.0.0.1', port: 0 },
        tokens: [{ token: 'old-secret', instanceId: 'peer-old' }],
        authorization: [],
      },
      {
        tokens: [{ token: 'new-secret', instanceId: 'peer-new' }],
        authorization: [],
        listen: { listen: vi.fn(async (options) => { authenticate = options.authenticate; return { close: async () => {} }; }) },
      },
    );
    const ctx = new Context();
    dependencies(ctx, 'hub');
    await plugin.apply(ctx);
    expect(await authenticate('old-secret')).toBeUndefined();
    expect(await authenticate('new-secret')).toEqual({ peerInstanceId: 'peer-new' });
    await ctx.fiber.dispose();
  });

  it('publishes the Peer service only after start succeeds', () => {
    const plugin = createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one' },
      { dial: () => { throw new Error('dial failed'); } },
    );
    const ctx = new Context();
    dependencies(ctx, 'peer');
    expect(() => plugin.apply(ctx)).not.toThrow();
    expect(requirePeerReplication(ctx).status.state).toBe('ready');
  });

  it('strictly rejects nested unknown keys, target shapes, and adapter shapes', () => {
    expect(() => createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one', limits: { typo: 1 } } as never,
      { dial: () => transport() },
    )).toThrow(/peer replication limits: invalid configuration/);
    expect(() => createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one', targets: [{ namespaceId, localOwner: { userId: 'owner', typo: true } }] } as never,
      { dial: () => transport() },
    )).toThrow(/target local owner: invalid configuration/);
    expect(() => createHubReplicationPlugin(
      { listen: { host: '127.0.0.1', port: 0 }, tokens: [], authorization: [] },
      { listen: {} as never },
    )).toThrow(/invalid listen adapter/);
  });

  it('leverages low-level construction validation for merged numeric fields', () => {
    const plugin = createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one', timeouts: { pingIntervalMs: 10 } },
      { dial: () => transport(), timeouts: { pongTimeoutMs: 20 } },
    );
    const ctx = new Context();
    dependencies(ctx, 'peer');
    expect(() => plugin.apply(ctx)).toThrow(/pongTimeoutMs/);
    expect(() => requirePeerReplication(ctx)).toThrow(/unavailable/);
  });

  it('strictly rejects unknown config without echoing credential values', () => {
    expect(() => createPeerReplicationPlugin(
      { expectedHubInstanceId: 'hub-one', token: 'do-not-print', typo: true } as never,
      { dial: () => transport() },
    )).toThrow('peer replication config: invalid configuration');
    try {
      createPeerReplicationPlugin(
        { expectedHubInstanceId: 'hub-one', token: 'do-not-print', typo: true } as never,
        { dial: () => transport() },
      );
    } catch (error) {
      expect(String(error)).not.toContain('do-not-print');
    }
  });
});
