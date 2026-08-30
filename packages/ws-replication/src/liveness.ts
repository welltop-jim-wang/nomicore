/**
 * liveness —— WS 级 ping/pong 活性循环（协议 L42「活性检测只使用 WebSocket ping/pong。
 * 协议不定义业务 PING/PONG frame」+ §18 L518-524）。
 *
 * 仅当 transport 提供 `ping` 与 `onPong` 两个可选面时武装（缺面 → dormant，零 timer）。
 * 周期 ping（每次携带 8 字节单调凭据）→ 仅凭据逐字节匹配的 pong 清超时 →
 * pong 超时 / 已关传输上 ping 抛错 → 先自停（清双 timer + 退订 pong 监听）再回调
 * onPongTimeout（hub: 1001 连接关闭；peer: 同步收口栈 + backoff）。
 */
import type { ReplicationTimer } from './types.js';

export interface LivenessDeps {
  readonly timer: ReplicationTimer;
  readonly pingIntervalMs: number;
  readonly pongTimeoutMs: number;
  readonly ping: (data?: Uint8Array) => void;
  /** seam 契约（issue #170 / §3）：监听器接收 pong 载荷（RFC 6455 §5.5.2 回显凭据）。 */
  readonly onPong: (listener: (payload?: Uint8Array) => void) => () => void;
  /** 活性失联（pong 超时，或已关传输上 ping 抛错）。回调时 liveness 已自停并退订。 */
  readonly onPongTimeout: () => void;
}

/** ping 关联凭据：8 字节大端单调计数。会话内严格单调 → 任何旧凭据不等于新在途凭据；
 *  8 字节 ≪ RFC 6455 §5.5 控制帧 125 字节载荷上限。 */
function encodeCredential(counter: bigint): Uint8Array {
  const payload = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i -= 1) {
    payload[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return payload;
}

/** 逐字节比对；载荷缺失（undefined）/长度不等/任一字节不等 → 不匹配（不静默放行）。 */
function credentialMatches(payload: Uint8Array | undefined, credential: Uint8Array): boolean {
  if (payload === undefined || payload.byteLength !== credential.byteLength) return false;
  for (let i = 0; i < credential.byteLength; i += 1) {
    if (payload[i] !== credential[i]) return false;
  }
  return true;
}

/** 启动活性循环；返回停用函数（收口/重拨/stop 必调——幂等）。 */
export function startLiveness(deps: LivenessDeps): () => void {
  let stopped = false;
  let pingHandle: unknown | undefined;
  let pongHandle: unknown | undefined;
  let counter = 0n; // 64-bit 凭据不受 Number.MAX_SAFE_INTEGER 精度限制；per-socket 隔离跨会话 pong
  let outstanding: Uint8Array | undefined;

  const stopInternal = (): void => {
    if (stopped) return;
    stopped = true;
    if (pingHandle !== undefined) {
      deps.timer.clearTimeout(pingHandle);
      pingHandle = undefined;
    }
    if (pongHandle !== undefined) {
      deps.timer.clearTimeout(pongHandle);
      pongHandle = undefined;
    }
    outstanding = undefined;
    offPong();
  };

  // R2 核心：仅当「有在途 ping 且 pong 载荷逐字节 == 在途凭据」才清超时。
  // 迟到（旧凭据）/ 重复（旧凭据二次投递）/ 未请求（从未发出的载荷）/ 空载荷 → 一律忽略。
  const offPong = deps.onPong((payload) => {
    if (stopped || pongHandle === undefined || outstanding === undefined) return;
    if (!credentialMatches(payload, outstanding)) return;
    deps.timer.clearTimeout(pongHandle);
    pongHandle = undefined;
    outstanding = undefined;
  });

  const loseLiveness = (): void => {
    stopInternal(); // I2：回调前自停——清下一 ping timer + 退订 pong 监听
    deps.onPongTimeout(); // 调用方在「已停活性、已退订」的栈上做连接收口
  };

  const loop = (): void => {
    if (stopped) return;
    counter = BigInt.asUintN(64, counter + 1n);
    outstanding = encodeCredential(counter);
    // 先武装 timeout，再发送 ping：测试/适配器允许 ping() 同步回显 pong；若先发送后
    // 武装，合法同步 pong 会因 pongHandle 尚未存在而被误判为 unsolicited，随后假超时。
    pongHandle = deps.timer.setTimeout(() => {
      pongHandle = undefined;
      if (!stopped) loseLiveness();
    }, deps.pongTimeoutMs);
    try {
      deps.ping(outstanding);
    } catch {
      // 已关/损坏 socket 上的 ping 抛错（ws 语义 `WebSocket is not open: readyState 3`）
      // = 活性已失。不得让异常逃出 timer 回调（生产 = 进程级未捕获异常）。
      loseLiveness();
      return;
    }
    if (!stopped) pingHandle = deps.timer.setTimeout(loop, deps.pingIntervalMs);
  };

  pingHandle = deps.timer.setTimeout(loop, deps.pingIntervalMs);
  return stopInternal;
}
