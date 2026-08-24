/**
 * @nomicore/namespace-runtime —— Runtime 构造与八键公共面（设计 §3/§4 D1/D2/D3/D6/D8'）。
 *
 * 构造序（D1，R2 修订落实 SA2 #3/#4——一切 throw 与一切 seam 读取均在入队前）：
 *  V1 形状守卫（loud TypeError；seam 字段全部读取限于构造栈内有限次——校验与捕获
 *     合并、均在入队前，入队后零读取（INV-N14，SA4 N-1 精确化措辞）；此时零副作用）；
 *  V2 状态门（getStatus() ∈ {ready, persistence-degraded} 放行；released/disposed/
 *     未知值 → NamespaceRuntimeConstructionError throw——零副作用，INV-N4）；
 *  V3 所有权转移（全部在入队前求值）：身份/载体一次捕获 → state 初始化 →
 *      env 一次成型（纯数据闭包）→ P0 入队（thunk = 纯调用 () => runP0(env)，
 *      零属性读取/零字面量构造/无可抛点）→ writeEnv 一次成型（D6.2）→
 *      八键对象构造并 freeze。
 *
 * 公共面（D2）：对象字面量 + 闭包（非 class 实例）——原型链是 Object.prototype，
 * handle/Y.Doc/sequencer/state 只存在于闭包；Object.freeze(runtime) 防属性注入。
 * 八键恰好：owner / namespaceId / read / getSchemaEnvelope / getMetadata /
 * getActiveSchema / getStatus / mutateRoot（第八键 = 唯一公共 ROOT 写入口，D1）。
 * 生产工厂 createNamespaceRuntime 保留包内，index.ts 不 re-export（AC1 锁定
 * entry.createNamespaceRuntime === undefined）。
 *
 * 外部 release 后的行为（v1 边界，R3）：runtime 独占的是构造时取得的那份租约；
 * 调用方越过 runtime 直接 handle.release() 属调用方违约。后果仅体现为 D9 的写位
 * 瞬时观察转 false（写槽 S2 同拒）；读取面继续观察 live Y.Doc 引用（不崩、不静默换源）。
 */
import type * as Y from 'yjs';
import type { DocHandle } from '@nomicore/persistence';
import { readLogicalValueAtPath } from '@nomicore/doc-runtime';
import type { ReadLogicalValueResult } from '@nomicore/doc-runtime';
import { compileSchemaEnvelope } from '@nomicore/vfsl';
import type { CompileSchemaEnvelopeResult, SchemaEnvelope } from '@nomicore/vfsl';
import { NamespaceRuntimeConstructionError } from './errors.js';
import { runP0 } from './p0.js';
import type { ActiveSchemaInfo, P0Env, RuntimeState } from './p0.js';
import { projectMetadata, projectSchemaEnvelope } from './projection.js';
import { WriteSequencer } from './sequencer.js';
import { buildStatus } from './status.js';
import type { NamespaceRuntimeStatus } from './status.js';
import { runRootWriteSlot } from './write.js';
import type { MutateRootResult, WriteEnv } from './write.js';

/** seam 输入（D8'）：包内确定性测试接缝；@internal 沿 doc-runtime getCompiledWith 先例。 */
export interface NamespaceRuntimeSeamInput {
  /** 注入的独占租约（所有权经本 seam 转移）。 */
  readonly handle: DocHandle;
  /** P0 编译前 await 的可控门（resolve 控制；缺省无门）。 */
  readonly p0Gate?: Promise<void>;
  /** 注入编译步（缺省 vfsl compileSchemaEnvelope；抛错 = internal fault 注入）。 */
  readonly compile?: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
  /** mutation 后 dirty notification 接缝（ADR-0008 原文命名，D6.1）：构造方绑定
   *  persistence.saveDoc(handle)；测试经 seam 注入确定性 notifier。缺省 = 未绑定
   *  （写槽 S2 loud 拒绝——D6.4 拒绝虚假降级立法，非静默 no-op）。 */
  readonly notifyDirty?: () => Promise<void>;
}

/** Runtime 公共形状（D2 八键协议；键集/形状即公共契约——AC2 锚定）。 */
export interface NamespaceRuntime {
  /** 冻结的 owner 身份投影（只投影 userId）。 */
  readonly owner: Readonly<{ userId: string }>;
  /** namespaceId（= handle.docId，string 原始值天然不可变）。 */
  readonly namespaceId: string;
  /** 透传 readLogicalValueAtPath(doc, path) 的同步结果联合（D3 零包装）。 */
  readonly read: (path: readonly (string | number)[]) => ReadLogicalValueResult;
  /** SCHEMA 四标准键投影（D4；载体缺席/异型 → null；非 primitive 值 → loud throw）。 */
  readonly getSchemaEnvelope: () => SchemaEnvelope | null;
  /** META 全键深拷贝（D5；载体异常/值域违规 → loud throw）。 */
  readonly getMetadata: () => Record<string, unknown>;
  /** active schema 五字段身份（D8；preparing/unavailable/fatal 期 null）。 */
  readonly getActiveSchema: () => ActiveSchemaInfo | null;
  /** 结构化瞬时 capability status（D9；每次调用全新对象）。 */
  readonly getStatus: () => NamespaceRuntimeStatus;
  /** 唯一公共 ROOT 写入口（D1）：同步接纳定序（FIFO 由调用顺序决定）；
   *  不同步 throw、不同步结算——任何拒绝（gate/校验/快照）都经返回的 Promise 结算；
   *  internal fatal 经 Promise rejection（RuntimeWriteFatalError）。 */
  readonly mutateRoot: (mutation: unknown) => Promise<MutateRootResult>;
}

/**
 * 包内确定性 seam 构造器（AC8；@internal——唯一导出构造路径，生产工厂保留包内）。
 * 全同步：V1 形状守卫 → V2 状态门 → V3 入队 + 返回（P0 经 sequencer 微任务起步，
 * 绝不在构造调用栈内同步结算——INV-N1）。构造 throw 路径零副作用（INV-N4：
 * 所有校验/身份捕获均前置于 enqueue，任何 throw 都在 P0 微任务启动之前）。
 */
export function createNamespaceRuntimeWithSeam(input: NamespaceRuntimeSeamInput): NamespaceRuntime {
  // V1 形状守卫（seam 字段捕获为局部常量——读取均限构造栈内、入队前；任何不满足即
  // throw，此时零副作用）
  const captured = captureSeamInput(input);
  const { handle, userId, docId, doc } = captured;

  // V2 状态门（所有权转移的判定时点是 V2 放行）
  const status0 = handle.getStatus();
  if (status0 !== 'ready' && status0 !== 'persistence-degraded') {
    // 'released'/'disposed'/未知值 → 同 throw（DocHandleStatus 词表冻结于 ADR-0006；
    // 未知值 = adapter 契约违背，loud 而非猜测降级）。类不导出（errors.ts），
    // 稳定 message 供诊断：code 'HANDLE_NOT_USABLE' + 观测状态值。
    throw new NamespaceRuntimeConstructionError(
      `HANDLE_NOT_USABLE: DocHandle 状态 ${status0} 不可构造（接受 ready/persistence-degraded）`,
    );
  }

  // V3b seam 编译步捕获（缺省 vfsl compileSchemaEnvelope——`??` 无隐式降级语义：
  //   seam 提供即注入，未提供即真实编译步）
  const compile = captured.compile ?? compileSchemaEnvelope;

  // 运行态（闭包私有；唯一可变源——P0 终态迁移单点写入，读取方法零写）
  const state: RuntimeState = { schemaState: 'preparing' };

  // V3c env 一次成型（INV-N14：纯数据闭包——thunk 内零求值面、无可抛点）
  const env: P0Env = { doc, state, p0Gate: captured.p0Gate, compile };

  // V3c' writeEnv 一次成型（D6.2：写槽纯数据闭包；notifyDirty 显式 undefined 联合）
  const writeEnv: WriteEnv = { doc, handle, state, notifyDirty: captured.notifyDirty };

  // V3d sequencer + P0 入队（INV-N1：return 前 P0 已是队首 pending 节点；微任务起步；
  //     thunk = 纯调用 () => runP0(env)，零属性读取/零字面量构造/无可抛点——
  //     INV-N12 的「槽体全 catch」从此是结构事实）
  const sequencer = new WriteSequencer();
  void sequencer.enqueue(() => runP0(env));

  // V3e 公共面（八键闭包对象；owner/namespaceId 由 V3a 捕获局部量构造——不再解引用成员）
  const owner = Object.freeze({ userId });
  const runtime: NamespaceRuntime = {
    owner,
    namespaceId: docId,
    read: (path) => readLogicalValueAtPath(doc, path), // D3 纯透传（INV-N10）
    getSchemaEnvelope: () => projectSchemaEnvelope(doc, 'public'), // D4（INV-N13 守卫）
    getMetadata: () => projectMetadata(doc), // D5（深拷贝 / 载体与值域双 loud）
    getActiveSchema: () => state.activeInfo ?? null, // D8
    getStatus: () => buildStatus(handle, state), // D9（handle 仅用于 writableNow 瞬时观察）
    mutateRoot: (mutation: unknown): Promise<MutateRootResult> =>
      // D1：同步接纳定序（enqueue 同步拼尾）+ 槽完成信号；thunk 是纯调用——
      // mutation 引用仅被捕获不被读取（Proxy 零触发），无可抛点（INV-W1/W14）
      sequencer.enqueue(() => runRootWriteSlot(writeEnv, mutation)),
  };
  return Object.freeze(runtime);
}

/**
 * 生产构造器（包内，index.ts 不导出——AC1 锁定）。D6.3：绑定义务显式化为必填参数——
 * 未来 Registry 传 `() => persistence.saveDoc(handle)`（ADR-0008「由构造方绑定」）。
 * @internal
 */
export function createNamespaceRuntime(
  handle: DocHandle,
  notifyDirty: () => Promise<void>,
): NamespaceRuntime {
  return createNamespaceRuntimeWithSeam({ handle, notifyDirty });
}

/** V1 形状守卫 + 捕获（INV-N14：seam 字段读取全部限于构造栈内有限次——V1 校验读取与
 *  捕获合并于本函数、均在 enqueue 之前；入队后零读取（thunk/槽体/公共面只消费捕获的
 *  局部量——flaky getter 的任何行为在构造期 throw 或已被捕获，入队后对 runtime 不可
 *  观测）。此后 runtime 只消费局部量。 */
function captureSeamInput(input: unknown): {
  handle: DocHandle;
  userId: string;
  docId: string;
  doc: Y.Doc;
  p0Gate: Promise<void> | undefined;
  compile: ((envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult) | undefined;
  notifyDirty: (() => Promise<void>) | undefined;
} {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('seam 输入必须是对象（{ handle, p0Gate?, compile?, notifyDirty? }）');
  }
  const rec = input as Record<string, unknown>;
  // handle 形状（防御 seam 调用方传残缺 handle——残缺任何 throw 均在入队前，INV-N4）
  const handle = rec.handle;
  if (typeof handle !== 'object' || handle === null) {
    throw new TypeError('seam 输入缺少 handle（必须为 DocHandle 形状对象）');
  }
  const h = handle as Record<string, unknown>;
  if (typeof h.getStatus !== 'function') {
    throw new TypeError('handle.getStatus 必须为 function（DocHandle 契约）');
  }
  const owner = h.owner;
  if (typeof owner !== 'object' || owner === null) {
    throw new TypeError('handle.owner 必须为对象（User 契约）');
  }
  const userId = (owner as Record<string, unknown>).userId;
  if (typeof userId !== 'string') {
    throw new TypeError('handle.owner.userId 必须为 string（User 契约）');
  }
  const docId = h.docId;
  if (typeof docId !== 'string') {
    throw new TypeError('handle.docId 必须为 string（DocHandle 契约）');
  }
  const doc = h.doc;
  if (typeof doc !== 'object' || doc === null) {
    throw new TypeError('handle.doc 必须为对象（Y.Doc 契约）');
  }
  // seam 可选字段（捕获为局部常量——读取均限构造栈内、入队前）
  let p0Gate: Promise<void> | undefined;
  if (rec.p0Gate !== undefined) {
    const g = rec.p0Gate;
    if (typeof g !== 'object' || g === null || typeof (g as { then?: unknown }).then !== 'function') {
      throw new TypeError('input.p0Gate 若提供必须是 thenable（Promise）');
    }
    p0Gate = g as Promise<void>;
  }
  let compile: ((envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult) | undefined;
  if (rec.compile !== undefined) {
    if (typeof rec.compile !== 'function') {
      throw new TypeError('input.compile 若提供必须是 function');
    }
    compile = rec.compile as (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
  }
  let notifyDirty: (() => Promise<void>) | undefined;
  if (rec.notifyDirty !== undefined) {
    if (typeof rec.notifyDirty !== 'function') {
      throw new TypeError('input.notifyDirty 若提供必须是 function（persistence.saveDoc(handle) 窄接缝）');
    }
    notifyDirty = rec.notifyDirty as () => Promise<void>;
  }
  return {
    handle: handle as DocHandle,
    userId: userId as string,
    docId: docId as string,
    doc: doc as Y.Doc,
    p0Gate,
    compile,
    notifyDirty,
  };
}
