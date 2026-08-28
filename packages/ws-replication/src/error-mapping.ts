/**
 * error-mapping —— §11 三层映射单点：session / Persistence 事实 → wire ERROR code →
 * namespace 终态（含 R3/#2 围栏判别 + §12.2 one-shot 终结器合流）。
 *
 * 终态一律经 `lookupError('namespace', code).terminalState` 驱动（§11.2 单点）。
 */
import { lookupError, type TerminalState } from '@nomicore/replication-protocol';
import type { ReplicationSession, ReplicationSessionStatus } from '@nomicore/namespace-registry';

/** session 拒绝码 → wire 码（不含围栏判别——围栏优先于本表落码）。 */
export type RefusalCode =
  | 'NAMESPACE_LEASE_RELEASED'
  | 'REPLICATION_SESSION_CLOSED'
  | 'REPLICATION_EPOCH_CONFLICTED'
  | 'REPLICATION_RAW_UPDATE_INVALID'
  | 'REPLICATION_PROTECTED_FIELDS_CHANGED'
  | 'RUNTIME_WRITE_DISABLED';

/** hub 侧 runtime 事实 → 终局分类（§11.1 判别依据）。 */
export function degradedDiscriminator(
  runtime: Readonly<{
    lifecycle: string;
    fatal: Readonly<{ code: string; message: string }> | null;
  }> | null,
): 'persistence-degraded' | 'internal-error' {
  if (runtime === null) return 'internal-error';
  return runtime.lifecycle === 'ready' && runtime.fatal === null
    ? 'persistence-degraded'
    : 'internal-error';
}

/** session status 围栏判别（P-14）：state 非 open 或 epoch 漂移 → 已被 epoch fence。 */
export function fenceHit(status: Readonly<ReplicationSessionStatus>): boolean {
  return status.state !== 'open' || status.currentEpoch !== status.replicationEpoch;
}

/** wire code → namespace 终态（lookupError 单点驱动；未知 → 'failed' 防御）。 */
export function terminalStateOf(code: string): TerminalState {
  return lookupError('namespace', code)?.terminalState ?? 'failed';
}

/** TerminalState → 本包终局（needs-resync 非终态——wire ERROR 不可能携带该码，防御钳制）。 */
export function toFinalState(state: TerminalState): 'failed' | 'conflicted' | 'closed' {
  if (state === 'needs-resync') return 'failed';
  return state;
}

/**
 * apply/encode 语义结算单点：把 session 能力调用的 ok:false / 同步 throw / rejection
 * 收敛为稳定 wire 码或本地终局标记（R4/N-1 通用契约：零 unhandled rejection）。
 *
 * 返回：
 * - `{ kind: 'wire', code, terminalState }` —— 发送 namespace ERROR 并按终态收口；
 * - `{ kind: 'fence' }` —— 命中围栏，调用方走 §12.2 one-shot 终结器；
 * - `{ kind: 'local', terminalState }` —— 本地终局（零 wire 假码）。
 */
export type MappingOutcome =
  | Readonly<{ kind: 'wire'; code: string; terminalState: TerminalState }>
  | Readonly<{ kind: 'fence' }>
  | Readonly<{ kind: 'local'; terminalState: TerminalState }>;

export type MappingRole = 'hub' | 'peer';

export function mapSessionRefusal(
  refusalCode: RefusalCode,
  session: ReplicationSession | undefined,
  runtime: Readonly<{
    lifecycle: string;
    fatal: Readonly<{ code: string; message: string }> | null;
  }> | null,
  role: MappingRole,
): MappingOutcome {
  // 围栏判别先行（R3/#2；R4/N-1 扩适用域——一切 session 能力调用的异常/拒绝结算）
  if (session !== undefined) {
    try {
      const status = session.getStatus();
      if (fenceHit(status)) return { kind: 'fence' };
    } catch {
      // getStatus 是幂等纯读面；防御性兜底——读失败按围栏未命中处理
    }
  }
  switch (refusalCode) {
    case 'REPLICATION_RAW_UPDATE_INVALID':
      return { kind: 'wire', code: 'APPLY_FAILED', terminalState: 'failed' };
    case 'REPLICATION_PROTECTED_FIELDS_CHANGED':
      return { kind: 'wire', code: 'PROTECTED_FIELD_MUTATION', terminalState: 'failed' };
    case 'RUNTIME_WRITE_DISABLED': {
      if (role === 'hub' && degradedDiscriminator(runtime) === 'persistence-degraded') {
        return { kind: 'wire', code: 'PERSISTENCE_DEGRADED', terminalState: 'failed' };
      }
      // peer 侧 degraded 走 hub→peer bypass 不落此分支；落此分支即异常关闭域（§11.3）
      return { kind: 'wire', code: 'INTERNAL_ERROR', terminalState: 'failed' };
    }
    case 'NAMESPACE_LEASE_RELEASED':
    case 'REPLICATION_SESSION_CLOSED':
    case 'REPLICATION_EPOCH_CONFLICTED':
      // 防御保留（理论不可达——围栏/终态早已被上文收编）；通道已终局，收口优先
      return { kind: 'local', terminalState: 'failed' };
    default: {
      const never: never = refusalCode;
      void never;
      return { kind: 'local', terminalState: 'failed' };
    }
  }
}

/** 同步 throw（encode* 面）语义结算：围栏命中 → fence；closed → 本地终局；其余 → wire INTERNAL_ERROR。 */
export function mapEncodeThrow(
  session: ReplicationSession | undefined,
): MappingOutcome {
  if (session !== undefined) {
    try {
      const status = session.getStatus();
      if (fenceHit(status)) return { kind: 'fence' };
      if (status.state === 'closed') {
        return { kind: 'local', terminalState: 'failed' };
      }
    } catch {
      // 读失败 → 按内部错收口
    }
  }
  return { kind: 'wire', code: 'INTERNAL_ERROR', terminalState: 'failed' };
}

/** 通用 rejection 结算（applyRemoteUpdate 的 RuntimeWriteFatalError / 任意拒绝）。 */
export function mapRejection(
  session: ReplicationSession | undefined,
  runtime: Readonly<{
    lifecycle: string;
    fatal: Readonly<{ code: string; message: string }> | null;
  }> | null,
  role: MappingRole,
): MappingOutcome {
  // 先做围栏判别（能读到 status 时）——rejection 也可能发生在 fence 之后
  return mapSessionRefusal('RUNTIME_WRITE_DISABLED', session, runtime, role);
}
