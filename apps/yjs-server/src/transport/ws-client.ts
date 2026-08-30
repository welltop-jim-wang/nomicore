/**
 * Peer 侧 WebSocket 客户端拨号适配（设计 §3.3）：
 *
 * `dial = () => wrapWs(new WebSocket(hubUrl, { headers: { Authorization: 'Bearer ' + token } }))`。
 * token 值**原样透传**给 hub；hub 侧验证器是凭据的唯一点（本适配层零预检）。
 * ws 客户端必须显式悬挂 `error` 监听（否则 socket 错误以 uncaught exception
 * 击穿进程；包从 `close`/`pong` 事件观测失联）。
 */
import { WebSocket } from 'ws';
import type { DuplexTransport } from '@nomicore/ws-replication';
import { wrapWs } from './ws-server.ts';

/** 建立 peer 拨号闭包（per-connection WebSocket；每次 dial 全新连接）。 */
export function createPeerDial(hubUrl: string, token: string): () => DuplexTransport {
  return () => wrapWs(new WebSocket(hubUrl, { headers: { Authorization: `Bearer ${token}` } }));
}
