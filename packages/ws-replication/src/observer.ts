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
  HubConnectionState,
  HubNamespaceState,
  PeerConnectionState,
  PeerNamespaceState,
  ReplicationObserver,
  ReplicationObserverConnectionCode,
  ReplicationObserverEvent,
  ReplicationObserverNamespaceCode,
  ReplicationObserverSchemaRearmCode,
  UpdateSendFailureDetail,
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

/** namespace 域白名单（注册表键 + 内部码；运行期闭联合判据）。
 *  issue #287：ADR 0018 §3 的 re-arm 双码是 namespace-runtime `errors.ts` 注册表成员
 *  （peer apply 槽提交后段的 runtime fatal）——`schema-rearm-failed.code` 经此折叠，
 *  与 Runtime 侧产出面逐字一致（两码恒命中白名单，无折叠路径）。 */
const NAMESPACE_OBSERVER_CODES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(NAMESPACE_ERRORS),
  'IDENTITY_CHANGED',
  'NSRT-FATAL-SCHEMA-REARM-INVALID',
  'NSRT-FATAL-SCHEMA-REARM-INTERNAL',
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

/** issue #287：re-arm fatal 码白名单（ADR 0018 §3 双码——namespace-runtime `errors.ts`
 *  注册表成员）。取值面由 `satisfies ReplicationObserverSchemaRearmCode[]` 与本包事件
 *  类型逐值锁死：**新增码而漏改本函数 → 编译期红**（杜绝「事件 code 溢出闭合并对
 *  Runtime 事实说谎」的静默漂移）。 */
function isSchemaRearmCode(raw: string): raw is ReplicationObserverSchemaRearmCode {
  const whitelist = [
    'NSRT-FATAL-SCHEMA-REARM-INVALID',
    'NSRT-FATAL-SCHEMA-REARM-INTERNAL',
  ] satisfies ReplicationObserverSchemaRearmCode[];
  return (whitelist as readonly string[]).includes(raw);
}

/** issue #287：re-arm fatal 码 → `schema-rearm-failed.code` 闭联合取值；非白名单成员折叠
 *  `INTERNAL_ERROR`（namespace 域既有折叠成员——观测面绝不对 Runtime 事实说谎）。
 *
 *  唯一一处 `as`：`INTERNAL_ERROR` 属 namespace 域白名单（§23.2「未知码折叠规则」既有
 *  成员）而非本事件的双码闭联合——折叠分支的产出面是「namespace 域稳定码」这一更宽面
 *  的成员，事件字段类型是它的子集，故需一次显式断言（非收窄断言：不透传任何未经白名单
 *  的输入，只是把已注册的折叠成员放进子集类型）。
 *
 *  运行期：`code` 实参恒为本双码（Runtime `schemaRearm.code` 类型即闭联合）——兜底分支是
 *  结构性防御，不是可达路径。 */
export function stableSchemaRearmCode(raw: string): ReplicationObserverSchemaRearmCode {
  return isSchemaRearmCode(raw) ? raw : ('INTERNAL_ERROR' as ReplicationObserverSchemaRearmCode);
}

/** 条件附着展开（exactOptionalPropertyTypes 兼容）：connectionId 缺省 = 字段不存在
 *  （事件不发生携带 undefined 的字段——协议 §23 safe-field：connectionId 是受控标识，
 *  握手完成前无值即无字段）。 */
export function cidField(
  connectionId: string | undefined,
): Readonly<{ connectionId?: string }> {
  return connectionId === undefined ? {} : { connectionId };
}

/** issue #231：send 失败/超限丢弃事件的安全数值与状态上下文字段组（append-only）。
 *  采样口径（§23.1 登记）：updateBytes/maxUpdateBytes/queuedUpdateCount/
 *  queuedUpdateBytes/inFlightCount = 失败时刻（丢弃前）采样，取自通道侧明细；
 *  channelState/connectionState = 发射时刻投影（§23.4 决策落定后发射）；
 *  bufferedAmount 仅 adapter 暴露 transport.bufferedAmount 时存在
 *  （缺面/非法 = 字段缺失，非 0）。 */
export interface SendFailureContext {
  readonly updateBytes: number;
  readonly maxUpdateBytes: number;
  readonly channelState: PeerNamespaceState | HubNamespaceState;
  readonly connectionState: PeerConnectionState | HubConnectionState;
  readonly queuedUpdateCount: number;
  readonly queuedUpdateBytes: number;
  readonly inFlightCount: number;
  readonly bufferedAmount?: number;
}

/** 上下文字段组构造单点（hub/peer 两侧、resync-required/update-dropped 两事件同形
 *  ——消除镜像重复的唯一审计点；safe-field 深扫只认本函数产出的字段形状）。 */
export function sendFailureContext(
  detail: UpdateSendFailureDetail,
  channelState: PeerNamespaceState | HubNamespaceState,
  connectionState: PeerConnectionState | HubConnectionState,
  bufferedAmount: number | undefined,
): SendFailureContext {
  return {
    updateBytes: detail.updateBytes,
    maxUpdateBytes: detail.maxUpdateBytes,
    channelState,
    connectionState,
    queuedUpdateCount: detail.queuedUpdateCount,
    queuedUpdateBytes: detail.queuedUpdateBytes,
    inFlightCount: detail.inFlightCount,
    ...(bufferedAmount !== undefined ? { bufferedAmount } : {}),
  };
}

/**
 * 安全时源采样（SA4 B1）：观测时钟 `now()` 抛错视为「时源缺面」（dormant——与
 * 设计 §3.3「缺 clock = latency 字段缺失」同纪律），返回 undefined；绝不让 clock
 * 异常外溢到协议路径（状态/wire 序列/Runtime 写入零影响；零 unhandledRejection /
 * 零 uncaughtException——observer/clock seam 是观测面，不是业务失败面）。
 */
export function safeNow(read: () => number | undefined): number | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * issue #239：state vector 捕获安全折叠（clock-throw 同款纪律）——session 终态同步
 * throw（ReplicationSessionClosedError 等）属观测面异常 → undefined（效果字段组整组
 * 缺失），绝不外溢协议路径（§23.4 捕获纪律：只读、observer 门控、不进 sequencer 槽）。
 */
export function safeStateVector(read: () => Uint8Array): Uint8Array | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * issue #239：SV 逐字节相等（长度 + 逐位）。yjs `encodeStateVector` 编码 canonical
 * （writeStateVector 对 entries 显式排序后 varUint 写出）⇒ 字节相等 ⟺ 逻辑相等。
 */
export function stateVectorBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * issue #239：documented safe digest（§23.3 注册算法，注册即冻结）——双泳道
 * FNV-1a-32：泳道 A 正序、泳道 B 逆序扫描同一 raw 编码 state vector 字节；两泳道均
 * offset basis 2166136261、prime 16777619、模 2³²（`Math.imul(h ^ b, 16777619) >>> 0`）。
 * 输出 = 泳道 A 8 位小写 hex ∥ 泳道 B 8 位小写 hex，恒 16 字符（零填充）。纯函数、
 * 同步可算、Node/浏览器同构；用途 = 关联/相等判别（非保密，raw SV 字节仍属禁止项）。
 */
export function stateVectorSafeDigest(sv: Uint8Array): string {
  let forward = 2166136261;
  for (let i = 0; i < sv.byteLength; i += 1) {
    forward = Math.imul(forward ^ sv[i]!, 16777619) >>> 0;
  }
  let reverse = 2166136261;
  for (let i = sv.byteLength - 1; i >= 0; i -= 1) {
    reverse = Math.imul(reverse ^ sv[i]!, 16777619) >>> 0;
  }
  return `${forward.toString(16).padStart(8, '0')}${reverse.toString(16).padStart(8, '0')}`;
}
