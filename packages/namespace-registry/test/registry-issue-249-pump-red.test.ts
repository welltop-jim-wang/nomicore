/**
 * SA6 红灯验收契约 — issue #249：diagnostic pump 单飞竞态 / 交错不丢失 / 满队列丢弃上报
 * （task_diagnostic-pump-singleflight-duplicate.md；SA8 conflict-gate clear、SA5 分析
 * clear，HEAD ac91a6b = PR #248）。
 * （2026-09-06 R1 修订：按批准设计 task_249_design.md §10 对齐 R2a / R3-2 / T-C——
 * 授权性质、双向绿推演与轻量复检记录见 wiki/raw/task_249_sa6_align_verification.md。）
 *
 * 载体：真实 `src/diag-pump.ts`（包内模块），通过 `DiagPumpDeps.defer` 注入确定性手工
 * macrotask scheduler，场景驱动自行决定每个回调何时触发。零真实定时器、零到达型
 * poll：调度次数可精确计数（SA5 §5：到达型 poll 对调度次数有结构性盲区）。
 *
 * 契约分类（当前 HEAD 判定）：
 * - R1a/R1b/R1c —— **红灯**（AC1 单飞违约）：调度门只识别 running 态（diag-pump
 *   `!draining.has(ns)`，L134），首 drain 触发前的 burst 窗口每个被接纳任务各排一个
 *   setImmediate（上界 = 队列容量 256），drain 空转放大 1:1。修复后：每 ns 至多一个
 *   scheduled/running drain，同一 burst 只调度一次。
 * - R1d、R2a–R2d —— **绿灯守护锚**（AC2 交错不丢失：stale 回调空转 no-op、回调间
 *   入队、末任务期 Host 重入、resolver/emitter 违约只废单条不阻断队列；AC7 stale
 *   interleave 回归锁）。现实现成立，修复不得破坏——红→绿契约以「持续绿」验收。
 *   **R2a 制造机制已按批准设计 §10.2 对齐修订**（用例注记详述）：旧编排依赖被
 *   修复消灭的重复调度产生第二个 pending 回调（修复后第三次 flushOne 必抛 no
 *   pending——反向击穿），修订为显式捕获并重调已触发回调。对齐授权性质（SA8
 *   设计后复审 N3）：契约头无 R3-2/T-C 式明文预留通道，合法锚 = 守护锚语义保持
 *   （stale 安全、零丢失、FIFO）前提下的制造机制更换；修订版双向绿（现泵/修复
 *   后泵逐符号推演成立）。覆盖域（SA2 O7）：收窄为「已触发回调的重复触发」违约
 *   域——重复调度产生第二个 pending 回调的形态修复后结构性不可达（即缺陷本体，
 *   由 R1a–R1c 锁定）；与 R2b/R2c/R2d 联合仍锁定设计 §4.3-4 全部坏修复反例
 *   （位清除时序错位 → R2b 红；循环外缓存队列数组引用 → R2a/R2b 红；位不提前到
 *   排定点 → R1a/R1b/R1c 红）。
 * - R3-1 —— **绿灯锚**（AC3 有界丢弃本体：满队列 drop-newest、保序，已投递前 256
 *   条 FIFO 不变）。
 * - R3-2 —— **红灯**（AC3 静默丢弃违约）：满队列 drop 结构性零上报——
 *   `DiagPumpDeps`（src/diag-pump.ts L60）只有 initStream/resolveEmitter 两个依赖面，
 *   无任何健康/observer 通道。修复后丢弃必须经既有低基数（operation/reason，
 *   ADR-0012 L240）健康语义上报，且不得为记录 drop 占用同一队列。
 *
 * 【契约 seam 锚注 — AC3 上报面】R3-2 以 `DiagPumpDeps.reportDrop?`（可选成员）为
 * 契约锚（沿用 #150 红灯契约「字段名即本契约锚点」先例）：drop 发生时泵调用
 * `reportDrop(payload)` 恰一次/每条被丢任务。R0 字面载荷 `{ operation, reason }`
 * 无法给 init-stream 丢弃一个诚实的 operation（建流无词表位，不发明第 7 值）——
 * SA1 设计 §5.2 已定形判别联合载荷，R0 契约头「SA1 设计若选不同 seam 形状/命名，
 * 须经 SA6 对齐修订本契约」即预授权通道，本修订在其内落地：
 *
 *     { kind: 'emit', operation, reason: 'queue-full' }   // emit 任务：携带被丢
 *                                                         // emission 自身的 operation
 *     { kind: 'init-stream', reason: 'queue-full' }       // init-stream：诚实缺席
 *
 * reason 为 ADR-0012 L240 封闭 reason 维度；emit 分支的 operation 取自被丢记录
 * 自身（泵同时承载多 operation 的 Runtime emissions，禁止硬编码）。测试以本地
 * 镜像类型承载 §5.2 形状（产品类型 `DiagPumpDropReport` 由 SA3 随实现导出），
 * 断言按 `kind` 收窄——修复后 `satisfies` 逆变检查与既有断言原样成立（类型级
 * 双向兼容论证见 task_249_sa6_align_verification.md §2.2）。上报通道落点（泵依赖
 * → ADR-0009 L95 Registry 内部 observer seam）属 SA1/SA3 接线决策，本契约只锚泵
 * 边界可观测行为。低基数红线：namespaceId/streamId/token 不得进入上报载荷
 * （ADR-0010 L159 / ADR-0011 L87），本契约载荷只含 kind/operation/reason 三个
 * 封闭维度。类型门禁说明（SA2 O2）：`pnpm typecheck`（逐包 tsconfig 仅含
 * src/**）不看测试文件、vitest typecheck 面仅 `*.test-d.ts`——测试文件类型错误
 * 经 `vitest run` 的 tsc 程序（tsconfig.typecheck.json 将各包 test/ 目录下的
 * 测试文件纳入编译面）以 unhandled/source error 暴露；本契约主动对齐而非依赖
 * CI 兜底。
 */
import { describe, expect, it } from 'vitest';
import { createDiagPump, type DiagPumpDeps } from '../src/diag-pump.js';
import type {
  NamespaceDiagnosticChangeEmission,
  NamespaceDiagnosticChangeEmitter,
} from '../../namespace-diagnostic-log/src/index.js';

// ── 确定性手工调度器（macrotask check 阶段由场景驱动）──────────────────────

type ImmediateCallback = () => void;

interface ManualScheduler {
  /** pump 发出的 setImmediate 调用次数。 */
  scheduleCount: number;
  /** 按调度序等待触发的回调。 */
  pending: ImmediateCallback[];
  /** 已触发回调总数（drain 回调调用次数）。 */
  fired: number;
  install(): void;
  restore(): void;
  /** 同步触发最老的 pending 回调（一个 macrotask 回合）。 */
  flushOne(): void;
  flushAll(): void;
}

function makeManualScheduler(): ManualScheduler {
  const real = globalThis.setImmediate;
  const s: ManualScheduler = {
    scheduleCount: 0,
    pending: [],
    fired: 0,
    install() {
      globalThis.setImmediate = ((cb: ImmediateCallback) => {
        s.scheduleCount += 1;
        s.pending.push(cb);
        return {} as NodeJS.Immediate;
      }) as typeof setImmediate;
    },
    restore() {
      globalThis.setImmediate = real;
    },
    flushOne() {
      const cb = s.pending.shift();
      if (cb === undefined) throw new Error('no pending immediate to flush');
      s.fired += 1;
      cb();
    },
    flushAll() {
      // 有界守护：flush 期间新调度的回调也一并执行（防护实现缺陷导致的无限循环）
      let guard = 0;
      while (s.pending.length > 0 && guard < 100_000) {
        guard += 1;
        s.flushOne();
      }
    },
  };
  return s;
}

// ── fixtures ────────────────────────────────────────────────────────────────

const NS = 'ns-000000000000000000000000000000a1';

function emission(seq: number): NamespaceDiagnosticChangeEmission {
  return {
    operation: 'namespace-create',
    stage: 'transaction',
    observedAt: '2026-09-06T00:00:00.000Z',
    attemptId: String(seq).padStart(4, '0'),
    source: { kind: 'local' },
    input: { status: 'not-accessed' },
    result: { kind: 'committed', effect: 'noop' },
  };
}

interface PumpProbe {
  /** 实际投递到已解析 emitter 的 attemptId（保序）。 */
  delivered: string[];
  /** 已执行建流任务（ns + genesis 是否带 bytes）。 */
  initStreams: Array<{ ns: string; genesis: boolean }>;
  /** pump 发出的调度数。 */
  scheduleCount: number;
  /** drain 回调触发数（manual flush 计数）。 */
  fired: number;
}

interface PumpOptions {
  /** 在首条投递的 emit 内执行的重入入队（Host 重入）。 */
  reentrantDuringEmit?: (ns: string) => void;
  /** emitter 解析行为：normal / throw / resolve-undefined。 */
  emitterBehavior?: 'normal' | 'throw' | 'resolve-undefined';
}

function makePumpProbe(scheduler: ManualScheduler, options: PumpOptions = {}) {
  const delivered: string[] = [];
  const initStreams: Array<{ ns: string; genesis: boolean }> = [];
  let reentrancyArmed = true;
  const emitter: NamespaceDiagnosticChangeEmitter = {
    emit: (e) => {
      delivered.push(e.attemptId ?? '?');
      if (options.reentrantDuringEmit !== undefined && reentrancyArmed) {
        // 只武装一次：仅首条投递触发重入
        reentrancyArmed = false;
        options.reentrantDuringEmit(NS);
      }
    },
  };
  const pump = createDiagPump({
    defer: (callback) => {
      scheduler.scheduleCount += 1;
      scheduler.pending.push(callback);
    },
    initStream: (ns, genesis) => {
      initStreams.push({ ns, genesis: genesis !== undefined });
    },
    resolveEmitter: () => {
      if (options.emitterBehavior === 'resolve-undefined') return undefined;
      if (options.emitterBehavior === 'throw') throw new Error('resolver violation');
      return emitter;
    },
  });
  return {
    pump,
    probe: (): PumpProbe => ({
      delivered: [...delivered],
      initStreams: [...initStreams],
      scheduleCount: scheduler.scheduleCount,
      fired: scheduler.fired,
    }),
  };
}

// ── R1（AC1）单飞：每 ns 至多一个 scheduled/running drain ───────────────────

describe('issue-249 R1 — AC1 singleflight: at most one scheduled/running drain per namespace', () => {
  it('R1a (RED): burst 1000 enqueues before the first drain fires schedules exactly 1 setImmediate, not one per accepted task', () => {
    const s = makeManualScheduler();
    s.install();
    try {
      const { pump, probe } = makePumpProbe(s);
      for (let i = 0; i < 1000; i += 1) pump.enqueueEmit(NS, emission(i));
      const p = probe();
      // AC1: 首 drain 触发前的 burst 窗口内只允许一个 scheduled drain。
      expect(p.scheduleCount).toBe(1);
    } finally {
      s.restore();
    }
  });

  it('R1b (RED): after the burst drains, exactly ONE drain invocation runs (no duplicate no-op drain callbacks)', () => {
    const s = makeManualScheduler();
    s.install();
    try {
      const { pump, probe } = makePumpProbe(s);
      for (let i = 0; i < 1000; i += 1) pump.enqueueEmit(NS, emission(i));
      s.flushAll();
      const p = probe();
      // AC1: 重复调度的回调是空转 no-op drain——修复后 fired 必须为 1。
      expect(p.fired).toBe(1);
      // 有界队列（256）内的已接纳任务保序投递（AC3 有界丢弃本体；超出部分由
      // AC3 上报契约 R3-2 覆盖，不在此处断言「零丢弃」——AC3 允许有界 drop-newest）。
      expect(p.delivered.length).toBe(256);
      expect(p.delivered[0]).toBe('0000');
      expect(p.delivered[255]).toBe('0255');
      expect(new Set(p.delivered).size).toBe(p.delivered.length); // 无重复投递
    } finally {
      s.restore();
    }
  });

  it('R1c (RED): sustained enqueue without an event-loop turn keeps pending drains bounded near 1 (100 ticks × 50 enqueues)', () => {
    const s = makeManualScheduler();
    s.install();
    try {
      const { pump, probe } = makePumpProbe(s);
      for (let tick = 0; tick < 100; tick += 1) {
        for (let i = 0; i < 50; i += 1) pump.enqueueEmit(NS, emission(tick * 50 + i));
        void Promise.resolve(); // 仅微任务 hop——check 阶段永不运行，burst 窗口持续
      }
      const p = probe();
      expect(p.scheduleCount).toBe(1); // AC1: 跨窗口持续入队也不得累积待触发 drain
      expect(s.pending.length).toBeLessThan(50); // 每 ns 待处理 drain 有界趋近 1
    } finally {
      s.restore();
    }
  });

  it('R1d (GREEN control): enqueue while a drain is RUNNING does not over-schedule (running-state gate works; reentrant tasks consumed in-loop)', () => {
    const s = makeManualScheduler();
    s.install();
    try {
      const { pump, probe } = makePumpProbe(s, {
        reentrantDuringEmit: (ns) => {
          pump.enqueueEmit(ns, emission(9001));
          pump.enqueueEmit(ns, emission(9002));
        },
      });
      pump.enqueueEmit(NS, emission(0)); // 调度 1
      s.flushAll(); // drain 运行；emit(0) 重入入队 2 条，同轮循环消费
      const p = probe();
      expect(p.scheduleCount).toBe(1);
      expect(p.delivered).toEqual(['0000', '9001', '9002']);
    } finally {
      s.restore();
    }
  });
});

// ── R2（AC2）交错探针：已接纳任务不得丢失（修复守护锚，现实现 4/4 绿）──────

describe('issue-249 R2 — AC2 interleave probes: accepted tasks must never be lost (regression locks for the AC1 fix)', () => {
  it('R2a (GREEN control): re-firing an already-fired drain callback with an empty queue is a no-op; tasks enqueued between callbacks are not lost', () => {
    const s = makeManualScheduler();
    s.install();
    try {
      const { pump, probe } = makePumpProbe(s);
      pump.enqueueEmit(NS, emission(1)); // 调度 S1
      // R2a 对齐（批准设计 §10.2，SA8 N3/N4 + SA2 O7 落地）：修订前编排靠旧泵的
      // 重复调度制造第二个 pending 回调（enqueue(2) 排 S2）再以三次 flushOne 探
      // stale——该形态在修复后（scheduled+running 合一单飞位）结构性不可达，第
      // 三次 flushOne 必抛「no pending immediate to flush」（守护锚被修复本身击穿）。
      // 修订版 = **显式捕获并重调已触发回调**（探针「重复触发已触发回调」的调度
      // 器违约域），且重调置于下一次入队**之前**（SA2 N4 形状 (a)：队列真空 → 真
      // 「空队 no-op」，保 R0 语义「stale … is a no-op」）。现泵与修复后泵双向
      // 逐符号推演均为绿（见 wiki/raw/task_249_sa6_align_verification.md §2.1）。
      const stale = s.pending[0]!; // 捕获已调度的 S1（显式捕获，不依赖重复调度）
      s.flushOne(); // S1 drain：投递 emission(1)
      expect(probe().delivered).toEqual(['0001']);
      // 显式重调已触发回调（stale）：队列真空 → 必须真 no-op——不投递、不吞任务、
      // 不补调度。
      stale();
      const afterStale = probe();
      expect(afterStale.delivered).toEqual(['0001']);
      expect(s.pending.length).toBe(0);
      expect(afterStale.scheduleCount).toBe(1);
      pump.enqueueEmit(NS, emission(2)); // 两个活 drain 之间入队 → 调度 S2
      s.flushOne(); // S2 投递 emission(2)
      const p = probe();
      expect(p.delivered).toEqual(['0001', '0002']); // 零丢失、FIFO
      expect(s.pending.length).toBe(0);
      expect(p.scheduleCount).toBe(2); // stale 重调不产生多余调度（单飞保持）
      expect(p.fired).toBe(2);
    } finally {
      s.restore();
    }
  });

  it('R2b (GREEN control): reentrant enqueue during the FINAL drain task is consumed by the running loop (not lost)', () => {
    const s = makeManualScheduler();
    s.install();
    try {
      const { pump, probe } = makePumpProbe(s, {
        reentrantDuringEmit: (ns) => {
          pump.enqueueEmit(ns, emission(21));
          pump.enqueueInitStream(ns, undefined);
        },
      });
      pump.enqueueEmit(NS, emission(20)); // 恰调度 1
      s.flushAll();
      const p = probe();
      expect(p.delivered).toEqual(['0020', '0021']);
      expect(p.initStreams).toEqual([{ ns: NS, genesis: false }]);
      expect(p.scheduleCount).toBe(1); // drain 期间重入：不再补调度
    } finally {
      s.restore();
    }
  });

  it('R2c (GREEN control): FIFO per namespace holds across init-stream + emit mix; initStream precedes its emission', () => {
    const s = makeManualScheduler();
    s.install();
    try {
      const { pump, probe } = makePumpProbe(s);
      pump.enqueueInitStream(NS, new Uint8Array([1])); // genesis present
      pump.enqueueEmit(NS, emission(1));
      pump.enqueueEmit(NS, emission(2));
      s.flushAll();
      const p = probe();
      expect(p.initStreams).toEqual([{ ns: NS, genesis: true }]); // initStream 先于对应 emission
      expect(p.delivered).toEqual(['0001', '0002']);
    } finally {
      s.restore();
    }
  });

  it('R2d (GREEN control): resolver/emitter violations drop only the offending record and never stall the queue', () => {
    const s = makeManualScheduler();
    s.install();
    try {
      const { pump, probe } = makePumpProbe(s, { emitterBehavior: 'throw' });
      pump.enqueueEmit(NS, emission(1));
      pump.enqueueEmit(NS, emission(2));
      s.flushAll();
      const p = probe();
      expect(p.delivered).toEqual([]); // 隔离：违约记录不入业务面
      expect(p.fired).toBeGreaterThanOrEqual(1); // drain 仍执行并清空队列
      expect(s.pending.length).toBe(0); // 无残留待触发 drain
    } finally {
      s.restore();
    }
  });
});

// ── R3（AC3）满队列：drop-newest 有界保序（锚）＋丢弃必须上报（红）──────────

describe('issue-249 R3 — AC3 queue-full: bounded order-preserving drop-newest, drops MUST be reported', () => {
  it('R3-1 (GREEN control): 300-burst keeps the first 256 queued records in FIFO order and drops the 44 newest', () => {
    const s = makeManualScheduler();
    s.install();
    try {
      const delivered: string[] = [];
      const pump = createDiagPump({
        defer: (callback) => {
          s.scheduleCount += 1;
          s.pending.push(callback);
        },
        initStream: () => {
          /* no-op */
        },
        resolveEmitter: () => {
          return { emit: (e) => delivered.push(e.attemptId ?? '?') };
        },
      });
      for (let i = 0; i < 300; i += 1) pump.enqueueEmit(NS, emission(i));
      s.flushAll();
      expect(delivered.length).toBe(256); // 有界：per-ns 容量 256 保持
      expect(delivered[0]).toBe('0000');
      expect(delivered[255]).toBe('0255'); // drop-newest：已排队顺序保留
    } finally {
      s.restore();
    }
  });

  it('R3-2 (RED): every queue-full emit drop is reported exactly once with the discriminated low-cardinality payload', () => {
    const s = makeManualScheduler();
    s.install();
    try {
      // 契约 seam 锚（见文件头注释）：AC3 上报面 = DiagPumpDeps.reportDrop?，载荷 =
      // 判别联合（设计 §5.2 定形）。本地镜像类型与 §5.2 形状逐字段一致（产品类型
      // DiagPumpDropReport 由 SA3 随实现导出）；对齐版修复前类型零错误、修复后
      // satisfies 逆变检查与按 kind 收窄的断言原样成立。
      interface EmitDropReport {
        readonly kind: 'emit';
        readonly operation: string;
        readonly reason: 'queue-full';
      }
      interface InitStreamDropReport {
        readonly kind: 'init-stream';
        readonly reason: 'queue-full';
      }
      type DropReport = EmitDropReport | InitStreamDropReport;
      const reports: DropReport[] = [];
      const pump = createDiagPump({
        defer: (callback) => {
          s.scheduleCount += 1;
          s.pending.push(callback);
        },
        initStream: () => {
          /* no-op */
        },
        resolveEmitter: () => {
          return { emit: () => undefined };
        },
        reportDrop: (drop) => reports.push(drop),
      } satisfies DiagPumpDeps & { reportDrop: (drop: DropReport) => void });
      for (let i = 0; i < 300; i += 1) pump.enqueueEmit(NS, emission(i));
      s.flushAll();
      // AC3/ADR-0011 L25：丢弃不得静默——44 条被丢记录每一条都必须有健康上报。
      expect(reports.length).toBe(44);
      // 本场景全部为 emit 丢弃：按 kind 收窄后逐一核验。低基数维度 = kind/
      // operation/reason 三个封闭维度；不含 namespaceId/streamId/token 等高基数/
      // 敏感维度（ADR-0010 L159、ADR-0011 L87）。
      expect(reports.every((r) => r.reason === 'queue-full')).toBe(true);
      const emitDrops = reports.filter((r): r is EmitDropReport => r.kind === 'emit');
      expect(emitDrops.length).toBe(44);
      expect(emitDrops.every((r) => r.operation === 'namespace-create')).toBe(true);
    } finally {
      s.restore();
    }
  });
});
