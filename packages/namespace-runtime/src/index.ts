/**
 * @nomicore/namespace-runtime —— 公共入口（ADR-0008 Runtime 骨架子集；issue #89 + #90 + #91 + #92）。
 *
 * #92 公共面演进：Runtime 十键（+close 生命周期键）；getStatus 七键（+close 摘要键、
 * lifecycle 三态）；read 结果联合 +RuntimeReadDisabledResult 分支（closing/closed 期
 * 停接纳）。
 *
 * #273 增量（ADR-0016）：readData 成功分支形状演进为 { ok:true, value, schema }——
 * schema 为路径语义投影（ReadDataSchemaProjection | null，每次读 detached 深拷贝、
 * always-on 零开关）；失败分支（PATH_NOT_ALLOWED / RUNTIME_READ_DISABLED）与十二键
 * 键集不变；类型导出键集不变（NamespaceRuntimeReadDataResult 形状随组合面演进）。
 *
 * #336 增量（ADR-0024 决策 4/6，破坏性修订）：readData 成功分支**恒五键**（+#truncated
 * /+truncations）；新增预算重载 `readData(path, options?)`（同一预算贯通值与投影两通道）
 * 与预算结果联合 `NamespaceRuntimeReadDataBudgetResult`（追加 READ_OPTIONS_INVALID 失败
 * 分支；legacy 联合零泄漏）；新增 options 别名 `NamespaceRuntimeReadDataOptions` 与
 * `ReadLogicalValueTruncationEntry` 转出（全部 type-only——值导出面仍恰
 * RuntimeWriteFatalError 一键）。
 *
 * #132 增量：Runtime 十二键（+enableReplication/bumpReplicationEpoch 复制管理操作键）；
 * getStatus 八键（+replication 复制域）；type-only 追加五个复制管理类型（值导出面仍
 * 恰一键——REPLICATION_ID_PATTERN 等值导出不进本入口）。
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
 * - handler/Y.Doc/sequencer 永不从本入口出现；mutateData 是 runtime 面方法而非模块级导出。
 */
export { RuntimeWriteFatalError } from './errors.js';
export type {
  NamespaceRuntime,
  NamespaceRuntimeReadDataBudgetResult,
  NamespaceRuntimeReadDataOptions,
  NamespaceRuntimeReadDataResult,
  RuntimeReadDisabledResult,
} from './runtime.js';
// #336（ADR-0024 T3）：截断清单条目的公共命名面（消费方无需直依 doc-runtime——
// 单源转出，零复制；doc-runtime 为 runtime 既有 dependency，d.ts 引用可解析）。
export type { ReadLogicalValueTruncationEntry } from '@nomicore/doc-runtime';
export type { NamespaceRuntimeStatus } from './status.js';
export type { ActiveSchemaInfo } from './p0.js';
export type { RuntimeWriteFatalPhase } from './errors.js';
export type { DataMutationIssue, MutateDataResult } from './write.js';
export type { ReplaceSchemaInput, SchemaReplacementIssue, ReplaceSchemaResult } from './schema-write.js';
// issue #132：复制管理写面的公共类型（type-only——值导出面仍恰 RuntimeWriteFatalError
// 一键冻结；REPLICATION_ID_PATTERN 等值导出不进本入口）。
export type {
  BumpReplicationEpochResult,
  EnableReplicationInput,
  EnableReplicationResult,
  NamespaceRuntimeReplicationStatus,
  ReplicationManagementIssue,
} from './replication-write.js';
