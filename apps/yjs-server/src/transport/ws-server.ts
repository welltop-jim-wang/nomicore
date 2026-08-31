/**
 * Hub 侧真实 WebSocket 传输适配（设计 §3.3）：
 *
 *  - `node:http` 服务器：`GET /healthz` → 200，其余普通请求 → 404；
 *  - `WebSocketServer({noServer:true})` 经 `upgrade` 事件接管；路径 ≠
 *    `/replication` → upgrade 前 404；路径相符则由 composition root 提供的
 *    `authenticate` 单点验证 Bearer token，缺失/拒绝分别在 upgrade 前返回 401/403；
 *    成功产生的可信身份随 transport 交给 accept，绝不二次调用 verifier。
 *  - `wrapWs` 全成员对齐 `DuplexTransport`（5 必填 + 3 可选，ws 事件 1:1 适配）：
 *    一 WS binary message = 一 frame（协议不变量 1）。
 *
 * 安全纪律：`ws` socket 悬挂 `error` 监听（否则 socket 错误会以 uncaught
 * exception 击穿进程——错误面由包的 close 分类处理）。
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type {
  DuplexTransport,
  HubListenAdapter,
  HubListener,
  UpgradeIdentity,
} from '@nomicore/ws-replication';

/** 一 WS binary message = 一 frame：按协议不变量 1 交付独立 Uint8Array（拷贝，防池化）。 */
function toBytes(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data.slice(0));
  }
  if (Array.isArray(data)) {
    // ws 聚合帧（罕见）：拆分重组——frame 计数纪律仍为一 message 一 frame。
    let total = 0;
    for (const part of data) total += part.byteLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of data) {
      out.set(part instanceof Uint8Array ? part : new Uint8Array(part), offset);
      offset += part.byteLength;
    }
    return out;
  }
  return new Uint8Array(data); // Buffer/TypedArray view → 拷贝（独立普通 Uint8Array）
}

/**
 * `ws.WebSocket` → `DuplexTransport`（5 必填 + 3 可选全成员；设计 §3.3 / A3）。
 * `bufferedAmount` / `ping` / `onPong` 直接暴露 ws 原生面（背压观察点与
 * §18 活性面；生产 adapter 必须暴露）。
 *
 * ⚠️ 连接语义：Peer 侧 `dial()` 是**同步**闭包，包在 `dial()` 返回后立即发送
 * HELLO——而真实 `ws` 客户端是异步建连（readyState=CONNECTING 时 `send()` 抛
 * "WebSocket is not open"）。本适配层因此把 CONNECTING 期的 send 入队、`open`
 * 后冲刷（对包呈现「拨号即连通」语义；`closed` 在 CLOSE 前恒 false——包以
 * `onClose` 事件收口，连接失败/拒绝经 `'close'`(1006) 投影，触发包侧 backoff）。
 * Hub 侧 upgrade 完成即 OPEN，此队列为空闲路径（零影响）。
 */
export function wrapWs(ws: WebSocket): DuplexTransport {
  ws.on('error', () => {
    // 错误面由包经 close 分类收取；这里只阻止 uncaught exception 击穿进程。
  });
  let pending: Uint8Array[] = [];
  const flush = (): void => {
    while (pending.length > 0 && ws.readyState === WebSocket.OPEN) {
      const bytes = pending.shift();
      if (bytes !== undefined) ws.send(bytes);
    }
  };
  ws.on('open', flush);
  return {
    send(bytes: Uint8Array): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(bytes);
        return;
      }
      if (ws.readyState === WebSocket.CONNECTING) {
        pending.push(bytes); // 建连期缓冲：拨号即连通呈现（见上）
      }
      // CLOSING/CLOSED：静默丢弃——包侧 transport.closed 已判定收口，迟到帧零效果。
    },
    close(code?: number, reason?: string): void {
      pending = [];
      ws.close(code ?? 1000, reason ?? '');
    },
    get closed(): boolean {
      return ws.readyState === WebSocket.CLOSED;
    },
    onMessage(listener: (bytes: Uint8Array) => void): () => void {
      const handler = (data: RawData, isBinary: boolean) => {
        if (isBinary) listener(toBytes(data)); // 协议只消费 binary frames
      };
      ws.on('message', handler);
      return () => ws.off('message', handler);
    },
    onClose(listener: (info: Readonly<{ code: number; reason: string }>) => void): () => void {
      const handler = (code: number, reason: Buffer) => {
        listener({ code, reason: reason.toString('utf8') });
      };
      ws.on('close', handler);
      return () => ws.off('close', handler);
    },
    get bufferedAmount(): number {
      return ws.bufferedAmount;
    },
    ping(data?: Uint8Array): void {
      ws.ping(data);
    },
    onPong(listener: (payload?: Uint8Array) => void): () => void {
      const handler = (payload: Buffer) => listener(toBytes(payload));
      ws.on('pong', handler);
      return () => ws.off('pong', handler);
    },
  };
}

function extractBearer(authorizationHeader: string | undefined): string | undefined {
  if (typeof authorizationHeader !== 'string') return undefined;
  const match = /^Bearer[ \t]+([^\s]+)$/.exec(authorizationHeader);
  return match?.[1];
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed || !socket.writable || socket.writableEnded) return;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export interface HubWsServerOptions {
  readonly host: string;
  readonly port: number; // 0 = ephemeral（实际端口经返回对象读取）
  readonly path: string;
  readonly authenticate: (token: string) => Promise<UpgradeIdentity | undefined>;
  readonly accept: (transport: DuplexTransport, identity: UpgradeIdentity) => void;
}

export interface HubWsServer {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * 启动 hub 网络端点：`node:http` + `ws`(noServer) upgrade 适配。
 * `accept` 持 token（缺头 = `undefined`——`missing-token` 拒绝在包内完成）。
 */
export async function startHubWsServer(options: HubWsServerOptions): Promise<HubWsServer> {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok\n');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  });
  const wss = new WebSocketServer({ noServer: true });
  const pendingUpgrades = new Map<Duplex, () => void>();
  let closing = false;
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let disconnected = socket.destroyed;
    const markDisconnected = (): void => {
      disconnected = true;
    };
    socket.once('close', markDisconnected);
    socket.once('error', markDisconnected);
    const finish = (): void => {
      pendingUpgrades.delete(socket);
      socket.off('close', markDisconnected);
      socket.off('error', markDisconnected);
    };
    const abort = (): void => {
      disconnected = true;
      finish();
      rejectUpgrade(socket, 503, 'Service Unavailable');
    };
    pendingUpgrades.set(socket, abort);
    void (async () => {
      if (req.url !== options.path) {
        rejectUpgrade(socket, 404, 'Not Found');
        return;
      }
      const token = extractBearer(req.headers.authorization);
      if (token === undefined) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
      let identity: UpgradeIdentity | undefined;
      try {
        identity = await options.authenticate(token);
      } catch {
        identity = undefined;
      }
      if (identity === undefined) {
        if (!disconnected) rejectUpgrade(socket, 403, 'Forbidden');
        return;
      }
      if (closing || disconnected || socket.destroyed || !socket.writable) {
        if (!disconnected && !socket.destroyed) rejectUpgrade(socket, 503, 'Service Unavailable');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        options.accept(wrapWs(ws), identity);
      });
    })().catch(() => {
      socket.destroy();
    }).finally(finish);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : options.port;
  return {
    server,
    port,
    close: () => {
      closing = true;
      for (const abort of [...pendingUpgrades.values()]) abort();
      // 关闭 = 停止接纳（listening socket 立即关闭；新 upgrade/请求被拒）。
      // node http `server.close()` 的**回调**要等全部既有连接（含已升级交给 ws 的
      // socket）结束才触发——但那些连接由 `hub.close()` 的 GOAWAY→drain→deadline
      // 强制收口负责销毁；此处不等待回调（设计 §3.6 停机序：先停止接纳、后复制 drain）。
      server.close(() => {
        // 所有连接收口后的无害回调（不 await）。
      });
      return Promise.resolve();
    },
  };
}

/** Public Node HTTP + `ws` adapter for `createHubReplicationPlugin(..., { listen })`. */
export function createNodeHubListenAdapter(): HubListenAdapter {
  let active = false;
  return {
    async listen(options): Promise<HubListener> {
      if (active) throw new Error('hub listener already active');
      active = true;
      try {
        const listener = await startHubWsServer(options);
        let closed = false;
        return {
          ...(listener.port === undefined ? {} : { port: listener.port }),
          close: async (): Promise<void> => {
            if (closed) return;
            closed = true;
            try {
              await listener.close();
            } finally {
              active = false;
            }
          },
        };
      } catch (error) {
        active = false;
        throw error;
      }
    },
  };
}

/** Standalone composition-root wrapper retaining access to the active listener. */
export interface AppHubListenAdapter extends HubListenAdapter {
  readonly listener: HubListener | undefined;
}

export function createHubListenAdapter(): AppHubListenAdapter {
  const nodeAdapter = createNodeHubListenAdapter();
  let listener: HubListener | undefined;
  return {
    get listener(): HubListener | undefined {
      return listener;
    },
    async listen(options): Promise<HubListener> {
      if (listener !== undefined) throw new Error('hub listener already active');
      const activeListener = await nodeAdapter.listen(options);
      listener = {
        ...(activeListener.port === undefined ? {} : { port: activeListener.port }),
        close: async (): Promise<void> => {
          try {
            await activeListener.close();
          } finally {
            listener = undefined;
          }
        },
      };
      return listener;
    },
  };
}

/** 归一化 upgrade 路径（与部署文档一致）。 */
export const REPLICATION_UPGRADE_PATH = '/replication';
