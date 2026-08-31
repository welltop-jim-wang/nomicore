import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createNodePeerDial } from '../src/index.js';
import { createWebSocketAdapter } from '../src/transport.js';
import { wrapWs } from '../src/transport/ws-server.js';

const sockets: WebSocket[] = [];
const servers: WebSocketServer[] = [];

async function closeAll(): Promise<void> {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(closeAll);

describe('production WebSocket transport liveness seam', () => {
  it('generic adapter drops an immediate Peer HELLO while Node WebSocket is CONNECTING', async () => {
    const http = createServer();
    const server = new WebSocketServer({ server: http });
    servers.push(server);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (address === null || typeof address === 'string') throw new Error('missing server address');

    let received = false;
    server.once('connection', (socket) => {
      sockets.push(socket);
      socket.once('message', () => {
        received = true;
      });
    });
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    sockets.push(client);
    const transport = createWebSocketAdapter(client as unknown as Parameters<typeof createWebSocketAdapter>[0]);
    transport.send(Uint8Array.from([1, 2, 3]));
    await new Promise<void>((resolve) => client.once('open', resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(received).toBe(false);
    http.close();
  });

  it('official Node Peer dial flushes an immediate HELLO after WebSocket opens', async () => {
    const http = createServer();
    const server = new WebSocketServer({ server: http });
    servers.push(server);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (address === null || typeof address === 'string') throw new Error('missing server address');

    const received = new Promise<Uint8Array>((resolve) => {
      server.once('connection', (socket) => {
        sockets.push(socket);
        socket.once('message', (data) => resolve(new Uint8Array(data as Buffer)));
      });
    });
    const dial = createNodePeerDial(`ws://127.0.0.1:${address.port}`, 'test-token');
    const transport = dial();
    const hello = Uint8Array.from([4, 5, 6]);
    transport.send(hello);

    await expect(received).resolves.toEqual(hello);
    transport.close();
    http.close();
  });

  it('passes the byte-exact pong echo payload through DuplexTransport.onPong', async () => {
    const http = createServer();
    const server = new WebSocketServer({ server: http });
    servers.push(server);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (address === null || typeof address === 'string') throw new Error('missing server address');

    const accepted = new Promise<WebSocket>((resolve) => server.once('connection', resolve));
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    sockets.push(client);
    const peer = await accepted;
    sockets.push(peer);
    await new Promise<void>((resolve) => client.once('open', resolve));

    const transport = wrapWs(client);
    const credential = Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 253]);
    const pong = new Promise<Uint8Array | undefined>((resolve) => transport.onPong?.(resolve));
    transport.ping?.(credential);

    await expect(pong).resolves.toEqual(credential);
    http.close();
  });
});
