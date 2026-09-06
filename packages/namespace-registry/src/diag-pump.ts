/**
 * diag-pump — issue #226 per-namespace 延迟投递泵（本票修复的隔离载体）。
 *
 * 职责边界（SA1 design §3.1 / §6；SA8 conflict-recheck clear；SA2 attack review
 * approve）：
 * - 把「可能触碰存储的 seam 调用」（`initStream` 建流 / `runtimeEmitterFor` 解析
 *   adapter 构造 / ns-bound `emitter.emit` 同步 append）从 Registry lifecycle
 *   carrier 槽内与 Runtime write-sequencer 槽间窗口搬到 **macrotask 级 drain**
 *   （`setImmediate` check 阶段）——业务槽内/槽间窗口内的残余日志工作 = O(1)
 *   纯内存入队（ADR-0012 amendment L250 选项 (a)：延迟同步 append，只移调用点）。
 * - 泵 ≠ ADR-0012 L252 的「逻辑 writer queue」：adapter 存储语义一字未动（每个
 *   record 仍由 drain 内一次同步单-record append 落盘）；泵只改变调用点位置，
 *   不触发 L252 的 batch/周期 flush/fsync/队列满四类语义义务。
 * - per-namespace FIFO 保序（同一 ns 的建流任务先于其后的 emission 任务执行——
 *   #150 DC-2「initStream 先于 #17」冻结次序在新载体下仍成立）；
 *   每 ns 独立单飞 drain——某 ns 存储挂起只饿死该 ns 自己的投递，不阻塞其它 ns
 *   与任何业务路径（drain 本就在业务路径外）。
 * - 调度原语 = 裸 `setImmediate`（macrotask）。裁决依据（SA1 §3.1）：
 *   ① 微任务级 deferral 不足（T9/T13 语义要求日志 I/O 排程不先于 shutdown/close
 *   结算续段；微任务 hop 仍在同一轮 PromiseJobs 排空内）；② 注入式 scheduler
 *   （testing.ts fake）结构性不可用（纯 Map fake、仅 advanceBy 触发——契约测试均
 *   不 advance）；③ registry-surface §2.M 静态守卫三正则（setTimeout/setInterval/
 *   clearTimeout/clearInterval 裸/globalThis + Date.now）**有意不含 setImmediate**
 *   （R4 注释契约，见 registry-surface.test.ts）；④ node 部署面恒提供 setImmediate，
 *   不做非 node 降级分支。
 * - 有界与丢弃：per-ns 队列容量上界 256，满 → drop-newest（丢弃新到任务、保留已
 *   排队顺序）静默丢弃——诊断是 best-effort observability，有界内存是隔离义务
 *   本身（ADR-0011 有界接收），不承诺零丢。
 * - 非抛：drain 全程逐任务 try/catch 收编——Host initStream 违约 throw /
 *   runtimeEmitterFor 解析违约（throw/undefined/畸形，`resolveEmitterOnce` 既有
 *   非抛边界复用）/ emitter 同步 throw 一律吞没，绝不外溢到任何业务路径。
 * - 寿命与 shutdown 零耦合：泵随 Registry 实例构造与 GC；不清泵、不等待、不注册
 *   disposer（ADR-0011 L129「Registry 停止不得无限等待日志 sink」）；Host
 *   `manager.close()` 收口后迟到 drain 落 `manager-closed` 丢弃桩（既有词表）。
 * - 纪律（recheck §8.2 / SA2 obs 5）：Registry/Runtime 结算路径不得引入 macrotask
 *   让渡——泵的调度只发生在入队点（业务槽内 O(1)），drain 执行点在业务路径外。
 *
 * 模块导出纪律：零导出到公共面（index.ts 不 re-export；仅 create-diagnostic.ts
 * 相对导入消费——与 create-diagnostic.ts 同款模块纪律）。
 */
import type {
  NamespaceDiagnosticChangeEmitter,
  NamespaceDiagnosticChangeEmission,
} from '@nomicore/namespace-diagnostic-log';

/** 泵任务（判别联合，纯数据——emission 为捕获点已组装完成的语义 record）。 */
type DiagPumpTask =
  | {
      readonly kind: 'init-stream';
      readonly namespaceId: string;
      readonly genesisUpdateBytes: Uint8Array | undefined;
    }
  | {
      readonly kind: 'emit';
      readonly namespaceId: string;
      readonly emission: NamespaceDiagnosticChangeEmission;
    };

/** 泵依赖（create-diagnostic.ts 构造期以非抛形状门捕获的 seam 调用面）。 */
export interface DiagPumpDeps {
  /** drain 内执行 stream 建立缝（Host initStream；违约 throw 由 drain 收编）。 */
  readonly initStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
  /** drain 内解析 ns-bound emitter（复用 resolveEmitterOnce 非抛边界）。 */
  readonly resolveEmitter: (namespaceId: string) => NamespaceDiagnosticChangeEmitter | undefined;
}

/** 泵公开面（仅 create-diagnostic.ts 消费；两个 enqueue 均 O(1) 非抛）。 */
export interface DiagPump {
  /** 入队 stream 建立任务（成功 create 的 initStream(bytes) / 早结局补建流
   *  initStream(undefined)——由调用方按路由语义决定）。 */
  readonly enqueueInitStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
  /** 入队已组装 emission 投递任务。 */
  readonly enqueueEmit: (namespaceId: string, emission: NamespaceDiagnosticChangeEmission) => void;
}

/** per-ns 队列容量上界（缺省 256；满 → drop-newest 静默丢弃——ADR-0011 有界
 *  接收；无公共配置面——本泵不进公共 API，构造 options 域属包内实现细节）。 */
const DIAG_PUMP_MAX_QUEUE_PER_NAMESPACE = 256;

/** 构造 per-namespace 延迟投递泵。 */
export function createDiagPump(deps: DiagPumpDeps): DiagPump {
  const queues = new Map<string, DiagPumpTask[]>();
  const draining = new Set<string>();

  function runTask(task: DiagPumpTask): void {
    try {
      if (task.kind === 'init-stream') {
        deps.initStream(task.namespaceId, task.genesisUpdateBytes);
        return;
      }
      const emitter = deps.resolveEmitter(task.namespaceId);
      if (emitter === undefined) {
        // resolver 违约（throw/畸形/undefined）→ 静默丢弃（D11/i1——与
        // #155 emitStreamOutcome 既有「解析违约静默丢弃」边界同语义）。
        return;
      }
      emitter.emit(task.emission);
    } catch {
      /* Host 违约（initStream 同步 throw / emitter 同步 throw）→ 吞没——
         ADR-0011「Registry 仍防御 adapter 违约」：绝不外溢业务路径 */
    }
  }

  /** 同步排空该 ns 队列（单飞；drain 期间新入队任务在同一轮内被继续消费——
   *  同步块内无调度点，队列形态确定）。 */
  function drainNamespace(namespaceId: string): void {
    draining.add(namespaceId);
    try {
      for (;;) {
        const queue = queues.get(namespaceId);
        const task = queue === undefined ? undefined : queue.shift();
        if (task === undefined) break;
        runTask(task);
      }
      queues.delete(namespaceId); // 排空后释放 per-ns 队列/Map 位（长期运行内存卫生）
    } finally {
      draining.delete(namespaceId);
    }
  }

  function enqueue(task: DiagPumpTask): void {
    const namespaceId = task.namespaceId;
    let queue = queues.get(namespaceId);
    if (queue === undefined) {
      queue = [];
      queues.set(namespaceId, queue);
    }
    if (queue.length >= DIAG_PUMP_MAX_QUEUE_PER_NAMESPACE) {
      // 满 → drop-newest：丢弃新到任务、保留已排队顺序（保序纪律）；静默（无
      // Registry 侧健康通道——健康面归 Host/adapter 独立 observer，Registry 不代发）。
      return;
    }
    queue.push(task);
    if (!draining.has(namespaceId)) {
      // 单飞调度：check 阶段在 JS 栈清空后执行——drain 必晚于当前微任务链
      // （业务结算续段在其内）→ 存储完成标记晚于结算标记（T8–T13 顺序锚机制）。
      setImmediate(() => {
        drainNamespace(namespaceId);
      });
    }
  }

  return {
    enqueueInitStream: (namespaceId, genesisUpdateBytes) => {
      enqueue({ kind: 'init-stream', namespaceId, genesisUpdateBytes });
    },
    enqueueEmit: (namespaceId, emission) => {
      enqueue({ kind: 'emit', namespaceId, emission });
    },
  };
}
