/**
 * @nomicore/namespace-registry —— 冻结公共类型与临时扩展位语义
 * （issue #110 设计 §3；issue #111 设计 §2.1/§3；ADR-0009 的 Registry/Lease 公共面）。
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
 *
 * #111 增量（冻结设计 §3）：CreateNamespaceInput / CreateNamespaceIssue /
 * CreateNamespaceResult 与五条 create message 常量；Clock 必需化进入
 * CreateNamespaceRegistryOptions（§2.1/§8：生产工厂构造期形状门禁，禁 Date.now
 * fallback）；RegistryOperationUnavailableIssue.operation 收窄为 'shutdown'
 * （create 不再是占位 unavailable——见 registry.ts §5 真实 create slot）。
 */
import type { Clock } from '@nomicore/clock';
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
export const NAMESPACE_CREATE_INVALID_INPUT_MESSAGE =
  'NAMESPACE_CREATE_INVALID_INPUT: create 输入必须恰含 owner、namespaceId、schema 与 root';
export const NAMESPACE_SCHEMA_INVALID_MESSAGE =
  'NAMESPACE_SCHEMA_INVALID: namespace schema 编译失败';
export const NAMESPACE_ROOT_INVALID_MESSAGE =
  'NAMESPACE_ROOT_INVALID: namespace ROOT 不符合 schema 或无法构造';
export const NAMESPACE_ALREADY_EXISTS_MESSAGE =
  'NAMESPACE_ALREADY_EXISTS: namespace 已存在，不能重复创建';
export const NAMESPACE_CREATE_FAILED_MESSAGE =
  'NAMESPACE_CREATE_FAILED: namespace 持久化创建发生运营故障';

/** Host 无关的命名空间归属标识：owner 是 Persistence partition key，非当前调用人。 */
export interface NamespaceOwner {
  readonly userId: string;
}

/** 无效身份窄 issue（open/create 共用；message 恒定、零回显字段值）。 */
export interface InvalidIdentityIssue {
  readonly ok: false;
  readonly code: 'NAMESPACE_INVALID_IDENTITY';
  readonly field: 'owner.userId' | 'namespaceId';
  readonly message: typeof NAMESPACE_INVALID_IDENTITY_MESSAGE;
}

/** Registry 不接纳窄 issue（open/create 共用；#112 shutdown 前本切片恒 running）。 */
export interface RegistryNotAcceptingIssue {
  readonly ok: false;
  readonly code: 'REGISTRY_NOT_ACCEPTING';
  readonly message: typeof REGISTRY_NOT_ACCEPTING_MESSAGE;
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
  | InvalidIdentityIssue
  | Readonly<{
      ok: false;
      code: 'NAMESPACE_LOAD_FAILED';
      message: typeof NAMESPACE_LOAD_FAILED_MESSAGE;
    }>
  | RegistryNotAcceptingIssue;

/** open 结果联合：成功仅携带独立 lease，绝不返回裸运行时对象、租约句柄或 live 文档引用。 */
export type OpenNamespaceResult =
  | Readonly<{ ok: true; lease: NamespaceLease }>
  | OpenNamespaceIssue;

/** #112 扩展位的非 fatal 占位结果（设计 §11 裁决 1；#111 后 create 不再是占位）。 */
export interface RegistryOperationUnavailableIssue {
  readonly ok: false;
  readonly code: 'NAMESPACE_OPERATION_UNAVAILABLE';
  readonly operation: 'shutdown';
  readonly message: typeof NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE;
}

// —— #111 create 公共面（设计 §3 冻结类型；§14 签名替换契约）——

/**
 * create 输入（设计 §3）：恒四键——owner/namespaceId 由接纳段读取冻结（§4 DQ-1：
 * 排队期间改写不影响 identity/Persistence），schema/root 在槽内做一次 cycle-safe
 * plain-data 深快照 + 深冻结（§4 第 4 步）。ROOT 是完整 logical snapshot；
 * 调用方不得携带 META/createdAt，且不得省略 root。
 */
export interface CreateNamespaceInput {
  readonly owner: NamespaceOwner;
  readonly namespaceId: string;
  readonly schema: unknown;
  readonly root: unknown;
}

/**
 * create 公开窄结果（设计 §3，DQ-4 裁决）：`NAMESPACE_SCHEMA_INVALID` /
 * `NAMESPACE_ROOT_INVALID` 内嵌完整底层 issues（verbatim 原对象
 * message/path/数量/顺序，不深克隆、不改写、不 sanitize——ADR-0009:87 与既有
 * lease 写路径一致；顶层 message 恒为下方常量，identity/输入/cause 零回显仅约束
 * Registry 自创面，不约束内嵌底层诊断）。
 */
export type CreateNamespaceIssue =
  | InvalidIdentityIssue
  | Readonly<{
      ok: false;
      code: 'NAMESPACE_CREATE_INVALID_INPUT';
      message: typeof NAMESPACE_CREATE_INVALID_INPUT_MESSAGE;
    }>
  | Readonly<{
      ok: false;
      code: 'NAMESPACE_SCHEMA_INVALID';
      issues: readonly unknown[];
      message: typeof NAMESPACE_SCHEMA_INVALID_MESSAGE;
    }>
  | Readonly<{
      ok: false;
      code: 'NAMESPACE_ROOT_INVALID';
      issues: readonly unknown[];
      message: typeof NAMESPACE_ROOT_INVALID_MESSAGE;
    }>
  | Readonly<{
      ok: false;
      code: 'NAMESPACE_ALREADY_EXISTS';
      message: typeof NAMESPACE_ALREADY_EXISTS_MESSAGE;
    }>
  | Readonly<{
      ok: false;
      code: 'NAMESPACE_CREATE_FAILED';
      message: typeof NAMESPACE_CREATE_FAILED_MESSAGE;
    }>
  | RegistryNotAcceptingIssue;

/** create 结果联合（设计 §3）：成功仅携带独立 lease；或排他 create 的领域窄 issue。
 * 内部故障经 branded `NamespaceRegistryFatalError` reject（绝不 resolve 伪装）。 */
export type CreateNamespaceResult =
  | Readonly<{ ok: true; lease: NamespaceLease }>
  | CreateNamespaceIssue;

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

/**
 * Host 无关 Registry 主接口（设计 §3.2）：open + create 双主链，shutdown/#112 扩展位。
 *
 * create 契约（§5 伪码）：运行时按 §4 DQ-1 最小 identity 接纳 → 同 key 与 open 共用
 * #110 carrier FIFO → 槽内 payload 快照 → 必需的 Clock 单次读数 → 私有 create-document
 * → Persistence createDoc → 普通 P0 Runtime factory。拒绝分三通道：resolve 领域窄
 * issue（含 duplicate 四源同码 ALREADY_EXISTS）、reject branded
 * NamespaceRegistryFatalError（internal/clock/create-document/persistence-fatal/
 * post-commit runtime-construction，committed 事实诚实）、构造期同步 TypeError
 * （Clock 形状门禁）。
 */
export interface NamespaceRegistry {
  /** 校验身份后取得或建立同 key 唯一 Runtime，并签发独立 lease；不等 P0。 */
  open(owner: NamespaceOwner, namespaceId: string): Promise<OpenNamespaceResult>;
  /**
   * #111 排他 create 主链（§3/§14 typed 签名）：恒四键输入（§4 DQ-1 最小接纳是运行时
   * 唯一形状验收点——顶层非 object / identity 缺陷 / payload 变体 → 窄 issue），同
   * key 排他（绝不 create-as-open），成功签发独立 lease（普通 P0 Runtime，不等 P0
   * 结算）。实现层签名以 unknown 表达（对齐 open 的「公共 typed / 实现 unknown」双层
   * 先例——接纳段校验一切敌意/畸形输入是运行时契约，静态类型是调用方命名形状）。
   */
  create(input: CreateNamespaceInput): Promise<CreateNamespaceResult>;
  /** 同步 Registry 生命周期投影；本票构造后恒 running（shutdown 未实现）。 */
  getStatus(): NamespaceRegistryStatus;
  /** #112 扩展位；本票 resolve 非 fatal NAMESPACE_OPERATION_UNAVAILABLE(shutdown)，不改变 acceptance。 */
  shutdown(): Promise<RegistryOperationUnavailableIssue>;
}

/**
 * 生产工厂选项（设计 §2.1/§8）：`clock` 为必需 capability（ADR-0009 禁静默系统时钟；
 * 缺失/null/非 object/now 非函数 → 构造期同步 TypeError
 * `NAMESPACE_REGISTRY_CLOCK_REQUIRED: Registry 必须提供可调用的 Clock.now`，
 * message 固定、零回显传入值；绝无 Date.now() fallback）。仅内部 observer seam
 * 允许经构造 options 注入；observer throw 由 Registry 隔离，不得改变公开结果。
 */
export interface CreateNamespaceRegistryOptions {
  readonly clock: Clock;
  readonly observer?: RegistryObserver;
}
