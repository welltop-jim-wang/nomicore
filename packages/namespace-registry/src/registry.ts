/**
 * @nomicore/namespace-registry —— Host 无关 Registry 核心（issue #110 设计 §5/§6）。
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
 * - entry 删除（未来 close/create post-commit 清理）采用 entry identity + generation
 *   双守卫（removeOnlySelf）：旧 entry completion 绝不按 key 无条件 delete。
 * - runOpenSlot 决策（§5 伪码）：acceptance → active entry 直接签新 lease →
 *   loadDoc（DocLoadOperationalError → 窄 issue + observer；其余 → fatal +
 *   observer）→ null → NOT_FOUND → factory（throw → handle.release() 恰一次 +
 *   observer + runtime-construction fatal）→ 建 entry、登记、签 lease。
 * - runCreateSlot 决策（#111 设计 §5 伪码，冻结次序）：acceptance → active/closing
 *   entry（closing+closePromise 缺失 → fail-loud fatal create/
 *   lifecycle-slot-internal/false + observer）→ payload 防御性快照（§4 第 3-4 步）→
 *   Clock 单次读数（§6 DQ-3；非法读数 fatal create/create-document-internal/false +
 *   observer）→ 私有 create-document（compile→validate→doc-runtime seam）→
 *   createDoc（§7 映射表：duplicate/operational/fatal/unknown）→ 普通 P0 Runtime
 *   factory（post-commit throw → release fire-and-forget 恰一次 + fatal
 *   create/runtime-construction/true）→ 建 entry、登记、签 lease。create/open 共用
 *   同一 carrier FIFO（不同 key 并行；失败只毒化本槽，green tail 继续）。
 * - accept/状态：本票 shutdown 为 NAMESPACE_OPERATION_UNAVAILABLE 占位（§11 裁决 1），
 *   getStatus 恒 running；acceptance 槽位检查为 #112 预留（create 槽已按 §5 检查）。
 *
 * 导出纪律（设计 §2.2/§8）：主入口只经 index.ts re-export createNamespaceRegistry
 * 与两个公开错误类；本文件另行导出 createRegistryInternal/NamespaceRegistryInternalOptions
 * （仅被 testing.ts 消费，主入口不 re-export；其类型面以 any-bridge 规避主入口可达
 * 声明图中的运行时对象与租约句柄类型名——精确注入面类型见 testing.ts）。
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
  NamespaceRegistryStatus,
  OpenNamespaceResult,
  RegistryOperationUnavailableIssue,
} from './types.js';
import {
  NAMESPACE_ALREADY_EXISTS_MESSAGE,
  NAMESPACE_CREATE_FAILED_MESSAGE,
  NAMESPACE_LOAD_FAILED_MESSAGE,
  NAMESPACE_NOT_FOUND_MESSAGE,
  NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE,
  NAMESPACE_ROOT_INVALID_MESSAGE,
  NAMESPACE_SCHEMA_INVALID_MESSAGE,
  REGISTRY_NOT_ACCEPTING_MESSAGE,
} from './types.js';
import { NamespaceRegistryFatalError } from './errors.js';

// 主入口 re-export 通道（设计 §2.2 精确导出面；errors.js 为不可达声明模块，经本文件转出）。
export { NamespaceLeaseReleasedError, NamespaceRegistryFatalError } from './errors.js';

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
  /** 测试专用 entry 注入面（仅内部 fixture；不进公共导出面）。设计 §8 冻结：Map 静态
   *  种子或种子函数二选一（SA4 HIGH-1 变体 C 的 generation 迁移语义）。 */
  readonly testEntries?: ReadonlyMap<string, any> | ((entries: Map<string, any>) => void);
}

/** entry：同 key 唯一 Runtime 的登记单元（§5；generation 永不复用）。#111 create
 * 只读消费 closePromise / phase:'closing'（R2-M1 fail-closed，不建 loop、不改动其
 * 写入）；lifecycleTail 仍无消费者，留 #112 关闭聚合统一接管。 */
interface Entry {
  readonly key: string;
  readonly generation: bigint;
  readonly owner: Readonly<{ readonly userId: string }>;
  readonly namespaceId: string;
  readonly runtime: NamespaceRuntime;
  phase: 'active' | 'closing';
  readonly leases: Set<NamespaceLease>;
  lifecycleTail: Promise<void>;
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

const SHUTDOWN_UNAVAILABLE: RegistryOperationUnavailableIssue = Object.freeze({
  ok: false,
  code: 'NAMESPACE_OPERATION_UNAVAILABLE',
  operation: 'shutdown',
  message: NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE,
});

const RUNNING_STATUS: NamespaceRegistryStatus = Object.freeze({ state: 'running' });

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
  const factory: RuntimeFactory =
    options.runtimeFactory === undefined
      ? createNamespaceRuntimeForRegistry
      : (options.runtimeFactory as RuntimeFactory);
  const observer = options.observer;
  const diagnostics = options.diagnostics;
  const clock: Clock = options.clock;
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
    const lease = createLeaseController(entry, observer);
    entry.leases.add(lease);
    return Object.freeze({ ok: true as const, lease });
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
      lifecycleTail: Promise.resolve(),
    };
  }

  async function runOpenSlot(identity: InternalIdentity): Promise<OpenNamespaceResult> {
    if (acceptance !== 'running') {
      return NOT_ACCEPTING_ISSUE;
    }
    const key = identity.key;
    const current = entries.get(key);
    if (current !== undefined && current.phase === 'active') {
      return issueLease(current);
    }
    if (current !== undefined && current.phase === 'closing' && current.closePromise !== undefined) {
      // #112 预留：#110 无 close 实现，此分支不可达；等待旧 entry close 结算后重评估。
      await current.closePromise;
      const recheck = entries.get(key);
      if (recheck !== undefined && recheck.phase === 'active') {
        return issueLease(recheck);
      }
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
   * #111 create slot 精确伪码（§5 冻结次序）：acceptance → entry/closing → payload 快照
   * → Clock → create-document → Persistence createDoc → Runtime factory → entry/lease。
   * 每 slot 独立结算：失败只毒化本槽，carrier green tail 继续（§1.1/§5）。
   */
  async function runCreateSlot(id: InternalIdentity, inputRef: unknown): Promise<CreateNamespaceResult> {
    if (acceptance !== 'running') {
      return NOT_ACCEPTING_ISSUE;
    }
    const key = id.key;
    const current = entries.get(key);
    if (current !== undefined && current.phase === 'active') {
      // DQ-5：active（含 lease 为零的临时保留态）零 Persistence duplicate。
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
      if (after !== undefined && after.phase === 'active') {
        return ALREADY_EXISTS_ISSUE;
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

  const registry: NamespaceRegistry = Object.freeze({
    async open(owner: unknown, namespaceId: unknown): Promise<OpenNamespaceResult> {
      // §6.1：身份算法同步先行——invalid 零 entries/carriers/Persistence/Runtime 访问。
      const outcome = validateOpenIdentity(owner, namespaceId);
      if (!outcome.ok) {
        return outcome.issue;
      }
      // §6.2：同步取得 carrier 并接纳 lifecycle slot（slot 开始再检查 acceptance）。
      return admitOpenSlot(outcome.identity);
    },
    async create(input: unknown): Promise<CreateNamespaceResult> {
      // 双层签名（对齐 open 的「公共 typed / 实现 unknown」先例）：公共声明
      // create(input: CreateNamespaceInput)（types.ts §3/§14），实现层以 unknown 接纳
      // ——§4 DQ-1 最小身份接纳是运行时唯一形状验收点（顶层非 object / identity
      // 缺陷 / payload 变体 → 窄 issue），敌意/畸形输入的静态表达不属于公共类型面。
      // §4/§5：最小 identity 接纳同步先行（零 carrier/entries/Persistence 副作用）；
      // 通过后经 #110 同一 carrier FIFO 入槽——同 key 排他、不同 key 并行。
      return admitCreateSlot(input);
    },
    getStatus(): NamespaceRegistryStatus {
      // 本票构造后恒 running；#112 以 acceptance 驱动真实投影（当前无可变相）。
      return RUNNING_STATUS;
    },
    async shutdown(): Promise<RegistryOperationUnavailableIssue> {
      // §11 裁决 1：resolve 窄占位 issue——不改 acceptance、不聚合 Runtime。
      return SHUTDOWN_UNAVAILABLE;
    },
  });
  return registry;
}

/** 生产工厂（设计 §2.1）：构造期 Clock 形状门禁（必须显式提供——禁 Date.now fallback）；
 * 不接受 Runtime override；observer 经构造 options 注入。 */
export function createNamespaceRegistry(
  persistence: DocPersistence,
  options: CreateNamespaceRegistryOptions,
): NamespaceRegistry {
  assertClockShape(options?.clock);
  return createRegistryInternal(persistence, {
    clock: options.clock,
    ...(options.observer !== undefined ? { observer: options.observer } : {}),
  });
}
