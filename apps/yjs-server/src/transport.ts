/**
 * `apps/yjs-server` 真实 WebSocket adapter —— issue #164 切片 9 交付。
 *
 * 权威：docs/protocols/instance-replication-v1.md §17（生产适配器必须暴露三面：
 * bufferedAmount / ping / onPong；缺面 = 配置错误，非运行时降级）+ §18（WS ping/pong
 * 活性）+ 协议不变量 1（一 WS binary message = 一 frame；text frame = 帧级违约）。
 *
 * 设计：wiki/raw/task_issue-164-on-docs-phase-5-websocket-replication_design.md §3
 * （SA2 R1 PASS 后冻结：§3.1 WebSocketLike / §3.2 createWebSocketAdapter / §3.3
 * assertProductionTransportFaces）。
 */
import type { DuplexTransport } from '@nomicore/ws-replication';

/** ws.WebSocket 的最小结构面（SA6 冻结：bufferedAmount/readyState/send/close/ping/
 *  on/off + message/close/pong/error 事件）。事件 listener 全部按事件名重载声明
 *  （method 语法——对 FakeSocket（listener: never 形态）与 @types/ws（per-event
 *  重载）双向结构兼容，双端 bivariance 成立；TF1 直证）。 */
export interface WebSocketLike {
  readonly bufferedAmount: number;
  readonly readyState: number; // 0 CONNECTING / 1 OPEN / 2 CLOSING / 3 CLOSED
  send(data: Uint8Array, options?: Readonly<{ readonly binary: boolean }>): void;
  close(code?: number, reason?: string): void;
  ping(data?: Uint8Array): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): void;
  on(event: 'close', listener: (code: number, reason: string) => void): void;
  on(event: 'pong', listener: (data: unknown) => void): void;
  on(event: 'error', listener: (error: unknown) => void): void;
  off(event: 'message', listener: (data: unknown, isBinary: boolean) => void): void;
  off(event: 'close', listener: (code: number, reason: string) => void): void;
  off(event: 'pong', listener: (data: unknown) => void): void;
  off(event: 'error', listener: (error: unknown) => void): void;
}

const READY_STATE_OPEN = 1;
const READY_STATE_CLOSING = 2;

/**
 * ws.Socket → DuplexTransport 适配（发送侧显式 { binary: true }：协议不变量 1 的
 * 发送宣言）。
 *
 * 状态机要点（SA2 R1 约束 5，逐锚核对 TF1）：
 * - 'error' 必须最先订阅（Node EventEmitter 语义：'error' 无监听即抛进程级异常）；
 *   只吸收 + 标记，收口统一由 'close' 承接（外部网络故障 = 正当降级，绝不让进程崩）；
 * - text 帧 / 不明 binary 载体形态 → close(1002) + 零投递（帧级违约，协议不变量 1）；
 * - ping 不做 closed 门（TF1 在 text 拒绝后仍断言 pingData 可写——真 socket 上竞态
 *   抛错吸收并标记收口）；
 * - send 竞态（对端同 tick 断连）= 外部故障 → 吸收并标记收口，不向包内抛异常；
 * - close 仅 readyState === OPEN 时调 socket.close（确定性幂等）；'close' 事件到达
 *   时 onClose 恰一次投递（closeNotified 守卫，TF1 直证）；
 * - onClose 不补发声明（订阅晚于 close 事件 = 不回放——与包内 dormant 形态对齐）。
 */
export function createWebSocketAdapter(socket: WebSocketLike): DuplexTransport {
  let ownClosed = false; // 本端主动收口标志
  let closeNotified = false; // onClose 恰一次投递守卫
  const messageListeners = new Set<(bytes: Uint8Array) => void>();
  const closeListeners = new Set<(info: Readonly<{ code: number; reason: string }>) => void>();
  const pongListeners = new Set<() => void>();

  socket.on('error', () => {
    ownClosed = true;
  });

  socket.on('close', (code, reason) => {
    ownClosed = true;
    if (closeNotified) return;
    closeNotified = true;
    for (const listener of [...closeListeners]) listener({ code, reason });
  });

  socket.on('message', (data, isBinary) => {
    if (ownClosed) return; // 收口后零投递
    if (isBinary === false) {
      // text frame = 帧级违约（协议不变量 1 反之亦然）：close(1002) + 零投递（TF1）
      closeTransport(1002, 'text-frame-rejected');
      return;
    }
    const bytes = toBytes(data); // Buffer|ArrayBuffer|Buffer[] → Uint8Array
    if (bytes === undefined) {
      // 不明 binary 载体形态 = 违约（loud，不静默吞）
      closeTransport(1002, 'binary-decode-failed');
      return;
    }
    for (const listener of [...messageListeners]) listener(bytes);
  });

  const closeTransport = (code?: number, reason?: string): void => {
    ownClosed = true;
    if (socket.readyState === READY_STATE_OPEN) {
      // 确定性幂等：非 OPEN 不再调用；兜异常唯一来源是竞态断连（外部故障降级路径）
      try {
        socket.close(code, reason);
      } catch {
        /* ws 对非 OPEN close 本就静默；此处兜异常唯一来源是竞态断连（外部故障降级路径） */
      }
    }
  };

  const transport: DuplexTransport = {
    // R3：背压观察点（§17 L492）。实时投影，非快照。
    get bufferedAmount(): number {
      return socket.bufferedAmount;
    },
    get closed(): boolean {
      return ownClosed || socket.readyState >= READY_STATE_CLOSING;
    },

    // 发送：byte 等同透传（TF1：socket.sentBinary[0] === frame）。发送竞态 =
    // 外部故障 → 吸收并标记收口，不向 OutboundQueue/ConnectionSender 抛异常。
    send(bytes) {
      if (transport.closed) return;
      try {
        socket.send(bytes, { binary: true });
      } catch {
        ownClosed = true;
      }
    },

    // 收口：code/reason 透传（TF1：close(1008,'upgrade-unauthorized') 逐字落
    // socket.closeCalls）。幂等：重复调用零副作用；'close' 事件到达时 onClose 恰一次。
    close(code, reason) {
      closeTransport(code, reason);
    },

    // R4：WS 级活性面。liveness 循环以无参调用（socket.ping() 空载荷）；ping 不做
    // closed 门（TF1 锚）。真 socket 上竞态抛错吸收并标记收口。
    ping(data) {
      try {
        socket.ping(data);
      } catch {
        ownClosed = true;
      }
    },

    onMessage(listener) {
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
      };
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },

    // onPong：忽略 pong 载荷（liveness 契约是 () => void；TF1 计数直证）。
    onPong(listener) {
      const handler = (): void => {
        listener();
      };
      socket.on('pong', handler);
      return () => {
        socket.off('pong', handler);
      };
    },
  };
  return transport;
}

/** RawData(unknown) → Uint8Array | undefined（undefined = 不明形态）。
 *  Buffer ⊂ Uint8Array（nodebuffer 缺省直通）；ArrayBuffer 视图化；Buffer[] 碎片
 *  拼接（ws 分片接收形态）。TF1 FakeSocket 直发 Uint8Array 走首分支。 */
function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    const parts = data as readonly unknown[];
    let total = 0;
    for (const part of parts) {
      if (!(part instanceof Uint8Array)) return undefined;
      total += part.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      const bytes = part as Uint8Array;
      out.set(bytes, offset);
      offset += bytes.byteLength;
    }
    return out;
  }
  return undefined;
}

/** §17「生产 Adapter 必须暴露三面；组合根在装配期对缺面做响亮断言」——
 *  缺任一面 = 配置错误（TypeError），非运行时降级。message 列全部缺面名
 *  （TF3 断言含 'bufferedAmount'）。
 *  只断言三可选生产面；五个必选面（send/close/closed/onMessage/onClose）由 TS
 *  类型静态承载，运行时缺失会在首次调用处自然炸响（TF2 的 bufferedOnly 对象五必选
 *  面俱全、缺 ping/onPong 仍须 throw——断言范围恰好覆盖，不多不少）。 */
export function assertProductionTransportFaces(transport: DuplexTransport): void {
  if (transport === null || typeof transport !== 'object') {
    throw new TypeError('transport 必须是对象（DuplexTransport 形状）');
  }
  const missing: string[] = [];
  if (typeof (transport as { readonly bufferedAmount?: unknown }).bufferedAmount !== 'number') {
    missing.push('bufferedAmount');
  }
  if (typeof (transport as { readonly ping?: unknown }).ping !== 'function') missing.push('ping');
  if (typeof (transport as { readonly onPong?: unknown }).onPong !== 'function') missing.push('onPong');
  if (missing.length > 0) {
    throw new TypeError(
      `transport missing required production faces: ${missing.join(', ')}` +
        '（§17：缺面 = 配置错误，非运行时降级）',
    );
  }
}
