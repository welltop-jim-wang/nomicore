/**
 * @nomicore/namespace-runtime —— 唯一 SCHEMA 写槽（设计 §4 D2/D3/D5/D9，issue #91）。
 *
 * 槽序（ADR-0008「SCHEMA write 五步」逐位对应，INV-S2 不可重排；与 ROOT 写槽共享
 * S1–S3/S6/S7 的机械与语义，差异集中在 S4/S5——「槽体分流、sequencer 共享」裁决：
 * 两类写的 S4 语义根本不同（active schema 消费 vs proposed 编译），不合并槽体）：
 *  S1 lifecycle/fatal gate（零输入访问；共享 disabled 路径）
 *  S2 writable gate + notifier 绑定检查（零输入访问；共享 disabled 路径）
 *  S3 槽起点输入快照 + 输入形状检查（共享受控 snapshotter——R2 四查次序原样）
 *  S4 proposed 编译（seam 注入 compile 路由；**零读 state 的 active 域**——
 *      AC1/AC8：不依赖当前 schema 可编译，P0 unavailable 照常入槽执行）
 *  S5 组合 seam replaceSchemaAndRoot（唯一 Y.Doc 写入口：验证+构造+单事务+写后校验）
 *  S5.5 installActive（transaction 返回后**同步**执行、await notifyDirty 之前——AC6）
 *  S6 同槽 await notifyDirty（完成信号 = live commit + dirty 登记两者）
 *  S7 槽释放（promise settle；sequencer 自动放行下一项）
 *
 * fatal 分类（D9 表唯一裁决点 = 本槽 catch 位置；延续「分类权归捕获位置」）：
 *  - S2 getStatus 抛错 → write-slot-internal committed:false；
 *  - S4 compile 抛出 / ok:false 零 issues / 畸形 ok:true（守卫 throw——含 envelope 恰
 *    四键封闭/四值型违规，R1.1/A1）→ **schema-compile-throw** committed:false
 *    （结构上先于一切 doc 写——诚实零写入；与 write-slot-internal 区分诊断面）；
 *  - S5 seam 抛 DocRuntimeFatalError（E201/E203/E204）→ 透传 committed/phase；
 *  - S5 seam 抛未知异常（含结构性不可达的 E202 误用）→ unknown-pipeline-throw
 *    committed:true（ADR 过报方向强制）；
 *  - S6 notifyDirty rejection → notify-dirty-failed committed:true（新 tools 已装、
 *    与 committed generation 一致——诚实状态，不回滚不卸载）。
 *  一律 markWriteFatal（SCHEMA 写槽独立摘要码 NSRT-FATAL-SCHEMA-WRITE-INTERNAL——
 *  与 ROOT 写槽区分来源，status.fatal 诊断不失真）+ RuntimeWriteFatalError rejection；
 *  永久禁写保读；已排队后续写经 S1 取得槽、零访问输入、零写入 RUNTIME_WRITE_DISABLED。
 */
import type * as Y from 'yjs';
import type { DocHandle, DocHandleStatus } from '@nomicore/persistence';
import { DocRuntimeFatalError, replaceSchemaAndRoot } from '@nomicore/doc-runtime';
import type { ReplaceResult, SchemaRootPlan } from '@nomicore/doc-runtime';
import type { CompileSchemaEnvelopeOk, CompileSchemaEnvelopeResult, SchemaEnvelope, SchemaParseIssue } from '@nomicore/vfsl';
import { RuntimeWriteFatalError } from './errors.js';
import { assertCompiledShape, installActive, toIssueSummary } from './p0.js';
import type { RuntimeState } from './p0.js';
import {
  disabled,
  markWriteFatal,
  rejectWithWriteFatal,
  snapshotMutation,
  writeFatalMessage,
} from './write.js';

/** 写槽运行时环境（构造栈一次成型 V3c''——纯数据闭包，槽体零读 seam 输入）。
 *  与 WriteEnv 的差异 = 多 compile 字段（proposed 编译路由；同一批捕获局部量）。 */
export interface SchemaWriteEnv {
  /** V3a 捕获的 live Y.Doc 引用（S5 事务载体）。 */
  readonly doc: Y.Doc;
  /** S2 瞬时观察专用（getStatus；不保留可变的 handle 语义依赖）。 */
  readonly handle: DocHandle;
  /** 与 P0 共享的唯一可变源（写槽只写 fatal/fatalCause 域）。 */
  readonly state: RuntimeState;
  /** dirty notification 接缝（显式 undefined 联合——沿 WriteEnv 先例）。 */
  readonly notifyDirty: (() => Promise<void>) | undefined;
  /** proposed 编译步（构造栈 V3b 捕获——同一 seam 注入同时服务 P0 与 SCHEMA 写槽，D10）。 */
  readonly compile: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
}

/**
 * replaceSchema 输入（公共契约面，D1）。类型是意图声明——运行时仍经受控 snapshotter
 * + compile 严格门双面把关。
 */
export interface ReplaceSchemaInput {
  /** proposed envelope（运行时经快照 + compile 严格门；验证权单源在 compile）。 */
  readonly schema: SchemaEnvelope;
  /**
   * 完整最终 logical ROOT snapshot（plain JSON 值域，经受控 snapshotter 递归冻结）。
   *
   * 【R1.1/A2 公共契约面规格——逐字保留语义】
   * - 提供性以**键存在性**判定：缺省 = 不修改 ROOT（也不破坏 identity）；显式传 `undefined`
   *   属非 plain 输入，被输入纪律拒绝（`MUTATION_INPUT_NOT_PLAIN_DATA`，message 携带键名，
   *   如「键 "root" 值为 undefined」）——不是「视为未提供」。
   * - **未声明顶层键不进入新 generation**：root 先投影到 proposed schema 结构树顶层声明
   *   键集（与 keep-root 分支对当前 ROOT 的提取投影同构），投影外顶层键被剥离且
   *   `ok:true` 不携带任何反馈（冻结锚 15 语义；advisory 通道另立 issue，见设计 §10 R7）。
   * - **嵌套未声明键响亮拒绝**：validateLogicalSnapshot「未知字段」/ buildTopEntries F7
   *   双 loud 失败（`ok:false` + issues），保持仓内拒绝静默丢键纪律。
   * - 读取 `issues` 元素须自行窄化（`unknown[]` 是有意为之的 R2 先例——兼容
   *   `MutationIssue[]`/`ReplaceSchemaIssue[]` 双侧赋值）：
   *   `(res.issues as Array<{ message: string; path: (string | number)[] }>)`。
   */
  readonly root?: unknown;
}

/** SCHEMA 写槽 issue 元素形状名目（D9/INV-S10：与 ROOT 写槽独立——不形成巨型 write issue）。 */
export interface SchemaReplacementIssue {
  message: string;
  path: Array<string | number>;
}

/** SCHEMA write 完成信号联合（D9）。fatal 经 rejection（RuntimeWriteFatalError），不入本联合。 */
export type ReplaceSchemaResult = { ok: true } | { ok: false; issues: unknown[] };

/**
 * SCHEMA 写槽主函数（唯一实现）。async——同步段无可抛点（全部 gate/分类在体内），
 * 一切异常进入返回 Promise（sequencer 链尾恒绿接线消化 reject）。
 */
export async function runSchemaWriteSlot(env: SchemaWriteEnv, input: unknown): Promise<ReplaceSchemaResult> {
  // ── S1 lifecycle/fatal gate（零输入访问）──────────────────────────────
  if (env.state.fatal !== undefined) {
    return disabled('fatal 已置位（internal fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留）');
  }

  // ── S2 writable gate + notifier 绑定检查（瞬时观察；零输入访问）────────
  let handleStatus: DocHandleStatus;
  try {
    handleStatus = env.handle.getStatus();
  } catch (err) {
    // adapter bug → 统一 fatal（committed:false——此时尚零 doc 写）
    return rejectWithWriteFatal(env, false, 'write-slot-internal', err, 'schema');
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

  // ── S3 槽起点输入快照（本槽第一次也是唯一一次读取输入）+ 输入形状检查 ──
  const snap = snapshotMutation(input); // 共享受控 snapshotter（D3；R2 四查次序原样）
  if (snap.kind === 'issue') return { ok: false, issues: [snap.issue] }; // MUTATION_INPUT_NOT_PLAIN_DATA
  const shape = shapeOfReplaceInput(snap.value); // 形状检查在快照后追加（D3；无新稳定码）
  if (shape.kind === 'issue') return { ok: false, issues: [shape.issue] };

  // ── S4 proposed 编译（seam 注入路由；不读 state 的 active 域——AC1/AC8）──────
  let compiled: CompileSchemaEnvelopeOk;
  try {
    const r = env.compile(shape.schema as SchemaEnvelope); // 验证权单源在 compile 严格门（沿 P0 `as` 先例）
    if (!r.ok) {
      if (r.issues.length === 0) {
        throw new Error('compile 返回 ok:false 且零 issues——结果联合之外的状态');
      }
      // 普通失败：当前 schema 状态不变、旧 active tools 继续服务（与 P0 失败 →
      // unavailable 的关键差异——proposed 失败只是「这次替换没发生」，D4）
      return { ok: false, issues: r.issues.map((issue) => toReplacementIssue(issue)) };
    }
    // 畸形 ok:true → throw → fatal（P0 同款守卫；【R1.1/A1】检查面扩展：envelope 恰四键
    // 封闭 + 四值型（含原漏检的 text）——违规一律 schema-compile-throw fatal，不允许
    // 漏到组合 seam ①b 被降级为 ok:false（internal 产物劣化伪装成调用方领域失败）
    assertCompiledShape(r);
    compiled = r;
  } catch (err) {
    return rejectWithWriteFatal(env, false, 'schema-compile-throw', err, 'schema');
  }

  // ── S5 组合 seam（唯一 Y.Doc 写入口：验证+构造+单事务+写后校验）────────
  const plan: SchemaRootPlan = shape.hasRoot
    ? { kind: 'replace-root', snapshot: shape.root }
    : { kind: 'keep-root' };
  let result: ReplaceResult;
  try {
    result = replaceSchemaAndRoot(env.doc, {
      envelope: compiled.envelope,
      derived: compiled.derived,
      root: plan,
    });
  } catch (err) {
    // D9 fatal 分类：doc-runtime branded 透传 committed/phase 事实；未知异常保守
    // committed:true（ADR「未知异常保守视为可能已提交」——过报方向强制）
    if (err instanceof DocRuntimeFatalError) {
      return rejectWithWriteFatal(env, err.committed, err.phase, err, 'schema');
    }
    return rejectWithWriteFatal(env, true, 'unknown-pipeline-throw', err, 'schema');
  }
  if (!result.ok) return { ok: false, issues: result.issues }; // 领域失败透传（零写入由 seam 承诺）

  // ── S5.5 安装新 active tools（AC6：transaction 返回后同步、await notifyDirty 之前）──
  //  五字段身份 + tools + 状态迁回 'ready' + delete schemaIssue——getActiveSchema/
  //  getSchemaEnvelope/read 自此观察新 generation（notifier 挂住窗口内可观测——锚 9）
  installActive(compiled, env.state);

  // ── S6 同槽 await notifyDirty（完成信号 = live commit + dirty 登记两者）──
  try {
    await notifyDirty();
  } catch (err) {
    // 写已提交而登记通道损坏——诚实 fatal；不重试（S6 本次即本槽 notifier 唯一一次尝试）；
    // 新 tools 已装（与 committed generation 一致，不回滚、不卸载——ADR「不补偿」）
    markWriteFatal(env, err, 'schema');
    throw new RuntimeWriteFatalError(
      'notify-dirty-failed',
      true,
      writeFatalMessage('schema', 'notify-dirty-failed', true),
      err === undefined ? undefined : { cause: err },
    );
  }

  // ── S7 槽释放（promise settle；sequencer 自动放行下一项）───────────────
  return { ok: true };
}

/** S3 输入形状检查结局（快照成功之后——snap 已是冻结 plain 数据，此处只查键形状）。 */
type ReplaceShape =
  | { kind: 'ok'; schema: unknown; hasRoot: boolean; root: unknown }
  | { kind: 'issue'; issue: SchemaReplacementIssue };

/** S3 输入形状检查（镜像 mutation.ts (A) 信封校验的措辞风格）：snap 必须是普通对象、
 *  含 schema 键、own 键集 ⊆ {schema, root}；违者 → 单 issue path: []。非对象输入
 *  （null/数组等）同样在此响亮拒绝。 */
function shapeOfReplaceInput(snap: unknown): ReplaceShape {
  if (typeof snap !== 'object' || snap === null || Array.isArray(snap)) {
    return {
      kind: 'issue',
      issue: {
        message: '输入形状错误：期望普通对象 { schema, root? }，'
          + `实际 ${wordOf(snap)}`,
        path: [],
      },
    };
  }
  if (!Object.hasOwn(snap, 'schema')) {
    return {
      kind: 'issue',
      issue: { message: '输入形状错误：缺少必需键 "schema"（允许的键：schema/root）', path: [] },
    };
  }
  const unknownKey = Object.keys(snap).find((k) => k !== 'schema' && k !== 'root');
  if (unknownKey !== undefined) {
    return {
      kind: 'issue',
      issue: { message: `输入形状错误：未知键 "${unknownKey}"（允许的键：schema/root）`, path: [] },
    };
  }
  return {
    kind: 'ok',
    schema: (snap as Record<string, unknown>)['schema'],
    hasRoot: Object.hasOwn(snap, 'root'), // 提供性以键存在性判定（D1/D3：显式 undefined 已被快照拒绝）
    root: (snap as Record<string, unknown>)['root'],
  };
}

/** S4 编译失败 issue 映射（码派生与 p0.toIssueSummary 同源——SCHEMA_ENVELOPE_* /
 *  SCHEMA_TEXT_INVALID，D5 分类第 2 条）。 */
function toReplacementIssue(issue: SchemaParseIssue): SchemaReplacementIssue {
  const summary = toIssueSummary(issue);
  return { message: `${summary.code}: ${summary.message}`, path: [] };
}

/** 形状词（S3 诊断文本专用——snap 已过快照器，只可能是 plain 数据）。 */
function wordOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
      return `object（constructor: ${ctorName}）`;
    }
    return 'object';
  }
  return typeof v; // string / number / boolean / bigint / function / symbol / undefined
}
