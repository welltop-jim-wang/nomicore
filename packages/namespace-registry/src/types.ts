/**
 * @nomicore/namespace-registry —— 冻结公共类型与临时扩展位语义
 * （issue #110 设计 §3；issue #111 设计 §2.1/§3；issue #112 设计 §2.A/§2.H；
 * ADR-0009 的 Registry/Lease 公共面）。
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
 * （registry.ts / lease.ts / identity.ts / errors.ts / plugin.ts 引用）均由本处单点驱动。
 * const 声明字符串自动收窄为字面量类型，无需 as const。
 *
 * #111 增量（冻结设计 §3）：CreateNamespaceInput / CreateNamespaceIssue /
 * CreateNamespaceResult 与五条 create message 常量；Clock 必需化进入
 * CreateNamespaceRegistryOptions（§2.1/§8：生产工厂构造期形状门禁，禁 Date.now
 * fallback）。
 *
 * #112 增量（冻结设计 §2.A/§2.H）：RegistryTimeoutScheduler 能力抽象（Host 无关
 * 延迟调度注入缝，对齐 PersistenceScheduler 先例的 property-signature 形态，不共享
 * persistence 的类型——语义边界分离）；scheduler 必需 + idleTimeoutMs 可选进入
 * 工厂选项；shutdown() 占位签名删除（§2.H：Promise<void>，reject
 * NamespaceRegistryShutdownError）；RegistryOperationUnavailableIssue 与
 * NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE 删除（shutdown 真实化后零消费者）；
 * 五条新校验/聚合 message 常量（§2.A scheduler/idleTimeoutMs 二分 + §2.F 插件配置
 * 键集 + §2.H shutdown 聚合）。
 */
import type { Clock } from '@nomicore/clock';
import type { ReadLogicalValueResult } from '@nomicore/doc-runtime';
import type {
  ActiveSchemaInfo,
  BumpReplicationEpochResult,
  EnableReplicationResult,
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
export const NAMESPACE_CREATE_INVALID_INPUT_MESSAGE =
  'NAMESPACE_CREATE_INVALID_INPUT: create 输入必须恰含 owner、schema 与 root';
export const NAMESPACE_SCHEMA_INVALID_MESSAGE =
  'NAMESPACE_SCHEMA_INVALID: namespace schema 编译失败';
export const NAMESPACE_ROOT_INVALID_MESSAGE =
  'NAMESPACE_ROOT_INVALID: namespace ROOT 不符合 schema 或无法构造';
export const NAMESPACE_ALREADY_EXISTS_MESSAGE =
  'NAMESPACE_ALREADY_EXISTS: namespace 已存在，不能重复创建';
export const NAMESPACE_CREATE_FAILED_MESSAGE =
  'NAMESPACE_CREATE_FAILED: namespace 持久化创建发生运营故障';
// —— #112 增量（§2.A/§2.F/§2.H 冻结文本，零插值、零值回显）——
export const NAMESPACE_REGISTRY_SCHEDULER_REQUIRED_MESSAGE =
  'NAMESPACE_REGISTRY_SCHEDULER_REQUIRED: Registry 必须提供可调用的 setTimeout/clearTimeout 调度能力';
export const NAMESPACE_REGISTRY_IDLE_TIMEOUT_TYPE_MESSAGE =
  'NAMESPACE_REGISTRY_IDLE_TIMEOUT_TYPE: idleTimeoutMs 必须是 number（0..2147483647 有限整数）';
export const NAMESPACE_REGISTRY_IDLE_TIMEOUT_RANGE_MESSAGE =
  'NAMESPACE_REGISTRY_IDLE_TIMEOUT_RANGE: idleTimeoutMs 必须是 0..2147483647 的有限整数';
export const NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE =
  'NAMESPACE_REGISTRY_PLUGIN_CONFIG: namespace-registry 插件配置仅接受 idleTimeoutMs 键';
export const NAMESPACE_REGISTRY_SHUTDOWN_FAILED_MESSAGE =
  'NAMESPACE_REGISTRY_SHUTDOWN_FAILED: Registry shutdown 期间部分 Runtime 关闭失败';
// —— phase-5 切片 1 增量（ADR 0010 身份条款/ADR 0009 依赖纪律）——
export const NAMESPACE_REGISTRY_RANDOM_REQUIRED_MESSAGE =
  'NAMESPACE_REGISTRY_RANDOM_REQUIRED: Registry 必须提供受控随机源 randomBytes(length): Uint8Array';
// —— phase-5 复制谱系切片增量（issue #132；ADR 0010 复制谱系节/ADR 0009 依赖纪律）——
export const REPLICATION_RANDOM_SOURCE_INVALID_MESSAGE =
  'REPLICATION_RANDOM_SOURCE_INVALID: 受控随机源必须返回 16 字节 Uint8Array（ADR 0009 依赖纪律）——本调用零写入、零随机消耗副作用';

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

/** Registry 内部故障阶段词表（§3.3；#110 只用 runtime-construction / lifecycle-slot-internal）。
 * phase-5 切片 1（ADR 0010）：追加 `namespace-id-generation`——普通 create 的 ID 生成阶段
 * （随机源 throw / 形状违约 / 重试预算耗尽）的三类终局（ADR 0009 开放清单新注册）。 */
export type NamespaceRegistryFatalPhase =
  | 'runtime-construction'
  | 'create-document-internal'
  | 'lifecycle-slot-internal'
  | 'namespace-id-generation';

/** Registry 生命周期投影（#112 §2.E）：恒三相（running/shutting-down/stopped）。 */
export type NamespaceRegistryStatus =
  | Readonly<{ state: 'running' }>
  | Readonly<{ state: 'shutting-down' }>
  | Readonly<{ state: 'stopped' }>;

/**
 * Runtime getStatus() 返回值的结构性复制型公开 alias（设计 §3.1）：不 re-export
 * 运行时命名类型；与 runtime 包的状态形态逐字段同构（lease.ts 有编译期 Equal 断言）。
 * issue #132 增量：+replication 复制域（与 runtime 包 NamespaceRuntimeReplicationStatus
 * 逐字段相等——由 NamespaceLeaseReplicationStatus 结构复制型 + lease.ts Equal 断言锁死）。
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
  readonly replication: NamespaceLeaseReplicationStatus;
}

/**
 * Lease status 复制域的结构复制型（§3.2 纪律：不 re-export 运行时命名类型；形状与
 * runtime 包 NamespaceRuntimeReplicationStatus 逐字段相等，由 lease.ts Equal 断言锁死）。
 * 两态联合（无 'unknown' 第三态——AC-5 判别面 = 两次读取的值比较）。
 */
export type NamespaceLeaseReplicationStatus =
  | Readonly<{ state: 'disabled' }>
  | Readonly<{ state: 'enabled'; replicationId: string; replicationEpoch: number }>;

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

/**
 * Registry 延迟调度能力抽象（#112 设计 §2.A，裁决 A）：Host 无关注入缝——Registry
 * 核心禁任何系统 timer 裸调用（ADR-0009 禁 fallback），空闲保留的延迟 close 全部经
 * 本缝调度。property-signature 形态对齐 PersistenceScheduler 先例，但**不共享
 * persistence 的类型**（语义边界分离）；handle 以 `unknown` 表达（决定权在调度器）。
 */
export interface RegistryTimeoutScheduler {
  /** 调度 `callback` 在 `delayMs` 之后执行；返回可取消句柄（幂等）。 */
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  /** 取消句柄；幂等（触发后调用是无害清理）。 */
  readonly clearTimeout: (handle: unknown) => void;
}

// —— #111 create 公共面（设计 §3 冻结类型；§14 签名替换契约）——

/**
 * create 输入（#111 设计 §3；phase-5 切片 1 修正：恒三键，ADR 0010「普通 create 不
 * 再接受调用方 namespaceId」）：owner 由接纳段读取冻结（§4 DQ-1：排队期间改写不影响
 * identity/Persistence），schema/root 在槽内做一次 cycle-safe plain-data 深快照 +
 * 深冻结（§4 第 4 步）。namespaceId 由注入的受控 128-bit CSPRNG 生成（`ns-`+32 小写
 * hex）；调用方携带 namespaceId 键 → NAMESPACE_CREATE_INVALID_INPUT（接纳段拒绝）。
 * ROOT 是完整 logical snapshot；调用方不得携带 META/createdAt，且不得省略 root。
 */
export interface CreateNamespaceInput {
  readonly owner: NamespaceOwner;
  readonly schema: unknown;
  readonly root: unknown;
}

/**
 * Registry 受控随机源 capability（phase-5 切片 1；ADR 0009 依赖纪律 + ADR 0010 身份条款）。
 * 契约：实现必须是密码学安全随机（CSPRNG）；每次调用返回**新鲜、无偏、恰 length 字节**的
 * Uint8Array；不得是可 fallback 的全局 crypto 直调。缺失/非函数 → 构造期同步 TypeError，
 * 绝不 fallback（禁 Math.random / crypto.getRandomValues 缺省）。
 */
export interface RegistryRandomBytes {
  (length: number): Uint8Array;
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

/** lease.enableReplication 结果 = runtime 同名结果 | released issue（沿
 *  NamespaceLeaseMutateRootResult 先例——Promise resolve，不 reject；随机源违约与
 *  领域拒绝均经结果联合结算，写管线 internal fatal 经 RuntimeWriteFatalError rejection）。 */
export type NamespaceLeaseEnableReplicationResult = EnableReplicationResult | NamespaceLeaseReleasedIssue;

/** lease.bumpReplicationEpoch 结果 = runtime 同名结果 | released issue（同上）。 */
export type NamespaceLeaseBumpReplicationEpochResult =
  BumpReplicationEpochResult | NamespaceLeaseReleasedIssue;

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
  /** Hub 显式复制管理操作（issue #132/ADR 0010 冻结名）：原子安装随机 128-bit 复制谱系
   *  + epoch 1（经 runtime 同一 write sequencer——单槽单事务原子、dirty 恰一次）。
   *  已启用命名空间 → 幂等 ok:true（零写入、零 dirty、身份/epoch 不变——稳定文档化
   *  结果）。拒绝（ok:false, issues）经结果联合结算：REPLICATION_RANDOM_SOURCE_INVALID
   *  （受控随机源违约）/ REPLICATION_INPUT_INVALID / REPLICATION_META_ABSENT /
   *  RUNTIME_WRITE_DISABLED 系；写管线 internal fatal 经 RuntimeWriteFatalError
   *  rejection。released → released issue（与两写同通道）。 */
  enableReplication(): Promise<NamespaceLeaseEnableReplicationResult>;
  /** Hub 显式提升权威代际（issue #132/ADR 0010 冻结名；身份不变——复制谱系不可变）。
   *  overflow（epoch = Number.MAX_SAFE_INTEGER）→ ok:false 结果面拒绝、绝不回绕；
   *  未启用 → REPLICATION_NOT_ENABLED；fatal/degraded/close → RUNTIME_WRITE_DISABLED
   *  零写入；released → released issue。 */
  bumpReplicationEpoch(): Promise<NamespaceLeaseBumpReplicationEpochResult>;
  release(): Promise<void>;
  readonly [ASYNC_DISPOSE]: () => Promise<void>;
}

/**
 * Host 无关 Registry 主接口（设计 §3.2）：open + create 双主链 + shutdown 三相状态机。
 *
 * create 契约（§5 伪码；phase-5 切片 1 按 ADR 0010 修订）：运行时按 §4 DQ-1 最小
 * identity 接纳（owner-only——namespaceId 由注入受控 CSPRNG 生成，调用方携带
 * namespaceId 键即拒）→ 生成编排循环（entry 碰撞/DOC_DUPLICATE → 换 ID 重试，至多
 * 8 次；耗尽 → committed:false fatal）→ 候选经 carrier FIFO 入 attempt slot → 槽内
 * payload 快照 → 必需的 Clock 单次读数 → 私有 create-document（prepare + build）
 * → Persistence createDoc → 普通 P0 Runtime factory。拒绝分三通道：resolve 领域窄
 * issue（身份/输入形状/schema/root/持久化运营故障/不接纳）、reject branded
 * NamespaceRegistryFatalError（internal/clock/create-document/persistence-fatal/
 * post-commit runtime-construction/namespace-id-generation，committed 事实诚实）、
 * 构造期同步 TypeError（Clock/scheduler/randomBytes 形状门禁——ADR 0009 依赖纪律）。
 *
 * #112 增量（设计 §2.D/§2.E/§2.H）：shutdown 真实化——三次调用态机
 * （running → shutting-down → stopped）、停接纳于公共入口同步段、聚合关闭全部
 * Runtime；失败以 `NamespaceRegistryShutdownError` reject（failures 稳定聚合）。
 */
export interface NamespaceRegistry {
  /** 校验身份后取得或建立同 key 唯一 Runtime，并签发独立 lease；不等 P0。 */
  open(owner: NamespaceOwner, namespaceId: string): Promise<OpenNamespaceResult>;
  /**
   * #111 排他 create 主链（§3/§14 typed 签名；phase-5 切片 1 修正：恒三键输入——
   * namespaceId 由注入受控 CSPRNG 生成，调用方携带 namespaceId 键即拒），同
   * key 排他（绝不 create-as-open），成功签发独立 lease（普通 P0 Runtime，不等 P0
   * 结算）。实现层签名以 unknown 表达（对齐 open 的「公共 typed / 实现 unknown」双层
   * 先例——接纳段校验一切敌意/畸形输入是运行时契约，静态类型是调用方命名形状）。
   */
  create(input: CreateNamespaceInput): Promise<CreateNamespaceResult>;
  /** 同步 Registry 生命周期投影：恒三相（running/shutting-down/stopped）、恒冻结常量。 */
  getStatus(): NamespaceRegistryStatus;
  /**
   * Host shutdown（设计 §2.D）：首次调用的同步段即停接纳并取消全部 idle timer；
   * 随后等待已接纳的 open/create 槽完整结算、关闭全部 Runtime（复用已在途 close
   * Promise）、聚合 close 失败。关闭失败非空时以 `NamespaceRegistryShutdownError`
   * reject（failures 稳定聚合、状态仍到 stopped）；否则 resolve undefined。
   * 幂等：并发/重复调用返回 exact same Promise（含已 reject 实例）。
   */
  shutdown(): Promise<void>;
}

/**
 * shutdown 聚合失败项（设计 §2.H）：结构化携带受控 identity + exact cause——宿主
 * 运维必需定位面；message 恒定零回显纪律不约束结构化字段与 cause（与
 * NamespaceRegistryFatalError.cause 同款先例）。
 */
export interface NamespaceRegistryShutdownFailure {
  readonly owner: Readonly<{ readonly userId: string }>;
  readonly namespaceId: string;
  readonly cause: unknown;
}

/**
 * 生产工厂选项（设计 §2.1/§8；#112 §2.A）：`clock` 为必需 capability（ADR-0009 禁静默
 * 系统时钟；缺失/null/非 object/now 非函数 → 构造期同步 TypeError
 * `NAMESPACE_REGISTRY_CLOCK_REQUIRED: Registry 必须提供可调用的 Clock.now`，
 * message 固定、零回显传入值；绝无 Date.now() fallback）。`scheduler` 为**必需**
 * 延迟调度 capability（#112 裁决 A：ADR-0009 禁系统 timer fallback——release 即武装
 * idle timer，缺省会静默掩盖 idle 行为；缺失/null/非 object/setTimeout 或 clearTimeout
 * 非函数 → 构造期同步 TypeError，message 恒
 * `NAMESPACE_REGISTRY_SCHEDULER_REQUIRED: …`，零回显传入值；检查顺序在 clock 门禁
 * 之后）。`idleTimeoutMs` 可选（缺省 `DEFAULT_IDLE_TIMEOUT_MS = 300_000`；校验单点
 * resolveIdleTimeoutMs，registry.ts 模块级导出）。仅内部 observer seam 允许经构造
 * options 注入；observer throw 由 Registry 隔离，不得改变公开结果。
 */
export interface CreateNamespaceRegistryOptions {
  readonly clock: Clock;
  readonly scheduler: RegistryTimeoutScheduler;
  /** 受控随机源（phase-5 切片 1，ADR 0010）：普通 create 的 namespaceId 生成源；
   * **必需**——缺失/非函数 → 构造期同步 TypeError（禁全局 crypto fallback，ADR 0009）。
   * 契约细节见 RegistryRandomBytes。 */
  readonly randomBytes: RegistryRandomBytes;
  readonly idleTimeoutMs?: number;
  readonly observer?: RegistryObserver;
}
