/**
 * @nomicore/namespace-runtime —— 错误类别与稳定 code 注册表（设计 §3/§11 errors.ts）。
 *
 * 约定：
 * - 构造错误（V2 状态门）与投影守卫错误（SCHEMA/META）是包内类别——index 不导出
 *   它们（#93 rev2 收口：公共入口值导出恰 RuntimeWriteFatalError 一键 + 类型导出；
 *   seam 与生产工厂保留 runtime.ts 模块级、不经 index；错误类别以稳定 code + 稳定
 *   message 供诊断，调用方按 code/message 字符串消费，不按 instanceof）。
 * - fatal code 注册表：P0 internal fault 与写槽 internal fault 的唯一稳定
 *   code/文案（ADR-0008「稳定且不含原始 Error/stack」——文案恒定，不插值原始异常）。
 * - 【R2】`RuntimeWriteFatalError` + `RuntimeWriteFatalPhase` 同源声明于此并从
 *   index.ts 经本文件导出（类型声明与值导出同源——消除声明地/导出地二选一分歧）。
 */
import type { DocRuntimeFatalPhase } from '@nomicore/doc-runtime';

/** P0 internal fault 稳定 code（D7 ⑦；DRM：仅此一个注册值，公共面只读不构造）。 */
export const FATAL_P0_INTERNAL_CODE = 'NSRT-FATAL-P0-INTERNAL' as const;

/** P0 internal fault 稳定 message（恒定文案：不含任何原始异常文本/stack/cause）。 */
export const FATAL_P0_INTERNAL_MESSAGE =
  'P0 schema preparation internal fault：编译通道产生结果联合之外的异常；internal fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留。' as const;

/** 写槽 internal fault 稳定 code（D5.4：与 P0 fatal code 区分来源；status 投影可判别）。 */
export const FATAL_WRITE_INTERNAL_CODE = 'NSRT-FATAL-WRITE-INTERNAL' as const;

/** 写槽 internal fault 稳定 message（恒定文案：不含任何原始异常文本/stack/cause——INV-N7）。 */
export const FATAL_WRITE_INTERNAL_MESSAGE =
  'ROOT write internal fault：写管线产生结果联合之外的 internal fatal；该 fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留。' as const;

/** SCHEMA 写槽 internal fault 稳定 code（D9，issue #91——append-only：与 ROOT 写槽的
 *  NSRT-FATAL-WRITE-INTERNAL 区分来源，status.fatal 诊断不失真）。 */
export const FATAL_SCHEMA_WRITE_INTERNAL_CODE = 'NSRT-FATAL-SCHEMA-WRITE-INTERNAL' as const;

/** SCHEMA 写槽 internal fault 稳定 message（恒定文案：不含任何原始异常文本/stack/cause——INV-N7）。 */
export const FATAL_SCHEMA_WRITE_INTERNAL_MESSAGE =
  'SCHEMA write internal fault：写管线产生结果联合之外的 internal fatal；该 fatal 已永久禁用本 Runtime 的全部写能力，读取仍保留。' as const;

/** ROOT 写禁用稳定码（D9）：出现在 ok:false issue.message 内（JSON.stringify 含码判定）。 */
export const RUNTIME_WRITE_DISABLED_CODE = 'RUNTIME_WRITE_DISABLED' as const;

/** close barrier release 失败稳定 code（#92；NSRT-* 命名族）。 */
export const CLOSE_RELEASE_FAILED_CODE = 'NSRT-CLOSE-RELEASE-FAILED' as const;

/** close barrier release 失败稳定 message（恒定文案：不含原始异常文本/stack；close 域
 *  术语——与 fatal 域文案分域（INV-C10））。 */
export const CLOSE_RELEASE_FAILED_MESSAGE =
  'close barrier 的 handle.release() 失败：Runtime 已进入 closed（生命周期不受 release 成败影响）；原始异常经 close Promise rejection 的 cause 与包内诊断锚点保留，不进 status 摘要。' as const;

/** closing/closed 期 read 停接纳稳定码（#92；与 RUNTIME_WRITE_DISABLED 对偶的 read 域码）。 */
export const RUNTIME_READ_DISABLED_CODE = 'RUNTIME_READ_DISABLED' as const;

/** closing/closed 期数据投影 getter 停接纳错误（#93 rev2，SA8 裁决 B）：同步 loud
 *  throw 稳定码 RUNTIME_READ_DISABLED——getter 返回类型非结果联合（ADR-0008 L30-32
 *  冻结），生命周期拒绝复用 read 域停接纳码族（L117 已注册）+ getter 域 message
 *  文案（L119「区分域靠 message 文案，不另设新码」的码族纪律）。类不导出。 */
export class RuntimeReadDisabledError extends Error {
  readonly code = RUNTIME_READ_DISABLED_CODE; // 'RUNTIME_READ_DISABLED'（errors.ts 既有常量）

  constructor(
    getter: 'getSchemaEnvelope' | 'getMetadata' | 'getActiveSchema',
    lifecycle: 'closing' | 'closed',
  ) {
    super(
      `${RUNTIME_READ_DISABLED_CODE}: ${getter} 已停接纳——Runtime lifecycle 为 ${lifecycle}` +
        '（close 已停止接纳公共数据投影读取）；本调用不触碰 live Y.Doc',
    );
    this.name = 'RuntimeReadDisabledError';
  }
}

/** snapshotter 拒绝稳定码（D9）：非 plain data 输入（含数组分支四查与读取面抛错收编）。 */
export const MUTATION_INPUT_NOT_PLAIN_DATA_CODE = 'MUTATION_INPUT_NOT_PLAIN_DATA' as const;

/** schema 不可用稳定码（D9）：S4 unavailable 零写入失败（SCHEMA write 仍可修复）。 */
export const SCHEMA_UNAVAILABLE_CODE = 'SCHEMA_UNAVAILABLE' as const;

/** 构造错误（D1 V2 状态门）：released/disposed/未知状态 → 同步 throw。类不导出。 */
export class NamespaceRuntimeConstructionError extends Error {
  readonly code = 'HANDLE_NOT_USABLE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'NamespaceRuntimeConstructionError';
  }
}

/**
 * close rejection 稳定形状（#92，包内类——不导出，沿 NamespaceRuntimeConstructionError
 * 先例：code+message 字符串消费 / getStatus().close 分类；cause 零信息损失保留原始异常）。
 */
export class NamespaceRuntimeCloseError extends Error {
  readonly code = CLOSE_RELEASE_FAILED_CODE;

  constructor(options?: ErrorOptions) {
    super(CLOSE_RELEASE_FAILED_MESSAGE, options);
    this.name = 'NamespaceRuntimeCloseError';
  }
}

/**
 * SCHEMA 投影错误（D4 ③ / INV-N13，R2 修订，SA2 #1；rev2 宽化，评审项 6/SA8 裁决 D）
 * ——两个 code 并列注册、一个哲学（镜像 MetaProjectionError E1|E2 双码先例）：
 * - NSRT-SCHEMA-E1：SCHEMA 四键投影值域守卫——公共读取面发现 SCHEMA 标准键持有非
 *   primitive 值（object≠null/function/symbol，覆盖一切 Y.AbstractType/类实例/
 *   Uint8Array）→ loud throw——live writable Yjs 引用零出站。message 含键名与观测
 *   typeof，绝不含值内容；
 * - NSRT-SCHEMA-E2：SCHEMA 载体异型（同名条目非 Y.Map，getMap throw）→ public 模式
 *   loud throw——载体损坏 ≠ 缺席，静默映射 null 即虚假降级（镜像 META-E2 判据）；
 *   p0 模式返回 null（数据级收编，禁 fatal——保 SCHEMA write 修复路径）。
 */
export class SchemaProjectionError extends Error {
  readonly code: 'NSRT-SCHEMA-E1' | 'NSRT-SCHEMA-E2';

  constructor(code: 'NSRT-SCHEMA-E1' | 'NSRT-SCHEMA-E2', message: string) {
    super(message);
    this.name = 'SchemaProjectionError';
    this.code = code;
  }
}

/**
 * META 投影错误（D5，R2 修订，SA2 #2）——两个 code 并列注册、一个哲学：
 * - NSRT-META-E1：META 值域违规（嵌套 Yjs shared type / bigint / undefined / function /
 *   symbol / non-finite number / 非 plain 原型对象）→ loud，绝不静默跳键；
 * - NSRT-META-E2：META 载体异常（条目缺席或同名异型）→ loud——生产路径不可达
 *   （createDoc/loadDoc 强制 META.docId 匹配校验），仅 seedForTest 测试设施可造，
 *   出现即上游 bug，拒绝静默 null（拒绝虚假降级）。
 */
export class MetaProjectionError extends Error {
  readonly code: 'NSRT-META-E1' | 'NSRT-META-E2';

  constructor(code: 'NSRT-META-E1' | 'NSRT-META-E2', message: string) {
    super(message);
    this.name = 'MetaProjectionError';
    this.code = code;
  }
}

/**
 * 写槽 fatal phase 取值集（D5.1，v1 冻结——一经发布只增不改不删）。
 * doc-runtime 三相位（DocRuntimeFatalPhase 冻结表）透传 + Runtime 侧三相位注册。
 */
export type RuntimeWriteFatalPhase =
  | DocRuntimeFatalPhase // 'observer-cleanup-throw' | 'post-commit-verification' | 'pre-commit-internal'
  | 'unknown-pipeline-throw' // applyValidatedMutation 逃逸的未知异常（保守 committed:true）
  | 'notify-dirty-failed' // S6 notifier rejection（写已提交，登记通道损坏）
  | 'write-slot-internal' // 槽内不变量破坏（结构不可达报警）/ getStatus() adapter 违背
  | 'schema-compile-throw'; // SCHEMA write 编译通道违约（compile throw / ok:false 零 issues /
                           // 畸形 ok:true 含 envelope 恰四键封闭/四值型违规——结构上先于一切
                           // doc 写，committed:false）【issue #91，append-only：与
                           // write-slot-internal 区分诊断面（D5）】

/**
 * ADR-0008 原文命名的稳定 rejection 形状（D5.1）——写槽 internal fatal 的公共载体。
 * 只携带事实（延续 doc-runtime W4 哲学）：不调用 notifyDirty、不关写能力——一切
 * Runtime 层动作在 write.ts 槽内完成。
 *
 * - `committed`：诚实提交事实——true = 事务已提交或保守视为已提交（W3 不得降格 false）；
 *   false = 确定零写入。
 * - `phase`：稳定字符串（DocRuntimeFatalPhase 三相位 + Runtime 侧三相位）。
 * - `cause`（ES2022 ErrorOptions）：原始异常实例零信息损失保留（「始终 reject 原始
 *   fatal」的载体）；rejection 值本身恒为本稳定 branded 类（instanceof 消费面）。
 */
export class RuntimeWriteFatalError extends Error {
  readonly committed: boolean;
  readonly phase: RuntimeWriteFatalPhase;

  constructor(phase: RuntimeWriteFatalPhase, committed: boolean, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeWriteFatalError';
    this.committed = committed;
    this.phase = phase;
  }
}
