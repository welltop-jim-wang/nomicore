/**
 * @nomicore/namespace-runtime —— getStatus 组装（D9 → D6，#92 七键）：结构化瞬时 capability 投影。
 *
 * - 每次调用构造全新对象（无共享可变引用）；
 * - lifecycle 三态真话（'ready' | 'closing' | 'closed'——INV-C1 状态机的只读投影）；
 * - read = lifecycle==='ready'（fatal 不 gate read——fatal 后仍可读，INV-C9；
 *   close 后停接纳——#92 新增 gate 语义）；
 * - rootWrite/schemaWrite 是调用瞬时的推导（INV-N9）：
 *     schemaWrite = lifecycle==='ready' && !fatal && writableNow
 *     rootWrite   = 上述 && schema.state !== 'unavailable'（unavailable 后 SCHEMA
 *                   write 仍可修复，ADR-0008），且 preparing 期可接纳（排队等待——
 *                   忠实语义「早期写排在 P0 后」，位值仅是能力真话）；
 * - writableNow 是瞬时观察（ADR-0008「gate 是瞬时观察」）：**仅在 ready 期执行
 *   （短路）**——closing/closed 期三能力位由 lifecycle 域恒 false 决定，不观察 handle
 *   （release 后 handle 处于 'released'，观察无信息增益，且隔离 adapter bug 对
 *   post-close 状态读取面的干扰）；ready 期 handle.getStatus() 自身 throw → 原样传播
 *   （adapter bug，loud——本方法契约同五方法：sync，internal bug 可抛）；
 * - 键集恰七键（lifecycle/read/rootWrite/schemaWrite/schema/fatal/close）；无
 *   queue/sequence/taskType；无数组值字段（INV-N11）；
 * - schema.issue 仅在 unavailable 时存在（exactOptionalPropertyTypes：无 issue 键，
 *   不写 undefined 值键）；fatal === null 在正常路径（preparing/ready/unavailable 均
 *   null——fatal 只来自 internal fault）；close 摘要 = closeIssue ?? null（release
 *   失败后稳定 {code,message}，正常路径 null——永不输出 undefined 值键）。
 */
import type { DocHandle } from '@nomicore/persistence';
import type { RuntimeState } from './p0.js';

/** 结构化瞬时 capability status（七键协议；键集/形状即公共契约——AC5/AC7 锚定，#92）。 */
export interface NamespaceRuntimeStatus {
  /** lifecycle 三态（#92：ready→closing→closed 单向状态机投影）。 */
  readonly lifecycle: 'ready' | 'closing' | 'closed';
  readonly read: { readonly enabled: boolean };
  readonly rootWrite: { readonly enabled: boolean };
  readonly schemaWrite: { readonly enabled: boolean };
  readonly schema: {
    readonly state: 'preparing' | 'ready' | 'unavailable';
    readonly issue?: Readonly<{ code: string; message: string }>;
  };
  readonly fatal: Readonly<{ code: string; message: string }> | null;
  /** close issue 稳定摘要（第七键，#92）：release 失败后稳定 {code,message}（冻结跨调用
   *  同引用）；正常路径 null——不含原始 Error/stack（INV-C5/C8）。 */
  readonly close: Readonly<{ code: string; message: string }> | null;
}

/** 组装 getStatus 产物（D9 → D6）。writableNow 瞬时观察见文件头；ready 期 throw 原样传播。 */
export function buildStatus(handle: DocHandle, state: RuntimeState): NamespaceRuntimeStatus {
  const lifecycle = state.lifecycle;
  const fatal = state.fatal ?? null;
  // writableNow 瞬时观察仅在 ready 期执行（短路）：closing/closed 期写位由 lifecycle 域
  // 恒 false 决定——release 后 handle 处于 'released'，观察无信息增益，且隔离 adapter bug
  // （handle.getStatus() throw）对 post-close 状态读取面的干扰。ready 期 throw 原样传播
  // （#89/#90 既有契约：sync 方法，internal bug 可抛）——零回归。
  const writableNow = lifecycle === 'ready' && handle.getStatus() === 'ready';
  return {
    lifecycle,
    read: { enabled: lifecycle === 'ready' },
    rootWrite: {
      enabled: lifecycle === 'ready' && fatal === null && state.schemaState !== 'unavailable' && writableNow,
    },
    schemaWrite: { enabled: lifecycle === 'ready' && fatal === null && writableNow },
    schema:
      state.schemaState === 'unavailable' && state.schemaIssue !== undefined
        ? { state: state.schemaState, issue: state.schemaIssue }
        : { state: state.schemaState },
    fatal,
    close: state.closeIssue ?? null,
  };
}
