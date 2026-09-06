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
 *
 * #249（单飞位 + 满队丢弃上报；SA1 design §4/§5、SA8 clear、SA2 approve）：
 * - 单飞位从 running-only（`draining`，仅在回调体内 add/delete——首 drain 触发前
 *   burst 窗口每个被接纳任务各排一个 setImmediate，与 #226 冻结语义相悖）改为
 *   **scheduled+running 合一 per-ns 单飞位**（`inflight`）：位置位提前到**排定时**
 *   （先于 setImmediate 返回）、清除点移到 **setImmediate 回调末尾 finally**
 *   （drainNamespace 完整返回之后）。drain 全程同步无 await 点、循环每轮重取
 *   队列引用、空判 break 与排空 delete 逐字节保持（SA2 O3 结构等价理解）——
 *   AC1 单飞与 AC2 交错不丢失同时成立（design §4.3 证明；R1/R2 契约锁）。
 * - 满队 drop-newest 由静默改为**逐条上报**：`DiagPumpDeps.reportDrop?`（可选
 *   依赖——缺席 → 静默，既有行为零漂移）。载荷 = 判别联合 `DiagPumpDropReport`
 *   （emit 分支携带被丢 emission 自身的 operation——泵同时承载多 operation 的
 *   Runtime emissions，禁止硬编码；init-stream 分支无 operation——建流无词表位，
 *   诚实缺席）。上报在 drop 点同步调用（槽内 O(1)，不占同一队列——ADR-0012
 *   L240）、每被丢任务恰一次、泵侧 try/catch 收编（上报通道违约不外溢——enqueue
 *   非抛契约保持）。低基数：载荷只含 kind/operation/reason 三个封闭维度
 *   （ADR-0011 L87 / ADR-0010 L159；namespaceId/streamId/token 不进）。
 * - 调度原语 = 裸 `setImmediate`（macrotask）。裁决依据（SA1 §3.1）：
 *   ① 微任务级 deferral 不足（T9/T13 语义要求日志 I/O 排程不先于 shutdown/close
 *   结算续段；微任务 hop 仍在同一轮 PromiseJobs 排空内）；② 注入式 scheduler
 *   （testing.ts fake）结构性不可用（纯 Map fake、仅 advanceBy 触发——契约测试均
 *   不 advance）；③ registry-surface §2.M 静态守卫三正则（setTimeout/setInterval/
 *   clearTimeout/clearInterval 裸/globalThis + Date.now）**有意不含 setImmediate**
 *   （R4 注释契约，见 registry-surface.test.ts）；④ node 部署面恒提供 setImmediate，
 *   不做非 node 降级分支。
 * - 有界与丢弃：per-ns 队列容量上界 256，满 → drop-newest（丢弃新到任务、保留已
 *   排队顺序）——有界内存是隔离义务本身（ADR-0011 有界接收），不承诺零丢；
 *   #249 起丢弃**不再静默**（见下方 #249 段——逐条低基数上报），drop 本体与保序
 *   语义零改动（R3-1 绿锚）。
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

/** 满队丢弃上报载荷（#249 判别联合——低基数：只含 kind/operation/reason 三个
 *  封闭维度，ADR-0011 L87 / ADR-0010 L159）。emit 分支携带被丢 emission 自身的
 *  operation（泵同时承载 Runtime emissions——root-mutation 等，禁止硬编码）；
 *  init-stream 分支无 operation（建流不是 record emission，无词表位——诚实缺席，
 *  不发明第 7 个 operation 值）。reason 恒 'queue-full'（v1 封闭 reason 维度）。 */
export type DiagPumpDropReport =
  | {
      readonly kind: 'emit';
      readonly operation: NamespaceDiagnosticChangeEmission['operation'];
      readonly reason: 'queue-full';
    }
  | {
      readonly kind: 'init-stream';
      readonly reason: 'queue-full';
    };

/** 泵依赖（create-diagnostic.ts 构造期以非抛形状门捕获的 seam 调用面）。 */
export interface DiagPumpDeps {
  /** drain 内执行 stream 建立缝（Host initStream；违约 throw 由 drain 收编）。 */
  readonly initStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
  /** drain 内解析 ns-bound emitter（复用 resolveEmitterOnce 非抛边界）。 */
  readonly resolveEmitter: (namespaceId: string) => NamespaceDiagnosticChangeEmitter | undefined;
  /** #249：满队丢弃健康上报（AC3——ADR-0011 L25「尽力上报 dropped count」+
   *  ADR-0012 L240「按 operation/reason 低基数 dropped metrics，走独立 observer；
   *  不得为记录 drop 再挤占同一队列」）。可选：缺席 → 静默（既有行为）。drop 点
   *  同步调用、每被丢任务恰一次；泵侧 try/catch 收编——上报通道违约绝不外溢
   *  （enqueue 非抛契约保持；dispatchObserver 侧另有同款隔离，双层防御）。 */
  readonly reportDrop?: (drop: DiagPumpDropReport) => void;
}

/** 泵公开面（仅 create-diagnostic.ts 消费；两个 enqueue 均 O(1) 非抛）。 */
export interface DiagPump {
  /** 入队 stream 建立任务（成功 create 的 initStream(bytes) / 早结局补建流
   *  initStream(undefined)——由调用方按路由语义决定）。 */
  readonly enqueueInitStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined) => void;
  /** 入队已组装 emission 投递任务。 */
  readonly enqueueEmit: (namespaceId: string, emission: NamespaceDiagnosticChangeEmission) => void;
}

/** per-ns 队列容量上界（缺省 256；满 → drop-newest——ADR-0011 有界接收；
 *  #249 起丢弃逐条低基数上报（见 DiagPumpDropReport），不再静默；无公共配置
 *  面——本泵不进公共 API，构造 options 域属包内实现细节）。 */
const DIAG_PUMP_MAX_QUEUE_PER_NAMESPACE = 256;

/** 构造 per-namespace 延迟投递泵。 */
export function createDiagPump(deps: DiagPumpDeps): DiagPump {
  const queues = new Map<string, DiagPumpTask[]>();
  // #249：scheduled+running 合一 per-ns 单飞位（替换 #226 running-only `draining`）
  // ——位在排定时置位（先于 setImmediate 返回）、在 setImmediate 回调末尾 finally
  // 清除（design §4.2；AC1/AC2 不变量证明见 design §4.3）。
  const inflight = new Set<string>();

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

  /** 满队丢弃上报（#249：每被丢任务恰一次；payload 按任务判别元成形——emit 携带
   *  被丢 emission 自身的 operation，init-stream 诚实缺席）。上报通道违约（敌意
   *  reportDrop）→ 吞没——enqueue 非抛契约保持。 */
  function reportDrop(task: DiagPumpTask): void {
    try {
      if (task.kind === 'init-stream') {
        deps.reportDrop?.({ kind: 'init-stream', reason: 'queue-full' });
        return;
      }
      deps.reportDrop?.({
        kind: 'emit',
        operation: task.emission.operation,
        reason: 'queue-full',
      });
    } catch {
      /* 上报通道违约 → 吞没（双层防御：dispatchObserver 同款隔离） */
    }
  }

  /** 同步排空该 ns 队列（单飞；drain 期间新入队任务在同一轮内被继续消费——
   *  同步块内无调度点，队列形态确定）。#249：簿记（inflight add/delete）已移至
   *  setImmediate 回调——本体只保留冻结结构（循环每轮重取队列引用、空判 break、
   *  排空后 delete——SA2 O3 结构等价）。 */
  function drainNamespace(namespaceId: string): void {
    for (;;) {
      const queue = queues.get(namespaceId);
      const task = queue === undefined ? undefined : queue.shift();
      if (task === undefined) break;
      runTask(task);
    }
    queues.delete(namespaceId); // 排空后释放 per-ns 队列/Map 位（长期运行内存卫生）
  }

  function enqueue(task: DiagPumpTask): void {
    const namespaceId = task.namespaceId;
    let queue = queues.get(namespaceId);
    if (queue === undefined) {
      queue = [];
      queues.set(namespaceId, queue);
    }
    if (queue.length >= DIAG_PUMP_MAX_QUEUE_PER_NAMESPACE) {
      // 满 → drop-newest：丢弃新到任务、保留已排队顺序（保序纪律）。#249：不再
      // 静默——逐条上报（AC3/ADR-0011 L25、ADR-0012 L240；同步直报、槽内 O(1)、
      // 不占同一队列）。
      reportDrop(task);
      return;
    }
    queue.push(task);
    if (!inflight.has(namespaceId)) {
      // #249 单飞调度：位提前到排定点（覆盖 scheduled 态——首 drain 触发前的
      // burst 窗口不再重复调度）；check 阶段在 JS 栈清空后执行——drain 必晚于
      // 当前微任务链（业务结算续段在其内）→ 存储完成标记晚于结算标记
      // （T8–T13 顺序锚机制）。
      inflight.add(namespaceId);
      try {
        setImmediate(() => {
          try {
            drainNamespace(namespaceId);
          } finally {
            inflight.delete(namespaceId); // ← 回调末尾清除（drainNamespace 完整
          } //   返回后——同步直线代码、无回调点，无漏调度窗口）
        });
      } catch {
        // 敌意全局 setImmediate throw（#249 正向改进，SA2 O6）：位回滚——队列任务
        // 由后续入队补调度（enqueue 非抛契约）。残留边界（O6 登记）：若 throw 持续
        // 且该 ns 再无入队，已接纳任务滞留队列（≤256/ns 有界、不外溢、不重复投递
        // ——可接受降级）。
        inflight.delete(namespaceId);
      }
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
