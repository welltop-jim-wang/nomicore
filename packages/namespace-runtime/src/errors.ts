/**
 * @nomicore/namespace-runtime —— 错误类别与稳定 code 注册表（设计 §3/§11 errors.ts）。
 *
 * 约定：
 * - 构造错误（V2 状态门）与投影守卫错误（SCHEMA/META）是包内类别——index 不导出
 *   它们（公共入口只暴露 seam 构造器与类型；错误类别以稳定 code + 稳定 message
 *   供诊断，调用方按 code/message 字符串消费，不按 instanceof）。
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

/** ROOT 写禁用稳定码（D9）：出现在 ok:false issue.message 内（JSON.stringify 含码判定）。 */
export const RUNTIME_WRITE_DISABLED_CODE = 'RUNTIME_WRITE_DISABLED' as const;

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
 * SCHEMA 四键投影值域守卫错误（D4 ③ / INV-N13，R2 修订，SA2 #1）：
 * 公共读取面发现 SCHEMA 标准键持有非 primitive 值（object≠null/function/symbol，
 * 覆盖一切 Y.AbstractType/类实例/Uint8Array）→ loud throw——live writable Yjs 引用
 * 零出站。message 含键名与观测 typeof，绝不含值内容。
 */
export class SchemaProjectionError extends Error {
  readonly code = 'NSRT-SCHEMA-E1' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SchemaProjectionError';
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
  | 'write-slot-internal'; // 槽内不变量破坏（结构不可达报警）/ getStatus() adapter 违背

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
