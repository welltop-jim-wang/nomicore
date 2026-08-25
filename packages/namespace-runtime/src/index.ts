/**
 * @nomicore/namespace-runtime —— 公共入口（ADR-0008 Runtime 骨架子集；issue #89 + #90 + #91 + #92）。
 *
 * #92 公共面演进：Runtime 十键（+close 生命周期键）；getStatus 七键（+close 摘要键、
 * lifecycle 三态）；read 结果联合 +RuntimeReadDisabledResult 分支（closing/closed 期
 * 停接纳）。
 *
 * 公共面纪律（AC1/AC2/AC6/AC9 锚定；issue #93 round 2 收口）：
 * - 值导出恰一键：RuntimeWriteFatalError（ADR-0008 点名的稳定 rejection 形状——
 *   instanceof 判别 committed/phase 是上层「不得自动重试非幂等写」纪律的依赖面）；
 * - 测试 seam（createNamespaceRuntimeWithSeam + NamespaceRuntimeSeamInput）与生产
 *   工厂 createNamespaceRuntime 一并保留包内（runtime.ts 模块级导出，ADR-0008
 *   「测试通过包内确定性 seam 注入」「生产工厂保留包内」——「包内」= 包内模块通道
 *   相对导入，不经本入口，亦不设 ./testing 子路径 export）；本入口对二者零
 *   re-export——seam 输入类型含 DocHandle，随值一并撤出公共面（AC6 点名对象）；
 * - 不导出 WriteSequencer / 运行态；构造/投影错误类别仍不导出（code+message
 *   字符串消费）；
 * - handler/Y.Doc/sequencer 永不从本入口出现；mutateRoot 是 runtime 面方法而非模块级导出。
 */
export { RuntimeWriteFatalError } from './errors.js';
export type {
  NamespaceRuntime,
  NamespaceRuntimeReadResult,
  RuntimeReadDisabledResult,
} from './runtime.js';
export type { NamespaceRuntimeStatus } from './status.js';
export type { ActiveSchemaInfo } from './p0.js';
export type { RuntimeWriteFatalPhase } from './errors.js';
export type { RootMutationIssue, MutateRootResult } from './write.js';
export type { ReplaceSchemaInput, SchemaReplacementIssue, ReplaceSchemaResult } from './schema-write.js';
