/**
 * @nomicore/namespace-runtime —— 错误类别与稳定 code 注册表（设计 §3/§11 errors.ts）。
 *
 * 约定：
 * - 构造错误（V2 状态门）与投影守卫错误（SCHEMA/META）是包内类别——index 不导出
 *   它们（公共入口只暴露 seam 构造器与类型；错误类别以稳定 code + 稳定 message
 *   供诊断，调用方按 code/message 字符串消费，不按 instanceof）。
 * - fatal code 注册表：P0 internal fault 的唯一稳定 code/文案（ADR-0008「稳定且
 *   不含原始 Error/stack」——文案恒定，不插值原始异常）。
 */

/** P0 internal fault 稳定 code（D7 ⑦；DRM：仅此一个注册值，公共面只读不构造）。 */
export const FATAL_P0_INTERNAL_CODE = 'NSRT-FATAL-P0-INTERNAL' as const;

/** P0 internal fault 稳定 message（恒定文案：不含任何原始异常文本/stack/cause）。 */
export const FATAL_P0_INTERNAL_MESSAGE =
  'P0 schema preparation internal fault：编译通道产生结果联合之外的异常；本 Runtime 全部写已永久关闭，读取保留。' as const;

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
