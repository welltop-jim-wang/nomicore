/**
 * @nomicore/namespace-runtime —— schema re-arm（issue #286 / ADR 0018 §1–§3）。
 *
 * 本模块承载「事务后 compile+install 共享段」：从**已提交** doc 的 SCHEMA 四键投影
 * 编译、形状守卫、原子安装 active schema tools、updatedAt 投影——两个消费方：
 * - Hub SCHEMA 写槽 S5.5（schema-write.ts，issue #286 预重构：原 installActive 直调
 *   段收敛进本共享段，两侧词汇对称——ADR 0018 §1「与 Hub 写槽的事务后安装同一段
 *   逻辑」）；
 * - peer 角色 hub→peer 复制 apply 槽 R5.6 schema 同步段（replication-session.ts）。
 *
 * 纪律：
 * - 检测成本：apply 槽开始捕获 SCHEMA 四键快照（snapshotSchemaFourKeys——raw 直读、
 *   纯读零副作用），提交后重取；`text` 不等才进入编译——不为每次 apply 付编译成本。
 *   真相来源是本地 doc 已提交的 SCHEMA，不依赖任何显式通知帧（ADR 0018 §1）。
 * - `updatedAt` 恒投影自已提交的 `META.schema`（projectSchemaUpdatedAt）：peer 永不
 *   读本地时钟生成它（ADR 0010 issue #282 修订第 3 条）；Hub 侧投影值 = 本槽事务
 *   写入的同一字符串（同事务原子提交）。缺席/异型 → null（诚实缺席）。
 * - 失败双码（ADR 0018 §3，errors.ts 注册表 append-only）：编译结果失败（结果联合
 *   内 ok:false）→ NSRT-FATAL-SCHEMA-REARM-INVALID（带稳定 schema issue 摘要）；
 *   结果联合之外（compile throw / ok:false 零 issues / 畸形 ok:true）→
 *   NSRT-FATAL-SCHEMA-REARM-INTERNAL。fatal 置位单点在本模块（rearmPeerActiveSchema）
 *   ——写永久禁用、读保留；tools 保持旧的不动（失败路径不触碰 activeTools/activeInfo）。
 * - re-arm 不主动校验完整 ROOT（ADR 0018 §6：沿用「非写场景不校验 ROOT」哲学）。
 *
 * 模块级导出面（包内通道）：类型 + snapshotSchemaFourKeys +
 * syncActiveSchemaFromCommittedDoc（schema-write.ts 消费）+ rearmPeerActiveSchema
 * （replication-session.ts 消费）；index.ts 零 re-export。
 */
import type * as Y from 'yjs';
import type {
  CompileSchemaEnvelopeResult,
  SchemaEnvelope,
  SchemaParseIssue,
} from '@nomicore/vfsl';
import {
  FATAL_SCHEMA_REARM_INTERNAL_CODE,
  FATAL_SCHEMA_REARM_INTERNAL_MESSAGE,
  FATAL_SCHEMA_REARM_INVALID_CODE,
  FATAL_SCHEMA_REARM_INVALID_MESSAGE,
} from './errors.js';
import { assertCompiledShape, installActive, toIssueSummary } from './p0.js';
import type { ActiveSchemaInfo, RuntimeState } from './p0.js';
import { projectSchemaEnvelope, projectSchemaUpdatedAt } from './projection.js';

/**
 * 槽开始/提交后 SCHEMA 四键快照（检测成本纪律的载体——raw 直读四键，纯读零副作用，
 * 不惰性建图）。值原样捕获（不投影不校验——比较判据只需文本字节不等；非 primitive
 * 的损坏形态以引用不等如实触发重编译，由 compile 严格门响亮收编）。
 */
export interface SchemaFourKeySnapshot {
  /** SCHEMA 载体在场且为 Y.Map（缺席/异型 → false，四值恒 undefined）。 */
  readonly present: boolean;
  readonly lang: unknown;
  readonly version: unknown;
  readonly id: unknown;
  readonly text: unknown;
}

/** 四键快照（纯读；share.has 判别载体在场——零惰性 getMap 副作用；载体异型 getMap
 *  throw 收编为 present:false 缺席态——保守不触发 re-arm，异型面由公共读取
 *  NSRT-SCHEMA-E2 负责响亮）。 */
export function snapshotSchemaFourKeys(doc: Y.Doc): SchemaFourKeySnapshot {
  if (!doc.share.has('SCHEMA')) {
    return Object.freeze({ present: false, lang: undefined, version: undefined, id: undefined, text: undefined });
  }
  let sc: Y.Map<unknown>;
  try {
    sc = doc.getMap('SCHEMA');
  } catch {
    return Object.freeze({ present: false, lang: undefined, version: undefined, id: undefined, text: undefined });
  }
  return Object.freeze({
    present: true,
    lang: sc.get('lang'),
    version: sc.get('version'),
    id: sc.get('id'),
    text: sc.get('text'),
  });
}

/** 共享段运行时环境（调用栈一次成型——纯数据闭包；doc/state/compile 均为各槽既有
 *  捕获局部量，INV-N14 纪律延续，零新增注入点）。 */
export interface CommittedSchemaSyncEnv {
  /** live Y.Doc 引用（事务已提交——本段只读 doc）。 */
  readonly doc: Y.Doc;
  /** 与 P0 共享的唯一可变源（本段只写 activeInfo/activeTools/schemaState/schemaIssue
   *   ——经 installActive 单点；fatal 域仅 rearmPeerActiveSchema 触碰）。 */
  readonly state: RuntimeState;
  /** 编译步（构造栈 V3b 捕获——与 P0/SCHEMA 写槽同一 seam 注入）。 */
  readonly compile: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
}

/**
 * 共享段结局（内部联合；fatal 置位不归本层——调用方槽按自身 fatal 码族结算）。
 * - `installed`：编译成功 + 形状守卫通过 + installActive 完成；`info` = 安装后的
 *   冻结六字段身份（installActive 产物——纯字符串/null 数据，无 live 引用）；
 * - `compile-failed`：结果联合内 ok:false 且 issues 非空（领域失败——Hub 提交前已
 *   编译成功的同一文本在 peer 侧失败 = 版本偏移/字节损坏）；
 * - `internal`：结果联合之外（compile throw / ok:false 零 issues / 畸形 ok:true /
 *   安装后身份缺席——结构性不可达防御）。
 */
export type CommittedSchemaSyncResult =
  | Readonly<{ kind: 'installed'; info: ActiveSchemaInfo }>
  | Readonly<{ kind: 'compile-failed'; issues: readonly SchemaParseIssue[] }>
  | Readonly<{ kind: 'internal'; cause: unknown }>;

/**
 * 事务后 compile+install 共享段（ADR 0018 §1 第 2/3 步 + ADR 0008 修订节第 1 条）。
 * 同步执行、零 doc 写（唯一写面 = state 的 active 域，经 installActive）；调用时序
 * 约束 = 事务提交之后、`await notifyDirty()` 之前（notifier 挂起窗口内公共投影即
 * 对应新 committed generation——沿既有 S5.5 锚 9 时序）。
 */
export function syncActiveSchemaFromCommittedDoc(env: CommittedSchemaSyncEnv): CommittedSchemaSyncResult {
  // ① 四键投影（与 P0/公共 getSchema 同源单点；mode 'p0'——非 primitive 违规键省略，
  //    live 引用绝不进 compile 输入；载体缺席/异型 → null → compile ENV-1 收编）
  let result: CompileSchemaEnvelopeResult;
  try {
    const projection = projectSchemaEnvelope(env.doc, 'p0');
    result = env.compile(projection as SchemaEnvelope); // 验证权单源在 compile 严格门（沿 P0 `as` 先例）
  } catch (err) {
    return { kind: 'internal', cause: err };
  }
  if (!result.ok) {
    if (result.issues.length === 0) {
      // ok:false 且零 issue = 结果联合外的契约违背（沿 P0/schema-write 同款判据）
      return {
        kind: 'internal',
        cause: new Error('compile 返回 ok:false 且零 issues——结果联合之外的状态'),
      };
    }
    return { kind: 'compile-failed', issues: result.issues };
  }
  // ② 最小形状守卫（与 P0 ⑤/SCHEMA 写槽 S4 同一守卫——畸形 ok:true → internal）
  try {
    assertCompiledShape(result);
  } catch (err) {
    return { kind: 'internal', cause: err };
  }
  // ③ 原子安装（installActive 单点：六字段冻结身份 + 内部 tools 保留 + 状态迁回
  //    'ready' + delete schemaIssue——P0 失败 Runtime 经本段自愈恢复写能力）；
  //    updatedAt 投影自已提交 META.schema（peer 永不读本地时钟；Hub 侧 = 本槽事务
  //    写入的同一字符串）；legacy/损坏 → null（诚实缺席）
  installActive(result, env.state, projectSchemaUpdatedAt(env.doc));
  const info = env.state.activeInfo;
  if (info === undefined) {
    // 结构性不可达（installActive 恒写入 activeInfo）——防御归 internal
    return { kind: 'internal', cause: new Error('installActive 后 activeInfo 缺席——内部不变量破坏') };
  }
  return { kind: 'installed', info };
}

/**
 * peer re-arm detached outcome 投影（ADR 0018 §1/§3 + issue #286 第 3 节下游契约）：
 * apply 结果 ok:true 分支的可选扩展字段，供 ws-replication 层发射 observer 事件
 * （协议 §23.1 第 23/24 型）与触发 channel 关闭。纯数据冻结对象——string/null/稳定码
 * 字面量，零 live 对象（§23.3 safe-field 清单同源：fingerprint/updatedAt/稳定码/
 * 稳定 schema issue 摘要，不含 schema 文本/ROOT/堆栈）。
 */
export type RuntimeReplicationSchemaRearmOutcome =
  | Readonly<{
      /** 安装成功（含纯格式差异的 fingerprint 不变安装——ADR 0017「每次提交都推进
       *  updatedAt」对齐，不据 semantic fingerprint 跳过）。 */
      readonly kind: 'applied';
      /** 新安装 active schema 的语义指纹（compile 产物引用逐字节一致——§23.1 事件字段同名）。 */
      readonly semanticFingerprint: string;
      /** 投影自复制来的 META.schema（诚实缺席 = null）。 */
      readonly updatedAt: string | null;
    }>
  | Readonly<{
      /** re-arm fatal 已置位（写永久禁用、读保留；tools 保持旧的不动；apply 已提交
       *  事实不回滚——本字段随 ok:true 结果携带，apply 槽本身不失败）。 */
      readonly kind: 'failed';
      readonly code:
        | typeof FATAL_SCHEMA_REARM_INVALID_CODE
        | typeof FATAL_SCHEMA_REARM_INTERNAL_CODE;
      /** 稳定 schema issue 摘要（仅 INVALID 在场——toIssueSummary 派生，冻结纯字符串对）。 */
      readonly issue?: Readonly<{ code: string; message: string }>;
    }>;

/**
 * peer apply 槽 R5.6 schema 同步段驱动（ADR 0018 §1–§3）。仅在「槽开始快照与提交后
 * 快照 text 不等」时由 apply 槽调用；fatal 置位单点：
 * - compile-failed → INVALID（message 尾部追加稳定 schema issue 摘要——ADR 明文；
 *   摘要经 toIssueSummary 同源派生，不含原始异常）；
 * - internal → INTERNAL（恒定文案；原始异常进包内诊断锚点 state.fatalCause）。
 * 成功/失败均返回冻结 detached outcome；失败路径不触碰 activeTools/activeInfo
 * （tools 保持旧的不动——installActive 未被到达）。
 */
export function rearmPeerActiveSchema(env: CommittedSchemaSyncEnv): RuntimeReplicationSchemaRearmOutcome {
  const sync = syncActiveSchemaFromCommittedDoc(env);
  if (sync.kind === 'installed') {
    return Object.freeze({
      kind: 'applied',
      semanticFingerprint: sync.info.semanticFingerprint,
      updatedAt: sync.info.updatedAt,
    });
  }
  if (sync.kind === 'compile-failed') {
    const first = sync.issues[0];
    if (first === undefined) {
      // 结构性不可达（compile-failed 恒非空 issues）——防御折叠进 INTERNAL
      env.state.fatal = Object.freeze({
        code: FATAL_SCHEMA_REARM_INTERNAL_CODE,
        message: FATAL_SCHEMA_REARM_INTERNAL_MESSAGE,
      });
      env.state.fatalCause = new Error('compile-failed 零 issues——内部不变量破坏');
      return Object.freeze({ kind: 'failed', code: FATAL_SCHEMA_REARM_INTERNAL_CODE });
    }
    const summary = Object.freeze(toIssueSummary(first));
    env.state.fatal = Object.freeze({
      code: FATAL_SCHEMA_REARM_INVALID_CODE,
      message: `${FATAL_SCHEMA_REARM_INVALID_MESSAGE} schema issue 摘要：${summary.code}: ${summary.message}`,
    });
    return Object.freeze({ kind: 'failed', code: FATAL_SCHEMA_REARM_INVALID_CODE, issue: summary });
  }
  env.state.fatal = Object.freeze({
    code: FATAL_SCHEMA_REARM_INTERNAL_CODE,
    message: FATAL_SCHEMA_REARM_INTERNAL_MESSAGE,
  });
  env.state.fatalCause = sync.cause; // 包内诊断锚点（不进任何公共面——沿 P0 ⑦ 先例）
  return Object.freeze({ kind: 'failed', code: FATAL_SCHEMA_REARM_INTERNAL_CODE });
}
