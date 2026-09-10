/**
 * SA6 验收契约 fixture/harness — issue #267（REST router 骨架）。
 *
 * 本文件不是 *.test.ts，不被 vitest 收集；只承载契约测试共享的 fixture 与
 * 观测探针。**不 mock 被测边界**：create 路径全部委派真实 `NamespaceRegistry`
 * （MemoryPersistence / FilePersistence 真实 adapter），harness 只在
 * Registry 公共接口这一 ADR 0015 §测试决策指定的 seam 上做「观测包装」：
 *
 * - `createObservingRegistry`：委派真实 registry，只记录 create 输入、包装
 *   返回的 lease（release 计数 + 可选注入：release 失败 / release 门 / release
 *   后 namespaceId 变异）。用于 AC4「success DTO 在 release 前复制、release 恰
 *   一次、release 失败仍 201」；lease 的其余成员经对象展开原样委派（lease 实现
 *   全部是闭包成员，不依赖 this）。
 * - `createPoisonRegistry`：任何成员被调用即 throw。用于 role gate / route 未
 *   匹配 / 405 分支的「零 Registry 触达」证据。
 * - `trappedBodyRequest`：对真实 `Request` 做访问探针，body 消费方法被调用即
 *   throw；用于 AC2「Peer 在读取 body 前返回 403」。
 *
 * 未修改任何生产实现；契约的 red 只来自 `@nomicore/namespace-api/rest` 模块
 * 缺失本身（见 `wiki/raw/task_issue-267_sa6_contract.md` §9 能力缺口与 §13 红/绿证据）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FilePersistence,
  createMemoryPersistence,
  type DocPersistence,
} from '@nomicore/persistence';
import { createTestScheduler, type TestScheduler } from '@nomicore/persistence/testing';
import {
  createNamespaceRegistryForTesting,
  createRegistryTestScheduler,
} from '@nomicore/namespace-registry/testing';
import type {
  InstanceRole,
  NamespaceLease,
  NamespaceRegistry,
  NamespaceLeaseStatus,
} from '@nomicore/namespace-registry';

// —— 契约输入常量（ADR 0015 §HTTP 契约示例形状）——

/** 带普通注释的 VFSL 文本：语义指纹忽略注释，但持久化 SCHEMA.text 必须保留原文。 */
export const SCHEMA_TEXT = 'type ROOT = {\n  // persisted comment\n  title: string;\n};\n';

export const ROOT_VALUE = Object.freeze({ title: 'hello' });

export const OWNER_USER_ID = 'rest-contract-owner';

export const CREATE_PATH = '/v1/owners/rest-contract-owner/namespaces';

export const CREATE_URL = `http://localhost${CREATE_PATH}`;

/** release 后变异探针的哨兵值（若 response 出现它 ⇒ DTO 在 release 后才被读取）。 */
export const RELEASED_NAMESPACE_ID_SENTINEL = 'ns-00000000000000000000000000000000';

export const NAMESPACE_ID_PATTERN = /^ns-[0-9a-f]{32}$/;
export const SC1_ID_PATTERN = /^sc1-[a-z2-7]{52}$/;

// —— Request / Response 辅助 ——

/** 判别结果的契约提案形状（H1：`{matched:false} | {matched:true; response}`）。 */
export type HandledResult =
  | Readonly<{ matched: false }>
  | Readonly<{ matched: true; response: Response }>;

/** 匹配成功断言：未匹配时给出区分性失败信息（不是 TypeError 噪声）。 */
export function matchedResponse(result: HandledResult): Response {
  if (result.matched !== true) {
    throw new Error('契约违例：route 应匹配（matched:true）但收到 matched:false');
  }
  return result.response;
}

export function jsonRequest(
  url: string = CREATE_URL,
  body: unknown = { schemaText: SCHEMA_TEXT, root: ROOT_VALUE },
  init: RequestInit = {},
): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  const extra = new Headers(init.headers);
  extra.forEach((value, key) => headers.set(key, value));
  return new Request(url, {
    method: 'POST',
    ...init,
    headers,
    body: JSON.stringify(body),
  });
}

/** 方法变体请求（无 body；用于 405 / 未匹配分支）。 */
export function methodRequest(method: string, url: string = CREATE_URL): Request {
  return new Request(url, { method });
}

const BODY_CONSUMPTION_MEMBERS = new Set(['text', 'json', 'arrayBuffer', 'bytes', 'formData']);

export interface TrappedRequestObservation {
  /** 被调用的 body 消费成员名（契约期望恒为空数组）。 */
  readonly bodyConsumptionAttempts: string[];
}

/**
 * 真实 `Request` + 访问探针：body 消费成员一旦被读取即记录并 throw。
 * 其余成员反射委派（receiver 固定为 target 并绑定函数，避免内部槽 Illegal invocation）。
 */
export function trappedBodyRequest(
  request: Request,
  observation: TrappedRequestObservation,
): Request {
  return new Proxy(request, {
    get(target, property) {
      if (typeof property === 'string' && BODY_CONSUMPTION_MEMBERS.has(property)) {
        return () => {
          observation.bodyConsumptionAttempts.push(property);
          throw new Error(`契约违例：body 消费成员 request.${property}() 在 role gate 前被调用`);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// —— Registry 观测包装 ——

export interface ObservingRegistryOptions {
  /** 注入 release 失败（真实 release 已完成后 reject）——AC4「release 失败仍 201」。 */
  readonly releaseFailure?: Error;
  /** release 完成后 namespaceId 暴露值变异为哨兵——AC4「release 前复制」。 */
  readonly mutateNamespaceIdOnRelease?: boolean;
  /** release 门：lease.release() 先等待该 promise（真实 release 在其后执行）。 */
  readonly releaseGate?: Promise<void>;
}

export interface RegistryObservation {
  readonly createInputs: unknown[];
  releaseCalls: number;
  underlyingLease: NamespaceLease | undefined;
}

export interface ObservingRegistryHandle {
  readonly registry: NamespaceRegistry;
  readonly observation: RegistryObservation;
}

export function createObservingRegistry(
  registry: NamespaceRegistry,
  options: ObservingRegistryOptions = {},
): ObservingRegistryHandle {
  const observation: RegistryObservation = {
    createInputs: [],
    releaseCalls: 0,
    underlyingLease: undefined,
  };
  const wrapped: NamespaceRegistry = {
    open: (owner, namespaceId) => registry.open(owner, namespaceId),
    create: async (input) => {
      observation.createInputs.push(input);
      const result = await registry.create(input);
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
          if (options.releaseGate !== undefined) {
            await options.releaseGate;
          }
          await real.release();
          if (options.mutateNamespaceIdOnRelease === true) {
            exposedNamespaceId = RELEASED_NAMESPACE_ID_SENTINEL;
          }
          if (options.releaseFailure !== undefined) {
            throw options.releaseFailure;
          }
        },
      };
      return { ok: true, lease };
    },
    importReplica: (owner, namespaceId, doc, expected) =>
      registry.importReplica(owner, namespaceId, doc, expected),
    resetReplica: (owner, namespaceId, expected) =>
      registry.resetReplica(owner, namespaceId, expected),
    deleteNamespace: (owner, namespaceId) => registry.deleteNamespace(owner, namespaceId),
    getStatus: () => registry.getStatus(),
    shutdown: () => registry.shutdown(),
  };
  return { registry: wrapped, observation };
}

/** 零触达 poison registry：任何成员被调用即 throw（fail loud，不是静默降级）。 */
export function createPoisonRegistry(): NamespaceRegistry {
  const poison = (member: string) => (): never => {
    throw new Error(`契约违例：route 未匹配 / role 拒绝 / 405 分支触达了 registry.${member}`);
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
  return registry;
}

// —— Persistence fixture（与 registry 包 persistence-parity 契约同款构造）——

export interface PersistenceFixture {
  readonly persistence: DocPersistence;
  readonly durable: boolean;
  flush(): Promise<void>;
  dispose(): Promise<void>;
  restart(): PersistenceFixture;
  cleanup(): Promise<void>;
}

export function createMemoryFixture(): PersistenceFixture {
  const scheduler: TestScheduler = createTestScheduler();
  const persistence = createMemoryPersistence({
    scheduler,
    schedule: { debounceMs: 1, maxDirtyMs: 1 },
  });
  return {
    persistence,
    durable: false,
    flush: () => scheduler.advanceBy(1_000),
    dispose: () => persistence.dispose(),
    restart: () => {
      throw new Error('MemoryPersistence 无持久重启契约（契约只在 FilePersistence 上断言 durability）');
    },
    cleanup: async () => {},
  };
}

export async function createFileFixture(): Promise<PersistenceFixture> {
  const rootDir = await mkdtemp(join(tmpdir(), 'nomicore-rest-contract-'));
  const make = (): PersistenceFixture => {
    const scheduler: TestScheduler = createTestScheduler();
    const persistence = new FilePersistence({
      rootDir,
      scheduler,
      schedule: { debounceMs: 1, maxDirtyMs: 1 },
    });
    return {
      persistence,
      durable: true,
      flush: () => scheduler.advanceBy(1_000),
      dispose: () => persistence.dispose(),
      restart: () => make(),
      cleanup: () => rm(rootDir, { recursive: true, force: true }),
    };
  };
  return make();
}

/** 测试用 registry（真实 create/open 管线；受控 clock / scheduler / CSPRNG 注入）。 */
export function createContractRegistry(
  persistence: DocPersistence,
  role: InstanceRole = 'hub',
): NamespaceRegistry {
  return createNamespaceRegistryForTesting(persistence, {
    clock: { now: () => Date.UTC(2026, 0, 2, 3, 4, 5) },
    scheduler: createRegistryTestScheduler(),
    randomBytes: deterministicRandomBytes(),
    role,
  });
}

/** 确定性 128-bit 随机源（独立实例 = 独立计数器；ns- 生成只受 create 消耗）。 */
export function deterministicRandomBytes(): (length: number) => Uint8Array {
  let counter = 0;
  return (length: number): Uint8Array => {
    if (length !== 16) {
      throw new Error(`受控随机源必须按 128-bit（16 字节）请求，实际请求 ${length} 字节`);
    }
    counter += 1;
    const hex = counter.toString(16).padStart(32, '0');
    const out = new Uint8Array(16);
    for (let index = 0; index < 16; index += 1) {
      out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return out;
  };
}

export function leaseRuntimeReplication(
  status: NamespaceLeaseStatus,
): Readonly<{ state: 'disabled' | 'enabled' }> {
  if (status.lease !== 'active') {
    throw new Error(`契约前置失败：lease 已 released（期望 active），无法观察 replication 状态`);
  }
  return status.runtime.replication;
}
