/**
 * SA6 验收契约 fixture/harness — issue #269（Registry 失败映射、取消边界、双 observer）。
 *
 * 本文件不是 `*.test.ts`，不被 vitest 收集；只承载 #269 契约测试共享的 fixture 与
 * 观测探针。**不 mock 被测边界**：REST router 的输入始终是标准 Web `Request`，
 * Registry 侧优先使用真实 `NamespaceRegistry`（MemoryPersistence 真实 adapter +
 * Registry testing 受控注入面）产生**真实**的 `REGISTRY_NOT_ACCEPTING`、typed
 * operational failure、`NamespaceRegistryFatalError`（committed:false / committed:true）。
 * 只有在真实管线无法确定性产生的「内部契约违例」（REST 自行构造合法输入，正常路径
 * 不可能得到 `NAMESPACE_CREATE_INVALID_INPUT` / `NAMESPACE_ALREADY_EXISTS`）与
 * unknown exception 上，才在 `NamespaceRegistry` 公共接口这一 seam 注入结果值——
 * 注入点是契约的输入通道，不是故障所在边界（故障在 REST 映射本身）。
 *
 * 相对 #267 harness 的增量（#267 文件保持冻结不改）：
 * - `createObserverRecorder`：`(...args: unknown[]) => void` 形态，既能赋给现行零参
 *   `() => void` observer 类型，也能赋给事件化后的 `(event) => void` 类型；
 * - `settleHandle` / `raceSettlement`：把 rejection、Response、悬挂（超时）统一为
 *   可断言的判别结果，避免未处理拒绝噪声；
 * - `createProbeRegistry`：委派真实 registry，只在公共成员上做 create/release 门、
 *   结果值替换与 unknown throw 注入，并记录 create 结算；
 * - `createZeroTouchRegistry`：记录任何被调用的 Registry 成员名（零触达证据）；
 * - `createFaultInjectedRegistry`：真实 Registry + testing 注入（create-document-factory
 *   throw → committed:false fatal；runtime-factory throw → committed:true fatal）；
 * - `createOperationalFailurePersistence`：真实 Registry + persistence typed operational
 *   failure（`DocCreateOperationalError`，committed:false）；
 * - `createMidReadAbortRequest`：真实流式 body（读已开始但未结束）+ AbortSignal。
 */
import { DocCreateOperationalError, type DocHandle, type DocPersistence } from '@nomicore/persistence';
import type {
  CreateNamespaceIssue,
  NamespaceLease,
  NamespaceRegistry,
} from '@nomicore/namespace-registry';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';
import type { RestHandledResult, RestRouter } from '../src/rest.js';
import {
  CREATE_URL,
  deterministicRandomBytes,
  jsonRequest,
} from './rest-contract-harness.js';

// —— 观测哨兵（用于敏感字段泄漏扫描）——

/** unknown exception / release failure 的 exact cause 哨兵（断言按引用相等）。 */
export const CAUSE_SENTINEL = 'sa6-269-cause-sentinel-do-not-leak';
export const RELEASE_CAUSE_SENTINEL = 'sa6-269-release-cause-sentinel-do-not-leak';
/** 内部契约违例注入用 message 哨兵（不进入任何 client 面）。 */
export const ISSUE_MESSAGE_SENTINEL = 'sa6-269-issue-message-sentinel-do-not-leak';
/** owner 哨兵：diagnostic 允许携带（已验证 owner），metrics 禁止携带。 */
export const OWNER_SENTINEL = 'sa6-269-owner-sentinel';

export const METRICS_EVENT_KEYS: readonly string[] = ['code', 'operation', 'outcome', 'status'];

export const METRICS_OUTCOMES: readonly string[] = [
  'succeeded',
  'rejected',
  'unavailable',
  'failed',
  'aborted',
];

export const DIAGNOSTIC_KINDS: readonly string[] = [
  'registry-fatal',
  'unknown-exception',
  'lease-release-failure',
];

// —— observer 记录器 ——

export interface ObserverRecorder {
  /** 可赋给 `() => void`（现状）与 `(event) => void`（事件化后）两种 observer 类型。 */
  readonly fn: (...args: unknown[]) => void;
  readonly calls: unknown[][];
  /** 每次调用的首个实参（事件对象）；零参调用时为 `undefined`。 */
  events(): unknown[];
}

export function createObserverRecorder(): ObserverRecorder {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]): void => {
    calls.push(args);
  };
  return { fn, calls, events: () => calls.map((args) => args[0]) };
}

// —— 结算（settlement）观测 ——

export type HandleSettlement =
  | Readonly<{ kind: 'resolved'; result: RestHandledResult }>
  | Readonly<{ kind: 'rejected'; error: unknown }>;

export type SettlementObservation = HandleSettlement | Readonly<{ kind: 'timeout' }>;

/** 把 handle 的 resolve/reject 统一为可断言值；绝不产生未处理拒绝。 */
export async function settleHandle(
  router: RestRouter,
  request: Request,
): Promise<HandleSettlement> {
  try {
    const result = await router.handle(request);
    return { kind: 'resolved', result };
  } catch (error) {
    return { kind: 'rejected', error };
  }
}

/** 有界等待结算：悬挂记 `timeout`（用于「abort 后必须有界结算」与红灯不悬挂）。 */
export async function raceSettlement(
  router: RestRouter,
  request: Request,
  timeoutMs: number,
): Promise<SettlementObservation> {
  const settled = settleHandle(router, request);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Readonly<{ kind: 'timeout' }>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function describeSettlement(settlement: SettlementObservation): string {
  switch (settlement.kind) {
    case 'timeout':
      return '结算超时：handle 在期限内未 resolve/reject';
    case 'rejected':
      return `handle rejection：${
        settlement.error instanceof Error ? `${settlement.error.name}: ${settlement.error.message}` : String(settlement.error)
      }`;
    case 'resolved':
      return settlement.result.matched
        ? `matched Response(status=${settlement.result.response.status})`
        : 'matched:false（未匹配）';
  }
}

/** 断言结算为匹配 Response 时取 response；否则以可读信息失败（不是 TypeError 噪声）。 */
export function responseOf(settlement: SettlementObservation): Response {
  if (settlement.kind !== 'resolved') {
    throw new Error(`契约违例：期望匹配 Response，实际 ${describeSettlement(settlement)}`);
  }
  if (settlement.result.matched !== true) {
    throw new Error('契约违例：route 应匹配（matched:true）但收到 matched:false');
  }
  return settlement.result.response;
}

export async function responseCode(response: Response): Promise<string> {
  const raw: unknown = await response.clone().json();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('契约违例：错误 response body 不是 object');
  }
  const code = (raw as Record<string, unknown>)['code'];
  if (typeof code !== 'string') {
    throw new Error('契约违例：错误 response body 缺少 string code');
  }
  return code;
}

// —— Registry 探针（委派真实 registry；只在公共成员上注入）——

export interface ProbeRegistryOptions {
  /** `create` 进入后先等待该 promise（Registry 接纳前/接纳中的时序控制）。 */
  readonly createGate?: Promise<void>;
  /** lease.release() 在真实 release 之前等待该 promise。 */
  readonly releaseGate?: Promise<void>;
  /** 真实 release 完成后以该 error 拒绝（不改变已知创建事实）。 */
  readonly releaseFailure?: Error;
  /** release 完成后把暴露的 namespaceId 变异为哨兵（DTO 复制探针）。 */
  readonly mutateNamespaceIdOnRelease?: boolean;
  /** 用注入的窄 issue 替换 create 结果（内部契约违例注入）。 */
  readonly createIssue?: CreateNamespaceIssue;
  /** 用注入的 unknown exception 替换 create 结算（绝不 resolve 伪装）。 */
  readonly createThrow?: unknown;
}

export interface ProbeRegistryObservation {
  createCalls: number;
  readonly createInputs: unknown[];
  /** 每次 create 的结算值（窄结果 / 成功结果 / fatal / unknown error）。 */
  readonly createSettlements: unknown[];
  releaseCalls: number;
  underlyingLease: NamespaceLease | undefined;
}

export interface ProbeRegistryHandle {
  readonly registry: NamespaceRegistry;
  readonly observation: ProbeRegistryObservation;
}

export function createProbeRegistry(
  base: NamespaceRegistry,
  options: ProbeRegistryOptions = {},
): ProbeRegistryHandle {
  const observation: ProbeRegistryObservation = {
    createCalls: 0,
    createInputs: [],
    createSettlements: [],
    releaseCalls: 0,
    underlyingLease: undefined,
  };
  const wrapped: NamespaceRegistry = {
    open: (owner, namespaceId) => base.open(owner, namespaceId),
    create: async (input) => {
      observation.createCalls += 1;
      observation.createInputs.push(input);
      if (options.createGate !== undefined) await options.createGate;
      if (options.createThrow !== undefined) {
        observation.createSettlements.push(options.createThrow);
        throw options.createThrow;
      }
      if (options.createIssue !== undefined) {
        observation.createSettlements.push(options.createIssue);
        return options.createIssue;
      }
      try {
        const result = await base.create(input);
        observation.createSettlements.push(result);
        if (!result.ok) return result;
        const real = result.lease;
        observation.underlyingLease = real;
        let exposedNamespaceId = real.namespaceId;
        const lease: NamespaceLease = {
          ...real,
          get namespaceId(): string {
            return exposedNamespaceId;
          },
          release: async (): Promise<void> => {
            observation.releaseCalls += 1;
            if (options.releaseGate !== undefined) await options.releaseGate;
            await real.release();
            if (options.mutateNamespaceIdOnRelease === true) {
              exposedNamespaceId = 'ns-00000000000000000000000000000000';
            }
            if (options.releaseFailure !== undefined) throw options.releaseFailure;
          },
        };
        return { ok: true, lease };
      } catch (error) {
        observation.createSettlements.push(error);
        throw error;
      }
    },
    importReplica: (owner, namespaceId, doc, expected) =>
      base.importReplica(owner, namespaceId, doc, expected),
    resetReplica: (owner, namespaceId, expected) =>
      base.resetReplica(owner, namespaceId, expected),
    deleteNamespace: (owner, namespaceId) => base.deleteNamespace(owner, namespaceId),
    getStatus: () => base.getStatus(),
    shutdown: () => base.shutdown(),
  };
  return { registry: wrapped, observation };
}

// —— 零触达探针（记录被调用的成员名）——

export interface ZeroTouchProbe {
  readonly registry: NamespaceRegistry;
  /** 被调用的 Registry 成员名（契约期望恒为空数组）；构造期形状检查只读属性不算调用。 */
  readonly invocations: string[];
}

export function createZeroTouchRegistry(): ZeroTouchProbe {
  const invocations: string[] = [];
  const poison = (member: string) => (): never => {
    invocations.push(member);
    throw new Error(`契约违例：本应 Registry 零触达，但调用了 registry.${member}`);
  };
  const registry: NamespaceRegistry = {
    open: poison('open'),
    create: poison('create'),
    importReplica: poison('importReplica'),
    resetReplica: poison('resetReplica'),
    deleteNamespace: poison('deleteNamespace'),
    getStatus: poison('getStatus'),
    shutdown: poison('shutdown'),
  };
  return { registry, invocations };
}

// —— 真实 Registry 故障注入（testing seam）——

export type InjectedFatalFault = 'create-document-internal' | 'runtime-construction';

export interface FaultInjectedRegistryHandle {
  readonly registry: NamespaceRegistry;
  readonly observation: ProbeRegistryObservation;
  /** committed:true fatal 提交的 namespaceId（runtimeFactory 在提交后被调用时捕获）。 */
  committedNamespaceId(): string | undefined;
}

export function createFaultInjectedRegistry(
  persistence: DocPersistence,
  fault: InjectedFatalFault,
): FaultInjectedRegistryHandle {
  let committedNamespaceId: string | undefined;
  const common = {
    clock: { now: () => Date.UTC(2026, 0, 2, 3, 4, 5) },
    scheduler: createRegistryTestScheduler(),
    randomBytes: deterministicRandomBytes(),
  };
  const registry =
    fault === 'create-document-internal'
      ? createNamespaceRegistryForTesting(persistence, {
          ...common,
          createDocumentFactory: () => {
            throw new Error(`${CAUSE_SENTINEL}:create-document-internal`);
          },
        })
      : createNamespaceRegistryForTesting(persistence, {
          ...common,
          runtimeFactory: ((handle: DocHandle) => {
            committedNamespaceId = handle.docId;
            throw new Error(`${CAUSE_SENTINEL}:runtime-construction`);
          }) as never,
        });
  const probe = createProbeRegistry(registry);
  return {
    registry: probe.registry,
    observation: probe.observation,
    committedNamespaceId: () => committedNamespaceId,
  };
}

/** persistence typed operational failure（真实 Registry 映射为 NAMESPACE_CREATE_FAILED）。 */
export function createOperationalFailurePersistence(base: DocPersistence): DocPersistence {
  return new Proxy(base, {
    get(target, property) {
      if (property === 'createDoc') {
        return async (): Promise<never> => {
          throw new DocCreateOperationalError(new Error(`${CAUSE_SENTINEL}:create-operational`));
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// —— abort fixture ——

export interface StreamingAbortProbe {
  readonly request: Request;
  readonly controller: AbortController;
  /** body 读取已开始（pull 已被调用）——abort 时序的确定性锚。 */
  pulls(): number;
  /** 释放未结束的 body（清理悬挂读，绝不改变被测语义）。 */
  cancel(): Promise<void>;
}

/**
 * 真实流式 body：仅投递一个不完整 JSON 前缀后保持打开；`pull` 计数证明读已开始。
 * 取消 signal 后 body 不会自行结束（Node 24 实测 `request.json()` 既不 reject 也
 * 不 resolve）——这正是「必须显式观察 Request.signal」的运行时事实。
 */
export function createMidReadAbortRequest(url: string = CREATE_URL): StreamingAbortProbe {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  let pulls = 0;
  let sent = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(sourceController) {
      streamController = sourceController;
    },
    pull(source) {
      pulls += 1;
      if (!sent) {
        sent = true;
        source.enqueue(encoder.encode('{"schemaText":'));
      }
    },
  });
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
    signal: controller.signal,
  });
  return {
    request,
    controller,
    pulls: () => pulls,
    // 锁定中的 body 不能经 stream.cancel() 清理；error() 同时终结未决读与流状态。
    cancel: async () => {
      try {
        streamController?.error(new Error('sa6-269 fixture cleanup'));
      } catch {
        // 已 error/closed：无需处理。
      }
      await Promise.resolve();
    },
  };
}

/** 完整 body + 可 abort signal（pre-abort / post-admission abort 场景）。 */
export function createAbortableJsonRequest(
  body: unknown = { schemaText: 'type ROOT = { title: string };', root: { title: 'hello' } },
  url: string = CREATE_URL,
): Readonly<{ request: Request; controller: AbortController }> {
  const controller = new AbortController();
  const request = jsonRequest(url, body, { signal: controller.signal });
  return { request, controller };
}
