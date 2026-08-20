/**
 * @nomicore/vfsl-codegen —— 投影生成器（ADR 0005 F2 / issue #26）。
 *
 * 公共导出面（最小化，§2）：仅 `generateProjection` 纯发射器 + 选项类型；
 * CLI 内部函数不导出（被测面与契约面重合，杜绝 scope creep）。
 */
export { generateProjection } from './emitter.js';
export type { GenerateProjectionOptions } from './emitter.js';
