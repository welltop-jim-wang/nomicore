/**
 * @nomicore/namespace-runtime —— getStatus 组装（D9）：结构化瞬时 capability 投影。
 *
 * - 每次调用构造全新对象（无共享可变引用）；
 * - lifecycle 恒 'ready'（v1 子集：close 属后续 issue；类型上仅声明此字面量）；
 * - read 恒 enabled（成功构造后读取恒可用；close 将来才 gate）；
 * - rootWrite/schemaWrite 是调用瞬时的推导（INV-N9）：
 *     schemaWrite = !fatal && handle.getStatus()==='ready'
 *     rootWrite   = 上述 && schema.state !== 'unavailable'（unavailable 后 SCHEMA
 *                   write 仍可修复，ADR-0008），且 preparing 期可接纳（排队等待——
 *                   忠实语义「早期写排在 P0 后」，位值仅是能力真话）；
 * - writableNow 是瞬时观察（ADR-0008「gate 是瞬时观察」）：persistence-degraded /
 *   外部违约 release → 写位 false；handle.getStatus() 自身 throw → 原样传播
 *   （adapter bug，loud——本方法契约同五方法：sync，internal bug 可抛）；
 * - 键集恰六键（lifecycle/read/rootWrite/schemaWrite/schema/fatal）；无
 *   queue/sequence/taskType；无数组值字段（INV-N11）；
 * - schema.issue 仅在 unavailable 时存在（exactOptionalPropertyTypes：无 issue 键，
 *   不写 undefined 值键）；fatal === null 在正常路径（preparing/ready/unavailable 均
 *   null——fatal 只来自 internal fault）。
 */
import type { DocHandle } from '@nomicore/persistence';
import type { RuntimeState } from './p0.js';

/** 结构化瞬时 capability status（六键协议；键集/形状即公共契约——AC7 锚定）。 */
export interface NamespaceRuntimeStatus {
  readonly lifecycle: 'ready';
  readonly read: { readonly enabled: boolean };
  readonly rootWrite: { readonly enabled: boolean };
  readonly schemaWrite: { readonly enabled: boolean };
  readonly schema: {
    readonly state: 'preparing' | 'ready' | 'unavailable';
    readonly issue?: Readonly<{ code: string; message: string }>;
  };
  readonly fatal: Readonly<{ code: string; message: string }> | null;
}

/** 组装 getStatus 产物（D9）。writableNow 瞬时观察见文件头；throw 原样传播。 */
export function buildStatus(handle: DocHandle, state: RuntimeState): NamespaceRuntimeStatus {
  const writableNow = handle.getStatus() === 'ready'; // 瞬时观察
  const fatal = state.fatal ?? null;
  return {
    lifecycle: 'ready',
    read: { enabled: true },
    rootWrite: {
      enabled: fatal === null && state.schemaState !== 'unavailable' && writableNow,
    },
    schemaWrite: { enabled: fatal === null && writableNow },
    schema:
      state.schemaState === 'unavailable' && state.schemaIssue !== undefined
        ? { state: state.schemaState, issue: state.schemaIssue }
        : { state: state.schemaState },
    fatal,
  };
}
