/**
 * @nomicore/namespace-registry —— Host 无关 Registry 核心（issue #110 设计 §5/§6；
 * issue #111 设计 §5；issue #112 设计 §2.A-§2.E）。
 *
 * 模型：
 * - entries: Map<key, Entry> 只保存 live Runtime；carriers: Map<key, LifecycleCarrier>
 *   只保存同 key 尚有 lifecycle queue 的排队器——两 map 分离，因此 not-found /
 *   load-failed / fatal 不会制造 Entry，且必须在最后 slot 后回收 carrier。
 * - 每 key slot 在同步 run-to-completion 中接纳（§5）：operation 链在旧绿尾上，
 *   carrier.tail 更新为该 operation 的 catch 化绿尾；operationGreenTail settle 后
 *   排入 cleanup microtask，仅当 (1) entries.has(key)===false、(2) carriers.get(key)
 *   === capturedCarrier、(3) capturedCarrier.tail === operationGreenTail 才删除
 *   carrier——(2) 是 carrier identity/generation ABA 守卫，(3) 表明没有后来接纳的
 *   同 key slot；任一不成立不删。
 * - entry 删除（close settle）采用 entry identity + generation 双守卫
 *   （removeOnlySelf）：旧 entry completion 绝不按 key 无条件 delete。
 * - runOpenSlot 决策（#112 设计 §2.B 三态伪码）：active entry 直接签新 lease →
 *   idle entry 同步取消 timer 复用（activateEntry）→ closing entry 等待 closePromise
 *   结算后 recheck（复用 / 全新 loadDoc）→ loadDoc（DocLoadOperationalError →
 *   窄 issue + observer；其余 → fatal + observer）→ null → NOT_FOUND → factory
 *   （throw → handle.release() 恰一次 + observer + runtime-construction fatal）→
 *   建 entry、登记、签 lease。acceptance 检查已迁移至公共入口同步段（§2.D）；
 *   已接纳槽按自身事实结算，槽内不再检查。
 * - runCreateSlot 决策（#111 设计 §5 伪码，冻结次序；#112 增 idle 第五态分派）：
 *   active/idle entry → ALREADY_EXISTS（DQ-5 同码零 Persistence）→ closing entry
 *   （closePromise 缺失 → fail-loud fatal create/lifecycle-slot-internal/false +
 *   observer）→ payload 防御性快照（§4 第 3-4 步）→ Clock 单次读数 → 私有
 *   create-document → createDoc → factory → 建 entry、登记、签 lease。
 * - idle 状态机（#112 设计 §2.B）：最后 lease release 的同步段（handleLeaseReleased）
 *   经注入 scheduler 武装 idle timer（完整 idleTimeoutMs，AC4 重置语义；fatal/
 *   degraded Runtime 零特判）；timer 回调经 I4 arm-token 判别后 beginIdleClose
 *   （close → 移除，失败经 idle-close-failed observer + 代际局部清理）。
 * - shutdown（#112 设计 §2.D/§2.E）：acceptance 三相（running → shutting-down →
 *   stopped；首调同步段翻相 + 取消全部 idle timer），异步段 = 等待已接纳 carrier
 *   结算 → 全量发起 Runtime close（复用在途 closePromise）→ 全量聚合（拒绝以
 *   NamespaceRegistryShutdownError 交付）→ entries.clear + acceptance='stopped'。
 *   getStatus 恒三相冻结常量投影。
 *
 * 导出纪律（设计 §2.2/§8）：主入口只经 index.ts re-export createNamespaceRegistry
 * 与三个公开错误类；本文件另行导出 createRegistryInternal/NamespaceRegistryInternalOptions
 * （仅被 testing.ts 消费，主入口不 re-export；其类型面以 any-bridge 规避主入口可达
 * 声明图中的运行时对象与租约句柄类型名——精确注入面类型见 testing.ts）与
 * DEFAULT_IDLE_TIMEOUT_MS/resolveIdleTimeoutMs（R1/M3 单点化：运行时定义点唯一在
 * registry.ts；plugin.ts 经相对通道 import 后 re-export，index 沿 plugin 链转出）。
 */
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';
import type { NamespaceRuntime } from '@nomicore/namespace-runtime';
import {
  DocCreateFatalError,
  DocCreateOperationalError,
  DocDuplicateError,
  DocLoadOperationalError,
} from '@nomicore/persistence';
import type { DocHandle, DocPersistence } from '@nomicore/persistence';
import type { Clock } from '@nomicore/clock';
import { DocRuntimeFatalError } from '@nomicore/doc-runtime';
import {
  acceptCreateIdentity,
  CREATE_INVALID_INPUT_ISSUE,
  digestKey,
  validateOpenIdentity,
  type InternalIdentity,
} from './identity.js';
import { createLeaseController } from './lease.js';
import { createDocument } from './create-document.js';
import type { CreateDocumentFactory, CreateDocumentGatewayResult } from './create-document.js';
import {
  dispatchDiagnostics,
  dispatchObserver,
  type RegistryDiagnosticsEvent,
  type RegistryDiagnosticsSink,
  type RegistryObserver,
} from './observer.js';
import type {
  CreateNamespaceRegistryOptions,
  CreateNamespaceResult,
  NamespaceLease,
  NamespaceRegistry,
  NamespaceRegistryShutdownFailure,
  NamespaceRegistryStatus,
  OpenNamespaceResult,
  RegistryTimeoutScheduler,
} from './types.js';
import {
  NAMESPACE_ALREADY_EXISTS_MESSAGE,
  NAMESPACE_CREATE_FAILED_MESSAGE,
  NAMESPACE_LOAD_FAILED_MESSAGE,
  NAMESPACE_NOT_FOUND_MESSAGE,
  NAMESPACE_REGISTRY_IDLE_TIMEOUT_RANGE_MESSAGE,
  NAMESPACE_REGISTRY_IDLE_TIMEOUT_TYPE_MESSAGE,
  NAMESPACE_REGISTRY_SCHEDULER_REQUIRED_MESSAGE,
  NAMESPACE_ROOT_INVALID_MESSAGE,
  NAMESPACE_SCHEMA_INVALID_MESSAGE,
  REGISTRY_NOT_ACCEPTING_MESSAGE,
} from './types.js';
import { NamespaceRegistryFatalError, NamespaceRegistryShutdownError } from './errors.js';

// 主入口 re-export 通道（设计 §2.2 精确导出面；errors.js 为不可达声明模块，经本文件转出）。
export { NamespaceLeaseReleasedError, NamespaceRegistryFatalError, NamespaceRegistryShutdownError } from './errors.js';

/**
 * 默认空闲保留时限（#112 设计 §2.A，R1/M3 单点化）：`idleTimeoutMs` 缺省值。
 * 运行时定义点唯一在本文件（与 resolveIdleTimeoutMs 同居）；plugin.ts 经相对通道
 * `./registry.js` import 后 re-export，index.ts 沿 plugin 链转出——零第二定义点。
 * 测试锚：`DEFAULT_IDLE_TIMEOUT_MS === 300_000`（registry-surface/plugin 双侧）。
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

/**
 * idleTimeoutMs 单点校验（#112 设计 §2.A 裁决 A）：生产工厂 / testing seam / 插件
 * config 全部经本函数（plugin.ts 相对导入复用，不经 index 转出）。
 * - `undefined` → DEFAULT_IDLE_TIMEOUT_MS；
 * - 非 number → TypeError `NAMESPACE_REGISTRY_IDLE_TIMEOUT_TYPE: …`；
 * - 非整数 / <0 / >2_147_483_647 → RangeError `NAMESPACE_REGISTRY_IDLE_TIMEOUT_RANGE: …`；
 * 错误类型二分对齐 @nomicore/clock/testing manual.ts 先例（TypeError=形状，
 * RangeError=数值域）；message 恒定、零值回显。
 */
export function resolveIdleTimeoutMs(config: { readonly idleTimeoutMs?: number } | undefined): number {
  if (config === undefined) return DEFAULT_IDLE_TIMEOUT_MS;
  const value = config.idleTimeoutMs;
  if (value === undefined) return DEFAULT_IDLE_TIMEOUT_MS;
  if (typeof value !== 'number') {
    throw new TypeError(NAMESPACE_REGISTRY_IDLE_TIMEOUT_TYPE_MESSAGE);
  }
  if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new RangeError(NAMESPACE_REGISTRY_IDLE_TIMEOUT_RANGE_MESSAGE);
  }
  return value;
}

/** 生产 Runtime 工厂类型（精确形状；仅 testing.ts 注入口与 registry 内部可见）。 */
type RuntimeFactory = (handle: DocHandle, notifyDirty: () => Promise<void>) => NamespaceRuntime;

/**
 * Registry 内部选项（testing.ts 消费；主入口不 re-export）。runtimeFactory/diagnostics
 * 仅受控注入：声明面以 any-bridge 表达（精确类型见 testing.ts 的
 * NamespaceRegistryTestingOverrides），保证主入口可达声明图不出现运行时对象与
 * 租约句柄类型名；diagnostics 类型单点取自 observer.ts（§8.2 受控诊断事件）。
 *
 * #111 增量（§2.1/§8）：`clock` 必需（生产/testing 构造期同步形状门禁；见
 * assertClockShape）；`createDocumentFactory` 为 create-document 构造步的受控注入面；
 * `testEntries` 为 **测试专用** entry 注入面——只被 registry-create.test.ts 的
 * closing fail-closed fixture 经内部 options 使用，**不经 index.ts / testing.ts
 * 公共导出（主入口与 testing 子路径对 `testEntries` 零可达——设计 §8 冻结边界）**，
 * 只允许 registry 包内测试以相对模块通道消费；仅用于将受控 entry 注入 closing
 * 分支（missing closePromise / await reject / await 后仍 closing / resolve 后消失
 * 四变体，SA4 HIGH-1 红灯专用），不得用于读取真实 entries、构造 active Runtime、
 * 生产注入或扩展为公开生命周期 API。形态为设计定稿二选一：`ReadonlyMap` 静态种子
 * （构造期逐项 set）或**种子函数** `(entries: Map<string, any>) => void`（构造期同步
 * 调用，收到 Registry 内部 entries map——供 fixture 以任意注入/移除语义表达
 * generation 迁移，如变体 C 的「close settle 时移除 entry」）。
 */
export interface NamespaceRegistryInternalOptions {
  readonly runtimeFactory?: (handle: any, notifyDirty: () => Promise<void>) => any;
  readonly observer?: RegistryObserver;
  readonly diagnostics?: RegistryDiagnosticsSink;
  /** 必需 Clock（§2.1/§8）：缺失/null/非 object/now 非函数 → 构造期同步 TypeError。 */
  readonly clock: Clock;
  /** create-document 构造步注入（§8 testing seam；缺省 = doc-runtime createInitialDocument）。 */
  readonly createDocumentFactory?: (namespaceId: string, createdAt: string, schema: unknown, root: unknown) => CreateDocumentGatewayResult;
  /** #112 必需延迟调度缝（§2.A）：形状门禁与生产工厂同款（clock 门禁之后检查）。 */
  readonly scheduler: RegistryTimeoutScheduler;
  /** #112 可选 idleTimeoutMs（缺省 DEFAULT_IDLE_TIMEOUT_MS；resolveIdleTimeoutMs 单点校验）。 */
  readonly idleTimeoutMs?: number;
  /** 测试专用 entry 注入面（仅内部 fixture；不进公共导出面）。设计 §8 冻结：Map 静态
   *  种子或种子函数二选一（SA4 HIGH-1 变体 C 的 generation 迁移语义）。 */
  readonly testEntries?: ReadonlyMap<string, any> | ((entries: Map<string, any>) => void);
}

/**
 * entry：同 key 唯一 Runtime 的登记单元（§5；generation 永不复用）。
 *
 * #112 增量（设计 §2.B）：phase 词表扩为 `'active' | 'idle' | 'closing'`；新增
 * `idleTimerHandle`（不变量 I1：acceptance==='running' 期间 `phase==='idle'` ⟺
 * 已武装；shutdown 同步段取消后至关闭发起段翻相前为唯一豁免窗口，见 §2.D）；
 * `closePromise` 不变量 I2（phase==='closing' ⟹ 已定义——先赋值后翻相，同一同步段）。
 * `lifecycleTail` 删除（#110 注释预留 #112 接管，实际 shutdown 经 carrier tails
 * 聚合，无消费者，死代码移除）。
 */
interface Entry {
  readonly key: string;
  readonly generation: bigint;
  readonly owner: Readonly<{ readonly userId: string }>;
  readonly namespaceId: string;
  readonly runtime: NamespaceRuntime;
  phase: 'active' | 'idle' | 'closing';
  readonly leases: Set<NamespaceLease>;
  /** 不变量 I1：phase==='idle' ⟺ 已武装（构造后同一同步段内成立；见上）。 */
  idleTimerHandle: unknown | undefined;
  closePromise?: Promise<void>;
}

/** lifecycle carrier：同 key 串行排队器（§5；generation 永不复用；tail 恒绿）。 */
interface LifecycleCarrier {
  readonly key: string;
  readonly generation: bigint;
  tail: Promise<void>;
}

const NOT_FOUND_ISSUE = Object.freeze({
  ok: false as const,
  code: 'NAMESPACE_NOT_FOUND' as const,
  message: NAMESPACE_NOT_FOUND_MESSAGE,
});

const LOAD_FAILED_ISSUE = Object.freeze({
  ok: false as const,
  code: 'NAMESPACE_LOAD_FAILED' as const,
  message: NAMESPACE_LOAD_FAILED_MESSAGE,
});

const NOT_ACCEPTING_ISSUE = Object.freeze({
  ok: false as const,
  code: 'REGISTRY_NOT_ACCEPTING' as const,
  message: REGISTRY_NOT_ACCEPTING_MESSAGE,
});

// —— #111 create 窄 issue 常量（§3 稳定 message 单点表；顶层恒常量，零插值）——

const ALREADY_EXISTS_ISSUE = Object.freeze({
  ok: false as const,
  code: 'NAMESPACE_ALREADY_EXISTS' as const,
  message: NAMESPACE_ALREADY_EXISTS_MESSAGE,
});

const CREATE_FAILED_ISSUE = Object.freeze({
  ok: false as const,
  code: 'NAMESPACE_CREATE_FAILED' as const,
  message: NAMESPACE_CREATE_FAILED_MESSAGE,
});

/** schema/root 领域失败的 verbatim issue（DQ-4：issues 完整原对象逐字透传、不深克隆；
 * 仅冻结外层对象，数组本体保持底层引用——底层输出即契约）。 */
function schemaInvalidIssue(issues: readonly unknown[]): CreateNamespaceResult {
  return Object.freeze({
    ok: false as const,
    code: 'NAMESPACE_SCHEMA_INVALID' as const,
    issues,
    message: NAMESPACE_SCHEMA_INVALID_MESSAGE,
  });
}

function rootInvalidIssue(issues: readonly unknown[]): CreateNamespaceResult {
  return Object.freeze({
    ok: false as const,
    code: 'NAMESPACE_ROOT_INVALID' as const,
    issues,
    message: NAMESPACE_ROOT_INVALID_MESSAGE,
  });
}

const RUNNING_STATUS: NamespaceRegistryStatus = Object.freeze({ state: 'running' });
const SHUTTING_DOWN_STATUS: NamespaceRegistryStatus = Object.freeze({ state: 'shutting-down' });
const STOPPED_STATUS: NamespaceRegistryStatus = Object.freeze({ state: 'stopped' });

/**
 * 带守卫的 entry 删除（§5 removeOnlySelf）：identity + generation 双守卫防 ABA——
 * 旧 entry completion 绝不按 key 无条件 delete；只删「当前 map 中就是同一个对象引用
 * 且 generation 一致」的 entry。
 *
 * 模块级导出（包内模块通道纪律，参照 namespace-runtime 的包内 seam 先例）：仅供
 * test/ 相对导入直接消费（index.ts / testing.ts 均不 re-export）。签名以 key/generation
 * 最小结构表达（泛型约束），使主入口可达声明图不出现运行时对象类型名；调用方传入的
 * 是完整 Entry（结构性满足约束），运行时检查与删除逻辑逐字节同 §5 伪码。
 */
export function removeOnlySelf<E extends { readonly key: string; readonly generation: bigint }>(
  entries: Map<string, E>,
  entry: E,
): void {
  const current = entries.get(entry.key);
  if (current === entry && current.generation === entry.generation) {
    entries.delete(entry.key);
  }
}

/** 创建 Registry 核心（生产与 testing 共用；observer/diagnostics/factory 注入点）。 */

/**
 * Clock 构造期形状门禁（设计 §8/§6 DQ-3）：生产/testing 工厂均同步执行；
 * clock 缺失、null/non-object 或 `now` 非函数 → 固定 `TypeError`（message 逐字、
 * 零回显传入值），禁任何 `Date.now()` fallback（ADR-0009）。
 */
function assertClockShape(value: unknown): asserts value is Clock {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as { now?: unknown }).now !== 'function'
  ) {
    throw new TypeError('NAMESPACE_REGISTRY_CLOCK_REQUIRED: Registry 必须提供可调用的 Clock.now');
  }
}

/**
 * Scheduler 构造期形状门禁（#112 设计 §2.A 裁决 A）：生产/testing 工厂均同步执行；
 * scheduler 缺失、null/non-object 或 `setTimeout`/`clearTimeout` 任一非函数 →
 * 固定 `TypeError`（message 逐字、零回显传入值），禁任何系统 timer fallback
 * （ADR-0009）。**检查顺序在 clock 门禁之后**（既有构造门禁用例以 `{ clock: {} }`
 * 断言 CLOCK 文案——scheduler 先行会改抛 SCHEDULER 文案，违反既有断言零改动）。
 */
function assertSchedulerShape(value: unknown): asserts value is RegistryTimeoutScheduler {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as { setTimeout?: unknown }).setTimeout !== 'function' ||
    typeof (value as { clearTimeout?: unknown }).clearTimeout !== 'function'
  ) {
    throw new TypeError(NAMESPACE_REGISTRY_SCHEDULER_REQUIRED_MESSAGE);
  }
}

/**
 * 槽内 payload 防御性快照（设计 §4 第 3-4 步，冻结次序）：
 * 3. 顶层读取（descriptor + ownKeys 元操作，Proxy trap throw 一律 catch 为本槽窄
 *    issue）：plain/null-prototype object、own 键集恰四个 {owner,namespaceId,schema,root}、
 *    各为 own data descriptor（拒 accessor）；
 * 4. 仅对 schema/root 做 cycle-safe plain-data 深克隆（数组、plain/null-prototype
 *    object、JSON scalar；拒 function/symbol/bigint/nonfinite/Date/Yjs/循环/共享引用/
 *    descriptor trap），克隆后深冻结。
 * 调用方排队时变更 payload 生效；快照成功后 compile/validate/build 只消费快照
 * （槽内冻结后变更无效）。owner/namespaceId 值在快照内不再读取（接纳段已冻结）。
 */
type PayloadSnapshot = { readonly ok: true; readonly schema: unknown; readonly root: unknown } | { readonly ok: false };

function snapshotCreatePayload(inputRef: unknown): PayloadSnapshot {
  try {
    if (typeof inputRef !== 'object' || inputRef === null) return { ok: false };
    const proto = Object.getPrototypeOf(inputRef);
    if (proto !== Object.prototype && proto !== null) return { ok: false };
    const keys = Reflect.ownKeys(inputRef);
    if (keys.length !== 4) return { ok: false };
    for (const k of keys) {
      if (typeof k !== 'string') return { ok: false };
      if (k !== 'owner' && k !== 'namespaceId' && k !== 'schema' && k !== 'root') return { ok: false };
      const desc = Object.getOwnPropertyDescriptor(inputRef, k);
      if (desc === undefined || !('value' in desc) || desc.get !== undefined || desc.set !== undefined) {
        return { ok: false };
      }
    }
    const record = inputRef as Record<string, unknown>;
    return { ok: true, schema: clonePlainData(record.schema), root: clonePlainData(record.root) };
  } catch {
    return { ok: false };
  }
}

/** cycle-safe plain-data 深克隆（只接受 JSON 域：string/number(有限)/boolean/null/
 *  array/plain-object；symbol 键、accessor、非 plain 原型（Date/Yjs/class）、non-finite、
 *  bigint/function/symbol/undefined、循环与共享引用全部拒绝）；产物深冻结。
 * 数组/对象分支对齐 namespace-runtime write.ts copyFrozen 四查纪律（SA4 MEDIUM-2）：
 * 原型精确守卫 → symbol 键拒绝 → own 名与可枚举键一致性（拒非枚举 own 键）→
 * descriptor 全表扫描**先于任何值读取**（accessor/稀疏空洞拒绝）→ 值读取；
 * 与 copyFrozen 的唯一有意差异 = 本 Registry 按设计 §4 额外拒绝「共享引用」
 * （copyFrozen 仅拒环——Registry 的 payload 快照以 WeakSet 全图去重，防调用方
 * 以别名走私调用方对象身份进冻结快照）。 */
function clonePlainData(value: unknown, seen?: WeakSet<object>): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) throw new Error('non-finite number 属 JSON 域外');
    return value;
  }
  if (t !== 'object') throw new Error(`plain-data 域外值：${t}`);
  const obj = value as object;
  const visited = seen ?? new WeakSet<object>();
  if (visited.has(obj)) throw new Error('循环引用或共享引用');
  visited.add(obj);
  if (Array.isArray(obj)) {
    const arr = obj as unknown[];
    // ① 原型精确守卫：只有 Array.prototype 直系通过（子类实例/null 原型/自定义原型
    //    一律拒绝——数组子类可携带宿主 own 状态，非 plain 数据）
    if (Object.getPrototypeOf(arr) !== Array.prototype) {
      throw new Error('数组原型非 Array.prototype（子类/异构原型）');
    }
    // ② symbol 键不进 Object.keys——缺本查即静默丢弃调用方 own 状态
    if (Object.getOwnPropertySymbols(arr).length > 0) throw new Error('数组携带 symbol 键');
    // ③ getOwnPropertyNames（滤 length）与可枚举键集一致性：非枚举 own 键（含非枚举
    //    下标）在此暴露（防御分支——descriptor 扫描亦兜底）
    const names = Object.getOwnPropertyNames(arr).filter((k) => k !== 'length');
    const enumerable = Object.keys(arr);
    if (
      names.length !== enumerable.length ||
      !names.every((k) => enumerable.includes(k)) ||
      enumerable.length !== arr.length
    ) {
      // 后一条件拒「可枚举非索引 own 键」（arr.foo）与稀疏/长度失真（与 copyFrozen ④ 互补）
      throw new Error('数组 own 键集不齐（非枚举键/稀疏空洞/多余键）');
    }
    // ④ descriptor 全表扫描先于任何值读取：accessor/稀疏空洞/非数据描述符在此拒绝
    //    ——值读取前不执行任何 getter，也不从原型链读值
    for (let i = 0; i < arr.length; i += 1) {
      const desc = Object.getOwnPropertyDescriptor(arr, String(i));
      if (desc === undefined || !('value' in desc) || desc.get !== undefined || desc.set !== undefined) {
        throw new Error('数组槽 accessor/非数据描述符/稀疏空洞');
      }
    }
    // ⑤ 纯数据读取（④ 已证无 accessor/无空洞）
    const out: unknown[] = [];
    for (let i = 0; i < arr.length; i += 1) {
      out.push(clonePlainData(arr[i], visited));
    }
    return Object.freeze(out);
  }
  // —— 对象分支（proto/symbol/非枚举/accessor 四查齐备，与数组同纪律）——
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error('非 plain/null-prototype object（Date/Yjs/class 实例）');
  }
  if (Object.getOwnPropertySymbols(obj).length > 0) throw new Error('symbol 键属 JSON 域外');
  const ownNames = Object.getOwnPropertyNames(obj);
  const ownEnumerables = Object.keys(obj);
  if (ownNames.length !== ownEnumerables.length) {
    throw new Error('object 携带非枚举 own 键');
  }
  for (const k of ownEnumerables) {
    const desc = Object.getOwnPropertyDescriptor(obj, k);
    if (desc === undefined || !('value' in desc) || desc.get !== undefined || desc.set !== undefined) {
      throw new Error('accessor/非数据描述符');
    }
  }
  const out: Record<string, unknown> = {};
  for (const k of ownEnumerables) {
    // defineProperty 写入（同 copyFrozen putPlainKey 纪律）：'__proto__' 自有键不触发
    // 原型 setter、不劫持产物原型；产物最终 Object.freeze。
    Object.defineProperty(out, k, {
      value: clonePlainData((obj as Record<string, unknown>)[k], visited),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(out);
}

/**
 * 槽内 Clock 单次读数（设计 §6 DQ-3/§7 表）：payload 快照成功后、任何 compile/validate
 * 之前执行一次 `clock.now()`；throw / 非有限 number / |ms|>8.64e15 / `toISOString()`
 * RangeError —— 一律 fail-loud：observer `lifecycle-slot-failed(create)` +
 * branded fatal `create/create-document-internal/false`（pre-commit，零 Persistence）。
 * 合法边界 ±8.64e15 接受；`new Date(ms)` 可能对 finite 但超界值抛 RangeError，一并收编。
 * 闭包（每个 Registry 一份）：observer 隔离分发单点。
 */
export function createRegistryInternal(
  persistence: DocPersistence,
  options: NamespaceRegistryInternalOptions,
): NamespaceRegistry {
  assertClockShape(options?.clock);
  // #112 裁决 A + SA6 要点 2：scheduler 门禁必须排在 clock 门禁之后（既有构造门禁
  // 用例以 { clock: {} } 断言 CLOCK 文案——scheduler 先行会改抛 SCHEDULER 文案）。
  assertSchedulerShape(options?.scheduler);
  const idleTimeoutMs = resolveIdleTimeoutMs(options);
  const factory: RuntimeFactory =
    options.runtimeFactory === undefined
      ? createNamespaceRuntimeForRegistry
      : (options.runtimeFactory as RuntimeFactory);
  const observer = options.observer;
  const diagnostics = options.diagnostics;
  const clock: Clock = options.clock;
  const scheduler: RegistryTimeoutScheduler = options.scheduler;
  const documentFactory: CreateDocumentFactory | undefined =
    options.createDocumentFactory === undefined
      ? undefined
      : (options.createDocumentFactory as CreateDocumentFactory);

  const entries = new Map<string, Entry>();
  const carriers = new Map<string, LifecycleCarrier>();
  // 测试专用 entry 注入面（SA4 HIGH-1 关闭态四变体 fixture；仅经内部 options 到达）。
  // 设计 §8 冻结形态：ReadonlyMap 静态种子或种子函数（构造期同步调用——Fixture 可
  // 在 await closePromise 前后增删 entry 表达 generation 迁移语义）。
  if (options.testEntries !== undefined) {
    if (typeof options.testEntries === 'function') {
      options.testEntries(entries as Map<string, any>);
    } else {
      for (const [key, entry] of options.testEntries) {
        entries.set(key, entry as Entry);
      }
    }
  }
  let nextEntryGeneration = 1n;
  let nextCarrierGeneration = 1n;
  let acceptance: 'running' | 'shutting-down' | 'stopped' = 'running';
  let shutdownPromise: Promise<void> | undefined;

  function emitDiagnostics(event: RegistryDiagnosticsEvent): void {
    // 隔离体单点：dispatchDiagnostics（observer.ts）——sink 缺失或 throw 均 no-op。
    dispatchDiagnostics(diagnostics, event);
  }

  /**
   * 槽内 Clock 单次读数（设计 §6 DQ-3/§7 表）：payload 快照成功后、任何 compile/validate
   * 之前执行一次 `clock.now()`；throw / 非有限 number / |ms|>8.64e15 / `toISOString()`
   * RangeError —— 一律 fail-loud：observer `lifecycle-slot-failed(create)` +
   * branded fatal `create/create-document-internal/false`（pre-commit，零 Persistence）。
   * 合法边界 ±8.64e15 接受；`new Date(ms)` 可能对 finite 但超界值抛 RangeError，一并收编。
   */
  function readCreatedAtOrFatal(identity: InternalIdentity): string {
    let ms: number;
    try {
      ms = clock.now();
    } catch (cause) {
      dispatchObserver(observer, { type: 'lifecycle-slot-failed', identity, operation: 'create', cause });
      throw new NamespaceRegistryFatalError('create', 'create-document-internal', false, cause);
    }
    if (typeof ms !== 'number' || !Number.isFinite(ms) || Math.abs(ms) > 8.64e15) {
      const cause = new Error(
        `Clock.now() 非法读数：${typeof ms === 'number' ? String(ms) : typeof ms}`,
      );
      dispatchObserver(observer, { type: 'lifecycle-slot-failed', identity, operation: 'create', cause });
      throw new NamespaceRegistryFatalError('create', 'create-document-internal', false, cause);
    }
    let createdAt: string;
    try {
      createdAt = new Date(ms).toISOString();
    } catch (cause) {
      dispatchObserver(observer, { type: 'lifecycle-slot-failed', identity, operation: 'create', cause });
      throw new NamespaceRegistryFatalError('create', 'create-document-internal', false, cause);
    }
    return createdAt;
  }

  function createCarrier(key: string): LifecycleCarrier {
    const carrier: LifecycleCarrier = {
      key,
      generation: nextCarrierGeneration,
      tail: Promise.resolve(),
    };
    nextCarrierGeneration += 1n;
    carriers.set(key, carrier);
    emitDiagnostics({ type: 'carrier-created', keyDigest: digestKey(key), generation: carrier.generation });
    return carrier;
  }

  /** 每个 operation 的 cleanup（§5 三条件）；在 operationGreenTail settle 后以 microtask 执行。 */
  function scheduleCarrierCleanup(
    key: string,
    carrier: LifecycleCarrier,
    operationGreenTail: Promise<void>,
  ): void {
    void operationGreenTail.then(() => {
      if (
        !entries.has(key) &&
        carriers.get(key) === carrier &&
        carrier.tail === operationGreenTail
      ) {
        carriers.delete(key);
        emitDiagnostics({
          type: 'carrier-deleted',
          keyDigest: digestKey(key),
          generation: carrier.generation,
        });
      }
    });
  }

  /** 同 key 同步接纳 + FIFO 串行（不同 key 各自 carrier 并行）。 */
  function admitOpenSlot(identity: InternalIdentity): Promise<OpenNamespaceResult> {
    const carrier = carriers.get(identity.key) ?? createCarrier(identity.key);
    const operation = carrier.tail.then(() => runOpenSlot(identity));
    const operationGreenTail = operation.then(
      () => undefined,
      () => undefined,
    );
    carrier.tail = operationGreenTail;
    scheduleCarrierCleanup(identity.key, carrier, operationGreenTail);
    return operation;
  }

  function issueLease(entry: Entry): Readonly<{ ok: true; lease: NamespaceLease }> {
    const lease = createLeaseController(entry, observer, () => handleLeaseReleased(entry));
    entry.leases.add(lease);
    return Object.freeze({ ok: true as const, lease });
  }

  /**
   * 最后 lease 释放的 idle 武装（#112 设计 §2.B；运行在 release() 同步段内，恰一次）。
   * 机制裁决：lease controller 是独立闭包、observer 是可选注入，均不能作唯一通知机制
   * ——冻结 createLeaseController 第三参 onReleased（lease.ts），registry 在 issueLease
   * 处闭包绑定。observer `lease-released` 事件之后、恰一次——release 的 same-Promise /
   * 同步失效契约零改动（released 标记与 releasePromise 缓存先于回调）。
   */
  function handleLeaseReleased(entry: Entry): void {
    // shutdown 期不武装：entry 保持 active(零 lease)，由 shutdown 步骤 2 统一关闭
    // （不存在「shutdown 后新武装的 timer」）。
    if (acceptance !== 'running') return;
    if (entry.phase !== 'active' || entry.leases.size !== 0) return;
    let handle: unknown;
    try {
      handle = scheduler.setTimeout(() => {
        // I4 arm-token 判别（R1/H1）：仅当本次武装的 handle 仍是 entry 当前武装时才
        // 生效——activateEntry / shutdown 取消段置 idleTimerHandle=undefined、重武装
        // 写入新 handle，均使旧 token 失配 no-op（对取消/替换后仍被调度的回调——
        // adversarial 或违约 scheduler——结构性免疫，不依赖 scheduler 自身正确性。
        // 前提：同时存活的武装返回可判别 handle）。
        if (entry.idleTimerHandle !== handle) return;
        beginIdleClose(entry);
      }, idleTimeoutMs);
    } catch (cause) {
      // 武装失败不破坏 release() 的 same-Promise 契约：entry 保持 active(零 lease)
      // （后续 open 零 loadDoc 复用、shutdown 兜底关闭）；内部 observer 上报
      // idle-arm-failed（§2.I）——绝不静默重试/降级。
      dispatchObserver(observer, {
        type: 'idle-arm-failed',
        identity: entryIdentity(entry),
        generation: entry.generation,
        cause,
      });
      return;
    }
    entry.idleTimerHandle = handle;
    entry.phase = 'idle';
    dispatchObserver(observer, {
      type: 'entry-idle',
      identity: entryIdentity(entry),
      generation: entry.generation,
    });
  }

  /**
   * idle timer 到期 → closing → close 的精确次序（#112 设计 §2.B；运行在 timer 调度栈
   * ——经 I4 token 判别后的武装闭包调用，**不进 carrier FIFO**：它是内部生命周期，
   * 不是调用方操作）：
   * ① 先取得 close Promise（runtime 同步进 closing）② 后写 entry.closePromise
   * （I2）③ 不可逆翻相 phase='closing'（AC5）④ settle（成败皆然）→
   * removeOnlySelf 双守卫移除 ⑤ reject 臂 observer idle-close-failed（AC7，
   * 恰一次、exact cause）+ 相同移除。
   */
  function beginIdleClose(entry: Entry): void {
    if (entries.get(entry.key) !== entry) return; // 旧 generation ABA 守卫（结构性防御）
    if (entry.phase !== 'idle') return; // 已被 open 激活 / 已 closing（结构性防御）
    entry.idleTimerHandle = undefined;
    const closePromise = entry.runtime.close(); // ① 先取得 close Promise（同步进 closing）
    entry.closePromise = closePromise; // ② 后写 entry（I2：closing ⟹ closePromise 定义）
    entry.phase = 'closing'; // ③ 不可逆转换（AC5）
    closePromise.then(
      () => removeEntryAfterClose(entry, undefined), // ④ settle（成败皆然）→ 双守卫移除
      (cause) => {
        dispatchObserver(observer, {
          type: 'idle-close-failed', // ⑤ AC7：exact cause 进内部 observer（恰一次）
          identity: entryIdentity(entry),
          generation: entry.generation,
          cause,
        });
        removeEntryAfterClose(entry, cause);
      },
    );
  }

  /** idle close settle 后的 entry 清理：identity + generation 双守卫（#110 removeOnlySelf）；
   * runtime 无论 release 成败都 closed（§2.C 代际局部清理——旧 close completion 绝不
   * 按 key 无条件 delete 后来建立的新 entry）。 */
  function removeEntryAfterClose(entry: Entry, _cause: unknown): void {
    removeOnlySelf(entries, entry);
  }

  /** idle 途经 open 的激活（#112 设计 §2.B）：同步取消 timer（AC5）+ 翻相 active。
   * 非 idle（含取消后的豁免窗口期 entry）零副作用——shutdown 没收的 entry 保持
   * 原相，由 shutdown 统一关闭。 */
  function activateEntry(entry: Entry): Entry {
    if (entry.phase === 'idle') {
      if (entry.idleTimerHandle !== undefined) scheduler.clearTimeout(entry.idleTimerHandle);
      entry.idleTimerHandle = undefined;
      entry.phase = 'active';
    }
    return entry;
  }

  /** entry → InternalIdentity 的只读投影（owner/namespaceId/key 均为 entry 既有
   * 只读字段，零新建身份；observer 事件载荷专用）。 */
  function entryIdentity(entry: Entry): InternalIdentity {
    return { owner: entry.owner, namespaceId: entry.namespaceId, key: entry.key };
  }

  /** 所有权回退释放（§6.7）：handle.release() 恰一次；reject 仅上报 observer，不替换主 fatal。
   * 调用方必须 fire-and-forget（void、不 await）：清理不得阻塞 fatal 交付（#110 R2）。 */
  async function releaseHandleBestEffort(
    handle: DocHandle,
    identity: InternalIdentity,
  ): Promise<void> {
    try {
      await handle.release();
    } catch (e) {
      dispatchObserver(observer, { type: 'handle-release-failed', identity, cause: e });
    }
  }

  function makeEntry(identity: InternalIdentity, runtime: NamespaceRuntime): Entry {
    const generation = nextEntryGeneration;
    nextEntryGeneration += 1n;
    return {
      key: identity.key,
      generation,
      owner: identity.owner,
      namespaceId: identity.namespaceId,
      runtime,
      phase: 'active',
      leases: new Set(),
      idleTimerHandle: undefined, // I1：active ⟺ 未武装（构造后同一同步段内成立）
    };
  }

  async function runOpenSlot(identity: InternalIdentity): Promise<OpenNamespaceResult> {
    // acceptance 检查已迁移至公共入口同步段（§2.D）；已接纳槽按自身事实结算，此处不再检查。
    const key = identity.key;
    const current = entries.get(key);
    if (current !== undefined && current.phase === 'active') {
      return issueLease(current);
    }
    if (current !== undefined && current.phase === 'idle') {
      return issueLease(activateEntry(current)); // AC5 同步取消 timer + 复用
    }
    if (current !== undefined && current.phase === 'closing' && current.closePromise !== undefined) {
      try {
        await current.closePromise;
      } catch {
        // idle-close 失败已在发起侧上报 observer（idle-close-failed）；本槽继续建新
        // generation（ADR-0009:50「后续 open 等待同一个 close Promise 结算，再 load
        // 并建立新 generation」——结算含 reject）。与 create 对同场景的 fail-closed
        // fatal 为**有意冻结**的不对称：open 仅加载、可用性优先且 ADR 文本直译。
      }
      const recheck = entries.get(key);
      if (recheck !== undefined && (recheck.phase === 'active' || recheck.phase === 'idle')) {
        return issueLease(activateEntry(recheck)); // 复用（含新 generation 已 idle 再激活）
      }
      // recheck===undefined：唯一放行至 loadDoc（新 generation）；recheck 仍 closing
      // 结构性不可达（closePromise settle 处理器最先挂接 + 同 key FIFO，§2.B 微任务
      // 次序证明），落穿不改写。
    }

    let handle: DocHandle | null;
    try {
      handle = await persistence.loadDoc(identity.owner, identity.namespaceId);
    } catch (e) {
      if (e instanceof DocLoadOperationalError) {
        dispatchObserver(observer, { type: 'open-load-failed', identity, cause: e });
        return LOAD_FAILED_ISSUE;
      }
      dispatchObserver(observer, {
        type: 'lifecycle-slot-failed',
        identity,
        operation: 'open',
        cause: e,
      });
      throw new NamespaceRegistryFatalError('open', 'lifecycle-slot-internal', false, e);
    }
    if (handle === null) {
      return NOT_FOUND_ISSUE;
    }

    let runtime: NamespaceRuntime;
    try {
      runtime = factory(handle, () => persistence.saveDoc(handle));
    } catch (e) {
      // 所有权仍归调用方：handle.release() 恰一次（resolve/reject 均不替换 factory cause）。
      // 清理不阻塞 fatal 交付（#110 R2）：fire-and-forget 同步发起 release、绝不 await；
      // 浮动 Promise 由 releaseHandleBestEffort 内部 try/catch 全包，永不 unhandled rejection。
      void releaseHandleBestEffort(handle, identity);
      dispatchObserver(observer, {
        type: 'open-runtime-construction-failed',
        identity,
        cause: e,
      });
      throw new NamespaceRegistryFatalError('open', 'runtime-construction', false, e);
    }

    const entry = makeEntry(identity, runtime);
    entries.set(key, entry);
    return issueLease(entry);
  }

  /** 同 key 同步接纳 + FIFO 串行（#111：create/open 共用同一 carrier；§5）。 */
  function admitCreateSlot(inputRef: unknown): Promise<CreateNamespaceResult> {
    // §4 DQ-1：最小 identity 接纳先行——invalid 零 carrier/entries/Persistence；冻结
    // owner 投影 + namespaceId + key（排队期间调用方改写不影响最终身份与 queue key）。
    const outcome = acceptCreateIdentity(inputRef);
    if (!outcome.ok) {
      return Promise.resolve(outcome.issue);
    }
    const carrier = carriers.get(outcome.identity.key) ?? createCarrier(outcome.identity.key);
    const operation = carrier.tail.then(() => runCreateSlot(outcome.identity, inputRef));
    const operationGreenTail = operation.then(
      () => undefined,
      () => undefined,
    );
    carrier.tail = operationGreenTail;
    scheduleCarrierCleanup(outcome.identity.key, carrier, operationGreenTail);
    return operation;
  }

  /**
   * #111 create slot 精确伪码（§5 冻结次序）：entry/closing → payload 快照 → Clock →
   * create-document → Persistence createDoc → Runtime factory → entry/lease。
   * 每 slot 独立结算：失败只毒化本槽，carrier green tail 继续（§1.1/§5）。
   * #112 增量（§2.B/§2.D）：acceptance 检查迁移至公共入口（槽内删除）；entry 分派
   * 扩 idle 第五态（ADR-0009:68：active 与 idle 同码 ALREADY_EXISTS、零 Persistence）。
   */
  async function runCreateSlot(id: InternalIdentity, inputRef: unknown): Promise<CreateNamespaceResult> {
    const key = id.key;
    const current = entries.get(key);
    if (current !== undefined && (current.phase === 'active' || current.phase === 'idle')) {
      // DQ-5：active（含 lease 为零的临时保留态）与 idle（#112 第五态）同码
      // ALREADY_EXISTS，零 Persistence、零 Clock 读（ADR-0009:68 明文）。
      return ALREADY_EXISTS_ISSUE;
    }
    if (current !== undefined && current.phase === 'closing') {
      // R2-M1 fail-closed：closing 缺少 closePromise = #110 预留危险态——fail-loud，
      // 发生在任何 payload/Clock/Persistence 访问之前（本切片不可达；#112 统一定义）。
      if (current.closePromise === undefined) {
        const cause = new Error('closing entry 缺少 closePromise');
        dispatchObserver(observer, {
          type: 'lifecycle-slot-failed',
          identity: id,
          operation: 'create',
          cause,
        });
        throw new NamespaceRegistryFatalError('create', 'lifecycle-slot-internal', false, cause);
      }
      // HIGH-1（设计 §5 补遗，冻结次序）：await closePromise 后必须三态再评估——
      // 仅 entry 消失（generation 迁移完成）才进入 payload；await 自身 reject → 同形
      // fail-closed fatal（cause = exact close rejection，绝不裸传）。
      try {
        await current.closePromise;
      } catch (cause) {
        dispatchObserver(observer, {
          type: 'lifecycle-slot-failed',
          identity: id,
          operation: 'create',
          cause,
        });
        throw new NamespaceRegistryFatalError('create', 'lifecycle-slot-internal', false, cause);
      }
      const after = entries.get(key);
      if (after !== undefined && (after.phase === 'active' || after.phase === 'idle')) {
        return ALREADY_EXISTS_ISSUE; // 新增 idle（防御可达；与 DQ-5 对齐）
      }
      if (after !== undefined) {
        // await 后仍 closing：#112 统一 closing 状态机，本票不建 loop——fail-closed，
        // 零 payload/Clock/Persistence 访问（#112 接管后置态）。
        const cause = new Error('closing entry 在 close 后仍为 closing');
        dispatchObserver(observer, {
          type: 'lifecycle-slot-failed',
          identity: id,
          operation: 'create',
          cause,
        });
        throw new NamespaceRegistryFatalError('create', 'lifecycle-slot-internal', false, cause);
      }
      // after===undefined 才继续（唯一放行分支）。
    }

    const payload = snapshotCreatePayload(inputRef);
    if (!payload.ok) {
      return CREATE_INVALID_INPUT_ISSUE;
    }

    // §6 DQ-3：payload 快照成功后、compile/validate 前单次读数；非法读数 fail-loud pre-commit。
    const createdAt = readCreatedAtOrFatal(id);

    let initial: CreateDocumentGatewayResult;
    try {
      initial = createDocument(
        documentFactory,
        id.namespaceId,
        createdAt,
        payload.schema,
        payload.root,
      );
    } catch (cause) {
      dispatchObserver(observer, {
        type: 'lifecycle-slot-failed',
        identity: id,
        operation: 'create',
        cause,
      });
      // §7：seam internal fatal 保留原 committed 事实；未知异常按 pre-commit false。
      if (cause instanceof DocRuntimeFatalError) {
        throw new NamespaceRegistryFatalError(
          'create',
          'create-document-internal',
          cause.committed,
          cause,
        );
      }
      throw new NamespaceRegistryFatalError('create', 'create-document-internal', false, cause);
    }
    if (!initial.ok) {
      if (initial.kind === 'schema-invalid') {
        return schemaInvalidIssue(initial.issues);
      }
      if (initial.kind === 'root-invalid') {
        return rootInvalidIssue(initial.issues);
      }
      // input-invalid 结构性不可达（compile 产物恒四键正确型 + Registry 自构 META）；
      // fail-loud，禁止伪装为普通 create input issue（§6/§7）。
      const cause = new Error('createInitialDocument 返回不可达 input-invalid');
      dispatchObserver(observer, {
        type: 'lifecycle-slot-failed',
        identity: id,
        operation: 'create',
        cause,
      });
      throw new NamespaceRegistryFatalError('create', 'create-document-internal', false, cause);
    }

    let handle: DocHandle;
    try {
      handle = await persistence.createDoc(id.owner, id.namespaceId, initial.doc);
    } catch (cause) {
      if (cause instanceof DocDuplicateError) {
        return ALREADY_EXISTS_ISSUE; // persisted duplicate 同码（§7/§9）
      }
      if (cause instanceof DocCreateOperationalError) {
        dispatchObserver(observer, { type: 'create-persist-failed', identity: id, cause });
        return CREATE_FAILED_ISSUE;
      }
      if (cause instanceof DocCreateFatalError) {
        dispatchObserver(observer, {
          type: 'lifecycle-slot-failed',
          identity: id,
          operation: 'create',
          cause,
        });
        // phase 改写为 Registry 词表；committed 原样传播（§7 DQ-6）。
        throw new NamespaceRegistryFatalError(
          'create',
          'lifecycle-slot-internal',
          cause.committed,
          cause,
        );
      }
      // typed 契约覆盖合法结局；unknown 是 adapter/registry 缺陷——固定 committed:false
      // （DQ-6：retry 由 atomic duplicate 守卫自愈为 ALREADY_EXISTS）。
      dispatchObserver(observer, {
        type: 'lifecycle-slot-failed',
        identity: id,
        operation: 'create',
        cause,
      });
      throw new NamespaceRegistryFatalError('create', 'lifecycle-slot-internal', false, cause);
    }

    try {
      const runtime = factory(handle, () => persistence.saveDoc(handle));
      // 失败 Runtime 从未发布：entry 只在 factory 成功后登记（§7 DQ-7 结构性零 entry）。
      const entry = makeEntry(id, runtime);
      entries.set(key, entry);
      return issueLease(entry);
    } catch (cause) {
      // createDoc resolve 即是 committed 事实 → factory throw 必为 committed:true（§7 DQ-7）；
      // 所有权未转 Runtime：release 同步发起、恰一次、fire-and-forget（绝不 await——不阻塞
      // fatal 交付；清理失败仅 observer 上报）。文档不删除、不补偿；后续 open 可恢复。
      void releaseHandleBestEffort(handle, id);
      dispatchObserver(observer, { type: 'create-runtime-construction-failed', identity: id, cause });
      throw new NamespaceRegistryFatalError('create', 'runtime-construction', true, cause);
    }
  }

  /**
   * shutdown 异步段（#112 设计 §2.D 冻结次序）：
   * 1) 同步段/异步段切换先经一次微任务展开（`await Promise.resolve()`）——空 registry
   *    （零 carrier、零 entry）下设计伪码其余步骤无可 await 点，若不显式边界化，三相
   *    状态机会在 shutdown() 返回前坍缩至 stopped，违反 §2.D「shutting-down 在同步段
   *    返回后立即可观测」（registry-open.test.ts 732 行测试与 §7 测试 13 的观测锚）；
   * 2) 等待全部已接纳 open/create 结算：carrier tail 恒绿，逐 key await（快照迭代——
   *    接纳门已关，无新 carrier；green tail 使 await 永不 reject）。不等待外部 lease
   *    release（release 不经 carrier；带存活 lease 的 entry 直接进入第 3 步关闭，AC9）；
   * 3) 枚举关闭全集 = 当前 entries 全集（active + idle(timer 已取消) + closing(含 idle
   *    close 在途)）。先全部发起、后统一等待（发起序 = Map 插入序，确定）；
   *    在途 close Promise 复用共享同一实例（AC10）；
   * 4) 全部尝试，不因首败跳过其余（AC10）；close reject 不外泄（await catch 收集）；
   * 5) 终态与清理：entries.clear + acceptance='stopped'；failures 非空 → reject
   *    NamespaceRegistryShutdownError（状态仍先到 stopped——失败不回滚终态）。
   */
  async function runShutdown(): Promise<void> {
    await Promise.resolve(); // 微任务边界：同步段（翻相 + 取消 idle timer）先交付观测面
    for (const carrier of [...carriers.values()]) await carrier.tail;

    const closures: Array<{ entry: Entry; promise: Promise<void> }> = [];
    for (const entry of entries.values()) {
      if (entry.closePromise !== undefined) {
        closures.push({ entry, promise: entry.closePromise }); // AC10 复用已在途 close Promise
      } else {
        const promise = entry.runtime.close(); // shutdown 发起的 close：active/idle → closing
        entry.closePromise = promise;
        entry.phase = 'closing';
        closures.push({ entry, promise });
      }
    }

    const failures: NamespaceRegistryShutdownFailure[] = [];
    for (const { entry, promise } of closures) {
      try {
        await promise;
      } catch (cause) {
        failures.push(
          Object.freeze({ owner: entry.owner, namespaceId: entry.namespaceId, cause }),
        );
      }
    }

    entries.clear();
    acceptance = 'stopped';
    if (failures.length > 0) {
      throw new NamespaceRegistryShutdownError(Object.freeze(failures));
    }
  }

  const registry: NamespaceRegistry = Object.freeze({
    async open(owner: unknown, namespaceId: unknown): Promise<OpenNamespaceResult> {
      // #112 逻辑门迁移（§2.D）：停接纳检查在**公共入口同步段**（async 函数体首语句、
      // 调用方 tick 内执行）——先于一切输入访问（AC9「不访问新输入」：zero
      // descriptor/Proxy trap 执行、零 Persistence/Runtime/carrier）。
      if (acceptance !== 'running') return NOT_ACCEPTING_ISSUE;
      // §6.1：身份算法同步先行——invalid 零 entries/carriers/Persistence/Runtime 访问。
      const outcome = validateOpenIdentity(owner, namespaceId);
      if (!outcome.ok) {
        return outcome.issue;
      }
      // §6.2：同步取得 carrier 并接纳 lifecycle slot（已接纳槽按自身事实完整结算——
      // ADR-0009:99「等待此前已接纳的 lifecycle 操作结算」）。
      return admitOpenSlot(outcome.identity);
    },
    async create(input: unknown): Promise<CreateNamespaceResult> {
      // #112 逻辑门迁移（§2.D）：停接纳先于 acceptCreateIdentity（零 descriptor/Proxy
      // trap 执行，AC9）。公共 typed / 实现 unknown 双层签名说明见 #111 冻结文本。
      if (acceptance !== 'running') return NOT_ACCEPTING_ISSUE;
      // §4/§5：最小 identity 接纳同步先行（零 carrier/entries/Persistence 副作用）；
      // 通过后经 #110 同一 carrier FIFO 入槽——同 key 排他、不同 key 并行。
      return admitCreateSlot(input);
    },
    getStatus(): NamespaceRegistryStatus {
      // §2.E：恒三相冻结常量投影（不暴露 entry/lease/queue/timer 任何内部计面）。
      return acceptance === 'running'
        ? RUNNING_STATUS
        : acceptance === 'shutting-down'
          ? SHUTTING_DOWN_STATUS
          : STOPPED_STATUS;
    },
    // 非 async 方法：精确返回缓存的 shutdownPromise 实例（async 包装会新建 Promise，
    // 破坏 AC12「并发/重复调用 exact same Promise」——§7 测试 20 幂等锚）。
    shutdown(): Promise<void> {
      // §2.D 首次 shutdown 的同步段（原子，run-to-completion）：
      // ① 同步停接纳（后续 open/create 立即可观测 NOT_ACCEPTING）；
      // ② 取消全部 idle timer（不再有自发 close）；
      // ③ 缓存并返回同一 Promise（AC12 幂等 same-Promise，含已 reject 实例）。
      if (shutdownPromise !== undefined) return shutdownPromise;
      acceptance = 'shutting-down';
      for (const entry of entries.values()) {
        if (entry.phase === 'idle' && entry.idleTimerHandle !== undefined) {
          scheduler.clearTimeout(entry.idleTimerHandle);
          entry.idleTimerHandle = undefined;
        }
      }
      shutdownPromise = runShutdown();
      return shutdownPromise;
    },
  });
  return registry;
}

/** 生产工厂（设计 §2.1；#112 §2.A）：构造期 Clock + Scheduler 形状门禁（均必须显式
 * 提供——禁 Date.now / 系统 timer fallback；检查顺序 clock → scheduler，与
 * createRegistryInternal 内部同序）；idleTimeoutMs 可选（resolveIdleTimeoutMs 单点
 * 校验）；不接受 Runtime override；observer 经构造 options 注入。 */
export function createNamespaceRegistry(
  persistence: DocPersistence,
  options: CreateNamespaceRegistryOptions,
): NamespaceRegistry {
  assertClockShape(options?.clock);
  assertSchedulerShape(options?.scheduler);
  return createRegistryInternal(persistence, {
    clock: options.clock,
    scheduler: options.scheduler,
    ...(options.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
    ...(options.observer !== undefined ? { observer: options.observer } : {}),
  });
}
