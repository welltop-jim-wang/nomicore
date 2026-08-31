/**
 * @nomicore/namespace-runtime —— 唯一复制管理写槽（issue #132：Phase 5 复制谱系与
 * epoch；ADR 0010「复制谱系与 epoch」节 + phase-5 文档 §实施切片 1 复制部分）。
 *
 * 职责：META 复制保留字段（replicationId / replicationEpoch）的制式、事实读取单点
 * （readReplicationFacts）与 enable/bump 两写槽。写槽共享唯一 WriteSequencer
 * （同 mutateData/replaceSchema——FIFO 由既有机械保证），槽序 E1–E7 逐位镜像 ROOT
 * 写槽 S1–S7（差异仅在 E3 输入校验 / E4 领域事实读取 / E5 事务内容）：
 *
 * ```
 * E1  fatal gate（零输入访问）
 * E2  writable gate + notifier 绑定检查（瞬时观察；零输入访问）
 *     （E1/E2 于 2026-08-27 提取为私有共享 gate runReplicationWriteGate——SA2 R1 #4；
 *      双槽共用一实现，短路顺序 / stable message / 结算通道逐字节不变，零公共面扩散）
 * E3  输入校验（enable 专属：单读捕获 + 全探测 try/catch 收编；bump 无输入）
 * E4  领域事实读取（readReplicationFacts：三出口——disabled/enabled/throw→internal fatal）
 * E5  单 Yjs transaction（本槽唯一 Y.Doc 写入口；enable 两键同事务 = 原子安装）
 * E5.5 复制事实同步整替（transaction 返回后、await notifyDirty 之前——镜像 SCHEMA
 *     槽 S5.5 installActive 时序：notifier 挂起窗口内 status 已可观测提交事实）
 *     【R2-1 增补】bump 槽于本步追加 fenceStale（主动 fence 旧 epoch sessions——
 *     §2.1；enable 槽不 fence——显式裁决）
 * E6  同槽 await notifyDirty（完成信号 = live commit + dirty 登记两者）
 * E7  槽释放（promise settle；sequencer 自动放行下一项）
 * ```
 *
 * 不变量（设计 §5）：
 * - INV-R1 replicationId 一经安装永不被改写（enable 幂等零写、bump 只写 epoch）；
 * - INV-R2 两键只经本槽成对变更（同事务原子，Sequencer FIFO 内）；
 * - INV-R3 通知时刻 META 已含本槽提交（零写入路径零通知）；
 * - INV-R4 epoch 严格单调、>=1、<=MAX_SAFE_INTEGER，永不出域（判据先于任何 +1）；
 * - INV-R7 一切拒绝经结果联合 / RuntimeWriteFatalError rejection 二通道结算；
 * - INV-R9 格式非法值结构性无法进入 META（槽 E3 单读捕获格式门 + 抽取器结构守卫
 *   （registry 侧）+ 读取器损坏判据三重）。
 *
 * 模块职责边界：格式常量/读取器/槽体/类型单点实现；错误类与稳定文案在 errors.ts
 * （分类权归本文件 catch 位置——延续「分类权归捕获位置」哲学）。
 */
import type * as Y from 'yjs';
import type { DocHandle, DocHandleStatus } from '@nomicore/persistence';
import {
  REPLICATION_EPOCH_OVERFLOW_MESSAGE,
  REPLICATION_INPUT_INVALID_MESSAGE,
  REPLICATION_META_ABSENT_MESSAGE,
  REPLICATION_NOT_ENABLED_MESSAGE,
  ReplicationMetaCorruptError,
  RuntimeWriteFatalError,
} from './errors.js';
import type { RuntimeState } from './p0.js';
import type { SessionFanout } from './replication-session.js';
import {
  disabled,
  markWriteFatal,
  rejectWithWriteFatal,
  writeFatalMessage,
} from './write.js';

/** 复制身份格式（ADR 0010 冻结：128-bit 随机值 = 32 位小写 hex）。
 *  **模块级值导出，index.ts 不 re-export**（runtime 公共入口值导出面恰
 *  RuntimeWriteFatalError 一键冻结——runtime-acceptance-exports-audit.test.ts）；
 *  registry 侧持有本地结构守卫副本（registry.ts REPLICATION_ID_PATTERN，沿
 *  NAMESPACE_ID_PATTERN 先例），两份副本互为结构守卫、注释互相引用。 */
export const REPLICATION_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * META 复制保留字段事实投影（两态联合——恰两态；SA6 类型锚锁死，无 'unknown' 第三态）。
 * `enabled` 分支的 replicationId 恒为 32 位小写 hex、replicationEpoch 恒为 >=1 的
 * 安全整数（读取器格式门保证——非法形态结构性不可达于本类型的构造面）。
 */
export type NamespaceRuntimeReplicationStatus =
  | Readonly<{ state: 'disabled' }>
  | Readonly<{ state: 'enabled'; replicationId: string; replicationEpoch: number }>;

/** enableReplication 输入（公共契约面；运行时经受控单读捕获 + 格式门把关）。 */
export interface EnableReplicationInput {
  readonly replicationId: string;
}

/** 复制管理写 issue 元素形状名目（沿 DataMutationIssue 先例；META 管理写无路径语义——
 *  path 恒 []，与 gate 级 issue 同款）。 */
export interface ReplicationManagementIssue {
  message: string;
  path: Array<string | number>;
}

/** enableReplication 完成信号联合（D-5/D-6）。fatal 经 rejection（RuntimeWriteFatalError），
 * 不入本联合。 */
export type EnableReplicationResult = { ok: true } | { ok: false; issues: unknown[] };

/** bumpReplicationEpoch 完成信号联合（D-5/D-6）。fatal 经 rejection，不入本联合。 */
export type BumpReplicationEpochResult = { ok: true } | { ok: false; issues: unknown[] };

/**
 * 写槽运行时环境（构造栈一次成型——纯数据闭包，槽体零读 seam 输入，INV-N14 延续）。
 * 与 WriteEnv 同批捕获局部量（doc/handle/state/notifyDirty）；零新增注入点。
 */
export interface ReplicationWriteEnv {
  /** V3a 捕获的 live Y.Doc 引用（E5 事务载体）。 */
  readonly doc: Y.Doc;
  /** E2 瞬时观察专用（getStatus；不保留可变的 handle 语义依赖）。 */
  readonly handle: DocHandle;
  /** 与 P0 共享的唯一可变源（写槽只写 fatal/fatalCause 与 replication 域）。 */
  readonly state: RuntimeState;
  /** dirty notification 接缝（显式 undefined 联合——沿 WriteEnv 先例）。 */
  readonly notifyDirty: (() => Promise<void>) | undefined;
  /** 会话扇出器（issue #134 round 2 R2-1：bump 槽 E5.5 同步投影步主动 fence——
   *  runtime.ts 构造序同批捕获局部量，INV-N14 纪律延续）。 */
  readonly fanout: SessionFanout;
}

/**
 * 共享 gate 拒绝子集（SA2 R1 #4 / 设计 §5.2）：两入口结果联合（EnableReplicationResult /
 * BumpReplicationEpochResult）共享的 gate 拒绝成员——disabled 结果形状 + 一条
 * committed:false branded fatal。helper 不把两个公共结果类型混成自身返回类型。
 * 私有：不扩公共 exports/类型面。
 */
type ReplicationWriteGateRefusal =
  | Readonly<{ readonly ok: false; readonly issues: unknown[] }>
  | RuntimeWriteFatalError;

/** gate-failure 载体（tagged；`result` 是入口无关的共享拒绝值）。 */
type ReplicationWriteGateFailure = Readonly<{
  readonly kind: 'gate-failure';
  readonly result: ReplicationWriteGateRefusal;
}>;

/** 共享 gate 结果：gate-ready 携带单读捕获的 notifyDirty；gate-failure 携带共享拒绝。 */
type ReplicationWriteGateResult =
  | Readonly<{ readonly kind: 'gate-ready'; readonly notifyDirty: () => Promise<void> }>
  | ReplicationWriteGateFailure;

/**
 * E1/E2 共享 gate（SA2 R1 #4 裁决本 PR 提取，设计 §5.2）：fatal → `getStatus()` →
 * notifier 绑定的短路顺序与 stable message 与既有两槽逐字节一致；零输入访问（不接收
 * 也不读取 caller input；enable 的 E3-only 敌意输入绝不在 gate 内触发）。
 *
 * - E1 fatal 已置位 → disabled（结果联合共享成员；零读取 handle/notifier/input）；
 * - E2 `getStatus()` throw → markWriteFatal + branded RuntimeWriteFatalError
 *   （phase=write-slot-internal、committed:false——尚零 doc 写）；
 * - E2 非 ready（persistence-degraded / released / disposed 同拒）→ disabled；
 * - E2 notifier 未绑定 → disabled（构造方义务 loud gate）；
 * - 全过 → gate-ready + notifyDirty 单读捕获（此后槽体零再读 env.notifyDirty 语义）。
 *
 * 不合并 E3 输入校验、E4 facts、E5 transaction、E5.5 status 同步、E6 notifier await——
 * 各入口在 gate-ready 后独立完成；函数私有，仅本模块两个槽消费。
 */
function runReplicationWriteGate(env: ReplicationWriteEnv): ReplicationWriteGateResult {
  // ── E1 fatal gate（零输入访问）───────────────────────────────────────
  if (env.state.fatal !== undefined) {
    return {
      kind: 'gate-failure',
      result: refusalOf('fatal 已置位（internal fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留）'),
    };
  }

  // ── E2 writable gate + notifier 绑定检查（瞬时观察；零输入访问）────────
  let handleStatus: DocHandleStatus;
  try {
    handleStatus = env.handle.getStatus();
  } catch (err) {
    // adapter bug → 统一 fatal（committed:false——此时尚零 doc 写）
    markWriteFatal(env, err, 'replication');
    return {
      kind: 'gate-failure',
      result: new RuntimeWriteFatalError(
        'write-slot-internal',
        false,
        writeFatalMessage('replication', 'write-slot-internal', false),
        err === undefined ? undefined : { cause: err },
      ),
    };
  }
  if (handleStatus !== 'ready') {
    return {
      kind: 'gate-failure',
      result: refusalOf(
        `DocHandle 状态 ${handleStatus} 不可写（persistence-degraded 阻止全部 Y.Doc 写；released/disposed 同拒）`,
      ),
    };
  }
  if (env.notifyDirty === undefined) {
    return {
      kind: 'gate-failure',
      result: refusalOf(
        'notifyDirty 未绑定——构造方必须绑定 persistence.saveDoc(handle)（ADR-0008 窄接缝）；'
        + '无持久化绑定的 Runtime 拒绝一切 Y.Doc 写，杜绝「提交成功但永无 dirty 登记」的静默失信',
      ),
    };
  }
  return { kind: 'gate-ready', notifyDirty: env.notifyDirty };
}

/** disabled() → 共享拒绝窄化：disabled 恒为 ok:false 分支（write.ts 冻结实现，ok:true
 *  结构性不可达）。此 cast 仅为把 MutateDataResult 联合窄化为共享拒绝成员（拒绝子集
 *  的 ok:false 分支不含 ok:true），零运行时分支、零 message 模板复制——stable message
 *  单一来源仍归 write.ts disabled()。 */
function refusalOf(reason: string): ReplicationWriteGateRefusal {
  return disabled(reason) as ReplicationWriteGateRefusal;
}

/**
 * META 复制保留字段事实读取单点（D-3，构造期 V2.5 与写槽 E4 两个消费方共享）。
 * 四出口：
 * - META 载体缺席（share.has('META') false，纯读守卫、零惰性建图）→ disabled
 *   （事实性真命题：复制身份未安装；载体缺席本身的 loud 面在 getMetadata 的
 *   NSRT-META-E2 保留，双通道互不掩盖）；
 * - 两键真缺席 → disabled（唯一合法 disabled 判据——**键存在性经 has() 判别**：
 *   Yjs `set(k, undefined)` 后 has()===true 且 get()===undefined，该形态经
 *   encodeStateAsUpdate/applyUpdate round-trip 持久化存活——是可持续的损坏形态，
 *   绝不可与「键缺席」同判：键存在而值 undefined 属「部分存在/格式违约」损坏家族，
 *   判 disabled 将允许 enable 静默安装全新谱系（「复制谱系身份不可变」被无声击穿））；
 * - 恰一键存在 / 键存在而值显式 undefined / id 格式违约 / epoch 格式违约 /
 *   载体异型 → throw ReplicationMetaCorruptError（拒绝虚假降级：唯一合法写入面
 *   E5 永不写 undefined、写入前双过格式门，出现即持久化损坏或包缺陷——loud）；
 * - 两键存在且值合法 → enabled（返回冻结对象）。
 *
 * 同步纯读；损坏 → throw（构造通道 = 构造 throw 零副作用；槽通道 = 槽内 internal
 * fatal committed:false——调用方通道差异见 runtime.ts/本文件槽体）。
 */
export function readReplicationFacts(doc: Y.Doc): NamespaceRuntimeReplicationStatus {
  if (!doc.share.has('META')) return Object.freeze({ state: 'disabled' });
  let meta: Y.Map<unknown>;
  try {
    meta = doc.getMap('META'); // 载体异型（同名 Y.Text 等）→ throw
  } catch (err) {
    throw new ReplicationMetaCorruptError('载体异型', { cause: err });
  }
  const hasId = meta.has('replicationId');
  const hasEpoch = meta.has('replicationEpoch');
  if (!hasId && !hasEpoch) return Object.freeze({ state: 'disabled' }); // 两键真缺席
  if (!hasId || !hasEpoch) throw new ReplicationMetaCorruptError('恰一键存在');
  const id = meta.get('replicationId');
  const epoch = meta.get('replicationEpoch');
  if (id === undefined) {
    throw new ReplicationMetaCorruptError('replicationId 键存在而值为显式 undefined');
  }
  if (epoch === undefined) {
    throw new ReplicationMetaCorruptError('replicationEpoch 键存在而值为显式 undefined');
  }
  if (typeof id !== 'string' || !REPLICATION_ID_PATTERN.test(id)) {
    throw new ReplicationMetaCorruptError(`replicationId 格式（观测 ${describeOf(id)}）`);
  }
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1) {
    throw new ReplicationMetaCorruptError(`replicationEpoch 格式（观测 ${describeOf(epoch)}）`);
  }
  return Object.freeze({ state: 'enabled', replicationId: id, replicationEpoch: epoch });
}

/** 观测词（损坏判据 message 专用；只描述 typeof/类别，不含值内容）。 */
function describeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * enableReplication 写槽主函数（E1–E7）。async——同步段无可抛点，一切异常进入返回
 * Promise（sequencer 链尾恒绿接线消化 reject）。
 */
export async function runEnableReplicationSlot(
  env: ReplicationWriteEnv,
  input: unknown,
): Promise<EnableReplicationResult> {
  // ── E1/E2 共享 gate（fatal → writable → notifier 绑定；零输入访问）────────
  const gate = runReplicationWriteGate(env);
  if (gate.kind === 'gate-failure') {
    // 既有双通道结算不变（设计 §5.2）：disabled → 结果联合共享成员直接返回；
    // branded fatal（write-slot-internal、committed:false，markWriteFatal 已同步
    // 置位）→ throw 经 async promise rejection 送达——与既有
    // `return rejectWithWriteFatal(...)` 同一错误对象、同一结算通道
    if (gate.result instanceof RuntimeWriteFatalError) throw gate.result;
    return gate.result;
  }
  const notifyDirty = gate.notifyDirty; // 单读捕获（gate 已捕获；此后槽体零再读 env 字段语义）

  // ── E3 输入校验（单读捕获 + 全探测异常收编——SA2 R1 #2 修订）───────────
  //  单读捕获 = 受控 snapshotter 纪律在不可变标量载荷上的最小实现：快照器有两职责
  //  ——深结构复制（对 string 载荷退化为恒等，copyFrozen 不适用）与「敌意陷阱中和 +
  //  槽起点一次读取后零再读」（对 string 载荷 = 单读捕获 + 探测全 try/catch）。R1
  //  曾以「string 无快照语义」跳过后者（混淆两职责），本修订补齐第二职责。
  //  Proxy get trap 双读分叉（首读合法、次读 'ZZZ'）在此结构性不可达：E5 消费同一
  //  捕获常量，非法值无法穿越格式门直入 META（INV-R9 第二重守卫闭合）。
  let replicationId: string;
  try {
    // 恰一次属性读（捕获）——此后本槽零再读 input；对 null/primitive 的属性读 throw
    // 落入同 try/catch 收编（行为正确：null/primitive 按 REPLICATION_INPUT_INVALID 拒绝）
    const captured = (input as Record<string, unknown> | null | undefined)?.replicationId;
    const keys = Object.keys(input as object); // ownKeys trap throw → 收编
    if (
      typeof input !== 'object' ||
      input === null ||
      keys.length !== 1 ||
      keys[0] !== 'replicationId' ||
      typeof captured !== 'string' ||
      !REPLICATION_ID_PATTERN.test(captured)
    ) {
      return { ok: false, issues: [{ message: REPLICATION_INPUT_INVALID_MESSAGE, path: [] }] };
    }
    replicationId = captured;
  } catch {
    // 敌意 Proxy/getter/ownKeys trap 的任何 throw 收编为类 B issue（结果联合结算）——
    // 绝不裸 reject 原始 TypeError（击穿 INV-R7 二通道纪律）、绝不升格 fatal
    //（防「一次敌意 value → 永久禁写」DoS——write.ts snapshotMutation 立法注释同源）
    return { ok: false, issues: [{ message: REPLICATION_INPUT_INVALID_MESSAGE, path: [] }] };
  }

  // ── E4 领域事实读取（从 live META 读取执行时事实——镜像 S4「执行时 active
  //    schema」纪律）────────────────────────────────────────────────────
  let facts: NamespaceRuntimeReplicationStatus;
  try {
    facts = readReplicationFacts(env.doc);
  } catch (err) {
    // 损坏判据（恰一键存在/键存在而值 undefined/格式违约/载体异型）→ 槽内不变量破坏
    // = internal fatal（committed:false——此时尚零 doc 写）；不静默降级为 disabled
    return rejectWithWriteFatal(env, false, 'write-slot-internal', err, 'replication');
  }
  if (facts.state === 'enabled') {
    // 幂等（D-5）：已启用命名空间再 enable → 零事务、零 notifyDirty、身份/epoch 不变；
    // 调用方传入的 replicationId 被弃用（决策单点在槽内——唯一 sequencer 串行域，
    // 不做 read-then-write 预检；被弃 id 是惰性数据、零副作用）
    return { ok: true };
  }
  // facts.state === 'disabled'：二次纯读判别 META 载体在场（两读之间零 await，
  // JS 单线程 run-to-completion——无 TOCTOU 面；SA2 R1 #6b）
  if (!env.doc.share.has('META')) {
    // 载体缺席 → 拒绝在无 docId 的 META 上凭空造载体（防「下次 loadDoc 被 META.docId
    // 校验击穿」的真实损坏；生产不可达，seedForTest 设施专用防御——D-4/D-5 边界 7）
    return { ok: false, issues: [{ message: REPLICATION_META_ABSENT_MESSAGE, path: [] }] };
  }

  // ── E5 单 Yjs transaction（本槽唯一 Y.Doc 写入口；两键同事务 = 原子安装）──
  try {
    env.doc.transact(() => {
      const meta = env.doc.getMap('META');
      meta.set('replicationId', replicationId); // E3 捕获常量——绝不重读 input（双读分叉不可达）
      meta.set('replicationEpoch', 1);
    });
  } catch (err) {
    // 保守 committed:true（ADR「未知异常保守视为可能已提交」过报方向强制——镜像
    //  write.ts S5）；该路径 E5.5 被跳过 → status.replication 可能陈旧于 live META
    //  （INV-R5 登记的例外窗口：与 SCHEMA 槽 S5.5 先例同构，生产不可达）
    return rejectWithWriteFatal(env, true, 'unknown-pipeline-throw', err, 'replication');
  }

  // ── E5.5 复制事实同步整替（transaction 返回后、await notifyDirty 之前——镜像
  //    SCHEMA 槽 S5.5 installActive 时序：notifier 挂起窗口内 status 已可观测提交
  //    事实；notify-dirty 失败路径不回滚——committed 事实诚实）──────────
  env.state.replication = Object.freeze({ state: 'enabled', replicationId, replicationEpoch: 1 });

  // ── E6 同槽 await notifyDirty（完成信号 = live commit + dirty 登记两者）──
  try {
    await notifyDirty();
  } catch (err) {
    // 写已提交而登记通道损坏——诚实 fatal；不重试（E6 本次即本槽 notifier 唯一一次尝试）
    markWriteFatal(env, err, 'replication');
    throw new RuntimeWriteFatalError(
      'notify-dirty-failed',
      true,
      writeFatalMessage('replication', 'notify-dirty-failed', true),
      err === undefined ? undefined : { cause: err },
    );
  }

  // ── E7 槽释放（promise settle；sequencer 自动放行下一项）───────────────
  return { ok: true };
}

/**
 * bumpReplicationEpoch 写槽主函数（E1–E7；E3 无输入、E4/E5 与 enable 差异见分支）。
 */
export async function runBumpReplicationEpochSlot(
  env: ReplicationWriteEnv,
): Promise<BumpReplicationEpochResult> {
  // ── E1/E2 共享 gate（同 enable——入口无关；bump 无输入面）───────────────
  const gate = runReplicationWriteGate(env);
  if (gate.kind === 'gate-failure') {
    if (gate.result instanceof RuntimeWriteFatalError) throw gate.result;
    return gate.result;
  }
  const notifyDirty = gate.notifyDirty; // 单读捕获

  // ── E4 领域事实读取（无输入——跳 E3）─────────────────────────────────
  let facts: NamespaceRuntimeReplicationStatus;
  try {
    facts = readReplicationFacts(env.doc);
  } catch (err) {
    return rejectWithWriteFatal(env, false, 'write-slot-internal', err, 'replication');
  }
  if (facts.state === 'disabled') {
    // 无谱系即无代际可提升（两键真缺席与载体缺席在此同拒——REPLICATION_NOT_ENABLED，
    // 零写入、零通知）
    return { ok: false, issues: [{ message: REPLICATION_NOT_ENABLED_MESSAGE, path: [] }] };
  }
  if (facts.replicationEpoch >= Number.MAX_SAFE_INTEGER) {
    // overflow：结果面拒绝（D-6）——判据先于任何 +1 运算，MAX+1 永不被计算/存储，
    // 无回绕面（ADR 0010「拒绝提升不回绕」）
    return { ok: false, issues: [{ message: REPLICATION_EPOCH_OVERFLOW_MESSAGE, path: [] }] };
  }

  // ── E5 单 Yjs transaction（本槽唯一 Y.Doc 写入口；replicationId 不触碰——
  //    身份不可变；facts.replicationEpoch <= MAX-1 已由 E4 保证，+1 后 <= MAX 恒安全整数）
  const nextEpoch = facts.replicationEpoch + 1;
  try {
    env.doc.transact(() => {
      env.doc.getMap('META').set('replicationEpoch', nextEpoch);
    });
  } catch (err) {
    return rejectWithWriteFatal(env, true, 'unknown-pipeline-throw', err, 'replication');
  }

  // ── E5.5 复制事实同步整替（同 enable；notify-dirty 失败不回滚——诚实事实）──
  env.state.replication = Object.freeze({
    state: 'enabled',
    replicationId: facts.replicationId,
    replicationEpoch: nextEpoch,
  });
  // ── E5.5' R2-1：bump 槽同步投影步主动 fence（transaction 返回后、await notifyDirty
  //    之前——ADR 0008 #132 L134 槽序「同步投影」步的落点，零新增 sequencer 机制）。
  //    nextEpoch 为全新值 ⇒ 全部现存 channel（全部冻结旧 epoch）被 fence——conflicted
  //    终态 + 摘除 + 未投递排队项取消（F-3：bump 自身 META 写零投递给旧 session）。
  //    **enable 槽不 fence**（显式裁决，§2.1）：open 门序要求 facts enabled ⇒ disabled
  //    文档结构性不可能持有 session；已启用文档的 enable 为幂等零写，其 E5 事务（首装
  //    谱系）发生时 fanout channel 集合必空。SA3 不得在 enable 槽加 fence 调用。──
  env.fanout.fenceStale(facts.replicationId, nextEpoch);

  // ── E6 同槽 await notifyDirty ──────────────────────────────────────
  try {
    await notifyDirty();
  } catch (err) {
    markWriteFatal(env, err, 'replication');
    throw new RuntimeWriteFatalError(
      'notify-dirty-failed',
      true,
      writeFatalMessage('replication', 'notify-dirty-failed', true),
      err === undefined ? undefined : { cause: err },
    );
  }

  // ── E7 槽释放 ──────────────────────────────────────────────────────
  return { ok: true };
}
