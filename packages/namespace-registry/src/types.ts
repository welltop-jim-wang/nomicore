/**
 * @nomicore/namespace-registry —— 冻结公共类型与临时扩展位语义
 * （issue #110 设计 §3；ADR-0009 的 Registry/Lease 公共面）。
 *
 * 声明纪律（issue #110 设计 §2.2）：本文件是主入口可达声明图的一部分，其文本不得
 * 出现运行时对象 / 租约句柄 / 编辑器文档的命名类型标识符，也不得出现内部 subpath
 * 字面量。Lease 代理方法的返回类型因此以「结构性复制型」公开 alias 表达（设计 §3.2
 * 的 NamespaceRuntimeStatusProjection 为显式结构复制；其余 capability alias 由本包
 * 依赖的目标包公开类型名组合而成——其形状与 Runtime 对应成员逐字段相等，由 lease.ts
 * 的类型级 Equal 断言在编译期锁死）。运行时命名类型只出现在 testing.ts
 * （受控 testing subpath 的 declaration 内部 import，设计 §8.2）与不可达模块。
 *
 * 稳定 message 单一真相源（双轴终审 Duplicated Code 收口）：每个公开 issue/error 的
 * 稳定 message 文本只在下方 const 定义一次；类型面（typeof 字面量推导）与值面
 * （registry.ts / lease.ts / identity.ts / errors.ts 引用）均由本处单点驱动。
 * const 声明字符串自动收窄为字面量类型，无需 as const。
 */
import type { ReadLogicalValueResult } from '@nomicore/doc-runtime';
import type {
  ActiveSchemaInfo,
  MutateRootResult,
  ReplaceSchemaInput,
  ReplaceSchemaResult,
  RuntimeReadDisabledResult,
} from '@nomicore/namespace-runtime';
import type { SchemaEnvelope } from '@nomicore/vfsl';
import type { RegistryObserver } from './observer.js';

// —— 稳定 message 冻结常量（单一真相源；全部为设计 §3.1 冻结文本，零插值）——
export const NAMESPACE_NOT_FOUND_MESSAGE = 'NAMESPACE_NOT_FOUND: namespace 不存在';
export const NAMESPACE_INVALID_IDENTITY_MESSAGE =
  'NAMESPACE_INVALID_IDENTITY: owner.userId 或 namespaceId 不符合安全文法';
export const NAMESPACE_LOAD_FAILED_MESSAGE =
  'NAMESPACE_LOAD_FAILED: namespace 持久化读取发生运营故障';
export const REGISTRY_NOT_ACCEPTING_MESSAGE =
  'REGISTRY_NOT_ACCEPTING: Registry 当前不接纳 namespace 操作';
export const NAMESPACE_LEASE_RELEASED_MESSAGE =
  'NAMESPACE_LEASE_RELEASED: 此 NamespaceLease 已 release，不能再接纳业务操作';
export const NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE =
  'NAMESPACE_OPERATION_UNAVAILABLE: 此 Registry 切片尚未实现该操作';

/** Host 无关的命名空间归属标识：owner 是 Persistence partition key，非当前调用人。 */
export interface NamespaceOwner {
  readonly userId: string;
}

/** Registry 内部故障阶段词表（§3.3；#110 只用 runtime-construction / lifecycle-slot-internal）。 */
export type NamespaceRegistryFatalPhase =
  | 'runtime-construction'
  | 'create-document-internal'
  | 'lifecycle-slot-internal';

/** Registry 生命周期投影（#112 shutdown 前恒 running；本票 getStatus 恒 running）。 */
export type NamespaceRegistryStatus =
  | Readonly<{ state: 'running' }>
  | Readonly<{ state: 'shutting-down' }>
  | Readonly<{ state: 'stopped' }>;

/**
 * Runtime getStatus() 返回值的结构性复制型公开 alias（设计 §3.1）：不 re-export
 * 运行时命名类型；与 runtime 包的状态形态逐字段同构（lease.ts 有编译期 Equal 断言）。
 */
export interface NamespaceRuntimeStatusProjection {
  readonly lifecycle: 'ready' | 'closing' | 'closed';
  readonly read: { readonly enabled: boolean };
  readonly rootWrite: { readonly enabled: boolean };
  readonly schemaWrite: { readonly enabled: boolean };
  readonly schema: {
    readonly state: 'preparing' | 'ready' | 'unavailable';
    readonly issue?: Readonly<{ code: string; message: string }>;
  };
  readonly fatal: Readonly<{ code: string; message: string }> | null;
  readonly close: Readonly<{ code: string; message: string }> | null;
}

/** Lease 状态：active 期向 Runtime 实时委托；released 期仅 status 可观察（runtime: null）。 */
export type NamespaceLeaseStatus =
  | Readonly<{ lease: 'active'; runtime: NamespaceRuntimeStatusProjection }>
  | Readonly<{ lease: 'released'; runtime: null }>;

/** 唯一 released 后的业务能力失败形状；message 为常量（零 identity/schema/input 回显）。 */
export interface NamespaceLeaseReleasedIssue {
  readonly ok: false;
  readonly code: 'NAMESPACE_LEASE_RELEASED';
  readonly message: typeof NAMESPACE_LEASE_RELEASED_MESSAGE;
}

/** open 的公开窄结果（设计 §3.1）。message 全部为不可插值常量。 */
export type OpenNamespaceIssue =
  | Readonly<{
      ok: false;
      code: 'NAMESPACE_NOT_FOUND';
      message: typeof NAMESPACE_NOT_FOUND_MESSAGE;
    }>
  | Readonly<{
      ok: false;
      code: 'NAMESPACE_INVALID_IDENTITY';
      field: 'owner.userId' | 'namespaceId';
      message: typeof NAMESPACE_INVALID_IDENTITY_MESSAGE;
    }>
  | Readonly<{
      ok: false;
      code: 'NAMESPACE_LOAD_FAILED';
      message: typeof NAMESPACE_LOAD_FAILED_MESSAGE;
    }>
  | Readonly<{
      ok: false;
      code: 'REGISTRY_NOT_ACCEPTING';
      message: typeof REGISTRY_NOT_ACCEPTING_MESSAGE;
    }>;

/** open 结果联合：成功仅携带独立 lease，绝不返回裸运行时对象、租约句柄或 live 文档引用。 */
export type OpenNamespaceResult =
  | Readonly<{ ok: true; lease: NamespaceLease }>
  | OpenNamespaceIssue;

/** #111/#112 扩展位的非 fatal 占位结果（设计 §11 裁决 1）。 */
export interface RegistryOperationUnavailableIssue {
  readonly ok: false;
  readonly code: 'NAMESPACE_OPERATION_UNAVAILABLE';
  readonly operation: 'create' | 'shutdown';
  readonly message: typeof NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE;
}

// —— Lease 代理能力的公开 alias（§3.2）：结构性表达 Runtime 能力，不转导 Runtime 名称 ——

/** lease.read 结果 = runtime read 正常联合 | released issue。 */
export type NamespaceLeaseReadResult =
  | ReadLogicalValueResult
  | RuntimeReadDisabledResult
  | NamespaceLeaseReleasedIssue;

/** lease.getSchemaEnvelope 结果（runtime 同签名：载体缺席 → null）。 */
export type NamespaceLeaseSchemaEnvelope = SchemaEnvelope | null;

/** lease.getMetadata 结果（runtime 同签名：META 全键深拷贝）。 */
export type NamespaceLeaseMetadata = Record<string, unknown>;

/** lease.getActiveSchema 结果（runtime 同签名：preparing/unavailable/fatal 期 null）。 */
export type NamespaceLeaseActiveSchema = ActiveSchemaInfo | null;

/** lease.mutateRoot 结果 = runtime 同名结果 | released issue（Promise resolve，不 reject）。 */
export type NamespaceLeaseMutateRootResult = MutateRootResult | NamespaceLeaseReleasedIssue;

/** lease.replaceSchema 输入（与 runtime 同名类型逐字段一致）。 */
export type NamespaceLeaseReplaceSchemaInput = ReplaceSchemaInput;

/** lease.replaceSchema 结果 = runtime 同名结果 | released issue（Promise resolve，不 reject）。 */
export type NamespaceLeaseReplaceSchemaResult = ReplaceSchemaResult | NamespaceLeaseReleasedIssue;

/**
 * asyncDispose 键（ES2023 显式资源管理）。lib ES2022 未声明 Symbol.asyncDispose，
 * 故经全局接口合并补上其 unique symbol 类型（与 lib esnext.disposable 同款声明），
 * 再用单一 module 级实例保证接口与对象字面量键一致：`await using lease` 在运行期
 * 按 `Symbol.asyncDispose` 查找本键并 dispose。
 */
declare global {
  interface SymbolConstructor {
    readonly asyncDispose: unique symbol;
  }
}

export const ASYNC_DISPOSE: typeof Symbol.asyncDispose = Symbol.asyncDispose;

/**
 * NamespaceLease —— 不暴露裸运行时对象、租约句柄或 live 编辑器文档引用的独占能力面
 * （设计 §3.2/§7）。除 close 外代理全部 Runtime 能力；release 同步失效、幂等、
 * exact same Promise；released 后仅 getStatus 成功，其余按 §7 表格走各自通道。
 */
export interface NamespaceLease {
  /** 冻结的独立 owner 投影（仅 userId）。 */
  readonly owner: Readonly<{ readonly userId: string }>;
  readonly namespaceId: string;
  read(path: readonly (string | number)[]): NamespaceLeaseReadResult;
  getSchemaEnvelope(): NamespaceLeaseSchemaEnvelope;
  getMetadata(): NamespaceLeaseMetadata;
  getActiveSchema(): NamespaceLeaseActiveSchema;
  getStatus(): NamespaceLeaseStatus;
  mutateRoot(mutation: unknown): Promise<NamespaceLeaseMutateRootResult>;
  replaceSchema(input: NamespaceLeaseReplaceSchemaInput): Promise<NamespaceLeaseReplaceSchemaResult>;
  release(): Promise<void>;
  readonly [ASYNC_DISPOSE]: () => Promise<void>;
}

/** Host 无关 Registry 主接口（设计 §3.2）：open 主链 + create/shutdown 扩展位。 */
export interface NamespaceRegistry {
  /** 校验身份后取得或建立同 key 唯一 Runtime，并签发独立 lease；不等 P0。 */
  open(owner: NamespaceOwner, namespaceId: string): Promise<OpenNamespaceResult>;
  /** #111 扩展位；本票 resolve 非 fatal NAMESPACE_OPERATION_UNAVAILABLE(create)，不访问 input/Persistence。 */
  create(input: unknown): Promise<RegistryOperationUnavailableIssue>;
  /** 同步 Registry 生命周期投影；本票构造后恒 running（shutdown 未实现）。 */
  getStatus(): NamespaceRegistryStatus;
  /** #112 扩展位；本票 resolve 非 fatal NAMESPACE_OPERATION_UNAVAILABLE(shutdown)，不改变 acceptance。 */
  shutdown(): Promise<RegistryOperationUnavailableIssue>;
}

/**
 * 生产工厂选项（设计 §8.1）：仅内部 observer seam 允许经构造 options 注入；
 * observer throw 由 Registry 隔离，不得改变公开结果。
 */
export interface CreateNamespaceRegistryOptions {
  readonly observer?: RegistryObserver;
}
