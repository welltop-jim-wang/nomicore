/**
 * @nomicore/namespace-runtime —— 公共入口（ADR-0008 Runtime 骨架子集；issue #89）。
 *
 * 公共面纪律（AC1/AC2 锚定）：
 * - 只导出类型 + @internal 包内确定性 seam 构造器 createNamespaceRuntimeWithSeam；
 * - 生产构造器 createNamespaceRuntime 保留包内（runtime.ts 内部函数，未 re-export）
 *   ——测试锁定 entry.createNamespaceRuntime === undefined；未来 Registry 使用；
 * - 不导出 WriteSequencer / 运行态 / 错误类别（错误类别以稳定 code + 稳定 message
 *   字符串消费，不按 instanceof）；handler/Y.Doc/sequencer 永不从本入口出现。
 */
export { createNamespaceRuntimeWithSeam } from './runtime.js';
export type {
  NamespaceRuntime,
  NamespaceRuntimeSeamInput,
} from './runtime.js';
export type { NamespaceRuntimeStatus } from './status.js';
export type { ActiveSchemaInfo } from './p0.js';
