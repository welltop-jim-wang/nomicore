/**
 * `apps/yjs-server` 组合根 —— issue #164 切片 9 交付（ADR-0010 L175 的最小窄面）。
 *
 * 权威链：issue #164 → docs/protocols/instance-replication-v1.md §2（Upgrade 认证：
 * Bearer token 在 HTTP Upgrade 前验证，失败返回 HTTP 401/403，不建立 WebSocket）
 * /§6.1（instanceId 文法）/§17（生产三面）/§21（停机顺序）→ ADR-0010 L165-182 →
 * docs/phases/phase-5-websocket-replication.md §9（GOAWAY 归属裁决）。
 *
 * 设计：wiki/raw/task_issue-164-on-docs-phase-5-websocket-replication_design.md §4
 * （SA2 R1 PASS，十条就绪约束照抄：A1 runLoud 单一逃逸机制 / A2 pre-auth 封顶 /
 * A5 同步 throw 折叠 403，见 §4.4(d)）。
 *
 * 边界：本文件是纯宿主接线层——零协议逻辑（HELLO/OPEN/bootstrap/reconcile/背压/
 * 活性/GOAWAY drain 全部归 @nomicore/ws-replication）；401/403/503 裁决权在组合根，
 * 101 后一切归包。
 */
import * as http from 'node:http';
import type * as net from 'node:net';
import type * as stream from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  createHubReplication,
  DEFAULT_REPLICATION_LIMITS,
  DEFAULT_REPLICATION_TIMEOUTS,
  type DuplexTransport,
  type HubReplication,
  type NamespaceAuthorizer,
  type PeerTokenVerifier,
  type ReplicationLimits,
  type ReplicationTimeouts,
  type ReplicationTimer,
} from '@nomicore/ws-replication';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';
import {
  assertProductionTransportFaces,
  createWebSocketAdapter,
  type WebSocketLike,
} from './transport.js';

export { assertProductionTransportFaces, createWebSocketAdapter } from './transport.js';
export type { WebSocketLike } from './transport.js';

// Preserve the deployable app's public API introduced on the updated base.
export { parseAppConfig, ConfigValidationError, INSTANCE_ID_PATTERN, NAMESPACE_ID_PATTERN } from './config.ts';
export type {
  AppConfig,
  AuthorizationEntry,
  HubConfig,
  PeerConfig,
  PersistenceConfig,
  ProvisionEntry,
} from './config.ts';
export { createNomicoreApp } from './app.ts';
export type { CreateNomicoreAppOptions, NomicoreApp } from './app.ts';
export { createHubReplicationPlugin, NODE_TIMER_BRIDGE } from './replication/hub-plugin.ts';
export type { HubReplicationPluginConfig } from './replication/hub-plugin.ts';
export { createPeerReplicationPlugin } from './replication/peer-plugin.ts';
export type { PeerReplicationPluginConfig } from './replication/peer-plugin.ts';
export { acquireRootLock, createStdoutEventSink, ROOT_LOCK_FILE_NAME, STABLE_OP_ERROR_CODES } from './lifecycle.ts';
export type { EventSink, RootLockHandle } from './lifecycle.ts';

// ─────────────────────────────────────────────────────────────────────────
// 公共面（SA6 冻结形状 + exactOptionalPropertyTypes 细则：可选属性一律声明
// `| undefined` 联合——SA6 测试显式传 `limits: undefined`；向下传包时用条件展开）。
// ─────────────────────────────────────────────────────────────────────────

export interface YjsHubServerConfig {
  readonly role: 'hub';
  readonly instanceId: string;
  readonly listen: Readonly<{ readonly host?: string | undefined; readonly port: number }>;
  readonly verifyToken: PeerTokenVerifier;
  readonly authorize: NamespaceAuthorizer;
  readonly registry: NamespaceRegistry;
  readonly limits?: Readonly<Partial<ReplicationLimits>> | undefined;
  readonly timeouts?: Readonly<Partial<ReplicationTimeouts>> | undefined;
  readonly transportFactory?: ((socket: WebSocketLike) => DuplexTransport) | undefined;
  readonly alert?: ((message: string) => void) | undefined;
}

export interface YjsHubServer {
  start(): Promise<Readonly<{ readonly host: string; readonly port: number }>>;
  close(): Promise<void>;
}

export function createYjsHubServer(config: YjsHubServerConfig): YjsHubServer {
  return new YjsHubServerImpl(config);
}

/** 冻结 Upgrade 路径（SA6 harness UPGRADE_PATH）。 */
const UPGRADE_PATH = '/replication';

/** 生产时源（组合根 = Timer capability 提供方，ADR-0010 L175；包内零原生 timer 保持）。 */
const PRODUCTION_TIMER: ReplicationTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

type PreauthOutcome =
  | Readonly<{
      kind: 'verdict';
      v: Readonly<{ ok: true; instanceId: string }> | Readonly<{ ok: false }>;
    }>
  | Readonly<{ kind: 'verifier-threw' }>
  | Readonly<{ kind: 'timeout' }>;

class YjsHubServerImpl implements YjsHubServer {
  private readonly timer: ReplicationTimer = PRODUCTION_TIMER;
  private readonly resolvedTimeouts: Readonly<ReplicationTimeouts>;
  private readonly maxFrameBytes: number;
  private readonly hub: HubReplication;
  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private readonly sockets = new Set<net.Socket>();

  private started = false;
  private closed = false;
  /** 相位 1 挂载点（listen 窗口）：'error' → reject start()；摘除后运行期 'error' 走告警。 */
  private pendingStart: { readonly reject: (err: Error) => void } | undefined = undefined;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly config: YjsHubServerConfig) {
    // §4.2 装配期校验（单一权威，不重复实现）：registry.shutdown 是组合根私有依赖；
    // instanceId/verifyToken/authorize 文法与形状由紧随其后的 createHubReplication
    // → validateHubOptions 在同一切段权威校验并抛 TypeError。
    validateConfig(config);
    this.resolvedTimeouts = {
      ...DEFAULT_REPLICATION_TIMEOUTS,
      ...(config.timeouts ?? {}),
    };
    this.maxFrameBytes = {
      ...DEFAULT_REPLICATION_LIMITS,
      ...(config.limits ?? {}),
    }.maxFrameBytes;
    this.hub = createHubReplication({
      instanceId: config.instanceId,
      registry: config.registry,
      authorize: config.authorize,
      timer: this.timer,
      verifyToken: config.verifyToken,
      ...(config.limits !== undefined ? { limits: config.limits } : {}),
      ...(config.timeouts !== undefined ? { timeouts: config.timeouts } : {}),
    });
    // 非升级普通 HTTP 请求 → 404 占位（REST 管理面非本票 Scope；apps/AGENTS.md 最小面）
    this.httpServer = http.createServer((_req, res) => {
      res.writeHead(404, { 'content-length': '0' });
      res.end();
    });
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: this.maxFrameBytes,
    });

    // §4.3 error 处理三相位单点（构造期挂一次持久订阅，零 once 残留）：
    // 相位 1 = listen 窗口（reject start）；相位 2 = 运行期（告警通道；同步
    // EventEmitter 上下文，缺省 alert 的 throw 沿 emit 栈天然成 uncaughtException）。
    this.httpServer.on('error', (err) => {
      if (this.pendingStart !== undefined) {
        const { reject } = this.pendingStart;
        this.pendingStart = undefined;
        this.started = false; // R1/A4(a)：失败复位——实例可重试，二次 start() 报真实根因
        reject(err);
      } else {
        this.notify(`YJS_HUB_SERVER_HTTP_ERROR: ${String(err)}`);
      }
    });
    // R1/A4(b)：wss 自身 'error' 必须订阅（EventEmitter 'error' 无监听 = 进程崩溃；D14）
    this.wss.on('error', (err) => {
      this.notify(`YJS_HUB_SERVER_WSS_ERROR: ${String(err)}`);
    });
    // socket 登记（close 清扫依据；'connection' 事件先于 'upgrade' 必然发生）
    this.httpServer.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => {
        this.sockets.delete(socket);
      });
    });
    this.httpServer.on('upgrade', (req, socket, head) => {
      // R1/A1：外层兜底 catch 只可能接到「本方法契约外 reject」= 编程缺陷——
      // 外部输入路径（401/403/404/503）全部就地 respondHttp + resolve，永不 reject。
      // 处置 = 清理 + escalate 原样转投进程级（异常身份零改写、零吞）。
      void this.handleUpgrade(req, socket, head).catch((err) => {
        try {
          socket.destroy();
        } catch {
          /* 已亡 */
        }
        this.escalate(err);
      });
    });
  }

  // ─────────────────────────── start / close ───────────────────────────

  async start(): Promise<Readonly<{ host: string; port: number }>> {
    if (this.closed) {
      throw new Error('YJS_HUB_SERVER_CLOSED: server 已 close，不可 start');
    }
    if (this.started) {
      throw new Error('YJS_HUB_SERVER_STARTED: start() 非幂等，禁止重复调用');
    }
    this.started = true;
    return await new Promise((resolve, reject) => {
      this.pendingStart = { reject }; // 相位 1 挂载（listen 成功即摘）
      this.httpServer.listen(this.config.listen.port, this.config.listen.host, () => {
        this.pendingStart = undefined; // 摘除：后续 'error' 全走相位 2
        const addr = this.httpServer.address();
        if (addr === null || typeof addr === 'string') {
          // 理论不可达（TCP listen）；防御收窄
          this.started = false;
          reject(new Error('YJS_HUB_SERVER_ADDRESS: 不支持的非 TCP 监听地址'));
          return;
        }
        resolve({ host: addr.address, port: addr.port }); // port 0 → OS 实际分配值
      });
    });
  }

  // §4.6 §21 停机编排（切片 9 只编排，GOAWAY 归包——phase §9 裁决）：
  // closed 先置位 → ① httpServer.close（新 TCP 连接 ECONNREFUSED——FS6 refused 断言）
  // → ②-③ await hub.close()（GOAWAY/drain/Runtime barrier 包语义）
  // → 残留 socket 清扫 destroy（httpClosed 不悬挂兜底）
  // → wss.close()（noServer 形态卫生性）→ ④ registry.shutdown()（幂等 same-Promise；
  //   失败响亮上抛，此时连接/端口清理已完成，失败面最小）→ await httpClosed。
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise; // 幂等（same Promise）
    this.closed = true;
    this.closePromise = (async () => {
      const httpClosed = new Promise<void>((resolve) => {
        this.httpServer.close(() => resolve());
      });
      await this.hub.close();
      for (const socket of [...this.sockets]) {
        try {
          socket.destroy();
        } catch {
          /* 已亡 */
        }
      }
      this.wss.close();
      await this.config.registry.shutdown();
      await httpClosed;
    })();
    return this.closePromise;
  }

  // ─────────────────────── Upgrade 路由（§4.4）───────────────────────

  private async handleUpgrade(
    req: http.IncomingMessage,
    socket: stream.Duplex,
    head: Buffer,
  ): Promise<void> {
    // (a) 生命周期门：停机中 → 503（不建立 WebSocket）
    if (this.closed) {
      this.respondHttp(socket, 503, 'Service Unavailable');
      return;
    }
    // (b) 路径门：非 /replication（含畸形 URL）→ 404。畸形 URL 是外部输入 →
    //     干净拒绝（正当降级），绝不 notify/崩溃。
    if (safePathname(req.url) !== UPGRADE_PATH) {
      this.respondHttp(socket, 404, 'Not Found');
      return;
    }
    // (c) 凭据门（§2：升级前验证）：缺失/非 Bearer/空 token → 401，绝不 101
    const token = extractBearerToken(req.headers.authorization);
    if (token === undefined) {
      this.respondHttp(socket, 401, 'Unauthorized');
      return;
    }
    // (d) 验证门（R1/A2 甲案 + R1/A5 强制）：pre-auth 等待封顶——复用
    //     timeouts.helloTimeoutMs（零新 knob；与包内 accept 门 3 同源同值同一
    //     verifier 第二层消费对称设界）。
    //     A5（SA2 §R1.3 约束 2）：verifyToken 的【调用求值】包入 promise
    //     executor——同步 throw（非 async 宿主 verifier）同样折入 rejection →
    //     下方 .then 折叠为 verifier-threw → 403；绝不逃逸到外层 .catch（那是
    //     远程崩溃向量）；async throw 由 .then 折叠分支覆盖（wrapper 永不 reject）。
    let preauthHandle: unknown; // 先声明（executor 同步武装时已可用）
    const verifierOutcome = new Promise<
      Readonly<{ ok: true; instanceId: string }> | Readonly<{ ok: false }>
    >((resolve) => {
      resolve(this.config.verifyToken(token));
    }).then(
      (v): PreauthOutcome => ({ kind: 'verdict', v }),
      (): PreauthOutcome => ({ kind: 'verifier-threw' }),
    );
    const preauth = await Promise.race([
      verifierOutcome,
      new Promise<PreauthOutcome>((resolveTimeout) => {
        preauthHandle = this.timer.setTimeout(
          () => resolveTimeout({ kind: 'timeout' }),
          this.resolvedTimeouts.helloTimeoutMs,
        );
      }),
    ]);
    this.timer.clearTimeout(preauthHandle); // 句柄必清（verdict 赢清未触发者；timeout 赢 no-op）
    if (preauth.kind === 'timeout') {
      // 悬挂是服务侧问题，绝不用 403 污染凭据语义（R1/A2 决策记录）
      this.respondHttp(socket, 503, 'Auth Timeout');
      return;
    }
    if (
      preauth.kind === 'verifier-threw' ||
      preauth.v === null ||
      typeof preauth.v !== 'object' ||
      preauth.v.ok !== true
    ) {
      this.respondHttp(socket, 403, 'Forbidden');
      return;
    }
    // 迟归不复活（镜像包内 authRejected 语义）：timeout 已收口后，verifier 晚到的
    // resolve/reject 只会落进已 settle 的 race wrapper——零消费者、零副作用、
    // 零 unhandledRejection（throw 已折为值）。
    // (e) 竞态复核：await 期间 close() 已发生 → 503（hub accept 门 0 也会拦，这里是第一层）
    if (this.closed) {
      this.respondHttp(socket, 503, 'Service Unavailable');
      return;
    }
    // (f) 101 路径：ws 完成 RFC 6455 握手 → 同步 cb 内完成装配断言与 accept 接线。
    //     R1/A1 关键接线：cb 经 runLoud 包装——wireConnection 内 notify 的缺省
    //     TypeError（或任何逃逸的宿主缺陷异常）由 runLoud 转 queueMicrotask-throw
    //     直达 uncaughtException 域，【不经本层 catch】（身份零改写、策略无关）。
    //     本层 catch 从此【专职 ws 内部握手防御】（外部输入畸形握手——Sec-WebSocket-*
    //     缺失/非法等）：兜底 destroy、零 notify、零吞 loud（cb 源异常到不了这里）。
    try {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.runLoud(() => this.wireConnection(ws, token));
      });
    } catch {
      try {
        socket.destroy();
      } catch {
        /* ws 对畸形握手自行 abortUpgrade；双保险 */
      }
    }
  }

  // ─────────────── 装配断言 + accept 接线（§4.5，TF3 承载）───────────────

  /**
   * wireConnection 全路径 totality（R1/A1 声明）：本函数自身【从不向调用方抛出】——
   * (1) 工厂 throw → 本地 catch；(2) 断言 throw → 本地 catch；(3) accept reject →
   * .then rejection 分支；safeClose* 双双吞二次异常；notify 的缺省 throw 是唯一
   * 逃逸源，由【唯一调用边界】§4.4(f) 的 runLoud 包装承接 → uncaughtException。
   * 清理先行不变式：每个 notify 调用点之前，transport 与真 socket 均已收口——
   * runLoud 转投的异常绝不携带未清理资源。
   */
  private wireConnection(ws: WebSocket, token: string): void {
    // (1) transport 装配（工厂错误 = 宿主配置错误 → 响亮，绝不带病入网）
    let transport: DuplexTransport;
    const factory = this.config.transportFactory ?? createWebSocketAdapter; // 缺省 = 真 adapter
    try {
      // P10 结构桥接：@types/ws 的 send/ping 参数面（RawData）与冻结 WebSocketLike
      // 面（Uint8Array）在方法 bivariance 下互不满足——单点 as 桥接（运行时行为不变）
      transport = factory(ws as unknown as WebSocketLike);
    } catch (err) {
      this.safeCloseSocket(ws, 1011, 'transport-factory-error'); // 清理先行
      this.notify(err instanceof Error ? err.message : String(err)); // 缺省 throw → 由
      return; // runLoud 边界转投
    }
    // (2) §17 生产三面装配断言：缺面 = 配置错误，非运行时降级
    try {
      assertProductionTransportFaces(transport);
    } catch (err) {
      // 先收口再告警（顺序固定）：transport 尽力关（工厂产物形状不可信，吞其二次
      // 异常——主异常已在手）；真 ws socket 必须关（TF3：memory transport 与真
      // socket 无关联，不关真 socket 客户端将永远悬挂——'响亮拒绝'必须包含连接收口）
      this.safeCloseTransport(transport, 1011, 'transport-faces-missing');
      this.safeCloseSocket(ws, 1011, 'transport-faces-missing');
      this.notify(err instanceof Error ? err.message : String(err)); // TF3 断言含 'bufferedAmount'
      return;
    }
    // (3) accept 接线：原始 token 透传 → 包内 verifyToken 二次消费（纵深防御，
    //     FS1 ≥2 次消费断言）。accept 返回 undefined = 包已按自身语义收口
    //    （hub-shutdown / missing-token / 早到帧超限…），组合根零额外动作。
    void this.hub.accept(transport, { token }).then(
      () => undefined,
      (err) => {
        // 包契约「accept 永不 reject」被打破 = 包缺陷：响亮 + 收口（绝不静默吞）
        this.safeCloseTransport(transport, 1011, 'accept-failed');
        this.runLoud(() => this.notify(`YJS_HUB_SERVER_ACCEPT_REJECTED: ${String(err)}`));
      },
    );
  }

  /**
   * R1/A1 单一逃逸机制（SA2 甲案采纳）——两个原语，同一语义：
   * ① escalate(err)：把【已在手的异常】原样投递进程级；
   * ② runLoud(f)：同步执行 f（通常内含 notify），逃逸异常经 ① 转投。
   * 共同保证（P14 实测承载）：异常身份零改写；绕开一切中间 catch（microtask
   * 全新栈，无人能截）；策略无关（uncaughtException 是同步异常域，先于且独立于
   * unhandledRejection 处理策略）。
   * 调用方不变式：转投前资源清理必须已完成（本设计所有 notify 调用点均遵循
   * 「清理先行」——见 wireConnection (1)/(2) 顺序）。
   */
  private escalate(err: unknown): void {
    queueMicrotask(() => {
      throw err;
    });
  }

  private runLoud(f: () => void): void {
    try {
      f();
    } catch (err) {
      this.escalate(err);
    }
  }

  /**
   * 告警通道（语义保留 + 边界纪律）：alert 在场 → 结构化告警（进程存活，逐连接
   * 拒绝——TF3 形态）；缺席 → 就地抛 TypeError（SA6 冻结语义「缺省 = 抛 TypeError」
   * 逐字兑现——throw 语义未被 A1 修订改变，改变的是【谁接住它】）。
   * R1/A1 边界纪律（硬约束，SA3 禁自创第三种）：
   * - 同步 EventEmitter 上下文（httpServer/wss 'error' 监听器）→ 直接调用 notify：
   *   缺省 throw 沿 emit 同步栈天然成为 uncaughtException（进程级，无需包装）；
   * - 异步/promise 上下文（upgrade cb、外层 .catch、accept rejection）→ 必须
   *   runLoud(() => notify(...))（执行体含告警）或 escalate(err)（异常已在手）：
   *   缺省 throw 被转投 uncaughtException 域。
   */
  private notify(message: string): void {
    if (this.config.alert !== undefined) {
      this.config.alert(message);
      return;
    }
    throw new TypeError(message);
  }

  private safeCloseSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      if (ws.readyState === 1) ws.close(code, reason);
    } catch {
      /* 已亡 */
    }
  }

  private safeCloseTransport(transport: DuplexTransport, code: number, reason: string): void {
    try {
      transport.close(code, reason);
    } catch {
      /* 工厂产物形状不可信——主告警在手 */
    }
  }

  private respondHttp(socket: stream.Duplex, status: number, reason: string): void {
    const line = `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
    try {
      socket.end(Buffer.from(line, 'latin1'));
    } catch {
      try {
        socket.destroy();
      } catch {
        /* 已亡 */
      }
    }
  }
}

// ─────────────────────────── 装配期校验（§4.2）───────────────────────────

function validateConfig(config: YjsHubServerConfig): void {
  if (config.role !== 'hub') {
    throw new TypeError('YJS_HUB_SERVER_ROLE: role 必须为 "hub"（切片 9 唯一支持角色）');
  }
  if (config.listen === null || typeof config.listen !== 'object') {
    throw new TypeError('YJS_HUB_SERVER_LISTEN: listen 必须是对象');
  }
  if (!Number.isInteger(config.listen.port) || config.listen.port < 0 || config.listen.port > 65535) {
    throw new TypeError('YJS_HUB_SERVER_LISTEN_PORT: port 必须是 0–65535 整数');
  }
  if (
    config.listen.host !== undefined &&
    (typeof config.listen.host !== 'string' || config.listen.host.length === 0)
  ) {
    throw new TypeError('YJS_HUB_SERVER_LISTEN_HOST: host 必须是非空字符串或省略');
  }
  if (
    config.registry === null ||
    typeof config.registry !== 'object' ||
    typeof config.registry.shutdown !== 'function'
  ) {
    throw new TypeError('YJS_HUB_SERVER_REGISTRY: registry.shutdown 必须是函数（§21 停机编排第 4 步依赖）');
  }
  if (config.transportFactory !== undefined && typeof config.transportFactory !== 'function') {
    throw new TypeError('YJS_HUB_SERVER_TRANSPORT_FACTORY: transportFactory 必须是函数');
  }
  if (config.alert !== undefined && typeof config.alert !== 'function') {
    throw new TypeError('YJS_HUB_SERVER_ALERT: alert 必须是函数');
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? undefined;
}

function safePathname(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}
