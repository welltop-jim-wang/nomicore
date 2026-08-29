/**
 * @nomicore/namespace-runtime —— Runtime 构造与十键公共面（设计 §3/§4 D1/D2/D3/D6/D8'）。
 *
 * 构造序（D1，R2 修订落实 SA2 #3/#4——一切 throw 与一切 seam 读取均在入队前）：
 *  V1 形状守卫（loud TypeError；seam 字段全部读取限于构造栈内有限次——校验与捕获
 *     合并、均在入队前，入队后零读取（INV-N14，SA4 N-1 精确化措辞）；此时零副作用）；
 *  V2 状态门（getStatus() ∈ {ready, persistence-degraded} 放行；released/disposed/
 *     未知值 → NamespaceRuntimeConstructionError throw——零副作用，INV-N4）；
 *  V3 所有权转移（全部在入队前求值）：身份/载体一次捕获 → state 初始化 →
 *      env 一次成型（纯数据闭包）→ P0 入队（thunk = 纯调用 () => runP0(env)，
 *      零属性读取/零字面量构造/无可抛点）→ writeEnv 一次成型（D6.2）→
 *      十键对象构造并 freeze。
 *
 * 公共面（D2）：对象字面量 + 闭包（非 class 实例）——原型链是 Object.prototype，
 * handle/Y.Doc/sequencer/state 只存在于闭包；Object.freeze(runtime) 防属性注入。
 * 十键恰好（issue #89/#90/#91/#92）：owner / namespaceId / read / getSchemaEnvelope /
 * getMetadata / getActiveSchema / getStatus / mutateRoot（第八键 = 唯一公共 ROOT 写
 * 入口，D1）+ replaceSchema（第九键，issue #91，唯一公共 SCHEMA 写入口）
 * **+ close（第十键，issue #92——close 生命周期：幂等、同步进 closing、队尾 barrier；
 * 详见接口 JSDoc 与 close.ts）**。read/write 与三数据投影 getter 的接纳门（lifecycle
 * gate）住在公共方法层（D4/D5.1）：closing/closed 期 read 同步结果联合拒绝、三 getter
 * 同步 throw RUNTIME_READ_DISABLED（D-2，#93 rev2）、两种写同步入队拒绝（零入队）；
 * 槽内不设 lifecycle gate——已接纳任务无条件排空（ADR-0008）。
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
import type { DiagnosticIssue, NamespaceDiagnosticChangeEmitter } from '@nomicore/namespace-diagnostic-log';
import {
  NamespaceRuntimeConstructionError,
  RUNTIME_READ_DISABLED_CODE,
  RUNTIME_WRITE_DISABLED_CODE,
  RuntimeReadDisabledError,
} from './errors.js';
import { runP0 } from './p0.js';
import type { ActiveSchemaInfo, P0Env, RuntimeState } from './p0.js';
import { projectMetadata, projectSchemaEnvelope } from './projection.js';
import { WriteSequencer } from './sequencer.js';
import { buildStatus } from './status.js';
import type { NamespaceRuntimeStatus } from './status.js';
import { runCloseBarrier } from './close.js';
import type { CloseEnv } from './close.js';
import { runSchemaWriteSlot } from './schema-write.js';
import type { ReplaceSchemaInput, ReplaceSchemaResult, SchemaWriteEnv } from './schema-write.js';
import { runRootWriteSlot } from './write.js';
import { disabled } from './write.js';
import type { MutateRootResult, WriteEnv } from './write.js';
import { buildDiagnosticEnv, createSlotDiag, emitAttempt, emitSlot } from './diagnostic.js';
import type { DiagnosticEnv } from './diagnostic.js';

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
  /** [新增，issue #149] 诊断发射接缝（ADR-0011 §E emitter 接口）。缺省 = 未装配
   *  （零 emit、零 update 订阅——既有全部测试与生产路径行为等价）。 */
  readonly diagnosticEmitter?: NamespaceDiagnosticChangeEmitter;
  /** [新增，issue #149] 诊断 observedAt 的注入 Clock（结构兼容 @nomicore/clock
   *  Clock.now / 诊断包 emission.ts observedAtFrom）。与 diagnosticEmitter **成对**：
   *  装配 emitter 而缺 clock ⇒ 构造期 loud 拒绝（captureSeamInput）——消除「装配日志
   *  而静默走系统墙钟」形态（ADR-0012 §observedAt；SA2 #5 立法）。 */
  readonly clock?: () => number;
}

/** closing/closed 期 read 拒绝分支（#92）：ADR-0008 读取能力节「预期路径、载体和
 *  lifecycle 失败使用同步结果联合」——lifecycle 失败不是路径缺陷，独立稳定码
 *  RUNTIME_READ_DISABLED（不借用 PATH_NOT_ALLOWED 把生命周期失败伪装成路径缺陷）。 */
export interface RuntimeReadDisabledResult {
  readonly ok: false;
  readonly code: 'RUNTIME_READ_DISABLED';
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/** read 结果联合（#92 宽化）：ready 期透传 ReadLogicalValueResult 逐字节不变；
 *  closing/closed 期返回 RuntimeReadDisabledResult 新分支（加法扩展，ok 判别兼容）。 */
export type NamespaceRuntimeReadResult = ReadLogicalValueResult | RuntimeReadDisabledResult;

/** Runtime 公共形状（D2 十键协议；键集/形状即公共契约——AC2/AC6/AC8 锚定）。 */
export interface NamespaceRuntime {
  /** 冻结的 owner 身份投影（只投影 userId）。 */
  readonly owner: Readonly<{ userId: string }>;
  /** namespaceId（= handle.docId，string 原始值天然不可变）。 */
  readonly namespaceId: string;
  /** 透传 readLogicalValueAtPath(doc, path) 的同步结果联合（D3 零包装，ready 期）；
   *  lifecycle≠ready 期返回 RuntimeReadDisabledResult（同步、非抛、非 Promise——
   *  D4 lifecycle gate 即时生效，不等待已接纳任务排空）。 */
  readonly read: (path: readonly (string | number)[]) => NamespaceRuntimeReadResult;
  /** SCHEMA 四标准键投影（D4；载体缺席 → null，载体异型 → loud throw NSRT-SCHEMA-E2；
   *  非 primitive 值 → loud throw）。
   *  lifecycle≠ready（closing/closed）期同步 throw RuntimeReadDisabledError（code
   *  RUNTIME_READ_DISABLED，包内类）——close 停接纳覆盖全部公共数据投影；getStatus
   *  不受影响（全生命周期观测面）。 */
  readonly getSchemaEnvelope: () => SchemaEnvelope | null;
  /** META 全键深拷贝（D5；载体异常/值域违规 → loud throw）。
   *  lifecycle≠ready（closing/closed）期同步 throw RuntimeReadDisabledError（code
   *  RUNTIME_READ_DISABLED，包内类）——close 停接纳覆盖全部公共数据投影；getStatus
   *  不受影响（全生命周期观测面）。 */
  readonly getMetadata: () => Record<string, unknown>;
  /** active schema 五字段身份（D8；preparing/unavailable/fatal 期 null）。
   *  lifecycle≠ready（closing/closed）期同步 throw RuntimeReadDisabledError（code
   *  RUNTIME_READ_DISABLED，包内类）——close 停接纳覆盖全部公共数据投影；getStatus
   *  不受影响（全生命周期观测面）。 */
  readonly getActiveSchema: () => ActiveSchemaInfo | null;
  /** 结构化瞬时 capability status（D9 → D6，#92 七键；每次调用全新对象）。 */
  readonly getStatus: () => NamespaceRuntimeStatus;
  /** 唯一公共 ROOT 写入口（D1）：同步接纳定序（FIFO 由调用顺序决定）；
   *  不同步 throw、不同步结算——任何拒绝（gate/校验/快照）都经返回的 Promise 结算；
   *  internal fatal 经 Promise rejection（RuntimeWriteFatalError）。
   *  #92 接纳门（D5.1）：lifecycle≠ready 时同步不入队、经返回 Promise 即时 settle
   *  领域化联合（RUNTIME_WRITE_DISABLED）——零输入访问、零 doc 副作用。 */
  readonly mutateRoot: (mutation: unknown) => Promise<MutateRootResult>;
  /** 唯一公共 SCHEMA 写入口（D1，issue #91）：与 mutateRoot 共享同一严格 FIFO write
   *  sequencer（同步接纳定序）；不依赖当前 schema 可编译（P0 unavailable 照常入槽，
   *  成功后恢复 ROOT write）；不同步 throw/结算——一切拒绝经返回的 Promise 结算；
   *  internal fatal 经 Promise rejection（RuntimeWriteFatalError）。
   *  #92 接纳门（D5.1）：同 mutateRoot——lifecycle≠ready 时零入队即时 ok:false。 */
  readonly replaceSchema: (input: ReplaceSchemaInput) => Promise<ReplaceSchemaResult>;
  /** 第十键（#92）：close 生命周期入口（ADR-0008「close() 幂等」）。
   *  幂等：所有调用（并发/顺序/已结算后）返回**同一 Promise 实例**（INV-C2）——
   *  barrier 恰入队一次、release 恰一次。
   *  首次调用**同步**进入 'closing' 并立即停止接纳公共 read/write（read 同步结果联合
   *  拒绝、两种写同步零入队拒绝——D4/D5.1）；close 前已接纳任务无条件排空（不取消、
   *  不设内部 timeout）；barrier 排在队列队尾、恰调一次 handle.release()（D3）。
   *  无论 release 成败 Runtime 都进入 'closed'；release 失败时本 Promise reject
   *  （稳定 NamespaceRuntimeCloseError，恒定 message + cause 保留原始异常——包内类，
   *  分类消费走 getStatus().close 摘要或 reason.code 字符串），后续调用返回同一
   *  已结算 Promise（同 rejection 原因，INV-C5）。
   *  【#92 / SA2 R-2】重入语义：在已接纳任务的槽体/notifier 回调内**同步**调用
   *  close() 属 FIFO 队尾语义——barrier 排在该任务之后，良定义无害（该写照常 settle、
   *  release 仍恰一次且晚于它）；但在 notifier 内 **await 本 close Promise 之后才
   *  放行**将构成自等待死锁（该写等 notifier → notifier 等 barrier → barrier 等该写
   *  settle）——close 与该写双双永挂起，属「不取消、不设内部 timeout」的契约行为，
   *  调用方不得如此使用。 */
  readonly close: () => Promise<void>;
}

/**
 * 包内确定性 seam 构造器（AC8；@internal）。#93 rev2（D-1）收口：seam 与生产工厂
 * createNamespaceRuntime 一并保留本文件模块级导出，index.ts 对二者零 re-export——
 * 「包内」= 包内模块通道相对导入（测试经 '../src/runtime.js' 消费 seam），不经公共
 * 入口，亦不设 ./testing 子路径 export（与 index.ts 头注公共面纪律段对齐）。
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

  // 运行态（闭包私有；唯一可变源——P0 终态迁移单点写入，读取方法零写；
  //   #92：lifecycle 写入点仅 close() 同步段与 runCloseBarrier 两处——INV-C1）
  const state: RuntimeState = { schemaState: 'preparing', lifecycle: 'ready' };

  // V3c env 一次成型（INV-N14：纯数据闭包——thunk 内零求值面、无可抛点）
  const env: P0Env = { doc, state, p0Gate: captured.p0Gate, compile };

  // V3c' writeEnv 一次成型（D6.2：写槽纯数据闭包；notifyDirty 显式 undefined 联合）
  const writeEnv: WriteEnv = { doc, handle, state, notifyDirty: captured.notifyDirty };

  // V3c'' schemaWriteEnv 一次成型（D10 零新增注入点：同一批捕获局部量——compile 与
  //   writeEnv 共源的既有 seam 字段同时服务 P0 与 SCHEMA 写槽）
  const schemaWriteEnv: SchemaWriteEnv = { doc, handle, state, notifyDirty: captured.notifyDirty, compile };

  // V3c''' closeEnv 一次成型（D2/D3：barrier 纯数据闭包——release 槽体零读 seam 输入）
  const closeEnv: CloseEnv = { handle, state };

  // V3c'''' diagEnv 一次成型（issue #149：诊断环境纯数据闭包——emitter/clock 成对性
  //   已由 captureSeamInput 校验前置保证；未装配 = 零 emit 零订阅，行为等价）
  const diagEnv = buildDiagnosticEnv(captured.diagnosticEmitter, captured.clock);

  // V3d sequencer + P0 入队（INV-N1：return 前 P0 已是队首 pending 节点；微任务起步；
  //     thunk = 纯调用 () => runP0(env)，零属性读取/零字面量构造/无可抛点——
  //     INV-N12 的「槽体全 catch」从此是结构事实）
  const sequencer = new WriteSequencer();
  void sequencer.enqueue(() => runP0(env));

  // V3d' closePromise 幂等缓存（INV-C2 的载体——并发/已结算后调用返回同一实例）
  let closePromise: Promise<void> | undefined;

  // V3e 公共面（十键闭包对象；owner/namespaceId 由 V3a 捕获局部量构造——不再解引用成员）
  const owner = Object.freeze({ userId });
  const runtime: NamespaceRuntime = {
    owner,
    namespaceId: docId,
    read: (path) => {
      // D4 lifecycle gate 在透传**之前**：closing/closed 期同步结果联合拒绝（非抛、
      // 非 Promise、零触碰 live Y.Doc——RED 锚 case 2/4 三重锁）；ready 期透传分支
      // 逐字节不变（既有 read 锚零回归）
      const lifecycle = state.lifecycle;
      return lifecycle === 'ready'
        ? readLogicalValueAtPath(doc, path)
        : readDisabled(lifecycle, path);
    },
    getSchemaEnvelope: () => {
      // D2（#93 rev2，SA8 裁决 B）：数据投影 getter 停接纳——key 仅 lifecycle（裁决 H：
      // 绝不 keyed on fatal/schemaState）；拒绝先于触碰 live Y.Doc（INV 同 read() 分支）
      if (state.lifecycle !== 'ready') {
        throw new RuntimeReadDisabledError('getSchemaEnvelope', state.lifecycle);
      }
      return projectSchemaEnvelope(doc, 'public'); // D4（INV-N13 守卫）
    },
    getMetadata: () => {
      // D2（#93 rev2，SA8 裁决 B）：同 getSchemaEnvelope——key 仅 lifecycle；拒绝先于
      // 深拷贝递归（零触碰 live Y.Doc——F-3 原始 RangeError 不外泄的证明面）
      if (state.lifecycle !== 'ready') {
        throw new RuntimeReadDisabledError('getMetadata', state.lifecycle);
      }
      return projectMetadata(doc); // D5（深拷贝 / 载体与值域双 loud）
    },
    getActiveSchema: () => {
      // D2（#93 rev2，SA8 裁决 B）：同 getSchemaEnvelope——key 仅 lifecycle；不触 doc
      if (state.lifecycle !== 'ready') {
        throw new RuntimeReadDisabledError('getActiveSchema', state.lifecycle);
      }
      return state.activeInfo ?? null; // D8（preparing/unavailable/fatal 期 null 照常）
    },
    getStatus: () => buildStatus(handle, state), // D9 → D6（handle 仅用于 ready 期 writableNow 瞬时观察）
    mutateRoot: (mutation: unknown): Promise<MutateRootResult> => {
      // D5.1 接纳门：lifecycle≠ready 时同步零入队拒绝（INV-C3）——经返回 Promise
      // 即时 settle 领域化联合（不 throw、不读 mutation——Proxy 零触发、零 doc 副作用）
      if (state.lifecycle !== 'ready') {
        const result = disabled(lifecycleWriteRefusal(state.lifecycle));
        // [issue #149] acceptance 拒绝（零入队路径无 slot）：公共入口即记录点
        // （ADR-0011 §F）；issues 与业务返回同源透传（同一 disabled 数组引用，§9.3）
        if (result.ok === false) {
          emitAttempt(diagEnv, {
            operation: 'root-mutation',
            stage: 'acceptance',
            result: { kind: 'rejected' },
            code: RUNTIME_WRITE_DISABLED_CODE,
            input: { status: 'not-accessed' },
            issues: result.issues as DiagnosticIssue[],
          });
        }
        return Promise.resolve(result);
      }
      // D1：同步接纳定序（enqueue 同步拼尾）+ 槽完成信号；thunk 是纯调用——
      // mutation 引用仅被捕获不被读取（Proxy 零触发），无可抛点（INV-W1/W14）
      const diag = diagEnv.emitter !== undefined ? createSlotDiag('root-mutation') : undefined;
      const settled = sequencer.enqueue(() => runRootWriteSlot(writeEnv, mutation, diag));
      // [issue #149] emitSlot 挂点：作为 enqueue 返回 promise 的**附加反应**（非包装——
      // 返回面仍是 settled 本体：基线 promise 身份与结算时点逐字节不变，无「派生 promise/
      // 多一跳微任务」差异——SA2 #6 登记差异的最优解）。执行序（设计 §7.1 证明）：settled
      // settle 时依注册序 [内部 noop, emitSlot]；noop 使 tail settle 并排程下一任务 thunk
      // ——emitSlot 先于下一任务（emit 顺序 ≡ 槽完成顺序 ≡ FIFO；amendment C：slot 已释放
      // 后的微任务）。结算事实入参——缺省组装仅在 r.ok === true 时生效（§7.3）。
      // emitSlot 自身吞没一切（emitAttempt）；onErr 不重抛——caller 经 settled 观察原
      // rejection，本反应链恒绿（无可抛点、无 unhandled rejection）。
      void settled.then(
        (r) => { emitSlot(diagEnv, diag, { kind: 'fulfilled', value: r }); },
        (e) => { emitSlot(diagEnv, diag, { kind: 'rejected' }); },
      );
      return settled;
    },
    replaceSchema: (input: ReplaceSchemaInput): Promise<ReplaceSchemaResult> => {
      // D5.1 接纳门：同 mutateRoot——lifecycle≠ready 时零入队即时 ok:false
      if (state.lifecycle !== 'ready') {
        const result = disabled(lifecycleWriteRefusal(state.lifecycle));
        // [issue #149] acceptance 拒绝：同 mutateRoot——公共入口即记录点（§9.2 S1′）
        if (result.ok === false) {
          emitAttempt(diagEnv, {
            operation: 'schema-replacement',
            stage: 'acceptance',
            result: { kind: 'rejected' },
            code: RUNTIME_WRITE_DISABLED_CODE,
            input: { status: 'not-accessed' },
            issues: result.issues as DiagnosticIssue[],
          });
        }
        return Promise.resolve(result);
      }
      // D1（issue #91）：与 mutateRoot 同一 sequencer 实例——同步接纳定序、占槽互斥、
      // S6 同槽 await notifyDirty 构成屏障（双向 FIFO 互通）；thunk 是纯调用——
      // input 引用仅被捕获不被读取（Proxy 零触发），无可抛点
      const diag = diagEnv.emitter !== undefined ? createSlotDiag('schema-replacement') : undefined;
      const settled = sequencer.enqueue(() => runSchemaWriteSlot(schemaWriteEnv, input, diag));
      // [issue #149] 同 mutateRoot 的 emitSlot 附加反应挂点（§7.1/§7.3；非包装——见上）
      void settled.then(
        (r) => { emitSlot(diagEnv, diag, { kind: 'fulfilled', value: r }); },
        (e) => { emitSlot(diagEnv, diag, { kind: 'rejected' }); },
      );
      return settled;
    },
    close: (): Promise<void> => {
      // D2：幂等（INV-C2）——已赋值（含已结算 reject）即返回同一实例，release 恰一次
      if (closePromise !== undefined) return closePromise;
      // 同步迁移（返回前可观测——RED 锚「close() 返回前 lifecycle==='closing'」，
      // INV-C1）；写入点在 close() 同步段，与接纳门 check-then-enqueue 无交错（JS
      // run-to-completion，§12 #6）
      state.lifecycle = 'closing';
      // 队尾 barrier（INV-C3/C4）：enqueue 经 .then 微任务排程（sequencer.ts:33-37），
      // thunk 绝不在 close() 调用栈内同步执行；thunk 是纯调用（零读取/零构造/无可抛点）
      closePromise = sequencer.enqueue(() => runCloseBarrier(closeEnv));
      return closePromise;
    },
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

/** D4 包内 helper：closing/closed 期 read 停接纳的结果联合分支（不导出）。
 *  message 插值仅 lifecycle 字面量（'closing'/'closed' 闭集字符串）——稳定；属 close 域
 *  术语，与 fatal 域文案分域（INV-C10）。 */
function readDisabled(lifecycle: 'closing' | 'closed', path: unknown): RuntimeReadDisabledResult {
  let echo: readonly (string | number)[] = [];
  if (Array.isArray(path)) {
    try {
      echo = [...path]; // 新鲜副本（不别名调用方数组——沿 notAllowed 纪律）
    } catch {
      echo = []; // 敌意 Proxy 数组防御（沿 read.ts safeSpreadPath 纪律）
    }
  }
  return {
    ok: false,
    code: RUNTIME_READ_DISABLED_CODE,
    path: echo,
    message: `${RUNTIME_READ_DISABLED_CODE}: Runtime lifecycle 为 ${lifecycle}——` +
      'close 已停止接纳公共读取；本调用不触碰 live Y.Doc',
  };
}

/** D5.1 包内 helper：lifecycle≠ready 期写接纳拒绝的稳定 reason（不导出）。
 *  同 readDisabled——插值仅 lifecycle 字面量，close 域术语（INV-C10）；
 *  disabled() 尾注「零写入、输入零访问」如实（拒绝分支不读 mutation/input）。 */
function lifecycleWriteRefusal(lifecycle: 'closing' | 'closed'): string {
  return `Runtime lifecycle 为 ${lifecycle}——close 已停止接纳公共写；close 前已接纳任务仍无条件排空，本调用不入队`;
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
  diagnosticEmitter: NamespaceDiagnosticChangeEmitter | undefined;
  clock: (() => number) | undefined;
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
  // D10（#92）：release 成为 close barrier 的 load-bearing 依赖——契约违背（缺 release）
  // 应在构造栈 loud 拒绝（INV-N4：一切校验前置于 enqueue、throw 路径零副作用），
  // 而非深埋 barrier 内 TypeError
  if (typeof h.release !== 'function') {
    throw new TypeError('handle.release 必须为 function（DocHandle 契约）');
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
  // [issue #149] 诊断发射器捕获（沿 p0Gate/compile/notifyDirty 同款三行式；读取均限
  // 构造栈内、入队前——INV-N14）。校验对象是 doc 局部量（handle.doc，Y.Doc 事件面）
  // 而非 handle——DocHandle 契约只有 owner/docId/doc/getStatus/release 五键，无 on/off
  // （SA2 #1 修订：照抄 h.on/h.off 会炸掉全部合法装配）。
  let diagnosticEmitter: NamespaceDiagnosticChangeEmitter | undefined;
  if (rec.diagnosticEmitter !== undefined) {
    const e = rec.diagnosticEmitter;
    if (typeof e !== 'object' || e === null || typeof (e as { emit?: unknown }).emit !== 'function') {
      throw new TypeError('input.diagnosticEmitter 若提供必须是含 emit 方法的对象（NamespaceDiagnosticChangeEmitter 契约）');
    }
    diagnosticEmitter = e as NamespaceDiagnosticChangeEmitter;
    // loud assert，非静默降级：装配诊断发射即要求 doc 具备事务事件订阅面——缺 on/off
    // 属上游契约破坏，构造期 loud 拒绝（沿「残缺 handle 校验前置于 enqueue」先例，
    // INV-N4），绝不静默吞掉后把「应有 update 的记录」降级成 noop/omitted。
    const d = doc as unknown as Record<string, unknown>;
    if (typeof d.on !== 'function' || typeof d.off !== 'function') {
      throw new TypeError('装配 diagnosticEmitter 时 handle.doc（Y.Doc）必须具备 on/off 方法（yjs 事务事件契约——owned bytes 捕获依赖）');
    }
  }
  // [issue #149] 注入 Clock 捕获（observedAt 唯一来源——ADR-0012 §observedAt）
  let clock: (() => number) | undefined;
  if (rec.clock !== undefined) {
    if (typeof rec.clock !== 'function') {
      throw new TypeError('input.clock 若提供必须是 function（() => number，epoch ms）');
    }
    clock = rec.clock as () => number;
  }
  // [issue #149] 成对 loud 校验（SA2 #5）：装配 emitter 而缺 clock ⇒ 拒绝——无墙钟缺省，
  // observedAt 不接受静默系统墙钟；与 SA8 冲突点 #4 移交 Registry 票的「生产装配必须
  // 显式注入 Clock」呼应
  if (diagnosticEmitter !== undefined && clock === undefined) {
    throw new TypeError('装配 diagnosticEmitter 时必须同时注入 clock（() => number）——observedAt 不接受静默系统墙钟');
  }
  return {
    handle: handle as DocHandle,
    userId: userId as string,
    docId: docId as string,
    doc: doc as Y.Doc,
    p0Gate,
    compile,
    notifyDirty,
    diagnosticEmitter,
    clock,
  };
}
