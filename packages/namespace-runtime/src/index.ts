/**
 * @nomicore/namespace-runtime —— 公共入口（ADR-0008 Runtime 骨架子集；issue #89 + #90）。
 *
 * 公共面纪律（AC1/AC2/AC9 锚定）：
 * - 只导出类型 + @internal 包内确定性 seam 构造器 createNamespaceRuntimeWithSeam；
 * - 生产构造器 createNamespaceRuntime 保留包内（runtime.ts 内部函数，未 re-export）
 *   ——测试锁定 entry.createNamespaceRuntime === undefined；未来 Registry 使用；
 * - 不导出 WriteSequencer / 运行态；构造/投影错误类别仍不导出（code+message 字符串
 *   消费）；`RuntimeWriteFatalError` 是 ADR-0008 点名的稳定 rejection 形状，例外值
 *   导出（instanceof 判别 committed/phase 是上层「不得自动重试非幂等写」纪律的依赖面）；
 * - handler/Y.Doc/sequencer 永不从本入口出现；mutateRoot 是 runtime 面方法而非模块级导出。
 */
export { createNamespaceRuntimeWithSeam } from './runtime.js';
export { RuntimeWriteFatalError } from './errors.js';
export type {
  NamespaceRuntime,
  NamespaceRuntimeSeamInput,
} from './runtime.js';
export type { NamespaceRuntimeStatus } from './status.js';
export type { ActiveSchemaInfo } from './p0.js';
export type { RuntimeWriteFatalPhase } from './errors.js';
export type { RootMutationIssue, MutateRootResult } from './write.js';
