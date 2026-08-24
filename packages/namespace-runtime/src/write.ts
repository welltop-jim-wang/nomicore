/**
 * @nomicore/namespace-runtime —— 唯一 ROOT 写槽（设计 §3/§4 D2/D3/D5/D9，issue #90）。
 *
 * 槽序（ADR-0008「每个真正写任务的槽依次执行」逐位对应，INV-W2 不可重排）：
 *  S1 lifecycle/fatal gate（零输入访问；v1 仅判 fatal——close 属后续 issue 扩展位）
 *  S2 writable gate + notifier 绑定检查（瞬时观察；零输入访问）
 *  S3 槽起点输入快照（本槽第一次也是唯一一次读取输入；受控 snapshotter 递归冻结）
 *  S4 执行时 active schema（不绑定调用时 generation；unavailable → 零写入 ok:false）
 *  S5 领域校验 + detached 构造 + 单事务（applyValidatedMutation 唯一 Y.Doc 写入口）
 *  S6 同槽 await notifyDirty（完成信号 = live commit + dirty 登记两者）
 *  S7 槽释放（promise settle；sequencer 自动放行下一项）
 *
 * fatal 通道（D5.2 分类表唯一裁决点）：internal fatal 一律以稳定
 * `RuntimeWriteFatalError` rejection 送达（绝不出 ok:false 后门）；committed:true
 * （含未知异常保守 true）→ 槽内 best-effort notifier 恰一次；committed:false → 0
 * notifier。`markWriteFatal` 同步先行：status.fatal 在 notifier 挂住窗口内即可观测。
 *
 * 模块职责边界：写槽唯一实现（槽体/snapshotter/fatal 分类）；errors.ts 只承载
 * 类别与稳定码（分类权归本文件 catch 位置——延续「分类权归捕获位置」哲学）。
 */
import type * as Y from 'yjs';
import type { DocHandle, DocHandleStatus } from '@nomicore/persistence';
import { applyValidatedMutation, DocRuntimeFatalError } from '@nomicore/doc-runtime';
import type { ApplyValidatedMutationResult } from '@nomicore/doc-runtime';
import {
  FATAL_WRITE_INTERNAL_CODE,
  FATAL_WRITE_INTERNAL_MESSAGE,
  MUTATION_INPUT_NOT_PLAIN_DATA_CODE,
  RUNTIME_WRITE_DISABLED_CODE,
  RuntimeWriteFatalError,
  SCHEMA_UNAVAILABLE_CODE,
} from './errors.js';
import type { RuntimeWriteFatalPhase } from './errors.js';
import type { RuntimeState } from './p0.js';

/** 写槽运行时环境（构造栈一次成型——纯数据闭包，槽体零读 seam 输入）。 */
export interface WriteEnv {
  /** V3a 捕获的 live Y.Doc 引用（S5 事务载体）。 */
  readonly doc: Y.Doc;
  /** S2 瞬时观察专用（getStatus；不保留可变的 handle 语义依赖）。 */
  readonly handle: DocHandle;
  /** 与 P0 共享的唯一可变源（写槽只写 fatal/fatalCause 域——P0 域互斥先行，D5.4）。 */
  readonly state: RuntimeState;
  /** dirty notification 接缝（显式 undefined 联合——exactOptionalPropertyTypes，
   *  沿 P0Env.p0Gate 先例）；undefined = 未绑定（S2 loud 拒绝，D6.4）。 */
  readonly notifyDirty: (() => Promise<void>) | undefined;
}

/**
 * ROOT mutation issue 元素形状名目（ADR-0008「独立的窄 issue 类型」；与 doc-runtime
 * MutationIssue 结构同一、名目独立）。本接口是**构造侧纪律与文档类型**：runtime 内部
 * 构造的每个 issue 恒为 `{ message, path }` 此形状（disabled/snapshot/unavailable/
 * 管线透传四来源全部如此）；公共联合的 issues 元素类型放宽为 unknown（R2 修订，
 * SA2 攻击点 #1——兼容 SA6 冻结孪生的 `unknown[]` 与 `MutationIssue[]` 双侧赋值）。
 */
export interface RootMutationIssue {
  message: string;
  path: Array<string | number>;
}

/** ROOT mutation 完成信号联合（D9）。fatal 经 rejection（RuntimeWriteFatalError），不入本联合。 */
export type MutateRootResult = { ok: true } | { ok: false; issues: unknown[] };

/**
 * 写槽主函数（唯一写槽实现）。async——同步段无可抛点（全部 gate/分类在体内），
 * 一切异常进入返回 Promise（sequencer 链尾恒绿接线消化 reject——INV-W12）。
 */
export async function runRootWriteSlot(env: WriteEnv, input: unknown): Promise<MutateRootResult> {
  // ── S1 lifecycle/fatal gate（零输入访问）──────────────────────────────
  if (env.state.fatal !== undefined) {
    return disabled('fatal 已置位（internal fault 已永久关闭本 Runtime 全部写）');
  }
  //    [扩展位：lifecycle gate——v1 恒 'ready'，close 属后续 issue]

  // ── S2 writable gate + notifier 绑定检查（瞬时观察；零输入访问）────────
  let handleStatus: DocHandleStatus;
  try {
    handleStatus = env.handle.getStatus();
  } catch (err) {
    // adapter bug → 统一 fatal（committed:false——此时尚零 doc 写）；统一形状防止
    // 裸异常从结果联合之外的第二通道逃逸（与 #89 读取面「原样传播」的差异：写槽必须
    // 经 Promise 结算，且 fatal 面要求立即永久关写）
    return rejectWithWriteFatal(
      env, false, 'write-slot-internal', 'getStatus() 抛错（adapter 契约违背）', err,
    );
  }
  if (handleStatus !== 'ready') {
    return disabled(
      `DocHandle 状态 ${handleStatus} 不可写（persistence-degraded 阻止全部 Y.Doc 写；released/disposed 同拒）`,
    );
  }
  if (env.notifyDirty === undefined) {
    return disabled(
      'notifyDirty 未绑定——构造方必须绑定 persistence.saveDoc(handle)（ADR-0008 窄接缝）；'
      + '无持久化绑定的 Runtime 拒绝一切 Y.Doc 写，杜绝「提交成功但永无 dirty 登记」的静默失信',
    );
  }
  const notifyDirty = env.notifyDirty; // 单读捕获（此后不再读 env 字段语义）

  // ── S3 槽起点输入快照（本槽第一次也是唯一一次读取输入）────────────────
  const snap = snapshotMutation(input); // D3；拒绝 → ok:false（类 B：输入缺陷不升格 fatal）
  if (snap.kind === 'issue') return { ok: false, issues: [snap.issue] };

  // ── S4 执行时 active schema（不绑定调用时 generation）─────────────────
  if (env.state.schemaState === 'unavailable') {
    return {
      ok: false,
      issues: [{
        message: `${SCHEMA_UNAVAILABLE_CODE}: 无可用 active schema（P0 编译失败）——` +
          'ROOT write 零写入失败；SCHEMA write 仍可修复',
        path: [],
      }],
    };
  }
  const tools = env.state.activeTools;
  if (env.state.schemaState !== 'ready' || tools === undefined) {
    // 结构上不可达（D4：P0 是队首真实节点，写槽启动时 P0 必已 settle）——loud
    // internal fatal（拒绝虚假降级立法：出现即包缺陷，不静默跳过、不伪 ok）
    return rejectWithWriteFatal(
      env, false, 'write-slot-internal',
      'schemaState/activeTools 不变量破坏（ready 必含 tools；preparing 必已被 P0 settle 或 fatal）',
      undefined,
    );
  }

  // ── S5 领域校验 + detached 构造 + 单事务（唯一 Y.Doc 写入口）───────────
  let result: ApplyValidatedMutationResult;
  try {
    result = applyValidatedMutation(tools.derived, env.doc, snap.value);
  } catch (err) {
    // D5 fatal 分类（唯一 throw 通道）：doc-runtime branded 透传 committed/phase 事实；
    // 未知异常保守 committed:true（ADR「未知异常保守视为可能已提交」——过报方向强制）
    if (err instanceof DocRuntimeFatalError) {
      return rejectWithWriteFatal(env, err.committed, err.phase, err.message, err);
    }
    return rejectWithWriteFatal(env, true, 'unknown-pipeline-throw', errDetailOf(err), err);
  }
  if (!result.ok) {
    return { ok: false, issues: result.issues }; // 领域失败透传（零写入由管线承诺）
  }

  // ── S6 同槽 await notifyDirty（完成信号 = live commit + dirty 登记两者）──
  try {
    await notifyDirty();
  } catch (err) {
    // 写已提交而登记通道损坏——诚实 fatal；不重试（S6 本次即本槽 notifier 唯一一次尝试）
    markWriteFatal(env, err);
    throw new RuntimeWriteFatalError(
      'notify-dirty-failed',
      true,
      writeFatalMessage('notify-dirty-failed', true, errDetailOf(err)),
      err === undefined ? undefined : { cause: err },
    );
  }

  // ── S7 槽释放（promise settle；sequencer 自动放行下一项）───────────────
  return { ok: true };
}

/** disabled 结果（D9）：RUNTIME_WRITE_DISABLED 稳定码 + 零写入/零输入访问声明。 */
function disabled(reason: string): MutateRootResult {
  return {
    ok: false,
    issues: [{
      message: `${RUNTIME_WRITE_DISABLED_CODE}: ${reason}——本调用零写入、输入零访问`,
      path: [],
    }],
  };
}

/** 永久关写（fatal 摘要稳定注册——INV-N7：code/message 恒定文案，不插值原始文本）。 */
function markWriteFatal(env: WriteEnv, cause: unknown): void {
  env.state.fatal = Object.freeze({
    code: FATAL_WRITE_INTERNAL_CODE,
    message: FATAL_WRITE_INTERNAL_MESSAGE,
  });
  env.state.fatalCause = cause; // 包内诊断锚点（不进任何公共面——#89 R2 立法延续）
}

/**
 * fatal 路径执行序（D5.3）：① markWriteFatal 同步先行（notifier 挂住窗口内
 * status.fatal 已可观测）→ ② committed:true 槽内 best-effort notifier 恰一次
 * （失败吞没——原始 fatal 优先传播）→ ③ throw 稳定 RuntimeWriteFatalError。
 * 本函数永不 resolve（Promise<never>）。
 */
async function rejectWithWriteFatal(
  env: WriteEnv,
  committed: boolean,
  phase: RuntimeWriteFatalPhase,
  detail: string,
  cause: unknown,
): Promise<never> {
  markWriteFatal(env, cause ?? detail);
  if (committed) {
    try {
      await env.notifyDirty?.(); // best-effort：登记最新 live doc；挂住/失败均不掩盖原始 fatal
    } catch {
      /* 吞没：best-effort 不得替换原始 fatal 通道 */
    }
  }
  throw new RuntimeWriteFatalError(
    phase,
    committed,
    writeFatalMessage(phase, committed, detail),
    cause === undefined ? undefined : { cause },
  );
}

/** fatal 稳定 message 模板（稳定前缀 + 「」定界证据引用原始异常文本）。 */
function writeFatalMessage(phase: RuntimeWriteFatalPhase, committed: boolean, detail: string): string {
  return `NSRT-WRITE-FATAL: ROOT write internal fatal（phase=${phase}, committed=${String(committed)}）；` +
    '本 Runtime 全部写已永久关闭，读取保留；不补偿、不 fallback、不声称回滚；' +
    `上层不得自动重试非幂等写。原始异常证据引用：「${detail}」`;
}

/** 错误详情（message 或 String 兜底——证据引用文本，非本槽自述 claims）。 */
function errDetailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── D3 受控 snapshotter ────────────────────────────────────────────────────

type SnapshotResult = { kind: 'ok'; value: unknown } | { kind: 'issue'; issue: RootMutationIssue };

/**
 * 槽起点输入快照（D3）。整体 try/catch：敌意 getter/Proxy trap 在快照读取面抛错
 * → 类 B 分级（ok:false）——与 doc-runtime E205 哲学一致，用户数据不得升格 internal
 * fatal（防「一次敌意 value → Runtime 永久关写」DoS；SA6 冻结注释明文「输入缺陷属
 * 普通领域失败」）。
 */
function snapshotMutation(input: unknown): SnapshotResult {
  try {
    return { kind: 'ok', value: copyFrozen(input, new Set<object>()) };
  } catch (err) {
    return {
      kind: 'issue',
      issue: { message: `${MUTATION_INPUT_NOT_PLAIN_DATA_CODE}: ${errDetailOf(err)}`, path: [] },
    };
  }
}

/**
 * 递归冻结复制（返回值已冻结；拒绝 → throw——由 snapshotMutation 收编为 ok:false）。
 * 只接受 primitive、finite number、null、plain object/array（ADR-0008 拒绝清单：
 * accessor、class instance、特殊对象、symbol key、循环引用及其他非 plain data）。
 * 数组/对象两分支四查纪律对齐【R2，SA2 攻击点 #2】；冻结序为后序（子先父后）。
 * 循环检测用祖先路径集（enter add / exit delete）；DAG 共享引用按 JSON 语义复制为多份。
 */
function copyFrozen(v: unknown, ancestors: Set<object>): unknown {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return v; // 不可变标量直通
  if (t === 'number') {
    if (!Number.isFinite(v)) throw new Error(`非有限 number（${String(v)}）`);
    return v;
  }
  if (t === 'undefined' || t === 'symbol' || t === 'bigint' || t === 'function') {
    throw new Error(`非 plain data 值（${t}）`); // bigint：JSON 值域外，早拒 + 明确 issue
  }

  // ── 数组分支【R2 修订：①②③④ 查全量前置，任何 v[i] 值读取之前完成】──────
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype) {
      throw new Error('非 plain 数组（子类/异构原型）');
    }
    if (ancestors.has(v)) throw new Error('循环引用');
    // ① symbol 键不进 Object.keys——缺本查即静默丢弃（R1 盲区 a）
    if (Object.getOwnPropertySymbols(v).length > 0) {
      throw new Error('数组携带 symbol 键');
    }
    // ② getOwnPropertyNames 对数组恒含不可枚举的 'length'（自身长度属性），过滤后与
    //    可枚举键集比对：非枚举数据键（含非枚举下标）在此暴露（R1 盲区 b）
    const names = Object.getOwnPropertyNames(v).filter((k) => k !== 'length');
    const keys = Object.keys(v);
    if (names.length !== keys.length) throw new Error('数组携带非枚举 own 键');
    // ③ descriptor 全表扫描先于任何值读取：getOwnPropertyDescriptor 是元数据读取，
    //    不执行 getter（Proxy 侧走 getOwnPropertyDescriptor trap 而非 get trap）——
    //    拒绝先于任何输入侧代码执行（SA2 红灯 calls === 0 的次序保证；R1 盲区 c）。
    //    d === undefined → 稀疏空洞或原型链污染（不读原型值）。
    for (let i = 0; i < v.length; i++) {
      const d = Object.getOwnPropertyDescriptor(v, String(i));
      if (d === undefined) {
        throw new Error(`index ${i} 无 own 属性（稀疏空洞或原型链污染——不读原型值）`);
      }
      if (d.get !== undefined || d.set !== undefined) {
        throw new Error(`accessor 下标（index ${i}）`);
      }
    }
    // ④ 额外 own 可枚举属性（arr.foo = 1 等）——与 ② 互补：② 拒非枚举面、④ 拒可枚举面
    if (keys.length !== v.length) throw new Error('数组携带可枚举非索引 own 键');
    // ⑤ 纯数据读取（③ 已证无 accessor / 无空洞）
    ancestors.add(v);
    const out = new Array<unknown>(v.length);
    for (let i = 0; i < v.length; i++) {
      const raw = v[i] as unknown;
      if (raw === undefined) throw new Error(`数组元素 undefined（index ${i}）`);
      out[i] = copyFrozen(raw, ancestors);
    }
    ancestors.delete(v);
    return Object.freeze(out);
  }

  // ── 对象分支（R1 四查原样：proto/symbol/非枚举/accessor 齐备）───────────
  // 至此 v 非 null 且 typeof === 'object'（其余 typeof 已全部返回/抛出）——收窄为 object
  const obj = v as object;
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    const ctorName = (proto as { constructor?: { name?: unknown } }).constructor?.name ?? 'unknown';
    // 覆盖一切 class instance / Y.AbstractType / Date/Map/Set——Yjs shared type 同走此拒绝
    throw new Error(`非 plain 对象（constructor: ${String(ctorName)}）`);
  }
  if (ancestors.has(obj)) throw new Error('循环引用');
  if (Object.getOwnPropertySymbols(obj).length > 0) throw new Error('symbol 键');
  const names = Object.getOwnPropertyNames(obj);
  const keys = Object.keys(obj);
  if (names.length !== keys.length) throw new Error('非枚举 own 键');
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(obj, k);
    if (d === undefined) throw new Error(`属性 "${k}" 无 own descriptor`);
    if (d.get !== undefined || d.set !== undefined) throw new Error(`accessor 属性 "${k}"`);
  }
  ancestors.add(obj);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const raw = (obj as Record<string, unknown>)[k];
    if (raw === undefined) throw new Error(`键 "${k}" 值为 undefined`);
    // defineProperty 写入纪律（仓内先例 read.ts putKey / extract.ts putSnapshotKey /
    // projection.ts putMetaKey / detached-build.ts copyJsonDomain）：'__proto__' 自有键
    // 不触发原型 setter、不劫持产物原型；裸赋值禁止
    Object.defineProperty(out, k, {
      value: copyFrozen(raw, ancestors),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  ancestors.delete(obj);
  return Object.freeze(out);
}
