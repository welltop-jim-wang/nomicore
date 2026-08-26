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
 * - accept/状态：本票 create/shutdown 为 NAMESPACE_OPERATION_UNAVAILABLE 占位
 *   （§11 裁决 1），getStatus 恒 running；acceptance 槽位检查为 #112 预留。
 *
 * 导出纪律（设计 §2.2/§8）：主入口只经 index.ts re-export createNamespaceRegistry
 * 与两个公开错误类；本文件另行导出 createRegistryInternal/NamespaceRegistryInternalOptions
 * （仅被 testing.ts 消费，主入口不 re-export；其类型面以 any-bridge 规避主入口可达
 * 声明图中的运行时对象与租约句柄类型名——精确注入面类型见 testing.ts）。
 */
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';
import type { NamespaceRuntime } from '@nomicore/namespace-runtime';
import { DocLoadOperationalError } from '@nomicore/persistence';
import type { DocHandle, DocPersistence } from '@nomicore/persistence';
import { digestKey, validateOpenIdentity, type InternalIdentity } from './identity.js';
import { createLeaseController } from './lease.js';
import {
  dispatchDiagnostics,
  dispatchObserver,
  type RegistryDiagnosticsEvent,
  type RegistryDiagnosticsSink,
  type RegistryObserver,
} from './observer.js';
import type {
  CreateNamespaceRegistryOptions,
  NamespaceLease,
  NamespaceRegistry,
  NamespaceRegistryStatus,
  OpenNamespaceResult,
  RegistryOperationUnavailableIssue,
} from './types.js';
import {
  NAMESPACE_LOAD_FAILED_MESSAGE,
  NAMESPACE_NOT_FOUND_MESSAGE,
  NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE,
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
 */
export interface NamespaceRegistryInternalOptions {
  readonly runtimeFactory?: (handle: any, notifyDirty: () => Promise<void>) => any;
  readonly observer?: RegistryObserver;
  readonly diagnostics?: RegistryDiagnosticsSink;
}

/** entry：同 key 唯一 Runtime 的登记单元（§5；generation 永不复用）。以下字段为
 * #111（create 共用 lifecycleTail）/ #112（closePromise + phase:'closing' 关闭聚合）
 * 的冻结设计预留，本票不消费、不改动（双轴终审明确保持现状）。 */
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

const CREATE_UNAVAILABLE: RegistryOperationUnavailableIssue = Object.freeze({
  ok: false,
  code: 'NAMESPACE_OPERATION_UNAVAILABLE',
  operation: 'create',
  message: NAMESPACE_OPERATION_UNAVAILABLE_MESSAGE,
});

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
export function createRegistryInternal(
  persistence: DocPersistence,
  options: NamespaceRegistryInternalOptions,
): NamespaceRegistry {
  const factory: RuntimeFactory =
    options.runtimeFactory === undefined
      ? createNamespaceRuntimeForRegistry
      : (options.runtimeFactory as RuntimeFactory);
  const observer = options.observer;
  const diagnostics = options.diagnostics;

  const entries = new Map<string, Entry>();
  const carriers = new Map<string, LifecycleCarrier>();
  let nextEntryGeneration = 1n;
  let nextCarrierGeneration = 1n;
  let acceptance: 'running' | 'shutting-down' | 'stopped' = 'running';

  function emitDiagnostics(event: RegistryDiagnosticsEvent): void {
    // 隔离体单点：dispatchDiagnostics（observer.ts）——sink 缺失或 throw 均 no-op。
    dispatchDiagnostics(diagnostics, event);
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

  function issueLease(entry: Entry): OpenNamespaceResult {
    const lease = createLeaseController(entry, observer);
    entry.leases.add(lease);
    return Object.freeze({ ok: true as const, lease });
  }

  /** 所有权回退释放（§6.7）：handle.release() 恰一次；reject 仅上报 observer，不替换主 fatal。 */
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
      await releaseHandleBestEffort(handle, identity);
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
    async create(_input: unknown): Promise<RegistryOperationUnavailableIssue> {
      // §11 裁决 1：resolve 窄占位 issue——零 input 访问、零 Persistence、不改 acceptance。
      return CREATE_UNAVAILABLE;
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

/** 生产工厂（设计 §2.1）：不接受 Runtime override；observer 经构造 options 注入。 */
export function createNamespaceRegistry(
  persistence: DocPersistence,
  options: CreateNamespaceRegistryOptions = {},
): NamespaceRegistry {
  return createRegistryInternal(persistence, {
    ...(options.observer !== undefined ? { observer: options.observer } : {}),
  });
}
