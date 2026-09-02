import * as net from 'node:net';
import { describe, expect, it } from 'vitest';
import { createNodeHubListenAdapter } from '../src/index.ts';
import { startHubWsServer } from '../src/transport/ws-server.ts';
import { wsUpgrade } from './harness.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function waitForSocketClose(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }
    socket.once('close', () => resolve());
  });
}

function openUpgradeRequest(port: number, token: string): net.Socket {
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.write(
    [
      'GET /replication HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      `Authorization: Bearer ${token}`,
      '',
      '',
    ].join('\r\n'),
  );
  return socket;
}

describe('deployable WebSocket upgrade admission', () => {
  it('public Node HubListenAdapter authenticates Bearer upgrade and accepts a DuplexTransport', async () => {
    const adapterEvents: string[] = [];
    const adapter = createNodeHubListenAdapter((event) => adapterEvents.push(event.type));
    let acceptedIdentity: Readonly<{ readonly peerInstanceId: string }> | undefined;
    let received: Uint8Array | undefined;
    const listener = await adapter.listen({
      host: '127.0.0.1',
      port: 0,
      path: '/replication',
      authenticate: async (token) => token === 'center-token'
        ? { peerInstanceId: 'center-peer' }
        : undefined,
      accept: (transport, identity) => {
        acceptedIdentity = identity;
        transport.onMessage((bytes) => {
          received = bytes;
        });
      },
    });
    if (listener.port === undefined) throw new Error('Node listener did not expose its bound port');

    const outcome = await wsUpgrade({
      port: listener.port,
      headers: { Authorization: 'Bearer center-token' },
    });
    expect(outcome.status).toBe(101);
    outcome.ws?.sendBinary(new Uint8Array([1, 2, 3]));
    await sleep(25);

    expect(acceptedIdentity).toEqual({ peerInstanceId: 'center-peer' });
    expect(received).toEqual(new Uint8Array([1, 2, 3]));
    expect(adapterEvents).toEqual(['upgrade-authenticated', 'transport-accepted']);
    outcome.ws?.destroy();
    await sleep(25);
    expect(adapterEvents).toEqual(['upgrade-authenticated', 'transport-accepted', 'transport-closed']);
    await listener.close();
  });

  it('closes a never-settling authentication request with 503 during shutdown', async () => {
    const auth = deferred<{ readonly peerInstanceId: string } | undefined>();
    let accepted = 0;
    const server = await startHubWsServer({
      host: '127.0.0.1',
      port: 0,
      path: '/replication',
      authenticate: () => auth.promise,
      accept: () => {
        accepted += 1;
      },
    });
    const response = wsUpgrade({
      port: server.port,
      headers: { Authorization: 'Bearer delayed-token' },
      handshakeTimeoutMs: 2_000,
    }).then(
      (value) => value,
      () => undefined,
    );

    await sleep(25);
    await server.close();

    const outcome = await response;
    expect(outcome?.status).toBe(503);
    expect(accepted).toBe(0);
  });

  it('does not upgrade a socket that disconnects while authentication is pending', async () => {
    const auth = deferred<{ readonly peerInstanceId: string } | undefined>();
    let accepted = 0;
    const server = await startHubWsServer({
      host: '127.0.0.1',
      port: 0,
      path: '/replication',
      authenticate: () => auth.promise,
      accept: () => {
        accepted += 1;
      },
    });
    const socket = openUpgradeRequest(server.port, 'delayed-token');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    await sleep(25);
    socket.destroy();
    await waitForSocketClose(socket);
    await sleep(25);

    auth.resolve({ peerInstanceId: 'peer-alpha' });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(accepted).toBe(0);
    await server.close();
  });
});
