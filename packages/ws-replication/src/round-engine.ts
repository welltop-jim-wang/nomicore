/**
 * round-engine —— sync round 双侧共享引擎：Step1/Step2/Applied 记账 + 违例判定矩阵
 * （§9）。含错误 round / 重复控制帧 / 错序 → SYNC_STATE_VIOLATION（ns failed）。
 *
 * 编码调用点（Step1 sv / Step2 diff）与帧发送全部经宿主回调；宿主在异常（fence ×
 * 编码、codec 超限、围栏判别）时已按 error-mapping/§12.2 收编并通过抛出
 * {@link RoundAborted} 中止引擎——禁止异常穿透帧分发同步段（R4/N-1）。
 */
import type { ReplicationMessage } from '@nomicore/replication-protocol';
import type { RoundState } from './types.js';

/** 宿主已收编的异常哨兵（终态已确定；引擎停止推进）。 */
export class RoundAborted extends Error {
  constructor() {
    super('round aborted by host');
    this.name = 'RoundAborted';
  }
}

export interface RoundHost {
  readonly role: 'hub' | 'peer';
  /** 发送帧（连接层序列分配）；返回帧序。编码失败/收编 → throw RoundAborted。 */
  readonly send: (message: ReplicationMessage) => number;
  /** Step1 stateVector / Step2 diff 编码（失败收编 → throw RoundAborted）。 */
  readonly encode: (
    kind: 'stateVector' | 'diff',
    remoteStateVector: Uint8Array | undefined,
  ) => Uint8Array;
  /** Step2 diff 应用（含错误映射）。resolve 'ok' 表示已 apply 并已发 SYNC_APPLIED。 */
  readonly applyStep2: (update: Uint8Array, step2Sequence: number) => Promise<'ok' | 'aborted'>;
  /** 违例（SYNC_STATE_VIOLATION → ERROR + ns failed 终局）。 */
  readonly onViolation: (detail: string) => void;
  /** 本 round 双位为真（§9.1.6）：live（或按 pendingResync 再开 round）。 */
  readonly onRoundSettled: () => void;
}

export class RoundEngine {
  private state: RoundState = {
    currentRound: 0,
    hubStep1Received: false,
    hubStep1Seq: undefined,
    ownStep1Seq: undefined,
    ownStep2Seq: undefined,
    receivedStep2: false,
    remoteDiffAppliedLocally: false,
    localDiffAppliedByRemote: false,
  };
  private lastRound = 0;
  private settled = false;
  private liveFlag = false;
  private nsId = '';

  constructor(private readonly host: RoundHost) {}

  bind(namespaceId: string): void {
    this.nsId = namespaceId;
  }

  get currentRound(): number {
    return this.state.currentRound;
  }

  get hasActiveRound(): boolean {
    return this.state.currentRound !== 0;
  }

  /** 是否有**未结算**的活跃 round（结算后不再阻塞恢复 round 发起）。 */
  get running(): boolean {
    return this.state.currentRound !== 0 && !this.settled;
  }

  get wasLive(): boolean {
    return this.liveFlag;
  }

  /** round 完成时标记（用于恢复期判别「到达过 live」）。 */
  markLive(): void {
    this.liveFlag = true;
  }

  /** 开始一个新 round（peer 发起；roundId 由调用方持久计数器给出）。 */
  startRound(roundId: number): void {
    this.resetState(roundId);
    this.lastRound = Math.max(this.lastRound, roundId);
    const sv = this.host.encode('stateVector', undefined);
    const seq = this.host.send({
      kind: 'SYNC_STEP1',
      namespaceId: this.nsId,
      syncRoundId: roundId,
      stateVector: sv,
    });
    this.state.ownStep1Seq = seq;
  }

  /** 收 SYNC_STEP1（§9.1.2 时序；错误 round 矩阵见 §9.2）。 */
  onStep1(
    message: { syncRoundId: number; stateVector: Uint8Array; sequence: number },
  ): void {
    if (this.host.role === 'hub') {
      // hub 不自行开始 round；只接受严格更大的新 round（含同 round 重复 → 违例）
      if (message.syncRoundId <= this.lastRound) {
        this.host.onViolation(`duplicate-or-stale round ${message.syncRoundId}`);
        return;
      }
      this.resetState(message.syncRoundId);
      this.lastRound = message.syncRoundId;
      // 响应：本方 Step1（hub sv）→ 紧接着本方 Step2（响应对端 Step1）
      const sv = this.host.encode('stateVector', undefined);
      const seq = this.host.send({
        kind: 'SYNC_STEP1',
        namespaceId: this.nsId,
        syncRoundId: message.syncRoundId,
        stateVector: sv,
      });
      this.state.ownStep1Seq = seq;
      this.sendStep2(message.stateVector, message.sequence);
    } else {
      // peer：hub 的 Step1 是对 peer Step1 的合法响应帧
      if (
        !this.hasActiveRound ||
        message.syncRoundId !== this.state.currentRound ||
        this.state.hubStep1Received
      ) {
        this.host.onViolation(`unexpected hub step1 round ${message.syncRoundId}`);
        return;
      }
      this.state.hubStep1Received = true;
      this.state.hubStep1Seq = message.sequence;
      this.sendStep2(message.stateVector, message.sequence);
    }
  }

  /** 收 SYNC_STEP2（§9.1.3；违例矩阵 §9.2）。 */
  onStep2(message: {
    syncRoundId: number;
    relatedStep1Sequence: number;
    update: Uint8Array;
    sequence: number;
  }): void {
    if (
      !this.hasActiveRound ||
      message.syncRoundId !== this.state.currentRound ||
      this.state.ownStep1Seq === undefined ||
      message.relatedStep1Sequence !== this.state.ownStep1Seq ||
      this.state.receivedStep2
    ) {
      this.host.onViolation(`invalid step2 round ${message.syncRoundId}`);
      return;
    }
    this.state.receivedStep2 = true;
    void this.applyStep2Safely(message.update, message.sequence);
  }

  /** 收 SYNC_APPLIED（§9.1.5；重复控制帧 → 违例）。 */
  onApplied(message: { syncRoundId: number; ackedSequence: number }): void {
    if (
      message.syncRoundId !== this.state.currentRound ||
      this.state.ownStep2Seq === undefined ||
      message.ackedSequence !== this.state.ownStep2Seq ||
      this.state.localDiffAppliedByRemote
    ) {
      this.host.onViolation(`invalid applied round ${message.syncRoundId}`);
      return;
    }
    this.state.localDiffAppliedByRemote = true;
    this.checkSettled();
  }

  /** 连接收口（重开/清理）：引擎归零。 */
  teardown(): void {
    this.resetState(0);
    this.lastRound = 0;
    this.liveFlag = false;
  }

  private sendStep2(remoteStateVector: Uint8Array, relatedSequence: number): void {
    const diff = this.host.encode('diff', remoteStateVector);
    const seq = this.host.send({
      kind: 'SYNC_STEP2',
      namespaceId: this.nsId,
      syncRoundId: this.state.currentRound,
      relatedStep1Sequence: relatedSequence,
      update: diff,
    });
    this.state.ownStep2Seq = seq;
  }

  private async applyStep2Safely(update: Uint8Array, step2Sequence: number): Promise<void> {
    const outcome = await this.host.applyStep2(update, step2Sequence);
    if (outcome === 'ok') {
      this.state.remoteDiffAppliedLocally = true;
      this.checkSettled();
    }
    // 'aborted'：宿主已按 error-mapping 收口（ERROR + 终态 / one-shot）；引擎静默
  }

  private checkSettled(): void {
    if (this.settled) return;
    if (this.state.remoteDiffAppliedLocally && this.state.localDiffAppliedByRemote) {
      this.settled = true;
      this.host.onRoundSettled();
    }
  }

  private resetState(roundId: number): void {
    this.state = {
      currentRound: roundId,
      hubStep1Received: false,
      hubStep1Seq: undefined,
      ownStep1Seq: undefined,
      ownStep2Seq: undefined,
      receivedStep2: false,
      remoteDiffAppliedLocally: false,
      localDiffAppliedByRemote: false,
    };
    this.settled = false;
  }
}
