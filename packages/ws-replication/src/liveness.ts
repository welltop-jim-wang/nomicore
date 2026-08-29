/**
 * liveness —— WS 级 ping/pong 活性循环（协议 L40「活性检测只使用 WebSocket ping/pong。
 * 协议不定义业务 PING/PONG frame」+ §18 L518-520）。
 *
 * 仅当 transport 提供 `ping` 与 `onPong` 两个可选面时武装（缺面 → dormant，零 timer）；
 * 周期 ping → pong 超时 → onPongTimeout（hub: close(1001)；peer: onTemporaryFailure）。
 */
import type { ReplicationTimer } from './types.js';

export interface LivenessDeps {
  readonly timer: ReplicationTimer;
  readonly pingIntervalMs: number;
  readonly pongTimeoutMs: number;
  readonly ping: (data?: Uint8Array) => void;
  readonly onPong: (listener: () => void) => () => void;
  /** pong 超时（活性失联收口）。 */
  readonly onPongTimeout: () => void;
}

/** 启动活性循环；返回停用函数（收口/重拨/stop 时必须调用——N1 纪律）。 */
export function startLiveness(deps: LivenessDeps): () => void {
  let stopped = false;
  let pingHandle: unknown | undefined;
  let pongHandle: unknown | undefined;
  const offPong = deps.onPong(() => {
    if (pongHandle !== undefined) {
      deps.timer.clearTimeout(pongHandle);
      pongHandle = undefined;
    }
  });
  const loop = (): void => {
    if (stopped) return;
    deps.ping();
    pongHandle = deps.timer.setTimeout(() => {
      pongHandle = undefined;
      if (!stopped) deps.onPongTimeout();
    }, deps.pongTimeoutMs);
    pingHandle = deps.timer.setTimeout(loop, deps.pingIntervalMs);
  };
  pingHandle = deps.timer.setTimeout(loop, deps.pingIntervalMs);
  return () => {
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
    offPong();
  };
}
