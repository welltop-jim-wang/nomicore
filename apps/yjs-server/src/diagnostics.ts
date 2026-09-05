/**
 * #155（§5.2/§4-D3/§4-D4/§4-D7/§4-D8）Host 诊断管理器——`@nomicore/yjs-server`
 * 组合根对 `@nomicore/namespace-registry` 诊断 seam 的生产供应方。
 *
 * 职责：
 * - **per-namespace File adapter 缓存 = AC3 单 writer**：进程寿命内恒一实例
 *   （`Map<namespaceId, FileDiagnosticLog>`）；Runtime generation 更替（idle close →
 *   reopen）复用同一 adapter 对象（对象同一性），跨进程经 current.json 续写（#153）。
 * - **无归属通道（C1 修订后语义）**：`binding.emitter` 恒丢弃 + 计数
 *   （`unattributed`/`manager-closed`）——`createCreateDiag` 构造期捕获的共享
 *   emitter（全部 initStream 之前的 create emission 落此通道，绝不伪造归属）。
 * - **数据键控归因（§4-D4）**：`binding.runtimeEmitterFor(ns)` 每次以 namespaceId
 *   对 `Map` 查表——归因键是数据不是时间，C1 竞态类别整体消灭。
 * - **有界 drain（§4-D7）**：close() = closed 置位 + Map 引用释放，O(1)、幂等、
 *   零 fs、零 await——first-slice File adapter 无队列/无常驻 fd，停机无积压可冲。
 * - **健康面（§4-D8）**：adapter observer → NDJSON 事件
 *   `{ event: 'diagnostic-log', namespaceId, ...健康事件 }`（词表/字段白名单 =
 *   包侧 health.ts 冻结面）；管理器自身事件 = 丢弃计数
 *   `{ event: 'diagnostic-log-emission-dropped', reason, namespaceId? }` 与
 *   `{ event: 'diagnostic-log-manager-failed', code }`（结构性不可达防御）。
 *
 * 构造期同步 fs（mkdir / manifest `'wx'` / genesis append / current.json rename +
 * reopen 健康分析 + 构造期 retention sweep——#154 `sweepOnOpen` 缺省 true）只发生在
 * Registry open/create/import 槽内（write sequencer 尚不存在——#153 纪律合规落点，
 * 每 namespace 每进程至多一次；D3/M3 成本注记）。
 */
import { createFileDiagnosticLog, type FileDiagnosticLog } from '@nomicore/namespace-diagnostic-log';
import type { NamespaceDiagnosticChangeEmitter } from '@nomicore/namespace-diagnostic-log';
import type { NamespaceRegistryDiagnosticLog } from '@nomicore/namespace-registry';
import type { DiagnosticsConfig } from './config.js';
import type { EventSink } from './lifecycle.js';

/** 丢弃 reason 封闭词表（§4-D8：三值各有唯一产生方——unattributed = 共享无归属
 *  通道；stream-unavailable = runtimeEmitterFor 解析未命中丢弃桩（结构性不可达）；
 *  manager-closed = close() 之后的两条通道。E4 走 disabled-adapter 缓存路径不落
 *  stream-unavailable——构造不抛、返回 disabled 模式 adapter）。 */
export type DiagnosticEmissionDropReason = 'unattributed' | 'stream-unavailable' | 'manager-closed';

export interface HostDiagnosticsManager {
  /**
   * Registry seam binding：
   * - `emitter` = 无归属通道（恒丢弃 + 计数；零路由逻辑——C1）；
   * - `initStream(ns, bytes)` = ensureAdapter 建流 + 缓存（void；#150 签名零改动）；
   * - `runtimeEmitterFor(ns)` = 数据键控解析（缓存命中/构造成功 → adapter.emitter；
   *   构造不可用 → 丢弃桩；closed → `manager-closed` 丢弃桩）。
   */
  readonly binding: NamespaceRegistryDiagnosticLog;
  /** O(1) 结构性收口（§4-D7）：closed 置位 + Map 引用释放；幂等；零 fs、零 await。 */
  close(): void;
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
  let closed = false;

  const drop = (reason: DiagnosticEmissionDropReason, namespaceId?: string): void => {
    deps.sink({
      event: 'diagnostic-log-emission-dropped',
      reason,
      ...(namespaceId !== undefined ? { namespaceId } : {}),
    });
  };

  // —— 无归属通道（C1）：恒丢弃 + 计数；消费方 = createCreateDiag 构造期捕获的
  //    共享 emitter（全部 initStream 之前的 create emission）。事件不携 namespaceId
  //    （无归属是该 reason 的词义本体——伪造归属正是要避免的缺陷，§4-D8）。 ——
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
    // stream 建立缝（void；失败对调用方不可见——Registry 侧吞没边界不变）
    initStream: (namespaceId: string, genesisUpdateBytes: Uint8Array | undefined): void => {
      void ensureAdapter(namespaceId, genesisUpdateBytes);
    },
    // 数据键控解析（§4-D4）：返回值由 namespaceId 参数与 adapters/closed 两个
    // 键控/单调状态决定——不存在任何「上一次调用留下的绑定」（R0 bound 已删除）。
    runtimeEmitterFor: (namespaceId: string): NamespaceDiagnosticChangeEmitter | undefined => {
      if (closed) return dropStub(namespaceId, 'manager-closed');
      const log = ensureAdapter(namespaceId);
      return log !== undefined ? log.emitter : dropStub(namespaceId, 'stream-unavailable');
    },
  };

  return {
    binding,
    close: () => {
      if (closed) return; // 幂等（重复调用零副作用）
      closed = true;
      adapters.clear();
    },
  };
}
