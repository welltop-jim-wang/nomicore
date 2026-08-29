/**
 * observer —— 观测 seam 的隔离分发单点（§5.1）+ 稳定码白名单折叠（§3.2）。
 *
 * 纪律（设计 §5）：
 * - dispatch 首行短路：无 observer 零事件、零分配、零副作用（AC #3 / C8 零回归）；
 * - try/catch 静默隔离：诊断 sink 失败不是业务失败——绝不让 observer throw 改变
 *   协议状态、关闭分类或 Runtime 写入结果；
 * - 同步回调：返回值（含 Promise）被忽略。
 *
 * 稳定码（§4.3）：连接域 = 协议 §13.1 全 17 码（codec 注册表键，append-only 同源）
 * + 2 个本包登记内部码；namespace 域 = §13.2 全 20 码 + 1 个登记内部码。
 * 运行期把任意 string 折叠进闭联合：不匹配一律折叠 INTERNAL_ERROR（注册表既有
 * 成员，语义方向一致：未知即内部错）。协议行为零变化（折叠只影响事件字段取值）。
 *
 * 设计：wiki/raw/task_issue-177_design.md §3.2/§4.3/§5.1。
 */
import {
  CONNECTION_ERRORS,
  NAMESPACE_ERRORS,
} from '@nomicore/replication-protocol';
import type {
  ReplicationObserver,
  ReplicationObserverConnectionCode,
  ReplicationObserverEvent,
  ReplicationObserverNamespaceCode,
} from './types.js';

/** 隔离分发单点（与 namespace-registry/src/observer.ts:55-83 同款纪律）。 */
export function dispatchReplicationObserver(
  observer: ReplicationObserver | undefined,
  event: ReplicationObserverEvent,
): void {
  if (observer === undefined) return;
  try {
    observer(event);
  } catch {
    // AC #3：诊断 sink 失败不是业务失败——静默丢弃，绝不改变协议状态/关闭分类/写入结果。
  }
}

/** 连接域白名单（注册表键 + 内部码；运行期闭联合判据）。 */
const CONNECTION_OBSERVER_CODES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(CONNECTION_ERRORS),
  'PONG_TIMEOUT',
  'OUTBOUND_SEQUENCE_EXHAUSTED',
]);

/** namespace 域白名单（注册表键 + 内部码；运行期闭联合判据）。 */
const NAMESPACE_OBSERVER_CODES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(NAMESPACE_ERRORS),
  'IDENTITY_CHANGED',
]);

/** 任意 string（异常携带码）→ 连接域稳定码；未知折叠 INTERNAL_ERROR。 */
export function stableConnectionCode(raw: string): ReplicationObserverConnectionCode {
  return CONNECTION_OBSERVER_CODES.has(raw)
    ? (raw as ReplicationObserverConnectionCode)
    : 'INTERNAL_ERROR';
}

/** 任意 string（异常携带码）→ namespace 域稳定码；未知折叠 INTERNAL_ERROR。 */
export function stableNamespaceCode(raw: string): ReplicationObserverNamespaceCode {
  return NAMESPACE_OBSERVER_CODES.has(raw)
    ? (raw as ReplicationObserverNamespaceCode)
    : 'INTERNAL_ERROR';
}

/** 条件附着展开（exactOptionalPropertyTypes 兼容）：connectionId 缺省 = 字段不存在
 *  （事件不发生携带 undefined 的字段——协议 §23 safe-field：connectionId 是受控标识，
 *  握手完成前无值即无字段）。 */
export function cidField(
  connectionId: string | undefined,
): Readonly<{ connectionId?: string }> {
  return connectionId === undefined ? {} : { connectionId };
}
