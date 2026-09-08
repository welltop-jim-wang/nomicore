/**
 * #155（§5.2/§4-D3/§4-D4/§4-D7/§4-D8）Host 诊断管理器——`@nomicore/yjs-server`
 * 组合根对 `@nomicore/namespace-registry` 诊断 seam 的生产供应方。
 *
 * 职责：
 * - **per-namespace File adapter 缓存 = AC3 单 writer**：进程寿命内恒一实例
 *   （`Map<namespaceId, FileDiagnosticLog>`）；Runtime generation 更替（idle close →
 *   reopen）复用同一 adapter 对象（对象同一性），跨进程经 current.json 续写（#153）。
 * - **无归属通道（issue #226 后语义）**：`binding.emitter` 恒丢弃 + 计数
 *   （`unattributed`/`manager-closed`）——#226 兑现后该共享通道只接收 Registry
 *   公共入口级拒绝（acceptance/identity——namespaceId 生成前的无归属面）与任何
 *   结构性迟到流量；create 槽内建流前结局已改经 Registry diag-pump 以候选
 *   namespaceId 数据键控投递（runtimeEmitterFor），不再落此通道（绝不伪造归属）。
 * - **数据键控归因（§4-D4 + #226）**：`binding.runtimeEmitterFor(ns)` 每次以
 *   namespaceId 对 `Map` 查表——归因键是数据不是时间，C1 竞态类别整体消灭；
 *   #226 后调用时机由 Registry 延迟投递泵搬至业务槽外（macrotask drain）。
 * - **有界 drain（§4-D7）**：close() = closed 置位 + Map 引用释放，O(1)、幂等、
 *   零 fs、零 await——first-slice File adapter 无队列/无常驻 fd，停机无积压可冲。
 * - **健康面（§4-D8）**：adapter observer → NDJSON 事件
 *   `{ event: 'diagnostic-log', namespaceId, ...健康事件 }`（词表/字段白名单 =
 *   包侧 health.ts 冻结面）；管理器自身事件 = 丢弃计数
 *   `{ event: 'diagnostic-log-emission-dropped', reason, namespaceId? }` 与
 *   `{ event: 'diagnostic-log-manager-failed', code }`（结构性不可达防御）。
 *
 * 构造期同步 fs（mkdir / manifest `'wx'` / genesis append / current.json rename +
 * reopen 健康分析 + 构造期 retention sweep——#154 `sweepOnOpen` 缺省 true）不再发生
 * 在 Registry open/create/import 槽内（issue #226：Registry 侧 diag-pump 把这些
 * seam 调用推迟到业务槽外的 macrotask drain——adapter 构造时机随之出槽；仍为每
 * namespace 每进程至多一次，D3/M3 成本注记）。
 */
import { createFileDiagnosticLog, type FileDiagnosticLog } from '@nomicore/namespace-diagnostic-log';
import type { NamespaceDiagnosticChangeEmitter } from '@nomicore/namespace-diagnostic-log';
import type { NamespaceRegistryDiagnosticLog } from '@nomicore/namespace-registry';
import type { DiagnosticsConfig } from './config.js';
import type { EventSink } from './lifecycle.js';

/** 丢弃 reason 封闭词表（§4-D8：三值各有唯一产生方——unattributed = 共享无归属
 *  通道；stream-unavailable = runtimeEmitterFor 解析未命中丢弃桩（结构性不可达）；
 *  manager-closed = close() 之后的两条通道。E4 走 disabled-adapter 缓存路径不落
 *  stream-unavailable——构造不抛、返回 disabled 模式 adapter）。
 *  issue #228（AD-4）：追加第四值 `namespace-deleted`——唯一产生方 = retirement
 *  之后的 runtimeEmitterFor/共享通道迟到流量（已进入删除流程的 namespace 的迟到
 *  日志流量；其宿主日志正在/已被逻辑删除——丢弃是 ADR-0011 best-effort 隔离的
 *  正向运用，不改变删除工作流或任何其它业务操作的返回值）。 */
export type DiagnosticEmissionDropReason =
  | 'unattributed'
  | 'stream-unavailable'
  | 'manager-closed'
  | 'namespace-deleted';

export interface HostDiagnosticsManager {
  /**
   * Registry seam binding：
   * - `emitter` = 无归属通道（恒丢弃 + 计数；零路由逻辑——C1）；
   * - `initStream(ns, bytes)` = ensureAdapter 建流 + 缓存（void；#150 签名零改动）；
   * - `runtimeEmitterFor(ns)` = 数据键控解析（缓存命中/构造成功 → adapter.emitter；
   *   构造不可用 → 丢弃桩；closed → `manager-closed` 丢弃桩；retired →
   *   `namespace-deleted` 丢弃桩——issue #228 AD-4）。
   */
  readonly binding: NamespaceRegistryDiagnosticLog;
  /** O(1) 结构性收口（§4-D7）：closed 置位 + Map 引用释放；幂等；零 fs、零 await。 */
  close(): void;
  /**
   * issue #228（AD-4）namespace retirement：`retiredNamespaces.add(ns)` +
   * `adapters.delete(ns)`——first-slice adapter 无常驻 fd/队列，弃引用即收口；
   * 幂等。封 diag-pump 迟到重建：Runtime close barrier 排空 slot ≠ 排空泵（泵与
   * shutdown 零耦合、不清不等的头注契约），删除工作流中先 retire 再关 Registry/
   * 删日志，此后任何迟到 `runtimeEmitterFor(ns)` 命中 retired → dropStub
   * （`namespace-deleted`），绝不 `ensureAdapter` 对已删目录重建流写 genesis
   * （D4「重启不复活」的进程内同构封堵）。同进程内以同 namespaceId 重新 create
   * 时 `initStream` 先 un-retire 再 ensureAdapter——重建 namespace 走全新流。
   */
  retireNamespace(namespaceId: string): void;
}

/**
 * 构造 Host 诊断管理器（调用方保证 `config.enabled === true`；组合根在 clock fiber
 * 就绪后、registry fiber 之前调用——`now` = 注入 Clock（禁墙钟，ADR 0009）。
 */
export function createHostDiagnosticsManager(
  config: Readonly<DiagnosticsConfig>,
  deps: { sink: EventSink; now: () => number },
): HostDiagnosticsManager {
  const adapters = new Map<string, FileDiagnosticLog>();
  // issue #228（AD-4）：已进入删除流程的 namespaceId 集合（retirement 面）。
  // `runtimeEmitterFor` 对 retired ns 一律 dropStub（`namespace-deleted`）——
  // 绝不 ensureAdapter 重建 adapter；`initStream` 先 un-retire（进程内同 id
  // 重建 = 新 namespace 语义，D4 第二分支）。
  const retiredNamespaces = new Set<string>();
  let closed = false;

  const drop = (reason: DiagnosticEmissionDropReason, namespaceId?: string): void => {
    deps.sink({
      event: 'diagnostic-log-emission-dropped',
      reason,
      ...(namespaceId !== undefined ? { namespaceId } : {}),
    });
  };

  // —— 无归属通道（C1 + issue #226 后语义）：恒丢弃 + 计数；消费方 = Registry
  //    诊断装配（createDiagRuntime）在公共入口无归属拒绝（acceptance/identity——
  //    namespaceId 生成之前）时走的同步共享 emitter；create 槽内建流前结局 #226 起
  //    经 diag-pump 数据键控投递、不再落此通道。事件不携 namespaceId（无归属是该
  //    reason 的词义本体——伪造归属正是要避免的缺陷，§4-D8）。 ——
  const unattributedEmitter: NamespaceDiagnosticChangeEmitter = {
    emit: () => drop(closed ? 'manager-closed' : 'unattributed'),
  };

  const dropStub = (namespaceId: string, reason: DiagnosticEmissionDropReason): NamespaceDiagnosticChangeEmitter => ({
    emit: () => drop(reason, namespaceId),
  });

  /** 唯一构造点（D3/D4）：缓存命中 → 复用；miss → 构造 + 缓存（含 disabled 模式——
   *  E4：rootDir 为普通文件时 adapter 构造不抛、返回 disabled adapter 并缓存）。 */
  const ensureAdapter = (namespaceId: string, genesisUpdateBytes?: Uint8Array): FileDiagnosticLog | undefined => {
    if (closed) return undefined;
    const cached = adapters.get(namespaceId);
    if (cached !== undefined) return cached;
    try {
      const log = createFileDiagnosticLog({
        rootDir: config.rootDir,
        namespaceId,
        ...(genesisUpdateBytes !== undefined ? { genesisUpdateBytes } : {}),
        ...(config.updateCapture !== undefined ? { updateCapture: config.updateCapture } : {}),
        ...(config.inputPolicy !== undefined ? { inputPolicy: config.inputPolicy } : {}),
        ...(config.retention !== undefined ? { retention: config.retention } : {}),
        // 健康观察者（§4-D8）：事件词表/字段白名单 = health.ts 冻结面；namespaceId
        // 入 NDJSON = 组合根既有生命周期事件同款先例（provisioned 等），非 metrics label。
        observer: {
          onEvent: (e) => {
            deps.sink({ event: 'diagnostic-log', namespaceId, ...e });
          },
        },
        clock: { now: deps.now },
      });
      adapters.set(namespaceId, log);
      return log;
    } catch {
      // 结构性不可达防御（P3：adapter 工厂承诺不向调用方抛）——绝不向上传播
      deps.sink({ event: 'diagnostic-log-manager-failed', namespaceId, code: 'ADAPTER_CONSTRUCTION_THREW' });
      return undefined;
    }
  };

  const binding: NamespaceRegistryDiagnosticLog = {
    // 无归属通道（R1 语义；消费方读取方式/吞没边界不变——create-diagnostic.ts）
    emitter: unattributedEmitter,
    // stream 建立缝（void；失败对调用方不可见——Registry 侧吞没边界不变）。
    // issue #228（AD-4/O2）：先 un-retire 再 ensureAdapter——同进程内以同
    // namespaceId 重新 create（如 provision 重建）时新 namespace 正常建流；
    // 次序（先删 retired 再建流）与重建语义自洽。
    initStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined): void => {
      retiredNamespaces.delete(namespaceId);
      void ensureAdapter(namespaceId, genesisUpdateBytes);
    },
    // 数据键控解析（§4-D4）：返回值由 namespaceId 参数与 adapters/closed/
    // retiredNamespaces 三个键控/单调状态决定——不存在任何「上一次调用留下的绑定」
    // （R0 bound 已删除）。
    runtimeEmitterFor: (namespaceId: string): NamespaceDiagnosticChangeEmitter | undefined => {
      if (closed) return dropStub(namespaceId, 'manager-closed');
      // issue #228（AD-4）：retirement 之后的迟到流量 → `namespace-deleted` 丢弃桩
      //（先于 ensureAdapter——retired ns 绝不重建 adapter/绝不建流）
      if (retiredNamespaces.has(namespaceId)) return dropStub(namespaceId, 'namespace-deleted');
      const log = ensureAdapter(namespaceId);
      return log !== undefined ? log.emitter : dropStub(namespaceId, 'stream-unavailable');
    },
  };

  return {
    binding,
    retireNamespace: (namespaceId: string): void => {
      if (closed) return; // close 后无流可收口（manager-closed 通道已覆盖）
      retiredNamespaces.add(namespaceId);
      adapters.delete(namespaceId);
    },
    close: () => {
      if (closed) return; // 幂等（重复调用零副作用）
      closed = true;
      retiredNamespaces.clear();
      adapters.clear();
    },
  };
}
